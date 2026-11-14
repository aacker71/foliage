import { readScarletSelection, type ScarletSelection, type ScarletContext } from "./scarletTools.ts";
import type { ScarletAnswerReview } from "./scarletAnswerReview.ts";

/**
 * THE AG-UI SLICE THIS SERVER SPEAKS — the events it emits, the frame it writes them in, the
 * input it accepts, and the ordering the protocol's own verifier enforces.
 *
 * Pure: no `node:` imports, no clock, no randomness. Every id comes in from the edge. The point of
 * holding the ordering rules as DATA (`advance`) rather than as comments beside `res.write` calls
 * is that the same function guards the live stream in `scarletRun.ts` and re-checks every captured
 * stream in the seam test, so "the server speaks the protocol" is one function with two callers,
 * not a claim.
 *
 * WHAT IS VERIFIED AGAINST THE SDK SOURCE (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`):
 *   - the frame: `data: ${JSON.stringify(event)}\n\n`, the encoder's own spelling. The client's
 *     SSE parser splits on a blank line, reads ONLY `data:` lines and JSON-parses them — so no
 *     `event:`/`id:` lines are ever written here; they would be ignored at best.
 *   - `timestamp`, `rawEvent` and `metadata` are optional on every event and MUST be omitted, never
 *     `null`: the metadata schema rejects null outright. No member of `AgUiEvent` carries them.
 *   - `RUN_ERROR` is `{ message, code? }`; `CUSTOM` is `{ name, value }` and is passthrough for the
 *     verifier, which is why the two Foliage facts (grounding, provenance) ride on it rather than on
 *     `RUN_STARTED.metadata` — an open record whose consumers are undefined.
 *   - `RunAgentInput`: `threadId`/`runId` strings, `messages` an array discriminated on `role`, and
 *     a user message's `content` either a string or an array of parts, of which only `text` is
 *     something a text model can be handed.
 *
 * WHAT THIS SLICE DOES NOT DO. No tools, no state, no steps, no thinking events, no more than one
 * run per stream. Client messages this server does not forward (`system`, `developer`, `tool`,
 * the schema's `activity` and `reasoning`, any role a later schema adds, assistant tool calls,
 * `tools[]`) are ACCEPTED, COUNTED and reported in the grounding event — never refused, because a
 * CopilotKit runtime that prepends its own system message, or a thread that carries another agent's
 * reasoning, must still attach unchanged. Only a structurally unreadable input is refused, and the
 * refusal names where.
 */

/**
 * Why a run could not be answered. One name per cause, and the name is the whole contract with the
 * page (PR2) and with any client: `RUN_ERROR.code` is this string, nothing else. A client that left
 * is not here: it gets no event at all, so there is no code for it.
 */
export type RunErrorCode =
  | "no-model-declared"
  | "not-loopback"
  | "malformed-endpoint"
  | "redirected"
  | "no-runtime"
  | "model-absent"
  | "timeout"
  | "runtime-refused"
  | "malformed-response"
  | "leaf-unavailable";

/**
 * Which parts of the client's input were accepted but not forwarded to the model. Counts only.
 * `other` is every message whose role is none of the ones named here — `activity`, `reasoning`,
 * or a role this server has never heard of.
 */
export interface IgnoredInput {
  readonly tools: number;
  readonly system: number;
  readonly developer: number;
  readonly tool: number;
  readonly other: number;
  readonly toolCalls: number;
}

/**
 * What the model was given, said in integers. Three tier counts that are a GROUPING, not an order;
 * never a ratio, never a total that invites one. `titlesListed`/`titlesOmitted` name the ceiling
 * out loud so a client can say "answered from 120 of 235 titles" only by doing that arithmetic
 * itself, and owning it.
 */
export interface GroundingReport {
  /** Bounded server-executed read tool output for the contextual workspace. */
  readonly context?: ScarletContext;
  readonly subject: string;
  readonly declaredExample: boolean;
  readonly verified: number;
  readonly pending: number;
  readonly excluded: number;
  readonly exclusionReasons: readonly string[];
  readonly titlesListed: number;
  readonly titlesOmitted: number;
  readonly ignored: IgnoredInput;
}

/** Which runtime and model are about to be asked, and the exact URL — the full `/api/chat` one. */
export interface Provenance {
  readonly runtime: "ollama";
  readonly model: string;
  readonly endpoint: string;
}

export type AgUiEvent =
  | { readonly type: "RUN_STARTED"; readonly threadId: string; readonly runId: string }
  | { readonly type: "RUN_FINISHED"; readonly threadId: string; readonly runId: string }
  | { readonly type: "RUN_ERROR"; readonly message: string; readonly code: RunErrorCode }
  | { readonly type: "TEXT_MESSAGE_START"; readonly messageId: string; readonly role: "assistant" }
  | { readonly type: "TEXT_MESSAGE_CONTENT"; readonly messageId: string; readonly delta: string }
  | { readonly type: "TEXT_MESSAGE_END"; readonly messageId: string }
  | { readonly type: "CUSTOM"; readonly name: "foliage.grounding"; readonly value: GroundingReport }
  | { readonly type: "CUSTOM"; readonly name: "foliage.answer-review"; readonly value: ScarletAnswerReview }
  | { readonly type: "CUSTOM"; readonly name: "foliage.provenance"; readonly value: Provenance };

/** One SSE frame, spelled exactly as the SDK's encoder spells it. */
export const encodeSse = (event: AgUiEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/* ---------------------------------------------------------------------------- inbound ---- */

/** A message this server forwards to the model. The two roles a text model is answered with. */
export interface RunInputMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface RunAgentInput {
  readonly selection?: ScarletSelection;
  readonly threadId: string;
  readonly runId: string;
  /** In the client's order, with the roles this server does not forward already removed. */
  readonly messages: readonly RunInputMessage[];
  /** What was removed, counted, so the grounding event can say so. */
  readonly ignored: IgnoredInput;
}

export type RunInputParse =
  | { readonly ok: true; readonly input: RunAgentInput }
  | { readonly ok: false; readonly at: string; readonly why: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refuse = (at: string, why: string): RunInputParse => ({ ok: false, at, why });

type ContentRead = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly at: string; readonly why: string };

/**
 * A message's `content`: a string, an array of `{type:"text", text}` parts joined by newlines, or
 * absent (an assistant turn that was only tool calls). Any other part is refused BY POSITION —
 * an image silently dropped would make the model answer a question it never saw.
 */
function readContent(content: unknown, at: string): ContentRead {
  if (content === undefined || content === null) return { ok: true, text: "" };
  if (typeof content === "string") return { ok: true, text: content };
  if (!Array.isArray(content)) return { ok: false, at, why: "content must be a string or an array of parts" };
  const texts: string[] = [];
  for (const [j, part] of content.entries()) {
    const where = `${at}[${j}]`;
    if (!isRecord(part)) return { ok: false, at: where, why: "a content part must be an object" };
    if (part["type"] !== "text") {
      const kind = typeof part["type"] === "string" ? part["type"] : "(untyped)";
      return { ok: false, at: where, why: `${kind} content is not accepted; this run reads text only` };
    }
    if (typeof part["text"] !== "string") return { ok: false, at: where, why: "a text part must carry a string text" };
    texts.push(part["text"]);
  }
  return { ok: true, text: texts.join("\n") };
}

/**
 * Strict where the SDK's own client is strict; lenient where a hand-rolled client plausibly
 * differs. `tools`, `context`, `forwardedProps`, `state`, `parentRunId`, `resume` may be present in
 * any shape or absent — nothing here reads them, so nothing here refuses them. `tools` is counted.
 */
export function parseRunAgentInput(value: unknown): RunInputParse {
  if (!isRecord(value)) return refuse("(body)", "the body must be a JSON object");
  const selection = readScarletSelection(value["forwardedProps"]);
  if (!selection.ok) return refuse("forwardedProps", selection.why);
  const threadId = value["threadId"];
  if (typeof threadId !== "string" || threadId === "") return refuse("threadId", "a non-empty string is required");
  const runId = value["runId"];
  if (typeof runId !== "string" || runId === "") return refuse("runId", "a non-empty string is required");
  const messages = value["messages"];
  if (!Array.isArray(messages)) return refuse("messages", "an array is required");

  const forwarded: RunInputMessage[] = [];
  const ignored = { tools: Array.isArray(value["tools"]) ? value["tools"].length : 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 };

  for (const [i, message] of messages.entries()) {
    const at = `messages[${i}]`;
    if (!isRecord(message)) return refuse(at, "a message must be an object");
    const id = message["id"];
    if (typeof id !== "string") return refuse(`${at}.id`, "a string id is required");
    const role = message["role"];
    if (typeof role !== "string") return refuse(`${at}.role`, "a string role is required");

    // A role is a string, not a union: the schema has grown before (`activity`, `reasoning`) and
    // will again, and a message this server does not forward is counted, never refused.
    switch (role) {
      case "system":
        ignored.system += 1;
        break;
      case "developer":
        ignored.developer += 1;
        break;
      case "tool":
        ignored.tool += 1;
        break;
      case "assistant":
      case "user": {
        const toolCalls = message["toolCalls"];
        if (Array.isArray(toolCalls)) ignored.toolCalls += toolCalls.length;
        const content = readContent(message["content"], `${at}.content`);
        if (!content.ok) return refuse(content.at, content.why);
        // An assistant turn that was only tool calls has nothing to forward; the calls are counted.
        if (role === "assistant" && content.text === "") break;
        forwarded.push({ id, role, content: content.text });
        break;
      }
      default:
        ignored.other += 1;
    }
  }

  if (!forwarded.some((m) => m.role === "user")) return refuse("messages", "no user message to answer");
  return { ok: true, input: { threadId, runId, messages: forwarded, ignored,
    ...(selection.selection === undefined ? {} : { selection: selection.selection }) } };
}

/* --------------------------------------------------------------------------- ordering ---- */

export type RunPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly openMessage: string | null }
  | { readonly phase: "finished" }
  | { readonly phase: "errored" };

export type Advance =
  | { readonly ok: true; readonly next: RunPhase }
  | { readonly ok: false; readonly violation: string };

export const RUN_IDLE: RunPhase = { phase: "idle" };

const RUNNING_CLOSED: RunPhase = { phase: "running", openMessage: null };

const violation = (text: string): Advance => ({ ok: false, violation: text });
const next = (phase: RunPhase): Advance => ({ ok: true, next: phase });

/**
 * The verifier's rules for the events this server emits, as one total function.
 *
 * Mirrors `@ag-ui/client`'s `verifyEvents`: the first event is `RUN_STARTED`; a second
 * `RUN_STARTED` during an active run is refused; a text message must be opened before content or
 * end for that id, and only one is ever open here; `RUN_FINISHED` refuses while a message is open;
 * `RUN_ERROR` is allowed at any time, even mid-message; nothing follows `RUN_FINISHED` except a new
 * `RUN_STARTED`. Where this is STRICTER than the verifier it is because this server never needs the
 * freedom: nothing at all after `RUN_ERROR` (the stream is ended right after it), and a content
 * event with an empty delta is refused — an empty delta says nothing, and older schema versions
 * rejected it.
 */
export function advance(state: RunPhase, event: AgUiEvent): Advance {
  switch (state.phase) {
    case "idle":
      return event.type === "RUN_STARTED"
        ? next(RUNNING_CLOSED)
        : violation(`${event.type} before RUN_STARTED — the first event must be RUN_STARTED`);
    case "finished":
      return event.type === "RUN_STARTED"
        ? next(RUNNING_CLOSED)
        : violation(`${event.type} after RUN_FINISHED — only a new RUN_STARTED may follow`);
    case "errored":
      return violation(`${event.type} after RUN_ERROR — no further events can be sent`);
    case "running":
      return advanceRunning(state.openMessage, event);
    default: {
      const unhandled: never = state;
      return violation(`unhandled phase ${JSON.stringify(unhandled)}`);
    }
  }
}

function advanceRunning(openMessage: string | null, event: AgUiEvent): Advance {
  switch (event.type) {
    case "RUN_STARTED":
      return violation("RUN_STARTED while a run is still active");
    case "RUN_ERROR":
      return next({ phase: "errored" });
    case "CUSTOM":
      return next({ phase: "running", openMessage });
    case "TEXT_MESSAGE_START":
      return openMessage === null
        ? next({ phase: "running", openMessage: event.messageId })
        : violation(`TEXT_MESSAGE_START while message ${openMessage} is still open`);
    case "TEXT_MESSAGE_CONTENT":
      if (openMessage !== event.messageId) return violation(`TEXT_MESSAGE_CONTENT for ${event.messageId}, which is not open`);
      if (event.delta === "") return violation(`TEXT_MESSAGE_CONTENT for ${event.messageId} with an empty delta`);
      return next({ phase: "running", openMessage });
    case "TEXT_MESSAGE_END":
      return openMessage === event.messageId
        ? next(RUNNING_CLOSED)
        : violation(`TEXT_MESSAGE_END for ${event.messageId}, which is not open`);
    case "RUN_FINISHED":
      return openMessage === null
        ? next({ phase: "finished" })
        : violation(`RUN_FINISHED while message ${openMessage} is still open`);
    default: {
      const unhandled: never = event;
      return violation(`unhandled event ${JSON.stringify(unhandled)}`);
    }
  }
}
