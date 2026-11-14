/**
 * The harvest format's teeth. The cases that matter are the refusals: score-shaped
 * keys at every level, ungrounded prose, provenance that lies, and review-state
 * transitions the format makes unrepresentable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHarvestDocument, HARVEST_SCHEMA_VERSION } from "./harvestDocument.ts";

const VALID = {
  schemaVersion: HARVEST_SCHEMA_VERSION,
  subject: "A Subject",
  identity: "subject@example.com",
  sources: ["/tmp/repo"],
  gatheredAt: "2026-08-16T12:00:00Z",
  candidates: [
    {
      id: "ps-1",
      drafted: { title: "Built the harvest airlock", summary: "A candidate format with review states." },
      evidence: [{ source: "git", ref: "abc123", excerpt: "feat: harvest airlock" }],
      provenance: { method: "local_llm", model: "gemma4:12b", ranLocally: true },
      status: "proposed",
    },
  ],
};

function withCandidate(patch: Record<string, unknown>): unknown {
  return { ...VALID, candidates: [{ ...VALID.candidates[0], ...patch }] };
}

test("aValidHarvestParses", () => {
  const p = parseHarvestDocument(VALID);
  assert.equal(p.ok, true);
  if (p.ok) assert.equal(p.harvest.candidates.length, 1);
});

test("scoreShapedKeysAreRefusedByNameAtEveryLevel", () => {
  // Top level, candidate level, and INSIDE provenance — the model's self-reported
  // confidence is the most likely intruder and must die wherever it lands.
  for (const bad of [
    { ...VALID, confidence: 0.9 },
    withCandidate({ score: 5 }),
    withCandidate({ provenance: { method: "local_llm", model: "m", strength: "high" } }),
  ]) {
    const p = parseHarvestDocument(bad);
    assert.equal(p.ok, false);
    if (!p.ok) assert.ok(p.issues.some((i) => /score-shaped/.test(i.message)), JSON.stringify(p.issues));
  }
});

test("draftedProseWithoutEvidenceIsRefusedNotDecorated", () => {
  const p = parseHarvestDocument(withCandidate({ evidence: [] }));
  assert.equal(p.ok, false);
  if (!p.ok) assert.ok(p.issues.some((i) => i.at === "candidates[0].evidence"));
});

test("provenanceCannotLie", () => {
  // A deterministic draft with a model name, or an LLM draft without one, is refused.
  assert.equal(parseHarvestDocument(withCandidate({ provenance: { method: "deterministic", model: "m" } })).ok, false);
  assert.equal(parseHarvestDocument(withCandidate({ provenance: { method: "local_llm" } })).ok, false);
});

test("reviewStatesAreCoherentByConstruction", () => {
  // proposed + reviewedAt: refused. decided without reviewedAt: refused.
  // promoted while not approved: refused.
  assert.equal(parseHarvestDocument(withCandidate({ reviewedAt: "2026-08-16T12:01:00Z" })).ok, false);
  assert.equal(parseHarvestDocument(withCandidate({ status: "approved" })).ok, false);
  assert.equal(
    parseHarvestDocument(
      withCandidate({ status: "rejected", reviewedAt: "2026-08-16T12:01:00Z", promotedAt: "2026-08-16T12:02:00Z" }),
    ).ok,
    false,
  );
  assert.equal(
    parseHarvestDocument(
      withCandidate({ status: "approved", reviewedAt: "2026-08-16T12:01:00Z", promotedAt: "2026-08-16T12:02:00Z" }),
    ).ok,
    true,
  );
});

test("duplicateCandidateIdsAreRefused", () => {
  const p = parseHarvestDocument({ ...VALID, candidates: [VALID.candidates[0], VALID.candidates[0]] });
  assert.equal(p.ok, false);
});

test("unknownKeysAreRefused", () => {
  assert.equal(parseHarvestDocument({ ...VALID, vibe: "good" }).ok, false);
});
