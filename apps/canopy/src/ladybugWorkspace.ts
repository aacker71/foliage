/** Private local owner workflow; hosting/authentication are deliberately not implied by this store. */
import { parseLeafletSuggestion, revisionDigest, type LeafletSuggestion } from "@foliage/leaf-app/leafletRevision";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { changeAssessmentFile, readAssessmentFile } from "./assessmentFiles.ts";
import { digest, parsePacket, parseFindings, redactPacket, record, type Assessment, type AssessmentPacket } from "./ladybugAssessment.ts";
import { assessPacket } from "./ladybugInference.ts";
import { writeAssessmentPublication, type AssessmentPublication } from "./assessmentPublication.ts";
import { acquirePublicationLock } from "./publicationLock.mjs";

export interface Workspace {
  readonly revision: string;
  readonly packet: AssessmentPacket;
  readonly status: "draft" | "running" | "assessed" | "failed";
  readonly assessment: Assessment | null;
  readonly failure: string | null;
}
export function workspacePath(env: Readonly<Record<string, string | undefined>>): string {
  const leaf = env["FOLIAGE_LEAF"]?.trim();
  const path = resolve(env["FOLIAGE_LADYBUG"]?.trim() || join(leaf ? dirname(resolve(leaf)) : join(homedir(), ".foliage"), "ladybug.json"));
  const publicRoot = env["FOLIAGE_PUBLISHED"]?.trim();
  if (publicRoot && (path === resolve(publicRoot) || path.startsWith(resolve(publicRoot) + sep))) throw new Error("Private Ladybug storage must be outside public storage.");
  return path;
}
function parseWorkspace(value: unknown): Workspace | null {
  if (value === null) return null;
  const v = record(value, ["revision", "packet", "status", "assessment", "failure"]);
  const packet = parsePacket(v["packet"]);
  if (typeof v["revision"] !== "string" || !["draft", "running", "assessed", "failed"].includes(String(v["status"]))) throw new Error("Invalid private assessment state.");
  let assessment: Assessment | null = null;
  if (v["assessment"] !== null) {
    const a = record(v["assessment"], ["model", "assessedAt", "packetDigest", "findings"]);
    if (typeof a["model"] !== "string" || typeof a["assessedAt"] !== "string" || a["packetDigest"] !== digest(packet)) throw new Error("Assessment no longer matches its evidence packet.");
    assessment = { model: a["model"], assessedAt: a["assessedAt"], packetDigest: a["packetDigest"] as string, findings: parseFindings(a["findings"], packet) };
  }
  if ((v["status"] === "assessed") !== (assessment !== null) || (v["failure"] !== null && typeof v["failure"] !== "string")) throw new Error("Invalid assessment outcome.");
  return { revision: v["revision"], packet, status: v["status"] as Workspace["status"], assessment, failure: v["failure"] as string | null };
}
export async function loadWorkspace(path: string): Promise<Workspace | null> { return parseWorkspace(await readAssessmentFile(path)); }
export async function savePacket(path: string, expected: string, value: unknown): Promise<void> {
  const packet = redactPacket(value);
  await changeAssessmentFile(path, expected, current => {
    const prior = parseWorkspace(current);
    if (prior && prior.packet.id !== packet.id) throw new Error("This workspace already belongs to another portfolio id.");
    return { revision: randomUUID(), packet, status: "draft", assessment: null, failure: null } satisfies Workspace;
  });
}
export async function runAssessment(path: string, expected: string, confirm: string, env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch): Promise<void> {
  const before = await loadWorkspace(path);
  if (!before || digest(before) !== expected || confirm !== before.packet.id) throw new Error("Packet not current or id doesn’t match. Review again.");
  const running: Workspace = { ...before, revision: randomUUID(), status: "running", assessment: null, failure: null };
  await changeAssessmentFile(path, expected, () => running);
  let finished: Workspace;
  try {
    const assessment = await assessPacket(before.packet, env, fetcher);
    finished = { ...running, revision: randomUUID(), status: "assessed", assessment };
  } catch (error) {
    finished = { ...running, revision: randomUUID(), status: "failed", failure: error instanceof Error ? error.message : "Ladybug failed without an accepted assessment." };
  }
  // An edited/challenged packet invalidates the in-flight result. Never overwrite that decision.
  await changeAssessmentFile(path, digest(running), () => finished);
}
export async function releaseAssessment(path: string, expected: string, publicRoot: string, publicDigest: string, confirm: string, selected: readonly string[]): Promise<void> {
  // Keep the private record locked until the public commit, so an edit cannot race a release.
  const unlock = await acquirePublicationLock(path);
  try {
    const workspace = await loadWorkspace(path);
    if (!workspace || digest(workspace) !== expected || workspace.status !== "assessed" || !workspace.assessment || confirm !== workspace.packet.id) throw new Error("Assessment not current or id doesn’t match. Review again.");
    const chosen = new Set(selected);
    const findings = workspace.assessment.findings.filter(f => chosen.has(f.dimension));
    if (!findings.length || findings.length !== chosen.size) throw new Error("Select at least one valid finding. Nothing was released.");
    const release: AssessmentPublication["release"] = { subject: workspace.packet.subject, model: workspace.assessment.model,
      assessedAt: workspace.assessment.assessedAt, findings };
    await writeAssessmentPublication(publicRoot, workspace.packet.id, publicDigest, release);
  } finally { await unlock(); }
}

/** Return private findings and reviewer-composed wording; no mutation or automatic local write. */
export function exportLeafletSuggestion(workspace: Workspace | null, expected: string, wording: string): LeafletSuggestion {
  if (!workspace || digest(workspace) !== expected || workspace.status !== "assessed" || !workspace.assessment || !workspace.packet.target) throw new Error("Needs a current assessment of an imported Leaflet.");
  const a = workspace.assessment;
  const notes = ["Proposed wording was entered by the reviewer. The findings below are model suggestions, not verified evidence.",
    ...a.findings.map(f => `${f.dimension}: ${f.observation}\nLimits: ${f.caveat}\n${f.citations.map(c => `${c.source}: ${c.quote}`).join("\n")}`)].join("\n\n");
  const content = { format: "foliage-leaflet-suggestion" as const, version: 1 as const, target: workspace.packet.target,
    title: wording.trim(), notes, model: a.model, generatedAt: a.assessedAt };
  return parseLeafletSuggestion({ ...content, digest: revisionDigest(content) });
}
