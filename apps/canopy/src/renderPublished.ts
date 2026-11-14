import { portfolioStyle } from "@foliage/leaf";
import { renderAuthoredHero, renderAuthoredKeystones, renderPublicCollections, renderPublicCollectionFallback, renderPublicAchievements, renderPublicCitationReceipts, publicCollectionIds } from "./renderAuthoredPortfolio.ts";
/**
 * Rendering one admitted Leaf. Public mode is the page a stranger reads; private preview mode
 * lets the owner inspect the prepared artifact before the separate publication action.
 *
 * In public mode the audience is not the subject or the operator.
 * Three rules follow from that, and each is a defect if broken.
 *
 *   1. EVERY LINE COMES FROM A TYPED FIELD OF THE ARTIFACT. Nothing is inferred, nothing is
 *      counted here that the artifact did not state, and there is no path by which text that is
 *      not a field can reach the page. That is the whole reason the published artifact is a
 *      DOCUMENT rather than pre-rendered HTML: a canopy serving somebody else's markup can only
 *      hope it says what it claims, while a canopy rendering a document can only say what the
 *      document holds.
 *
 *   2. NO SERVER PATH REACHES THIS PAGE — not on success, and not on any failure state. `/tree`
 *      prints its manifest path in the footer, which is correct for an operator looking at their
 *      own file. This page is public, and an absolute path is `/Users/<somebody's account name>/…`
 *      — an identifier arriving through a field nobody was looking at, on a page about a person
 *      who consented to publish a portfolio and not their host's directory layout. So the loader's
 *      `detail` string, which names paths deliberately, IS NOT RENDERED. Each cause gets its own
 *      path-free explanation written here, and the server logs the full detail where operators
 *      read logs. `publishedLeaf.test.ts` asserts no rendered failure page contains the path.
 *
 *   3. THE SEVEN LOAD CAUSES STAY SEVEN. Each gets its own heading and its own next step. A shared "something went wrong" would send an operator to none of the seven
 *      places they might need to go, and would tell a reader that a person's page is missing when
 *      what is actually true is that the canopy was never configured.
 *
 * WHAT THE PAGE MUST SAY OUT LOUD, beyond the leaflets:
 *
 *   IN PUBLIC MODE, WHEN IT WAS PUBLISHED, AND FROM WHAT. `publishedAt` and the source digest are rendered, not
 *   hidden in the file. A portfolio page with no date is one nobody can date-check, and a reader
 *   who cannot tell whether they are looking at last week or two years ago is being invited to
 *   assume the flattering answer. The digest is the leaf document's own bytes, so the subject can
 *   hash their file and prove this page came from it.
 *
 *   THAT THIS IS NOT THE WHOLE LEAF. `withheld` is rendered as entries and kinds — never as a
 *   number of leaflets, because a withheld entry may be a whole leaflet or a single address cut
 *   out of a title that did cross, and the two cannot be added. A published page that showed three
 *   leaflets and said nothing about the sixty that did not cross would be a page silently claiming
 *   to be a portfolio.
 *
 *   WHICH WORDS ARE THE ARTIFACT'S. A title that was NOT redacted is the artifact's own words and
 *   carries `data-verbatim="title"`. A title that WAS redacted is not verbatim any more and must
 *   not carry the marker — the marker is a claim about the provenance of text, and applying it to
 *   a string this product altered would assert the artifact said something it did not.
 *
 *   WHICH TIER EACH ROW IS. Since 2026-09-06 (`.loop/MERGE-DECISIONS.md` row D1) this page holds
 *   `pending` leaflets beside `verified` ones — the gate that used to admit `verified` only was
 *   removed, and the tier travels with each leaflet instead of deciding whether it crosses at
 *   all. `leafletCell` prints a badge naming the tier on every row, and `tierStanding` (imported
 *   from `renderPublic.ts`, the other surface making this exact disclosure) says once per tier
 *   present what the word does and does not mean. A page carrying `pending` work with nothing
 *   saying so would be the overclaim the old gate existed to prevent, moved rather than fixed.
 *
 * NO SCORE, with no exempt region at all. `renderTree.ts` needs one because the section stating
 * the policy has to name it; this page states no policy, so it contains none of those words and
 * the check over it is unscoped except for verbatim evidence — a real commit subject may contain
 * any word at all, and refusing to render somebody's real commit message to satisfy a substring
 * check would falsify the evidence this page exists to carry.
 *
 * Every interpolated value is escaped. The artifact is a file some publisher produced, very
 * likely from commit messages, and none of that is trustworthy HTML.
 */

import type {
  PublishedLeafDocument,
  PublishedLeaflet,
  PublishedPortfolio,
  PublishedPhoto,
  PublishedVideo,
  ReadableWithholdingKind,
} from "@foliage/canopy";

import {
  PUBLISHED_ENV,
  type PublishedLoad,
  type PublishedLoadCause,
  type PublishedSourceFile,
} from "./publishedLeaf.ts";
import { proofBadge, tierStanding, TIER_STANDING } from "./renderPublic.ts";
import { publishedUrl } from "./publishedLeaf.ts";
import { PUBLIC_LEAFLET_ROUTE } from "./renderTree.ts";
import { readStoryElement, STORY_SECTIONS } from "@foliage/leaf-app/render";
import { ui } from "@foliage/ui";

/** Escape for both text nodes and double-quoted attribute values. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip every region marked as the artifact's own words.
 *
 * Exported because the TESTS are the consumer, and for the reason `render.ts` established: the NO
 * SCORE invariant is a substring check over what this module ASSERTS, and a verbatim commit
 * subject is not something this module asserts — it is evidence being carried. A real repository
 * on this machine contains a commit titled "…index scoring, budgeted walk", which survives a naive
 * whole-page check by luck alone. Scoping needs a marker, and this is the marker's reader.
 */
export function withoutVerbatimRegions(html: string): string {
  return html.replace(/<(h[12]) class="pub-title" data-verbatim="title">[\s\S]*?<\/\1>/g, "");
}

/**
 * Human wording for each withholding kind. Plain enough for the person the page is about.
 *
 * `unproven-leaflet` is here even though nothing written since 2026-09-06 can produce it: a
 * version-1 artifact (see `publishedDocument.ts`'s header) may still carry it, and this page has
 * to render a legacy artifact's withheld report honestly rather than throw on a key it does not
 * recognise.
 */
const KIND_LABEL: Readonly<Record<ReadableWithholdingKind, string>> = Object.freeze({
  "email-address": "email-like text cut from a title",
  "identity-trailer": "co-author credit cut from a title",
  "account-handle": "handle-like text cut from a title",
  "phone-number": "phone-like text cut from a title",
  "not-shared": "leaflet not offered",
  "policy-denied": "leaflet blocked by publication rules",
  "unattributed-leaflet": "leaflet that could not be attributed to this person",
  "unpublishable-provenance": "leaflet whose provenance carried an identifier",
  "unproven-leaflet": "leaflet withheld as unproven (legacy)",
});

function page(opts: {
  readonly title: string;
  readonly state: string;
  readonly body: string;
  readonly portfolio?: boolean;
  readonly enhancePortfolio?: boolean;
  readonly preview?: PrivatePreviewMode;
}): string {
  const previewBack = opts.preview?.kind === "hosted"
    ? `/manage/${encodeURIComponent(opts.preview.subjectId)}`
    : opts.preview?.kind === "local-hosted" ? "/hosted" : "";
  return `<!doctype html>
<html lang="en" data-face="day">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/foliage-tokens.css">
${opts.portfolio || opts.preview ? `<link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/controls.css">${opts.portfolio ? '<link rel="stylesheet" href="/portfolio-leaf.css">' : ""}` : ""}
<link rel="stylesheet" href="/published.css">
${opts.enhancePortfolio ? '<script type="module" src="/portfolio-leaf.bundle.js"></script>' : ""}
</head>
<body data-published-state="${esc(opts.preview ? "private-preview" : opts.state)}">
<a class="pub-skip" href="#pub-main">Skip to content</a>
<div class="pub-plane" role="note">
<span class="pub-plane-dot" aria-hidden="true"></span>
<b>${opts.preview ? "Private preview" : "Published leaf"}</b>
</div>
<header class="pub-head">
<span class="pub-mark" role="img" aria-label="Foliage"></span>
<span class="fol-label">Foliage</span>
${previewBack ? `<a class="pub-preview-back" href="${esc(previewBack)}">Back to hosting</a>` : ""}
</header>
<main id="pub-main" class="pub-main">
${opts.body}
</main>
</body>
</html>
`;
}

function previewDecision(preview: PrivatePreviewMode | undefined): string {
  if (!preview) return "";
  const hosted = preview.kind === "hosted";
  const action = hosted ? `/manage/${encodeURIComponent(preview.subjectId)}/publish` : "/hosted/publish";
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  return `<section class="pub-preview-decision" aria-labelledby="pub-preview-decision-h">
<h2 id="pub-preview-decision-h">${preview.replacing ? "Publish changes" : "Publish this version"}</h2>
<p class="pub-preview-consequence">${preview.replacing ? "Replaces the public version in full; anyone with the link can read these changes." : "Anyone with the link can read this once published."}</p>
<form method="post" action="${esc(action)}">
${hidden("csrf", preview.csrf)}
${hosted ? hidden("document", preview.document) + hidden("evidence", preview.evidence) + hidden("consent", preview.consent) + hidden("reviewActorId", preview.reviewActorId) : hidden("operationId", preview.operationId) + hidden("confirm", preview.subjectId)}
${ui.button(preview.replacing ? "Publish changes" : "Publish", { type: "submit", variant: "default" })}
</form>
<a class="pub-preview-cancel" href="${esc(hosted ? `/manage/${encodeURIComponent(preview.subjectId)}` : "/hosted")}">Keep editing</a>
</section>`;
}

/**
 * One leaflet. Provenance is shown when the leaflet carries any — it is the handle that makes a
 * claim checkable, and the parse gate requires it for `verified`. A `pending` leaflet's is
 * optional (mirroring `Leaflet` itself, and the live projection this page's rule now matches),
 * so its absence is said in words rather than left as a blank definition list.
 *
 * THE BADGE IS HERE; THE SENTENCE IS NOT. Since 2026-09-06 (`.loop/MERGE-DECISIONS.md` row D1) a
 * `pending` leaflet reaches this page beside a `verified` one, and the whole argument for removing
 * that gate was that the tier would travel with it — see `publish.ts`'s header. `proofBadge`
 * (imported from `renderPublic.ts` rather than restated, for the reason that file gives) prints
 * the fact on every row; `tierStanding`, below, prints what it means ONCE per tier actually
 * present on the page, not once per row — the same density trade `renderPublic.ts` already made
 * and measured for its own roster, and a page holding many leaflets of one tier would otherwise
 * repeat the same three sentences as many times as it has rows.
 */
function narrativeParagraph(paragraph: NonNullable<PublishedLeaflet["narrative"]>[number]): string {
  // Parse only these admitted bytes. A published page never resolves a private Leaflet to
  // discover more context or supporting material that the person did not choose to publish.
  const story = readStoryElement(paragraph);
  if (story) {
    return `<div class="pub-paragraph pub-story" data-story-section="${story.section}"><h3 class="pub-story-label">${esc(STORY_SECTIONS.find(section => section.key === story.section)!.label)}</h3>
<p class="pub-paragraph-text">${esc(story.text)}</p>
<details class="pub-paragraph-reference"><summary>Evidence</summary>
<dl class="pub-prov">
<div><dt>Supporting source</dt><dd>${esc(story.supporting.source)}</dd></div>
<div><dt>Supporting ref</dt><dd class="fol-metric">${esc(story.supporting.ref)}</dd></div>
<div><dt>Evidence observed</dt><dd class="fol-metric"><time datetime="${esc(story.supporting.observedAt)}">${esc(story.supporting.observedAt)}</time></dd></div>
<div><dt>Account recorded by</dt><dd>${esc(story.reviewer)}</dd></div>
<div><dt>Account recorded at</dt><dd class="fol-metric"><time datetime="${esc(story.at)}">${esc(story.at)}</time></dd></div>
<div><dt>Paragraph source</dt><dd>${esc(paragraph.provenance.source)}</dd></div>
<div><dt>Paragraph ref</dt><dd class="fol-metric">${esc(paragraph.provenance.ref)}</dd></div>
</dl><p class="pub-context-note">The person's account; the reference does not verify it.</p></details></div>`;
  }
  return `<div class="pub-paragraph"><p class="pub-paragraph-text">${esc(paragraph.text)}</p><details class="pub-paragraph-reference"><summary>Reference</summary><dl class="pub-prov"><div><dt>Source</dt><dd>${esc(paragraph.provenance.source)}</dd></div><div><dt>Ref</dt><dd class="fol-metric">${esc(paragraph.provenance.ref)}</dd></div><div><dt>Observed</dt><dd class="fol-metric"><time datetime="${esc(paragraph.provenance.observedAt)}">${esc(paragraph.provenance.observedAt)}</time></dd></div></dl></details></div>`;
}

type PhotoUrl = (photo: PublishedPhoto) => string;
type VideoUrl = (video: PublishedVideo) => string;

/** A prepared artifact is readable before publication, but it is not a live address. */
export type PrivatePreviewMode =
  | Readonly<{ kind: "hosted"; csrf: string; subjectId: string; replacing: boolean; document: string; evidence: string; consent: string; reviewActorId: string }>
  | Readonly<{ kind: "local-hosted"; csrf: string; operationId: string; subjectId: string; replacing: boolean }>;

type PublishedRenderOptions = Readonly<{
  enhancePortfolio?: boolean;
  photoUrl?: PhotoUrl;
  videoUrl?: VideoUrl;
  linkToDetail?: boolean;
  preview?: PrivatePreviewMode;
}>;

/** An exact frozen publication, not a tree projection; removal of that publication ends the link. */
export function publishedLeafletHref(leafId: string, leafletId: string): string {
  return `${PUBLIC_LEAFLET_ROUTE}${encodeURIComponent(leafletId)}?publication=${encodeURIComponent(leafId)}`;
}

function selectedMedia(l: PublishedLeaflet, photoUrl?: PhotoUrl, videoUrl?: VideoUrl): string {
  const videos = l.videos ?? [];
  const playable = photoUrl && videoUrl ? videos : [];
  const posterRefs = new Set(playable.map(video => video.posterRef));
  const photos = (l.photos ?? []).filter(photo => !posterRefs.has(photo.sourceRef));
  if (!videos.length && !photos.length) return "";
  const demos = playable.map(video => {
    const poster = l.photos?.find(photo => photo.sourceRef === video.posterRef);
    if (!poster) return "";
    const src = videoUrl!(video), still = photoUrl!(poster);
    const label = video.caption ?? l.title;
    return `<figure class="pub-demo"><video controls playsinline preload="none" poster="${esc(still)}" aria-label="Demo of ${esc(label)}"><source src="${esc(src)}" type="video/mp4">Video playback unavailable. <a href="${esc(src)}">Open video</a></video><figcaption><span>${video.caption ? esc(video.caption) : "Demo"}</span><span class="fol-metric">${esc(String(video.durationSeconds))} s</span></figcaption><details><summary>Video reference</summary><dl class="pub-prov"><div><dt>Source clip</dt><dd class="fol-metric">${esc(video.sourceRef)}</dd></div><div><dt>Poster image</dt><dd class="fol-metric">${esc(poster.sourceRef)}</dd></div></dl><a href="${esc(still)}">Open still</a></details><img class="pub-demo-print" src="${esc(still)}" alt="${esc(poster.alt)}"></figure>`;
  }).filter(Boolean).join("");
  const photoFigures = photos.length ? `<div class="pub-photos" aria-label="Selected photos">${photoUrl ? photos.map(photo => `<figure class="pub-photo"><img src="${esc(photoUrl(photo))}" alt="${esc(photo.alt)}" loading="lazy" decoding="async">${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ""}<details><summary>Image reference</summary><dl class="pub-prov"><div><dt>Source image</dt><dd class="fol-metric">${esc(photo.sourceRef)}</dd></div><div><dt>Stripped rendition</dt><dd class="fol-metric">${esc(photo.renditionDigest)}</dd></div></dl></details></figure>`).join("") : '<p>Selected image unavailable in this reader.</p>'}</div>` : "";
  return `<div class="pub-work-media">${demos ? `<div class="pub-demos" aria-label="Selected demos">${demos}</div>` : videos.length ? '<p class="pub-demo-unavailable">Selected demo unavailable in this reader.</p>' : ""}${photoFigures}</div>`;
}

function leafletCell(l: PublishedLeaflet, index: number, leafId: string, authored?: PublishedPortfolio, photoUrl?: PhotoUrl, videoUrl?: VideoUrl, detail = false, linkToDetail = true): string {
  // The marker is applied ONLY to text that is still the artifact's own. See the header.
  const titleTag = detail ? "h1" : "h2";
  const title = l.titleRedacted
    ? `<${titleTag} class="pub-title pub-title--redacted">${esc(l.title)}</${titleTag}>
<p class="pub-note pub-redacted-note">Title partly withheld — no longer word for word.</p>`
    : `<${titleTag} class="pub-title" data-verbatim="title">${esc(l.title)}</${titleTag}>`;

  const ref = l.provenance?.ref ?? "";
  const shortRef = /^[0-9a-f]{40,64}$/i.test(ref) ? ref.slice(0, 7) : ref;
  const provenance =
    l.provenance === undefined
      ? `<p class="aside">No provenance recorded.</p>`
      : `<dl class="pub-prov">
<div><dt class="fol-label">Source</dt><dd>${esc(l.provenance.source)}</dd></div>
<div><dt class="fol-label">Ref</dt><dd class="fol-metric"><span title="${esc(ref)}">${esc(shortRef)}</span>${shortRef === ref ? "" : ` <details class="pub-full-ref"><summary>Full reference</summary><code>${esc(ref)}</code></details>`}</dd></div>
</dl>`;

  const narrative = l.narrative?.length ? `<section class="pub-narrative" aria-label="Context from the person"><p class="fol-label">In their words</p>${l.narrative.slice(0, 2).map(narrativeParagraph).join("")}${l.narrative.length > 2 ? `<details class="lp-detail pub-more-context"><summary>More</summary>${l.narrative.slice(2).map(narrativeParagraph).join("")}</details>` : ""}<p class="pub-context-note">Context chosen by the person.</p></section>` : "";
  const media = selectedMedia(l, photoUrl, videoUrl);
  const titleOnly = narrative === "" && media === "";
  const detailLink = detail || !linkToDetail ? "" : `<div class="lp-actions">${ui.link("Read leaflet", { href: publishedLeafletHref(leafId, l.id), className: "pub-link" })}</div>`;

  const source = l.provenance?.source;
  const kind = source === "git" ? "git" : source?.startsWith("photosynthesis:") ? "photosynthesis" : "other";
  const observedAt = l.provenance?.observedAt ?? "";
  const style = portfolioStyle(authored?.presentation, l.id);
  const baseStyle = portfolioStyle(authored?.presentation, l.id);
  const collectionIds = publicCollectionIds(authored, l.id, "leaflets");
  const collectionStyles = Object.fromEntries(collectionIds.map(id => [id, portfolioStyle(authored?.presentation, l.id, id)]));
  return `<li class="pub-leaflet lp-record" data-leaflet="${esc(l.id)}" data-tier="${esc(l.tier)}" data-published-content="${titleOnly ? "title-only" : "context"}" id="portfolio-record-${esc(l.id)}" data-record-id="${esc(l.id)}" data-collection-ids="${esc(JSON.stringify(collectionIds))}" data-base-style="${esc(JSON.stringify(baseStyle))}" data-collection-styles="${esc(JSON.stringify(collectionStyles))}" data-reading-typography="${style.typography}" data-reading-spacing="${style.spacing}" data-reading-palette="${style.palette}" data-reading-layout="${style.layout}" data-reading-hero="${style.hero}" data-reading-media="${style.media}" data-document-index="${index}" data-featured-order="-1" data-leading="false" data-source-kind="${kind}" data-date="${esc(observedAt)}" data-date-kind="${observedAt ? "observed" : "undated"}" data-portfolio-side="${index % 2 ? "right" : "left"}"${
    l.titleRedacted ? ' data-title-redacted="true"' : ""
  }>
<div class="lp-panel" data-portfolio-panel>
${title}
${media}
<div class="lp-record-meta"><span class="lp-source">${esc(kind === "git" ? "Git" : kind === "photosynthesis" ? "Photosynthesis" : source ?? "Source not recorded")}</span>
<span class="lp-date">${observedAt ? `<span>Observed</span> <time class="fol-metric" datetime="${esc(observedAt)}">${esc(publicationDate(observedAt))}</time>` : '<span>No observed date</span>'}</span></div>
${narrative}
${titleOnly ? detailLink : ""}
<details class="pub-evidence"${detail ? " open" : ""} data-portfolio-evidence><summary><span>Evidence</span><span class="pub-tier">${proofBadge(l.tier)}</span></summary>
${provenance}
${renderPublicCitationReceipts(authored, l.id)}
</details>
${titleOnly ? "" : detailLink}
</div>
</li>`;
}

/** The machine-readable instant remains in datetime; the first reading is a calendar date. */
function publicationDate(instant: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(instant));
}

/** Only admitted rows reach the shared renderer; presentation never resolves private records. */
function portfolio(document: PublishedLeafDocument, enhanced: boolean, photoUrl?: PhotoUrl, videoUrl?: VideoUrl, linkToDetail = true, preview = false): string {
  const leaflets = document.leaf.leaflets, authored = document.leaf.portfolio;
  const baseStyle = portfolioStyle(authored?.presentation);
  const collectionStyles = Object.fromEntries((authored?.collections ?? []).map(item => [item.id, portfolioStyle(authored?.presentation, undefined, item.id)]));
  return `<div class="lp-portfolio${enhanced ? "" : " lp-fallback"}" data-record-count="${leaflets.length}" data-reading-typography="${baseStyle.typography}" data-reading-spacing="${baseStyle.spacing}" data-reading-palette="${baseStyle.palette}" data-reading-layout="${baseStyle.layout}" data-reading-hero="${baseStyle.hero}" data-reading-media="${baseStyle.media}" data-base-style="${esc(JSON.stringify(baseStyle))}" data-collection-styles="${esc(JSON.stringify(collectionStyles))}" data-leaf-portfolio data-date-purpose="observed">
${renderAuthoredHero(document, baseStyle.hero)}
<p class="lp-person-note lp-publication-note">${preview ? "" : `<span>Published <time class="fol-metric" data-fact="publishedAt" datetime="${esc(document.publishedAt)}">${esc(publicationDate(document.publishedAt))}</time></span>`}<span><span class="fol-metric" data-fact="leaflets">${leaflets.length}</span> ${preview ? "selected" : "shared"} ${leaflets.length === 1 ? "Leaflet" : "Leaflets"}</span></p>
${renderAuthoredKeystones(authored)}
${enhanced ? `<details class="lp-view-options"><summary>View options</summary><div class="lp-toolbar">${renderPublicCollections(authored, preview)}<div class="lp-order"><label for="portfolio-order">Order</label><select id="portfolio-order" data-portfolio-order disabled><option value="notable">Portfolio</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select></div><div class="lp-toolbar-actions">${ui.button("Pause motion", { type: "button", "data-portfolio-motion": "true", disabled: true })}</div></div><ul class="lp-source-legend" aria-label="Sources"><li data-source-kind="git"><span aria-hidden="true"></span>Git</li><li data-source-kind="photosynthesis"><span aria-hidden="true"></span>Photosynthesis</li><li data-source-kind="other"><span aria-hidden="true"></span>Other source</li></ul></details>` : ""}
${renderPublicCollectionFallback(authored, !enhanced)}
${enhanced ? `<div class="lp-caption"><p data-portfolio-order-note data-date-note="By observed date"></p><p data-portfolio-status role="status"></p></div>` : ""}
${renderPublicAchievements(authored)}
<p data-portfolio-collection-empty hidden>No timeline records.</p>
<div id="portfolio-timeline" class="lp-journey" data-portfolio-journey>${enhanced ? `<div class="lp-visual"><canvas data-portfolio-canvas tabindex="0" aria-label="Leaf of ${preview ? "selected" : "shared"} work"></canvas></div>` : ""}
<ul class="lp-records" data-portfolio-records>${leaflets.map((l, index) => leafletCell(l, index, document.leaf.id, authored, photoUrl, videoUrl, false, linkToDetail)).join("\n")}</ul></div></div>`;
}

/** One admitted item from the current publication. A missing item reveals no private Leaf data. */
export function renderPublishedLeafletPage(document: PublishedLeafDocument, leafletId: string, photoUrl?: PhotoUrl, videoUrl?: VideoUrl): string | null {
  const leaflet = document.leaf.leaflets.find((item) => item.id === leafletId);
  if (leaflet === undefined) return null;
  const back = publishedUrl(document.leaf.id);
  return page({
    title: `Shared work by ${document.leaf.subject} — Foliage`,
    state: "leaflet",
    portfolio: true,
    body: `<nav class="pub-leaflet-back" aria-label="Portfolio">${ui.link(document.leaf.subject, { href: back, className: "pub-link" })}</nav>
<section class="pub-work pub-leaflet-detail" aria-label="Shared work">
<ul class="lp-records">${leafletCell(leaflet, 0, document.leaf.id, document.leaf.portfolio, photoUrl, videoUrl, true)}</ul>
<p class="aside" data-standing="outward">${esc(TIER_STANDING[leaflet.tier].fact)}</p>
</section>
<details class="pub-publication-detail"><summary>Publication</summary>
<p><span class="fol-label">Published</span> <time class="fol-metric" datetime="${esc(document.publishedAt)}">${esc(publicationDate(document.publishedAt))}</time></p>
</details>`,
  });
}

export function renderPublishedLeafletNotFound(): string {
  return page({
    title: "Nothing published at this address — Foliage",
    state: "absent",
    body: `<section class="pub-fail" aria-labelledby="pub-fail-h"><h1 id="pub-fail-h">Nothing published at this address</h1></section>`,
  });
}

/**
 * What did not cross, as the artifact stated it.
 *
 * ENTRIES, NOT LEAFLETS, and the wording says so every time. The unit matters: 60 entries can be
 * 60 whole leaflets, or 59 leaflets and one address removed from a title that is on this page. A
 * reader who takes it as "60 missing leaflets" has been told something the artifact never said.
 */
function withheldSection(document: PublishedLeafDocument): string {
  const w = document.withheld;
  if (w.count === 0) {
    return `<section class="pub-withheld" data-withheld="0" aria-labelledby="pub-withheld-h">
<h2 id="pub-withheld-h" class="fol-label">Nothing was withheld from this page</h2>
</section>`;
  }

  const rows = w.kinds
    .map(
      (k) => `<li class="pub-withheld-row" data-withheld-kind="${esc(k.kind)}">
<span class="fol-metric">${k.count}</span>
<span>${esc(KIND_LABEL[k.kind])}</span>
</li>`,
    )
    .join("\n");

  return `<section class="pub-withheld" data-withheld="present" aria-labelledby="pub-withheld-h">
<h2 id="pub-withheld-h">This is not the whole leaf</h2>
<p>${w.count} ${w.count === 1 ? "entry" : "entries"} in the publication review withheld — not a count of missing work.</p>
<ul class="pub-withheld-list">
${rows}
</ul>
</section>`;
}

function publishedLeaf(document: PublishedLeafDocument, source: PublishedSourceFile, options: PublishedRenderOptions): string {
  const { enhancePortfolio = false, photoUrl, videoUrl, preview } = options;
  const linkToDetail = preview === undefined && options.linkToDetail !== false;
  const leaflets = document.leaf.leaflets;
  const allWorkPrivate = leaflets.length === 0 && document.withheld.count > 0
    && document.withheld.kinds.every((entry) => entry.kind === "not-shared");

  const subjectNote = document.leaf.subjectRedacted
    ? `<p class="pub-note" data-subject-redacted="true">Name partly withheld.</p>`
    : "";

  const work =
    leaflets.length === 0
      ? /*
         * THIS COPY NAMED ONE CAUSE AND THE GATE HAS THREE — F-030, the F-028 shape on the
         * frozen-artifact path. It read "A leaflet crosses to a public page only when authorship
         * was cryptographically established … Nothing in this leaf met that", which is true only
         * of `unproven-leaflet`. `publish.ts` also withholds `unattributed-leaflet` — work whose
         * authorship IS cryptographically established, to somebody ELSE — and
         * `unpublishable-provenance`, which is about material in the evidence and has nothing to
         * do with authorship at all. A subject whose offered work was excluded, or whose evidence
         * carried something unpublishable, was told a specific false reason on a public page.
         *
         * IT NAMES THE POSSIBILITIES AND CLAIMS NOTHING ABOUT WHAT THIS PAGE DISCLOSES. The first
         * version of this fix ended "This page does not say which applied here" — which was FALSE
         * on this very page, and false in the same way the sentence it replaced was. `publishedLeaf`
         * renders `${work}${withheldSection(document)}` unconditionally, and `withheldSection`
         * prints `KIND_LABEL` per kind WITH ITS COUNT directly below: "a leaflet that could not be
         * attributed to this person", "a leaflet whose provenance itself carried an identifier".
         * So the page does say which, deliberately and carefully — that is the design, not a leak —
         * and a paragraph asserting silence contradicted the section beneath it.
         *
         * The rule that survives both rounds: state what is true of the whole page, and never make
         * a claim ABOUT the page that another section can falsify. Unlike `renderPublic.ts`'s
         * plate — where the projection genuinely does not carry the cause — this artifact does
         * carry `withheld.kinds`, so the two surfaces are honest in different ways and must not
         * borrow each other's sentences.
         *
         * THE GATE HAD FOUR CAUSES FOR A WHILE, THEN WENT BACK TO THREE. `publish.ts` gained
         * `not-shared` — a leaflet the subject never offered outward at all, at any proof
         * strength — which made four. Then the owner decision recorded at
         * `.loop/MERGE-DECISIONS.md` row D1 (2026-09-06) removed the tier gate itself: `pending`
         * now crosses beside `verified`, with its tier printed on every row below, so
         * `unproven-leaflet` — "attributable, and nothing proves it" — can no longer be a reason a
         * WHOLE leaflet failed to cross. The subject may never have offered it (`not-shared`),
         * it was somebody else's (`unattributed-leaflet`), or its evidence itself carried
         * something unpublishable (`unpublishable-provenance`). The publication policy also
         * withholds whole leaflets (`policy-denied`). The rule above still holds:
         * the paragraph below names every cause and claims nothing about which one applied here.
         */
        `<section class="pub-empty" data-published-empty="true" aria-labelledby="pub-empty-h">
<h2 id="pub-empty-h">${preview ? document.withheld.count === 0 ? "No work selected" : "No work in this preview" : allWorkPrivate ? "No work shared" : "Nothing here can be published as a claim"}</h2>
${
          /*
           * AND IT BRANCHES ON THE WITHHELD COUNT, because the two cases are different facts and
           * the round-four copy stated the wrong one for half of them. `withheldSection` below
           * branches the same way: at `count === 0` it says "Nothing was withheld from this page".
           * A single paragraph reading "Work is held back … for more than one reason" therefore
           * contradicted the section beneath it whenever a document carried no withholdings.
           *
           * The subtler half, and the reason this is not just a wording tidy: at `count === 0`
           * with no leaflets, the review withheld NOTHING and nothing crossed, so the leaf itself
           * carried nothing at review time — which makes "It is not an empty portfolio" FALSE.
           * The anti-inference that is right for a leaf whose work was held back is a lie about a
           * leaf that had no work yet, so it may not be said in both branches.
           */
          allWorkPrivate
            ? ""
            : document.withheld.count === 0
            ? `<p>Nothing to publish</p>`
            : `<p>Possible reasons: not offered, someone else's, unpublishable evidence, or the
person's publication rules. It is not an empty portfolio, and it is not a failure.</p>`
        }
</section>`
      : `<section class="pub-work" id="work" aria-label="${preview ? "Selected" : "Shared"} work">
${portfolio(document, enhancePortfolio, photoUrl, videoUrl, linkToDetail, preview !== undefined)}
<div class="pub-attribution-guide">${tierStanding(leaflets)}</div>
</section>`;

  return page({
    title: `${preview ? "Private preview · " : ""}${document.leaf.subject} — Foliage`,
    state: leaflets.length === 0 ? "empty" : "ok",
    portfolio: leaflets.length > 0 || document.leaf.portfolio !== undefined,
    enhancePortfolio: enhancePortfolio && leaflets.length > 0,
    body: `${leaflets.length ? subjectNote : document.leaf.portfolio ? renderAuthoredHero(document) + subjectNote : `<section class="pub-subject">
<div class="pub-subject-copy">
<span class="fol-label">${preview ? "Private preview" : "Published leaf"}</span>
<h1>${esc(document.leaf.subject)}</h1>
${subjectNote}
${leaflets.length ? '<a class="pub-explore" href="#work">Work</a>' : ""}
</div>
<figure class="pub-specimen"><img src="/specimen-sheet-day.jpg" width="2368" height="1792" alt="A pressed compound frond on a pale specimen sheet" decoding="async"><figcaption>Foliage specimen artwork</figcaption></figure>
<div class="pub-facts">
${preview ? "" : `<span class="pub-fact"><span class="fol-label">Published</span>
<time class="fol-metric" data-fact="publishedAt" datetime="${esc(document.publishedAt)}" title="${esc(document.publishedAt)}">${esc(publicationDate(document.publishedAt))}</time></span>`}
<span class="pub-fact"><span class="fol-label">${preview ? "Selected" : "Shared"} Leaflets</span>
<span class="fol-metric" data-fact="leaflets">${leaflets.length}</span></span>
</div>
</section>`}
${work}
${previewDecision(preview)}
<details class="pub-publication-detail"><summary>${preview ? "Review details" : "Publication"}</summary>
${withheldSection(document)}
${preview?.kind === "hosted" ? `<details class="pub-preview-payload"><summary>Every shared field</summary><pre class="fol-metric">${esc(preview.document)}</pre></details>` : ""}
<footer class="pub-source" id="portfolio-source" tabindex="-1">
<p><span class="fol-label">Source document</span>
<span class="fol-metric" data-fact="digest">${esc(document.source.documentDigest)}</span>
<span class="fol-metric" data-fact="documentBytes">${document.source.documentBytes} bytes</span></p>
<p><span class="fol-label">Artifact</span>
<span class="fol-metric">${esc(document.artifact)} v${document.artifactVersion}</span>
<time class="fol-metric" datetime="${esc(source.readAt)}">read ${esc(source.readAt)}</time></p>
</footer>
</details>`,
    ...(preview ? { preview } : {}),
  });
}

/** The heading for each cause. Seven causes, seven headings, no shared fallback. */
const CAUSE_HEADING: Readonly<Record<PublishedLoadCause, string>> = Object.freeze({
  unconfigured: "Publication store not configured",
  "unpublishable-id": "Invalid address",
  absent: "Nothing published here",
  unreadable: "Unreadable publication",
  malformed: "Publication file is not valid JSON",
  invalid: "Not a published leaf",
  misfiled: "Publication address mismatch",
});

/**
 * A load failure, rendered as a page.
 *
 * PATH-FREE BY CONSTRUCTION: this function is not given the loader's `detail`, so there is no
 * route by which a filesystem path could reach the markup even if a future editor reached for one.
 * The server writes the full detail, paths and all, to its log. Each page is a heading, the id,
 * and the one fix — no explanation (owner, 2026-09-27).
 */
function renderFailure(load: Extract<PublishedLoad, { ok: false }>): string {
  const shell = (lead: string, next = "") =>
    page({
      title: `${CAUSE_HEADING[load.cause]} — Foliage`,
      state: load.cause,
      body: `<section class="pub-fail" aria-labelledby="pub-fail-h">
<h1 id="pub-fail-h">${esc(CAUSE_HEADING[load.cause])}</h1>
<p>${lead}</p>
${next ? `<p class="pub-note">${next}</p>\n` : ""}</section>`,
    });
  const id = `<span class="fol-metric">${esc(load.id)}</span>`;

  switch (load.cause) {
    case "unconfigured":
      return shell(id, `Set <span class="fol-metric">${esc(PUBLISHED_ENV)}</span> to the publish directory and restart.`);

    case "unpublishable-id":
      return shell(id, "Check the address.");

    case "absent":
      return shell(id);

    case "unreadable":
      return shell(id, "Check the canopy store's permissions.");

    case "malformed":
      return shell(id, "Re-run the publish command.");

    case "invalid": {
      // A REFUSED VERSION IS NOT A CORRUPT FILE: a file whose ONLY problem is its
      // `artifactVersion` was made in a format this canopy does not read, and the remedy is
      // republish, not repair. Restricted to the version being the SOLE issue, as
      // `publishedLeaf.ts` restricts its own detail message.
      const versionIssue =
        load.issues.length === 1 && load.issues[0]?.at === "artifactVersion"
          ? load.issues[0]
          : undefined;
      if (versionIssue !== undefined) {
        return shell(`${id} · unsupported format version`, "Republish this leaf.");
      }
      return shell(
        `${id} · ${load.issues.length} problem${load.issues.length === 1 ? "" : "s"}, listed in the server log`,
        "Republish this leaf.",
      );
    }

    case "misfiled":
      // The filing mismatch belongs in the server log. Naming the artifact's subject or
      // declared id here would confirm another person's publication to a public caller.
      return shell(id);

    default: {
      const impossible: never = load;
      throw new Error(`unhandled published load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/** The one entry point. Static exports omit links to detail routes they cannot write. */
export function renderPublishedPage(load: PublishedLoad, options: PublishedRenderOptions = {}): string {
  return load.ok ? publishedLeaf(load.document, load.source, options) : renderFailure(load);
}

/** Match only renderer-owned markup. All publication text is escaped before it reaches HTML. */
export function hasPortfolioEnhancement(html: string): boolean {
  return html.includes('<script type="module" src="/portfolio-leaf.bundle.js"></script>');
}
