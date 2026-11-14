/**
 * The Harvest overview — GET `/garden`, still, on purpose (see below).
 *
 * "GARDEN" MEANT TWO THINGS, and a user-testing session caught it: this page's H1 already said
 * "Harvest overview" while the nav item pointing at it said "Garden" — and Overview's own tier
 * block (verified/pending/excluded, the leaf itself) is ALSO titled "Garden", a different concept
 * entirely. The nav label and this file's own eyebrow/title now say "Harvest" throughout, matching
 * the H1 that was already right. THE ROUTE STAYS `/garden`, and so does every internal identifier
 * (`GARDEN_ROUTE`, the `NavKey`, `data-surface="garden"`, this file's own name) — renaming those
 * is a bigger, riskier change than the copy needed, and nothing user-facing reads an internal key.
 *
 * WHERE THIS SITS RELATIVE TO `/review`. `/review` is the WORKBENCH — one candidate at a time,
 * a form beside each one, the place a decision actually gets made. This page is the FIELD VIEW:
 * every candidate at once, grouped by review state, ordered by how recently its evidence was
 * observed. Nothing here decides anything — there is no form on this page — so it carries no CSP
 * relaxation and no POST route.
 *
 * COUNTS ARE RECOMPUTED, NEVER CACHED. Every number below is tallied from the `HarvestDocument`
 * this page is handed, on every render — the same posture `reviewCounts` in `render.ts` takes,
 * because the harvest is a file the CLI writes to and a cached tally would show a queue that had
 * already moved.
 *
 * INTAKE FRESHNESS reads `evidence[].observedAt` — the instant a source was actually looked at,
 * not `draftedAt` (when a title was written FROM what was observed, which can lag behind it) and
 * not a decision's own `at` (when a person acted, a different clock entirely). A candidate can
 * cite several refs observed at different times; this page takes the MOST RECENT of a candidate's
 * own refs as that candidate's freshness, because that is the newest fact the draft rests on.
 */

import type { HarvestCandidate, ReviewState } from "@foliage/photosynthesis";
import { ui } from "@foliage/ui";

import { PROPOSE_COMMAND, esc, page, type HarvestLoad } from "./render.ts";
import { HARVEST_LOAD_LABEL } from "./loadLabels.ts";

const REVIEW_STATE_LABEL: Readonly<Record<ReviewState["state"], string>> = Object.freeze({
  candidate: "Unreviewed",
  approved: "Approved",
  rejected: "Rejected",
});
const OBSERVED_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

/** The most recent `observedAt` among one candidate's own evidence refs, ISO string compare. */
function freshestObservedAt(candidate: HarvestCandidate): string {
  return candidate.evidence.reduce(
    (latest, e) => (e.observedAt > latest ? e.observedAt : latest),
    candidate.evidence[0]?.observedAt ?? "",
  );
}

/**
 * When the work itself happened: the oldest to newest git author date among a candidate's refs.
 * A second clock beside freshness, never mixed into it — Observed still sorts this page. Only
 * git refs carry `authoredAt`; a candidate with none shows no line rather than a guessed date.
 * It reads Authored, as Work names it: a rebased commit was committed later than it was authored.
 */
function authoredLine(candidate: HarvestCandidate): string {
  const dated = candidate.evidence
    .flatMap((e) => (e.source === "git" && e.authoredAt !== undefined ? [e.authoredAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const from = dated[0];
  const to = dated.at(-1);
  if (from === undefined || to === undefined) return "";
  const days = OBSERVED_DAY_FORMAT.formatRange(new Date(from), new Date(to));
  return `<span class="garden-authored" data-author-date-from="${esc(from)}" data-author-date-to="${esc(to)}" title="${esc(from === to ? from : `${from} – ${to}`)}">Authored <span class="fol-metric">${esc(days)}</span></span>`;
}

function observedDay(iso: string): string {
  if (iso === "") return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : OBSERVED_DAY_FORMAT.format(date);
}

function extractorLabel(extractor: string): string {
  if (extractor === "git-cluster") return "Git";
  if (extractor.startsWith("reviewer:")) return extractor.slice("reviewer:".length) || "Reviewer";
  return extractor;
}

function countCells(candidates: readonly HarvestCandidate[]): string {
  const counts: Record<ReviewState["state"], number> = { candidate: 0, approved: 0, rejected: 0 };
  for (const c of candidates) counts[c.review.state]++;
  return `<div class="garden-counts" aria-label="Draft review states">
${(["candidate", "approved", "rejected"] as const)
  .map(
    (state) => `<span class="garden-count" data-garden-count="${state}"><b class="fol-metric leaf-count">${counts[state]}</b><span>${esc(REVIEW_STATE_LABEL[state])}</span></span>`,
  )
  .join("\n")}
</div>`;
}

/** One row of the freshness table. `esc` on every field: an extractor id and a title are files. */
function freshnessRow(c: HarvestCandidate): string {
  const observed = freshestObservedAt(c);
  // `data-authored="drafted-title"` — the SAME marker `render.ts`'s review queue puts on a
  // candidate's title: this is machine-drafted prose nobody has approved yet, never the
  // subject's own words. It carries no exemption (a drafted title is exactly the thing a NO-SCORE
  // sweep should still be able to see, the same reasoning `render.ts`'s header argues at length),
  // only honest labelling of whose words these are.
  return `<tr role="row" data-garden-row="${esc(c.id)}">
<td role="cell" data-mobile-label="Candidate" data-authored="drafted-title">${esc(c.title)}</td>
<td role="cell" data-mobile-label="State">${esc(REVIEW_STATE_LABEL[c.review.state])}</td>
<td role="cell" data-mobile-label="From" title="${esc(c.extractor)}">${esc(extractorLabel(c.extractor))}</td>
<td role="cell" data-mobile-label="References" class="fol-metric">${c.evidence.length} ${c.evidence.length === 1 ? "ref" : "refs"}</td>
<td role="cell" data-mobile-label="Observed" class="fol-metric">${observed === "" ? "—" : `<time datetime="${esc(observed)}" title="${esc(observed)}">${esc(observedDay(observed))}</time>`}${authoredLine(c)}</td>
</tr>`;
}

function gardenFailure(load: Extract<HarvestLoad, { ok: false }>): string {
  if (load.cause === "absent" || load.cause === "unconfigured") {
    const body = `<section class="leaf-subject" aria-labelledby="garden-h"><div class="leaf-subject-text"><h1 id="garden-h">Harvest</h1></div></section>
${ui.emptyState("No drafts yet", [{ label: "Connect a source", href: "/workflow#sources" }])}
<details class="leaf-detail"><summary>Command line</summary><p class="fol-metric">${esc(PROPOSE_COMMAND)}</p><p class="fol-metric">${esc(load.detail)}</p></details>`;
    return page({ title: "Foliage — harvest", state: load.cause, surface: "garden", empty: false, face: "night", nav: "garden", body });
  }
  const remedy: Readonly<Record<typeof load.cause, string>> = {
    unreadable: "Check file permissions and reload.",
    malformed: "Correct the draft file and reload.",
    invalid: "Repair the draft file and reload.",
  };
  const body = `<section class="leaf-subject" aria-labelledby="garden-h">
<div class="leaf-subject-text">
<h1 id="garden-h">${esc(HARVEST_LOAD_LABEL[load.cause])}</h1>
</div>
</section>
<section aria-labelledby="garden-h">
<p class="aside">${remedy[load.cause]}</p>
<details class="leaf-detail"><summary>Details</summary><p class="fol-metric">${esc(load.detail)}</p></details>
</section>`;
  return page({
    title: "Foliage — harvest",
    state: load.cause,
    surface: "garden",
    empty: false,
    face: "night",
    nav: "garden",
    body,
  });
}

export function renderGardenPage(load: HarvestLoad): string {
  if (!load.ok) return gardenFailure(load);

  const candidates = load.harvest.candidates;
  if (candidates.length === 0) {
    return page({
      title: "Foliage — harvest",
      state: "ok",
      surface: "garden",
      empty: true,
      face: "night",
      nav: "garden",
      body: `<section class="leaf-subject" aria-labelledby="garden-h"><div class="leaf-subject-text"><h1 id="garden-h">Harvest</h1></div></section>
${ui.emptyState("No drafts yet", [{ label: "Connect a source", href: "/workflow#sources" }])}
<details class="leaf-detail"><summary>Command line</summary><p class="fol-metric">${esc(PROPOSE_COMMAND)}</p></details>`,
    });
  }

  const freshest = candidates.reduce(
    (latest, c) => {
      const at = freshestObservedAt(c);
      return at > latest ? at : latest;
    },
    freshestObservedAt(candidates[0]!),
  );
  const byFreshness = [...candidates].sort((a, b) =>
    freshestObservedAt(b).localeCompare(freshestObservedAt(a)),
  );

  const body = `<section class="leaf-subject garden-subject" aria-labelledby="garden-h">
<div class="leaf-subject-text">
<h1 id="garden-h">Harvest</h1>
</div><a class="garden-review-action fol-button fol-button-primary btn btn-primary" href="/review">Review drafts</a>
</section>
${countCells(candidates)}
<section class="garden-drafts" aria-labelledby="garden-drafts-h">
<div class="garden-list-heading"><h2 id="garden-drafts-h">Drafts</h2><p data-freshest="${esc(freshest)}">Observed <time datetime="${esc(freshest)}" title="${esc(freshest)}">${esc(observedDay(freshest))}</time></p></div>
<div class="fol-table-wrap leaf-stacked-table-wrap">
<table class="fol-table leaf-stacked-table" role="table">
<thead role="rowgroup"><tr role="row">
<th scope="col">Candidate</th><th scope="col">State</th><th scope="col">From</th>
<th scope="col">References</th><th scope="col">Observed</th>
</tr></thead>
<tbody role="rowgroup">
${byFreshness.map(freshnessRow).join("\n")}
</tbody>
</table>
</div>
</section>
<details class="leaf-detail garden-document"><summary>Document</summary><p class="fol-metric">${esc(load.path)}</p></details>`;

  return page({
    title: "Foliage — harvest",
    state: "ok",
    surface: "garden",
    empty: false,
    face: "night",
    nav: "garden",
    body,
  });
}
