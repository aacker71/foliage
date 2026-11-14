/** Open, portable review contracts. Digests bind content; they do not authenticate a sender. */
import { createHash } from "node:crypto";
import { parseLeafDocument, RATING_SHAPED, type Leaf, type Leaflet } from "@foliage/leaf";
import type { WorkflowSnapshot } from "./workflow.ts";
import { workflowPacket } from "./workflowContext.ts";

export const revisionDigest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
export interface RevisionTarget { readonly leafId: string; readonly leafletId: string; readonly revision: string }
export interface LeafletReviewRequest {
  readonly format: "foliage-leaflet-review"; readonly version: 1;
  readonly target: RevisionTarget; readonly subject: string; readonly title: string;
  readonly evidence: string; readonly digest: string;
}
export interface LeafletSuggestion {
  readonly format: "foliage-leaflet-suggestion"; readonly version: 1;
  readonly target: RevisionTarget; readonly title: string; readonly notes: string;
  readonly model: string; readonly generatedAt: string; readonly digest: string;
}
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !(k in value))) throw new Error("Unexpected revision packet fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Revision text is missing or too long.");
  return value;
}
export function parseRevisionTarget(value: unknown): RevisionTarget {
  const v = shape(value, ["leafId", "leafletId", "revision"]);
  const revision = text(v["revision"], 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid Leaflet revision.");
  return { leafId: text(v["leafId"], 300), leafletId: text(v["leafletId"], 300), revision };
}
function title(value: unknown): string {
  const result = text(value, 600).trim();
  if (RATING_SHAPED.test(result)) throw new Error("Wording cannot contain a score or rating.");
  return result;
}
export function parseLeafletReviewRequest(value: unknown): LeafletReviewRequest {
  const v = shape(value, ["format", "version", "target", "subject", "title", "evidence", "digest"]);
  if (v["format"] !== "foliage-leaflet-review" || v["version"] !== 1) throw new Error("Unsupported Leaflet review packet.");
  const content = { format: "foliage-leaflet-review" as const, version: 1 as const, target: parseRevisionTarget(v["target"]),
    subject: text(v["subject"], 200), title: title(v["title"]), evidence: text(v["evidence"], 12_000) };
  if (v["digest"] !== revisionDigest(content)) throw new Error("The review packet changed. Export it again.");
  return { ...content, digest: v["digest"] as string };
}
export function parseLeafletSuggestion(value: unknown): LeafletSuggestion {
  const v = shape(value, ["format", "version", "target", "title", "notes", "model", "generatedAt", "digest"]);
  if (v["format"] !== "foliage-leaflet-suggestion" || v["version"] !== 1) throw new Error("Unsupported suggestion packet.");
  const generatedAt = text(v["generatedAt"], 40);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Invalid suggestion date.");
  const content = { format: "foliage-leaflet-suggestion" as const, version: 1 as const, target: parseRevisionTarget(v["target"]),
    title: title(v["title"]), notes: text(v["notes"], 24_000), model: text(v["model"], 300), generatedAt };
  if (RATING_SHAPED.test(content.notes)) throw new Error("Suggestion notes contain rating language.");
  if (v["digest"] !== revisionDigest(content)) throw new Error("The suggestion packet changed. Export it again.");
  return { ...content, digest: v["digest"] as string };
}
function editable(record: Leaflet): void {
  if (record.tier !== "pending" || record.visibility && record.visibility !== "private") throw new Error("Only pending, private Leaflets can be revised here.");
}
export function exportLeafletReview(leaf: Leaf, id: string): LeafletReviewRequest {
  const record = leaf.leaflets.find(l => l.id === id);
  if (!record) throw new Error("This Leaflet is unavailable.");
  editable(record);
  const evidence = JSON.stringify({ title: record.title, tier: record.tier, provenance: record.provenance ?? null, body: record.body ?? [] }, null, 2);
  const content = { format: "foliage-leaflet-review" as const, version: 1 as const,
    target: { leafId: String(leaf.id), leafletId: String(record.id), revision: revisionDigest(record) }, subject: leaf.subject, title: record.title, evidence };
  return parseLeafletReviewRequest({ ...content, digest: revisionDigest(content) });
}
function validated(leaf: Leaf): Leaf {
  const parsed = parseLeafDocument(leaf);
  if (!parsed.ok) throw new Error("The proposed Leaf failed its document gate. Nothing saved.");
  return parsed.leaf;
}
export function workflowLeaflet(leaf: Leaf, state: WorkflowSnapshot, id: string, packetRevision: string, reviewer: string, confirmedSubject: string, at: string): Leaf {
  const packet = workflowPacket(state, id);
  if (!packet || packet.digest !== packetRevision) throw new Error("The workflow draft or source changed. Reopen the preview.");
  const p = packet.proposal;
  if (p.status !== "accepted" || !packet.source) throw new Error("Save a private draft with a connected source before preparing a Leaflet.");
  if (confirmedSubject !== leaf.subject) throw new Error("Type the current Leaf subject exactly to bind this review.");
  const by = text(reviewer, 200).trim();
  if (p.evidence.some(e => e.email.toLowerCase() !== packet.source!.email.toLowerCase())) throw new Error("Draft evidence no longer matches its configured identity.");
  const refs = new Set(p.evidence.map(e => e.sha));
  if (leaf.leaflets.some(l => l.tier === "excluded" && [l.provenance, ...(l.body ?? []).map(e => e.provenance)].some(e => e && refs.has(e.ref)))) throw new Error("Draft cites excluded evidence. Resolve attribution first.");
  const recordId = `workflow:${p.id}`;
  const prior = leaf.leaflets.find(l => l.id === recordId);
  if (prior) { editable(prior); if (prior.provenance?.source !== "photosynthesis:workflow" || prior.provenance.ref !== p.id) throw new Error("That Leaflet id belongs to different evidence."); }
  // Re-observation is a real review event, explicitly distinguished from missing collection time.
  const observedAt = p.capturedAt ?? at;
  const record = {
    id: recordId, title: title(p.title), tier: "pending", visibility: "private",
    provenance: { source: "photosynthesis:workflow", ref: p.id, observedAt },
    body: [...p.evidence.map(e => ({ text: e.title, provenance: { source: "git", ref: e.sha, observedAt: e.observedAt ?? observedAt } })),
      ...(prior?.body ?? []).filter(e => e.provenance.source !== "git"),
      { text: `Workflow packet ${p.id}. Source ${p.source}. ${p.omitted} additional matching commits omitted from collection. First collected: ${p.capturedAt ?? "not recorded; evidence re-observed at this review"}. Evidence refreshed: ${p.collectedAt ?? p.capturedAt ?? "not recorded; evidence re-observed at this review"}. Draft saved ${p.updatedAt}. Reviewed for ${leaf.subject} by ${by} at ${at}. Exact author-email matching does not verify authorship.`,
        provenance: { source: "photosynthesis:review", ref: packet.digest, observedAt: at } }],
  };
  const raw = { ...leaf, leaflets: prior ? leaf.leaflets.map(l => l.id === recordId ? record : l) : [...leaf.leaflets, record] };
  const parsed = parseLeafDocument(raw);
  if (!parsed.ok) throw new Error("The draft cannot become a valid Leaflet. Nothing saved.");
  return parsed.leaf;
}
export function applyLeafletSuggestion(leaf: Leaf, suggestion: LeafletSuggestion, reviewer: string, confirmedSubject: string, at: string): Leaf {
  const s = parseLeafletSuggestion(suggestion);
  if (s.target.leafId !== leaf.id || confirmedSubject !== leaf.subject) throw new Error("This suggestion belongs to another Leaf or subject confirmation.");
  const record = leaf.leaflets.find(l => l.id === s.target.leafletId);
  if (!record || revisionDigest(record) !== s.target.revision) throw new Error("Leaflet changed. Export again.");
  editable(record);
  const by = text(reviewer, 200).trim();
  const changed = { ...record, title: s.title, body: [...(record.body ?? []), {
    text: `Title revision accepted by ${by} at ${at}. Previous title: ${record.title}. Imported suggestion ${s.digest}; declared model ${s.model}, generated ${s.generatedAt}. Sender identity is not authenticated; cloud notes were not added as evidence.`,
    provenance: { source: "photosynthesis:revision-review", ref: s.digest, observedAt: at },
  }] };
  return validated({ ...leaf, leaflets: leaf.leaflets.map(l => l.id === record.id ? changed : l) });
}
