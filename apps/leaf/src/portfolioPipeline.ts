/** Read-only local pipeline. Eligibility is never a claim of hosted delivery. Collected work is
 * reviewed in the one queue at /review, so this pipeline lists no drafts of its own — only the
 * legacy packets accepted before it and never saved to the Leaf, which nothing else drafts again. */
import { isSubjectsOwnWork, isListedOnLeaf, leafletVisibility } from "@foliage/leaf";
import type { LeafLoad } from "./leafDocument.ts";
import { POLICY_UNAVAILABLE, leafLoadProblem } from "./loadLabels.ts";
import { outwardStateOf } from "./policy.ts";
import type { PolicyLoad } from "./policyDocument.ts";
import type { readHostedStatus } from "./hostedStatus.ts";
import type { WorkflowSnapshot } from "./workflow.ts";

type LegacyPacket = Pick<WorkflowSnapshot["proposals"][number], "id" | "title" | "status">;

/** Accepted legacy packets with no Leaflet yet, each with its way to the Leaf. Unknown while the Leaf is unread. */
const unsavedPackets = (load: LeafLoad, proposals: readonly LegacyPacket[]) =>
  load.ok
    ? proposals
        .filter((p) => p.status === "accepted" && !load.leaf.leaflets.some((l) => String(l.id) === `workflow:${p.id}`))
        .map((p) => ({ packetId: p.id, title: p.title, href: `/workflow/leaflet?packet=${encodeURIComponent(p.id)}` }))
    : [];

export function portfolioPipeline(load: LeafLoad, policy: PolicyLoad, hosted?: Awaited<ReturnType<typeof readHostedStatus>>, proposals: readonly LegacyPacket[] = []) {
  // `blockers` are shown as the Portfolio panel's visible lines: the named problem, never the
  // loader's path or parser text. Those wait in `technical`, for a closed Technical details.
  const blockers: string[] = [];
  const technical: string[] = [];
  if (!load.ok) { blockers.push(leafLoadProblem(load)); technical.push(load.detail); }
  if (!policy.ok) { blockers.push(POLICY_UNAVAILABLE); technical.push(policy.detail); }
  const recordStatus = load.ok
    ? load.source.declaredExample || load.source.bundledExample ? "example" : "ready"
    : load.cause === "unconfigured" || load.cause === "absent" ? "empty" : "unavailable";
  // The private work record is useful even when sharing policy or hosting is unavailable.
  // Bundled and declared examples are never presented as the owner's saved work.
  const record = load.ok && recordStatus === "ready"
    ? (() => {
      // Sources is an operations surface. One retained account keeps the work in view
      // without replaying the full Work and Portfolio lists beside collection controls.
      const achievements = (load.leaf.achievements ?? []).slice(0, 1);
      const cited = new Set(achievements.flatMap(achievement => achievement.claims.flatMap(claim =>
        (claim.citations ?? []).map(citation => citation.leaflet))));
      return { journeys: achievements.map((achievement) => ({
        id: achievement.id,
        title: achievement.title,
      })),
      leaflets: load.leaf.leaflets.filter(leaflet => isSubjectsOwnWork(leaflet) && !cited.has(leaflet.id))
        .slice(0, 1 - achievements.length).map(leaflet => ({ id: leaflet.id, title: leaflet.title })),
      journeyCount: load.leaf.achievements?.length ?? 0,
      leafletCount: load.leaf.leaflets.length };
    })()
    : null;
  const publication = load.ok && policy.ok ? (() => {
    let eligible = 0;
    const withheld = { attribution: 0, private: 0, policy: 0 };
    for (const l of load.leaf.leaflets) {
      const proof = !isSubjectsOwnWork(l);
      const privateWork = !isListedOnLeaf(leafletVisibility(l));
      const denied = outwardStateOf(policy.policy, l).kind === "withheld-by-rule";
      if (proof) withheld.attribution++;
      if (privateWork) withheld.private++;
      if (denied) withheld.policy++;
      if (!proof && !privateWork && !denied) eligible++;
    }
    if (load.source.declaredExample || load.source.bundledExample) {
      blockers.push("Example document · not publishable");
      return null;
    }
    return { eligible, withheld, policySource: policy.source.kind };
  })() : null;
  return { observedAt: new Date().toISOString(), documentRevision: load.ok ? load.source.documentDigest : null,
    blockers, technical, publication, record, recordStatus, unsaved: unsavedPackets(load, proposals),
    hosted: { status: hosted?.observation ? "observed" : "not-connected", observation: hosted?.observation ?? null,
      lastPublishedRevision: hosted?.observation?.revisionId ?? null,
      localChanged: !!(hosted?.observation?.visible && load.ok && policy.ok && (hosted.observation.documentDigest !== load.source.documentDigest || hosted.observation.policyDigest !== policy.policyDigest)),
      detail: hosted?.detail ?? "Hosting not checked" } };
}
export type PortfolioPipeline = ReturnType<typeof portfolioPipeline>;
