/** Synthetic HTTP contract inputs only; no customer, source proof or actual provider acceptance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { PUBLISHED_ARTIFACT, documentDigest, parsePublishedDocument } from "@foliage/canopy";
import { createHostedApp } from "./hostedApp.ts";
import { HOSTED_COOKIES, HostedIdentityError, type HostedActor, type HostedSession } from "./hostedIdentity.ts";
import { publicationBytes } from "./hostedAdmission.ts";
import { HostedStoreError, MAX_ADDRESSES_PER_ACCOUNT, addressLimitError, type HostedStore, type OwnedPublication, type PublicationOperation, type PublicationResult } from "./hostedStore.ts";
import { createNodeHandler, loadAsset } from "../hosted-server.mjs";
import { createHostedGitHubProof } from "./hostedGitHubProof.ts";
import { mkdtemp, readFile, rm, writeFile, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalHostedBridge } from "./localHostedBridge.ts";
import { loadManageState } from "./manageState.ts";
import { decodePhotoTransfer, photoReferences } from "./publicationPhotos.ts";
import { decodeVideoTransfer } from "./publicationVideos.ts";
import { putImage, mediaRootFromEnv } from "@foliage/leaf-app/mediaStore";
import { putCapturedVideo, videoRootFromEnv } from "@foliage/leaf-app/videoStore";
import { renderHostedBridge } from "./renderHostedBridge.ts";
import { esc } from "./renderPublished.ts";
import { searchPublished } from "./searchPublished.ts";

const ORIGIN = "https://http-harness.invalid";
const ACTOR = { id: "00000000-0000-4000-8000-000000000001" };
const FOREIGN = { id: "00000000-0000-4000-8000-000000000002" };
const SUBJECT = "http-harness";
const SESSION: HostedSession = { actor: ACTOR, accessToken: "test-access", refreshToken: "test-refresh", expiresIn: 3600 };
function artifact(title = "Synthetic HTTP contract input") {
  return { artifact: PUBLISHED_ARTIFACT, artifactVersion: 3, publishedAt: "2026-09-08T00:00:00Z",
    source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1, policyDigest: `sha256:${"b".repeat(64)}` },
    leaf: { id: SUBJECT, subject: "Synthetic HTTP subject", subjectRedacted: false,
      leaflets: [{ id: "test-input", title, tier: "pending", titleRedacted: false }] }, withheld: { count: 0, kinds: [] } };
}
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function savedFields(html: string): Record<string, string> {
  return Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(m => [m[1]!, decode(m[2]!)]));
}
function harness(options: { loadAsset?: Parameters<typeof createHostedApp>[0]["loadAsset"]; recruitingConnections?: Parameters<typeof createHostedApp>[0]["recruitingConnections"]; searchPublished?: Parameters<typeof createHostedApp>[0]["searchPublished"]; distribution?: Parameters<typeof createHostedApp>[0]["distribution"]; proofFetch?: typeof fetch; notifications?: Parameters<typeof createHostedApp>[0]["notifications"]; nango?: Parameters<typeof createHostedApp>[0]["nango"] } = {}) {
  const calls: string[] = [], cookies = new Map<string, string>();
  const owned = new Map<string, OwnedPublication>();
  const documents = new Map<string, unknown>();
  const receipts = new Map<string, { actorId: string; input: string; result: PublicationResult }>();
  let currentActor: HostedActor = ACTOR, signedIn = true, failRead = false, unknownCommit = false, failSignOut = false, failExchange = false, failPing = false, failInventory = "";
  const identity = {
    async getVerifiedUser() { return { ...currentActor, aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-09-08T00:00:00Z" }; },
    async getUser(token: string) { calls.push("getUser"); if (!signedIn || token !== SESSION.accessToken) throw new HostedIdentityError("unauthenticated", "Sign in again."); return currentActor; },
    async signIn() { calls.push("signIn"); signedIn = true; return { ...SESSION, actor: currentActor }; },
    async signUp(_email: string, _password: string, challenge: string) { calls.push(`signUp:${challenge}`); return null; },
    async refreshSession() { calls.push("refreshSession"); signedIn = true; return { ...SESSION, actor: currentActor }; },
    async exchangeCode(code: string, verifier: string) { calls.push(`exchange:${code}:${verifier}`); if (failExchange) throw new HostedIdentityError("unavailable", "Exchange outcome is unknown."); signedIn = true; return SESSION; },
    async requestRecovery(_email: string, challenge: string) { calls.push(`recover:${challenge}`); },
    async updatePassword() { calls.push("updatePassword"); },
    async signOut() { calls.push("signOut"); if (failSignOut) throw new HostedIdentityError("unavailable", "Logout service unavailable."); signedIn = false; },
  };
  const own = (actor: HostedActor, subject: string) => {
    const row = owned.get(subject);
    if (!row || row.actorId !== actor.id) throw new HostedStoreError("forbidden", "Unavailable to this account.");
    return row;
  };
  function commit(actor: HostedActor, operation: PublicationOperation, kind: "publish" | "withdraw", document?: unknown): PublicationResult {
    const current = own(actor, operation.subjectId), input = JSON.stringify({ operation, kind, document });
    const previous = receipts.get(operation.operationId);
    if (previous) {
      if (previous.actorId !== actor.id || previous.input !== input) throw new HostedStoreError("conflict", "Operation input conflict.");
      return { ...previous.result, replayed: true, current: { ...current } };
    }
    if (current.revisionId !== operation.expectedRevisionId || current.generation !== operation.expectedGeneration) throw new HostedStoreError("conflict", "The reviewed publication changed.");
    const next = { ...current, generation: current.generation + 1, revisionId: kind === "publish" ? randomUUID() : null, visible: kind === "publish" };
    owned.set(operation.subjectId, next);
    if (kind === "publish") documents.set(operation.subjectId, document); else documents.delete(operation.subjectId);
    const result: PublicationResult = { receipt: { operationId: operation.operationId, subjectId: operation.subjectId, kind, revisionId: next.revisionId, generation: next.generation, committedAt: "2026-09-08T00:00:00Z" }, replayed: false, current: next };
    receipts.set(operation.operationId, { actorId: actor.id, input, result });
    if (unknownCommit) { unknownCommit = false; throw new HostedStoreError("outcome_unknown", "The commit acknowledgement was lost."); }
    return result;
  }
  const photos = new Map<string, string>();
  const videos = new Map<string, string>();
  const store: HostedStore = {
    async reserveSubject(actor, subjectId) {
      calls.push("reserve");
      if (!/^[a-z0-9-]+$/.test(subjectId)) throw new HostedStoreError("invalid", "Choose a supported address.");
      if (!owned.has(subjectId)) owned.set(subjectId, { actorId: actor.id, subjectId, revisionId: null, generation: 0, visible: false });
      return own(actor, subjectId);
    },
    async ping() {
      calls.push("ping");
      if (failPing) throw new HostedStoreError("unavailable", "Storage service did not acknowledge the request.", { cause: Object.assign(new TypeError("fetch failed https://storage.invalid/rest?apikey=query-canary"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
    },
    async listOwned(actor, options = {}) { calls.push("listOwned"); if (failInventory) throw new TypeError(failInventory); return [...owned.values()].filter(r => r.actorId === actor.id && (!options.after || r.subjectId > options.after)).sort((a, b) => a.subjectId.localeCompare(b.subjectId)).slice(0, options.limit ?? 100); },
    async publish(actor, operation) {
      calls.push("publish");
      assert.ok(parsePublishedDocument(operation.document).ok, "HTTP must send raw v3 JSON, not parsed branded fields");
      const { document, admission, photos: transfer, videos: videoTransfer, ...version } = operation;
      photos.set(operation.subjectId, transfer ?? "[]");
      videos.set(operation.subjectId, videoTransfer ?? "[]");
      assert.equal(admission.actorId, actor.id); assert.equal(admission.operationId, operation.operationId);
      return commit(actor, version, "publish", document);
    },
    async withdraw(actor, operation) { calls.push("withdraw"); return commit(actor, operation, "withdraw"); },
    async operation(actor, id) { calls.push("operation"); const saved = receipts.get(id); if (!saved || saved.actorId !== actor.id) return null; return { ...saved.result, current: own(actor, saved.result.receipt.subjectId) }; },
    async readPhoto(id, artifactDigest, renditionDigest) {
      calls.push("readPhoto"); const publication = await this.readPublic(id);
      if (!publication || publication.artifactDigest !== artifactDigest) return null;
      const photo = decodePhotoTransfer(publication.document, photos.get(id)).find(p => p.digest === renditionDigest);
      const ref = photoReferences(publication.document).find(p => p.renditionDigest === renditionDigest);
      return photo && ref ? { bytes: photo.bytes, contentType: `image/${ref.format}` } : null;
    },
    async readVideo(id, artifactDigest, videoDigest) {
      calls.push("readVideo"); const publication = await this.readPublic(id);
      if (!publication || publication.artifactDigest !== artifactDigest) return null;
      const video = decodeVideoTransfer(publication.document, videos.get(id)).find(v => v.digest === videoDigest);
      return video ? { bytes: video.bytes, contentType: "video/mp4" } : null;
    },
    async readPublic(id) {
      calls.push("readPublic"); if (failRead) throw new HostedStoreError("unavailable", "Publication authority unavailable.");
      const value = documents.get(id), row = owned.get(id); if (!value || !row?.visible || !row.revisionId) return null;
      const parsed = parsePublishedDocument(value); assert.ok(parsed.ok);
      return { document: parsed.document, artifactDigest: documentDigest(publicationBytes(parsed.document)), revisionId: row.revisionId, generation: row.generation };
    },
  };
  const app = createHostedApp({ appOrigin: ORIGIN, identity, store, ...(options.recruitingConnections ? { recruitingConnections: options.recruitingConnections } : {}), ...(options.searchPublished ? { searchPublished: options.searchPublished } : {}), ...(options.distribution ? { distribution: options.distribution } : {}), ...(options.nango ? { nango: options.nango } : {}),
    ...(options.proofFetch ? { verifyPublication: createHostedGitHubProof({ getUser: identity.getVerifiedUser, fetch: options.proofFetch }) } : {}),
    ...(options.notifications ? { notifications: options.notifications } : {}),
    loadAsset: options.loadAsset ?? (async path => { calls.push(`asset:${path}`); if (path === "/mark-icon.svg") return { bytes: Buffer.from("<svg/>"), contentType: "image/svg+xml" }; if (path === "/specimen-sheet-day.jpg") return { bytes: await readFile(new URL("../public/specimen-sheet-day.jpg", import.meta.url)), contentType: "image/jpeg" }; return path === "/controls.css" ? { bytes: Buffer.from("/* synthetic asset transport input */"), contentType: "text/css" } : null; }) });
  cookies.set(HOSTED_COOKIES.access, SESSION.accessToken); cookies.set(HOSTED_COOKIES.refresh, SESSION.refreshToken);
  async function send(path: string, options: { method?: string; fields?: Record<string, string>; body?: RequestInit["body"]; headers?: Record<string, string>; anonymous?: boolean } = {}) {
    const method = options.method ?? (options.fields || options.body ? "POST" : "GET");
    const headers = new Headers({ ...(options.anonymous ? {} : { cookie: [...cookies].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("; ") }), ...options.headers });
    let body = options.body;
    if (options.fields) { body = new URLSearchParams({ csrf: cookies.get(HOSTED_COOKIES.csrf) ?? "", ...options.fields }); if (!headers.has("origin")) headers.set("origin", ORIGIN); }
    const response = await app(new Request(`${ORIGIN}${path}`, { method, headers, ...(body ? { body } : {}) }));
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(";"); const index = pair!.indexOf("="); const name = pair!.slice(0, index), value = decodeURIComponent(pair!.slice(index + 1)); if (/Max-Age=0(?:;|$)/.test(cookie)) cookies.delete(name); else cookies.set(name, value); }
    return response;
  }
  async function review(value: unknown = artifact(), evidence?: unknown) {
    await send("/manage"); await send("/manage", { fields: { subjectId: SUBJECT } });
    const response = await send(`/manage/${SUBJECT}/preview`, { fields: { document: JSON.stringify(value), ...(evidence === undefined ? {} : { evidence: JSON.stringify(evidence) }) } });
    const html = await response.text();
    if (response.status === 200) for (const use of html.matchAll(/<use\s[^>]*href="#([^"]+)"/g)) assert.ok(html.includes(`<symbol id="${use[1]}"`), `preview must carry ${use[1]}`);
    if (response.status === 200) {
      assert.match(html, /<b>Private preview<\/b>/);
      assert.doesNotMatch(html, /<b>Published leaf<\/b>|data-fact="publishedAt"|href="\/leaflet\//, "an unpublished preview must not imply a live reader address");
      for (const name of ["roles", "controls"]) assert.equal((html.match(new RegExp(`href="/${name}\\.css"`, "g")) ?? []).length, 1);
      assert.match(response.headers.get("content-security-policy") ?? "", /form-action 'self'/);
      assert.match(html, /class="pub-preview-consequence"/);
      const decision = html.indexOf(`action="/manage/${SUBJECT}/publish"`);
      const work = html.indexOf('data-record-id="');
      assert.ok(work >= 0 && decision > work, "selected work precedes the hosted decision");
      assert.ok(decision < html.indexOf('class="pub-publication-detail"'), "hosted Review details follow the decision");
      assert.ok(decision < html.indexOf("</main>"), "hosted decision belongs to the reading frame");
    }
    return { response, fields: savedFields(html), html };
  }
  return { store, app, send, review, calls, cookies, owned, receipts, setActor: (a: HostedActor) => { currentActor = a; }, expire: () => { signedIn = false; }, failRead: () => { failRead = true; }, unknownCommit: () => { unknownCommit = true; }, failSignOut: () => { failSignOut = true; }, failExchange: () => { failExchange = true; }, failPing: () => { failPing = true; }, failInventory: (message: string) => { failInventory = message; } };
}

test("personal HTTP journey reserves, previews exact bytes, publishes, replaces and withdraws", async () => {
  const h = harness();
  const { response, fields } = await h.review(artifact('<script>synthetic unsafe title</script>'));
  assert.equal(response.status, 200); assert.equal(h.calls.includes("publish"), false);
  assert.ok(fields["consent"]); assert.equal(JSON.parse(fields["document"]!).leaf.leaflets[0].title, "<script>synthetic unsafe title</script>");
  const publish = await h.send(`/manage/${SUBJECT}/publish`, { fields }); assert.equal(publish.status, 303);
  const receipt = await h.send(publish.headers.get("location")!, { headers: { accept: "application/json" } });
  assert.equal((await receipt.json() as PublicationResult).current.generation, 1);
  const publicPage = await h.send(`/leaf/${SUBJECT}`, { anonymous: true });
  assert.equal(publicPage.status, 200); const html = await publicPage.text(); assert.match(html, /&lt;script&gt;synthetic unsafe title/);
  const uses = [...html.matchAll(/<use\s[^>]*href="#([^"]+)"/g)]; assert.ok(uses.length > 0);
  for (const use of uses) assert.ok(html.includes(`<symbol id="${use[1]}"`), `public page must carry ${use[1]}`);
  assert.match(publicPage.headers.get("content-security-policy")!, /form-action 'none'/);
  const json = await h.send(`/leaf/${SUBJECT}/document.json`, { anonymous: true });
  assert.equal(await json.text(), fields["document"]);
  const head = await h.send(`/leaf/${SUBJECT}`, { method: "HEAD", anonymous: true }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  const replaced = await h.review(artifact("Synthetic changed title"));
  assert.equal(JSON.parse(replaced.fields["consent"]!).expectedGeneration, 1);
  assert.match(replaced.html, /Replaces the public version in full; anyone with the link can read these changes\./);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: replaced.fields })).status, 303);
  const workspace = await h.send(`/manage/${SUBJECT}`), withdraw = savedFields(await workspace.text());
  assert.equal((await h.send(`/manage/${SUBJECT}/withdraw`, { fields: withdraw })).status, 303);
  assert.equal(h.owned.get(SUBJECT)?.generation, 3);
  for (const suffix of ["", "/document.json"]) assert.equal((await h.send(`/leaf/${SUBJECT}${suffix}`, { anonymous: true })).status, 404);
});

test("the hosted preview preserves exact consent fields and keeps the raw document inspectable", async () => {
  const h = harness();
  await h.send("/manage"); await h.send("/manage", { fields: { subjectId: SUBJECT } });
  const page = await (await h.send(`/manage/${SUBJECT}/preview`, { fields: { document: JSON.stringify(artifact("<b>synthetic & escaped</b>")) } })).text();
  const fields = savedFields(page);
  assert.deepEqual(Object.keys(fields).sort(), ["consent", "csrf", "document", "evidence", "reviewActorId"].sort());
  const shown = `<pre class="fol-metric">${esc(fields["document"]!)}</pre>`;
  assert.ok(page.includes(shown), "Review details must expose the exact document bytes being published");
  assert.ok(page.indexOf(`action="/manage/${SUBJECT}/publish"`) < page.indexOf('class="pub-publication-detail"'));
  assert.ok(page.indexOf('class="pub-publication-detail"') < page.indexOf(shown));
  assert.match(page, /Anyone with the link can read this once published\./);
});

test("every public read and HEAD rechecks authority; outages cannot use previous bytes or validators", async () => {
  const h = harness(), { fields } = await h.review(); await h.send(`/manage/${SUBJECT}/publish`, { fields });
  for (const method of ["GET", "HEAD"]) {
    const response = await h.send(`/leaf/${SUBJECT}`, { method, anonymous: true, headers: { "if-none-match": "anything" } });
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("etag"), null); assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  }
  h.failRead(); const failed = await h.send(`/leaf/${SUBJECT}`, { anonymous: true });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Synthetic HTTP subject/);
  assert.equal(h.calls.filter(c => c === "readPublic").length, 5);
});

test("hosted portfolio refuses stale HTML when withdrawal follows its first authority read", async () => {
  const h = harness(), { fields } = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const originalRead = h.store.readPublic.bind(h.store);
  let reads = 0;
  h.store.readPublic = async id => {
    const current = await originalRead(id);
    if (++reads === 1) {
      const row = h.owned.get(SUBJECT)!;
      h.owned.set(SUBJECT, { ...row, revisionId: null, generation: row.generation + 1, visible: false });
    }
    return current;
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await h.send(`/leaf/${SUBJECT}`, { method, anonymous: true });
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Synthetic HTTP contract input/);
  }
  assert.equal(reads, 3);
});

test("hosted leaflet links read one admitted item from the current publication", async () => {
  const h = harness();
  const base = artifact("Unused synthetic title");
  const input = { ...base, leaf: { ...base.leaf, leaflets: [
    { id: "git:public", title: "<script>Admitted synthetic work</script>", tier: "pending", titleRedacted: false },
    { id: "git:second", title: "Another admitted synthetic item", tier: "pending", titleRedacted: false },
  ] }, withheld: { count: 1, kinds: [{ kind: "unattributed-leaflet", count: 1 }] } };
  const { fields } = await h.review(input);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const portfolio = await (await h.send(`/leaf/${SUBJECT}`, { anonymous: true })).text();
  const href = `/leaflet/git%3Apublic?publication=${SUBJECT}`;
  assert.ok(portfolio.includes(`href="${href}"`));
  const before = h.calls.length;
  const response = await h.send(href, { anonymous: true });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 class="pub-title" data-verbatim="title">&lt;script&gt;Admitted synthetic work&lt;\/script&gt;<\/h1>/);
  assert.doesNotMatch(html, /Another admitted synthetic item|unattributed-leaflet|git:second|<script>Admitted/);
  assert.match(html, new RegExp(`href="/leaf/${SUBJECT}"`));
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy")!, /form-action 'none'/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.deepEqual(h.calls.slice(before), ["readPublic", "readPublic"]);
  const head = await h.send(href, { method: "HEAD", anonymous: true });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.match(head.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(h.calls.slice(before), ["readPublic", "readPublic", "readPublic"]);
  const write = await h.send(href, { method: "POST", anonymous: true });
  assert.equal(write.status, 405); assert.equal(write.headers.get("allow"), "GET, HEAD");
  h.failRead();
  const unavailable = await h.send(href, { anonymous: true });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /Admitted synthetic work/);
});

test("hosted leaflet detail refuses malformed, cross-publication, replaced and withdrawn links", async () => {
  const h = harness(), first = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: first.fields })).status, 303);
  const otherId = "other-publication";
  assert.equal((await h.send("/manage", { fields: { subjectId: otherId } })).status, 303);
  const other = artifact("Another publication");
  other.leaf.id = otherId;
  other.leaf.leaflets[0]!.id = "other-only";
  const otherPreview = await h.send(`/manage/${otherId}/preview`, { fields: { document: JSON.stringify(other) } });
  assert.equal(otherPreview.status, 200);
  assert.equal((await h.send(`/manage/${otherId}/publish`, { fields: savedFields(await otherPreview.text()) })).status, 303);
  const href = `/leaflet/test-input?publication=${SUBJECT}`;
  const before = h.calls.length;
  for (const bad of [
    "/leaflet/test-input", "/leaflet/test-input?publication=HTTP-harness",
    `/leaflet/test-input?publication=${SUBJECT}&publication=${otherId}`,
    `/leaflet/test-input?publication=${SUBJECT}&extra=1`,
    `/leaflet/%ZZ?publication=${SUBJECT}`, `/leaflet/test-input/extra?publication=${SUBJECT}`,
  ]) {
    const refused = await h.send(bad, { anonymous: true });
    assert.equal(refused.status, 404, bad);
    assert.doesNotMatch(await refused.text(), /Synthetic HTTP subject|Synthetic HTTP contract input/);
  }
  assert.equal(h.calls.length, before, "malformed links must not read publication storage or account identity");
  const cross = await h.send(`/leaflet/test-input?publication=${otherId}`, { anonymous: true });
  assert.equal(cross.status, 404);
  assert.doesNotMatch(await cross.text(), /Another publication/);
  const replaced = await h.review({ ...artifact("Replacement synthetic item"), leaf: { ...artifact().leaf,
    leaflets: [{ id: "replacement", title: "Replacement synthetic item", tier: "pending", titleRedacted: false }] } });
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: replaced.fields })).status, 303);
  assert.equal((await h.send(href, { anonymous: true })).status, 404);
  assert.equal((await h.send(`/leaflet/replacement?publication=${SUBJECT}`, { anonymous: true })).status, 200);
  const workspace = await h.send(`/manage/${SUBJECT}`), withdraw = savedFields(await workspace.text());
  assert.equal((await h.send(`/manage/${SUBJECT}/withdraw`, { fields: withdraw })).status, 303);
  for (const method of ["GET", "HEAD"]) {
    const refused = await h.send(`/leaflet/replacement?publication=${SUBJECT}`, { method, anonymous: true });
    assert.equal(refused.status, 404); assert.match(refused.headers.get("cache-control")!, /no-store/);
    const body = await refused.text();
    if (method === "HEAD") assert.equal(body, "");
    else assert.doesNotMatch(body, /Replacement synthetic item|Synthetic HTTP subject/);
  }
});

test("hosted leaflet detail refuses bytes when withdrawal follows its first authority read", async () => {
  const h = harness(), { fields } = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const originalRead = h.store.readPublic.bind(h.store);
  let reads = 0;
  h.store.readPublic = async id => {
    const current = await originalRead(id);
    if (++reads === 1) {
      const row = h.owned.get(SUBJECT)!;
      h.owned.set(SUBJECT, { ...row, revisionId: null, generation: row.generation + 1, visible: false });
    }
    return current;
  };
  const response = await h.send(`/leaflet/test-input?publication=${SUBJECT}`, { anonymous: true });
  assert.equal(response.status, 404);
  assert.equal(reads, 2);
  assert.doesNotMatch(await response.text(), /Synthetic HTTP contract input/);
});

test("GET routes cannot reserve, publish, withdraw, exchange a callback or sign out", async () => {
  const h = harness(); await h.review(); const before = h.calls.filter(c => ["reserve", "publish", "withdraw", "signOut"].includes(c)).length;
  for (const path of [`/manage/${SUBJECT}/preview`, `/manage/${SUBJECT}/publish`, `/manage/${SUBJECT}/withdraw`, "/auth/sign-out", "/auth/refresh"]) assert.equal((await h.send(path)).status, 405);
  assert.equal(h.calls.filter(c => ["reserve", "publish", "withdraw", "signOut"].includes(c)).length, before);
  assert.equal((await h.send("/manage", { method: "DELETE" })).status, 405);
});

test("cookie mutation requires exact origin and CSRF; duplicate fields and ambiguous authority fail closed", async () => {
  const h = harness(); await h.send("/manage");
  for (const options of [
    { fields: { subjectId: SUBJECT, csrf: "bad" } },
    { fields: { subjectId: SUBJECT }, headers: { origin: "https://foreign.invalid" } },
    { fields: { subjectId: SUBJECT }, headers: { authorization: "Bearer test-access" } },
    { body: new URLSearchParams([ ["csrf", h.cookies.get(HOSTED_COOKIES.csrf)!], ["subjectId", SUBJECT], ["subjectId", "other"] ]), headers: { origin: ORIGIN } },
    { fields: { subjectId: SUBJECT, tenant: FOREIGN.id } },
  ]) assert.equal((await h.send("/manage", options)).status, 400);
  assert.equal(h.calls.includes("reserve"), false);
  const poisoned = await h.send("/manage", { headers: { host: "foreign.invalid", "x-forwarded-host": new URL(ORIGIN).host } }); assert.equal(poisoned.status, 421);
});

test("server actor and exact consent block cross-account or changed-content publication", async () => {
  const h = harness(), { fields } = await h.review();
  const changed = { ...fields, document: JSON.stringify(artifact("Substituted synthetic title")) };
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: changed })).status, 409);
  h.setActor(FOREIGN);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 403);
  assert.equal((await h.send(`/manage/${SUBJECT}`)).status, 403);
  h.setActor(ACTOR);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: { ...fields, reviewActorId: FOREIGN.id } })).status, 403);
  assert.equal(h.calls.includes("publish"), false);
});

test("reader preview retains literal replacement markers in the exact consent payload", async () => {
  const h = harness(), title = "Synthetic $& $` $' $$ replacement markers";
  const { response, fields } = await h.review(artifact(title)); assert.equal(response.status, 200);
  assert.equal(JSON.parse(fields["document"]!).leaf.leaflets[0].title, title);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
});

test("expired session preserves exact review through same-page sign-in without automatic publication", async () => {
  const h = harness(), { fields } = await h.review(); h.expire();
  const expired = await h.send(`/manage/${SUBJECT}/publish`, { fields }); assert.equal(expired.status, 401);
  const page = await expired.text(); assert.match(page, /<form method="post" action="\/auth\/sign-in">/); assert.doesNotMatch(page, /<script/);
  const carried = savedFields(page); assert.equal(carried["document"], fields["document"]); assert.equal(carried["consent"], fields["consent"]);
  const signedIn = await h.send("/auth/sign-in", { fields: { ...carried, email: "synthetic@example.invalid", password: "test-only-password" } });
  assert.equal(signedIn.status, 200); assert.equal(h.calls.includes("publish"), false);
  const retained = await signedIn.text(); assert.doesNotMatch(retained, /test-only-password/); const resumed = savedFields(retained);
  assert.equal(resumed["consent"], fields["consent"]); assert.equal(resumed["document"], fields["document"]);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: resumed })).status, 303);
});

test("refresh preserves the retained decision and changed account cannot reuse its consent", async () => {
  const h = harness(), { fields } = await h.review(); h.expire();
  const expired = savedFields(await (await h.send(`/manage/${SUBJECT}/publish`, { fields })).text());
  const refresh = await h.send("/auth/refresh", { fields: expired });
  const retained = savedFields(await refresh.text()); assert.equal(retained["consent"], fields["consent"]);
  h.setActor(FOREIGN);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: retained })).status, 403);
  assert.equal(h.calls.includes("publish"), false);
});

test("uncertain acknowledgement retains operation, and retry returns receipt without a second commit", async () => {
  const h = harness(), { fields } = await h.review(); h.unknownCommit();
  const lost = await h.send(`/manage/${SUBJECT}/publish`, { fields }); assert.equal(lost.status, 503);
  const page = await lost.text(), retry = savedFields(page), operation = JSON.parse(fields["consent"]!).operationId;
  assert.match(page, new RegExp(`/operations/${operation}`)); assert.equal(retry["consent"], fields["consent"]);
  assert.equal((await h.send(`/operations/${operation}`)).status, 200);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: retry })).status, 303);
  assert.equal(h.owned.get(SUBJECT)?.generation, 1); assert.equal(h.receipts.size, 1);
  assert.equal((await h.send(`/operations/${randomUUID()}`)).status, 404);
  h.setActor(FOREIGN); assert.equal((await h.send(`/operations/${operation}`)).status, 404);
});

test("a stale reviewed head is a conflict with its original decision retained", async () => {
  const h = harness(), first = await h.review(), stale = await h.review(artifact("Synthetic parallel draft"));
  await h.send(`/manage/${SUBJECT}/publish`, { fields: first.fields });
  const conflict = await h.send(`/manage/${SUBJECT}/publish`, { fields: stale.fields });
  assert.equal(conflict.status, 409); assert.equal(savedFields(await conflict.text())["consent"], stale.fields["consent"]);
  assert.equal(h.owned.get(SUBJECT)?.generation, 1);
});

test("verified client assertions and non-publication uploads never reach hosted commit", async () => {
  const h = harness(), input = artifact();
  const verified = { ...input, leaf: { ...input.leaf, leaflets: [{ ...input.leaf.leaflets[0], tier: "verified", provenance: { source: "git", ref: "test-only-ref", observedAt: "2026-09-08T00:00:00Z" } }] } };
  const review = await h.review(verified); assert.equal(review.response.status, 400); assert.equal(h.calls.includes("publish"), false);
  for (const value of [{ privateEvidence: "synthetic-secret-input" }, { ...input, artifactVersion: 99 }]) assert.equal((await h.review(value)).response.status, 400);
});

test("supported verified entries pass server proof checks again on explicit publish and retain coordinates through sign-in", async () => {
  const sha = "a".repeat(40), sourceCalls: string[] = [];
  const input = artifact(), verified = { ...input, leaf: { ...input.leaf, leaflets: [{ ...input.leaf.leaflets[0], tier: "verified", provenance: { source: "git", ref: sha, observedAt: "2026-09-08T00:00:00Z" } }] } };
  const evidence = [{ leafletId: "test-input", owner: "synthetic-owner", repo: "synthetic-repo", ref: sha }];
  const h = harness({ proofFetch: async (url, init) => {
    sourceCalls.push(String(url)); assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json({ sha, message: input.leaf.leaflets[0]!.title, author: { email: "synthetic@example.invalid" }, committer: { email: "synthetic@example.invalid" },
      verification: { verified: true, reason: "valid", verified_at: "2026-09-08T00:00:00Z", signature: "-----BEGIN PGP SIGNATURE-----\nsynthetic-provider-contract-input\n-----END PGP SIGNATURE-----" } });
  } });
  const review = await h.review(verified, evidence); assert.equal(review.response.status, 200); assert.equal(sourceCalls.length, 1);
  h.expire(); const expired = savedFields(await (await h.send(`/manage/${SUBJECT}/publish`, { fields: review.fields })).text());
  assert.equal(expired["evidence"], JSON.stringify(evidence));
  const signedIn = await h.send("/auth/sign-in", { fields: { ...expired, email: "synthetic@example.invalid", password: "test-password" } });
  const resumed = savedFields(await signedIn.text()); assert.equal(resumed["evidence"], JSON.stringify(evidence));
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: resumed })).status, 303); assert.equal(sourceCalls.length, 2);
  const current = await h.send(`/leaf/${SUBJECT}/document.json`, { anonymous: true });
  const wire = await current.json() as typeof verified; assert.equal(wire.leaf.leaflets[0]!.tier, "verified");
  assert.equal(Object.hasOwn(wire, "evidence"), false, "transport coordinates are not silently added to public bytes");
});

test("proof failures preserve exact input without downgrading or trusting submitted verification capabilities", async () => {
  const input = artifact(), sha = "b".repeat(40);
  const verified = { ...input, leaf: { ...input.leaf, leaflets: [{ ...input.leaf.leaflets[0], tier: "verified", provenance: { source: "git", ref: sha, observedAt: "2026-09-08T00:00:00Z" } }] } };
  const evidence = [{ leafletId: "test-input", owner: "synthetic-owner", repo: "synthetic-repo", ref: sha }];
  const h = harness({ proofFetch: async () => new Response("unavailable", { status: 503 }) });
  const review = await h.review(verified, evidence); assert.equal(review.response.status, 503);
  assert.equal(review.fields["document"], JSON.stringify(verified)); assert.equal(review.fields["evidence"], JSON.stringify(evidence));
  assert.equal((await h.send(`/manage/${SUBJECT}/preview`, { fields: { document: JSON.stringify(verified), verification: JSON.stringify({ actorId: ACTOR.id, verificationId: "client-asserted" }) } })).status, 400);
  assert.equal((await h.review(input, evidence)).response.status, 400);
  assert.equal(h.calls.includes("publish"), false);
});

test("notification preferences require current personal authority and explicit CSRF-protected save", async () => {
  const actions: string[] = []; let preferences = { inbox: false, email: false, sms: false, weeklySummary: true, dailyDigest: false };
  const h = harness({ notifications: {
    async preferences(actor) { actions.push(`read:${actor.id}`); return preferences; },
    async setPreferences(actor, next) { actions.push(`save:${actor.id}`); preferences = next; return preferences; },
    async handleRequest() { throw new Error("The owner settings must not run a worker."); },
  } });
  const page = await h.send("/settings/notifications"); assert.equal(page.status, 200);
  const html = await page.text(), fields = savedFields(html);
  assert.match(html, /id="weeklySummary"[^>]*checked/);
  assert.doesNotMatch(html, /id="dailyDigest"[^>]*checked/);
  assert.match(html, /Summary email delivery is not available yet/);
  assert.equal((await h.send("/settings/notifications", { fields: { ...fields, email: "on", sms: "on", weeklySummary: "on", dailyDigest: "on" } })).status, 303);
  assert.deepEqual(preferences, { inbox: false, email: true, sms: true, weeklySummary: true, dailyDigest: true });
  assert.equal((await h.send("/settings/notifications", { fields: { ...fields, inbox: "yes" } })).status, 400);
  assert.equal((await h.send("/settings/notifications", { fields: { ...fields, email: "on", csrf: "wrong" } })).status, 400);
  assert.equal((await h.send("/settings/notifications", { fields: { ...fields, dailyDigest: "daily" } })).status, 400);
  assert.equal((await h.send("/settings/notifications", { fields: { csrf: fields["csrf"]!, reviewActorId: ACTOR.id } })).status, 400);
  h.setActor(FOREIGN); assert.equal((await h.send("/settings/notifications", { fields })).status, 403);
  assert.equal(actions.filter(action => action.startsWith("save:")).length, 1);
});

test("notification worker keeps its server credential boundary and unavailable notifications do not prevent publication", async () => {
  const unaffiliated = harness(); assert.equal((await unaffiliated.send("/settings/notifications")).status, 503);
  const { fields } = await unaffiliated.review(); assert.equal((await unaffiliated.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const h = harness({ notifications: {
    async preferences() { return { inbox: false, email: false, sms: false, weeklySummary: true, dailyDigest: false }; },
    async setPreferences(_actor, next) { return next; },
    async handleRequest(request) {
      if (request.headers.get("authorization") !== "Bearer test-only-server-credential") return new Response("Unauthorized", { status: 401 });
      return new Response("worker contract input", { status: request.method === "POST" ? 200 : 404, headers: { "cache-control": "no-store" } });
    },
  } });
  assert.equal((await h.send("/internal/notifications/run", { method: "POST" })).status, 401);
  const response = await h.send("/internal/notifications/run", { method: "POST", anonymous: true, headers: { authorization: "Bearer test-only-server-credential" } });
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/); assert.equal(h.calls.includes("getUser"), false);
  assert.equal((await h.send("/internal/notifications/run", { method: "POST", anonymous: true, headers: { authorization: "Bearer test-only-server-credential", origin: "https://foreign.invalid" } })).status, 403);
});

test("PKCE email callback GET is scanner-safe; POST is CSRF-bound and consumes the browser flow", async () => {
  const h = harness(); await h.send("/auth/sign-up");
  const signup = await h.send("/auth/sign-up", { fields: { email: "synthetic@example.invalid", password: "test-only-password", returnTo: "https://foreign.invalid" } });
  assert.equal(signup.status, 200); assert.ok(h.cookies.has(HOSTED_COOKIES.flow));
  assert.match(h.calls.find(c => c.startsWith("signUp:"))!, /^signUp:[A-Za-z0-9_-]{43}$/);
  const scanner = await h.send("/auth/callback?code=test-code"); assert.equal(scanner.status, 200); assert.equal(h.calls.some(c => c.startsWith("exchange:")), false);
  const confirmed = await h.send("/auth/callback", { fields: savedFields(await scanner.text()) });
  assert.equal(confirmed.status, 303); assert.equal(confirmed.headers.get("location"), "/manage");
  assert.equal(h.cookies.has(HOSTED_COOKIES.flow), false);
  for (const cookie of confirmed.headers.getSetCookie()) assert.match(cookie, /Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await h.send("/auth/callback", { fields: { code: "test-code" } })).status, 400);
  assert.equal(h.calls.filter(c => c.startsWith("exchange:")).length, 1);
});

test("lost code-exchange acknowledgement clears flow; recovery never publishes and reports partial password success accurately", async () => {
  const h = harness(); await h.send("/auth/recovery");
  await h.send("/auth/recovery", { fields: { email: "synthetic@example.invalid" } }); h.failExchange();
  assert.equal((await h.send("/auth/callback", { fields: { code: "test-recovery-code" } })).status, 503);
  assert.equal(h.cookies.has(HOSTED_COOKIES.flow), false);
  h.failSignOut(); const changed = await h.send("/auth/password", { fields: { password: "test-only-new-password" } });
  assert.equal(changed.status, 503); assert.match(await changed.text(), /Your password was updated/);
  assert.equal(h.cookies.has(HOSTED_COOKIES.access), false); assert.equal(h.cookies.has(HOSTED_COOKIES.refresh), false);
  assert.equal(h.calls.filter(c => c === "updatePassword").length, 1); assert.equal(h.calls.includes("publish"), false);
});

test("request bounds, asset allowlist and unauthenticated routes expose no private fallback", async () => {
  const h = harness();
  const login = await h.send(`/manage/${SUBJECT}`, { anonymous: true }); assert.equal(login.status, 303); assert.match(login.headers.get("location")!, /^\/auth\/sign-in\?/);
  assert.equal((await h.send("/manage", { fields: { subjectId: SUBJECT }, headers: { "content-length": String(5 * 1024 * 1024) } })).status, 400);
  assert.equal((await h.send("/manage", { fields: { subjectId: SUBJECT }, headers: { "content-encoding": "gzip" } })).status, 400);
  const asset = await h.send("/controls.css", { anonymous: true }); assert.equal(asset.status, 200);
  assert.equal((await h.send("/private-leaf.json", { anonymous: true })).status, 404);
  assert.deepEqual(h.calls.filter(c => c.startsWith("asset:")), ["asset:/controls.css"]);
  const upload = new FormData(); upload.set("csrf", h.cookies.get(HOSTED_COOKIES.csrf)!); upload.set("document", new File(["x".repeat(1024 * 1024 + 1)], "synthetic-oversize.json"));
  assert.equal((await h.send(`/manage/${SUBJECT}/preview`, { body: upload, headers: { origin: ORIGIN } })).status, 400);
});

test("bearer transport still verifies current account and rejects cross-origin or unreviewed writes", async () => {
  const h = harness();
  const response = await h.send("/manage", { anonymous: true, fields: { subjectId: SUBJECT }, headers: { authorization: "Bearer test-access" } });
  assert.equal(response.status, 303); assert.ok(h.calls.includes("getUser"));
  const changed = await h.send("/manage", { anonymous: true, fields: { subjectId: "other" }, headers: { authorization: "Bearer test-access", origin: "https://foreign.invalid" } }); assert.equal(changed.status, 400);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { anonymous: true, fields: { document: JSON.stringify(artifact()) }, headers: { authorization: "Bearer test-access" } })).status, 403);
  h.expire(); assert.equal((await h.send("/manage", { anonymous: true, headers: { authorization: "Bearer test-access" } })).status, 303);
  assert.equal(h.calls.includes("publish"), false);
});

test("streamed upload limit is enforced without trusting content-length", async () => {
  const h = harness(); await h.send("/manage");
  const response = await h.send("/manage", { body: new URLSearchParams({ subjectId: "x".repeat(4 * 1024 * 1024 + 1) }), headers: { origin: ORIGIN } });
  assert.equal(response.status, 400); assert.equal(h.calls.includes("reserve"), false);
});

function probeHostedStartup(env: Record<string, string> = {}, path = "/leaf/http-harness") {
  const entry = new URL("../hosted-server.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { createServer, get } from 'node:http';
    import { once } from 'node:events';
    const {default: handler} = await import(${JSON.stringify(entry)});
    const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const result = await new Promise((resolve, reject) => {
        get({host:'127.0.0.1',port:server.address().port,path:${JSON.stringify(path)}}, res => { let body=''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({status:res.statusCode,body,cache:res.headers['cache-control']})); }).on('error',reject);
      });
      process.stdout.write(JSON.stringify(result));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  `], { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 503); assert.equal(result.cache, "no-store");
  assert.match(result.body, /No local publication fallback/);
  const diagnostics = child.stderr.split("\n").filter(line => line.startsWith('{"event":"canopy.hosted.unavailable"')).map(line => JSON.parse(line));
  assert.equal(diagnostics.length, 1);
  assert.doesNotMatch(result.body, /SUPABASE|NOVU|adapter/);
  return { diagnostic: diagnostics[0], output: child.stdout + child.stderr };
}

test("entry import is inert and absent hosted configuration produces a safe actionable diagnostic without local fallback", () => {
  const { diagnostic } = probeHostedStartup();
  assert.equal(diagnostic.stage, "configuration");
  assert.deepEqual(diagnostic.missing, ["FOLIAGE_APP_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]);
});

test("unconfigured hosted navigation has a responsive recovery page while API reads still refuse plainly", () => {
  const entry = new URL("../hosted-server.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { createServer, get } from 'node:http';
    import { once } from 'node:events';
    const {default: handler} = await import(${JSON.stringify(entry)});
    const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const read = (path, accept) => new Promise((resolve, reject) => {
      get({host:'127.0.0.1',port:server.address().port,path,headers:{accept}}, res => {
        let body=''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({status:res.statusCode,headers:res.headers,body}));
      }).on('error', reject);
    });
    try { process.stdout.write(JSON.stringify({html:await read('/manage','text/html'),css:await read('/foliage-tokens.css','text/css'),plain:await read('/manage','application/json'),api:await read('/api/subjects','text/html')})); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  `], { env: {}, encoding: "utf8", timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.html.status, 503);
  assert.match(result.html.headers["content-type"], /text\/html/);
  assert.match(result.html.body, /name="viewport"/);
  assert.match(result.html.body, /Canopy is unavailable/);
  assert.match(result.html.body, /href="">Retry<\/a>/);
  assert.match(result.html.headers["content-security-policy"], /default-src 'none'/);
  assert.doesNotMatch(result.html.body, /SUPABASE|CLERK|configuration|fallback/);
  assert.equal(result.css.status, 200);
  assert.match(result.css.headers["content-type"], /text\/css/);
  assert.match(result.css.body, /--fol-/);
  assert.equal(result.plain.status, 503);
  assert.match(result.plain.headers["content-type"], /text\/plain/);
  assert.match(result.plain.body, /No local publication fallback/);
  assert.equal(result.api.status, 503);
  assert.match(result.api.headers["content-type"], /text\/plain/);
});

test("startup identifies Clerk adapter failure without logging configuration values", () => {
  const env = { FOLIAGE_APP_ORIGIN: "sensitive-invalid-origin-canary", SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "sensitive-role-canary", CLERK_PUBLISHABLE_KEY: "sensitive-public-canary", CLERK_SECRET_KEY: "sensitive-secret-canary" };
  const { diagnostic, output } = probeHostedStartup(env);
  assert.equal(diagnostic.stage, "identity-adapter");
  assert.deepEqual(diagnostic.missing, []);
  for (const value of Object.values(env)) assert.ok(!output.includes(value));
});

test("partial optional notification configuration reports its missing settings before adapter initialization", () => {
  const { diagnostic, output } = probeHostedStartup({ NOVU_EMAIL_WORKFLOW_ID: "sensitive-workflow-canary" });
  assert.equal(diagnostic.stage, "configuration");
  for (const name of ["NOVU_API_URL", "NOVU_API_KEY", "NOVU_ENVIRONMENT_ID", "NOVU_WORKER_SECRET"]) assert.ok(diagnostic.missing.includes(name));
  assert.ok(!output.includes("sensitive-workflow-canary"));
});

test("real Node HTTP adapter preserves secure cookies and refuses duplicate authority headers", async () => {
  const h = harness(), server = createServer(createNodeHandler(h.app, ORIGIN));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  try {
    // Node's fetch owns Host; use the HTTP client to exercise the configured virtual host.
    const response = await new Promise<Response>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: address.port, path: "/auth/sign-in", headers: { host: new URL(ORIGIN).host } }, res => {
        const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.once("end", () => { const headers = new Headers(); for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers })); });
      });
      req.once("error", reject); req.end();
    });
    assert.equal(response.status, 200); assert.match(response.headers.getSetCookie()[0]!, /HttpOnly; Secure; SameSite=Lax/);
    assert.match(await response.text(), /data-slot="input"/);
    const duplicate = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: address.port, path: "/manage", headers: ["Host", new URL(ORIGIN).host, "Authorization", "Bearer one", "Authorization", "Bearer two"] }, res => { res.resume(); res.once("end", () => resolve(res.statusCode)); });
      req.once("error", reject); req.end();
    });
    assert.equal(duplicate, 400);
    const foreignHost = await fetch(`http://127.0.0.1:${address.port}/manage`, { redirect: "manual" }); assert.equal(foreignHost.status, 421); await foreignHost.body?.cancel();
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test("an uninitialized deployment fails its health check instead of reporting a live process", () => {
  assert.equal(probeHostedStartup({}, "/healthz").diagnostic.stage, "configuration");
});

/** Request-failure lines written through `console.error`, parsed. */
function failureLines(calls: ReadonlyArray<{ arguments: unknown[] }>): Array<Record<string, any>> {
  return calls.map(call => String(call.arguments[0])).filter(line => line.startsWith('{"event":"canopy.hosted.request_failed"')).map(line => JSON.parse(line));
}
const TOKEN_CANARY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJlLWNhbmFyeQ";

test("an unexpected router failure logs one scrubbed line and keeps the same 503 page, adding its reference", async t => {
  const logged = t.mock.method(console, "error", () => {});
  const h = harness(); await h.send("/manage");
  h.failInventory(`synthetic inventory fault ${TOKEN_CANARY} reader-canary@example.invalid https://storage.invalid/object?token=query-canary`);
  const page = await h.send("/manage/subject-canary/share?note=query-canary");
  const html = await page.text(), [line, ...extra] = failureLines(logged.mock.calls);
  assert.equal(page.status, 503); assert.deepEqual(extra, []); assert.ok(line);
  assert.match(html, /<h1>Not completed<\/h1>/); assert.match(html, /Request failed\. Check the operation before retrying\./);
  assert.ok(html.includes(`Reference <code>${line["requestId"]}</code>`)); assert.equal(page.headers.get("x-request-id"), line["requestId"]);
  assert.deepEqual({ layer: line["layer"], method: line["method"], route: line["route"], status: line["status"], name: line["error"].name },
    { layer: "router", method: "GET", route: "/manage/:id/share", status: 503, name: "TypeError" });
  assert.match(line["error"].message, /^synthetic inventory fault \[token\] \[email\] https:\/\/storage\.invalid\/object\?\[query\]$/);
  assert.ok(line["error"].stack.length > 0 && line["error"].stack.every((frame: string) => frame.startsWith("at ")));

  // A retained review keeps its Retry form; its bytes never reach the log.
  const retried = await h.send("/manage/subject-canary/preview", { fields: { document: JSON.stringify(artifact("body-canary title")) } });
  assert.equal(retried.status, 503); assert.match(savedFields(await retried.text())["document"] ?? "", /body-canary/);
  const api = await device(h, "/api/subjects/subject-canary");
  assert.equal(api.status, 503); assert.deepEqual(await api.json(), { code: "unavailable", error: "Outcome unknown. Check the operation." });
  const lines = failureLines(logged.mock.calls);
  assert.deepEqual(lines.map(l => [l["method"], l["route"]]), [["GET", "/manage/:id/share"], ["POST", "/manage/:id/preview"], ["GET", "/api/subjects/:id"]]);
  assert.equal(api.headers.get("x-request-id"), lines[2]!["requestId"]);
  const raw = logged.mock.calls.map(call => String(call.arguments[0])).join("\n");
  for (const canary of [TOKEN_CANARY, "eyJ", "reader-canary", "query-canary", "subject-canary", "body-canary", SESSION.accessToken, SESSION.refreshToken, h.cookies.get(HOSTED_COOKIES.csrf)!]) {
    assert.equal(raw.includes(canary), false, `log carries ${canary}`);
  }
  // Answers to the request (sign in, absent) are not service failures.
  h.expire(); assert.equal((await h.send("/manage/subject-canary")).status, 303);
  assert.equal((await h.send("/does-not-exist")).status, 404);
  assert.equal(failureLines(logged.mock.calls).length, 3);
});

test("the Node adapter logs an escaped failure once and still answers its plain 503 with the reference", async t => {
  const logged = t.mock.method(console, "error", () => {});
  const server = createServer(createNodeHandler(async () => { throw new RangeError("synthetic adapter fault"); }, ORIGIN));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  try {
    const result = await new Promise<{ status: number | undefined; reference: unknown; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: address.port, method: "POST", path: "/manage/subject-canary/publish?token=query-canary",
        headers: { host: new URL(ORIGIN).host, cookie: `${HOSTED_COOKIES.access}=cookie-canary`, authorization: "Bearer header-canary", "content-type": "application/x-www-form-urlencoded" } }, res => {
        let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; });
        res.once("end", () => resolve({ status: res.statusCode, reference: res.headers["x-request-id"], body }));
      });
      req.once("error", reject); req.end("document=body-canary");
    });
    const [line, ...extra] = failureLines(logged.mock.calls);
    assert.equal(result.status, 503); assert.deepEqual(extra, []); assert.ok(line);
    assert.equal(result.body, `The hosted request could not be completed. Check any pending decision before retrying. Reference: ${line["requestId"]}.`);
    assert.equal(result.reference, line["requestId"]);
    assert.deepEqual({ layer: line["layer"], method: line["method"], route: line["route"], name: line["error"].name, message: line["error"].message },
      { layer: "adapter", method: "POST", route: "/manage/:id/publish", name: "RangeError", message: "synthetic adapter fault" });
    const raw = logged.mock.calls.map(call => String(call.arguments[0])).join("\n");
    for (const canary of ["subject-canary", "query-canary", "cookie-canary", "header-canary", "body-canary"]) assert.equal(raw.includes(canary), false, `log carries ${canary}`);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test("health, robots, favicon and unknown public addresses answer without sign-in, cookies or workspace navigation", async t => {
  const h = harness();
  const health = await h.send("/healthz", { anonymous: true });
  assert.equal(health.status, 200); assert.equal(await health.text(), "ok");
  assert.match(health.headers.get("cache-control")!, /no-store/); assert.deepEqual(health.headers.getSetCookie(), []);
  const head = await h.send("/healthz", { method: "HEAD", anonymous: true }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.deepEqual(h.calls, ["ping", "ping"]);
  const robots = await h.send("/robots.txt", { anonymous: true }), rules = await robots.text();
  assert.equal(robots.status, 200); assert.match(robots.headers.get("content-type")!, /^text\/plain/);
  assert.match(rules, /^User-agent: \*$/m); assert.match(rules, /^Disallow:$/m); assert.doesNotMatch(rules, /^(?:Disallow: \/|Sitemap:)/m);
  // robots.txt leaves findability to this header, which a crawler must be allowed to fetch to read.
  assert.equal(robots.headers.get("x-robots-tag"), "noindex, noarchive, nosnippet, noimageindex");
  const icon = await h.send("/favicon.ico", { anonymous: true });
  assert.equal(icon.status, 200); assert.equal(icon.headers.get("content-type"), "image/svg+xml"); assert.ok(h.calls.includes("asset:/mark-icon.svg"));
  for (const anonymous of [true, false]) {
    for (const [path, method] of [["/does-not-exist", "GET"], ["/sitemap.xml", "GET"], ["/.well-known/security.txt", "HEAD"], ["/leaf", "GET"], ["/internal/other", "GET"], ["/managers", "GET"], ["/robots.txt", "POST"], ["/healthz", "POST"]] as const) {
      const missing = await h.send(path, { anonymous, method });
      assert.equal(missing.status, 404, `${method} ${path}`); assert.equal(missing.headers.has("location"), false);
      assert.deepEqual(missing.headers.getSetCookie(), [], "no CSRF cookie for an absent address");
      assert.equal(await missing.text(), method === "HEAD" ? "" : "Not found.");
    }
  }
  assert.equal(h.calls.includes("getUser"), false, "no address above asked who the visitor is");
  assert.equal((await h.send("/", { anonymous: true })).headers.get("location"), "/manage");
  for (const path of ["/manage", "/manage/http-harness", "/settings/notifications", "/recruiting", "/operations/synthetic"]) {
    const login = await h.send(path, { anonymous: true });
    assert.equal(login.status, 303, path); assert.match(login.headers.get("location")!, /^\/auth\/sign-in\?returnTo=/);
  }
  const logged = t.mock.method(console, "error", () => {});
  h.failPing();
  const down = await h.send("/healthz", { anonymous: true }), [line, ...extra] = failureLines(logged.mock.calls);
  assert.equal(down.status, 503); assert.equal(await down.text(), "unavailable"); assert.deepEqual(extra, []);
  assert.equal(line?.["route"], "/healthz"); assert.equal(line?.["layer"], "health"); assert.equal(down.headers.get("x-request-id"), line?.["requestId"]);
  // The provider's own message stays out; its class and code identify the failure.
  assert.deepEqual([line?.["error"].code, line?.["error"].causes], ["unavailable", ["TypeError:UND_ERR_CONNECT_TIMEOUT"]]);
  assert.equal(JSON.stringify(line).includes("query-canary"), false);
});

test("a missing allowlisted asset is absent rather than an outage, and the favicon is the shared mark", async () => {
  assert.equal(await loadAsset("/fonts/absent-synthetic.woff2"), null);
  const h = harness({ loadAsset });
  const missing = await h.send("/fonts/absent-synthetic.woff2", { anonymous: true });
  assert.equal(missing.status, 404); assert.equal(await missing.text(), "Asset unavailable.");
  const icon = await h.send("/favicon.ico", { anonymous: true });
  assert.equal(icon.status, 200); assert.equal(icon.headers.get("content-type"), "image/svg+xml");
  assert.equal(await icon.text(), (await loadAsset("/mark-icon.svg"))?.bytes.toString());
});

// Device transport tests exercise the real HTTP/admission implementation against the
// explicitly synthetic account/store harness above. They do not claim provider acceptance.
function device(h: ReturnType<typeof harness>, path: string, fields?: Record<string, string>, headers: Record<string, string> = {}) {
  return h.app(new Request(ORIGIN + path, { method: fields ? "POST" : "GET", headers: { authorization: `Bearer ${SESSION.accessToken}`, ...headers }, ...(fields ? { body: new URLSearchParams(fields) } : {}) }));
}
test("device API rejects browser authority before touching accounts and never sets browser cookies", async () => {
  const h = harness();
  for (const headers of [{ origin: ORIGIN }, { cookie: "unrelated=value" }, { origin: "null" }]) {
    const response = await h.app(new Request(ORIGIN + "/api/session", { method: "POST", headers, body: new URLSearchParams({ email: "synthetic@example.invalid", password: "contract-only-password" }) }));
    assert.equal(response.status, 403);
  }
  assert.deepEqual(h.calls, []);
  const response = await h.app(new Request(ORIGIN + "/api/session", { method: "POST", body: new URLSearchParams({ email: "synthetic@example.invalid", password: "contract-only-password" }) }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), SESSION); assert.deepEqual(response.headers.getSetCookie(), []);
  assert.equal((await h.app(new Request(ORIGIN + "/api/subjects"))).status, 401);
  assert.equal((await device(h, "/api/subjects")).status, 200);
  const changed = await h.app(new Request(ORIGIN + "/api/session", { method: "POST", body: new URLSearchParams({ email: "synthetic@example.invalid", password: "contract-only-password", subjectId: SUBJECT }) }));
  assert.equal(changed.status, 400); assert.equal(h.calls.filter(c => c === "signIn").length, 1);
});

test("device API shares exact publication consent, ownership, receipt and withdrawal authority", async () => {
  const h = harness();
  assert.equal((await device(h, "/api/subjects", { subjectId: SUBJECT })).status, 200);
  const operationId = randomUUID();
  const preview = await device(h, `/api/subjects/${SUBJECT}/preview`, { document: JSON.stringify(artifact()), operationId });
  assert.equal(preview.status, 200); assert.deepEqual(preview.headers.getSetCookie(), []);
  const prepared = await preview.json() as { document: unknown; consent: { operationId: string }; actorId: string };
  assert.deepEqual(prepared.document, artifact()); assert.equal(prepared.consent.operationId, operationId);
  const fields = { document: JSON.stringify(prepared.document), consent: JSON.stringify(prepared.consent), reviewActorId: prepared.actorId };
  h.setActor(FOREIGN); assert.equal((await device(h, `/api/subjects/${SUBJECT}/publish`, fields)).status, 403); h.setActor(ACTOR);
  const result = await device(h, `/api/subjects/${SUBJECT}/publish`, fields); assert.equal(result.status, 200);
  const saved = await result.json() as PublicationResult;
  assert.equal(saved.receipt.operationId, operationId); assert.equal(saved.receipt.generation, 1);
  const current = await (await device(h, `/api/subjects/${SUBJECT}`)).json() as { document: unknown };
  assert.deepEqual(current.document, artifact());
  assert.equal((await device(h, `/api/subjects/${SUBJECT}/withdraw`, { operationId: randomUUID(), expectedRevisionId: saved.receipt.revisionId!, expectedGeneration: "1" })).status, 200);
  const historical = await (await device(h, `/api/operations/${operationId}`)).json() as PublicationResult;
  assert.equal(historical.receipt.generation, 1); assert.equal(historical.current.generation, 2); assert.equal(historical.current.visible, false);
  assert.equal((await h.send(`/leaf/${SUBJECT}`, { anonymous: true })).status, 404);
});

async function bridgeFixture(t: { after: (fn: () => Promise<unknown>) => void }, nango?: Parameters<typeof createHostedApp>[0]["nango"]) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-hosted-handoff-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository"), garden = join(dir, "garden");
  const run = (program: string, args: string[]) => { const result = spawnSync(program, args, { encoding: "utf8", timeout: 15_000 }); assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout; };
  run("git", ["init", "--quiet", "--initial-branch=main", repo]);
  const git = (args: string[]) => run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args]);
  git(["config", "user.name", "Hosted handoff regression"]); git(["config", "user.email", "handoff-regression@foliage.invalid"]);
  await writeFile(join(repo, "observed-source.ts"), await readFile(fileURLToPath(import.meta.url)));
  git(["add", "observed-source.ts"]); git(["commit", "--no-gpg-sign", "-qm", "chore: observe local hosted handoff regression source"]);
  const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
  run(process.execPath, [launcher, "grow", "--repo", repo, "--subject", "Hosted handoff regression", "--identity", "handoff-regression@foliage.invalid", "--garden", garden]);
  const leafPath = join(garden, "leaf.json"), policyPath = join(garden, "policy.json"), statePath = join(garden, "hosted", "connection.json");
  const leaf = JSON.parse(await readFile(leafPath, "utf8"));
  assert.ok(leaf.leaflets.length > 0, "actual Git intake produced Leaflets");
  run(process.execPath, [launcher, "share", leaf.leaflets[0].id, "--as", "public", "--garden", garden]);
  const env = { FOLIAGE_LEAF: leafPath, FOLIAGE_POLICY: policyPath, FOLIAGE_PUBLISHED: join(garden, "published"), FOLIAGE_HARVEST: join(garden, "harvest.json") };
  const h = harness(nango ? { nango } : {}), requests: { path: string; body: string }[] = [];
  let loseRefresh = false, forgeReceipt = false;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), path = new URL(request.url).pathname;
    const submitted = request.method === "POST" ? await request.clone().formData() : new FormData();
    requests.push({ path, body: new URLSearchParams([...submitted].map(([key, value]): [string, string] => [key, String(value)])).toString() });
    if (path.endsWith("/publish") || path.endsWith("/withdraw")) {
      const retained = JSON.parse(await readFile(statePath, "utf8"));
      assert.equal(retained.operation.status, "unconfirmed", "operation must be saved before the mutation leaves this device");
      const body = submitted;
      assert.equal(retained.operation.operationId, path.endsWith("/publish") ? JSON.parse(String(body.get("consent"))).operationId : body.get("operationId"));
    }

    const response = await h.app(request);
    if (loseRefresh && path === "/api/session/refresh") throw new Error("Synthetic lost refresh acknowledgement");
    if (forgeReceipt && path.endsWith("/publish") && response.ok) {
      const value = await response.json() as PublicationResult;
      return Response.json({ ...value, receipt: { ...value.receipt, generation: value.receipt.generation + 3 }, current: { ...value.current, generation: value.current.generation + 3 } });
    }
    return response;
  };
  const bridge = () => createLocalHostedBridge({ origin: ORIGIN, statePath, env, fetch: fetcher });
  const connect = async () => bridge().command("connect", { email: "synthetic@example.invalid", password: "contract-only-password" });
  const prepare = async () => { const local = await loadManageState(env); assert.equal(local.kind, "ready"); return bridge().command("prepare", { sourceDigest: local.sourceDigest, policyDigest: local.policyDigest }); };
  return { dir, garden, leafPath, statePath, env, h, requests, bridge, connect, prepare, loseRefresh: () => { loseRefresh = true; }, forgeReceipt: () => { forgeReceipt = true; } };
}

test("local handoff persists before sending, recovers across restart without republishing, then withdraws", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t); await f.connect(); const view = await f.prepare();
  assert.ok(view.prepared); assert.equal(view.operation?.status, "ready"); assert.equal(f.h.calls.includes("publish"), false);
  const originalLeaf = await readFile(f.leafPath, "utf8");
  const fields = { operationId: view.prepared.consent.operationId, confirm: view.prepared.consent.subjectId };
  f.h.unknownCommit(); await assert.rejects(f.bridge().command("publish", fields), /acknowledgement was lost/);
  assert.equal((await f.bridge().view()).operation?.status, "unconfirmed");
  await assert.rejects(f.prepare(), /saved operation/);
  await assert.rejects(f.bridge().command("publish", { ...fields, confirm: "another-leaf" }), /saved operation/);
  const recovered = await f.bridge().command("publish", fields);
  assert.equal(recovered.operation?.status, "confirmed"); assert.equal(recovered.remote?.current.visible, true);
  assert.equal(f.h.calls.filter(c => c === "publish").length, 1);
  const safe = JSON.stringify(recovered) + renderHostedBridge(recovered, await loadManageState(f.env), "csrf-contract-input");
  assert.doesNotMatch(safe, /test-access|test-refresh|contract-only-password/);
  const privateBytes = await readFile(f.statePath, "utf8"); assert.doesNotMatch(privateBytes, /contract-only-password/); assert.match(privateBytes, /test-refresh/);
  assert.equal((await stat(f.statePath)).mode & 0o777, 0o600);
  assert.equal(await readFile(f.leafPath, "utf8"), originalLeaf);
  const remote = recovered.remote!.current;
  const withdrawn = await f.bridge().command("withdraw", { confirm: remote.subjectId, revisionId: remote.revisionId!, generation: String(remote.generation) });
  assert.equal(withdrawn.operation?.result?.receipt.kind, "withdraw"); assert.equal(withdrawn.remote?.current.visible, false);
  const status = JSON.parse(await readFile(join(f.garden, "hosted", "status.json"), "utf8"));
  assert.equal(status.visible, false); assert.equal(status.documentDigest, null); assert.equal(status.generation, 2);
  assert.equal((await f.h.send(`/leaf/${remote.subjectId}`, { anonymous: true })).status, 404);
  for (const request of f.requests.filter(r => r.path.endsWith("/preview") || r.path.endsWith("/publish"))) {
    const doc = JSON.parse(new URLSearchParams(request.body).get("document")!);
    assert.equal(doc.artifactVersion, 5); assert.doesNotMatch(JSON.stringify(doc), /observed-source\.ts|handoff-regression@foliage.invalid|test-refresh/);
  }
});

test("local handoff refuses stale review and invalid receipts; lost refresh removes the rotated credential", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t); await f.connect(); const view = await f.prepare();
  await writeFile(f.leafPath, (await readFile(f.leafPath, "utf8")) + "\n");
  await assert.rejects(f.bridge().command("publish", { operationId: view.prepared!.consent.operationId, confirm: view.prepared!.consent.subjectId }), /Leaf or policy changed/);
  assert.equal(f.h.calls.includes("publish"), false);
  const next = await f.prepare(); f.forgeReceipt();
  await assert.rejects(f.bridge().command("publish", { operationId: next.prepared!.consent.operationId, confirm: next.prepared!.consent.subjectId }), /receipt does not match/);
  assert.equal((await f.bridge().view()).operation?.status, "unconfirmed");
  const state = JSON.parse(await readFile(f.statePath, "utf8")); state.session.expiresAt = 0;
  await writeFile(f.statePath, JSON.stringify(state)); f.loseRefresh();
  await assert.rejects(f.bridge().command("recover", {}), /Refresh unconfirmed/);
  assert.equal((await f.bridge().view()).connected, false);
  await assert.rejects(f.bridge().command("recover", {}), /Reconnect the account/);
  assert.equal(f.h.calls.filter(c => c === "refreshSession").length, 1);
  assert.doesNotMatch(await readFile(f.statePath, "utf8"), /test-access|test-refresh/);
});


test("account switches invalidate the independent hosting observation and insecure connection files are refused", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t); await f.connect(); const ready = await f.prepare();
  const id = ready.prepared!.consent.subjectId;
  await f.bridge().command("publish", { operationId: ready.prepared!.consent.operationId, confirm: id });
  const statusPath = join(f.garden, "hosted", "status.json");
  assert.equal(JSON.parse(await readFile(statusPath, "utf8")).visible, true);
  await f.bridge().command("disconnect", {}); f.h.setActor(FOREIGN); const switched = await f.connect();
  assert.equal(switched.accountId, FOREIGN.id); assert.equal(switched.remote, null); assert.equal(switched.prepared, null);
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  assert.deepEqual(status, { version: 1, origin: ORIGIN, reason: "account-changed" });
  const calls = f.h.calls.length;
  for (const mode of [0o640, 0o604, 0o644]) {
    await chmod(f.statePath, mode);
    await assert.rejects(f.bridge().view(), /Connection file must be private/);
    await assert.rejects(f.bridge().command("refresh", {}), /Connection file must be private/);
    assert.equal(f.h.calls.length, calls, "insecure credentials must not be used");
  }
  await chmod(f.statePath, 0o600); assert.equal((await f.bridge().view()).connected, true);
});


test("a changed retained request cannot send bytes beyond its saved public review", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t); await f.connect(); await f.prepare();
  const state = JSON.parse(await readFile(f.statePath, "utf8"));
  const calls = f.requests.length;
  state.operation.fields.document = await readFile(f.leafPath, "utf8");
  await writeFile(f.statePath, JSON.stringify(state));
  await assert.rejects(f.bridge().command("publish", { operationId: state.operation.operationId, confirm: state.operation.subjectId }), /Saved operation changed/);
  assert.equal(f.requests.length, calls, "a corrupted request must fail before any egress");
});

test("chosen narrative reaches the exact reader; stale choices and unselected private text do not cross", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t);
  const leaf = JSON.parse(await readFile(f.leafPath, "utf8"));
  const title = leaf.leaflets[0].title;
  const provenance = leaf.leaflets[0].provenance;
  leaf.leaflets[0].body = [{ text: title + " <script>not executable</script>", provenance }, { text: "Private contract-only paragraph", provenance }];
  await writeFile(f.leafPath, JSON.stringify(leaf));
  await f.connect();
  const local = await loadManageState(f.env); assert.equal(local.kind, "ready");
  const form = renderHostedBridge(await f.bridge().view(), local, "csrf-contract");
  assert.match(form, /name="narrative-0-0"/); assert.doesNotMatch(form, /checked(?:=|\s|>)/);
  const fields = { sourceDigest: local.sourceDigest, policyDigest: local.policyDigest, "narrative-0-0": "on" };
  const selected = await f.bridge().command("prepare", fields);
  assert.match(JSON.stringify(selected.prepared!.document), /not executable/);
  // CONTROL: the publish panel shows the full prepared document before its publish form.
  const panel = renderHostedBridge(await f.bridge().view(), local, "csrf-contract");
  const payload = `<pre class="num">${esc(JSON.stringify(selected.prepared!.document, null, 2))}</pre>`;
  assert.ok(panel.includes(payload), "the bridge publish panel does not show the prepared bytes");
  assert.ok(panel.indexOf(payload) < panel.indexOf('action="/hosted/publish"'), "the content must precede the decision");
  assert.doesNotMatch(JSON.stringify(selected.prepared!.document), /Private contract-only/);
  const id = selected.prepared!.consent.subjectId;
  await f.bridge().command("publish", { operationId: selected.prepared!.consent.operationId, confirm: id });
  const reader = await (await f.h.send(`/leaf/${id}`, { anonymous: true })).text();
  assert.match(reader, /In their words/); assert.match(reader, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.doesNotMatch(reader, /<script>|Private contract-only/);
  const requestCount = f.requests.length;
  leaf.leaflets[0].body.reverse(); await writeFile(f.leafPath, JSON.stringify(leaf));
  await assert.rejects(f.bridge().command("prepare", fields), /Leaf or policy changed. Review again/);
  assert.equal(f.requests.length, requestCount, "stale checkbox indices must not send a different paragraph");
  const newLocal = await loadManageState(f.env); assert.equal(newLocal.kind, "ready");
  const plain = await f.bridge().command("prepare", { sourceDigest: newLocal.sourceDigest, policyDigest: newLocal.policyDigest });
  await f.bridge().command("publish", { operationId: plain.prepared!.consent.operationId, confirm: id });
  assert.doesNotMatch(await (await f.h.send(`/leaf/${id}`, { anonymous: true })).text(), /In their words|not executable/);
  const remote = (await f.bridge().view()).remote!.current;
  await f.bridge().command("withdraw", { confirm: id, revisionId: remote.revisionId!, generation: String(remote.generation) });
  assert.equal((await f.h.send(`/leaf/${id}`, { anonymous: true })).status, 404);
});

test("selected stripped photo crosses only after review and its URL ends on withdrawal", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t);
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=", "base64");
  const original = Buffer.concat([pixel, Buffer.from("metadata removed before publication")]);
  const sourcePath = join(f.dir, "selected-image.png");
  await writeFile(sourcePath, original);
  const stored = await putImage({ root: mediaRootFromEnv(f.env), sourcePath,
    sourceDigest: documentDigest(original).slice(7), sourceFormat: "png", sipsRuns: false });
  assert.ok(stored.ok);
  const leaf = JSON.parse(await readFile(f.leafPath, "utf8"));
  leaf.leaflets[0].body = [...(leaf.leaflets[0].body ?? []), { text: "Selected caption", media: { mediaType: "image/png", dimensions: { known: false, why: "Container contract" } },
    provenance: { source: "photo", ref: stored.ref, observedAt: "2026-09-09T00:00:00Z" } }];
  const element = leaf.leaflets[0].body.length - 1;
  await writeFile(f.leafPath, JSON.stringify(leaf));
  await f.connect();
  const local = await loadManageState(f.env); assert.equal(local.kind, "ready");
  const choice = local.photoChoices?.find(item => item.element === element);
  assert.ok(choice?.photo);
  const form = renderHostedBridge(await f.bridge().view(), local, "csrf-contract");
  assert.match(form, new RegExp(`name="photo-select-0-${element}"`));
  assert.doesNotMatch(form, /name="photo-select-[^"]+"[^>]*checked/);
  const selected = await f.bridge().command("prepare", { sourceDigest: local.sourceDigest, policyDigest: local.policyDigest,
    [`photo-select-0-${element}`]: "on", [`photo-digest-0-${element}`]: choice.photo.renditionDigest,
    [`photo-alt-0-${element}`]: "Selected work image" });
  assert.equal((selected.prepared?.document as { artifactVersion: number }).artifactVersion, 6);
  const digest = selected.prepared!.consent.artifactDigest, rendition = choice.photo.renditionDigest;
  const privatePhoto = await f.bridge().photo(digest.slice(7), rendition.slice(7));
  assert.deepEqual(privatePhoto?.bytes, pixel);
  const id = selected.prepared!.consent.subjectId;
  await f.bridge().command("publish", { operationId: selected.prepared!.consent.operationId, confirm: id });
  const mediaPath = `/leaf/${id}/media/${digest.slice(7)}/${rendition.slice(7)}`;
  const page = await (await f.h.send(`/leaf/${id}`, { anonymous: true })).text();
  assert.match(page, /alt="Selected work image"/);
  assert.ok(page.includes(mediaPath));
  const detailPath = `/leaflet/${encodeURIComponent(leaf.leaflets[0].id)}?publication=${id}`;
  const detail = await f.h.send(detailPath, { anonymous: true });
  assert.equal(detail.status, 200);
  assert.ok((await detail.text()).includes(mediaPath));
  const media = await f.h.send(mediaPath, { anonymous: true });
  assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), pixel);
  const remote = (await f.bridge().view()).remote!.current;
  await f.bridge().command("withdraw", { confirm: id, revisionId: remote.revisionId!, generation: String(remote.generation) });
  assert.equal((await f.h.send(mediaPath, { anonymous: true })).status, 404);
  assert.equal((await f.h.send(detailPath, { anonymous: true })).status, 404);
});

test("a separately selected demo is artifact-bound, same-origin and revoked with its publication", { timeout: 30_000 }, async t => {
  const f = await bridgeFixture(t);
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=", "base64");
  const sourcePath = join(f.dir, "reviewed-still.png"); await writeFile(sourcePath, pixel);
  const still = await putImage({ root: mediaRootFromEnv(f.env), sourcePath,
    sourceDigest: documentDigest(pixel).slice(7), sourceFormat: "png", sipsRuns: false });
  assert.ok(still.ok);
  const clipPath = join(f.dir, "recorded-demo.mp4");
  const encoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clipPath], { encoding: "utf8" });
  if (encoded.error && "code" in encoded.error && encoded.error.code === "ENOENT") { t.skip("ffmpeg is unavailable"); return; }
  assert.equal(encoded.status, 0, encoded.stderr);
  const bytes = await readFile(clipPath), video = await putCapturedVideo(videoRootFromEnv(f.env), bytes,
    { posterRef: still.ref, durationSeconds: 1 });
  const leaf = JSON.parse(await readFile(f.leafPath, "utf8"));
  leaf.leaflets[0].body = [...(leaf.leaflets[0].body ?? []),
    { text: "Reviewed still", media: { mediaType: "image/png", dimensions: { known: false, why: "Container contract" } },
      provenance: { source: "photo", ref: still.ref, observedAt: "2026-09-09T00:00:00Z" } },
    { text: "Recorded interaction", media: { mediaType: "video/mp4", dimensions: { known: false, why: "Viewport contract" } },
      provenance: { source: "capture", ref: video.ref, observedAt: "2026-09-09T00:00:00Z" } }];
  const photoIndex = leaf.leaflets[0].body.length - 2, videoIndex = photoIndex + 1;
  await writeFile(f.leafPath, JSON.stringify(leaf)); await f.connect();
  const local = await loadManageState(f.env); assert.equal(local.kind, "ready");
  const photo = local.photoChoices?.find(item => item.element === photoIndex), choice = local.videoChoices?.find(item => item.element === videoIndex);
  assert.ok(photo?.photo); assert.ok(choice?.video);
  const preparePage = renderHostedBridge(await f.bridge().view(), local, "csrf-contract");
  assert.match(preparePage, new RegExp(`name="video-select-0-${videoIndex}"`));
  assert.doesNotMatch(preparePage, /name="video-select-[^"]+"[^>]*checked/);
  const unselected = await f.bridge().command("prepare", { sourceDigest: local.sourceDigest, policyDigest: local.policyDigest });
  assert.equal((unselected.prepared?.document as { artifactVersion: number }).artifactVersion < 7, true);
  const selected = await f.bridge().command("prepare", { sourceDigest: local.sourceDigest, policyDigest: local.policyDigest,
    [`photo-select-0-${photoIndex}`]: "on", [`photo-digest-0-${photoIndex}`]: photo.photo.renditionDigest,
    [`photo-alt-0-${photoIndex}`]: "Recorded app still", [`video-select-0-${videoIndex}`]: "on", [`video-digest-0-${videoIndex}`]: video.ref });
  assert.equal((selected.prepared?.document as { artifactVersion: number }).artifactVersion, 7);
  const digest = selected.prepared!.consent.artifactDigest, id = selected.prepared!.consent.subjectId;
  const privateClip = await f.bridge().video(digest.slice(7), video.ref.slice(7));
  assert.deepEqual(privateClip?.bytes, bytes);
  await f.bridge().command("publish", { operationId: selected.prepared!.consent.operationId, confirm: id });
  const path = `/leaf/${id}/video/${digest.slice(7)}/${video.ref.slice(7)}`;
  const page = await (await f.h.send(`/leaf/${id}`, { anonymous: true })).text();
  assert.ok(page.includes(path)); assert.match(page, /<video\b[^>]*controls/);
  const get = await f.h.send(path, { anonymous: true });
  assert.equal(get.status, 200); assert.equal(get.headers.get("content-type"), "video/mp4");
  assert.equal(get.headers.get("accept-ranges"), "bytes");
  assert.match(get.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
  const range = await f.h.send(path, { anonymous: true, headers: { range: "bytes=0-15" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 0-15/${bytes.length}`);
  assert.equal(range.headers.get("content-length"), "16");
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  const suffix = await f.h.send(path, { anonymous: true, headers: { range: "bytes=-8" } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-8));
  const invalidRange = await f.h.send(path, { anonymous: true, headers: { range: `bytes=${bytes.length}-` } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("content-range"), `bytes */${bytes.length}`);
  const head = await f.h.send(path, { method: "HEAD", anonymous: true });
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const headRange = await f.h.send(path, { method: "HEAD", anonymous: true, headers: { range: "bytes=10-19" } });
  assert.equal(headRange.status, 206); assert.equal(headRange.headers.get("content-length"), "10");
  assert.equal((await headRange.arrayBuffer()).byteLength, 0);
  const current = (await f.bridge().view()).remote!.current;
  await f.bridge().command("withdraw", { confirm: id, revisionId: current.revisionId!, generation: String(current.generation) });
  assert.equal((await f.h.send(path, { anonymous: true })).status, 404);
  assert.equal((await f.h.send(path, { anonymous: true, headers: { range: "bytes=0-15" } })).status, 404);
});

test("public specimen artwork loads without account or publication access", async () => {
  const h = harness();
  const response = await h.send("/specimen-sheet-day.jpg", { anonymous: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL("../public/specimen-sheet-day.jpg", import.meta.url)));
  assert.deepEqual(h.calls, ["asset:/specimen-sheet-day.jpg"]);
  const absent = await h.send("/private-artifact.jpg", { anonymous: true });
  assert.notEqual(absent.status, 200);
  assert.ok(!h.calls.includes("asset:/private-artifact.jpg"));
});


test("first import detects the address, preserves ownership and requires a separate publication decision", async () => {
  const h = harness();
  const welcome = await h.send("/manage");
  const html = await welcome.text();
  assert.match(html, /Your portfolio/);
  assert.doesNotMatch(html, /Reserve address|Choose a publication address|name="subjectId"/);
  assert.match(html, /Connect my work/);
  assert.match(html, /<details[^>]*><summary>GitHub verification/);
  const imported = await h.send("/manage/import/start", { fields: { document: JSON.stringify(artifact()) } });
  assert.equal(imported.status, 200);
  const review = savedFields(await imported.text());
  assert.equal(h.owned.get(SUBJECT)?.actorId, ACTOR.id);
  assert.equal(h.owned.get(SUBJECT)?.visible, false);
  assert.equal(h.calls.includes("publish"), false);
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields: review })).status, 303);
  assert.equal(h.owned.get(SUBJECT)?.visible, true);
  h.setActor(FOREIGN);
  assert.equal((await h.send("/manage/import/start", { fields: { document: JSON.stringify(artifact()) } })).status, 403);
  assert.equal(h.owned.get(SUBJECT)?.actorId, ACTOR.id);
});

test("import refuses invalid input and cross-origin requests and retains input when sign-in expires", async () => {
  const h = harness(); await h.send("/manage");
  assert.equal((await h.send("/manage/import/start", { fields: { document: "{}" } })).status, 400);
  assert.equal(h.calls.includes("reserve"), false);
  assert.equal((await h.send("/manage/import/start", { fields: { document: JSON.stringify(artifact()) }, headers: { origin: "https://foreign.invalid" } })).status, 400);
  assert.equal(h.calls.includes("reserve"), false);
  h.expire();
  const interrupted = await h.send("/manage/import/start", { fields: { document: JSON.stringify(artifact()) } });
  assert.equal(interrupted.status, 401);
  const html = await interrupted.text();
  assert.equal(savedFields(html)["document"], JSON.stringify(artifact()));
  assert.equal(h.calls.includes("reserve"), false);
});

test("an account at the address cap is refused plainly before reserving; owned addresses stay reachable", async () => {
  const h = harness(); await h.send("/manage");
  assert.equal(MAX_ADDRESSES_PER_ACCOUNT, 3);
  for (const id of [SUBJECT, "cap-two", "cap-three"]) assert.equal((await h.send("/manage", { fields: { subjectId: id } })).status, 303);
  const reservations = () => h.calls.filter(call => call === "reserve").length, before = reservations();
  const limit = /This account already has 3 portfolio addresses, the most one account can reserve\. Addresses are permanent, so ones taken offline still count\. Contact support to raise the limit\./;
  const refused = await h.send("/manage", { fields: { subjectId: "cap-four" } });
  assert.equal(refused.status, 403); assert.match(await refused.text(), limit);
  const other = artifact(); other.leaf.id = "cap-four";
  const imported = await h.send("/manage/import/start", { fields: { document: JSON.stringify(other) } });
  assert.equal(imported.status, 403); assert.match(await imported.text(), limit);
  const api = await device(h, "/api/subjects", { subjectId: "cap-four" });
  assert.equal(api.status, 403);
  assert.deepEqual(await api.json(), { code: "address-limit", error: addressLimitError().message });
  assert.equal(reservations(), before, "refusals never reach the authority RPC");
  assert.equal(h.owned.has("cap-four"), false);
  assert.equal((await h.send("/manage", { fields: { subjectId: "cap-two" } })).status, 303);
  // An address support reserved past the cap sorts first, so this owned one is found by lookup.
  h.owned.set("cap-support", { actorId: ACTOR.id, subjectId: "cap-support", revisionId: null, generation: 0, visible: false });
  assert.equal((await h.send("/manage/import/start", { fields: { document: JSON.stringify(artifact()) } })).status, 200);
  assert.equal((await h.send("/manage", { fields: { subjectId: "cap-four" } })).status, 403);
  h.setActor(FOREIGN);
  assert.equal((await device(h, "/api/subjects", { subjectId: "cap-foreign" })).status, 200);
  // A database refusal (the migrated RPC, or a concurrent reservation) reads the same way.
  h.store.reserveSubject = async () => { throw addressLimitError(); };
  const raced = await h.send("/manage", { fields: { subjectId: "cap-foreign-two" } });
  assert.equal(raced.status, 403); assert.match(await raced.text(), limit);
});


test("source connection requires browser CSRF; device observations reuse authenticated actor and reject mixed transports", async () => {
  let connections = 0, reads = 0;
  const h = harness({ nango: {
    async connect(actor) { assert.deepEqual(actor, ACTOR); connections++; return "https://connect.example.invalid/short-session"; },
    async observations(actor, connectionId, subject) { assert.deepEqual(actor, ACTOR); assert.equal(connectionId, "selected-source"); reads++;
      return { format: "foliage-observations", version: 1, subject, source: { provider: "nango", tenantId: null, accountId: "protocol-account" }, completion: "complete", deletedRecordIds: [], observations: [] }; },
  } });
  assert.equal((await h.send("/manage/sources/connect")).status, 200);
  assert.equal((await h.send("/manage/sources/connect", { fields: {}, headers: { origin: "https://foreign.invalid" } })).status, 400);
  assert.equal(connections, 0);
  const connected = await h.send("/manage/sources/connect", { fields: {} });
  assert.equal(connected.status, 200); assert.match(await connected.text(), /Continue to source sign-in/); assert.equal(connections, 1);
  const input = { connectionId: "selected-source", leafId: "selected-local-leaf", name: "Protocol target" };
  assert.equal((await device(h, "/api/sources/observations", input)).status, 200); assert.equal(reads, 1);
  assert.equal((await device(h, "/api/sources/observations", input, { origin: ORIGIN })).status, 403);
  assert.equal((await device(h, "/api/sources/observations", { ...input, actorId: FOREIGN.id })).status, 400);
  assert.equal(reads, 1);
});


test("companion imports source observations through the existing review writer and replays without publication", async t => {
  let material = "";
  const f = await bridgeFixture(t, {
    async connect() { throw Error("Not used by this source-read test"); },
    async observations(actor, connection, subject) {
      assert.deepEqual(actor, ACTOR); assert.equal(connection, "test-connection");
      return { format: "foliage-observations", version: 1, subject, source: { provider: "nango", tenantId: null, accountId: "protocol-only-account" },
        completion: "complete", deletedRecordIds: [], observations: [{ recordId: "selected-git-intake", revision: "v1", title: "Actual local intake observed through protocol harness", excerpt: material, observedAt: "2026-09-16T00:00:00Z" }] };
    },
  });
  const original = await readFile(f.leafPath, "utf8");
  material = JSON.stringify(JSON.parse(original).leaflets[0]);
  await f.connect();
  const first = await f.bridge().importSource("test-connection");
  assert.equal(first.persisted.length, 1);
  const before = await readFile(f.env.FOLIAGE_HARVEST, "utf8");
  const saved = JSON.parse(before);
  assert.equal(saved.candidates.find((c: { id: string }) => c.id === first.persisted[0]).review.state, "candidate");
  assert.deepEqual((await f.bridge().importSource("test-connection")).unchanged, first.persisted);
  assert.equal(await readFile(f.env.FOLIAGE_HARVEST, "utf8"), before);
  material += " changed without upstream revision";
  await assert.rejects(f.bridge().importSource("test-connection"), /different material/);
  assert.equal(await readFile(f.env.FOLIAGE_HARVEST, "utf8"), before);
  assert.equal(await readFile(f.leafPath, "utf8"), original);
  assert.equal(f.requests.some(r => r.path.endsWith("/publish")), false);
});


test("personal sharing stays separate from recruiting navigation, connections and history", async () => {
  let connectionReads = 0;
  const h = harness({ distribution: { connections: async () => { connectionReads++; throw new Error("must not run during personal sharing"); } } as unknown as NonNullable<Parameters<typeof createHostedApp>[0]["distribution"]> });
  const reviewed = await h.review();
  await h.send(`/manage/${SUBJECT}/publish`, { fields: reviewed.fields });
  const manage = await (await h.send(`/manage/${SUBJECT}`)).text();
  assert.match(manage, new RegExp(`/manage/${SUBJECT}/share`));
  for (const path of ["/manage", `/manage/${SUBJECT}`, `/manage/${SUBJECT}/share`]) {
    const response = await h.send(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /recruiting|candidateName|Ashby|Delivery history|\/distribution/);
  }
  const share = await (await h.send(`/manage/${SUBJECT}/share`)).text();
  assert.match(share, new RegExp(`/leaf/${SUBJECT}/resume.md`));
  assert.equal(connectionReads, 0);
  const old = await h.send(`/manage/${SUBJECT}/distribution`);
  assert.equal(old.status, 303);
  assert.equal(old.headers.get("location"), `/recruiting/portfolios/${SUBJECT}`);
  assert.equal(connectionReads, 0);
});

test("recruiting has its own entry and keeps unpublished and other-account records out", async () => {
  const h = harness();
  await h.send("/manage");
  await h.send("/manage", { fields: { subjectId: SUBJECT } });
  const empty = await h.send("/recruiting");
  assert.equal(empty.status, 200); assert.match(await empty.text(), /No published portfolios/);
  const reviewed = await h.review();
  await h.send(`/manage/${SUBJECT}/publish`, { fields: reviewed.fields });
  const home = await (await h.send("/recruiting")).text();
  assert.match(home, new RegExp(`/recruiting/portfolios/${SUBJECT}`));
  assert.doesNotMatch(home, /Connect Photosynthesis|Notifications|href="\/manage"/);
  const detail = await h.send(`/recruiting/portfolios/${SUBJECT}`);
  assert.equal(detail.status, 200); assert.match(await detail.text(), /class="fol-workspace-section">Recruiting<\/span>/);
  h.setActor(FOREIGN);
  assert.doesNotMatch(await (await h.send("/recruiting")).text(), new RegExp(SUBJECT));
  assert.equal((await h.send(`/recruiting/portfolios/${SUBJECT}`)).status, 403);
  assert.equal((await h.send(`/manage/${SUBJECT}/share`)).status, 403);
  assert.equal((await h.send(`/manage/${SUBJECT}/distribution`)).status, 403);
  h.expire();
  const signedOut = await h.send("/recruiting");
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get("location"), "/auth/sign-in?returnTo=%2Frecruiting");
});

test("recruiting connection actions retain CSRF and actor checks on their dedicated routes", async () => {
  let connected = 0;
  const h = harness({ distribution: { connect: async (actor: HostedActor) => { assert.equal(actor.id, ACTOR.id); connected++; return "https://connect.example.invalid/"; } } as unknown as NonNullable<Parameters<typeof createHostedApp>[0]["distribution"]> });
  await h.send("/manage"); await h.send("/manage", { fields: { subjectId: SUBJECT } });
  const path = `/recruiting/portfolios/${SUBJECT}/connect`;
  assert.equal((await h.send(path)).status, 405);
  assert.equal((await h.send(path, { fields: { reviewActorId: FOREIGN.id } })).status, 403);
  assert.equal((await h.send(path, { fields: { reviewActorId: ACTOR.id }, headers: { origin: "https://other.invalid" } })).status, 400);
  assert.equal(connected, 0);
  const allowed = await h.send(path, { fields: { reviewActorId: ACTOR.id } });
  assert.equal(allowed.status, 200); assert.equal(connected, 1);
  assert.match(await allowed.text(), /class="fol-workspace-section">Recruiting<\/span>/);
});

test("recruiting search, preview and receipts stay in recruiting while device routes remain compatible", async () => {
  const operationId = "30000000-0000-4000-8000-000000000001";
  const calls: string[] = [];
  let status = "prepared";
  const receipt = () => ({ operationId, subjectId: SUBJECT, candidateName: "Protocol candidate", status, current: true, payloadDigest: `sha256:${"a".repeat(64)}` });
  const distribution = {
    label: "Protocol destination", capabilities: {},
    connections: async () => [{ id: "protocol-connection", available: true }],
    list: async () => [receipt()],
    search: async () => ({ candidates: [{ id: "protocol-candidate", name: "Protocol candidate" }], more: false }),
    prepare: async (actor: HostedActor) => { assert.equal(actor.id, ACTOR.id); calls.push("prepare"); return receipt(); },
    read: async (actor: HostedActor) => { assert.equal(actor.id, ACTOR.id); return receipt(); },
    preview: async () => "Protocol payload only",
    send: async (actor: HostedActor, operation: string, digest: string) => { assert.equal(actor.id, ACTOR.id); assert.equal(operation, operationId); assert.equal(digest, receipt().payloadDigest); calls.push("send"); status = "accepted"; return receipt(); },
  } as unknown as NonNullable<Parameters<typeof createHostedApp>[0]["distribution"]>;
  const h = harness({ distribution });
  const reviewed = await h.review(); await h.send(`/manage/${SUBJECT}/publish`, { fields: reviewed.fields });
  const route = `/recruiting/portfolios/${SUBJECT}`;
  const detail = await (await h.send(route)).text();
  assert.match(detail, new RegExp(`action="${route}/search"`));
  assert.doesNotMatch(detail, /action="\/manage|href="\/distribution/);
  const search = await (await h.send(`${route}/search`, { fields: { reviewActorId: ACTOR.id, connectionId: "protocol-connection", candidateName: "Protocol candidate" } })).text();
  assert.match(search, new RegExp(`action="${route}"`));
  const prepared = await h.send(route, { fields: { reviewActorId: ACTOR.id, operationId, connectionId: "protocol-connection", candidateId: "protocol-candidate" } });
  assert.equal(prepared.headers.get("location"), `/recruiting/deliveries/${operationId}`);
  const old = await h.send(`/distribution/${operationId}`);
  assert.equal(old.status, 303); assert.equal(old.headers.get("location"), `/recruiting/deliveries/${operationId}`);
  const preview = await (await h.send(`/recruiting/deliveries/${operationId}`)).text();
  assert.match(preview, new RegExp(`action="/recruiting/deliveries/${operationId}/send"`));
  // CONTROL: the exact content to share is shown before the send form.
  assert.ok(preview.includes("<pre>Protocol payload only</pre>"), "the delivery review does not show its payload");
  assert.ok(preview.indexOf("<pre>Protocol payload only</pre>") < preview.indexOf(`action="/recruiting/deliveries/${operationId}/send"`));
  assert.doesNotMatch(preview, /href="\/manage(?:\/|")|href="\/distribution(?:\/|")/);
  assert.deepEqual(calls, ["prepare"]);
  const sent = await h.send(`/recruiting/deliveries/${operationId}/send`, { fields: { reviewActorId: ACTOR.id, payloadDigest: receipt().payloadDigest } });
  assert.equal(sent.status, 303); assert.deepEqual(calls, ["prepare", "send"]);
  const api = await h.send(`/api/subjects/${SUBJECT}/distribution`, { headers: { authorization: `Bearer ${SESSION.accessToken}` }, anonymous: true });
  assert.equal(api.status, 200); assert.equal((await api.json() as { destination: { label: string } }).destination.label, "Protocol destination");
});


test("public brain route is anonymous, read-only, uncached and unavailable without the shared adapter", async () => {
  const h = harness();
  const response = await h.send(`/leaf/${SUBJECT}/search.json?q=contract`, { anonymous: true });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: "not-found" });
  assert.equal(h.calls.includes("getUser"), false);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const head = await h.send(`/leaf/${SUBJECT}/search.json?q=contract`, { method: "HEAD", anonymous: true });
  assert.equal(head.status, 404); assert.equal(await head.text(), "");
  const write = await h.send(`/leaf/${SUBJECT}/search.json?q=contract`, { method: "POST", anonymous: true });
  assert.equal(write.status, 405); assert.equal(write.headers.get("allow"), "GET, HEAD");
});

test("public search transport shares publication authority and never falls back after withdrawal", async () => {
  let searches = 0;
  const h = harness({ searchPublished: () => { searches++; return []; } });
  const { fields } = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const before = h.calls.length;
  const response = await h.send(`/leaf/${SUBJECT}/search.json?q=contract`, { anonymous: true });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { results: unknown }).results, []);
  assert.deepEqual(h.calls.slice(before), ["readPublic", "readPublic"]);
  const workspace = await h.send(`/manage/${SUBJECT}`), withdraw = savedFields(await workspace.text());
  assert.equal((await h.send(`/manage/${SUBJECT}/withdraw`, { fields: withdraw })).status, 303);
  assert.equal((await h.send(`/leaf/${SUBJECT}/search.json?q=contract`, { anonymous: true })).status, 404);
  assert.equal(searches, 1);
  const disabled = harness(), review = await disabled.review();
  await disabled.send(`/manage/${SUBJECT}/publish`, { fields: review.fields });
  assert.equal((await disabled.send(`/leaf/${SUBJECT}/search.json?q=contract`, { anonymous: true })).status, 503);
});

test("the hosted entry uses shared search over only the published artifact", async () => {
  const h = harness({ searchPublished });
  const { fields } = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const page = await h.send(`/leaf/${SUBJECT}`, { anonymous: true });
  assert.match(await page.text(), new RegExp(`rel="service"[^>]+href="/leaf/${SUBJECT}/mcp"`));
  const mcp = await h.send(`/leaf/${SUBJECT}/mcp`, { method: "POST", anonymous: true,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(mcp.status, 200);
  assert.match(await mcp.text(), /foliage_search_published/);
  const response = await h.send(`/leaf/${SUBJECT}/search.json?q=Synthetic`, { anonymous: true });
  assert.equal(response.status, 200);
  const body = await response.json() as { results: { id: string; title: string; citation: string }[] };
  assert.ok(body.results.some(hit => hit.id === "leaflet:test-input"));
  assert.ok(body.results.every(hit => hit.citation.startsWith(`/leaf/${SUBJECT}`)));
  assert.doesNotMatch(JSON.stringify(body), /score|privateMetadata/);
});


test("résumé formats share publication authority and expose only admitted work", async () => {
  const h = harness(), { fields } = await h.review();
  assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
  const html = await h.send(`/leaf/${SUBJECT}/resume`, { anonymous: true });
  assert.match(html.headers.get("content-security-policy")!, /script-src 'self'; connect-src 'none'/);
  const content = await html.text();
  assert.match(content, /Print \/ Save PDF/);
  assert.match(content, /No achievement statements have been published yet/);
  assert.ok(content.includes(`${ORIGIN}/leaf/${SUBJECT}`));
  assert.match(content, /resume\.json/);
  const portfolio = await (await h.send(`/leaf/${SUBJECT}`, { anonymous: true })).text();
  assert.ok(portfolio.includes(`title="Résumé with evidence links" href="/leaf/${SUBJECT}/resume.json"`));
  for (const suffix of ["", ".md", ".json", ".docx"]) {
    const path = `/leaf/${SUBJECT}/resume${suffix}`;
    const response = await h.send(path, { anonymous: true });
    assert.equal(response.status, 200);
    if (suffix === ".docx") {
      assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      assert.equal(response.headers.get("content-disposition"), `attachment; filename="${SUBJECT}-resume.docx"`);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString(), "PK");
    } else assert.doesNotMatch(await response.text(), /documentDigest|policyDigest|test-access/);
    const head = await h.send(path, { method: "HEAD", anonymous: true });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
  const data = await (await h.send(`/leaf/${SUBJECT}/resume.json`, { anonymous: true })).json() as { subject: { id: string }; achievements: unknown[] };
  assert.equal(data.subject.id, SUBJECT); assert.deepEqual(data.achievements, []);
  const withdraw = savedFields(await (await h.send(`/manage/${SUBJECT}`)).text());
  assert.equal((await h.send(`/manage/${SUBJECT}/withdraw`, { fields: withdraw })).status, 303);
  for (const suffix of ["", ".md", ".json", ".docx"]) for (const method of ["GET", "HEAD"]) {
    assert.equal((await h.send(`/leaf/${SUBJECT}/resume${suffix}`, { method, anonymous: true })).status, 404);
  }
});


test("Word download rechecks authority after generation and never returns obsolete bytes", async () => {
  for (const change of ["withdraw", "replace", "unavailable"] as const) {
    const h = harness(), { fields } = await h.review();
    assert.equal((await h.send(`/manage/${SUBJECT}/publish`, { fields })).status, 303);
    const read = h.store.readPublic.bind(h.store); let reads = 0;
    h.store.readPublic = async id => {
      const current = await read(id);
      if (++reads !== 2) return current;
      if (change === "withdraw") return null;
      if (change === "unavailable") throw new HostedStoreError("unavailable", "Publication authority unavailable.");
      return current ? { ...current, generation: current.generation + 1 } : null;
    };
    const response = await h.send(`/leaf/${SUBJECT}/resume.docx`, { anonymous: true });
    assert.equal(response.status, change === "withdraw" ? 404 : change === "replace" ? 409 : 503);
    assert.notEqual(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.doesNotMatch(await response.text(), /Word layout input|Synthetic HTTP subject/);
  }
});

test("ATS account setup is separate from personal sharing, binds review actor and checks provider state on return", async () => {
  const calls: unknown[] = [];
  let unavailable = false;
  const h = harness({ recruitingConnections: { label: "Merge", async list(actor) { calls.push(["list", actor.id]); if (unavailable) throw new Error("private diagnostic"); return []; }, async connect(actor, input) { calls.push(["connect", actor.id, input]); return "https://link.merge.dev/protocol-test"; } } });
  await h.send("/manage"); assert.deepEqual(calls, []);
  const page = await h.send("/recruiting/accounts");
  const html = await page.text(); assert.match(html, /No ATS accounts connected yet/); assert.match(html, /Connect ATS account/);
  assert.match(html, /delivery through this connection is not available yet/);
  const fields = { ...savedFields(html), email: "admin@example.invalid", organization: "Protocol organization" };
  assert.equal((await h.send("/recruiting/accounts/connect", { fields: { ...fields, reviewActorId: FOREIGN.id } })).status, 403);
  assert.equal((await h.send("/recruiting/accounts/connect", { fields: { ...fields, candidateId: "extra" } })).status, 403);
  assert.equal(calls.length, 1);
  assert.equal((await h.send("/recruiting/accounts/connect", { fields, headers: { origin: "https://foreign.invalid" } })).status, 400);
  const result = await h.send("/recruiting/accounts/connect", { fields });
  assert.equal(result.status, 200); const linked = await result.text(); assert.match(linked, /https:\/\/link.merge.dev\/protocol-test/); assert.match(linked, /Check connection status/);
  assert.deepEqual(calls[1], ["connect", ACTOR.id, { email: "admin@example.invalid", organization: "Protocol organization" }]);
  unavailable = true;
  const failed = await (await h.send("/recruiting/accounts")).text();
  assert.match(failed, /status is unavailable/); assert.doesNotMatch(failed, /No ATS accounts|private diagnostic|action="\/recruiting\/accounts\/connect"/);
  assert.equal((await h.send("/recruiting/accounts/connect")).status, 405);
  const signedOut = await h.send("/recruiting/accounts", { anonymous: true });
  assert.equal(signedOut.status, 303); assert.match(signedOut.headers.get("location")!, /returnTo=%2Frecruiting%2Faccounts/);
});
test("ATS accounts shows escaped connection metadata and an honest unconfigured state", async () => {
  const h = harness({ recruitingConnections: { label: "Merge", async connect() { throw new Error("not used"); }, async list() { return [{ id: "protocol", integration: "<script>protocol</script>", organization: "Protocol & organization", state: "reconnect" }]; } } });
  const html = await (await h.send("/recruiting/accounts")).text();
  assert.match(html, /&lt;script&gt;protocol&lt;\/script&gt;/); assert.match(html, /Protocol &amp; organization/); assert.match(html, /Reconnect needed/);
  const disabled = await harness().send("/recruiting/accounts"); assert.equal(disabled.status, 503); assert.match(await disabled.text(), /not configured here yet/);
});


test("agent access describes only current public interfaces and ends on withdrawal", async () => {
  const h = harness({ searchPublished });
  const route = `/leaf/${SUBJECT}/agent.json`;
  assert.equal((await h.send(route, { anonymous: true })).status, 404);
  const { fields } = await h.review();
  await h.send(`/manage/${SUBJECT}/publish`, { fields });
  const page = await h.send(`/leaf/${SUBJECT}`, { anonymous: true });
  assert.match(await page.text(), /title="Agent access"/);
  const response = await h.send(route, { anonymous: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const descriptor = await response.json() as { scope: string; links: { mcp: string; resumeJson: string } };
  assert.equal(descriptor.scope, "current-publication");
  assert.equal(descriptor.links.mcp, `/leaf/${SUBJECT}/mcp`);
  assert.equal(descriptor.links.resumeJson, `/leaf/${SUBJECT}/resume.json`);
  assert.equal((await h.send(route, { anonymous: true, method: "POST" })).status, 405);
  const head = await h.send(route, { anonymous: true, method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  const workspace = await h.send(`/manage/${SUBJECT}`);
  await h.send(`/manage/${SUBJECT}/withdraw`, { fields: savedFields(await workspace.text()) });
  assert.equal((await h.send(route, { anonymous: true })).status, 404);
  const disabled = harness(), review = await disabled.review();
  await disabled.send(`/manage/${SUBJECT}/publish`, { fields: review.fields });
  const withoutSearch = await disabled.send(route, { anonymous: true });
  assert.doesNotMatch(await withoutSearch.text(), /"mcp"|"search"/);
});
