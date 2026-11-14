#!/usr/bin/env node
import { renderSetup, renderSetupPreview, renderSetupStart, setupState, setupManagerOrigin } from "./src/portfolioSetup.ts";
import { createFirstLeaf } from "./src/firstRun.ts";
import { recordStart } from "./src/recordStart.ts";
import { renderWorkWorkspace } from "./src/workWorkspace.ts";
import { renderCapturePage } from "./src/capturePage.ts";
import { captureDemoCandidateId, captureRootFor, listCaptures, readCaptureArtifact, readCaptureReceipt } from "./src/captureLibrary.ts";
import { queueCapturedDemo } from "./src/captureReview.ts";
import { renderWorkflowUnavailablePage } from "./src/workflowUnavailablePage.ts";
import { renderPolicyRecovery, renderScarletLeafRecovery } from "./src/workspaceRecoveryPage.ts";
import { previewPortfolioImport, importPortfolio } from "./src/portfolioImport.ts";
import { renderPortfolioImport } from "./src/portfolioImportPage.ts";
/**
 * Leaf server — serves ONE person's leaf, ONE leaflet at a time, and the review queue.
 *
 * Document routes use server-rendered shadcn controls without hydration. The private
 * /workflow surface serves a locally built React/shadcn/Magic UI bundle. Build it with
 * pnpm --filter @foliage/leaf-app workflow:build; styles, tokens and fonts remain local.
 *
 * Port 4174, one above canopy's 4173, so both can run at once while a change is verified.
 *
 *   GET  /                 the compound leaf
 *   GET  /leaflet/<id>     ONE leaflet, standalone and shareable. It must not disclose the
 *                          compound: see the section head in `src/render.ts`.
 *   GET  /media/sha256:<hex>   the BYTES one leaflet's evidence names, hashed before they are
 *                          sent. See "serving media" below — this route is gated twice and
 *                          verifies what it is about to write to the socket.
 *   GET  /review           the harvest queue — machine drafts awaiting a person
 *   POST /review           record one approve/reject, through the REAL gate
 *   POST /scarlet/run      one AG-UI run over server-sent events: Photosynthesis answers one question
 *                          about the leaf from a local model, and writes nothing. Same-origin
 *                          only, the same headers as every other response. See `src/scarletRun.ts`.
 *   GET  /tokens.css, /roles.css, /foliage.css   the design system, from @foliage/tokens
 *   GET  /leaf.css, /mark-*.svg, /fonts/<name>.woff2
 *
 * WHAT THIS FILE DOES NOT DO: it holds no policy about EVIDENCE. Which HTTP status a load
 * deserves lives with the causes in `src/leafDocument.ts` and `src/render.ts`, and what a page
 * says lives in `src/render.ts`. What it DOES own is transport policy, and the review POST added
 * three pieces of it that have nowhere else to live:
 *
 *   METHODS ARE PER-ROUTE. The server answered a blanket 405 with `allow: GET, HEAD`. It now
 *   answers the methods the ROUTE actually has, because `allow` is a promise about one resource:
 *   telling a client that `/review` accepts only GET while POSTing to it is the documented way
 *   to make a correct client give up on a working endpoint.
 *
 *   THE CSP IS PER-RESPONSE, and only the responses with a form relax it. Every page here is
 *   `default-src 'none'` with `form-action 'none'` — which BLOCKS form submission, so the review
 *   page and the Photosynthesis page (the two surfaces with a form) are the only ones served with
 *   `form-action 'self'`. Widening it globally would let any injected form on any page post somewhere.
 *
 *   A CROSS-SITE POST IS REFUSED BY ORIGIN. This server has no authentication and binds loopback,
 *   which is not a defence against the browser the operator is already using: any page on the
 *   internet can submit a form to 127.0.0.1:4174 and would be recording review decisions in
 *   somebody's harvest document. Browsers have sent `Origin` on every POST for years, so a POST
 *   whose Origin is absent or is not this server's is refused with the cause named. A non-browser
 *   client sends the header itself; the refusal says so.
 *
 *   A REBOUND HOST IS REFUSED BEFORE ROUTING. Origin cannot catch DNS rebinding: a page whose name
 *   re-resolves to 127.0.0.1 sends a Host and an Origin that agree. So every request, on every
 *   route and method, is answered 421 unless its Host is one the bound socket answers to
 *   (`@foliage/leaf/bound-authorities`, the Canopy reader's rule).
 *
 * Two disciplines carried over from the canopy server, both load-bearing:
 *   - containment is checked on the RESOLVED path, never on the request string, because
 *     `%2e%2e` survives a naive string check;
 *   - ENOENT is a 404 and everything else is OURS, reported as a 500. Flattening distinct
 *     causes into "not found" is the error-masking pattern this project keeps paying for.
 *
 * Both documents are re-read on every request. A portfolio changes when its file changes, and a
 * cached leaf would show a self-hoster stale evidence after they had fixed it — one small file
 * read is the right price for never lying about the current state. The harvest is re-read for a
 * second reason as well: the CLI writes to the same file, so a cached queue would show decisions
 * that had already been made somewhere else.
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");
const { boundAuthorities } = await import("@foliage/leaf/bound-authorities");

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");

const { DOCUMENT_ENV, httpStatusFor, loadLeafDocument } = await import("./src/leafDocument.ts").catch(
  explainFailedWorkspaceImport,
);
const {
  GARDEN_ROUTE,
  HARVEST_ENV,
  SCARLET_ROUTE,
  SCARLET_RUN_ROUTE,
  LEAF_ROUTE,
  LEAFLET_ROUTE,
  MEDIA_ROUTE,
  OVERVIEW_ROUTE,
  OWNER_LEAFLET_ROUTE,
  OWNER_MEDIA_ROUTE,
  POLICY_ROUTE,
  PROMOTE_ROUTE,
  PUBLISH_ROUTE,
  REVIEW_ROUTE,
  findLeaflet,
  httpStatusForHarvest,
  httpStatusForRefusal,
  httpStatusForUnwritable,
  renderLeafPage,
  renderLeafletPage,
  leafLoadTechnical,
  renderPromoteRefused,
  renderReviewPage,
  renderReviewWriteRefused,
  technicalFor,
} = await import("./src/render.ts").catch(explainFailedWorkspaceImport);
const { renderCompoundPage } = await import("./src/compoundPage.ts");
const { checkCompoundBundle } = await import("./src/compoundBundle.ts");
const { checkPortfolioLeafBundle } = await import("@foliage/ui/portfolio-leaf-bundle");
const { loadPortfolioWorkDates } = await import("./src/portfolioWorkDates.ts");
const { renderWorkflowLeaflet, saveWorkflowLeaflet, renderJourneyFailure, renderLeafletExport, renderSuggestionReview, saveLeafletSuggestion, renderLeafletStory, renderLeafletStoryRecovery, saveLeafletStory } = await import("./src/leafletJourney.ts");
const { renderCuration, renderCurationFailure, saveCuration } = await import("./src/leafCuration.ts");
const { renderPresentation, renderPresentationFailure, savePresentation, renderAchievement, resumeDraft, renderLiveResume } = await import("./src/portfolioPresentation.ts");
const { prepareClaimCheck, checkClaim, renderClaimCheck } = await import("./src/claimCheck.ts");
const { LeafLoadError, POLICY_UNAVAILABLE, harvestLoadProblem, leafLoadProblem } = await import("./src/loadLabels.ts");
const { exportLeafletReview, parseLeafletSuggestion } = await import("./src/leafletRevision.ts");
const { RATING_SHAPED } = await import("@foliage/leaf").catch(explainFailedWorkspaceImport);
const { orderReviewQueue, parseHarvestDocument, promoteApproved, queuePaused, reviewSubjectDigest, shownQueue, withCandidates, writeGuard } = await import(
  "@foliage/photosynthesis"
).catch(explainFailedWorkspaceImport);
const { POLICY_ENV, describePolicySource, loadPublishPolicy } = await import(
  "./src/policyDocument.ts"
).catch(explainFailedWorkspaceImport);
const { MEDIA_ENV, mediaRootFor, parseMediaRef, readMedia, summarizeStore } = await import(
  "./src/mediaStore.ts"
).catch(explainFailedWorkspaceImport);
// THE STUDIO'S FOUR NEW PAGES — each its own module for the same reason `leafDocument.ts` and
// `policyDocument.ts` are separate from `render.ts`: one file, one surface, one thing to read to
// understand it. All four call `page()` from `./src/render.ts` rather than building their own
// document shell, the same "one renderer" rule `export.mjs`'s header states for the leaf page.
const { renderOverviewPage } = await import("./src/overview.ts").catch(explainFailedWorkspaceImport);
const { renderGardenPage } = await import("./src/garden.ts").catch(explainFailedWorkspaceImport);
const { renderPolicyPage } = await import("./src/policyPage.ts").catch(explainFailedWorkspaceImport);
const { publishLauncher, renderPublishPage } = await import("./src/publishPreview.ts").catch(explainFailedWorkspaceImport);
// SCARLET — the AG-UI run. Three modules, one concern each: the wire (`agui.ts`: events, the
// input parser, the ordering machine), the model edge (`scarletModel.ts`: Ollama over loopback),
// and the run itself (`scarletRun.ts`: the one sequence of events, over any sink). This file owns
// only the transport: the gates, the stream's headers, and the socket-closing signal.
const { encodeSse, parseRunAgentInput } = await import("./src/agui.ts").catch(explainFailedWorkspaceImport);
const { LOCAL_MODEL_ENV, resolveModelConfig, streamChat } = await import("./src/scarletModel.ts").catch(
  explainFailedWorkspaceImport,
);
const { modelFileFor, readSavedModel, saveSelectedModel, discoverInstalledModels } = await import("./src/scarletModelSetup.ts").catch(explainFailedWorkspaceImport);
const { SCARLET_SETUP_ROUTE, renderScarletSetup } = await import("./src/scarletSetupPage.ts").catch(explainFailedWorkspaceImport);
const { runObservedScarlet: runScarlet } = await import("./src/ladybugObserved.ts").catch(explainFailedWorkspaceImport);
const { renderScarletWorkspace } = await import("./src/scarletWorkspace.ts").catch(explainFailedWorkspaceImport);
const { readScarletSelection } = await import("./src/scarletTools.ts").catch(explainFailedWorkspaceImport);
const { resolveScarletContext, scarletResourceDigest } = await import("./src/scarletContext.ts").catch(explainFailedWorkspaceImport);
const { effectivePolicyDigest } = await import("./src/policyDocument.ts").catch(explainFailedWorkspaceImport);
// THE SCARLET PAGE — the same run, collected instead of streamed, rendered as one HTML answer.
// `scarletPage.ts` is pure (three views in, one page out); this file gives it the outcome.
const { QUESTION_MAX_CHARS, httpStatusForScarlet, renderScarletPage } = await import("./src/scarletPage.ts").catch(
  explainFailedWorkspaceImport,
);

const { openWorkflow, SourceRefusal } = await import("./src/workflow.ts");
const { renderJevWorkflow } = await import("./src/jevWorkflowPage.ts");
const { createSourceConnections } = await import("./src/sourceConnections.ts");
const { createAssessmentConnection } = await import("./src/assessmentConnection.ts");
const sourceConnections = createSourceConnections(process.env);
const assessmentConnection = createAssessmentConnection(process.env);
const { renderWorkReflection } = await import('./src/workReflection.ts');
const { renderJourneyWorkspace } = await import('./src/journeyWorkspace.ts');
const { journeyAction } = await import('./src/journeyActions.ts');
const { createJourneySessions } = await import('./src/journeySession.ts');
const journeySessions = createJourneySessions();
const { portfolioPipeline } = await import("./src/portfolioPipeline.ts");
const { readHostedStatus } = await import("./src/hostedStatus.ts");
const { portfolioFreshness } = await import("./src/portfolioFreshness.ts");
const { workflowPacket } = await import("./src/workflowContext.ts");
const { exportWorkflowTransfer } = await import("./src/workflowTransfer.ts");
const { renderWorkflowTransfer } = await import("./src/workflowTransferPage.ts");
/** @type {Awaited<ReturnType<typeof openWorkflow>> | null} */
let workflow = null;
let workflowFailure = "Start with foliage up to enable a private workflow directory.";
/** @type {ReturnType<typeof setInterval> | undefined} */
let workflowTimer;

/*
 * THIS GARDEN'S BRAIN, KEPT CURRENT (unit 38, build order item 5). After every POST this server
 * answers (a review decision, a promotion, an edit), after every collection pass (the first runs
 * at start, so it also catches what changed while nothing was running), and every 30 seconds, a
 * refresh is requested behind the answer. The 30-second check catches anything else that writes
 * leaf.json or harvest.json, such as a hand edit or harvest.mjs run directly; publishing writes
 * only the published copy, which the brain does not hold. Each request first compares the
 * record's bytes with the brain's manifest and starts nothing when they match or when the garden
 * has no brain; a refresh that fails leaves the brain behind with its cause and never touches the
 * answer. Only a garden whose leaf.json and harvest.json sit side by side has a brain to keep.
 */
const { brainGardenOf, brainUpkeep: keepBrain } = await import("./src/brainUpkeep.ts");
const brainGarden = process.env[DOCUMENT_ENV]?.trim() && process.env[HARVEST_ENV]?.trim()
  ? brainGardenOf(resolve(String(process.env[DOCUMENT_ENV]).trim()), resolve(String(process.env[HARVEST_ENV]).trim()))
  : null;
const brainUpkeep = brainGarden === null ? null : keepBrain(brainGarden, { log: line => console.error(`[brain] ${line}`) });
/** The 30-second digest check. */
const BRAIN_CHECK_MS = 30_000;

const PORT = Number(process.env["PORT"] ?? 4174);
const HOST = process.env["HOST"] ?? "127.0.0.1";
if (HOST !== "127.0.0.1" && HOST !== "::1") {
  process.stderr.write("leaf: Refused non-loopback HOST. The private workspace has no network authentication; use 127.0.0.1 or ::1.\n");
  process.exit(1);
}
const modelFile = modelFileFor(process.env);
let savedModel = await readSavedModel(modelFile);
function currentModel() {
  if (resolveModelConfig(process.env).ok) return resolveModelConfig(process.env);
  return savedModel.kind === "selected"
    ? resolveModelConfig({ ...process.env, [LOCAL_MODEL_ENV]: savedModel.name })
    : resolveModelConfig(process.env);
}
/**
 * @param {import("./src/scarletModelSetup.ts").ModelDiscovery | null} [discovery]
 * @param {import("./src/scarletSetupPage.ts").ScarletSetupView["notice"]} [notice]
 * @param {string} [detail]
 * @returns {import("./src/scarletSetupPage.ts").ScarletSetupView}
 */
function setupView(discovery = null, notice = undefined, detail = undefined) {
  const fromEnvironment = resolveModelConfig(process.env);
  return {
    saved: savedModel,
    environmentModel: fromEnvironment.ok ? fromEnvironment.config.model : null,
    gardenSelected: modelFile !== null,
    discovery,
    ...(notice === undefined ? {} : { notice }),
    ...(detail === undefined ? {} : { detail }),
  };
}

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(APP_DIR, "public");

/**
 * Where a file of `@foliage/tokens` actually is, asked of the module resolver rather than assumed
 * from the directory layout — and reached through the package's own export map, so this cannot
 * become a second copy of it. A copied design system goes stale; this one cannot.
 *
 * @param {string} specifier
 * @returns {string}
 */
function resolvePackageFile(specifier) {
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch (error) {
    return explainFailedWorkspaceImport(error);
  }
}

const TOKENS_CSS = resolvePackageFile("@foliage/tokens/tokens.css");
const TOKENS_DIR = dirname(TOKENS_CSS);
const FONTS_DIR = join(TOKENS_DIR, "fonts");

/**
 * Exact request path → exact file. An allow-map rather than a directory walk: for a fixed set
 * of assets there is no user-controlled path component at all, which is a stronger guarantee
 * than any containment check on one.
 *
 * THREE STYLESHEETS FROM THE PACKAGE, IN A FIXED ORDER, and the order is the contract rather than
 * a convenience: `tokens.css` declares the primitives and the face, `roles.css` aliases them by
 * purpose, `foliage.css` is the component layer built on both, and `leaf.css` is this app's own
 * page chrome last. Each is resolved through the export map separately so none of them can be
 * reached by walking out of another one's directory.
 *
 * THE SPRITE IS NOT SERVED, DELIBERATELY. It is inlined per document (see `src/sprite.ts`),
 * because an external `<use href="sprite.svg#id">` renders nothing at all in Blink. A route
 * serving a file no page loads is dark plumbing, so there is not one.
 *
 * `mark-icon.svg` IS served: it is the favicon. The icon tier is the correct asset at 16px —
 * the paired leaflets of the larger tiers close up below ~20px — so this is the mark's smallest
 * shipped drawing being used at exactly the size it was drawn for.
 */
const ASSETS = new Map([
  ["/portfolio-setup.mjs", { file: join(PUBLIC_DIR, "portfolio-setup.mjs"), type: "text/javascript; charset=utf-8" }],
  ["/portfolio-setup.css", { file: join(PUBLIC_DIR, "portfolio-setup.css"), type: "text/css; charset=utf-8" }],
  ["/work-workspace.css", { file: join(PUBLIC_DIR, "work-workspace.css"), type: "text/css; charset=utf-8" }],
  ["/capture.css", { file: join(PUBLIC_DIR, "capture.css"), type: "text/css; charset=utf-8" }],
  ["/controls.css", { file: resolvePackageFile("@foliage/ui/controls.css"), type: "text/css; charset=utf-8" }],
  ["/empty-state.css", { file: resolvePackageFile("@foliage/ui/empty-state.css"), type: "text/css; charset=utf-8" }],
  ["/workspace-shell.css", { file: resolvePackageFile("@foliage/ui/workspace.css"), type: "text/css; charset=utf-8" }],
  ["/portfolio-leaf.css", { file: resolvePackageFile("@foliage/ui/portfolio-leaf.css"), type: "text/css; charset=utf-8" }],
  ["/portfolio-leaf.bundle.js", { file: resolvePackageFile("@foliage/ui/portfolio-leaf.bundle.js"), type: "text/javascript; charset=utf-8" }],
  ["/media-status.mjs", { file: join(PUBLIC_DIR, "media-status.mjs"), type: "text/javascript; charset=utf-8" }],
  ["/portfolio-reader.mjs", { file: join(PUBLIC_DIR, "portfolio-reader.mjs"), type: "text/javascript; charset=utf-8" }],
  ["/presentation-editor.mjs", { file: join(PUBLIC_DIR, "presentation-editor.mjs"), type: "text/javascript; charset=utf-8" }],
  ['/journey-client.mjs', { file: join(PUBLIC_DIR, 'journey-client.mjs'), type: 'text/javascript; charset=utf-8' }],
  ["/compound-leaf.css", { file: join(PUBLIC_DIR, "compound-leaf.css"), type: "text/css; charset=utf-8" }],
  ["/compound-leaf.bundle.js", { file: join(PUBLIC_DIR, "compound-leaf.bundle.js"), type: "text/javascript; charset=utf-8" }],
  ["/workflow.js", { file: join(PUBLIC_DIR, "workflow.js"), type: "text/javascript; charset=utf-8" }],
  ["/workflow.css", { file: join(PUBLIC_DIR, "workflow.css"), type: "text/css; charset=utf-8" }],
  ["/living-work.png", { file: join(PUBLIC_DIR, "living-work.png"), type: "image/png" }],
  ["/tokens.css", { file: TOKENS_CSS, type: "text/css; charset=utf-8" }],
  [
    "/roles.css",
    { file: resolvePackageFile("@foliage/tokens/roles.css"), type: "text/css; charset=utf-8" },
  ],
  [
    "/foliage.css",
    { file: resolvePackageFile("@foliage/tokens/foliage.css"), type: "text/css; charset=utf-8" },
  ],
  ["/mark-primary.svg", { file: join(TOKENS_DIR, "mark-primary.svg"), type: "image/svg+xml" }],
  ["/mark-expressive.svg", { file: join(TOKENS_DIR, "mark-expressive.svg"), type: "image/svg+xml" }],
  ["/mark-icon.svg", { file: join(TOKENS_DIR, "mark-icon.svg"), type: "image/svg+xml" }],
  ["/leaf.css", { file: join(PUBLIC_DIR, "leaf.css"), type: "text/css; charset=utf-8" }],
  ["/portfolio-import.mjs", { file: join(PUBLIC_DIR, "portfolio-import.mjs"), type: "text/javascript; charset=utf-8" }],
  ["/portfolio-import.css", { file: join(PUBLIC_DIR, "portfolio-import.css"), type: "text/css; charset=utf-8" }],
  ["/scarlet.css", { file: join(PUBLIC_DIR, "scarlet.css"), type: "text/css; charset=utf-8" }],
  ["/scarlet-client.mjs", { file: fileURLToPath(new URL("./public/scarlet-client.mjs", import.meta.url)), type: "text/javascript; charset=utf-8" }],
  ["/scarlet-stream.mjs", { file: fileURLToPath(new URL("./public/scarlet-stream.mjs", import.meta.url)), type: "text/javascript; charset=utf-8" }],
]);

/** Font file names only — no separators, no dots beyond the extension, no traversal to escape. */
const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;

/**
 * Resolve a `/fonts/...` request to a file inside the tokens package, or null.
 *
 * Fonts belong to `@foliage/tokens` because the open set has to stand alone: an open-plane app
 * whose typefaces live in a proprietary package renders in fallback faces for anyone who forks
 * only the open packages, which would quietly break the self-hosting claim. This route is
 * therefore deliberately pointed at the tokens package and NOT at any cloud-plane directory.
 * All four woff2 now live there and resolve through the package export map; a name that does
 * not match `FONT_NAME`, or that escapes `FONTS_DIR`, is a 403 rather than a read.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function fontPath(pathname) {
  const name = pathname.slice("/fonts/".length);
  if (!FONT_NAME.test(name) || name !== basename(name)) return null;
  const candidate = resolve(join(FONTS_DIR, name));
  if (candidate !== FONTS_DIR && !candidate.startsWith(FONTS_DIR + sep)) return null;
  return candidate;
}

/**
 * The Content-Security-Policy every response carries, and the ONE thing that varies in it.
 *
 * `form-action 'none'` blocks form submission outright — which is correct for every surface that
 * has no form, and fatal for the two that do. So the review page and the Photosynthesis page are served
 * with `'self'` and nothing else is. Relaxing it globally would mean an injected form on the leaf
 * page could post to this server; keeping it per-response means the only pages that can submit
 * anything are the pages that have something to submit.
 *
 * `frame-ancestors 'none'` IS NOT INHERITED FROM `default-src`, and that is the whole reason it is
 * written out. `frame-ancestors` is one of the directives that does not fall back — with it absent
 * every page this server has ever served could be framed by any page on the internet, which is the
 * setup for clickjacking the one control this product has: an invisible cross-origin frame over
 * `/review` and a "click here" button placed over Approve. The Origin check refuses that POST, so
 * the frame could not have recorded a decision — but that defence is the second one, and a policy
 * whose first line is missing is not a policy. Verified absent repo-wide before this line existed.
 *
 * `img-src 'self'` is UNCHANGED and deliberately not widened. The sprite is inlined into the
 * document rather than fetched, and the only image request any page makes is the favicon, which is
 * same-origin. `style-src 'self'` likewise stays without `'unsafe-inline'`: no surface here carries
 * a style attribute, and `src/sprite.ts` documents the one place that had to be written differently
 * to keep it that way.
 *
 * @param {boolean} allowForm
 * @returns {string}
 */
function csp(allowForm) {
  return (
    `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; ` +
    `frame-ancestors 'none'; form-action ${allowForm ? "'self'" : "'none'"}`
  );
}

/**
 * The headers EVERY response carries, whatever its body — a page, a refusal, a font, an event
 * stream. One function, so a new kind of response cannot be added without them.
 *
 * @param {boolean} allowForm
 * @returns {Record<string, string>}
 */
function securityHeaders(allowForm) {
  return {
    // A leaf is read from disk on every request; a cached copy would show stale evidence.
    "cache-control": "no-store",
    // The page renders only its own markup and one same-origin stylesheet each. Saying so
    // means an injected string could not become an executing script even if escaping failed.
    "content-security-policy": csp(allowForm),
    "x-content-type-options": "nosniff",
    // THE PRIVACY HEADER AND THE CSRF CHECK WERE IN DIRECT CONFLICT, and only a real browser
    // showed it. Per Fetch ("append a request Origin header"), a non-CORS POST from a page whose
    // referrer policy is `no-referrer` gets `Origin: null` — the policy nulls the ORIGIN header,
    // not just the Referer. Measured: clicking Reject on the served queue in a real browser
    // produced `refused: the Origin header "null" is not a URL`, while every test stayed green
    // because Node's fetch sends whatever Origin it is told to. So the page that carries a form
    // relaxes to `same-origin`, which sends this server its own origin and still sends nothing to
    // anyone else. Every other response keeps `no-referrer`.
    "referrer-policy": allowForm ? "same-origin" : "no-referrer",
  };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} type
 * @param {string | Buffer} body
 * @param {boolean} headOnly
 * @param {{ allowForm?: boolean, allow?: string, location?: string, close?: boolean, sameOriginResource?: boolean, scarletWorkspace?: boolean, compoundWorkspace?: boolean, portfolioWorkspace?: boolean, captureWorkspace?: boolean, setupWorkspace?: boolean, setupPreview?: boolean, pairedFormOrigin?: string | null }} [options]
 */
function send(res, status, type, body, headOnly, options = {}) {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  /** @type {Record<string, string | number>} */
  const headers = {
    "content-type": type,
    "content-length": buf.byteLength,
    ...securityHeaders(options.allowForm === true),
    ...(options.allowForm && options.pairedFormOrigin ? { "content-security-policy": csp(true) + " " + options.pairedFormOrigin } : {}),
  };
  // Script/connect permissions belong only to the private workspace response. No inline script,
  // third-party hosts, evaluation, framing, or change to any published/document response.
  if (options.scarletWorkspace === true || options.compoundWorkspace === true) {
    headers["content-security-policy"] = csp(true) + "; script-src 'self'; connect-src 'self'; object-src 'none'";
  }
  if (options.portfolioWorkspace === true) {
    headers["content-security-policy"] = csp(true) + "; script-src 'self'; connect-src 'self'; object-src 'none'";
  }
  if (options.captureWorkspace === true) {
    headers["content-security-policy"] = csp(true) + "; media-src 'self'; object-src 'none'";
  }
  // Only the owner's saved-reader preview can be framed, and only by this exact origin.
  if (options.setupWorkspace === true) headers["content-security-policy"] = csp(true) + "; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'";
  if (options.setupPreview === true) headers["content-security-policy"] = csp(false).replace("frame-ancestors 'none'", "frame-ancestors 'self'");
  if (options.allow !== undefined) headers["allow"] = options.allow;
  if (options.location !== undefined) headers["location"] = options.location;
  // `close` is for a request body this server stopped reading (see `readBody`): Node ends the
  // socket after this response is flushed, instead of waiting for a body nobody will consume.
  if (options.close === true) headers["connection"] = "close";
  if (options.sameOriginResource === true) headers["cross-origin-resource-policy"] = "same-origin";
  res.writeHead(status, headers);
  if (headOnly) res.end();
  else res.end(buf);
}

/**
 * Open a server-sent event stream: status 200 and the headers flushed NOW, before any event and
 * before the model is contacted, so a client sees the connection succeed at once and a failure
 * that arrives later is an event on the stream, never a status the client can no longer receive.
 *
 * The two writers are guarded: a client that has left has a response that is ended or destroyed,
 * and writing to it would throw from inside the run. The run itself stops emitting when its
 * signal aborts; this guard is the second line.
 *
 * @param {import("node:http").ServerResponse} res
 * @returns {{ write: (frame: string) => void, end: () => void }}
 */
function openEventStream(res) {
  res.writeHead(200, { ...securityHeaders(false), "content-type": "text/event-stream" });
  res.flushHeaders();
  const open = () => !res.writableEnded && !res.destroyed;
  return {
    write: (frame) => {
      if (open()) res.write(frame);
    },
    end: () => {
      if (open()) res.end();
    },
  };
}

/**
 * A switch over a union is total or it does not compile.
 *
 * The `.ts` files write `const impossible: never = x` in a `default:` arm — an ANNOTATION, which the
 * checker enforces: a member the switch does not name is not assignable to `never`, so the file
 * fails to typecheck. This file wrote `@type {never}` around the same value, which reads the same
 * and is a CAST — a type assertion is permitted whenever one side is assignable to the other, and
 * `never` is assignable to everything. Measured on PR #28: deleting the `TEXT_MESSAGE_START` case
 * from the Photosynthesis sink still passed `tsc`. A PARAMETER typed `never` is the annotation's check in
 * JSDoc: the argument has to be `never`, and a member left unhandled is not.
 *
 * @param {never} impossible
 * @returns {never}
 */
function unreachable(impossible) {
  throw new Error(`unhandled: ${JSON.stringify(impossible)}`);
}

/* ----------------------------------------------------------------- the publish policy ---- */

/**
 * WHAT THIS SERVER DOES WHEN THE PUBLISH POLICY CANNOT BE READ: it serves nothing at all, in
 * plain text, naming the file and the cause.
 *
 * FAIL CLOSED, AND THE HARSH PART IS THE POINT. A missing file is NOT this case — that is a
 * successful load of the shipped default rules, announced as such. This is a file that exists
 * and does not parse, and there is exactly one wrong thing to do with it: fall back to the
 * default. The subject's own rules may be STRICTER than the default, so swapping them for
 * something looser at the moment they break is how one typo becomes an exposure. Refusing costs
 * visibility until they fix it and cannot cost anything else.
 *
 * `/` GOES DOWN WITH IT, deliberately, even though it is a loopback surface for the subject
 * alone. That page prints every leaflet's title and offers the links, and both are governed by
 * the rail — a leaf page rendered without a policy would be showing "Open this leaflet" beside
 * work the rules may refuse. And it is the loudest possible signal: the subject learns their file
 * is broken the moment they look, rather than at the moment a stranger reads something.
 *
 * 503 and not 500: the request is fine, the service is refusing until an operator acts, and the
 * body says which file to act on. Published artifacts and media keep this plain refusal; the
 * private UI uses a recovery page containing no Leaf content and no policy-derived links.
 *
 * @param {Extract<import("./src/policyDocument.ts").PolicyLoad, { ok: false }>} load
 * @returns {string}
 */
function policyRefusal(load) {
  const lines = [
    `refused: the publish policy could not be read, so nothing is served.`,
    ``,
    `cause: ${load.cause}`,
    `${load.detail}`,
  ];
  if (load.cause === "invalid") {
    for (const issue of load.issues) lines.push(`  ${issue.at}: ${issue.message}`);
  }
  lines.push(
    ``,
    `Fix the file, or unset ${POLICY_ENV} to fall back to the shipped default rules — which is`,
    `a decision this server will not make on your behalf, because your rules may be stricter`,
    `than the default and quietly loosening them is the one direction that cannot be undone.`,
    ``,
  );
  return lines.join("\n");
}

/**
 * A policy failure on an owner page retains navigation without rendering governed content.
 * @param {import("node:http").ServerResponse} res
 * @param {Extract<import("./src/policyDocument.ts").PolicyLoad, { ok: false }>} load
 * @param {boolean} headOnly
 * @param {import("./src/render.ts").NavKey} nav
 * @param {URL} requestUrl
 */
function sendPolicyRecovery(res, load, headOnly, nav, requestUrl) {
  send(res, 503, "text/html; charset=utf-8", renderPolicyRecovery(load, nav, requestUrl.pathname + requestUrl.search), headOnly);
}

/* ------------------------------------------------------------------------ serving media ---- */

/*
 * Where the bytes are served from: `/media/sha256:<64 hex>`.
 *
 * The address IS the evidence ref, character for character as the leaf document writes it. That
 * is not a formatting choice — it means the link on a page and the ref in the JSON cannot drift
 * apart, and anyone can check a served image by hand with `shasum -a 256` against the same string
 * they can read in their own file.
 *
 * `MEDIA_ROUTE` is IMPORTED from `render.ts` above rather than declared here. It was declared in
 * both for as long as no page linked to an image; the moment one did, two constants spelling one
 * address is a broken link waiting for whichever of them changes first — the same rule, and the
 * same reason, as `LEAFLET_ROUTE`.
 */

/**
 * The store this server reads, which must be the one the scan wrote.
 *
 * `FOLIAGE_MEDIA` wins if set; otherwise `media/` beside the leaf document THAT WAS ACTUALLY
 * LOADED — not beside the configured path, because the two differ the moment a load falls back or
 * an operator points `FOLIAGE_LEAF` at the example. `readImages` derives the same default from the
 * same two variables, so the writer and the reader agree by construction rather than by comment.
 *
 * @param {string} documentPath
 * @returns {string}
 */
function mediaRootForDocument(documentPath) {
  const configured = process.env[MEDIA_ENV];
  if (configured !== undefined && configured.trim() !== "") return resolve(configured.trim());
  return mediaRootFor(documentPath);
}

/**
 * Every evidence ref one leaflet rests on: its own provenance and each body element's.
 *
 * BOTH, because a leaflet's photograph can be either. `photoIntake.ts` drafts a candidate whose
 * single evidence entry is the image, and a body element carries its own ref by design — reading
 * only one of the two would make an image visible on one kind of leaflet and 404 on another, for
 * a reason nobody could see from the page.
 *
 * @param {import("@foliage/leaf").Leaflet} leaflet
 * @returns {string[]}
 */
function refsOf(leaflet) {
  const refs = [];
  if (leaflet.provenance !== undefined) refs.push(leaflet.provenance.ref);
  for (const element of leaflet.body ?? []) {
    if (element !== null && typeof element === "object" && element.provenance !== undefined) {
      refs.push(element.provenance.ref);
    }
  }
  return refs;
}

/**
 * Serve one object, or say exactly why not.
 *
 * GATED TWICE, AND THE FIRST GATE IS THE ONE THAT MATTERS. A content-addressed store keyed by
 * digest would otherwise be an open read of any bytes on this machine that anyone can name — and
 * worse, a probe: an address that answered differently for a held digest would let a caller learn
 * which photographs exist. So a ref is served ONLY when some leaflet in the loaded document names
 * it AND that leaflet would itself be served at its own address — the same `findLeaflet` call,
 * with the same visibility rule and the same publish policy. Unsharing a leaflet takes its
 * photograph with it, in the same act, with no second thing to remember.
 *
 * THREE OUTCOMES AND THEY ARE NOT THE SAME OUTCOME:
 *
 *   404  the ref is malformed, no served leaflet names it, or the store does not hold it. One
 *        answer for all three, exactly as `/leaflet/<id>` collapses missing and private, and for
 *        the same reason: any difference between them is a way to enumerate somebody's evidence.
 *   500  the store holds bytes at that address which are NOT what the ref names — truncated,
 *        edited, half-written. This is OURS and it is loud. Reporting it as 404 would let a
 *        corrupted store keep looking like an empty one, and the whole promise of a digest is
 *        that this case is detectable.
 *   200  the bytes, hashed in this call, immediately before they are written to the socket.
 *
 * @param {string} ref
 * @returns {Promise<{ status: number, type: string, body: string | Buffer }>}
 */
/** @param {string} ref  @param {"private"|"published"} [audience] */
async function serveMedia(ref, audience = "published") {
  const parsed = parseMediaRef(ref);
  const load = await loadLeafDocument();
  if (!load.ok) {
    // NOT a 404. Nothing was read, so nothing is known about this ref — saying "not found" would
    // be a claim about the store made by a process that never opened it.
    return {
      status: httpStatusFor(load),
      type: "text/plain; charset=utf-8",
      body: `the leaf document could not be read (${load.cause}), so no media is served.\n${load.detail}\n`,
    };
  }
  const policy = await loadPublishPolicy();
  if (!policy.ok) {
    return { status: 503, type: "text/plain; charset=utf-8", body: policyRefusal(policy) };
  }

  const notFound = {
    status: 404,
    type: "text/plain; charset=utf-8",
    body: `no media at ${MEDIA_ROUTE}${ref}\n`,
  };
  if (!parsed.ok) return notFound;

  // On the OWNER route the share rail does not apply: the bytes are the owner's own file,
  // hashed off their own disk, and a leaflet merely has to NAME the digest. The share route's
  // gate below is the egress rail for everyone else, and the seam tests pin it.
  const visible = load.leaf.leaflets.filter(leaflet =>
    audience === "private" || findLeaflet(load.leaf, String(leaflet.id), policy.policy).ok,
  );
  const named = visible.some(leaflet => refsOf(leaflet).includes(parsed.ref));
  if (!named) return notFound;

  const videoNamed = visible.some(leaflet => (leaflet.body ?? []).some(element =>
    element.provenance.ref === parsed.ref && "media" in element && element.media.mediaType === "video/mp4",
  ));
  if (videoNamed) {
    // The local public route has no separate video-selection document. A Leaflet share alone
    // never opens a clip; only the owner route, an explicitly selected static export, or a
    // Canopy publication with a selected video may serve it.
    if (audience !== "private") return notFound;
    const { readVideo, videoRootFromEnv } = await import("./src/videoStore.ts");
    const video = await readVideo(videoRootFromEnv({ ...process.env, FOLIAGE_LEAF: load.source.path }), parsed.ref);
    if (!video.ok) {
      if (video.cause === "digest-mismatch") {
        console.error(`[leaf] ${MEDIA_ROUTE}${parsed.ref}: ${video.detail}`);
        return { status: 500, type: "text/plain; charset=utf-8", body: `refused: ${video.detail}\n` };
      }
      return notFound;
    }
    return { status: 200, type: video.mimeType, body: video.bytes };
  }

  const media = await readMedia(mediaRootForDocument(load.source.path), parsed.ref);
  if (!media.ok) {
    if (media.cause === "digest-mismatch") {
      console.error(`[leaf] ${MEDIA_ROUTE}${parsed.ref}: ${media.detail}`);
      // The store's own sentence, not a second one wrapped around it. Two sentences saying the
      // same thing is how an error page becomes a paragraph nobody reads.
      return { status: 500, type: "text/plain; charset=utf-8", body: `refused: ${media.detail}\n` };
    }
    return notFound;
  }
  return { status: 200, type: media.contentType, body: media.bytes };
}

/* ---------------------------------------------------------------- the harvest document ---- */

/**
 * Where the harvest document lives by default: the same path `harvest.mjs` writes to, so the
 * queue in the browser and the queue in the terminal are the same queue by default rather than
 * by coincidence. Outside `public/`, and gitignored, for the same reason the leaf document is —
 * it holds verbatim commit subjects out of a real repository.
 */
const DEFAULT_HARVEST_PATH = resolve(APP_DIR, "harvest.json");

/** Whether every collection source is paused, so the undecided git drafts wait out of sight. */
function reviewPaused() {
  const state = workflow?.snapshot();
  return state !== undefined && queuePaused(state.sources);
}

/**
 * How /review orders and filters the one queue: Jev's current marks place rows keep, open, pass,
 * and a check that was interrupted or failed can be retried while TypeSafe is configured. The
 * marks live in the workflow, never in the harvest, and reach no other page.
 * @param {import("@foliage/photosynthesis").HarvestDocument | null} harvest
 * @returns {Promise<import("./src/render.ts").ReviewQueueView>}
 */
async function reviewView(harvest) {
  const paused = reviewPaused();
  if (workflow === null || harvest === null) return { marks: new Map(), retry: new Set(), paused };
  const jev = await workflow.jevView(harvest);
  return { marks: jev.marks, retry: process.env["TYPESAFE_API_KEY"]?.trim() ? jev.retry : new Set(), paused };
}

/**
 * The one queue's open count, exactly as /review shows it, for every surface that links there.
 * Null when the harvest cannot be read: an unread queue is not an empty one.
 * @returns {Promise<number | null>}
 */
async function openReviewCount() {
  const load = await loadHarvestDocument();
  return load.ok ? shownQueue(load.harvest.candidates, reviewPaused()).open : null;
}

/**
 * The first open draft in the visible, ordered queue /review shows, or none.
 * @param {import("@foliage/photosynthesis").HarvestDocument} harvest
 */
async function firstOpenDraft(harvest) {
  const view = await reviewView(harvest);
  const visible = shownQueue(harvest.candidates, view.paused);
  return { open: visible.open, next: orderReviewQueue(visible.shown, view.marks).open[0]?.candidate };
}

/** One private preview from the same visible, ordered queue as /review. Reads never decide. */
async function nextReviewSummary() {
  const load = await loadHarvestDocument();
  if (!load.ok) return { open: null, next: null };
  const { open, next } = await firstOpenDraft(load.harvest);
  const id = next ? encodeURIComponent(next.id) : null;
  return {
    open,
    next: next ? { id: next.id, title: next.title, href: `/review?focus=${id}#candidate-${id}` } : null,
  };
}

/**
 * Load and gate the harvest document. FIVE NAMED CAUSES, never a null and never an empty queue:
 * a review surface that renders "nothing to review" when the file is unreadable is telling the
 * operator their drafting produced nothing, about a file it never opened.
 *
 * This mirrors `loadLeafDocument` deliberately rather than sharing it — the two read different
 * formats through different gates — and it lives here because I/O belongs to the app, not to the
 * renderer. `env` is a parameter for the same reason it is one there.
 *
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {Promise<import("./src/render.ts").HarvestLoad>}
 */
async function loadHarvestDocument(env = process.env) {
  const configured = env[HARVEST_ENV];
  if (configured !== undefined && configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail:
        `${HARVEST_ENV} is set but blank, so no harvest path could be determined. Either unset ` +
        `it — the default is then ${DEFAULT_HARVEST_PATH} — or set it to the path of your ` +
        `harvest document.`,
    };
  }
  const path = configured === undefined ? DEFAULT_HARVEST_PATH : resolve(configured.trim());

  /** @type {Buffer} */
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
    if (code === "ENOENT") {
      return {
        ok: false,
        cause: "absent",
        detail:
          `No harvest document was found at ${path}` +
          (configured === undefined
            ? ` (the default location — set ${HARVEST_ENV} to use a different path).`
            : ` (from ${HARVEST_ENV}).`),
        path,
      };
    }
    return {
      ok: false,
      cause: "unreadable",
      detail: `${path} exists as far as this process can tell, but could not be read: ${
        err instanceof Error ? err.message : String(err)
      } [${code}]`,
      path,
      errno: code,
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0, blaming the first
  // token. Same strip as the leaf loader, for the same hour nobody should lose twice.
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      cause: "malformed",
      detail: `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      path,
    };
  }

  const parsed = parseHarvestDocument(json);
  if (!parsed.ok) {
    return {
      ok: false,
      cause: "invalid",
      detail:
        `${path} is valid JSON but is not a harvest document: ${parsed.issues.length} problem(s), ` +
        `every one of them listed below.`,
      path,
      issues: parsed.issues,
    };
  }
  return { ok: true, harvest: parsed.harvest, path };
}

/** The name a first record needs for the review queue's drafts to be added to it, or none. */
async function boundRecordName() {
  const load = await loadHarvestDocument();
  const start = load.ok ? recordStart(load.harvest) : null;
  return start?.addable ? start.name : null;
}

/* ------------------------------------------------------------------- the review POST ---- */

/**
 * A form body ceiling. A rejection reason is a sentence, not a file; anything past this is either
 * a mistake or somebody probing, and both deserve a named refusal rather than an unbounded read
 * into this process's memory.
 */
const MAX_FORM_BYTES = 64 * 1024;

/** Makes each write-back's temp file name unique within this process. See `recordDecision`. */


/**
 * What a route expects in a request body: the media type, what to call it in a refusal, and the
 * ceiling in bytes. Two of these exist and they differ only here — one reader serves both.
 *
 * @typedef {{ type: string, what: string, max: number }} BodyShape
 */

/** @type {BodyShape} */
const FORM_BODY = { type: "application/x-www-form-urlencoded", what: "a form submission", max: MAX_FORM_BYTES };

/**
 * A run's ceiling. An AG-UI input carries a conversation, and a conversation about one leaf is
 * text a person typed plus what the model answered — larger than a form, nowhere near a file.
 * Anything past this is refused by name, like the form, before it is read to the end.
 */
const MAX_RUN_BYTES = 256 * 1024;

/** @type {BodyShape} */
const RUN_BODY = { type: "application/json", what: "an AG-UI RunAgentInput", max: MAX_RUN_BYTES };

/**
 * Read a request body of one declared shape, or say exactly why not.
 *
 * Streamed with a running byte count rather than trusting `content-length`, which is a claim the
 * client makes about itself. The caller decodes the text — `URLSearchParams` for a form,
 * `JSON.parse` for a run — because what a body MEANS is the route's business and how many bytes
 * of it to accept is this function's.
 *
 * THE CEILING STOPS THE READ, NOT THE SOCKET. Destroying the request the moment the ceiling was
 * crossed — what this reader did until 2026-09-02 — meant the 413 was written to a socket that
 * was already gone, and every client saw a connection reset instead of the refusal (measured:
 * `UND_ERR_SOCKET` from Node's fetch, on the form path and the run path alike). Now the read is
 * paused, the refusal carries `close: true` so the route answers with `connection: close`, and
 * Node closes the socket once the 413 has been flushed. Measured over loopback: a body up to
 * 1 MiB over the ceiling reads the 413 every time; a client still pushing 8 MiB may see the reset
 * first, which is HTTP/1.1 without `Expect: 100-continue` and not something a server can fix.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {BodyShape} shape
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: 415 | 413 | 400, detail: string, close: boolean }>}
 */
function readBody(req, shape) {
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith(shape.type)) {
    req.resume();
    return Promise.resolve({
      ok: false,
      status: /** @type {const} */ (415),
      detail: `this endpoint takes ${shape.type} — ${shape.what}; the request said "${type === "" ? "(nothing)" : type}".`,
      close: false,
    });
  }
  return new Promise((resolveBody) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    /** @param {{ ok: true, text: string } | { ok: false, status: 415 | 413 | 400, detail: string, close: boolean }} outcome */
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolveBody(outcome);
    };
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      size += chunk.length;
      if (size > shape.max) {
        req.removeListener("data", onData);
        req.pause();
        settle({
          ok: false,
          status: 413,
          detail: `${shape.what} passed ${shape.max} bytes and was not read to the end.`,
          close: true,
        });
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => settle({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", (err) => settle({ ok: false, status: 400, detail: `${shape.what} could not be read: ${err.message}`, close: false }));
  });
}

/**
 * Is this POST from a page this server served?
 *
 * THE ATTACK THIS CLOSES, stated because "it is localhost" is exactly the reasoning that leaves it
 * open: binding to 127.0.0.1 keeps other machines out and does nothing about the browser the
 * operator is already running. Any page on the internet may submit a form cross-origin, and this
 * endpoint writes to a file.
 *
 * TWO SIGNALS, IN ORDER OF HOW MUCH THEY ARE WORTH.
 *
 *   `Sec-Fetch-Site` is set by the browser itself and a page cannot influence it, which makes
 *   `same-origin` a stronger statement than anything in `Origin` — and it is the header designed
 *   for exactly this question. When it is present it DECIDES, in both directions: a value other
 *   than `same-origin` is the browser saying this came from somewhere else, and no `Origin` can
 *   argue with that.
 *
 *   `Origin` is the fallback, for a client that sends no `Sec-Fetch-Site` — a non-browser tool,
 *   or a browser older than the header. It is compared on HOST, not on the whole origin string:
 *   the scheme in `Origin` is the browser's view and can differ from this server's behind a
 *   proxy, while the host is what identifies the endpoint. `null` is refused — that is what a
 *   cross-site page with a `no-referrer` policy produces, and it is not an origin.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {{ ok: true } | { ok: false, detail: string }}
 */
function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "") {
    if (site === "same-origin") return { ok: true };
    return {
      ok: false,
      detail:
        `the browser marked this POST Sec-Fetch-Site: ${site}. A page somewhere else may not ` +
        `act on this server.`,
    };
  }

  const origin = req.headers["origin"];
  const host = req.headers["host"];
  if (typeof origin !== "string" || origin === "") {
    return {
      ok: false,
      detail:
        `this POST carried no Origin header. Every browser sends one on a POST, so a request ` +
        `without one is either a cross-site attempt or a non-browser client, and a non-browser ` +
        `client can send it: -H "Origin: http://${String(host ?? HOST)}".`,
    };
  }
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, detail: `the Origin header "${origin}" is not a URL.` };
  }
  if (typeof host !== "string" || parsed.host !== host) {
    return {
      ok: false,
      detail:
        `this POST came from ${parsed.host} and this server is ${String(host ?? "(no Host)")}. A ` +
        `page somewhere else may not act on this server.`,
    };
  }
  return { ok: true };
}

/**
 * F-025, THE SERVER-SIDE COPY. `harvest.mjs`'s own `promote`/`approve`/`reject` just closed the
 * identical shape: a write must never run against a document silently guessed from an unset
 * flag. Here the flags are environment variables — `loadHarvestDocument`/`loadLeafDocument`
 * still default a genuinely UNSET `FOLIAGE_HARVEST`/`FOLIAGE_LEAF` to a well-known path beside
 * this script, exactly as `harvest.mjs`'s CLI defaults used to before F-025 — and a bare
 * `node apps/leaf/server.mjs` (skipping `foliage up`, the launcher that sets both) let every
 * Approve/Reject/Promote click silently read AND REWRITE whatever sat there instead of the
 * garden the operator actually meant.
 *
 * CHECKED HERE, AT EACH WRITE ROUTE, DELIBERATELY NOT AT PROCESS STARTUP. The sweep this fix is
 * built on found TWO reasons a hard startup refusal would be the wrong shape, not merely a
 * stricter one:
 *
 *   1. `README.md`'s own "Self-host one leaf" section documents a bare `node
 *      apps/leaf/server.mjs` — no env vars at all — as a first-class way to run this server for
 *      the single-document case (`apps/leaf/leaf.json` / `apps/leaf/harvest.json`, right beside
 *      the app). That mode is genuinely safe on its own terms: there is exactly one document,
 *      so no OTHER document's identity is ever silently substituted for it. The hazard is
 *      specifically the GARDEN case — a stale document sitting at the default path while the
 *      operator's real one lives elsewhere — which a process cannot tell apart from the safe
 *      case before it has read anything.
 *   2. The seam-test suite spawns this server with only ONE of the two env vars set at dozens
 *      of call sites (`seam.test.ts`, `csp.test.ts`, `mediaSeam.test.ts` and others), each
 *      deliberately exercising the OTHER document's `absent`/`unconfigured` READ-path state. A
 *      hard startup gate would refuse to boot every one of them for a mistake none of them make.
 *
 * Reading (`GET /`, `GET /review`, `GET /leaflet/<id>`) is UNCHANGED and keeps the existing
 * default — misreading a document is confusing, never destructive. Only the two routes that
 * WRITE gain this guard: `recordDecision` (records an approve/reject into the harvest document)
 * and `carryIntoLeaf` (appends promoted leaflets to the leaf — and reads the harvest document
 * for what to promote, so it checks BOTH vars, mirroring `promote`'s own `--doc` AND `--into`).
 *
 * A THIRD INDEPENDENT COPY of this exact shape turned up in
 * `apps/photosynthesis/review-server.mjs`'s `/decide` and `/promote` — three writers finding the
 * same bug independently is the fix-the-class signal. The JUDGMENT (is every configured value
 * this write depends on actually present, never a guess) is now `writeGuard`
 * (`@foliage/photosynthesis`), ONE pure function both servers' write routes call; only the
 * `process.env` READ stays local to each, per the repo's effects-at-the-edges law. This function
 * is the thinnest possible wrapper around it: read the names, hand the values to `writeGuard`,
 * translate its verdict into this app's own response shape.
 *
 * @param {readonly string[]} names - the env var name(s) this write route's document(s) depend on
 * @returns {{ status: number, plain: true, body: string } | null} null means proceed
 */
function refuseIfUnconfigured(names) {
  // THE ENV READ IS THE ONLY EFFECT HERE — `process.env[name]` — and it happens right at this
  // edge; the JUDGMENT itself is `writeGuard` (`@foliage/photosynthesis`), the one shared, pure
  // rule now behind every writer this class of bug has been found in (F-025: harvest.mjs's own
  // promote/approve/reject, this function, and apps/photosynthesis/review-server.mjs).
  const verdict = writeGuard(Object.fromEntries(names.map((name) => [name, process.env[name]])));
  if (verdict.ok) return null;
  const missing = verdict.missing;
  return {
    status: 409,
    plain: true,
    body:
      `refused: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set, so this ` +
      `server will not guess which document to write. Launch through \`foliage up\` (sets ` +
      `${missing.length === 1 ? "it" : "both"} automatically for the current garden), or export ` +
      `${missing.join(" and ")} yourself. NOTHING was written.\n`,
  };
}

/**
 * Record one review decision, or refuse with a named cause. The refusals are the CLI's refusals —
 * `harvest.mjs` will not reject without `--reason`, will not decide without `--by`, and will not
 * re-decide a decided candidate — because the two commands write the same file and a browser that
 * could record what the terminal refuses would make the document's own rules a matter of which
 * tool you happened to use.
 *
 * The write is temp-then-rename, atomic on one filesystem, so a crash mid-write leaves the
 * previous document whole rather than half of a new one. And the bytes are put through
 * `parseHarvestDocument` BEFORE they reach the disk: this surface may not write a document its own
 * loader would refuse.
 *
 * @param {URLSearchParams} fields
 * @returns {Promise<{ status: number, body: string, location?: string, plain?: boolean }>}
 */
async function recordDecision(fields) {
  const unconfigured = refuseIfUnconfigured([HARVEST_ENV]);
  if (unconfigured !== null) return unconfigured;
  const draft = { id: fields.get("id") ?? "", by: fields.get("by") ?? "", reason: fields.get("reason") ?? "", title: fields.get("title") ?? "" };
  const query = (fields.get("q") ?? "").trim().slice(0, 200);

  // Match the loaders' path normalization before choosing the lock's identity.
  return withDocumentLocks([resolve(String(process.env[HARVEST_ENV]).trim())], async () => {
  const load = await loadHarvestDocument();
  if (!load.ok) {
    // There is nothing to decide on, so NOTHING WAS WRITTEN — and the status has to say that.
    // This answered `httpStatusForHarvest(load)`, which is 200 for `absent`: a POST that created
    // no file and changed none answered OK, and the body never mentioned the decision at all.
    // The status now comes from the function that judges an attempted WRITE, and the body carries
    // the banner that names the cause. See `httpStatusForUnwritable` for why 409 and not 404.
    return { status: httpStatusForUnwritable(load), body: renderReviewWriteRefused(load) };
  }

  const id = (fields.get("id") ?? "").trim();
  const decision = (fields.get("decision") ?? "").trim();
  const by = (fields.get("by") ?? "").trim();
  const reason = (fields.get("reason") ?? "").trim();
  const title = (fields.get("title") ?? "").trim();

  /** @param {import("./src/render.ts").ReviewRefusal} refusal */
  const refuse = async (refusal) => ({
    status: /** @type {number} */ (httpStatusForRefusal(refusal)),
    body: renderReviewPage(load, refusal, await leafIndex(), null, draft, await reviewView(load.harvest), query),
  });

  if (decision !== "approve" && decision !== "reject") {
    return refuse({ cause: "unknown-decision", given: decision });
  }
  const target = load.harvest.candidates.find((c) => c.id === id);
  if (target === undefined) return refuse({ cause: "no-such-candidate", id });
  if (target.review.state !== "candidate") {
    return refuse({ cause: "already-decided", id, state: target.review });
  }
  if (fields.has("subjectDigest") && fields.get("subjectDigest") !== reviewSubjectDigest(target)) {
    return refuse({ cause: "stale-candidate", id });
  }
  if (by === "") return refuse({ cause: "missing-reviewer", id });
  if (decision === "reject" && reason === "") return refuse({ cause: "missing-reason", id });
  // RETITLE AT APPROVAL — same rules, same wording of intent, as the CLI's decide(): a title
  // belongs to approve only, and the no-rating gate judges the human's words exactly as it
  // judges the machine's. The rule is about what a portfolio may assert, not who typed it.
  if (title !== "" && decision !== "approve") return refuse({ cause: "title-on-reject", id });
  if (title !== "" && RATING_SHAPED.test(title)) return refuse({ cause: "rating-shaped-title", id });

  const at = new Date().toISOString();
  // THE ONE REASSEMBLY POINT, ledger F-024 — the same `withCandidates` `harvest.mjs`'s own
  // decide() now calls, and `prepareProposedDocument` calls too: keep every document-level field
  // `load.harvest` already carries (`subject`/`leafId`) and replace ONLY the candidates array.
  // Before this, `{ candidates: … }` alone dropped the target binding on every approve/reject
  // recorded through this web panel, exactly as the CLI's own decide() did — F-024, the same
  // consent-breach shape F-014 fixed, reopened one layer over because a real promote needs an
  // APPROVED candidate and approving was exactly what erased the binding.
  const updated = withCandidates(
    load.harvest,
    load.harvest.candidates.map((c) => {
      if (c.id !== id) return c;
      // The digest is computed over the candidate AS DECIDED — retitle included — because
      // "approval covers exactly what the reviewer saw" includes the words they just wrote.
      // Same ordering, same stamp, same function as the CLI's decide(). The extractor changes
      // WITH a retitle: reviewer-authored words attributed to "git-cluster" would say a machine
      // drafted prose it never drafted.
      const decided = {
        ...c,
        ...(title !== "" ? { title, extractor: `reviewer:${by}` } : {}),
      };
      const subjectDigest = reviewSubjectDigest(decided);
      return {
        ...decided,
        review:
          decision === "approve"
            ? { state: "approved", by, at, subjectDigest }
            : { state: "rejected", by, at, reason, subjectDigest },
      };
    }),
  );

  // The gate judges what is about to hit the disk, over a real JSON round trip — the same
  // self-check `harvest.mjs` makes. If this fires it is a bug HERE, not in the operator's file.
  const validated = parseHarvestDocument(JSON.parse(JSON.stringify(updated)));
  if (!validated.ok) {
    const issues = validated.issues.map((i) => `${i.at}: ${i.message}`).join("\n");
    return {
      status: 500,
      plain: true,
      body:
        `BUG — the document this decision would produce is not one this product can load, so ` +
        `NOTHING was written and ${load.path} is unchanged.\n\n${issues}\n`,
    };
  }

  writeDocument(load.path, `${JSON.stringify(updated, null, 2)}\n`);

  // 303, so a reload of the queue is a GET and cannot re-submit the decision. A find keeps its
  // context and lands on the decided draft, which now shows who decided and when.
  if (query) {
    return { status: 303, body: "", location:
      `${REVIEW_ROUTE}?q=${encodeURIComponent(query)}&focus=${encodeURIComponent(id)}#candidate-${encodeURIComponent(id)}` };
  }
  // Otherwise ON TO THE NEXT UNDECIDED DRAFT, opened, in the order /review shows it, with a status
  // line above the queue naming what was just recorded. Measured before: Approve landed on the top
  // of a closed queue with no word that anything happened, and the decided draft had collapsed
  // into "Decided (N)". Only the two ids cross the redirect; the page reads the decision, its
  // title and the "approved waiting" count back from the harvest and the leaf on its own GET.
  const { next } = await firstOpenDraft(validated.harvest);
  const params = new URLSearchParams({ decided: id, ...(next ? { focus: next.id } : {}) });
  return { status: 303, body: "", location: `${REVIEW_ROUTE}?${params}#review-status` };
  }).catch(async error => {
    if (error && typeof error === "object" && "code" in error && error.code === "ELOCALBUSY") {
      const current = await loadHarvestDocument();
      const detail = "message" in error && typeof error.message === "string" ? error.message : "Document busy.";
      return { status: 409, body: renderReviewPage(current, { cause: "document-busy", id: draft.id, detail }, await leafIndex(), null, draft, await reviewView(current.ok ? current.harvest : null), query) };
    }
    throw error;
  });

}

/**
 * Read the leaf only far enough to say which leaflet ids it already holds.
 *
 * The promote panel needs one fact — is this candidate already across? — and this returns exactly
 * that, so a failure to read the leaf turns into a sentence on the page rather than a thrown
 * request. The whole document is parsed because the ids have to come through the same gate every
 * other reader uses; taking them from raw JSON would let the panel believe in a leaflet
 * `parseLeafDocument` would refuse.
 *
 * @returns {Promise<import("./src/render.ts").LeafIndex | import("./src/render.ts").LeafIndexUnavailable>}
 */
async function leafIndex() {
  const load = await loadLeafDocument();
  if (!load.ok) {
    // Read by the promote panel: the state and the next step in the sentence, never the path. The
    // load rides along and the panel reads the cause from it: a missing record leads to creating
    // one, a file to repair is named under its closed Technical details.
    return { ok: false, detail: leafLoadProblem(load), load };
  }
  return {
    ok: true,
    ids: new Set(load.leaf.leaflets.map((l) => String(l.id))),
    path: load.source.path,
    subject: load.leaf.subject,
  };
}

/**
 * Carry every approved candidate into the leaf.
 *
 * TWO DOCUMENTS, AND ONLY ONE OF THEM IS WRITTEN. `promoteApproved` is pure and returns a new
 * leaf; the harvest is left exactly as it was, which is what makes a second click harmless — the
 * candidate is still `approved` there, and the promotion refuses it as a duplicate by id rather
 * than appending a second copy. The alternative, stamping the harvest as promoted, would put the
 * same fact in two files and let them disagree.
 *
 * @returns {Promise<{ status: number, body: string, location?: string, plain?: boolean }>}
 */
async function carryIntoLeaf() {
  // BOTH vars, mirroring `promote`'s own `--doc` AND `--into`: this function reads the harvest
  // document (to see what is approved) and writes the LEAF, so an unset FOLIAGE_HARVEST would
  // silently promote whatever sits in a stale default harvest document, and an unset
  // FOLIAGE_LEAF would silently write into a stale default leaf — either one is the same
  // consent-breach shape, one field over.
  const unconfigured = refuseIfUnconfigured([HARVEST_ENV, DOCUMENT_ENV]);
  if (unconfigured !== null) return unconfigured;

  return withDocumentLocks([HARVEST_ENV, DOCUMENT_ENV].map((name) => resolve(String(process.env[name]).trim())), async () => {
  const harvest = await loadHarvestDocument();
  if (!harvest.ok) {
    return { status: httpStatusForUnwritable(harvest), body: renderReviewWriteRefused(harvest, "Nothing added to your record") };
  }

  const leaf = await loadLeafDocument();
  if (!leaf.ok) {
    // NOTHING WAS WRITTEN, and the page has to say which document was missing — the operator's
    // next move differs entirely depending on whether the harvest or the leaf is the problem.
    // The refusals below are pages in the app's layout with the way back (`renderPromoteRefused`);
    // only the round-trip BUG report stays plain, because it is this module's fault, not a state.
    return { status: 409, body: renderPromoteRefused({ cause: "leaf-unavailable", load: leaf, harvest: harvest.harvest }) };
  }

  // NO SUPERSEDE PERMISSION, ever, on this route — `promoteApproved`'s third argument is left
  // at its default (empty), so an id collision here refuses exactly as it always has. This
  // button has no way to ask a person whether to replace a shared body, and consent about replacing a shared body is not something a POST to /promote
  // may infer on its behalf. `result.superseded` is therefore always empty from this call site.
  const result = promoteApproved(harvest.harvest, leaf.leaf);
  // EXHAUSTIVE BY NAME, not sequential if/else — same F-012 failure class the CLI's own promote()
  // just closed, one file over: an `ok:false` variant this switch does not name fails the
  // typecheck via the `never` branch below, rather than falling through a chain of ifs that
  // happens to have caught every member that exists TODAY. Same idiom as `ReviewRefusal`/
  // `HarvestLoad` in `src/render.ts`.
  if (!result.ok) {
    switch (result.cause) {
      case "cell-authority-refused":
        return { status: 409, body: renderPromoteRefused({ cause: "cell-authority-refused", reason: result.reason }) };
      case "binding-mismatch":
        // F-014, the same posture the CLI takes: not a bug — the harvest's own recorded target
        // disagrees with the leaf this server is configured to promote into. Refused whole, both
        // values named, NOTHING written to either document.
        return {
          status: 409,
          body: renderPromoteRefused({
            cause: "binding-mismatch",
            mismatches: result.mismatches,
            harvestPath: harvest.path,
            leafPath: leaf.source.path,
          }),
        };
      case "round-trip-rejected": {
        // The same self-check the CLI makes. If this fires it is a bug in the promote module, not
        // in the operator's file, and NOTHING has hit the disk.
        const issues = result.issues.map((i) => `${i.at}: ${i.message}`).join("\n");
        return {
          status: 500,
          plain: true,
          body:
            `BUG — promotion built a document the leaf gate refuses (${result.cause}), so NOTHING ` +
            `was written and ${leaf.source.path} is unchanged.\n\n${issues}\n`,
        };
      }
      default:
        return unreachable(result);
    }
  }

  // THE WEB SIDE OF THE SAME CAVEAT THE CLI PRINTS, PR #17 REVIEW (blocker 2): a promote whose
  // harvest carried no recorded binding is not silently treated as verified here either. A 303
  // carries no body, so the query string on the redirect is the only channel this route has to
  // hand the fact across the reload — the queue's next GET reads it back and renders the same
  // plain-words notice `promote()` writes to stdout for the identical case.
  const redirectTo =
    result.binding === "unbound-legacy" ? `${REVIEW_ROUTE}?promoted=unbound-legacy` : REVIEW_ROUTE;

  // Nothing to do is not an error, and it must not rewrite the file. A no-op write would change
  // the document's mtime and tell anyone watching that a portfolio changed when it did not.
  if (result.promoted.length === 0) {
    return { status: 303, body: "", location: redirectTo };
  }

  const target = leaf.source.path;
  // The validated promotion result retains the person's own headline and chosen highlights.
  // Serialize it whole so this second write boundary cannot drop those settings.
  const serialized = `${JSON.stringify(result.leaf, null, 2)}\n`;
  writeDocument(target, serialized);

  // 303 for the same reason the decision POST does it: a reload of the queue is a GET and cannot
  // re-submit. There is no "promoted 2!" banner — the panel recomputes from the two documents, so
  // what it shows next is measured rather than remembered.
  return { status: 303, body: "", location: redirectTo };
  }).catch((error) => {
    // A held lock is a busy record, not a server fault: the same page, with the lock's own words
    // (they name the file, which is how a lock left behind is found) under Technical details.
    if (error && typeof error === "object" && "code" in error && error.code === "ELOCALBUSY") {
      const detail = "message" in error && typeof error.message === "string" ? error.message : "Document busy.";
      return { status: 409, body: renderPromoteRefused({ cause: "document-busy", detail }) };
    }
    throw error;
  });

}

/**
 * Which methods a route has. `allow` is a promise about ONE resource, so it is answered per
 * resource: a blanket "GET, HEAD" on a 405 from `/review` would tell a correct client that the
 * POST it just made can never work, about an endpoint that accepts it.
 *
 * An unknown path keeps the old answer, because a route that does not exist has no methods and
 * the honest minimum is the set every route here shares.
 *
 * `/promote` is POST-only and deliberately has no GET: it is not a page, and a GET that rendered
 * something there would be a second, unmaintained copy of the review queue.
 *
 * @param {string} pathname
 * @returns {string}
 */
function allowedMethods(pathname) {
  if (pathname === "/sources/image-preview") return "POST";
  if (pathname === "/review/candidate-image") return "GET, HEAD";
  if (pathname.startsWith("/sources/image-preview/")) return "GET, HEAD";
  if (pathname === '/leaf/scarlet') return 'GET, HEAD, POST';
  if (pathname === "/leaf/setup" || pathname === "/leaf/import" || pathname === "/leaf/capture" || pathname === "/workflow/leaflet" || pathname === "/leaf/revision" || pathname === "/leaf/story" || pathname === "/leaf/curate" || pathname === "/leaf/presentation" || pathname === "/leaf/claim-check") return "GET, HEAD, POST";
  if (pathname === "/workflow/jev" || pathname === "/workflow/api" || pathname === "/sources/api" || pathname === "/sources/assessment") return "GET, HEAD, POST";
  if (pathname === REVIEW_ROUTE) return "GET, HEAD, POST";
  if (pathname === SCARLET_SETUP_ROUTE) return "GET, HEAD, POST";
  if (pathname === SCARLET_ROUTE) return "GET, HEAD, POST";
  if (pathname === PROMOTE_ROUTE) return "POST";
  if (pathname === SCARLET_RUN_ROUTE) return "POST";
  return "GET, HEAD";
}

/**
 * The friendly EADDRINUSE guidance, without which a taken port crashed with a raw uncaught
 * `Error: listen EADDRINUSE` stack — measured on the README-documented path (a second
 * `node apps/leaf/server.mjs`, or a stale `foliage up` still bound to the same port).
 *
 * SAME WORDING `foliage up` ALREADY PRINTS for the identical failure, because this server is
 * exactly what that command spawns as a child — running it directly should not get a worse
 * answer than running it through the launcher. `foliage up` takes `--port <n>`; this file has no
 * flag parser of its own and reads `PORT` from the environment instead (see `foliage.mjs`'s
 * `up`, which passes `PORT: String(port)` to this same process), so the remedy names that knob
 * rather than a flag this server does not accept.
 *
 * @param {NodeJS.ErrnoException} err
 */
function reportListenError(err) {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[leaf] port ${PORT} is taken — maybe an earlier \`foliage up\` or another ` +
        `apps/leaf/server.mjs. Set PORT=<n> to run beside it.`,
    );
    process.exit(1);
    return;
  }
  // Not the well-known case: reported plainly rather than swallowed, per AGENTS.md's rule
  // against collapsing distinct causes into one silent failure.
  console.error(`[leaf] server failed to start:`, err);
  process.exit(1);
}

/** @type {readonly string[] | null} Memoised: a bound address cannot change while listening. */
let allowedAuthorities = null;

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  // Behind the answer, whatever it was: a refused or failed write may still have written.
  if (method === "POST" && brainUpkeep !== null) res.once("close", () => brainUpkeep.request());

  // BEFORE ROUTING, on every method: by the time a route has run, the bytes already exist.
  const allowed = (allowedAuthorities ??= boundAuthorities(server.address(), PORT));
  const authority = (req.headers.host ?? "").toLowerCase();
  if (!allowed.includes(authority)) {
    req.resume();
    send(res, 421, "text/plain; charset=utf-8", `misdirected: Host was ${JSON.stringify(authority)}, and this private workspace answers only to ${allowed.join(", ")}. Nothing was served or changed.\n`, method === "HEAD");
    return;
  }

  let pathname;
  /** @type {URL} */
  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", `http://${HOST}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    // A malformed percent-escape is a bad request, not a missing page. Answered before the
    // method check, because a path that cannot be parsed has no route and therefore no methods.
    send(res, 400, "text/plain; charset=utf-8", "bad request", method === "HEAD");
    return;
  }

  const allow = allowedMethods(pathname);
  if (!allow.split(", ").includes(method)) {
    send(
      res,
      405,
      "text/plain; charset=utf-8",
      `${method} is not a method of ${pathname}; it accepts ${allow}\n`,
      false,
      { allow },
    );
    return;
  }
  const headOnly = method === "HEAD";

  try {
    if (pathname === "/review/candidate-image") {
      const unavailable = () => send(res, 404, "text/plain; charset=utf-8", "Review image unavailable", headOnly, { sameOriginResource: true });
      const candidateIds = requestUrl.searchParams.getAll("candidate");
      const refs = requestUrl.searchParams.getAll("ref");
      if (requestUrl.searchParams.size !== 2 || candidateIds.length !== 1 || refs.length !== 1) { unavailable(); return; }
      const parsed = parseMediaRef(refs[0] ?? "");
      if (!parsed.ok) { unavailable(); return; }
      const owner = await loadLeafDocument();
      const harvest = await loadHarvestDocument();
      if (!owner.ok || !harvest.ok || harvest.harvest.leafId !== owner.leaf.id || harvest.harvest.subject !== owner.leaf.subject) { unavailable(); return; }
      const candidate = harvest.harvest.candidates.find(entry => entry.id === candidateIds[0]);
      const selected = candidate?.media?.find(entry => entry.ref === parsed.ref && entry.media.mediaType.startsWith("image/"));
      if (!selected) { unavailable(); return; }
      const image = await readMedia(mediaRootForDocument(owner.source.path), parsed.ref);
      if (!image.ok || image.contentType !== selected.media.mediaType) { unavailable(); return; }
      send(res, 200, image.contentType, image.bytes, headOnly, { sameOriginResource: true });
      return;
    }
    if (pathname.startsWith("/review/media/")) {
      const unavailable = () => send(res, 404, "text/plain; charset=utf-8", "Review media unavailable", headOnly, { sameOriginResource: true });
      const owner = await loadLeafDocument();
      const harvest = await loadHarvestDocument();
      if (!owner.ok || !harvest.ok || harvest.harvest.leafId !== owner.leaf.id || harvest.harvest.subject !== owner.leaf.subject) { unavailable(); return; }
      let ref;
      try { ref = decodeURIComponent(pathname.slice("/review/media/".length)); }
      catch { unavailable(); return; }
      const parsed = parseMediaRef(ref);
      if (!parsed.ok) { unavailable(); return; }
      const admitted = harvest.harvest.candidates.flatMap(candidate => candidate.media ?? [])
        .find(entry => entry.ref === parsed.ref && entry.media.mediaType === "video/mp4");
      if (!admitted) { unavailable(); return; }
      const { readVideo, videoRootFromEnv } = await import("./src/videoStore.ts");
      const video = await readVideo(videoRootFromEnv({ ...process.env, FOLIAGE_LEAF: owner.source.path }), parsed.ref);
      if (!video.ok || video.mimeType !== admitted.media.mediaType) { unavailable(); return; }
      send(res, 200, video.mimeType, video.bytes, headOnly, { sameOriginResource: true }); return;
    }
    if (pathname.startsWith("/sources/image-preview/")) {
      const id = pathname.slice("/sources/image-preview/".length);
      const preview = /^[0-9a-f-]{36}$/.test(id) ? await sourceConnections.imagePreview(id) : null;
      if (!preview) send(res, 404, "text/plain; charset=utf-8", "Image preview unavailable", headOnly, { sameOriginResource: true });
      else send(res, 200, preview.type, preview.bytes, headOnly, { sameOriginResource: true });
      return;
    }
    if (pathname === "/leaf/capture" || pathname.startsWith("/leaf/capture/media/")) {
      const owner = await loadLeafDocument();
      if (!owner.ok) {
        send(res, 409, "text/html; charset=utf-8", renderSetupStart(owner), headOnly, {allowForm:true}); return;
      }
      const root = captureRootFor(owner.source.path);
      if (pathname.startsWith("/leaf/capture/media/")) {
        const parts = pathname.split("/");
        if (parts.length !== 6 || !["still", "video"].includes(parts[5] ?? "")) { send(res,404,"text/plain; charset=utf-8","Capture unavailable",headOnly); return; }
        const artifact = await readCaptureArtifact(root, parts[4] ?? "", parts[5] === "still" ? "screenshot" : "video");
        if (!artifact) { send(res,404,"text/plain; charset=utf-8","Capture unavailable",headOnly); return; }
        send(res,200,artifact.mimeType,artifact.bytes,headOnly); return;
      }
      let error = "";
      let formUrl = "";
      if (method === "POST") {
        const origin = sameOrigin(req);
        if (!origin.ok) { req.resume(); send(res,403,"text/plain; charset=utf-8",origin.detail,false); return; }
        const body = await readBody(req,{type:"application/x-www-form-urlencoded",what:"a local capture",max:8*1024});
        if (!body.ok) { send(res,body.status,"text/plain; charset=utf-8",body.detail,false,{close:body.close}); return; }
        const fields = new URLSearchParams(body.text);
        const harvest = await loadHarvestDocument();
        try {
          if (!("path" in harvest)) throw new Error("Review queue location unavailable. Set FOLIAGE_HARVEST before recording.");
          if (fields.get("action") === "capture") {
            formUrl = (fields.get("url") ?? "").trim();
            const seconds = Number(fields.get("seconds"));
            if (![6,10,15].includes(seconds)) throw new Error("Choose a demo length of 6, 10, or 15 seconds.");
            const { captureLocalWebDemo } = await import(new URL("../../tools/capture/capture.mjs", import.meta.url).href);
            const captured = await captureLocalWebDemo({ url: formUrl, outputDir: root, durationSeconds: seconds });
            if (!captured.ok) throw new Error(captured.detail);
            try {
              const pageTitle = captured.receipt.source.pageTitle;
              await queueCapturedDemo({ captureRoot: root, captureId: captured.receipt.id, leafPath: owner.source.path, harvestPath: harvest.path, title:pageTitle && !RATING_SHAPED.test(pageTitle) ? pageTitle : "Captured app demo" });
            } catch (queueError) {
              error = `Demo saved privately. Review not updated: ${queueError instanceof Error ? queueError.message : "the review queue could not be written"}`;
            }
            if (!error) { send(res,303,"text/plain; charset=utf-8","",false,{location:`/leaf/capture?saved=${encodeURIComponent(captured.receipt.id)}`}); return; }
          } else if (fields.get("action") === "queue") {
            const id = fields.get("id") ?? "";
            const receipt = await readCaptureReceipt(root,id);
            if (!receipt) throw new Error("Capture files changed or are unavailable. Record again.");
            const pageTitle = receipt.source.pageTitle;
            await queueCapturedDemo({ captureRoot: root, captureId: id, leafPath: owner.source.path, harvestPath: harvest.path, title:pageTitle && !RATING_SHAPED.test(pageTitle) ? pageTitle : "Captured app demo" });
            send(res,303,"text/plain; charset=utf-8","",false,{location:`/leaf/capture?saved=${encodeURIComponent(id)}`}); return;
          } else throw new Error("Capture action unavailable.");
        } catch (failure) { error = failure instanceof Error ? failure.message : "Capture unavailable. Try again."; }
      }
      const harvest = await loadHarvestDocument();
      const candidates = new Map(harvest.ok ? harvest.harvest.candidates.map(candidate => [String(candidate.id), candidate.review.state]) : []);
      const retained = new Set(owner.leaf.leaflets.map(leaflet => String(leaflet.id)));
      const receipts = await listCaptures(root);
      const records = receipts.map(receipt => {
        const candidateId = captureDemoCandidateId(receipt);
        const state = candidates.get(candidateId);
        const action = retained.has(candidateId) ? { label: "Open work", href: `/my/leaflet/${encodeURIComponent(candidateId)}`, primary: false }
          : state === "candidate" ? { label: "Review demo", href: `/review?focus=${encodeURIComponent(candidateId)}#candidate-${encodeURIComponent(candidateId)}`, primary: true }
          : state === "approved" ? { label: "Add to record", href: "/review#review-promote-h", primary: true }
          : null;
        return { id: receipt.id, ...(receipt.source.pageTitle === undefined ? {} : {title:receipt.source.pageTitle}), url: receipt.source.finalUrl, capturedAt: receipt.capture.completedAt,
          durationSeconds: receipt.capture.requestedDurationSeconds,
          screenshotHref: `/leaf/capture/media/${encodeURIComponent(receipt.id)}/still`,
          videoHref: `/leaf/capture/media/${encodeURIComponent(receipt.id)}/video`,
          action, rejected: state === "rejected" };
      });
      const savedId = requestUrl.searchParams.get("saved");
      const saved = records.find(record => record.id === savedId && record.action?.label === "Review demo");
      const savedReceipt = saved ? receipts.find(receipt => receipt.id === saved.id) : null;
      send(res,error ? 409 : 200,"text/html; charset=utf-8",renderCapturePage({records,...(error?{error}:{}),...(savedReceipt?{captured:captureDemoCandidateId(savedReceipt)}:{}) ,...(formUrl?{url:formUrl}:{})}),headOnly,{allowForm:true,captureWorkspace:true});return;
    }
    if (pathname === '/leaf/scarlet') {
      let form;
      try {
        /** @type {Awaited<ReturnType<typeof journeyAction>>} */
        let result = {notice:''};
        if (method === 'POST') {
          const origin = sameOrigin(req);
          if (!origin.ok) { req.resume();send(res,403,'text/plain',origin.detail,false);return; }
          const body = await readBody(req,{type:'application/x-www-form-urlencoded',what:'a journey collaboration request',max:256*1024});
          if(!body.ok){send(res,body.status,'text/plain',body.detail,false,{close:body.close});return;}
          form = new URLSearchParams(body.text);
          result = await journeyAction(form,process.env,assessmentConnection,workflow ?? undefined);
          if(result.redirect){send(res,303,'text/plain','',false,{location:result.redirect});return;}
        }
        const load = await loadLeafDocument();
        if (!load.ok) {
          send(res, 503, 'text/html; charset=utf-8', renderScarletLeafRecovery(load), headOnly);
          return;
        }
        const achievement=form?.get('achievement')??requestUrl.searchParams.get('achievement')??load.leaf.achievements?.[0]?.id??'';
        const key=load.leaf.id+':'+achievement;
        if(result.response && result.message && result.history) journeySessions.save(key,load.source.documentDigest,{response:result.response,message:result.message,history:result.history});
        const conversation=journeySessions.read(key,load.source.documentDigest);
        const html = renderJourneyWorkspace(load,assessmentConnection.status(),workflow?.snapshot(),process.env,{achievement,...conversation,...result});
        send(res,200,'text/html; charset=utf-8',html,headOnly,{allowForm:true,portfolioWorkspace:true});
      } catch(error) {
        const load = await loadLeafDocument();
        if(!load.ok){send(res,503,'text/html; charset=utf-8',renderScarletLeafRecovery(load),headOnly);return;}
        const detail=error instanceof Error?error.message:'The request could not be completed. Nothing was published.';
        const achievement=form?.get('achievement')??'';
        const conversation=journeySessions.read(load.leaf.id+':'+achievement,load.source.documentDigest);
        send(res,409,'text/html; charset=utf-8',renderJourneyWorkspace(load,assessmentConnection.status(),workflow?.snapshot(),process.env,{achievement,...conversation,draftMessage:form?.get('message')??'',draftTexts:form?.getAll('text')??[],draftLeaflets:form?.getAll('leaflet')??[],error:detail}),headOnly,{allowForm:true,portfolioWorkspace:true});
      }
      return;
    }
    if (["/leaf/photosynthesis", "/leaf/photosynthesis/sources", "/leaf/reflection", "/leaf/setup", "/leaf/setup/state", "/leaf/setup/preview", "/leaf/import", "/workflow", "/workflow/jev", "/workflow/api", "/sources/api", "/sources/image-preview", "/sources/assessment", "/workflow/export", "/workflow/export.json", "/workflow/leaflet", "/leaf/revision", "/leaf/story", "/leaf/curate", "/leaf/presentation", "/leaf/claim-check", "/leaf/resume", "/leaf/resume-state", "/leaf/achievement", "/leaf/resume.md", "/leaf/review-export", "/leaf/review-export.json", "/leaf/explore/state"].includes(pathname)) {
      if (pathname === "/leaf/photosynthesis/sources") {
        send(res,303,"text/plain","",headOnly,{location:"/workflow#sources"});return;
      }
      if (pathname === "/leaf/photosynthesis") {
        const harvest = await loadHarvestDocument();
        send(res,200,"text/html; charset=utf-8",renderWorkWorkspace(await loadLeafDocument(),harvest,await reviewView(harvest.ok ? harvest.harvest : null),requestUrl.searchParams),headOnly,{allowForm:true,portfolioWorkspace:true});return;
      }
      if (["/leaf/setup", "/leaf/setup/state", "/leaf/setup/preview"].includes(pathname)) {
        try {
          if (method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res, 403, "application/json", JSON.stringify({error: origin.detail}), false); return; }
            const body = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a portfolio edit", max: 256 * 1024 });
            if (!body.ok) { send(res, body.status, "application/json", JSON.stringify({error: body.detail}), false, {close: body.close}); return; }
            const fields = new URLSearchParams(body.text);
            if (pathname === "/leaf/setup" && fields.get("action") === "create") {
              const result = await createFirstLeaf(process.env, fields);
              if (!result.ok) {
                const current = await loadLeafDocument();
                if (!current.ok) send(res, 409, "text/html; charset=utf-8", renderSetupStart(current, result.message, await boundRecordName()), false, {allowForm: true, setupWorkspace: true});
                else send(res, 409, "text/plain; charset=utf-8", result.message, false);
                return;
              }
              send(res, 303, "text/plain; charset=utf-8", "", false, {location: "/leaf/setup"}); return;
            }
            const beforeSave = await loadLeafDocument();
            if (!beforeSave.ok) throw new LeafLoadError(beforeSave);
            await savePresentation(process.env, fields);
            send(res, 200, "application/json", JSON.stringify({saved: true}), false); return;
          }
          if (pathname === "/leaf/setup") {
            const load = await loadLeafDocument();
            send(res, 200, "text/html; charset=utf-8", load.ok ? renderSetup(setupManagerOrigin(process.env)) : renderSetupStart(load, "", await boundRecordName()), headOnly, {allowForm: true, setupWorkspace: load.ok}); return;
          }
          const load = await loadLeafDocument();
          if (!load.ok) {
            const message = leafLoadProblem(load);
            if (pathname === "/leaf/setup/state") send(res, 409, "application/json", JSON.stringify({error:message}), headOnly);
            else send(res, 409, "text/html; charset=utf-8", renderPresentationFailure(message, undefined, leafLoadTechnical(load)), headOnly, {setupPreview: true});
            return;
          }
          if (pathname === "/leaf/setup/state") {
            send(res, 200, "application/json", JSON.stringify(setupState(load)), headOnly); return;
          }
          send(res, 200, "text/html; charset=utf-8", renderSetupPreview(load), headOnly, {setupPreview: true}); return;
        } catch (error) {
          const current = await loadLeafDocument();
          const message = !current.ok ? leafLoadProblem(current) : error instanceof Error ? error.message : "Your portfolio could not be read or saved.";
          if (pathname === "/leaf/setup/state" || method === "POST") send(res,409,"application/json",JSON.stringify({error:message}),headOnly);
          else send(res,409,"text/html; charset=utf-8",renderPresentationFailure(message,undefined,current.ok ? technicalFor(error) : leafLoadTechnical(current)),headOnly,{setupPreview:pathname === "/leaf/setup/preview"});
          return;
        }
      }
      if (pathname === "/leaf/import") {
        let input = {title:"",source:"",text:""};
        let startedRecord = false;
        try {
          if (method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res,403,"text/plain",origin.detail,false); return; }
            const body = await readBody(req,{type:"application/x-www-form-urlencoded",what:"selected portfolio text",max:1024*1024});
            if (!body.ok) { send(res,body.status,"text/plain",body.detail,false,{close:body.close}); return; }
            const fields = new URLSearchParams(body.text);
            if ([...fields.keys()].some((key,index,keys)=>!['title','source','text','action','digest','leafId','subject'].includes(key)||keys.indexOf(key)!==index)) throw new Error("Reopen the import preview; repeated or unsupported fields were refused.");
            input = {title:fields.get("title")??"",source:fields.get("source")??"",text:fields.get("text")??""};
            const preview = previewPortfolioImport(input);
            if (fields.get("action") === "import") {
              if (fields.get("digest") !== preview.digest) throw new Error("The writing changed. Preview this version before importing.");
              const harvest = await loadHarvestDocument();
              if (!harvest.ok && harvest.cause !== "absent") throw new Error("Private review is unavailable. Repair its document before importing.");
              const before = await loadLeafDocument();
              if (!before.ok) {
                if (before.cause !== "absent" || fields.get("leafId")) throw new Error("The private record changed. Preview this portfolio again.");
                const created = await createFirstLeaf(process.env,new URLSearchParams({action:"create",subject:fields.get("subject")??""}));
                if (!created.ok) throw new Error(created.message);
                startedRecord = true;
              }
              const selected = await loadLeafDocument();
              if (!selected.ok) throw new Error("The private record could not be read. Preview this portfolio again.");
              const binding = before.ok ? {leafId:fields.get("leafId")??"",name:fields.get("subject")??""} : {leafId:String(selected.leaf.id),name:selected.leaf.subject};
              const result = await importPortfolio(input,selected.source.path,harvest.path,binding);
              send(res,200,"text/html; charset=utf-8",renderPortfolioImport(input,{result}),false,{allowForm:true,portfolioWorkspace:true}); return;
            }
            if (fields.get("action") !== "preview") throw new Error("Choose preview before importing.");
            const selected = await loadLeafDocument();
            if (!selected.ok && selected.cause !== "absent") throw new Error(leafLoadProblem(selected));
            send(res,200,"text/html; charset=utf-8",renderPortfolioImport(input,{preview:true,firstUse:!selected.ok,...(selected.ok ? {subject:{leafId:String(selected.leaf.id),name:selected.leaf.subject}} : {})}),false,{allowForm:true,portfolioWorkspace:true}); return;
          }
          send(res,200,"text/html; charset=utf-8",renderPortfolioImport(),headOnly,{allowForm:true,portfolioWorkspace:true});
        } catch(error) { const detail = error instanceof Error ? error.message : "Import could not finish. Your writing is kept below."; send(res,409,"text/html; charset=utf-8",renderPortfolioImport(input,{error:startedRecord ? `Private record created; import not added. ${detail}` : detail}),headOnly,{allowForm:true,portfolioWorkspace:true}); }
        return;
      }
      if (pathname === "/workflow/jev") {
        if(!workflow) {send(res,503,"text/plain","The local workflow is unavailable. Existing settings were preserved.",headOnly);return;}
        let message="", failed=false;
        /** @type {'granted'|'revoked'|undefined} */
        let notice;
        if(method==="POST") {
          const origin=sameOrigin(req);
          if(!origin.ok) {req.resume();send(res,403,"text/plain",origin.detail,false);return;}
          const body=await readBody(req,FORM_BODY);
          if(!body.ok) {send(res,body.status,"text/plain",body.detail,false,{close:body.close});return;}
          try {
            const form=new URLSearchParams(body.text);
            if([...form.keys()].some((key,i,keys)=>keys.indexOf(key)!==i)) throw new Error("Repeated fields. Reload.");
            const command=Object.fromEntries(form);
            if(command['action']==='jev-run') {
              // A check of one open draft, asked for from /review. It records a private mark and
              // decides nothing; the owner lands back on the row.
              if(Object.keys(command).sort().join(',')!=='action,candidate') throw new Error('Unexpected decision fields.');
              const candidate=String(command['candidate']);
              await workflow.decideCandidate(candidate);
              res.writeHead(303,{location:`${REVIEW_ROUTE}#candidate-${encodeURIComponent(candidate)}`,"cache-control":"no-store","referrer-policy":"no-referrer"});res.end();return;
            } else {
              if(!['jev-grant','jev-revoke'].includes(command['action']??'')) throw new Error('Choose a Jev source setting.');
              await workflow.command(command);
              notice=command['action']==='jev-grant'?'granted':'revoked';
            }
          } catch(error) {failed=true;message=error instanceof Error?error.message:'The request did not complete.';}
        }
        send(res,failed?409:200,'text/html; charset=utf-8',renderJevWorkflow(workflow.snapshot(),!!process.env['TYPESAFE_API_KEY']?.trim(),message,notice),headOnly,{allowForm:true,portfolioWorkspace:true});return;
      }
      if (pathname === "/sources/assessment") {
        if (method !== "POST") { send(res, 405, "text/plain", "Open the selected draft review first.", headOnly, { allow: "POST" }); return; }
        const origin = sameOrigin(req);
        if (!origin.ok) { req.resume(); send(res, 403, "text/plain", origin.detail, false); return; }
        const body = await readBody(req, FORM_BODY);
        if (!body.ok) { send(res, body.status, "text/plain", body.detail, false, { close: body.close }); return; }
        const form = new URLSearchParams(body.text);
        try {
          if ([...form.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) throw new Error("Repeated transfer fields are refused. Reopen the selected evidence preview.");
          const leaf = await loadLeafDocument();
          if (!leaf.ok) throw new LeafLoadError(leaf);
          let transfer;
          if (form.has("leaflet")) {
            if (form.has("packet")) throw new Error("Choose one Leaflet or one workflow draft for this review.");
            if (leaf.source.declaredExample || leaf.source.bundledExample) throw new Error("Example documents cannot be sent for real assessment.");
            transfer = exportLeafletReview(leaf.leaf, form.get("leaflet") ?? "");
            if (form.get("revision") !== transfer.target.revision || form.get("documentRevision") !== leaf.source.documentDigest) throw new Error("The Leaf or Leaflet changed. Reopen its evidence preview before continuing with Scarlet.");
          } else {
            if (!workflow) throw new Error(workflowFailure);
            transfer = exportWorkflowTransfer(workflow.snapshot(), form.get("packet") ?? "", form.get("revision") ?? "");
          }
          const result = await assessmentConnection.prepare(transfer, { id: String(leaf.leaf.id), name: leaf.leaf.subject });
          res.writeHead(303, { location: result.reviewUrl, "cache-control": "no-store", "referrer-policy": "no-referrer" }); res.end();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Scarlet could not prepare this evidence.";
          send(res, 409, "text/html; charset=utf-8", form.has("leaflet") ? renderJourneyFailure(message, technicalFor(error)) : renderWorkflowTransfer(null, "", message), false);
        }
        return;
      }
      if (pathname === "/sources/api") {
        if (method === "POST") {
          const origin = sameOrigin(req);
          if (!origin.ok) { req.resume(); send(res, 403, "application/json", JSON.stringify({ error: origin.detail }), false); return; }
          const body = await readBody(req, { type: "application/json", what: "a source selection", max: 512 * 1024 });
          if (!body.ok) { send(res, body.status, "application/json", JSON.stringify({ error: body.detail }), false, { close: body.close }); return; }
          try {
            const input = JSON.parse(body.text);
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose an action from Sources.");
            let result;
            if (input.action === "ladybug-connect") result = { ladybug: await assessmentConnection.connect() };
            else if (input.action === "ladybug-disconnect") result = { ladybug: assessmentConnection.disconnect() };
            else result = await sourceConnections.command(input);
            send(res, 200, "application/json", JSON.stringify(result), false);
          } catch (error) { send(res, 400, "application/json", JSON.stringify({ error: error instanceof Error ? error.message : "This source could not be read. Nothing was imported." }), false); }
        } else send(res, 200, "application/json", JSON.stringify({ catalog: sourceConnections.catalog, ladybug: assessmentConnection.status() }), headOnly);
        return;
      }
      if (pathname === "/sources/image-preview") {
        const origin = sameOrigin(req);
        if (!origin.ok) { req.resume(); send(res, 403, "application/json", JSON.stringify({ error: origin.detail }), false); return; }
        const body = await readBody(req, { type: "application/json", what: "one selected design image", max: 6 * 1024 * 1024 });
        if (!body.ok) { send(res, body.status, "application/json", JSON.stringify({ error: body.detail }), false, { close: body.close }); return; }
        try {
          const input = JSON.parse(body.text);
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose one design image.");
          send(res, 200, "application/json", JSON.stringify(await sourceConnections.previewDesignImage(input)), false);
        } catch (error) { send(res, 400, "application/json", JSON.stringify({ error: error instanceof Error ? error.message : "Image could not be previewed. Nothing was saved." }), false); }
        return;
      }
      if (pathname === "/workflow") {
        try {
          await Promise.all(["workflow.js", "workflow.css"].map(name => readFile(join(PUBLIC_DIR, name))));
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
          send(res, 503, "text/html; charset=utf-8", renderWorkflowUnavailablePage(), headOnly);
          return;
        }
        const html = '<!doctype html><html lang="en" data-face="night" data-foliage-theme><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sources · Foliage</title><link rel="icon" href="/mark-icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/workflow.css"></head><body><div id="root"></div><noscript>Sources uses JavaScript. <a href="/review">Review</a> works without it.</noscript><script src="/workflow.js" defer></script></body></html>';
        send(res,200,"text/html; charset=utf-8",html,headOnly,{scarletWorkspace:true});return;
      }
      if (pathname === "/leaf/explore/state") {
        const load = await loadLeafDocument();
        if (!load.ok) { send(res, 409, "application/json", JSON.stringify({ error: leafLoadProblem(load) }), headOnly); return; }
        const bundle = await checkCompoundBundle();
        if (!bundle.ok) { send(res, 409, "application/json", JSON.stringify({ error: `${bundle.reason} ${bundle.remedy}` }), headOnly); return; }
        const assistance = { localModelConfigured: currentModel().ok, ladybug: assessmentConnection.status() };
        const seenAssistance = requestUrl.searchParams.get("assistanceRevision");
        if (requestUrl.searchParams.get("revision") === load.source.documentDigest && (seenAssistance === null || seenAssistance === JSON.stringify(assistance))) { send(res, 204, "application/json", "", headOnly); return; }
        send(res, 200, "application/json", JSON.stringify({ revision: load.source.documentDigest, html: renderCompoundPage(load, { bundle, assistance }) }), headOnly); return;
      }
      if (pathname === '/leaf/reflection') {
        const load = await loadLeafDocument();
        try { send(res, 200, 'text/html; charset=utf-8', renderWorkReflection(load, requestUrl.searchParams), headOnly, {portfolioWorkspace:true}); }
        catch (error) { send(res, 409, 'text/html; charset=utf-8', renderPresentationFailure(error instanceof Error ? error.message : 'Reflection unavailable.', undefined, technicalFor(error)), headOnly); }
        return;
      }
      if (pathname === "/leaf/resume" || pathname === "/leaf/resume-state") {
        const load = await loadLeafDocument();
        if (!load.ok) { send(res, 409, pathname.endsWith("-state") ? "application/json" : "text/html; charset=utf-8", pathname.endsWith("-state") ? JSON.stringify({error:leafLoadProblem(load)}) : renderPresentationFailure(leafLoadProblem(load), undefined, leafLoadTechnical(load)), headOnly); return; }
        if (pathname.endsWith("-state")) {
          if (requestUrl.searchParams.get("revision") === load.source.documentDigest) { send(res, 204, "application/json", "", headOnly); return; }
          send(res, 200, "application/json", JSON.stringify({revision:load.source.documentDigest,policyRevision:"",workDatesRevision:"",freshnessRevision:"",freshnessHtml:"",html:renderLiveResume(load)}), headOnly);
        } else send(res, 200, "text/html; charset=utf-8", renderLiveResume(load), headOnly, {portfolioWorkspace:true});
        return;
      }
      if (pathname === "/leaf/claim-check") {
        let load = await loadLeafDocument();
        let selection;
        const configured = !!process.env['TYPESAFE_API_KEY']?.trim();
        try {
          let form;
          if (method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res, 403, "text/plain", origin.detail, false); return; }
            const body = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a statement check", max: 8192 });
            if (!body.ok) { send(res, body.status, "text/plain", body.detail, false, { close: body.close }); return; }
            form = new URLSearchParams(body.text);
            load = await loadLeafDocument();
          }
          const params = form ?? requestUrl.searchParams;
          if (form || params.has("achievement") || params.has("claim")) selection = prepareClaimCheck(load, params.get("achievement") ?? "", params.get("claim") ?? "");
          let result;
          if (form && selection) {
            result = await checkClaim(selection, form, process.env);
            const current = await loadLeafDocument();
            if (!current.ok || current.source.documentDigest !== selection.revision) throw new Error("Your portfolio changed during the check. Reopen the statement to check its current evidence; the previous result was discarded.");
          }
          send(res, 200, "text/html; charset=utf-8", renderClaimCheck(load, selection, result, undefined, configured), headOnly, { allowForm: true });
        } catch (error) {
          send(res, 409, "text/html; charset=utf-8", renderClaimCheck(load, undefined, undefined, error instanceof Error ? error.message : "Statement check unavailable.", configured), headOnly, { allowForm: true });
        }
        return;
      }
      if (["/leaf/presentation", "/leaf/achievement", "/leaf/resume.md"].includes(pathname)) {
        let draft;
        try {
          if (pathname === "/leaf/presentation" && method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res, 403, "text/plain", origin.detail, false); return; }
            const body = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a portfolio edit", max: 256 * 1024 });
            if (!body.ok) { send(res, body.status, "text/plain", body.detail, false, { close: body.close }); return; }
            draft = new URLSearchParams(body.text);
            const location = await savePresentation(process.env, draft);
            send(res, 303, "text/plain", "", false, { location }); return;
          }
          const load = await loadLeafDocument();
          if (pathname === "/leaf/resume.md") {
            if (!load.ok) throw new LeafLoadError(load);
            send(res, 200, "text/markdown; charset=utf-8", resumeDraft(load.leaf), headOnly); return;
          }
          const html = pathname === "/leaf/achievement" ? renderAchievement(load, requestUrl.searchParams.get("id") ?? "") : renderPresentation(load, requestUrl.searchParams);
          send(res, html === null ? 404 : 200, "text/html; charset=utf-8", html ?? renderPresentationFailure("This achievement is not in the current portfolio."), headOnly, { allowForm: pathname === "/leaf/presentation", portfolioWorkspace: pathname === "/leaf/presentation" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Portfolio unavailable.";
          let html = renderPresentationFailure(message, draft, technicalFor(error));
          if (draft) {
            try { html = renderPresentation(await loadLeafDocument(), requestUrl.searchParams, draft, message); } catch { /* recovery keeps every submitted field */ }
          }
          send(res, 409, "text/html; charset=utf-8", html, headOnly, { allowForm: true, portfolioWorkspace: pathname === "/leaf/presentation" });
        }
        return;
      }
      if (pathname === "/leaf/curate") {
        let draft;
        try {
          if (method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res, 403, "text/plain", origin.detail, false); return; }
            const body = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a highlight selection", max: 128 * 1024 });
            if (!body.ok) { send(res, body.status, "text/plain", body.detail, false, { close: body.close }); return; }
            draft = new URLSearchParams(body.text);
            await saveCuration(process.env, draft);
            send(res, 303, "text/plain", "", false, { location: "/leaf#leaf-highlights" }); return;
          }
          send(res, 200, "text/html; charset=utf-8", renderCuration(await loadLeafDocument(), requestUrl.searchParams.get("leaflet") ?? ""), headOnly, { allowForm: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Highlight selection unavailable.";
          let html = renderCurationFailure(message, draft, technicalFor(error));
          if (draft) {
            try { html = renderCuration(await loadLeafDocument(), "", draft, message); } catch { /* retain the submitted choices in the recovery page */ }
          }
          send(res, 409, "text/html; charset=utf-8", html, headOnly, { allowForm: true });
        }
        return;
      }
      if (["/workflow/leaflet", "/leaf/revision", "/leaf/story", "/leaf/review-export", "/leaf/review-export.json"].includes(pathname)) {
        let storyDraft;
        try {
          if (method === "POST") {
            const origin = sameOrigin(req);
            if (!origin.ok) { req.resume(); send(res, 403, "text/plain", origin.detail, false); return; }
            const body = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a private revision form", max: 256 * 1024 });
            if (!body.ok) { send(res, body.status, "text/plain", body.detail, false, { close: body.close }); return; }
            const form = new URLSearchParams(body.text);
            if (pathname === "/leaf/story") {
              storyDraft = form;
              const id = await saveLeafletStory(process.env, form);
              send(res, 303, "text/plain", "", false, { location: `/my/leaflet/${encodeURIComponent(id)}` }); return;
            }
            if (pathname === "/leaf/revision" && form.get("action") === "preview") {
              const suggestion = parseLeafletSuggestion(JSON.parse(form.get("suggestion") ?? ""));
              send(res, 200, "text/html; charset=utf-8", renderSuggestionReview(await loadLeafDocument(), suggestion), false, { allowForm: true }); return;
            }
            let id;
            if (pathname === "/workflow/leaflet") {
              if (!workflow) throw new Error(workflowFailure);
              id = await workflow.withSnapshot(state => saveWorkflowLeaflet(process.env, state, form));
            } else {
              if (form.get("action") !== "apply") throw new Error("Choose preview or accept reviewed wording.");
              id = await saveLeafletSuggestion(process.env, form);
            }
            send(res, 303, "text/plain", "", false, { location: `/leaf/explore?leaflet=${encodeURIComponent(id)}` }); return;
          }
          const load = await loadLeafDocument();
          if (pathname === "/workflow/leaflet") {
            if (!workflow) throw new Error(workflowFailure);
            send(res, 200, "text/html; charset=utf-8", renderWorkflowLeaflet(load, workflow.snapshot(), requestUrl.searchParams.get("packet") ?? ""), headOnly, { allowForm: true });
          } else if (pathname === "/leaf/story") {
            send(res, 200, "text/html; charset=utf-8", renderLeafletStory(load, requestUrl.searchParams.get("leaflet") ?? ""), headOnly, { allowForm: true });
          } else if (pathname === "/leaf/revision") {
            send(res, 200, "text/html; charset=utf-8", renderSuggestionReview(load), headOnly, { allowForm: true });
          } else {
            const id = requestUrl.searchParams.get("leaflet") ?? "";
            if (pathname.endsWith(".json")) {
              if (!load.ok) throw new LeafLoadError(load);
              const transfer = exportLeafletReview(load.leaf, id);
              if (requestUrl.searchParams.get("revision") !== transfer.target.revision) throw new Error("The Leaflet changed. Reopen its export preview.");
              res.setHeader("content-disposition", 'attachment; filename="foliage-leaflet-review.json"');
              send(res, 200, "application/json; charset=utf-8", JSON.stringify(transfer, null, 2), headOnly);
            } else send(res, 200, "text/html; charset=utf-8", renderLeafletExport(load, id, assessmentConnection.status().connected), headOnly, { allowForm: true, pairedFormOrigin: assessmentConnection.reviewOrigin() });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Revision unavailable.";
          let html = renderJourneyFailure(message, technicalFor(error));
          if (storyDraft) {
            try { html = renderLeafletStory(await loadLeafDocument(), storyDraft.get("leaflet") ?? "", storyDraft, message); }
            catch { html = renderLeafletStoryRecovery(storyDraft, message); }
          }
          send(res, 409, "text/html; charset=utf-8", html, headOnly, { allowForm: true });
        }
        return;
      }
      if (!workflow) {send(res,503,"application/json",JSON.stringify({error:workflowFailure}),headOnly);return;}
      if (pathname === "/workflow/export" || pathname === "/workflow/export.json") {
        try {
          const state = workflow.snapshot();
          const id = requestUrl.searchParams.get("packet") ?? "";
          const packet = workflowPacket(state, id);
          const revision = pathname.endsWith(".json") ? requestUrl.searchParams.get("revision") ?? "" : packet?.digest ?? "";
          const transfer = exportWorkflowTransfer(state, id, revision);
          if (pathname.endsWith(".json")) {
            res.setHeader("content-disposition", `attachment; filename="foliage-packet-${id}.json"`);
            send(res, 200, "application/json; charset=utf-8", JSON.stringify(transfer, null, 2), headOnly);
          } else send(res, 200, "text/html; charset=utf-8", renderWorkflowTransfer(transfer, revision, undefined, assessmentConnection.status().connected), headOnly, { allowForm: true, pairedFormOrigin: assessmentConnection.reviewOrigin() });
        } catch (error) {
          send(res, 409, "text/html; charset=utf-8", renderWorkflowTransfer(null, "", error instanceof Error ? error.message : "The transfer could not be prepared."), headOnly);
        }
        return;
      }
      if (method === "POST") {
        const origin = sameOrigin(req);
        if (!origin.ok) {req.resume();send(res,403,"application/json",JSON.stringify({error:origin.detail}),false);return;}
        const body = await readBody(req, RUN_BODY);
        if (!body.ok) {send(res,body.status,"application/json",JSON.stringify({error:body.detail}),false,{close:body.close});return;}
        try {
          const input = JSON.parse(body.text);
          if (input.action === "collect") await workflow.tick(new Date(),true);
          else await workflow.command(input);
        } catch(error) {send(res,400,"application/json",JSON.stringify({error:error instanceof Error ? error.message : String(error),...(error instanceof SourceRefusal ? {technical:error.technical} : {})}),false);return;}
      }
      const state = workflow.snapshot();
      const [leaf, policy] = await Promise.all([loadLeafDocument(), loadPublishPolicy()]);
      const hosted = await readHostedStatus(process.env["FOLIAGE_HOSTED_STATUS"], leaf.ok ? String(leaf.leaf.id) : "");
      send(res,200,"application/json",JSON.stringify({ ...state, queue: await nextReviewSummary(), pipeline: portfolioPipeline(leaf, policy, hosted, state.proposals), localModelConfigured: currentModel().ok, ladybug: assessmentConnection.status() }),headOnly);return;
    }
    if (pathname === "/leaf/explore") {
      const load = await loadLeafDocument();
      send(res, load.ok ? 200 : 409, "text/html; charset=utf-8", renderCompoundPage(load, { bundle: await checkCompoundBundle(),
        assistance: { localModelConfigured: currentModel().ok, ladybug: assessmentConnection.status() } }), headOnly, { compoundWorkspace: true });
      return;
    }
    if (pathname === "/scarlet/workspace") {
      const leaf = await loadLeafDocument();
      const packetId = requestUrl.searchParams.get("packet");
      if (packetId !== null) {
        const state = workflow?.snapshot();
        const packet = workflowPacket(state, packetId);
        const tool = /** @type {const} */ ({ name: "read_workflow", id: packetId });
        if (!packet) {
          send(res, 409, "text/html; charset=utf-8", renderScarletWorkspace(leaf, currentModel(), tool,
            { why: workflow ? "Workflow packet unavailable · /review" : workflowFailure }), headOnly,
            { allowForm: true, scarletWorkspace: true });
          return;
        }
        const selection = /** @type {const} */ ({ documentDigest: packet.digest, tool, purpose: "review", includeSource: requestUrl.searchParams.get("source") === "git" });
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        const read = await resolveScarletContext(undefined, selection, { workflow: state, signal: controller.signal });
        send(res, read.ok ? 200 : 409, "text/html; charset=utf-8", renderScarletWorkspace(leaf, currentModel(), tool,
          { selection, ...(read.ok ? { context: read.context } : { why: read.why }) }), headOnly,
          { allowForm: true, scarletWorkspace: true });
        return;
      }
      if (!leaf.ok) {
        send(res, 409, "text/html; charset=utf-8", renderScarletWorkspace(leaf, currentModel(), { name: "search_leaflets", query: "" }), headOnly);
        return;
      }
      const id = requestUrl.searchParams.get("leaflet");
      const candidate = requestUrl.searchParams.get("candidate");
      const purpose = candidate !== null ? "review" : requestUrl.searchParams.get("purpose") ?? "understand";
      const harvest = candidate === null ? undefined : await loadHarvestDocument();
      const policy = purpose !== "publish" ? undefined : await loadPublishPolicy();
      const tool = candidate !== null ? { name: "read_candidate", id: candidate } : id === null ? { name: "search_leaflets", query: requestUrl.searchParams.get("q") ?? "" } : { name: "read_leaflet", id };
      if ((harvest !== undefined && !harvest.ok) || (policy !== undefined && !policy.ok)) {
        const why = harvest !== undefined && !harvest.ok ? harvestLoadProblem(harvest) : policy !== undefined && !policy.ok ? POLICY_UNAVAILABLE : "Context unavailable";
        send(res, 409, "text/html; charset=utf-8", renderScarletWorkspace(leaf, currentModel(),
          candidate !== null ? { name: "read_candidate", id: candidate } : { name: "search_leaflets", query: "" }, { why }), headOnly, { allowForm: true, scarletWorkspace: true });
        return;
      }
      const selection = readScarletSelection({ foliage: { documentDigest: leaf.source.documentDigest, purpose,
        includeSource: requestUrl.searchParams.get("source") === "git",
        ...(harvest === undefined ? {} : { harvestDigest: scarletResourceDigest(harvest.harvest) }),
        ...(policy === undefined ? {} : { policyDigest: effectivePolicyDigest(policy.policy, policy.source) }),
        tool } });
      if (!selection.ok || selection.selection === undefined) {
        send(res, 400, "text/plain; charset=utf-8", selection.ok ? "No tool selected" : selection.why, headOnly);
        return;
      }
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const read = await resolveScarletContext(leaf.leaf, selection.selection, {
        ...(harvest === undefined ? {} : { harvest }), ...(policy === undefined ? {} : { policy }),
        ...(process.env["FOLIAGE_SOURCE_REPO"] === undefined ? {} : { sourceRepo: process.env["FOLIAGE_SOURCE_REPO"] }), signal: controller.signal,
      });
      send(res, read.ok ? 200 : 409, "text/html; charset=utf-8", renderScarletWorkspace(leaf, currentModel(), selection.selection.tool, {
        selection: selection.selection, ...(read.ok ? { context: read.context } : { why: read.why }),
      }), headOnly, { allowForm: true, scarletWorkspace: true });
      return;
    }
    if (pathname === REVIEW_ROUTE && method === "POST") {
      // ORIGIN FIRST, and before the body is read: a cross-site POST gets no opportunity to send
      // this process 64KB, and the refusal is about who is asking rather than what they said.
      const origin = sameOrigin(req);
      if (!origin.ok) {
        req.resume();
        send(res, 403, "text/plain; charset=utf-8", `refused: ${origin.detail}\n`, false);
        return;
      }
      const form = await readBody(req, FORM_BODY);
      if (!form.ok) {
        send(res, form.status, "text/plain; charset=utf-8", `refused: ${form.detail}\n`, false, { close: form.close });
        return;
      }
      const outcome = await recordDecision(new URLSearchParams(form.text));
      send(
        res,
        outcome.status,
        outcome.plain === true ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
        outcome.body,
        false,
        {
          allowForm: outcome.plain !== true && outcome.status !== 303,
          ...(outcome.location === undefined ? {} : { location: outcome.location }),
        },
      );
      return;
    }

    if (pathname === PROMOTE_ROUTE && method === "POST") {
      // ORIGIN FIRST, exactly as the decision POST does it, and for a sharper reason: this one
      // writes somebody's portfolio. A page on the internet must not be able to append leaflets to
      // a document on this machine by submitting a form at a loopback port.
      const origin = sameOrigin(req);
      if (!origin.ok) {
        req.resume();
        send(res, 403, "text/plain; charset=utf-8", `refused: ${origin.detail}\n`, false);
        return;
      }
      // The body is drained but carries nothing: promotion takes no parameters. Which candidates
      // move is a fact of the harvest document, not a choice the form makes — so there is no id
      // here to tamper with, and a replay does exactly what the first request did.
      req.resume();
      const outcome = await carryIntoLeaf();
      send(
        res,
        outcome.status,
        outcome.plain === true ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
        outcome.body,
        false,
        {
          allowForm: outcome.plain !== true && outcome.status !== 303,
          ...(outcome.location === undefined ? {} : { location: outcome.location }),
        },
      );
      return;
    }

    if (pathname === SCARLET_RUN_ROUTE && method === "POST") {
      // ORIGIN FIRST, like the two writes, though this route writes nothing: a page somewhere
      // else must not be able to spend this machine's model on its own questions, and must not
      // read what the leaf says. The refusal is about who is asking, before the body is read.
      const origin = sameOrigin(req);
      if (!origin.ok) {
        req.resume();
        send(res, 403, "text/plain; charset=utf-8", `refused: ${origin.detail}\n`, false);
        return;
      }
      // EVERYTHING THAT CAN BE REFUSED WITH A STATUS IS REFUSED WITH A STATUS — the body's type,
      // size, syntax and shape — because once the stream is open the only way to say no is an
      // event, and an HTTP client that never asked for events should not have to parse one.
      const body = await readBody(req, RUN_BODY);
      if (!body.ok) {
        send(res, body.status, "text/plain; charset=utf-8", `refused: ${body.detail}\n`, false, { close: body.close });
        return;
      }
      /** @type {unknown} */
      let value;
      try {
        value = JSON.parse(body.text);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        send(res, 400, "text/plain; charset=utf-8", `refused: the body is not JSON — ${detail}\n`, false);
        return;
      }
      const parsed = parseRunAgentInput(value);
      if (!parsed.ok) {
        send(res, 400, "text/plain; charset=utf-8", `refused: at ${parsed.at}: ${parsed.why}\n`, false);
        return;
      }
      // THE CLIENT LEAVING IS THE SIGNAL. `close` on the response fires when the socket goes,
      // whichever side ended it; aborting after a run that finished normally is a no-op.
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const leaf = await loadLeafDocument();
      const stream = openEventStream(res);
      try {
        await runScarlet({
          input: parsed.input,
          resolveContext: async (selection) => {
            if (!leaf.ok && selection.tool.name !== "read_workflow") return { ok: false, why: leafLoadProblem(leaf) };
            return resolveScarletContext(leaf.ok ? leaf.leaf : undefined, selection, {
              ...(selection.tool.name === "read_workflow" ? { workflow: workflow?.snapshot() } : {}),
              ...(selection.tool.name === "read_candidate" ? { harvest: await loadHarvestDocument() } : {}),
              ...(selection.purpose === "publish" ? { policy: await loadPublishPolicy() } : {}),
              ...(process.env["FOLIAGE_SOURCE_REPO"] === undefined ? {} : { sourceRepo: process.env["FOLIAGE_SOURCE_REPO"] }), signal: controller.signal,
            });
          },
          leaf,
          model: currentModel(),
          ids: { messageId: randomUUID() },
          signal: controller.signal,
          emit: (event) => stream.write(encodeSse(event)),
          stream: streamChat,
        });
      } catch (err) {
        // The only throw the run makes is an AG-UI ordering violation — a bug in `scarletRun.ts`,
        // not a condition of the request. The stream ends without a terminal event, which the
        // client reads as the run breaking off, and this process says so once.
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[leaf] ${SCARLET_RUN_ROUTE}: ${detail}`);
      } finally {
        stream.end();
      }
      return;
    }

    if (pathname === SCARLET_SETUP_ROUTE) {
      // Reading the setup page never contacts Ollama. The owner explicitly asks for discovery.
      if (method !== "POST") {
        send(res, 200, "text/html; charset=utf-8", renderScarletSetup(setupView()), headOnly, { allowForm: true });
        return;
      }
      const bound = server.address();
      const port = bound && typeof bound === "object" ? bound.port : PORT;
      if (HOST !== "127.0.0.1" || !["127.0.0.1", "localhost"].some((host) => req.headers.host === `${host}:${port}`)) {
        req.resume();
        send(res, 421, "text/plain; charset=utf-8", "Open the local owner workspace.", false);
        return;
      }
      const origin = sameOrigin(req);
      if (!origin.ok) {
        req.resume();
        send(res, 403, "text/plain; charset=utf-8", `refused: ${origin.detail}\n`, false);
        return;
      }
      const form = await readBody(req, { type: "application/x-www-form-urlencoded", what: "a local model selection", max: 4096 });
      if (!form.ok) {
        send(res, form.status, "text/plain; charset=utf-8", `refused: ${form.detail}\n`, false, { close: form.close });
        return;
      }
      if (modelFile === null || resolveModelConfig(process.env).ok) {
        send(res, 409, "text/html; charset=utf-8", renderScarletSetup(setupView(null, "invalid-request")), false, { allowForm: true });
        return;
      }
      const params = new URLSearchParams(form.text);
      const action = params.getAll("action");
      const model = params.getAll("model");
      const validDiscover = action.length === 1 && action[0] === "discover" && model.length === 0 && [...params.keys()].length === 1;
      const validSelect = action.length === 1 && action[0] === "select" && model.length === 1 && [...params.keys()].length === 2;
      if (!validDiscover && !validSelect) {
        send(res, 400, "text/html; charset=utf-8", renderScarletSetup(setupView(null, "invalid-request")), false, { allowForm: true });
        return;
      }
      const discovered = await discoverInstalledModels(process.env);
      if (validDiscover || !discovered.ok) {
        send(res, discovered.ok ? 200 : 502, "text/html; charset=utf-8", renderScarletSetup(setupView(discovered)), false, { allowForm: true });
        return;
      }
      const chosen = model[0];
      if (chosen === undefined || !discovered.names.includes(chosen)) {
        send(res, 409, "text/html; charset=utf-8", renderScarletSetup(setupView(discovered, "not-installed")), false, { allowForm: true });
        return;
      }
      const saved = await saveSelectedModel(modelFile, chosen);
      if (!saved.ok) {
        send(res, 500, "text/html; charset=utf-8", renderScarletSetup(setupView(discovered, "save-failed", saved.detail)), false, { allowForm: true });
        return;
      }
      savedModel = { kind: "selected", name: chosen };
      send(res, 303, "text/plain; charset=utf-8", "Model selected.\n", false, { location: SCARLET_ROUTE });
      return;
    }

    if (pathname === SCARLET_ROUTE && method === "POST") {
      // ORIGIN FIRST, as on `/scarlet/run`, and for the same reason: nothing is written, but a page
      // somewhere else must not spend this machine's model or read what the leaf says.
      const origin = sameOrigin(req);
      if (!origin.ok) {
        req.resume();
        send(res, 403, "text/plain; charset=utf-8", `refused: ${origin.detail}\n`, false);
        return;
      }
      const form = await readBody(req, FORM_BODY);
      if (!form.ok) {
        send(res, form.status, "text/plain; charset=utf-8", `refused: ${form.detail}\n`, false, { close: form.close });
        return;
      }
      const question = (new URLSearchParams(form.text).get("question") ?? "").trim();
      const leaf = await loadLeafDocument();
      const model = currentModel();
      // A blank question, or one past the ceiling the textarea states, is the ask page again with
      // the refusal above the form, at 400 — refused here, before any model is spent on it.
      const formRefusal = question === "" ? "empty-question" : question.length > QUESTION_MAX_CHARS ? "question-too-long" : null;
      if (formRefusal !== null) {
        const view = /** @type {import("./src/scarletPage.ts").ScarletView} */ ({ kind: "ask", leaf, model, refusal: formRefusal, question });
        send(res, httpStatusForScarlet(view), "text/html; charset=utf-8", renderScarletPage(view), false, { allowForm: true });
        return;
      }
      // THE SAME RUNNER AS THE STREAM, over a collecting sink that keeps the one fact the outcome
      // does not carry: the provenance the run itself emitted. The answer text is the outcome's
      // own; the grounding is recomputed by the page from the same leaf, because the wire's report
      // holds the counts and the drawer shows the titles.
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      /** @type {import("./src/agui.ts").Provenance | null} */
      let provenance = null;
      const outcome = await runScarlet({
        input: {
          threadId: randomUUID(),
          runId: randomUUID(),
          messages: [{ id: randomUUID(), role: "user", content: question }],
          ignored: { tools: 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 },
        },
        leaf,
        model,
        ids: { messageId: randomUUID() },
        signal: controller.signal,
        emit: (event) => {
          switch (event.type) {
            case "CUSTOM":
              switch (event.name) {
                case "foliage.provenance":
                  provenance = event.value;
                  break;
                case "foliage.grounding":
                case "foliage.answer-review":
                  break;
                default:
                  return unreachable(event);
              }
              break;
            case "RUN_STARTED":
            case "RUN_FINISHED":
            case "RUN_ERROR":
            case "TEXT_MESSAGE_START":
            case "TEXT_MESSAGE_CONTENT":
            case "TEXT_MESSAGE_END":
              break;
            default:
              return unreachable(event);
          }
        },
        stream: streamChat,
      });
      /** @type {import("./src/scarletPage.ts").ScarletView} */
      let view;
      switch (outcome.kind) {
        case "abandoned":
          // The person left mid-answer: nothing to write to, nothing kept.
          return;
        case "refused":
          view = { kind: "refused", leaf, question, code: outcome.code, message: outcome.message, provenance };
          break;
        case "answered":
          view =
            provenance === null
              // Provenance is emitted before the model is asked, so an answer without it cannot
              // happen; if it did, the page would be claiming a source it was never told. Say so.
              ? { kind: "refused", leaf, question, code: "malformed-response", message: "the run answered without naming its provenance", provenance }
              : { kind: "answered", leaf, question, answer: outcome.text, provenance };
          break;
        default:
          return unreachable(outcome);
      }
      send(res, httpStatusForScarlet(view), "text/html; charset=utf-8", renderScarletPage(view), false, { allowForm: true });
      return;
    }

    // GET /scarlet — ask when configured, or the local setup action when no model is selected.
    // Nothing is asked until a question is posted, and nothing is kept after it is answered.
    if (pathname === SCARLET_ROUTE) {
      /** @type {import("./src/scarletPage.ts").ScarletView} */
      const view = { kind: "ask", leaf: await loadLeafDocument(), model: currentModel(), refusal: null };
      send(res, httpStatusForScarlet(view), "text/html; charset=utf-8", renderScarletPage(view), headOnly, { allowForm: true });
      return;
    }

    if (pathname === REVIEW_ROUTE) {
      const load = await loadHarvestDocument();
      // F-014, threaded back from `/promote`'s own redirect (blocker 2): the ONLY value this
      // query string may carry is the one `promoteApproved` ever actually returns, so an
      // unrelated ?promoted= cannot spoof a caveat this run never earned.
      const promoteNotice =
        requestUrl.searchParams.get("promoted") === "unbound-legacy" ? "unbound-legacy" : null;
      send(
        res,
        httpStatusForHarvest(load),
        "text/html; charset=utf-8",
        renderReviewPage(load, null, await leafIndex(), promoteNotice, null, await reviewView(load.ok ? load.harvest : null),
          requestUrl.searchParams.get("q") ?? "", requestUrl.searchParams.get("focus"), requestUrl.searchParams.get("decided")),
        headOnly,
        // A surface with a form is a surface whose CSP permits one; `/scarlet` is the other.
        { allowForm: true },
      );
      return;
    }

    // GET / — the dashboard. THREE independent documents, three independent honest states (see
    // overview.ts's header): the leaf and the harvest each render their OWN failure inline rather
    // than one blanking the other, but the publish policy is gated here, on the SAME rail every
    // other route already uses — a broken policy file takes the whole app down rather than a
    // silently looser one, and `/` is the address an owner lands on first, so it is the loudest
    // place to say so.
    if (pathname === OVERVIEW_ROUTE) {
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        sendPolicyRecovery(res, policy, headOnly, "overview", requestUrl);
        return;
      }
      const leaf = await loadLeafDocument();
      const harvest = await loadHarvestDocument();
      const status =
        httpStatusFor(leaf) === 409 || httpStatusForHarvest(harvest) === 409 ? 409 : 200;
      send(
        res,
        status,
        "text/html; charset=utf-8",
        renderOverviewPage(leaf, harvest, policy.policy, policy.source, reviewPaused()),
        headOnly,
      );
      return;
    }

    // Read-only freshness endpoint: a saved local revision and dated hosting observations.
    if (pathname === "/leaf/portfolio-state") {
      const [load, policy] = await Promise.all([loadLeafDocument(), loadPublishPolicy()]);
      // `error` is shown as the page's update status: the named problem, never the loader's path or parser text.
      if (!load.ok) { send(res, 409, "application/json", JSON.stringify({ error: leafLoadProblem(load) }), headOnly); return; }
      if (!policy.ok) { send(res, 503, "application/json", JSON.stringify({ error: POLICY_UNAVAILABLE }), headOnly); return; }
      const state = workflow?.snapshot() ?? null;
      const hosted = await readHostedStatus(process.env["FOLIAGE_HOSTED_STATUS"], String(load.leaf.id));
      const freshness = portfolioFreshness(state, state ? portfolioPipeline(load, policy, hosted) : null, workflowFailure, await openReviewCount(), hosted);
      const [workDates, bundle] = await Promise.all([loadPortfolioWorkDates(load.leaf, process.env), checkPortfolioLeafBundle()]);
      const requestedOrder = requestUrl.searchParams.get("order");
      const order = requestedOrder === "newest" || requestedOrder === "oldest" ? requestedOrder : "notable";
      const requestedPage = Number(requestUrl.searchParams.get("page"));
      const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const sameDocument = requestUrl.searchParams.get("revision") === load.source.documentDigest;
      const samePolicy = requestUrl.searchParams.get("policyRevision") === policy.policyDigest;
      const sameWorkDates = requestUrl.searchParams.get("workDatesRevision") === workDates.revision;
      if (sameDocument && samePolicy && sameWorkDates && requestUrl.searchParams.get("freshnessRevision") === freshness.revision) {
        send(res, 204, "application/json", "", headOnly); return;
      }
      send(res, 200, "application/json", JSON.stringify({ revision: load.source.documentDigest, policyRevision: policy.policyDigest,
        workDatesRevision: workDates.revision,
        freshnessRevision: freshness.revision, freshnessHtml: freshness.html,
        ...(!sameDocument || !samePolicy || !sameWorkDates ? { html: renderLeafPage(load, policy.policy, "private", { freshnessHtml: freshness.html, freshnessRevision: freshness.revision, policyRevision: policy.policyDigest, enhancePortfolio: true, workDates, order, collection: requestUrl.searchParams.get("collection") ?? "", ...(requestUrl.searchParams.get("records") === "source" ? { records: "source" } : {}), page, portfolioLeafReady: bundle.ok, ...(!bundle.ok ? { portfolioLeafReason: bundle.reason } : {}) }) } : {}) }), headOnly);
      return;
    }

    // GET /leaf — the compound leaf, the owner's own report. Lived at `/` until the studio grew
    // a dashboard; every rule below is unchanged from when it did.
    if (pathname === LEAF_ROUTE) {
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        sendPolicyRecovery(res, policy, headOnly, "leaf", requestUrl);
        return;
      }
      const load = await loadLeafDocument();
      const state = workflow?.snapshot() ?? null;
      const hosted = await readHostedStatus(process.env["FOLIAGE_HOSTED_STATUS"], load.ok ? String(load.leaf.id) : "");
      const freshness = portfolioFreshness(state, state ? portfolioPipeline(load, policy, hosted) : null, workflowFailure, await openReviewCount(), hosted);
      const [workDates, bundle] = await Promise.all([load.ok ? loadPortfolioWorkDates(load.leaf, process.env) : null, checkPortfolioLeafBundle()]);
      const requestedOrder = requestUrl.searchParams.get("order");
      const order = requestedOrder === "newest" || requestedOrder === "oldest" ? requestedOrder : "notable";
      const requestedPage = Number(requestUrl.searchParams.get("page"));
      const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      send(
        res,
        httpStatusFor(load),
        "text/html; charset=utf-8",
        renderLeafPage(load, policy.policy, "private", { freshnessHtml: freshness.html, freshnessRevision: freshness.revision, policyRevision: policy.policyDigest, enhancePortfolio: true, ...(workDates ? { workDates } : {}), order, collection: requestUrl.searchParams.get("collection") ?? "", ...(requestUrl.searchParams.get("records") === "source" ? { records: "source" } : {}), page, portfolioLeafReady: bundle.ok, ...(!bundle.ok ? { portfolioLeafReason: bundle.reason } : {}) }),
        headOnly,
        { portfolioWorkspace: load.ok },
      );
      return;
    }

    // GET /garden — the harvest overview. No publish policy involved: this page is entirely about
    // review state and intake freshness, neither of which the policy governs.
    if (pathname === GARDEN_ROUTE) {
      const harvest = await loadHarvestDocument();
      send(
        res,
        httpStatusForHarvest(harvest),
        "text/html; charset=utf-8",
        renderGardenPage(harvest),
        headOnly,
      );
      return;
    }

    // GET /policy — a read-only view of the rules in force. Gated on the same rail as every other
    // policy-touching route: a broken file is refused rather than silently treated as empty.
    if (pathname === POLICY_ROUTE) {
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        sendPolicyRecovery(res, policy, headOnly, "policy", requestUrl);
        return;
      }
      send(
        res,
        200,
        "text/html; charset=utf-8",
        renderPolicyPage(policy.policy, policy.source),
        headOnly,
      );
      return;
    }

    // GET /publish — the offline publish preview. Same rail order as /leaflet/<id>: the policy is
    // loaded and gated FIRST (its failure is a fact about a file, not about any one leaflet), then
    // the leaf.
    if (pathname === PUBLISH_ROUTE) {
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        sendPolicyRecovery(res, policy, headOnly, "publish", requestUrl);
        return;
      }
      const load = await loadLeafDocument();
      send(
        res,
        httpStatusFor(load),
        "text/html; charset=utf-8",
        renderPublishPage(load, policy.policy, requestUrl.searchParams, setupManagerOrigin(process.env), publishLauncher(process.env, process.execPath)),
        headOnly,
      );
      return;
    }

    if (pathname.startsWith(OWNER_LEAFLET_ROUTE)) {
      // THE OWNER'S REPORT — every leaflet opens here, including private and policy-withheld
      // ones, because the reader IS the subject (this server binds loopback). The share route
      // below keeps its rails untouched; nothing published ever links here.
      const id = pathname.slice(OWNER_LEAFLET_ROUTE.length);
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        sendPolicyRecovery(res, policy, headOnly, "leaf", requestUrl);
        return;
      }
      const load = await loadLeafDocument();
      if (!load.ok) {
        send(res, httpStatusFor(load), "text/html; charset=utf-8", renderLeafPage(load, policy.policy, "private"), headOnly);
        return;
      }
      const leaflet = findLeaflet(load.leaf, decodeURIComponent(id), policy.policy, "private");
      send(
        res,
        leaflet.ok ? 200 : 404,
        "text/html; charset=utf-8",
        renderLeafletPage(leaflet, load.source, "private"),
        headOnly,
      );
      return;
    }

    if (pathname.startsWith(OWNER_MEDIA_ROUTE)) {
      const media = await serveMedia(pathname.slice(OWNER_MEDIA_ROUTE.length), "private");
      send(res, media.status, media.type, media.body, headOnly);
      return;
    }

    if (pathname.startsWith(LEAFLET_ROUTE)) {
      // The id is the remainder of the ALREADY-DECODED path, so an id containing a slash arrives
      // whole rather than being split by one of its own characters. It is never used as a file
      // path — it is looked up in a document already in memory — so there is nothing here for a
      // traversal to reach.
      const id = pathname.slice(LEAFLET_ROUTE.length);
      // THE RAIL IS LOADED BEFORE THE DOCUMENT AND ITS FAILURE IS NOT A 404. A broken policy file
      // is the operator's bug, not a fact about this id — and it answers identically for EVERY id,
      // so it discloses nothing about any of them. Collapsing it into the private/nonexistent
      // refusal would hide a file the subject has to fix behind a page that looks like it worked.
      const policy = await loadPublishPolicy();
      if (!policy.ok) {
        send(res, 503, "text/plain; charset=utf-8", policyRefusal(policy), headOnly);
        return;
      }
      const load = await loadLeafDocument();
      if (!load.ok) {
        // The document failed to load. That is the SAME five causes the leaf page has, so it is
        // the same page: inventing a leaflet-shaped failure would say something about a leaflet
        // when nothing was read.
        send(
          res,
          httpStatusFor(load),
          "text/html; charset=utf-8",
          renderLeafPage(load, policy.policy, "private"),
          headOnly,
        );
        return;
      }
      const leaflet = findLeaflet(load.leaf, id, policy.policy);
      // THE SOURCE TRAVELS WITH THE LEAFLET. It is what the fabrication band is computed from, and
      // for as long as this call passed only the leaflet, this route served an example document
      // with no band while `/` served the same bytes with one. `renderLeafletPage` requires it now,
      // so the omission cannot be made again without failing the typecheck.
      send(
        res,
        leaflet.ok ? 200 : 404,
        "text/html; charset=utf-8",
        renderLeafletPage(leaflet, load.source),
        headOnly,
      );
      return;
    }

    if (pathname.startsWith(MEDIA_ROUTE)) {
      // The ref is the remainder of the ALREADY-DECODED path. It is never joined to a path here:
      // `parseMediaRef` inside the store refuses anything that is not `sha256:` plus 64 lowercase
      // hex characters, and 64 hex characters contain no separator and no `..` to traverse with.
      const media = await serveMedia(pathname.slice(MEDIA_ROUTE.length));
      send(res, media.status, media.type, media.body, headOnly);
      return;
    }

    const asset = ASSETS.get(pathname);
    if (asset !== undefined) {
      send(res, 200, asset.type, await readFile(asset.file), headOnly);
      return;
    }

    if (pathname.startsWith("/fonts/")) {
      const file = fontPath(pathname);
      if (file === null) {
        send(res, 403, "text/plain; charset=utf-8", "forbidden", headOnly);
        return;
      }
      send(res, 200, "font/woff2", await readFile(file), headOnly);
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", `no route for ${pathname}`, headOnly);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
    if (code === "ELOCALBUSY") {
      send(res, 409, "text/plain; charset=utf-8", err instanceof Error ? err.message : String(err), headOnly);
      return;
    }
    if (code === "ENOENT") {
      // A genuinely missing asset. Named, so a 404 for the stylesheet is not a mystery.
      send(res, 404, "text/plain; charset=utf-8", `not found: ${pathname}`, headOnly);
      return;
    }
    console.error(`[leaf] ${pathname} failed:`, err);
    send(res, 500, "text/plain; charset=utf-8", `server error [${code}]`, headOnly);
  }
});

server.on("error", reportListenError);

server.listen(PORT, HOST, async () => {
  if (brainUpkeep !== null) {
    const brainCheck = setInterval(() => brainUpkeep.request(), BRAIN_CHECK_MS);
    brainCheck.unref();
  }
  // The brain's first request at start follows the first collection pass, which runs at once; with
  // no collector it is made here instead.
  let passesAsk = false;
  if (process.env["FOLIAGE_WORKFLOW_DIR"] && ["127.0.0.1", "::1"].includes(HOST)) {
    try {
      // The collector writes the one review queue: the same harvest /review decides.
      const harvest = process.env[HARVEST_ENV]?.trim();
      workflow = await openWorkflow(resolve(process.env["FOLIAGE_WORKFLOW_DIR"]), {
        env: process.env,
        ...(harvest ? { harvestPath: resolve(harvest) } : {}),
        journey: {
          ready: () => assessmentConnection.status().ready,
          collaborate: context => assessmentConnection.collaborate(context),
        },
      });
      // After every pass the brain is asked for, whatever the pass did: one that failed part-way may still have written.
      const run = () => { void workflow?.tick().then(() => brainUpkeep?.request()).catch(error => { brainUpkeep?.request(); workflowFailure = String(error); console.error("[workflow]", error); const failed = workflow; workflow = null; void failed?.close().catch(closeError => console.error("[workflow] close", closeError)); }); };
      workflowTimer = setInterval(run, 30_000); workflowTimer.unref(); run();
      passesAsk = true;
    } catch(error) { workflowFailure = error instanceof Error ? error.message : String(error); console.error("[workflow]",workflowFailure); }
  }
  if (!passesAsk) brainUpkeep?.request();

  // THE PORT IS READ BACK OFF THE LISTENER, not echoed from the request. With `PORT=0` — which is
  // how a test asks the OS for a free port, and the only way to boot beside a running dev server
  // without racing it — the configured value is the literal 0 and the banner printed
  // `http://127.0.0.1:0/`, a URL that cannot be connected to. A startup line that names an address
  // nothing is listening on is worse than no startup line: it is the process reporting a fact
  // about itself that is false.
  const bound = server.address();
  const port = bound !== null && typeof bound === "object" ? bound.port : PORT;

  // Say out loud which document is in play and what state it is in. A server that starts
  // silently invites the assumption that it found something.
  const load = await loadLeafDocument();
  const state = load.ok
    ? `${load.leaf.leaflets.length} leaflet(s) for "${load.leaf.subject}" from ${load.source.path}`
    : `${load.cause} — ${load.detail}`;
  console.log(`[leaf] http://${HOST}:${port}/`);
  console.log(`[leaf] ${state}`);

  // THE RULES GET THEIR OWN LINE, and it names WHICH rules. A rail whose provenance is invisible
  // is one the operator cannot audit: "why is that address 404ing" has two very different answers
  // depending on whether the policy came from a file they wrote or the shipped default they have
  // never read, and the banner is the cheapest place to make that unambiguous.
  const policy = await loadPublishPolicy();
  console.log(
    `[leaf] publish policy: ` +
      (policy.ok
        ? `${policy.policy.rules.length} rule(s) from ${describePolicySource(policy.source)}`
        : `${policy.cause} — ${policy.detail} — NOTHING IS SERVED until this is fixed`),
  );

  // THE STRIPPED METADATA GETS SAID OUT LOUD. Removing somebody's GPS coordinates and never
  // mentioning it would be a silent rewrite, which is the thing this repository refuses
  // everywhere else — so the store is counted at startup and the removal is stated as a
  // measurement. It is derived from the manifest beside each object, never from a running total
  // somebody could forget to update.
  if (load.ok) {
    const store = await summarizeStore(mediaRootForDocument(load.source.path));
    console.log(
      `[leaf] media store ${store.root}: ` +
        (store.unreadable !== null
          ? store.unreadable
          : `${store.objects} object(s)` +
            (store.objects === 0
              ? ` — no photographs are held, so any leaflet naming an image answers 404`
              : `, ${store.withMetadataRemoved} of which had metadata removed on the way in ` +
                `(${store.metadataBytesRemoved} bytes, EXIF/GPS included)`) +
            (store.incomplete === 0 ? `` : `, ${store.incomplete} INCOMPLETE and not servable`)),
    );
  }

  // The queue is a second document with a second set of states, so it gets its own line rather
  // than being folded into the leaf's — "absent" about one of them is not "absent" about both.
  const harvest = await loadHarvestDocument();
  console.log(
    `[leaf] http://${HOST}:${port}${REVIEW_ROUTE}  ` +
      (harvest.ok
        ? `${harvest.harvest.candidates.length} candidate(s) from ${harvest.path}`
        : `${harvest.cause} — ${harvest.detail}`),
  );

  // SCARLET SAYS WHICH MODEL, OR THAT THERE IS NONE. A run against no model is a named refusal
  // on the stream, not a silent default — and the banner is where the operator learns that
  // before the first question rather than after it. The Origin line is the same one the writes
  // need; a non-browser client sends it itself.
  const model = currentModel();
  console.log(
    `[leaf] http://${HOST}:${port}${SCARLET_RUN_ROUTE}  POST, AG-UI over SSE  ` +
      (model.ok
        ? `model ${model.config.model} at ${model.config.baseUrl}`
        : `no model selected — open ${SCARLET_SETUP_ROUTE}`) +
      `  (send -H "Origin: http://${HOST}:${port}")`,
  );
  console.log(`[leaf] http://${HOST}:${port}${SCARLET_ROUTE}  the same run as a page: ask, read, nothing kept`);
});

async function stopWorkflow() {
  if (workflowTimer) clearInterval(workflowTimer);
  await workflow?.close();
  server.close();
}
process.once("SIGTERM", () => { void stopWorkflow().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void stopWorkflow().finally(() => process.exit(0)); });
