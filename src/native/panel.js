(() => {
  const key = '__codexReasoningViewer';
  if (window[key]) return window[key].status();
  const controller = new AbortController(),
    signal = controller.signal,
    sessions = new Map();
  let current = null,
    mode = 'auto',
    // followPreference is the configured setting; follow is the current scroll-follow state.
    followPreference = true,
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
  panel.setAttribute('aria-label', 'Reasoning');
  // A constructed sheet gives hover/focus states without an inline <style>, which CSP may block.
  const scope = '[data-reasoning-viewer="codex-reasoning-viewer-v1"]',
    compactScope = scope + '[data-reasoning-viewer-compact]',
    part = (name) => scope + ' [data-reasoning-viewer-part="' + name + '"]';
  let sheet = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(
      [
        scope +
          // The native accent stays a live reference, so theme changes apply without polling.
          // Positioning anchors the resize edge; isolation keeps its z-index inside the panel.
          '{--rv-indicator-color:var(--codex-base-accent,var(--color-ring-primary,currentColor));--rv-line:color-mix(in srgb,currentColor 11%,transparent);--rv-fill:color-mix(in srgb,currentColor 7%,transparent);--rv-muted:color-mix(in srgb,currentColor 58%,transparent);position:relative;isolation:isolate;box-sizing:border-box;margin:0 0 6px;min-width:0;border:1px solid var(--rv-line);border-radius:12px;background-color:var(--color-background-primary,transparent);background-image:linear-gradient(color-mix(in srgb,currentColor 2.5%,transparent),color-mix(in srgb,currentColor 2.5%,transparent));font-size:12px;line-height:1.5;overflow:hidden}',
        scope + '[hidden],' + scope + ' [hidden]{display:none!important}',
        // The 22px turn controls keep an even 4px inset from the top, right and bottom edges;
        // the indicator lines up with the reasoning text below it.
        part('header') +
          '{box-sizing:border-box;display:flex;align-items:center;column-gap:7px;min-height:30px;padding:0 4px 0 12px}',
        part('dot') +
          '{flex:none;width:6px;height:6px;border-radius:50%;background:var(--rv-indicator-color);opacity:.45}',
        part('dot') +
          '[data-running]{opacity:1;animation:codex-reasoning-viewer-pulse 1.4s ease-in-out infinite}',
        '@keyframes codex-reasoning-viewer-pulse{50%{opacity:.35}}',
        part('title') + '{flex:none;font-weight:500;white-space:nowrap}',
        part('turns') +
          '{display:flex;align-items:center;flex:none;margin-left:auto;font-variant-numeric:tabular-nums}',
        scope +
          ' button,' +
          scope +
          ' select' +
          '{box-sizing:border-box;flex:none;height:22px;margin:0;border:0;border-radius:6px;font:inherit;color:inherit;background:transparent;opacity:.62;cursor:pointer;transition:background-color .12s,opacity .12s}',
        scope + ' button{width:22px;padding:0;font-size:15px;line-height:1}',
        // The native listbox keeps keyboard and pointer behavior; only its arrow is removed.
        scope +
          ' select{-webkit-appearance:none;appearance:none;min-width:0;padding:0 4px;text-align:center;text-align-last:center}',
        scope + ' option{background-color:Canvas;color:CanvasText}',
        scope +
          ' button:hover:not(:disabled),' +
          scope +
          ' select:hover{opacity:1;background:var(--rv-fill)}',
        scope + ' button:disabled{opacity:.25;cursor:default}',
        scope +
          ' button:focus-visible,' +
          scope +
          ' select:focus-visible,' +
          scope +
          ' pre:focus-visible{opacity:1;outline:2px solid color-mix(in srgb,currentColor 28%,transparent);outline-offset:-2px}',
        scope +
          ' pre{box-sizing:border-box;margin:0;padding:8px 12px 10px;border-top:1px solid var(--rv-line);max-height:200px;overflow:auto;overscroll-behavior:contain;font:inherit;color:color-mix(in srgb,currentColor 82%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,currentColor 22%,transparent) transparent}',
        // Dense heights inset the text with borders, which unlike padding never scroll, so one
        // line shows without a clipped neighbour. The separator is drawn into the top border,
        // and the scrollbar is hidden as in compact mode since its arrows would fill the track.
        scope +
          '[data-reasoning-viewer-dense] pre{padding:0 12px;border:solid transparent;border-width:5px 0;background:linear-gradient(var(--rv-line),var(--rv-line)) border-box 0 0/100% 1px no-repeat;scrollbar-width:none}',
        // Compact mode keeps the indicator where the header shows it, beside one reasoning line.
        compactScope +
          '{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:7px;align-items:center;padding:4px 12px}',
        compactScope + ' [data-reasoning-viewer-part="header"]{display:contents}',
        compactScope + ' [data-reasoning-viewer-part="dot"]{grid-column:1;grid-row:1}',
        compactScope +
          ' [data-reasoning-viewer-part="title"],' +
          compactScope +
          ' [data-reasoning-viewer-part="turns"]{display:none}',
        compactScope + ' pre{grid-column:2;grid-row:1;border:0;padding:0;scrollbar-width:none}',
        // The unpadded single line takes its focus ring just outside the text.
        compactScope + ' pre:focus-visible{outline-offset:1px}',
        // resize.js adds an invisible top edge; it overlays the panel without reserving a row.
        // Its accent line marks keyboard focus, not the focus a pointer press gives it.
        scope +
          ' [data-reasoning-viewer-resize]{position:absolute;inset:0 0 auto;z-index:1;outline:none;transition:box-shadow .12s}',
        scope +
          ' [data-reasoning-viewer-resize]:focus-visible:not([data-reasoning-viewer-pointer]){box-shadow:inset 0 2px var(--rv-indicator-color)}',
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
  title.textContent = 'Done';
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
  const turns = document.createElement('div');
  turns.dataset.reasoningViewerPart = 'turns';
  turns.setAttribute('role', 'group');
  turns.setAttribute('aria-label', 'Reasoning turns');
  const previous = button('\u2039', 'Previous turn'),
    next = button('\u203a', 'Next turn');
  previous.dataset.reasoningViewerPreviousTurn = '';
  next.dataset.reasoningViewerNextTurn = '';
  const turnSelect = document.createElement('select');
  turnSelect.dataset.reasoningViewerTurn = '';
  turnSelect.title = 'Select reasoning turn';
  turnSelect.setAttribute('aria-label', 'Select reasoning turn');
  turns.append(previous, turnSelect, next);
  bar.append(dot, title, turns);
  const body = document.createElement('pre');
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Full reasoning');
  panel.append(bar, body);
  const modes = ['auto', 'summary', 'raw'];
  const hexColor = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  let indicatorColor = 'auto';
  const validSetting = {
    mode: (value) => modes.includes(value),
    follow: (value) => typeof value === 'boolean',
    collapsed: (value) => typeof value === 'boolean',
    height: (value) => value === null || (Number.isInteger(value) && value >= 18 && value <= 1600),
    indicatorColor: (value) =>
      value === 'auto' || (typeof value === 'string' && hexColor.test(value)),
  };
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
    const texts = [];
    for (const item of turnItems(turn)) {
      const summary = parts(item.summary).join('\n\n'),
        raw = parts(item.content).join('\n\n');
      const useSummary = mode === 'summary' || (mode === 'auto' && summary.trim());
      const text = useSummary ? summary : raw;
      if (text.trim()) texts.push(text);
    }
    return texts.join('\n\n');
  }
  function syncNavigation(state, turn) {
    const count = state.turns.length,
      index = state.turns.findIndex((candidate) => candidate.turnId === turn?.turnId);
    while (turnSelect.options.length > count) turnSelect.remove(turnSelect.options.length - 1);
    for (let i = 0; i < count; i++) {
      const item = state.turns[i],
        option = turnSelect.options[i] ?? document.createElement('option');
      const text = i + 1 + '/' + count + ' turns';
      if (option.value !== item.turnId) option.value = item.turnId;
      if (option.textContent !== text) option.textContent = text;
      if (!option.parentElement) turnSelect.append(option);
    }
    turnSelect.value = turn?.turnId ?? '';
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index >= count - 1;
    turns.hidden = !count;
  }
  function render() {
    renderScheduled = false;
    if (disposed) return;
    if (!enabled) return;
    mount();
    const state = current ? session() : { turns: [], followingLatest: true },
      turn = activeTurn(),
      running = state.turns.at(-1)?.isRunning === true;
    panel.hidden = !current || !state.turns.length;
    const empty =
      mode === 'summary'
        ? 'No reasoning summary for this turn'
        : mode === 'raw'
          ? 'No raw reasoning for this turn'
          : turn?.isRunning
            ? 'Waiting for reasoning text\u2026'
            : 'No reasoning text for this turn';
    const text = chosen(turn) || empty,
      oldText = body.textContent,
      scrollTop = body.scrollTop;
    if (text !== oldText) {
      if (body.firstChild?.nodeType === 3 && text.startsWith(oldText))
        body.firstChild.appendData(text.slice(oldText.length));
      else body.textContent = text;
    }
    // History navigation changes the body; the header keeps the current turn's status.
    title.textContent = running ? 'Thinking' : 'Done';
    dot.toggleAttribute('data-running', running);
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
    follow = followPreference && state.followingLatest;
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
  function settings() {
    return {
      mode,
      follow: followPreference,
      collapsed: body.hidden,
      height: api.resize?.status().preferredHeightPx ?? null,
      indicatorColor,
    };
  }
  function configure(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new TypeError('Settings patch must be an object');
    // Read each value once and validate the whole patch before anything changes.
    const values = Object.fromEntries(Object.entries(patch)),
      has = (name) => Object.hasOwn(values, name);
    for (const [name, value] of Object.entries(values)) {
      if (!Object.hasOwn(validSetting, name)) throw new TypeError('Unknown setting: ' + name);
      if (!validSetting[name](value)) throw new TypeError('Invalid value for setting: ' + name);
    }
    if (has('height') && typeof api.resize?.setHeight !== 'function')
      throw new Error('height unavailable');
    const collapsed = has('collapsed') ? values.collapsed : body.hidden;
    if (has('mode')) mode = values.mode;
    if (has('follow')) follow = followPreference = values.follow;
    if (has('indicatorColor')) {
      indicatorColor = values.indicatorColor;
      // Removing the inline override falls back to the live accent reference in the sheet.
      if (indicatorColor === 'auto') panel.style.removeProperty('--rv-indicator-color');
      else panel.style.setProperty('--rv-indicator-color', indicatorColor);
    }
    if (has('height')) {
      if (values.height === null) api.resize.resetHeight();
      else api.resize.setHeight(values.height);
    }
    // setHeight expands the body; an omitted collapsed setting keeps its previous value.
    body.hidden = collapsed;
    api.resize?.refresh();
    schedule();
    return settings();
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
  window.addEventListener(
    'storage',
    (event) => {
      if (event.key === enabledKey) setEnabled(event.newValue !== 'false', { save: false });
    },
    { signal },
  );
  previous.addEventListener('click', () => step(-1), { signal });
  next.addEventListener('click', () => step(1), { signal });
  turnSelect.addEventListener('change', () => navigate(turnSelect.value), { signal });
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
      // Manual scrolling pauses or resumes only the runtime state, never the preference.
      follow = followPreference && body.scrollHeight - body.clientHeight - body.scrollTop < 12;
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
    configure,
    settings,
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
        follow = followPreference;
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
        collapsed: body.hidden,
        isRunning: state?.turns.at(-1)?.isRunning === true,
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
