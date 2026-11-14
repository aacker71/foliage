/**
 * The pipeline's honesty, on real files. No fs mocks; temporary directories and a real
 * `git init` — the behaviours under test ARE filesystem and git behaviours.
 *
 * The load-bearing cases:
 *   - the policy fails CLOSED (unset denies frontier; loopback always drafts)
 *   - a git failure carries its cause, never a fabricated zero
 *   - promotion is validated, idempotent, pending-only, and all-or-nothing
 *
 * Promotion's idempotence is measured against the LEAF, not against the harvest, and the
 * repairs that fall out of that (a destroyed leaflet re-carried; a leaflet present with no
 * mark) have their own file: `promoteHeal.test.ts`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { parseLeafDocument } from "@foliage/leaf";

import { decideEgress, isLoopbackUrl, mayDraftAgainst } from "./policy.ts";
import { gather, gatherGit } from "./gather.ts";
import { draftDeterministic } from "./drafter.ts";
import { parseHarvestDocument, HARVEST_SCHEMA_VERSION } from "./harvestDocument.ts";
import { promote } from "./promote.ts";

const exec = promisify(execFile);

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-ps-"));
  tmpRoots.push(dir);
  return dir;
}

/* ------------------------------ policy ------------------------------ */

test("unsetDeniesFrontierEgress_theFreshInstallLeaksNothing", () => {
  assert.equal(decideEgress("unset").frontierEgress, "denied");
  assert.equal(decideEgress(undefined).frontierEgress, "denied");
  assert.equal(decideEgress("nonsense").frontierEgress, "denied");
});

test("consentIsRequiredVerbatimAndModeMatched", () => {
  assert.equal(decideEgress("frontier-consented").reason, "consent-missing");
  assert.equal(
    decideEgress("frontier-consented", { mode: "local-preferred", statement: "x", grantedAt: "t" }).reason,
    "consent-mode-mismatch",
  );
  assert.equal(
    decideEgress("frontier-consented", { mode: "frontier-consented", statement: "  ", grantedAt: "t" }).reason,
    "consent-empty-statement",
  );
  assert.equal(
    decideEgress("frontier-consented", { mode: "frontier-consented", statement: "I agree.", grantedAt: "t" })
      .frontierEgress,
    "permitted",
  );
});

test("loopbackAlwaysDraftsAndNonLoopbackNeedsThePolicy", () => {
  assert.equal(mayDraftAgainst("http://127.0.0.1:11434", "unset", null).allowed, true);
  assert.equal(mayDraftAgainst("https://api.example.com", "unset", null).allowed, false);
  assert.equal(mayDraftAgainst("not a url", "frontier-consented", null).allowed, false);
  /**
   * FLIPPED 2026-08-28 WITH F-009, and it is the one line in this file that changed meaning.
   * This assertion WAS `true` — it was the defect written down as an expectation: `localhost`
   * is a NAME, resolved by a file and a resolver this process does not control, and admitting
   * it here is what made `policy.ts` and `apps/cos/src/localModel.ts` disagree about which
   * addresses are "on this machine". Both gates now hold the single literal `127.0.0.1` that
   * `apps/leaf/src/loopbackFetch.ts` already argued for. A test asserting the old answer is not
   * coverage of the narrowing; it is the narrowing's last holdout, so it moves rather than being
   * deleted — the refusal is the behaviour worth pinning.
   */
  assert.equal(isLoopbackUrl("http://localhost:11434"), false);
  assert.equal(isLoopbackUrl("http://127.0.0.1:11434"), true);
  assert.equal(isLoopbackUrl("http://192.168.1.10:11434"), false);
});

/* ------------------------------ gather ------------------------------ */

test("aGitFailureCarriesItsCauseNeverAFabricatedZero", async () => {
  const dir = await tempDir(); // a real directory that is NOT a repository
  const result = await gatherGit(dir, "x@example.com");
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.cause.length > 0);
});

test("gatherOnARealRepoClustersByPrefixAndFiltersByIdentity", async () => {
  const dir = await tempDir();
  const git = async (...args: string[]) =>
    exec("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  await exec("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "1");
  await git("add", "a.txt");
  await git("commit", "-m", "feat(x): first");
  await writeFile(join(dir, "a.txt"), "2");
  await git("add", "a.txt");
  await git("commit", "-m", "feat(x): second");
  await writeFile(join(dir, "a.txt"), "3");
  await git("add", "a.txt");
  await git("commit", "-m", "docs: readme");

  const mine = await gather({ repo: dir, identity: "t@example.com" });
  assert.equal(mine.git.ok, true);
  if (mine.git.ok) {
    assert.equal(mine.git.data.total, 3);
    assert.equal(mine.git.data.clusters[0]?.key, "feat(x)");
    assert.equal(mine.git.data.clusters[0]?.commits.length, 2);
  }

  const nobody = await gather({ repo: dir, identity: "nobody@example.com" });
  assert.equal(nobody.git.ok, true);
  if (nobody.git.ok) assert.equal(nobody.git.data.total, 0); // honest empty, not an error
});

test("deterministicDraftingProducesParseableGroundedCandidates", async () => {
  const dir = await tempDir();
  const git = async (...args: string[]) =>
    exec("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  await exec("git", ["init", dir]);
  for (let i = 0; i < 3; i++) {
    await writeFile(join(dir, "a.txt"), String(i));
    await git("add", "a.txt");
    await git("commit", "-m", `build: step ${i}`);
  }
  const g = await gather({ repo: dir, identity: "t@example.com" });
  const draft = draftDeterministic(g);
  assert.ok(draft.candidates.length >= 1);
  assert.equal(draft.provenance.method, "deterministic");

  const doc = {
    schemaVersion: HARVEST_SCHEMA_VERSION,
    subject: "T",
    identity: "t@example.com",
    sources: [dir],
    gatheredAt: new Date().toISOString(),
    candidates: draft.candidates,
  };
  const parsed = parseHarvestDocument(doc);
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
});

/* ------------------------------ promote ------------------------------ */

async function harvestFixture(dir: string, status: "proposed" | "approved", promotedAt?: string) {
  const harvestPath = join(dir, "t.harvest.json");
  const leafPath = join(dir, "t.leaf.json");
  await writeFile(
    harvestPath,
    JSON.stringify({
      schemaVersion: HARVEST_SCHEMA_VERSION,
      subject: "T",
      identity: "t@example.com",
      sources: ["/tmp/x"],
      gatheredAt: "2026-08-16T12:00:00Z",
      candidates: [
        {
          id: "c1",
          drafted: { title: "A body of work", summary: "Approved by a human." },
          evidence: [{ source: "git", ref: "abc123def", excerpt: "feat: thing" }],
          provenance: { method: "deterministic" },
          status,
          ...(status !== "proposed" ? { reviewedAt: "2026-08-16T12:01:00Z" } : {}),
          ...(promotedAt !== undefined ? { promotedAt } : {}),
        },
      ],
    }),
  );
  await writeFile(leafPath, JSON.stringify({ id: "t", subject: "T", leaflets: [] }));
  return { harvestPath, leafPath };
}

test("promotionCarriesApprovedCandidatesAsPendingAndIsIdempotent", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await harvestFixture(dir, "approved");

  const first = await promote(harvestPath, leafPath);
  assert.equal(first.ok, true);
  assert.deepEqual(first.promoted, ["c1"]);

  const leaf = parseLeafDocument(JSON.parse(await readFile(leafPath, "utf8")));
  assert.equal(leaf.ok, true);
  if (leaf.ok) {
    assert.equal(leaf.leaf.leaflets.length, 1);
    assert.equal(leaf.leaf.leaflets[0]?.tier, "pending"); // NEVER verified
    assert.equal(leaf.leaf.leaflets[0]?.title, "A body of work");
  }

  // Run it again: nothing promotes twice.
  const second = await promote(harvestPath, leafPath);
  assert.equal(second.ok, true);
  assert.deepEqual(second.promoted, []);
  assert.deepEqual(second.skippedAlreadyPromoted, ["c1"]);
  const leafAgain = parseLeafDocument(JSON.parse(await readFile(leafPath, "utf8")));
  if (leafAgain.ok) assert.equal(leafAgain.leaf.leaflets.length, 1);
});

test("aProposedCandidateNeverCrossesTheAirlock", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await harvestFixture(dir, "proposed");
  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, true);
  assert.deepEqual(result.promoted, []);
  assert.equal(result.skippedNotApproved, 1);
  const leaf = parseLeafDocument(JSON.parse(await readFile(leafPath, "utf8")));
  if (leaf.ok) assert.equal(leaf.leaf.leaflets.length, 0);
});

test("anInvalidTargetLeafWritesNothingAnywhereAndNamesWhichDocumentIsBroken", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await harvestFixture(dir, "approved");
  // Sabotage the target leaf. It is caught on the way IN, before anything is merged:
  // idempotence is measured against this document, so one that cannot be parsed is a
  // named refusal rather than a fall-through to "it has no leaflets in it".
  await writeFile(leafPath, JSON.stringify({ id: "t", subject: "", leaflets: [] }));
  const before = await readFile(leafPath, "utf8");

  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((i) => i.startsWith("existing leaf invalid at subject")),
    result.issues.join(" · "),
  );
  assert.equal(await readFile(leafPath, "utf8"), before); // untouched
  const harvest = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(harvest.candidates[0].promotedAt, undefined); // not marked either
});
