/** UI state probes use an actual repository commit; they are not portfolio evidence. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { leafletId } from "@foliage/leaf";
import { renderLeafletAssistance } from "./leafletAssistance.ts";
const cwd = new URL("../../..", import.meta.url);
const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
const title = execFileSync("git", ["show", "-s", "--format=%s", ref], { cwd, encoding: "utf8" }).trim();
const record = { id: leafletId(`git:${ref}`), title, tier: "pending" as const };
test("selected private evidence reaches the real local and cloud-review entry points", () => {
  const html = renderLeafletAssistance(record);
  assert.ok(html.includes(`/scarlet/workspace?leaflet=${encodeURIComponent(record.id)}`));
  assert.ok(html.includes(`/leaf/review-export?leaflet=${encodeURIComponent(record.id)}`));
  assert.match(html, /Connection not checked/);
  assert.doesNotMatch(html, /<form|<textarea|disabled/);
  const disconnected = renderLeafletAssistance(record, { localModelConfigured: false, ladybug: { connected: false, ready: false, model: null, detail: "Companion unavailable <script>" } });
  assert.match(disconnected, /No local model/);
  assert.match(disconnected, /Companion unavailable &lt;script&gt;/);
});
test("shared and excluded records cannot enter the pending/private revision handoff", () => {
  for (const item of [{ ...record, visibility: "public" as const }, { ...record, visibility: "unlisted" as const }, { ...record, tier: "excluded" as const, reason: "Protocol state probe; no attribution claimed." }]) {
    const html = renderLeafletAssistance(item);
    assert.doesNotMatch(html, /\/leaf\/review-export/);
    assert.match(html, /Pending, private Leaflets only/);
    assert.ok(html.includes(`/scarlet/workspace?leaflet=${encodeURIComponent(record.id)}`));
  }
});
