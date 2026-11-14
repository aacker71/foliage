import { workspaceHeader } from "@foliage/ui";
import { workspaceNavigation } from "./workspaceNavigation.ts";
/** Connected presentation workspace. No draft store or publication authority lives here. */
import { ACHIEVEMENT_CLAIM_LABELS, isSubjectsOwnWork, resolveClaimCitation } from "@foliage/leaf";
import { PROMOTED_SOURCE_PREFIX } from "@foliage/photosynthesis";
import { ui } from "@foliage/ui";
import { esc } from "./render.ts";
import type { LeafLoad } from "./leafDocument.ts";
import { LeafLoadError, leafLoadProblem } from "./loadLabels.ts";
import { storyEvidence } from "./leafletStory.ts";

const labels = ACHIEVEMENT_CLAIM_LABELS;
function supportLabel(status: ReturnType<typeof resolveClaimCitation>["status"]): string {
  switch (status) {
    case "current": return "Reference attached";
    case "stale": return "Reference changed";
    case "missing": return "Reference unavailable";
    case "excluded": return "Not attributed";
    default: { const impossible: never = status; throw new Error(`Unhandled citation state: ${impossible}`); }
  }
}

function current(load: LeafLoad) {
  if (!load.ok) throw new LeafLoadError(load);
  if (load.source.declaredExample || load.source.bundledExample) throw new Error("Select your real Leaf before connecting this editor.");
  return load;
}
export function setupState(load: LeafLoad) {
  const { leaf, source } = current(load);
  return {
    leafId: leaf.id, subject: leaf.subject, documentRevision: source.documentDigest,
    headline: leaf.headline ?? "", profile: leaf.profile ?? {}, achievements: leaf.achievements ?? [],
    collections: leaf.collections ?? [], claimLabels: labels,
    evidence: leaf.leaflets.filter(item => item.tier !== "excluded").flatMap(record => storyEvidence(record).map(provenance => ({
      title: record.title, key: JSON.stringify([record.id, provenance.source, provenance.ref, provenance.observedAt]),
      source: provenance.source, ref: provenance.ref, observedAt: provenance.observedAt,
    }))),
  };
}
export function setupManagerOrigin(env: Readonly<Record<string,string|undefined>>): string | null {
  const value = env["FOLIAGE_CANOPY_MANAGER_ORIGIN"]?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("The Canopy manager must be one exact loopback HTTP origin.");
  return value;
}
function shell(title: string, body: string, reader = false, connected = true): string {
  return `<!doctype html><html lang="en" data-face="${reader ? "day" : "night"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css">${reader ? "" : `<link rel="stylesheet" href="/workspace-shell.css">${connected ? '<script type="module" src="/portfolio-setup.mjs"></script>' : ""}`}<link rel="stylesheet" href="/portfolio-setup.css"></head><body class="${reader ? "face-day connected-reader" : "connected-setup fol-app portfolio-workspace"}">${body}</body></html>`;
}
/** `boundName`: the name the review queue was prepared for (`recordStart`), so its drafts can be added. */
export function renderSetupStart(load: Extract<LeafLoad, { ok: false }>, error = "", boundName: string | null = null): string {
  const canCreate = load.cause === "absent";
  // A record that did not load is said as every other page says it; with none yet, the page starts one.
  const message = canCreate ? "" : esc(leafLoadProblem(load));
  const bound = canCreate && boundName ? `<p>Drafts in Review were prepared for ${esc(boundName)}. Keep this name to add them to your record.</p>` : "";
  return shell("Portfolio", `<a class="setup-skip" href="#start">Skip to content</a>${workspaceHeader(workspaceNavigation("portfolio", { showPortfolioAction: false }))}<main id="start" class="fol-app-main"><div class="fol-app-content"><header class="work-heading"><h1>Portfolio</h1></header><section class="setup-start" aria-labelledby="setup-start-heading"><h2 id="setup-start-heading">${canCreate ? "Start your record" : "Record unavailable"}</h2>${message ? `<p>${message}</p>` : ""}${bound}${error ? `<p role="alert">${esc(error)}</p>` : ""}${canCreate ? `<form method="post" action="/leaf/setup"><input type="hidden" name="action" value="create"><div class="setup-field">${ui.label("Your name", { htmlFor: "subject" })}${ui.input({ id: "subject", name: "subject", required: true, maxLength: 120, autoComplete: "name", ...(boundName ? { defaultValue: boundName } : {}) })}</div>${ui.button("Create private record", { type: "submit" })}</form>` : ""}<p class="setup-start-links"><a href="/workflow#sources">Browse sources</a><a href="/leaf/photosynthesis">Back to work</a></p></section></div></main>`, false, false);
}
const field = (name: string, label: string, max: number, rows = 0) => `<div class="setup-field">${ui.label(label,{htmlFor:name})}${rows ? ui.textarea({id:name,name,maxLength:max,rows}) : ui.input({id:name,name,maxLength:max})}</div>`;
const button = (label: string, id: string, type: "button"|"submit" = "button") => ui.button(label,{id,type,variant:type === "submit" ? "default" : "outline"});
export function renderSetup(managerOrigin: string | null): string {
  return shell("Shape your Leaf", `<a class="setup-skip" href="#editor">Skip to editor</a>${workspaceHeader(workspaceNavigation("portfolio"))}<main class="fol-app-main"><div class="fol-app-content">
  <header class="work-heading"><h1>Portfolio</h1><details class="portfolio-tools"><summary>Portfolio settings</summary><nav aria-label="Portfolio settings"><a href="/leaf/presentation?edit=collection">Views &amp; appearance</a><a id="work-history" href="/leaf/presentation?edit=achievement">History &amp; undo</a><a href="/leaf/resume">Résumé</a>${managerOrigin ? `<a id="review-sharing" href="${esc(managerOrigin)}/hosted">Review for Canopy</a>` : '<a id="review-sharing" href="/publish">Review sharing</a>'}</nav></details></header>
  <div class="editor-status"><strong id="connection-status">Reading your Leaf…</strong><p id="save-status" role="status"></p></div><p id="error" role="alert" tabindex="-1" hidden></p><div id="setup-read-actions" class="claim-actions" hidden>${button("Retry read","retry-read")}<span id="use-current-wrap" hidden>${button("Use current record","use-current-record")}</span></div>
  <nav class="editor-mobile-modes" aria-label="Portfolio workspace" hidden>${button("Your work","mode-edit")}${button("Introduction","show-profile")}${button("Reader preview","mode-preview")}</nav>
  <div class="setup-layout"><section id="editor" class="setup-editor">
  <section id="profile-panel"><h2>Introduction</h2><form id="profile-form" action="/leaf/presentation" method="post"><fieldset disabled><div class="setup-field"><label for="subject">Your name</label><input id="subject" readonly></div>${field("headline","Headline",280)}${field("bio","About you",2600,4)}<details class="profile-more"><summary>Direction &amp; interests</summary>${field("direction","What you’re working toward",1000,3)}${field("passions","Interests · one per line",1600,3)}</details>${button("Save introduction","save-profile","submit")}</fieldset></form></section>
  <section id="work-panel" hidden><div class="work-library"><div class="work-panel-heading"><h2>Selected work</h2>${button("Add work","add-work")}</div><details class="work-list-disclosure" open><summary>Choose work<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 9 6 6 6-6"/></svg></summary><nav id="work-list" aria-label="Selected work"></nav></details></div><div id="work-editor" hidden><h2 id="work-title"></h2><div class="work-title-tools"><form id="title-form"><details id="rename-work"><summary>Edit title</summary>${field("title","Achievement title",180)}${button("Save title","save-title","submit")}</details></form>${button("Move earlier","move-work")}</div><div id="claim-list"></div>${button("Add statement","add-claim")}<form id="claim-form" hidden><h3 id="claim-form-heading">Edit statement</h3><div class="setup-field"><label for="kind">What this statement describes</label><select name="kind" id="kind">${Object.entries(labels).map(([kind,label])=>`<option value="${kind}">${label}</option>`).join("")}</select></div>${field("text","Statement",2600,5)}<details id="citation-picker"><summary>Attach retained evidence</summary><label for="source-search">Find retained work</label><input id="source-search" type="search" placeholder="Search title, source or reference"><div id="citations"></div></details><div class="claim-actions">${button("Save statement","save-claim","submit")}${button("Cancel","cancel-claim")}</div></form></div></section>
  </section>
  <section id="preview" class="setup-preview"><div class="setup-preview-toolbar"><div><strong>Saved preview</strong><a href="/leaf/setup/preview" target="_blank" rel="noopener">Open preview</a></div><div aria-label="Preview width" role="group">${button("Fit","preview-fit")}${button("Phone","preview-phone")}</div></div><iframe loading="lazy" title="Saved private portfolio preview" src="/leaf/setup/preview"></iframe></section></div></div></main><noscript><p><a href="/leaf/presentation">Standard editor</a></p></noscript>`);
}
export function renderSetupPreview(load: LeafLoad): string {
  const { leaf } = current(load);
  const achievements = (leaf.achievements ?? []).map(a => {
    const claims = a.claims.map(claim => {
      const sources = (claim.citations ?? []).map(c => {
        const state = resolveClaimCitation(leaf,c).status;
        return `<p class="reader-source"><strong>${esc(supportLabel(state))}</strong><br>${esc(leaf.leaflets.find(r=>r.id===c.leaflet)?.title ?? "Supporting record unavailable")}<br><code>${esc(c.provenance.ref)}</code>${state === "current" ? `<br><a target="_blank" rel="noopener" href="/my/leaflet/${encodeURIComponent(c.leaflet)}">Inspect retained source</a>` : ""}</p>`;
      }).join("");
      return `<section>${claim.kind === "summary" ? "" : `<h4>${esc(labels[claim.kind])}</h4>`}<p data-authored="subject">${esc(claim.text)}</p>${sources ? `<details><summary>Inspect supporting evidence</summary>${sources}</details>` : '<small>No references</small>'}</section>`;
    }).join("");
    return `<article class="reader-achievement"><h3 data-authored="subject">${esc(a.title)}</h3>${claims || '<p>No statements</p>'}<a target="_blank" rel="noopener" href="/leaf/achievement?id=${encodeURIComponent(a.id)}">View full record</a></article>`;
  }).join("");
  const retained = leaf.leaflets.filter(isSubjectsOwnWork);
  // The preview stays short even for a large garden. Work added from Review leads; raw
  // source observations remain explicitly labelled as retained records, not authored work.
  const promoted = (source: string | undefined) => source?.startsWith(PROMOTED_SOURCE_PREFIX) ?? false;
  const seen = new Set<string>();
  const preview = [...retained.filter(record => promoted(record.provenance?.source)), ...retained.filter(record => !promoted(record.provenance?.source))]
    .filter(record => { if (seen.has(record.title)) return false; seen.add(record.title); return true; })
    .slice(0, 4);
  const records = retained.length ? `<section class="reader-retained" aria-labelledby="reader-retained-h"><h3 id="reader-retained-h">Retained records</h3><ol>${preview.map(record => `<li data-retained-record="${esc(record.id)}"><a target="_top" href="/my/leaflet/${encodeURIComponent(record.id)}">${esc(record.title)}</a></li>`).join("")}</ol><p><a target="_top" href="/leaf/photosynthesis?view=records">Browse records</a></p></section>` : "";
  return shell("Saved Leaf preview", `<header class="reader-header"><span class="setup-brand"><span class="setup-mark" aria-hidden="true"></span>Foliage</span><span>Private preview</span></header><main><section class="reader-intro"><div><h1>${esc(leaf.subject)}</h1>${leaf.headline ? `<p class="reader-headline" data-authored="subject">${esc(leaf.headline)}</p>` : ""}${leaf.profile?.direction ? `<p data-authored="subject">${esc(leaf.profile.direction)}</p>` : ""}${leaf.profile?.bio ? `<p data-authored="subject">${esc(leaf.profile.bio)}</p>` : ""}</div></section><section class="reader-work"><h2>Work in your record</h2>${achievements || (retained.length ? '' : '<p>No work yet</p>')}${records}</section></main><footer class="reader-footer"><span>Private preview</span><a target="_top" href="/leaf/setup">Back to workspace</a></footer>`,true);
}
