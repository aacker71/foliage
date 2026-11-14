/** Renderer contract inputs only; no person's work or publication is represented here. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePublishedDocument } from "@foliage/canopy";
import { renderHostedBridge } from "./renderHostedBridge.ts";
import type { LocalHostedView } from "./localHostedBridge.ts";
import type { ManageState } from "./manageState.ts";
import { renderPublishedLeafletPage, renderPublishedPage } from "./renderPublished.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const still = { sourceRef: digest("a"), renditionDigest: digest("b"), bytes: 100, format: "png" as const,
  alt: "Protocol still" };
const clip = { sourceRef: digest("c"), bytes: 1000, durationSeconds: 6, posterRef: still.sourceRef,
  caption: "Protocol clip" };

function published() {
  const parsed = parsePublishedDocument({ artifact: "foliage/published-leaf", artifactVersion: 7,
    publishedAt: "2026-10-07T00:00:00Z",
    source: { documentDigest: digest("d"), documentBytes: 1, policyDigest: digest("e") },
    leaf: { id: "video-render-contract", subject: "Protocol subject", subjectRedacted: false,
      leaflets: [{ id: "protocol", title: "Protocol item", tier: "pending", titleRedacted: false,
        photos: [still], videos: [clip] }] },
    withheld: { count: 0, kinds: [] } });
  assert.ok(parsed.ok);
  return parsed.document;
}

test("public reader leads with one selected clip and its actual poster, without duplicating the still", () => {
  const document = published();
  const load = { ok: true as const, id: document.leaf.id, document,
    source: { path: "protocol-only", bytes: 1, artifactDigest: digest("f"), readAt: "2026-10-07T00:00:00Z" } };
  const urls = { photoUrl: () => "/selected-still", videoUrl: () => "/selected-clip" };
  for (const html of [renderPublishedPage(load, urls), renderPublishedLeafletPage(document, "protocol", urls.photoUrl, urls.videoUrl)!]) {
    assert.match(html, /data-published-content="context"/);
    assert.match(html, /<video controls playsinline preload="none" poster="\/selected-still" aria-label="Demo of Protocol clip">/);
    assert.match(html, /<source src="\/selected-clip" type="video\/mp4">/);
    assert.match(html, /<span class="fol-metric">6 s<\/span>/);
    assert.doesNotMatch(html, /<figure class="pub-photo">|\bautoplay\b|https?:\/\/[^<"]+\.mp4/);
    assert.match(html, new RegExp(clip.sourceRef));
  }
  const noVideoTransport = renderPublishedPage(load, { photoUrl: urls.photoUrl });
  assert.match(noVideoTransport, /Selected demo unavailable in this reader/);
  assert.match(noVideoTransport, /<figure class="pub-photo">/);
  assert.doesNotMatch(noVideoTransport, /<video\b/);
});

test("local Prepare keeps photo and demo as separate unchecked choices beside a real poster preview", () => {
  const local = { kind: "ready", sourceDigest: digest("d"), policyDigest: digest("e"),
    leaf: { leaflets: [{ id: "protocol", title: "Protocol item", tier: "pending", body: [] }] },
    preview: { leaf: { leaflets: [{ id: "protocol", title: "Protocol item", tier: "pending" }] } },
    photoChoices: [{ leaflet: 0, element: 0, title: "Protocol item", photo: still, issue: null, caption: null }],
    videoChoices: [{ leaflet: 0, element: 1, title: "Protocol item", video: clip, issue: null, caption: "Protocol clip" }] } as unknown as ManageState;
  const view = { connected: true, origin: "https://contract.invalid", prepared: null, operation: null, remote: null } as unknown as LocalHostedView;
  const html = renderHostedBridge(view, local, "contract-csrf");
  assert.match(html, /<details open><summary>Images and demos<\/summary>/);
  assert.match(html, /poster="\/hosted\/photo\/[a-f0-9]{64}\/[a-f0-9]{64}"/);
  assert.match(html, /<source src="\/hosted\/video\/[a-f0-9]{64}" type="video\/mp4">/);
  assert.match(html, /name="photo-select-0-0"/);
  assert.match(html, /name="video-select-0-1"/);
  assert.match(html, /name="video-digest-0-1"/);
  assert.match(html, /name="video-caption-0-1"/);
  assert.doesNotMatch(html, /name="(?:photo|video)-select-[^"]+"[^>]*checked|\bautoplay\b/);
});
