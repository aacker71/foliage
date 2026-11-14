/** Cloud-only Nango adapter. Current actor tags bind every read; credentials never leave it. */
import { createHash } from "node:crypto";
import { parseObservationBatch, OBSERVATION_INPUT_BYTES, type ObservationBatch } from "@foliage/photosynthesis/observations";
import type { HostedActor } from "./hostedIdentity.ts";

export class HostedNangoError extends Error {
  readonly code: "forbidden" | "invalid-request" | "provider-unavailable";
  constructor(code: HostedNangoError["code"], message: string) { super(message); this.code = code; }
}
const fail = (code: HostedNangoError["code"], message: string): never => { throw new HostedNangoError(code, message); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createHostedNango(config: {
  secretKey: string; integrationId: string; model: string; connectOrigin: string; fetch?: typeof fetch;
}) {
  const connectOrigin = new URL(config.connectOrigin);
  if (!config.secretKey.trim() || !id(config.integrationId) || !id(config.model) || connectOrigin.protocol !== "https:" ||
    connectOrigin.origin !== config.connectOrigin) throw new Error("Invalid Nango configuration.");
  const send = config.fetch ?? fetch;
  async function request(path: string, init: RequestInit = {}) {
    try {
      const response = await send(new URL(path, "https://api.nango.dev"), { ...init, redirect: "error",
        signal: AbortSignal.timeout(10_000), headers: { ...init.headers, authorization: `Bearer ${config.secretKey}`, accept: "application/json" } });
      if (!response.ok || response.redirected || !response.body) {
        await response.body?.cancel();
        return fail("provider-unavailable", "Source unavailable. Reconnect.");
      }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > OBSERVATION_INPUT_BYTES) { await reader.cancel(); return fail("provider-unavailable", "Source response exceeds the supported size."); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (!object(value)) return fail("provider-unavailable", "Source response is not supported.");
      return value;
    } catch (cause) {
      if (cause instanceof HostedNangoError) throw cause;
      return fail("provider-unavailable", "Source request failed. Retry.");
    }
  }
  async function owns(actor: HostedActor, connectionId: string) {
    if (!id(connectionId)) return fail("invalid-request", "Select a supported source connection.");
    const connection = await request(`/connections/${connectionId}?provider_config_key=${config.integrationId}`);
    if (connection["connection_id"] !== connectionId || connection["provider_config_key"] !== config.integrationId ||
      !object(connection["tags"]) || connection["tags"]["end_user_id"] !== actor.id) return fail("forbidden", "This source connection is unavailable to this account.");
    if (!Array.isArray(connection["errors"]) || connection["errors"].length) return fail("provider-unavailable", "Source error. Reconnect.");
  }
  return {
    async connect(actor: HostedActor): Promise<string> {
      const value = await request("/connect/sessions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: { end_user_id: actor.id }, allowed_integrations: [config.integrationId] }) });
      const data = value["data"];
      if (!object(data) || typeof data["connect_link"] !== "string" || data["connect_link"].length > 4096) return fail("provider-unavailable", "Source connection link is unavailable.");
      let link: URL;
      try { link = new URL(data["connect_link"]); } catch { return fail("provider-unavailable", "Source connection link is invalid."); }
      if (link.origin !== connectOrigin.origin || link.username || link.password || link.hash) return fail("provider-unavailable", "Source connection link has an unexpected destination.");
      return link.href;
    },
    /** Full bounded snapshot only. No deletion/cursor semantics are invented over the importer. */
    async observations(actor: HostedActor, connectionId: string, subject: ObservationBatch["subject"]): Promise<ObservationBatch> {
      await owns(actor, connectionId);
      const observations: ObservationBatch["observations"][number][] = [];
      const seen = new Map<string, string>(); const cursors = new Set<string>(); let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ model: config.model, limit: "100", ...(cursor ? { cursor } : {}) });
        const value = await request(`/records?${query}`, { headers: { "Connection-Id": connectionId, "Provider-Config-Key": config.integrationId } });
        if (!Array.isArray(value["records"]) || value["records"].length > 100) return fail("provider-unavailable", "Source records are malformed or oversized.");
        for (const raw of value["records"]) {
          if (!object(raw) || !object(raw["_nango_metadata"])) return fail("provider-unavailable", "Source record metadata is missing.");
          const metadata = raw["_nango_metadata"];
          if (metadata["deleted_at"] !== null || metadata["pruned_at"] != null || !["ADDED", "UPDATED"].includes(String(metadata["last_action"]))) return fail("provider-unavailable", "Source records were deleted or pruned. Nothing imported.");
          // The configured sync projects only these existing observation fields; raw provider payloads never pass through.
          const projected = { recordId: raw["id"], revision: raw["revision"], title: raw["title"], excerpt: raw["excerpt"], observedAt: raw["observedAt"] };
          let checked: ObservationBatch;
          try { checked = parseObservationBatch({ format: "foliage-observations", version: 1, subject,
            source: { provider: "nango", tenantId: null, accountId: digest([actor.id, config.integrationId, connectionId, config.model]) },
            completion: "complete", deletedRecordIds: [], observations: [projected] }); }
          catch { return fail("provider-unavailable", "Source sync returned invalid fields."); }
          const row = checked.observations[0]!; const key = JSON.stringify([row.recordId, row.revision]); const hash = digest(row);
          if (seen.has(key) && seen.get(key) !== hash) return fail("provider-unavailable", "Source changed during import. Retry.");
          if (!seen.has(key)) { seen.set(key, hash); observations.push(row); }
          if (observations.length > 100) return fail("provider-unavailable", "Too many records. Select a smaller scope.");
        }
        const next = value["next_cursor"];
        if (next === null) {
          await owns(actor, connectionId); // Revocation or rebind during pagination cannot yield a successful read.
          const batch = parseObservationBatch({ format: "foliage-observations", version: 1, subject,
            source: { provider: "nango", tenantId: null, accountId: digest([actor.id, config.integrationId, connectionId, config.model]) },
            completion: "complete", deletedRecordIds: [], observations });
          if (Buffer.byteLength(JSON.stringify(batch)) > OBSERVATION_INPUT_BYTES) return fail("provider-unavailable", "Selected source batch exceeds the review byte limit.");
          return batch;
        }
        if (typeof next !== "string" || !next || next.length > 2048 || cursors.has(next)) return fail("provider-unavailable", "Source pagination did not complete. Nothing was imported.");
        cursors.add(next); cursor = next;
      }
      return fail("provider-unavailable", "Source pagination exceeded its limit. Nothing was imported.");
    },
  };
}
