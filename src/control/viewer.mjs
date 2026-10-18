import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection, listTargets } from '../native/cdp.mjs';
import { isComposerPage } from '../native/attach.mjs';
import {
  findInstallation,
  verifyInstallation,
  runningDesktopProcesses,
  powershell,
} from '../native/installation.mjs';

const project = resolve(import.meta.dirname, '../..');
const actions = new Set(['status', 'show', 'hide', 'toggle']);
const statusExpression = `(()=>{
  const panel=window.__codexReasoningViewer;
  if(!panel||!window.__codexReasoningNativeAdapter)return null;
  return{enabled:panel.status().enabled===true};
})()`;

async function verifyEndpoint(state) {
  const installation = await findInstallation();
  if (!(await verifyInstallation(installation)).supported) return 'unsupported-build';
  const running = await runningDesktopProcesses();
  if (!running.some((process) => process.ProcessId === state.pid)) return 'endpoint-not-verified';
  const owners = await powershell(
    `Get-NetTCPConnection -State Listen -LocalPort ${state.port} | Select-Object -ExpandProperty OwningProcess -Unique`,
  );
  return owners.split(/\s+/).includes(String(state.pid)) ? null : 'endpoint-not-verified';
}

function localTarget(target, port) {
  if (!isComposerPage(target)) return false;
  try {
    const url = new URL(target.webSocketDebuggerUrl);
    return (
      url.protocol === 'ws:' &&
      url.hostname === '127.0.0.1' &&
      Number(url.port) === port &&
      url.pathname.startsWith('/devtools/page/')
    );
  } catch {
    return false;
  }
}

export function createViewerController({
  readState = async () =>
    JSON.parse(await readFile(resolve(project, '.local/native-launch/status.json'), 'utf8')),
  verify = verifyEndpoint,
  targets = listTargets,
  connect = (url) => CdpConnection.connect(url),
} = {}) {
  return async function control(action) {
    if (!actions.has(action)) throw new TypeError('Unknown viewer control action');
    let state;
    try {
      state = await readState();
    } catch {
      return { connected: false, reason: 'not-running' };
    }
    if (
      !Number.isInteger(state?.pid) ||
      state.pid < 1 ||
      !Number.isInteger(state.port) ||
      state.port < 1 ||
      state.port > 65535
    )
      return { connected: false, reason: 'launcher-required' };

    const connections = [];
    let failures = 0;
    try {
      const reason = await verify(state);
      if (reason) return { connected: false, reason };
      const inventory = await targets(state.port);
      for (const target of inventory.filter((target) => localTarget(target, state.port))) {
        let connection;
        try {
          connection = await connect(target.webSocketDebuggerUrl);
          const panel = await connection.evaluate(statusExpression);
          if (typeof panel?.enabled !== 'boolean') {
            connection.close();
            continue;
          }
          connections.push({ connection, enabled: panel.enabled });
        } catch {
          connection?.close();
          failures++;
        }
      }
      if (!connections.length) return { connected: false, reason: 'viewer-not-attached' };
      let enabled = connections.some((entry) => entry.enabled);
      if (action !== 'status') {
        enabled = action === 'toggle' ? !enabled : action === 'show';
        for (const entry of connections) {
          await entry.connection.evaluate(
            `window.__codexReasoningViewer.setEnabled(${enabled ? 'true' : 'false'});`,
          );
        }
      }
      return { connected: true, enabled, windows: connections.length, partial: failures > 0 };
    } catch {
      return { connected: false, reason: 'connection-unavailable' };
    } finally {
      for (const entry of connections) entry.connection.close();
    }
  };
}

export const controlViewer = createViewerController();
