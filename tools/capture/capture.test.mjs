import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { captureLocalWebDemo, openLocalCaptureSession, parseCaptureOptions, parseLocalUrl } from "./capture.mjs";

const execFileAsync = promisify(execFile);

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("capture accepts only an explicit numeric HTTP loopback origin", () => {
  for (const url of [
    "https://127.0.0.1:3000/", "http://localhost:3000/", "http://127.0.0.2:3000/",
    "http://user:pass@127.0.0.1:3000/", "http://example.com/", "file:///tmp/page.html",
    "http://127.0.0.1/",
  ]) {
    assert.equal(parseLocalUrl(url).ok, false, url);
  }
  assert.equal(parseLocalUrl("http://127.0.0.1:3000/work").ok, true);
  assert.equal(parseLocalUrl("http://[::1]:3000/work").ok, true);
  assert.equal(parseCaptureOptions({ url: "http://127.0.0.1:3000/", outputDir: "/tmp", durationSeconds: 30 }).ok, false);
  assert.equal(parseCaptureOptions({
    url: "http://127.0.0.1:3000/", outputDir: "/tmp",
    steps: [{ action: "click", selector: "#a", atSeconds: 1 }, { action: "click", selector: "#b", atSeconds: 1 }],
  }).ok, false);
});

test("an agent inspects, scrolls, clicks and records the same guarded browser state", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>
<title>Before click</title>
<button id="show" onclick="document.title='After click';document.querySelector('#stage').style.background='linear-gradient(green,blue)'">Show work</button>
<main id="stage" style="height:1500px;background:linear-gradient(red,blue)">Local protocol page</main>`);
  });
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-session-test-"));
  let session;
  try {
    const opened = await openLocalCaptureSession({
      url: `http://127.0.0.1:${port}/?private=unretained`, outputDir, width: 320, height: 240,
    });
    if (!opened.ok && ["browser-unavailable", "encoder-unavailable"].includes(opened.cause)) {
      t.skip(opened.detail);
      return;
    }
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    const initial = await session.inspect();
    assert.equal(initial.ok, true, initial.detail);
    assert.equal(initial.title, "Before click");
    assert.deepEqual(initial.viewport.width, 320);
    assert.deepEqual(initial.viewport.height, 240);
    assert.equal(initial.preview.mimeType, "image/png");
    assert.ok(initial.controls.some(control => control.selector === "#show" && control.name === "Show work"));
    assert.deepEqual((await readdir(outputDir)), [], "inspection does not write a capture");
    const checked = await session.check();
    assert.equal(checked.ok, true, checked.detail);
    assert.equal(checked.readyState, "complete");
    assert.equal(checked.path, "/", "diagnostics omit the selected page's query string");
    assert.equal(checked.horizontalOverflowPx, 0);

    assert.equal((await session.scroll(-1)).cause, "invalid-scroll");
    assert.equal((await session.click("")).cause, "invalid-selector");
    const scrolled = await session.scroll(400);
    assert.equal(scrolled.ok, true, scrolled.detail);
    assert.equal(scrolled.viewport.scrollY, 400);
    assert.equal(scrolled.preview.bytes.equals(initial.preview.bytes), false);
    assert.equal((await session.scroll(0)).ok, true);
    const clicked = await session.click("#show");
    assert.equal(clicked.ok, true, clicked.detail);
    assert.equal(clicked.title, "After click");
    const selected = await session.scroll(400);
    assert.equal(selected.ok, true, selected.detail);
    const recorded = await session.record({ durationSeconds: 2 });
    if (!recorded.ok && recorded.cause === "encoder-unavailable") {
      assert.deepEqual(await readdir(outputDir), [], "missing encoder retains no partial capture");
      t.skip(recorded.detail); return;
    }
    assert.equal(recorded.ok, true, recorded.detail);
    assert.equal(recorded.receipt.source.pageTitle, "After click");
    assert.equal(recorded.receipt.capture.scrollable, true);
    assert.deepEqual(recorded.receipt.capture.checks.map(check => check.path), ["/"],
      "an observed page check stays with the private capture receipt");
    assert.equal(recorded.receipt.privacy.localOnly, true);
    const preparation = recorded.receipt.capture.preparation;
    assert.deepEqual(preparation.map(action => action.action), ["scroll", "scroll", "click", "scroll"]);
    assert.deepEqual(preparation.map(action => action.y ?? action.selector), [400, 0, "#show", 400]);
    assert.deepEqual(preparation.filter(action => action.action === "scroll").map(action => action.requestedY), [400, 0, 400]);
    assert.equal(preparation[0].y, scrolled.viewport.scrollY, "the receipt keeps the observed scroll position");
    assert.ok(preparation.every(action => action.url === `http://127.0.0.1:${port}/` &&
      action.result === "observed" && !Number.isNaN(Date.parse(action.observedAt))),
    "preparation records observed same-origin paths and times without query text");
    assert.ok(preparation.every((action, index) => index === 0 ||
      Date.parse(preparation[index - 1].observedAt) <= Date.parse(action.observedAt)),
    "preparation remains in observed order");
    assert.equal((await readFile(recorded.screenshotPath)).equals(initial.preview.bytes), false,
      "the retained still is from the selected state, not the first viewport");
    assert.equal((await session.record({ durationSeconds: 2 })).cause, "session-recorded");
    assert.equal((await session.close()).ok, true);
    assert.equal((await session.close()).ok, true);
    assert.equal((await session.inspect()).cause, "session-closed");
  } finally {
    await session?.close();
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("agent page check reports measured defects without claiming the app passed", async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/missing.png") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>
<title>Page diagnostics</title><button id="unnamed"></button>
<input id="unnamed-field" value="content is not a label">
<label for="named-field">Project name</label><input id="named-field">
<label>Choose work<select><option>Project</option></select></label>
<button aria-label="See work"></button><a href="/work"><img alt="Open work" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></a>
<div style="width:500px;height:10px"></div><img src="/missing.png" alt="Missing illustration" width="40" height="40">
<script>console.error('fixture error')</script>`);
  });
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-check-test-"));
  let session;
  try {
    const opened = await openLocalCaptureSession({ url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240 });
    if (!opened.ok && ["browser-unavailable", "encoder-unavailable"].includes(opened.cause)) {
      t.skip(opened.detail); return;
    }
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    const checked = await session.check();
    assert.equal(checked.ok, true, checked.detail);
    assert.ok(checked.horizontalOverflowPx >= 180);
    assert.equal(checked.unnamedControlCount, 2);
    assert.deepEqual(checked.unnamedControls, [{ tag: "button", role: null }, { tag: "input", role: null }]);
    assert.equal(checked.brokenImageCount, 1);
    assert.deepEqual(checked.brokenImages, [{ alt: "Missing illustration" }]);
    assert.ok(checked.consoleErrors >= 1);
    assert.ok(checked.httpErrors.some(error => error.status === 404 && error.path === "/missing.png"));
    assert.match(checked.interpretation, /not an assertion/);
    assert.deepEqual(await readdir(outputDir), [], "checking alone retains no files");
  } finally {
    await session?.close();
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("page checks work without an encoder; recording names the missing dependency", async (t) => {
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" })
    .end("<!doctype html><title>Check only</title><main>Ready</main>"));
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-no-encoder-"));
  let session;
  try {
    const opened = await openLocalCaptureSession({
      url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240,
      encoderPath: join(outputDir, "absent-encoder"),
    });
    if (!opened.ok && opened.cause === "browser-unavailable") { t.skip(opened.detail); return; }
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    assert.equal((await session.check()).ok, true);
    const recorded = await session.record({ durationSeconds: 2 });
    assert.equal(recorded.cause, "encoder-unavailable");
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    await session?.close();
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("agent click refuses writes and a new tab without retaining partial captures", async (t) => {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.url === "/write" && request.method === "POST") {
      writes++;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><title>Guard fixture</title><button id="write" onclick="fetch('/write',{method:'POST'})">Write</button><a id="popup" href="/other" target="_blank">Open tab</a>`,
    );
  });
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-session-test-"));
  let session;
  try {
    let opened = await openLocalCaptureSession({ url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240 });
    if (!opened.ok && ["browser-unavailable", "encoder-unavailable"].includes(opened.cause)) {
      t.skip(opened.detail);
      return;
    }
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    assert.equal((await session.click("#popup")).cause, "interaction-failed");
    assert.equal((await session.inspect()).cause, "session-closed");
    opened = await openLocalCaptureSession({ url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240 });
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    assert.equal((await session.click("#write")).cause, "interaction-failed");
    assert.equal(writes, 0);
    assert.deepEqual(await readdir(outputDir), []);
    assert.equal((await session.inspect()).cause, "session-closed");
  } finally {
    await session?.close();
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("agent click requires a currently visible, named control from a fresh inspection", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<title>Visible controls</title><button id="top">Top control</button><div id="plain">Plain text</div><div style="height:1000px"></div><button id="below">Below fold</button>`,
    );
  });
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-session-test-"));
  let session;
  try {
    let opened = await openLocalCaptureSession({ url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240 });
    if (!opened.ok && ["browser-unavailable", "encoder-unavailable"].includes(opened.cause)) {
      t.skip(opened.detail);
      return;
    }
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    const top = await session.inspect();
    assert.equal(top.ok, true, top.detail);
    assert.ok(top.controls.some(control => control.selector === "#top"));
    assert.ok(!top.controls.some(control => control.selector === "#below"));
    assert.equal((await session.click("#below")).cause, "interaction-failed");
    assert.equal((await session.inspect()).cause, "session-closed");

    opened = await openLocalCaptureSession({ url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240 });
    assert.equal(opened.ok, true, opened.detail);
    session = opened.session;
    assert.equal((await session.click("#plain")).cause, "interaction-failed");
    assert.equal((await session.inspect()).cause, "session-closed");
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    await session?.close();
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("an agent session refuses cross-origin page resources before returning observations", async (t) => {
  let otherReads = 0;
  const other = createServer((_request, response) => { otherReads++; response.end("outside origin"); });
  const otherPort = await listen(other);
  const page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<title>Origin guard</title><img src="http://127.0.0.1:${otherPort}/private">`,
    );
  });
  const port = await listen(page);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-session-test-"));
  try {
    const opened = await openLocalCaptureSession({
      url: `http://127.0.0.1:${port}/`, outputDir, width: 320, height: 240,
    });
    if (!opened.ok && ["browser-unavailable", "encoder-unavailable"].includes(opened.cause)) {
      t.skip(opened.detail);
      return;
    }
    assert.deepEqual({ ok: opened.ok, cause: opened.cause }, { ok: false, cause: "external-resource-blocked" });
    assert.equal(opened.cleanup, "removed", "a failed open reports cleanup to its evaluator caller");
    assert.equal(otherReads, 0);
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    await close(page);
    await close(other);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("real local page yields a viewport PNG, MP4, explicit click, and byte digests", async (t) => {
  let clicks = 0;
  const server = createServer((request, response) => {
    if (request.url === "/clicked" && request.method === "POST") {
      clicks++;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>
<title>Protocol capture fixture</title>
<button id="show" onclick="fetch('/clicked',{method:'POST'});document.querySelector('#result').textContent='After click'">Show result</button>
<h1 id="result">Before click</h1><main style="height:1000px;background:linear-gradient(red,blue)">Local page pixels</main>`);
  });
  const port = await listen(server);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-test-"));
  try {
    const result = await captureLocalWebDemo({
      url: `http://127.0.0.1:${port}/`, outputDir, durationSeconds: 2,
      width: 320, height: 240, steps: [{ action: "click", selector: "#show", atSeconds: 0.5 }],
    });
    if (!result.ok && ["browser-unavailable", "encoder-unavailable"].includes(result.cause)) {
      t.skip(result.detail);
      return;
    }
    assert.equal(result.ok, true, result.detail);
    assert.equal(clicks, 1, "the browser made one real, explicitly requested click");
    assert.equal(result.receipt.source.pageTitle, "Protocol capture fixture");
    assert.equal(result.receipt.source.origin, `http://127.0.0.1:${port}`);
    assert.equal(result.receipt.capture.action, "scroll-and-click");
    assert.equal(result.receipt.capture.steps.length, 1);
    assert.equal(result.receipt.capture.scrollable, true);
    assert.equal(result.receipt.privacy.pageRequestsBlocked, 0);
    assert.equal(result.receipt.privacy.localOnly, true);
    assert.deepEqual((await readdir(result.directory)).sort(), [".gitignore", "demo.mp4", "receipt.json", "screenshot.png"]);
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
    for (const path of [result.screenshotPath, result.videoPath, result.receiptPath]) {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }

    const screenshot = await readFile(result.screenshotPath);
    assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(screenshot.readUInt32BE(16), 320);
    assert.equal(screenshot.readUInt32BE(20), 240);
    const video = await readFile(result.videoPath);
    assert.equal(video.toString("ascii", 4, 8), "ftyp");
    const { stdout: decoded } = await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", result.videoPath, "-f", "framemd5", "pipe:1",
    ]);
    const frames = decoded.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
    assert.equal(frames.length, result.receipt.capture.frameCount);
    assert.ok(new Set(frames.map((line) => line.split(",").at(-1)?.trim())).size > 1,
      "recorded frames show real change as the page scrolls or responds to the click");
    for (const [kind, bytes] of [["screenshot", screenshot], ["video", video]]) {
      assert.equal(result.receipt.artifacts[kind].bytes, bytes.length);
      assert.equal(result.receipt.artifacts[kind].sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    }
    assert.deepEqual(JSON.parse(await readFile(result.receiptPath, "utf8")), result.receipt);
  } finally {
    await close(server);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("a page's cross-origin subresource never reaches even another loopback server", async (t) => {
  let otherReads = 0;
  const other = createServer((_request, response) => { otherReads++; response.end("not reached"); });
  const otherPort = await listen(other);
  const page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<title>Origin guard fixture</title><img src="http://127.0.0.1:${otherPort}/probe">`,
    );
  });
  const port = await listen(page);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-test-"));
  try {
    const result = await captureLocalWebDemo({
      url: `http://127.0.0.1:${port}/`, outputDir, durationSeconds: 2, width: 320, height: 240,
    });
    if (!result.ok && ["browser-unavailable", "encoder-unavailable"].includes(result.cause)) {
      t.skip(result.detail);
      return;
    }
    assert.deepEqual({ ok: result.ok, cause: result.cause }, { ok: false, cause: "external-resource-blocked" });
    assert.equal(otherReads, 0);
    assert.deepEqual(await readdir(outputDir), [], "failed capture retains no misleading artifact");
  } finally {
    await close(page);
    await close(other);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("cross-origin redirect never reaches its destination", async (t) => {
  let destinationReads = 0;
  const destination = createServer((_request, response) => { destinationReads++; response.end("not reached"); });
  const destinationPort = await listen(destination);
  const source = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${destinationPort}/landing` }).end();
  });
  const sourcePort = await listen(source);
  const outputDir = await mkdtemp(join(tmpdir(), "foliage-capture-test-"));
  try {
    const result = await captureLocalWebDemo({
      url: `http://127.0.0.1:${sourcePort}/`, outputDir, durationSeconds: 2, width: 320, height: 240,
    });
    if (!result.ok && ["browser-unavailable", "encoder-unavailable"].includes(result.cause)) {
      t.skip(result.detail);
      return;
    }
    assert.equal(result.ok, false);
    assert.ok(["navigation-failed", "external-resource-blocked"].includes(result.cause), result.detail);
    assert.equal(destinationReads, 0);
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    await close(source);
    await close(destination);
    await rm(outputDir, { recursive: true, force: true });
  }
});
