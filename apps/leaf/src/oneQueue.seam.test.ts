/**
 * ONE QUEUE, ONE COUNT — driven through the real server and the real launcher.
 *
 * harvest.json is the only review queue and /review is where it is decided. The workflow app
 * keeps no list of its own; it links to /review with the count /review itself shows, and
 * `foliage status` and `foliage review` report that same number. `foliage review` decides nothing
 * and writes nothing. While every collection source is paused, its undecided git drafts wait out
 * of sight on every one of those surfaces alike.
 *
 * The harvest here is synthetic: made-up refs and titles, a temp garden, deleted afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseHarvestDocument, reviewSubjectDigest, type HarvestDocument } from "@foliage/photosynthesis";
import { openWorkflow } from "./workflow.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const ref = (n: number): string => n.toString(16).padStart(40, "0");
const draft = (id: string, n: number, review: Record<string, unknown> = { state: "candidate" }) => ({
  id,
  title: `synthetic ${id}`,
  evidence: [{ source: "git", ref: ref(n), observedAt: "2026-09-01T00:00:00Z", authoredAt: `2026-0${n}-01T00:00:00Z`, excerpt: `synthetic subject ${n}` }],
  extractor: "git-cluster",
  draftedAt: "2026-09-01T00:00:00Z",
  review,
});

async function garden(enabled: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-one-queue-"));
  roots.push(dir);
  await writeFile(join(dir, "harvest.json"), `${JSON.stringify({
    repo: "/synthetic/repo",
    candidates: [
      draft("git-cluster:feat", 1),
      draft("git-cluster:fix", 2),
      draft("git-cluster:docs", 3),
      draft("git-cluster:chore", 4, { state: "approved", by: "Synthetic Reviewer", at: "2026-09-02T00:00:00Z" }),
    ],
  }, null, 2)}\n`);
  await writeFile(join(dir, "leaf.json"), JSON.stringify({ id: "leaf:synthetic", subject: "Synthetic Subject", leaflets: [] }));
  await mkdir(join(dir, "workflow"));
  await writeFile(join(dir, "workflow", "workflow.json"), JSON.stringify({
    version: 1, schedule: null, proposals: [], history: [], nextAt: null, attempt: 0, running: false,
    sources: [{ id: "synthetic-source", path: "/synthetic/repo", email: "synthetic@foliage.invalid", enabled }],
  }));
  return dir;
}

async function withServer(dir: string, body: (
  get: (path: string) => Promise<string>,
  post: (path: string, fields: URLSearchParams) => Promise<Response>,
) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_HARVEST: join(dir, "harvest.json"), FOLIAGE_LEAF: join(dir, "leaf.json"),
      FOLIAGE_WORKFLOW_DIR: join(dir, "workflow"), FOLIAGE_POLICY: join(dir, "policy.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (d) => { output += String(d); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output)), 10_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
      child.stdout.on("data", (d) => {
        output += String(d);
        const url = /\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    await body(
      async (path) => (await fetch(`${base}${path}`, { signal: AbortSignal.timeout(4_000) })).text(),
      (path, fields) => fetch(`${base}${path}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", Origin: base },
        body: fields, redirect: "manual", signal: AbortSignal.timeout(4_000),
      }),
    );
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

const foliage = (args: readonly string[], input = "") =>
  spawnSync(process.execPath, [FOLIAGE_CLI, ...args], { encoding: "utf8", input, timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } });

const reviewHeading = (html: string) => Number(/<h2 id="review-queue-h"><span class="fol-metric">(\d+)<\/span> to review<\/h2>/.exec(html)?.[1]);
const overviewAwaiting = (html: string) =>
  Number(/data-overview-stat="candidate">\s*<span class="fol-label">Awaiting review<\/span>\s*<b class="fol-metric leaf-count">(\d+)<\/b>/.exec(html)?.[1]);
/** The open list's candidate ids, top to bottom, as /review renders them. */
const reviewOrder = (html: string) =>
  [...(/<ul class="review-list leaf-list" data-review-open>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "").matchAll(/<li id="candidate-([^"]+)"/g)].map((m) => m[1]!);

test("/review, the workflow link, foliage status and foliage review all report the one queue's count", { timeout: 60_000 }, async () => {
  const dir = await garden(true);
  const before = await readFile(join(dir, "harvest.json"), "utf8");
  let order: string[] = [];
  await withServer(dir, async (get) => {
    assert.equal(reviewHeading(await get("/review")), 3);
    const found = await get("/review?q=docs");
    assert.equal(reviewHeading(found), 3, "search never changes the queue's true count");
    assert.deepEqual(reviewOrder(found), ["git-cluster:docs"], "GET search reaches the matching draft through the one queue");
    assert.match(found, /<span class="fol-metric">1<\/span> match<\/p>/);
    const api = JSON.parse(await get("/workflow/api"));
    assert.deepEqual(api.queue, { open: 3, next: {
      id: "git-cluster:docs", title: "synthetic git-cluster:docs",
      href: "/review?focus=git-cluster%3Adocs#candidate-git-cluster%3Adocs",
    } });
    assert.match(await get(api.queue.next.href), /id="candidate-git-cluster:docs"[\s\S]*?<details class="review-candidate-disclosure" open>/);
    assert.equal("review" in api, false, "the workflow keeps no review list");
    assert.equal("rows" in api.pipeline, false, "and no collected-work rows");
    assert.match(await get("/leaf"), /<span class="fol-metric">3<\/span> to review<\/strong><a href="\/review">/);
    const overview = await get("/");
    assert.equal(overviewAwaiting(overview), 3);
    assert.match(overview, />Review 3 drafts<\/a>/);
    order = reviewOrder(await get("/review"));
  });
  assert.deepEqual(order, ["git-cluster:docs", "git-cluster:fix", "git-cluster:feat"], "newest work first");
  const status = foliage(["status", "--garden", dir]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /REVIEW\s+3 to review\s+→ \/review/);
  assert.doesNotMatch(status.stdout, /127\.0\.0\.1:\d+\/review/, "the garden's port is not assumed");
  // Keystrokes that once approved are ignored: the one queue is decided at /review only.
  const review = foliage(["review", "--garden", dir], "a\na\na\n");
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /OPEN\s+\/review\s+3 to review/);
  assert.doesNotMatch(review.stdout, /127\.0\.0\.1:\d+\/review/, "the garden's port is not assumed");
  assert.doesNotMatch(review.stdout, /approved|\d+ of 3 ·/, "the terminal walks no queue and records no decision");
  assert.equal(await readFile(join(dir, "harvest.json"), "utf8"), before, "foliage review leaves harvest.json byte-identical");
  assert.match(foliage(["review", "--garden", dir, "--doc", join(dir, "harvest.json")]).stdout, /OPEN\s+\/review\s+3 to review/);
  // Another document's count is not the queue /review shows.
  const elsewhere = await mkdtemp(join(tmpdir(), "foliage-one-queue-elsewhere-"));
  roots.push(elsewhere);
  await writeFile(join(elsewhere, "harvest.json"), before);
  const foreign = foliage(["review", "--garden", dir, "--doc", join(elsewhere, "harvest.json")]);
  assert.equal(foreign.status, 2, foreign.stdout + foreign.stderr);
  assert.match(foreign.stderr, /not this garden's harvest · .*foliage-one-queue-elsewhere-/);
  assert.doesNotMatch(foreign.stdout, /to review/);
});

test("finding a cited ref keeps the Review context through a refused and a recorded decision", { timeout: 60_000 }, async () => {
  const dir = await garden(true);
  const citation = ref(3);
  const path = `/review?q=${citation}`;
  await withServer(dir, async (get, post) => {
    const found = await get(path);
    assert.deepEqual(reviewOrder(found), ["git-cluster:docs"]);
    assert.match(found, new RegExp(`<input type="hidden" name="q" value="${citation}">`));

    const fields = new URLSearchParams({ id: "git-cluster:docs", decision: "reject", by: "Alex", q: citation });
    const refused = await post("/review", fields);
    assert.equal(refused.status, 400);
    const refusedHtml = await refused.text();
    assert.match(refusedHtml, /Reason required to reject “synthetic git-cluster:docs”/);
    assert.match(refusedHtml, new RegExp(`name="q" value="${citation}"`));
    assert.deepEqual(reviewOrder(refusedHtml), ["git-cluster:docs"]);

    fields.set("decision", "approve");
    const recorded = await post("/review", fields);
    assert.equal(recorded.status, 303);
    const returnPath = `${path}&focus=git-cluster%3Adocs#candidate-git-cluster%3Adocs`;
    assert.equal(recorded.headers.get("location"), returnPath);
    const after = await get(returnPath);
    assert.match(after, /<details class="review-decided" data-review-decided open>/);
    assert.match(after, /id="candidate-git-cluster:docs"/);
    assert.match(after, /data-review-pill="approved"/);
    assert.match(after, new RegExp(`<span class="fol-metric">2</span> to review`));
    const queue = JSON.parse(await get("/workflow/api")).queue;
    assert.equal(queue.open, 2);
    assert.equal(queue.next.id, "git-cluster:fix", "the preview advances after a decision rather than retaining a decided draft");
  });
});

test("a retitled draft remains beside the old-title search after approval", { timeout: 60_000 }, async () => {
  const dir = await garden(true);
  const oldTitle = "synthetic git-cluster:docs";
  await withServer(dir, async (get, post) => {
    const found = await get(`/review?q=${encodeURIComponent(oldTitle)}`);
    assert.deepEqual(reviewOrder(found), ["git-cluster:docs"]);
    const fields = new URLSearchParams({ id: "git-cluster:docs", decision: "approve", by: "Alex", title: "Curated docs account", q: oldTitle });
    const recorded = await post("/review", fields);
    assert.equal(recorded.status, 303);
    const returnPath = recorded.headers.get("location");
    assert.equal(returnPath, `/review?q=${encodeURIComponent(oldTitle)}&focus=git-cluster%3Adocs#candidate-git-cluster%3Adocs`);
    const after = await get(returnPath!);
    assert.match(after, /<span class="fol-metric">0<\/span> matches · Selected record shown/);
    assert.match(after, /id="candidate-git-cluster:docs"[\s\S]*?<details class="review-candidate-disclosure" open>/);
    assert.match(after, /Curated docs account/);
    assert.match(after, /data-review-pill="approved"/);
    assert.doesNotMatch(after, /autofocus aria-describedby="review-refusal"/, "a completed decision has no refusal announcement");
  });
});

test("while every source is paused, each surface counts the same shown queue and /review says Paused", { timeout: 60_000 }, async () => {
  const dir = await garden(false);
  await withServer(dir, async (get) => {
    const html = await get("/review");
    assert.equal(reviewHeading(html), 0);
    assert.match(html, /data-queue-paused>Paused <span class="fol-metric">3<\/span>/);
    const forgedFocus = await get("/review?q=docs&focus=git-cluster%3Adocs");
    assert.equal(reviewHeading(forgedFocus), 0, "GET focus cannot override a paused queue");
    assert.deepEqual(reviewOrder(forgedFocus), []);
    assert.doesNotMatch(forgedFocus, /id="candidate-git-cluster:docs"/);
    assert.deepEqual(JSON.parse(await get("/workflow/api")).queue, { open: 0, next: null });
    const overview = await get("/");
    assert.equal(overviewAwaiting(overview), 0);
    assert.match(overview, /data-queue-paused>Paused <span class="fol-metric">3<\/span>/);
    assert.doesNotMatch(overview, />Review \d+ candidate/);
  });
  assert.match(foliage(["status", "--garden", dir]).stdout, /REVIEW\s+0 to review\s+Paused 3/);
  const before = await readFile(join(dir, "harvest.json"), "utf8");
  const review = foliage(["review", "--garden", dir]);
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /OPEN\s+\/review\s+0 to review · '[^']+' '[^']*foliage\.mjs' 'up' '--garden' '[^']+'\s+Paused 3/);
  assert.doesNotMatch(review.stdout, /every candidate is decided/, "hidden drafts are not decided ones");
  assert.equal(await readFile(join(dir, "harvest.json"), "utf8"), before, "foliage review leaves harvest.json byte-identical");
});

test("an unreadable harvest is an unread queue on the workflow link and the leaf, never an empty one", { timeout: 60_000 }, async () => {
  const dir = await garden(true);
  await writeFile(join(dir, "harvest.json"), "{broken\n");
  await withServer(dir, async (get) => {
    assert.deepEqual(JSON.parse(await get("/workflow/api")).queue, { open: null, next: null });
    assert.match(await get("/leaf"), /<strong>Review unavailable<\/strong>/);
  });
});

test("the running app's collector fills the harvest /review reads, and the workflow link counts it", { timeout: 60_000 }, async () => {
  const dir = await garden(true);
  // A temp repository of synthetic commits, the one the harvest is bound to.
  const repo = await realpath(await mkdtemp(join(tmpdir(), "foliage-one-queue-repo-")));
  roots.push(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "synthetic@foliage.invalid");
  git("config", "user.name", "Synthetic Collector");
  await writeFile(join(repo, "record.txt"), "synthetic\n");
  git("add", "record.txt");
  git("commit", "-q", "-m", "perf: a synthetic record for the collector");
  const sha = git("rev-parse", "HEAD").trim();
  await writeFile(join(dir, "harvest.json"), `${JSON.stringify({ repo, candidates: [] }, null, 2)}\n`);
  await writeFile(join(dir, "workflow", "workflow.json"), JSON.stringify({
    version: 1, proposals: [], history: [], attempt: 0, running: false, nextAt: "2026-01-01T00:00:00.000Z",
    schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "18:00", end: "08:00", paused: false },
    sources: [{ id: "synthetic-source", path: repo, email: "synthetic@foliage.invalid", enabled: true }],
  }));
  await withServer(dir, async (get) => {
    let html = "";
    for (let i = 0; i < 40 && reviewHeading(html = await get("/review")) !== 1; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal(reviewHeading(html), 1, "the collector's draft is in the queue /review shows");
    assert.deepEqual(reviewOrder(html), ["git-cluster:perf"]);
    const queue = JSON.parse(await get("/workflow/api")).queue;
    assert.equal(queue.open, 1);
    assert.equal(queue.next.id, "git-cluster:perf");
    const harvest = JSON.parse(await readFile(join(dir, "harvest.json"), "utf8"));
    assert.equal(queue.next.title, harvest.candidates[0].title, "the preview uses the actual collected title");
  });
  const queued = JSON.parse(await readFile(join(dir, "harvest.json"), "utf8"));
  assert.deepEqual(queued.candidates.flatMap((c: { evidence: { ref: string }[] }) => c.evidence.map((e) => e.ref)), [sha]);
});

test("grow from the main checkout keeps a queue the collector bound to a worktree of it; an unreadable one is refused by name", { timeout: 60_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-one-queue-worktree-")));
  roots.push(dir);
  const repo = join(dir, "repo");
  await mkdir(repo);
  const email = "synthetic@foliage.invalid";
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", email);
  git("config", "user.name", "Synthetic Collector");
  for (const n of [1, 2]) {
    await writeFile(join(repo, `record-${n}.txt`), `synthetic ${n}\n`);
    git("add", `record-${n}.txt`);
    git("commit", "-q", "-m", `feat: synthetic record ${n}`);
  }
  const worktree = join(dir, "worktree");
  git("worktree", "add", "-q", "-b", "wt", worktree);
  const gardenDir = join(dir, "garden");
  await mkdir(gardenDir);
  const harvestPath = join(gardenDir, "harvest.json");
  const readQueue = async (): Promise<HarvestDocument> => {
    const parsed = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
    assert.ok(parsed.ok);
    return parsed.harvest;
  };

  // The collector creates the harvest from the worktree, so it is bound to the worktree's path.
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: worktree, email, authorized: true });
    await app.command({ action: "schedule", schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "18:00", end: "08:00", paused: false } });
    await app.tick(new Date(), true);
  } finally {
    await app.close();
  }
  const collected = await readQueue();
  assert.equal(collected.repo, execFileSync("git", ["-C", worktree, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const drafted = collected.candidates.find((c) => c.id === "git-cluster:feat")!;
  execFileSync(process.execPath, [HARVEST_CLI, "approve", "git-cluster:feat", "--by", "Synthetic Reviewer", "--doc", harvestPath, "--expect-subject-digest", reviewSubjectDigest(drafted)], { stdio: "pipe" });
  const approved = (await readQueue()).candidates.find((c) => c.id === "git-cluster:feat")!;
  assert.equal(approved.review.state, "approved");

  const grow = () => spawnSync(process.execPath, [FOLIAGE_CLI, "grow", "--repo", repo, "--subject", "Synthetic Collector", "--identity", email, "--garden", gardenDir], {
    encoding: "utf8", timeout: 30_000, cwd: dir, env: { ...process.env, HOME: dir, NO_COLOR: "1" },
  });
  const grown = grow();
  assert.equal(grown.status, 0, grown.stdout + grown.stderr);
  assert.doesNotMatch(grown.stderr, /REFUSED/);
  assert.deepEqual((await readQueue()).candidates.find((c) => c.id === "git-cluster:feat")?.review, approved.review, "the approval stands");

  // A recorded repository that cannot be checked is not assumed to be this one.
  const unreadable = `${JSON.stringify({ ...JSON.parse(await readFile(harvestPath, "utf8")), repo: join(dir, "moved-away") }, null, 2)}\n`;
  await writeFile(harvestPath, unreadable);
  const refused = grow();
  assert.equal(refused.status, 3, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /REFUSED — cannot check that /);
  assert.equal(await readFile(harvestPath, "utf8"), unreadable);
});

test("no page links to the workflow review list that no longer exists", () => {
  // Every tracked source that renders or builds a link; tests and the old-anchor fallback are not links.
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "apps", "packages", "foliage.mjs"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.(?:ts|tsx|mjs|js)$/.test(f) && !/\.test\.(?:ts|mjs)$/.test(f) && !f.endsWith("/workflowNavigation.ts"));
  assert.ok(files.some((f) => f.endsWith("/leafletJourney.ts")), "the scan reads the sources");
  const linking = files.filter((f) => readFileSync(join(root, f), "utf8").includes("/workflow#review"));
  assert.deepEqual(linking, [], "these link to /workflow#review; the one queue is /review");
});

test("grow keeps what the collector drafted from a clone and for another source identity, never redrafts a legacy decision, and names what it withdraws", { timeout: 90_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-one-queue-grow-seam-")));
  roots.push(dir);
  const GROWER = "synthetic-grower@foliage.invalid";
  const OTHER = "synthetic-other@foliage.invalid";
  const repo = join(dir, "repo");
  const clone = join(dir, "clone");
  await mkdir(repo);
  const git = (cwd: string, email: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", "-c", `user.email=${email}`, "-c", "user.name=Synthetic", ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let n = 0;
  const commit = async (cwd: string, email: string, subject: string) => {
    n++;
    await writeFile(join(cwd, `record-${n}.txt`), `synthetic ${n}\n`);
    git(cwd, email, "add", `record-${n}.txt`);
    git(cwd, email, "commit", "-q", "-m", subject);
    return git(cwd, email, "rev-parse", "HEAD");
  };
  git(repo, GROWER, "init", "-q", "--initial-branch=main");
  await commit(repo, GROWER, "feat: synthetic record");
  const legacy = await commit(repo, GROWER, "perf: accepted in a legacy packet");
  execFileSync("git", ["clone", "-q", repo, clone]);
  const cloneOnly = await commit(clone, OTHER, "fix: only in the clone");
  const otherIdentity = await commit(repo, OTHER, "chore: by another source identity");

  const gardenDir = join(dir, "garden");
  const state = join(gardenDir, "workflow");
  await mkdir(state, { recursive: true });
  const harvestPath = join(gardenDir, "harvest.json");
  await writeFile(join(state, "workflow.json"), JSON.stringify({
    version: 1, schedule: null, history: [], nextAt: null, attempt: 0, running: false, sources: [],
    proposals: [{ id: "legacy", source: "legacy-source", title: "Legacy packet", omitted: 0, status: "accepted", updatedAt: "2026-08-01T00:00:00.000Z",
      evidence: [{ sha: legacy, title: "legacy", email: GROWER }] }],
  }));
  const app = await openWorkflow(state, { harvestPath });
  try {
    for (const [path, email] of [[repo, GROWER], [repo, OTHER], [clone, OTHER]] as const) await app.command({ action: "source", path, email, authorized: true });
    await app.command({ action: "schedule", schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "18:00", end: "08:00", paused: false } });
    await app.tick(new Date(), true);
  } finally {
    await app.close();
  }
  const readQueue = async (): Promise<HarvestDocument> => {
    const parsed = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
    assert.ok(parsed.ok);
    return parsed.harvest;
  };
  const byId = (h: HarvestDocument, id: string) => JSON.stringify(h.candidates.find((c) => c.id === id));
  const collected = await readQueue();
  assert.deepEqual(collected.candidates.map((c) => String(c.id)).sort(), ["git-cluster:chore", "git-cluster:feat", "git-cluster:fix"]);

  const grow = () => spawnSync(process.execPath, [FOLIAGE_CLI, "grow", "--repo", repo, "--subject", "Synthetic Grower", "--identity", GROWER, "--garden", gardenDir], {
    encoding: "utf8", timeout: 30_000, cwd: dir, env: { ...process.env, HOME: dir, NO_COLOR: "1" },
  });
  const grown = grow();
  assert.equal(grown.status, 0, grown.stdout + grown.stderr);
  const after = await readQueue();
  assert.equal(byId(after, "git-cluster:fix"), byId(collected, "git-cluster:fix"), "a clone's own commit stays drafted");
  assert.equal(byId(after, "git-cluster:chore"), byId(collected, "git-cluster:chore"), "another source identity's draft stays");
  assert.ok(!after.candidates.some((c) => c.evidence.some((e) => e.ref === legacy)), "a legacy packet decision is never redrafted");
  assert.match(grown.stdout, /· withdrawn 0/);
  assert.ok(after.candidates.some((c) => c.evidence.some((e) => e.ref === cloneOnly)));

  // A paused checkout is not read, and proves nothing gone.
  const pause = async (enabled: boolean) => {
    const saved = JSON.parse(await readFile(join(state, "workflow.json"), "utf8"));
    saved.sources = saved.sources.map((s: { path: string; enabled: boolean }) => (s.path === clone ? { ...s, enabled } : s));
    await writeFile(join(state, "workflow.json"), JSON.stringify(saved));
  };
  await pause(false);
  const paused = grow();
  assert.equal(paused.status, 0, paused.stdout + paused.stderr);
  assert.equal(byId(await readQueue(), "git-cluster:fix"), byId(collected, "git-cluster:fix"), "pausing a checkout is never a delete");
  await pause(true);

  // An enabled checkout that cannot be read proves nothing gone either.
  await rename(clone, `${clone}.moved`);
  const unreadable = grow();
  await rename(`${clone}.moved`, clone);
  assert.equal(unreadable.status, 0, unreadable.stdout + unreadable.stderr);
  assert.match(unreadable.stdout, /· withdrawn 0/);
  assert.equal(byId(await readQueue(), "git-cluster:fix"), byId(collected, "git-cluster:fix"), "an unreadable checkout is never a delete");

  // Gone from every checkout: now it is withdrawn, and grow names it.
  git(repo, GROWER, "reset", "-q", "--hard", "HEAD~1");
  assert.ok((await readQueue()).candidates.some((c) => c.evidence.some((e) => e.ref === otherIdentity)));
  const withdrew = grow();
  assert.equal(withdrew.status, 0, withdrew.stdout + withdrew.stderr);
  assert.match(withdrew.stdout, /· withdrawn 1/);
  assert.match(withdrew.stdout, /withdrawn {2}git-cluster:chore/);
  assert.equal((await readQueue()).candidates.find((c) => c.id === "git-cluster:chore"), undefined);
});

test("a grow for fewer identities keeps the drafts of the others while their commits remain", { timeout: 60_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-one-queue-identities-")));
  roots.push(dir);
  const repo = join(dir, "repo");
  await mkdir(repo);
  const git = (email: string, ...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "-c", `user.email=${email}`, "-c", "user.name=Synthetic", ...args], { encoding: "utf8" }).trim();
  git("a@foliage.invalid", "init", "-q", "--initial-branch=main");
  for (const [email, subject] of [["a@foliage.invalid", "feat: by a"], ["b@foliage.invalid", "docs: by b"]] as const) {
    await writeFile(join(repo, `${email}.txt`), "synthetic\n");
    git(email, "add", `${email}.txt`);
    git(email, "commit", "-q", "-m", subject);
  }
  const out = join(dir, "harvest.json");
  const propose = (...identities: string[]) =>
    execFileSync(process.execPath, [HARVEST_CLI, "propose", "--repo", repo, ...identities.flatMap((i) => ["--identity", i]), "--out", out, "--force"], { encoding: "utf8" });
  propose("a@foliage.invalid", "b@foliage.invalid");
  const docs = JSON.stringify(JSON.parse(await readFile(out, "utf8")).candidates.find((c: { id: string }) => c.id === "git-cluster:docs"));
  assert.ok(docs);
  assert.match(propose("a@foliage.invalid"), /· withdrawn 0/);
  assert.equal(JSON.stringify(JSON.parse(await readFile(out, "utf8")).candidates.find((c: { id: string }) => c.id === "git-cluster:docs")), docs);
});
