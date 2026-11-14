import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Is a surface SERVING, or did a socket merely answer?
 *
 * WHY THIS IS ITS OWN FILE. The decision lived inline in `verify.mjs` as an unconditional
 * `ok(\`reachable (HTTP ${status})\`)`, so a server throwing 500 and a route that does not exist
 * both printed PASS. Measured 2026-08-19: photosynthesis answered **500** and canopy `/tree`
 * answered **404**, both reported reachable, and the twelve `no element for …` failures that
 * followed read as a design problem rather than as "the page never rendered" — the harness that
 * exists to catch failure-rendering-as-success was committing it, and sending an operator to look
 * at CSS for a server fault.
 *
 * It is a separate module rather than an export from `verify.mjs` because `verify.mjs` is a
 * SCRIPT: importing it boots surfaces, drives a browser and prints a report. A test that imported
 * it ran the whole harness as a side effect. That is the mechanical reason this logic went
 * unguarded — not carelessness, but that nothing inside a top-level-effect script can be reached
 * by a test. Pure decisions belong where a test can call them.
 */

/**
 * @param {number} status  the HTTP status the surface answered with
 * @param {boolean} started  whether verify booted it, or found it already running
 * @returns {{ serving: boolean, message: string }}
 */
export function servingVerdict(status, started) {
  const how = started ? "started by verify" : "already running";
  if (status < 400) return { serving: true, message: `reachable (HTTP ${status}, ${how})` };
  return {
    serving: false,
    message:
      `SERVING-${status} (${how}) — the port answered but the surface did not render. Every ` +
      `element check below will fail for that reason, not for a design one.`,
  };
}

/**
 * A surface's unmet precondition, or null — the ONE spelling of the `requires` gate.
 *
 * Both consumers (`verify.mjs`'s SKIP branch and `serve.mjs`'s `up()`) call THIS rather than
 * each reading `surface.requires` themselves: round 2 of PR #22's seams pass found the rule
 * spelled twice with neither copy tested, which is how a future edit to one caller lets
 * `serve up export-site` silently boot against whatever `FOLIAGE_SITE` holds — the exact
 * stale-export corpse the gate exists to prevent, regressing through the uncovered entry point.
 *
 * @param {{ port?: number, requires?: (env: Record<string, string | undefined>) => string | null }} surface
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} the named unmet precondition, or null when the surface may run
 */
export function unmetPrecondition(surface, env) {
  return surface.requires?.(env) ?? null;
}

/**
 * The counts a surface CONTRACTS to be zero, rendered as verdicts rather than information.
 *
 * WHY: the export-site row shipped saying "both must read 0 on any export" in a comment while
 * the runner printed counts on an info line and exited 0 regardless — a regression would have
 * printed ALL CHECKS PASSED over a nonzero count. That is the failure-rendering-as-success
 * this module exists to refuse, found by PR #22's correctness pass before it could ship.
 * An unmeasured contractual count fails too: "we did not look" is not "it was zero".
 *
 * @param {readonly string[]} mustBeZero  count names the surface contracts to be exactly 0
 * @param {Record<string, number>} counts  what the probe measured
 * @returns {{ ok: boolean, message: string }[]}
 */
export function contractualZeroVerdicts(mustBeZero, counts) {
  return mustBeZero.map((name) => {
    const v = counts[name];
    if (v === undefined) return { ok: false, message: `count "${name}" is contractually zero but was never measured` };
    if (v === 0) return { ok: true, message: `${name} = 0 — the contractual zero holds` };
    return { ok: false, message: `${name} = ${v} — this surface contracts ZERO of these` };
  });
}

/** An HTTP listener is reusable only when it serves the requested surface identity. */
/** @param {{port: number, responseIdentity?: (env: NodeJS.ProcessEnv) => {header: string, value: string}}} surface
 * @param {Response} response @param {NodeJS.ProcessEnv} env */
export function responseMismatch(surface, response, env) {
  const expected = surface.responseIdentity?.(env);
  if (expected === undefined || response.headers.get(expected.header) === expected.value) return null;
  return `the listener on port ${surface.port} does not identify the selected folder — stop that server or use its original FOLIAGE_SITE`;
}

/** Missing row text is valid on a measured empty page; an unmeasured count is not empty. */
/** @param {{optional?: boolean, optionalWhenEmpty?: string}} contrast @param {Record<string, number>} counts */
export function contrastIsOptional(contrast, counts) {
  return contrast.optional === true ||
    (contrast.optionalWhenEmpty !== undefined && counts[contrast.optionalWhenEmpty] === 0);
}

/** Direct execution remains direct through a symlink (including macOS /tmp). */
/** @param {string} url */
export function isEntryPoint(url) {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
