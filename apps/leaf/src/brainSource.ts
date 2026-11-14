/**
 * Reading a real personal knowledge base — through the retrieval layer that already exists —
 * and, only when asked, showing the selected pages to a local model.
 *
 * The I/O half of the knowledge-base light source. Everything here is measurement: ask the
 * vault which pages answer a question, open exactly those, and hand them to a model on
 * loopback. What any of it MEANS about proof is not decided here — that is
 * `brainNotesToCandidates` in @foliage/photosynthesis, for the same reason the tiering rule is
 * not in `gitIntake.ts`.
 *
 * RETRIEVAL IS NOT REIMPLEMENTED, IT IS INVOKED. `tools/vault` already ranks every node in the
 * vault with BM25 over an index built once, walks the link graph from the top few seeds, and
 * fills a token budget — measured on this machine: 99 nodes and 746 edges indexed in ~118ms, and
 * a question answered in 16ms, with 10 index entries scoring above zero, NO FILE OPENED AND NO
 * MODEL CALLED. That property is the whole reason this source can be audited, and re-deriving the
 * ranking here would fork it. So this module SPAWNS `tools/vault/ask.mjs --json`, exactly as
 * `gitIntake.ts` spawns `git`: a program on the machine, at a path the operator can override,
 * whose output is parsed. There is no import, no package dependency, and therefore nothing for
 * the licensing boundary to catch — @foliage/leaf-app does not grow an edge to a tool that
 * belongs to no plane.
 *
 * THE RULES THIS FILE ENFORCES:
 *
 *   A MISSING INDEX IS A NAMED CAUSE, NEVER AN EMPTY RESULT. "The vault has not been built" and
 *   "nothing in the vault answers this" are opposite facts that would otherwise print the same
 *   zero — the `commitCount: 0` collapse this repository exists to refuse. The index is
 *   stat'ed before the retriever is spawned, so the cause is named with its one-line remedy
 *   rather than inferred from a subprocess's prose. NO STDERR TEXT IS MATCHED ANYWHERE: that
 *   string moves with the tool's version, and a path on disk does not.
 *
 *   THE SOURCE SCOPE IS RE-ENFORCED HERE, AND WHAT IT EXCLUDES IS NAMED. MEASURED against the
 *   real index on this machine: `ask.mjs "…" --source brain --max 4` returned four pages, and
 *   TWO of them were `memory:` — reached at depth 1 and depth 2 by following `links_to` edges out
 *   of a `brain:` seed. The retriever applies the source scope when it SCORES (`rank.mjs` skips a
 *   node outside `router.sources`) and the graph walk that follows does not, which is a
 *   defensible choice for a question-answering pack and the wrong one for evidence: the operator
 *   said which body of notes a portfolio claim may rest on. Worse, the third-party directory
 *   convention `brainPageKind` reads belongs to ONE source, so a page from another one comes back
 *   `unclassified` — which reads as "the path said nothing" when the truth is that the whole
 *   convention does not describe it. So the scope is applied again to the SELECTED set, from each
 *   node's own id prefix, and every page it removes is returned in `outOfScope` and printed. Not
 *   silently dropped and not silently included: the walk found a real link and the operator is
 *   entitled to widen `--source` if they want it.
 *
 *   EVERY SELECTED PAGE IS CONFIRMED TO EXIST, IN BOTH MODES, BEFORE ANYTHING IS DRAFTED OR
 *   WRITTEN — and this is the one rule here that a reader should not mistake for bookkeeping.
 *   The retrieval ranks INDEX ENTRIES; an index describes the disk as it was when the index was
 *   built. Delete a page afterwards and the entry survives, so without this step a candidate
 *   could carry an evidence ref to a file that is not there, stamped with an `observedAt`
 *   asserting somebody observed it at a moment when it did not exist. A citation that looks
 *   checkable and resolves to nothing is worse than an uncited claim: it defeats the inspection
 *   it invites. `confirmPages` therefore `stat`s every selected page and hands back one
 *   `observedAt` per page — the instant that page's own `stat` returned.
 *
 *   IT COSTS THE AUDITABLE PROPERTY NOTHING. `stat` reads a directory entry, never a byte of the
 *   page, so "no file was opened" still describes the retrieval and this check alike, and the
 *   deterministic mode still puts no note content anywhere. What it does cost is that a stale
 *   index now stops the command instead of being written into a document — which is the trade
 *   this repository makes everywhere: `readCommits` writes no leaf from a failed read, and
 *   `readPages` below refuses a partial pack for the same reason.
 *
 *   A PAGE THAT CANNOT BE OPENED STOPS THE COMMAND. The retriever selects a set; drafting from
 *   a subset of it, silently, would ask the model to write about a body of work with a hole in
 *   it and would produce claims whose evidence set is smaller than the report says. Every
 *   selected page is read or nothing is drafted.
 *
 *   THE MODEL PATH IS LOOPBACK ONLY AND FAILS CLOSED, THROUGH ONE SHARED GUARD. The host check
 *   and the `fetch` both live in `loopbackFetch.ts` — this file no longer parses a hostname of
 *   its own, and neither do `photoSource.ts` or `harvest.mjs`. It used to: three copies of the
 *   same rule, which is three chances for a future edit to strengthen one and leave two, and
 *   nothing fails when they drift because each copy passes its own tests. A personal knowledge
 *   base is the last thing that should leave a machine by accident, so there is one definition
 *   of where it may go.
 *
 *   `redirected` IS ITS OWN CAUSE, DISTINCT FROM `unreachable`. Checking the hostname and then
 *   calling `fetch` without `redirect: "manual"` left a real hole: a 307 PRESERVES METHOD AND
 *   BODY, so an endpoint answering on the trusted port could name any host and undici would
 *   carry the prompt — somebody's private notes — there. Measured on two live servers before the
 *   guard existed. The claim and the effect were derived from DIFFERENT VALUES: the loopback
 *   claim came from the configured url, the effect happened on the socket actually opened.
 *   The two causes stay apart because the remedies are opposite — something is redirecting your
 *   trusted port, versus the model is down — and folding them would send the operator to restart
 *   ollama instead of asking who is answering on 11434.
 *
 *   Every failure (not-loopback, redirected, unreachable, timed out, non-200, cut off,
 *   unparseable) is a named cause, and the caller's only correct response is to write nothing.
 *
 * WHY EVERY FIELD OF THE MODEL'S SCHEMA IS NULLABLE, and it is the most important line in this
 * file: ollama's `format` is GRAMMAR-ENFORCED, so the decoder physically cannot emit a token
 * outside the schema. That is a guarantee about SHAPE and it becomes a hazard the moment a
 * required field's answer is not in the pages — the only way to satisfy the grammar is then to
 * invent one. So the schema asks for `["string", "null"]` and `["array", "null"]` throughout,
 * the prompt says that answering null is correct, and a null arrives here as a null and leaves
 * as an absence.
 *
 * AND WHY THE CITATIONS ARE CHECKED SOMEWHERE ELSE. This module hands the model a set of paths
 * and returns what it said, verbatim, including a path it invented. Deciding that an invented
 * citation refuses the draft is a rule about what evidence means, so it lives in the domain
 * where the person being described can read it.
 *
 * `node:child_process`, `node:fs`, `node:path` and `fetch` are all built in, so the
 * zero-third-party-runtime-dependency claim is unaffected.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DraftedLeaflet, RetrievedNode, SelectedNode } from "@foliage/photosynthesis";

import { loopbackFetch, loopbackHostOf, type LoopbackFailure } from "./loopbackFetch.ts";

/**
 * The retrieval tool, relative to this file. A default, not an assumption: `--vault` overrides
 * it, and the override is what makes a fork holding only the open packages able to point at its
 * own copy instead of at a directory that is not there.
 */
const DEFAULT_VAULT_DIR = fileURLToPath(new URL("../../../tools/vault/", import.meta.url));

/** Where that tool writes its built index. Checked directly, so its absence has its own cause. */
const INDEX_RELATIVE_PATH = join(".vault", "index.jsonl");

/** The command that builds it, quoted in the remedy so nobody has to go looking. */
export const VAULT_BUILD_COMMAND = "pnpm run vault:build";

/**
 * Ceiling on one retrieval. The measured run is 16ms of scoring after a ~118ms build, so a
 * retriever still running after this is wedged rather than slow — and a wedged subprocess must
 * fail with a cause, never hang a command the operator is watching.
 */
const RETRIEVER_TIMEOUT_MS = 60_000;

/** The vault source whose directory convention `brainPageKind` knows. Overridable. */
export const DEFAULT_VAULT_SOURCE = "brain";

/** The local model endpoint. LOOPBACK ONLY — enforced by `loopbackFetch`, never by this line. */
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/generate";

/**
 * The model asked to draft. Exported so the CLI's usage text names the model this file will
 * actually call — a help string that has drifted from the code is a lie with a long half-life,
 * and one constant cannot drift from itself.
 */
export const LOCAL_DRAFTER_MODEL = "gemma4:12b";

/**
 * Per-request ceiling, and it is DELIBERATELY MUCH HIGHER than the other two model paths.
 *
 * This path sends far more than they do — a whole retrieval pack, not one commit cluster or one
 * image — and the four real runs on the one machine this has executed on say the spread is what
 * matters, not the mean. Same question, same two pages, 15,053 characters sent, gemma4:12b:
 *
 *   180s+  the FIRST invocation, cold, alongside a running test suite — it hit the 180s ceiling
 *          the other two paths use, so that ceiling failed closed on a request that was working
 *   63s    cold, model unloaded first (verified via /api/ps returning no models), machine quiet
 *   33s    warm
 *   105s   warm, machine busier
 *
 * A ceiling set near the largest measurement turns an ordinary busy minute into a failed
 * command, and this failure is total by design — nothing is written and no substitute title is
 * produced — so the cost of being too tight is losing a real answer, while the cost of being too
 * loose is waiting. 600s is roughly six times the slowest run observed.
 *
 * That is only tolerable because the wait is ANNOUNCED (the CLI says the request may take
 * minutes before it blocks) and the failure is loud. `stream: false` means there is no progress
 * to show, so silence has to be advertised in advance or it reads as a hang.
 */
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Ceiling on the model's OUTPUT, in tokens, sent EXPLICITLY rather than left to the server.
 *
 * MEASURED on this machine, on the photograph path, and it is the reason this constant exists:
 * with no `num_predict` in the request the server's own default cut an answer off at 128 tokens
 * MID-STRING, so the grammar never closed the JSON object. This path asks for a LIST, which is
 * strictly longer than one description, so the ceiling is higher — and an answer that still
 * overruns it is reported as `cut-off`, its own cause, because a truncated list is missing
 * leaflets and looks exactly like a model that had less to say.
 */
const MAX_ANSWER_TOKENS = 1_200;

/**
 * How much of one page is shown to the model.
 *
 * A cap rather than a silent trim: which pages were truncated is returned, printed, AND RECORDED
 * ON THE CANDIDATE, because a claim drafted off the first half of a page is still cited to the
 * whole page. Printing it at propose time alone was not enough — the line scrolled past, the
 * document said nothing about it, and `review` days later showed a citation to a whole page with
 * no hint that the model had seen a fraction. It now travels as `shownPages.charsShown` /
 * `charsInPage`. ~12k characters is roughly 3k tokens by the vault's own chars/4 estimate —
 * larger than every page in the vault this was built against except the longest few, which are
 * exactly the ones worth flagging.
 */
const MAX_PAGE_CHARS = 12_000;

/**
 * The JSON Schema handed to ollama's `format`. EVERY FIELD IS NULLABLE — see the header. There
 * is no field here that could hold a rating, a confidence, or a count that reads like one, and
 * there never will be: the schema is part of the product's posture, not a serialization detail.
 *
 * `citedPaths` is asked for as strings the model must COPY. That is the one thing a language
 * model is reliably good at in this shape — reproducing a token it can see — and it is what
 * makes the domain's check possible: a copied path resolves, an invented one does not.
 */
const DRAFT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    leaflets: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          title: { type: ["string", "null"] },
          citedPaths: { type: ["array", "null"], items: { type: "string" } },
        },
        required: ["title", "citedPaths"],
        additionalProperties: false,
      },
    },
  },
  required: ["leaflets"],
  additionalProperties: false,
});

/** One page, ready to be shown: the node it came from and the text that was actually read. */
export interface PageText {
  readonly node: RetrievedNode;
  /** The page as read, capped at `MAX_PAGE_CHARS`. */
  readonly text: string;
  /** The page's full length in characters when it was capped, or null when it was not. */
  readonly truncatedFrom: number | null;
}

/** A page the walk reached outside the source(s) the operator scoped to. Named, never dropped. */
export interface OutOfScopeNode {
  readonly id: string;
  readonly path: string;
  /** The vault source it actually belongs to, read from its own id prefix. */
  readonly source: string;
}

/**
 * What the vault selected, plus what that selection cost — so the CLI can print the reduction
 * the retrieval actually achieved instead of asserting one.
 */
export type VaultRetrieval =
  | {
      readonly ok: true;
      /**
       * The selected pages, in the retriever's own order. `SelectedNode`, not `RetrievedNode`:
       * this step ranked index entries and opened nothing, so nothing here has been observed on
       * disk yet. `confirmPages` is what turns a selection into an observation.
       */
      readonly nodes: readonly SelectedNode[];
      /**
       * Pages the retriever selected and this module removed because they belong to a source the
       * operator did not ask for — see the header; the walk crosses the scope the scoring
       * applied. Empty when no scope was requested, which is the only case where "in scope"
       * means nothing.
       */
      readonly outOfScope: readonly OutOfScopeNode[];
      /**
       * Estimated tokens in the pack, as THE RETRIEVER counted it — which is before `outOfScope`
       * was removed. Reported under the retriever's own meaning rather than recomputed here: this
       * module never opens a page to build this number and has no token estimator of its own, so
       * a recomputed figure would be a second estimate wearing the first one's name. When
       * `outOfScope` is non-empty this is therefore larger than what was drafted from, and the
       * CLI prints both so the two reconcile instead of one quietly standing for the other.
       */
      readonly packTokensEst: number;
      /** Estimated tokens in the whole vault — the number this retrieval avoided reading. */
      readonly wholeVaultTokensEst: number;
      /**
       * How many index entries the ranking gave a non-zero score — i.e. how many pages MATCHED
       * the question, not how many were examined. The retriever calls this `candidatesScored`
       * and prints it as "scored N index entries", which reads as the second thing; it is
       * reported here under the name of what it actually counts, because a number this command
       * prints beside the word "honest" has to be one.
       */
      readonly matched: number;
      readonly elapsedMs: number;
      /** Nodes the walk reached and could not afford. Raising --budget includes them. */
      readonly skippedForBudget: number;
      /** Where the index that answered this lives, for the report. */
      readonly indexPath: string;
    }
  | {
      readonly ok: false;
      /**
       * `no-index` is separate from every other cause and it is the one that matters most: an
       * unbuilt vault must never be reported as a vault with nothing in it.
       */
      readonly cause:
        | "no-index"
        | "retriever-missing"
        | "retriever-failed"
        | "unparseable-retrieval";
      readonly detail: string;
    };

export interface RetrieveOptions {
  /** Directory holding `ask.mjs` and `.vault/index.jsonl`. */
  readonly vaultDir?: string;
  /** Vault sources to search, comma-separated, as `ask.mjs --source` takes them. */
  readonly sources?: string;
  readonly budgetTokens?: number;
  readonly maxNodes?: number;
  readonly timeoutMs?: number;
}

export type PageReadOutcome =
  | { readonly ok: true; readonly pages: readonly PageText[] }
  | {
      readonly ok: false;
      readonly cause: "unreadable-page";
      readonly detail: string;
      readonly path: string;
    };

export type DraftOutcome =
  | {
      readonly ok: true;
      /** Exactly what the model said, verbatim. Citations are checked in the domain. */
      readonly drafts: readonly DraftedLeaflet[];
      /** How many characters of page text were sent, so the operator sees what was shown. */
      readonly sentChars: number;
      readonly elapsedMs: number;
    }
  | {
      readonly ok: false;
      /**
       * `timed-out` is SEPARATE from `unreachable` because the remedies are opposite — a dead
       * port means start the model, a ceiling reached by a model that is running and answering
       * means the machine is busy — and the operator cannot tell them apart from the text.
       * `cut-off` is separate from `unparseable` for the same reason: an answer stopped at the
       * output ceiling is missing leaflets, which is a different problem from a model that
       * ignored its grammar.
       *
       * `redirected` is separate from BOTH, and it is the one that is not about the model at
       * all: the endpoint answered a 3xx, so something on the port this operator trusts is
       * trying to move their notes somewhere else. The redirect was not followed and nothing
       * was sent to the named host. Reported as `unreachable` it would read as "start ollama",
       * which is the one action that does not address it.
       */
      readonly cause:
        | "not-loopback"
        | "redirected"
        | "no-pages"
        | "unreachable"
        | "timed-out"
        | "http-error"
        | "cut-off"
        | "unparseable";
      readonly detail: string;
    };

export interface DraftOptions {
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String(err.code);
  return "UNKNOWN";
}

/**
 * Both causes, always — the AGENTS.md error-masking rule. `fetch` wraps the real socket error
 * in `cause`, and printing only "fetch failed" is how a connection refusal becomes a mystery.
 */
function messageWithCause(err: unknown): string {
  const outer = messageOf(err);
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : undefined;
  return cause === undefined ? outer : `${outer} (cause: ${messageOf(cause)})`;
}

/**
 * The shared guard's refusal, said in the vocabulary `DraftOutcome` already published.
 *
 * A TRANSLATION, NOT A SECOND CHECK. `loopbackFetch` decided; this only names the decision in the
 * words a caller of this module already handles, so closing the redirect hole did not oblige
 * every consumer to learn a second set of cause names.
 *
 * Two of the guard's causes land on ONE of ours on purpose. A string that will not parse as a URL
 * has no host to check, and this module has always reported that as `not-loopback`; splitting it
 * out now would change a published discriminant without changing what happened — the endpoint was
 * refused and nothing was sent.
 *
 * `redirected` does NOT land on `unreachable`, which is the whole point of the guard: see the
 * type above.
 */
function draftFailure(
  failure: LoopbackFailure,
  model: string,
  endpoint: string,
  timeoutMs: number,
): DraftOutcome {
  switch (failure.cause) {
    case "not-loopback":
    case "malformed-endpoint":
      return {
        ok: false,
        cause: "not-loopback",
        detail:
          `refusing to draft: ${failure.detail} A personal knowledge base is the last thing that ` +
          `should leave a machine by accident. Nothing was drafted and nothing was written.`,
      };
    case "redirected":
      return {
        ok: false,
        cause: "redirected",
        detail:
          `refusing to draft: ${failure.detail} The pages retrieved for this question were NOT ` +
          `sent to that location, nothing was drafted and nothing was written. This is not the ` +
          `model being down — restarting it changes nothing — so the question to answer is what ` +
          `is answering on ${endpoint}.`,
      };
    case "unreachable":
      // WHICH failure, from the error's NAME rather than its message. `AbortSignal.timeout`
      // rejects with a DOMException whose name is "TimeoutError" — fixed by the web standard,
      // where the message is a string that moves with the runtime. The guard carries the thrown
      // value out precisely so this distinction survives the move into it.
      if (failure.error instanceof Error && failure.error.name === "TimeoutError") {
        return {
          ok: false,
          cause: "timed-out",
          detail:
            `${model} at ${endpoint} did not answer within ${timeoutMs}ms and the request was ` +
            `aborted at that ceiling: ${messageWithCause(failure.error)}. This is NOT a refused ` +
            `connection — a loaded machine, a cold model load and a large pack all look like ` +
            `this — so raising the ceiling is the first thing to try, not starting a server that ` +
            `may already be running. Nothing was drafted and nothing was written.`,
        };
      }
      return {
        ok: false,
        cause: "unreachable",
        detail:
          `${model} at ${failure.detail}. Nothing was drafted and nothing was written — no ` +
          `deterministic titles were substituted.`,
      };
  }
}

/**
 * The page's path INSIDE the knowledge base, taken from the retrieval id.
 *
 * The vault's ids are `<source>:<path relative to that source's root, without extension>` —
 * built by `nodeId` in tools/vault/lib/vault.mjs and stable by construction. Deriving the
 * relative path from the id rather than from the absolute path is what lets this work without
 * knowing where the knowledge base is rooted, and the id is the retriever's own contract with
 * itself rather than a string this file guesses at.
 */
export function relativePageId(nodeId: string): string {
  const cut = nodeId.indexOf(":");
  return cut === -1 ? nodeId : nodeId.slice(cut + 1);
}

/**
 * The vault SOURCE a page belongs to, taken from the other half of the same id.
 *
 * The counterpart of `relativePageId`, and read from the same contract (`nodeId` in
 * tools/vault/lib/vault.mjs builds `<source>:<relative path>`), so the two cannot disagree about
 * where the colon is. An id with no colon has no source in it, and the empty string it returns
 * matches no requested scope — which is the correct answer: a page this module cannot place is
 * not one it can vouch for being in scope.
 */
export function vaultSourceOf(nodeId: string): string {
  const cut = nodeId.indexOf(":");
  return cut === -1 ? "" : nodeId.slice(0, cut);
}

interface Run {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly detail: string;
}

/**
 * Run a program once, with no shell: arguments go to execFile directly, so a question
 * containing a space, a quote or a `;` is one argument and cannot be re-interpreted.
 *
 * `maxBuffer` is raised because the retriever's `--json` answer carries one entry per node it
 * considered; the default 1 MB is a limit this code did not choose, and hitting it would look
 * like a parse failure.
 */
function run(program: string, args: readonly string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      program,
      [...args],
      { timeout: timeoutMs, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err === null) {
          resolvePromise({ ok: true, stdout, stderr, detail: "" });
          return;
        }
        resolvePromise({
          ok: false,
          stdout,
          stderr,
          detail: `${messageOf(err)} [${codeOf(err)}]`,
        });
      },
    );
  });
}

/**
 * Ask the vault which pages answer a question.
 *
 * Deterministic in the sense that matters: no model is called and no page is opened to produce
 * this answer — the ranking runs over index entries the build step extracted once. Complexity
 * is the retriever's: O(query terms × postings) over the index, then a bounded graph walk.
 */
export async function retrieveFromVault(
  question: string,
  options: RetrieveOptions = {},
): Promise<VaultRetrieval> {
  const vaultDir = options.vaultDir === undefined ? DEFAULT_VAULT_DIR : resolve(options.vaultDir);
  const indexPath = join(vaultDir, INDEX_RELATIVE_PATH);
  const askPath = join(vaultDir, "ask.mjs");

  // THE INDEX FIRST, because its absence is the one failure that would otherwise print as an
  // empty result. Stat'ed rather than inferred from the retriever's exit code, so the remedy is
  // named exactly and no prose is matched.
  try {
    await stat(indexPath);
  } catch (err) {
    const code = codeOf(err);
    return {
      ok: false,
      cause: code === "ENOENT" ? "no-index" : "retriever-failed",
      detail:
        code === "ENOENT"
          ? `no retrieval index at ${indexPath}. Run \`${VAULT_BUILD_COMMAND}\` first — it ` +
            `walks the declared sources once and writes the index this reads. Nothing was ` +
            `retrieved, and NO EMPTY RESULT was reported in its place: "the vault has not been ` +
            `built" and "nothing in the vault answers this" are opposite facts.`
          : `${indexPath} could not be examined: ${messageOf(err)} [${code}]`,
    };
  }
  try {
    await stat(askPath);
  } catch (err) {
    return {
      ok: false,
      cause: "retriever-missing",
      detail:
        `no retrieval command at ${askPath}: ${messageOf(err)} [${codeOf(err)}]. Point ` +
        `--vault at the directory holding ask.mjs and its .vault index.`,
    };
  }

  // The question goes FIRST: ask.mjs takes the first non-flag argument as the question, so a
  // flag value placed before it would be read as the question instead.
  const args = [askPath, question, "--json"];
  const scope = new Set(
    (options.sources ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
  if (scope.size > 0) args.push("--source", [...scope].join(","));
  if (options.budgetTokens !== undefined) args.push("--budget", String(options.budgetTokens));
  if (options.maxNodes !== undefined) args.push("--max", String(options.maxNodes));

  const started = Date.now();
  const answered = await run(
    process.execPath,
    args,
    options.timeoutMs ?? RETRIEVER_TIMEOUT_MS,
  );
  if (!answered.ok) {
    return {
      ok: false,
      cause: "retriever-failed",
      detail:
        `${askPath} failed: ${answered.detail}. It printed: ` +
        `${JSON.stringify(answered.stderr.trim().slice(0, 400) || "(nothing on stderr)")}. ` +
        `Nothing was retrieved and nothing was written.`,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(answered.stdout);
  } catch (err) {
    return {
      ok: false,
      cause: "unparseable-retrieval",
      detail:
        `${askPath} --json did not print JSON (${messageOf(err)}): ` +
        `${JSON.stringify(answered.stdout.trim().slice(0, 200))}`,
    };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      cause: "unparseable-retrieval",
      detail: `${askPath} --json printed ${JSON.stringify(payload).slice(0, 120)}, not an object.`,
    };
  }
  const body = payload as Record<string, unknown>;
  const selected = body["selected"];
  if (!Array.isArray(selected)) {
    return {
      ok: false,
      cause: "unparseable-retrieval",
      detail: `${askPath} --json carried no "selected" array: ${JSON.stringify(payload).slice(0, 200)}`,
    };
  }

  const nodes: SelectedNode[] = [];
  const outOfScope: OutOfScopeNode[] = [];
  for (const [i, entry] of selected.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        ok: false,
        cause: "unparseable-retrieval",
        detail: `selected[${i}] is ${JSON.stringify(entry).slice(0, 80)}, not an object.`,
      };
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const path = typeof record["path"] === "string" ? record["path"] : "";
    if (id === "" || path === "") {
      return {
        ok: false,
        cause: "unparseable-retrieval",
        detail:
          `selected[${i}] carries no id/path pair: ${JSON.stringify(entry).slice(0, 120)}. The ` +
          `path is the evidence ref, so a selection without one cannot be evidence.`,
      };
    }
    if (!isAbsolute(path)) {
      return {
        ok: false,
        cause: "unparseable-retrieval",
        detail:
          `selected[${i}] names a relative path "${path}". The ref has to be openable from ` +
          `anywhere the harvest document is read, so a relative one is refused rather than ` +
          `resolved against whatever directory this happened to run in.`,
      };
    }
    // THE SCOPE, RE-APPLIED — see the header. The walk reached this by following a real link, so
    // it is named rather than dropped, and it is removed rather than drafted from.
    const source = vaultSourceOf(id);
    if (scope.size > 0 && !scope.has(source)) {
      outOfScope.push(Object.freeze({ id, path, source }));
      continue;
    }
    nodes.push(Object.freeze({ id, path, relPath: relativePageId(id) }));
  }

  const tokens =
    body["tokens"] !== null && typeof body["tokens"] === "object"
      ? (body["tokens"] as Record<string, unknown>)
      : {};
  const asCount = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  return {
    ok: true,
    nodes: Object.freeze(nodes),
    outOfScope: Object.freeze(outOfScope),
    packTokensEst: asCount(tokens["pack"]),
    wholeVaultTokensEst: asCount(tokens["wholeVault"]),
    matched: asCount(body["candidatesScored"]),
    elapsedMs: Date.now() - started,
    skippedForBudget: Array.isArray(body["skippedForBudget"]) ? body["skippedForBudget"].length : 0,
    indexPath,
  };
}

/**
 * One selected page whose path did not resolve to a file, and exactly how it failed.
 *
 * Three causes, not one, because the remedies differ: a page that is GONE means the index is
 * stale and wants rebuilding; a path that resolves to a directory means the index and the disk
 * disagree about what kind of thing lives there; a path that could not be examined at all
 * (permissions, a symlink loop) is a machine refusing rather than a page missing.
 */
export interface UnresolvedPage {
  readonly node: SelectedNode;
  readonly cause: "no-such-file" | "not-a-file" | "could-not-examine";
  readonly detail: string;
}

export type PagePresence =
  | {
      readonly ok: true;
      /** Every selected page, each carrying the instant its own `stat` returned. */
      readonly pages: readonly RetrievedNode[];
    }
  | {
      readonly ok: false;
      readonly cause: "unresolved-page";
      /** Every page that did not resolve — all of them, so one command names every cause. */
      readonly unresolved: readonly UnresolvedPage[];
      /** How many did resolve, so the report can state the shape of the staleness. */
      readonly confirmed: number;
    };

/**
 * Confirm that every selected page is still there, and record WHEN each was confirmed.
 *
 * THE STEP THAT RUNS IN BOTH MODES — see the header. Deterministic drafting opens no page and
 * must not: without this, its every evidence ref and every `observedAt` would be copied out of a
 * possibly-stale index and nothing would ever have looked at the disk.
 *
 * ALL OR NOTHING, and reported as a whole. A selected page that is not there means the index no
 * longer describes the disk, and a document written from the survivors would be a smaller harvest
 * than the retrieval reported, with no trace of the difference. Every unresolved page is named
 * with its own cause rather than the first one stopping the walk, because an operator fixing a
 * stale index wants the whole list in one pass.
 *
 * `stat` and not `open`: this reads a directory entry, never a byte of the page. Sequential, so
 * the report is in the retriever's own order; O(n) syscalls over a set the budget already caps at
 * ten or so, which is microseconds beside the ~118ms index build behind it.
 */
export async function confirmPages(nodes: readonly SelectedNode[]): Promise<PagePresence> {
  const pages: RetrievedNode[] = [];
  const unresolved: UnresolvedPage[] = [];

  for (const node of nodes) {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(node.path);
    } catch (err) {
      const code = codeOf(err);
      unresolved.push(
        Object.freeze({
          node,
          cause: code === "ENOENT" ? ("no-such-file" as const) : ("could-not-examine" as const),
          detail:
            code === "ENOENT"
              ? `the retrieval index still lists this page and there is no file at that path. ` +
                `The index describes the disk as it was when it was built, so a page moved or ` +
                `deleted since is still in it.`
              : `${messageOf(err)} [${code}]`,
        }),
      );
      continue;
    }
    // The instant the presence was ESTABLISHED, taken once the answer is in hand. It becomes this
    // page's evidence `observedAt`, and it is per page because that is how it was measured.
    const observedAt = new Date().toISOString();
    if (!info.isFile()) {
      unresolved.push(
        Object.freeze({
          node,
          cause: "not-a-file",
          detail:
            `the path resolves to something that is not a regular file, so there is no page ` +
            `there for a reviewer to open.`,
        }),
      );
      continue;
    }
    pages.push(Object.freeze({ ...node, observedAt }));
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      cause: "unresolved-page",
      unresolved: Object.freeze(unresolved),
      confirmed: pages.length,
    };
  }
  return { ok: true, pages: Object.freeze(pages) };
}

/**
 * Open every selected page.
 *
 * All or nothing: one unreadable page stops the command. Drafting from the rest would hand the
 * model a body of work with a hole in it and report a pack size the model never saw — the same
 * undercount `propose-photos` refuses when a file cannot be opened.
 */
export async function readPages(nodes: readonly RetrievedNode[]): Promise<PageReadOutcome> {
  const pages: PageText[] = [];
  for (const node of nodes) {
    let text: string;
    try {
      text = await readFile(node.path, "utf8");
    } catch (err) {
      return {
        ok: false,
        cause: "unreadable-page",
        path: node.path,
        detail:
          `${node.path} was selected by the retriever and could not be read: ` +
          `${messageOf(err)} [${codeOf(err)}]. Nothing was drafted: a pack with a page missing ` +
          `from it is smaller than the one this command would then claim to have used.`,
      };
    }
    const truncated = text.length > MAX_PAGE_CHARS;
    pages.push(
      Object.freeze({
        node,
        text: truncated ? text.slice(0, MAX_PAGE_CHARS) : text,
        truncatedFrom: truncated ? text.length : null,
      }),
    );
  }
  return { ok: true, pages: Object.freeze(pages) };
}

/**
 * The instruction.
 *
 * It asks for what the pages SAY THE PERSON DID, it makes declining the correct answer rather
 * than a failure (the grammar permits null, and the prompt has to say null is wanted or a model
 * trained to be helpful will fill the field anyway), and it asks for citations to be COPIED —
 * the one operation a language model does reliably, and the one that makes the domain's
 * grounding check meaningful.
 */
function draftPrompt(pages: readonly PageText[]): string {
  const blocks = pages
    .map(
      (p, i) =>
        `--- PAGE ${i + 1} OF ${pages.length} ---\ncitedPaths value for this page:\n` +
        `${p.node.path}\n--- text of page ${i + 1} ---\n${p.text}` +
        (p.truncatedFrom === null
          ? ""
          : `\n[this page was cut at ${MAX_PAGE_CHARS} characters of ${p.truncatedFrom}]`),
    )
    .join("\n\n");

  // The citation instruction is worded around a MEASURED failure, and the wording IS the fix.
  // The first version labelled each page `PATH: <path>` and asked for "the PATH line(s) …
  // copied EXACTLY". gemma4:12b obeyed literally and returned `"PATH: <absolute path>/<page>.md"` —
  // the label copied along with the value — and the domain correctly refused the whole draft as a
  // citation it was never given. (The page it was reading is a real one on the machine this was
  // measured on and is not named here; nothing from a real knowledge base belongs in this repo.)
  // That refusal was honest but it was a report about this prompt, not about the model: the
  // label sat on the line it was told to copy. So the value now stands ALONE on its own line
  // under a heading that names the field it belongs to, and the instruction says what must not
  // be included. No answer is normalised on the way back — an exact-match grounding check that
  // repairs near-misses is not one.
  return (
    `Below are ${pages.length} page(s) from one person's own working notes.\n\n` +
    `${blocks}\n\n--- END OF PAGES ---\n\n` +
    `Draft portfolio entries for THIS PERSON, from THESE PAGES ONLY.\n` +
    `- title: one short factual line stating something the person did or built, in the past ` +
    `tense, as the pages state it. No praise, no adjectives of quality, no ratings, no numbers ` +
    `that read like a score.\n` +
    `- citedPaths: for each page that states it, the line printed above under "citedPaths value ` +
    `for this page" — the string beginning with "/" — copied character for character and ` +
    `NOTHING else. No label, no prefix, no quotes, no page number, no text from the page. Cite ` +
    `only strings that appear there. Never write a path that is not one of them.\n` +
    `Draft one entry per distinct piece of work, and never two entries citing the same page ` +
    `set. If the pages do not say what this person did, answer with leaflets: null — answering ` +
    `null is correct and expected. Do not guess, do not describe what is probably there, and do ` +
    `not write about anyone other than the person whose notes these are.`
  );
}

/**
 * Answers that are an ABSENCE WEARING A STRING.
 *
 * MEASURED TWICE, on two different model paths, which is why it is a rule and not a patch. The
 * photograph path saw gemma4:12b answer the four characters `null` where a JSON null was
 * available. This path saw something worse, on a real run over three pages of this machine's own
 * notes: asked for a LIST it could have left null, the model returned
 * `[{"title":"null","citedPaths":null}]` — one entry, declining inside a container it could have
 * declined by leaving empty. A grammar that permits null does not oblige a model to reach for
 * it, and a decoder trained on prose will spell the word instead. Carried through, that entry
 * becomes a leaflet titled "null" in somebody's portfolio.
 *
 * Matched only on the WHOLE trimmed value, case-folded. A title that happens to contain the word
 * "none" is a real answer and is left alone.
 */
const ABSENCE_WORDS: ReadonlySet<string> = new Set([
  "null",
  "none",
  "nil",
  "n/a",
  "na",
  "unknown",
  "undefined",
]);

/** A model answer field: a string with content, or an absence. Blank and "null" are absences. */
function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return ABSENCE_WORDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Show the selected pages to the local model and return what it proposed, or exactly why it
 * proposed nothing.
 *
 * FAILS CLOSED on every path. There is no fallback here and there must not be one: the caller's
 * only correct response to a failure is to write nothing, because a candidate whose extractor
 * says "local-model:gemma4:12b" when the model never ran is a lie in the one field review uses
 * to decide whether to trust a drafted line.
 *
 * An answer of `leaflets: null` is NOT a failure — it is the model declining, which is the
 * outcome the nullable schema exists to make possible. It comes back as an empty draft list and
 * the domain turns it into an honestly empty harvest.
 */
export async function draftLeaflets(
  pages: readonly PageText[],
  options: DraftOptions = {},
): Promise<DraftOutcome> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? LOCAL_DRAFTER_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // REFUSED BEFORE A PROMPT IS BUILT, not merely before it is sent. `loopbackFetch` would refuse
  // this endpoint anyway, but assembling somebody's private notes into a string we then decline
  // to use is work this module should not do, and `loopbackHostOf` is exported so it need not.
  const reachable = loopbackHostOf(endpoint);
  if (!reachable.ok) return draftFailure(reachable.failure, model, endpoint, timeoutMs);

  if (pages.length === 0) {
    return {
      ok: false,
      cause: "no-pages",
      detail:
        `nothing was retrieved, so there is nothing to draft from and no request was made. ` +
        `This is not a model failure and it is not an error — it is an empty retrieval, and ` +
        `the caller reports it as one.`,
    };
  }

  const prompt = draftPrompt(pages);
  const started = Date.now();
  const sent = await loopbackFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      format: DRAFT_SCHEMA,
      options: { num_predict: MAX_ANSWER_TOKENS },
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // jscpd:ignore-start — this response-parsing block is identical to photoSource.ts's; historical
  // duplication predating this gate, not retriaged here.
  if (!sent.ok) return draftFailure(sent.failure, model, endpoint, timeoutMs);
  const response = sent.response;
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      cause: "http-error",
      detail: `${endpoint} answered HTTP ${response.status}: ${body || "(no body)"}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    return {
      ok: false,
      cause: "unparseable",
      detail: `the response body was not JSON: ${messageWithCause(err)}`,
    };
  }
  const body =
    payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const envelope = body["response"];
  // WHY THE GENERATION STOPPED, read from the server rather than inferred from the text.
  const stopped = typeof body["done_reason"] === "string" ? body["done_reason"] : "unstated";
  // jscpd:ignore-end
  if (typeof envelope !== "string") {
    return {
      ok: false,
      cause: "unparseable",
      detail: `the response carried no "response" string: ${JSON.stringify(payload).slice(0, 200)}`,
    };
  }
  if (stopped === "length") {
    // ITS OWN CAUSE, and it fails closed even if the JSON happens to parse: a list cut at the
    // output ceiling is missing entries, and a harvest written from it would be smaller than
    // what the model actually had to say — indistinguishable, afterwards, from a model that
    // found less. Raise the ceiling or narrow the question; nothing was written.
    return {
      ok: false,
      cause: "cut-off",
      detail:
        `${model}'s answer was CUT OFF at the ${MAX_ANSWER_TOKENS}-token output ceiling ` +
        `(done_reason "length"), so the list it was emitting is incomplete: ` +
        `${JSON.stringify(envelope.slice(0, 200))}. Nothing was drafted.`,
    };
  }

  let answer: unknown;
  try {
    answer = JSON.parse(envelope);
  } catch (err) {
    return {
      ok: false,
      cause: "unparseable",
      detail:
        `${model} answered outside the schema it was given (done_reason "${stopped}") — ` +
        `${messageOf(err)}: ${JSON.stringify(envelope.slice(0, 200))}. Nothing was drafted.`,
    };
  }
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
    return {
      ok: false,
      cause: "unparseable",
      detail: `${model} answered with ${JSON.stringify(answer).slice(0, 120)}, not an object.`,
    };
  }

  const leaflets = (answer as Record<string, unknown>)["leaflets"];
  if (leaflets !== null && leaflets !== undefined && !Array.isArray(leaflets)) {
    return {
      ok: false,
      cause: "unparseable",
      detail:
        `${model} answered with a "leaflets" that is ${JSON.stringify(leaflets).slice(0, 80)}, ` +
        `neither a list nor null.`,
    };
  }

  const drafter = `local-model:${model}`;
  const drafts: DraftedLeaflet[] = [];
  for (const raw of Array.isArray(leaflets) ? leaflets : []) {
    const entry =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const cited = entry["citedPaths"];
    drafts.push(
      Object.freeze({
        drafter,
        title: stringOrNull(entry["title"]),
        // Every element is carried through, INCLUDING one that is not a string: dropping it
        // here would hide a citation from the check that exists to catch invented ones.
        citedPaths: Array.isArray(cited)
          ? Object.freeze(cited.map((c) => (typeof c === "string" ? c : null)))
          : null,
      }),
    );
  }

  return {
    ok: true,
    drafts: Object.freeze(drafts),
    sentChars: pages.reduce((sum, p) => sum + p.text.length, 0),
    elapsedMs: Date.now() - started,
  };
}
