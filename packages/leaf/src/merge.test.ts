/**
 * Tests for the MERGE RULE — what a re-run of intake is allowed to do to a leaf that exists.
 *
 * The existing documents here are NOT hand-written object literals pretending to be results.
 * They are built the way real ones are: `commitsToLeaflets` produces the git rows, a
 * promotion row is appended in exactly the shape `apps/photosynthesis/src/promote.ts` writes,
 * and the whole thing goes through `parseLeafDocument` — the same gate the leaf server uses.
 * If any of those three changed shape, these tests stop compiling or stop parsing, which is
 * the point: a merge tested against a fixture of its own imagination proves nothing about the
 * file on disk.
 *
 * The case that motivates the whole file is `a promoted leaflet survives a re-run` — a
 * miniature of the measured failure: 59 leaflets with 2 promoted became 68 with 0.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseLeafDocument } from "./document.ts";
import { commitsToLeaflets, type ObservedCommit } from "./intake.ts";
import { leafId, leafletId, type Leaf, type Leaflet } from "./leaf.ts";
import { mergeIntakeIntoLeaf, type EstablishedDropCause, type LeafMerge } from "./merge.ts";

const ME = "me@example.com";
const SUBJECT = "Alex A";
const ID = leafId("alex-a");

/** A full-length SHA-1 object name built from a seed, so tests use well-formed shas. */
function sha(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

function commit(seed: string, subject: string): ObservedCommit {
  return {
    sha: sha(seed),
    authorEmail: ME,
    subject,
    signature: "N",
    // %GS: git bound nothing on an unsigned commit, and empty is that state's honest spelling.
    signer: "",
    signatureArmor: "none",
  };
}

/** Real intake output — the same call `apps/leaf/intake.mjs` makes. */
function derive(commits: readonly ObservedCommit[], observedAt: string): readonly Leaflet[] {
  const result = commitsToLeaflets({ commits, identities: [ME], observedAt });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.leaflets;
}

/**
 * The row `promote.ts` appends when a human clicks Approve. Copied from that module rather
 * than invented: source "photosynthesis", ref = the candidate's first evidence ref.
 */
function promotedRow(candidateId: string, title: string, evidenceSha: string) {
  return {
    id: `photosynthesis-${candidateId}`,
    title,
    tier: "pending",
    provenance: {
      source: "photosynthesis",
      ref: `git:${evidenceSha}`,
      observedAt: "2026-08-18T10:00:00Z",
    },
  };
}

/** Build the existing document the way the disk holds it, and parse it the way the server does. */
function existingLeaf(rows: readonly unknown[], over: { id?: string; subject?: string } = {}): Leaf {
  const parsed = parseLeafDocument({
    id: over.id ?? ID,
    subject: over.subject ?? SUBJECT,
    leaflets: JSON.parse(JSON.stringify(rows)),
  });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function merged(result: LeafMerge) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function refused(result: LeafMerge) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error("unreachable");
  return result.refusals;
}

const FIRST_RUN = "2026-08-18T09:00:00Z";
const SECOND_RUN = "2026-08-19T09:00:00Z";

test("a promoted leaflet survives a re-run — the measured 59/2 → 68/0 failure, in miniature", () => {
  const firstPass = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    FIRST_RUN,
  );
  // Two humans-clicked-Approve rows, appended after intake wrote the file.
  const leaf = existingLeaf([
    ...firstPass,
    promotedRow("cand-1", "Rebuilt the evidence intake path", sha("a")),
    promotedRow("cand-2", "Designed the proof-tier model", sha("b")),
  ]);
  assert.equal(leaf.leaflets.length, 4);

  // The refresh: same two commits, plus one new one.
  const secondPass = derive(
    [
      commit("a", "loop: a scheduler"),
      commit("b", "spec: the leaflet body"),
      commit("c", "ledger: intake --force"),
    ],
    SECOND_RUN,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: secondPass,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  const promoted = result.leaf.leaflets.filter((l) => l.provenance?.source === "photosynthesis");
  assert.equal(promoted.length, 2, "both approvals must still be in the document");
  assert.equal(result.carriedForward.length, 2);
  assert.deepEqual(
    result.carriedForward.map((c) => c.reason),
    ["foreign-source", "foreign-source"],
  );
  assert.deepEqual(result.carriedForward.map((c) => c.source), [
    "photosynthesis",
    "photosynthesis",
  ]);

  // And carried forward BYTE-IDENTICAL, not merely present with the same id.
  for (const row of leaf.leaflets.filter((l) => l.provenance?.source === "photosynthesis")) {
    const after = result.leaf.leaflets.find((l) => l.id === row.id);
    assert.deepEqual(after, row);
  }
});

test("a re-derived git leaflet stays IN PLACE, never duplicated", () => {
  const first = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const leaf = existingLeaf(first);
  const second = derive([commit("a", "loop: a scheduler")], SECOND_RUN);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(result.leaf.leaflets.length, 1, "one commit, one leaflet — not two");
  assert.equal(result.added.length, 0);
  // An ordinary re-run moves only observedAt, the instant of the read. That is not a change:
  // the row is kept with its first observation (QA 2026-10-02 #11).
  assert.equal(result.updated.length, 0);
  assert.equal(result.kept.length, 1);
  assert.equal(result.leaf.leaflets[0]?.provenance?.observedAt, FIRST_RUN);
});

test("a re-derivation identical in every field is KEPT, not reported as an update", () => {
  const first = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const leaf = existingLeaf(first);
  // Same instant: the run observed exactly what the file already said.
  const again = derive([commit("a", "loop: a scheduler")], FIRST_RUN);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: again,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0]?.reason, "re-derived-identical");
  assert.equal(result.updated.length, 0);
});

test("a tier change on re-derivation is named as such, not folded into a count", () => {
  const unsigned = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const leaf = existingLeaf(unsigned);
  assert.equal(leaf.leaflets[0]?.tier, "pending");

  // The operator configured gpg.ssh.allowedSignersFile between runs; git now reports G.
  const nowSigned = derive(
    [{ ...commit("a", "loop: a scheduler"), signature: "G", signer: ME, signatureArmor: "ssh" }],
    SECOND_RUN,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: nowSigned,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.deepEqual(result.updated[0]?.changed, ["provenance.observedAt", "tier"]);
  assert.equal(result.leaf.leaflets[0]?.tier, "verified");
});

test("CONTROL: a shared git leaflet's visibility and body survive a re-derivation that changes its tier", () => {
  const unsigned = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const shared = unsigned.map((l) => ({
    ...l,
    visibility: "public" as const,
    body: [{ provenance: l.provenance, text: "Wrote the scheduler loop." }],
  }));
  const leaf = existingLeaf(shared);
  assert.equal(leaf.leaflets[0]?.visibility, "public");
  assert.equal(leaf.leaflets[0]?.tier, "pending");

  // The operator configured gpg.ssh.allowedSignersFile between runs; git now reports G — the
  // same tier-changing re-derivation as the test above, only now the row is one a person shared.
  const nowSigned = derive(
    [{ ...commit("a", "loop: a scheduler"), signature: "G", signer: ME, signatureArmor: "ssh" }],
    SECOND_RUN,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: nowSigned,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  // Still reported exactly as an ordinary tier-changing update — the corpse report semantics
  // this file is not allowed to touch.
  assert.equal(result.updated.length, 1);
  assert.deepEqual(result.updated[0]?.changed, ["provenance.observedAt", "tier"]);
  assert.equal(result.leaf.leaflets[0]?.tier, "verified");
  // And the share decision and the body are still there — the thing this test exists to check.
  assert.equal(result.leaf.leaflets[0]?.visibility, "public");
  assert.deepEqual(result.leaf.leaflets[0]?.body, leaf.leaflets[0]?.body);
});

test("CONTROL: a git leaflet re-derived as excluded loses its visibility, and says so", () => {
  const derivedFirst = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const shared = derivedFirst.map((l) => ({ ...l, visibility: "public" as const }));
  const leaf = existingLeaf(shared);
  assert.equal(leaf.leaflets[0]?.visibility, "public");

  // The second run does not declare the author's identity at all — the commit is still there,
  // but this run cannot attribute it to the subject, so it re-derives as excluded.
  const excludedRun = commitsToLeaflets({
    commits: [commit("a", "loop: a scheduler")],
    identities: ["somebody-else@example.com"],
    observedAt: SECOND_RUN,
  });
  assert.equal(excludedRun.ok, true, JSON.stringify(excludedRun));
  if (!excludedRun.ok) throw new Error("unreachable");
  assert.equal(excludedRun.leaflets[0]?.tier, "excluded");

  const outcome = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: excludedRun.leaflets,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );
  assert.equal(outcome.leaf.leaflets[0]?.tier, "excluded");
  assert.equal(
    outcome.leaf.leaflets[0]?.visibility,
    undefined,
    "excluded is not this person's work — a public flag must not survive onto it",
  );
  assert.equal(outcome.updated.length, 1);
  assert.ok(
    outcome.updated[0]?.changed.includes("visibility"),
    "the drop is reported, so a person sees WHY a shared row went quiet: " +
      JSON.stringify(outcome.updated[0]?.changed),
  );
});

test("a git leaflet the run did not re-derive is reported with a cause and RETAINED", () => {
  const first = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    FIRST_RUN,
  );
  const leaf = existingLeaf(first);
  // The second run sees only one of them — a rebase, a different branch, a shallow clone.
  const second = derive([commit("a", "loop: a scheduler")], SECOND_RUN);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(result.wouldDrop.length, 1);
  assert.equal(result.wouldDrop[0]?.id, leafletId(`git:${sha("b")}`));
  // The honest floor: what was observed, not a diagnosis this function cannot make.
  assert.equal(result.wouldDrop[0]?.cause, "not-re-derived");
  assert.equal(result.wouldDrop[0]?.ref, sha("b"));
  assert.equal(result.wouldDrop[0]?.outcome, "retain");
  assert.equal(result.leaf.leaflets.length, 2, "retained by default — the rule never discards");
});

test("a cause the CALLER established is reported instead of the floor, and never inferred", () => {
  const first = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    FIRST_RUN,
  );
  const leaf = existingLeaf(first);
  const second = derive([commit("a", "loop: a scheduler")], SECOND_RUN);

  const established = new Map<ReturnType<typeof leafletId>, EstablishedDropCause>([
    [leafletId(`git:${sha("b")}`), "commit-unreachable"],
  ]);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
      establishedDropCauses: established,
    }),
  );

  assert.equal(result.wouldDrop[0]?.cause, "commit-unreachable");
});

test("discarding an un-derived leaflet still reports it by id — the caller decides, loudly", () => {
  const first = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    FIRST_RUN,
  );
  const leaf = existingLeaf(first);
  const second = derive([commit("a", "loop: a scheduler")], SECOND_RUN);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
      unDerived: "discard",
    }),
  );

  assert.equal(result.leaf.leaflets.length, 1);
  assert.equal(result.wouldDrop.length, 1, "dropped rows are reported, never silent");
  assert.equal(result.wouldDrop[0]?.outcome, "discard");
});

test("a leaflet with NO provenance is carried forward — a row that says nothing is not deletable", () => {
  const derived = derive([commit("a", "loop: a scheduler")], SECOND_RUN);
  const leaf = existingLeaf([
    { id: "hand-written-1", title: "Wrote the founding document", tier: "pending" },
  ]);

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(result.carriedForward.length, 1);
  assert.equal(result.carriedForward[0]?.reason, "no-provenance");
  assert.equal(result.carriedForward[0]?.source, null);
  assert.equal(result.leaf.leaflets.length, 2);
});

test("an EMPTY existing document and an EMPTY run are different results, not both zero", () => {
  const derived = derive([commit("a", "loop: a scheduler")], FIRST_RUN);

  const firstRun = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "absent" },
      derived,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );
  assert.equal(firstRun.added.length, 1);
  assert.equal(firstRun.added[0]?.reason, "new-this-run");
  assert.equal(firstRun.carriedForward.length, 0);
  assert.equal(firstRun.wouldDrop.length, 0);
  assert.equal(firstRun.leaf.leaflets.length, 1);

  // A document that exists and is empty is not the same as no document: nothing was carried,
  // nothing would drop, and nothing was added either.
  const emptyDocument = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf: existingLeaf([]) },
      derived: [],
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );
  assert.equal(emptyDocument.added.length, 0);
  assert.equal(emptyDocument.leaf.leaflets.length, 0);

  // And a run that derived nothing over a populated document drops nothing on the floor.
  const emptyRun = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf: existingLeaf(derived) },
      derived: [],
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );
  assert.equal(emptyRun.added.length, 0);
  assert.equal(emptyRun.wouldDrop.length, 1);
  assert.equal(emptyRun.leaf.leaflets.length, 1);
  assert.notDeepEqual(firstRun.added, emptyRun.added);
});

test("a leaf id mismatch refuses — that output path is somebody else's portfolio", () => {
  const leaf = existingLeaf(derive([commit("a", "loop: a scheduler")], FIRST_RUN), {
    id: "someone-else",
    subject: "Someone Else",
  });

  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: derive([commit("b", "spec: the leaflet body")], SECOND_RUN),
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  const causes = refusals.map((r) => r.cause).sort();
  assert.deepEqual(causes, ["leaf-id-mismatch", "subject-mismatch"]);
  // Both reported at once: fixing one problem per run is how a person runs a command five times.
  assert.equal(refusals.length, 2);
});

test("a subject mismatch alone refuses, and names both subjects", () => {
  const leaf = existingLeaf(derive([commit("a", "loop: a scheduler")], FIRST_RUN), {
    subject: "Alex Acker",
  });

  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: derive([commit("a", "loop: a scheduler")], SECOND_RUN),
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(refusals.length, 1);
  const only = refusals[0];
  assert.equal(only?.cause, "subject-mismatch");
  if (only?.cause !== "subject-mismatch") throw new Error("unreachable");
  assert.equal(only.existingSubject, "Alex Acker");
  assert.equal(only.incomingSubject, SUBJECT);
});

test("an unreadable existing document refuses and merges NOTHING — no fall-through to overwrite", () => {
  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "unreadable", detail: "EACCES: permission denied" },
      derived: derive([commit("a", "loop: a scheduler")], SECOND_RUN),
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(refusals.length, 1);
  const only = refusals[0];
  assert.equal(only?.cause, "existing-unreadable");
  if (only?.cause !== "existing-unreadable") throw new Error("unreachable");
  assert.equal(only.detail, "EACCES: permission denied");
});

test("an unparseable existing document refuses and carries the parser's own issues", () => {
  // A real parse failure from the real parser, not a hand-typed issue list.
  const parsed = parseLeafDocument({ id: "x", subject: "Alex A", leaflets: [{ score: 9 }] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) throw new Error("unreachable");

  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "unparseable", issues: parsed.issues },
      derived: derive([commit("a", "loop: a scheduler")], SECOND_RUN),
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(refusals.length, 1);
  const only = refusals[0];
  assert.equal(only?.cause, "existing-unparseable");
  if (only?.cause !== "existing-unparseable") throw new Error("unreachable");
  assert.equal(only.issues, parsed.issues);
});

test("derived leaflets that do not declare git provenance are refused, not applied", () => {
  // The footgun: hand the merge a promotion row and it would acquire authority over the very
  // rows the ownership rule protects.
  const impostor = existingLeaf([promotedRow("cand-1", "Approved by a human", sha("a"))]);
  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf: existingLeaf([]) },
      derived: impostor.leaflets,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]?.cause, "derived-not-git-sourced");
});

test("a derived id already held by a row this run does not own refuses, writing nothing", () => {
  const derived = derive([commit("a", "loop: a scheduler")], SECOND_RUN);
  const collidingId = derived[0]?.id;
  assert.ok(collidingId !== undefined);
  // The same id under a human's source. Impossible with today's id schemes, and the two rows
  // are a human's and a machine's wearing one name — either resolution discards something.
  const leaf = existingLeaf([
    {
      id: collidingId,
      title: "Approved by a human",
      tier: "pending",
      provenance: {
        source: "photosynthesis",
        ref: `git:${sha("a")}`,
        observedAt: "2026-08-18T10:00:00Z",
      },
    },
  ]);

  const refusals = refused(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]?.cause, "leaflet-id-claimed");
});

test("the outcome arrays partition the merged leaf exactly — every leaflet accounted for", () => {
  const first = derive(
    [
      commit("a", "loop: a scheduler"),
      commit("b", "spec: the leaflet body"),
      commit("c", "docs: the architecture"),
    ],
    FIRST_RUN,
  );
  const leaf = existingLeaf([
    ...first,
    promotedRow("cand-1", "Rebuilt the evidence intake path", sha("a")),
  ]);
  const second = derive(
    [
      // "a" unchanged in every field, "b" re-observed, "c" gone, "d" new.
      commit("a", "loop: a scheduler"),
      commit("b", "spec: the leaflet body"),
      commit("d", "ledger: intake --force"),
    ],
    FIRST_RUN,
  );
  // Force one of them to differ so kept and updated are both non-empty.
  const withChange = second.map((l) =>
    l.id === leafletId(`git:${sha("b")}`) ? { ...l, title: "spec: the leaflet body, cut" } : l,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: withChange,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.updated.length, 1);
  assert.deepEqual(result.updated[0]?.changed, ["title"]);
  assert.equal(result.carriedForward.length, 1);
  assert.equal(result.wouldDrop.length, 1);
  assert.equal(result.added.length, 1);

  const accounted = [
    ...result.added.map((e) => e.id),
    ...result.kept.map((e) => e.id),
    ...result.updated.map((e) => e.id),
    ...result.carriedForward.map((e) => e.id),
    ...result.wouldDrop.map((e) => e.id),
  ].sort();
  assert.deepEqual(
    accounted,
    [...result.leaf.leaflets.map((l) => l.id)].sort(),
    "every leaflet in the merged leaf is in exactly one outcome array, and vice versa",
  );
});

test("the existing document's order is preserved; new leaflets are appended", () => {
  const first = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    FIRST_RUN,
  );
  const leaf = existingLeaf([
    promotedRow("cand-1", "Approved first", sha("a")),
    ...first,
  ]);
  const second = derive(
    [
      commit("c", "ledger: intake --force"),
      commit("b", "spec: the leaflet body"),
      commit("a", "loop: a scheduler"),
    ],
    SECOND_RUN,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  assert.deepEqual(
    result.leaf.leaflets.map((l) => l.id),
    [
      leafletId("photosynthesis-cand-1"),
      leafletId(`git:${sha("a")}`),
      leafletId(`git:${sha("b")}`),
      leafletId(`git:${sha("c")}`),
    ],
    "a refresh that reshuffles the rows has changed the person's page",
  );
});

test("the merged leaf is a document the product can actually load", () => {
  const first = derive([commit("a", "loop: a scheduler")], FIRST_RUN);
  const leaf = existingLeaf([
    ...first,
    promotedRow("cand-1", "Rebuilt the evidence intake path", sha("a")),
  ]);
  const second = derive(
    [commit("a", "loop: a scheduler"), commit("b", "spec: the leaflet body")],
    SECOND_RUN,
  );

  const result = merged(
    mergeIntakeIntoLeaf({
      existing: { state: "present", leaf },
      derived: second,
      incomingId: ID,
      incomingSubject: SUBJECT,
    }),
  );

  // Round-trip through the same gate the leaf server uses. A merge that can produce a document
  // its own loader rejects is a merge nobody can trust.
  const reparsed = parseLeafDocument(JSON.parse(JSON.stringify(result.leaf)));
  assert.equal(reparsed.ok, true, JSON.stringify(reparsed));
  if (!reparsed.ok) throw new Error("unreachable");
  assert.equal(reparsed.leaf.leaflets.length, 3);
});
