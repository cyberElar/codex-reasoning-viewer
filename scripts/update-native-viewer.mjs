import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';
import { isComposerPage } from '../src/native/attach.mjs';
import { findInstallation, verifyInstallation, powershell } from '../src/native/installation.mjs';
import { readSkillBindings } from '../src/native/skill-bindings.mjs';

const project = resolve(import.meta.dirname, '..');
const state = JSON.parse(
  await readFile(resolve(project, '.local/native-launch/status.json'), 'utf8'),
);
const port = Number(process.argv[2] ?? state.port);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Pass the verified desktop loopback port');
const installation = await findInstallation(),
  guard = await verifyInstallation(installation);
if (!guard.supported) throw new Error('This installed desktop build is not supported');
const owner = await powershell(
  `Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess -Unique`,
);
if (!owner.split(/\s+/).includes(String(state.pid)))
  throw new Error('The endpoint owner does not match the launched desktop');
const sources = await Promise.all(
  ['panel.js', 'resize.js', 'controls.js', 'adapter.js'].map((name) =>
    readFile(resolve(project, 'src/native', name), 'utf8'),
  ),
);
const skillBindings = await readSkillBindings(project);
const pendingKey = '__codexReasoningViewerPendingUpdate',
  objectGroup = 'codex-reasoning-viewer-update';

async function retainManagers(connection) {
  const existing = await connection.evaluate(`(()=>{
    if(window.${pendingKey})throw new Error('A viewer update is already pending');
    const api=window.__codexReasoningNativeAdapter;
    if(!api)throw new Error('The active viewer adapter is unavailable');
    if(typeof api.getManagers!=='function')return null;
    const managers=api.getManagers();window.${pendingKey}={managers};return managers.length;
  })()`);
  if (existing !== null) return existing;
  // Older viewer builds did not expose their already captured manager set.
  const method = await connection.send('Runtime.evaluate', {
    expression: 'window.__codexReasoningNativeAdapter.capture',
    returnByValue: false,
    objectGroup,
  });
  const properties = await connection.send('Runtime.getProperties', {
    objectId: method.result.objectId,
    ownProperties: true,
    generatePreview: false,
  });
  const scopes = properties.internalProperties?.find(
    (property) => property.name === '[[Scopes]]',
  )?.value;
  if (!scopes?.objectId) throw new Error('Cannot preserve the existing viewer managers');
  const list = await connection.send('Runtime.getProperties', {
    objectId: scopes.objectId,
    ownProperties: true,
    generatePreview: false,
  });
  for (const entry of list.result.filter((entry) => /^\d+$/.test(entry.name))) {
    if (!entry.value?.objectId || entry.value.description === 'Global') continue;
    const properties = await connection.send('Runtime.getProperties', {
      objectId: entry.value.objectId,
      ownProperties: true,
      generatePreview: false,
    });
    const managers = properties.result.find((property) => property.name === 'managers')?.value;
    if (!managers?.objectId) continue;
    const saved = await connection.send('Runtime.callFunctionOn', {
      objectId: managers.objectId,
      returnByValue: true,
      functionDeclaration: `function(){const managers=[...this].filter(manager=>!manager.disposed);window.${pendingKey}={managers};return managers.length;}`,
    });
    return saved.result.value;
  }
  throw new Error('The existing viewer manager set was not found');
}

const reports = [];
for (const target of (await listTargets(port)).filter(isComposerPage)) {
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
  try {
    const count = await retainManagers(connection);
    if (!count) {
      await connection.evaluate(`delete window.${pendingKey}`);
      throw new Error('No existing manager is available; the viewer was left running');
    }
    const before = await connection.evaluate(`(()=>{
      const api=window.__codexReasoningViewer,panel=api.getElement?.()??document.querySelector('[data-reasoning-viewer]'),body=panel?.querySelector('pre');
      window.${pendingKey}.activeElement=document.activeElement;
      return{...api.status(),collapsed:body?.hidden===true,scrollTop:body?.scrollTop??0};
    })()`);
    const program = `
      window.${pendingKey}.adapterCleanup=window.__codexReasoningNativeAdapter.dispose();
      window.${pendingKey}.panelCleanup=window.__codexReasoningViewer.dispose();
      ${sources.join(';\n')};
      (()=>{
        const pending=window.${pendingKey},adapter=window.__codexReasoningNativeAdapter,panel=window.__codexReasoningViewer;
        if(adapter?.status().version!==3||panel?.version!==3)throw new Error('The updated viewer did not initialize');
        window.__codexReasoningControls.setSkillPaths(${JSON.stringify(skillBindings)});
        for(const manager of pending.managers)if(!adapter.capture(manager))throw new Error('An existing manager could not be adopted');
        adapter.refresh();
        const root=panel.getElement(),mode=root.querySelector('[aria-label="\\u601d\\u8003\\u5185\\u5bb9"]'),body=root.querySelector('pre');
        mode.value=${JSON.stringify(before.mode)};mode.dispatchEvent(new Event('change'));
        if(${before.enabled === false})panel.setEnabled(false,{save:false});
        if(${before.followingLatestTurn === false})panel.setTurn(${JSON.stringify(before.turnId)});
        if(${before.collapsed})root.querySelector('button[aria-expanded]').click();
        if(!${before.follow})body.dispatchEvent(new WheelEvent('wheel',{deltaY:-1}));
        return{adapterCleanup:pending.adapterCleanup,panelCleanup:pending.panelCleanup};
      })()`;
    const cleanup = await connection.evaluate(program);
    for (let attempt = 0; attempt < 70; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const pending = await connection.evaluate(
        `({refresh:window.__codexReasoningNativeAdapter.status().refreshPending,render:window.__codexReasoningViewer.status().renderPending})`,
      );
      if (!pending.refresh && !pending.render) break;
      if (attempt === 69) throw new Error('The updated viewer did not finish rendering');
    }
    await connection.evaluate(`(()=>{
      const body=window.__codexReasoningViewer.getElement().querySelector('pre');
      if(!${before.follow}){body.scrollTop=${before.scrollTop};body.dispatchEvent(new WheelEvent('wheel',{deltaY:-1}));}
      const active=window.${pendingKey}.activeElement;
      if(active?.isConnected&&active!==document.body)active.focus({preventScroll:true});
      delete window.${pendingKey};
    })()`);
    const result = await connection.evaluate(`({
      adapter:window.__codexReasoningNativeAdapter.status(),
      panel:window.__codexReasoningViewer.status(),
      turns:window.__codexReasoningViewer.historyMetadata(),
      resizeHandles:document.querySelectorAll('[data-reasoning-viewer-resize]').length
    })`);
    if (result.adapter.managerCount !== count || result.adapter.lastError)
      throw new Error('The updated adapter could not read the preserved managers');
    reports.push({ targetId: target.id, preservedManagers: count, cleanup, ...result });
  } finally {
    await connection.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
    connection.close();
  }
}
if (!reports.length) throw new Error('No composer window was found');
const report = {
  observedAt: new Date().toISOString(),
  desktopPid: state.pid,
  version: guard.version,
  kind: 'in-memory viewer update; existing desktop and managers preserved',
  reports,
};
await writeFile(
  resolve(project, '.local/native-launch/live-update.json'),
  JSON.stringify(report, null, 2),
);
await writeFile(
  resolve(project, '.local/native-launch/status.json'),
  JSON.stringify(
    {
      ...state,
      observedAt: report.observedAt,
      port,
      status: reports.some((report) => report.panel.visible)
        ? 'visible'
        : reports.some((report) => report.panel.enabled === false)
          ? 'hidden-by-user'
          : 'attached',
      targets: reports.map((report) => ({
        targetId: report.targetId,
        ...report.adapter,
        panel: report.panel,
      })),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(report, null, 2));
