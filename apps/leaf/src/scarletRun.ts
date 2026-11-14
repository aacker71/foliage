/**
 * ONE SCARLET RUN — the sequence of AG-UI events for one question, from `RUN_STARTED` to either
 * `RUN_FINISHED` or a terminal `RUN_ERROR`, over any sink.
 *
 * This is the single runner: the SSE route in `server.mjs` gives it a socket-writing sink, and the
 * page (PR2) will give it a collecting one. The model call is injected (`stream`) so the sequence
 * can be exercised without a socket; ids and the abort signal come from the edge, so this module
 * holds no clock and no randomness.
 *
 * ORDER IS ENFORCED, NOT DESCRIBED. Every `emit` passes through `advance()` first, and a violation
 * THROWS — a wrong sequence is a bug in this file, not an expected failure, so it is the one place
 * an exception is right. The route catches it, ends the stream and prints one line; the seam test
 * replays every captured stream through the same `advance()` and proves the throw never happens.
 *
 * WHAT IS SAID BEFORE THE MODEL IS ASKED, in order: the grounding (integers and reasons — what the
 * model was given), then the provenance (which runtime, which model, which exact URL). Neither is
 * emitted for a run that never reaches that point: a leaf that did not load has no grounding, and a
 * configuration that names no usable endpoint has no provenance.
 *
 * A CLIENT THAT LEAVES gets nothing more. The signal aborts the model fetch, the run resolves
 * `abandoned`, and no event is emitted after — the sink's own guard is the second line, this
 * outcome is the first.
 */

import {
  RUN_IDLE,
  advance,
  type AgUiEvent,
  type GroundingReport,
  type RunAgentInput,
  type RunErrorCode,
  type RunPhase,
} from "./agui.ts";
import type { LeafLoad } from "./leafDocument.ts";
import { leafLoadProblem } from "./loadLabels.ts";
import { chatEndpoint, type ModelConfigResult, type ModelFailure, type streamChat } from "./scarletModel.ts";
import { chatMessagesFor, groundingFor, workflowGrounding } from "./scarletPrompt.ts";
import { loopbackHostOf } from "./loopbackFetch.ts";
import { runScarletTool, type ScarletSelection, type ScarletContextRead } from "./scarletTools.ts";
import { reviewScarletAnswer } from "./scarletAnswerReview.ts";

export interface RunIds {
  /** Minted at the edge for the one assistant message a run produces. */
  readonly messageId: string;
}

export type RunSink = (event: AgUiEvent) => void;

export type RunOutcome =
  | { readonly kind: "answered"; readonly text: string; readonly doneReason: string | null }
  | { readonly kind: "refused"; readonly code: RunErrorCode; readonly message: string }
  | { readonly kind: "abandoned" };

interface Refusal {
  readonly code: RunErrorCode;
  readonly message: string;
}

/**
 * The loader's words for a leaf that did not load, for `scarletPage.ts`'s closed Technical details.
 * A run refuses with `leafLoadProblem` instead: the stream shows its message as visible status.
 */
export const leafUnavailableMessage = (leaf: Extract<LeafLoad, { ok: false }>): string => `${leaf.cause} — ${leaf.detail}`;
/** The words for no model declared. `scarletPage.ts` says the same on GET, so the person learns before asking. */
export const NO_MODEL_MESSAGE = "No local model selected. Choose one at /scarlet/setup.";

/** The wire words for each model failure. Status only for a refusal; the runtime's body never appears. */
function refusalFor(failure: Exclude<ModelFailure, { cause: "client-gone" }>): Refusal {
  switch (failure.cause) {
    case "not-loopback":
      return { code: "not-loopback", message: `the model base URL names ${failure.host}; this server talks only to 127.0.0.1` };
    case "malformed-endpoint":
      return { code: "malformed-endpoint", message: "the model base URL could not be parsed" };
    case "redirected":
      return { code: "redirected", message: `the runtime answered HTTP ${failure.status}, a redirect, which was not followed` };
    case "no-runtime":
      return { code: "no-runtime", message: failure.detail };
    case "model-absent":
      return { code: "model-absent", message: `model ${failure.model} is not installed — ollama list shows what is` };
    case "runtime-refused":
      return { code: "runtime-refused", message: `the runtime answered HTTP ${failure.status}` };
    case "timeout":
      return { code: "timeout", message: `the model did not finish within ${failure.afterMs} ms` };
    case "malformed-response":
      return { code: "malformed-response", message: failure.detail };
    default: {
      const unhandled: never = failure;
      throw new Error(`unhandled model failure ${JSON.stringify(unhandled)}`);
    }
  }
}

export async function runScarlet(args: {
  readonly input: RunAgentInput;
  readonly leaf: LeafLoad;
  readonly model: ModelConfigResult;
  readonly ids: RunIds;
  readonly signal: AbortSignal;
  readonly emit: RunSink;
  readonly stream: typeof streamChat;
  readonly resolveContext?: (selection: ScarletSelection) => Promise<ScarletContextRead>;
}): Promise<RunOutcome> {
  const { input, leaf, model, ids, signal } = args;
  let phase: RunPhase = RUN_IDLE;
  const emit = (event: AgUiEvent): void => {
    const step = advance(phase, event);
    if (!step.ok) throw new Error(`AG-UI ordering violation: ${step.violation}`);
    phase = step.next;
    args.emit(event);
  };
  const refuse = (refusal: Refusal): RunOutcome => {
    emit({ type: "RUN_ERROR", message: refusal.message, code: refusal.code });
    return { kind: "refused", ...refusal };
  };

  emit({ type: "RUN_STARTED", threadId: input.threadId, runId: input.runId });

  const workflow = input.selection?.tool.name === "read_workflow";
  if (!leaf.ok && !workflow) return refuse({ code: "leaf-unavailable", message: leafLoadProblem(leaf) });

  if (signal.aborted) return { kind: "abandoned" };
  if (!workflow && leaf.ok && input.selection !== undefined && input.selection.documentDigest !== leaf.source.documentDigest) {
    return refuse({ code: "leaf-unavailable", message: "The leaf changed since this workspace opened. Reload to inspect the current evidence before asking again." });
  }
  const read = input.selection === undefined ? undefined : args.resolveContext === undefined
    ? workflow || !leaf.ok ? { ok: false as const, why: "Workflow packet resolver unavailable." }
      : { ok: true as const, context: runScarletTool(leaf.leaf, leaf.source.documentDigest, input.selection.tool) }
    : await args.resolveContext(input.selection);
  if (signal.aborted) return { kind: "abandoned" };
  if (read !== undefined && !read.ok) return refuse({ code: "leaf-unavailable", message: read.why });
  const context = read?.context;
  if (context !== undefined && context.documents.length === 0) {
    return refuse({ code: "leaf-unavailable", message: "No readable leaflet matches this selection. Return to My Leaf or change the search." });
  }
  const grounding = workflow && context ? workflowGrounding(context) : leaf.ok ? groundingFor(leaf.leaf, leaf.source, context) : undefined;
  if (!grounding) return refuse({ code: "leaf-unavailable", message: "No readable context was supplied." });
  const report: GroundingReport = {
    ...(context === undefined ? {} : { context }),
    subject: grounding.subject,
    declaredExample: grounding.declaredExample,
    verified: grounding.verified,
    pending: grounding.pending,
    excluded: grounding.excluded,
    exclusionReasons: grounding.exclusionReasons,
    titlesListed: grounding.titles.length,
    titlesOmitted: grounding.notListed,
    ignored: input.ignored,
  };
  emit({ type: "CUSTOM", name: "foliage.grounding", value: report });

  if (!model.ok) return refuse({ code: "no-model-declared", message: NO_MODEL_MESSAGE });

  // The endpoint is judged before it is named: a base URL this server would refuse to open has
  // no provenance to report. `loopbackFetch` judges it again at the socket — policy, twice.
  const endpoint = chatEndpoint(model.config);
  const host = loopbackHostOf(endpoint);
  // `EndpointFailure` is two members of `ModelFailure` by shape, so the failure is handed on as it
  // is; the type carries that no third cause is folded into either.
  if (!host.ok) return refuse(refusalFor(host.failure));
  emit({ type: "CUSTOM", name: "foliage.provenance", value: { runtime: "ollama", model: model.config.model, endpoint } });

  // The message opens on the FIRST delta, not before the model is asked: a runtime that refuses
  // outright leaves no half-open message behind, and the verifier permits RUN_ERROR mid-message
  // for the failures that arrive after the first word.
  let opened = false;
  const open = (): void => {
    if (opened) return;
    opened = true;
    emit({ type: "TEXT_MESSAGE_START", messageId: ids.messageId, role: "assistant" });
  };
  const outcome = await args.stream(model.config, chatMessagesFor(grounding, input.messages), signal, (delta) => {
    if (signal.aborted) return;
    open();
    emit({ type: "TEXT_MESSAGE_CONTENT", messageId: ids.messageId, delta });
  });

  if (signal.aborted) return { kind: "abandoned" };
  if (!outcome.ok) {
    if (outcome.failure.cause === "client-gone") return { kind: "abandoned" };
    return refuse(refusalFor(outcome.failure));
  }
  open();
  emit({ type: "TEXT_MESSAGE_END", messageId: ids.messageId });
  if (context !== undefined) emit({ type: "CUSTOM", name: "foliage.answer-review", value: reviewScarletAnswer(outcome.text, context) });
  emit({ type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId });
  return { kind: "answered", text: outcome.text, doneReason: outcome.doneReason };
}
