import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";
import type { SearchRecord } from "@foliage/photosynthesis/search";
import { createPrivateBrainSession, privateBrainSigningInput, type PrivateBrainReceipt, type PrivateBrainSnapshot } from "./privateBrainSession.ts";

const granted: SearchRecord = { id: "profile:direction", kind: "owner profile", title: "Direction", text: "granted-marker", citation: "leaf:profile/direction",
  evidence: [{ source: "file", ref: "local-only-evidence", observedAt: "2026-09-30T00:00:00.000Z" }] };
const ungranted: SearchRecord = { id: "profile:bio", kind: "owner profile", title: "About", text: "ungranted-marker", citation: "leaf:profile/bio" };
const snapshot = (): PrivateBrainSnapshot => ({ subject: { leafId: "bound-leaf", name: "bound-owner" }, records: [granted, ungranted] });

function fixture() {
  const key = generateKeyPairSync("ed25519");
  const otherKey = generateKeyPairSync("ed25519");
  let clock = Date.now();
  let current = snapshot();
  let read = async () => current;
  let receipt = async (value: PrivateBrainReceipt) => { receipts.push(value); };
  const receipts: PrivateBrainReceipt[] = [];
  const start = () => createPrivateBrainSession({
    publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    agentLabel: "integration test agent", recordIds: [granted.id], read: () => read(), receipt: value => receipt(value),
    ttlMs: 60_000, now: () => clock,
  });
  return { key, otherKey, start, receipts, get clock() { return clock; }, set clock(value: number) { clock = value; },
    set current(value: PrivateBrainSnapshot) { current = value; }, set read(value: () => Promise<PrivateBrainSnapshot>) { read = value; },
    set receipt(value: (value: PrivateBrainReceipt) => Promise<void>) { receipt = value; } };
}

function signedRequest(session: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], now: number,
  query: string, extra: { nonce?: string; timestamp?: string; body?: string; path?: string; origin?: string } = {}) {
  const body = extra.body ?? JSON.stringify({ query });
  const timestamp = extra.timestamp ?? String(now);
  const nonce = extra.nonce ?? randomBytes(18).toString("base64url");
  const signature = sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(body)), privateKey).toString("base64url");
  return new Request(`http://127.0.0.1${extra.path ?? "/private-brain/search"}`, { method: "POST", body,
    headers: { "content-type": "application/json", "x-foliage-session": session,
      "x-foliage-timestamp": timestamp, "x-foliage-nonce": nonce, "x-foliage-signature": signature,
      ...(extra.origin ? { origin: extra.origin } : {}) } });
}

test("exact grant scope is applied before ranking, and each released answer has a minimal receipt", async () => {
  const f = fixture();
  const session = await f.start();
  const deniedText = await session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "ungranted-marker"));
  assert.equal(deniedText.status, 200);
  const deniedHits = (await deniedText.json() as { hits: { id: string }[] }).hits;
  assert.ok(deniedHits.every(hit => hit.id === granted.id));
  const answer = await session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "granted-marker"));
  assert.equal(answer.status, 200);
  const output = await answer.text();
  assert.match(output, /granted-marker/);
  assert.doesNotMatch(output, /ungranted-marker|local-only-evidence|score|rating/);
  assert.ok(f.receipts.every(receipt => receipt.hits.every(id => id === granted.id)));
  assert.deepEqual(f.receipts[1]?.scope, [granted.id]);
  assert.equal(f.receipts[1]?.agent, session.identity.agent);
  assert.ok(f.receipts.every(receipt => !JSON.stringify(receipt).includes("granted-marker")));
});

test("agent key, timestamp, nonce, origin, path and request size are enforced", async () => {
  const f = fixture();
  const session = await f.start();
  const identity = session.identity.session;
  assert.equal((await session.handle(signedRequest(identity, f.otherKey.privateKey, f.clock, "granted-marker"))).status, 401);
  assert.equal((await session.handle(signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { timestamp: String(f.clock - 60_001) }))).status, 401);
  assert.equal((await session.handle(signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await session.handle(signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { path: "/private-brain/search?scope=all" }))).status, 404);
  assert.equal((await session.handle(signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { body: JSON.stringify({ query: "x".repeat(4100) }) }))).status, 413);
  const nonce = randomBytes(18).toString("base64url");
  const first = signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { nonce });
  assert.equal((await session.handle(first)).status, 200);
  assert.equal((await session.handle(signedRequest(identity, f.key.privateKey, f.clock, "granted-marker", { nonce }))).status, 409);
  assert.equal(f.receipts.length, 1);
});

test("record change, missing record and changed subject invalidate the exact session", async () => {
  const f = fixture();
  const session = await f.start();
  const ask = () => session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "granted-marker"));
  f.current = { ...snapshot(), records: [{ ...granted, text: "changed" }, ungranted] };
  assert.equal((await ask()).status, 409);
  f.current = { ...snapshot(), records: [ungranted] };
  assert.equal((await ask()).status, 409);
  f.current = { ...snapshot(), subject: { leafId: "different", name: "bound-owner" } };
  assert.equal((await ask()).status, 409);
  assert.deepEqual(f.receipts, []);
});

test("revocation during a read and expiry release no private result", async () => {
  const f = fixture();
  const session = await f.start();
  let finishRead: ((value: PrivateBrainSnapshot) => void) | undefined;
  let signalRead: (() => void) | undefined;
  const readStarted = new Promise<void>(resolve => { signalRead = resolve; });
  f.read = () => new Promise(resolve => { finishRead = resolve; signalRead?.(); });
  const pending = session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "granted-marker"));
  await readStarted;
  session.revoke();
  finishRead?.(snapshot());
  assert.equal((await pending).status, 403);
  assert.deepEqual(f.receipts, []);

  const later = fixture();
  const expiring = await later.start();
  later.clock += 60_000;
  assert.equal((await expiring.handle(signedRequest(expiring.identity.session, later.key.privateKey, later.clock, "granted-marker"))).status, 403);
});

test("read and receipt failure deny the response", async () => {
  const f = fixture();
  const session = await f.start();
  f.read = async () => { throw new Error("private path"); };
  let denied = await session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "granted-marker"));
  assert.equal(denied.status, 503);
  assert.doesNotMatch(await denied.text(), /private path/);
  f.read = async () => snapshot();
  f.receipt = async () => { throw new Error("disk full"); };
  denied = await session.handle(signedRequest(session.identity.session, f.key.privateKey, f.clock, "granted-marker"));
  assert.equal(denied.status, 503);
  assert.doesNotMatch(await denied.text(), /granted-marker|disk full/);
});
