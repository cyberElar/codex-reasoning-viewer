import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const stdinListenersBeforeImport = process.stdin.listenerCount('data');
const { createControlServer } = await import('../src/control/server.mjs');
const stdinListenersAfterImport = process.stdin.listenerCount('data');

const EXPECTED_TOOLS = ['viewer_show', 'viewer_hide', 'viewer_toggle', 'viewer_status'];

async function connectedPair(control) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createControlServer(control);
  const client = new Client({ name: 'viewer-control-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

function textResult(result) {
  assert.equal(result.isError === true, false);
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

function errorText(result) {
  assert.equal(result.isError, true);
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

function messageCollector(stream) {
  const messages = [];
  const waiters = new Set();
  let buffer = '';
  let parseError = null;

  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        messages.push(message);
        for (const waiter of [...waiters]) {
          if (!waiter.predicate(message)) continue;
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      } catch (error) {
        parseError = error;
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        waiters.clear();
      }
    }
  });

  return {
    messages,
    waitFor(predicate, timeout = 2000) {
      if (parseError) return Promise.reject(parseError);
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for MCP stdio response'));
        }, timeout);
        waiters.add(waiter);
      });
    },
    get parseError() {
      return parseError;
    },
  };
}

test('module import does not attach the stdio transport', () => {
  assert.equal(stdinListenersAfterImport, stdinListenersBeforeImport);
});

test('SDK handshake exposes only the four zero-argument viewer tools', async () => {
  const pair = await connectedPair(async (action) => ({ ok: true, action }));
  try {
    assert.equal(pair.client.getServerVersion()?.name, 'codex-reasoning-viewer-control');
    const capabilities = pair.client.getServerCapabilities();
    assert.deepEqual(capabilities?.tools, {});
    assert.equal(capabilities?.resources, undefined);
    assert.equal(capabilities?.prompts, undefined);

    const result = await pair.client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      EXPECTED_TOOLS,
    );
    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.deepEqual(tool.inputSchema.properties, {});
      assert.deepEqual(tool.inputSchema.required, []);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal('outputSchema' in tool, false);
    }
  } finally {
    await pair.close();
  }
});

test('each tool invokes exactly its fixed control action', async () => {
  const calls = [];
  const pair = await connectedPair(async (action) => {
    calls.push(action);
    return { ok: true, action, visible: action !== 'hide' };
  });
  try {
    const expected = new Map([
      ['viewer_show', 'show'],
      ['viewer_hide', 'hide'],
      ['viewer_toggle', 'toggle'],
      ['viewer_status', 'status'],
    ]);
    for (const [name, action] of expected) {
      const result = await pair.client.callTool({
        name,
        arguments: name === 'viewer_show' ? {} : undefined,
      });
      assert.deepEqual(textResult(result), {
        ok: true,
        action,
        visible: action !== 'hide',
      });
    }
    assert.deepEqual(calls, ['show', 'hide', 'toggle', 'status']);
  } finally {
    await pair.close();
  }
});

test('unknown tools and non-empty arguments are rejected before control runs', async () => {
  let calls = 0;
  const pair = await connectedPair(async () => {
    calls++;
    return { ok: true };
  });
  try {
    const unknown = await pair.client.callTool({
      name: 'viewer_open',
      arguments: {},
    });
    assert.match(errorText(unknown), /Unknown viewer control tool/);

    const invalid = await pair.client.callTool({
      name: 'viewer_show',
      arguments: { unexpected: true },
    });
    assert.match(errorText(invalid), /accept no arguments/);
    assert.equal(calls, 0);
  } finally {
    await pair.close();
  }
});

test('control failures are replaced with a fixed model-safe error', async () => {
  const pair = await connectedPair(async () => {
    throw new Error('sensitive-control-detail');
  });
  try {
    const result = await pair.client.callTool({ name: 'viewer_show' });
    assert.equal(errorText(result), 'Viewer control is unavailable.');
    assert.doesNotMatch(result.content[0].text, /sensitive-control-detail/);
  } finally {
    await pair.close();
  }
});

test('stdio emits only JSON-RPC protocol lines', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const collector = messageCollector(output);
  const server = createControlServer(async (action) => ({ ok: true, action }));
  const transport = new StdioServerTransport(input, output);

  try {
    await server.connect(transport);
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'stdio-test', version: '1.0.0' },
        },
      })}\n`,
    );

    const initialized = await collector.waitFor((message) => message.id === 1);
    assert.equal(initialized.result.serverInfo.name, 'codex-reasoning-viewer-control');

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      })}\n`,
    );
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })}\n`,
    );

    const listed = await collector.waitFor((message) => message.id === 2);
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      EXPECTED_TOOLS,
    );
    assert.equal(collector.parseError, null);
    assert.ok(collector.messages.length >= 2);
    for (const message of collector.messages) {
      assert.equal(message.jsonrpc, '2.0');
      assert.ok('id' in message || 'method' in message);
    }
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
    input.end();
    output.end();
  }
});
