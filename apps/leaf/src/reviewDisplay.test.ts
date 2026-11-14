import { test } from "node:test";
import assert from "node:assert/strict";
import { compactDraftTitle } from "./reviewDisplay.ts";

test("compact review previews hide only a matching collector label", () => {
  assert.equal(compactDraftTitle("git-cluster:unprefixed:2", "unprefixed: Built search; fixed intake (+2 more)"), "Built search; fixed intake (+2 more)");
  assert.equal(compactDraftTitle("git-cluster:feat", "A title the owner changed"), "A title the owner changed");
  assert.equal(compactDraftTitle("integration:one", "unprefixed: Owner wording"), "unprefixed: Owner wording");
});
