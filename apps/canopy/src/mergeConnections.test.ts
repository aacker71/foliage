/** Substituted Merge protocol responses, not real customer authorization or ATS delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import { createMergeConnections } from "./mergeConnections.ts";
const actor = { id: "00000000-0000-4000-8000-000000000001" };
const account = (overrides = {}) => ({ id: "00000000-0000-4000-8000-000000000002", category: "ats", end_user_origin_id: `foliage:ats:${actor.id}`, end_user_organization_name: "Protocol test organization", integration: { name: "Protocol test ATS" }, status: "COMPLETE", ...overrides });
function harness(responses: unknown[], region = "us") {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init: init! });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return Response.json(next);
  };
  return { calls, service: createMergeConnections({ apiKey: "protocol-test-secret", region, fetch: fetcher }) };
}
test("Merge Link binds actor, ATS category, contact labels and disabled sync, and emits only its hosted URL", async () => {
  const h = harness([{ magic_link_url: "https://link.merge.dev/protocol-test", link_token: "not-for-browser" }], "eu");
  assert.equal(await h.service.connect(actor, { email: "admin@example.invalid", organization: "Protocol organization" }), "https://link.merge.dev/protocol-test");
  const { url, init } = h.calls[0]!;
  assert.equal(url.href, "https://api-eu.merge.dev/api/ats/v1/link-token");
  assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.ok(init.signal);
  assert.deepEqual(JSON.parse(String(init.body)), { end_user_origin_id: `foliage:ats:${actor.id}`, end_user_email_address: "admin@example.invalid", end_user_organization_name: "Protocol organization", categories: ["ats"], are_syncs_disabled: true, should_create_magic_link_url: true, link_expiry_mins: 30 });
});
test("connection metadata is bounded, paged, actor-filtered and strips credentials and provider internals", async () => {
  const h = harness([{ results: [account({ account_token: "never-expose", status_detail: "private diagnostic" })], next: "next_cursor=" }, { results: [account({ id: "00000000-0000-4000-8000-000000000003", status: "RELINK_NEEDED" })], next: null }]);
  const rows = await h.service.list(actor);
  assert.equal(rows.length, 2); assert.equal(rows[1]?.state, "reconnect");
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["id", "integration", "organization", "state"]);
  for (const { url, init } of h.calls) { assert.equal(url.searchParams.get("category"), "ats"); assert.equal(url.searchParams.get("end_user_origin_id"), `foliage:ats:${actor.id}`); assert.equal(init.method, "GET"); }
  assert.equal(h.calls[1]!.url.searchParams.get("cursor"), "next_cursor=");
});
test("foreign owner, non-ATS, duplicate account, invalid status and malformed pagination fail closed", async () => {
  for (const response of [
    { results: [account({ end_user_origin_id: "foreign" })] }, { results: [account({ category: "hris" })] },
    { results: [account(), account()] }, { results: [account({ status: "UNKNOWN" })] },
    { results: [account()], next: "https://foreign.invalid/steal" }, { results: Array(101).fill(account()) }, { results: null },
  ]) await assert.rejects(harness([response]).service.list(actor));
  const h = harness([{ results: [], next: "repeat" }, { results: [], next: "repeat" }]);
  await assert.rejects(h.service.list(actor)); assert.equal(h.calls.length, 2);
  const many = harness(Array.from({ length: 10 }, (_, i) => ({ results: [], next: `cursor${i}` })));
  await assert.rejects(many.service.list(actor)); assert.equal(many.calls.length, 10);
});
test("unknown or refused setup never retries and never exposes provider secrets", async () => {
  for (const response of [new Error("private-token"), new Response("private-token", { status: 429 }), new Response("private-token", { status: 500 }), new Response("not-json"), Response.json({ long: "x".repeat(512_001) })]) {
    const h = harness([response]);
    await assert.rejects(h.service.connect(actor, { email: "admin@example.invalid", organization: "Protocol" }), e => e instanceof Error && !e.message.includes("private-token"));
    assert.equal(h.calls.length, 1);
  }
});
test("setup rejects untrusted URLs, invalid actor/contact data and non-enumerated regions", async () => {
  for (const magic_link_url of ["http://link.merge.dev/a", "https://link.merge.dev.evil.invalid/a", "https://user.invalid@link.merge.dev/a", "https://link.merge.dev/a#token", "not-url"]) {
    await assert.rejects(harness([{ magic_link_url }]).service.connect(actor, { email: "admin@example.invalid", organization: "Protocol" }));
  }
  const h = harness([]);
  await assert.rejects(h.service.connect({ id: "foreign-input" }, { email: "admin@example.invalid", organization: "Protocol" }));
  await assert.rejects(h.service.connect(actor, { email: "invalid", organization: "Protocol" }));
  await assert.rejects(h.service.connect(actor, { email: "admin@example.invalid", organization: "" }));
  assert.equal(h.calls.length, 0);
  assert.throws(() => createMergeConnections({ apiKey: "test", region: "https://foreign.invalid" }));
  assert.throws(() => createMergeConnections({ apiKey: "", region: "us" }));
});
test("unfinished setup without a chosen integration is visible as incomplete, never connected", async () => {
  const h = harness([{ results: [account({ status: "INCOMPLETE", integration: null })], next: null }]);
  assert.deepEqual((await h.service.list(actor))[0], { id: account().id, organization: "Protocol test organization", integration: "ATS setup", state: "incomplete" });
  await assert.rejects(harness([{ results: [account({ integration: null })] }]).service.list(actor));
});
