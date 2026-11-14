/**
 * THE GARDEN'S LOCAL BRAIN (unit 38, build order items 2, 3, 5, 6 and 8; spec PR #201).
 *
 * Each garden gets its own brain at `<garden>/brain/`: a pinned gbrain on PGLite, run by a pinned
 * bun, built by Foliage from that garden's own records. Nothing leaves the machine. Part one holds
 * the parts every later step stands on:
 *
 *   - ONE function starts every gbrain process (`spawnGbrain`, which `runGbrain` and `call`
 *     wrap): bun by absolute path with
 *     `--no-install --no-env-file`, an environment built from an allowlist with nothing inherited,
 *     an empty `PATH`, an empty working directory, `--brain host` on every command, an allowlist of
 *     commands and ops checked before anything starts, a timeout and an output cap. A failure is a
 *     named cause, never an empty result.
 *   - the config file Foliage writes, and the check that it is exactly that file;
 *   - the settings gbrain keeps in its database, set after init and read back;
 *   - the brain's own lock, which may be reclaimed once its holder is dead (the brain is derived
 *     data), unlike the record documents' `.local-lock`, which is never stolen;
 *   - `buildBrain` and `brainStatus` over them.
 *
 * NEVER THE OWNER'S OWN BRAIN. Before anything under `<garden>/brain/` is read, made, locked or
 * removed, a brain that is, sits under or holds `~/.gbrain` or `~/brain` is refused
 * (`refuseOwnerBrain`); `checkHome` repeats it before every process starts.
 *
 * Every cause a failure names is free of paths and of gbrain's page addresses (`foliage/<hex>`), and
 * a search's never names a file in `brain/` that Foliage did not make: build order item 6 gives a
 * search's fallback reason in the same words, and no garden path or page address may reach an agent.
 *
 * Measured with gbrain 0.42.73.2 under `sandbox-exec` with all outbound network denied, 2026-10-10
 * (and see the spec's two probes): `--brain host` is accepted by `init`, `config`, `import` and
 * `call`; with the empty `PATH` none of them needs an outside program; bun reads a `bunfig.toml`
 * from its working directory (a planted `preload` ran) but not from the directories above it, so
 * the empty `work/` is what stops a planted bunfig or `.env`; and bun honours an inherited
 * `BUN_OPTIONS` (a planted `--preload` ran), which the environment allowlist strips.
 *
 * Part two (build order item 3) keeps the brain current and reads it:
 *   - a refresh first records what gbrain may hold once it starts changing it (an unfinished
 *     manifest whose record hashes match nothing), then writes the changed pages, imports with
 *     `--fresh`, removes the pages of removed records (`delete_page`, then `purge_deleted_pages` at
 *     0 hours, then `get_page` with `include_deleted` and `get_versions` must both find nothing),
 *     confirms `list_pages` and every written page's digest, and writes the manifest last, so a
 *     refresh killed at any step redoes its work on the next run, and a page it may have imported is
 *     judged by the law like any other;
 *   - removals the law drives (a leaflet newly excluded, a record newly resting on material about
 *     someone else), any removal whose check fails, an update too large to beat a rebuild, and
 *     anything not usable (a link where Foliage keeps a directory, a file it did not write among the
 *     pages) rebuild the brain in `brain/next/` and swap it in, so the old bytes leave with
 *     `brain/old/`;
 *   - a search runs gbrain's keyword search under the lock on a brain that matches the record,
 *     then puts the hits together in pure code (`brainSearchHits`), and otherwise answers from
 *     Foliage's own search over the same records with the reason. `foliage brain search` reads
 *     the record itself and hands it to `searchRecordThroughBrain` (build order item 6). In keyword
 *     mode, the default, `foliage search` and `foliage_search` do not read the brain at all (owner
 *     decision 3; `localSearch.ts`); with local embeddings on (part four) they do.
 *
 * Part three (build order item 5) keeps it current without anybody asking:
 *   - a search reads the record again once it holds the lock, so it never refreshes toward a record
 *     older than the one on disk; a brain behind it is refreshed in place first, within
 *     `READ_REFRESH_MS`, and never rebuilt by a search. A one-shot command (`foliage brain search`)
 *     hands the refresh to a detached process (`refreshElsewhere`, `foliage brain refresh
 *     --in-place`), so it can exit at the bound; a caller that stays up refreshes in process and
 *     lets a refresh past the bound finish behind the answer (no surface does in keyword mode: it is
 *     the MCP server's path once local embeddings bring `foliage_search` to the brain). A refresh
 *     of the same bytes that stopped within the triggers' backoff is not tried again by a search,
 *     and gbrain's search has its own short bound (item 6);
 *   - every update that fails writes down why (`refresh-failure.json`), with the hashes of the
 *     record it tried, so a refresh that ran behind the owner's action and failed leaves the brain
 *     behind with a named cause, never the action failed; one that ends current clears it;
 *   - the lock records a refresh in progress, so a status or search that finds it held says
 *     "behind your record, refreshing" instead of busy;
 *   - a `brain/` holding anything Foliage did not make is never locked, moved, removed or written,
 *     by any command: it may be the owner's own folder;
 *   - `brainDrift` tells the triggers whether there is anything to do, reading two documents and a
 *     manifest and starting nothing; `brainGlance` is the line `foliage status` prints, without a
 *     gbrain process.
 * The triggers themselves (after the commands and saves that write the record, after every MCP
 * tool that is not read-only, and the 30-second digest check in `foliage up`) are in
 * `brainUpkeep.ts`. No brain code writes `leaf.json` or `harvest.json`.
 *
 * Part four (build order item 8, owner decision 3) is local embeddings, opt-in. Keyword mode stays
 * the default. `foliage brain embed --local ollama:<model> [--port <n>]` (`embedBrain`) asks the
 * embedder on `127.0.0.1:<port>` whether it already holds the model and measures its dimensions
 * (`localEmbedder.ts`; nothing is pulled, a cloud model is refused), then writes the owner's choice
 * (`brain/embedding.json`) and rebuilds the brain for it: `init` sizes the embedding column at the
 * model's dimensions, config.json names the model and pins gbrain's ollama base URL to that
 * loopback address, the search op takes gbrain's hybrid path, and `embed --stale --source default`
 * embeds what each import added, in a rebuild and in every refresh. `--off` removes the choice and
 * rebuilds for keyword search. The manifest records the mode a brain was built in, and a brain
 * built in another mode or for another model than the one chosen is rebuilt, never searched. In
 * that mode, before each search and before anything is locked or started, the embedder must answer
 * on loopback, hold the model, and embed one fixed word at the brain's size; when it does not, the
 * search answers from Foliage's own search and names why, never resting on gbrain's silent fallback
 * to keyword search. The embedder never holds up the record's own changes: a refresh or rebuild
 * whose embedder is not answering (or fails to embed) still writes, removes and purges every page,
 * the law's removals included, records that its pages are not all embedded (`unembedded` in the
 * manifest), and stays behind, naming why, until a later refresh's `embed --stale` catches up.
 * The only address any of this asks is the owner's own embedder on loopback.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, rmdir, symlink, unlink } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseLeafDocument, type Leaf } from "@foliage/leaf";
import { writeDocument } from "@foliage/leaf/local-files";
import {
  brainManifestPage, BrainPageRefusal, brainProjection, brainRecords, brainRefreshPlan, brainSearchHits, brainUnfinishedPages, embedderBaseUrl, embeddingChange,
  embedderAddress, LocalEmbeddingRefusal, localEmbeddingText, OLLAMA_PORT, parseHarvestDocument, parseLocalEmbedding, sameEmbedding, searchRecords,
  type BrainHit, type BrainManifestPage, type BrainPage, type BrainProjection, type BrainRefreshPlan, type HarvestDocument, type LocalEmbedding,
} from "@foliage/photosynthesis";
import { STOPPED_RETRY_MS } from "./brainUpkeep.ts";
import {
  brainArchiveShips, BrainVendorError, EMPTY_BRAIN_BYTES, freeBytes, GBRAIN_PIN, readVendorManifest, roomProblem, vendorLayout, verifyVendorEntries, verifyVendorTree,
  type VendorManifest,
} from "./brainVendor.ts";
import { IMPORT_DOCUMENT_BYTES } from "./integrationImport.ts";
import { checkEmbedder, EmbedderUnavailable } from "./localEmbedder.ts";

export type BrainState = "current" | "behind" | "not-installed" | "off" | "busy" | "broken";
/**
 * `refreshing`: behind, and a refresh holds the brain's lock right now. `cause` on a brain that is
 * behind says why no refresh caught it up (the last one stopped, or a search does not start a
 * rebuild); without one, nothing has tried yet.
 */
export interface BrainStatus { readonly state: BrainState; readonly cause?: string; readonly fix?: string; readonly refreshing?: true }

/** A named failure. Its state is what `foliage brain status` would print. */
export class LocalBrainError extends Error {
  readonly state: Exclude<BrainState, "current">;
  readonly fix: string | undefined;
  readonly refreshing: boolean;
  constructor(state: Exclude<BrainState, "current">, message: string, fix?: string, refreshing = false) {
    super(message);
    this.state = state;
    this.fix = fix;
    this.refreshing = refreshing;
  }
}

const STAGE_FIX = "node tools/brain/stage-gbrain.mjs";
const REBUILD_FIX = "foliage brain rebuild";
const REFRESH_FIX = "foliage brain refresh";
/**
 * What fixes a missing or changed runtime in an installed copy, which has no staging tool: the brain
 * from the Foliage download (its vendor folder, beside runtime) added, or put back, through the
 * installer (build order item 7). Placeholders, never paths, since an agent may be shown the line;
 * `foliage brain` prints the whole command for the owner.
 */
const ADD_FIX = "node install.mjs --add-brain <the vendor folder from the Foliage download> <this Foliage folder>";
const REPLACE_FIX = "node install.mjs --replace-brain <the vendor folder from the Foliage download> <this Foliage folder>";

/**
 * What a missing or changed runtime is called and what fixes it. A checkout restages it. An installed
 * copy adds the brain from the Foliage download, or puts it back, through its installer, but only
 * where a brain ships (`brainArchiveShips`): elsewhere it says none ships yet and never names a
 * brain that does not exist. A changed `vendor/` there was put in by hand; installing the release again into a new
 * folder gives a copy without one. Pure.
 */
export function runtimeRemedy(cause: string, missing: boolean, installed: boolean, platform: string = process.platform, arch: string = process.arch): { cause: string; fix?: string } {
  if (!installed) return { cause, fix: STAGE_FIX };
  if (brainArchiveShips(platform, arch)) return { cause, fix: missing ? ADD_FIX : REPLACE_FIX };
  if (missing) return { cause: `no brain archive ships for ${platform}/${arch} yet` };
  return { cause, fix: `node install.mjs <a new folder> from the extracted Foliage release, which holds no brain (none ships for ${platform}/${arch} yet)` };
}

/**
 * What `foliage brain` tells the owner, in their own terminal, when no runtime is there: whole
 * commands, with this install's folder `root` in them. Pure.
 */
export function notInstalledAdvice(installed: boolean, root: string, platform: string = process.platform, arch: string = process.arch): string {
  if (!installed) return `Stage it in this checkout with: ${STAGE_FIX}\n`;
  if (!brainArchiveShips(platform, arch)) return `No brain archive ships for ${platform}/${arch} yet, so search uses Foliage's own search.\n`;
  return "The brain comes in the Foliage download, in the vendor folder beside its runtime folder. Add it to this install:\n"
    + `  node ${JSON.stringify(join(root, "install.mjs"))} --add-brain /absolute/path/to/the/extracted/vendor ${JSON.stringify(root)}\n`;
}

/**
 * The owner's own terminal, for `foliage brain`: node, this copy's launcher (`foliage.mjs`), its
 * folder (where its installer is) and the garden. An installed copy puts no `foliage` on PATH, so
 * every fix `foliage brain` prints there goes through `ownerFix` and runs as printed, from any
 * directory. The fixes themselves stay short and path-free: a search's answer carries them too, and
 * an agent may read that.
 */
export interface OwnerTerminal { readonly node: string; readonly launcher: string; readonly root: string; readonly garden: string }

/** A shell word, quoted as `foliage.mjs` quotes its next steps; a `<placeholder>` the owner fills in stays as it is. */
const ownerWord = (word: string) => /^<[^<>]*>$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
const ownerCommand = (words: readonly string[]) => words.map(ownerWord).join(" ");

/**
 * The commands a fix names, by the words this file writes them in: this copy's installer
 * (`ADD_FIX`, `REPLACE_FIX`), a checkout's staging tool (`STAGE_FIX`), and `foliage brain <action>`
 * with its options. One pass, so nothing a replacement writes is read again.
 */
const FIX_COMMANDS = /\bnode install\.mjs (--add-brain|--replace-brain) (<[^<>]*>) <this Foliage folder>|\bnode (tools\/brain\/stage-gbrain\.mjs)\b|\bfoliage brain (build|refresh|rebuild|status|remove|search|embed)((?: --(?:off|in-place|background|deep)| --(?:local|port|limit) [^\s,;<>]+| --garden (?:<[^<>]*>|[^\s,;<>]+))*)/g;
const BRAIN_OPTIONS = /--(off|in-place|background|deep)|--(local|port|limit) ([^\s,;<>]+)|--garden (<[^<>]*>|[^\s,;<>]+)/g;

/**
 * `fix` with every command in it as the whole command for `at`: node and this copy's launcher (or
 * installer, or staging tool) by absolute path, and `--garden` naming the garden unless the fix
 * names one itself (`<your garden>`, a garden away from the owner's own brains). The words around
 * the commands stay. Pure.
 */
export function ownerFix(fix: string, at: OwnerTerminal): string {
  return fix.replace(FIX_COMMANDS, (_whole, flag?: string, vendor?: string, stage?: string, action?: string, options?: string) => {
    if (flag !== undefined && vendor !== undefined) return ownerCommand([at.node, join(at.root, "install.mjs"), flag, vendor, at.root]);
    if (stage !== undefined) return ownerCommand([at.node, join(at.root, ...stage.split("/"))]);
    const words = ["brain", action ?? ""];
    let garden = at.garden;
    for (const option of (options ?? "").matchAll(BRAIN_OPTIONS)) {
      if (option[1] !== undefined) words.push(`--${option[1]}`);
      else if (option[2] !== undefined && option[3] !== undefined) words.push(`--${option[2]}`, option[3]);
      else if (option[4] !== undefined) garden = option[4];
    }
    return ownerCommand([at.node, at.launcher, ...words, "--garden", garden]);
  });
}

/** `status` as `foliage brain` prints it for the owner: its fix, or the one `brainLine` would name, as the whole command (`ownerFix`). Pure. */
export function ownerStatus(status: BrainStatus, at: OwnerTerminal): BrainStatus {
  const fix = status.fix ?? (status.state === "broken" ? REBUILD_FIX : status.state === "behind" && !status.refreshing ? REFRESH_FIX : undefined);
  return fix === undefined ? status : { ...status, fix: ownerFix(fix, at) };
}

/** What makes a garden's record, as the whole command for `at`: `foliage grow` from the owner's repository. Pure. */
export function ownerGrow(at: OwnerTerminal): string {
  return ownerCommand([at.node, at.launcher, "grow", "--repo", "<your repository>", "--garden", at.garden]);
}

const OWNER_FIX = "foliage brain build --garden <a garden outside ~/brain and ~/.gbrain>";
const BUILD_FIX = "foliage brain build";
/**
 * A garden with no brain yet, and what builds one: what a refresh and a search are refused with,
 * and what `foliage status` says of such a garden, so the two say it in the same words.
 */
export const NO_BRAIN = { state: "off", cause: "this garden has no brain yet", fix: BUILD_FIX } as const satisfies BrainStatus;
const noBrain = () => new LocalBrainError(NO_BRAIN.state, NO_BRAIN.cause, NO_BRAIN.fix);
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : undefined;

/**
 * A cause safe to show anywhere, an agent included: every word holding a path separator is
 * replaced, so no garden, home or page path survives. Used on gbrain's own words.
 */
export function pathFree(text: string): string {
  return text.split(/(\s+)/).map(part => /[/\\]/.test(part) ? "<path>" : part).join("");
}

/**
 * Any failure as a named one. A file-system error is named by its code alone (its message holds a
 * path); anything else is a fault in Foliage itself and is not dressed up as a brain state.
 */
function named(error: unknown): LocalBrainError {
  if (error instanceof LocalBrainError) return error;
  const code = errorCode(error);
  if (typeof code === "string") return new LocalBrainError("broken", `a brain file could not be read or written (${code})`);
  throw error;
}

/** A cause as the start of a sentence. */
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The one line `foliage brain status` and `foliage status` print. No count that ranks anything.
 * `foliage brain` prints an off brain's cause and fix on a line of their own; `foliage status` has
 * one row for the brain, so with `offCause` an off brain's cause and fix, when it has both, join it.
 */
export function brainLine(status: BrainStatus, { offCause = false }: { readonly offCause?: boolean } = {}): string {
  switch (status.state) {
    case "current": return "Brain: current";
    case "behind":
      if (status.refreshing) return "Brain: behind your record, refreshing";
      return `Brain: behind your record. ${status.cause ? `${sentence(status.cause)}. ` : ""}Run ${status.fix ?? "foliage brain refresh"}`;
    case "not-installed": return "Brain: not installed";
    case "off": return offCause && status.cause && status.fix ? `Brain: off. ${sentence(status.cause)}. Run ${status.fix}` : "Brain: off";
    case "busy": return "Brain: busy. Another Foliage process is using it; try again shortly";
    case "broken": return `Brain: broken: ${status.cause ?? "unknown cause"}. Run ${status.fix ?? "foliage brain rebuild"}`;
  }
}

/** A named failure as the status it stands for. */
export function brainFailure(error: LocalBrainError): BrainStatus {
  return { state: error.state, ...(error.message ? { cause: error.message } : {}), ...(error.fix === undefined ? {} : { fix: error.fix }),
    ...(error.refreshing ? { refreshing: true as const } : {}) };
}

/* ---- where everything lives --------------------------------------------------------------- */

export function brainPaths(garden: string) {
  if (!isAbsolute(garden)) throw new LocalBrainError("broken", "the garden path is not absolute");
  const brain = join(garden, "brain"), home = join(brain, "home"), dotGbrain = join(home, ".gbrain");
  return {
    garden, brain, home,
    config: join(dotGbrain, "config.json"), database: join(dotGbrain, "brain.pglite"), tmp: join(home, "tmp"),
    work: join(brain, "work"), bin: join(brain, "bin"), pages: join(brain, "pages"),
    manifest: join(brain, "manifest.json"), lock: join(brain, ".brain-lock"), refused: join(brain, "refused.json"),
    refreshFailure: join(brain, "refresh-failure.json"), embedding: join(brain, "embedding.json"), settingsCheck: join(brain, "settings-check.json"),
    next: join(brain, "next"), old: join(brain, "old"),
  };
}
type BrainPaths = ReturnType<typeof brainPaths>;

/**
 * A rebuild's brain, beside the live one: its own home, database, config and pages under
 * `brain/next/`, sharing the empty work and bin directories and the one lock.
 */
function stagingPaths(paths: BrainPaths): BrainPaths {
  const home = join(paths.next, "home"), dotGbrain = join(home, ".gbrain");
  return { ...paths, home, config: join(dotGbrain, "config.json"), database: join(dotGbrain, "brain.pglite"), tmp: join(home, "tmp"), pages: join(paths.next, "pages") };
}

/**
 * The garden under one spelling, links resolved, so every path derived from it (config.json's
 * `database_path` among them) is the same however the garden was named.
 */
async function realGarden(garden: string): Promise<string> {
  if (!isAbsolute(garden)) throw new LocalBrainError("broken", "the garden path is not absolute");
  let real: string;
  try { real = await realpath(garden); }
  catch (error) {
    if (errorCode(error) === "ENOENT") throw new LocalBrainError("off", "the garden does not exist");
    throw new LocalBrainError("broken", "the garden cannot be read");
  }
  if (!(await lstat(real).then(info => info.isDirectory(), () => false))) throw new LocalBrainError("broken", "the garden is not a directory");
  return real;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** The owner's own brains, for `$HOME` and for the account's home in the user database: a changed `HOME` hides neither. */
function ownerBrains(): { readonly path: string; readonly label: string }[] {
  const homes = new Set([homedir()]);
  try { homes.add(userInfo().homedir); } catch { /* no account entry: $HOME is all there is */ }
  return [...homes].flatMap(home => [{ path: join(home, ".gbrain"), label: "~/.gbrain" }, { path: join(home, "brain"), label: "~/brain" }]);
}

/** What a path names once it exists: its deepest existing ancestor with links resolved, then the rest. */
async function resolvedPath(path: string): Promise<string> {
  const rest: string[] = [];
  for (let head = path; ;) {
    try { return join(await realpath(head), ...rest); }
    catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw new LocalBrainError("broken", "the brain's location cannot be resolved");
      const parent = dirname(head);
      if (parent === head) return path;
      rest.unshift(basename(head));
      head = parent;
    }
  }
}

/**
 * THE FIRST GUARD, before anything under `<garden>/brain/` is read, made, locked or removed: the
 * brain is not, does not sit under, and does not hold the owner's own `~/.gbrain` or `~/brain`,
 * compared as named and with links resolved. A garden at `~` would otherwise make `~/brain`
 * Foliage's to clear.
 */
async function refuseOwnerBrain(paths: BrainPaths): Promise<void> {
  const ours = [paths.brain, await resolvedPath(paths.brain)];
  for (const own of ownerBrains()) {
    const theirs = [own.path, await resolvedPath(own.path)];
    if (ours.some(mine => theirs.some(other => inside(other, mine) || inside(mine, other)))) {
      throw new LocalBrainError("broken", `this garden's brain would be, sit under or hold the owner's own ${own.label}`, OWNER_FIX);
    }
  }
}

/**
 * The whole environment of every gbrain process. Nothing is inherited: no `*_API_KEY`,
 * `DATABASE_URL`, `GBRAIN_*` routing, `*_BASE_URL`, proxy, `NODE_OPTIONS` or `BUN_*` from the
 * parent can reach it. `HOME` matters as much as `GBRAIN_HOME`: a few gbrain paths ignore the
 * latter. Without `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` bun writes a transpiler cache under
 * `HOME/Library/Caches/bun`, code outside the vendor digest. bun's own crash reporter would upload
 * with a `curl` found on `PATH`; the empty `PATH` is what stops it.
 */
export function gbrainEnvironment(paths: BrainPaths): Record<string, string> {
  return {
    PATH: paths.bin,
    HOME: paths.home,
    GBRAIN_HOME: paths.home,
    TMPDIR: paths.tmp,
    GBRAIN_SELF_UPGRADE_MODE: "off",
    GBRAIN_SKIP_STARTUP_HOOKS: "1",
    GBRAIN_INIT_SKIP_EMBED_CHECK: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  };
}

/* ---- the config file, exactly ------------------------------------------------------------- */

/**
 * Keyword mode, the default. `init` writes `self_upgrade.mode: notify` and
 * `mcp.publish_skills: true`, so Foliage replaces the file it writes.
 *
 * Local-embedding mode (build order item 8, `embedding`): `embedding_disabled` gives way to the
 * owner's model, its measured dimensions, and gbrain's ollama base URL pinned to loopback by IP
 * (`http://127.0.0.1:<port>/v1`). Base URLs in this file win over the environment and the database
 * (`src/core/ai/build-gateway-config.ts:74-92`, `src/core/config.ts:771-779`), and the
 * environment holds none anyway (`gbrainEnvironment`).
 */
export function brainConfigText(paths: BrainPaths, embedding: LocalEmbedding | null = null): string {
  const model = embedding === null ? { embedding_disabled: true } : {
    embedding_model: `ollama:${embedding.model}`,
    embedding_dimensions: embedding.dimensions,
    provider_base_urls: { ollama: embedderBaseUrl(embedding.port) },
  };
  return `${JSON.stringify({
    engine: "pglite",
    database_path: paths.database,
    schema_pack: "gbrain-base-v2",
    ...model,
    self_upgrade: { mode: "off" },
    mcp: { publish_skills: false, publish_advisor: false },
    eval: { capture: false },
  }, null, 2)}\n`;
}

/** Exactly Foliage's file for this mode, or a refusal naming the key (never its value, which may be a secret). */
export async function checkBrainConfig(paths: BrainPaths, embedding: LocalEmbedding | null = null): Promise<void> {
  const expected = brainConfigText(paths, embedding);
  let actual: string;
  try {
    if (!(await lstat(paths.config)).isFile()) throw new LocalBrainError("broken", "config.json is not a regular file");
    actual = await readFile(paths.config, "utf8");
  } catch (error) {
    if (error instanceof LocalBrainError) throw error;
    throw new LocalBrainError("broken", "config.json is missing");
  }
  if (actual === expected) return;
  let parsed: unknown;
  try { parsed = JSON.parse(actual); } catch { throw new LocalBrainError("broken", "config.json is not JSON"); }
  const want = JSON.parse(expected) as Record<string, unknown>;
  const have = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  for (const key of Object.keys(have)) {
    if (!Object.hasOwn(want, key)) throw new LocalBrainError("broken", `config.json holds ${key}, which Foliage never writes`);
  }
  for (const key of Object.keys(want)) {
    if (!Object.hasOwn(have, key)) throw new LocalBrainError("broken", `config.json is missing ${key}`);
    if (JSON.stringify(have[key]) !== JSON.stringify(want[key])) throw new LocalBrainError("broken", `config.json ${key} differs from Foliage's`);
  }
  throw new LocalBrainError("broken", "config.json is not the file Foliage wrote");
}

/* ---- the settings gbrain keeps in its database --------------------------------------------- */

/**
 * Keyword mode. Each stops a path named in the spec's table; the five `search.*` keys and
 * `autopilot.auto_drain.enabled` were accepted without `--force` (measured); the other three are
 * unknown to gbrain's key registry and need it, though `facts.extraction_enabled` is read by
 * `src/core/facts/extract.ts`. `auto_link` and `auto_timeline` are defence in depth only.
 */
const KEYWORD_SETTINGS = Object.freeze([
  { key: "search.mode", value: "conservative", force: false },
  { key: "search.reranker.enabled", value: "false", force: false },
  { key: "search.mcp_keyword_only", value: "true", force: false },
  { key: "search.cache.enabled", value: "false", force: false },
  { key: "search.track_retrieval", value: "false", force: false },
  { key: "facts.extraction_enabled", value: "false", force: true },
  { key: "autopilot.auto_drain.enabled", value: "false", force: false },
  { key: "auto_link", value: "false", force: true },
  { key: "auto_timeline", value: "false", force: true },
] as const);

/**
 * Local-embedding mode (build order item 8): the same switches, except that the `search` op takes
 * gbrain's hybrid path (keyword and vector lists fused) instead of keyword only. On that path the
 * op forces query expansion off (`src/core/operations.ts:1888-1897`), conservative mode leaves the
 * reranker, graph signals and LLM intent off (`src/core/search/mode.ts:287-330`), and the query
 * cache stays off, so the only model it asks is the owner's local embedder, for the query text.
 */
const LOCAL_SETTINGS = Object.freeze(KEYWORD_SETTINGS.map(entry => entry.key === "search.mcp_keyword_only" ? { ...entry, value: "false" } : entry));

const settingsFor = (embedding: LocalEmbedding | null) => embedding === null ? KEYWORD_SETTINGS : LOCAL_SETTINGS;

/** The database can name provider base URLs and models when the file names none. Any row is a failure. */
const FORBIDDEN_DATABASE_PREFIXES: readonly string[] = ["provider_base_urls.", "models."];

/**
 * In local-embedding mode, also every database key that could move the embedding elsewhere: gbrain
 * reads `embedding_multimodal`, `embedding_multimodal_model`, `embedding_image_ocr`,
 * `embedding_image_ocr_model`, `embedding_columns` and `search_embedding_column` from the database
 * when the file names none (`src/core/config.ts:742-790`); an `embedding_columns` row could send a
 * search's query embedding to another provider or port. gbrain writes none of them in any command
 * Foliage runs. Not a bare `embedding_` prefix: the schema itself seeds `embedding_model` and
 * `embedding_dimensions` rows (`src/core/pglite-schema.ts:427-433`), which size nothing at runtime
 * (the file does) and must not read as planted. (#203 deviation 9.)
 */
const LOCAL_FORBIDDEN_PREFIXES: readonly string[] = [...FORBIDDEN_DATABASE_PREFIXES, "embedding_multimodal", "embedding_image_ocr", "embedding_columns", "search_embedding_column"];

const forbiddenFor = (embedding: LocalEmbedding | null) => embedding === null ? FORBIDDEN_DATABASE_PREFIXES : LOCAL_FORBIDDEN_PREFIXES;

/* ---- the commands Foliage runs, and nothing else -------------------------------------------- */

const BRAIN_CALL_OPS: readonly string[] = Object.freeze(["search", "get_page", "list_pages", "get_versions", "delete_page", "purge_deleted_pages"]);

export type GbrainCommand =
  | { readonly kind: "version" }
  | { readonly kind: "init" }
  | { readonly kind: "import" }
  | { readonly kind: "embed" }
  | { readonly kind: "config-get"; readonly key: string }
  | { readonly kind: "config-set"; readonly key: string }
  | { readonly kind: "config-unset"; readonly prefix: string }
  | { readonly kind: "call"; readonly op: string; readonly params: Readonly<Record<string, unknown>> };

function setting(key: string, embedding: LocalEmbedding | null) {
  const found = settingsFor(embedding).find(entry => entry.key === key);
  if (!found) throw new LocalBrainError("broken", `gbrain config ${key} is not a setting Foliage reads or writes`);
  return found;
}

/**
 * The argument list after `--brain host`, or a refusal before anything starts. Values for
 * `config set` come from the table for the brain's mode, never from the caller. With `embedding`
 * (local-embedding mode, build order item 8), `init` sizes the embedding column for the owner's
 * model (`--skip-embed-check`, as `GBRAIN_INIT_SKIP_EMBED_CHECK=1` already says, so init asks no
 * model), and `embed --stale --source default` embeds what the import added; in keyword mode
 * `embed` is refused.
 */
export function gbrainArgs(paths: BrainPaths, command: GbrainCommand, embedding: LocalEmbedding | null = null): string[] {
  switch (command.kind) {
    case "version": return ["--version"];
    case "init":
      if (embedding === null) return ["init", "--pglite", "--no-embedding", "--non-interactive", "--path", paths.database];
      return ["init", "--pglite", "--embedding-model", `ollama:${embedding.model}`, "--embedding-dimensions", String(embedding.dimensions),
        "--skip-embed-check", "--non-interactive", "--path", paths.database];
    case "import": return ["import", paths.pages, "--no-embed", "--fresh", "--include-gitignored", "--source-id", "default"];
    case "embed":
      if (embedding === null) throw new LocalBrainError("broken", "gbrain embed is not a command Foliage runs in keyword mode");
      return ["embed", "--stale", "--source", "default"];
    case "config-get": return ["config", "get", setting(command.key, embedding).key];
    case "config-set": {
      const entry = setting(command.key, embedding);
      return ["config", "set", entry.key, entry.value, ...(entry.force ? ["--force"] : [])];
    }
    case "config-unset":
      if (!forbiddenFor(embedding).includes(command.prefix)) throw new LocalBrainError("broken", `gbrain config unset ${command.prefix} is not a command Foliage runs`);
      return ["config", "unset", "--pattern", command.prefix];
    case "call":
      if (!BRAIN_CALL_OPS.includes(command.op)) throw new LocalBrainError("broken", `gbrain op ${command.op} is not one Foliage runs`);
      return ["call", "--source", "default", command.op, JSON.stringify(command.params)];
    default:
      throw new LocalBrainError("broken", `gbrain ${String((command as { kind?: unknown }).kind)} is not a command Foliage runs`);
  }
}

/* ---- the brain lock ------------------------------------------------------------------------ */

interface LockRecord { readonly pid: number; readonly token: string; readonly startedAt: string; readonly child?: number; readonly refreshing?: true }

export interface BrainLock {
  /** Records the running gbrain child, so a reclaimer waits for an orphan of a killed holder. */
  setChild(pid: number | null): Promise<void>;
  /** Records that this holder is bringing the brain up to its record, so a status or search that finds the lock held can say "refreshing". */
  setRefreshing(): Promise<void>;
  release(): Promise<void>;
}

/** Only `ESRCH` means gone; `EPERM` is somebody else's live process. A reused pid looks held. */
function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return errorCode(error) !== "ESRCH"; }
}

/** Held while its process, or the gbrain child it recorded, is alive. */
const isHeld = (record: LockRecord) => alive(record.pid) || (record.child !== undefined && alive(record.child));

async function readLock(path: string): Promise<LockRecord | "absent" | "unreadable"> {
  let text: string;
  try { text = await readlink(path); }
  catch (error) { return errorCode(error) === "ENOENT" ? "absent" : "unreadable"; }
  try {
    const value = JSON.parse(text) as Partial<LockRecord>;
    if (typeof value.pid !== "number" || typeof value.token !== "string" || typeof value.startedAt !== "string") return "unreadable";
    if (value.child !== undefined && typeof value.child !== "number") return "unreadable";
    if (value.refreshing !== undefined && value.refreshing !== true) return "unreadable";
    return value as LockRecord;
  } catch { return "unreadable"; }
}

/**
 * THE LOCK IS A SYMBOLIC LINK whose target is the holder's record. Creating one is exclusive and
 * sets its whole content in one step, so nobody ever reads a half-written lock; replacing one is a
 * rename. Not a hard link: measured on macOS (Darwin 27) under the offline gate's profile, which
 * denies all outbound network with SIGKILL, `link(2)` is killed (no deny line is logged), while the
 * same call succeeds under a plain network deny.
 */
async function publishLock(path: string, record: LockRecord, exclusive: boolean): Promise<boolean> {
  const target = JSON.stringify(record);
  if (exclusive) {
    try { await symlink(target, path); return true; }
    catch (error) { if (errorCode(error) === "EEXIST") return false; throw error; }
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  await symlink(target, temp);
  try { await rename(temp, path); }
  catch (error) { await unlink(temp).catch(() => undefined); throw error; }
  return true;
}

/**
 * Replace a dead holder's lock with this process's own, and never move a live one.
 *
 * The right to replace the lock holding token T belongs to whoever first creates
 * `.brain-lock.claim-T` (exclusive). The claimant re-reads the lock and renames its own record
 * over it only if it still holds T. Nothing else can change a lock holding T in between: T's
 * holder is dead, exclusive creation fails while the path exists, and every other reclaimer of T
 * lost the claim. The claim is removed only after the lock has moved past T, so a slow reclaimer
 * that creates it again finds another token and stops. A claimant killed while it holds a claim
 * is itself a dead holder, so its claim is reclaimed the same way one level down (two at most).
 */
async function reclaimLock(path: string, stale: LockRecord, mine: LockRecord, depth = 0): Promise<boolean> {
  const claim = `${path}.claim-${stale.token}`;
  if (!(await publishLock(claim, mine, true))) {
    const holder = await readLock(claim);
    if (depth >= 2 || typeof holder !== "object" || isHeld(holder) || !(await reclaimLock(claim, holder, mine, depth + 1))) return false;
  }
  try {
    const current = await readLock(path);
    if (typeof current !== "object" || current.token !== stale.token) return false;
    await publishLock(path, mine, false);
    return true;
  } finally { await unlink(claim).catch(() => undefined); }
}

/**
 * Once this process holds the lock nobody else can be part-way through replacing it, so anything
 * named `.brain-lock.*` beside it (a claim or a temporary link left by a killed process) is debris.
 */
async function clearLockDebris(path: string): Promise<void> {
  const dir = dirname(path), prefix = `${basename(path)}.`;
  for (const name of await readdir(dir)) if (name.startsWith(prefix)) await unlink(join(dir, name)).catch(() => undefined);
}

/**
 * `<garden>/brain/.brain-lock`: pid, token and start time, plus the running gbrain child. Waiting
 * polls for up to `waitMs` (5 s). Reclaimed only when the recorded pid, and any recorded child, is
 * gone (`process.kill(pid, 0)` fails with `ESRCH`), the rule gbrain's own PGLite lock uses.
 */
export async function acquireBrainLock(path: string, { waitMs = 5_000, pollMs = 100 }: { waitMs?: number; pollMs?: number } = {}): Promise<BrainLock> {
  const token = randomUUID();
  const mine: LockRecord = { pid: process.pid, token, startedAt: new Date().toISOString() };
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      if (await publishLock(path, mine, true)) break;
      const held = await readLock(path);
      if (held === "absent") continue;
      if (held !== "unreadable" && !isHeld(held) && await reclaimLock(path, held, mine)) break;
      if (Date.now() >= deadline) {
        throw new LocalBrainError("busy", held === "unreadable" ? "the brain lock cannot be read, so it was left in place"
          : isHeld(held) ? `process ${alive(held.pid) ? held.pid : held.child} holds the brain lock`
            : "the brain lock's holder is gone and another process is taking it over");
      }
      await sleep(pollMs);
    }
    await clearLockDebris(path);
  } catch (error) {
    if (error instanceof LocalBrainError) throw error;
    throw new LocalBrainError("broken", "the brain lock cannot be written");
  }
  let child: number | null = null, refreshing = false;
  const republish = async () => {
    const current = await readLock(path);
    if (!(typeof current === "object" && current.token === token)) throw new LocalBrainError("broken", "the brain lock was taken from this process");
    try {
      await publishLock(path, { pid: current.pid, token, startedAt: current.startedAt, ...(child === null ? {} : { child }), ...(refreshing ? { refreshing: true as const } : {}) }, false);
    } catch { throw new LocalBrainError("broken", "the brain lock cannot be written"); }
  };
  return {
    async setChild(pid) {
      child = pid;
      await republish();
    },
    async setRefreshing() {
      if (refreshing) return;
      refreshing = true;
      await republish();
    },
    async release() {
      const current = await readLock(path);
      if (typeof current === "object" && current.token === token) await unlink(path).catch(() => undefined);
    },
  };
}

/* ---- the one spawn function ------------------------------------------------------------------ */

/** `installed`: the runtime of an installed copy, whose fixes go through its installer (`installedRuntime`). */
interface Runtime { readonly vendor: string; readonly manifest: VendorManifest; readonly installed: boolean }
/** `embedding`: the mode of the brain this session works on (null: keyword), which its config.json and settings must match. */
interface Session { readonly paths: BrainPaths; readonly runtime: Runtime; readonly lock: BrainLock; readonly embedding: LocalEmbedding | null }
interface RunOptions { readonly timeoutMs?: number; readonly outputCap?: number }

/**
 * Whether `vendor` is an installed copy's rather than a checkout's: the folder holding it has the
 * main release's `release.json` and its installer, which a checkout never has at its root.
 */
export async function installedRuntime(vendor: string): Promise<boolean> {
  const root = dirname(vendor);
  return await exists(join(root, "release.json")) && await exists(join(root, "install.mjs"));
}

/** The staged runtime, its pins and every staged file's digest; "not installed" when nothing is staged. */
async function openRuntime(vendor: string): Promise<Runtime> {
  return checkedRuntime(await stagedRuntime(vendor));
}

/**
 * What `foliage brain remove` says once the brain is gone, which needs no runtime to remove: the
 * runtime's own state, checked as every other command checks it. `off` when it is there and
 * unchanged, `not-installed` when nothing is staged, `broken` with its cause and fix otherwise.
 */
export async function runtimeStatus(vendor: string): Promise<BrainStatus> {
  try {
    await openRuntime(vendor);
    return { state: "off" };
  } catch (error) { return brainFailure(named(error)); }
}

/** The staged runtime's pins, read without hashing anything; "not installed" when nothing is staged. */
async function stagedRuntime(vendor: string): Promise<Runtime> {
  // bun is started by absolute path, never looked up on PATH.
  if (!isAbsolute(vendor)) throw new LocalBrainError("broken", "the staged runtime's path is not absolute", STAGE_FIX);
  const installed = await installedRuntime(vendor);
  try { return { vendor, manifest: await readVendorManifest(vendor), installed }; }
  catch (error) { throw vendorFailure(error, installed); }
}

/**
 * The staged runtime once every staged file matches its digest: the two entry files first, then the
 * whole tree, the check `foliage brain status` has always made. Every command that runs or reads the
 * brain makes it (build, refresh, rebuild, embed, a search, the glance and status), so none runs on,
 * or calls current, a runtime with a changed, added or missing file anywhere under `vendor/`: a
 * search answers from Foliage's own search naming the file, and the others refuse naming it.
 * Measured 2026-10-13 on macOS arm64: 0.7 s warm and 1.3 s cold for the whole tree (about 12,900
 * files, 335 MB), 0.05 s for the two entry files.
 */
async function checkedRuntime(runtime: Runtime): Promise<Runtime> {
  try {
    await verifyVendorEntries(runtime.vendor, runtime.manifest);
    await verifyVendorTree(runtime.vendor, runtime.manifest);
  } catch (error) { throw vendorFailure(error, runtime.installed); }
  return runtime;
}

/** A vendor problem as the brain's state, with the fix for a checkout or for an installed copy. */
function vendorFailure(error: unknown, installed: boolean): unknown {
  if (!(error instanceof BrainVendorError)) return error;
  const { cause, fix } = runtimeRemedy(error.message, error.missing, installed);
  return new LocalBrainError(error.missing ? "not-installed" : "broken", cause, fix);
}

/**
 * Every directory Foliage keeps under `brain/` is a real directory where it exists, never a link
 * and never a file: a link would carry a page write, a sweep, an import, gbrain's home, its
 * database or its temporary files somewhere else, such as the owner's own `~/brain`. Checked before
 * a refresh plans anything and before every process starts; a refused brain is rebuilt.
 */
async function checkBrainDirectories(paths: BrainPaths): Promise<void> {
  const dotGbrain = dirname(paths.config);
  for (const path of [paths.home, dotGbrain, paths.database, paths.tmp, paths.work, paths.bin, paths.pages, join(paths.pages, "foliage")]) {
    const label = `brain/${relative(paths.brain, path)}`;
    let info;
    try { info = await lstat(path); }
    catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw new LocalBrainError("broken", `${label} cannot be read`);
    }
    if (info.isSymbolicLink()) throw new LocalBrainError("broken", `${label} is a symbolic link`);
    if (!info.isDirectory()) throw new LocalBrainError("broken", `${label} is not a directory`);
  }
}

/** THE SECOND GUARD, before every process: `GBRAIN_HOME` resolves inside the garden and away from the owner's own brains. */
async function checkHome(paths: BrainPaths): Promise<void> {
  let garden: string, home: string;
  try {
    if ((await lstat(paths.brain)).isSymbolicLink()) throw new LocalBrainError("broken", "brain/ is a symbolic link");
    await checkBrainDirectories(paths);
    garden = await realpath(paths.garden);
    home = await realpath(paths.home);
  } catch (error) {
    if (error instanceof LocalBrainError) throw error;
    throw new LocalBrainError("broken", errorCode(error) === "ENOENT" ? "the brain's home is missing" : "the brain's home cannot be read");
  }
  if (!inside(garden, home)) throw new LocalBrainError("broken", "the brain's home resolves outside the garden");
  for (const own of ownerBrains()) {
    if (inside(own.path, home) || inside(await resolvedPath(own.path), home)) throw new LocalBrainError("broken", `the brain's home is inside the owner's own ${own.label}`, OWNER_FIX);
  }
}

/** What a file in each could do: work/ is bun's working directory, bin/ the whole PATH. */
const WORK_WHY = "bun would read a .env or bunfig.toml there";
const BIN_WHY = "it is the whole PATH of every gbrain process, so a program there could be started";

/** `why` says what a file there could do (`WORK_WHY`, `BIN_WHY`). */
async function assertEmpty(dir: string, label: string, why: string): Promise<void> {
  let names: string[];
  try { names = await readdir(dir); } catch { throw new LocalBrainError("broken", `${label} is missing`); }
  if (names.length > 0) throw new LocalBrainError("broken", `${label} is not empty, and ${why}`);
}

/** Checked before every process starts. */
async function checkBeforeStart(session: Session, command: GbrainCommand): Promise<void> {
  try { await verifyVendorEntries(session.runtime.vendor, session.runtime.manifest); }
  catch (error) { throw vendorFailure(error, session.runtime.installed); }
  const { paths } = session;
  await checkHome(paths);
  await assertEmpty(paths.work, "brain/work", WORK_WHY);
  await assertEmpty(paths.bin, "brain/bin", BIN_WHY);
  if (command.kind === "init") {
    if (await lstat(paths.config).then(() => true, () => false)) throw new LocalBrainError("broken", "init would run over an existing config.json");
    // Every new database starts here: not where an empty brain would not fit (spec, "Preflight").
    const room = roomProblem(await freeBytes(paths.brain), EMPTY_BRAIN_BYTES, "the garden's disk");
    if (room !== null) throw new LocalBrainError("broken", room, `${BUILD_FIX} once more disk is free`);
  } else if (command.kind !== "version") await checkBrainConfig(paths, session.embedding);
}

function commandLabel(args: readonly string[]): string {
  return args[0] === "call" ? `call ${args[3]}` : args[0] === "config" ? args.slice(0, 3).join(" ") : args[0] ?? "";
}

interface Ran { readonly label: string; readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly stdout: string; readonly stderr: string }

/**
 * A gbrain process that started and then failed: it exited non-zero, was stopped for its time or
 * output, or could not run. Not a check Foliage made before starting it, which stays a plain
 * `LocalBrainError`. `embed --stale` tells the two apart (`embedStale`).
 */
class GbrainProcessFailure extends LocalBrainError {}

/** How a finished process failed, with gbrain's last line and any path taken out. */
function exitFailure(ran: Ran): LocalBrainError {
  const last = ran.stderr.trim().split("\n").filter(Boolean).at(-1);
  const excerpt = last === undefined ? "" : pathFree(last).slice(0, 200);
  return new GbrainProcessFailure("broken", `gbrain ${ran.label} ${ran.signal ? `stopped by ${ran.signal}` : `exited ${ran.code}`}${excerpt ? ` (${excerpt})` : ""}`);
}

/** THE ONE WAY a gbrain process starts, through `spawnGbrain`; any exit but 0 is a named failure. */
async function runGbrain(session: Session, command: GbrainCommand, options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const ran = await spawnGbrain(session, command, options);
  if (ran.code !== 0) throw exitFailure(ran);
  return ran;
}

/**
 * Arguments go as a list, never through a shell. A process stopped for its time or output, or one
 * that could not start, is a named failure; how it exited is the caller's to judge.
 */
async function spawnGbrain(session: Session, command: GbrainCommand, { timeoutMs = 120_000, outputCap = 4 * 1024 * 1024 }: RunOptions = {}): Promise<Ran> {
  const args = gbrainArgs(session.paths, command, session.embedding);
  await checkBeforeStart(session, command);
  await custodyBefore(session, command);
  const label = commandLabel(args);
  const layout = vendorLayout(session.runtime.vendor);
  const child = spawn(layout.bun, ["--no-install", "--no-env-file", layout.cli, "--brain", "host", ...args], {
    cwd: session.paths.work, env: gbrainEnvironment(session.paths), stdio: ["ignore", "pipe", "pipe"], shell: false,
  });
  const out: Buffer[] = [], err: Buffer[] = [];
  let bytes = 0;
  let stopped: string | null = null;
  const stop = (why: string) => { if (stopped === null) { stopped = why; child.kill("SIGKILL"); } };
  const collect = (into: Buffer[]) => (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > outputCap) stop(`wrote more than ${outputCap} bytes`);
    else into.push(chunk);
  };
  child.stdout.on("data", collect(out));
  child.stderr.on("data", collect(err));
  const timer = setTimeout(() => stop(`did not finish within ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    if (child.pid !== undefined) await session.lock.setChild(child.pid);
    const { code, signal } = await finished;
    const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
    if (stopped !== null) throw new GbrainProcessFailure("broken", `gbrain ${label} ${stopped}`);
    return { label, code, signal, stdout, stderr };
  } catch (error) {
    stop("was stopped");
    if (error instanceof LocalBrainError) throw error;
    throw new GbrainProcessFailure("broken", `gbrain ${label} could not run: ${pathFree(String(errorCode(error) ?? (error instanceof Error ? error.message : error)))}`);
  } finally {
    clearTimeout(timer);
    await finished.catch(() => undefined);
    await session.lock.setChild(null).catch(() => undefined);
    await custodyAfter(session, command);
  }
}

/* ---- the settings as last read back, and the database as it has been since (B3) ------------- */

/**
 * WHY `foliage brain status` NO LONGER STARTS ELEVEN PROCESSES EVERY TIME. Reading every database
 * setting back is one gbrain process per setting and per forbidden prefix (nine and two in keyword
 * mode, nine and six with local embeddings), each a fresh bun opening PGLite: 8.5–8.6 s for a whole
 * status, measured 2026-10-13 on macOS arm64 before this record existed. Those settings can only change through a process that
 * writes the database, and PGLite writes it whenever it opens it, even to read (measured: one
 * status's read-back moved `global/pg_control`, the WAL and five more entries under
 * `brain.pglite/`). So the database files' identity says whether anything has opened it.
 *
 * After a read-back that passes, Foliage records the database's identity with the mode it was read
 * back for (`brain/settings-check.json`). Before each later gbrain process of its own it checks that
 * the database is still exactly what it recorded, and after the process it records the database
 * again: its own processes (an import, a page op, a search) are allowlisted and set no setting, so
 * the read-back still holds. Anything else that opens the database, between two processes or between
 * two commands, changes the identity, and from then on nothing is recorded until a read-back passes
 * again. `foliage brain status` reads the settings back only when the identity is not the one
 * recorded (or with `--deep`); otherwise it makes every check the first process of a read-back would
 * (directories, home, config.json, the empty work and bin) and starts nothing. A build and a rebuild
 * read every setting back as before; a refresh and a search keep the record going, never start one.
 *
 * The identity is every entry under `brain.pglite/` by path, type, inode, size, modification time and
 * status-change time (nanoseconds). A process that rewrote a file and set its times back would still
 * move its status-change time, which no process can set.
 */
interface Custody { readonly identity: string; readonly embedding: LocalEmbedding | null }

/** Per hold of the brain lock, per database path (the live one, and a rebuild's in brain/next/): what Foliage last recorded, or null when nothing is. */
const custodies = new WeakMap<BrainLock, Map<string, Custody | null>>();
function custodyOf(lock: BrainLock): Map<string, Custody | null> {
  let held = custodies.get(lock);
  if (held === undefined) custodies.set(lock, held = new Map());
  return held;
}

/** The live brain's paths, not a rebuild's under brain/next/: only the live database's record is written down. */
const isLive = (paths: BrainPaths) => paths.home === join(paths.brain, "home");

/** The database files' identity (see above); every entry is read with lstat, so no link is followed. */
async function databaseIdentity(database: string): Promise<string> {
  const hash = createHash("sha256");
  const note = (at: string, info: import("node:fs").BigIntStats) =>
    hash.update(`${at}\0${info.mode}\0${info.ino}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\n`);
  note(".", await lstat(database, { bigint: true }));
  const walk = async (dir: string, at: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), here = at === "" ? name : `${at}/${name}`;
      const info = await lstat(path, { bigint: true });
      note(here, info);
      if (info.isDirectory()) await walk(path, here);
    }
  };
  await walk(database, "");
  return hash.digest("hex");
}

const identityNow = (paths: BrainPaths) => databaseIdentity(paths.database).catch(() => null);

/** What `settings-check.json` recorded, or null when there is no record Foliage would have written for this gbrain. Never throws. */
async function recordedCustody(paths: BrainPaths): Promise<Custody | null> {
  try {
    const bytes = await boundedBytes(paths.brain, "settings-check.json", 64 * 1024);
    if (bytes === null) return null;
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (value["schemaVersion"] !== 1 || typeof value["database"] !== "string" || !/^[0-9a-f]{64}$/.test(value["database"]) || value["gbrain"] !== GBRAIN_PIN.commit) return null;
    if (value["mode"] === "keyword" && value["embedding"] === undefined) return { identity: value["database"], embedding: null };
    if (value["mode"] === "local-embedding") return { identity: value["database"], embedding: parseLocalEmbedding(value["embedding"]) };
    return null;
  } catch { return null; }
}

function writeCustody(paths: BrainPaths, custody: Custody): void {
  writeDocument(paths.settingsCheck, `${JSON.stringify({
    schemaVersion: 1, database: custody.identity,
    ...(custody.embedding === null ? { mode: "keyword" } : { mode: "local-embedding", embedding: custody.embedding }),
    gbrain: GBRAIN_PIN.commit, checkedAt: new Date().toISOString(),
  })}\n`, true);
}

const dropCustody = (paths: BrainPaths) => rm(paths.settingsCheck, { force: true }).catch(() => undefined);

/** The record on disk, when the database is still exactly the one it names. */
async function custodyStillHeld(paths: BrainPaths): Promise<Custody | null> {
  const recorded = await recordedCustody(paths);
  return recorded !== null && recorded.identity === await identityNow(paths) ? recorded : null;
}

/**
 * Whether `foliage brain status` may take the settings as last read back: the record names this
 * mode and the database is exactly as recorded. Called only after every check a process would make.
 */
async function settingsStillRead(session: Session): Promise<boolean> {
  const held = await custodyStillHeld(session.paths);
  if (held === null || !sameEmbedding(held.embedding, session.embedding)) return false;
  custodyOf(session.lock).set(session.paths.database, held);
  return true;
}

/** Before a gbrain process of Foliage's own: the database is still what was recorded, or nothing is recorded from now on. */
async function custodyBefore(session: Session, command: GbrainCommand): Promise<void> {
  if (command.kind === "version") return;
  const held = custodyOf(session.lock), database = session.paths.database;
  const previous = held.get(database);
  let custody: Custody | null;
  // A database init makes is new, and a setting Foliage sets is not read back yet: nothing is
  // recorded for the database until its settings are.
  if (command.kind === "init" || command.kind === "config-set") custody = null;
  else if (previous === undefined) custody = isLive(session.paths) ? await custodyStillHeld(session.paths) : null;
  else custody = previous !== null && previous.identity === await identityNow(session.paths) ? previous : null;
  held.set(database, custody);
  if (custody === null && previous !== null && isLive(session.paths)) await dropCustody(session.paths);
}

/** After a gbrain process of Foliage's own, which set no setting: the database as it now is, recorded. */
async function custodyAfter(session: Session, command: GbrainCommand): Promise<void> {
  if (command.kind === "version") return;
  const held = custodyOf(session.lock), database = session.paths.database;
  const previous = held.get(database);
  if (previous === undefined || previous === null) return;
  const identity = await identityNow(session.paths);
  const custody = identity === null ? null : { identity, embedding: previous.embedding };
  held.set(database, custody);
  if (!isLive(session.paths)) return;
  if (custody === null) await dropCustody(session.paths);
  else writeCustody(session.paths, custody);
}

/**
 * Every setting of the brain's mode reads back as written, and the database names no provider URL
 * or model (in local-embedding mode, no embedding key either). Once they do, the database as it then
 * is is recorded as read back (see above); while they are being read, and after a failure, nothing is.
 */
async function checkBrainSettings(session: Session): Promise<void> {
  const held = custodyOf(session.lock), database = session.paths.database;
  if (held.get(database) !== null && isLive(session.paths)) await dropCustody(session.paths);
  held.set(database, null);
  for (const entry of settingsFor(session.embedding)) {
    const { stdout } = await runGbrain(session, { kind: "config-get", key: entry.key });
    if (stdout.trim() !== entry.value) throw new LocalBrainError("broken", `the brain's ${entry.key} setting does not read back as ${entry.value}`);
  }
  for (const prefix of forbiddenFor(session.embedding)) {
    const { stdout } = await runGbrain(session, { kind: "config-unset", prefix });
    if (stdout.trim() !== `No keys match prefix "${prefix}".`) {
      const rows = stdout.split("\n").flatMap(line => /^\s+- (\S+)\s*$/.exec(line)?.[1] ?? []);
      const cause = pathFree(`the brain's database named ${rows.join(", ") || `rows under ${prefix}`}, now removed; it stays unused until rebuilt`);
      // The unset removed the evidence, so the refusal is written down: the next check must not
      // find a clean database and call the brain current.
      writeDocument(session.paths.refused, `${JSON.stringify({ cause })}\n`, true);
      throw new LocalBrainError("broken", cause);
    }
  }
  const identity = await identityNow(session.paths);
  if (identity === null) return;
  const custody = { identity, embedding: session.embedding };
  held.set(database, custody);
  if (isLive(session.paths)) writeCustody(session.paths, custody);
}

/**
 * `gbrain call` prints its answer as indented JSON (`src/commands/call.ts`). Anything an op logs to
 * stdout comes before it, so when the whole output is not JSON, the answer is the last line that
 * opens an object or list at the margin and parses through to the end.
 */
function callAnswer(stdout: string, op: string): unknown {
  try { return JSON.parse(stdout); } catch { /* look for where the answer starts */ }
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!/^[[{]/.test(lines[index] ?? "")) continue;
    try { return JSON.parse(lines.slice(index).join("\n")); } catch { /* an earlier line, then */ }
  }
  throw new LocalBrainError("broken", `gbrain ${op} did not answer in JSON`);
}

/** gbrain's own words for a page that is not there, deleted or purged (`get_page`, `delete_page`). */
const PAGE_NOT_FOUND = /^Page not found: /m;

/**
 * One allowed op through `spawnGbrain`. With `missing`, a page that is not there answers `null`
 * instead of failing: a purged page, or one an earlier, killed run already removed.
 */
async function call(session: Session, op: string, params: Readonly<Record<string, unknown>>, { missing = false, ...run }: RunOptions & { missing?: boolean } = {}): Promise<unknown> {
  const ran = await spawnGbrain(session, { kind: "call", op, params }, run);
  if (ran.code === 0) return callAnswer(ran.stdout, op);
  if (missing && ran.code === 1 && PAGE_NOT_FOUND.test(ran.stderr)) return null;
  throw exitFailure(ran);
}

/* ---- the record, read once ------------------------------------------------------------------- */

/**
 * The record as read once: both documents parsed, and the sha256 of the exact bytes each was
 * parsed from (`harvestSha256` null when there is no harvest). A brain answers only for these bytes.
 */
export interface GardenRecord {
  readonly leaf: Leaf;
  readonly harvest: HarvestDocument | null;
  readonly leafSha256: string;
  readonly harvestSha256: string | null;
}

/**
 * One document's bytes, or null when it is absent: never through a link, never from a FIFO or a
 * device (`O_NONBLOCK`, then a regular-file check), and never past `cap` bytes.
 */
async function boundedBytes(dir: string, name: string, cap = IMPORT_DOCUMENT_BYTES): Promise<Buffer | null> {
  let file;
  try { file = await open(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (errorCode(error) === "ENOENT") return null; throw new LocalBrainError("broken", `${name} cannot be read`); }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > cap) throw new LocalBrainError("broken", `${name} is not a regular document within ${cap} bytes`);
    return await file.readFile();
  } finally { await file.close(); }
}

/** The sha256 of a record document's exact bytes, as a manifest and a refresh note hold it. */
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function documentJson(bytes: Buffer, name: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new LocalBrainError("broken", `${name} is not valid JSON`); }
}

/** `leaf.json` and `harvest.json`, each read once and hashed. The brain never writes either. */
async function readGardenRecord(garden: string): Promise<GardenRecord | null> {
  const leafBytes = await boundedBytes(garden, "leaf.json");
  const harvestBytes = await boundedBytes(garden, "harvest.json");
  if (leafBytes === null) {
    if (harvestBytes !== null) throw new LocalBrainError("broken", "leaf.json is missing while harvest.json remains");
    return null;
  }
  const leaf = parseLeafDocument(documentJson(leafBytes, "leaf.json"));
  if (!leaf.ok || leaf.declaredExample) throw new LocalBrainError("broken", "leaf.json is not a valid real Leaf");
  let harvest: HarvestDocument | null = null;
  if (harvestBytes !== null) {
    const parsed = parseHarvestDocument(documentJson(harvestBytes, "harvest.json"));
    if (!parsed.ok) throw new LocalBrainError("broken", "harvest.json is not valid");
    harvest = parsed.harvest;
  }
  return { leaf: leaf.leaf, harvest, leafSha256: sha256(leafBytes), harvestSha256: harvestBytes === null ? null : sha256(harvestBytes) };
}

/* ---- the manifest: Foliage's own record of the brain, written last --------------------------- */

interface BrainManifest {
  readonly schemaVersion: 2;
  readonly leafId: string;
  readonly subject: string;
  readonly leafSha256: string;
  readonly harvestSha256: string | null;
  /** The mode it was built in; `embedding` only in local-embedding mode (build order item 8). */
  readonly mode: "keyword" | "local-embedding";
  readonly embedding?: LocalEmbedding;
  /**
   * Local-embedding mode only: the pages are exactly the record's, but the last refresh or rebuild
   * could not embed them all (its embedder was not answering, or the embed failed), so a search
   * does not read the brain until a refresh's `embed --stale` has caught up (`upToDate`).
   */
  readonly unembedded?: true;
  readonly gbrain: { readonly version: string; readonly commit: string; readonly integrity: string };
  /** Every page: its slug, its record, its `foliage_digest`, and whether it is an excluded leaflet's. */
  readonly pages: Readonly<Record<string, BrainManifestPage>>;
}

const manifestPage = (value: unknown) => value !== null && typeof value === "object"
  && typeof (value as BrainManifestPage).record === "string" && typeof (value as BrainManifestPage).digest === "string"
  && [undefined, true].includes((value as BrainManifestPage).excluded) && [undefined, true].includes((value as BrainManifestPage).unconfirmed);

/** A manifest's mode: keyword with no embedding, or local-embedding with a choice Foliage wrote. */
function manifestMode(value: Partial<BrainManifest>): boolean {
  if (value.mode === "keyword") return value.embedding === undefined && value.unembedded === undefined;
  if (value.mode !== "local-embedding" || ![undefined, true].includes(value.unembedded)) return false;
  try { parseLocalEmbedding(value.embedding); return true; } catch { return false; }
}

/** The local embedding a brain was built with, or null for a keyword brain. */
const builtEmbedding = (manifest: BrainManifest): LocalEmbedding | null => manifest.embedding ?? null;

/** Schema 1 was item 2's page format; a brain built with it is rebuilt. */
async function readBrainManifest(paths: BrainPaths): Promise<BrainManifest> {
  let value: Partial<BrainManifest>;
  try { value = JSON.parse(await readFile(paths.manifest, "utf8")) as Partial<BrainManifest>; }
  catch { throw new LocalBrainError("broken", "manifest.json cannot be read"); }
  if (value.schemaVersion !== 2 || typeof value.leafId !== "string" || typeof value.subject !== "string" || typeof value.leafSha256 !== "string"
    || (value.harvestSha256 !== null && typeof value.harvestSha256 !== "string") || !manifestMode(value)
    || value.pages === null || typeof value.pages !== "object" || Array.isArray(value.pages) || !Object.values(value.pages).every(manifestPage)) {
    throw new LocalBrainError("broken", "manifest.json is not Foliage's");
  }
  if (value.gbrain?.commit !== GBRAIN_PIN.commit || value.gbrain.integrity !== GBRAIN_PIN.integrity || value.gbrain.version !== GBRAIN_PIN.version) {
    throw new LocalBrainError("broken", "this brain was built with another gbrain");
  }
  return value as BrainManifest;
}

/** In place of the record's hashes while a refresh is changing gbrain: no sha256 is ever this, so nothing reads the brain as current. */
const UNFINISHED = "unfinished refresh";

/**
 * Spec, Building step 7: written last, in one rename. A run killed before it leaves the one before,
 * and the next run redoes the work. With `unfinished`, the record an in-place refresh writes before
 * it first changes gbrain: the pages gbrain may then hold (`brainUnfinishedPages`), and hashes that
 * match no record. With `unembedded` (local-embedding mode), the pages are the record's but not all
 * of them are embedded yet.
 */
function writeManifest(paths: BrainPaths, record: GardenRecord, pages: Readonly<Record<string, BrainManifestPage>>, embedding: LocalEmbedding | null,
  { unfinished = false, unembedded = false }: { readonly unfinished?: boolean; readonly unembedded?: boolean } = {}): void {
  const manifest: BrainManifest = {
    schemaVersion: 2, leafId: record.leaf.id, subject: record.leaf.subject,
    leafSha256: unfinished ? UNFINISHED : record.leafSha256, harvestSha256: unfinished ? UNFINISHED : record.harvestSha256,
    ...(embedding === null ? { mode: "keyword" as const } : { mode: "local-embedding" as const, embedding, ...(unembedded ? { unembedded: true as const } : {}) }),
    gbrain: { version: GBRAIN_PIN.version, commit: GBRAIN_PIN.commit, integrity: GBRAIN_PIN.integrity },
    pages,
  };
  writeDocument(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, true);
}

const projectedPages = (projection: BrainProjection) => Object.fromEntries(projection.pages.map(page => [page.slug, brainManifestPage(page)]));

/** The record the brain was built from, byte for byte, and the same Leaf and subject. */
const builtFrom = (manifest: BrainManifest, record: GardenRecord) => record.leafSha256 === manifest.leafSha256
  && record.harvestSha256 === manifest.harvestSha256 && record.leaf.id === manifest.leafId && record.leaf.subject === manifest.subject;

/** Built from the record and, in local-embedding mode, every page embedded: a brain a search may read. */
const upToDate = (manifest: BrainManifest, record: GardenRecord) => builtFrom(manifest, record) && manifest.unembedded !== true;

/* ---- the owner's choice of local embeddings (build order item 8) ----------------------------- */

const EMBED_OFF_FIX = "foliage brain embed --off";

/**
 * `brain/embedding.json`: the owner turned local embeddings on for this garden, with this model,
 * port and measured dimensions; absent, keyword mode (the default, owner decision 3). Only
 * `foliage brain embed` writes or removes it. Read the bounded way: never through a link, never
 * past 64 KiB. The brain is derived data, so `foliage brain remove` takes this choice with it.
 */
async function readEmbeddingChoice(paths: BrainPaths): Promise<LocalEmbedding | null> {
  const bytes = await boundedBytes(paths.brain, "embedding.json", 64 * 1024);
  if (bytes === null) return null;
  try { return parseLocalEmbedding(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new LocalBrainError("broken", "embedding.json is not the local-embedding choice Foliage writes", EMBED_OFF_FIX); }
}

/** The command that turns this choice on again, for a fix. */
const embedAgain = (choice: Pick<LocalEmbedding, "model" | "port">) =>
  `foliage brain embed --local ollama:${choice.model}${choice.port === OLLAMA_PORT ? "" : ` --port ${choice.port}`}`;

/**
 * Who reads a cause. `owner`: `foliage brain embed` and `foliage brain status`, the owner's own
 * command line, which may name the `ollama pull` the owner could choose to run. `anyone`: every other
 * surface, a search's answer to an agent above all, and every note a search may later show; it never
 * names a download, since an agent with a shell could take that as an instruction (owner decision 3
 * leaves downloads to the owner).
 */
type Audience = "owner" | "anyone";

/**
 * The embedder on loopback answers and already holds the model (spec: before the mode is turned
 * on, and again before each search), or a named failure whose fix can work. With `measure`, the
 * model's dimensions too, from one embedding of a fixed word within `embedMs`. Nothing here pulls a
 * model.
 */
async function embedderReady(choice: Pick<LocalEmbedding, "model" | "port">, measure: boolean, audience: Audience = "anyone", embedMs?: number): Promise<number | null> {
  try { return await checkEmbedder({ model: choice.model, port: choice.port, measure, ...(embedMs === undefined ? {} : { embedMs }) }); }
  catch (error) {
    if (error instanceof EmbedderUnavailable) throw new LocalBrainError("broken", error.message, `ollama serve, or ${EMBED_OFF_FIX}`);
    if (error instanceof LocalEmbeddingRefusal) {
      if (error.reason !== "missing") throw new LocalBrainError("broken", error.message, EMBED_OFF_FIX);
      if (audience === "owner") throw new LocalBrainError("broken", error.message, `ollama pull ${choice.model} yourself if you want it, then ${embedAgain(choice)}`);
      throw new LocalBrainError("broken", `${choice.model} is no longer on this machine's embedder at ${embedderAddress(choice.port)}`, EMBED_OFF_FIX);
    }
    throw error;
  }
}

/**
 * Why the owner's embedder cannot embed for a brain of `choice` right now, or null when it can: it
 * answers on loopback, holds the model, and one embedding of a fixed word has the chosen size.
 * Never throws a brain failure; a fault in Foliage itself still throws.
 */
async function embedderBlocked(choice: LocalEmbedding, audience: Audience = "anyone", embedMs?: number): Promise<LocalBrainError | null> {
  try {
    const dimensions = await embedderReady(choice, true, audience, embedMs);
    if (dimensions === choice.dimensions) return null;
    return new LocalBrainError("broken", `${choice.model} now answers ${dimensions} dimensions where this garden chose ${choice.dimensions}`, embedAgain(choice));
  } catch (error) {
    if (error instanceof LocalBrainError) return error;
    throw error;
  }
}

/**
 * A refresh or rebuild that brought every page to the record but could not embed them all: the
 * brain stays behind (never searched) with this cause, noted like any refresh's, until a refresh
 * whose embedder answers runs `embed --stale`.
 */
const notEmbedded = (why: LocalBrainError) =>
  new LocalBrainError("behind", `every page is in, but not every one is embedded yet: ${why.message}`, why.fix ?? REFRESH_FIX);

/* ---- why a brain is behind (build order item 5) ---------------------------------------------- */

/**
 * `brain/refresh-failure.json`: why the last refresh stopped, with the hashes of the record it
 * tried. A refresh never fails the owner's action, so this is where its failure goes: a brain
 * behind that same record says so in its line, and once the record moves on the note no longer
 * applies. Written for a failure that is the brain's (`broken`) or the lock's (`busy`); never for
 * a brain that is off or not installed, which say so themselves. A `broken` note on the record as
 * it is now holds back the automatic triggers (`brainDrift`), so a refresh that fails the same way
 * every time is not retried every 30 seconds. Cleared by any update that ends with the brain
 * current. Causes are path-free, like every cause here.
 *
 * `behind` (build order item 6): a search's own update in place ran on these bytes and found that
 * only a rebuild brings the brain up to them (`InPlaceStopped`). It does not hold the triggers
 * back, since their refresh goes on to that rebuild; it holds searches back, like a `broken` one.
 * A search does not try again a refresh of the same bytes that stopped within `STOPPED_RETRY_MS`
 * (`recentStop`), so a brain that cannot be updated in place costs every later search nothing.
 *
 * Also `behind` (build order item 8): a refresh or rebuild brought every page to these bytes but
 * could not embed them all (`notEmbedded`; the manifest says `unembedded`). That one does hold the
 * triggers back (`brainDrift`), so an embedder that stays down is not asked every 30 seconds; a
 * search whose embedder just answered catches the brain up anyway.
 */
interface RefreshFailure {
  readonly state: "broken" | "busy" | "behind";
  readonly cause: string;
  readonly fix?: string;
  readonly leafSha256: string | null;
  readonly harvestSha256: string | null;
  readonly at: string;
}
type RecordHashes = Pick<GardenRecord, "leafSha256" | "harvestSha256">;

const bytesHash = async (garden: string, name: string) => {
  const bytes = await boundedBytes(garden, name);
  return bytes === null ? null : sha256(bytes);
};

/** The record's hashes as they are on disk now, read the bounded way. */
const recordHashesNow = async (garden: string): Promise<{ readonly leafSha256: string | null; readonly harvestSha256: string | null }> =>
  ({ leafSha256: await bytesHash(garden, "leaf.json"), harvestSha256: await bytesHash(garden, "harvest.json") });

/**
 * Never throws: a note that cannot be written leaves the brain behind without its cause, which the
 * line still says. `tried` is the record the failed update read; a failure before any record was
 * read (a busy lock) is pinned to the record as it is on disk.
 */
async function noteRefreshFailure(paths: BrainPaths, failure: LocalBrainError, tried: RecordHashes | null): Promise<void> {
  const state = failure instanceof InPlaceStopped ? "behind" : failure.state;
  if (state !== "broken" && state !== "busy" && state !== "behind") return;
  try {
    const hashes = tried ?? await recordHashesNow(paths.garden);
    const note: RefreshFailure = { state, cause: pathFree(failure.message), ...(failure.fix === undefined ? {} : { fix: failure.fix }),
      leafSha256: hashes.leafSha256, harvestSha256: hashes.harvestSha256, at: new Date().toISOString() };
    if (!(await lstat(paths.brain)).isDirectory()) return;
    writeDocument(paths.refreshFailure, `${JSON.stringify(note)}\n`, true);
  } catch { /* the line still says the brain is behind */ }
}

const clearRefreshFailure = (paths: BrainPaths) => rm(paths.refreshFailure, { force: true }).catch(() => undefined);

async function readRefreshFailure(paths: BrainPaths): Promise<Partial<RefreshFailure> | null> {
  try {
    const bytes = await boundedBytes(paths.brain, "refresh-failure.json", 64 * 1024);
    if (bytes === null) return null;
    const note = JSON.parse(bytes.toString("utf8")) as unknown;
    return note !== null && typeof note === "object" ? note as Partial<RefreshFailure> : null;
  } catch { return null; }
}

/** The last refresh's failure, only while the record is the one it tried. */
async function lastRefreshFailure(paths: BrainPaths, record: RecordHashes): Promise<Pick<BrainStatus, "cause" | "fix">> {
  const note = await readRefreshFailure(paths);
  return note === null ? {} : noteWords(note, record);
}

/** A note's words for a brain behind `record`, or none when the note is about other bytes. */
function noteWords(note: Partial<RefreshFailure>, record: RecordHashes): Pick<BrainStatus, "cause" | "fix"> {
  if (typeof note.cause !== "string" || note.leafSha256 !== record.leafSha256 || note.harvestSha256 !== record.harvestSha256) return {};
  // A search's update that found it needs a rebuild says so in its own words; anything else stopped.
  const cause = note.state === "behind" ? pathFree(note.cause) : `the last refresh stopped: ${pathFree(note.cause)}`;
  return { cause, ...(typeof note.fix === "string" ? { fix: note.fix } : {}) };
}

/**
 * Raised by a search's own update in place (`updateUnderLock` in `read` mode) once it has done that
 * work on these bytes and found that only a rebuild brings the brain up to them. Noted as `behind`.
 */
class InPlaceStopped extends LocalBrainError {
  constructor(because: string) { super("behind", `a search does not start a rebuild (${because})`); }
}

/**
 * Why a refresh of exactly these bytes stopped within `STOPPED_RETRY_MS`, or null: a `broken` note
 * (the update failed) or a `behind` one (it needs a rebuild). A search then answers from Foliage's
 * own search with that cause and starts nothing, as the triggers hold back on a `broken` one.
 */
async function recentStop(paths: BrainPaths, record: RecordHashes): Promise<Pick<BrainStatus, "cause" | "fix"> | null> {
  const note = await readRefreshFailure(paths);
  if (note === null || (note.state !== "broken" && note.state !== "behind")) return null;
  const at = Date.parse(String(note.at));
  if (!Number.isFinite(at) || Date.now() - at >= STOPPED_RETRY_MS) return null;
  const words = noteWords(note, record);
  return words.cause === undefined ? null : words;
}

/** Whether a live holder of the lock is refreshing the brain right now; read without taking the lock. */
async function refreshRunning(paths: BrainPaths): Promise<boolean> {
  const held = await readLock(paths.lock);
  return typeof held === "object" && held.refreshing === true && isHeld(held);
}

/**
 * What a brain that is not current says: refreshing while a refresh holds the lock, else why the
 * last refresh of this record stopped, else only that it is behind.
 */
async function behindStatus(paths: BrainPaths, record: GardenRecord): Promise<BrainStatus> {
  if (await refreshRunning(paths)) return { state: "behind", refreshing: true };
  return { state: "behind", ...await lastRefreshFailure(paths, record) };
}

/** A brain built from the record whose pages are not all embedded yet (local-embedding mode): why, or that a refresh embeds them. */
async function unembeddedStatus(paths: BrainPaths, record: GardenRecord): Promise<BrainStatus> {
  if (await refreshRunning(paths)) return { state: "behind", refreshing: true };
  const last = await lastRefreshFailure(paths, record);
  return { state: "behind", ...(last.cause === undefined ? { cause: "every page is in, but not every one is embedded yet", fix: REFRESH_FIX } : last) };
}

/**
 * A lock found held: a refresh of a brain that is behind is "behind, refreshing"; anything else
 * stays busy. The manifest is read without the lock (it is only ever replaced by a rename).
 */
async function whileHeld(paths: BrainPaths, record: GardenRecord | null, error: unknown): Promise<unknown> {
  if (!(error instanceof LocalBrainError) || error.state !== "busy" || record === null || !(await refreshRunning(paths))) return error;
  const manifest = await readBrainManifest(paths).catch(() => null);
  return manifest !== null && upToDate(manifest, record) ? error : new LocalBrainError("behind", "", undefined, true);
}

/** The refused check's own words, as `brainStatus` and `brainGlance` print them. */
async function refusedCause(paths: BrainPaths): Promise<string> {
  try { return pathFree(String((JSON.parse(await readFile(paths.refused, "utf8")) as { cause?: unknown }).cause ?? "an earlier check refused this brain")); }
  catch { return "an earlier check refused this brain"; }
}

/* ---- build, refresh, rebuild and status ------------------------------------------------------ */

export interface BrainOptions {
  /** Absolute path of the garden; the brain lives at `<garden>/brain/`. */
  readonly garden: string;
  /** The staged `vendor/` directory. */
  readonly vendor: string;
  /** How long to poll for the brain lock. */
  readonly waitMs?: number;
  /** How long a search waits for its own refresh of a brain behind the record (`READ_REFRESH_MS`); 0 never refreshes on read. */
  readonly readRefreshMs?: number;
  /** How long a search lets gbrain's own search run (`READ_SEARCH_MS`). */
  readonly readSearchMs?: number;
  /**
   * A refresh nobody asked for by name: one behind an action, or the 30-second check. It leaves a
   * brain an earlier check refused for the owner to rebuild, so the line naming that cause stays.
   */
  readonly unattended?: boolean;
  /**
   * For a process that ends once it has answered (`foliage brain search`): starts this garden's
   * refresh in its own detached process and resolves when that process ends. A search behind its
   * record then waits for it only up to the bound and holds nothing past it, so the command can
   * exit at the bound while the refresh finishes on its own. Without it, a search refreshes in
   * process, which suits a process that stays up.
   */
  readonly refreshElsewhere?: () => Promise<unknown>;
}

/**
 * The steps of a refresh and of a rebuild, in order. `observe` is called before each; the offline
 * test kills the Foliage process at every one of them and proves the next run converges.
 */
export const BRAIN_STEPS = Object.freeze([
  "pages", "import", "list", "remove", "purge", "check-removed", "digests",
  "rebuild", "rebuild-init", "rebuild-settings", "rebuild-pages", "rebuild-import", "rebuild-confirm",
  "swap", "swap-in", "swap-config", "swap-confirm",
  "manifest",
] as const);
/**
 * The steps only local-embedding mode takes (build order item 8): `embed --stale` at the end of a
 * refresh, once its pages are written, removed and confirmed, and at the end of a rebuild, once it is
 * swapped in; each just before the manifest, and only when the embedder answers. Kept apart so a
 * keyword brain's proofs never wait for a step it does not take.
 */
export const EMBEDDING_STEPS = Object.freeze(["embed", "rebuild-embed"] as const);
export type BrainStep = typeof BRAIN_STEPS[number] | typeof EMBEDDING_STEPS[number];
export interface BrainRun { readonly observe?: (step: BrainStep) => void | Promise<void> }

/** What a build, refresh or rebuild did, and why a brain was rebuilt rather than refreshed. */
export interface BrainUpdate { readonly action: "none" | "refreshed" | "rebuilt"; readonly because?: string }

/** `read`: a search's own refresh, which updates in place only and never rebuilds. */
type UpdateMode = "build" | "refresh" | "rebuild" | "read";

const exists = (path: string) => lstat(path).then(() => true, () => false);
const lockWait = (options: Pick<BrainOptions, "waitMs">) => options.waitMs === undefined ? {} : { waitMs: options.waitMs };

/**
 * Measured on macOS arm64: 1,000 records built in 30 s and 3,000 in 57 s in all, about 13 ms a page
 * beyond a fixed 17 s, so an import's bound grows with the page count, three times over. A refresh
 * imports with `--fresh`, which reads every page again, so its bound counts every page too.
 */
const importTimeout = (pages: number) => 120_000 + 40 * pages;

/**
 * `embed --stale`'s bound. Not measured with a real model (none is installed here, and none may be
 * downloaded): a fixed two minutes plus a quarter of a second a page, far above what the loopback
 * stand-in needs in the offline gate. A real model on a large garden may need more; past the bound
 * the refresh stops with that cause, and the next one carries on, since `--stale` embeds only what
 * is still missing.
 */
const embedTimeout = (pages: number) => 120_000 + 250 * pages;

/**
 * `brain/` as a plain directory: made when `create` and absent, refused when it is a link or
 * anything else. Because the garden's links are already resolved, it is inside the garden.
 */
async function openBrainDirectory(paths: BrainPaths, create: boolean): Promise<boolean> {
  if (create) await mkdir(paths.brain, { recursive: true, mode: 0o700 });
  let info;
  try { info = await lstat(paths.brain); }
  catch (error) { if (!create && errorCode(error) === "ENOENT") return false; throw error; }
  if (info.isSymbolicLink()) throw new LocalBrainError("broken", "brain/ is a symbolic link");
  if (!info.isDirectory()) throw new LocalBrainError("broken", "brain/ is not a directory");
  return true;
}

/** Every name Foliage makes directly under `brain/`; the lock's claims and temporary links start with `.brain-lock`. */
const BRAIN_NAMES: ReadonlySet<string> = new Set(["manifest.json", "refused.json", "refresh-failure.json", "embedding.json", "settings-check.json", "pages", "home", "work", "bin", "next", "old"]);
/** The temporary file `writeDocument` leaves beside one of those documents when it is killed mid-write. */
const DOCUMENT_TEMP = /^(?:manifest|refused|refresh-failure|embedding|settings-check)\.json\.write-\d+-[0-9a-f-]+\.tmp$/;

/**
 * Whether a name directly under `brain/` is Foliage's: one it makes, the lock's, a killed write's
 * temporary file, or the `.DS_Store` Finder leaves in any folder it shows (its own metadata, not
 * anybody's work).
 */
const foliageName = (name: string) => BRAIN_NAMES.has(name) || name.startsWith(".brain-lock") || DOCUMENT_TEMP.test(name) || name === ".DS_Store";

/** The first name directly under `brain/` that Foliage did not make, or null. */
async function foreignName(paths: BrainPaths): Promise<string | null> {
  return (await readdir(paths.brain)).find(name => !foliageName(name)) ?? null;
}

/**
 * A `brain/` holding anything Foliage did not make may be the owner's own folder. Nothing there is
 * locked, moved, removed or written, not even a note of why; the cause names what was found and
 * the fix is the command to run once it has been moved out. A search's answer, which may go to an
 * agent, does not name it (a file name in the owner's own folder may say anything); `foliage brain
 * status` does (`refuseForeignUnnamed`).
 */
async function refuseForeign(paths: BrainPaths, outcome: string, command: string): Promise<void> {
  const foreign = await foreignName(paths);
  if (foreign !== null) {
    throw new LocalBrainError("broken", `brain/ holds ${JSON.stringify(foreign.slice(0, 80))}, which Foliage did not make, so ${outcome}`, `${command} after you move that out of brain/`);
  }
}
const LEFT_AS_IT_IS = "it was left as it is";

/** `refuseForeign` for a search: the same refusal, naming nothing that is in the folder. */
async function refuseForeignUnnamed(paths: BrainPaths): Promise<void> {
  if (await foreignName(paths) !== null) {
    throw new LocalBrainError("broken", `brain/ holds something Foliage did not make, so ${LEFT_AS_IT_IS}`, "foliage brain status to see what it is");
  }
}

/**
 * How many pages one `list_pages` asks for. gbrain honours any explicit limit from its own command
 * line (`src/core/operations.ts:1772-1783`), but `gbrain call` exits before a pipe takes all of a
 * long answer: listing 1,285 pages (about 280 KB) reached Foliage cut off at 98,304 bytes,
 * mid-title, and every build failed with "gbrain list_pages did not answer in JSON" (measured
 * 2026-10-22, the 0.3.0 and 0.3.1 downloads). A row is about 220 bytes, so 100 rows stay far
 * under that: a process per hundred pages, about 0.6 s each.
 */
const LIST_LIMIT = 100;

/** Every page gbrain holds, soft-deleted ones too (`include_deleted`), paged with an explicit limit. */
async function listBrainPages(session: Session): Promise<Map<string, { readonly deleted: boolean }>> {
  const found = new Map<string, { readonly deleted: boolean }>();
  for (let offset = 0; ; offset += LIST_LIMIT) {
    const rows = await call(session, "list_pages", { limit: LIST_LIMIT, offset, sort: "slug", include_deleted: true });
    if (!Array.isArray(rows)) throw new LocalBrainError("broken", "gbrain list_pages did not answer with a list");
    for (const row of rows as unknown[]) {
      const { slug, deleted_at: deletedAt } = (row ?? {}) as { slug?: unknown; deleted_at?: unknown };
      if (typeof slug !== "string") throw new LocalBrainError("broken", "gbrain list_pages answered a page without a slug");
      found.set(slug, { deleted: deletedAt !== undefined && deletedAt !== null });
    }
    if (rows.length < LIST_LIMIT) break;
  }
  return found;
}

/** Spec, Building step 6 for a new brain: `list_pages` holds exactly these pages, none of them deleted. */
async function confirmPages(session: Session, pages: readonly BrainPage[]): Promise<void> {
  const listed = await listBrainPages(session);
  const wanted = new Set(pages.map(page => page.slug));
  const missing = pages.filter(page => listed.get(page.slug)?.deleted !== false);
  const extra = [...listed.keys()].filter(slug => !wanted.has(slug));
  if (missing.length > 0) throw new LocalBrainError("broken", `the brain is missing ${missing.length} of the pages Foliage wrote`);
  if (extra.length > 0) throw new LocalBrainError("broken", "the brain holds a page Foliage did not write");
}

/** `get_page` answers the page's own `foliage_digest`: gbrain holds the text Foliage last wrote, not an older one. */
async function confirmDigest(session: Session, page: BrainPage): Promise<void> {
  const answer = await call(session, "get_page", { slug: page.slug });
  const frontmatter = answer !== null && typeof answer === "object" ? (answer as { frontmatter?: unknown }).frontmatter : undefined;
  const digest = frontmatter !== null && typeof frontmatter === "object" ? (frontmatter as { foliage_digest?: unknown }).foliage_digest : undefined;
  if (digest !== page.digest) throw new LocalBrainError("broken", "the brain holds another text of a page Foliage wrote");
}

/**
 * Spec, Building step 5. Each page is deleted (a page an earlier, killed run already removed counts
 * as deleted), the deleted pages are purged at 0 hours (the default keeps them, versions and all,
 * for 72), and then `get_page` with `include_deleted` and `get_versions` must both find nothing for
 * every one. A plain `get_page` hides soft-deleted pages, so it would prove nothing. Answers why a
 * removal failed its check, and the brain is then rebuilt.
 */
async function removePages(session: Session, slugs: readonly string[], run: BrainRun): Promise<string | null> {
  await run.observe?.("remove");
  for (const slug of slugs) await call(session, "delete_page", { slug }, { missing: true });
  await run.observe?.("purge");
  if (slugs.length > 0) await call(session, "purge_deleted_pages", { older_than_hours: 0 });
  await run.observe?.("check-removed");
  for (const slug of slugs) {
    if (await call(session, "get_page", { slug, include_deleted: true }, { missing: true }) !== null) return "a removed page was still in the brain after the purge";
    const versions = await call(session, "get_versions", { slug });
    if (!Array.isArray(versions) || versions.length > 0) return "a removed page still had past versions in the brain";
  }
  return null;
}

/**
 * The page files a refresh may touch, or why the brain has to be rebuilt instead. `brain/pages/`
 * holds `foliage/` and nothing else, since gbrain imports every page under it; `foliage/` holds
 * regular files with one name each, since a link or a second name would carry a write or a removal
 * out of the brain. A file of a record that is gone is removed with the sweep.
 */
async function pageFiles(paths: BrainPaths): Promise<{ readonly names: readonly string[] } | string> {
  if ((await readdir(paths.pages)).some(name => name !== "foliage")) return "brain/pages holds a file Foliage did not write";
  const dir = join(paths.pages, "foliage"), names = await readdir(dir);
  for (const name of names) {
    const info = await lstat(join(dir, name));
    if (!info.isFile() || info.nlink !== 1) return "brain/pages/foliage holds something that is not a page file Foliage wrote";
  }
  return { names };
}

/**
 * Spec, Building steps 3 to 6, in place: write the pages that changed, import with `--fresh`,
 * remove what went, confirm. Answers null when the brain now holds exactly `projection`, or why it
 * has to be rebuilt instead. Before its first change it records an unfinished manifest (see
 * `brainUnfinishedPages`); the finished manifest is the caller's, written last.
 */
async function refreshInPlace(session: Session, record: GardenRecord, built: BrainManifest, projection: BrainProjection,
  plan: Extract<BrainRefreshPlan, { kind: "update" }>, run: BrainRun): Promise<string | null> {
  const { paths } = session;
  const dir = join(paths.pages, "foliage");
  await run.observe?.("pages");
  // Checked again before anything is made or written here; a refused brain is rebuilt.
  try { await checkBrainDirectories(paths); }
  catch (error) { if (error instanceof LocalBrainError) return error.message; throw error; }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const files = await pageFiles(paths);
  if (typeof files === "string") return files;
  // A page whose file is not what it should be is written too: a refresh killed after writing
  // pages leaves newer files behind.
  const write = new Map(plan.write.map(page => [page.slug, page]));
  for (const page of projection.pages) {
    if (!write.has(page.slug) && await readFile(join(paths.pages, page.file), "utf8").catch(() => null) !== page.markdown) write.set(page.slug, page);
  }
  writeManifest(paths, record, brainUnfinishedPages(built.pages, write.values()), session.embedding, { unfinished: true });
  for (const page of write.values()) writeDocument(join(paths.pages, page.file), page.markdown, true);
  // Files of removed records go, and so does a temporary file a killed write left; each a regular file (above).
  const wantedFiles = new Set(projection.pages.map(page => basename(page.file)));
  for (const name of files.names) if (!wantedFiles.has(name)) await unlink(join(dir, name)).catch(error => { if (errorCode(error) !== "ENOENT") throw error; });
  await run.observe?.("import");
  if (write.size > 0) await runGbrain(session, { kind: "import" }, { timeoutMs: importTimeout(projection.pages.length) });
  await run.observe?.("list");
  const listed = await listBrainPages(session);
  const missing = projection.pages.filter(page => !listed.has(page.slug));
  if (missing.length > 0) throw new LocalBrainError("broken", `the brain is missing ${missing.length} of the pages Foliage wrote`);
  if (projection.pages.some(page => listed.get(page.slug)?.deleted)) return "a page the brain should hold was deleted by a refresh that did not finish";
  // Every page gbrain holds is one Foliage wrote: the projection's, or one the manifest (finished or
  // not) names for removal. Anything else came from outside Foliage, and is not judged in place.
  const wanted = new Set(projection.pages.map(page => page.slug)), removing = new Set(plan.remove);
  if ([...listed.keys()].some(slug => !wanted.has(slug) && !removing.has(slug))) return "the brain holds a page Foliage did not write";
  const failed = await removePages(session, plan.remove, run);
  if (failed !== null) return failed;
  await run.observe?.("digests");
  for (const page of write.values()) await confirmDigest(session, page);
  return null;
}

const moveIfPresent = async (from: string, to: string) => {
  try { await rename(from, to); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
};

/**
 * A NEW BRAIN BESIDE THE OLD ONE, SWAPPED IN. Built whole in `brain/next/` (init, Foliage's config,
 * the settings set and read back, every page, import, `list_pages` confirmed), then swapped: the
 * manifest goes first, so a process killed from there on leaves a brain without one, which the next
 * run rebuilds; the old home and pages move to `brain/old/`, the new ones take their place,
 * config.json is rewritten to name the database where it now lives, and `brain/old/` is deleted, so
 * the old brain's bytes go with it. The live brain is confirmed once more before the caller writes
 * the manifest.
 */
async function rebuildInto(session: Session, projection: BrainProjection, run: BrainRun): Promise<void> {
  const { paths, embedding } = session;
  const next = stagingPaths(paths);
  const staging: Session = { ...session, paths: next };
  await run.observe?.("rebuild");
  for (const path of [paths.next, paths.old, paths.work, paths.bin]) await rm(path, { recursive: true, force: true });
  for (const dir of [next.tmp, paths.work, paths.bin, join(next.pages, "foliage")]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await run.observe?.("rebuild-init");
  await runGbrain(staging, { kind: "init" });
  writeDocument(next.config, brainConfigText(next, embedding), true);
  await run.observe?.("rebuild-settings");
  for (const entry of settingsFor(embedding)) await runGbrain(staging, { kind: "config-set", key: entry.key });
  await checkBrainSettings(staging);
  await run.observe?.("rebuild-pages");
  // Renamed into a directory made empty above, under the lock; never hard-linked (see publishLock).
  for (const page of projection.pages) writeDocument(join(next.pages, page.file), page.markdown, true);
  await run.observe?.("rebuild-import");
  await runGbrain(staging, { kind: "import" }, { timeoutMs: importTimeout(projection.pages.length) });
  await run.observe?.("rebuild-confirm");
  await confirmPages(staging, projection.pages);
  await run.observe?.("swap");
  await rm(paths.manifest, { force: true });
  await rm(paths.refused, { force: true });
  // The old database's record of its settings leaves with it.
  await rm(paths.settingsCheck, { force: true });
  await mkdir(paths.old, { mode: 0o700 });
  await moveIfPresent(paths.home, join(paths.old, "home"));
  await moveIfPresent(paths.pages, join(paths.old, "pages"));
  await run.observe?.("swap-in");
  await rename(next.home, paths.home);
  await rename(next.pages, paths.pages);
  // The database read back in brain/next/ is the live one now, moved whole (its own files keep
  // their identity), so what was recorded for it moves too; the next process checks it.
  const held = custodyOf(session.lock), moved = held.get(next.database) ?? null;
  held.delete(next.database);
  held.set(paths.database, moved);
  if (moved !== null) writeCustody(paths, moved);
  await run.observe?.("swap-config");
  writeDocument(paths.config, brainConfigText(paths, embedding), true);
  await rm(paths.old, { recursive: true, force: true });
  await rm(paths.next, { recursive: true, force: true });
  await run.observe?.("swap-confirm");
  await confirmPages(session, projection.pages);
}

/**
 * The manifest of a brain a refresh can work on, or why there is none. Not usable: a brain an
 * earlier check refused, one with no readable manifest of this schema and gbrain pin, one built for
 * another Leaf id or subject, or one whose config.json, home or (with `readSettings`) database
 * settings are not Foliage's.
 */
async function usableBrain(session: Session, record: GardenRecord, readSettings: boolean): Promise<BrainManifest | string> {
  const { paths } = session;
  if (await exists(paths.refused)) return "an earlier check refused this brain";
  if (!(await exists(paths.manifest))) return "the brain has no manifest";
  try {
    const manifest = await readBrainManifest(paths);
    if (manifest.leafId !== record.leaf.id || manifest.subject !== record.leaf.subject) return "the Leaf's id or subject changed";
    // The home and every directory first, so config.json is never read through a link. Checked
    // against the mode the brain was built in, which its config.json and settings must match.
    const embedding = builtEmbedding(manifest);
    await checkHome(paths);
    await checkBrainConfig(paths, embedding);
    if (readSettings) await checkBrainSettings({ ...session, embedding });
    return manifest;
  } catch (error) {
    if (error instanceof LocalBrainError && error.state === "broken") return error.message;
    throw error;
  }
}

/**
 * The record's pages (pure). One record the page format refuses stops the projection; the cause
 * names it and the fix says what to edit, since a rebuild would meet the same record.
 */
function project(record: GardenRecord): BrainProjection {
  try { return brainProjection(record); }
  catch (error) {
    if (!(error instanceof BrainPageRefusal)) throw error;
    throw new LocalBrainError("broken", pathFree(error.message), `foliage brain build after you put that ${error.field} on one line`);
  }
}

/**
 * Spec, Building steps 2 to 7, by a holder of the lock over a record read once and hashed. Same
 * bytes as the manifest: nothing to do. Otherwise the pages are projected (pure) and the plan
 * decides: an update in place, or a rebuild for a removal the law drives. An update that cannot be
 * confirmed, and a brain that is not usable, are rebuilt too, except by a search (`read`), which
 * updates only in place: a rebuild takes longer than any search should wait (measured 18 s), so a
 * search that needs one answers without the brain and says so. A search whose update in place ran
 * and then found it needs a rebuild raises `InPlaceStopped`, which is noted, so the next search
 * does not do that work again (`recentStop`).
 */
async function updateUnderLock(session: Session, record: GardenRecord, mode: UpdateMode, run: BrainRun): Promise<BrainUpdate> {
  const { paths } = session;
  await session.lock.setRefreshing();
  // A rebuild killed part-way leaves these; nobody else can be using them while this process holds the lock.
  for (const path of [paths.next, paths.old]) await rm(path, { recursive: true, force: true });
  const projection = project(record);
  // The mode the owner chose (build order item 8): a brain built in another is rebuilt in this one.
  const chosen = await readEmbeddingChoice(paths);
  const working: Session = { ...session, embedding: chosen };
  let because: string | undefined;
  if (mode !== "rebuild") {
    const built = await usableBrain(working, record, mode === "build");
    const change = typeof built === "string" ? null : embeddingChange(builtEmbedding(built), chosen);
    if (typeof built === "string") {
      if (mode === "read") throw new LocalBrainError("broken", built);
      because = built;
    } else if (change !== null) because = change;
    else if (upToDate(built, record)) return { action: "none" };
    else {
      // Pages exactly the record's but not all embedded (local-embedding mode) need only `embed
      // --stale`: an update in place with nothing to write or remove. Its embedder is asked first,
      // so while it is still not answering nothing starts and the brain stays behind, saying why.
      const embeddingOnly = builtFrom(built, record);
      if (embeddingOnly && chosen !== null) {
        const blocked = await embedderBlocked(chosen);
        if (blocked !== null) throw notEmbedded(blocked);
      }
      const plan: BrainRefreshPlan = embeddingOnly ? { kind: "update", write: [], remove: [] } : brainRefreshPlan(built.pages, projection);
      if (plan.kind === "rebuild") because = plan.because;
      else {
        because = await refreshInPlace(working, record, built, projection, plan, run) ?? undefined;
        if (because === undefined) return finish(working, record, projection, run, "embed", { action: "refreshed" });
        if (mode === "read") throw new InPlaceStopped(because);
      }
    }
  }
  if (mode === "read") throw new LocalBrainError("behind", `a search does not start a rebuild (${because ?? "the brain needs one"})`);
  await rebuildInto(working, projection, run);
  return finish(working, record, projection, run, "rebuild-embed", { action: "rebuilt", ...(because === undefined ? {} : { because }) });
}

/**
 * The end of every refresh and rebuild that brought the brain to the record: in local-embedding
 * mode `embed --stale` (`embedStale`), then the manifest, written last. When the pages could not
 * all be embedded the manifest says so (`unembedded`) and the update ends behind with the cause,
 * which is noted like any failed refresh's; every page was still written, removed and purged, so
 * the record's own changes, the law's removals among them, never wait for the embedder.
 */
async function finish(session: Session, record: GardenRecord, projection: BrainProjection, run: BrainRun,
  step: "embed" | "rebuild-embed", done: BrainUpdate): Promise<BrainUpdate> {
  const unembedded = await embedStale(session, projection.pages.length, run, step);
  await run.observe?.("manifest");
  writeManifest(session.paths, record, projectedPages(projection), session.embedding, { unembedded: unembedded !== null });
  if (unembedded !== null) throw notEmbedded(unembedded);
  return done;
}

/**
 * `embed --stale` (local-embedding mode; nothing in keyword mode): every page the last import
 * added, or an earlier refresh or rebuild left without embeddings, is embedded, once the embedder
 * answers holding the model at the brain's size (`embedderBlocked`, asked first, so nothing starts
 * when it is down). Otherwise why not. A gbrain embed that starts and fails (gbrain's own size
 * check, the embedder failing part-way, the bound) is a cause too: the pages are in the brain
 * either way, and the next `embed --stale` takes up only what is still missing. A check Foliage
 * makes before starting gbrain still fails the update.
 */
async function embedStale(session: Session, pages: number, run: BrainRun, step: "embed" | "rebuild-embed"): Promise<LocalBrainError | null> {
  if (session.embedding === null) return null;
  const blocked = await embedderBlocked(session.embedding);
  if (blocked !== null) return blocked;
  await run.observe?.(step);
  try { await runGbrain(session, { kind: "embed" }, { timeoutMs: embedTimeout(pages) }); }
  catch (error) {
    if (error instanceof GbrainProcessFailure) return error;
    throw error;
  }
  return null;
}

/**
 * An update's outcome, kept: one that ends current clears the last failure's note, and a failure
 * is written down (`noteRefreshFailure`, pinned to the record this update tried) and thrown on,
 * named, to whoever waits for it.
 */
function settled(paths: BrainPaths, tried: RecordHashes, update: Promise<BrainUpdate>): Promise<BrainUpdate> {
  return update.then(async done => { await clearRefreshFailure(paths); return done; }, async (error: unknown) => {
    const failure = named(error);
    await noteRefreshFailure(paths, failure, tried);
    throw failure;
  });
}

/**
 * Build, refresh and rebuild (spec, Building steps 1 to 7): the owner's own brains refused first,
 * the runtime checked, a `brain/` holding anything Foliage did not make refused before it is
 * locked, then the lock taken and `updateUnderLock` run. A failure once the brain's own directory
 * is open is written down as well as thrown, so a refresh that ran behind somebody's action, and
 * failed, leaves the brain behind with a named cause. An unattended refresh leaves a refused brain
 * for the owner to rebuild. `read` is a search's refresh run elsewhere (`refreshForSearch`).
 */
async function updateBrain(options: BrainOptions, mode: UpdateMode, run: BrainRun): Promise<BrainUpdate> {
  let opened: BrainPaths | null = null;
  let made: BrainPaths | null = null;
  try {
    const paths = brainPaths(await realGarden(options.garden));
    await refuseOwnerBrain(paths);
    const runtime = await openRuntime(options.vendor);
    const create = mode === "build" || mode === "rebuild";
    if (create && !(await exists(paths.brain))) {
      await refuseWithoutRecord(paths);
      made = paths;
    }
    if (!(await openBrainDirectory(paths, create))) throw noBrain();
    const command = `foliage brain ${mode === "read" ? "refresh" : mode}`;
    await refuseForeign(paths, LEFT_AS_IT_IS, command);
    opened = paths;
    const lock = await acquireBrainLock(paths.lock, lockWait(options));
    try {
      await refuseForeign(paths, LEFT_AS_IT_IS, command);
      if (options.unattended && await exists(paths.refused)) throw new LocalBrainError("broken", await refusedCause(paths));
      const record = await readGardenRecord(paths.garden);
      if (record === null) throw new LocalBrainError("off", "this garden has no leaf.json yet");
      return await settled(paths, record, updateUnderLock({ paths, runtime, lock, embedding: null }, record, mode, run));
    } finally { await lock.release(); }
  } catch (error) {
    const failure = named(error);
    if (opened !== null && failure.state === "busy") await noteRefreshFailure(opened, failure, null);
    await leaveNoEmptyBrain(made);
    throw failure;
  }
}

/**
 * Before `brain/` is made: a garden with no `leaf.json` has nothing a brain could be built from,
 * so the build is refused with nothing made. `foliage brain` says how to grow one.
 */
async function refuseWithoutRecord(paths: BrainPaths): Promise<void> {
  if (!(await exists(join(paths.garden, "leaf.json")))) throw new LocalBrainError("off", "this garden has no leaf.json yet");
}

/**
 * A build that made `brain/` and then failed before anything was written in it (the record was
 * not one a brain is built from, say) takes the empty folder away again. Only an empty one:
 * `rmdir` leaves anything holding a file, a refresh's note of why it stopped included.
 */
async function leaveNoEmptyBrain(made: BrainPaths | null): Promise<void> {
  if (made !== null) await rmdir(made.brain).catch(() => undefined);
}

/**
 * `foliage brain build`: makes this garden's brain, or brings an existing one up to the record. A
 * brain built from these exact bytes, whose config is Foliage's and whose settings read back, is
 * left as it is (spec, Building step 2).
 */
export function buildBrain(options: BrainOptions, run: BrainRun = {}): Promise<BrainUpdate> {
  return updateBrain(options, "build", run);
}

/** `foliage brain refresh`: brings an existing brain up to the record. It never makes a brain that is not there. */
export function refreshBrain(options: BrainOptions, run: BrainRun = {}): Promise<BrainUpdate> {
  return updateBrain(options, "refresh", run);
}

/**
 * `foliage brain refresh --in-place`: the refresh a one-shot search hands to a detached process
 * (`refreshElsewhere`). Like a search's own refresh it updates in place only: a brain that needs a
 * rebuild is left behind with that cause written down, for a trigger or the owner to rebuild, so a
 * search never starts a rebuild, here either.
 */
export function refreshForSearch(options: BrainOptions, run: BrainRun = {}): Promise<BrainUpdate> {
  return updateBrain(options, "read", run);
}

/** `foliage brain rebuild`: a whole new brain beside the old one, swapped in, whatever state the old one is in. */
export function rebuildBrain(options: BrainOptions, run: BrainRun = {}): Promise<BrainUpdate> {
  return updateBrain(options, "rebuild", run);
}

/** `foliage brain embed` refused before anything was written: the brain and the owner's choice are as they were. */
export class EmbeddingRefused extends LocalBrainError {}

/**
 * What `foliage brain embed` did: the update, the choice now in force, whether there is a brain, and
 * with `--off` and no usable runtime (`runtime`), why the brain was not rebuilt yet: the choice is
 * removed all the same, and any later build or refresh rebuilds it for keyword search.
 */
export type EmbedOutcome = BrainUpdate & { readonly embedding: LocalEmbedding | null; readonly brain: boolean; readonly runtime?: BrainStatus };

/**
 * `foliage brain embed --local ollama:<model> [--port <n>]` (`want`) and `foliage brain embed
 * --off` (null): build order item 8, under owner decision 3. Turning local embeddings on asks the
 * embedder on `127.0.0.1:<port>` whether it already holds the model and measures the model's
 * dimensions from one embedding of a fixed word, before anything is made, locked or written; a
 * cloud model, a model it does not hold, and an embedder that is not answering are refused then, and
 * nothing is downloaded. Then, under the lock, the choice is written (`brain/embedding.json`) or
 * removed, and the brain is brought to it: a brain built in the other mode, or for another model,
 * is rebuilt beside the old one and swapped in (`init` at the model's dimensions, import, `embed
 * --stale`, the checks), and one already built that way is left as it is. A failure after the
 * choice is written leaves the brain behind with its cause, for the owner's `foliage brain rebuild`
 * or the triggers; the choice stands. Turning them off on a garden without a brain has nothing to do.
 * Turning them off never needs the runtime: the choice is removed under the lock first, and the
 * brain is rebuilt for keyword search only when the staged runtime is there (`runtime` otherwise).
 */
export async function embedBrain(options: BrainOptions, want: { readonly model: string; readonly port: number } | null, run: BrainRun = {}): Promise<EmbedOutcome> {
  let opened: BrainPaths | null = null;
  let made: BrainPaths | null = null;
  try {
    const paths = brainPaths(await realGarden(options.garden));
    await refuseOwnerBrain(paths);
    // Turning them off where there is no brain has nothing to do and needs no runtime; the line
    // after it says the runtime's state, as every other brain command does (not installed, say).
    if (want === null && !(await openBrainDirectory(paths, false))) {
      const runtime = await runtimeStatus(options.vendor);
      return { action: "none", embedding: null, brain: false, ...(runtime.state === "off" ? {} : { runtime }) };
    }
    let chosen: LocalEmbedding | null = null;
    if (want !== null) {
      await openRuntime(options.vendor);
      let dimensions: number | null;
      try { dimensions = await embedderReady(want, true, "owner"); }
      catch (error) {
        if (error instanceof LocalBrainError) throw new EmbeddingRefused("broken", error.message, error.fix);
        throw error;
      }
      if (dimensions === null) throw new EmbeddingRefused("broken", "the embedder's dimensions could not be measured");
      chosen = { provider: "ollama", model: want.model, port: want.port, dimensions };
    }
    if (chosen !== null && !(await exists(paths.brain))) {
      await refuseWithoutRecord(paths);
      made = paths;
    }
    if (!(await openBrainDirectory(paths, chosen !== null))) return { action: "none", embedding: null, brain: false };
    await refuseForeign(paths, LEFT_AS_IT_IS, "foliage brain embed");
    opened = paths;
    const lock = await acquireBrainLock(paths.lock, lockWait(options));
    try {
      await refuseForeign(paths, LEFT_AS_IT_IS, "foliage brain embed");
      const record = await readGardenRecord(paths.garden);
      if (record === null) throw new LocalBrainError("off", "this garden has no leaf.json yet");
      if (chosen === null) await rm(paths.embedding, { force: true });
      else writeDocument(paths.embedding, localEmbeddingText(chosen), true);
      let runtime: Runtime;
      try { runtime = await openRuntime(options.vendor); }
      catch (error) {
        // Off, with no usable runtime: the choice is gone, so searches are keyword again; the brain
        // is rebuilt for keyword search by the next build or refresh once a runtime is staged.
        if (chosen === null && error instanceof LocalBrainError) return { action: "none", embedding: null, brain: true, runtime: brainFailure(error) };
        throw error;
      }
      const update = await settled(paths, record, updateUnderLock({ paths, runtime, lock, embedding: null }, record, "build", run));
      return { ...update, embedding: chosen, brain: true };
    } finally { await lock.release(); }
  } catch (error) {
    const failure = named(error);
    if (opened !== null && failure.state === "busy") await noteRefreshFailure(opened, failure, null);
    await leaveNoEmptyBrain(made);
    throw failure;
  }
}

/**
 * Whether local embeddings are on for this garden, for `foliage search` and `foliage_search`, which
 * read the brain only then (owner decision 3): one small file under a `brain/` Foliage made,
 * read the bounded way, and nothing started, locked or written. `off` for a garden without a brain,
 * the owner's own `~/brain` or `~/.gbrain` (refused before anything there is read), and a `brain/`
 * holding anything Foliage did not make. `unreadable` when the choice is there but is not Foliage's:
 * the search then goes to the brain, which names the cause. Never throws.
 */
export async function localEmbeddingChoice(garden: string): Promise<{ readonly state: "on"; readonly choice: LocalEmbedding } | { readonly state: "off" | "unreadable" }> {
  try {
    const paths = brainPaths(await realGarden(garden));
    await refuseOwnerBrain(paths);
    if (!(await openBrainDirectory(paths, false)) || await foreignName(paths) !== null) return { state: "off" };
    const choice = await readEmbeddingChoice(paths);
    return choice === null ? { state: "off" } : { state: "on", choice };
  } catch (error) {
    return error instanceof LocalBrainError && error.message.startsWith("embedding.json") ? { state: "unreadable" } : { state: "off" };
  }
}

/**
 * `foliage brain remove`: deletes this garden's brain, which is derived data, so nothing is lost and
 * `foliage brain build` makes it again. Only in a garden (a folder holding `leaf.json`), and only
 * when `brain/` holds nothing but the names Foliage makes: anything else there may be the owner's
 * own, so nothing is removed and the cause names it. Removing never follows a link out of `brain/`.
 * Under the lock, so never while a build, refresh or search runs; no gbrain process starts, so it
 * works without a staged runtime. The owner's own brains are refused first, as everywhere.
 */
export async function removeBrain(options: Pick<BrainOptions, "garden" | "waitMs">): Promise<void> {
  try {
    const paths = brainPaths(await realGarden(options.garden));
    await refuseOwnerBrain(paths);
    if (!(await openBrainDirectory(paths, false))) return;
    if (!(await lstat(join(paths.garden, "leaf.json")).then(info => info.isFile(), () => false))) {
      throw new LocalBrainError("broken", "there is no leaf.json here, so this brain/ was left as it is", "foliage brain remove --garden <your garden>");
    }
    await refuseForeign(paths, "nothing was removed", "foliage brain remove");
    const lock = await acquireBrainLock(paths.lock, lockWait(options));
    try {
      await refuseForeign(paths, "nothing was removed", "foliage brain remove");
      const names = await readdir(paths.brain);
      // `rm` removes a link itself, never what it points to.
      for (const name of names) if (name !== basename(paths.lock)) await rm(join(paths.brain, name), { recursive: true, force: true });
    } finally { await lock.release(); }
    // Another process may have taken the lock in between; then brain/ stays for it.
    await rmdir(paths.brain).catch(() => undefined);
  } catch (error) { throw named(error); }
}

/**
 * `foliage brain status`: the whole staged tree (`checkedRuntime`, as every command checks it), then,
 * under the lock (a build in progress has removed the manifest on purpose, and is busy, not broken),
 * every check a gbrain process would make (directories, home, config.json, empty work and bin), the
 * database settings, no provider rows in the database, and the manifest's digests against the record
 * as it is now.
 *
 * The settings are read back (one gbrain process per setting and per forbidden prefix: eleven in
 * keyword mode, 8.2–8.6 s for the whole status on macOS arm64) only when the database is not exactly
 * the one whose settings were last read back and since touched by nothing but Foliage's own processes
 * (see "the settings as last read back"), or with `deep`. Otherwise status starts no process:
 * 0.91–0.97 s, measured 2026-10-13 on a synthetic keyword-mode garden, nearly all of it the staged
 * tree's digests. A database anything else has opened, a planted row among them, is read back, and
 * refused by name, as before.
 */
export async function brainStatus(options: BrainOptions & { readonly deep?: boolean }): Promise<BrainStatus> {
  try {
    const paths = brainPaths(await realGarden(options.garden));
    await refuseOwnerBrain(paths);
    const runtime = await openRuntime(options.vendor);
    if (!(await openBrainDirectory(paths, false))) return { state: "off" };
    await refuseForeign(paths, LEFT_AS_IT_IS, BUILD_FIX);
    let lock: BrainLock;
    try { lock = await acquireBrainLock(paths.lock, lockWait(options)); }
    catch (error) { throw await whileHeld(paths, await readGardenRecord(paths.garden).catch(() => null), error); }
    try {
      if (await exists(paths.refused)) throw new LocalBrainError("broken", await refusedCause(paths));
      if (!(await exists(paths.manifest))) {
        if (await exists(paths.home) || await exists(paths.next)) throw new LocalBrainError("broken", "the last build did not finish");
        return { state: "off" };
      }
      const manifest = await readBrainManifest(paths);
      const embedding = builtEmbedding(manifest);
      const session: Session = { paths, runtime, lock, embedding };
      // What the read-back's first process would check before it started, then the read-back itself unless the record of the last one still holds.
      await checkBeforeStart(session, { kind: "config-get", key: settingsFor(embedding)[0]?.key ?? "search.mode" });
      if (options.deep || !(await settingsStillRead(session))) await checkBrainSettings(session);
      const record = await readGardenRecord(paths.garden);
      if (record === null) throw new LocalBrainError("broken", "leaf.json is gone");
      const change = embeddingChange(embedding, await readEmbeddingChoice(paths));
      if (change !== null) return { state: "behind", cause: change, fix: REBUILD_FIX };
      if (!builtFrom(manifest, record)) return { state: "behind", ...await lastRefreshFailure(paths, record) };
      // Local-embedding mode: a brain whose embedder cannot embed at its size cannot answer a search
      // (the same question a search asks first, in the owner's words: a missing model names the pull).
      if (embedding !== null) {
        const blocked = await embedderBlocked(embedding, "owner");
        if (blocked !== null) throw blocked;
      }
      if (!upToDate(manifest, record)) return await unembeddedStatus(paths, record);
      return { state: "current" };
    } finally { await lock.release(); }
  } catch (error) {
    return brainFailure(named(error));
  }
}

/**
 * The brain's line for `foliage status`, at a glance: what `brainStatus` reads without starting a
 * gbrain process or waiting for the lock. The whole staged runtime, as every command checks it
 * (`checkedRuntime`), the directories, config.json, the empty work and bin directories, a refusal
 * on record, and the manifest against the record as it is now; "refreshing" while a refresh holds
 * the lock.
 * The database settings are read back by a build and a rebuild, and by `foliage brain status` when
 * the database is not as last read back; each takes gbrain processes (about 9 s, measured), and a
 * status line should not.
 */
export async function brainGlance(options: BrainOptions): Promise<BrainStatus> {
  try {
    const paths = brainPaths(await realGarden(options.garden));
    await refuseOwnerBrain(paths);
    await openRuntime(options.vendor);
    if (!(await openBrainDirectory(paths, false))) return { state: "off" };
    await refuseForeign(paths, LEFT_AS_IT_IS, BUILD_FIX);
    if (await exists(paths.refused)) throw new LocalBrainError("broken", await refusedCause(paths));
    const record = await readGardenRecord(paths.garden);
    if (!(await exists(paths.manifest))) {
      if (record !== null && await refreshRunning(paths)) return { state: "behind", refreshing: true };
      if (await exists(paths.home) || await exists(paths.next)) throw new LocalBrainError("broken", "the last build did not finish");
      return { state: "off" };
    }
    const manifest = await readBrainManifest(paths);
    if (record === null) throw new LocalBrainError("broken", "leaf.json is gone");
    const embedding = builtEmbedding(manifest);
    const change = embeddingChange(embedding, await readEmbeddingChoice(paths));
    if (change !== null) return { state: "behind", cause: change, fix: REBUILD_FIX };
    if (!builtFrom(manifest, record)) return behindStatus(paths, record);
    await checkHome(paths);
    await checkBrainConfig(paths, embedding);
    await assertEmpty(paths.work, "brain/work", WORK_WHY);
    await assertEmpty(paths.bin, "brain/bin", BIN_WHY);
    // Local-embedding mode: the embedder answers on loopback and still lists the model. Only its
    // model list (a bounded loopback request, no model loaded); `foliage brain status` and every
    // search also embed one fixed word.
    if (embedding !== null) await embedderReady(embedding, false, "owner");
    if (!upToDate(manifest, record)) return await unembeddedStatus(paths, record);
    return { state: "current" };
  } catch (error) {
    return brainFailure(named(error));
  }
}

/* ---- for the triggers: is there anything to do? (build order item 5) ------------------------- */

export interface BrainDrift {
  /** This garden has a brain Foliage made, and it is not built from the record's bytes as they are now. */
  readonly behind: boolean;
  /**
   * When the last refresh of exactly these bytes stopped on a cause of the brain's own (ms since
   * the epoch). A busy lock is never one: that refresh is simply tried again.
   */
  readonly stoppedAt?: number;
}

/** A manifest larger than this is not one Foliage wrote for any garden it can hold. */
const MANIFEST_BYTES = 64 * 1024 * 1024;

/**
 * Whether the automatic triggers have anything to do here, read without the lock and without
 * starting anything: two record documents, the manifest and the last failure's note, each read
 * the bounded way. Nothing to do (`behind: false`) for a garden whose brain would be, sit under or
 * hold the owner's own `~/brain` or `~/.gbrain` (refused before anything there is read), a garden
 * with no `brain/` directory or no `leaf.json`, a `brain/` holding anything Foliage did not make,
 * a brain an earlier check refused (it waits for the owner's rebuild), an empty `brain/` (no brain
 * yet: `foliage brain build` makes one), and a brain built from these exact bytes. A manifest that
 * cannot be read, or a brain whose rebuild stopped at its swap, is behind: a refresh judges it.
 * Never throws.
 */
export async function brainDrift(garden: string): Promise<BrainDrift> {
  const nothing: BrainDrift = { behind: false };
  try {
    const paths = brainPaths(await realGarden(garden));
    await refuseOwnerBrain(paths);
    if (!(await openBrainDirectory(paths, false)) || await foreignName(paths) !== null || await exists(paths.refused)) return nothing;
    const now = await recordHashesNow(paths.garden);
    if (now.leafSha256 === null) return nothing;
    const stopped = async (embedding = false): Promise<BrainDrift> => {
      const note = await readRefreshFailure(paths);
      const held = note?.state === "broken" || (embedding && note?.state === "behind");
      const at = held && note.leafSha256 === now.leafSha256 && note.harvestSha256 === now.harvestSha256 ? Date.parse(String(note.at)) : NaN;
      return Number.isFinite(at) ? { behind: true, stoppedAt: at } : { behind: true };
    };
    let bytes: Buffer | null;
    try { bytes = await boundedBytes(paths.brain, "manifest.json", MANIFEST_BYTES); }
    catch { return stopped(); }
    // No manifest: Foliage's own brain whose rebuild stopped at its swap still has its home or next/.
    if (bytes === null) return await exists(paths.home) || await exists(paths.next) ? stopped() : nothing;
    let built: { leafSha256?: unknown; harvestSha256?: unknown; embedding?: unknown; unembedded?: unknown } = {};
    try { built = JSON.parse(bytes.toString("utf8")) as typeof built; } catch { /* unreadable: behind */ }
    // Local embeddings turned on, off or to another model (build order item 8): the brain is
    // rebuilt in the mode the owner chose, so it is behind until then.
    let modeHeld: boolean;
    try {
      const chosen = await readEmbeddingChoice(paths);
      modeHeld = built !== null && sameEmbedding(built.embedding === undefined ? null : parseLocalEmbedding(built.embedding), chosen);
    } catch { modeHeld = false; }
    if (built === null || !modeHeld || built.leafSha256 !== now.leafSha256 || built.harvestSha256 !== now.harvestSha256) return stopped();
    // Built from these bytes but not all embedded: behind, and a refresh of these bytes that could
    // not embed them (noted `behind`) holds the triggers back like a broken one, so an embedder that
    // stays down is not asked every 30 seconds. A search whose embedder answers catches up at once.
    return built.unembedded === true ? stopped(true) : nothing;
  } catch { return nothing; }
}

/* ---- search ---------------------------------------------------------------------------------- */

/** A search's answer. A type, not an interface, so a tool result can carry it as a plain record. */
export type BrainSearch = {
  readonly subject: { readonly leafId: string; readonly name: string };
  /**
   * Which engine ordered the hits: the brain in keyword mode, the brain with local embeddings
   * (build order item 8: gbrain's keyword and vector lists fused), or Foliage's own search.
   * `foliage keyword` always carries `because`: the brain's status line on a fallback (or `Brain:
   * off` for documents that are not a garden's), or the keyword-mode reason on a garden's `foliage
   * search` and `foliage_search` while local embeddings are off.
   */
  readonly retrieval: "brain keyword" | "brain local embedding" | "foliage keyword";
  readonly because?: string;
  readonly hits: readonly BrainHit[];
};

/**
 * THE BOUND ON A SEARCH'S OWN REFRESH (spec, Reading step 2; build order item 5 sets it). Measured
 * on macOS arm64 under the offline sandbox (item 3's run): a refresh of a current brain 0.18 s, an
 * update in place writing one page 2.5 s and removing one 3.7 s, one gbrain process 0.64 s, a
 * rebuild 18.2 s. Ten seconds covers an update in place of a few pages with time to spare, and no
 * rebuild, which a search never starts. A refresh still running at the bound is not stopped: the
 * search answers from Foliage's own search ("behind your record, refreshing") and the refresh
 * finishes behind it, holding the lock, so no gbrain process is killed part-way through a write.
 * In a process that stays up the refresh runs in that process; a one-shot command hands it to a
 * detached process (`refreshElsewhere`) and can exit at the bound.
 */
const READ_REFRESH_MS = 10_000;

/**
 * THE BOUND ON A SEARCH'S OWN gbrain `search` (build order item 6). One gbrain process took 0.64 s
 * and a whole `foliage brain search` 0.91 s (item 3's sandboxed run), so 5 seconds is several times
 * what a healthy brain needs. Past it the process is stopped (a search writes nothing to the brain)
 * and Foliage's own search answers with that cause, so a slow or stuck brain never holds a search
 * for gbrain's general two-minute bound. A search therefore answers within about
 * 20 seconds at most: up to 5 waiting for another holder of the lock, up to 10 for its own refresh,
 * and up to 5 for gbrain's search (a one-shot command waits for the lock once more after its
 * detached refresh, so up to 25). With local embeddings on, the embedder is asked first: up to 3
 * seconds for its model list and up to this bound for one embedding of a fixed word, so up to 8 more.
 * Before the lock, a garden that has a brain also has its staged runtime checked file by file
 * (`checkedRuntime`, about a second), which no bound stops.
 */
const READ_SEARCH_MS = 5_000;

/** Raised under the lock when the record on disk is no longer the one a search read: it answers from Foliage's own search. */
class RecordChanged extends Error {}
const RECORD_CHANGED = "Your record changed during the search";

/** Whether the record on disk is still, byte for byte, the one this search read. */
async function recordUnchanged(garden: string, record: RecordHashes): Promise<boolean> {
  const now = await recordHashesNow(garden);
  return now.leafSha256 === record.leafSha256 && now.harvestSha256 === record.harvestSha256;
}

/**
 * Decided under the lock without a process or a write, before a search refreshes anything: whether
 * an update in place would bring this brain up to the record. A brain that is not usable, or that
 * needs a rebuild, is not refreshed by a search, which then answers without the brain and says why.
 * Nor is one whose refresh of these exact bytes stopped within `STOPPED_RETRY_MS` (`recentStop`):
 * that work is not done again on every search, in a process that stays up or in a detached one.
 */
async function searchMayRefresh(session: Session, record: GardenRecord): Promise<void> {
  const projection = project(record);
  const built = await usableBrain(session, record, false);
  if (typeof built === "string") throw new LocalBrainError("broken", built);
  const change = embeddingChange(builtEmbedding(built), session.embedding);
  if (change !== null) throw new LocalBrainError("behind", `a search does not start a rebuild (${change})`);
  // Built from the record (pages not all embedded, or brought up meanwhile): its embedder answered
  // this search just now, so the refresh is tried even if an earlier one of these bytes stopped.
  if (builtFrom(built, record)) return;
  const plan = brainRefreshPlan(built.pages, projection);
  if (plan.kind === "rebuild") throw new LocalBrainError("behind", `a search does not start a rebuild (${plan.because})`);
  const stopped = await recentStop(session.paths, record);
  if (stopped !== null) throw new LocalBrainError("behind", stopped.cause ?? "", stopped.fix);
}

/** Whether `work` settled within `ms`; it is never cancelled. */
async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  const timer = new AbortController();
  try {
    return await Promise.race([work.then(() => true, () => true), sleep(ms, false, { signal: timer.signal }).catch(() => false)]);
  } finally { timer.abort(); }
}

/** The manifest of a brain a search may read, or why there is none. */
async function searchableManifest(paths: BrainPaths): Promise<BrainManifest> {
  if (await exists(paths.refused)) throw new LocalBrainError("broken", "an earlier check refused this brain");
  if (!(await exists(paths.manifest))) throw new LocalBrainError("broken", "the brain has no manifest");
  return readBrainManifest(paths);
}

/**
 * gbrain's order for a query (spec, Reading steps 2 and 3), under the lock, from a brain that
 * matches the record byte for byte: its `search` op in conservative mode with min(3 × limit, 30)
 * results, keyword only (the database settings). Only the slugs are kept.
 *
 * The record is hashed again once the lock is held. A search that read it earlier must not refresh
 * the brain toward those older bytes: a refresh after a newer write may already have brought the
 * brain up to that write, and a leaflet the newer record excludes would come back with its body.
 * So a record that changed in between ends the search here (`RecordChanged`), and nothing starts.
 * A brain behind the record is then refreshed in place within `READ_REFRESH_MS`; one that needs a
 * rebuild is not, nor one whose refresh of these bytes just stopped (`searchMayRefresh`). gbrain's
 * search itself is bounded by `READ_SEARCH_MS`. A garden with no brain costs no hashing of the
 * staged runtime: only its pins are read before `brain/` is looked for.
 */
async function brainOrder(options: BrainOptions, garden: string, record: GardenRecord, query: string, limit: number) {
  const paths = brainPaths(garden);
  await refuseOwnerBrain(paths);
  const staged = await stagedRuntime(options.vendor);
  if (!(await openBrainDirectory(paths, false))) throw noBrain();
  await refuseForeignUnnamed(paths);
  // Local embeddings on (build order item 8): before anything is locked or started (spec, Checked
  // before use), the embedder must answer, hold the model, and embed one fixed word at the chosen
  // size within the search's bound (which also loads a model Ollama let go idle). A search whose
  // embedder is down, lacks the model, fails to embed (an HTTP 500, say) or answers another size
  // answers at once from Foliage's own search, naming why, and never rests on gbrain's silent
  // fallback to keyword search. What this cannot see: an embedder that answers this probe and then
  // fails gbrain's own query embedding a moment later; gbrain then orders by keyword alone, which
  // `docs/ASSISTANT-MCP.md` says.
  const chosen = await readEmbeddingChoice(paths);
  if (chosen !== null) {
    const blocked = await embedderBlocked(chosen, "anyone", options.readSearchMs ?? READ_SEARCH_MS);
    if (blocked !== null) throw blocked;
  }
  const runtime = await checkedRuntime(staged);
  const take = async (): Promise<BrainLock> => {
    try { return await acquireBrainLock(paths.lock, lockWait(options)); }
    catch (error) { throw await whileHeld(paths, record, error); }
  };
  let lock: BrainLock | null = await take();
  // Set when a refresh in this process outlives the bound: the lock is then released when it finishes, not here.
  let handedOff = false;
  try {
    if (!(await recordUnchanged(paths.garden, record))) throw new RecordChanged();
    let manifest = await searchableManifest(paths);
    const change = embeddingChange(builtEmbedding(manifest), chosen);
    if (change !== null) throw new LocalBrainError("behind", `a search does not start a rebuild (${change})`);
    if (!upToDate(manifest, record)) {
      const bound = options.readRefreshMs ?? READ_REFRESH_MS;
      if (bound <= 0) throw new LocalBrainError("behind", "");
      await searchMayRefresh({ paths, runtime, lock, embedding: chosen }, record);
      if (options.refreshElsewhere !== undefined) {
        // A one-shot command: an update in place would do (above), so a detached process does it,
        // holding nothing while it runs, and the search waits for it only up to the bound.
        await lock.release();
        lock = null;
        if (!(await settledWithin(options.refreshElsewhere(), bound))) throw new LocalBrainError("behind", "", undefined, true);
        lock = await take();
        if (!(await recordUnchanged(paths.garden, record))) throw new RecordChanged();
        manifest = await searchableManifest(paths);
        if (!upToDate(manifest, record)) {
          const stopped = await lastRefreshFailure(paths, record);
          throw new LocalBrainError("behind", stopped.cause ?? "", stopped.fix);
        }
      } else {
        const held = lock;
        const refreshing = settled(paths, record, updateUnderLock({ paths, runtime, lock: held, embedding: chosen }, record, "read", {}));
        if (!(await settledWithin(refreshing, bound))) {
          handedOff = true;
          void refreshing.catch(() => undefined).finally(() => held.release()).catch(() => undefined);
          throw new LocalBrainError("behind", "", undefined, true);
        }
        await refreshing;
        manifest = await readBrainManifest(paths);
        if (!upToDate(manifest, record)) throw new LocalBrainError("behind", "");
      }
    }
    // The mode the brain was built in, which is the one chosen (checked above, and again by any refresh).
    const embedding = builtEmbedding(manifest);
    if (!sameEmbedding(embedding, chosen)) throw new LocalBrainError("behind", "a search does not start a rebuild (the local embedding choice changed during the search)");
    const rows = await call({ paths, runtime, lock, embedding }, "search", { query, limit: Math.min(3 * limit, 30), mode: "conservative" },
      { timeoutMs: options.readSearchMs ?? READ_SEARCH_MS });
    if (!Array.isArray(rows)) throw new LocalBrainError("broken", "gbrain search did not answer with a list");
    const ordered = (rows as unknown[]).flatMap(row => {
      const slug = row !== null && typeof row === "object" ? (row as { slug?: unknown }).slug : undefined;
      return typeof slug === "string" ? [slug] : [];
    });
    return { built: manifest.pages, ordered, embedding };
  } finally { if (!handedOff && lock !== null) await lock.release(); }
}

/**
 * `foliage brain search` (spec, Reading). The query and limit are checked by Foliage's own rules
 * before anything is read or started. The record is read once and hashed, and `searchRecordThroughBrain`
 * answers for those bytes.
 */
export async function searchLocalBrain(options: BrainOptions, query: string, limit = 8): Promise<BrainSearch | { readonly state: "no-record"; readonly hits: readonly BrainHit[] }> {
  searchRecords([], query, { limit });
  let garden: string;
  try { garden = await realGarden(options.garden); }
  catch (error) { if (error instanceof LocalBrainError && error.state === "off") return { state: "no-record", hits: [] }; throw error; }
  const record = await readGardenRecord(garden);
  if (record === null) return { state: "no-record", hits: [] };
  return searchRecordThroughBrain({ ...options, garden }, record, query, limit);
}

/**
 * A search of `record`, the garden's record as the caller read it once and hashed: `foliage brain
 * search` (build order item 6), and `foliage search` and `foliage_search` once local embeddings are
 * on (build order item 8; in keyword mode they do not come here, `localSearch.ts`). The brain
 * answers only when it was built from exactly those bytes (in the mode chosen, with its embedder
 * answering) and they are still on disk when the answer is put together;
 * the hits are put together by `brainSearchHits` over `brainRecords` of those bytes. If the brain is
 * missing, behind, busy, broken or not installed, or the record changes during the search, the
 * answer comes from Foliage's own search over the same records, with the reason. Never an empty
 * answer standing in for a failure. The caller has checked the query and the limit.
 */
export async function searchRecordThroughBrain(options: BrainOptions, record: GardenRecord, query: string, limit: number): Promise<BrainSearch> {
  const fallback = (because: string) => foliageAnswer(record, query, limit, because);
  let garden: string;
  let order: Awaited<ReturnType<typeof brainOrder>>;
  try {
    garden = await realGarden(options.garden);
    order = await brainOrder(options, garden, record, query, limit);
  } catch (error) {
    if (error instanceof RecordChanged) return fallback(RECORD_CHANGED);
    if (error instanceof LocalBrainError || typeof errorCode(error) === "string") return fallback(brainLine(brainFailure(named(error))));
    // A fault in Foliage itself (a search now writes pages and a manifest): the search still answers
    // from Foliage's own, and the fault goes to stderr without any path.
    process.stderr.write(`foliage brain: the search answered without the brain after an unexpected error: ${pathFree(error instanceof Error ? error.message : String(error))}\n`);
    return fallback(brainLine({ state: "broken", cause: "the brain could not be read" }));
  }
  if (!(await recordUnchanged(garden, record).catch(() => false))) return fallback(RECORD_CHANGED);
  return { subject: subjectOf(record), retrieval: order.embedding === null ? "brain keyword" : "brain local embedding",
    hits: brainSearchHits({ records: brainRecords(record), built: order.built, ordered: order.ordered, query, limit }) };
}

const subjectOf = (record: Pick<GardenRecord, "leaf">) => ({ leafId: record.leaf.id, name: record.leaf.subject });

/**
 * Foliage's own answer over `brainRecords` of `record`, today's ranking, saying in `because` why the
 * brain did not order it: every fallback of a search, and every `foliage search` and
 * `foliage_search` answer (keyword mode, or two documents that are not a garden's: `Brain: off`).
 * The same records and hit shape as an answer
 * the brain ordered, so a result never depends on which engine answered.
 */
export function foliageAnswer(record: Pick<GardenRecord, "leaf" | "harvest">, query: string, limit: number, because: string): BrainSearch {
  return { subject: subjectOf(record), retrieval: "foliage keyword", because,
    hits: brainSearchHits({ records: brainRecords(record), built: {}, ordered: [], query, limit }) };
}
