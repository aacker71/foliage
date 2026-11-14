/**
 * A NO-OP `foliage grow` LEAVES THE LEAF ALONE (QA 2026-10-02 #11).
 *
 * Measured before the fix: re-running the same grow with no new commits printed
 * "N updated in place, changing: provenance.observedAt" and rewrote every intake leaflet's
 * observedAt to the run's instant. The export then dated all work to the latest scheduled run,
 * and a private-brain session granting an intake leaflet answered 409 scope-changed after every
 * grow, with no human edit.
 *
 * Real commits in a temporary repository, the real `foliage grow`, a temporary HOME and garden.
 * No fabricated person, outcome or score: the fixture is protocol data only.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { privateBrainSigningInput } from "./privateBrainSession.ts";

const exec = promisify(execFile);
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const IDENTITY = "regrow-protocol@example.invalid";
const SUBJECT = "Regrow protocol";

const made: string[] = [];
after(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-regrow-observed-at-"));
  made.push(dir);
  return dir;
}

function cleanEnv(home: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, NO_COLOR: "1" };
  // The ambient shell must never decide where these runs read or write.
  delete env["FOLIAGE_GARDEN"];
  delete env["FOLIAGE_LEAF"];
  delete env["FOLIAGE_HARVEST"];
  return env;
}

async function commit(repo: string, file: string, message: string): Promise<string> {
  await writeFile(join(repo, file), `Temporary artifact for the regrow protocol: ${file}\n`);
  await exec("git", ["-C", repo, "add", file]);
  await exec("git", ["-C", repo, "-c", "user.name=Regrow protocol", "-c", `user.email=${IDENTITY}`,
    "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", message]);
  return (await exec("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
}

async function fixture() {
  const repo = await tempDir();
  const home = await tempDir();
  const garden = join(await tempDir(), "garden");
  await exec("git", ["init", "--initial-branch=main", repo]);
  const shas = [
    await commit(repo, "one.txt", "feat: regrow protocol artifact one"),
    await commit(repo, "two.txt", "docs: regrow protocol artifact two"),
  ];
  return { repo, home, garden, shas };
}

async function grow(f: { repo: string; home: string; garden: string }): Promise<string> {
  const { stdout, stderr } = await exec(process.execPath, [FOLIAGE_CLI, "grow", "--repo", f.repo,
    "--subject", SUBJECT, "--identity", IDENTITY, "--garden", f.garden],
  { encoding: "utf8", timeout: 60_000, env: cleanEnv(f.home) });
  return stdout + stderr;
}

type Row = { id: string; provenance?: { observedAt: string } };
async function observedAtById(garden: string): Promise<Map<string, string | undefined>> {
  const leaf = JSON.parse(await readFile(join(garden, "leaf.json"), "utf8")) as { leaflets: Row[] };
  return new Map(leaf.leaflets.map((row) => [row.id, row.provenance?.observedAt]));
}

/** Two runs inside one millisecond would hide the defect, so the clock is made to move. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a grow with no new commits leaves leaf.json byte-identical", { timeout: 120_000 }, async () => {
  const f = await fixture();
  await grow(f);
  const before = await readFile(join(f.garden, "leaf.json"), "utf8");
  await tick();

  const output = await grow(f);

  assert.equal(await readFile(join(f.garden, "leaf.json"), "utf8"), before, output);
  assert.doesNotMatch(output, /updated in place/, "a re-read alone is not an update");
});

test("one new commit gives only its own leaflet the new run's instant", { timeout: 120_000 }, async () => {
  const f = await fixture();
  await grow(f);
  const first = await observedAtById(f.garden);
  await tick();
  const added = await commit(f.repo, "three.txt", "fix: regrow protocol artifact three");

  await grow(f);
  const second = await observedAtById(f.garden);

  for (const sha of f.shas) {
    assert.equal(second.get(`git:${sha}`), first.get(`git:${sha}`), `git:${sha} was not touched by the new commit`);
  }
  const fresh = second.get(`git:${added}`);
  assert.ok(fresh !== undefined && fresh > (first.get(`git:${f.shas[0]}`) ?? ""), `new leaflet observedAt ${fresh}`);
});

test("a private-brain session granting an intake leaflet still answers after a no-op grow", { timeout: 120_000 }, async (t) => {
  const f = await fixture();
  await grow(f);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyFile = join(await tempDir(), "agent-public.pem");
  await writeFile(keyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });

  const child = spawn(process.execPath, [FOLIAGE_CLI, "private-brain", "serve", "--garden", f.garden,
    "--agent-key", keyFile, "--agent-label", "regrow-protocol", "--record", `leaflet:git:${f.shas[0]}`,
    "--minutes", "1"], { stdio: ["pipe", "pipe", "pipe"], env: cleanEnv(f.home) });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let started = "";
  const ready = await new Promise<string>((resolve, reject) => {
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      started += chunk;
      if (started.includes("Type revoke and Enter")) resolve(started);
    });
    child.once("exit", (code) => reject(new Error(`session exited before ready: ${code}; ${started}`)));
  });
  const session = ready.match(/Private brain session ([a-f0-9]{32})/)?.[1];
  const url = ready.match(/Loopback (http:\/\/127\.0\.0\.1:\d+\/private-brain\/search)/)?.[1];
  assert.ok(session && url, ready);

  const ask = async () => {
    const body = JSON.stringify({ query: "regrow protocol artifact" });
    const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const signature = sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(body)), privateKey)
      .toString("base64url");
    const response = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json",
      "x-foliage-session": session, "x-foliage-timestamp": timestamp,
      "x-foliage-nonce": nonce, "x-foliage-signature": signature } });
    return { status: response.status, text: await response.text() };
  };

  const before = await ask();
  assert.equal(before.status, 200, before.text);
  await tick();
  await grow(f);
  const afterGrow = await ask();
  assert.equal(afterGrow.status, 200, `after a no-op grow: ${afterGrow.text}`);

  child.stdin.write("revoke\n");
  assert.equal(await exited, 0);
});
