import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { documentDigest } from "@foliage/canopy";

import { loadManageState } from "./manageState.ts";

const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function temp(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "foliage-manage-state-"));
  roots.push(value);
  return value;
}

test("an example document is blocked whole before the manager renders portfolio facts", async () => {
  const dir = await temp();
  const leaf = join(dir, "leaf.json");
  await writeFile(leaf, `${JSON.stringify({ id: "example-leaf", subject: "Example subject", example: true, leaflets: [] })}\n`);

  const state = await loadManageState({
    FOLIAGE_LEAF: leaf,
    FOLIAGE_POLICY: join(dir, "absent-policy.json"),
    FOLIAGE_PUBLISHED: join(dir, "published"),
  });

  assert.equal(state.kind, "blocked");
  if (state.kind !== "blocked") return;
  assert.equal(state.cause, "publication-refused");
  assert.match(state.issues.join("\n"), /fabricated illustration/);
});

test("a malformed policy is a named hard failure, never a default-policy fallback", async () => {
  const dir = await temp();
  const leaf = join(dir, "leaf.json");
  const policy = join(dir, "policy.json");
  await writeFile(leaf, `${JSON.stringify({ id: "policy-test", subject: "Test subject", leaflets: [] })}\n`);
  await writeFile(policy, "{not json", "utf8");

  const state = await loadManageState({
    FOLIAGE_LEAF: leaf,
    FOLIAGE_POLICY: policy,
    FOLIAGE_PUBLISHED: join(dir, "published"),
  });

  assert.equal(state.kind, "blocked");
  if (state.kind !== "blocked") return;
  assert.equal(state.cause, "policy-unavailable");
  assert.match(state.detail, /not valid JSON/);
});

test("a legacy artifact is update-available until current publication rules are recorded", async () => {
  const dir = await temp();
  const leaf = join(dir, "leaf.json");
  const published = join(dir, "published");
  await mkdir(published);
  const leafBytes = `${JSON.stringify({ id: "legacy-leaf", subject: "Test subject", leaflets: [] })}\n`;
  await writeFile(leaf, leafBytes);
  await writeFile(join(published, "legacy-leaf.published.json"), `${JSON.stringify({
    artifact: "foliage/published-leaf",
    artifactVersion: 1,
    publishedAt: "2026-09-04T00:00:00Z",
    source: { documentDigest: documentDigest(Buffer.from(leafBytes)), documentBytes: Buffer.byteLength(leafBytes) },
    leaf: { id: "legacy-leaf", subject: "Test subject", subjectRedacted: false, leaflets: [] },
    withheld: { count: 0, kinds: [] },
  })}\n`);

  const state = await loadManageState({
    FOLIAGE_LEAF: leaf,
    FOLIAGE_POLICY: join(dir, "absent-policy.json"),
    FOLIAGE_PUBLISHED: published,
  });

  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") return;
  assert.equal(state.publication.kind, "update-available");
  if (state.publication.kind !== "update-available") return;
  assert.equal(state.publication.diff.sameSourceDocument, true);
  assert.equal(state.publication.diff.artifactMetadataChanged, true);
  assert.equal(state.publication.samePolicy, false);
});

test("policy drift alone makes a current-format artifact update-available", async () => {
  const dir = await temp();
  const leaf = join(dir, "leaf.json");
  const published = join(dir, "published");
  await mkdir(published);
  const leafBytes = `${JSON.stringify({ id: "policy-leaf", subject: "Test subject", leaflets: [] })}\n`;
  await writeFile(leaf, leafBytes);
  await writeFile(join(published, "policy-leaf.published.json"), `${JSON.stringify({
    artifact: "foliage/published-leaf",
    artifactVersion: 5,
    publishedAt: "2026-09-04T00:00:00Z",
    source: {
      documentDigest: documentDigest(Buffer.from(leafBytes)),
      documentBytes: Buffer.byteLength(leafBytes),
      policyDigest: `sha256:${"f".repeat(64)}`,
    },
    leaf: { id: "policy-leaf", subject: "Test subject", subjectRedacted: false, leaflets: [] },
    withheld: { count: 0, kinds: [] },
  })}\n`);

  const state = await loadManageState({
    FOLIAGE_LEAF: leaf,
    FOLIAGE_POLICY: join(dir, "absent-policy.json"),
    FOLIAGE_PUBLISHED: published,
  });

  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") return;
  assert.equal(state.publication.kind, "update-available");
  if (state.publication.kind !== "update-available") return;
  assert.equal(state.publication.diff.identical, true);
  assert.equal(state.publication.diff.sameSourceDocument, true);
  assert.equal(state.publication.samePolicy, false);
});
