(() => {
  const api = window.__codexReasoningViewer;
  if (!api) throw new Error('Reasoning panel is not loaded');
  if (api.resize?.version === 1) return api.status();
  const panel =
    api.getElement?.() ??
    document.querySelector('[data-reasoning-viewer="codex-reasoning-viewer-v1"]');
  const body = panel?.querySelector('pre');
  if (!body) throw new Error('Reasoning panel body is unavailable');

  const storageKey = 'codex-reasoning-viewer:body-height:v1';
  const minimum = 64,
    defaultHeight = 200;
  const controller = new AbortController(),
    signal = controller.signal;
  const originalStatus = api.status,
    originalDispose = api.dispose;
  const originalStyles = ['height', 'max-height', 'box-sizing'].map((name) => [
    name,
    body.style.getPropertyValue(name),
    body.style.getPropertyPriority(name),
  ]);
  let disposed = false,
    drag = null,
    preferredHeight = null;
  try {
    const saved = window.localStorage.getItem(storageKey),
      value = Number(saved);
    if (saved !== null && Number.isFinite(value) && value >= minimum) preferredHeight = value;
  } catch {}

  const handle = document.createElement('div');
  handle.dataset.reasoningViewerResize = '';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', '\u8c03\u6574\u601d\u8003\u680f\u9ad8\u5ea6');
  handle.title =
    '\u4e0a\u4e0b\u62d6\u52a8\u8c03\u6574\u9ad8\u5ea6\uff0c\u53cc\u51fb\u6062\u590d\u9ed8\u8ba4';
  handle.style.cssText =
    'display:flex;align-items:center;justify-content:center;height:8px;cursor:ns-resize;touch-action:none;user-select:none;outline-offset:-2px;';
  const grip = document.createElement('span');
  grip.style.cssText =
    'width:34px;height:2px;border-radius:2px;background:currentColor;opacity:.35;pointer-events:none;';
  handle.append(grip);
  panel.prepend(handle);

  function maximum() {
    const viewport = window.innerHeight || 600;
    return Math.max(minimum, Math.min(Math.floor(viewport * 0.75), viewport - 180));
  }
  function clamp(value) {
    return Math.max(minimum, Math.min(maximum(), Math.round(value)));
  }
  function measuredHeight() {
    return Math.round(body.getBoundingClientRect().height);
  }
  function updateHandle() {
    handle.setAttribute('aria-valuemin', String(minimum));
    handle.setAttribute('aria-valuemax', String(maximum()));
    handle.setAttribute('aria-valuenow', String(clamp(preferredHeight ?? defaultHeight)));
  }
  function persist() {
    try {
      if (preferredHeight === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, String(preferredHeight));
    } catch {}
  }
  function applyHeight() {
    if (disposed) return;
    const follow = originalStatus().follow;
    const height =
      preferredHeight === null ? Math.min(defaultHeight, maximum()) : clamp(preferredHeight);
    body.style.boxSizing = 'border-box';
    body.style.maxHeight = height + 'px';
    body.style.height = preferredHeight === null ? '' : height + 'px';
    if (follow && !body.hidden) body.scrollTop = body.scrollHeight;
    updateHandle();
  }
  function expand() {
    if (body.hidden) panel.querySelector('button[aria-expanded="false"]')?.click();
  }
  function setHeight(value, { save = true } = {}) {
    if (!Number.isFinite(value)) throw new TypeError('Height must be a finite number');
    expand();
    preferredHeight = clamp(value);
    applyHeight();
    if (save) persist();
  }
  function resetHeight() {
    preferredHeight = null;
    applyHeight();
    persist();
  }
  function restoreProperty(style, name, value, priority) {
    if (value) style.setProperty(name, value, priority);
    else style.removeProperty(name);
  }
  function finishDrag({ save = true, revert = false } = {}) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (revert) {
      preferredHeight = previous.preferredHeight;
      applyHeight();
    }
    for (const [name, value, priority] of previous.rootStyles) {
      if (
        document.documentElement.style.getPropertyValue(name) ===
        (name === 'cursor' ? 'ns-resize' : 'none')
      ) {
        restoreProperty(document.documentElement.style, name, value, priority);
      }
    }
    if (handle.hasPointerCapture(previous.pointerId))
      handle.releasePointerCapture(previous.pointerId);
    if (save) persist();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    preferredHeight = clamp(drag.height + drag.y - event.clientY);
    applyHeight();
  }
  handle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || event.isPrimary === false || drag) return;
      event.preventDefault();
      event.stopPropagation();
      expand();
      const rootStyle = document.documentElement.style;
      drag = {
        pointerId: event.pointerId,
        y: event.clientY,
        height: measuredHeight() || clamp(preferredHeight ?? defaultHeight),
        preferredHeight,
        rootStyles: ['cursor', 'user-select'].map((name) => [
          name,
          rootStyle.getPropertyValue(name),
          rootStyle.getPropertyPriority(name),
        ]),
      };
      rootStyle.setProperty('cursor', 'ns-resize', 'important');
      rootStyle.setProperty('user-select', 'none', 'important');
      handle.focus({ preventScroll: true });
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {}
    },
    { signal },
  );
  window.addEventListener('pointermove', move, { signal });
  window.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId !== drag?.pointerId) return;
      move(event);
      finishDrag();
    },
    { signal },
  );
  window.addEventListener(
    'pointercancel',
    (event) => {
      if (event.pointerId === drag?.pointerId) finishDrag({ save: false, revert: true });
    },
    { signal },
  );
  handle.addEventListener('lostpointercapture', () => finishDrag(), { signal });
  window.addEventListener('blur', () => finishDrag(), { signal });
  window.addEventListener('resize', applyHeight, { signal });
  handle.addEventListener(
    'dblclick',
    (event) => {
      event.preventDefault();
      resetHeight();
    },
    { signal },
  );
  handle.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const height = measuredHeight() || clamp(preferredHeight ?? defaultHeight);
      const next = { ArrowUp: height + 16, ArrowDown: height - 16, Home: minimum, End: maximum() }[
        event.key
      ];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setHeight(next);
    },
    { signal },
  );

  const observer = new ResizeObserver(updateHandle);
  observer.observe(body);
  function status() {
    return {
      heightPx: measuredHeight(),
      preferredHeightPx: preferredHeight,
      minimumPx: minimum,
      maximumPx: maximum(),
      dragging: drag !== null,
    };
  }
  const wrappedStatus = () => ({ ...originalStatus(), resize: status() });
  function dispose() {
    if (disposed) return { disposed: true };
    finishDrag({ save: false });
    disposed = true;
    controller.abort();
    observer.disconnect();
    handle.remove();
    for (const [name, value, priority] of originalStyles)
      restoreProperty(body.style, name, value, priority);
    if (api.status === wrappedStatus) api.status = originalStatus;
    if (api.dispose === wrappedDispose) api.dispose = originalDispose;
    if (api.resize === controls) delete api.resize;
    return { disposed: true };
  }
  function wrappedDispose(...args) {
    dispose();
    return Reflect.apply(originalDispose, this, args);
  }
  const controls = { version: 1, setHeight, resetHeight, status, dispose };
  api.resize = controls;
  api.status = wrappedStatus;
  api.dispose = wrappedDispose;
  applyHeight();
  return api.status();
})();
