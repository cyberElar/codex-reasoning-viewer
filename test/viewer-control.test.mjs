import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerController } from '../src/control/viewer.mjs';

const port = 55123;
function page(id, overrides = {}) {
  return {
    id,
    type: 'page',
    url: 'app://-/index.html',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`,
    ...overrides,
  };
}
function fixture({ state = { pid: 123, port }, reason = null, pages = [page('first')] } = {}) {
  const calls = [],
    closed = [];
  const control = createViewerController({
    readState: async () => state,
    verify: async () => reason,
    targets: async () => pages,
    connect: async (url) => ({
      async evaluate(expression) {
        calls.push(expression);
        if (expression.includes('panel.configure(')) return true;
        return { enabled: true, reasoning: 'MUST_NOT_LEAVE_THE_RENDERER', threadId: 'PRIVATE' };
      },
      close() {
        closed.push(url);
      },
    }),
  });
  return { control, calls, closed };
}

test('status returns only control metadata and closes the connection', async () => {
  const { control, calls, closed } = fixture();
  assert.deepEqual(await control('status'), {
    connected: true,
    enabled: true,
    windows: 1,
    partial: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(closed.length, 1);
});

test('show, hide and toggle execute only a fixed visibility operation', async () => {
  for (const [action, expected] of [
    ['show', true],
    ['hide', false],
    ['toggle', false],
  ]) {
    const { control, calls, closed } = fixture();
    assert.equal((await control(action)).enabled, expected);
    assert.equal(calls[1], `window.__codexReasoningViewer.setEnabled(${expected});`);
    assert.equal(closed.length, 1);
  }
});

test('configure evaluates one fixed, validated panel.configure call', async () => {
  const { control, calls, closed } = fixture();
  assert.deepEqual(
    await control('configure', {
      mode: 'raw',
      follow: false,
      collapsed: true,
      height: null,
      indicatorColor: '#AbC',
    }),
    { connected: true, enabled: true, windows: 1, partial: false },
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /panel\.status\(\)/);
  assert.equal(
    calls[1],
    '(()=>{const panel=window.__codexReasoningViewer;if(typeof panel.configure!==\'function\')return false;panel.configure({"mode":"raw","follow":false,"collapsed":true,"height":null,"indicatorColor":"#AbC"});return true;})()',
  );
  assert.equal(
    calls.some((expression) => expression.includes('setEnabled')),
    false,
  );
  assert.equal(closed.length, 1);
});

test('invalid actions are rejected before any local state is read', async () => {
  let reads = 0;
  const control = createViewerController({
    readState: async () => {
      reads++;
    },
  });
  await assert.rejects(control('run arbitrary code'), /Unknown viewer/);
  assert.equal(reads, 0);
});

test('invalid configure patches are rejected before local state is read', async () => {
  for (const patch of [
    {},
    { unexpected: true },
    { mode: 'raw', unexpected: true },
    { mode: 'RAW' },
    { follow: 'false' },
    { height: 63 },
    { height: 1601 },
    { indicatorColor: 'red' },
    { indicatorColor: 'AUTO' },
    { indicatorColor: '#fff;background:url(javascript:alert(1))' },
    { indicatorColor: '#fff")+window.evil()+("' },
  ]) {
    let reads = 0;
    const control = createViewerController({
      readState: async () => {
        reads++;
      },
    });
    await assert.rejects(control('configure', patch), TypeError);
    assert.equal(reads, 0);
  }
});

test('unverified endpoints and missing startup state never reach a renderer', async () => {
  for (const reason of ['unsupported-build', 'endpoint-not-verified']) {
    const { control, calls } = fixture({ reason });
    assert.deepEqual(await control('hide'), { connected: false, reason });
    assert.equal(calls.length, 0);
  }
  const { control, calls } = fixture({ state: { pid: 123 } });
  assert.deepEqual(await control('show'), { connected: false, reason: 'launcher-required' });
  assert.equal(calls.length, 0);
});

test('remote debug URLs, overlays and unrelated pages are excluded', async () => {
  const pages = [
    page('remote', { webSocketDebuggerUrl: `ws://outside.example:${port}/devtools/page/remote` }),
    page('wrong-port', { webSocketDebuggerUrl: 'ws://127.0.0.1:42/devtools/page/wrong' }),
    page('overlay', { url: 'app://-/index.html?initialRoute=avatar-overlay' }),
    page('unrelated', { url: 'https://outside.example/' }),
  ];
  const { control, calls } = fixture({ pages });
  assert.deepEqual(await control('hide'), { connected: false, reason: 'viewer-not-attached' });
  assert.equal(calls.length, 0);
});

test('connections close when a visibility operation fails', async () => {
  let closed = 0;
  const control = createViewerController({
    readState: async () => ({ pid: 123, port }),
    verify: async () => null,
    targets: async () => [page('first')],
    connect: async () => ({
      async evaluate(expression) {
        if (expression.includes('setEnabled')) throw new Error('PRIVATE DEBUG DETAILS');
        return { enabled: true };
      },
      close() {
        closed++;
      },
    }),
  });
  assert.deepEqual(await control('hide'), { connected: false, reason: 'connection-unavailable' });
  assert.equal(closed, 1);
});

test('configure reports an old renderer without retrying or leaving connections open', async () => {
  let closed = 0;
  const calls = [];
  const control = createViewerController({
    readState: async () => ({ pid: 123, port }),
    verify: async () => null,
    targets: async () => [page('first'), page('second')],
    connect: async () => ({
      async evaluate(expression) {
        calls.push(expression);
        return expression.includes('panel.configure(') ? false : { enabled: true };
      },
      close() {
        closed++;
      },
    }),
  });
  assert.deepEqual(await control('configure', { follow: false }), {
    connected: false,
    reason: 'viewer-update-required',
  });
  assert.equal(calls.filter((expression) => expression.includes('panel.configure(')).length, 1);
  assert.equal(closed, 2);
});
