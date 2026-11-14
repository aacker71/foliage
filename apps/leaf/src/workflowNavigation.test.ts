import { test } from "node:test";
import { strict as assert } from "node:assert";
import { workflowHref, workflowLocation, workflowViews } from "./workflowNavigation.ts";

test("workspace links retain the intended view across reload and history navigation", () => {
  for (const view of workflowViews) assert.equal(workflowLocation(workflowHref(view))?.view, view);
  assert.deepEqual(workflowLocation("#sources"), { view: "Sources" });
  assert.deepEqual(workflowLocation("#background"), { view: "Background workflow" });
});
test("malformed or unrelated links recover to a usable workspace without interpreting source text", () => {
  assert.deepEqual(workflowLocation("#unknown"), { view: "Overview" });
  assert.deepEqual(workflowLocation("#sources/unrelated"), { view: "Sources" });
});
test("the workflow has no review view: old review links, saved or malformed, land on the Overview", () => {
  assert.deepEqual([...workflowViews], ["Overview", "Sources", "Background workflow"]);
  for (const hash of ["#review", "#review/private%2Fid", "#review/%"]) assert.deepEqual(workflowLocation(hash), { view: "Overview" });
});

test("the native skip link leaves the selected workspace view alone", () => {
  assert.equal(workflowLocation("#workspace-main"), null);
});
