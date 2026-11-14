/** Real repository intake underlies these tests. Account text and malformed cases are explicit
 * protocol probes, never written into a person's portfolio or presented as achievements. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseLeafDocument, type Leaf, type Leaflet, type TextBodyElement } from "@foliage/leaf";
import { loadLeafDocument } from "./leafDocument.ts";
import { revisionDigest, workflowLeaflet, type RevisionTarget } from "./leafletRevision.ts";
import { applyLeafletStory, canTellStory, readLeafletStory, readStoryElement, STORY_SECTIONS, storyElements, storyEvidence } from "./leafletStory.ts";
import { openWorkflow } from "./workflow.ts";
import { workflowPacket } from "./workflowContext.ts";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const at = new Date().toISOString();
const by = "Guided story protocol test";
let directory: string;
let leaf: Leaf;
let record: Leaflet;
let identity: string;
const target = (document: Leaf = leaf, item: Leaflet = record): RevisionTarget => ({ leafId: document.id, leafletId: item.id, revision: revisionDigest(item) });
const section = (key = "problem", text = "Protocol probe: capture the reason behind the retained repository evidence.", evidence = 0) => ({ section: key, text, evidence });
const save = (sections = [section()], document = leaf, item = record) => applyLeafletStory(document, target(document, item), sections, by, document.subject, at);
const savedRecord = (document: Leaf) => document.leaflets.find(item => item.id === record.id)!;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-story-logic-"));
  const { stdout } = await exec("git", ["-C", repo, "log", "-1", "--format=%ae%n%an"]);
  const [email, subject] = stdout.trim().split("\n");
  assert.ok(email && subject);
  identity = email;
  const path = join(directory, "leaf.json");
  await exec(process.execPath, [fileURLToPath(new URL("../intake.mjs", import.meta.url)), "--repo", repo, "--identity", identity, "--subject", subject, "--out", path]);
  const loaded = await loadLeafDocument({ FOLIAGE_LEAF: path });
  assert.ok(loaded.ok);
  leaf = loaded.leaf;
  const pending = leaf.leaflets.find(item => item.tier === "pending" && storyEvidence(item).length > 0);
  assert.ok(pending, "real intake must offer pending evidence for this protocol test");
  record = pending;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("four accounts retain exact evidence and stay distinct from copied source material", () => {
  const before = structuredClone(leaf);
  const inputs = STORY_SECTIONS.map(({ key, prompt }) => section(key, `Protocol prompt under test: ${prompt}`));
  const changed = save(inputs);
  const item = savedRecord(changed);
  assert.ok(parseLeafDocument(changed).ok);
  assert.deepEqual(leaf, before, "pure save must not mutate its input");
  assert.equal(item.title, record.title);
  assert.equal(item.tier, record.tier);
  assert.equal(item.visibility, record.visibility);
  assert.deepEqual(item.provenance, record.provenance);
  assert.deepEqual(item.body!.slice(4), record.body ?? []);
  assert.deepEqual(changed.leaflets.filter(value => value.id !== item.id), leaf.leaflets.filter(value => value.id !== item.id));
  assert.deepEqual(readLeafletStory(item), inputs);
  assert.deepEqual(storyEvidence(item), storyEvidence(record), "account paragraphs cannot become their own supporting evidence");
  for (const [index, element] of item.body!.slice(0, 4).entries()) {
    const parsed = readStoryElement(element);
    assert.ok(parsed);
    assert.equal(parsed.text, inputs[index]!.text);
    assert.equal(element.provenance.source, `subject:story/${inputs[index]!.section}`);
    assert.equal(element.provenance.ref, `sha256:${createHash("sha256").update(element.text!).digest("hex")}`);
    assert.deepEqual(parsed.supporting, storyEvidence(record)[0]);
    assert.equal(parsed.reviewer, by);
    assert.equal(parsed.at, at);
    assert.match(element.text!, /does not independently verify the account or authorship/);
  }
  assert.match(STORY_SECTIONS.find(value => value.key === "contribution")!.prompt, /with whom.*AI helped.*checked/);
});

test("partial edits replace only owned sections, preserve blank sections and retain original evidence", () => {
  const first = save([section(), section("contribution", "Protocol probe: explicitly account for human, collaborator and AI involvement.")]);
  const firstItem = savedRecord(first);
  const next = save([section("problem", "Updated protocol probe: why the original evidence mattered."), section("contribution", "  ", -1)], first, firstItem);
  const nextItem = savedRecord(next);
  assert.equal(readLeafletStory(nextItem).length, 2);
  assert.equal(readLeafletStory(nextItem)[0]!.text, "Updated protocol probe: why the original evidence mattered.");
  assert.equal(readLeafletStory(nextItem)[1]!.text, readLeafletStory(firstItem)[1]!.text);
  assert.deepEqual(nextItem.body!.filter(value => !readStoryElement(value)), record.body ?? []);
  assert.equal(nextItem.body!.filter(value => value.provenance.source === "subject:story/problem").length, 1);
  assert.equal(readLeafletStory(nextItem).some(value => value.section === "outcome"), false, "unwritten context remains absent");
  assert.throws(() => save([section("problem", " ", -1)]), /Write one section/);
});

test("record and subject binding refuse stale or misdirected accounts", () => {
  const changed = save();
  assert.throws(() => applyLeafletStory(changed, target(), [section()], by, changed.subject, at), /changed/);
  assert.throws(() => applyLeafletStory(leaf, { ...target(), leafId: "different-leaf" }, [section()], by, leaf.subject, at), /subject/);
  assert.throws(() => applyLeafletStory(leaf, target(), [section()], by, `${leaf.subject} `, at), /subject/);
  assert.throws(() => applyLeafletStory(leaf, { ...target(), leafletId: "missing-record" }, [section()], by, leaf.subject, at), /changed/);
  assert.throws(() => applyLeafletStory(leaf, { ...target(), revision: "not-a-digest" }, [section()], by, leaf.subject, at), /revision/);
});

test("attribution and sharing states cannot be changed through personal context", () => {
  // These are gate probes over the same actual evidence, not asserted attributions.
  for (const tier of ["verified", "excluded"] as const) {
    const probe = { ...record, tier, ...(tier === "excluded" ? { reason: "Scope gate protocol probe, not an attribution decision." } : {}) } as Leaflet;
    const document = { ...leaf, leaflets: [probe] };
    assert.throws(() => save([section()], document, probe), /pending, private/);
  }
  for (const visibility of ["public", "unlisted"] as const) {
    const probe: Leaflet = { ...record, visibility };
    assert.throws(() => save([section()], { ...leaf, leaflets: [probe] }, probe), /pending, private/);
  }
});

test("missing or malformed supporting references cannot be substituted", () => {
  for (const index of [-1, storyEvidence(record).length, 0.5, NaN, Infinity]) assert.throws(() => save([section("problem", "Protocol evidence-selection probe.", index)]), /supporting reference/);
  const { provenance: _originalReference, ...withoutReference } = record;
  const empty: Leaflet = { ...withoutReference, tier: "pending", body: [] };
  assert.throws(() => save([section()], { ...leaf, leaflets: [empty] }, empty), /supporting reference/);
  const selected = storyEvidence(record)[0]!;
  const copied: Leaflet = { ...record, body: [...(record.body ?? []), { text: "Evidence de-duplication protocol probe.", provenance: selected }] };
  assert.deepEqual(storyEvidence(copied), storyEvidence(record));
});

test("Tell story is offered exactly where a story can be saved", () => {
  assert.equal(canTellStory(record), true);
  assert.doesNotThrow(() => save());
  // Gate probes over the same actual evidence, not asserted attributions or sharing choices.
  const { provenance: _originalReference, ...withoutReference } = record;
  const refused = [
    { ...record, tier: "verified" },
    { ...record, tier: "excluded", reason: "Scope gate protocol probe, not an attribution decision." },
    { ...record, visibility: "public" },
    { ...record, visibility: "unlisted" },
    { ...withoutReference, tier: "pending", body: [] },
  ] as Leaflet[];
  for (const probe of refused) {
    assert.equal(canTellStory(probe), false);
    assert.throws(() => save([section()], { ...leaf, leaflets: [probe] }, probe));
  }
});

test("malformed and oversized inputs are refused while observed quantities remain prose", () => {
  for (const text of ["Protocol score: 90", "Protocol rank=1", "Protocol 5/5", "Protocol rating: 100%", "Protocol 5 stars"]) assert.throws(() => save([section("outcome", text)]), /scores, ratings or rankings/);
  assert.doesNotThrow(() => save([section("outcome", "Protocol wording probe: measured latency changed from 400ms to 80ms; this test does not claim a benchmark result.")]));
  assert.throws(() => save([section("problem", "x".repeat(2601))]), /2600/);
  assert.throws(() => save([section("unknown")]), /known story section/);
  assert.throws(() => save([section(), section()]), /known story section/);
  const malformed = [{ section: "problem", text: "Protocol input-shape probe." }, { ...section(), surprise: "extra" }, null, "wrong"];
  for (const input of malformed) assert.throws(() => save([input as ReturnType<typeof section>]), /Unexpected story section fields/);
  for (const reviewer of ["", " ", "x".repeat(201), "first\nsecond"]) assert.throws(() => applyLeafletStory(leaf, target(), [section()], reviewer, leaf.subject, at), /one line/);
  for (const instant of ["yesterday", "2026-01-01", "2026-01-01T10:00:00"]) assert.throws(() => applyLeafletStory(leaf, target(), [section()], by, leaf.subject, instant), /recorded instant/);
});

test("only validated receipts receive story presentation and editable ownership", () => {
  const valid = savedRecord(save()).body![0]!;
  const damaged: TextBodyElement = { ...valid, text: `${valid.text}\nProtocol corruption probe.` };
  const unknown: TextBodyElement = { text: "Original source-prefix collision probe.", provenance: { ...valid.provenance, source: "subject:story/problem" } };
  assert.equal(readStoryElement(damaged), null);
  assert.equal(readStoryElement(unknown), null);
  const probe: Leaflet = { ...record, body: [damaged, unknown, ...(record.body ?? [])] };
  const result = savedRecord(save([section()], { ...leaf, leaflets: [probe] }, probe));
  assert.deepEqual(result.body!.slice(1), probe.body, "a namespace prefix alone must not authorize deleting original evidence");
  assert.equal(readLeafletStory(result).length, 1);
});

test("story reading survives evidence refresh order and reports a removed supporting reference", () => {
  const item = savedRecord(save([section(), section("contribution", "Protocol continuity probe: preserve the recorded account.")]));
  const reordered: Leaflet = { ...item, body: [...(record.body ?? []), ...item.body!.slice(0, 2)] };
  assert.deepEqual(storyElements(reordered).slice(0, 2), item.body!.slice(0, 2));
  assert.equal(storyElements(reordered).length, reordered.body!.length);
  assert.deepEqual(storyElements(reordered).slice(2), record.body ?? []);
  const { provenance: _originalReference, ...withoutReference } = item;
  const removed: Leaflet = { ...withoutReference, tier: "pending", body: item.body!.slice(0, 2) };
  assert.deepEqual(readLeafletStory(removed).map(value => value.evidence), [-1, -1]);
  assert.throws(() => save(readLeafletStory(removed).map(value => ({ ...value })), { ...leaf, leaflets: [removed] }, removed), /supporting reference/);
});

/**
 * A LEGACY accepted packet over this repository's own recent commits, saved the way collection
 * and review used to save it. Collection no longer makes packets; saved ones can still become a
 * Leaflet, so that path is tested against the saved shape.
 */
async function seedAcceptedPacket(dir: string) {
  const now = new Date().toISOString();
  const { stdout } = await exec("git", ["-C", repo, "log", "--no-merges", "-n", "200", "--format=%H%x00%ae%x00%s"]);
  const mine = stdout.trim().split("\n").map((line) => line.split("\0") as [string, string, string])
    .filter(([, author]) => author.toLowerCase() === identity.toLowerCase()).slice(0, 25);
  const source = { id: createHash("sha256").update(`${repo}\0${identity.toLowerCase()}`).digest("hex"), path: repo, email: identity.toLowerCase(), enabled: true };
  const proposal = { id: createHash("sha256").update(`${source.id}\0${mine[0]![0]}`).digest("hex"), source: source.id,
    title: mine[0]![2], evidence: mine.map(([sha, author, title]) => ({ sha, email: author, title, observedAt: now })),
    omitted: 0, status: "accepted", updatedAt: now, capturedAt: now, collectedAt: now, revision: 1 };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "workflow.json"), JSON.stringify({ version: 1, schedule: null, sources: [source], proposals: [proposal], history: [], nextAt: null, attempt: 0, running: false }));
}

test("a saved Photosynthesis workflow packet refresh retains the recorded account and its supporting citation", async () => {
  await seedAcceptedPacket(join(directory, "story-workflow"));
  const workflow = await openWorkflow(join(directory, "story-workflow"));
  try {
    const proposal = workflow.snapshot().proposals[0];
    assert.ok(proposal?.evidence.length);
    const state = workflow.snapshot();
    const packet = workflowPacket(state, proposal.id)!;
    const prepared = workflowLeaflet(leaf, state, proposal.id, packet.digest, by, leaf.subject, at);
    const pending = prepared.leaflets.at(-1)!;
    assert.equal(pending.tier, "pending");
    const gitIndex = storyEvidence(pending).findIndex(value => value.source === "git");
    assert.ok(gitIndex >= 0);
    const recorded = applyLeafletStory(prepared, target(prepared, pending), [section("problem", "Workflow continuity protocol probe over retained Git evidence.", gitIndex)], by, leaf.subject, at);
    const recordedItem = recorded.leaflets.find(value => value.id === pending.id)!;
    const originalStory = readStoryElement(recordedItem.body![0]!);
    assert.ok(originalStory);
    const refreshed = workflowLeaflet(recorded, state, proposal.id, packet.digest, by, leaf.subject, new Date().toISOString());
    const refreshedItem = refreshed.leaflets.find(value => value.id === pending.id)!;
    assert.deepEqual(storyElements(refreshedItem)[0], originalStory.element);
    assert.deepEqual(readLeafletStory(refreshedItem), readLeafletStory(recordedItem));
    assert.deepEqual(refreshedItem.body!.filter(value => value.provenance.source === "git").map(value => value.provenance.ref), proposal.evidence.map(value => value.sha));
    assert.equal(refreshedItem.tier, "pending");
    assert.equal(refreshedItem.visibility, "private");
  } finally { await workflow.close(); }
});

test("an approved draft's commit is one story reference, and a story that cited the drafter's handle keeps its reference", () => {
  // Parser input in promotion's shape: the commit is the provenance (the drafter's handle) and the body (git).
  const sha = "4621d812164e27b29d37d7e69334e6bf99d0d088";
  const observedAt = "2026-08-13T00:00:00Z";
  const handle = { source: "photosynthesis:git-cluster", ref: sha, observedAt };
  const commit = { source: "git", ref: sha, observedAt };
  const promoted = { id: "git-cluster:Fix", title: "Fix: one trailing newline", tier: "pending", provenance: handle, body: [{ provenance: commit, text: "Fix: one trailing newline" }] };
  const parsed = parseLeafDocument({ id: "story-handle-probe", subject: "Story Probe", leaflets: [promoted] });
  assert.ok(parsed.ok);
  const item = parsed.leaf.leaflets[0]!;
  assert.deepEqual(storyEvidence(item), [commit], "one commit, under the source that produced it");
  // A story recorded before this fold could cite the handle triple; it still resolves to the commit.
  const paragraph = `The problem\nProtocol probe: why the newline mattered.\n\nSupporting evidence: ${JSON.stringify(handle)}\nAccount recorded by: ${JSON.stringify(by)}\nAccount recorded at: ${observedAt}\nThis is the person's recorded account. Its supporting reference does not independently verify the account or authorship.`;
  const story = { text: paragraph, provenance: { source: "subject:story/problem", ref: `sha256:${createHash("sha256").update(paragraph).digest("hex")}`, observedAt } };
  const withStory = parseLeafDocument({ ...parsed.leaf, leaflets: [{ ...promoted, body: [story, ...promoted.body] }] });
  assert.ok(withStory.ok);
  assert.ok(readStoryElement(withStory.leaf.leaflets[0]!.body![0]!), "the probe is a well-formed story paragraph");
  assert.deepEqual(readLeafletStory(withStory.leaf.leaflets[0]!), [{ section: "problem", text: "Protocol probe: why the newline mattered.", evidence: 0 }]);
});
