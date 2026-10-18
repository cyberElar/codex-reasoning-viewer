import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';

const port = Number(process.argv[2]);
const isolatedBrowser = process.argv.includes('--isolated-browser');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Pass the verified desktop loopback port');
const project = resolve(import.meta.dirname, '..');
const [panelSource, resizeSource, adapterSource] = await Promise.all([
  readFile(resolve(project, 'src/native/panel.js'), 'utf8'),
  readFile(resolve(project, 'src/native/resize.js'), 'utf8'),
  readFile(resolve(project, 'src/native/adapter.js'), 'utf8'),
]);
const target = (await listTargets(port)).find(
  (target) =>
    target.type === 'page' &&
    target.url === (isolatedBrowser ? 'about:blank' : 'app://-/index.html'),
);
if (!target) throw new Error('Codex main page is unavailable');
const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
const fixtureKey = '__codexReasoningComposerRegression';
const contexts = new Map();
const removeListener = connection.on('Runtime.executionContextCreated', ({ context }) =>
  contexts.set(context.id, context),
);
try {
  await connection.send('Runtime.enable');
  const ready = await connection.evaluate(`(async()=>{
    if(window.${fixtureKey})throw new Error('Composer fixture already exists');
    const frame=document.createElement('iframe');
    frame.dataset.reasoningViewerTest='composer-regression';
    frame.style.cssText='position:fixed;left:-10000px;top:0;width:760px;height:600px;border:0;pointer-events:none;';
    window.${fixtureKey}=frame;
    const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
    document.body.append(frame);await loaded;
    frame.contentDocument.body.innerHTML='<style>[data-above-composer-portal]:empty{display:none}</style><section id="home" data-codex-composer-root style="display:none"><div data-above-composer-portal></div><div data-codex-composer>Editor</div></section><section id="first" data-codex-composer-root><div data-above-composer-portal data-above-composer-conversation-id="fixture-first"></div><div data-codex-composer>Editor</div></section><section id="second" data-codex-composer-root style="display:none"><div data-above-composer-portal data-above-composer-conversation-id="fixture-second"></div><div data-codex-composer>Editor</div></section>';
    return true;
  })()`);
  assert.equal(ready, true);
  const { root } = await connection.send('DOM.getDocument');
  const { nodeId } = await connection.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-reasoning-viewer-test="composer-regression"]',
  });
  const { node } = await connection.send('DOM.describeNode', { nodeId });
  const frameId = node.frameId ?? node.contentDocument?.frameId;
  const context = [...contexts.values()].find(
    (context) => context.auxData?.frameId === frameId && context.auxData?.isDefault,
  );
  assert.ok(context, 'the owned fixture frame must have its own default execution context');
  const run = async (expression) => {
    const result = await connection.send('Runtime.evaluate', {
      expression,
      contextId: context.id,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await run(`(()=>{
    const values=new Map();
    Object.defineProperty(window,'localStorage',{configurable:true,value:{
      getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,String(value)),
      removeItem:key=>values.delete(key),
    }});
  })()`);
  await run(panelSource);
  await run(resizeSource);
  await run(adapterSource);
  await run(`(()=>{
    const conversations=new Map([
      ['fixture-first',{turns:[{turnId:'turn-first',status:'completed',items:[{id:'item-first',type:'reasoning',summary:[],content:['RAW_INITIAL']}]}]}],
      ['fixture-second',{turns:[{turnId:'turn-second',status:'completed',items:[{id:'item-second',type:'reasoning',summary:['FULL_SUMMARY'],content:['SECOND_RAW']}]}]}],
    ]);
    class Manager{
      threadStore={updateConversationState(id,update){update(conversations.get(id));}};
      callbacks=new Set();
      getHostId(){return'fixture';}
      getConversation(id){return conversations.get(id);}
      onNotification(method,params){for(const entry of this.callbacks)if(entry.methods.includes(method))entry.callback({method,params});}
      addNotificationCallback(methods,callback){const entry={methods,callback};this.callbacks.add(entry);return()=>this.callbacks.delete(entry);}
    }
    const manager=new Manager();window.__composerFixtureManager=manager;
    return window.__codexReasoningNativeAdapter.capture(manager);
  })()`);
  const pause = async () => {
    for (let attempt = 0; attempt < 70; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const pending = await run(`(()=>{
        const panel=window.__codexReasoningViewer.status(),resize=panel.resize;
        const size=panel.visible&&resize?.preferredHeightPx!==null&&resize?.preferredHeightPx!==undefined
          &&resize.heightPx!==Math.max(resize.minimumPx,Math.min(resize.maximumPx,Math.round(resize.preferredHeightPx)));
        return{refresh:window.__codexReasoningNativeAdapter.status().refreshPending,render:panel.renderPending,size};
      })()`);
      if (!pending.refresh && !pending.render && !pending.size) return;
    }
    throw new Error('The owned fixture did not finish its scheduled render');
  };
  const snapshot = () =>
    run(`({
    adapter:window.__codexReasoningNativeAdapter.status(),
    panel:window.__codexReasoningViewer.status(),
    target:window.__codexReasoningViewer.composerTarget()?.getAttribute('data-above-composer-conversation-id')??null,
    text:document.querySelector('[data-reasoning-viewer] pre').textContent,
    parentThread:document.querySelector('[data-reasoning-viewer]').parentElement.getAttribute('data-above-composer-conversation-id')
  })`);
  const samples = [];
  await pause();
  const first = await snapshot();
  samples.push({ step: 'empty-thread-portal', ...first });
  assert.equal(first.parentThread, 'fixture-first');
  assert.equal(first.adapter.selectedThreadId, 'fixture-first');
  assert.equal(first.panel.visible, true);
  assert.equal(first.text, 'RAW_INITIAL');

  await run(
    `window.__composerFixtureManager.onNotification('item/reasoning/textDelta',{threadId:'fixture-first',turnId:'turn-first',itemId:'item-first',contentIndex:0,delta:' RAW_DELTA'})`,
  );
  await pause();
  const streamed = await snapshot();
  samples.push({ step: 'streamed-delta', ...streamed });
  assert.equal(streamed.text, 'RAW_INITIAL RAW_DELTA');
  assert.equal(streamed.adapter.nativeNotifications, 1);

  const historyCases = [];
  await run(`window.__composerFixtureManager.onNotification('item/reasoning/textDelta',{threadId:'fixture-first',turnId:'turn-first',itemId:'item-first-b',contentIndex:0,delta:'SECOND_RAW_THOUGHT'});
    window.__composerFixtureManager.onNotification('item/reasoning/summaryTextDelta',{threadId:'fixture-first',turnId:'turn-first',itemId:'item-first-b',summaryIndex:0,delta:'SECOND_THOUGHT_SUMMARY'})`);
  await pause();
  const combined = await snapshot();
  assert.equal(combined.text, 'RAW_INITIAL RAW_DELTA\n\nSECOND_THOUGHT_SUMMARY');
  assert.equal(combined.panel.reasoningItems, 2);
  await run("window.__codexReasoningViewer.configure({mode:'raw'})");
  await pause();
  const combinedRaw = await snapshot();
  assert.equal(combinedRaw.text, 'RAW_INITIAL RAW_DELTA\n\nSECOND_RAW_THOUGHT');
  await run(`window.__composerFixtureManager.threadStore.updateConversationState('fixture-first',conversation=>{
    conversation.turns[0].items=[{id:'item-first-b',type:'reasoning',summary:['SECOND_THOUGHT_SUMMARY'],content:['SECOND_RAW_THOUGHT']}];
  })`);
  await pause();
  const retained = await snapshot();
  assert.equal(retained.text, combinedRaw.text);
  historyCases.push({
    step: 'same-turn-items-retained-through-native-snapshot',
    turnCount: retained.panel.turnCount,
    reasoningItems: retained.panel.reasoningItems,
  });

  await run(`window.__composerFixtureManager.onNotification('turn/completed',{threadId:'fixture-first',turn:{id:'turn-first'}});
    window.__composerFixtureManager.onNotification('turn/started',{threadId:'fixture-first',turn:{id:'turn-next'}});
    window.__composerFixtureManager.onNotification('item/reasoning/textDelta',{threadId:'fixture-first',turnId:'turn-next',itemId:'item-next',contentIndex:0,delta:'NEXT_TURN'})`);
  await pause();
  const newTurn = await snapshot();
  assert.equal(newTurn.panel.turnCount, 2);
  assert.equal(newTurn.panel.turnId, 'turn-next');
  assert.equal(newTurn.text, 'NEXT_TURN');
  await run(`window.__codexReasoningViewer.setTurn('turn-first')`);
  await pause();
  const selectedHistory = await snapshot();
  assert.equal(selectedHistory.text, combinedRaw.text);
  assert.equal(selectedHistory.panel.followingLatestTurn, false);
  await run(`window.__composerFixtureManager.onNotification('item/reasoning/textDelta',{threadId:'fixture-first',turnId:'turn-next',itemId:'item-next',contentIndex:0,delta:' EXTRA'});
    window.__composerFixtureManager.onNotification('turn/completed',{threadId:'fixture-first',turn:{id:'turn-next'}});
    window.__composerFixtureManager.onNotification('turn/started',{threadId:'fixture-first',turn:{id:'turn-third'}});
    window.__composerFixtureManager.onNotification('item/reasoning/textDelta',{threadId:'fixture-first',turnId:'turn-third',itemId:'item-third',contentIndex:0,delta:'THIRD_TURN'})`);
  await pause();
  const pinned = await snapshot();
  assert.equal(pinned.panel.turnCount, 3);
  assert.equal(pinned.panel.turnId, 'turn-first');
  assert.equal(pinned.text, combinedRaw.text);
  historyCases.push({
    step: 'new-turn-and-new-deltas-do-not-replace-selected-history',
    turnCount: pinned.panel.turnCount,
    selectedTurn: pinned.panel.turnId,
  });
  await run(`window.__composerFixtureManager.threadStore.updateConversationState('fixture-first',conversation=>{
    conversation.turnHistory={history:{isComplete:true,entitiesByKey:{
      older:{turnId:'turn-older',status:'completed',items:[{id:'item-older',type:'reasoning',summary:[],content:['OLDER_TURN']}]}
    },islands:[{entries:[{value:'older'}]}]}};
  })`);
  await pause();
  const metadata = await run('window.__codexReasoningViewer.historyMetadata()');
  assert.deepEqual(
    metadata.map((turn) => turn.turnId),
    ['turn-older', 'turn-first', 'turn-next', 'turn-third'],
  );
  assert.equal((await snapshot()).panel.turnId, 'turn-first');
  await run('window.__codexReasoningViewer.goLatest()');
  await pause();
  const latestTurn = await snapshot();
  assert.equal(latestTurn.panel.followingLatestTurn, true);
  assert.equal(latestTurn.text, 'THIRD_TURN');
  await run(`document.querySelector('[data-reasoning-viewer-previous-turn]').click()`);
  await pause();
  assert.equal((await snapshot()).text, 'NEXT_TURN EXTRA');
  await run(`document.querySelector('[data-reasoning-viewer-next-turn]').click()`);
  await pause();
  assert.equal((await snapshot()).text, 'THIRD_TURN');
  historyCases.push({
    step: 'older-turn-inserted-in-order-and-navigation-restores-latest',
    turns: metadata,
  });
  const historyBeforeUpdate = await run('window.__codexReasoningViewer.historyMetadata()');
  await run(`(()=>{
    window.__fixtureRetainedHistory=window.__codexReasoningNativeAdapter.exportHistory();
    window.__codexReasoningNativeAdapter.dispose();
  })()`);
  await run(adapterSource);
  await run(`(()=>{
    window.__codexReasoningNativeAdapter.importHistory(window.__fixtureRetainedHistory);
    window.__codexReasoningNativeAdapter.capture(window.__composerFixtureManager);
    window.__codexReasoningNativeAdapter.refresh();
    delete window.__fixtureRetainedHistory;
  })()`);
  await pause();
  assert.deepEqual(
    await run('window.__codexReasoningViewer.historyMetadata()'),
    historyBeforeUpdate,
  );
  historyCases.push({
    step: 'in-memory-handoff-retains-turns-and-live-only-reasoning-absent-from-native-snapshots',
    turns: historyBeforeUpdate.length,
  });
  await run("window.__codexReasoningViewer.configure({mode:'auto'})");

  await run(
    `document.getElementById('first').style.display='none';document.getElementById('second').style.display=''`,
  );
  await pause();
  const second = await snapshot();
  samples.push({ step: 'visibility-only-thread-switch', ...second });
  assert.equal(second.parentThread, 'fixture-second');
  assert.equal(second.adapter.selectedThreadId, 'fixture-second');
  assert.equal(second.panel.visible, true);
  assert.equal(second.text, 'FULL_SUMMARY');

  const resizeSamples = [];
  const resizeStatus = () => run('window.__codexReasoningViewer.status()');
  const drag = async (start, end, finish = 'pointerup') => {
    await run(`(()=>{
      const handle=document.querySelector('[data-reasoning-viewer-resize]');
      const options={bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',isPrimary:true,button:0,buttons:1};
      handle.dispatchEvent(new PointerEvent('pointerdown',{...options,clientY:${start}}));
      window.dispatchEvent(new PointerEvent('pointermove',{...options,clientY:${end}}));
      window.dispatchEvent(new PointerEvent(${JSON.stringify(finish)},{...options,buttons:0,clientY:${end}}));
    })()`);
    await pause();
    return resizeStatus();
  };
  const initial = await resizeStatus();
  const grown = await drag(400, 280);
  resizeSamples.push({ step: 'drag-up-grows', ...grown.resize });
  assert.ok(Math.abs(grown.resize.heightPx - initial.resize.heightPx - 120) <= 1);
  assert.equal(grown.resize.dragging, false);
  assert.equal(grown.follow, true);
  const shrunk = await drag(400, 450);
  resizeSamples.push({ step: 'drag-down-shrinks', ...shrunk.resize });
  assert.equal(shrunk.resize.heightPx, grown.resize.heightPx - 50);
  const canceled = await drag(400, 200, 'pointercancel');
  assert.equal(canceled.resize.heightPx, shrunk.resize.heightPx);
  assert.equal(canceled.resize.dragging, false);
  const maxed = await drag(400, -4000);
  resizeSamples.push({ step: 'viewport-limit', ...maxed.resize });
  assert.equal(maxed.resize.heightPx, maxed.resize.maximumPx);
  const minned = await drag(400, 4000);
  resizeSamples.push({ step: 'minimum-limit', ...minned.resize });
  assert.equal(minned.resize.heightPx, minned.resize.minimumPx);
  await run(
    `document.querySelector('[data-reasoning-viewer-resize]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}))`,
  );
  assert.equal((await resizeStatus()).resize.heightPx, minned.resize.minimumPx + 16);
  await run(
    `document.querySelector('[data-reasoning-viewer-resize]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`,
  );
  const reset = await resizeStatus();
  resizeSamples.push({ step: 'double-click-reset', ...reset.resize });
  assert.equal(reset.resize.preferredHeightPx, null);

  await run(
    'window.__codexReasoningViewer.resize.setHeight(240);window.__codexReasoningViewer.resize.dispose()',
  );
  await run(resizeSource);
  const restored = await resizeStatus();
  resizeSamples.push({ step: 'saved-height-restored', ...restored.resize });
  assert.equal(restored.resize.heightPx, 240);
  await connection.evaluate(`window.${fixtureKey}.style.height='300px'`);
  await pause();
  const small = await resizeStatus();
  resizeSamples.push({ step: 'small-window-clamp', ...small.resize });
  assert.equal(small.resize.heightPx, small.resize.maximumPx);
  assert.equal(small.resize.preferredHeightPx, 240);
  await connection.evaluate(`window.${fixtureKey}.style.height='600px'`);
  await pause();
  assert.equal((await resizeStatus()).resize.heightPx, 240);
  const cleanup = await run(`(()=>{
    const handle=document.querySelector('[data-reasoning-viewer-resize]');
    const options={bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientY:400};
    handle.dispatchEvent(new PointerEvent('pointerdown',options));
    window.dispatchEvent(new PointerEvent('pointermove',{...options,clientY:300}));
    window.__codexReasoningViewer.resize.dispose();
    return{handles:document.querySelectorAll('[data-reasoning-viewer-resize]').length,cursor:document.documentElement.style.cursor,userSelect:document.documentElement.style.userSelect};
  })()`);
  assert.deepEqual(cleanup, { handles: 0, cursor: '', userSelect: '' });
  await run(resizeSource);

  await run(`window.__composerFixtureManager.threadStore.updateConversationState('fixture-second',conversation=>{
    conversation.turns.push({turnId:'turn-without-text',status:'completed',items:[{id:'reasoning-without-text',type:'reasoning',summary:[],content:[]}]});
  })`);
  await pause();
  const noText = await snapshot();
  assert.equal(noText.panel.visible, true);
  assert.equal(noText.panel.summaryChars, 0);
  assert.equal(noText.panel.rawChars, 0);
  assert.equal(noText.panel.turnId, 'turn-without-text');
  assert.ok(noText.text.length > 0);
  historyCases.push({
    step: 'empty-reasoning-remains-visible-with-an-explicit-empty-state',
    visible: noText.panel.visible,
    summaryChars: 0,
    rawChars: 0,
  });

  await run(
    `document.getElementById('second').style.display='none';document.getElementById('home').style.display=''`,
  );
  await pause();
  const home = await snapshot();
  samples.push({ step: 'return-to-home', ...home });
  assert.equal(home.adapter.selectedThreadId, null);
  assert.equal(home.panel.visible, false);
  assert.equal(home.panel.rawChars, 0);
  assert.equal(home.panel.summaryChars, 0);

  const report = {
    observedAt: new Date().toISOString(),
    kind:
      'owned iframe fixture in ' +
      (isolatedBrowser ? 'an isolated browser' : 'the current desktop renderer') +
      '; isolated preference storage; no native thread or model requests',
    passed: true,
    samples,
    historyCases,
    resizeSamples,
    resizeCleanup: cleanup,
  };
  const reportDir = resolve(project, '.local/native-runtime');
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    resolve(reportDir, 'native-composer-regression.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection
    .evaluate(
      `(()=>{const frame=window.${fixtureKey};if(!frame)return;try{frame.contentWindow.__codexReasoningNativeAdapter?.dispose();frame.contentWindow.__codexReasoningViewer?.dispose();}finally{frame.remove();delete window.${fixtureKey};}})()`,
    )
    .catch(() => {});
  removeListener();
  connection.close();
}
