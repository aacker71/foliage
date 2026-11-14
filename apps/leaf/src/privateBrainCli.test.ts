import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { privateBrainSigningInput } from "./privateBrainSession.ts";

const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

async function run(args: string[]) {
  const child = spawn(process.execPath, [launcher, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", part => { stdout += part; });
  child.stderr.setEncoding("utf8").on("data", part => { stderr += part; });
  const code = await new Promise<number | null>(resolve => child.once("exit", resolve));
  return { code, stdout, stderr };
}

test("owner CLI starts only on request, signs one selected record, saves receipt, and revokes", { timeout: 15_000 }, async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-private-brain-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  // Protocol fixture only: no generated career outcome, score, or public content.
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "protocol-fixture", subject: "Protocol fixture", headline: "local-protocol-marker", leaflets: [] }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyFile = join(garden, "agent-public.pem");
  await writeFile(keyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });

  const listed = await run(["private-brain", "list", "--garden", garden]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).records.map((record: { id: string }) => record.id), ["profile:headline"]);
  const before = await run(["private-brain", "receipts", "--garden", garden]);
  assert.equal(before.code, 0);
  assert.match(before.stdout, /No private search transfers recorded/);

  const child = spawn(process.execPath, [launcher, "private-brain", "serve", "--garden", garden,
    "--agent-key", keyFile, "--agent-label", "protocol-test", "--record", "profile:headline", "--minutes", "1"],
  { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
  t.after(() => { if (!child.killed) child.kill("SIGTERM"); });
  let readyOutput = "";
  const ready = new Promise<string>((resolve, reject) => {
    child.stderr.setEncoding("utf8").on("data", chunk => {
      readyOutput += chunk;
      if (readyOutput.includes("Type revoke and Enter")) resolve(readyOutput);
    });
    child.once("exit", code => reject(new Error(`Session exited before ready: ${code}; ${readyOutput}`)));
  });
  const output = await ready;
  const session = output.match(/Private brain session ([a-f0-9]{32})/)?.[1];
  const url = output.match(/Loopback (http:\/\/127\.0\.0\.1:\d+\/private-brain\/search)/)?.[1];
  assert.ok(session && url);
  const timestamp = String(Date.now());
  const nonce = randomBytes(18).toString("base64url");
  const body = JSON.stringify({ query: "local-protocol-marker" });
  const signature = sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(body)), privateKey).toString("base64url");
  const response = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json",
    "x-foliage-session": session, "x-foliage-timestamp": timestamp,
    "x-foliage-nonce": nonce, "x-foliage-signature": signature } });
  assert.equal(response.status, 200);
  const answer = await response.text();
  assert.match(answer, /local-protocol-marker/);
  assert.doesNotMatch(answer, /score|rating|evidence/);
  const receiptText = await readFile(join(garden, "private-brain-receipts.jsonl"), "utf8");
  const receipt = JSON.parse(receiptText);
  assert.deepEqual(receipt.hits, ["profile:headline"]);
  assert.equal(receipt.agentLabel, "protocol-test");
  assert.doesNotMatch(receiptText, /local-protocol-marker/);
  const displayed = await run(["private-brain", "receipts", "--garden", garden]);
  assert.equal(displayed.code, 0, displayed.stderr);
  assert.equal(displayed.stdout, receiptText);

  child.stdin.write("revoke\n");
  assert.equal(await exited, 0);
  await assert.rejects(fetch(url, { method: "POST", body }), TypeError);
  await writeFile(join(garden, "leaf.json"), "{corrupt");
  const durableReceipt = await run(["private-brain", "receipts", "--garden", garden]);
  assert.equal(durableReceipt.code, 0, durableReceipt.stderr);
  assert.equal(durableReceipt.stdout, receiptText);
});
