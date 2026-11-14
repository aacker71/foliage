/** Small Chrome DevTools Protocol client for one isolated capture process. */
export class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      const handlers = this.handlers.get(message.method) ?? [];
      for (const handler of handlers) handler(message.params ?? {}, message.sessionId);
    });
    socket.addEventListener("close", () => this.rejectPending("Chrome DevTools closed"));
    socket.addEventListener("error", () => this.rejectPending("Chrome DevTools failed"));
  }

  static async connect(url, timeoutMs = 8_000) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome DevTools connection timed out")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Chrome DevTools connection failed"));
      }, { once: true });
    }).catch((error) => {
      try { socket.close(); } catch { /* A socket that never opened may refuse close(). */ }
      throw error;
    });
    return new CdpClient(socket);
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}, sessionId, timeoutMs = 10_000) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Chrome DevTools is closed before ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  rejectPending(reason) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${pending.method}: ${reason}`));
    }
    this.pending.clear();
  }

  close() {
    this.socket.close();
    this.rejectPending("capture ended");
  }
}
