/** Protocol adversaries, not live provider evidence. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createAssessmentCompanion } from "./assessmentConnection.ts";
test("companion pairing refuses browser origins, wrong keys and missing provider setup", () => {
  const secret = randomBytes(32).toString("hex");
  const c = createAssessmentCompanion({ FOLIAGE_COMPANION_KEY: secret });
  assert.equal(c.authorize(`Bearer ${secret}`, undefined), true);
  assert.equal(c.authorize(`Bearer ${secret}`, "http://127.0.0.1:53000"), false);
  assert.equal(c.authorize(`Bearer ${'0'.repeat(64)}`, undefined), false);
  assert.equal(c.authorize(undefined, undefined), false);
  assert.deepEqual(c.command("status", {}), { service: "foliage-assessment-companion", version: 1, ready: false, model: null });
  assert.throws(() => c.command("prepare", { transfer: {}, subject: { id: "regression", name: "Regression" } }));
  assert.equal(c.review("missing"), null);
});
