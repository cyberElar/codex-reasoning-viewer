import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import {
  findInstallation,
  verifyInstallation,
  runningDesktopProcesses,
  powershell,
} from './installation.mjs';
import { managerCaptureSites } from './capture.mjs';
import { CdpConnection, listTargets } from './cdp.mjs';
import { attachViewer, isComposerPage } from './attach.mjs';
import { claimInstance } from './instance.mjs';
const project = resolve(import.meta.dirname, '../..'),
  statePath = join(project, '.local/native-launch/status.json');
async function save(state) {
  await mkdir(join(project, '.local/native-launch'), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({ observedAt: new Date().toISOString(), ...state }, null, 2),
  );
}
async function activate(installation) {
  const child = spawn(installation.executable, [], {
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}
async function hasActiveViewer(running) {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (
      !running.some((process) => process.ProcessId === state.pid) ||
      !Number.isInteger(state.port)
    )
      return false;
    const owners = await powershell(
      'Get-NetTCPConnection -State Listen -LocalPort ' +
        state.port +
        ' | Select-Object -ExpandProperty OwningProcess -Unique',
    );
    if (!owners.split(/\s+/).includes(String(state.pid))) return false;
    for (const target of (await listTargets(state.port)).filter(isComposerPage)) {
      const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
      try {
        if (
          await connection.evaluate(
            '!!window.__codexReasoningViewer&&!!window.__codexReasoningNativeAdapter',
          )
        )
          return true;
      } finally {
        connection.close();
      }
    }
  } catch {}
  return false;
}
async function run(installation, setReady) {
  const running = await runningDesktopProcesses();
  if (running.length) {
    await activate(installation);
    if (await hasActiveViewer(running)) {
      console.log('Codex is already running. Its current viewer and sessions were left active.');
      return;
    }
    const guard = await verifyInstallation(installation).catch(() => ({
      supported: false,
      reason: 'Unable to verify this desktop build',
    }));
    if (!guard.supported) {
      await save({ status: 'disabled-for-build', version: guard.version, reason: guard.reason });
      return;
    }
    await save({ status: 'requires-closed-desktop', version: guard.version });
    console.log(
      'Codex is already running without a viewer endpoint. Close it normally once, then use the new shortcut.',
    );
    process.exitCode = 3;
    return;
  }
  const guard = await verifyInstallation(installation).catch(() => ({
    supported: false,
    version: null,
    reason: 'Unable to verify renderer interface',
  }));
  if (!guard.supported) {
    await activate(installation);
    await save({ status: 'disabled-for-build', version: guard.version, reason: guard.reason });
    console.log('Viewer disabled for this desktop build. Codex started normally.');
    return;
  }
  const sites = await managerCaptureSites(installation.asar);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(
    installation.executable,
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { detached: true, windowsHide: false, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let exited = false,
    endpoint = null,
    tail = '',
    spawnError;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', (error) => {
    spawnError = error;
    exited = true;
  });
  // Read only the endpoint banner; no application log bodies are retained.
  child.stderr.on('data', (chunk) => {
    tail = (tail + chunk.toString('utf8')).slice(-8192);
    const match = tail.match(
      /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[\w-]+)/,
    );
    if (match) endpoint = { url: match[1], port: Number(match[2]) };
  });
  for (let i = 0; i < 150 && !endpoint && !exited; i++) await pause(200);
  if (spawnError) throw spawnError;
  if (!endpoint) {
    await save({ status: 'capture-unavailable', version: guard.version });
    child.stderr.destroy();
    child.unref();
    console.log('Codex started; native viewer could not obtain its temporary endpoint.');
    return;
  }
  try {
    const ownerText = await powershell(
      'Get-NetTCPConnection -State Listen -LocalPort ' +
        endpoint.port +
        ' | Select-Object -ExpandProperty OwningProcess -Unique',
    );
    if (!ownerText.split(/\s+/).includes(String(child.pid)))
      throw new Error('Unexpected endpoint owner');
  } catch {
    child.stderr.destroy();
    child.unref();
    await save({ status: 'endpoint-not-verified', version: guard.version });
    console.log('Codex started; viewer disabled because its endpoint could not be verified.');
    return;
  }
  const views = new Map();
  let stopping = false,
    lastState = null,
    lastSavedAt = 0;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  async function report(status, targets = [], error = null) {
    const state = {
      status,
      version: guard.version,
      pid: child.pid,
      helperPid: process.pid,
      port: endpoint.port,
      targets,
      ...(error ? { error } : {}),
    };
    const value = JSON.stringify(state),
      changedStatus = lastState?.status !== status;
    if (changedStatus || (value !== lastState?.value && Date.now() - lastSavedAt >= 5000)) {
      await save(state);
      lastState = { status, value };
      lastSavedAt = Date.now();
    }
  }
  const errorMessage = (error) => String(error?.message ?? error).slice(0, 240);
  setReady();
  await report('waiting-for-window');
  console.log(
    'Native reasoning viewer is connecting. See .local/native-launch/status.json for attachment and visibility.',
  );
  try {
    while (!stopping && !exited) {
      let targets;
      try {
        targets = await listTargets(endpoint.port);
      } catch (error) {
        await report('connection-unavailable', [], errorMessage(error));
        await pause(1000);
        continue;
      }
      const eligible = targets.filter(isComposerPage),
        ids = new Set(eligible.map((t) => t.id));
      const states = [];
      for (const [id, view] of views)
        if (!ids.has(id)) {
          await view.dispose();
          views.delete(id);
        }
      for (const target of eligible) {
        let view = views.get(target.id);
        if (!view) {
          try {
            view = await attachViewer(target, sites);
            views.set(target.id, view);
          } catch (error) {
            states.push({
              targetId: target.id,
              state: 'attachment-error',
              error: errorMessage(error),
            });
            continue;
          }
        }
        try {
          const state = await view.check();
          states.push({
            targetId: target.id,
            state:
              state.panel?.enabled === false
                ? 'hidden-by-user'
                : state.panel?.visible
                  ? 'visible'
                  : state.managerCount > 0
                    ? 'attached'
                    : 'waiting-for-manager',
            ...state,
          });
        } catch (error) {
          states.push({
            targetId: target.id,
            state: 'attachment-error',
            error: errorMessage(error),
          });
          await view.dispose();
          views.delete(target.id);
        }
      }
      const status = states.some((state) => state.state === 'visible')
        ? 'visible'
        : states.some((state) => state.state === 'hidden-by-user')
          ? 'hidden-by-user'
          : states.some((state) => state.state === 'attached')
            ? 'attached'
            : states.some((state) => state.state === 'waiting-for-manager')
              ? 'waiting-for-manager'
              : states.length
                ? 'attachment-error'
                : 'waiting-for-window';
      await report(status, states);
      await pause(1000);
    }
  } finally {
    for (const view of views.values()) await view.dispose();
    child.stderr.destroy();
    child.unref();
    await report(exited ? 'desktop-exited' : 'viewer-stopped');
  }
}
async function main() {
  const installation = await findInstallation();
  let ready = false;
  const instance = await claimInstance(project, async () => {
    if (ready) await activate(await findInstallation());
  });
  if (!instance) return;
  try {
    await run(installation, () => {
      ready = true;
    });
  } finally {
    await instance.close();
  }
}
main().catch(async (error) => {
  console.error(error.message);
  await save({ status: 'error', message: error.message }).catch(() => {});
  process.exitCode = 1;
});
