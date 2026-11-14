#!/usr/bin/env node
/**
 * Private Canopy Cloud manager. This process is deliberately separate from the public server:
 * public routes stay GET/HEAD-only, while this loopback-only origin holds the two explicit acts.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

if (process.features.typescript !== "strip") {
  process.stderr.write(
    `canopy manager: this Node cannot run the sources. Foliage needs Node 22.18.0 or newer; ` +
      `you are running ${process.version}.\n`,
  );
  process.exit(2);
}

const { verifyMutatingRequest } = await import("@foliage/dashboard-app/csrf");
const { MANAGE_ASSET_PATHS, resolveManageRoute } = await import("./src/manageRoutes.ts");
const { loadManageState, portfolioReviewDigest } = await import("./src/manageState.ts");
const { loadPublicationInventory } = await import("./src/publicationInventory.ts");
const { renderManagePage } = await import("./src/renderManage.ts");
const { localDeviceConnection } = await import("./src/deviceConnection.ts");
const { createLocalHostedBridge, LocalHostedError } = await import("./src/localHostedBridge.ts");
const { publicHeaders } = await import("./src/publicHeaders.mjs");
const { checkPortfolioLeafBundle } = await import("@foliage/ui/portfolio-leaf-bundle");
const { esc } = await import("./src/renderPublished.ts");
const { publicationView } = await import("./src/publicationView.ts");
const { parsePublishedDocument, toArtifactJson } = await import("@foliage/canopy");
const { renderHostedBridge } = await import("./src/renderHostedBridge.ts");
const hostedBridge = process.env["FOLIAGE_HOSTED_ORIGIN"] && process.env["FOLIAGE_HOSTED_STATE"] ? createLocalHostedBridge({
  origin: process.env["FOLIAGE_HOSTED_ORIGIN"], statePath: process.env["FOLIAGE_HOSTED_STATE"], env: process.env,
}) : null;

const { renderHostingWorkspace } = await import("./src/manageWorkspace.ts");
const { workspacePath, loadWorkspace, savePacket, runAssessment, releaseAssessment, exportLeafletSuggestion } = await import("./src/ladybugWorkspace.ts");
const { readAssessmentPublication, writeAssessmentPublication, assessmentPublicationDigest, assessmentInventory } = await import("./src/assessmentPublication.ts");
const { renderAssessmentWorkspace, renderAssessmentReleases, renderWorkflowImportPreview } = await import("./src/renderAssessment.ts");
const { previewWorkflowImport } = await import("./src/workflowImport.ts");
const { digest: privateWorkspaceDigest } = await import("./src/ladybugAssessment.ts");
const { createAssessmentCompanion } = await import("./src/assessmentConnection.ts");
const assessmentCompanion = createAssessmentCompanion(process.env);
const { collaborateOnJourney } = await import("./src/journeyCollaboration.ts");
const { assessmentModel, inferenceReady } = await import("./src/ladybugInference.ts");

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4180);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  process.stderr.write(`canopy manager: PORT must be an integer from 1 to 65535.\n`);
  process.exit(2);
}
if (HOST !== "127.0.0.1" && HOST !== "::1") {
  process.stderr.write(
    `canopy manager: HOST=${JSON.stringify(HOST)} refused. The control surface may bind only ` +
      `127.0.0.1 or ::1 because it has no account authentication.\n`,
  );
  process.exit(2);
}

const SELF_ORIGIN = HOST === "::1" ? `http://[::1]:${PORT}` : `http://127.0.0.1:${PORT}`;
const SELF_HOST = HOST === "::1" ? `[::1]:${PORT}` : `127.0.0.1:${PORT}`;
const ALLOWED_HOSTS = new Set([SELF_HOST]);
const configuredPublicOrigin = process.env["FOLIAGE_PUBLIC_ORIGIN"]?.trim() || "http://127.0.0.1:4173";
let parsedPublicOrigin;
try {
  parsedPublicOrigin = new URL(configuredPublicOrigin);
} catch {
  process.stderr.write(`canopy manager: FOLIAGE_PUBLIC_ORIGIN must be an absolute URL.\n`);
  process.exit(2);
}
if (parsedPublicOrigin.protocol !== "http:" && parsedPublicOrigin.protocol !== "https:") {
  process.stderr.write(`canopy manager: FOLIAGE_PUBLIC_ORIGIN must use http or https.\n`);
  process.exit(2);
}
if (parsedPublicOrigin.pathname !== "/" || parsedPublicOrigin.search !== "" || parsedPublicOrigin.hash !== "") {
  process.stderr.write(`canopy manager: FOLIAGE_PUBLIC_ORIGIN must be an origin with no path, query, or fragment.\n`);
  process.exit(2);
}
if (parsedPublicOrigin.username !== "" || parsedPublicOrigin.password !== "") {
  process.stderr.write(`canopy manager: FOLIAGE_PUBLIC_ORIGIN must not contain credentials.\n`);
  process.exit(2);
}
const PUBLIC_ORIGIN = parsedPublicOrigin.origin;
const studioOrigin = process.env["FOLIAGE_STUDIO_ORIGIN"];
if (studioOrigin) {
  const studio = new URL(studioOrigin);
  if (studio.origin !== studioOrigin || studio.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(studio.hostname)) throw new Error("Configure an exact loopback studio origin.");
}
const CSRF_TOKEN = randomUUID();
const deviceConnection = process.env["FOLIAGE_HOSTED_ORIGIN"] ? localDeviceConnection(process.env["FOLIAGE_HOSTED_ORIGIN"], SELF_ORIGIN + "/hosted/callback") : null;
/** One-use notices prove a successful mutation happened in this process. */
const notices = new Map();
const MAX_NOTICES = 32;
const activeAssessments = new Set();
const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const TOKENS_DIR = dirname(TOKENS_CSS);
const FONTS_DIR = join(TOKENS_DIR, "fonts");

const ASSETS = new Map([
  ["/workspace.js", { file: join(APP_DIR, "public/workspace.js"), type: "text/javascript; charset=utf-8" }],
  ["/workspace.css", { file: join(APP_DIR, "public/workspace.css"), type: "text/css; charset=utf-8" }],
  ["/foliage-tokens.css", { file: TOKENS_CSS, type: "text/css; charset=utf-8" }],
  ["/canopy-tokens.css", { file: join(APP_DIR, "public/canopy-tokens.css"), type: "text/css; charset=utf-8" }],
  ["/canopy-base.css", { file: join(APP_DIR, "public/canopy-base.css"), type: "text/css; charset=utf-8" }],
  ["/manage.css", { file: join(APP_DIR, "public/manage.css"), type: "text/css; charset=utf-8" }],
  ["/foliage.css", { file: fileURLToPath(import.meta.resolve("@foliage/tokens/foliage.css")), type: "text/css; charset=utf-8" }],
  ["/roles.css", { file: fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css")), type: "text/css; charset=utf-8" }],
  ["/published.css", { file: join(APP_DIR, "public/published.css"), type: "text/css; charset=utf-8" }],
  ["/portfolio-leaf.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/portfolio-leaf.css")), type: "text/css; charset=utf-8" }],
  ["/workspace-shell.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/workspace.css")), type: "text/css; charset=utf-8" }],
  ["/controls.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/controls.css")), type: "text/css; charset=utf-8" }],
  ["/mark-primary.svg", { file: join(TOKENS_DIR, "mark-primary.svg"), type: "image/svg+xml" }],
  ["/mark-icon.svg", { file: join(TOKENS_DIR, "mark-icon.svg"), type: "image/svg+xml" }],
]);
if (ASSETS.size !== MANAGE_ASSET_PATHS.length) {
  throw new Error("manage asset route table and asset map disagree");
}

async function workspaceAssetsReady() {
  const files = ["/workspace.js", "/workspace.css"].map((path) => {
    const asset = ASSETS.get(path);
    if (asset === undefined) throw new Error(`unmapped workspace asset ${path}`);
    return asset.file;
  });
  const ready = await Promise.all(files.map(async (file) => {
    try {
      const info = await stat(file);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }));
  return ready.every(Boolean);
}

const CSP =
  `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; ` +
  `base-uri 'none'; frame-ancestors 'none'; form-action 'self'${process.env["FOLIAGE_HOSTED_ORIGIN"] ? " " + new URL(process.env["FOLIAGE_HOSTED_ORIGIN"]).origin : ""}`;

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} type
 * @param {string | Buffer} body
 * @param {{headOnly?: boolean, extra?: Record<string, string>}} [options]
 */
function send(res, status, type, body, { headOnly = false, extra = {} } = {}) {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, {
    "content-type": type,
    "content-length": bytes.byteLength,
    "cache-control": "no-store",
    "content-security-policy": String(res.getHeader("content-security-policy") ?? CSP),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "x-robots-tag": "noindex, noarchive, nosnippet, noimageindex",
    ...extra,
  });
  headOnly ? res.end() : res.end(bytes);
}

/** @param {import("node:http").IncomingMessage} req */
async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 384 * 1024) throw new Error("form body too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {Promise<{code: number, output: string}>}
 */
function runNode(script, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(APP_DIR, script), ...args], {
      cwd: resolve(APP_DIR, "../.."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    /** @param {Buffer} chunk */
    const append = (chunk) => {
      if (output.length < 256 * 1024) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => resolveRun({ code: 1, output: String(error) }));
    child.once("exit", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

/** @param {string} output @param {string} fallback */
function conciseFailure(output, fallback) {
  const compact = output.replace(/\s+/g, " ").trim();
  if (compact === "") return fallback;
  return compact.length > 640 ? `${compact.slice(0, 637)}…` : compact;
}

/** @param {import("./src/renderManage.ts").ManageNotice} notice */
function rememberNotice(notice) {
  while (notices.size >= MAX_NOTICES) notices.delete(notices.keys().next().value);
  const key = randomUUID();
  notices.set(key, notice);
  return key;
}

let mutationTail = Promise.resolve();
async function acquireMutation() {
  const previous = mutationTail;
  /** @type {() => void} */
  let release = () => {};
  mutationTail = new Promise((resolveLock) => { release = resolveLock; });
  await previous;
  return release;
}

/** @param {import("./src/renderManage.ts").ManageNotice | undefined} notice */
async function standardCurrentPage(notice, includePortfolio = false) {
  const [state, inventory] = await Promise.all([loadManageState(process.env, undefined, { includePortfolio }), loadPublicationInventory()]);
  return renderManagePage(state, CSRF_TOKEN, notice, PUBLIC_ORIGIN, inventory);
}

/** @param {import("./src/manageState.ts").ManageState} state @param {import("./src/renderManage.ts").ManageNotice} notice */
async function standardPageFor(state, notice) {
  return renderManagePage(state, CSRF_TOKEN, notice, PUBLIC_ORIGIN, await loadPublicationInventory());
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const headOnly = method === "HEAD";
  if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) {
    send(res, 421, "text/plain; charset=utf-8", "misdirected request", { headOnly });
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", SELF_ORIGIN);
    requestUrl.pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    send(res, 400, "text/plain; charset=utf-8", "bad request", { headOnly });
    return;
  }

  if (requestUrl.pathname === "/onboarding/status") {
    const allowed = process.env["FOLIAGE_HOSTED_ORIGIN"];
    if (!allowed || req.headers.origin !== allowed || !["GET", "OPTIONS"].includes(method)) { send(res, 403, "text/plain", "Discovery refused."); return; }
    send(res, method === "OPTIONS" ? 204 : 200, "application/json", method === "OPTIONS" ? "" : JSON.stringify({ service: "foliage-photosynthesis", version: 1, canopyOrigin: allowed }), { extra: { "access-control-allow-origin": allowed, "access-control-allow-methods": "GET", "access-control-allow-private-network": "true", vary: "Origin" } });
    return;
  }
  if (requestUrl.pathname === "/hosted/callback") {
    if (method !== "POST" || !deviceConnection || !hostedBridge) { send(res, 405, "text/plain", "Start the connection from Photosynthesis."); return; }
    try {
      const fields = await readForm(req);
      if ([...fields.keys()].length !== 2 || fields.getAll("state").length !== 1 || fields.getAll("grant").length !== 1) throw new Error("Invalid connection response");
      const token = deviceConnection.finish(fields.get("state") ?? "", fields.get("grant") ?? "");
      await hostedBridge.command("connect-device", { token });
      send(res, 303, "text/plain", "Connected", { extra: { location: "/hosted" } });
    } catch { send(res, 400, "text/plain", "Couldn't connect. Connect again from Photosynthesis."); }
    return;
  }
  if (requestUrl.pathname.startsWith("/connection/")) {
    const review = /^\/connection\/review\/([a-f0-9-]{36})$/.exec(requestUrl.pathname);
    if (review && (method === "GET" || headOnly)) {
      try {
        const packet = assessmentCompanion.review(review[1] ?? "");
        if (!packet) { send(res, 410, "text/plain", "Preview expired. Prepare again.", { headOnly }); return; }
        const current = await loadWorkspace(workspacePath(process.env));
        if (current && current.packet.id !== packet.id) throw new Error("This companion already holds another portfolio. Connect the matching workspace before importing.");
        send(res, 200, "text/html; charset=utf-8", renderWorkflowImportPreview(packet, CSRF_TOKEN, privateWorkspaceDigest(current), current !== null), { headOnly });
      } catch { send(res, 409, "text/plain", "Preview refused. Reconnect from your Leaf.", { headOnly }); }
      return;
    }
    if (method !== "POST") { send(res, 405, "text/plain", "Use the connected Leaf workspace.", { headOnly, extra: { allow: "POST" } }); return; }
    if (!assessmentCompanion.authorize(req.headers.authorization, req.headers.origin)) { req.resume(); send(res, 403, "text/plain", "Companion pairing required."); return; }
    try {
      if (req.headers["content-type"] !== "application/json") throw new Error();
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 96 * 1024) throw new Error(); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const action = requestUrl.pathname.slice("/connection/".length);
      const result = action === "journey" ? await collaborateOnJourney(input, process.env) : assessmentCompanion.command(action, input);
      send(res, 200, "application/json", JSON.stringify(result));
    } catch (error) {
      const detail = requestUrl.pathname === '/connection/journey' && error instanceof Error && /^(Fireworks |Ladybug's response|Scarlet returned)/.test(error.message) ? error.message : 'Companion request was refused. Review the selected evidence again.';
      send(res, 400, 'application/json', JSON.stringify({error:detail}));
    }
    return;
  }
  const route = resolveManageRoute(method, requestUrl.pathname);
  const workspace = route.kind === "workspace" || requestUrl.searchParams.get("workspace") === "1";
  const showWorkspace = workspace && await workspaceAssetsReady();
  /** @type {import("./src/renderManage.ts").ManageNotice | undefined} */
  const workspaceUnavailable = workspace && !showWorkspace ? {
    tone: "error", heading: "Hosting view unavailable",
    detail: "The workspace assets are missing. Use the publication controls below, or run pnpm --filter @foliage/canopy-app workspace:build to restore this view.",
  } : undefined;
  // Only this opt-in private React surface permits script and same-origin state reads.
  const workspaceCsp = `${CSP}; script-src 'self'; connect-src 'self'`;
  /** @param {import("./src/renderManage.ts").ManageNotice | undefined} notice @param {import("./src/manageWorkspace.ts").HostingWorkspaceEntry} [entry] */
  const currentPage = async (notice, entry = {}) => {
    const includePortfolio = entry.includePortfolio ?? requestUrl.searchParams.get("includePortfolio") === "on";
    return showWorkspace
      ? renderHostingWorkspace(notice, { ...entry, includePortfolio })
      : standardCurrentPage(notice ?? workspaceUnavailable, includePortfolio);
  };
  /** @param {import("./src/manageState.ts").ManageState} state @param {import("./src/renderManage.ts").ManageNotice} notice @param {import("./src/manageWorkspace.ts").HostingWorkspaceEntry} [entry] */
  const pageFor = async (state, notice, entry = {}) => showWorkspace ? renderHostingWorkspace(notice, entry) : standardPageFor(state, notice);
  // CSP follows the rendered response, including failed POSTs that keep the workspace visible.
  if (showWorkspace) res.setHeader("content-security-policy", workspaceCsp);
  try {
    const videoRoute = /^\/hosted\/(video\/([0-9a-f]{64})|clip\/([0-9a-f]{64})\/([0-9a-f]{64}))$/.exec(requestUrl.pathname);
    if (videoRoute && (method === "GET" || headOnly)) {
      let clip = null;
      if (videoRoute[3] && videoRoute[4]) clip = hostedBridge ? await hostedBridge.video(videoRoute[3], videoRoute[4]) : null;
      else if (videoRoute[2]) {
        const state = await loadManageState();
        const choice = state.kind === "ready" ? state.videoChoices?.find(c => c.video?.sourceRef === `sha256:${videoRoute[2]}`) : null;
        if (choice?.video) {
          const { readVideo, videoRootFromEnv } = await import("@foliage/leaf-app/videoStore");
          const { checkVideoBytes } = await import("./src/publicationVideos.ts");
          const read = await readVideo(videoRootFromEnv(), choice.video.sourceRef);
          if (read.ok) { checkVideoBytes(choice.video, read.bytes); clip = { bytes: read.bytes, contentType: "video/mp4" }; }
        }
      }
      send(res, clip ? 200 : 404, clip?.contentType ?? "text/plain; charset=utf-8", clip?.bytes ?? "This selected clip is unavailable.", { headOnly, extra: { "cross-origin-resource-policy": "same-origin", "cache-control": "private, no-store, max-age=0" } });
      return;
    }
    const photoRoute = /^\/hosted\/(media|photo)\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
    if (photoRoute && (method === "GET" || headOnly)) {
      let photo = null;
      if (photoRoute[1] === "media") photo = hostedBridge ? await hostedBridge.photo(photoRoute[2] ?? "", photoRoute[3] ?? "") : null;
      else {
        const state = await loadManageState();
        const choice = state.kind === "ready" ? state.photoChoices?.find(c => c.photo?.sourceRef === `sha256:${photoRoute[2]}` && c.photo.renditionDigest === `sha256:${photoRoute[3]}`) : null;
        if (choice?.photo) {
          const { readMedia, mediaRootFromEnv } = await import("@foliage/leaf-app/mediaStore");
          const { checkPhotoBytes } = await import("./src/publicationPhotos.ts");
          const read = await readMedia(mediaRootFromEnv(), choice.photo.sourceRef);
          if (read.ok) { const bytes = Buffer.from(read.bytes); checkPhotoBytes(choice.photo, bytes); photo = { bytes, contentType: `image/${choice.photo.format}` }; }
        }
      }
      send(res, photo ? 200 : 404, photo?.contentType ?? "text/plain; charset=utf-8", photo?.bytes ?? "This selected image is unavailable.", { headOnly, extra: { "cross-origin-resource-policy": "same-origin" } });
      return;
    }
    if (route.kind === "hosted-preview") {
      const view = hostedBridge ? await hostedBridge.view() : null;
      const prepared = view?.connected ? view.prepared : null;
      const parsed = prepared ? parsePublishedDocument(prepared.document) : null;
      if (!prepared || !parsed?.ok) {
        send(res, 404, "text/html; charset=utf-8", renderHostedBridge(view, await loadManageState(), CSRF_TOKEN, "Preview unavailable. Prepare again.", studioOrigin), { headOnly });
        return;
      }
      const page = await publicationView(parsed.document, prepared.consent.artifactDigest, `/hosted/media/${prepared.consent.artifactDigest.slice(7)}`, {
        kind: "local-hosted",
        csrf: CSRF_TOKEN,
        operationId: prepared.consent.operationId,
        subjectId: prepared.consent.subjectId,
        replacing: prepared.current.visible,
      }, `/hosted/clip/${prepared.consent.artifactDigest.slice(7)}`);
      send(res, 200, "text/html; charset=utf-8", page, { headOnly, extra: { ...publicHeaders({ form: true, portfolio: true }), "referrer-policy": "same-origin" } });
      return;
    }
    if (route.kind === "hosted" || route.kind === "hosted-action") {
      let message;
      if (route.kind === "hosted-action") {
        const fields = await readForm(req);
        const verdict = verifyMutatingRequest({ origin: req.headers.origin, referer: req.headers.referer }, fields.get("csrf"), SELF_ORIGIN, CSRF_TOKEN);
        if (!verdict.ok) { send(res, 403, "text/plain; charset=utf-8", "request refused"); return; }
        if ([...fields.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) { send(res, 400, "text/plain; charset=utf-8", "Repeated form fields are refused."); return; }
        try {
          if (!hostedBridge) throw new LocalHostedError("configuration", "Hosting not configured.");
          if (route.action === "connect" && deviceConnection) {
            send(res, 303, "text/plain", "Continue with your Foliage account", { extra: { location: deviceConnection.start() } });
            return;
          }
          await hostedBridge.command(route.action, Object.fromEntries(fields));
          if (route.action === "prepare") { send(res, 303, "text/plain", "Preview ready", { extra: { location: "/hosted/preview" } }); return; }
          message = route.action === "connect" ? "Connected" : route.action === "prepare" ? "Preview ready" : route.action === "disconnect" ? "Disconnected" : "Updated";
        } catch (error) { message = error instanceof LocalHostedError ? error.message : "Local state error. Check the operation before retrying."; }
      }
      let view = null;
      try { view = hostedBridge ? await hostedBridge.view() : null; }
      catch (error) { message = error instanceof LocalHostedError ? error.message : "Local state unreadable."; }
      send(res, 200, "text/html; charset=utf-8", renderHostedBridge(view, await loadManageState(), CSRF_TOKEN, message, studioOrigin), { headOnly });
      return;
    }
    if (route.kind === "assessment-releases") {
      const items = await assessmentInventory(process.env["FOLIAGE_PUBLISHED"]?.trim() ?? "");
      send(res, 200, "text/html; charset=utf-8", renderAssessmentReleases(items, CSRF_TOKEN, PUBLIC_ORIGIN), { headOnly });
      return;
    }
    if (route.kind === "ladybug" || route.kind === "ladybug-action") {
      const path = workspacePath(process.env);
      const publicRoot = process.env["FOLIAGE_PUBLISHED"]?.trim() ?? "";
      if (route.kind === "ladybug") {
        const workspace = await loadWorkspace(path);
        const publication = workspace && publicRoot ? await readAssessmentPublication(publicRoot, workspace.packet.id) : null;
        send(res, 200, "text/html; charset=utf-8", renderAssessmentWorkspace(workspace, publication, CSRF_TOKEN,
          inferenceReady(process.env), assessmentModel(process.env), PUBLIC_ORIGIN), { headOnly });
        return;
      }
      const form = await readForm(req);
      const verdict = verifyMutatingRequest({ origin: req.headers.origin, referer: req.headers.referer }, form.get("csrf"), SELF_ORIGIN, CSRF_TOKEN);
      if (!verdict.ok) { send(res, 403, "text/plain; charset=utf-8", "request refused"); return; }
      try {
        const expected = form.get("workspaceDigest") ?? "";
        const confirm = form.get("confirm") ?? "";
        if (route.action === "suggestion") {
          const suggestion = exportLeafletSuggestion(await loadWorkspace(path), expected, form.get("title") ?? "");
          send(res, 200, "application/json; charset=utf-8", JSON.stringify(suggestion, null, 2), { extra: { "content-disposition": 'attachment; filename="foliage-leaflet-suggestion.json"' } });
          return;
        } else if (route.action === "import") {
          const current = await loadWorkspace(path);
          if (privateWorkspaceDigest(current) !== expected) throw new Error("Workspace changed. Reopen the import.");
          const packet = previewWorkflowImport(form.get("transfer") ?? "", form.get("id") ?? "", form.get("subject") ?? "");
          if (current && current.packet.id !== packet.id) throw new Error("Different portfolio id. Nothing imported.");
          send(res, 200, "text/html; charset=utf-8", renderWorkflowImportPreview(packet, CSRF_TOKEN, expected, current !== null));
          return;
        } else if (route.action === "save") {
          await savePacket(path, expected, { ...Object.fromEntries(["id", "subject", "evidence", "knownWork", "market", "correction"].map(key => [key, form.get(key) ?? ""])), ...(form.has("target") ? { target: JSON.parse(form.get("target") ?? "") } : {}) });
        } else if (route.action === "assess") {
          if (form.get("consent") !== "send" || form.get("model") !== assessmentModel(process.env)) throw new Error("Confirm the model to send.");
          if (activeAssessments.has(path)) throw new Error("Review in progress. Refresh later.");
          activeAssessments.add(path);
          try { await runAssessment(path, expected, confirm, process.env); }
          finally { activeAssessments.delete(path); }
        } else if (route.action === "release") {
          await releaseAssessment(path, expected, publicRoot, form.get("publicDigest") ?? "", confirm, form.getAll("finding"));
        } else {
          // Withdrawal does not require the local evidence or assessment to remain readable.
          const id = form.get("id") ?? "";
          const current = await readAssessmentPublication(publicRoot, id);
          if (confirm !== id || !current?.release || assessmentPublicationDigest(current) !== form.get("publicDigest")) throw new Error("Findings changed or id doesn’t match. Review again.");
          await writeAssessmentPublication(publicRoot, id, form.get("publicDigest") ?? "", null);
        }
        send(res, 303, "text/plain; charset=utf-8", "", { extra: { location: route.action === "withdraw" ? "/ladybug/releases" : "/ladybug" } });
      } catch (error) {
        const workspace = await loadWorkspace(path);
        const publication = workspace && publicRoot ? await readAssessmentPublication(publicRoot, workspace.packet.id) : null;
        send(res, 409, "text/html; charset=utf-8", renderAssessmentWorkspace(workspace, publication, CSRF_TOKEN,
          inferenceReady(process.env), assessmentModel(process.env), PUBLIC_ORIGIN,
          error instanceof Error ? error.message : "Assessment action failed.", form));
      }
      return;
    }
    if (route.kind === "workspace-state") {
      const [state, inventory] = await Promise.all([loadManageState(process.env, undefined, { includePortfolio: requestUrl.searchParams.get("includePortfolio") === "on" }), loadPublicationInventory()]);
      send(res, 200, "application/json; charset=utf-8", JSON.stringify({state, inventory, csrf: CSRF_TOKEN, publicOrigin: PUBLIC_ORIGIN, ...(state.kind === "ready" ? {portfolioDigest: portfolioReviewDigest(state), previewArtifact: toArtifactJson(state.preview)} : {})}), {headOnly});
      return;
    }

    if (route.kind === "home" || route.kind === "workspace") {
      const noticeKey = requestUrl.searchParams.get("notice");
      /** @type {import("./src/renderManage.ts").ManageNotice | undefined} */
      const pageNotice = noticeKey === null ? undefined : notices.get(noticeKey);
      if (noticeKey !== null) notices.delete(noticeKey);
      send(res, 200, "text/html; charset=utf-8", await currentPage(pageNotice), { headOnly });
      return;
    }
    if (route.kind === "publish" || route.kind === "withdraw") {
      const form = await readForm(req);
      const verdict = verifyMutatingRequest(
        { origin: req.headers.origin, referer: req.headers.referer },
        form.get("csrf"),
        SELF_ORIGIN,
        CSRF_TOKEN,
      );
      if (!verdict.ok) {
        send(res, 403, "text/plain; charset=utf-8", `request refused: ${verdict.failed}`);
        return;
      }

      const releaseMutation = await acquireMutation();
      try {
        if (route.kind === "withdraw") {
          const id = form.get("id") ?? "";
          const confirm = form.get("confirm") ?? "";
          const inventory = await loadPublicationInventory();
          const item = inventory.kind === "ready"
            ? inventory.items.find((candidate) => candidate.id === id)
            : undefined;
          if (item === undefined || item.artifactDigest === null || confirm !== id) {
            send(res, 409, "text/html; charset=utf-8", await currentPage({
              tone: "error", heading: "Nothing changed", detail: "Leaf id doesn’t match.",
            }));
            return;
          }
          if (form.get("publicationDigest") !== item.artifactDigest) {
            send(res, 409, "text/html; charset=utf-8", await currentPage({
              tone: "error", heading: "Public leaf changed", detail: "Review again.",
            }));
            return;
          }
          const into = process.env["FOLIAGE_PUBLISHED"]?.trim();
          if (!into) {
            send(res, 409, "text/html; charset=utf-8", await currentPage({
              tone: "error", heading: "Nothing changed", detail: "FOLIAGE_PUBLISHED is not configured.",
            }));
            return;
          }
          const result = await runNode("withdraw.mjs", [
            "--from", into,
            "--id", id,
            "--expect-digest", item.artifactDigest,
            "--confirm", confirm,
          ]);
          if (result.code !== 0) {
            process.stderr.write(`[canopy-manager] withdraw refused (${result.code})\n${result.output}\n`);
            send(res, 409, "text/html; charset=utf-8", await currentPage({
              tone: "error", heading: "Nothing changed", detail: conciseFailure(result.output, `withdraw command exited ${result.code}`),
            }));
            return;
          }
          const noticeKey = rememberNotice({ tone: "success", heading: "Withdrawn", detail: "" });
          send(res, 303, "text/plain; charset=utf-8", "", { extra: { location: `${workspace ? "/workspace" : "/"}?notice=${encodeURIComponent(noticeKey)}` } });
          return;
        }

        if (form.getAll("includePortfolio").length > 1 || (form.has("includePortfolio") && form.get("includePortfolio") !== "on") || form.getAll("portfolioDigest").length > 1) {
          send(res, 409, "text/plain; charset=utf-8", "Form not recognised. Nothing changed. Review again."); return;
        }
        const includePortfolio = form.get("includePortfolio") === "on";
        const prepareEntry = { section: /** @type {const} */ ("prepare"), includePortfolio };
        const state = await loadManageState(process.env, undefined, { includePortfolio });
        if (state.kind !== "ready") {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Nothing changed", detail: "Local leaf not ready.",
          }, prepareEntry));
          return;
        }
        if ((form.has("portfolioDigest") || state.includePortfolio) && form.get("portfolioDigest") !== portfolioReviewDigest(state)) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, { tone: "error", heading: "Review changed", detail: "Included context changed. Review again." }, prepareEntry)); return;
        }
        const confirm = form.get("confirm") ?? "";
        const id = state.review.published.id;
        if (confirm !== id) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Nothing changed", detail: "Leaf id doesn’t match.",
          }, prepareEntry));
          return;
        }
        if (route.kind === "publish" && form.get("sourceDigest") !== state.sourceDigest) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Local leaf changed", detail: "Review again.",
          }, prepareEntry));
          return;
        }
        if (route.kind === "publish" && form.get("policyDigest") !== state.policyDigest) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Publication rules changed", detail: "Review again.",
          }, prepareEntry));
          return;
        }
        const republish = form.get("republish") === "true";
        const reviewedPublicDigest = republish && state.publication.kind === "update-available"
          ? state.publication.artifactDigest
          : null;
        if (
          route.kind === "publish" &&
          (republish
            ? reviewedPublicDigest === null || form.get("publicDigest") !== reviewedPublicDigest
            : state.publication.kind !== "not-published")
        ) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Public leaf changed", detail: "Review again.",
          }, prepareEntry));
          return;
        }
        const into = process.env["FOLIAGE_PUBLISHED"]?.trim();
        if (!into) {
          send(res, 409, "text/html; charset=utf-8", await pageFor(state, {
            tone: "error", heading: "Nothing changed", detail: "FOLIAGE_PUBLISHED is not configured.",
          }, prepareEntry));
          return;
        }

        const result = await runNode("publish.mjs", [
          "--document", state.sourcePath,
          "--into", into,
          "--expect-digest", state.sourceDigest,
          "--expect-policy-digest", state.policyDigest,
          ...(reviewedPublicDigest === null ? [] : ["--expect-public-digest", reviewedPublicDigest]),
          "--confirm", confirm,
          ...(republish ? ["--republish"] : []),
          ...(state.includePortfolio ? ["--include-portfolio"] : []),
        ]);

        if (result.code === 0) {
          const noticeKey = rememberNotice({ tone: "success", heading: "Published", detail: "" });
          const location = `${workspace ? "/workspace" : "/"}?notice=${encodeURIComponent(noticeKey)}`;
          send(res, 303, "text/plain; charset=utf-8", "", { extra: { location } });
          return;
        }
        process.stderr.write(`[canopy-manager] publish refused (${result.code})\n${result.output}\n`);
        send(res, 409, "text/html; charset=utf-8", await currentPage({
          tone: "error",
          heading: "Nothing changed",
          detail: conciseFailure(result.output, `publish command exited ${result.code}`),
        }, prepareEntry));
        return;
      } finally {
        releaseMutation();
      }
    }
    if (route.kind === "portfolio-bundle") {
      const bundle = await checkPortfolioLeafBundle();
      if (!bundle.ok) {
        send(res, 503, "text/plain; charset=utf-8", "Interactive leaf unavailable", { headOnly });
        return;
      }
      send(res, 200, "text/javascript; charset=utf-8", await readFile(bundle.path), { headOnly });
      return;
    }
    if (route.kind === "asset") {
      const asset = ASSETS.get(route.path);
      if (asset === undefined) throw new Error(`unmapped asset ${route.path}`);
      let body;
      try { body = await readFile(asset.file); }
      catch (error) {
        if ((route.path === "/workspace.js" || route.path === "/workspace.css") && /** @type {NodeJS.ErrnoException} */(error).code === "ENOENT") {
          send(res, 404, "text/plain; charset=utf-8", "Hosting workspace asset unavailable. Open / for publication controls.", { headOnly });
          return;
        }
        throw error;
      }
      send(res, 200, asset.type, body, { headOnly });
      return;
    }
    if (route.kind === "font") {
      if (route.name !== basename(route.name)) {
        send(res, 403, "text/plain; charset=utf-8", "forbidden", { headOnly });
        return;
      }
      const file = resolve(join(FONTS_DIR, route.name));
      if (!file.startsWith(FONTS_DIR + sep)) {
        send(res, 403, "text/plain; charset=utf-8", "forbidden", { headOnly });
        return;
      }
      send(res, 200, "font/woff2", await readFile(file), { headOnly });
      return;
    }
    if (route.kind === "forbidden") {
      send(res, 403, "text/plain; charset=utf-8", "forbidden", { headOnly });
      return;
    }
    if (route.kind === "method-not-allowed") {
      send(res, 405, "text/plain; charset=utf-8", "method not allowed", { headOnly, extra: { allow: route.allow } });
      return;
    }
    send(res, 404, "text/plain; charset=utf-8", "not found", { headOnly });
  } catch (error) {
    process.stderr.write(`canopy manager: ${error instanceof Error ? error.stack : String(error)}\n`);
    send(res, 500, "text/plain; charset=utf-8", "internal error", { headOnly });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[canopy-manager] ${SELF_ORIGIN}/\n`);
  process.stdout.write(`[canopy-manager] leaf=${process.env["FOLIAGE_LEAF"] ?? "(default)"} publications=${process.env["FOLIAGE_PUBLISHED"] ?? "(unset)"}\n`);
});
