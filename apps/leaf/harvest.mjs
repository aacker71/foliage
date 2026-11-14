#!/usr/bin/env node
/**
 * PHOTOSYNTHESIS HARVEST — draft leaflet candidates from real history, review them by hand,
 * and promote only the approved into a leaf.
 *
 *   node apps/leaf/harvest.mjs propose --repo <path> --identity <email> [--into <leaf.json>] [--out <path>]
 *   node apps/leaf/harvest.mjs propose-photos --dir <path> [--out <path>]
 *   node apps/leaf/harvest.mjs propose-brain --about "<question>" [--out <path>]
 *   node apps/leaf/harvest.mjs review [--doc <path>]
 *   node apps/leaf/harvest.mjs approve <id> --by <name> --doc <path>
 *   node apps/leaf/harvest.mjs reject <id> --by <name> --reason "<why>" --doc <path>
 *   node apps/leaf/harvest.mjs promote --doc <harvest.json> --into <leaf.json> [--out <path>] [--force]
 *   node apps/leaf/harvest.mjs adopt --doc <harvest.json> --into <leaf.json> --repo <path> [--apply]
 *
 * The seam this command sits on: everything the machine knows about its own extraction —
 * clusters, evidence lists, extractor identity, review decisions — lives in the HARVEST
 * document, and only approved titles cross into the leaf, as ordinary pending leaflets the
 * existing gate accepts unchanged. Drafting is a suggestion; a person's portfolio only ever
 * changes because a person approved something.
 *
 * A CANDIDATE IS A CLAIM ABOUT ONE PERSON'S WORK, so `propose` cannot run without being told
 * whose. It takes `--identity` exactly as `intake.mjs` does — repeatable, because a real person
 * has a work address, a personal one and a GitHub noreply — and it clusters ONLY the commits the
 * DOMAIN attributes to those identities. The rule is not re-implemented here: its queue read
 * (`src/gitQueueSource.ts`) calls `commitsToLeaflets` from `@foliage/leaf`, the same function
 * `intake.mjs` uses, so a commit
 * withheld from a cluster is exactly a commit the leaf will record as `excluded`, by construction
 * rather than by two implementations agreeing today. Until 2026-08-19 there was no such flag and
 * no filter of any kind: every commit `git log` returned went into a cluster, so on ANY repository
 * with more than one author a candidate could be promoted onto a leaflet whose tier says
 * "attributed to this person" while the same leaf marked those very shas "could not be attributed
 * to this subject". Attributing somebody else's commits to the subject is the one thing this
 * product exists to refuse, and it was live on the default path.
 *
 * THREE LIGHT SOURCES, ONE SEAM. `propose` reads git history; `propose-photos` reads a
 * directory of images the operator names; `propose-brain` reads the pages a personal knowledge
 * base already holds, through the deterministic retrieval layer in `tools/vault`. They produce
 * candidates in the same format, review and promote handle them identically, and none has any
 * privileged path into a leaf. The second source needed no change to the harvest format, to
 * review, or to promotion; the third needed ONE optional candidate field (`shownPages`) and one
 * more thing said at review, and nothing at all in promotion — recorded here rather than left as
 * the older, tidier claim that no source ever changed the format. Why that field could not be
 * anything already in the format is argued in `harvestDocument.ts`.
 *
 * THE THIRD SOURCE CARRIES A HAZARD THE OTHER TWO DO NOT: a knowledge base holds notes about
 * OTHER, IDENTIFIABLE PEOPLE. `propose-brain` withholds the directories that hold them unless
 * the operator says otherwise, names every page it withheld, marks every ref that comes off one
 * when they are included, records the whole pack each drafted title was written from, and says
 * so at review whenever ANY page in that pack was one about somebody else — not merely when a
 * ref happens to be. That last distinction is a fix, not a flourish: the mark is read off a
 * page's PATH, the drafter is shown every offered page at once, and a name that arrives through
 * page CONTENT reaches a line citing some other page completely unmarked. It rewrites nothing —
 * see the header of `packages/photosynthesis/src/brainIntake.ts` for why a redactor is the wrong
 * tool, and why a name detector reporting confidence is a worse one.
 *
 * WHAT IT REFUSES TO DO, same disciplines as intake.mjs:
 *   - It never writes a document from a failed read, and it validates its OWN output with the
 *     matching parser (parseHarvestDocument / parseLeafDocument) before anything reaches disk.
 *   - It never overwrites without --force: new files are created with an atomic exclusive
 *     create, and review-state write-backs go through write-temp-then-rename, so a crash
 *     leaves the old document intact rather than half of a new one.
 *   - Rejection REQUIRES --reason. A rejection without a reason is a silent disappearance.
 *   - `--draft-with-local-model` FAILS CLOSED. Titles come either from the deterministic
 *     clusterer or from the local model — never silently from one when the other was asked
 *     for, because an output whose provenance is ambiguous is worse than no output. The model
 *     endpoint is loopback ONLY; this command makes no network call beyond 127.0.0.1, ever.
 *     That last sentence is a claim about a SOCKET, so it is enforced where the socket is
 *     opened: every model call in this app goes through `src/loopbackFetch.ts`, which checks the
 *     host and refuses to follow a redirect. Checking the host here and calling `fetch` was not
 *     enough — a 307 preserves method and body, and undici followed it.
 *
 * Zero third-party runtime dependencies: parseArgs, fetch and git are already on the machine.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");

const {
  BRAIN_THIRD_PARTY_SOURCE,
  THIRD_PARTY_DIRECTORIES,
  adoptionRefusalLabel,
  brainNotesToCandidates,
  brainPageKind,
  clusterBySubjectPrefix,
  draftKey,
  gitLineage,
  parseHarvestDocument,
  reviewSubjectDigest,
  partitionRetrieved,
  photosToCandidates,
  planQueueAdoption,
  promoteApproved,
  withCandidates,
} = await import("@foliage/photosynthesis").catch(explainFailedWorkspaceImport);
const { parseLeafDocument, RATING_SHAPED } = await import("@foliage/leaf").catch(
  explainFailedWorkspaceImport,
);
const { narrowingNotice } = await import("./src/gitIntake.ts").catch(explainFailedWorkspaceImport);
const { foliageNextStep } = await import("./src/foliageNextStep.ts").catch(explainFailedWorkspaceImport);
const { checkoutPresence, queueRepositoryMatch, readQueueCommits } = await import("./src/gitQueueSource.ts").catch(
  explainFailedWorkspaceImport,
);
const { loopbackFetch } = await import("./src/loopbackFetch.ts").catch(
  explainFailedWorkspaceImport,
);
const { LOCAL_DESCRIBER_MODEL, describeImage, isReadFailure, readImages } = await import(
  "./src/photoSource.ts"
).catch(explainFailedWorkspaceImport);
const { mediaRootFromEnv } = await import("./src/mediaStore.ts").catch(explainFailedWorkspaceImport);
const {
  DEFAULT_VAULT_SOURCE,
  LOCAL_DRAFTER_MODEL,
  VAULT_BUILD_COMMAND,
  confirmPages,
  draftLeaflets,
  readPages,
  retrieveFromVault,
} = await import("./src/brainSource.ts").catch(explainFailedWorkspaceImport);
// THE ONE SHARED STEP all three propose producers use to read-fresh, carry a binding and its
// review decisions forward, and assemble+validate the document — see the file's own header for
// why it lives apart from all three (PR #17 review, blockers 1 and 2).
const { prepareProposedDocument, queuedRepository } = await import("./src/proposeDocument.ts").catch(
  explainFailedWorkspaceImport,
);

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Default harvest location: next to the app, not in public/, and gitignored — same reasoning
 * as the default leaf document. A harvest holds verbatim commit subjects from a real repo. */
const DEFAULT_HARVEST_PATH = resolve(APP_DIR, "harvest.json");

/**
 * After a draft: this garden's `foliage review`, or the lower-level review outside a garden.
 * @param {string} doc
 */
const reviewStep = (doc) => foliageNextStep("review", doc) ?? `node apps/leaf/harvest.mjs review --doc ${doc}`;

/** The deterministic extractor's identity, as it appears in candidates and, after promotion,
 * in `Provenance.source` ("photosynthesis:git-cluster"). */
const DETERMINISTIC_EXTRACTOR = "git-cluster";

/**
 * The local model endpoint. LOOPBACK ONLY — the open plane's privacy claim is "zero network
 * calls beyond 127.0.0.1", and it is enforced by `loopbackFetch` on the parsed URL rather than
 * trusted to this constant, so a future edit here fails closed instead of silently egressing.
 *
 * THE OVERRIDE EXISTS SO THE SEAM CAN BE TESTED, and it widens nothing. What this command does
 * with a model's answer — refuse a rating-shaped title, fail closed on an unreachable host —
 * cannot be exercised at all while the port is a literal: 11434 is a fixed well-known port, and
 * a test that binds it either collides with the operator's real ollama or, worse, sends the
 * repository's commit subjects to it. So the ADDRESS is configurable and the POLICY is not: the
 * check runs on the URL this resolves to, whatever its source, so pointing this at a
 * non-loopback host still refuses to draft.
 *
 * READ FROM THE ENVIRONMENT, which is why the redirect hole mattered more here than the word
 * "ollama" suggests: an operator does not have to be running a compromised model server for this
 * variable to name something that answers 307. Nothing downstream trusts this string — it is
 * parsed, its host is checked, and the socket that gets opened is the one that was checked.
 *
 * IT REACHES ALL THREE SUBCOMMANDS, and until the seam was driven it reached only this one.
 * `propose-brain` and `propose-photos` call into `brainSource.ts` and `photoSource.ts`, which
 * take an `endpoint` option and fall back to the same literal; this file passed neither, so the
 * variable the usage text documents was silently ignored on two of the three paths. That is a
 * testability hole with a real consequence: the 307 refusal could be exercised through the REAL
 * user path here and NOWHERE ELSE, leaving two call sites proven by unit test alone — which this
 * repo does not accept as proof that a thing works. One configured address, three call sites,
 * one guard. The policy is still not configurable: each site sends through `loopbackFetch`, so
 * naming a non-loopback host here refuses to draft, to describe, and to send.
 */
const OLLAMA_URL = process.env["FOLIAGE_OLLAMA_URL"] ?? "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODEL = "gemma4:12b";
/**
 * Per-request ceiling. A local model that hangs must fail with a named cause, never wedge.
 *
 * 10s was the first guess and it was wrong on the only machine this has run on: a measured
 * request to gemma4:12b took 39.2s wall (3.6s of it loading the model), so the flag failed
 * closed on every invocation and the AI path was unusable. The number is deliberately far
 * above that measurement rather than just above it — generation time scales with the cluster's
 * commit count, and a cold load on a busier machine is slower than a warm one here.
 *
 * A ceiling this high is only safe because the failure is loud: nothing is written, the cause
 * is printed, and the deterministic titles are never silently substituted.
 */
const OLLAMA_TIMEOUT_MS = 180_000;

const USAGE = `Photosynthesis harvest — draft leaflet candidates from a repository's real history,
review them by hand, and promote only the approved into a leaf document.

  node apps/leaf/harvest.mjs <subcommand> [options]

Subcommands
  propose --repo <path> --identity <email> [--identity <email>]... [--into <leaf.json>]
          [--out <path>] [--force] [--draft-with-local-model] [--workflow <workflow.json>]
      Read real commit history and draft candidates per conventional-commit prefix (the text
      before the first ":" in each subject). Decided candidates stay exactly as they are; commits
      they do not hold come back as new drafts, git-cluster:<prefix>:<n> after the first. Writes
      a harvest document (default: ${DEFAULT_HARVEST_PATH}).
      --identity is REQUIRED and repeatable, exactly as in intake.mjs: a candidate is a claim
      about ONE person's work, and only commits the domain attributes to one of the declared
      identities are clustered. A commit authored by somebody else is counted, named by prefix,
      and never drafted from — it is not this subject's work, and a cluster it entered would
      promote into a leaflet asserting attribution the leaf itself denies for that sha.
      --into <leaf.json>, OPTIONAL, names the leaf this harvest is being drafted FOR: a real,
      parseable leaf document, gated exactly as promote's own --into is. When given, the
      subject and leaf id it names are recorded on the harvest document, so a later \`promote
      --into\` pointed at a DIFFERENT leaf refuses by name instead of silently promoting one
      subject's approvals into another subject's portfolio. Without it the document is written
      unbound, and \`promote\` says so plainly rather than assuming it belongs wherever it lands.
      --draft-with-local-model asks ${OLLAMA_MODEL} on 127.0.0.1:11434 for better one-line
      titles; if the model is unreachable the command FAILS with the cause — it never falls
      back silently, because a title whose provenance is ambiguous is worse than none.
      --workflow <workflow.json> names the collector that writes this same queue. A draft it
      made stays while any of its checkouts of this repository still holds the commits, a
      paused or unreadable checkout withdraws nothing, and commits a legacy packet decision
      holds are never drafted again. A draft withdrawn by this run is listed by id.

  propose-photos --dir <path> [--out <path>] [--force] [--describe-with-local-model]
      Read a directory of real image files — identified by their BYTES, not their extension —
      and draft one candidate per distinct image, evidenced by its SHA-256 content digest.
      Only the directory you name is read; nothing is scanned by default.
      Images are stored with their metadata (location included) removed, in media/ beside the
      --out document; FOLIAGE_MEDIA, or media/ beside FOLIAGE_LEAF, wins when set.
      \`foliage photos <dir>\` runs this against a garden.
      If a file in it cannot be READ, the command fails with the cause and writes nothing: a
      scan that was locked out is an undercount, and an undercount written to disk is
      indistinguishable from a directory that honestly holds no images.
      Without --describe-with-local-model each title states what was measured about the file
      and nothing more. With it, ${LOCAL_DESCRIBER_MODEL} on 127.0.0.1:11434 drafts a line per
      image; if the model is unreachable the command FAILS with the cause and writes nothing.
      A photograph shows that a file exists — never who made what it depicts — so these
      candidates promote to "pending", and text the model reads off an image is printed for
      you and NEVER recorded: it demonstrably invents text it cannot see.

  propose-brain --about "<question>" [--out <path>] [--force] [--draft-with-local-model]
                [--include-third-party] [--source <a,b>] [--budget <tokens>] [--max <nodes>]
                [--vault <dir>]
      Retrieve the pages of your own knowledge base that answer a question — deterministically,
      through tools/vault, which ranks index entries without opening a file or calling a
      model — and draft one candidate per page. Requires \`${VAULT_BUILD_COMMAND}\` to have run;
      a missing index is reported as exactly that and never as an empty result.
      Every selected page is then CONFIRMED to exist before anything is drafted or written, in
      both modes — by stat, so no page is opened. An index lists the disk as it was when it was
      built, and a page deleted since would otherwise become an evidence ref that resolves to
      nothing, stamped with a time somebody supposedly observed it. A page that does not resolve
      names its own cause and the command writes nothing.
      --draft-with-local-model shows the retrieved pages to ${LOCAL_DRAFTER_MODEL} on
      127.0.0.1:11434 and asks it to propose leaflets, each citing the pages it rests on. A
      claim citing a page the model was not given is REFUSED and reported — that is the model
      citing a source it never saw. If the model is unreachable the command FAILS with the
      cause and writes nothing.
      --source is a HARD scope here (default "${DEFAULT_VAULT_SOURCE}"). The retriever's own
      graph walk follows links OUT of it — measured on a real index: two of four selected pages
      came from another source — so a page outside the scope is removed, named, and never
      drafted from.
      A knowledge base holds notes about OTHER PEOPLE. Pages under ${[...THIRD_PARTY_DIRECTORIES].join("/")}
      are withheld from drafting by default and named; --include-third-party offers them, and
      every ref off one is then marked "${BRAIN_THIRD_PARTY_SOURCE}" in the document. That mark
      is read off the page's PATH and covers only the pages a candidate CITES, so it is not the
      whole protection and is not described as one: the drafter sees every offered page in one
      prompt, so a name can travel through page CONTENT into a line citing another page. Each
      drafted candidate therefore records the whole pack it was written from, and review says so
      whenever any page in that pack was one about somebody else. Nothing is ever rewritten or
      silently dropped, and nothing here detects names — you are the reader who can.
      What a page says is not proof of anything — approved candidates promote to "pending".

  review [--doc <path>]
      List every candidate with its review state, evidence count and extractor — and, for a
      candidate a model titled, the whole pack that model was shown: which pages, which of them
      were third-party-shaped, and how much of each it actually saw. The caution about notes on
      other people fires on that pack, not on which refs a candidate happens to cite.

  approve <id> --by <name> [--title "<your words>"] --doc <path>
  reject <id> --by <name> --reason "<why>" --doc <path>
      Record a review decision, written back atomically. Rejection REQUIRES a reason.
      A candidate that was already decided is refused, with its current state named.
      --doc is REQUIRED — F-025's own sweep — and never defaults: the same real, irreversible
      write promote's --doc guards against, one command over.

  promote --doc <harvest.json> --into <leaf.json> [--out <path>] [--force]
          [--supersede <id>]...
      --doc, REQUIRED — F-025 — names the harvest document to promote FROM. It never defaults:
      an earlier version silently fell back to a well-known path beside this script when --doc
      was left off, which promoted whatever candidate happened to sit there — a stale document,
      possibly one from an unrelated run — with only a soft caveat printed, never a refusal.
      Append every APPROVED candidate to the leaf as a "pending" leaflet (drafted and
      reviewed is attributable, never cryptographically verified) and re-validate the result
      with parseLeafDocument before writing. --out defaults to the --into path, which is why
      overwriting it needs --force. Prints honest counts, including a plain zero.
      A candidate resting on any ref the TARGET LEAF records as "excluded" is REFUSED whole and
      named, with the leaf's own reason quoted: promoting it would assert attribution the same
      document denies about the same sha, and trimming the offending refs would leave an
      approved title — usually a count — standing over a list nobody approved.
      If the document was proposed with --into (above), --into HERE must name that SAME leaf —
      by subject and by leaf id. A mismatch refuses the WHOLE promotion, both values named,
      before any candidate is looked at: this is what stops one subject's approvals from
      silently landing in another subject's leaf. A document with no recorded binding at all
      (proposed before this existed, or with no --into) still promotes, but says so —
      "unbound document — binding not checked" — rather than assuming it belongs here.
      --supersede <id>, OPTIONAL and repeatable, names a candidate id this run may REPLACE an
      existing leaflet of the same id with, in place, instead of refusing it as a duplicate.
      This is PLUMBING for a caller that already asked a person and got a yes about THIS BODY,
      not a shortcut for a script to grant itself. Naming an id here is not enough by
      itself: promote.ts still refuses the replacement, by name, unless the existing leaflet was
      produced by the SAME extractor, this harvest's target binding was CHECKED (never on an
      unbound-legacy document), and the existing leaflet is the same lineage — its provenance
      ref is this candidate's primary evidence ref, or every ref it holds is among this
      candidate's evidence. The existing leaflet's own \`visibility\` is always
      carried over — this flag only settles whether the BODY is the same claim, never whether
      it should stay shared.
      Interactive review also passes --expect-leaf-digest <sha256 hex> and one
      --expect-supersede '<JSON [id, review digest]>' per replacement. Together they bind the
      permission to the displayed leaf and approved body; both are rechecked under the locks.

  adopt --doc <harvest.json> --into <leaf.json> --repo <path> [--apply]
      ONE-TIME, owner-run (\`foliage migrate-queue\`). Records the leaf and repository this
      harvest belongs to, dates every git ref from --repo, and lands approved clusters whose
      PRIVATE leaflet the approval only extends — same extractor, every old ref kept, nothing
      the promotion would drop, the approval's digest matching the body. Any other shape refuses
      the whole run by name. Without --apply it prints each change and writes nothing. With
      --apply it backs both files up beside themselves (*.before-adopt-<ms>.json), then writes
      the harvest and the leaf. A second --apply finds nothing to do and writes nothing.

Nothing this command produces is scored, rated or ranked, and it makes no network call
beyond 127.0.0.1.
`;

/** Exit codes, so a caller can tell a usage mistake from a real failure. */
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

/** @param {string} message @returns {never} */
function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`harvest: ${message}\n`);
  process.exit(code);
}

/** @param {unknown} err @returns {string} */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A held document lock is a refusal with its remedy, in one line — never a stack trace.
 * @param {unknown} err @returns {never}
 */
function failIfBusy(err) {
  if (err !== null && typeof err === "object" && "code" in err && err.code === "ELOCALBUSY") fail(messageOf(err));
  throw err;
}

/**
 * Both causes, always — the AGENTS.md error-masking rule. A fetch failure routinely wraps
 * the real socket error in `cause`, and printing only the wrapper ("fetch failed") is how a
 * connection refusal masquerades as a mystery.
 *
 * @param {unknown} err @returns {string}
 */
function messageWithCause(err) {
  const outer = messageOf(err);
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : undefined;
  return cause === undefined ? outer : `${outer} (cause: ${messageOf(cause)})`;
}

/**
 * Parse this subcommand's arguments, or exit with usage. strict:true means a flag that
 * belongs to a different subcommand is refused loudly rather than silently ignored.
 *
 * @param {string[]} args
 * @param {import("node:util").ParseArgsConfig["options"]} options
 * @param {boolean} allowPositionals
 * @returns {{values: Record<string, unknown>, positionals: string[]}}
 */
function parseOrUsage(args, options, allowPositionals) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals });
  } catch (err) {
    process.stderr.write(`${messageOf(err)}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
}

/**
 * Write a NEW document: atomic exclusive create unless --force, exactly the intake.mjs
 * guard, so two runs cannot race past the existence check.
 *
 * @param {string} path @param {string} serialized @param {boolean} force
 * @returns {Promise<void>}
 */
async function writeNew(path, serialized, force) {
  try {
    writeDocument(path, serialized, force);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "EEXIST") {
      fail(
        `${path} already exists and was NOT overwritten. Re-run with --force to replace it, ` +
          `or pass --out <path> to write elsewhere.`,
      );
    }
    fail(`could not write ${path}: ${messageWithCause(err)}`);
  }
}

/**
 * Write BACK to an existing document: temp file in the same directory, then rename, which is
 * atomic on the same filesystem. A crash mid-write therefore leaves the previous document
 * whole — never a truncated JSON file that turns a review session into a recovery session.
 *
 * @param {string} path @param {string} serialized
 * @returns {Promise<void>}
 */

/** @param {string} path  @param {string} serialized */
async function writeBack(path, serialized) {
  try { writeDocument(path, serialized); }
  catch (error) { fail(`could not write ${path}: ${messageWithCause(error)}`); }

}

/**
 * Load and gate a harvest document. Distinct causes stay distinct — absent, unreadable,
 * malformed JSON and invalid-per-the-parser are four different situations and each is named.
 *
 * @param {string} path
 * @returns {import("@foliage/photosynthesis").HarvestDocument}
 */
function loadHarvest(path) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") {
      fail(`no harvest document at ${path}. Run \`propose\` first, or pass --doc <path>.`);
    }
    fail(`${path} could not be read: ${messageWithCause(err)}`);
  }
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    fail(`${path} is not valid JSON: ${messageOf(err)}`);
  }
  const parsed = parseHarvestDocument(json);
  if (!parsed.ok) {
    process.stderr.write(`harvest: ${path} is not a harvest document:\n`);
    for (const issue of parsed.issues) {
      process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }
  return parsed.harvest;
}

/**
 * Read, JSON-parse and GATE a leaf document at `intoPath` — the three checks `promote` always
 * ran against `--into`, extracted so `propose`'s own optional `--into` (F-014's target binding,
 * below) does not duplicate them with room to drift. Exits the process on any failure; never
 * returns a leaf this repository would not otherwise accept.
 *
 * @param {string} intoPath
 * @returns {import("@foliage/leaf").Leaf}
 */
function readLeafOrFail(intoPath) {
  /** @type {string} */
  let leafText;
  try {
    leafText = readFileSync(intoPath, "utf8");
  } catch (err) {
    fail(`--into ${intoPath} could not be read: ${messageWithCause(err)}`);
  }
  /** @type {unknown} */
  let leafJson;
  try {
    leafJson = JSON.parse(leafText);
  } catch (err) {
    fail(`--into ${intoPath} is not valid JSON: ${messageOf(err)}`);
  }
  const parsedLeaf = parseLeafDocument(leafJson);
  if (!parsedLeaf.ok) {
    process.stderr.write(`harvest: --into ${intoPath} is not a leaf document:\n`);
    for (const issue of parsedLeaf.issues) {
      process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }
  if (parsedLeaf.declaredExample) {
    // Mixing real promoted evidence into a fabricated illustration would launder the
    // fabrication band off content that still contains invented entries.
    fail(
      `--into ${intoPath} declares "example": true — it is a fabricated illustration, and ` +
        `real promoted candidates are not mixed into one. Point --into at a real leaf ` +
        `document (intake.mjs produces them).`,
    );
  }
  return parsedLeaf.leaf;
}

/**
 * One line describing a review state, reason included — the reason is part of the record,
 * not an implementation detail.
 *
 * @param {import("@foliage/photosynthesis").ReviewState} review
 * @returns {string}
 */
function describeReview(review) {
  switch (review.state) {
    case "candidate":
      return "candidate (unreviewed)";
    case "approved":
      return `approved by ${review.by} at ${review.at}`;
    case "rejected":
      return `rejected by ${review.by} at ${review.at}: ${review.reason}`;
  }
}

/* ------------------------------------------------------------------------- propose ---- */

/**
 * Ask the local model for a one-line title for one cluster. FAILS CLOSED on every path —
 * unreachable, non-200, timeout, unparseable body, empty draft — because falling back to the
 * deterministic title would emit candidates whose extractor identity is a lie.
 *
 * @param {string} prefix
 * @param {readonly { readonly subject: string }[]} cluster
 * @returns {Promise<string>}
 */
async function draftTitleWithLocalModel(prefix, cluster) {
  const subjects = cluster.map((c) => `- ${c.subject.trim()}`).join("\n");
  const prompt =
    `These are the subject lines of ${cluster.length} related commits from one repository, ` +
    `sharing the prefix "${prefix}":\n${subjects}\n\n` +
    `Write exactly one line: a short, factual title describing this body of work. ` +
    `State only what the commits show. No ratings, no praise, no numbers that read like a ` +
    `score. Output only the title, nothing else.`;

  // THE HOST CHECK AND THE SOCKET ARE THE SAME DECISION, made once, in `loopbackFetch`.
  //
  // This function used to parse `OLLAMA_URL`, confirm the hostname, and then call `fetch` — which
  // follows redirects. A 307 PRESERVES METHOD AND BODY, so an endpoint answering on the trusted
  // port could name any host and undici would carry these commit subjects there while the usage
  // text above promised no network call beyond 127.0.0.1. Reproduced with two live servers. The
  // claim and the effect were derived from DIFFERENT VALUES: the claim from the CONFIGURED url,
  // the effect from the SOCKET actually opened. And `OLLAMA_URL` comes from the environment, so
  // the hop never needed ollama's cooperation.
  //
  // The check is no longer written out here, deliberately: it was one of three copies, and a
  // sibling lane found the same guard fixed on one arm only. One definition, or the fix is
  // temporary.
  const sent = await loopbackFetch(OLLAMA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!sent.ok) {
    const failure = sent.failure;
    if (failure.cause === "redirected") {
      // ITS OWN FAILURE, never folded into "could not be reached". A 3xx from this port is not a
      // model that is down — it is something answering where the operator's model should be and
      // asking for the request to be repeated elsewhere. Told "unreachable", they would restart
      // ollama, which is the one action that does not address it.
      fail(
        `--draft-with-local-model: refusing to draft: ${failure.detail} These commit subjects ` +
          `were NOT sent to that location and nothing was written. Restarting the model changes ` +
          `nothing; find out what is answering on ${OLLAMA_URL}.`,
      );
    }
    if (failure.cause === "not-loopback" || failure.cause === "malformed-endpoint") {
      fail(
        `--draft-with-local-model: refusing to draft: ${failure.detail} Nothing was written — ` +
          `deterministic titles were NOT silently substituted; re-run without the flag to use ` +
          `them.`,
      );
    }
    // KNOWN GAP, recorded rather than quietly widened: `brainSource.ts` and `photoSource.ts`
    // split a ceiling reached (`timed-out`) out of `unreachable` here, because the remedies are
    // opposite — give a busy machine more time, versus start a server that is already running —
    // and this path does not. `sent.failure.error` carries the thrown value, so the split is one
    // `err.name === "TimeoutError"` test away; it is not made in this lane because changing what
    // this command prints for a timeout is not closing a redirect hole.
    fail(
      `--draft-with-local-model was requested and ${OLLAMA_MODEL} at ${failure.detail}. Nothing ` +
        `was written — deterministic titles were NOT silently substituted; re-run without the ` +
        `flag to use them.`,
    );
  }
  const response = sent.response;
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    fail(
      `--draft-with-local-model: ollama answered HTTP ${response.status} for cluster ` +
        `"${prefix}": ${body || "(no body)"}. Nothing was written.`,
    );
  }
  /** @type {unknown} */
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    fail(
      `--draft-with-local-model: ollama's response for cluster "${prefix}" was not JSON: ` +
        `${messageWithCause(err)}. Nothing was written.`,
    );
  }
  const draft =
    payload !== null && typeof payload === "object" && "response" in payload
      ? String(/** @type {{response: unknown}} */ (payload).response)
      : "";
  // One line, and a non-empty one: a model is free to ramble or to return nothing, and
  // either becomes a failure here rather than a malformed candidate downstream.
  const title = (draft.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
  if (title.length === 0) {
    fail(
      `--draft-with-local-model: ${OLLAMA_MODEL} returned no usable title for cluster ` +
        `"${prefix}". Nothing was written.`,
    );
  }
  // A RATING-SHAPED DRAFT IS A REFUSAL, not a suggestion to be tidied up. The prompt above asks
  // for "no numbers that read like a score"; a prompt is a request and the model is free to
  // ignore it, so the answer is checked. `photoIntake.ts` and `brainIntake.ts` already refuse
  // exactly this on their own drafted titles — the git path was the one that only asked.
  //
  // IT FAILS THE WHOLE RUN rather than skipping the cluster, for the same reason every other
  // branch of this function does: the extractor recorded on a candidate is `local-model:<model>`
  // for the entire run, so quietly substituting `${prefix}: N commits` here would ship a
  // candidate whose stated drafter did not write its title. Dropping the cluster instead would
  // make "this body of work produced no candidate" and "the model said something we would not
  // print" the same observation. Neither is honest, so nothing is written and the operator is
  // told what happened.
  //
  // THE REFUSED TEXT IS PRINTED VERBATIM. It is the operator's own model's output about their own
  // repository, on their own machine, and a refusal that hides what it refused cannot be judged.
  if (RATING_SHAPED.test(title)) {
    fail(
      `--draft-with-local-model: ${OLLAMA_MODEL} drafted a rating-shaped title for cluster ` +
        `"${prefix}" and it was REFUSED: "${title}". Nothing in this product emits a number ` +
        `that reads like a rating, so the draft is not written, not trimmed, and not quietly ` +
        `replaced by the deterministic title — a candidate labelled ` +
        `"local-model:${OLLAMA_MODEL}" must actually carry that model's words. Nothing was ` +
        `written. Re-run without --draft-with-local-model to use deterministic titles.`,
    );
  }
  return title;
}

/** @param {string[]} args @returns {Promise<void>} */
async function propose(args) {
  const { values } = parseOrUsage(
    args,
    {
      repo: { type: "string" },
      identity: { type: "string", multiple: true },
      out: { type: "string" },
      into: { type: "string" },
      force: { type: "boolean", default: false },
      "draft-with-local-model": { type: "boolean", default: false },
      workflow: { type: "string" },
    },
    false,
  );
  const repo = typeof values["repo"] === "string" ? values["repo"].trim() : "";
  if (repo === "") {
    process.stderr.write(`missing required argument: --repo\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  const identities = (Array.isArray(values["identity"]) ? values["identity"] : [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value !== "");
  if (identities.length === 0) {
    // A USAGE MISTAKE, refused loudly, and NOT "0 candidates". With no identity declared the
    // domain attributes nothing, so this command would write an empty harvest over a repository
    // full of the subject's own work — a true-looking file that is an artifact of a missing flag.
    // The opposite default is worse and is what this replaced: clustering everything, which
    // silently hands one person credit for a whole team's commits.
    process.stderr.write(
      `missing required argument: --identity <email>. A candidate is a claim about ONE ` +
        `person's work, so this command has to be told whose before it clusters anything. ` +
        `Repeat the flag for every address that person commits under — a work address, a ` +
        `personal one, a GitHub noreply — exactly as intake.mjs takes them. Run ` +
        `\`git -C ${repo} log --no-merges --format=%ae | sort -u\` to see which addresses this ` +
        `history actually carries.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const out =
    typeof values["out"] === "string" && values["out"].trim() !== ""
      ? resolve(values["out"].trim())
      : DEFAULT_HARVEST_PATH;
  const useModel = values["draft-with-local-model"] === true;
  // THE TARGET BINDING, ledger F-014 — OPTIONAL, and read (never guessed) exactly like
  // `promote`'s own `--into`: a real, parseable leaf, gated the same way. Absent means this
  // document is written unbound, and `promoteApproved` reports that honestly rather than
  // assuming a match; present means the subject and leaf id this harvest was proposed FOR are
  // recorded on the document, so a later `promote --into` pointed at the wrong leaf refuses by
  // name instead of splicing this subject's approvals into somebody else's.
  const intoRaw = typeof values["into"] === "string" ? values["into"].trim() : "";

  // THE BINDING CHECK ITSELF now happens ONLY at the very end, inside `prepareProposedDocument`
  // — see PR #17 review, blocker 2. An earlier draft of this fix read whatever was already on
  // disk at `out` HERE, before the (potentially slow) git read and model call below, and used
  // that stale snapshot both to refuse a disagreeing --into AND to decide what to carry forward.
  // A decision recorded elsewhere during that window — the web review panel, a concurrent CLI
  // invocation — would then be silently reverted by this run's own write. Reading fresh, once,
  // immediately before the write, closes that window; see `src/proposeDocument.ts`'s header for
  // the full argument and `proposeDocument.test.ts` for the seam test that proves it.

  // 1. READ, ATTRIBUTE, DATE. Real git over every local branch; the domain's attribution rule
  //    (`commitsToLeaflets`, the same call intake.mjs makes), so a commit that is not this
  //    subject's never reaches the queue; git's own author dates. A failed read or a refused
  //    attribution writes nothing.
  const read = await readQueueCommits(resolve(repo), identities);
  if (!read.ok) {
    switch (read.cause) {
      case "read-failed": {
        fail(`${read.failure.cause} — ${read.failure.detail}`);
        break; // unreachable — fail() calls process.exit
      }
      case "attribution-refused": {
        process.stderr.write(
          `harvest: the declared identities could not be applied to this history, so NOTHING was ` +
            `clustered and nothing was written. Every reason follows:\n`,
        );
        for (const issue of read.issues) process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
        process.exit(EXIT_FAILED);
        break;
      }
      default: {
        const impossible = /** @type {never} */ (read);
        throw new Error(`unhandled queue read outcome: ${JSON.stringify(impossible)}`);
      }
    }
  }
  // A narrowed walk did not establish that anything is absent. The merge would keep what it did
  // not see, but a --force refresh over a damaged ref is still refused, so the operator repairs
  // the ref before the queue is touched.
  if (values["force"] === true && !read.complete) {
    fail(`incomplete history — refusing to replace ${out}; the harvest was NOT changed. ` +
      `Repair the local branch ref and retry. Git said: ${read.narrowedBecause}`);
  }
  // ONE QUEUE, ONE PRESENCE RULE. The workflow collector writes this harvest too, from every
  // checkout it reads and for its own identities. A draft it made is gone only when no checkout of
  // this repository holds its commits any more: this walk's commits whoever made them, and what
  // the collector's other checkouts hold. A paused or unreadable one proves nothing gone, and the
  // commits a legacy packet decision holds are never drafted again.
  const workflowPath =
    typeof values["workflow"] === "string" && values["workflow"].trim() !== "" ? resolve(values["workflow"].trim()) : undefined;
  let others = { present: /** @type {readonly string[]} */ ([]), complete: true };
  /** @type {ReadonlySet<string>} */
  let heldExtra = new Set();
  if (workflowPath !== undefined) {
    const { workflowQueueInputs } = await import("./src/workflow.ts").catch(explainFailedWorkspaceImport);
    let inputs;
    try {
      inputs = await workflowQueueInputs(workflowPath);
    } catch (err) {
      fail(`cannot read ${workflowPath}: ${messageOf(err)}. Nothing was written.`);
    }
    others = await checkoutPresence(resolve(repo), inputs.checkouts);
    heldExtra = inputs.held;
  }
  const present = new Set([...[...read.commits, ...read.theirs].map((c) => c.sha), ...others.present]);
  const complete = read.complete && others.complete;
  const observedAt = new Date().toISOString();
  const extractor = useModel ? `local-model:${OLLAMA_MODEL}` : DETERMINISTIC_EXTRACTOR;

  // 2. TITLE, only if asked, and BEFORE the locks: a model call takes minutes and the review page
  //    must stay writable meanwhile. The drafts are previewed from the document as it is now; each
  //    title is bound to its draft's exact id and refs, so a queue that moves in the meantime
  //    leaves a draft untitled and the run fails closed below instead of mislabelling it.
  /** @type {Map<string, import("@foliage/photosynthesis").DraftTitle>} */
  const titles = new Map();
  if (useModel) {
    const preview = prepareProposedDocument({
      mode: "git", out, commits: read.commits, complete, present, heldExtra, observedAt, extractor, target: undefined,
    });
    for (const id of preview.ok ? preview.drafted : []) {
      const draft = /** @type {import("@foliage/photosynthesis").HarvestCandidate | undefined} */ (
        preview.ok ? preview.document.candidates.find((c) => c.id === id) : undefined
      );
      if (draft === undefined) continue;
      const title = await draftTitleWithLocalModel(
        gitLineage(id)?.prefix ?? id,
        draft.evidence.map((e) => ({ subject: e.excerpt ?? "" })),
      );
      titles.set(draftKey(id, draft.evidence.map((e) => e.ref)), { title, extractor });
    }
  }

  // 3. MERGE, under the locks (PR #17 review, blockers 1 and 2): read `out` FRESH, decide the
  //    binding (refusing a --into that disagrees with what is already there), keep every decided
  //    candidate exactly as it is, draft what no decision holds, and validate with the real gate.
  //    An approval is never reopened: new commits on approved work come back as their own draft.
  return withDocumentLocks([out, ...(intoRaw === "" ? [] : [resolve(intoRaw)])], async () => {
  // One queue, one repository: decided work, and drafts waiting for a decision, from another
  // repository are never mixed with this one or replaced by it. A recorded repository that cannot
  // be read (moved, renamed, re-cloned) is judged by the waiting drafts' commits instead, while the
  // queue holds no decision.
  const guarded = queuedRepository(out);
  if (guarded !== null) {
    const match = await queueRepositoryMatch(guarded.repo, resolve(repo), { decided: guarded.decided.length, refs: guarded.refs });
    switch (match.kind) {
      case "same":
        if (match.by === "queue-commits") {
          process.stdout.write(
            `harvest: ${guarded.repo} cannot be read; ${resolve(repo)} holds every commit in this queue, ` +
              `so it is read as the same repository.\n`,
          );
        }
        break;
      case "different":
      case "unreadable":
        // Deciding the queue does not free it for another repository, so the way on is named.
        fail(
          `refused — ${out} holds ${[
            ...(guarded.decided.length > 0 ? [`${guarded.decided.length} decision(s)`] : []),
            ...(guarded.waiting.length > 0 ? [`${guarded.waiting.length} draft(s) waiting for a decision`] : []),
          ].join(" and ")} about ${guarded.repo}, ` +
            `not ${resolve(repo)}${match.kind === "unreadable" ? ` (${match.detail})` : ""}. Nothing was written.` +
            (match.kind === "unreadable" && !existsSync(guarded.repo)
              ? ` If that repository moved, move it back to ${guarded.repo}.`
              : "") +
            ` To draft ${resolve(repo)}, give it its own document with --out <another file>.`,
        );
        break; // unreachable — fail() calls process.exit
      default: {
        const impossible = /** @type {never} */ (match);
        throw new Error(`unhandled repository match: ${JSON.stringify(impossible)}`);
      }
    }
  }
  const target = intoRaw === "" ? undefined : readLeafOrFail(resolve(intoRaw));
  const prepared = prepareProposedDocument({
    mode: "git",
    out,
    commits: read.commits,
    complete,
    present,
    heldExtra,
    observedAt,
    ...(useModel ? { titles, extractor } : {}),
    target:
      target === undefined ? undefined : { subject: target.subject, id: /** @type {string} */ (target.id) },
    // The resolved path, so the recorded value means the same thing to a later run with a different
    // working directory — the same reason `sources.mjs` normalizes before it stores.
    repo: resolve(repo),
  });
  // jscpd:ignore-start — triplicated outcome-handling around prepareProposedDocument (propose /
  // propose-photos / propose-brain) — extraction owed, tracked as F-026; the comments at each
  // site already call it THE SHARED STEP.
  if (!prepared.ok) {
    // EXHAUSTIVE BY NAME, not sequential if/else — the F-012 failure class, same idiom as
    // `PromoteOutcome` in this same file's `promote()`.
    switch (prepared.cause) {
      case "rebind-disagreement": {
        fail(
          `--into ${intoRaw} would REBIND ${out}: it is already bound to subject ` +
            `"${prepared.existing.subject ?? "(unrecorded)"}"` +
            `${prepared.existing.leafId === undefined ? "" : ` (leaf id "${prepared.existing.leafId}")`}, ` +
            `and this --into names subject "${prepared.attempted.subject}" (leaf id ` +
            `"${prepared.attempted.id}"). A binding change is a deliberate act, not a drift: ` +
            `point --into at the leaf ${out} was already bound to if this was a mistake, or ` +
            `--out at a fresh path if this document really is meant for a different leaf now. ` +
            `Nothing was written.`,
        );
        break; // unreachable — fail() calls process.exit
      }
      case "invalid-document": {
        process.stderr.write(
          `harvest: BUG — the document just produced is not one this product can load. ` +
            `Nothing was written.\n`,
        );
        for (const issue of prepared.issues) {
          process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
        }
        process.exit(EXIT_FAILED);
        break;
      }
      default: {
        const impossible = /** @type {never} */ (prepared);
        throw new Error(`unhandled prepare-proposed-document outcome: ${JSON.stringify(impossible)}`);
      }
    }
  }
  // A model run puts the model's words on every draft it (re)built. A draft without them means
  // the queue moved while the model was drafting; its stated drafter would be a lie, so nothing
  // is written.
  const untitled = useModel
    ? prepared.drafted.filter((id) => prepared.document.candidates.find((c) => c.id === id)?.extractor !== extractor)
    : [];
  if (untitled.length > 0) {
    fail(
      `--draft-with-local-model: the queue changed while ${OLLAMA_MODEL} was drafting ` +
        `(${untitled.join(", ")}). Nothing was written; re-run.`,
    );
  }

  // 4. WRITE, exclusive-create unless --force. NOTHING ASYNC STANDS BETWEEN `prepared`'S OWN
  //    FRESH READ (inside `prepareProposedDocument`, just above) AND THIS WRITE — that is the
  //    whole point of blocker 2's fix.
  await writeNew(out, `${JSON.stringify(prepared.document, null, 2)}\n`, values["force"] === true);
  if (prepared.bindingPreservedWithoutTarget !== null) {
    // SAID, NOT JUST DONE: the whole finding this closes is a binding that disappeared with no
    // operator ever choosing that. Silently preserving it would still leave a re-propose that
    // LOOKS identical to one that drops it, so this run says which one just happened.
    const b = prepared.bindingPreservedWithoutTarget;
    process.stdout.write(
      `harvest: binding preserved from the existing document — subject ` +
        `"${b.subject ?? "(unrecorded)"}"` +
        `${b.leafId === undefined ? "" : ` (leaf id "${b.leafId}")`}` +
        ` (no --into given this run; pass one naming a DIFFERENT leaf to change it, which refuses ` +
        `by name rather than silently rebinding)\n`,
    );
  }
  // jscpd:ignore-end

  // 5. REPORT honest counts, the empty case plainly included.
  process.stdout.write(`harvest: read ${read.read} non-merge commit(s) from ${read.repoRoot}\n`);
  // A PARTIAL READ SAYS SO — the same line intake.mjs prints, guarded the same spawned way.
  if (read.narrowedBecause !== null) process.stdout.write(narrowingNotice("harvest", read.narrowedBecause));
  process.stdout.write(
    `harvest: ${read.commits.length} attributed to the ${identities.length} declared ` +
      `identit${identities.length === 1 ? "y" : "ies"}; ${read.theirs.length} authored by somebody ` +
      `else and NOT clustered\n`,
  );
  // WHICH commits, by prefix — because a bare number is not checkable. The subject line of a
  // third party's commit is deliberately NOT printed: an excluded commit is somebody else's, and
  // its message can carry their name or address (this is the same egress `exclusionReason` in
  // @foliage/leaf withholds by construction). The prefix and the count are enough to see the
  // shape of what was withheld, and `git log` in the repository shows the rest to whoever may
  // read it.
  for (const [prefix, cluster] of clusterBySubjectPrefix(read.theirs)) {
    process.stdout.write(
      `harvest:   not attributed  ${prefix}: ${cluster.length} commit(s)\n`,
    );
  }
  if (read.theirs.length > 0) {
    process.stdout.write(
      `harvest: those ${read.theirs.length} commit(s) are NOT an error and NOT a failure to read — ` +
        `they are other people's work, counted here rather than dropped, and never drafted ` +
        `from. \`intake.mjs\` over this same repository records each of them as an "excluded" ` +
        `leaflet carrying its own reason, which is where they belong; a candidate is a claim ` +
        `about the subject, so nothing here may rest on one.\n`,
    );
  }
  if (read.datesUnreadBecause !== null) {
    process.stdout.write(`harvest: author dates unread — ${read.datesUnreadBecause}\n`);
  }
  process.stdout.write(
    `harvest: drafted ${prepared.drafted.length} · carried ${prepared.carried} · held ${prepared.held} · withdrawn ${prepared.withdrawn.length}\n`,
  );
  for (const id of prepared.drafted) process.stdout.write(`harvest:   drafted  ${id}\n`);
  for (const id of prepared.withdrawn) process.stdout.write(`harvest:   withdrawn  ${id}\n`);
  if (read.read > 0 && read.commits.length === 0) {
    // Every commit in this history was authored by somebody else — most often because the
    // declared identity is not the address this repository's commits actually carry, which is a
    // typo with a remedy, not an empty result.
    process.stdout.write(
      `harvest: 0 candidates, and NOT because the history is thin — not one of the ` +
        `${read.read} commit(s) in ${read.repoRoot} is authored by ` +
        `${identities.join(", ")}. Nothing was invented and nobody else's work was borrowed to ` +
        `fill the queue. Check the address with ` +
        `\`git -C ${repo} log --no-merges --format=%ae | sort -u\`, then re-run with the ` +
        `--identity that history carries.\n`,
    );
  }
  if (prepared.drafted.length > 0) {
    process.stdout.write(
      `harvest: titles drafted by ${
        useModel ? `local-model:${OLLAMA_MODEL} (127.0.0.1 only)` : DETERMINISTIC_EXTRACTOR
      }\n`,
    );
  }
  process.stdout.write(`harvest: wrote ${out}\n`);
  process.stdout.write(`harvest: next  ${reviewStep(out)}\n`);
  });

}

/* ------------------------------------------------------------------ propose-photos ---- */

/** How much of a model's transcription is echoed to the operator before it is cut off. */
const TRANSCRIPT_ECHO = 160;

/**
 * Draft candidates from a directory of real images.
 *
 * SIX OUTCOMES, SIX MESSAGES, and the distinction is the whole point — on the machine this
 * was built on the honest answer is very often "no images", and "no images" must never be
 * printed by the same code path that would print "the model is down":
 *
 *   1. no --dir            you did not name a directory. Usage, exit 2. Nothing is scanned by
 *                          default: the macOS Photos library is TCC-gated and pointing there
 *                          uninvited would fail for reasons unrelated to what you asked for.
 *   2. --dir does not exist / is a file      named cause from readImages, nothing written.
 *   3. a file in it COULD NOT BE READ        the walk was locked out, so the scan is an
 *                          undercount of the directory. FAILS with every cause named; nothing
 *                          is written. This is outcome 4's opposite and it used to print
 *                          outcome 4's sentence — see the fail-closed step below.
 *   4. every file was read and none is an image      an honest EMPTY harvest, written, and said
 *                          plainly along with how many files were looked at and what they were.
 *   5. images, no model    candidates titled from what was measured. This is the default and it
 *                          invents nothing.
 *   6. images, model asked for and unreachable      FAILS with the cause; nothing is written and
 *                          no deterministic title is silently substituted.
 *   (and 7 — images described by the model, which is 5 with better titles and a louder report.)
 *
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function proposePhotos(args) {
  const { values } = parseOrUsage(
    args,
    {
      dir: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      "describe-with-local-model": { type: "boolean", default: false },
    },
    false,
  );
  const dir = typeof values["dir"] === "string" ? values["dir"].trim() : "";
  if (dir === "") {
    process.stderr.write(
      `missing required argument: --dir <path>. This command reads only the directory you ` +
        `name; it has no default and it does not go looking through your machine for ` +
        `something to draft.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const out =
    typeof values["out"] === "string" && values["out"].trim() !== ""
      ? resolve(values["out"].trim())
      : DEFAULT_HARVEST_PATH;
  const useModel = values["describe-with-local-model"] === true;

  // 1. SCAN. Real files, real bytes — or a named cause and no file written. The bytes go to the
  //    store of the garden `out` belongs to, not the checkout's (QA #24; see mediaRootFromEnv).
  const scan = await readImages(resolve(dir), { store: mediaRootFromEnv(process.env, out) });
  if (!scan.ok) {
    fail(`${scan.cause} — ${scan.detail}`);
  }
  const observedAt = new Date().toISOString();

  process.stdout.write(
    `harvest: scanned ${scan.dir}: ${scan.filesSeen} file(s), ${scan.images.length} image(s) ` +
      `by content, ${scan.nonImageFiles} non-image file(s), ` +
      `${scan.emptyFiles.length} empty file(s)\n`,
  );
  for (const path of scan.emptyFiles) {
    process.stdout.write(
      `harvest:   empty ${path} — 0 bytes. Counted apart from the non-image files because ` +
        `"not an image by its bytes" is a claim about bytes, and this file has none.\n`,
    );
  }

  // TWO KINDS OF NOT-READ, and they are not the same event. The walk DECLINING by a rule it
  // states (a symbolic link, the depth cap) leaves a complete answer about what it agreed to
  // look at. The machine REFUSING leaves an undercount. Sorted on the entry's own cause, never
  // by matching its prose.
  const declined = scan.notRead.filter((entry) => !isReadFailure(entry));
  const failedReads = scan.notRead.filter((entry) => isReadFailure(entry));
  for (const entry of declined) {
    process.stdout.write(`harvest:   not read ${entry.path} — ${entry.cause}: ${entry.detail}\n`);
  }
  if (!scan.toolchain.sipsRuns) {
    process.stdout.write(`harvest: ${scan.toolchain.sipsUnavailable}\n`);
  }

  // 1b. FAIL CLOSED ON A FAILED READ — before the model is asked anything, and long before
  //     anything is written.
  //
  //     THE BUG THIS EXISTS TO KILL: a directory holding one 0600 file owned by somebody else
  //     scanned to 0 images, exited 0, wrote {"candidates": []}, and printed "0 images is the
  //     honest result here — it holds 1 file(s) and none of them is an image by its bytes."
  //     Not one byte of that file had been read. "There is nothing here to draft" and "the walk
  //     was locked out" are different situations, and printing one sentence for both is the
  //     `commitCount: 0` collapse this repository was built to refuse.
  //
  //     Nothing is written, and the sibling rule is intake.mjs's: a failed git read produces no
  //     leaf, because a zero-leaflet file written after a failure is indistinguishable from an
  //     honestly empty portfolio. The same argument holds here with more force, since a
  //     harvest costs one command to regenerate once the read is fixed. A declined symlink is
  //     NOT this — it is reported above and the scan continues, because a rule this file states
  //     and applies is not a failure.
  if (failedReads.length > 0) {
    for (const entry of failedReads) {
      process.stderr.write(
        `harvest:   could not read ${entry.path} — ${entry.cause}: ${entry.detail}\n`,
      );
    }
    fail(
      `${failedReads.length} of the ${scan.filesSeen} file(s) under ${scan.dir} could not be ` +
        `read (named above), so this scan is an UNDERCOUNT of what that directory holds and ` +
        `NOTHING was written. A zero-candidate document written after a failed read is ` +
        `indistinguishable from a directory that honestly holds no images. Make them readable, ` +
        `move them aside, or point --dir at a subdirectory that excludes them, then re-run.`,
    );
  }

  // 2. DESCRIBE, only if asked, and FAIL CLOSED if the model was asked for and did not answer.
  //    A byte-identical copy is not shown to the model twice. That is an I/O decision, not a
  //    judgement — the domain still decides what happens to the duplicate, and still reports it
  //    below — but describing it would spend a real model call on an artifact that is about to
  //    be dropped, and would make WHICH description survives depend on directory order.
  const images = [];
  /** digest -> the path it was first described at. */
  const describedDigests = new Map();
  /** Distinct ARTIFACTS, which is what the model will actually be asked about. */
  const distinctImages = new Set(scan.images.map((i) => i.digest)).size;
  let described = 0;
  for (const image of scan.images) {
    if (!useModel) {
      images.push({ ...image, description: null });
      continue;
    }
    const alreadyAt = describedDigests.get(image.digest);
    if (alreadyAt !== undefined) {
      process.stdout.write(
        `harvest:   not shown to the model ${image.path} — byte-identical to ${alreadyAt}, ` +
          `which was already described\n`,
      );
      images.push({ ...image, description: null });
      continue;
    }
    // THE SAME CONFIGURED ADDRESS AS `propose`, passed rather than defaulted. See OLLAMA_URL:
    // omitting it let this path quietly use a literal while the usage text named an override.
    const outcome = await describeImage(image, { endpoint: OLLAMA_URL, toolchain: scan.toolchain });
    if (!outcome.ok) {
      fail(
        `--describe-with-local-model: ${outcome.cause} — ${outcome.detail} Nothing was ` +
          `written, and no file-derived titles were silently substituted; re-run without the ` +
          `flag to draft from what was measured instead.`,
      );
    }
    described++;
    describedDigests.set(image.digest, image.path);
    process.stdout.write(
      `harvest:   described ${described}/${distinctImages} ${image.path} ` +
        `(${outcome.prepared}, ${outcome.sentBytes} bytes sent)\n`,
    );
    images.push({ ...image, description: outcome.description });
  }

  // 3. JUDGE, in the domain. What a photograph can establish is not this file's decision.
  const drafted = photosToCandidates({ images, observedAt });
  if (!drafted.ok) {
    process.stderr.write(
      drafted.cause === "round-trip-rejected"
        ? `harvest: BUG — the candidates just drafted are not ones this product can load. ` +
            `Nothing was written.\n`
        : `harvest: the images could not be turned into candidates. Nothing was written.\n`,
    );
    for (const issue of drafted.issues) {
      process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  // 4. THE SHARED STEP (PR #17 review, blocker 1): read `out` fresh, carry any EXISTING binding
  //    and review decisions forward, assemble the document, and validate it with the real gate.
  //    `propose-photos` has no --into flag of its own, so `target` is always undefined here —
  //    it can never SET a binding, only carry one forward that `propose --into` already wrote.
  //    Before this shared step existed, this command built `{ candidates }` with no binding
  //    fields at all, so `propose --into leaf.json` (bound) followed by
  //    `propose-photos --out <same path> --force` silently dropped the binding — live
  //    reproduced by the review. See `src/proposeDocument.ts`'s header for the full argument.
  return withDocumentLocks([out], async () => {
  const prepared = prepareProposedDocument({ mode: "carry", out, candidates: drafted.candidates, target: undefined });
  // jscpd:ignore-start — triplicated outcome-handling around prepareProposedDocument (propose /
  // propose-photos / propose-brain) — extraction owed, tracked as F-026; the comments at each
  // site already call it THE SHARED STEP.
  if (!prepared.ok) {
    switch (prepared.cause) {
      case "rebind-disagreement": {
        // UNREACHABLE: no --into flag exists on this command, so `target` is always undefined
        // and this cause can never be produced. Handled by name anyway, the same exhaustiveness
        // every outcome switch in this file applies.
        process.stderr.write(
          `harvest: BUG — prepareProposedDocument reported a binding disagreement with no ` +
            `--into given. This should be unreachable; nothing was written.\n`,
        );
        process.exit(EXIT_FAILED);
        break;
      }
      case "invalid-document": {
        process.stderr.write(
          `harvest: BUG — the document just produced is not one this product can load. ` +
            `Nothing was written.\n`,
        );
        for (const issue of prepared.issues) {
          process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
        }
        process.exit(EXIT_FAILED);
        break;
      }
      default: {
        const impossible = /** @type {never} */ (prepared);
        throw new Error(`unhandled prepare-proposed-document outcome: ${JSON.stringify(impossible)}`);
      }
    }
  }

  // 5. WRITE, exclusive-create unless --force. Nothing async stands between `prepared`'s own
  //    fresh read and this write — see blocker 2 in `src/proposeDocument.ts`.
  await writeNew(out, `${JSON.stringify(prepared.document, null, 2)}\n`, values["force"] === true);
  if (prepared.carried > 0 || prepared.reopened.length > 0) {
    process.stdout.write(`harvest: carried ${prepared.carried} review decision(s) forward\n`);
    for (const line of prepared.reopened) process.stdout.write(`harvest:   ${line}\n`);
  }
  if (prepared.bindingPreservedWithoutTarget !== null) {
    const b = prepared.bindingPreservedWithoutTarget;
    process.stdout.write(
      `harvest: binding preserved from the existing document — subject ` +
        `"${b.subject ?? "(unrecorded)"}"` +
        `${b.leafId === undefined ? "" : ` (leaf id "${b.leafId}")`}` +
        ` (propose-photos has no --into of its own; it never sets a binding, only carries one ` +
        `forward)\n`,
    );
  }
  // jscpd:ignore-end


  // 6. REPORT. Every image is accounted for: drafted, or skipped with a cause.
  for (const skip of drafted.skipped) {
    process.stdout.write(`harvest:   skipped ${skip.path} — ${skip.cause}: ${skip.reason}\n`);
  }
  for (const refusal of drafted.refusedRatingShapedDrafts) {
    process.stdout.write(`harvest:   refused draft ${refusal.path} — ${refusal.reason}\n`);
  }
  for (const refusal of drafted.refusedRatingShapedNames) {
    process.stdout.write(`harvest:   refused file name ${refusal.path} — ${refusal.reason}\n`);
  }

  // WHY A TITLE CARRIES NO PIXEL SIZE. The app builds an exact cause per file — a missing
  // decoder, or what sips printed instead of a size — and until this loop existed nothing
  // printed one: a candidate simply appeared without a size, which reads identically whether
  // the file is truncated or nobody looked. Grouped by the reason itself, because the
  // toolchain-absent cause is the same paragraph for every file on the machine and printing it
  // forty times would bury the one file that is genuinely unreadable by sips.
  if (drafted.unmeasuredDimensions.length > 0) {
    /** @type {Map<string, string[]>} */
    const byReason = new Map();
    for (const note of drafted.unmeasuredDimensions) {
      const paths = byReason.get(note.why);
      if (paths === undefined) byReason.set(note.why, [note.path]);
      else paths.push(note.path);
    }
    process.stdout.write(
      `harvest: ${drafted.unmeasuredDimensions.length} candidate(s) state no pixel size. An ` +
        `unmeasured size is a named cause, never a 0×0:\n`,
    );
    for (const [why, paths] of byReason) {
      process.stdout.write(`harvest:   ${why}\n`);
      for (const path of paths) process.stdout.write(`harvest:     ${path}\n`);
    }
  }
  if (drafted.transcriptions.length > 0) {
    process.stdout.write(
      `harvest: text read off ${drafted.transcriptions.length} image(s) is NOT recorded in the ` +
        `document — this model invents text it cannot fully see. For your eyes only:\n`,
    );
    for (const t of drafted.transcriptions) {
      const text = t.text.replace(/\s+/g, " ").slice(0, TRANSCRIPT_ECHO);
      process.stdout.write(
        `harvest:   ${t.path}: "${text}${t.text.length > TRANSCRIPT_ECHO ? "…" : ""}"\n`,
      );
    }
  }
  process.stdout.write(
    `harvest: ${drafted.candidates.length} candidate(s) drafted, ` +
      `${drafted.undescribed.length} titled from measured file facts alone\n`,
  );

  // WHAT HAPPENED TO THE BYTES, and this loop is here because its absence was a real defect
  // found by exercising the command rather than by reading it. The scan captures each image into
  // the media store on the way past — that is the only moment the digest and the file are both
  // in hand — and until now NOTHING printed the outcome. A store that could not be written (a
  // FOLIAGE_MEDIA pointing at a file, a full disk, a container needing a decoder this machine
  // does not have) produced the identical "1 candidate(s) drafted" as a successful capture, and
  // the operator learned their photograph was missing when they opened the page, with no cause
  // anywhere. A capture that failed is a NAMED CAUSE, printed, per file.
  //
  // THE CANDIDATE IS STILL DRAFTED, and that is deliberate rather than a consolation: the FILE
  // was measured and its digest is real evidence, so the leaflet is honest without the picture.
  // What is refused is a media element for bytes nothing holds.
  const captures = scan.images.map((i) => i.stored).filter((s) => s !== null);
  const failed = captures.filter((s) => !s.ok);
  if (scan.storeRoot === null) {
    process.stdout.write(
      `harvest: nothing was captured — this scan was told not to use a media store, so these ` +
        `candidates carry digests and no images.\n`,
    );
  } else if (failed.length > 0) {
    process.stdout.write(
      `harvest: ${failed.length} of ${captures.length} image(s) could NOT be captured into ` +
        `${scan.storeRoot}. Those candidates carry their evidence ref and no picture — a media ` +
        `element pointing at bytes nothing holds would publish a broken image under a real ref:\n`,
    );
    for (const [i, image] of scan.images.entries()) {
      const stored = image.stored;
      if (stored === null || stored.ok) continue;
      process.stdout.write(`harvest:   ${image.path} — ${stored.cause}: ${stored.detail}\n`);
      void i;
    }
  } else if (captures.length > 0) {
    const removed = captures.reduce((n, s) => n + (s.ok ? s.manifest.strip.removed.length : 0), 0);
    process.stdout.write(
      `harvest: ${captures.length} image(s) captured into ${scan.storeRoot}, with ${removed} ` +
        `metadata block(s) removed on the way in (EXIF/GPS included). The originals are ` +
        `untouched.\n`,
    );
  }

  if (scan.images.length === 0) {
    // Reachable ONLY when every file was read — a failed read exited above — and that is what
    // makes this sentence sayable at all: it asserts what the bytes are, so the bytes have to
    // have been read. The three numbers account for every file the walk collected.
    process.stdout.write(
      `harvest: 0 images is the honest result here — all ${scan.filesSeen} file(s) in ` +
        `${scan.dir} were read and none is an image: ${scan.nonImageFiles} non-image file(s), ` +
        `${scan.emptyFiles.length} empty file(s), and nothing failed to open. An empty harvest ` +
        `was written; nothing was invented, and nothing was searched for outside that ` +
        `directory.\n`,
    );
    if (declined.length > 0) {
      process.stdout.write(
        `harvest: ${declined.length} further entr${declined.length === 1 ? "y" : "ies"} ` +
          `(named above) were declined by rule and are NOT in that count — the walk chose not ` +
          `to look, which is a different thing from looking and finding no image.\n`,
      );
    }
  } else if (!useModel) {
    process.stdout.write(
      `harvest: titles state what was measured about each file — no description was drafted, ` +
        `because no describer was asked for. Add --describe-with-local-model to have ` +
        `${LOCAL_DESCRIBER_MODEL} on 127.0.0.1 draft a line per image.\n`,
    );
  } else {
    process.stdout.write(
      `harvest: ${described} image(s) shown to local-model:${LOCAL_DESCRIBER_MODEL} ` +
        `(127.0.0.1 only)\n`,
    );
  }
  process.stdout.write(
    `harvest: a photograph shows that a file exists, never who made what it depicts — approved ` +
      `candidates promote to "pending", never "verified".\n`,
  );
  process.stdout.write(`harvest: wrote ${out}\n`);
  process.stdout.write(`harvest: next  ${reviewStep(out)}\n`);
  });

}

/* -------------------------------------------------------------------- propose-brain ---- */

/**
 * Draft candidates from the pages of a real personal knowledge base.
 *
 * THE ORDER OF THIS COMMAND IS THE POINT. Retrieval is deterministic and runs first; the
 * exposure report is printed BEFORE anything is drafted, because a person deciding whether a
 * colleague's name may be used has to be told before the machine has already used it. Then, and
 * only if asked, the local model sees the pages the operator agreed to show it.
 *
 * NINE OUTCOMES, NINE MESSAGES, and the distinctions are the whole point. Two of them were added
 * after a run produced a sentence that contradicted a line printed four lines above it, which is
 * how this list keeps earning its length:
 *
 *   1. no --about           you did not ask anything. Usage, exit 2.
 *   2. no index built       a NAMED cause with its remedy. Never an empty harvest: "the vault
 *                           has not been built" and "nothing in it answers this" are opposite
 *                           facts and printing one sentence for both is the `commitCount: 0`
 *                           collapse this repository refuses.
 *   3. nothing matched      an honest EMPTY harvest, written, and said plainly with the number
 *                           of index entries that matched, which is zero.
 *   4. matched, none affordable      also empty, and NOT "nothing matched": pages answered the
 *                           question and would not fit the token budget. Remedy: --budget.
 *   5. a selected page is GONE       the index no longer describes the disk. FAILS, names every
 *                           page that did not resolve, writes nothing. An evidence ref that
 *                           opens nothing is worse than no citation.
 *   6. everything matched was withheld     also empty, and a DIFFERENT sentence: pages were
 *                           found and deliberately not drafted from. Each is named.
 *   7. pages, no model      one candidate per page, titled with where the page is. No note
 *                           content enters the document at all.
 *   8. pages, model asked for and unreachable / cut off / unparseable      FAILS with the cause;
 *                           nothing is written and no deterministic titles are substituted.
 *   9. pages, model drafted     leaflets, each grounded in the pages it cites — with every
 *                           refused draft, every unread page, every third-party ref AND every
 *                           third-party page that was merely in the pack, named.
 *
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function proposeBrain(args) {
  const { values } = parseOrUsage(
    args,
    {
      about: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      "draft-with-local-model": { type: "boolean", default: false },
      "include-third-party": { type: "boolean", default: false },
      source: { type: "string" },
      budget: { type: "string" },
      max: { type: "string" },
      vault: { type: "string" },
    },
    false,
  );
  const question = typeof values["about"] === "string" ? values["about"].trim() : "";
  if (question === "") {
    process.stderr.write(
      `missing required argument: --about "<question>". This command retrieves the pages that ` +
        `answer a question you ask; it has no default question and it does not draft from your ` +
        `whole knowledge base.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const out =
    typeof values["out"] === "string" && values["out"].trim() !== ""
      ? resolve(values["out"].trim())
      : DEFAULT_HARVEST_PATH;
  const useModel = values["draft-with-local-model"] === true;
  const includeThirdParty = values["include-third-party"] === true;

  /**
   * A numeric flag, or undefined — a flag that is not a number is a USAGE MISTAKE and not a 0.
   * `--budget abc` silently becoming 0 would retrieve nothing and then report "nothing matched",
   * which is a true sentence about a question that was never asked.
   *
   * @param {string} name @returns {number | undefined}
   */
  const numeric = (name) => {
    const raw = values[name];
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      process.stderr.write(`--${name} must be a positive number, got "${raw}"\n\n${USAGE}`);
      process.exit(EXIT_USAGE);
    }
    return value;
  };

  const budgetTokens = numeric("budget");
  const maxNodes = numeric("max");
  const vaultDir = typeof values["vault"] === "string" ? values["vault"].trim() : "";

  // 1. RETRIEVE, deterministically. No file opened, no model called — or a named cause and no
  //    file written.
  const sourceScope =
    typeof values["source"] === "string" && values["source"].trim() !== ""
      ? values["source"].trim()
      : DEFAULT_VAULT_SOURCE;
  const retrieval = await retrieveFromVault(question, {
    sources: sourceScope,
    ...(vaultDir === "" ? {} : { vaultDir }),
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
    ...(maxNodes === undefined ? {} : { maxNodes }),
  });
  if (!retrieval.ok) {
    fail(`${retrieval.cause} — ${retrieval.detail}`);
  }

  process.stdout.write(
    `harvest: retrieved with ${retrieval.indexPath}: ${retrieval.matched} index ` +
      `entr${retrieval.matched === 1 ? "y" : "ies"} matched in ${retrieval.elapsedMs}ms — no ` +
      `page was opened and no model was called to establish that\n`,
  );
  process.stdout.write(
    `harvest: ${retrieval.nodes.length} page(s) selected, ~${retrieval.packTokensEst} tokens of ` +
      `~${retrieval.wholeVaultTokensEst} in the whole vault` +
      (retrieval.skippedForBudget > 0
        ? `, ${retrieval.skippedForBudget} reachable node(s) not affordable at this budget ` +
          `(raise --budget)\n`
        : `\n`),
  );
  // THE SCOPE THE WALK CROSSED. The retriever applies --source when it scores and its graph walk
  // then follows links out of that scope, so pages from another body of notes arrive in the pack.
  // They are removed and NAMED — a page the operator did not scope to is not evidence they asked
  // for, and the classification that protects other people is a convention of one source only.
  for (const node of retrieval.outOfScope) {
    process.stdout.write(
      `harvest:   out of scope ${node.id} — the retriever selected it, but it belongs to source ` +
        `"${node.source}" and you scoped to "${sourceScope}", so it was NOT drafted from. With ` +
        `the retriever in tools/vault the cause is its graph walk following a link out of the ` +
        `scope its scoring applied. Add "${node.source}" to --source if those notes are ones a ` +
        `portfolio claim may rest on. Its tokens ARE counted in the ~${retrieval.packTokensEst} ` +
        `above, which is the retriever's own figure for what it selected before this removal.\n`,
    );
  }

  // 2. CONFIRM EVERY SELECTED PAGE IS STILL THERE — in BOTH modes, before anything is drafted
  //    or written, by stat and never by opening one.
  //
  //    THE BUG THIS EXISTS TO KILL: the deterministic mode opened nothing at all, so every
  //    evidence ref and every `observedAt` was copied straight out of the vault index. Delete a
  //    page after the index was built and this command exited 0 and wrote a candidate whose ref
  //    named a file that was not there — which then rendered, verbatim, on the public leaf page,
  //    beside a timestamp claiming somebody had observed it. A reviewer handed a citation that
  //    looks checkable and resolves to nothing is worse off than one handed no citation, because
  //    the citation is what stops them looking further.
  //
  //    Fails as a whole, like a failed git read: a page missing from the selection means the
  //    index no longer describes the disk, and the survivors would be a quieter harvest than the
  //    retrieval just reported.
  const present = await confirmPages(retrieval.nodes);
  if (!present.ok) {
    for (const entry of present.unresolved) {
      process.stderr.write(
        `harvest:   unresolved ${entry.node.path} — ${entry.cause}: ${entry.detail}\n`,
      );
    }
    fail(
      `${present.unresolved.length} of the ${retrieval.nodes.length} page(s) the retriever ` +
        `selected do not resolve to a file on this machine (named above), so the index at ` +
        `${retrieval.indexPath} no longer describes the disk. NOTHING was written and nothing ` +
        `was drafted: a candidate whose evidence ref opens nothing is a citation that defeats ` +
        `the inspection it invites, and its observedAt would assert an observation nobody made. ` +
        `Re-run \`${VAULT_BUILD_COMMAND}\` to rebuild the index, then run this again.` +
        (present.confirmed > 0
          ? ` The other ${present.confirmed} page(s) did resolve; they were not written either.`
          : ``),
      );
  }
  const observed = present.pages;
  // AFTER the confirmation, because it is when this drafting run happened — and because a stamp
  // taken before a check that can fail would date a run that never occurred. Each evidence ref
  // carries its OWN observedAt from its own stat; this one is the run's.
  const draftedAt = new Date().toISOString();
  process.stdout.write(
    `harvest: ${observed.length} selected page(s) confirmed present by stat — a directory entry ` +
      `read, no page opened. Each evidence ref carries the instant its own page was confirmed ` +
      `at, so "observedAt" names an observation that actually happened.\n`,
  );

  // 3. THE EXPOSURE REPORT, printed BEFORE anything is drafted. Every selected page, and what
  //    its path says about whose page it is — which is all a path can say.
  for (const node of observed) {
    const kind = brainPageKind(node.relPath);
    process.stdout.write(
      `harvest:   ${kind === "third-party-shaped" ? "THIRD-PARTY-SHAPED" : "unclassified     "} ` +
        `${node.relPath}\n`,
    );
  }
  if (observed.length > 0) {
    process.stdout.write(
      `harvest: "unclassified" means the PATH said nothing about whose page it is — not that ` +
        `the page names nobody. A page under any directory can name a colleague, and only you, ` +
        `reading it, can tell.\n`,
    );
  }

  // 4. WITHHOLD, in the domain. Which directories hold notes about other people is a rule about
  //    what evidence means, so it is not this file's decision.
  const { offered, withheld } = partitionRetrieved(observed, includeThirdParty);
  for (const entry of withheld) {
    process.stdout.write(`harvest:   withheld ${entry.node.relPath} — ${entry.reason}\n`);
  }
  if (includeThirdParty && observed.some((n) => brainPageKind(n.relPath) === "third-party-shaped")) {
    // WHAT THIS BUYS AND WHAT IT DOES NOT. The earlier version of this paragraph promised that
    // every such ref is "marked and named again at review" and stopped there — which is a
    // protection ANNOUNCED and not delivered, because the operator relaxes on the strength of it
    // while a name arriving through page CONTENT reaches review unmarked. Both halves are said
    // now, and the second one is the one that matters.
    process.stdout.write(
      `harvest: --include-third-party is set, so pages about other people WERE offered to the ` +
        `drafter. Every ref off one is marked "${BRAIN_THIRD_PARTY_SOURCE}" in the document — ` +
        `and that mark is read off the page's PATH, so it says nothing about the pages a claim ` +
        `does NOT cite. The drafter is shown every offered page in one prompt, so a colleague's ` +
        `name can travel through a page's CONTENT into a line that cites something else. What is ` +
        `recorded instead is the whole pack each drafted title was written from, and review ` +
        `names that pack whenever any page in it was one about somebody else. Nothing was ` +
        `rewritten and no name was scrubbed — a rewriter falsifies what the evidence says rather ` +
        `than protecting anyone, and a name detector here would report confidence about a guess.\n`,
    );
  }

  // 5. DRAFT, only if asked, and FAIL CLOSED if the model was asked for and did not answer.
  let drafts = null;
  /** What the drafter was actually shown, one entry per offered page. Null when none ran. */
  let shown = null;
  if (useModel && offered.length > 0) {
    const read = await readPages(offered);
    if (!read.ok) {
      fail(`${read.cause} — ${read.detail}`);
    }
    for (const page of read.pages) {
      if (page.truncatedFrom !== null) {
        process.stdout.write(
          `harvest:   truncated ${page.node.relPath} — the model saw ${page.text.length} of ` +
            `${page.truncatedFrom} characters. A claim drafted from the part it saw is still ` +
            `cited to the whole page, so this is said rather than assumed — and now recorded on ` +
            `the candidate, so review repeats it days later instead of this line being the only ` +
            `place it was ever stated.\n`,
        );
      }
    }
    // THE PACK, as measured: what went in front of the model, and how big the page really is.
    shown = read.pages.map((page) => ({
      node: page.node,
      charsShown: page.text.length,
      charsInPage: page.truncatedFrom === null ? page.text.length : page.truncatedFrom,
    }));
    // ANNOUNCED BEFORE IT BLOCKS. The request is not streamed, so there is nothing to print
    // while it runs; measured on this machine the same pack took 33s, 63s and 105s on three
    // runs. Unannounced silence of that length reads as a hang, and an operator who kills the
    // command loses an answer that was on its way.
    //
    // IT NAMES THE ADDRESS, NOT THE LITERAL "127.0.0.1", and that is this slice's whole lesson
    // in miniature. This line is printed BEFORE the guard has looked at anything, so a host
    // stated here is an assertion about a value that has not been checked yet — the same
    // claim/effect split that let a 307 walk somebody's notes to another port. Observed while
    // driving the real CLI: with the endpoint overridden to an unparseable string it printed
    // "showing 3 page(s) … on 127.0.0.1" and then refused. Nothing was sent either way, but the
    // sentence was false. Print what is about to be used; `loopbackFetch` decides whether it may.
    process.stdout.write(
      `harvest: showing ${read.pages.length} page(s) to local-model:${LOCAL_DRAFTER_MODEL} at ` +
        `${OLLAMA_URL} — this is not streamed and has measured between 33s and 105s on one ` +
        `machine, so expect silence for a minute or more. Nothing has been written yet.\n`,
    );
    // THE SAME CONFIGURED ADDRESS AS `propose`, passed rather than defaulted. See OLLAMA_URL.
    const outcome = await draftLeaflets(read.pages, { endpoint: OLLAMA_URL });
    if (!outcome.ok) {
      fail(
        `--draft-with-local-model: ${outcome.cause} — ${outcome.detail} Nothing was written, ` +
          `and no page-derived titles were silently substituted; re-run without the flag to ` +
          `draft from the retrieval alone.`,
      );
    }
    drafts = outcome.drafts;
    process.stdout.write(
      `harvest: ${read.pages.length} page(s) (${outcome.sentChars} characters) shown to ` +
        `local-model:${LOCAL_DRAFTER_MODEL} (127.0.0.1 only) in ${outcome.elapsedMs}ms; ` +
        `${drafts.length} leaflet(s) proposed\n`,
    );
  }

  // 6. JUDGE, in the domain. What a page can establish is not this file's decision either.
  const built = brainNotesToCandidates({ offered, withheld, drafts, shown, draftedAt });
  if (!built.ok) {
    process.stderr.write(
      built.cause === "round-trip-rejected"
        ? `harvest: BUG — the candidates just drafted are not ones this product can load. ` +
            `Nothing was written.\n`
        : `harvest: the retrieval could not be turned into candidates. Nothing was written.\n`,
    );
    for (const issue of built.issues) {
      process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  // 7. THE SHARED STEP, exactly as `propose` and `propose-photos` use it (PR #17 review, blocker
  //    1): read `out` fresh, carry any EXISTING binding and review decisions forward, assemble
  //    the document, and validate it with the real gate. `propose-brain` has no --into flag of
  //    its own either, so `target` is always undefined — it can never SET a binding, only carry
  //    one forward.
  return withDocumentLocks([out], async () => {
  const prepared = prepareProposedDocument({ mode: "carry", out, candidates: built.candidates, target: undefined });
  // jscpd:ignore-start — triplicated outcome-handling around prepareProposedDocument (propose /
  // propose-photos / propose-brain) — extraction owed, tracked as F-026; the comments at each
  // site already call it THE SHARED STEP.
  if (!prepared.ok) {
    switch (prepared.cause) {
      case "rebind-disagreement": {
        // UNREACHABLE: no --into flag exists on this command either. Handled by name anyway.
        process.stderr.write(
          `harvest: BUG — prepareProposedDocument reported a binding disagreement with no ` +
            `--into given. This should be unreachable; nothing was written.\n`,
        );
        process.exit(EXIT_FAILED);
        break;
      }
      case "invalid-document": {
        process.stderr.write(
          `harvest: BUG — the document just produced is not one this product can load. ` +
            `Nothing was written.\n`,
        );
        for (const issue of prepared.issues) {
          process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
        }
        process.exit(EXIT_FAILED);
        break;
      }
      default: {
        const impossible = /** @type {never} */ (prepared);
        throw new Error(`unhandled prepare-proposed-document outcome: ${JSON.stringify(impossible)}`);
      }
    }
  }

  // 8. WRITE, exclusive-create unless --force. Nothing async stands between `prepared`'s own
  //    fresh read and this write — see blocker 2 in `src/proposeDocument.ts`.
  await writeNew(out, `${JSON.stringify(prepared.document, null, 2)}\n`, values["force"] === true);
  if (prepared.carried > 0 || prepared.reopened.length > 0) {
    process.stdout.write(`harvest: carried ${prepared.carried} review decision(s) forward\n`);
    for (const line of prepared.reopened) process.stdout.write(`harvest:   ${line}\n`);
  }
  if (prepared.bindingPreservedWithoutTarget !== null) {
    const b = prepared.bindingPreservedWithoutTarget;
    process.stdout.write(
      `harvest: binding preserved from the existing document — subject ` +
        `"${b.subject ?? "(unrecorded)"}"` +
        `${b.leafId === undefined ? "" : ` (leaf id "${b.leafId}")`}` +
        ` (propose-brain has no --into of its own; it never sets a binding, only carries one ` +
        `forward)\n`,
    );
  }
  // jscpd:ignore-end


  // 9. REPORT. Every proposed leaflet is accounted for: drafted, or refused with a cause.
  for (const refusal of built.refusals) {
    process.stdout.write(
      `harvest:   REFUSED ${refusal.cause}${refusal.title === null ? "" : ` "${refusal.title}"`}` +
        ` — ${refusal.reason}\n`,
    );
  }
  for (const refusal of built.refusedRatingShapedDrafts) {
    process.stdout.write(`harvest:   refused draft ${refusal.id} — ${refusal.reason}\n`);
  }
  for (const refusal of built.refusedRatingShapedPaths) {
    process.stdout.write(`harvest:   refused page path ${refusal.id} — ${refusal.reason}\n`);
  }
  for (const exposure of built.thirdPartyExposure) {
    process.stdout.write(
      `harvest:   THIRD PARTY ${exposure.id} rests on ${exposure.pages.join(", ")} — a page ` +
        `about somebody else. Read it before you approve this.\n`,
    );
  }
  if (built.thirdPartyShown.length > 0) {
    // THE REGISTER ABOVE IS NOT ENOUGH, AND SAYING SO IS THE FIX. It lists candidates whose REFS
    // are pages about other people; it is empty when the model read such a page and cited
    // another. This one fires whenever such a page was in the pack at all.
    process.stdout.write(
      `harvest: THIRD PARTY IN THE PACK — ${built.thirdPartyShown.length} page(s) about other ` +
        `people were in front of the drafter while it wrote every title above: ` +
        `${built.thirdPartyShown.join(", ")}. A drafted line may carry a name from any of them ` +
        `while citing none, so the mark on a ref cannot tell you it did. Each candidate records ` +
        `the pack it was written from, and review prints it. Read those pages before approving ` +
        `anything from this run.\n`,
    );
  }

  process.stdout.write(
    `harvest: ${built.candidates.length} candidate(s) drafted, ${built.undrafted.length} titled ` +
      `from the page path alone\n`,
  );

  if (built.candidates.length === 0) {
    if (observed.length === 0 && retrieval.outOfScope.length > 0) {
      // NOT "nothing matched". Pages were selected and every one of them belonged to a source
      // that was not asked for — a different fact with a different remedy, and collapsing the two
      // into one sentence is exactly the undercount this product refuses.
      //
      // WITH THE RETRIEVER IN tools/vault THIS BRANCH CANNOT FIRE, and it is here anyway because
      // that is not the only retriever this command can run. That tool seeds only from in-scope
      // nodes and expands from a node it has already selected, so an out-of-scope page always
      // arrives with the in-scope page that reached it. `--vault` points at a retrieval directory
      // this repository does not control — which is exactly the flag a fork holding only the open
      // packages uses — and a tool that seeds differently produces this state on its first run.
      // Reporting it as "nothing matched" there would be a confident sentence about a retrieval
      // that returned plenty.
      process.stdout.write(
        `harvest: 0 candidates, and NOT because nothing matched — every one of the ` +
          `${retrieval.outOfScope.length} page(s) the retriever selected belongs to a source ` +
          `outside "${sourceScope}" (each named above). An empty harvest was written. Widen ` +
          `--source if those notes are ones a portfolio claim may rest on.\n`,
      );
    } else if (observed.length === 0 && retrieval.skippedForBudget > 0) {
      // ALSO NOT "nothing matched", and this one was found by running the command: a single page
      // larger than the default budget matched the question and was then unaffordable, and the
      // sentence below would have said "not one of them matched" four lines under a line reading
      // "1 index entry matched". Two facts, two remedies — widen the question, or raise the
      // budget — and one sentence for both is the collapse this repository exists to refuse.
      process.stdout.write(
        `harvest: 0 pages selected, and NOT because nothing matched — ${retrieval.matched} index ` +
          `entr${retrieval.matched === 1 ? "y" : "ies"} matched "${question}" and ` +
          `${retrieval.skippedForBudget} reachable node(s) would not fit the token budget, so ` +
          `nothing was left to draft from. An empty harvest was written; nothing was invented, ` +
          `and no page was opened. Raise --budget to afford them.\n`,
      );
    } else if (observed.length === 0) {
      process.stdout.write(
        `harvest: 0 pages matched "${question}" — that is the honest result: the ranking ran ` +
          `over every entry in the index and not one of them matched. An empty harvest was ` +
          `written; nothing was invented, and no page was opened.\n`,
      );
    } else if (offered.length === 0) {
      process.stdout.write(
        `harvest: 0 candidates, and NOT because nothing matched — ${withheld.length} page(s) ` +
          `were found and withheld (named above) because they sit where notes about other ` +
          `people live. An empty harvest was written. Pass --include-third-party if you have ` +
          `decided that exposure is acceptable.\n`,
      );
    } else if (useModel) {
      process.stdout.write(
        `harvest: 0 candidates: ${LOCAL_DRAFTER_MODEL} was shown ${offered.length} page(s) and ` +
          `proposed nothing usable. An empty harvest was written; no page-derived titles were ` +
          `substituted, because you asked for the model's work and not this command's.\n`,
      );
    }
  } else if (!useModel) {
    process.stdout.write(
      `harvest: titles state where each page is and NOTHING it says — no note content is in ` +
        `this document, because no drafter was asked for. Add --draft-with-local-model to have ` +
        `${LOCAL_DRAFTER_MODEL} on 127.0.0.1 propose a claim from the pages themselves.\n`,
    );
  }

  if (built.candidates.length > 0) {
    process.stdout.write(
      `harvest: every evidence ref is an ABSOLUTE PATH on this machine, because a reviewer has ` +
        `to be able to open the page a claim rests on. The leaf page renders "Ref" verbatim, so ` +
        `promoting one publishes that path — it is reported rather than rewritten, and review ` +
        `is where you decide.\n`,
    );
  }
  process.stdout.write(
    `harvest: what a page says is not proof that the work happened — approved candidates ` +
      `promote to "pending", never "verified".\n`,
  );
  process.stdout.write(`harvest: wrote ${out}\n`);
  process.stdout.write(`harvest: next  ${reviewStep(out)}\n`);
  });

}

/* -------------------------------------------------------------------------- review ---- */

/** @param {string[]} args @returns {void} */
function review(args) {
  const { values } = parseOrUsage(args, { doc: { type: "string" } }, false);
  const path =
    typeof values["doc"] === "string" && values["doc"].trim() !== ""
      ? resolve(values["doc"].trim())
      : DEFAULT_HARVEST_PATH;
  const harvest = loadHarvest(path);

  process.stdout.write(`harvest: ${harvest.candidates.length} candidate(s) in ${path}\n`);
  if (harvest.candidates.length === 0) {
    process.stdout.write(`harvest: nothing to review — the harvest is empty.\n`);
    return;
  }
  let thirdParty = 0;
  /** Candidates whose PACK held a page about somebody else, cited or not. */
  let thirdPartyInPack = 0;
  /** Candidates whose drafter saw only part of at least one page it may cite whole. */
  let truncated = 0;
  for (const c of harvest.candidates) {
    // THE EXPOSURE, AT THE MOMENT OF THE DECISION. Review is exactly where a human decides
    // whether a colleague's name may travel onto a public page, so a candidate resting on a
    // page about somebody else says so HERE — not only in the JSON, and not only at the moment
    // it was drafted, which may have been days ago and by somebody else.
    const exposed = c.evidence.filter((e) => e.source === BRAIN_THIRD_PARTY_SOURCE);
    if (exposed.length > 0) thirdParty++;
    // AND THE PACK, WHICH IS THE LARGER SET. `exposed` is read off the refs, and the refs are
    // only what the candidate CITES; the drafter saw every page below at once. A title can
    // therefore carry a name out of a page it never cited, and this list is the only thing in
    // the document that says which pages those were.
    const pack = c.shownPages ?? [];
    const packThirdParty = pack.filter((p) => p.kind === "third-party-shaped");
    if (packThirdParty.length > 0) thirdPartyInPack++;
    const packCut = pack.filter((p) => p.charsShown < p.charsInPage);
    if (packCut.length > 0) truncated++;
    const media = c.media ?? [];
    process.stdout.write(
      `  ${c.id}\n` +
        `    title      ${c.title}\n` +
        `    state      ${describeReview(c.review)}\n` +
        `    evidence   ${c.evidence.length} ref(s)\n` +
        // WHAT APPROVING WOULD PUT IN THE BODY, shown at the moment of the decision — the same
        // rule the IMAGE block below states: an approval covers what the reviewer saw, and at
        // promotion each excerpt below becomes that element's visible text. Six or fewer print
        // whole; past that the count is stated so "+N more" is never mistaken for "only these".
        (() => {
          const excerpts = c.evidence.filter((e) => typeof e.excerpt === "string");
          if (excerpts.length === 0) return "";
          const shown = excerpts.length <= 6 ? excerpts : excerpts.slice(0, 5);
          return (
            shown
              .map((e) => `      ${String(e.ref).slice(0, 10)}  ${e.excerpt}\n`)
              .join("") +
            (shown.length === excerpts.length
              ? ""
              : `      +${excerpts.length - shown.length} more — every one is published in the body; the JSON holds them all\n`)
          );
        })() +
        `    extractor  ${c.extractor}\n` +
        // WHAT APPROVING WOULD PUBLISH, and the reason it is on this line rather than in the
        // JSON only. The whole argument for carrying media on the CANDIDATE instead of attaching
        // it out of the store at promotion is that an approval covers what the reviewer saw. A
        // reviewer who cannot see that a picture is attached is in exactly the position that
        // argument says they must never be in — so the fact is printed with the rest of the row,
        // and it is `image(s)` rather than a boolean because a candidate may carry more than one.
        (media.length === 0
          ? ``
          : `    IMAGE      ${media.length} image(s) would be published with this:\n` +
            media
              .map(
                (m) =>
                  `      ${m.media.mediaType} ${
                    m.media.dimensions.known
                      ? `${m.media.dimensions.width}×${m.media.dimensions.height}`
                      : `size not measured — ${m.media.dimensions.why}`
                  }  ${m.ref}\n`,
              )
              .join("")) +
        (exposed.length === 0
          ? ``
          : `    THIRD PARTY  ${exposed.length} of those ref(s) are pages about OTHER PEOPLE:\n` +
            exposed.map((e) => `      ${e.ref}\n`).join("")) +
        (pack.length === 0
          ? ``
          : `    shown to the drafter for this title: ${pack.length} page(s), ` +
            `${packThirdParty.length} whose PATH says they are about other people\n` +
            `      (a path is all this counts. A page under any directory can name a colleague\n` +
            `       or a client in its text, and nothing here has read the text.)\n` +
            pack
              .map(
                (p) =>
                  `      ${p.kind === "third-party-shaped" ? "THIRD-PARTY-SHAPED" : "unclassified      "} ` +
                  `${p.page} — ${
                    p.charsShown < p.charsInPage
                      ? `only ${p.charsShown} of ${p.charsInPage} characters were shown`
                      : `all ${p.charsInPage} characters`
                  }\n`,
              )
              .join("")),
    );
  }
  if (thirdParty > 0) {
    process.stdout.write(
      `harvest: ${thirdParty} candidate(s) rest on notes about other, identifiable people. ` +
        `Open those pages and read them before approving: nothing was rewritten and no name was ` +
        `removed, because editing the evidence would falsify what it says rather than protect ` +
        `anyone. Approving one puts it on a page meant to be shown to strangers.\n`,
    );
  }
  // THE CONDITION THAT WAS WRONG. This caution used to be gated on the count above, i.e. on
  // which refs a candidate happens to CITE — so a real gemma4:12b title carrying a client and two
  // individuals out of a page's content, citing a page whose path said nothing, printed no
  // caution at all. Silence there is worse than no protection, because propose had just told the
  // operator such pages are "marked and named again at review". It is gated on the pack now.
  if (thirdPartyInPack > 0) {
    process.stdout.write(
      `harvest: ${thirdPartyInPack} candidate(s) were drafted while a page about other people ` +
        `was IN THE PACK — whatever their refs say. A model shown several pages at once can put ` +
        `a name from one into a line citing another, and no mark on a ref can see that: the mark ` +
        `is read off a path. Nothing here detects names and nothing rewrites one, because a ` +
        `redactor over 800 real commit subjects on this project altered 12 lines and 11 were ` +
        `false positives. Read the pages listed under each candidate above.\n`,
    );
  }
  if (truncated > 0) {
    process.stdout.write(
      `harvest: ${truncated} candidate(s) were drafted from a page the model saw only part of, ` +
        `while citing that page whole (the character counts are above). Judge the claim against ` +
        `the part that was shown, or re-read the page yourself.\n`,
    );
  }

}

/* ------------------------------------------------------------------ approve / reject --- */

/**
 * Record one review decision. Shared by approve and reject because the discipline is shared:
 * find the candidate, refuse to re-decide a decided one (naming its current state), write
 * the whole document back atomically after re-gating it.
 *
 * @param {string[]} args
 * @param {"approved" | "rejected"} decision
 * @returns {Promise<void>}
 */
async function decide(args, decision) {
  const { values, positionals } = parseOrUsage(
    args,
    {
      by: { type: "string" },
      reason: { type: "string" },
      title: { type: "string" },
      doc: { type: "string" },
      "expect-subject-digest": { type: "string" },
    },
    true,
  );
  const id = positionals[0];
  if (positionals.length !== 1 || id === undefined || id.trim() === "") {
    process.stderr.write(`expected exactly one candidate id\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  const by = typeof values["by"] === "string" ? values["by"].trim() : "";
  if (by === "") {
    process.stderr.write(
      `missing required argument: --by <name>. A review decision must be attributable.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const reason = typeof values["reason"] === "string" ? values["reason"].trim() : "";
  // RETITLE AT APPROVAL — the one moment a human may replace the drafted title with their own
  // words, because "approval covers exactly what the reviewer saw" includes what they just
  // wrote. The extractor changes WITH it: a title the reviewer authored attributed to
  // "git-cluster" would say a machine drafted words it never drafted. The same no-rating gate
  // that judges a model's draft judges the human's — the rule is about what a portfolio may
  // assert, not about who typed it.
  const newTitle = typeof values["title"] === "string" ? values["title"].trim() : "";
  if (newTitle !== "" && decision !== "approved") {
    process.stderr.write(`--title belongs to approve: a rejected candidate's title is going nowhere.\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  if (newTitle !== "" && RATING_SHAPED.test(newTitle)) {
    process.stderr.write(
      `harvest: refusing to record this title — it is rating-shaped ("${newTitle}"). ` +
        `Counts and facts, never a score, whoever writes it.\n`,
    );
    process.exit(EXIT_FAILED);
  }
  if (decision === "rejected" && reason === "") {
    process.stderr.write(
      `missing required argument: --reason "<why>". A rejection without a reason is a ` +
        `silent disappearance, and this command refuses to record one.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  // F-025 SWEEP: the same asymmetry, found in the same investigation. approve/reject is a
  // REAL, irreversible WRITE against a document identified only by `--doc` — irreversible
  // because a decided candidate refuses to be re-decided (see the "already decided" refusal
  // below) — with no confirmation of which document that is. The gap is real for a direct,
  // bare `harvest.mjs approve|reject` invocation — exactly promote's own exposure, one command
  // over. Required the same way, refused the same way, never invented.
  const doc = typeof values["doc"] === "string" ? values["doc"].trim() : "";
  if (doc === "") {
    process.stderr.write(
      `missing required argument: --doc <harvest.json path>. ${decision === "approved" ? "approve" : "reject"} ` +
        `no longer guesses which document you mean — name it.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const path = resolve(doc);

  return withDocumentLocks([path], async () => {
  const harvest = loadHarvest(path);
  const target = harvest.candidates.find((c) => c.id === id);
  if (target === undefined) {
    fail(
      `no candidate "${id}" in ${path}. Run \`review --doc ${path}\` to see the ids that exist.`,
    );
  }
  if (target.review.state !== "candidate") {
    // Re-deciding a decided candidate would silently overwrite a recorded decision. The
    // current state is NAMED so the operator sees exactly what stands in the way.
    fail(
      `"${id}" is not open for review — it is already ${describeReview(target.review)}. ` +
        `A recorded decision is not overwritten by a later command.`,
    );
  }
  if (values["expect-subject-digest"] !== undefined && values["expect-subject-digest"] !== reviewSubjectDigest(target)) {
    fail(`stale candidate ${id}: the draft changed after it was shown. Nothing was written. Review the current material before deciding again.`);
  }

  const at = new Date().toISOString();
  // THE ONE REASSEMBLY POINT, ledger F-024: `withCandidates` keeps whatever document-level
  // fields `harvest` already carries — `subject`/`leafId` today — and replaces ONLY the
  // candidates array. Before this, `{ candidates: … }` alone dropped the target binding on
  // EVERY approve or reject: since a real promote needs an APPROVED candidate, and approving is
  // exactly what erased the binding, the sanctioned grow -> review -> promote sequence never
  // once exercised F-014's own mismatch check.
  const updated = withCandidates(
    harvest,
    harvest.candidates.map((c) => {
      if (c.id !== id) return c;
      // The digest is computed over the candidate AS DECIDED — retitle included — because
      // "approval covers exactly what the reviewer saw" includes the words they just wrote.
      const decided = {
        ...c,
        ...(newTitle !== "" ? { title: newTitle, extractor: `reviewer:${by}` } : {}),
      };
      const subjectDigest = reviewSubjectDigest(/** @type {any} */ (decided));
      return {
        ...decided,
        review:
          decision === "approved"
            ? { state: "approved", by, at, subjectDigest }
            : { state: "rejected", by, at, reason, subjectDigest },
      };
    }),
  );

  // Same self-check as propose: the gate judges what is about to hit the disk.
  const validated = parseHarvestDocument(JSON.parse(JSON.stringify(updated)));
  if (!validated.ok) {
    process.stderr.write(
      `harvest: BUG — the updated document is not one this product can load. Nothing was written.\n`,
    );
    for (const issue of validated.issues) {
      process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  await writeBack(path, `${JSON.stringify(updated, null, 2)}\n`);
  process.stdout.write(
    `harvest: "${id}" ${decision} by ${by} at ${at}` +
      (decision === "rejected" ? ` — ${reason}` : ``) +
      (newTitle !== "" ? ` — retitled in the reviewer's own words` : ``) +
      `\n`,
  );
  });

}

/* ------------------------------------------------------------------------- promote ---- */

/** @param {string[]} args @returns {Promise<void>} */
async function promote(args) {
  const { values } = parseOrUsage(
    args,
    {
      into: { type: "string" },
      out: { type: "string" },
      doc: { type: "string" },
      force: { type: "boolean", default: false },
      supersede: { type: "string", multiple: true },
      "expect-leaf-digest": { type: "string" },
      "expect-supersede": { type: "string", multiple: true },
    },
    false,
  );
  const into = typeof values["into"] === "string" ? values["into"].trim() : "";
  if (into === "") {
    process.stderr.write(`missing required argument: --into <leaf.json path>\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  // F-025: REQUIRED, exactly like --into, and refused the SAME way when absent or empty —
  // never invented. Every other subcommand's `--doc`/`--out` defaults to a well-known path
  // beside the app because there is only one document to be ambiguous about; `promote` is
  // different, because it is the one command an operator runs to publish a DECISION they made
  // about a SPECIFIC document, and silently substituting `DEFAULT_HARVEST_PATH` for a forgotten
  // flag means promoting whatever candidate happens to sit there instead — a stale document,
  // possibly somebody else's — with only a soft "unbound document" caveat printed, never a
  // refusal. Reproduced live: a stale, pre-approved candidate at the default path landed in a
  // real leaf when `--doc` was simply left off.
  const doc = typeof values["doc"] === "string" ? values["doc"].trim() : "";
  if (doc === "") {
    process.stderr.write(
      `missing required argument: --doc <harvest.json path>. promote no longer guesses which ` +
        `document you mean — name it, the same way --into already has to be named.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
  const intoPath = resolve(into);
  const outPath =
    typeof values["out"] === "string" && values["out"].trim() !== ""
      ? resolve(values["out"].trim())
      : intoPath;
  const docPath = resolve(doc);

  const supersede = new Set(Array.isArray(values["supersede"]) ? values["supersede"] : []);
  const expectedLeaf = values["expect-leaf-digest"];
  const expectedCandidates = new Map();
  for (const raw of Array.isArray(values["expect-supersede"]) ? values["expect-supersede"] : []) {
    let pair;
    try { pair = JSON.parse(raw); } catch { fail("invalid --expect-supersede: expected a candidate id and review digest"); }
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" ||
        typeof pair[1] !== "string" || !/^rsd1:[a-f0-9]{64}$/.test(pair[1]) ||
        !supersede.has(pair[0]) || expectedCandidates.has(pair[0])) {
      fail("invalid --expect-supersede: name each permitted candidate once with its review digest");
    }
    expectedCandidates.set(pair[0], pair[1]);
  }
  if (expectedLeaf !== undefined || expectedCandidates.size > 0) {
    if (typeof expectedLeaf !== "string" || !/^[a-f0-9]{64}$/.test(expectedLeaf) ||
        expectedCandidates.size !== supersede.size || supersede.size === 0) {
      fail("replacement review requires the leaf digest and a digest for every --supersede id");
    }
  }

  return withDocumentLocks([docPath, intoPath, outPath], async () => {
  const harvest = loadHarvest(docPath);

  // Load and GATE the target leaf. Promotion appends to a real document; a target that does
  // not pass the leaf gate is refused with the gate's own issues, not patched around.
  const targetLeaf = readLeafOrFail(intoPath);
  if (expectedLeaf !== undefined && createHash("sha256").update(readFileSync(intoPath)).digest("hex") !== expectedLeaf) {
    fail("stale replacement: the leaf or its sharing settings changed after review. Nothing was written. Review the current leaf before replacing it.");
  }
  for (const [id, digest] of expectedCandidates) {
    const candidate = harvest.candidates.find(c => c.id === id);
    if (candidate === undefined || candidate.review.state !== "approved" || reviewSubjectDigest(candidate) !== digest) {
      fail(`stale replacement ${id}: the candidate changed after replacement was approved. Nothing was written. Review the current body before replacing it.`);
    }
  }

  // PLUMBING, not a decision made here: this command trusts whichever ids its caller names.
  // No Foliage surface asks this today; a bare `--supersede <id>` typed by hand is the same
  // trust an operator already extends to every other flag on this command, and promote.ts's
  // own named checks are what stand between that trust and an actual replacement — see the
  // USAGE block above.
  const result = promoteApproved(harvest, targetLeaf, supersede);
  // EXHAUSTIVE BY NAME, not sequential if/else — the F-012 failure class, one seam over: an
  // `ok:false` variant this switch does not name fails the typecheck via the `never` branch
  // below rather than falling through a chain of ifs that happens to have caught every member
  // so far. Same idiom as `ReviewRefusal`/`HarvestLoad` in `src/render.ts`.
  if (!result.ok) {
    switch (result.cause) {
      case "cell-authority-refused": {
        process.stderr.write(`harvest: refused — ${result.reason} Nothing written.\n`);
        process.exit(EXIT_FAILED);
        return;
      }
      case "binding-mismatch": {
        // F-014. Not a bug in this module — the harvest's OWN recorded target disagrees with
        // --into, so nothing promoted and nothing was written. Both values named per mismatch so
        // the operator can confirm the refusal by reading the same two documents this function did.
        process.stderr.write(
          `harvest: refused — ${docPath} was not proposed for this leaf. Nothing was promoted or ` +
            `written.\n`,
        );
        for (const mismatch of result.mismatches) {
          process.stderr.write(
            `harvest:   ${mismatch.field} mismatch — this harvest: "${mismatch.harvestValue}"  ` +
              `${intoPath}: "${mismatch.leafValue}"\n`,
          );
          process.stderr.write(`harvest:     ${mismatch.message}\n`);
        }
        process.exit(EXIT_FAILED);
        return; // unreachable — process.exit never returns — stated so nothing falls through
      }
      case "round-trip-rejected": {
        process.stderr.write(
          `harvest: BUG — promotion built a document the leaf gate refuses ` +
            `(${result.cause}). Nothing was written.\n`,
        );
        for (const issue of result.issues) {
          process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
        }
        process.exit(EXIT_FAILED);
        return;
      }
      default: {
        const impossible = /** @type {never} */ (result);
        throw new Error(`unhandled promote outcome: ${JSON.stringify(impossible)}`);
      }
    }
  }
  if (result.binding === "unbound-legacy") {
    // BACKWARD HONESTY, ledger F-014: an older document, or one proposed with no --into,
    // carries no target binding at all. That is not treated as a match — it is promoted, WITH
    // this caveat stated, every time, never silently assumed to belong here.
    process.stdout.write(
      `harvest: unbound document — binding not checked (${docPath} carries no recorded ` +
        `subject/leaf-id from propose, so it was not verified to belong to ${intoPath} before ` +
        `promoting)\n`,
    );
  }

  // Promotion already preserves and validates the person's document settings. Serialize the
  // whole result so a new owner-authored setting is not silently dropped by this CLI.
  const serialized = `${JSON.stringify(result.leaf, null, 2)}\n`;
  await writeNew(outPath, serialized, values["force"] === true);

  // Honest counts. Zero promoted is printed plainly, never dressed up.
  process.stdout.write(
    `harvest: promoted ${result.promoted.length}  skipped-not-approved ` +
      `${result.skippedNotApproved.length}  refused-duplicate ${result.refusedDuplicates.length}` +
      `  refused-contradicted ${result.refusedContradicted.length}  superseded ` +
      `${result.superseded.length}\n`,
  );
  for (const skip of result.skippedNotApproved) {
    process.stdout.write(`harvest:   skipped ${skip.id} — ${skip.reason}\n`);
  }
  for (const refusal of result.refusedDuplicates) {
    process.stdout.write(`harvest:   refused ${refusal.id} — ${refusal.reason}\n`);
  }
  // WHAT CHANGED, named — the same discipline as every refusal above: a caller told "superseded"
  // without being told which refs moved has to trust that it happened, not confirm it.
  for (const s of result.superseded) {
    process.stdout.write(
      `harvest:   superseded ${s.id} — visibility "${s.visibility}" kept; ` +
        `+${s.refsAdded.length} ref(s) added, -${s.refsRemoved.length} ref(s) removed\n`,
    );
  }
  // BOTH VERDICTS, per the error-masking rule: this command's refusal, and the target leaf's own
  // recorded reason for the ref it refused over. The second is what the operator can check by
  // opening the leaf — the leaflet id is printed for exactly that.
  for (const refusal of result.refusedContradicted) {
    process.stdout.write(
      `harvest:   REFUSED ${refusal.id} (${refusal.cause}) — ${refusal.reason}\n`,
    );
    for (const conflict of refusal.conflicts) {
      process.stdout.write(
        `harvest:     ${conflict.ref} — leaflet "${conflict.leafletId}" in ${intoPath} says: ` +
          `${conflict.leafReason}\n`,
      );
    }
  }
  if (result.refusedContradicted.length > 0) {
    // Not fatal, and said rather than assumed: the leaf WAS written, with every other approved
    // candidate in it. Exiting non-zero after a successful write would tell an operator the file
    // is untrustworthy when the refusal is precisely what kept it trustworthy.
    process.stdout.write(
      `harvest: ${result.refusedContradicted.length} approved candidate(s) rest on commits ` +
        `${intoPath} attributes to somebody else, so they were refused whole and named above. ` +
        `This is the drafting side being wrong, not the leaf: re-run \`propose --repo <path> ` +
        `--identity <email>\` with the identities this subject actually commits under, which ` +
        `withholds those commits before they ever reach a cluster. Everything else was ` +
        `promoted and written.\n`,
    );
  }
  // ONE ACCOUNT OF THE APPROVED. A candidate refused above IS approved — the usual case is
  // `review --resume` after a promotion, which finds every approved candidate already in the leaf —
  // so "no candidate is approved" under "refused-duplicate 1" contradicted the line above it.
  const approvedNotAdded = result.refusedDuplicates.length + result.refusedContradicted.length;
  if (result.promoted.length === 0 && result.superseded.length === 0) {
    process.stdout.write(
      (approvedNotAdded === 0
        ? `harvest: promoted 0 — no candidate in ${docPath} is approved.`
        : `harvest: promoted 0 — ${approvedNotAdded === 1 ? "the 1 approved candidate is" : `the ${approvedNotAdded} approved candidates are`} ` +
          `named above with why ${approvedNotAdded === 1 ? "it was" : "they were"} not added.`) +
        ` The leaf was still re-validated and written unchanged in content.\n`,
    );
  }
  process.stdout.write(`harvest: wrote ${outPath}\n`);
  process.stdout.write(`harvest: serve it with  ${foliageNextStep("up", outPath) ?? `FOLIAGE_LEAF=${outPath} node apps/leaf/server.mjs`}\n`);
  });

}

/* --------------------------------------------------------------------------- adopt ---- */

/**
 * The repository's own answer about each ref: which are commits it holds, and their author dates.
 * Read-only git: `cat-file --batch-check` for existence, `log --no-walk --stdin` for `%aI`. A ref git
 * does not hold is simply absent from the map — the plan refuses it by name, never dates it by guess.
 * The value is what git printed for `%aI`, unchecked: the plan dates a ref only when that is an
 * instant, so a commit with no usable author date is held and undated.
 *
 * @param {string} root @param {readonly string[]} shas
 * @returns {Map<string, string>}
 */
function authorDates(root, shas) {
  const git = (/** @type {string[]} */ args, /** @type {string} */ input) => {
    const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (r.status !== 0) fail(`git ${args[0]} failed in ${root}: ${(r.stderr ?? "").trim() || `exit ${r.status}`}. Nothing was written.`);
    return r.stdout ?? "";
  };
  if (shas.length === 0) return new Map();
  // cat-file answers one line per ref, in order. A ref is held when it names a commit it is a
  // prefix of — an abbreviated sha is held under its own spelling; a branch name never is.
  const lines = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${shas.join("\n")}\n`).split("\n");
  /** @type {[ref: string, commit: string][]} */
  const held = shas.flatMap((ref, i) => {
    const [name = "", type] = (lines[i] ?? "").trim().split(" ");
    return type === "commit" && name.startsWith(ref) ? [/** @type {[string, string]} */ ([ref, name])] : [];
  });
  if (held.length === 0) return new Map();
  const printed = new Map(
    git(["log", "--no-walk=unsorted", "--stdin", "--format=%H%x00%aI"], `${held.map(([, name]) => name).join("\n")}\n`)
      .split("\n")
      .filter((line) => line.includes("\0"))
      .map((line) => /** @type {[string, string]} */ (line.split("\0"))),
  );
  return new Map(held.flatMap(([ref, name]) => {
    const date = printed.get(name);
    return date === undefined ? [] : [/** @type {[string, string]} */ ([ref, date])];
  }));
}

/**
 * The real path of the repository toplevel that holds `path`, or undefined when git gives no
 * answer. Real, because `grow` records `resolve(repo)` — possibly a subdirectory, possibly a
 * symlinked spelling (`/var` is `/private/var` on macOS) — and compares real paths; two spellings
 * of one repository must be one repository here too.
 *
 * @param {string} path @returns {string | undefined}
 */
function toplevelOf(path) {
  const top = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const answer = (top.stdout ?? "").trim();
  if (top.status !== 0 || answer === "") return undefined;
  try {
    return realpathSync(answer);
  } catch {
    return undefined;
  }
}

/** @param {string} path @param {number} stamp */
const backupPathOf = (path, stamp) => `${path.endsWith(".json") ? path.slice(0, -5) : path}.before-adopt-${stamp}.json`;

/** @param {string[]} args @returns {Promise<void>} */
async function adopt(args) {
  const { values } = parseOrUsage(
    args,
    {
      doc: { type: "string" },
      into: { type: "string" },
      repo: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    false,
  );
  for (const flag of ["doc", "into", "repo"]) {
    if (typeof values[flag] !== "string" || values[flag].trim() === "") {
      process.stderr.write(`missing required argument: --${flag}\n\n${USAGE}`);
      process.exit(EXIT_USAGE);
    }
  }
  const docPath = resolve(String(values["doc"]).trim());
  const intoPath = resolve(String(values["into"]).trim());
  const apply = values["apply"] === true;
  const root = toplevelOf(resolve(String(values["repo"]).trim()));
  if (root === undefined) fail(`--repo ${values["repo"]} is not a git repository. Nothing was written.`);

  const work = async () => {
    const harvest = loadHarvest(docPath);
    const leaf = readLeafOrFail(intoPath);
    const shas = [...new Set(harvest.candidates.flatMap((c) => c.evidence.filter((e) => e.source === "git").map((e) => e.ref)))];
    // A recorded repository that is --repo by another spelling is kept as recorded: the plan's
    // strict comparison then sees one repository, and grow's own record is not rewritten.
    const recorded = harvest.repo;
    const repo = recorded !== undefined && toplevelOf(recorded) === root ? recorded : root;
    const planned = planQueueAdoption(harvest, leaf, authorDates(root, shas), repo);
    if (!planned.ok) {
      process.stderr.write(`harvest: adopt refused — ${adoptionRefusalLabel(planned.cause)} (${planned.cause})\n`);
      for (const id of planned.ids) process.stderr.write(`harvest:   ${id}\n`);
      fail(`nothing was written.`);
    }
    const { plan } = planned;
    process.stdout.write(`harvest: adopt  ${docPath} → ${intoPath}\n`);
    process.stdout.write(`harvest:   binding   ${plan.binding.subject} · ${plan.binding.leafId}\n`);
    process.stdout.write(`harvest:   repo      ${plan.repo}\n`);
    process.stdout.write(`harvest:   dated     ${plan.backfill}\n`);
    process.stdout.write(`harvest:   in leaf   ${plan.inLeaf.length}\n`);
    process.stdout.write(`harvest:   waiting   ${plan.waiting.length}\n`);
    for (const id of plan.waiting) process.stdout.write(`harvest:     ${id}\n`);
    process.stdout.write(`harvest:   extend    ${plan.extensions.length}\n`);
    for (const e of plan.extensions) {
      process.stdout.write(
        `harvest:   ${e.id}  +${e.refsAdded.length}  filled ${e.refsFilled.length}\n` +
          `harvest:     was       ${e.oldTitle}\n` +
          `harvest:     approved  ${e.approvedTitle}\n`,
      );
    }

    // The promotion runs in the dry run too — it is pure — so the dry run shows exactly what
    // --apply lands, and refuses exactly what --apply would. promote.ts still makes every one of
    // its own supersede checks, and the leaf's exclusions are consulted there, not guessed here.
    const permission = new Set(plan.extensions.map((e) => e.id));
    const result = promoteApproved(plan.adopted, leaf, permission);
    if (!result.ok) {
      fail(`promotion refused the adopted harvest (${result.cause}). Nothing was written.`);
    }
    const landed = new Set(result.superseded.map((s) => s.id));
    const unlanded = [...permission].filter((id) => !landed.has(id));
    if (unlanded.length > 0 || result.refusedContradicted.length > 0) {
      for (const r of result.refusedDuplicates.filter((d) => permission.has(d.id))) {
        process.stderr.write(`harvest:   ${r.id} — ${r.reason}\n`);
      }
      for (const r of result.refusedContradicted) process.stderr.write(`harvest:   ${r.id} — ${r.reason}\n`);
      fail(`promotion did not land ${[...unlanded, ...result.refusedContradicted.map((r) => r.id)].join(", ")}. Nothing was written.`);
    }
    // Re-read in the dry run too, so the dry run cannot approve a harvest --apply would refuse.
    const harvestText = `${JSON.stringify(plan.adopted, null, 2)}\n`;
    const checked = parseHarvestDocument(JSON.parse(harvestText));
    if (!checked.ok) {
      for (const issue of checked.issues) process.stderr.write(`harvest:   ${issue.at}: ${issue.message}\n`);
      fail(`BUG — the adopted harvest is not one this product can load. Nothing was written.`);
    }
    if (plan.alreadyAdopted) {
      process.stdout.write(`harvest: already adopted — nothing written\n`);
      return;
    }
    if (!apply) {
      process.stdout.write(`harvest: dry run — nothing written\n`);
      process.stdout.write(`harvest: next  add --apply\n`);
      return;
    }

    const stamp = Date.now();
    for (const path of [docPath, intoPath]) {
      const backup = backupPathOf(path, stamp);
      try {
        writeDocument(backup, readFileSync(path, "utf8"), false);
      } catch (error) {
        fail(`could not back up ${path} to ${backup}: ${messageWithCause(error)}. Nothing was written.`);
      }
      process.stdout.write(`harvest: backup  ${backup}\n`);
    }
    await writeBack(docPath, harvestText);
    process.stdout.write(`harvest: wrote ${docPath}\n`);
    await writeBack(intoPath, `${JSON.stringify(result.leaf, null, 2)}\n`);
    process.stdout.write(`harvest: wrote ${intoPath}\n`);
    process.stdout.write(
      `harvest: extended ${result.superseded.length} · appended ${result.promoted.length} · private kept\n`,
    );
  };

  try {
    await withDocumentLocks([docPath, intoPath], work);
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ELOCALBUSY") fail(`${messageOf(error)} Nothing was written.`);
    throw error;
  }
}

/* ------------------------------------------------------------------------ dispatch ---- */

const [subcommand, ...rest] = process.argv.slice(2);

if (subcommand === undefined || subcommand === "--help" || subcommand === "help") {
  process.stdout.write(USAGE);
  process.exit(subcommand === undefined ? EXIT_USAGE : 0);
}

switch (subcommand) {
  case "propose":
    await propose(rest).catch(failIfBusy);
    break;
  case "propose-photos":
    await proposePhotos(rest).catch(failIfBusy);
    break;
  case "propose-brain":
    await proposeBrain(rest).catch(failIfBusy);
    break;
  case "review":
    review(rest);
    break;
  case "approve":
    await decide(rest, "approved").catch(failIfBusy);
    break;
  case "reject":
    await decide(rest, "rejected").catch(failIfBusy);
    break;
  case "promote":
    await promote(rest).catch(failIfBusy);
    break;
  case "adopt":
    await adopt(rest);
    break;
  default:
    process.stderr.write(`unknown subcommand "${subcommand}"\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
}
