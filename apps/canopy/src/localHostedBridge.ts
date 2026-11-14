import { persistIntegrationObservations, readIntegrationTarget } from "@foliage/leaf-app/integrationStore";
/** Local Canopy companion. Only the gated public projection crosses the configured HTTPS origin. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { PUBLISHED_ID, documentDigest, parsePublishedDocument, toArtifactJson } from "@foliage/canopy";
import { decodePhotoTransfer, photoReferences, checkPhotoBytes } from "./publicationPhotos.ts";
import { decodeVideoTransfer, videoReferences, checkVideoBytes, MAX_HOSTED_REVIEW_FIELDS_BYTES } from "./publicationVideos.ts";
import { readMedia, mediaRootFromEnv } from "@foliage/leaf-app/mediaStore";
import { readVideo, videoRootFromEnv } from "@foliage/leaf-app/videoStore";
import { loadManageState } from "./manageState.ts";
import type { HostedSession } from "./hostedIdentity.ts";
import type { PublicationConsent } from "./hostedAdmission.ts";
import type { PublicationResult, OwnedPublication } from "./hostedStore.ts";

interface Prepared {
  document: unknown; photos?: string; videos?: string; consent: PublicationConsent; actorId: string; current: OwnedPublication; evidence: string;
}
interface Pending {
  kind: "publish" | "withdraw"; operationId: string; subjectId: string; actorId: string;
  expectedGeneration: number; fields: Record<string, string>; status: "ready" | "unconfirmed" | "confirmed" | "refused";
  result: PublicationResult | null;
}
interface BridgeState {
  version: 1; origin: string; session: (HostedSession & { expiresAt: number }) | null;
  prepared: Prepared | null; operation: Pending | null;
  remote: { current: OwnedPublication; document: unknown; artifactDigest: string | null; observedAt: string } | null;
}
export class LocalHostedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new LocalHostedError(code, message); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const secret = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._~-]{1,8192}$/.test(v);
const bytesOf = (v: unknown) => Buffer.from(JSON.stringify(v));
function session(value: unknown): HostedSession {
  if (!object(value) || !object(value["actor"]) || !uuid(value["actor"]["id"]) || !secret(value["accessToken"]) || !secret(value["refreshToken"]) ||
    !Number.isSafeInteger(value["expiresIn"]) || Number(value["expiresIn"]) <= 0 || Number(value["expiresIn"]) > 86400) return fail("invalid-response", "Canopy returned an invalid connection response.");
  return value as unknown as HostedSession;
}
function authority(value: unknown, id: string): OwnedPublication {
  if (!object(value) || value["subjectId"] !== id || !uuid(value["actorId"]) || !Number.isSafeInteger(value["generation"]) || Number(value["generation"]) < 0 ||
    !(value["revisionId"] === null || uuid(value["revisionId"])) || value["visible"] !== (value["revisionId"] !== null)) return fail("invalid-response", "Canopy returned invalid publication state.");
  return value as unknown as OwnedPublication;
}
function receipt(value: unknown, operation: Pending): PublicationResult {
  if (!object(value) || !object(value["receipt"]) || !object(value["current"])) return fail("invalid-response", "Canopy did not return a publication receipt.");
  const r = value["receipt"], current = value["current"];
  if (r["operationId"] !== operation.operationId || r["subjectId"] !== operation.subjectId || r["kind"] !== operation.kind ||
    !Number.isSafeInteger(r["generation"]) || Number(r["generation"]) !== operation.expectedGeneration + 1 || !Number.isSafeInteger(current["generation"]) || Number(current["generation"]) < Number(r["generation"]) ||
    current["subjectId"] !== operation.subjectId || !(current["revisionId"] === null || uuid(current["revisionId"])) || current["visible"] !== (current["revisionId"] !== null) ||
    (operation.kind === "publish" ? !uuid(r["revisionId"]) : r["revisionId"] !== null) ||
    typeof r["committedAt"] !== "string" || !Number.isFinite(Date.parse(r["committedAt"])) || typeof value["replayed"] !== "boolean") return fail("invalid-response", "The saved receipt does not match this publication operation.");
  return value as unknown as PublicationResult;
}
async function readPrivate(path: string): Promise<unknown | null> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.mode & 0o077) return fail("local-state", "Connection file must be private. Fix its permissions.");
    const buffer = Buffer.alloc(16 * 1024 * 1024 + 1); let size = 0;
    while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size === buffer.length) return fail("local-state", "The Canopy connection file exceeds its limit.");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { return fail("local-state", "Connection file unreadable."); }
  } finally { await file.close(); }
}

export function createLocalHostedBridge(config: {
  origin: string; statePath: string; env: Readonly<Record<string, string | undefined>>; fetch?: typeof fetch;
}) {
  const origin = new URL(config.origin);
  if (origin.protocol !== "https:" || origin.origin !== config.origin || origin.username || origin.password) fail("configuration", "Configure one exact HTTPS Canopy origin without credentials or a path.");
  const statePath = resolve(config.statePath), env = config.env;
  if (!env["FOLIAGE_LEAF"] || !env["FOLIAGE_POLICY"]) fail("configuration", "The local Canopy connection requires an explicitly selected Leaf and policy.");
  const leafPath = resolve(env["FOLIAGE_LEAF"]!), policyPath = resolve(env["FOLIAGE_POLICY"]!);
  const statusPath = join(dirname(statePath), "status.json");
  if (new Set([statePath, statusPath, leafPath, policyPath]).size !== 4) fail("configuration", "Connection, status, Leaf and policy must be separate files.");
  async function load(): Promise<BridgeState> {
    const value = await readPrivate(statePath);
    if (value === null) return { version: 1, origin: config.origin, session: null, prepared: null, operation: null, remote: null };
    if (!object(value) || value["version"] !== 1 || value["origin"] !== config.origin || !["session", "prepared", "operation", "remote"].every(k => Object.hasOwn(value, k))) return fail("local-state", "Saved connection is for another origin or format.");
    if (value["session"] !== null) { session(value["session"]); if (!object(value["session"]) || !Number.isFinite(value["session"]["expiresAt"])) fail("local-state", "The saved session has no valid expiry."); }
    const prepared = value["prepared"];
    if (prepared !== null) {
      if (!object(prepared) || !uuid(prepared["actorId"]) || typeof prepared["evidence"] !== "string" || Buffer.byteLength(prepared["evidence"]) > 16 * 1024 || !object(prepared["consent"])) return fail("local-state", "The retained publication review is invalid.");
      const document = parsePublishedDocument(prepared["document"]), consent = prepared["consent"];
      if (!document.ok || Object.keys(consent).length !== 7 || consent["intent"] !== "publish" || !uuid(consent["operationId"]) || consent["subjectId"] !== document.document.leaf.id ||
        consent["artifactDigest"] !== documentDigest(bytesOf(toArtifactJson(document.document))) || consent["policyDigest"] !== document.document.source.policyDigest ||
        !Number.isSafeInteger(consent["expectedGeneration"]) || Number(consent["expectedGeneration"]) < 0 || !(consent["expectedRevisionId"] === null || uuid(consent["expectedRevisionId"]))) return fail("local-state", "Saved review changed. Prepare again.");
      if (prepared["photos"] !== undefined && typeof prepared["photos"] !== "string") return fail("local-state", "Saved image transfer is invalid.");
      decodePhotoTransfer(document.document, typeof prepared["photos"] === "string" ? prepared["photos"] : "[]");
      if (prepared["videos"] !== undefined && typeof prepared["videos"] !== "string") return fail("local-state", "Saved clip transfer is invalid.");
      decodeVideoTransfer(document.document, typeof prepared["videos"] === "string" ? prepared["videos"] : "[]");
      const current = authority(prepared["current"], String(consent["subjectId"]));
      if (current.actorId !== prepared["actorId"] || current.generation !== consent["expectedGeneration"] || current.revisionId !== consent["expectedRevisionId"]) return fail("local-state", "Saved review out of date. Prepare again.");
    }
    const pending = value["operation"];
    if (pending !== null) {
      if (!object(pending) || !uuid(pending["operationId"]) || !uuid(pending["actorId"]) || typeof pending["subjectId"] !== "string" || !PUBLISHED_ID.test(pending["subjectId"]) ||
        !["publish", "withdraw"].includes(String(pending["kind"])) || !["ready", "unconfirmed", "confirmed", "refused"].includes(String(pending["status"])) ||
        !Number.isSafeInteger(pending["expectedGeneration"]) || Number(pending["expectedGeneration"]) < 0 || !object(pending["fields"]) || Object.values(pending["fields"]).some(v => typeof v !== "string")) return fail("local-state", "Saved operation invalid. Check it.");
      const fields = pending["fields"];
      if (pending["kind"] === "publish") {
        if (!object(prepared) || !object(prepared["consent"]) || Object.keys(fields).length !== 4 + Number(prepared["photos"] !== undefined) + Number(prepared["videos"] !== undefined) ||
          (prepared["photos"] !== undefined && fields["photos"] !== prepared["photos"]) ||
          (prepared["videos"] !== undefined && fields["videos"] !== prepared["videos"]) ||
          fields["document"] !== JSON.stringify(prepared["document"]) || fields["evidence"] !== prepared["evidence"] || fields["consent"] !== JSON.stringify(prepared["consent"]) || fields["reviewActorId"] !== prepared["actorId"] ||
          pending["actorId"] !== prepared["actorId"] || pending["operationId"] !== prepared["consent"]["operationId"] || pending["subjectId"] !== prepared["consent"]["subjectId"] || pending["expectedGeneration"] !== prepared["consent"]["expectedGeneration"]) return fail("local-state", "Saved operation changed. Review again.");
      } else if (Object.keys(fields).length !== 3 || fields["operationId"] !== pending["operationId"] || fields["expectedGeneration"] !== String(pending["expectedGeneration"]) || !uuid(fields["expectedRevisionId"])) return fail("local-state", "Saved withdrawal changed. Review again.");
      if (pending["result"] !== null) receipt(pending["result"], pending as unknown as Pending);
      if ((pending["status"] === "confirmed") !== (pending["result"] !== null)) return fail("local-state", "The retained receipt and operation status disagree.");
    }
    const remote = value["remote"];
    if (remote !== null) {
      if (!object(remote) || !object(remote["current"]) || typeof remote["current"]["subjectId"] !== "string" || !PUBLISHED_ID.test(remote["current"]["subjectId"]) || typeof remote["observedAt"] !== "string" || !Number.isFinite(Date.parse(remote["observedAt"]))) return fail("local-state", "The saved hosting observation is invalid.");
      const current = authority(remote["current"], remote["current"]["subjectId"]);
      const doc = remote["document"] === null ? null : parsePublishedDocument(remote["document"]);
      if (current.visible ? !doc?.ok || doc.document.leaf.id !== current.subjectId || remote["artifactDigest"] !== documentDigest(bytesOf(toArtifactJson(doc.document))) : remote["document"] !== null || remote["artifactDigest"] !== null) return fail("local-state", "The saved public bytes do not match the hosting observation.");
    }
    return value as unknown as BridgeState;
  }
  function save(state: BridgeState) {
    const bytes = JSON.stringify(state) + "\n";
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) fail("local-state", "The saved connection exceeds its size limit.");
    writeDocument(statePath, bytes, true, true);
  }
  const previewAccess = env["VERCEL_AUTOMATION_BYPASS_SECRET"];
  if (previewAccess && !origin.hostname.endsWith(".vercel.app")) fail("configuration", "Preview automation access is restricted to the configured Vercel deployment.");
  async function request(path: string, fields?: Record<string, string>, token?: string): Promise<unknown> {
    // Hosted HTTP admission is capped at 4 MiB. Refuse a combined selection locally,
    // before a large upload turns an otherwise reviewed operation into a generic 413.
    if (fields && Object.entries(fields).reduce((size, [key, value]) => size + Buffer.byteLength(key) + Buffer.byteLength(value) + 256, 0) > MAX_HOSTED_REVIEW_FIELDS_BYTES) {
      return fail("transfer-too-large", "This image and demo selection exceeds the hosted upload limit. Choose fewer items and preview again.");
    }
    let response;
    try {
      response = await (config.fetch ?? fetch)(new URL(path, origin), { method: fields ? "POST" : "GET", redirect: "error",
        signal: AbortSignal.timeout(15_000), headers: { accept: "application/json", "cache-control": "no-store", ...(previewAccess ? { "x-vercel-protection-bypass": previewAccess } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(fields ? { body: (fields["photos"] && fields["photos"] !== "[]" || fields["videos"] && fields["videos"] !== "[]") ? (() => { const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); return form; })() : new URLSearchParams(fields) } : {}) });
    } catch { return fail("unavailable", "No response. Check the operation before retrying."); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); return fail("invalid-response", "Canopy's response exceeds the supported size."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { if (response.status === 404) return null; return fail("invalid-response", "Unreadable response. Check the operation."); }
    if (response.status === 404) return null;
    if (!response.ok) return fail(response.status === 401 ? "unauthenticated" : object(value) && typeof value["code"] === "string" ? value["code"] : "unavailable",
      object(value) && typeof value["error"] === "string" ? value["error"].slice(0, 600) : "Canopy refused this action.");
    return value;
  }
  async function access(state: BridgeState) {
    if (!state.session) return fail("unauthenticated", "Connect your Canopy account first.");
    if (state.session.expiresAt <= Date.now() + 30_000) {
      if (state.session.refreshToken === "clerk-device") { state.session = null; save(state); return fail("unauthenticated", "Reconnect with Google."); }
      // A lost refresh response is not retried with an already-rotated credential.
      let fresh: HostedSession;
      try { fresh = session(await request("/api/session/refresh", { refreshToken: state.session.refreshToken })); }
      catch { state.session = null; save(state); return fail("refresh-unknown", "Refresh unconfirmed. Sign in again."); }
      if (fresh.actor.id !== state.session.actor.id) return fail("unauthenticated", "The refreshed account differs from this connection.");
      state.session = { ...fresh, expiresAt: Date.now() + fresh.expiresIn * 1000 }; save(state);
    }
    return state.session.accessToken;
  }
  function safeView(state: BridgeState) {
    return { origin: state.origin, connected: state.session !== null && state.session.expiresAt > Date.now(), accountId: state.session?.actor.id ?? null,
      prepared: state.prepared, operation: state.operation ? { kind: state.operation.kind, operationId: state.operation.operationId, subjectId: state.operation.subjectId, status: state.operation.status, result: state.operation.result } : null,
      remote: state.remote };
  }
  async function recordStatus(state: BridgeState) {
    const remote = state.remote;
    if (!remote) return;
    const parsed = remote.document === null ? null : parsePublishedDocument(remote.document);
    if (parsed && !parsed.ok) return fail("invalid-response", "Canopy returned an unsupported public artifact.");
    const observed = { version: 1, origin: state.origin, subjectId: remote.current.subjectId, observedAt: remote.observedAt,
      visible: remote.current.visible, revisionId: remote.current.revisionId, generation: remote.current.generation,
      documentDigest: parsed?.ok ? parsed.document.source.documentDigest : null,
      policyDigest: parsed?.ok ? parsed.document.source.policyDigest ?? null : null };
    await withDocumentLocks([statusPath], async () => { writeDocument(statusPath, JSON.stringify(observed) + "\n"); });
  }
  async function refresh(state: BridgeState, id: string) {
    const value = await request(`/api/subjects/${encodeURIComponent(id)}`, undefined, await access(state));
    if (!object(value)) return fail("unavailable", "This account's publication state is unavailable.");
    const current = authority(value["current"], id);
    if (current.actorId !== state.session!.actor.id) return fail("invalid-response", "Canopy returned another account's publication.");
    const doc = value["document"] === null ? null : parsePublishedDocument(value["document"]);
    if (current.visible ? !doc?.ok || doc.document.leaf.id !== id || value["artifactDigest"] !== documentDigest(bytesOf(toArtifactJson(doc.document))) : value["document"] !== null || value["artifactDigest"] !== null) return fail("invalid-response", "The public bytes do not match Canopy's current publication state.");
    state.remote = { current, document: value["document"], artifactDigest: value["artifactDigest"] as string | null, observedAt: new Date().toISOString() };
    save(state); await recordStatus(state);
  }
  async function resolveOperation(state: BridgeState): Promise<boolean> {
    const operation = state.operation;
    if (!operation) return false;
    if (state.session?.actor.id !== operation.actorId) return fail("unauthenticated", "Reconnect the account that submitted this operation.");
    const value = await request(`/api/operations/${operation.operationId}`, undefined, await access(state));
    if (value === null) return false;
    operation.result = receipt(value, operation); operation.status = "confirmed"; save(state);
    await refresh(state, operation.subjectId);
    return true;
  }
  return {
    async view() { return safeView(await load()); },
    async importSource(connectionId: string) {
      const selected = env["FOLIAGE_HARVEST"];
      if (!selected?.trim()) return fail("configuration", "Select the existing Photosynthesis harvest before importing a source.");
      const out = resolve(selected);
      if ([statePath, statusPath, leafPath, policyPath].includes(out)) return fail("configuration", "The harvest must be separate from connection, Leaf and policy files.");
      // Keep the account fixed through fetch and write. The shared writer owns Leaf/harvest locks.
      return withDocumentLocks([statePath], async () => {
        const state = await load();
        const target = await readIntegrationTarget(leafPath);
        const value = await request("/api/sources/observations", { connectionId, leafId: String(target.id), name: target.subject }, await access(state));
        return persistIntegrationObservations(value, leafPath, out);
      });
    },
    async photo(artifact: string, digest: string) {
      const state = await load(), p = state.prepared;
      if (!state.session || !p || state.session.actor.id !== p.actorId || p.consent.artifactDigest !== `sha256:${artifact}`) return null;
      const parsed = parsePublishedDocument(p.document);
      if (!parsed.ok) return null;
      const selected = decodePhotoTransfer(parsed.document, p.photos ?? "[]").find(item => item.digest === `sha256:${digest}`);
      const ref = photoReferences(parsed.document).find(item => item.renditionDigest === selected?.digest);
      return selected && ref ? { bytes: selected.bytes, contentType: `image/${ref.format}` } : null;
    },
    async video(artifact: string, digest: string) {
      const state = await load(), p = state.prepared;
      if (!state.session || !p || state.session.actor.id !== p.actorId || p.consent.artifactDigest !== `sha256:${artifact}`) return null;
      const parsed = parsePublishedDocument(p.document);
      if (!parsed.ok) return null;
      const selected = decodeVideoTransfer(parsed.document, p.videos ?? "[]").find(item => item.digest === `sha256:${digest}`);
      const ref = videoReferences(parsed.document).find(item => item.sourceRef === selected?.digest);
      return selected && ref ? { bytes: selected.bytes, contentType: "video/mp4" } : null;
    },
    async command(action: string, fields: Record<string, string>) {
      return withDocumentLocks([statePath, leafPath, policyPath], async () => {
        const state = await load();
        try {
        if (action === "connect" || action === "connect-device") {
          const fresh = session(action === "connect-device" ? await request("/api/session/device", undefined, fields["token"] ?? "") : await request("/api/session", { email: fields["email"] ?? "", password: fields["password"] ?? "" }));
          if (state.operation && state.operation.status === "unconfirmed" && state.operation.actorId !== fresh.actor.id) return fail("account-mismatch", "Finish the saved operation first.");
          const previousActor = state.session?.actor.id ?? state.prepared?.actorId ?? state.remote?.current.actorId ?? state.operation?.actorId;
          if (previousActor && previousActor !== fresh.actor.id) {
            // Invalidate the open app's separate observation before saving the new account.
            await withDocumentLocks([statusPath], async () => { writeDocument(statusPath, JSON.stringify({ version: 1, origin: state.origin, reason: "account-changed" }) + "\n", true, true); });
            state.prepared = null; state.operation = null; state.remote = null;
          }
          state.session = { ...fresh, expiresAt: Date.now() + fresh.expiresIn * 1000 }; save(state);
        } else if (action === "disconnect") {
          let failed = false;
          if (state.session) try { await request("/api/session/disconnect", {}, state.session.accessToken); } catch { failed = true; }
          state.session = null; save(state);
          if (failed) return fail("disconnect-unknown", "Disconnected here. Session revocation unconfirmed.");
        } else if (action === "recover") {
          if (!await resolveOperation(state)) return fail("not-confirmed", "No receipt yet. Check again later.");
        } else if (action === "refresh") {
          const current = await loadManageState(env);
          const id = state.operation?.subjectId ?? (current.kind === "ready" ? String(current.preview.leaf.id) : null);
          if (!id) return fail("local-state", "Choose a valid Leaf or retain a hosted operation before refreshing.");
          await refresh(state, id);
        } else if (action === "prepare") {
          if (state.operation?.status === "unconfirmed") return fail("not-confirmed", "Resolve the saved operation first.");
          const narrative = Object.entries(fields).filter(([key]) => key.startsWith("narrative-")).map(([key, value]) => {
            const match = /^narrative-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(key);
            if (!match || value !== "on") return fail("invalid-request", "Choose narrative using the current review page.");
            return { leaflet: Number(match[1]), element: Number(match[2]) };
          }).sort((a, b) => a.leaflet - b.leaflet || a.element - b.element);
          if (fields["includePortfolio"] !== undefined && fields["includePortfolio"] !== "on") return fail("invalid-request", "Choose authored context using the current review page.");
          for (const [key, value] of Object.entries(fields)) {
            if (key.startsWith("photo-caption-") && value === "on" && fields[key.replace("photo-caption-", "photo-select-")] !== "on") return fail("invalid-request", "Choose an image before its caption.");
            if (key.startsWith("video-caption-") && value === "on" && fields[key.replace("video-caption-", "video-select-")] !== "on") return fail("invalid-request", "Choose a clip before its caption.");
          }
          const photos = Object.entries(fields).filter(([key]) => key.startsWith("photo-select-")).map(([key, value]) => {
            const match = /^photo-select-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(key);
            if (!match || value !== "on") return fail("invalid-request", "Choose images on the current review page.");
            const suffix = `${match[1]}-${match[2]}`;
            return { leaflet: Number(match[1]), element: Number(match[2]), digest: fields[`photo-digest-${suffix}`] ?? "", alt: fields[`photo-alt-${suffix}`] ?? "", caption: fields[`photo-caption-${suffix}`] === "on" };
          }).sort((a, b) => a.leaflet - b.leaflet || a.element - b.element);
          const videos = Object.entries(fields).filter(([key]) => key.startsWith("video-select-")).map(([key, value]) => {
            const match = /^video-select-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(key);
            if (!match || value !== "on") return fail("invalid-request", "Choose clips on the current review page.");
            const suffix = `${match[1]}-${match[2]}`;
            return { leaflet: Number(match[1]), element: Number(match[2]), digest: fields[`video-digest-${suffix}`] ?? "", caption: fields[`video-caption-${suffix}`] === "on" };
          }).sort((a, b) => a.leaflet - b.leaflet || a.element - b.element);
          const current = await loadManageState(env, narrative, { includePortfolio: fields["includePortfolio"] === "on", photos, videos });
          if (current.kind !== "ready") return fail("local-state", [current.detail, ...current.issues].join(" "));
          if (fields["sourceDigest"] !== current.sourceDigest || fields["policyDigest"] !== current.policyDigest) return fail("stale-review", "Leaf or policy changed. Review again.");
          const token = await access(state), document = toArtifactJson(current.preview), id = String(current.preview.leaf.id), operationId = randomUUID();
          await request("/api/subjects", { subjectId: id }, token);
          const evidence = fields["evidence"] ?? "";
          const preview = await request(`/api/subjects/${id}/preview`, { document: JSON.stringify(document), evidence, operationId, photos: current.photoTransfer ?? "[]", videos: current.videoTransfer ?? "[]" }, token);
          if (!object(preview) || !object(preview["consent"]) || preview["actorId"] !== state.session!.actor.id || JSON.stringify(preview["document"]) !== JSON.stringify(document)) return fail("invalid-response", "Canopy's preview differs from the selected local publication.");
          const consent = preview["consent"] as unknown as PublicationConsent;
          if (consent.intent !== "publish" || consent.operationId !== operationId || consent.subjectId !== id || consent.artifactDigest !== documentDigest(bytesOf(document)) || consent.policyDigest !== current.policyDigest) return fail("invalid-response", "Canopy's confirmation does not match the selected publication.");
          const remote = authority(preview["current"], id);
          if (remote.actorId !== state.session!.actor.id || consent.expectedGeneration !== remote.generation || consent.expectedRevisionId !== remote.revisionId) return fail("invalid-response", "Canopy's review doesn’t match. Prepare again.");
          state.prepared = { document, photos: current.photoTransfer ?? "[]", videos: current.videoTransfer ?? "[]", consent, actorId: state.session!.actor.id, current: remote, evidence };
          state.operation = { kind: "publish", operationId, subjectId: id, actorId: state.session!.actor.id, status: "ready", result: null, expectedGeneration: remote.generation,
            fields: { document: JSON.stringify(document), photos: current.photoTransfer ?? "[]", videos: current.videoTransfer ?? "[]", evidence, consent: JSON.stringify(consent), reviewActorId: state.session!.actor.id } };
          save(state); await refresh(state, id);
        } else if (action === "publish" || action === "withdraw") {
          if (state.operation?.status === "unconfirmed") {
            if (fields["operationId"] !== state.operation.operationId || fields["confirm"] !== state.operation.subjectId || action !== state.operation.kind) return fail("not-confirmed", "Resolve the saved operation first.");
            if (await resolveOperation(state)) return safeView(state);
          }
          if (action === "publish") {
            const p = state.prepared, current = await loadManageState(env);
            if (!p || !state.operation || fields["operationId"] !== p.consent.operationId || fields["confirm"] !== p.consent.subjectId || state.session?.actor.id !== p.actorId) return fail("stale-review", "Review changed. Review again.");
            const parsed = parsePublishedDocument(p.document);
            if (!parsed.ok || current.kind !== "ready" || current.sourceDigest !== parsed.document.source.documentDigest || current.policyDigest !== parsed.document.source.policyDigest) return fail("stale-review", "Leaf or policy changed. Prepare again.");
            for (const photo of photoReferences(parsed.document)) {
              const held = await readMedia(mediaRootFromEnv(env), photo.sourceRef);
              if (!held.ok) return fail("stale-review", "A selected image is unavailable. Prepare again.");
              checkPhotoBytes(photo, Buffer.from(held.bytes));
            }
            decodePhotoTransfer(parsed.document, p.photos ?? "[]");
            for (const video of videoReferences(parsed.document)) {
              const held = await readVideo(videoRootFromEnv(env), video.sourceRef);
              if (!held.ok) return fail("stale-review", "A selected clip is unavailable. Prepare again.");
              if (held.metadata.posterRef !== video.posterRef || held.metadata.durationSeconds !== video.durationSeconds) return fail("stale-review", "A selected clip changed. Prepare again.");
              checkVideoBytes(video, held.bytes);
            }
            decodeVideoTransfer(parsed.document, p.videos ?? "[]");
          } else if (state.operation?.status !== "unconfirmed") {
            const remote = state.remote;
            if (!remote?.current.visible || fields["confirm"] !== remote.current.subjectId || fields["revisionId"] !== remote.current.revisionId || fields["generation"] !== String(remote.current.generation)) return fail("stale-review", "Public version changed. Refresh.");
            state.operation = { kind: "withdraw", operationId: randomUUID(), actorId: state.session?.actor.id ?? "", subjectId: remote.current.subjectId, status: "ready", result: null, expectedGeneration: remote.current.generation,
              fields: { expectedRevisionId: remote.current.revisionId!, expectedGeneration: String(remote.current.generation) } };
            state.operation.fields["operationId"] = state.operation.operationId;
          }
          const operation = state.operation!;
          if (operation.kind !== action || operation.actorId !== state.session?.actor.id) return fail("stale-review", "Saved operation doesn’t match. Check it.");
          const token = await access(state);
          operation.status = "unconfirmed"; save(state); // Durable operation identity BEFORE crossing the network.
          try {
            operation.result = receipt(await request(`/api/subjects/${operation.subjectId}/${action}`, operation.fields, token), operation);
          } catch (error) {
            if (error instanceof LocalHostedError && ["conflict", "consent-mismatch", "forbidden", "invalid-request", "verification-required", "unauthenticated"].includes(error.code)) operation.status = "refused";
            save(state); throw error;
          }
          operation.status = "confirmed"; save(state); await refresh(state, operation.subjectId);
        } else return fail("invalid-action", "Choose an action from the Canopy connection page.");
        return safeView(state);
        } catch (error) {
          if (error instanceof LocalHostedError && error.code === "unauthenticated") { state.session = null; save(state); }
          throw error;
        }
      });
    },
  };
}
export type LocalHostedView = Awaited<ReturnType<ReturnType<typeof createLocalHostedBridge>["view"]>>;
