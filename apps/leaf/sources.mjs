#!/usr/bin/env node
/**
 * Watched sources — the places your garden reads work from, so a harvest can run without you.
 *
 *   node apps/leaf/sources.mjs list
 *   node apps/leaf/sources.mjs watch   <path> [--subject "<name>"] [--identity <email>]…
 *   node apps/leaf/sources.mjs unwatch <path>
 *
 * WHY THIS EXISTS. `foliage grow` defaults `--repo` to `process.cwd()`, which is exactly right for
 * a person typing a command and useless for a scheduled one: launchd starts an agent with no
 * meaningful working directory, so an unattended harvest would read whatever happened to be at the
 * path it woke in. MEASURED before this file: `foliage install` wrote ONE agent, running `up` — the
 * viewer. Nothing in the product ever ran intake on its own, so "set it and forget it" produced a
 * page that never changed. A durable list of sources is the missing primitive underneath that.
 *
 * WHAT IS RESOLVED HERE, AND WHY IT IS RESOLVED NOW RATHER THAN AT HARVEST TIME. `grow` falls back
 * to `git config user.name` / `user.email` and EXITS 2 with a prompt when either is missing. A
 * prompt is a fine answer to somebody at a terminal and a silent death at 03:00. So this command
 * reads those values ONCE, while you are here to correct them, and writes them into the source —
 * `parseSourcesDocument` refuses a source without them, so an unharvestable entry cannot be
 * recorded in the first place.
 *
 * WATCHING IS NOT SHARING. `policy.mjs` explains why sharing and the rules governing it must not
 * live on the unauthenticated leaf server; watching is a different kind of act — it changes what
 * the garden READS on this machine, never who may read the garden — so nothing here can widen
 * exposure. Adding a source cannot publish anything: intake drafts candidates, a human reviews
 * them, and publication remains a separate, explicit act.
 *
 * THIS FILE OWNS THE WRITES. `foliage.mjs` composes and does not reimplement, so it delegates here
 * rather than editing the document itself, and every write goes through the same total parser.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY `grow` READS ONE SOURCE AND REFUSES TWO — a measured constraint, not a guess.
 *
 * `foliage grow` now reads this list when no --repo is given, and REFUSES when more than one
 * source is watched. The refusal is here rather than in a loop because the obvious loop — the
 * existing two commands once per watched source:
 *     intake.mjs   --repo <s> … --out <leaf>    --force
 *     harvest.mjs propose --repo <s> … --out <harvest> --force
 * THE FIRST IS SAFE AND THE SECOND DESTROYS DATA. `intake.mjs --force` explicitly no longer means
 * "replace the file" — its own header records that it READS the existing document and MERGES
 * (`mergeIntakeIntoLeaf`), after a measured incident where 59 leaflets became 12. So looping intake
 * accumulates correctly across sources.
 *
 * `harvest propose` does not. `apps/leaf/src/proposeDocument.ts` builds its output with
 * `candidates.map(...)` over THIS RUN'S drafts, looking up each id in the previous document only to
 * carry a REVIEW DECISION forward. A candidate that does not reappear in this run is simply absent
 * from the result. So a second propose, pointed at a second repository, keeps only the second
 * repository's candidates — and takes the first repository's pending reviews with it.
 *
 * The fix is NOT to make propose merge: a candidate that vanishes from a repository should vanish
 * from the queue, and a union would make every draft immortal. It is to let ONE propose run read
 * ALL the watched sources — `--repo` becomes `multiple: true` — so the run's candidate set is
 * the whole garden's, and carry-forward keeps working. THAT CHANGE IS BLOCKED ON AN OWNER
 * DECISION, and this is the part that took measuring: candidate ids are `git-cluster:<prefix>`,
 * the commit prefix alone, so per-source clustering needs the id to name its source — and
 * `reviewSubjectDigest` hashes the id itself, so every existing decision's digest changes and
 * every decision reopens. Nothing carries them across: every approved candidate a person
 * reviewed by hand. So `grow` refuses and names the cost instead.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");
const { NO_SOURCES, addSource, parseSourcesDocument, removeSource } = await import(
  "@foliage/photosynthesis"
).catch(explainFailedWorkspaceImport);
const { gitAbsence, gitNeeded } = await import("./src/gitNeeded.ts");

const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

/** The document's env override and default, named the same way the other garden documents are. */
export const SOURCES_ENV = "FOLIAGE_SOURCES";
const gardenDefault = () => join(process.env["FOLIAGE_GARDEN"] || join(homedir(), ".foliage"), "sources.json");
const DOCUMENT = process.env[SOURCES_ENV] || gardenDefault();
/**
 * The grow that reads `path` now. Through `foliage watch` (FOLIAGE_LAUNCHER set), node and the
 * launcher's full path with the garden, quoted to paste as is: an installed copy puts no `foliage`
 * on PATH. Run directly, the command's name.
 * @param {string} path
 */
const growNow = (path) => {
  const launcher = process.env["FOLIAGE_LAUNCHER"]?.trim();
  if (!launcher) return "foliage grow";
  const garden = process.env["FOLIAGE_GARDEN"]?.trim();
  return [process.execPath, launcher, "grow", "--repo", path, ...(garden ? ["--garden", garden] : [])]
    .map(shellWord).join(" ");
};
/** @param {string} word */
function shellWord(word) {
  return `'${word.replaceAll("'", "'\\''")}'`;
}
/**
 * `verb` (watch or unwatch) as a person runs it next, from any folder, with `<path>` to fill in:
 * through `foliage` (FOLIAGE_LAUNCHER set), node and the launcher's full path with the garden, as
 * foliage.mjs `nextCommand` spells it; run directly, node and this file's full path.
 * @param {string} verb
 */
const runNext = (verb) => {
  const launcher = process.env["FOLIAGE_LAUNCHER"]?.trim();
  const garden = process.env["FOLIAGE_GARDEN"]?.trim();
  const words = launcher ? [process.execPath, launcher, verb, ...(garden ? ["--garden", garden] : [])] : [process.execPath, fileURLToPath(import.meta.url), verb];
  return `${words.map(shellWord).join(" ")} <path>`;
};

/** @param {string} message @returns {never} */
const fail = (message) => {
  process.stderr.write(`sources: ${message}\n`);
  process.exit(EXIT_FAILED);
};

/**
 * Read the document, or the empty one.
 *
 * A MISSING FILE IS NOT AN ERROR — it is what every new install has, and "watching nothing" has to
 * be an ordinary state or the first `watch` would have to be preceded by an `init`. A file that
 * EXISTS and does not parse is a different answer entirely: it is refused with every issue named,
 * because silently starting from empty would discard sources somebody wrote.
 */
function load() {
  if (!existsSync(DOCUMENT)) return NO_SOURCES;
  let raw;
  try {
    raw = JSON.parse(readFileSync(DOCUMENT, "utf8"));
  } catch (err) {
    fail(`${DOCUMENT} is not valid JSON — ${(err instanceof Error ? err.message : String(err))}\nsources: NOTHING was changed.`);
  }
  const parsed = parseSourcesDocument(raw);
  if (!parsed.ok) {
    process.stderr.write(`sources: ${DOCUMENT} is not a valid sources document:\n`);
    for (const issue of parsed.issues) process.stderr.write(`sources:   ${issue.at} — ${issue.message}\n`);
    process.stderr.write(`sources: NOTHING was changed.\n`);
    process.exit(EXIT_FAILED);
  }
  return parsed.document;
}

/** Write it back, having re-parsed what we are about to write. */
/** @param {import("@foliage/photosynthesis").SourcesDocument} document */
function save(document) {
  // PARSE WHAT WE ARE ABOUT TO WRITE, not what we think we built. The in-memory value came from
  // functions this file trusts; the file is read later by a different process that trusts nothing,
  // so the only useful check is the one that process will run. A document that would not load is
  // caught here, while the previous one is still on disk.
  const check = parseSourcesDocument(JSON.parse(JSON.stringify(document)));
  if (!check.ok) {
    process.stderr.write(`sources: refusing to write a document that would not load back:\n`);
    for (const issue of check.issues) process.stderr.write(`sources:   ${issue.at} — ${issue.message}\n`);
    process.exit(EXIT_FAILED);
  }
  // TEMP THEN RENAME, the shape every other garden-document writer uses (`policy.mjs` writeBack).
  // This document is written by an unattended agent on a machine nobody is watching, so a crash
  // mid-write has to leave the previous document whole — never a truncated one that the next
  // scheduled harvest refuses to load, with nobody there to read the refusal.
  const temp = `${DOCUMENT}.tmp-${process.pid}`;
  try {
    // The garden folder, when this is its first write: owner-only, as `foliage` makes it. The mode
    // applies only to what this call makes; a folder that is already there is never chmod-ed.
    mkdirSync(dirname(DOCUMENT), { recursive: true, mode: 0o700 });
    writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temp, DOCUMENT);
  } catch (err) {
    fail(`could not write ${DOCUMENT}: ${(err instanceof Error ? err.message : String(err))}`);
  }
}

/** `git -C <path> config <key>`, trimmed, or "" — the same question `grow` asks, asked earlier. */
/** @param {string} path @param {string} key */
const gitConfig = (path, key) =>
  (spawnSync("git", ["-C", path, "config", key], { encoding: "utf8" }).stdout ?? "").trim();

const [command, ...rest] = process.argv.slice(2);

/** @param {string} message @returns {never} */
const usage = (message) => {
  process.stderr.write(`sources: ${message}\n`);
  process.exit(EXIT_USAGE);
};

/**
 * The one argument shape for every command that takes a path: `strict`, so a stray `--flag` is a
 * usage error and never a path. `unwatch` once read `process.argv[3]` raw, and `unwatch --path x`
 * went looking for a repository literally called `--path`.
 */
/** @param {Record<string, {type: "string" | "boolean", multiple?: boolean}>} options */
function pathArgs(options = {}) {
  try {
    const parsed = parseArgs({ args: rest, options, strict: true, allowPositionals: true });
    const given = parsed.positionals[0];
    if (given === undefined) usage(`${command} needs a path — ${runNext(command ?? "")}`);
    return { given, values: parsed.values };
  } catch (err) {
    return usage((err instanceof Error ? err.message : String(err)));
  }
}

switch (command) {
  case "list": {
    const { sources } = load();
    if (sources.length === 0) {
      // An honestly empty state, and the one action that changes it. Never a fabricated example.
      process.stdout.write(
        `sources: watching nothing yet — ${DOCUMENT} has no entries.\n` +
          `sources: add one with  ${runNext("watch")}\n`,
      );
      break;
    }
    process.stdout.write(`sources: ${sources.length} watched, from ${DOCUMENT}\n`);
    for (const s of sources) {
      // Report whether the path is still there. The parser cannot know this — it is pure — and a
      // source whose repository has been moved or deleted is the failure an unattended harvest
      // hits, so the one surface a person actually reads has to say it.
      const gone = existsSync(s.path) ? "" : "  MISSING";
      process.stdout.write(`sources:   ${s.kind}  ${s.path}${gone}\n`);
      process.stdout.write(`sources:        as ${s.subject} <${s.identities.join(", ")}>\n`);
    }
    break;
  }

  case "watch": {
    const { given, values } = pathArgs({ subject: { type: "string" }, identity: { type: "string", multiple: true } });
    /*
     * GIT DECIDES WHAT THIS PATH IS, and one tree gets exactly one spelling.
     *
     * Two earlier drafts got this wrong. The first made only RELATIVE paths absolute, so
     * `watch /p/repo` and `watch /p/repo/` recorded the same repository twice. The second used
     * `resolve()` for both — still only LEXICAL, it never follows a symlink — and the review
     * measured three disagreements with git that survived it:
     *   ACCEPTED a directory holding an empty `.git` that git calls "not a git repository";
     *   REFUSED a subdirectory of a real repository that git resolves happily;
     *   RECORDED TWICE one tree reached as `/tmp/x` and as `.`, because `process.cwd()` returns the
     *     PHYSICAL path — so the commonest invocation of all produced the duplicate, and `grow`
     *     refuses when more than one source is watched, silently disabling the unattended harvest.
     *
     * `git rev-parse --show-toplevel` answers all of it at once: it fails when the path is not in a
     * work tree, and returns the canonical toplevel — the same string from the root and from any
     * subdirectory, symlinks resolved. It is also the answer the thing that will actually READ this
     * history would give, which is the only answer worth storing.
     */
    // GIT FIRST, as `grow` asks it (`src/gitNeeded.ts`): a git that is missing, or the macOS
    // /usr/bin/git without the Command Line Tools, answers nothing about this path, so "not inside a
    // git repository" would send a person to another folder.
    const noGit = gitAbsence();
    if (noGit !== null) fail(gitNeeded("watch", noGit));
    const top = spawnSync("git", ["-C", given, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    if (top.status !== 0 || (top.stdout ?? "").trim() === "") {
      fail(
        `${given} is not inside a git repository.\n` +
          `sources: only git sources are supported today, and watching a path intake cannot read\n` +
          `sources:   would fail on every scheduled run instead of once, here, now.\n` +
          `sources: git said: ${(top.stderr ?? "").trim() || "(nothing)"}`,
      );
    }
    const path = top.stdout.trim();

    const subject = typeof values["subject"] === "string" ? values["subject"] : gitConfig(path, "user.name");
    const identities = Array.isArray(values["identity"]) ? values["identity"].filter((value) => typeof value === "string") : (gitConfig(path, "user.email") ? [gitConfig(path, "user.email")] : []);
    if (!subject) {
      fail(
        `no --subject given and ${path} has no git user.name.\n` +
          `sources: a scheduled harvest has nobody to ask, so this is settled now or not at all.`,
      );
    }
    if (identities.length === 0) {
      fail(
        `no --identity given and ${path} has no git user.email.\n` +
          `sources: pass --identity <email> — one per address you commit under there.`,
      );
    }

    // `addedAt` is stamped at the edge, which is where the clock belongs: the document module is
    // pure and total precisely so it can be tested without one.
    const added = addSource(load(), {
      kind: "git",
      path,
      subject,
      identities,
      addedAt: new Date().toISOString(),
    });
    if (!added.ok) fail(added.reason);
    save(added.document);
    process.stdout.write(
      `sources: watching ${path}\n` +
        `sources:   as ${subject} <${identities.join(", ")}>\n` +
        `sources: ${added.document.sources.length} source(s) in ${DOCUMENT}\n` +
        `sources: nothing was harvested — run  ${growNow(path)}  to read it now.\n`,
    );
    break;
  }

  case "unwatch": {
    const { given } = pathArgs();
    /*
     * CANONICAL WHEN GIT CAN ANSWER, LEXICAL WHEN IT CANNOT — and the fallback is the point.
     * `watch` may assume the tree exists; `unwatch` may not. Unwatching a repository that has been
     * DELETED or moved is exactly the case that has to keep working, and asking git about a path
     * that is gone fails. Try git first so the spelling matches what `watch` recorded, and fall
     * back to `resolve()` so a vanished tree can still be removed from the list.
     */
    const gone = spawnSync("git", ["-C", given, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const path =
      gone.status === 0 && (gone.stdout ?? "").trim() !== ""
        ? gone.stdout.trim()
        : resolve(process.cwd(), given);
    const removed = removeSource(load(), path);
    if (!removed.ok) fail(`${removed.reason}. Nothing was changed.`);
    save(removed.document);
    process.stdout.write(
      `sources: no longer watching ${path}\n` +
        `sources: ${removed.document.sources.length} source(s) remain in ${DOCUMENT}\n` +
        `sources: leaflets already drafted from it are untouched — this changes what is READ,\n` +
        `sources:   never what your garden already holds.\n`,
    );
    break;
  }

  default:
    usage(
      `usage —\n` +
        `sources:   node apps/leaf/sources.mjs list\n` +
        `sources:   node apps/leaf/sources.mjs watch   <path> [--subject "<name>"] [--identity <email>]…\n` +
        `sources:   node apps/leaf/sources.mjs unwatch <path>`,
    );
}
