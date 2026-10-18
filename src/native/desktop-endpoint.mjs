import { setTimeout as pause } from 'node:timers/promises';
import { powershell } from './installation.mjs';
import { isDesktopProcessRunning } from './desktop-process.mjs';

async function loopbackOwners(port) {
  const output = await powershell(
    `Get-NetTCPConnection -LocalAddress 127.0.0.1 -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
  );
  return output.split(/\s+/).filter(Boolean).map(Number);
}

export async function waitForDesktopEndpoint(
  pid,
  port,
  {
    readOwners = loopbackOwners,
    isRunning = isDesktopProcessRunning,
    wait = pause,
    now = Date.now,
    timeoutMs = 30000,
    pollMs = 200,
  } = {},
) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0xffffffff)
    throw new RangeError('A valid desktop PID is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new RangeError('An explicit nonzero debug port is required');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isRunning(pid)) return false;
    const owners = await readOwners(port);
    if (owners.some((owner) => owner !== pid)) throw new Error('Unexpected endpoint owner');
    if (owners.includes(pid)) return true;
    await wait(pollMs);
  }
  return false;
}
