/** A readable projection of existing collection/review/hosting state, never a new authority. */
import { createHash } from "node:crypto";
import { esc } from "./render.ts";
import type { PortfolioPipeline } from "./portfolioPipeline.ts";
import type { WorkflowSnapshot } from "./workflow.ts";
import type { readHostedStatus } from "./hostedStatus.ts";

function observedTime(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const label = new Date(value).toLocaleString("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `<time class="fol-metric" datetime="${esc(value)}">${esc(label)} UTC</time>`;
}

/**
 * `openReview` is the one queue's open count, as /review shows it, or null when the harvest could
 * not be read. The workflow keeps no review list of its own.
 */
export function portfolioFreshness(state: WorkflowSnapshot | null, pipeline: PortfolioPipeline | null, unavailable: string, openReview: number | null, hosting?: Awaited<ReturnType<typeof readHostedStatus>>) {
  const sourceErrors = state?.sources.filter(source => source.enabled && source.error) ?? [];
  const scheduled = !!(state?.active && state.schedule && !state.schedule.paused && state.sources.some(source => source.enabled)
    && state.nextAt && Number.isFinite(Date.parse(state.nextAt)));
  const collecting = state?.running ? "Gathering evidence" : !state ? "Collection unavailable" : !state.active ? "Collection offline" : state.schedule?.paused ? "Collection paused" : scheduled ? "Automatic collection scheduled" : "Collection not scheduled";
  const collectionNote = !state ? esc(unavailable) : sourceErrors.length ? `<span class="fol-metric">${sourceErrors.length}</span> source${sourceErrors.length === 1 ? "" : "s"} need attention` : state.active && !state.schedule?.paused && !scheduled ? "Choose a source and schedule" : "";
  const checked = state?.collection?.finishedAt;
  const hosted = pipeline?.hosted.observation ?? hosting?.observation;
  const publication = !hosted ? "Public status not checked" : !hosted.visible ? "Last seen not published" : pipeline?.hosted.localChanged ? "Saved changes are not published" : "Last seen published";
  const publicNote = hosted ? `Checked ${observedTime(hosted.observedAt)}` : esc(pipeline?.hosted.detail ?? hosting?.detail ?? "Hosting not checked");
  const html = `<div class="portfolio-freshness-grid">
    <section data-freshness="collection"><span class="fol-label">Photosynthesis · on this device</span><strong>${collecting}</strong>${collectionNote ? `<p>${collectionNote}</p>` : ""}${checked ? `<p>Last collected ${observedTime(checked)}</p>` : ""}<a href="/workflow#background">Collection settings</a></section>
    <section data-freshness="review"><span class="fol-label">Your review</span><strong>${openReview !== null ? `<span class="fol-metric">${openReview}</span> to review` : "Review unavailable"}</strong><a href="/review">Open review</a></section>
    <section data-freshness="publication"><span class="fol-label">Canopy · public portfolio</span><strong>${publication}</strong><p>${publicNote}</p><a href="/publish">Review publication</a></section>
  </div>`;
  return { html, revision: createHash("sha256").update(html).digest("hex") };
}
