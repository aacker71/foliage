import { Button } from "@foliage/ui/button";
import type { PortfolioPipeline } from "../src/portfolioPipeline.ts";
import type { CollectionRun } from "../src/workflow.ts";

export function Pipeline({ data }: { data: PortfolioPipeline }) {
  return <section className="app-panel" aria-labelledby="portfolio-progress">
    <h2 id="portfolio-progress">Portfolio</h2>
    <p><Button variant="outline" asChild><a href="/leaf/explore">Living leaf</a></Button>{" "}
      <Button variant="outline" asChild><a href="/publish">Sharing policy</a></Button></p>
    {data.blockers.map((reason, i) => <p className="app-error" key={i}>{reason}</p>)}
    {data.unsaved.map(p => <p key={p.packetId}><Button variant="outline" asChild><a href={p.href}>Save to Leaf · {p.title}</a></Button></p>)}
    <details><summary>Publication</summary>
    {data.publication && <>
      <p><span className="app-mono">{data.publication.eligible}</span> eligible for public</p>
      <p className="app-small">Withheld: attribution <span className="app-mono">{data.publication.withheld.attribution}</span> ·
        private <span className="app-mono">{data.publication.withheld.private}</span> ·
        policy <span className="app-mono">{data.publication.withheld.policy}</span> · {data.publication.policySource === "default" ? "Default rules" : "Your rules"}</p>
    </>}
    <p>{data.hosted.detail}</p>
    {data.hosted.observation ? <>
      <p>{data.hosted.observation.visible ? "Public" : "Not public"}{data.hosted.localChanged ? " · Changed locally" : ""}</p>
      <p className="app-mono">Checked {new Date(data.hosted.observation.observedAt).toLocaleString()}</p>
      <p><a href={`${data.hosted.observation.origin}/manage/${encodeURIComponent(data.hosted.observation.subjectId)}`} target="_blank" rel="noreferrer">Manage ↗</a>{data.hosted.observation.visible && <> · <a href={`${data.hosted.observation.origin}/leaf/${encodeURIComponent(data.hosted.observation.subjectId)}`} target="_blank" rel="noreferrer">Public page ↗</a></>}</p>
    </> : null}
    </details>
    <p className="app-small app-mono">Read at {new Date(data.observedAt).toLocaleString()}</p>
  </section>;
}

export function CollectionTrace({ run }: { run: CollectionRun }) {
  return <details><summary>Trace · {run.trigger}</summary>
    <p className="app-mono">Run: {run.id}</p>
    <p className="app-mono">Started: {new Date(run.startedAt).toLocaleString()}</p>
    <p className="app-mono">Finished: {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "not recorded"}</p>
    {run.sources.map(source => <div key={source.id}>
      <p className="app-mono">Source: {source.id}</p><p>{source.status}</p>
      {source.from && <p className="app-mono">Previous commit: {source.from}</p>}
      {source.head && <p className="app-mono">Read commit: {source.head}</p>}
      {source.error && <p className="app-error">{source.error}</p>}
      {source.packets.map(id => <p key={id}><a href={`/review#candidate-${encodeURIComponent(id)}`}>{id}</a></p>)}
    </div>)}
  </details>;
}
