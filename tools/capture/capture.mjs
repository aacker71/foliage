#!/usr/bin/env node
/**
 * Capture the pixels of one owner-selected loopback web page. Scroll is the default gesture;
 * callers may explicitly select a bounded set of timed clicks. There are no model-written
 * claims, uploads, or external page requests.
 *
 * This is deliberately a local source adapter. The PNG and MP4 remain private until Review;
 * later public video selection is a separate owner action.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpClient } from "./cdp.mjs";

const DEFAULT_SECONDS = 6;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const FRAME_RATE = 6;
const MAX_SECONDS = 15;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const BROWSER_START_MS = 12_000;
const NAVIGATION_MS = 20_000;
const MAX_CAPTURE_WALL_MS = 45_000;
const MAX_SESSION_IDLE_MS = 5 * 60_000;
const MAX_INSPECT_CONTROLS = 40;
const MAX_INSPECT_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_SCROLL_Y = 100_000;
const MAX_PREPARATION_ACTIONS = 20;
const MAX_DIAGNOSTIC_CHECKS = 10;
const MAX_DIAGNOSTIC_ISSUES = 10;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

class CaptureError extends Error {
  constructor(cause, detail) {
    super(detail);
    this.cause = cause;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const detailOf = (error) => error instanceof Error ? error.message : String(error);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function waitBounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A numeric loopback host avoids DNS, rebinding, credentials, and ambiguous aliases. */
export function parseLocalUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, cause: "invalid-url", detail: "--url must be an explicit http://127.0.0.1:<port> or http://[::1]:<port> URL." };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, cause: "invalid-url", detail: "--url is not a valid URL." };
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.port === "" || Number(parsed.port) < 1 || parsed.username !== "" || parsed.password !== "") {
    return {
      ok: false,
      cause: "invalid-url",
      detail: "Only explicit HTTP numeric loopback URLs with a port and no URL credentials are accepted.",
    };
  }
  parsed.hash = "";
  return { ok: true, url: parsed.href, origin: parsed.origin };
}

/** Validate before any browser or filesystem side effect. */
export function parseCaptureOptions(options) {
  if (options === null || typeof options !== "object") {
    return { ok: false, cause: "invalid-options", detail: "Capture options must be an object." };
  }
  const target = parseLocalUrl(options.url);
  if (!target.ok) return target;
  if (typeof options.outputDir !== "string" || options.outputDir.trim() === "") {
    return { ok: false, cause: "invalid-options", detail: "outputDir is required." };
  }
  const durationSeconds = options.durationSeconds ?? DEFAULT_SECONDS;
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 2 || durationSeconds > MAX_SECONDS) {
    return { ok: false, cause: "invalid-options", detail: `durationSeconds must be an integer from 2 to ${MAX_SECONDS}.` };
  }
  if (!Number.isInteger(width) || width < 320 || width > MAX_WIDTH || width % 2 !== 0 ||
      !Number.isInteger(height) || height < 240 || height > MAX_HEIGHT || height % 2 !== 0) {
    return { ok: false, cause: "invalid-options", detail: `width and height must be even integers from 320×240 through ${MAX_WIDTH}×${MAX_HEIGHT}.` };
  }
  const steps = options.steps ?? [];
  if (options.readOnlyInteractions !== undefined && typeof options.readOnlyInteractions !== "boolean") {
    return { ok: false, cause: "invalid-options", detail: "readOnlyInteractions must be boolean." };
  }
  if (!Array.isArray(steps) || steps.length > 5) {
    return { ok: false, cause: "invalid-options", detail: "steps must be an array of at most five explicit click instructions." };
  }
  let previous = -1;
  for (const [index, step] of steps.entries()) {
    if (step === null || typeof step !== "object" || Array.isArray(step) ||
        Object.keys(step).some((key) => !["action", "selector", "atSeconds"].includes(key)) ||
        step.action !== "click" || typeof step.selector !== "string" ||
        step.selector.trim() === "" || step.selector.length > 200 || /[\u0000-\u001f\u007f]/.test(step.selector) ||
        typeof step.atSeconds !== "number" || !Number.isFinite(step.atSeconds) ||
        step.atSeconds < 0 || step.atSeconds > durationSeconds - 1 / FRAME_RATE || step.atSeconds <= previous) {
      return { ok: false, cause: "invalid-options", detail: `steps[${index}] must be {action:"click",selector:<CSS up to 200 characters>,atSeconds:<increasing number before the final video frame>}.` };
    }
    previous = step.atSeconds;
  }
  for (const key of ["browserPath", "encoderPath"]) {
    if (options[key] !== undefined && (typeof options[key] !== "string" || !isAbsolute(options[key]))) {
      return { ok: false, cause: "invalid-options", detail: `${key} must be an absolute executable path.` };
    }
  }
  return {
    ok: true,
    url: target.url,
    origin: target.origin,
    outputDir: resolve(options.outputDir),
    durationSeconds,
    width,
    height,
    steps: steps.map((step) => ({ action: "click", selector: step.selector.trim(), atSeconds: step.atSeconds })),
    readOnlyInteractions: options.readOnlyInteractions === true,
    browserPath: options.browserPath,
    encoderPath: options.encoderPath,
  };
}

async function findExecutable(names, explicit, fallback = []) {
  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  const candidates = explicit ? [explicit] : [
    ...names.flatMap((name) => pathDirs.map((dir) => join(dir, name))),
    ...fallback,
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching; absence becomes a named capture failure below.
    }
  }
  return null;
}

async function waitForDevTools(profile, child, stderr) {
  const path = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + BROWSER_START_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new CaptureError("browser-start-failed", `Chrome exited before DevTools started: ${stderr().slice(-500)}`);
    }
    try {
      const [port, route] = (await readFile(path, "utf8")).trim().split("\n");
      if (/^\d+$/.test(port ?? "") && route?.startsWith("/devtools/browser/")) {
        return `ws://127.0.0.1:${port}${route}`;
      }
    } catch {
      // Chrome has not finished starting.
    }
    await delay(100);
  }
  throw new CaptureError("browser-start-failed", `Chrome did not open DevTools within ${BROWSER_START_MS}ms: ${stderr().slice(-500)}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  await waitBounded(ended, 2_000);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitBounded(ended, 2_000);
  }
}

/** Every Chrome socket passes this proxy; it forwards only the selected numeric origin. */
async function startOriginProxy(origin, onBlocked, inReadOnlyInteraction, onWriteBlocked) {
  const selected = new URL(origin);
  let forwarded = 0;
  const sockets = new Set();
  const proxy = createServer((incoming, outgoing) => {
    incoming.on("error", () => outgoing.destroy());
    outgoing.on("error", () => incoming.destroy());
    let address;
    try { address = new URL(incoming.url, origin); }
    catch { onBlocked(); outgoing.writeHead(400).end(); return; }
    if (address.origin !== origin) {
      onBlocked();
      outgoing.writeHead(403, { "content-type": "text/plain" }).end("Capture permits only the selected loopback origin.");
      return;
    }
    if (inReadOnlyInteraction() && !["GET", "HEAD"].includes(incoming.method)) {
      onWriteBlocked();
      outgoing.writeHead(403, { "content-type": "text/plain" }).end("Demo interaction blocked a non-GET request.");
      return;
    }
    forwarded++;
    const upstream = httpRequest({
      hostname: selected.hostname.replace(/^\[|\]$/g, ""),
      port: Number(selected.port),
      path: `${address.pathname}${address.search}`,
      method: incoming.method,
      headers: { ...incoming.headers, host: selected.host },
      timeout: 15_000,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("local page request timed out")));
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  // CONNECT and WebSocket upgrade cannot silently bypass the origin check.
  proxy.on("connect", (_request, socket) => {
    socket.on("error", () => {});
    onBlocked();
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  proxy.on("upgrade", (_request, socket) => {
    socket.on("error", () => {});
    onBlocked();
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  proxy.on("clientError", (_error, socket) => {
    socket.on("error", () => {});
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  return { server: proxy, port: proxy.address().port, forwarded: () => forwarded, sockets };
}

function evaluate(client, sessionId, expression) {
  return client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  }, sessionId).then((answer) => {
    if (answer.exceptionDetails) throw new CaptureError("page-failed", "The page rejected a read-only capture inspection.");
    return answer.result?.value;
  });
}

async function waitForPage(client, sessionId, origin) {
  const deadline = Date.now() + NAVIGATION_MS;
  while (Date.now() < deadline) {
    let state;
    try {
      state = await evaluate(client, sessionId, "({ready:document.readyState,url:location.href,width:innerWidth,height:innerHeight})");
    } catch {
      // A same-origin navigation can briefly destroy the execution context.
      await delay(150);
      continue;
    }
    if (state?.ready === "complete") {
      let final;
      try { final = new URL(state.url); } catch { /* Report below. */ }
      if (!final || final.origin !== origin) {
        throw new CaptureError("navigation-failed", "The page left the selected loopback origin, so capture stopped.");
      }
      return state;
    }
    await delay(150);
  }
  throw new CaptureError("navigation-timed-out", `The selected page did not finish loading within ${NAVIGATION_MS}ms.`);
}

async function fileFact(path, file, mimeType) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new CaptureError("capture-failed", `${file} is empty.`);
  return { file, mimeType, bytes: bytes.length, sha256: digest(bytes) };
}

function encoderArgs(videoPath) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-f", "image2pipe", "-framerate", String(FRAME_RATE), "-vcodec", "mjpeg", "-i", "pipe:0",
    "-an", "-map_metadata", "-1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath,
  ];
}

async function clickSelector(client, sessionId, step) {
  const document = await client.send("DOM.getDocument", { depth: 1 }, sessionId);
  const selected = await client.send("DOM.querySelector", {
    nodeId: document.root.nodeId, selector: step.selector,
  }, sessionId);
  if (!selected.nodeId) {
    throw new CaptureError("interaction-failed", `Explicit selector ${JSON.stringify(step.selector)} matched no element.`);
  }
  const attributes = await client.send("DOM.getAttributes", { nodeId: selected.nodeId }, sessionId);
  for (let i = 0; i < (attributes.attributes?.length ?? 0); i += 2) {
    if (attributes.attributes[i] === "target" && attributes.attributes[i + 1] === "_blank") {
      throw new CaptureError("interaction-failed", `Explicit selector ${JSON.stringify(step.selector)} opens a new tab, which this capture does not record.`);
    }
  }
  await client.send("DOM.scrollIntoViewIfNeeded", { nodeId: selected.nodeId }, sessionId);
  const box = await client.send("DOM.getBoxModel", { nodeId: selected.nodeId }, sessionId);
  const quad = box.model?.content;
  if (!Array.isArray(quad) || quad.length !== 8) {
    throw new CaptureError("interaction-failed", `Explicit selector ${JSON.stringify(step.selector)} has no visible box to click.`);
  }
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
}

async function encodeFrames(client, sessionId, encoderPath, videoPath, frameCount, startScroll, scrollMax, steps, beforeClick) {
  const encoder = spawn(encoderPath, encoderArgs(videoPath), { stdio: ["pipe", "ignore", "pipe"] });
  let encoderError = null;
  let stderr = "";
  encoder.on("error", (error) => { encoderError = error; });
  encoder.stdin.on("error", () => { /* The write callback carries the failure. */ });
  encoder.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
  const ended = new Promise((resolve) => encoder.once("close", (code) => resolve(code)));
  const started = performance.now();
  const executed = [];
  let nextStep = 0;
  try {
    for (let i = 0; i < frameCount; i++) {
      if (performance.now() - started > MAX_CAPTURE_WALL_MS) {
        throw new CaptureError("capture-timed-out", `Video capture exceeded ${MAX_CAPTURE_WALL_MS}ms; no partial demo was retained.`);
      }
      await delay(Math.max(0, started + i * 1_000 / FRAME_RATE - performance.now()));
      while (nextStep < steps.length && steps[nextStep].atSeconds <= i / FRAME_RATE) {
        const step = steps[nextStep++];
        beforeClick();
        await clickSelector(client, sessionId, step);
        executed.push({ ...step, executedAtSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)) });
      }
      // The recording depicts only the selected page, scrolling through its actual rendered work.
      const progress = frameCount === 1 ? 0 : i / (frameCount - 1);
      const fraction = Math.max(0, Math.min(1, (progress - 0.12) / 0.76));
      const y = Math.round(startScroll + (scrollMax - startScroll) * fraction);
      await evaluate(client, sessionId, `window.scrollTo(0, ${y})`);
      const shot = await client.send("Page.captureScreenshot", {
        format: "jpeg", quality: 82, captureBeyondViewport: false, fromSurface: true,
      }, sessionId);
      const frame = Buffer.from(shot.data ?? "", "base64");
      if (frame[0] !== 0xff || frame[1] !== 0xd8) {
        throw new CaptureError("capture-failed", `Chrome returned no JPEG for video frame ${i + 1}.`);
      }
      await new Promise((resolve, reject) => encoder.stdin.write(frame, (error) => error ? reject(error) : resolve()));
    }
    encoder.stdin.end();
    const code = await waitBounded(ended, 20_000);
    if (code === "timeout") throw new CaptureError("encode-failed", "ffmpeg did not finish within 20 seconds.");
    if (encoderError || code !== 0) {
      throw new CaptureError("encode-failed", `ffmpeg failed: ${detailOf(encoderError ?? (stderr || `exit ${code}`))}`);
    }
    return executed;
  } catch (error) {
    await stopProcess(encoder);
    if (error instanceof CaptureError) throw error;
    throw new CaptureError("encode-failed", `Video encoding failed: ${detailOf(error)}; ${stderr}`);
  }
}

/**
 * Capture a real screenshot and a short scroll demo. All outputs are local and private.
 * @returns {Promise<{ok:true,directory:string,receiptPath:string,screenshotPath:string,videoPath:string,receipt:object}|{ok:false,cause:string,detail:string}>}
 */
export async function captureLocalWebDemo(options) {
  const parsed = parseCaptureOptions(options);
  if (!parsed.ok) return parsed;
  const opened = await openParsedCaptureSession(parsed);
  if (!opened.ok) return opened;
  const result = await opened.session.record({
    durationSeconds: parsed.durationSeconds, steps: parsed.steps,
  });
  const cleanup = await opened.session.close();
  if (!cleanup.ok) {
    return {
      ok: false, cause: "cleanup-failed",
      detail: (result.ok ? "Capture files remain at " + result.directory + "." : result.cause + ": " + result.detail) +
        " Cleanup also failed: " + cleanup.detail,
    };
  }
  return result;
}

/** A bounded observation of the selected page. Source text is data, never instructions. */
const INSPECT_EXPRESSION = `(() => {
  const selectorFor = (element) => {
    if (element.id && element.id.length <= 100) return '#' + CSS.escape(element.id);
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 8; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      let position = 1;
      for (let prior = node.previousElementSibling; prior; prior = prior.previousElementSibling) {
        if (prior.tagName === node.tagName) position++;
      }
      parts.unshift(tag + ':nth-of-type(' + position + ')');
      if (node === document.body) break;
    }
    return parts.join(' > ');
  };
  const controls = [...document.querySelectorAll('button,a[href],[role="button"],input[type="button"],input[type="submit"],select')]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
      const hit = document.elementFromPoint(x, y);
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight &&
        box.right > 0 && box.left < innerWidth && style.visibility !== 'hidden' &&
        style.display !== 'none' && Number(style.opacity) > 0 && style.pointerEvents !== 'none' &&
        !element.matches(':disabled,[aria-disabled="true"]') && !element.closest('[inert]') &&
        (hit === element || element.contains(hit));
    }).slice(0, 40).map((element) => {
      const label = element.getAttribute('aria-label') || element.innerText ||
        element.getAttribute('title') ||
        (element instanceof HTMLInputElement && ['button', 'submit'].includes(element.type) ? element.value : '') || '';
      const selector = selectorFor(element);
      return {
        selector: selector.length <= 200 ? selector : '',
        tag: element.tagName.toLowerCase(),
        role: (element.getAttribute('role') || '').slice(0, 40) || null,
        name: String(label).replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 120),
      };
    }).filter((control) => control.selector && control.name);
  return {
    url: location.href,
    title: document.title.replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 160) || null,
    viewport: {
      width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    },
    controls,
  };
})()`;

/** Mechanical page observations. They are not a verdict about quality or authorship. */
const DIAGNOSTIC_EXPRESSION = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight &&
      box.right > 0 && box.left < innerWidth && style.visibility !== 'hidden' &&
      style.display !== 'none' && Number(style.opacity) > 0 && !element.closest('[inert]');
  };
  const unnamed = [...document.querySelectorAll('button,a[href],[role="button"],input:not([type="hidden"]),select,textarea')]
    .filter((element) => visible(element) && !element.matches(':disabled,[aria-disabled="true"]'))
    .filter((element) => {
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent || '').join(' ');
      const nativeLabels = element.labels ? [...element.labels].map((label) => label.textContent).join(' ') : '';
      const formField = element.matches('input,select,textarea');
      const content = formField ? '' : element.innerText || element.querySelector('img[alt]')?.getAttribute('alt') || '';
      const name = element.getAttribute('aria-label') || labelledBy || nativeLabels || content ||
        element.getAttribute('title') ||
        (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type) ? element.value : '') || '';
      return !String(name).trim();
    });
  const unnamedControls = unnamed.slice(0, ${MAX_DIAGNOSTIC_ISSUES}).map((element) => ({
      tag: element.tagName.toLowerCase().slice(0, 40),
      role: (element.getAttribute('role') || '').slice(0, 40) || null,
    }));
  const broken = [...document.images].filter((image) => visible(image) && image.currentSrc &&
    image.complete && image.naturalWidth === 0);
  const brokenImages = broken.slice(0, ${MAX_DIAGNOSTIC_ISSUES}).map((image) => ({
      alt: (image.alt || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').slice(0, 80),
    }));
  return {
    readyState: document.readyState,
    horizontalOverflowPx: Math.max(0, Math.ceil(Math.max(document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0) - innerWidth)),
    unnamedControlCount: unnamed.length,
    unnamedControls,
    brokenImageCount: broken.length,
    brokenImages,
  };
})()`;

const captureFailure = (error) => error instanceof CaptureError
  ? { ok: false, cause: error.cause, detail: error.message }
  : { ok: false, cause: "capture-failed", detail: detailOf(error) };

/**
 * Open one guarded Chrome page for an agent to inspect and record. The returned session exposes
 * only bounded observations and actions; it never exposes a CDP socket or arbitrary page script.
 */
export async function openLocalCaptureSession(options) {
  if (options === null || typeof options !== "object") {
    return { ok: false, cause: "invalid-options", detail: "Capture options must be an object." };
  }
  const parsed = parseCaptureOptions({
    ...options, durationSeconds: DEFAULT_SECONDS, steps: [], readOnlyInteractions: true,
  });
  if (!parsed.ok) return parsed;
  return openParsedCaptureSession(parsed);
}

async function openParsedCaptureSession(parsed) {
  const browserPath = await findExecutable(["google-chrome", "chromium", "chrome"], parsed.browserPath, [CHROME_MAC]);
  if (browserPath === null) return { ok: false, cause: "browser-unavailable", detail: "Chrome or Chromium is not executable. Supply browserPath." };

  let profile = null;
  let browser = null;
  let client = null;
  let proxy = null;
  let sessionId = null;
  let targetId = null;
  let idleTimer = null;
  let closed = false;
  let closePromise = null;
  let busy = false;
  let recorded = false;
  let pageBlocked = 0;
  let writeBlocked = 0;
  let proxyBlocked = 0;
  let newTab = false;
  let requestHandlingError = null;
  let readOnlyPhase = false;
  const preparation = [];
  const checks = [];
  const browserIssues = { consoleErrors: 0, pageExceptions: 0, failedRequests: 0, httpErrors: [] };

  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(idleTimer);
    closePromise = (async () => {
      const failures = [];
      client?.close();
      try { await stopProcess(browser); } catch (error) { failures.push(`Chrome: ${detailOf(error)}`); }
      if (proxy !== null) {
        try {
          for (const socket of proxy.sockets) socket.destroy();
          proxy.server.closeAllConnections();
          await new Promise((resolve) => proxy.server.close(resolve));
        } catch (error) { failures.push(`origin guard: ${detailOf(error)}`); }
      }
      if (profile !== null) {
        try { await rm(profile, { recursive: true, force: true }); }
        catch (error) { failures.push(`Chrome profile ${profile}: ${detailOf(error)}`); }
      }
      return failures.length > 0
        ? { ok: false, cause: "cleanup-failed", detail: failures.join("; ") }
        : { ok: true };
    })();
    return closePromise;
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void close(); }, MAX_SESSION_IDLE_MS);
    idleTimer.unref?.();
  };
  const ensureSafe = async () => {
    if (requestHandlingError) throw new CaptureError("request-guard-failed", detailOf(requestHandlingError));
    if (pageBlocked > 0) throw new CaptureError("external-resource-blocked", `${pageBlocked} page request(s) left the selected loopback origin.`);
    if (writeBlocked > 0) throw new CaptureError("interaction-failed", `${writeBlocked} page write request(s) followed a click.`);
    if (newTab) throw new CaptureError("interaction-failed", "The page opened another tab, which this capture does not inspect or record.");
    const currentUrl = await evaluate(client, sessionId, "location.href");
    let origin;
    try { origin = new URL(currentUrl).origin; } catch { /* Refuse below. */ }
    if (origin !== parsed.origin) throw new CaptureError("navigation-failed", "The page left the selected loopback origin.");
  };
  const inspectPage = async () => {
    await ensureSafe();
    const observed = await evaluate(client, sessionId, INSPECT_EXPRESSION);
    if (!observed || observed.url === undefined || observed.viewport?.width !== parsed.width ||
        observed.viewport?.height !== parsed.height || !Array.isArray(observed.controls) ||
        observed.controls.length > MAX_INSPECT_CONTROLS) {
      throw new CaptureError("capture-failed", "Chrome returned an invalid page inspection.");
    }
    const shot = await client.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: false, fromSurface: true,
    }, sessionId);
    const bytes = Buffer.from(shot.data ?? "", "base64");
    if (bytes.length > MAX_INSPECT_PREVIEW_BYTES || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new CaptureError("capture-failed", "Chrome returned an invalid or oversized PNG preview.");
    }
    await ensureSafe();
    return { ok: true, ...observed, preview: { mimeType: "image/png", bytes } };
  };
  const notePreparation = (action, input, observed) => {
    const current = new URL(observed.url);
    if (current.origin !== parsed.origin) throw new CaptureError("navigation-failed", "Preparation left the selected origin.");
    // A path identifies the observed local scene without retaining query or fragment secrets.
    const url = current.origin + current.pathname;
    if (url.length > 2_048) throw new CaptureError("interaction-failed", "Observed local URL is too long for a private capture receipt.");
    preparation.push({ action, ...input, observedAt: new Date().toISOString(), url, result: "observed" });
  };
  const operate = async (work) => {
    if (closed) return { ok: false, cause: "session-closed", detail: "The capture browser has closed. Open a new session." };
    if (busy) return { ok: false, cause: "session-busy", detail: "The capture browser is already working." };
    busy = true;
    touch();
    try { return await work(); }
    catch (error) {
      const failure = captureFailure(error);
      const cleanup = await close();
      return cleanup.ok ? failure : { ...failure, detail: `${failure.detail} Cleanup also failed: ${cleanup.detail}` };
    } finally { busy = false; }
  };

  try {
    profile = await mkdtemp(join(tmpdir(), "foliage-capture-chrome-"));
    await chmod(profile, 0o700);
    proxy = await startOriginProxy(parsed.origin, () => { proxyBlocked++; },
      () => parsed.readOnlyInteractions && readOnlyPhase, () => { writeBlocked++; });
    let browserStderr = "";
    browser = spawn(browserPath, [
      "--headless=new", "--no-first-run", "--disable-extensions", "--disable-background-networking",
      "--disable-default-apps", "--disable-sync", "--disable-component-update",
      "--disable-quic", "--dns-prefetch-disable",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--proxy-server=http://127.0.0.1:${proxy.port}`, "--proxy-bypass-list=<-loopback>",
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    browser.on("error", (error) => { browserStderr = `${browserStderr}\n${detailOf(error)}`.slice(-4_000); });
    browser.stderr.on("data", (chunk) => { browserStderr = (browserStderr + chunk.toString()).slice(-4_000); });
    client = await CdpClient.connect(await waitForDevTools(profile, browser, () => browserStderr));
    const targets = await client.send("Target.getTargets");
    const pageTarget = targets.targetInfos?.find((target) => target.type === "page" && target.url === "about:blank");
    targetId = pageTarget?.targetId ?? (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
    ({ sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true }));
    client.on("Target.targetCreated", (event) => {
      const target = event.targetInfo;
      if (target?.type !== "page" || target.targetId === targetId) return;
      newTab = true;
      client.send("Target.closeTarget", { targetId: target.targetId }).catch((error) => { requestHandlingError = error; });
    });
    await client.send("Target.setDiscoverTargets", { discover: true });
    client.on("Fetch.requestPaused", (request, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      let allowed = false;
      try { allowed = new URL(request.request.url).origin === parsed.origin; } catch { /* Refuse. */ }
      if (!allowed) pageBlocked++;
      client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: request.requestId,
        ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
      }, sessionId).catch((error) => { requestHandlingError = error; });
    });
    client.on("Runtime.consoleAPICalled", (event, eventSessionId) => {
      if (eventSessionId === sessionId && event.type === "error") browserIssues.consoleErrors++;
    });
    client.on("Runtime.exceptionThrown", (_event, eventSessionId) => {
      if (eventSessionId === sessionId) browserIssues.pageExceptions++;
    });
    client.on("Network.loadingFailed", (event, eventSessionId) => {
      if (eventSessionId === sessionId && !event.canceled) browserIssues.failedRequests++;
    });
    client.on("Network.responseReceived", (event, eventSessionId) => {
      if (eventSessionId !== sessionId || !event.response || event.response.status < 400 ||
          browserIssues.httpErrors.length >= MAX_DIAGNOSTIC_ISSUES) return;
      try {
        const url = new URL(event.response.url);
        if (url.origin === parsed.origin) browserIssues.httpErrors.push({
          status: event.response.status, path: url.pathname.slice(0, 160),
        });
      } catch { /* An invalid response URL contributes no path. */ }
    });
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    await client.send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const denied = () => { throw new Error("Capture disables live network channels"); };
      for (const name of ["WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
        try { Object.defineProperty(window, name, { value: denied, configurable: false }); } catch {}
      }
      try { Object.defineProperty(navigator, "sendBeacon", { value: () => false, configurable: false }); } catch {}
      try { Object.defineProperty(window, "open", { value: () => null, configurable: false }); } catch {}
    })();` }, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: parsed.width, height: parsed.height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const navigation = await client.send("Page.navigate", { url: parsed.url }, sessionId, NAVIGATION_MS);
    if (navigation.errorText) throw new CaptureError("navigation-failed", `The selected page could not load: ${navigation.errorText}`);
    const page = await waitForPage(client, sessionId, parsed.origin);
    if (page.width !== parsed.width || page.height !== parsed.height) {
      throw new CaptureError("capture-failed", `Chrome reported ${page.width}×${page.height}, not the requested ${parsed.width}×${parsed.height} viewport.`);
    }
    await delay(500);
    await ensureSafe();
    if (proxy.forwarded() === 0) throw new CaptureError("request-guard-failed", "Chrome did not route the selected page through its origin guard.");
    touch();
  } catch (error) {
    const failure = captureFailure(error);
    const cleanup = await close();
    return cleanup.ok ? { ...failure, cleanup: "removed" } :
      { ...failure, cleanup: "unconfirmed", detail: `${failure.detail} Cleanup also failed: ${cleanup.detail}` };
  }

  const session = {
    inspect: () => operate(inspectPage),
    check: () => operate(async () => {
      await ensureSafe();
      if (checks.length >= MAX_DIAGNOSTIC_CHECKS) {
        return { ok: false, cause: "check-limit", detail: "This browser session reached its page-check limit." };
      }
      const page = await evaluate(client, sessionId, DIAGNOSTIC_EXPRESSION);
      if (!page || !["loading", "interactive", "complete"].includes(page.readyState) ||
          !Number.isSafeInteger(page.horizontalOverflowPx) || page.horizontalOverflowPx < 0 ||
          !Number.isSafeInteger(page.unnamedControlCount) || page.unnamedControlCount < page.unnamedControls?.length ||
          !Number.isSafeInteger(page.brokenImageCount) || page.brokenImageCount < page.brokenImages?.length ||
          !Array.isArray(page.unnamedControls) || !Array.isArray(page.brokenImages) ||
          page.unnamedControls.length > MAX_DIAGNOSTIC_ISSUES || page.brokenImages.length > MAX_DIAGNOSTIC_ISSUES) {
        throw new CaptureError("capture-failed", "Chrome returned invalid page diagnostics.");
      }
      await ensureSafe();
      const current = new URL(await evaluate(client, sessionId, "location.href"));
      const report = {
        observedAt: new Date().toISOString(), path: current.pathname.slice(0, 160),
        ...page,
        consoleErrors: browserIssues.consoleErrors,
        pageExceptions: browserIssues.pageExceptions,
        failedRequests: browserIssues.failedRequests,
        httpErrors: [...browserIssues.httpErrors],
      };
      checks.push(report);
      return { ok: true, ...report, interpretation: "Browser errors are cumulative since this session opened. These are observations, not an assertion that the app works or that its owner built it." };
    }),
    scroll: (y) => {
      if (!Number.isInteger(y) || y < 0 || y > MAX_SCROLL_Y) {
        return Promise.resolve({ ok: false, cause: "invalid-scroll", detail: `Scroll position must be an integer from 0 to ${MAX_SCROLL_Y}.` });
      }
      return operate(async () => {
        await ensureSafe();
        if (preparation.length >= MAX_PREPARATION_ACTIONS) throw new CaptureError("interaction-failed", "This browser session reached its preparation action limit.");
        const geometry = await evaluate(client, sessionId,
          "({scrollHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),height:innerHeight})");
        const maximum = Math.max(0, Number(geometry.scrollHeight) - Number(geometry.height));
        if (y > maximum) return { ok: false, cause: "invalid-scroll", detail: `This page can scroll to ${maximum}px.` };
        await evaluate(client, sessionId, `window.scrollTo(0, ${y})`);
        await delay(120);
        const observed = await inspectPage();
        notePreparation("scroll", { y: observed.viewport.scrollY, requestedY: y }, observed);
        return observed;
      });
    },
    click: (selector) => {
      if (typeof selector !== "string" || selector.trim() === "" || selector.length > 200 ||
          /[\u0000-\u001f\u007f]/.test(selector)) {
        return Promise.resolve({ ok: false, cause: "invalid-selector", detail: "Choose one CSS selector of at most 200 characters." });
      }
      return operate(async () => {
        await ensureSafe();
        if (preparation.length >= MAX_PREPARATION_ACTIONS) throw new CaptureError("interaction-failed", "This browser session reached its preparation action limit.");
        const before = await inspectPage();
        if (!before.controls.some((control) => control.selector === selector.trim() && control.name)) {
          throw new CaptureError("interaction-failed", "Choose an exact selector for a currently visible, named control from the latest page inspection.");
        }
        readOnlyPhase = true;
        await clickSelector(client, sessionId, { selector: selector.trim() });
        await delay(250);
        await waitForPage(client, sessionId, parsed.origin);
        const observed = await inspectPage();
        notePreparation("click", { selector: selector.trim() }, observed);
        return observed;
      });
    },
    record: (options = {}) => {
      if (recorded) return Promise.resolve({ ok: false, cause: "session-recorded", detail: "This browser session already produced one capture." });
      if (options === null || typeof options !== "object" || Array.isArray(options) ||
          Object.keys(options).some((key) => !["durationSeconds", "steps"].includes(key))) {
        return Promise.resolve({ ok: false, cause: "invalid-options", detail: "Record options may contain only durationSeconds and steps." });
      }
      const recording = parseCaptureOptions({
        url: parsed.url, outputDir: parsed.outputDir, width: parsed.width, height: parsed.height,
        durationSeconds: options.durationSeconds ?? DEFAULT_SECONDS, steps: options.steps ?? [],
      });
      if (!recording.ok) return Promise.resolve(recording);
      return operate(async () => {
        await ensureSafe();
        const encoderPath = await findExecutable(["ffmpeg"], parsed.encoderPath, ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]);
        if (encoderPath === null) throw new CaptureError("encoder-unavailable", "ffmpeg is not executable. Supply encoderPath.");
        let directory = null;
        try {
          await mkdir(parsed.outputDir, { recursive: true, mode: 0o700 });
          directory = await mkdtemp(join(parsed.outputDir, "capture-"));
          await chmod(directory, 0o700);
          await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 });
          const startedAt = new Date().toISOString();
          const screenshot = await client.send("Page.captureScreenshot", {
            format: "png", captureBeyondViewport: false, fromSurface: true,
          }, sessionId);
          const screenshotBytes = Buffer.from(screenshot.data ?? "", "base64");
          if (!screenshotBytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
            throw new CaptureError("capture-failed", "Chrome returned no PNG screenshot.");
          }
          const screenshotPath = join(directory, "screenshot.png");
          await writeFile(screenshotPath, screenshotBytes, { flag: "wx", mode: 0o600 });
          const screenshotAt = new Date().toISOString();
          const rawTitle = await evaluate(client, sessionId, "document.title");
          const pageTitle = typeof rawTitle === "string"
            ? rawTitle.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || null
            : null;
          const geometry = await evaluate(client, sessionId,
            "({scrollHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),height:innerHeight,scrollY:window.scrollY})");
          const scrollMax = Math.max(0, Number(geometry.scrollHeight) - Number(geometry.height));
          const startScroll = Math.max(0, Math.min(scrollMax, Number(geometry.scrollY) || 0));
          const frameCount = recording.durationSeconds * FRAME_RATE;
          const videoPath = join(directory, "demo.mp4");
          const executed = await encodeFrames(client, sessionId, encoderPath, videoPath, frameCount,
            startScroll, scrollMax, recording.steps, () => { readOnlyPhase = true; });
          await chmod(videoPath, 0o600);
          await ensureSafe();
          const videoHeader = await readFile(videoPath);
          if (videoHeader.length < 12 || videoHeader.toString("ascii", 4, 8) !== "ftyp") {
            throw new CaptureError("encode-failed", "ffmpeg did not produce an MP4 container.");
          }
          const completedAt = new Date().toISOString();
          const receipt = {
            schemaVersion: 1,
            id: basename(directory),
            source: { requestedUrl: parsed.url, finalUrl: await evaluate(client, sessionId, "location.href"), origin: parsed.origin, pageTitle },
            capture: {
              startedAt, screenshotAt, completedAt, width: parsed.width, height: parsed.height,
              frameRate: FRAME_RATE, frameCount, requestedDurationSeconds: recording.durationSeconds,
              elapsedSeconds: Number(((Date.parse(completedAt) - Date.parse(startedAt)) / 1_000).toFixed(3)),
              scrollable: scrollMax > startScroll, action: executed.length > 0 ? "scroll-and-click" : "scroll",
              preparation: [...preparation], checks: [...checks], steps: executed,
            },
            artifacts: {
              screenshot: await fileFact(screenshotPath, "screenshot.png", "image/png"),
              video: await fileFact(videoPath, "demo.mp4", "video/mp4"),
            },
            privacy: { localOnly: true, pageRequestsBlocked: pageBlocked, browserRequestsBlocked: proxyBlocked },
          };
          const receiptPath = join(directory, "receipt.json");
          await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
          recorded = true;
          return { ok: true, directory, receiptPath, screenshotPath, videoPath, receipt };
        } catch (error) {
          if (directory !== null) {
            try { await rm(directory, { recursive: true, force: true }); }
            catch (cleanupError) {
              throw new CaptureError("cleanup-failed", `${detailOf(error)} Cleanup also failed for partial capture ${directory}: ${detailOf(cleanupError)}`);
            }
          }
          throw error;
        }
      });
    },
    close,
  };
  return { ok: true, session };
}

function parseCli(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || flags.has(flag)) {
      return { ok: false, cause: "invalid-options", detail: "Usage: capture.mjs --url http://127.0.0.1:<port>/ --out <directory> [--seconds 6 --width 1280 --height 720 --steps-file <absolute JSON path> --browser <absolute path> --ffmpeg <absolute path>]" };
    }
    flags.set(flag, value);
  }
  for (const flag of flags.keys()) {
    if (!["--url", "--out", "--seconds", "--width", "--height", "--steps-file", "--browser", "--ffmpeg"].includes(flag)) {
      return { ok: false, cause: "invalid-options", detail: `Unknown option ${flag}.` };
    }
  }
  return {
    ok: true,
    options: {
      url: flags.get("--url"), outputDir: flags.get("--out"),
      durationSeconds: flags.has("--seconds") ? Number(flags.get("--seconds")) : undefined,
      width: flags.has("--width") ? Number(flags.get("--width")) : undefined,
      height: flags.has("--height") ? Number(flags.get("--height")) : undefined,
      browserPath: flags.get("--browser"), encoderPath: flags.get("--ffmpeg"),
      stepsFile: flags.get("--steps-file"),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseCli(process.argv.slice(2));
  let result = args;
  if (args.ok) {
    let options = args.options;
    if (options.stepsFile !== undefined) {
      try {
        if (!isAbsolute(options.stepsFile) || (await stat(options.stepsFile)).size > 8_192) {
          throw new Error("--steps-file must be an absolute JSON path no larger than 8192 bytes.");
        }
        options = { ...options, steps: JSON.parse(await readFile(options.stepsFile, "utf8")) };
      } catch (error) {
        result = { ok: false, cause: "invalid-options", detail: `Could not read interaction steps: ${detailOf(error)}` };
      }
    }
    if (result.ok) result = await captureLocalWebDemo(options);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
