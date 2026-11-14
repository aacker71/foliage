import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPrivateBrainSession, privateBrainSigningInput, type PrivateBrainRefusal } from "./privateBrainSession.ts";

const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

function childEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const name of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR"]) delete env[name];
  return env;
}

function signedHeaders(session: string, key: KeyObject, body: string, nonce = randomBytes(18).toString("base64url"), timestamp = String(Date.now())) {
  return { "content-type": "application/json", "x-foliage-session": session, "x-foliage-timestamp": timestamp, "x-foliage-nonce": nonce,
    "x-foliage-signature": sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(body)), key).toString("base64url") };
}

test("foliage --help lists the private-brain command", async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-help-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  const shown = spawnSync(process.execPath, [launcher, "--help", "--garden", garden], { encoding: "utf8", env: childEnv() });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /^ {2}private-brain {2}\S.* {2}list\|receipts\|serve --garden <path>$/m);
});

test("a session reports each refusal by reason, with the agent fingerprint only once the signature verified", async () => {
  const key = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
  const refusals: PrivateBrainRefusal[] = [];
  const clock = Date.parse("2026-10-03T00:00:00.000Z");
  // Protocol fixture only: one marker record, no person or career content.
  const record = { id: "profile:headline", kind: "owner profile", title: "Headline", text: "refusal-record-marker", citation: "leaf:profile/headline" };
  const session = await createPrivateBrainSession({ publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    agentLabel: "refusal unit", recordIds: [record.id], ttlMs: 60_000, now: () => clock,
    read: async () => ({ subject: { leafId: "fixture-leaf", name: "fixture" }, records: [record] }),
    receipt: async () => {}, refused: value => { refusals.push(value); } });
  const ask = (privateKey: KeyObject, body: string, nonce?: string) => session.handle(new Request("http://127.0.0.1/private-brain/search",
    { method: "POST", body, headers: signedHeaders(session.identity.session, privateKey, body, nonce, String(clock)) }));
  const body = JSON.stringify({ query: "unit-query-marker" });
  assert.equal((await ask(other.privateKey, body)).status, 401);
  const nonce = randomBytes(18).toString("base64url");
  assert.equal((await ask(key.privateKey, body, nonce)).status, 200);
  assert.equal((await ask(key.privateKey, body, nonce)).status, 409);
  assert.equal((await ask(key.privateKey, "unit-bad-body-marker")).status, 400);
  assert.deepEqual(refusals, [
    { at: "2026-10-03T00:00:00.000Z", status: 401, reason: "agent-refused" },
    { at: "2026-10-03T00:00:00.000Z", status: 409, reason: "replay-refused", agent: session.identity.agent },
    { at: "2026-10-03T00:00:00.000Z", status: 400, reason: "invalid-query", agent: session.identity.agent },
  ]);
  assert.doesNotMatch(JSON.stringify(refusals), /marker|PUBLIC KEY/);

  const failing = await createPrivateBrainSession({ publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    agentLabel: "refusal unit", recordIds: [record.id], ttlMs: 60_000,
    read: async () => ({ subject: { leafId: "fixture-leaf", name: "fixture" }, records: [record] }),
    receipt: async () => {}, refused: () => { throw new Error("terminal unavailable"); } });
  const refused = await failing.handle(new Request("http://127.0.0.1/private-brain/search", { method: "POST", body,
    headers: signedHeaders(failing.identity.session, other.privateKey, body) }));
  assert.equal(refused.status, 401);
  assert.deepEqual(await refused.json(), { code: "agent-refused" });
});

test("each refused attempt prints one terminal line with no query or key, and the transfer receipts stay transfers", { timeout: 20_000 }, async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-private-refusals-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  // Protocol fixture only: no generated career outcome, score, or public content.
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "refusal-fixture", subject: "Refusal fixture", headline: "refusal-headline-marker", leaflets: [] }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyFile = join(garden, "agent-public.pem");
  await writeFile(keyFile, publicPem, { mode: 0o600 });

  const child = spawn(process.execPath, [launcher, "private-brain", "serve", "--garden", garden,
    "--agent-key", keyFile, "--agent-label", "refusal-test", "--record", "profile:headline", "--minutes", "1"],
  { stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  const closed = new Promise<number | null>(resolve => child.once("close", resolve));
  let stderr = "";
  const ready = new Promise<void>((resolve, reject) => {
    child.stderr.setEncoding("utf8").on("data", chunk => {
      stderr += chunk;
      if (stderr.includes("Type revoke and Enter")) resolve();
    });
    child.once("exit", code => reject(new Error(`Session exited before ready: ${code}; ${stderr}`)));
  });
  await ready;
  const session = stderr.match(/Private brain session ([a-f0-9]{32})/)?.[1];
  const fingerprint = stderr.match(/Agent key ([a-f0-9]{64}) /)?.[1];
  const url = stderr.match(/Loopback (http:\/\/127\.0\.0\.1:\d+\/private-brain\/search)/)?.[1];
  assert.ok(session && fingerprint && url);
  const startupLength = stderr.length;

  const body = JSON.stringify({ query: "refusal-query-marker" });
  const first = signedHeaders(session, privateKey, body);
  assert.equal((await fetch(url, { method: "POST", body, headers: first })).status, 200);
  assert.equal((await fetch(url, { method: "POST", body, headers: signedHeaders(session, other.privateKey, body) })).status, 401);
  assert.equal((await fetch(url, { method: "POST", body, headers: first })).status, 409);
  const badBody = "{refusal-bad-body-marker";
  assert.equal((await fetch(url, { method: "POST", body: badBody, headers: signedHeaders(session, privateKey, badBody) })).status, 400);
  const duplicate = await new Promise<number | undefined>((resolve, reject) => {
    const headers = signedHeaders(session, privateKey, body);
    const call = request(url, { method: "POST", headers: { ...headers, "x-foliage-nonce": [headers["x-foliage-nonce"], "refusal-second-nonce-0000"] } },
      answer => { answer.resume(); answer.once("end", () => resolve(answer.statusCode)); });
    call.once("error", reject);
    call.end(body);
  });
  assert.equal(duplicate, 400);
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "refusal-fixture", subject: "Refusal fixture", headline: "refusal-changed-marker", leaflets: [] }));
  assert.equal((await fetch(url, { method: "POST", body, headers: signedHeaders(session, privateKey, body) })).status, 409);

  child.stdin.write("revoke\n");
  assert.equal(await closed, 0);
  const lines = stderr.slice(startupLength).split("\n").filter(line => line.startsWith("Refused "));
  const shape = /^Refused \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (\d{3}) ([a-z-]+); agent key (\S+(?: \S+)*)$/;
  assert.deepEqual(lines.map(line => line.match(shape)?.slice(1)), [
    ["401", "agent-refused", "not verified"],
    ["409", "replay-refused", fingerprint],
    ["400", "invalid-query", fingerprint],
    ["400", "invalid-request", "not verified"],
    ["409", "scope-changed", fingerprint],
  ]);
  const pemBody = publicPem.split("\n").filter(line => line && !line.startsWith("-----")).join("");
  assert.doesNotMatch(stderr, /query-marker|bad-body-marker|second-nonce|PUBLIC KEY/);
  assert.ok(!stderr.includes(pemBody));
  const receipts = (await readFile(join(garden, "private-brain-receipts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(receipts.length, 1);
  assert.deepEqual(JSON.parse(receipts[0] ?? "{}").hits, ["profile:headline"]);
  assert.doesNotMatch(receipts.join("\n"), /marker/);
});
