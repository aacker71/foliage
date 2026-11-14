/** Protocol probes only: these records are not a person's work or test success. */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { findDockerExecutable, prepareProjectEval, runPinnedProjectEval } from "./assistantProjectEval.ts";
import { queueCapturedDemo } from "./captureReview.ts";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const liveImage = process.env["FOLIAGE_PROJECT_EVAL_TEST_IMAGE"];
const image = liveImage ?? `sha256:${"0".repeat(64)}`; // Default probes a real unavailable runtime.
const scenario = { version: 1, id: "project-test-protocol-probe", steps: [
  { stage: "execute", argv: ["node", "--version"], timeoutMs: 10_000 },
] };

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "foliage-project-eval-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "source"), garden = join(root, "garden");
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await git(["config", "user.name", "Project evaluation protocol probe"]);
  await git(["config", "user.email", "project-eval-probe@foliage.invalid"]);
  await writeFile(join(repo, "README.txt"), "Bounded local evaluator protocol probe.\n");
  await git(["add", "README.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "chore: create protocol probe revision"]);
  const commit = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await mkdir(garden);
  const into = join(garden, "leaf.json"), out = join(garden, "harvest.json");
  const leaf = JSON.stringify({ id: "project-eval-probe", subject: "Project evaluation protocol probe", leaflets: [] });
  await writeFile(into, leaf);
  const scenarioFile = join(root, "scenario.json");
  await writeFile(scenarioFile, JSON.stringify(scenario));
  return { root, repo, garden, into, out, leaf, scenarioFile, commit };
}

test("project test selection requires exact owner inputs and bounds the scenario before connecting", async t => {
  const f = await fixture(t);
  const base = { repo: f.repo, commit: f.commit, scenarioFile: f.scenarioFile, image };
  const selected = await prepareProjectEval(base);
  assert.equal(selected.commit, f.commit);
  assert.equal(selected.scenario.id, scenario.id);
  await assert.rejects(prepareProjectEval({ ...base, repo: "relative" }), /absolute paths/);
  await assert.rejects(prepareProjectEval({ ...base, commit: "HEAD" }), /full Git commit SHA/);
  await assert.rejects(prepareProjectEval({ ...base, image: "node:latest" }), /immutable sha256/);
  await writeFile(f.scenarioFile, JSON.stringify({ ...scenario, steps: [{ ...scenario.steps[0], timeoutMs: 60_001 }] }));
  await assert.rejects(prepareProjectEval(base), /60-second MCP execution limit/);
  const changed = await runPinnedProjectEval(selected, { into: f.into, out: f.out,
    subject: { leafId: "project-eval-probe", name: "Project evaluation protocol probe" } });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.cause, "scenario-changed");
  await writeFile(f.scenarioFile, JSON.stringify(scenario));
  await writeFile(f.into, JSON.stringify({ id: "other-leaf", subject: "Another subject", leaflets: [] }));
  const foreign = await runPinnedProjectEval(selected, { into: f.into, out: f.out,
    subject: { leafId: "project-eval-probe", name: "Project evaluation protocol probe" } });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.cause, "target-changed");
  await assert.rejects(readFile(f.out), { code: "ENOENT" });
});

test("Docker discovery bypasses a broken PATH link and finds the app binary", async t => {
  const root = await mkdtemp(join(tmpdir(), "foliage-docker-path-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stale = join(root, "docker"), app = join(root, "Docker.app", "docker");
  await mkdir(join(root, "Docker.app"));
  await symlink(join(root, "missing-docker"), stale);
  await writeFile(app, "#!/bin/sh\nexit 0\n");
  await chmod(app, 0o700);
  assert.equal(await findDockerExecutable(root, app), app);
});

test("the launcher exposes a zero-argument, one-shot project test and queues its real outcome privately", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const ordinary = new StdioClientTransport({ command: process.execPath,
    args: [entry, "--into", f.into, "--out", f.out], cwd: tmpdir(), stderr: "pipe" });
  const ordinaryClient = new Client({ name: "project-eval-default-probe", version: "1.0.0" });
  try {
    await ordinaryClient.connect(ordinary);
    assert.ok(!(await ordinaryClient.listTools()).tools.some(tool => tool.name === "foliage_test_selected_project"));
  } finally { await ordinaryClient.close(); }

  if (liveImage !== undefined) {
    await writeFile(f.scenarioFile, JSON.stringify({ ...scenario, browser: {
      argv: ["node", "-e", "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>MCP transport probe</title><h1>MCP transport probe</h1>')}).listen(4321,'127.0.0.1')"],
      port: 4321, path: "/", readyTimeoutMs: 5000, durationSeconds: 2,
    } }));
  }

  const args = [launcher, "mcp", "--garden", f.garden, "--allow-project-test",
    "--test-repo", f.repo, "--test-commit", f.commit, "--test-scenario", f.scenarioFile, "--test-image", image];
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: tmpdir(), stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const client = new Client({ name: "project-eval-opt-in-probe", version: "1.0.0" });
  try {
    await client.connect(transport).catch(error => { throw new Error(`${String(error)} ${stderr}`); });
    const tool = (await client.listTools()).tools.find(item => item.name === "foliage_test_selected_project");
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.equal(tool.inputSchema["additionalProperties"], false);
    const refused = await client.callTool({ name: "foliage_test_selected_project", arguments: { argv: ["rm", "-rf", "/"] } });
    assert.equal(refused.isError, true);
    await assert.rejects(readdir(join(f.garden, "evaluations")), { code: "ENOENT" });
    const run = await client.callTool({ name: "foliage_test_selected_project", arguments: {} });
    assert.equal(run.isError, undefined, JSON.stringify(run.structuredContent));
    const visible = run.structuredContent as Record<string, unknown>;
    assert.equal(visible["approved"], false);
    assert.equal(visible["published"], false);
    const expectedStatus = liveImage === undefined ? "error" : "completed";
    assert.equal(visible["evaluationStatus"], expectedStatus);
    assert.equal("receiptPath" in visible, false, "local paths do not go to the model");
    const ids = visible["candidateIds"] as string[];
    assert.equal(ids.length, 1);
    const saved = JSON.parse(await readFile(f.out, "utf8")) as { candidates: {
      id: string; review: { state: string }; evidence: { excerpt: string }[] }[] };
    assert.equal(saved.candidates.length, 1);
    assert.equal(saved.candidates[0]?.id, ids[0]);
    assert.equal(saved.candidates[0]?.review.state, "candidate");
    const report = saved.candidates[0]?.evidence.find(e => e.excerpt?.includes("Declared outcome"))?.excerpt ?? "";
    assert.match(report, new RegExp(`Declared outcome: ${expectedStatus}`));
    assert.match(report, /Cleanup: container/);
    assert.equal(await readFile(f.into, "utf8"), f.leaf);
    const directories = await readdir(join(f.garden, "evaluations"));
    assert.equal(directories.length, 1);
    assert.equal(visible["receiptId"], directories[0], "the private receipt remains locatable without exposing its path");
    const receipt = JSON.parse(await readFile(join(f.garden, "evaluations", directories[0]!, "receipt.json"), "utf8"));
    assert.equal(receipt.evidence.status, expectedStatus);
    assert.equal(receipt.evidence.source.commit, f.commit);
    const again = await client.callTool({ name: "foliage_test_selected_project", arguments: {} });
    assert.equal(again.isError, true);
    assert.equal((again.structuredContent as Record<string, unknown>)["error"], "already-attempted");
    assert.equal((await readdir(join(f.garden, "evaluations"))).length, 1);
  } finally { await client.close(); }
});

test("project test grant refuses incomplete owner selection before serving tools", async t => {
  const f = await fixture(t);
  const child = spawnSync(process.execPath, [entry, "--into", f.into, "--out", f.out,
    "--allow-project-test", "--test-repo", f.repo], { encoding: "utf8", timeout: 10_000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /requires --test-repo, --test-commit, --test-scenario and --test-image/);
  await assert.rejects(readdir(join(f.garden, "evaluations")), { code: "ENOENT" });
});

test("real Docker test and same-job demo enter one private Review decision; dirty checkout and changed receipts cannot relabel it", {
  skip: liveImage === undefined ? "Set FOLIAGE_PROJECT_EVAL_TEST_IMAGE to exercise the real Docker/Chrome/ffmpeg boundary" : false,
  timeout: 120_000,
}, async t => {
  const f = await fixture(t);
  // Deliberately labelled protocol app, not a fabricated portfolio or customer result.
  const title = "Committed evaluation transport probe";
  await writeFile(join(f.repo, "server.mjs"), `import http from 'node:http';http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<!doctype html><title>${title}</title><h1>${title}</h1><p>This is a runtime acceptance probe, not career evidence.</p>')}).listen(4321,'127.0.0.1');`);
  await execute("git", ["-C", f.repo, "add", "server.mjs"]);
  await execute("git", ["-C", f.repo, "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-qm", "Add committed runtime probe"]);
  const commit = (await execute("git", ["-C", f.repo, "rev-parse", "HEAD"])).stdout.trim();
  await writeFile(join(f.repo, "server.mjs"), "throw new Error('UNCOMMITTED FILE MUST NEVER RUN');\n");
  const browser = { argv: ["node", "server.mjs"], port: 4321, path: "/", readyTimeoutMs: 5000, durationSeconds: 2 };
  await writeFile(f.scenarioFile, JSON.stringify({ ...scenario, browser, steps: [{
    stage: "execute", timeoutMs: 5000, argv: ["node", "-e",
      "require('node:assert/strict').match(require('node:fs').readFileSync('server.mjs','utf8'),/Committed evaluation transport probe/);console.log('Committed app source assertion passed')"],
  }] }));
  const selection = await prepareProjectEval({ repo: f.repo, commit, scenarioFile: f.scenarioFile, image });
  const outcome = await runPinnedProjectEval(selection, { into: f.into, out: f.out,
    subject: { leafId: "project-eval-probe", name: "Project evaluation protocol probe" } });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert.equal(outcome.evaluationStatus, "completed", JSON.stringify(outcome));
  const receipt = JSON.parse(await readFile(outcome.receiptPath, "utf8"));
  assert.equal(receipt.evidence.source.commit, commit);
  assert.equal(receipt.evidence.browser.status, "completed");
  assert.deepEqual(receipt.evidence.browser.cleanup, { browser: "removed", relay: "removed" });
  assert.deepEqual(receipt.evidence.cleanup, { container: "removed", snapshot: "removed" });
  assert.equal(receipt.evidence.browser.measurements.pageExceptions, 0);
  const captureRoot = `${outcome.receiptPath}.artifacts`, captureId = receipt.evidence.browser.capture.id;
  const captureFile = join(captureRoot, captureId, "receipt.json");
  const captureBytes = await readFile(captureFile, "utf8");
  assert.equal(JSON.parse(captureBytes).source.pageTitle, title);
  const saved = await readFile(f.out, "utf8"), harvest = JSON.parse(saved);
  assert.equal(harvest.candidates.length, 1);
  const candidate = harvest.candidates[0];
  assert.equal(candidate.id, outcome.candidateIds[0]);
  assert.equal(candidate.media.length, 2);
  assert.equal(candidate.review.state, "candidate");
  assert.match(candidate.evidence.find((e: { source: string }) => e.source === "foliage-eval").excerpt, new RegExp(commit));
  assert.equal(saved.includes(f.root), false, "private source paths are not projected into Review");
  assert.equal(await readFile(f.into, "utf8"), f.leaf);
  const args = { captureRoot, captureId, leafPath: f.into, harvestPath: f.out,
    evaluationReceiptPath: outcome.receiptPath, title: "Tested project demo" };
  assert.equal((await queueCapturedDemo(args)).queued, false);
  const recovered = await execute(process.execPath, [fileURLToPath(new URL("../../../tools/eval/cli.mjs", import.meta.url)),
    "import", "--input", outcome.receiptPath, "--into", f.into, "--out", f.out, "--include-demo"]);
  assert.equal(JSON.parse(recovered.stdout).candidateId, candidate.id);
  assert.equal(JSON.parse(recovered.stdout).queued, false);
  const changed = JSON.parse(captureBytes); changed.source.pageTitle = "Relabeled browser receipt";
  await writeFile(captureFile, JSON.stringify(changed));
  await assert.rejects(queueCapturedDemo(args), /does not bind/);
  assert.equal(await readFile(f.out, "utf8"), saved);
  await writeFile(captureFile, captureBytes);
  const changedEvaluation = structuredClone(receipt); changedEvaluation.evidence.source.commit = "f".repeat(40);
  await writeFile(outcome.receiptPath, JSON.stringify(changedEvaluation));
  await assert.rejects(queueCapturedDemo(args), /invalid-local-evaluation-receipt/);
  assert.equal(await readFile(f.out, "utf8"), saved);
  const { sealEvidence } = await import(new URL("../../../tools/eval/contract.mjs", import.meta.url).href);
  await writeFile(outcome.receiptPath, JSON.stringify(sealEvidence(changedEvaluation.evidence)));
  await assert.rejects(queueCapturedDemo(args), /different review title or media/);
  assert.equal(await readFile(f.out, "utf8"), saved, "changed report under one attempt cannot evade the old decision");
  const docker = await findDockerExecutable();
  const running = await execute(docker, ["ps", "-aq", "--filter", `label=foliage.eval.job=foliage-eval-${receipt.evidence.jobId}`]);
  assert.equal(running.stdout.trim(), "", "job container was actually removed");
});

test("real job browser reports failed tests, unavailable app and cancellation with confirmed teardown", {
  skip: liveImage === undefined ? "Requires the explicitly selected Docker runtime" : false, timeout: 120_000,
}, async t => {
  const f = await fixture(t);
  const { runLocal } = await import(new URL("../../../tools/eval/local.mjs", import.meta.url).href);
  const docker = await findDockerExecutable();
  for (const mode of ["test-failed", "app-unavailable", "external-page", "cancel-recording"]) {
    const controller = new AbortController();
    const output = join(f.root, `${mode}.json`);
    let observedRecording = false;
    const poll = mode === "cancel-recording" ? setInterval(() => {
      void readdir(`${output}.artifacts`).then(names => {
        if (names.some(name => name.startsWith("capture-"))) { observedRecording = true; controller.abort(); }
      }).catch(() => {});
    }, 50) : undefined;
    let receipt;
    try {
      receipt = await runLocal({ repo: f.repo, commit: f.commit, image, docker, output, trustedLocalCode: true, signal: controller.signal,
        scenario: { ...scenario,
          steps: [{ stage: "execute", argv: ["node", "-e", mode === "test-failed" ? "process.exit(7)" : "process.exit(0)"], timeoutMs: 1000 }],
          browser: { argv: ["node", "-e", mode === "app-unavailable" ? "process.exit(9)" :
            `require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Cancellation protocol probe</title>${mode === "external-page" ? '<img src="http://127.0.0.1:4322/outside">' : ''}')}).listen(4321,'127.0.0.1')`],
          port: 4321, path: "/", readyTimeoutMs: 500, durationSeconds: 15 },
        } });
    } finally { clearInterval(poll); }
    assert.equal(receipt.evidence.status, mode === "test-failed" ? "failed" : mode === "cancel-recording" ? "cancelled" : "error");
    assert.equal(receipt.evidence.browser.capture, null);
    assert.equal(receipt.evidence.browser.status, mode === "test-failed" ? "not-run" : mode === "cancel-recording" ? "cancelled" : "error");
    if (mode === "app-unavailable") assert.equal(receipt.evidence.browser.reason, "browser-app-not-ready");
    if (mode === "external-page") {
      assert.equal(receipt.evidence.browser.reason, "external-resource-blocked");
      assert.deepEqual(receipt.evidence.browser.cleanup, { browser: "removed", relay: "removed" });
    }
    if (mode === "cancel-recording") {
      assert.equal(observedRecording, true);
      assert.deepEqual(receipt.evidence.browser.cleanup, { browser: "removed", relay: "removed" });
    }
    assert.equal(receipt.evidence.cleanup.container, "removed");
    const remaining = await execute(docker, ["ps", "-aq", "--filter", `label=foliage.eval.job=foliage-eval-${receipt.evidence.jobId}`]);
    assert.equal(remaining.stdout.trim(), "");
  }
});
