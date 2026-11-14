import { test } from "node:test";
import assert from "node:assert/strict";

import { isMediaDigestRef, parseLeafDocument } from "./document.ts";
import {
  attributionLedger,
  isMediaBodyElement,
  leafletVisibility,
  MEDIA_TYPES,
} from "./leaf.ts";

/**
 * Every document in this file is a PARSER INPUT, not portfolio content: each one exists to
 * pin a specific accept/reject decision. None of it is rendered anywhere, and a passing
 * suite here proves the format is enforced — it does not imply any real evidence exists.
 */

const instant = "2026-08-13T00:00:00Z";
const prov = { source: "git", ref: "e3b4489", observedAt: instant };

function issuesAt(value: unknown): string[] {
  const parsed = parseLeafDocument(value);
  assert.equal(parsed.ok, false, "expected the document to be rejected");
  return parsed.ok ? [] : parsed.issues.map((i) => i.at);
}

test("a well-formed document parses into a Leaf whose ledger counts every tier", () => {
  const parsed = parseLeafDocument({
    id: "leaf-under-test",
    subject: "Parser Input",
    leaflets: [
      { id: "a", title: "verified item", tier: "verified", provenance: prov },
      { id: "b", title: "pending item", tier: "pending" },
      { id: "c", title: "excluded item", tier: "excluded", reason: "different author identity" },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const ledger = attributionLedger(parsed.leaf);
  assert.deepEqual(
    { v: ledger.verified, p: ledger.pending, e: ledger.excluded },
    { v: 1, p: 1, e: 1 },
  );
  assert.equal(parsed.declaredExample, false);
});

test("AN EMPTY leaflets ARRAY IS VALID — an empty portfolio is not a missing one", () => {
  // The distinction this whole capability turns on. A valid document with nothing in it must
  // parse, so the renderer can say "this leaf has no leaflets yet" instead of "no document
  // found". Collapsing the two is the `commitCount: 0` failure.
  const parsed = parseLeafDocument({ id: "l", subject: "Parser Input", leaflets: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.leaf.leaflets.length, 0);
  assert.deepEqual(attributionLedger(parsed.leaf).exclusionReasons, []);
});

test("a MISSING leaflets field is rejected, and says an empty array is the way to say empty", () => {
  const parsed = parseLeafDocument({ id: "l", subject: "Parser Input" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "leaflets");
  assert.ok(issue, "expected an issue at leaflets");
  assert.match(issue.message, /empty array \[\] is valid/);
});

test("an excluded leaflet without a reason is rejected, naming the leaflet index", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "a", title: "ok", tier: "verified", provenance: prov },
        { id: "b", title: "no reason given", tier: "excluded" },
      ],
    }),
    ["leaflets[1].reason"],
  );
});

test("a verified leaflet without provenance is rejected", () => {
  // Verification with no record of what was observed is an assertion, not a proof.
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "trust me", tier: "verified" }],
    }),
    ["leaflets[0].provenance"],
  );
});

test("A SCORE-SHAPED FIELD IS REFUSED BY NAME, not silently ignored", () => {
  // The FCRA posture at the ingest boundary. Ignoring the key would let documents in the wild
  // carry a rating that a later version might honour.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    score: 0.96,
    leaflets: [],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "score");
  assert.ok(issue, "expected the score field to be reported");
  assert.match(issue.message, /refused by name/);
  assert.match(issue.message, /never as a number that reads like a score/);
});

test("score-shaped fields are caught inside a leaflet too", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "a", title: "t", tier: "pending", confidence: 0.4 },
        { id: "b", title: "t", tier: "pending", percentile: 90 },
      ],
    }),
    ["leaflets[0].confidence", "leaflets[1].percentile"],
  );
});

test("an unknown field is refused so a misspelling cannot become an invisible omission", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "t", tier: "excluded", reasson: "typo" }],
    }),
    // Both: the typo'd key AND the reason that is therefore missing.
    ["leaflets[0].reasson", "leaflets[0].reason"],
  );
});

test("`reason` on a non-excluded leaflet is refused rather than accepted and never shown", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "t", tier: "pending", reason: "would never render" }],
    }),
    ["leaflets[0].reason"],
  );
});

test("an unknown tier is rejected and the message states the tiers are unordered", () => {
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "gold" }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0]!.message, /unordered; none is "higher"/);
});

test("observedAt must be an instant WITH an offset", () => {
  for (const observedAt of ["2026-08-13", "2026-08-13T00:00:00", "yesterday", ""]) {
    assert.deepEqual(
      issuesAt({
        id: "l",
        subject: "Parser Input",
        leaflets: [
          { id: "a", title: "t", tier: "verified", provenance: { ...prov, observedAt } },
        ],
      }).filter((at) => at.endsWith("observedAt")),
      ["leaflets[0].provenance.observedAt"],
      `expected "${observedAt}" to be rejected`,
    );
  }
  // And the two legal shapes are accepted.
  for (const observedAt of ["2026-08-13T09:41:00Z", "2026-08-13T09:41:00.500+02:00"]) {
    const parsed = parseLeafDocument({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "t", tier: "verified", provenance: { ...prov, observedAt } }],
    });
    assert.equal(parsed.ok, true, `expected "${observedAt}" to be accepted`);
  }
});

test("duplicate leaflet ids are rejected", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "same", title: "one", tier: "pending" },
        { id: "same", title: "two", tier: "pending" },
      ],
    }),
    ["leaflets[1].id"],
  );
});

test("EVERY problem is reported at once, not just the first", () => {
  // A parser that stops at the first error turns fixing a file into a guessing loop.
  const parsed = parseLeafDocument({
    subject: "",
    leaflets: [
      { id: "a", title: "t", tier: "verified" },
      { title: "no id", tier: "nope" },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.issues.length >= 4, `expected several issues, got ${parsed.issues.length}`);
  assert.deepEqual(
    parsed.issues.map((i) => i.at).sort(),
    ["id", "leaflets[0].provenance", "leaflets[1].id", "leaflets[1].tier", "subject"],
  );
});

test("one invalid leaflet rejects the WHOLE document — no partial success", () => {
  // Rendering the survivors would make the page assert a smaller portfolio than the file
  // describes, which is a quiet lie rather than a loud failure.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      { id: "good", title: "t", tier: "verified", provenance: prov },
      { id: "bad", title: "t", tier: "excluded" },
    ],
  });
  assert.equal(parsed.ok, false);
});

test("the parser never throws, whatever it is handed", () => {
  for (const input of [null, undefined, 0, "", "a string", [], [1, 2], true, NaN]) {
    const parsed = parseLeafDocument(input);
    assert.equal(parsed.ok, false, `${String(input)} must be rejected, not thrown on`);
    if (!parsed.ok) assert.ok(parsed.issues.length > 0, "a rejection must carry a reason");
  }
});

test("a document may declare itself an example, and that travels with the parse result", () => {
  const parsed = parseLeafDocument({
    id: "l",
    subject: "EXAMPLE SUBJECT",
    example: true,
    leaflets: [],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.declaredExample, true);
  // And it stays off the domain type: nothing downstream can mistake it for leaf content.
  assert.ok(!("example" in parsed.leaf));
});

/* ── THE BODY: a list of grounded elements ──────────────────────────────────────────────── */

test("a body of grounded elements parses, and each element keeps its OWN ref", () => {
  // The shape ledger row F9 exists for: an artifact that can substantiate a count it prints,
  // because every ref it rests on is in the document rather than one of seven.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "parser input: 2 refs",
        tier: "pending",
        provenance: prov,
        body: [
          { provenance: prov, text: "one claim, sourced to the ref beside it" },
          { provenance: { source: "git", ref: "9a1c2d4", observedAt: instant } },
        ],
      },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const body = parsed.leaf.leaflets[0]!.body!;
  assert.equal(body.length, 2);
  assert.equal(body[0]!.provenance.ref, "e3b4489");
  assert.equal(body[0]!.text, "one claim, sourced to the ref beside it");
  // An element with a ref and no words is legitimate: honest evidence, no invented prose.
  assert.equal(body[1]!.provenance.ref, "9a1c2d4");
  assert.ok(!("text" in body[1]!));
  assert.ok(Object.isFrozen(body));
  assert.ok(Object.isFrozen(body[0]));
});

test("A BODY ELEMENT WITHOUT PROVENANCE IS REFUSED — must-ground holds element-wise", () => {
  // The whole reason the body is a list and not a paragraph. Prose with no ref must not be
  // representable, so an element that is only prose is refused rather than rendered
  // ungrounded beside elements that are sourced.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "t",
        tier: "pending",
        body: [{ provenance: prov }, { text: "sounds true, points at nothing" }],
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[1].provenance");
  assert.ok(issue, "expected the ungrounded element to be named by index");
  assert.match(issue.message, /every body element carries its own evidence ref/);
});

test("A SCORE-SHAPED KEY IS REFUSED BY NAME INSIDE A BODY ELEMENT TOO", () => {
  // A body is more surface for a rating to hide in, not less. The refusal reaches all the way
  // down, and it still names the key rather than silently dropping it.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "t",
        tier: "pending",
        body: [
          { provenance: prov, confidence: 0.9 },
          { provenance: prov, weight: 3 },
        ],
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.deepEqual(
    parsed.issues.map((i) => i.at),
    ["leaflets[0].body[0].confidence", "leaflets[0].body[1].weight"],
  );
  assert.match(parsed.issues[0]!.message, /refused by name/);
  assert.match(parsed.issues[0]!.message, /never as a number that reads like a score/);
});

test("an unknown key inside a body element is refused, same rule one level deeper", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "a", title: "t", tier: "pending", body: [{ provenance: prov, note: "typo'd text" }] },
      ],
    }),
    ["leaflets[0].body[0].note"],
  );
});

test("the instant rule reaches into the body: an offsetless element ref is refused", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        {
          id: "a",
          title: "t",
          tier: "pending",
          body: [{ provenance: { source: "git", ref: "9a1c2d4", observedAt: "2026-08-13" } }],
        },
      ],
    }),
    ["leaflets[0].body[0].provenance.observedAt"],
  );
});

test("a body that is a string is refused — a paragraph has nowhere to live in this format", () => {
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "t",
        tier: "pending",
        body: "Led the migration, unblocked the team, and drove adoption.",
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.issues[0]!.at, "leaflets[0].body");
  assert.match(parsed.issues[0]!.message, /must be an array of grounded elements/);
  assert.match(parsed.issues[0]!.message, /hides between two true ones/);
});

test("an EMPTY body is refused, and says to omit the key instead", () => {
  // The opposite call from `leaflets: []`, and deliberately: that field is required, so [] is
  // the only way to say empty. This one is optional, so [] would be a second spelling.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending", body: [] }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.issues[0]!.at, "leaflets[0].body");
  assert.match(parsed.issues[0]!.message, /omit the key instead/);
});

test("a body element's text must be a real sentence when the key is present", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "a", title: "t", tier: "pending", body: [{ provenance: prov, text: "   " }] },
      ],
    }),
    ["leaflets[0].body[0].text"],
  );
});

test("a body element that is not an object is refused, naming its index", () => {
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        { id: "a", title: "t", tier: "pending", body: [{ provenance: prov }, "just a string"] },
      ],
    }),
    ["leaflets[0].body[1]"],
  );
});

test("a body is gated on every tier, including excluded", () => {
  // `excluded` carries a reason and may still rest on evidence; nothing about the tier
  // loosens the element-wise gate.
  assert.deepEqual(
    issuesAt({
      id: "l",
      subject: "Parser Input",
      leaflets: [
        {
          id: "a",
          title: "t",
          tier: "excluded",
          reason: "different author identity",
          body: [{ text: "ungrounded even here" }],
        },
      ],
    }),
    ["leaflets[0].body[0].provenance"],
  );
});

/* ── MEDIA: the photograph IS the artifact ──────────────────────────────────────────────── */

/**
 * A REAL SHA-256, re-derivable by anyone reading this file:
 *
 *   printf 'parser input' | shasum -a 256
 *
 * Written as a literal rather than computed in the test for the same reason the instants are:
 * this suite exercises the PARSER, and hashing inside it would test node:crypto. It is a real
 * digest of a real (tiny) input so that nothing here is a hex string somebody invented — the one
 * habit that makes a digest look checkable while being unfalsifiable.
 */
const digest = "sha256:f1957a929316de8c5a572635243f8269ff69cb7d8d6e7339e8d50d449117401e";
const otherDigest = "sha256:21bef641430c85d8a4a58371dd31d43405fb8b7b6034faa9b24c1a0b180f494a";
const photoProv = { source: "photo", ref: digest, observedAt: instant };
const jpeg = { mediaType: "image/jpeg", dimensions: { known: true, width: 4032, height: 3024 } };

/** A document carrying one media element, so each test varies exactly one thing. */
function withMedia(media: unknown, provenance: unknown = photoProv): unknown {
  return {
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending", body: [{ provenance, media }] }],
  };
}

test("A MEDIA ELEMENT PARSES — the photograph is carried, not converted to a sentence", () => {
  // The gap this closes: photo intake already hashed the bytes and then discarded the image,
  // keeping one drafted line about it. A welder's portfolio cannot survive that trade.
  const parsed = parseLeafDocument(
    withMedia(jpeg) as Record<string, unknown>,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const element = parsed.leaf.leaflets[0]!.body![0]!;
  assert.ok(isMediaBodyElement(element), "the element must read back as media");
  if (!isMediaBodyElement(element)) return;
  assert.equal(element.media.mediaType, "image/jpeg");
  assert.deepEqual(element.media.dimensions, { known: true, width: 4032, height: 3024 });
  // THE DIGEST IS THE NAME: no second identifier was parsed, so the ref is the only handle.
  assert.equal(element.provenance.ref, digest);
  assert.ok(Object.isFrozen(element.media));
  assert.ok(Object.isFrozen(element.media.dimensions));
});

test("A MEDIA ELEMENT STILL REQUIRES PROVENANCE — the rule does not weaken because it is visual", () => {
  // An unsourced photograph is exactly as unsourced as an unsourced sentence. "But you can see
  // it" is not a citation.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending", body: [{ media: jpeg }] }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].provenance");
  assert.ok(issue, "expected the ungrounded media element to be named by index");
  assert.match(issue.message, /every body element carries its own evidence ref/);
});

test("THE REF MUST BE THE DIGEST — a path or a commit sha names something else", () => {
  // The whole property media buys: hash what was served and compare. It only exists while the
  // reference and the bytes cannot disagree, so a ref that is not a digest is refused.
  for (const ref of [
    "photos/weld-2026-08.jpg",
    "e3b4489",
    "f1957a929316de8c5a572635243f8269ff69cb7d8d6e7339e8d50d449117401e", // no algorithm
    "sha256:F1957A929316DE8C5A572635243F8269FF69CB7D8D6E7339E8D50D449117401E", // uppercase
    "sha256:f1957a92", // truncated
    "md5:f1957a929316de8c5a572635243f8269",
  ]) {
    const parsed = parseLeafDocument(withMedia(jpeg, { source: "photo", ref, observedAt: instant }));
    assert.equal(parsed.ok, false, `expected "${ref}" to be refused as a media ref`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].provenance.ref");
    assert.ok(issue, `expected the ref to be reported for "${ref}"`);
    assert.match(issue.message, /must BE the content digest/);
    assert.match(issue.message, /hash what they received and compare/);
  }
});

test("the digest rule applies ONLY to media elements — a text element keeps its commit sha", () => {
  // Refusing a commit sha everywhere would break every git-derived body in existence, and a
  // commit sha is a perfectly good handle for the thing it actually names.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending", body: [{ provenance: prov }] }],
  });
  assert.equal(parsed.ok, true);
});

test("isMediaDigestRef is exported so the producer and the gate cannot drift apart", () => {
  // Photo intake builds `sha256:${digest}` one layer earlier. A second copy of this rule there
  // would drift, and the product would then refuse files it wrote itself.
  assert.equal(isMediaDigestRef(digest), true);
  assert.equal(isMediaDigestRef(otherDigest), true);
  assert.equal(isMediaDigestRef("sha256:not-hex"), false);
  assert.equal(isMediaDigestRef(""), false);
});

test("AN UNKNOWN MEDIA TYPE IS REFUSED, and the message names the closed list", () => {
  for (const mediaType of ["image/bmp", "application/pdf", "jpeg", "", 4, null]) {
    const parsed = parseLeafDocument(withMedia({ ...jpeg, mediaType }));
    assert.equal(parsed.ok, false, `expected ${String(mediaType)} to be refused`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media.mediaType");
    assert.ok(issue, "expected the media type to be reported");
    assert.match(issue.message, /image\/jpeg/);
    assert.match(issue.message, /list is closed/);
  }
});

test("SVG IS REFUSED, and the message says why rather than leaving it to look like an oversight", () => {
  // Not aesthetics: an SVG is a document that executes, and it can reach the network from the
  // page a stranger opens — which is the exact claim this product makes about itself.
  const parsed = parseLeafDocument(withMedia({ ...jpeg, mediaType: "image/svg+xml" }));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media.mediaType");
  assert.ok(issue);
  assert.match(issue.message, /document that executes/);
  assert.match(issue.message, /MP4 is the only video type/);
});

test("every accepted media type round-trips, including captured MP4", () => {
  for (const mediaType of MEDIA_TYPES) {
    const parsed = parseLeafDocument(withMedia({ ...jpeg, mediaType }));
    assert.equal(parsed.ok, true, `expected "${mediaType}" to be accepted`);
    if (!parsed.ok) return;
    const element = parsed.leaf.leaflets[0]!.body![0]!;
    assert.ok(isMediaBodyElement(element));
    if (!isMediaBodyElement(element)) return;
    assert.equal(element.media.mediaType, mediaType);
  }
  assert.deepEqual(MEDIA_TYPES.filter((t) => t.startsWith("video/")), ["video/mp4"]);
});

test("AN UNKNOWN SIZE CARRIES ITS CAUSE — and a zero is refused in its place", () => {
  const unknown = parseLeafDocument(
    withMedia({
      mediaType: "image/heic",
      dimensions: { known: false, why: "sips is not installed on this machine" },
    }),
  );
  assert.equal(unknown.ok, true);
  if (!unknown.ok) return;
  const element = unknown.leaf.leaflets[0]!.body![0]!;
  assert.ok(isMediaBodyElement(element));
  if (!isMediaBodyElement(element)) return;
  assert.deepEqual(element.media.dimensions, {
    known: false,
    why: "sips is not installed on this machine",
  });

  // `commitCount: 0` at the scale of one field: zero is not a size, it is the shape a missing
  // measurement takes when nobody made room for a cause.
  for (const dimensions of [
    { known: true, width: 0, height: 0 },
    { known: true, width: 4032, height: 0 },
    { known: true, width: -1, height: 10 },
    { known: true, width: 1.5, height: 10 },
    { known: true, width: "4032", height: "3024" },
    { known: true },
  ]) {
    const parsed = parseLeafDocument(withMedia({ ...jpeg, dimensions }));
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(dimensions)} to be refused`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media.dimensions");
    assert.ok(issue, `expected the dimensions to be reported for ${JSON.stringify(dimensions)}`);
    assert.match(issue.message, /never a zero standing in for one/);
  }
});

test("an unknown size with NO reason is refused — 'not measured' with no cause is the absence", () => {
  for (const why of [undefined, "", "   ", 0, null]) {
    const parsed = parseLeafDocument(
      withMedia({ ...jpeg, dimensions: why === undefined ? { known: false } : { known: false, why } }),
    );
    assert.equal(parsed.ok, false, `expected why=${String(why)} to be refused`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media.dimensions.why");
    assert.ok(issue, "expected the missing reason to be reported");
    assert.match(issue.message, /missing decoder from an/);
  }
});

test("MISSING dimensions are refused — omission would hide which of two facts is true", () => {
  const parsed = parseLeafDocument(withMedia({ mediaType: "image/png" }));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media.dimensions");
  assert.ok(issue);
  assert.match(issue.message, /nobody looked/);
});

test("a non-boolean `known` is refused, and a score-shaped neighbour is STILL named", () => {
  // The trap: bailing out before the key check would let a `confidence` beside a broken `known`
  // go unmentioned. A rating nobody was told about is worse than a rating that was refused.
  assert.deepEqual(
    issuesAt(withMedia({ ...jpeg, dimensions: { known: "yes", confidence: 0.9 } })),
    [
      "leaflets[0].body[0].media.dimensions.confidence",
      "leaflets[0].body[0].media.dimensions.known",
    ],
  );
});

test("A SCORE-SHAPED KEY IS REFUSED BY NAME INSIDE MEDIA TOO", () => {
  // A media element is more surface for a rating to hide in, not less.
  assert.deepEqual(
    issuesAt(withMedia({ ...jpeg, rating: 5 })),
    ["leaflets[0].body[0].media.rating"],
  );
  assert.deepEqual(
    issuesAt(withMedia({ mediaType: "image/png", dimensions: { known: true, width: 8, height: 8, weight: 3 } })),
    ["leaflets[0].body[0].media.dimensions.weight"],
  );
});

test("A SECOND IDENTIFIER IS REFUSED — two names for one artifact is a disagreement waiting", () => {
  // `url`, `path`, `filename` are all the same mistake: the ref already names these bytes, and a
  // name that can drift from the digest is the thing this format exists to make impossible.
  for (const key of ["url", "path", "filename", "id", "digest"]) {
    assert.deepEqual(
      issuesAt(withMedia({ ...jpeg, [key]: "photos/weld.jpg" })),
      [`leaflets[0].body[0].media.${key}`],
      `expected "${key}" to be refused inside media`,
    );
  }
});

test("media that is not an object is refused, and says where identity actually lives", () => {
  for (const media of ["sha256:deadbeef", 4, null, [jpeg]]) {
    const parsed = parseLeafDocument(withMedia(media));
    assert.equal(parsed.ok, false, `expected ${String(media)} to be refused`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].body[0].media");
    assert.ok(issue, "expected the media field to be reported");
    assert.match(issue.message, /that is provenance.ref/);
  }
});

test("the instant rule reaches into a media element's provenance", () => {
  assert.deepEqual(
    issuesAt(withMedia(jpeg, { source: "photo", ref: digest, observedAt: "2026-08-13" })),
    ["leaflets[0].body[0].provenance.observedAt"],
  );
});

test("a media element may carry a caption, and it is optional exactly as on a text element", () => {
  // Optional is load-bearing: an image with a ref and no words is honest evidence, and inventing
  // a sentence to fill the field is the fabrication a describer must never be allowed to commit.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "t",
        tier: "pending",
        body: [
          { provenance: photoProv, media: jpeg, text: "one claim about this photograph" },
          { provenance: { source: "photo", ref: otherDigest, observedAt: instant }, media: jpeg },
        ],
      },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const body = parsed.leaf.leaflets[0]!.body!;
  assert.equal(body[0]!.text, "one claim about this photograph");
  assert.ok(!("text" in body[1]!), "the key must stay absent, not become undefined");
});

test("an EMPTY body is still refused when the format can carry media", () => {
  // Requirement restated as a test because it is exactly the kind of gate a new element type
  // gets accidentally routed around.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending", body: [] }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0]!.message, /omit the key instead/);
});

test("A DOCUMENT WITHOUT MEDIA PARSES UNCHANGED, and does not acquire the key", () => {
  // Every file written before media existed is still a valid file, and a gate that edits the
  // document it is judging is a gate nobody can reason about.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [
      {
        id: "a",
        title: "t",
        tier: "pending",
        provenance: prov,
        body: [{ provenance: prov, text: "written before media was representable" }],
      },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const element = parsed.leaf.leaflets[0]!.body![0]!;
  assert.ok(!("media" in element), "an absent media key must stay absent");
  assert.equal(isMediaBodyElement(element), false);
});

/* ── PER-LEAFLET VISIBILITY ─────────────────────────────────────────────────────────────── */

test("VISIBILITY DEFAULTS TO PRIVATE BY ABSENCE, and the parser does not write it in", () => {
  // Absence must not be materialised: a gate that edits the document it is judging would
  // rewrite a field into files that never mentioned one.
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "pending" }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const leaflet = parsed.leaf.leaflets[0]!;
  assert.ok(!("visibility" in leaflet), "the key must stay absent, not become undefined");
  assert.equal(leafletVisibility(leaflet), "private");
});

test("each of the three visibility states parses and survives onto the leaflet", () => {
  for (const visibility of ["private", "unlisted", "public"] as const) {
    const parsed = parseLeafDocument({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "t", tier: "pending", visibility }],
    });
    assert.equal(parsed.ok, true, `expected "${visibility}" to be accepted`);
    if (!parsed.ok) return;
    assert.equal(leafletVisibility(parsed.leaf.leaflets[0]!), visibility);
  }
});

test("an unknown visibility is refused, and the message states the safe default", () => {
  for (const visibility of ["live", "published", "shared", true, 1, null]) {
    const parsed = parseLeafDocument({
      id: "l",
      subject: "Parser Input",
      leaflets: [{ id: "a", title: "t", tier: "pending", visibility }],
    });
    assert.equal(parsed.ok, false, `expected ${String(visibility)} to be rejected`);
    if (parsed.ok) return;
    const issue = parsed.issues.find((i) => i.at === "leaflets[0].visibility");
    assert.ok(issue, "expected the visibility to be reported");
    assert.match(issue.message, /private, unlisted, public/);
    assert.match(issue.message, /shareable by omission/);
  }
});

test("the parsed leaf is frozen, so a view cannot edit the evidence it was given", () => {
  const parsed = parseLeafDocument({
    id: "l",
    subject: "Parser Input",
    leaflets: [{ id: "a", title: "t", tier: "excluded", reason: "r" }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.ok(Object.isFrozen(parsed.leaf));
  assert.ok(Object.isFrozen(parsed.leaf.leaflets));
  assert.ok(Object.isFrozen(parsed.leaf.leaflets[0]));
});

/* ==========================================================================================
   THE AUTHORED HEADLINE (DT-1) — the one field a machine may never write, so the parser is
   where its rules live: one line, the subject's words, and never a score in any voice.
   ========================================================================================== */

test("a headline parses onto the leaf, trimmed, and an absent one stays absent", () => {
  const withOne = parseLeafDocument({
    id: "leaf-under-test",
    subject: "Parser Input",
    headline: "  Infrastructure for evidence-backed attribution.  ",
    leaflets: [],
  });
  assert.equal(withOne.ok, true);
  if (!withOne.ok) return;
  assert.equal(withOne.leaf.headline, "Infrastructure for evidence-backed attribution.");

  const without = parseLeafDocument({ id: "leaf-under-test", subject: "Parser Input", leaflets: [] });
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.equal("headline" in without.leaf, false, "absent must be absent, not empty");
});

test("a rating-shaped headline is refused whoever wrote it", () => {
  // The review queue refuses "4.9/5" from a human reviewer; the subject's own line gets the
  // same rule. The product prints counts and facts, never a score, in any voice.
  assert.deepEqual(
    issuesAt({
      id: "leaf-under-test",
      subject: "Parser Input",
      headline: "Rated 4.9/5 by everyone I ever worked with",
      leaflets: [],
    }),
    ["headline"],
  );
});

test("a headline can name a measured percentage without rating its author", () => {
  const parsed = parseLeafDocument({
    id: "leaf-under-test",
    subject: "Parser Input",
    headline: "Reduced p99 latency by 40% while preserving HTTP 409/500 responses",
    leaflets: [],
  });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (parsed.ok) assert.match(parsed.leaf.headline ?? "", /p99 latency by 40%/);
});

test("a headline is one line — a line break is refused, not silently flattened", () => {
  assert.deepEqual(
    issuesAt({
      id: "leaf-under-test",
      subject: "Parser Input",
      headline: "First line\nsecond line",
      leaflets: [],
    }),
    ["headline"],
  );
});
