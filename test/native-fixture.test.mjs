import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURE_TEXT, startFixtureServer } from '../src/native/fixture-server.mjs';

function parseSse(raw) {
  return raw
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
      assert.ok(dataLine, 'each SSE block must contain a data line');
      return JSON.parse(dataLine.slice(5).trimStart());
    });
}

function deltaText(events, type) {
  return events
    .filter((event) => event.type === type)
    .map((event) => event.delta)
    .join('');
}

async function requestEvents(server, url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'viewer-fixture',
      stream: true,
      input: [{ role: 'user', content: 'local fixture validation' }],
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream\b/i);
  const events = parseSse(await response.text());
  assert.ok(events.length > 0);
  for (let index = 0; index < events.length; index++) {
    assert.equal(events[index].sequence_number, index + 1);
  }
  return events;
}

async function withFixture(options, callback) {
  const instance = await startFixtureServer(options);
  try {
    return await callback(instance);
  } finally {
    await instance.close();
  }
}

test('both fixture streams summary, raw reasoning, and final output from /v1/responses', async () => {
  const metadataFile = `native-fixture-${process.pid}-both.json`;
  const instance = await startFixtureServer({ fixture: 'both', chunkDelayMs: 0, metadataFile });
  const metadataPath = instance.metadataPath;
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(metadata.port, instance.port);
    assert.equal(metadata.baseUrl, instance.baseUrl);
    assert.match(metadataPath, /[\\/]\.local[\\/]/);

    const events = await requestEvents(instance, `${instance.baseUrl}/responses`);
    const types = events.map((event) => event.type);
    assert.equal(types[0], 'response.created');
    assert.equal(types.at(-1), 'response.completed');
    assert.ok(types.includes('response.reasoning_summary_text.delta'));
    assert.ok(types.includes('response.reasoning_text.delta'));
    assert.ok(types.includes('response.output_text.delta'));
    assert.ok(types.filter((type) => type === 'response.reasoning_summary_text.delta').length > 1);
    assert.ok(types.filter((type) => type === 'response.reasoning_text.delta').length > 1);
    assert.ok(types.filter((type) => type === 'response.output_text.delta').length > 1);
    assert.equal(deltaText(events, 'response.reasoning_summary_text.delta'), FIXTURE_TEXT.summary);
    assert.equal(deltaText(events, 'response.reasoning_text.delta'), FIXTURE_TEXT.raw);
    assert.equal(deltaText(events, 'response.output_text.delta'), FIXTURE_TEXT.final);
    assert.equal(
      types.some((type) => type.includes('function_call')),
      false,
    );

    const completed = events.at(-1).response;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.model, 'viewer-fixture');
    assert.deepEqual(
      completed.output.map((item) => item.type),
      ['reasoning', 'message'],
    );
    assert.equal(completed.output[0].summary[0].text, FIXTURE_TEXT.summary);
    assert.equal(completed.output[0].content[0].text, FIXTURE_TEXT.raw);
    assert.equal(completed.output[1].content[0].text, FIXTURE_TEXT.final);
  } finally {
    await instance.close();
  }
  await assert.rejects(readFile(metadataPath), (error) => error.code === 'ENOENT');
});

test('raw-only fixture uses the unprefixed /responses endpoint and omits summary events', async () => {
  await withFixture(
    {
      fixture: 'raw-only',
      chunkDelayMs: 0,
      metadataFile: `native-fixture-${process.pid}-raw.json`,
    },
    async (instance) => {
      const events = await requestEvents(
        instance,
        `http://${instance.host}:${instance.port}/responses`,
      );
      assert.equal(deltaText(events, 'response.reasoning_text.delta'), FIXTURE_TEXT.raw);
      assert.equal(deltaText(events, 'response.output_text.delta'), FIXTURE_TEXT.final);
      assert.equal(
        events.some((event) => event.type.startsWith('response.reasoning_summary')),
        false,
      );

      const reasoning = events.at(-1).response.output.find((item) => item.type === 'reasoning');
      assert.deepEqual(reasoning.summary, []);
      assert.equal(reasoning.content[0].text, FIXTURE_TEXT.raw);
    },
  );
});

test('summary-only fixture omits raw reasoning events and content', async () => {
  await withFixture(
    {
      fixture: 'summary-only',
      chunkDelayMs: 0,
      metadataFile: `native-fixture-${process.pid}-summary.json`,
    },
    async (instance) => {
      const events = await requestEvents(instance, `${instance.baseUrl}/responses`);
      assert.equal(
        deltaText(events, 'response.reasoning_summary_text.delta'),
        FIXTURE_TEXT.summary,
      );
      assert.equal(deltaText(events, 'response.output_text.delta'), FIXTURE_TEXT.final);
      assert.equal(
        events.some((event) => event.type === 'response.reasoning_text.delta'),
        false,
      );
      assert.equal(
        events.some((event) => event.type.includes('reasoning_text')),
        false,
      );

      const reasoning = events.at(-1).response.output.find((item) => item.type === 'reasoning');
      assert.equal(reasoning.summary[0].text, FIXTURE_TEXT.summary);
      assert.equal('content' in reasoning, false);
    },
  );
});

test('an explicit port can be reused after the fixture closes', async () => {
  const metadataFile = `native-fixture-${process.pid}-restart.json`;
  const first = await startFixtureServer({
    fixture: 'both',
    port: 0,
    chunkDelayMs: 0,
    metadataFile,
  });
  const port = first.port;
  await requestEvents(first, `${first.baseUrl}/responses`);
  await first.close();

  const second = await startFixtureServer({
    fixture: 'raw-only',
    port,
    chunkDelayMs: 0,
    metadataFile,
  });
  try {
    assert.equal(second.port, port);
    assert.match(second.baseUrl, new RegExp(`:${port}/v1$`));
    const events = await requestEvents(second, `${second.baseUrl}/responses`);
    assert.equal(deltaText(events, 'response.reasoning_text.delta'), FIXTURE_TEXT.raw);
    assert.equal(
      events.some((event) => event.type.startsWith('response.reasoning_summary')),
      false,
    );
  } finally {
    await second.close();
  }
});

test('port validation accepts 0 through 65535 only', async () => {
  for (const port of [-1, 65536, 1.5, '55013']) {
    await assert.rejects(
      startFixtureServer({ port, metadataFile: `native-fixture-${process.pid}-invalid-port.json` }),
      /port must be an integer/,
    );
  }
});
test('metadata file names cannot escape the project .local directory', async () => {
  await assert.rejects(
    startFixtureServer({ metadataFile: '../escape.json', chunkDelayMs: 0 }),
    /metadataFile/,
  );
});
