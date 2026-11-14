import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { PUBLISHED_ARTIFACT, PUBLISHED_ARTIFACT_VERSION } from "@foliage/canopy";

import { loadPublicationInventory } from "./publicationInventory.ts";
import { PUBLISHED_ENV } from "./publishedLeaf.ts";

const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "foliage-publication-inventory-"));
  roots.push(value);
  return value;
}

function artifact(): Record<string, unknown> {
  return {
    artifact: PUBLISHED_ARTIFACT,
    artifactVersion: PUBLISHED_ARTIFACT_VERSION,
    publishedAt: "2026-09-04T00:00:00Z",
    source: {
      documentDigest: `sha256:${"a".repeat(64)}`,
      documentBytes: 2,
      policyDigest: `sha256:${"b".repeat(64)}`,
    },
    leaf: { id: "valid-leaf", subject: "Test subject", subjectRedacted: false, leaflets: [] },
    withheld: { count: 0, kinds: [] },
  };
}

test("inventory names valid malformed and unreadable public state independently of the local leaf", async () => {
  const dir = await root();
  await writeFile(join(dir, "valid-leaf.published.json"), `${JSON.stringify(artifact())}\n`);
  await writeFile(join(dir, "broken-leaf.published.json"), "{broken", "utf8");
  await mkdir(join(dir, "blocked-leaf.published.json"));
  await writeFile(join(dir, "not-a-publication.txt"), "ignored", "utf8");

  const inventory = await loadPublicationInventory({ [PUBLISHED_ENV]: dir });
  assert.equal(inventory.kind, "ready");
  if (inventory.kind !== "ready") return;
  assert.deepEqual(inventory.items.map((item) => [item.id, item.kind]), [
    ["blocked-leaf", "unreadable"],
    ["broken-leaf", "invalid"],
    ["valid-leaf", "valid"],
  ]);
  assert.equal(inventory.items[0]?.artifactDigest, null);
  assert.match(inventory.items[0]?.detail ?? "", /could not be identified/);
  assert.match(inventory.items[1]?.artifactDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(inventory.items[2]?.subject, "Test subject");
});

test("an absent publications directory is an honest empty inventory", async () => {
  const dir = await root();
  const inventory = await loadPublicationInventory({ [PUBLISHED_ENV]: join(dir, "not-created") });
  assert.deepEqual(inventory, { kind: "ready", items: [] });
});
