import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createSettingsStore, DEFAULT_SETTINGS } from '../src/control/settings.mjs';

const stdinListenersBeforeImport = process.stdin.listenerCount('data');
const { createControlServer, initializeControlSettings } =
  await import('../src/control/server.mjs');
const stdinListenersAfterImport = process.stdin.listenerCount('data');

const EXPECTED_TOOLS = [
  'viewer_show',
  'viewer_hide',
  'viewer_toggle',
  'viewer_status',
  'viewer_settings',
  'viewer_configure',
];
const prefix = join(resolve(tmpdir()), 'codex-reasoning-control-');
const roots = [];

async function temporaryStore() {
  const root = await mkdtemp(prefix);
  roots.push(root);
  return createSettingsStore(root);
}

test.after(async () => {
  for (const root of roots) {
    if (!resolve(root).startsWith(prefix)) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});

async function connectedPair(control, store) {
  store ??= await temporaryStore();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createControlServer(control, store);
  const client = new Client({ name: 'viewer-control-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    store,
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

test('SDK handshake exposes the visibility and settings tools', async () => {
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
    const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
    for (const name of [
      'viewer_show',
      'viewer_hide',
      'viewer_toggle',
      'viewer_status',
      'viewer_settings',
    ]) {
      const tool = tools.get(name);
      assert.equal(tool.inputSchema.type, 'object');
      assert.deepEqual(tool.inputSchema.properties, {});
      assert.deepEqual(tool.inputSchema.required, []);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal('outputSchema' in tool, false);
    }

    const configure = tools.get('viewer_configure');
    assert.equal(configure.inputSchema.type, 'object');
    assert.deepEqual(Object.keys(configure.inputSchema.properties), [
      'mode',
      'follow',
      'collapsed',
      'height',
      'indicatorColor',
    ]);
    assert.deepEqual(configure.inputSchema.properties.mode.enum, ['auto', 'summary', 'raw']);
    assert.equal(configure.inputSchema.properties.follow.type, 'boolean');
    assert.equal(configure.inputSchema.properties.collapsed.type, 'boolean');
    assert.equal(configure.inputSchema.properties.height.anyOf[0].minimum, 64);
    assert.equal(configure.inputSchema.properties.height.anyOf[0].maximum, 1600);
    assert.equal(configure.inputSchema.properties.height.anyOf[1].type, 'null');
    assert.match(configure.inputSchema.properties.indicatorColor.pattern, /auto/);
    assert.equal(configure.inputSchema.minProperties, 1);
    assert.equal(configure.inputSchema.additionalProperties, false);
    assert.equal('outputSchema' in configure, false);
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

test('viewer_settings reads defaults and accepts no arguments', async () => {
  const pair = await connectedPair(async () => ({ ok: true }));
  try {
    const result = await pair.client.callTool({ name: 'viewer_settings' });
    assert.deepEqual(textResult(result), { settings: DEFAULT_SETTINGS });

    const withArguments = await pair.client.callTool({
      name: 'viewer_settings',
      arguments: { mode: 'raw' },
    });
    assert.match(errorText(withArguments), /accepts no arguments/);
  } finally {
    await pair.close();
  }
});

test('viewer_configure saves settings and applies only the supplied runtime fields', async () => {
  const calls = [];
  const pair = await connectedPair(async (action, settings) => {
    calls.push({ action, settings });
    return { connected: true, enabled: true, windows: 1, partial: false };
  });
  try {
    const result = await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { mode: 'raw', height: 800 },
    });
    assert.deepEqual(textResult(result), {
      saved: true,
      settings: { ...DEFAULT_SETTINGS, mode: 'raw', height: 800 },
      connected: true,
      enabled: true,
      windows: 1,
      partial: false,
    });
    assert.deepEqual(calls, [
      {
        action: 'configure',
        settings: {
          mode: 'raw',
          height: 800,
        },
      },
    ]);

    const read = await pair.client.callTool({ name: 'viewer_settings' });
    assert.deepEqual(textResult(read), {
      settings: { ...DEFAULT_SETTINGS, mode: 'raw', height: 800 },
    });
  } finally {
    await pair.close();
  }
});

test('unrelated saved fields are not reapplied and explicit null resets height', async () => {
  const calls = [];
  const pair = await connectedPair(async (action, settings) => {
    calls.push(settings);
    return { connected: true, enabled: true, windows: 1, partial: false };
  });
  try {
    await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { follow: false },
    });
    assert.equal(Object.hasOwn(calls.at(-1), 'height'), false);

    await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { height: 900 },
    });
    assert.equal(calls.at(-1).height, 900);

    await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { indicatorColor: '#abc' },
    });
    assert.equal(Object.hasOwn(calls.at(-1), 'height'), false);
    assert.equal(calls.at(-1).indicatorColor, '#abc');
    assert.equal((await pair.store.read()).height, 900);

    await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { height: null },
    });
    assert.equal(Object.hasOwn(calls.at(-1), 'height'), true);
    assert.equal(calls.at(-1).height, null);

    await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { mode: 'summary' },
    });
    assert.equal(Object.hasOwn(calls.at(-1), 'height'), false);
  } finally {
    await pair.close();
  }
});

test('saving succeeds even when the viewer is disconnected', async () => {
  for (const { control, reason } of [
    {
      control: async () => ({ connected: false, reason: 'not-running' }),
      reason: 'not-running',
    },
    {
      control: async () => {
        throw new Error('sensitive-connection-detail');
      },
      reason: 'connection-unavailable',
    },
  ]) {
    const pair = await connectedPair(control);
    try {
      const result = await pair.client.callTool({
        name: 'viewer_configure',
        arguments: { collapsed: true },
      });
      const payload = textResult(result);
      assert.equal(payload.saved, true);
      assert.equal(payload.connected, false);
      assert.equal(payload.reason, reason);
      assert.equal(payload.settings.collapsed, true);
      assert.equal(payload.settings.height, null);
      assert.doesNotMatch(result.content[0].text, /sensitive-connection-detail/);
      assert.deepEqual(await pair.store.readSaved(), payload.settings);
    } finally {
      await pair.close();
    }
  }
});

test('invalid configure patches are rejected before the store or viewer runs', async () => {
  const calls = [];
  const pair = await connectedPair(async (action, settings) => {
    calls.push({ action, settings });
    return { connected: true, enabled: true };
  });
  try {
    for (const argumentsValue of [
      {},
      { unexpected: true },
      { mode: 'raw', unexpected: true },
      { mode: 'RAW' },
      { follow: 'false' },
      { collapsed: 1 },
      { height: 63 },
      { height: 1601 },
      { height: 64.5 },
      { height: '800' },
      { indicatorColor: 'red' },
      { indicatorColor: 'AUTO' },
      { indicatorColor: '#fff;background:url(javascript:alert(1))' },
    ]) {
      const result = await pair.client.callTool({
        name: 'viewer_configure',
        arguments: argumentsValue,
      });
      assert.match(errorText(result), /Invalid viewer settings/);
    }
    assert.deepEqual(calls, []);
    assert.equal(await pair.store.readSaved(), null);
  } finally {
    await pair.close();
  }
});

test('store failures use fixed model-safe errors', async () => {
  let calls = 0;
  const store = {
    async update() {
      throw new Error('sensitive-store-detail');
    },
    async read() {
      throw new Error('sensitive-store-detail');
    },
  };
  const pair = await connectedPair(async () => {
    calls++;
  }, store);
  try {
    const configure = await pair.client.callTool({
      name: 'viewer_configure',
      arguments: { mode: 'raw' },
    });
    assert.equal(errorText(configure), 'Viewer settings could not be saved.');

    const read = await pair.client.callTool({ name: 'viewer_settings' });
    assert.equal(errorText(read), 'Viewer settings are unavailable.');
    assert.doesNotMatch(configure.content[0].text, /sensitive-store-detail/);
    assert.doesNotMatch(read.content[0].text, /sensitive-store-detail/);
    assert.equal(calls, 0);
  } finally {
    await pair.close();
  }
});

test('initializeControlSettings applies startup environment through fixed configure', async () => {
  const store = await temporaryStore();
  await store.update({ follow: false, height: 900, indicatorColor: '#123' });
  const calls = [];
  const settings = await initializeControlSettings(
    async (action, value) => {
      calls.push({ action, value });
    },
    store,
    {
      CODEX_REASONING_MODE: 'summary',
      CODEX_REASONING_HEIGHT: 'auto',
    },
  );
  assert.deepEqual(settings, {
    mode: 'summary',
    follow: false,
    collapsed: false,
    height: null,
    indicatorColor: '#123',
  });
  assert.deepEqual(calls, [
    {
      action: 'configure',
      value: {
        mode: 'summary',
        follow: false,
        collapsed: false,
        height: null,
        indicatorColor: '#123',
      },
    },
  ]);

  calls.length = 0;
  await initializeControlSettings(async (action, value) => calls.push({ action, value }), store, {
    CODEX_REASONING_COLLAPSED: 'true',
  });
  assert.deepEqual(calls, [
    {
      action: 'configure',
      value: {
        mode: 'summary',
        follow: false,
        collapsed: true,
        indicatorColor: '#123',
      },
    },
  ]);
});

test('stdio emits only JSON-RPC protocol lines', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const collector = messageCollector(output);
  const server = createControlServer(
    async (action) => ({ ok: true, action }),
    await temporaryStore(),
  );
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
