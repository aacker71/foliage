/**
 * THE PARSE GATE for a published artifact, and the re-publish diff.
 *
 * WHAT THESE TESTS ARE FOR. `parsePublishedDocument` is the canopy's boundary against a file some
 * other process wrote. Every assertion below is a statement about what the hosted service will
 * REFUSE TO SERVE, which is a different and stricter question than what the producer happens to
 * emit today — a gate tested only against its own producer's output is a gate that has never been
 * tested at all.
 *
 * The refusals are asserted BY MESSAGE, not merely by `ok: false`. A parser that refuses
 * everything passes a boolean test suite; what makes this one useful is that the person holding
 * the file is told which field, and why. `at` is asserted for the same reason `parseLeafDocument`
 * carries it: "invalid artifact" in a 3000-leaflet file is a scavenger hunt.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { leafId, leafletId, type Leaf } from "@foliage/leaf";

import { reviewForPublication, type PublicationReview } from "./publish.ts";
import {
  PUBLISHED_ARTIFACT,
  PUBLISHED_ARTIFACT_VERSION,
  buildPublishedDocument,
  documentDigest,
  parsePublishedDocument,
  toArtifactJson,
} from "./publishedDocument.ts";
import { diffPublications } from "./republish.ts";

/* ── Builders. These construct INPUTS to the gate, which is what a test of a gate needs; nothing
 * here is presented as data about anybody, and nothing produced here is written anywhere. ── */

const INSTANT = "2026-08-13T09:41:00Z";
const POLICY_DIGEST = `sha256:${"b".repeat(64)}`;

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const value: Record<string, unknown> = {
    artifact: PUBLISHED_ARTIFACT,
    artifactVersion: PUBLISHED_ARTIFACT_VERSION,
    publishedAt: INSTANT,
    source: {
      documentDigest: `sha256:${"a".repeat(64)}`,
      documentBytes: 1024,
      policyDigest: POLICY_DIGEST,
    },
    leaf: {
      id: "rowan-vale",
      subject: "Rowan Vale",
      subjectRedacted: false,
      leaflets: [
        {
          id: "git:4f884f6",
          title: "fix: hold the roster in manifest order",
          tier: "verified",
          titleRedacted: false,
          provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        },
      ],
    },
    withheld: { count: 0, kinds: [] },
    ...overrides,
  };
  if (
    overrides["artifactVersion"] !== 1 &&
    overrides["source"] !== null &&
    typeof overrides["source"] === "object" &&
    !Array.isArray(overrides["source"])
  ) {
    value["source"] = {
      documentDigest: `sha256:${"a".repeat(64)}`,
      documentBytes: 1024,
      policyDigest: POLICY_DIGEST,
      ...(overrides["source"] as Record<string, unknown>),
    };
  }
  if (overrides["artifactVersion"] === 1) {
    for (const leaflet of ((value["leaf"] as { leaflets: Record<string, unknown>[] }).leaflets)) delete leaflet["tier"];
  }
  return value;
}

/** Every `at` a refusal named, for asserting the gate points at the right field. */
function refusalPaths(value: unknown): string[] {
  const parsed = parsePublishedDocument(value);
  assert.equal(parsed.ok, false, "expected this artifact to be refused, and it was accepted");
  return parsed.ok ? [] : parsed.issues.map((i) => i.at);
}

function messageAt(value: unknown, at: string): string {
  const parsed = parsePublishedDocument(value);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return "";
  const issue = parsed.issues.find((i) => i.at === at);
  assert.ok(issue !== undefined, `no issue at "${at}"; got ${parsed.issues.map((i) => i.at).join(", ")}`);
  return issue.message;
}

/* ==========================================================================================
   THE HAPPY PATH — and it is deliberately first, because a gate that refuses its own
   producer's output is worse than no gate.
   ========================================================================================== */

test("aWellFormedArtifactParsesAndKeepsEveryFieldItWasGiven", () => {
  const parsed = parsePublishedDocument(artifact());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.leaf.id, "rowan-vale");
  assert.equal(parsed.document.leaf.leaflets.length, 1);
  assert.equal(parsed.document.publishedAt, INSTANT);
  assert.equal(parsed.document.source.documentBytes, 1024);
  // The brand is minted only here, and only after the redaction gate re-ran clean.
  assert.equal(parsed.document.leaf.reviewedForPublication, true);
  // `tier` is an on-disk field since 2026-09-06 (D1) — it survives the round trip as the value
  // the file actually stated, not a value this parser assumed.
  assert.equal(parsed.document.leaf.leaflets[0]?.tier, "verified");
});

test("buildingThenSerializingThenParsingIsAFixedPoint", () => {
  // The producer's own loop, closed mechanically: what `buildPublishedDocument` emits must be
  // exactly what `parsePublishedDocument` accepts. A publisher that can emit an artifact its own
  // canopy refuses is one nobody can trust, and this is the assertion that makes that structural.
  //
  // D1 (owner, 2026-09-06): a `pending` leaflet the subject offered crosses too, carrying its
  // tier — this is the exact fixture that used to prove the OLD rule and now proves the new one.
  const leaf: Leaf = {
    id: leafId("rowan-vale"),
    subject: "Rowan Vale",
    leaflets: [
      {
        id: leafletId("git:4f884f6"),
        title: "fix: hold the roster in manifest order",
        tier: "verified",
        provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        visibility: "public",
      },
      {
        id: leafletId("git:aaa1111"),
        title: "chore: bump the toolchain",
        tier: "pending",
        visibility: "public",
      },
    ],
  };
  const review = reviewForPublication({ leaf, declaredExample: false });
  assert.equal(review.ok, true);
  if (!review.ok) return;

  const built = buildPublishedDocument({
    review,
    publishedAt: INSTANT,
    documentDigest: documentDigest(new TextEncoder().encode("{}")),
    documentBytes: 2,
    policyDigest: POLICY_DIGEST,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const json = JSON.parse(JSON.stringify(toArtifactJson(built.document))) as unknown;
  const reparsed = parsePublishedDocument(json);
  assert.equal(
    reparsed.ok,
    true,
    reparsed.ok ? "" : reparsed.issues.map((i) => `${i.at}: ${i.message}`).join("\n"),
  );
  if (!reparsed.ok) return;
  assert.equal(
    reparsed.document.leaf.leaflets.length,
    2,
    "an offered pending leaflet must cross beside the verified one — mutation check: this must " +
      "redden if the gate goes back to filtering pending",
  );
  assert.deepEqual(
    reparsed.document.leaf.leaflets.map((l) => [l.id, l.tier]),
    [
      ["git:4f884f6", "verified"],
      ["git:aaa1111", "pending"],
    ],
    "the tier on disk must be the tier that actually crossed, per leaflet",
  );
  assert.equal(reparsed.document.withheld.count, 0, "nothing was withheld — both leaflets crossed");
  assert.equal(
    reparsed.document.artifactVersion,
    5,
    "a freshly built artifact is version 5 — every leaflet's tier is explicit on disk",
  );
});

test("aVerifiedLeafletNobodyOfferedIsWithheldAsNotShared_andSurvivesTheRoundTrip", () => {
  // No `visibility` at all on this one — the safe default is private, and it must not cross into
  // the artifact just because it is verified. The other leaflet keeps `visibility: "public"` so
  // this is a control: one crosses, one does not, and only consent tells them apart.
  const leaf: Leaf = {
    id: leafId("rowan-vale"),
    subject: "Rowan Vale",
    leaflets: [
      {
        id: leafletId("git:4f884f6"),
        title: "fix: hold the roster in manifest order",
        tier: "verified",
        provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        visibility: "public",
      },
      {
        id: leafletId("git:nnn1414"),
        title: "feat: add the local-only sync job",
        tier: "verified",
        provenance: { source: "git", ref: "nnn1414", observedAt: INSTANT },
      },
    ],
  };
  const review = reviewForPublication({ leaf, declaredExample: false });
  assert.equal(review.ok, true);
  if (!review.ok) return;
  assert.deepEqual(
    review.withheld.map((w) => w.kind),
    ["not-shared"],
    "the never-offered leaflet is withheld, and the offered one is not touched",
  );

  const built = buildPublishedDocument({
    review,
    publishedAt: INSTANT,
    documentDigest: documentDigest(new TextEncoder().encode("{}")),
    documentBytes: 2,
    policyDigest: POLICY_DIGEST,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const json = JSON.parse(JSON.stringify(toArtifactJson(built.document))) as unknown;
  const reparsed = parsePublishedDocument(json);
  assert.equal(
    reparsed.ok,
    true,
    reparsed.ok ? "" : reparsed.issues.map((i) => `${i.at}: ${i.message}`).join("\n"),
  );
  if (!reparsed.ok) return;
  assert.equal(reparsed.document.leaf.leaflets.length, 1, "the never-offered leaflet must not cross");
  assert.equal(reparsed.document.source.policyDigest, POLICY_DIGEST);
  assert.equal(reparsed.document.withheld.count, 1);
  assert.deepEqual(
    reparsed.document.withheld.kinds.map((k) => [k.kind, k.count]),
    [["not-shared", 1]],
  );
});

test("theDigestIsOfTheDocumentsOwnBytesSoAnyoneCanCheckItWithShasum", () => {
  // Not a re-serialization of the parsed value: key order and whitespace would change it, and the
  // digest would be unverifiable by the one person it exists for — the subject holding the file.
  const bytes = new TextEncoder().encode('{"id":"rowan-vale"}\n');
  assert.equal(documentDigest(bytes), `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
});

/* ==========================================================================================
   UNKNOWN KEYS, AND THE ONES REFUSED BY NAME.
   ========================================================================================== */

test("anUnknownKeyIsRefusedRatherThanIgnored_atEveryLevel", () => {
  assert.deepEqual(refusalPaths(artifact({ signature: "…" })), ["signature"]);
  assert.deepEqual(refusalPaths(artifact({ source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1, path: "/Users/somebody/leaf.json" } })), [
    "source.path",
  ]);
  const withLeafKey = artifact();
  (withLeafKey["leaf"] as Record<string, unknown>)["headline"] = "Senior Engineer";
  assert.deepEqual(refusalPaths(withLeafKey), ["leaf.headline"]);
});

test("aScoreShapedKeyIsRefusedBY_NAME_andTheMessageSaysWhy", () => {
  for (const key of ["score", "rating", "rank", "percentile", "confidence", "stars", "weight"]) {
    const message = messageAt(artifact({ [key]: 9 }), key);
    assert.match(
      message,
      /refused by name/,
      `"${key}" must be refused BY NAME — an "unknown field" message would leave a reader ` +
        `thinking the format simply has not got round to it yet`,
    );
    assert.match(message, /no rating of any kind|never on a public page/);
  }
});

test("aPendingTierParsesCleanly_sinceD1ThisIsNotAGateAnymore", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["tier"] = "pending";
  delete leaflets[0]!["provenance"]; // pending's provenance is optional, unlike verified's
  const parsed = parsePublishedDocument(doc);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.issues.map((i) => `${i.at}: ${i.message}`).join("\n"));
  if (!parsed.ok) return;
  assert.equal(parsed.document.leaf.leaflets[0]?.tier, "pending");
});

test("excludedIsRefusedByNameAsAttribution_notAsAnUnrecognisedTierValue", () => {
  // D1 did not open the tier field to any value — `excluded` is refused BY NAME, and for a
  // structural reason: it is not this format's proof gate, it is attribution. The message must
  // say that rather than "must be verified or pending", which would read as an arbitrary
  // restriction instead of the refusal it actually is.
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["tier"] = "excluded";
  const message = messageAt(doc, "leaf.leaflets[0].tier");
  assert.match(message, /may never appear on a published leaflet/);
  assert.match(message, /attribution/);
});

test("anUnrecognisedTierValueIsRefused_asDistinctFromExcluded", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["tier"] = "definitely-proven";
  const message = messageAt(doc, "leaf.leaflets[0].tier");
  assert.match(message, /must be "verified" or "pending"/);
});

test("aMissingTierIsRefused_notDefaultedToVerified", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  delete leaflets[0]!["tier"];
  const message = messageAt(doc, "leaf.leaflets[0].tier");
  assert.match(message, /required/);
});

test("theCanopysScoreListIsASupersetOfWhatTheOpenLeafFormatRefuses", async () => {
  // The duplication is deliberate — this is the EGRESS gate and the leaf format is forkable — so
  // the drift has to be caught mechanically. Every key the open format refuses by name is fed to
  // this gate and must also be refused by name here.
  const { parseLeafDocument } = await import("@foliage/leaf");
  const candidates = [
    "score", "scores", "rating", "ratings", "rank", "ranking", "grade", "gpa", "percentile",
    "percentage", "percent", "weight", "weighted", "composite", "stars", "points", "confidence",
    "strength",
  ];
  for (const key of candidates) {
    const leafParse = parseLeafDocument({ id: "x", subject: "X", leaflets: [], [key]: 1 });
    if (leafParse.ok) continue;
    const refusedByLeaf = leafParse.issues.some(
      (i) => i.at === key && i.message.includes("refused by name"),
    );
    if (!refusedByLeaf) continue;
    assert.match(
      messageAt(artifact({ [key]: 1 }), key),
      /refused by name/,
      `the open leaf format refuses "${key}" by name and the canopy's egress gate does not — ` +
        `the two lists have drifted, and the direction of the drift is the dangerous one`,
    );
  }
});

/* ==========================================================================================
   THE FORMAT TAG, THE VERSION, AND THE FIELDS THAT MAKE THE ARTIFACT DATE-CHECKABLE.
   ========================================================================================== */

test("aLeafDocumentIsRefusedAsNotThisFormat_ratherThanAsAPileOfMissingFields", () => {
  const paths = refusalPaths({ id: "rowan-vale", subject: "Rowan Vale", leaflets: [] });
  assert.ok(paths.includes("artifact"), "the format tag must be the thing that fails");
  assert.match(messageAt({ id: "x", subject: "X", leaflets: [] }, "artifact"), /foliage\/published-leaf/);
});

test("aFutureVersionIsRefusedByNumber_neverReadOptimistically", () => {
  // A version this canopy has never known the rules for.
  const message = messageAt(artifact({ artifactVersion: 8 }), "artifactVersion");
  assert.match(message, /must be 1, 2, 3, 4, 5, 6 or 7/);
  assert.match(message, /unknown version is refused/i);
  assert.match(message, /republish/i, "the remedy must be named, not just the refusal");
});

test("all historical formats read without changing their fields or proof claims", () => {
  const policyV2 = legacyArtifact({ artifactVersion: 2 });
  (policyV2["source"] as Record<string, unknown>)["policyDigest"] = POLICY_DIGEST;
  const tierV2 = artifact({ artifactVersion: 2 });
  delete (tierV2["source"] as Record<string, unknown>)["policyDigest"];
  const pending = ((tierV2["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[])[0]!;
  pending["tier"] = "pending";
  delete pending["provenance"];
  for (const [input, tier, policy] of [
    [legacyArtifact(), "verified", null], [policyV2, "verified", POLICY_DIGEST], [tierV2, "pending", null],
  ] as const) {
    const result = parsePublishedDocument(input);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
    assert.equal(result.document.artifactVersion, input["artifactVersion"]);
    assert.equal(result.document.leaf.leaflets[0]?.tier, tier);
    assert.equal(result.document.source.policyDigest, policy);
    assert.deepEqual(toArtifactJson(result.document), input);
  }
});

test("ambiguous v2 hybrids and incomplete v3 artifacts never acquire an implicit proof tier", () => {
  const hybrid = artifact({ artifactVersion: 2 }); // Both policy provenance and explicit tier.
  assert.match(messageAt(hybrid, "leaf.leaflets[0].tier"), /legacy format/);
  const missingTier = artifact({ artifactVersion: 2 });
  delete (missingTier["source"] as Record<string, unknown>)["policyDigest"];
  delete (((missingTier["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[])[0]!)["tier"];
  assert.match(messageAt(missingTier, "leaf.leaflets[0].tier"), /required/);
  const invalidPolicy = legacyArtifact({ artifactVersion: 2 });
  (invalidPolicy["source"] as Record<string, unknown>)["policyDigest"] = null;
  assert.match(messageAt(invalidPolicy, "source.policyDigest"), /required/);
  const v3 = artifact();
  delete (v3["source"] as Record<string, unknown>)["policyDigest"];
  assert.match(messageAt(v3, "source.policyDigest"), /required/);
  const retired = artifact({ artifactVersion: 2, withheld: { count: 1, kinds: [{ kind: "unproven-leaflet", count: 1 }] } });
  delete (retired["source"] as Record<string, unknown>)["policyDigest"];
  assert.match(messageAt(retired, "withheld.kinds[0].kind"), /not a withholding kind/);
});

/* ==========================================================================================
   VERSION 1 STILL READS. An old file does not stop serving the day the write format moves on
   — see the header's `artifactVersion` paragraph. These are the exact shape a real pre-2026-09-07
   artifact has: no per-leaflet `tier`, and `withheld.kinds` naming the retired `unproven-leaflet`.
   ========================================================================================== */

function legacyArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact: PUBLISHED_ARTIFACT,
    artifactVersion: 1,
    publishedAt: INSTANT,
    source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1024 },
    leaf: {
      id: "rowan-vale",
      subject: "Rowan Vale",
      subjectRedacted: false,
      leaflets: [
        {
          id: "git:4f884f6",
          title: "fix: hold the roster in manifest order",
          // NO "tier" — a version-1 artifact never carried one; every leaflet that reached this
          // format under the pre-2026-09-06 gate was verified by construction.
          titleRedacted: false,
          provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        },
      ],
    },
    withheld: { count: 1, kinds: [{ kind: "unproven-leaflet", count: 1 }] },
    ...overrides,
  };
}

test("aVersionOneArtifactWithNoPerLeafletTierParsesAsVerified_andKeepsItsDeclaredVersion", () => {
  // MUTATION CHECK: this must redden if the legacy-absence branch is deleted from `parseLeaflet` —
  // without it the leaflet's missing `tier` is refused as "required", exactly the bug this fixture
  // reproduces (measured over the real server, see publishSeam.test.ts).
  const parsed = parsePublishedDocument(legacyArtifact());
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? "" : parsed.issues.map((i) => `${i.at}: ${i.message}`).join("\n"),
  );
  if (!parsed.ok) return;
  assert.equal(
    parsed.document.leaf.leaflets[0]?.tier,
    "verified",
    "an absent tier on a version-1 artifact is read as verified, never left unset",
  );
  assert.equal(
    parsed.document.artifactVersion,
    1,
    "an old file is served AS version 1 — it is not silently upgraded by being read",
  );
});

test("aVersionOneLeafletsExplicitTierIsStillChecked_theConcessionIsForAbsenceOnly", () => {
  const doc = legacyArtifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["tier"] = "excluded";
  const message = messageAt(doc, "leaf.leaflets[0].tier");
  assert.match(
    message,
    /legacy format does not carry an explicit tier/,
    "a PRESENT tier on a version-1 artifact is refused as a format mismatch — the " +
      "legacy concession is for a missing field, not for whatever value shows up",
  );
});

test("unprovenLeafletIsAcceptedOnlyOnAVersionOneArtifact_refusedOnTheCurrentOne", () => {
  const legacy = legacyArtifact();
  const legacyParsed = parsePublishedDocument(legacy);
  assert.equal(legacyParsed.ok, true, "a version-1 artifact may still name the retired kind");

  // The SAME kind, on a version-2 (current) artifact, is refused — nothing this canopy writes has
  // produced it since 2026-09-06, and the write path (`WithholdingKind`) must not gain it back.
  const current = artifact({ withheld: { count: 1, kinds: [{ kind: "unproven-leaflet", count: 1 }] } });
  const message = messageAt(current, "withheld.kinds[0].kind");
  assert.match(message, /not a withholding kind/);
});

test("republishingALegacyArtifactWritesVersionFour_neverRewritesItInPlaceAsVersionOne", () => {
  // The publish command never reads a previous artifact's bytes at all (`publish.mjs` builds
  // fresh from `reviewForPublication` over the leaf document) — this is that same shape, and the
  // mutation check is on the constant `buildPublishedDocument` stamps.
  const leaf: Leaf = {
    id: leafId("rowan-vale"),
    subject: "Rowan Vale",
    leaflets: [
      {
        id: leafletId("git:4f884f6"),
        title: "fix: hold the roster in manifest order",
        tier: "verified",
        provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        visibility: "public",
      },
    ],
  };
  const review = reviewForPublication({ leaf, declaredExample: false });
  assert.equal(review.ok, true);
  if (!review.ok) return;

  const built = buildPublishedDocument({
    review,
    publishedAt: INSTANT,
    documentDigest: documentDigest(new TextEncoder().encode("{}")),
    documentBytes: 2,
    policyDigest: POLICY_DIGEST,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(
    built.document.artifactVersion,
    PUBLISHED_ARTIFACT_VERSION,
    "republishing always writes the current version, never the version being replaced",
  );
  assert.equal(built.document.artifactVersion, 5);
});

test("anArtifactWithNoPublishedAtIsRefused_becauseNobodyCouldDateCheckIt", () => {
  assert.match(messageAt(artifact({ publishedAt: undefined }), "publishedAt"), /date-check/);
  // A local-time stamp is an instant plus an unstated assumption about where the clock was.
  assert.match(
    messageAt(artifact({ publishedAt: "2026-08-13T09:41:00" }), "publishedAt"),
    /offset is required/,
  );
});

test("theSourceDigestMustBeARealDigestShape_soItCanBeCheckedRatherThanBelieved", () => {
  assert.match(
    messageAt(artifact({ source: { documentDigest: "sha256:short", documentBytes: 1 } }), "source.documentDigest"),
    /64 lower-case hex/,
  );
  assert.deepEqual(
    refusalPaths(artifact({ source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: -1 } })),
    ["source.documentBytes"],
  );
  assert.deepEqual(
    refusalPaths(artifact({ source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1, policyDigest: "sha256:short" } })),
    ["source.policyDigest"],
  );
});

test("olderVersionOneArtifactsWithoutAPolicyDigestRemainReadable", () => {
  const parsed = parsePublishedDocument(artifact({
    artifactVersion: 1,
    source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1024 },
  }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.artifactVersion, 1);
  assert.equal(parsed.document.source.policyDigest, null);
  assert.equal("policyDigest" in (toArtifactJson(parsed.document)["source"] as object), false);
});

test("policyDigestIsVersionedRatherThanSilentlyExtendingVersionOne", () => {
  assert.deepEqual(
    refusalPaths(artifact({
      artifactVersion: 1,
      source: {
        documentDigest: `sha256:${"a".repeat(64)}`,
        documentBytes: 1024,
        policyDigest: `sha256:${"b".repeat(64)}`,
      },
    })),
    ["source.policyDigest"],
  );
  assert.deepEqual(
    refusalPaths(artifact({
      source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1024, policyDigest: undefined },
    })),
    ["source.policyDigest"],
  );
});

/* ==========================================================================================
   THE ID IS THE URL.
   ========================================================================================== */

test("anIdThatCannotBeAUrlSegmentIsRefused_neverSlugified", () => {
  for (const bad of ["Rowan Vale", "rowan/vale", "../etc/passwd", "ROWAN", "rowan_vale", "-rowan", ""]) {
    const doc = artifact();
    (doc["leaf"] as Record<string, unknown>)["id"] = bad;
    const paths = refusalPaths(doc);
    assert.ok(paths.includes("leaf.id"), `"${bad}" must be refused as a published id`);
  }
  const message = messageAt(
    (() => {
      const d = artifact();
      (d["leaf"] as Record<string, unknown>)["id"] = "Rowan Vale";
      return d;
    })(),
    "leaf.id",
  );
  assert.match(message, /refused rather than transformed/);
  assert.match(message, /overwrite/, "the message must name the consequence: one page over another");
});

test("twoLeafletsWithOneIdAreRefused_becauseTheyCannotBothBeThatRecord", () => {
  const doc = artifact();
  const leaf = doc["leaf"] as Record<string, unknown>;
  const first = (leaf["leaflets"] as unknown[])[0];
  leaf["leaflets"] = [first, JSON.parse(JSON.stringify(first))];
  assert.ok(refusalPaths(doc).some((p) => p.endsWith(".id")));
});

/* ==========================================================================================
   THE FIELDS THAT ARE CLAIMS ABOUT TEXT, AND WHY THEY ARE NOT OPTIONAL.
   ========================================================================================== */

test("titleRedactedIsRequired_becauseAMissingValueWouldDefaultToVerbatim", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  delete leaflets[0]!["titleRedacted"];
  assert.match(messageAt(doc, "leaf.leaflets[0].titleRedacted"), /verbatim/);
});

test("aVerifiedLeafletWithoutProvenanceIsRefused_becauseItWouldBeUnfalsifiable", () => {
  const doc = artifact(); // default fixture leaflet is tier "verified"
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  delete leaflets[0]!["provenance"];
  assert.match(messageAt(doc, "leaf.leaflets[0].provenance"), /assertion rather than a proof/);
});

test("aPendingLeafletsProvenanceIsOptional_butStillCheckedWhenGiven", () => {
  const withoutOne = artifact();
  const leaflets = (withoutOne["leaf"] as Record<string, unknown>)["leaflets"] as Record<
    string,
    unknown
  >[];
  leaflets[0]!["tier"] = "pending";
  delete leaflets[0]!["provenance"];
  assert.equal(parsePublishedDocument(withoutOne).ok, true, "pending may cross with no provenance");

  const withABadOne = artifact();
  const leaflets2 = (withABadOne["leaf"] as Record<string, unknown>)["leaflets"] as Record<
    string,
    unknown
  >[];
  leaflets2[0]!["tier"] = "pending";
  leaflets2[0]!["provenance"] = { source: "git", ref: "4f884f6" }; // observedAt missing
  assert.match(
    messageAt(withABadOne, "leaf.leaflets[0].provenance.observedAt"),
    /required/,
    "a pending leaflet's provenance, when present, is parsed exactly like a verified one's",
  );
});

test("anEmptyLeafletsArrayIsValidAndAMissingOneIsNot", () => {
  const empty = artifact();
  (empty["leaf"] as Record<string, unknown>)["leaflets"] = [];
  const withheld = { count: 0, kinds: [] };
  const parsed = parsePublishedDocument({ ...empty, withheld });
  assert.equal(parsed.ok, true, "a leaf with nothing verified publishes an honest empty page");

  const missing = artifact();
  delete (missing["leaf"] as Record<string, unknown>)["leaflets"];
  assert.match(messageAt(missing, "leaf.leaflets"), /not the same statement/);
});

/* ==========================================================================================
   THE WITHHELD BLOCK — the cross-check a hand-edited artifact fails.
   ========================================================================================== */

test("thePerKindCountsMustAddUpToTheTotal", () => {
  const doc = artifact({
    withheld: { count: 9, kinds: [{ kind: "not-shared", count: 2 }] },
  });
  const message = messageAt(doc, "withheld");
  assert.match(message, /add up to 2 but "count" says 9/);
  assert.match(message, /hand-edited/);
});

test("anUnknownWithholdingKindIsRefused_becauseThePageCouldNotExplainItToAReader", () => {
  const doc = artifact({ withheld: { count: 1, kinds: [{ kind: "vibes", count: 1 }] } });
  assert.match(messageAt(doc, "withheld.kinds[0].kind"), /not a withholding kind/);
});

test("aKindListedWithZeroEntriesIsRefused_becauseItNamesAWithholdingThatDidNotHappen", () => {
  const doc = artifact({ withheld: { count: 0, kinds: [{ kind: "not-shared", count: 0 }] } });
  assert.match(messageAt(doc, "withheld.kinds[0].count"), /did not happen/);
});

test("anAbsentWithheldBlockIsRefused_becauseSilenceIsNotAStatement", () => {
  assert.match(messageAt(artifact({ withheld: undefined }), "withheld"), /"count": 0/);
});

/* ==========================================================================================
   THE INGEST GATE RE-RUNS THE REDACTION GATE. This is the one that stops a hand-edited or
   foreign artifact from putting somebody's address on a hosted page.
   ========================================================================================== */

test("anArtifactCarryingTextTheRedactionGateWouldWithholdIsRefusedByIngest", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  // Shaped like an address, and nothing else about the artifact is wrong: it parses, the counts
  // agree, the id is url-safe. Only the re-run of the gate catches it.
  leaflets[0]!["title"] = "fix: drop the hardcoded rowan.vale@example.invalid from the seed";
  const parsed = parsePublishedDocument(doc);
  assert.equal(parsed.ok, false, "an artifact carrying an address-shaped string must not be served");
  if (parsed.ok) return;
  assert.ok(
    parsed.issues.some((i) => i.message.includes("email-address")),
    "the refusal must name what was found",
  );
  assert.ok(
    parsed.issues.some((i) => i.message.includes("refused rather than re-redacted")),
    "silently fixing it would serve a page whose publisher never saw what it says",
  );
  // And the refusal must not itself republish the address.
  assert.ok(
    !parsed.issues.some((i) => i.message.includes("rowan.vale@example.invalid")),
    "the refusal quoted the very value it refused",
  );
});

test("aProvenanceRefCarryingAnIdentifierIsRefusedByIngest", () => {
  const doc = artifact();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["provenance"] = {
    source: "git",
    ref: "mailto:rowan@example.invalid",
    observedAt: INSTANT,
  };
  assert.equal(parsePublishedDocument(doc).ok, false);
});

/* ==========================================================================================
   RE-PUBLISH — what a second publication would change.
   ========================================================================================== */

function parsed(value: Record<string, unknown>) {
  const p = parsePublishedDocument(value);
  assert.equal(p.ok, true, p.ok ? "" : p.issues.map((i) => `${i.at}: ${i.message}`).join("\n"));
  if (!p.ok) throw new Error("unreachable");
  return p.document;
}

test("republishingAnUnchangedLeafReportsThatNothingAReaderCouldSeeWouldChange", () => {
  const before = parsed(artifact());
  const after = parsed(artifact({ publishedAt: "2026-09-01T00:00:00Z" }));
  const diff = diffPublications(before, after);
  // A NEW INSTANT IS NOT A CHANGE. Every re-publish carries one, and counting it would make the
  // flag useless exactly when somebody wants to know whether re-running would alter the page.
  assert.equal(diff.identical, true);
  assert.equal(diff.sameSourceDocument, true);
  assert.equal(diff.previouslyPublishedAt, INSTANT);
  assert.deepEqual([diff.added, diff.removed, diff.changed], [[], [], []]);
});

test("republishNamesTheClaimsThePageWouldStartAndStopMaking", () => {
  const before = parsed(artifact());
  const next = artifact({ withheld: { count: 1, kinds: [{ kind: "not-shared", count: 1 }] } });
  (next["leaf"] as Record<string, unknown>)["leaflets"] = [
    {
      id: "git:bbb2222",
      title: "feat: add the ingest route",
      tier: "verified",
      titleRedacted: false,
      provenance: { source: "git", ref: "bbb2222", observedAt: INSTANT },
    },
  ];
  const diff = diffPublications(before, parsed(next));
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.added, ["git:bbb2222"]);
  assert.deepEqual(diff.removed, ["git:4f884f6"]);
  assert.equal(diff.withheldBefore, 0);
  assert.equal(diff.withheldAfter, 1);
});

test("republishNamesATitleThatChanged_andWhetherItStoppedBeingVerbatim", () => {
  const before = parsed(artifact());
  const next = artifact();
  const leaflets = (next["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["title"] = "fix: hold the roster in [withheld: account handle] order";
  leaflets[0]!["titleRedacted"] = true;
  const diff = diffPublications(before, parsed(next));
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0]?.id, "git:4f884f6");
  assert.equal(diff.changed[0]?.redactionChanged, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
});

test("republishNamesATierThatChanged_evenWithTheTitleUntouched", () => {
  // Since D1 the tier is printed on the page, so a leaflet going from `pending` to `verified` (a
  // signature now checks out) is a claim change a re-publish must surface — same title, same
  // ref, different word on the page.
  const before = parsed(
    artifact({
      leaf: {
        id: "rowan-vale",
        subject: "Rowan Vale",
        subjectRedacted: false,
        leaflets: [
          {
            id: "git:4f884f6",
            title: "fix: hold the roster in manifest order",
            tier: "pending",
            titleRedacted: false,
            provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
          },
        ],
      },
    }),
  );
  const next = parsed(artifact()); // default fixture: same leaflet, tier "verified"
  const diff = diffPublications(before, next);
  assert.equal(diff.changed.length, 1, "mutation check: a tier-only change must not be invisible");
  assert.equal(diff.changed[0]?.tierChanged, true);
  assert.equal(diff.changed[0]?.before, diff.changed[0]?.after, "the title itself did not move");
  assert.equal(diff.identical, false, "a claim on the page changed, so this is not a no-op republish");
});

test("reorderingLeafletsIsReportedBecauseThePublicRendererPreservesDocumentOrder", () => {
  const two = artifact({ withheld: { count: 0, kinds: [] } });
  const second = {
    id: "git:bbb2222",
    title: "feat: add the ingest route",
    tier: "verified",
    titleRedacted: false,
    provenance: { source: "git", ref: "bbb2222", observedAt: INSTANT },
  };
  const leaf = two["leaf"] as Record<string, unknown>;
  const first = (leaf["leaflets"] as unknown[])[0];
  leaf["leaflets"] = [first, second];
  const before = parsed(JSON.parse(JSON.stringify(two)) as Record<string, unknown>);

  const swapped = JSON.parse(JSON.stringify(two)) as Record<string, unknown>;
  (swapped["leaf"] as Record<string, unknown>)["leaflets"] = [second, first];
  const diff = diffPublications(before, parsed(swapped));
  assert.equal(diff.identical, false);
  assert.equal(diff.leafletOrderChanged, true);
});

test("order change compares the relative sequence of claims that exist on both pages", () => {
  const two = artifact({ withheld: { count: 0, kinds: [] } });
  const second = {
    id: "git:bbb2222",
    title: "feat: add the ingest route",
    tier: "verified",
    titleRedacted: false,
    provenance: { source: "git", ref: "bbb2222", observedAt: INSTANT },
  };
  const leaf = two["leaf"] as Record<string, unknown>;
  const first = (leaf["leaflets"] as unknown[])[0];
  leaf["leaflets"] = [first, second];
  const before = parsed(JSON.parse(JSON.stringify(two)) as Record<string, unknown>);

  const membershipOnly = JSON.parse(JSON.stringify(two)) as Record<string, unknown>;
  (membershipOnly["leaf"] as Record<string, unknown>)["leaflets"] = [first, {
    id: "git:ccc3333",
    title: "docs: add the release note",
    tier: "verified",
    titleRedacted: false,
    provenance: { source: "git", ref: "ccc3333", observedAt: INSTANT },
  }];
  assert.equal(diffPublications(before, parsed(membershipOnly)).leafletOrderChanged, false);

  const reorderedAndAdded = JSON.parse(JSON.stringify(two)) as Record<string, unknown>;
  (reorderedAndAdded["leaf"] as Record<string, unknown>)["leaflets"] = [second, first, {
    id: "git:ccc3333",
    title: "docs: add the release note",
    tier: "verified",
    titleRedacted: false,
    provenance: { source: "git", ref: "ccc3333", observedAt: INSTANT },
  }];
  assert.equal(diffPublications(before, parsed(reorderedAndAdded)).leafletOrderChanged, true);
});

test("aChangedSourceDocumentIsNamedSeparatelyFromAChangedPage", () => {
  const before = parsed(artifact());
  const after = parsed(
    artifact({ source: { documentDigest: `sha256:${"b".repeat(64)}`, documentBytes: 2048 } }),
  );
  const diff = diffPublications(before, after);
  // The source digest and byte count are rendered in the public footer, so this is a public change.
  assert.equal(diff.identical, false);
  assert.equal(diff.sameSourceDocument, false);
  assert.equal(diff.sourceRecordChanged, true);
});

test("reader-visible provenance and withholding breakdowns participate in equality", () => {
  const before = parsed(artifact({ withheld: { count: 2, kinds: [
    { kind: "email-address", count: 1 },
    { kind: "account-handle", count: 1 },
  ] } }));
  const next = artifact({ withheld: { count: 2, kinds: [
    { kind: "phone-number", count: 1 },
    { kind: "account-handle", count: 1 },
  ] } });
  const leaflets = (next["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  (leaflets[0]!["provenance"] as Record<string, unknown>)["observedAt"] = "2026-09-01T00:00:00Z";

  const diff = diffPublications(before, parsed(next));
  assert.equal(diff.identical, false);
  assert.equal(diff.withholdingKindsChanged, true);
  assert.equal(diff.changed[0]?.provenanceChanged, true);
});

/* ==========================================================================================
   THE BUILDER'S OWN REFUSALS.
   ========================================================================================== */

test("theBuilderRefusesToEmitAnArtifactItsOwnParserWouldReject", () => {
  const review = reviewForPublication({
    leaf: { id: leafId("Rowan Vale"), subject: "Rowan Vale", leaflets: [] },
    declaredExample: false,
  }) as Extract<PublicationReview, { ok: true }>;

  const built = buildPublishedDocument({
    review,
    publishedAt: INSTANT,
    documentDigest: `sha256:${"a".repeat(64)}`,
    documentBytes: 10,
    policyDigest: POLICY_DIGEST,
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.issues[0]?.at, "leaf.id");
  assert.match(built.issues[0]?.message ?? "", /not transformed here/);

  for (const bad of ["not-an-instant", "2026-08-13T09:41:00"]) {
    const b = buildPublishedDocument({
      review: reviewForPublication({
        leaf: { id: leafId("rowan-vale"), subject: "Rowan Vale", leaflets: [] },
        declaredExample: false,
      }) as Extract<PublicationReview, { ok: true }>,
      publishedAt: bad,
      documentDigest: `sha256:${"a".repeat(64)}`,
      documentBytes: 10,
      policyDigest: POLICY_DIGEST,
    });
    assert.equal(b.ok, false, `"${bad}" must not be accepted as a publication instant`);
  }
});

test("theWithheldKindsAreEmittedInDeclarationOrderSoTwoRunsAreByteIdentical", () => {
  const leaf: Leaf = {
    id: leafId("rowan-vale"),
    subject: "Rowan Vale",
    leaflets: [
      {
        id: leafletId("a"),
        title: "one",
        tier: "excluded",
        reason: "another author",
        visibility: "public",
      },
      // Never offered outward — no `visibility` — so this is withheld as `not-shared`, not
      // `unproven-leaflet`: a `pending` leaflet that IS offered crosses since D1 (2026-09-06).
      { id: leafletId("b"), title: "two", tier: "pending" },
      {
        id: leafletId("c"),
        title: "three",
        tier: "excluded",
        reason: "another author",
        visibility: "public",
      },
    ],
  };
  const review = reviewForPublication({ leaf, declaredExample: false });
  assert.equal(review.ok, true);
  if (!review.ok) return;
  const build = () =>
    buildPublishedDocument({
      review,
      publishedAt: INSTANT,
      documentDigest: `sha256:${"a".repeat(64)}`,
      documentBytes: 10,
      policyDigest: POLICY_DIGEST,
    });
  const first = build();
  const second = build();
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(
    JSON.stringify(toArtifactJson(first.document)),
    JSON.stringify(toArtifactJson(second.document)),
  );
  // Declaration order, not encounter order — the excluded leaflets ("a", "c") were seen first and
  // the not-shared one ("b") second, yet `not-shared` sorts before `unattributed-leaflet` in
  // `WITHHOLDING_KINDS`.
  assert.deepEqual(
    first.document.withheld.kinds.map((k) => k.kind),
    ["not-shared", "unattributed-leaflet"],
  );
});
