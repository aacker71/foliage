/**
 * THE HOP GATE, shared by both arms.
 *
 * WHY IT MOVED HERE. This logic was written for the LOCAL arm, because that is where a review
 * proved the hole: `inspectLoopback` decided where we may DIAL, undici followed a 307 anyway, and
 * a server on the trusted loopback port could forward the POST body — a person's private material
 * — to any host. That is F-002 in `.loop/FINDINGS.md`, reproduced against two real servers.
 *
 * The fix landed on the local arm only, and the escalated arm had the identical exposure with
 * WORSE stakes: on the local arm a redirect steals material the policy said must never leave the
 * machine; on the escalated arm it steals material already assembled for the wire, to a host that
 * appears nowhere in the egress account the person was shown. `FOLIAGE_FIREWORKS_BASE_URL` is
 * settable, so the redirect need not even come from the real provider.
 *
 * THE GENERAL RULE, of which both arms are instances: **the destination named in the provenance
 * must be the destination the socket reached.** A guard that checks the URL we intended and a
 * report that describes the request we made are two claims derived from different values, which
 * is the bug class all of F-001, F-002 and F-003 share. One function, called by both, is what
 * stops the third instance.
 *
 * Pure and total: no fetch, no throw, no clock. It reads a `Response` that already came back.
 */

/** A hop we refused. `host` is `null` when the redirect named a destination we could not parse. */
export interface RedirectHop {
  readonly status: number;
  readonly host: string | null;
}

/**
 * The five redirect statuses are ENUMERATED rather than tested as `>= 300 && < 400`: 304 (Not
 * Modified) and 305 (Use Proxy) sit in that range and are not redirects a client follows, so a
 * range test would file them under this cause and report a cache hit as an attempted hop.
 *
 * `Location` is resolved against the URL WE asked for, because a redirect may be relative — and
 * `/api/chat` on the same host is still a hop we did not choose to take.
 *
 * Returns `null` when the response is not a redirect, so a call site reads as one line.
 *
 * @param maxHostChars cap on the reported hostname, so a pathological Location cannot become the
 *   whole result. Each arm passes its own limit because their result types cap differently.
 */
export function inspectRedirect(
  response: Response,
  requestUrl: string,
  maxHostChars: number,
): RedirectHop | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;

  const location = response.headers.get("location");
  if (location === null) return { status: response.status, host: null };

  try {
    const host = new URL(location, requestUrl).hostname.toLowerCase();
    return { status: response.status, host: host.slice(0, maxHostChars) };
  } catch {
    /* A `Location` this Node cannot parse is still a redirect we refused; we just cannot say to
       where. `null` says that, rather than reporting the raw header as if it were a host. */
    return { status: response.status, host: null };
  }
}
