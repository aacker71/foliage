/** Synthetic gate inputs only: no person, customer evidence or source verification is claimed. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PUBLISHED_ARTIFACT, parsePublishedDocument } from "@foliage/canopy";
import { HostedAdmissionError, MAX_ADMISSION_BYTES, admitPublication, publicationBytes, type PublicationConsent } from "./hostedAdmission.ts";

const ACTOR = { id: "00000000-0000-4000-8000-000000000001" };
const FOREIGN = { id: "00000000-0000-4000-8000-000000000002" };
const OPERATION = "00000000-0000-4000-8000-000000000003";
const REVISION = "00000000-0000-4000-8000-000000000004";
const POLICY_DIGEST = `sha256:${"b".repeat(64)}`;
const OWNER = { actorId: ACTOR.id, subjectId: "admission-test" };
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function artifact() {
  return {
    artifact: PUBLISHED_ARTIFACT, artifactVersion: 3, publishedAt: "2026-09-08T00:00:00Z",
    source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1, policyDigest: POLICY_DIGEST },
    leaf: { id: OWNER.subjectId, subject: "Synthetic admission input", subjectRedacted: false,
      leaflets: [{ id: "test-input", title: "Synthetic gate input", tier: "pending", titleRedacted: false }] },
    withheld: { count: 0, kinds: [] },
  };
}
function consent(value: unknown = artifact()): PublicationConsent {
  const parsed = parsePublishedDocument(value);
  assert.ok(parsed.ok);
  return { intent: "publish", operationId: OPERATION, subjectId: OWNER.subjectId,
    artifactDigest: hash(publicationBytes(parsed.document)), policyDigest: POLICY_DIGEST,
    expectedRevisionId: null, expectedGeneration: 0 };
}
const rejects = (code: HostedAdmissionError["code"]) => (error: unknown) => error instanceof HostedAdmissionError && error.code === code;
function admission(document: unknown = artifact(), reviewed = consent(), owner = OWNER, actor = ACTOR) {
  return admitPublication({ actor, owner, document, consent: reviewed });
}

test("pending v3 input preserves native proof semantics and binds the exact canonical stored bytes", () => {
  const input = artifact();
  const reviewed = consent(input);
  const result = admission(input, reviewed);
  assert.equal(result.document.artifactVersion, 3);
  assert.equal(result.document.leaf.leaflets[0]?.tier, "pending");
  assert.equal(result.admission.artifactDigest, hash(publicationBytes(result.document)));
  assert.equal(result.admission.artifactDigest, reviewed.artifactDigest);
  assert.equal(publicationBytes(result.document).at(-1), "}".charCodeAt(0), "no trailing newline");
  assert.equal(result.admission.actorId, ACTOR.id);
  assert.equal(result.admission.subjectId, OWNER.subjectId);
  assert.equal(result.admission.operationId, OPERATION);
  assert.match(result.admission.admissionId, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.admission.consentId, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(result.admission.admissionId, result.admission.consentId);
  assert.ok(Object.isFrozen(result.admission));
  input.leaf.leaflets[0]!.title = "Changed after admission";
  assert.equal(result.document.leaf.leaflets[0]?.title, "Synthetic gate input", "admission owns a separate parsed snapshot");
});

test("matching retry IDs are stable across JSON key order and do not read a clock or mint random IDs", () => {
  const input = artifact();
  const reordered = { withheld: input.withheld, leaf: input.leaf, source: input.source,
    publishedAt: input.publishedAt, artifactVersion: input.artifactVersion, artifact: input.artifact };
  assert.deepEqual(admission(input).admission, admission(reordered).admission);
  const reviewed = { ...consent(), expectedRevisionId: REVISION, expectedGeneration: 2 };
  assert.deepEqual(admission(input, reviewed).admission, admission(input, { ...reviewed }).admission);
  assert.notEqual(admission(input).admission.consentId, admission(input, reviewed).admission.consentId);
});

test("server actor, stored owner, claimed subject and artifact subject must all agree", () => {
  assert.throws(() => admission(artifact(), consent(), OWNER, FOREIGN), rejects("forbidden"));
  assert.throws(() => admission(artifact(), consent(), { actorId: FOREIGN.id, subjectId: OWNER.subjectId }), rejects("forbidden"));
  assert.throws(() => admission(artifact(), { ...consent(), subjectId: "other-subject" }), rejects("consent-mismatch"));
  const foreign = artifact(); foreign.leaf.id = "other-subject";
  assert.throws(() => admission(foreign, consent(foreign)), rejects("forbidden"));
  assert.throws(() => admission(artifact(), consent(), OWNER, { id: "not-provider-verified-uuid" }), rejects("forbidden"));
  // A valid account ID is not a subject title or a company-role assertion.
  const ownerSpoof = { ...artifact(), account: ACTOR.id, tenant: "other-company", role: "policy_owner" };
  assert.throws(() => admission(ownerSpoof), rejects("invalid-artifact"));
});

test("an upload is not consent: missing, unexpected or unsupported decision fields are refused", () => {
  for (const change of [
    { intent: "approve" }, { operationId: "" }, { expectedRevisionId: "not-a-revision" },
    { expectedGeneration: -1 }, { expectedGeneration: 0.5 }, { expectedGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { artifactDigest: "not-a-digest" }, { policyDigest: "" }, { delegatedBy: ACTOR.id },
  ]) {
    assert.throws(() => admission(artifact(), { ...consent(), ...change } as PublicationConsent), rejects("consent-mismatch"));
  }
  const missing: Record<string, unknown> = { ...consent() }; delete missing["intent"];
  assert.throws(() => admission(artifact(), missing as unknown as PublicationConsent), rejects("consent-mismatch"));
  assert.throws(() => admission(artifact(), null as unknown as PublicationConsent), rejects("consent-mismatch"));
});

test("reviewed content and effective policy digest cannot be substituted at admission", () => {
  const changed = artifact(); changed.leaf.leaflets[0]!.title = "Different synthetic input";
  assert.throws(() => admission(changed), rejects("consent-mismatch"));
  assert.throws(() => admission(artifact(), { ...consent(), artifactDigest: `sha256:${"c".repeat(64)}` }), rejects("consent-mismatch"));
  assert.throws(() => admission(artifact(), { ...consent(), policyDigest: `sha256:${"c".repeat(64)}` }), rejects("consent-mismatch"));
  // Current revision and generation checks deliberately belong to the atomic store transaction.
  const request = { ...consent(), expectedRevisionId: REVISION, expectedGeneration: 7 };
  assert.equal(admission(artifact(), request).admission.expectedGeneration, 7);
});

test("client-asserted verified claims are explicitly refused even when the native v3 codec accepts them", () => {
  const pending = artifact();
  const verified = { ...pending, leaf: { ...pending.leaf, leaflets: [{ ...pending.leaf.leaflets[0], tier: "verified",
    provenance: { source: "git", ref: "test-only-ref", observedAt: "2026-09-08T00:00:00Z" } }] } };
  assert.ok(parsePublishedDocument(verified).ok, "shape validation is not an independent source verifier");
  const before = JSON.stringify(verified);
  assert.throws(() => admission(verified, consent(verified)), rejects("verification-required"));
  assert.equal(JSON.stringify(verified), before, "do not downgrade or mutate evidence to force admission");
  const signedClientJson = { ...verified, signature: "client-signed-arbitrary-json" };
  assert.throws(() => admission(signedClientJson, consent(verified)), rejects("invalid-artifact"));
});

test("empty publication is honest and does not fabricate proof or import hidden local evidence", () => {
  const empty = artifact(); empty.leaf.leaflets = [];
  assert.equal(admission(empty, consent(empty)).document.leaf.leaflets.length, 0);
  for (const changed of [
    { ...artifact(), privateLeaf: { secrets: "test-only-private-evidence" } },
    { ...artifact(), source: { ...artifact().source, rawEvidence: "test-only-private-evidence" } },
  ]) {
    assert.throws(() => admission(changed), error => {
      assert.ok(rejects("invalid-artifact")(error));
      assert.doesNotMatch(String(error), /test-only-private-evidence/);
      return true;
    });
  }
});

test("unsupported versions, excluded tiers and format attacks do not receive an admission", () => {
  for (const version of [1, 2, 8, "3", null]) assert.throws(() => admission({ ...artifact(), artifactVersion: version }), rejects("invalid-artifact"));
  const excluded = artifact(); excluded.leaf.leaflets[0]!.tier = "excluded";
  assert.throws(() => admission(excluded), rejects("invalid-artifact"));
  for (const value of [null, [], "arbitrary-string", { ...artifact(), __proto__: null, extra: true }]) assert.throws(() => admission(value), rejects("invalid-artifact"));
  const circular: Record<string, unknown> = {}; circular["self"] = circular;
  assert.throws(() => admission(circular), rejects("invalid-artifact"));
  assert.throws(() => admission({ payload: "x".repeat(MAX_ADMISSION_BYTES) }), rejects("invalid-artifact"));
});
