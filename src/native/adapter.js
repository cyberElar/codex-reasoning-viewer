(async () => {
  const key = '__codexReasoningNativeAdapter';
  if (window[key]) return window[key].status();
  const panel = window.__codexReasoningViewer;
  if (!panel?.setHistory) throw new Error('Turn history panel is not loaded');
  const managers = new Set(),
    stores = new Set(),
    restore = [],
    sessions = new Map();
  let prototype = null,
    getConversation = null,
    disposed = false,
    queued = false,
    selected = null,
    lastValue = null,
    updates = 0,
    notificationCount = 0,
    lastError = null;
  function safely(callback) {
    try {
      return callback();
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 240);
      return undefined;
    }
  }
  function threadId() {
    return panel.composerTarget()?.getAttribute('data-above-composer-conversation-id') || null;
  }
  function schedule() {
    if (disposed || queued) return;
    queued = true;
    let complete = false,
      frame,
      timer;
    const run = () => {
      if (complete) return;
      complete = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      queued = false;
      safely(refresh);
    };
    frame = requestAnimationFrame(run);
    timer = setTimeout(run, 40);
  }
  function session(id) {
    if (!sessions.has(id)) sessions.set(id, { turns: new Map(), order: [], complete: true });
    return sessions.get(id);
  }
  function mergeOrder(previous, incoming) {
    const result = [...previous],
      known = new Set(previous);
    for (let index = 0; index < incoming.length; index++) {
      const id = incoming[index];
      if (known.has(id)) continue;
      const next = incoming.slice(index + 1).find((value) => known.has(value));
      const position = next === undefined ? result.length : result.indexOf(next);
      result.splice(position, 0, id);
      known.add(id);
    }
    return result;
  }
  function turnsOf(conversation) {
    const turns = [],
      history = conversation.turnHistory?.history;
    if (history?.entitiesByKey) {
      for (const island of history.islands ?? [])
        for (const entry of island.entries ?? []) {
          const entity = history.entitiesByKey[entry.value];
          if (Array.isArray(entity?.items)) turns.push(entity);
        }
    }
    turns.push(...(conversation.turns ?? []));
    return turns;
  }
  function turnRecord(id, turnId, append = true) {
    const state = session(id);
    if (!state.turns.has(turnId)) {
      state.turns.set(turnId, {
        turnId,
        items: new Map(),
        order: [],
        startedAtMs: null,
        isRunning: false,
        runOverride: null,
        version: 0,
        snapshot: null,
      });
      if (append) state.order.push(turnId);
    }
    return state.turns.get(turnId);
  }
  function itemRecord(turn, itemId, append = true) {
    if (!turn.items.has(itemId)) {
      turn.items.set(itemId, { itemId, summary: [], content: [] });
      if (append) turn.order.push(itemId);
      turn.version++;
    }
    return turn.items.get(itemId);
  }
  function parts(value) {
    return (value ?? []).map((part) => (typeof part === 'string' ? part : (part?.text ?? '')));
  }
  function mergeParts(previous, incoming) {
    let changed = false;
    for (let index = 0; index < incoming.length; index++) {
      if (previous[index] === undefined || incoming[index].length > previous[index].length) {
        previous[index] = incoming[index];
        changed = true;
      }
    }
    return changed;
  }
  function ingest(manager, id) {
    const conversation = getConversation.call(manager, id);
    if (!conversation) return false;
    const state = session(id),
      before = [...state.order],
      ids = [];
    const nativeHistory = conversation.turnHistory?.history;
    state.complete =
      nativeHistory?.isComplete ?? conversation.turnsPagination?.hasLoadedOldest ?? true;
    for (const native of turnsOf(conversation)) {
      const turnId = native.turnId ?? native.id;
      if (!turnId) continue;
      ids.push(turnId);
      const turn = turnRecord(id, turnId, false),
        itemIds = [];
      const startedAt = Number(native.turnStartedAtMs);
      if (Number.isFinite(startedAt) && turn.startedAtMs !== startedAt) {
        turn.startedAtMs = startedAt;
        turn.version++;
      }
      const running = turn.runOverride ?? native.status === 'inProgress';
      if (turn.isRunning !== running) {
        turn.isRunning = running;
        turn.version++;
      }
      const previous = [...turn.order];
      for (const nativeItem of native.items ?? []) {
        if (nativeItem.type !== 'reasoning') continue;
        const itemId = nativeItem.id ?? nativeItem.itemId;
        if (!itemId) continue;
        itemIds.push(itemId);
        const item = itemRecord(turn, itemId, false);
        if (mergeParts(item.summary, parts(nativeItem.summary))) turn.version++;
        if (mergeParts(item.content, parts(nativeItem.content))) turn.version++;
      }
      const order = mergeOrder(previous, itemIds);
      if (order.join('\0') !== turn.order.join('\0')) turn.version++;
      turn.order = order;
    }
    state.order = mergeOrder(before, [...new Set(ids)]);
    return true;
  }
  function snapshot(turn) {
    if (turn.snapshot?.version !== turn.version) {
      turn.snapshot = {
        turnId: turn.turnId,
        version: turn.version,
        startedAtMs: turn.startedAtMs,
        isRunning: turn.isRunning,
        items: turn.order.map((id) => {
          const item = turn.items.get(id);
          return { itemId: id, summary: [...item.summary], content: [...item.content] };
        }),
      };
    }
    return turn.snapshot;
  }
  function refresh() {
    if (disposed) return;
    const id = threadId();
    if (selected !== id) {
      selected = id;
      lastValue = null;
      panel.setThread(id);
    }
    if (!id) return;
    for (const manager of managers) {
      if (!manager.disposed && ingest(manager, id)) break;
    }
    const state = sessions.get(id);
    if (!state) return;
    const value = JSON.stringify([
      id,
      state.complete,
      state.order.map((id) => [id, state.turns.get(id).version]),
    ]);
    if (value === lastValue) return;
    lastValue = value;
    updates++;
    panel.setHistory({
      threadId: id,
      isComplete: state.complete,
      turns: state.order.map((id) => snapshot(state.turns.get(id))),
    });
  }
  function wrap(object, name, after) {
    const original = object[name];
    if (typeof original !== 'function') return;
    const own = Object.getOwnPropertyDescriptor(object, name);
    const wrapper = function (...args) {
      let value;
      try {
        value = Reflect.apply(original, this, args);
      } finally {
        safely(() => after(this, args));
      }
      return value;
    };
    Object.defineProperty(object, name, {
      configurable: true,
      writable: true,
      value: wrapper,
      enumerable: own?.enumerable ?? false,
    });
    restore.push(() => {
      if (object[name] === wrapper) {
        if (own) Object.defineProperty(object, name, own);
        else delete object[name];
      }
    });
  }
  function capture(manager) {
    if (!manager?.threadStore || manager.disposed) return;
    if (!prototype) installPrototype(manager);
    if (!managers.has(manager)) {
      managers.add(manager);
      const off = manager.addNotificationCallback(
        [
          'item/reasoning/textDelta',
          'item/reasoning/summaryTextDelta',
          'turn/started',
          'turn/completed',
        ],
        (event) =>
          safely(() => {
            notificationCount++;
            receive(manager, event.method, event.params);
            schedule();
          }),
      );
      if (typeof off === 'function') restore.push(off);
      else if (off?.[Symbol.dispose]) restore.push(() => off[Symbol.dispose]());
    }
    if (!stores.has(manager.threadStore)) {
      stores.add(manager.threadStore);
      for (const name of [
        'updateConversationState',
        'updateTurnState',
        'setConversation',
        'replaceConversation',
      ])
        wrap(manager.threadStore, name, schedule);
      schedule();
    }
  }
  function receive(manager, method, params) {
    capture(manager);
    if (!params?.threadId) return;
    const id = params.threadId,
      turnId = params.turnId ?? params.turn?.id ?? params.turn?.turnId;
    if (!turnId) return;
    const turn = turnRecord(id, turnId);
    if (method === 'turn/started' || method === 'turn/completed') {
      turn.runOverride = method === 'turn/started';
      turn.isRunning = turn.runOverride;
      turn.version++;
      return;
    }
    if (!params.itemId || typeof params.delta !== 'string') return;
    const raw = method === 'item/reasoning/textDelta',
      index = raw ? params.contentIndex : params.summaryIndex;
    if (!Number.isSafeInteger(index) || index < 0) return;
    const item = itemRecord(turn, params.itemId),
      values = raw ? item.content : item.summary;
    while (values.length <= index) values.push('');
    values[index] += params.delta;
    turn.isRunning = true;
    turn.runOverride = true;
    turn.version++;
  }
  function installPrototype(manager) {
    const candidate = Object.getPrototypeOf(manager);
    for (const name of ['getHostId', 'getConversation', 'onNotification'])
      if (typeof candidate?.[name] !== 'function')
        throw new Error('Unsupported native manager interface');
    prototype = candidate;
    getConversation = prototype.getConversation;
    for (const name of [
      'getHostId',
      'getConversation',
      'getCachedConversations',
      'getRecentConversations',
      'updateConversationState',
    ])
      wrap(prototype, name, (instance) => capture(instance));
    wrap(prototype, 'onNotification', (instance) => {
      capture(instance);
      schedule();
    });
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => !record.target.closest?.('[data-reasoning-viewer]')) &&
      threadId() !== selected
    )
      schedule();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-above-composer-conversation-id'],
  });
  const api = {
    capture(manager) {
      return (
        safely(() => {
          capture(manager);
          return managers.has(manager);
        }) === true
      );
    },
    getManagers() {
      return [...managers].filter((manager) => !manager.disposed);
    },
    refresh() {
      safely(refresh);
      return api.status();
    },
    status() {
      const state = sessions.get(selected);
      return {
        version: 3,
        managerCount: managers.size,
        selectedThreadId: selected,
        refreshPending: queued,
        turnCount: state?.order.length ?? 0,
        reasoningItems: state
          ? [...state.turns.values()].reduce((count, turn) => count + turn.items.size, 0)
          : 0,
        stateUpdates: updates,
        nativeNotifications: notificationCount,
        lastError,
        source: 'native-manager-state',
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      let restored = 0,
        failures = 0;
      for (const undo of restore.reverse()) {
        try {
          undo();
          restored++;
        } catch {
          failures++;
        }
      }
      managers.clear();
      stores.clear();
      sessions.clear();
      delete window[key];
      return { disposed: true, restored, failures };
    },
  };
  window[key] = api;
  schedule();
  return api.status();
})();
