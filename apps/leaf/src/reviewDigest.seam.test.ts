/**
 * THE REGRESSION THIS PINS — found 2026-08-24 by cross-model review, and it is the interaction
 * of two good changes: `0bad6db` taught re-proposal to carry a person's decisions forward, and
 * `4fcbc6b` taught promotion to lift each evidence excerpt into PUBLIC body text. The carry
 * compare knew only title + sorted source/ref pairs — so a decision recorded BEFORE excerpts
 * existed would carry onto a refreshed candidate that now holds them, and promotion would
 * publish words the reviewer never saw, under their name and their timestamp.
 *
 * Every test drives the REAL CLI (`harvest.mjs propose/approve`) against a REAL throwaway git
 * repository, because the bug lives in the seam between runs, not in any one function.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const exec = promisify(execFile);
const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const IDENTITY = "digest-seam@example.com";

const cleanups: string[] = [];
after(async () => {
  for (const dir of cleanups) await rm(dir, { recursive: true, force: true });
});

/** A real repo with a few same-prefix commits by one author. */
async function repoWithCommits(subjects: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-digest-seam-"));
  cleanups.push(dir);
  const git = (...args: string[]) => exec("git", ["-C", dir, ...args]);
  await git("init", "-q");
  await git("config", "user.email", IDENTITY);
  await git("config", "user.name", "Digest Seam");
  for (const [i, subject] of subjects.entries()) {
    await writeFile(join(dir, `f${i}.txt`), `${i}\n`, "utf8");
    await git("add", `f${i}.txt`);
    await git("commit", "-q", "-m", subject, "--no-gpg-sign");
  }
  return dir;
}

const propose = (repo: string, out: string) =>
  exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", IDENTITY, "--out", out, "--force"]);

const approve = (out: string, id: string) =>
  exec(process.execPath, [HARVEST, "approve", id, "--by", "Digest Seam", "--doc", out]);

const docAt = async (out: string) => JSON.parse(await readFile(out, "utf8"));

test("an approval recorded TODAY carries forward across an identical re-propose — by digest", async () => {
  const repo = await repoWithCommits(["feat: one", "feat: two", "feat: three"]);
  const out = join(repo, "harvest.json");
  await propose(repo, out);
  const first = await docAt(out);
  const id = first.candidates[0].id;
  await approve(out, id);

  const approved = (await docAt(out)).candidates[0];
  assert.equal(approved.review.state, "approved");
  assert.match(
    String(approved.review.subjectDigest),
    /^rsd1:[0-9a-f]{64}$/,
    "decide() must stamp the review-subject digest",
  );

  const second = await propose(repo, out);
  const carried = (await docAt(out)).candidates[0];
  assert.equal(carried.review.state, "approved", "an unchanged candidate keeps its decision");
  assert.equal(carried.review.subjectDigest, approved.review.subjectDigest);
  assert.match(second.stdout + second.stderr, /carried/i);
});

test("THE REGRESSION: a legacy approval (no digest) does NOT stretch onto a refresh that gained excerpts — it stays exactly what was approved", async () => {
  const repo = await repoWithCommits(["feat: one", "feat: two", "feat: three"]);
  const out = join(repo, "harvest.json");
  await propose(repo, out);
  const doc = await docAt(out);
  const id = doc.candidates[0].id;

  // Forge the PRE-digest world as test scaffolding: the same candidate, approved under the old
  // scheme — no subjectDigest, and evidence stripped back to the pre-excerpt shape the legacy
  // equality actually compared. This document is exactly what a garden written before
  // 2026-08-23 holds.
  const legacy = {
    candidates: doc.candidates.map((c: Record<string, unknown>, i: number) =>
      i === 0
        ? {
            ...c,
            evidence: (c["evidence"] as Record<string, unknown>[]).map(
              ({ excerpt: _drop, ...keep }) => keep,
            ),
            review: { state: "approved", by: "Legacy Reviewer", at: "2026-08-20T00:00:00.000Z" },
          }
        : c,
    ),
  };
  await writeFile(out, JSON.stringify(legacy, null, 2), "utf8");

  // The refresh: same repo, same refs — and propose now writes excerpts on what it drafts.
  const result = await propose(repo, out);
  const after = await docAt(out);
  const refreshed = after.candidates.find((c: { id: string }) => c.id === id);

  // An approval covers what the reviewer saw, and nothing else ever reaches it: the decided
  // record is frozen, so the words it never covered are not added under it.
  assert.deepEqual(refreshed, legacy.candidates[0], "a decided candidate is never recomputed");
  assert.equal(
    refreshed.evidence.some((e: { excerpt?: string }) => e.excerpt !== undefined),
    false,
    "an approval that never saw the excerpts must NOT come to carry them",
  );
  // Its commits are held: none comes back as a new draft.
  assert.equal(after.candidates.length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /REOPENED/);
});

test("AN APPROVAL STANDS: new work in its cluster comes back as generation 2, holding exactly the new commit", async () => {
  const repo = await repoWithCommits(["feat: one", "feat: two", "feat: three"]);
  const out = join(repo, "harvest.json");
  await propose(repo, out);
  const id = (await docAt(out)).candidates[0].id;
  assert.equal(id, "git-cluster:feat");
  await approve(out, id);
  const approved = (await docAt(out)).candidates[0];

  // New work lands in the same cluster.
  const git = (...args: string[]) => exec("git", ["-C", repo, ...args]);
  await writeFile(join(repo, "f9.txt"), "9\n", "utf8");
  await git("add", "f9.txt");
  await git("commit", "-q", "-m", "feat: four — the commit the approval never saw", "--no-gpg-sign");
  const newSha = (await git("rev-parse", "HEAD")).stdout.trim();

  const result = await propose(repo, out);
  const after = await docAt(out);
  assert.deepEqual(
    after.candidates.find((c: { id: string }) => c.id === id),
    approved,
    "the approved candidate is unchanged, digest and all",
  );
  const next = after.candidates.find((c: { id: string }) => c.id === "git-cluster:feat:2");
  assert.ok(next, "the new commit must come back as its own draft");
  assert.deepEqual(next.evidence.map((e: { ref: string }) => e.ref), [newSha]);
  assert.equal(next.review.state, "candidate");
  assert.doesNotMatch(result.stdout + result.stderr, /REOPENED/);
  assert.match(result.stdout, /drafted 1 · carried 1 · held 3/);
});

test("F-014: the target binding recorded on a re-propose never reopens an existing approval — producer metadata is not something a reviewer approved", async () => {
  // The keysOf tripwire: `subject`/`leafId` are NEW top-level keys on the harvest document.
  // Adding a document key is exactly the shape of edit that can silently widen what an old
  // approval is treated as covering — so this proves the opposite is true here: the digest a
  // reviewer's approval is pinned to (`reviewSubjectDigest`, candidate-shaped) is untouched by
  // a document-level field no candidate carries and no reviewer ever saw per-candidate.
  const repo = await repoWithCommits(["feat: one", "feat: two", "feat: three"]);
  const out = join(repo, "harvest.json");
  await propose(repo, out);
  const id = (await docAt(out)).candidates[0].id;
  await approve(out, id);
  const beforeDigest = (await docAt(out)).candidates[0].review.subjectDigest;
  assert.match(String(beforeDigest), /^rsd1:[0-9a-f]{64}$/);

  const leafPath = join(repo, "leaf.json");
  await writeFile(
    leafPath,
    JSON.stringify({ id: "leaf:digest-seam", subject: "Digest Seam", leaflets: [] }),
    "utf8",
  );

  const result = await exec(process.execPath, [
    HARVEST,
    "propose",
    "--repo",
    repo,
    "--identity",
    IDENTITY,
    "--out",
    out,
    "--force",
    "--into",
    leafPath,
  ]);
  const doc = await docAt(out);
  assert.equal(doc.subject, "Digest Seam", "the document now records the target it was proposed for");
  assert.equal(doc.leafId, "leaf:digest-seam");

  const after = doc.candidates.find((c: { id: string }) => c.id === id);
  assert.equal(
    after.review.state,
    "approved",
    "recording the target binding must never reopen an existing approval",
  );
  assert.equal(
    after.review.subjectDigest,
    beforeDigest,
    "the candidate's digest is unaffected — the binding is document-level, never folded into " +
      "what a reviewer approved",
  );
  assert.doesNotMatch(result.stdout + result.stderr, /REOPENED/);
});
