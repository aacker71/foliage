/** Protocol fixtures: no person's work or outcome is asserted here. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePublishedDocument, toArtifactJson } from "./publishedDocument.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const photo = { sourceRef: digest("a"), renditionDigest: digest("b"), bytes: 100,
  format: "png", alt: "Reviewed still from the clip" };
const video = { sourceRef: digest("c"), bytes: 1000, durationSeconds: 6,
  posterRef: photo.sourceRef };

function artifact() {
  return { artifact: "foliage/published-leaf", artifactVersion: 7,
    publishedAt: "2026-10-07T00:00:00Z",
    source: { documentDigest: digest("d"), documentBytes: 1, policyDigest: digest("e") },
    leaf: { id: "video-contract", subject: "Protocol subject", subjectRedacted: false,
      leaflets: [{ id: "item", title: "Protocol item", tier: "pending", titleRedacted: false,
        photos: [photo], videos: [video] }] },
    withheld: { count: 0, kinds: [] } };
}

test("v7 round-trips only selected video refs with a selected poster", () => {
  const parsed = parsePublishedDocument(artifact());
  assert.ok(parsed.ok);
  assert.deepEqual(toArtifactJson(parsed.document), artifact());
  assert.equal(parsed.document.leaf.leaflets[0]?.videos?.[0]?.posterRef, photo.sourceRef);
});

test("legacy publications refuse video fields and v7 refuses unselected posters", () => {
  const old = artifact(); old.artifactVersion = 6;
  assert.equal(parsePublishedDocument(old).ok, false);
  const noPoster = artifact(); noPoster.leaf.leaflets[0]!.photos = [];
  const missing = parsePublishedDocument(noPoster);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.ok(missing.issues.some(issue => issue.at.endsWith("videos[0]") && /selected photo/.test(issue.message)));
  const oversized = artifact(); oversized.leaf.leaflets[0]!.videos[0]!.bytes = 1024 * 1024 + 1;
  assert.equal(parsePublishedDocument(oversized).ok, false);
});
