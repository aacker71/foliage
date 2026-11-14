/**
 * THE LOCAL MODEL, ASKED OVER LOOPBACK — `POST /api/chat` on an Ollama runtime, streamed, with every
 * way it can fail named and the private deliberation dropped.
 *
 * The edge of this app. The two pure parts — reading the configuration out of an environment map
 * and reading one NDJSON line — are separate functions with their own tests, so what is tested
 * without a socket is exactly what is used with one.
 *
 * WHICH WIRE THIS SPEAKS (measured against Ollama 0.32.5 on 2026-09-02):
 * the request is `{ model, messages, stream: true, think: false }`; the answer is
 * `application/x-ndjson`, one object per line, `{"message":{"role":"assistant","content":"…"},"done":false}`
 * per delta and a final `{"message":{…,"content":""},"done":true,"done_reason":"stop",…}`.
 * `think: false` is sent because a thinking model otherwise streams `message.thinking` deltas that
 * spend the budget before any answer arrives; `message.thinking` is still dropped if it appears,
 * because a model's private deliberation is not the person's answer and is never written anywhere.
 *
 * WHICH ADDRESS THIS OPENS. `loopbackFetch` decides, on the parsed URL, and refuses anything but
 * `127.0.0.1` — the base URL is configuration, the loopback rule is policy. `redirect: "manual"`
 * there means a 3xx is refused rather than followed, so a socket somebody planted on a trusted port
 * cannot move the person's leaf elsewhere.
 *
 * WHAT NEVER RE-ENTERS A PROMPT OR A MESSAGE: the runtime's own body text. A non-2xx is reported
 * by STATUS only (BUG-002 posture); the one exception is a 404, whose meaning is measured — the
 * model is not installed — and whose message names the model we asked for, not what the runtime said.
 * A 200 whose lines are not the NDJSON above is named by SHAPE — what was wrong with the line and
 * how long it was — never by quoting it: a line that is not JSON is exactly the one a planted
 * socket would use to carry text, and `JSON.parse`'s own message quotes the input too.
 *
 * Same environment names as `apps/cos/src/localModel.ts`, not imported from it: `apps/cos` is
 * another app, and a relative import across apps is outside this app's `rootDir`.
 */

import type { ChatMessage } from "./scarletPrompt.ts";
import { loopbackFetch } from "./loopbackFetch.ts";

export const LOCAL_MODEL_ENV = "FOLIAGE_LOCAL_MODEL";
/** Exported for its test. */
export const LOCAL_MODEL_BASE_URL_ENV = "FOLIAGE_LOCAL_MODEL_BASE_URL";
/** Where an Ollama runtime listens by default. Loopback, so it passes the egress gate on its own. Exported for its test. */
export const LOCAL_MODEL_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
/**
 * harvest.mjs's drafting ceiling; a cold model on this machine has been measured at 39.2 s there.
 * Exported so `scarletPage.ts` can say the ceiling out loud from the one number that enforces it.
 */
export const MODEL_CEILING_MS = 180_000;
const CHAT_PATH = "/api/chat";

export interface ModelConfig {
  readonly model: string;
  readonly baseUrl: string;
}

export type ModelConfigResult =
  | { readonly ok: true; readonly config: ModelConfig }
  | { readonly ok: false; readonly cause: "no-model-declared" };

/**
 * Pure: the environment is a parameter. No default model, ever — a server that named one the
 * person may not have pulled would be claiming a capability it has not got. The base URL does
 * default, because a runtime's port is a fact about Ollama and not about the person.
 */
export function resolveModelConfig(env: Readonly<Record<string, string | undefined>>): ModelConfigResult {
  const model = (env[LOCAL_MODEL_ENV] ?? "").trim();
  if (model === "") return { ok: false, cause: "no-model-declared" };
  const declaredBase = (env[LOCAL_MODEL_BASE_URL_ENV] ?? "").trim();
  const baseUrl = (declaredBase === "" ? LOCAL_MODEL_DEFAULT_BASE_URL : declaredBase).replace(/\/+$/, "");
  return { ok: true, config: { model, baseUrl } };
}

/** The exact URL a run calls — what the provenance event carries. */
export const chatEndpoint = (config: ModelConfig): string => `${config.baseUrl}${CHAT_PATH}`;

export type ModelFailure =
  | { readonly cause: "not-loopback"; readonly host: string }
  | { readonly cause: "malformed-endpoint" }
  | { readonly cause: "redirected"; readonly status: number }
  | { readonly cause: "no-runtime"; readonly detail: string }
  | { readonly cause: "model-absent"; readonly model: string }
  | { readonly cause: "runtime-refused"; readonly status: number }
  | { readonly cause: "timeout"; readonly afterMs: number }
  | { readonly cause: "malformed-response"; readonly detail: string }
  | { readonly cause: "client-gone" };

export type StreamOutcome =
  | { readonly ok: true; readonly text: string; readonly doneReason: string | null }
  | { readonly ok: false; readonly failure: ModelFailure };

/* --------------------------------------------------------------------- one NDJSON line ---- */

export type ChatChunk =
  | { readonly kind: "delta"; readonly content: string }
  | { readonly kind: "done"; readonly content: string; readonly doneReason: string | null }
  | { readonly kind: "malformed"; readonly detail: string };

const malformed = (what: string, line: string): ChatChunk => ({ kind: "malformed", detail: `a line of ${line.length} characters is ${what}` });

/**
 * Pure. A `done:false` line is a delta of `message.content` — possibly `""`, which the caller skips;
 * `message.thinking` is not read. A `done:true` line ends the message, carries `done_reason`, and
 * carries its `message.content` too: measured as `""` on Ollama, but a runtime that put the last
 * word there would otherwise lose it unnoticed. Anything else is named as malformed by its shape.
 * Exported for its test.
 */
export function parseChatChunk(line: string): ChatChunk {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return malformed("not JSON", line);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return malformed("not a JSON object", line);
  const record = value as Record<string, unknown>;
  const done = record["done"] === true;
  const message = record["message"];
  if (typeof message !== "object" || message === null) {
    return done ? { kind: "done", content: "", doneReason: doneReasonOf(record) } : malformed("neither a message nor done", line);
  }
  const content = (message as Record<string, unknown>)["content"];
  if (content !== undefined && typeof content !== "string") return malformed("carrying a message.content that is not a string", line);
  return done ? { kind: "done", content: content ?? "", doneReason: doneReasonOf(record) } : { kind: "delta", content: content ?? "" };
}

const doneReasonOf = (record: Record<string, unknown>): string | null => {
  const reason = record["done_reason"];
  return typeof reason === "string" ? reason : null;
};

/* ------------------------------------------------------------------------- the stream ---- */

/** The fetch was aborted: by the caller's signal (the client left) or, if not that, by the ceiling. */
const abortedOutcome = (caller: AbortSignal): StreamOutcome => ({
  ok: false,
  failure: caller.aborted ? { cause: "client-gone" } : { cause: "timeout", afterMs: MODEL_CEILING_MS },
});

/**
 * Ask the model and hand every non-empty delta to `onDelta` as it arrives. Resolves with the whole
 * text and `done_reason`, or with the failure named. Never throws on its own account; what `onDelta`
 * throws passes straight through, because that is the caller's bug and not the runtime's.
 *
 * The caller's `signal` is the client's socket closing; the ceiling is this module's. Either aborts
 * the fetch, and which one it was is which signal is aborted: the caller's, or only the combined one.
 */
export async function streamChat(
  config: ModelConfig,
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<StreamOutcome> {
  const combined = AbortSignal.any([AbortSignal.timeout(MODEL_CEILING_MS), signal]);
  const fetched = await loopbackFetch(chatEndpoint(config), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, stream: true, think: false }),
    signal: combined,
  });

  if (!fetched.ok) {
    const failure = fetched.failure;
    switch (failure.cause) {
      case "not-loopback":
        return { ok: false, failure: { cause: "not-loopback", host: failure.host } };
      case "malformed-endpoint":
        return { ok: false, failure: { cause: "malformed-endpoint" } };
      case "redirected":
        return { ok: false, failure: { cause: "redirected", status: failure.status } };
      case "unreachable":
        return combined.aborted ? abortedOutcome(signal) : { ok: false, failure: { cause: "no-runtime", detail: failure.detail } };
      default: {
        const unhandled: never = failure;
        return { ok: false, failure: { cause: "malformed-response", detail: `unhandled fetch failure ${JSON.stringify(unhandled)}` } };
      }
    }
  }

  const response = fetched.response;
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, failure: { cause: "model-absent", model: config.model } };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, failure: { cause: "runtime-refused", status: response.status } };
  }
  if (response.body === null) return { ok: false, failure: { cause: "malformed-response", detail: "the response carried no body" } };

  const parts: string[] = [];
  let pending = "";
  const decoder = new TextDecoder();

  const handOut = (content: string): void => {
    if (content === "") return;
    parts.push(content);
    onDelta(content);
  };

  /** One complete line → delta handed out, done reason, or the failure. */
  const consume = (line: string): StreamOutcome | null => {
    if (line.trim() === "") return null;
    const chunk = parseChatChunk(line);
    switch (chunk.kind) {
      case "delta":
        handOut(chunk.content);
        return null;
      case "done":
        handOut(chunk.content);
        return { ok: true, text: parts.join(""), doneReason: chunk.doneReason };
      case "malformed":
        return { ok: false, failure: { cause: "malformed-response", detail: chunk.detail } };
      default: {
        const unhandled: never = chunk;
        return { ok: false, failure: { cause: "malformed-response", detail: `unhandled chunk ${JSON.stringify(unhandled)}` } };
      }
    }
  };

  // Only the read is guarded: a socket that breaks or an abort is the runtime's or the client's
  // doing and is named as such; anything thrown while a line is consumed is this process's own.
  const reader = response.body.getReader();
  for (;;) {
    let read: Awaited<ReturnType<typeof reader.read>>;
    try {
      read = await reader.read();
    } catch (err) {
      if (combined.aborted) return abortedOutcome(signal);
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, failure: { cause: "malformed-response", detail: `the stream broke: ${detail}` } };
    }
    if (read.done) break;
    pending += decoder.decode(read.value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const outcome = consume(line);
      if (outcome !== null) {
        await reader.cancel().catch(() => undefined);
        return outcome;
      }
    }
  }
  const last = consume(pending + decoder.decode());
  if (last !== null) return last;
  return { ok: false, failure: { cause: "malformed-response", detail: "the stream ended without a done:true line" } };
}
