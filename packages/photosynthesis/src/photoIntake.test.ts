import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLeafDocument, type Leaf } from "@foliage/leaf";

import {
  PHOTO_FILE_EXTRACTOR,
  photosToCandidates,
  type ObservedImage,
} from "./photoIntake.ts";
import { promoteApproved } from "./promote.ts";
import { parseHarvestDocument } from "./harvestDocument.ts";

/**
 * Every observation in this file is a FUNCTION INPUT built to pin one decision — none of it is
 * a description of any real photograph, nothing here was drafted by any model, and a passing
 * suite says the rules hold, not that any image was ever read. The app half
 * (`apps/leaf/src/photoSource.test.ts`) is where real files on disk get hashed and measured;
 * this module has no I/O to test, which is exactly why the judgement lives in it.
 *
 * The digests below are literal 64-hex strings chosen to be readable, not SHA-256 sums of
 * anything. That is fine here and would not be fine in the app tests: what this module can be
 * wrong about is the SHAPE of a ref and what is done with it, and what the app can be wrong
 * about is whether the bytes were actually hashed — which is why that test hands its digests to
 * `shasum` for a second opinion.
 */

const instant = "2026-08-16T00:00:00Z";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function image(overrides: Partial<ObservedImage> = {}): ObservedImage {
  return {
    path: "/tmp/observations/IMG_0001.png",
    digest: digestA,
    byteLength: 4096,
    dimensions: { known: true, width: 1536, height: 1024 },
    description: null,
    // The default is the honest one: nothing has been stored, so no media element is drafted.
    // A test that wants the picture asks for it, the way the app has to.
    published: null,
    ...overrides,
  };
}

function ok(images: readonly ObservedImage[]) {
  const result = photosToCandidates({ images, observedAt: instant });
  assert.equal(result.ok, true, "expected the observations to be usable");
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function issuesAt(images: readonly ObservedImage[], observedAt = instant): string[] {
  const result = photosToCandidates({ images, observedAt });
  assert.equal(result.ok, false, "expected the observations to be refused");
  return result.ok ? [] : result.issues.map((i) => i.at);
}

test("an image with no describer becomes a candidate titled from what was measured", () => {
  const result = ok([image()]);

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  // The title is file facts and says so — the name, the measured size, and the plain statement
  // that nothing was drafted. No adjective, no invented subject matter.
  assert.equal(candidate.title, "IMG_0001.png — 1536×1024 image file, no description drafted");
  assert.equal(candidate.extractor, PHOTO_FILE_EXTRACTOR);
  assert.equal(candidate.review.state, "candidate");
  // The DIGEST is the evidence. The path appears nowhere in it.
  assert.deepEqual(candidate.evidence, [
    { source: "photo", ref: `sha256:${digestA}`, observedAt: instant },
  ]);
  assert.equal(candidate.id, `photo:sha256:${digestA}`);
  assert.deepEqual(
    result.undescribed.map((n) => n.path),
    ["/tmp/observations/IMG_0001.png"],
  );
  // A size that WAS measured raises no cause: the register holds absences, not every image.
  assert.deepEqual(result.unmeasuredDimensions, []);
  assert.deepEqual(result.refusedRatingShapedNames, []);
});

test("the candidate id is the digest, so a rename produces the same candidate", () => {
  const first = ok([image({ path: "/tmp/observations/IMG_0001.png" })]);
  const renamed = ok([image({ path: "/somewhere/else/whiteboard-final-v2.png" })]);

  assert.equal(first.candidates[0]!.id, renamed.candidates[0]!.id);
  // The title still names the file it was found at — the id is stable, the report is current.
  assert.match(renamed.candidates[0]!.title, /^whiteboard-final-v2\.png — /);
});

test("a description whose every field is null leaves as an absence, not as content", () => {
  // THE HAZARD THIS PINS: a grammar-constrained decoder cannot decline, which is why every
  // field of the schema is nullable. An all-null answer must survive the round trip as an
  // absence — not as "null", not as an empty title, and not as a model credit for a title the
  // model did not write.
  const result = ok([
    image({ description: { describer: "local-model:gemma4:12b", summary: null, visibleText: null } }),
  ]);

  const candidate = result.candidates[0]!;
  assert.equal(candidate.title, "IMG_0001.png — 1536×1024 image file, no description drafted");
  assert.doesNotMatch(candidate.title, /null|undefined|unknown/i);
  assert.equal(candidate.extractor, PHOTO_FILE_EXTRACTOR);
  assert.equal(result.undescribed.length, 1);
  assert.match(result.undescribed[0]!.reason, /returned no usable summary/);
  assert.equal(result.transcriptions.length, 0);
});

test("a blank summary is an absence too — a decoder can satisfy a grammar with nothing", () => {
  const result = ok([
    image({ description: { describer: "local-model:gemma4:12b", summary: "   \n  ", visibleText: null } }),
  ]);

  assert.equal(result.candidates[0]!.extractor, PHOTO_FILE_EXTRACTOR);
  assert.match(result.candidates[0]!.title, /no description drafted$/);
});

test("a real drafted summary becomes the title and is credited to the describer", () => {
  const result = ok([
    image({
      description: {
        describer: "local-model:gemma4:12b",
        summary: "Whiteboard covered in a system diagram, photographed at an angle",
        visibleText: null,
      },
    }),
  ]);

  const candidate = result.candidates[0]!;
  assert.equal(
    candidate.title,
    "Whiteboard covered in a system diagram, photographed at an angle",
  );
  assert.equal(candidate.extractor, "local-model:gemma4:12b");
  assert.equal(result.undescribed.length, 0);
});

test("transcribed text never reaches a candidate — it travels beside it", () => {
  // THE HAZARD THIS PINS: this model demonstrably invents text occluded at a crop edge and
  // mis-reads small text. A transcription is a lead for the operator, never a stored fact, so
  // it must appear in `transcriptions` and in NO candidate field.
  const transcript = "01 — TARDING\nCANOPY IS A COLLECTION OF";
  const result = ok([
    image({
      description: {
        describer: "local-model:gemma4:12b",
        summary: "A printed page on a desk",
        visibleText: transcript,
      },
    }),
  ]);

  assert.equal(result.transcriptions.length, 1);
  assert.equal(result.transcriptions[0]!.text, transcript);
  assert.equal(result.transcriptions[0]!.ref, `sha256:${digestA}`);

  const serialized = JSON.stringify(result.candidates);
  assert.equal(serialized.includes("TARDING"), false);
  assert.equal(serialized.includes("CANOPY IS A COLLECTION OF"), false);
});

test("a rating-shaped drafted title is refused, reported, and replaced by the file title", () => {
  const result = ok([
    image({
      description: {
        describer: "local-model:gemma4:12b",
        summary: "A well-executed whiteboard, 9/10",
        visibleText: null,
      },
    }),
  ]);

  assert.equal(result.candidates[0]!.title, "IMG_0001.png — 1536×1024 image file, no description drafted");
  assert.equal(result.candidates[0]!.extractor, PHOTO_FILE_EXTRACTOR);
  assert.equal(result.refusedRatingShapedDrafts.length, 1);
  // The refused text is shown rather than swallowed: a refusal nobody sees is a silent edit.
  assert.match(result.refusedRatingShapedDrafts[0]!.reason, /9\/10/);
  // And it is accounted for in BOTH registers — where the title came from, and what was refused.
  assert.equal(result.undescribed.length, 1);
});

test("a photograph description can retain a measured engineering percentage", () => {
  const summary = "Display showing p99 latency reduced by 40%";
  const result = ok([image({
    description: { describer: "local-model:gemma4:12b", summary, visibleText: null },
  })]);
  assert.equal(result.candidates[0]!.title, summary);
  assert.deepEqual(result.refusedRatingShapedDrafts, []);
});

test("a rating-shaped FILE NAME is withheld from the title, reported, and never rewritten", () => {
  // A TITLE HAS TWO SOURCES and the guard used to watch one. Verified end to end before this
  // branch: `design-critique-9 out of 10.heic` produced the title "design-critique-9 out of
  // 10.heic — 3840×2160 image file, no description drafted", with no refusal printed anywhere,
  // and it survived promotion into a leaflet title.
  const name = "design-critique-9 out of 10.heic";
  const result = ok([image({ path: `/tmp/observations/${name}` })]);

  const candidate = result.candidates[0]!;
  assert.doesNotMatch(candidate.title, /9 out of 10/, "a rating must not ride in on a file name");
  assert.equal(
    candidate.title,
    "(file name withheld: it carries a rating-shaped number) — 1536×1024 image file, no description drafted",
  );
  // WITHHELD, NOT SCRUBBED. The name is something this product measured; rewriting it to satisfy
  // a rule about claims would falsify the observation, so it leaves intact through the report.
  assert.equal(result.refusedRatingShapedNames.length, 1);
  assert.ok(
    result.refusedRatingShapedNames[0]!.reason.includes(name),
    "the operator must be shown the exact name that was held back",
  );
  // The two registers stay distinct: no describer ran here, so no DRAFT was refused.
  assert.deepEqual(result.refusedRatingShapedDrafts, []);
  // And nothing rating-shaped is anywhere in what would reach a document.
  assert.equal(JSON.stringify(result.candidates).includes("9 out of 10"), false);
});

test("a rating-shaped file name is not refused when a real summary displaces it", () => {
  // The name only ever reaches a title as the fallback. A drafted summary replaces it entirely,
  // so there is nothing to withhold and nothing to report — reporting one anyway would tell the
  // operator a refusal happened where no claim was ever made.
  const result = ok([
    image({
      path: "/tmp/observations/design-critique-9 out of 10.heic",
      description: {
        describer: "local-model:gemma4:12b",
        summary: "A whiteboard photographed at an angle",
        visibleText: null,
      },
    }),
  ]);

  assert.equal(result.candidates[0]!.title, "A whiteboard photographed at an angle");
  assert.deepEqual(result.refusedRatingShapedNames, []);
});

test("editorializing is left to review; only numbers that read like a rating are refused", () => {
  const result = ok([
    image({
      description: {
        describer: "local-model:gemma4:12b",
        summary: "An excellent, very impressive lake with 2 trees",
        visibleText: null,
      },
    }),
  ]);

  assert.equal(result.candidates[0]!.title, "An excellent, very impressive lake with 2 trees");
  assert.equal(result.refusedRatingShapedDrafts.length, 0);
});

test("two byte-identical files are one artifact: the copy is skipped and names its original", () => {
  const result = ok([
    image({ path: "/tmp/observations/IMG_0001.png" }),
    image({ path: "/tmp/observations/copies/IMG_0001 copy.png" }),
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]!.cause, "duplicate-digest");
  assert.match(result.skipped[0]!.reason, /IMG_0001\.png/);
});

test("a zero-byte file is skipped with its cause, not hashed into a ref for no artifact", () => {
  const result = ok([image({ byteLength: 0 })]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]!.cause, "empty-file");
});

test("dimensions that could not be measured carry a reason and never a zero", () => {
  const result = ok([
    image({
      dimensions: { known: false, why: "sips could not be executed on this machine (ENOENT)" },
    }),
  ]);

  // The title states the file and nothing about its size, because nothing about its size was
  // established. "0×0" would be the collapse this repository exists to refuse.
  assert.equal(result.candidates[0]!.title, "IMG_0001.png — image file, no description drafted");
  assert.doesNotMatch(result.candidates[0]!.title, /0×0|undefined/);
});

test("the reason a size is unknown LEAVES this function — it is not just refused when blank", () => {
  // The app builds an exact cause per file ("sips ran but printed no pixelWidth/pixelHeight …")
  // and this module refuses an observation whose reason is blank — while giving the reason no
  // way out, so no consumer could ever show one. A cause worth rejecting an input over is a
  // cause worth carrying, and it is carried verbatim rather than paraphrased.
  const why = 'sips ran but printed no pixelWidth/pixelHeight for this file. Its output was: "…"';
  const result = ok([
    image({ dimensions: { known: false, why } }),
    image({ path: "/tmp/b.png", digest: digestB }),
  ]);

  assert.deepEqual(result.unmeasuredDimensions, [
    { path: "/tmp/observations/IMG_0001.png", why },
  ]);
  // The measured one is not listed: this register is the images whose size is NOT known.
  assert.equal(result.candidates.length, 2);
});

test("an unmeasured dimension with no reason is refused outright", () => {
  assert.deepEqual(issuesAt([image({ dimensions: { known: false, why: "  " } })]), [
    "images[0].dimensions.why",
  ]);
});

test("a digest that cannot be re-computed fails the whole intake, not just its image", () => {
  // A ref nobody can check is indistinguishable from a fabricated one. Dropping the bad image
  // and returning the rest would silently assert a smaller harvest than the directory holds.
  assert.deepEqual(issuesAt([image(), image({ path: "/tmp/b.png", digest: "not-a-digest" })]), [
    "images[1].digest",
  ]);
  assert.deepEqual(issuesAt([image({ digest: "A".repeat(63) })]), ["images[0].digest"]);
});

test("a description with no describer identity is refused — an anonymous draft is unreviewable", () => {
  assert.deepEqual(
    issuesAt([image({ description: { describer: "  ", summary: "something", visibleText: null } })]),
    ["images[0].description.describer"],
  );
});

test("an instant with no offset is refused", () => {
  assert.deepEqual(issuesAt([image()], "2026-08-16T00:00:00"), ["observedAt"]);
});

test("zero images is an honest empty harvest, not a failure", () => {
  const result = ok([]);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.transcriptions, []);
});

test("every candidate returned has passed the real harvest gate", () => {
  const result = ok([image(), image({ path: "/tmp/b.png", digest: digestB })]);
  // The returned candidates are the gate's own values; re-serializing them must therefore be
  // accepted again, byte for byte.
  const reparsed = parseHarvestDocument(
    JSON.parse(JSON.stringify({ candidates: result.candidates })),
  );
  assert.equal(reparsed.ok, true);
});

test("an approved photo candidate promotes to a PENDING leaflet through the existing path", () => {
  // The seam, end to end in the domain: nothing in the photo path may reach the verified tier,
  // and it reaches it through the SAME promoteApproved the git path uses — unchanged.
  const drafted = ok([image()]);
  const approved = parseHarvestDocument(
    JSON.parse(
      JSON.stringify({
        candidates: drafted.candidates.map((c) => ({
          ...c,
          review: { state: "approved", by: "the subject", at: instant },
        })),
      }),
    ),
  );
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const parsedLeaf = parseLeafDocument({ id: "leaf", subject: "Parser Input", leaflets: [] });
  assert.equal(parsedLeaf.ok, true);
  if (!parsedLeaf.ok) return;
  const leaf: Leaf = parsedLeaf.leaf;

  const promoted = promoteApproved(approved.harvest, leaf);
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;

  assert.equal(promoted.leaf.leaflets.length, 1);
  const leaflet = promoted.leaf.leaflets[0]!;
  assert.equal(leaflet.tier, "pending");
  assert.deepEqual(leaflet.provenance, {
    source: `photosynthesis:${PHOTO_FILE_EXTRACTOR}`,
    ref: `sha256:${digestA}`,
    observedAt: instant,
  });
});
