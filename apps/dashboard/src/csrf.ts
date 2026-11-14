/**
 * CSRF — the review server's defence, carried across to the composed dashboard UNCHANGED.
 *
 * `apps/photosynthesis/review-server.mjs` holds this logic inline, in a server that cannot be
 * imported without also binding a port, and the composition is explicitly not allowed to
 * rewrite that file. So the mechanism is restated here — identically, and as pure functions
 * with tests, so that "identical" is a checked property rather than a claim in a comment.
 *
 * THE MECHANISM, and why each half is load-bearing:
 *
 *   1. A PER-PROCESS TOKEN in a hidden form field, compared in constant time. Per-process
 *      rather than per-page-load so a stale tab still works within a session. Zero-JS
 *      compatible, because these pages run no script at all — `script-src` is absent from
 *      their CSP by design.
 *
 *   2. AN ORIGIN/REFERER CHECK, and ABSENT HEADERS ARE REFUSED. A browser sends `Origin` on
 *      cross-site form POSTs, so a state-changing request without one is not the shape a
 *      legitimate click has. Refusing rather than allowing is the direction that fails safe.
 *
 * The sharp case is `/promote`: it reads no request body at all, so without this a hidden
 * auto-submitting form on ANY page open in the user's browser could promote every approved
 * candidate into their real leaf — bypassing the deliberate final human click the whole
 * product leans on. A form POST is a "simple request"; no CORS preflight protects it, and
 * `form-action 'self'` constrains only forms THIS page renders, never an attacker's.
 *
 * WHAT THE COMPOSITION CHANGES: nothing about the rule. `selfOrigin` is now the dashboard's
 * own `http://HOST:PORT` instead of the review server's, which is exactly right — the page
 * that renders the form and the route that receives it are the same process on the same
 * origin. That is the property a reverse proxy could not have preserved, and it is why this
 * design composes modules rather than proxying servers.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * The subset of `IncomingHttpHeaders` this check reads. Narrow on purpose: a function that
 * takes a whole request can be handed one from anywhere, and this one must be checkable.
 */
export interface OriginHeaders {
  readonly origin?: string | undefined;
  readonly referer?: string | undefined;
}

/**
 * Does this request claim to come from our own origin?
 *
 * `Origin` first, `Referer` as a fallback (some same-origin form posts omit Origin depending
 * on browser and referrer policy — which is why the pages that carry these forms set
 * `referrer-policy: same-origin` rather than `no-referrer`). Neither present is a refusal.
 */
export function sameOrigin(headers: OriginHeaders, selfOrigin: string): boolean {
  const origin = headers.origin;
  if (typeof origin === "string") return origin === selfOrigin;

  const referer = headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin === selfOrigin;
    } catch {
      // A Referer we cannot parse tells us nothing, and "tells us nothing" is a refusal here.
      return false;
    }
  }

  return false;
}

/**
 * Constant-time token comparison.
 *
 * The length check first is not a shortcut around the timing property — `timingSafeEqual`
 * THROWS on unequal lengths, so it has to happen — and a token's length is not the secret.
 */
export function tokenMatches(candidate: string | undefined | null, token: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

/**
 * The whole gate, as one call: a mutating request is accepted only if BOTH legs pass.
 *
 * Returned as a discriminated union rather than a boolean so the caller can say which leg
 * failed in a log without re-deriving it — and so adding a third leg cannot silently become
 * an `||`.
 */
export type CsrfVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failed: "origin" | "token" };

export function verifyMutatingRequest(
  headers: OriginHeaders,
  formToken: string | undefined | null,
  selfOrigin: string,
  token: string,
): CsrfVerdict {
  if (!sameOrigin(headers, selfOrigin)) return { ok: false, failed: "origin" };
  if (!tokenMatches(formToken, token)) return { ok: false, failed: "token" };
  return { ok: true };
}
