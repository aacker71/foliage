/** Real Git history exercises draft boundaries and decisions across collection cycles. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DRAFT_MAX_REFS, parseHarvestDocument, reviewSubjectDigest, type HarvestDocument } from "@foliage/photosynthesis";
import { openWorkflow } from "./workflow.ts";

const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

/**
 * Every commit is a synthetic record made for this test in a temp repository. The cycle: a
 * backlog larger than one draft, a rejection, more work, a side branch and its merge.
 */
test("drafts stay within one check's size, a rejection stands across cycles, and merge commits are not evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-draft-boundaries-"));
  const repo = join(dir, "repo");
  const harvestPath = join(dir, "harvest.json");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "workflow@foliage.invalid");
  git("config", "user.name", "Workflow boundary test");
  let cursor = 0;
  const commit = async () => {
    const file = `record-${++cursor}.txt`;
    await writeFile(join(repo, file), `synthetic record ${cursor}\n`);
    git("add", file);
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `feat: synthetic record ${cursor}`], {
      env: { ...process.env, GIT_AUTHOR_DATE: `2026-01-01T00:${String(cursor).padStart(2, "0")}:00Z` },
    });
    return git("rev-parse", "HEAD");
  };
  const queue = async (): Promise<HarvestDocument> => {
    const parsed = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
    assert.ok(parsed.ok);
    return parsed.harvest;
  };
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  const collect = () => app.tick(new Date(), true);
  try {
    const backlog: string[] = [];
    for (let i = 0; i < 40; i++) backlog.push(await commit());
    await app.command({ action: "source", path: repo, email: "workflow@foliage.invalid", authorized: true });
    await app.command({ action: "schedule", schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "18:00", end: "08:00", paused: false } });
    await collect();
    let h = await queue();
    assert.deepEqual(h.candidates.map((c) => String(c.id)), ["git-cluster:feat", "git-cluster:feat:2"]);
    assert.ok(h.candidates.every((c) => c.evidence.length <= DRAFT_MAX_REFS));
    assert.deepEqual(new Set(h.candidates.flatMap((c) => c.evidence.map((e) => e.ref))), new Set(backlog));

    const first = h.candidates[0]!;
    execFileSync(process.execPath, [HARVEST_CLI, "reject", String(first.id), "--by", "Boundary Test", "--reason", "synthetic reason", "--doc", harvestPath, "--expect-subject-digest", reviewSubjectDigest(first)], { stdio: "pipe" });
    const rejected = (await queue()).candidates[0]!;

    git("checkout", "-q", "-b", "unmerged-work");
    const side = await commit();
    git("checkout", "-q", "main");
    const main = await commit();
    git("merge", "-q", "--no-ff", "unmerged-work", "-m", "Merge collected source changes");
    const merge = git("rev-parse", "HEAD");
    await collect();
    h = await queue();
    assert.deepEqual(h.candidates.find((c) => c.id === rejected.id), rejected, "the rejection stands");
    const refs = h.candidates.flatMap((c) => c.evidence.map((e) => e.ref));
    assert.ok(refs.includes(side) && refs.includes(main));
    assert.ok(!refs.includes(merge), "a merge commit is not evidence");
    assert.equal(new Set(refs).size, refs.length);
    const bytes = await readFile(harvestPath, "utf8");
    await collect();
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "a second read of the same history changes nothing");
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
