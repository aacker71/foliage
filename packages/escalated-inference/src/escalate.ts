/**
 * THE TIER 3 CLIENT — a frontier model over the network drafts a leaflet candidate's title.
 * `packages/escalated-inference` is the CLOUD plane's whole reason to exist as a separate
 * package: the open plane's privacy claim (`PRODUCT-ARCHITECTURE-SPEC.md` §10.3) is zero
 * network calls beyond loopback, so a client that leaves the machine cannot live in
 * `apps/leaf` or `packages/leaf` without making that claim false. This package is the one place
 * in the whole tree allowed to call an address that is not `127.0.0.1`.
 *
 * IT NEVER PRODUCES A LEAFLET. `escalateDraft` returns a title and its own provenance; nothing
 * here imports a writer, touches `fs`, or knows what a leaf document looks like on disk. The
 * caller runs the draft through the existing airlock — the same human-review gate every other
 * extractor's output passes through (`HarvestCandidate.review.state === "candidate"`,
 * `packages/photosynthesis/src/harvestDocument.ts`) — before anything reaches a person's
 * portfolio.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * THE GATE THIS PACKAGE EXISTS TO ENFORCE, measured against the live provider 2026-08-19,
 * same prompt, two `max_tokens` budgets:
 *
 *   RESULT A (max_tokens 3000): latency 3512 ms, finish_reason "stop", reasoning_content 1179
 *   chars in ITS OWN FIELD, content "Design system adoption, frame denial, sprite consolidation,
 *   and test invariants" — 10 words, neutral, no rating shape, no praise word. A good draft.
 *
 *   RESULT B, THE TRAP (max_tokens 200): latency 2766 ms, finish_reason "length",
 *   reasoning_content EMPTY, content 126 words of raw chain-of-thought beginning "The user wants
 *   a neutral technical title of at most 12 words, one line, no preamble..." and ending
 *   mid-sentence: "Count words: Design(1) system(2) adoption,(3) sprite-based(4) mark,(5)".
 *
 * Kimi K3 is a REASONING model. Normally its deliberation stays in `reasoning_content` and
 * `content` holds only the answer. When the token budget runs out before the model finishes
 * thinking, the reasoning SPILLS INTO `content` and `reasoning_content` comes back empty. A
 * naive reader — one that trusts `content` whenever the HTTP status is 200 — would write the
 * model's private deliberation into somebody's career portfolio, attested as a description of
 * their work. That is the same defect class `data-verbatim` was just fixed for: the field that
 * is present and non-empty is not the same question as the field that is TRUSTWORTHY.
 *
 * A truncated answer is not a shorter answer — a fragment of reasoning is a DIFFERENT KIND OF
 * TEXT than a finished title, the same way a rating-shaped title is a different kind of text
 * than a factual one. Neither is salvaged by trimming; both are refused whole. So THE GATE:
 * accept ONLY `finish_reason === "stop"` WITH non-empty trimmed `content`. Everything else is a
 * named refusal, never a silent fallback and never a partial write.
 *
 * `reasoning_content` ITSELF IS NEVER READ INTO A DRAFT, even on the happy path — it is the
 * model's private thinking and has no place in a portfolio. Only its LENGTH is carried, and
 * only for diagnostics (`reasoningContentLength` below).
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHY NOT `loopbackFetch.ts`. That module IS the mechanism that makes "the open plane makes
 * zero network calls beyond loopback" a checkable fact rather than a promise — it refuses every
 * host but the literal `127.0.0.1`. This client's whole purpose is to leave the machine, so
 * importing it would be either dead code that always refuses, or a silent redefinition of
 * "loopback" to include a real external host — exactly the "claim and effect derived from
 * different values" bug that module's own header names. This package borrows the SHAPE of that
 * defense — parse the endpoint, confirm the host is the one actually intended, refuse a
 * redirect manually rather than let `fetch` follow it (a 307 preserves method and body, so a
 * followed redirect would carry a real draft prompt to an unintended host) — scoped honestly to
 * `api.fireworks.ai`, never described as "loopback".
 *
 * PURE OVER AN INJECTED `fetch`, so every branch is testable with zero network: `escalateDraft`
 * takes `{ fetch, env, now }` rather than reading `globalThis.fetch`/`process.env`/`Date` itself,
 * the same shape `loopbackFetch`'s callers use for the same reason — a test that wants to prove
 * "truncated output is refused" should not need a real model to truncate for it.
 *
 * ZERO THIRD-PARTY RUNTIME DEPENDENCIES. Built-in `fetch` only, no SDK. The one runtime
 * dependency this package declares (`@foliage/leaf`) is a workspace package in the open plane —
 * `cloud` depending on `open` is the sanctioned direction (`public-boundary.json`'s own
 * `$comment`), and it exists so `RATING_SHAPED` has ONE definition rather than a fourth copy
 * (see below).
 *
 * store: false IS SET, NOT ASSUMED. §3 of `PRODUCT-ARCHITECTURE-SPEC.md` requires Tier 3's Zero
 * Data Retention mode "explicitly configured (not assumed as platform default)" — the owner's
 * own example call omitted it, which §10.8 flags as a finding that would have made the
 * product's central privacy claim false in its first real request. This client sets it on every
 * call rather than leaving it to a provider default nobody has re-verified.
 *
 * MEASURED, FOR THE RECORD: this path is currently unverifiable against the live provider — the
 * Fireworks account is suspended (§10.8, `PRECONDITION_FAILED`). Every branch below is verified
 * against a STUBBED `fetch` (see `escalate.test.ts`), never against a real response. That
 * distinction is stated here so a future reader does not read a green test suite as "the cloud
 * call works" — it proves the parsing and the gate, not the network.
 */

import { RATING_SHAPED, type Provenance } from "@foliage/leaf";

/** The one endpoint this package will ever call. Not env-configurable — see the header. */
const ESCALATED_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
/** The host `ESCALATED_ENDPOINT` must resolve to. Checked at call time, not merely assumed. */
const ESCALATED_HOST = "api.fireworks.ai";

/** Overridable by `FOLIAGE_ESCALATED_INFERENCE_MODEL`; this is the id measured in the header. */
const DEFAULT_MODEL = "accounts/fireworks/routers/kimi-k3-fast";

/**
 * Sized off RESULT A above (3512 ms at this budget, finish_reason "stop") plus real headroom —
 * NOT off RESULT B's trap. Lowering this constant without also widening the caller's tolerance
 * for `finish_reason !== "stop"` re-creates the exact defect this file exists to gate; it is a
 * `max_tokens` budget, not a timeout, and is named separately from `TIMEOUT_MS` on purpose.
 */
const DEFAULT_MAX_TOKENS = 3000;

/** Neither measured latency (3512 ms / 2766 ms) is close to this; wide margin, no cold start —
 * unlike the local path's measured 39.2s, there is no model to load. */
const TIMEOUT_MS = 30_000;

/** The prompt asks for this; the model is free to ignore it, so `checkWordLimit` verifies it. */
const DEFAULT_MAX_WORDS = 12;

/**
 * A NUMBER THAT READS LIKE A RATING, imported rather than copied. `RATING_SHAPED` is exported
 * from `@foliage/leaf`'s `publishPolicy.ts`, which already documents three character-identical
 * copies elsewhere in the tree (`photoIntake.ts`, `brainIntake.ts`, `apps/leaf/harvest.mjs`) as
 * owed work. A fourth copy here would make that worse; `cloud` may depend on `open` freely
 * (`public-boundary.json`), so there is no boundary reason to duplicate it.
 */
export { RATING_SHAPED };

/**
 * WORDS THAT READ LIKE PRAISE RATHER THAN A FACT. There is no canonical export for this in the
 * tree today — `@foliage/leaf` exports `RATING_SHAPED` (a number shaped like a rating) and
 * `SCORE_SHAPED` (a set of KEY names refused in a document), but nothing that catches prose like
 * "an exceptional contribution". The brief's "no score, no rating, no praise" is broader than
 * what either existing export tests, so this list is owned HERE until a caller outside escalated
 * inference needs the same rule, at which point it belongs beside `RATING_SHAPED` for the same
 * reason `RATING_SHAPED` belongs beside `SCORE_SHAPED` — one definition, every gate.
 *
 * DELIBERATELY NARROW rather than a general sentiment classifier: a fixed, readable word list is
 * auditable the same way `RATING_SHAPED` is a fixed, readable pattern rather than a model call —
 * "is this praise?" must never become a question answered by another model.
 */
export const PRAISE_SHAPED =
  /\b(excellent|outstanding|exceptional|amazing|incredible|world-class|best-in-class|top-tier|superb|flawless|masterful|brilliant|impeccable|phenomenal|remarkable|stellar|unparalleled)\b/i;

/** One piece of untrusted raw material the model is shown while drafting. Never sent alone. */
export interface EscalationRequest {
  /** What this candidate would be filed under, e.g. "git-cluster:design-system". Shown in the prompt as a heading; never itself sent as evidence. */
  readonly clusterPrefix: string;
  /** The raw lines the model summarizes — e.g. commit subjects. At least one is required. */
  readonly subjects: readonly string[];
  /**
   * What this draft would be grounded in if a person later approves it. Required, non-empty,
   * and checked BEFORE any network call — mirroring `HarvestCandidate`'s own rule
   * (`harvestDocument.ts`) that a candidate with no evidence is an unsourced assertion wearing
   * the format, not a smaller candidate.
   */
  readonly evidence: readonly Provenance[];
  /** Overrides `DEFAULT_MAX_WORDS`. */
  readonly maxWords?: number;
  /** Overrides `DEFAULT_MAX_TOKENS`. Lowering this reopens the RESULT B trap — see the header. */
  readonly maxTokens?: number;
}

/** Everything `escalateDraft` needs, injected — never read from ambient globals. See header. */
export interface EscalationDeps {
  readonly fetch: typeof fetch;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
}

/**
 * The draft this package returns. Deliberately NOT a `HarvestCandidate` — this package never
 * assigns an `id`, never sets `review` beyond the one state that is always true here, and does
 * not import `@foliage/photosynthesis` at all (declaring that dependency belongs to whichever
 * open-plane caller assembles the real candidate document; see `escalate.test.ts`'s header for
 * why the caller, not this package, owns that step).
 */
export interface EscalatedDraft {
  /** The model's answer to the prompt. Never contains `reasoning_content` — see the header. */
  readonly title: string;
  /** Truthfully identifies this as cloud output, never something a reader could mistake for local or deterministic provenance — mirrors `local-model:${model}` in `harvest.mjs`. */
  readonly extractor: string;
  /** ISO-8601 instant with offset, from the injected `now()` — never `Date.now()` read directly, so a test can pin it. */
  readonly draftedAt: string;
  /** Passed through from the request, unmodified — this package invents no evidence. */
  readonly evidence: readonly Provenance[];
  /**
   * ALWAYS this. A draft from this package is never `approved` or `rejected` — those require a
   * named human (`harvestDocument.ts`'s `ReviewState`), and this package has never seen one.
   */
  readonly review: { readonly state: "candidate" };
  /** Diagnostic only — see the header's "never read `reasoning_content` into the draft" rule. */
  readonly reasoningContentLength: number;
}

/**
 * Every way this client refuses, named. Every branch that reads network or model output also
 * carries `detail`: a human-readable sentence naming what happened and why it was refused —
 * `AGENTS.md`'s error-masking rule applied to a network boundary instead of a fallback, and the
 * same discipline `draftTitleWithLocalModel` (`harvest.mjs`) follows for every one of its own
 * refusals. Nothing here is a bare boolean or an empty string standing in for a reason.
 */
export type EscalationFailure =
  /** `FOLIAGE_ESCALATED_INFERENCE_KEY` is absent. Checked before any network call. */
  | { readonly cause: "no-key"; readonly detail: string }
  /** `evidence` is empty. Checked before any network call — see `EscalationRequest.evidence`. */
  | { readonly cause: "no-evidence"; readonly detail: string }
  /** `subjects` is empty — there is nothing to draft a title from. */
  | { readonly cause: "no-material"; readonly detail: string }
  /** `ESCALATED_ENDPOINT` does not resolve to `ESCALATED_HOST`. Should never fire against the constant above; guards a future edit to it rather than any caller input. */
  | { readonly cause: "wrong-host"; readonly detail: string; readonly host: string }
  /** The provider answered a redirect. NOT followed — a 307 preserves method and body, so following it could carry the prompt to an unintended host. See the header. */
  | { readonly cause: "redirected"; readonly detail: string; readonly status: number; readonly location: string | null }
  /** `fetch` itself threw — DNS, TLS, connection refused, or the abort from `TIMEOUT_MS`. Both causes: the thrown error and this client's interpretation of it. */
  | { readonly cause: "transport-failed"; readonly detail: string; readonly error: unknown }
  /** A non-2xx HTTP status. Carries the provider's own error text, verbatim (sliced), AND our cause — never one or the other. */
  | { readonly cause: "http-error"; readonly detail: string; readonly status: number; readonly body: string }
  /** `response.json()` threw — the body was not JSON. */
  | { readonly cause: "unparseable-response"; readonly detail: string; readonly error: unknown }
  /** The body parsed as JSON but not the shape a chat-completions response has — e.g. no `choices`, no `message.content`. Named field-by-field so this is never "something was missing" with no further detail. */
  | { readonly cause: "malformed-response"; readonly detail: string }
  /**
   * `finish_reason !== "stop"`. THE GATE — see the header's Result A/B finding. `content` is
   * quoted (truncated) so the refusal is checkable, but it is quoted as EVIDENCE OF WHAT WAS
   * REFUSED, never written anywhere as a draft.
   */
  | { readonly cause: "truncated"; readonly detail: string; readonly finishReason: string | null; readonly quotedContent: string }
  /** `finish_reason === "stop"` but trimmed `content` is empty. A model is free to answer nothing; that is refused here rather than reaching a candidate with a blank title. */
  | { readonly cause: "empty-content"; readonly detail: string }
  /** `RATING_SHAPED` matched the drafted title. The match and the full title are both quoted. */
  | { readonly cause: "rating-shaped"; readonly detail: string; readonly match: string; readonly quotedTitle: string }
  /** `PRAISE_SHAPED` matched the drafted title. */
  | { readonly cause: "praise-shaped"; readonly detail: string; readonly match: string; readonly quotedTitle: string }
  /** The drafted title exceeds `maxWords` (default `DEFAULT_MAX_WORDS`). The prompt asks for a limit; this checks it, the same posture as the rating/praise checks — a request to the model is never trusted as a rule. */
  | { readonly cause: "over-word-limit"; readonly detail: string; readonly wordCount: number; readonly limit: number; readonly quotedTitle: string };

/** Never a thrown string — a discriminated union, per this repo's rule. */
export type EscalationResult =
  | { readonly ok: true; readonly draft: EscalatedDraft }
  | ({ readonly ok: false } & EscalationFailure);

/** Slice any provider/model text quoted into a refusal to a bounded length — mirrors `harvest.mjs`'s `body.slice(0, 200)` for the same reason: a refusal must be checkable without becoming unbounded. */
function quoted(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Both causes, always — ours and the transport's. Mirrors `messageWithCause` in `brainSource.ts` / `photoSource.ts` / `harvest.mjs`, one more copy of the same small pattern rather than a shared import, because none of those three files is in this package's owned paths. */
function messageWithCause(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}

function isoInstant(d: Date): string {
  return d.toISOString();
}

/** Fireworks chat-completions response shape, as far as this client trusts it. Every field checked before use — see `malformed-response` above. */
interface ChatCompletionsResponse {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly message?: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
    };
  }[];
}

/**
 * Ask an escalated model for one leaflet candidate's title. Fails closed on every branch named
 * in `EscalationFailure` — never a thrown string, never a silent fallback to a local model,
 * never a partial or trimmed draft. See the file header for the finding this function exists
 * to gate.
 */
export async function escalateDraft(
  request: EscalationRequest,
  deps: EscalationDeps,
): Promise<EscalationResult> {
  if (request.evidence.length === 0) {
    return {
      ok: false,
      cause: "no-evidence",
      detail:
        "the request carried zero evidence refs. A candidate with no evidence is an unsourced " +
        "assertion wearing the format (the same rule `harvestDocument.ts` enforces on " +
        "`HarvestCandidate.evidence`), so this is refused before any network call was made — " +
        "nothing was sent to the provider.",
    };
  }
  if (request.subjects.length === 0) {
    return {
      ok: false,
      cause: "no-material",
      detail:
        "the request carried zero subjects to draft a title from. Nothing was sent to the " +
        "provider.",
    };
  }

  const apiKey = deps.env["FOLIAGE_ESCALATED_INFERENCE_KEY"];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    return {
      ok: false,
      cause: "no-key",
      detail:
        "FOLIAGE_ESCALATED_INFERENCE_KEY is not set in the environment. Escalated inference " +
        "was requested and refused — nothing was sent to the provider, and the local model was " +
        "NOT silently substituted; that substitution is exactly the error-masking AGENTS.md " +
        "names, and this client never performs it.",
    };
  }

  let host: string;
  try {
    host = new URL(ESCALATED_ENDPOINT).hostname;
  } catch (err) {
    // Unreachable against the literal constant above; kept because a constant that is only
    // ever "obviously right" is exactly the kind of value that drifts unnoticed in an edit.
    return {
      ok: false,
      cause: "wrong-host",
      host: "(unparseable)",
      detail: `ESCALATED_ENDPOINT is not a URL this process can parse: ${messageWithCause(err)}.`,
    };
  }
  if (host !== ESCALATED_HOST) {
    return {
      ok: false,
      cause: "wrong-host",
      host,
      detail:
        `ESCALATED_ENDPOINT resolves to host "${host}", not "${ESCALATED_HOST}". This client's ` +
        `whole purpose is to leave the machine, but only to the ONE host it names — nothing was ` +
        `sent.`,
    };
  }

  const model = deps.env["FOLIAGE_ESCALATED_INFERENCE_MODEL"]?.trim() || DEFAULT_MODEL;
  const maxWords = request.maxWords ?? DEFAULT_MAX_WORDS;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

  const subjectLines = request.subjects.map((s) => `- ${s.trim()}`).join("\n");
  const prompt =
    `These are ${request.subjects.length} pieces of raw material for one leaflet candidate, ` +
    `filed under "${request.clusterPrefix}":\n${subjectLines}\n\n` +
    `Write exactly one line: a short, factual title describing this body of work, at most ` +
    `${maxWords} words. State only what the material shows. No ratings, no praise, no numbers ` +
    `that read like a score. Output only the title, nothing else.`;

  let response: Response;
  try {
    response = await deps.fetch(ESCALATED_ENDPOINT, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      // store: false is SET, not assumed — see the header's ZDR paragraph.
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        stream: false,
        store: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      cause: "transport-failed",
      error: err,
      detail: `${ESCALATED_ENDPOINT} could not be reached: ${messageWithCause(err)}. Nothing was written — the local model was NOT silently substituted.`,
    };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    return {
      ok: false,
      cause: "redirected",
      status: response.status,
      location,
      detail:
        `${ESCALATED_ENDPOINT} answered HTTP ${response.status} redirecting to ` +
        `${location === null ? "an unnamed location" : `"${location}"`}, and the redirect was ` +
        `NOT followed — a 307 preserves method and body, so following it could have carried this ` +
        `prompt to an unintended host. Nothing was sent to it.`,
    };
  }

  if (!response.ok) {
    const body = quoted(await response.text().catch(() => ""), 500);
    return {
      ok: false,
      cause: "http-error",
      status: response.status,
      body,
      detail:
        `the provider answered HTTP ${response.status}: ${body || "(no body)"}. Nothing was ` +
        `written.`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    return {
      ok: false,
      cause: "unparseable-response",
      error: err,
      detail: `the provider's response was not JSON: ${messageWithCause(err)}. Nothing was written.`,
    };
  }

  const choice = (payload as ChatCompletionsResponse | null)?.choices?.[0];
  if (choice === undefined) {
    return {
      ok: false,
      cause: "malformed-response",
      detail: `the provider's response had no "choices[0]". Nothing was written.`,
    };
  }
  const finishReason = choice.finish_reason ?? null;
  const content = choice.message?.content;
  if (content === undefined || content === null) {
    return {
      ok: false,
      cause: "malformed-response",
      detail: `the provider's response had no "choices[0].message.content". Nothing was written.`,
    };
  }
  const reasoningContentLength = choice.message?.reasoning_content?.length ?? 0;

  // THE GATE. See the file header's Result A/B finding: a reasoning model whose token budget
  // runs out spills its private deliberation into `content` and leaves `reasoning_content`
  // empty. A naive reader trusts `content` whenever the HTTP status is 200; this does not.
  // `finish_reason !== "stop"` is refused OUTRIGHT, before content is even inspected for
  // emptiness — a truncated answer is not a shorter answer, it is a different kind of text, and
  // no amount of trimming turns Result B's 126-word chain-of-thought fragment into a title.
  if (finishReason !== "stop") {
    return {
      ok: false,
      cause: "truncated",
      finishReason,
      quotedContent: quoted(content),
      detail:
        `the provider's finish_reason was "${finishReason ?? "(absent)"}", not "stop" ` +
        `(reasoning_content was ${reasoningContentLength} chars). This is treated as a refusal, ` +
        `not a shorter answer — the content field of a truncated reasoning-model response can be ` +
        `the model's raw chain-of-thought rather than its finished answer, measured directly: at ` +
        `a tight token budget this same prompt returned 126 words of deliberation ending ` +
        `mid-sentence, with reasoning_content empty. Nothing was written, and the content is ` +
        `quoted above only as evidence of what was refused — it is never a candidate's title.`,
    };
  }

  const title = content.trim();
  if (title.length === 0) {
    return {
      ok: false,
      cause: "empty-content",
      detail: `the provider returned finish_reason "stop" but an empty (or whitespace-only) content. Nothing was written.`,
    };
  }

  const ratingMatch = RATING_SHAPED.exec(title);
  if (ratingMatch !== null) {
    return {
      ok: false,
      cause: "rating-shaped",
      match: ratingMatch[0],
      quotedTitle: title,
      detail:
        `the drafted title was REFUSED for carrying a rating-shaped number ("${ratingMatch[0]}"): ` +
        `"${title}". Nothing in this product emits a number that reads like a rating; the draft ` +
        `is not written, not trimmed, and not quietly replaced.`,
    };
  }

  const praiseMatch = PRAISE_SHAPED.exec(title);
  if (praiseMatch !== null) {
    return {
      ok: false,
      cause: "praise-shaped",
      match: praiseMatch[0],
      quotedTitle: title,
      detail:
        `the drafted title was REFUSED for carrying a praise word ("${praiseMatch[0]}"): ` +
        `"${title}". A draft states only what the material shows; it does not rate it.`,
    };
  }

  const wordCount = title.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount > maxWords) {
    return {
      ok: false,
      cause: "over-word-limit",
      wordCount,
      limit: maxWords,
      quotedTitle: title,
      detail:
        `the drafted title was REFUSED for exceeding the ${maxWords}-word limit (${wordCount} ` +
        `words): "${title}". The prompt asked for a limit; the model is free to ignore a request, ` +
        `so the answer is checked rather than trusted.`,
    };
  }

  return {
    ok: true,
    draft: {
      title,
      extractor: `escalated:${model}`,
      draftedAt: isoInstant(deps.now()),
      evidence: request.evidence,
      review: { state: "candidate" },
      reasoningContentLength,
    },
  };
}
