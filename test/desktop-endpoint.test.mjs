import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { allocateDebugPort } from '../src/native/debug-port.mjs';
import { waitForDesktopEndpoint } from '../src/native/desktop-endpoint.mjs';

const PID = 4242;
const PORT = 9333;

function fakeClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
    get value() {
      return value;
    },
  };
}

function recordingDependencies() {
  const calls = { now: 0, isRunning: 0, readOwners: 0, wait: 0 };
  return {
    calls,
    options: {
      now: () => {
        calls.now++;
        return 0;
      },
      isRunning: () => {
        calls.isRunning++;
        return true;
      },
      readOwners: async () => {
        calls.readOwners++;
        return [];
      },
      wait: async () => {
        calls.wait++;
      },
    },
  };
}

test('waits for delayed listener ownership by the activated process', async () => {
  const clock = fakeClock();
  const ports = [];
  const waits = [];
  const ownerReads = [[], [], [PID]];

  const result = await waitForDesktopEndpoint(PID, PORT, {
    readOwners: async (port) => {
      ports.push(port);
      return ownerReads.shift() ?? [PID];
    },
    isRunning: () => true,
    wait: async (ms) => {
      waits.push(ms);
      clock.advance(ms);
    },
    now: clock.now,
    timeoutMs: 2000,
    pollMs: 125,
  });

  assert.equal(result, true);
  assert.deepEqual(ports, [PORT, PORT, PORT]);
  assert.deepEqual(waits, [125, 125]);
  assert.equal(clock.value, 250);
});

test('rejects foreign ownership even when the activated process is also listed', async () => {
  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => [PID + 100, PID],
        isRunning: () => true,
        wait: async () => {},
        now: () => 0,
      }),
    /Unexpected endpoint owner/,
  );
});

test('fails immediately when a listener is owned by another process', async () => {
  let reads = 0;
  let waits = 0;

  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => {
          reads++;
          return reads === 1 ? [PID + 1] : [PID];
        },
        isRunning: () => true,
        wait: async () => {
          waits++;
        },
        now: () => 0,
      }),
    (error) => error instanceof Error && error.message === 'Unexpected endpoint owner',
  );

  assert.equal(reads, 1, 'should not retry after observing a foreign owner');
  assert.equal(waits, 0, 'should not wait after observing a foreign owner');
});

test('returns false when no listener appears before the default timeout', async () => {
  const clock = fakeClock();
  const waits = [];
  let reads = 0;

  const result = await waitForDesktopEndpoint(PID, PORT, {
    readOwners: async () => {
      reads++;
      return [];
    },
    isRunning: () => true,
    wait: async (ms) => {
      waits.push(ms);
      clock.advance(ms);
    },
    now: clock.now,
  });

  assert.equal(result, false);
  assert.ok(waits.length > 1, `expected repeated polling, saw ${waits.length} waits`);
  assert.equal(
    waits.every((ms) => ms === 200),
    true,
    'default poll interval should be 200ms',
  );
  assert.ok(waits.length <= 151, `expected a bounded wait count, saw ${waits.length}`);
  assert.ok(clock.value >= 30000, `stopped before the default 30s timeout at ${clock.value}ms`);
  assert.ok(clock.value <= 30200, `overshot the default timeout at ${clock.value}ms`);
  assert.ok(reads >= 150 && reads <= 151, `expected 150-151 owner reads, saw ${reads}`);
});

test('returns false without reading owners when the process already exited', async () => {
  let reads = 0;
  let waits = 0;

  const result = await waitForDesktopEndpoint(PID, PORT, {
    readOwners: async () => {
      reads++;
      return [];
    },
    isRunning: () => false,
    wait: async () => {
      waits++;
    },
    now: () => 0,
  });

  assert.equal(result, false);
  assert.equal(reads, 0, 'should probe process liveness before the listener');
  assert.equal(waits, 0);
});

test('stops probing once the process exits while waiting', async () => {
  const clock = fakeClock();
  let reads = 0;
  let waits = 0;
  let running = true;

  const result = await waitForDesktopEndpoint(PID, PORT, {
    readOwners: async () => {
      reads++;
      return [];
    },
    isRunning: () => running,
    wait: async (ms) => {
      waits++;
      clock.advance(ms);
      running = false;
    },
    now: clock.now,
    timeoutMs: 5000,
    pollMs: 50,
  });

  assert.equal(result, false);
  assert.equal(reads, 1, 'should not read owners again after the process exits');
  assert.equal(waits, 1);
});

test('rejects invalid process IDs and ports before calling any dependency', async () => {
  const invalidPids = [
    0,
    -0,
    -1,
    1.5,
    0x100000000,
    NaN,
    Infinity,
    -Infinity,
    '4242',
    null,
    undefined,
    4242n,
  ];
  const invalidPorts = [
    0,
    -0,
    -1,
    65536,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    '9333',
    null,
    undefined,
    9333n,
  ];

  for (const pid of invalidPids) {
    const { calls, options } = recordingDependencies();
    await assert.rejects(
      () => waitForDesktopEndpoint(pid, PORT, options),
      RangeError,
      `accepted process ID ${String(pid)}`,
    );
    assert.deepEqual(calls, { now: 0, isRunning: 0, readOwners: 0, wait: 0 });
  }

  for (const port of invalidPorts) {
    const { calls, options } = recordingDependencies();
    await assert.rejects(
      () => waitForDesktopEndpoint(PID, port, options),
      RangeError,
      `accepted port ${String(port)}`,
    );
    assert.deepEqual(calls, { now: 0, isRunning: 0, readOwners: 0, wait: 0 });
  }
});

test('propagates dependency failures unchanged', async () => {
  const ownerFailure = new Error('owner lookup failed');
  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => {
          throw ownerFailure;
        },
        isRunning: () => true,
        wait: async () => {},
        now: () => 0,
      }),
    (error) => error === ownerFailure,
  );

  const processFailure = new Error('process lookup failed');
  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => [],
        isRunning: () => {
          throw processFailure;
        },
        wait: async () => {},
        now: () => 0,
      }),
    (error) => error === processFailure,
  );

  const waitFailure = new Error('wait failed');
  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => [],
        isRunning: () => true,
        wait: async () => {
          throw waitFailure;
        },
        now: () => 0,
      }),
    (error) => error === waitFailure,
  );

  const clockFailure = new Error('clock failed');
  await assert.rejects(
    () =>
      waitForDesktopEndpoint(PID, PORT, {
        readOwners: async () => [],
        isRunning: () => true,
        wait: async () => {},
        now: () => {
          throw clockFailure;
        },
      }),
    (error) => error === clockFailure,
  );
});

test('Windows listener discovery verifies an owned live loopback socket', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  try {
    assert.equal(await waitForDesktopEndpoint(process.pid, server.address().port), true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('Windows listener discovery returns false when the port has no listener', async () => {
  const port = await allocateDebugPort();
  assert.equal(await waitForDesktopEndpoint(process.pid, port, { timeoutMs: 500 }), false);
});
