/** Session-bound device grant. The browser never receives the device's private verifier. */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { HostedIdentityError } from "./hostedIdentity.ts";
const invalid = (): never => { throw new HostedIdentityError("unauthenticated", "Reconnect Photosynthesis with your Foliage account."); };
export const deviceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export function deviceReturn(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/hosted/callback" || url.search || url.hash) return invalid();
  return url;
}
interface Grant { sub: string; sid: string; challenge: string; expiresAt: number; origin: string }
export function deviceSigner(secret: string, origin: string) {
  // Domain-separated key; credentials cannot be used as Clerk session tokens.
  const key = Buffer.from(hkdfSync("sha256", secret, origin, "foliage-device-grant-v1", 32));
  const mac = (body: string) => createHmac("sha256", key).update(body).digest("base64url");
  return {
    issue(input: Omit<Grant, "origin">): string {
      if (!/^[A-Za-z0-9_-]{43}$/.test(input.challenge)) return invalid();
      const body = Buffer.from(JSON.stringify({ ...input, origin })).toString("base64url");
      return `fd1.${body}.${mac(body)}`;
    },
    verify(token: string): Grant {
      if (token.length > 4096) return invalid();
      const [version, body, signature, verifier, extra] = token.split(".");
      if (version !== "fd1" || !body || !signature || !verifier || extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) return invalid();
      const expected = Buffer.from(mac(body)), received = Buffer.from(signature);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) return invalid();
      let value: Grant;
      try { value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Grant; } catch { return invalid(); }
      if (!value || typeof value !== "object" || value.origin !== origin || !/^user_[A-Za-z0-9]+$/.test(value.sub) || !/^sess_[A-Za-z0-9]+$/.test(value.sid) || value.challenge !== deviceChallenge(verifier) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 86400_000) return invalid();
      return value;
    },
  };
}
export function localDeviceConnection(origin: string, callback: string) {
  const returnUrl = deviceReturn(callback);
  const host = new URL(origin);
  if (host.protocol !== "https:" || host.origin !== origin) throw new Error("Configure an exact HTTPS Canopy origin.");
  let pending: { state: string; verifier: string; expires: number } | null = null;
  return {
    start(): string {
      const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
      pending = { verifier, state, expires: Date.now() + 300_000 };
      const url = new URL("/manage/device/connect", origin);
      url.search = new URLSearchParams({ challenge: deviceChallenge(verifier), state, callback: returnUrl.href }).toString();
      return url.href;
    },
    finish(state: string, grant: string): string {
      const saved = pending;
      if (!saved || state !== saved.state || saved.expires <= Date.now() || !/^fd1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(grant) || grant.length > 4096) return invalid();
      pending = null;
      return `${grant}.${saved.verifier}`;
    },
  };
}
