/** An owner-started, key-bound read session. It owns no listener, tunnel or hosted state. */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import * as z from "zod/v4";
import { searchRecords, type SearchRecord } from "@foliage/photosynthesis/search";

const MAX_BODY = 4096;
const MAX_NONCES = 1024;
const MAX_CLOCK_SKEW = 60_000;
const MAX_SESSION = 60 * 60_000;
const input = z.strictObject({ query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(10).optional() });
const id = z.string().min(1).max(256);

export interface PrivateBrainSnapshot {
  readonly subject: { readonly leafId: string; readonly name: string };
  readonly records: readonly SearchRecord[];
}
export interface PrivateBrainReceipt {
  readonly at: string;
  readonly session: string;
  readonly agent: string;
  readonly agentLabel: string;
  readonly leafId: string;
  readonly scope: readonly string[];
  readonly queryDigest: string;
  readonly hits: readonly string[];
}
type RefusalReason = "session-ended" | "not-found" | "method-not-allowed" | "origin-refused" | "json-required" | "agent-refused"
  | "invalid-request" | "request-too-large" | "replay-refused" | "invalid-query" | "record-unavailable" | "scope-changed" | "receipt-unavailable";
/** What the owner may see about an answer that released nothing: never query text or key material. */
export interface PrivateBrainRefusal {
  readonly at: string;
  readonly status: number;
  readonly reason: RefusalReason;
  /** The granted agent key's fingerprint, present only once the request's signature verified. */
  readonly agent?: string;
}
export interface PrivateBrainSessionOptions {
  readonly publicKeyPem: string;
  readonly agentLabel: string;
  readonly recordIds: readonly string[];
  readonly read: () => Promise<PrivateBrainSnapshot>;
  /** Must durably record the transfer before the response is released. Failure denies the read. */
  readonly receipt: (value: PrivateBrainReceipt) => Promise<void>;
  /** Told once for each request that released nothing. A throw here never changes the answer. */
  readonly refused?: (value: PrivateBrainRefusal) => void;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scopeDigest = (subject: PrivateBrainSnapshot["subject"], records: readonly SearchRecord[]) =>
  digest(JSON.stringify({ subject, records }));
const response = (status: number, value: Record<string, unknown>) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" },
});

/** The signing input is public protocol structure; the external agent alone holds its private key. */
export function privateBrainSigningInput(session: string, timestamp: string, nonce: string, rawBody: Uint8Array): Buffer {
  return Buffer.from(`foliage-private-search-v1\nPOST\n/private-brain/search\n${session}\n${timestamp}\n${nonce}\n${digest(rawBody)}\n`);
}

async function boundedBody(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function exactRecords(snapshot: PrivateBrainSnapshot, recordIds: readonly string[]): SearchRecord[] {
  if (new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) throw new Error("Duplicate local record IDs.");
  const byId = new Map(snapshot.records.map(record => [record.id, record]));
  return recordIds.map(recordId => {
    const record = byId.get(recordId);
    if (!record) throw new Error("One selected record is no longer available.");
    return record;
  });
}

/** The owner explicitly starts the session with exact records and an agent public key.
 * Revocation is in-process, immediate for any response not already released. */
export async function createPrivateBrainSession(options: PrivateBrainSessionOptions) {
  if (!options.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("An Ed25519 public key is required.");
  const key = createPublicKey(options.publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 public key is required.");
  const agentLabel = z.string().trim().min(1).max(100).parse(options.agentLabel);
  const recordIds = z.array(id).min(1).max(32).parse(options.recordIds);
  if (new Set(recordIds).size !== recordIds.length) throw new Error("Select each record once.");
  const ttlMs = options.ttlMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_SESSION) throw new Error("Session length must be 1–60 minutes.");
  const now = options.now ?? Date.now;
  const initial = await options.read();
  const subject = { ...initial.subject };
  if (!subject.leafId || !subject.name) throw new Error("The selected Leaf has no stable identity.");
  const selected = exactRecords(initial, recordIds);
  const frozen = scopeDigest(subject, selected);
  const session = randomBytes(16).toString("hex");
  const agent = digest(key.export({ type: "spki", format: "der" }));
  const expiresAt = now() + ttlMs;
  const nonces = new Set<string>();
  let revoked = false;
  const active = () => !revoked && now() < expiresAt;
  /** The answer is decided before the owner is told; a failing report never changes it. */
  const refuse = (status: number, reason: RefusalReason, verified = false) => {
    try { options.refused?.({ at: new Date(now()).toISOString(), status, reason, ...(verified ? { agent } : {}) }); } catch { /* report only */ }
    return response(status, { code: reason });
  };

  return {
    identity: { session, agent, agentLabel, leafId: subject.leafId, recordIds: [...recordIds], expiresAt: new Date(expiresAt).toISOString() },
    revoke() { revoked = true; nonces.clear(); },
    async handle(request: Request): Promise<Response> {
      if (!active()) return refuse(403, "session-ended");
      const url = new URL(request.url);
      if (url.pathname !== "/private-brain/search" || url.search || url.hash) return refuse(404, "not-found");
      if (request.method !== "POST") return refuse(405, "method-not-allowed");
      // A browser page cannot borrow the owner's local session through an Origin-bearing request.
      if (request.headers.has("origin")) return refuse(403, "origin-refused");
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
        return refuse(415, "json-required");
      const timestamp = request.headers.get("x-foliage-timestamp") ?? "";
      const nonce = request.headers.get("x-foliage-nonce") ?? "";
      const signature = request.headers.get("x-foliage-signature") ?? "";
      if (request.headers.get("x-foliage-session") !== session || !/^\d{10,13}$/.test(timestamp) ||
          Math.abs(now() - Number(timestamp)) > MAX_CLOCK_SKEW || !/^[A-Za-z0-9_-]{22,64}$/.test(nonce) ||
          !/^[A-Za-z0-9_-]{86}$/.test(signature)) return refuse(401, "agent-refused");
      let body: Uint8Array | null;
      try { body = await boundedBody(request); }
      catch { return refuse(400, "invalid-request"); }
      if (!body) return refuse(413, "request-too-large");
      const signatureBytes = Buffer.from(signature, "base64url");
      if (signatureBytes.length !== 64 || !verify(null, privateBrainSigningInput(session, timestamp, nonce, body), key, signatureBytes))
        return refuse(401, "agent-refused");
      // From here the request is signed by the granted key, so a refusal names that key.
      if (nonces.has(nonce) || nonces.size >= MAX_NONCES) return refuse(409, "replay-refused", true);
      nonces.add(nonce);
      let parsed: z.infer<typeof input>;
      try { parsed = input.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
      catch { return refuse(400, "invalid-query", true); }
      let current: PrivateBrainSnapshot;
      try { current = await options.read(); }
      catch { return refuse(503, "record-unavailable", true); }
      if (current.subject.leafId !== subject.leafId || current.subject.name !== subject.name)
        return refuse(409, "scope-changed", true);
      let selectedNow: SearchRecord[];
      try { selectedNow = exactRecords(current, recordIds); }
      catch { return refuse(409, "scope-changed", true); }
      if (scopeDigest(current.subject, selectedNow) !== frozen) return refuse(409, "scope-changed", true);
      let hits: ReturnType<typeof searchRecords>;
      try { hits = searchRecords(selectedNow, parsed.query, parsed.limit === undefined ? {} : { limit: parsed.limit }); }
      catch { return refuse(503, "record-unavailable", true); }
      if (!active()) return refuse(403, "session-ended", true);
      // An excluded record's snippet is already its reason; the reason field names it as such.
      const outward = hits.map(({ id, kind, title, snippet, citation, reason }) =>
        ({ id, kind, title, snippet, citation, ...(reason === undefined ? {} : { reason }) }));
      try {
        await options.receipt({ at: new Date(now()).toISOString(), session, agent, agentLabel,
          leafId: subject.leafId, scope: [...recordIds], queryDigest: digest(parsed.query), hits: outward.map(hit => hit.id) });
      } catch { return refuse(503, "receipt-unavailable", true); }
      if (!active()) return refuse(403, "session-ended", true);
      return response(200, { session, hits: outward });
    },
  };
}
