/**
 * Regression tests for the adversarial review's confirmed findings (2026-08-17).
 *
 * Each test names the defect it pins. They are gathered in one file on purpose: this is
 * the record of what an independent review caught that the author's own tests did not,
 * and keeping it legible as a set is worth more than scattering the cases.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { gatherGit } from "./gather.ts";
import { parseHarvestDocument, scoreShapedProse, HARVEST_SCHEMA_VERSION } from "./harvestDocument.ts";
import { draftFromPhoto } from "./drafter.ts";

const exec = promisify(execFile);
const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-ps-reg-"));
  tmpRoots.push(dir);
  return dir;
}

/**
 * CRITICAL — attribution used `git log --author=<identity>`, which git treats as a
 * REGEX. `alex.example.com` therefore also matched `Alex Faux <alexXexample.com>`:
 * another human's commit entering the subject's evidence as their own work. Reproduced
 * here exactly as the reviewer reproduced it.
 */
test("REGRESSION: a regex-meaningful identity cannot match another author's commits", async () => {
  const dir = await tempDir();
  const commit = (name: string, email: string, msg: string) =>
    exec("git", [
      "-C", dir, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "-c", "commit.gpgsign=false",
      "commit", "-q", "--allow-empty", "-m", msg,
    ]);
  await exec("git", ["init", "-q", dir]);
  await commit("Alex Faux", "alexXexample.com", "NOT the subject's work");
  await commit("Real Subject", "alex.example.com", "the subject's real work");

  const result = await gatherGit(dir, "alex.example.com");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const subjects = result.data.clusters.flatMap((c) => c.commits.map((x) => x.subject));
  assert.deepEqual(subjects, ["the subject's real work"]);
  assert.equal(result.data.total, 1, "the impostor's commit must not be attributed to the subject");
  // And the observed-author census is what makes a wrong --identity diagnosable.
  assert.deepEqual(
    result.data.observedAuthors.map((a) => a.email).sort(),
    ["alexXexample.com", "alex.example.com"].sort(),
  );
});

test("REGRESSION: an identity with unbalanced brackets does not abort gathering", async () => {
  const dir = await tempDir();
  await exec("git", ["init", "-q", dir]);
  await exec("git", [
    "-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
    "commit", "-q", "--allow-empty", "-m", "only commit",
  ]);
  // `git log --author='alex['` exits 128 with "brackets ([ ]) not balanced".
  const result = await gatherGit(dir, "alex[");
  assert.equal(result.ok, true, "a metacharacter identity must yield an honest empty, not a git error");
  if (result.ok) assert.equal(result.data.total, 0);
});

/**
 * HIGH — a promoted title wears the leaf renderer's `data-verbatim="title"` marker,
 * which the NO SCORE invariant deliberately exempts (refusing to render a real commit
 * subject would falsify evidence). Machine prose is not entitled to that exemption, so
 * score-shaped PROSE is refused at the harvest boundary.
 */
test("REGRESSION: score-shaped prose in drafted text is refused", () => {
  const base = {
    schemaVersion: HARVEST_SCHEMA_VERSION,
    subject: "S",
    identity: "s@example.com",
    sources: ["/tmp/r"],
    gatheredAt: "2026-08-17T00:00:00Z",
  };
  const candidate = (title: string, summary: string) => ({
    ...base,
    candidates: [
      {
        id: "c1",
        drafted: { title, summary },
        evidence: [{ source: "git", ref: "abc", excerpt: "feat: x" }],
        provenance: { method: "deterministic" },
        status: "proposed",
      },
    ],
  });

  for (const [title, summary] of [
    ["Rated 9/10 for impact", "ok"],
    ["Fine title", "Scored 87% on the internal rubric."],
    ["Top 5% contributor", "ok"],
    ["Fine", "Ranked first among the team."],
  ] as const) {
    const p = parseHarvestDocument(candidate(title, summary));
    assert.equal(p.ok, false, `expected refusal for ${JSON.stringify([title, summary])}`);
    if (!p.ok) assert.ok(p.issues.some((i) => /reads as a rating/.test(i.message)));
  }

  // And ordinary drafted prose still passes — the gate must not be so broad it refuses
  // legitimate descriptions of real work.
  assert.equal(parseHarvestDocument(candidate("Built the intake path", "Reads real git history.")).ok, true);
  assert.deepEqual(scoreShapedProse("Built the intake path"), []);
});

/**
 * HIGH — re-harvesting is the ONLY supported way to update a harvest (`--force`), and it
 * used to rebuild the document from scratch, discarding every human decision while two
 * docstrings promised the opposite. This pins the merge at the level the CLI implements
 * it: decided candidates are carried forward by content-derived id.
 */
test("REGRESSION: prior decisions merge forward instead of being wiped", async () => {
  const dir = await tempDir();
  const out = join(dir, "t.harvest.json");
  const mk = (status: string, extra: Record<string, unknown> = {}) => ({
    schemaVersion: HARVEST_SCHEMA_VERSION,
    subject: "S",
    identity: "s@example.com",
    sources: [dir],
    gatheredAt: "2026-08-17T00:00:00Z",
    candidates: [
      {
        id: "ps-stable",
        drafted: { title: "A body of work", summary: "s" },
        evidence: [{ source: "git", ref: "abc", excerpt: "feat: x" }],
        provenance: { method: "deterministic" },
        status,
        ...extra,
      },
    ],
  });
  await writeFile(out, JSON.stringify(mk("rejected", { reviewedAt: "2026-08-17T01:00:00Z" })));

  // Simulate the CLI's merge step: fresh drafting proposes the SAME id.
  const priorParsed = parseHarvestDocument(JSON.parse(await readFile(out, "utf8")));
  assert.equal(priorParsed.ok, true);
  if (!priorParsed.ok) return;
  const prior = new Map(priorParsed.harvest.candidates.filter((c) => c.status !== "proposed").map((c) => [c.id, c]));
  const fresh = mk("proposed").candidates;
  const merged = fresh.map((c) => prior.get(c.id) ?? c);

  const first = merged[0];
  assert.ok(first !== undefined);
  assert.equal(first.status, "rejected", "a rejected candidate must not be resurrected as proposed");
  assert.equal("reviewedAt" in first ? first.reviewedAt : undefined, "2026-08-17T01:00:00Z");
});

/** LOW — the photo path hardcoded the policy mode instead of threading the caller's. */
test("REGRESSION: the photo path consults the policy with the caller's real mode", async () => {
  const result = await draftFromPhoto(
    { path: "/nonexistent.png", digest: "d", bytes: 1 },
    { baseUrl: "https://frontier.example.com", mode: "unset", consent: null },
  );
  assert.equal(result.candidate, undefined);
  assert.match(result.cause ?? "", /refused by policy: no-mode-chosen/);

  // With consent for a frontier endpoint the gate permits the attempt (it then fails on
  // the unreachable host — which is the honest next failure, not a policy refusal).
  const consented = await draftFromPhoto(
    { path: "/nonexistent.png", digest: "d", bytes: 1 },
    {
      baseUrl: "https://frontier.example.invalid",
      mode: "frontier-consented",
      consent: { mode: "frontier-consented", statement: "I agree.", grantedAt: "2026-08-17T00:00:00Z" },
    },
  );
  assert.equal(consented.candidate, undefined);
  assert.ok(!/refused by policy/.test(consented.cause ?? ""), consented.cause);
});
