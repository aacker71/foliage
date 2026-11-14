# @foliage/escalated-inference

A client for **Tier 3 — Escalated Inference** (`docs/PRODUCT-ARCHITECTURE-SPEC.md` §3, §10.2,
§10.3): a frontier model over the network drafts a leaflet candidate's title, for a human to
review through the existing airlock. It never writes a leaflet, never touches disk, and never
imports a writer.

## Plane

**Cloud.** The open plane's privacy claim is zero network calls beyond loopback
(`apps/leaf/src/loopbackFetch.ts`, `127.0.0.1` only). This package's entire purpose is to call
`https://api.fireworks.ai`, which makes it the wrong shape for `apps/leaf` or `packages/leaf` —
so it lives here, declared in the `cloud` array of `public-boundary.json`, the one array a
package that leaves the machine is allowed to sit in. It depends on `@foliage/leaf` (open) for
`RATING_SHAPED`; `cloud` depending on `open` is the sanctioned direction.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `FOLIAGE_ESCALATED_INFERENCE_KEY` | Yes | The Fireworks API key. Read from the environment only — never hardcoded, logged, or written to a file by this package. Its absence is a named refusal (`cause: "no-key"`), not a crash or a silent fallback. |
| `FOLIAGE_ESCALATED_INFERENCE_MODEL` | No | Overrides the default router id (`accounts/fireworks/routers/kimi-k3-fast`, the id measured in `src/escalate.ts`'s header). |

## The gate

Kimi K3 is a reasoning model. When its token budget runs out before it finishes thinking, its
private deliberation spills into the `content` field a naive client would trust, and
`reasoning_content` comes back empty. Measured directly against the live provider, 2026-08-19 —
see `src/escalate.ts`'s file header for both results, quoted verbatim. This client accepts a
draft only when `finish_reason === "stop"` **and** trimmed `content` is non-empty; everything
else is a named refusal, quoting the offending text as evidence of what was refused, never
salvaged or trimmed into a "shorter answer."

## Verification status, stated plainly

- **Verified-working:** the missing-key refusal path (`cause: "no-key"`). Run against the real
  `escalateDraft` in this package (not a stub of it), driven with real commit subjects pulled
  live from this repo's own `git log`, with `fetch` wrapped in a call-tracking shim rather than
  stubbed. Confirmed: zero network calls made, zero elapsed time, the exact `no-key` refusal
  shape. This proves the "refuse before any request leaves the process" contract; it does not
  touch the network.
- **Verified-working against the LIVE provider, 2026-08-20.** Three branches driven through the
  real `escalateDraft` (not a stub of it) against `api.fireworks.ai`, with real commit subjects
  and real shas pulled from this repository's own `git log`. The account suspension recorded in
  §10.8 had cleared; that paragraph is superseded for this package.

  | branch | request | result | evidence |
  |---|---|---|---|
  | happy path | default `maxTokens` 3000 | **`ok: true`** in 11.1 s | title *"Escalated-inference client and docs; review click-path, spec, drift, and ledger fixes"* — 11 words, inside the 12-word limit, clean on `RATING_SHAPED` and `PRAISE_SHAPED`. All 6 evidence refs passed through **unmodified**. Draft keys: `title, extractor, draftedAt, evidence, review, reasoningContentLength` — the reasoning is present only as a **length** |
  | **the trap** | `maxTokens: 200` | **`ok: false`, `cause: "truncated"`** in 8.3 s | `finishReason: "length"`, and `quotedContent` holds the spill verbatim: *"Let me analyze the three pieces of material:\n\n1. cloud: escalated-inference README states the no-key path as verified, the gate as stub-only…"* — the model's raw deliberation, refused rather than filed as a title |
  | no key | key absent from `env` | **`ok: false`, `cause: "no-key"`** in **0 ms** | `fetch` wrapped in a counting shim: **0 network calls**. Refusal names that the local model was not silently substituted |

  `RESULT A` / `RESULT B` in `src/escalate.ts`'s header are therefore reproduced, not inherited.

- **Built-but-unverified against the live provider:** the empty-content check, the
  `RATING_SHAPED` / `PRAISE_SHAPED` / word-limit refusals, `http-error`, `redirected`,
  `wrong-host`, `unparseable-response` and `malformed-response`. Each is covered in
  `src/escalate.test.ts` against a stubbed `fetch`, which proves the parsing and the gate logic
  — **not** that the provider still produces the shape the stub imitates. Provoking a
  rating-shaped answer on demand would mean asking the model to break its own instructions, so
  these stay stub-only by design.

- **Known, and not a defect:** the live `truncated` run needed a retry. A first attempt returned
  `transport-failed` on the client's own 30 s timeout — *"could not be reached: The operation was
  aborted due to timeout"* — which is the timeout working, correctly reported with both causes,
  and not a silent fallback. Escalated inference is a network call and will sometimes be slow;
  any caller must treat a refusal as ordinary, not exceptional.

## NOT BUILT

**Nothing in this repository consumes this package yet.** No caller assembles a
`HarvestCandidate` from `EscalatedDraft`, and no CLI flag calls `escalateDraft`. Wiring this into
a real drafting path is separate work, and it must keep the caller on the `cloud`/`enterprise`
side of `public-boundary.json` — an `open`-plane caller importing this package would violate the
boundary this package's whole existence is scoped around.
