#!/usr/bin/env node
/**
 * foliage — the local app, one command. Hermes-shaped: a daemon on loopback, a browser URL,
 * a durable garden in ~/.foliage, and a terminal UI that reads like the product.
 *
 *   foliage up                     the app on 127.0.0.1 (default :4174)
 *   foliage grow [--repo p]        intake + draft candidates from a repo into the garden
 *   foliage photos <dir>           draft candidates from a directory of images into the garden
 *                                  (passthrough to harvest.mjs propose-photos)
 *   foliage capture --url <local>  capture a real app still and private video; queue the still
 *   foliage review                 the one review queue: its count and /review; decides nothing
 *   foliage migrate-queue          one-time: land approvals the leaf could not take (dry run
 *                                  unless --apply; passthrough to harvest.mjs adopt)
 *   foliage share <id> [--as v]    give one leaflet a shareable address (passthrough to
 *                                  apps/leaf/share.mjs, defaulted onto the garden)
 *   foliage unshare <id>           take a leaflet's address away — back to private
 *   foliage policy <args…>         the rules your leaflets are judged by (passthrough to
 *                                  apps/leaf/policy.mjs, defaulted onto the garden)
 *   foliage status                 what the garden holds, measured from the documents
 *   foliage search <words> --garden p   find cited work in the garden you name
 *   foliage brain build|refresh|rebuild|status|remove|search|embed   this garden's local brain (passthrough to apps/leaf/brain.mjs)
 *   foliage canopy                private publish manager + read-only public leaf server
 *   foliage export [--out dir]     the static site (delegates to apps/leaf/export.mjs)
 *   foliage watch <path>           watch a repo, so a harvest can run without you
 *   foliage unwatch <path>         stop watching it
 *   foliage sources                what this garden watches
 *   foliage install                launchd agent for run-at-login (printed, never loaded)
 *
 * THIS FILE COMPOSES, IT DOES NOT REIMPLEMENT. Every write goes through the existing CLIs and
 * their gates. The review queue is decided at /review only; `review` here points there and
 * decides nothing. The TUI layer is presentation only.
 *
 * THE TUI CONTRACT (CLAUDE.md's UI contract applies to a terminal too): a label, not a
 * sentence; facts in aligned columns; the tier glyphs are ● verified ◐ pending ○ excluded and
 * colour never carries a fact alone. Honesty is not compressed away — child CLIs keep their
 * own voices (intake's signature report prints whole), sectioned under rules so the breakdown
 * is scannable. Colour is off when piped or NO_COLOR is set.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { constants as osConstants, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./apps/leaf/src/nodeFloor.mjs";

// The launcher is the FIRST thing a fresh user runs, so it is where the Node floor speaks:
// below 22.18 every child this file spawns dies linking .ts modules, and the raw loader
// stack would arrive wearing this file's name. Same pattern as the seven entries in 17ac4b4.
requireNodeFloor();

// A RELATIVE import, not the bare `@foliage/leaf` specifier apps/leaf's own scripts use: this
// file sits at the repo root, outside every workspace package, so it has no node_modules
// symlink to a workspace dependency to resolve against — and needs none, because leaf.ts is
// self-contained (no imports of its own). `leafletVisibility` is the ONE place the "absent
// means private" default lives; reading `.visibility` off a leaflet directly here would be a
// second, driftable copy of that default, which is exactly the mistake this import avoids.
const { leafletVisibility } = await import("./packages/leaf/src/leaf.ts");
// The parser the app judges the record by, from the same package by the same relative route
// (document.ts imports only its siblings): `up` and `status` count only a record the app would show.
const { parseLeafDocument } = await import("./packages/leaf/src/document.ts");

/*
 * THE SAME PARSER `foliage sources` REFUSES BAD DOCUMENTS WITH, reached by a RELATIVE path rather
 * than the package specifier apps/leaf/sources.mjs:73-75 uses (`await import("@foliage/photosynthesis")`).
 * This file sits at the repo root, and the root `package.json` has no dependency on
 * `@foliage/photosynthesis` — so on a normal clone a bare specifier fails cleanly, but MEASURED in
 * a workspace of several checkouts sharing one parent directory, Node's resolver walks past this
 * repo entirely and silently binds to whichever OTHER checkout's copy happens to sit in that
 * shared node_modules — here, one still missing this very parser. A relative import names the one
 * file this checkout actually has and cannot wander to a neighbour's.
 */
const { explainFailedWorkspaceImport } = await import("./apps/leaf/src/preflight.ts");
const { NO_SOURCES, gitLineage, parseSourcesDocument, parseHarvestDocument, orderReviewQueue, queuePaused, shownQueue } = await import("./packages/photosynthesis/src/index.ts").catch(
  explainFailedWorkspaceImport,
);
const { sourceRepoFor } = await import("./apps/leaf/src/sourceRepo.ts");
// Git first, one sentence: `grow` and `verify` ask it before reading a repository (`gitNeeded.ts`).
const { gitAbsence, gitNeeded } = await import("./apps/leaf/src/gitNeeded.ts");

const HOME = fileURLToPath(new URL(".", import.meta.url));

const argv = process.argv.slice(2).flatMap((arg) => arg.startsWith("--garden=") ? ["--garden", arg.slice("--garden=".length)] : [arg]);
let options = {};
const value = (n) => options[n.slice(2)];
const values = (n) => value(n) ?? [];

/* ---- the garden, overridable ------------------------------------------------------------- */
// ONE knob, FOUR paths: every subcommand already reads GARDEN/LEAF/HARVEST/POLICY (and injects
// FOLIAGE_LEAF/FOLIAGE_HARVEST/FOLIAGE_POLICY into its children from them), so overriding the
// root here re-routes grow, review, up, policy, status, export and install together — nothing
// else is threaded, and with the override unset the four resolve to the same literal
// `~/.foliage` paths as always.
//
// The flag is SPLICED OUT of argv, not merely read: `foliage policy` forwards `argv.slice(1)`
// verbatim to policy.mjs, whose strict parsers would dump a USAGE block on an option they never
// declared. A flag beats the environment — the same explicit-flag-wins order as `--subject` over
// git config below and `--policy` over FOLIAGE_POLICY in policy.mjs.
//
// A RELATIVE override resolves against cwd, ONCE, here — not refused, because the concierge use
// is exactly `FOLIAGE_GARDEN=subjects/rowan foliage grow …` from a study directory; and not left
// relative, because the children this file spawns would each re-resolve it against their own
// idea of cwd. Resolved before any child exists, every process in the run names the same garden.
//
// An EMPTY env var is unset, not "the cwd is the garden": `FOLIAGE_GARDEN= foliage up` exports
// "" and `"" ?? default` never falls through — the same ""-vs-nullish trap `grow`'s user.name
// fallback documents below. An explicitly typed empty `--garden` is refused instead: resolve("")
// is the cwd, and silently adopting whatever directory the shell sat in is a wrong garden agreed
// to quietly.
// EVERY occurrence is found, not just the first: a duplicate flag is two explicit answers to
// "which garden", and picking either silently is the same wrong-garden-agreed-to-quietly this
// block already refuses for "". Refused by name, with both values shown (F-017).
const gardenFlagAts = argv.flatMap((a, i) => (a === "--garden" ? [i] : []));
let gardenFlag;
if (gardenFlagAts.length > 1) {
  const given = gardenFlagAts.map((i) => argv[i + 1] ?? "(nothing)").join(", ");
  process.stderr.write(`foliage: --garden given ${gardenFlagAts.length} times (${given}) — one garden per run.\n`);
  process.exit(2);
}
if (gardenFlagAts.length === 1) {
  const gardenFlagAt = gardenFlagAts[0];
  gardenFlag = argv[gardenFlagAt + 1];
  if (gardenFlag === undefined || gardenFlag.trim() === "" || gardenFlag.startsWith("-")) {
    process.stderr.write("foliage: --garden needs a path.\n");
    process.exit(2);
  }
  argv.splice(gardenFlagAt, 2);
}
const gardenEnv = (process.env.FOLIAGE_GARDEN ?? "").trim();
const gardenOverride = gardenFlag ?? (gardenEnv === "" ? undefined : gardenEnv);
const GARDEN = gardenOverride === undefined ? join(homedir(), ".foliage") : resolve(gardenOverride);
const LEAF = join(GARDEN, "leaf.json");
const HARVEST = join(GARDEN, "harvest.json");
const POLICY = join(GARDEN, "policy.json");
const SOURCES = join(GARDEN, "sources.json");
const PUBLISHED = join(GARDEN, "published");
/**
 * The garden folder, made owner-only (700) by whichever command makes it first, as its brain/ and
 * workflow/ already are: it holds a person's record, drafts and settings. The mode applies only to
 * folders this call makes; one that is already there, made by the person or an earlier Foliage, is
 * left exactly as it is and never chmod-ed. Returns the first folder made, as `mkdirSync` does.
 */
const makeGarden = () => mkdirSync(GARDEN, { recursive: true, mode: 0o700 });

// Suggestions are executable from another directory and preserve the selected garden. They are
// node and this file's path, never a bare `foliage`: an installed copy puts no `foliage` on PATH.
const shellWord = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const launcher = [process.execPath, fileURLToPath(import.meta.url)].map(shellWord).join(" ");
const nextCommand = (command, args = []) => [process.execPath, fileURLToPath(import.meta.url), command, "--garden", GARDEN, ...args].map(shellWord).join(" ");
/** `nextCommand` followed by what the person fills in (`<path>`, `<id>`), left unquoted. */
const nextWith = (command, rest) => `${nextCommand(command)} ${rest}`;

const cmd = argv[0];

// Validate the entire command before creating directories, spawning a server, or writing.
// Policy retains its own strict parser; its help is intercepted here before delegation.
const commandOptions = {
  grow: ["repo", "subject", "identity", "watched"],
  capture: ["url", "seconds"],
  review: ["doc", "into", "resume"],
  "migrate-queue": ["repo", "apply"],
  up: ["port"],
  canopy: ["manage-port", "public-port"],
  verify: ["repo", "setup"],
  status: [],
  search: [],
  brain: [],
  "private-brain": [],
  export: ["out", "confirm", "video"],
  install: ["port", "every"],
  policy: [],
  integrations: [],
  photos: [],
  mcp: ["allow-achievements", "allow-presentation", "allow-search", "allow-brain", "capture-origin", "allow-demo-browser", "allow-project-test", "test-repo", "test-commit", "test-scenario", "test-image"],
  share: [],
  unshare: [],
  watch: [],
  unwatch: [],
  sources: [],
};
const usage = {
  grow: 'grow [--repo <path> | --watched] [--subject <name>] [--identity <email> ...]',
  capture: 'capture --url <local http URL> [--seconds <2–15>]',
  review: 'review [--doc <file>] [--into <leaf>] [--resume]',
  "migrate-queue": 'migrate-queue [--repo <path>] [--apply]',
  up: 'up [--port <1–65535>]',
  canopy: 'canopy [--manage-port <port>] [--public-port <port>]',
  verify: 'verify [--repo <path>] [--setup]',
  status: 'status',
  search: 'search <words> --garden <path> [--limit 1–10]',
  brain: 'brain build|refresh|rebuild|status|remove | brain search <words> [--limit 1–10] | brain embed --local ollama:<model> [--port <n>] | brain embed --off',
  "private-brain": 'private-brain list|receipts|serve --garden <path> [--agent-key <public.pem> --agent-label <name> --record <exact id> ... --bind <IPv4> --tls-cert <PEM> --tls-key <PEM>]',
  export: 'export [--out <directory>] [--confirm] [--video sha256:<digest> ...]',
  install: 'install [--port <1–65535>] [--every <seconds, at least 300>]',
  policy: 'policy show|check|deny|allow|drop <args...>',
  integrations: 'integrations import --garden <path> --input <file|-> [--into <leaf>] [--out <harvest>]',
  photos: 'photos <dir> [--describe-with-local-model]',
  mcp: 'mcp --garden <path> [--allow-achievements] [--allow-presentation] [--allow-search] [--allow-brain] [--capture-origin <local origin>] [--allow-demo-browser] [--allow-project-test --test-repo <absolute path> --test-commit <full SHA> --test-scenario <absolute JSON file> --test-image sha256:<image ID>]',
  share: 'share <leaflet-id> --as <visibility>',
  unshare: 'unshare <leaflet-id>',
  watch: 'watch <path> [--subject <name>] [--identity <email> ...]',
  unwatch: 'unwatch <path>',
  sources: 'sources',
};
/*
 * NO AMBIENT GARDEN for a command that hands the garden to another program (an assistant over
 * MCP, an agent's search session, an import adapter) or prints its private record: the garden is
 * named on THIS command line. FOLIAGE_GARDEN and ~/.foliage remain the documented default for the
 * app a person runs for themselves (up, grow, status…), never for these. One rule, one sentence;
 * `help` below says the same thing, then where to read more.
 */
/** A document this copy holds, by its full path, or null: an installed copy carries no docs/. */
const shippedDoc = (path) => { const at = join(HOME, path); return existsSync(at) ? at : null; };
const EXPLICIT_GARDEN = {
  mcp: () => {
    const doc = shippedDoc("docs/ASSISTANT-MCP.md");
    return doc ? ` Local MCP over stdio; setup: ${doc}` : ` Local MCP over stdio: your assistant host starts it with ${launcher} mcp --garden /absolute/garden, and its stdout carries MCP only.`;
  },
  "private-brain": () => { const doc = shippedDoc("docs/ASSISTANT-MCP.md"); return doc ? ` Setup: ${doc}` : ""; },
  integrations: () => {
    const doc = shippedDoc("docs/INTEGRATIONS.md");
    return doc ? ` Format: ${doc}` : " Input is a foliage-observations version 1 batch, described in docs/INTEGRATIONS.md of the Foliage source; this installed copy does not include it.";
  },
  search: () => "",
};
const ambientGardenRefusal = (label) => `foliage: ${label} requires one explicit --garden <path>; ambient garden settings are not used.\n`;
/** True when refused: no --garden was typed, so nothing has been read, spawned or written. */
const refusedAmbientGarden = (label) => {
  if (gardenFlag !== undefined) return false;
  process.stderr.write(ambientGardenRefusal(label));
  process.exitCode = 2;
  return true;
};
const help = (command) => {
  const explicit = Object.hasOwn(EXPLICIT_GARDEN, command);
  process.stdout.write(`Usage: node foliage.mjs ${usage[command]}${explicit ? "" : " [--garden <path>]"}\n\n`);
  process.stdout.write(explicit ? `Select --garden explicitly; ambient garden settings are not used.${EXPLICIT_GARDEN[command]()}\n` :
    `Garden: ${GARDEN}\n--garden overrides FOLIAGE_GARDEN; relative paths use your current directory.\n`);
  if (command === "grow") {
    process.stdout.write("--repo defaults to the current directory.\n");
    process.stdout.write("--identity repeats; omitted identity/subject use the source repo's git user.email/user.name. Matching email is not verified authorship.\n");
  }
  if (command === "capture") process.stdout.write("Records an actual local page into a private still and MP4. Both enter one private Review decision; nothing is published. Requires local Chrome and ffmpeg.\n");
  if (command === "review") process.stdout.write("Prints the open count and /review. Decides nothing.\n--resume retries promotion of saved approvals; --doc and --into override the garden documents for it.\n");
  if (command === "migrate-queue") process.stdout.write("One-time. Prints what would land and writes nothing; --apply writes, keeping backups beside both files.\n--repo defaults to the harvest's recorded repository, else the one watched source, else the one enabled workflow source.\n");
  if (command === "export") process.stdout.write("Writes a local copy (default: <garden>/site). --video explicitly selects a reviewed clip from shared work; it can repeat twice. --confirm accepts titles flagged for email addresses. Copies cannot be centrally withdrawn.\n");
  if (command === "canopy") process.stdout.write("Starts a loopback manager (:4180) and reader (:4173). This is local publication, not a deployed managed-hosting service.\n");
  if (command === "verify") process.stdout.write("Reads signing configuration; only --setup changes it for future commits in this repo.\n");
  if (command === "install") process.stdout.write("Writes a macOS launchd plist; prints the load command without loading it.\n");
  if (command === "photos") process.stdout.write("Reads only <dir> and the folders inside it. Images are stored in the garden's media folder with their metadata (location included) removed.\nCandidates join the queue at /review. --describe-with-local-model asks a model on 127.0.0.1 only.\n");
  if (command === "policy") process.stdout.write("show/check read rules; deny/allow/drop change them. Arguments are validated by apps/leaf/policy.mjs.\n");
  if (command === "brain") process.stdout.write("build makes this garden's brain from its record or brings it up to date; refresh updates an existing one; rebuild makes a new one and swaps it in; status prints one line; remove deletes it; search reads your record through it, or without it and says why. embed --local turns on local embeddings with a model your own Ollama on this machine already holds (never downloaded; cloud models refused), so foliage search reads the brain; embed --off goes back to keyword search. The brain is derived data at <garden>/brain/ and runs offline from the gbrain in vendor/: staged in a checkout, or installed with Foliage from its download.\n");
  if (command === "private-brain") process.stdout.write("Owner-run search session for exact local records and one Ed25519 agent key. Remote binding requires explicit TLS; nothing starts automatically. Type revoke to end it.\n");
};
// `help` is a command, as the table at the end lists it: alone it prints that table, as --help
// does, and `help <command>` prints what `<command> --help` prints. Nothing is read or written.
if (cmd === "help") {
  const about = argv.length === 2 && !["--help", "-h"].includes(argv[1]) ? argv[1] : undefined;
  if (argv.length > 2) {
    process.stderr.write("foliage: help takes one command at most, as in help grow.\n");
    process.exit(2);
  }
  if (about !== undefined && !Object.hasOwn(usage, about)) {
    process.stderr.write(`foliage: unknown command ${JSON.stringify(about)}. Use --help.\n`);
    process.exit(2);
  }
  if (about !== undefined) { help(about); process.exit(0); }
  argv.splice(1);
}
if (cmd !== undefined && cmd !== "--help" && cmd !== "-h" && cmd !== "help" && !Object.hasOwn(commandOptions, cmd)) {
  process.stderr.write(`foliage: unknown command ${JSON.stringify(cmd)}. Use --help.\n`);
  process.exit(2);
}
if (["policy", "search", "brain", "private-brain", "share", "unshare", "watch", "unwatch", "sources", "integrations", "photos"].includes(cmd)) {
  if (argv.includes("--help") || argv.includes("-h")) { help(cmd); process.exit(0); }
} else if (Object.hasOwn(commandOptions, cmd ?? "")) {
  try {
    const schema = Object.fromEntries(commandOptions[cmd].map((name) => [name, {
      type: ["setup", "confirm", "resume", "watched", "apply", "allow-achievements", "allow-presentation", "allow-search", "allow-brain", "allow-demo-browser", "allow-project-test"].includes(name) ? "boolean" : "string",
      ...(["identity", "video"].includes(name) ? { multiple: true } : {}),
    }]));
    const parsed = parseArgs({ args: argv.slice(1), options: { ...schema, help: { type: "boolean", short: "h" } }, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name) && !["identity", "video"].includes(token.name)) throw new Error(`--${token.name} given more than once`);
      seen.add(token.name);
      if (typeof token.value === "string" && token.value.trim() === "") throw new Error(`--${token.name} needs a nonempty value`);
    }
    options = parsed.values;
    if (options.help) { help(cmd); process.exit(0); }
    for (const name of ["port", "manage-port", "public-port"]) {
      if (options[name] !== undefined && (!/^\d+$/.test(options[name]) || Number(options[name]) < 1 || Number(options[name]) > 65535)) {
        throw new Error(`--${name} must be an integer from 1 to 65535`);
      }
    }
  } catch (err) {
    process.stderr.write(`foliage: ${err instanceof Error ? err.message : String(err)}. Use ${cmd} --help.\n`);
    process.exit(2);
  }
} else if (argv.length > 1) {
  process.stderr.write("foliage: unexpected arguments after help. Use <command> --help.\n");
  process.exit(2);
}

/* ---- colour, honest about where it works -------------------------------------------------- */
const TTY = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = paint("2"), bold = paint("1"), green = paint("38;5;149"), warm = paint("38;5;137"), mute = paint("38;5;108");
const GLYPH = { verified: green("●"), pending: mute("◐"), excluded: warm("○") };
const rule = (label) => dim(`── ${label} ${"─".repeat(Math.max(2, 46 - label.length))}`);
const banner = () => process.stdout.write(`\n${green("❧")} ${bold("FOLIAGE")} ${dim("· a leaf, from your work")}\n\n`);
// At least one space after the label, so a long command name never runs into its text.
const row = (label, text) => process.stdout.write(`  ${dim(label.padEnd(8))} ${text}\n`);

const run = (script, args, env = {}) => {
  const r = spawnSync(process.execPath, [join(HOME, script), ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
};
/** Same gate, quiet pipe — used by `review --resume` so a failed promotion can be re-voiced. */
const runQuiet = (script, args) => {
  const r = spawnSync(process.execPath, [join(HOME, script), ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
/**
 * KEEP THE BRAIN CURRENT (unit 38, build order item 5): after a command that writes this garden's
 * record, a refresh of its brain starts in the background and the command answers and exits as
 * before. Only a garden whose brain is behind its record starts one (`brainUpkeep.ts`); a refresh
 * that fails leaves the brain behind with its cause, and nothing here can fail the command.
 */
const refreshBrainLater = async () => {
  try { await (await import("./apps/leaf/src/brainUpkeep.ts")).startBrainRefresh(GARDEN); }
  catch { /* the brain is derived data; the command's own outcome stands */ }
};

const portFree = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
/**
 * Where the one review queue is decided: a route of this garden's app, never a fixed host and
 * port, since `up --port` and a second garden move the app.
 */
const REVIEW_ROUTE = "/review";

/** A workflow document's sources as `{ path, enabled }`, dropping anything malformed. */
const workflowSourcesOf = (state) =>
  (Array.isArray(state?.sources) ? state.sources : [])
    .filter((s) => s !== null && typeof s === "object" && typeof s.enabled === "boolean" && typeof s.path === "string")
    .map((s) => ({ path: s.path, enabled: s.enabled }));

/**
 * The watched-sources document, through the SAME total parser `foliage sources` refuses bad
 * documents with — never a raw `readJson`. Before this, `grow` (twice) and `status` (once) read
 * `sources.json` directly: a document `foliage sources` would REFUSE was still harvested here,
 * and invalid JSON crashed with a raw stack instead of the parser's own named issues. Refused by
 * the same rule now, before anything else runs — every call site below is upstream of any write.
 */
const readSources = () => {
  if (!existsSync(SOURCES)) return NO_SOURCES;
  let raw;
  try {
    raw = JSON.parse(readFileSync(SOURCES, "utf8"));
  } catch (err) {
    process.stderr.write(`foliage: ${SOURCES} is not valid JSON — ${err.message}\n`);
    process.exit(2);
  }
  const parsed = parseSourcesDocument(raw);
  if (!parsed.ok) {
    process.stderr.write(`foliage: ${SOURCES} is not a valid sources document:\n`);
    for (const issue of parsed.issues) process.stderr.write(`foliage:   ${issue.at} — ${issue.message}\n`);
    process.exit(2);
  }
  return parsed.document;
};

/**
 * The summary rows' counts. A document that is there but will not read, parse or validate is
 * reported in `unreadable` ("json", "read" or "invalid") rather than thrown: `up` must still start,
 * because a stack trace in the terminal names neither the file nor the fix. Every row that would
 * have counted it says so instead — /review for the drafts, and for the record its own file, or
 * Portfolio once it parses (Portfolio lists what to fix in a record that parses). Both documents
 * pass the same parsers the app judges them by, so a file the app refuses is never counted here.
 */
const counts = () => {
  const out = { leaf: null, awaiting: null, paused: 0, unreadable: { leaf: null, harvest: null } };
  const readable = (path, name, parse) => {
    if (!existsSync(path)) return null;
    let raw;
    try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (error) { out.unreadable[name] = error instanceof SyntaxError ? "json" : "read"; return null; }
    if (!parse(raw).ok) { out.unreadable[name] = "invalid"; return null; }
    return raw;
  };
  const l = readable(LEAF, "leaf", parseLeafDocument);
  if (l) {
    const by = {};
    // Absent means private, and `leafletVisibility` is the one place that default is applied —
    // never `x.visibility` read raw, which would silently disagree with the domain the moment
    // a second default-applying spot existed.
    const visibility = { private: 0, unlisted: 0, public: 0 };
    for (const x of l.leaflets) {
      by[x.tier] = (by[x.tier] ?? 0) + 1;
      visibility[leafletVisibility(x)]++;
    }
    out.leaf = { subject: l.subject, total: l.leaflets.length, by, visibility };
  }
  const h = readable(HARVEST, "harvest", parseHarvestDocument);
  if (h) {
    const queue = openInQueue(h);
    out.awaiting = queue.open.length;
    out.paused = queue.paused;
  }
  return out;
};
/** What a record that did not count says, and what to do about it, by `counts().unreadable.leaf`. */
const LEAF_TROUBLE = { json: "isn't valid JSON", read: "can't be read", invalid: "needs repair" };
/** The drafts row when `counts().unreadable.harvest` is set. */
const draftsTrouble = (cause) => `drafts ${cause === "invalid" ? "need repair" : "can't be read"}`;

/**
 * The one queue's open candidates: the same set and count /review shows. While every workflow
 * source is paused, the undecided git drafts wait out of sight. The order is by date only, not
 * /review's: Jev's marks live in workflow.json and only /review reads them. A document the gate
 * refuses is counted raw, in file order (`counts` reports it as needing repair before it gets
 * here); a candidates value that is not a list of objects counts nothing rather than throwing.
 */
function openInQueue(h) {
  const raw = (Array.isArray(h?.candidates) ? h.candidates : []).filter((c) => c?.review?.state === "candidate");
  const parsed = parseHarvestDocument(h);
  if (!parsed.ok) return { open: raw, paused: 0 };
  let paused = false;
  try { paused = queuePaused(workflowSourcesOf(readJson(join(GARDEN, "workflow", "workflow.json")))); } catch { paused = false; }
  const queue = shownQueue(parsed.harvest.candidates, paused);
  const byId = new Map(raw.map((c) => [c.id, c]));
  const open = orderReviewQueue(queue.shown, new Map()).open.flatMap((entry) => byId.has(entry.candidate.id) ? [byId.get(entry.candidate.id)] : []);
  return { open, paused: queue.hidden };
}
/** "Paused N" beside a count, when the queue holds drafts it is not showing. */
const pausedNote = (n) => (n > 0 ? `  ${dim(`Paused ${n}`)}` : "");
const tierLine = (by) =>
  `${GLYPH.verified} ${by.verified ?? 0} verified   ${GLYPH.pending} ${by.pending ?? 0} pending   ${GLYPH.excluded} ${by.excluded ?? 0} excluded`;
const shareLine = (visibility) =>
  `${visibility.public} public   ${visibility.unlisted} unlisted   ${visibility.private} private`;

switch (cmd) {
  case "capture": {
    const url = value("--url")?.trim();
    const seconds = Number(value("--seconds") ?? "6");
    if (!url || !Number.isInteger(seconds) || seconds < 2 || seconds > 15) {
      process.stderr.write("foliage: capture needs --url <local http URL> and --seconds between 2 and 15.\n");
      process.exitCode = 2; break;
    }
    const { loadLeafDocument } = await import("./apps/leaf/src/leafDocument.ts");
    const owner = await loadLeafDocument({ FOLIAGE_LEAF: LEAF });
    if (!owner.ok) {
      process.stderr.write(`foliage: private record unavailable (${owner.cause}). Start or repair this garden's record before capturing.\n`);
      process.exitCode = 1; break;
    }
    const { captureRootFor } = await import("./apps/leaf/src/captureLibrary.ts");
    const { captureLocalWebDemo } = await import("./tools/capture/capture.mjs");
    const captured = await captureLocalWebDemo({ url, outputDir: captureRootFor(LEAF), durationSeconds: seconds });
    if (!captured.ok) {
      process.stderr.write(`foliage: capture failed (${captured.cause}): ${captured.detail}\n`);
      process.exitCode = 1; break;
    }
    row("DEMO", captured.videoPath);
    row("STILL", captured.screenshotPath);
    row("RECEIPT", captured.receiptPath);
    const { queueCapturedDemo } = await import("./apps/leaf/src/captureReview.ts");
    try {
      const pageTitle = captured.receipt.source.pageTitle;
      const { RATING_SHAPED } = await import("./packages/leaf/src/publishPolicy.ts");
      const queued = await queueCapturedDemo({ captureRoot: captureRootFor(LEAF), captureId: captured.receipt.id, leafPath: LEAF, harvestPath: HARVEST, title: pageTitle && !RATING_SHAPED.test(pageTitle) ? pageTitle : "Captured app demo" });
      row("REVIEW", queued.queued ? `Added ${queued.candidateId}` : `Already present ${queued.candidateId}`);
      row("NEXT", nextCommand("review"));
    } catch (error) {
      process.stderr.write(`foliage: demo is private at ${captured.directory}, but its still and clip did not reach Review: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    await refreshBrainLater();
    break;
  }
  case "up": {
    makeGarden();
    const port = Number(value("--port") ?? 4174);
    if (!(await portFree(port))) {
      // Refused rather than auto-hopped: a launcher that silently picks another port prints a
      // URL the user's bookmark does not match, and this project once measured a stranger's
      // server on a port it assumed was its own.
      process.stderr.write(`foliage: port ${port} is taken — maybe by a Foliage you started earlier. Use --port <n> to run beside it.\n`);
      process.exit(1);
    }
    banner();
    const c = counts();
    if (c.leaf) {
      row("LEAF", `${bold(c.leaf.subject)}  ${dim("·")}  ${c.leaf.total} leaflets`);
      row("", tierLine(c.leaf.by));
    } else if (c.unreadable.leaf === "json") row("LEAF", `${warm("isn't valid JSON")}  ${dim(`→ correct ${LEAF}, then reload`)}`);
    else if (c.unreadable.leaf === "invalid") row("LEAF", `${warm(LEAF_TROUBLE.invalid)}  ${dim(`→ /leaf lists what to fix in ${LEAF}`)}`);
    else if (c.unreadable.leaf) row("LEAF", `${warm("can't be read")}  ${dim(`→ check ${LEAF} and its permissions`)}`);
    else row("LEAF", dim(`none yet — ${nextWith("grow", "--repo <path>")}`));
    if (c.unreadable.harvest) row("REVIEW", `${warm(draftsTrouble(c.unreadable.harvest))}  ${dim(`→ ${REVIEW_ROUTE} shows what to repair in ${HARVEST}`)}`);
    else if (c.awaiting || c.paused) row("REVIEW", `${c.awaiting} to review${pausedNote(c.paused)}  ${dim(`→ ${REVIEW_ROUTE}`)}`);
    row("APP", bold(`http://127.0.0.1:${port}/`));
    process.stdout.write("\n");
    // FOLIAGE_POLICY joins FOLIAGE_LEAF/FOLIAGE_HARVEST here for the same reason both of those
    // are set: without it, the server's own default resolves the policy document relative to
    // wherever this CLI is installed (`apps/leaf/policy.json`, whatever a checkout happens to
    // hold) rather than the garden every other document already lives in. Every studio page reads
    // the policy through one loader (`policyDocument.ts`), so the two never disagree WITHIN a run
    // — but an app that quietly judges leaflets by a stray repo file instead of the garden's own
    // rules is a wrong answer agreed upon consistently, not a right one.
    // D8: portfolio work dates read one repository, and only one named without guessing (see
    // apps/leaf/src/sourceRepo.ts). An unreadable document here answers nothing; `up` still starts.
    const quietly = (read) => { try { return read(); } catch { return null; } };
    const sourceRepo = sourceRepoFor({
      env: process.env,
      harvestRepo: quietly(() => { const repo = readJson(HARVEST)?.repo; return typeof repo === "string" ? repo : undefined; }) ?? undefined,
      watched: quietly(() => {
        if (!existsSync(SOURCES)) return [];
        const parsed = parseSourcesDocument(JSON.parse(readFileSync(SOURCES, "utf8")));
        return parsed.ok ? parsed.document.sources.map((s) => s.path) : null;
      }),
      workflowSources: quietly(() => workflowSourcesOf(readJson(join(GARDEN, "workflow", "workflow.json")))),
    });
    const child = spawn(process.execPath, [join(HOME, "apps/leaf/server.mjs")], {
      stdio: "inherit",
      env: {
        ...process.env,
        ...(sourceRepo === undefined ? {} : { FOLIAGE_SOURCE_REPO: sourceRepo }),
        FOLIAGE_LEAF: LEAF,
        FOLIAGE_HARVEST: HARVEST,
        FOLIAGE_WORKFLOW_DIR: join(GARDEN, "workflow"),
        FOLIAGE_HOSTED_STATUS: join(GARDEN, "hosted", "status.json"),
        FOLIAGE_POLICY: POLICY,
        // /publish prints `share` and `export` for pasting; with these it spells them as
        // `nextCommand` does, so they run from any directory against this garden.
        FOLIAGE_LAUNCHER: fileURLToPath(import.meta.url),
        FOLIAGE_GARDEN: GARDEN,
        PORT: String(port),
      },
    });
    // THE LAUNCHER STOPS WHAT IT STARTED. A terminal's Ctrl-C reaches the whole process group, but
    // a process manager, `kill <pid>` or a script holding `$!` signals this pid alone — and with no
    // handler this process died on the spot, leaving the server re-parented to pid 1, still on the
    // port and still holding the garden's workflow lock, so the next `up` said the port was taken.
    // Every stop is passed on as SIGTERM, whatever arrived: the server closes its workflow on
    // SIGTERM, has no SIGHUP handler (it would die holding the lock), and handles SIGINT once —
    // after a terminal's group Ctrl-C, a second SIGINT from here would kill it mid-close. `on`, not
    // `once`: a repeated signal must not kill the launcher and orphan the server after all.
    // Bounded: a server still running after the grace period is killed. One line on the way out,
    // so a log tells a requested stop from a crash.
    const STOP_GRACE_MS = 5_000;
    let stopping = null; // the signal this launcher received, once it has asked the server to stop
    let forced = false;
    const stop = (signal) => {
      if (stopping !== null) return;
      stopping = signal;
      child.kill("SIGTERM");
      setTimeout(() => { forced = child.kill("SIGKILL"); }, STOP_GRACE_MS);
    };
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(signal));
    child.on("exit", (code, signal) => {
      const ended = code === null ? `server stopped by signal ${signal}` : `server exited with code ${code}`;
      if (stopping === null) process.stderr.write(`foliage: ${ended}\n`);
      else {
        const how = forced && signal === "SIGKILL" ? `the server did not stop within ${STOP_GRACE_MS / 1000} s and was killed` : code === 0 ? null : ended;
        process.stdout.write(`foliage: stopped (${stopping})${how === null ? "" : ` — ${how}`}\n`);
      }
      process.exit(code ?? 128 + (osConstants.signals[signal] ?? 0));
    });
    break;
  }

  case "grow": {
    /*
     * GIT FIRST. Everything below asks git (which repository, whose email, whose name, then the
     * history itself), and a git that is missing answers none of it: the first refusal used to be
     * "the repo has no git user.email", which sent a person to fix a setting when git itself was
     * absent. Asked once, before anything is read or written. A Mac without the Command Line Tools
     * has a /usr/bin/git that only exits non-zero, so a git that does not run counts as missing.
     * `watch`, `verify` and the /workflow Sources API ask the same and say the same (`gitNeeded.ts`).
     */
    const noGit = gitAbsence();
    if (noGit !== null) {
      process.stderr.write(`foliage: ${gitNeeded("grow", noGit)}\n`);
      process.exit(2);
    }
    /*
     * WHERE A HARVEST READS FROM, WHEN NOBODY SAID.
     *
     * `--repo` is unchanged and still wins: a person standing in a repository typing a command
     * means that repository. What changed is the answer when they said nothing. It used to be
     * `process.cwd()` — right at a terminal, meaningless under a scheduler, which has no useful
     * working directory. Scheduled runs use `--watched`, so the garden's own watched list answers
     * independently of wherever the garden lives. Interactive runs retain cwd-first selection.
     *
     * TWO OR MORE WATCHED SOURCES IS REFUSED, and the refusal is the honest part of this change.
     * Candidate ids are `git-cluster:<prefix>` (`git-cluster:docs`, `git-cluster:chore` …) — the
     * conventional-commit prefix and nothing else. Two repositories that both carry `docs:` commits
     * would collide on one id and merge unrelated projects into a single candidate. Qualifying the
     * id by source fixes that and CANNOT be done quietly: `reviewSubjectDigest` hashes the id
     * itself, so every existing decision's digest changes with it and all of them reopen: every
     * approved candidate a person actually reviewed. Refusing costs a message; guessing costs their work.
     */
    /*
     * ONE QUESTION, ASKED OF GIT: what repository is this, and what is its one spelling?
     *
     * `git rev-parse --show-toplevel` answers all three things this command needs — is the path in
     * a work tree, what is the tree's canonical path, and does a SUBDIRECTORY resolve to the same
     * answer as its root. An earlier draft asked them separately with `existsSync(join(p, ".git"))`
     * and `resolve()`, and the review measured three disagreements with git: a directory holding an
     * empty `.git` was ACCEPTED, a subdirectory of a real repository was REFUSED, and two spellings
     * of one tree (`/tmp/x` and `/private/tmp/x`, which is what `.` becomes because `process.cwd()`
     * returns the physical path) were recorded as two repositories. `resolve()` is lexical; it never
     * follows a symlink. Git does, and git is the thing that will actually read the history.
     */
    const toplevelOf = (path) => {
      const r = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
      const out = (r.stdout ?? "").trim();
      return r.status === 0 && out !== "" ? out : null;
    };

    const watchedOnly = argv.includes("--watched");
    let repo = value("--repo");
    if (watchedOnly && repo !== undefined) {
      process.stderr.write("foliage: --watched and --repo select different source modes; use one.\n");
      process.exit(2);
    }
    // One snapshot supplies both the path and its declared identity; a concurrent watch/unwatch
    // must not make the source selection and identity lookup read different documents.
    const watched = readSources().sources;
    if (repo === undefined) {
      /*
       * INTERACTIVE GROW PREFERS A REPOSITORY IN THE WORKING DIRECTORY, and the watched list
       * answers when there is no repository to stand in. Asked FIRST, because a person standing
       * in a repository means that repository whatever else the
       * garden watches: an earlier draft evaluated the "more than one watched source" refusal
       * before this test, so `foliage grow` typed inside a real repository exited 2 the moment a
       * second source was watched — behaviour that works on the base branch.
       */
      // A garden may sit inside a repository. A scheduler standing there does not consent to
      // harvesting that enclosing repository, so only interactive runs consult cwd.
      const here = watchedOnly ? null : toplevelOf(process.cwd());
      if (here !== null) {
        repo = here;
      } else {
        if (watchedOnly && watched.length === 0) {
          process.stderr.write(`foliage: no watched source — run ${nextWith("watch", "<path>")} before a scheduled harvest.\n`);
          process.exit(2);
        }
        if (watched.length > 1) {
          process.stderr.write(
            `foliage: ${watched.length} watched sources, and grow can only read one.\n` +
              `foliage: candidate ids are the commit prefix alone (git-cluster:docs, git-cluster:chore),\n` +
              `foliage:   so two repositories sharing a prefix would merge into one candidate. Making the\n` +
              `foliage:   id name its source reopens every decision already made, because the review\n` +
              `foliage:   digest is computed over the id. That is a decision about your ` +
              `${(readJson(HARVEST)?.candidates ?? []).length} candidate(s),\n` +
              `foliage:   not a detail this command may take for you.\n` +
              `foliage: name one with  ${nextWith("grow", "--repo <path>")}  ${dim(`· or  ${nextWith("unwatch", "<path>")}`)}\n`,
          );
          process.exit(2);
        }
        repo = watched[0]?.path ?? process.cwd();
      }
    }
    // Canonical from here on, so what is compared, recorded and reported is one spelling of one
    // tree. A path git cannot resolve is left as given — `intake.mjs` reports that with its own
    // named cause, which is a better message than anything this file would invent.
    repo = toplevelOf(repo) ?? repo;

    let ids = values("--identity");
    /*
     * A WATCHED SOURCE ANSWERS FOR ITSELF. `sources.mjs` settled the subject and identities while
     * somebody was present to correct them, precisely so this path never reaches the git-config
     * fallback below — that fallback EXITS 2 with a prompt, which is a fine answer at a terminal
     * and a silent death at 03:00 with nobody reading the log.
     */
    /*
     * MATCHED THE SAME WAY THE GUARD MATCHES, or the two disagree about one repository.
     *
     * The review predicted this exactly: the lookup compared paths with `===` while the guard
     * compared them canonically, so a source stored as `/var/…` and a repo resolved to
     * `/private/var/…` were the SAME tree to the guard and DIFFERENT to the identity reader — the
     * subject and addresses silently fell back to git config, which is the unattended failure this
     * whole document exists to remove. Both sides ask git now. Stored paths are canonical from
     * `watch` onward, and canonicalizing here as well means a document written before that is still
     * matched rather than quietly ignored.
     */
    const source = watched.find((s) => (toplevelOf(s.path) ?? s.path) === repo);
    if (ids.length === 0 && source !== undefined) ids = source.identities;
    if (ids.length === 0) {
      const email = spawnSync("git", ["-C", repo, "config", "user.email"], { encoding: "utf8" }).stdout?.trim();
      if (email) ids = [email];
    }
    // Same shape as the --identity fallback just above: `??` alone is the wrong operator here —
    // `git config user.name` returns an EMPTY STRING, not undefined, when nothing is configured,
    // and `?? "You"` never sees it because "" is not nullish. That silently passed `--subject ""`
    // to intake.mjs, which treats a blank subject as MISSING and dumps its full USAGE block —
    // the wrong response to a repo that just hasn't set its git identity yet.
    let subject = value("--subject");
    if (subject === undefined && source !== undefined) subject = source.subject;
    if (subject === undefined) {
      const gitName = spawnSync("git", ["-C", repo, "config", "user.name"], { encoding: "utf8" }).stdout?.trim();
      if (gitName) subject = gitName;
    }
    // BOTH MISSING IS ONE ANSWER: a newcomer whose git has neither setting was refused for the email,
    // then again for the name. Asked before the garden folder exists, so a refusal leaves none behind.
    if (ids.length === 0 || subject === undefined) {
      process.stderr.write(ids.length === 0 && subject === undefined
        ? "foliage: no --identity or --subject given, and the repo has no git user.email or user.name. Pass --identity <email> --subject \"<name>\".\n"
        : ids.length === 0 ? "foliage: no --identity given and the repo has no git user.email. Pass --identity <email>.\n"
        : "foliage: no --subject given and the repo has no git user.name. Pass --subject \"<name>\".\n");
      process.exit(2);
    }
    const idArgs = ids.flatMap((i) => ["--identity", i]);
    banner();
    row("REPO", repo);
    row("AS", `${subject} ${dim(`<${ids.join(", ")}>`)}`);
    /*
     * A HARVEST NEVER SILENTLY DISCARDS A HUMAN DECISION — CHECKED BEFORE ANYTHING IS WRITTEN.
     *
     * A garden holds ONE harvest, and `propose --force` writes the candidate set THIS run drafted.
     * Harvesting a different repository therefore replaces the queue — and because candidate ids
     * are the commit prefix alone, an id from repository A COLLIDES with a decided one from
     * repository B: the id survives, the digest differs, and the decision is silently reopened.
     * MEASURED: an approval made against repository B came back as an undecided candidate after a
     * harvest of repository A.
     *
     * THE DISCRIMINATOR IS THE REPOSITORY, NOT THE REOPEN. A reopen is legitimate whenever the SAME
     * repository's material changed — that is the whole of carry-forward, and refusing it would
     * break every ordinary re-harvest, which is exactly what an unattended one is. So the guard
     * asks the harvest where it came from; the document records that now.
     *
     * IT RUNS BEFORE `intake`, and that ordering is the fix for a defect the review measured. The
     * guard used to sit after it, so a run that printed "REFUSED — harvest.json was NOT changed"
     * had ALREADY merged the other repository's leaflets into `leaf.json` — the employer-facing
     * document — permanently, and said nothing about it. A refusal that is true about one file and
     * silent about the one it just changed is worse than no refusal.
     *
     * ABSENT IS UNCHECKED, never "it matches": a harvest written before this field existed carries
     * no repo, and this refuses to invent one. Such a document is left alone rather than defended,
     * because guessing here would refuse a run somebody legitimately wants.
     */
    let existing = null;
    if (existsSync(HARVEST)) {
      try {
        const parsed = parseHarvestDocument(readJson(HARVEST));
        if (!parsed.ok) throw new Error(parsed.issues.map(issue => `${issue.at}: ${issue.message}`).join("; "));
        existing = parsed.harvest;
      } catch (error) {
        process.stderr.write(`foliage: REFUSED — cannot read the prior harvest: ${error instanceof Error ? error.message : String(error)}\nfoliage: prior bytes were preserved; intake and candidate drafting did not start.\n`);
        process.exit(3);
      }
    }
    const decided = (existing?.candidates ?? []).filter((x) => x.review?.state && x.review.state !== "candidate");
    // A git draft still waiting for a decision is the person's queue too. The git merge withdraws a
    // draft whose commits the repository it reads does not hold, so another repository's harvest
    // would replace it as silently as it once reopened a decision: guarded the same way.
    const waiting = (existing?.candidates ?? []).filter((x) => x.review?.state === "candidate" && gitLineage(String(x.id)) !== null);
    const from = existing?.repo;
    /*
     * COMPARED AS REAL PATHS. `resolve()` normalizes but does not follow symlinks, and on macOS
     * `/var` IS a symlink to `/private/var` — so a repository under a temp directory is recorded as
     * one spelling and named on the command line as the other, and a same-repository re-harvest was
     * refused as if it were a different one. Caught by driving both directions rather than only the
     * one this guard exists to stop; a guard that also refuses the legitimate case is a guard that
     * gets deleted.
     *
     * ONE NOTION OF "SAME REPOSITORY", the collector's: two paths that are not one tree may still
     * be one repository — a worktree and its main checkout, or clones sharing a root commit — and
     * `sameRepository` (apps/leaf/src/gitQueueSource.ts) is the one answer the collector and this
     * guard both give. A repository that cannot be checked is refused by name, never assumed.
     *
     * EXCEPT BY THE QUEUE'S OWN COMMITS, while nothing is decided. The recorded folder is often
     * simply gone: moved, renamed or re-cloned right after a first grow, before any draft was
     * decided. Guarding waiting drafts made that a dead end the RC never had. So for a queue with no
     * decision, `queueRepositoryMatch` asks the repository being grown, without fetching, whether it
     * holds every commit the waiting drafts name; if it does, it is that queue's repository and the
     * run goes on (the merge keeps the drafts and records the new folder). A queue holding a decision
     * is refused as the RC refuses it (oneQueue.seam.test.ts). Either refusal says what to do.
     */
    const sameTree = (a, b) => {
      try {
        return realpathSync(a) === realpathSync(b);
      } catch {
        return resolve(a) === resolve(b); // a path that no longer exists still gets an honest answer
      }
    };
    if (decided.length + waiting.length > 0 && typeof from === "string" && !sameTree(from, repo)) {
      const { queueRepositoryMatch } = await import("./apps/leaf/src/gitQueueSource.ts").catch(explainFailedWorkspaceImport);
      const match = await queueRepositoryMatch(from, repo, {
        decided: decided.length,
        refs: waiting.flatMap((x) => x.evidence.map((e) => e.ref)),
      });
      switch (match.kind) {
        case "same":
          if (match.by === "queue-commits") {
            row("NOTE", warm(`this garden's queue was drafted from ${from}, which cannot be read now.`));
            row("", `${dim(repo)} holds every commit in that queue, so this run grows it as`);
            row("", `the same repository and records its new folder.`);
          }
          break;
        case "unreadable":
          process.stderr.write(
            `\nfoliage: REFUSED — cannot check that ${repo} is the repository this garden's queue\n` +
              `foliage:   was drafted from (${from}): ${match.detail}\n` +
              `foliage: ${HARVEST} was NOT changed.\n` +
              (existsSync(from)
                ? `foliage: to grow ${repo}, give it its own garden —\n`
                : `foliage: if that repository moved, move it back to ${from} and grow it there.\n` +
                  `foliage: Otherwise give ${repo} its own garden —\n`) +
              `foliage:   ${launcher} grow --repo ${shellWord(repo)} --garden <another dir>\n`,
          );
          process.exit(3);
          break;
        case "different": {
          const holds = [
            ...(decided.length > 0 ? [`${decided.length} decision(s) you made`] : []),
            ...(waiting.length > 0 ? [`${waiting.length} draft(s) waiting for your decision`] : []),
          ].join(" and ");
          process.stderr.write(
            `\nfoliage: REFUSED — this garden's queue holds ${holds} about\n` +
              `foliage:   a different repository, and harvesting ${repo} would discard them.\n` +
              `foliage: ${HARVEST} was NOT changed.\n` +
              `foliage:   the queue was drafted from  ${from}\n`,
          );
          for (const x of [...decided, ...waiting].slice(0, 5)) process.stderr.write(`foliage:   ${x.id} — ${x.review.state}\n`);
          process.stderr.write(
            `foliage: a garden holds one repository's queue, and deciding that queue does not free\n` +
              `foliage:   the garden for another. Give the other repository its own garden —\n` +
              `foliage:   ${launcher} grow --repo ${shellWord(repo)} --garden <another dir>\n`,
          );
          process.exit(3);
          break;
        }
        default:
          throw new Error(`unhandled repository match: ${JSON.stringify(match)}`);
      }
    }
    /*
     * THE ONE WINDOW THIS GUARD CANNOT CLOSE, said out loud rather than left silent.
     *
     * A garden that existed before the harvest recorded its repository carries decisions and no
     * `repo`, and absent means UNCHECKED — so this run cannot tell whether it is about to replace
     * that queue with a different repository's work. Refusing would be worse: there is no way for
     * the person to prove the repositories match, so every existing garden would be stuck. The run
     * proceeds, records the repository, and every later run IS protected — but the person is told
     * once, at the only moment the risk exists, instead of finding out afterwards.
     */
    if (decided.length > 0 && typeof from !== "string") {
      row("NOTE", warm(`${decided.length} decision(s) here predate the record of which repository`));
      row("", `they came from, so this run cannot check it. Harvesting ${dim(repo)}`);
      row("", `records it; from the next run on, a different repository is refused.`);
    }
    process.stdout.write(`\n${rule("INTAKE — what the history holds")}\n`);
    // The garden folder is made here, the first write, and a grow whose intake stops takes back the
    // folders it made while they are still empty: a failed first grow left an empty ~/.foliage.
    // rmdir removes only an empty folder, so nothing anybody put there is touched.
    const madeGarden = makeGarden();
    const a = run("apps/leaf/intake.mjs", ["--repo", repo, "--subject", subject, ...idArgs, "--out", LEAF, "--force"]);
    if (a !== 0) {
      for (let dir = GARDEN; madeGarden !== undefined; dir = dirname(dir)) {
        try { rmdirSync(dir); } catch { break; }
        if (dir === madeGarden) break;
      }
      process.exit(a);
    }
    process.stdout.write(`\n${rule("PHOTOSYNTHESIS — drafting candidates")}\n`);
    // --into LEAF, ledger F-014: intake just wrote LEAF above, so the harvest this run drafts
    // can — and must — record which leaf it is FOR. Without it `promote` could not tell this
    // garden's harvest from any other's, and a `--into` pointed at the wrong leaf would splice
    // one subject's approvals into another's portfolio silently.
    // --workflow: the collector writes this same queue, so grow keeps what its checkouts still hold.
    const b = run("apps/leaf/harvest.mjs", ["propose", "--repo", repo, ...idArgs, "--into", LEAF, "--out", HARVEST, "--workflow", join(GARDEN, "workflow", "workflow.json"), "--force"]);
    if (b !== 0) {
      process.stderr.write(`foliage: intake completed at ${LEAF}, but candidate drafting failed (exit ${b}). The steps are not one transaction. Inspect the cause above and preserve the existing harvest before retrying grow.\n`);
      await refreshBrainLater();
      process.exit(b);
    }
    const c = counts();
    process.stdout.write(`\n${rule("YOUR TURN — no draft joins the leaf without you")}\n`);
    // PROMOTED, not buried. intake.mjs already prints this exact diagnosis inline, under the
    // INTAKE section header above — scrollable-past per-cluster noise on a real repository's
    // history. Every leaflet this run holds being "excluded" means the declared identity matched
    // nobody, which has an actual remedy, so it gets the first row of the one section a user
    // reads to the end rather than staying buried above it.
    if (c.leaf.total > 0 && (c.leaf.by.excluded ?? 0) === c.leaf.total) {
      row("IDENTITY", warm(`0 of ${c.leaf.total} leaflet(s) are attributed to <${ids.join(", ")}> — every one is excluded.`));
      row("", `${dim("this is NOT a thin history — check the address:")}`);
      row("", `git -C ${repo} log --no-merges --format=%ae | sort -u`);
      row("", `${dim("then re-run with the --identity that history actually carries.")}`);
    }
    row("LEAF", `${c.leaf.total} leaflets   ${tierLine(c.leaf.by)}`);
    row("REVIEW", `${bold(String(c.awaiting ?? 0))} candidate(s) await your decision`);
    row("NEXT", nextCommand("review"));
    row("", `${nextCommand("up")}  ${dim("or decide in the browser at /review")}`);
    process.stdout.write("\n");
    await refreshBrainLater();
    break;
  }

  case "review": {
    // THE ONE QUEUE IS DECIDED AT /review. This command only points there: the open count, what
    // is paused, and the route. It writes nothing. `--resume` retries promotion of approvals
    // already saved, which decides nothing.
    const doc = value("--doc") ?? HARVEST;
    const h = readJson(doc);
    if (!h) {
      process.stderr.write(`foliage: no harvest at ${doc}. Draft candidates first: ${nextWith("grow", "--repo <path>")}\n`);
      process.exit(1);
    }
    const into = value("--into") ?? LEAF;
    const resumeCommand = nextCommand("review", ["--resume", "--doc", resolve(doc), "--into", resolve(into)]);
    if (argv.includes("--resume")) {
      const g = runQuiet("apps/leaf/harvest.mjs", ["promote", "--doc", doc, "--into", into, "--force"]);
      if (g.status !== 0) {
        process.stderr.write(`foliage: review decisions were saved at ${doc}, but promotion did not complete successfully.\n${g.out}\nFix the cause, then retry without re-approving:\n${resumeCommand}\nDo not export based on this attempt.\n`);
        // Even a promotion that stopped may have written; the refresh starts nothing if it did not.
        await refreshBrainLater();
        process.exit(g.status);
      }
      for (const line of g.out.split("\n")) { if (line.trim() !== "") process.stdout.write(`  ${dim(line)}\n`); }
      // Count the leaf that was WRITTEN, not the garden default — a tally read off a different
      // document than the one promoted into is a number about the wrong portfolio.
      const l2 = readJson(into);
      if (l2) {
        const by = {};
        for (const x of l2.leaflets ?? []) by[x.tier] = (by[x.tier] ?? 0) + 1;
        row("LEAF", `${(l2.leaflets ?? []).length} leaflets   ${tierLine(by)}`);
      }
      row("NEXT", nextWith("share", "<id> --as public"));
      row("", `${nextCommand("export")}  ${dim("local copy; shared copies cannot be withdrawn")}`);
      process.stdout.write("\n");
      await refreshBrainLater();
      break;
    }
    // /review serves the garden's harvest; another document's count beside it names a queue that
    // page never shows.
    if (!existsSync(HARVEST) || realpathSync(doc) !== realpathSync(HARVEST)) {
      process.stderr.write(`foliage: not this garden's harvest · ${resolve(doc)}\nfoliage:   ${REVIEW_ROUTE} serves ${HARVEST}\n`);
      process.exit(2);
    }
    const { open, paused } = openInQueue(h);
    banner();
    row("OPEN", `${REVIEW_ROUTE}  ${dim(`${open.length} to review · ${nextCommand("up")}`)}${pausedNote(paused)}`);
    if (open.length === 0 && paused === 0) {
      row("REVIEW", "nothing awaits you — every candidate is decided.");
      if ((h.candidates ?? []).some(c => c.review?.state === "approved")) {
        row("RESUME", resumeCommand);
      } else {
        row("NEXT", `${nextWith("share", "<id> --as public")}  ${dim("choose work to list in the exported page")}`);
        row("", `${nextCommand("export")}  ${dim("the site folder, ready to host")}`);
      }
    }
    process.stdout.write("\n");
    break;
  }

  case "migrate-queue": {
    /*
     * ONE-TIME, AND ONLY WHEN THE OWNER RUNS IT. Measured on a garden in use 2026-09-28:
     * approved clusters sat in the harvest and never reached the leaf, because the harvest carried
     * no binding and most of them had a newer primary ref than their leaflet. This
     * composes, like every other command here: `harvest.mjs adopt` owns the plan, the refusals,
     * the backups and the writes. What this adds is the garden's paths and which repository to
     * date the refs from — never guessed: the harvest's recorded one, else the ONE watched source,
     * else the ONE enabled workflow source. Two or none is refused with every candidate named.
     */
    let repo = value("--repo");
    if (repo === undefined) {
      let recorded;
      try { recorded = readJson(HARVEST)?.repo; } catch { recorded = undefined; } // adopt names a broken harvest
      const watched = readSources().sources.map((s) => s.path);
      const workflowFile = join(GARDEN, "workflow", "workflow.json");
      let workflowSources = [];
      try {
        workflowSources = workflowSourcesOf(readJson(workflowFile));
      } catch (err) {
        process.stderr.write(`foliage: ${workflowFile} is not valid JSON — ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(2);
      }
      const workflow = workflowSources.filter((s) => s.enabled).map((s) => s.path);
      // The same answer `foliage up` gives, minus FOLIAGE_SOURCE_REPO: this command writes.
      repo = sourceRepoFor({ env: {}, harvestRepo: typeof recorded === "string" ? recorded : undefined, watched, workflowSources });
      if (repo === undefined) {
        process.stderr.write(`foliage: migrate-queue needs --repo <path>\n`);
        process.stderr.write(`foliage:   watched   ${watched.length}${watched.map((p) => `\nfoliage:     ${p}`).join("")}\n`);
        process.stderr.write(`foliage:   workflow  ${workflow.length}${workflow.map((p) => `\nfoliage:     ${p}`).join("")}\n`);
        process.exit(2);
      }
    }
    banner();
    const adopted = run("apps/leaf/harvest.mjs", [
      "adopt", "--doc", HARVEST, "--into", LEAF, "--repo", repo, ...(argv.includes("--apply") ? ["--apply"] : []),
    ]);
    // Only --apply writes; a dry run leaves the record, and so the brain, as it was.
    if (argv.includes("--apply")) await refreshBrainLater();
    process.exit(adopted);
  }

  case "share":
  case "unshare": {
    // A PASSTHROUGH, not a reimplementation — modelled exactly on the `policy` case just below,
    // which is the worked example this one copies: `apps/leaf/share.mjs` stays exactly as it is
    // and owns every rule about sharing (ONE id per call, the default that is never `public`,
    // the refusal that stands). What this case adds is the SAME gap `policy` closes — the child
    // script's own `--leaf` default is a path BESIDE THE SCRIPT (`apps/leaf/leaf.json`), correct
    // for the CLI run bare, wrong for `foliage`, whose garden is `~/.foliage` (or its override).
    // FOLIAGE_LEAF joined by FOLIAGE_POLICY for the same reason `up` sets both around its own
    // child: every document a subcommand touches rides in on the SAME two env vars, so nothing
    // here has to duplicate a resolution rule share.mjs might grow tomorrow. `share.mjs` itself
    // reads FOLIAGE_LEAF before its script-relative default (see DOCUMENT_ENV in
    // apps/leaf/src/leafDocument.ts) — an explicit `--leaf` on the command line still wins.
    //
    // `cmd` is spliced back in as share.mjs's own first positional (its subcommand IS the verb
    // `foliage` was called with) — `foliage share <id> --as public` forwards to
    // `share.mjs share <id> --as public`; `foliage unshare <id>` forwards to `share.mjs unshare
    // <id>`. Everything after the verb — the id, `--as`, an unknown flag — is share.mjs's own to
    // parse and refuse; this file never re-parses it.
    makeGarden();
    const code = run("apps/leaf/share.mjs", [cmd, ...argv.slice(1)], { FOLIAGE_LEAF: LEAF, FOLIAGE_POLICY: POLICY });
    await refreshBrainLater();
    process.exit(code);
  }

  case "mcp": {
    if (argv.length === 2 && ["--help", "-h"].includes(argv[1])) {
      process.exitCode = run("apps/leaf/assistant-mcp.mjs", ["--help"]);
      break;
    }
    if (refusedAmbientGarden("mcp")) break;
    // Top-level parseArgs already checked every named option and duplicate. Forward exact
    // owner-supplied project and capture values to the stdio server's own authority checks.
    process.exitCode = run("apps/leaf/assistant-mcp.mjs", ["--into", LEAF, "--out", HARVEST, ...argv.slice(1)]);
    break;
  }

  case "search": {
    if (refusedAmbientGarden("search")) break;
    process.exitCode = run("apps/leaf/search.mjs", ["--into", LEAF, "--out", HARVEST, ...argv.slice(1)]);
    break;
  }

  case "brain": {
    // A passthrough: apps/leaf/brain.mjs owns the brain; this only names the garden, and itself
    // (FOLIAGE_LAUNCHER, as `watch` and `up` give it), so every fix brain.mjs prints is the whole
    // command, node and this file by absolute path with --garden, in any copy.
    process.exitCode = run("apps/leaf/brain.mjs", [...argv.slice(1), "--garden", GARDEN], { FOLIAGE_LAUNCHER: fileURLToPath(import.meta.url) });
    break;
  }

  case "private-brain": {
    if (refusedAmbientGarden("private-brain")) break;
    process.exitCode = run("apps/leaf/private-brain.mjs", ["--into", LEAF, "--out", HARVEST, ...argv.slice(1)]);
    break;
  }

  case "photos": {
    /*
     * IMAGES INTO THE GARDEN (QA #24). A command of its own rather than a `grow` flag: grow reads
     * one git repository as one subject (repo, identity, intake into the leaf) and a directory of
     * images has none of those, so every grow option would be meaningless here. It is shaped like
     * `integrations import`, the other light source that is not git: harvest.mjs owns the scan,
     * the metadata strip, the drafting and the write; this supplies the garden's paths.
     * FOLIAGE_LEAF is set exactly as `up` sets it, so the images land in the store the app reads.
     */
    let parsed;
    try {
      parsed = parseArgs({ args: argv.slice(1), options: { "describe-with-local-model": { type: "boolean" } }, strict: true, allowPositionals: true });
    } catch (err) {
      process.stderr.write(`foliage: ${err instanceof Error ? err.message : String(err)}. Use photos --help.\n`);
      process.exit(2);
    }
    const dir = parsed.positionals.length === 1 ? parsed.positionals[0] : "";
    if (dir.trim() === "") {
      process.stderr.write(`foliage: photos needs one directory: ${nextWith("photos", "<dir>")}\n`);
      process.exit(2);
    }
    makeGarden();
    banner();
    process.stdout.write(`${rule("PHOTOSYNTHESIS — drafting candidates from images")}\n`);
    const describe = parsed.values["describe-with-local-model"] === true ? ["--describe-with-local-model"] : [];
    const code = run("apps/leaf/harvest.mjs", ["propose-photos", "--dir", resolve(dir), "--out", HARVEST, "--force", ...describe], { FOLIAGE_LEAF: LEAF });
    if (code !== 0) process.exit(code);
    const c = counts();
    process.stdout.write(`\n${rule("YOUR TURN — no draft joins the leaf without you")}\n`);
    // `counts()` leaves `leaf` null for a record that is there but will not load, too — that is not "none yet".
    if (c.unreadable.leaf) row("LEAF", warm(`${LEAF} ${LEAF_TROUBLE[c.unreadable.leaf]}`));
    else if (c.leaf === null) row("LEAF", dim(`none yet — run ${nextWith("grow", "--repo <path>")} before approving`));
    row("REVIEW", `${bold(String(c.awaiting ?? 0))} candidate(s) await your decision${pausedNote(c.paused)}`);
    row("NEXT", `${nextCommand("up")}  ${dim(`decide at ${REVIEW_ROUTE}`)}`);
    process.stdout.write("\n");
    break;
  }

  case "integrations": {
    const action = argv[1];
    // The launcher's own help: the importer's names its script by a relative path, a docs/ file an
    // installed copy does not carry, and a bare `foliage up` no install puts on PATH.
    if (action === undefined) { help("integrations"); process.exit(0); }
    if (action !== "import") {
      process.stderr.write("foliage: integrations supports import only. No provider account is connected by this command.\n");
      process.exit(2);
    }
    // The importer refuses an ambient garden itself; defaulting --into/--out from one here undid that.
    if (refusedAmbientGarden("integrations import")) process.exit(2);
    const args = argv.slice(2);
    // The named garden owns the destination; the importer owns parsing, binding and writes.
    // Explicit paths remain explicit, and duplicate flags are left for its strict parser.
    const hasFlag = (flag) => args.some(arg => arg === flag || arg.startsWith(`${flag}=`));
    if (!hasFlag("--into")) args.push("--into", LEAF);
    if (!hasFlag("--out")) args.push("--out", HARVEST);
    const imported = run("apps/leaf/import-observations.mjs", args);
    // The command-line twin of the MCP tool foliage_submit_observations, which asks the same.
    await refreshBrainLater();
    process.exit(imported);
  }

  case "policy": {
    // A PASSTHROUGH, not a reimplementation — `apps/leaf/policy.mjs` stays exactly as it is and
    // owns every rule about rules. What this case fixes is the ONE gap a passthrough can close
    // that the child script cannot close for itself: run `node apps/leaf/policy.mjs` bare, from
    // a terminal, and its `--leaf`/`--policy` default to files BESIDE THE SCRIPT
    // (`apps/leaf/leaf.json`, `apps/leaf/policy.json`) — correct for the CLI in isolation, wrong
    // for `foliage`, whose garden is `~/.foliage`. `foliage up`'s server already reads
    // `FOLIAGE_LEAF`/`FOLIAGE_POLICY` before its own repo-relative defaults (see the `up` case
    // above); this sets the SAME two environment variables around the SAME child, so `foliage
    // policy deny …` writes the rule the running app actually reads, without duplicating one
    // line of policy.mjs's own argument parsing. An explicit `--leaf`/`--policy` flag on the
    // command line still wins — `leafPath()`/`policyFileToEdit()` in policy.mjs check the flag
    // before the environment, exactly like `grow`'s `--subject` override above.
    const code = run("apps/leaf/policy.mjs", argv.slice(1), { FOLIAGE_LEAF: LEAF, FOLIAGE_POLICY: POLICY });
    process.exit(code);
  }

  case "canopy": {
    // Two origins because they have opposite authority. The manager can invoke deliberate
    // publish/withdraw commands and therefore binds loopback only. The public server has no
    // mutating route at all. One process serving both would make that boundary a convention.
    const canopyDir = join(HOME, "apps/canopy");
    const publicEntry = join(canopyDir, "server.mjs");
    const managerEntry = join(canopyDir, "manage-server.mjs");
    if (!existsSync(publicEntry) || !existsSync(managerEntry)) {
      process.stderr.write("foliage: Canopy is not included in this open local package. Use the separately configured Canopy companion or a checkout that includes Canopy.\n");
      process.exit(2);
    }
    const managePort = Number(value("--manage-port") ?? 4180);
    const publicPort = Number(value("--public-port") ?? 4173);
    for (const [label, port] of [["manager", managePort], ["public", publicPort]]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        process.stderr.write(`foliage: ${label} port must be an integer from 1 to 65535.\n`);
        process.exit(2);
      }
    }
    if (managePort === publicPort) {
      process.stderr.write("foliage: the manager and public leaf need different ports.\n");
      process.exit(2);
    }
    const [manageFree, publicFree] = await Promise.all([portFree(managePort), portFree(publicPort)]);
    if (!manageFree || !publicFree) {
      process.stderr.write(
        `foliage: ${!manageFree ? `manager port ${managePort}` : `public port ${publicPort}`} is taken. ` +
          `Nothing was started.\n`,
      );
      process.exit(1);
    }

    const workspaceAssets = [join(canopyDir, "public/workspace.js"), join(canopyDir, "public/workspace.css")];
    if (workspaceAssets.some((asset) => !existsSync(asset))) {
      const buildScript = join(canopyDir, "workspace-ui/build.ts");
      if (existsSync(buildScript)) {
        const built = spawnSync("bun", [buildScript], { cwd: canopyDir, encoding: "utf8", timeout: 120_000 });
        if (built.status !== 0) {
          const reason = (built.error?.message ?? built.stderr?.trim() ?? `exit ${built.status}`).replace(/\s+/g, " ").slice(0, 500);
          process.stderr.write(`foliage: Hosting workspace assets are missing; build failed: ${reason}. The standard publication manager remains available.\n`);
        }
      }
      if (workspaceAssets.some((asset) => !existsSync(asset))) {
        process.stderr.write("foliage: Hosting workspace assets are missing. /workspace will show the standard publication controls; restore the Hosting view with pnpm --filter @foliage/canopy-app workspace:build.\n");
      }
    }

    banner();
    row("LOCAL", existsSync(LEAF) ? LEAF : dim(`no leaf yet at ${LEAF}`));
    row("MANAGE", bold(`http://127.0.0.1:${managePort}/`));
    row("PUBLIC", `http://127.0.0.1:${publicPort}/leaf/<leaf-id>`);
    row("BOUNDARY", dim("models prepare locally; only a typed decision changes the public file"));
    process.stdout.write("\n");

    const sharedEnv = {
      ...process.env,
      FOLIAGE_LEAF: LEAF,
      FOLIAGE_POLICY: POLICY,
      FOLIAGE_PUBLISHED: PUBLISHED,
      FOLIAGE_HOSTED_STATE: join(GARDEN, "hosted", "connection.json"),
      HOST: "127.0.0.1",
    };
    const publicServer = spawn(process.execPath, [publicEntry], {
      stdio: "inherit",
      env: { ...sharedEnv, PORT: String(publicPort) },
    });
    const manager = spawn(process.execPath, [managerEntry], {
      stdio: "inherit",
      env: {
        ...sharedEnv,
        // The manager alone reads the private workflow, for Jev's draft-time marks beside each
        // item before publishing. The public server is never given it.
        FOLIAGE_WORKFLOW_DIR: join(GARDEN, "workflow"),
        FOLIAGE_PUBLIC_ORIGIN: `http://127.0.0.1:${publicPort}`,
        PORT: String(managePort),
      },
    });
    let stopping = false;
    const stopOther = (source, code) => {
      if (stopping) return;
      stopping = true;
      const other = source === publicServer ? manager : publicServer;
      if (other.exitCode === null) other.kill("SIGTERM");
      process.exit(code ?? 0);
    };
    publicServer.on("exit", (code) => stopOther(publicServer, code));
    manager.on("exit", (code) => stopOther(manager, code));
    break;
  }

  case "verify": {
    // WHY THIS COMMAND EXISTS. Measured on a garden in use: not one leaflet verified,
    // structurally — `verified` needs a signature git ACCEPTED and a signer BOUND to a declared
    // identity, and on most machines git can check nothing (no gpg, no allowedSignersFile), so
    // the product's flagship tier has never fired on real data. This diagnoses exactly which
    // links are missing and, with --setup, closes them for ONE repo using SSH signing — the path
    // almost every developer already has a key for. LOCAL repo config only, never --global:
    // reversible, scoped, and printed before it is applied.
    //
    // HONEST LIMIT, stated up front: setup makes FUTURE commits verify. History stays what it
    // is — signing yesterday's commits would be rewriting yesterday.
    const repo = value("--repo") ?? process.cwd();
    // Git first, as grow asks it: a git that is missing or does not run answers nothing about the
    // folder, so "is not a git repository" would be false.
    const noGit = gitAbsence();
    if (noGit !== null) {
      process.stderr.write(`foliage: ${gitNeeded("verify", noGit)}\n`);
      process.exit(2);
    }
    const git = (args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (git(["rev-parse", "--git-dir"]).status !== 0) {
      process.stderr.write(`foliage: ${repo} is not a git repository.\n`);
      process.exit(2);
    }
    banner();
    const email = git(["config", "user.email"]).stdout?.trim() || null;
    const format = git(["config", "gpg.format"]).stdout?.trim() || "openpgp (default)";
    const signingKey = git(["config", "user.signingkey"]).stdout?.trim() || null;
    const autosign = git(["config", "commit.gpgsign"]).stdout?.trim() === "true";
    const signersFile = git(["config", "gpg.ssh.allowedSignersFile"]).stdout?.trim() || null;
    const gpgBin = spawnSync("sh", ["-c", "command -v gpg"], { encoding: "utf8" }).stdout?.trim() || null;
    // Any public key counts, ed25519 preferred — key names are personal ("github_ed25519.pub"
    // is common), and a scan that only knows two names tells a keyed-up user to make another.
    const sshDir = join(homedir(), ".ssh");
    const pubs = existsSync(sshDir)
      ? readdirSync(sshDir).filter((f) => f.endsWith(".pub")).sort((a, b) => Number(b.includes("ed25519")) - Number(a.includes("ed25519")))
      : [];
    const sshPub = pubs.length > 0 ? join(sshDir, pubs[0]) : null;

    row("REPO", repo);
    row("IDENTITY", email ?? warm("none — set git config user.email first"));
    process.stdout.write(`\n${rule("THE FOUR LINKS verified NEEDS")}\n`);
    row("sign key", signingKey ? `${green("ok")} ${dim(signingKey)}` : warm("missing — commits are not signed"));
    row("format", format.startsWith("ssh") ? `${green("ok")} ssh` : dim(`${format}${gpgBin ? "" : "  (and no gpg on this machine)"}`));
    row("autosign", autosign ? green("ok — every commit") : warm("off — signing is per-commit"));
    row("verifier", signersFile ? `${green("ok")} ${dim(signersFile)}` : warm("missing — git cannot CHECK any ssh signature here"));
    const ready = signingKey !== null && autosign && (format.startsWith("ssh") ? signersFile !== null : gpgBin !== null);
    process.stdout.write("\n");
    if (ready) {
      row("VERDICT", green("future commits in this repo will sign and verify."));
      row("", dim("history stays as it is — verified grows from the next commit on."));
      process.stdout.write("\n");
      break;
    }
    if (sshPub === null) {
      // The re-run is what the person typed, every argument kept, and the repository it checked by
      // its full path, the current folder when no --repo was given, so it checks the same one from
      // any folder.
      const typed = ["--repo", resolve(repo), ...(options.setup ? ["--setup"] : [])];
      row("VERDICT", warm("no ssh key found (~/.ssh/id_ed25519.pub or id_rsa.pub)."));
      row("FIX", `ssh-keygen -t ed25519    ${dim(`then re-run ${nextCommand("verify", typed)}`)}`);
      process.stdout.write("\n");
      process.exit(1);
    }
    if (email === null) { process.stdout.write("\n"); process.exit(1); }
    const signers = join(GARDEN, "allowed_signers");
    const pub = readFileSync(sshPub, "utf8").trim();
    const line = `${email} ${pub.split(" ").slice(0, 2).join(" ")}`;
    process.stdout.write(`${rule(argv.includes("--setup") ? "APPLYING — local repo config only" : "THE FIX — re-run with --setup to apply")}\n`);
    row("1", `git config gpg.format ssh`);
    row("2", `git config user.signingkey ${sshPub}`);
    row("3", `git config commit.gpgsign true`);
    row("4", `${signers} ${dim("gets the line binding your email to your key,")}`);
    row("", `git config gpg.ssh.allowedSignersFile ${signers}`);
    if (argv.includes("--setup")) {
      makeGarden();
      const existing = existsSync(signers) ? readFileSync(signers, "utf8") : "";
      if (!existing.includes(line)) writeFileSync(signers, existing + line + "\n");
      for (const args of [["config", "gpg.format", "ssh"], ["config", "user.signingkey", sshPub], ["config", "commit.gpgsign", "true"], ["config", "gpg.ssh.allowedSignersFile", signers]]) {
        const r = git(args);
        if (r.status !== 0) { process.stderr.write(`foliage: git ${args.join(" ")} failed: ${r.stderr}`); process.exit(1); }
      }
      process.stdout.write("\n");
      row("DONE", green("your NEXT commit here signs and verifies."));
      row("", dim(`run ${nextCommand("grow")} after a commit or two and watch ● verified move.`));
    }
    process.stdout.write("\n");
    break;
  }

  case "status": {
    banner();
    const c = counts();
    // One line for this garden's brain (unit 38), once there is a record for it to hold: read at a
    // glance, no gbrain process started. An installed copy puts no `foliage` on PATH, so there its
    // fix is the whole command, as `foliage brain` prints it (`ownerStatus`), quoted as
    // `nextCommand` quotes; a checkout keeps the short form.
    const brainRow = async () => {
      const self = fileURLToPath(import.meta.url);
      let line;
      try {
        const { brainGlance, brainLine, installedRuntime, NO_BRAIN, ownerStatus } = await import("./apps/leaf/src/localBrain.ts");
        const vendor = join(HOME, "vendor");
        const glance = await brainGlance({ garden: GARDEN, vendor });
        // No brain yet: the row says what builds one, in `foliage brain refresh`'s words, not "off" alone.
        const status = glance.state === "off" && glance.cause === undefined ? NO_BRAIN : glance;
        line = brainLine(await installedRuntime(vendor) ? ownerStatus(status, { node: process.execPath, launcher: self, root: dirname(self), garden: GARDEN }) : status, { offCause: true });
      } catch {
        line = `Brain: broken: the brain could not be checked. Run ${[process.execPath, self, "brain", "rebuild", "--garden", GARDEN].map(shellWord).join(" ")}`;
      }
      row("BRAIN", line.replace(/^Brain: /, ""));
    };
    const drafts = () => `${warm(`${draftsTrouble(c.unreadable.harvest)} (harvest.json)`)}  ${dim(`→ ${REVIEW_ROUTE} · ${nextCommand("up")}`)}`;
    if (c.leaf === null) {
      if (c.unreadable.leaf) {
        row("LEAF", warm(`${LEAF} ${LEAF_TROUBLE[c.unreadable.leaf]}`));
        row("NEXT", { json: "correct the JSON in that file", read: "check that file and its permissions", invalid: `${nextCommand("up")}, then /leaf lists what to fix` }[c.unreadable.leaf]);
        if (c.unreadable.harvest) row("REVIEW", drafts());
      } else {
        row("LEAF", dim(`none yet at ${LEAF}`));
        // Drafting over a drafts file that will not load is refused, so the file comes first.
        if (c.unreadable.harvest) {
          row("REVIEW", drafts());
          row("NEXT", `${nextCommand("up")}, then ${REVIEW_ROUTE} shows what to repair`);
        } else row("NEXT", nextWith("grow", "--repo <your repo>"));
      }
      process.stdout.write("\n");
      break;
    }
    row("LEAF", `${bold(c.leaf.subject)}  ${dim("·")}  ${c.leaf.total} leaflets`);
    row("", tierLine(c.leaf.by));
    row("SHARE", shareLine(c.leaf.visibility));
    row("REVIEW", c.unreadable.harvest
      ? drafts()
      : c.awaiting || c.paused ? `${bold(String(c.awaiting))} to review${pausedNote(c.paused)}  ${dim(`→ ${REVIEW_ROUTE} · ${nextCommand("up")}`)}` : dim("nothing awaits you"));
    await brainRow();
    row("GARDEN", dim(GARDEN));
    process.stdout.write("\n");
    break;
  }

  /*
   * WATCHED SOURCES — the places this garden reads work from.
   *
   * Delegated, never reimplemented: `apps/leaf/sources.mjs` owns every write and runs the same
   * total parser on the way in and the way out. This file's job is to default the document onto
   * the garden, exactly as `policy` does for the policy document.
   *
   * WHY THE GARDEN NEEDED THIS AT ALL: `grow` defaults `--repo` to `process.cwd()`, which is right
   * for a person at a terminal and meaningless for a scheduled one — launchd starts an agent with
   * no useful working directory. Until a durable list existed there was nothing an unattended
   * harvest could read, so "set it and forget it" produced a page that never changed.
   *
   * `grow` READS THIS LIST when no `--repo` is given, and refuses when more than one source is
   * watched. The refusal is not a gap: candidate ids are the commit prefix alone, so two
   * repositories sharing a prefix would merge into one candidate, and qualifying the id by source
   * reopens every decision already made because the review digest is computed over the id. See the
   * boxed note in `apps/leaf/sources.mjs` for the measurement, and `grow` above for the message.
   */
  case "watch":
  case "unwatch":
  case "sources": {
    const sub = cmd === "sources" ? "list" : cmd;
    process.exit(
      // FOLIAGE_LAUNCHER, as `up` gives the server: `watch` spells its next step as `nextCommand` does.
      run("apps/leaf/sources.mjs", [sub, ...argv.slice(1)], { FOLIAGE_SOURCES: SOURCES, FOLIAGE_GARDEN: GARDEN, FOLIAGE_LAUNCHER: fileURLToPath(import.meta.url) }),
    );
  }

  case "export": {
    // FOLIAGE_POLICY joins FOLIAGE_LEAF for the same reason it does at `up` and `policy` above:
    // without it export.mjs falls back to its own script-relative default (apps/leaf/policy.json,
    // whatever a checkout happens to hold) instead of the garden's own rules, and a deny the
    // person wrote would never withhold anything from the exported page.
    process.exit(run("apps/leaf/export.mjs", ["--out", value("--out") ?? join(GARDEN, "site"), ...(argv.includes("--confirm") ? ["--confirm"] : []), ...((options.video ?? []).flatMap(ref => ["--video", ref]))], { FOLIAGE_LEAF: LEAF, FOLIAGE_POLICY: POLICY }));
  }

  case "install": {
    const everyRaw = value("--every");
    const every = everyRaw === undefined ? 21600 : Number(everyRaw);
    // Validate before writing either agent: a rejected interval must not replace an existing
    // viewer's port or garden while leaving its previous scheduled harvest behind.
    if (!Number.isInteger(every) || every < 300) {
      process.stderr.write(`foliage: --every takes whole seconds, at least 300 (got ${everyRaw}).\n`);
      process.exit(2);
    }
    // Checked FIRST, before either plist is written: a document `foliage sources` would refuse
    // is refused here too, by name, rather than discovered only after both plists already exist.
    const watchedCount = readSources().sources.length;
    makeGarden();
    const port = Number(value("--port") ?? 4174);
    const plist = join(homedir(), "Library", "LaunchAgents", "com.foliage.leaf.plist");
    mkdirSync(dirname(plist), { recursive: true });
    // Every value below lands as TEXT inside a plist `<string>`, so it must be XML-escaped first.
    // Before the garden became overridable GARDEN was always `~/.foliage` — no metacharacters, so
    // the raw template was safe. It no longer is: `--garden`/`FOLIAGE_GARDEN` is user-controlled
    // and `resolve()` does not strip `<`, `>`, `&`, so a value like `…</string></array><key>…`
    // breaks out of its element and injects a second `ProgramArguments` key, which a plist dict's
    // last-key-wins parsing then runs at every login — a persistent login-time RCE (reproduced).
    // The log path and the interpreter/script paths ride through the same escape for the same
    // reason: a `&` in anyone's home directory would corrupt the plist just as surely.
    const xml = (s) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    // A garden override must ride IN the plist: launchd starts agents with a minimal
    // environment, so without the EnvironmentVariables block below an installed service would
    // serve ~/.foliage while its logs (and this command's mkdir) point at the override — two
    // gardens disagreeing about which one is running.
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.foliage.leaf</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(HOME, "foliage.mjs"))}</string>
    <string>up</string><string>--port</string><string>${port}</string>
  </array>
${gardenOverride === undefined ? "" : `  <key>EnvironmentVariables</key><dict><key>FOLIAGE_GARDEN</key><string>${xml(GARDEN)}</string></dict>\n`}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(GARDEN, "app.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(GARDEN, "app.log"))}</string>
</dict></plist>\n`,
    );
    /*
     * THE SECOND AGENT — the one that makes "forget it" mean anything.
     *
     * `install` wrote exactly one agent and it ran `up`: the VIEWER. A person who installed Foliage
     * and walked away got a web page that was always running and a garden that never changed.
     *
     * THIS WAS PULLED FROM AN EARLIER ROUND AND HAS COME BACK. The three-pass review blocked it,
     * correctly: a timer running `grow` could replace a queue built from a different repository,
     * silently discarding decisions, and scheduling that unattended is the same destruction with
     * nobody watching. It is safe now because `grow` refuses that case by name — the harvest records
     * which repository drafted it, and a queue holding decisions about another one is not replaced.
     * The guard is what earned the timer, not the other way round.
     *
     * A HARVEST IS NOT A SERVER and the plist says so: `StartInterval`, no `KeepAlive` (which would
     * restart it the instant it finished), no `RunAtLoad` (logging in is not evidence that new work
     * exists, and a harvest on every login of a laptop that sleeps and wakes is a lot of git reads
     * bought for nothing). Six hours is a judgement, not a measurement: leaflets are drafted from
     * commits that already exist, so nothing is lost by being late. `--every` overrides it, floored
     * at 300s so a typo cannot ask for a harvest every second.
     */
    // The directory is explicit for launchd; --watched makes source selection independent of it,
    // including when an operator keeps the garden inside another repository.
    const growPlist = join(homedir(), "Library", "LaunchAgents", "com.foliage.grow.plist");
    writeFileSync(
      growPlist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.foliage.grow</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(HOME, "foliage.mjs"))}</string>
    <string>grow</string><string>--watched</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(GARDEN)}</string>
${gardenOverride === undefined ? "" : `  <key>EnvironmentVariables</key><dict><key>FOLIAGE_GARDEN</key><string>${xml(GARDEN)}</string></dict>\n`}  <key>StartInterval</key><integer>${every}</integer>
  <key>StandardOutPath</key><string>${xml(join(GARDEN, "grow.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(GARDEN, "grow.log"))}</string>
</dict></plist>\n`,
    );

    // Written, not loaded: starting a login service outlives this process, so the command is
    // printed for the owner to run rather than run for them.
    banner();
    row("WROTE", plist);
    row("", dim(`the app, at login`));
    row("WROTE", growPlist);
    row("", dim(`a harvest, every ${every === 21600 ? "6 hours" : `${every}s`}`));
    /*
     * A SCHEDULED HARVEST WITH NOTHING WATCHED READS NOTHING: `grow --watched` refuses without a
     * source instead of falling back to the working directory. Said
     * here, at the one moment somebody is looking, rather than discovered later as a garden that
     * never grew. Counted from the document, read once, above — never asserted.
     */
    if (watchedCount === 0) {
      row("WATCHING", warm("nothing — a scheduled harvest would read no history"));
      row("", `${nextWith("watch", "<path>")}   ${dim("· then the harvest above has a source")}`);
    } else {
      row("WATCHING", `${watchedCount} source(s)   ${dim(`· ${nextCommand("sources")}`)}`);
    }
    row("START", `launchctl bootstrap gui/$(id -u) ${plist}`);
    row("", `launchctl bootstrap gui/$(id -u) ${growPlist}`);
    row("STOP", `launchctl bootout gui/$(id -u) ${plist}`);
    row("", `launchctl bootout gui/$(id -u) ${growPlist}`);
    process.stdout.write("\n");
    break;
  }

  default: {
    banner();
    // Three columns, each as wide as its longest entry, so a long command name never pushes its
    // row out of line. No row names a bare `foliage`: an installed copy puts none on PATH, so the
    // first line says how every command runs.
    const commands = [
      ["grow", "read real work into the garden", "[--repo p | --watched] [--identity e]"],
      ["photos", "draft candidates from your images", "<dir>"],
      ["capture", "record an actual local app demo", "--url http://127.0.0.1:<port>"],
      ["review", "the review queue's count and /review", ""],
      ["migrate-queue", "one-time: land stuck approvals", "[--apply]"],
      ["share", "give one leaflet a shareable address", "<id> [--as unlisted|public]"],
      ["unshare", "take a leaflet's address away", "<id>"],
      ["policy", "the rules your leaflets are judged by", "show|check|deny|allow|drop"],
      ["up", "the app on loopback", "[--port n]"],
      ["canopy", "review and manage the public leaf", ""],
      ["verify", "make future commits verifiable", "[--repo p] [--setup]"],
      ["watch", "read this repo from now on", "<path> · unwatch <path> · sources"],
      ["integrations", "import selected evidence for review", "import --garden <path> --input <file|->"],
      ["mcp", "local assistant connection", "--garden <path>"],
      ["private-brain", "let one agent search records you pick", "list|receipts|serve --garden <path>"],
      ["search", "find cited work in a garden", "<words> --garden <path>"],
      ["brain", "this garden's local brain", "build|refresh|rebuild|search|status|remove|embed"],
      ["status", "what the garden holds", ""],
      ["export", "a local copy; not withdrawable", "[--out dir]"],
      ["install", "run at login: writes a launchd plist", ""],
      ["help", "read usage without changing files", "[command] · <command> --help"],
      ["garden", "--garden <path> overrides FOLIAGE_GARDEN and ~/.foliage", ""],
    ];
    const name = Math.max(...commands.map(([command]) => command.length));
    const what = Math.max(...commands.filter(([, , usage]) => usage !== "").map(([, text]) => text.length));
    process.stdout.write(`  ${dim("run".padEnd(name))}  ${launcher} <command>\n\n`);
    for (const [command, text, usage] of commands) {
      process.stdout.write(`  ${dim(command.padEnd(name))}  ${usage === "" ? text : `${text.padEnd(what)}  ${dim(usage)}`}\n`);
    }
    process.stdout.write(`\n  ${dim("GARDEN")}   ${dim(GARDEN + "   · nothing leaves this machine")}\n\n`);
  }
}
