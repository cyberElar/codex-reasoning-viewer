import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection } from './cdp.mjs';
import { armManagerCapture } from './capture.mjs';
import { readSkillBindings } from './skill-bindings.mjs';
import { createSettingsStore, startupSettings } from '../control/settings.mjs';
export async function attachViewer(target, sites) {
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
  let releaseCapture = null,
    disposed = false,
    lastBindings = null,
    lastSettings = null;
  const project = resolve(import.meta.dirname, '../..');
  const settingsStore = createSettingsStore(project);
  async function refreshBindings() {
    const value = JSON.stringify(await readSkillBindings(project));
    if (value !== lastBindings) {
      await connection.evaluate(`window.__codexReasoningControls?.setSkillPaths?.(${value})`);
      lastBindings = value;
    }
  }
  async function refreshSettings() {
    let settings;
    try {
      settings = await settingsStore.read();
    } catch {
      return;
    }
    const value = JSON.stringify(settings);
    if (value === lastSettings) return;
    const previous = lastSettings ? JSON.parse(lastSettings) : null;
    const patch = previous
      ? Object.fromEntries(
          Object.entries(settings).filter(([name, value]) => value !== previous[name]),
        )
      : startupSettings(settings);
    if (Object.keys(patch).length)
      await connection.evaluate(
        `window.__codexReasoningViewer?.configure?.(${JSON.stringify(patch)})`,
      );
    lastSettings = value;
  }
  const [panelSource, resizeSource, controlsSource, adapterSource] = await Promise.all(
    ['panel.js', 'resize.js', 'controls.js', 'adapter.js'].map((name) =>
      readFile(new URL(name, import.meta.url), 'utf8'),
    ),
  );
  async function initialize() {
    if (releaseCapture) {
      await releaseCapture();
      releaseCapture = null;
    }
    await connection.evaluate(panelSource);
    await connection.evaluate(resizeSource);
    await connection.evaluate(controlsSource);
    lastBindings = null;
    await refreshBindings();
    lastSettings = null;
    await refreshSettings();
    await connection.evaluate(adapterSource);
    releaseCapture = await armManagerCapture(connection, sites);
  }
  async function check() {
    if (disposed) return null;
    let status = await connection.evaluate('window.__codexReasoningNativeAdapter?.status()??null');
    if (!status) {
      await initialize();
      status = await connection.evaluate('window.__codexReasoningNativeAdapter.status()');
    }
    if (status.managerCount > 0 && releaseCapture) {
      await releaseCapture();
      releaseCapture = null;
    }
    await refreshBindings();
    await refreshSettings();
    const panel = await connection.evaluate('window.__codexReasoningViewer?.status()??null');
    return { ...status, panel, captureArmed: releaseCapture !== null };
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (releaseCapture) await releaseCapture().catch(() => {});
    await connection
      .evaluate(
        'window.__codexReasoningNativeAdapter?.dispose();window.__codexReasoningViewer?.dispose()',
      )
      .catch(() => {});
    connection.close();
  }
  try {
    await initialize();
    return { check, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
export function isComposerPage(target) {
  if (target.type !== 'page') return false;
  try {
    const url = new URL(target.url);
    if (url.origin !== 'null' && url.protocol !== 'app:') return false;
    if (url.protocol !== 'app:' || url.host !== '-' || url.pathname !== '/index.html') return false;
    const route = url.searchParams.get('initialRoute') ?? '';
    return !/avatar-overlay|screen-overlay|browser-comment|quick-chat/.test(route);
  } catch {
    return false;
  }
}
