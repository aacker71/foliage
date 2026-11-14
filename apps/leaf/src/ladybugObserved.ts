/** Operational metadata only. Questions, answers, source paths and evidence never enter this record. */
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { runScarlet } from "./scarletRun.ts";

type Args = Parameters<typeof runScarlet>[0];
export interface LadybugDiagnostic {
  readonly schema: "foliage.photosynthesis.run.v1";
  readonly traceId: string;
  readonly runKey: string;
  readonly at: string;
  readonly context: string;
  readonly status: "answered" | "refused" | "abandoned" | "error";
  readonly durationMs: number;
  readonly code?: string;
}
/** Both the SSE and form routes use the same observation boundary. No new network calls. */
export async function runObservedScarlet(args: Args,
  record: (value: LadybugDiagnostic) => void = (value) => console.info(JSON.stringify(value)),
): ReturnType<typeof runScarlet> {
  const start = performance.now();
  const base = {
    schema: "foliage.photosynthesis.run.v1" as const, traceId: randomUUID(),
    runKey: createHash("sha256").update(args.input.runId).digest("hex"), at: new Date().toISOString(),
    context: args.input.selection?.tool.name ?? "leaf",
  };
  let terminal: Pick<LadybugDiagnostic, "status" | "code"> = { status: "error", code: "runner-error" };
  try {
    const outcome = await runScarlet(args);
    terminal = { status: outcome.kind, ...(outcome.kind === "refused" ? { code: outcome.code } : {}) };
    return outcome;
  } finally {
    try { record({ ...base, ...terminal, durationMs: Math.round(performance.now() - start) }); }
    catch { console.error("[leaf] Photosynthesis diagnostic could not be recorded."); }
  }
}
