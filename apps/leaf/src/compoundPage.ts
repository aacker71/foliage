/** Private exploration. Every blade maps to a real record; color is attribution, never rank. */
import { attributionLedger, featuredLeaflets, type BodyElement, type Leaflet, type Provenance } from "@foliage/leaf";
import { ui } from "@foliage/ui";
import { provenanceIsPromotedHandle } from "@foliage/photosynthesis";
import { page, esc, ownerLeafletHref } from "./render.ts";
import type { LeafLoad } from "./leafDocument.ts";
import { LEAF_LOAD_LABEL } from "./loadLabels.ts";
import { renderLeafletAssistance } from "./leafletAssistance.ts";
import type { CompoundBundleStatus } from "./compoundBundle.ts";
import { readStoryElement, STORY_SECTIONS, storyElements } from "./leafletStory.ts";

interface CompoundPageOptions {
  readonly assistance?: Parameters<typeof renderLeafletAssistance>[1];
  readonly bundle?: CompoundBundleStatus;
}

const tierLabels = { verified: "Verified", pending: "Pending attribution", excluded: "Excluded from attribution" } as const;
const sourceLabels = { git: "Git records", photosynthesis: "Photosynthesis records", other: "Other sources" } as const;

function sourceKind(record: Leaflet): keyof typeof sourceLabels {
  const source = record.provenance?.source;
  return source === "git" ? "git" : source?.startsWith("photosynthesis:") ? "photosynthesis" : "other";
}

function observedDay(record: Leaflet): string {
  const value = record.provenance?.observedAt;
  return value && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : "";
}

function excerpt(record: Leaflet, limit: number): string {
  const element = storyElements(record).find(element => element.text?.trim());
  const story = element && readStoryElement(element);
  const text = story ? `${STORY_SECTIONS.find(section => section.key === story.section)!.label}: ${story.text}` : element?.text;
  return text ? `${text.slice(0, limit)}${text.length > limit ? "…" : ""}` : "No context";
}

function recordedContext(element: BodyElement): string {
  const story = readStoryElement(element);
  const text = story?.text ?? element.text!;
  const paragraph = `<p class="cx-excerpt">${esc(text.slice(0, 900))}${text.length > 900 ? "…" : ""}</p>`;
  if (!story) return paragraph;
  return `<section class="cx-story-context"><h4>${STORY_SECTIONS.find(section => section.key === story.section)!.label}</h4>${paragraph}
    <details class="cx-evidence"><summary>Source</summary>
    <p>${esc(story.reviewer)} · <time class="fol-metric" datetime="${esc(story.at)}">${esc(story.at)}</time></p>
    <dl><dt>Source</dt><dd>${esc(story.supporting.source)}</dd><dt>Reference</dt><dd><code>${esc(story.supporting.ref)}</code></dd>
    <dt>Observed</dt><dd class="fol-metric">${esc(story.supporting.observedAt)}</dd></dl></details></section>`;
}

/** Matching source AND reference is an explicit connection; common words are not evidence. */
function evidence(record: Leaflet): readonly Provenance[] {
  // A promoted leaflet's provenance is a handle on its first body element: one reference, not two.
  const refs = [provenanceIsPromotedHandle(record) ? undefined : record.provenance, ...(record.body ?? []).map(element => element.provenance)];
  const unique = new Map<string, Provenance>();
  for (const ref of refs) if (ref) unique.set(JSON.stringify([ref.source, ref.ref]), ref);
  return [...unique.values()];
}

interface EvidenceConnection {
  readonly index: number;
  readonly shared: readonly Provenance[];
}

function relationships(records: readonly Leaflet[]): readonly (readonly EvidenceConnection[])[] {
  const byEvidence = new Map<string, number[]>();
  const references = records.map(evidence);
  references.forEach((refs, index) => {
    for (const ref of refs) {
      const key = JSON.stringify([ref.source, ref.ref]);
      const indices = byEvidence.get(key) ?? [];
      indices.push(index);
      byEvidence.set(key, indices);
    }
  });
  return references.map((refs, index) => {
    const connected = new Map<number, Provenance[]>();
    for (const ref of refs) for (const other of byEvidence.get(JSON.stringify([ref.source, ref.ref])) ?? []) {
      if (other === index) continue;
      const shared = connected.get(other) ?? [];
      shared.push(ref);
      connected.set(other, shared);
    }
    return [...connected.entries()].sort(([a], [b]) => a - b).map(([other, shared]) => ({ index: other, shared }));
  });
}

function matchingContext(record: Leaflet, ref: Provenance, label: string): string {
  const texts = (record.body ?? []).filter(element => element.provenance.source === ref.source
    && element.provenance.ref === ref.ref && element.text?.trim());
  return `<section data-evidence-leaflet="${esc(record.id)}"><p><strong>${label}</strong> ${esc(record.title)}</p>
    ${texts.length ? texts.map(element => `<p class="cx-excerpt" data-verbatim="body-element">${esc(element.text!.slice(0, 900))}${element.text!.length > 900 ? "…" : ""}</p>`).join("") : '<p class="cx-note">No text</p>'}
    <p><a href="${ownerLeafletHref(record.id)}">Open</a></p></section>`;
}

function connectionDetail(record: Leaflet, other: Leaflet, connection: EvidenceConnection, interactive: boolean): string {
  return `<li><a href="${interactive ? `/leaf/explore?leaflet=${encodeURIComponent(other.id)}` : ownerLeafletHref(other.id)}" data-related-index="${connection.index}">${esc(other.title)}</a>
    <details class="cx-evidence cx-shared-connection" data-connection-index="${connection.index}"><summary><span class="fol-metric">${connection.shared.length}</span> shared ${connection.shared.length === 1 ? "reference" : "references"}</summary>
    ${connection.shared.map(ref => `<div class="cx-shared-reference" data-shared-source="${esc(ref.source)}" data-shared-ref="${esc(ref.ref)}">
      <dl><dt>Source</dt><dd>${esc(ref.source)}</dd><dt>Reference</dt><dd><code>${esc(ref.ref)}</code></dd></dl>
      ${matchingContext(record, ref, "Selected:")}${matchingContext(other, ref, "Connected:")}</div>`).join("")}
    </details></li>`;
}

function highlightLabel(highlight: string): string {
  return highlight === "leading" ? "Leading tip" : highlight === "featured" ? "Highlight" : "";
}

function tooltip(record: Leaflet, highlight: string): string {
  return `${highlight ? `<p class="cx-highlight-label">${highlightLabel(highlight)}</p>` : ""}<p class="cx-tooltip-tier" data-tier="${record.tier}">${tierLabels[record.tier]}</p>
    <strong>${esc(record.title)}</strong>
    <p class="cx-tooltip-date">${observedDay(record) ? `Observed <span class="fol-metric">${esc(observedDay(record))}</span>` : "No observed date"}</p>
    <p class="cx-tooltip-excerpt">${esc(excerpt(record, 180))}</p>`;
}

function detail(record: Leaflet, records: readonly Leaflet[], related: readonly EvidenceConnection[], assistance: CompoundPageOptions["assistance"], highlight: string, interactive = true): string {
  const provenance = record.provenance;
  const refs = evidence(record);
  const texts = storyElements(record).filter(element => element.text?.trim()).slice(0, 2);
  return `${highlight ? `<p class="cx-highlight-label">${highlightLabel(highlight)}</p>` : ""}<p class="cx-eyebrow cx-detail-tier" data-tier="${record.tier}">${tierLabels[record.tier]}</p><h2>${esc(record.title)}</h2>
    ${record.tier === "excluded" ? `<p class="cx-reason">${esc(record.reason)}</p>` : ""}
    <div class="cx-recorded-context"><h3>Context</h3>
    ${texts.length ? texts.map(recordedContext).join("") : `<p class="cx-note">No context</p>`}</div>
    <dl><dt>Observed</dt><dd class="fol-metric">${esc(observedDay(record) || "No observed date")}</dd>
    <dt>Source</dt><dd>${esc(provenance?.source ?? "Not recorded")}</dd>
    <dt>Evidence</dt><dd><span class="fol-metric">${refs.length}</span> ${refs.length === 1 ? "reference" : "references"}</dd></dl>
    <details class="cx-evidence"><summary>References</summary>
    ${refs.length ? `<ul>${refs.map(ref => `<li><span>${esc(ref.source)}</span><code>${esc(ref.ref)}</code></li>`).join("")}</ul>` : `<p>None</p>`}</details>
    <section class="cx-connections"><h3>Connected <span class="fol-metric">${related.length}</span></h3>
    ${related.length ? `<ul>${related.map(connection => connectionDetail(record, records[connection.index]!, connection, interactive)).join("")}</ul>` : `<p class="cx-note">None</p>`}</section>
    ${ui.link("Open Leaflet", { href: ownerLeafletHref(record.id) })}
    ${record.tier !== "excluded" ? `<p>${ui.link(highlight ? "Edit highlights" : "Add highlight", { href: highlight ? "/leaf/curate" : `/leaf/curate?leaflet=${encodeURIComponent(record.id)}` })}</p>` : ""}
    ${record.tier === "pending" && (!record.visibility || record.visibility === "private") ? `<p>${ui.link("Tell the story", { href: `/leaf/story?leaflet=${encodeURIComponent(record.id)}` })}</p>` : ""}
    ${renderLeafletAssistance(record, assistance)}`;
}

function timeline(records: readonly Leaflet[], available: boolean): string {
  const months = new Map<string, number>();
  const days = records.map(observedDay).filter(Boolean).sort();
  for (const record of records) {
    const month = observedDay(record).slice(0, 7) || "undated";
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  const periods = [...months.keys()].filter(key => key !== "undated").sort();
  if (months.has("undated")) periods.push("undated");
  const name = (period: string) => period === "undated" ? "No observed date" : new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  return `<section class="cx-timeline" id="cx-timeline" aria-label="Timeline">
    <div class="cx-timeline-heading"><div><h2>Observed</h2><p id="cx-timeline-summary" role="status">${days.length ? `<span class="fol-metric">${esc(days[0]!)}</span> to <span class="fol-metric">${esc(days[days.length - 1]!)}</span>` : available ? "No dates" : "Dates unavailable"}</p></div>
    <div class="cx-period-control">${ui.label("Period", { htmlFor: "cx-period" })}<select id="cx-period" disabled><option value="all">All</option>${periods.map(period => `<option value="${period}">${name(period)} (${months.get(period)})</option>`).join("")}</select></div></div>
    <div class="cx-timeline-track" id="cx-timeline-track" role="group" aria-label="Filter by month">${ui.button(available ? `All · ${records.length}` : "Unavailable", { "data-period": "all", "aria-pressed": true, className: "cx-period fol-metric", disabled: true })}${periods.map(period => ui.button(`${name(period)} · ${months.get(period)}`, { "data-period": period, "aria-pressed": false, className: "cx-period fol-metric", disabled: true })).join("")}</div></section>`;
}

export function renderCompoundPage(load: LeafLoad, options: CompoundPageOptions = {}): string {
  const records = load.ok ? load.leaf.leaflets : [];
  const ledger = load.ok ? attributionLedger(load.leaf) : undefined;
  const total = ledger ? ledger.verified + ledger.pending + ledger.excluded : null;
  const related = relationships(records);
  const featured = load.ok ? featuredLeaflets(load.leaf) : [];
  const featuredIds = new Set(featured.map(record => record.id));
  const leading = load.ok ? featured.find(record => record.id === load.leaf.curation?.featured[0]) : undefined;
  const initial = leading ? records.indexOf(leading) : 0;
  const highlight = (record: Leaflet) => record.id === leading?.id ? "leading" : featuredIds.has(record.id) ? "featured" : "";
  const savedChoices = load.ok ? load.leaf.curation?.featured.length ?? 0 : 0;
  const bundleFailure = options.bundle?.ok === false ? options.bundle : null;
  const bundleReady = bundleFailure === null;
  const loadingMessage = records.length ? "3D view" : load.ok ? "No records" : esc(LEAF_LOAD_LABEL[load.cause]);
  const inspectorTag = bundleReady ? "aside" : "section";
  const failureNotice = bundleFailure ? `<section class="cx-fallback" role="status" aria-labelledby="cx-fallback-heading">
    <h2 id="cx-fallback-heading">Interactive view unavailable</h2>
    <p>${esc(bundleFailure.reason)}</p><p>${esc(bundleFailure.remedy)}</p>
    ${!load.ok ? `<details class="leaf-detail"><summary>Collection details</summary><p class="fol-metric">${esc(load.detail)}</p></details>` : ""}
    </section>` : "";
  const body = `<div class="cx-shell" data-revision="${load.ok ? esc(load.source.documentDigest) : ""}" data-assistance-revision="${esc(JSON.stringify(options.assistance ?? null))}" data-bundle-ready="${bundleReady}">
    <header class="cx-heading"><div><p class="cx-eyebrow">Private</p>
    <h1>Your <em>Leaf.</em></h1>
    <p>${load.ok ? esc(load.leaf.subject) : "Your private collection"}</p></div>
    <div class="cx-heading-side"><span><span class="fol-metric cx-total">${total ?? "—"}</span> ${total === null ? "collection unavailable" : `artifact${total === 1 ? "" : "s"}`}</span><a href="/leaf">Portfolio</a>${records.length ? '<a class="cx-scarlet-entry" href="#cx-assistance">Scarlet</a>' : ''}</div></header>
    <div class="cx-layout">${bundleReady ? `<section class="cx-garden" aria-label="Interactive compound leaf">
    <div class="cx-color-key"><div class="cx-color-control">${ui.label("Color by", { htmlFor: "cx-color-by" })}<select id="cx-color-by" disabled><option value="source">Source</option><option value="tier">Attribution</option></select></div>
    <ul class="cx-legend" id="cx-source-legend" aria-label="Leaflet source colors">${[...new Set(records.map(sourceKind))].map(kind => `<li data-source-kind="${kind}"><span aria-hidden="true"></span>${sourceLabels[kind]}</li>`).join("")}</ul>
    <ul class="cx-legend" id="cx-tier-legend" aria-label="Leaflet attribution colors" hidden><li data-tier="verified"><span aria-hidden="true"></span>Verified</li><li data-tier="pending"><span aria-hidden="true"></span>Pending attribution</li><li data-tier="excluded"><span aria-hidden="true"></span>Excluded from attribution</li></ul></div>
    ${timeline(records, load.ok)}
    <section class="cx-highlights" id="cx-highlights" aria-label="Highlights">
    <div><p>${leading ? `<span class="cx-highlight-label">Leading tip</span><a href="/leaf/explore?leaflet=${encodeURIComponent(leading.id)}" data-related-index="${initial}">${esc(leading.title)}</a>` : savedChoices ? "Leading tip unavailable" : load.ok ? "No leading highlight chosen" : "Highlights unavailable"}</p>
    ${featured.length ? '<p class="cx-note"><span class="cx-highlight-key" aria-hidden="true">◇</span> Highlight</p>' : ""}
    ${savedChoices > featured.length ? '<p class="cx-note">Some saved choices are unavailable</p>' : ""}
    <p class="cx-note" id="cx-highlight-filter" role="status" hidden></p></div>
    <a href="/leaf/curate">${savedChoices ? "Edit highlights" : "Choose highlights"}</a></section>
    <div class="cx-stage" id="cx-stage"><canvas id="cx-canvas" tabindex="0" aria-label="3D leaf. Drag to turn; arrow keys select."></canvas>
    <p class="cx-stage-status" id="cx-stage-status" role="status">${loadingMessage}</p>
    <div class="cx-hover" id="cx-hover" role="tooltip" hidden></div></div>
    ${!load.ok ? `<details class="leaf-detail"><summary>Details</summary><p class="fol-metric">${esc(load.detail)}</p></details>` : ""}
    <div class="cx-controls"><div>
    ${ui.button("Pause motion", { id: "cx-motion", "aria-pressed": false, disabled: true })}
    ${ui.button("Reset view", { id: "cx-reset", disabled: true })}</div></div>
    <p class="cx-botany" id="cx-sync" role="status">Auto-updating</p>
    </section>` : failureNotice}<${inspectorTag} class="cx-inspector" aria-label="${bundleReady ? "Artifact explorer" : "Retained records"}">
    <div class="cx-inspector-heading"><span class="cx-eyebrow">Records</span><span class="fol-metric" id="cx-matches">${total ?? "—"}</span></div>
    ${bundleReady ? `${ui.label("Search", { htmlFor: "cx-search", className: "cx-search-label" })}
    ${ui.input({ id: "cx-search", type: "search", placeholder: "Titles…", disabled: true })}` : ""}
    <div class="cx-list" id="cx-list" role="group" aria-label="Artifacts">${records.map((record, index) => {
      const attributes = {
      className: "cx-item", "data-index": String(index), "data-id": record.id, "data-tier": record.tier, "data-source-kind": sourceKind(record),
      "data-highlight": highlight(record), "data-featured-order": String(featured.findIndex(chosen => chosen.id === record.id)),
      "data-title": record.title, "data-observed": observedDay(record), "data-month": observedDay(record).slice(0, 7) || "undated",
      "data-excerpt": excerpt(record, 180), "data-source": record.provenance?.source ?? "Not recorded", "data-related": JSON.stringify(related[index]!.map(connection => connection.index)),
      "aria-label": `${record.title}. ${highlight(record) ? `${highlightLabel(highlight(record))}. ` : ""}${tierLabels[record.tier]}. ${observedDay(record) ? `Observed ${observedDay(record)}` : "No observed date"}.`,
      };
      return bundleReady ? ui.button(record.title, { ...attributes, "aria-pressed": index === initial, disabled: true })
        : ui.link(record.title, { ...attributes, href: ownerLeafletHref(record.id) });
    }).join("")}</div>
    <p id="cx-no-results" hidden>No matches</p>
    <article class="cx-detail" id="cx-detail" aria-live="polite">${records[initial] ? detail(records[initial], records, related[initial]!, options.assistance, highlight(records[initial]), bundleReady) : `<h2>${load.ok ? "No records yet." : "Collection unavailable."}</h2>${ui.link("Portfolio", { href: "/leaf" })}`}</article>
    ${bundleReady ? records.map((record, index) => `<template id="cx-record-${index}">${detail(record, records, related[index]!, options.assistance, highlight(record))}</template><template id="cx-tooltip-${index}">${tooltip(record, highlight(record))}</template>`).join("") : ""}
    </${inspectorTag}></div>${bundleReady ? '<noscript><p>3D needs JavaScript. <a href="/leaf">Portfolio</a></p></noscript>' : ""}</div>`;
  return page({ title: "Foliage — your living leaf", surface: "compound", nav: "leaf", face: "night", state: load.ok ? "ready" : load.cause,
    empty: records.length === 0, enhanceCompound: true, enhanceCompoundScript: bundleReady, body });
}
