import assert from "node:assert/strict";
import { test } from "node:test";
import { renderKeystones, renderPersonHero } from "./person-portfolio.ts";

test("authored presentation escapes text and supports a biography without inferred direction or achievements", () => {
  const html = renderPersonHero({ subject: "<script>subject</script>", biography: "An exact paragraph.\nA second line & its context." });
  assert.ok(html.includes('data-person-layout="biography"'));
  assert.ok(html.includes('id="personal-subject-h"'));
  assert.ok(html.includes("&lt;script&gt;subject&lt;/script&gt;"));
  assert.ok(html.includes("An exact paragraph.\nA second line &amp; its context."));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("data-person-direction"));
  assert.ok(!html.includes("data-person-passions"));
  assert.ok(!html.includes(">Direction<"));
  assert.equal(renderKeystones({ items: [] }), "");
});

test("a selected collection has a native hidden state without removing achievement IDs or rewriting their summaries", () => {
  const items = [
    { id: "reference-a", title: "<exact title>", summary: "A supplied summary, unchanged.", href: "/leaf/achievement?id=reference-a", collectionIds: ["scope-a"] },
    { id: "reference-b", title: "Another supplied title", href: "/leaf/achievement?id=reference-b", collectionIds: ["scope-b"] },
  ];
  const html = renderKeystones({ items, selectedCollection: "scope-a" });
  const first = html.match(/<li[^>]+data-achievement-id="reference-a"[^>]*>/)?.[0];
  const second = html.match(/<li[^>]+data-achievement-id="reference-b"[^>]*>/)?.[0];
  assert.ok(first && !first.includes("hidden"));
  assert.ok(second?.includes('hidden=""'));
  assert.ok(html.includes('data-collection-ids="[&quot;scope-a&quot;]"'));
  assert.ok(html.includes("&lt;exact title&gt;"));
  assert.ok(html.includes("A supplied summary, unchanged."));
  assert.equal((html.match(/data-achievement-id=/g) ?? []).length, 2);
  const unfiltered = renderKeystones({ items });
  assert.equal((unfiltered.match(/<li[^>]*hidden=""/g) ?? []).length, 0);
  assert.ok(renderKeystones({ items, selectedCollection: "empty-scope" }).includes('data-portfolio-keystone-empty="">No achievements in this view'));
});
