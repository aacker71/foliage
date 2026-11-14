/** Owner-authored presentation over retained evidence. Saving never grants outward consent. */
import { createHash, randomUUID } from "node:crypto";
import { recordJourneyEdits, restoreJourneyVersion } from '@foliage/leaf';
import { ACHIEVEMENT_CLAIM_LABELS as CLAIM_LABELS, leafletId, parseLeafDocument, portfolioStyle, recordPortfolioStyleEdit, resolveClaimCitation, claimAnchorId, PORTFOLIO_LIMITS, type Leaf, type LeafAchievement, type ClaimCitation, type PortfolioStyle, type PortfolioStyleEdit } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { ui } from "@foliage/ui";
import { loadLeafDocument, type LeafLoad } from "./leafDocument.ts";
import { LeafLoadError } from "./loadLabels.ts";
import { esc, page, renderPortfolioMedia } from "./render.ts";
import { storyEvidence } from "./leafletStory.ts";
import { assertCitedNumbers } from "./claimNumberSupport.ts";
import { prepareJourney, parseJourneyResponse, type JourneyResponse } from './journeyCollaboration.ts';

const path = "/leaf/presentation";
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const exact = (citation: ClaimCitation) => JSON.stringify([citation.leaflet, citation.provenance.source, citation.provenance.ref, citation.provenance.observedAt]);
const historyDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const dated = (at: string) => `<time class="fol-metric" datetime="${esc(at)}" title="${esc(at)}">${esc(historyDate.format(new Date(at)))}</time>`;
const historyRef = (ref: string) => {
  const short = /^[a-f0-9]{40,64}$/i.test(ref) ? ref.slice(0, 7) : ref;
  return `<code title="${esc(ref)}">${esc(short)}</code>${short === ref ? '' : `<details><summary>Full reference</summary><code>${esc(ref)}</code></details>`}`;
};
const claimAnchor = claimAnchorId;
const achievementHref = (id: string) => `/leaf/achievement?id=${encodeURIComponent(id)}`;

function loaded(load: LeafLoad) {
  if (!load.ok) throw new LeafLoadError(load);
  if (load.source.declaredExample || load.source.bundledExample) throw new Error("Choose your real Leaf before writing your portfolio.");
  return load;
}
function shell(title: string, body: string, enhancePresentation = false): string {
  return page({ title, surface: "leaf", face: "night", nav: "leaf", state: "presentation", empty: false, portfolioLeaf: true,
    enhancePresentation,
    body: `<div class="portfolio-editor"><p><a href="/leaf">← My portfolio</a></p>${body}</div>` });
}
const field = (name: string, label: string, value: string, max: number, multiline = true) => `<div class="portfolio-field">${ui.label(label, { htmlFor: name })}${multiline ? ui.textarea({ id: name, name, defaultValue: value, maxLength: max, rows: 4 }) : ui.input({ id: name, name, defaultValue: value, maxLength: max })}</div>`;
function retainedCitations(leaf: Leaf): ClaimCitation[] {
  return leaf.leaflets.flatMap(record => record.tier === "excluded" ? [] : storyEvidence(record).map(provenance => ({ leaflet: record.id, provenance })));
}

export function renderPresentation(load: LeafLoad, query = new URLSearchParams(), draft?: URLSearchParams, failure?: string): string {
  const current = loaded(load), leaf = current.leaf;
  const action = draft?.get("action") ?? query.get("edit") ?? "profile";
  const achievementId = draft?.get("achievement") ?? query.get("achievement") ?? "";
  const achievement = leaf.achievements?.find(item => item.id === achievementId);
  const claimId = draft?.get("claim") ?? query.get("claim") ?? "";
  const claim = achievement?.claims.find(item => item.id === claimId);
  const collectionId = draft?.get("collection") ?? query.get("collection") ?? "";
  const collection = leaf.collections?.find(item => item.id === collectionId);
  const val = (name: string, fallback = "") => draft?.get(name) ?? fallback;
  const many = (name: string, fallback: readonly string[]) => draft ? draft.getAll(name) : fallback;
  const stale = !!draft && (draft.get("documentRevision") !== current.source.documentDigest || draft.get("leafId") !== leaf.id || draft.get("subject") !== leaf.subject);
  const begin = (operation: string, extra = "") => `<form class="portfolio-author-form" method="post" action="${path}">${hidden("action", operation)}${hidden("leafId", draft?.get("leafId") ?? leaf.id)}${hidden("subject", draft?.get("subject") ?? leaf.subject)}${hidden("documentRevision", draft?.get("documentRevision") ?? current.source.documentDigest)}${extra}<fieldset${stale ? " disabled" : ""}>`;
  const end = (label: string) => `<div class="portfolio-form-actions">${ui.button(label, { type: "submit", variant: label === "Restore" ? "outline" : "default" })}<a href="/leaf">Back to portfolio</a></div></fieldset></form>`;
  const nav = `<nav class="portfolio-edit-nav" aria-label="Edit portfolio"><a href="${path}">Introduction</a><a href="${path}?edit=style">Look &amp; feel</a><a href="${path}?edit=achievement">Achievements</a><a href="${path}?edit=collection">Leaf views</a><a href="/leaf/claim-check">Cited work</a><a href="/leaf/resume">Résumé</a></nav>`;
  let body = "";
  if (action === "style") {
    const target = draft?.get("target") ?? query.get("leaflet") ?? "";
    const collectionTarget = draft?.get("collectionTarget") ?? query.get("collection") ?? "";
    if (target && collectionTarget) throw new Error("Choose either a named Leaf or a Leaflet to customize.");
    const record = target ? leaf.leaflets.find(item => item.id === target && item.tier !== "excluded") : undefined;
    const targetCollection = collectionTarget ? leaf.collections?.find(item => item.id === collectionTarget) : undefined;
    if (target && !record) throw new Error("This Leaflet is no longer available.");
    if (collectionTarget && !targetCollection) throw new Error("This named Leaf is no longer available.");
    const saved = target ? leaf.presentation?.leaflets?.find(item => item.id === target)?.style : collectionTarget ? leaf.presentation?.collections?.find(item => item.id === collectionTarget)?.style : leaf.presentation?.style;
    const inherited = portfolioStyle(leaf.presentation, target || undefined, collectionTarget || undefined);
    const select = (name: keyof PortfolioStyle, label: string, choices: readonly { value: string; label: string }[]) => `<div class="portfolio-field">${ui.label(label, { htmlFor: name })}<select id="${name}" name="${name}">${[{ value: "", label: target || collectionTarget ? "Inherit" : "Default" }, ...choices].map(choice => `<option value="${choice.value}"${val(name, saved?.[name] ?? "") === choice.value ? " selected" : ""}>${choice.label}</option>`).join("")}</select></div>`;
    const scope = target ? record!.title : collectionTarget ? targetCollection!.title : "Whole portfolio";
    const undoTypography = query.get("undoTypography") ?? "", undoSpacing = query.get("undoSpacing") ?? "", undoPalette = query.get("undoPalette") ?? "", undoLayout = query.get("undoLayout") ?? "", undoHero = query.get("undoHero") ?? "", undoMedia = query.get("undoMedia") ?? "";
    const undoable = query.get("saved") === "1" && ["", "editorial", "clean"].includes(undoTypography) && ["", "airy", "compact"].includes(undoSpacing) && ["", "source", "quiet"].includes(undoPalette) && ["", "branching", "linear"].includes(undoLayout) && ["", "split", "stacked"].includes(undoHero) && ["", "contained", "immersive"].includes(undoMedia);
    const undo = undoable ? `<form class="portfolio-undo-form" method="post" action="${path}">${hidden("action", "style")}${hidden("leafId", leaf.id)}${hidden("subject", leaf.subject)}${hidden("documentRevision", current.source.documentDigest)}${hidden("target", target)}${hidden("collectionTarget", collectionTarget)}${hidden("typography", undoTypography)}${hidden("spacing", undoSpacing)}${hidden("palette", undoPalette)}${hidden("layout", undoLayout)}${hidden("hero", undoHero)}${hidden("media", undoMedia)}${ui.button("Undo", { type: "submit", variant: "outline" })}</form>` : "";
    const rawStyle = (entry: PortfolioStyleEdit) => entry.scope === "portfolio" ? leaf.presentation?.style ?? {} : entry.scope === "collection" ? leaf.presentation?.collections?.find(item => item.id === entry.target)?.style ?? {} : leaf.presentation?.leaflets?.find(item => item.id === entry.target)?.style ?? {};
    const scopeName = (entry: PortfolioStyleEdit) => entry.scope === "portfolio" ? "Whole portfolio" : entry.scope === "collection" ? leaf.collections?.find(item => item.id === entry.target)?.title ?? "Unavailable named Leaf" : leaf.leaflets.find(item => item.id === entry.target)?.title ?? "Unavailable Leaflet";
    const styleName = (value: PortfolioStyle) => `${value.typography ?? "inherited typography"} · ${value.spacing ?? "inherited rhythm"} · ${value.palette ?? "inherited palette"} · ${value.layout ?? "inherited layout"} · ${value.hero ?? "inherited hero"} · ${value.media ?? "inherited media"}`;
    const historyForm = (entry: PortfolioStyleEdit, value: PortfolioStyle, label: string) => {
      if (JSON.stringify(rawStyle(entry)) === JSON.stringify(value)) return "";
      const kind = label === "Restore" ? "restore" : "reapply";
      return `<form class="portfolio-history-${kind}" method="post" action="${path}">${hidden("action", "style")}${hidden("leafId", leaf.id)}${hidden("subject", leaf.subject)}${hidden("documentRevision", current.source.documentDigest)}${hidden("target", entry.scope === "leaflet" ? entry.target! : "")}${hidden("collectionTarget", entry.scope === "collection" ? entry.target! : "")}${hidden("typography", value.typography ?? "")}${hidden("spacing", value.spacing ?? "")}${hidden("palette", value.palette ?? "")}${hidden("layout", value.layout ?? "")}${hidden("hero", value.hero ?? "")}${hidden("media", value.media ?? "")}${ui.button(label, { type: "submit", variant: "outline" })}</form>`;
    };
    const history = leaf.presentation?.history?.length ? `<details class="portfolio-style-history"><summary>Style history · <span class="fol-metric">${leaf.presentation.history.length}</span></summary><ol>${leaf.presentation.history.slice(0, 12).map(entry => `<li><div><strong>${esc(scopeName(entry))}</strong><small>${dated(entry.at)} · ${entry.actor === "agent" ? "Local assistant" : "You"}</small><p><span>${esc(styleName(entry.before))}</span> → <span>${esc(styleName(entry.after))}</span></p></div><div class="portfolio-history-actions">${historyForm(entry, entry.before, "Restore")}${historyForm(entry, entry.after, "Reapply")}</div></li>`).join("")}</ol></details>` : "";
    const candidates = leaf.leaflets.filter(item => item.tier !== "excluded" && (!targetCollection || targetCollection.leaflets.includes(item.id)));
    const previewRecord = record ?? candidates.find(item => item.body?.some(element => "media" in element)) ?? candidates[0];
    const previewFigure = (previewRecord && renderPortfolioMedia(previewRecord)) || '<p class="lp-empty-context">No image</p>';
    const previewSource = previewRecord?.provenance?.source ?? "Source not recorded";
    body = `<h1>Look &amp; feel</h1><p>${esc(scope)}</p>${query.get("saved") === "1" ? ui.alert("Style saved.", { role: "status" }) : query.get("unchanged") === "1" ? ui.alert("No change.", { role: "status" }) : ""}${begin("style", hidden("target", target) + hidden("collectionTarget", collectionTarget))}${select("typography", "Typography", [{ value: "editorial", label: "Editorial" }, { value: "clean", label: "Clean" }])}${select("spacing", "Spacing", [{ value: "airy", label: "Airy" }, { value: "compact", label: "Compact" }])}${select("palette", "Colors", [{ value: "source", label: "Color by source" }, { value: "quiet", label: "Quiet botanical" }])}${select("layout", "Layout", [{ value: "branching", label: "Branching" }, { value: "linear", label: "Linear reading" }])}${select("hero", "Introduction", [{ value: "split", label: "Editorial split" }, { value: "stacked", label: "Focused stack" }])}${select("media", "Images", [{ value: "contained", label: "Contained" }, { value: "immersive", label: "Panel width" }])}${end("Save style")}
      ${undo}<section class="portfolio-style-preview" data-presentation-preview data-inherited-typography="${inherited.typography}" data-inherited-spacing="${inherited.spacing}" data-inherited-palette="${inherited.palette}" data-inherited-layout="${inherited.layout}" data-inherited-hero="${inherited.hero}" data-inherited-media="${inherited.media}" data-reading-typography="${inherited.typography}" data-reading-spacing="${inherited.spacing}" data-reading-palette="${inherited.palette}" data-reading-layout="${inherited.layout}" data-reading-hero="${inherited.hero}" data-reading-media="${inherited.media}" aria-labelledby="portfolio-preview-title"><p class="fol-label">Preview · ${esc(scope)}</p><header class="lp-person-hero" data-person-layout="context" data-person-composition="${inherited.hero}" data-person-content="authored"><div class="lp-person-intro"><p class="lp-editorial-label">Introduction</p><h2>${esc(leaf.subject)}</h2>${leaf.headline ? `<p class="lp-person-headline">${esc(leaf.headline)}</p>` : ""}</div>${leaf.profile?.direction?.trim() ? `<div class="lp-person-context"><section><h3 class="lp-editorial-label">Direction</h3><p>${esc(leaf.profile.direction)}</p></section></div>` : ""}</header><div class="lp-record" data-reading-palette="${inherited.palette}" data-reading-layout="${inherited.layout}" data-reading-media="${inherited.media}"><article class="lp-panel">${previewFigure}<div class="lp-source"><span>${esc(previewSource)}</span></div><h2 id="portfolio-preview-title">${esc(previewRecord?.title ?? "No evidence")}</h2></article></div></section>
      <nav class="portfolio-style-scopes" aria-label="Style scope"><h2>Scope</h2><a href="${path}?edit=style">Whole portfolio</a>${(leaf.collections ?? []).map(item => `<a href="${path}?edit=style&amp;collection=${encodeURIComponent(item.id)}">${esc(item.title)} · named Leaf</a>`).join("")}<a href="/leaf#leaf-highlights">A Leaflet</a></nav>${history}`;
  } else if (action === 'journey-history' || action === 'journey-restore') {
    if (!achievement) throw new Error('Journey not found.');
    const history = (leaf.journeyHistory ?? []).filter(entry => entry.achievement === achievement.id);
    const requested = Number(query.get('offset') ?? 0);
    const offset = Number.isSafeInteger(requested) && requested >= 0 ? Math.min(requested, Math.max(0, history.length - 1)) : 0;
    const version = (value: LeafAchievement, edit: string, side: 'before'|'after') => {
      const same = JSON.stringify(value) === JSON.stringify(achievement);
      const unavailable = value.claims.some(item => item.citations?.some(citation => resolveClaimCitation(leaf, citation).status !== 'current'));
      const replacedClaims = achievement.claims.filter(item => !value.claims.some(saved => saved.id === item.id && JSON.stringify(saved) === JSON.stringify(item)));
      const changes = [
        ...(achievement.title !== value.title ? [`<li>Title: ${esc(achievement.title)}</li>`] : []),
        ...replacedClaims.map(item => `<li>${esc(CLAIM_LABELS[item.kind])}: ${esc(item.text)}</li>`),
      ];
      const confirm = `<label class="portfolio-choice"><input type="checkbox" name="replaceCurrent" value="yes" required><span>Replace current achievement${replacedClaims.length ? ` and ${replacedClaims.length} current statement${replacedClaims.length === 1 ? '' : 's'}` : ''}</span></label>`;
      return `<section class="journey-history-version"><h3>${side === 'before' ? 'Before' : 'After'}</h3><h4>${esc(value.title)}</h4>${value.claims.map(item => `<p class="fol-label">${esc(CLAIM_LABELS[item.kind])}</p><p>${esc(item.text)}</p>${item.citations?.length ? `<ul>${item.citations.map(c => `<li>${esc(c.provenance.source)} · ${historyRef(c.provenance.ref)} · ${esc(resolveClaimCitation(leaf,c).status)}</li>`).join('')}</ul>` : '<p class="aside">No references</p>'}`).join('')}
        ${same ? '<p role="status">Current version</p>' : unavailable ? '<p role="status">References changed. Repair citations to restore.</p>' : `${begin('journey-restore', hidden('achievement', achievement.id) + hidden('editId', edit) + hidden('version', side))}${changes.length ? `<details><summary>Changes to current version</summary><ul>${changes.join('')}</ul></details>` : ''}${confirm}<div class="portfolio-form-actions">${ui.button('Restore entire achievement', { type: 'submit', variant: 'outline' })}<a href="${achievementHref(achievement.id)}">Keep current</a></div></fieldset></form>`}</section>`;
    };
    body = `<div class="journey-history"><h1>History</h1><p>${esc(achievement.title)}</p>${history.slice(offset,offset+10).map(entry => `<details class="portfolio-editor-section"><summary>${entry.actor === 'agent' ? 'Assistant' : 'You'} · ${dated(entry.at)}</summary>${entry.before ? version(entry.before,entry.id,'before') : '<p>Created</p>'}${version(entry.after,entry.id,'after')}</details>`).join('') || '<p>No edits yet</p>'}<nav aria-label="Journey history pages">${offset ? `<a href="${path}?edit=journey-history&amp;achievement=${encodeURIComponent(achievement.id)}&amp;offset=${Math.max(0,offset-10)}">Newer</a>` : ''}${offset+10<history.length ? `<a href="${path}?edit=journey-history&amp;achievement=${encodeURIComponent(achievement.id)}&amp;offset=${offset+10}">Earlier</a>` : ''}</nav><p><a href="${achievementHref(achievement.id)}">Current achievement</a></p></div>`;
  } else if (action === "profile") {
    body = `<h1>Introduction</h1>${begin("profile")}${field("headline", "Headline", val("headline", leaf.headline), 280, false)}${field("bio", "About", val("bio", leaf.profile?.bio), PORTFOLIO_LIMITS.bio)}${field("direction", "Direction", val("direction", leaf.profile?.direction), PORTFOLIO_LIMITS.direction)}${field("passions", "Interests · one per line", val("passions", leaf.profile?.passions?.join("\n")), 1600)}${end("Save")}`;
  } else if (action === "achievement" || action === "order-achievement") {
    if (achievementId && !achievement) throw new Error("This achievement is no longer in the saved Leaf.");
    body = `<h1>${achievement ? "Edit achievement" : "New achievement"}</h1>${begin("achievement", hidden("achievement", achievementId))}${field("title", "Title", val("title", achievement?.title), PORTFOLIO_LIMITS.title, false)}${end(achievement ? "Save" : "Create")}
      ${achievement ? `<div class="portfolio-editor-section"><h2>Statements</h2>${achievement.claims.length ? `<ol>${achievement.claims.map(item => `<li><a href="${path}?edit=claim&amp;achievement=${encodeURIComponent(achievement.id)}&amp;claim=${encodeURIComponent(item.id)}">${esc(CLAIM_LABELS[item.kind])}: ${esc(item.text)}</a></li>`).join("")}</ol>` : '<p>No statements</p>'}<a href="${path}?edit=claim&amp;achievement=${encodeURIComponent(achievement.id)}">Add statement</a><p><a href="${achievementHref(achievement.id)}">View</a></p></div>` : ""}`;
  } else if (action === "claim") {
    if (!achievement || claimId && !claim) throw new Error("Reopen the achievement before editing this statement.");
    const choices = many("citation", claim?.citations?.map(exact) ?? []);
    const evidence = retainedCitations(leaf);
    const unknown = choices.filter(key => !evidence.some(citation => exact(citation) === key));
    body = `<h1>Statement</h1><p>${esc(achievement.title)}</p>${begin("claim", hidden("achievement", achievement.id) + hidden("claim", claimId))}
      <div class="portfolio-field">${ui.label("Type", { htmlFor: "kind" })}<select id="kind" name="kind">${Object.entries(CLAIM_LABELS).map(([key, label]) => `<option value="${key}"${key === val("kind", claim?.kind ?? "summary") ? " selected" : ""}>${label}</option>`).join("")}</select></div>
      ${field("text", "Statement", val("text", claim?.text), PORTFOLIO_LIMITS.claimText)}
      <fieldset class="portfolio-citation-picker"><legend>Evidence</legend>
      ${unknown.map(key => `<label class="portfolio-choice"><input type="checkbox" name="citation" value="${esc(key)}" checked> Unavailable <code>${esc(key)}</code></label>`).join("")}
      ${leaf.leaflets.filter(record => record.tier !== "excluded").map(record => { const refs = evidence.filter(citation => citation.leaflet === record.id); return refs.length ? `<details${refs.some(citation => choices.includes(exact(citation))) ? " open" : ""}><summary>${esc(record.title)} <span class="fol-metric">${refs.length}</span></summary>${refs.map(citation => `<label class="portfolio-choice"><input type="checkbox" name="citation" value="${esc(exact(citation))}"${choices.includes(exact(citation)) ? " checked" : ""}><span>${esc(citation.provenance.source)} <code>${esc(citation.provenance.ref)}</code><small>Observed <time class="fol-metric">${esc(citation.provenance.observedAt)}</time> · attribution ${esc(record.tier)}</small></span></label>`).join("")}</details>` : ""; }).join("") || "<p>No evidence</p>"}
      <p class="portfolio-evidence-status" role="status">Self-reported · no evidence selected</p>
      </fieldset>${end("Save")}${claim ? `<p><a href="/leaf/claim-check?achievement=${encodeURIComponent(achievement.id)}&amp;claim=${encodeURIComponent(claim.id)}">Cited work</a></p>` : ""}`;
  } else if (action === "collection") {
    if (collectionId && !collection) throw new Error("This Leaf view is no longer in the saved portfolio.");
    const chosenAchievements = many("achievementMember", collection?.achievements ?? []), chosenRecords = many("leaflet", collection?.leaflets ?? []);
    const choices = (name: string, selected: readonly string[], items: readonly { id: string; title: string }[]) => {
      const known = new Map(items.map(item => [item.id, item]));
      // Browsers submit checked controls in DOM order. Preserve the owner's saved order even
      // when only a title or description changes; unavailable selections still need review.
      const selectedIds = [...new Set(selected)];
      const ordered = [...selectedIds.map(id => known.get(id) ?? { id, title: `Unavailable: ${id}` }),
        ...items.filter(item => !selectedIds.includes(item.id))];
      return ordered.map(item => `<label class="portfolio-choice"><input type="checkbox" name="${name}" value="${esc(item.id)}"${selected.includes(item.id) ? " checked" : ""}><span>${esc(item.title)}</span></label>`).join("");
    };
    body = `<h1>${collection ? "Edit Leaf view" : "New Leaf view"}</h1>${begin("collection", hidden("collection", collectionId))}${field("title", "Name", val("title", collection?.title), PORTFOLIO_LIMITS.title, false)}
      <div class="portfolio-field">${ui.label("Organize by", { htmlFor: "kind" })}<select id="kind" name="kind">${[["company", "Company"], ["role", "Role"], ["body-of-work", "Body of work"]].map(([key, label]) => `<option value="${key}"${key === val("kind", collection?.kind ?? "body-of-work") ? " selected" : ""}>${label}</option>`).join("")}</select></div>
      ${field("description", "Description", val("description", collection?.description), PORTFOLIO_LIMITS.collectionDescription)}<fieldset><legend>Achievements</legend>${choices("achievementMember", chosenAchievements, leaf.achievements ?? []) || "<p>No achievements</p>"}</fieldset><details><summary>More evidence</summary>${choices("leaflet", chosenRecords, leaf.leaflets.filter(record => record.tier !== "excluded")) || "<p>No records</p>"}</details>${end("Save")}`;
  } else throw new Error("Unknown editor.");
  const achievements = leaf.achievements ?? [];
  return shell("Edit portfolio", `${nav}<div class="portfolio-writing-layout"><div class="portfolio-writing-main">${failure ? ui.alert(failure) : ""}${stale ? '<p role="alert">Leaf changed. Reopen the editor to save.</p>' : ""}${body}
    </div><aside class="portfolio-editor-index"><h2>Achievements</h2>${achievements.length ? `<ol>${achievements.map((item, index) => `<li><a href="${path}?edit=achievement&amp;achievement=${encodeURIComponent(item.id)}">${esc(item.title)}</a>${index > 0 ? `${begin("order-achievement", hidden("achievement", item.id))}${ui.button("Move earlier", { type: "submit", "aria-label": `Move ${item.title} earlier` })}</fieldset></form>` : '<span class="aside">First</span>'}</li>`).join("")}</ol>` : "<p>None yet</p>"}<a href="${path}?edit=achievement">Add achievement</a><h2>Leaf views</h2>${leaf.collections?.length ? `<ul>${leaf.collections.map(item => `<li><a href="${path}?edit=collection&amp;collection=${encodeURIComponent(item.id)}">${esc(item.title)}</a></li>`).join("")}</ul>` : "<p>None yet</p>"}<a href="${path}?edit=collection">New Leaf view</a></aside></div>`, true);
}

/**
 * "Not saved." only answers a save: with no submitted draft this page reports a read that failed.
 * `technical` is the closed Technical details naming a record file to repair (`technicalFor`).
 */
export function renderPresentationFailure(message: string, draft?: URLSearchParams, technical = ""): string {
  const heading = draft ? "Not saved" : "Couldn't open this page";
  return shell(heading, `<h1>${heading}.</h1>${ui.alert(message)}${draft ? `<details open><summary>Your draft</summary><pre>${esc([...draft.entries()].filter(([key]) => !["documentRevision", "leafId", "subject"].includes(key)).map(([key, value]) => `${key}: ${value}`).join("\n"))}</pre></details>` : ""}<a href="${path}">Reopen editor</a>${technical}`);
}

/** Exact-key form commands plus whole-document revision binding prevent cross-tab overwrites. */
export async function savePresentation(env: Readonly<Record<string, string | undefined>>, form: URLSearchParams, actor: "manual" | "agent" = "manual", options?: {
  /** Server-only receipt authority, checked while the canonical Leaf document is locked. */
  journeyReview?: (current: LeafLoad) => { response: JourneyResponse; selectedLeaflets: readonly string[] };
  onSaved?: (documentDigest: string) => void;
}): Promise<string> {
  if (!env["FOLIAGE_LEAF"]?.trim()) throw new Error("Choose an explicit Leaf document before saving your portfolio.");
  const actions: Record<string, { fields: string[]; repeated?: string[] }> = {
    style: { fields: ["target", "collectionTarget", "typography", "spacing", "palette", "layout", "hero", "media"] },
    profile: { fields: ["headline", "bio", "direction", "passions"] }, achievement: { fields: ["achievement", "title"] },
    claim: { fields: ["achievement", "claim", "kind", "text"], repeated: ["citation"] },
    'journey-edits': { fields: ['achievement', 'proposal'] },
    'journey-restore': { fields: ['achievement', 'editId', 'version', 'replaceCurrent'] },
    collection: { fields: ["collection", "title", "kind", "description"], repeated: ["achievementMember", "leaflet"] },
    "order-achievement": { fields: ["achievement"] },
  };
  const action = form.get("action") ?? "", shape = Object.hasOwn(actions, action) ? actions[action] : undefined;
  if (!shape) throw new Error("Unknown portfolio edit. Reopen the editor.");
  if (action === 'journey-restore' && !form.has('replaceCurrent')) {
    throw new Error('Confirm replacement of the current achievement before restoring this version. Nothing was changed.');
  }
  const singles = ["action", "leafId", "subject", "documentRevision", ...shape.fields], repeated = shape.repeated ?? [];
  if (singles.some(name => form.getAll(name).length !== 1) || [...form.keys()].some(name => !singles.includes(name) && !repeated.includes(name)) || repeated.some(name => new Set(form.getAll(name)).size !== form.getAll(name).length)) throw new Error("Incomplete, repeated or unexpected fields. Reopen the editor.");
  const initial = loaded(await loadLeafDocument(env));
  let redirect = "/leaf";
  await withDocumentLocks([initial.source.path], async () => {
    const current = loaded(await loadLeafDocument(env)), leaf = current.leaf;
    if (current.source.path !== initial.source.path || form.get("leafId") !== leaf.id || form.get("subject") !== leaf.subject || form.get("documentRevision") !== current.source.documentDigest) throw new Error("Leaf changed. Reopen.");
    const text = (key: string) => (form.get(key) ?? "").trim();
    let next: unknown;
    let shouldWrite = true;
    if (action === 'journey-restore') {
      const version = text('version');
      if (version !== 'before' && version !== 'after') throw new Error('Choose a recorded journey version.');
      const restored = restoreJourneyVersion(leaf, text('achievement'), text('editId'), version);
      const currentAchievement = leaf.achievements?.find(item => item.id === text('achievement'));
      const savedAchievement = restored.achievements?.find(item => item.id === text('achievement'));
      if (JSON.stringify(currentAchievement) !== JSON.stringify(savedAchievement) && text('replaceCurrent') !== 'yes') {
        throw new Error('Confirm replacement of the current achievement before restoring this version. Nothing was changed.');
      }
      next = restored;
      redirect = `${path}?edit=journey-history&achievement=${encodeURIComponent(text('achievement'))}`;
    } else if (action === "style") {
      const target = text("target"), collectionTarget = text("collectionTarget");
      if (target && collectionTarget) throw new Error("Choose either a named Leaf or a Leaflet to customize.");
      const previous = target ? leaf.presentation?.leaflets?.find(item => item.id === target)?.style : collectionTarget ? leaf.presentation?.collections?.find(item => item.id === collectionTarget)?.style : leaf.presentation?.style;
      next = recordPortfolioStyleEdit(leaf, target || undefined, { ...(text("typography") ? { typography: text("typography") } : {}), ...(text("spacing") ? { spacing: text("spacing") } : {}), ...(text("palette") ? { palette: text("palette") } : {}), ...(text("layout") ? { layout: text("layout") } : {}), ...(text("hero") ? { hero: text("hero") } : {}), ...(text("media") ? { media: text("media") } : {}) }, actor, new Date().toISOString(), randomUUID(), collectionTarget || undefined);
      shouldWrite = JSON.stringify(next) !== JSON.stringify(leaf);
      const query = new URLSearchParams({ edit: "style", ...(shouldWrite ? { saved: "1", undoTypography: previous?.typography ?? "", undoSpacing: previous?.spacing ?? "", undoPalette: previous?.palette ?? "", undoLayout: previous?.layout ?? "", undoHero: previous?.hero ?? "", undoMedia: previous?.media ?? "" } : { unchanged: "1" }) });
      if (target) query.set("leaflet", target);
      if (collectionTarget) query.set("collection", collectionTarget);
      redirect = `${path}?${query}`;
    } else if (action === "profile") {
      const { headline: _previous, ...retained } = leaf;
      next = { ...retained, ...(text("headline") ? { headline: text("headline") } : {}), profile: { ...(text("bio") ? { bio: text("bio") } : {}), ...(text("direction") ? { direction: text("direction") } : {}), passions: text("passions").split(/\r?\n/).map(value => value.trim()).filter(Boolean) } };
    } else if (action === "collection") {
      const id = text("collection") || randomUUID(), previous = leaf.collections?.find(item => item.id === id);
      if (text("collection") && !previous) throw new Error("This Leaf view is no longer available.");
      const achievements = form.getAll("achievementMember"), selectedRecords = form.getAll("leaflet");
      const leaflets = [...new Set([...selectedRecords, ...(leaf.achievements ?? []).filter(item => achievements.includes(item.id)).flatMap(item => item.claims.flatMap(claim => (claim.citations ?? []).filter(citation => resolveClaimCitation(leaf, citation).status === "current").map(citation => citation.leaflet)))])];
      if (achievements.some(value => !leaf.achievements?.some(item => item.id === value)) || leaflets.some(value => !leaf.leaflets.some(item => item.id === value && item.tier !== "excluded"))) throw new Error("A selection is unavailable. Clear it.");
      const updated = { id, title: text("title"), kind: text("kind"), ...(text("description") ? { description: text("description") } : {}), achievements, leaflets };
      next = { ...leaf, collections: previous ? leaf.collections!.map(item => item.id === id ? updated : item) : [...(leaf.collections ?? []), updated] };
      redirect = `/leaf?collection=${encodeURIComponent(id)}#leaf-highlights`;
    } else {
      const id = text("achievement") || randomUUID(), achievements = [...(leaf.achievements ?? [])], index = achievements.findIndex(item => item.id === id);
      if (text("achievement") && index < 0 || action !== "achievement" && index < 0) throw new Error("This achievement is no longer available.");
      if (action === "achievement") {
        const updated = { id, title: text("title"), claims: index >= 0 ? achievements[index]!.claims : [] };
        if (index < 0) achievements.push(updated); else achievements[index] = updated;
        redirect = `${path}?edit=achievement&achievement=${encodeURIComponent(id)}`;
      } else if (action === "order-achievement") {
        if (index > 0) [achievements[index - 1], achievements[index]] = [achievements[index]!, achievements[index - 1]!];
        redirect = "/leaf#portfolio-keystones";
      } else if (action === 'journey-edits') {
        const stored=options?.journeyReview?.(current);
        const context=prepareJourney(current,id,'Apply reviewed revisions.',[],stored?.selectedLeaflets);
        const supplied=JSON.parse(text('proposal'));
        if(stored&&JSON.stringify(stored.response)!==JSON.stringify(supplied)) throw new Error('The reviewed suggestion changed. Reopen the journey.');
        const proposal=stored?.response??parseJourneyResponse(supplied,context);
        if(!proposal.edits.length || proposal.featuredLeaflets.length) throw new Error('Review statement revisions separately from highlight choices.');
        const selectedCitations=new Set(context.evidence.flatMap(item=>item.citations.map(citation=>JSON.stringify(citation))));
        for (const edit of proposal.edits) {
          const citations=edit.citations.filter(citation=>selectedCitations.has(JSON.stringify(citation)));
          if (!citations.length) throw new Error('Select evidence for every journey update. Nothing saved.');
          assertCitedNumbers(leaf, edit.text, citations.map(citation => ({...citation, leaflet: leafletId(citation.leaflet)})));
        }
        const edits=new Map(proposal.edits.map(edit=>[edit.claim,edit]));
        achievements[index]={...achievements[index]!,claims:achievements[index]!.claims.map(claim=>{const edit=edits.get(claim.id);return edit?{...claim,text:edit.text,citations:edit.citations.map(c=>({...c,leaflet:leafletId(c.leaflet)}))}:claim;})};
        redirect=achievementHref(id);
      } else {
        const claimId = text("claim") || randomUUID(), achievement = achievements[index]!;
        if (text("claim") && !achievement.claims.some(item => item.id === claimId)) throw new Error("This statement is no longer available.");
        const choices = retainedCitations(leaf), available = new Map(choices.map(citation => [exact(citation), citation]));
        const citations = form.getAll("citation").map(key => { const citation = available.get(key); if (!citation || resolveClaimCitation(leaf, citation).status !== "current") throw new Error("A citation changed. Remove or reselect it."); return citation; });
        if (citations.length) assertCitedNumbers(leaf, text("text"), citations);
        const updated = { id: claimId, kind: text("kind"), text: text("text"), citations };
        achievements[index] = { ...achievement, claims: (text("claim") ? achievement.claims.map(item => item.id === claimId ? updated : item) : [...achievement.claims, updated]) as LeafAchievement["claims"] };
        redirect = `${achievementHref(id)}#${claimAnchor(id, claimId)}`;
      }
      next = { ...leaf, achievements };
    }
    const parsed = parseLeafDocument(next);
    if (!parsed.ok) throw new Error(`The portfolio could not be saved: ${parsed.issues.map(issue => issue.message).join(" ")}`);
    const recorded = parseLeafDocument(recordJourneyEdits(leaf, parsed.leaf, actor, new Date().toISOString(), randomUUID));
    if (!recorded.ok) throw new Error('History not recorded. Nothing changed.');
    if (shouldWrite && JSON.stringify(recorded.leaf) !== JSON.stringify(leaf)) {
      const bytes=JSON.stringify(recorded.leaf, null, 2) + "\n";
      writeDocument(current.source.path, bytes, true);
      options?.onSaved?.(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    } else options?.onSaved?.(current.source.documentDigest);
  });
  return redirect;
}

export function renderAchievement(load: LeafLoad, id: string): string | null {
  const { leaf } = loaded(load), achievement = leaf.achievements?.find(item => item.id === id);
  if (!achievement) return null;
  return shell(achievement.title, `<article class="portfolio-achievement"><header><p class="fol-label">Achievement</p><h1 data-authored="subject">${esc(achievement.title)}</h1><a href="${path}?edit=achievement&amp;achievement=${encodeURIComponent(id)}">Edit</a> · <a href="/leaf/scarlet?achievement=${encodeURIComponent(id)}">Work with Scarlet (cloud)</a> · <a href="${path}?edit=journey-history&amp;achievement=${encodeURIComponent(id)}">History</a></header>
    ${achievement.claims.map(claim => `<section class="portfolio-claim" id="${claimAnchor(id, claim.id)}" tabindex="-1"><p class="fol-label">${esc(CLAIM_LABELS[claim.kind])}</p><h2 data-authored="subject">${esc(claim.text)}</h2>
      <p class="lp-actions"><a href="${achievementHref(id)}#${claimAnchor(id, claim.id)}">Permalink</a><a href="${path}?edit=claim&amp;achievement=${encodeURIComponent(id)}&amp;claim=${encodeURIComponent(claim.id)}">Edit statement</a><a href="/leaf/claim-check?achievement=${encodeURIComponent(id)}&amp;claim=${encodeURIComponent(claim.id)}">Cited work</a></p>
      ${claim.citations?.length ? `<ol class="portfolio-claim-citations">${claim.citations.map(citation => { const result = resolveClaimCitation(leaf, citation), record = leaf.leaflets.find(item => item.id === citation.leaflet); return `<li data-citation-status="${result.status}"><strong>${result.status === "current" ? "Cited · not independently verified" : result.status === "stale" ? "Reference changed" : result.status === "excluded" ? "Excluded" : "Record unavailable"}</strong><p>${esc(record?.title ?? citation.leaflet)}</p><p><span>${esc(citation.provenance.source)}</span> <code>${esc(citation.provenance.ref)}</code></p><p>Observed <time class="fol-metric">${esc(citation.provenance.observedAt)}</time></p>${record?.tier === "excluded" ? `<p>${esc(record.reason)}</p>` : ""}${result.status === "current" && record ? `<p>Attribution: ${esc(record.tier)}</p><a href="/my/leaflet/${encodeURIComponent(record.id)}">Source</a>` : ""}</li>`; }).join("")}</ol>` : '<p class="portfolio-support-missing">Self-reported · no evidence</p>'}
      </section>`).join("") || '<p>No statements</p>'}<p><a href="/leaf/resume.md">Download résumé</a></p></article>`);
}

/** A draft, never a public proof certificate. Markdown syntax cannot be injected by prose. */
export function resumeDraft(leaf: Leaf): string {
  const md = (value: string) => value.replace(/[\\`*_{}\[\]<>#+.!|~-]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const notes: string[] = [];
  const lines = [`# ${md(leaf.subject)}`, "", "Private résumé citation draft. Links resolve only in your local workspace. Replace them with reviewed public claim links before sharing.", "", "Statements are the person's account. Attached references do not independently verify outcomes.", ""];
  for (const achievement of leaf.achievements ?? []) {
    lines.push(`## ${md(achievement.title)}`, "");
    for (const claim of achievement.claims) {
      const number = notes.length + 1;
      lines.push(`- **${md(CLAIM_LABELS[claim.kind])}:** ${md(claim.text)} [${number}]`, "");
      const references = (claim.citations ?? []).map(citation => `${md(citation.provenance.source)} / ${md(citation.provenance.ref)} (${resolveClaimCitation(leaf, citation).status}; observed ${md(citation.provenance.observedAt)})`);
      notes.push(`[${number}] [Inspect exact statement](${achievementHref(achievement.id)}#${claimAnchor(achievement.id, claim.id)}). ${references.length ? references.join("; ") : "Supporting evidence not attached."}`);
    }
  }
  if (!notes.length) lines.push("No achievement statements have been written yet.", "");
  return [...lines, ...notes, ""].join("\n");
}

/** A live projection of the same saved achievements; never a second editable résumé store. */
export function renderLiveResume(load: LeafLoad): string {
  const { leaf, source } = loaded(load);
  const body = `<div class="portfolio-editor"><p><a href="/leaf">← My portfolio</a></p>
    <article id="personal-portfolio" data-reading-view="resume" data-portfolio-revision="${esc(source.documentDigest)}" data-policy-revision="" data-work-dates-revision="">
    <p class="fol-label">Résumé · private draft</p><p>This draft includes private work and local evidence links. Review what you want to publish before sending it with an application.</p><h1>${esc(leaf.subject)}</h1>
    ${leaf.headline ? `<p>${esc(leaf.headline)}</p>` : ""}${leaf.profile?.bio ? `<p>${esc(leaf.profile.bio)}</p>` : ""}

    ${(leaf.achievements ?? []).map(achievement => `<section class="portfolio-editor-section" data-record-id="${esc(achievement.id)}"><h2>${esc(achievement.title)}</h2>
      ${achievement.claims.map(claim => {
        const citations = (claim.citations ?? []).map(citation => resolveClaimCitation(leaf, citation));
        const needsRepair = citations.some(citation => citation.status !== 'current');
        return `<section class="portfolio-claim"><h3 class="fol-label">${esc(CLAIM_LABELS[claim.kind])}</h3><p data-authored="subject">${esc(claim.text)}</p><p class="aside">${needsRepair ? 'Evidence changed · review before sharing' : citations.length ? 'Cited · not independently verified' : 'Self-reported'}</p>
        <p class="lp-actions"><a href="${achievementHref(achievement.id)}#${claimAnchor(achievement.id, claim.id)}">Evidence</a><a href="/leaf/claim-check?achievement=${encodeURIComponent(achievement.id)}&amp;claim=${encodeURIComponent(claim.id)}">Cited work</a></p></section>`;
      }).join('') || '<p>No statements</p>'}</section>`).join('') || '<p>No achievements</p><a href="/leaf/photosynthesis">Photosynthesis</a>'}
    </article><p id="portfolio-sync" role="status">Auto-updating</p>
    <p class="lp-actions"><a href="/publish">Review for publication</a><a href="/leaf/resume.md">Download private draft (.md)</a><a href="/leaf/presentation?edit=achievement">Edit</a></p></div>`;
  return page({title:'Résumé · Foliage',surface:'leaf',face:'night',nav:'leaf',state:'resume',empty:!leaf.achievements?.length,portfolioLeaf:true,enhancePortfolio:true,body});
}
