import { manageHeader } from "./renderManage.ts";
import { ui } from "@foliage/ui";
import type { LocalHostedView } from "./localHostedBridge.ts";
import type { ManageState } from "./manageState.ts";
import { esc } from "./renderPublished.ts";

const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const button = (label: string, prominent = false) => ui.button(label, { type: "submit", variant: prominent ? "default" : "outline", className: prominent ? "manage-primary" : undefined });
const link = (url: string, label: string) => `<a class="link" href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>`;

/** Native unchecked controls bind body positions to the source digest in the enclosing form. */
function narrativeChoices(local: Extract<ManageState, { kind: "ready" }>): string {
  const offered = new Set(local.preview.leaf.leaflets.map(l => l.id));
  const rows = local.leaf.leaflets.flatMap((leaflet, li) => {
    if (!offered.has(leaflet.id)) return [];
    const choices = (leaflet.body ?? []).flatMap((element, bi) => {
      if ("media" in element || !element.text?.trim()) return [];
      const id = `narrative-${li}-${bi}`;
      return [`<label class="hosted-paragraph" for="${id}"><input type="checkbox" id="${id}" name="${id}"><span><span class="hosted-paragraph-text">${esc(element.text)}</span><small>Reference: <span class="num">${esc(element.provenance.source)} · ${esc(element.provenance.ref)}</span></small></span></label>`];
    });
    return choices.length ? [`<fieldset class="hosted-narrative"><legend>${esc(leaflet.title)}</legend>${choices.join("")}</fieldset>`] : [];
  });
  return `<section aria-labelledby="narrative-h"><h3 id="narrative-h">Story</h3>${rows.length ? rows.join("") : '<p>No paragraphs</p>'}</section>`;
}

function mediaChoices(local: Extract<ManageState, { kind: "ready" }>): string {
  const choices = local.photoChoices ?? [];
  const videos = local.videoChoices ?? [];
  if (!choices.length && !videos.length) return '<div class="hosted-photo-choices"><p>No media</p></div>';
  const paired = new Set(videos.filter(choice => choice.video && choices.some(photo => photo.photo?.sourceRef === choice.video?.posterRef)).map(choice => `${choice.leaflet}-${choice.element}`));
  return `<div class="hosted-photo-choices">${choices.map(choice => {
    const id = `${choice.leaflet}-${choice.element}`, photo = choice.photo;
    if (!photo) return `<div class="cell hosted-photo-choice"><strong>${esc(choice.title)}</strong><p role="status">${esc(choice.issue ?? "Unavailable")}</p></div>`;
    const poster = `/hosted/photo/${photo.sourceRef.slice(7)}/${photo.renditionDigest.slice(7)}`;
    const demos = videos.filter(item => item.video?.posterRef === photo.sourceRef);
    const preview = demos.length ? "" : `<img src="${esc(poster)}" alt="Private preview" loading="lazy">`;
    const demoControls = demos.map(item => {
      const demo = item.video!, demoId = `${item.leaflet}-${item.element}`;
      return `<div class="hosted-video-choice"><video controls playsinline preload="none" poster="${esc(poster)}" aria-label="Preview demo of ${esc(item.title)}"><source src="/hosted/video/${esc(demo.sourceRef.slice(7))}" type="video/mp4">Video playback unavailable.</video><label><input type="checkbox" name="video-select-${demoId}"> Share demo with this image</label>${hidden(`video-digest-${demoId}`, demo.sourceRef)}${item.caption ? `<label><input type="checkbox" name="video-caption-${demoId}"> Share caption: ${esc(item.caption)}</label>` : ""}<span class="num">${esc(String(demo.durationSeconds))} s</span></div>`;
    }).join("");
    return `<fieldset class="cell hosted-photo-choice"><legend>${esc(choice.title)}</legend>${preview}${demoControls}<label><input type="checkbox" name="photo-select-${id}"> Share image</label>${hidden(`photo-digest-${id}`, photo.renditionDigest)}<label for="photo-alt-${id}">Alt text</label><textarea class="field" id="photo-alt-${id}" name="photo-alt-${id}" maxlength="1000" rows="2"></textarea>${choice.caption ? `<label><input type="checkbox" name="photo-caption-${id}"> Share caption: ${esc(choice.caption)}</label>` : ""}<details class="hosted-media-details"><summary>File details</summary><p class="num">${photo.bytes.toLocaleString("en-US")} bytes · ${esc(photo.format.toUpperCase())}</p></details></fieldset>`;
  }).join("")}${videos.filter(choice => !paired.has(`${choice.leaflet}-${choice.element}`)).map(choice => `<div class="cell hosted-photo-choice"><strong>${esc(choice.title)}</strong><p role="status">${esc(choice.issue ?? "Demo needs its selected image")}</p></div>`).join("")}</div>`;
}

export function renderHostedBridge(view: LocalHostedView | null, local: ManageState, csrf: string, message?: string, studioOrigin?: string): string {
  const form = (action: string, body: string) => `<form method="post" action="/hosted/${action}">${hidden("csrf", csrf)}${body}</form>`;
  const confirm = (id: string) => hidden("confirm", id);
  const p = view?.prepared, operation = view?.operation, remote = view?.remote;
  const pending = operation?.status === "unconfirmed";
  const localReady = local.kind === "ready";
  const currentDoc = remote?.document as { source?: { documentDigest?: string; policyDigest?: string } } | null;
  const changed = remote?.current.visible && localReady && (currentDoc?.source?.documentDigest !== local.sourceDigest || currentDoc?.source?.policyDigest !== local.policyDigest);
  const connection = !view ? '<section class="hosted-panel hosted-connection"><h2>Hosting not configured</h2></section>' : `<section class="hosted-panel hosted-connection"><h2>${view.connected ? "Connected" : "Connect Photosynthesis"}</h2><p>${esc(view.origin)}</p>${view.connected ? form("disconnect", button("Disconnect")) : form("connect", button("Continue with Google", true))}</section>`;
  const publicState = remote ? `<section class="hosted-panel hosted-public-state"><h2>${remote.current.visible ? changed ? "Local changes" : "Public" : "Not public"}</h2><p class="num">Checked ${esc(remote.observedAt)}</p><p>${link(`${view!.origin}/manage/${remote.current.subjectId}`, "Account")}${remote.current.visible ? " · " + link(`${view!.origin}/leaf/${remote.current.subjectId}`, "Public portfolio") : ""}</p>${view?.connected ? form("refresh", button("Refresh")) : ""}</section>` : "";
  const operationState = operation ? `<section class="hosted-panel hosted-operation"><h2>${operation.result ? "Saved" : pending ? "Outcome unknown" : operation.status === "refused" ? "Refused" : "Prepared"}</h2>${operation.result ? `<p>${operation.result.receipt.kind === "publish" ? "Publication" : "Withdrawal"} saved <time class="num">${esc(operation.result.receipt.committedAt)}</time></p>` : pending ? '<p>Check before retrying.</p>' : ""}<details><summary>Reference</summary><code class="num">${esc(operation.operationId)}</code></details>${view?.connected && operation.status !== "ready" ? form("recover", button("Check")) : ""}</section>` : "";
  const prepare = view?.connected && !pending ? `<section class="hosted-panel hosted-prepare"><h2>Prepare</h2>${localReady && local.preview.leaf.leaflets.length > 0 ? `<details class="hosted-work-list" open><summary><span class="num">${local.preview.leaf.leaflets.length}</span> selected ${local.preview.leaf.leaflets.length === 1 ? "work" : "works"}</summary><ul>${local.preview.leaf.leaflets.map(item => `<li><strong>${esc(item.title)}</strong> <span>${esc(item.tier)}</span></li>`).join("")}</ul></details>${form("prepare", hidden("sourceDigest", local.sourceDigest) + hidden("policyDigest", local.policyDigest) + '<details><summary>Story</summary>' + narrativeChoices(local) + '</details>' + `<details${local.videoChoices?.length ? " open" : ""}><summary>Images and demos</summary>` + mediaChoices(local) + '</details>' + '<label class="hosted-paragraph"><input type="checkbox" name="includePortfolio"><span>Introduction and achievements</span></label>' + button("Preview", !p))}` : localReady ? `<p>Nothing selected</p>${studioOrigin ? link(studioOrigin + "/review", "Choose work") : '<p>Choose work in Photosynthesis</p>'}` : `<p>${esc(local.detail)}</p>`}</section>` : "";
  const publish = view?.connected && p && operation?.kind === "publish" && !pending && operation.status !== "confirmed" ? `<section class="hosted-panel hosted-publish"><h2>${p.current.visible ? "Replace" : "Publish"}</h2>${p.current.visible ? "<p>Replaces the public version in full.</p>" : ""}<p><a class="link" href="/hosted/preview">Preview</a></p><details><summary>Every shared field</summary><pre class="num">${esc(JSON.stringify(p.document, null, 2))}</pre></details>${form("publish", hidden("operationId", p.consent.operationId) + confirm(p.consent.subjectId) + button(p.current.visible ? "Publish changes" : "Publish", true))}</section>` : "";
  const retry = view?.connected && pending && operation?.kind === "publish" && p ? `<section class="hosted-panel hosted-publish"><h2>Retry publication</h2>${form("publish", hidden("operationId", operation.operationId) + confirm(operation.subjectId) + button("Check and retry", true))}</section>` : view?.connected && pending && operation?.kind === "withdraw" ? `<section class="hosted-panel hosted-publish"><h2>Retry withdrawal</h2>${form("withdraw", hidden("operationId", operation.operationId) + confirm(operation.subjectId) + button("Check and retry", true))}</section>` : "";
  const withdraw = view?.connected && remote?.current.visible && !pending ? `<section class="hosted-panel hosted-withdraw"><details><summary>Withdraw</summary><p>Downloaded copies can’t be recalled.</p>${form("withdraw", hidden("revisionId", remote.current.revisionId!) + hidden("generation", String(remote.current.generation)) + confirm(remote.current.subjectId) + button("Withdraw"))}</details></section>` : "";
  return `<!doctype html><html lang="en" data-face="night" data-foliage-theme="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live portfolio · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/canopy-base.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/manage.css"><link rel="stylesheet" href="/workspace-shell.css"></head><body class="plane--internal manage hosted-page fol-app"><a class="hosted-skip link" href="#main">Skip to content</a>${manageHeader("hosting")}
<main id="main" class="wrap manage-main fol-app-main"><section class="manage-hero"><div><h1>Live portfolio</h1></div></section>${message ? ui.feedbackNotice(message, {tone:"status",className:"manage-notice"}) : ""}
<div class="hosted-flow"><div class="hosted-flow-main">${view?.connected ? `${prepare}${publish}${retry}` : connection}</div><aside class="hosted-flow-side" aria-label="Hosting status">${publicState}${operationState}${view?.connected ? connection : ""}${withdraw}</aside></div>
</main></body></html>`;
}
