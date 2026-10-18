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
  // A constructed sheet gives hover/focus states without an inline <style>, which CSP may block.
  const scope = '[data-reasoning-viewer="codex-reasoning-viewer-v1"]',
    part = (name) => scope + ' [data-reasoning-viewer-part="' + name + '"]';
  let sheet = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(
      [
        scope +
          '{--rv-line:color-mix(in srgb,currentColor 11%,transparent);--rv-fill:color-mix(in srgb,currentColor 7%,transparent);--rv-muted:color-mix(in srgb,currentColor 58%,transparent);box-sizing:border-box;margin:0 0 6px;min-width:0;border:1px solid var(--rv-line);border-radius:12px;background-color:var(--color-background-primary,transparent);background-image:linear-gradient(color-mix(in srgb,currentColor 2.5%,transparent),color-mix(in srgb,currentColor 2.5%,transparent));font-size:12px;line-height:1.5;overflow:hidden}',
        scope + '[hidden],' + scope + ' [hidden]{display:none!important}',
        part('header') +
          '{display:flex;align-items:center;gap:2px;min-height:28px;padding:1px 4px 1px 10px}',
        part('dot') +
          '{flex:none;width:6px;height:6px;margin-right:6px;border-radius:50%;background:currentColor;opacity:.3}',
        part('dot') +
          '[data-running]{opacity:.85;animation:codex-reasoning-viewer-pulse 1.4s ease-in-out infinite}',
        '@keyframes codex-reasoning-viewer-pulse{50%{opacity:.2}}',
        part('title') + '{flex:none;font-weight:500;white-space:nowrap}',
        part('source') +
          '{flex:1 1 auto;min-width:0;margin-left:8px;color:var(--rv-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        scope +
          ' button,' +
          scope +
          ' select' +
          '{box-sizing:border-box;flex:none;height:22px;margin:0;padding:0 7px;border:0;border-radius:6px;font:inherit;color:inherit;background:transparent;opacity:.62;cursor:pointer;transition:background-color .12s,opacity .12s}',
        scope + ' select{min-width:0;padding:0 2px 0 6px}',
        scope +
          ' button:hover:not(:disabled),' +
          scope +
          ' select:hover,' +
          scope +
          ' button[aria-pressed="true"]{opacity:1;background:var(--rv-fill)}',
        scope + ' button:disabled{opacity:.25;cursor:default}',
        scope +
          ' button:focus-visible,' +
          scope +
          ' select:focus-visible,' +
          scope +
          ' pre:focus-visible{opacity:1;outline:2px solid color-mix(in srgb,currentColor 28%,transparent);outline-offset:-2px}',
        part('navigation') + '{display:flex;align-items:center;gap:2px;padding:0 4px 4px}',
        scope +
          ' [data-reasoning-viewer-previous-turn],' +
          scope +
          ' [data-reasoning-viewer-next-turn]{width:22px;padding:0;font-size:15px;line-height:1}',
        scope + ' [data-reasoning-viewer-turn]{max-width:240px;font-variant-numeric:tabular-nums}',
        scope +
          ' [data-reasoning-viewer-latest]{margin-left:auto;opacity:.85;background:var(--rv-fill)}',
        scope +
          ' pre{box-sizing:border-box;margin:0;padding:8px 12px 10px;border-top:1px solid var(--rv-line);max-height:200px;overflow:auto;overscroll-behavior:contain;font:inherit;color:color-mix(in srgb,currentColor 82%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,currentColor 22%,transparent) transparent}',
        // resize.js styles its grip inline; keep it quiet until the handle is used.
        scope +
          ' [data-reasoning-viewer-resize]>span{opacity:.15!important;transition:opacity .12s}',
        scope +
          ' [data-reasoning-viewer-resize]:hover>span,' +
          scope +
          ' [data-reasoning-viewer-resize]:focus-visible>span{opacity:.45!important}',
        '@media (prefers-reduced-motion:reduce){' +
          scope +
          ' *{transition:none!important;animation:none!important}}',
      ].join('\n'),
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    sheet = null;
  }
  const bar = document.createElement('div');
  bar.dataset.reasoningViewerPart = 'header';
  const dot = document.createElement('span');
  dot.dataset.reasoningViewerPart = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong');
  title.dataset.reasoningViewerPart = 'title';
  title.textContent = '\u601d\u8003';
  const source = document.createElement('span');
  source.dataset.reasoningViewerPart = 'source';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '\u601d\u8003\u5185\u5bb9');
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
  bar.append(dot, title, source, select, followButton, toggle, hideButton);
  const navigation = document.createElement('div');
  navigation.dataset.reasoningViewerPart = 'navigation';
  const previous = button('\u2039', '\u4e0a\u4e00\u56de\u5408'),
    next = button('\u203a', '\u4e0b\u4e00\u56de\u5408');
  previous.dataset.reasoningViewerPreviousTurn = '';
  next.dataset.reasoningViewerNextTurn = '';
  const turnSelect = document.createElement('select');
  turnSelect.dataset.reasoningViewerTurn = '';
  turnSelect.setAttribute('aria-label', '\u9009\u62e9\u601d\u8003\u56de\u5408');
  const latest = button('\u56de\u5230\u6700\u65b0');
  latest.dataset.reasoningViewerLatest = '';
  navigation.append(previous, turnSelect, next, latest);
  const body = document.createElement('pre');
  body.tabIndex = 0;
  body.setAttribute('aria-label', '\u5b8c\u6574\u601d\u8003\u5185\u5bb9');
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
    latest.hidden = state.followingLatest;
    latest.textContent =
      '\u56de\u5230\u6700\u65b0' +
      (index >= 0 && index < count - 1 ? ' (' + (count - index - 1) + ')' : '');
    navigation.hidden = !count;
  }
  function render() {
    renderScheduled = false;
    if (disposed) return;
    if (!enabled) return;
    mount();
    const state = current ? session() : { turns: [], followingLatest: true },
      turn = activeTurn();
    panel.hidden = !current || !state.turns.length;
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
    dot.toggleAttribute('data-running', turn?.isRunning === true);
    followButton.setAttribute('aria-pressed', String(follow));
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
    if (disposed || !enabled) return false;
    const target = composerTarget();
    if (!target) return false;
    if (panel.parentElement !== target) target.append(panel);
    return true;
  }
  function setEnabled(value, { save = true } = {}) {
    enabled = value === true;
    if (!enabled) {
      panel.hidden = true;
      panel.remove();
    }
    if (save)
      try {
        window.localStorage.setItem(enabledKey, String(enabled));
      } catch {}
    window.dispatchEvent(
      new CustomEvent('codex-reasoning-viewer:visibility', { detail: { enabled } }),
    );
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
      if (sheet)
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
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
