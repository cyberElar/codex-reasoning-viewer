import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { findInstallation, verifyInstallation, runningDesktopProcesses } from './installation.mjs';
import { managerCaptureSites } from './capture.mjs';
import { listTargets } from './cdp.mjs';
import { attachViewer, isComposerPage } from './attach.mjs';
import { claimInstance } from './instance.mjs';
import { allocateDebugPort, desktopDebugArguments } from './debug-port.mjs';
import { activatePackagedDesktop, inspectPackageIdentity } from './windows-activation.mjs';
import { isDesktopProcessRunning } from './desktop-process.mjs';
import { waitForDesktopEndpoint } from './desktop-endpoint.mjs';
const project = resolve(import.meta.dirname, '../..'),
  statePath = join(project, '.local/native-launch/status.json');
const errorMessage = (error) => String(error?.message ?? error).slice(0, 240);
async function save(state) {
  await mkdir(join(project, '.local/native-launch'), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({ observedAt: new Date().toISOString(), ...state }, null, 2),
  );
}
async function activate(installation) {
  return activatePackagedDesktop(installation.applicationId);
}
async function run(installation, setReady) {
  const running = await runningDesktopProcesses();
  if (running.length) {
    // Healthy helpers receive repeat launches over their pipe before run() is entered.
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
      'Codex is already running without this helper. Close it normally once, then use the new shortcut.',
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
  const debugPort = await allocateDebugPort();
  const pid = await activatePackagedDesktop(
    installation.applicationId,
    desktopDebugArguments(debugPort),
  );
  let identity;
  try {
    identity = await inspectPackageIdentity(pid);
  } catch (error) {
    await save({
      status: 'package-identity-not-verified',
      version: guard.version,
      pid,
      reason: errorMessage(error),
    });
    console.log('Viewer disabled because the activated process identity could not be inspected.');
    return;
  }
  if (!identity.packaged || identity.packageFullName !== installation.packageFullName) {
    await save({ status: 'package-identity-not-verified', version: guard.version, pid });
    console.log(
      'Codex started; viewer disabled because its package identity could not be verified.',
    );
    return;
  }
  try {
    if (!(await waitForDesktopEndpoint(pid, debugPort))) {
      const alive = isDesktopProcessRunning(pid);
      await save({
        status: alive ? 'capture-unavailable' : 'startup-exited',
        version: guard.version,
        pid,
        port: debugPort,
      });
      console.log(
        alive
          ? 'Codex started; native viewer could not obtain its temporary endpoint.'
          : 'Codex exited before its viewer endpoint became available.',
      );
      if (!alive) process.exitCode = 1;
      return;
    }
  } catch (error) {
    await save({
      status: 'endpoint-not-verified',
      version: guard.version,
      pid,
      port: debugPort,
      reason: errorMessage(error),
    });
    console.log('Codex started; viewer disabled because its endpoint could not be verified.');
    return;
  }
  const endpoint = { port: debugPort };
  const views = new Map();
  let exited = false,
    stopping = false,
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
      pid,
      helperPid: process.pid,
      port: endpoint.port,
      launchMethod: 'package-activation',
      packageFullName: identity.packageFullName,
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
  setReady(pid);
  await report('waiting-for-window');
  console.log(
    'Native reasoning viewer is connecting. See .local/native-launch/status.json for attachment and visibility.',
  );
  try {
    while (!stopping && !exited) {
      if (!isDesktopProcessRunning(pid)) {
        exited = true;
        break;
      }
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
    setReady(null);
    for (const view of views.values()) await view.dispose();
    await report(exited ? 'desktop-exited' : 'viewer-stopped');
  }
}
async function main() {
  const installation = await findInstallation();
  let activePid = null;
  const instance = await claimInstance(project, async () => {
    if (activePid && isDesktopProcessRunning(activePid)) await activate(installation);
  });
  if (!instance) return;
  try {
    await run(installation, (pid) => {
      activePid = pid;
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
