import type { CompanionStatus } from "./sourceCatalog.ts";

export type ConnectionStatus = { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; companion: CompanionStatus };

/** Read-only connection refresh; aborted reads must not replace newer action results. */
export async function loadConnectionStatus(update: (status: ConnectionStatus) => void, signal?: AbortSignal) {
  update({ kind: "loading" });
  try {
    const response = await fetch("/sources/api", { signal: signal ?? null });
    if (!response.ok) throw Error("Status unavailable");
    const value = await response.json();
    if (!value || typeof value !== "object" || !("ladybug" in value)) throw Error("Status unavailable");
    const companion = value.ladybug;
    if (!companion || typeof companion !== "object"
      || !("connected" in companion) || typeof companion.connected !== "boolean"
      || !("ready" in companion) || typeof companion.ready !== "boolean"
      || !("model" in companion) || (companion.model !== null && typeof companion.model !== "string")
      || !("detail" in companion) || typeof companion.detail !== "string") throw Error("Status unavailable");
    if (!signal?.aborted) update({ kind: "ready", companion: {
      connected: companion.connected, ready: companion.ready, model: companion.model, detail: companion.detail,
    } });
  } catch {
    if (!signal?.aborted) update({ kind: "unavailable" });
  }
}
