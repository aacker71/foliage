/**
 * The session reader's contract, checked against a transcript tree built in a temp dir.
 *
 * These fixtures are TEST SCAFFOLDING, not product data: each test writes its own throwaway
 * `.claude/projects` tree, asserts the reader's behaviour, and deletes it. Nothing here is shown
 * to a user or promoted into a leaf. The invariants under test are the ones the header promises:
 * an absent root is a named cause (not an empty scan), two subdirectories of one repo collapse to
 * one workspace, a cwd under no repo is kept and flagged rather than dropped, and a malformed line
 * is counted rather than fatal.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanSessions } from "./sessionSource.ts";

/** Write a transcript file of JSONL records under root/<project>/<name>.jsonl. */
function transcript(root: string, project: string, name: string, records: unknown[]): void {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/** A minimal Claude Code record: the four fields the reader actually reads. */
const rec = (cwd: string, gitBranch: string, timestamp: string, type = "user") => ({ cwd, gitBranch, timestamp, type });

test("an absent transcript root is a named cause, never an empty scan", () => {
  const missing = join(tmpdir(), "foliage-sessions-does-not-exist-" + process.pid);
  const scan = scanSessions(missing);
  assert.equal(scan.ok, false);
  assert.equal(scan.ok === false && scan.cause, "no-transcript-root");
  // The remedy is in the detail, so a stuck user is unstuck without reading code.
  assert.match(scan.ok === false ? scan.detail : "", /run Claude Code|--root/);
});

test("two subdirectories of one repo collapse to a single workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "foliage-sessions-"));
  try {
    // A real repo with a .git, and two sessions that ran in different subdirectories of it.
    const repo = mkdtempSync(join(tmpdir(), "foliage-repo-"));
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "docs"), { recursive: true });
    transcript(root, "proj-a", "s1.jsonl", [rec(join(repo, "src"), "main", "2026-08-20T10:00:00Z")]);
    transcript(root, "proj-b", "s2.jsonl", [rec(join(repo, "docs"), "main", "2026-08-21T10:00:00Z")]);

    const scan = scanSessions(root);
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const ws = scan.workspaces.filter((w) => w.path === repo);
    assert.equal(ws.length, 1, "the two subdirectory sessions did not collapse to one workspace");
    const [w0] = ws;
    assert.ok(w0);
    assert.equal(w0.isGitRepo, true);
    assert.equal(w0.sessionCount, 2);
    assert.equal(w0.lastAt, "2026-08-21T10:00:00Z");
    rmSync(repo, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cwd under no git repo is kept and flagged, not silently dropped", () => {
  const root = mkdtempSync(join(tmpdir(), "foliage-sessions-"));
  try {
    const loose = mkdtempSync(join(tmpdir(), "foliage-loose-")); // no .git anywhere above it in tmp
    transcript(root, "proj", "s.jsonl", [rec(loose, "HEAD", "2026-08-19T09:00:00Z")]);
    const scan = scanSessions(root);
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const ws = scan.workspaces.find((w) => w.path === loose);
    assert.ok(ws, "a non-repo workspace was dropped instead of reported");
    assert.equal(ws.isGitRepo, false);
    rmSync(loose, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed line is counted, not fatal, and does not sink its transcript", () => {
  const root = mkdtempSync(join(tmpdir(), "foliage-sessions-"));
  try {
    const dir = join(root, "proj");
    mkdirSync(dir, { recursive: true });
    // One good record, one corrupt line (a live-written half line), then another good record.
    const good1 = JSON.stringify(rec("/tmp/x", "main", "2026-08-18T08:00:00Z"));
    const good2 = JSON.stringify(rec("/tmp/x", "main", "2026-08-18T09:00:00Z"));
    writeFileSync(join(dir, "s.jsonl"), good1 + "\n{ this is not json\n" + good2 + "\n", "utf8");

    const scan = scanSessions(root);
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    assert.equal(scan.skippedLines, 1, "the corrupt line was not counted");
    const ws = scan.workspaces.find((w) => w.path === "/tmp/x");
    assert.ok(ws, "a transcript with one bad line was dropped whole");
    assert.equal(ws.userTurns, 2, "the good records around the bad line were lost");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no score, no sum: two workspaces are ordered by recency, never combined", () => {
  const root = mkdtempSync(join(tmpdir(), "foliage-sessions-"));
  try {
    transcript(root, "old", "s.jsonl", [rec("/tmp/old", "main", "2026-08-01T00:00:00Z")]);
    transcript(root, "new", "s.jsonl", [rec("/tmp/new", "main", "2026-08-20T00:00:00Z")]);
    const scan = scanSessions(root);
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const paths = scan.workspaces.map((w) => w.path);
    assert.ok(paths.indexOf("/tmp/new") < paths.indexOf("/tmp/old"), "not ordered most-recent-first");
    // Every workspace stands alone — there is no total field anywhere in the result.
    assert.equal("total" in scan, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
