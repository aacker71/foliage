import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync, symlinkSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewSubjectDigest } from "@foliage/photosynthesis";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = resolve(repo, "apps/leaf/cells.mjs");
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("real Git commit -> private cell -> candidate; repeat, failure and overwrite safety", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-cells-test-"));
  try {
    const store = join(dir, "cells.json");
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    const commit = git("rev-parse", "HEAD");
    const identity = git("show", "-s", "--format=%ae", commit);
    assert.match(run("--help"), /No automatic grouping/);
    run("init", "--store", store, "--subject", "Repository protocol test", "--leaf-id", "protocol");
    assert.equal(statSync(store).mode & 0o777, 0o600);
    assert.throws(() => run("init", "--store", store, "--subject", "Replacement", "--leaf-id", "replacement"));
    const ingest = ["git", "--store", store, "--repo", repo, "--identity", identity, "--commit", commit];
    assert.throws(() => run(...ingest));
    const scope = realpathSync(resolve(repo, git("rev-parse", "--git-common-dir")));
    const permission = ["--store", store, "--source", "git", "--scope", scope, "--reason", "Protocol test permission"];
    run("allow", ...permission);
    run(...ingest);
    const before = readFileSync(store, "utf8");
    assert.match(run(...ingest), /Already captured/);
    assert.equal(readFileSync(store, "utf8"), before);
    const cells = JSON.parse(before).cells;
    assert.equal(cells[0].text, git("show", "-s", "--format=%s", commit));
    assert.equal(cells[0].object, commit);
    const out = join(dir, "candidate.json");
    const draft = ["draft", "--store", store, "--cells", cells[0].id, "--title", "Repository evidence review", "--out", out];
    run(...draft);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).candidates[0].review.state, "candidate");
    assert.throws(() => run(...draft));
    run("check", "--store", store, "--candidate", out);
    const candidate = JSON.parse(readFileSync(out, "utf8"));
    const reviewed = candidate.candidates[0];
    // Test-only review protocol, never an assertion that this work was actually reviewed.
    reviewed.review = { state: "approved", by: "Protocol reviewer", at: new Date().toISOString(), subjectDigest: reviewSubjectDigest(reviewed) };
    const approved = join(dir, "approved.json");
    const leaf = join(dir, "leaf.json");
    const promoted = join(dir, "promoted.json");
    writeFileSync(approved, JSON.stringify(candidate), { mode: 0o600 });
    writeFileSync(leaf, JSON.stringify({ id: "protocol", subject: "Repository protocol test", leaflets: [] }), { mode: 0o600 });
    const promote = ["promote", "--store", store, "--candidate", approved, "--into", leaf, "--out", promoted];
    run(...promote);
    assert.equal(JSON.parse(readFileSync(promoted, "utf8")).leaflets[0].tier, "pending");
    assert.equal(JSON.parse(readFileSync(leaf, "utf8")).leaflets.length, 0, "source leaf was not overwritten");
    assert.throws(() => execFileSync(process.execPath, [resolve(repo, "apps/leaf/harvest.mjs"), "promote", "--doc", approved, "--into", leaf], { stdio: "pipe" }), /current private store/);
    run("deny", ...permission);
    assert.throws(() => run("check", "--store", store, "--candidate", out));
    assert.throws(() => run(...ingest));
    assert.throws(() => run(...promote.slice(0, -1), join(dir, "denied.json")));
    run("allow", ...permission);
    assert.throws(() => run(...promote.slice(0, -1), join(dir, "stale.json")));
    assert.throws(() => run("git", "--store", store, "--repo", repo, "--identity", "not-the-author", "--commit", commit));
    assert.deepEqual(JSON.parse(readFileSync(store, "utf8")).cells, JSON.parse(before).cells);
    assert.throws(() => run("git", "--store", store, "--repo", dir, "--identity", identity, "--commit", commit));
    assert.throws(() => run("git", "--store", store, "--repo", repo, "--identity", identity, "--commit", "HEAD"));
    const alias = join(dir, "alias.json");
    symlinkSync(store, alias);
    assert.throws(() => run("list", "--store", alias));
    chmodSync(dir, 0o755);
    assert.throws(() => run("list", "--store", store));
    chmodSync(dir, 0o700);
    // Protocol-only snapshot: exercises the adapter, not a real work claim.
    const snapshot = join(dir, "task.json");
    writeFileSync(snapshot, JSON.stringify({ gid: "123", name: "Protocol task", modified_at: "2026-09-05T10:00:00Z", completed: true, assignee: { gid: "456" }, projects: [{ gid: "789" }] }), { mode: 0o600 });
    const asana = ["asana", "--store", store, "--snapshot", snapshot, "--project", "789"];
    assert.throws(() => run(...asana));
    run("allow", "--store", store, "--source", "asana-import", "--scope", "789", "--reason", "Protocol test permission");
    run(...asana);
    const mixed = readFileSync(store, "utf8");
    assert.equal(JSON.parse(mixed).cells[1].actor, null);
    assert.match(run(...asana), /Already captured/);
    assert.equal(readFileSync(store, "utf8"), mixed);
    assert.throws(() => run(...asana.slice(0, -1), "111"));
    assert.equal(readFileSync(store, "utf8"), mixed);
    run("retract", "--store", store, "--cell", cells[0].id, "--reason", "Protocol test removal");
    assert.throws(() => run(...ingest));
    assert.throws(() => run("check", "--store", store, "--candidate", out));
    assert.equal(JSON.parse(readFileSync(store, "utf8")).cells.some((c: { id: string }) => c.id === cells[0].id), false);
    writeFileSync(store, "null");
    assert.throws(() => run(...ingest));
    assert.equal(readFileSync(store, "utf8"), "null");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy CLI migration is explicit, non-overwriting and grants no access", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-cells-migration-"));
  try {
    const old = join(dir, "old.json"); const next = join(dir, "next.json");
    const bytes = JSON.stringify({ version: 1, subject: "Protocol migration", leafId: "protocol", cells: [] });
    writeFileSync(old, bytes, { mode: 0o600 });
    assert.throws(() => run("list", "--store", old));
    run("migrate", "--store", old, "--out", next);
    assert.equal(readFileSync(old, "utf8"), bytes);
    const migrated = JSON.parse(run("list", "--store", next));
    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.permissions, []);
    assert.deepEqual(migrated.retractions, []);
    assert.throws(() => run("migrate", "--store", old, "--out", next));
    assert.throws(() => run("migrate", "--store", old, "--out", old));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
