/**
 * TIER 3 — the escalation call, and the only code in this app that leaves the machine.
 *
 * Spec §3 (docs/PRODUCT-ARCHITECTURE-SPEC.md): Fireworks, zero data retention, `store=false`
 * "explicitly configured (not assumed as platform default)". §10.2 and §10.3 named this file in
 * advance as the place two of the repository's constitutional claims either survive or die —
 * "zero network calls" and "zero third-party runtime dependencies". Both are kept here in the
 * only way that is checkable: this is a client on the GLOBAL `fetch`, with no SDK, no npm
 * package, and no import at all. Nothing is imported because nothing needs to be; `fetch`,
 * `AbortSignal` and `process` are Node 22 globals (verified on v22.23.1, this machine).
 *
 * WHAT THIS FILE CANNOT DO, BY CONSTRUCTION. It cannot see the material policy withheld. Its
 * input is a rendered message list — `{ role, content }` strings — handed to it by the router
 * AFTER the egress rule has already run. There is no context object here, no item list, no
 * classification, and therefore no second filter that could drift out of step with the first
 * one. Two gates in two places is how a privacy boundary quietly stops holding: the one nobody
 * is looking at is the one that gets a new field added to it. There is exactly one gate, and it
 * is not in this file. What arrives here goes out; what did not arrive here cannot.
 *
 * The request body has FIVE keys and they are enumerated in `buildRequestBody`: `model`,
 * `messages`, `max_tokens`, `temperature`, `store`. The test asserts that exact key set against
 * the bytes a real HTTP server received, so a sixth key cannot be added without a test failing
 * — which is the mechanical version of "the client is unable to send what it was not given".
 *
 * `store: false` IS SENT, AND THAT IS A DIFFERENT CLAIM FROM "THE PROVIDER DOES NOT RETAIN".
 * Sending the field is the part this code controls and the part the test proves. Whether the
 * provider honours it is contractual (Fireworks' DPA, per §3) and cannot be established from
 * inside a client — no response field reports it. Stating it that way is deliberate: "we set
 * store=false" is honest and checkable, "the provider retains nothing" is a promise someone
 * else makes. If the provider ever rejected the field, that surfaces as `provider-refused`
 * carrying the provider's own message, never as a silent drop.
 *
 * THERE IS NO API KEY IN THIS ENVIRONMENT. So the path this repository can demonstrate today is
 * the refusal: with nothing configured, `callFireworks` returns `no-credential` naming the
 * variable that is absent, and the router shows an honest empty state that is visibly a
 * different thing from a policy refusal. The success path above is real code against the real
 * endpoint — there is no stub, no canned reply, and no fixture wearing a model's clothes. The
 * colocated tests that exercise a 200 do it against a throwaway local `node:http` server and
 * SAY SO IN THEIR NAMES: they prove this file's transport and parsing, and they are not
 * evidence that any model works. A test against a fake server proves the pipe, not the water.
 *
 * THE CAUSES DO NOT COLLAPSE. Six of them, each naming a fact this code actually observed:
 *
 *   no-credential        nothing is configured to authenticate with; names the missing variable
 *   no-model             a credential exists but no model was declared — see below
 *   timeout              our own deadline fired; carries the deadline it fired at
 *   network-unreachable  the connection never produced a response; carries the OS-level detail
 *   provider-refused     a response arrived with a non-2xx status; carries the status AND the
 *                        provider's own message, plus where that message was read from
 *   malformed-response   2xx, and the body is not a completion this code can read
 *
 * `no-model` is separate from `no-credential` on purpose, and it is the sixth cause rather than
 * a fold into the fifth. They are different repairs — one is "give me a key", the other is
 * "tell me which model to call" — and a caller told "no credential" while holding a valid key
 * would go looking in the wrong place. Nor does a model id get a default: inventing one means
 * silently calling a model nobody chose, on someone else's bill, and a wrong-model answer is
 * indistinguishable from a right one at the call site. Absent means absent.
 *
 * A ZERO-LENGTH COMPLETION IS A SUCCESS. `{ state: "completed", completion: "" }`, never an
 * error. This is the failure-is-never-a-zero rule read in the other direction: a model that
 * answered with nothing has answered, and reporting that as a failure would make the caller
 * assert a transport problem it never observed. `choices: []` is a different fact — the
 * response carries no completion object at all — and that is `malformed-response`, with the
 * detail saying which.
 *
 * NOTHING HERE LOGS. No console call, no stdout or stderr write, no telemetry — the prompt, the
 * completion and the credential are never written anywhere by this file. Checked two ways:
 * grep the file (`grep -nE 'console|stdout|stderr' apps/cos/src/fireworks.ts` returns only this
 * paragraph), and a colocated test reads this file's own bytes and asserts the same. Comments
 * rot; the test does not. The credential is also kept out of every returned value — error
 * details carry the URL and the OS error code, and the Authorization header appears in exactly
 * one expression, `buildHeaders`.
 *
 * The credential comes from the ENVIRONMENT and from nowhere else. No file in the tree, no
 * default in code: AGENTS.md keeps no secrets in the tree and gitignores every `.env*` with no
 * negations, which is how the previous lineage ended up committing one.
 *
 * AND IT COMES FROM FOLIAGE'S OWN VARIABLE, NOT AN AMBIENT ONE. `FIREWORKS_API_KEY` is the name
 * the provider's own SDK and CLI read, so it is already exported on the machines of exactly the
 * people this product is for. If this file read that name, a person who had it set for something
 * unrelated would find the escalation path silently CONFIGURED — their assembled context leaving
 * the machine on an account they never pointed at Foliage, with no moment where they chose it.
 * That is the failure this whole slice exists to prevent, arriving through an environment
 * variable instead of through the router. So the names are `FOLIAGE_`-prefixed, an ambient
 * unprefixed one is DETECTED AND REPORTED RATHER THAN USED (`ignored` on the refusal, per the
 * detect-report-refuse rule), and the refusal names the variable that would actually work —
 * which is also what turns "I filled in the file and nothing happened" into one readable line.
 */

/** The variables this file reads. Reported to the app lane for `env.example`; no defaults here. */
export type FireworksVariable = "FOLIAGE_FIREWORKS_API_KEY" | "FOLIAGE_FIREWORKS_MODEL";

/**
 * Names that mean "a Fireworks setting for something else on this machine". Read only so they
 * can be named in a refusal; never used to configure anything. See the header.
 */
export const AMBIENT_FIREWORKS_VARIABLES: readonly string[] = [
  "FIREWORKS_API_KEY",
  "FIREWORKS_BASE_URL",
  "FIREWORKS_MODEL",
];

/**
 * The public serverless endpoint. A constant rather than a required variable because it is
 * documentation, not a secret — but overridable via `FOLIAGE_FIREWORKS_BASE_URL` so a test or a
 * dedicated deployment (spec §5) can point elsewhere without editing code.
 */
export const FIREWORKS_DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1";

/** Our own deadline, in ms, when the caller does not name one. */
export const FIREWORKS_DEFAULT_TIMEOUT_MS = 60_000;

export type FireworksRole = "system" | "user" | "assistant";

/**
 * One message, already rendered to text by the router. `content` is a string and not a
 * structured context because a structure is a thing this file could walk, and walking it is
 * how a second filter gets born.
 */
export interface FireworksMessage {
  readonly role: FireworksRole;
  readonly content: string;
}

/** Everything needed to reach the provider. Assembled from the environment, never from a file. */
export interface FireworksConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * The configuration, or the named variables that are absent — a discriminated union rather than
 * `FireworksConfig | null`, so "not configured" carries WHICH thing is missing all the way to
 * the surface a person reads. `packages/leaf/src/merge.ts` states the general form of this rule.
 */
export type FireworksConfigResult =
  | { readonly state: "configured"; readonly config: FireworksConfig }
  | {
      readonly state: "unconfigured";
      readonly missing: readonly FireworksVariable[];
      /** Ambient variables that are SET and were deliberately not used. Usually empty. */
      readonly ignored: readonly string[];
    };

/** The already-filtered payload. There is no field here that could carry a withheld item. */
export interface FireworksRequest {
  readonly messages: readonly FireworksMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  /** Our deadline. Distinct from `network-unreachable`: a deadline we set is our fact, not the network's. */
  readonly timeoutMs?: number;
}

/** Token accounting as the provider reported it. Every field nullable — a provider may omit any of them. */
export interface FireworksUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

/**
 * Where a `provider-refused` message came from, so "the provider said nothing" and "we could not
 * read what the provider said" are never the same sentence.
 */
export type ProviderMessageSource = "json-error-message" | "raw-body" | "unreadable";

/** The outcome. One state, one set of facts, no boolean and no number that could be read as a rank. */
export type FireworksResult =
  | {
      readonly state: "completed";
      /** May be `""`. That is an answer, not a failure. */
      readonly completion: string;
      readonly finishReason: string | null;
      readonly usage: FireworksUsage | null;
    }
  | {
      readonly state: "no-credential";
      readonly missing: readonly FireworksVariable[];
      readonly ignored: readonly string[];
    }
  | {
      readonly state: "no-model";
      readonly missing: readonly FireworksVariable[];
      readonly ignored: readonly string[];
    }
  | { readonly state: "timeout"; readonly afterMs: number }
  | { readonly state: "network-unreachable"; readonly detail: string }
  | {
      readonly state: "provider-refused";
      readonly status: number;
      /** The provider's own words, verbatim and truncated, never a sentence this code invented. */
      readonly providerMessage: string;
      readonly providerMessageSource: ProviderMessageSource;
    }
  | {
      /**
       * A hop we refused. F-002 was found and fixed on the LOCAL arm and this arm had the
       * identical exposure with worse stakes: here the material is already assembled for the
       * wire, so a redirect delivers it to a host that appears nowhere in the egress account the
       * person was shown — and `FOLIAGE_FIREWORKS_BASE_URL` is settable, so the hop need not come
       * from the real provider. `host` is `null` when the redirect named a destination we could
       * not parse; we refused it either way.
       */
      readonly state: "redirected";
      readonly status: number;
      readonly host: string | null;
    }
  | { readonly state: "malformed-response"; readonly detail: string };

import { inspectRedirect } from "./redirect.ts";

/** Cap on any provider text we carry, so an HTML error page cannot become the whole result. */
const PROVIDER_MESSAGE_MAX = 600;

/**
 * PURE. Takes the environment as a value rather than reaching for `process.env`, so the absent
 * case can be tested for real by passing `{}` — no global mutation, no test that only proves it
 * can delete a variable it just set.
 */
export function resolveFireworksConfig(
  env: Readonly<Record<string, string | undefined>>,
): FireworksConfigResult {
  const apiKey = nonEmpty(env["FOLIAGE_FIREWORKS_API_KEY"]);
  const model = nonEmpty(env["FOLIAGE_FIREWORKS_MODEL"]);
  const baseUrl = nonEmpty(env["FOLIAGE_FIREWORKS_BASE_URL"]) ?? FIREWORKS_DEFAULT_BASE_URL;

  const missing: FireworksVariable[] = [];
  if (apiKey === null) missing.push("FOLIAGE_FIREWORKS_API_KEY");
  if (model === null) missing.push("FOLIAGE_FIREWORKS_MODEL");
  if (apiKey === null || model === null) {
    const ignored = AMBIENT_FIREWORKS_VARIABLES.filter((name) => nonEmpty(env[name]) !== null);
    return { state: "unconfigured", missing, ignored };
  }

  return { state: "configured", config: { apiKey, baseUrl, model } };
}

/** The one place `process.env` is read. Everything below it takes the config as an argument. */
export function fireworksConfigFromEnvironment(): FireworksConfigResult {
  return resolveFireworksConfig(process.env);
}

/**
 * Make the call, or refuse with the cause. Never throws: a caller that has to wrap this in
 * try/catch would be handling failure in two shapes, and one of them always gets forgotten.
 *
 * Complexity is one round trip; the only allocation that scales is the request body, which is
 * O(total message characters).
 */
export async function callFireworks(
  request: FireworksRequest,
  configResult: FireworksConfigResult,
): Promise<FireworksResult> {
  if (configResult.state === "unconfigured") {
    const { missing, ignored } = configResult;
    return missing.includes("FOLIAGE_FIREWORKS_API_KEY")
      ? { state: "no-credential", missing, ignored }
      : { state: "no-model", missing, ignored };
  }

  const config = configResult.config;
  const timeoutMs = request.timeoutMs ?? FIREWORKS_DEFAULT_TIMEOUT_MS;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(config.apiKey),
      body: JSON.stringify(buildRequestBody(request, config.model)),
      /* The idiom already used in tools/verify/verify.mjs. An AbortSignal.timeout abort arrives
         as a TimeoutError, which is why the classifier below can tell our deadline apart from a
         dead network instead of guessing. */
      signal: AbortSignal.timeout(timeoutMs),
      /* NEVER FOLLOWED. undici defaults to `redirect: "follow"` and a 307/308 preserves the method
         AND the body, so without this the admitted material walks to whatever host the far end
         names. See ./redirect.ts — this is F-002, which was fixed on the local arm and left open
         here for a day. */
      redirect: "manual",
    });
  } catch (error) {
    return classifyTransportError(error, timeoutMs, "while opening the connection");
  }

  const hop = inspectRedirect(response, url, PROVIDER_MESSAGE_MAX);
  if (hop !== null) return { state: "redirected", status: hop.status, host: hop.host };

  if (!response.ok) {
    const read = await readBodyText(response);
    if (read.state === "unreadable") {
      return {
        state: "provider-refused",
        status: response.status,
        providerMessage: "",
        providerMessageSource: "unreadable",
      };
    }
    return refusalFrom(response.status, read.text);
  }

  const read = await readBodyText(response);
  if (read.state === "unreadable") {
    /* A 2xx whose body died mid-read is a transport failure, not a malformed completion — the
       provider may have sent a perfectly good one. Reported as such, with the phase named. */
    return classifyTransportError(read.error, timeoutMs, "while reading the response body");
  }

  return parseCompletion(read.text);
}

/** The only expression in this file that touches the credential. */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

/**
 * The wire body, enumerated. `store: false` is a literal here and not a default anyone assumes;
 * spec §3 makes it the whole zero-retention posture, and a posture that depends on a platform
 * default is a posture that changes when the platform does.
 */
function buildRequestBody(
  request: FireworksRequest,
  model: string,
): Readonly<Record<string, unknown>> {
  return {
    model,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    store: false,
  };
}

type BodyText =
  | { readonly state: "read"; readonly text: string }
  | { readonly state: "unreadable"; readonly error: unknown };

async function readBodyText(response: Response): Promise<BodyText> {
  try {
    return { state: "read", text: await response.text() };
  } catch (error) {
    return { state: "unreadable", error };
  }
}

/**
 * Our deadline, or the network. An AbortSignal.timeout abort surfaces as `TimeoutError`; an
 * `AbortError` is treated the same way because the only signal passed here is ours. Everything
 * else is the connection failing, and the OS code (`ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`)
 * is carried because "network-unreachable" without it is the same shrug as `commitCount: 0`.
 */
function classifyTransportError(error: unknown, timeoutMs: number, phase: string): FireworksResult {
  const name = errorName(error);
  if (name === "TimeoutError" || name === "AbortError") return { state: "timeout", afterMs: timeoutMs };
  return { state: "network-unreachable", detail: `${describeError(error)} (${phase})` };
}

function refusalFrom(status: number, bodyText: string): FireworksResult {
  const fromJson = providerErrorMessage(bodyText);
  if (fromJson !== null) {
    return {
      state: "provider-refused",
      status,
      providerMessage: truncate(fromJson),
      providerMessageSource: "json-error-message",
    };
  }
  return {
    state: "provider-refused",
    status,
    providerMessage: truncate(bodyText),
    providerMessageSource: "raw-body",
  };
}

/** `{"error": {"message": "..."}}` and `{"error": "..."}` are both shapes providers send. */
function providerErrorMessage(bodyText: string): string | null {
  const body = parseJson(bodyText);
  if (body.state !== "parsed") return null;
  const record = asRecord(body.value);
  if (record === null) return null;

  const error = record["error"];
  if (typeof error === "string") return error;

  const errorRecord = asRecord(error);
  if (errorRecord !== null) {
    const message = errorRecord["message"];
    if (typeof message === "string") return message;
  }

  const message = record["message"];
  return typeof message === "string" ? message : null;
}

/**
 * A 2xx body becomes a completion or a named refusal to read it. Every branch says which part of
 * the shape was wrong, because "malformed response" alone is unactionable at 2am.
 */
function parseCompletion(bodyText: string): FireworksResult {
  const parsed = parseJson(bodyText);
  if (parsed.state !== "parsed") {
    return { state: "malformed-response", detail: `body is not JSON: ${truncate(parsed.detail)}` };
  }

  const body = asRecord(parsed.value);
  if (body === null) return { state: "malformed-response", detail: "body is not a JSON object" };

  const choices = body["choices"];
  if (!Array.isArray(choices)) return { state: "malformed-response", detail: "choices is not an array" };
  if (choices.length === 0) {
    /* Distinct from a zero-length completion: the model produced no text is one fact, the
       response carries no completion object at all is another. */
    return { state: "malformed-response", detail: "choices is empty — no completion object" };
  }

  const choice = asRecord(choices[0]);
  if (choice === null) return { state: "malformed-response", detail: "choices[0] is not an object" };

  const message = asRecord(choice["message"]);
  if (message === null) return { state: "malformed-response", detail: "choices[0].message is not an object" };

  if (!("content" in message)) {
    return { state: "malformed-response", detail: "choices[0].message.content is absent" };
  }

  const content = message["content"];
  /* `null` content is what a provider sends when the model emitted no text. That is a completion
     of length zero, and the rule is that it is a success. */
  const completion = content === null ? "" : content;
  if (typeof completion !== "string") {
    return { state: "malformed-response", detail: `choices[0].message.content is ${typeName(content)}` };
  }

  const finishReasonRaw = choice["finish_reason"];
  return {
    state: "completed",
    completion,
    finishReason: typeof finishReasonRaw === "string" ? finishReasonRaw : null,
    usage: readUsage(body["usage"]),
  };
}

function readUsage(raw: unknown): FireworksUsage | null {
  const usage = asRecord(raw);
  if (usage === null) return null;
  return {
    promptTokens: finiteNumber(usage["prompt_tokens"]),
    completionTokens: finiteNumber(usage["completion_tokens"]),
    totalTokens: finiteNumber(usage["total_tokens"]),
  };
}

type JsonParse =
  | { readonly state: "parsed"; readonly value: unknown }
  | { readonly state: "invalid"; readonly detail: string };

function parseJson(text: string): JsonParse {
  try {
    return { state: "parsed", value: JSON.parse(text) as unknown };
  } catch (error) {
    return { state: "invalid", detail: describeError(error) };
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// jscpd:ignore-start — identical to the same four helpers in localModel.ts; historical
// duplication predating this gate (see the PR that added check:dup), not retriaged here.
function typeName(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : typeof value;
}

function errorName(error: unknown): string {
  const record = asRecord(error);
  const name = record === null ? undefined : record["name"];
  return typeof name === "string" ? name : "Error";
}

/** Name, message, and the OS code when there is one. Never a header, never a body, never a key. */
function describeError(error: unknown): string {
  const record = asRecord(error);
  const message = record === null ? undefined : record["message"];
  const cause = record === null ? null : asRecord(record["cause"]);
  const code = cause === null ? undefined : cause["code"];
  const head = `${errorName(error)}: ${typeof message === "string" ? message : String(error)}`;
  return typeof code === "string" ? `${head} [${code}]` : head;
}

function truncate(text: string): string {
  return text.length <= PROVIDER_MESSAGE_MAX ? text : `${text.slice(0, PROVIDER_MESSAGE_MAX)}…`;
}
// jscpd:ignore-end
