/**
 * The one redaction rule (F-021), tested where it lives.
 *
 * ALL TEXT HERE IS INVENTED. Addresses sit under the reserved `example.com`, `example.org` and
 * `.invalid` names (RFC 2606/6761) so none can resolve to a real mailbox, and the people are
 * made up. It exercises the mechanism; nothing here is rendered or presented as anyone's evidence.
 *
 * F-021 was two email patterns disagreeing: `apps/leaf/export.mjs` kept its own, without the
 * apostrophe, and against `contact o'brien@…` it matched only `brien@…`, so the `o'` would have sat
 * next to the placeholder that claimed the whole address was gone. These tests pin the shared rule
 * on the cases that split the two, and pin that unifying them narrowed neither.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { detectRedactableSpans, redactIdentifiers } from "./redaction.ts";

const addressesIn = (text: string): readonly string[] =>
  detectRedactableSpans(text, ["email-address"]).map((s) => text.slice(s.start, s.end));

test("F-021: an apostrophe in the local part is part of the address, so no fragment is left beside the placeholder", () => {
  const title = "contact o'brien@my-domain.example.com about it";
  assert.deepEqual(addressesIn(title), ["o'brien@my-domain.example.com"]);
  assert.equal(redactIdentifiers(title).text, "contact [withheld: email address] about it");
});

test("multi-label and hyphenated domains are taken whole, and a sentence's closing period is not", () => {
  assert.deepEqual(addressesIn("ping d'angelo@sub.my-domain.example.org today"), ["d'angelo@sub.my-domain.example.org"]);
  assert.deepEqual(addressesIn("see rowan.vale@mail.eu.northwind.invalid."), ["rowan.vale@mail.eu.northwind.invalid"]);
  assert.equal(
    redactIdentifiers("see rowan.vale@mail.eu.northwind.invalid.").text,
    "see [withheld: email address].",
  );
});

test("an address inside a title is cut out and the rest of the title stands", () => {
  const title = "docs: route billing questions to help.desk@eu.billing.example.org before release";
  const r = redactIdentifiers(title);
  assert.equal(r.text, "docs: route billing questions to [withheld: email address] before release");
  assert.deepEqual(r.spans.map((s) => s.kind), ["email-address"]);
});

test("unifying the two rules narrowed neither: shapes only the old export rule caught are still caught", () => {
  // The old export pattern allowed empty domain labels; the old publication pattern did not. A
  // typo'd address is still somebody's address, so the shared rule keeps both.
  assert.deepEqual(addressesIn("mail rowan@northwind..invalid now"), ["rowan@northwind..invalid"]);
  assert.deepEqual(addressesIn("mail rowan@.northwind.invalid now"), ["rowan@.northwind.invalid"]);
});

test("not addresses: a version pin and a scoped package name are left alone", () => {
  for (const title of ["chore: bump npm@1.2.3", "chore: bump @foliage/leaf and @types/node"]) {
    assert.deepEqual(addressesIn(title), [], title);
    assert.equal(redactIdentifiers(title).text, title, title);
  }
});

test("the kinds filter runs only the named detectors, so an address inside a trailer is still an address", () => {
  const title = "fix: retry Co-authored-by: Rowan Vale <rowan@northwind.invalid>";
  assert.deepEqual(addressesIn(title), ["rowan@northwind.invalid"]);
  // Unfiltered, the trailer (name AND address) wins the overlap, exactly as the gate reports it.
  assert.deepEqual(detectRedactableSpans(title).map((s) => s.kind), ["identity-trailer"]);
});
