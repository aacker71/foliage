import { test } from "node:test";
import assert from "node:assert/strict";

import { sourceRepoFor, type SourceRepoInputs } from "./sourceRepo.ts";

/** Synthetic paths only: nothing here is read from disk. */
const none: SourceRepoInputs = { env: {}, harvestRepo: undefined, watched: [], workflowSources: [] };
const on = (path: string) => ({ path, enabled: true });
const off = (path: string) => ({ path, enabled: false });

test("an explicit FOLIAGE_SOURCE_REPO wins over every recorded source", () => {
  assert.equal(
    sourceRepoFor({ env: { FOLIAGE_SOURCE_REPO: "/explicit" }, harvestRepo: "/harvest", watched: ["/watched"], workflowSources: [on("/workflow")] }),
    "/explicit",
  );
});

test("a blank FOLIAGE_SOURCE_REPO is unset, not an answer", () => {
  assert.equal(sourceRepoFor({ ...none, env: { FOLIAGE_SOURCE_REPO: "  " }, harvestRepo: "/harvest" }), "/harvest");
});

test("the harvest's recorded repository comes next", () => {
  assert.equal(sourceRepoFor({ ...none, harvestRepo: "/harvest", watched: ["/watched"], workflowSources: [on("/workflow")] }), "/harvest");
});

test("then the one watched source", () => {
  assert.equal(sourceRepoFor({ ...none, watched: ["/watched"], workflowSources: [on("/workflow")] }), "/watched");
});

test("then the one enabled workflow source, only when nothing is watched", () => {
  assert.equal(sourceRepoFor({ ...none, workflowSources: [off("/paused"), on("/workflow")] }), "/workflow");
});

test("two or more candidates at any step answer nothing — never a guess", () => {
  assert.equal(sourceRepoFor({ ...none, watched: ["/a", "/b"], workflowSources: [on("/workflow")] }), undefined);
  assert.equal(sourceRepoFor({ ...none, workflowSources: [on("/a"), on("/b")] }), undefined);
  assert.equal(sourceRepoFor(none), undefined);
});

test("an unreadable list answers nothing rather than skipping past it", () => {
  assert.equal(sourceRepoFor({ ...none, watched: null, workflowSources: [on("/workflow")] }), undefined);
  assert.equal(sourceRepoFor({ ...none, workflowSources: null }), undefined);
});

test("one path named twice is still one repository", () => {
  assert.equal(sourceRepoFor({ ...none, workflowSources: [on("/a"), on("/a")] }), "/a");
  assert.equal(sourceRepoFor({ ...none, watched: ["/a", "/a"] }), "/a");
});
