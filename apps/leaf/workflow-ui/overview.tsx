import { Button } from "@foliage/ui/button";
import type { PortfolioPipeline } from "../src/portfolioPipeline.ts";
import { workflowHref } from "../src/workflowNavigation.ts";
import type { openWorkflow } from "../src/workflow.ts";
import { Pipeline } from "./pipeline.tsx";
import { compactDraftTitle } from "../src/reviewDisplay.ts";

type Data = ReturnType<Awaited<ReturnType<typeof openWorkflow>>["snapshot"]> & {
  queue: { open: number | null; next: { id: string; title: string; href: string } | null };
  pipeline: PortfolioPipeline;
};

/** The owner's saved account leads. Collection and public delivery stay secondary. */
export function WorkspaceOverview({ data }: { data: Data }) {
  const record = data.pipeline.record;
  const sourceProblem = data.sources.some(source => source.enabled && source.error);
  const collection = data.running ? "Collecting" : sourceProblem ? "Source needs attention"
    : data.schedule?.paused ? "Paused" : !data.schedule ? "Not scheduled"
      : !data.sources.some(source => source.enabled) ? "No active source" : "Scheduled";
  const workAwaitingReview = !record && data.queue.open !== null && data.queue.open > 0;
  return <div className="workspace-overview">
    <section className="workspace-work" aria-labelledby="workspace-work-title">
      <div className="workspace-section-heading workspace-work-heading">
        <h2 id="workspace-work-title">{workAwaitingReview ? "Work awaiting review" : record ? "In your record" : "Your record"}</h2>
        <div className="workspace-work-actions">
          {data.queue.open !== null && data.queue.open > 0 && <Button asChild className="workspace-review-action">
            <a href="/review">Review {data.queue.open} {data.queue.open === 1 ? "draft" : "drafts"}</a>
          </Button>}
          {record && <a href="/leaf">Open portfolio</a>}
        </div>
      </div>
      {!record && data.queue.next && <div className="workspace-next-draft">
        <span>Next draft</span>
        <a href={data.queue.next.href} title={data.queue.next.title}><h3>{compactDraftTitle(data.queue.next.id, data.queue.next.title)}</h3></a>
      </div>}
      {record && (record.journeys.length > 0 || record.leaflets.length > 0) ? <ol className="workspace-journeys">
        {record.journeys.map(journey => <li key={journey.id}>
          <a className="workspace-journey-link" href={`/leaf/achievement?id=${encodeURIComponent(journey.id)}`}>
            <h3>{journey.title}</h3>
          </a>
        </li>)}
        {record.leaflets.map(leaflet => <li key={leaflet.id}>
          <span className="workspace-record-kind">Leaflet</span>
          <a className="workspace-journey-link" href={`/my/leaflet/${encodeURIComponent(leaflet.id)}`}>
            <h3>{leaflet.title}</h3>
          </a>
        </li>)}
      </ol> : !workAwaitingReview && <div className="workspace-empty">
        <h3>{record ? "No saved work" : data.pipeline.recordStatus === "unavailable" ? "Record unavailable"
          : data.pipeline.recordStatus === "example" ? "Example record" : "No work record"}</h3>
        {data.pipeline.recordStatus === "unavailable" && <p>The saved record could not be read.</p>}
        <Button asChild variant={data.pipeline.recordStatus === "unavailable" || (data.queue.open !== null && data.queue.open > 0) ? "outline" : "default"}>
          <a href={record ? "/leaf/presentation?edit=achievement" : "/leaf"}>
            {record ? "Add a journey" : data.pipeline.recordStatus === "empty" ? "Start your record" : "Open portfolio"}
          </a>
        </Button>
        {data.pipeline.recordStatus === "unavailable" && <details className="app-workflow-details"><summary>Technical details</summary>
          <p className="app-mono">{data.pipeline.technical[0]}</p>
        </details>}
      </div>}
      {record && record.journeys.length === 0 && record.leaflets.length > 0 &&
        <a className="workspace-refine" href="/leaf/photosynthesis?view=records">Browse retained work</a>}
      {record && <p className="workspace-record-meta">
        <span className="app-mono">{record.journeyCount}</span> {record.journeyCount === 1 ? "journey" : "journeys"}
        <span aria-hidden="true"> · </span>
        <span className="app-mono">{record.leafletCount}</span> {record.leafletCount === 1 ? "Leaflet" : "Leaflets"}
      </p>}
      {data.pipeline.unsaved.length > 0 && <details className="app-workflow-details" open>
        <summary>Accepted work to add</summary><Pipeline data={data.pipeline} />
      </details>}
    </section>
    <aside className="workspace-collection" aria-label="Collection">
      <div className="workspace-section-heading"><h2>Collection</h2><a href={workflowHref("Background workflow")}>Manage</a></div>
      <p className="workspace-collection-status">{collection}</p>
      {data.nextAt && data.schedule && !data.schedule.paused && <p className="app-small">
        Next <time className="app-mono" dateTime={data.nextAt}>{new Date(data.nextAt).toLocaleString()}</time>
      </p>}
      <div className="workspace-section-heading workspace-sources-heading">
        <h2>Sources</h2><a href={workflowHref("Sources")}>Manage</a>
      </div>
      {data.sources.length ? <ul className="workspace-sources">{data.sources.map(source => <li key={source.id}>
        <span title={source.path}>{source.path.split(/[\\/]/).filter(Boolean).at(-1) || source.path}</span>
        <span className={source.error ? "app-error" : "app-small"}>{source.error ? "Needs attention" : source.enabled ? "Enabled" : "Paused"}</span>
      </li>)}</ul> : <Button asChild variant="outline"><a href={workflowHref("Sources")}>Connect a source</a></Button>}
    </aside>
  </div>;
}
