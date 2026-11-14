/**
 * PROMOTION SELF-HEALS AGAINST THE LEAF — on real files, in real temporary directories.
 *
 * The defect these cover is reproduced and recorded (ledger row P2, 2026-08-18): a leaf
 * document held 59 leaflets, 2 of them promoted after a human clicked Approve; re-running
 * `intake --force` rewrote the document whole and left 68 leaflets and 0 promotions.
 * Merging in intake stops the destruction. It does NOT repair the documents already
 * damaged — and the old promotion rule ("a candidate carrying `promotedAt` is skipped
 * forever") made that damage permanent, because the harvest kept insisting work it could
 * no longer see had already been done.
 *
 * So these tests are about the OTHER half: after any successful `promote`, the invariant
 * is `promotedAt is set ⟺ the candidate's leaflet is present in the leaf it targets`,
 * repaired in both directions, reported by id, and never re-deciding anything a human
 * decided. Nothing here is mocked; every assertion is against bytes on disk.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseLeafDocument } from "@foliage/leaf";

import { HARVEST_SCHEMA_VERSION } from "./harvestDocument.ts";
import { promote, promotedLeafletId } from "./promote.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-heal-"));
  tmpRoots.push(dir);
  return dir;
}

interface CandidateSpec {
  readonly id: string;
  readonly status: "proposed" | "approved" | "rejected";
  readonly promotedAt?: string;
}

/** A leaflet of the kind intake writes: `provenance.source` is git, not photosynthesis. */
const GIT_LEAFLET = {
  id: "git-abc123def",
  title: "feat(intake): read the reflog",
  tier: "pending",
  provenance: { source: "git", ref: "abc123def", observedAt: "2026-08-15T09:00:00Z" },
} as const;

async function fixture(
  dir: string,
  candidates: readonly CandidateSpec[],
  leaflets: readonly unknown[],
): Promise<{ harvestPath: string; leafPath: string }> {
  const harvestPath = join(dir, "t.harvest.json");
  const leafPath = join(dir, "t.leaf.json");
  await writeFile(
    harvestPath,
    JSON.stringify(
      {
        schemaVersion: HARVEST_SCHEMA_VERSION,
        subject: "T",
        identity: "t@example.com",
        sources: ["/tmp/x"],
        gatheredAt: "2026-08-16T12:00:00Z",
        candidates: candidates.map((c) => ({
          id: c.id,
          drafted: { title: `A body of work (${c.id})`, summary: "Reviewed by a human." },
          evidence: [{ source: "git", ref: "abc123def", excerpt: "feat: thing" }],
          provenance: { method: "deterministic" },
          status: c.status,
          ...(c.status !== "proposed" ? { reviewedAt: "2026-08-16T12:01:00Z" } : {}),
          ...(c.promotedAt !== undefined ? { promotedAt: c.promotedAt } : {}),
        })),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    leafPath,
    JSON.stringify({ id: "t", subject: "T", leaflets }, null, 2) + "\n",
  );
  return { harvestPath, leafPath };
}

async function leafletsOf(leafPath: string): Promise<readonly { id: string; tier: string; title: string }[]> {
  const parsed = parseLeafDocument(JSON.parse(await readFile(leafPath, "utf8")));
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf.leaflets.map((l) => ({ id: l.id, tier: l.tier, title: l.title }));
}

async function harvestCandidates(harvestPath: string): Promise<Record<string, unknown>[]> {
  return JSON.parse(await readFile(harvestPath, "utf8")).candidates as Record<string, unknown>[];
}

/* ------------------------- the repair, forwards ------------------------- */

test("aLeafMissingAPromotedLeafletIsHealedExactlyOnceAndNeighboursAreUntouched", async () => {
  const dir = await tempDir();
  // Exactly the P2 wreckage: the harvest says promoted, the leaf holds only the
  // git-sourced leaflets intake rewrote, and the human's approval has vanished.
  const { harvestPath, leafPath } = await fixture(
    dir,
    [{ id: "c1", status: "approved", promotedAt: "2026-08-16T12:02:00Z" }],
    [GIT_LEAFLET],
  );

  const healed = await promote(harvestPath, leafPath);
  assert.equal(healed.ok, true, healed.issues.join(" · "));
  assert.deepEqual(healed.repromotedMissing, ["c1"]);
  assert.deepEqual(healed.promoted, []); // a repair is NOT a fresh approval
  assert.deepEqual(healed.markedAlreadyPresent, []);
  assert.deepEqual(healed.skippedAlreadyPromoted, []);

  const leaflets = await leafletsOf(leafPath);
  assert.deepEqual(
    leaflets.map((l) => l.id),
    [GIT_LEAFLET.id, promotedLeafletId("c1")],
  );
  assert.equal(leaflets[1]?.tier, "pending"); // NEVER verified, not even on a repair

  // The leaflet this run did not produce is carried forward byte-identical.
  const raw = JSON.parse(await readFile(leafPath, "utf8"));
  assert.deepEqual(raw.leaflets[0], GIT_LEAFLET);

  // The human decision is untouched; only the fact-about-a-file is refreshed.
  const [c1] = await harvestCandidates(harvestPath);
  assert.equal(c1?.["status"], "approved");
  assert.equal(c1?.["reviewedAt"], "2026-08-16T12:01:00Z");
  assert.notEqual(c1?.["promotedAt"], "2026-08-16T12:02:00Z");

  // EXACTLY ONCE: a second run finds it present and does nothing.
  const again = await promote(harvestPath, leafPath);
  assert.equal(again.ok, true);
  assert.deepEqual(again.repromotedMissing, []);
  assert.deepEqual(again.skippedAlreadyPromoted, ["c1"]);
  assert.equal((await leafletsOf(leafPath)).length, 2); // no duplicate
});

test("aLeafAlreadyHoldingThePromotedLeafletIsNotWrittenAtAll", async () => {
  const dir = await tempDir();
  const existing = {
    id: promotedLeafletId("c1"),
    title: "A body of work (c1)",
    tier: "pending",
    provenance: { source: "photosynthesis", ref: "git:abc123def", observedAt: "2026-08-16T12:02:00Z" },
  };
  const { harvestPath, leafPath } = await fixture(
    dir,
    [{ id: "c1", status: "approved", promotedAt: "2026-08-16T12:02:00Z" }],
    [existing],
  );
  const leafBefore = await readFile(leafPath, "utf8");
  const harvestBefore = await readFile(harvestPath, "utf8");

  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, true);
  assert.deepEqual(result.skippedAlreadyPromoted, ["c1"]);
  assert.deepEqual(result.repromotedMissing, []);
  assert.deepEqual(result.promoted, []);

  // Nothing to do means nothing written — not even a reformat of either file.
  assert.equal(await readFile(leafPath, "utf8"), leafBefore);
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore);
});

/* ------------------------- the repair, backwards ------------------------- */

test("aLeafletPresentWithNoMarkIsMarkedRatherThanDuplicated", async () => {
  const dir = await tempDir();
  // This is the state a crash between the two writes leaves: the leaf write landed, the
  // harvest mark did not. Left uncorrected the next run would append a second copy.
  const existing = {
    id: promotedLeafletId("c1"),
    title: "A body of work (c1)",
    tier: "pending",
    provenance: { source: "photosynthesis", ref: "git:abc123def", observedAt: "2026-08-16T12:02:00Z" },
  };
  const { harvestPath, leafPath } = await fixture(dir, [{ id: "c1", status: "approved" }], [existing]);
  const leafBefore = await readFile(leafPath, "utf8");

  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, true, result.issues.join(" · "));
  assert.deepEqual(result.markedAlreadyPresent, ["c1"]);
  assert.deepEqual(result.promoted, []);
  assert.equal(await readFile(leafPath, "utf8"), leafBefore); // no second copy, no rewrite

  const [c1] = await harvestCandidates(harvestPath);
  assert.equal(typeof c1?.["promotedAt"], "string");

  const again = await promote(harvestPath, leafPath);
  assert.deepEqual(again.markedAlreadyPresent, []);
  assert.deepEqual(again.skippedAlreadyPromoted, ["c1"]);
  assert.equal((await leafletsOf(leafPath)).length, 1);
});

/* --------------------------- the airlock holds --------------------------- */

test("noRepairPathEverCarriesACandidateAHumanDidNotApprove", async () => {
  const dir = await tempDir();
  // c1 was REJECTED and a leaflet bearing its id is sitting in the leaf anyway (a hand
  // edit, or a leaf that outlived the decision). Marking it would record a promotion the
  // human refused, so the rejected candidate stays invisible to every path.
  const stray = {
    id: promotedLeafletId("c1"),
    title: "Work a human said no to",
    tier: "pending",
    provenance: { source: "photosynthesis", ref: "git:abc123def", observedAt: "2026-08-16T12:02:00Z" },
  };
  const { harvestPath, leafPath } = await fixture(
    dir,
    [
      { id: "c1", status: "rejected" },
      { id: "c2", status: "proposed" },
    ],
    [stray],
  );
  const leafBefore = await readFile(leafPath, "utf8");
  const harvestBefore = await readFile(harvestPath, "utf8");

  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, true, result.issues.join(" · "));
  assert.deepEqual(result.promoted, []);
  assert.deepEqual(result.repromotedMissing, []);
  assert.deepEqual(result.markedAlreadyPresent, []);
  assert.equal(result.skippedNotApproved, 2);
  assert.equal(await readFile(leafPath, "utf8"), leafBefore);
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore);
});

test("aPromotionMarkOnAnUndecidedCandidateIsRefusedByTheFormatItself", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await fixture(dir, [], []);
  // Structural, not behavioural: `promotedAt` on anything but an approved candidate is
  // refused by the harvest parser, so the repair path can never be handed one.
  const doc = JSON.parse(await readFile(harvestPath, "utf8"));
  doc.candidates = [
    {
      id: "c1",
      drafted: { title: "A body of work", summary: "" },
      evidence: [{ source: "git", ref: "abc123def", excerpt: "feat: thing" }],
      provenance: { method: "deterministic" },
      status: "rejected",
      reviewedAt: "2026-08-16T12:01:00Z",
      promotedAt: "2026-08-16T12:02:00Z",
    },
  ];
  await writeFile(harvestPath, JSON.stringify(doc, null, 2) + "\n");

  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((i) => i.includes("candidates[0].promotedAt")),
    result.issues.join(" · "),
  );
});

/* ---------------------- a failure is never a zero ---------------------- */

test("anUnparseableExistingLeafIsANamedCauseAndNothingIsWritten", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await fixture(
    dir,
    [{ id: "c1", status: "approved", promotedAt: "2026-08-16T12:02:00Z" }],
    [],
  );
  // A leaf this function cannot read is NOT "a leaf with no leaflets in it". Reading it
  // that way would re-promote on top of a document whose contents are unknown.
  await writeFile(leafPath, "{ this is not json");
  const leafBefore = await readFile(leafPath, "utf8");
  const harvestBefore = await readFile(harvestPath, "utf8");

  const unreadable = await promote(harvestPath, leafPath);
  assert.equal(unreadable.ok, false);
  assert.ok(unreadable.issues.some((i) => i.startsWith("leaf unreadable:")), unreadable.issues.join(" · "));
  assert.equal(await readFile(leafPath, "utf8"), leafBefore);
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore);

  // Parseable JSON that is not a leaf gets its own cause, distinct from "merged leaf
  // invalid" — one says the file was already broken, the other says this run would
  // have broken it.
  await writeFile(leafPath, JSON.stringify({ id: "t", subject: "", leaflets: [] }, null, 2) + "\n");
  const invalid = await promote(harvestPath, leafPath);
  assert.equal(invalid.ok, false);
  assert.ok(
    invalid.issues.some((i) => i.startsWith("existing leaf invalid at subject")),
    invalid.issues.join(" · "),
  );
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore); // not marked either
});

test("everyWritePathLeavesNoTemporaryFileBehind", async () => {
  const dir = await tempDir();
  const { harvestPath, leafPath } = await fixture(
    dir,
    [{ id: "c1", status: "approved", promotedAt: "2026-08-16T12:02:00Z" }],
    [GIT_LEAFLET],
  );
  const result = await promote(harvestPath, leafPath);
  assert.equal(result.ok, true, result.issues.join(" · "));
  // temp-file + rename is what makes the all-on-nothing guarantee a mechanism rather than
  // prose; a stray .tmp would mean a rename that never happened.
  const entries = await readdir(dir);
  assert.deepEqual(entries.filter((e) => e.endsWith(".tmp")), []);
  assert.deepEqual(entries.sort(), ["t.harvest.json", "t.leaf.json"]);
});
