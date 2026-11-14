/** Portable, owner-reviewed evidence. No closed-plane concepts or automatic network handoff. */
import { createHash } from "node:crypto";
import type { WorkflowSnapshot } from "./workflow.ts";
import { workflowPacket } from "./workflowContext.ts";

export interface WorkflowTransfer {
  readonly format: "foliage-workflow-packet";
  readonly version: 1;
  readonly packetId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly capturedAt: string | null;
  readonly savedAt: string;
  readonly evidence: readonly { readonly sha: string; readonly title: string }[];
  readonly omitted: number;
  readonly digest: string;
}
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const hex = /^[a-f0-9]{64}$/;
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some((n) => !(n in value))) throw new Error("Unexpected workflow transfer fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Workflow transfer text is missing or too long.");
  return value;
}
function date(value: unknown): string {
  const s = text(value, 40);
  if (!Number.isFinite(Date.parse(s))) throw new Error("Invalid workflow transfer date.");
  return s;
}
/** Integrity detects accidental edits; it does not authenticate the exporter or prove authorship. */
export function parseWorkflowTransfer(value: unknown): WorkflowTransfer {
  const v = fields(value, ["format", "version", "packetId", "sourceId", "title", "capturedAt", "savedAt", "evidence", "omitted", "digest"]);
  if (v["format"] !== "foliage-workflow-packet" || v["version"] !== 1 || !hex.test(text(v["packetId"], 64)) || !hex.test(text(v["sourceId"], 64))) throw new Error("Unsupported workflow transfer format or id.");
  if (!Array.isArray(v["evidence"]) || !v["evidence"].length || v["evidence"].length > 25) throw new Error("The transfer must contain its bounded commit references.");
  const evidence = v["evidence"].map((raw) => {
    const e = fields(raw, ["sha", "title"]);
    const sha = text(e["sha"], 64);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error("Invalid commit reference.");
    return { sha, title: text(e["title"], 4000) };
  });
  if (!Number.isSafeInteger(v["omitted"]) || Number(v["omitted"]) < 0) throw new Error("Invalid omitted evidence count.");
  const content = { format: "foliage-workflow-packet" as const, version: 1 as const,
    packetId: v["packetId"] as string, sourceId: v["sourceId"] as string, title: text(v["title"], 600),
    capturedAt: v["capturedAt"] === null ? null : date(v["capturedAt"]), savedAt: date(v["savedAt"]), evidence, omitted: v["omitted"] as number };
  if (v["digest"] !== hash(content)) throw new Error("This transfer changed or is incomplete. Export the saved packet again.");
  return { ...content, digest: v["digest"] as string };
}
export function exportWorkflowTransfer(state: WorkflowSnapshot, id: string, revision: string): WorkflowTransfer {
  const packet = workflowPacket(state, id);
  if (!packet || packet.digest !== revision) throw new Error("The workflow packet changed. Reopen its export preview.");
  const p = packet.proposal;
  if (p.status !== "accepted") throw new Error("Save the private draft before preparing a transfer.");
  const content = { format: "foliage-workflow-packet" as const, version: 1 as const, packetId: p.id, sourceId: p.source,
    title: p.title, capturedAt: p.capturedAt ?? null, savedAt: p.updatedAt,
    evidence: p.evidence.map(({ sha, title }) => ({ sha, title })), omitted: p.omitted };
  return parseWorkflowTransfer({ ...content, digest: hash(content) });
}
