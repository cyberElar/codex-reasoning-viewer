export function isDesktopProcessRunning(pid, { probe = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0xffffffff) {
    throw new RangeError('A positive 32-bit process ID is required');
  }

  try {
    probe(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    // EPERM means the process exists but cannot be inspected by this user.
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}
