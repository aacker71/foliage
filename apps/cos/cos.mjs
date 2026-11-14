#!/usr/bin/env node
/**
 * The local chief-of-staff, as one command a person runs on their own machine.
 *
 * EXPERIMENTAL, and not part of the Foliage app (`foliage up`); `usage()` says so first.
 *
 * THIS FILE IS THE SEAM AND NOTHING ELSE. It owns no policy and no crypto: it opens the real
 * Tier 1 store, hands what it found to `@foliage/cos`, prints the decision and the complete
 * item-by-item egress account, and passes ONLY the admitted material to the Tier 3 client.
 * Every judgement it prints was made somewhere else — that is deliberate, because a seam that
 * re-derives a decision is a second policy, and two policies drift.
 *
 * Zero dependencies, same as apps/canopy/server.mjs. It is .mjs rather than .ts because it is
 * an entry point, and Node 22 strips the types off the .ts modules it imports with no build
 * step; there is no dist/ here and there is not going to be one.
 *
 *
 * WHAT A RUN PRINTS, AND WHY IT PRINTS IT IN THIS ORDER
 *
 * Eight sections, because the question this product has to be able to answer out loud is "why
 * did that not leave my machine, and what did I get instead?" and the answer is a chain, not a
 * verdict:
 *
 *   STORE      which file was opened, and with which KDF parameters it was actually derived —
 *              read off the file, not assumed from today's constants.
 *   RETRIEVED  what was in it. `empty` is its OWN state coming out of localStore, so "you have
 *              nothing here yet" is rendered only when that is true, and never produced by a
 *              store where every row failed to decrypt (that prints as present-with-failures).
 *   MEMORY     what this agent remembers from earlier turns, and what it is NOT using because a
 *              later turn replaced it or a person rejected it. Agent state, in the same
 *              encrypted file as the person's filing and in its own id namespace, never mixed
 *              into the inventory of things the person actually said. What is LIVE is further
 *              bounded by an injection budget (F-007, `budgetMemories` in memory.ts) — the most
 *              recently recorded few enter this prompt, and how many did not is stated BY COUNT
 *              rather than left silent, because a failure is never a zero.
 *   DECISION   the RoutingDecision by its variant name, and for `local-only` every cause, as a
 *              list. Never one cause standing in for several.
 *   EGRESS     every item that may cross, and every item withheld WITH ITS NAMED REASON, one
 *              per line — INCLUDING the request itself, as `<request>`. This is the line a
 *              person is owed. A gate that says "3 items withheld" has told them nothing they
 *              can check, and a gate that accounts for the store but not for the words being
 *              sent alongside it has told them something false.
 *   TIER 3 /   which arm was attempted and what happened, by named cause. `LOCAL MODEL` prints
 *   LOCAL      the loopback base URL and the complete list of ids whose bodies entered the
 *   MODEL      prompt, BEFORE the call, so what was sent is checkable rather than described.
 *   ANSWER     the Turn: its provenance first, then its moves. Present on EVERY path.
 *   REMEMBERED what the turn wrote back, its DERIVED kind, what it supersedes — or the named
 *              reason nothing was written.
 *
 *
 * THERE IS AN ANSWER ON EVERY PATH, AND THE MODEL IS AN UPGRADE
 *
 * Until 2026-08-19 a `local-only` run ended with a paragraph confessing that the build routed
 * and refused and could not yet reason on the machine, so there was no local answer to show.
 * That was true of that build. It is false of this one, and the paragraph is DELETED rather than
 * softened — a confession kept after it stops being true is a lie with good intentions, and it
 * would teach a person not to ask again. Its exact words are not quoted anywhere here on purpose:
 * `cos.seam.test.ts` greps this file for them, and a quoted copy would defeat the grep.
 *
 * `local-only` now reaches the local runtime over loopback; `escalate` still reaches Fireworks.
 * Every named failure of either — and the case where no model is configured at all — falls
 * through to the deterministic floor in `@foliage/cos`, which enumerates what the person has
 * declared, restates the request against it, names what is missing, and proposes a next move.
 * Killing the model runtime degrades the answer; it never removes it. The floor never claims to
 * be reasoning, and the provenance line says which of the three produced what you are reading.
 *
 * THE TWO REFUSALS ARE DIFFERENT SENTENCES ON PURPOSE. "We refused to send it" and "there was
 * nothing configured to send it to" are opposites, and a transcript where both render as one
 * line has failed regardless of what any test says. So:
 *
 *   - The router declining to escalate prints `not attempted — policy-refused`, names the
 *     decision that caused it, and NO call is made. The Tier 3 client is never even reached.
 *   - A call the router permitted, against an unconfigured provider, prints
 *     `attempted — no-credential` and names the missing variables.
 *
 * Those two states are produced by different branches of this file, not by different strings
 * from one branch, so they cannot converge by an edit to a message.
 *
 *
 * THE REQUEST IS CONTEXT, AND IT IS ROUTED LIKE EVERYTHING ELSE
 *
 * This file used to argue the opposite, under the heading "THE PROMPT IS NOT CONTEXT, AND IS
 * NOT FILTERED": the words typed after `ask` were authored at the keyboard this second, so
 * pressing enter WAS the act of choosing to send them, so the egress rule governed only the
 * store. That argument is wrong, and a review demonstrated it rather than asserting it. On an
 * empty store, with `FOLIAGE_COS_MAY_CROSS=tier3-shareable`:
 *
 *     ask "Private review notes: Dana missed the Q3 deadline. Also my SSN is 123-45-6789."
 *
 * printed `DECISION escalate`, `MAY CROSS (nothing)`, `WITHHELD (nothing)` — and then, with a
 * credential configured, would have transmitted that literal sentence to a third-party
 * inference provider. Every line of the egress account was true about the store and the whole
 * account was false about the run. The same text, `declare`d as tier1-local first, is correctly
 * blocked; typing it straight in was a complete bypass of the one guarantee this slice sells.
 *
 * Two separate defects lived in that one design, and both are fixed here:
 *   - The request crossed the boundary with no policy applied at all. Spec §4 lists "Enforce
 *     the privacy boundary — decide whether THIS REQUEST can/should escalate" as step 3, over
 *     the request, not merely over what got assembled around it.
 *   - The transcript did not say so. `MAY CROSS (nothing)` immediately before sending a
 *     sentence is the failure mode this whole file exists to prevent.
 *
 * So the request enters `route` as an item like any other, with the reserved id `<request>`,
 * and it is appended to the message list ONLY if the egress plan admitted it by that id.
 *
 * ITS KIND IS DECLARED, NEVER INFERRED — `ask --as <kind> "..."`. Nothing here reads the
 * request text: no PII regex, no sensitivity heuristic, no "this looks like a review". That is
 * the same refusal classify.ts makes for stored material, for the same measured reason, and it
 * has its own trap here — a redactor over 800 real commit subjects altered 12 lines, 11 of them
 * false positives (AGENTS.md), so a scanner would both miss real secrets and mangle innocent
 * sentences while claiming to have checked. Undeclared means undeclared: no `--as` puts
 * `<request>` in the plan as `undeclared`, which pins the decision to `local-only` and sends
 * nothing. Declaring `--as tier1-local` also sends nothing, by the device-only rule.
 *
 * The cost is real and is accepted: `ask` no longer escalates by default. A person who wants
 * Tier 3 says so per request. "It sent by default" is exactly what was wrong with it.
 *
 * When the decision is not `escalate`, nothing is sent AT ALL — not the context, and not the
 * request either. Refusing to escalate refuses the whole call.
 *
 *
 * CREATING A STORE IS ITS OWN COMMAND
 *
 * `ask`, `declare`, `list` and `forget` all open with `create: false`. Only `init` creates.
 * localStore.ts refuses a missing file rather than handing back a fresh empty store, precisely
 * so a typo in a path cannot look like "your material is gone" — and that protection is worth
 * nothing if the entry point passes `create: true` everywhere to be convenient.
 */

import { createHash } from "node:crypto";
import { argv, env, exit, stderr, stdout } from "node:process";

import {
  DECLARED_KINDS,
  admittedForEgress,
  answer,
  cite,
  classifyAll,
  contextItemId,
  deterministicTurn,
  escalatedProvenance,
  localModelProvenance,
  promptMessages,
  renderProvenance,
  renderTurn,
  route,
  synthesis,
  turn,
} from "@foliage/cos";
import { openTier1Store } from "./src/localStore.ts";
import { callFireworks, fireworksConfigFromEnvironment } from "./src/fireworks.ts";
import { callLocalModel, localModelConfigFromEnvironment } from "./src/localModel.ts";
import {
  MEMORY_ID_PREFIX,
  MEMORY_INJECTION_BUDGET,
  activeMemories,
  budgetMemories,
  egressOf,
  recallAll,
  remember,
} from "./src/memory.ts";

// ---------------------------------------------------------------------------------------
// Environment. Every variable read anywhere in this app is named here or in fireworks.ts,
// and apps/cos/env.example documents exactly this set.
// ---------------------------------------------------------------------------------------

const STORE_VAR = "FOLIAGE_COS_STORE";
const SECRET_VAR = "FOLIAGE_COS_SECRET";
const MAY_CROSS_VAR = "FOLIAGE_COS_MAY_CROSS";

/**
 * The id the request itself carries through the router and the egress plan.
 *
 * Angle brackets rather than parentheses so it cannot be misread as the `(nothing)` the plan
 * prints for an empty side. NO id is impossible for a person to `declare` — `declare <id> …`
 * takes any non-empty string — so a store item may collide with this one. That case is not
 * special-cased into a silent rename: `classifyAll` refuses duplicate ids outright, so the run
 * ends at `DECISION refused` — printed as `malformed-context`, carrying classify's own
 * "<request> already appeared in this context" — and nothing is sent. Measured, not assumed:
 * `declare "<request>" …` then `ask` prints exactly that. Fails closed and names the collision,
 * which is the honest handling of an id nobody can reserve.
 */
const REQUEST_ITEM_ID = "<request>";

/**
 * The declared egress policy, read as a SET OF NAMES and never as a level.
 *
 * Unset and empty both mean the same real thing — the device-only posture — but they are read
 * the same way rather than defaulted: `mayCross: []` is a statement expressed as data, and it
 * is the posture a person gets by not having decided yet, which is the correct one to get.
 *
 * Names are NOT validated here. `@foliage/cos` refuses `tier1-local` and refuses a kind it does
 * not recognise, with a cause; re-checking that here would put a second copy of the vocabulary
 * in a file that has no business holding one.
 */
function readMayCross() {
  const raw = env[MAY_CROSS_VAR];
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * The value of a required variable, or `null` meaning NOBODY SET THIS — and whitespace is nobody.
 *
 * WHITESPACE IS NOT A VALUE. Until 2026-08-28 this tested `v === ""` while `readMayCross`, seven
 * lines above it in this same file, tested `raw.trim() === ""`. Two resolvers one screen apart
 * disagreed about what "set" means, and the strict one was the one guarding the secret. Measured
 * before the fix, both on a real store: `FOLIAGE_COS_SECRET="   " … list` derived a key from three
 * spaces and reported `key-mismatch` — telling a person their secret is WRONG when the truth is
 * that their variable is EMPTY, which sends them hunting for the passphrase they still have. And
 * `FOLIAGE_COS_SECRET="  " … init` succeeded: it CREATED a 20,480-byte encrypted store whose key comes
 * from two spaces and printed `STATE empty — nothing declared yet`, with nothing on the screen
 * saying the secret was blank. A near-empty secret reaching the KDF is not a weaker secret, it is
 * an undetected one. Reported absent BY NAME is the honest outcome; `openConfiguredStore` already
 * carries it into `{ state: "unconfigured", missing }`, which prints the variable and points at
 * env.example. A failure is never a zero, and here it is never a silent key either.
 *
 * THE VALUE IS RETURNED UNTRIMMED, AND THAT ASYMMETRY IS THE POINT. Trimming is used to DECIDE
 * whether something is there; it is never applied to what gets handed on. Both callers are opaque
 * strings and one of them, `FOLIAGE_COS_SECRET`, feeds scrypt directly: trimming the returned
 * string would change the derived key — a store created
 * with a trailing-space passphrase would stop opening, and the person would be told `key-mismatch`
 * by the very code that silently altered their secret. That is the rewriter this repository
 * refuses: detect, report, refuse — never quietly alter the evidence. `readMayCross` may trim its
 * elements because those are enum names matched against a fixed vocabulary; a secret and a path
 * are opaque and are passed through byte-for-byte. A path with a stray newline therefore still
 * fails, but it fails at `open` with `no-file` naming the path, which is a cause a person can read.
 */
function requireEnv(name) {
  const v = env[name];
  if (v === undefined) return null;
  return v.trim() === "" ? null : v;
}

// ---------------------------------------------------------------------------------------
// Printing. Plain text on stdout, one fact per line, aligned so the eye can scan the reasons.
// ---------------------------------------------------------------------------------------

const LABEL_WIDTH = 12;

function line(label, text) {
  stdout.write(`${String(label).padEnd(LABEL_WIDTH)}${text}\n`);
}

function section(title) {
  stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

function detail(text) {
  stdout.write(`${" ".repeat(LABEL_WIDTH)}${text}\n`);
}

function fail(text) {
  stderr.write(`${text}\n`);
}

// ---------------------------------------------------------------------------------------
// Opening the real store
// ---------------------------------------------------------------------------------------

/**
 * Open the store named by the environment, or return the reason it could not be opened.
 *
 * Returns the OpenResult unchanged. The failure causes localStore distinguishes — no file, not
 * a store, wrong secret, unusable secret — are exactly the four things a person needs told
 * apart, and flattening them here to one "could not open" would undo that work at the last
 * step, which is the usual place it gets undone.
 */
async function openConfiguredStore({ create }) {
  const path = requireEnv(STORE_VAR);
  const secret = requireEnv(SECRET_VAR);

  const missing = [];
  if (path === null) missing.push(STORE_VAR);
  if (secret === null) missing.push(SECRET_VAR);
  if (missing.length > 0) {
    return { state: "unconfigured", missing };
  }

  const result = await openTier1Store({ path, secret, create });
  return result;
}

function printOpenFailure(result) {
  if (result.state === "unconfigured") {
    line("STORE", "not configured");
    detail(`missing: ${result.missing.join(", ")}`);
    detail("See apps/cos/env.example. Nothing was opened and nothing was sent.");
    return;
  }
  line("STORE", `could not open — ${result.cause}`);
  detail(result.detail);
}

function printStoreHeader(store) {
  line("STORE", store.path);
  const k = store.kdf;
  detail(
    `key derived with ${k.kdf} N=${k.cost} r=${k.blockSize} p=${k.parallelization} ` +
      `→ ${k.keyLengthBytes} bytes, salt ${k.saltHex.slice(0, 16)}… (read off the file)`,
  );
}

// ---------------------------------------------------------------------------------------
// THE ANSWER. Three producers, one shape.
//
// Every path through `ask` ends in a `Turn` — the deterministic floor, the local model, or the
// escalated provider — and the Turn carries its own provenance, so there is no arrangement of
// these branches that prints an answer without saying what made it. This file used to end a
// `local-only` run with a paragraph confessing that it could not reason on the machine, which
// was the honest truth about the build on 2026-08-19 and is false about this one. It is deleted
// rather than softened: a confession kept after it stops being true is a lie with good
// intentions, and a person reading it would decline to ask again. See the file header for why
// its exact words are quoted nowhere in this file.
//
// A MODEL IS AN UPGRADE AND NEVER A DEPENDENCY. Every named failure of the local arm and every
// named failure of the escalated arm falls through to `deterministicTurn`, carrying the cause
// that sent it there, so the worst outcome of an unplugged model is a worse answer.
// ---------------------------------------------------------------------------------------

/** The kind the person declared for the request, or `null` — never guessed from the words. */
function declaredKindOrNull(declaredKind) {
  return declaredKind !== null && DECLARED_KINDS.includes(declaredKind) ? declaredKind : null;
}

/**
 * The floor, with the entry that is TRUE of how this run reached it.
 *
 * `FloorEntry` names four ways in and its `local-model-failed` arm carries exactly the four
 * causes a model runtime can fail with. `callLocalModel` has three further states —
 * `no-model-declared`, `refused-non-loopback`, `runtime-refused` — and NONE of them means a
 * model was asked and failed: two of them mean no request was made at all. They are given
 * `floor-only` plus a sentence of their own rather than being filed under the nearest of the
 * four, because "the runtime answered HTTP 500" reported as `malformed-response` sends someone
 * to read a reply that was never sent.
 */
function floorTurn({ request, declaredKind, material, entry, extraFirst = null }) {
  const t = deterministicTurn({
    request,
    requestKind: declaredKindOrNull(declaredKind),
    material,
    entry,
  });
  if (extraFirst === null) return t;
  /* Inserted AFTER the floor's opening paragraph, which is where `renderEntry` puts the "how you
     got here" move for the entries the floor knows about. Same position, same reading order. */
  const [opening, ...rest] = t.moves;
  return turn(t.provenance, opening, extraFirst, ...rest);
}

/** What the floor was given to work with, without ever calling an unreadable store empty. */
function floorMaterial(listed, classifications) {
  if (listed === null) {
    return {
      state: "unavailable",
      cause: "not-consulted",
      detail: "The store was never opened on this run.",
    };
  }
  if (listed.state === "unreadable") {
    return {
      state: "unavailable",
      cause: "store-unreadable",
      detail: `The Tier 1 store could not be listed (${listed.cause}): ${listed.detail}`,
    };
  }
  if (classifications.length > 0) return { state: "present", items: classifications };
  if (listed.state === "present" && listed.failed.length > 0) {
    /* Rows are there and none of them opened. Reporting that as `empty` would tell a person
       their material is gone when their secret is merely wrong — the exact collapse
       `Tier1ListResult` refuses one layer down, refused again here. */
    return {
      state: "unavailable",
      cause: "store-unreadable",
      detail:
        `Records are in this store and none of them could be decrypted (first cause: ` +
        `${listed.failed[0].cause}). Your material is still there.`,
    };
  }
  return { state: "empty" };
}

/**
 * One citation per piece of material that entered a model's prompt.
 *
 * This is the only shape in which a model turn is allowed to say anything about the person: a
 * `CiteMove` cannot be constructed without the `ContextItemId` it rests on, so "the model was
 * given this item" is a statement carrying its own source. The model's own paragraph is the
 * agent's synthesis across all of them and is emitted separately — see `modelProseMove`.
 */
function consultedCitations(consulted, where) {
  return consulted.map((c) =>
    cite(
      contextItemId(c.id),
      c.at,
      `Its body was handed to ${where}, verbatim and unsummarised. Everything the model said ` +
        `about you rests partly on this item, and this line is where you check it.`,
    ),
  );
}

/**
 * The model's paragraph, as its own move.
 *
 * THE SEAM MISMATCH THIS USED TO CARRY, and how it was closed. Until 2026-08-19 this returned
 * `answer()`, whose heading reads "ANSWER (general; makes no claim about you)". The doc comment
 * here admitted that was the wrong label for a model's synthesis and shipped it anyway, on the
 * theory that a preface paragraph saying "this is not a citation" was enough. A review proved it
 * was not, with the real local runtime: given notes about being passed over, `gemma4:12b`
 * returned *"What is holding you back is identified by your manager as your communication in
 * executive meetings being 'too hesitant' ([career-notes])"* — an evaluative claim about the
 * person, under a heading certifying that no claim was made, carrying a citation the model had
 * invented. A reader scanning headings would have read the guarantee and not the disclaimer.
 *
 * Documenting a defect is not fixing it. `SynthesisMove` is the move that was missing: it names
 * the model and where it ran, states in the HEADING that it is not cited and may make claims,
 * and lists what the model was shown without pretending any sentence traces to any of it.
 */
function modelProseMove(content, model, where, restsOn) {
  if (content.trim() === "") {
    return synthesis(
      model,
      where,
      `The model returned an EMPTY answer. That is a success, not a failure: the runtime answered ` +
        `and generated no text — usually a token budget spent on the model's own deliberation. ` +
        `Nothing is being hidden from you here.`,
      restsOn,
    );
  }
  return synthesis(model, where, gutter(content).join("\n  "), restsOn);
}

/**
 * Put every line of model prose behind a `|` gutter.
 *
 * MEASURED, NOT PRECAUTIONARY. On the run of 2026-08-19T20:54Z, `gemma4:12b` — having been given
 * an earlier turn out of memory, which is stored as its rendered text — emitted a paragraph
 * beginning `FROM YOUR MATERIAL — loopback-egress_gate (items[1])`. That is this file's own
 * citation label, forged by the model, complete with an item id it had misspelled. Rendered flush
 * it sits at exactly the column `renderMove` uses, so a reader scanning the transcript would have
 * taken generated text for a `CiteMove` that the type system guarantees and this one is not.
 *
 * The gutter is the fix because it is unconditional: no content can escape it, since the prefix
 * is applied per line after the fact rather than by scanning for anything. `renderMove` indents
 * the first line of an answer and nothing after it, so this also keeps a multi-line paragraph
 * from falling back to column zero halfway through.
 */
function gutter(content) {
  return content
    .trim()
    .split("\n")
    .map((l) => `| ${l}`);
}

function printTurn(t) {
  section("ANSWER");
  for (const l of renderTurn(t)) stdout.write(l === "" ? "\n" : `${l}\n`);
}

// ---------------------------------------------------------------------------------------
// MEMORY. What a turn remembers, and the four things it is structurally unable to remember.
//
// `apps/cos/src/memory.ts` holds the walls; this file only supplies a draft and prints what
// came back. Three properties are worth naming at the call site because they are the ones a
// reader of THIS file would otherwise have to take on trust:
//
//   - No id is ever reused. A re-ask writes a NEW memory linked by `supersedes` to the one it
//     replaces, and `remember` refuses an existing id outright, so there is no argument to this
//     code that overwrites what a person already decided about (ENGINEERING-PLAN §9.2).
//   - The memory's KIND is copied from the material it was derived from. This file never sends
//     one. A memory of a turn over `tier1-local` material comes back `tier1-local` and is
//     refused egress by the router's own kind check on the next ask, with no second vocabulary.
//   - Mixed-kind derivation is REFUSED, and this file does not work around it. Splitting one
//     synthesised answer across a `tier1-local` memory and a `tier3-shareable` one would put
//     text derived from device-only material into a shareable record — laundering with an extra
//     step. Picking the "strictest" kind instead would require an ordering over kinds, which is
//     the thing this product does not have. So a turn over mixed material remembers nothing,
//     and the run says so with the cause. That is a real limitation, printed rather than hidden.
// ---------------------------------------------------------------------------------------

const MEMORY_ASK_PREFIX = "ask:";

/**
 * THE LOCAL OPERATING POINT, chosen by measurement on this machine rather than by habit.
 *
 * `gemma4:12b` advertises `thinking`, and its private deliberation is spent out of the SAME token
 * budget as the answer. Measured here on 2026-08-19: a one-sentence question produced 1814
 * characters of deliberation and 225 characters of answer inside 460 generated tokens, at roughly
 * 13 generated tokens/second. The first run of this seam asked for 1024 and got `done_reason:
 * length` with an EMPTY answer — the whole budget went into deliberation, which the client
 * correctly reported as a success with no content. A budget that small does not fail loudly; it
 * quietly returns nothing and looks like a broken model.
 *
 * So: 2048 tokens, and a deadline sized to it. 2048 tokens at the ~10 tok/s an end-to-end run
 * actually measured is ~205s, plus a 32.8s cold weight load, so 300s is that with room. This is
 * the caller's argument on purpose — `localModel.ts`'s own 120s default is right for a smaller
 * budget and would report this one as a timeout.
 */
const LOCAL_MAX_TOKENS = 2048;
const LOCAL_TIMEOUT_MS = 300_000;

/** A stable name for "this request, asked again", so a re-ask can supersede rather than fork. */
function requestFingerprint(request) {
  return createHash("sha256").update(request, "utf8").digest("hex").slice(0, 12);
}

/**
 * The turn's provenance, in memory's vocabulary.
 *
 * The two vocabularies are deliberately separate types — `TurnProvenance` carries a full
 * `ModelIdentity`, `MemoryProvenance` carries the model string — and this is the one place they
 * meet. `unknown` is produced only where the turn itself said `unknown`; nothing here upgrades
 * an unattested turn to a confident `deterministic`, which is the specific failure Janus §C16
 * names and the reason a memory carries provenance at all.
 */
function memoryProvenanceOf(provenance) {
  switch (provenance.source) {
    case "deterministic":
      return { producer: "deterministic" };
    case "local-model":
      return { producer: "local-model", model: provenance.model.model };
    case "escalated":
      return { producer: "escalated", model: provenance.model.model };
    default:
      return { producer: "unknown", detail: provenance.detail };
  }
}

/**
 * WHAT A MEMORY IS MADE OF, and the one thing it deliberately does not store.
 *
 * A memory records the request, the provenance, and the ids the turn rested on. When a MODEL
 * produced the turn it also records the model's own words, because those are the part of the
 * turn that nothing can reproduce.
 *
 * A DETERMINISTIC TURN'S TEXT IS NOT STORED, and that is a measurement rather than a taste. The
 * floor is a pure function of the store and the request: re-running reproduces it byte for byte,
 * so keeping a copy is caching a pure function under the name "memory". It also costs something
 * real, observed on 2026-08-19 — the first version of this file stored `renderTurn` verbatim, so
 * a floor turn's several hundred tokens of standard paragraphs came back as context on the next
 * ask. The re-ask arrived at `gemma4:12b` with a 1120-token prompt, spent all 2048 of its
 * generation budget deliberating and returned `done_reason: length` with an EMPTY answer, while
 * the identical first ask had answered in 548. The second ask was worse than the first BECAUSE
 * of what remembering it had stored.
 */
function memoryBody({ request, produced, sources, learned }) {
  const lines = [
    `You asked: "${request}"`,
    "",
    `Produced by: ${renderProvenance(produced.provenance)}`,
    `Rested on: ${sources.length === 0 ? "(nothing on file)" : sources.map((s) => s.id).join(", ")}`,
    "",
  ];
  if (learned === null) {
    lines.push(
      "No model produced this turn — the deterministic floor answered from the store and the " +
        "request alone. Its text is not stored here, because it is a pure function of both and " +
        "asking again reproduces it exactly.",
    );
  } else if (learned.trim() === "") {
    lines.push(
      "The model was reached and returned an empty answer. That is recorded as the fact it is; " +
        "there is nothing it said to remember.",
    );
  } else {
    lines.push("What the model said, verbatim:", "", learned.trim());
  }
  return lines.join("\n");
}

/**
 * Write what this turn learned, or print the named reason it was not written.
 *
 * `sources` is EVERY piece of material that entered the answer — declared items and recalled
 * memories alike. A memory derived from a subset of what shaped it would carry a kind that is
 * true of the subset and false of the text, which is the laundering route this argument closes.
 */
async function rememberTurn(store, { request, produced, sources, recordedAt, priorActive, learned }) {
  section("REMEMBERED");
  if (sources.length === 0) {
    line("REMEMBERED", "nothing");
    detail(
      "This turn rested on no material of yours, so there is nothing about you to remember. " +
        "A memory with no derivation has no kind, and a kind is what decides whether it may ever leave.",
    );
    return;
  }

  const fingerprint = requestFingerprint(request);
  const lineage = `${MEMORY_ASK_PREFIX}${fingerprint}:`;
  const priors = priorActive.filter((m) => m.id.startsWith(lineage));

  let supersedes;
  if (priors.length === 1) {
    supersedes = priors[0].id;
  } else if (priors.length > 1) {
    /* Two live memories claim this request. Choosing between them would be an ordering over
       statements about a person, invented by the code least equipped to know which re-run they
       meant. The fork is named and left standing. */
    line("REMEMBERED", "not linked — this request already has more than one live memory");
    for (const p of priors) detail(`  ${p.id}`);
    detail(
      "A new memory is being written WITHOUT a supersession link, because picking which of those " +
        "it replaces would be a guess. Resolve it by deciding on them.",
    );
  }

  const draft = {
    id: `${lineage}${recordedAt}`,
    body: memoryBody({ request, produced, sources, learned }),
    recordedAt,
    provenance: memoryProvenanceOf(produced.provenance),
    derivedFrom: sources.map((s) => ({ itemId: s.id, kind: s.kind })),
    ...(supersedes === undefined ? {} : { supersedes }),
  };

  const written = await remember(store, draft);
  if (written.state !== "remembered") {
    line("REMEMBERED", `refused — ${written.cause}`);
    detail(`at ${written.at}`);
    detail(written.detail);
    return;
  }
  const memory = written.memory;
  line("REMEMBERED", `${memory.id}`);
  detail(`kind ${memory.kind} — DERIVED from the material below, never declared here`);
  for (const d of memory.derivedFrom) detail(`  from ${d.itemId} (${d.kind})`);
  detail(`producer ${memory.provenance.producer}${memory.provenance.model === undefined ? "" : ` ${memory.provenance.model}`}`);
  if (memory.supersedes !== undefined) {
    detail(`supersedes ${memory.supersedes} — which is still in this store, byte for byte, unedited`);
  }
  const egress = egressOf(memory);
  detail(
    egress.state === "may-leave"
      ? `egress: may-leave (${egress.kind})`
      : `egress: device-only (${egress.kind}) — ${egress.reason}`,
  );
}

// ---------------------------------------------------------------------------------------
// `ask` — the whole seam, in the order the spec names
// ---------------------------------------------------------------------------------------

/**
 * `ask [--as <kind>] "<request>"`.
 *
 * `declaredKind` is `null` when the person did not say — which is a state, not a default, and
 * it is carried to the router as an item with NO `declaredKind` field so classify.ts reports
 * `no-declaration` rather than this file inventing a kind. An unrecognised kind is passed
 * through unvalidated for the same reason `readMayCross` passes its names through: the
 * vocabulary lives in `@foliage/cos`, a second copy here would be the one that goes stale, and
 * the router already answers a typo with `undeclared`/`unrecognized-kind`.
 */
async function commandAsk(request, declaredKind) {
  if (request === undefined || request.trim() === "") {
    fail('usage: node apps/cos/cos.mjs ask [--as <declared-kind>] "<a real request>"');
    return 2;
  }

  // 1. Open the REAL Tier 1 store.
  const opened = await openConfiguredStore({ create: false });
  if (opened.state !== "opened") {
    printOpenFailure(opened);
    /* AN ANSWER EXISTS ON EVERY PATH, INCLUDING THIS ONE. A store that would not open is the
       branch where a person is most likely to be told nothing at all — and the floor still has
       something true to say: what they asked, that their material was not read, and what to do.
       `store-locked` and `store-unreadable` are kept apart because only the first is a secret
       the person can fix, and `not-consulted` is neither. */
    const cause =
      opened.state === "unconfigured"
        ? "not-consulted"
        : opened.cause === "key-mismatch" || opened.cause === "secret-unusable"
          ? "store-locked"
          : "store-unreadable";
    printTurn(
      floorTurn({
        request,
        declaredKind,
        material: {
          state: "unavailable",
          cause,
          detail:
            opened.state === "unconfigured"
              ? `Nothing was opened: ${opened.missing.join(", ")} is not set, so no store was named.`
              : `Opening it failed with \`${opened.cause}\`: ${opened.detail}`,
        },
        entry: { by: "floor-only" },
      }),
    );
    return 1;
  }
  const store = opened.store;
  printStoreHeader(store);

  try {
    // 2. Retrieve whatever the caller has DECLARED. On a fresh machine this is genuinely
    //    nothing, and `empty` is the store's own state — not an inference from a length.
    const listed = await store.list();
    section("RETRIEVED");
    /** @type {{id: string, kind: string, body: string}[]} */
    let held = [];
    if (listed.state === "unreadable") {
      line("RETRIEVED", `unreadable — ${listed.cause}`);
      detail(listed.detail);
      printTurn(
        floorTurn({
          request,
          declaredKind,
          material: floorMaterial(listed, []),
          entry: { by: "floor-only" },
        }),
      );
      return 1;
    }
    if (listed.state === "empty") {
      line("RETRIEVED", "empty");
      detail(
        "Nothing has been declared into this store yet. This is the honest empty state: " +
          "no example, no seeded row, no demo item.",
      );
    } else {
      /* The agent's own memories live in the SAME encrypted file, under their own id namespace.
         They are separated here rather than decoded-and-guessed at: a memory is agent state and
         a declared item is the person's filing, and rendering one as the other would put a
         sentence a model wrote into the inventory of things the person said. */
      held = listed.items
        .filter((i) => !i.id.startsWith(MEMORY_ID_PREFIX))
        .map((i) => ({ id: i.id, kind: i.kind, body: i.body }));
      line("RETRIEVED", `${held.length} declared item(s)`);
      for (const i of listed.items) {
        if (i.id.startsWith(MEMORY_ID_PREFIX)) continue;
        detail(`${i.id}  declared ${i.kind}  recorded ${i.recordedAt}`);
      }
      for (const f of listed.failed) {
        detail(`${f.blindIdHex.slice(0, 16)}…  COULD NOT BE READ — ${f.cause}: ${f.detail}`);
      }
    }

    /* What this agent remembers from earlier turns. `activeMemories` drops the ones a later turn
       replaced AND the ones a person rejected — a rejected memory stays in the store and is
       excluded from USE, never deleted, because deleting someone's decision is its own kind of
       forgetting. */
    section("MEMORY");
    const recalled = await recallAll(store);
    /** @type {{id: string, kind: string, body: string}[]} */
    let remembered = [];
    if (recalled.state === "unreadable") {
      line("MEMORY", `unreadable — ${recalled.cause}`);
      detail(recalled.detail);
    } else if (recalled.state === "empty") {
      line("MEMORY", "nothing remembered yet");
    } else {
      const active = activeMemories(recalled.memories);
      if (active.length === 0) {
        line("MEMORY", "nothing live — every memory here was superseded or rejected");
      }
      /* F-007 (.loop/FINDINGS.md): every live memory used to be injected into every later prompt,
         uncapped, so the store grew by one memory per distinct question forever and the prompt
         grew with it — measured consequence in the LOCAL OPERATING POINT comment above: a
         1120-token re-ask burned the whole 2048-token generation budget on deliberation and came
         back with an EMPTY answer. `budgetMemories` (apps/cos/src/memory.ts) keeps only the most
         recently recorded `MEMORY_INJECTION_BUDGET` of them; the rest stay in the store, still
         readable through `list`, just not injected into THIS turn. */
      const budgeted = budgetMemories(active);
      remembered = budgeted.included.map((m) => ({
        /* Routed under a bracketed id for the same reason `<request>` is: it cannot be mistaken
           for something the person filed, and `classifyAll` refuses a duplicate outright rather
           than renaming one silently. */
        id: `<memory:${m.id}>`,
        kind: m.kind,
        body: m.body,
      }));
      for (const m of budgeted.included) {
        line("MEMORY", `<memory:${m.id}>  ${m.kind}  ${m.recordedAt}`);
        detail(
          `  produced by ${m.provenance.producer}${m.provenance.model === undefined ? "" : ` ${m.provenance.model}`}` +
            `${m.supersedes === undefined ? "" : `, replaces ${m.supersedes}`}`,
        );
      }
      if (budgeted.withheldByBudget > 0) {
        // A FAILURE IS NEVER A ZERO. Silence about what a budget dropped is how this class of
        // bug ships again wearing a different shape — said BY COUNT, because a budget withholds
        // from this one prompt and not, like EGRESS, from the person forever, so there is no
        // per-item reason a budget owes that `list` does not already answer.
        line(
          "MEMORY",
          `${budgeted.withheldByBudget} ${budgeted.withheldByBudget === 1 ? "memory" : "memories"} withheld by budget`,
        );
        detail(
          `only the ${MEMORY_INJECTION_BUDGET} most recently recorded live memories enter a prompt; ` +
            "the rest are unchanged in the store and still readable with `list`.",
        );
      }
      for (const f of recalled.failed) {
        detail(`${f.storeId}  COULD NOT BE READ — ${f.cause}: ${f.detail}`);
      }
    }

    // 3. Hand the assembled items to the policy — the retrieved material AND the request. The
    //    store's `kind` is passed straight through as the declaration: a kind this vocabulary
    //    does not know comes back `undeclared` with `unrecognized-kind`, which is the honest
    //    answer and not a defaulted one. The request goes in LAST, in the position it occupies
    //    in the message list, and with a declaration only if the person gave one — see the
    //    header for why this file will not read the words to guess.
    const mayCross = readMayCross();
    const requestItem =
      declaredKind === null ? { id: REQUEST_ITEM_ID } : { id: REQUEST_ITEM_ID, declaredKind };
    /* Declared material FIRST, then memories, then the request. The order is load-bearing in one
       small way: the floor is handed the classifications of the declared prefix, and `at`
       (`items[3]`) has to name the same position in both lists or a citation would point
       somewhere a person cannot find. Memories are routed as items too — a memory derived from
       device-only material IS device-only, so it pins the decision exactly as its source would,
       with no second copy of the egress rule to keep in step. */
    const contextual = [...held, ...remembered];
    const decision = route({
      policy: { mayCross },
      items: [...contextual.map((i) => ({ id: i.id, declaredKind: i.kind })), requestItem],
    });
    const heldClassified = classifyAll(held.map((i) => ({ id: i.id, declaredKind: i.kind })));

    section("DECISION");
    line("POLICY", mayCross.length === 0 ? "mayCross: [] (device-only)" : `mayCross: [${mayCross.join(", ")}]`);
    line("DECISION", decision.decision);
    if (decision.decision === "local-only") {
      for (const c of decision.causes) detail(`cause: ${c}`);
    }
    if (decision.decision === "refused") {
      detail(`cause: ${decision.cause}`);
      for (const issue of decision.issues) {
        detail(`  at ${issue.at || "(request)"} — ${issue.cause}: ${issue.message}`);
      }
      section("INFERENCE");
      line("INFERENCE", "not attempted — policy-refused");
      detail("The router refused the request outright. Nothing was assembled and nothing was sent.");
      detail("No model was asked: not the local one on this machine, and not a remote one.");
      printTurn(
        floorTurn({
          request,
          declaredKind,
          material: floorMaterial(listed, heldClassified),
          entry: {
            by: "policy",
            decision: "refused",
            detail: `The refusal was \`${decision.cause}\`.`,
          },
        }),
      );
      return 1;
    }

    // 4. The egress set, item by item, with the reason for everything withheld.
    section("EGRESS");
    const plan = decision.egress;
    if (plan.admitted.length === 0) {
      line("MAY CROSS", "(nothing)");
    } else {
      for (const a of plan.admitted) line("MAY CROSS", `${a.id}  (${a.kind})`);
    }
    if (plan.withheld.length === 0) {
      line("WITHHELD", "(nothing)");
    } else {
      for (const w of plan.withheld) {
        line("WITHHELD", `${w.id}  — ${w.reason}`);
        detail(`  ${w.detail}`);
      }
    }
    detail(
      `${REQUEST_ITEM_ID} is the text typed after \`ask\`. It is routed like every other item; ` +
        "declare it with `--as <kind>`. Its words are never read to guess a kind.",
    );

    // 5. THE ANSWER. One `Turn`, from one of three producers, on every path out of here.
    //
    //    `admittedForEgress` is what keeps the escalated arm honest, and it does it
    //    structurally: it returns an empty array for every decision other than `escalate`, so
    //    there is no argument to that branch that could carry withheld material into a request
    //    body. The local arm does not consult it, and the reason is worth stating rather than
    //    assuming — the egress plan governs what LEAVES THE MACHINE, and the local runtime is on
    //    the machine. `local-only` means the material stays here, not that it goes unread.
    const admitted = admittedForEgress(decision);
    const admittedIds = new Set(admitted.map((a) => a.id));
    const payloadItems = contextual.filter((i) => admittedIds.has(i.id));
    /* The request is admitted by ID, out of the same plan as everything else. Not by re-reading
       the decision, not by trusting that `escalate` implies it: the message list is built from
       the set the policy returned, so there is no edit to this branch that sends the request
       without the plan having named it. */
    const requestAdmitted = admittedIds.has(REQUEST_ITEM_ID);

    const recordedAt = new Date().toISOString();
    const material = floorMaterial(listed, heldClassified);
    /* `items[3]` — the position in the assembled context, so a citation can be found again. The
       declared prefix of this map is index-for-index the same as `heldClassified`'s own `at`,
       which is why declared material is assembled first. */
    const atOf = new Map(contextual.map((i, n) => [i.id, `items[${n}]`]));
    const consultedOf = (items) =>
      items.map((i) => ({ id: i.id, kind: i.kind, at: atOf.get(i.id) ?? "(unassembled)" }));

    let code = 0;
    /** @type {{id: string, kind: string}[]} */
    let sources = [];
    let produced;
    /* The model's own words, or `null` when a rule produced the turn. Passed explicitly rather
       than dug back out of the rendered turn: the thing memory stores should be the thing the
       producer actually returned, not this file's rendering of it. */
    let learned = null;

    if (decision.decision !== "escalate") {
      // ---------------------------------------------------------------------------------
      // THE LOCAL ARM. Nothing leaves the machine and the request is still answered.
      // ---------------------------------------------------------------------------------
      section("TIER 3");
      line("TIER 3", "not attempted — policy-refused");
      detail(
        `The router decided \`${decision.decision}\`, so nothing left this machine. ` +
          "No call was made to any third party: not the context, and not the prompt either.",
      );
      detail("This is a POLICY refusal. It is not the same fact as an unconfigured provider.");

      section("LOCAL MODEL");
      const configResult = localModelConfigFromEnvironment();
      const baseUrl =
        configResult.state === "configured" ? configResult.config.baseUrl : configResult.baseUrl;
      line("LOCAL MODEL", `base URL ${baseUrl}`);
      detail(
        "LOOPBACK IS CHECKED ON THE PARSED HOSTNAME, twice — once resolving the configuration and " +
          "again immediately before the only fetch — so an edited constant fails CLOSED. A REDIRECT " +
          "IS REFUSED, never followed: the check guards the address this process DIALS, and a 307 " +
          "from the far end naming another host is a second destination it never saw (undici follows " +
          "redirects by default and a 307 carries the body with it). What all of that proves is that " +
          "THIS PROCESS did not dial off-box. It does NOT prove the bytes stop there: whatever " +
          "listens on that port is another program and can forward anything.",
      );
      /* The complete list of what enters the prompt, by id, printed BEFORE the call. On this arm
         nothing is withheld from the local runtime — `local-only` is a statement about the machine
         boundary, and the runtime is inside it — so the honest disclosure is the whole list. */
      if (contextual.length === 0) {
        line("PROMPT", "the request alone — you have nothing on file for it to read");
      } else {
        /* ASSEMBLED, not yet sent. The wording matters: this list is printed before the call so
           it is checkable, and the very next LOCAL MODEL line says whether the call happened at
           all — a refusal on the loopback gate opens no socket, and a list captioned "sent"
           above a refusal would be a false sentence in the transcript. */
        for (const i of contextual) line("PROMPT", `${i.id}  (${i.kind})  body assembled verbatim`);
        detail("Assembled into the prompt. Whether it was SENT is the LOCAL MODEL line below.");
      }

      /*
       * F-004. This list used to frame every item as `[<id> — declared <kind>]`, putting the EGRESS
       * classification in front of the model. Observed against `llama3.2:3b`: it answered that it
       * "considered 'tier1-local,' which suggests that you have some level of seniority or
       * influence" — reading a privacy label as a career grade, and then reasoning about the person
       * from it. The question the kind answers ("may this leave the machine?") was already settled
       * by `route.ts` before this prompt existed, so the token bought nothing and cost that.
       *
       * NOTE WHAT DID NOT CHANGE: the PROMPT lines printed above still show `(${"kind"})` for every
       * item, and `sources` below still records it. Those face the PERSON — the transcript's whole
       * job is telling them what their material is and where it went. The kind is theirs to see and
       * the model's to never receive.
       *
       * The rule now lives in `promptMessages` (@foliage/cos): pure, and tested by name over every
       * member of DECLARED_KINDS, so a kind added later cannot quietly reappear in a prompt.
       */
      const localMessages = promptMessages({
        system:
          "You are a chief of staff running entirely on this person's own machine. Everything " +
          "below is their own material and their own words. Answer the request. Where you say " +
          "something about them, say which of their items it comes from. If their material does " +
          "not answer the request, say what is missing rather than filling it in.",
        items: contextual,
        request,
      });

      const result = await callLocalModel(
        {
          messages: localMessages,
          maxTokens: LOCAL_MAX_TOKENS,
          temperature: 0.2,
          timeoutMs: LOCAL_TIMEOUT_MS,
        },
        configResult,
      );
      sources = contextual.map((i) => ({ id: i.id, kind: i.kind }));

      if (result.state === "completed") {
        const where = `ollama ${result.requestedModel} at ${baseUrl}`;
        line("LOCAL MODEL", "completed");
        detail(`model asked: ${result.requestedModel}; runtime reported: ${result.reportedModel ?? "(it did not say)"}`);
        if (result.reportedModel !== null && result.reportedModel !== result.requestedModel) {
          /* Surfaced rather than smoothed over. Provenance carries the model WE ASKED FOR, because
             that is our own fact and the one a person can reproduce the run against; a name the
             runtime chose to report is the runtime's claim. When the two disagree, something
             other than the declared model answered, and that is the transcript's business. */
          detail(
            `MISMATCH: you asked for "${result.requestedModel}" and the runtime says ` +
              `"${result.reportedModel}" answered. Provenance below names what you asked for. ` +
              `Something else served this request.`,
          );
        }
        detail(`doneReason: ${result.doneReason ?? "(none reported)"}`);
        if (result.usage !== null) {
          detail(
            `prompt tokens ${result.usage.promptTokens ?? "(not reported)"}, generated ` +
              `${result.usage.generatedTokens ?? "(not reported)"}, total_duration ` +
              `${result.usage.totalDurationNs ?? "(not reported)"}ns, load_duration ` +
              `${result.usage.loadDurationNs ?? "(not reported)"}ns`,
          );
        }
        detail(
          `private deliberation: ${result.thinking}. A \`thinking\` block is read only to say ` +
            `whether one came back; its text is never returned, never displayed, and never written ` +
            `to memory. It is not the answer and it was not written about you by you.`,
        );
        learned = result.content;
        const cites = consultedCitations(consultedOf(contextual), where);
        produced = turn(
          localModelProvenance({ runtime: "ollama", model: result.requestedModel, endpoint: baseUrl }),
          ...(cites.length > 0
            ? [cites[0], ...cites.slice(1), modelProseMove(result.content, result.requestedModel, where, consultedOf(contextual).map((c) => contextItemId(c.id)))]
            : [modelProseMove(result.content, result.requestedModel, where, [])]),
        );
      } else {
        /* EVERY named failure lands here and the floor answers anyway, carrying the cause. Four of
           the states are `FloorEntry`'s own `local-model-failed` vocabulary. The other FOUR are
           not failures of a model that was asked — two of them made no request at all, and
           `redirected` is a request WE cut off — so they get `floor-only` and a sentence of their
           own rather than the nearest label. */
        let entry;
        let extraFirst = null;
        switch (result.state) {
          case "no-runtime":
            line("LOCAL MODEL", "no-runtime");
            detail(result.detail);
            entry = { by: "local-model-failed", cause: "no-runtime", detail: result.detail };
            break;
          case "model-absent":
            line("LOCAL MODEL", `model-absent — the runtime answered and does not have "${result.model}"`);
            detail(
              result.installed === null
                ? "It could not be asked what it does have, so nothing is claimed about that."
                : `it holds: ${result.installed.join(", ") || "(nothing)"}`,
            );
            entry = {
              by: "local-model-failed",
              cause: "model-absent",
              detail:
                `The runtime is running and does not hold "${result.model}". That is a pull, not an ` +
                `install — a completely different repair from a runtime that is not there.`,
            };
            break;
          case "timeout":
            line("LOCAL MODEL", `timeout after ${result.afterMs}ms`);
            detail("Our deadline, not the runtime's verdict. A cold model load measured 32.8s on this machine.");
            entry = {
              by: "local-model-failed",
              cause: "timeout",
              detail: `Our own deadline of ${result.afterMs}ms expired.`,
            };
            break;
          case "malformed-response":
            line("LOCAL MODEL", "malformed-response");
            detail(result.detail);
            entry = { by: "local-model-failed", cause: "malformed-response", detail: result.detail };
            break;
          case "refused-non-loopback":
            line("LOCAL MODEL", `REFUSED — not loopback (${result.reason})`);
            detail(
              `The base URL parsed to host "${result.host}", which is not loopback. No socket was ` +
                `opened: this is refused on the PARSED hostname, before any connection, so a string ` +
                `like http://127.0.0.1.evil.com/ — whose host is evil.com's subdomain and not the ` +
                `loopback address it starts with — cannot pass by looking like one.`,
            );
            entry = { by: "floor-only" };
            extraFirst = answer(
              `How you got here: the local model was NOT asked. Your configured base URL ` +
                `(${result.baseUrl}) parses to the host "${result.host}", which is not loopback, so ` +
                `the request was refused before any connection was opened — \`${result.reason}\`. ` +
                `Nothing was sent anywhere. This is a refusal, not a transport failure, and it is ` +
                `not one of the four ways a model that WAS asked can fail.`,
            );
            break;
          case "redirected":
            line("LOCAL MODEL", `REFUSED — the runtime answered ${result.status} and redirected`);
            detail(
              `It pointed at the host ${result.host === null ? "(no parsable Location header)" : `"${result.host}"`}. ` +
                `The redirect was NOT followed: the loopback check guards the URL this process ` +
                `DIALS, and following a hop would hand your material to a destination that check ` +
                `never saw. A 307 preserves the method and the body, so the thing at stake is the ` +
                `whole assembled prompt. Only the status and the PARSED hostname are carried out — ` +
                `not the raw header, not a body — and neither is written to memory, because memory ` +
                `is re-rendered into later prompts (BUG-002).`,
            );
            /* `floor-only`, like the other REFUSALS here and unlike the four failure causes. This
               is not "the model was asked and did not answer" — the local path was cut off by US,
               deliberately, and filing it under `local-model-failed` would both misname it and
               force a fifth member into a domain union whose whole point is that its four members
               are the ways a model that WAS reached can fail. `floor-only` asserts nothing on its
               own (deterministic.ts renders it as no move at all); the answer below carries the
               fact, which is the same shape `refused-non-loopback` uses. */
            entry = { by: "floor-only" };
            extraFirst = answer(
              `How you got here: a request WAS opened to your configured base URL ` +
                `(${baseUrl}) — that address is loopback and passed the check — and the ` +
                `thing listening there answered HTTP ${result.status}, a redirect ` +
                `${result.host === null ? "with no parsable Location" : `to the host "${result.host}"`}. ` +
                `It was refused rather than followed, so no completion was obtained and the floor ` +
                `answered instead. This matters more than an ordinary transport failure: a 307 ` +
                `preserves the method and the BODY, so following it would have carried this whole ` +
                `prompt — your material and your words — to a host the loopback check never saw. ` +
                `The check guards the address this process dials; it cannot guard a second address ` +
                `chosen after the fact by whatever is on the other end.`,
            );
            break;
          case "no-model-declared":
            line("LOCAL MODEL", "no model declared");
            detail(`missing: ${result.missing.join(", ")} — see apps/cos/env.example`);
            entry = { by: "floor-only" };
            extraFirst = answer(
              `How you got here: no local model was asked, because none is declared — ` +
                `${result.missing.join(", ")} is unset. Nothing was guessed at: a default model name ` +
                `would be this code inventing which model reasoned about you. This is not a failure ` +
                `of a model, it is the absence of one.`,
            );
            break;
          default:
            line("LOCAL MODEL", `runtime-refused (HTTP ${result.status})`);
            detail(
              "Status only. The response body is never read into any result, so provider error " +
                "text cannot re-enter a prompt (BUG-002).",
            );
            entry = { by: "floor-only" };
            extraFirst = answer(
              `How you got here: something is listening on the local runtime's port and it answered ` +
                `HTTP ${result.status}. That is neither "nothing is running" nor "the model is not ` +
                `installed" nor a reply this code could not read, so it is reported as itself. Only ` +
                `the status is carried — the body is never read, so nothing the server said can end ` +
                `up in a prompt.`,
            );
            break;
        }
        produced = floorTurn({ request, declaredKind, material, entry, extraFirst });
      }
    } else if (!requestAdmitted) {
      /* Unreachable while `escalate` means "the withheld set is empty" — the request is one of
         the classified items, so an escalation cannot have left it behind. Handled anyway, the
         way decide() handles the refused arm it also cannot reach: an invariant that is only
         true is worth less than one that is also checked, and this is the branch where being
         wrong means sending someone's sentence to a third party. */
      section("TIER 3");
      line("TIER 3", "not attempted — policy-refused");
      detail(`The egress plan did not admit ${REQUEST_ITEM_ID}, so there is nothing to ask. No call was made.`);
      sources = contextual.map((i) => ({ id: i.id, kind: i.kind }));
      produced = floorTurn({
        request,
        declaredKind,
        material,
        entry: {
          by: "policy",
          decision: "local-only",
          detail: `The egress plan did not admit ${REQUEST_ITEM_ID}.`,
        },
      });
      code = 1;
    } else {
      // ---------------------------------------------------------------------------------
      // THE ESCALATED ARM. Only the admitted payload is even visible to this branch.
      // ---------------------------------------------------------------------------------
      section("TIER 3");
      for (const i of payloadItems) line("PROMPT", `${i.id}  (${i.kind})  body assembled verbatim`);
      if (payloadItems.length === 0) line("PROMPT", "the request alone — no stored item was admitted");
      detail(
        "This list is the egress plan's ADMITTED set and nothing else — `admittedForEgress` " +
          "returns an empty array for every decision but `escalate`, so a withheld item has no " +
          "route into this body. Whether it was SENT is the TIER 3 line below.",
      );

      const messages = [
        {
          role: "system",
          content:
            "You are a local chief of staff. You have been given only the material the person's " +
            "egress policy permitted to leave their machine.",
        },
        ...payloadItems.map((i) => ({ role: "user", content: i.body })),
        { role: "user", content: request },
      ];

      const config = fireworksConfigFromEnvironment();
      const result = await callFireworks({ messages, maxTokens: 1024, temperature: 0.2 }, config);
      sources = payloadItems.map((i) => ({ id: i.id, kind: i.kind }));

      if (result.state === "completed") {
        const modelName = config.state === "configured" ? config.config.model : "(unnamed)";
        const where = `fireworks ${modelName}`;
        line("TIER 3", "completed");
        detail(`finishReason: ${result.finishReason ?? "(none reported)"}`);
        detail(
          "Only `choices[0].message.content` is ever read from the response. A `reasoning_content` " +
            "channel, if the provider sent one, is not parsed at all — so it cannot be shown as the " +
            "answer and there is no value carrying it for memory to refuse.",
        );
        learned = result.completion;
        const cites = consultedCitations(consultedOf(payloadItems), where);
        produced = turn(
          escalatedProvenance({ runtime: "fireworks", model: modelName, endpoint: null }),
          ...(cites.length > 0
            ? [cites[0], ...cites.slice(1), modelProseMove(result.completion, modelName, where, consultedOf(payloadItems).map((c) => contextItemId(c.id)))]
            : [modelProseMove(result.completion, modelName, where, [])]),
        );
      } else {
        let entry;
        let extraFirst = null;
        switch (result.state) {
          case "no-credential":
            line("TIER 3", "attempted — no-credential");
            detail(`missing: ${result.missing.join(", ")}`);
            if (result.ignored.length > 0) {
              detail(`set but deliberately NOT used: ${result.ignored.join(", ")}`);
            }
            detail(
              "The router PERMITTED this call. There is no provider configured on this machine to " +
                "make it to. That is the opposite of a policy refusal.",
            );
            entry = {
              by: "escalation-failed",
              cause: "no-credential",
              detail: `The router permitted the call and there was nothing configured to make it to (${result.missing.join(", ")}).`,
            };
            break;
          case "no-model":
            line("TIER 3", "attempted — no-model");
            detail(`missing: ${result.missing.join(", ")}`);
            entry = {
              by: "escalation-failed",
              cause: "no-model",
              detail: `No model is declared for the provider (${result.missing.join(", ")}).`,
            };
            break;
          case "timeout":
            line("TIER 3", `attempted — timeout after ${result.afterMs}ms`);
            detail("Our deadline, not the network's verdict.");
            entry = {
              by: "escalation-failed",
              cause: "timeout",
              detail: `Our own deadline of ${result.afterMs}ms expired.`,
            };
            break;
          case "network-unreachable":
            line("TIER 3", "attempted — network-unreachable");
            detail(result.detail);
            entry = { by: "escalation-failed", cause: "network-unreachable", detail: result.detail };
            break;
          case "provider-refused":
            line("TIER 3", `attempted — provider-refused (HTTP ${result.status})`);
            detail(`the provider said: ${result.providerMessage}`);
            detail(`read from: ${result.providerMessageSource}`);
            /* The provider's own words are PRINTED and never carried into the floor's entry
               detail, because the floor's turn is what memory stores and what the next prompt
               could be built from. Failures are classified by status alone (Janus §D27). */
            entry = {
              by: "escalation-failed",
              cause: "provider-refused",
              detail: `The provider answered HTTP ${result.status}. Its message was printed above and is deliberately not carried any further.`,
            };
            break;
          case "malformed-response":
            line("TIER 3", "attempted — malformed-response");
            detail(result.detail);
            entry = { by: "escalation-failed", cause: "malformed-response", detail: result.detail };
            break;
          case "redirected":
            /* ADDED 2026-08-19, HOURS AFTER THE STATE ITSELF. `redirected` was added to
               `FireworksResult` when the hop gate was closed on this arm, and this switch was not
               updated — so a refused redirect printed "attempted — unknown state" and was filed as
               `malformed-response`, which says the provider sent us nonsense when in fact WE
               refused to follow it somewhere. The fix for "the guard landed on one arm only"
               shipped with "the new state landed on one arm only", which is the same bug class two
               hours later. A `default:` that swallows an unhandled member is what let it: an
               exhaustive mapping owned by the client, next to its own union, would have been a
               build failure instead of a wrong sentence. Recorded as F-012. */
            line("TIER 3", `REFUSED — the provider answered ${result.status} and redirected`);
            detail(
              `It pointed at the host ${result.host === null ? "(no parsable Location header)" : `"${result.host}"`}. ` +
                `The redirect was NOT followed. A 307 preserves the method AND the body, so ` +
                `following it would have carried the admitted material — which the egress account ` +
                `above cleared to leave for THIS provider — to a host that appears nowhere in that ` +
                `account. Only the status and the PARSED hostname are carried out.`,
            );
            entry = { by: "floor-only" };
            extraFirst = answer(
              `How you got here: the router permitted this call and it was opened to your ` +
                `configured provider, which answered HTTP ${result.status} — a redirect ` +
                `${result.host === null ? "with no parsable Location" : `to the host "${result.host}"`}. ` +
                `It was refused rather than followed, so no completion was obtained and the floor ` +
                `answered instead. This is not the provider declining to answer: it is us declining ` +
                `to deliver your material to a second address nobody accounted for.`,
            );
            break;

          default:
            line("TIER 3", "attempted — unknown state");
            entry = {
              by: "escalation-failed",
              cause: "malformed-response",
              detail: "The client returned a state this seam does not know. Treated as unusable rather than as success.",
            };
            break;
        }
        produced = floorTurn({ request, declaredKind, material, entry, extraFirst });
      }
    }

    printTurn(produced);
    await rememberTurn(store, {
      request,
      produced,
      sources,
      recordedAt,
      learned,
      priorActive:
        recalled.state === "present" ? activeMemories(recalled.memories) : [],
    });
    return code;
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------------------
// The commands that make `ask` demonstrable: a person has to be able to put something in the
// store and take it out again, or the router has nothing real to route.
// ---------------------------------------------------------------------------------------

async function commandInit() {
  const opened = await openConfiguredStore({ create: true });
  if (opened.state !== "opened") {
    printOpenFailure(opened);
    return 1;
  }
  printStoreHeader(opened.store);
  const listed = await opened.store.list();
  line("STATE", listed.state === "empty" ? "empty — nothing declared yet" : listed.state);
  opened.store.close();
  return 0;
}

async function commandDeclare(id, kind, body) {
  if (!id || !kind || body === undefined) {
    fail("usage: node apps/cos/cos.mjs declare <id> <declared-kind> <body>");
    return 2;
  }
  const opened = await openConfiguredStore({ create: false });
  if (opened.state !== "opened") {
    printOpenFailure(opened);
    return 1;
  }
  const store = opened.store;
  try {
    /* `recordedAt` comes from the caller because localStore has no clock and invents no time.
       This file is an app, so it is allowed to read one — and it reads it HERE, at the edge,
       rather than anywhere a decision is made. */
    const result = await store.put({ id, kind, body, recordedAt: new Date().toISOString() });
    if (result.state === "refused") {
      line("DECLARE", `refused — ${result.cause}`);
      detail(result.detail);
      return 1;
    }
    line("DECLARE", `${result.replaced ? "replaced" : "written"} — ${result.id} declared ${kind}`);
    return 0;
  } finally {
    store.close();
  }
}

async function commandList() {
  const opened = await openConfiguredStore({ create: false });
  if (opened.state !== "opened") {
    printOpenFailure(opened);
    return 1;
  }
  const store = opened.store;
  try {
    printStoreHeader(store);
    const listed = await store.list();
    if (listed.state === "unreadable") {
      line("LIST", `unreadable — ${listed.cause}`);
      detail(listed.detail);
      return 1;
    }
    if (listed.state === "empty") {
      line("LIST", "empty — nothing has been declared into this store");
      return 0;
    }
    for (const i of listed.items) line("ITEM", `${i.id}  ${i.kind}  ${i.recordedAt}  ${i.body}`);
    for (const f of listed.failed) line("FAILED", `${f.blindIdHex.slice(0, 16)}…  ${f.cause}`);
    return 0;
  } finally {
    store.close();
  }
}

async function commandForget(id) {
  if (!id) {
    fail("usage: node apps/cos/cos.mjs forget <id>");
    return 2;
  }
  const opened = await openConfiguredStore({ create: false });
  if (opened.state !== "opened") {
    printOpenFailure(opened);
    return 1;
  }
  const store = opened.store;
  try {
    const result = await store.remove(id);
    line("FORGET", result.state === "refused" ? `refused — ${result.cause}` : `${result.state} — ${id}`);
    return result.state === "refused" ? 1 : 0;
  } finally {
    store.close();
  }
}

function usage() {
  stdout.write(
    [
      "foliage local chief-of-staff — EXPERIMENTAL",
      "",
      "An experimental command-line tool, not part of the Foliage app. The app is `foliage up`",
      "(node foliage.mjs up); nothing here reads or writes your portfolio or review queue.",
      "",
      "  node apps/cos/cos.mjs init",
      "      Create the Tier 1 store. The ONLY command that creates a file — every other",
      "      command refuses a missing store, so a typo in a path never looks like data loss.",
      "",
      "  node apps/cos/cos.mjs declare <id> <declared-kind> <body>",
      "      Record material and DECLARE what it is. Nothing is inferred: an item declared",
      "      nothing about gets the most restrictive answer, with `undeclared` as the reason.",
      "      Kinds: tier1-local | tier2-confidential | tier3-shareable",
      "",
      "  node apps/cos/cos.mjs list",
      "  node apps/cos/cos.mjs forget <id>",
      "",
      '  node apps/cos/cos.mjs ask [--as <declared-kind>] "<a real request>"',
      "      Retrieve, classify, compute the egress set, ANSWER, and remember what the turn learned.",
      "",
      "      THERE IS ALWAYS AN ANSWER. `local-only` is answered by the local model over loopback;",
      "      `escalate` is answered by the configured provider. Every named failure of either — and",
      "      no model configured at all — falls through to a deterministic floor that enumerates what",
      "      you have declared and says what is missing. The ANSWER section names which produced it.",
      "",
      "      THE REQUEST IS ROUTED TOO. What you type here is material that would cross to the",
      "      inference provider, so it enters the egress plan as `<request>` and is declared,",
      "      never sniffed. Without `--as` it is `undeclared`, which pins the run to local-only",
      "      and sends nothing — the same answer stored material gets when nobody declared it.",
      "",
      "EXIT CODES. 0 means a TURN WAS PRODUCED against a store this build could read — including",
      "every model failure, because the floor answered and a degraded answer is still an answer.",
      "1 means the store could not be opened or listed, or the router refused the input as",
      "malformed; both still print an ANSWER, because there is no path here that reports a",
      "decision and shows you nothing. 2 is a usage error.",
      "",
      "Environment: see apps/cos/env.example.",
      "",
    ].join("\n"),
  );
}

/**
 * Split `ask`'s arguments into the declaration and the request text.
 *
 * `--as <kind>` and `--as=<kind>` only, and only ahead of the request. An unknown leading `--`
 * flag is REFUSED rather than swallowed into the request text: a mistyped `--ass tier3-shareable`
 * silently becoming part of the sentence someone is about to send is the "ignored key" failure
 * that classify.ts refuses for the same reason. `--` on its own ends the flags, so a request
 * that genuinely begins with a dash can still be asked.
 */
function parseAskArgs(args) {
  let declaredKind = null;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "--as") {
      const value = args[i + 1];
      if (value === undefined) return { state: "usage", message: "--as needs a declared kind: tier1-local | tier2-confidential | tier3-shareable" };
      declaredKind = value;
      i += 2;
      continue;
    }
    if (arg.startsWith("--as=")) {
      declaredKind = arg.slice("--as=".length);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { state: "usage", message: `unknown option: ${arg}. Options are refused rather than read as part of the request.` };
    }
    break;
  }
  return { state: "parsed", declaredKind, request: args.slice(i).join(" ") };
}

async function main() {
  const [command, ...rest] = argv.slice(2);
  switch (command) {
    case "init":
      return commandInit();
    case "declare":
      return commandDeclare(rest[0], rest[1], rest.slice(2).join(" "));
    case "list":
      return commandList();
    case "forget":
      return commandForget(rest[0]);
    case "ask": {
      const parsed = parseAskArgs(rest);
      if (parsed.state === "usage") {
        fail(parsed.message);
        fail('usage: node apps/cos/cos.mjs ask [--as <declared-kind>] "<a real request>"');
        return 2;
      }
      return commandAsk(parsed.request, parsed.declaredKind);
    }
    case undefined:
    case "help":
    case "--help":
      usage();
      return 0;
    default:
      fail(`unknown command: ${command}`);
      usage();
      return 2;
  }
}

exit(await main());
