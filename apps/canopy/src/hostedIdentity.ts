/**
 * Supabase is the identity authority. Never authorize from a decoded JWT, session payload,
 * user_metadata, email address or payer record. Call getUser for every protected request.
 * Routes own rate limits, one-use PKCE cookies, recovery-only screens and durable ownership.
 * No provider call here is retried automatically: a lost token-exchange response is uncertain.
 * Protocol: Supabase's auth-getuser reference and auth-js/GoTrueClient.ts.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface HostedActor { readonly id: string }
export interface HostedSession {
  readonly actor: HostedActor;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}
export class HostedIdentityError extends Error {
  readonly code: "invalid-request" | "unauthenticated" | "unavailable";
  constructor(code: HostedIdentityError["code"], message: string) { super(message); this.code = code; }
}
const invalid = (message: string): never => { throw new HostedIdentityError("invalid-request", message); };
const unavailable = (): never => { throw new HostedIdentityError("unavailable", "Account service is unavailable; no identity or completed account action was established. Retry through the account recovery flow."); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const token = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._~-]{1,8192}$/.test(v);
function origin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid("A configured HTTPS origin is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return invalid("A configured HTTPS origin is required.");
  return url.origin;
}
function credentials(email: string, password?: string): void {
  if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("Enter an email address.");
  if (password !== undefined && (typeof password !== "string" || password.length < 1 || Buffer.byteLength(password) > 1024)) invalid("Enter a password within the supported size.");
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); return unavailable(); }
      chunks.push(value);
    }
    return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown : null;
  } finally { reader.releaseLock(); }
}

export function createHostedIdentity(config: {
  supabaseUrl: string; publishableKey: string; appOrigin: string; fetch?: typeof fetch;
}) {
  const base = `${origin(config.supabaseUrl)}/auth/v1`;
  const callback = `${origin(config.appOrigin)}/auth/callback`;
  if (!token(config.publishableKey)) invalid("Configure a Supabase publishable or anonymous key.");
  const request = async (path: string, method: string, body?: unknown, accessToken?: string): Promise<unknown> => {
    if (accessToken !== undefined && !token(accessToken)) throw new HostedIdentityError("unauthenticated", "Sign in again.");
    try {
      // Node's fetch type omits cache; the native/hosted fetch implementations accept it.
      const init: RequestInit & { cache: "no-store" } = {
        method, headers: { apikey: config.publishableKey, "Content-Type": "application/json",
          ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      };
      const response = await (config.fetch ?? fetch)(`${base}${path}`, init);
      if ([400, 401, 403, 422].includes(response.status)) {
        await response.body?.cancel();
        throw new HostedIdentityError("unauthenticated", "The account request was not accepted. Check your details or restart sign-in/recovery.");
      }
      if (!response.ok) { await response.body?.cancel(); return unavailable(); }
      return await responseJson(response);
    } catch (error) {
      if (error instanceof HostedIdentityError) throw error;
      // Provider bodies and fetch errors may contain account details or credentials.
      return unavailable();
    }
  };
  const getVerifiedUser = async (accessToken: string): Promise<Record<string, unknown>> => {
    if (!token(accessToken)) throw new HostedIdentityError("unauthenticated", "Sign in again.");
    const user = await request("/user", "GET", undefined, accessToken);
    if (!object(user) || typeof user["id"] !== "string" || !UUID.test(user["id"]) ||
        user["aud"] !== "authenticated" || user["role"] !== "authenticated" || user["is_anonymous"] === true) {
      throw new HostedIdentityError("unauthenticated", "A signed-in personal account is required.");
    }
    return Object.freeze(user);
  };
  const getUser = async (accessToken: string): Promise<HostedActor> =>
    Object.freeze({ id: (await getVerifiedUser(accessToken))["id"] as string });
  const session = async (value: unknown): Promise<HostedSession> => {
    if (!object(value) || !token(value["access_token"]) || !token(value["refresh_token"]) ||
        !Number.isSafeInteger(value["expires_in"]) || Number(value["expires_in"]) <= 0 || Number(value["expires_in"]) > 86400) return unavailable();
    return { actor: await getUser(value["access_token"]), accessToken: value["access_token"],
      refreshToken: value["refresh_token"], expiresIn: Number(value["expires_in"]) };
  };
  const challenge = (value: string): string => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return invalid("Start a new account confirmation flow.");
    return value;
  };
  return {
    getUser,
    getVerifiedUser,
    async signIn(email: string, password: string): Promise<HostedSession> {
      credentials(email, password);
      return session(await request("/token?grant_type=password", "POST", { email, password }));
    },
    async signUp(email: string, password: string, codeChallenge: string): Promise<HostedSession | null> {
      credentials(email, password);
      const result = await request(`/signup?redirect_to=${encodeURIComponent(callback)}`, "POST", {
        email, password, code_challenge: challenge(codeChallenge), code_challenge_method: "s256",
      });
      // Confirmation-required (and intentionally indistinguishable existing-account) responses
      // establish no session. The route shows the same generic confirmation message.
      if (object(result) && result["access_token"] === undefined && typeof result["id"] === "string") return null;
      return session(result);
    },
    async refreshSession(refreshToken: string): Promise<HostedSession> {
      if (!token(refreshToken)) return invalid("Sign in again.");
      return session(await request("/token?grant_type=refresh_token", "POST", { refresh_token: refreshToken }));
    },
    async exchangeCode(code: string, verifier: string): Promise<HostedSession> {
      if (!token(code)) return invalid("Start a new account confirmation flow.");
      pkceChallenge(verifier);
      return session(await request("/token?grant_type=pkce", "POST", { auth_code: code, code_verifier: verifier }));
    },
    async requestRecovery(email: string, codeChallenge: string): Promise<void> {
      credentials(email);
      await request(`/recover?redirect_to=${encodeURIComponent(callback)}`, "POST", {
        email, code_challenge: challenge(codeChallenge), code_challenge_method: "s256",
      });
    },
    async updatePassword(accessToken: string, password: string): Promise<void> {
      if (typeof password !== "string" || !password.length || Buffer.byteLength(password) > 1024) return invalid("Enter a password within the supported size.");
      await getUser(accessToken);
      await request("/user", "PUT", { password }, accessToken);
    },
    async signOut(accessToken: string): Promise<void> {
      await request("/logout?scope=local", "POST", undefined, accessToken);
    },
  };
}

export const HOSTED_COOKIES = Object.freeze({ access: "__Host-foliage-access", refresh: "__Host-foliage-refresh", csrf: "__Host-foliage-csrf", flow: "__Host-foliage-flow" });
/** The private workspace: the only addresses that bridge a session or send a visitor to sign in. */
export const HOSTED_PRIVATE_PATH = /^\/(?:$|(?:auth|manage|operations|settings|distribution|recruiting)(?:\/|$))/;
type CookieName = typeof HOSTED_COOKIES[keyof typeof HOSTED_COOKIES];
/** Host-only cookies: never weaken these attributes behind a proxy or for local development. */
export function hostedCookie(name: CookieName, value: string, maxAge: number): string {
  if (!Object.values(HOSTED_COOKIES).includes(name) || !Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > 30 * 86400) return invalid("Invalid account cookie.");
  const encoded = encodeURIComponent(value);
  if (encoded.length > 3800) return invalid("Account cookie exceeds its supported size.");
  return `${name}=${encoded}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export function readHostedCookie(headers: Headers, name: CookieName): string | null {
  const matches = (headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.slice(0, v.indexOf("=")) === name);
  if (matches.length > 1) return invalid("Ambiguous account cookie; sign in again.");
  if (!matches.length) return null;
  try { return decodeURIComponent(matches[0]!.slice(name.length + 1)); } catch { return invalid("Invalid account cookie; sign in again."); }
}
/** Device transport uses a bearer token; browser transport uses host-only cookies, never both. */
export function hostedAccessToken(headers: Headers): { token: string; transport: "bearer" | "cookie" } {
  const authorization = headers.get("authorization");
  const cookie = readHostedCookie(headers, HOSTED_COOKIES.access);
  if (authorization !== null && cookie !== null) return invalid("Use one account credential transport.");
  const value = authorization === null ? cookie : /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(authorization)?.[1];
  if (!token(value)) throw new HostedIdentityError("unauthenticated", "Sign in again.");
  return { token: value, transport: authorization === null ? "cookie" : "bearer" };
}
/** Browser mutations, including sign-in/recovery/refresh, need a same-origin POST and CSRF. */
export function assertHostedMutation(method: string, headers: Headers, csrfToken: string, appOrigin: string): void {
  const csrf = readHostedCookie(headers, HOSTED_COOKIES.csrf);
  if (method !== "POST" || headers.get("origin") !== origin(appOrigin) || !csrf ||
      !/^[A-Za-z0-9_-]{43}$/.test(csrf) || typeof csrfToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(csrfToken) ||
      !timingSafeEqual(Buffer.from(csrf), Buffer.from(csrfToken))) return invalid("Return to the current page and submit the decision again.");
}
export const createPkceVerifier = (): string => randomBytes(32).toString("base64url");
export function pkceChallenge(verifier: string): string {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return invalid("Start a new account confirmation flow.");
  return createHash("sha256").update(verifier).digest("base64url");
}
/** A return location preserves context; it never supplies an external redirect or credential. */
export function safeHostedReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\s]/.test(value)) return "/manage";
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return "/manage"; }
  if (decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded) || /(?:access_token|refresh_token|token_hash|code)=/i.test(decoded)) return "/manage";
  const url = new URL(value, "https://return.invalid");
  return url.origin === "https://return.invalid" ? url.pathname + url.search + url.hash : "/manage";
}
