import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpConnection, listTargets } from '../src/native/cdp.mjs';
import { isComposerPage } from '../src/native/attach.mjs';

const project = resolve(import.meta.dirname, '..'),
  port = Number(process.argv[2]),
  isolatedBrowser = process.argv.includes('--isolated-browser');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Pass the verified desktop loopback port');
const sources = await Promise.all(
  ['panel.js', 'resize.js', 'controls.js'].map((name) =>
    readFile(resolve(project, 'src/native', name), 'utf8'),
  ),
);
const target = (await listTargets(port)).find(
  isolatedBrowser
    ? (target) => target.type === 'page' && target.url === 'about:blank'
    : isComposerPage,
);
if (!target) throw new Error('The selected regression page is unavailable');
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
    // Native menu listeners can register before the injected controls on the same window.
    window.addEventListener('keydown',event=>{
      if(!window.__fixtureNativeFirst||!['Enter','Tab'].includes(event.key))return;
      const option=document.querySelector('[data-list-navigation-item="true"][aria-current="true"]');
      if(!option)return;
      const skill=option.__fixtureSkill;
      window.__fixtureNativeSelections=(window.__fixtureNativeSelections??0)+1;
      window.__fixtureSetSkill(skill.name,skill.path);
      option.closest('[data-mention-list-scroll-area]').remove();
      event.preventDefault();event.stopPropagation();
    },{capture:true});
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
    editor.addEventListener('input',()=>{
      window.__fixtureEvents.draft=editor.innerText;
      if(!editor.innerText.trim())document.querySelector('[data-fixture-menu]')?.remove();
    });
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
    menuPresent:!!document.querySelector('[data-fixture-menu]'),
    skillChips:document.querySelectorAll('[skill-mention-path]').length,
    nativeSelections:window.__fixtureNativeSelections??0,
    editorFocused:document.activeElement===document.querySelector('[data-codex-composer]'),
  })`);
  const draft = async (text, options = {}) =>
    run(`window.__fixtureSetDraft(${JSON.stringify(text)},${JSON.stringify(options)})`);
  const press = async (key, options = {}) => {
    await run(`(()=>{
      const editor=document.querySelector('[data-codex-composer]'),options=${JSON.stringify(options)};
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...options}));
      editor.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...options}));
    })()`);
    await settle();
    return snapshot();
  };
  const enter = (options) => press('Enter', options),
    tab = (options) => press('Tab', options);
  const pressBrowserKey = async (key) => {
    const code = key === 'Tab' ? 9 : 13;
    for (const type of ['keyDown', 'keyUp'])
      await connection.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
      });
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
  const minimalHeader = await run(`(()=>{
    const header=window.__codexReasoningViewer.getElement().querySelector('[data-reasoning-viewer-part="header"]');
    return{
      title:header.querySelector('[data-reasoning-viewer-part="title"]').textContent,
      buttons:header.querySelectorAll('button').length,
      selectors:header.querySelectorAll('select').length,
      previous:!!header.querySelector('[data-reasoning-viewer-previous-turn]'),
      next:!!header.querySelector('[data-reasoning-viewer-next-turn]'),
      turn:header.querySelector('[data-reasoning-viewer-turn]').selectedOptions[0]?.textContent,
      source:!!header.querySelector('[data-reasoning-viewer-part="source"]'),
      navigation:!!document.querySelector('[data-reasoning-viewer-part="navigation"]'),
    };
  })()`);
  assert.deepEqual(minimalHeader, {
    title: 'Done',
    buttons: 2,
    selectors: 1,
    previous: true,
    next: true,
    turn: '1/1 turns',
    source: false,
    navigation: false,
  });
  cases.push(
    'the English header contains only the indicator, status label and arrow turn navigation',
  );
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

  for (const [command, enabled] of [
    ['/cot off', false],
    ['/cot-on', true],
    ['/cot', false],
    ['/cot on', true],
  ]) {
    const before = await snapshot();
    await draft(command);
    const after = await tab();
    assert.equal(after.status.enabled, enabled);
    assert.equal(after.status.controls.executed, before.status.controls.executed + 1);
    assert.equal(after.events.submits, before.events.submits);
    assert.equal(after.events.keydown, before.events.keydown);
    assert.equal(after.events.keyup, before.events.keyup);
    assert.equal(after.editor, '');
  }
  for (const entry of [
    { text: '/review' },
    { text: '/cot invalid' },
    { text: '/cot off', draft: { caret: 'middle' } },
    { text: '/cot off', draft: { atom: true } },
    { text: '/cot off', draft: { blocks: true } },
    ...['shiftKey', 'altKey', 'ctrlKey', 'metaKey', 'isComposing'].map((key) => ({
      text: '/cot off',
      key: { [key]: true },
    })),
    { text: '/cot off', key: { keyCode: 229 } },
  ]) {
    const before = await snapshot();
    await draft(entry.text, entry.draft);
    const after = await tab(entry.key);
    assert.equal(after.events.keydown, before.events.keydown + 1);
    assert.equal(after.status.controls.executed, before.status.controls.executed);
  }
  cases.push(
    'Tab applies local controls immediately without submission and preserves normal navigation, modifiers, drafts and IME',
  );

  await run(`(()=>{
    window.__fixtureMenu=(name,foreign=false,{kind='native',selected=true,disabled=false}={})=>{
      document.querySelector('[data-fixture-menu]')?.remove();
      const list=document.createElement('div'),option=document.createElement('div');
      list.dataset.fixtureMenu='';
      option.id='fixture-menu-option';
      if(kind==='cmdk'){
        list.setAttribute('cmdk-list','');list.setAttribute('role','listbox');
        if(selected)list.setAttribute('aria-activedescendant',option.id);
        option.setAttribute('cmdk-item','');option.setAttribute('role','option');
        option.setAttribute('aria-selected',String(selected));option.setAttribute('data-selected',String(selected));
        option.setAttribute('data-disabled',String(disabled));
      }else{
        list.setAttribute('data-mention-list-scroll-area','');
        option.setAttribute('data-list-navigation-item','true');
        if(kind==='listbox'){
          list.setAttribute('role','listbox');option.setAttribute('role','option');
          option.setAttribute('aria-selected',String(selected));
        }else if(selected)option.setAttribute('aria-current','true');
        if(disabled)option.setAttribute('aria-disabled','true');
      }
      option.textContent='An ambiguous title must not decide identity';
      const path='C:/'+(foreign?'another-plugin':'viewer-fixture')+'/'+name+'/SKILL.md';
      option.__fixtureSkill={name,path};
      Object.defineProperty(option,'__reactFiber$fixture',{value:{
        key:null,return:{key:'skill:'+path,return:null},
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
    const option=document.querySelector('[data-list-navigation-item="true"]');
    option.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
    option.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  })()`);
  await settle();
  assert.equal((await snapshot()).status.enabled, true);
  assert.equal((await snapshot()).events.submits, beforeMenu.events.submits);
  for (const kind of ['native', 'listbox', 'cmdk']) {
    for (const key of ['Tab', 'Enter']) {
      await draft(key === 'Tab' ? '/' : '/viewer');
      await run(`window.__fixtureMenu('cot-off',false,{kind:${JSON.stringify(kind)}})`);
      const before = await snapshot();
      const after = await (isolatedBrowser ? pressBrowserKey(key) : press(key));
      assert.equal(after.status.enabled, false, kind + '/' + key);
      assert.equal(after.status.controls.lastAction, 'hide');
      assert.equal(after.status.controls.executed, before.status.controls.executed + 1);
      assert.equal(after.events.submits, before.events.submits);
      assert.equal(after.editor, '');
      assert.equal(after.skillChips, 0);
      assert.equal(after.menuPresent, false);
      assert.equal(after.editorFocused, true);
    }
  }
  for (const key of ['Tab', 'Enter']) {
    for (const options of [{ foreign: true }, { selected: false }, { disabled: true }]) {
      await draft('/cot');
      await run(
        `window.__fixtureMenu('cot-off',${options.foreign === true},${JSON.stringify(options)})`,
      );
      const before = await snapshot();
      const after = await press(key);
      assert.equal(after.status.controls.executed, before.status.controls.executed);
      assert.equal(after.events.keydown, before.events.keydown + 1);
    }
  }
  await run("document.querySelector('[data-fixture-menu]').remove()");
  cases.push(
    'native suggestion rows, ARIA listboxes and cmdk menus apply the highlighted control on Tab, Enter or click; foreign, disabled and unknown selections pass through',
  );

  for (const key of ['Enter', 'Tab']) {
    await draft('/co');
    await run("window.__fixtureMenu('cot-on');window.__fixtureNativeFirst=true");
    const before = await snapshot();
    const after = await (isolatedBrowser ? pressBrowserKey(key) : press(key));
    assert.equal(after.nativeSelections, before.nativeSelections + 1);
    assert.equal(after.status.enabled, true);
    assert.equal(after.status.controls.executed, before.status.controls.executed + 1);
    assert.equal(after.events.submits, before.events.submits);
    assert.equal(after.editor, '');
    assert.equal(after.skillChips, 0);
    assert.equal(after.menuPresent, false);
    assert.equal(after.editorFocused, true);
    await run('window.__fixtureNativeFirst=false');
  }
  await draft('/cot');
  const beforeRepeat = await snapshot();
  await run(`(()=>{
    const editor=document.querySelector('[data-codex-composer]');
    for(const repeat of[false,true,true])editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat,bubbles:true,cancelable:true}));
    editor.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));
  })()`);
  await settle();
  const afterRepeat = await snapshot();
  assert.equal(afterRepeat.status.controls.executed, beforeRepeat.status.controls.executed + 1);
  assert.equal(afterRepeat.events.submits, beforeRepeat.events.submits);
  cases.push(
    'native-first keyboard handlers still execute a single local action and clear inserted skill chips; held keys never submit',
  );

  await draft('');
  await run('window.__codexReasoningViewer.setEnabled(false)');
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
  cases.push('API and cross-window visibility fully remove UI; the local command reopens it');

  await run(`(()=>{
    const api=window.__codexReasoningViewer;
    api.setEnabled(true);api.setTurn('turn-one');
    api.configure({mode:'raw',follow:false,height:180,collapsed:false,indicatorColor:'#123456'});
  })()`);
  await settle();
  const configured = await run(`(()=>{
    const api=window.__codexReasoningViewer,panel=api.getElement();
    return{settings:api.settings(),text:panel.querySelector('pre').textContent,
      dot:getComputedStyle(panel.querySelector('[data-reasoning-viewer-part="dot"]')).backgroundColor};
  })()`);
  assert.deepEqual(configured.settings, {
    mode: 'raw',
    follow: false,
    collapsed: false,
    height: 180,
    indicatorColor: '#123456',
  });
  assert.equal(configured.text, 'INITIAL_RAW\n\nSECOND_RAW');
  assert.equal(configured.dot, 'rgb(18, 52, 86)');
  const invalidConfiguration = await run(`(()=>{
    const api=window.__codexReasoningViewer,before=JSON.stringify(api.settings());
    let rejected=false;
    try{api.configure({mode:'summary',indicatorColor:'url(https://invalid.example/image)'});}catch{rejected=true;}
    return{rejected,unchanged:JSON.stringify(api.settings())===before};
  })()`);
  assert.deepEqual(invalidConfiguration, { rejected: true, unchanged: true });
  await run("window.__codexReasoningViewer.configure({mode:'summary',collapsed:true})");
  await settle();
  const collapsedSettings = await run(`({
    text:window.__codexReasoningViewer.getElement().querySelector('pre').textContent,
    collapsed:window.__codexReasoningViewer.getElement().querySelector('pre').hidden,
    settings:window.__codexReasoningViewer.settings(),
  })`);
  assert.equal(collapsedSettings.text, 'INITIAL_SUMMARY');
  assert.equal(collapsedSettings.collapsed, true);
  assert.equal(collapsedSettings.settings.collapsed, true);
  await run(`(()=>{
    document.documentElement.style.setProperty('--codex-base-accent','#a67df2');
    window.__codexReasoningViewer.configure({indicatorColor:'auto'});
  })()`);
  const automaticColor = await run(
    'getComputedStyle(window.__codexReasoningViewer.getElement().querySelector(\'[data-reasoning-viewer-part="dot"]\')).backgroundColor',
  );
  assert.equal(automaticColor, 'rgb(166, 125, 242)');
  await run("document.documentElement.style.setProperty('--codex-base-accent','#00aa77')");
  const changedColor = await run(
    'getComputedStyle(window.__codexReasoningViewer.getElement().querySelector(\'[data-reasoning-viewer-part="dot"]\')).backgroundColor',
  );
  assert.equal(changedColor, 'rgb(0, 170, 119)');
  await run('window.__codexReasoningViewer.configure({height:18,collapsed:true})');
  await settle();
  const compactCollapsed = await snapshot();
  assert.equal(compactCollapsed.status.resize.compact, false);
  assert.equal(compactCollapsed.status.collapsed, true);
  assert.equal(
    await run(
      'window.__codexReasoningViewer.getElement().querySelector(\'[data-reasoning-viewer-part="title"]\').getClientRects().length>0',
    ),
    true,
  );
  await run('window.__codexReasoningViewer.configure({collapsed:false})');
  await settle();
  const compactExpanded = await snapshot();
  assert.equal(compactExpanded.status.resize.compact, true);
  assert.equal(compactExpanded.status.collapsed, false);
  assert.equal(compactExpanded.text, 'INITIAL_SUMMARY');
  await run(
    "window.__codexReasoningViewer.configure({mode:'auto',follow:true,collapsed:false,height:null,indicatorColor:'auto'});window.__codexReasoningViewer.setEnabled(false)",
  );
  await settle();
  cases.push(
    'settings change source, following, collapse and height without toolbar UI; indicator color follows theme changes, supports overrides and rejects invalid patches atomically',
  );

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
    kind:
      'owned iframe in ' +
      (isolatedBrowser ? 'an isolated browser' : 'the desktop renderer') +
      '; isolated storage and fake submit handlers; no model requests',
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
