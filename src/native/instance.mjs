import { createHash } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const protocol = 'codex-reasoning-viewer',
  version = 1,
  activationTimeoutMs = 10000;
export function instancePipe(project) {
  const identity = homedir().toLowerCase() + '\0' + resolve(project).toLowerCase();
  return (
    '\\\\.\\pipe\\codex-reasoning-viewer-' +
    createHash('sha256').update(identity).digest('hex').slice(0, 24)
  );
}
export async function requestActivation(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '',
      complete = false;
    const finish = (error, value) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(activationTimeoutMs, () => finish(new Error('Viewer activation timed out')));
    socket.on('error', (error) => finish(error));
    socket.on('connect', () =>
      socket.write(JSON.stringify({ protocol, version, command: 'activate' }) + '\n'),
    );
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.length > 1024) return finish(new Error('Invalid viewer activation response'));
      if (!data.includes('\n')) return;
      try {
        const response = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (
          response.protocol !== protocol ||
          response.version !== version ||
          (response.ok !== true && !(response.ok === false && response.reason === 'not-ready'))
        )
          throw new Error('The viewer activation service rejected the request');
        finish(null, response);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('end', () => finish(new Error('Viewer activation closed without a response')));
  });
}
export async function claimInstance(project, onActivate) {
  const path = instancePipe(project);
  const server = createServer((socket) => {
    let data = '',
      handled = false;
    socket.setTimeout(activationTimeoutMs, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async (chunk) => {
      if (handled) return;
      data += chunk.toString('utf8');
      if (data.length > 1024) {
        handled = true;
        socket.destroy();
        return;
      }
      if (!data.includes('\n')) return;
      handled = true;
      let ok = false,
        reason;
      try {
        const request = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (
          request.protocol === protocol &&
          request.version === version &&
          request.command === 'activate'
        ) {
          ok = (await onActivate()) !== false;
          if (!ok) reason = 'not-ready';
        }
      } catch {}
      socket.end(JSON.stringify({ protocol, version, ok, ...(reason ? { reason } : {}) }) + '\n');
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ path, readableAll: false, writableAll: false }, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    await requestActivation(path);
    return null;
  }
  return { path, close: () => new Promise((resolve) => server.close(resolve)) };
}
