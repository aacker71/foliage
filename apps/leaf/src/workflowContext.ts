/** A saved workflow packet stays a private packet. No Leaf or harvest is manufactured. */
import { createHash } from "node:crypto";
import type { WorkflowSnapshot } from "./workflow.ts";
import type { ScarletContextRead, ScarletSelection } from "./scarletTools.ts";

export function workflowPacket(state: WorkflowSnapshot | undefined, id: string) {
  const proposal = state?.proposals.find((p) => p.id === id);
  if (!proposal) return undefined;
  const source = state?.sources.find((s) => s.id === proposal.source);
  // Schedule changes do not invalidate a question; packet edits and source removal do.
  const digest = `sha256:${createHash("sha256").update(JSON.stringify({ proposal,
    source: source ? { id: source.id, path: source.path, email: source.email } : null })).digest("hex")}`;
  return { proposal, source, digest };
}

export function readWorkflowContext(state: WorkflowSnapshot | undefined, selection: ScarletSelection): ScarletContextRead {
  if (selection.tool.name !== "read_workflow" || selection.purpose !== "review") return { ok: false, why: "Choose a workflow packet to review." };
  const packet = workflowPacket(state, selection.tool.id);
  if (!packet) return { ok: false, why: "Workflow packet unavailable · /review" };
  if (packet.digest !== selection.documentDigest) return { ok: false, why: "Workflow packet or its source changed · reload" };
  const { proposal: p } = packet;
  const evidence = p.evidence.slice(0, 8).map((e) => ({ ...e, title: e.title.slice(0, 1200) }));
  const doc = {
    citation: "L1", id: p.id, href: `/workflow/export?packet=${encodeURIComponent(p.id)}`,
    title: p.title, candidateState: p.status === "accepted" ? "saved private draft" : p.status,
    body: [], workflowEvidence: evidence,
    ...(p.capturedAt ? { capturedAt: p.capturedAt } : {}),
    notes: ["Private workflow packet, not a portfolio claim. Exact author-email metadata matching does not establish authorship.",
      "Commit subjects are recorded source text, not descriptions of patch bytes that Photosynthesis has read. Up to eight commit subjects are supplied, shortened to 1,200 characters.",
      `${p.omitted + p.evidence.length - evidence.length} additional matching commits omitted from this context. Open the workflow packet for all retained references.`,
      ...(p.capturedAt ? [] : ["Collection time was not recorded by this older packet. Its last edit time is not evidence observation time."]),
      ...(packet.source ? [] : ["The connected source was removed. Saved references remain; new source reads are unavailable."])],
  };
  if (JSON.stringify(doc).length > 24_000) return { ok: false, why: `Packet exceeds the context limit · ${doc.href}` };
  return { ok: true, context: { tool: selection.tool, documentDigest: packet.digest, purpose: "review",
    subject: "Private workflow packet. No portfolio subject attribution is established.",
    documents: [doc], matched: 1, omitted: 0 } };
}
