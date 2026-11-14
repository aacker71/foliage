/** Synthetic protocol inputs only. These tests make no real account/provider or delivery claim. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOSTED_COOKIES, HostedIdentityError, assertHostedMutation, createHostedIdentity,
  createPkceVerifier, hostedAccessToken, hostedCookie, pkceChallenge, readHostedCookie, safeHostedReturnTo,
} from "./hostedIdentity.ts";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_ID = "00000000-0000-4000-8000-000000000002";
const CONFIG = { supabaseUrl: "https://auth-harness.invalid", publishableKey: "test-only-public-key", appOrigin: "https://app-harness.invalid" };
const user = () => ({ id: ACTOR_ID, aud: "authenticated", role: "authenticated", is_anonymous: false });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const rejects = (code: HostedIdentityError["code"]) => (error: unknown) => error instanceof HostedIdentityError && error.code === code;
function provider(answer: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, CONFIG.supabaseUrl);
    assert.equal(init?.redirect, "error");
    assert.equal((init as RequestInit & { cache?: string })?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("apikey"), CONFIG.publishableKey);
    requests.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  };
  return { identity: createHostedIdentity({ ...CONFIG, fetch: fetcher }), requests };
}
const session = () => ({ access_token: "test-only-access", refresh_token: "test-only-refresh", expires_in: 3600,
  user: { ...user(), id: FOREIGN_ID, user_metadata: { owner: FOREIGN_ID, role: "policy_owner" } } });

test("get-user supplies the actor each time; token claims and user metadata supply no authority", async () => {
  const { identity, requests } = provider((url, init) => {
    assert.equal(url.pathname, "/auth/v1/user");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer forged-claims-are-not-decoded");
    return response({ ...user(), user_metadata: { subjectId: "foreign-subject", tenant: "other-company", role: "policy_owner" } });
  });
  for (let i = 0; i < 2; i++) assert.deepEqual(await identity.getUser("forged-claims-are-not-decoded"), { id: ACTOR_ID });
  assert.equal(requests.length, 2, "no positive identity cache");
});

test("forged/expired credentials and non-person roles cannot establish an actor", async () => {
  for (const status of [400, 401, 403, 422]) {
    const { identity } = provider(() => response({ message: "test-only secret provider error" }, status));
    await assert.rejects(identity.getUser("test-only-expired"), rejects("unauthenticated"));
  }
  for (const value of [null, {}, { ...user(), id: "not-a-uuid" }, { ...user(), aud: "service_role" },
    { ...user(), role: "service_role" }, { ...user(), is_anonymous: true }]) {
    const { identity } = provider(() => response(value));
    await assert.rejects(identity.getUser("test-only-token"), rejects("unauthenticated"));
  }
  const { identity, requests } = provider(() => assert.fail("invalid credentials must not be sent"));
  for (const value of ["", "has spaces", "line\r\nbreak", "a".repeat(8193)]) await assert.rejects(identity.getUser(value), rejects("unauthenticated"));
  assert.equal(requests.length, 0);
});

test("provider redirects, malformed/oversized bodies and outages fail closed without exposing details", async () => {
  for (const answer of [
    () => response({ details: "test-only private detail" }, 503),
    () => response({}, 429),
    () => new Response(null, { status: 307, headers: { location: "https://foreign-harness.invalid/steal" } }),
    () => new Response("not JSON: test-only-private"),
    () => new Response(JSON.stringify({ huge: "x".repeat(64 * 1024) })),
    () => { throw new Error("test-only-access https://secret-harness.invalid?credential=private"); },
  ]) {
    const { identity, requests } = provider(answer);
    await assert.rejects(identity.getUser("test-only-access"), error => {
      assert.ok(rejects("unavailable")(error));
      assert.doesNotMatch(String(error), /test-only|secret-harness|credential=/);
      return true;
    });
    assert.equal(requests.length, 1, "no follow-up to a redirect or blind request retry");
  }
});

test("sign-in and refresh verify the returned access token instead of trusting the embedded session user", async () => {
  const { identity, requests } = provider((url, init) => {
    if (url.pathname.endsWith("/user")) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only-access");
      return response(user());
    }
    assert.equal(init.method, "POST");
    return response(session());
  });
  const signedIn = await identity.signIn("protocol-test@example.invalid", "test-only-password");
  assert.deepEqual(signedIn, { actor: { id: ACTOR_ID }, accessToken: "test-only-access", refreshToken: "test-only-refresh", expiresIn: 3600 });
  assert.equal(requests[0]?.url.searchParams.get("grant_type"), "password");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { email: "protocol-test@example.invalid", password: "test-only-password" });
  await identity.refreshSession("test-only-old-refresh");
  assert.equal(requests[2]?.url.searchParams.get("grant_type"), "refresh_token");
  assert.deepEqual(JSON.parse(String(requests[2]?.init.body)), { refresh_token: "test-only-old-refresh" });
  assert.equal(requests.length, 4);
});

test("bad session responses or a rejected new access token cannot issue a usable session", async () => {
  for (const value of [null, {}, { ...session(), expires_in: 0 }, { ...session(), expires_in: 86401 },
    { ...session(), refresh_token: null }, { ...session(), access_token: "contains whitespace" }]) {
    const { identity, requests } = provider(() => response(value));
    await assert.rejects(identity.signIn("protocol-test@example.invalid", "test-only-password"), rejects("unavailable"));
    assert.equal(requests.length, 1);
  }
  const { identity } = provider(url => url.pathname.endsWith("/user") ? response({}, 401) : response(session()));
  await assert.rejects(identity.refreshSession("test-only-refresh"), rejects("unauthenticated"));
});

test("signup and recovery use fixed callback plus PKCE; no account metadata establishes a session", async () => {
  const { identity, requests } = provider(() => response({ id: ACTOR_ID }));
  const challenge = pkceChallenge(createPkceVerifier());
  assert.equal(await identity.signUp("protocol-test@example.invalid", "test-only-password", challenge), null);
  await identity.requestRecovery("protocol-test@example.invalid", challenge);
  for (const { url, init } of requests) {
    assert.equal(url.searchParams.get("redirect_to"), `${CONFIG.appOrigin}/auth/callback`);
    const body = JSON.parse(String(init.body));
    assert.equal(body.code_challenge, challenge);
    assert.equal(body.code_challenge_method, "s256");
    assert.equal(body.email, "protocol-test@example.invalid");
  }
  assert.deepEqual(requests.map(r => r.url.pathname), ["/auth/v1/signup", "/auth/v1/recover"]);
  await assert.rejects(identity.requestRecovery("protocol-test@example.invalid", "weak-challenge"), rejects("invalid-request"));
  assert.equal(requests.length, 2);
});

test("PKCE code exchange sends only its bound verifier; reused/expired codes are provider refusals", async () => {
  const verifier = createPkceVerifier();
  const { identity, requests } = provider(url => url.pathname.endsWith("/user") ? response(user()) : response(session()));
  assert.equal((await identity.exchangeCode("test-only-code", verifier)).actor.id, ACTOR_ID);
  assert.equal(requests[0]?.url.searchParams.get("grant_type"), "pkce");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { auth_code: "test-only-code", code_verifier: verifier });
  const refused = provider(() => response({ message: "expired code" }, 400));
  await assert.rejects(refused.identity.exchangeCode("test-only-code", verifier), rejects("unauthenticated"));
  assert.equal(refused.requests.length, 1);
  await assert.rejects(identity.exchangeCode("test-only-code", "short"), rejects("invalid-request"));
});

test("password change verifies current identity; logout calls provider and does not claim outage success", async () => {
  const { identity, requests } = provider((url, init) => url.pathname.endsWith("/user") ? response(user()) : new Response(null, { status: 204 }));
  await identity.updatePassword("test-only-access", "test-only-new-password");
  assert.deepEqual(requests.map(r => r.init.method), ["GET", "PUT"]);
  assert.deepEqual(JSON.parse(String(requests[1]?.init.body)), { password: "test-only-new-password" });
  await identity.signOut("test-only-access");
  assert.equal(requests[2]?.url.pathname, "/auth/v1/logout");
  assert.equal(requests[2]?.url.searchParams.get("scope"), "local");
  const outage = provider(() => response({}, 503));
  await assert.rejects(outage.identity.signOut("test-only-access"), rejects("unavailable"));
});

test("configured endpoints must be HTTPS origins, never token-controlled redirect destinations", () => {
  for (const url of ["http://auth-harness.invalid", "https://user.invalid:password@auth-harness.invalid", "https://auth-harness.invalid/other", "https://auth-harness.invalid?next=x", "https://auth-harness.invalid#fragment", "invalid"]) {
    assert.throws(() => createHostedIdentity({ ...CONFIG, supabaseUrl: url }), rejects("invalid-request"));
    assert.throws(() => createHostedIdentity({ ...CONFIG, appOrigin: url }), rejects("invalid-request"));
  }
});

test("cookie credentials are host-only, secure, bounded and refuse duplicate or mixed transports", () => {
  const cookie = hostedCookie(HOSTED_COOKIES.access, "test-only-token", 3600);
  assert.match(cookie, /; Path=\/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax$/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(hostedCookie(HOSTED_COOKIES.access, "", 0), /Max-Age=0/);
  const headers = new Headers({ cookie: `${HOSTED_COOKIES.access}=test-only-token` });
  assert.equal(readHostedCookie(headers, HOSTED_COOKIES.access), "test-only-token");
  assert.deepEqual(hostedAccessToken(headers), { token: "test-only-token", transport: "cookie" });
  assert.deepEqual(hostedAccessToken(new Headers({ authorization: "Bearer test-only-token" })), { token: "test-only-token", transport: "bearer" });
  headers.set("authorization", "Bearer test-only-token");
  assert.throws(() => hostedAccessToken(headers), rejects("invalid-request"));
  for (const raw of [`${HOSTED_COOKIES.access}=one; ${HOSTED_COOKIES.access}=two`, `${HOSTED_COOKIES.access}=%broken`]) {
    assert.throws(() => hostedAccessToken(new Headers({ cookie: raw })), rejects("invalid-request"));
  }
  for (const raw of ["Basic dXNlcjpwYXNzd29yZA", "Bearer one, Bearer two", "Bearer "]) {
    assert.throws(() => hostedAccessToken(new Headers({ authorization: raw })), rejects("unauthenticated"));
  }
  assert.throws(() => hostedCookie(HOSTED_COOKIES.access, "x".repeat(3801), 3600), rejects("invalid-request"));
});

test("browser mutations require exact origin, POST and constant-time safe matching CSRF", () => {
  const csrf = createPkceVerifier();
  const headers = new Headers({ origin: CONFIG.appOrigin, cookie: `${HOSTED_COOKIES.csrf}=${csrf}` });
  assert.doesNotThrow(() => assertHostedMutation("POST", headers, csrf, CONFIG.appOrigin));
  for (const method of ["GET", "HEAD", "PUT"]) assert.throws(() => assertHostedMutation(method, headers, csrf, CONFIG.appOrigin), rejects("invalid-request"));
  for (const value of ["", "x".repeat(43), "é".repeat(43)]) assert.throws(() => assertHostedMutation("POST", headers, value, CONFIG.appOrigin), rejects("invalid-request"));
  for (const value of ["null", "https://foreign-harness.invalid", `${CONFIG.appOrigin}.foreign.invalid`]) {
    const foreign = new Headers(headers); foreign.set("origin", value);
    assert.throws(() => assertHostedMutation("POST", foreign, csrf, CONFIG.appOrigin), rejects("invalid-request"));
  }
});

test("return locations keep local review context and reject external or credential-bearing redirects", () => {
  assert.equal(safeHostedReturnTo("/manage?subject=protocol-test#review"), "/manage?subject=protocol-test#review");
  for (const value of [null, "https://foreign-harness.invalid", "//foreign-harness.invalid", "/%2fforeign-harness.invalid", "/\\foreign-harness.invalid", "/%5cforeign-harness.invalid", "/%0aLocation:x", "/manage?access_token=private", "/manage?code=private", "/%broken"]) {
    assert.equal(safeHostedReturnTo(value), "/manage");
  }
  // RFC 7636's published deterministic challenge example is protocol data, not a secret.
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.match(createPkceVerifier(), /^[A-Za-z0-9_-]{43}$/);
});
