/** Scripted transport faults, not customer records or live provider delivery evidence. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostedNotificationWorker } from "./hostedNotifications.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const lease = { attemptId: "20000000-0000-4000-8000-000000000001", eventId: "30000000-0000-4000-8000-000000000001",
  recipientId: owner, channel: "inbox", leaseId: "40000000-0000-4000-8000-000000000001" };
const secret = "notification-harness-secret-00000000000000";
const time = Date.parse("2026-09-08T12:00:00.000Z");
const user = { id: owner, aud: "authenticated", role: "authenticated", email: "owner@example.invalid",
  email_confirmed_at: "2026-09-01T00:00:00.000Z", phone: "12025550101", phone_confirmed_at: "2026-09-01T00:00:00.000Z" };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function workflow(channel = "inbox") {
  return { workflowId: `notice-${channel}`, active: true, status: "ACTIVE", origin: "novu-cloud", agent: null,
    steps: [{ type: channel === "inbox" ? "in_app" : channel, origin: "novu-cloud", controlValues: channel === "email"
      ? { body: '<p>A Foliage update is available.</p><p><a href="{{payload.reviewUrl}}">Review in Foliage</a></p>', subject: "Foliage update" }
      : { body: "A Foliage update is available. {{payload.reviewUrl}}" } }] };
}
interface Call { path: string; host: string; body: Record<string, unknown>; init: RequestInit }
function harness(options: {
  channel?: string; user?: unknown; workflow?: unknown; begin?: () => Response; trigger?: () => Response;
  finish?: () => Response; claim?: () => Response; admin?: () => Response;
} = {}) {
  const calls: Call[] = [], channel = options.channel ?? "inbox";
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const call = { path: url.pathname, host: url.hostname, body, init }; calls.push(call);
    const headers = new Headers(init.headers);
    assert.equal(init.redirect, "error"); assert.equal(headers.get("cache-control"), "no-store");
    assert.equal(headers.get("authorization"), url.hostname === "database.example" ? "Bearer database-harness-key" : "ApiKey provider-harness-key");
    if (url.pathname.endsWith("foliage_claim_notifications")) return options.claim?.() ?? response([{ ...lease, channel }]);
    if (url.pathname.startsWith("/auth/v1/admin/users/")) return options.admin?.() ?? response(options.user ?? user);
    if (url.pathname.startsWith("/v2/workflows/")) return response(options.workflow ?? workflow(channel));
    if (url.pathname.endsWith("foliage_begin_notification")) return options.begin?.() ?? response(true);
    if (url.pathname === "/v1/events/trigger") return options.trigger?.() ?? response({ acknowledged: true, status: "processed", transactionId: lease.attemptId }, 201);
    if (url.pathname.endsWith("foliage_finish_notification")) return options.finish?.() ?? response(body["p_state"]);
    if (url.pathname.endsWith("foliage_notification_preferences")) return response({ inbox: true, email: false, sms: false, weeklySummary: true, dailyDigest: false });
    if (url.pathname.endsWith("foliage_set_notification_preferences")) return response({ inbox: body["p_inbox"], email: body["p_email"], sms: body["p_sms"], weeklySummary: body["p_weekly_summary"], dailyDigest: body["p_daily_digest"] });
    throw new Error("Unexpected transport harness request");
  };
  const worker = createHostedNotificationWorker({ supabaseUrl: "https://database.example", serviceRoleKey: "database-harness-key",
    novuUrl: "https://provider.example", novuKey: "provider-harness-key", appOrigin: "https://foliage.example", workerSecret: secret,
    workflows: { inbox: "notice-inbox", email: "notice-email", sms: "notice-sms" }, fetch: fetcher, now: () => time });
  return { worker, calls, sends: () => calls.filter(c => c.path === "/v1/events/trigger") };
}

test("owner notices bind lease transaction, verified recipient and exact generic payload", async () => {
  for (const channel of ["inbox", "email", "sms"]) {
    const h = harness({ channel }); const result = await h.worker.run();
    assert.equal(result.accepted, 1); assert.equal(result.unknown, 0);
    const call = h.sends()[0]!;
    assert.equal(new Headers(call.init.headers).get("idempotency-key"), lease.attemptId);
    assert.equal(call.body["transactionId"], lease.attemptId); assert.equal(call.body["agentId"], null);
    assert.deepEqual(call.body["payload"], { notice: "A Foliage update is available.", reviewUrl: "https://foliage.example/manage" });
    assert.deepEqual(call.body["to"], [{ subscriberId: owner, ...(channel === "email" ? { email: user.email } : channel === "sms" ? { phone: "+12025550101" } : {}) }]);
    assert.deepEqual(h.calls.map(c => c.path.split("/").pop()), ["foliage_claim_notifications", owner, `notice-${channel}`, "foliage_begin_notification", "trigger", "foliage_finish_notification"]);
    assert.match(String(h.calls[3]!.body["p_hash"]), /^sha256:[0-9a-f]{64}$/);
  }
});

test("foreign, deleted, banned and unconfirmed provider contacts cannot receive a trigger", async () => {
  for (const invalid of [{ ...user, id: lease.eventId }, { ...user, deleted_at: "2026-09-01" },
    { ...user, banned_until: "2027-01-01" }, { ...user, email_confirmed_at: null },
    { ...user, email_confirmed_at: "2027-01-01", user_metadata: { email_confirmed: true } }]) {
    const h = harness({ channel: "email", user: invalid });
    assert.equal((await h.worker.run()).cancelled, 1); assert.equal(h.sends().length, 0);
  }
  const h = harness({ channel: "sms", user: { ...user, phone_confirmed_at: null } });
  assert.equal((await h.worker.run()).cancelled, 1); assert.equal(h.sends().length, 0);
});

test("runtime workflow validation refuses multichannel, disabled extras, agent routing and personalized templates", async () => {
  for (const value of [
    { ...workflow(), steps: [...workflow().steps, { type: "sms", disabled: true }] },
    { ...workflow(), active: false }, { ...workflow(), origin: "external" },
    { ...workflow(), agent: { identifier: "unauthorized-agent" } },
    { ...workflow(), steps: [{ ...workflow().steps[0], controlValues: { body: "Hello {{subscriber.firstName}}" } }] },
    { ...workflow(), steps: [{ ...workflow().steps[0], providerOverrides: { sms: { to: "+12025550101" } } }] },
  ]) {
    const h = harness({ workflow: value }); assert.equal((await h.worker.run()).rejected, 1);
    assert.equal(h.sends().length, 0); assert.equal(h.calls.some(c => c.path.endsWith("foliage_begin_notification")), false);
  }
});

test("withdrawal or preference change at final SQL authorization stops the trigger", async () => {
  const h = harness({ begin: () => response(false) });
  assert.equal((await h.worker.run()).cancelled, 1); assert.equal(h.sends().length, 0);
});

test("lost dispatch-marker acknowledgement never authorizes the external send", async () => {
  const h = harness({ begin: () => { throw new Error("test-only dropped database response"); } });
  assert.equal((await h.worker.run()).unknown, 1); assert.equal(h.sends().length, 0);
});

test("lost, ambiguous and wrong-transaction provider responses record unknown without automatic resend", async () => {
  for (const trigger of [() => { throw new Error("test-only dropped provider response"); },
    () => response({ acknowledged: true, status: "processed", transactionId: lease.eventId }, 201),
    () => response({ status: "processing" }, 409), () => response({ error: "timeout" }, 503),
    () => new Response("malformed", { status: 201 })]) {
    const h = harness({ trigger }); assert.equal((await h.worker.run()).unknown, 1);
    assert.equal(h.sends().length, 1);
    assert.equal(h.calls.at(-1)!.body["p_state"], "unknown");
  }
});

test("lost outcome write remains unknown even after provider acceptance", async () => {
  const h = harness({ finish: () => { throw new Error("test-only dropped finish response"); } });
  const result = await h.worker.run(); assert.equal(result.unknown, 1); assert.equal(result.accepted, 0);
  assert.equal(h.sends().length, 1);
});

test("failed read-only preflight defers without a dispatch marker", async () => {
  const h = harness({ admin: () => response({ error: "test-only unavailable" }, 503) });
  assert.equal((await h.worker.run()).deferred, 1); assert.equal(h.sends().length, 0);
  assert.equal(h.calls.some(c => c.path.endsWith("foliage_begin_notification")), false);
});

test("worker HTTP entry requires exact bearer and POST and cannot change its batch from a body", async () => {
  const h = harness({ claim: () => response([]) });
  for (const authorization of [undefined, `Bearer ${secret}x`, `Bearer ${"é".repeat(secret.length)}`]) {
    const result = await h.worker.handleRequest(new Request("https://foliage.example/internal/notifications/run", { method: "POST",
      headers: authorization === undefined ? {} : { authorization } }));
    assert.equal(result.status, 401);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.worker.handleRequest(new Request("https://foliage.example/internal/notifications/run", { headers: { authorization: `Bearer ${secret}` } }))).status, 404);
  const result = await h.worker.handleRequest(new Request("https://foliage.example/internal/notifications/run", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: '{"limit":999}' }));
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(h.calls[0]!.body["p_limit"], 10);
});

test("preference writes bind server actor and require explicit channel booleans", async () => {
  const h = harness();
  assert.deepEqual(await h.worker.preferences({ id: owner }), { inbox: true, email: false, sms: false, weeklySummary: true, dailyDigest: false });
  assert.deepEqual(await h.worker.setPreferences({ id: owner }, { inbox: false, email: true, sms: false, weeklySummary: true, dailyDigest: true }), { inbox: false, email: true, sms: false, weeklySummary: true, dailyDigest: true });
  assert.equal(h.calls.at(-1)!.body["p_actor"], owner);
  assert.equal(h.calls.at(-1)!.body["p_daily_digest"], true);
  assert.equal(h.sends().length, 0);
  await assert.rejects(h.worker.setPreferences({ id: owner }, { inbox: true, email: false, sms: false } as never));
  await assert.rejects(h.worker.setPreferences({ id: owner }, { email: true } as never));
  await assert.rejects(h.worker.run({ limit: 21 }));
});
