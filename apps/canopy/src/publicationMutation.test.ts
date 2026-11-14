import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPublicationUnchanged,
  withPublicationLock,
} from "./publicationMutation.mjs";

test("a release failure stays separate from a successful public mutation", async () => {
  let changed = false;
  const cleanupFailure = new Error("injected cleanup failure");

  const result = await withPublicationLock(
    "/tmp/example.published.json",
    async () => {
      changed = true;
      return "written";
    },
    async () => async () => {
      throw cleanupFailure;
    },
  );

  assert.equal(changed, true);
  assert.equal(result.value, "written");
  assert.equal(result.mutationError, null);
  assert.equal(result.releaseWarning, cleanupFailure);
});

test("a mutation failure remains primary when releasing the lock also fails", async () => {
  const mutationFailure = new Error("injected mutation failure");
  const cleanupFailure = new Error("injected cleanup failure");

  const result = await withPublicationLock(
    "/tmp/example.published.json",
    async () => {
      throw mutationFailure;
    },
    async () => async () => {
      throw cleanupFailure;
    },
  );

  assert.equal(result.mutationError, mutationFailure);
  assert.equal(result.releaseWarning, cleanupFailure);
});

test("replacement compares the exact reviewed bytes even when both artifacts are invalid", () => {
  const reviewed = {
    state: "unparsable" as const,
    detail: "same summarized parse failure",
    artifactDigest: `sha256:${"1".repeat(64)}`,
  };
  const changed = {
    state: "unparsable" as const,
    detail: "same summarized parse failure",
    artifactDigest: `sha256:${"2".repeat(64)}`,
  };

  assert.throws(
    () => assertPublicationUnchanged(reviewed, changed, "/tmp/example.published.json"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ESTALEPUBLIC" &&
      /changed after the review/.test(error.message),
  );
});
