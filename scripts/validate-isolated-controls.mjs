import { spawn, execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';

const project = resolve(import.meta.dirname, '..');
const candidates = [
  process.env['ProgramFiles(x86)'],
  process.env.ProgramFiles,
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((root) => join(root, 'Microsoft/Edge/Application/msedge.exe'));
let executable;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executable = candidate;
    break;
  } catch {}
}
if (!executable) throw new Error('Microsoft Edge is required for the isolated controls check');
const temporaryRoot = resolve(tmpdir()),
  profile = await mkdtemp(join(temporaryRoot, 'crv-controls-'));
const child = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--disable-background-networking',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let port = null,
  startupError = null;
child.once('error', (error) => {
  startupError = error;
});
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error('The isolated browser exited before startup');
    try {
      const value = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const candidate = Number(value.split(/\r?\n/)[0]);
      if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) {
        port = candidate;
        break;
      }
    } catch {}
    await wait(100);
  }
  if (!port) throw new Error('The isolated browser did not open its debugging endpoint');
  const result = await promisify(execFile)(
    process.execPath,
    [
      join(
        project,
        'scripts',
        process.argv.includes('--composer')
          ? 'validate-native-composer.mjs'
          : 'validate-native-controls.mjs',
      ),
      String(port),
      '--isolated-browser',
    ],
    { cwd: project, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  process.stdout.write(result.stdout);
} finally {
  if (port) {
    let connection;
    try {
      const target = (await listTargets(port)).find(
        (target) => target.type === 'page' && target.url === 'about:blank',
      );
      if (target) {
        connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
        await connection.send('Browser.close', {}, 3000);
      }
    } catch {
    } finally {
      connection?.close();
    }
  }
  if (child.exitCode === null && child.pid) child.kill();
  for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt++) await wait(100);
  if (
    dirname(profile).toLowerCase() === temporaryRoot.toLowerCase() &&
    basename(profile).startsWith('crv-controls-')
  )
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
