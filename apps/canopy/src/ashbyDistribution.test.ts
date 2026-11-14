/** Wire-protocol substitutes only: no provider account or real delivery is claimed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAshbyDistribution } from "./ashbyDistribution.ts";
const actor = { id: "10000000-0000-4000-8000-000000000001" };
const target = { connectionId: "protocol-connection", candidateId: "20000000-0000-4000-8000-000000000001" };
const reference = "30000000-0000-4000-8000-000000000001";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function harness(options: { foreign?: boolean; mode?: string } = {}) {
  const calls: { path: string; body: any; headers: Headers }[] = [];
  const adapter = createAshbyDistribution({ secretKey: "protocol-only-key", integrationId: "ashby-protocol", connectOrigin: "https://connect.example", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname, body = init?.body ? JSON.parse(String(init.body)) : null, headers = new Headers(init?.headers);
    calls.push({ path, body, headers }); assert.equal(init?.redirect, "error");
    if (path === "/connections") {
      assert.equal(new URL(String(input)).searchParams.get("tags[end_user_id]"), actor.id);
      return json({ connections: [{ connection_id: target.connectionId, provider_config_key: "ashby-protocol", tags: { end_user_id: options.foreign ? "foreign" : actor.id }, errors: [] }] });
    }
    if (path === "/proxy/candidate.search") { assert.deepEqual(body, { name: "Protocol search", limit: 25 }); return json({ success: true, results: [{ id: target.candidateId, name: "Candidate protocol input", primaryEmailAddress: { value: "private@example.invalid" } }], moreDataAvailable: false }); }
    if (path.startsWith("/connections/")) return json({ connection_id: target.connectionId, provider_config_key: "ashby-protocol", tags: { end_user_id: options.foreign ? "foreign" : actor.id }, errors: [] });
    if (path === "/proxy/candidate.info") return json({ success: true, results: { id: target.candidateId, name: "Candidate protocol input", privateField: "not retained" } });
    if (path === "/proxy/candidate.createNote") {
      if (options.mode === "timeout") throw new Error("sensitive transport detail");
      if (options.mode === "rate") return json({ success: false }, 429);
      if (options.mode === "malformed") return new Response("not json");
      return json({ success: true, results: { id: reference } });
    }
    if (path === "/proxy/candidate.listNotes") return json({ success: true, results: [{ id: reference, content: "Protocol note\nFoliage delivery: protocol-marker\n" }], moreDataAvailable: false });
    throw new Error(`Unexpected wire request ${path}`);
  } });
  return { adapter, calls };
}
test("Ashby uses fixed Nango proxy, exact candidate, plain text and disabled notifications/retries", async () => {
  const h = harness();
  assert.deepEqual(await h.adapter.candidate(actor, target), { id: target.candidateId, name: "Candidate protocol input" });
  assert.deepEqual(await h.adapter.deliver(actor, target, "Reviewed protocol note"), { status: "accepted", reference });
  const write = h.calls.find(c => c.path.endsWith("createNote"))!;
  assert.equal(write.headers.get("retries"), "0"); assert.equal(write.headers.get("base-url-override"), "https://api.ashbyhq.com");
  assert.deepEqual(write.body, { candidateId: target.candidateId, note: { type: "text/plain", value: "Reviewed protocol note" }, sendNotifications: false, isPrivate: false });
  assert.equal(h.adapter.capabilities.retract, false);
  assert.equal(await h.adapter.reconcile(actor, target, "Foliage delivery: protocol-marker"), reference);
});
test("foreign connection cannot read candidate or send; failures never leak raw provider detail", async () => {
  const foreign = harness({ foreign: true });
  await assert.rejects(foreign.adapter.deliver(actor, target, "Protocol"), /another account/);
  assert.equal(foreign.calls.length, 1);
  for (const mode of ["timeout", "malformed", "rate"]) {
    const h = harness({ mode });
    const result = await h.adapter.deliver(actor, target, "Protocol");
    assert.equal(result.status, mode === "rate" ? "rejected" : "unknown");
    assert.doesNotMatch(JSON.stringify(result), /sensitive transport/);
    assert.equal(h.calls.filter(c => c.path.endsWith("createNote")).length, 1);
  }
});

test("connection picker and candidate search project bounded owned identities without auto-selecting or writing", async () => {
  const h = harness();
  assert.deepEqual(await h.adapter.connections(actor), [{ id: target.connectionId, available: true }]);
  assert.deepEqual(await h.adapter.search(actor, target.connectionId, "Protocol search"), { candidates: [{ id: target.candidateId, name: "Candidate protocol input" }], more: false });
  assert.equal(h.calls.filter(c => c.path.endsWith("createNote")).length, 0);
  await assert.rejects(harness({ foreign: true }).adapter.connections(actor), /match this account/);
});
