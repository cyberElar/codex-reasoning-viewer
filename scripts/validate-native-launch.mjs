import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { allocateDebugPort, desktopDebugArguments } from '../src/native/debug-port.mjs';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';
import { waitForDesktopEndpoint } from '../src/native/desktop-endpoint.mjs';

const temporaryRoot = resolve(tmpdir());
const project = resolve(import.meta.dirname, '..');
const candidates = [
  process.env['ProgramFiles(x86)'],
  process.env.ProgramFiles,
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((root) => join(root, 'Microsoft/Edge/Application/msedge.exe'));
let edge;
for (const candidate of candidates) {
  try {
    await access(candidate);
    edge = candidate;
    break;
  } catch {}
}
if (!edge) throw new Error('Microsoft Edge is required for the isolated launch check');

async function compareStartup(legacy) {
  const profile = await mkdtemp(join(temporaryRoot, 'crv-launch-proof-'));
  let child, connection, startupError, closed, report;
  const errors = [];
  const hasExited = () =>
    child.exitCode !== null || child.signalCode !== null || startupError !== undefined;
  const waitForExit = (timeoutMs) =>
    Promise.race([closed.then(() => true), wait(timeoutMs, false, { ref: false })]);
  try {
    const expectedPort = legacy ? 0 : await allocateDebugPort();
    const args = legacy
      ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0']
      : desktopDebugArguments(expectedPort);
    // Headless mode itself enables automation; these owned blank windows stay off screen.
    child = spawn(
      edge,
      [
        '--no-first-run',
        '--disable-background-networking',
        '--window-position=-32000,-32000',
        '--window-size=320,240',
        '--user-data-dir=' + profile,
        ...args,
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    closed = new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', (error) => {
        startupError = error;
        resolve();
      });
    });
    let port = expectedPort;
    for (let attempt = 0; !port && attempt < 150; attempt++) {
      if (startupError) throw startupError;
      assert.equal(hasExited(), false, 'the owned browser must remain running');
      try {
        const value = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
        port = Number(value.split(/\r?\n/)[0]);
      } catch {}
      if (!port) await wait(100);
    }
    if (startupError) throw startupError;
    assert.ok(port, 'the owned browser must publish its selected port');
    assert.equal(
      await waitForDesktopEndpoint(child.pid, port),
      true,
      'the owned browser must own the loopback listener before any CDP request',
    );
    let target;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (startupError) throw startupError;
      assert.equal(hasExited(), false, 'the owned browser must remain running');
      try {
        target = (await listTargets(port)).find(
          (candidate) => candidate.type === 'page' && candidate.url === 'about:blank',
        );
        if (target) break;
      } catch {}
      await wait(100);
    }
    assert.ok(target, 'the isolated blank browser must open its own endpoint');
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    const result = await connection.evaluate(
      '({webdriver:navigator.webdriver,userAgent:navigator.userAgent,url:location.href})',
    );
    assert.equal(result.url, 'about:blank');
    assert.equal(result.webdriver, legacy);
    report = { mode: legacy ? 'legacy-port-zero' : 'explicit-nonzero-port', port, ...result };
  } catch (error) {
    errors.push(error);
  } finally {
    await connection?.send('Browser.close', {}, 3000).catch(() => {});
    connection?.close();
    try {
      if (child && !hasExited() && !(await waitForExit(3000))) {
        const terminated = child.kill();
        assert.ok(terminated || hasExited(), 'the owned browser must accept termination');
        assert.ok(await waitForExit(5000), 'the owned browser must exit before profile cleanup');
      }
      assert.ok(
        dirname(profile).toLowerCase() === temporaryRoot.toLowerCase() &&
          basename(profile).startsWith('crv-launch-proof-'),
        'the cleanup target must be an owned profile directly under the temporary directory',
      );
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'The isolated browser comparison failed');
  return report;
}

const reports = [];
for (const legacy of [true, false]) reports.push(await compareStartup(legacy));
const output = join(project, '.local/native-runtime');
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'native-launch-regression.json'),
  JSON.stringify({ passed: true, reports }, null, 2),
);
console.log(JSON.stringify({ passed: true, reports }, null, 2));
