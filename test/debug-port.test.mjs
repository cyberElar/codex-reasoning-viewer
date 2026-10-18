import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { allocateDebugPort, desktopDebugArguments } from '../src/native/debug-port.mjs';

function bindLoopback(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('allocated debug ports are valid and released before being returned', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await allocateDebugPort();
    assert.equal(Number.isInteger(port), true);
    assert.notEqual(port, 0);
    assert.ok(port >= 1 && port <= 65535, `expected a usable port, received ${port}`);

    const rebound = await bindLoopback(port);
    try {
      assert.equal(rebound.address().port, port);
    } finally {
      await closeServer(rebound);
    }
  }
});

test('a Codex launch never receives Chromium remote-debugging-port=0', async () => {
  const port = await allocateDebugPort();
  const args = desktopDebugArguments(port);
  assert.deepEqual(args, [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
  ]);
  assert.equal(args.includes('--remote-debugging-port=0'), false);
});

test('desktop debug arguments accept the full integer port range', () => {
  for (const port of [1, 9222, 65535]) {
    assert.deepEqual(desktopDebugArguments(port), [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
    ]);
  }
});

test('desktop debug arguments reject zero, out-of-range and non-integer numbers', () => {
  for (const port of [0, -1, -65536, 65536, 1.5, 65535.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => desktopDebugArguments(port), RangeError, `accepted ${String(port)}`);
  }
});

test('desktop debug arguments reject numeric strings instead of coercing them', () => {
  for (const port of ['0', '1', '9222', '65535']) {
    assert.throws(() => desktopDebugArguments(port), RangeError, `accepted "${port}"`);
  }
});
