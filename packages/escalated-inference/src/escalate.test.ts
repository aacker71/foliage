import { test } from "node:test";
import assert from "node:assert/strict";

import { escalateDraft, type EscalationDeps, type EscalationRequest } from "./escalate.ts";

/**
 * NO NETWORK. Every fixture in this file is a stubbed `fetch` built by hand to mirror a real
 * response shape — never a real call, and none of these results proves the live provider works
 * (it is currently suspended; see `escalate.ts`'s header). `fetchReturning` and `fetchThrowing`
 * are obviously stubs, never something that could be mistaken for a real call.
 */

const instant = new Date("2026-08-19T12:00:00.000Z");

function baseRequest(overrides: Partial<EscalationRequest> = {}): EscalationRequest {
  return {
    clusterPrefix: "git-cluster:design-system",
    subjects: [
      "adopt the design token system across the leaf app",
      "consolidate three sprite implementations into one",
      "add invariant tests for the frame-denial policy",
    ],
    evidence: [{ source: "git", ref: "aaaa111", observedAt: "2026-08-19T00:00:00Z" }],
    ...overrides,
  };
}

/** A stub `fetch` that answers a fixed JSON body once, regardless of the request. */
function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

/** A stub `fetch` that throws, mimicking a real transport failure with no network involved. */
function fetchThrowing(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function depsWithFetch(fetchImpl: typeof fetch, envOverrides: Record<string, string | undefined> = {}): EscalationDeps {
  return {
    fetch: fetchImpl,
    env: { FOLIAGE_ESCALATED_INFERENCE_KEY: "test-fixture-key-not-real", ...envOverrides },
    now: () => instant,
  };
}

test("a stop-finished response with clean content returns a draft carrying the model's title, extractor and evidence", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "Design system adoption, frame denial, sprite consolidation, and test invariants",
              reasoning_content: "x".repeat(1179),
            },
          },
        ],
      }),
    ),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.draft.title,
    "Design system adoption, frame denial, sprite consolidation, and test invariants",
  );
  assert.equal(result.draft.extractor, "escalated:accounts/fireworks/routers/kimi-k3-fast");
  assert.equal(result.draft.review.state, "candidate");
  assert.deepEqual(result.draft.evidence, baseRequest().evidence);
  assert.equal(result.draft.draftedAt, instant.toISOString());
});

test("REASONING_CONTENT IS NEVER CARRIED INTO THE DRAFT — only its length is, and only for diagnostics", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Design system adoption and sprite consolidation", reasoning_content: "y".repeat(42) },
          },
        ],
      }),
    ),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.reasoningContentLength, 42);
  assert.ok(!("reasoningContent" in result.draft));
  assert.doesNotMatch(JSON.stringify(result.draft), /y{10,}/);
});

test("THE GATE, pinned on RESULT B's real measured shape — finish_reason \"length\" with reasoning spilled into content is refused, not trusted as a shorter answer", async () => {
  // Fixture reproduces the measured trap verbatim: max_tokens exhausted mid-thought,
  // reasoning_content EMPTY, content holding 126 words of the model's own deliberation.
  const spilledReasoning =
    'The user wants a neutral technical title of at most 12 words, one line, no preamble, ' +
    'no ratings, no praise, no score-like numbers. Let me look at the commits again: design ' +
    'token adoption across the leaf app, three sprite implementations merged into one, and ' +
    'invariant tests added for the frame-denial policy. I should pick the words that state ' +
    'only what the commits show, nothing more, nothing evaluative. Count words: Design(1) ' +
    'system(2) adoption,(3) sprite-based(4) mark,(5)';
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          {
            finish_reason: "length",
            message: { content: spilledReasoning, reasoning_content: "" },
          },
        ],
      }),
    ),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "truncated");
  assert.equal(result.finishReason, "length");
  assert.match(result.detail, /finish_reason was "length"/);
  assert.match(result.detail, /reasoning_content was 0 chars/);
});

test("empty content with finish_reason stop is refused rather than treated as an answer", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [{ finish_reason: "stop", message: { content: "   ", reasoning_content: "" } }],
      }),
    ),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "empty-content");
});

test("a rating-shaped draft is refused with the match and the full title quoted, never sanitised", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          { finish_reason: "stop", message: { content: "Design system work, rated 9 out of 10", reasoning_content: "" } },
        ],
      }),
    ),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "rating-shaped");
  assert.equal(result.match, "rated 9 out of 10");
  assert.equal(result.quotedTitle, "Design system work, rated 9 out of 10");
});

test("a praise-shaped draft is refused with the offending word named", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          { finish_reason: "stop", message: { content: "An exceptional round of design system work", reasoning_content: "" } },
        ],
      }),
    ),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "praise-shaped");
  assert.equal(result.match.toLowerCase(), "exceptional");
});

test("a title over the configured word limit is refused, naming the count and the limit", async () => {
  const result = await escalateDraft(
    baseRequest({ maxWords: 3 }),
    depsWithFetch(
      fetchReturning(200, {
        choices: [
          { finish_reason: "stop", message: { content: "Design system adoption across the whole leaf application surface", reasoning_content: "" } },
        ],
      }),
    ),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "over-word-limit");
  assert.equal(result.limit, 3);
  assert.ok(result.wordCount > 3);
});

test("a request with no evidence is refused before any network call, naming that cause", async () => {
  let called = false;
  const fetchImpl: typeof fetch = (async () => {
    called = true;
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  const result = await escalateDraft(baseRequest({ evidence: [] }), depsWithFetch(fetchImpl));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "no-evidence");
  assert.equal(called, false, "no-evidence must be checked before any fetch");
});

test("a MISSING API KEY is refused by name, and nothing is sent — this test contains no key of any kind", async () => {
  let called = false;
  const fetchImpl: typeof fetch = (async () => {
    called = true;
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  const result = await escalateDraft(baseRequest(), {
    fetch: fetchImpl,
    env: {},
    now: () => instant,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "no-key");
  assert.match(result.detail, /FOLIAGE_ESCALATED_INFERENCE_KEY/);
  assert.equal(called, false, "no-key must be checked before any fetch");
});

test("a non-2xx response carries the provider's own error text AND this client's cause, never one alone", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(fetchReturning(412, { error: { message: "Account foliage is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices." } })),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "http-error");
  assert.equal(result.status, 412);
  assert.match(result.body, /Account foliage is suspended/);
  assert.match(result.detail, /HTTP 412/);
  assert.match(result.detail, /Account foliage is suspended/);
});

test("a transport throw is caught and reported with both this client's cause and the underlying error's message", async () => {
  const result = await escalateDraft(
    baseRequest(),
    depsWithFetch(fetchThrowing(new Error("getaddrinfo ENOTFOUND api.fireworks.ai"))),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "transport-failed");
  assert.match(result.detail, /could not be reached/);
  assert.match(result.detail, /ENOTFOUND/);
});

test("a malformed response body — valid JSON, wrong shape — is refused by name rather than throwing", async () => {
  const result = await escalateDraft(baseRequest(), depsWithFetch(fetchReturning(200, { unexpected: true })));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "malformed-response");
});
