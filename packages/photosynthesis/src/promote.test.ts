import { test } from "node:test";
import assert from "node:assert/strict";

import {
  commitsToLeaflets,
  leafletVisibility,
  parseLeafDocument,
  type Leaf,
  type ObservedCommit,
} from "@foliage/leaf";

import { parseHarvestDocument, type HarvestDocument } from "./harvestDocument.ts";
import { promoteApproved, provenanceIsPromotedHandle } from "./promote.ts";

/**
 * Every leaf and harvest in this file is a PARSER INPUT built to pin promotion behaviour —
 * none of it is rendered anywhere or presented as real evidence. Both inputs go through
 * their real gates first (`parseLeafDocument`, `parseHarvestDocument`), so promotion is
 * always tested against exactly the values the product would hand it.
 */

const instant = "2026-08-16T00:00:00Z";

function leafOf(leaflets: readonly Record<string, unknown>[]): Leaf {
  const parsed = parseLeafDocument({ id: "leaf-under-test", subject: "Parser Input", leaflets });
  assert.equal(parsed.ok, true, "test leaf must be valid");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function harvestOf(
  candidates: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): HarvestDocument {
  const parsed = parseHarvestDocument({ ...overrides, candidates });
  assert.equal(parsed.ok, true, "test harvest must be valid");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "git-cluster:parser-input",
    title: "parser input: 2 commits",
    evidence: [
      { source: "git", ref: "aaaa111", observedAt: instant },
      { source: "git", ref: "bbbb222", observedAt: instant },
    ],
    extractor: "git-cluster",
    draftedAt: instant,
    review: { state: "approved", by: "reviewer", at: instant },
    ...overrides,
  };
}

test("an approved candidate is appended as a pending leaflet with photosynthesis provenance", () => {
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.promoted, ["git-cluster:parser-input"]);
  assert.equal(result.leaf.leaflets.length, 1);
  const leaflet = result.leaf.leaflets[0]!;
  assert.equal(leaflet.tier, "pending");
  assert.equal(leaflet.title, "parser input: 2 commits");
  // The source names the mechanism AND the extractor; the ref is the PRIMARY evidence ref,
  // carrying its own observation time — never a freshly invented one.
  assert.deepEqual(leaflet.provenance, {
    source: "photosynthesis:git-cluster",
    ref: "aaaa111",
    observedAt: instant,
  });
});

test("a promoted leaflet's provenance is a handle on its first body element, not a second piece of evidence", () => {
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const leaflet = result.leaf.leaflets[0]!;
  // Promotion writes the primary ref twice on purpose; readers count it once.
  assert.equal(provenanceIsPromotedHandle(leaflet), true);
  // Another observation of the same ref is a second fact, and a git leaflet has no handle at all.
  const later = { ...leaflet, body: leaflet.body!.map((e) => ({ ...e, provenance: { ...e.provenance, observedAt: "2026-08-17T00:00:00Z" } })) };
  assert.equal(provenanceIsPromotedHandle(later), false);
  assert.equal(provenanceIsPromotedHandle({ provenance: { source: "git", ref: "aaaa111", observedAt: instant },
    body: [{ provenance: { source: "git", ref: "aaaa111", observedAt: instant } }] }), false);
  assert.equal(provenanceIsPromotedHandle({ provenance: leaflet.provenance! }), false, "no body, nothing repeated");
  assert.equal(provenanceIsPromotedHandle({ provenance: leaflet.provenance!, body: [null, "x", { provenance: null }] as never }), false,
    "an unreadable element is not a match and does not throw");
});

test("EVERY EVIDENCE REF CROSSES THE SEAM — the seven-refs-one-ref defect, pinned", () => {
  // Ledger row F9, measured on this repository 2026-08-19: the approved candidate
  // `git-cluster:cleanup` carried SEVEN evidence refs, promotion moved ONE, and the page
  // rendered "cleanup: 7 commits" above a single Ref cell. This is a parser input with the
  // same shape — seven refs — asserting the artifact can now substantiate the count it prints.
  const refs = ["c1a0001", "c2b0002", "c3c0003", "c4d0004", "c5e0005", "c6f0006", "c7a0007"];
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:parser-input-seven",
        title: "parser input: 7 commits",
        evidence: refs.map((ref) => ({ source: "git", ref, observedAt: instant })),
      }),
    ]),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const leaflet = result.leaf.leaflets[0]!;
  const body = leaflet.body!;
  assert.equal(body.length, 7, "all seven refs must reach the artifact, not one");
  assert.deepEqual(
    body.map((e) => e.provenance.ref),
    refs,
    "in the candidate's own order, unreordered and unrelabelled",
  );
  // Each element keeps the source that actually produced it — "git" — rather than inheriting
  // this module's own label. The leaflet's `provenance` is the one that names the mechanism.
  assert.ok(body.every((e) => e.provenance.source === "git"));
  assert.ok(body.every((e) => e.provenance.observedAt === instant));
  assert.equal(leaflet.provenance!.source, "photosynthesis:git-cluster");
  assert.equal(leaflet.provenance!.ref, "c1a0001");
});

test("NO PROSE IS INVENTED on a promoted body — refs travel, sentences do not", () => {
  // The approval covered the TITLE. Synthesising a sentence per ref here would be this module
  // fabricating claims nobody drafted, under the authority of that approval.
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.leaf.leaflets[0]!.body!;
  assert.equal(body.length, 2);
  assert.ok(
    body.every((e) => !("text" in e)),
    "an element with a ref and no words is the honest empty state",
  );
});

test("the tier stays PENDING however full the body is", () => {
  // More evidence is not a different KIND of proof. A person approved a machine's draft —
  // attributable, not verified — and a fuller body must never talk promotion into "verified".
  const result = promoteApproved(
    harvestOf([
      candidate({
        evidence: Array.from({ length: 5 }, (_, i) => ({
          source: "git",
          ref: `d${i}00000`,
          observedAt: instant,
        })),
      }),
    ]),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.leaf.leaflets[0]!.tier, "pending");
  assert.equal(result.leaf.leaflets[0]!.body!.length, 5);
});

test("A PROMOTED LEAFLET IS PRIVATE — approving a draft is not deciding to show it", () => {
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const leaflet = result.leaf.leaflets[0]!;
  assert.ok(!("visibility" in leaflet), "absence is how the safe default is expressed");
  assert.equal(leafletVisibility(leaflet), "private");
});

test("the promoted body survives the leaf gate verbatim, element for element", () => {
  // The round-trip that matters now that promotion writes a nested structure: the body is not
  // merely built, it is re-read by `parseLeafDocument` from serialized JSON with every
  // element-wise refusal armed.
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const reparsed = parseLeafDocument(
    JSON.parse(
      JSON.stringify({
        id: result.leaf.id,
        subject: result.leaf.subject,
        leaflets: result.leaf.leaflets,
      }),
    ),
  );
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.deepEqual(
    reparsed.leaf.leaflets[0]!.body!.map((e) => e.provenance.ref),
    ["aaaa111", "bbbb222"],
  );
});

test("only approved candidates promote — the others are skipped, counted, reasons carried", () => {
  const result = promoteApproved(
    harvestOf([
      candidate({ id: "unreviewed", review: { state: "candidate" } }),
      candidate({
        id: "rejected-one",
        review: { state: "rejected", by: "reviewer", at: instant, reason: "not their work" },
      }),
      candidate({ id: "approved-one" }),
    ]),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.promoted, ["approved-one"]);
  assert.deepEqual(
    result.skippedNotApproved.map((s) => s.id),
    ["unreviewed", "rejected-one"],
  );
  // The rejected candidate's recorded reason travels with the skip — a decision someone made
  // must not be flattened into a bare count.
  const rejected = result.skippedNotApproved[1]!;
  assert.match(rejected.reason, /rejected by reviewer/);
  assert.match(rejected.reason, /not their work/);
  const unreviewed = result.skippedNotApproved[0]!;
  assert.match(unreviewed.reason, /unreviewed/);
});

test("a candidate whose id collides with the target leaf is refused and reported, never dropped", () => {
  const result = promoteApproved(
    harvestOf([candidate({ id: "already-there" }), candidate({ id: "fresh-one" })]),
    leafOf([{ id: "already-there", title: "existing entry", tier: "pending" }]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.promoted, ["fresh-one"]);
  assert.deepEqual(
    result.refusedDuplicates.map((r) => r.id),
    ["already-there"],
  );
  assert.match(result.refusedDuplicates[0]!.reason, /already exists in the target leaf/);
  // The existing leaflet is untouched: same id, same original title.
  const existing = result.leaf.leaflets.find((l) => (l.id as string) === "already-there");
  assert.equal(existing?.title, "existing entry");
  assert.equal(result.leaf.leaflets.length, 2);
});

/* ------------------------------------------------------------------------- supersede ---- */

/**
 * THE CORPSE, owner decision 2026-09-06: measured on the owner's real garden, 15 of 31 cluster
 * leaflets were a stale 2026-08-22 generation, re-approved on 2026-08-29, and the leaf never
 * changed — `promoteApproved` refuses a duplicate id unconditionally, and there was no way to
 * say yes. These tests pin the fix's whole surface: refused by default (unchanged), refused
 * with permission when any ONE of the three named checks fails, and allowed only when all three
 * hold — preserving visibility and reporting the refs that moved.
 */

/** An existing leaflet that WOULD qualify for supersede — same extractor, same primary ref —
 * used as the base fixture every test below either grants permission over or withholds it from. */
function supersedableLeaflet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "already-there",
    title: "the 2026-08-22 generation",
    tier: "pending",
    visibility: "public",
    provenance: { source: "photosynthesis:git-cluster", ref: "aaaa111", observedAt: instant },
    body: [
      { provenance: { source: "git", ref: "aaaa111", observedAt: instant } },
      { provenance: { source: "git", ref: "cccc999", observedAt: instant } },
    ],
    ...overrides,
  };
}

/** A harvest bound to `leafOf`'s own fixture subject and id — `binding: "checked"` — so a test
 * that isolates one OTHER check does not accidentally fail on this one instead. */
function boundHarvestOf(candidates: readonly Record<string, unknown>[]): HarvestDocument {
  return harvestOf(candidates, { subject: "Parser Input", leafId: "leaf-under-test" });
}

test("SUPERSEDE, no permission given — refused, byte-for-byte today's reason, unchanged behaviour", () => {
  // The existing leaflet below qualifies for every named check; the only thing missing is a
  // "yes". That must refuse EXACTLY as it did before this parameter existed.
  const result = promoteApproved(
    boundHarvestOf([candidate({ id: "already-there" })]),
    leafOf([supersedableLeaflet()]),
    // permission omitted entirely — the default, and the behaviour every OTHER caller still gets.
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.refusedDuplicates.map((r) => r.id),
    ["already-there"],
  );
  assert.equal(
    result.refusedDuplicates[0]!.reason,
    `a leaflet with id "already-there" already exists in the target leaf. Appending it would ` +
      `be refused by the leaf gate, and replacing it would silently rewrite an existing entry ` +
      `— so it is refused and reported instead.`,
  );
  assert.deepEqual(result.superseded, []);
  const kept = result.leaf.leaflets.find((l) => (l.id as string) === "already-there");
  assert.equal(kept?.title, "the 2026-08-22 generation", "the existing leaflet is untouched");
});

test("SUPERSEDE, permission given but the harvest binding is unbound-legacy — refused, named", () => {
  const result = promoteApproved(
    harvestOf([candidate({ id: "already-there" })]), // no subject/leafId — unbound-legacy
    leafOf([supersedableLeaflet()]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding, "unbound-legacy");
  assert.deepEqual(
    result.refusedDuplicates.map((r) => r.id),
    ["already-there"],
  );
  assert.match(result.refusedDuplicates[0]!.reason, /target binding was never checked/);
  assert.deepEqual(result.superseded, []);
});

test("SUPERSEDE, permission given but the existing row is GIT-OWNED — refused, named", () => {
  const result = promoteApproved(
    boundHarvestOf([candidate({ id: "already-there" })]),
    // provenance.source "git" — a real commit row, never a photosynthesis draft.
    leafOf([
      supersedableLeaflet({
        provenance: { source: "git", ref: "aaaa111", observedAt: instant },
      }),
    ]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.refusedDuplicates.map((r) => r.id),
    ["already-there"],
  );
  assert.match(result.refusedDuplicates[0]!.reason, /was not produced by this extractor/);
  assert.match(result.refusedDuplicates[0]!.reason, /never superseded by a draft/);
  assert.deepEqual(result.superseded, []);
});

test("SUPERSEDE, permission given but the evidence refs disagree — refused, named", () => {
  const result = promoteApproved(
    boundHarvestOf([candidate({ id: "already-there" })]), // primary evidence ref "aaaa111"
    leafOf([
      supersedableLeaflet({
        provenance: { source: "photosynthesis:git-cluster", ref: "zzzz999", observedAt: instant },
      }),
    ]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.refusedDuplicates.map((r) => r.id),
    ["already-there"],
  );
  assert.match(result.refusedDuplicates[0]!.reason, /"zzzz999"/);
  assert.match(result.refusedDuplicates[0]!.reason, /"aaaa111"/);
  assert.match(result.refusedDuplicates[0]!.reason, /sharing an id prefix is not the same subject/);
  assert.deepEqual(result.superseded, []);
});

test("SUPERSEDE, permission given and all three checks hold — ALLOWED, visibility kept, refs reported", () => {
  const result = promoteApproved(
    boundHarvestOf([candidate({ id: "already-there" })]), // evidence: aaaa111, bbbb222
    leafOf([supersedableLeaflet()]), // provenance ref aaaa111, body refs aaaa111 + cccc999
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.refusedDuplicates, [], "nothing here is a refusal");
  assert.deepEqual(result.promoted, [], "a supersede is not a NEW leaflet — it does not count as promoted");
  assert.equal(result.superseded.length, 1);
  const s = result.superseded[0]!;
  assert.equal(s.id, "already-there");
  assert.equal(s.visibility, "public", "the existing leaflet's visibility is PRESERVED, never reset");
  assert.deepEqual(s.refsAdded, ["bbbb222"], "the new candidate's own ref, not in the old body");
  assert.deepEqual(s.refsRemoved, ["cccc999"], "the old body's ref, not in the new candidate");

  // The leaf itself: still ONE leaflet at this id — replaced IN PLACE, never appended a second
  // time — carrying the NEW title and the NEW body, and the OLD visibility.
  assert.equal(result.leaf.leaflets.length, 1);
  const replaced = result.leaf.leaflets[0]!;
  assert.equal(replaced.id as string, "already-there");
  assert.equal(replaced.title, "parser input: 2 commits", "the candidate's own title, not the old one");
  assert.equal(leafletVisibility(replaced), "public");
  assert.deepEqual(
    (replaced.body ?? []).map((e) => e.provenance.ref),
    ["aaaa111", "bbbb222"],
    "the new body, not the old one",
  );
});

/** The same qualifying leaflet, PRIVATE — spelled by the key's absence, as the leaf format does. */
function privateSupersedable(): Record<string, unknown> {
  const { visibility: _shared, ...rest } = supersedableLeaflet();
  return rest;
}

/**
 * THE SUBSET LINEAGE, measured 2026-09-28 on the owner's garden: 8 approved clusters had grown by
 * 18 commits since promotion, 6 of them with a newer primary ref. Each old leaflet's refs were all
 * still in the approved candidate — the work only gained evidence — and the primary-only rule
 * refused every one of the 6.
 */
test("SUPERSEDE, a different primary but a SUBSET lineage — ALLOWED, in place, private kept, refs added named", () => {
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        title: "the approved, larger body",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant }, // newer primary
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "cccc999", observedAt: instant },
        ],
      }),
    ]),
    leafOf([privateSupersedable()]), // refs aaaa111 + cccc999
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.refusedDuplicates, []);
  assert.deepEqual(result.superseded, [
    { id: "already-there", visibility: "private", refsAdded: ["eeee555"], refsRemoved: [] },
  ]);
  assert.equal(result.leaf.leaflets.length, 1, "replaced in place, never appended");
  const replaced = result.leaf.leaflets[0]!;
  assert.equal(replaced.title, "the approved, larger body");
  assert.equal(replaced.provenance?.ref, "eeee555");
  assert.equal("visibility" in replaced, false, "private stays spelled by absence");
  assert.deepEqual((replaced.body ?? []).map((e) => e.provenance.ref), ["eeee555", "aaaa111", "cccc999"]);
});

test("SUPERSEDE, a different primary and ONE removed ref — refused, the removed ref named", () => {
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant },
          { source: "git", ref: "aaaa111", observedAt: instant },
        ],
      }),
    ]),
    leafOf([supersedableLeaflet()]), // refs aaaa111 + cccc999; cccc999 is not in the candidate
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.deepEqual(result.refusedDuplicates.map((r) => r.id), ["already-there"]);
  assert.match(result.refusedDuplicates[0]!.reason, /cccc999/);
  assert.match(result.refusedDuplicates[0]!.reason, /sharing an id prefix is not the same subject/);
  const kept = result.leaf.leaflets[0]!;
  assert.equal(kept.title, "the 2026-08-22 generation", "refused — the old leaflet is untouched");
});

test("SUPERSEDE, a removed PROVENANCE ref counts too — every body ref kept is not enough", () => {
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant },
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "cccc999", observedAt: instant },
        ],
      }),
    ]),
    // body refs aaaa111 + cccc999 are both in the candidate; the provenance ref zzzz000 is not.
    leafOf([supersedableLeaflet({ provenance: { source: "photosynthesis:git-cluster", ref: "zzzz000", observedAt: instant } })]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.deepEqual(result.refusedDuplicates.map((r) => r.id), ["already-there"]);
  assert.match(result.refusedDuplicates[0]!.reason, /zzzz000/);
  const kept = result.leaf.leaflets[0]!;
  assert.equal(kept.title, "the 2026-08-22 generation", "refused — the old leaflet is untouched");
  assert.equal(kept.provenance?.ref, "zzzz000");
});

test("SUPERSEDE, a subset lineage WITHOUT permission — still a refused duplicate", () => {
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant },
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "cccc999", observedAt: instant },
        ],
      }),
    ]),
    leafOf([supersedableLeaflet()]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.match(result.refusedDuplicates[0]!.reason, /already exists in the target leaf/);
});

test("SUPERSEDE, a subset lineage from an UNBOUND harvest — still refused by the binding check", () => {
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant },
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "cccc999", observedAt: instant },
        ],
      }),
    ]),
    leafOf([supersedableLeaflet()]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.match(result.refusedDuplicates[0]!.reason, /target binding was never checked/);
});

test("SUPERSEDE, a subset lineage over a leaflet from ANOTHER extractor — still refused", () => {
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "eeee555", observedAt: instant },
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "cccc999", observedAt: instant },
        ],
      }),
    ]),
    leafOf([
      supersedableLeaflet({
        provenance: { source: "photosynthesis:local-model:gemma4:12b", ref: "aaaa111", observedAt: instant },
      }),
    ]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.match(result.refusedDuplicates[0]!.reason, /was not produced by this extractor/);
});

test("SUPERSEDE reports refsAdded/refsRemoved DEDUPED — a candidate citing the same new ref twice is +1, not +2", () => {
  // The parser enforces no ref-uniqueness within one evidence list (the same reason
  // `conflictsFor`'s own `seen` Set exists) — a candidate is free to cite "bbbb222" twice. The
  // count reported here reaches the person BEFORE they consent to the replacement, so it must
  // never overclaim: one genuinely new ref, cited twice, is one ref added.
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "aaaa111", observedAt: instant }, // shared with the old body
          { source: "git", ref: "bbbb222", observedAt: instant }, // new — cited TWICE
          { source: "git", ref: "bbbb222", observedAt: instant },
        ],
      }),
    ]),
    leafOf([supersedableLeaflet()]), // provenance ref aaaa111, body refs aaaa111 + cccc999
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.superseded.length, 1);
  const s = result.superseded[0]!;
  assert.deepEqual(s.refsAdded, ["bbbb222"], "one unique new ref, not one entry per citation");
  assert.deepEqual(s.refsRemoved, ["cccc999"], "the old body's ref, not in the new candidate");
});

test("SUPERSEDE still refuses on an evidence conflict — the excluded-ref invariant is not exempt", () => {
  // A permitted, otherwise-qualifying supersede whose candidate rests on a ref the target leaf
  // itself marks excluded must be refused exactly as a brand-new candidate would be — the
  // invariant "no pending leaflet in the result rests on an excluded ref" holds over the WHOLE
  // document, with no carve-out for a replacement a person said yes to.
  const result = promoteApproved(
    boundHarvestOf([
      candidate({
        id: "already-there",
        evidence: [
          { source: "git", ref: "aaaa111", observedAt: instant },
          { source: "git", ref: "dddd444", observedAt: instant },
        ],
      }),
    ]),
    leafOf([
      supersedableLeaflet(),
      {
        id: "someone-elses",
        title: "not this subject",
        tier: "excluded",
        reason: "could not be attributed to this subject",
        provenance: { source: "git", ref: "dddd444", observedAt: instant },
      },
    ]),
    new Set(["already-there"]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.superseded, []);
  assert.equal(result.refusedContradicted.length, 1);
  assert.equal(result.refusedContradicted[0]!.id, "already-there");
  const kept = result.leaf.leaflets.find((l) => (l.id as string) === "already-there");
  assert.equal(kept?.title, "the 2026-08-22 generation", "refused — the old leaflet is untouched");
});

test("zero approved candidates promotes nothing, honestly — and the leaf is unchanged", () => {
  const before = leafOf([{ id: "keep", title: "kept", tier: "pending" }]);
  const result = promoteApproved(
    harvestOf([candidate({ review: { state: "candidate" } })]),
    before,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.promoted, []);
  assert.equal(result.skippedNotApproved.length, 1);
  assert.equal(result.leaf.leaflets.length, 1);
  assert.equal(result.leaf.leaflets[0]!.title, "kept");
});

test("the input leaf is not mutated — promotion returns a NEW leaf", () => {
  const before = leafOf([]);
  const result = promoteApproved(harvestOf([candidate()]), before);
  assert.equal(result.ok, true);
  assert.equal(before.leaflets.length, 0, "the input leaf must be untouched");
});

/* ------------------------------------------------- the multi-author attribution refusal ---- */

/**
 * THE DEFECT THESE TESTS PIN, reproduced 2026-08-19 (D5): `harvest.mjs propose` clustered every
 * commit `git log` returned with no identity filter at all, and `promoteApproved` wrote
 * `tier: "pending"` over the whole cluster without ever asking the leaf it had been handed. On a
 * repository with two authors that promotes a leaflet whose tier means "attributed to one of this
 * person's declared identities" onto shas the SAME leaf marks `excluded` — "could not be
 * attributed to this subject". One document, two contradictory verdicts, about the same commits.
 *
 * THE LEAF BELOW IS BUILT BY THE PRODUCT'S OWN ATTRIBUTION RULE, not hand-written. The commits go
 * through `commitsToLeaflets` from `@foliage/leaf` — the same call `intake.mjs` makes — with ONE
 * identity declared, so the `excluded` leaflets and their reasons are the real ones a real
 * multi-author repository produces. Pinning this against a hand-built `tier: "excluded"` literal
 * would test promotion against a shape nothing in the product emits.
 *
 * The shas are parser inputs, like everything else in this file: full-length lowercase hex,
 * because `commitsToLeaflets` refuses anything that is not a resolvable object name, and an
 * abbreviated ref is indistinguishable from a fabricated one.
 */
const SUBJECT_IDENTITY = "subject@example.com";
const COLLEAGUE_IDENTITY = "colleague@example.com";

/** A full 40-hex object name from a short readable marker. */
const objectName = (marker: string): string => marker.padEnd(40, "0");

const SUBJECT_SHAS = [objectName("a1"), objectName("a2")];
const COLLEAGUE_SHAS = [objectName("b1"), objectName("b2")];

/** One commit exactly as git reports an ORDINARY UNSIGNED one: `%G?` of N, no gpgsig header. */
function observed(sha: string, authorEmail: string, subject: string): ObservedCommit {
  return { sha, authorEmail, subject, signature: "N", signer: "", signatureArmor: "none" };
}

/**
 * The leaf a two-author repository actually produces, through the real domain rule.
 *
 * Asserted here rather than assumed: two `pending` (the subject's own unsigned work) and two
 * `excluded` (the colleague's). If that ever stops holding, every test below is measuring
 * something other than what it claims to.
 */
function multiAuthorLeaf(): Leaf {
  const intake = commitsToLeaflets({
    commits: [
      observed(SUBJECT_SHAS[0]!, SUBJECT_IDENTITY, "cleanup: drop the dead adapter"),
      observed(SUBJECT_SHAS[1]!, SUBJECT_IDENTITY, "cleanup: remove the unused export"),
      observed(COLLEAGUE_SHAS[0]!, COLLEAGUE_IDENTITY, "cleanup: delete the old migration"),
      observed(COLLEAGUE_SHAS[1]!, COLLEAGUE_IDENTITY, "cleanup: retire the legacy client"),
    ],
    identities: [SUBJECT_IDENTITY],
    observedAt: instant,
  });
  assert.equal(intake.ok, true, "the attribution rule must accept these observations");
  if (!intake.ok) throw new Error("unreachable");
  assert.deepEqual(
    intake.leaflets.map((l) => l.tier),
    ["pending", "pending", "excluded", "excluded"],
    "this must be a genuinely multi-author shape: two attributed, two not",
  );
  const parsed = parseLeafDocument(
    JSON.parse(
      JSON.stringify({
        id: "leaf-under-test",
        subject: "Parser Input",
        leaflets: intake.leaflets,
      }),
    ),
  );
  assert.equal(parsed.ok, true, "the intaken leaf must pass its own gate");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

test("A CANDIDATE RESTING ON SOMEBODY ELSE'S COMMITS IS REFUSED — the attribution defect, pinned", () => {
  // Exactly what unfiltered clustering produced: one `cleanup:` prefix cluster spanning both
  // authors, approved by a reviewer who was shown a title reading "4 commits".
  const leaf = multiAuthorLeaf();
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:cleanup",
        title: "cleanup: 4 commits",
        evidence: [...SUBJECT_SHAS, ...COLLEAGUE_SHAS].map((ref) => ({
          source: "git",
          ref,
          observedAt: instant,
        })),
      }),
    ]),
    leaf,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.promoted, [], "nothing may cross on this evidence");
  assert.equal(result.refusedContradicted.length, 1);
  const refusal = result.refusedContradicted[0]!;
  assert.equal(refusal.id, "git-cluster:cleanup");
  // A NAMED cause a caller can branch on, not a sentence it has to match.
  assert.equal(refusal.cause, "evidence-excluded-by-target-leaf");
  // Every offending ref named — both of them — never a count.
  assert.deepEqual(
    refusal.conflicts.map((c) => c.ref),
    COLLEAGUE_SHAS,
  );
  // BOTH VERDICTS TRAVEL: this module's, and the leaf's own recorded reason for the same sha.
  assert.match(refusal.reason, /records as EXCLUDED/);
  for (const conflict of refusal.conflicts) {
    assert.match(conflict.leafReason, /could not be attributed to this subject/);
    assert.equal(conflict.leafletId, `git:${conflict.ref}`);
  }
  // And the leaf is exactly as it was: four leaflets, no new entry, nothing trimmed into one.
  assert.equal(result.leaf.leaflets.length, 4);
  assert.equal(
    result.leaf.leaflets.some((l) => (l.id as string) === "git-cluster:cleanup"),
    false,
  );
});

test("NO PENDING LEAFLET IN THE RESULT RESTS ON AN EXCLUDED REF — the invariant, stated directly", () => {
  // The property the defect violated, asserted over the whole document rather than over the one
  // refusal: a reader of this leaf must never find a ref it calls "not this person's" underneath
  // a leaflet whose tier says it is.
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:cleanup",
        title: "cleanup: 4 commits",
        evidence: [...SUBJECT_SHAS, ...COLLEAGUE_SHAS].map((ref) => ({
          source: "git",
          ref,
          observedAt: instant,
        })),
      }),
      candidate({
        id: "git-cluster:mine",
        title: "cleanup: 2 commits",
        evidence: SUBJECT_SHAS.map((ref) => ({ source: "git", ref, observedAt: instant })),
      }),
    ]),
    multiAuthorLeaf(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The clean candidate still promotes — the refusal is per-candidate, never a whole-run abort.
  assert.deepEqual(result.promoted, ["git-cluster:mine"]);
  const foreign = new Set(COLLEAGUE_SHAS);
  for (const leaflet of result.leaf.leaflets) {
    if (leaflet.tier === "excluded") continue;
    const refs = [
      ...(leaflet.provenance === undefined ? [] : [leaflet.provenance.ref]),
      ...(leaflet.body ?? []).map((e) => e.provenance.ref),
    ];
    for (const ref of refs) {
      assert.equal(foreign.has(ref), false, `${leaflet.id} rests on an excluded ref: ${ref}`);
    }
  }
});

test("ONE foreign ref among many refuses the WHOLE candidate — it is never silently trimmed", () => {
  // Trimming would leave the approved title "cleanup: 3 commits" standing over two refs. The
  // reviewer approved a claim over a list, and a deterministic title is a COUNT of that list, so
  // a quietly shorter body makes the title's own number false.
  const evidence = [SUBJECT_SHAS[0]!, SUBJECT_SHAS[1]!, COLLEAGUE_SHAS[0]!];
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:cleanup",
        title: "cleanup: 3 commits",
        evidence: evidence.map((ref) => ({ source: "git", ref, observedAt: instant })),
      }),
    ]),
    multiAuthorLeaf(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.promoted, []);
  assert.equal(result.refusedContradicted.length, 1);
  assert.equal(result.refusedContradicted[0]!.conflicts.length, 1);
  // The reason states BOTH numbers, so the operator sees how much of the cluster was theirs.
  assert.match(result.refusedContradicted[0]!.reason, /1 of this candidate's 3 evidence ref\(s\)/);
  assert.equal(result.leaf.leaflets.length, 4, "and nothing was appended");
});

test("SILENCE IS NOT A VERDICT — a ref the leaf says nothing about is not a conflict", () => {
  // The refusal keys on a RECORDED `excluded`, never on absence. A leaf read from another
  // repository, or read before a commit existed, holds no opinion about that sha — and inventing
  // an exclusion from silence would be the same overclaim wearing the opposite hat.
  const unknown = objectName("c1");
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:unseen",
        evidence: [{ source: "git", ref: unknown, observedAt: instant }],
      }),
    ]),
    multiAuthorLeaf(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.promoted, ["git-cluster:unseen"]);
  assert.deepEqual(result.refusedContradicted, []);
});

test("an excluded leaflet's BODY refs refuse too, not only its primary provenance", () => {
  // A previously promoted leaflet can carry seven refs in its body. If only the primary were
  // indexed, the same fabrication would walk back in through the other six.
  const buried = objectName("d1");
  const leaf = leafOf([
    {
      id: "someone-elses-cluster",
      title: "work by another author",
      tier: "excluded",
      reason: "could not be attributed to this subject: a different author identity",
      provenance: { source: "git", ref: objectName("d0"), observedAt: instant },
      body: [{ provenance: { source: "git", ref: buried, observedAt: instant } }],
    },
  ]);
  const result = promoteApproved(
    harvestOf([
      candidate({
        id: "git-cluster:buried",
        evidence: [
          { source: "git", ref: objectName("e1"), observedAt: instant },
          { source: "git", ref: buried, observedAt: instant },
        ],
      }),
    ]),
    leaf,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.promoted, []);
  assert.deepEqual(
    result.refusedContradicted[0]!.conflicts.map((c) => c.ref),
    [buried],
  );
  assert.equal(result.refusedContradicted[0]!.conflicts[0]!.leafletId, "someone-elses-cluster");
});

test("a clean leaf refuses nothing — the check costs the ordinary path nothing", () => {
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.refusedContradicted, []);
  assert.deepEqual(result.promoted, ["git-cluster:parser-input"]);
});

test("ROUND-TRIP PROVEN: the promoted leaf re-serializes into a document the leaf gate accepts", () => {
  const result = promoteApproved(
    harvestOf([candidate()]),
    leafOf([
      { id: "v", title: "verified entry", tier: "verified", provenance: { source: "git", ref: "cccc333", observedAt: instant } },
      { id: "e", title: "excluded entry", tier: "excluded", reason: "different author identity" },
    ]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // promoteApproved validates internally; this asserts the same fact FROM THE OUTSIDE, the
  // way the CLI and the server will actually exercise it: serialize, re-parse, accepted.
  const reparsed = parseLeafDocument(
    JSON.parse(
      JSON.stringify({ id: result.leaf.id, subject: result.leaf.subject, leaflets: result.leaf.leaflets }),
    ),
  );
  assert.equal(reparsed.ok, true, "the promoted leaf must pass parseLeafDocument verbatim");
  if (!reparsed.ok) return;
  assert.equal(reparsed.leaf.leaflets.length, 3);
  assert.ok(Object.isFrozen(result.leaf));
});

test("THE LIFT: an evidence excerpt becomes that element's text — copied by ref, never composed", () => {
  const result = promoteApproved(
    harvestOf([
      candidate({
        evidence: [
          { source: "git", ref: "aaaa111", observedAt: instant, excerpt: "feat: the reviewer saw these words" },
          { source: "git", ref: "bbbb222", observedAt: instant },
        ],
      }),
    ]),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.leaf.leaflets[0]!.body!;
  assert.equal(body.length, 2);
  // The excerpt crossed as text, on ITS element, verbatim.
  assert.equal(body[0]!.text, "feat: the reviewer saw these words");
  // The bare ref stays bare — no text KEY at all, because a present-but-undefined key is a
  // different document once serialized.
  assert.equal("text" in body[1]!, false);
  // And the excerpt did NOT survive on the provenance: the leaf gate's PROVENANCE_KEYS would
  // refuse it, and the strongest form of that assertion is the gate itself, below.
  assert.equal("excerpt" in body[0]!.provenance, false);
});

test("a promoted leaf carrying lifted text still passes the leaf gate whole", () => {
  const result = promoteApproved(
    harvestOf([
      candidate({
        evidence: [{ source: "git", ref: "aaaa111", observedAt: instant, excerpt: "docs: words a person approved" }],
      }),
    ]),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Round-trip the WHOLE promoted document through the gate that guards what a leaf may hold.
  const reparsed = parseLeafDocument(JSON.parse(JSON.stringify({
    id: result.leaf.id,
    subject: result.leaf.subject,
    leaflets: result.leaf.leaflets,
  })));
  assert.equal(reparsed.ok, true, JSON.stringify(!reparsed.ok && reparsed.issues));
});

test("the subject's headline survives promotion — the clobber class, pinned at this seam too", () => {
  const withHeadline = parseLeafDocument({
    id: "leaf-under-test",
    subject: "Parser Input",
    headline: "Systems engineer; the one line only I may write.",
    leaflets: [],
  });
  assert.equal(withHeadline.ok, true, "fixture leaf must be valid");
  if (!withHeadline.ok) return;
  const result = promoteApproved(harvestOf([candidate()]), withHeadline.leaf);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.leaf.headline,
    "Systems engineer; the one line only I may write.",
    "promotion rebuilt the document and deleted the authored headline",
  );
  assert.equal(result.leaf.leaflets.length, 1, "and the promotion itself still happened");
});

/* --------------------------------------------------------------- the target binding, F-014 ---- */

/**
 * `promoteApproved` had no way to tell whose harvest it was promoting: pointing `--into` at the
 * wrong person's leaf spliced subject B's approved candidates into subject A's leaf with exit 0.
 * These four tests pin the fix's whole surface — a mismatch on either field refuses the WHOLE
 * run before any candidate is touched, a match promotes exactly as before, and a document that
 * predates the binding (or was proposed with no target at all) still promotes, WITH the caveat
 * stated rather than silently treated as verified.
 */

test("F-014: a harvest bound to a DIFFERENT subject refuses the whole promotion, both names shown", () => {
  const result = promoteApproved(
    harvestOf([candidate()], { subject: "Bob" }),
    leafOf([]), // leafOf's fixture subject is "Parser Input"
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "binding-mismatch");
  assert.equal(result.mismatches.length, 1);
  const mismatch = result.mismatches[0]!;
  assert.equal(mismatch.field, "subject");
  assert.equal(mismatch.harvestValue, "Bob");
  assert.equal(mismatch.leafValue, "Parser Input");
  assert.match(mismatch.message, /Bob/);
  assert.match(mismatch.message, /Parser Input/);
});

test("F-014: a harvest bound to a DIFFERENT leaf id refuses the whole promotion, both ids shown", () => {
  const result = promoteApproved(
    harvestOf([candidate()], { leafId: "leaf-somebody-else" }),
    leafOf([]), // leafOf's fixture id is "leaf-under-test"
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "binding-mismatch");
  assert.equal(result.mismatches.length, 1);
  const mismatch = result.mismatches[0]!;
  assert.equal(mismatch.field, "leafId");
  assert.equal(mismatch.harvestValue, "leaf-somebody-else");
  assert.equal(mismatch.leafValue, "leaf-under-test");
});

test("F-014: BOTH fields mismatching are BOTH named — never collapsed to one", () => {
  const result = promoteApproved(
    harvestOf([candidate()], { subject: "Bob", leafId: "leaf-somebody-else" }),
    leafOf([]),
  );
  assert.equal(result.ok, false);
  if (result.ok || result.cause !== "binding-mismatch") return;
  assert.deepEqual(
    result.mismatches.map((m) => m.field).sort(),
    ["leafId", "subject"],
  );
});

test("F-014: a candidate is never promoted on a binding mismatch — the leaf is unchanged, nothing appended", () => {
  const before = leafOf([{ id: "keep", title: "kept", tier: "pending" }]);
  const result = promoteApproved(harvestOf([candidate()], { subject: "Bob" }), before);
  assert.equal(result.ok, false);
  // Nothing about the ORIGINAL leaf can have changed — promoteApproved never mutates its input.
  assert.equal(before.leaflets.length, 1);
  assert.equal(before.leaflets[0]!.title, "kept");
});

test("F-014: a harvest bound to the SAME subject AND leaf id promotes normally, reported as binding: checked", () => {
  const result = promoteApproved(
    harvestOf([candidate()], { subject: "Parser Input", leafId: "leaf-under-test" }),
    leafOf([]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding, "checked");
  assert.deepEqual(result.promoted, ["git-cluster:parser-input"]);
});

test("F-014: a harvest bound on ONLY the subject (no leafId) still checks and promotes when it matches", () => {
  const result = promoteApproved(harvestOf([candidate()], { subject: "Parser Input" }), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding, "checked");
  assert.deepEqual(result.promoted, ["git-cluster:parser-input"]);
});

test("F-014: a harvest carrying NO binding at all — the pre-fix shape — still promotes, reported as binding: unbound-legacy", () => {
  // harvestOf with no overrides is exactly what every OTHER test in this file already builds:
  // the shape every harvest document written before this fix (or proposed with no --into) has.
  const result = promoteApproved(harvestOf([candidate()]), leafOf([]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.binding,
    "unbound-legacy",
    "absence must be reported, never silently treated as a verified match",
  );
  assert.deepEqual(result.promoted, ["git-cluster:parser-input"]);
});
