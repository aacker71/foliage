/** Real temporary Git observations exercise actual import, review, promotion and refresh CLIs. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withDocumentLocks } from "@foliage/leaf/local-files";

const exec = promisify(execFile);
const importer = fileURLToPath(new URL("../import-observations.mjs", import.meta.url));
const harvestCli = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });
async function run(script: string, args: string[], input = "", env: NodeJS.ProcessEnv = process.env) {
  try {
    const pending = exec(process.execPath, [script, ...args], { env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    pending.child.stdin?.on("error", () => {}); // A bounded reader may close before an oversized input finishes.
    pending.child.stdin?.end(input);
    const value = await pending;
    return { code: 0, stdout: value.stdout, stderr: value.stderr };
  } catch (error) {
    const e = error as { code?: number | string; killed?: boolean; message?: string; stdout?: string; stderr?: string };
    return {
      code: e.code ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr || (e.killed ? `Child command exceeded the 60-second deadline: ${script}` : e.message ?? ""),
    };
  }
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "foliage-observation-import-")); roots.push(dir);
  const repo = join(dir, "repo"); const garden = join(dir, "garden");
  await exec("git", ["init", "-q", "--initial-branch=main", repo]);
  const git = (args: string[]) => exec("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await git(["config", "user.name", "Local import regression harness"]);
  await git(["config", "user.email", "import-harness@foliage.invalid"]);
  const excerpt = "Regression input for local observation import.\n";
  await writeFile(join(repo, "observation.txt"), excerpt);
  await git(["add", "observation.txt"]);
  await git(["commit", "-qm", "feat: exercise explicit observation import", "--no-gpg-sign"]);
  const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const title = (await git(["show", "-s", "--format=%s", "HEAD"])).stdout.trim();
  const grow = ["grow", "--repo", repo, "--subject", "Local import regression harness", "--identity", "import-harness@foliage.invalid", "--garden", garden];
  const grown = await run(launcher, grow); assert.equal(grown.code, 0, grown.stderr);
  const leaf = join(garden, "leaf.json"); const harvest = join(garden, "harvest.json");
  const target = JSON.parse(await readFile(leaf, "utf8"));
  const batch = { format: "foliage-observations", version: 1,
    subject: { leafId: target.id, name: target.subject },
    source: { provider: "git-export", tenantId: null, accountId: "local-regression-harness" },
    completion: "complete", deletedRecordIds: [] as string[],
    observations: [{ recordId: sha, revision: sha, title, excerpt, observedAt: new Date().toISOString() }] };
  const input = join(dir, "observations.json"); await writeFile(input, JSON.stringify(batch));
  return { dir, repo, garden, leaf, harvest, batch, input, grow,
    args: ["--input", input, "--into", leaf, "--out", harvest] };
}

test("real observations enter review, retain decisions on replay/refresh and promote only after approval", { timeout: 180_000 }, async () => {
  const f = await fixture(); const beforeLeaf = await readFile(f.leaf, "utf8");
  const first = await run(importer, f.args); assert.equal(first.code, 0, first.stderr);
  const receipt = JSON.parse(first.stdout); assert.equal(receipt.persisted.length, 1);
  const id = receipt.persisted[0];
  assert.equal(await readFile(f.leaf, "utf8"), beforeLeaf);
  let doc = JSON.parse(await readFile(f.harvest, "utf8"));
  assert.deepEqual(doc.candidates.find((c: { id: string }) => c.id === id).review, { state: "candidate" });
  const review = await run(harvestCli, ["review", "--doc", f.harvest]);
  assert.equal(review.code, 0, review.stderr); assert.match(review.stdout, /integration-observation-import:v1/);
  const unapproved = await run(harvestCli, ["promote", "--doc", f.harvest, "--into", f.leaf, "--force"]);
  assert.equal(unapproved.code, 0, unapproved.stderr);
  assert.equal(JSON.parse(await readFile(f.leaf, "utf8")).leaflets.some((l: { id: string }) => l.id === id), false);
  const approved = await run(harvestCli, ["approve", id, "--by", "Local import regression harness", "--doc", f.harvest]);
  assert.equal(approved.code, 0, approved.stderr);
  const approvedBytes = await readFile(f.harvest, "utf8");
  f.batch.observations[0]!.observedAt = new Date(Date.now() + 1000).toISOString();
  const replay = await run(importer, ["--input", "-", "--into", f.leaf, "--out", f.harvest], JSON.stringify(f.batch));
  assert.equal(replay.code, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout).persisted, []);
  assert.equal(await readFile(f.harvest, "utf8"), approvedBytes);
  const refreshed = await run(launcher, f.grow); assert.equal(refreshed.code, 0, refreshed.stderr);
  doc = JSON.parse(await readFile(f.harvest, "utf8"));
  assert.deepEqual(doc.candidates.find((c: { id: string }) => c.id === id), JSON.parse(approvedBytes).candidates.find((c: { id: string }) => c.id === id));
  const promoted = await run(harvestCli, ["promote", "--doc", f.harvest, "--into", f.leaf, "--force"]);
  assert.equal(promoted.code, 0, promoted.stderr);
  const entry = JSON.parse(await readFile(f.leaf, "utf8")).leaflets.find((l: { id: string }) => l.id === id);
  assert.equal(entry.tier, "pending"); assert.ok(entry.visibility === undefined || entry.visibility === "private");
  assert.ok(entry.body.some((element: { text?: string }) => element.text === f.batch.observations[0]!.excerpt));
});

test("actual title-edit approval survives unrelated refresh; original snapshot replay refuses without losing the decision", { timeout: 180_000 }, async () => {
  const f = await fixture();
  const first = await run(importer, f.args); assert.equal(first.code, 0, first.stderr);
  const id = JSON.parse(first.stdout).persisted[0];
  const approved = await run(harvestCli, ["approve", id, "--by", "Local import regression harness", "--title", "Local observation import exercised by this test", "--doc", f.harvest]);
  assert.equal(approved.code, 0, approved.stderr);
  const decidedBytes = await readFile(f.harvest, "utf8");
  const decided = JSON.parse(decidedBytes).candidates.find((c: { id: string }) => c.id === id);
  assert.equal(decided.extractor, "reviewer:Local import regression harness");
  const replay = await run(importer, f.args); assert.notEqual(replay.code, 0);
  assert.match(replay.stderr, /locally edited title/);
  assert.equal(await readFile(f.harvest, "utf8"), decidedBytes);
  const refreshed = await run(launcher, f.grow); assert.equal(refreshed.code, 0, refreshed.stderr);
  assert.deepEqual(JSON.parse(await readFile(f.harvest, "utf8")).candidates.find((c: { id: string }) => c.id === id), decided);
});

test("partial/deletion/conflict/damaged input and held locks preserve both documents", { timeout: 180_000 }, async () => {
  const f = await fixture();
  const first = await run(importer, f.args); assert.equal(first.code, 0, first.stderr);
  const beforeLeaf = await readFile(f.leaf, "utf8"); const beforeHarvest = await readFile(f.harvest, "utf8");
  for (const batch of [
    { ...f.batch, completion: "partial" }, { ...f.batch, deletedRecordIds: [f.batch.observations[0]!.recordId] },
    { ...f.batch, subject: { ...f.batch.subject, name: "Different declared subject" } },
    { ...f.batch, observations: [{ ...f.batch.observations[0]!, excerpt: "Changed adversarial content under the same revision" }] },
  ]) {
    const result = await run(importer, ["--input", "-", "--into", f.leaf, "--out", f.harvest], JSON.stringify(batch));
    assert.notEqual(result.code, 0); assert.equal(await readFile(f.harvest, "utf8"), beforeHarvest);
    assert.equal(await readFile(f.leaf, "utf8"), beforeLeaf);
  }
  for (const path of [f.leaf, f.harvest]) await withDocumentLocks([path], async () => {
    const busy = await run(importer, f.args); assert.notEqual(busy.code, 0); assert.match(busy.stderr, /busy/);
  });
  await writeFile(f.harvest, "{damaged");
  const damaged = await run(importer, f.args); assert.notEqual(damaged.code, 0);
  assert.match(damaged.stderr, /not valid JSON/); assert.equal(await readFile(f.harvest, "utf8"), "{damaged");
});

test("bounded reads, strict destinations, honest empty input and garden routing", { timeout: 180_000 }, async () => {
  const f = await fixture(); const before = await readFile(f.harvest, "utf8");
  const blank = { ...f.batch, observations: [] };
  const empty = await run(importer, ["--input", "-", "--into", f.leaf, "--out", f.harvest], JSON.stringify(blank));
  assert.equal(empty.code, 0, empty.stderr); assert.equal(JSON.parse(empty.stdout).emptyBatch, true);
  assert.equal(await readFile(f.harvest, "utf8"), before);
  const absent = await run(importer, ["--input", f.input], "", { ...process.env, FOLIAGE_LEAF: f.leaf, FOLIAGE_HARVEST: f.harvest });
  assert.notEqual(absent.code, 0); assert.match(absent.stderr, /Explicit/);
  for (const flag of ["input", "into", "out"]) {
    const duplicate = await run(importer, [...f.args, `--${flag}=${f.input}`]);
    assert.notEqual(duplicate.code, 0); assert.match(duplicate.stderr, /Duplicate/);
  }
  const large = join(f.dir, "large.json"); await writeFile(large, "x".repeat(1024 * 1024 + 1));
  const huge = await run(importer, ["--input", large, "--into", f.leaf, "--out", f.harvest]);
  assert.notEqual(huge.code, 0); assert.match(huge.stderr, /exceeds/);
  const invalidUtf8 = Buffer.from(JSON.stringify(f.batch));
  invalidUtf8[invalidUtf8.indexOf("Regression input")] = 0xff;
  const invalidPath = join(f.dir, "invalid-utf8.json"); await writeFile(invalidPath, invalidUtf8);
  const corrupt = await run(importer, ["--input", invalidPath, "--into", f.leaf, "--out", f.harvest]);
  assert.notEqual(corrupt.code, 0, "invalid UTF-8 must not silently become replacement text in evidence");
  const alias = join(f.dir, "input-alias.json"); await symlink(f.input, alias);
  assert.notEqual((await run(importer, ["--input", alias, "--into", f.leaf, "--out", f.harvest])).code, 0);
  assert.equal(await readFile(f.harvest, "utf8"), before);
  const missingOut = join(f.dir, "never-created", "harvest.json");
  const help = await run(importer, ["--help", "--out", missingOut]); assert.equal(help.code, 0);
  assert.equal((await readdir(f.dir)).includes("never-created"), false);
  const routed = await run(launcher, ["integrations", "import", "--input", f.input, "--garden", f.garden], "",
    { ...process.env, FOLIAGE_LEAF: join(f.dir, "ambient-leaf"), FOLIAGE_HARVEST: join(f.dir, "ambient-harvest") });
  assert.equal(routed.code, 0, routed.stderr); assert.equal(JSON.parse(routed.stdout).persisted.length, 1);
  const explicit = await run(launcher, ["integrations", "import", `--input=${f.input}`, `--into=${f.leaf}`, `--out=${f.harvest}`, "--garden", join(f.dir, "not-selected")]);
  assert.equal(explicit.code, 0, explicit.stderr); assert.equal(JSON.parse(explicit.stdout).unchanged.length, 1);
});
