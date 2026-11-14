/** Synthetic cryptographic protocol inputs; no user account or portfolio is created. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceChallenge, deviceReturn, deviceSigner, localDeviceConnection } from "./deviceConnection.ts";
const origin = "https://device-protocol.example";
test("device grants require the local verifier, correct service key and unexpired session binding", () => {
  const signer = deviceSigner("synthetic-secret", origin), verifier = "x".repeat(43);
  const grant = signer.issue({ sub: "user_Protocol", sid: "sess_Protocol", challenge: deviceChallenge(verifier), expiresAt: Date.now() + 60_000 });
  assert.equal(signer.verify(`${grant}.${verifier}`).sid, "sess_Protocol");
  for (const value of [grant, `${grant}.${"y".repeat(43)}`, `${grant}.${verifier}.extra`, `${grant.replace("fd1", "fd2")}.${verifier}`]) assert.throws(() => signer.verify(value));
  assert.throws(() => deviceSigner("other-secret", origin).verify(`${grant}.${verifier}`));
  assert.throws(() => deviceSigner("synthetic-secret", "https://other.example").verify(`${grant}.${verifier}`));
  const expired = signer.issue({ sub: "user_Protocol", sid: "sess_Protocol", challenge: deviceChallenge(verifier), expiresAt: Date.now() - 1 });
  assert.throws(() => signer.verify(`${expired}.${verifier}`));
});
test("loopback return is exact and a local pairing can complete only once", () => {
  for (const bad of ["https://127.0.0.1:4180/hosted/callback", "http://localhost:4180/hosted/callback", "http://127.0.0.1.evil.example:4180/hosted/callback", "http://127.0.0.1:4180/other", "http://127.0.0.1:4180/hosted/callback?x=1"]) assert.throws(() => deviceReturn(bad));
  const credentialed = new URL("http://127.0.0.1:4180/hosted/callback"); credentialed.username = "synthetic"; credentialed.password = "unused";
  assert.throws(() => deviceReturn(credentialed.href));
  const local = localDeviceConnection(origin, "http://127.0.0.1:4180/hosted/callback");
  const url = new URL(local.start()), state = url.searchParams.get("state")!;
  const signer = deviceSigner("synthetic-secret", origin);
  const grant = signer.issue({ sub: "user_Protocol", sid: "sess_Protocol", challenge: url.searchParams.get("challenge")!, expiresAt: Date.now() + 60000 });
  assert.throws(() => local.finish("wrong-state", grant));
  const token = local.finish(state, grant);
  assert.equal(signer.verify(token).sub, "user_Protocol");
  assert.throws(() => local.finish(state, grant));
});
