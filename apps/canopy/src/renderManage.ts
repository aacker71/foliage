import { workspaceHeader, ui } from "@foliage/ui";
import { portfolioReviewDigest } from "./manageState.ts";
/** Server-rendered, zero-script Canopy Cloud management page. */

import { toArtifactJson } from "@foliage/canopy";
import type { ManageReadyState, ManageState } from "./manageState.ts";
import type { PublicationInventory } from "./publicationInventory.ts";

export interface ManageNotice {
  readonly tone: "success" | "error";
  readonly heading: string;
  readonly detail: string;
}

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});
const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
function shortReference(id: string): string {
  const digest = /^(.*?:)?([a-f\d]{40})$/i.exec(id);
  if (digest) return `${digest[1] ?? ""}${digest[2]!.slice(0, 7)}`;
  return id.length > 24 ? `${id.slice(0, 17)}…` : id;
}
function reference(id: string): string {
  return `<code class="manage-short-ref" title="${esc(id)}" aria-label="Full reference: ${esc(id)}">${esc(shortReference(id))}</code>`;
}
const publicationDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

/** Shared orientation for local publication review and hosted connection. */
export function manageHeader(active: "publication" | "hosting" | "assessment"): string {
  return workspaceHeader({ layout:"rail", home:"/",section:"Canopy",links:[{label:"Publication",href:"/",current:active === "publication"},{label:"Hosting",href:"/workspace",current:active === "hosting"},{label:"Assessment (cloud)",href:"/ladybug",current:active === "assessment"}],tools:[{label:"Publications",href:"/#publications-h"},{label:"Hosted connection",href:"/hosted"}],privacy:"Private workspace" });
}

function shell(body: string): string {
  return `<!doctype html>
<html lang="en" data-face="night"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canopy Cloud · Foliage</title>
<link rel="icon" href="/mark-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/canopy-base.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/manage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/workspace-shell.css">
</head><body class="plane--internal manage fol-app">

${manageHeader(body.includes("ladybug-workspace") ? "assessment" : "publication")}
${body.replace(/<main class="/g, '<main class="fol-app-main ')}
<footer class="manage-foot wrap fol-app-footer"><span>Canopy Cloud</span></footer>
</body></html>`;
}

function notice(value: ManageNotice | undefined): string {
  if (value === undefined) return "";
  return ui.feedbackNotice(value.detail, { heading:value.heading, tone:value.tone === "error" ? "error" : "status", tabIndex:-1, autoFocus:true, className:"manage-notice" });
}

function blocked(
  state: Extract<ManageState, { kind: "blocked" }>,
  value: ManageNotice | undefined,
  csrf: string,
  inventory: PublicationInventory,
  publicOrigin: string,
): string {
  const issues = state.issues.length === 0
    ? ""
    : `<ul class="manage-issues">${state.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>`;
  return shell(`<main class="wrap manage-main" data-manage-state="${esc(state.cause)}">
    ${notice(value)}
    <section class="manage-hero">
      <div><h1>${esc(state.heading)}</h1>
      <p class="lede">${esc(state.detail)}</p>${issues}</div>
      <div class="manage-state"><span class="rel rel--internal">Release blocked</span></div>
    </section>

    <section class="manage-empty cell">
      <h2>Setup</h2>
      <code>FOLIAGE_LEAF=/path/to/leaf.json FOLIAGE_PUBLISHED=/path/to/publications pnpm --filter @foliage/canopy-app manage</code>
    </section>
    ${publicationInventory(inventory, csrf, publicOrigin)}
  </main>`);
}

function stateCopy(state: ManageReadyState): { label: string; detail: string; step: "review" | "decision" | "public" } {
  switch (state.publication.kind) {
    case "store-unconfigured":
      return { label: "Store not configured", detail: state.publication.detail, step: "review" };
    case "not-published":
      return { label: "Not published", detail: "", step: "decision" };
    case "unreadable":
      return { label: "Public state unreadable", detail: state.publication.detail, step: "review" };
    case "update-available":
      return { label: "Update available", detail: "", step: "decision" };
    case "live":
      return { label: "Live", detail: "", step: "public" };
  }
}

/** Presentation alone is styling; only admitted content makes this release nonempty. */
function hasReleaseContent(state: ManageReadyState): boolean {
  const { leaflets, portfolio } = state.preview.leaf;
  return leaflets.length > 0 || hasPortfolioContent(portfolio);
}

type PublicPortfolio = ManageReadyState["review"]["published"]["portfolio"];
function hasPortfolioContent(portfolio: PublicPortfolio): boolean {
  return Boolean(
    portfolio?.headline || portfolio?.profile?.bio || portfolio?.profile?.direction ||
    portfolio?.profile?.passions?.length || portfolio?.achievements?.length || portfolio?.collections?.length,
  );
}

function publicationAction(state: ManageReadyState, csrf: string): string {
  const id = state.review.published.id;
  if (state.publication.kind === "store-unconfigured" || state.publication.kind === "unreadable") return "";

  const publish = state.publication.kind === "not-published" || state.publication.kind === "update-available";
  const emptyRelease = !hasReleaseContent(state);
  return `<div class="manage-actions">
    ${publish ? `<form class="manage-confirm" action="/publish" method="post">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <input type="hidden" name="sourceDigest" value="${esc(state.sourceDigest)}">
      <input type="hidden" name="policyDigest" value="${esc(state.policyDigest)}">
      <input type="hidden" name="portfolioDigest" value="${esc(portfolioReviewDigest(state))}">
      ${state.includePortfolio ? '<input type="hidden" name="includePortfolio" value="on">' : ""}
      ${state.publication.kind === "update-available" ? `<input type="hidden" name="republish" value="true"><input type="hidden" name="publicDigest" value="${esc(state.publication.artifactDigest)}">` : ""}
      <label for="confirm-publish"><span class="lab">To confirm ${state.publication.kind === "update-available" ? "replacement" : "publication"}, type <strong class="manage-id num">${esc(id)}</strong></span></label>
      <div class="manage-confirm-row"><input class="field" id="confirm-publish" name="confirm" autocomplete="off" spellcheck="false" required>
        <button class="btn ${emptyRelease ? "btn-ghost" : "manage-primary"}" type="submit">${state.publication.kind === "update-available" ? "Replace leaf" : emptyRelease ? "Publish empty leaf" : "Publish leaf"}</button></div>
    </form>` : ""}
  </div>`;
}

function publicationInventory(
  inventory: PublicationInventory,
  csrf: string,
  publicOrigin: string,
): string {
  if (inventory.kind === "unconfigured") return "";
  if (inventory.kind === "unreadable") {
    return `<section class="manage-publications cell"><h2>Storage unreadable</h2><p>${esc(inventory.detail)}</p></section>`;
  }
  if (inventory.items.length === 0) {
    return `<section class="manage-publications cell"><h2>Nothing live</h2></section>`;
  }
  return `<section class="manage-publications" aria-labelledby="publications-h">
    <div class="manage-section-head"><div><h2 id="publications-h">Publications</h2></div></div>
    <ol class="manage-publication-list">${inventory.items.map((item, index) => `<li class="cell">
      <div><span class="rel ${item.kind === "valid" ? "rel--live" : "rel--review"}">${item.kind === "valid" ? "Live" : item.kind === "invalid" ? "Invalid" : "Unreadable"}</span>
        <h3>${esc(item.subject ?? item.id)}</h3><code>${esc(item.id)}</code>
        ${item.kind === "valid" ? `<a class="link" href="${esc(new URL(item.url, publicOrigin).href)}">Open public leaf</a>` : `<p>${esc(item.detail)}</p>`}
        ${item.publishedAt === null ? "" : `<p>Published <time class="num" datetime="${esc(item.publishedAt)}" title="${esc(item.publishedAt)}">${esc(publicationDateTime.format(new Date(item.publishedAt)))}</time> UTC</p>`}
        ${item.artifactDigest === null ? "<small>Withdraw unavailable</small>" : `<details class="manage-publication-details"><summary>Publication details</summary><code>${esc(item.artifactDigest)}</code></details>`}</div>
      ${item.artifactDigest === null ? "" : `<form class="manage-withdraw" id="manage-withdraw-${index}" tabindex="-1" action="/withdraw" method="post">
        <input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="id" value="${esc(item.id)}">
        <input type="hidden" name="publicationDigest" value="${esc(item.artifactDigest)}">
        <label for="confirm-withdraw-${index}"><span class="lab">To confirm withdrawal, type <strong class="manage-id num">${esc(item.id)}</strong></span></label>
        <div class="manage-confirm-row"><input class="field" id="confirm-withdraw-${index}" name="confirm" autocomplete="off" spellcheck="false" required>
          <button class="btn btn-ghost" type="submit">Withdraw</button></div>
      </form>`}
    </li>`).join("")}</ol>
  </section>`;
}

const JEV_LABEL = { keep: "Jev: keep", pass: "Jev: pass", unresolved: "Jev: unsure" } as const;
/** Jev's draft-time mark beside an item the owner is about to publish. Advice; the owner decides. */
function jevNote(state: ManageReadyState, id: string): string {
  const mark = state.jev?.kind === "marks" ? state.jev.marks.get(id) : undefined;
  return mark === undefined ? "" : `<small data-jev-mark="${mark}">${JEV_LABEL[mark]}</small>`;
}

/** Show only the portfolio fields in the admitted public projection, never the private source. */
function portfolioReview(portfolio: PublicPortfolio): string {
  if (!hasPortfolioContent(portfolio) || !portfolio) return "";
  const rows: [string, string][] = [];
  if (portfolio.headline) rows.push(["Headline", esc(portfolio.headline)]);
  if (portfolio.profile?.bio) rows.push(["Introduction", esc(portfolio.profile.bio)]);
  if (portfolio.profile?.direction) rows.push(["Direction", esc(portfolio.profile.direction)]);
  if (portfolio.profile?.passions?.length) rows.push(["Interests", portfolio.profile.passions.map(esc).join(" · ")]);
  if (portfolio.achievements?.length) rows.push(["Selected work", `<span class="num">${portfolio.achievements.length}</span> · ${portfolio.achievements.map((item) => esc(item.title)).join(" · ")}`]);
  if (portfolio.collections?.length) rows.push(["Collections", `<span class="num">${portfolio.collections.length}</span> · ${portfolio.collections.map((item) => esc(item.title)).join(" · ")}`]);
  return `<section class="manage-portfolio-context" aria-labelledby="manage-portfolio-context-h"><h3 id="manage-portfolio-context-h">Portfolio in this release</h3>
    <dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl></section>`;
}

function reviewLists(state: ManageReadyState): string {
  const published = state.review.published.leaflets;
  const withheld = state.review.withheld;
  return `<section class="manage-review" aria-labelledby="review-h">
    <div class="manage-section-head"><div><h2 id="review-h">Review</h2></div></div>
    <div class="cell manage-public-subject"><span class="lab">Public subject</span><strong>${esc(state.review.published.subject)}</strong>${state.review.published.subjectRedacted ? "<small>Redacted</small>" : ""}</div>
    ${portfolioReview(state.preview.leaf.portfolio)}
    <div class="manage-review-grid">
      <div class="cell"><div class="manage-cell-head"><h3>${state.publication.kind === "live" ? "Published leaflets" : "Leaflets to publish"}</h3><span class="num">${published.length}</span></div>
        ${published.length === 0 ? '<p class="manage-zero">No leaflets in this release</p>' : `<ol class="manage-list">${published.map((leaflet) => `<li><div class="manage-work-summary"><strong>${esc(leaflet.title)}</strong>${reference(leaflet.id)}${leaflet.titleRedacted ? "<small>Title redacted</small>" : ""}${jevNote(state, leaflet.id)}</div><span class="proof-dot"><span class="t">${leaflet.tier === "verified" ? "Verified" : "Pending"}</span></span></li>`).join("")}</ol>`}${state.jev?.kind === "unread" ? '<p class="manage-zero" data-jev-unread>Jev marks unavailable</p>' : ""}
      </div>
      <details class="cell manage-withheld"><summary class="manage-cell-head"><span>Stays private</span><span class="num">${withheld.length}</span></summary>
        ${withheld.length === 0 ? '<p class="manage-zero">None withheld</p>' : `<ol class="manage-list manage-list--withheld">${withheld.map((entry) => `<li><span class="lab">${esc(entry.kind)}</span><details><summary><strong>${esc(entry.item)}</strong><code>${esc(entry.at)}</code></summary><p>${esc(entry.reason)}</p></details></li>`).join("")}</ol>`}
      </details>
    </div>
    <details class="manage-payload cell"><summary>Full public document</summary>
      <p><code>publishedAt</code> is set on publish.</p>
      <pre data-publication-payload><code>${esc(JSON.stringify(toArtifactJson(state.preview), null, 2))}</code></pre>
    </details>
  </section>`;
}

function portfolioComparison(before: PublicPortfolio, after: PublicPortfolio): string {
  const text = (value: unknown) => value === undefined || value === "" ? "<p class=\"manage-absent\">Not included</p>" : `<p>${esc(value)}</p>`;
  const achievements = (value: PublicPortfolio) => value?.achievements?.map(a => `<section><h4>${esc(a.title)}</h4>${a.claims.map(c => `<p>${esc(c.text)}</p><details><summary>Evidence references</summary><pre>${esc(JSON.stringify(c.citations ?? [], null, 2))}</pre></details>`).join("")}</section>`).join("") || text(undefined);
  const collections = (value: PublicPortfolio) => value?.collections?.map(c => `<section><h4>${esc(c.title)}</h4>${text(c.description)}<details><summary>Selected items</summary><pre>${esc(JSON.stringify({kind:c.kind,achievements:c.achievements,leaflets:c.leaflets}, null, 2))}</pre></details></section>`).join("") || text(undefined);
  const fields = [
    ["Headline", before?.headline, after?.headline, text(before?.headline), text(after?.headline)],
    ["Introduction", before?.profile?.bio, after?.profile?.bio, text(before?.profile?.bio), text(after?.profile?.bio)],
    ["Direction", before?.profile?.direction, after?.profile?.direction, text(before?.profile?.direction), text(after?.profile?.direction)],
    ["Interests", before?.profile?.passions, after?.profile?.passions, text(before?.profile?.passions?.join("\n")), text(after?.profile?.passions?.join("\n"))],
    ["Selected work", before?.achievements, after?.achievements, achievements(before), achievements(after)],
    ["Collections", before?.collections, after?.collections, collections(before), collections(after)],
  ];
  return fields.filter(([,oldValue,newValue]) => JSON.stringify(oldValue) !== JSON.stringify(newValue)).map(([label,,,oldHtml,newHtml]) =>
    `<li class="manage-portfolio-change"><h3>${esc(label)}</h3><div class="manage-comparison"><section><h4>Currently public</h4>${oldHtml}</section><section><h4>After replacement</h4>${newHtml}</section></div></li>`).join("");
}

function diff(state: ManageReadyState): string {
  if (state.publication.kind !== "update-available") return "";
  const value = state.publication.diff;
  const previous = state.publication.document;
  const pair = (before: string, after: string) => `<div class="manage-comparison"><p><span class="lab">Currently public</span><br>${esc(before)}</p><p><span class="lab">After replacement</span><br>${esc(after)}</p></div>`;
  const rows = [
    ...(value.subjectChanged ? ['<li><span aria-hidden="true">~</span><code>subject</code><strong>Public subject name will change</strong></li>'] : []),
    ...value.added.map((id) => `<li><span aria-hidden="true">+</span><div><strong>Will appear</strong><p>${esc(state.review.published.leaflets.find(item => item.id === id)?.title ?? id)}</p>${reference(id)}</div></li>`),
    ...value.removed.map((id) => `<li><span aria-hidden="true">−</span><div><strong>Will disappear</strong><p>${esc(previous.leaf.leaflets.find(item => item.id === id)?.title ?? id)}</p>${reference(id)}</div></li>`),
    ...value.changed.map((item) => `<li><span aria-hidden="true">~</span>${reference(item.id)}<strong>${[...(item.before !== item.after || item.redactionChanged ? ["Public wording will change"] : []), ...(item.narrativeChanged ? ["Public narrative will change"] : []), ...(item.photosChanged ? ["Selected photos will change"] : []), ...("videosChanged" in item && item.videosChanged ? ["Selected demos will change"] : []), ...(item.provenanceChanged ? ["Public provenance will change"] : []), ...(item.tierChanged ? [`Proof tier: ${previous.leaf.leaflets.find((leaflet) => leaflet.id === item.id)?.tier} → ${state.review.published.leaflets.find((leaflet) => leaflet.id === item.id)?.tier}`] : [])].map(esc).join(" · ")}</strong>${pair(item.before, item.after)}</li>`),
    ...(value.portfolioChanged ? [portfolioComparison(previous.leaf.portfolio, state.review.published.portfolio)] : []),
    ...(value.artifactMetadataChanged ? ['<li><span aria-hidden="true">~</span><code>artifact</code><strong>Public format or identity will change</strong></li>'] : []),
    ...(value.sourceRecordChanged ? ['<li><span aria-hidden="true">~</span><code>source</code><strong>Public source record will change</strong></li>'] : []),
    ...(value.withholdingKindsChanged ? ['<li><span aria-hidden="true">~</span><code>withheld</code><strong>Public withholding breakdown will change</strong></li>'] : []),
    ...(value.leafletOrderChanged ? ['<li><span aria-hidden="true">~</span><code>order</code><strong>Public leaflet order will change</strong></li>'] : []),
    ...(!state.publication.samePolicy ? ['<li><span aria-hidden="true">~</span><code>policy</code><strong>Publication rules differ from the live release</strong></li>'] : []),
  ].join("");
  return `<section class="manage-diff cell"><div class="manage-cell-head"><h2>Changes</h2></div>
    ${rows === "" ? "<p>Differs from the live release</p>" : `<ul>${rows}</ul>`}
  </section>`;
}

function ready(
  state: ManageReadyState,
  csrf: string,
  value: ManageNotice | undefined,
  publicOrigin: string,
  inventory: PublicationInventory,
): string {
  const copy = stateCopy(state);
  const emptyRelease = !hasReleaseContent(state);
  const heading = state.publication.kind === "not-published" && emptyRelease
    ? "Nothing ready for publication"
    : state.publication.kind === "live" ? emptyRelease ? "Empty leaf is live" : "Published work"
    : state.publication.kind === "update-available" ? "Review changes"
    : "Review publication";
  const publicLink = state.publication.kind === "live" || state.publication.kind === "update-available"
    ? `<a class="link" href="${esc(new URL(state.publication.url, publicOrigin).href)}">Open public leaf</a>`
    : "";
  const liveArtifactDigest = state.publication.kind === "live" || state.publication.kind === "update-available"
    ? state.publication.artifactDigest
    : null;
  const currentPublication = inventory.kind === "ready" && liveArtifactDigest !== null
    ? inventory.items.findIndex((item) => item.id === state.review.published.id && item.artifactDigest === liveArtifactDigest)
    : -1;
  const withdrawLink = currentPublication !== -1
    ? `<a class="btn btn-ghost manage-withdraw-link" href="#manage-withdraw-${currentPublication}">Withdraw this leaf</a>`
    : "";
  const decisionLink = state.publication.kind === "live" ? ""
    : state.publication.kind === "not-published" && emptyRelease
      ? '<a class="btn btn-ghost manage-decision-link" href="#manage-include">Include portfolio sections</a>'
      : '<a class="btn btn-ghost manage-decision-link" href="#publication-decision">Publish decision</a>';
  const decision = state.publication.kind === "live" ? "" : `<aside class="manage-decision" id="publication-decision" tabindex="-1"><h2>Publish</h2>
    ${publicationAction(state, csrf)}</aside>`;
  return shell(`<main class="wrap manage-main manage-workspace" data-manage-state="${esc(state.publication.kind)}">
    ${notice(value)}
    <section class="manage-hero">
      <div><h1>${heading}</h1><p class="lede">${esc(state.leaf.subject)}</p></div>
      <div class="manage-state"><span class="rel ${state.publication.kind === "live" ? "rel--live" : state.publication.kind === "update-available" ? "rel--review" : "rel--proposed"}">${esc(copy.label)}</span><div class="manage-state-actions">${publicLink}${withdrawLink}${decisionLink}</div></div>
    </section>
    <div class="manage-reading-layout"><div id="publication-review" class="manage-review-body">
    ${diff(state)}
    ${reviewLists(state)}
    <details class="manage-review-options" id="manage-include"${emptyRelease ? " open" : ""}><summary>Include portfolio sections</summary><form class="manage-context-choice" method="get" action="/"><label><input type="checkbox" name="includePortfolio"${state.includePortfolio ? " checked" : ""}> Introduction, achievements and collections</label><button class="btn" type="submit">Update review</button></form></details>
    ${state.review.portfolioOmissions?.length ? `<section class="manage-context-omissions"><h2>Kept private</h2><ul>${state.review.portfolioOmissions.map(item => `<li><code>${esc(item.at)}</code> ${esc(item.reason)}</li>`).join("")}</ul></section>` : ""}
    <details class="manage-limits"><summary>Source</summary>
    <section class="manage-facts" aria-label="Local leaf facts">
      <div class="cell"><span class="lab">Local subject</span><strong>${esc(state.leaf.subject)}</strong><code>${esc(state.review.published.id)}</code></div>
      <div class="cell"><span class="lab">Composition</span><strong class="num">${state.leaf.leaflets.length}</strong><small><span class="num">${state.ledger.verified}</span> verified · <span class="num">${state.ledger.pending}</span> pending · <span class="num">${state.ledger.excluded}</span> excluded</small></div>
      <div class="cell"><span class="lab">Publication rules</span><strong>${esc(state.policySource)}</strong><code>${esc(state.policyDigest)}</code></div>
      <div class="cell"><span class="lab">Source document</span><code>${esc(state.sourceDigest)}</code><small class="num">${state.sourceBytes} bytes</small></div>
    </section>
    </details>
    <details class="manage-limits"><summary>Review limits</summary><ul>${state.review.limits.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul></details>
    </div>${decision}</div>
    <div id="publications">${publicationInventory(inventory, csrf, publicOrigin)}</div>
  </main>`);
}

export function renderManagePage(
  state: ManageState,
  csrf: string,
  value?: ManageNotice,
  publicOrigin = "http://127.0.0.1:4173",
  inventory: PublicationInventory = { kind: "ready", items: [] },
): string {
  return state.kind === "blocked"
    ? blocked(state, value, csrf, inventory, publicOrigin)
    : ready(state, csrf, value, publicOrigin, inventory);
}

export { shell as renderManageShell, esc as escapeManage };
