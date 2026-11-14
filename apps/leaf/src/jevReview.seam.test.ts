/**
 * KEEP RISES, PASS SINKS — driven through the real server.
 *
 * /review reads Jev's private marks from the workflow and places the open rows Keep, unmarked,
 * Pass. Retry shows only while TypeSafe is configured. A check asked for from /review lands back
 * on the row and decides nothing. No request leaves the machine: the saved receipts are written
 * here for the exact selections Jev would see, and the schedule is off, so no pass calls anyone.
 *
 * The garden is synthetic: made-up subjects and a temp repository, deleted afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseHarvestDocument } from "@foliage/photosynthesis";
import { JEV_SOURCE_POLICY, prepareCandidateJev, type JevAccess } from "./jevWorkflow.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const ref = (n: number): string => n.toString(16).padStart(40, "0");
const LONG = `git-cluster:${"a".repeat(300)}`;
const draft = (id: string, n: number, month: string, review: Record<string, unknown> = { state: "candidate" }) => ({
  id,
  title: `synthetic ${id.slice(0, 40)}`,
  evidence: [{ source: "git", ref: ref(n), observedAt: "2026-09-01T00:00:00Z", authoredAt: `2026-${month}-01T00:00:00Z`, excerpt: `synthetic subject ${n}` }],
  extractor: "git-cluster",
  draftedAt: "2026-09-01T00:00:00Z",
  review,
});

async function garden(): Promise<{ readonly dir: string; readonly harvest: string; readonly workflow: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-jev-review-")));
  roots.push(dir);
  const repo = join(dir, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "synthetic@foliage.invalid");
  git("config", "user.name", "Synthetic Author");
  git("commit", "-q", "--allow-empty", "-m", "chore: synthetic root");
  const document = {
    repo,
    candidates: [
      draft("git-cluster:keepme", 1, "01"),
      draft("git-cluster:plain", 2, "02"),
      draft("git-cluster:broken", 3, "03"),
      draft(LONG, 4, "04"),
      draft("git-cluster:passme", 5, "05"),
      draft("git-cluster:done", 6, "06", { state: "approved", by: "Synthetic Reviewer", at: "2026-09-02T00:00:00Z" }),
    ],
  };
  const parsed = parseHarvestDocument(document);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const access: JevAccess = { grant: "grant-1", source: "source-1", email: "synthetic@foliage.invalid" };
  const prepared = (id: string) => {
    const p = prepareCandidateJev(parsed.harvest, id, access);
    assert.ok(p.ok, id);
    return p;
  };
  const receipt = (id: string, outcome: "keep" | "pass") => {
    const p = prepared(id);
    return {
      selectionDigest: p.selectionDigest, caller: "photosynthesis", subject: p.selection.subject, pool: "source:source-1", material: id,
      documentRevision: p.selection.documentRevision, policyRevision: JEV_SOURCE_POLICY, evidenceRefs: [...p.selection.material.evidenceRefs],
      outcome, reason: outcome === "keep" ? "meaningful_work" : "outside_purpose", provider: "typesafe", model: "jev-1.13.0", checkedAt: "2026-09-02T00:00:00.000Z",
    };
  };
  const attempt = (id: string, n: number) => ({ id: `attempt-${n}`, grant: "grant-1", packet: id, selectionDigest: prepared(id).selectionDigest, startedAt: "2026-09-02T00:00:00.000Z" });
  const harvest = join(dir, "harvest.json");
  await writeFile(harvest, `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(join(dir, "leaf.json"), JSON.stringify({ id: "leaf:synthetic", subject: "Synthetic Subject", leaflets: [] }));
  await mkdir(join(dir, "workflow"));
  const workflow = join(dir, "workflow", "workflow.json");
  await writeFile(workflow, JSON.stringify({
    version: 1, schedule: null, proposals: [], history: [], nextAt: null, attempt: 0, running: false,
    sources: [{ id: "source-1", path: repo, email: "synthetic@foliage.invalid", enabled: true }],
    jev: {
      grants: [{ id: "grant-1", source: "source-1", caller: "photosynthesis", provider: "typesafe", policyRevision: JEV_SOURCE_POLICY, grantedAt: "2026-09-01T00:00:00.000Z" }],
      attempts: [
        { ...attempt("git-cluster:keepme", 1), status: "completed", receipt: receipt("git-cluster:keepme", "keep") },
        { ...attempt("git-cluster:passme", 2), status: "completed", receipt: receipt("git-cluster:passme", "pass") },
        { ...attempt("git-cluster:broken", 3), status: "interrupted" },
      ],
    },
  }));
  return { dir, harvest, workflow };
}

type Client = {
  readonly get: (path: string) => Promise<Response>;
  readonly post: (path: string, form: Record<string, string>) => Promise<Response>;
};

async function withServer(dir: string, key: string, body: (client: Client) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_HARVEST: join(dir, "harvest.json"), FOLIAGE_LEAF: join(dir, "leaf.json"),
      FOLIAGE_WORKFLOW_DIR: join(dir, "workflow"), FOLIAGE_POLICY: join(dir, "policy.json"), TYPESAFE_API_KEY: key },
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
    await body({
      get: (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(4_000) }),
      post: (path, form) => fetch(`${base}${path}`, {
        method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(4_000),
        headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
      }),
    });
    assert.doesNotMatch(output, /\[workflow\]|failed:/, "the workflow stayed up");
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

/** The open rows top to bottom, each with the Jev label it wears and whether it offers Retry. */
const openRows = (html: string) =>
  (/<ul class="review-list leaf-list" data-review-open>([\s\S]*?)<\/ul>\s*(?:<details|$)/.exec(html)?.[1] ?? "")
    .split(/(?=<li id="candidate-)/)
    .filter((row) => row.startsWith("<li id="))
    .map((row) => ({
      id: /<li id="candidate-([^"]+)"/.exec(row)![1]!,
      mark: /data-jev-mark="([a-z]+)"/.exec(row)?.[1] ?? null,
      retry: /name="action" value="jev-run"/.test(row),
    }));

test("/review places Keep first and Pass last from the workflow's receipts; Retry needs TypeSafe; a check decides nothing", { timeout: 60_000 }, async () => {
  const g = await garden();
  const harvestBefore = await readFile(g.harvest, "utf8");
  const workflowBefore = await readFile(g.workflow, "utf8");
  await withServer(g.dir, "", async ({ get, post }) => {
    const page = await get("/review");
    assert.equal(page.status, 200);
    const rows = openRows(await page.text());
    assert.deepEqual(rows.map((r) => r.id), ["git-cluster:keepme", LONG, "git-cluster:broken", "git-cluster:plain", "git-cluster:passme"], "keep, then unmarked newest first, then pass");
    assert.deepEqual(rows.map((r) => r.mark), ["keep", null, null, null, "pass"]);
    assert.ok(rows.every((r) => !r.retry), "no Retry without TypeSafe");
    const snapshot = await (await get("/workflow/api")).json() as { readonly queue: unknown };
    assert.deepEqual(snapshot.queue, { open: rows.length, next: {
      id: "git-cluster:keepme", title: "synthetic git-cluster:keepme",
      href: "/review?focus=git-cluster%3Akeepme#candidate-git-cluster%3Akeepme",
    } }, "the workflow preview follows the current Jev order without a provider request");
    // A decided draft is refused, and nothing is written.
    const refused = await post("/workflow/jev", { action: "jev-run", candidate: "git-cluster:done" });
    assert.equal(refused.status, 409);
    assert.match(await refused.text(), /Already decided\./);
    // A check names one draft and nothing else: any other field set is refused, and nothing is written.
    for (const fields of [{ action: "jev-run", candidate: "git-cluster:keepme", packet: "x" }, { action: "jev-run" }]) {
      const odd = await post("/workflow/jev", fields);
      assert.equal(odd.status, 409, JSON.stringify(fields));
      assert.match(await odd.text(), /Unexpected decision fields\./);
    }
    // A current keep is reused: the owner lands back on the row, and no attempt is added.
    const back = await post("/workflow/jev", { action: "jev-run", candidate: "git-cluster:keepme" });
    assert.equal(back.status, 303);
    assert.equal(back.headers.get("location"), `/review#candidate-${encodeURIComponent("git-cluster:keepme")}`);
    assert.equal((await get("/review")).status, 200);
  });
  assert.equal(await readFile(g.harvest, "utf8"), harvestBefore, "harvest.json is byte-identical");
  assert.equal(await readFile(g.workflow, "utf8"), workflowBefore, "no attempt was recorded");
  await withServer(g.dir, "protocol-only-not-a-secret", async ({ get }) => {
    const rows = openRows(await (await get("/review")).text());
    assert.deepEqual(rows.filter((r) => r.retry).map((r) => r.id), ["git-cluster:broken"], "Retry only for the interrupted check");
  });
  assert.equal(await readFile(g.harvest, "utf8"), harvestBefore);
});
