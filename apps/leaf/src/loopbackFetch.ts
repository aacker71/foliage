/**
 * THE ONE PLACE THIS APP TALKS TO A MODEL, and the only one permitted to.
 *
 * WHY THIS FILE EXISTS RATHER THAN A THIRD COPY OF THE CHECK. Until now the loopback rule was
 * written out at three call sites — `harvest.mjs`'s `draftTitleWithLocalModel`,
 * `brainSource.ts`'s `describeBrainPages`, and `photoSource.ts`'s `describeImage`. They agreed,
 * on the day they were written. A sibling lane on another tree found the same guard fixed on ONE
 * ARM ONLY, and separately found two loopback validators that disagreed about whether 127.0.0.2
 * is loopback. A duplicated guard is how both of those happen: three copies is three chances for
 * a future edit to strengthen one and leave two, and nothing fails when they drift because each
 * copy passes its own tests.
 *
 * THE DEFECT THIS CLOSES, reproduced with two real servers before it was written and again after:
 *
 *   A caller parses its endpoint, confirms the hostname is 127.0.0.1, and calls `fetch`. The
 *   endpoint answers **307** naming any host it likes. `undici` follows it, and a 307 PRESERVES
 *   METHOD AND BODY — so the prompt goes to the second host. Measured: a body reading
 *   "PRIVATE BRAIN CONTENT ABOUT A COLLEAGUE" arrived at a server on a different port while the
 *   command printed that it makes no network call beyond 127.0.0.1. With `redirect: "manual"` the
 *   same request returns 307 and the second server receives nothing.
 *
 * The shape of the bug, stated the way the sibling lane put it and it is the better phrasing:
 * **the claim and the effect it describes were derived from different values.** The loopback
 * claim came from the CONFIGURED url; the effect happened on the SOCKET actually opened. This
 * module makes them the same value by being the only thing that opens one.
 *
 * WHY A REDIRECT IS ITS OWN NAMED FAILURE and not folded into "unreachable". A 3xx from a
 * loopback endpoint is a SIGNAL — something is answering on the port the operator trusts and
 * trying to move their material elsewhere. Collapsing it into a generic failure would hide the
 * attempt behind a message about the model being down, and the operator would restart ollama
 * instead of asking why their model endpoint is redirecting. Both causes travel.
 *
 * WHY EXACTLY `127.0.0.1` AND NOTHING ELSE. This is deliberately the strictest reading and it is
 * NOT widened here:
 *   - `localhost` is refused because it is a NAME, and a name is resolved by a file and a
 *     resolver the process does not control. `/etc/hosts` can point it anywhere.
 *   - `::1` and the rest of `127.0.0.0/8` are genuinely loopback and are still refused, because
 *     nothing in this product needs them and every address admitted here is one more thing a
 *     future reader has to reason about. Widening is a decision to take deliberately, with a
 *     reason, not a convenience.
 * Node builtins only; no dependency is added by any of this.
 */

/** Why a loopback call did not happen. Each has a different remedy, so each has its own name. */
export type LoopbackFailure =
  | { readonly cause: "not-loopback"; readonly detail: string; readonly host: string }
  | { readonly cause: "malformed-endpoint"; readonly detail: string }
  | { readonly cause: "redirected"; readonly detail: string; readonly status: number; readonly location: string | null }
  /**
   * `error` is the THROWN VALUE, carried out rather than flattened to its message.
   *
   * WHY IT IS HERE. Two callers already split this case further: a request aborted by
   * `AbortSignal.timeout` is `timed-out`, not `unreachable`, because the remedies are opposite —
   * a dead port means start the model, a ceiling reached by a model that is answering means the
   * machine is busy. They tell those apart from the error's NAME ("TimeoutError", fixed by the
   * web standard) and never from its message, which moves with the runtime. Since this module
   * now owns the `fetch` call, the only way that distinction survives is for the value itself to
   * travel. A boolean here would decide, for every future caller, that a timeout is the only
   * split worth making; the error decides nothing.
   */
  | { readonly cause: "unreachable"; readonly detail: string; readonly error: unknown };

export type LoopbackResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly failure: LoopbackFailure };

/** The one address this app will open a socket to. See the header for why it is not widened. */
export const LOOPBACK_HOST = "127.0.0.1";

/** What can be wrong with an endpoint before a socket is opened: the two causes judged on the URL alone. */
type EndpointFailure = Extract<LoopbackFailure, { cause: "not-loopback" | "malformed-endpoint" }>;

/**
 * Is this endpoint one we will talk to? Exported so a caller can refuse EARLY — before it
 * assembles a prompt out of somebody's private notes — rather than only at the moment of sending.
 * The return type names the two causes this can produce, so a caller handles them by name and the
 * compiler holds the proof that no third one is folded in.
 */
export function loopbackHostOf(endpoint: string): { ok: true; host: string } | { ok: false; failure: EndpointFailure } {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch (err) {
    return {
      ok: false,
      failure: {
        cause: "malformed-endpoint",
        detail:
          `"${endpoint}" is not a URL this process can parse (${err instanceof Error ? err.message : String(err)}), ` +
          `so its host cannot be checked. Nothing was sent.`,
      },
    };
  }
  if (host !== LOOPBACK_HOST) {
    return {
      ok: false,
      failure: {
        cause: "not-loopback",
        host,
        // Stated as a FACT, with no verb of its own: each call site prefixes its own refusal
        // ("refusing to draft:", "refusing to describe:"), and a detail that also said "refusing
        // to send" would read doubled everywhere it is quoted.
        detail:
          `the endpoint resolves to host "${host}", not ${LOOPBACK_HOST}, and nothing was sent. ` +
          `This path is loopback only — that is the privacy claim, enforced on the parsed URL ` +
          `rather than trusted to a constant, so an edit to the configuration fails closed ` +
          `instead of silently egressing.`,
      },
    };
  }
  return { ok: true, host };
}

/**
 * POST to a loopback endpoint, refusing to follow a redirect anywhere.
 *
 * Returns a result rather than throwing, and never returns a `Response` that came from a host the
 * caller did not name. `redirect: "manual"` means `fetch` hands back the 3xx instead of chasing
 * it; this function then refuses it, because a caller that received a 3xx and read `.ok` would
 * see `false` and report "the model is unreachable" about a host that answered perfectly well.
 */
export async function loopbackFetch(endpoint: string, init: RequestInit): Promise<LoopbackResult> {
  const checked = loopbackHostOf(endpoint);
  if (!checked.ok) return { ok: false, failure: checked.failure };

  let response: Response;
  try {
    response = await fetch(endpoint, { ...init, redirect: "manual" });
  } catch (err) {
    // Both causes, always: a fetch failure routinely wraps the real socket error in `cause`, and
    // printing only "fetch failed" is how a connection refusal becomes a mystery.
    const outer = err instanceof Error ? err.message : String(err);
    const inner = err instanceof Error && err.cause !== undefined
      ? ` (cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)})`
      : "";
    return {
      ok: false,
      failure: { cause: "unreachable", error: err, detail: `${endpoint} could not be reached: ${outer}${inner}` },
    };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    return {
      ok: false,
      failure: {
        cause: "redirected",
        status: response.status,
        location,
        detail:
          `${endpoint} answered HTTP ${response.status} redirecting to ` +
          `${location === null ? "an unnamed location" : `"${location}"`}, and the redirect was ` +
          `NOT followed. A 307 preserves method and body, so following it would have sent this ` +
          `request's contents to that host while this command reports it talks only to ` +
          `${LOOPBACK_HOST}. Something is answering on a port you trusted and trying to move your ` +
          `material elsewhere; nothing was sent to it.`,
      },
    };
  }

  return { ok: true, response };
}
