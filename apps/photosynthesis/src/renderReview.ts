/** Native review forms preserve the existing decision and promotion gates.
 * Shared controls and workspace chrome use the package exports; this module owns only
 * review composition. Same-origin fonts/assets, private night face, no client scripts.
 */
import { workspaceHeader } from "@foliage/ui";
import type { Candidate, HarvestDocument } from "./harvestDocument.ts";

/**
 * The icon sprite that must be inlined rather than linked, read once by the
 * server from `@foliage/tokens`. Passed in rather than imported so this module stays a
 * pure function of its inputs — and so there is no second copy of either file here.
 */
export interface PageAssets {
  /** `foliage-sprite.svg` verbatim; it already carries class="fol-sprite" aria-hidden. */
  readonly sprite: string;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * This screen predates `foliage up` and is kept for reference only; the dashboard composes it
 * too. The same words go to the start-up log, so a person who never opens the page is told.
 */
export const LEGACY_NOTICE_TEXT =
  "Legacy view. The current app is foliage up (node foliage.mjs up); review drafts there at /review.";

/** The page form of `LEGACY_NOTICE_TEXT`. `data-legacy-notice` lets a composer avoid a second copy. */
export function legacyNotice(): string {
  return `<aside class="fol-feedback-notice legacy-notice" data-legacy-notice aria-label="Legacy view">
<strong>Legacy view</strong>
<span>The current app is <code>foliage up</code> (<code>node foliage.mjs up</code>). Review drafts there at <code>/review</code>.</span>
</aside>`;
}

/**
 * Review state → chip class + word. Promotion adds a leaflet as `pending`; it publishes
 * nothing, so a promoted candidate is "Added", never "Live".
 */
export function reviewState(c: Candidate): { key: string; word: string } {
  if (c.status === "rejected") return { key: "rejected", word: "Rejected" };
  if (c.status === "approved") {
    return c.promotedAt === undefined ? { key: "approved", word: "Approved" } : { key: "added", word: "Added" };
  }
  return { key: "staging", word: "Staging" };
}

const decidedDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The parser admits only ISO instants here; the exact value stays in `datetime`. */
function dateTag(iso: string | undefined): string {
  if (iso === undefined) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `<time datetime="${esc(iso)}">${esc(decidedDate.format(date))}</time>`;
}

/** A sprite icon. Same-document `#id`, which is not a fetch and needs no CSP directive. */
function icon(id: string, size: 14 | 16): string {
  return `<svg class="ico ico-${size}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
}

function provenanceChip(c: Candidate): string {
  const local = c.provenance.method === "local_llm";
  return `<span class="rv-prov${local ? "" : " rv-prov--none"}">${
    local ? `drafted by ${esc(c.provenance.model ?? "local model")} · loopback` : "drafted without a model"
  }</span>`;
}

function candidateCell(c: Candidate, token: string): string {
  const state = reviewState(c);
  return `<article class="cell rv-cell" data-status="${esc(c.status)}" data-state="${state.key}"${
    c.promotedAt === undefined ? "" : ' data-in-leaf="true"'
  }>
  <div class="rv-cell__work">
    <h3 class="rv-title">${esc(c.drafted.title)}</h3>
    <p class="rv-summary">${esc(c.drafted.summary)}</p>
  </div>
  <div class="rv-cell__head">
    <span class="chip chip--${state.key}" data-chip="${state.key}">${state.word}</span>
    ${
      // The one honest proof badge on this screen: promotion writes `pending`, never
      // `verified`. It describes the leaflet in the leaf, not the reviewer's verdict.
      c.promotedAt === undefined
        ? ""
        : `<span class="proof proof-pending">${icon("i-partial", 14)} pending in the leaf</span>`
    }
    ${provenanceChip(c)}
  </div>

  <details class="rv-evidence">
    <summary class="rv-evidence-label">${c.status === "proposed" ? "Review draft" : "Evidence"}</summary>
    <div class="rv-evidence-body">
    ${c.evidence
      .map(
        (e) => `<div class="rv-ev">
      <span class="rv-ev__ref">${esc(e.source)} ${esc(e.ref.slice(0, 12))}</span>
      <span class="rv-ev__text">${esc(e.excerpt)}</span>
    </div>`,
      )
      .join("\n")}
  ${
    c.status === "proposed"
      ? `<div class="rv-actions">
    <form method="post" action="/decide">
      <input type="hidden" name="csrf" value="${esc(token)}">
      <input type="hidden" name="id" value="${esc(c.id)}">
      <input type="hidden" name="verdict" value="approved">
      <button class="btn btn-ghost rv-approve" type="submit">${icon("i-check", 16)}Approve</button>
    </form>
    <form method="post" action="/decide">
      <input type="hidden" name="csrf" value="${esc(token)}">
      <input type="hidden" name="id" value="${esc(c.id)}">
      <input type="hidden" name="verdict" value="rejected">
      <button class="btn btn-ghost" type="submit">${icon("i-exclude", 16)}Reject</button>
    </form>
  </div>`
      : ""
  }
    </div>
  </details>
  ${
    c.status === "proposed"
      ? ""
      : `<p class="note cap rv-decided">${c.status === "rejected" ? "Rejected" : "Approved"} ${dateTag(c.reviewedAt)}${
          c.promotedAt === undefined ? "" : ` · added to the leaf ${dateTag(c.promotedAt)}`
        }</p>`
  }
</article>`;
}

function head(title: string): string {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/mark-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/controls.css">
<link rel="stylesheet" href="/workspace-shell.css">
<link rel="stylesheet" href="/review.css">`;
}

function navigation(): string {
  return workspaceHeader({layout:"rail", section:"Photosynthesis", links:[
    {label:"Review",href:"#main",current:true},
    {label:"Decisions",href:"#decisions"},
  ], tools:[{label:"Source details",href:"#source-details"}], privacy:"Private workspace"});
}

export function renderReviewPage(h: HarvestDocument, token: string, assets: PageAssets): string {
  const open = h.candidates.filter(c => c.status === "proposed");
  const decided = h.candidates.filter(c => c.status !== "proposed");
  const live = h.candidates.filter(c => c.promotedAt !== undefined);
  const toPromote = h.candidates.filter(c => c.status === "approved" && c.promotedAt === undefined);
  return `<!doctype html><html lang="en" data-face="night"><head>${head("Review · Photosynthesis")}</head>
<body class="fol-app">${assets.sprite}<a class="rv-skip" href="#main">Skip to review</a>${navigation()}
<main id="main" class="fol-app-main"><div class="fol-app-content rv-content">${legacyNotice()}
<header class="rv-heading"><div><h1>Review</h1><p>${esc(h.subject)}</p></div>
${toPromote.length ? `<form method="post" action="/promote"><input type="hidden" name="csrf" value="${esc(token)}">
<button class="btn btn-primary" type="submit">${icon("i-check",16)}Add <span class="fol-metric">${toPromote.length}</span> to leaf</button><span class="note">Lands as pending · not published</span></form>` : ""}</header>
<div class="rv-summary-line"><span><b class="fol-metric">${open.length}</b> awaiting review</span><span><b class="fol-metric">${toPromote.length}</b> approved</span><span><b class="fol-metric">${live.length}</b> in the leaf</span></div>
<section class="rv-block" aria-labelledby="awaiting-heading"><h2 id="awaiting-heading">Awaiting review</h2>
${open.length ? `<div class="rv-queue">${open.map(c=>candidateCell(c,token)).join("\n")}</div>` : `<p class="rv-empty">${h.candidates.length ? "Nothing to review" : `No candidates for <code>${esc(h.identity)}</code>`}</p>`}</section>
<section id="decisions" class="rv-block" aria-labelledby="decided-heading"><h2 id="decided-heading">Decisions <span class="fol-metric">${decided.length}</span></h2>
${decided.length ? `<details><summary>Decided</summary><div class="rv-queue">${decided.map(c=>candidateCell(c,token)).join("\n")}</div></details>` : '<p class="rv-empty">Decided · 0</p>'}</section>
<details id="source-details" class="rv-source-details"><summary>Sources</summary>
<p>Sources: <code>${h.sources.map(esc).join("</code>, <code>")}</code></p>
</details>
<footer class="rv-foot">Local · loopback only</footer>
</div></main></body></html>`;
}

/**
 * Where a refusal sends the reader. `"back"` returns to the queue. `"current-app"` is for a queue
 * this server refuses outright: Back would land on the same refusal, so the step is the current app.
 */
export type ErrorNextStep = "back" | "current-app";

const NEXT_STEP: Record<ErrorNextStep, string> = {
  back: '<a class="btn btn-ghost" href="/">Back</a>',
  "current-app": '<p class="rv-next">Review it in the current app: run <code>node foliage.mjs up</code>, then open <code>/review</code>.</p>',
};

/** A refusal retains the shared identity and the existing return path. */
export function renderErrorPage(heading: string, detail: string, assets: PageAssets, next: ErrorNextStep = "back"): string {
  return `<!doctype html><html lang="en" data-face="night"><head>${head(`${heading} · Photosynthesis`)}</head>
<body class="fol-app">${assets.sprite}${workspaceHeader({layout:"rail",section:"Photosynthesis",links:[{label:"Review",href:"/",current:true}],privacy:"Private workspace"})}
<main id="main" class="fol-app-main"><div class="fol-app-content rv-content">${legacyNotice()}<h1>${esc(heading)}</h1><p class="rv-error" role="alert">${esc(detail)}</p>${NEXT_STEP[next]}</div></main></body></html>`;
}
