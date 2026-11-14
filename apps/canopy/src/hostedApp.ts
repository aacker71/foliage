import type { RecruitingConnections } from "./mergeConnections.ts";
import { hostedShell as shell } from "./hostedShell.ts";
import { hostedPublicSearch, type SearchPublished } from "./hostedPublicSearch.ts";
import type { createHostedDistribution } from "./hostedDistribution.ts";
import { publicResumeDocx } from "./distributionDocx.ts";
import { renderDistributionResume, publicResumeBytes } from "./distributionView.ts";
import { HostedNangoError, type createHostedNango } from "./hostedNango.ts";
/** Personal hosted HTTP surface. Providers own identity and authority; no local file fallback. */
import { deviceReturn } from "./deviceConnection.ts";
import { decodePhotoTransfer, PublicationPhotoError } from "./publicationPhotos.ts";
import { combinedMediaTransferIssue, decodeVideoTransfer, PublicationVideoError } from "./publicationVideos.ts";
import { randomUUID } from "node:crypto";
import { ui } from "@foliage/ui";
import { PUBLISHED_ID, distributionProjection, documentDigest, parsePublishedDocument, toArtifactJson, type PublishedLeafDocument } from "@foliage/canopy";
import { HostedAdmissionError, MAX_ADMISSION_BYTES, admitPublication, publicationBytes, type PublicationConsent } from "./hostedAdmission.ts";
import { HOSTED_COOKIES, HOSTED_PRIVATE_PATH, HostedIdentityError, assertHostedMutation, createHostedIdentity, createPkceVerifier,
  hostedAccessToken, hostedCookie, pkceChallenge, readHostedCookie, safeHostedReturnTo, type HostedActor, type HostedSession } from "./hostedIdentity.ts";
import { HostedStoreError, MAX_ADDRESSES_PER_ACCOUNT, addressLimitError, type HostedStore, type OwnedPublication, type PublicationReceipt, type PublicationResult } from "./hostedStore.ts";
import { HostedGitHubProofError, type createHostedGitHubProof } from "./hostedGitHubProof.ts";
import type { createHostedNotificationWorker } from "./hostedNotifications.ts";
import { esc, renderPublishedLeafletNotFound } from "./renderPublished.ts";
import { publicHeaders } from "./publicHeaders.mjs";
import { logRequestFailure } from "./requestFailure.mjs";
import { publicationLeafletView, publicationView } from "./publicationView.ts";
import { hasPortfolioEnhancement } from "./renderPublished.ts";

type Fields = Record<string, string>;
interface Flow { verifier: string; purpose: "signup" | "recovery"; returnTo: string; startedAt: number }
const MAX_REQUEST_BYTES = 4 * MAX_ADMISSION_BYTES;
const AUTH_PATHS = new Set(["/auth/sign-in", "/auth/sign-up", "/auth/recovery", "/auth/callback", "/auth/password", "/auth/refresh", "/auth/sign-out"]);
const FIELD_NAMES = new Set(["organization", "candidateName", "candidateId", "payloadDigest", "connectionId", "leafId", "name", "challenge", "callback", "state", "csrf", "email", "password", "refreshToken", "returnTo", "code", "subjectId", "document", "photos", "videos", "evidence", "consent", "reviewActorId", "operationId", "expectedRevisionId", "expectedGeneration", "inbox", "sms", "weeklySummary", "dailyDigest", "summaryPreferencesVersion"]);
/** Findability stays the header's job (publicHeaders.mjs). `Disallow: /` would hide that header:
 * a crawler that may not fetch a URL never reads its noindex, and can still list it bare from links. */
const ROBOTS = "# Not for search results: every response sends X-Robots-Tag: noindex.\n# Crawling stays open so crawlers can read that header.\nUser-agent: *\nDisallow:\n";
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const link = (href: string, label: string) => `<a class="link" href="${esc(href)}">${esc(label)}</a>`;
const form = (action: string, csrf: string, content: string, multipart = false) => `<form method="post" action="${esc(action)}"${multipart ? ' enctype="multipart/form-data"' : ""}>${hidden("csrf", csrf)}${content}</form>`;
const button = (label: string) => ui.button(label, { className: "manage-primary", type: "submit", variant: "default" });
const field = (name: string, label: string, type = "text", autocomplete = "off", required = true) => `<p>${ui.label(label, { htmlFor: name })}<br>${ui.input({ id: name, name, type, autoComplete: autocomplete, required, ...(type === "file" ? { accept: "application/json,.json" } : {}) })}</p>`;
const error = (message: string): never => { throw new HostedIdentityError("invalid-request", message); };

/** Import is a fallback until the authenticated Photosynthesis connection ships. */
function importPortfolio(action: string, csrf: string): string {
  return `<section class="onboarding-import" aria-label="Import from Photosynthesis"><h2>Import portfolio</h2>${form(action, csrf,
    field("document", "Portfolio export", "file") + '<details class="onboarding-details"><summary>GitHub verification (optional)</summary>' + field("evidence", "GitHub verification file", "file", "off", false) + '</details>' + button("Preview"), true)}</section>`;
}
function connectPhotosynthesis(): string {
  return `<section class="onboarding-import"><h2>Connect Photosynthesis</h2>${ui.button("Connect my work", { id: "connect-photosynthesis", type: "button", className: "manage-primary" })}<p id="photosynthesis-status" role="status" class="onboarding-hint"></p><noscript>Requires JavaScript.</noscript><script defer src="/auth/photosynthesis.js"></script></section>`;
}
function authForm(path: string, csrf: string, returnTo: string): string {
  const title = path === "/auth/sign-up" ? "Create your account" : path === "/auth/recovery" ? "Recover your account" : path === "/auth/password" ? "Set a new password" : "Sign in";
  const password = path === "/auth/recovery" ? "" : field("password", path === "/auth/password" ? "New password" : "Password", "password", path === "/auth/sign-in" ? "current-password" : "new-password");
  return shell(title, `<section class="manage-actions">${form(path, csrf, hidden("returnTo", returnTo) +
    (path === "/auth/password" ? "" : field("email", "Email", "email", "email")) + password + button(title))}</section>
<p>${link("/auth/sign-in", "Sign in")} · ${link("/auth/sign-up", "Create account")} · ${link("/auth/recovery", "Reset password")}</p>`, csrf);
}
async function readFields(request: Request): Promise<Fields> {
  if (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") return error("Compressed uploads are not supported.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) return error("The upload exceeds the supported size.");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = request.body?.getReader();
  if (reader) try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return error("The upload exceeds the supported size."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const type = request.headers.get("content-type") ?? "";
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/i.test(type)) return error("Use the current form to submit this action.");
  let data: FormData;
  try { data = await new Response(Buffer.concat(chunks), { headers: { "content-type": type } }).formData(); }
  catch { return error("Form unreadable. Try again."); }
  const fields: Fields = {};
  for (const [name, value] of data) {
    if (!FIELD_NAMES.has(name) || Object.hasOwn(fields, name)) return error("The form has unexpected or repeated fields.");
    if (typeof value === "string") fields[name] = value;
    else {
      if (!["document", "evidence"].includes(name) || value.size > (name === "evidence" ? 16 * 1024 : MAX_ADMISSION_BYTES)) return error("Choose a supported publication or proof-coordinate file within the upload limit.");
      fields[name] = await value.text();
    }
  }
  return fields;
}
function wireDocument(text: string | undefined): PublishedLeafDocument {
  if (!text || Buffer.byteLength(text) > MAX_ADMISSION_BYTES) return error("Choose a publication file within the supported size.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return error("Not readable JSON. Export again."); }
  const parsed = parsePublishedDocument(value);
  if (!parsed.ok || ![3, 4, 5, 6, 7].includes(parsed.document.artifactVersion)) return error("Failed format or disclosure checks. Export again.");
  return parsed.document;
}
function reviewedConsent(text: string | undefined): PublicationConsent {
  try { return JSON.parse(text ?? "null") as PublicationConsent; }
  catch { return error("Review unreadable. Review again."); }
}
function flowFrom(request: Request): Flow {
  let flow: unknown;
  try { flow = JSON.parse(Buffer.from(readHostedCookie(request.headers, HOSTED_COOKIES.flow) ?? "", "base64url").toString("utf8")); }
  catch { return error("Confirmation expired. Start again."); }
  if (typeof flow !== "object" || flow === null || !("verifier" in flow) || typeof flow.verifier !== "string" ||
      !("purpose" in flow) || !["signup", "recovery"].includes(String(flow.purpose)) ||
      !("returnTo" in flow) || typeof flow.returnTo !== "string" || !("startedAt" in flow) ||
      typeof flow.startedAt !== "number" || flow.startedAt > Date.now() || Date.now() - flow.startedAt > 10 * 60_000) return error("Confirmation expired. Start again.");
  pkceChallenge(flow.verifier);
  return flow as Flow;
}
function carriedReview(path: string, fields: Fields): string {
  if (path !== "/manage/import/start" && !/^\/manage\/[a-z0-9-]+\/(preview|publish|withdraw)$/.test(path)) return "";
  const allowed = ["document", "evidence", "consent", "reviewActorId", "operationId", "expectedRevisionId", "expectedGeneration"];
  return allowed.filter(name => fields[name] !== undefined).map(name => hidden(name, fields[name]!)).join("");
}
function preservedForm(path: string, fields: Fields, csrf: string): string {
  const carried = carriedReview(path, fields);
  return carried ? form(path, csrf, carried + button("Retry")) : "";
}
function receiptContent(saved: PublicationResult): string {
  const receipt: PublicationReceipt = saved.receipt;
  return `<p>${receipt.kind === "publish" ? "Publication saved" : "Withdrawal saved"}${saved.replayed ? " (existing receipt)" : ""}</p>
<p>${saved.current.visible ? `Public · ${link(`/leaf/${saved.current.subjectId}`, "Open")}` : "Not public"}</p>
<p>Saved <time class="num" datetime="${esc(receipt.committedAt)}">${esc(receipt.committedAt)}</time></p>
<details class="manage-payload cell"><summary>Decision receipt</summary><pre class="num">${esc(JSON.stringify(saved, null, 2))}</pre></details>
<p>${link(`/manage/${receipt.subjectId}`, "Back")}</p>`;
}

export function createHostedApp(config: {
  recruitingConnections?: RecruitingConnections;
  searchPublished?: SearchPublished;
  distribution?: ReturnType<typeof createHostedDistribution>;
  nango?: ReturnType<typeof createHostedNango>;
  device?: { createDeviceGrant: (token: string, challenge: string) => Promise<string>; deviceSession: (token: string) => Promise<HostedSession> };
  clerk?: boolean; appOrigin: string; identity: ReturnType<typeof createHostedIdentity>; store: HostedStore;
  verifyPublication?: ReturnType<typeof createHostedGitHubProof>;
  notifications?: Pick<ReturnType<typeof createHostedNotificationWorker>, "preferences" | "setPreferences" | "handleRequest">;
  loadAsset?: (path: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
}) {
  const origin = new URL(config.appOrigin);
  if (origin.protocol !== "https:" || origin.origin !== config.appOrigin) throw new Error("FOLIAGE_APP_ORIGIN must be an exact HTTPS origin.");
  async function owner(actor: HostedActor, id: string): Promise<OwnedPublication> {
    if (!PUBLISHED_ID.test(id)) throw new HostedStoreError("forbidden", "That publication is unavailable in this account.");
    let after: string | undefined;
    // Bound one private lookup while the first store adapter supplies paged inventory only.
    for (let page = 0; page < 20; page++) {
      const rows = await config.store.listOwned(actor, { ...(after ? { after } : {}), limit: 200 });
      const found = rows.find(row => row.subjectId === id && row.actorId === actor.id);
      if (found) return found;
      const last = rows.at(-1)?.subjectId;
      if (rows.length < 200 || !last || last >= id) break;
      if (after && last <= after) throw new HostedStoreError("corrupt", "Publication inventory did not advance.");
      after = last;
      if (page === 19) throw new HostedStoreError("unavailable", "Lookup limit reached.");
    }
    throw new HostedStoreError("forbidden", "That publication is unavailable in this account.");
  }
  // The authority RPC enforces the same cap; this refuses plainly before calling it and still
  // holds where that migration is not applied yet. An address already owned stays reachable.
  async function reserve(actor: HostedActor, id: string): Promise<OwnedPublication> {
    const held = await config.store.listOwned(actor, { limit: MAX_ADDRESSES_PER_ACCOUNT });
    if (held.length >= MAX_ADDRESSES_PER_ACCOUNT && !held.some(row => row.subjectId === id)) {
      try { await owner(actor, id); } catch (cause) { throw cause instanceof HostedStoreError && cause.code === "forbidden" ? addressLimitError() : cause; }
    }
    return config.store.reserveSubject(actor, id);
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), api = url.pathname.startsWith("/api/");
    // Device transport reuses the same account, admission and authority routes. It never
    // accepts browser cookies or Origin, creates a browser session, or enables CORS.
    const path = api ? url.pathname.replace(/^\/api\/subjects(?=\/|$)/, "/manage").replace(/^\/api\/operations\//, "/operations/").replace(/^\/api\/distribution\//, "/distribution/") : url.pathname;
    const recruiting = /^\/(recruiting|distribution)(\/|$)/.test(path) || /^\/manage\/[^/]+\/distribution(?:\/|$)/.test(path);
    const cookies: string[] = []; let fields: Fields = {}, csrf = "";
    const respond = (status: number, body: string | Uint8Array, contentType = "text/html; charset=utf-8", extra: Record<string, string> = {}) => {
      const headers = new Headers({ ...publicHeaders(), "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store", "vercel-cdn-cache-control": "no-store", pragma: "no-cache", "content-type": contentType, ...extra });
      if (!path.startsWith("/leaf/") && path !== "/leaflet" && !path.startsWith("/leaflet/")) headers.set("content-security-policy", headers.get("content-security-policy")!.replace("form-action 'none'", "form-action 'self'"));
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      return new Response(request.method === "HEAD" ? null : typeof body === "string" ? body : Uint8Array.from(body).buffer, { status, headers });
    };
    const redirect = (location: string) => respond(303, "", "text/plain; charset=utf-8", { location });
    const saveSession = (session: HostedSession) => {
      cookies.push(hostedCookie(HOSTED_COOKIES.access, session.accessToken, session.expiresIn), hostedCookie(HOSTED_COOKIES.refresh, session.refreshToken, 30 * 86400));
    };
    const clearSession = () => {
      for (const name of [HOSTED_COOKIES.access, HOSTED_COOKIES.refresh, HOSTED_COOKIES.flow]) cookies.push(hostedCookie(name, "", 0));
    };
    const actor = async () => config.identity.getUser(hostedAccessToken(request.headers).token);
    try {
      if (url.origin !== config.appOrigin || request.headers.has("host") && request.headers.get("host") !== origin.host) return respond(421, "This hostname is not configured for this application.", "text/plain; charset=utf-8");
      if (!["GET", "HEAD", "POST"].includes(request.method)) return respond(405, "Use the current page to choose an action.", "text/plain; charset=utf-8", { allow: "GET, HEAD, POST" });
      if (api) {
        if (request.headers.has("origin") || request.headers.has("cookie")) return respond(403, JSON.stringify({ code: "forbidden", error: "Device requests must use explicit credentials without browser cookies or Origin." }), "application/json");
        if (["/api/session", "/api/session/refresh"].includes(path)) {
          if (request.method !== "POST" || request.headers.has("authorization")) return error("Use the device sign-in or refresh action with one credential transport.");
          fields = await readFields(request);
          const allowed = path === "/api/session" ? ["email", "password"] : ["refreshToken"];
          if (Object.keys(fields).length !== allowed.length || allowed.some(name => fields[name] === undefined)) return error("Supply only the required device credentials.");
          const session = path === "/api/session" ? await config.identity.signIn(fields["email"]!, fields["password"]!) : await config.identity.refreshSession(fields["refreshToken"]!);
          return respond(200, JSON.stringify(session), "application/json");
        }
        if (hostedAccessToken(request.headers).transport !== "bearer") throw new HostedIdentityError("unauthenticated", "Connect this device to your Canopy account.");
        if (path === "/api/session/device" && request.method === "GET" && config.device) {
          return respond(200, JSON.stringify(await config.device.deviceSession(hostedAccessToken(request.headers).token)), "application/json");
        }
        if (path === "/api/sources/observations") {
          if (request.method !== "POST" || url.search) return error("Source observation reads use a POST body without query parameters.");
          fields = await readFields(request);
          const currentActor = await actor();
          if (!config.nango) throw new HostedIdentityError("unavailable", "Source connections are not configured.");
          const names = ["connectionId", "leafId", "name"];
          if (Object.keys(fields).length !== 3 || names.some(name => fields[name] === undefined)) return error("Select one source connection and local Leaf identity.");
          const batch = await config.nango.observations(currentActor, fields["connectionId"]!,
            { leafId: fields["leafId"]!, name: fields["name"]! });
          return respond(200, JSON.stringify(batch), "application/json");
        }
        if (path === "/api/session/disconnect") {
          if (request.method !== "POST") return error("Disconnect uses POST.");
          await config.identity.signOut(hostedAccessToken(request.headers).token);
          return respond(200, JSON.stringify({ disconnected: true }), "application/json");
        }
        if (!(path === "/manage" || /^\/manage\/[a-z0-9-]+(?:\/(?:preview|publish|withdraw|distribution(?:\/(connect|search))?))?$/.test(path) || /^\/operations\/[a-zA-Z0-9_-]{1,128}$/.test(path) || /^\/distribution\/[0-9a-f-]{36}(?:\/(send|cancel|reconcile))?$/.test(path))) return respond(404, JSON.stringify({ code: "not-found", error: "Device action unavailable." }), "application/json");
      }
      if (path === "/internal/notifications/run") {
        if (request.headers.has("origin") && request.headers.get("origin") !== config.appOrigin) return respond(403, "Worker origin refused.", "text/plain; charset=utf-8");
        return config.notifications ? config.notifications.handleRequest(request) : respond(503, "Notifications are not configured.", "text/plain; charset=utf-8");
      }
      if (path === "/healthz" && request.method !== "POST") {
        // Monitoring: anonymous, cookie-free, and the answer names no setting or provider. One
        // read-only authority lookup, because every hosted page needs that service; a process that
        // answers while the database is paused or unreachable is not healthy.
        try { await config.store.ping(); }
        catch (cause) {
          const reference = logRequestFailure({ layer: "health", method: request.method, target: url.pathname, status: 503, error: cause });
          return respond(503, "unavailable", "text/plain; charset=utf-8", { "x-request-id": reference });
        }
        return respond(200, "ok", "text/plain; charset=utf-8");
      }
      if (path === "/robots.txt" && request.method !== "POST") return respond(200, ROBOTS, "text/plain; charset=utf-8");
      const asset = path === "/favicon.ico" || /^\/(?:foliage-tokens\.css|roles\.css|foliage\.css|controls\.css|workspace-shell\.css|hosted-workspace\.css|canopy-(?:base|tokens)\.css|manage\.css|published\.css|resume\.(?:css|mjs)|portfolio-leaf\.(?:css|bundle\.js)|specimen-sheet-day\.jpg|mark-(?:icon|primary|expressive)\.svg|fonts\/[a-z0-9._-]+\.woff2)$/.test(path);
      if (asset && request.method !== "POST") {
        // Browsers ask for /favicon.ico by convention; the icon is the mark every page links.
        const loaded = await config.loadAsset?.(path === "/favicon.ico" ? "/mark-icon.svg" : path);
        return loaded ? respond(200, loaded.bytes, loaded.contentType) : respond(404, "Asset unavailable.", "text/plain; charset=utf-8");
      }
      const searchMatch = /^\/leaf\/([a-z0-9-]+)\/search\.json$/.exec(path);
      if (searchMatch) {
        const result = await hostedPublicSearch(url, request.method, searchMatch[1]!, config.store, config.searchPublished);
        return respond(result.status, result.body, "application/json; charset=utf-8", { allow: "GET, HEAD" });
      }
      const publicMcpMatch = /^\/leaf\/([a-z0-9-]+)\/mcp$/.exec(path);
      if (publicMcpMatch) {
        const { hostedPublicMcp } = await import("./hostedPublicMcp.ts");
        return hostedPublicMcp(request, publicMcpMatch[1]!, config.appOrigin, config.store, config.searchPublished);
      }
      const mediaMatch = /^\/leaf\/([a-z0-9-]+)\/media\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(path);
      if (mediaMatch && (request.method === "GET" || request.method === "HEAD")) {
        const photo = await config.store.readPhoto(mediaMatch[1]!, `sha256:${mediaMatch[2]}`, `sha256:${mediaMatch[3]}`);
        return photo ? respond(200, photo.bytes, photo.contentType, { "content-length": String(photo.bytes.length) }) : respond(404, "This photo is unavailable in the current publication.", "text/plain; charset=utf-8");
      }
      const videoMatch = /^\/leaf\/([a-z0-9-]+)\/video\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(path);
      if (videoMatch && (request.method === "GET" || request.method === "HEAD")) {
        const clip = await config.store.readVideo(videoMatch[1]!, `sha256:${videoMatch[2]}`, `sha256:${videoMatch[3]}`);
        if (!clip) return respond(404, "This clip is unavailable in the current publication.", "text/plain; charset=utf-8");
        const headers = { "accept-ranges": "bytes", "cross-origin-resource-policy": "same-origin" };
        const range = request.headers.get("range");
        if (range !== null) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
          let first = 0, last = clip.bytes.length - 1;
          if (match && (match[1] || match[2])) {
            if (!match[1]) {
              const suffix = Number(match[2]);
              first = Math.max(0, clip.bytes.length - suffix);
            } else {
              first = Number(match[1]);
              if (match[2]) last = Math.min(Number(match[2]), clip.bytes.length - 1);
            }
          }
          if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(first) ||
              !Number.isSafeInteger(last) || first < 0 || first > last || first >= clip.bytes.length ||
              (!match[1] && Number(match[2]) < 1)) {
            return respond(416, "", "video/mp4", { ...headers, "content-range": `bytes */${clip.bytes.length}` });
          }
          const part = clip.bytes.subarray(first, last + 1);
          return respond(206, part, "video/mp4", { ...headers, "content-range": `bytes ${first}-${last}/${clip.bytes.length}`, "content-length": String(part.length) });
        }
        return respond(200, clip.bytes, "video/mp4", { ...headers, "content-length": String(clip.bytes.length) });
      }
      if (path === "/leaflet" || path.startsWith("/leaflet/")) {
        if (request.method === "POST") return respond(405, "Published work is read-only.", "text/plain; charset=utf-8", { allow: "GET, HEAD" });
        const rawLeafletId = /^\/leaflet\/([^/]+)$/.exec(path)?.[1];
        const publicationId = url.searchParams.get("publication");
        let leafletId: string | null = null;
        try { leafletId = rawLeafletId ? decodeURIComponent(rawLeafletId) : null; } catch { /* Malformed URL. */ }
        const unavailable = () => respond(404, renderPublishedLeafletNotFound());
        // This address names one admitted artifact in one current publication. There is no
        // hosted tree projection to fall through to when the qualifier or item is absent.
        if (!leafletId || !publicationId || !PUBLISHED_ID.test(publicationId) ||
            url.search !== `?publication=${encodeURIComponent(publicationId)}`) return unavailable();
        const published = await config.store.readPublic(publicationId);
        if (!published || published.document.leaf.id !== publicationId ||
            !published.document.leaf.leaflets.some(item => item.id === leafletId)) return unavailable();
        if (request.method === "HEAD") return respond(200, "");
        const html = await publicationLeafletView(published.document, published.artifactDigest, leafletId);
        if (html === null) return unavailable();
        // Rendering reads a local sprite. Recheck authority after that await so replacement
        // or withdrawal cannot serve bytes assembled from an obsolete publication.
        const latest = await config.store.readPublic(publicationId);
        if (!latest || latest.revisionId !== published.revisionId || latest.generation !== published.generation ||
            latest.artifactDigest !== published.artifactDigest) return unavailable();
        return respond(200, html);
      }
      const publicMatch = /^\/leaf\/([a-z0-9-]+)(\/(?:agent\.json|document\.json|resume(?:\.(?:md|json|docx))?))?$/.exec(path);
      if (path.startsWith("/leaf/")) {
        if (request.method === "POST") return respond(405, "Publication changes belong in your private workspace.", "text/plain; charset=utf-8");
        const published = publicMatch && PUBLISHED_ID.test(publicMatch[1]!) ? await config.store.readPublic(publicMatch[1]!) : null;
        if (!published) return respond(404, "This publication is unavailable.", "text/plain; charset=utf-8");
        if (publicMatch?.[2] === "/agent.json") {
          if (request.method !== "GET" && request.method !== "HEAD") return respond(405, "Agent access is read-only.", "text/plain; charset=utf-8", { allow: "GET, HEAD" });
          const base = `/leaf/${publicMatch[1]}`;
          return respond(200, JSON.stringify({
            version: 1, scope: "current-publication", revision: published.revisionId,
            artifactDigest: published.artifactDigest,
            access: "Anonymous human and automated readers may read this owner-published portfolio and its admitted evidence through the listed interfaces.",
            limits: ["Public reading does not grant access to private work records or permission to publish, contact the owner, or deliver data to another service.",
              "Recheck the current publication before use. Withdrawal ends access here; previously downloaded copies cannot be recalled.",
              "Preserve citations, attribution and verification qualifications. Do not treat unverified claims as independently verified.",
              "Directory listing, partner feeds and destination delivery require separate owner permission."],
            links: { portfolio: base, resume: `${base}/resume`, resumeJson: `${base}/resume.json`,
              resumeMarkdown: `${base}/resume.md`, resumeWord: `${base}/resume.docx`,
              ...(config.searchPublished ? { search: `${base}/search.json?q={query}&limit=10`, mcp: `${base}/mcp` } : {}) },
          }), "application/json; charset=utf-8");
        }
        if (publicMatch?.[2] === "/resume.docx") {
          const bytes = request.method === "HEAD" ? null : await publicResumeDocx(published.document, config.appOrigin);
          const current = await config.store.readPublic(publicMatch[1]!);
          if (!current) return respond(404, "This publication is unavailable.", "text/plain; charset=utf-8");
          if (current.revisionId !== published.revisionId || current.generation !== published.generation || current.artifactDigest !== published.artifactDigest) return respond(409, "The publication changed. Download its current résumé again.", "text/plain; charset=utf-8");
          return respond(200, bytes ?? "", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", { "content-disposition": `attachment; filename="${publicMatch[1]}-resume.docx"` });
        }
        if (publicMatch?.[2] === "/resume.md") return respond(200, publicResumeBytes(published.document, config.appOrigin), "text/markdown; charset=utf-8", { "content-disposition": `attachment; filename="${publicMatch[1]}-resume.md"` });
        if (publicMatch?.[2] === "/resume.json") return respond(200, JSON.stringify(distributionProjection(published.document, config.appOrigin)), "application/json; charset=utf-8");
        if (publicMatch?.[2] === "/resume") return respond(200, renderDistributionResume(published.document, config.appOrigin), "text/html; charset=utf-8", publicHeaders({ print: true }));
        if (publicMatch?.[2]) return respond(200, publicationBytes(published.document), "application/json; charset=utf-8", { "content-disposition": `attachment; filename="${publicMatch[1]}.published.json"` });
        const html = (await publicationView(published.document, published.artifactDigest))
          .replace("</head>", `<link rel="describedby" type="application/json" title="Agent access" href="/leaf/${publicMatch![1]}/agent.json"><link rel="alternate" type="application/json" title="Résumé with evidence links" href="/leaf/${publicMatch![1]}/resume.json"></head>`);
        // A machine-readable pointer is present only on the hosted, currently published page.
        // Static exports do not advertise an MCP server they cannot serve.
        const publicHtml = config.searchPublished
          ? html.replace("</head>", `<link rel="service" type="application/json" title="Foliage public MCP" href="/leaf/${publicMatch![1]}/mcp"></head>`)
          : html;
        // The portfolio renderer can await local bundle inspection. A withdrawal or replacement
        // during that await must not release HTML assembled from the former publication.
        const latest = await config.store.readPublic(publicMatch![1]!);
        if (!latest) return respond(404, "This publication is unavailable.", "text/plain; charset=utf-8");
        if (latest.revisionId !== published.revisionId || latest.generation !== published.generation ||
            latest.artifactDigest !== published.artifactDigest) return respond(409, "The publication changed. Reload its current page.", "text/plain; charset=utf-8");
        return respond(200, publicHtml, "text/html; charset=utf-8", publicHeaders({ portfolio: hasPortfolioEnhancement(publicHtml) }));
      }
      // Only the private workspace asks who you are. Any other unclaimed address is absent: no
      // sign-in redirect, CSRF cookie or workspace navigation for scanners and mistyped links.
      if (!HOSTED_PRIVATE_PATH.test(path)) return respond(404, "Not found.", "text/plain; charset=utf-8");
      const existingCsrf = readHostedCookie(request.headers, HOSTED_COOKIES.csrf);
      csrf = existingCsrf && /^[A-Za-z0-9_-]{43}$/.test(existingCsrf) ? existingCsrf : createPkceVerifier();
      if (!api && csrf !== existingCsrf) cookies.push(hostedCookie(HOSTED_COOKIES.csrf, csrf, 86400));
      if (request.method === "POST") {
        fields = await readFields(request);
        const bearer = !AUTH_PATHS.has(path) && hostedAccessToken(request.headers).transport === "bearer";
        if (!bearer) assertHostedMutation(request.method, request.headers, fields["csrf"] ?? "", config.appOrigin);
        else if (request.headers.has("origin") && request.headers.get("origin") !== config.appOrigin) return error("Use the configured application origin.");
      }
      if (path === "/manage/sources/connect") {
        const currentActor = await actor();
        if (!config.nango) return respond(503, shell("Sources unavailable", "", csrf, true));
        if (request.method === "POST") {
          if (Object.keys(fields).some(name => name !== "csrf")) return error("Use the source connection form.");
          const destination = await config.nango.connect(currentActor);
          return respond(200, shell("Connect sources", link(destination, "Continue to source sign-in"), csrf, true));
        }
        return respond(200, shell("Connect sources", form(path, csrf, button("Connect")), csrf, true));
      }
      if (path === "/") return redirect("/manage");
      if (AUTH_PATHS.has(path)) {
        const returnTo = safeHostedReturnTo(fields["returnTo"] ?? url.searchParams.get("returnTo"));
        const afterSignIn = () => carriedReview(returnTo, fields) ? respond(200, shell("Review kept", preservedForm(returnTo, fields, csrf), csrf, true)) : redirect(returnTo);
        if (path === "/auth/callback") {
          if (request.method === "POST") cookies.push(hostedCookie(HOSTED_COOKIES.flow, "", 0));
          const code = fields["code"] ?? url.searchParams.get("code");
          if (!code || url.searchParams.getAll("code").length > 1) return error("Open the current confirmation link from your email.");
          const flow = flowFrom(request);
          if (request.method !== "POST") return respond(200, shell(flow.purpose === "recovery" ? "Recover account" : "Confirm account", form(path, csrf, hidden("code", code) + button("Continue")), csrf));
          const session = await config.identity.exchangeCode(code, flow.verifier);
          saveSession(session);
          return redirect(flow.purpose === "recovery" ? "/auth/password" : safeHostedReturnTo(flow.returnTo));
        }
        if (request.method !== "POST") {
          if (["/auth/sign-out", "/auth/refresh"].includes(path)) return respond(405, "Use the account form to continue.", "text/plain; charset=utf-8");
          if (path === "/auth/password") await actor();
          return respond(200, authForm(path, csrf, returnTo));
        }
        if (path === "/auth/sign-in") { saveSession(await config.identity.signIn(fields["email"] ?? "", fields["password"] ?? "")); return afterSignIn(); }
        if (path === "/auth/sign-up" || path === "/auth/recovery") {
          const verifier = createPkceVerifier();
          const flow: Flow = { verifier, purpose: path === "/auth/sign-up" ? "signup" : "recovery", returnTo, startedAt: Date.now() };
          cookies.push(hostedCookie(HOSTED_COOKIES.flow, Buffer.from(JSON.stringify(flow)).toString("base64url"), 600));
          if (path === "/auth/sign-up") {
            const session = await config.identity.signUp(fields["email"] ?? "", fields["password"] ?? "", pkceChallenge(verifier));
            if (session) { saveSession(session); cookies.push(hostedCookie(HOSTED_COOKIES.flow, "", 0)); return redirect(returnTo); }
          } else await config.identity.requestRecovery(fields["email"] ?? "", pkceChallenge(verifier));
          return respond(200, shell("Check your email", "<p>Open the link in this browser.</p>", csrf));
        }
        if (path === "/auth/refresh") {
          saveSession(await config.identity.refreshSession(readHostedCookie(request.headers, HOSTED_COOKIES.refresh) ?? ""));
          return afterSignIn();
        }
        if (path === "/auth/password") {
          await actor(); const token = hostedAccessToken(request.headers).token;
          await config.identity.updatePassword(token, fields["password"] ?? "");
          clearSession();
          try { await config.identity.signOut(token); }
          catch { return respond(503, shell("Password updated", `<p>Your password was updated. Session sign-out unconfirmed.</p>${link("/auth/sign-in", "Sign in")}`, csrf)); }
          return respond(200, shell("Password updated", link("/auth/sign-in", "Sign in"), csrf));
        }
        clearSession();
        try { await config.identity.signOut(hostedAccessToken(request.headers).token); }
        catch (cause) { if (!(cause instanceof HostedIdentityError && cause.code === "unauthenticated")) throw cause; }
        return redirect("/auth/sign-in");
      }
      const currentActor = await actor();
      if (path === "/settings/notifications") {
        if (!config.notifications) return respond(503, shell("Notifications unavailable", "", csrf, true));
        if (request.method === "POST") {
          if (fields["reviewActorId"] !== currentActor.id) throw new HostedStoreError("forbidden", "These preferences were reviewed in a different account.");
          if (fields["summaryPreferencesVersion"] !== "1") return error("Preferences changed. Reopen them.");
          for (const name of ["inbox", "email", "sms", "weeklySummary", "dailyDigest"]) if (fields[name] !== undefined && fields[name] !== "on") return error("Choose notification preferences using the current form.");
          await config.notifications.setPreferences(currentActor, { inbox: fields["inbox"] === "on", email: fields["email"] === "on", sms: fields["sms"] === "on", weeklySummary: fields["weeklySummary"] === "on", dailyDigest: fields["dailyDigest"] === "on" });
          return redirect("/settings/notifications?saved=1");
        }
        const preferences = await config.notifications.preferences(currentActor);
        const controls = ([ ["inbox", "In-app"], ["email", "Email"], ["sms", "Text message"] ] as const).map(([name, label]) =>
          `<p>${ui.input({ id: name, name, type: "checkbox", defaultChecked: preferences[name] })} ${ui.label(label, { htmlFor: name })}</p>`).join("");
        const summaries = ([ ["weeklySummary", "Weekly summary"], ["dailyDigest", "Daily digest"] ] as const).map(([name, label]) =>
          `<p>${ui.input({ id: name, name, type: "checkbox", defaultChecked: preferences[name] })} ${ui.label(label, { htmlFor: name })}</p>`).join("");
        return respond(200, shell("Notifications", `${url.searchParams.get("saved") === "1" ? '<p role="status">Saved</p>' : ""}${form(path, csrf, hidden("reviewActorId", currentActor.id) + hidden("summaryPreferencesVersion", "1") + "<h2>Notices</h2>" + controls + "<h2>Work summaries</h2>" + summaries + "<p role=\"status\">Summary email delivery is not available yet.</p>" + button("Save"))}`, csrf, true));
      }
      if (path === "/recruiting/accounts" || path === "/recruiting/accounts/connect") {
        const connections = config.recruitingConnections;
        if (!connections) return respond(503, shell("ATS accounts", `<p>ATS account setup is not configured here yet.</p><p>${link("/recruiting", "Back to recruiting")}</p>`, csrf, true, true));
        if (request.method === "POST") {
          if (path !== "/recruiting/accounts/connect") return respond(405, "Use Connect ATS account.", "text/plain; charset=utf-8");
          if (fields["reviewActorId"] !== currentActor.id || Object.keys(fields).some(key => !["csrf", "reviewActorId", "email", "organization"].includes(key))) throw new HostedStoreError("forbidden", "Reopen ATS accounts in your signed-in account.");
          const destination = await connections.connect(currentActor, { email: fields["email"] ?? "", organization: fields["organization"] ?? "" });
          return respond(200, shell("Connect your ATS", `<p>Continue with ${esc(connections.label)} to choose your ATS and authorize access. This setup link expires in 30 minutes.</p><p>${link(destination, "Continue to ATS sign-in")}</p><p>When setup finishes, return here to check the connection.</p><p>${link("/recruiting/accounts", "Check connection status")}</p>`, csrf, true, true));
        }
        if (path.endsWith("/connect")) return respond(405, "Use Connect ATS account.", "text/plain; charset=utf-8");
        let accounts: Awaited<ReturnType<RecruitingConnections["list"]>> | null = null;
        try { accounts = await connections.list(currentActor); } catch { /* An unavailable list is not an empty list. */ }
        const states = { connected: "Connected", incomplete: "Setup incomplete", reconnect: "Reconnect needed", idle: "Connection idle" };
        const rows = accounts?.map(account => `<li class="cell"><h2>${esc(account.integration)}</h2><p>${esc(account.organization)} · ${states[account.state]}</p>${account.state === "reconnect" || account.state === "incomplete" ? "<p>Continue setup below using the same organization.</p>" : ""}</li>`).join("");
        const status = accounts === null ? '<p role="status">Account status is unavailable. Refresh before starting another connection.</p>' : rows ? `<ul class="manage-publication-list">${rows}</ul>` : '<p>No ATS accounts connected yet.</p>';
        const setup = accounts === null ? "" : form("/recruiting/accounts/connect", csrf, hidden("reviewActorId", currentActor.id) + field("email", "Work email", "email", "email") + field("organization", "Organization", "text", "organization") + button("Connect ATS account"));
        return respond(200, shell("ATS accounts", `<p>Connect an employer account you administer through ${esc(connections.label)}.</p>${status}${setup}<p>Connection setup does not send a résumé or submit an application. Résumé delivery through this connection is not available yet.</p><p>${link("/recruiting/accounts", "Refresh status")} · ${link("/recruiting", "Back to recruiting")}</p>`, csrf, true, true));
      }
      if (path === "/recruiting") {
        if (request.method === "POST") return respond(405, "Choose a portfolio before a recruiting action.", "text/plain; charset=utf-8");
        const after = url.searchParams.get("after") ?? undefined;
        if (after !== undefined && !PUBLISHED_ID.test(after)) return error("Choose a valid portfolio page.");
        const rows = await config.store.listOwned(currentActor, { limit: 200, ...(after ? { after } : {}) });
        const available = rows.filter(row => row.visible);
        const items = available.map(row => `<li class="cell">${link(`/recruiting/portfolios/${row.subjectId}`, row.subjectId)}</li>`).join("");
        return respond(200, shell("Recruiting", `${items ? `<ul class="manage-publication-list">${items}</ul>` : '<p>No published portfolios</p>'}${rows.length === 200 ? `<p>${link(`/recruiting?after=${encodeURIComponent(rows.at(-1)!.subjectId)}`, "More portfolios")}</p>` : ""}`, csrf, true, true));
      }
      const sharePage = /^\/manage\/([a-z0-9-]+)\/share$/.exec(path);
      if (sharePage) {
        const id = sharePage[1]!, current = await owner(currentActor, id);
        if (request.method === "POST") return respond(405, "Sharing links requires no submission.", "text/plain; charset=utf-8");
        const content = current.visible ? `<section class="cell"><h2>Portfolio</h2><p>${link(`/leaf/${id}`, "Open live portfolio")}</p></section><section class="cell"><h2>Résumé</h2><p>${link(`/leaf/${id}/resume`, "Open résumé / Save PDF")} · ${link(`/leaf/${id}/resume.docx`, "Download Word (.docx)")} · ${link(`/leaf/${id}/resume.md`, "Download Markdown")}</p><details><summary>For agents</summary><p>${link(`/leaf/${id}/resume.json`, "Structured résumé with evidence links")}</p></details></section>` : '<p>Not public yet</p>';
        return respond(200, shell("Share", content + `<p>${link(`/manage/${id}`, "Back")}</p>`, csrf, true));
      }
      const distributionPage = /^\/recruiting\/portfolios\/([a-z0-9-]+)(\/(?:connect|search))?$/.exec(path) ?? /^\/manage\/([a-z0-9-]+)\/distribution(\/(?:connect|search))?$/.exec(path);
      if (distributionPage) {
        const id = distributionPage[1]!, recruitingPath = `/recruiting/portfolios/${id}`;
        const current = await owner(currentActor, id);
        if (!api && !path.startsWith("/recruiting/") && !distributionPage[2] && request.method !== "POST") return redirect(recruitingPath);
        const delivery = config.distribution;
        if (request.method === "POST") {
          if (!delivery) throw new HostedIdentityError("unavailable", "No recruiting destination configured.");
          const allowed = distributionPage[2] === "/search" ? ["csrf", "reviewActorId", "connectionId", "candidateName"] : distributionPage[2] ? ["csrf", "reviewActorId"] : ["csrf", "reviewActorId", "operationId", "connectionId", "candidateId"];
          if (fields["reviewActorId"] !== currentActor.id || Object.keys(fields).some(key => !allowed.includes(key))) throw new HostedStoreError("forbidden", "Use the sharing form in this account.");
          if (distributionPage[2] === "/connect") {
            const destination = await delivery.connect(currentActor);
            return api ? respond(200, JSON.stringify({ url: destination }), "application/json") : respond(200, shell("Connect recruiting account", link(destination, "Continue to destination sign-in"), csrf, true, true));
          }
          if (distributionPage[2] === "/search") {
            const connectionId = fields["connectionId"] ?? "";
            const found = await delivery.search(currentActor, connectionId, fields["candidateName"] ?? "");
            if (api) return respond(200, JSON.stringify(found), "application/json");
            const choices = found.candidates.map(candidate => `<li class="cell"><p><strong>${esc(candidate.name)}</strong> · ${link(`https://app.ashbyhq.com/candidates/${candidate.id}`, "Open in Ashby")}</p>${form(recruitingPath, csrf, hidden("reviewActorId", currentActor.id) + hidden("connectionId", connectionId) + hidden("candidateId", candidate.id) + hidden("operationId", randomUUID()) + ui.button("Preview", { type: "submit", variant: "outline" }))}</li>`).join("");
            return respond(200, shell("Choose candidate", `<p>Check it's the right person</p>${found.more ? "<p>More matches. Refine the name.</p>" : ""}${choices ? `<ul class="manage-publication-list">${choices}</ul>` : "<p>No matches</p>"}<p>${link(recruitingPath, "Back")}</p>`, csrf, true, true));
          }
          const saved = await delivery.prepare(currentActor, { subjectId: id, operationId: fields["operationId"] ?? "", connectionId: fields["connectionId"] ?? "", candidateId: fields["candidateId"] ?? "" });
          return api ? respond(200, JSON.stringify(saved), "application/json") : redirect(`/recruiting/deliveries/${saved.operationId}`);
        }
        if (distributionPage[2]) return respond(405, "Use the destination connection action.", "text/plain; charset=utf-8");
        const [history, connections] = delivery ? await Promise.all([
          delivery.list(currentActor, id).catch(() => null),
          delivery.connections(currentActor).catch(() => null),
        ]) : [[], []];
        if (api) return respond(200, JSON.stringify({ current, destination: delivery ? { label: delivery.label, capabilities: delivery.capabilities, connections } : null, history }), "application/json");
        const direct = current.visible ? `<p>${link(`/leaf/${id}`, "Read portfolio")} · ${link(`/leaf/${id}/resume`, "Read cited résumé")}</p>` : '<p>Not public. Delivery unavailable.</p>';
        const connected = (connections ?? []).filter(row => row.available);
        const accountChoice = connected.length === 1 ? hidden("connectionId", connected[0]!.id) : `<p><label for="connectionId">Recruiting account</label><br><select id="connectionId" name="connectionId" required>${connected.map((row, i) => `<option value="${esc(row.id)}">Ashby account ${i + 1} (${esc(row.id.slice(-8))})</option>`).join("")}</select></p>`;
        const destination = delivery ? `<section class="cell"><h2>Share with ${esc(delivery.label)}</h2>${form(`${recruitingPath}/connect`, csrf, hidden("reviewActorId", currentActor.id) + (connected.length ? ui.button("Connect another account", { type: "submit", variant: "outline" }) : button("Connect account")))}${connections?.some(row => !row.available) ? "<p>An account needs reconnecting.</p>" : ""}${current.visible && connected.length ? form(`${recruitingPath}/search`, csrf, hidden("reviewActorId", currentActor.id) + accountChoice + field("candidateName", "Candidate name") + button("Find candidate")) : ""}</section>` : `<section class="cell"><p>No destination configured</p></section>`;
        const rows = (history ?? []).map(r => `<li>${link(`/recruiting/deliveries/${r.operationId}`, `${r.candidateName} · ${r.status}`)}${r.current ? "" : " · publication changed"}</li>`).join("");
        const connectionFailure = connections === null ? "<p role=\"status\">Connections unavailable. Refresh.</p>" : "";
        return respond(200, shell("Recruiting", direct + connectionFailure + destination + `<section><h2>Delivery history</h2>${history === null ? "<p>History unavailable. Refresh before another delivery.</p>" : rows ? `<ul>${rows}</ul>` : "<p>No deliveries</p>"}</section>`, csrf, true, true));
      }
      const distributionOperation = /^\/recruiting\/deliveries\/([0-9a-f-]{36})(?:\/(send|cancel|reconcile))?$/.exec(path) ?? /^\/distribution\/([0-9a-f-]{36})(?:\/(send|cancel|reconcile))?$/.exec(path);
      if (distributionOperation) {
        const delivery = config.distribution;
        if (!delivery) throw new HostedIdentityError("unavailable", "No destination configured.");
        const operation = distributionOperation[1]!, action = distributionOperation[2];
        let saved = await delivery.read(currentActor, operation);
        if (!api && path.startsWith("/distribution/") && !action && request.method !== "POST") return redirect(`/recruiting/deliveries/${operation}`);
        if (request.method === "POST") {
          if (fields["reviewActorId"] !== currentActor.id || Object.keys(fields).some(key => !["csrf", "reviewActorId", "payloadDigest"].includes(key))) throw new HostedStoreError("forbidden", "This delivery was reviewed in another account or has unexpected fields.");
          if (action === "send") saved = await delivery.send(currentActor, operation, fields["payloadDigest"] ?? "");
          else if (action === "cancel") saved = await delivery.cancel(currentActor, operation);
          else if (action === "reconcile") saved = await delivery.reconcile(currentActor, operation);
          else return error("Choose a delivery action.");
          return api ? respond(200, JSON.stringify(saved), "application/json") : redirect(`/recruiting/deliveries/${operation}`);
        }
        if (action) return respond(405, "Delivery actions require POST.", "text/plain; charset=utf-8");
        const preview = saved.status === "prepared" && saved.current ? await delivery.preview(currentActor, saved) : null;
        if (api) return respond(200, JSON.stringify({ receipt: saved, preview }), "application/json");
        const controls = hidden("reviewActorId", currentActor.id);
        const title = saved.status === "prepared" ? "Review delivery" : saved.status === "accepted" ? "Accepted" : saved.status === "unknown" ? "Outcome unknown" : "Delivery status";
        const state = saved.status === "accepted" ? "Accepted by the destination." : saved.status === "unknown" ? "Not confirmed. Check Ashby before another delivery." : saved.status === "sending" ? "Sending. Refresh to check." : saved.status === "rejected" ? `Not accepted (${saved.reason ?? "destination refused"}).` : saved.status === "cancelled" ? "Cancelled. Nothing sent." : "";
        return respond(200, shell(title, `<p class="onboarding-lede">${esc(saved.candidateName)} · ${esc(delivery.label)}</p>${state ? `<p role="status">${esc(state)}</p>` : ""}${!saved.current ? "<p>Publication changed or offline. Shared copies may remain.</p>" : ""}${preview ? `<details class="manage-payload cell" open><summary>Content to share</summary><pre>${esc(preview)}</pre></details>${form(`/recruiting/deliveries/${operation}/send`, csrf, controls + hidden("payloadDigest", saved.payloadDigest) + button("Share"))}` : ""}${saved.status === "prepared" ? form(`/recruiting/deliveries/${operation}/cancel`, csrf, controls + ui.button("Cancel", { type: "submit" })) : ""}${saved.status === "unknown" ? form(`/recruiting/deliveries/${operation}/reconcile`, csrf, controls + button("Check Ashby")) : ""}<p>Sent notes stay in Ashby</p><p>${link(`/recruiting/portfolios/${saved.subjectId}`, "Back")}</p>`, csrf, true, true));
      }
      const operationMatch = /^\/operations\/([a-zA-Z0-9_-]{1,128})$/.exec(path);
      if (operationMatch && request.method !== "POST") {
        const result = await config.store.operation(currentActor, operationMatch[1]!);
        if (!result) return respond(404, shell("No receipt yet", "<p>Retry the same operation from your review.</p>", csrf, true));
        return api || request.headers.get("accept")?.includes("application/json") ? respond(200, JSON.stringify(result), "application/json") : respond(200, shell("Decision receipt", receiptContent(result), csrf, true));
      }
      if (path === "/manage/device/connect" && config.device) {
        const values = request.method === "POST" ? fields : Object.fromEntries(url.searchParams);
        const callback = deviceReturn(values["callback"] ?? "");
        const challenge = values["challenge"] ?? "", state = values["state"] ?? "";
        if (![challenge, state].every(value => /^[A-Za-z0-9_-]{43}$/.test(value))) return error("Start the connection again from Photosynthesis.");
        if (request.method === "POST") {
          const grant = await config.device.createDeviceGrant(hostedAccessToken(request.headers).token, challenge);
          return respond(200, shell("You’re connected.", `<p>Returning to Photosynthesis…</p><form id="device-return" method="post" action="${esc(callback.href)}">${hidden("state", state)}${hidden("grant", grant)}${button("Continue")}</form><script defer src="/auth/device-return.js"></script>`, csrf, true), "text/html; charset=utf-8", { "x-foliage-local-return": callback.origin });
        }
        return respond(200, shell("Connect Photosynthesis", `${form(path, csrf, hidden("callback", callback.href) + hidden("challenge", challenge) + hidden("state", state) + button("Connect this device"))}<p>Expires within a day.</p>`, csrf, true));
      }
      if (path === "/manage") {
        if (request.method === "POST") {
          const reserved = await reserve(currentActor, fields["subjectId"] ?? "");
          if (api) return respond(200, JSON.stringify(reserved), "application/json");
          return redirect(`/manage/${reserved.subjectId}`);
        }
        const after = url.searchParams.get("after");
        const rows = await config.store.listOwned(currentActor, { ...(after ? { after } : {}), limit: 100 });
        if (api) return respond(200, JSON.stringify({ publications: rows }), "application/json");
        return respond(200, shell("Your portfolio", `${rows.length ? `<ul class="manage-publication-list">${rows.map(row => `<li class="cell"><div><span class="onboarding-eyebrow">${row.visible ? "Live portfolio" : "Not published"}</span><h2>${esc(row.subjectId)}</h2>${link(`/manage/${row.subjectId}`, row.visible ? "Manage" : "Add work")}</div></li>`).join("")}</ul>` : ""}
${connectPhotosynthesis()}${config.nango ? `<p>${link("/manage/sources/connect", "Connect sources")}</p>` : ""}<details class="onboarding-details"><summary>Import a file</summary>${importPortfolio("/manage/import/start", csrf)}</details>
${rows.length === 100 ? `<p>${link(`/manage?after=${rows.at(-1)!.subjectId}`, "More portfolios")}</p>` : ""}`, csrf, true));
      }
      // Browser imports infer the canonical subject from the validated export. They
      // never rename a subject or skip current ownership, admission, or final consent.
      let importedId: string | undefined;
      if (path === "/manage/import/start") {
        if (request.method !== "POST") return redirect("/manage");
        const document = wireDocument(fields["document"]);
        importedId = String(document.leaf.id);
        await reserve(currentActor, importedId);
      }

      const managed = /^\/manage\/([a-z0-9-]+)(?:\/(preview|publish|withdraw))?$/.exec(importedId ? `/manage/${importedId}/preview` : path);
      if (managed && PUBLISHED_ID.test(managed[1]!)) {
        const id = managed[1]!, action = managed[2], current = await owner(currentActor, id);
        if (request.method !== "POST") {
          if (action) return respond(405, "Use the publication review form.", "text/plain; charset=utf-8");
          if (api) {
            const published = current.visible ? await config.store.readPublic(id) : null;
            if (current.visible && (!published || published.revisionId !== current.revisionId || published.generation !== current.generation)) throw new HostedStoreError("conflict", "Public version changed. Refresh.");
            return respond(200, JSON.stringify({ current, document: published ? toArtifactJson(published.document) : null, artifactDigest: published?.artifactDigest ?? null }), "application/json");
          }
          return respond(200, shell(current.visible ? "Portfolio live" : "Your portfolio", `<p class="onboarding-lede">${current.visible ? `${link(`/leaf/${id}`, "View")} · ${link(`/manage/${id}/share`, "Share")}` : "Not published"}</p>
${connectPhotosynthesis()}${config.nango ? `<p>${link("/manage/sources/connect", "Connect sources")}</p>` : ""}<details class="onboarding-details"><summary>Import a file</summary>${importPortfolio(current.visible ? `/manage/${id}/preview` : "/manage/import/start", csrf)}</details>
<details class="onboarding-details"><summary>Settings</summary><p>Address: <code>/leaf/${esc(id)}</code></p>${current.visible ? form(`/manage/${id}/withdraw`, csrf, hidden("operationId", randomUUID()) + hidden("expectedRevisionId", current.revisionId ?? "") + hidden("expectedGeneration", String(current.generation)) + '<p>Downloaded copies can’t be recalled.</p>' + ui.button("Take offline", { type: "submit" })) : '<p>Not published</p>'}</details>`, csrf, true));
        }
        if (action === "withdraw") {
          const result = await config.store.withdraw(currentActor, { operationId: fields["operationId"] ?? "", subjectId: id,
            expectedRevisionId: fields["expectedRevisionId"] || null, expectedGeneration: Number(fields["expectedGeneration"]) });
          if (api) return respond(200, JSON.stringify(result), "application/json");
          return redirect(`/operations/${result.receipt.operationId}`);
        }
        if (action !== "preview" && action !== "publish") return error("Choose an action from the publication workspace.");
        const document = wireDocument(fields["document"]);
        if (String(document.leaf.id) !== id) throw new HostedStoreError("forbidden", "Choose the publication file for this address.");
        const photos = fields["photos"] ?? "[]", videos = fields["videos"] ?? "[]";
        decodePhotoTransfer(document, photos);
        decodeVideoTransfer(document, videos);
        const transferIssue = combinedMediaTransferIssue(document, photos, videos);
        if (transferIssue) throw new PublicationVideoError(transferIssue);
        if (!api && document.leaf.leaflets.some(l => l.photos?.length || l.videos?.length)) return error("Review and publish selected media through the local companion, where exact bytes can be previewed before sending. This JSON-only form cannot preview media bytes.");
        const bytes = publicationBytes(document), artifactDigest = documentDigest(bytes);
        const consent: PublicationConsent = action === "preview" ? { intent: "publish", operationId: api ? fields["operationId"] ?? "" : randomUUID(), subjectId: id,
          artifactDigest, policyDigest: document.source.policyDigest ?? "", expectedRevisionId: current.revisionId, expectedGeneration: current.generation } :
          reviewedConsent(fields["consent"]);
        if (action === "publish" && fields["reviewActorId"] !== currentActor.id) throw new HostedStoreError("forbidden", "Review is from another account. Review again.");
        let verification: unknown;
        const evidence = fields["evidence"] ?? "";
        if (Buffer.byteLength(evidence) > 16 * 1024) return error("Public proof coordinates exceed the supported size.");
        if (document.leaf.leaflets.some(item => item.tier === "verified")) {
          if (config.verifyPublication) {
            let coordinates: unknown; try { coordinates = JSON.parse(evidence); } catch { return error("Select readable public GitHub proof coordinates for the verified entries."); }
            verification = await config.verifyPublication({ actor: currentActor, accessToken: hostedAccessToken(request.headers).token, document: toArtifactJson(document), evidence: coordinates });
          }
        } else if (evidence.trim()) return error("No verified entries. Remove the proof file.");
        const admitted = admitPublication({ actor: currentActor, owner: current, document: toArtifactJson(document), consent, ...(verification === undefined ? {} : { verification }) });
        if (action === "publish") {
          const result = await config.store.publish(currentActor, { operationId: consent.operationId, subjectId: id, expectedRevisionId: consent.expectedRevisionId,
            expectedGeneration: consent.expectedGeneration, document: toArtifactJson(admitted.document), photos, videos, admission: admitted.admission });
          if (api) return respond(200, JSON.stringify(result), "application/json");
          return redirect(`/operations/${result.receipt.operationId}`);
        }
        if (api) return respond(200, JSON.stringify({ document: toArtifactJson(admitted.document), consent, actorId: currentActor.id, current }), "application/json");
        const preview = await publicationView(document, artifactDigest, undefined, {
          kind: "hosted", csrf, subjectId: id, replacing: current.visible,
          document: bytes.toString("utf8"), evidence, consent: JSON.stringify(consent), reviewActorId: currentActor.id,
        });
        return respond(200, preview, "text/html; charset=utf-8", publicHeaders({ form: true, portfolio: hasPortfolioEnhancement(preview) }));
      }
      return respond(404, shell("Not found", link(recruiting ? "/recruiting" : "/manage", "Back"), csrf, true, recruiting));
    } catch (cause) {
      const known = cause instanceof HostedNangoError || cause instanceof HostedIdentityError || cause instanceof HostedAdmissionError || cause instanceof HostedStoreError || cause instanceof HostedGitHubProofError || cause instanceof PublicationPhotoError || cause instanceof PublicationVideoError;
      const code = known ? cause.code : "unavailable";
      const status = code === "unauthenticated" ? 401 : code === "forbidden" || code === "address-limit" ? 403 : code === "conflict" || code === "consent-mismatch" ? 409 : ["unavailable", "corrupt", "outcome_unknown", "provider-unavailable"].includes(code) ? 503 : 400;
      // A 5xx is the service failing rather than an answer: one operator line, and a reference
      // the person can quote. The page and its retained review are otherwise unchanged.
      const reference = status >= 500 ? logRequestFailure({ layer: "router", method: request.method, target: url.pathname, status, error: cause }) : "";
      const traced: Record<string, string> = reference ? { "x-request-id": reference } : {};
      if (api) return respond(status, JSON.stringify({ code, error: known ? cause.message : "Outcome unknown. Check the operation." }), "application/json", traced);
      const resume = path === "/recruiting" ? path + url.search : path === "/manage/device/connect" ? path + url.search : path === "/manage/import/start" ? "/manage" : safeHostedReturnTo(path.replace(/\/(?:publish|preview|withdraw)$/, ""));
      if (status === 401 && request.method !== "POST") return redirect(`/auth/sign-in?returnTo=${encodeURIComponent(resume)}`);
      const message = known ? cause.message : "Request failed. Check the operation before retrying.";
      let operation = fields["operationId"] ?? /^\/(?:distribution|recruiting\/deliveries)\/([0-9a-f-]{36})/.exec(path)?.[1];
      try { operation ??= (JSON.parse(fields["consent"] ?? "{}") as Record<string, unknown>)["operationId"] as string; } catch { /* malformed consent carries no usable operation */ }
      const recovery = operation && /^[a-zA-Z0-9_-]{1,128}$/.test(operation) ? `<p>${link(recruiting ? `/recruiting/deliveries/${operation}` : `/operations/${operation}`, "Check operation")}</p>` : "";
      const retainedPath = AUTH_PATHS.has(path) ? safeHostedReturnTo(fields["returnTo"]) : path;
      const retained = carriedReview(retainedPath, fields), resumeFields = hidden("returnTo", retainedPath) + retained;
      return respond(status, shell(status === 401 ? "Sign in" : code === "outcome_unknown" ? "Outcome unknown" : "Not completed",
        `<p role="alert">${esc(message)}</p>${reference ? `<p>Reference <code>${reference}</code></p>` : ""}${status === 401 && config.clerk ? `<p><a class="link" href="/auth/sign-in" target="_blank" rel="noopener">Sign in</a></p>` : status === 401 ? `${form("/auth/sign-in", csrf, resumeFields + field("email", "Email", "email", "email") + field("password", "Password", "password", "current-password") + button("Sign in"))}${form("/auth/refresh", csrf, resumeFields + button("Refresh session"))}<p><a class="link" href="/auth/recovery" target="_blank" rel="noopener">Reset password</a></p>` : ""}${recovery}${preservedForm(retainedPath, fields, csrf)}<p>${link(resume, "Back")}</p>`, csrf, false, recruiting), "text/html; charset=utf-8", traced);
    }
  };
}
