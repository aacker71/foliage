/** Local review pages and atomic writes. AI/imported text never writes itself. */
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { ui } from "@foliage/ui";
import { loadLeafDocument, type LeafLoad } from "./leafDocument.ts";
import { LeafLoadError } from "./loadLabels.ts";
import { page, esc, ownerLeafletHref } from "./render.ts";
import { workflowPacket } from "./workflowContext.ts";
import type { WorkflowSnapshot } from "./workflow.ts";
import { applyLeafletSuggestion, exportLeafletReview, parseLeafletSuggestion, revisionDigest, workflowLeaflet, type LeafletSuggestion } from "./leafletRevision.ts";
import { STORY_SECTIONS, applyLeafletStory, readLeafletStory, storyEvidence } from "./leafletStory.ts";
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
function shell(body: string, story = false): string {
  return page({ title: story ? "Story · Foliage" : "Foliage — review a Leaflet revision", surface: "review", face: "night", nav: story ? "work" : "leaf", state: "revision", empty: false,
    body: story ? `<section class="revision-journey story-workspace">${body}</section>` : `<section class="cell revision-journey"><p><a href="/leaf/explore">← Living leaf</a> · <a href="/review">Review</a></p>${body}</section>` });
}
function loaded(load: LeafLoad) {
  if (!load.ok) throw new LeafLoadError(load);
  if (load.source.declaredExample || load.source.bundledExample) throw new Error("Real reviews cannot be written into an example document.");
  return load;
}
const confirmation = (subject: string) => `${ui.label("Reviewer", { htmlFor: "revision-reviewer" })}${ui.input({ id: "revision-reviewer", name: "reviewer", required: true, maxLength: 200 })}
  ${ui.label(`Type to confirm: ${subject}`, { htmlFor: "revision-subject" })}${ui.input({ id: "revision-subject", name: "subject", required: true, autoComplete: "off" })}`;
export function renderJourneyFailure(message: string, technical = ""): string { return shell(`<h1>Nothing changed.</h1><p role="alert">${esc(message)}</p><p><a href="/leaf/revision">Back</a></p>${technical}`); }
export function renderWorkflowLeaflet(load: LeafLoad, state: WorkflowSnapshot, id: string): string {
  const current = loaded(load);
  const packet = workflowPacket(state, id);
  if (!packet || packet.proposal.status !== "accepted" || !packet.source) throw new Error("Choose a saved private draft with a connected source.");
  const p = packet.proposal;
  const prior = current.leaf.leaflets.find(l => String(l.id) === `workflow:${p.id}`);
  return shell(`<h1>${prior ? "Update Leaflet." : "New Leaflet."}</h1>
    <p>Leaf: ${esc(current.leaf.subject)} · pending · private</p>
    ${prior ? `<h2>Current</h2><p>${esc(prior.title)}</p>` : ""}
    <h2>Proposed</h2><p>${esc(p.title)}</p><h2>Evidence</h2>
    <p><span class="fol-metric">${p.evidence.length}</span> references · <span class="fol-metric">${p.omitted}</span> omitted</p>
    <p>Collected: ${esc(p.capturedAt ?? "not recorded")} · <code>${esc(p.source)}</code></p>
    <ul>${p.evidence.map(e => `<li><p>${esc(e.title)}</p><code>${esc(e.sha)}</code></li>`).join("")}</ul>
    <form method="post" action="/workflow/leaflet" class="review-form">${hidden("packet", id)}${hidden("packetRevision", packet.digest)}${hidden("documentRevision", current.source.documentDigest)}
    <p>Confirming attributes this evidence to ${esc(current.leaf.subject)}</p>${confirmation(current.leaf.subject)}${ui.button(prior ? "Save" : "Create Leaflet", { type: "submit" })}</form>`);
}
export async function saveWorkflowLeaflet(env: Readonly<Record<string, string | undefined>>, state: WorkflowSnapshot, form: URLSearchParams): Promise<string> {
  const initial = loaded(await loadLeafDocument(env));
  return withDocumentLocks([initial.source.path], async () => {
    const current = loaded(await loadLeafDocument(env));
    if (current.source.documentDigest !== form.get("documentRevision")) throw new Error("Leaf changed. Reopen.");
    const leaf = workflowLeaflet(current.leaf, state, form.get("packet") ?? "", form.get("packetRevision") ?? "", form.get("reviewer") ?? "", form.get("subject") ?? "", new Date().toISOString());
    writeDocument(current.source.path, JSON.stringify(leaf, null, 2) + "\n", true);
    return `workflow:${form.get("packet")}`;
  });
}
export function renderLeafletExport(load: LeafLoad, id: string, companionConnected = false): string {
  const current = loaded(load);
  const request = exportLeafletReview(current.leaf, id);
  return shell(`<h1>Scarlet review.</h1><p>Check for sensitive text.</p>
    <p>Leaf: ${esc(current.leaf.subject)} · ${esc(request.title)}</p>
    ${ui.label("Packet", { htmlFor: "leaflet-transfer" })}${ui.textarea({ id: "leaflet-transfer", rows: 14, readOnly: true, defaultValue: JSON.stringify(request, null, 2) })}
    ${companionConnected ? `<form method="post" action="/sources/assessment">
    ${hidden("leaflet", id)}${hidden("revision", request.target.revision)}${hidden("documentRevision", current.source.documentDigest)}
    ${ui.button("Continue with Scarlet", { type: "submit" })}</form>` : `<p>${ui.link("Connect Scarlet", { href: "/workflow#sources" })}</p>`}
    <p><a href="/leaf/review-export.json?leaflet=${encodeURIComponent(id)}&revision=${encodeURIComponent(request.target.revision)}">Download packet</a></p>
    <p><a href="/leaf/revision">Review suggestion</a></p>`);
}
function suggestionFor(load: LeafLoad, suggestion: LeafletSuggestion) {
  const current = loaded(load);
  const record = current.leaf.leaflets.find(l => String(l.id) === suggestion.target.leafletId);
  if (String(current.leaf.id) !== suggestion.target.leafId || !record || revisionDigest(record) !== suggestion.target.revision) throw new Error("Suggestion out of date. Export again.");
  return { current, record };
}
export function renderSuggestionReview(load: LeafLoad, suggestion?: LeafletSuggestion): string {
  if (!suggestion) return shell(`<h1>Paste suggestion.</h1>
    <form method="post" action="/leaf/revision" class="review-form">${hidden("action", "preview")}${ui.label("Packet", { htmlFor: "suggestion-packet" })}${ui.textarea({ id: "suggestion-packet", name: "suggestion", rows: 12, required: true, maxLength: 40000 })}${ui.button("Preview", { type: "submit" })}</form>`);
  const { current, record } = suggestionFor(load, suggestion);
  return shell(`<h1>Review suggestion.</h1><h2>Current</h2><p>${esc(record.title)}</p><h2>Proposed</h2><p>${esc(suggestion.title)}</p>
    <h2>Notes</h2><pre>${esc(suggestion.notes)}</pre><p>Model: ${esc(suggestion.model)} · ${esc(suggestion.generatedAt)} · sender unverified</p>
    <form method="post" action="/leaf/revision" class="review-form">${hidden("action", "apply")}${hidden("suggestion", JSON.stringify(suggestion))}${hidden("documentRevision", current.source.documentDigest)}
    ${confirmation(current.leaf.subject)}${ui.button("Accept", { type: "submit" })}</form><p><a href="${ownerLeafletHref(record.id)}">Keep current</a></p>`);
}
export async function saveLeafletSuggestion(env: Readonly<Record<string, string | undefined>>, form: URLSearchParams): Promise<string> {
  const suggestion = parseLeafletSuggestion(JSON.parse(form.get("suggestion") ?? ""));
  const initial = loaded(await loadLeafDocument(env));
  return withDocumentLocks([initial.source.path], async () => {
    const current = loaded(await loadLeafDocument(env));
    if (current.source.documentDigest !== form.get("documentRevision")) throw new Error("Leaf changed. Preview again.");
    const leaf = applyLeafletSuggestion(current.leaf, suggestion, form.get("reviewer") ?? "", form.get("subject") ?? "", new Date().toISOString());
    writeDocument(current.source.path, JSON.stringify(leaf, null, 2) + "\n", true);
    return suggestion.target.leafletId;
  });
}

/** A person's account of the work, tied to references they deliberately choose. */
export function renderLeafletStory(load: LeafLoad, id: string, draft?: URLSearchParams, failure?: string): string {
  const current = loaded(load);
  const record = current.leaf.leaflets.find(item => item.id === id);
  if (!record || record.tier !== "pending" || record.visibility && record.visibility !== "private") throw new Error("Only pending, private Leaflets have a story here.");
  const refs = storyEvidence(record);
  const referenceContext = (ref: typeof refs[number]): string => {
    const matches = (p: typeof ref) => p.source === ref.source && p.ref === ref.ref && p.observedAt === ref.observedAt;
    return record.body?.find(element => matches(element.provenance) && element.text?.trim())?.text?.trim()
      ?? (record.provenance && matches(record.provenance) ? record.title : "");
  };
  const prior = new Map(readLeafletStory(record).map(section => [section.section, section]));
  const stale = !!draft && (draft.get("documentRevision") !== current.source.documentDigest || draft.get("revision") !== revisionDigest(record));
  const value = (name: string, fallback = "") => draft?.get(name) ?? fallback;
  return shell(`<nav class="story-return"><a href="${ownerLeafletHref(id)}">Back to record</a></nav><header class="story-intro"><h1>${esc(record.title)}</h1></header>
    ${failure ? `<p class="story-error" role="alert">${esc(failure)}</p>` : ""}
    ${stale ? `<p>Leaflet changed. <a href="/leaf/story?leaflet=${encodeURIComponent(id)}">Reopen</a></p>` : ""}
    <details class="story-sources"><summary>Evidence <span class="fol-metric">${refs.length}</span></summary><ol>${refs.map(ref => { const context = referenceContext(ref); return `<li>${context ? `<p data-verbatim="body-element">${esc(context.slice(0, 600))}${context.length > 600 ? "…" : ""}</p>` : ""}<span>${esc(ref.source)}</span><code>${esc(ref.ref)}</code><time class="fol-metric" datetime="${esc(ref.observedAt)}">${esc(ref.observedAt)}</time></li>`; }).join("")}</ol></details>
    ${refs.length ? "" : '<p role="status">No evidence yet.</p>'}
    <form method="post" action="/leaf/story" class="story-form">
    ${hidden("leaflet", id)}${hidden("revision", value("revision", revisionDigest(record)))}${hidden("documentRevision", value("documentRevision", current.source.documentDigest))}
    <div class="story-sections">${STORY_SECTIONS.map((section, index) => {
      const saved = prior.get(section.key);
      const selected = value(`${section.key}Evidence`, saved ? String(saved.evidence) : "");
      return `<fieldset class="story-section"><legend><span class="fol-metric">${index + 1}</span> ${esc(section.label)}</legend>
        <p id="story-help-${section.key}">${esc(section.prompt)}</p>
        ${ui.textarea({ id: `story-${section.key}`, name: section.key, rows: 5, maxLength: 2600, readOnly: stale, defaultValue: value(section.key, saved?.text ?? ""), "aria-label": section.label, "aria-describedby": `story-help-${section.key}` })}
        ${ui.label("Evidence", { htmlFor: `story-evidence-${section.key}` })}
        <select class="field" id="story-evidence-${section.key}" name="${section.key}Evidence"${stale ? " disabled" : ""}><option value="">Choose reference</option>${refs.map((ref, i) => { const context = referenceContext(ref).replace(/\s+/g, " "); return `<option value="${i}"${selected === String(i) ? " selected" : ""}>${context ? `${esc(context.slice(0, 90))}${context.length > 90 ? "…" : ""} — ` : ""}${esc(ref.source)} · ${esc(ref.ref.length > 16 ? ref.ref.slice(0, 16) + "…" : ref.ref)}</option>`; }).join("")}</select>
      </fieldset>`;
    }).join("")}</div>
    <fieldset class="story-confirm"><legend>Confirm</legend>
    ${ui.label("Recorded by", { htmlFor: "story-reviewer" })}<p id="story-reviewer-help">Shown with the story on the public page if you share this record.</p>
    ${ui.input({ id: "story-reviewer", name: "reviewer", defaultValue: value("reviewer"), required: true, maxLength: 200, readOnly: stale, "aria-describedby": "story-reviewer-help" })}
    ${ui.label(`Type to confirm: ${current.leaf.subject}`, { htmlFor: "story-subject" })}${ui.input({ id: "story-subject", name: "subject", defaultValue: value("subject"), required: true, autoComplete: "off", readOnly: stale })}
    ${ui.button("Save", { type: "submit", disabled: stale || !refs.length })}
    <a href="${ownerLeafletHref(id)}">Cancel</a></fieldset></form>`, true);
}

/** A target can disappear or become ineligible while a person writes. Recover only the words
 * already submitted; no current record is needed and this page grants no save authority. */
export function renderLeafletStoryRecovery(draft: URLSearchParams, failure: string): string {
  return shell(`<nav class="story-return"><a href="/leaf/photosynthesis">Back to work</a></nav><div class="story-intro"><h1>Not saved.</h1>
    <p class="story-error" role="alert">${esc(failure)}</p>
    <p>Copy your words below.</p></div>
    <div class="story-sections">${STORY_SECTIONS.map(section => `<section class="story-section">
      ${ui.label(section.label, { htmlFor: `story-recovery-${section.key}` })}
      ${ui.textarea({ id: `story-recovery-${section.key}`, rows: 5, readOnly: true, defaultValue: draft.get(section.key) ?? "" })}
    </section>`).join("")}</div>
    <section class="story-confirm">${ui.label("Recorded by", { htmlFor: "story-recovery-reviewer" })}
    ${ui.input({ id: "story-recovery-reviewer", readOnly: true, defaultValue: draft.get("reviewer") ?? "" })}
    ${ui.label("Confirmed subject", { htmlFor: "story-recovery-subject" })}
    ${ui.input({ id: "story-recovery-subject", readOnly: true, defaultValue: draft.get("subject") ?? "" })}</section>
    <p><a href="/leaf">My Leaf</a></p>`, true);
}

export async function saveLeafletStory(env: Readonly<Record<string, string | undefined>>, form: URLSearchParams): Promise<string> {
  if (!env["FOLIAGE_LEAF"]?.trim()) throw new Error("Choose an explicit Leaf document before saving an account.");
  const keys = ["leaflet", "revision", "documentRevision", "reviewer", "subject", ...STORY_SECTIONS.flatMap(section => [section.key, `${section.key}Evidence`])];
  if ([...form.keys()].some((key, i, all) => !keys.includes(key) || all.indexOf(key) !== i)) throw new Error("Unexpected or repeated story fields. Reopen the story form.");
  const initial = loaded(await loadLeafDocument(env));
  return withDocumentLocks([initial.source.path], async () => {
    const current = loaded(await loadLeafDocument(env));
    if (current.source.documentDigest !== form.get("documentRevision")) throw new Error("Leaf changed. Reopen.");
    const id = form.get("leaflet") ?? "";
    const sections = STORY_SECTIONS.flatMap(section => {
      const text = form.get(section.key) ?? "";
      const selected = form.get(`${section.key}Evidence`) ?? "";
      return text.trim() ? [{ section: section.key, text, evidence: /^(0|[1-9]\d*)$/.test(selected) ? Number(selected) : NaN }] : [];
    });
    const leaf = applyLeafletStory(current.leaf, { leafId: String(current.leaf.id), leafletId: id, revision: form.get("revision") ?? "" }, sections, form.get("reviewer") ?? "", form.get("subject") ?? "", new Date().toISOString());
    writeDocument(current.source.path, JSON.stringify(leaf, null, 2) + "\n", true);
    return id;
  });
}
