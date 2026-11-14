/** Clerk owns hosted identity; Supabase stores service-only, issuer-scoped actor IDs. */
import { deviceSigner } from "./deviceConnection.ts";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { HostedIdentityError, type HostedActor, type HostedSession } from "./hostedIdentity.ts";

const denied = (): never => { throw new HostedIdentityError("unauthenticated", "Sign in with your Foliage account to continue."); };
const unavailable = (): never => { throw new HostedIdentityError("unavailable", "Account verification is unavailable. No account action was completed."); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createClerkIdentity(config: {
  publishableKey: string; secretKey: string; appOrigin: string; supabaseUrl: string; serviceRoleKey: string;
}) {
  const app = new URL(config.appOrigin), storage = new URL(config.supabaseUrl);
  if ([app, storage].some(url => url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)) throw new Error("Configure exact HTTPS account and storage origins.");
  if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(config.publishableKey) || !/^sk_(test|live)_/.test(config.secretKey)) throw new Error("Configure Clerk application keys.");
  const frontend = Buffer.from(config.publishableKey.replace(/^pk_(test|live)_/, ""), "base64").toString("utf8");
  if (!/^[a-z0-9.-]+\$$/.test(frontend)) throw new Error("Configure a valid Clerk frontend domain.");
  const issuer = `https://${frontend.slice(0, -1)}`;
  const client = createClerkClient({ publishableKey: config.publishableKey, secretKey: config.secretKey, telemetry: { disabled: true } });
  const devices = deviceSigner(config.secretKey, app.origin);
  const verify = async (token: string) => {
    let claims;
    try { claims = token.startsWith("fd1.") ? { ...devices.verify(token), iss: issuer, azp: app.origin, act: undefined, sts: undefined } : await verifyToken(token, { secretKey: config.secretKey, authorizedParties: [app.origin], clockSkewInMs: 1000 }); }
    catch { return denied(); }
    // SDK signature/expiry checks are necessary but issuer, active session and current user
    // state are also required. Email never resolves or transfers an internal actor.
    if (claims.act !== undefined || claims.sts === "pending" || claims.iss !== issuer || claims.azp !== app.origin || !/^user_[A-Za-z0-9]+$/.test(claims.sub) || typeof claims.sid !== "string" || !/^sess_[A-Za-z0-9]+$/.test(claims.sid)) return denied();
    try {
      const session = await client.sessions.getSession(claims.sid);
      if (session.actor !== null || session.userId !== claims.sub || session.status !== "active" || session.expireAt <= Date.now()) return denied();
      const user = await client.users.getUser(claims.sub);
      if (user.id !== claims.sub || user.banned || user.locked) return denied();
      return { session, user };
    } catch (cause) { if (cause instanceof HostedIdentityError) throw cause; return unavailable(); }
  };
  const resolve = async (subject: string): Promise<HostedActor> => {
    try {
      const response = await fetch(`${storage.origin}/rest/v1/rpc/foliage_resolve_actor`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_issuer: issuer, p_subject: subject }),
      });
      if (!response.ok) { await response.body?.cancel(); return unavailable(); }
      const id: unknown = await response.json();
      if (typeof id !== "string" || !UUID.test(id)) return unavailable();
      return Object.freeze({ id });
    } catch (cause) { if (cause instanceof HostedIdentityError) throw cause; return unavailable(); }
  };
  const unsupported = async (): Promise<never> => { throw new HostedIdentityError("invalid-request", "Use Clerk sign-in. Password and legacy device-session endpoints are disabled."); };
  return {
    async createDeviceGrant(token: string, challenge: string) {
      if (token.startsWith("fd1.")) return denied();
      const { session, user } = await verify(token);
      return devices.issue({ sub: user.id, sid: session.id, challenge, expiresAt: Math.min(Date.now() + 86400_000, session.expireAt) });
    },
    async deviceSession(token: string): Promise<HostedSession> {
      const grant = devices.verify(token), { user } = await verify(token);
      return { actor: await resolve(user.id), accessToken: token, refreshToken: "clerk-device", expiresIn: Math.max(1, Math.floor((grant.expiresAt - Date.now()) / 1000)) };
    },
    issuer, publishableKey: config.publishableKey,
    authenticateRequest: (request: Request) => client.authenticateRequest(request, { authorizedParties: [app.origin], acceptsToken: "session_token" }),
    async getUser(token: string) { return resolve((await verify(token)).user.id); },
    async getVerifiedEmail(token: string, actor: HostedActor): Promise<string> {
      const { user } = await verify(token);
      if ((await resolve(user.id)).id !== actor.id) return denied();
      const email = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId && address.verification?.status === "verified");
      if (!email) return denied();
      return email.emailAddress;
    },
    // Compatibility surface for the existing admission router. No Supabase Auth fallback.
    getVerifiedUser: unsupported,
    signIn: unsupported as (email: string, password: string) => Promise<HostedSession>,
    signUp: unsupported as (email: string, password: string, challenge: string) => Promise<HostedSession | null>,
    refreshSession: unsupported as (token: string) => Promise<HostedSession>,
    exchangeCode: unsupported as (code: string, verifier: string) => Promise<HostedSession>,
    requestRecovery: unsupported as (email: string, challenge: string) => Promise<void>,
    updatePassword: unsupported as (token: string, password: string) => Promise<void>,
    async signOut(token: string): Promise<void> {
      const { session } = await verify(token);
      try { await client.sessions.revokeSession(session.id); } catch { return unavailable(); }
    },
  };
}
