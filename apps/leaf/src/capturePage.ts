/** A local capture is private source material until its still is reviewed. */
import { ui, workspaceHeader } from "@foliage/ui";
import { esc } from "./render.ts";
import { workspaceNavigation } from "./workspaceNavigation.ts";

interface CaptureRecord {
  readonly id: string;
  readonly title?: string | null;
  readonly url: string;
  readonly capturedAt: string;
  readonly durationSeconds: number;
  readonly screenshotHref: string;
  readonly videoHref: string;
  readonly action: { readonly label: string; readonly href: string; readonly primary: boolean } | null;
  readonly rejected: boolean;
}

export interface CaptureView {
  readonly records: readonly CaptureRecord[];
  readonly error?: string;
  readonly captured?: string;
  readonly url?: string;
}

function dateOf(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Captured" : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function captureCard(record: CaptureRecord, lead: boolean): string {
  const source = record.title?.trim() || (() => { try { const parsed = new URL(record.url); return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`; } catch { return "Local page"; } })();
  const video = `<video controls playsinline preload="metadata" poster="${esc(record.screenshotHref)}" aria-label="Demo of ${esc(source)}"><source src="${esc(record.videoHref)}" type="video/mp4">Video playback is unavailable in this browser.</video>`;
  const next = record.action
    ? `<a class="${record.action.primary ? "fol-button fol-button-primary" : "capture-quiet-action"}" href="${esc(record.action.href)}">${esc(record.action.label)}</a>`
    : record.rejected ? `<span class="capture-status">Rejected from record</span>`
    : `<form method="post" action="/leaf/capture"><input type="hidden" name="action" value="queue"><input type="hidden" name="id" value="${esc(record.id)}">${ui.button("Add demo to Review", { type: "submit", variant: "outline" })}</form>`;
  return `<article class="capture-record${lead ? " capture-record-lead" : ""}"><div class="capture-film">${video}</div><div class="capture-record-detail"><h2>${esc(source)}</h2><p><time datetime="${esc(record.capturedAt)}">${esc(dateOf(record.capturedAt))}</time> · <span class="fol-metric">${esc(String(record.durationSeconds))}</span>s · Local copy</p><div class="capture-record-actions">${next}<a href="${esc(record.screenshotHref)}" target="_blank" rel="noopener">Open still</a></div></div></article>`;
}

export function renderCapturePage(view: CaptureView): string {
  const latest = view.records[0];
  const records = view.records.length ? `<section class="capture-records" aria-label="Captured demos">${view.records.map((record, index) => captureCard(record, index === 0)).join("")}</section>` : "";
  const form = `<section class="capture-setup" aria-labelledby="capture-form-title"><h2 id="capture-form-title">Select a local page</h2><form method="post" action="/leaf/capture"><input type="hidden" name="action" value="capture"><label for="capture-url">Local page URL</label>${ui.input({ id: "capture-url", name: "url", type: "url", required: true, maxLength: 2048, placeholder: "http://127.0.0.1:3000", defaultValue: view.url ?? "", autoComplete: "url" })}<label for="capture-seconds">Clip length</label><select id="capture-seconds" name="seconds"><option value="6">6 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option></select>${ui.button("Capture with Foliage", { type: "submit", variant: "default" })}</form><p>Foliage opens this page in a private browser. The still and clip go to Review.</p></section>`;
  const body = `<header class="capture-heading"><div><a href="/leaf/photosynthesis">Work</a><h1>Capture work</h1></div><span>Private</span></header>${view.error ? `<p class="capture-error" role="alert">${esc(view.error)}</p>` : ""}${view.captured ? `<p class="capture-success" role="status">Demo saved · <a href="/review?focus=${encodeURIComponent(view.captured)}">Review demo</a></p>` : ""}${latest ? `<div class="capture-layout">${records}${form}</div>` : `<div class="capture-layout capture-layout-empty">${form}</div>`}`;
  return `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture work · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/workspace-shell.css"><link rel="stylesheet" href="/capture.css"></head><body class="fol-app"><a class="capture-skip" href="#capture-main">Skip to capture</a>${workspaceHeader(workspaceNavigation("work"))}<main id="capture-main" class="fol-app-main" tabindex="-1"><div class="fol-app-content capture-content">${body}</div></main></body></html>`;
}
