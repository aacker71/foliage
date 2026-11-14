/** Home (`/`), the owner's first view: a next action and retained work before quiet accounting. */

import { attributionLedger, isSubjectsOwnWork, type Leaf, type PublishPolicy } from "@foliage/leaf";
import { shownQueue } from "@foliage/photosynthesis";

import type { LeafLoad } from "./leafDocument.ts";
import { HARVEST_LOAD_LABEL, LEAF_LOAD_LABEL } from "./loadLabels.ts";
import type { PolicySource } from "./policyDocument.ts";
import {
  LEAF_ROUTE,
  REVIEW_PROMOTE_HREF,
  REVIEW_ROUTE,
  approvedNotInLeaf,
  carriesVerbatimTitle,
  esc,
  fabricationBand,
  ownerLeafletHref,
  page,
  titleProvenanceAttr,
  type HarvestLoad,
} from "./render.ts";
import { readLeafletStory } from "./leafletStory.ts";
import { addAfterCreate, CREATE_RECORD } from "./recordStart.ts";

/** A small, exact count within one line of accounting. */
function stat(opts: {
  readonly label: string;
  readonly value: string;
  readonly data?: string;
}): string {
  const inner = `<span class="fol-label">${esc(opts.label)}</span>
<b class="fol-metric leaf-count">${esc(opts.value)}</b>`;
  const attr = opts.data === undefined ? "" : ` data-overview-stat="${esc(opts.data)}"`;
  return `<span class="ov-stat"${attr}>\n${inner}\n</span>`;
}

/**
 * The garden section: the leaf's own attribution ledger, or the honest reason there is none yet.
 *
 * Mirrors `httpStatusFor`'s five causes rather than collapsing them — "no leaf configured" and
 * "the leaf is broken" both read as "0 leaflets" to a careless dashboard, and they need opposite
 * responses from the person looking at it.
 *
 * APPROVED WORK WITH NO RECORD is the one missing-leaf state with work already waiting: approval
 * never writes the leaf, and there is no leaf to add it into. The section says what happens after
 * the record is created; the way there is the Next step, or a quiet link while review leads.
 */
function gardenSection(load: LeafLoad, harvest: HarvestLoad, createLink: boolean): string {
  const approved = approvedWithoutRecord(load, harvest);
  if (approved > 0 && harvest.ok) {
    return `<section class="ov-accounting" aria-labelledby="ov-garden-h" data-garden-state="absent">
<h2 id="ov-garden-h">In your record</h2>
<p class="aside">No private record yet</p>
<p>${esc(addAfterCreate(harvest.harvest, approved, "from Review"))}</p>${
      createLink ? `\n<a class="ov-secondary" href="${CREATE_RECORD.href}" data-create-record>${CREATE_RECORD.text}</a>` : ""}
</section>`;
  }
  if (!load.ok) {
    const isFirstRun = load.cause === "absent";
    return `<section class="ov-accounting" aria-labelledby="ov-garden-h" data-garden-state="${esc(load.cause)}">
<h2 id="ov-garden-h">In your record</h2>
<p class="aside">${esc(LEAF_LOAD_LABEL[load.cause])}</p>
${!isFirstRun ? `<details class="leaf-detail"><summary>Details</summary><p class="fol-metric">${esc(load.detail)}</p></details>` : ""}
</section>`;
  }
  const ledger = attributionLedger(load.leaf);
  const total = ledger.verified + ledger.pending + ledger.excluded;
  if (total === 0) return "";
  return `<section class="ov-accounting" aria-labelledby="ov-garden-h" data-garden-state="ok">
<h2 id="ov-garden-h">In your record</h2>
<p class="ov-stat-line">
${stat({ label: "Verified", value: String(ledger.verified), data: "verified" })}
${stat({ label: "Pending", value: String(ledger.pending), data: "pending" })}
${stat({ label: "Excluded", value: String(ledger.excluded), data: "excluded" })}
</p>
</section>`;
}

/** Approved drafts waiting for a record that does not exist yet; 0 in every other state. */
function approvedWithoutRecord(load: LeafLoad, harvest: HarvestLoad): number {
  return !load.ok && load.cause === "absent" && harvest.ok
    ? harvest.harvest.candidates.filter((c) => c.review.state === "approved").length
    : 0;
}

/**
 * The review section: candidates by state, or the honest reason there is no harvest yet.
 *
 * The headline number is `candidate` — unreviewed drafts, the thing that actually needs the
 * owner's attention — with `approved` (ready to promote) and `rejected` (settled) beside it for
 * context. Same three states `reviewCounts` in `render.ts` counts, read here from the harvest
 * this page's caller already loaded rather than a second pass over the file.
 */
function reviewSection(load: HarvestLoad, paused: boolean): string {
  if (!load.ok) {
    const isFirstRun = load.cause === "absent";
    if (isFirstRun) return "";
    return `<section class="ov-accounting" aria-labelledby="ov-review-h" data-queue-state="${esc(load.cause)}">
<h2 id="ov-review-h">Review</h2>
<p class="aside">${esc(HARVEST_LOAD_LABEL[load.cause])}</p>
${!isFirstRun ? `<details class="leaf-detail"><summary>Details</summary><p class="fol-metric">${esc(load.detail)}</p></details>` : ""}
</section>`;
  }
  const counts = { candidate: 0, approved: 0, rejected: 0 };
  for (const c of load.harvest.candidates) counts[c.review.state]++;
  // The open count /review shows: while collection is paused its undecided drafts wait unshown.
  const queue = shownQueue(load.harvest.candidates, paused);
  if (load.harvest.candidates.length === 0) return "";
  return `<section class="ov-accounting" aria-labelledby="ov-review-h" data-queue-state="ok">
<h2 id="ov-review-h">Review</h2>
<p class="ov-stat-line">
${stat({ label: "Awaiting review", value: String(queue.open), data: "candidate" })}
${stat({ label: "Approved", value: String(counts.approved), data: "approved" })}
${stat({ label: "Rejected", value: String(counts.rejected), data: "rejected" })}
</p>
${queue.hidden > 0 ? `<p class="aside" data-queue-paused>Paused <span class="fol-metric">${queue.hidden}</span></p>` : ""}
</section>`;
}

/** Owner-selected accounts lead; retained leaflets follow in document order, never a made-up work chronology. */
function workSection(leaf: Leaf): string {
  const achievements = (leaf.achievements ?? []).slice(0, 2);
  const cited = new Set(achievements.flatMap((achievement) => achievement.claims.flatMap((claim) =>
    (claim.citations ?? []).map((citation) => citation.leaflet))));
  const records = leaf.leaflets.filter((record) => isSubjectsOwnWork(record) && !cited.has(record.id))
    .slice(0, 3 - achievements.length);
  if (achievements.length + records.length === 0) return "";
  const accounts = achievements.map((achievement) => {
    const statement = achievement.claims.find((claim) => claim.kind === "outcome") ??
      achievement.claims.find((claim) => claim.kind === "summary") ?? achievement.claims[0];
    return `<li class="work-record ov-work-row"><h3 data-authored="subject">${esc(achievement.title)}</h3>
${statement ? `<p data-authored="subject">${esc(statement.text)}</p>` : ""}
<div class="work-record-meta"><span>Achievement</span><a class="work-record-open" href="/leaf/achievement?id=${encodeURIComponent(achievement.id)}">Open</a></div></li>`;
  });
  const leaflets = records.map((record) => {
    const stories = readLeafletStory(record);
    const statement = stories.find((story) => story.section === "outcome") ?? stories[0];
    return `<li class="work-record ov-work-row"><h3 ${titleProvenanceAttr(carriesVerbatimTitle(record))}>${esc(record.title)}</h3>
${statement ? `<p data-authored="subject">${esc(statement.text)}</p>` : ""}
<div class="work-record-meta"><span>Retained record</span><a class="work-record-open" href="${esc(ownerLeafletHref(record.id))}">Open</a></div></li>`;
  });
  return `<section class="ov-work" aria-labelledby="ov-work-h"><header class="ov-work-heading"><h2 id="ov-work-h">Your work</h2><a href="/leaf/photosynthesis">All work</a></header>
<ol class="ov-work-list">${[...accounts, ...leaflets].join("\n")}</ol></section>`;
}

interface Step {
  readonly text: string;
  readonly href: string;
}

/**
 * ONE DETERMINISTIC SENTENCE, never invented. Every branch is a fact already computed above,
 * re-read here rather than guessed at — the same discipline `attributionLedger` states for
 * counts: a dashboard that infers an action from a vibe is the same failure as a total function
 * that returns a zero for "I do not know". Ordered by what is actually most actionable: approved
 * work not yet in a readable record leads, with any unreviewed drafts named beside it; then
 * unreviewed drafts alone; then "you have no leaf yet"; then "nothing to do".
 *
 * APPROVED-BUT-NOT-ADDED LEADS, AND REVIEW STAYS BESIDE IT. Approving does not put work into the
 * record — the promote panel at the foot of `/review` does — and while any draft stayed open this
 * function used to answer "Review N drafts" alone, so the add branch could not be reached in the
 * one state where it mattered most: mid-review, with approvals piling up unseen. Finishing work
 * the owner already judged outranks starting the next judgement, and both stay one click away.
 */
function nextStep(leafLoad: LeafLoad, harvestLoad: HarvestLoad, paused: boolean): Step & { readonly also?: Step } {
  if (harvestLoad.ok) {
    const awaiting = shownQueue(harvestLoad.harvest.candidates, paused).open;
    const review: Step | null = awaiting > 0
      ? { text: `Review ${awaiting} draft${awaiting === 1 ? "" : "s"}`, href: REVIEW_ROUTE }
      : null;
    /*
     * "READY TO PROMOTE" MEANS NOT YET IN THE LEAF, and that is a subtraction, not a count.
     * Counting `state === "approved"` alone asserts readiness without consulting the document the
     * work would be promoted INTO, so once a candidate is carried across it keeps being advertised
     * as pending forever — an un-clearable to-do that grows with every approval. MEASURED on a
     * garden in use before this fix: the overview offered every approved candidate as "ready to
     * promote" while `/review`, one click away, said every approved candidate was already in the
     * leaf. The next step is the one sentence telling somebody what to do; being permanently and
     * confidently wrong is the worst thing it can be.
     *
     * `approvedNotInLeaf` in `render.ts` is the one answer to this, the same the promote panel
     * gives, so this is the same question answered the same way rather than a second opinion
     * about it. The ids come from the leaf itself; when the leaf could not be read we cannot do
     * the subtraction and the panel has nothing to add into, so no add step is offered at all:
     * review keeps the lead it had, and an unreadable leaf is reported by its own branch below
     * rather than guessed around here.
     */
    /*
     * `ReadonlySet<string>`, not `Set<LeafletId>`, and deliberately: `LeafletId` and
     * `HarvestCandidateId` are separate brands so the two id spaces cannot be mixed by accident,
     * and promotion is the one place they legitimately meet — a promoted candidate keeps its id as
     * the new leaflet's id, which is what makes this subtraction possible at all. `LeafIndex` in
     * `render.ts` widens to `string` at exactly this seam for exactly this reason; matching it
     * keeps the crossing to that one place rather than opening a second.
     */
    const promoted: ReadonlySet<string> | null = leafLoad.ok
      ? new Set<string>(leafLoad.leaf.leaflets.map((l) => l.id))
      : null;
    const ready = promoted === null ? 0 : approvedNotInLeaf(harvestLoad.harvest, promoted).length;
    if (ready > 0) {
      return {
        text: `Add ${ready} approved to your record`,
        href: REVIEW_PROMOTE_HREF,
        ...(review === null ? {} : { also: review }),
      };
    }
    if (review !== null) return review;
  }
  if (!leafLoad.ok && (leafLoad.cause === "absent" || leafLoad.cause === "unconfigured")) {
    return { text: "Connect a source", href: "/workflow#sources" };
  }
  if (leafLoad.ok && leafLoad.leaf.leaflets.length === 0) {
    return { text: "Connect a source", href: "/workflow#sources" };
  }
  return { text: "Nothing waiting", href: LEAF_ROUTE };
}

export function renderOverviewPage(
  leafLoad: LeafLoad,
  harvestLoad: HarvestLoad,
  _policy: PublishPolicy,
  _policySource: PolicySource,
  /** Every collection source is paused: the queue is counted as /review shows it. */
  paused = false,
): string {
  // APPROVED WORK, NOTHING LEFT TO REVIEW, AND NO RECORD: creating the record is the next step.
  // `nextStep` cannot say so — it would offer to add into a record that is not there. While
  // drafts remain open, review keeps the lead and the garden section links the record step.
  const createFirst = approvedWithoutRecord(leafLoad, harvestLoad) > 0 && harvestLoad.ok &&
    shownQueue(harvestLoad.harvest.candidates, paused).open === 0;
  const step: ReturnType<typeof nextStep> = createFirst ? CREATE_RECORD : nextStep(leafLoad, harvestLoad, paused);
  const band = leafLoad.ok ? fabricationBand(leafLoad.source) : "";
  const noLeaf = !leafLoad.ok && leafLoad.cause === "absent";
  const noDrafts = harvestLoad.ok ? harvestLoad.harvest.candidates.length === 0 :
    harvestLoad.cause === "absent";
  const firstUse = noLeaf && noDrafts;
  const next = step.text === "Nothing waiting" ? "" : `<div class="ov-next" data-next-step="true">
<span class="fol-label">Next</span><a class="fol-button fol-button-primary" href="${esc(step.href)}">${esc(step.text)}</a>${
    step.also === undefined ? "" : `<a class="ov-secondary" href="${esc(step.also.href)}">${esc(step.also.text)}</a>`
  }
</div>`;
  const firstUseBody = `<section class="ov-first-use" aria-labelledby="ov-h" data-overview-first-use>
<h1 id="ov-h">Your work deserves a record</h1>
<p>Keep your work, decisions, and discoveries in one private place. Connect a source to prepare drafts you can review and keep with their evidence.</p>
<div class="ov-first-use-actions"><a class="fol-button fol-button-primary" href="/workflow#sources">Connect a source</a><a class="ov-secondary" href="/leaf/import">Import a portfolio</a></div>
</section>`;
  const work = leafLoad.ok ? workSection(leafLoad.leaf) : "";
  const body = `${band}<div class="ov-content${work ? "" : " ov-content--no-work"}">${firstUse ? firstUseBody : `<header class="ov-lead"><h1 id="ov-h">Home</h1>
${next}</header>
${work}${gardenSection(leafLoad, harvestLoad, !createFirst)}${reviewSection(harvestLoad, paused)}`}
</div>`;

  return page({
    title: "Home · Foliage",
    state: "ok",
    surface: "overview",
    empty: false,
    face: "night",
    nav: "overview",
    body,
  });
}
