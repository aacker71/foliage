/** Resolves every resource again for a run. Browser-supplied context is never trusted. */
import { createHash } from "node:crypto";
import type { Leaf } from "@foliage/leaf";
import { decisionReason } from "@foliage/leaf";
import type { HarvestLoad } from "./render.ts";
import { POLICY_UNAVAILABLE, harvestLoadProblem } from "./loadLabels.ts";
import type { PolicyLoad } from "./policyDocument.ts";
import { effectivePolicyDigest } from "./policyDocument.ts";
import { publishRows } from "./policy.ts";
import { runScarletTool, type ScarletSelection, type ScarletContextRead, type ScarletContext, type ContextDocument } from "./scarletTools.ts";
import { readScarletSource } from "./scarletSource.ts";
import type { WorkflowSnapshot } from "./workflow.ts";
import { readWorkflowContext, workflowPacket } from "./workflowContext.ts";

export const scarletResourceDigest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export async function resolveScarletContext(leaf: Leaf | undefined, selection: ScarletSelection, resources: {
  readonly workflow?: WorkflowSnapshot | undefined;
  readonly harvest?: HarvestLoad; readonly policy?: PolicyLoad; readonly sourceRepo?: string; readonly signal: AbortSignal;
}): Promise<ScarletContextRead> {
  const { tool } = selection;
  let context: ScarletContext;
  if (tool.name === "read_workflow") {
    const read = readWorkflowContext(resources.workflow, selection);
    if (!read.ok) return read;
    context = read.context;
  } else if (leaf === undefined) return { ok: false, why: "The Leaf is unavailable." };
  else if (tool.name === "read_candidate") {
    const h = resources.harvest;
    // `why` is the run's visible status: the named problem, never the loader's path or parser text.
    if (!h?.ok) return { ok: false, why: h ? harvestLoadProblem(h) : "No harvest document was supplied." };
    if (selection.harvestDigest !== scarletResourceDigest(h.harvest)) return { ok: false, why: "The review draft changed. Reopen it from Review before asking again." };
    if ((h.harvest.leafId !== undefined && h.harvest.leafId !== leaf.id) || (h.harvest.subject !== undefined && h.harvest.subject !== leaf.subject)) return { ok: false, why: "This harvest names a different Leaf or subject. Photosynthesis cannot attribute its drafts to this portfolio." };
    const candidate = h.harvest.candidates.find((c) => c.id === tool.id);
    if (!candidate) return { ok: false, why: "This review candidate is no longer in the harvest document." };
    const doc: ContextDocument = {
      citation: "L1", id: candidate.id, href: `/review#candidate-${encodeURIComponent(candidate.id)}`,
      title: candidate.title.slice(0, 1200), candidateState: candidate.review.state,
      body: candidate.evidence.slice(0, 8).map((e) => ({ provenance: { source: e.source, ref: e.ref, observedAt: e.observedAt },
        ...(e.excerpt === undefined ? {} : { text: e.excerpt.slice(0, 1200) }) })),
      notes: ["Review draft, not a portfolio claim. Evidence excerpts may be shortened to 1,200 characters; up to eight references are supplied.",
        `Drafted at ${candidate.draftedAt}.`, ...(candidate.review.state === "rejected" ? [`Rejection reason: ${candidate.review.reason.slice(0, 1200)}`] : []),
        ...(candidate.media ? ["The draft also carries media; image bytes are not supplied."] : [])],
    };
    if (JSON.stringify(doc).length > 24_000) return { ok: false, why: "This candidate exceeds the context limit. Inspect the draft in Review." };
    context = { tool, documentDigest: selection.documentDigest, documents: [doc], matched: 1, omitted: 0,
      subject: h.harvest.leafId === undefined || h.harvest.subject === undefined ? "Unbound review draft. No subject attribution is established." : leaf.subject };
  } else context = runScarletTool(leaf, selection.documentDigest, tool);
  context = { ...context, purpose: selection.purpose ?? "understand" };
  if (selection.purpose === "publish") {
    if (leaf === undefined) return { ok: false, why: "Publication context requires a Leaf." };
    const p = resources.policy;
    if (!p?.ok) return { ok: false, why: p ? POLICY_UNAVAILABLE : "No publish policy was supplied." };
    if (selection.policyDigest !== effectivePolicyDigest(p.policy, p.source)) return { ok: false, why: "The publish policy changed. Reopen the publication context before asking again." };
    const ids = new Set(context.documents.map((d) => d.id));
    context = { ...context, policySource: p.source.kind, publication: publishRows(leaf, p.policy).filter((r) => ids.has(r.id)).map((r) => ({
      id: r.id, state: r.outward.kind, reason: r.outward.kind === "served" ? "Shared by the subject and not denied by a rule." :
        r.outward.kind === "withheld-by-rule" ? r.outward.rule.reason : decisionReason(r.decision),
    })) };
  }
  if (selection.includeSource) {
    const refs = [...new Set(context.documents.flatMap((d) => [
      ...[d.provenance, ...d.body.map((e) => e.provenance)].filter((p) => p?.source === "git").map((p) => p!.ref),
      ...(d.workflowEvidence ?? []).map((e) => e.sha),
    ]))];
    const sourceRepo = tool.name === "read_workflow" ? workflowPacket(resources.workflow, tool.id)?.source?.path : resources.sourceRepo;
    const sourceReads: NonNullable<ScarletContext["sourceReads"]>[number][] = [];
    for (const ref of refs.slice(0, 2)) {
      if (resources.signal.aborted) return { ok: false, why: "Source read cancelled." };
      const citations = context.documents.filter((d) => d.provenance?.ref === ref || d.body.some((e) => e.provenance.ref === ref) || d.workflowEvidence?.some((e) => e.sha === ref)).map((d) => d.citation);
      sourceReads.push({ ...await readScarletSource(sourceRepo, ref, resources.signal), citations });
    }
    if (!refs.length) sourceReads.push({ ref: "", state: "unavailable", detail: "No git evidence references are recorded in this selection." });
    if (refs.length > 2) sourceReads.push({ ref: "", state: "unavailable", detail: "Only the first two git references were read. Inspect the remaining references in the original record." });
    context = { ...context, sourceReads };
  }
  return { ok: true, context };
}
