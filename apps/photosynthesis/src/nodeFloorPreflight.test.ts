/**
 * `photosynthesis.mjs`'s Node-floor guard.
 *
 * THE BUG THIS PINS. The inline preflight this replaced read only the MAJOR version —
 * `major < 22 || major >= 25` — so it passed on 22.6 through 22.17, exactly the band where
 * unflagged type-stripping does not exist yet and every `.ts` import two lines down would die
 * at module LINK time with a raw `ERR_UNKNOWN_FILE_EXTENSION`, before this file's own guard (or
 * anything else) ever ran. `apps/leaf/src/nodeFloor.mjs`'s `NODE_FLOOR` is exact to the patch
 * (22.18.0) and is already proven against that exact band in `nodeFloor.test.ts`; this file pins
 * that `photosynthesis.mjs` actually reaches for the SAME shared guard rather than a second,
 * looser copy of the check silently reappearing.
 *
 * A real Node binary below 22.18 cannot be assumed to exist on the machine running this suite,
 * so the wiring is verified by reading the CLI's own source (the same technique
 * `packages/foliage-tokens/src/tokens.test.ts` uses for its own invariants, e.g. "the superseded
 * coil is named exactly once") and, separately, by proving the CLI still runs cleanly past the
 * guard on THIS machine's real (floor-clearing) Node — a regression in the wiring that broke
 * normal startup would show up here even though the below-floor band itself cannot be exercised.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const CLI_PATH = fileURLToPath(new URL("../photosynthesis.mjs", import.meta.url));
const SOURCE = readFileSync(CLI_PATH, "utf8");
const exec = promisify(execFile);

test("the inline major-only Node check is GONE — it missed the 22.18 floor by design", () => {
  // The literal CODE this replaced, not the prose describing it (this file's own header
  // comment names the old expression verbatim, so matching on that pattern alone would flag
  // its own documentation as a regression).
  assert.doesNotMatch(
    SOURCE,
    /const major = Number\(process\.versions\.node/,
    "the old major-only extraction (misses the 22.6–22.17 band) must not reappear",
  );
  assert.doesNotMatch(
    SOURCE,
    /process\.versions\.node\.split\(/,
    "no hand-rolled version parsing may remain — the floor comparison belongs to nodeFloor.mjs alone",
  );
});

test("the CLI reaches for the SHARED floor guard, not a second copy of the logic", () => {
  assert.match(
    SOURCE,
    /import\(["']\.\.\/leaf\/src\/nodeFloor\.mjs["']\)/,
    "must import from the shared apps/leaf/src/nodeFloor.mjs, the same module server.mjs, " +
      "intake.mjs and harvest.mjs already use",
  );
  assert.match(SOURCE, /requireNodeFloor\(\)/, "must actually CALL the guard, not just import it");
});

test("the guard runs BEFORE the first .ts import can be linked", () => {
  const guardAt = SOURCE.indexOf("requireNodeFloor()");
  const firstTsImportAt = SOURCE.search(/from ["']\.\/src\/[^"']+\.ts["']|import\(["']\.\/src\/[^"']+\.ts["']\)/);
  assert.ok(guardAt >= 0, "requireNodeFloor() call not found");
  assert.ok(firstTsImportAt >= 0, "no .ts import found to compare against");
  assert.ok(
    guardAt < firstTsImportAt,
    "the floor guard must run before any .ts module is imported — a static .ts import hoists " +
      "and links before this file's own code runs, so ordering here is load-bearing",
  );
});

test("on THIS machine's real (floor-clearing) Node, the CLI still starts and reaches its own usage check", async () => {
  // No --repo/--subject/--identity: proves execution passed the floor guard and every dynamic
  // .ts import cleanly, and reached the CLI's OWN argument validation — the guard did not
  // regress the normal startup path for everyone who is safely above the floor.
  await assert.rejects(
    exec(process.execPath, [CLI_PATH], { encoding: "utf8" }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 2, `expected the usage-error exit code; stderr:\n${e.stderr}`);
      assert.match(e.stderr ?? "", /missing required argument\(s\)/);
      return true;
    },
  );
});
