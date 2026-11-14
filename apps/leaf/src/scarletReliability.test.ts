/** Actual repository bytes, with explicit protocol/draft constructions; no model result fixtures. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLeafDocument } from "@foliage/leaf";
import { parseHarvestDocument } from "@foliage/photosynthesis";
import { readScarletSource } from "./scarletSource.ts";
import { resolveScarletContext, scarletResourceDigest } from "./scarletContext.ts";
import { readScarletSelection, runScarletTool } from "./scarletTools.ts";
import { reviewScarletAnswer } from "./scarletAnswerReview.ts";
import { groundingFor } from "./scarletPrompt.ts";
import { loadPublishPolicy, effectivePolicyDigest } from "./policyDocument.ts";
import { runScarlet } from "./scarletRun.ts";
import type { AgUiEvent } from "./agui.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const ref = git("rev-parse", "HEAD");
const title = git("show", "-s", "--format=%s", ref);
const observedAt = new Date().toISOString();
const readme = git("show", `${ref}:README.md`);
const provenance = { source: "git", ref, observedAt };
const raw = { id: "repository-under-test", subject: "Repository evidence under test", leaflets: [
  { id: ref, title, tier: "pending", provenance, body: [{ text: readme, provenance }] },
] };
const parsed = parseLeafDocument(raw);
assert.ok(parsed.ok);
const leaf = parsed.leaf;
const documentDigest = scarletResourceDigest(raw);
const context = runScarletTool(leaf, documentDigest, { name: "read_leaflet", id: ref });
const signal = new AbortController().signal;

test("answer checks flag missing/unknown citations and contradictions with supplied literal facts without claiming truth", () => {
  const codes = (text: string) => reviewScarletAnswer(text, context).findings.map((f) => f.code);
  assert.ok(codes("No dates are provided. [L1]").includes("overlooked-date"));
  assert.ok(codes("The body is unavailable. [L1]").includes("overlooked-text"));
  assert.ok(codes("Recorded on 1901-01-01. [L1]").includes("date-not-in-context"));
  assert.ok(codes("As recorded. [L9]").includes("unknown-citation"));
  assert.ok(codes("A suggestion without evidence labels.").includes("missing-citations"));
  assert.deepEqual(codes(`The evidence was observed on ${observedAt.slice(0, 10)}. [L1]`), []);
  // Correct citation syntax does not establish that an arbitrary sentence is supported.
  assert.deepEqual(codes("This sentence could still be wrong. [L1]"), []);
});

test("source reader reads the actual selected commit, bounds the excerpt, and does not run repository diff commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-source-"));
  const clone = join(dir, "repo");
  try {
    execFileSync("git", ["clone", "--shared", "--no-checkout", root, clone], { stdio: "ignore" });
    const marker = join(dir, "external-diff-ran");
    execFileSync("git", ["-C", clone, "config", "diff.external", `touch ${marker}`]);
    const read = await readScarletSource(clone, ref, signal);
    assert.equal(read.state, "read");
    assert.ok(read.text?.includes(ref));
    assert.ok(read.text!.length <= 12_000);
    await assert.rejects(access(marker));
    assert.equal((await readScarletSource(undefined, ref, signal)).state, "unavailable");
    assert.match((await readScarletSource(clone, "HEAD:../../private", signal)).detail, /complete recorded/);
    assert.match((await readScarletSource(join(dir, "missing"), ref, signal)).detail, /could not read/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("review context reads real evidence excerpts, preserves unbound attribution, and refuses changed or foreign harvests", async () => {
  const draft = parseHarvestDocument({ candidates: [{ id: ref, title, evidence: [{ ...provenance, excerpt: readme }],
    extractor: "git", draftedAt: observedAt, review: { state: "candidate" } }] });
  assert.ok(draft.ok);
  const selection = { documentDigest, harvestDigest: scarletResourceDigest(draft.harvest), purpose: "review" as const, tool: { name: "read_candidate" as const, id: ref } };
  const result = await resolveScarletContext(leaf, selection, { harvest: { ok: true, harvest: draft.harvest, path: root }, signal });
  assert.ok(result.ok);
  assert.equal(result.context.documents[0]?.tier, undefined);
  assert.equal(result.context.documents[0]?.candidateState, "candidate");
  assert.equal(result.context.documents[0]?.body[0]?.text, readme.slice(0, 1200));
  assert.match(result.context.subject!, /Unbound/);
  const g = groundingFor(leaf, { documentDigest, path: root, bytes: 0, readAt: observedAt, declaredExample: false, bundledExample: false }, result.context);
  assert.equal(g.pending, 0, "a colliding candidate id must not borrow the leaflet's tier");
  const changed = { ...draft.harvest, candidates: [] };
  const stale = await resolveScarletContext(leaf, selection, { harvest: { ok: true, harvest: changed, path: root }, signal });
  assert.ok(!stale.ok && /changed/.test(stale.why));
  const foreign = { ...draft.harvest, leafId: "different-target" };
  const mismatch = await resolveScarletContext(leaf, { ...selection, harvestDigest: scarletResourceDigest(foreign) }, { harvest: { ok: true, harvest: foreign, path: root }, signal });
  assert.ok(!mismatch.ok && /different Leaf/.test(mismatch.why));
  // `why` is the run's visible status: drafts that did not load are named, not the loader's path or parser text.
  const broken = await resolveScarletContext(leaf, selection, { harvest: { ok: false, cause: "malformed", detail: `${root}/harvest.json is not valid JSON: Unexpected token`, path: `${root}/harvest.json` }, signal });
  assert.deepEqual(broken, { ok: false, why: "Couldn't read your drafts. Review shows what to repair." });
});

test("publish context uses the effective policy and rejects stale rules; tool additions require their resource digests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-policy-"));
  try {
    const policy = await loadPublishPolicy({ FOLIAGE_POLICY: join(dir, "absent.json") });
    assert.ok(policy.ok);
    const selection = { documentDigest, purpose: "publish" as const, policyDigest: effectivePolicyDigest(policy.policy, policy.source), tool: { name: "read_leaflet" as const, id: ref } };
    const result = await resolveScarletContext(leaf, selection, { policy, signal });
    assert.ok(result.ok);
    assert.equal(result.context.publication?.[0]?.state, "not-shared");
    const stale = await resolveScarletContext(leaf, { ...selection, policyDigest: scarletResourceDigest("old policy") }, { policy, signal });
    assert.ok(!stale.ok && /policy changed/.test(stale.why));
    const broken = await resolveScarletContext(leaf, selection, { policy: { ok: false, cause: "malformed", detail: `${dir}/policy.json is not valid JSON`, path: `${dir}/policy.json` }, signal });
    assert.deepEqual(broken, { ok: false, why: "Foliage cannot apply the current publish rules. Fix the policy configuration or file, then reload this page." });
    assert.equal(readScarletSelection({ foliage: selection }).ok, true);
    assert.equal(readScarletSelection({ foliage: { ...selection, policyDigest: undefined } }).ok, false);
    assert.equal(readScarletSelection({ foliage: { documentDigest, tool: { name: "read_candidate", id: ref } } }).ok, false);
    assert.equal(readScarletSelection({ foliage: { ...selection, includeSource: "yes" } }).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("scoped run emits its answer checks before completion and passes selected source content into the model", async () => {
  const events: AgUiEvent[] = [];
  const selection = { documentDigest, includeSource: true, tool: { name: "read_leaflet" as const, id: ref } };
  await runScarlet({ input: { threadId: "t", runId: "r", selection,
    messages: [{ id: "u", role: "user", content: "When was this evidence observed?" }],
    ignored: { tools: 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 } },
    leaf: { ok: true, leaf, source: { documentDigest, path: root, bytes: 0, readAt: observedAt, declaredExample: false, bundledExample: false } },
    model: { ok: true, config: { model: "protocol-stub", baseUrl: "http://127.0.0.1:1" } },
    ids: { messageId: "a" }, signal, emit: (e) => events.push(e),
    resolveContext: (selection) => resolveScarletContext(leaf, selection, { sourceRepo: root, signal }),
    stream: async (_config, messages, _signal, emit) => {
      assert.match(messages[0]!.content, /sourceReads/);
      assert.match(messages[0]!.content, /Commit metadata and patch/);
      const text = `${observedAt} [L1]`;
      emit(text);
      return { ok: true, text, doneReason: "stop" };
    },
  });
  const review = events.at(-2);
  assert.ok(review?.type === "CUSTOM" && review.name === "foliage.answer-review");
  assert.deepEqual(review.value.findings, []);
  assert.equal(events.at(-1)?.type, "RUN_FINISHED");
});
