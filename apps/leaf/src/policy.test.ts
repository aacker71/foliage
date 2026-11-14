/**
 * THE APP'S HALF OF THE PUBLISH POLICY — compiling a rule from an example, editing the document
 * that holds them, and composing the rail with the subject's own act.
 *
 * What is NOT re-tested here: what the rules MEAN. `packages/leaf/src/publishPolicy.test.ts` owns
 * the evaluator, the deny/allow asymmetry and the match vocabulary; restating any of it here
 * would be a second suite to keep in agreement with the first, and the two would drift.
 *
 * The disk half (`policyDocument.ts`) is exercised against REAL FILES in a real temporary
 * directory — a mocked filesystem would prove the code compiles, not that ENOENT and a BOM behave
 * the way the loader claims.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluatePolicy,
  isAbsoluteDenial,
  leafId,
  leafletId,
  parsePublishPolicy,
  type Leaf,
  type Leaflet,
  type PublishPolicy,
} from "@foliage/leaf";

import { addRule, dropRule, isMatchKind, outwardStateOf, publishRows, ruleFromExample } from "./policy.ts";
import { describePolicySource, effectivePolicyDigest, loadPublishPolicy } from "./policyDocument.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-policy-"));
  tmpRoots.push(dir);
  return dir;
}

const OBSERVED = "2026-08-19T00:00:00.000Z";

function pending(id: string, title: string, extra: Partial<Leaflet> = {}): Leaflet {
  return {
    id: leafletId(id),
    title,
    tier: "pending",
    provenance: { source: "git", ref: id.split(":")[1] ?? id, observedAt: OBSERVED },
    ...extra,
  } as Leaflet;
}

function leafOf(...leaflets: Leaflet[]): Leaf {
  return { id: leafId("leaf:test"), subject: "Test Subject", leaflets };
}

function policyOf(rules: unknown): PublishPolicy {
  const parsed = parsePublishPolicy({ rules });
  assert.ok(parsed.ok, `the fixture policy must parse: ${JSON.stringify(parsed)}`);
  return parsed.policy;
}

/* ------------------------------------------------------------------- by example ---- */

test("a rule compiled from an example matches the example it was compiled from", () => {
  // THE PROPERTY THAT MAKES "BY EXAMPLE" HONEST. If a compiled rule did not match its own example
  // the subject would have written a rule that reads like protection and provides none — which is
  // the exact failure `ruleFromExample`'s refusals exist to prevent, asserted from the other side.
  const example = pending("git:abc123", "feat: a thing", {
    body: [{ provenance: { source: "git", ref: "abc123", observedAt: OBSERVED } }],
  });
  for (const kind of ["tier", "evidence-source", "evidence-ref", "id-prefix"] as const) {
    const compiled = ruleFromExample(example, "deny", kind, "because I said so");
    assert.ok(compiled.ok, `${kind} did not compile: ${JSON.stringify(compiled)}`);
    const decision = evaluatePolicy(policyOf([compiled.rule]), example);
    assert.equal(isAbsoluteDenial(decision), true, `${kind} compiled a rule that misses its example`);
  }
});

test("the compiled id is derived, so writing the same rule twice is refused rather than duplicated", () => {
  const example = pending("git:abc123", "feat: a thing");
  const first = ruleFromExample(example, "deny", "evidence-ref", "one");
  const second = ruleFromExample(example, "deny", "evidence-ref", "written again by mistake");
  assert.ok(first.ok && second.ok);
  assert.equal(first.rule.id, second.rule.id);

  const added = addRule({ rules: [] }, first.rule);
  assert.ok(added.ok);
  const again = addRule(added.document, second.rule);
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.cause, "duplicate-id");
});

test("an id prefix is read up to and including the colon, so `photo:` cannot match `photograph:`", () => {
  const photo = pending("photo:9f", "a photograph");
  const compiled = ruleFromExample(photo, "allow", "id-prefix", "my photographs are mine to show");
  assert.ok(compiled.ok);
  assert.deepEqual(compiled.rule.match, { kind: "id-prefix", prefix: "photo:" });

  const lookalike = pending("photograph:9f", "something else entirely");
  const policy = policyOf([{ ...compiled.rule, effect: "deny" }]);
  assert.equal(isAbsoluteDenial(evaluatePolicy(policy, photo)), true);
  assert.equal(isAbsoluteDenial(evaluatePolicy(policy, lookalike)), false);
});

test("a fact the example does not exhibit is a named refusal, never a rule that matches nothing", () => {
  // The dangerous outcome is not an error — it is a rule sitting in the file, reading like a rail,
  // that can never fire. So both value-less kinds refuse an example that does not exhibit them.
  const ordinary = pending("git:abc123", "fix: no numbers here at all");
  const notRated = ruleFromExample(ordinary, "deny", "title-rating-shaped", "no ratings");
  assert.equal(notRated.ok, false);
  assert.equal(notRated.ok === false && notRated.cause, "no-such-fact");
  assert.match(notRated.ok === false ? notRated.detail : "", /would match nothing/);

  const hasEvidence = ruleFromExample(ordinary, "deny", "no-evidence", "nothing bare goes out");
  assert.equal(hasEvidence.ok, false);

  // And the same kinds DO compile from an example that exhibits them.
  const rated = pending("git:def456", "review: rated my engineering ability 4.5/5");
  assert.equal(ruleFromExample(rated, "deny", "title-rating-shaped", "no ratings").ok, true);
  const bare: Leaflet = { id: leafletId("hand:1"), title: "a claim with nothing behind it", tier: "pending" };
  assert.equal(ruleFromExample(bare, "deny", "no-evidence", "nothing bare goes out").ok, true);
});

test("an ambiguous example names every candidate instead of silently picking one", () => {
  // A leaflet whose body cites two different sources. "Like this one" has two answers, and a
  // compiler that chose one would be writing a rule the subject did not mean — silently wider or
  // narrower than what they pointed at.
  const mixed = pending("git:abc123", "a leaflet resting on two kinds of evidence", {
    body: [
      { provenance: { source: "git", ref: "abc123", observedAt: OBSERVED } },
      { provenance: { source: "brain-note:third-party", ref: "note-7", observedAt: OBSERVED } },
    ],
  });
  const compiled = ruleFromExample(mixed, "deny", "evidence-source", "not this kind");
  assert.equal(compiled.ok, false);
  assert.equal(compiled.ok === false && compiled.cause, "ambiguous");
  assert.deepEqual(compiled.ok === false && "candidates" in compiled ? [...compiled.candidates] : [], [
    "git",
    "brain-note:third-party",
  ]);

  // A source SEGMENT is never guessed at all: `brain-note` and `third-party` are different rules.
  const segment = ruleFromExample(mixed, "deny", "evidence-source-segment", "not this kind");
  assert.equal(segment.ok, false);
  assert.equal(segment.ok === false && segment.cause, "ambiguous");
});

test("the match vocabulary is asked of the domain, not re-spelled here", () => {
  assert.equal(isMatchKind("evidence-ref"), true);
  assert.equal(isMatchKind("no-evidence"), true);
  // The kinds that would let a rule rest on an opinion do not exist, and this is the check that
  // notices if one is ever added under a friendly name.
  assert.equal(isMatchKind("sensitive"), false);
  assert.equal(isMatchKind("confidence"), false);
  assert.equal(isMatchKind("weight"), false);
});

/* ------------------------------------------------------------------ editing ---- */

test("the first write materialises the shipped defaults instead of a one-rule document", () => {
  // THE FAILURE THIS REFUSES: a subject writes "share my photos" and thereby deletes four rails
  // they never saw. Adding a rule may never subtract one.
  const rule = { id: "mine", effect: "allow" as const, match: { kind: "tier" as const, tier: "verified" as const }, reason: "mine" };
  const seeded = addRule(null, rule);
  assert.ok(seeded.ok);
  assert.equal(seeded.seededDefaults, true);
  const ids = seeded.rules.map((r) => r.id);
  assert.ok(ids.includes("deny-excluded"));
  assert.ok(ids.includes("deny-third-party-evidence"));
  assert.ok(ids.includes("deny-rating-shaped-title"));
  assert.ok(ids.includes("deny-no-evidence"));
  assert.equal(ids.at(-1), "mine", "the subject's own rule is appended, not interleaved");

  // Writing into an existing document does NOT re-seed: the subject may have dropped a default
  // on purpose, and quietly putting it back would be the product overruling them in the dark.
  const second = addRule({ rules: [] }, rule);
  assert.ok(second.ok);
  assert.equal(second.seededDefaults, false);
  assert.deepEqual(second.rules.map((r) => r.id), ["mine"]);
});

test("an edit is judged on the way in and again over a round trip, and never mutates its input", () => {
  const before = { rules: [{ id: "a", effect: "deny", match: { kind: "no-evidence" }, reason: "r" }] };
  const frozen = JSON.stringify(before);
  const added = addRule(before, {
    id: "b",
    effect: "allow",
    match: { kind: "tier", tier: "verified" },
    reason: "r",
  });
  assert.ok(added.ok);
  assert.equal(JSON.stringify(before), frozen, "the caller's document was mutated");

  // A document this product could not load is refused rather than edited into a worse one.
  const broken = addRule({ rules: [{ id: "a", effect: "maybe" }] }, {
    id: "b",
    effect: "deny",
    match: { kind: "no-evidence" },
    reason: "r",
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.ok === false && broken.cause, "not-a-policy");
});

test("dropping names the ids that exist rather than failing silently", () => {
  const doc = { rules: [{ id: "a", effect: "deny", match: { kind: "no-evidence" }, reason: "r" }] };
  const missing = dropRule(doc, "b");
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.cause, "no-such-rule");
  assert.deepEqual(missing.ok === false && "known" in missing ? [...missing.known] : [], ["a"]);

  const dropped = dropRule(doc, "a");
  assert.ok(dropped.ok);
  assert.deepEqual(dropped.rules, []);
  assert.equal(dropped.seededDefaults, false);
});

/* -------------------------------------------------------------- composition ---- */

test("the rail beats the subject's share, and a withheld proposal does not", () => {
  const shared = pending("git:abc123", "feat: a thing", { visibility: "public" } as Partial<Leaflet>);

  // NOTHING MATCHES: fail-closed withholds a PROPOSAL, and the subject's own act stands. If this
  // inverted, writing an empty policy would retroactively un-publish everything already shared.
  assert.deepEqual(outwardStateOf(policyOf([]), shared), { kind: "served" });

  // A DENY MATCHES: the rail overrides the person, and it says which rule did it.
  const rail = policyOf([
    { id: "no-this-one", effect: "deny", match: { kind: "evidence-ref", ref: "abc123" }, reason: "not this" },
  ]);
  const withheld = outwardStateOf(rail, shared);
  assert.equal(withheld.kind, "withheld-by-rule");
  assert.equal(withheld.kind === "withheld-by-rule" ? withheld.rule.id : null, "no-this-one");
});

test("an allow rule proposes and never publishes", () => {
  const unshared = pending("git:abc123", "feat: a thing");
  const proposing = policyOf([
    { id: "propose", effect: "allow", match: { kind: "tier", tier: "pending" }, reason: "yours" },
  ]);
  const state = outwardStateOf(proposing, unshared);
  // The distinction the whole design rests on: `candidate` is a suggestion for the subject, and
  // the leaflet is still not served. Nothing in this module can turn one into the other.
  assert.deepEqual(state, { kind: "not-shared", candidate: true });
});

test("publishRows keeps document order and accounts for every leaflet exactly once", () => {
  const leaf = leafOf(
    pending("git:one", "first", { visibility: "public" } as Partial<Leaflet>),
    pending("git:two", "review: rated my engineering ability 4.5/5", { visibility: "public" } as Partial<Leaflet>),
    pending("git:three", "third"),
  );
  const policy = policyOf([
    { id: "deny-rating-shaped-title", effect: "deny", match: { kind: "title-rating-shaped" }, reason: "no ratings" },
  ]);
  const rows = publishRows(leaf, policy);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["git:one", "git:two", "git:three"],
    "any order but the document's is a ranking",
  );
  assert.deepEqual(
    rows.map((r) => r.outward.kind),
    ["served", "withheld-by-rule", "not-shared"],
    "the three states a subject actually has",
  );
});

/* ------------------------------------------------------------------- loading ---- */

test("no policy file is a SUCCESS carrying the default rules, and it names the path it searched", async () => {
  const dir = await tempDir();
  const searched = join(dir, "policy.json");
  const load = await loadPublishPolicy({}, searched);
  assert.equal(load.ok, true);
  assert.ok(load.ok && load.policy.rules.length > 0, "the shipped defaults, not an empty policy");
  assert.deepEqual(load.ok ? load.source : null, { kind: "default", searched });
  assert.equal(load.ok ? load.policyDigest : "", load.ok ? effectivePolicyDigest(load.policy, load.source) : "");
  // NAMING THE PATH IS THE POINT. A message quoting the compiled-in default while the process is
  // reading somewhere else sends the subject to edit a file nothing loads.
  assert.match(load.ok ? describePolicySource(load.source) : "", new RegExp(searched.replace(/[.\\/]/g, "\\$&")));
});

test("a file that exists and does not parse is a named failure, never a quiet downgrade", async () => {
  const dir = await tempDir();
  const path = join(dir, "policy.json");

  await writeFile(path, "{not json", "utf8");
  const malformed = await loadPublishPolicy({}, path);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.ok === false && malformed.cause, "malformed");

  await writeFile(path, JSON.stringify({ rules: [{ id: "x", effect: "maybe" }] }), "utf8");
  const invalid = await loadPublishPolicy({}, path);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok === false && invalid.cause, "invalid");
  assert.ok(invalid.ok === false && "issues" in invalid && invalid.issues.length > 0, "every problem, listed");
});

test("a BOM does not break the load, because a text editor writes one and JSON.parse blames token 1", async () => {
  const dir = await tempDir();
  const path = join(dir, "policy.json");
  const document = { rules: [{ id: "a", effect: "deny", match: { kind: "no-evidence" }, reason: "r" }] };
  await writeFile(path, "﻿" + JSON.stringify(document), "utf8");
  const load = await loadPublishPolicy({}, path);
  assert.equal(load.ok, true);
  assert.deepEqual(load.ok ? load.source : null, { kind: "file", path });
  assert.match(load.ok ? load.policyDigest : "", /^sha256:[0-9a-f]{64}$/);
});

test("set-but-blank is its own cause, because it sends a person to the wrong file", async () => {
  const blank = await loadPublishPolicy({ FOLIAGE_POLICY: "  " }, null);
  assert.equal(blank.ok, false);
  assert.equal(blank.ok === false && blank.cause, "unconfigured");
  assert.match(blank.ok === false ? blank.detail : "", /FOLIAGE_POLICY/);
});
