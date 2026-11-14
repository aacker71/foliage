/**
 * F-021, the publication side: the gate redacts with the SAME rule the open plane exports, and
 * keeps no pattern of its own to drift from it.
 *
 * ALL TEXT HERE IS INVENTED, under reserved names (RFC 2606/6761). It exercises the mechanism.
 *
 * The direction of the dependency is the licensing boundary's: canopy may import from
 * `@foliage/leaf`, never the reverse (`public-boundary.json`), so the rule lives in leaf and this
 * file checks the gate agrees with it on every case that split the two old patterns.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { leafId, leafletId, redactIdentifiers, type Leaf } from "@foliage/leaf";

import { redactPublicationText, reviewForPublication } from "./publish.ts";

const CASES: readonly (readonly [string, string])[] = [
  ["contact o'brien@my-domain.example.com about it", "contact [withheld: email address] about it"],
  ["ping d'angelo@sub.my-domain.example.org today", "ping [withheld: email address] today"],
  [
    "docs: route billing questions to help.desk@eu.billing.example.org before release",
    "docs: route billing questions to [withheld: email address] before release",
  ],
  // Only the old export pattern caught these two. One rule, so the gate catches them now too.
  ["mail rowan@northwind..invalid now", "mail [withheld: email address] now"],
  ["mail rowan@.northwind.invalid now", "mail [withheld: email address] now"],
  ["chore: bump npm@1.2.3", "chore: bump npm@1.2.3"],
];

test("the publication gate and the open-plane rule redact every case identically, with one placeholder", () => {
  for (const [input, expected] of CASES) {
    assert.equal(redactPublicationText(input), expected, input);
    assert.equal(redactIdentifiers(input).text, expected, input);
  }
});

test("a published title carrying an apostrophe address keeps no fragment of it", () => {
  const leaf: Leaf = {
    id: leafId("leaf-rule"),
    subject: "Wren Halloway",
    leaflets: [
      {
        id: leafletId("git:rule0001"),
        title: "fix: contact o'brien@my-domain.example.com about it",
        tier: "verified",
        provenance: { source: "git", ref: "rule0001", observedAt: "2026-08-15T22:21:43.057Z" },
        visibility: "public",
      },
    ],
  };
  const r = reviewForPublication({ leaf, declaredExample: false });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.published.leaflets[0]?.title, "fix: contact [withheld: email address] about it");
  assert.ok(!JSON.stringify(r).includes("brien"), "no part of the address survives in the page or the report");
});
