/**
 * WHAT A TURN REMEMBERS — tested against a REAL encrypted SQLite store on a REAL disk.
 *
 * Nothing here is mocked and there is no in-memory store. The claims under test are about what
 * comes BACK OUT of a file: that a memory derived from device-only material can never return
 * as shareable, that a replacement links to what it replaced and leaves it intact on disk, and
 * that a verdict a person recorded survives every later agent write. A fake store could be
 * made to satisfy all three while the real one did not.
 *
 * A note on cost. Every `openTier1Store` runs scrypt at N = 2^17 — measured at ~270 ms in
 * `localStore.test.ts` — so this file deliberately opens a small number of stores and does
 * several assertions against each, rather than one store per assertion. Weakening the KDF to
 * make the suite fast would be testing a different program than the one that ships.
 *
 * `node:sqlite` prints `ExperimentalWarning: SQLite is an experimental feature` on import.
 * Nothing here suppresses it: a swallowed warning is how the next Node upgrade becomes a
 * mystery.
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { openTier1Store, type Tier1Store } from "./localStore.ts";
import {
  MEMORY_ID_PREFIX,
  MEMORY_INJECTION_BUDGET,
  MEMORY_KIND_PREFIX,
  activeMemories,
  budgetMemories,
  egressOf,
  memoryId,
  recall,
  recallAll,
  recordHumanDecision,
  remember,
  standingOf,
  validateDraft,
  type MemoryRecord,
} from "./memory.ts";

const SECRET = "a passphrase a person actually chose";
const AT = "2026-08-19T09:00:00Z";

const dirs: string[] = [];
const stores: Tier1Store[] = [];

after(() => {
  for (const store of stores) store.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A fresh store in its own temp directory. Real file, real crypto, real SQLite. */
async function freshStore(): Promise<Tier1Store> {
  const dir = mkdtempSync(join(tmpdir(), "foliage-cos-memory-"));
  dirs.push(dir);
  const opened = await openTier1Store({ path: join(dir, "tier1.db"), secret: SECRET, create: true });
  if (opened.state !== "opened") throw new Error(`open failed: ${opened.cause} — ${opened.detail}`);
  stores.push(opened.store);
  return opened.store;
}

/** A well-formed agent draft, so each test varies exactly one thing. */
function draft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    body: "the person is preparing for a staff-engineer conversation in the autumn",
    recordedAt: AT,
    provenance: { producer: "deterministic" },
    derivedFrom: [{ itemId: "ctx-1", kind: "tier1-local" }],
    ...over,
  };
}

async function rememberOrFail(store: Tier1Store, input: Record<string, unknown>): Promise<MemoryRecord> {
  const result = await remember(store, input);
  if (result.state !== "remembered") {
    throw new Error(`remember refused: ${result.cause} at ${result.at} — ${result.detail}`);
  }
  return result.memory;
}

async function allMemories(store: Tier1Store): Promise<readonly MemoryRecord[]> {
  const listed = await recallAll(store);
  if (listed.state !== "present") throw new Error(`expected memories, got ${listed.state}`);
  return listed.memories;
}

// -------------------------------------------------------------------------------------
// The honest empty state
// -------------------------------------------------------------------------------------

test("a store with nothing in it says empty, and invents no example memory", async () => {
  const store = await freshStore();
  const listed = await recallAll(store);
  strictEqual(listed.state, "empty");

  const missing = await recall(store, memoryId("never-written"));
  strictEqual(missing.state, "absent");
  // A failure is never a zero: the id comes back so the caller can say WHICH one is absent.
  if (missing.state === "absent") strictEqual(missing.id, "never-written");
});

test("a store holding only declared material, and no memories, still lists as empty", async () => {
  const store = await freshStore();
  // A person's own Tier 1 reflection, written straight to the store by whatever wrote it.
  // It is none of this module's business and must not be decoded, counted, or reported as a
  // broken memory.
  const written = await store.put({
    id: "reflection-1",
    kind: "tier1-local",
    body: "a private paragraph the agent never wrote",
    recordedAt: AT,
  });
  strictEqual(written.state, "written");

  const listed = await recallAll(store);
  strictEqual(listed.state, "empty");
});

// -------------------------------------------------------------------------------------
// The round trip, and provenance travelling inside the record
// -------------------------------------------------------------------------------------

test("a remembered turn comes back with its provenance and its derivation intact", async () => {
  const store = await freshStore();
  const written = await rememberOrFail(
    store,
    draft({
      id: "m-local",
      provenance: { producer: "local-model", model: "gemma4:12b" },
      derivedFrom: [
        { itemId: "ctx-1", kind: "tier2-confidential" },
        { itemId: "ctx-2", kind: "tier2-confidential" },
      ],
    }),
  );
  strictEqual(written.kind, "tier2-confidential");

  const read = await recall(store, memoryId("m-local"));
  strictEqual(read.state, "present");
  if (read.state !== "present") return;
  deepStrictEqual(read.memory.provenance, { producer: "local-model", model: "gemma4:12b" });
  deepStrictEqual(read.memory.derivedFrom, [
    { itemId: "ctx-1", kind: "tier2-confidential" },
    { itemId: "ctx-2", kind: "tier2-confidential" },
  ]);
  strictEqual(read.memory.body, written.body);
  strictEqual(read.memory.decision, undefined);
});

test("provenance arms are structural: no model on deterministic, no deterministic without one", async () => {
  const store = await freshStore();

  const deterministicWithModel = await remember(
    store,
    draft({ id: "m-a", provenance: { producer: "deterministic", model: "gemma4:12b" } }),
  );
  strictEqual(deterministicWithModel.state, "refused");
  if (deterministicWithModel.state === "refused") {
    strictEqual(deterministicWithModel.cause, "invalid-provenance");
    strictEqual(deterministicWithModel.at, "draft.provenance.model");
  }

  const modelWithoutIdentity = await remember(
    store,
    draft({ id: "m-b", provenance: { producer: "escalated" } }),
  );
  strictEqual(modelWithoutIdentity.state, "refused");
  if (modelWithoutIdentity.state === "refused") strictEqual(modelWithoutIdentity.cause, "invalid-provenance");

  const unknownWithoutReason = await remember(store, draft({ id: "m-c", provenance: { producer: "unknown" } }));
  strictEqual(unknownWithoutReason.state, "refused");
  if (unknownWithoutReason.state === "refused") strictEqual(unknownWithoutReason.cause, "invalid-provenance");

  const honestUnknown = await rememberOrFail(
    store,
    draft({ id: "m-d", provenance: { producer: "unknown", detail: "the producer did not attest" } }),
  );
  deepStrictEqual(honestUnknown.provenance, {
    producer: "unknown",
    detail: "the producer did not attest",
  });
});

// -------------------------------------------------------------------------------------
// A tier1-derived memory cannot come back as shareable
// -------------------------------------------------------------------------------------

test("a tier1-derived memory cannot come back as shareable, by any route", async () => {
  const store = await freshStore();

  // Route 1: declare it. There is no kind field on a draft, so the attempt is refused as an
  // unknown key rather than quietly ignored — an ignored key is how this would have shipped.
  const declared = await remember(store, draft({ id: "m-declare", kind: "tier3-shareable" }));
  strictEqual(declared.state, "refused");
  if (declared.state === "refused") {
    strictEqual(declared.cause, "unknown-key");
    strictEqual(declared.at, "draft.kind");
  }

  // Route 2: derive it and read it back. The kind is copied from the derivation.
  const written = await rememberOrFail(store, draft({ id: "m-private" }));
  strictEqual(written.kind, "tier1-local");
  const read = await recall(store, memoryId("m-private"));
  strictEqual(read.state, "present");
  if (read.state !== "present") return;
  strictEqual(read.memory.kind, "tier1-local");

  const egress = egressOf(read.memory);
  strictEqual(egress.state, "device-only");
  if (egress.state === "device-only") strictEqual(egress.kind, "tier1-local");

  // Route 3: launder it by replacement — a "fresher" memory from shareable sources claiming
  // to supersede the private one. Refused: kinds do not change by re-run.
  const laundered = await remember(
    store,
    draft({
      id: "m-launder",
      supersedes: "m-private",
      derivedFrom: [{ itemId: "ctx-public", kind: "tier3-shareable" }],
    }),
  );
  strictEqual(laundered.state, "refused");
  if (laundered.state === "refused") strictEqual(laundered.cause, "supersedes-different-kind");

  // Route 4: mix a private source into a shareable memory, so a join would have to pick a kind.
  const mixed = await remember(
    store,
    draft({
      id: "m-mixed",
      derivedFrom: [
        { itemId: "ctx-public", kind: "tier3-shareable" },
        { itemId: "ctx-private", kind: "tier1-local" },
      ],
    }),
  );
  strictEqual(mixed.state, "refused");
  if (mixed.state === "refused") strictEqual(mixed.cause, "mixed-derivation");
});

test("a memory declared shareable in the store but private in its envelope is refused, not resolved", async () => {
  const store = await freshStore();

  // Tamper directly at the store layer: the namespaced kind says shareable, the envelope says
  // tier1-local. Resolving in either direction is a guess, and one of the two directions
  // publishes a private memory.
  const envelope = JSON.stringify({
    format: "foliage-cos-memory",
    version: "1",
    id: "m-tampered",
    kind: "tier1-local",
    body: "a private note",
    recordedAt: AT,
    provenance: { producer: "deterministic" },
    derivedFrom: [{ itemId: "ctx-1", kind: "tier1-local" }],
  });
  const written = await store.put({
    id: `${MEMORY_ID_PREFIX}m-tampered`,
    kind: `${MEMORY_KIND_PREFIX}tier3-shareable`,
    body: envelope,
    recordedAt: AT,
  });
  strictEqual(written.state, "written");

  const read = await recall(store, memoryId("m-tampered"));
  strictEqual(read.state, "unreadable");
  if (read.state === "unreadable") {
    strictEqual(read.cause, "memory-malformed");
    ok(read.detail.includes("disagrees"), `detail should name the disagreement, got: ${read.detail}`);
  }

  // And a listing reports it rather than dropping it — 0 memories out of 1 stored is a lie.
  const listed = await recallAll(store);
  strictEqual(listed.state, "present");
  if (listed.state !== "present") return;
  strictEqual(listed.memories.length, 0);
  strictEqual(listed.failed.length, 1);
  strictEqual(listed.failed[0]?.cause, "memory-malformed");
});

// -------------------------------------------------------------------------------------
// Supersession preserves the link, and never overwrites
// -------------------------------------------------------------------------------------

test("a supersession links to what it replaced and leaves the replaced memory intact", async () => {
  const store = await freshStore();
  const first = await rememberOrFail(store, draft({ id: "m-1", body: "the first account" }));
  const second = await rememberOrFail(
    store,
    draft({ id: "m-2", body: "a fuller account", supersedes: "m-1", recordedAt: "2026-08-19T11:00:00Z" }),
  );
  strictEqual(second.supersedes, "m-1");

  // The replaced memory is still there, byte for byte. Supersession is a link, not an edit.
  const original = await recall(store, memoryId("m-1"));
  strictEqual(original.state, "present");
  if (original.state === "present") {
    strictEqual(original.memory.body, "the first account");
    strictEqual(original.memory.recordedAt, first.recordedAt);
  }

  const all = await allMemories(store);
  strictEqual(all.length, 2);

  const standingOfFirst = standingOf(first, all);
  deepStrictEqual(standingOfFirst.succession, { state: "superseded", by: ["m-2"] });
  deepStrictEqual(standingOfFirst.review, { state: "unreviewed" });
  deepStrictEqual(standingOf(second, all).succession, { state: "current" });

  const active = activeMemories(all);
  deepStrictEqual(
    active.map((m) => m.id),
    ["m-2"],
  );
});

test("an id already in the store is refused rather than overwritten", async () => {
  const store = await freshStore();
  await rememberOrFail(store, draft({ id: "m-1", body: "what the person actually said" }));

  const second = await remember(store, draft({ id: "m-1", body: "a re-run's replacement text" }));
  strictEqual(second.state, "refused");
  if (second.state === "refused") {
    strictEqual(second.cause, "id-in-use");
    ok(second.detail.includes("supersedes"), "the refusal should name the correct move");
  }

  const read = await recall(store, memoryId("m-1"));
  strictEqual(read.state, "present");
  if (read.state === "present") strictEqual(read.memory.body, "what the person actually said");
});

test("a supersession pointing at nothing is refused, so no lineage has a hole in it", async () => {
  const store = await freshStore();
  const dangling = await remember(store, draft({ id: "m-2", supersedes: "m-never-written" }));
  strictEqual(dangling.state, "refused");
  if (dangling.state === "refused") strictEqual(dangling.cause, "supersedes-absent");

  const self = await remember(store, draft({ id: "m-3", supersedes: "m-3" }));
  strictEqual(self.state, "refused");
  if (self.state === "refused") strictEqual(self.cause, "supersedes-self");
});

test("two re-runs replacing the same memory are reported as a fork, not resolved into a winner", async () => {
  const store = await freshStore();
  const base = await rememberOrFail(store, draft({ id: "m-1" }));
  await rememberOrFail(store, draft({ id: "m-2a", supersedes: "m-1" }));
  await rememberOrFail(store, draft({ id: "m-2b", supersedes: "m-1" }));

  const all = await allMemories(store);
  const standing = standingOf(base, all);
  strictEqual(standing.succession.state, "superseded");
  if (standing.succession.state === "superseded") {
    deepStrictEqual([...standing.succession.by].sort(), ["m-2a", "m-2b"]);
  }
});

// -------------------------------------------------------------------------------------
// A human decision is never silently reversed
// -------------------------------------------------------------------------------------

test("a human rejection survives every later agent write in the same lineage", async () => {
  const store = await freshStore();
  await rememberOrFail(store, draft({ id: "m-1", body: "the person is unhappy at work" }));

  const rejected = await recordHumanDecision(store, {
    id: "m-1-rejected",
    decides: "m-1",
    verdict: "rejected",
    reason: "this is not something I want an agent holding on to",
    decidedAt: "2026-08-19T12:00:00Z",
  });
  strictEqual(rejected.state, "remembered");
  if (rejected.state !== "remembered") return;
  strictEqual(rejected.memory.supersedes, "m-1");
  strictEqual(rejected.memory.decision?.verdict, "rejected");
  strictEqual(rejected.memory.decision?.decidedOn, "m-1");
  // The verdict record did not edit the memory: same body, same kind, same derivation.
  strictEqual(rejected.memory.body, "the person is unhappy at work");
  strictEqual(rejected.memory.kind, "tier1-local");

  // The memory the person actually read is still in the store, undecided and unedited.
  const original = await recall(store, memoryId("m-1"));
  strictEqual(original.state, "present");
  if (original.state === "present") strictEqual(original.memory.decision, undefined);

  // Now the agent re-runs and writes a fresher version of the same lineage. It cannot express
  // a verdict at all, and the person's rejection is carried forward onto it verbatim.
  const rerun = await rememberOrFail(
    store,
    draft({
      id: "m-3",
      body: "the person is unhappy at work (re-run, same conclusion)",
      supersedes: "m-1-rejected",
      recordedAt: "2026-08-19T13:00:00Z",
    }),
  );
  strictEqual(rerun.decision?.verdict, "rejected");
  strictEqual(rerun.decision?.reason, "this is not something I want an agent holding on to");
  // `decidedOn` still names the memory the person actually read, four writes later.
  strictEqual(rerun.decision?.decidedOn, "m-1");

  const all = await allMemories(store);
  strictEqual(all.length, 3);
  // Nothing in this lineage is usable, and nothing in it was deleted.
  deepStrictEqual(activeMemories(all), []);
  deepStrictEqual(standingOf(rerun, all).review, {
    state: "rejected",
    reason: "this is not something I want an agent holding on to",
    decidedAt: "2026-08-19T12:00:00Z",
    decidedOn: "m-1",
  });
});

test("an agent draft cannot express a verdict, and a verdict cannot arrive without a reason", async () => {
  const store = await freshStore();
  await rememberOrFail(store, draft({ id: "m-1" }));

  const smuggled = await remember(
    store,
    draft({
      id: "m-2",
      decision: { verdict: "accepted", reason: "the agent approved of itself", decidedAt: AT, decidedOn: "m-1" },
    }),
  );
  strictEqual(smuggled.state, "refused");
  if (smuggled.state === "refused") {
    strictEqual(smuggled.cause, "unknown-key");
    strictEqual(smuggled.at, "draft.decision");
  }

  const reasonless = await recordHumanDecision(store, {
    id: "m-1-accepted",
    decides: "m-1",
    verdict: "accepted",
    reason: "   ",
    decidedAt: AT,
  });
  strictEqual(reasonless.state, "refused");
  if (reasonless.state === "refused") strictEqual(reasonless.cause, "decision-reason-missing");

  const aboutNothing = await recordHumanDecision(store, {
    id: "m-x",
    decides: "m-never-written",
    verdict: "accepted",
    reason: "fine by me",
    decidedAt: AT,
  });
  strictEqual(aboutNothing.state, "refused");
  if (aboutNothing.state === "refused") strictEqual(aboutNothing.cause, "decides-absent");
});

test("an accepted memory stays usable and keeps its reason", async () => {
  const store = await freshStore();
  await rememberOrFail(store, draft({ id: "m-1" }));
  const accepted = await recordHumanDecision(store, {
    id: "m-1-accepted",
    decides: "m-1",
    verdict: "accepted",
    reason: "yes, remember that",
    decidedAt: AT,
  });
  strictEqual(accepted.state, "remembered");

  const all = await allMemories(store);
  deepStrictEqual(
    activeMemories(all).map((m) => m.id),
    ["m-1-accepted"],
  );
});

// -------------------------------------------------------------------------------------
// Model reasoning, score shapes, and the rest of the refusal vocabulary
// -------------------------------------------------------------------------------------

test("model reasoning is refused by name, wherever a provider puts it", async () => {
  const store = await freshStore();

  for (const key of ["reasoning_content", "reasoning", "thinking", "analysis", "chain_of_thought"]) {
    const result = await remember(store, draft({ id: `m-${key}`, [key]: "the model deliberating" }));
    strictEqual(result.state, "refused", `${key} should be refused`);
    if (result.state === "refused") {
      strictEqual(result.cause, "reasoning-content", `${key} should be refused as reasoning, not generically`);
      strictEqual(result.at, `draft.${key}`);
    }
  }

  // A whole provider response, handed in raw, is refused too — `choices` is not a field here.
  const raw = await remember(store, {
    choices: [{ message: { content: "an answer", reasoning_content: "the deliberation" } }],
  });
  strictEqual(raw.state, "refused");
  if (raw.state === "refused") strictEqual(raw.cause, "unknown-key");
});

test("score-shaped keys are refused by name, confidence included", async () => {
  const store = await freshStore();
  for (const key of ["confidence", "score", "rank", "percentile", "strength"]) {
    const result = await remember(store, draft({ id: `m-${key}`, [key]: 0.9 }));
    strictEqual(result.state, "refused", `${key} should be refused`);
    if (result.state === "refused") strictEqual(result.cause, "score-shaped-key");
  }

  // And inside the derivation, where a model would most plausibly put one.
  const nested = await remember(
    store,
    draft({ id: "m-nested", derivedFrom: [{ itemId: "ctx-1", kind: "tier1-local", confidence: 0.4 }] }),
  );
  strictEqual(nested.state, "refused");
  if (nested.state === "refused") {
    strictEqual(nested.cause, "score-shaped-key");
    strictEqual(nested.at, "draft.derivedFrom[0].confidence");
  }
});

test("validateDraft is pure and refuses the malformed cases without a store", () => {
  strictEqual(validateDraft(null).ok, false);
  strictEqual(validateDraft("a string").ok, false);

  const noDerivation = validateDraft(draft({ derivedFrom: [] }));
  strictEqual(noDerivation.ok, false);
  if (!noDerivation.ok) strictEqual(noDerivation.cause, "empty-derivation");

  const badInstant = validateDraft(draft({ recordedAt: "2026-08-19" }));
  strictEqual(badInstant.ok, false);
  if (!badInstant.ok) strictEqual(badInstant.cause, "invalid-instant");

  const noOffset = validateDraft(draft({ recordedAt: "2026-08-19T09:00:00" }));
  strictEqual(noOffset.ok, false);
  if (!noOffset.ok) strictEqual(noOffset.cause, "invalid-instant");

  const noBody = validateDraft(draft({ body: undefined }));
  strictEqual(noBody.ok, false);
  if (!noBody.ok) strictEqual(noBody.cause, "body-not-a-string");

  // An empty body is allowed — a turn may legitimately remember nothing in words.
  const emptyBody = validateDraft(draft({ body: "" }));
  strictEqual(emptyBody.ok, true);

  const prefixed = validateDraft(draft({ id: `${MEMORY_ID_PREFIX}m-1` }));
  strictEqual(prefixed.ok, false);
  if (!prefixed.ok) strictEqual(prefixed.cause, "missing-id");

  const unrecognisedKind = validateDraft(draft({ derivedFrom: [{ itemId: "c", kind: "tier-4-secret" }] }));
  strictEqual(unrecognisedKind.ok, false);
  if (!unrecognisedKind.ok) strictEqual(unrecognisedKind.cause, "invalid-derivation");

  const duplicateSource = validateDraft(
    draft({
      derivedFrom: [
        { itemId: "ctx-1", kind: "tier1-local" },
        { itemId: "ctx-1", kind: "tier1-local" },
      ],
    }),
  );
  strictEqual(duplicateSource.ok, false);
  if (!duplicateSource.ok) strictEqual(duplicateSource.cause, "invalid-derivation");
});

test("a shareable memory is the only kind that may leave, and the reason is written for a person", async () => {
  const store = await freshStore();
  const shareable = await rememberOrFail(
    store,
    draft({ id: "m-share", derivedFrom: [{ itemId: "ctx-pub", kind: "tier3-shareable" }] }),
  );
  const confidential = await rememberOrFail(
    store,
    draft({ id: "m-conf", derivedFrom: [{ itemId: "ctx-conf", kind: "tier2-confidential" }] }),
  );

  deepStrictEqual(egressOf(shareable), { state: "may-leave", id: "m-share", kind: "tier3-shareable" });

  const withheld = egressOf(confidential);
  strictEqual(withheld.state, "device-only");
  if (withheld.state === "device-only") {
    ok(withheld.reason.trim().length > 0, "a withheld memory always carries a reason");
    ok(!/\d+(\.\d+)?%/.test(withheld.reason), "the reason is prose, never a percentage");
  }
});

// -------------------------------------------------------------------------------------
// F-007 — the injection budget: a count cap ranked by recency, the withheld count never silent
// -------------------------------------------------------------------------------------

test("over budget: only the most recently recorded memories are included, and the rest are counted withheld", async () => {
  const store = await freshStore();
  const budget = 3;
  const recordedAts = [
    "2026-08-19T09:00:00Z",
    "2026-08-19T10:00:00Z",
    "2026-08-19T11:00:00Z",
    "2026-08-19T12:00:00Z",
    "2026-08-19T13:00:00Z",
  ];
  for (const [i, at] of recordedAts.entries()) {
    await rememberOrFail(store, draft({ id: `m-${i}`, recordedAt: at }));
  }
  const active = activeMemories(await allMemories(store));
  strictEqual(active.length, 5);

  const budgeted = budgetMemories(active, budget);
  strictEqual(budgeted.included.length, budget);
  strictEqual(budgeted.withheldByBudget, 2);
  // The three MOST RECENTLY recorded — m-2, m-3, m-4 — never the first three written.
  deepStrictEqual([...budgeted.included.map((m) => m.id)].sort(), ["m-2", "m-3", "m-4"]);
});

test("under budget: every active memory is included and nothing is reported withheld", async () => {
  const store = await freshStore();
  await rememberOrFail(store, draft({ id: "m-a" }));
  await rememberOrFail(store, draft({ id: "m-b", recordedAt: "2026-08-19T10:00:00Z" }));

  const active = activeMemories(await allMemories(store));
  strictEqual(active.length, 2);

  const budgeted = budgetMemories(active, MEMORY_INJECTION_BUDGET);
  strictEqual(budgeted.withheldByBudget, 0);
  deepStrictEqual(budgeted.included, active);
});

test("boundary-exact: exactly as many active memories as the budget are all included, none withheld", async () => {
  // `budgetMemories`'s own fast path is `active.length <= budget`, not `<` — the count that
  // proves the `<=` and not an off-by-one is exactly this count, at the boundary itself.
  const store = await freshStore();
  const budget = 3;
  const recordedAts = ["2026-08-19T09:00:00Z", "2026-08-19T10:00:00Z", "2026-08-19T11:00:00Z"];
  for (const [i, at] of recordedAts.entries()) {
    await rememberOrFail(store, draft({ id: `m-${i}`, recordedAt: at }));
  }
  const active = activeMemories(await allMemories(store));
  strictEqual(active.length, budget);

  const budgeted = budgetMemories(active, budget);
  strictEqual(budgeted.withheldByBudget, 0);
  deepStrictEqual(budgeted.included, active);
});

test("a tie in recordedAt keeps the earlier array position, not an arbitrary sort order", async () => {
  // Four memories recorded at the SAME instant, so recency alone cannot rank them — the
  // documented tiebreaker (`a.index - b.index` in `budgetMemories`) is the only thing deciding
  // which two survive a budget of 2. Built as a hand-ordered array rather than read back from
  // the store, because `budgetMemories` is pure and documented to rank by `active`'s OWN index
  // — this asserts that contract directly instead of trusting an unspecified store listing
  // order to reproduce it.
  const store = await freshStore();
  const m0 = await rememberOrFail(store, draft({ id: "m-0", recordedAt: AT }));
  const m1 = await rememberOrFail(store, draft({ id: "m-1", recordedAt: AT }));
  const m2 = await rememberOrFail(store, draft({ id: "m-2", recordedAt: AT }));
  const m3 = await rememberOrFail(store, draft({ id: "m-3", recordedAt: AT }));
  const active = [m0, m1, m2, m3];

  const budgeted = budgetMemories(active, 2);
  strictEqual(budgeted.withheldByBudget, 2);
  // Earliest array position wins the tie, in original order — m-0 and m-1, never m-2 or m-3.
  deepStrictEqual(budgeted.included.map((m) => m.id), [m0.id, m1.id]);
});

test("the default injection budget is a real, positive, finite count", () => {
  // A budget of zero would make every live memory unusable; an infinite one is F-007 itself
  // with a new name. Both are the failure modes this constant exists to rule out.
  ok(MEMORY_INJECTION_BUDGET > 0, "a zero budget would make every live memory unusable");
  ok(Number.isFinite(MEMORY_INJECTION_BUDGET), "an infinite budget is F-007 with a new name");
});
