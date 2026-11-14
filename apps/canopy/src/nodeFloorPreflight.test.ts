/**
 * `apps/canopy/server.mjs`'s Node-floor guard.
 *
 * THE GAP THIS PINS. Every other real entry point in this repository — apps/leaf/server.mjs,
 * intake.mjs, harvest.mjs, apps/photosynthesis/photosynthesis.mjs — calls
 * `requireNodeFloor()` (apps/leaf/src/nodeFloor.mjs) before any `.ts` module is linked. This
 * server had NONE: its three domain imports were plain STATIC `import ... from "./src/x.ts"`
 * declarations, which is worse than merely missing a check — a static ESM import is HOISTED
 * and LINKED before any of this module's own code runs, so even placing a guard as the very
 * first statement of the file would not have helped; the crash happens during linking, on a
 * line that executes before the guard's line is ever reached. Closing this needed the imports
 * to become dynamic `await import(...)` calls, reached only after the guard returns — the exact
 * mechanism apps/leaf/server.mjs already uses.
 *
 * A real sub-floor Node binary cannot be assumed to exist on the machine running this suite
 * (the floor logic itself is proven at the boundary in apps/leaf/src/nodeFloor.test.ts), so the
 * WIRING is verified by reading the CLI's own source — the same technique
 * packages/foliage-tokens/src/tokens.test.ts uses for its own invariants — plus the existing
 * apps/canopy/src/seam.test.ts, which spawns this exact process and proves it still serves real
 * pages end to end after the static-to-dynamic conversion.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");

test("no .ts module is imported with a STATIC import — every one hoists above any guard", () => {
  assert.doesNotMatch(
    SOURCE,
    /^\s*import\s[^;]*from\s+["']\.\/src\/[^"']+\.ts["']/m,
    "a static `.ts` import links before this file's own code runs, including before " +
      "requireNodeFloor() — it must be a dynamic await import() instead",
  );
});

test("the shared floor guard is imported and called before the domain's .ts modules", () => {
  assert.match(
    SOURCE,
    /import\(["']\.\.\/leaf\/src\/nodeFloor\.mjs["']\)/,
    "must import from the shared apps/leaf/src/nodeFloor.mjs, the same module server.mjs, " +
      "intake.mjs, harvest.mjs and photosynthesis.mjs already use",
  );
  const guardAt = SOURCE.indexOf("requireNodeFloor()");
  const firstTsImportAt = SOURCE.search(/import\(["']\.\/src\/[^"']+\.ts["']\)/);
  assert.ok(guardAt >= 0, "requireNodeFloor() call not found");
  assert.ok(firstTsImportAt >= 0, "no dynamic .ts import found to compare against");
  assert.ok(
    guardAt < firstTsImportAt,
    "the floor guard must run before any .ts module is dynamically imported",
  );
});

test("every domain import this file used to declare statically is still present, dynamically", () => {
  // `loadPublishedLeaf`/`renderPublishedPage` joined this list at the 2026-08-27 fork merge:
  // the /leaf/:id precedence (D2 + addendum, .loop/MERGE-DECISIONS.md) binds both mechanisms.
  for (const name of ["httpStatusFor", "loadTreeDocument", "renderTreePage", "renderPublicLeafPage", "resolvePublicLeaflet", "loadPublishedLeaf", "renderPublishedPage"]) {
    assert.ok(SOURCE.includes(name), `${name} must still be imported — the conversion must not drop a binding`);
  }
});
