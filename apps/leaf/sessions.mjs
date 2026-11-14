#!/usr/bin/env node
/**
 * foliage sessions — the on-ramp. It reads the work you already did in Claude Code and tells you
 * which repos to grow a leaf from, so you do not have to remember 1,700 sessions across two years.
 *
 *   node apps/leaf/sessions.mjs [--root <dir>] [--json] [--repos-only]
 *
 * WHY THIS EXISTS, AND WHAT IT REFUSES TO BE. Paxl reads this same local data and uploads a
 * scorecard. This prints a WORKLIST and uploads nothing. Each row is a repo your Claude Code work
 * touched; the next step is the existing pipeline — `intake.mjs --repo <that path>` — where your
 * git commits become the evidence. The session is the map; git is the proof. This command makes no
 * leaflet, no claim, and no score: the columns are counts and dates, and two rows are never summed.
 *
 * Presentation follows CLAUDE.md's UI contract for a terminal: a label, not a sentence; aligned
 * columns; colour never carries a fact alone; colour off when piped or NO_COLOR is set.
 */
import { requireNodeFloor } from "./src/nodeFloor.mjs";

requireNodeFloor();

const { scanSessions } = await import("./src/sessionSource.ts");

const argv = process.argv.slice(2);
/** @param {string} n */
const flag = (n) => argv.includes(n);
/** @param {string} n */
const value = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const TTY = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
/** @param {string} code @returns {(s: string) => string} */
const paint = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = paint("2");
const bold = paint("1");
const green = paint("38;5;149");
const warm = paint("38;5;137");

const scan = scanSessions(value("--root"));

if (flag("--json")) {
  process.stdout.write(JSON.stringify(scan, null, 2) + "\n");
  process.exit(scan.ok ? 0 : 4);
}

if (!scan.ok) {
  // An absent root is a named cause with its remedy, not an empty table. Exit 4 = nothing to read.
  process.stderr.write(`sessions: ${scan.detail}\n`);
  process.exit(4);
}

const repos = scan.workspaces.filter((w) => w.isGitRepo);

// --repos-only: just the paths a caller (or a skill) can pipe straight into intake. No chrome.
if (flag("--repos-only")) {
  for (const w of repos) process.stdout.write(w.path + "\n");
  process.exit(0);
}

/** @param {string} iso */
const days = (iso) => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const d = Math.floor((Date.now() - then) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
};

process.stdout.write(`\n${green("❧")} ${bold("FOLIAGE · sessions")} ${dim("· the repos your Claude Code work touched")}\n\n`);

if (scan.workspaces.length === 0) {
  // The honest populated-but-empty state: Claude Code has run, but no session recorded a workspace.
  process.stdout.write(
    `  ${warm("No workspaces found")} in ${scan.transcripts} transcript(s). ` +
      `Claude Code has run here, but no session recorded a working directory to grow a leaf from.\n\n`,
  );
  process.exit(0);
}

// Count column widths from the data so the table aligns to real content, never a guessed constant.
const shown = repos.length > 0 ? repos : scan.workspaces;
const wPath = Math.min(60, Math.max(...shown.map((w) => w.path.length), 4));
const head = `  ${dim("REPO".padEnd(wPath))}  ${dim("SESSIONS")}  ${dim("TURNS")}  ${dim("LAST")}`;
process.stdout.write(head + "\n");

for (const w of shown) {
  const path = w.path.length > wPath ? "…" + w.path.slice(w.path.length - wPath + 1) : w.path.padEnd(wPath);
  const sessions = String(w.sessionCount).padStart(8);
  const turns = String(w.userTurns).padStart(5);
  process.stdout.write(`  ${green(path)}  ${sessions}  ${turns}  ${dim(days(w.lastAt).padStart(4))}\n`);
}

const nonRepos = scan.workspaces.length - repos.length;
process.stdout.write(
  `\n  ${dim(
    `${repos.length} git repo(s) across ${scan.transcripts} session file(s)` +
      (nonRepos > 0 ? `; ${nonRepos} workspace(s) under no repo, not shown` : "") +
      (scan.skippedLines > 0 ? `; ${scan.skippedLines} unreadable line(s) skipped` : ""),
  )}\n`,
);
process.stdout.write(
  `  ${dim("Next:")} grow a leaf from any row — ${bold("node apps/leaf/intake.mjs --repo <path> --subject <you> --identity <email>")}\n\n`,
);
