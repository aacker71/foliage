/**
 * THE HEADERS A CANOPY RESPONSE CARRIES — one definition, two consumers.
 *
 * WHY THIS MOVED OUT OF `server.mjs`. A static export loses every one of these, because a folder
 * has no response logic: MEASURED 2026-09-04, the exported folder served by a plain static host
 * sent NO content-security-policy, NO x-content-type-options, NO referrer-policy and NO
 * x-robots-tag, while the server sent all four for the same page. Deployed as-is that silently
 * undoes F-033 — the canopy becomes crawlable while whether a hosted leaf should be findable is
 * still an OPEN OWNER DECISION (C12/H7) — and drops `frame-ancestors 'none'`, which does not
 * inherit from `default-src` and is the only thing stopping any origin framing a person's page.
 *
 * `server.mjs` reads this definition for responses; `export.mjs` reads it for the emitted
 * `vercel.json`. F-038's process test compares that configuration with the headers a real server
 * sends. Both consumers use the same directives so a separate host-configuration list cannot
 * drift from the server's policy.
 *
 * WHAT NO CONFIGURATION CAN DO. A host that ignores it serves the folder bare. That is why the
 * artifact must also be safe by its own bytes: escaped text, no inline handlers, and only the
 * checked local portfolio renderer on pages that explicitly enable it. The CSP is a second line
 * of defence, not a substitute for admission and escaping.
 */

/** Directives every response shares. `frame-ancestors` is named because it does not inherit. */
const COMMON = [
  "default-src 'none'",
  "img-src 'self'",
  "media-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

/** Default for assets, empty/error states and documents without the checked renderer. */
const CSP_STRICT = ["default-src 'none'", "style-src 'self'", ...COMMON.slice(1)].join("; ");

/**
 * Only an explicitly enhanced portfolio or résumé may execute its self-hosted script. It cannot make
 * network requests, embed objects, run inline handlers, or submit public forms.
 *
 * @param {{ portfolio?: boolean, print?: boolean, form?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function publicHeaders(options = {}) {
  const policy = options.form === true ? CSP_STRICT.replace("form-action 'none'", "form-action 'self'") : CSP_STRICT;
  return {
    "content-security-policy": (options.portfolio === true || options.print === true) ? `${policy}; script-src 'self'; connect-src 'none'; object-src 'none'` : policy,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    /*
     * NOT FINDABLE UNTIL SOMEBODY DECIDES IT SHOULD BE — and this header is deliberately NOT that
     * decision. `docs/SYSTEM-ARCHITECTURE.md` §7 item E: whether discovery exists at all, and for
     * whom, is C12 and it is GATED; but "the `noindex` header in §6b.5 is not this decision and
     * must not wait for it". §6b listed its absence under BROKEN, and it was still absent when
     * measured 2026-09-04: `grep -rni "robots|noindex" apps/canopy packages/canopy` returned
     * nothing and no robots.txt existed, so a canopy served anywhere but loopback was fully
     * crawlable by default.
     *
     * THE DEFAULT IS ASYMMETRIC, which is the whole argument (§6b.5): unlisted→listed is
     * reversible by the person, and listed→unlisted is not, once a crawler has cached it. A
     * consent given as `--confirm <id>` was consent for A PAGE, not for findability.
     *
     * All four directives, because they answer different crawlers doing different things:
     * `noindex` keeps it out of results, `noarchive` refuses the cached copy that outlives an
     * unpublish, `nosnippet` stops the excerpt that republishes the text without the page, and
     * `noimageindex` covers the photographs a leaf can carry.
     */
    "x-robots-tag": "noindex, noarchive, nosnippet, noimageindex",
  };
}
