/** Optional authenticated loopback companion. No closed-plane import or arbitrary destination. */
import type { CompanionStatus } from "./sourceCatalog.ts";
import { parseJourneyResponse, type JourneyRequest } from "./journeyCollaboration.ts";
const disconnected = (detail: string): CompanionStatus => ({ connected: false, ready: false, model: null, detail });
export function createAssessmentConnection(env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch) {
  let origin: string | null = null;
  const key = env["FOLIAGE_COMPANION_KEY"]?.trim();
  try {
    const url = new URL(env["FOLIAGE_COMPANION_ORIGIN"] || "");
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash && key && /^[a-f0-9]{64}$/.test(key)) origin = url.origin;
  } catch { /* Missing/invalid configuration is shown before any request. */ }
  let status = disconnected("Scarlet's assessment companion has not been connected.");
  async function request(action: string, body: unknown = {}) {
    if (!origin) throw new Error("Scarlet needs its assessment companion configured for this installation. No work was sent.");
    let response: Response;
    try { response = await fetcher(`${origin}/connection/${action}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(action === 'journey' ? 100_000 : 10_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch { status = disconnected(action === 'journey' ? 'The Scarlet connection ended before a response was received. Cloud processing may have started; no local edits were applied. Reconnect before retrying.' : "Scarlet's companion is unavailable. Reconnect to retry; no cloud assessment was started."); throw new Error(status.detail); }
    if (!response.body) { status = disconnected("Scarlet returned no connection details. Reconnect to retry."); throw new Error(status.detail); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    let result: Record<string, unknown>;
    try {
      for (;;) { const p = await reader.read(); if (p.done) break; bytes += p.value.byteLength; if (bytes > (action === 'journey' ? 80*1024 : 16_384)) throw new Error("Scarlet returned oversized connection details."); chunks.push(p.value); }
      result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch { status = disconnected("Scarlet returned unreadable connection details. Reconnect to retry."); throw new Error(status.detail); }
    finally { await reader.cancel().catch(() => undefined); }
    if (!response.ok) {
      const cause = action === 'journey' && typeof result?.['error'] === 'string' && result['error'].length < 500 ? result['error'] : 'The companion refused the request.';
      status = disconnected(`Scarlet did not return an accepted response (HTTP ${response.status}). ${cause} Your work is unchanged; reconnect before retrying.`);
      throw new Error(status.detail);
    }
    return result;
  }
  return {
    status: () => ({ ...status }),
    reviewOrigin: () => status.connected ? origin : null,
    async connect() {
      const result = await request("status");
      if (result["service"] !== "foliage-assessment-companion" || result["version"] !== 1 || typeof result["ready"] !== "boolean" || (result["model"] !== null && typeof result["model"] !== "string")) { status = disconnected("This service is not a compatible Scarlet assessment companion."); throw new Error(status.detail); }
      status = { connected: true, ready: result["ready"], model: result["model"] as string | null,
        detail: result["ready"] ? "Connected · review before cloud" : "Connected · cloud setup needed" };
      return status;
    },
    disconnect() { status = disconnected("Disconnected"); return status; },
    async collaborate(context: JourneyRequest) {
      if (!status.connected || !status.ready) throw new Error('Connect a configured Scarlet companion before sending this journey. Nothing sent.');
      return parseJourneyResponse(await request('journey', context), context);
    },
    async prepare(transfer: unknown, subject: { id: string; name: string }) {
      if (!status.connected) throw new Error("Connect Scarlet before preparing an assessment.");
      const result = await request("prepare", { transfer, subject });
      if (typeof result["reviewPath"] !== "string" || !/^\/connection\/review\/[a-f0-9-]{36}$/.test(result["reviewPath"])) { status = disconnected("Scarlet did not return a valid private review page. Reconnect to retry."); throw new Error(status.detail); }
      return { reviewUrl: `${origin}${result["reviewPath"]}`, detail: "Prepared · open review" };
    },
  };
}
