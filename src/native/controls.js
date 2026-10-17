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
  function match(editor) {
    if (!editor || !atEnd(editor)) return null;
    const text = textOnly(editor);
    return text === null ? null : parseCommand(text);
  }
  function showHint(text) {
    const target = api.composerTarget();
    if (!target) return;
    if (hint.parentElement !== target) target.append(hint);
    hint.textContent = text;
    hint.hidden = false;
  }
  function refreshHint(event) {
    const editor = editorFor(event?.target) ?? editorFor(document.activeElement),
      text = editor ? textOnly(editor) : null;
    const action = text === null ? null : parseCommand(text);
    if (action === null) {
      hint.hidden = true;
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
        '\u672c\u5730\u6307\u4ee4\u672a\u6267\u884c\uff0c\u53ef\u4f7f\u7528\u601d\u8003\u680f\u6309\u94ae',
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
      const button = sendButton(event.target),
        editor = editorForButton(button);
      if (button && match(editor) !== null) block(event);
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'click',
    (event) => {
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
  document.addEventListener('selectionchange', refreshHint, { signal });
  const status = () => ({ version: 1, executed, lastAction, lastError });
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
  window[key] = { status, dispose };
  api.status = wrappedStatus;
  api.dispose = wrappedDispose;
  return status();
})();
