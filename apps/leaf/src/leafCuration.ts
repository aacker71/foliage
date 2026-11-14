/** Deliberate presentation choices, kept in the person's existing local Leaf document. */
import { MAX_FEATURED_LEAFLETS, parseLeafDocument } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { ui } from "@foliage/ui";
import { loadLeafDocument, type LeafLoad } from "./leafDocument.ts";
import { LeafLoadError } from "./loadLabels.ts";
import { esc, page } from "./render.ts";

const slots = Array.from({ length: MAX_FEATURED_LEAFLETS }, (_, index) => `featured${index}`);
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
function loaded(load: LeafLoad) {
  if (!load.ok) throw new LeafLoadError(load);
  if (load.source.declaredExample || load.source.bundledExample) throw new Error("Choose your real Leaf before saving highlights.");
  return load;
}
function shell(body: string): string {
  return page({ title: "Highlights", surface: "review", face: "night", nav: "leaf", state: "curation", empty: false,
    body: `<section class="cell revision-journey curation-journey"><p><a href="/leaf#leaf-highlights">← My portfolio</a></p>${body}</section>` });
}

/** "Not saved." only answers a save; a GET that could not open highlights says so. */
export function renderCurationFailure(message: string, draft?: URLSearchParams, technical = ""): string {
  return shell(`<h1>${draft ? "Not saved." : "Couldn't open highlights."}</h1><p role="alert">${esc(message)}</p>
    ${draft ? `<p>Your choices:</p><ol>${slots.map(name => draft.get(name)).filter(Boolean).map(id => `<li><code>${esc(id!)}</code></li>`).join("")}</ol>` : ""}
    <p><a href="/leaf/curate">Reopen</a></p>${technical}`);
}

export function renderCuration(load: LeafLoad, candidate = "", draft?: URLSearchParams, failure?: string): string {
  const current = loaded(load);
  const available = current.leaf.leaflets.filter(record => record.tier !== "excluded");
  const choices = draft ? slots.map(name => draft.get(name) ?? "") : [...(current.leaf.curation?.featured ?? [])];
  let prepared = false;
  if (!draft && candidate && !choices.includes(candidate)) {
    if (!available.some(record => record.id === candidate)) throw new Error("This record cannot be a highlight.");
    if (choices.length >= MAX_FEATURED_LEAFLETS) throw new Error("Highlights full. Replace one first.");
    choices.push(candidate); prepared = true;
  }
  const stale = !!draft && (draft.get("documentRevision") !== current.source.documentDigest || draft.get("leafId") !== current.leaf.id || draft.get("subject") !== current.leaf.subject);
  const missing = choices.filter(id => id && !available.some(record => record.id === id));
  const option = (id: string, title: string, chosen: string) => `<option value="${esc(id)}"${id === chosen ? " selected" : ""}>${esc(title)}</option>`;
  const field = (index: number): string => {
    const chosen = choices[index] ?? "";
    return `<div class="curation-choice"${index === 0 ? ' data-leading-choice="true"' : ""}>
      ${ui.label(index === 0 ? "First highlight" : `Highlight ${index + 1}`, { htmlFor: `curation-${index}` })}
      <select class="field" id="curation-${index}" name="${slots[index]}"${stale ? " disabled" : ""}>
      ${option("", "None", chosen)}
      ${chosen && !available.some(record => record.id === chosen) ? option(chosen, `Unavailable: ${current.leaf.leaflets.find(record => record.id === chosen)?.title ?? chosen}`, chosen) : ""}
      ${available.map(record => option(record.id, `${record.title.length > 120 ? record.title.slice(0, 120) + "…" : record.title} · ${record.tier} · ${record.provenance?.observedAt.slice(0, 10) ?? "no observed date"} · ${record.id}`, chosen)).join("")}
      </select></div>`;
  };
  return shell(`<div class="story-intro"><h1>Highlights</h1></div>
    ${failure ? `<p class="story-error" role="alert">${esc(failure)}</p>` : ""}
    ${prepared ? '<p role="status">Added. Save to keep.</p>' : ""}
    ${missing.length ? '<p class="story-error" role="status">A saved choice is now missing or excluded. Replace or clear it.</p>' : ""}
    ${stale ? '<p>Leaf changed. <a href="/leaf/curate">Reopen</a></p>' : ""}
    <form method="post" action="/leaf/curate" class="curation-form">
    ${hidden("leafId", draft?.get("leafId") ?? current.leaf.id)}${hidden("subject", draft?.get("subject") ?? current.leaf.subject)}${hidden("documentRevision", draft?.get("documentRevision") ?? current.source.documentDigest)}
    <div class="curation-choices">${slots.slice(0, 4).map((_, index) => field(index)).join("")}</div>
    <details class="curation-more"${choices.slice(4).some(Boolean) ? " open" : ""}><summary>More highlights <span class="fol-metric">5–${MAX_FEATURED_LEAFLETS}</span></summary><div class="curation-choices">${slots.slice(4).map((_, index) => field(index + 4)).join("")}</div></details>
    <div class="curation-actions">${ui.button("Save highlights", { type: "submit", variant: "default", disabled: stale })}<a href="/leaf#leaf-highlights">Cancel</a></div>
    </form>`);
}

export async function saveCuration(env: Readonly<Record<string, string | undefined>>, form: URLSearchParams): Promise<void> {
  if (!env["FOLIAGE_LEAF"]?.trim()) throw new Error("Choose an explicit Leaf document before saving highlights.");
  const allowed = new Set(["leafId", "subject", "documentRevision", ...slots]);
  const keys = [...form.keys()];
  if (keys.length !== allowed.size || new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key))) throw new Error("Incomplete, unexpected or repeated highlight fields. Reopen the selection form.");
  const initial = loaded(await loadLeafDocument(env));
  await withDocumentLocks([initial.source.path], async () => {
    const current = loaded(await loadLeafDocument(env));
    if (form.get("leafId") !== current.leaf.id || form.get("subject") !== current.leaf.subject || form.get("documentRevision") !== current.source.documentDigest) throw new Error("Leaf changed. Reopen.");
    const submitted = slots.map(name => form.get(name) ?? "");
    const featured = submitted.filter(Boolean);
    if (!submitted[0] && featured.length) throw new Error("Choose the first highlight first.");
    if (new Set(featured).size !== featured.length) throw new Error("Choose each Leaflet once.");
    const invalid = featured.find(id => !current.leaf.leaflets.some(record => record.id === id && record.tier !== "excluded"));
    if (invalid) throw new Error("A chosen Leaflet is missing or excluded. Replace or clear it.");
    const next = parseLeafDocument({ ...current.leaf, curation: { featured } });
    if (!next.ok) throw new Error("The selected highlights failed the Leaf document gate. Nothing changed.");
    writeDocument(current.source.path, JSON.stringify(next.leaf, null, 2) + "\n", true);
  });
}
