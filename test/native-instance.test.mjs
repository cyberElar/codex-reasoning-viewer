import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { claimInstance, instancePipe, requestActivation } from '../src/native/instance.mjs';

test('a repeated launch signals one existing helper instead of starting a second helper', async () => {
  const project = 'viewer-instance-' + randomUUID();
  let activations = 0;
  const primary = await claimInstance(project, () => {
    activations++;
  });
  try {
    assert.ok(primary);
    assert.equal(
      await claimInstance(project, () => {
        throw new Error('The second helper must not become primary');
      }),
      null,
    );
    assert.equal(activations, 1);
    await requestActivation(primary.path);
    assert.equal(activations, 2);
  } finally {
    await primary?.close();
  }
});
test('closing the helper releases its activation channel', async () => {
  const project = 'viewer-instance-' + randomUUID();
  const first = await claimInstance(project, () => {});
  await first.close();
  const second = await claimInstance(project, () => {});
  try {
    assert.ok(second);
  } finally {
    await second.close();
  }
});
test('a package activation slower than two seconds receives its response', async () => {
  const project = 'viewer-instance-' + randomUUID();
  let completed = false;
  const primary = await claimInstance(project, async () => {
    await pause(2200);
    completed = true;
  });
  try {
    const response = await requestActivation(primary.path);
    assert.equal(completed, true);
    assert.equal(response.ok, true);
  } finally {
    await primary.close();
  }
});
test('a starting or closing helper reports not-ready without claiming activation', async () => {
  const project = 'viewer-instance-' + randomUUID();
  let ready = false,
    activations = 0;
  const primary = await claimInstance(project, () => {
    if (!ready) return false;
    activations++;
    return true;
  });
  try {
    const waiting = await requestActivation(primary.path);
    assert.equal(waiting.ok, false);
    assert.equal(waiting.reason, 'not-ready');
    assert.equal(activations, 0);
    ready = true;
    const active = await requestActivation(primary.path);
    assert.equal(active.ok, true);
    assert.equal(active.reason, undefined);
    assert.equal(activations, 1);
  } finally {
    await primary.close();
  }
});
test('the activation channel cannot execute an arbitrary command', async () => {
  const project = 'viewer-instance-' + randomUUID();
  let activations = 0;
  const primary = await claimInstance(project, () => {
    activations++;
  });
  try {
    const response = await new Promise((resolve, reject) => {
      const socket = createConnection(primary.path);
      let text = '';
      socket.on('error', reject);
      socket.on('connect', () =>
        socket.end(
          JSON.stringify({
            protocol: 'codex-reasoning-viewer',
            version: 1,
            command: 'run',
            args: ['untrusted'],
          }) + '\n',
        ),
      );
      socket.on('data', (chunk) => {
        text += chunk.toString('utf8');
      });
      socket.on('end', () => resolve(JSON.parse(text)));
    });
    assert.equal(response.ok, false);
    assert.equal(activations, 0);
  } finally {
    await primary.close();
  }
});
test('different project installations have distinct Windows activation channels', () => {
  const id = randomUUID();
  assert.notEqual(instancePipe(id + '-first'), instancePipe(id + '-second'));
  assert.ok(instancePipe(id).startsWith('\\\\.\\pipe\\codex-reasoning-viewer-'));
});
