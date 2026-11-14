/** HTTP session bridge. Browser requests retain cookie transport and existing CSRF gates. */
import type { createClerkIdentity } from "./clerkIdentity.ts";
import { HOSTED_COOKIES, HOSTED_PRIVATE_PATH, safeHostedReturnTo } from "./hostedIdentity.ts";
import { publicHeaders } from "./publicHeaders.mjs";
import { esc } from "./renderPublished.ts";
import { photosynthesisBrowserScript } from "./photosynthesisBrowser.ts";
import { clerkBrowserScript } from "./clerkBrowser.ts";
import { logRequestFailure } from "./requestFailure.mjs";

export function withClerk(config: {
  appOrigin: string; identity: ReturnType<typeof createClerkIdentity>;
  app: (request: Request) => Promise<Response>;
}) {
  const { identity } = config;
  const headers = () => new Headers({ ...publicHeaders({ form: true }), "cache-control": "private, no-store", "content-type": "text/html; charset=utf-8" });
  const fail = (status: number, message: string) => new Response(message, { status, headers: headers() });
  // Provider failures are logged once and keep the same refusal, with a reference to quote.
  const failed = (request: Request, message: string, error: unknown) => {
    const reference = logRequestFailure({ layer: "session", method: request.method, target: request.url, status: 503, error });
    const response = fail(503, `${message} Reference: ${reference}.`);
    response.headers.set("x-request-id", reference);
    return response;
  };
  const enhance = (response: Response, returnTo = "/manage", signedOut = false, signedIn = false) => {
    const next = new Headers(response.headers);
    // Only private HTML gets provider egress. Public pages retain their original strict policy.
    // worker-src is Clerk's documented need for its blob: timer worker; script-src stays unchanged.
    next.set("content-security-policy", `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' ${identity.issuer} https://challenges.cloudflare.com; worker-src 'self' blob:; connect-src 'self' http://127.0.0.1:4180 ${identity.issuer} https://challenges.cloudflare.com; img-src 'self' ${identity.issuer} https://img.clerk.com data:; frame-src ${identity.issuer} https://challenges.cloudflare.com`);
    // Chromium serializes a form POST Origin as null under no-referrer. Keep the
    // exact-origin CSRF gate; send referrers only within this private application.
    next.set("referrer-policy", "same-origin");
    const localReturn = next.get("x-foliage-local-return");
    next.delete("x-foliage-local-return");
    if (localReturn && /^http:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]+$/.test(localReturn)) next.set("content-security-policy", next.get("content-security-policy")!.replace("form-action 'self'", `form-action 'self' ${localReturn}`));
    next.delete("content-length");
    return response.text().then(html => new Response((signedIn ? html.replace('<nav aria-label="Account">', '<nav aria-label="Account"><div id="clerk-user" aria-label="Your account"></div><span id="account-status" role="status"></span>') : html).replace("</head>", `<meta name="foliage-clerk" content="${esc(identity.publishableKey)}" data-issuer="${esc(identity.issuer)}" data-return-to="${esc(returnTo)}" data-signed-out="${signedOut}"><script defer src="/auth/clerk.js"></script></head>`), { status: response.status, headers: next }));
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== config.appOrigin || request.headers.has("host") && request.headers.get("host") !== url.host) return fail(421, "This hostname is not configured for this application.");
    if (url.pathname === "/auth/photosynthesis.js" && request.method === "GET") return new Response(photosynthesisBrowserScript, { headers: { ...publicHeaders(), "content-type": "text/javascript", "cache-control": "private, no-store" } });
    if (url.pathname === "/auth/device-return.js" && request.method === "GET") return new Response("document.getElementById('device-return')?.requestSubmit();", { headers: { ...publicHeaders(), "content-type": "text/javascript", "cache-control": "private, no-store" } });
    if (url.pathname === "/auth/clerk.js" && ["GET", "HEAD"].includes(request.method)) return new Response(request.method === "HEAD" ? null : clerkBrowserScript, { headers: { ...publicHeaders(), "content-type": "text/javascript", "cache-control": "private, no-store" } });
    const privatePage = HOSTED_PRIVATE_PATH.test(url.pathname);
    // Public reads/assets and explicit bearer-only device requests go straight to their gates.
    if (!privatePage) return config.app(request);
    if (!["GET", "HEAD", "POST"].includes(request.method)) return fail(405, "Use the current page to choose an action.");
    if (request.headers.has("authorization")) return fail(400, "Browser pages use Clerk cookies. Use the device API for bearer credentials.");
    const signIn = ["/auth/sign-in", "/auth/sign-up", "/auth/callback", "/auth/recovery", "/auth/password", "/auth/refresh"].includes(url.pathname);
    if (signIn && request.method === "POST") return fail(400, "Use Clerk sign-in. No password or legacy refresh action was performed.");
    let state;
    try { state = await identity.authenticateRequest(request); }
    catch (error) { return failed(request, "Account verification is unavailable. Reload to try again; no action has been replayed.", error); }
    if (state.status === "handshake" && request.method !== "POST") {
      const location = state.headers.get("location");
      if (!location) return fail(503, "Account verification could not complete.");
      const destination = new URL(location, config.appOrigin);
      if (![identity.issuer, config.appOrigin].includes(destination.origin)) return fail(503, "Account redirect was refused.");
      const next = headers(); next.set("location", destination.href);
      for (const cookie of state.headers.getSetCookie()) next.append("set-cookie", cookie);
      return new Response(null, { status: 303, headers: next });
    }
    let returnTo = safeHostedReturnTo(url.searchParams.get("returnTo"));
    if (!/^\/(manage|operations|settings|distribution|recruiting)(\/|\?|#|$)/.test(returnTo)) returnTo = "/manage";
    if (signIn) {
      if (state.status === "signed-in") {
        try { await identity.getUser(state.token); }
        catch (error) { return failed(request, "This account could not be verified. No portfolio action was completed.", error); }
        return new Response(null, { status: 303, headers: { ...publicHeaders(), "cache-control": "no-store", location: returnTo } });
      }
      const recruiting = /^\/recruiting(?:\/|\?|$)/.test(returnTo);
      const page = `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/foliage-tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/workspace-shell.css"><link rel="stylesheet" href="/hosted-workspace.css"></head><body class="hosted-account"><main><a class="hosted-brand" href="${recruiting ? "/recruiting" : "/manage"}"><span class="fol-workspace-mark" aria-hidden="true"></span>Foliage</a><h1>${recruiting ? "Sign in to recruiting." : "Sign in."}</h1><p id="account-status" role="status">Connecting your account…</p><div id="clerk-account"></div><noscript>Enable JavaScript to sign in.</noscript></main></body></html>`;
      const response = await enhance(new Response(page, { headers: headers() }), returnTo);
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    // Strip old/external legacy cookies. Only a token verified by Clerk may cross this bridge.
    const bridged = new Headers(request.headers);
    const cookies = (bridged.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value && ![HOSTED_COOKIES.access, HOSTED_COOKIES.refresh, HOSTED_COOKIES.flow].includes(value.split("=")[0] as typeof HOSTED_COOKIES.access));
    if (state.status === "signed-in") cookies.push(`${HOSTED_COOKIES.access}=${encodeURIComponent(state.token)}`);
    bridged.set("cookie", cookies.join("; "));
    const response = await config.app(new Request(request, { headers: bridged }));
    for (const cookie of state.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    if (url.pathname === "/auth/sign-out" && request.method === "POST" && response.status === 303) {
      // The router has checked CSRF and revoked the session. Let Clerk clear its own
      // browser/client cookies before navigating, instead of sending a stale JWT back.
      const signedOutHeaders = new Headers(response.headers);
      signedOutHeaders.set("content-type", "text/html; charset=utf-8"); signedOutHeaders.delete("location");
      return enhance(new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed out · Foliage</title></head><body><p id="account-status" role="status">Finishing sign-out…</p><noscript>Session revoked. Enable JavaScript to finish sign-out.</noscript></body></html>', { headers: signedOutHeaders }), "/manage", true);
    }
    if (request.method !== "HEAD" && response.headers.get("content-type")?.startsWith("text/html")) return enhance(response, "/manage", false, state.status === "signed-in");
    return response;
  };
}
