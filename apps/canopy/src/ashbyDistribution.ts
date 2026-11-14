/** Ashby candidate search and notes through Nango. No candidate creation or notifications. */
import { HostedNangoError } from "./hostedNango.ts";
import type { DistributionAdapter, DistributionTarget } from "./distributionAdapter.ts";
import type { HostedActor } from "./hostedIdentity.ts";
const id = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (message: string): never => { throw new HostedNangoError("provider-unavailable", message); };
export function createAshbyDistribution(config: { secretKey: string; integrationId: string; connectOrigin: string; fetch?: typeof fetch }): DistributionAdapter {
  const origin = new URL(config.connectOrigin);
  if (!config.secretKey.trim() || !id(config.integrationId) || origin.protocol !== "https:" || origin.origin !== config.connectOrigin) throw new Error("Invalid Ashby destination configuration.");
  const send = config.fetch ?? fetch;
  async function request(path: string, connectionId?: string, body?: unknown) {
    const init: RequestInit & { cache: "no-store" } = { method: body === undefined ? "GET" : "POST",
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json",
        ...(connectionId ? { "Connection-Id": connectionId, "Provider-Config-Key": config.integrationId,
          "Base-Url-Override": "https://api.ashbyhq.com", Retries: "0" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const response = await send(new URL(path, "https://api.nango.dev"), init);
    const chunks: Uint8Array[] = []; let size = 0; const reader = response.body?.getReader();
    if (reader) try { for (;;) { const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 512_000) { await reader.cancel(); return fail("Destination response exceeds its size limit."); } chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail("Destination response could not be read."); }
    if (response.redirected || !object(value)) return fail("Destination returned an unsupported response.");
    return { status: response.status, ok: response.ok, value };
  }
  async function owns(actor: HostedActor, connectionId: string) {
    if (!id(connectionId)) throw new HostedNangoError("invalid-request", "Choose an existing destination connection.");
    const { ok, value } = await request(`/connections/${connectionId}?provider_config_key=${config.integrationId}`);
    if (!ok) return fail("The destination connection could not be checked. Reconnect or retry.");
    if (value["connection_id"] !== connectionId || value["provider_config_key"] !== config.integrationId ||
      !object(value["tags"]) || value["tags"]["end_user_id"] !== actor.id) throw new HostedNangoError("forbidden", "This destination connection belongs to another account.");
    if (!Array.isArray(value["errors"]) || value["errors"].length) return fail("Resolve the destination connection error before sharing.");
  }
  async function candidate(actor: HostedActor, target: DistributionTarget) {
    if (!uuid(target.candidateId)) throw new HostedNangoError("invalid-request", "Choose an existing Ashby candidate ID.");
    await owns(actor, target.connectionId);
    const { ok, value } = await request("/proxy/candidate.info", target.connectionId, { id: target.candidateId });
    const result = value["results"];
    if (!ok || value["success"] !== true || !object(result) || result["id"] !== target.candidateId ||
      typeof result["name"] !== "string" || !result["name"].trim() || result["name"].length > 500) return fail("Couldn't confirm candidate in Ashby. Nothing sent.");
    return { id: target.candidateId, name: result["name"] };
  }
  return {
    id: "ashby", label: "Ashby", bindingKey: `ashby:${config.integrationId}:note-v1`, version: "2026-09-23-note-v1",
    capabilities: { createNote: true, reconcile: true, replace: false, retract: false },
    async connections(actor) {
      const found = new Map<string, { id: string; available: boolean }>();
      for (let page = 1; page <= 10; page++) {
        const query = new URLSearchParams({ "tags[end_user_id]": actor.id, limit: "100", page: String(page) });
        const { ok, value } = await request(`/connections?${query}`);
        if (!ok || !Array.isArray(value["connections"]) || value["connections"].length > 100) return fail("Connected recruiting accounts could not be listed.");
        for (const row of value["connections"]) {
          if (!object(row) || !object(row["tags"]) || row["tags"]["end_user_id"] !== actor.id) throw new HostedNangoError("forbidden", "The connection list did not match this account.");
          if (row["provider_config_key"] !== config.integrationId) continue;
          if (typeof row["connection_id"] !== "string" || !id(row["connection_id"]) || !Array.isArray(row["errors"])) return fail("A recruiting connection is malformed.");
          found.set(row["connection_id"], { id: row["connection_id"], available: row["errors"].length === 0 });
        }
        if (value["connections"].length < 100) return [...found.values()];
      }
      return fail("Too many connections. Narrow the scope.");
    },
    async search(actor, connectionId, name) {
      if (!name.trim() || name.length > 200) throw new HostedNangoError("invalid-request", "Enter a candidate name within 200 characters.");
      await owns(actor, connectionId);
      const { ok, value } = await request("/proxy/candidate.search", connectionId, { name: name.trim(), limit: 25 });
      if (!ok || value["success"] !== true || !Array.isArray(value["results"]) || value["results"].length > 25 || typeof value["moreDataAvailable"] !== "boolean") return fail("Candidate search failed. Nothing sent.");
      const candidates = value["results"].map(raw => {
        if (!object(raw) || !uuid(raw["id"]) || typeof raw["name"] !== "string" || !raw["name"].trim() || raw["name"].length > 500) return fail("Candidate search returned an invalid identity.");
        return { id: raw["id"], name: raw["name"] };
      });
      await owns(actor, connectionId);
      return { candidates, more: value["moreDataAvailable"] };
    },
    async connect(actor) {
      const { ok, value } = await request("/connect/sessions", undefined, { tags: { end_user_id: actor.id }, allowed_integrations: [config.integrationId] });
      const data = value["data"];
      if (!ok || !object(data) || typeof data["connect_link"] !== "string" || data["connect_link"].length > 4096) return fail("Destination sign-in is unavailable.");
      const url = new URL(data["connect_link"]);
      if (url.origin !== origin.origin || url.username || url.password || url.hash) return fail("Destination sign-in returned an unexpected address.");
      return url.href;
    },
    candidate,
    async deliver(actor, target, text) {
      if (!uuid(target.candidateId) || Buffer.byteLength(text) > 100_000 || !text.trim()) throw new HostedNangoError("invalid-request", "The reviewed delivery is invalid or too large.");
      await owns(actor, target.connectionId); // A failure here is a known no-send, unlike an interrupted write.
      try {
        const { ok, status, value } = await request("/proxy/candidate.createNote", target.connectionId,
          { candidateId: target.candidateId, note: { type: "text/plain", value: text }, sendNotifications: false, isPrivate: false });
        if (ok && value["success"] === true && object(value["results"]) && uuid(value["results"]["id"])) return { status: "accepted", reference: value["results"]["id"] };
        if ([400, 401, 403, 404, 422, 429].includes(status) || ok && value["success"] === false) return { status: "rejected", reason: status === 429 ? "rate-limited" : "provider-refused" };
        return { status: "unknown", reason: "write-not-confirmed" };
      } catch { return { status: "unknown", reason: "write-not-confirmed" }; }
    },
    async reconcile(actor, target, marker) {
      await candidate(actor, target);
      const cursors = new Set<string>(); let cursor: string | undefined; const matches = new Set<string>();
      for (let page = 0; page < 10; page++) {
        const { ok, value } = await request("/proxy/candidate.listNotes", target.connectionId, { candidateId: target.candidateId, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!ok || value["success"] !== true || !Array.isArray(value["results"]) || value["results"].length > 100) return fail("Outcome unknown. Check Ashby.");
        for (const note of value["results"]) if (object(note) && uuid(note["id"]) && typeof note["content"] === "string" && note["content"].split("\n").includes(marker)) matches.add(note["id"]);
        if (matches.size > 1) return fail("Duplicate notes. Resolve in Ashby.");
        if (value["moreDataAvailable"] === false) { await owns(actor, target.connectionId); return matches.values().next().value ?? null; }
        const next = value["nextCursor"];
        if (value["moreDataAvailable"] !== true || typeof next !== "string" || !next || next.length > 2048 || cursors.has(next)) return fail("Outcome unknown. Check Ashby.");
        cursors.add(next); cursor = next;
      }
      return fail("Outcome unknown. Check Ashby.");
    },
  };
}
