/** Contextual entry points only. Opening either preview never starts an assessment. */
import type { Leaflet } from "@foliage/leaf";
import { ui } from "@foliage/ui";
import { esc } from "./render.ts";
import type { CompanionStatus } from "./sourceCatalog.ts";

export interface LeafletAssistanceOptions {
  readonly localModelConfigured?: boolean;
  readonly ladybug?: CompanionStatus;
}
export function renderLeafletAssistance(record: Leaflet, options: LeafletAssistanceOptions = {}): string {
  const eligible = record.tier === "pending" && (!record.visibility || record.visibility === "private");
  const local = options.localModelConfigured === undefined ? "Local model not checked" : options.localModelConfigured ? "Local model configured" : "No local model";
  const cloud = options.ladybug ? options.ladybug.detail : "Connection not checked";
  return `<section class="cx-assistance" id="cx-assistance" aria-label="Assistance for this Leaflet">
    <h3>Assistance</h3>
    <div class="cx-assistant"><h4>Photosynthesis <span>On this device</span></h4><p>${local}</p>
    ${ui.link("Inspect evidence", { href: `/scarlet/workspace?leaflet=${encodeURIComponent(record.id)}` })}</div>
    <div class="cx-assistant"><h4>Scarlet <span>Cloud assessment</span></h4><p>${esc(cloud)}</p>
    ${eligible ? `${ui.link("Review with Scarlet", { href: `/leaf/review-export?leaflet=${encodeURIComponent(record.id)}` })}` : "<p>Pending, private Leaflets only</p>"}
    <p>${ui.link("Scarlet connection", { href: "/workflow#sources" })}</p></div></section>`;
}
