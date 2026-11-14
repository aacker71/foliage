/** Synthetic Nango protocol responses only. These are not real feedback or provider acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostedNango } from "./hostedNango.ts";
const actor = { id: "protocol-actor" };
const subject = { leafId: "protocol-leaf", name: "Protocol harness" };
const row = { id: "protocol-record", revision: "v1", title: "Protocol input", excerpt: "Synthetic protocol payload, not customer evidence.", observedAt: "2026-09-16T00:00:00Z",
  _nango_metadata: { deleted_at: null, last_action: "ADDED" } };
function setup(options: { pages?: unknown[]; foreign?: boolean; revoked?: boolean; link?: string; connectionError?: boolean } = {}) {
  const calls: Request[] = []; let reads = 0, page = 0;
  const adapter = createHostedNango({ secretKey: "protocol-secret-canary", integrationId: "protocol-source", model: "FoliageObservation", connectOrigin: "https://connect.example.invalid",
    fetch: async (input, init) => {
      const req = new Request(input, init); calls.push(req);
      assert.equal(req.headers.get("authorization"), "Bearer protocol-secret-canary"); assert.equal(req.redirect, "error");
      const url = new URL(req.url); assert.equal(url.origin, "https://api.nango.dev");
      if (url.pathname === "/connect/sessions") return Response.json({ data: { connect_link: options.link ?? "https://connect.example.invalid/start?session=short-lived", token: "never-return-this-field" } }, { status: 201 });
      if (url.pathname.startsWith("/connections/")) { reads++; return Response.json({ connection_id: "connection", provider_config_key: "protocol-source", tags: { end_user_id: options.foreign || options.revoked && reads > 1 ? "foreign" : actor.id }, errors: options.connectionError ? [{ type: "sync" }] : [], credentials: { access_token: "provider-secret-canary" } }); }
      assert.equal(req.headers.get("Connection-Id"), "connection");
      return Response.json(options.pages?.[page++] ?? { records: [row], next_cursor: null });
    } });
  return { adapter, calls };
}
test("connect sessions bind server actor and allowed integration; only validated destination leaves adapter", async () => {
  const h = setup(); const link = await h.adapter.connect(actor);
  assert.equal(link, "https://connect.example.invalid/start?session=short-lived");
  assert.deepEqual(await h.calls[0]!.json(), { tags: { end_user_id: actor.id }, allowed_integrations: ["protocol-source"] });
  await assert.rejects(setup({ link: "https://foreign.invalid/" }).adapter.connect(actor), /unexpected destination/);
});
test("bounded pagination and replay deduplication emit the existing review contract without credentials", async () => {
  const h = setup({ pages: [{ records: [row], next_cursor: "next" }, { records: [row], next_cursor: null }] });
  const batch = await h.adapter.observations(actor, "connection", subject);
  assert.equal(batch.observations.length, 1); assert.deepEqual(batch.subject, subject);
  assert.equal(batch.format, "foliage-observations");
  assert.equal(JSON.stringify(batch).includes("secret-canary"), false);
  assert.equal(h.calls.filter(r => new URL(r.url).pathname.startsWith("/connections/")).length, 2);
  assert.equal(new URL(h.calls[2]!.url).searchParams.get("cursor"), "next");
});
test("foreign, revoked and unhealthy connections cannot supply records", async () => {
  const h = setup({ foreign: true }); await assert.rejects(h.adapter.observations(actor, "connection", subject), /unavailable to this account/);
  assert.equal(h.calls.length, 1);
  await assert.rejects(setup({ revoked: true }).adapter.observations(actor, "connection", subject), /unavailable to this account/);
  await assert.rejects(setup({ connectionError: true }).adapter.observations(actor, "connection", subject), /Source error/);
});
test("pruned/deleted records, stalled pagination and changed revision material refuse complete acquisition", async () => {
  for (const metadata of [{ deleted_at: "2026-09-16", last_action: "DELETED" }, { deleted_at: null, pruned_at: "2026-09-16", last_action: "UPDATED" }]) {
    await assert.rejects(setup({ pages: [{ records: [{ ...row, _nango_metadata: metadata }], next_cursor: null }] }).adapter.observations(actor, "connection", subject), /deleted or pruned/);
  }
  await assert.rejects(setup({ pages: [{ records: [], next_cursor: "x" }, { records: [], next_cursor: "x" }] }).adapter.observations(actor, "connection", subject), /pagination/);
  await assert.rejects(setup({ pages: [{ records: [row, { ...row, excerpt: "Changed protocol data" }], next_cursor: null }] }).adapter.observations(actor, "connection", subject), /Source changed during import/);
  await assert.rejects(setup({ pages: [{ records: [{ id: "raw-provider-payload" }], next_cursor: null }] }).adapter.observations(actor, "connection", subject), /metadata/);
});
test("provider exceptions are sanitized; transport bounds responses and never follows redirects", async () => {
  for (const send of [async () => { throw Error("secret-canary"); }, async () => new Response("secret-canary", { status: 302, headers: { location: "https://foreign.invalid" } }), async () => new Response("x".repeat(1024 * 1024 + 1))]) {
    const adapter = createHostedNango({ secretKey: "not-a-real-key", integrationId: "source", model: "Model", connectOrigin: "https://connect.example.invalid", fetch: send });
    await assert.rejects(adapter.connect(actor), error => error instanceof Error && !error.message.includes("secret-canary"));
  }
});
