/**
 * THE BRAIN OFFLINE GATE (unit 38, build order item 4; spec PR #201): the harness behind
 * `scripts/check-brain-offline.mjs`, which `pnpm check` runs.
 *
 * It runs the staged, pinned gbrain the way Foliage does, through `foliage brain
 * build|status|search|refresh|remove` and the real `foliage` launcher (and so through the one spawn
 * function in `apps/leaf/src/localBrain.ts`), with a throwaway HOME, GBRAIN_HOME and gardens, and
 * with every switch planted that could turn a network path back on: fake keys, database and base
 * URLs, proxies, BUN_OPTIONS, routing variables, GBRAIN_HOME aimed at a DECOY home whose config holds
 * planted secrets, a fake `gbrain` first on PATH, `.gbrain-source` and `.gbrain-mount` files above
 * each garden, which sits in a git repository whose .gitignore covers brain/, a `.env` and
 * `bunfig.toml` in brain/work, a gbrain in brain/bin, an extra key in config.json and a provider
 * base URL in the brain's database. None may take effect: each either does nothing or is refused by
 * name. gbrain's own read ops (`list_pages`, `get_page`, `get_versions`, `search`) check what
 * Foliage's commands left, in the same sandbox with the brain's own environment and the spawn
 * function's own argument lists (`gbrainArgs`); only the deliberate controls are hand-built.
 *
 * Its phases, each in its own garden: build order items 2 and 4 here (`itemsTwoAndFour`), then the
 * proofs of items 3, 5 and 6 (`offline-proofs.mjs`, which was the focused test
 * `localBrainOffline.focus.ts`): search, refresh and removal; the brain kept current by real
 * actions and an MCP-only session; and `foliage search` and `foliage_search` in keyword mode beside
 * the brain. Two steps there are servers the gate reaches on loopback (`foliage up` and a
 * private-brain session) and run on macOS only: a Linux step's empty network namespace has no
 * loopback the gate can reach.
 *
 * THE OBSERVER SITS INSIDE THE SANDBOX, never at a proxy (the spawn function strips proxies, and
 * gbrain's network paths fail quietly). Every step may start only node, the staged bun and the
 * shell that gbrain's `init` starts (see `programsFor`), and git where its command reads a work
 * repository; a step that must start no gbrain process may not start the staged bun (`Allow`).
 *
 *   - macOS (measured on arm64): `sandbox-exec` with a profile that denies ALL outbound network
 *     (name lookups go through a socket, so "all" matters), every write under the owner's real
 *     `~/.gbrain` and `~/brain` (as named and with links resolved), and starting any other program,
 *     each with SIGKILL so gbrain cannot swallow the refusal. Every deny rule carries
 *     `foliage-brain-gate <run> <step>` as its message, so `log stream` ties each deny line to this
 *     run and to the step that caused it. Every descendant inherits the profile and so the tag: in
 *     the red runs the deny line came from bun, a child of the sandboxed node, tagged with its step
 *     (measured). A control for each rule (a lookup, a write under each owner path pointed at a
 *     throwaway directory, and starting /usr/bin/true) must be killed and logged, or the gate is red.
 *   - Linux (this merged gate NOT YET RUN on Linux at all, nor on ubuntu-latest; #205's earlier
 *     item 2 and 4 steps were measured on arm64 in a Docker container): each step
 *     runs in an empty network namespace (`unshare --map-current-user --net`, or, where
 *     unprivileged namespaces are blocked and CI or FOLIAGE_BRAIN_GATE_SUDO=1 allows it,
 *     `sudo -n unshare --net` with `setpriv` back to this user) under
 *     `strace -f --seccomp-bpf -e trace=connect,sendto,sendmsg,sendmmsg,execve`. Every tool is run
 *     by its absolute system path, never looked up on PATH. An empty namespace makes an attempt fail
 *     quietly rather than kill, so strace is the observer: any connect or send that is not loopback,
 *     any name lookup (port 53, or a resolver's local socket, which an empty namespace does not
 *     stop), any successful connect to another local socket, any socket family it cannot judge, and
 *     any other program started, fails the step. NOTHING DENIES OR WATCHES WRITES under the owner's
 *     own brain on Linux; only the size and modification time of its config.json and brain.pglite
 *     are compared before and after.
 *
 * EXIT STATUSES ARE CHECKED AS WELL AS THE DENY LOG: under the macOS profile `link(2)` is killed
 * with no deny line (measured in PR #203), so every Foliage and gbrain process must end exactly as
 * its step expects, and a process killed by a signal is a failure with that cause.
 *
 * NOTHING MAY OUTLIVE ITS STEP. gbrain's update check is a detached child that swallows its errors
 * (`src/cli.ts:205-218`), and a detached child's late attempt would land after the deny log was
 * read. So before the log is closed, the gate waits (bounded) until no process of this run is left:
 * none in a step's process group, none naming the run's directory in its arguments or environment,
 * and no new process of this checkout's staged bun. Any that remain are listed, killed, and turn the
 * gate red.
 *
 * A missing vendor/, sandbox tool or git, or a sandbox that cannot be applied here, is a red failure
 * naming the command that fixes it, never a skip. Every record in the fixture is SYNTHETIC and
 * labelled so.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, existsSync, writeFileSync } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readVendorManifest, vendorLayout } from "../../apps/leaf/src/brainVendor.ts";
import { brainConfigText, brainPaths, gbrainArgs, gbrainEnvironment } from "../../apps/leaf/src/localBrain.ts";
import { itemEight } from "./offline-embeddings.mjs";
import { ensure, itemFive, itemSix, itemThree, OTHER, OWN, treeDigest } from "./offline-proofs.mjs";
import { PLANT_MARK } from "./plant-egress-probe.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STAGE_FIX = "node tools/brain/stage-gbrain.mjs";
/** The message every deny rule carries, followed by the run and the step. */
export const GATE_MARK = "foliage-brain-gate";
const PLANTED_SOURCE = "gstack-code-foliage-74312690";
const PLANTED_MOUNT = "planted-mount";
/** In every planted value, so one search of every output finds any that leaked. */
const SENTINEL = "planted-sentinel";
/** The step whose network attempt is the point: it proves the observer sees one. */
const CONTROL = "control: a name lookup inside the sandbox";
/**
 * The gate's phases, by build order item ("2" is items 2 and 4). `pnpm check` runs every one;
 * `node scripts/check-brain-offline.mjs --only <items>` runs some, for a developer, and says so.
 */
export const PHASES = Object.freeze(["2", "3", "5", "6", "8"]);
/** Every tool the gate runs, by absolute path: under `pnpm run` PATH starts with node_modules/.bin. */
const TOOLS = Object.freeze({
  sandboxExec: "/usr/bin/sandbox-exec", log: "/usr/bin/log", git: "/usr/bin/git", ps: "/bin/ps", true: "/usr/bin/true",
  strace: "/usr/bin/strace", unshare: "/usr/bin/unshare", sudo: "/usr/bin/sudo", setpriv: "/usr/bin/setpriv", env: "/usr/bin/env",
});

/**
 * @typedef {"network" | "owner-write" | "program" | "survivor" | "other"} AttemptKind
 * @typedef {{ readonly kind: AttemptKind, readonly step: string, readonly text: string }} Attempt
 */

/** How each attempt is reported. CI's `egress-gate-is-real` job requires a `NETWORK ATTEMPT:` line. */
const ATTEMPT_LABEL = Object.freeze({
  network: "NETWORK ATTEMPT", "owner-write": "OWNER BRAIN WRITE", program: "PROGRAM START",
  survivor: "OUTLIVED ITS STEP", other: "SANDBOX DENIAL",
});

/* ---- reading what the observers saw (pure) ------------------------------------------------- */

/**
 * macOS: this run's deny lines in `log stream --style ndjson` output. A line is this run's exactly
 * when its message holds `<GATE_MARK> <run> `, whatever process it names.
 * @param {string} text @param {string} run
 * @returns {Attempt[]}
 */
export function macAttempts(text, run) {
  const prefix = `${GATE_MARK} ${run} `;
  /** @type {Attempt[]} */
  const found = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let message;
    try { message = /** @type {{ eventMessage?: unknown }} */ (JSON.parse(line)).eventMessage; } catch { continue; }
    if (typeof message !== "string") continue;
    const parts = message.split("\n");
    const tag = parts.find(part => part.startsWith(prefix));
    if (tag === undefined) continue;
    const denial = (parts[0] ?? "").replace(/^Sandbox: /, "");
    const operation = /deny\(\d+\) (\S+)/.exec(denial)?.[1] ?? "";
    /** @type {AttemptKind} */
    const kind = operation.startsWith("network-") ? "network" : operation.startsWith("file-write") ? "owner-write"
      : operation.startsWith("process-exec") ? "program" : "other";
    found.push({ kind, step: tag.slice(prefix.length).trim(), text: denial });
  }
  return found;
}

/**
 * A name resolver's local socket: a lookup through it leaves an empty network namespace, so even a
 * failed attempt counts. nscd is not here: glibc tries it for every user lookup, Foliage's own
 * `os.userInfo()` included (measured on Linux: a failed connect to /var/run/nscd/socket from each
 * Foliage process), so like any other local socket it counts only when the connect succeeds.
 */
const RESOLVER_SOCKETS = [/\/systemd\/resolve\//, /avahi/, /mDNSResponder/];

/**
 * Socket families that carry no traffic off the machine: netlink talks to this kernel, and
 * AF_UNSPEC is how a datagram socket is disconnected (glibc's resolver does it after each probe).
 */
const LOCAL_FAMILIES = new Set(["AF_NETLINK", "AF_UNSPEC"]);

/** @param {string} address */
const loopback = (address) => /^127\./.test(address) || address === "::1" || /^::ffff:127\./i.test(address);

/**
 * Linux: the attempts in one step's `strace -f` output. `programs` are the paths a step may start
 * (node, the staged bun and the shell, as given and resolved). Calls split by `<unfinished ...>` are
 * joined with their `resumed` half by pid before they are judged, and a call that never resumed (its
 * tracer was killed mid-call, say) is judged on its logged half, with no result: it fails closed.
 * @param {string} text @param {string} step @param {ReadonlySet<string>} programs
 * @returns {Attempt[]}
 */
export function straceAttempts(text, step, programs) {
  /** @type {Map<string, string>} */
  const pending = new Map();
  /** @type {Attempt[]} */
  const found = [];
  /** @param {string} pid @param {string} call */
  const judge = (pid, call) => {
    const name = /^(\w+)\(/.exec(call)?.[1];
    const finished = /\)\s+=\s+-?\d+[^=]*$/.test(call);
    const result = Number(/\)\s+=\s+(-?\d+)[^=]*$/.exec(call)?.[1] ?? Number.NaN);
    const who = pid ? `pid ${pid} ` : "";
    const at = (/** @type {string} */ why) => found.push({ kind: "network", step, text: `${who}${why}${finished ? "" : " (never finished under the observer)"}: ${call}` });
    if (name === "execve") {
      const path = /^execve\("([^"]*)"/.exec(call)?.[1] ?? "";
      if ((result === 0 || !finished) && !programs.has(path)) found.push({ kind: "program", step, text: `${who}started ${path}${finished ? "" : " (never finished under the observer)"}` });
      return;
    }
    if (!["connect", "sendto", "sendmsg", "sendmmsg"].includes(name ?? "")) return;
    for (const [, family = "", fields = ""] of call.matchAll(/\{sa_family=([^,}\s]+)([^}]*)\}/g)) {
      if (family === "AF_INET" || family === "AF_INET6") {
        const port = Number(/sin6?_port=htons\((\d+)\)/.exec(fields)?.[1] ?? Number.NaN);
        const address = (family === "AF_INET" ? /sin_addr=inet_addr\("([^"]+)"\)/ : /inet_pton\(AF_INET6, "([^"]+)"/).exec(fields)?.[1] ?? "?";
        if (port === 53) at(`a name lookup to ${address}:53`);
        else if (!loopback(address)) at(`${name} to ${address}:${Number.isNaN(port) ? "?" : port}`);
      } else if (family === "AF_UNIX") {
        const path = /sun_path=(@?"[^"]*")/.exec(fields)?.[1] ?? "?";
        if (RESOLVER_SOCKETS.some(pattern => pattern.test(path))) at(`a name lookup through the local resolver socket ${path}`);
        else if (name === "connect" && (result === 0 || !finished)) at(`a connection to the local socket ${path}, which could relay outside the namespace`);
      } else if (!LOCAL_FAMILIES.has(family)) {
        at(`${name} on the socket family ${family}, which the gate cannot judge`);
      }
    }
  };
  for (const raw of text.split("\n")) {
    const match = /^(\d+)\s+(.*)$/.exec(raw.trim());
    const pid = match?.[1] ?? "", body = match?.[2] ?? raw.trim();
    if (!body) continue;
    const resumed = /^<\.\.\. (\w+) resumed>(.*)$/.exec(body);
    if (resumed) {
      const head = pending.get(pid);
      pending.delete(pid);
      judge(pid, `${head ?? `${resumed[1]}(`}${resumed[2]}`);
    } else if (body.endsWith("<unfinished ...>")) {
      pending.set(pid, body.slice(0, -"<unfinished ...>".length).trimEnd());
    } else judge(pid, body);
  }
  for (const [pid, head] of pending) judge(pid, head);
  return found;
}

/**
 * @typedef {object} Probe
 * @property {(path: string) => boolean} exists
 * @property {(command: string, args: readonly string[]) => boolean} runs  whether it exits 0
 */

/**
 * What this machine lacks to run the gate, each with the one command that fixes it. Pure over
 * `probe`. On macOS a sandbox-exec that is present may still be unable to apply a profile: inside
 * another sandbox (an agent's, for example) it fails with `sandbox_apply: Operation not permitted`
 * (measured, exit 71), so it is tried once with an allow-everything profile.
 * @param {string} platform @param {Probe} probe
 * @returns {string[]}
 */
export function missingTools(platform, probe) {
  const git = probe.runs(TOOLS.git, ["--version"]);
  if (platform === "darwin") {
    const sandbox = probe.exists(TOOLS.sandboxExec);
    return [
      ...sandbox ? [] : [`${TOOLS.sandboxExec} is missing, so nothing can be run with the network denied. It ships with macOS: run the gate on a Mac that has it`],
      ...!sandbox || probe.runs(TOOLS.sandboxExec, ["-p", "(version 1)(allow default)", TOOLS.true]) ? []
        : ["sandbox-exec cannot apply a profile here, most likely because this process already runs inside a sandbox (an agent's, for example). Fix: run pnpm check outside that sandbox"],
      ...probe.exists(TOOLS.log) ? [] : [`${TOOLS.log} is missing, so no deny line can be read. It ships with macOS: run the gate on a Mac that has it`],
      ...git ? [] : [`${TOOLS.git} does not run (without the Command Line Tools it is only a stub); the garden is checked inside a git repository. Fix: xcode-select --install`],
    ];
  }
  if (platform === "linux") {
    return [
      ...probe.exists(TOOLS.strace) ? [] : [`${TOOLS.strace} is missing, so no connection attempt can be seen. Fix: sudo apt-get install -y strace`],
      ...probe.exists(TOOLS.unshare) ? [] : [`${TOOLS.unshare} is missing, so nothing can be run without a network. Fix: sudo apt-get install -y util-linux`],
      ...probe.exists(TOOLS.ps) ? [] : [`${TOOLS.ps} is missing, so a process left running after its step cannot be found. Fix: sudo apt-get install -y procps`],
      ...git ? [] : [`${TOOLS.git} does not run; the garden is checked inside a git repository. Fix: sudo apt-get install -y git`],
    ];
  }
  return [`there is no offline harness for ${platform}: the brain is staged and gated on macOS and Linux only`];
}

/** @type {Probe} */
const systemProbe = {
  exists: path => existsSync(path),
  runs: (command, args) => existsSync(command)
    && spawnSync(command, args, { stdio: "ignore", timeout: 30_000, env: { PATH: "/usr/bin:/bin" }, cwd: tmpdir() }).status === 0,
};

/* ---- what is still running (pure judgement, effectful listing) ------------------------------ */

/**
 * @typedef {{ readonly pid: number, readonly pgid: number, readonly text: string }} ProcessRow
 *   `text` is the process's arguments, then its environment where the system shows it
 *
 * @typedef {object} RunMarks
 * @property {number} self  the gate's own pid
 * @property {string} dir  the run's throwaway directory, in every planted HOME, TMPDIR and path
 * @property {ReadonlyMap<number, string>} groups  each step's process group, and the step
 * @property {readonly string[]} bun  this checkout's staged bun, as given and resolved
 * @property {ReadonlySet<number>} before  the pids running that bun before the gate started
 */

/**
 * The processes left from this run: in a step's process group, naming the run's directory in their
 * arguments or environment (gbrain's detached update check inherits the brain's environment), or
 * running this checkout's staged bun that were not running when the gate started. Pure.
 * @param {readonly ProcessRow[]} rows @param {RunMarks} run
 * @returns {ProcessRow[]}
 */
export function survivorsAmong(rows, { self, dir, groups, bun, before }) {
  return rows.filter(row => row.pid !== self && (groups.has(row.pgid) || row.text.includes(dir)
    || (!before.has(row.pid) && bun.some(path => row.text === path || row.text.startsWith(`${path} `)))));
}

const execFileText = promisify(execFile);

/**
 * Every live process with its group, arguments and environment: on macOS `ps -E` (which shows the
 * environment of this user's own processes, measured), on Linux `/proc/<pid>/environ`. Read here
 * and never printed: another program's environment may hold secrets. A zombie has already ended
 * and is left out: in a container whose first process never reaps, it would stay listed.
 * @param {string} platform
 * @returns {Promise<ProcessRow[]>}
 */
async function processRows(platform) {
  const { stdout } = await execFileText(TOOLS.ps, ["-A", "-ww", ...(platform === "darwin" ? ["-E"] : []), "-o", "pid=,pgid=,stat=,args="], { maxBuffer: 256 * 1024 * 1024, env: { PATH: "/usr/bin:/bin" } });
  /** @type {ProcessRow[]} */
  const rows = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(line);
    if (!match || match[3]?.startsWith("Z")) continue;
    const pid = Number(match[1]);
    let text = (match[4] ?? "").replace(/^\s+/, "");
    if (platform === "linux") text += ` ${await readFile(`/proc/${pid}/environ`, "utf8").then(env => env.replaceAll("\0", " "), () => "")}`;
    rows.push({ pid, pgid: Number(match[2]), text });
  }
  return rows;
}

/**
 * Waits up to `boundMs` for every process of this run to end. Any left are described by pid and
 * arguments only (never their environment), killed, and returned as attempts.
 * @param {string} platform @param {RunMarks} run @param {{ boundMs?: number, pollMs?: number }} [options]
 * @returns {Promise<Attempt[]>}
 */
export async function outlived(platform, run, { boundMs = 10_000, pollMs = 250 } = {}) {
  /** @type {ProcessRow[]} */
  let left = [];
  for (let waited = 0; ; waited += pollMs) {
    left = survivorsAmong(await processRows(platform), run);
    if (left.length === 0 || waited >= boundMs) break;
    await sleep(pollMs);
  }
  if (left.length === 0) return [];
  const pids = left.map(row => row.pid);
  const shown = await execFileText(TOOLS.ps, ["-ww", "-o", "pid=,args=", "-p", pids.join(",")], { env: { PATH: "/usr/bin:/bin" } }).then(({ stdout }) => stdout, () => "");
  const args = new Map(shown.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? [[Number(match[1]), (match[2] ?? "").slice(0, 200)]] : [];
  }));
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  return left.map(row => ({ kind: /** @type {const} */ ("survivor"), step: run.groups.get(row.pgid) ?? "this run",
    text: `pid ${row.pid} was still running ${Math.round(boundMs / 1000)} s after the last step, and was killed: ${args.get(row.pid) ?? "(ended while being listed)"}` }));
}

/* ---- running steps -------------------------------------------------------------------------- */

/** @typedef {{ readonly code: number | null, readonly signal: NodeJS.Signals | null, readonly stdout: string, readonly stderr: string }} Ran */
/**
 * What else a step may start, beyond node and the shell. Each step is allowed only what its Foliage
 * command needs.
 * @typedef {object} Allow
 * @property {boolean} [gbrain]  the staged bun, so gbrain (true unless said). A step that must start
 *   no gbrain process says false, and the sandbox then kills and reports any bun it starts: that is
 *   how the gate proves keyword-mode `foliage search` and `foliage_search` never touch the brain.
 * @property {boolean} [git]  git and the signing programs it checks commits with (false unless said):
 *   only steps whose Foliage command reads a work repository (`foliage grow`, `migrate-queue`,
 *   `foliage up`'s collection pass) may start them
 */
/**
 * @typedef {object} StartOptions
 * @property {string} cwd
 * @property {Record<string, string>} env
 * @property {Allow} [allow]
 * @property {boolean} [stdin]  a pipe to the step's standard input (an MCP or private-brain session)
 * @property {readonly string[]} [owners]  macOS controls only: throwaway directories standing in
 *   for the owner's brains, so the write rule is shown to kill without going near the real ones
 * @property {number} [loopback]  macOS only (build order item 8): the one port on 127.0.0.1 this
 *   step may connect to, the stand-in embedder's. Every other outbound attempt, another loopback
 *   port and every name lookup included, is still killed and logged
 */
/**
 * @typedef {object} Harness
 * @property {string} describe
 * @property {(step: string, command: string, args: readonly string[], options: StartOptions) => import("node:child_process").ChildProcess} start
 *   every step starts in its own process group, recorded in `groups`
 * @property {Map<number, string>} groups
 * @property {(step: string) => Promise<Attempt[]>} observed  what one finished step was seen to try, where the
 *   observer can say at once (Linux reads the step's own strace log; macOS kills the process instead)
 * @property {() => Promise<Attempt[]>} finish  every attempt seen, once nothing more is running
 * @property {() => void} abort
 */

/**
 * @typedef {object} Programs
 * @property {string} node  Foliage's node, resolved
 * @property {string} bun  the staged bun, resolved
 * @property {readonly string[]} always  what every step may start: node, as given and resolved, and the shell
 * @property {readonly string[]} gbrain  the staged bun, as given and resolved
 * @property {readonly string[]} git  git, as given and resolved; on macOS also the developer tools'
 *   git that `/usr/bin/git` hands over to (measured: nothing else starts, not even xcrun); and the
 *   signing programs git checks commit signatures with, where installed under /usr/bin: Foliage's
 *   intake asks each for its version to say which signatures it can check
 *   (`packages/leaf/src/gitSource.ts`, `capabilityOf`; measured: `foliage grow` starts
 *   `/usr/bin/ssh-keygen`)
 */

/**
 * The only programs a step may start: node (Foliage, and the control), the staged bun, and the
 * shell; and git for a step that is allowed it (`Allow`). The shell is there because gbrain's
 * `init` starts one (measured on macOS, 2026-10-11): its closing status report runs
 * `execSync("<HOME>/.claude/skills/gstack/bin/gstack-global-discover")`
 * (`src/commands/init.ts:1479-1489`, `:1542`), and HOME is the brain's own, where nothing exists, so
 * the shell finds nothing to run. On macOS `/bin/sh` hands over to the shell `/private/var/select/sh`
 * names. Anything the shell itself tries to start is still denied. The spec says no allowed command
 * needs an outside program; this shell is a proposed amendment to it.
 * @param {string} platform @param {string} node @param {string} bun
 * @returns {Promise<Programs>}
 */
async function programsFor(platform, node, bun) {
  const resolved = { node: await realpath(node), bun: await realpath(bun) };
  const shell = platform === "darwin" ? "/private/var/select/sh" : "/bin/sh";
  const shells = ["/bin/sh", await realpath(shell).catch(() => "/bin/sh")];
  const handedTo = platform === "darwin"
    ? spawnSync("/usr/bin/xcrun", ["--find", "git"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, timeout: 30_000 }).stdout?.trim() ?? ""
    : "";
  const signing = ["/usr/bin/ssh-keygen", "/usr/bin/gpg"].filter(path => existsSync(path));
  const named = [TOOLS.git, ...handedTo ? [handedTo] : [], ...signing];
  const git = [...named, ...await Promise.all(named.map(path => realpath(path).catch(() => path)))];
  return { ...resolved, always: [...new Set([node, resolved.node, ...shells])], gbrain: [...new Set([bun, resolved.bun])], git: [...new Set(git)] };
}

/**
 * Every program a step may start. Pure.
 * @param {Programs} programs @param {Allow} [allow]
 */
export function allowedFor(programs, { gbrain = true, git = false } = {}) {
  return [...programs.always, ...gbrain ? programs.gbrain : [], ...git ? programs.git : []];
}

/**
 * The macOS profile's program slots: one per program any step may start, in a fixed order, so one
 * profile serves every step. A program this step may not start leaves its slot holding node, which
 * every step may start anyway. Pure.
 * @param {Programs} programs @param {Allow} [allow]
 */
export function programSlots(programs, allow) {
  const allowed = new Set(allowedFor(programs, allow));
  return [...programs.always, ...programs.gbrain, ...programs.git].map(path => allowed.has(path) ? path : programs.node);
}

/**
 * A step's outcome. It waits for its output to close, but no more than 5 seconds after the process
 * itself ended: a detached descendant holding the pipe must not hang the gate (the survivor check
 * finds it instead).
 * @param {import("node:child_process").ChildProcess} child @returns {Promise<Ran>}
 */
const finished = (child) => new Promise((resolve, reject) => {
  let stdout = "", stderr = "";
  child.stdout?.on("data", chunk => { stdout += String(chunk); });
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  child.once("error", reject);
  /** @type {NodeJS.Timeout | undefined} */
  let grace;
  child.once("exit", (code, signal) => {
    grace = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code, signal, stdout, stderr });
    }, 5_000);
  });
  child.once("close", (code, signal) => { clearTimeout(grace); resolve({ code, signal, stdout, stderr }); });
});

/** What a path names once it exists: its deepest existing ancestor with links resolved, then the rest. @param {string} path */
async function resolvedPath(path) {
  /** @type {string[]} */
  const rest = [];
  for (let head = path; ;) {
    try { return join(await realpath(head), ...rest); }
    catch {
      const parent = dirname(head);
      if (parent === head) return path;
      rest.unshift(basename(head));
      head = parent;
    }
  }
}

/** The owner's own brains, for `$HOME` and the account's home, as named and with links resolved. */
async function ownerBrainPaths() {
  const homes = new Set([homedir()]);
  try { homes.add(userInfo().homedir); } catch { /* no account entry: $HOME is all there is */ }
  const named = [...homes].flatMap(home => [join(home, ".gbrain"), join(home, "brain")]);
  return [...new Set([...named, ...await Promise.all(named.map(resolvedPath))])];
}

/**
 * macOS. The profile kills on the first outbound attempt (a connect or a lookup: exit 137,
 * measured), on any write under the owner's real brains, and on starting any program but node, the
 * staged bun and the shell, or git for a step allowed it (measured: a denied exec kills the process
 * that asked; a PATH lookup that finds nothing is no exec and is not killed).
 * @param {string} dir @param {Programs} programs
 * @returns {Promise<Harness>}
 */
async function macHarness(dir, programs) {
  const run = randomUUID();
  const owners = await ownerBrainPaths();
  const rule = `(with send-signal SIGKILL) (with message (param "GATE_TAG"))`;
  /** The profile's text; with `port`, outbound to `localhost:<port>` alone is allowed (measured: another loopback port, a lookup and a remote address are each killed). @param {number | null} port */
  const profileText = (port) => [
    "(version 1)", "(allow default)",
    port === null ? `(deny network-outbound ${rule})` : `(deny network-outbound ${rule} (require-not (remote ip "localhost:${port}")))`,
    `(deny file-write* ${rule} ${owners.map((_, at) => `(subpath (param "OWNER_${at}"))`).join(" ")})`,
    `(deny process-exec* ${rule} (require-not (require-any ${programSlots(programs).map((_, at) => `(literal (param "PROGRAM_${at}"))`).join(" ")})))`, "",
  ].join("\n");
  const profile = join(dir, "offline.sb");
  await writeFile(profile, profileText(null));
  /** The profile that lets a step reach one loopback port, written once per port. @param {number} port */
  const loopbackProfile = (port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`not a loopback port: ${port}`);
    const path = join(dir, `offline-loopback-${port}.sb`);
    if (!existsSync(path)) writeFileSync(path, profileText(port));
    return path;
  };
  // Started before anything runs. Only this run's lines are kept as they arrive.
  const log = spawn(TOOLS.log, ["stream", "--style", "ndjson", "--predicate", 'eventMessage CONTAINS "deny("'], { stdio: ["ignore", "pipe", "pipe"] });
  let seen = "", partial = "", started = false;
  const take = (/** @type {Buffer} */ chunk) => {
    const lines = (partial + String(chunk)).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("Filtering the log data")) started = true;
      else if (line.includes(`${GATE_MARK} ${run} `)) seen += `${line}\n`;
    }
  };
  log.stdout.on("data", take);
  let errors = "";
  log.stderr.on("data", chunk => { errors += String(chunk); });
  const ended = new Promise(resolve => log.once("close", resolve));
  for (let waited = 0; !started; waited += 50) {
    if (waited > 10_000 || log.exitCode !== null) throw new Error(`log stream did not start: ${errors.trim() || "no output"}`);
    await sleep(50);
  }
  /** @type {Map<number, string>} */
  const groups = new Map();
  return {
    describe: "macOS sandbox-exec: all outbound network, writes under ~/.gbrain and ~/brain, and any program but node, the staged bun, the shell and (where a step reads a work repository) git and its signing programs denied with SIGKILL; deny lines read from log stream",
    groups,
    start(step, command, args, { cwd, env, allow, stdin = false, owners: standIns, loopback }) {
      // A control's stand-ins fill every owner slot, so the rule text is the real one.
      const filled = standIns ? owners.map((_, at) => standIns[at % standIns.length] ?? "") : owners;
      const child = spawn(TOOLS.sandboxExec, [
        "-D", `GATE_TAG=${GATE_MARK} ${run} ${step}`, ...filled.flatMap((path, at) => ["-D", `OWNER_${at}=${path}`]),
        ...programSlots(programs, allow).flatMap((path, at) => ["-D", `PROGRAM_${at}=${path}`]),
        "-f", loopback === undefined ? profile : loopbackProfile(loopback), command, ...args,
      ], { cwd, env, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"], detached: true });
      if (child.pid !== undefined) groups.set(child.pid, step);
      return child;
    },
    async observed() { return []; },
    async finish() {
      await sleep(2_500); // the kernel's lines reach log stream shortly after the event (measured)
      log.kill("SIGTERM");
      await ended;
      take(Buffer.from("\n"));
      return macAttempts(seen, run);
    },
    abort() { log.kill("SIGKILL"); },
  };
}

/**
 * The words for a machine where no empty network namespace can be made. Pure.
 * @param {boolean} sudoAllowed
 */
export function namespaceFailure(sudoAllowed) {
  const blocked = "no empty network namespace can be made here: unprivileged user namespaces are blocked (Ubuntu 23.10 and later restrict them through AppArmor)";
  return sudoAllowed
    ? `${blocked}, and \`sudo -n\` cannot run unshare without a password. Fix: run the gate where \`sudo -n\` works`
    : `${blocked}. Fix: FOLIAGE_BRAIN_GATE_SUDO=1 pnpm check, where \`sudo -n\` works: the gate then makes each namespace as root and drops back to you with setpriv. (Allowing unprivileged user namespaces for the whole machine also works, but turns off that AppArmor protection for every program.)`;
}

/**
 * Linux: #205's earlier item 2 and 4 steps were measured on arm64 in a Docker container, in both
 * namespace modes; this merged gate has NOT YET RUN on Linux, nor on ubuntu-latest. One strace log
 * per step, so attempts are attributed by step. Unprivileged namespaces are tried first; Ubuntu
 * 24.04's AppArmor may block them, so `sudo -n unshare --net` with `setpriv` back to this user is
 * the fallback (spec, Linux harness), taken only in CI or when the
 * developer opts in with FOLIAGE_BRAIN_GATE_SUDO=1: on a developer's machine `sudo -n` may succeed
 * on cached credentials, and the gate does not become root unasked. The current user is mapped to
 * itself, not to root: as root inside a user namespace the owner's home lookup would land on an
 * unreadable /root.
 * @param {string} dir @param {Programs} programs @param {boolean} sudoAllowed
 * @returns {Promise<Harness>}
 */
async function linuxHarness(dir, programs, sudoAllowed) {
  /** @type {(args: string[], env: Record<string, string>) => { command: string, args: string[], env: Record<string, string> }} */
  let wrap;
  let how;
  if (spawnSync(TOOLS.unshare, ["--map-current-user", "--net", "--", TOOLS.true]).status === 0) {
    wrap = (args, env) => ({ command: TOOLS.unshare, args: ["--map-current-user", "--net", "--", ...args], env });
    how = "unshare --map-current-user --net";
  } else if (sudoAllowed && [TOOLS.sudo, TOOLS.setpriv, TOOLS.env].every(tool => existsSync(tool))
    && spawnSync(TOOLS.sudo, ["-n", TOOLS.unshare, "--net", "--", TOOLS.true]).status === 0) {
    const { uid, gid } = userInfo();
    wrap = (args, env) => ({
      command: TOOLS.sudo,
      args: ["-n", TOOLS.unshare, "--net", "--", TOOLS.setpriv, `--reuid=${uid}`, `--regid=${gid}`, "--clear-groups", "--", TOOLS.env, "-i", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), ...args],
      env: {},
    });
    how = "sudo -n unshare --net, then setpriv back to this user";
  } else {
    throw new Error(namespaceFailure(sudoAllowed));
  }
  /** @type {{ step: string, log: string, allowed: ReadonlySet<string> }[]} */
  const logs = [];
  /** @param {{ step: string, log: string, allowed: ReadonlySet<string> }} entry @returns {Promise<Attempt[]>} */
  const read = async ({ step, log, allowed }) => {
    let text;
    try { text = await readFile(log, "utf8"); } catch { return [{ kind: "other", step, text: "strace wrote no log, so this step was not observed" }]; }
    return straceAttempts(text, step, allowed);
  };
  /** @type {Map<number, string>} */
  const groups = new Map();
  return {
    describe: `Linux ${how}, every step under strace (connect, send and execve); measured green on ubuntu-latest in #212`,
    groups,
    start(step, command, args, { cwd, env, allow, stdin = false, loopback }) {
      // An empty namespace's loopback is out of the gate's reach, so no Linux step talks to a server on it.
      if (loopback !== undefined) throw new Error(`[${step}] a Linux step cannot reach the gate's loopback`);
      const log = join(dir, `strace-${logs.length}.log`);
      logs.push({ step, log, allowed: new Set(allowedFor(programs, allow)) });
      // --seccomp-bpf stops the tracee only on the traced calls (it implies -f); without it every
      // system call of every bun thread stops for strace, many times slower.
      const traced = wrap([TOOLS.strace, "-f", "--seccomp-bpf", "-qq", "-e", "signal=none", "-e", "trace=connect,sendto,sendmsg,sendmmsg,execve", "-s", "256", "-o", log, "--", command, ...args], env);
      const child = spawn(traced.command, traced.args, { cwd, env: traced.env, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"], detached: true });
      if (child.pid !== undefined) groups.set(child.pid, step);
      return child;
    },
    async observed(step) {
      const last = logs.findLast(entry => entry.step === step);
      return last === undefined ? [] : read(last);
    },
    async finish() {
      return (await Promise.all(logs.map(read))).flat();
    },
    abort() { /* each step's strace ends with its step */ },
  };
}

/* ---- the scenario --------------------------------------------------------------------------- */

/**
 * How a step must end. `stopped` is for a step the gate stops itself (`foliage up`): it exits 0 or
 * ends by the SIGTERM the gate sent, never by SIGKILL, which is the sandbox's.
 * @typedef {{ code: number } | { signal: "SIGKILL" } | { stopped: true }} Expect
 * @typedef {{ step: string, ran: Ran }} Done
 */

/** @param {Ran} ran @param {Expect} expect */
const meets = (ran, expect) => "code" in expect ? ran.signal === null && ran.code === expect.code
  : "signal" in expect ? ran.signal === "SIGKILL" || ran.code === 137
  : (ran.signal === null && ran.code === 0) || ran.signal === "SIGTERM" || ran.code === 143;

/**
 * @typedef {object} StepOptions
 * @property {Expect} [expect]  how the step must end; exit 0 unless said
 * @property {Allow} [allow]  what it may start beyond node and the shell
 * @property {boolean} [stdin]  a pipe to its standard input
 * @property {string} [cwd]  the garden unless said
 * @property {Record<string, string>} [env]  the planted environment unless said
 * @property {number} [loopback]  macOS only: the one 127.0.0.1 port the step may connect to (item 8's stand-in embedder)
 */
/**
 * A step the gate talks to while it runs (`foliage up`, an MCP session, a private-brain session).
 * @typedef {object} Running
 * @property {import("node:child_process").ChildProcess} child
 * @property {Promise<Ran>} settled  once it ended as expected; it rejects otherwise
 */
/**
 * One garden's steps, each run sandboxed. The garden sits in a git repository whose .gitignore
 * covers brain/, under live `.gbrain-source` and `.gbrain-mount` files.
 * @typedef {object} GardenSteps
 * @property {string} garden
 * @property {string} repo
 * @property {ReturnType<typeof brainPaths>} paths
 * @property {(step: string, args: readonly string[], options?: StepOptions) => Promise<Ran>} brain
 *   `foliage brain <args>`, so every gbrain process starts through Foliage's one spawn function
 * @property {(step: string, args: readonly string[], options?: StepOptions) => Promise<Ran>} foliage  the real launcher, `foliage <args>`
 * @property {(step: string, args: readonly string[], options?: StepOptions) => Promise<Ran>} node  node with these arguments, in the garden
 * @property {(step: string, command: import("../../apps/leaf/src/localBrain.ts").GbrainCommand, options?: StepOptions) => Promise<Ran>} gbrain
 *   a gbrain command exactly as the spawn function builds it (`gbrainArgs`), with the brain's own
 *   environment: the reads that check what Foliage left, and the settings the controls change
 * @property {(step: string, op: string, params: Record<string, unknown>, options?: StepOptions) => Promise<Ran>} call  a `call` op through `gbrain`
 * @property {(step: string, args: readonly string[], options?: StepOptions) => Promise<Ran>} direct  hand-built gbrain arguments: the deliberate controls only
 * @property {(step: string, command: string, args: readonly string[], options?: StepOptions) => Running} running
 * @property {() => Promise<void>} closed  brain/work and brain/bin are empty, and bun kept no transpiler cache under the brain's home
 */
/**
 * What each phase of the gate gets.
 * @typedef {object} GateContext
 * @property {string} platform
 * @property {string} root  this checkout
 * @property {string} dir  the run's throwaway directory
 * @property {Programs} programs
 * @property {Record<string, string>} env  the planted environment every step gets
 * @property {(line: string) => void} say
 * @property {(name: string) => Promise<GardenSteps>} garden  a fresh garden for one phase
 * @property {(cwd: string, ...args: string[]) => string} git  git as setup, outside the sandbox, in a throwaway HOME: a work repository's commits
 * @property {(step: string, args: readonly string[], cwd: string) => Ran} outside  Foliage's own node code run outside the sandbox,
 *   only where the macOS profile itself kills it (`link(2)`); named, and its output is still checked for planted values
 */

/**
 * Every switch the spec lists, planted once for the whole run: keys, database and base URLs,
 * proxies, BUN_OPTIONS, routing variables, GBRAIN_HOME aimed at a DECOY home whose config holds
 * planted secrets, and a fake `gbrain` first on PATH. Built here, never inherited: on the self-hosted
 * runner the parent environment holds the owner's credentials. Every value is throwaway or planted.
 * @param {string} dir
 */
async function plantedWorld(dir) {
  const home = join(dir, "home"), fakeBin = join(dir, "fake-bin");
  for (const path of [home, fakeBin]) await mkdir(path, { recursive: true });
  // A gbrain on the parent PATH, a preload and a transpiler cache that would each leave a mark.
  const marks = { fakeGbrain: join(dir, "FAKE-GBRAIN-RAN"), preload: join(dir, "PLANTED-PRELOAD-RAN"), cache: join(dir, "planted-transpiler-cache") };
  await writeFile(join(fakeBin, "gbrain"), `#!/bin/sh\ntouch '${marks.fakeGbrain}'\n`);
  await chmod(join(fakeBin, "gbrain"), 0o755);
  const preload = join(dir, "planted-preload.js");
  await writeFile(preload, `require("fs").writeFileSync(${JSON.stringify(marks.preload)}, "ran");\n`);

  // The DECOY: a gbrain home whose config holds planted secrets. If GBRAIN_HOME ever got through,
  // gbrain would load it and try its database.
  const decoy = join(dir, "decoy-gbrain-home");
  await mkdir(join(decoy, ".gbrain"), { recursive: true });
  await writeFile(join(decoy, ".gbrain", "config.json"), `${JSON.stringify({
    engine: "postgres", database_url: `postgres://${SENTINEL}@example.test:5432/${SENTINEL}`,
    openai_api_key: `${SENTINEL}-openai-key`, anthropic_api_key: `${SENTINEL}-anthropic-key`,
  }, null, 2)}\n`);

  // The owner's own brain is named to no process; only these two files are compared, because the
  // owner's gbrain writes elsewhere in ~/.gbrain all day (spec).
  const ownerGbrain = join(userInfo().homedir, ".gbrain");
  const ownerFiles = async () => Promise.all(["config.json", "brain.pglite"].map(name =>
    stat(join(ownerGbrain, name)).then(info => `${name}:${info.size}:${info.mtimeMs}`, () => `${name}:absent`)));

  const key = `${SENTINEL}-not-a-key`, database = `postgres://${SENTINEL}@example.test:5432/${SENTINEL}`;
  /** @type {Record<string, string>} */
  const env = {
    HOME: home, PATH: `${fakeBin}:/usr/bin:/bin`, TMPDIR: dir,
    OPENAI_API_KEY: key, ANTHROPIC_API_KEY: key, VOYAGE_API_KEY: key, ZEROENTROPY_API_KEY: key, GEMINI_API_KEY: key, GOOGLE_API_KEY: key,
    DATABASE_URL: database, GBRAIN_DATABASE_URL: database,
    OLLAMA_BASE_URL: "http://example.test", LLAMA_SERVER_BASE_URL: "http://example.test:8080",
    HTTP_PROXY: "http://example.test:3128", HTTPS_PROXY: "http://example.test:3128", ALL_PROXY: "http://example.test:3128", NO_PROXY: "",
    GBRAIN_HOME: decoy, GBRAIN_SOURCE: PLANTED_SOURCE, GBRAIN_BRAIN_ID: PLANTED_MOUNT, GBRAIN_SELF_UPGRADE_MODE: "auto",
    GBRAIN_CONTRIBUTOR_MODE: "1", BUN_OPTIONS: `--preload ${preload}`, BUN_RUNTIME_TRANSPILER_CACHE_PATH: marks.cache,
  };
  return { home, env, marks, preload, key, database, decoy, decoyBefore: await treeDigest(decoy), ownerFiles, ownerBefore: await ownerFiles() };
}

/**
 * One sandboxed step's end: it must end exactly as `expect` says (a process killed by the sandbox
 * is named so), and the observer must have seen it try nothing. Kept in `done` for the leak check.
 * @param {Harness} harness @param {Done[]} done @param {string} step
 * @param {import("node:child_process").ChildProcess} child @param {Expect} expect @param {(line: string) => void} say
 * @returns {Promise<Ran>}
 */
async function settleStep(harness, done, step, child, expect, say) {
  const began = Date.now();
  const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
  const ran = await finished(child).finally(() => clearTimeout(timer));
  done.push({ step, ran });
  if (!meets(ran, expect)) {
    const how = ran.signal ? `was killed by ${ran.signal}` : `exited ${ran.code}`;
    const why = ran.signal === "SIGKILL" || ran.code === 137
      ? " (the sandbox kills a process on a denied network, write or program attempt, and link(2) is killed with no deny line)" : "";
    const wanted = "code" in expect ? `exit ${expect.code}` : "signal" in expect ? "SIGKILL" : "exit 0 or the gate's SIGTERM";
    throw new Error(`EXIT STATUS: [${step}] ${how}, expected ${wanted}${why}\n${ran.stdout}${ran.stderr}`.trimEnd());
  }
  const tried = await harness.observed(step);
  if (tried.length > 0) throw new Error(`[${step}] ended as expected, but the observer saw it try to reach out, write the owner's brain or start a program`);
  say(`  ok  ${step} (${((Date.now() - began) / 1000).toFixed(1)} s)`);
  return ran;
}

/**
 * Every phase of the gate, against the staged runtime under `harness`: build order items 2 and 4
 * here, then items 3, 5 and 6 (`offline-proofs.mjs`), each in its own garden; then the checks that
 * nothing planted took effect. Throws at the first step that does not end as expected; `done`
 * keeps every output for the leak check; `ran` receives each phase that ran, for the green line.
 * @param {Harness} harness @param {Programs} programs @param {string} dir @param {string} root @param {string} platform
 * @param {Done[]} done @param {(line: string) => void} say @param {readonly string[]} [phases] @param {string[]} [ran]
 */
async function scenario(harness, programs, dir, root, platform, done, say, phases = PHASES, ran = []) {
  const vendor = join(root, "vendor"), layout = vendorLayout(vendor);
  const cli = join(root, "apps", "leaf", "brain.mjs"), launcher = join(root, "foliage.mjs");
  const world = await plantedWorld(dir);
  const gitEnv = { PATH: "/usr/bin:/bin", HOME: world.home };
  /** Outputs of what ran outside the sandbox: not counted as sandboxed, still searched for planted values. */
  /** @type {Done[]} */
  const outside = [];

  /** @param {string} step @param {import("node:child_process").ChildProcess} child @param {Expect} expect */
  const settle = (step, child, expect) => settleStep(harness, done, step, child, expect, say);

  /** @param {string} garden @param {string} repo @returns {GardenSteps} */
  const gardenSteps = (garden, repo) => {
    const paths = brainPaths(garden);
    /** @param {string} step @param {string} command @param {readonly string[]} args @param {StepOptions} [options] */
    const begin = (step, command, args, { cwd = garden, env = world.env, allow, stdin = false, loopback } = {}) =>
      harness.start(step, command, args, { cwd, env, stdin, ...(allow === undefined ? {} : { allow }), ...(loopback === undefined ? {} : { loopback }) });
    /** @param {string} step @param {string} command @param {readonly string[]} args @param {StepOptions} [options] */
    const run = (step, command, args, options = {}) => settle(step, begin(step, command, args, options), options.expect ?? { code: 0 });
    /** @param {string} step @param {readonly string[]} args @param {StepOptions} [options] */
    const direct = (step, args, options = {}) =>
      run(step, programs.bun, ["--no-install", "--no-env-file", layout.cli, ...args], { cwd: paths.work, env: gbrainEnvironment(paths), ...options });
    /** @param {string} step @param {import("../../apps/leaf/src/localBrain.ts").GbrainCommand} command @param {StepOptions} [options] */
    const gbrain = (step, command, options) => direct(step, ["--brain", "host", ...gbrainArgs(paths, command)], options);
    return {
      garden, repo, paths, direct, gbrain,
      brain: (step, args, options) => run(step, programs.node, [cli, ...args, "--garden", garden], options),
      foliage: (step, args, options) => run(step, programs.node, [launcher, ...args, "--garden", garden], options),
      node: (step, args, options) => run(step, programs.node, args, options),
      call: (step, op, params, options) => gbrain(step, { kind: "call", op, params }, options),
      running(step, command, args, options = {}) {
        const child = begin(step, command, args, options);
        const settled = settle(step, child, options.expect ?? { code: 0 });
        // Handled at once, so a step that ends before the gate awaits it leaves no unhandled rejection.
        settled.catch(() => undefined);
        return { child, settled };
      },
      async closed() {
        if (!existsSync(paths.brain)) return;
        ensure((await readdir(paths.work)).length === 0 && (await readdir(paths.bin)).length === 0, `${garden}: brain/work or brain/bin is not empty`);
        ensure(!existsSync(join(paths.home, "Library")) && !existsSync(join(paths.home, ".cache", "bun")), "bun wrote a transpiler cache under the brain's home");
      },
    };
  };

  /** @type {GateContext} */
  const ctx = {
    platform, root, dir, programs, env: world.env, say,
    async garden(name) {
      const repo = join(dir, name.replace(/[^a-z0-9]+/gi, "-"), "repo"), garden = join(repo, "garden");
      await mkdir(garden, { recursive: true });
      ensure(spawnSync(TOOLS.git, ["init", "--quiet", repo], { env: gitEnv }).status === 0, "git init failed");
      await writeFile(join(repo, ".gitignore"), "brain/\n");
      await writeFile(join(repo, ".gbrain-source"), `${PLANTED_SOURCE}\n`);
      await writeFile(join(repo, ".gbrain-mount"), `${PLANTED_MOUNT}\n`);
      return gardenSteps(garden, repo);
    },
    git(cwd, ...args) {
      const ran = spawnSync(TOOLS.git, ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8", env: gitEnv });
      ensure(ran.status === 0, `git ${args.join(" ")} failed: ${ran.stderr}`);
      return ran.stdout.trim();
    },
    outside(step, args, cwd) {
      const ran = spawnSync(programs.node, args, { cwd, env: world.env, encoding: "utf8", timeout: 120_000 });
      /** @type {Ran} */
      const result = { code: ran.status, signal: ran.signal, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
      outside.push({ step, ran: result });
      ensure(meets(result, { code: 0 }), `[${step}] (outside the sandbox) exited ${ran.status ?? ran.signal}\n${result.stdout}${result.stderr}`);
      say(`  ..  ${step} (outside the sandbox, which kills its link(2))`);
      return result;
    },
  };

  if (phases.includes("2")) {
    say("  --  build order items 2 and 4: build, settings, routing files, search, removal, planted switches, a killed build");
    await itemsTwoAndFour(ctx, world);
    ran.push("2");
  }
  if (phases.includes("3")) {
    say("  --  build order item 3: recall, held-back records, structure markers, removals, the law's rebuilds, killed refreshes");
    await itemThree(ctx);
    ran.push("3");
  }
  if (phases.includes("5")) {
    say("  --  build order item 5: the brain kept current by real actions, an MCP-only session, a failing refresh");
    await itemFive(ctx);
    ran.push("5");
  }
  if (phases.includes("6")) {
    say("  --  build order item 6: foliage search and foliage_search in keyword mode, beside the brain; the other surfaces unchanged");
    await itemSix(ctx);
    ran.push("6");
  }
  if (phases.includes("8")) {
    say("  --  build order item 8: local embeddings on and off through a loopback stand-in embedder; no connection leaves loopback");
    if (await itemEight(ctx)) ran.push("8");
  }

  // No effect: nothing planted ran, the decoy and the owner's own brain are untouched, and no
  // planted value reached any output.
  ensure(!existsSync(world.marks.fakeGbrain), "the gbrain on the parent PATH, or one planted in brain/bin, ran");
  ensure(!existsSync(world.marks.preload), "an inherited BUN_OPTIONS preload, or a planted bunfig.toml, ran");
  ensure(!existsSync(world.marks.cache), "bun used the inherited transpiler cache path");
  ensure(JSON.stringify(await world.ownerFiles()) === JSON.stringify(world.ownerBefore), "OWNER BRAIN: ~/.gbrain/config.json or brain.pglite changed during the run");
  ensure(await treeDigest(world.decoy) === world.decoyBefore, "the decoy gbrain home was touched, so GBRAIN_HOME got through");
  const leaked = [...done, ...outside].filter(({ ran }) => `${ran.stdout}${ran.stderr}`.includes(SENTINEL)).map(({ step }) => step);
  ensure(leaked.length === 0, `a planted value appeared in the output of: ${leaked.join(", ")}`);
}

/**
 * BUILD ORDER ITEMS 2 AND 4, in one garden: a brain builds offline under every planted switch; its
 * config is exactly Foliage's and every setting reads back; under live routing files, in a
 * repository that ignores brain/, it holds every page; a search (`foliage brain search`) commits no
 * write to the brain, and the control shows the check would see one; a removal (`foliage brain
 * refresh` after a leaflet leaves the record) leaves nothing in any version; every switch planted
 * inside the brain is refused by name; and the lock is reclaimed after a SIGKILL mid-build. SYNTHETIC
 * record, labelled so.
 * @param {GateContext} ctx @param {Awaited<ReturnType<typeof plantedWorld>>} world
 */
async function itemsTwoAndFour(ctx, world) {
  const g = await ctx.garden("items 2 and 4");
  const { garden, paths, repo } = g;
  const leafFile = join(garden, "leaf.json");
  // Which records go in: everything private, labelled, minus an excluded leaflet's body and records
  // resting on notes about other people (owner decision 1). An excluded leaflet goes in as its title
  // and reason only (item 3); there are no drafts or past versions here.
  const leaf = {
    id: "synthetic-offline-gate", subject: "Synthetic offline gate fixture", headline: "Synthetic headline for the brain offline gate",
    profile: { bio: "Synthetic biography text for the brain offline gate." },
    leaflets: [
      { id: "verified-one", title: "Synthetic verified leaflet", tier: "verified", provenance: OWN, body: [{ provenance: OWN, text: "Synthetic text about PGLite and offline builds." }] },
      { id: "pending-one", title: "Synthetic pending leaflet", tier: "pending", provenance: OWN, body: [{ provenance: OWN, text: "Synthetic text with a line that reads\n<!-- timeline -->\nand more after it." }] },
      { id: "excluded-one", title: "Synthetic excluded leaflet", tier: "excluded", reason: "Synthetic: not the subject's work.", body: [{ provenance: OWN, text: "EXCLUDED-BODY-MARKER" }] },
      { id: "third-party", title: "Synthetic leaflet resting on a note about someone else", tier: "pending", provenance: OTHER, body: [{ provenance: OTHER, text: "THIRD-PARTY-MARKER" }] },
    ],
    achievements: [
      { id: "a1", title: "Synthetic achievement", claims: [{ id: "c1", kind: "learning", text: "Synthetic claim text.", citations: [{ leaflet: "verified-one", provenance: OWN }] }] },
      { id: "a2", title: "Synthetic achievement with no claims", claims: [] },
    ],
  };
  await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
  const current = "Brain: current\n";

  // 1. A brain builds from the garden, and its config is exactly Foliage's.
  ensure((await g.brain("build", ["build"])).stdout === current, "the first build did not print Brain: current");
  ensure(await readFile(paths.config, "utf8") === brainConfigText(paths), "CONFIG DRIFT: config.json is not Foliage's exact file after a build");
  ensure((await g.brain("status: every setting read back", ["status"])).stdout === current, "status after a build is not current");
  const manifestAt = (await stat(paths.manifest)).mtimeMs;
  ensure((await g.brain("build of a current brain", ["build"])).stdout === current, "a build of a current brain is not current");
  ensure((await stat(paths.manifest)).mtimeMs === manifestAt, "a build of a current brain rewrote the manifest");

  // 2. Every page, under live routing files, in a repository that ignores brain/; the excluded
  // leaflet as its title and reason only, nothing third-party.
  const manifest = /** @type {{ pages: Record<string, { record: string }> }} */ (JSON.parse(await readFile(paths.manifest, "utf8")));
  const written = (await readdir(join(paths.pages, "foliage"))).map(name => `foliage/${name.replace(/\.md$/, "")}`).sort();
  ensure(JSON.stringify(Object.keys(manifest.pages).sort()) === JSON.stringify(written), "the manifest and the written pages differ");
  const records = JSON.stringify(Object.values(manifest.pages).map(page => page.record).sort());
  ensure(records === JSON.stringify(["achievement:a2", "claim:a1:c1", "leaflet:excluded-one", "leaflet:pending-one", "leaflet:verified-one", "profile:bio", "profile:headline"]),
    `the brain holds other records than these: ${records}`);
  ensure(spawnSync(TOOLS.git, ["-C", repo, "check-ignore", "-q", `garden/brain/pages/${written[0]}.md`], { env: { PATH: "/usr/bin:/bin", HOME: world.home } }).status === 0,
    "the pages are not gitignored, so the garden-in-a-repo switch was not exercised");
  const listed = await g.call("list_pages", "list_pages", { limit: 100, sort: "slug" });
  ensure(JSON.stringify(/** @type {{ slug: string }[]} */ (JSON.parse(listed.stdout)).map(row => row.slug).sort()) === JSON.stringify(written), "list_pages does not hold exactly the pages Foliage wrote");
  // Deliberate controls, hand-built: without --brain, and without --source.
  const noBrain = await g.direct("control: the routing files are live without --brain", ["call", "--source", "default", "list_pages", "{}"], { expect: { code: 1 } });
  ensure(noBrain.stderr.includes(`Unknown brain: "${PLANTED_MOUNT}"`), "the planted .gbrain-mount was not live, so the routing switch was not exercised");
  const noSource = await g.direct("control: the routing files are live without --source", ["--brain", "host", "call", "list_pages", "{}"], { expect: { code: 1 } });
  ensure(`${noSource.stdout}${noSource.stderr}`.includes(PLANTED_SOURCE), "the planted .gbrain-source was not live, so the routing switch was not exercised");
  const pagesText = (await Promise.all(written.map(slug => readFile(join(paths.pages, `${slug}.md`), "utf8")))).join("\n");
  ensure(!pagesText.includes("EXCLUDED-BODY-MARKER") && !pagesText.includes("THIRD-PARTY-MARKER"), "an excluded body or a third-party record reached a page");

  // 3. A search through Foliage (`foliage brain search`) commits no write to the brain (PGLite's
  // commit log, pg_xact; every gbrain process touches pg_control and the WAL when it opens the
  // database, so a digest of the whole directory cannot tell). The control turns
  // search.track_retrieval on and sees the same search write.
  const commitLog = () => treeDigest(join(paths.database, "pg_xact"));
  const search = async (/** @type {string} */ step) => {
    const found = JSON.parse((await g.brain(step, ["search", "PGLite", "--limit", "5"])).stdout);
    ensure(found.retrieval === "brain keyword" && found.hits.length > 0, `${step}: the brain did not answer, or found nothing (${found.because ?? "no reason given"})`);
  };
  const quiet = await commitLog();
  await search("search");
  await search("search again");
  ensure(await commitLog() === quiet, "a search through Foliage committed a write to the brain");
  await g.direct("control: search.track_retrieval on", ["--brain", "host", "config", "set", "search.track_retrieval", "true"]);
  const switched = await commitLog();
  await search("control: search with tracking on");
  ensure(await commitLog() !== switched, "control: with search.track_retrieval on, the search did not write, so the commit-log check sees nothing");
  await g.gbrain("search.track_retrieval off again", { kind: "config-set", key: "search.track_retrieval" });

  // 4. A removal through Foliage: a leaflet leaves the record, and `foliage brain refresh` deletes
  // its page, purges it at 0 hours and checks; nothing of it is left in any version.
  const removed = Object.entries(manifest.pages).find(([, page]) => page.record === "leaflet:pending-one")?.[0] ?? "";
  leaf.leaflets = leaf.leaflets.filter(leaflet => leaflet.id !== "pending-one");
  await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
  ensure((await g.brain("refresh that removes a page", ["refresh"])).stdout === current, "the refresh that removes a page is not current");
  const gone = await g.call("get_page with include_deleted", "get_page", { slug: removed, include_deleted: true }, { expect: { code: 1 } });
  ensure(`${gone.stdout}${gone.stderr}`.includes("Page not found"), "a removed page is still found with include_deleted");
  ensure((await g.call("get_versions", "get_versions", { slug: removed })).stdout.trim() === "[]", "a removed page still has versions");

  // 5. Planted switches inside the brain are refused by name before any gbrain process starts.
  const refusals = /** @type {const} */ ([
    ["work/.env", "brain/work is not empty, and bun would read a .env or bunfig.toml there"],
    ["work/bunfig.toml", "brain/work is not empty, and bun would read a .env or bunfig.toml there"],
    ["bin/gbrain", "brain/bin is not empty, and it is the whole PATH of every gbrain process, so a program there could be started"],
  ]);
  const plantedText = {
    "work/.env": `DATABASE_URL=${world.database}\nOPENAI_API_KEY=${world.key}\n`,
    "work/bunfig.toml": `preload = [${JSON.stringify(world.preload)}]\n`,
    "bin/gbrain": `#!/bin/sh\ntouch '${world.marks.fakeGbrain}'\n`,
  };
  for (const [file, cause] of refusals) {
    const path = join(paths.brain, file);
    await writeFile(path, plantedText[file], { mode: 0o755 });
    const refused = await g.brain(`status with a planted ${file}`, ["status"], { expect: { code: 1 } });
    ensure(refused.stdout === `Brain: broken: ${cause}. Run foliage brain rebuild\n`, `a planted ${file} was not refused by name: ${refused.stdout}`);
    await unlink(path);
  }
  const config = await readFile(paths.config, "utf8");
  await writeFile(paths.config, `${JSON.stringify({ ...JSON.parse(config), openai_api_key: world.key }, null, 2)}\n`);
  const keyed = await g.brain("status with a key planted in config.json", ["status"], { expect: { code: 1 } });
  ensure(keyed.stdout === "Brain: broken: config.json holds openai_api_key, which Foliage never writes. Run foliage brain rebuild\n", `a key planted in config.json was not refused by name: ${keyed.stdout}`);
  await writeFile(paths.config, config);

  // A provider URL planted in the database (hand-built: Foliage never sets this key) is named,
  // removed, and keeps the brain unused until rebuilt.
  await g.direct("plant provider_base_urls.ollama in the database", ["--brain", "host", "config", "set", "provider_base_urls.ollama", "http://example.test:11434/v1"]);
  for (const round of ["status with a planted provider URL", "status after the provider URL was removed"]) {
    const refused = await g.brain(round, ["status"], { expect: { code: 1 } });
    ensure(refused.stdout === "Brain: broken: the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt. Run foliage brain rebuild\n", `${round}: ${refused.stdout}`);
  }
  ensure((await g.brain("rebuild after the refusal", ["build"])).stdout === current, "the rebuild after a refusal is not current");

  // 6. An edit to the record (a SYNTHETIC new leaflet) needs work; the Foliage process is SIGKILLed
  // while a gbrain child runs, and the next build reclaims the lock.
  leaf.leaflets.push({ id: "pending-two", title: "Synthetic second pending leaflet", tier: "pending", provenance: OWN, body: [{ provenance: OWN, text: "Synthetic text added after the first build." }] });
  await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
  const leafBefore = await readFile(leafFile);
  // Its outcome is handled at once, so a build that ends before its child is recorded cannot leave
  // an unhandled rejection behind; it is awaited after the kill.
  const victim = g.running("build killed mid-run", ctx.programs.node, [join(ctx.root, "apps", "leaf", "brain.mjs"), "build", "--garden", garden], { expect: { signal: "SIGKILL" } })
    .settled.then(() => null, (/** @type {unknown} */ error) => error);
  /** @type {{ pid: number, child?: number } | null} */
  let held = null;
  for (let waited = 0; held?.child === undefined; waited += 50) {
    if (waited >= 120_000) {
      const early = await victim;
      throw early instanceof Error ? early : new Error("the build never recorded a gbrain child in its lock");
    }
    held = await readlink(paths.lock).then(text => /** @type {{ pid: number, child?: number }} */ (JSON.parse(text)), () => null);
    await sleep(50);
  }
  const holder = /** @type {{ pid: number, child: number }} */ (held);
  // The lock names the Foliage process itself (on macOS sandbox-exec runs node in place; on Linux
  // node runs under strace), so that is the process killed.
  process.kill(holder.pid, "SIGKILL");
  const killed = await victim;
  if (killed !== null) throw killed;
  // A zombie has finished: where nothing reaps orphans (a container whose first process is not an
  // init), it would otherwise look alive for ever.
  const alive = () => {
    try { process.kill(holder.child, 0); } catch { return false; }
    return !/^Z/.test(spawnSync(TOOLS.ps, ["-o", "stat=", "-p", String(holder.child)], { encoding: "utf8" }).stdout.trim());
  };
  for (let waited = 0; alive(); waited += 100) {
    ensure(waited < 180_000, "the orphaned gbrain child never finished");
    await sleep(100);
  }
  ensure(/** @type {{ pid: number }} */ (JSON.parse(await readlink(paths.lock))).pid === holder.pid, "the dead holder's lock is not on disk, so reclaiming was not exercised");
  ensure((await g.brain("build after the SIGKILL reclaims the lock", ["build"])).stdout === current, "the build after a SIGKILL is not current");
  ensure(!(await lstat(paths.lock).then(() => true, () => false)), "the reclaimed lock was not released");
  ensure((await g.brain("status at the end", ["status"])).stdout === current, "status at the end is not current");

  // 7. No drift: the config is still Foliage's, brain/work and brain/bin are empty, and brain work
  // wrote neither the record nor anything else in the garden.
  ensure(await readFile(paths.config, "utf8") === brainConfigText(paths), "CONFIG DRIFT: config.json is not Foliage's exact file at the end");
  await g.closed();
  ensure((await readFile(leafFile)).equals(leafBefore), "brain work wrote the record");
  ensure(JSON.stringify((await readdir(garden)).sort()) === JSON.stringify(["brain", "leaf.json"]), "brain work wrote into the garden outside brain/");
}

/* ---- the controls ------------------------------------------------------------------------------ */

/**
 * @typedef {object} Control
 * @property {string} step
 * @property {AttemptKind} kind  what the observer must report for it
 * @property {string} command
 * @property {readonly string[]} args
 * @property {readonly string[]} [owners]
 * @property {number} [loopback]  the one 127.0.0.1 port the control's profile allows
 */

/**
 * The controls: each rule must be seen to work, or a quiet run proves nothing. Every platform
 * shows its observer a name lookup and a program start; macOS also shows that a write under each
 * owner path is killed, with throwaway directories standing in for the owner's own, and, when item
 * 8's phase ran, that a profile allowing one loopback port still kills another port and a lookup.
 * @param {string} platform @param {string} node @param {string} dir
 * @param {{ allowed: number, other: number } | null} [loopback]
 * @returns {Control[]}
 */
export function controlsFor(platform, node, dir, loopback = null) {
  const lookup = { step: CONTROL, kind: /** @type {const} */ ("network"), command: node, args: ["-e", "require('node:dns').lookup('example.test', () => {}); setTimeout(() => {}, 3000);"] };
  const program = { step: "control: starting another program inside the sandbox", kind: /** @type {const} */ ("program"), command: TOOLS.true, args: [] };
  if (platform !== "darwin") return [lookup, program];
  // Build order item 8: with one loopback port allowed (the stand-in embedder's), a connection to
  // another loopback port, and a lookup, are still killed, so "nothing leaves loopback" rests on a
  // rule seen to work, not on a quiet run.
  const embedding = loopback === null ? [] : [
    { step: "control: another loopback port, with one allowed", kind: /** @type {const} */ ("network"), command: node, loopback: loopback.allowed,
      args: ["-e", `require('node:net').connect(${loopback.other}, '127.0.0.1').on('error', () => {}); setTimeout(() => {}, 3000);`] },
    { step: "control: a name lookup, with one loopback port allowed", kind: /** @type {const} */ ("network"), command: node, loopback: loopback.allowed,
      args: ["-e", "require('node:dns').lookup('example.test', () => {}); setTimeout(() => {}, 3000);"] },
  ];
  const standIns = [join(dir, "control-owner", ".gbrain"), join(dir, "control-owner", "brain")];
  const write = (/** @type {string} */ label, /** @type {string} */ target) => ({
    step: `control: a write under a stand-in for the owner's ${label}`, kind: /** @type {const} */ ("owner-write"), command: node,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(join(target, "control-write"))}, "x")`], owners: standIns,
  });
  return [lookup, write("~/.gbrain", standIns[0] ?? ""), write("~/brain", standIns[1] ?? ""), program, ...embedding];
}

/* ---- the gate --------------------------------------------------------------------------------- */

/**
 * One line per distinct attempt (pids and descriptor numbers aside), with its count, the first
 * `cap` of them; a planted fetch is tried by every gbrain process. Pure.
 * @param {readonly Attempt[]} attempts @param {number} [cap]
 */
export function reportLines(attempts, cap = 20) {
  /** @type {Map<string, { attempt: Attempt, times: number }>} */
  const distinct = new Map();
  for (const attempt of attempts) {
    const text = attempt.text.replace(/^pid \d+ /, "").replace(/^([\w.-]+)\(\d+\) /, "$1(…) ").replace(/\b(connect|sendto|sendmsg|sendmmsg)\(\d+,/, "$1(…,");
    const key = `${attempt.kind}\0${attempt.step}\0${text}`;
    const seen = distinct.get(key);
    if (seen) seen.times += 1;
    else distinct.set(key, { attempt: { ...attempt, text }, times: 1 });
  }
  const lines = [...distinct.values()].map(({ attempt, times }) => `${ATTEMPT_LABEL[attempt.kind]}: [${attempt.step}] ${attempt.text}${times > 1 ? ` (${times} times)` : ""}`);
  return lines.length > cap ? [...lines.slice(0, cap), `... and ${lines.length - cap} more distinct attempts`] : lines;
}

/**
 * What the green line says was proven: only the phases that ran. A phase asked for and not run
 * (item 8 on Linux: its stand-in embedder listens on the gate's loopback, out of a step's empty
 * network namespace) is named NOT RUN, never counted. A run of some phases says PARTIAL.
 * @param {readonly string[]} phases  asked for @param {readonly string[]} ran  ran to the end
 */
export function greenScope(phases, ran) {
  const skipped = phases.filter(item => !ran.includes(item));
  const notRun = skipped.length === 0 ? "" : ` (build order item ${skipped.join(", ")} NOT RUN on this platform)`;
  if (phases.length < PHASES.length) return `PARTIAL, only build order item(s) ${ran.join(", ") || "none"}${notRun} (pnpm check runs every phase)`;
  const core = ["2", "3", "5", "6"].every(item => ran.includes(item));
  return `${core ? "build order items 2 to 6" : `build order item(s) ${ran.filter(item => item !== "8").join(", ")}`}${ran.includes("8") ? " and 8" : ""}${notRun}`;
}

/**
 * Runs the gate and reports through `say`. Returns true only when every step ended as expected,
 * every control was seen, nothing outlived its step, and no other attempt was seen.
 * @param {{ root?: string, platform?: string, env?: NodeJS.ProcessEnv, probe?: Probe, say?: (line: string) => void, phases?: readonly string[] }} [options]
 */
export async function runOfflineGate({ root = ROOT, platform = process.platform, env = process.env, probe = systemProbe, say = line => process.stdout.write(`${line}\n`), phases = PHASES } = {}) {
  const red = (/** @type {string} */ cause) => { say(`check-brain-offline: RED: ${cause}`); return false; };
  const missing = missingTools(platform, probe);
  if (missing.length > 0) return red(missing.join("\n  "));
  const vendor = join(root, "vendor"), layout = vendorLayout(vendor);
  try {
    await readVendorManifest(vendor);
    await access(layout.bun, constants.X_OK);
  } catch (error) {
    return red(`no usable staged brain in vendor/ (${error instanceof Error ? error.message : String(error)}). Fix: ${STAGE_FIX}`);
  }
  // A developer who ran the negative control and did not restage is told so; the gate stays red.
  const planted = (await readFile(layout.cli, "utf8").catch(() => "")).includes(PLANT_MARK);
  const plantNote = () => { if (planted) say(`check-brain-offline: vendor/gbrain/src/cli.ts holds a planted negative-control probe (tools/brain/plant-egress-probe.mjs). Restore the pinned tree: ${STAGE_FIX}`); };
  /** @type {OpenRun | null} */
  let opened = null;
  /** @type {Harness | null} */
  let harness = null;
  /** @type {RunMarks | null} */
  let marks = null;
  try {
    opened = await openRun(platform, layout.bun, env["CI"] === "true" || env["FOLIAGE_BRAIN_GATE_SUDO"] === "1");
    ({ harness, marks } = opened);
    const { programs, dir } = opened;
    say(`check-brain-offline: ${harness.describe}`);
    /** @type {Done[]} */
    const done = [];
    /** @type {string[]} */
    const ran = [];
    let failure = null;
    try { await scenario(harness, programs, dir, root, platform, done, say, phases, ran); }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
    // The controls only after a run that got through: each rule is seen to work (on macOS each
    // control is also killed). With item 8's phase on macOS, two more controls allow one loopback port.
    const allowed = 4210 + Math.floor(Math.random() * 700);
    const loopback = platform === "darwin" && phases.includes("8") ? { allowed, other: allowed + 1 } : null;
    const ended = await endRun(platform, harness, marks, programs.node, dir, failure === null, loopback);
    marks = null;
    harness = null;
    for (const line of reportLines(ended.ours)) say(line);
    plantNote();
    if (failure !== null) return red(failure);
    const cause = verdict(platform, ended, say);
    if (cause !== null) return red(cause);
    if (planted) return red("the planted probe was not seen, so the observer is not working");
    say(`check-brain-offline: GREEN: ${greenScope(phases, ran)}, ${done.length} sandboxed Foliage and gbrain processes, each ended as its step expects; 0 deny lines or attempts and nothing outlived its step (${ended.controls.length} controls seen); config.json exactly Foliage's and every setting read back; the decoy home, the record and the owner's ~/.gbrain files unchanged`);
    return true;
  } catch (error) {
    plantNote();
    return red(error instanceof Error ? error.message : String(error));
  } finally {
    if (marks !== null) await outlived(platform, marks, { boundMs: 0 }).catch(() => []);
    harness?.abort();
    if (opened !== null) await rm(opened.dir, { recursive: true, force: true });
  }
}

/**
 * @typedef {object} OpenRun
 * @property {Programs} programs
 * @property {string} dir  the run's throwaway directory: everything a step makes belongs under it
 * @property {Harness} harness
 * @property {RunMarks} marks
 */

/**
 * A run's sandbox: the programs its steps may start (node, the shell, and `bun`), a throwaway
 * directory, the observer watching it, and what marks the run's processes for the survivor check.
 * @param {string} platform @param {string} bun @param {boolean} sudoAllowed
 * @returns {Promise<OpenRun>}
 */
async function openRun(platform, bun, sudoAllowed) {
  const programs = await programsFor(platform, process.execPath, bun);
  const bunPaths = [...new Set([bun, programs.bun])];
  const before = new Set(survivorsAmong(await processRows(platform), { self: process.pid, dir: "\0", groups: new Map(), bun: bunPaths, before: new Set() }).map(row => row.pid));
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-brain-gate-")));
  try {
    const harness = platform === "darwin" ? await macHarness(dir, programs) : await linuxHarness(dir, programs, sudoAllowed);
    return { programs, dir, harness, marks: { self: process.pid, dir, groups: harness.groups, bun: bunPaths, before } };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The end of a run: the controls (each rule seen to work; on macOS also killed), then, with the deny
 * log still open, the wait for anything of the run left running, then every attempt seen. `loopback`
 * (build order item 8, macOS): the allowed and another port for the loopback controls.
 * @param {string} platform @param {Harness} harness @param {RunMarks} marks @param {string} node @param {string} dir @param {boolean} withControls
 * @param {{ allowed: number, other: number } | null} [loopback]
 */
async function endRun(platform, harness, marks, node, dir, withControls, loopback = null) {
  const controls = withControls ? controlsFor(platform, node, dir, loopback) : [];
  /** @type {Map<string, Ran>} */
  const controlRuns = new Map();
  for (const control of controls) {
    for (const path of control.owners ?? []) await mkdir(path, { recursive: true });
    controlRuns.set(control.step, await finished(harness.start(control.step, control.command, control.args,
      { cwd: dir, env: { PATH: "/usr/bin:/bin", HOME: dir }, ...(control.owners ? { owners: control.owners } : {}), ...(control.loopback === undefined ? {} : { loopback: control.loopback }) })));
  }
  // Nothing may outlive its step; the deny log stays open while this waits.
  const survivors = await outlived(platform, marks);
  const attempts = [...await harness.finish(), ...survivors];
  return { controls, controlRuns, survivors, attempts, ours: attempts.filter(attempt => !controlRuns.has(attempt.step)) };
}

/**
 * Why an ended run is red, or null. Each control seen is said through `say`.
 * @param {string} platform @param {Awaited<ReturnType<typeof endRun>>} ended @param {(line: string) => void} say
 */
function verdict(platform, { controls, controlRuns, survivors, attempts, ours }, say) {
  if (survivors.length > 0) return `${survivors.length} sandboxed process(es) outlived their step; a late attempt from one would land after the deny log was read`;
  if (ours.length > 0) return `${ours.length} attempt(s) to reach out, write the owner's brain or start a program`;
  for (const control of controls) {
    const seen = attempts.find(attempt => attempt.step === control.step && attempt.kind === control.kind);
    if (seen === undefined) return `the observer missed ${control.step.replace(/^control: /, "the control's ")}, so a quiet run proves nothing`;
    const ran = controlRuns.get(control.step);
    if (platform === "darwin" && !(ran?.signal === "SIGKILL" || ran?.code === 137)) return `${control.step}: the sandbox did not kill it`;
    say(`  ok  ${control.step} was seen${platform === "darwin" ? " and killed" : ""}: ${seen.text}`);
  }
  return null;
}

/**
 * THE GATE'S SANDBOX AROUND OTHER STEPS, for a runtime the caller names: the same observer, program
 * rule, exit-status rule, controls and survivor check as the gate. `tools/deploy/package-local.test.mjs`
 * runs an INSTALLED copy's `foliage brain` this way (build order item 7). Everything a step makes
 * belongs under `dir`, so anything of the run left running is found by it. `close()` runs the
 * controls and returns every line seen and the red cause, or null; `abort()` ends a run that threw.
 * Linux runs without sudo here; that path is unmeasured, since no brain ships for Linux yet.
 * @param {{ bun: string, platform?: string, probe?: Probe }} options  `bun`: the bun the steps may start
 */
export async function offlineSession({ bun, platform = process.platform, probe = systemProbe }) {
  const missing = missingTools(platform, probe);
  if (missing.length > 0) throw new Error(missing.join("\n  "));
  const { programs, dir, harness, marks } = await openRun(platform, bun, false);
  /** @type {Done[]} */
  const done = [];
  /** @type {string[]} */
  const said = [];
  let open = true;
  const shut = async () => {
    if (!open) return;
    open = false;
    await outlived(platform, marks, { boundMs: 0 }).catch(() => []);
    harness.abort();
    await rm(dir, { recursive: true, force: true });
  };
  return {
    dir, describe: harness.describe, done,
    /**
     * @param {string} step @param {string} command @param {readonly string[]} args
     * @param {{ cwd?: string, env: Record<string, string>, expect?: Expect, allow?: Allow }} options
     */
    run: (step, command, args, { cwd = dir, env, expect = { code: 0 }, allow }) =>
      settleStep(harness, done, step, harness.start(step, command, args, { cwd, env, ...(allow === undefined ? {} : { allow }) }), expect, line => said.push(line)),
    async close() {
      try {
        const ended = await endRun(platform, harness, marks, programs.node, dir, true);
        const lines = [...said, ...reportLines(ended.ours)];
        const cause = verdict(platform, ended, line => lines.push(line));
        return { cause, lines };
      } finally { await shut(); }
    },
    abort: shut,
  };
}
