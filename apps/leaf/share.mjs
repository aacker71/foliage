#!/usr/bin/env node
/**
 * Leaf share — decide, from the terminal, which of your leaflets have a shareable address.
 *
 * THE HOLE THIS FILLS, measured on the real running server rather than reasoned about. After
 * intake and promote had both run against this repository's own history, the leaf held 40
 * leaflets and `GET /leaflet/<id>` answered 404 for every one of them, correctly: `private` is
 * the domain default and it is expressed by ABSENCE, so a document nobody has edited shares
 * nothing. The share route, the artifact page and the body were all built and all reachable —
 * by hand-editing JSON, and by nothing else. This command is the missing user path, and it is
 * deliberately the smallest one: three subcommands, no flags nobody asked for.
 *
 *   node apps/leaf/share.mjs list
 *   node apps/leaf/share.mjs share <id> [--as unlisted|public] --leaf <path>
 *   node apps/leaf/share.mjs unshare <id> --leaf <path>
 *
 * `share`/`unshare` require --leaf (or FOLIAGE_LEAF) explicitly — F-025's sweep found this
 * file's write silently defaulting the same way `harvest.mjs`'s `--doc` once did. `list` still
 * defaults: see `documentPath` vs `requiredDocumentPath` below.
 *
 * WHY A COMMAND AND NOT A BUTTON. Sharing is the one decision on this surface with a
 * consequence that leaves the machine, and the server that renders the leaf has no
 * authentication of any kind — it binds loopback and anyone who can reach the port is treated
 * as the subject. A POST that could widen who may read somebody's evidence does not belong on
 * an unauthenticated surface; the terminal already answers "is this the person" with the
 * filesystem's own permissions. When the leaf grows a real identity this can become a button.
 *
 * WHY `unshare` DELETES THE KEY instead of writing `"private"`. The default lives in exactly
 * one place (`leafletVisibility`), expressed by the field's absence. Writing the word would be
 * a second spelling of one state, and two documents meaning the same thing would stop
 * comparing equal. The transformation is in `src/share.ts`; this file owns only the I/O.
 *
 * Every write is temp-then-rename — atomic on one filesystem — and the bytes are put through
 * `parseLeafDocument` BEFORE they reach the disk, the same self-check intake and harvest make.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");

const { DEFAULT_DOCUMENT_PATH, DOCUMENT_ENV } = await import("./src/leafDocument.ts").catch(
  explainFailedWorkspaceImport,
);
const { LEAFLET_ROUTE } = await import("./src/render.ts").catch(explainFailedWorkspaceImport);
const { isVisibility, setVisibility, visibilityRows } = await import("./src/share.ts").catch(
  explainFailedWorkspaceImport,
);
// F-025 SWEEP: `writeGuard` (`@foliage/photosynthesis`) is the one shared, pure rule for "is
// this configured, or about to guess" — already behind `apps/leaf/server.mjs` and
// `apps/photosynthesis/review-server.mjs`'s write routes. `share`/`unshare` below are this
// file's own write, and the highest-stakes one in the product (see this file's own header).
const { writeGuard } = await import("@foliage/photosynthesis").catch(explainFailedWorkspaceImport);

const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

const USAGE = `Leaf share — which of your leaflets have a shareable address.

  node apps/leaf/share.mjs <subcommand> [options]

Subcommands
  list [--leaf <path>]
      Every leaflet, its id, and whether its own address serves it. States what the DOCUMENT
      says separately from what the default supplies, because "nobody decided" and "decided
      private" are the same state and not the same fact.

  share <id> [--as unlisted|public] --leaf <path>
      Give one leaflet a working address. --as defaults to "unlisted": may be handed to
      whoever holds the link, and still not listed anywhere. "public" additionally permits it
      to be listed outward. Being willing to hand someone a link is a different consent from
      being enumerated, which is why they are two words and not a boolean. An excluded
      leaflet — work Foliage could not attribute to you — is refused, with its reason.

  unshare <id> --leaf <path>
      Take the address away. The leaflet stays in the leaf and in your own accounting; its
      address goes back to answering as though nothing were there.

\`list\` defaults to ${DEFAULT_DOCUMENT_PATH} and honours ${DOCUMENT_ENV}; --leaf beats both.
\`share\`/\`unshare\` do NOT default (F-025 sweep): pass --leaf, or export ${DOCUMENT_ENV} — this
is the one write on this surface that can turn something exposed, and it never guesses which
document that is. Nothing here is scored, ranked or sent anywhere: no network call is made.
`;

/** @param {string} message @returns {never} */
function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`share: ${message}\n`);
  process.exit(code);
}

/** @param {unknown} err @returns {string} */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {unknown} err @returns {string} */
function errnoOf(err) {
  return err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
}

/**
 * @param {string[]} args
 * @param {import("node:util").ParseArgsConfig["options"]} options
 * @returns {{values: Record<string, unknown>, positionals: string[]}}
 */
function parseOrUsage(args, options) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (err) {
    process.stderr.write(`${messageOf(err)}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
}

/**
 * Which document. `--leaf` beats the environment beats the default, and the resolution is
 * PRINTED by every subcommand: a command that edits a file it chose for you should say which.
 *
 * @param {unknown} flag
 * @returns {string}
 */
function documentPath(flag) {
  if (typeof flag === "string") {
    if (flag.trim() === "") fail(`--leaf was given an empty path.`, EXIT_USAGE);
    return flag.trim();
  }
  const configured = process.env[DOCUMENT_ENV];
  if (configured !== undefined && configured.trim() === "") {
    fail(
      `${DOCUMENT_ENV} is set but blank, so no document path could be determined. Either unset ` +
        `it — the default is then ${DEFAULT_DOCUMENT_PATH} — or pass --leaf <path>.`,
      EXIT_USAGE,
    );
  }
  return configured === undefined ? DEFAULT_DOCUMENT_PATH : configured.trim();
}

/**
 * Which document — for a WRITE. Same precedence as `documentPath` (`--leaf` beats
 * FOLIAGE_LEAF), but NEVER falls through to the default path (F-025 sweep): `share`/`unshare`
 * is the one write on this whole surface that can turn something exposed — this file's own
 * header says so — and a write that landed on nobody's chosen leaf because neither `--leaf`
 * nor FOLIAGE_LEAF was actually configured is that class of defect one document over from
 * `harvest.mjs`'s own `--doc`, fixed for the identical reason. `list` keeps defaulting:
 * reading the wrong leaf by accident prints a confusing list, never a write.
 *
 * @param {unknown} flag
 * @returns {string}
 */
function requiredDocumentPath(flag) {
  if (typeof flag === "string") {
    if (flag.trim() === "") fail(`--leaf was given an empty path.`, EXIT_USAGE);
    return flag.trim();
  }
  const verdict = writeGuard({ [DOCUMENT_ENV]: process.env[DOCUMENT_ENV] });
  if (verdict.ok) return /** @type {string} */ (process.env[DOCUMENT_ENV]).trim();
  fail(
    `missing required argument: --leaf <path>. share/unshare no longer guess which document ` +
      `you mean — name it with --leaf, or export ${DOCUMENT_ENV}. (\`list\` still defaults to ` +
      `${DEFAULT_DOCUMENT_PATH} when neither is set — that default is fine for a READ.)`,
    EXIT_USAGE,
  );
}

/**
 * Read the document as RAW JSON. Four distinct causes stay distinct — the parser is applied
 * later, by `src/share.ts`, so that "this is not JSON" and "this is JSON but not a leaf" never
 * collapse into one message.
 *
 * @param {string} path
 * @returns {Promise<unknown>}
 */
// jscpd:ignore-start — the read-JSON / atomic-write-back / report-issues trio is identical to
// policy.mjs's; historical duplication predating this gate, not retriaged here.
async function readRaw(path) {
  /** @type {Buffer} */
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") {
      fail(
        `no leaf document at ${path}. Run \`node apps/leaf/intake.mjs\` first, or pass ` +
          `--leaf <path>.`,
      );
    }
    fail(`${path} could not be read: ${messageOf(err)} [${code}]`);
  }
  // A BOM survives an editor and then breaks JSON.parse at position 0, blaming the first token.
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  try {
    return JSON.parse(text);
  } catch (err) {
    return fail(`${path} is not valid JSON: ${messageOf(err)}`);
  }
}

/**
 * @param {string} path
 * @param {unknown} document
 * @returns {Promise<void>}
 */
async function writeBack(path, document) {
  try { writeDocument(path, `${JSON.stringify(document, null, 2)}\n`); }
  catch (error) { fail(`could not write ${path}: ${messageOf(error)} [${errnoOf(error)}]`); }

}

/** @param {string} path @param {string} headline @param {readonly {at: string, message: string}[]} issues @returns {never} */
function failWithIssues(path, headline, issues) {
  process.stderr.write(`share: ${path} ${headline}\n`);
  for (const issue of issues) process.stderr.write(`share:   ${issue.at}: ${issue.message}\n`);
  process.exit(EXIT_FAILED);
}
// jscpd:ignore-end

/* ------------------------------------------------------------------------------ list ---- */

/** @param {string[]} args */
async function list(args) {
  const { values } = parseOrUsage(args, { leaf: { type: "string" } });
  const path = documentPath(values["leaf"]);
  const rows = visibilityRows(await readRaw(path));
  if (!rows.ok) failWithIssues(path, "is valid JSON but is not a leaf document:", rows.issues);

  process.stdout.write(`share: ${rows.rows.length} leaflet(s) in ${path}\n`);
  const shared = rows.rows.filter((r) => r.shared);
  for (const row of rows.rows) {
    // The address is printed ONLY for a leaflet that has one. Printing an address that 404s
    // would teach the subject a URL that does not work and then look like a bug in the server.
    const where = row.shared ? `  ${LEAFLET_ROUTE}${encodeURIComponent(row.id)}` : "";
    const how = row.stated === undefined ? `${row.visibility} (by default)` : row.visibility;
    // An excluded leaflet is never served as the subject's, whatever an older document says.
    const excluded = row.excludedReason === undefined ? "" : " · not shared · excluded";
    process.stdout.write(`share:   ${row.id}  —  ${how}${excluded}${where}\n`);
  }
  // A plain zero, said out loud. Silence here would read as "everything is fine".
  process.stdout.write(
    `share: ${shared.length} of ${rows.rows.length} leaflet(s) have a working address.\n`,
  );
  if (shared.length === 0) {
    process.stdout.write(
      `share: that is the correct state for a leaf nobody has decided about — private is the\n` +
        `share: default and it is not an error. \`share <id>\` gives one an address.\n`,
    );
  }
}

/* --------------------------------------------------------------------- share / unshare ---- */

/**
 * @param {string[]} args
 * @param {"share" | "unshare"} verb
 */
async function setOne(args, verb) {
  /** @type {import("node:util").ParseArgsConfig["options"]} */
  const options =
    verb === "share"
      ? { leaf: { type: "string" }, as: { type: "string" } }
      : { leaf: { type: "string" } };
  const { values, positionals } = parseOrUsage(args, options);
  const id = positionals[0];
  if (id === undefined || id.trim() === "") {
    fail(`${verb} needs the id of a leaflet: \`share.mjs ${verb} <id>\`. \`list\` prints them.`, EXIT_USAGE);
  }
  if (positionals.length > 1) {
    fail(
      `${verb} takes ONE id and got ${positionals.length}: ${positionals.join(", ")}. An id may ` +
        `contain characters your shell splits on — quote it.`,
      EXIT_USAGE,
    );
  }

  /** @type {"unlisted" | "public" | null} */
  let to = null;
  if (verb === "share") {
    const asked = typeof values["as"] === "string" ? values["as"].trim() : "unlisted";
    if (!isVisibility(asked)) {
      fail(`--as ${asked} is not a visibility. It is "unlisted" or "public".`, EXIT_USAGE);
    }
    if (asked === "private") {
      fail(
        `--as private would not share anything. That is what \`unshare ${id}\` is for, and it ` +
          `removes the field rather than writing the word — the default is expressed by absence.`,
        EXIT_USAGE,
      );
    }
    to = asked;
  }

  // F-025 SWEEP: this writes (see writeBack below) — never against a leaf silently guessed
  // from an unconfigured --leaf/FOLIAGE_LEAF. requiredDocumentPath refuses instead.
  const path = requiredDocumentPath(values["leaf"]);
  return withDocumentLocks([path], async () => {
  const raw = await readRaw(path);
  const outcome = setVisibility(raw, id, to);

  if (!outcome.ok) {
    switch (outcome.cause) {
      case "not-a-leaf":
        return failWithIssues(path, "is valid JSON but is not a leaf document:", outcome.issues);
      case "would-not-parse":
        return failWithIssues(
          path,
          "was NOT written: the document this edit would produce is not one this product can " +
            "load. That is a bug here, and your file is unchanged:",
          outcome.issues,
        );
      case "excluded":
        // QA #15: work Foliage could not attribute to you is never yours to share. One line, the
        // reason the leaflet already carries, no address, and the file is untouched.
        return fail(`Not shared · excluded: ${outcome.reason.replace(/\s+/gu, " ").trim()}`);
      case "no-such-leaflet":
        process.stderr.write(`share: no leaflet "${outcome.id}" in ${path}.\n`);
        process.stderr.write(`share: ${outcome.known.length} id(s) are in this document:\n`);
        for (const known of outcome.known.slice(0, 10)) process.stderr.write(`share:   ${known}\n`);
        if (outcome.known.length > 10) {
          process.stderr.write(`share:   … and ${outcome.known.length - 10} more — \`list\` prints all.\n`);
        }
        return process.exit(EXIT_FAILED);
      default: {
        // A declaration, not a cast: a sixth cause fails the typecheck here instead of falling through.
        /** @type {never} */
        const unhandled = outcome;
        return fail(`unhandled share outcome: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  if (!outcome.changed) {
    // NOT a write, and said so. A command that reported success for a no-op would let a caller
    // believe the file's mtime moved.
    process.stdout.write(
      `share: ${outcome.id} is already ${outcome.to}. Nothing was written and ${path} is ` +
        `unchanged.\n`,
    );
    return;
  }

  await writeBack(path, outcome.document);
  process.stdout.write(`share: ${outcome.id}  ${outcome.from} → ${outcome.to}\n`);
  process.stdout.write(`share: wrote ${path}\n`);
  if (to === null) {
    process.stdout.write(
      `share: its address now answers as though nothing were there — which is the same answer\n` +
        `share: an id that never existed gets, so nobody can learn it exists by trying.\n`,
    );
  } else {
    process.stdout.write(`share: serve it and open ${LEAFLET_ROUTE}${encodeURIComponent(outcome.id)}\n`);
    if (to === "unlisted") {
      process.stdout.write(
        `share: unlisted means whoever holds that link may read it. It is not listed anywhere,\n` +
          `share: and a link is not a secret — anyone it is forwarded to has it too.\n`,
      );
    } else {
      process.stdout.write(
        `share: public additionally permits this leaflet to be LISTED outward, to readers who\n` +
          `share: are not you.\n`,
      );
    }
  }
  });

}

/* ------------------------------------------------------------------------------ main ---- */

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "list":
    await list(rest);
    break;
  case "share":
    await setOne(rest, "share");
    break;
  case "unshare":
    await setOne(rest, "unshare");
    break;
  case undefined:
  case "--help":
  case "-h":
  case "help":
    process.stdout.write(USAGE);
    process.exit(subcommand === undefined ? EXIT_USAGE : 0);
  // eslint-disable-next-line no-fallthrough -- process.exit above is terminal.
  default:
    process.stderr.write(`share: unknown subcommand "${subcommand}"\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
}
