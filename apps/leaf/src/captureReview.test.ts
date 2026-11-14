import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { parseHarvestDocument, reviewSubjectDigest } from "@foliage/photosynthesis";

import { queueCapturedScreenshot } from "./captureReview.ts";
import { mediaRootFor, readMedia } from "./mediaStore.ts";

// A checked-in real PNG exercises the image reader and metadata-safe store. It is brand artwork,
// not a captured user's work, and no assertion here treats the fixture as product evidence.
const pngFixture = fileURLToPath(new URL("../public/living-work.png", import.meta.url));
const exportCli = fileURLToPath(new URL("../export.mjs", import.meta.url));
const harvestCli = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const shareCli = fileURLToPath(new URL("../share.mjs", import.meta.url));
const instant = "2026-10-07T12:00:00Z";
const roots: string[] = [];
after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "foliage-capture-review-test-"));
  roots.push(root);
  const leafPath = join(root, "leaf.json");
  const harvestPath = join(root, "harvest.json");
  const screenshotPath = join(root, "selected.png");
  await writeFile(leafPath, JSON.stringify({ id: "capture-test", subject: "Capture Test", leaflets: [] }));
  await copyFile(pngFixture, screenshotPath);
  return { root, leafPath, harvestPath, screenshotPath };
}

function reviewedFixture(id: string, state: "approved" | "rejected") {
  const base = {
    id,
    title: `Existing ${state} test record`,
    evidence: [{ source: "git", ref: "a".repeat(40), observedAt: instant }],
    extractor: "git-cluster",
    draftedAt: instant,
  };
  const subjectDigest = reviewSubjectDigest(base);
  return {
    ...base,
    review: state === "approved"
      ? { state, by: "Fixture Reviewer", at: instant, subjectDigest }
      : { state, by: "Fixture Reviewer", at: instant, reason: "A test rejection", subjectDigest },
  };
}

test("one selected PNG joins the bound review queue without changing earlier decisions or adjacent files", async () => {
  const fixture = await setup();
  const previous = {
    subject: "Capture Test", leafId: "capture-test", repo: "/local/test-repo",
    candidates: [reviewedFixture("git:approved-fixture", "approved"), reviewedFixture("git:rejected-fixture", "rejected")],
  };
  assert.equal(parseHarvestDocument(previous).ok, true, "review fixtures must be valid harvest material");
  await writeFile(fixture.harvestPath, JSON.stringify(previous));
  await copyFile(pngFixture, join(fixture.root, "adjacent.png"));

  const result = await queueCapturedScreenshot({
    screenshotPath: fixture.screenshotPath,
    leafPath: fixture.leafPath,
    harvestPath: fixture.harvestPath,
    observedAt: instant,
    title: "Captured UI fixture",
  });
  assert.equal(result.queued, true);
  const sourceBytes = await readFile(fixture.screenshotPath);
  const digest = createHash("sha256").update(sourceBytes).digest("hex");
  assert.equal(result.candidateId, `photo:sha256:${digest}`);
  assert.equal(result.mediaRef, `sha256:${digest}`);

  const parsed = parseHarvestDocument(JSON.parse(await readFile(fixture.harvestPath, "utf8")));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.subject, previous.subject);
  assert.equal(parsed.harvest.leafId, previous.leafId);
  assert.equal(parsed.harvest.repo, previous.repo);
  assert.equal(parsed.harvest.candidates.length, 3, "adjacent PNG was never scanned");
  assert.deepEqual(parsed.harvest.candidates.slice(0, 2).map(item => item.review), previous.candidates.map(item => item.review));
  const captured = parsed.harvest.candidates[2]!;
  assert.equal(captured.title, "Captured UI fixture");
  assert.equal(captured.review.state, "candidate");
  assert.equal(captured.media?.[0]?.ref, result.mediaRef);
  assert.equal(captured.evidence[0]?.ref, result.mediaRef);
  const stored = await readMedia(mediaRootFor(fixture.leafPath), result.mediaRef);
  assert.equal(stored.ok, true, "the exact review media ref resolves to retained clean bytes");

  const beforeRepeat = await readFile(fixture.harvestPath, "utf8");
  const repeated = await queueCapturedScreenshot({
    screenshotPath: fixture.screenshotPath,
    leafPath: fixture.leafPath,
    harvestPath: fixture.harvestPath,
    observedAt: "2026-10-07T12:01:00Z",
    title: "Captured UI fixture",
  });
  assert.deepEqual(repeated, { ...result, queued: false });
  assert.equal(await readFile(fixture.harvestPath, "utf8"), beforeRepeat);
});

test("same screenshot bytes with changed review material refuse instead of reopening a decision", async () => {
  const fixture = await setup();
  const args = { screenshotPath: fixture.screenshotPath, leafPath: fixture.leafPath,
    harvestPath: fixture.harvestPath, observedAt: instant, title: "First observed label" };
  await queueCapturedScreenshot(args);
  const before = await readFile(fixture.harvestPath, "utf8");
  await assert.rejects(queueCapturedScreenshot({ ...args, title: "A different label" }), /different review title or media/);
  assert.equal(await readFile(fixture.harvestPath, "utf8"), before);
});

test("invalid or unbound existing queues and failed media storage do not create a draft", async () => {
  const fixture = await setup();
  const args = { screenshotPath: fixture.screenshotPath, leafPath: fixture.leafPath,
    harvestPath: fixture.harvestPath, observedAt: instant };
  await writeFile(fixture.harvestPath, "{broken json");
  await assert.rejects(queueCapturedScreenshot(args), /not valid JSON/);
  assert.equal(await readFile(fixture.harvestPath, "utf8"), "{broken json");

  await writeFile(fixture.harvestPath, JSON.stringify({ candidates: [reviewedFixture("git:old", "approved")] }));
  await assert.rejects(queueCapturedScreenshot(args), /unbound work/);
  const unbound = await readFile(fixture.harvestPath, "utf8");
  assert.equal(JSON.parse(unbound).candidates.length, 1);

  await rm(fixture.harvestPath);
  const badStore = join(fixture.root, "not-a-store");
  await writeFile(badStore, "regular file");
  await assert.rejects(queueCapturedScreenshot({ ...args, mediaRoot: badStore }), /could not be stored/);
  await assert.rejects(readFile(fixture.harvestPath, "utf8"), /ENOENT/);
});

test("a captured still remains private through approval and promotion, then exports only after owner sharing", async () => {
  const fixture = await setup();
  const captured = await queueCapturedScreenshot({
    screenshotPath: fixture.screenshotPath,
    leafPath: fixture.leafPath,
    harvestPath: fixture.harvestPath,
    observedAt: instant,
    title: "Captured UI fixture",
  });
  const env: NodeJS.ProcessEnv = { ...process.env, FOLIAGE_LEAF: fixture.leafPath, FOLIAGE_MEDIA: mediaRootFor(fixture.leafPath) };
  delete env["FOLIAGE_POLICY"];
  const command = (script: string, args: readonly string[]) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env,
  });
  const exportTo = async (name: string) => {
    const out = join(fixture.root, name);
    const result = command(exportCli, ["--out", out]);
    assert.equal(result.status, 0, result.stderr);
    return { out, index: await readFile(join(out, "index.html"), "utf8") };
  };

  // Review is a human decision about the captured observation, never publication.
  const approved = command(harvestCli, ["approve", captured.candidateId, "--by", "Fixture Reviewer", "--doc", fixture.harvestPath]);
  assert.equal(approved.status, 0, approved.stderr);
  const promoted = command(harvestCli, ["promote", "--doc", fixture.harvestPath, "--into", fixture.leafPath, "--force"]);
  assert.equal(promoted.status, 0, promoted.stderr);
  const privateLeaf = JSON.parse(await readFile(fixture.leafPath, "utf8")) as { leaflets: { id: string; visibility?: string }[] };
  assert.equal(privateLeaf.leaflets.find(item => item.id === captured.candidateId)?.visibility, undefined);
  const beforeShare = await exportTo("before-share");
  assert.doesNotMatch(beforeShare.index, /Captured UI fixture/);
  await assert.rejects(readdir(join(beforeShare.out, "media")), /ENOENT/, "private exports should contain no captured media");

  // The separate owner action changes only this one leaflet's visibility. The public export
  // then copies the already reviewed, digest-checked PNG through the established media store.
  const shared = command(shareCli, ["share", captured.candidateId, "--as", "public", "--leaf", fixture.leafPath]);
  assert.equal(shared.status, 0, shared.stderr);
  const afterShare = await exportTo("after-share");
  assert.match(afterShare.index, /Captured UI fixture/);
  const detailName = `${createHash("sha256").update(captured.candidateId).digest("hex")}.html`;
  const detail = await readFile(join(afterShare.out, "leaflet", detailName), "utf8");
  const href = detail.match(/src="(\.\.\/media\/[0-9a-f]{64}\.png)"/)?.[1];
  assert.ok(href, "published leaflet should display the reviewed screenshot");
  const exported = await readFile(join(afterShare.out, "leaflet", href));
  const held = await readMedia(mediaRootFor(fixture.leafPath), captured.mediaRef);
  assert.equal(held.ok, true);
  if (held.ok) assert.deepEqual(exported, held.bytes);
  assert.deepEqual((await readdir(join(afterShare.out, "media"))).length, 1, "the export carries exactly the selected still");
});
