import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLeafDocument, type Leaf } from "@foliage/leaf";

import {
  BRAIN_NODE_EXTRACTOR,
  BRAIN_SOURCE,
  BRAIN_THIRD_PARTY_SOURCE,
  brainNotesToCandidates,
  brainPageKind,
  partitionRetrieved,
  type DraftedLeaflet,
  type RetrievedNode,
  type ShownPageInput,
} from "./brainIntake.ts";
import { photosToCandidates } from "./photoIntake.ts";
import { promoteApproved } from "./promote.ts";
import { parseHarvestDocument } from "./harvestDocument.ts";

/**
 * Every value in this file is a FUNCTION INPUT built to pin one decision. Nothing here was read
 * out of anybody's knowledge base, no line below was written by a model, and a passing suite
 * says the rules hold — not that any page was ever retrieved. The app half
 * (`apps/leaf/src/brainSource.test.ts`) is where a real index is read off disk and a real
 * request goes out over loopback; this module has no I/O to test, which is exactly why the
 * judgement lives in it.
 *
 * The paths below are invented paths under /tmp, chosen to be readable, and so are the character
 * counts. That is fine here for the same reason the literal digests in `photoIntake.test.ts` are:
 * what this module can be wrong about is what a path MEANS, what is done with a drafter's
 * citation, and what it records about a pack — not whether a file is there or how long it is.
 * Whether the paths resolve and the counts were really measured is `brainSource.test.ts`'s
 * question, and it answers it against real files on disk.
 */

const instant = "2026-08-17T00:00:00Z";

function node(overrides: Partial<RetrievedNode> = {}): RetrievedNode {
  return {
    id: "brain:projects/billing-migration",
    path: "/tmp/knowledge/projects/billing-migration.md",
    relPath: "projects/billing-migration",
    observedAt: instant,
    ...overrides,
  };
}

/** The whole of every offered page went in front of the drafter — the ordinary case. */
function shownWhole(pages: readonly RetrievedNode[]): readonly ShownPageInput[] {
  return pages.map((n) => ({ node: n, charsShown: 1_200, charsInPage: 1_200 }));
}

const colleagueNote = node({
  id: "brain:meetings/2026-05-vendor-review",
  path: "/tmp/knowledge/meetings/2026-05-vendor-review.md",
  relPath: "meetings/2026-05-vendor-review",
});

function draft(overrides: Partial<DraftedLeaflet> = {}): DraftedLeaflet {
  return {
    drafter: "local-model:gemma4:12b",
    title: "Led the billing migration off the legacy processor",
    citedPaths: ["/tmp/knowledge/projects/billing-migration.md"],
    ...overrides,
  };
}

function ok(request: Parameters<typeof brainNotesToCandidates>[0]) {
  const result = brainNotesToCandidates(request);
  assert.equal(result.ok, true, "expected the retrieval to be usable");
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** The ordinary deterministic call: these pages, no drafter, nothing withheld. */
function deterministic(pages: readonly RetrievedNode[]) {
  return ok({ offered: pages, withheld: [], drafts: null, shown: null, draftedAt: instant });
}

/** The ordinary drafted call: these pages were shown whole, these leaflets came back. */
function drafted(
  pages: readonly RetrievedNode[],
  drafts: readonly DraftedLeaflet[],
  withheld: Parameters<typeof brainNotesToCandidates>[0]["withheld"] = [],
  shown: readonly ShownPageInput[] = shownWhole(pages),
) {
  return ok({ offered: pages, withheld, drafts, shown, draftedAt: instant });
}

test("with no drafter, a retrieved page becomes a candidate stating only where it is", () => {
  const result = deterministic([node()]);

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  assert.equal(
    candidate.title,
    "projects/billing-migration — knowledge-base page, no claim drafted",
  );
  assert.equal(candidate.extractor, BRAIN_NODE_EXTRACTOR);
  assert.equal(candidate.review.state, "candidate");
  assert.equal(candidate.id, `${BRAIN_SOURCE}:brain:projects/billing-migration`);
  // The REF is the path, because a reviewer has to be able to open the page a claim rests on.
  assert.deepEqual(candidate.evidence, [
    {
      source: BRAIN_SOURCE,
      ref: "/tmp/knowledge/projects/billing-migration.md",
      observedAt: instant,
    },
  ]);
  assert.equal(result.undrafted.length, 1);
  assert.match(result.undrafted[0]!.reason, /no drafter ran/);
});

test("no drafter means no note content in the document — only the path travels", () => {
  // The domain is never handed a page's body, and this pins the consequence at the OUTPUT: the
  // whole serialized candidate is the path, the fixed phrase, and the machinery. Anything a
  // page happens to say about a colleague cannot reach a file the operator will hand around,
  // because it was never in the document to begin with.
  const serialized = JSON.stringify(deterministic([node()]).candidates);

  assert.match(serialized, /projects\/billing-migration/);
  assert.match(serialized, /no claim drafted/);
  // The absolute path appears exactly once — as the ref — and never inside the title.
  assert.equal(serialized.split("/tmp/knowledge/projects/billing-migration.md").length - 1, 1);
  assert.doesNotMatch(
    deterministic([node()]).candidates[0]!.title,
    /\/tmp\/knowledge/,
    "the title states the in-knowledge-base path, never the absolute one — a title is prose " +
      "this product may publish, and the absolute path names the operator's home directory",
  );
});

test("a drafted line becomes the title and is credited to the drafter that wrote it", () => {
  const result = drafted([node()], [draft()]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.title, "Led the billing migration off the legacy processor");
  assert.equal(result.candidates[0]!.extractor, "local-model:gemma4:12b");
  assert.deepEqual(result.undrafted, []);
  assert.deepEqual(result.refusals, []);
});

test("a citation to a page the drafter was NOT given is refused WHOLE and reported", () => {
  // THE FABRICATION VECTOR THAT MATTERS MOST HERE. Retrieval is deterministic, so every claim
  // is traceable to a page — unless the drafter invents a path, at which point the audit trail
  // points at nothing. Both refs go: a drafter that cited a page it never saw has told you its
  // other citations are guesses too.
  const result = drafted(
    [node()],
    [
      draft({
        citedPaths: [
          "/tmp/knowledge/projects/billing-migration.md",
          "/tmp/knowledge/projects/never-retrieved.md",
        ],
      }),
    ],
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0]!.cause, "cited-a-source-it-was-not-given");
  assert.match(result.refusals[0]!.reason, /never-retrieved\.md/);
  assert.equal(result.refusals[0]!.title, "Led the billing migration off the legacy processor");
});

test("a citation to a WITHHELD page is a different cause, and names the flag that would allow it", () => {
  const { offered, withheld } = partitionRetrieved([node(), colleagueNote], false);
  const result = drafted(
    offered,
    [draft({ citedPaths: ["/tmp/knowledge/meetings/2026-05-vendor-review.md"] })],
    withheld,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0]!.cause, "cited-a-withheld-page");
  assert.match(result.refusals[0]!.reason, /--include-third-party/);
});

test("a path says only what a path can say", () => {
  assert.equal(brainPageKind("people/dana-whitfield"), "third-party-shaped");
  assert.equal(brainPageKind("companies/acme"), "third-party-shaped");
  assert.equal(brainPageKind("deals/acme-series-b"), "third-party-shaped");
  assert.equal(brainPageKind("meetings/2026-05-vendor-review"), "third-party-shaped");
  assert.equal(brainPageKind("Meetings/2026-05-vendor-review"), "third-party-shaped");
  assert.equal(brainPageKind("meetings\\2026-05-vendor-review"), "third-party-shaped");
  assert.equal(brainPageKind("/meetings/2026-05-vendor-review"), "third-party-shaped");
  // `unclassified` is NOT a clean bill of health: this page can name six colleagues and the
  // path cannot tell you. It means the path said nothing.
  assert.equal(brainPageKind("projects/billing-migration"), "unclassified");
  assert.equal(brainPageKind("SOUL"), "unclassified");
  assert.equal(brainPageKind(""), "unclassified");
});

test("third-party-shaped pages are withheld by default, named, never dropped", () => {
  const { offered, withheld } = partitionRetrieved([node(), colleagueNote], false);

  assert.deepEqual(
    offered.map((n) => n.relPath),
    ["projects/billing-migration"],
  );
  assert.equal(withheld.length, 1);
  assert.equal(withheld[0]!.node.relPath, "meetings/2026-05-vendor-review");
  assert.match(withheld[0]!.reason, /NOT shown to the drafter/);
  assert.match(withheld[0]!.reason, /--include-third-party/);
});

test("when the operator includes them, every ref off one says so inside the document", () => {
  const { offered, withheld } = partitionRetrieved([node(), colleagueNote], true);
  assert.deepEqual(withheld, []);

  const result = drafted(
    offered,
    [
      draft({
        citedPaths: [
          "/tmp/knowledge/projects/billing-migration.md",
          "/tmp/knowledge/meetings/2026-05-vendor-review.md",
        ],
      }),
    ],
    withheld,
  );

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    result.candidates[0]!.evidence.map((e) => e.source),
    [BRAIN_SOURCE, BRAIN_THIRD_PARTY_SOURCE],
  );
  // And it is reported OUT as well as marked in, because a mark inside a JSON file is not a
  // warning — the CLI has to be able to say it out loud, at propose time and again at review.
  assert.deepEqual(result.thirdPartyExposure, [
    {
      id: result.candidates[0]!.id,
      pages: ["meetings/2026-05-vendor-review"],
    },
  ]);
  // NOTHING WAS REWRITTEN: the page is cited exactly as it is, under its own path.
  assert.equal(
    result.candidates[0]!.evidence[1]!.ref,
    "/tmp/knowledge/meetings/2026-05-vendor-review.md",
  );
});

test("REGRESSION: a third party in the PACK is reported even when no ref is one", () => {
  // THE DEFECT, IN THE SHAPE IT REALLY OCCURRED. Under --include-third-party the drafter is shown
  // every offered page in ONE prompt. The real gemma4:12b, shown a page under `projects/` that
  // named a client and two individuals, produced a title naming that client and cited the
  // `projects/` page — whose PATH says nothing. Every ref came out plain "brain-note", the cited
  // exposure register was empty, and review printed no caution at all. The register below is what
  // makes that run visible: the page was IN THE PACK, and that is the condition under which a
  // name can travel.
  const { offered, withheld } = partitionRetrieved([node(), colleagueNote], true);
  const result = drafted(
    offered,
    // Cites ONLY the operator's own project page — exactly as the real run did.
    [draft({ citedPaths: ["/tmp/knowledge/projects/billing-migration.md"] })],
    withheld,
  );

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  // The old signal is silent here, and that is not a bug in it — it answers a different question.
  assert.deepEqual(
    candidate.evidence.map((e) => e.source),
    [BRAIN_SOURCE],
  );
  assert.deepEqual(result.thirdPartyExposure, []);
  // The new one is not silent.
  assert.deepEqual(result.thirdPartyShown, ["meetings/2026-05-vendor-review"]);
  // And the document itself carries the pack, so review can say it days later without the
  // propose-time stdout that has long since scrolled away.
  assert.deepEqual(candidate.shownPages, [
    {
      page: "/tmp/knowledge/projects/billing-migration.md",
      kind: "unclassified",
      charsShown: 1_200,
      charsInPage: 1_200,
    },
    {
      page: "/tmp/knowledge/meetings/2026-05-vendor-review.md",
      kind: "third-party-shaped",
      charsShown: 1_200,
      charsInPage: 1_200,
    },
  ]);
});

test("the pack records how much of each page the model actually saw", () => {
  // A claim drafted off the first 12,000 characters is still cited to the WHOLE page. That was
  // printed once at propose time and recorded nowhere, so review could not repeat it.
  const result = drafted([node()], [draft()], [], [
    { node: node(), charsShown: 12_000, charsInPage: 41_309 },
  ]);

  assert.deepEqual(result.candidates[0]!.shownPages, [
    {
      page: "/tmp/knowledge/projects/billing-migration.md",
      kind: "unclassified",
      charsShown: 12_000,
      charsInPage: 41_309,
    },
  ]);
});

test("a title no drafter wrote carries no pack, in either way it can happen", () => {
  // The pack says "a model read these pages and then wrote this line". A deterministic title is
  // the page's path, and a rating-refused draft's line was thrown away — no model prose is in
  // either, so there is nothing for a name to have travelled in and nothing to warn about.
  // Recording a pack on one of these would put a model's reading behind a line it did not write.
  assert.equal(deterministic([node()]).candidates[0]!.shownPages, undefined);

  const refused = drafted([node()], [draft({ title: "Shipped the migration — a 9/10 quarter" })]);
  assert.equal(refused.candidates.length, 1);
  assert.equal(refused.candidates[0]!.extractor, BRAIN_NODE_EXTRACTOR);
  assert.equal(refused.candidates[0]!.shownPages, undefined);
});

test("each evidence ref carries the instant ITS OWN page was confirmed at", () => {
  // Not one run-level stamp copied onto every ref. Two pages confirmed at two moments produce two
  // instants, because that is what was measured — see the header: an index lists pages that may
  // no longer be on disk, so the instant a ref names has to be the one somebody looked at.
  const first = node({ observedAt: "2026-08-17T00:00:01Z" });
  const second = node({
    id: "brain:projects/search-reindex",
    path: "/tmp/knowledge/projects/search-reindex.md",
    relPath: "projects/search-reindex",
    observedAt: "2026-08-17T00:00:02Z",
  });
  const result = ok({
    offered: [first, second],
    withheld: [],
    drafts: [draft({ citedPaths: [first.path, second.path] })],
    shown: shownWhole([first, second]),
    draftedAt: "2026-08-17T00:00:05Z",
  });

  assert.deepEqual(
    result.candidates[0]!.evidence.map((e) => e.observedAt),
    ["2026-08-17T00:00:01Z", "2026-08-17T00:00:02Z"],
  );
  // The run's own instant is the drafting time, and it is a different fact from either.
  assert.equal(result.candidates[0]!.draftedAt, "2026-08-17T00:00:05Z");
});

test("a draft with no citations is refused rather than recorded unsourced", () => {
  const result = drafted([node()], [draft({ citedPaths: null })]);

  assert.deepEqual(result.candidates, []);
  assert.equal(result.refusals[0]!.cause, "cited-nothing");
});

test("a draft with no title is nothing, and no path-only candidate is put in its place", () => {
  // A page exists whether or not a model spoke about it; a proposed leaflet IS the model's
  // output. Substituting a deterministic candidate here would be this module's work standing in
  // for a model's under a flag that asked for a model's.
  const result = drafted([node()], [draft({ title: null }), draft({ title: "   \n  " })]);

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(
    result.refusals.map((r) => r.cause),
    ["empty-draft", "empty-draft"],
  );
});

test("a drafter that ran and proposed nothing produces nothing, not one candidate per page", () => {
  const result = drafted([node(), node({ id: "brain:projects/other", path: "/tmp/knowledge/projects/other.md", relPath: "projects/other" })], []);

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.undrafted, []);
});

test("two drafts over the identical evidence set: the second is refused with the drafter named", () => {
  // Caught HERE, not at the round-trip gate. The gate would refuse the duplicate id and the CLI
  // would print "BUG — the candidates just drafted are not ones this product can load", which
  // blames this module for a nondeterministic decoder saying one thing twice.
  const result = drafted([node()], [draft(), draft({ title: "Ran the billing migration" })]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0]!.cause, "duplicate-evidence-set");
  assert.equal(result.refusals[0]!.title, "Ran the billing migration");
});

test("a rating-shaped line is refused, the path stands as the title, and the model loses the credit", () => {
  const result = drafted(
    [node()],
    [draft({ title: "Delivered the billing migration — a 9/10 quarter" })],
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(
    result.candidates[0]!.title,
    "projects/billing-migration — knowledge-base page, no claim drafted",
  );
  assert.equal(result.candidates[0]!.extractor, BRAIN_NODE_EXTRACTOR);
  assert.equal(result.refusedRatingShapedDrafts.length, 1);
  // The refused text is printed rather than quietly discarded.
  assert.match(result.refusedRatingShapedDrafts[0]!.reason, /9\/10/);
  assert.equal(result.undrafted.length, 1);
});

test("note and photo drafts use the same rating rule", () => {
  const line = "shipped it, 9/10";

  const fromNotes = drafted([node()], [draft({ title: line })]);
  assert.equal(fromNotes.refusedRatingShapedDrafts.length, 1);

  const fromPhotos = photosToCandidates({
    images: [
      {
        path: "/tmp/observations/IMG_0001.png",
        digest: "a".repeat(64),
        byteLength: 4096,
        dimensions: { known: true, width: 800, height: 600 },
        description: { describer: "local-model:gemma4:12b", summary: line, visibleText: null },
        published: null,
      },
    ],
    observedAt: instant,
  });
  assert.equal(fromPhotos.ok, true);
  if (!fromPhotos.ok) throw new Error("unreachable");
  assert.equal(fromPhotos.refusedRatingShapedDrafts.length, 1);
});

test("a rating-shaped PAGE PATH is kept out of the title and reported, never rewritten", () => {
  const rated = node({
    id: "brain:projects/self-rating-99.9%-quarter",
    path: "/tmp/knowledge/projects/self-rating-99.9%-quarter.md",
    relPath: "projects/self-rating-99.9%-quarter",
  });
  const result = deterministic([rated]);

  assert.equal(
    result.candidates[0]!.title,
    "(page path withheld: it carries a rating-shaped number) — knowledge-base page, no claim drafted",
  );
  assert.equal(result.refusedRatingShapedPaths.length, 1);
  assert.match(result.refusedRatingShapedPaths[0]!.reason, /self-rating-99.9%-quarter/);
  // The REF is untouched: it is where the page actually is, and editing an observation to
  // satisfy a rule about claims would falsify the observation.
  assert.equal(
    result.candidates[0]!.evidence[0]!.ref,
    "/tmp/knowledge/projects/self-rating-99.9%-quarter.md",
  );
});

test("a note path with a measured uptime percentage stays visible for review", () => {
  const observed = node({
    id: "brain:projects/uptime-99.9%-quarter",
    path: "/tmp/knowledge/projects/uptime-99.9%-quarter.md",
    relPath: "projects/uptime-99.9%-quarter",
  });
  const result = deterministic([observed]);
  assert.match(result.candidates[0]!.title, /uptime-99.9%-quarter/);
  assert.deepEqual(result.refusedRatingShapedPaths, []);
});

test("one page cited twice is one piece of evidence, not two", () => {
  const result = drafted(
    [node()],
    [
      draft({
        citedPaths: [
          "/tmp/knowledge/projects/billing-migration.md",
          "/tmp/knowledge/projects/billing-migration.md",
        ],
      }),
    ],
  );

  assert.equal(result.candidates[0]!.evidence.length, 1);
});

test("an unusable retrieval refuses as a whole and names every reason", () => {
  const at = (request: Parameters<typeof brainNotesToCandidates>[0]): string[] => {
    const result = brainNotesToCandidates(request);
    assert.equal(result.ok, false);
    return result.ok ? [] : result.issues.map((i) => i.at);
  };

  const det = { withheld: [], drafts: null, shown: null } as const;
  assert.deepEqual(at({ offered: [node()], ...det, draftedAt: "2026-08-17 00:00:00" }), [
    "draftedAt",
  ]);
  assert.deepEqual(at({ offered: [node({ path: "  " })], ...det, draftedAt: instant }), [
    "offered[0].path",
  ]);
  assert.deepEqual(at({ offered: [node({ id: "" })], ...det, draftedAt: instant }), [
    "offered[0].id",
  ]);
  assert.deepEqual(at({ offered: [node({ relPath: "" })], ...det, draftedAt: instant }), [
    "offered[0].relPath",
  ]);
  // A page whose confirmed-at instant is not one. It becomes the evidence ref's observedAt, and
  // a ref that says a page was observed has to name a moment somebody could have observed it at.
  assert.deepEqual(
    at({ offered: [node({ observedAt: "yesterday" })], ...det, draftedAt: instant }),
    ["offered[0].observedAt"],
  );
  // The same page twice means the retrieval is double-counting — one page is one piece of
  // evidence, and drafting two candidates over it would report a larger harvest than the
  // knowledge base supports.
  assert.deepEqual(
    at({
      offered: [node(), node({ id: "brain:projects/billing-migration-copy" })],
      ...det,
      draftedAt: instant,
    }),
    ["offered[1].path"],
  );
  // An anonymous draft cannot be reviewed: the drafter identity is what review reads first.
  assert.deepEqual(
    at({
      offered: [node()],
      withheld: [],
      drafts: [draft({ drafter: " " })],
      shown: shownWhole([node()]),
      draftedAt: instant,
    }),
    ["drafts[0].drafter"],
  );
});

test("a drafted candidate whose pack was not recorded is refused, and so is a pack with no drafter", () => {
  // THE RECORD IS NOT OPTIONAL WHEN A MODEL WROTE THE LINE. Review's warning about a name
  // travelling out of an uncited page is built from the pack; a drafted title with no pack is a
  // title review cannot be warned about, which is the failure this whole register exists to fix.
  // And a pack with no drafter is the mirror image: nothing was shown to anything.
  const at = (request: Parameters<typeof brainNotesToCandidates>[0]): string[] => {
    const result = brainNotesToCandidates(request);
    assert.equal(result.ok, false);
    return result.ok ? [] : result.issues.map((i) => i.at);
  };
  const pages = [node()];

  assert.deepEqual(
    at({ offered: pages, withheld: [], drafts: [draft()], shown: null, draftedAt: instant }),
    ["shown"],
  );
  assert.deepEqual(
    at({
      offered: pages,
      withheld: [],
      drafts: null,
      shown: shownWhole(pages),
      draftedAt: instant,
    }),
    ["shown"],
  );
  // A pack that disagrees with what was offered describes some other run: a page missing from it
  // understates what the drafter read, and a page in it that was never offered overstates.
  const other = node({
    id: "brain:projects/other",
    path: "/tmp/knowledge/projects/other.md",
    relPath: "projects/other",
  });
  assert.deepEqual(
    at({
      offered: [node(), other],
      withheld: [],
      drafts: [draft()],
      shown: shownWhole([node()]),
      draftedAt: instant,
    }),
    ["shown"],
  );
  assert.deepEqual(
    at({
      offered: [node()],
      withheld: [],
      drafts: [draft()],
      shown: shownWhole([node(), other]),
      draftedAt: instant,
    }),
    ["shown[1].node.path"],
  );
  // And a reading nothing could have performed: more characters shown than the page holds.
  assert.deepEqual(
    at({
      offered: pages,
      withheld: [],
      drafts: [draft()],
      shown: [{ node: node(), charsShown: 900, charsInPage: 400 }],
      draftedAt: instant,
    }),
    ["shown[0].charsShown", "shown"],
  );
});

test("an empty retrieval is an honest empty harvest, not a failure", () => {
  const result = ok({
    offered: [],
    withheld: [],
    drafts: null,
    shown: null,
    draftedAt: instant,
  });

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.refusals, []);
  // And the empty document is one the real gate accepts, so the CLI can write it.
  const validated = parseHarvestDocument({ candidates: [] });
  assert.equal(validated.ok, true);
});

test("what a page says is never proof: an approved candidate promotes to pending", () => {
  // The structural guarantee, exercised end to end through the real promotion path rather than
  // asserted. A knowledge base is a record of what someone believed while typing; nothing in it
  // is signed, so nothing drafted from it can reach `verified`.
  const result = drafted([node()], [draft()]);
  const approved = parseHarvestDocument({
    candidates: result.candidates.map((c) => ({
      ...c,
      evidence: [...c.evidence],
      review: { state: "approved", by: "Alex", at: instant },
    })),
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) throw new Error("unreachable");

  const leaf = parseLeafDocument({ id: "leaf-1", subject: "Alex", leaflets: [] });
  assert.equal(leaf.ok, true);
  if (!leaf.ok) throw new Error("unreachable");

  const promoted = promoteApproved(approved.harvest, leaf.leaf as Leaf);
  assert.equal(promoted.ok, true);
  if (!promoted.ok) throw new Error("unreachable");
  assert.equal(promoted.leaf.leaflets.length, 1);
  assert.equal(promoted.leaf.leaflets[0]!.tier, "pending");
  assert.equal(
    promoted.leaf.leaflets[0]!.provenance?.source,
    "photosynthesis:local-model:gemma4:12b",
  );
  // The ref that crosses the seam is the page path, so the leaflet can still be traced home.
  assert.equal(
    promoted.leaf.leaflets[0]!.provenance?.ref,
    "/tmp/knowledge/projects/billing-migration.md",
  );
});
