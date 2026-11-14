/**
 * Public, explicitly selected GitHub commits only. No repository crawl or GitHub token.
 * Trust: server Auth /user -> confirmed email -> GitHub-verified PGP committer -> same author.
 * GitHub's generic verified flag does NOT establish a different author's consent.
 * https://docs.github.com/en/rest/git/commits#get-a-commit-object
 * https://docs.github.com/en/authentication/troubleshooting-commit-signature-verification/using-a-verified-email-address-in-your-gpg-key
 * https://supabase.com/docs/reference/javascript/auth-getuser
 * https://supabase.com/docs/guides/auth/users
 * Persistent verified_at records historical verification, not current key validity.
 */
import { documentDigest, parsePublishedDocument, redactPublicationText, toArtifactJson } from "@foliage/canopy";
import type { HostedActor } from "./hostedIdentity.ts";

export interface PublicGitHubEvidence {
  readonly leafletId: string;
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
}
export interface HostedGitHubVerification {
  readonly actorId: string;
  readonly artifactDigest: string;
  readonly items: readonly (PublicGitHubEvidence & { readonly verifiedAt: string })[];
  readonly verificationId: string;
}
export class HostedGitHubProofError extends Error {
  readonly code: "invalid-evidence" | "identity-required" | "verification-required" | "provider-unavailable";
  constructor(code: HostedGitHubProofError["code"]) {
    super("Public source verification was not established. Nothing was published or relabeled.");
    this.code = code;
  }
}
const minted = new WeakSet<object>();
/** A digest supplied by a client is not a verifier capability. Never deserialize one as proof. */
export function isHostedGitHubVerification(value: unknown): value is HostedGitHubVerification {
  return typeof value === "object" && value !== null && minted.has(value);
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (code: HostedGitHubProofError["code"]): never => { throw new HostedGitHubProofError(code); };
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_ITEMS = 20;
const MAX_RESPONSE_BYTES = 128 * 1024;
const evidenceKeys = ["leafletId", "owner", "repo", "ref"];
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
async function providerJson(response: Response): Promise<unknown> {
  if (response.status !== 200 || response.redirected || !response.body) {
    await response.body?.cancel();
    return fail("provider-unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return fail("provider-unavailable"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}
/** git's %s is the first nonempty paragraph, folding its lines with spaces; intake trims it. */
function titleOf(message: string): string {
  const lines = message.split("\n");
  while (lines.length && /^[ \t\r]*$/.test(lines[0]!)) lines.shift();
  const paragraph: string[] = [];
  for (const line of lines) {
    if (/^[ \t\r]*$/.test(line)) break;
    paragraph.push(line.replace(/[ \t\r]+$/, ""));
  }
  return paragraph.join(" ").trim() || "(commit recorded with no message)";
}

export function createHostedGitHubProof(config: {
  /** SERVER capability: fresh Auth GET /user for this session, never a request-body identity. */
  getUser: (accessToken: string) => Promise<unknown>;
  getVerifiedEmail?: (accessToken: string, actor: HostedActor) => Promise<string>;
  fetch?: typeof fetch;
}) {
  return async function verify(input: {
    actor: HostedActor; accessToken: string; document: unknown; evidence: unknown;
  }): Promise<HostedGitHubVerification> {
    // Snapshot before any await: concurrent caller mutation cannot change what was checked.
    let raw: unknown;
    let coordinates: unknown;
    try {
      const json = JSON.stringify(input.document);
      const supplied = JSON.stringify(input.evidence);
      if (!json || Buffer.byteLength(json) > 1024 * 1024 || !supplied || Buffer.byteLength(supplied) > 16 * 1024) return fail("invalid-evidence");
      raw = JSON.parse(json) as unknown;
      coordinates = JSON.parse(supplied) as unknown;
    } catch { return fail("invalid-evidence"); }
    if (!object(raw) || ![3, 4, 5].includes(Number(raw["artifactVersion"]))) return fail("invalid-evidence");
    const parsed = parsePublishedDocument(raw);
    if (!parsed.ok) return fail("invalid-evidence");
    const document = parsed.document;
    const selected = document.leaf.leaflets.filter(item => item.tier === "verified");
    if (!selected.length || selected.length > MAX_ITEMS || !Array.isArray(coordinates) || coordinates.length !== selected.length) return fail("invalid-evidence");
    const byId = new Map<string, PublicGitHubEvidence>();
    for (const item of coordinates) {
      if (!object(item) || Object.keys(item).length !== evidenceKeys.length || evidenceKeys.some(key => typeof item[key] !== "string") ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(String(item["owner"])) ||
          !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(String(item["repo"])) || !SHA.test(String(item["ref"])) || byId.has(String(item["leafletId"]))) return fail("invalid-evidence");
      byId.set(String(item["leafletId"]), Object.freeze({ leafletId: String(item["leafletId"]), owner: String(item["owner"]), repo: String(item["repo"]), ref: String(item["ref"]) }));
    }
    for (const item of selected) {
      const coordinate = byId.get(String(item.id));
      if (!coordinate || item.provenance.source !== "git" || !SHA.test(item.provenance.ref) || coordinate.ref !== item.provenance.ref) return fail("invalid-evidence");
    }
    const actorId = input.actor?.id;
    if (typeof actorId !== "string" || !UUID.test(actorId) || typeof input.accessToken !== "string" || !/^[A-Za-z0-9._~-]{1,8192}$/.test(input.accessToken)) return fail("identity-required");
    let email: string;
    if (config.getVerifiedEmail) {
      try { email = await config.getVerifiedEmail(input.accessToken, input.actor); } catch { return fail("identity-required"); }
      if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("identity-required");
    } else {
    let user: unknown;
    try { user = await config.getUser(input.accessToken); } catch { return fail("identity-required"); }
    if (!object(user) || user["id"] !== actorId || user["aud"] !== "authenticated" || user["role"] !== "authenticated" || user["is_anonymous"] === true ||
        typeof user["email"] !== "string" || user["email"].length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user["email"]) || !timestamp(user["email_confirmed_at"])) return fail("identity-required");
    email = user["email"];
    }
    const items: (PublicGitHubEvidence & { readonly verifiedAt: string })[] = [];
    const deadline = AbortSignal.timeout(15_000);
    for (const item of selected) {
      const coordinate = byId.get(String(item.id))!;
      let commit: unknown;
      try {
        const response = await (config.fetch ?? fetch)(`https://api.github.com/repos/${coordinate.owner}/${coordinate.repo}/git/commits/${coordinate.ref}`, {
          method: "GET", redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(5_000)]),
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Foliage-public-proof" },
        });
        commit = await providerJson(response);
      } catch { return fail("provider-unavailable"); }
      if (!object(commit) || commit["sha"] !== coordinate.ref || !object(commit["author"]) || !object(commit["committer"]) ||
          commit["author"]["email"] !== email || commit["committer"]["email"] !== email || typeof commit["message"] !== "string" || !object(commit["verification"])) return fail("verification-required");
      const verification = commit["verification"];
      // The documented PGP identity/email guarantee is narrower than generic SSH/S/MIME verification.
      if (verification["verified"] !== true || verification["reason"] !== "valid" || !timestamp(verification["verified_at"]) ||
          typeof verification["signature"] !== "string" || !verification["signature"].startsWith("-----BEGIN PGP SIGNATURE-----\n") ||
          !verification["signature"].trimEnd().endsWith("-----END PGP SIGNATURE-----")) return fail("verification-required");
      const subject = titleOf(commit["message"]);
      const title = redactPublicationText(subject);
      if (item.title !== title || item.titleRedacted !== (title !== subject)) return fail("verification-required");
      items.push(Object.freeze({ ...coordinate, verifiedAt: verification["verified_at"] }));
    }
    const artifactDigest = documentDigest(Buffer.from(JSON.stringify(toArtifactJson(document))));
    const binding = { actorId, artifactDigest, items: Object.freeze(items) };
    const result = Object.freeze({ ...binding, verificationId: documentDigest(Buffer.from(JSON.stringify(["foliage-public-github-pgp-v1", binding]))) });
    minted.add(result);
    return result;
  };
}
