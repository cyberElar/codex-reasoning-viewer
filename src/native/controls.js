(() => {
  const key = '__codexReasoningControls',
    api = window.__codexReasoningViewer;
  if (window[key]) return window[key].status();
  if (typeof api?.setEnabled !== 'function')
    throw new Error('Viewer visibility controls are unavailable');
  const controller = new AbortController(),
    signal = controller.signal;
  const originalStatus = api.status,
    originalDispose = api.dispose;
  const skillActions = { cot: 'toggle', 'cot-on': 'show', 'cot-off': 'hide' };
  const skillPaths = new Map();
  const normalizedPath = (value) => value.replaceAll('\\', '/').toLowerCase();
  let executed = 0,
    lastAction = null,
    lastError = null,
    consumedEnter = false,
    disposed = false;
  const hint = document.createElement('div');
  hint.dataset.reasoningViewerCommandHint = '';
  hint.hidden = true;
  hint.setAttribute('role', 'status');
  hint.style.cssText =
    'font-size:12px;line-height:1.5;padding:5px 10px;margin-bottom:6px;border-radius:8px;background:color-mix(in srgb,currentColor 7%,transparent);opacity:.8;';
  const usage = '/cot \u5207\u6362 \u00b7 /cot on \u663e\u793a \u00b7 /cot off \u9690\u85cf';

  function parseCommand(value) {
    if (/[\r\n]/.test(value)) return null;
    const text = value.trim();
    const alias = text.match(/^\/cot-(on|off)(?:[ \t]+(.*))?$/i);
    if (alias)
      return alias[2]?.trim() ? 'invalid' : alias[1].toLowerCase() === 'on' ? 'show' : 'hide';
    if (!/^\/cot(?:[ \t]|$)/i.test(text)) return null;
    const argument = text.slice(4).trim().toLowerCase();
    if (argument === '' || argument === 'toggle') return 'toggle';
    if (argument === 'on' || argument === 'show') return 'show';
    if (argument === 'off' || argument === 'hide') return 'hide';
    return 'invalid';
  }
  function editorFor(target) {
    return target?.closest?.('[data-codex-composer][contenteditable="true"]') ?? null;
  }
  function textOnly(editor) {
    const node = editor.pmViewDesc?.node;
    if (node) {
      if (node.childCount !== 1 || !node.firstChild?.isTextblock) return null;
      for (let index = 0; index < node.firstChild.childCount; index++)
        if (!node.firstChild.child(index).isText) return null;
      return node.textContent;
    }
    if (editor.querySelector('img,[contenteditable="false"],br') || editor.children.length > 1)
      return null;
    return editor.innerText ?? editor.textContent ?? '';
  }
  function atEnd(editor) {
    const selection = editor.ownerDocument.defaultView.getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode))
      return false;
    const tail = editor.ownerDocument.createRange();
    tail.selectNodeContents(editor);
    tail.setStart(selection.focusNode, selection.focusOffset);
    return tail.toString() === '';
  }
  function skillCommand(editor) {
    const doc = editor.pmViewDesc?.node;
    if (doc?.childCount !== 1 || !doc.firstChild?.isTextblock) return null;
    let skill = null,
      suffix = '';
    for (let index = 0; index < doc.firstChild.childCount; index++) {
      const node = doc.firstChild.child(index);
      if (node.isText) {
        const text = node.text ?? node.textContent ?? '';
        if (/[\r\n]/.test(text)) return null;
        if (skill) suffix += text;
        else if (text.trim()) return null;
      } else if (
        !skill &&
        node.type?.name === 'skillMention' &&
        typeof node.attrs?.path === 'string'
      ) {
        const binding = skillPaths.get(normalizedPath(node.attrs.path));
        if (!binding || binding.name !== node.attrs.name) return null;
        skill = binding;
      } else return null;
    }
    if (!skill) return null;
    if (skill.name === 'cot') return parseCommand('/cot ' + suffix);
    return suffix.trim() ? null : skill.action;
  }
  function commandInEditor(editor) {
    if (!editor) return null;
    const skill = skillCommand(editor);
    if (skill !== null) return skill;
    const text = textOnly(editor);
    return text === null ? null : parseCommand(text);
  }
  function bindingForOption(option) {
    if (
      !option?.matches?.('[cmdk-item][role="option"]') ||
      option.getAttribute('data-disabled') === 'true'
    )
      return null;
    const key = Object.getOwnPropertyNames(option).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key ? option[key] : null;
    // Native option IDs are generated; the bounded React key retains the actual skill path.
    for (let depth = 0; fiber && depth < 32; depth++, fiber = fiber.return) {
      if (typeof fiber.key !== 'string' || !fiber.key.startsWith('skill:')) continue;
      const binding = skillPaths.get(normalizedPath(fiber.key.slice(6)));
      if (binding) return binding;
    }
    return null;
  }
  function menuQuery(editor) {
    if (!editor || !atEnd(editor)) return false;
    const value = textOnly(editor);
    if (value === null || /[\r\n]/.test(value)) return false;
    const query = value.trim().toLowerCase();
    return (
      query.startsWith('/') &&
      ['/cot', '/cot on', '/cot off', '/cot-on', '/cot-off', '/cot show', '/cot hide'].some(
        (command) => command.startsWith(query),
      )
    );
  }
  function activeMenu() {
    return [...document.querySelectorAll('[cmdk-list][role="listbox"]')].find(
      (list) => list.getClientRects().length && getComputedStyle(list).visibility !== 'hidden',
    );
  }
  function menuSelection(list) {
    const id = list?.getAttribute('aria-activedescendant');
    const active = id ? document.getElementById(id) : null;
    return active && list.contains(active)
      ? active
      : list?.querySelector('[cmdk-item][aria-selected="true"],[cmdk-item][data-selected="true"]');
  }
  function menuControl(target) {
    const option = target?.closest?.('[cmdk-item][role="option"]');
    if (!option?.closest('[cmdk-list][role="listbox"]')) return null;
    const binding = bindingForOption(option);
    const editor = api
      .composerTarget()
      ?.closest('[data-codex-composer-root]')
      ?.querySelector('[data-codex-composer][contenteditable="true"]');
    return binding && menuQuery(editor) ? { editor, action: binding.action } : null;
  }
  function match(editor) {
    if (!editor || !atEnd(editor)) return null;
    return commandInEditor(editor);
  }
  function showHint(text) {
    const target = api.composerTarget();
    if (!target) return;
    if (hint.parentElement !== target) target.append(hint);
    hint.textContent = text;
    hint.hidden = false;
  }
  function refreshHint(event) {
    const editor = editorFor(event?.target) ?? editorFor(document.activeElement);
    const action = commandInEditor(editor);
    if (action === null) {
      hint.hidden = true;
      hint.remove();
      return;
    }
    const label =
      action === 'show'
        ? '\u663e\u793a'
        : action === 'hide'
          ? '\u9690\u85cf'
          : api.status().enabled
            ? '\u9690\u85cf'
            : '\u663e\u793a';
    showHint(
      action === 'invalid'
        ? usage
        : 'Enter\uff1a' + label + '\u601d\u8003\u680f \u00b7 \u672c\u5730\u6307\u4ee4',
    );
  }
  function clearEditor(editor) {
    const document = editor.ownerDocument;
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = document.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
    if ((editor.innerText ?? editor.textContent ?? '').trim())
      throw new Error('The local command could not be cleared safely');
  }
  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function consume(event, editor, action) {
    block(event);
    if (action === 'invalid') {
      showHint(usage);
      return true;
    }
    try {
      clearEditor(editor);
      if (action === 'toggle') api.toggle();
      else api.setEnabled(action === 'show');
      executed++;
      lastAction = action;
      lastError = null;
      hint.hidden = true;
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 160);
      showHint(
        '\u672c\u5730\u6307\u4ee4\u672a\u6267\u884c\uff0c\u8bf7\u91cd\u8bd5 /cot on \u6216\u68c0\u67e5\u540e\u53f0\u72b6\u6001',
      );
    }
    return true;
  }
  function sendButton(target) {
    const button = target?.closest?.('button');
    if (!button?.closest('[data-codex-composer-root]')) return null;
    const label = button.getAttribute('aria-label') ?? '';
    if (/^(?:Stop|Cancel)(?:\s|$)|^(?:\u505c\u6b62|\u53d6\u6d88)/i.test(label)) return null;
    return button.type === 'submit' ||
      /^(?:Send|Queue|Steer|Resume)(?:\s|$)|^(?:\u53d1\u9001|\u6392\u961f|\u7ee7\u7eed|\u63d0\u4ea4)/i.test(
        label,
      )
      ? button
      : null;
  }
  function editorForButton(button) {
    return (
      button
        ?.closest('[data-codex-composer-root]')
        ?.querySelector('[data-codex-composer][contenteditable="true"]') ?? null
    );
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      const editor = editorFor(event.target),
        action = match(editor);
      const plain = editor ? textOnly(editor) : null;
      if (action !== null && plain && /^\/cot(?:-(?:on|off)|[ \t]+\S)/i.test(plain.trim())) {
        consumedEnter = true;
        consume(event, editor, action);
        return;
      }
      if (menuQuery(editor)) {
        const menu = activeMenu(),
          option = menuSelection(menu),
          binding = bindingForOption(option);
        if (binding) {
          consumedEnter = true;
          consume(event, editor, binding.action);
          return;
        }
        if (option) return;
        if (menu && action !== null) {
          consumedEnter = true;
          block(event);
          showHint(usage);
          return;
        }
      }
      if (action === null) return;
      consumedEnter = true;
      consume(event, editor, action);
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Enter' && consumedEnter) {
        consumedEnter = false;
        block(event);
      }
    },
    { capture: true, signal },
  );
  // Guard pointerdown as well as click, so native early-submit handlers cannot run.
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      if (menuControl(event.target)) {
        block(event);
        return;
      }
      const button = sendButton(event.target),
        editor = editorForButton(button);
      if (button && match(editor) !== null) block(event);
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'click',
    (event) => {
      const menu = menuControl(event.target);
      if (menu) {
        consume(event, menu.editor, menu.action);
        return;
      }
      const button = sendButton(event.target),
        editor = editorForButton(button),
        action = match(editor);
      if (button && action !== null) consume(event, editor, action);
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'submit',
    (event) => {
      const editor = event.target?.querySelector?.('[data-codex-composer][contenteditable="true"]'),
        action = match(editor);
      if (action !== null) consume(event, editor, action);
    },
    { capture: true, signal },
  );
  window.addEventListener('input', refreshHint, { capture: true, signal });
  window.addEventListener(
    'codex-reasoning-viewer:visibility',
    (event) => {
      if (event.detail?.enabled === false) {
        hint.hidden = true;
        hint.remove();
      }
    },
    { signal },
  );
  document.addEventListener('selectionchange', refreshHint, { signal });
  const status = () => ({
    version: 2,
    executed,
    lastAction,
    lastError,
    skillBindings: skillPaths.size,
  });
  const wrappedStatus = () => ({ ...originalStatus(), controls: status() });
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    hint.remove();
    if (api.status === wrappedStatus) api.status = originalStatus;
    if (api.dispose === wrappedDispose) api.dispose = originalDispose;
    delete window[key];
    return { disposed: true };
  }
  function wrappedDispose(...args) {
    dispose();
    return Reflect.apply(originalDispose, this, args);
  }
  function setSkillPaths(bindings) {
    skillPaths.clear();
    for (const binding of Array.isArray(bindings) ? bindings : []) {
      if (typeof binding?.path !== 'string' || !Object.hasOwn(skillActions, binding.name)) continue;
      skillPaths.set(normalizedPath(binding.path), {
        name: binding.name,
        action: skillActions[binding.name],
      });
    }
    return skillPaths.size;
  }
  window[key] = { status, dispose, setSkillPaths };
  api.status = wrappedStatus;
  api.dispose = wrappedDispose;
  return status();
})();
