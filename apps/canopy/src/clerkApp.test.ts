/** HTTP protocol harness: no live users or publication data are created. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { withClerk } from "./clerkApp.ts";
import { createClerkIdentity } from "./clerkIdentity.ts";
import { createHostedApp } from "./hostedApp.ts";
import { HOSTED_COOKIES } from "./hostedIdentity.ts";
import type { HostedStore } from "./hostedStore.ts";
const origin = "https://canopy-harness.example", issuer = "https://clerk-harness.example";
function harness() {
  let signedIn = false, handshaking = false, broken = false, reservations = 0, verified = 0, signedOut = 0, grants = 0, sessionReads = 0;
  const identity = createClerkIdentity({ appOrigin: origin, publishableKey: `pk_test_${Buffer.from(new URL(issuer).host + "$").toString("base64")}`, secretKey: "sk_test_harness", supabaseUrl: "https://storage-harness.example", serviceRoleKey: "unused-harness" });
  const provider = { ...identity,
    authenticateRequest: async () => { sessionReads++; if (broken) throw new Error("synthetic provider fault eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl"); return { status: handshaking ? "handshake" : signedIn ? "signed-in" : "signed-out", token: signedIn ? "verified-harness-session" : null, headers: new Headers(handshaking ? { location: `${issuer}/v1/client/handshake` } : {}) } as unknown as Awaited<ReturnType<typeof identity.authenticateRequest>>; },
    signOut: async () => { signedOut++; },
    createDeviceGrant: async (token: string, challenge: string) => { assert.equal(token, "verified-harness-session"); assert.match(challenge, /^[A-Za-z0-9_-]{43}$/); grants++; return "fd1.synthetic.signature"; },
    getUser: async (token: string) => { assert.equal(token, "verified-harness-session"); verified++; return { id: "11111111-1111-4111-8111-111111111111" }; },
  };
  const store = { ping: async () => {}, listOwned: async () => [], readPublic: async () => null,
    reserveSubject: async () => { reservations++; return { subjectId: "harness-only" }; } } as unknown as HostedStore;
  const app = withClerk({ appOrigin: origin, identity: provider, app: createHostedApp({ clerk: true, device: provider, appOrigin: origin, identity: provider, store }) });
  return { app, signIn: () => { signedIn = true; }, handshake: () => { handshaking = true; }, breakSession: () => { broken = true; }, counts: () => ({ reservations, verified, signedOut, grants, sessionReads }) };
}
test("Clerk sign-in replaces passwords, reuses active sessions and confines provider scripts to private HTML", async () => {
  const h = harness();
  const response = await h.app(new Request(`${origin}/auth/sign-in?returnTo=//evil.example`));
  const html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /clerk-account/); assert.doesNotMatch(html, /type="password"/);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.match(html, /data-return-to="\/manage"/); assert.match(response.headers.get("content-security-policy")!, /clerk-harness/);
  const publicPage = await h.app(new Request(`${origin}/leaf/not-published`));
  assert.equal(publicPage.headers.get("referrer-policy"), "no-referrer");
  assert.equal(publicPage.status, 404); assert.doesNotMatch(publicPage.headers.get("content-security-policy")!, /clerk|unsafe-inline/); assert.doesNotMatch(await publicPage.text(), /clerk/);
  h.signIn();
  const automatic = await h.app(new Request(`${origin}/auth/sign-in?returnTo=%2Fmanage%2Fexisting`));
  assert.equal(automatic.status, 303); assert.equal(automatic.headers.get("location"), "/manage/existing"); assert.equal(h.counts().verified, 1);
  const workspace = await h.app(new Request(`${origin}/manage`, { headers: { cookie: `${HOSTED_COOKIES.access}=forged-legacy-token` } }));
  assert.equal(workspace.status, 200);
  const workspaceHtml = await workspace.text();
  assert.match(workspaceHtml, /Your portfolio/);
  assert.match(workspaceHtml, /id="clerk-user"/);
  assert.match(workspaceHtml, /action="\/auth\/sign-out"/);
});
test("Clerk cookie bridge preserves exact origin and CSRF; browser bearer transport is rejected", async () => {
  const h = harness(); h.signIn();
  const page = await h.app(new Request(`${origin}/manage`));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())![1]!;
  const cookie = page.headers.getSetCookie().find(value => value.startsWith(HOSTED_COOKIES.csrf))!.split(";")[0]!;
  const body = new URLSearchParams({ csrf, subjectId: "harness-only" });
  for (const headers of [{ cookie }, { cookie, origin: "https://foreign.example" }, { origin, cookie, authorization: "Bearer caller-chosen" }]) {
    const denied = await h.app(new Request(`${origin}/manage`, { method: "POST", headers, body }));
    assert.equal(denied.status, 400);
  }
  assert.equal(h.counts().reservations, 0);
  const valid = await h.app(new Request(`${origin}/manage`, { method: "POST", headers: { origin, cookie }, body }));
  assert.equal(valid.status, 303); assert.equal(h.counts().reservations, 1);
});
test("handshakes never replay mutations and disabled password APIs cannot create sessions", async () => {
  const h = harness(); h.handshake();
  const handshake = await h.app(new Request(`${origin}/manage`));
  assert.equal(handshake.status, 303); assert.equal(handshake.headers.get("location"), `${issuer}/v1/client/handshake`);
  const post = await h.app(new Request(`${origin}/manage`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "document=retained-harness" }));
  assert.equal(post.status, 401); assert.equal(post.headers.has("location"), false); assert.equal(h.counts().reservations, 0);
  const legacy = await h.app(new Request(`${origin}/api/session`, { method: "POST", body: new URLSearchParams({ email: "harness@example.test", password: "unused" }) }));
  assert.equal(legacy.status, 400); assert.match(await legacy.text(), /Clerk/);
  const password = await h.app(new Request(`${origin}/auth/sign-in`, { method: "POST" }));
  assert.equal(password.status, 400);
});

test("sign-out requires CSRF and lets Clerk finish browser cleanup only after server revocation", async () => {
  const h = harness(); h.signIn();
  assert.equal((await h.app(new Request(`${origin}/auth/sign-out`))).status, 405);
  const page = await h.app(new Request(`${origin}/manage`));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())![1]!;
  const cookie = page.headers.getSetCookie().find(value => value.startsWith(HOSTED_COOKIES.csrf))!.split(";")[0]!;
  const body = new URLSearchParams({ csrf });
  const denied = await h.app(new Request(`${origin}/auth/sign-out`, { method: "POST", headers: { origin: "null", cookie }, body }));
  assert.equal(denied.status, 400); assert.equal(h.counts().signedOut, 0);
  const result = await h.app(new Request(`${origin}/auth/sign-out`, { method: "POST", headers: { origin, cookie }, body }));
  assert.equal(result.status, 200); assert.equal(h.counts().signedOut, 1);
  assert.match(result.headers.get("content-type")!, /text\/html/); assert.equal(result.headers.has("location"), false);
  assert.match(await result.text(), /data-signed-out="true"/);
});


test("connecting a device requires signed-in same-origin consent and limits its return to loopback", async () => {
  const h = harness(); h.signIn();
  const values = new URLSearchParams({ challenge: "a".repeat(43), state: "b".repeat(43), callback: "http://127.0.0.1:4180/hosted/callback" });
  const page = await h.app(new Request(`${origin}/manage/device/connect?${values}`));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Connect this device/); assert.equal(h.counts().grants, 0);
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
  const cookie = page.headers.getSetCookie().find(v => v.startsWith(HOSTED_COOKIES.csrf))!.split(";")[0]!;
  values.set("csrf", csrf);
  const denied = await h.app(new Request(`${origin}/manage/device/connect`, { method: "POST", headers: { cookie, origin: "https://other.example" }, body: values }));
  assert.equal(denied.status, 400); assert.equal(h.counts().grants, 0);
  const approved = await h.app(new Request(`${origin}/manage/device/connect`, { method: "POST", headers: { cookie, origin }, body: values }));
  assert.equal(approved.status, 200); assert.equal(h.counts().grants, 1);
  assert.match(approved.headers.get("content-security-policy")!, /form-action 'self' http:\/\/127\.0\.0\.1:4180/);
  assert.equal(approved.headers.has("x-foliage-local-return"), false);
  assert.match(await approved.text(), /id="device-return"/);
  values.set("callback", "https://other.example/hosted/callback");
  const foreign = await h.app(new Request(`${origin}/manage/device/connect`, { method: "POST", headers: { cookie, origin }, body: values }));
  assert.notEqual(foreign.status, 200); assert.equal(h.counts().grants, 1);
});

test("distribution receipts use the Clerk bridge and retain their sign-in return path", async () => {
  const h = harness(); h.signIn();
  const receipt = "/distribution/11111111-1111-4111-8111-111111111111";
  const response = await h.app(new Request(origin + receipt, { headers: { cookie: `${HOSTED_COOKIES.access}=forged-legacy-token` } }));
  assert.equal(response.status, 503); // Session is valid; this harness has no destination configured.
  assert.equal(h.counts().verified, 1);
  assert.match(await response.text(), /clerk-user/);
  const denied = await h.app(new Request(origin + receipt, { headers: { authorization: "Bearer browser-input" } }));
  assert.equal(denied.status, 400);
  const login = await h.app(new Request(`${origin}/auth/sign-in?returnTo=${encodeURIComponent(receipt)}`));
  assert.equal(login.headers.get("location"), receipt);
});


test("dedicated recruiting routes use Clerk and preserve their workspace through sign-in", async () => {
  const h = harness();
  const path = "/recruiting/portfolios/contract-input";
  const login = await h.app(new Request(`${origin}/auth/sign-in?returnTo=${encodeURIComponent(path)}`));
  const html = await login.text();
  assert.match(html, /Sign in to recruiting/);
  assert.doesNotMatch(html, /<h1>Sign in\.<\/h1>|Photosynthesis/);
  assert.match(html, /data-return-to="\/recruiting\/portfolios\/contract-input"/);
  h.signIn();
  const home = await h.app(new Request(origin + "/recruiting"));
  assert.equal(home.status, 200); assert.match(await home.text(), /clerk-user/);
  assert.equal(h.counts().verified, 1);
  assert.equal((await h.app(new Request(origin + "/recruiting", { headers: { authorization: "Bearer untrusted" } }))).status, 400);
  const resumed = await h.app(new Request(`${origin}/auth/sign-in?returnTo=${encodeURIComponent(path)}`));
  assert.equal(resumed.headers.get("location"), path);
});

test("private pages allow Clerk's blob: worker without widening script sources", async () => {
  const page = await harness().app(new Request(`${origin}/auth/sign-in`));
  const directives = new Map(page.headers.get("content-security-policy")!.split(";").map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name!, values]));
  assert.deepEqual(directives.get("worker-src"), ["'self'", "blob:"]);
  assert.deepEqual(directives.get("script-src"), ["'self'", issuer, "https://challenges.cloudflare.com"]);
  const publicPage = await harness().app(new Request(`${origin}/leaf/not-published`));
  assert.doesNotMatch(publicPage.headers.get("content-security-policy")!, /worker-src|blob:/);
});

test("public addresses skip the session bridge, and a session provider failure is logged with its reference", async t => {
  const h = harness();
  for (const [path, status] of [["/healthz", 200], ["/robots.txt", 200], ["/does-not-exist", 404], ["/favicon.ico", 404]] as const) {
    const response = await h.app(new Request(origin + path));
    assert.equal(response.status, status, path); assert.equal(response.headers.has("location"), false, path);
  }
  assert.equal(h.counts().sessionReads, 0, "no public address reads a session");
  const logged = t.mock.method(console, "error", () => {});
  h.breakSession();
  const failed = await h.app(new Request(`${origin}/manage?returnTo=query-canary`, { headers: { cookie: "__session=cookie-canary" } }));
  const lines = logged.mock.calls.map(call => String(call.arguments[0])).filter(line => line.startsWith('{"event":"canopy.hosted.request_failed"'));
  assert.equal(failed.status, 503); assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]!) as { requestId: string; layer: string; route: string };
  assert.equal(line.layer, "session"); assert.equal(line.route, "/manage");
  assert.equal(await failed.text(), `Account verification is unavailable. Reload to try again; no action has been replayed. Reference: ${line.requestId}.`);
  assert.equal(failed.headers.get("x-request-id"), line.requestId);
  for (const canary of ["query-canary", "cookie-canary", "eyJ"]) assert.equal(lines[0]!.includes(canary), false, canary);
});
