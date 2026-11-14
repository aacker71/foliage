/**
 * The privacy router: whether drafting may use a model, and which endpoints qualify.
 *
 * CLEAN-ROOM PORT OF A DESIGN, NOT OF CODE. The four-mode fail-closed policy proved
 * itself in the Coeadapt line after its predecessor shipped three real defects (an
 * egress hole where a UI preference outranked the stored mode; 'unset' falling through
 * to cloud; a consent-free cloud fallback). This is a fresh implementation of the
 * surviving DESIGN, in this repository's idiom, because the source repo's licence is
 * contradictory and owner-gated — nothing was copied.
 *
 * The design, stated as the three rules the old bugs broke:
 *   1. The MODE is read first. A preference can only narrow what the mode allows.
 *   2. 'unset' DENIES. A fresh install has no frontier egress until the subject chooses.
 *   3. Every egress-permitting mode requires a stored ConsentRecord whose `statement`
 *      is the verbatim text the subject agreed to. This module never synthesises one —
 *      consent text is owner-authored, never written by code.
 *
 * HONEST LIMIT, carried verbatim as a fact (facts aren't copyrightable and this one
 * matters): "loopback" proves the CONNECTION does not leave this machine. It does not
 * prove the BYTES stop here — a user-run loopback proxy could relay outward. Never
 * describe local-only as more than it is.
 *
 * FOR THE PROTOTYPE the only drafting endpoint is ollama on 127.0.0.1, so every mode
 * resolves to local drafting or none. The policy still ships now, not later, because
 * the enterprise variant WILL want frontier-consented — and retrofitting a privacy
 * chokepoint after egress paths exist is how the original bugs happened.
 */

const PROCESSING_MODES = ["unset", "local-only", "local-preferred", "frontier-consented"] as const;
type ProcessingMode = (typeof PROCESSING_MODES)[number];

function isProcessingMode(v: unknown): v is ProcessingMode {
  return typeof v === "string" && (PROCESSING_MODES as readonly string[]).includes(v);
}

/** What the subject actually agreed to. `statement` is stored VERBATIM — it is the audit record. */
export interface ConsentRecord {
  readonly mode: ProcessingMode;
  readonly statement: string;
  readonly grantedAt: string;
}

export interface EgressDecision {
  readonly mode: ProcessingMode;
  readonly frontierEgress: "denied" | "permitted";
  readonly reason:
    | "no-mode-chosen"
    | "local-only"
    | "consent-missing"
    | "consent-mode-mismatch"
    | "consent-empty-statement"
    | "consented";
}

/** Default-deny: anything not explicitly permitted below is denied. */
export function decideEgress(mode: unknown, consent?: ConsentRecord | null): EgressDecision {
  const m: ProcessingMode = isProcessingMode(mode) ? mode : "unset";
  if (m === "unset") return { mode: m, frontierEgress: "denied", reason: "no-mode-chosen" };
  if (m === "local-only") return { mode: m, frontierEgress: "denied", reason: "local-only" };

  if (!consent) return { mode: m, frontierEgress: "denied", reason: "consent-missing" };
  if (consent.mode !== m) return { mode: m, frontierEgress: "denied", reason: "consent-mode-mismatch" };
  if (typeof consent.statement !== "string" || consent.statement.trim() === "") {
    return { mode: m, frontierEgress: "denied", reason: "consent-empty-statement" };
  }
  if (typeof consent.grantedAt !== "string" || consent.grantedAt.trim() === "") {
    return { mode: m, frontierEgress: "denied", reason: "consent-missing" };
  }
  return { mode: m, frontierEgress: "permitted", reason: "consented" };
}

/**
 * The one address this file will call a model at. NOT a new decision — see `isLoopbackUrl`.
 *
 * Duplicated as a LITERAL rather than imported, and that is a constraint, not a preference:
 * `apps/leaf/src/loopbackFetch.ts` owns this decision, and `apps/photosynthesis/tsconfig.json`
 * sets `rootDir: "."`, so a relative import of another app's source is `TS6059 — File … is not
 * under 'rootDir'`. Measured, not assumed (tsc 5.9.3, 2026-08-28). The two apps share no
 * workspace package either can put this in without editing a third package. What replaces the
 * import is `loopback.test.ts`, which runs BOTH other gates in a child process and fails if any
 * of the three disagrees about any address — a test rather than a comment, because a comment
 * saying "keep these in sync" is exactly what F-009 was.
 */
export const LOOPBACK_HOST = "127.0.0.1";

/**
 * Is this endpoint one we will call a model at? Anything unparseable is NOT local —
 * the failure direction that refuses to draft rather than the one that leaks.
 *
 * NARROWED 2026-08-28, CLOSING F-009, AND THE NARROWING IS THE POINT. This function used to
 * accept `::1`, `[::1]` and `localhost` as well; `apps/cos/src/localModel.ts` accepted all of
 * `127.0.0.0/8`. So `http://127.0.0.2:11434` was loopback to one gate and not the other, in a
 * product whose central claim is that boundary. Two gates that disagree about what "this
 * machine" means cannot both be the guarantee.
 *
 * THE DEFINITION ADOPTED IS THE ONE THIS TREE ALREADY ARGUED FOR, not a third one invented
 * here: `apps/leaf/src/loopbackFetch.ts` — the module that owns the only `fetch` on the model
 * path — takes the strictest reading and states its reasons in its own header. Restated so this
 * file can be read alone:
 *   - `localhost` is refused because it is a NAME, resolved by a file and a resolver this
 *     process does not control. `/etc/hosts` can point it anywhere. RFC 6761 says it must be
 *     loopback; RFC 6761 is not what answers the query.
 *   - `::1` and the rest of `127.0.0.0/8` are genuinely loopback per RFC 1122 and are STILL
 *     refused, because nothing here needs them and every address admitted is one more thing a
 *     future reader must reason about. Widening is a decision to take deliberately, later, with
 *     a reason — not a convenience taken now.
 *
 * WHAT THIS COSTS, said plainly rather than discovered by a user. Under every mode, including
 * `unset`, `http://localhost:11434` and `http://[::1]:11434` are now REFUSALS where they were
 * allows. That is defensible here and only here: `apps/cos/src/localModel.ts` deliberately
 * defaults to the IP LITERAL `http://127.0.0.1:11434` — its own comment says the default path
 * "involves no name resolution at all" — and `drafter.ts`'s `DEFAULT_OLLAMA_URL` is the same
 * literal. So the path this product takes by itself is unaffected; an operator who typed
 * `localhost` is refused BY NAME and told which host was refused, which is the failure
 * direction that cannot leak.
 *
 * PARSE, THEN READ THE HOST. Never a prefix test on the string: `"http://127.0.0.1.evil.com/"
 * .startsWith("http://127.0.0.1")` is `true` and the host actually dialled is `evil.com`'s
 * subdomain. `new URL` also decides where userinfo ends (`http://127.0.0.1@evil.com/` → host
 * `evil.com`) and normalises `http://2130706433`, `http://0x7f.0.0.1` and `http://127.1` to
 * `127.0.0.1`, so those three — the standard bypasses for a `^127\.` test — stay ACCEPTED,
 * correctly, and strictness costs nothing there.
 *
 * Pure, total, O(1): a `URL` constructor failure is caught and read as "not local".
 */
export function isLoopbackUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.trim() === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.hostname.toLowerCase() === LOOPBACK_HOST;
}

/**
 * The one question the drafter asks: may I call `endpoint` under `mode`?
 *
 * A loopback endpoint is allowed under EVERY mode including 'unset' — local drafting
 * is the product working as promised, not an egress. A non-loopback endpoint is
 * allowed only when the mode + consent pair explicitly permits frontier egress.
 */
export function mayDraftAgainst(
  endpoint: string,
  mode: unknown,
  consent?: ConsentRecord | null,
): { readonly allowed: boolean; readonly reason: string } {
  if (isLoopbackUrl(endpoint)) return { allowed: true, reason: "loopback" };
  const decision = decideEgress(mode, consent);
  return decision.frontierEgress === "permitted"
    ? { allowed: true, reason: decision.reason }
    : { allowed: false, reason: decision.reason };
}
