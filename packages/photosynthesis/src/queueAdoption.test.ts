import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLeafDocument, resolveClaimCitation, type ClaimCitation, type Leaf, type Leaflet } from "@foliage/leaf";

import { parseHarvestDocument, reviewSubjectDigest, type HarvestDocument } from "./harvestDocument.ts";
import { promoteApproved } from "./promote.ts";
import { adoptionRefusalLabel, planQueueAdoption, type QueueAdoptionCause } from "./queueAdoption.ts";

/**
 * Every harvest and leaf here is a synthetic PLAN INPUT shaped like the owner's measured garden
 * (31 approved clusters: 23 already in the leaf ref for ref, 8 grown since promotion — 6 with a newer
 * primary ref, 2 with the same one — all private). The shas, subjects and dates are made up; nothing
 * is read from a repository and nothing here is anyone's work.
 */

const observedAt = "2026-08-29T09:00:00Z";
const REPO = "/synthetic/repo";
const sha = (n: number): string => n.toString(16).padStart(40, "0");
const authored = (n: number): string => `2026-08-${String((n % 28) + 1).padStart(2, "0")}T10:00:00Z`;
const subject = (prefix: string, n: number): string => `${prefix}: synthetic change ${n}`;

interface Shape {
  readonly prefix: string;
  /** Candidate refs, newest first — evidence[0] is the primary. */
  readonly refs: readonly number[];
  /** Leaflet refs, in the order the older promotion wrote them. */
  readonly held: readonly number[];
  readonly oldTitle?: string;
}

/** 23 landed, 6 grown with a newer primary, 2 grown behind the same primary. */
function shapes(): readonly Shape[] {
  const landed = Array.from({ length: 23 }, (_, i): Shape => ({
    prefix: `landed${i}`,
    refs: [1000 + i * 2 + 1, 1000 + i * 2],
    held: [1000 + i * 2 + 1, 1000 + i * 2],
  }));
  const newerPrimary = Array.from({ length: 6 }, (_, i): Shape => ({
    prefix: `grown${i}`,
    refs: [2000 + i * 3 + 2, 2000 + i * 3 + 1, 2000 + i * 3],
    held: [2000 + i * 3 + 1, 2000 + i * 3],
    oldTitle: `grown${i}: the older generation`,
  }));
  const samePrimary = Array.from({ length: 2 }, (_, i): Shape => ({
    prefix: `kept${i}`,
    refs: [3000 + i * 3 + 2, 3000 + i * 3 + 1, 3000 + i * 3],
    held: [3000 + i * 3 + 2, 3000 + i * 3],
    oldTitle: `kept${i}: the older generation`,
  }));
  return [...landed, ...newerPrimary, ...samePrimary];
}

const titleOf = (s: Shape): string => `${s.prefix}: ${s.refs.length} synthetic changes`;

function rawCandidate(s: Shape): Record<string, unknown> {
  const material = {
    id: `git-cluster:${s.prefix}`,
    title: titleOf(s),
    evidence: s.refs.map((n) => ({ source: "git", ref: sha(n), observedAt, excerpt: subject(s.prefix, n) })),
    extractor: "git-cluster",
  };
  return {
    ...material,
    draftedAt: observedAt,
    review: { state: "approved", by: "Synthetic Reviewer", at: observedAt, subjectDigest: reviewSubjectDigest(material) },
  };
}

function rawLeaflet(s: Shape): Record<string, unknown> {
  return {
    id: `git-cluster:${s.prefix}`,
    title: s.oldTitle ?? titleOf(s),
    tier: "pending",
    provenance: { source: "photosynthesis:git-cluster", ref: sha(s.held[0]!), observedAt },
    body: s.held.map((n) => ({ provenance: { source: "git", ref: sha(n), observedAt }, text: subject(s.prefix, n) })),
  };
}

function harvestOf(candidates: readonly unknown[], document: Record<string, unknown> = {}): HarvestDocument {
  const parsed = parseHarvestDocument({ ...document, candidates });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

function leafOf(leaflets: readonly unknown[], document: Record<string, unknown> = {}): Leaf {
  const parsed = parseLeafDocument({ ...document, id: "leaf:synthetic", subject: "Synthetic Subject", leaflets });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function garden(edit: (shape: Shape, leaflet: Record<string, unknown>) => Record<string, unknown> = (_, l) => l) {
  const all = shapes();
  return {
    harvest: harvestOf(all.map(rawCandidate)),
    leaf: leafOf(all.map((s) => edit(s, rawLeaflet(s)))),
    dates: new Map(all.flatMap((s) => s.refs.map((n) => [sha(n), authored(n)] as const))),
  };
}

const ID_GROWN = "git-cluster:grown0";

test("the measured shape plans 8 extensions and 23 in the leaf, binding and repository recorded", () => {
  const g = garden();
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const { plan } = result;
  assert.equal(plan.extensions.length, 8);
  assert.equal(plan.inLeaf.length, 23);
  assert.deepEqual(plan.waiting, []);
  assert.equal(plan.alreadyAdopted, false);
  assert.deepEqual(plan.binding, { subject: "Synthetic Subject", leafId: "leaf:synthetic" });
  assert.equal(plan.adopted.subject, "Synthetic Subject");
  assert.equal(plan.adopted.leafId, "leaf:synthetic");
  assert.equal(plan.adopted.repo, REPO);
  assert.equal(plan.backfill, shapes().reduce((n, s) => n + s.refs.length, 0), "every git ref is dated");
  assert.equal(plan.extensions.reduce((n, e) => n + e.refsAdded.length, 0), 8, "one new commit per grown cluster");
  const grown = plan.extensions.find((e) => e.id === ID_GROWN);
  assert.deepEqual(grown, {
    id: ID_GROWN,
    oldTitle: "grown0: the older generation",
    approvedTitle: "grown0: 3 synthetic changes",
    refsAdded: [sha(2002)],
    refsFilled: [],
  });
});

test("the backfill dates every git ref and moves no decided digest", () => {
  const g = garden();
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const reparsed = parseHarvestDocument(JSON.parse(JSON.stringify(result.plan.adopted)));
  assert.equal(reparsed.ok, true, "the adopted harvest passes its own gate");
  for (const [i, candidate] of result.plan.adopted.candidates.entries()) {
    const before = g.harvest.candidates[i]!;
    assert.equal(reviewSubjectDigest(candidate), reviewSubjectDigest(before), `${candidate.id}: digest moved`);
    assert.deepEqual(candidate.review, before.review, `${candidate.id}: the decision itself is untouched`);
    for (const e of candidate.evidence) assert.equal(e.authoredAt, g.dates.get(e.ref));
  }
});

test("the plan and promote together land the 8 in place, private, and a second plan finds nothing to do", () => {
  const g = garden();
  const first = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const ids = new Set(first.plan.extensions.map((e) => e.id));
  const promoted = promoteApproved(first.plan.adopted, g.leaf, ids);
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.deepEqual(new Set(promoted.superseded.map((s) => s.id)), ids);
  assert.ok(promoted.superseded.every((s) => s.visibility === "private" && s.refsRemoved.length === 0));
  assert.deepEqual(new Set(promoted.refusedDuplicates.map((r) => r.id)), new Set(first.plan.inLeaf));
  assert.equal(promoted.leaf.leaflets.length, 31, "replaced in place, nothing appended");
  for (const e of first.plan.extensions) {
    const leaflet: Leaflet | undefined = promoted.leaf.leaflets.find((l) => (l.id as string) === e.id);
    if (leaflet === undefined) throw new Error(`${e.id} is missing from the promoted leaf`);
    assert.equal(leaflet.title, e.approvedTitle);
    assert.equal("visibility" in leaflet, false, "private, spelled by absence as before");
  }

  const again = planQueueAdoption(first.plan.adopted, promoted.leaf, g.dates, REPO);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.plan.alreadyAdopted, true);
  assert.deepEqual(again.plan.extensions, []);
  assert.equal(again.plan.backfill, 0);
  assert.equal(again.plan.inLeaf.length, 31);
});

function refusal(g: ReturnType<typeof garden>, repo = REPO): { cause: QueueAdoptionCause; ids: readonly string[] } {
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, repo);
  assert.equal(result.ok, false, "the plan must refuse");
  if (result.ok) throw new Error("unreachable");
  return { cause: result.cause, ids: result.ids };
}

test("a SHARED leaflet the approval would extend refuses the whole plan as not-private", () => {
  const g = garden((s, l) => (s.prefix === "grown0" ? { ...l, visibility: "public" } : l));
  assert.deepEqual(refusal(g), { cause: "not-private", ids: [ID_GROWN] });
});

test("a leaflet carrying a key promotion does not rebuild refuses as extra-fields", () => {
  const g = garden();
  // A leaflet field this plan does not know — the shape a future leaf field would take.
  const leaf: Leaf = {
    ...g.leaf,
    leaflets: g.leaf.leaflets.map((l) => ((l.id as string) === ID_GROWN ? ({ ...l, story: "the owner's words" } as unknown as typeof l) : l)),
  };
  assert.deepEqual(refusal({ ...g, leaf }), { cause: "extra-fields", ids: [ID_GROWN] });
});

test("body text other than the approved commit subject refuses as extra-fields — it would be lost", () => {
  const g = garden((s, l) =>
    s.prefix === "grown0"
      ? { ...l, body: (l["body"] as Record<string, unknown>[]).map((e, i) => (i === 0 ? { ...e, text: "hand-written words" } : e)) }
      : l,
  );
  assert.deepEqual(refusal(g), { cause: "extra-fields", ids: [ID_GROWN] });
});

test("a leaflet made by another extractor refuses as foreign-leaflet", () => {
  const g = garden((s, l) =>
    s.prefix === "grown0"
      ? { ...l, provenance: { ...(l["provenance"] as Record<string, unknown>), source: "photosynthesis:local-model:gemma4:12b" } }
      : l,
  );
  assert.deepEqual(refusal(g), { cause: "foreign-leaflet", ids: [ID_GROWN] });
});

test("a leaflet holding a ref the approval does not refuses as refs-removed", () => {
  const extra = sha(9999);
  const g = garden((s, l) =>
    s.prefix === "grown0"
      ? { ...l, body: [...(l["body"] as unknown[]), { provenance: { source: "git", ref: extra, observedAt } }] }
      : l,
  );
  assert.deepEqual(refusal(g), { cause: "refs-removed", ids: [ID_GROWN] });
});

test("a grown cluster whose leaflet already wears the approved title is an extension, not in the leaf", () => {
  const g = garden((s, l) => (s.prefix === "grown0" ? { ...l, title: titleOf(s) } : l));
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.inLeaf.includes(ID_GROWN), false, "a new commit is not in the leaf");
  const grown = result.plan.extensions.find((e) => e.id === ID_GROWN);
  assert.deepEqual(grown, { id: ID_GROWN, oldTitle: "grown0: 3 synthetic changes", approvedTitle: "grown0: 3 synthetic changes", refsAdded: [sha(2002)], refsFilled: [] });
  assert.equal(result.plan.alreadyAdopted, false);
});

test("a leaflet under the approved title holding one ref more refuses as refs-removed, not in the leaf", () => {
  // No text on the extra element, so extra-fields does not answer first.
  const g = garden((s, l) =>
    s.prefix === "landed0"
      ? { ...l, body: [...(l["body"] as unknown[]), { provenance: { source: "git", ref: sha(9999), observedAt } }] }
      : l,
  );
  assert.equal(g.leaf.leaflets.find((l) => (l.id as string) === "git-cluster:landed0")?.title, "landed0: 2 synthetic changes");
  assert.deepEqual(refusal(g), { cause: "refs-removed", ids: ["git-cluster:landed0"] });
});

test("a ref the repository does not hold refuses the whole plan, the sha named", () => {
  const g = garden();
  const dates = new Map([...g.dates].filter(([ref]) => ref !== sha(2002)));
  assert.deepEqual(refusal({ ...g, dates }), { cause: "missing-commit", ids: [sha(2002)] });
});

test("a harvest bound elsewhere refuses as binding-mismatch, each field named", () => {
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates;
  assert.deepEqual(refusal({ ...g, harvest: harvestOf(raw, { subject: "Somebody Else" }) }), {
    cause: "binding-mismatch",
    ids: ["subject"],
  });
  assert.deepEqual(refusal({ ...g, harvest: harvestOf(raw, { repo: "/another/repo" }) }), {
    cause: "binding-mismatch",
    ids: ["repo"],
  });
});

test("an extension whose approval named a different body refuses as digest-changed", () => {
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates.map((c: Record<string, unknown>) =>
    c["id"] === ID_GROWN
      ? {
          ...c,
          review: {
            ...(c["review"] as Record<string, unknown>),
            subjectDigest: reviewSubjectDigest({ ...(c as unknown as Parameters<typeof reviewSubjectDigest>[0]), title: "what was approved" }),
          },
        }
      : c,
  );
  assert.deepEqual(refusal({ ...g, harvest: harvestOf(raw) }), { cause: "digest-changed", ids: [ID_GROWN] });
});

test("an approved candidate with no leaflet waits to be appended, and the garden is not yet adopted", () => {
  const g = garden();
  const leaf = { ...g.leaf, leaflets: g.leaf.leaflets.filter((l) => (l.id as string) !== "git-cluster:landed0") };
  const result = planQueueAdoption(g.harvest, leaf, g.dates, REPO);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plan.waiting, ["git-cluster:landed0"]);
  assert.equal(result.plan.inLeaf.length, 22);
});

test("an approval with no leaflet whose excerpt changed since approval refuses as digest-changed — never appended", () => {
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates.map((c: { id: string; evidence: Record<string, unknown>[] }) =>
    c.id === "git-cluster:landed0" ? { ...c, evidence: c.evidence.map((e, i) => (i === 0 ? { ...e, excerpt: "words nobody approved" } : e)) } : c,
  );
  const leaf = { ...g.leaf, leaflets: g.leaf.leaflets.filter((l) => (l.id as string) !== "git-cluster:landed0") };
  assert.deepEqual(refusal({ ...g, harvest: harvestOf(raw), leaf }), { cause: "digest-changed", ids: ["git-cluster:landed0"] });
});

test("the approved refs and title with an approved excerpt missing from the body is an extension, never in the leaf", () => {
  const g = garden((s, l) =>
    s.prefix === "landed0"
      ? { ...l, body: (l["body"] as Record<string, unknown>[]).map((e, i) => (i === 1 ? { provenance: e["provenance"] } : e)) }
      : l,
  );
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.inLeaf.includes("git-cluster:landed0"), false);
  const filled = result.plan.extensions.find((e) => e.id === "git-cluster:landed0");
  assert.deepEqual([filled?.refsAdded, filled?.refsFilled], [[], [sha(1000)]]);
  const promoted = promoteApproved(result.plan.adopted, g.leaf, new Set(result.plan.extensions.map((e) => e.id)));
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  const body = promoted.leaf.leaflets.find((l) => (l.id as string) === "git-cluster:landed0")?.body ?? [];
  assert.equal(body[1]?.text, subject("landed0", 1000), "the approved excerpt lands");
  const again = planQueueAdoption(result.plan.adopted, promoted.leaf, g.dates, REPO);
  assert.equal(again.ok && again.plan.alreadyAdopted, true);
});

test("two approved excerpts on one ref are two elements: the leaf holding only one is not in the leaf, and both landed are", () => {
  const twice = (c: Record<string, unknown>) => {
    const evidence = c["evidence"] as Record<string, unknown>[];
    const material = {
      id: c["id"] as string,
      title: c["title"] as string,
      evidence: [...evidence, { ...evidence[0], excerpt: "a second approved excerpt" }],
      extractor: c["extractor"] as string,
    };
    return { ...c, ...material, review: { ...(c["review"] as Record<string, unknown>), subjectDigest: reviewSubjectDigest(material) } };
  };
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates.map((c: Record<string, unknown>) => (c["id"] === "git-cluster:landed0" ? twice(c) : c));
  const result = planQueueAdoption(harvestOf(raw), g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.inLeaf.includes("git-cluster:landed0"), false);
  const filled = result.plan.extensions.find((e) => e.id === "git-cluster:landed0");
  assert.deepEqual([filled?.refsAdded, filled?.refsFilled], [[], [sha(1001)]]);
  const promoted = promoteApproved(result.plan.adopted, g.leaf, new Set(result.plan.extensions.map((e) => e.id)));
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  const again = planQueueAdoption(result.plan.adopted, promoted.leaf, g.dates, REPO);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.ok && again.plan.alreadyAdopted, true);
});

test("approved media missing from a leaflet with the approved refs and title is an extension, never in the leaf", () => {
  const photo = `sha256:${"b".repeat(64)}`;
  const jpeg = { mediaType: "image/jpeg", dimensions: { known: true, width: 4032, height: 3024 } };
  const g = garden((s, l) =>
    s.prefix === "landed0" ? { ...l, body: [...(l["body"] as unknown[]), { provenance: { source: "photo", ref: photo, observedAt } }] } : l,
  );
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates.map((c: Record<string, unknown>) => {
    if (c["id"] !== "git-cluster:landed0") return c;
    const material = {
      id: c["id"] as string,
      title: c["title"] as string,
      evidence: [...(c["evidence"] as unknown[]), { source: "photo", ref: photo, observedAt }],
      extractor: c["extractor"] as string,
      media: [{ ref: photo, media: jpeg }],
    };
    return { ...c, ...material, review: { ...(c["review"] as Record<string, unknown>), subjectDigest: reviewSubjectDigest(material) } };
  });
  const result = planQueueAdoption(harvestOf(raw), g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.inLeaf.includes("git-cluster:landed0"), false);
  const filled = result.plan.extensions.find((e) => e.id === "git-cluster:landed0");
  assert.deepEqual([filled?.refsAdded, filled?.refsFilled], [[], [photo]]);

  // The same ref holding OTHER media in the leaflet would be overwritten: refused, not extended.
  const png = { mediaType: "image/png", dimensions: { known: true, width: 10, height: 10 } };
  const other = garden((s, l) =>
    s.prefix === "landed0"
      ? { ...l, body: [...(l["body"] as unknown[]), { provenance: { source: "photo", ref: photo, observedAt }, media: png }] }
      : l,
  );
  assert.deepEqual(refusal({ ...other, harvest: harvestOf(raw) }), { cause: "extra-fields", ids: ["git-cluster:landed0"] });
});

test("every refusal has a label, and a label is words, not a number", () => {
  const causes: readonly QueueAdoptionCause[] = [
    "binding-mismatch",
    "missing-commit",
    "digest-changed",
    "foreign-leaflet",
    "extra-fields",
    "refs-removed",
    "not-private",
    "not-pending",
    "cited",
  ];
  for (const cause of causes) {
    const label = adoptionRefusalLabel(cause);
    assert.ok(label.length > 0 && !/\d/.test(label), `${cause}: ${label}`);
  }
});

test("a leaflet whose tier is not pending refuses as not-pending — promotion would write it back pending", () => {
  const g = garden((s, l) => (s.prefix === "grown0" ? { ...l, tier: "verified" } : l));
  assert.deepEqual(refusal(g), { cause: "not-pending", ids: [ID_GROWN] });
});

/** The synthetic garden with one achievement whose claim cites `citations`. */
function citedGarden(
  citations: (shape: Shape) => readonly ClaimCitation[],
  edit: (shape: Shape, leaflet: Record<string, unknown>) => Record<string, unknown> = (_, l) => l,
) {
  const all = shapes();
  const grown = all.find((s) => s.prefix === "grown0")!;
  const achievements = [{ id: "a1", title: "Synthetic achievement", claims: [{ id: "c1", kind: "summary", text: "Synthetic claim", citations: citations(grown) }] }];
  return { ...garden(), leaf: leafOf(all.map((s) => edit(s, rawLeaflet(s))), { achievements }) };
}

const cite = (source: string, n: number, at = observedAt): ClaimCitation =>
  ({ leaflet: ID_GROWN, provenance: { source, ref: sha(n), observedAt: at } }) as ClaimCitation;

test("a current citation of the leaflet's own provenance refuses as cited — the primary ref moves", () => {
  const g = citedGarden((s) => [cite("photosynthesis:git-cluster", s.held[0]!)]);
  assert.equal(resolveClaimCitation(g.leaf, cite("photosynthesis:git-cluster", 2001)).status, "current", "current before");
  assert.deepEqual(refusal(g), { cause: "cited", ids: [ID_GROWN] });
});

test("a current citation of a body ref observed at another time refuses as cited — promotion re-stamps it", () => {
  const older = "2026-08-22T05:00:00Z";
  const g = citedGarden(
    (s) => [cite("git", s.held[1]!, older)],
    (s, l) =>
      s.prefix === "grown0"
        ? { ...l, body: (l["body"] as { provenance: Record<string, unknown> }[]).map((e) => ({ ...e, provenance: { ...e.provenance, observedAt: older } })) }
        : l,
  );
  assert.deepEqual(refusal(g), { cause: "cited", ids: [ID_GROWN] });
});

test("a citation the extension keeps current, or one already stale, does not refuse", () => {
  const g = citedGarden((s) => [cite("git", s.held[1]!), cite("git", 9999)]);
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.extensions.length, 8);
  const promoted = promoteApproved(result.plan.adopted, g.leaf, new Set(result.plan.extensions.map((e) => e.id)));
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(resolveClaimCitation(promoted.leaf, cite("git", 2000)).status, "current", "still current after");
});

test("a media element the candidate does not carry refuses as extra-fields — it would be dropped", () => {
  const jpeg = { mediaType: "image/jpeg", dimensions: { known: true, width: 4032, height: 3024 } };
  const g = garden((s, l) =>
    s.prefix === "grown0"
      ? { ...l, body: [...(l["body"] as unknown[]), { provenance: { source: "photo", ref: `sha256:${"a".repeat(64)}`, observedAt }, media: jpeg }] }
      : l,
  );
  assert.deepEqual(refusal(g), { cause: "extra-fields", ids: [ID_GROWN] });
});

test("a harvest bound to another leaf id refuses as binding-mismatch, leafId named", () => {
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates;
  assert.deepEqual(refusal({ ...g, harvest: harvestOf(raw, { leafId: "leaf:other" }) }), {
    cause: "binding-mismatch",
    ids: ["leafId"],
  });
});

test("the same refs under an older title is an extension that adds no ref and lands the approved title", () => {
  const g = garden((s, l) => (s.prefix === "landed0" ? { ...l, title: "landed0: the older title" } : l));
  const result = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const renamed = result.plan.extensions.find((e) => e.id === "git-cluster:landed0");
  assert.deepEqual(renamed, { id: "git-cluster:landed0", oldTitle: "landed0: the older title", approvedTitle: "landed0: 2 synthetic changes", refsAdded: [], refsFilled: [] });
  assert.equal(result.plan.inLeaf.length, 22);
  const promoted = promoteApproved(result.plan.adopted, g.leaf, new Set(result.plan.extensions.map((e) => e.id)));
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.leaf.leaflets.find((l) => (l.id as string) === "git-cluster:landed0")?.title, "landed0: 2 synthetic changes");
});

test("a rejected candidate whose id matches a leaflet is neither an extension nor waiting", () => {
  const g = garden();
  const raw = JSON.parse(JSON.stringify(g.harvest)).candidates.map((c: Record<string, unknown>) =>
    c["id"] === ID_GROWN || c["id"] === "git-cluster:grown1"
      ? { ...c, review: { state: "rejected", by: "Synthetic Reviewer", at: observedAt, reason: "synthetic reason" } }
      : c,
  );
  const leaf = { ...g.leaf, leaflets: g.leaf.leaflets.filter((l) => (l.id as string) !== "git-cluster:grown1") };
  const result = planQueueAdoption(harvestOf(raw), leaf, g.dates, REPO);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.plan.extensions.length, 6);
  assert.ok(result.plan.extensions.every((e) => e.id !== ID_GROWN));
  assert.deepEqual(result.plan.waiting, [], "a rejected candidate with no leaflet is not waiting either");
});

/** The garden after one adoption: the adopted harvest and the promoted leaf. */
function adoptedGarden() {
  const g = garden();
  const first = planQueueAdoption(g.harvest, g.leaf, g.dates, REPO);
  if (!first.ok) throw new Error(JSON.stringify(first));
  const promoted = promoteApproved(first.plan.adopted, g.leaf, new Set(first.plan.extensions.map((e) => e.id)));
  if (!promoted.ok) throw new Error(JSON.stringify(promoted));
  return { dates: g.dates, raw: JSON.parse(JSON.stringify(first.plan.adopted)) as Record<string, unknown>, leaf: promoted.leaf };
}

const replan = (harvest: HarvestDocument, leaf: Leaf, dates: ReadonlyMap<string, string>) => {
  const result = planQueueAdoption(harvest, leaf, dates, REPO);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.plan;
};

test("an unbound harvest, fully in the leaf and fully dated, is not yet adopted — the binding is still to record", () => {
  const a = adoptedGarden();
  const { subject: _s, leafId: _l, repo: _r, ...unbound } = a.raw;
  const plan = replan(harvestOf(unbound["candidates"] as unknown[]), a.leaf, a.dates);
  assert.equal(plan.backfill, 0);
  assert.deepEqual(plan.extensions, []);
  assert.deepEqual(plan.waiting, []);
  assert.equal(plan.alreadyAdopted, false);
  assert.equal(plan.adopted.subject, "Synthetic Subject");
  assert.equal(plan.adopted.leafId, "leaf:synthetic");
  assert.equal(plan.adopted.repo, REPO);
});

test("a bound harvest with one undated ref is not yet adopted", () => {
  const a = adoptedGarden();
  const candidates = (a.raw["candidates"] as { evidence: Record<string, unknown>[] }[]).map((c, i) =>
    i === 0 ? { ...c, evidence: c.evidence.map((e, j) => (j === 0 ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== "authoredAt")) : e)) } : c,
  );
  const plan = replan(harvestOf(candidates, { subject: a.raw["subject"], leafId: a.raw["leafId"], repo: a.raw["repo"] }), a.leaf, a.dates);
  assert.equal(plan.backfill, 1);
  assert.equal(plan.alreadyAdopted, false);
});

test("a bound, dated harvest with one approval still waiting is not yet adopted", () => {
  const a = adoptedGarden();
  const leaf = { ...a.leaf, leaflets: a.leaf.leaflets.filter((l) => (l.id as string) !== "git-cluster:landed0") };
  const { candidates, ...binding } = a.raw;
  const plan = replan(harvestOf(candidates as unknown[], binding), leaf, a.dates);
  assert.deepEqual(plan.waiting, ["git-cluster:landed0"]);
  assert.equal(plan.backfill, 0);
  assert.equal(plan.alreadyAdopted, false);
});

test("a bound, dated harvest whose extensions never reached the leaf is not yet adopted — a retry lands them", () => {
  // The partial write --apply allows: the harvest is written (bound, dated), then the leaf write fails.
  const g = garden();
  const first = replan(g.harvest, g.leaf, g.dates);
  const plan = replan(first.adopted, g.leaf, g.dates);
  assert.equal(plan.backfill, 0);
  assert.deepEqual(plan.waiting, []);
  assert.equal(plan.extensions.length, 8);
  assert.equal(plan.alreadyAdopted, false);
});

test("a held commit git prints no usable date for stays undated — never missing, and the harvest still loads", () => {
  const g = garden();
  const all = shapes().reduce((n, s) => n + s.refs.length, 0);
  // What git prints for %aI on a commit with no author date, an impossible offset, a far year, nothing.
  for (const printed of ["%aI", "2026-08-03T10:00:00+99:99", "33658-09-27T01:46:39Z", ""]) {
    const dates = new Map([...g.dates].map(([ref, at]) => [ref, ref === sha(2002) ? printed : at] as const));
    const result = planQueueAdoption(g.harvest, g.leaf, dates, REPO);
    assert.equal(result.ok, true, `${printed}: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.plan.backfill, all - 1, printed);
    assert.equal(result.plan.extensions.length, 8, printed);
    const evidence = result.plan.adopted.candidates.flatMap((c) => c.evidence);
    assert.equal(evidence.find((e) => e.ref === sha(2002))?.authoredAt, undefined, printed);
    assert.equal(evidence.find((e) => e.ref === sha(2001))?.authoredAt, authored(2001), printed);
    const reparsed = parseHarvestDocument(JSON.parse(JSON.stringify(result.plan.adopted)));
    assert.equal(reparsed.ok, true, `${printed}: ${JSON.stringify(!reparsed.ok && reparsed.issues)}`);
  }
});

test("a harvest missing any one of subject, leafId or repo is not yet adopted — the missing one is recorded", () => {
  const a = adoptedGarden();
  const { candidates, ...binding } = a.raw;
  for (const field of ["subject", "leafId", "repo"]) {
    const partial = Object.fromEntries(Object.entries(binding).filter(([k]) => k !== field));
    const plan = replan(harvestOf(candidates as unknown[], partial), a.leaf, a.dates);
    assert.equal(plan.backfill, 0, field);
    assert.deepEqual(plan.extensions, [], field);
    assert.deepEqual(plan.waiting, [], field);
    assert.equal(plan.alreadyAdopted, false, `${field} missing`);
    assert.deepEqual(
      { subject: plan.adopted.subject, leafId: plan.adopted.leafId, repo: plan.adopted.repo },
      { subject: "Synthetic Subject", leafId: "leaf:synthetic", repo: REPO },
      field,
    );
  }
  assert.equal(replan(harvestOf(candidates as unknown[], binding), a.leaf, a.dates).alreadyAdopted, true, "all three recorded");
});

test("a brain-note candidate in the same queue is never a missing commit and never dated", () => {
  const g = garden();
  const note = (name: string, state: "approved" | "candidate") => {
    const material = {
      id: `brain-note:${name}`,
      title: `Synthetic note ${name}`,
      evidence: [{ source: "brain-note", ref: `/synthetic/brain/${name}.md`, observedAt }],
      extractor: "brain-node",
    };
    return {
      ...material,
      draftedAt: observedAt,
      review:
        state === "approved"
          ? { state, by: "Synthetic Reviewer", at: observedAt, subjectDigest: reviewSubjectDigest(material) }
          : { state },
    };
  };
  const raw = [...JSON.parse(JSON.stringify(g.harvest)).candidates, note("approved", "approved"), note("pending", "candidate")];
  // Even a date keyed by a note's path must not reach it: only git evidence is dated.
  const dates = new Map([
    ...g.dates,
    ["/synthetic/brain/approved.md", "2026-08-01T10:00:00Z"],
    ["/synthetic/brain/pending.md", "2026-08-01T10:00:00Z"],
  ]);
  for (const d of [g.dates, dates]) {
    const result = planQueueAdoption(harvestOf(raw), g.leaf, d, REPO);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.plan.backfill, shapes().reduce((n, s) => n + s.refs.length, 0));
    assert.deepEqual(result.plan.waiting, ["brain-note:approved"]);
    const notes = result.plan.adopted.candidates.filter((c) => (c.id as string).startsWith("brain-note:"));
    assert.equal(notes.length, 2);
    assert.ok(notes.every((c) => c.evidence.every((e) => e.authoredAt === undefined)), "a note is never dated");
  }
});
