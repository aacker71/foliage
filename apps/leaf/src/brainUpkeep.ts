/**
 * KEEPING A GARDEN'S BRAIN CURRENT (unit 38, build order item 5; spec PR #201).
 *
 * The brain is derived from `<garden>/leaf.json` and `<garden>/harvest.json`, so whatever writes
 * either asks for a refresh afterwards, queued behind its own answer and never in its way:
 *
 *   - a command that ends (`foliage grow`, `review --resume`, `migrate-queue --apply`, `capture`,
 *     `share`, `unshare`, `integrations import`) starts `foliage brain refresh --background`
 *     detached and exits as before (`startBrainRefresh`);
 *   - a process that stays up (`foliage up`'s server, the MCP server) keeps one refresher
 *     (`brainUpkeep`): one refresh at a time, and a request that arrives while one runs is served by
 *     one more run after it. `foliage up` asks after every POST it answers (review decisions,
 *     promotions, edits), after every collection pass (the first one runs at start), and every 30
 *     seconds, which catches anything else that writes the record, such as a hand edit or
 *     `harvest.mjs` run directly. Publishing is not among them: `foliage canopy` publishes and
 *     withdraws by writing only the published copy, which the brain does not hold. The MCP server
 *     asks after every tool that is not annotated read-only (`refreshAfterWrites`), because an
 *     owner who only uses an agent host never runs `foliage up`.
 *
 * Every request first asks `brainDrift`, which reads the two record documents, the manifest and the
 * last failure's note the bounded way and starts nothing, so a request after a write that changed
 * nothing, or a 30-second check of a brain already current, costs a few small reads. Nothing is
 * done for a garden without a brain (a refresh never makes one; `foliage brain build` does), for
 * the owner's own `~/brain` or `~/.gbrain` (refused before anything there is read), for a `brain/`
 * holding anything Foliage did not make, or for a brain an earlier check refused, which waits for
 * the owner's `foliage brain rebuild`. A refresh that fails never fails the action that asked for
 * it: it leaves the brain behind with its cause written down (`localBrain.ts`), which `foliage
 * status` and `foliage brain status` print. A refresh that failed on these exact record bytes for a
 * cause of the brain's own is not tried again by a trigger until the record changes or
 * `STOPPED_RETRY_MS` has passed; the owner can always run `foliage brain refresh`. Correctness
 * never rests on these triggers: a search compares the manifest with the record itself and never
 * uses a brain that is behind.
 *
 * Effects only; nothing here reads the record beyond hashing its bytes, and nothing writes it.
 */
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/server";
import type { BrainDrift } from "./localBrain.ts";

/** The staged runtime of this checkout, as `apps/leaf/brain.mjs` names it. */
export const BRAIN_VENDOR = fileURLToPath(new URL("../../../vendor", import.meta.url));
const BRAIN_CLI = fileURLToPath(new URL("../brain.mjs", import.meta.url));
/**
 * How long a refresh behind somebody's action waits for another holder of the brain's lock. The
 * spec's 5 seconds would leave it failing as busy behind any rebuild (about 18 s, measured), so a
 * refresh nobody waits for waits longer. Searches and status keep the spec's 5 seconds.
 */
export const BACKGROUND_LOCK_WAIT_MS = 120_000;
/**
 * A refresh that failed on these exact record bytes for a cause of the brain's own is tried again
 * by a trigger only after this long, or once the record changes. A rebuild that fails part-way
 * would otherwise run again every 30 seconds for as long as `foliage up` runs (about 18 s of gbrain
 * processes and a new 42 MB database each time, measured). A busy lock is always tried again.
 */
export const STOPPED_RETRY_MS = 10 * 60_000;

/**
 * The garden whose brain these two documents feed, or null. A garden's brain reads exactly
 * `<garden>/leaf.json` and `<garden>/harvest.json`; a process given any other pair of paths has no
 * brain to keep.
 */
export function brainGardenOf(leafPath: string, harvestPath: string): string | null {
  const garden = dirname(leafPath);
  return basename(leafPath) === "leaf.json" && harvestPath === join(garden, "harvest.json") ? garden : null;
}

async function drift(garden: string): Promise<BrainDrift> {
  const { brainDrift } = await import("./localBrain.ts");
  return brainDrift(garden);
}

/** Whether a trigger should start a refresh now: the brain is behind, and not on bytes whose refresh just failed. */
export function refreshWanted(state: BrainDrift, now: number): boolean {
  return state.behind && (state.stoppedAt === undefined || now - state.stoppedAt >= STOPPED_RETRY_MS);
}

/**
 * Whether this garden has a brain Foliage made that is not built from the record's bytes as they
 * are now (`brainDrift`). Reads two documents and one manifest; starts nothing; never throws.
 */
export async function brainBehind(garden: string): Promise<boolean> {
  return (await drift(garden)).behind;
}

/**
 * `foliage brain refresh --background` for this garden, detached, with no terminal; resolves when it
 * ends. With `inPlace`, `--in-place` too: a search's refresh, which never rebuilds.
 */
function spawnRefresh(garden: string, inPlace = false): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      const child = spawn(process.execPath, [BRAIN_CLI, "refresh", "--background", ...(inPlace ? ["--in-place"] : []), "--garden", garden],
        { detached: true, stdio: "ignore", env: process.env });
      child.once("error", () => resolve());
      child.once("exit", () => resolve());
      child.unref();
    } catch { resolve(); }
  });
}

/**
 * For a command that ends: when this garden's brain is behind (and not on bytes whose refresh just
 * failed), `foliage brain refresh --background` starts detached, with no terminal, and the command
 * answers and exits as it always has. Nothing here can fail the command. Answers whether a refresh
 * was started.
 */
export async function startBrainRefresh(garden: string): Promise<boolean> {
  try {
    if (!refreshWanted(await drift(garden), Date.now())) return false;
    void spawnRefresh(garden);
    return true;
  } catch { return false; }
}

/**
 * For `foliage brain search`, a one-shot search, as its `refreshElsewhere`: the
 * search's refresh in its own detached process (`foliage brain refresh --background --in-place`),
 * resolving when that process ends. It updates in place only, as a search's own refresh does, so a
 * search never starts a rebuild. The search waits for it only up to its bound; its own process can
 * then exit while the refresh finishes on its own.
 */
export function refreshDetached(garden: string): Promise<void> {
  return spawnRefresh(garden, true);
}

export interface BrainUpkeep {
  /** Ask for a refresh behind whatever is being answered now. Never waits and never throws. */
  request(): void;
  /** Resolves once no refresh is running or asked for. */
  idle(): Promise<void>;
}

export interface BrainUpkeepOptions {
  /** The staged runtime; this checkout's by default. */
  readonly vendor?: string;
  /** One line per refresh that failed; the cause is path-free, and also written down in the brain. */
  readonly log?: (line: string) => void;
  /** Stand-ins for tests; the defaults are `brainDrift`, an unattended `refreshBrain` and the clock. */
  readonly drift?: (garden: string) => Promise<BrainDrift>;
  readonly refresh?: (garden: string) => Promise<unknown>;
  readonly now?: () => number;
}

/**
 * One refresher for a process that stays up. A request schedules a run on a later turn of the
 * event loop, so the answer that prompted it goes first; requests during a run are served by one
 * more run after it, never by two at once. Each run starts nothing unless `refreshWanted`.
 */
export function brainUpkeep(garden: string, options: BrainUpkeepOptions = {}): BrainUpkeep {
  const vendor = options.vendor ?? BRAIN_VENDOR;
  const check = options.drift ?? drift;
  const refresh = options.refresh ?? (async (target: string) => {
    const { refreshBrain } = await import("./localBrain.ts");
    return refreshBrain({ garden: target, vendor, waitMs: BACKGROUND_LOCK_WAIT_MS, unattended: true });
  });
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  let running: Promise<void> | null = null;
  let again = false;
  const once = async () => {
    try { if (refreshWanted(await check(garden), now())) await refresh(garden); }
    catch (error) {
      const { brainFailure, brainLine, LocalBrainError } = await import("./localBrain.ts");
      log(error instanceof LocalBrainError ? brainLine(brainFailure(error)) : "Brain: the refresh stopped on an unexpected error");
    }
  };
  const loop = async () => {
    do { again = false; await once(); } while (again);
  };
  // A request that lands after the loop's last check but before it is marked done starts it again.
  const start = () => {
    running = new Promise<void>(resolve => setImmediate(resolve)).then(loop).finally(() => {
      running = null;
      if (again) start();
    });
  };
  return {
    request() {
      if (running !== null) { again = true; return; }
      start();
    },
    async idle() {
      while (running !== null) await running;
    },
  };
}

/**
 * After every MCP tool that is not annotated read-only, whatever it answered (a failed write may
 * still have written), a refresh is requested. Read-only tools ask nothing. Wraps the server's own
 * `registerTool`, so every tool registered after this call is covered, whichever module adds it.
 */
export function refreshAfterWrites(server: McpServer, request: () => void): void {
  const register = server.registerTool.bind(server) as (name: string, config: { annotations?: { readOnlyHint?: boolean } }, handler: (...args: never[]) => unknown) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: { annotations?: { readOnlyHint?: boolean } }, handler: (...args: never[]) => unknown) =>
    register(name, config, config.annotations?.readOnlyHint === true ? handler : async (...args: never[]) => {
      try { return await handler(...args); } finally { request(); }
    });
}
