import { ui } from "@foliage/ui";

import type { ModelDiscovery, SavedModel } from "./scarletModelSetup.ts";
import { disclosure, esc, page } from "./render.ts";

export const SCARLET_SETUP_ROUTE = "/scarlet/setup";
/** Where a person without a running Ollama learns to install and start it. A link, never a request. */
export const OLLAMA_SETUP_HREF = "https://docs.ollama.com/quickstart";

export interface ScarletSetupView {
  readonly saved: SavedModel;
  readonly environmentModel: string | null;
  readonly gardenSelected: boolean;
  readonly discovery: ModelDiscovery | null;
  readonly notice?: "saved" | "not-installed" | "save-failed" | "invalid-request";
  readonly detail?: string;
}

function status(view: ScarletSetupView): string {
  if (view.environmentModel !== null) return `<div class="scarlet-setup-status" data-model-state="external">
<span class="fol-label">Current model</span><strong>${esc(view.environmentModel)}</strong><span class="fol-label">Managed by this session</span></div>`;
  if (view.saved.kind === "selected") return `<div class="scarlet-setup-status" data-model-state="selected">
<span class="fol-label">Current model</span><strong>${esc(view.saved.name)}</strong></div>`;
  if (view.saved.kind === "unavailable") return `<div class="scarlet-setup-status" data-model-state="unavailable">
<span class="fol-label">Local model</span><strong>Settings unavailable</strong></div>`;
  return `<div class="scarlet-setup-status" data-model-state="none">
<span class="fol-label">Local model</span><strong>No model selected</strong></div>`;
}

function discoveryResult(view: ScarletSetupView): string {
  if (view.discovery === null) return "";
  if (!view.discovery.ok) {
    const label = view.discovery.cause === "connection" ? "Local connection blocked" :
      view.discovery.cause === "runtime" ? "Ollama unavailable" : "Model list unavailable";
    return `<section class="scarlet-setup-result" role="status" data-discovery="${view.discovery.cause}">
<h2>${label}</h2>${view.discovery.cause === "runtime" ? ui.link("Get Ollama", { href: OLLAMA_SETUP_HREF }) : ""}
${disclosure("model-connection", "Technical details", `<p>${esc(view.discovery.detail)}</p>`)}</section>`;
  }
  if (view.discovery.names.length === 0) return `<section class="scarlet-setup-result" role="status" data-discovery="empty">
<h2>No installed models</h2>${ui.link("Get Ollama", { href: OLLAMA_SETUP_HREF })}</section>`;
  return `<section class="scarlet-setup-result" aria-labelledby="installed-models-h" data-discovery="found">
<div class="scarlet-setup-heading"><h2 id="installed-models-h">Installed models</h2><span class="fol-metric">${view.discovery.names.length}</span></div>
<ul class="scarlet-model-list">${view.discovery.names.map((name) => `<li><span>${esc(name)}</span>
<form method="post" action="${SCARLET_SETUP_ROUTE}"><input type="hidden" name="action" value="select"><input type="hidden" name="model" value="${esc(name)}">
${ui.button("Use", { type: "submit", variant: "secondary", "aria-label": `Use ${name}` })}</form></li>`).join("")}</ul></section>`;
}

export function renderScarletSetup(view: ScarletSetupView): string {
  const canChoose = view.environmentModel === null && view.gardenSelected;
  const notice = view.notice === "saved" ? "Saved" : view.notice === "not-installed" ? "Model not installed" :
    view.notice === "save-failed" ? "Could not save" : view.notice === "invalid-request" ? "Try again" : null;
  const error = view.saved.kind === "unavailable" ? view.saved.detail : view.detail;
  const discoveryForm = `<form method="post" action="${SCARLET_SETUP_ROUTE}" class="scarlet-setup-find"><input type="hidden" name="action" value="discover">
${ui.button(view.discovery === null ? "Find installed models" : "Refresh models", { type: "submit", variant: view.discovery === null ? "default" : "ghost" })}</form>`;
  const body = `<div class="scarlet-setup assistant-page">
<header class="scarlet-setup-heading"><h1>Choose a local model</h1><a class="scarlet-setup-back" href="/scarlet">Back to Photosynthesis</a></header>
${status(view)}
${notice === null ? "" : `<p class="scarlet-setup-notice" role="status">${notice}</p>`}
${!view.gardenSelected ? `<section class="scarlet-setup-result"><h2>Garden unavailable</h2>${ui.link("Open portfolio setup", { href: "/leaf/setup" })}</section>` : ""}
${view.environmentModel !== null ? `<p class="scarlet-setup-note">This model was selected when Foliage started.</p>` : ""}
${canChoose ? view.discovery === null ? discoveryForm : `${discoveryResult(view)}${discoveryForm}` : ""}
${error === undefined ? "" : disclosure("model-settings", "Technical details", `<p>${esc(error)}</p>`)}
</div>`;
  return page({ title: "Foliage — local model", surface: "scarlet", nav: "scarlet", face: "night",
    state: view.environmentModel !== null ? "model-external" : view.saved.kind === "selected" ? "model-selected" : "model-needed",
    empty: false, body });
}
