/** Protocol fixtures only. These tests do not claim that a live model assessed anybody's work. */
import { parseLeafletReviewRequest, parseLeafletSuggestion, revisionDigest } from "@foliage/leaf-app/leafletRevision";
import { previewWorkflowImport } from "./workflowImport.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DIMENSIONS, ASSESSMENT_PROMPT, digest, parseFindings, parsePacket, redactPacket } from "./ladybugAssessment.ts";
import { assessPacket } from "./ladybugInference.ts";
import { loadWorkspace, releaseAssessment, runAssessment, savePacket, exportLeafletSuggestion, workspacePath } from "./ladybugWorkspace.ts";
import { assessmentInventory, assessmentPublicationPath, readAssessmentPublication, writeAssessmentPublication } from "./assessmentPublication.ts";
import { renderAssessmentWorkspace, renderReleasedAssessment } from "./renderAssessment.ts";

// The source is actual project text. Stubbed conclusions below are labelled test assertions.
const source = (await readFile(new URL("../../../docs/CANOPY-CLOUD.md", import.meta.url), "utf8")).split("\n").find(line => line.startsWith("Canopy Cloud is"))!;
const packet = parsePacket({ id: "ladybug-test", subject: "Protocol test", evidence: source, knownWork: "", market: "", correction: "" });
const findings = DIMENSIONS.map(dimension => ({ dimension, observation: "Protocol test: the submitted excerpt is available.", caveat: "This test does not assess model quality or establish real-world impact.", citations: [{ source: "evidence", quote: source }] }));
const configured = { FOLIAGE_ESCALATED_INFERENCE_KEY: "test-credential-not-real", FOLIAGE_ESCALATED_INFERENCE_MODEL: "protocol-test-model", FOLIAGE_ASSESSMENT_PROVIDER_APPROVED: "true" };
const reply = (content: unknown = { findings }, finish_reason = "stop"): Response => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(content), reasoning_content: "Never display this private field" } }] }));
const stub: typeof fetch = async () => reply();

test("the model's response template satisfies the structural contract and covers every dimension", () => {
  // Inspect the actual model-facing template, not a separately invented valid response.
  // Its placeholders are instructions, so this checks structure without treating them as evidence.
  const line = ASSESSMENT_PROMPT.split("\n").find(line => line.startsWith("Return JSON only: "))!;
  const example = JSON.parse(line.slice("Return JSON only: ".length, -1));
  assert.deepEqual(example.findings.map((f: { dimension: string }) => f.dimension), [...DIMENSIONS]);
  assert.doesNotThrow(() => parseFindings(example.findings));
});

test("assessment packets are closed, bounded, explicit and deterministically redacted", () => {
  assert.throws(() => parsePacket({ ...packet, score: 9 }));
  assert.throws(() => parsePacket({ ...packet, id: "../escape" }));
  assert.throws(() => parsePacket({ ...packet, evidence: "" }));
  assert.throws(() => parsePacket({ ...packet, evidence: "a".repeat(12_001) }));
  assert.notEqual(redactPacket({ ...packet, evidence: "Reach author@example.com" }).evidence, "Reach author@example.com");
  assert.throws(() => workspacePath({ FOLIAGE_LADYBUG: "/tmp/public/private.json", FOLIAGE_PUBLISHED: "/tmp/public" }));
  assert.match(ASSESSMENT_PROMPT, /no browsing tools/i);
  assert.match(ASSESSMENT_PROMPT, /no person\/work scores/i);
  const html = renderAssessmentWorkspace(null, null, "csrf", false, null, "http://127.0.0.1:4173");
  const pattern = new RegExp(`^(?:${/pattern="([^"]+)"/.exec(html)?.[1]})$`, "v");
  assert.equal(pattern.test("my-portfolio"), true);
  assert.equal(pattern.test("../escape"), false);
});

test("findings require exact evidence citations, caveats and no rating-shaped output", () => {
  assert.equal(parseFindings(findings, packet).length, 6);
  for (const changed of [
    { ...findings[0], score: 5 }, { ...findings[0], caveat: "" },
    { ...findings[0], observation: "9 out of 10" }, { ...findings[0], dimension: "rank" },
    { ...findings[0], citations: [] }, { ...findings[0], citations: [{ source: "evidence", quote: "invented quotation" }] },
    { ...findings[0], citations: [{ source: "url", quote: source }] },
    { ...findings[0], observation: "Contact author@example.com" },
  ]) assert.throws(() => parseFindings([changed], packet));
  assert.throws(() => parseFindings([findings[0], findings[0]], packet));
});

test("Fireworks requires explicit configuration; request pins endpoint, forbids redirects and does not read reasoning", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.fireworks.ai/inference/v1/chat/completions");
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.model, configured.FOLIAGE_ESCALATED_INFERENCE_MODEL);
    assert.equal(body.tools, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), packet);
    return reply();
  };
  for (const env of [{}, { ...configured, FOLIAGE_ASSESSMENT_PROVIDER_APPROVED: "false" }, { ...configured, FOLIAGE_ESCALATED_INFERENCE_MODEL: "" }]) {
    await assert.rejects(assessPacket(packet, env, fetcher), /not ready/);
  }
  assert.equal(calls, 0);
  const accepted = await assessPacket(packet, configured, fetcher);
  assert.equal(calls, 1);
  assert.equal(accepted.packetDigest, digest(packet));
  assert.doesNotMatch(JSON.stringify(accepted), /private field/);
});

test("Fireworks refusals never salvage partial answers or echo provider content", async () => {
  const responses = [reply({ findings }, "length"), reply({ findings: findings.slice(0, 1) }),
    reply({ findings, score: 10 }), new Response("provider-private-error", { status: 429 }),
    new Response("bad-json-with-secret"), new Response("a".repeat(128 * 1024 + 1))];
  for (const response of responses) {
    await assert.rejects(assessPacket(packet, configured, async () => response), error => {
      assert.doesNotMatch(String(error), /provider-private-error|bad-json-with-secret/); return true;
    });
  }
  await assert.rejects(assessPacket(packet, configured, async () => { throw new Error("secret"); }), /transport failed/);
});

test("private review -> selected release -> immediate withdrawal -> stale retry refused, including after reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-ladybug-"));
  const path = join(dir, "private", "ladybug.json");
  const publicRoot = join(dir, "published");
  try {
    await savePacket(path, digest(null), packet);
    const draft = (await loadWorkspace(path))!;
    assert.equal(draft.status, "draft");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(runAssessment(path, digest(draft), "wrong", configured, stub), /id doesn’t match/);
    await assert.rejects(releaseAssessment(path, digest(draft), publicRoot, digest(null), packet.id, ["impact"]));
    await runAssessment(path, digest(draft), packet.id, configured, stub);
    const assessed = (await loadWorkspace(path))!;
    assert.equal(assessed.status, "assessed");
    assert.equal(await readAssessmentPublication(publicRoot, packet.id), null);
    await assert.rejects(releaseAssessment(path, digest(assessed), publicRoot, digest(null), packet.id, []), /Select at least/);
    await releaseAssessment(path, digest(assessed), publicRoot, digest(null), packet.id, ["impact"]);
    const publication = (await readAssessmentPublication(publicRoot, packet.id))!;
    await writeFile(assessmentPublicationPath(publicRoot, "broken-record"), "private-content-that-must-not-appear-in-errors");
    const inventory = await assessmentInventory(publicRoot);
    assert.equal(inventory.items.length, 1);
    assert.deepEqual(inventory.unreadable, ["broken-record"]);
    await assert.rejects(readAssessmentPublication(publicRoot, "broken-record"), error => {
      assert.doesNotMatch(String(error), /private-content-that/); return true;
    });
    assert.deepEqual(publication.release?.findings.map(f => f.dimension), ["impact"]);
    const publicHtml = renderReleasedAssessment(publication);
    assert.match(publicHtml, /Limits and uncertainty/);
    assert.doesNotMatch(publicHtml, /name="finding"|name="csrf"|correction/);
    const html = renderAssessmentWorkspace(assessed, publication, "csrf", true, "model", "http://127.0.0.1:4173");
    assert.doesNotMatch(html, /checked[ =>]/);
    assert.match(html, />Withdraw<\/button>/);
    const releasedBytes = await readFile(assessmentPublicationPath(publicRoot, packet.id), "utf8");
    await savePacket(path, digest(assessed), { ...packet, correction: "Please account for the evidence limits." });
    assert.equal((await loadWorkspace(path))?.assessment, null);
    assert.equal(await readFile(assessmentPublicationPath(publicRoot, packet.id), "utf8"), releasedBytes);
    await assert.rejects(releaseAssessment(path, digest(assessed), publicRoot, digest(publication), packet.id, ["impact"]));
    await writeAssessmentPublication(publicRoot, packet.id, digest(publication), null);
    const withdrawn = (await readAssessmentPublication(publicRoot, packet.id))!;
    assert.equal(withdrawn.release, null);
    assert.doesNotMatch(renderReleasedAssessment(withdrawn), /Protocol test: the submitted/);
    await assert.rejects(writeAssessmentPublication(publicRoot, packet.id, digest(null), publication.release), /review changed/i);
    await assert.rejects(writeAssessmentPublication(publicRoot, packet.id, digest(publication), publication.release), /review changed/i);
    await writeFile(assessmentPublicationPath(publicRoot, "broken-record"), "null");
    await assert.rejects(readAssessmentPublication(publicRoot, "broken-record"), /malformed/);
    await writeFile(path, "broken-private-state");
    assert.equal((await readAssessmentPublication(publicRoot, packet.id))?.release, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("editing during inference discards late results; provider failure remains private and retryable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-ladybug-race-"));
  const path = join(dir, "ladybug.json");
  try {
    await savePacket(path, digest(null), packet);
    const before = (await loadWorkspace(path))!;
    const racing: typeof fetch = async () => {
      const running = (await loadWorkspace(path))!;
      await savePacket(path, digest(running), { ...packet, correction: "New user challenge" });
      return reply();
    };
    await assert.rejects(runAssessment(path, digest(before), packet.id, configured, racing), /review changed/i);
    const changed = (await loadWorkspace(path))!;
    assert.equal(changed.packet.correction, "New user challenge");
    assert.equal(changed.assessment, null);
    await runAssessment(path, digest(changed), packet.id, {}, stub);
    assert.equal((await loadWorkspace(path))?.status, "failed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("Leaflet review target survives private import and assessment, returning only a revision-bound suggestion", async () => {
  // Explicit protocol fixture around real project prose; this does not claim a cloud completion.
  const content = { format: "foliage-leaflet-review" as const, version: 1 as const,
    target: { leafId: "protocol-leaf", leafletId: "protocol-record", revision: revisionDigest(source) },
    subject: packet.subject, title: source.slice(0, 500), evidence: source };
  const request = parseLeafletReviewRequest({ ...content, digest: revisionDigest(content) });
  const imported = previewWorkflowImport(JSON.stringify(request), packet.id, packet.subject);
  assert.deepEqual(imported.target, request.target);
  assert.throws(() => previewWorkflowImport(JSON.stringify(request), packet.id, "Different subject"), /subject/);
  const dir = await mkdtemp(join(tmpdir(), "ladybug-return-"));
  const path = join(dir, "assessment.json");
  try {
    await savePacket(path, digest(null), imported);
    const before = (await loadWorkspace(path))!;
    assert.throws(() => exportLeafletSuggestion(before, digest(before), content.title), /current assessment/);
    await runAssessment(path, digest(before), imported.id, configured, stub);
    const assessed = (await loadWorkspace(path))!;
    const returned = exportLeafletSuggestion(assessed, digest(assessed), content.title);
    assert.deepEqual(parseLeafletSuggestion(returned), returned);
    assert.deepEqual(returned.target, request.target);
    for (const finding of findings) { assert.ok(returned.notes.includes(finding.caveat)); assert.ok(returned.notes.includes(finding.citations[0]!.quote)); }
    assert.match(renderAssessmentWorkspace(assessed, null, "csrf", true, "protocol-test", "http://127.0.0.1:4173"), /Download suggestion/);
    assert.throws(() => exportLeafletSuggestion(assessed, digest(before), content.title), /current assessment/);
    assert.throws(() => exportLeafletSuggestion(assessed, digest(assessed), "9 out of 10"), /rating/);
    assert.equal((await loadWorkspace(path))?.revision, assessed.revision, "export must not mutate the private workspace");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
