/** Private source observations, not authorship attestations or model conclusions. */
import { createHash } from "node:crypto";
import { isIsoInstant, RATING_SHAPED } from "@foliage/leaf";
import { parseHarvestDocument, type HarvestDocument } from "./harvestDocument.ts";

interface Observation {
  readonly source: "git" | "asana-import";
  readonly scope: string;
  readonly object: string;
  readonly sourceRevision: string;
  readonly occurredAt: string;
  readonly actor: string | null;
  readonly text: string;
}
interface Cell extends Observation {
  readonly id: string;
  readonly revision: string;
  readonly observedAt: string;
}
interface SourcePermission {
  readonly source: Observation["source"];
  readonly scope: string;
  readonly allowed: boolean;
  readonly at: string;
  readonly reason: string;
}
interface Retraction { readonly id: string; readonly at: string; readonly reason: string }
export interface CellStore {
  readonly version: 2;
  readonly subject: string;
  readonly leafId: string;
  readonly cells: readonly Cell[];
  readonly permissions: readonly SourcePermission[];
  readonly retractions: readonly Retraction[];
}
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error("Unknown cell record field.");
  return v;
}
function text(value: unknown, maximum = 2048): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) throw new Error("Missing, oversized or invalid cell text.");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !isIsoInstant(value)) throw new Error("A cell timestamp must be an ISO instant with offset.");
  return value;
}
function observation(v: Record<string, unknown>): Observation {
  if (v["source"] !== "git" && v["source"] !== "asana-import") throw new Error("Unsupported cell source.");
  return { source: v["source"], scope: text(v["scope"]), object: text(v["object"]),
    sourceRevision: text(v["sourceRevision"]), occurredAt: instant(v["occurredAt"]),
    actor: v["actor"] === null ? null : text(v["actor"]), text: text(v["text"], 16_384) };
}
function cell(value: Observation, observedAt: string): Cell {
  return { ...value, id: `cell:${hash([value.source, value.scope, value.object])}`,
    revision: `sha256:${hash(value)}`, observedAt: instant(observedAt) };
}

export function parseCellStore(value: unknown): CellStore {
  const v = object(value, ["version", "subject", "leafId", "cells", "permissions", "retractions"]);
  if (v["version"] !== 2) throw new Error("Cell store version 2 required. Migrate legacy stores explicitly; no permissions inferred.");
  if (!Array.isArray(v["cells"]) || v["cells"].length > 10_000 || !Array.isArray(v["permissions"]) || v["permissions"].length > 1000 || !Array.isArray(v["retractions"]) || v["retractions"].length > 10_000) throw new Error("Unsupported or oversized cell store.");
  const permissionKeys = new Set<string>();
  const permissions = v["permissions"].map(raw => {
    const p = object(raw, ["source", "scope", "allowed", "at", "reason"]);
    if (p["source"] !== "git" && p["source"] !== "asana-import" || typeof p["allowed"] !== "boolean") throw new Error("Invalid source permission.");
    const key = JSON.stringify([p["source"], text(p["scope"])]);
    if (permissionKeys.has(key)) throw new Error("Duplicate source permission.");
    permissionKeys.add(key);
    return { source: p["source"], scope: text(p["scope"]), allowed: p["allowed"], at: instant(p["at"]), reason: text(p["reason"]) } as SourcePermission;
  });
  const retracted = new Set<string>();
  const retractions = v["retractions"].map(raw => {
    const r = object(raw, ["id", "at", "reason"]);
    const id = text(r["id"]);
    if (!/^cell:[a-f0-9]{64}$/.test(id) || retracted.has(id)) throw new Error("Invalid or duplicate cell retraction.");
    retracted.add(id);
    return { id, at: instant(r["at"]), reason: text(r["reason"]) };
  });
  const seen = new Set<string>();
  const sourceVersions = new Set<string>();
  const latest = new Map<string, number>();
  const cells = v["cells"].map(raw => {
    const c = object(raw, ["source", "scope", "object", "sourceRevision", "occurredAt", "actor", "text", "id", "revision", "observedAt"]);
    const parsed = cell(observation(c), instant(c["observedAt"]));
    if (retracted.has(parsed.id)) throw new Error("Retracted cell content must not remain in the store.");
    if (parsed.id !== c["id"] || parsed.revision !== c["revision"]) throw new Error("Cell identity or content digest mismatch.");
    const key = `${parsed.id}/${parsed.revision}`;
    if (seen.has(key)) throw new Error("Duplicate cell revision.");
    seen.add(key);
    const sourceVersion = JSON.stringify([parsed.id, parsed.sourceRevision]);
    if (sourceVersions.has(sourceVersion)) throw new Error("The same source revision has conflicting content.");
    sourceVersions.add(sourceVersion);
    const previous = latest.get(parsed.id);
    const time = Date.parse(parsed.occurredAt);
    if (previous !== undefined && previous >= time) throw new Error("Cell revision history is older or ambiguous.");
    latest.set(parsed.id, time);
    return parsed;
  });
  return { version: 2, subject: text(v["subject"]), leafId: text(v["leafId"]), cells, permissions, retractions };
}

export function requireCellSource(store: CellStore, source: string, scope: string): void {
  if (!store.permissions.some(p => p.source === source && p.scope === scope && p.allowed)) throw new Error("Source is not allowed. Explicit local permission required.");
}

export function migrateCellStore(value: unknown): CellStore {
  const v = object(value, ["version", "subject", "leafId", "cells"]);
  if (v["version"] !== 1) throw new Error("Only legacy version 1 stores can be migrated.");
  return parseCellStore({ ...v, version: 2, permissions: [], retractions: [] });
}

/** Re-check the exact selected revisions and source permissions at the consumption boundary. */
export function checkCellDraft(store: CellStore, harvest: HarvestDocument): void {
  const current = parseCellStore(store);
  if (!harvest.candidates.length) throw new Error("No cell candidates to check.");
  if (harvest.subject !== current.subject || harvest.leafId !== current.leafId) throw new Error("Cell draft/store subject binding mismatch.");
  for (const candidate of harvest.candidates) {
    const refs = candidate.evidence.filter(e => e.source === "cell-snapshot");
    const ids = refs.map(e => e.ref.split("/")[0]!);
    const expected = draftFromCells(current, ids, candidate.title, candidate.draftedAt).candidates[0]!;
    if (candidate.id !== expected.id || candidate.extractor !== expected.extractor || JSON.stringify(candidate.evidence) !== JSON.stringify(expected.evidence) || candidate.media !== undefined || candidate.shownPages !== undefined) throw new Error("Cell draft is stale or altered; create and review a fresh draft.");
  }
}

/** A local owner's instruction, not a remote provider permission attestation. */
export function setCellSourcePermission(store: CellStore, source: string, scope: string, allowed: boolean, at: string, reason: string): CellStore {
  const prior = store.permissions.find(p => p.source === source && p.scope === scope);
  if (prior && Date.parse(instant(at)) <= Date.parse(prior.at)) throw new Error("Permission timestamp must advance; retry with a later instant.");
  return parseCellStore({ ...store, permissions: [...store.permissions.filter(p => p !== prior), { source, scope, allowed, at, reason }] });
}

/** Remove every local revision; retain only the blocking identity and owner's reason. */
export function retractCell(store: CellStore, id: string, at: string, reason: string): CellStore {
  instant(at); text(reason);
  if (store.retractions.some(r => r.id === id)) return store;
  if (!store.cells.some(c => c.id === id)) throw new Error("Selected cell does not exist.");
  return parseCellStore({ ...store, cells: store.cells.filter(c => c.id !== id), retractions: [...store.retractions, { id, at, reason }] });
}

/** Reobserving identical bytes is a no-op. Older revisions remain inspectable. */
export function addCell(store: CellStore, value: unknown, observedAt: string): CellStore {
  const input = object(value, ["source", "scope", "object", "sourceRevision", "occurredAt", "actor", "text"]);
  const next = cell(observation(input), observedAt);
  requireCellSource(store, next.source, next.scope);
  if (store.retractions.some(r => r.id === next.id)) throw new Error("Cell was retracted; reimport refused.");
  const prior = store.cells.filter(c => c.id === next.id);
  if (prior.some(c => c.revision === next.revision)) return store;
  if (prior.some(c => c.sourceRevision === next.sourceRevision)) throw new Error("The same source revision has conflicting content. Nothing imported.");
  if (prior.some(c => Date.parse(c.occurredAt) >= Date.parse(next.occurredAt))) throw new Error("Older or ambiguous source revision. Nothing imported.");
  return parseCellStore({ ...store, cells: [...store.cells, next] });
}

/** This is a supplied task snapshot, NOT a remotely verified event or approval. */
export function asanaObservation(value: unknown, project: string): Observation {
  const v = object(value, ["gid", "name", "modified_at", "completed", "assignee", "projects"]);
  const gid = text(v["gid"]);
  if (!/^\d+$/.test(gid) || !/^\d+$/.test(project)) throw new Error("Invalid Asana task/project identifier.");
  if (!Array.isArray(v["projects"]) || !v["projects"].some(p => p && typeof p === "object" && p.gid === project)) throw new Error("Snapshot does not name the selected project.");
  if (typeof v["completed"] !== "boolean") throw new Error("Task completion state is missing.");
  const name = text(v["name"]);
  const modified = instant(v["modified_at"]);
  // Assignee is not the person who performed the work, changed the task, or approved it.
  const assignee = v["assignee"] === null ? null : text(object(v["assignee"], ["gid"])["gid"]);
  return { source: "asana-import", scope: project, object: gid, sourceRevision: modified,
    occurredAt: modified, actor: null,
    text: JSON.stringify({ name, completed: v["completed"], assignee }) };
}

/** Explicit selection, not inferred grouping. Every original ref AND cell revision travels. */
export function draftFromCells(store: CellStore, ids: readonly string[], title: string, draftedAt: string): HarvestDocument {
  text(title, 500);
  if (RATING_SHAPED.test(title)) throw new Error("Rating-shaped draft title refused.");
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error("Select one to fifty distinct cells.");
  const selected = ids.map(id => {
    const current = store.cells.filter(c => c.id === id).at(-1);
    if (!current) throw new Error("Selected cell does not exist.");
    requireCellSource(store, current.source, current.scope);
    return current;
  });
  const permissionRevision = (c: Cell) => hash(store.permissions.find(p => p.source === c.source && p.scope === c.scope));
  const result = parseHarvestDocument({ subject: store.subject, leafId: store.leafId, candidates: [{
    id: `cells:${hash([title, selected.map(c => [c.id, c.revision, permissionRevision(c)])])}`,
    title, extractor: "explicit-cell-selection", draftedAt: instant(draftedAt), review: { state: "candidate" },
    evidence: selected.flatMap(c => [
      { source: c.source, ref: c.source === "git" ? c.object : `asana-task:${c.scope}:${c.object}@${c.sourceRevision}`,
        observedAt: c.observedAt, excerpt: c.text },
      { source: "cell-snapshot", ref: `${c.id}/${c.revision}/permission:${permissionRevision(c)}`, observedAt: c.observedAt },
    ]),
  }] });
  if (!result.ok) throw new Error("Cell draft failed the existing candidate gate.");
  return result.harvest;
}
