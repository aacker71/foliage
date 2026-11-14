/** Actual workflow lifecycle and real Git evidence; no model call is started. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openWorkflow } from "./workflow.ts";
import { portfolioFreshness } from "./portfolioFreshness.ts";

const exec = promisify(execFile);
test("an open workflow is scheduled only after an enabled source and unpaused schedule exist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-freshness-state-"));
  const workflow = await openWorkflow(directory);
  let closed = false;
  try {
    const render = () => portfolioFreshness(workflow.snapshot(), null, "", 0).html;
    assert.equal(workflow.snapshot().active, true);
    assert.equal(workflow.snapshot().schedule, null);
    assert.match(render(), /Collection not scheduled/);
    assert.doesNotMatch(render(), /Automatic collection scheduled/);
    const schedule = { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "18:00", end: "08:00", paused: false };
    await workflow.command({ action: "schedule", schedule });
    assert.ok(workflow.snapshot().nextAt);
    assert.match(render(), /Collection not scheduled/, "a schedule with no source cannot actually collect");
    const repo = fileURLToPath(new URL("../../..", import.meta.url));
    const { stdout } = await exec("git", ["-C", repo, "log", "-1", "--format=%ae"]);
    await workflow.command({ action: "source", path: repo, email: stdout.trim(), authorized: true });
    assert.match(render(), /Automatic collection scheduled/);
    await workflow.command({ action: "schedule", schedule: { ...schedule, paused: true } });
    assert.match(render(), /Collection paused/);
    assert.doesNotMatch(render(), /Automatic collection scheduled/);
    await workflow.close(); closed = true;
    assert.match(render(), /Collection offline/);
    assert.doesNotMatch(render(), /Automatic collection scheduled/);
  } finally {
    if (!closed) await workflow.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the review total is the one queue's count, and it links to /review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-freshness-queue-"));
  const workflow = await openWorkflow(directory);
  try {
    const state = workflow.snapshot();
    const html = portfolioFreshness(state, null, "", 30).html;
    assert.ok(html.includes('<span class="fol-metric">30</span> to review'), "the whole queue, not a preview");
    assert.match(html, /<a href="\/review">Open review<\/a>/);
    assert.doesNotMatch(html, /workflow#review/, "the workflow keeps no review list to link to");
    assert.notEqual(portfolioFreshness(state, null, "", 29).revision, portfolioFreshness(state, null, "", 30).revision, "a decision refreshes the count");
    assert.match(portfolioFreshness(state, null, "", null).html, /Review unavailable/, "an unread queue is not an empty one");
  } finally {
    await workflow.close();
    await rm(directory, { recursive: true, force: true });
  }
});
