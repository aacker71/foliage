/**
 * TIER 1 — the LOCAL path. Inference that runs on this machine and never opens a socket that
 * leaves it.
 *
 * Spec §3 (docs/PRODUCT-ARCHITECTURE-SPEC.md) gives the chief of staff three paths: a
 * deterministic floor that needs nothing, a LOCAL model, and an escalation that leaves the
 * device. `fireworks.ts` is the third one and says so in its own header. This file is the
 * second, and the two are deliberately shaped the same — `LocalModelRequest` has the same four
 * fields as `FireworksRequest` so the router renders ONE message list and hands it to whichever
 * arm it chose, rather than maintaining two renderings that drift apart. What is NOT shared is
 * the outcome type: the causes differ because the facts differ, and folding them into one union
 * would mean inventing a `no-credential` that cannot happen here and a `model-absent` that
 * cannot happen there.
 *
 * ZERO IMPORTS, ZERO DEPENDENCIES, GLOBAL `fetch`. No SDK, no `ollama` npm package. Same posture
 * as the Tier 3 client and for the same reason: "zero third-party runtime dependencies" is a
 * claim that is either checkable in the file or it is marketing. `fetch`, `AbortSignal` and
 * `process` are Node 22 globals.
 *
 * ── LOOPBACK IS ENFORCED ON THE PARSED HOSTNAME ──────────────────────────────────────────────
 *
 * docs/ENGINEERING-PLAN.md §11 states the rule: parse the URL and check the HOST, so an edit to
 * a constant fails closed rather than silently egressing. A prefix test on the string is the
 * version that looks right and is not: `"http://127.0.0.1.evil.com/".startsWith("http://127.0.0.1")`
 * is `true`, and the host that would actually be dialled is `evil.com`'s subdomain. That exact
 * string is in the tests. So is `http://127.0.0.1@evil.com/`, where the loopback literal is a
 * userinfo field and the host is again somebody else's.
 *
 * PARSING ALSO WINS THE CASES A REGEX LOSES, and this was checked on this Node rather than
 * assumed. `new URL` runs the WHATWG host parser, which normalises every obfuscated IPv4 form to
 * canonical dotted decimal before this file ever sees it: `http://2130706433/`, `http://0x7f.0.0.1/`
 * and `http://127.1/` all arrive at the check as `127.0.0.1` and are ACCEPTED — correctly, since
 * they are loopback, and those three are the standard bypasses for a `^127\.` string test. An
 * out-of-range octet (`http://127.0.0.256/`) makes the constructor THROW, so it is refused as
 * `unparsable-url` rather than being examined at all. Meanwhile `127.0.0.1.evil.com` has five
 * labels, is not an IPv4 address, and stays a domain name. All four are in the tests.
 *
 * The check runs TWICE, on purpose, and it is one function called at two boundaries rather than
 * two gates that can drift: once in `resolveLocalModelConfig`, which is where a person's
 * environment is read, and again inside `callLocalModel` immediately before `fetch`, on whatever
 * config object it was actually handed. The second call is what makes it fail CLOSED — a caller
 * that hand-constructs `{ state: "configured", config: { baseUrl: "https://evil.example" } }`,
 * whether by mistake or by an edit to the default constant, gets a refusal and NO REQUEST IS
 * MADE. A test proves the "no request" half by replacing `globalThis.fetch` with a recorder that
 * fails if it is called at all; asserting the returned state alone would not have proved it.
 *
 * ── AND A REDIRECT IS REFUSED, BECAUSE CHECKING THE URL WE ASKED FOR IS NOT CHECKING THE ONE
 *    WE REACHED ───────────────────────────────────────────────────────────────────────────────
 *
 * Two gates on the CONFIGURED base URL still guarded only the first hop. Node's global `fetch`
 * (undici) defaults to `redirect: "follow"`, so whatever is listening on the trusted loopback
 * port could answer `307 Location: http://<anywhere>/api/chat` and this client would follow it,
 * carrying the POST body — the person's declared material and their request, verbatim — to a
 * host no gate ever saw. MEASURED on this machine, 2026-08-19, before this was fixed: two real
 * servers, one on 127.0.0.1 that 307s everything to the other bound on 192.168.0.30 (a LAN
 * address, off the loopback interface entirely); `cos.mjs ask` exited 0, printed `LOCAL MODEL
 * completed` and `PRODUCED BY local-model … at http://127.0.0.1:<port>`, and the second server's
 * log held the whole assembled request body including the sentence typed at the prompt. The
 * transcript printed "THIS PROCESS did not dial off-box" while it had.
 *
 * So both `fetch` calls in this file pass `redirect: "manual"` and a 3xx becomes the named cause
 * `redirected`. EVERY redirect is refused, including one that points back at loopback: following
 * it would mean re-validating each hop of a chain the remote end controls, and the guarantee
 * worth having is about the connection actually made, not about a URL that was inspected before
 * a stranger got to rewrite it. A local chat runtime does not redirect; one that does is a fact
 * a person needs to see, not a hop to take.
 *
 * `redirected` carries the STATUS and the PARSED HOSTNAME of `Location` — not the raw header, not
 * the path, not a body. The hostname is what makes the refusal actionable ("your local runtime
 * tried to send this to X"), and parsing it is what keeps an attacker-chosen string from arriving
 * as free text. It is printed and it is NOT written into memory, because memory is re-rendered
 * into later prompts and BUG-002 / Janus §D27 is remote-chosen text becoming part of one.
 *
 * WHAT LOOPBACK PROVES, AND WHAT IT DOES NOT. It proves this process opened a connection to an
 * address on this machine. It does NOT prove the bytes stop there: whatever is listening on
 * 11434 is another program, and a program on this machine can forward anything it receives. A
 * local runtime is a trust decision about software the person installed, and this file cannot
 * make that decision for them — it can only guarantee that WE did not dial off-box. Say it that
 * way at the surface too; "runs locally, nothing leaves your machine" is one claim too many.
 *
 * ── THE FOUR CAUSES, AND WHY THEY DO NOT COLLAPSE ────────────────────────────────────────────
 *
 *   no-runtime         nothing is listening; the connection never produced a response. Carries
 *                      the OS-level detail (`ECONNREFUSED`) and the URL that was dialled.
 *   model-absent       a runtime ANSWERED and does not have that model. A different fact and a
 *                      different repair — `ollama pull`, not `ollama serve` — and telling a
 *                      person with a running daemon that nothing is listening sends them to fix
 *                      the wrong thing.
 *   timeout            our own deadline fired. Ours, not the network's; it carries the deadline.
 *   malformed-response 200, and the body is not a chat response this code can read.
 *
 * A fifth, `redirected`, is a 3xx that was refused rather than followed — see the redirect
 * section above. It is not `runtime-refused`: a 500 is a runtime that tried and failed, while a
 * 307 is a runtime asking us to talk to somebody else, and the repair is not the same one.
 *
 * A sixth, `runtime-refused`, exists so a 500 is not quietly filed as one of those four. It
 * carries the STATUS AND NOTHING ELSE — no body, no error string. That is deliberate: BUG-002 /
 * Janus §D27 is provider error text becoming part of a later prompt, and the only structural way
 * to guarantee text cannot be re-injected is to never carry it out of this function. The status
 * is a number the runtime chose from a fixed set; it cannot contain an instruction.
 *
 * MEASURED ON THIS MACHINE, 2026-08-19, against the runtime this file talks to:
 *
 *   GET /api/tags        → gemma4:12b, 7,556,508,396 bytes, Q4_K_M, 11.9B, context 262144,
 *                          capabilities completion/tools/thinking/vision. One model installed.
 *   POST /api/chat       → 9.25s wall for a two-character answer. total_duration 9,241,152,167ns,
 *                          load_duration 2,500,819,458ns, prompt_eval_count 21, eval_count 84,
 *                          eval_duration 6,324,749,000ns — i.e. ~13.3 generated tokens/second.
 *   unknown model        → HTTP 404, body `{"error":"model 'x' not found"}`.
 *   dead port (11533)    → connection refused (curl exit 7), no response at all.
 *
 * THE DEADLINE IS ARITHMETIC, NOT A HABIT. A cold load of this model was measured at 32.8s
 * during this run's framing (2.5s warm, above). Generation runs at ~13.3 tok/s here, so a
 * 512-token answer is ~38s of eval on its own. 32.8 + 38 ≈ 71s for a cold, medium-length
 * answer — before any other process on the laptop wants the GPU. The default is therefore
 * 120s, which is roughly that measurement doubled. The number this file must NOT have is the
 * reflexive 10s: it would report a working system as broken on its first ever call, which is
 * the precise moment a person decides whether the local path works at all.
 *
 * The LISTING deadline is a different number for a different operation — `/api/tags` reads a
 * directory of manifests and loads nothing, and it returned in well under a second here. 5s.
 *
 * ── A THINKING BLOCK IS NOT AN ANSWER ────────────────────────────────────────────────────────
 *
 * This is live on this machine, not hypothetical. `gemma4:12b` advertises `thinking`, and the
 * probe above — a request whose entire content was "Reply with exactly: OK" — came back with a
 * two-character `message.content` AND a several-hundred-character `message.thinking` narrating
 * the model's deliberation about it. That text is scratch: it is the model talking to itself,
 * it is not addressed to anyone, and it routinely contains rejected drafts of the answer.
 *
 * So `message.thinking` is READ AND DROPPED here and never appears in a returned value. It
 * cannot be displayed as the answer, cannot be written to memory, and cannot become Tier 1 or
 * Tier 2 material, because no caller is ever given it. What IS returned is the named fact that
 * a block was discarded (`thinking: "discarded" | "none-returned"`), so a surface can say "this
 * model deliberated and we are not showing you that" instead of silently dropping something a
 * person might otherwise wonder about. A test asserts the thinking string does not appear
 * anywhere in the serialised result.
 *
 * ── ZERO-LENGTH CONTENT IS A SUCCESS ─────────────────────────────────────────────────────────
 *
 * `{ state: "completed", content: "" }`, never an error. A model that answered with nothing has
 * answered; reporting it as a failure makes the caller assert a transport problem it never
 * observed. This is not a theoretical branch either — the live test in this lane hit it on the
 * real runtime: with `num_predict: 16` against a thinking model, all sixteen generated tokens
 * went into the deliberation block and `content` came back empty (`eval_count` 16, content
 * length 0, `thinking: "discarded"`). A caller that treated empty as failure would report a
 * healthy runtime as broken because it set a small budget. `message` being absent from the body is a different fact — the response carries no
 * assistant turn at all — and that is `malformed-response`, with the detail saying which.
 * Likewise an EMPTY MODEL LIST is `listed` with zero models: a runtime that is up and holds
 * nothing is a true, useful, actionable state, and it is not an error.
 *
 * ── NO MODEL NAME IS INVENTED ────────────────────────────────────────────────────────────────
 *
 * There is no default for `FOLIAGE_LOCAL_MODEL`. The Tier 3 client refuses to default a model
 * because it would spend someone else's money; here the money argument does not apply, and the
 * other one does: a wrong-model answer is indistinguishable from a right one at the call site.
 * What replaces the guess is `listLocalModels`, so "no model declared" is not a dead end — a
 * surface can enumerate what is actually installed and let the person declare one, which is a
 * real next move rather than an error message. Declared, never inferred, same as `classify.ts`.
 *
 * NOTHING HERE LOGS. No `console`, no stdout/stderr write, no file write — the prompt and the
 * completion are never written anywhere by this file. Checked two ways, because a comment rots
 * and a test does not: grep this file (`grep -nE 'console|stdout|stderr' apps/cos/src/localModel.ts`
 * returns only this paragraph) and read the colocated test that asserts the same against these
 * bytes. There is no credential anywhere in this file — a local runtime does not authenticate,
 * and adding a header "for later" would be inventing a secret to leak.
 *
 * NOTHING SENT HERE CARRIES A SCHEMA. Ollama can constrain decoding with `format`, and this file
 * deliberately does not use it: docs/ENGINEERING-PLAN.md §11 — a constrained decoder cannot
 * decline, so every field of any schema sent to a model must be nullable, and the safe version
 * of that rule in a transport is to send no schema at all. The body has exactly four keys and a
 * test asserts that key set against the bytes a real server received.
 *
 * TOTAL: no function here throws. A caller that had to wrap this in try/catch would be handling
 * failure in two shapes and would forget one of them.
 *
 * Complexity: one round trip, plus at most one extra `/api/tags` round trip on a 404 (see
 * `callLocalModel`). The only allocation that scales is the request body, O(total message chars).
 */

/** The variables this file reads. Reported to the app lane for `env.example`. */
import { inspectRedirect as sharedInspectRedirect } from "./redirect.ts";

export type LocalModelVariable = "FOLIAGE_LOCAL_MODEL" | "FOLIAGE_LOCAL_MODEL_BASE_URL";

/**
 * Where a local runtime listens by default. A constant rather than a required variable because
 * it is documentation, not a secret — and it is an IP LITERAL rather than `localhost` so the
 * default path involves no name resolution at all (see `inspectLoopback`).
 */
export const LOCAL_MODEL_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Our deadline for a completion, in ms, when the caller does not name one. See the header. */
export const LOCAL_MODEL_DEFAULT_TIMEOUT_MS = 120_000;

/** Our deadline for enumerating installed models. A manifest read, not a model load. */
export const LOCAL_MODEL_LIST_TIMEOUT_MS = 5_000;

export type LocalModelRole = "system" | "user" | "assistant";

/**
 * One message, already rendered to text by the router. `content` is a string and not a structure
 * for the reason `fireworks.ts` gives: a structure is a thing this file could walk, and walking
 * it is how a second privacy filter gets born out of step with the first.
 */
export interface LocalModelMessage {
  readonly role: LocalModelRole;
  readonly content: string;
}

/** Everything needed to reach the runtime. No credential — a local runtime does not authenticate. */
export interface LocalModelConfig {
  readonly baseUrl: string;
  readonly model: string;
}

/** Why a base URL was refused. Named causes; `not-loopback` is the one that matters. */
export type NonLoopbackReason = "unparsable-url" | "unsupported-scheme" | "not-loopback";

/**
 * The result of parsing a base URL and reading its HOST. Exported so the refusal is testable
 * directly against strings like `http://127.0.0.1.evil.com/` without standing up a config.
 */
export type LoopbackInspection =
  | { readonly state: "loopback"; readonly host: string }
  | {
      readonly state: "refused";
      /** The host as PARSED. Empty string when the URL would not parse at all. */
      readonly host: string;
      readonly reason: NonLoopbackReason;
    };

/**
 * The configuration, or the named reason there is none — a discriminated union rather than
 * `LocalModelConfig | null`, so "not configured" carries WHICH thing is missing all the way to
 * the surface a person reads (`packages/leaf/src/merge.ts` states the general form).
 */
export type LocalModelConfigResult =
  | { readonly state: "configured"; readonly config: LocalModelConfig }
  | {
      readonly state: "no-model-declared";
      readonly missing: readonly LocalModelVariable[];
      /** The base URL that WOULD be used, so a surface can offer to enumerate what is installed. */
      readonly baseUrl: string;
    }
  | {
      readonly state: "refused-non-loopback";
      readonly baseUrl: string;
      readonly host: string;
      readonly reason: NonLoopbackReason;
    };

/** The request. Field-for-field the shape of `FireworksRequest`, so the router renders once. */
export interface LocalModelRequest {
  readonly messages: readonly LocalModelMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  /** Our deadline. Distinct from `no-runtime`: a deadline we set is our fact, not the network's. */
  readonly timeoutMs?: number;
}

/** Counts and timings as the runtime reported them. Every field nullable — any may be omitted. */
export interface LocalModelUsage {
  readonly promptTokens: number | null;
  readonly generatedTokens: number | null;
  /** Nanoseconds, as the runtime reports them. Not converted here — a unit change is a lie vector. */
  readonly totalDurationNs: number | null;
  /** Time spent loading weights. Large on a cold start; that is normal, not a fault. */
  readonly loadDurationNs: number | null;
}

/**
 * Whether the model emitted a private deliberation block, and therefore whether one was thrown
 * away. A named pair rather than a boolean so the surface can SAY which happened; the text
 * itself is never carried. See the header.
 */
export type ThinkingDisposition = "none-returned" | "discarded";

/** One model the runtime holds. `name` is what `FOLIAGE_LOCAL_MODEL` must be set to. */
export interface InstalledModel {
  readonly name: string;
  readonly parameterSize: string | null;
  readonly quantization: string | null;
}

/**
 * A 3xx that was REFUSED rather than followed, on either request. Its own state because it is
 * its own fact: the runtime answered, and what it answered was "go and ask someone else".
 *
 * `host` is the PARSED hostname of the `Location` header, resolved against the URL we asked for
 * so a relative redirect reports the truth too, and `null` when there was no `Location` or it
 * would not parse. A hostname, never the raw header and never a body: a surface can say where
 * the runtime pointed without carrying a string the far end wrote into anything that renders.
 */
export interface RedirectRefusal {
  readonly state: "redirected";
  readonly status: number;
  readonly host: string | null;
}

/**
 * The outcome of enumerating installed models. `listed` with an empty array is a SUCCESS: a
 * runtime that is up and holds nothing is a true state with an obvious next move.
 *
 * The order of `models` is the order the runtime reported. It is not a ranking, and there is
 * nothing in this module that sorts, scores or prefers one model over another.
 */
export type LocalModelListResult =
  | { readonly state: "listed"; readonly models: readonly InstalledModel[] }
  | { readonly state: "no-runtime"; readonly baseUrl: string; readonly detail: string }
  | { readonly state: "timeout"; readonly afterMs: number }
  | { readonly state: "runtime-refused"; readonly status: number }
  | { readonly state: "malformed-response"; readonly detail: string }
  | RedirectRefusal
  | {
      readonly state: "refused-non-loopback";
      readonly baseUrl: string;
      readonly host: string;
      readonly reason: NonLoopbackReason;
    };

/**
 * The outcome of a completion. One state, one set of facts, no boolean and no number that could
 * be read as a rank.
 */
export type LocalModelResult =
  | {
      readonly state: "completed";
      /** May be `""`. That is an answer, not a failure. */
      readonly content: string;
      /** The model we asked for — the identity for the `local-model` provenance arm. */
      readonly requestedModel: string;
      /** The model the runtime said answered. Usually equal; `null` if it did not say. */
      readonly reportedModel: string | null;
      readonly doneReason: string | null;
      readonly usage: LocalModelUsage | null;
      /** Whether a private deliberation block was dropped. The block itself is never returned. */
      readonly thinking: ThinkingDisposition;
    }
  | {
      readonly state: "no-model-declared";
      readonly missing: readonly LocalModelVariable[];
      readonly baseUrl: string;
    }
  | {
      readonly state: "refused-non-loopback";
      readonly baseUrl: string;
      readonly host: string;
      readonly reason: NonLoopbackReason;
    }
  | { readonly state: "no-runtime"; readonly baseUrl: string; readonly detail: string }
  | {
      readonly state: "model-absent";
      readonly model: string;
      /**
       * What the runtime says it DOES hold, so the repair is one command. `null` means the
       * enumeration itself failed — we observed the runtime's own 404 and could not corroborate
       * it. Not a ranking; runtime order.
       */
      readonly installed: readonly string[] | null;
    }
  | { readonly state: "timeout"; readonly afterMs: number }
  /** Status only. No body text ever leaves this function — see the header (BUG-002). */
  | { readonly state: "runtime-refused"; readonly status: number }
  /** A 3xx, refused rather than followed. The loopback gate guards one hop; this guards the rest. */
  | RedirectRefusal
  | { readonly state: "malformed-response"; readonly detail: string };

/** Cap on any detail string we build, so a runaway body cannot become the whole result. */
const DETAIL_MAX = 400;

/**
 * The one address this file will open a socket to. NOT a new decision — see `inspectLoopback`.
 *
 * Duplicated as a LITERAL rather than imported, and that is a constraint, not a preference:
 * `apps/leaf/src/loopbackFetch.ts` owns this decision, and `apps/cos/tsconfig.json` sets
 * `rootDir: "src"`, so a relative import of another app's source is `TS6059 — File … is not
 * under 'rootDir'`. Measured, not assumed (tsc 5.9.3, 2026-08-28). `@foliage/cos-app` and
 * `@foliage/photosynthesis-app` share no workspace package either can put this in without
 * editing a third package. What replaces the import is
 * `apps/photosynthesis/src/loopback.test.ts`, which runs all three gates over one table and
 * fails if any disagrees about any address.
 */
export const LOOPBACK_HOST = "127.0.0.1";

/**
 * PARSE, THEN READ THE HOST. The entire loopback guarantee is these twenty lines, and the thing
 * that makes them a guarantee rather than a comment is that they never look at the input as a
 * string — `new URL` decides where the userinfo ends and the host begins, which is the exact
 * distinction `http://127.0.0.1@evil.com/` exists to blur.
 *
 * NARROWED 2026-08-28, CLOSING F-009. Accepted host: exactly `127.0.0.1`. This function used to
 * accept the whole IPv4 loopback block `127.0.0.0/8`, plus `::1`/`[::1]`, plus the name
 * `localhost`; `apps/photosynthesis/src/policy.ts` accepted only `127.0.0.1`, `::1`, `[::1]` and
 * `localhost`. So `http://127.0.0.2:11434` was loopback to this gate and NOT loopback to that
 * one — two gates disagreeing about what "on this machine" means, in a product whose whole claim
 * is that boundary. Neither was the definition this tree had already argued for.
 *
 * THE DEFINITION ADOPTED IS THAT EXISTING ONE, not a third invented here.
 * `apps/leaf/src/loopbackFetch.ts` — the module that owns the only `fetch` on the leaf app's
 * model path, and which was written knowing about this very disagreement (its header records
 * "separately found two loopback validators that disagreed about whether 127.0.0.2") — takes the
 * strictest reading. Its two reasons, restated so this file can be read alone:
 *   - `localhost` is refused because it is a NAME. It is resolved by a file and a resolver this
 *     process does not control, and an `/etc/hosts` entry or a DNS search domain can point it
 *     somewhere else. The previous paragraph here argued the opposite — that refusing it "would
 *     break the string most people already have in a config file" — and that argument is
 *     withdrawn: convenience for a string someone typed is not worth a resolution step this
 *     process cannot see, and the refusal names the host, so the repair is one edit.
 *   - `::1` and the rest of `127.0.0.0/8` are genuinely loopback per RFC 1122 and are still
 *     refused, because nothing in this product needs them and every address admitted is one
 *     more thing a future reader has to reason about. Widening stays available as a deliberate
 *     decision with a reason; it is not taken as a convenience.
 * `LOCAL_MODEL_DEFAULT_BASE_URL` is the IP literal, so the default path is unaffected by any of
 * this — an operator who set `FOLIAGE_LOCAL_MODEL_BASE_URL=http://localhost:11434` is now
 * refused BY NAME with `not-loopback` and the parsed host, which is the failure direction that
 * cannot leak.
 *
 * THE OBFUSCATED FORMS STILL PASS, so strictness did not regress the bypass tests: `new URL`
 * normalises `http://2130706433`, `http://0x7f.0.0.1`, `http://127.1` and `http://127.0.0.01`
 * to `127.0.0.1` before this function sees a host, and all four are ACCEPTED — correctly, since
 * that is the address they name. `127.0.0.1.evil.com` has five labels, is not an IPv4 address,
 * and stays a domain name.
 *
 * `0.0.0.0` is REFUSED. It is a bind address, not a destination — the "all interfaces" a server
 * listens on, and as a client target it is not loopback.
 *
 * THE SCHEME CHECK IS THIS FILE'S ONLY REMAINING DIFFERENCE from the two other gates, and it is
 * a NARROWING, never a widening: `ftp://127.0.0.1/` is refused here as `unsupported-scheme`
 * where `isLoopbackUrl` and `loopbackHostOf` read only the host. A gate may be stricter than the
 * definition of record; it may never be looser. `loopback.test.ts` asserts exactly that
 * direction rather than plain equality, so this difference is checked instead of assumed.
 *
 * Complexity O(1). Pure, total, no throw: a `URL` constructor failure is caught and named.
 */
export function inspectLoopback(baseUrl: string): LoopbackInspection {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { state: "refused", host: "", reason: "unparsable-url" };
  }

  /* `URL.hostname` is the host with any userinfo, port and path already removed by the parser. */
  const host = url.hostname.toLowerCase();

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { state: "refused", host, reason: "unsupported-scheme" };
  }

  if (host === LOOPBACK_HOST) return { state: "loopback", host };

  return { state: "refused", host, reason: "not-loopback" };
}

/**
 * THE HOP GATE. `inspectLoopback` decides where we may DIAL; this decides that we do not accept
 * being sent somewhere else afterwards. Both `fetch` calls in this file pass `redirect: "manual"`,
 * which in undici hands back the real 3xx with its headers instead of quietly following it, so
 * this function is what turns that response into a named refusal.
 *
 * The five redirect statuses are enumerated rather than tested as a `>= 300 && < 400` range: 304
 * and 305 are in that range and are not redirects a client follows, and a range test would file
 * them as this cause. `Location` is resolved against the URL WE asked for, because a redirect may
 * be relative and `/api/chat` on the same host is still a hop we did not take.
 *
 * Returns `null` when the response is not a redirect, so a call site reads as one line.
 *
 * Complexity O(1). Pure, total, no throw.
 */
function inspectRedirect(response: Response, requestUrl: string): RedirectRefusal | null {
  /* The mechanism moved to ./redirect.ts so the ESCALATED arm calls the same function. It had the
     identical exposure with worse stakes and no guard — see that file's header. What stays here is
     only the mapping into this arm's own vocabulary, which route.ts requires to remain distinct. */
  const hop = sharedInspectRedirect(response, requestUrl, DETAIL_MAX);
  return hop === null ? null : { state: "redirected", status: hop.status, host: hop.host };
}

/* `isIpv4Loopback` — a `127.0.0.0/8` octet parser — lived here until 2026-08-28. It went with
   the block it admitted (F-009): once the accepted set is the single literal `127.0.0.1`, the
   WHATWG parser has already done the whole job, and a second address parser kept "for later" is
   another definition waiting to drift out of step with this one. `git log` has it. */

/**
 * PURE. Takes the environment as a value rather than reaching for `process.env`, so the absent
 * case can be tested for real by passing `{}` — no global mutation, and no test that only proves
 * it can delete a variable it just set.
 */
export function resolveLocalModelConfig(
  env: Readonly<Record<string, string | undefined>>,
): LocalModelConfigResult {
  const model = nonEmpty(env["FOLIAGE_LOCAL_MODEL"]);
  const baseUrl = nonEmpty(env["FOLIAGE_LOCAL_MODEL_BASE_URL"]) ?? LOCAL_MODEL_DEFAULT_BASE_URL;

  /* The host is checked BEFORE the model, and a non-loopback base URL is refused even when
     nothing else is configured. An off-box URL is a fact about the environment worth reporting
     on its own; reporting "no model declared" first would hide it behind a repair that then
     enables it. */
  const loopback = inspectLoopback(baseUrl);
  if (loopback.state === "refused") {
    return { state: "refused-non-loopback", baseUrl, host: loopback.host, reason: loopback.reason };
  }

  if (model === null) {
    return { state: "no-model-declared", missing: ["FOLIAGE_LOCAL_MODEL"], baseUrl };
  }

  return { state: "configured", config: { baseUrl, model } };
}

/** The one place `process.env` is read. Everything below takes the config as an argument. */
export function localModelConfigFromEnvironment(): LocalModelConfigResult {
  return resolveLocalModelConfig(process.env);
}

/**
 * Enumerate what the runtime holds. `GET /api/tags`.
 *
 * This exists so "no model declared" and "model not pulled" have a next move attached instead of
 * being dead ends — the surface can show the person the names they may declare. It is also the
 * corroboration step `callLocalModel` uses on a 404.
 *
 * Takes a BASE URL rather than a config, because the whole point is that it is callable when no
 * model has been declared yet. The loopback gate still runs.
 */
export async function listLocalModels(
  baseUrl: string = LOCAL_MODEL_DEFAULT_BASE_URL,
  timeoutMs: number = LOCAL_MODEL_LIST_TIMEOUT_MS,
): Promise<LocalModelListResult> {
  const loopback = inspectLoopback(baseUrl);
  if (loopback.state === "refused") {
    return { state: "refused-non-loopback", baseUrl, host: loopback.host, reason: loopback.reason };
  }

  const url = `${trimSlashes(baseUrl)}/api/tags`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      /* Not followed. See `inspectRedirect` and the header: the loopback gate guards the URL we
         dial, and a followed redirect is a second destination it never saw. */
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return classifyTransportFailure(error, timeoutMs, baseUrl, "while opening the connection");
  }

  /* BEFORE `ok`, because a 3xx is not ok and would otherwise be filed as `runtime-refused` —
     which is the collapse of two different facts this file exists to avoid. */
  const redirect = inspectRedirect(response, url);
  if (redirect !== null) return redirect;

  if (!response.ok) return { state: "runtime-refused", status: response.status };

  const read = await readBodyText(response);
  if (read.state === "unreadable") {
    return classifyTransportFailure(read.error, timeoutMs, baseUrl, "while reading the response body");
  }

  const parsed = parseJson(read.text);
  if (parsed.state !== "parsed") {
    return { state: "malformed-response", detail: `body is not JSON: ${truncate(parsed.detail)}` };
  }
  const body = asRecord(parsed.value);
  if (body === null) return { state: "malformed-response", detail: "body is not a JSON object" };

  const rawModels = body["models"];
  if (!Array.isArray(rawModels)) {
    return { state: "malformed-response", detail: "models is not an array" };
  }

  const models: InstalledModel[] = [];
  for (const raw of rawModels) {
    const record = asRecord(raw);
    if (record === null) continue;
    /* Ollama sends both `name` and `model`; either is the string a person would declare. An entry
       with neither is skipped rather than given an invented name. */
    const name = stringOrNull(record["name"]) ?? stringOrNull(record["model"]);
    if (name === null) continue;
    const details = asRecord(record["details"]);
    models.push({
      name,
      parameterSize: details === null ? null : stringOrNull(details["parameter_size"]),
      quantization: details === null ? null : stringOrNull(details["quantization_level"]),
    });
  }

  /* An empty list here is a runtime that is up and holds nothing. That is `listed`, not an error. */
  return { state: "listed", models };
}

/**
 * Ask the local model, or refuse with the cause. `POST /api/chat`, `stream: false`.
 *
 * Never throws. On a 404 it makes ONE extra request (`/api/tags`) before deciding, because a 404
 * alone is ambiguous — it is what this runtime returns for an unpulled model, and it is also what
 * any other HTTP server on that port returns for a path it does not serve. Corroborating turns a
 * guess into an observation: if the model is genuinely absent we say so AND list what is present;
 * if the model IS present, the 404 was about something else and it is reported as
 * `runtime-refused` with the status rather than sending a person to `ollama pull` a model they
 * already have. Neither branch reads the error body — status only (BUG-002).
 */
export async function callLocalModel(
  request: LocalModelRequest,
  configResult: LocalModelConfigResult,
): Promise<LocalModelResult> {
  if (configResult.state === "no-model-declared") {
    return { state: "no-model-declared", missing: configResult.missing, baseUrl: configResult.baseUrl };
  }
  if (configResult.state === "refused-non-loopback") {
    return {
      state: "refused-non-loopback",
      baseUrl: configResult.baseUrl,
      host: configResult.host,
      reason: configResult.reason,
    };
  }

  const config = configResult.config;

  /* THE SECOND GATE, AND THE REASON THIS FAILS CLOSED. The config we were handed is re-checked
     here, immediately before the only `fetch` on the completion path, so a hand-built config or
     an edited default constant cannot reach the network. */
  const loopback = inspectLoopback(config.baseUrl);
  if (loopback.state === "refused") {
    return {
      state: "refused-non-loopback",
      baseUrl: config.baseUrl,
      host: loopback.host,
      reason: loopback.reason,
    };
  }

  const timeoutMs = request.timeoutMs ?? LOCAL_MODEL_DEFAULT_TIMEOUT_MS;
  const url = `${trimSlashes(config.baseUrl)}/api/chat`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildRequestBody(request, config.model)),
      /* THE THIRD GATE, and the one the first two could not stand in for. Undici follows
         redirects by default and a 307 preserves the method AND the body, so without this a
         process listening on the trusted port could hand this person's material to any host it
         named. Refused, never followed — see `inspectRedirect`. */
      redirect: "manual",
      /* An `AbortSignal.timeout` abort arrives as a TimeoutError, which is how the classifier
         below tells OUR deadline apart from a dead runtime instead of guessing. */
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return classifyTransportFailure(error, timeoutMs, config.baseUrl, "while opening the connection");
  }

  /* Before both the 404 branch and `ok`, for the same reason as in `listLocalModels`: 3xx is a
     distinct fact and must not be absorbed by a neighbouring one. */
  const redirect = inspectRedirect(response, url);
  if (redirect !== null) return redirect;

  if (response.status === 404) return await classify404(config, timeoutMs);
  if (!response.ok) return { state: "runtime-refused", status: response.status };

  const read = await readBodyText(response);
  if (read.state === "unreadable") {
    /* A 200 whose body died mid-read is a transport failure, not a malformed completion — the
       runtime may have produced a perfectly good one. Reported as such, with the phase named. */
    return classifyTransportFailure(read.error, timeoutMs, config.baseUrl, "while reading the response body");
  }

  return parseChatResponse(read.text, config.model);
}

/** See `callLocalModel`. One extra round trip, on the failure path only. */
async function classify404(config: LocalModelConfig, timeoutMs: number): Promise<LocalModelResult> {
  const listing = await listLocalModels(config.baseUrl, Math.min(LOCAL_MODEL_LIST_TIMEOUT_MS, timeoutMs));
  if (listing.state !== "listed") {
    /* The runtime's own 404 is what we observed; we could not corroborate it. `installed: null`
       says exactly that, and it is still `model-absent` rather than `no-runtime` because a
       response DID arrive. */
    return { state: "model-absent", model: config.model, installed: null };
  }
  const names = listing.models.map((m) => m.name);
  if (names.includes(config.model)) return { state: "runtime-refused", status: 404 };
  return { state: "model-absent", model: config.model, installed: names };
}

/**
 * The wire body, enumerated. FOUR keys, asserted by a test against the bytes a real server
 * received, so a fifth cannot appear without the test failing. In particular there is no
 * `format` key: a constrained decoder cannot decline (ENGINEERING-PLAN §11), and this transport
 * sends no schema at all.
 */
function buildRequestBody(
  request: LocalModelRequest,
  model: string,
): Readonly<Record<string, unknown>> {
  return {
    model,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    options: { temperature: request.temperature, num_predict: request.maxTokens },
  };
}

/**
 * A 200 body becomes a completion or a named refusal to read it. Every branch says which part of
 * the shape was wrong, because "malformed response" alone is unactionable at 2am.
 */
function parseChatResponse(bodyText: string, requestedModel: string): LocalModelResult {
  const parsed = parseJson(bodyText);
  if (parsed.state !== "parsed") {
    return { state: "malformed-response", detail: `body is not JSON: ${truncate(parsed.detail)}` };
  }

  const body = asRecord(parsed.value);
  if (body === null) return { state: "malformed-response", detail: "body is not a JSON object" };

  /* A streamed body is a sequence of JSON objects, so a caller that flipped `stream` would get a
     parse failure on line two rather than here. Named separately because the repair differs. */
  const message = asRecord(body["message"]);
  if (message === null) {
    return { state: "malformed-response", detail: "message is not an object — no assistant turn in the response" };
  }

  if (!("content" in message)) {
    return { state: "malformed-response", detail: "message.content is absent" };
  }

  const rawContent = message["content"];
  /* `null` content is what a runtime sends when the model emitted no text. Length zero is an
     answer, and the rule is that it is a success. */
  const content = rawContent === null ? "" : rawContent;
  if (typeof content !== "string") {
    return { state: "malformed-response", detail: `message.content is ${typeName(rawContent)}` };
  }

  /* READ, MEASURED, DROPPED. The block is inspected only to report that it existed; the text
     itself is not carried into the returned value and therefore cannot be displayed, stored,
     or promoted. See the header. */
  const thinkingText = stringOrNull(message["thinking"]);
  const thinking: ThinkingDisposition =
    thinkingText !== null && thinkingText.length > 0 ? "discarded" : "none-returned";

  return {
    state: "completed",
    content,
    requestedModel,
    reportedModel: stringOrNull(body["model"]),
    doneReason: stringOrNull(body["done_reason"]),
    usage: {
      promptTokens: finiteNumber(body["prompt_eval_count"]),
      generatedTokens: finiteNumber(body["eval_count"]),
      totalDurationNs: finiteNumber(body["total_duration"]),
      loadDurationNs: finiteNumber(body["load_duration"]),
    },
    thinking,
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
 * Our deadline, or nothing listening. An `AbortSignal.timeout` abort surfaces as `TimeoutError`;
 * an `AbortError` is treated the same because the only signal passed here is ours. Everything
 * else is the connection failing, and the OS code (`ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`) is
 * carried, because `no-runtime` without it is the same shrug as `commitCount: 0`.
 *
 * The return type is the intersection of the two unions' shared members, so one classifier serves
 * both `callLocalModel` and `listLocalModels` — which is what keeps the two paths' vocabulary
 * from drifting.
 */
function classifyTransportFailure(
  error: unknown,
  timeoutMs: number,
  baseUrl: string,
  phase: string,
):
  | { readonly state: "timeout"; readonly afterMs: number }
  | { readonly state: "no-runtime"; readonly baseUrl: string; readonly detail: string } {
  const name = errorName(error);
  if (name === "TimeoutError" || name === "AbortError") return { state: "timeout", afterMs: timeoutMs };
  return { state: "no-runtime", baseUrl, detail: `${describeError(error)} (${phase})` };
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function trimSlashes(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

// jscpd:ignore-start — identical to the same four helpers in fireworks.ts; historical
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

/** Name, message, and the OS code when there is one. Never a prompt, never a completion. */
function describeError(error: unknown): string {
  const record = asRecord(error);
  const message = record === null ? undefined : record["message"];
  const cause = record === null ? null : asRecord(record["cause"]);
  const code = cause === null ? undefined : cause["code"];
  const head = `${errorName(error)}: ${typeof message === "string" ? message : String(error)}`;
  return typeof code === "string" ? `${head} [${code}]` : head;
}

function truncate(text: string): string {
  return text.length <= DETAIL_MAX ? text : `${text.slice(0, DETAIL_MAX)}…`;
}
// jscpd:ignore-end
