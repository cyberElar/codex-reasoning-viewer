import { createServer } from 'node:net';

export async function allocateDebugPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback port was assigned');
    return address.port;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export function desktopDebugArguments(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new RangeError('An explicit nonzero debug port is required');
  // A literal port 0 makes Chromium mark an otherwise normal window as automated.
  return ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port];
}
