import { test } from "node:test";
import assert from "node:assert/strict";

import { attributionLedger, leafId, type Leaf, type Leaflet } from "@foliage/leaf";
import { renderLeafFrond } from "./frond.ts";

const prov = { source: "git", ref: "abc1234", observedAt: "2026-08-20T00:00:00Z" };
const lf = (id: string, tier: Leaflet["tier"]): Leaflet =>
  (tier === "excluded"
    ? { id, title: `t-${id}`, tier, reason: "not attributable to this subject" }
    : { id, title: `t-${id}`, tier, provenance: prov }) as Leaflet;

const mixed = [lf("a", "verified"), lf("b", "pending"), lf("c", "pending"), lf("d", "excluded")];
const leafOf = (leaflets: Leaflet[]): Leaf => ({ id: leafId("l"), subject: "S", leaflets });

test("one ellipse per leaflet, in document order, carrying its own tier and nothing else", () => {
  const svg = renderLeafFrond(mixed, attributionLedger(leafOf(mixed)));
  const tiers = [...svg.matchAll(/data-frond-tier="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiers, ["verified", "pending", "pending", "excluded"]);
});

test("every leaflet is the same size — size would be a score in a costume", () => {
  const svg = renderLeafFrond(mixed, attributionLedger(leafOf(mixed)));
  assert.equal(new Set([...svg.matchAll(/rx="([\d.]+)"/g)].map((m) => m[1])).size, 1);
  assert.equal(new Set([...svg.matchAll(/ry="([\d.]+)"/g)].map((m) => m[1])).size, 1);
});

test("no hex colour and no text content inside the drawing — colour is the face's job", () => {
  const svg = renderLeafFrond(mixed, attributionLedger(leafOf(mixed)));
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3}/);
  assert.doesNotMatch(svg, /<text/);
  assert.doesNotMatch(svg, /fill=/);
});

test("the aria-label's numbers are the ledger's, and they are the only numbers a reader meets", () => {
  const ledger = attributionLedger(leafOf(mixed));
  const svg = renderLeafFrond(mixed, ledger);
  assert.match(svg, /aria-label="4 leaflets — 1 verified, 2 pending, 1 excluded/);
});

test("an empty document draws nothing rather than a bare stem", () => {
  assert.equal(renderLeafFrond([], attributionLedger(leafOf([]))), "");
});

test("58 leaflets still fit: spacing compresses inside its bounds instead of overflowing", () => {
  const many = Array.from({ length: 58 }, (_, i) => lf(`m${i}`, "pending"));
  const svg = renderLeafFrond(many, attributionLedger(leafOf(many)));
  assert.equal([...svg.matchAll(/<ellipse/g)].length, 58);
  const h = Number(svg.match(/viewBox="0 0 200 (\d+)"/)?.[1]);
  assert.ok(h > 0 && h <= 640, `height ${h} must stay inside the drawable bound`);
});

test("a full collection keeps a bounded compound silhouette with every real input record", () => {
  // Cardinality/geometry probes, not claimed evidence or a demo portfolio.
  for (const count of [13, 58, 235, 1000]) {
    const records = Array.from({ length: count }, (_, i) => lf(`geometry-${i}`, mixed[i % mixed.length]!.tier));
    const svg = renderLeafFrond(records, attributionLedger(leafOf(records)));
    const height = Number(svg.match(/viewBox="0 0 200 (\d+)"/)?.[1]);
    assert.ok(height <= 300 && height > 0, `${count} records must not turn the preview into a narrow strip`);
    const ellipses = [...svg.matchAll(/<ellipse[^>]+>/g)].map(match => match[0]);
    assert.equal(ellipses.length, count);
    const centers = ellipses.map(ellipse => Number(/cx="([\d.]+)"/.exec(ellipse)?.[1]));
    assert.ok(Math.min(...centers) < 45 && Math.max(...centers) > 155, "the complete silhouette has both sides");
    assert.equal(new Set(ellipses.map(ellipse => /rx="([\d.]+)"/.exec(ellipse)?.[1])).size, 1);
    assert.equal(new Set(ellipses.map(ellipse => /ry="([\d.]+)"/.exec(ellipse)?.[1])).size, 1);
    assert.deepEqual([...svg.matchAll(/data-frond-tier="([a-z]+)"/g)].map(match => match[1]), records.map(record => record.tier));
  }
});

test("opposite leaflets rotate around their own centres so the left half stays left", () => {
  const svg = renderLeafFrond(mixed, attributionLedger(leafOf(mixed)));
  for (const ellipse of [...svg.matchAll(/<ellipse[^>]+>/g)].map(match => match[0])) {
    const cx = Number(/cx="([\d.]+)"/.exec(ellipse)?.[1]);
    const cy = Number(/cy="([\d.]+)"/.exec(ellipse)?.[1]);
    const rotation = /rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)/.exec(ellipse);
    assert.deepEqual(rotation?.slice(1).map(Number), [cx, cy]);
  }
});
