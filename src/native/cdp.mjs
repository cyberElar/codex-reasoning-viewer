export class CdpConnection {
  #socket;
  #pending = new Map();
  #next = 1;
  #listeners = new Map();
  static async connect(url) {
    const result = new CdpConnection();
    result.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      result.#socket.addEventListener('open', resolve, { once: true });
      result.#socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {
        once: true,
      });
    });
    result.#socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null) {
        const p = result.#pending.get(msg.id);
        if (p) {
          result.#pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      } else for (const listener of result.#listeners.get(msg.method) ?? []) listener(msg.params);
    });
    result.#socket.addEventListener('close', () => {
      for (const p of result.#pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('CDP disconnected'));
      }
      result.#pending.clear();
    });
    return result;
  }
  send(method, params = {}, timeout = 10000) {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeout);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    let set = this.#listeners.get(method);
    if (!set) this.#listeners.set(method, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.#socket.close();
  }
}
export async function listTargets(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('CDP inventory failed');
  return response.json();
}
export async function connectAppPage(port) {
  const targets = await listTargets(port),
    matches = targets.filter((t) => t.type === 'page' && t.url === 'app://-/index.html');
  if (matches.length !== 1)
    throw new Error('Expected exactly one Codex main page; observed ' + matches.length);
  return {
    target: matches[0],
    connection: await CdpConnection.connect(matches[0].webSocketDebuggerUrl),
  };
}
