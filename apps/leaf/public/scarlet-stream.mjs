/** Parse the supported AG-UI stream independently of the DOM. EOF is not success. */
/** @param {Response} response
 * @param {{threadId: string, runId: string}} identity
 * @param {(event: Record<string, any>) => void} onEvent */
export async function readScarletStream(response, identity, onEvent) {
  if (!response.ok) throw new Error(`Refused (HTTP ${response.status}). Reload.`);
  if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) {
    throw new Error("Photosynthesis did not return an event stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  let terminal = false;
  /** @type {string | null} */
  let message = null;
  let length = 0;
  /** @param {string} frame */
  const consume = (frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return;
    const event = JSON.parse(data);
    if (!event || typeof event !== "object" || terminal) throw new Error("Unexpected event after the run ended.");
    if (!started && event.type !== "RUN_STARTED") throw new Error("Answer interrupted.");
    switch (event.type) {
      case "RUN_STARTED":
        if (started || event.threadId !== identity.threadId || event.runId !== identity.runId) throw new Error("The response belongs to a different run.");
        started = true;
        break;
      case "CUSTOM":
        if (typeof event.name !== "string") throw new Error("Unreadable context event.");
        break;
      case "TEXT_MESSAGE_START":
        if (message !== null || typeof event.messageId !== "string" || event.role !== "assistant") throw new Error("Unexpected answer start.");
        message = event.messageId;
        break;
      case "TEXT_MESSAGE_CONTENT":
        if (message === null || event.messageId !== message || typeof event.delta !== "string" || !event.delta) throw new Error("Unexpected answer fragment.");
        length += event.delta.length;
        if (length > 64_000) throw new Error("Answer stopped at the text limit. Ask a narrower question.");
        break;
      case "TEXT_MESSAGE_END":
        if (message === null || event.messageId !== message) throw new Error("Unexpected answer end.");
        message = null;
        break;
      case "RUN_ERROR":
        terminal = true;
        if (typeof event.message !== "string") throw new Error("Photosynthesis could not finish this answer.");
        break;
      case "RUN_FINISHED":
        if (message !== null || event.threadId !== identity.threadId || event.runId !== identity.runId) throw new Error("Answer ended out of order.");
        terminal = true;
        break;
      default:
        throw new Error("Photosynthesis returned an unsupported event.");
    }
    onEvent(event);
  };
  try {
    for (;;) {
      const part = await reader.read();
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("Photosynthesis returned an oversized event.");
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator) break;
        consume(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
      if (part.done) break;
    }
    if (buffer.trim()) throw new Error("Answer interrupted inside an event.");
    if (!terminal) throw new Error("Answer interrupted.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
