import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { isDesktopProcessRunning } from '../src/native/desktop-process.mjs';

function probeThrowing(code) {
  return () => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
}

test('existence checks probe with signal 0 only at the PID range boundaries', () => {
  const calls = [];
  const probe = (...args) => {
    calls.push(args);
    return true;
  };
  for (const pid of [1, 4321, 0xffffffff]) {
    assert.equal(isDesktopProcessRunning(pid, { probe }), true);
  }
  assert.deepEqual(calls, [
    [1, 0],
    [4321, 0],
    [0xffffffff, 0],
  ]);
});

test('unsafe process IDs are rejected before probing', () => {
  let probes = 0;
  const probe = () => {
    probes++;
  };
  for (const pid of [
    0,
    -0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    0x100000000,
    '123',
    null,
    undefined,
    1n,
  ]) {
    assert.throws(
      () => isDesktopProcessRunning(pid, { probe }),
      RangeError,
      `accepted ${String(pid)}`,
    );
  }
  assert.equal(probes, 0);
});

test('ESRCH means stopped while EPERM means still running', () => {
  assert.equal(isDesktopProcessRunning(1234, { probe: probeThrowing('ESRCH') }), false);
  assert.equal(isDesktopProcessRunning(1234, { probe: probeThrowing('EPERM') }), true);
});

test('unexpected probe failures are rethrown unchanged', () => {
  for (const code of ['EINVAL', 'ENOSYS', undefined]) {
    const failure = new Error('probe failed');
    if (code) failure.code = code;
    assert.throws(
      () =>
        isDesktopProcessRunning(1234, {
          probe: () => {
            throw failure;
          },
        }),
      (error) => error === failure,
    );
  }
});

test('the current process is reported as running', () => {
  assert.equal(isDesktopProcessRunning(process.pid), true);
});

test('a naturally exited child is reported as stopped', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10)'], {
    stdio: 'ignore',
  });
  assert.equal(Number.isInteger(child.pid), true);
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);

  const deadline = Date.now() + 5000;
  while (isDesktopProcessRunning(child.pid) && Date.now() < deadline) {
    await delay(25);
  }
  assert.equal(
    isDesktopProcessRunning(child.pid),
    false,
    'naturally exited child still appears to be running',
  );
});
