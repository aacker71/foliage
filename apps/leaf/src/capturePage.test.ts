import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCapturePage } from "./capturePage.ts";

test("capture page makes the real demo and review action primary, and escapes observed page text", () => {
  const html = renderCapturePage({ records: [{ id: "capture-12345678-1234-1234-1234-123456789abc", url: "http://127.0.0.1:4444/work%3Cscript%3E", capturedAt: "2026-10-07T00:00:02Z", durationSeconds: 6, screenshotHref: "/leaf/capture/media/capture-12345678-1234-1234-1234-123456789abc/still", videoHref: "/leaf/capture/media/capture-12345678-1234-1234-1234-123456789abc/video", action: { label: "Review demo", href: "/review?focus=demo%3Asha256%3Atest", primary: true }, rejected: false }] });
  assert.match(html, /<video controls playsinline preload="metadata" poster="\/leaf\/capture\/media\//);
  assert.match(html, /<source src="\/leaf\/capture\/media\/[^\"]+\/video" type="video\/mp4">/);
  assert.match(html, /class="fol-button fol-button-primary" href="\/review\?focus=/);
  assert.match(html, /<form method="post" action="\/leaf\/capture">/);
  assert.match(html, /Capture with Foliage/);
  assert.match(html, /Foliage opens this page in a private browser\. The still and clip go to Review\./);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /autoplay|controlslist="nodownload"/);
});

test("a saved demo with an unqueued still offers the repair action", () => {
  const html = renderCapturePage({ records: [{ id: "capture-12345678-1234-1234-1234-123456789abc", url: "http://127.0.0.1:4444/", capturedAt: "2026-10-07T00:00:02Z", durationSeconds: 6, screenshotHref: "/still", videoHref: "/video", action: null, rejected: false }] });
  assert.match(html, /name="action" value="queue"/);
  assert.match(html, /Add demo to Review/);
  assert.doesNotMatch(html, /Still saved in review/);
});

test("a decided still points at the next real action rather than a second review", () => {
  const base = { id: "capture-123456", url: "http://127.0.0.1:4444/", capturedAt: "2026-10-07T00:00:02Z", durationSeconds: 6, screenshotHref: "/still", videoHref: "/video" };
  const approved = renderCapturePage({ records: [{ ...base, action: { label: "Add to record", href: "/review#review-promote-h", primary: true }, rejected: false }] });
  assert.match(approved, /Add to record/);
  assert.doesNotMatch(approved, /Review demo/);
  const retained = renderCapturePage({ records: [{ ...base, action: { label: "Open work", href: "/my/leaflet/photo", primary: false }, rejected: false }] });
  assert.match(retained, /Open work/);
  assert.doesNotMatch(retained, /Add demo to Review/);
  const rejected = renderCapturePage({ records: [{ ...base, action: null, rejected: true }] });
  assert.match(rejected, /Rejected from record/);
  assert.doesNotMatch(rejected, /Add demo to Review/);
});
