/** Protocol harness: generated signing key and mocked provider responses, not live identity evidence. */
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { deviceChallenge } from "./deviceConnection.ts";
import { createClerkIdentity } from "./clerkIdentity.ts";
const origin = "https://canopy-auth-harness.example", issuer = "https://clerk-auth-harness.example";
const actorId = "a1a1a1a1-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "clerk-auth-harness-key", alg: "RS256", use: "sig" };
const config = { appOrigin: origin, publishableKey: `pk_test_${Buffer.from(new URL(issuer).host + "$").toString("base64")}`, secretKey: "sk_test_protocol_harness", supabaseUrl: "https://storage-harness.example", serviceRoleKey: "protocol-harness-only" };
function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [ { alg: "RS256", typ: "JWT", kid: jwk.kid }, { iss: issuer, sub: "user_Harness", sid: "sess_Harness", azp: origin, iat: now, nbf: now - 1, exp: now + 60, ...overrides } ].map(value => Buffer.from(JSON.stringify(value)).toString("base64url"));
  const data = parts.join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
test("Clerk signature, issuer, origin, session and current user precede actor resolution", async t => {
  const previous = process.env["NODE_ENV"]; process.env["NODE_ENV"] = "test";
  t.after(() => { if (previous === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previous; });
  let status = "active", banned = false, locked = false, userId = "user_Harness", emailStatus = "verified", actorCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.pathname === "/v1/sessions/sess_Harness") return Response.json({ object: "session", id: "sess_Harness", user_id: userId, status, expire_at: Date.now() + 60000, actor: null });
    if (url.pathname === "/v1/users/user_Harness") return Response.json({ object: "user", id: "user_Harness", banned, locked, primary_email_address_id: "id_email", email_addresses: [{ id: "id_email", linked_to: [], email_address: "harness@example.test", verification: { status: emailStatus } }] });
    if (url.pathname === "/rest/v1/rpc/foliage_resolve_actor") { actorCalls++; return Response.json(actorId); }
    throw new Error(`Unexpected protocol harness path ${url.pathname}`);
  });
  const identity = createClerkIdentity(config);
  assert.deepEqual(await identity.getUser(token()), { id: actorId });
  assert.equal(await identity.getVerifiedEmail(token(), { id: actorId }), "harness@example.test");
  const verifier = "a".repeat(43);
  const grant = await identity.createDeviceGrant(token(), deviceChallenge(verifier));
  const deviceToken = `${grant}.${verifier}`;
  assert.deepEqual(await identity.getUser(deviceToken), { id: actorId });
  assert.equal((await identity.deviceSession(deviceToken)).refreshToken, "clerk-device");
  await assert.rejects(identity.createDeviceGrant(deviceToken, deviceChallenge(verifier)), { code: "unauthenticated" });
  status = "revoked";
  await assert.rejects(identity.getUser(deviceToken), { code: "unauthenticated" });
  status = "active";
  const before = actorCalls;
  for (const overrides of [{ iss: "https://other-issuer.example" }, { azp: "https://other.example" }, { azp: undefined }, { exp: 1 }, { nbf: Math.floor(Date.now() / 1000) + 600 }, { sid: "m2m_harness" }, { act: { sub: "user_Admin" } }, { sts: "pending" }]) await assert.rejects(identity.getUser(token(overrides)), { code: "unauthenticated" });
  await assert.rejects(identity.getUser(token().replace(/.$/, "!")), { code: "unauthenticated" });
  for (const state of ["revoked", "expired", "pending"]) { status = state; await assert.rejects(identity.getUser(token()), { code: "unauthenticated" }); }
  status = "active"; banned = true; await assert.rejects(identity.getUser(token()), { code: "unauthenticated" });
  banned = false; locked = true; await assert.rejects(identity.getUser(token()), { code: "unauthenticated" });
  locked = false; userId = "user_Other"; await assert.rejects(identity.getUser(token()), { code: "unauthenticated" });
  assert.equal(actorCalls, before);
  userId = "user_Harness"; emailStatus = "unverified";
  await assert.rejects(identity.getVerifiedEmail(token(), { id: actorId }), { code: "unauthenticated" });
  await assert.rejects(identity.signIn("unused@example.test", "unused"), { code: "invalid-request" });
});
