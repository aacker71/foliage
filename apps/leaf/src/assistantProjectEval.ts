/** An owner-selected project scenario may run locally and return only to private Review. */
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { QueuedCall } from "./assistantMcp.ts";
import { persistIntegrationObservations, readIntegrationTarget } from "./integrationStore.ts";
import { queueCapturedDemo } from "./captureReview.ts";

const MAX_SCENARIO_BYTES = 128 * 1024;
const MAX_SCENARIO_TIME_MS = 60_000;
const MAX_RUN_WALL_MS = 120_000;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DOCKER_APP_BINARY = "/Applications/Docker.app/Contents/Resources/bin/docker";

interface Scenario {
  readonly version: 1;
  readonly id: string;
  readonly steps: readonly { readonly stage: string; readonly argv: readonly string[]; readonly timeoutMs: number }[];
  readonly browser?: { readonly argv: readonly string[]; readonly port: number; readonly path: string;
    readonly readyTimeoutMs: number; readonly durationSeconds: number };
}

export interface ProjectEvalFlags {
  readonly repo: string;
  readonly commit: string;
  readonly scenarioFile: string;
  readonly image: string;
}

export interface PinnedProjectEval {
  readonly repo: string;
  readonly commit: string;
  readonly scenarioFile: string;
  readonly scenarioDigest: string;
  readonly scenario: Scenario;
  readonly image: string;
}

export interface ProjectEvalTarget {
  readonly into: string;
  readonly out: string;
  readonly subject: { readonly leafId: string; readonly name: string };
}

interface EvalEnvelope {
  readonly digest: string;
  readonly evidence: {
    readonly jobId: string;
    readonly attemptId: string;
    readonly status: string;
    readonly reason: string | null;
    readonly cleanup: { readonly container: string; readonly snapshot: string };
    readonly browser?: { readonly status: string; readonly capture: { readonly id: string } | null };
  };
}

interface ObservationBatch {
  readonly subject: { readonly leafId: string; readonly name: string };
}

const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Do not follow a replaced scenario symlink or read unbounded owner input. */
async function scenarioBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_SCENARIO_BYTES) {
      throw new Error("--test-scenario must be a regular JSON file of at most 128 KiB.");
    }
    const bytes = Buffer.alloc(MAX_SCENARIO_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size === 0 || size > MAX_SCENARIO_BYTES) {
      throw new Error("--test-scenario must be a regular JSON file of at most 128 KiB.");
    }
    return bytes.subarray(0, size);
  } finally { await file.close(); }
}

/** Freeze the owner's exact selection before the agent connection starts. */
export async function prepareProjectEval(flags: ProjectEvalFlags): Promise<PinnedProjectEval> {
  if (!isAbsolute(flags.repo) || !isAbsolute(flags.scenarioFile)) {
    throw new Error("--test-repo and --test-scenario must be absolute paths selected by the owner.");
  }
  if (!COMMIT.test(flags.commit)) throw new Error("--test-commit must be a full Git commit SHA.");
  if (!IMAGE.test(flags.image)) throw new Error("--test-image must be an immutable sha256 image ID.");
  const repo = await realpath(flags.repo);
  if (!(await stat(repo)).isDirectory()) throw new Error("--test-repo must be a directory.");
  const scenarioFile = resolve(flags.scenarioFile);
  const bytes = await scenarioBytes(scenarioFile);
  let input: unknown;
  try { input = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("--test-scenario is not valid JSON."); }
  const contract = await import(new URL("../../../tools/eval/contract.mjs", import.meta.url).href) as {
    parseScenario: (value: unknown) => Scenario;
  };
  const scenario = contract.parseScenario(input);
  const total = scenario.steps.reduce((sum, step) => sum + step.timeoutMs, 0);
  if (total > MAX_SCENARIO_TIME_MS) {
    throw new Error("--test-scenario exceeds the 60-second MCP execution limit.");
  }
  return { repo, commit: flags.commit, scenarioFile, scenarioDigest: digest(bytes), scenario, image: flags.image };
}

/** A stale PATH link is common on macOS; prefer an executable Docker Desktop binary if needed. */
export async function findDockerExecutable(searchPath = process.env["PATH"] ?? "", appBinary = DOCKER_APP_BINARY): Promise<string> {
  for (const candidate of [...searchPath.split(delimiter).filter(Boolean).map(dir => join(dir, "docker")), appBinary]) {
    try { await access(candidate, constants.X_OK); return candidate; }
    catch { /* Keep looking; the evaluator will record Docker unavailability if none work. */ }
  }
  return "docker";
}

async function sameTarget(target: ProjectEvalTarget): Promise<boolean> {
  const current = await readIntegrationTarget(target.into);
  return current.id === target.subject.leafId && current.subject === target.subject.name;
}

export type ProjectEvalOutcome =
  | { readonly ok: true; readonly receiptPath: string; readonly receiptId: string; readonly jobId: string; readonly attemptId: string;
      readonly evaluationStatus: string; readonly reason: string | null; readonly cleanup: EvalEnvelope["evidence"]["cleanup"];
      readonly candidateIds: readonly string[]; readonly approved: false; readonly published: false }
  | { readonly ok: false; readonly cause: string; readonly detail: string; readonly receiptPath?: string; readonly receiptId?: string;
      readonly jobId?: string; readonly evaluationStatus?: string; readonly reason?: string | null;
      readonly cleanup?: EvalEnvelope["evidence"]["cleanup"] };

/** A failed test is still an honest observation. Queue it without changing review decisions. */
export async function runPinnedProjectEval(selection: PinnedProjectEval, target: ProjectEvalTarget, signal?: AbortSignal): Promise<ProjectEvalOutcome> {
  if (!await sameTarget(target)) return { ok: false, cause: "target-changed", detail: "The selected Leaf changed. Restart this connection." };
  let selectedBytes: Buffer;
  try { selectedBytes = await scenarioBytes(selection.scenarioFile); }
  catch { return { ok: false, cause: "scenario-unavailable", detail: "The owner-selected scenario file is unavailable. Restart this connection." }; }
  if (digest(selectedBytes) !== selection.scenarioDigest) {
    return { ok: false, cause: "scenario-changed", detail: "The owner-selected scenario changed. Restart this connection." };
  }

  const evalRoot = join(dirname(target.into), "evaluations");
  await mkdir(evalRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(evalRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    return { ok: false, cause: "evaluation-store-refused", detail: "The private evaluation directory must be a real local directory." };
  }
  const directory = await mkdtemp(join(evalRoot, "project-test-"));
  await chmod(directory, 0o700);
  await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 });
  const receiptPath = join(directory, "receipt.json");
  const runtime = await import(new URL("../../../tools/eval/local.mjs", import.meta.url).href) as {
    runLocal: (options: { repo: string; commit: string; image: string; scenario: Scenario; output: string;
      docker: string; trustedLocalCode: true; signal?: AbortSignal }) => Promise<EvalEnvelope>;
  };
  const evaluation = await runtime.runLocal({
    repo: selection.repo, commit: selection.commit, image: selection.image, scenario: selection.scenario,
    output: receiptPath, docker: await findDockerExecutable(), trustedLocalCode: true,
    ...(signal === undefined ? {} : { signal }),
  });
  const report = { receiptPath, receiptId: basename(directory), jobId: evaluation.evidence.jobId, evaluationStatus: evaluation.evidence.status,
    reason: evaluation.evidence.reason, cleanup: evaluation.evidence.cleanup };
  if (!await sameTarget(target)) {
    return { ok: false, cause: "target-changed", detail: "The evaluation receipt stayed private, but the selected Leaf changed before Review.", ...report };
  }
  try {
    if (evaluation.evidence.browser?.status === "completed" && evaluation.evidence.browser.capture !== null) {
      const queued = await queueCapturedDemo({
        captureRoot: `${receiptPath}.artifacts`, captureId: evaluation.evidence.browser.capture.id,
        evaluationReceiptPath: receiptPath, leafPath: target.into, harvestPath: target.out,
        expectedSubject: { id: target.subject.leafId, subject: target.subject.name },
        title: "Tested project demo",
      });
      return { ok: true, ...report, attemptId: evaluation.evidence.attemptId,
        candidateIds: [queued.candidateId], approved: false, published: false };
    }
    const importer = await import(new URL("../../../tools/eval/import.mjs", import.meta.url).href) as {
      importReceipt: (args: string[]) => Promise<{ batch: ObservationBatch }>;
    };
    const preview = await importer.importReceipt(["--input", receiptPath, "--into", target.into]);
    if (preview.batch.subject.leafId !== target.subject.leafId || preview.batch.subject.name !== target.subject.name) {
      return { ok: false, cause: "target-changed", detail: "The receipt stayed private, but its Review subject changed.", ...report };
    }
    // This shared locked write rechecks the target against the preview's subject.
    const reviewed = await persistIntegrationObservations(preview.batch, target.into, target.out);
    return { ok: true, ...report, attemptId: evaluation.evidence.attemptId,
      candidateIds: [...reviewed.persisted, ...reviewed.unchanged], approved: false, published: false };
  } catch (error) {
    process.stderr.write(`assistant-mcp: project evaluation receipt could not enter Review: ${error instanceof Error ? error.message : String(error)}\n`);
    return { ok: false, cause: "review-queue-refused", detail: "The evaluation receipt stayed private, but Review could not admit it. Inspect the selected garden and retry the saved receipt.", ...report };
  }
}

export function registerProjectEvalTool(server: McpServer, selection: PinnedProjectEval, target: ProjectEvalTarget, queued: QueuedCall): () => void {
  let started = false;
  let controller: AbortController | null = null;
  server.registerTool("foliage_test_selected_project", {
    description: `Run the owner's already selected local project scenario ${selection.scenario.id} at exact commit ${selection.commit}. The agent cannot choose commands, paths or images. If the scenario selects a browser demo, capture the app inside that same offline job and bind its PNG/MP4 to the test receipt in one private Review decision. Otherwise import the executor report. Failures remain explicit. No authorship, impact, approval or publication is inferred. This tool runs once per connection.`,
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, (_args, ctx) => queued(ctx, async () => {
    if (started) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "already-attempted", detail: "This connection has already run the selected project scenario." }) }],
      structuredContent: { error: "already-attempted", detail: "This connection has already run the selected project scenario." }, isError: true };
    started = true;
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), MAX_RUN_WALL_MS);
    try {
      const outcome = await runPinnedProjectEval(selection, target, controller.signal);
      // The receipt's private local path is kept on disk, not sent to the model provider.
      const { receiptPath: _receiptPath, ...visible } = outcome;
      const content = [{ type: "text" as const, text: JSON.stringify(visible) }];
      return { content, structuredContent: visible, ...(outcome.ok ? {} : { isError: true }) };
    } catch (error) {
      process.stderr.write(`assistant-mcp: project evaluation failed before a review receipt: ${error instanceof Error ? error.message : String(error)}\n`);
      const visible = { error: "evaluation-unavailable", detail: "The selected project evaluation could not produce a Review receipt. Inspect the local garden and Docker runtime." };
      return { content: [{ type: "text" as const, text: JSON.stringify(visible) }], structuredContent: visible, isError: true };
    } finally { clearTimeout(timer); controller = null; }
  }));
  return () => controller?.abort();
}
