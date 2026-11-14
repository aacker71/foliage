import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseCaptureOrigin, selectedCaptureUrl } from "./assistantCapture.ts";

const entry = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const harvestCli = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const shareCli = fileURLToPath(new URL("../share.mjs", import.meta.url));
const exportCli = fileURLToPath(new URL("../export.mjs", import.meta.url));
const leafServer = fileURLToPath(new URL("../server.mjs", import.meta.url));
const roots: string[] = [];
after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "foliage-mcp-capture-test-"));
  roots.push(root);
  const into = join(root, "leaf.json");
  const out = join(root, "harvest.json");
  await writeFile(into, JSON.stringify({ id: "capture-test", subject: "Capture Test", leaflets: [] }));
  return { root, into, out };
}

async function connect(into: string, out: string, origin?: string, demoBrowser = false) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [entry, "--into", into, "--out", out,
      ...(origin === undefined ? [] : ["--capture-origin", origin]),
      ...(demoBrowser ? ["--allow-demo-browser"] : [])],
    cwd: tmpdir(), stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const client = new Client({ name: "capture-tool-test", version: "1.0.0" });
  try { await client.connect(transport); }
  catch (error) { await transport.close(); throw new Error(`${String(error)} ${stderr}`); }
  return client;
}

async function withLeafServer(into: string, out: string, run: (origin: string) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [leafServer], {
    env: { ...process.env, FOLIAGE_LEAF: into, FOLIAGE_HARVEST: out, HOST: "127.0.0.1", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Leaf server did not start: ${stderr}`)), 20_000);
      child.stdout.on("data", chunk => {
        stdout += String(chunk);
        const found = stdout.match(/\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\/review/);
        if (found) { clearTimeout(timer); resolve(found[1]!); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Leaf server exited ${String(code)}: ${stderr}`)); });
    });
    await run(origin);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise<void>(resolve => child.once("exit", () => resolve()));
  }
}

test("capture authority is an exact owner-pinned loopback origin", () => {
  assert.equal(parseCaptureOrigin("http://127.0.0.1:4296"), "http://127.0.0.1:4296");
  const credentialOrigin = new URL("http://127.0.0.1:4296");
  credentialOrigin.username = "user";
  for (const invalid of ["", "http://127.0.0.1:4296/", "http://127.0.0.1:4296/work",
    "http://localhost:4296", "http://127.0.0.1:4296?x=1", "https://127.0.0.1:4296",
    credentialOrigin.href, "http://127.0.0.1"])
    assert.throws(() => parseCaptureOrigin(invalid), /capture-origin/);
  assert.equal(selectedCaptureUrl("http://127.0.0.1:4296/leaf/photosynthesis#work", "http://127.0.0.1:4296"),
    "http://127.0.0.1:4296/leaf/photosynthesis");
  for (const outside of ["http://127.0.0.1:4297/", "http://localhost:4296/", "https://127.0.0.1:4296/",
    credentialOrigin.href])
    assert.throws(() => selectedCaptureUrl(outside, "http://127.0.0.1:4296"), /pinned capture origin/);
});

test("MCP capture tool is absent by default and refuses another origin before writing", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const ordinary = await connect(f.into, f.out);
  try { assert.ok(!(await ordinary.listTools()).tools.some(tool => tool.name === "foliage_capture_demo")); }
  finally { await ordinary.close(); }

  const ownerEnabled = await connect(f.into, f.out, "http://127.0.0.1:4296");
  try {
    assert.ok(!(await ownerEnabled.listTools()).tools.some(item => item.name === "foliage_open_demo_browser"),
      "page pixels need a separate browser opt-in");
    const tool = (await ownerEnabled.listTools()).tools.find(item => item.name === "foliage_capture_demo");
    assert.equal(tool?.annotations?.readOnlyHint, false);
    assert.equal(tool?.annotations?.destructiveHint, true, "click steps can mutate a local app through GET");
    assert.ok(tool?.inputSchema.properties?.["steps"], "the agent can demonstrate selected page controls");
    const refused = await ownerEnabled.callTool({ name: "foliage_capture_demo",
      arguments: { url: "http://127.0.0.1:4297/" } });
    assert.equal(refused.isError, true);
    assert.equal((refused.structuredContent as Record<string, unknown>)["error"], "origin-refused");
    await assert.rejects(readFile(f.out), { code: "ENOENT" });
  } finally { await ownerEnabled.close(); }
});

test("the MCP launcher rejects an imprecise origin before serving", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const child = spawn(process.execPath, [entry, "--into", f.into, "--out", f.out,
    "--capture-origin", "http://127.0.0.1:4296/work"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", data => { stderr += String(data); });
  const code = await new Promise<number | null>(resolve => child.once("close", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /capture-origin must be an exact/);
  await assert.rejects(readFile(f.out), { code: "ENOENT" });
});

test("page inspection refuses startup without its exact owner-pinned origin", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const child = spawn(process.execPath, [entry, "--into", f.into, "--out", f.out, "--allow-demo-browser"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", data => { stderr += String(data); });
  const code = await new Promise<number | null>(resolve => child.once("close", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /allow-demo-browser requires --capture-origin/);
  await assert.rejects(readFile(f.out), { code: "ENOENT" });
});

test("foliage mcp forwards the boolean demo browser grant to the installed server", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [launcher, "mcp", "--garden", f.root, "--capture-origin", "http://127.0.0.1:4296", "--allow-demo-browser"],
    cwd: tmpdir(), stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const client = new Client({ name: "capture-launcher-test", version: "1.0.0" });
  try {
    await client.connect(transport).catch(error => { throw new Error(`${String(error)} ${stderr}`); });
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("foliage_open_demo_browser"));
    assert.ok(names.includes("foliage_record_demo_browser"));
  } finally { await client.close(); }
});

test("the opt-in agent records a real click and queues its still and video for one review", { timeout: 30_000 }, async t => {
  const f = await fixture();
  const page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><title>Captured tool fixture</title><button id="show" onclick="document.querySelector(\'#result\').textContent=\'Shown\'">Show</button><h1 id="result">Hidden</h1>',
    );
  });
  await new Promise<void>(resolve => page.listen(0, "127.0.0.1", resolve));
  const address = page.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  let client: Client | undefined;
  try {
    client = await connect(f.into, f.out, origin);
    const result = await client.callTool({ name: "foliage_capture_demo", arguments: {
      url: `${origin}/`, durationSeconds: 2,
      steps: [{ action: "click", selector: "#show", atSeconds: 0.5 }],
    } });
    const response = result.structuredContent as Record<string, unknown>;
    if (result.isError && ["browser-unavailable", "encoder-unavailable"].includes(String(response["error"]))) {
      t.skip(String(response["detail"])); return;
    }
    assert.equal(result.isError, undefined, JSON.stringify(response));
    assert.equal(response["approved"], false);
    assert.equal(response["published"], false);
    const receipt = JSON.parse(await readFile(String(response["receiptPath"]), "utf8")) as {
      capture: { startedAt: string; screenshotAt: string; completedAt: string; steps: unknown[] };
    };
    assert.equal(receipt.capture.steps.length, 1);
    assert.ok(Date.parse(receipt.capture.startedAt) <= Date.parse(receipt.capture.screenshotAt));
    assert.ok(Date.parse(receipt.capture.screenshotAt) <= Date.parse(receipt.capture.completedAt));
    const harvest = JSON.parse(await readFile(f.out, "utf8")) as { candidates: { id: string; review: { state: string }; evidence: { ref: string }[]; media: { ref: string; media: { mediaType: string } }[] }[] };
    assert.equal(harvest.candidates.length, 1);
    assert.equal(harvest.candidates[0]?.id, response["candidateId"]);
    assert.equal(harvest.candidates[0]?.review.state, "candidate");
    assert.equal(harvest.candidates[0]?.evidence.length, 2, "one review covers the still and the video");
    assert.deepEqual(harvest.candidates[0]?.media.map(item => item.media.mediaType), ["image/png", "video/mp4"]);
    assert.equal(harvest.candidates[0]?.media[1]?.ref, response["videoRef"]);
    const candidateId = String(response["candidateId"]), videoRef = String(response["videoRef"]);
    await withLeafServer(f.into, f.out, async origin => {
      const reviewVideo = await fetch(`${origin}/review/media/${encodeURIComponent(videoRef)}`);
      assert.equal(reviewVideo.status, 200, "the reviewer can inspect the clip before approving");
      assert.match(reviewVideo.headers.get("content-type") ?? "", /^video\/mp4/);
      assert.deepEqual(Buffer.from(await reviewVideo.arrayBuffer()), await readFile(String(response["videoPath"])));
      const unknown = await fetch(`${origin}/review/media/sha256:${"0".repeat(64)}`);
      assert.equal(unknown.status, 404, "the review route cannot enumerate other stored bytes");
      const publicBeforeShare = await fetch(`${origin}/media/${encodeURIComponent(videoRef)}`);
      assert.equal(publicBeforeShare.status, 404, "a private candidate has no public media address");
    });
    const run = (script: string, args: string[]) => spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8", env: { ...process.env, FOLIAGE_LEAF: f.into },
    });
    const approval = run(harvestCli, ["approve", candidateId, "--by", "Fixture Reviewer", "--doc", f.out]);
    assert.equal(approval.status, 0, approval.stderr);
    const promotion = run(harvestCli, ["promote", "--doc", f.out, "--into", f.into, "--force"]);
    assert.equal(promotion.status, 0, promotion.stderr);
    const beforeShare = run(exportCli, ["--out", join(f.root, "private-export"), "--video", videoRef]);
    assert.notEqual(beforeShare.status, 0, "a reviewed but unshared clip cannot cross");
    const shared = run(shareCli, ["share", candidateId, "--as", "public", "--leaf", f.into]);
    assert.equal(shared.status, 0, shared.stderr);
    await withLeafServer(f.into, f.out, async origin => {
      assert.equal((await fetch(`${origin}/media/${encodeURIComponent(videoRef)}`)).status, 404,
        "sharing the Leaflet alone does not open the unselected clip on the local public route");
      assert.equal((await fetch(`${origin}/my/media/${encodeURIComponent(videoRef)}`)).status, 200,
        "the owner can inspect the retained clip");
    });
    const stillOnly = join(f.root, "still-only");
    const defaultExport = run(exportCli, ["--out", stillOnly]);
    assert.equal(defaultExport.status, 0, defaultExport.stderr);
    assert.equal((await readdir(join(stillOnly, "media"))).some(name => name.endsWith(".mp4")), false,
      "sharing the Leaflet does not silently publish the video");
    const withDemo = join(f.root, "with-demo");
    const selectedExport = run(exportCli, ["--out", withDemo, "--video", videoRef]);
    assert.equal(selectedExport.status, 0, selectedExport.stderr);
    const exportedVideo = await readFile(join(withDemo, "media", `${videoRef.slice(7)}.mp4`));
    assert.deepEqual(exportedVideo, await readFile(String(response["videoPath"])),
      "explicit export carries the exact reviewed MP4 bytes");
  } finally {
    await client?.close();
    page.closeAllConnections();
    await new Promise<void>(resolve => page.close(() => resolve()));
  }
});

test("agent inspects and records the same isolated browser scene into one private review", { timeout: 35_000 }, async t => {
  const f = await fixture();
  const page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><title>Before interaction</title><button id="show" onclick="document.title=\'After interaction\';document.querySelector(\'#result\').textContent=\'Shown\'">Show result</button><h1 id="result">Hidden</h1>',
    );
  });
  await new Promise<void>(resolve => page.listen(0, "127.0.0.1", resolve));
  const address = page.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  let client: Client | undefined;
  try {
    client = await connect(f.into, f.out, origin, true);
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(tools.includes("foliage_open_demo_browser"));
    assert.ok(tools.includes("foliage_check_demo_browser"));
    assert.ok(tools.includes("foliage_record_demo_browser"));
    const opened = await client.callTool({ name: "foliage_open_demo_browser", arguments: { url: `${origin}/` } });
    const first = opened.structuredContent as Record<string, unknown>;
    if (opened.isError && ["browser-unavailable", "encoder-unavailable"].includes(String(first["error"]))) {
      t.skip(String(first["detail"])); return;
    }
    assert.equal(opened.isError, undefined, JSON.stringify(first));
    assert.equal(first["title"], "Before interaction");
    const controls = first["controls"] as { selector: string; name: string }[];
    const show = controls.find(control => control.name === "Show result");
    assert.ok(show?.selector, "the agent can choose a real visible control");
    assert.ok(opened.content.some(item => item.type === "image" && Buffer.from(item.data, "base64")[0] === 137),
      "the agent receives actual page pixels from its private browser");
    const checked = await client.callTool({ name: "foliage_check_demo_browser", arguments: {} });
    assert.equal(checked.isError, undefined, JSON.stringify(checked.structuredContent));
    assert.equal((checked.structuredContent as Record<string, unknown>)["path"], "/");
    assert.equal((checked.structuredContent as Record<string, unknown>)["horizontalOverflowPx"], 0);
    const clicked = await client.callTool({ name: "foliage_click_demo_browser", arguments: { selector: show.selector } });
    assert.equal(clicked.isError, undefined, JSON.stringify(clicked.structuredContent));
    assert.equal((clicked.structuredContent as Record<string, unknown>)["title"], "After interaction");
    const recorded = await client.callTool({ name: "foliage_record_demo_browser", arguments: { durationSeconds: 2 } });
    const result = recorded.structuredContent as Record<string, unknown>;
    if (recorded.isError && result["error"] === "encoder-unavailable") {
      await assert.rejects(readFile(f.out), { code: "ENOENT" });
      t.skip(String(result["detail"])); return;
    }
    assert.equal(recorded.isError, undefined, JSON.stringify(result));
    assert.equal(result["approved"], false);
    assert.equal(result["published"], false);
    const receipt = JSON.parse(await readFile(String(result["receiptPath"]), "utf8")) as { source: { pageTitle: string }; capture: { steps: unknown[]; checks: unknown[] } };
    assert.equal(receipt.source.pageTitle, "After interaction", "recording reused the inspected browser state");
    assert.equal(receipt.capture.checks.length, 1, "the private receipt retains the measured check");
    const harvest = JSON.parse(await readFile(f.out, "utf8")) as { candidates: { title: string; review: { state: string }; evidence: unknown[] }[] };
    assert.equal(harvest.candidates.length, 1);
    assert.equal(harvest.candidates[0]?.title, "After interaction", "observed page title names an untitled capture");
    assert.equal(harvest.candidates[0]?.review.state, "candidate");
    assert.equal(harvest.candidates[0]?.evidence.length, 2);
    const closed = await client.callTool({ name: "foliage_inspect_demo_browser", arguments: {} });
    assert.equal((closed.structuredContent as Record<string, unknown>)["error"], "browser-not-open");
  } finally {
    await client?.close();
    page.closeAllConnections();
    await new Promise<void>(resolve => page.close(() => resolve()));
  }
});

test("agent demo refuses an interaction that writes to the selected app", { timeout: 30_000 }, async t => {
  const f = await fixture();
  let writes = 0;
  const page = createServer((request, response) => {
    if (request.url === "/mutate" && request.method === "POST") { writes++; response.writeHead(204).end(); return; }
    response.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><title>Read-only click fixture</title><button id="mutate" onclick="fetch(\'/mutate\',{method:\'POST\'})">Mutate</button>',
    );
  });
  await new Promise<void>(resolve => page.listen(0, "127.0.0.1", resolve));
  const address = page.address();
  assert.ok(address && typeof address === "object");
  let client: Client | undefined;
  try {
    client = await connect(f.into, f.out, `http://127.0.0.1:${address.port}`);
    const result = await client.callTool({ name: "foliage_capture_demo", arguments: {
      url: `http://127.0.0.1:${address.port}/`, durationSeconds: 2,
      steps: [{ action: "click", selector: "#mutate", atSeconds: 0.5 }],
    } });
    const response = result.structuredContent as Record<string, unknown>;
    if (result.isError && ["browser-unavailable", "encoder-unavailable"].includes(String(response["error"]))) {
      t.skip(String(response["detail"])); return;
    }
    assert.equal(result.isError, true);
    assert.equal(response["error"], "interaction-failed");
    assert.equal(writes, 0);
    await assert.rejects(readFile(f.out), { code: "ENOENT" });
  } finally {
    await client?.close();
    page.closeAllConnections();
    await new Promise<void>(resolve => page.close(() => resolve()));
  }
});
