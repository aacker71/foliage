/** Server-only owner notices. Provider acceptance is not delivery; unknown sends are not retried. */
import { createHash, timingSafeEqual } from "node:crypto";
import type { HostedActor } from "./hostedIdentity.ts";

type Channel = "inbox" | "email" | "sms";
type Preferences = Readonly<Record<Channel | "weeklySummary" | "dailyDigest", boolean>>;
interface Attempt { attemptId: string; eventId: string; recipientId: string; channel: Channel; leaseId: string }
type Outcome = "accepted" | "unknown" | "rejected" | "cancelled";
interface RunResult { claimed: number; accepted: number; unknown: number; rejected: number; cancelled: number; deferred: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,128}$/;
const NOTICE = "A Foliage update is available.";
const bodyFor = (channel: Channel) => channel === "email"
  ? '<p>A Foliage update is available.</p><p><a href="{{payload.reviewUrl}}">Review in Foliage</a></p>'
  : "A Foliage update is available. {{payload.reviewUrl}}";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (bytes: string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
class NotificationError extends Error {
  readonly code: "invalid" | "unavailable" | "configuration";
  constructor(code: NotificationError["code"], message: string) { super(message); this.code = code; }
}
function fail(code: NotificationError["code"], message: string): never { throw new NotificationError(code, message); }
function origin(value: string): string {
  let url: URL; try { url = new URL(value); } catch { return fail("invalid", "Configure a notification service HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    fail("invalid", "Configure a notification service HTTPS origin.");
  }
  return url.origin;
}
function preferences(value: unknown): Preferences {
  if (!object(value) || ["inbox", "email", "sms", "weeklySummary", "dailyDigest"].some(key => typeof value[key] !== "boolean")) fail("invalid", "Invalid notification preferences.");
  return { inbox: value["inbox"] as boolean, email: value["email"] as boolean, sms: value["sms"] as boolean, weeklySummary: value["weeklySummary"] as boolean, dailyDigest: value["dailyDigest"] as boolean };
}
async function json(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) { await reader.cancel(); fail("unavailable", "Notification service response exceeds its limit."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { return fail("unavailable", "Notification service returned an unreadable response."); }
  finally { reader.releaseLock(); }
}
function attempt(value: unknown): Attempt {
  if (!object(value) || ["attemptId", "eventId", "recipientId", "leaseId"].some(key => typeof value[key] !== "string" || !UUID.test(value[key])) ||
      !["inbox", "email", "sms"].includes(String(value["channel"]))) fail("unavailable", "Notification authority returned an invalid lease.");
  return value as unknown as Attempt;
}
/** Conservative single-step templates: no provider overrides, agent routing or stored subscriber content. */
function validateWorkflow(raw: unknown, id: string, channel: Channel): void {
  const workflow = object(raw) && object(raw["data"]) ? raw["data"] : raw;
  if (!object(workflow) || workflow["workflowId"] !== id || workflow["active"] !== true ||
      workflow["status"] !== "ACTIVE" || workflow["origin"] !== "novu-cloud" ||
      workflow["agent"] != null || workflow["isTranslationEnabled"] === true ||
      !Array.isArray(workflow["steps"]) || workflow["steps"].length !== 1) {
    fail("configuration", "Notification workflow must be an active, single-channel generic notice.");
  }
  const step: unknown = workflow["steps"][0];
  if (!object(step) || step["type"] !== (channel === "inbox" ? "in_app" : channel) ||
      step["origin"] !== "novu-cloud" || step["active"] === false || step["disabled"] === true ||
      step["providerOverrides"] != null && (!object(step["providerOverrides"]) || Object.keys(step["providerOverrides"]).length > 0)) {
    fail("configuration", "Notification workflow contains unsupported channel or provider behavior.");
  }
  const controls = object(step["controls"]) ? step["controls"]["values"] : undefined;
  const values = step["controlValues"] ?? controls;
  for (const fields of controls === undefined ? [values] : [values, controls]) {
    if (!object(fields) || fields["body"] !== bodyFor(channel) ||
        Object.keys(fields).some(key => !["body", "subject", "skip"].includes(key)) ||
        fields["skip"] !== undefined && fields["skip"] !== false ||
        (channel === "email" ? fields["subject"] !== "Foliage update" : fields["subject"] !== undefined)) {
      fail("configuration", "Notification template must contain only the configured generic notice and review link.");
    }
  }
}

export function createHostedNotificationWorker(config: {
  supabaseUrl: string; serviceRoleKey: string; novuUrl: string; novuKey: string;
  appOrigin: string; workerSecret: string; workflows: Partial<Record<Channel, string>>;
  fetch?: typeof fetch; now?: () => number;
}) {
  const database = origin(config.supabaseUrl), provider = origin(config.novuUrl), reviewUrl = `${origin(config.appOrigin)}/manage`;
  if (database === provider || !config.serviceRoleKey || !config.novuKey || !/^[A-Za-z0-9._~-]{32,256}$/.test(config.workerSecret) ||
      Object.entries(config.workflows).some(([key, value]) => !["inbox", "email", "sms"].includes(key) || typeof value !== "string" || !IDENTIFIER.test(value))) {
    fail("invalid", "Configure server notification credentials, worker secret and workflow identifiers.");
  }
  const runFetch = config.fetch ?? fetch, now = config.now ?? Date.now;
  async function request(base: string, path: string, method: string, body?: string, transactionId?: string): Promise<Response> {
    const isDatabase = base === database;
    const init: RequestInit & { cache: "no-store" } = { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { "content-type": "application/json", "cache-control": "no-store",
        authorization: isDatabase ? `Bearer ${config.serviceRoleKey}` : `ApiKey ${config.novuKey}`,
        ...(isDatabase ? { apikey: config.serviceRoleKey } : {}),
        ...(transactionId === undefined ? {} : { "idempotency-key": transactionId }) },
      ...(body === undefined ? {} : { body }) };
    try { return await runFetch(new URL(path, base), init); }
    catch { return fail("unavailable", "Notification service did not acknowledge the request."); }
  }
  async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await request(database, `/rest/v1/rpc/${name}`, "POST", JSON.stringify(params));
    if (!response.ok) { await response.body?.cancel(); fail("unavailable", "Notification authority request was not acknowledged."); }
    return json(response);
  }
  async function recipient(id: string, channel: Channel): Promise<Record<string, string> | null> {
    const response = await request(database, `/auth/v1/admin/users/${id}`, "GET");
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); fail("unavailable", "Notification recipient could not be verified."); }
    const user = await json(response);
    if (!object(user) || user["id"] !== id || user["role"] !== "authenticated" || user["aud"] !== "authenticated" ||
        user["is_anonymous"] === true || user["deleted_at"] != null ||
        user["banned_until"] != null && (typeof user["banned_until"] !== "string" || !Number.isFinite(Date.parse(user["banned_until"])) || Date.parse(user["banned_until"]) > now())) return null;
    const verified = (field: string) => typeof user[field] === "string" && Number.isFinite(Date.parse(user[field])) && Date.parse(user[field]) <= now();
    if (channel === "email") {
      if (!verified("email_confirmed_at") || typeof user["email"] !== "string" || user["email"].length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user["email"])) return null;
      return { subscriberId: id, email: user["email"] };
    }
    if (channel === "sms") {
      if (!verified("phone_confirmed_at") || typeof user["phone"] !== "string") return null;
      const phone = user["phone"].startsWith("+") ? user["phone"] : `+${user["phone"]}`;
      if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) return null;
      return { subscriberId: id, phone };
    }
    return { subscriberId: id };
  }
  async function finish(a: Attempt, state: Outcome, reason: string): Promise<Outcome> {
    const result = await rpc("foliage_finish_notification", { p_attempt: a.attemptId, p_lease: a.leaseId, p_state: state, p_reason: reason });
    if (result !== state) fail("unavailable", "Notification outcome could not be recorded.");
    return state;
  }
  async function dispatch(a: Attempt): Promise<Outcome | "deferred"> {
    const workflow = config.workflows[a.channel];
    if (!workflow) return finish(a, "cancelled", "channel_not_configured");
    let to: Record<string, string> | null;
    try {
      to = await recipient(a.recipientId, a.channel);
      if (!to) return finish(a, "cancelled", "recipient_not_verified");
      const response = await request(provider, `/v2/workflows/${workflow}`, "GET");
      if (!response.ok) { await response.body?.cancel(); return finish(a, "rejected", "workflow_not_readable"); }
      validateWorkflow(await json(response), workflow, a.channel);
    } catch (error) {
      if (error instanceof NotificationError && error.code === "configuration") return finish(a, "rejected", "workflow_configuration_refused");
      return "deferred"; // No dispatch marker: a later lease can safely retry the read-only preflight.
    }
    const body = JSON.stringify({ name: workflow, to: [to], payload: { notice: NOTICE, reviewUrl },
      transactionId: a.attemptId, agentId: null });
    let started: unknown;
    try { started = await rpc("foliage_begin_notification", { p_attempt: a.attemptId, p_lease: a.leaseId, p_hash: digest(body), p_workflow: workflow }); }
    catch { return "unknown"; } // A lost marker acknowledgement never authorizes a send.
    if (started === false) return "cancelled";
    if (started !== true) return "unknown";
    let outcome: Outcome = "unknown", reason = "provider_acknowledgement_unknown";
    try {
      const response = await request(provider, "/v1/events/trigger", "POST", body, a.attemptId);
      const raw = await json(response), result = object(raw) && object(raw["data"]) ? raw["data"] : raw;
      if (response.ok && object(result) && result["transactionId"] === a.attemptId && result["acknowledged"] === true && result["status"] === "processed") {
        outcome = "accepted"; reason = "provider_accepted";
      } else if (response.ok && object(result) && result["transactionId"] === a.attemptId &&
          ["trigger_not_active", "no_workflow_active_steps_defined", "no_workflow_steps_defined", "no_tenant_found", "invalid_recipients"].includes(String(result["status"]))) {
        outcome = "rejected"; reason = "provider_refused";
      }
      // Transport, 409, 429, 5xx, malformed and ambiguous errors all remain unknown. No auto resend.
    } catch { /* The persisted dispatch marker remains the recovery boundary. */ }
    try { return await finish(a, outcome, reason); } catch { return "unknown"; }
  }
  async function run(options: { limit?: number } = {}): Promise<RunResult> {
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("invalid", "Notification batch limit must be between 1 and 20.");
    const value = await rpc("foliage_claim_notifications", { p_limit: limit });
    if (!Array.isArray(value) || value.length > limit) fail("unavailable", "Notification authority returned an invalid batch.");
    const attempts = value.map(attempt), result: RunResult = { claimed: attempts.length, accepted: 0, unknown: 0, rejected: 0, cancelled: 0, deferred: 0 };
    // Bounded parallel attempts keep preflight within the 60-second leases; each recipient/channel has its own lease.
    await Promise.all(attempts.map(async a => {
      try { result[await dispatch(a)]++; } catch { result.deferred++; }
    }));
    return result;
  }
  return {
    run,
    async preferences(actor: HostedActor): Promise<Preferences> {
      if (!UUID.test(actor.id)) fail("invalid", "A verified server actor is required.");
      return preferences(await rpc("foliage_notification_preferences", { p_actor: actor.id.toLowerCase() }));
    },
    async setPreferences(actor: HostedActor, value: Preferences): Promise<Preferences> {
      if (!UUID.test(actor.id)) fail("invalid", "A verified server actor is required.");
      const saved = preferences(value);
      return preferences(await rpc("foliage_set_notification_preferences", { p_actor: actor.id.toLowerCase(), p_inbox: saved.inbox, p_email: saved.email, p_sms: saved.sms, p_weekly_summary: saved.weeklySummary, p_daily_digest: saved.dailyDigest }));
    },
    async handleRequest(request: Request): Promise<Response> {
      const headers = { "cache-control": "private, no-store", "content-type": "application/json" };
      const authorization = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${config.workerSecret}`);
      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
        return new Response('{"error":"unauthorized"}', { status: 401, headers });
      }
      if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/notifications/run") return new Response('{"error":"not_found"}', { status: 404, headers });
      try { return new Response(JSON.stringify(await run()), { status: 200, headers }); }
      catch { return new Response('{"error":"notification_worker_unavailable"}', { status: 503, headers }); }
    },
  };
}
