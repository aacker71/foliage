/**
 * Reading the work you already did in Claude Code, to find the repos it lives in — nothing more.
 *
 * THE PAXL SHAPE, DONE HONESTLY. Paxl (YC) reads a machine's local coding-agent transcripts,
 * scores the developer against five axes, and uploads a JSON payload to YC. This file reads the
 * SAME local data — `~/.claude/projects (its *.jsonl transcripts)` — and does the opposite of both halves: it
 * computes NO score (this repository refuses one everywhere), and it uploads NOTHING (the whole
 * scan stays on the machine, returned as data to the caller). It does not even produce a leaflet.
 *
 * WHAT IT PRODUCES IS A MAP, NOT EVIDENCE. A transcript records that you worked, where, and when;
 * it is NOT proof of what you built, and it holds a great deal that is not yours to publish —
 * other people's names, secrets, your unfinished thinking. So this source extracts exactly three
 * facts per session and no prose: the working directory, the git branch, and the timestamps. From
 * those it reports the REPOS where your Claude Code work landed, ranked by how much and how
 * recently. The evidence remains git: you hand a repo from this list to `intake.mjs`, and your
 * commits — signed or not, attributed by identity — become the leaflets. The session says WHERE
 * you worked; git says WHAT you did. Keeping those separate is the point.
 *
 * This mirrors `brainSource.ts` and `photoSource.ts`: it is the I/O half only. Whether a session
 * ever becomes portfolio material at all is an owner decision this file does not make and cannot
 * force — it publishes nothing and drafts nothing.
 *
 * THE RULES THIS FILE ENFORCES:
 *
 *   AN ABSENT TRANSCRIPT ROOT IS A NAMED CAUSE, NEVER AN EMPTY SCAN. "Claude Code has never run
 *   on this machine" and "it ran but touched no git repo" are opposite facts that would otherwise
 *   both print zero — the `count: 0` collapse this repository exists to refuse. The root is
 *   stat'd before anything is read, and its absence comes back as a cause with a one-line remedy.
 *
 *   A cwd IS RESOLVED TO ITS GIT ROOT, OR MARKED non-repo — NOT GUESSED. A session's `cwd` is
 *   often a subdirectory of a repo (measured on this machine: Open Design sessions run in
 *   `.../assets/marks`, `.../ui_kits/app`). We walk up looking for a `.git`, so two sessions in
 *   two subdirectories of one repo collapse to one workspace, and a cwd under no repo is reported
 *   as `isGitRepo: false` rather than silently dropped — "not a repo" is a fact intake needs.
 *
 *   A MALFORMED LINE IS SKIPPED AND COUNTED, NEVER FATAL. Transcripts are append-only JSONL
 *   written live; a half-written last line is normal. Each is parsed in isolation; the tally of
 *   skipped lines travels in the result so a caller can tell "no work" from "could not read it".
 *
 *   NO NETWORK, NO SUBPROCESS, NO WRITE. Reading local files, returning a value. There is no
 *   import of another plane and nothing here reaches off the machine, so the licensing boundary
 *   has nothing to catch and this claim is checkable rather than promised.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The default location Claude Code writes session transcripts, per-machine. */
const DEFAULT_TRANSCRIPT_ROOT = join(homedir(), ".claude", "projects");

/** The three facts a transcript yields. Deliberately not its prose. */
interface SessionFacts {
  readonly cwd: string;
  readonly gitBranch: string | null;
  readonly firstAt: string; // ISO, earliest timestamp seen in the file
  readonly lastAt: string; // ISO, latest
  readonly userTurns: number; // `type: "user"` records — a proxy for how much you drove
}

/** One repo (or non-repo directory) the sessions touched, after cwds are collapsed to git roots. */
interface Workspace {
  /** The git root if the cwd sits under one, else the cwd itself. */
  readonly path: string;
  readonly isGitRepo: boolean;
  /** Branches seen across the sessions in this workspace (a session records one). */
  readonly branches: readonly string[];
  readonly sessionCount: number;
  readonly userTurns: number;
  readonly firstAt: string;
  readonly lastAt: string;
}

export type SessionScan =
  | {
      readonly ok: true;
      readonly root: string;
      readonly transcripts: number;
      readonly skippedLines: number;
      /** Ranked most-recent-and-active first. Git repos and non-repos both appear; the flag says which. */
      readonly workspaces: readonly Workspace[];
    }
  | {
      readonly ok: false;
      readonly root: string;
      readonly cause: "no-transcript-root" | "root-not-a-directory";
      readonly detail: string;
    };

/** Walk up from a directory until a `.git` is found; return the root, or null if none. Bounded. */
function gitRootOf(dir: string): string | null {
  let cur = dir;
  // A path has at most `depth` ancestors; the loop terminates when dirname stops changing at "/".
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/** Every `*.jsonl` under root, one level of project directories deep (Claude Code's layout). */
function transcriptFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(root, entry.name);
    // Inference picks the Dirent overload here; an explicit annotation would widen it across
    // readdirSync's overloads and mistype the name as a Buffer.
    let inner;
    try {
      inner = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue; // a directory we cannot read is not a work record we can honor; skip it, don't crash.
    }
    for (const f of inner) {
      if (f.isFile() && f.name.endsWith(".jsonl")) out.push(join(projectDir, f.name));
    }
  }
  return out;
}

/** Read one transcript into the three facts, or null if it carried no usable cwd. */
function factsOf(file: string, onSkip: () => void): SessionFacts | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let userTurns = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      onSkip();
      continue;
    }
    // cwd/gitBranch appear on every record; the first non-empty wins, and they do not change
    // within a session — a session is one working directory.
    if (cwd === null && typeof o["cwd"] === "string" && o["cwd"] !== "") cwd = o["cwd"];
    if (gitBranch === null && typeof o["gitBranch"] === "string" && o["gitBranch"] !== "") {
      gitBranch = o["gitBranch"] as string;
    }
    const ts = o["timestamp"];
    if (typeof ts === "string" && ts !== "") {
      if (firstAt === null || ts < firstAt) firstAt = ts;
      if (lastAt === null || ts > lastAt) lastAt = ts;
    }
    if (o["type"] === "user") userTurns += 1;
  }
  if (cwd === null || firstAt === null || lastAt === null) return null;
  return { cwd, gitBranch, firstAt, lastAt, userTurns };
}

/**
 * Scan the local Claude Code transcripts into a ranked list of the repos they touched.
 * Pure I/O and arithmetic — no network, no subprocess, no write.
 */
export function scanSessions(root: string = DEFAULT_TRANSCRIPT_ROOT): SessionScan {
  if (!existsSync(root)) {
    return {
      ok: false,
      root,
      cause: "no-transcript-root",
      detail: `no Claude Code transcripts at ${root} — run Claude Code at least once, or pass a different --root.`,
    };
  }
  if (!statSync(root).isDirectory()) {
    return { ok: false, root, cause: "root-not-a-directory", detail: `${root} exists but is not a directory.` };
  }

  const files = transcriptFiles(root);
  let skippedLines = 0;
  const byWorkspace = new Map<
    string,
    { isGitRepo: boolean; branches: Set<string>; sessionCount: number; userTurns: number; firstAt: string; lastAt: string }
  >();

  for (const file of files) {
    const facts = factsOf(file, () => (skippedLines += 1));
    if (facts === null) continue;
    const gitRoot = gitRootOf(facts.cwd);
    const key = gitRoot ?? facts.cwd;
    const existing = byWorkspace.get(key);
    if (existing === undefined) {
      byWorkspace.set(key, {
        isGitRepo: gitRoot !== null,
        branches: new Set(facts.gitBranch ? [facts.gitBranch] : []),
        sessionCount: 1,
        userTurns: facts.userTurns,
        firstAt: facts.firstAt,
        lastAt: facts.lastAt,
      });
    } else {
      if (facts.gitBranch) existing.branches.add(facts.gitBranch);
      existing.sessionCount += 1;
      existing.userTurns += facts.userTurns;
      if (facts.firstAt < existing.firstAt) existing.firstAt = facts.firstAt;
      if (facts.lastAt > existing.lastAt) existing.lastAt = facts.lastAt;
    }
  }

  const workspaces: Workspace[] = [...byWorkspace.entries()]
    .map(([path, w]) => ({
      path,
      isGitRepo: w.isGitRepo,
      branches: [...w.branches].sort(),
      sessionCount: w.sessionCount,
      userTurns: w.userTurns,
      firstAt: w.firstAt,
      lastAt: w.lastAt,
    }))
    // Most-recently-touched first; ties broken by how much you drove. This is an ORDER for a
    // worklist, not a rank of worth — nothing here is scored, and two workspaces are never summed.
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : b.userTurns - a.userTurns));

  return { ok: true, root, transcripts: files.length, skippedLines, workspaces };
}
