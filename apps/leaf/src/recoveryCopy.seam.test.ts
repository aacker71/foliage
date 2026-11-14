/**
 * RECOVERY COPY, through the real server and the real launcher. A refusal or a failed read names
 * the state and the next step in the reader's words: no absolute path, internal id, ISO stamp or
 * raw OS error in the sentence. A file's location appears only inside a closed Technical details
 * disclosure, and only where repairing that file is the way on. Expected states answer 4xx with a
 * page in the app layout, never a 500 or a text/plain body; the launcher starts on a broken queue.
 *
 * The garden here is synthetic: made-up refs and titles in a temp folder, deleted afterwards.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { LeafLoad } from "./leafDocument.ts";
import { leafLoadProblem } from "./loadLabels.ts";
import { renderSetupStart } from "./portfolioSetup.ts";
import { gitNeeded } from "./gitNeeded.ts";
import { openWorkflow } from "./workflow.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const ref = (n: number): string => n.toString(16).padStart(40, "0");
const draft = (id: string, title: string, n: number, review: Record<string, unknown> = { state: "candidate" }) => ({
  id, title,
  evidence: [{ source: "git", ref: ref(n), observedAt: "2026-09-01T00:00:00Z" }],
  extractor: "git-cluster",
  draftedAt: "2026-09-01T00:00:00Z",
  review,
});

async function garden(options: { leaf?: boolean; approved?: boolean } = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-recovery-")));
  roots.push(dir);
  await writeFile(join(dir, "harvest.json"), JSON.stringify({
    candidates: [
      draft("git-cluster:feat", "Built the synthetic feature", 1),
      draft("git-cluster:docs", "Wrote the synthetic guide", 2,
        options.approved ? { state: "approved", by: "Synthetic Reviewer", at: "2026-09-02T10:11:12Z" } : { state: "candidate" }),
    ],
  }));
  if (options.leaf !== false) {
    await writeFile(join(dir, "leaf.json"), JSON.stringify({
      id: "leaf:synthetic", subject: "Synthetic Subject",
      leaflets: [{ id: "git:one", title: "A synthetic record", tier: "pending", provenance: { source: "git", ref: ref(9), observedAt: "2026-09-01T00:00:00Z" } }],
    }));
  }
  return dir;
}

interface Answer { readonly status: number; readonly type: string; readonly body: string }

async function withServer(dir: string, body: (
  get: (path: string) => Promise<Answer>,
  post: (path: string, fields?: Record<string, string>) => Promise<Answer>,
  base: string,
) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_HARVEST: join(dir, "harvest.json"), FOLIAGE_LEAF: join(dir, "leaf.json"),
      FOLIAGE_WORKFLOW_DIR: join(dir, "workflow"), FOLIAGE_POLICY: join(dir, "policy.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (d) => { output += String(d); });
  const answer = async (res: Response): Promise<Answer> => ({ status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() });
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
      async (path) => answer(await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(4_000) })),
      async (path, fields = {}) => answer(await fetch(`${base}${path}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", Origin: base },
        body: new URLSearchParams(fields), redirect: "manual", signal: AbortSignal.timeout(4_000),
      })),
      base,
    );
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

/** What a reader sees without opening a disclosure: closed `<details>` bodies and tags removed. */
function said(html: string): string {
  let out = html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, "");
  for (let before = ""; before !== out;) { before = out; out = out.replace(/<details(?![^>]*\bopen\b)[^>]*>(?:(?!<details)[\s\S])*?<\/details>/g, ""); }
  return out.replace(/<[^>]*>/g, " ").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
const INTERNALS = /git-cluster:|\d{4}-\d\d-\d\dT\d\d:\d\d|ENOENT|SyntaxError|refused:|NOTHING was/;

test("a decision made twice is refused by the draft's title and the day it was decided", { timeout: 60_000 }, async () => {
  const dir = await garden();
  await withServer(dir, async (_get, post) => {
    const fields = { id: "git-cluster:feat", decision: "approve", by: "Synthetic Reviewer" };
    assert.equal((await post("/review", fields)).status, 303);
    const twice = await post("/review", fields);
    assert.equal(twice.status, 409);
    const banner = /<aside id="review-refusal"[\s\S]*?<\/aside>/.exec(twice.body)?.[0] ?? "";
    const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date());
    assert.match(said(banner), new RegExp(`“Built the synthetic feature” is already approved by Synthetic Reviewer on ${today} ?\\.`));
    // The day is read in UTC like every Observed date; the recorded instant is its machine-readable value.
    assert.match(banner, new RegExp(`on <time datetime="\\d{4}-\\d\\d-\\d\\dT[^"]+Z">${today}</time>\\.`));
    assert.doesNotMatch(said(banner), INTERNALS, said(banner));
    assert.ok(!banner.includes(dir), "no path in a decision refusal");
  });
});

test("a malformed queue is a 409 page that names the repair; the file is named only under Technical details", { timeout: 60_000 }, async () => {
  const dir = await garden();
  await writeFile(join(dir, "harvest.json"), '{"candidates": [');
  await withServer(dir, async (get, post) => {
    for (const [what, answer] of [
      ["GET /review", await get("/review")],
      ["POST /review", await post("/review", { id: "git-cluster:feat", decision: "approve", by: "Synthetic Reviewer" })],
      ["POST /promote", await post("/promote")],
    ] as const) {
      assert.equal(answer.status, 409, `${what}: an expected state, not a server fault`);
      assert.match(answer.type, /^text\/html/, what);
      assert.match(said(answer.body), /Draft file is not valid JSON Correct the draft file, then reload\./, what);
      assert.match(answer.body, /<a[^>]*href="\/review"[^>]*>Reload<\/a>/, what);
      assert.match(answer.body, new RegExp(`<details class="review-technical"><summary>Technical details</summary><p>Draft file <span class="fol-metric"[^>]*>[^<]*harvest\\.json</span>`), what);
      assert.ok(!said(answer.body).includes(dir), `${what}: the path waits in the closed disclosure`);
      assert.doesNotMatch(said(answer.body), INTERNALS, what);
    }
    assert.match(said((await post("/promote")).body), /Nothing added to your record/);
  });
});

test("Add to leaf with no record answers a page in the app layout with the next step and the way back", { timeout: 60_000 }, async () => {
  const dir = await garden({ leaf: false, approved: true });
  await withServer(dir, async (get, post) => {
    const refused = await post("/promote");
    assert.equal(refused.status, 409);
    assert.match(refused.type, /^text\/html/, "never a bare text/plain body");
    assert.match(refused.body, /<nav aria-label="Primary"/, "inside the app's navigation");
    assert.match(said(refused.body), /Nothing added to your record No private record yet Create it, then add your 1 approved draft from Review\./);
    assert.match(refused.body, /<a[^>]*href="\/leaf\/setup"[^>]*>Create your private record<\/a>/);
    assert.match(refused.body, /<a href="\/review#review-promote-h">Back to review<\/a>/);
    assert.ok(!refused.body.includes(dir), "a missing record has no file to repair, so no path anywhere");
    assert.doesNotMatch(said(refused.body), INTERNALS);

    const queue = await get("/review");
    const panel = /<section class="review-promote"[\s\S]*?<\/section>/.exec(queue.body)?.[0] ?? "";
    // The same action and words as the refusal above; the panel is where the drafts are added.
    assert.match(said(panel), /No private record yet · 1 approved Create it, then add your approved draft here\. Create your private record$/);
    assert.match(panel, /<a class="fol-button fol-button-primary" href="\/leaf\/setup">Create your private record<\/a>/);
    assert.ok(!panel.includes(dir), "the promote panel names the next step, not the path");
    assert.doesNotMatch(panel, /Technical details/, "no file yet, so nothing to repair");
  });
});

test("a record that will not parse names the repair on every page, with the file and where it breaks under Technical details", { timeout: 60_000 }, async () => {
  const dir = await garden({ approved: true });
  await writeFile(join(dir, "leaf.json"), "{oops");
  const technicalOf = (html: string) => /<details class="review-technical"><summary>Technical details<\/summary>[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  const repairable = (what: string, html: string) => {
    const technical = technicalOf(html);
    assert.match(technical, /<p>Leaf file <span class="fol-metric"[^>]*>[^<]*leaf\.json<\/span><\/p>/, `${what}: the file, inside the disclosure`);
    assert.match(technical, /position 1/, `${what}: and where the JSON breaks`);
    assert.ok(!said(html).includes(dir), `${what}: the path waits in the closed disclosure`);
    assert.doesNotMatch(said(html), INTERNALS, what);
  };
  await withServer(dir, async (get, post) => {
    // The promote panel and the refusal name no Portfolio step: Portfolio lists fields to fix only
    // for a record that parses. Here the file and the parse error are the way on, on the page itself.
    const panel = /<section class="review-promote"[\s\S]*?<\/section>/.exec((await get("/review")).body)?.[0] ?? "";
    assert.match(said(panel), /1 approved · no leaf Couldn't read your private record: the file is not valid JSON\. Repair it, then reload\./);
    assert.doesNotMatch(panel, /Portfolio|href="\/leaf"/);
    repairable("promote panel", panel);
    // Approved drafts are waiting, but creating a record would not fix this file and must never
    // replace it: no create action on the panel, and the setup route refuses and leaves it as it is.
    assert.doesNotMatch(panel, /Create your private record|\/leaf\/setup/);
    assert.doesNotMatch((await get("/leaf/setup")).body, /Create private record|name="action" value="create"/);
    assert.equal((await post("/leaf/setup", { action: "create", subject: "Synthetic Subject" })).status, 409);
    assert.equal(await readFile(join(dir, "leaf.json"), "utf8"), "{oops", "the broken record is untouched");

    const refused = await post("/promote");
    assert.equal(refused.status, 409);
    assert.match(refused.type, /^text\/html/);
    const plate = /<section class="leaf-state"[\s\S]*?<\/section>/.exec(refused.body)?.[0] ?? "";
    assert.match(said(plate), /Leaf file is not valid JSON Correct the file, then add your approved drafts again\. Back to review/);
    assert.doesNotMatch(plate, /Portfolio|href="\/leaf"|Create your private record|\/leaf\/setup/);
    repairable("POST /promote", plate);

    for (const path of ["/leaf/resume", "/leaf/curate", "/leaf/presentation", "/leaf/reflection"]) {
      const page = await get(path);
      assert.equal(page.status, 409, path);
      assert.match(said(page.body), /Couldn't read your private record: the file is not valid JSON\. Repair it, then reload\./, path);
      repairable(path, page.body);
    }
    const portfolio = await get("/leaf");
    assert.equal(portfolio.status, 409);
    assert.match(said(portfolio.body), /Leaf document is not valid JSON Nothing counted Correct the file, then reload\./);
    repairable("/leaf", portfolio.body);
    // The portfolio start page says it in the same words as every page above, not a wording of its own.
    const setup = await get("/leaf/setup");
    assert.match(said(setup.body), /Record unavailable Couldn't read your private record: the file is not valid JSON\. Repair it, then reload\./);
    assert.ok(!said(setup.body).includes(dir), "/leaf/setup: no path");
  });
});

test("the portfolio start page words each record that did not load as leafLoadProblem does, and offers to start one only when there is none", () => {
  const path = "/synthetic/garden/leaf.json";
  const failed: readonly Extract<LeafLoad, { ok: false }>[] = [
    { ok: false, cause: "unconfigured", detail: "FOLIAGE_LEAF is set but blank", path: null },
    { ok: false, cause: "unreadable", detail: `${path}: EACCES`, path, errno: "EACCES" },
    { ok: false, cause: "malformed", detail: `${path} is not valid JSON: Unexpected token`, path },
    { ok: false, cause: "invalid", detail: `${path} is not a leaf document`, path, issues: [] },
  ];
  for (const load of failed) {
    const page = said(renderSetupStart(load));
    assert.ok(page.includes(`Record unavailable ${leafLoadProblem(load)}`), `${load.cause}: ${page}`);
    assert.doesNotMatch(page, /Create private record|synthetic\/garden|FOLIAGE_LEAF|EACCES|Unexpected token/, load.cause);
  }
  assert.deepEqual(failed.map(leafLoadProblem), [
    "The location of your private record isn't set for this workspace. Start Foliage with foliage up.",
    "Couldn't read your private record. Check the file's permissions, then reload.",
    "Couldn't read your private record: the file is not valid JSON. Repair it, then reload.",
    "Your private record needs repair. Portfolio lists what to fix.",
  ]);
  const start = said(renderSetupStart({ ok: false, cause: "absent", detail: `No leaf document at ${path}`, path }));
  assert.match(start, /Start your record Your name Create private record/);
  assert.ok(!start.includes(leafLoadProblem({ cause: "absent" })), "no record yet is not a problem on the page that starts one");
});

test("a read that failed says so, never 'Not saved', and never prints the record's path", { timeout: 60_000 }, async () => {
  const missing = await garden({ leaf: false });
  await withServer(missing, async (get) => {
    for (const path of ["/leaf/resume", "/leaf/presentation", "/leaf/curate", "/leaf/story?leaflet=git%3Aone"]) {
      const page = await get(path);
      assert.equal(page.status, 409, path);
      assert.doesNotMatch(page.body, /Not saved/, `${path}: nothing was being saved`);
      assert.match(said(page.body), /No private record yet\. Start your record in Portfolio first\./, path);
      assert.ok(!page.body.includes(missing), `${path}: no path`);
    }
    assert.match(said((await get("/leaf/resume")).body), /Couldn't open this page\./);
    assert.match(said((await get("/leaf/curate")).body), /Couldn't open highlights\./);
  });
  const present = await garden();
  await withServer(present, async (get) => {
    const page = await get("/leaf/achievement?id=not-an-achievement");
    assert.equal(page.status, 404);
    assert.match(said(page.body), /Couldn't open this page\. This achievement is not in the current portfolio\./);
    assert.doesNotMatch(page.body, /Not saved/);
  });
});

test("live refreshes, Scarlet and Send to Scarlet show the named problem; the loader's path and parser text stay in Technical details", { timeout: 60_000 }, async () => {
  const dir = await garden();
  await writeFile(join(dir, "leaf.json"), "{oops");
  const record = "Couldn't read your private record: the file is not valid JSON. Repair it, then reload.";
  const loaderWords = /position 1|Unexpected token|JSON at|malformed —/;
  await withServer(dir, async (get, post, base) => {
    // portfolio-reader.mjs and compound-leaf.mjs print `error` as the page's update status.
    for (const path of ["/leaf/portfolio-state", "/leaf/explore/state"]) {
      const state = await get(path);
      assert.equal(state.status, 409, path);
      assert.deepEqual(JSON.parse(state.body), { error: record }, path);
    }

    const leaflet = await post("/sources/assessment", { leaflet: "git:one", revision: "r", documentRevision: "d" });
    assert.equal(leaflet.status, 409);
    assert.ok(said(leaflet.body).includes(`Nothing changed. ${record} Back`), said(leaflet.body));
    assert.match(leaflet.body, /<details class="review-technical"><summary>Technical details<\/summary><p>Leaf file <span class="fol-metric"[^>]*>[^<]*leaf\.json<\/span>/);
    const packet = await post("/sources/assessment", { packet: "p", revision: "r" });
    assert.equal(packet.status, 409);
    assert.ok(said(packet.body).includes(record), said(packet.body));
    for (const [what, html] of [["Send to Scarlet (leaflet)", leaflet.body], ["Send to Scarlet (draft)", packet.body]] as const) {
      assert.ok(!said(html).includes(dir), `${what}: no path in visible copy`);
      assert.doesNotMatch(said(html), loaderWords, what);
    }

    // The streamed answer's RUN_ERROR message is the visible status in scarlet-client.mjs.
    const run = await fetch(`${base}/scarlet/run`, {
      method: "POST", headers: { "content-type": "application/json", Origin: base }, signal: AbortSignal.timeout(4_000),
      body: JSON.stringify({ threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "What did I build?" }], tools: [], context: [], state: {} }),
    });
    const events = (await run.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    assert.deepEqual(events.filter((e) => e.type === "RUN_ERROR").map((e) => [e.code, e.message]), [["leaf-unavailable", record]]);
    // Without JavaScript the same refusal is a label; the loader's words wait in the closed disclosure.
    const asked = await post("/scarlet", { question: "What did I build?" });
    assert.match(said(asked.body), /Not answered Leaf unavailable Open portfolio setup/);
    assert.ok(!said(asked.body).includes(dir));
    assert.match(asked.body, /<summary>Technical details<\/summary>[\s\S]*?malformed — /);
  });

  const drafts = await garden();
  await writeFile(join(drafts, "harvest.json"), "{broken");
  await writeFile(join(drafts, "policy.json"), "{oops");
  await withServer(drafts, async (get) => {
    const candidate = await get("/scarlet/workspace?candidate=git-cluster%3Afeat");
    assert.equal(candidate.status, 409);
    assert.ok(said(candidate.body).includes("Couldn't read your drafts. Review shows what to repair."), said(candidate.body));
    const publish = await get("/scarlet/workspace?leaflet=git%3Aone&purpose=publish");
    assert.equal(publish.status, 409);
    const rules = "Foliage cannot apply the current publish rules. Fix the policy configuration or file, then reload this page.";
    assert.ok(said(publish.body).includes(rules), said(publish.body));
    const state = await get("/leaf/portfolio-state");
    assert.equal(state.status, 503);
    assert.deepEqual(JSON.parse(state.body), { error: rules });
    for (const [what, text] of [["candidate", said(candidate.body)], ["publish", said(publish.body)], ["portfolio-state", state.body]] as const) {
      assert.ok(!text.includes(drafts), `${what}: no path in visible copy`);
      assert.doesNotMatch(text, /position 1|Unexpected token|JSON at|Harvest|policy\.json/, what);
    }
  });
});

test("connecting a repository at a wrong path names the problem and the next step, not ENOENT", { timeout: 60_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-recovery-sources-")));
  roots.push(dir);
  const app = await openWorkflow(join(dir, "state"), { harvestPath: join(dir, "harvest.json") });
  try {
    const nowhere = join(dir, "no-such-folder");
    await assert.rejects(app.command({ action: "source", path: nowhere, email: "synthetic@foliage.invalid", authorized: true }),
      (error: Error) => error.message === "No folder at that path. Check it and try again.");
    await assert.rejects(app.command({ action: "source", path: dir, email: "synthetic@foliage.invalid", authorized: true }),
      (error: Error) => error.message === "Git can't open that folder as a repository. Choose the repository root directory.");
    assert.equal(app.snapshot().sources.length, 0, "nothing was connected");
  } finally {
    await app.close();
  }
});

test("a repository git refuses for its owner, or a git that is not there, is not 'choose another folder'", { timeout: 60_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-recovery-git-")));
  roots.push(dir);
  const repo = join(dir, "repo");
  await mkdir(repo);
  // A stand-in for git that answers exactly as git does for a repository owned by someone else
  // (a WSL or external drive, a shared machine): exit 128 and its own remedy on stderr.
  const fakeBin = join(dir, "bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "git"), [
    "#!/bin/sh",
    `echo "fatal: detected dubious ownership in repository at '${repo}'" >&2`,
    `printf 'To add an exception for this directory, call:\\n\\n\\tgit config --global --add safe.directory ${repo}\\n' >&2`,
    "exit 128",
  ].join("\n"), { mode: 0o755 });
  const app = await openWorkflow(join(dir, "state"), { harvestPath: join(dir, "harvest.json") });
  const path = process.env["PATH"];
  try {
    const connect = () => app.command({ action: "source", path: repo, email: "synthetic@foliage.invalid", authorized: true });
    process.env["PATH"] = fakeBin;
    await assert.rejects(connect(), (error: Error & { technical?: string }) => {
      assert.equal(error.message, "Git doesn't trust this folder's owner. Mark it safe in Git, then try again.");
      assert.equal(error.technical, `git config --global --add safe.directory '${repo}'`, "git's own fix, for the closed disclosure");
      return true;
    });
    process.env["PATH"] = join(dir, "empty");
    await assert.rejects(connect(), (error: Error) => error.message === gitNeeded("Foliage", "git is not installed here"));
    assert.equal(app.snapshot().sources.length, 0, "nothing was connected");
  } finally {
    process.env["PATH"] = path;
    await app.close();
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") return probe.close(() => reject(new Error("no port from the OS")));
      probe.close(() => resolve(addr.port));
    });
  });
}

const cliEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FOLIAGE_"))), NO_COLOR: "1" };

/** Run `foliage up` on a garden until `path` answers, then hand over that answer and the banner. */
async function withUp(dir: string, path: string, body: (answer: Response, output: string) => Promise<void>): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [FOLIAGE_CLI, "up", "--port", String(port), "--garden", dir], { env: cliEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (d) => { output += String(d); });
  child.stderr.on("data", (d) => { output += String(d); });
  try {
    let answer: Response | undefined;
    for (const deadline = Date.now() + 10_000; answer === undefined;) {
      assert.ok(child.exitCode === null, `foliage up exited before serving:\n${output}`);
      assert.ok(Date.now() < deadline, `foliage up did not answer:\n${output}`);
      answer = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2_000) }).catch(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return undefined;
      });
    }
    await body(answer, output);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

test("foliage up starts on a malformed queue and points at /review; status names it too", { timeout: 60_000 }, async () => {
  const dir = await garden();
  await writeFile(join(dir, "harvest.json"), '{"candidates": [');

  const status = spawnSync(process.execPath, [FOLIAGE_CLI, "status", "--garden", dir], { encoding: "utf8", env: cliEnv, timeout: 30_000 });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /REVIEW +drafts can't be read \(harvest\.json\)/);
  assert.doesNotMatch(status.stdout + status.stderr, /SyntaxError|at JSON\.parse/);

  await withUp(dir, "/review", async (review, output) => {
    assert.equal(review.status, 409);
    assert.match(said(await review.text()), /Draft file is not valid JSON/);
    assert.match(output, /REVIEW +drafts can't be read {2}→ \/review shows what to repair/);
    assert.match(output, /LEAF +Synthetic Subject/, "the readable record is still counted");
    assert.doesNotMatch(output, /SyntaxError|at JSON\.parse/);
  });
});

test("foliage up and status name a record file that will not parse rather than sending the owner to Portfolio", { timeout: 60_000 }, async () => {
  const dir = await garden();
  const file = join(dir, "leaf.json");
  await writeFile(file, "{oops");

  const status = spawnSync(process.execPath, [FOLIAGE_CLI, "status", "--garden", dir], { encoding: "utf8", env: cliEnv, timeout: 30_000 });
  assert.equal(status.status, 0, status.stderr);
  assert.ok(status.stdout.includes(`LEAF     ${file} isn't valid JSON`), status.stdout);
  assert.match(status.stdout, /NEXT +correct the JSON in that file/);
  assert.doesNotMatch(status.stdout, /Portfolio/);

  await withUp(dir, "/leaf", async (portfolio, output) => {
    assert.equal(portfolio.status, 409);
    assert.match(said(await portfolio.text()), /Correct the file, then reload\./);
    assert.ok(output.includes(`LEAF     isn't valid JSON  → correct ${file}, then reload`), output);
    assert.doesNotMatch(output, /Portfolio|SyntaxError|at JSON\.parse/);
  });
});

test("foliage up and status survive a record and a drafts file that parse to the wrong shape, and name each file", { timeout: 60_000 }, async () => {
  const dir = await garden();
  const leafFile = join(dir, "leaf.json");
  const draftsFile = join(dir, "harvest.json");
  const crashed = /TypeError|\n +at /;
  for (const [leaf, drafts] of [
    ['{"id": "leaf:synthetic", "subject": "Synthetic Subject", "leaflets": {"git:one": 1}}', '{"candidates": {}}'],
    ["null", '{"candidates": [null]}'],
    ["[1, 2]", '"candidates"'],
  ] as const) {
    await writeFile(leafFile, leaf);
    await writeFile(draftsFile, drafts);
    const status = spawnSync(process.execPath, [FOLIAGE_CLI, "status", "--garden", dir], { encoding: "utf8", env: cliEnv, timeout: 30_000 });
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes(`LEAF     ${leafFile} needs repair`), `${leaf}: ${status.stdout}`);
    assert.match(status.stdout, /NEXT +'[^']+' '[^']*foliage\.mjs' 'up' '--garden' '[^']+', then \/leaf lists what to fix/, leaf);
    assert.match(status.stdout, /REVIEW +drafts need repair \(harvest\.json\) {2}→ \/review · '[^']+' '[^']*foliage\.mjs' 'up' '--garden' '[^']+'/, drafts);
    assert.doesNotMatch(status.stdout + status.stderr, crashed);
  }

  await withUp(dir, "/leaf", async (portfolio, output) => {
    assert.equal(portfolio.status, 409);
    assert.match(said(await portfolio.text()), /Not a leaf document Nothing counted \(document\)/, "Portfolio lists what to fix");
    assert.ok(output.includes(`LEAF     needs repair  → /leaf lists what to fix in ${leafFile}`), output);
    assert.ok(output.includes(`REVIEW   drafts need repair  → /review shows what to repair in ${draftsFile}`), output);
    assert.doesNotMatch(output, crashed);
  });
  await withServer(dir, async (get) => {
    const review = await get("/review");
    assert.equal(review.status, 409);
    assert.match(said(review.body), /Draft file needs repair/, "/review shows the problem the launcher pointed at");
  });
});

test("foliage status with no record names a drafts file that will not load instead of only suggesting grow", { timeout: 60_000 }, async () => {
  const dir = await garden({ leaf: false });
  for (const drafts of ['{"candidates": [', '{"candidates": {}}']) {
    await writeFile(join(dir, "harvest.json"), drafts);
    const status = spawnSync(process.execPath, [FOLIAGE_CLI, "status", "--garden", dir], { encoding: "utf8", env: cliEnv, timeout: 30_000 });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /LEAF +none yet at /, drafts);
    assert.match(status.stdout, /REVIEW +drafts (can't be read|need repair) \(harvest\.json\) {2}→ \/review · '[^']+' '[^']*foliage\.mjs' 'up' '--garden' '[^']+'/, drafts);
    assert.match(status.stdout, /NEXT +'[^']+' '[^']*foliage\.mjs' 'up' '--garden' '[^']+', then \/review shows what to repair/, drafts);
    assert.doesNotMatch(status.stdout, /'grow'/, "drafting over a drafts file that will not load is refused");
  }
});
