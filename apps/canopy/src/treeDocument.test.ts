/**
 * The tree loader, against REAL files on a real filesystem.
 *
 * No `fs` mock anywhere in this file. The behaviours under test ARE filesystem behaviours —
 * ENOENT versus EISDIR, a BOM surviving an editor, paths resolving relative to a manifest rather
 * than to the process — and a mocked `readFile` would happily confirm whatever the test author
 * already believed. Temporary directories are cheap; a mock that agrees with the bug is not.
 *
 * The load-bearing case is `partiallyLoadableTreeKeepsBothHalves`. Everything else here is the
 * ordinary discipline of not collapsing causes.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { canopySize, treeContaining } from "@foliage/canopy";
import { leafId } from "@foliage/leaf";

import {
  TREE_ENV,
  fabricationSignals,
  httpStatusFor,
  loadTreeDocument,
  parseTreeManifest,
} from "./treeDocument.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-tree-"));
  tmpRoots.push(dir);
  return dir;
}

/** A minimal but genuinely valid leaf document. */
function leafDoc(id: string, subject: string, leaflets: unknown[] = []): string {
  return JSON.stringify({ id, subject, leaflets }, null, 2);
}

const ONE_LEAFLET = [
  {
    id: "l1",
    title: "A real-shaped leaflet",
    tier: "pending",
    provenance: { source: "git", ref: "0f1e2d3c4b5a", observedAt: "2026-08-15T00:00:00Z" },
  },
];

/** Write a manifest plus its leaves, and return the manifest path. */
async function fixture(
  files: Readonly<Record<string, string>>,
  manifest: unknown,
): Promise<string> {
  const dir = await tempDir();
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  const path = join(dir, "tree.json");
  await writeFile(path, typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2));
  return path;
}

test("unconfiguredIsItsOwnCauseAndNeverAnEmptyTree", async () => {
  for (const env of [{}, { [TREE_ENV]: "   " }]) {
    const load = await loadTreeDocument(env);
    assert.equal(load.ok, false);
    assert.equal(load.ok === false && load.cause, "unconfigured");
    // The remedy is named. A cause with no next step is a shrug with a label on it.
    assert.match(load.ok === false ? load.detail : "", /FOLIAGE_TREE/);
    assert.equal(httpStatusFor(load), 200);
  }
});

test("absentManifestIs404AndNamesThePathItTried", async () => {
  const dir = await tempDir();
  const path = join(dir, "no-such-tree.json");
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, false);
  assert.equal(load.ok === false && load.cause, "absent");
  assert.equal(load.ok === false && load.path, path);
  // 404, NOT the leaf app's 200: a canopy pointed at a path that does not exist has been given
  // a bad address, and 200 would tell an uptime check that a dark tenant is healthy.
  assert.equal(httpStatusFor(load), 404);
});

test("aDirectoryIsUnreadableNotAbsent", async () => {
  const dir = await tempDir();
  const asDir = join(dir, "manifest-shaped-directory");
  await mkdir(asDir);
  const load = await loadTreeDocument({ [TREE_ENV]: asDir });
  assert.equal(load.ok, false);
  assert.equal(load.ok === false && load.cause, "unreadable");
  // The real errno is carried, not flattened. EISDIR and EACCES are different bugs and send an
  // operator to different places.
  assert.equal(load.ok === false && load.cause === "unreadable" && load.errno, "EISDIR");
  assert.equal(httpStatusFor(load), 500);
});

test("malformedAndInvalidAreDifferentCauses", async () => {
  const bad = await fixture({}, "{ not json");
  const malformed = await loadTreeDocument({ [TREE_ENV]: bad });
  assert.equal(malformed.ok === false && malformed.cause, "malformed");

  const wrong = await fixture({}, { company: "", leaves: "not-an-array" });
  const invalid = await loadTreeDocument({ [TREE_ENV]: wrong });
  assert.equal(invalid.ok === false && invalid.cause, "invalid");
  // The issue list travels, so the page can name every problem rather than the first.
  const issues = invalid.ok === false && invalid.cause === "invalid" ? invalid.issues : [];
  assert.ok(issues.length >= 2, `expected several issues, got ${issues.length}`);
  assert.ok(issues.some((i) => i.at === "id"));
  assert.ok(issues.some((i) => i.at === "leaves"));
  // The COUNT in the summary is exact even though the LIST is truncated, and says so.
  assert.match(invalid.ok === false ? invalid.detail : "", new RegExp(`${issues.length} problem`));
});

test("aBomDoesNotBecomeASyntaxError", async () => {
  const dir = await tempDir();
  const path = join(dir, "tree.json");
  await writeFile(path, "﻿" + JSON.stringify({ id: "t", company: "T", leaves: [] }));
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
});

test("aTreeWithNoLeavesIsValidAndEmptyNotAFailure", async () => {
  const path = await fixture({}, { id: "new-co", company: "Newly Incorporated", leaves: [] });
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
  if (!load.ok) return;
  // `Tree`'s own contract says a newly created tree legitimately has none. This is the sixth
  // state — valid, empty, and NOT to be reported as "no tree found".
  assert.equal(load.tree.leaves.length, 0);
  assert.equal(load.failures.length, 0);
  assert.deepEqual(canopySize({ trees: [load.tree] }), { trees: 1, leaves: 0 });
  assert.equal(httpStatusFor(load), 200);
});

test("omittingLeavesEntirelyIsNotTheSameStatementAsEmpty", async () => {
  const path = await fixture({}, { id: "t", company: "T" });
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, false);
  assert.equal(load.ok === false && load.cause, "invalid");
});

test("leafPathsResolveRelativeToTheManifestNotTheProcess", async () => {
  const path = await fixture(
    { "people/ada.leaf.json": leafDoc("ada", "Ada Lovelace", ONE_LEAFLET) },
    { id: "t", company: "T", leaves: ["people/ada.leaf.json"] },
  );
  // Deliberately run with a cwd that is NOT the manifest's directory. If resolution were
  // process-relative this would fail, and it would fail only on someone else's machine.
  const before = process.cwd();
  process.chdir(tmpdir());
  try {
    const load = await loadTreeDocument({ [TREE_ENV]: path });
    assert.equal(load.ok, true);
    assert.equal(load.ok && load.tree.leaves.length, 1);
    assert.equal(load.ok && load.tree.leaves[0]?.subject, "Ada Lovelace");
  } finally {
    process.chdir(before);
  }
});

/**
 * THE ONE THAT MATTERS.
 *
 * Four of five load. The tree must hold exactly the four, `canopySize` must say four, and the
 * fifth must still be present as a NAMED failure with its own cause. Any implementation that
 * throws away the fifth passes a naive "does it load?" test and ships a company of four.
 */
test("partiallyLoadableTreeKeepsBothHalves", async () => {
  const path = await fixture(
    {
      "a.leaf.json": leafDoc("a", "Ada", ONE_LEAFLET),
      "b.leaf.json": leafDoc("b", "Bea", ONE_LEAFLET),
      "c.leaf.json": "{ broken",
      "d.leaf.json": JSON.stringify({ id: "d", subject: "", leaflets: [] }),
      "e.leaf.json": leafDoc("e", "Eve"),
    },
    {
      id: "partial",
      company: "Partially Loadable",
      leaves: ["a.leaf.json", "b.leaf.json", "c.leaf.json", "d.leaf.json", "e.leaf.json", "gone.json"],
    },
  );

  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
  if (!load.ok) return;

  assert.deepEqual(
    load.tree.leaves.map((l) => l.subject),
    ["Ada", "Bea", "Eve"],
  );
  // The domain's own count, not `.length` — this is the number the page shows.
  assert.equal(canopySize({ trees: [load.tree] }).leaves, 3);

  // Three failures, three DISTINCT causes, each naming the manifest entry that produced it.
  assert.deepEqual(
    load.failures.map((f) => [f.entry, f.cause]),
    [
      ["c.leaf.json", "malformed"],
      ["d.leaf.json", "invalid"],
      ["gone.json", "absent"],
    ],
  );
  // Loaded + failed accounts for every entry the manifest named. Nothing vanished.
  assert.equal(load.tree.leaves.length + load.failures.length, load.manifest.leaves.length);
  // The `invalid` failure carries the domain's issue list through untouched.
  assert.ok((load.failures.find((f) => f.cause === "invalid")?.issues ?? []).length > 0);
  // leafSources stays index-aligned with the leaves that actually loaded.
  assert.equal(load.leafSources.length, load.tree.leaves.length);
});

test("aDuplicateLeafIdIsRefusedAndReportedRatherThanSilentlyMerged", async () => {
  const path = await fixture(
    {
      "one.leaf.json": leafDoc("same-id", "First Spelling", ONE_LEAFLET),
      "two.leaf.json": leafDoc("same-id", "Second Spelling", ONE_LEAFLET),
    },
    { id: "t", company: "T", leaves: ["one.leaf.json", "two.leaf.json"] },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
  if (!load.ok) return;

  assert.equal(load.tree.leaves.length, 1);
  assert.equal(load.tree.leaves[0]?.subject, "First Spelling");
  assert.equal(load.failures.length, 1);
  assert.equal(load.failures[0]?.cause, "duplicate");
  // The message points at the OTHER entry, so the fix is a two-file edit someone can actually make.
  assert.match(load.failures[0]?.detail ?? "", /one\.leaf\.json/);
  // And `treeContaining` — whose contract calls a second match a data defect — now has nothing
  // ambiguous to resolve, because the second entry never entered the tree.
  assert.equal(treeContaining({ trees: [load.tree] }, leafId("same-id"))?.id, load.tree.id);
});

test("fabricationSignalsAreIndependentAndBothReported", async () => {
  const manifestOnly = parseTreeManifest({ id: "t", company: "T", leaves: [], example: true });
  assert.equal(manifestOnly.ok, true);
  if (!manifestOnly.ok) return;

  // Manifest declares it; no leaves at all.
  assert.deepEqual(fabricationSignals(manifestOnly.manifest, []), [
    'the tree manifest declares "example": true',
  ]);

  // Leaves declare it; manifest does not. Either alone must fire — requiring both to agree
  // would let one stripped flag publish fabricated content as a real workplace.
  const clean = parseTreeManifest({ id: "t", company: "T", leaves: [] });
  assert.equal(clean.ok, true);
  if (!clean.ok) return;
  const signals = fabricationSignals(clean.manifest, [
    { path: "/x/a.json", bytes: 1, declaredExample: true },
    { path: "/x/b.json", bytes: 1, declaredExample: false },
  ]);
  assert.equal(signals.length, 1);
  assert.match(signals[0] ?? "", /1 of 2 leaf documents/);

  // Nothing suggests fabrication: empty, and empty means empty rather than "verified".
  assert.deepEqual(
    fabricationSignals(clean.manifest, [{ path: "/x/a.json", bytes: 1, declaredExample: false }]),
    [],
  );
});

test("aRealExampleLeafDocumentTripsTheSignalThroughTheFullLoad", async () => {
  const path = await fixture(
    { "ex.leaf.json": JSON.stringify({ id: "x", subject: "Illustration", leaflets: [], example: true }) },
    { id: "t", company: "T", leaves: ["ex.leaf.json"] },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
  if (!load.ok) return;
  assert.equal(load.leafSources[0]?.declaredExample, true);
  assert.equal(fabricationSignals(load.manifest, load.leafSources).length, 1);
});

test("unknownManifestKeysAreRefusedByName", async () => {
  const parsed = parseTreeManifest({
    id: "t",
    company: "T",
    leaves: [],
    headcount: 400,
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok === false && parsed.issues[0]?.at, "headcount");
});

/**
 * The RENAMED key, which is the one an existing manifest on somebody's disk will still carry.
 *
 * `organization` was this field's name while a Tree was believed to BE an organization. Under the
 * settled taxonomy a Tree is a company and "organization" names the bough level, so the old key is
 * a false name for this value and is refused rather than accepted as an alias — an alias would let
 * two spellings of one field drift apart, and this is an on-disk format other people write.
 *
 * The failure has to state BOTH facts, because either alone sends an operator somewhere useless:
 * "unknown key organization" without "company is missing" reads as "delete this line", and
 * "company is missing" without "unknown key organization" reads as "add a second name field".
 */
test("theRenamedOrganizationKeyIsRefusedByNameAndNotSilentlyIgnored", async () => {
  const parsed = parseTreeManifest({ id: "t", organization: "Northwind Instruments", leaves: [] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const at = parsed.issues.map((i) => i.at);
  assert.ok(at.includes("organization"), `the stale key was not named: ${at.join(", ")}`);
  assert.ok(at.includes("company"), `the required key was not reported missing: ${at.join(", ")}`);

  // And through a real load of a real file, because a manifest is a document on disk, not an
  // argument to a function. Silently ignoring the old key would have produced a tree whose
  // heading is empty — a page naming no one, about a company it could not name.
  const path = await fixture({}, { id: "t", organization: "Northwind Instruments", leaves: [] });
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, false);
  assert.equal(load.ok === false && load.cause, "invalid");
  assert.equal(httpStatusFor(load), 500);
});
