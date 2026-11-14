/** Local-brain spec (context/specs/38-local-brain.md, PR #201), build step 1: an excluded hit
 * carries its reason and never its body, on every private surface. Synthetic fixture only: the
 * body stands in for another contributor's work. "Quillwort" appears only in the title and
 * "Bodymarker" only in the body, which is never matched. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { privateBrainSigningInput } from "./privateBrainSession.ts";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const reason = "Synthetic reason: this work belongs to a different author.";
// Every sentence carries the marker, so any excerpt of the body would show it.
const body = "Bodymarker synthetic stand-in paragraph written by someone else. ".repeat(10).slice(0, 500);
const expected = { id: "leaflet:outside", kind: "excluded leaflet", title: "Quillwort migration notes",
  snippet: reason, citation: "leaf:leaflet%2Foutside", reason };

async function garden(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-excluded-search-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(body.length, 500);
  assert.doesNotMatch(body, /quillwort/i);
  const provenance = { source: "git", ref: "synthetic-ref", observedAt: "2026-10-10T00:00:00Z" };
  await writeFile(join(dir, "leaf.json"), JSON.stringify({ id: "synthetic-excluded", subject: "Synthetic subject",
    leaflets: [{ id: "outside", title: expected.title, tier: "excluded", reason, body: [{ text: body, provenance }] }] }));
  return { dir, leafBytes: await readFile(join(dir, "leaf.json"), "utf8") };
}

function assertReasonOnly(output: string, hit: Record<string, unknown> | undefined) {
  assert.ok(hit, output);
  assert.equal(hit["snippet"], reason);
  assert.equal(hit["reason"], reason);
  assert.doesNotMatch(output, /bodymarker/i, "no excerpt of the excluded body is returned");
}

test("foliage search returns an excluded title-only match with its reason and no body text", { timeout: 15_000 }, async t => {
  const g = await garden(t);
  const { stdout } = await execute(process.execPath, [launcher, "search", "Quillwort", "--garden", g.dir], { timeout: 10_000 });
  const found = JSON.parse(stdout) as { hits: Record<string, unknown>[] };
  assert.equal(found.hits.length, 1);
  const { evidence, ...hit } = found.hits[0]!;
  assert.deepEqual(hit, expected);
  // Build order item 6: foliage search reads `brainRecords`, where an excluded leaflet keeps its
  // title and reason only, so the references to its body's evidence are gone too.
  assert.equal(evidence, undefined);
  assertReasonOnly(stdout, found.hits[0]);
  assert.ok(!stdout.includes(g.dir));
  const probe = await execute(process.execPath, [launcher, "search", "Bodymarker", "--garden", g.dir], { timeout: 10_000 });
  assert.deepEqual((JSON.parse(probe.stdout) as { hits: unknown[] }).hits, [], "a word only in the excluded body finds nothing");
  assert.equal(await readFile(join(g.dir, "leaf.json"), "utf8"), g.leafBytes);
});

test("foliage_search returns an excluded title-only match with its reason and no body text", { timeout: 30_000 }, async t => {
  const g = await garden(t);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [launcher, "mcp", "--garden", g.dir, "--allow-search"], cwd: tmpdir(), stderr: "pipe" });
  const client = new Client({ name: "foliage-excluded-search", version: "1.0.0" });
  client.onerror = () => {};
  await client.connect(transport);
  try {
    const found = await client.callTool({ name: "foliage_search", arguments: { query: "Quillwort" } });
    assert.ok(!found.isError, JSON.stringify(found));
    const output = JSON.stringify(found);
    const hits = (found.structuredContent as { hits: Record<string, unknown>[] }).hits;
    assert.equal(hits.length, 1);
    assertReasonOnly(output, hits[0]);
    assert.equal(hits[0]?.["id"], expected.id);
    assert.ok(!output.includes(g.dir));
  } finally { await client.close(); }
  assert.equal(await readFile(join(g.dir, "leaf.json"), "utf8"), g.leafBytes);
});

test("the private-brain session returns a granted excluded leaflet's reason and no body text", { timeout: 15_000 }, async t => {
  const g = await garden(t);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyFile = join(g.dir, "agent-public.pem");
  await writeFile(keyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const child = spawn(process.execPath, [launcher, "private-brain", "serve", "--garden", g.dir,
    "--agent-key", keyFile, "--agent-label", "excluded-search-test", "--record", expected.id, "--minutes", "1"],
  { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let printed = "";
  const output = await new Promise<string>((resolve, reject) => {
    child.stderr.setEncoding("utf8").on("data", chunk => {
      printed += chunk;
      if (printed.includes("Type revoke and Enter")) resolve(printed);
    });
    child.once("exit", code => reject(new Error(`Session exited before ready: ${code}; ${printed}`)));
  });
  const session = output.match(/Private brain session ([a-f0-9]{32})/)?.[1];
  const url = output.match(/Loopback (http:\/\/127\.0\.0\.1:\d+\/private-brain\/search)/)?.[1];
  assert.ok(session && url);
  const ask = async (query: string) => {
    const timestamp = String(Date.now()), nonce = randomBytes(18).toString("base64url");
    const request = JSON.stringify({ query });
    const signature = sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(request)), privateKey).toString("base64url");
    const response = await fetch(url, { method: "POST", body: request, headers: { "content-type": "application/json",
      "x-foliage-session": session, "x-foliage-timestamp": timestamp, "x-foliage-nonce": nonce, "x-foliage-signature": signature } });
    assert.equal(response.status, 200);
    return response.text();
  };
  const answer = await ask("Quillwort");
  const hits = (JSON.parse(answer) as { hits: Record<string, unknown>[] }).hits;
  assert.deepEqual(hits, [expected]);
  assertReasonOnly(answer, hits[0]);
  assert.doesNotMatch(answer, /score|rating|evidence/);
  // A granted agent cannot test which words the excluded body holds.
  assert.deepEqual((JSON.parse(await ask("Bodymarker")) as { hits: unknown[] }).hits, []);
  child.stdin.write("revoke\n");
  assert.equal(await exited, 0);
  assert.equal(await readFile(join(g.dir, "leaf.json"), "utf8"), g.leafBytes);
});
