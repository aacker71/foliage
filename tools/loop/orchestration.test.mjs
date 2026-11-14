/** F-023: the retired runtime must not return under an unused-file exemption. The
 * ledger requires a mechanical guard before recording this deletion as fixed. */
import { equal, doesNotMatch } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("F-023: no live retired development loop or hidden knip exemption remains", () => {
  for (const path of ["foliage-dev-loop.workflow.js", "run-once.sh", "com.foliage.devloop.plist"]) {
    equal(existsSync(new URL(`../../.loop/${path}`, import.meta.url)), false);
  }
  doesNotMatch(readFileSync(new URL("../../knip.jsonc", import.meta.url), "utf8"), /foliage-dev-loop\.workflow\.js/);
  equal(existsSync(new URL("../../.claude/workflows/three-pass-review.js", import.meta.url)), true,
    "retiring development orchestration must preserve the independent review gate");
});
