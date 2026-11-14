/**
 * WHAT THIS MACHINE NEEDS, decided as data rather than as shell.
 *
 * The installer's whole job is to answer one question — "can this machine run Foliage?" —
 * and to answer it with an instruction rather than a stack trace. That answer is pure
 * logic over three inputs (a Node version string, Node's own type-stripping capability,
 * and a pnpm version string), so it lives here as pure functions that can be unit-tested
 * without spawning anything, and `preflight.mjs` does the spawning.
 *
 * THE NODE FLOOR IS NOT WHAT package.json SAYS, and this is measured, not recalled.
 * `engines.node` reads `>=22 <25`. A machine on 22.17.1 satisfies that and still dies:
 *
 *     $ node apps/leaf/server.mjs
 *     TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" ...
 *
 * because unflagged TypeScript type stripping — the mechanism that lets this repository
 * ship no build step and no `dist/` — did not land until 22.18.0. Worse, both
 * `apps/leaf/server.mjs` and `apps/leaf/intake.mjs` import `./src/preflight.ts`
 * STATICALLY, so the module graph links before any of their code runs and the friendly
 * explanation those files contain never executes. The check therefore has to happen out
 * here, before Node is ever asked to load a `.ts`.
 *
 * SO THE PRIMARY GATE IS A CAPABILITY PROBE, NOT VERSION ARITHMETIC:
 *
 *     node -e 'process.exit(process.features.typescript === "strip" ? 0 : 1)'
 *
 * That is exactly the property that matters. The version string is parsed only to write an
 * accurate message. A deliberate consequence: a 22.17.1 that *could* run with
 * `--experimental-strip-types` is refused, because the only way to pass that flag globally
 * is `NODE_OPTIONS`, which leaks into every other Node process on the machine. We will not
 * ship a flagged runtime.
 *
 * THE CEILING IS REAL TOO, and it is a product fact rather than a technical one: the servers
 * boot fine on Node 25, but `apps/photosynthesis/photosynthesis.mjs` hard-refuses
 * `major >= 25` with exit 2. Installing onto Node 25 would produce a machine where the leaf
 * renders and the harvest command refuses — half a product. The installer refuses the whole
 * thing rather than hand someone that state, and says which file draws the line.
 */

/** Unflagged type stripping — the mechanism this repository's no-build-step claim rests on. */
export const NODE_TYPE_STRIPPING_FLOOR = "22.18.0";

/** The first Node major `apps/photosynthesis/photosynthesis.mjs` refuses to run under. */
export const NODE_REFUSED_MAJOR = 25;

/** pnpm major floor, matching `engines.pnpm` and `packageManager` in the root package.json. */
export const PNPM_FLOOR_MAJOR = 11;

/**
 * @typedef {{ ok: true, version: string }} Satisfied
 * @typedef {{ ok: false, reason: string, found: string | null, message: string }} Unsatisfied
 * @typedef {Satisfied | Unsatisfied} Requirement
 */

/**
 * Parse `v22.18.0` / `22.18.0` / `11.4.0`. Returns null for anything that is not three
 * dot-separated integers — a version we cannot read is reported as unreadable rather than
 * guessed at, because guessing is how a check becomes decoration.
 *
 * @param {string | null | undefined} raw
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseVersion(raw) {
  if (typeof raw !== "string") return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** How to get a supported Node, in the three ways people actually have available. */
const NODE_REMEDY = [
  `  nvm:            nvm install 22 && nvm use 22`,
  `  fnm:            fnm install 22 && fnm use 22`,
  `  homebrew:       brew install node@22`,
  `  or download the LTS from https://nodejs.org/ (choose 22.18.0 or newer, below 25)`,
].join("\n");

/**
 * Decide whether a Node runtime can run Foliage.
 *
 * `typescript` is the value of `process.features.typescript` as reported by THAT runtime —
 * `"strip"` when unflagged type stripping is on, `"transform"` when full transforms are on,
 * `false`/`undefined` when neither is. It is the primary signal; `version` only shapes the
 * message.
 *
 * @param {{ version: string | null | undefined, typescript: unknown }} found
 * @returns {Requirement}
 */
export function checkNode(found) {
  if (found.version === null || found.version === undefined) {
    return {
      ok: false,
      reason: "absent",
      found: null,
      message:
        `Node is not installed, or is not on this shell's PATH.\n\n` +
        `Foliage runs its TypeScript sources directly — there is no build step — so it needs\n` +
        `Node ${NODE_TYPE_STRIPPING_FLOOR} or newer (and below ${NODE_REFUSED_MAJOR}).\n\n${NODE_REMEDY}`,
    };
  }

  const v = parseVersion(found.version);
  if (v === null) {
    return {
      ok: false,
      reason: "unreadable",
      found: found.version,
      message:
        `Node reported a version this installer cannot read: ${found.version}\n\n` +
        `Foliage needs Node ${NODE_TYPE_STRIPPING_FLOOR} or newer, below ${NODE_REFUSED_MAJOR}.\n` +
        `Nothing was installed, because proceeding would only move the failure later.\n\n${NODE_REMEDY}`,
    };
  }

  if (v.major >= NODE_REFUSED_MAJOR) {
    return {
      ok: false,
      reason: "too-new",
      found: found.version,
      message:
        `Node ${found.version} is too new for Foliage. The upper bound is not cosmetic:\n` +
        `apps/photosynthesis/photosynthesis.mjs refuses to run on Node ${NODE_REFUSED_MAJOR} or\n` +
        `above and exits 2, so installing here would give you a machine where the leaf page\n` +
        `renders and the harvest command will not run — half a working product.\n\n` +
        `Install a Node in the 22.${NODE_TYPE_STRIPPING_FLOOR.split(".")[1]}–24 range instead:\n\n${NODE_REMEDY}`,
    };
  }

  // THE REAL GATE. Asked of the runtime itself rather than inferred from its number, because
  // the number is a proxy and the capability is the requirement.
  if (found.typescript !== "strip" && found.typescript !== "transform") {
    return {
      ok: false,
      reason: "no-type-stripping",
      found: found.version,
      message:
        `Node ${found.version} cannot run TypeScript sources directly.\n\n` +
        `This is the exact requirement, checked by asking your Node rather than by reading its\n` +
        `version: process.features.typescript is ${JSON.stringify(found.typescript)}, and Foliage\n` +
        `needs "strip". Unflagged type stripping landed in Node ${NODE_TYPE_STRIPPING_FLOOR}.\n\n` +
        `Without it, the very first command fails with an unexplained\n` +
        `  TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"\n` +
        `so nothing has been installed.\n\n` +
        `NOT recommended: NODE_OPTIONS=--experimental-strip-types would make 22.17 and earlier\n` +
        `work, but that variable leaks into every other Node process on your machine. Install a\n` +
        `Node that does it unflagged:\n\n${NODE_REMEDY}`,
    };
  }

  return { ok: true, version: found.version };
}

/** How to get pnpm, cheapest route first. corepack ships inside Node 22. */
const PNPM_REMEDY = [
  `  corepack enable       (ships with Node; activates the pnpm pinned in package.json)`,
  `  npm install -g pnpm@${PNPM_FLOOR_MAJOR}`,
].join("\n");

/**
 * Decide whether a pnpm is usable for the one-time workspace install.
 *
 * pnpm is needed ONCE, to create the workspace symlinks the apps import through
 * (`@foliage/leaf`, `@foliage/tokens`, …). It is not a runtime dependency: after install,
 * `node` and a JSON file are the whole requirement.
 *
 * @param {{ version: string | null | undefined }} found
 * @returns {Requirement}
 */
export function checkPnpm(found) {
  if (found.version === null || found.version === undefined) {
    return {
      ok: false,
      reason: "absent",
      found: null,
      message:
        `pnpm is not installed, or is not on this shell's PATH.\n\n` +
        `Foliage needs it exactly once, to link the workspace packages the apps import.\n` +
        `It is not a runtime dependency — after the install, node and a JSON file are the\n` +
        `whole requirement.\n\n${PNPM_REMEDY}`,
    };
  }

  const v = parseVersion(found.version);
  if (v === null) {
    return {
      ok: false,
      reason: "unreadable",
      found: found.version,
      message:
        `pnpm reported a version this installer cannot read: ${found.version}\n\n` +
        `Foliage needs pnpm ${PNPM_FLOOR_MAJOR} or newer. Nothing was installed.\n\n${PNPM_REMEDY}`,
    };
  }

  if (v.major < PNPM_FLOOR_MAJOR) {
    return {
      ok: false,
      reason: "too-old",
      found: found.version,
      message:
        `pnpm ${found.version} is older than Foliage needs (${PNPM_FLOOR_MAJOR} or newer).\n\n` +
        `The workspace uses pnpm-workspace.yaml settings — including minimumReleaseAge, the\n` +
        `supply-chain guard that refuses freshly published packages — that older pnpm does not\n` +
        `honour. Installing with it would silently drop that protection.\n\n${PNPM_REMEDY}`,
    };
  }

  return { ok: true, version: found.version };
}

/**
 * bun floor for a developer checkout. bun builds the browser bundles (`pnpm run build:bundles`)
 * and stages the local brain's pinned gbrain (`tools/brain/stage-gbrain.mjs`, unit 38), whose own
 * floor is 1.3.10. It was needed and never checked. The packaged release does not need it.
 */
export const BUN_FLOOR = "1.3.10";

const BUN_REMEDY = [
  `  homebrew:       brew install oven-sh/bun/bun`,
  `  or the official installer from https://bun.sh/ (choose ${BUN_FLOOR} or newer; CI pins 1.3.14)`,
].join("\n");

/**
 * Decide whether a bun can build this checkout.
 *
 * @param {{ version: string | null | undefined }} found
 * @returns {Requirement}
 */
export function checkBun(found) {
  if (found.version === null || found.version === undefined) {
    return {
      ok: false,
      reason: "absent",
      found: null,
      message:
        `bun is not installed, or is not on this shell's PATH.\n\n` +
        `This checkout needs bun ${BUN_FLOOR} or newer to build its browser bundles and to stage the\n` +
        `local brain. Nothing that runs on a user's machine needs it.\n\n${BUN_REMEDY}`,
    };
  }
  const v = parseVersion(found.version);
  const floor = /** @type {{ major: number, minor: number, patch: number }} */ (parseVersion(BUN_FLOOR));
  if (v === null) {
    return {
      ok: false,
      reason: "unreadable",
      found: found.version,
      message: `bun reported a version this installer cannot read: ${found.version}\n\nThis checkout needs bun ${BUN_FLOOR} or newer.\n\n${BUN_REMEDY}`,
    };
  }
  const below = v.major !== floor.major ? v.major < floor.major : v.minor !== floor.minor ? v.minor < floor.minor : v.patch < floor.patch;
  if (below) {
    return {
      ok: false,
      reason: "too-old",
      found: found.version,
      message: `bun ${found.version} is older than this checkout needs (${BUN_FLOOR} or newer): the pinned gbrain the\nlocal brain stages refuses older bun.\n\n${BUN_REMEDY}`,
    };
  }
  return { ok: true, version: found.version };
}
