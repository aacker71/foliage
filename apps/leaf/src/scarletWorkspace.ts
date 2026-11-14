import { ui } from "@foliage/ui";
/** The private, enhanced Photosynthesis surface. Existing document pages remain script-free. */
import type { LeafLoad } from "./leafDocument.ts";
import { leafLoadProblem } from "./loadLabels.ts";
import { RATING_SHAPED } from "@foliage/leaf";
import { chatEndpoint, type ModelConfigResult } from "./scarletModel.ts";
import { runScarletTool, type ScarletTool, type ContextDocument, type ScarletContext, type ScarletSelection } from "./scarletTools.ts";
import { esc, page, fabricationBand, ownerLeafletHref, SCARLET_WORKSPACE_ROUTE, carriesVerbatimTitle, titleProvenanceAttr, leafLoadTechnical } from "./render.ts";
import { PAGE_REFUSALS, refusalLabel, refusalRecovery } from "./scarletPage.ts";

/**
 * The plain page's words for each refusal, for the client to show instead of the runner's detail,
 * about the same endpoint a run from this workspace calls.
 * `leaf-unavailable` is left out: the run already words those refusals for this workspace.
 */
const refusalCopy = (endpoint: string | null): string => JSON.stringify(Object.fromEntries(PAGE_REFUSALS.filter((code) => code !== "leaf-unavailable")
  .map((code) => [code, { label: refusalLabel(code, endpoint), recovery: refusalRecovery(code, endpoint) }])));

const observedDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function renderBriefProvenance(p: NonNullable<ContextDocument["provenance"]>): string {
  const date = new Date(p.observedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? p.observedAt : observedDate.format(date);
  const shortRef = p.source === "git" && /^[0-9a-f]{40}(?::|$)/i.test(p.ref) ? p.ref.slice(0, 7) : p.ref.length > 24 ? `${p.ref.slice(0, 21)}…` : p.ref;
  return `<p class="lb-provenance-summary"><span>${esc(p.source === "git" ? "Git" : p.source)} · <span class="fol-metric">${esc(shortRef)}</span></span><span>Observed <time class="fol-metric" datetime="${esc(p.observedAt)}">${esc(dateLabel)}</time></span></p>`;
}

function documentPreview(doc: ContextDocument, selected: boolean, carried: boolean, compact = false): string {
  const href = doc.href ?? ownerLeafletHref(doc.id);
  const status = doc.tier === "excluded" ? "Excluded" : doc.tier === "verified" ? "Verified" : doc.tier === "pending" ? "Pending" : doc.candidateState === "approved" ? "Approved" : doc.candidateState === "rejected" ? "Rejected" : "Draft";
  const evidence = (p: { source: string; ref: string; observedAt: string }): string =>
    `<p class="lb-evidence" data-verbatim="evidence">${esc(p.source)} · <span class="fol-metric">${esc(p.ref)}</span><br>Observed <time class="fol-metric">${esc(p.observedAt)}</time></p>`;
  if (compact) {
    return `<li class="lb-document lb-document--compact"><div class="lb-document-row"><a href="${esc(href)}" ${titleProvenanceAttr(carried)}>${esc(doc.title)}</a><span>${status}</span><details><summary>Evidence</summary>${doc.reason === undefined ? "" : `<p data-verbatim="exclusion-reason">${esc(doc.reason)}</p>`}${doc.provenance === undefined ? "" : evidence(doc.provenance)}${doc.body.map(element => `<div class="lb-element">${element.text === undefined ? "" : `<p data-verbatim="body-element">${esc(element.text)}</p>`}${evidence(element.provenance)}</div>`).join("")}${doc.workflowEvidence?.map(item => `<p class="lb-evidence" data-verbatim="commit-subject">${esc(item.title)} · ${esc(item.sha)}</p>`).join("") ?? ""}</details></div></li>`;
  }
  const hasReadableContent = Boolean(doc.workflowEvidence?.length) || doc.body.some((e) => e.text?.trim());
  const briefProvenance = selected && !hasReadableContent && doc.provenance ? renderBriefProvenance(doc.provenance) : "";
  return `<li class="lb-document">
<div class="lb-document-heading"><span class="fol-metric">[${esc(doc.citation)}]</span><span>${status}</span></div>
<h3 ${titleProvenanceAttr(carried)}><a href="${esc(href)}">${esc(doc.title)}</a></h3>
${briefProvenance}
${doc.reason === undefined ? "" : `<p data-verbatim="exclusion-reason">Excluded: ${esc(doc.reason)}</p>`}
<details><summary>Evidence</summary>
${doc.provenance === undefined ? "" : evidence(doc.provenance)}
${doc.body.map((element) => `<div class="lb-element">${element.text === undefined ? "" : `<p data-verbatim="body-element">${esc(element.text)}</p>`}${evidence(element.provenance)}</div>`).join("")}
${doc.workflowEvidence?.map((e) => `<div class="lb-element"><p data-verbatim="commit-subject">${esc(e.title)}</p><p class="lb-evidence">git · <span class="fol-metric">${esc(e.sha)}</span><br>Author email · not verified: ${esc(e.email)}</p></div>`).join("") ?? ""}
${doc.capturedAt ? `<p class="lb-note">Collected <time class="fol-metric">${esc(doc.capturedAt)}</time></p>` : ""}
${doc.notes.map((note) => `<p class="lb-note">${esc(note)}</p>`).join("")}
</details>
${selected ? "" : `<a class="lb-scope-link" href="${SCARLET_WORKSPACE_ROUTE}?leaflet=${encodeURIComponent(doc.id)}">Ask about this</a>`}
</li>`;
}

export function renderScarletWorkspace(load: LeafLoad, model: ModelConfigResult, tool: ScarletTool, options: {
  readonly context?: ScarletContext; readonly selection?: ScarletSelection; readonly why?: string;
} = {}): string {
  const workflow = tool.name === "read_workflow";
  if (!load.ok && !workflow) {
    return page({ title: "Foliage — Photosynthesis", surface: "scarlet", nav: "scarlet", face: "night", state: load.cause, empty: false,
      body: `<h1>Leaf unavailable</h1><p>${esc(leafLoadProblem(load))}</p><a href="/leaf">My Leaf</a>${leafLoadTechnical(load)}` });
  }
  const context = options.context ?? (load.ok ? runScarletTool(load.leaf, load.source.documentDigest, tool) : { tool, documentDigest: "", documents: [], matched: 0, omitted: 0 });
  const digest = options.selection?.documentDigest ?? (load.ok ? load.source.documentDigest : "");
  const draft = tool.name === "read_candidate" || workflow;
  const key = workflow ? "packet" : tool.name === "read_candidate" ? "candidate" : "leaflet";
  const selected = tool.name !== "search_leaflets";
  const value = selected ? tool.id : tool.query;
  const ready = model.ok && context.documents.length > 0 && options.why === undefined;
  const purpose = options.selection?.purpose ?? (draft ? "review" : "understand");
  const modes = { understand: "Understand evidence", describe: "Improve wording", review: "Review a draft", publish: "Prepare to publish" };
  const scope = selected ? `${draft ? "Review draft" : "This leaflet"} · ${context.documents[0]?.title ?? "unavailable"}` : tool.query === "" ? "My Leaf · first entries" : `Search: ${tool.query}`;
  const params = selected ? `${key}=${encodeURIComponent(value)}` : `q=${encodeURIComponent(value)}`;
  const returnHref = purpose === "review" ? context.documents[0]?.href ?? "/review" : purpose === "publish" ? "/publish" : selected ? ownerLeafletHref(value) : "/leaf";
  const starters = purpose === "review" ? [
    ["Check claims", "Which claims in this draft are supported by the supplied evidence, and which need more evidence? Cite each record. Do not make the review decision."],
    ["Narrow wording", "Propose a narrower draft title supported by the evidence. Explain what you left out and cite the records."],
  ] : purpose === "publish" ? [
    ["Explain state", "Explain the supplied publication state and its reason. Do not infer permission from a proof tier. Cite the record."],
    ["What to inspect", "What recorded content should I inspect before sharing this work? Separate recorded facts from suggestions and cite the records."],
  ] : purpose === "describe" ? [
    ["Draft description", "Propose a concise description using only the supplied evidence. Cite the records and distinguish suggested wording from recorded facts."],
    ["Unsupported wording", "Which parts of the current wording need more evidence? Cite the records and propose narrower wording without adding claims."],
  ] : [
    ["What is supported", "What does this record support, and what is missing? Cite the records and distinguish observation dates from work dates."],
    ["Describe work", "Suggest a clearer description using only the recorded evidence. Cite the records and explain any uncertainty."],
  ];
  const modelSetup = model.ok ? "" : `<section class="lb-model-setup" aria-labelledby="lb-model-setup-h"><h2 id="lb-model-setup-h">Photosynthesis needs a local model</h2><a class="fol-button fol-button-primary btn btn-primary" href="/scarlet/setup">Choose local model</a></section>`;
  const search = workflow ? "" : `${selected ? '<details class="lb-find"><summary>Search</summary>' : ""}
<form method="get" action="${SCARLET_WORKSPACE_ROUTE}" class="lb-search">
${ui.label("Find work", { htmlFor: "lb-query" })}
<div class="lb-search-controls">${ui.input({ type: "search", id: "lb-query", name: "q", maxLength: 200, defaultValue: selected ? "" : tool.query })}${ui.button("Find", { type: "submit" })}</div>
</form>
${selected ? "</details>" : ""}`;
  const body = `${load.ok && !workflow ? fabricationBand(load.source) : ""}
<section class="lb-intro"><div><h1>Photosynthesis</h1></div>
${ui.link("Back", { href: returnHref })}</section>
${model.ok ? `<p class="lb-model-context"><span>Local model · <span class="fol-metric">${esc(model.config.model)}</span></span><a href="/workflow#background">Background runs</a></p>` : ""}
${modelSetup}
<div class="lb-workspace${ready ? "" : " lb-workspace--single"}${selected ? " lb-workspace--selected" : ""}">
${ready ? `<section class="lb-conversation" aria-labelledby="lb-conversation-h">
<div class="lb-pane-heading"><h2 id="lb-conversation-h">Ask</h2><span class="lb-note">Not saved</span></div>
<p id="lb-scope" class="lb-scope">${esc(scope)}</p>
${draft ? "" : `<details class="lb-task-picker"><summary>Task · ${modes[purpose]}</summary><nav class="lb-modes" aria-label="Task">${(["understand", "describe", "publish"] as const).map((mode) => `<a class="fol-button ${purpose === mode ? "fol-button-secondary" : "fol-button-ghost"}" href="${SCARLET_WORKSPACE_ROUTE}?${params}&amp;purpose=${mode}${options.selection?.includeSource ? "&amp;source=git" : ""}"${purpose === mode ? ' aria-current="page"' : ""}>${modes[mode]}</a>`).join(" ")}</nav></details>`}
<div class="lb-starters" role="group" aria-label="Question starters"><div class="lb-suggestions">
${starters.map(([label, question]) => `${ui.button(label!, { type: "button", variant: "ghost", "data-question": question! })}`).join("")}
</div></div>
<div id="lb-transcript" class="lb-transcript" role="region" tabindex="0" aria-label="Conversation" data-rating-pattern="${esc(RATING_SHAPED.source)}"></div>
<p id="lb-status" role="status" aria-live="polite">Model set · not checked yet</p>
<form id="lb-ask" class="lb-ask" data-tool="${tool.name}" data-value="${esc(value)}" data-digest="${esc(digest)}" data-selection="${esc(JSON.stringify(options.selection ?? { documentDigest: digest, tool }))}" data-ready="${ready}" data-refusals="${esc(refusalCopy(model.ok ? chatEndpoint(model.config) : null))}" method="post" action="/scarlet">
${ui.label("Question", { htmlFor: "lb-question" })}
${ui.textarea({ id: "lb-question", name: "question", rows: 3, maxLength: 4000, required: true, "aria-describedby": "lb-scope" })}
<div class="lb-actions">${ui.button("Ask", { id: "lb-send", type: "submit", variant: "default", disabled: !ready })}${ui.button("Stop", { id: "lb-stop", type: "button", hidden: true })}${ui.button("Clear", { id: "lb-clear", type: "button", variant: "ghost", "aria-label": "Clear conversation" })}</div>
</form>
<template id="lb-copy-template">${ui.button("Copy", { type: "button" })}</template>
<template id="lb-check-template">${ui.alert("", { className: "lb-answer-review", role: "status" })}</template>
<noscript><p>Needs JavaScript. <a href="/scarlet">Plain page</a></p></noscript>
</section>` : ""}
<section class="lb-context" aria-labelledby="lb-context-h">
<div class="lb-pane-heading"><h2 id="lb-context-h">${draft ? "Draft" : selected ? "Leaflet" : "Work"}</h2>${workflow || selected ? `<a href="${workflow ? "/review" : SCARLET_WORKSPACE_ROUTE}">${workflow ? "Review" : "All work"}</a>` : ""}</div>
${selected && !model.ok ? "" : search}
${selected ? "" : `<p class="lb-note"><span class="fol-metric">${context.documents.length}</span> shown${context.omitted ? ` · <span class="fol-metric">${context.omitted}</span> more available` : ""}</p>`}
${context.documents.length === 0 ? `<div class="lb-empty"><h3>${context.matched > 0 ? "Too large" : selected ? "Record unavailable" : "No matching work"}</h3></div>` : ""}
${options.why ? ui.alert(options.why) : ""}
${context.subject && (!load.ok || context.subject !== load.leaf.subject) ? `<p class="lb-note">${esc(context.subject)}</p>` : ""}
${model.ok ? `<details class="lb-source-options"${options.selection?.includeSource ? " open" : ""}><summary>Source excerpts${options.selection?.includeSource ? " · included" : ""}</summary>
<form method="get" action="${SCARLET_WORKSPACE_ROUTE}" class="lb-source-form">
<input type="hidden" name="${selected ? key : "q"}" value="${esc(value)}"><input type="hidden" name="purpose" value="${purpose}">
<label><input type="checkbox" name="source" value="git"${options.selection?.includeSource ? " checked" : ""}> Include git patches</label>
${ui.button("Update", { type: "submit" })}</form></details>` : ""}
<ol class="lb-documents">${context.documents.map((doc) => documentPreview(doc, selected, !draft && load.ok && carriesVerbatimTitle(load.leaf.leaflets.find((leaflet) => leaflet.id === doc.id)!), !model.ok)).join("")}</ol>
${selected && !model.ok ? search : ""}
${context.policySource ? `<p class="lb-note">${context.policySource === "default" ? "Default rules" : "Your policy"}</p>` : ""}
${context.publication?.map((p) => `<div class="lb-facts"><h3>Publication state</h3><p>${esc(p.state)}</p><p>${esc(p.reason)}</p></div>`).join("") ?? ""}

${context.sourceReads?.map((s) => `<details class="lb-source"><summary>${s.state === "read" ? "Source read" : "Source unavailable"}${s.ref ? ` · ${esc(s.ref.slice(0, 12))}` : ""}</summary><p>${esc(s.detail)}</p>${s.text ? `<pre>${esc(s.text)}</pre>` : ""}</details>`).join("") ?? ""}
</section>
</div>`;
  return page({ title: "Foliage — Photosynthesis workspace", surface: "scarlet", nav: "scarlet", face: "night",
    state: "workspace", empty: context.documents.length === 0, body, styleScarlet: true, enhanceScarlet: ready });
}
