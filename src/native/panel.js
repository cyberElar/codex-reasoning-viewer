(() => {
  const key = '__codexReasoningViewer';
  if (window[key]) return window[key].status();
  const controller = new AbortController(),
    signal = controller.signal,
    sessions = new Map();
  let current = null,
    mode = 'auto',
    follow = true,
    disposed = false,
    renderScheduled = false,
    resetScroll = false;
  const enabledKey = 'codex-reasoning-viewer:enabled:v1';
  let enabled = true;
  try {
    enabled = window.localStorage.getItem(enabledKey) !== 'false';
  } catch {}
  const panel = document.createElement('section');
  panel.dataset.reasoningViewer = 'codex-reasoning-viewer-v1';
  panel.style.cssText =
    'margin:0 0 6px;min-width:0;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;background:var(--color-background-primary,transparent);font-size:12px;line-height:1.5;overflow:hidden;';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 10px;';
  const title = document.createElement('strong');
  title.textContent = '\u601d\u8003';
  const source = document.createElement('span');
  source.style.cssText = 'opacity:.6;flex:1;';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '\u601d\u8003\u5185\u5bb9');
  const selectStyle =
    'font:inherit;color:inherit;background:transparent;border:0;outline-offset:3px;min-width:0;';
  select.style.cssText = selectStyle;
  for (const [value, label] of [
    ['auto', '\u81ea\u52a8'],
    ['summary', '\u6458\u8981'],
    ['raw', '\u539f\u6587'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  function button(text, label) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.style.cssText =
      'font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;opacity:.7;';
    if (label) {
      node.title = label;
      node.setAttribute('aria-label', label);
    }
    return node;
  }
  const followButton = button('\u8ddf\u968f'),
    toggle = button('\u6536\u8d77'),
    hideButton = button('\u9690\u85cf');
  toggle.setAttribute('aria-expanded', 'true');
  hideButton.title = '/cot off';
  bar.append(title, source, select, followButton, toggle, hideButton);
  const showButton = button('\u601d\u8003', '\u663e\u793a\u601d\u8003\u680f /cot on');
  showButton.dataset.reasoningViewerShow = '';
  showButton.style.cssText +=
    'padding:5px 10px;margin-bottom:6px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;';
  const navigation = document.createElement('div');
  navigation.style.cssText =
    'display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:0 10px 6px;';
  const previous = button('\u2039', '\u4e0a\u4e00\u56de\u5408'),
    next = button('\u203a', '\u4e0b\u4e00\u56de\u5408');
  previous.dataset.reasoningViewerPreviousTurn = '';
  next.dataset.reasoningViewerNextTurn = '';
  const turnSelect = document.createElement('select');
  turnSelect.dataset.reasoningViewerTurn = '';
  turnSelect.setAttribute('aria-label', '\u9009\u62e9\u601d\u8003\u56de\u5408');
  turnSelect.style.cssText = selectStyle + 'max-width:240px;';
  const latest = button('\u56de\u5230\u6700\u65b0');
  latest.dataset.reasoningViewerLatest = '';
  navigation.append(previous, turnSelect, next, latest);
  const body = document.createElement('pre');
  body.tabIndex = 0;
  body.setAttribute('aria-label', '\u5b8c\u6574\u601d\u8003\u5185\u5bb9');
  body.style.cssText =
    'font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:0 10px 9px;max-height:200px;overflow:auto;overscroll-behavior:contain;user-select:text;';
  panel.append(bar, navigation, body);
  function session(id = current) {
    if (!sessions.has(id))
      sessions.set(id, { turns: [], selected: null, followingLatest: true, complete: true });
    return sessions.get(id);
  }
  function activeTurn() {
    if (!current) return null;
    const state = session();
    if (state.followingLatest) state.selected = state.turns.at(-1)?.turnId ?? null;
    return state.turns.find((turn) => turn.turnId === state.selected) ?? null;
  }
  function parts(value) {
    return (value ?? []).map((part) => (typeof part === 'string' ? part : (part?.text ?? '')));
  }
  function turnItems(turn) {
    return turn?.items ?? [];
  }
  function chosen(turn) {
    const texts = [],
      sources = new Set();
    for (const item of turnItems(turn)) {
      const summary = parts(item.summary).join('\n\n'),
        raw = parts(item.content).join('\n\n');
      const useSummary = mode === 'summary' || (mode === 'auto' && summary.trim());
      const text = useSummary ? summary : raw;
      if (text.trim()) {
        texts.push(text);
        sources.add(useSummary ? 'summary' : 'raw');
      }
    }
    const label =
      sources.size > 1
        ? '\u6458\u8981 / \u539f\u6587'
        : sources.has('summary') || mode === 'summary'
          ? '\u6458\u8981'
          : '\u539f\u6587';
    return { text: texts.join('\n\n'), label };
  }
  function syncNavigation(state, turn) {
    const count = state.turns.length,
      index = state.turns.findIndex((candidate) => candidate.turnId === turn?.turnId);
    while (turnSelect.options.length > count) turnSelect.remove(turnSelect.options.length - 1);
    for (let i = 0; i < count; i++) {
      const item = state.turns[i],
        option = turnSelect.options[i] ?? document.createElement('option');
      const count = item.items?.length ?? 0;
      const text =
        '\u7b2c ' +
        (i + 1) +
        ' / ' +
        state.turns.length +
        ' \u56de\u5408' +
        (count ? ' \u00b7 ' + count + ' \u6bb5' : '');
      if (option.value !== item.turnId) option.value = item.turnId;
      if (option.textContent !== text) option.textContent = text;
      if (!option.parentElement) turnSelect.append(option);
    }
    turnSelect.value = turn?.turnId ?? '';
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index >= count - 1;
    previous.style.opacity = previous.disabled ? '.3' : '.8';
    next.style.opacity = next.disabled ? '.3' : '.8';
    latest.hidden = state.followingLatest;
    latest.textContent =
      '\u56de\u5230\u6700\u65b0' +
      (index >= 0 && index < count - 1 ? ' (' + (count - index - 1) + ')' : '');
    navigation.hidden = !count;
  }
  function render() {
    renderScheduled = false;
    if (disposed) return;
    const state = current ? session() : { turns: [], followingLatest: true },
      turn = activeTurn();
    panel.hidden = !enabled || !current || !state.turns.length;
    showButton.hidden = enabled;
    if (!enabled) return;
    const value = chosen(turn);
    const empty =
      mode === 'summary'
        ? '\u672c\u56de\u5408\u672a\u6536\u5230\u6458\u8981'
        : mode === 'raw'
          ? '\u672c\u56de\u5408\u672a\u6536\u5230\u63a8\u7406\u539f\u6587'
          : turn?.isRunning
            ? '\u7b49\u5f85\u53ef\u663e\u793a\u7684\u601d\u8003\u6587\u672c'
            : '\u672c\u56de\u5408\u672a\u6536\u5230\u53ef\u663e\u793a\u7684\u601d\u8003\u6587\u672c';
    const text = value.text || empty,
      oldText = body.textContent,
      scrollTop = body.scrollTop;
    if (text !== oldText) {
      if (body.firstChild?.nodeType === 3 && text.startsWith(oldText))
        body.firstChild.appendData(text.slice(oldText.length));
      else body.textContent = text;
    }
    source.textContent = value.label + (turn?.isRunning ? ' \u00b7 \u8fdb\u884c\u4e2d' : '');
    followButton.style.opacity = follow ? '1' : '.45';
    syncNavigation(state, turn);
    if (resetScroll) {
      body.scrollTop = 0;
      resetScroll = false;
    } else if (follow) body.scrollTop = body.scrollHeight;
    else if (text !== oldText) body.scrollTop = scrollTop;
  }
  function schedule() {
    if (disposed || renderScheduled) return;
    renderScheduled = true;
    let complete = false,
      frame,
      timer;
    const run = () => {
      if (complete) return;
      complete = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      render();
    };
    frame = requestAnimationFrame(run);
    timer = setTimeout(run, 40);
  }
  function composerTarget() {
    const targets = [...document.querySelectorAll('[data-above-composer-portal]')];
    const visible = (element) => {
      if (!element?.getClientRects().length) return false;
      return !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
    };
    // Empty portals hide themselves; the owning editor identifies the active composer.
    const active = targets.filter((target) => {
      const root = target.closest('[data-codex-composer-root]');
      return visible(root) && visible(root.querySelector('[data-codex-composer]'));
    });
    return (
      active.find((target) => target.hasAttribute('data-above-composer-conversation-id')) ??
      active[0] ??
      targets.find(visible) ??
      targets.find((target) => visible(target.closest('[data-codex-composer-root]'))) ??
      null
    );
  }
  function mount() {
    if (disposed) return false;
    const target = composerTarget();
    if (!target) return false;
    if (panel.parentElement !== target) target.append(panel);
    if (showButton.parentElement !== target) target.append(showButton);
    return true;
  }
  function setEnabled(value, { save = true } = {}) {
    enabled = value === true;
    if (save)
      try {
        window.localStorage.setItem(enabledKey, String(enabled));
      } catch {}
    schedule();
    return enabled;
  }
  function navigate(id) {
    if (!current) return;
    const state = session(),
      index = state.turns.findIndex((turn) => turn.turnId === id);
    if (index < 0) return;
    state.selected = id;
    state.followingLatest = index === state.turns.length - 1;
    follow = state.followingLatest;
    resetScroll = !follow;
    schedule();
  }
  function step(amount) {
    const state = session(),
      index = state.turns.findIndex((turn) => turn.turnId === activeTurn()?.turnId);
    if (state.turns[index + amount]) navigate(state.turns[index + amount].turnId);
  }
  function setHistory(snapshot) {
    const state = session(snapshot.threadId);
    state.turns = snapshot.turns ?? [];
    state.complete = snapshot.isComplete !== false;
    if (!state.followingLatest && !state.turns.some((turn) => turn.turnId === state.selected)) {
      state.selected = state.turns[0]?.turnId ?? null;
    }
    if (current === snapshot.threadId) schedule();
  }
  function setSnapshot(snapshot) {
    const id = snapshot.threadId ?? null;
    if (!id) {
      api.setThread(null);
      return;
    }
    const state = session(id),
      turnId = snapshot.turnId ?? 'legacy-current-turn';
    const index = state.turns.findIndex((turn) => turn.turnId === turnId);
    const turn =
      index < 0
        ? { turnId, items: [] }
        : { ...state.turns[index], items: [...state.turns[index].items] };
    const itemId = snapshot.itemId ?? 'legacy-reasoning',
      itemIndex = turn.items.findIndex((item) => item.itemId === itemId);
    const item = { itemId, summary: parts(snapshot.summary), content: parts(snapshot.content) };
    if (itemIndex < 0) turn.items.push(item);
    else turn.items[itemIndex] = item;
    turn.isRunning = snapshot.isRunning === true;
    state.turns = [...state.turns];
    if (index < 0) state.turns.push(turn);
    else state.turns[index] = turn;
    if (current !== id) api.setThread(id);
    schedule();
  }
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target !== panel && !panel.contains(record.target)))
      mount();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-above-composer-conversation-id'],
  });
  select.addEventListener(
    'change',
    () => {
      mode = select.value;
      follow = true;
      schedule();
    },
    { signal },
  );
  followButton.addEventListener(
    'click',
    () => {
      follow = true;
      schedule();
    },
    { signal },
  );
  hideButton.addEventListener('click', () => setEnabled(false), { signal });
  showButton.addEventListener('click', () => setEnabled(true), { signal });
  window.addEventListener(
    'storage',
    (event) => {
      if (event.key === enabledKey) setEnabled(event.newValue !== 'false', { save: false });
    },
    { signal },
  );
  toggle.addEventListener(
    'click',
    () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '\u5c55\u5f00' : '\u6536\u8d77';
      toggle.setAttribute('aria-expanded', String(!body.hidden));
    },
    { signal },
  );
  previous.addEventListener('click', () => step(-1), { signal });
  next.addEventListener('click', () => step(1), { signal });
  turnSelect.addEventListener('change', () => navigate(turnSelect.value), { signal });
  latest.addEventListener(
    'click',
    () => {
      const turn = session().turns.at(-1);
      if (turn) navigate(turn.turnId);
    },
    { signal },
  );
  body.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY < 0) follow = false;
    },
    { passive: true, signal },
  );
  body.addEventListener(
    'scroll',
    () => {
      follow = body.scrollHeight - body.clientHeight - body.scrollTop < 12;
    },
    { passive: true, signal },
  );
  const api = {
    version: 3,
    composerTarget,
    getElement() {
      return panel;
    },
    setHistory,
    setSnapshot,
    setEnabled,
    toggle() {
      return setEnabled(!enabled);
    },
    setTurn: navigate,
    goLatest() {
      const turn = session().turns.at(-1);
      if (turn) navigate(turn.turnId);
    },
    setThread(id) {
      if (current !== id) {
        current = id;
        follow = true;
        resetScroll = false;
        schedule();
      }
    },
    handleNotification(notification) {
      const params = notification.params ?? {};
      if (
        params.threadId !== current ||
        !['item/reasoning/textDelta', 'item/reasoning/summaryTextDelta'].includes(
          notification.method,
        )
      )
        return;
      const state = session(),
        turnId = params.turnId ?? activeTurn()?.turnId ?? 'legacy-current-turn';
      const turn = state.turns.find((turn) => turn.turnId === turnId),
        item = turn?.items.find((item) => item.itemId === params.itemId);
      const raw = notification.method === 'item/reasoning/textDelta',
        index = raw ? params.contentIndex : params.summaryIndex;
      if (!Number.isSafeInteger(index) || index < 0 || typeof params.delta !== 'string') return;
      const summary = parts(item?.summary),
        content = parts(item?.content),
        values = raw ? content : summary;
      while (values.length <= index) values.push('');
      values[index] += params.delta;
      setSnapshot({
        threadId: current,
        turnId,
        itemId: params.itemId,
        summary,
        content,
        isRunning: true,
      });
    },
    historyMetadata() {
      return current
        ? session().turns.map((turn, index) => ({
            turnId: turn.turnId,
            index: index + 1,
            reasoningItems: turn.items.length,
            isRunning: turn.isRunning,
            summaryChars: turn.items.flatMap((item) => parts(item.summary)).join('').length,
            rawChars: turn.items.flatMap((item) => parts(item.content)).join('').length,
          }))
        : [];
    },
    status() {
      const turn = activeTurn(),
        items = turnItems(turn),
        state = current ? session() : null;
      return {
        version: 3,
        enabled,
        mounted: panel.isConnected,
        visible: !panel.hidden && panel.getBoundingClientRect().height > 0,
        renderPending: renderScheduled,
        mode,
        follow,
        isRunning: turn?.isRunning === true,
        threadId: current,
        turnId: turn?.turnId ?? null,
        itemId: items.at(-1)?.itemId ?? null,
        turnCount: state?.turns.length ?? 0,
        turnIndex: state ? state.turns.indexOf(turn) + 1 : 0,
        followingLatestTurn: state?.followingLatest ?? true,
        reasoningItems: items.length,
        historyComplete: state?.complete ?? true,
        summaryChars: items.flatMap((item) => parts(item.summary)).join('').length,
        rawChars: items.flatMap((item) => parts(item.content)).join('').length,
      };
    },
    dispose() {
      disposed = true;
      controller.abort();
      observer.disconnect();
      panel.remove();
      showButton.remove();
      sessions.clear();
      delete window[key];
      return { disposed: true };
    },
  };
  window[key] = api;
  mount();
  render();
  return api.status();
})();
