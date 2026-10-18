import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';
import { isComposerPage } from '../src/native/attach.mjs';

const project = resolve(import.meta.dirname, '..'),
  port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Pass the verified desktop loopback port');
const sources = await Promise.all(
  ['panel.js', 'resize.js', 'controls.js'].map((name) =>
    readFile(resolve(project, 'src/native', name), 'utf8'),
  ),
);
const target = (await listTargets(port)).find(isComposerPage);
if (!target) throw new Error('Codex main page is unavailable');
const connection = await CdpConnection.connect(target.webSocketDebuggerUrl),
  contexts = new Map();
const fixtureKey = '__codexReasoningControlsRegression',
  cases = [];
const removeListener = connection.on('Runtime.executionContextCreated', ({ context }) =>
  contexts.set(context.id, context),
);
try {
  await connection.send('Runtime.enable');
  await connection.evaluate(`(async()=>{
    if(window.${fixtureKey})throw new Error('Controls fixture already exists');
    const frame=document.createElement('iframe');
    frame.dataset.reasoningViewerTest='controls-regression';
    frame.style.cssText='position:fixed;left:-10000px;top:0;width:760px;height:600px;border:0;pointer-events:none;';
    frame.__previousFocus=document.activeElement;window.${fixtureKey}=frame;
    const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
    document.body.append(frame);await loaded;
    frame.contentDocument.body.innerHTML='<form data-codex-composer-root><div data-above-composer-portal data-above-composer-conversation-id="controls-fixture"></div><div data-codex-composer contenteditable="true"><p></p></div><button type="submit" aria-label="Send">Send</button><button type="submit" aria-label="Queue">Queue</button><button type="button" aria-label="Steer">Steer</button><button type="button" aria-label="Resume">Resume</button><button type="submit" aria-label="Stop">Stop</button><button type="button" aria-label="Other">Other</button></form>';
  })()`);
  const { root } = await connection.send('DOM.getDocument');
  const { nodeId } = await connection.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-reasoning-viewer-test="controls-regression"]',
  });
  const { node } = await connection.send('DOM.describeNode', { nodeId });
  const frameId = node.frameId ?? node.contentDocument?.frameId;
  const context = [...contexts.values()].find(
    (context) => context.auxData?.frameId === frameId && context.auxData?.isDefault,
  );
  assert.ok(context, 'the owned fixture requires an isolated execution context');
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
      getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),
    }});
    window.__fixtureStorage=values;
  })()`);
  for (const source of sources) await run(source);
  await run(`(()=>{
    const editor=document.querySelector('[data-codex-composer]');
    window.__fixtureEvents={keydown:0,keyup:0,pointerdown:0,click:0,submits:0,stop:0,other:0,draft:''};
    window.__fixtureSetDraft=(text,{caret='end',blocks=false,atom=false}={})=>{
      const p=document.createElement('p');p.textContent=text;editor.replaceChildren(p);
      if(blocks)editor.append(document.createElement('p'));
      if(atom){const chip=document.createElement('span');chip.contentEditable='false';chip.textContent='FILE';p.append(chip);}
      editor.focus({preventScroll:true});
      const range=document.createRange();range.selectNodeContents(editor);
      if(caret==='middle'&&p.firstChild)range.setStart(p.firstChild,Math.min(2,p.firstChild.length));
      else range.collapse(false);
      if(caret==='middle')range.collapse(true);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    };
    Object.defineProperty(editor,'pmViewDesc',{value:{get node(){
      const block=editor.firstElementChild;
      return{childCount:editor.children.length,textContent:editor.textContent,firstChild:block?{
        isTextblock:true,childCount:block.childNodes.length,child:index=>{
          const node=block.childNodes[index];
          if(node.nodeType===3)return{isText:true,text:node.nodeValue};
          return{isText:false,type:{name:node.hasAttribute('skill-mention-path')?'skillMention':'attachment'},
            attrs:{name:node.getAttribute('skill-mention-name'),path:node.getAttribute('skill-mention-path')}};
        },
      }:null};
    }}});
    window.__fixtureSetSkill=(name,path,{prefix='',suffix=' ',other=false}={})=>{
      const p=document.createElement('p'),chip=document.createElement('span');
      chip.contentEditable='false';chip.textContent='$'+name;
      chip.setAttribute('skill-mention-name',name);chip.setAttribute('skill-mention-path',path);
      p.append(prefix,chip,suffix);
      if(other)p.append(document.createElement('img'));
      editor.replaceChildren(p);editor.focus({preventScroll:true});
      const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    };
    window.__codexReasoningControls.setSkillPaths(['cot','cot-on','cot-off'].map(name=>({
      name,path:'C:/viewer-fixture/'+name+'/SKILL.md',
    })));
    editor.addEventListener('input',()=>{window.__fixtureEvents.draft=editor.innerText;});
    for(const name of['keydown','keyup','pointerdown','click'])window.addEventListener(name,()=>window.__fixtureEvents[name]++,{capture:true});
    editor.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.isComposing){
        event.preventDefault();window.__fixtureEvents.submits++;
      }
    });
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.__fixtureEvents.submits++;});
    document.querySelector('form').addEventListener('click',event=>{
      const label=event.target.closest('button')?.getAttribute('aria-label');
      if(!label)return;event.preventDefault();
      if(label==='Stop')window.__fixtureEvents.stop++;
      else if(label==='Other')window.__fixtureEvents.other++;
      else if(['Send','Queue','Steer','Resume'].includes(label))window.__fixtureEvents.submits++;
    });
    const api=window.__codexReasoningViewer;
    api.setSnapshot({threadId:'controls-fixture',turnId:'turn-one',itemId:'thought-one',summary:['INITIAL_SUMMARY'],content:['INITIAL_RAW']});
  })()`);
  const settle = async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (!(await run('window.__codexReasoningViewer.status().renderPending'))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The controls fixture did not finish rendering');
  };
  const snapshot = () =>
    run(`({
    status:window.__codexReasoningViewer.status(),events:{...window.__fixtureEvents},
    text:window.__codexReasoningViewer.getElement().querySelector('pre').textContent,
    editor:document.querySelector('[data-codex-composer]').innerText.trim(),
    panelPresent:!!document.querySelector('[data-reasoning-viewer]'),
    showPresent:!!document.querySelector('[data-reasoning-viewer-show]'),
    visibleOwnedNodes:[...document.querySelectorAll('[data-reasoning-viewer],[data-reasoning-viewer-show],[data-reasoning-viewer-command-hint]')].filter(node=>node.getClientRects().length&&getComputedStyle(node).display!=='none').length,
    hint:document.querySelector('[data-reasoning-viewer-command-hint]')?.hidden===false,
  })`);
  const draft = async (text, options = {}) =>
    run(`window.__fixtureSetDraft(${JSON.stringify(text)},${JSON.stringify(options)})`);
  const enter = async (options = {}) => {
    await run(`(()=>{
      const editor=document.querySelector('[data-codex-composer]'),options=${JSON.stringify(options)};
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options}));
      editor.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true,...options}));
    })()`);
    await settle();
    return snapshot();
  };
  const click = async (label) => {
    await run(`(()=>{
      const button=document.querySelector('button[aria-label=${JSON.stringify(label)}]');
      button.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
      button.click();
    })()`);
    await settle();
    return snapshot();
  };
  await settle();
  await draft('/cot off');
  assert.equal((await snapshot()).hint, true);
  const hidden = await enter();
  assert.equal(hidden.status.enabled, false);
  assert.equal(hidden.status.visible, false);
  assert.equal(hidden.status.mounted, false);
  assert.equal(hidden.panelPresent, false);
  assert.equal(hidden.showPresent, false);
  assert.equal(hidden.visibleOwnedNodes, 0);
  assert.equal(hidden.events.submits, 0);
  assert.equal(hidden.events.keydown, 0);
  assert.equal(hidden.events.keyup, 0);
  assert.equal(hidden.editor, '');
  assert.equal(hidden.events.draft.trim(), '');
  assert.equal(hidden.status.controls.executed, 1);
  cases.push('Enter consumes and clears local commands before native submit');

  await run(`(()=>{
    const api=window.__codexReasoningViewer;
    api.setSnapshot({threadId:'controls-fixture',turnId:'turn-one',itemId:'thought-two',summary:[],content:['SECOND_RAW']});
    api.setSnapshot({threadId:'controls-fixture',turnId:'turn-two',itemId:'thought-three',summary:['NEXT_SUMMARY'],content:['NEXT_RAW']});
  })()`);
  await settle();
  assert.equal((await snapshot()).status.turnCount, 2);
  assert.equal((await snapshot()).text, hidden.text);
  await draft('/cot on');
  const shown = await enter({ ctrlKey: true });
  assert.equal(shown.status.enabled, true);
  assert.equal(shown.text, 'NEXT_SUMMARY');
  assert.equal(shown.events.submits, 0);
  await run("window.__codexReasoningViewer.setTurn('turn-one')");
  await settle();
  assert.equal((await snapshot()).text, 'INITIAL_SUMMARY\n\nSECOND_RAW');
  cases.push('hidden UI retains new items and turns and reopens with complete history');

  await draft('/cot');
  assert.equal((await enter({ metaKey: true })).status.enabled, false);
  await draft('/cot toggle');
  assert.equal((await enter()).status.enabled, true);
  for (const [label, command, enabled] of [
    ['Send', '/cot hide', false],
    ['Queue', '/cot show', true],
    ['Steer', '/cot off', false],
    ['Resume', '/cot on', true],
  ]) {
    const before = await snapshot();
    await draft(command);
    const after = await click(label);
    assert.equal(after.status.enabled, enabled);
    assert.equal(after.events.submits, 0);
    assert.equal(after.events.pointerdown, before.events.pointerdown);
    assert.equal(after.events.click, before.events.click);
    assert.equal(after.editor, '');
    assert.equal(after.status.controls.lastError, null);
  }
  cases.push('Send, Queue, Steer and Resume are consumed on pointer and click paths');

  await draft('/cot invalid');
  const invalid = await enter();
  assert.equal(invalid.editor, '/cot invalid');
  assert.equal(invalid.events.submits, 0);
  assert.equal(invalid.hint, true);
  const invalidClick = await click('Send');
  assert.equal(invalidClick.events.submits, 0);
  assert.equal(invalidClick.editor, '/cot invalid');
  await draft('/cot off');
  const stops = await click('Stop');
  assert.equal(stops.events.stop, 1);
  assert.equal(stops.status.enabled, true);
  assert.equal(stops.editor, '/cot off');
  assert.equal((await click('Other')).events.other, 1);
  cases.push('invalid local arguments stay local; Stop and unrelated buttons remain usable');

  const passthroughs = [
    { text: '/review' },
    { text: '/cotton' },
    { text: 'explain /cot' },
    { text: '/cot off\nexplanation' },
    { text: '/cot off\n' },
    { text: '/cot off', draft: { caret: 'middle' } },
    { text: '/cot off', draft: { blocks: true } },
    { text: '/cot off', draft: { atom: true } },
    { text: '/cot off', key: { shiftKey: true } },
    { text: '/cot off', key: { altKey: true } },
    { text: '/cot off', key: { isComposing: true } },
    { text: '/cot off', key: { keyCode: 229 } },
  ];
  for (const entry of passthroughs) {
    const before = await snapshot();
    await draft(entry.text, entry.draft);
    const after = await enter(entry.key);
    assert.equal(after.events.keydown, before.events.keydown + 1, JSON.stringify(entry));
    assert.equal(
      after.status.controls.executed,
      before.status.controls.executed,
      JSON.stringify(entry),
    );
  }
  cases.push(
    'unrelated commands, multiline drafts, attachments, middle carets, modifiers and IME pass through',
  );

  for (const [name, suffix, enabled] of [
    ['cot-off', ' ', false],
    ['cot-on', ' ', true],
    ['cot', ' ', false],
    ['cot', ' on', true],
  ]) {
    const before = await snapshot();
    await run(
      `window.__fixtureSetSkill(${JSON.stringify(name)},${JSON.stringify('C:/viewer-fixture/' + name + '/SKILL.md')},{suffix:${JSON.stringify(suffix)}})`,
    );
    const after = await enter();
    assert.equal(after.status.enabled, enabled);
    assert.equal(after.status.controls.executed, before.status.controls.executed + 1);
    assert.equal(after.events.submits, before.events.submits);
    assert.equal(after.editor, '');
    if (!enabled) assert.equal(after.visibleOwnedNodes, 0);
  }
  for (const entry of [
    { name: 'cot-off', path: 'C:/another-plugin/cot-off/SKILL.md' },
    { name: 'unrelated', path: 'C:/viewer-fixture/cot-off/SKILL.md' },
    {
      name: 'cot-off',
      path: 'C:/viewer-fixture/cot-off/SKILL.md',
      options: { prefix: 'explain ' },
    },
    { name: 'cot-off', path: 'C:/viewer-fixture/cot-off/SKILL.md', options: { other: true } },
    { name: 'cot-off', path: 'C:/viewer-fixture/cot-off/SKILL.md', options: { suffix: '\\n' } },
  ]) {
    const before = await snapshot();
    const options = entry.options?.suffix === '\\n' ? { suffix: '\n' } : entry.options;
    await run(
      `window.__fixtureSetSkill(${JSON.stringify(entry.name)},${JSON.stringify(entry.path)},${JSON.stringify(options ?? {})})`,
    );
    const after = await enter();
    assert.equal(after.status.controls.executed, before.status.controls.executed);
    assert.equal(after.events.keydown, before.events.keydown + 1);
  }
  cases.push(
    'only registered skill paths with a single control chip execute locally; unrelated chips and mixed drafts pass through',
  );

  await run(`(()=>{
    window.__fixtureMenu=(name,foreign=false)=>{
      document.querySelector('[cmdk-list]')?.remove();
      const list=document.createElement('div'),option=document.createElement('div');
      list.setAttribute('cmdk-list','');list.setAttribute('role','listbox');
      list.setAttribute('aria-activedescendant','fixture-menu-option');
      option.id='fixture-menu-option';option.setAttribute('cmdk-item','');
      option.setAttribute('role','option');option.setAttribute('aria-selected','true');
      option.setAttribute('data-selected','true');option.setAttribute('data-disabled','false');
      option.textContent='An ambiguous title must not decide identity';
      Object.defineProperty(option,'__reactFiber$fixture',{value:{
        key:null,return:{key:'skill:C:/'+(foreign?'another-plugin':'viewer-fixture')+'/'+name+'/SKILL.md',return:null},
      }});
      list.append(option);document.body.append(list);
    };
  })()`);
  await draft('/cot');
  await run("window.__fixtureMenu('cot-off')");
  const beforeMenu = await snapshot();
  const selectedOff = await enter();
  assert.equal(selectedOff.status.enabled, false);
  assert.equal(selectedOff.status.controls.lastAction, 'hide');
  assert.equal(selectedOff.events.submits, beforeMenu.events.submits);
  await draft('/cot on');
  assert.equal((await enter()).status.enabled, true);
  await draft('/co');
  await run("window.__fixtureMenu('cot-on')");
  await run(`(()=>{
    const option=document.querySelector('[cmdk-item]');
    option.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
    option.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  })()`);
  await settle();
  assert.equal((await snapshot()).status.enabled, true);
  assert.equal((await snapshot()).events.submits, beforeMenu.events.submits);
  await draft('/cot');
  await run("window.__fixtureMenu('cot-off',true)");
  const foreignMenuBefore = await snapshot();
  const foreignMenuAfter = await enter();
  assert.equal(
    foreignMenuAfter.status.controls.executed,
    foreignMenuBefore.status.controls.executed,
  );
  assert.equal(foreignMenuAfter.events.keydown, foreignMenuBefore.events.keydown + 1);
  await run("document.querySelector('[cmdk-list]').remove()");
  cases.push(
    'native menu keyboard and pointer selection use registered React keys, respect the highlighted action, and leave foreign items alone',
  );

  await draft('');
  await run(
    'window.__codexReasoningViewer.getElement().querySelector(\'button[title="/cot off"]\').click()',
  );
  await settle();
  const headerHidden = await snapshot();
  assert.equal(headerHidden.visibleOwnedNodes, 0);
  assert.equal(headerHidden.panelPresent, false);
  assert.equal(headerHidden.showPresent, false);
  await draft('/cot on');
  await enter();
  await settle();
  assert.equal((await snapshot()).status.enabled, true);
  await run(
    "localStorage.setItem('codex-reasoning-viewer:enabled:v1','false');window.dispatchEvent(new StorageEvent('storage',{key:'codex-reasoning-viewer:enabled:v1',newValue:'false'}))",
  );
  await settle();
  assert.equal((await snapshot()).status.enabled, false);
  assert.equal((await snapshot()).visibleOwnedNodes, 0);
  cases.push('header and cross-window visibility fully remove UI; the local command reopens it');

  const cleanup = await run(`(()=>{
    window.__codexReasoningViewer.dispose();
    return{panel:!!window.__codexReasoningViewer,controls:!!window.__codexReasoningControls,
      nodes:document.querySelectorAll('[data-reasoning-viewer],[data-reasoning-viewer-show],[data-reasoning-viewer-command-hint],[data-reasoning-viewer-resize]').length};
  })()`);
  assert.deepEqual(cleanup, { panel: false, controls: false, nodes: 0 });
  for (const source of sources) await run(source);
  assert.equal((await snapshot()).status.enabled, false);
  assert.equal((await snapshot()).visibleOwnedNodes, 0);
  assert.equal((await snapshot()).panelPresent, false);
  await draft('/cot on');
  const restored = await enter();
  assert.equal(restored.status.enabled, true);
  assert.equal(restored.status.controls.executed, 1);
  cases.push(
    'dispose removes owned controls and reinstall restores saved visibility without duplicate handlers',
  );

  const report = {
    observedAt: new Date().toISOString(),
    passed: true,
    kind: 'owned iframe; isolated storage and fake submit handlers; no model requests',
    cases,
    cleanup,
  };
  const directory = resolve(project, '.local/native-runtime');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, 'native-controls-regression.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection
    .evaluate(
      `(()=>{
    const frame=window.${fixtureKey};if(!frame)return;
    const restore=document.activeElement===frame,previous=frame.__previousFocus;
    try{frame.contentWindow.__codexReasoningViewer?.dispose();}
    finally{frame.remove();delete window.${fixtureKey};if(restore&&previous?.isConnected)previous.focus({preventScroll:true});}
  })()`,
    )
    .catch(() => {});
  removeListener();
  connection.close();
}
