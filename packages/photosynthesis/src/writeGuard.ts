/**
 * THE ONE RULE FOR "MAY THIS WRITE PROCEED, OR IS IT ABOUT TO GUESS A PATH" — ledger F-025,
 * third time this exact shape has been found (`harvest.mjs`'s `promote`/`approve`/`reject`,
 * `apps/leaf/server.mjs`'s `recordDecision`/`carryIntoLeaf`, and now
 * `apps/photosynthesis/review-server.mjs`'s `/decide`/`/promote`).
 *
 * THE SHAPE, every time: a document-path environment variable defaults to a well-known path
 * beside the app when it is genuinely unset, so a launch that skips the sanctioned wrapper
 * (`foliage up`, or here, an explicit `FOLIAGE_HARVEST`/`FOLIAGE_LEAF`) silently reads AND
 * REWRITES whatever sits at that default instead of refusing. Three independent writers found
 * the identical bug independently because the CHECK — "is every variable this write depends on
 * actually configured, or would I be about to substitute a guess" — never had one home.
 *
 * PURE and TOTAL, on purpose: no fs, no `process.env`, no clock. The caller reads its own
 * environment (`env` reads are an effect, and effects live at the edges — each server's own
 * `process.env[NAME]` lookups, immediately before calling this) and hands the RESULT here as
 * plain values; this function only judges what it is given. That is what lets one function
 * back BOTH `apps/leaf/server.mjs` (whose values come from `process.env` directly) and
 * `apps/photosynthesis/review-server.mjs` (a completely separate app, on a completely separate
 * document format, that shares nothing else with `apps/leaf` today) without either depending on
 * the other or on how either one reads its configuration.
 *
 * A name maps to "missing" under the exact same rule every prior copy used independently:
 * `undefined` (never set) or blank after trimming (set but empty) are both "not really
 * configured" — the one case worth naming apart from those two is the WELL-FORMED case, which
 * this function does not have to know anything about; a caller passing a value here has already
 * decided that if it survives this check, it is a real address worth trying to open.
 */

/** A write refused because one or more configured values it depends on were never set. */
export interface WriteGuardVerdict {
  readonly ok: boolean;
  /** Present, and non-empty, only when `ok` is `false`. Every name the caller passed whose
   * value was `undefined` or blank — in the order the caller gave them, never reordered, so a
   * message built from this list matches the order a reader would expect. */
  readonly missing: readonly string[];
}

/**
 * Judge whether every one of `values` is genuinely configured. `values` is a name → raw value
 * map, exactly what a caller's own `{ FOLIAGE_HARVEST: process.env["FOLIAGE_HARVEST"], ... }`
 * looks like — the names are for the caller's own error message, not read or interpreted here.
 *
 * @param values - the write's own document-path variables, already read by the caller
 * @returns `{ ok: true, missing: [] }` when every value is configured, or `{ ok: false, missing
 *   }` naming every one that is not — a caller checks `ok` and, when false, has exactly what it
 *   needs to build its own refusal message without re-deriving which names failed.
 */
export function writeGuard(
  values: Readonly<Record<string, string | undefined>>,
): WriteGuardVerdict {
  const missing = Object.entries(values)
    .filter(([, v]) => v === undefined || v.trim() === "")
    .map(([name]) => name);
  return Object.freeze({ ok: missing.length === 0, missing: Object.freeze(missing) });
}
