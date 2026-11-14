/**
 * The Node floor, checked BEFORE any TypeScript module is linked — which is why this file is
 * `.mjs` and dependency-free.
 *
 * THE TRAP THIS CLOSES, measured 2026-08-24 by two independent DX reviewers: unflagged
 * type-stripping exists from Node 22.18.0. On 22.6–22.17, `pnpm check` is GREEN (the test
 * script passes `--experimental-strip-types` explicitly) and then every real entry point dies
 * at module LINK time with a raw ERR_UNKNOWN_FILE_EXTENSION stack — before any code, any
 * preflight, any catch runs. Two of three docs said "Node 22–24", so the green check was a
 * promise the first real command broke.
 *
 * A static import of a `.ts` file cannot be guarded by code in the same module: linking fails
 * before evaluation starts. So every entry CLI imports THIS module statically (pure `.mjs`,
 * always linkable), calls `requireNodeFloor()`, and only then dynamically imports its `.ts`
 * graph. The floor is the smallest version where the product's no-build-step posture works
 * unflagged; the ceiling stays `package.json` `engines`' job.
 */

export const NODE_FLOOR = "22.18.0";

/**
 * Pure verdict, so the comparison itself is testable without faking a process.
 * @param {string} version - like process.versions.node, e.g. "22.17.1"
 * @returns {{ ok: true } | { ok: false, detail: string }}
 */
export function nodeFloorVerdict(version) {
  const parts = version.split(".").map((n) => Number.parseInt(n, 10));
  const [major = 0, minor = 0, patch = 0] = parts;
  const [fMajor = 0, fMinor = 0, fPatch = 0] = NODE_FLOOR.split(".").map((n) => Number.parseInt(n, 10));
  const ok =
    major > fMajor ||
    (major === fMajor && (minor > fMinor || (minor === fMinor && patch >= fPatch)));
  if (ok) return { ok: true };
  return {
    ok: false,
    detail:
      `Foliage needs Node ${NODE_FLOOR}+ and this is ${version}. TypeScript sources run ` +
      `directly via type stripping, which is unflagged from ${NODE_FLOOR} — on ${version} the ` +
      `next import would die with a raw ERR_UNKNOWN_FILE_EXTENSION instead of this sentence. ` +
      `Upgrade (e.g. \`nvm install 22\` for the current 22.x) and re-run.`,
  };
}

/** The entry-point form: print the remedy and exit 2 (a usage-class failure) below the floor. */
export function requireNodeFloor() {
  const verdict = nodeFloorVerdict(process.versions.node);
  if (!verdict.ok) {
    process.stderr.write(`${verdict.detail}\n`);
    process.exit(2);
  }
}
