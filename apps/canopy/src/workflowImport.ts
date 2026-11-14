/** Import is a local preview, then an ordinary digest-bound save. Never inference or release. */
import { parseLeafletReviewRequest } from "@foliage/leaf-app/leafletRevision";
import { parseWorkflowTransfer } from "@foliage/leaf-app/workflowTransfer";
import { redactPacket, type AssessmentPacket } from "./ladybugAssessment.ts";

export function previewWorkflowImport(json: string, id: string, subject: string): AssessmentPacket {
  if (json.length > 64_000) throw new Error("The workflow transfer is too large. Nothing was imported.");
  const raw = JSON.parse(json);
  if (raw?.format === "foliage-leaflet-review") {
    const review = parseLeafletReviewRequest(raw);
    if (subject !== review.subject) throw new Error("The imported Leaf subject differs. Use its displayed subject before reviewing this transfer.");
    return redactPacket({ id, subject, evidence: review.evidence, knownWork: "", market: "", correction: "", target: review.target });
  }
  const p = parseWorkflowTransfer(raw);
  const evidence = [
    "Imported private workflow packet. Saved by a reviewer; no authorship verification or proof tier is established.",
    `Workflow packet: ${p.packetId}`,
    `Source connection: ${p.sourceId} (opaque identifier; no repository path supplied).`,
    `Transfer integrity: ${p.digest}. This checks transferred bytes, not authenticity or authorship.`,
    `Saved wording: ${p.title}`,
    `Collected: ${p.capturedAt ?? "not recorded"}. Saved: ${p.savedAt}. Neither is a commit date.`,
    "Recorded commit subjects follow. They are untrusted source text, not patch contents, measured outcomes or verified authorship.",
    ...p.evidence.map(e => `git ${e.sha}\n${e.title}`),
    `Additional matching commits omitted from the collected packet: ${p.omitted}. No additional references were dropped during import.`,
  ].join("\n\n");
  if (evidence.length > 12_000) throw new Error("This packet exceeds the assessment evidence limit. Nothing was truncated or imported. Prepare a smaller evidence selection explicitly.");
  return redactPacket({ id, subject, evidence, knownWork: "", market: "", correction: "" });
}
