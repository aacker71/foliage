/** Public records contain selected findings only. A tombstone prevents stale release resurrection. */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { changeAssessmentFile, readAssessmentFile } from "./assessmentFiles.ts";
import { digest, parseFindings, record, validAssessmentId, type Finding } from "./ladybugAssessment.ts";
import { redactPublicationText } from "@foliage/canopy";

export interface AssessmentPublication {
  readonly version: 1;
  readonly revision: string;
  readonly id: string;
  readonly release: { readonly subject: string; readonly model: string; readonly assessedAt: string; readonly findings: readonly Finding[] } | null;
}
export function assessmentPublicationPath(root: string, id: string): string {
  if (!root || !validAssessmentId(id)) throw new Error("Assessment publication destination is not configured or its id is invalid.");
  return join(root, "assessments", `${id}.json`);
}
function parseAssessmentPublication(value: unknown, id: string): AssessmentPublication | null {
  if (value === null) return null;
  const v = record(value, ["version", "revision", "id", "release"]);
  if (v["version"] !== 1 || v["id"] !== id || typeof v["revision"] !== "string" || !v["revision"]) throw new Error("Invalid assessment publication.");
  if (v["release"] === null) return { version: 1, revision: v["revision"], id, release: null };
  const r = record(v["release"], ["subject", "model", "assessedAt", "findings"]);
  for (const key of ["subject", "model", "assessedAt"]) {
    const text = r[key];
    if (typeof text !== "string" || !text.trim() || text.length > 200 || redactPublicationText(text) !== text) throw new Error("Invalid released assessment metadata.");
  }
  if (!Number.isFinite(Date.parse(r["assessedAt"] as string))) throw new Error("Invalid assessment date.");
  return { version: 1, revision: v["revision"], id, release: {
    subject: r["subject"] as string, model: r["model"] as string, assessedAt: r["assessedAt"] as string,
    findings: parseFindings(r["findings"]),
  } };
}
export async function readAssessmentPublication(root: string, id: string): Promise<AssessmentPublication | null> {
  return parseAssessmentPublication(await readAssessmentFile(assessmentPublicationPath(root, id)), id);
}
export interface AssessmentInventory {
  readonly items: readonly AssessmentPublication[];
  readonly unreadable: readonly string[];
}
export async function assessmentInventory(root: string): Promise<AssessmentInventory> {
  if (!root) return { items: [], unreadable: [] };
  let names: string[];
  try { names = await readdir(join(root, "assessments")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [], unreadable: [] }; throw error; }
  const results: AssessmentPublication[] = [];
  const unreadable: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || !validAssessmentId(name.slice(0, -5))) continue;
    try {
      const publication = await readAssessmentPublication(root, name.slice(0, -5));
      if (publication?.release) results.push(publication);
    } catch { unreadable.push(name.slice(0, -5)); }
  }
  return { items: results, unreadable };
}
export async function writeAssessmentPublication(root: string, id: string, expected: string, release: AssessmentPublication["release"]): Promise<void> {
  const next = { version: 1, revision: randomUUID(), id, release };
  parseAssessmentPublication(next, id);
  await changeAssessmentFile(assessmentPublicationPath(root, id), expected, () => next);
}
export { digest as assessmentPublicationDigest };
