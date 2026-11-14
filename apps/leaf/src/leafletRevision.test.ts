/** Real repository evidence through the review transport; protocol probes never represent work. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkflow } from "./workflow.ts";
import { loadLeafDocument } from "./leafDocument.ts";
import { applyLeafletSuggestion, exportLeafletReview, parseLeafletReviewRequest, parseLeafletSuggestion, revisionDigest, workflowLeaflet } from "./leafletRevision.ts";
import { portfolioPipeline } from "./portfolioPipeline.ts";
import { loadPublishPolicy } from "./policyDocument.ts";
import { workflowPacket } from "./workflowContext.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const email = execFileSync("git", ["-C", root, "log", "-1", "--format=%ae"], { encoding: "utf8" }).trim();
/**
 * A LEGACY packet over this repository's own recent commits, saved the way collection used to
 * save it. Collection no longer makes packets; saved ones are still read, so the Leaflet they can
 * still become is tested against the saved shape.
 */
async function seedLegacyPacket(dir: string, status: "pending" | "accepted") {
  const now = new Date().toISOString();
  const mine = execFileSync("git", ["-C", root, "log", "--no-merges", "-n", "200", "--format=%H%x00%ae%x00%s"], { encoding: "utf8" })
    .trim().split("\n").map((line) => line.split("\0") as [string, string, string])
    .filter(([, author]) => author.toLowerCase() === email.toLowerCase()).slice(0, 25);
  const source = { id: createHash("sha256").update(`${root}\0${email.toLowerCase()}`).digest("hex"), path: root, email: email.toLowerCase(), enabled: true };
  const proposal = { id: createHash("sha256").update(`${source.id}\0${mine[0]![0]}`).digest("hex"), source: source.id,
    title: mine[0]![2], evidence: mine.map(([sha, author, title]) => ({ sha, email: author, title, observedAt: now })),
    omitted: 0, status, updatedAt: now, capturedAt: now, collectedAt: now, revision: status === "accepted" ? 1 : 0 };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "workflow.json"), JSON.stringify({ version: 1, schedule: null, sources: [source], proposals: [proposal], history: [], nextAt: null, attempt: 0, running: false }));
}
const field = (html: string, name: string) => {
  const raw = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];
  assert.notEqual(raw, undefined, `missing ${name}`);
  return raw!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
};
test("saved draft creates and updates one private Leaflet; stale, cross-origin and wrong-subject writes are refused", { timeout: 40000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "leaflet-revision-"));
  const leafPath = join(dir, "leaf.json");
  execFileSync(process.execPath, ["apps/leaf/intake.mjs", "--repo", root, "--identity", email, "--subject", "Repository revision test", "--out", leafPath], { cwd: root });
  const env = { ...process.env, FOLIAGE_LEAF: leafPath, FOLIAGE_WORKFLOW_DIR: join(dir, "workflow"), PORT: "0", HOST: "127.0.0.1" };
  await seedLegacyPacket(env.FOLIAGE_WORKFLOW_DIR, "pending");
  let app = await openWorkflow(env.FOLIAGE_WORKFLOW_DIR);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const p = app.snapshot().proposals[0]!;
    const original = await loadLeafDocument(env); assert.ok(original.ok);
    const at = new Date().toISOString();
    assert.throws(() => workflowLeaflet(original.leaf, app.snapshot(), p.id, workflowPacket(app.snapshot(), p.id)!.digest, "CI review", original.leaf.subject, at), /Save a private draft/);
    await app.close();
    await seedLegacyPacket(env.FOLIAGE_WORKFLOW_DIR, "accepted");
    app = await openWorkflow(env.FOLIAGE_WORKFLOW_DIR);
    const state = app.snapshot();
    const packet = workflowPacket(state, p.id)!;
    assert.throws(() => workflowLeaflet(original.leaf, state, p.id, packet.digest, "CI review", "Wrong subject", at), /subject/);
    const created = workflowLeaflet(original.leaf, state, p.id, packet.digest, "CI review", original.leaf.subject, at);
    const item = created.leaflets.at(-1)!;
    const policy = await loadPublishPolicy({ FOLIAGE_POLICY: join(dir, "absent-policy.json") });
    const createdPipeline = portfolioPipeline({ ...original, leaf: created }, policy);
    assert.equal(createdPipeline.hosted.lastPublishedRevision, null);
    assert.equal(createdPipeline.record?.leafletCount, created.leaflets.length, "the workflow reads the canonical private record");
    assert.equal(createdPipeline.record?.journeyCount, created.achievements?.length ?? 0);
    assert.ok(createdPipeline.record?.leaflets.length, "retained Leaflets remain visible when no account has been written");
    const examplePipeline = portfolioPipeline({ ...original, source: { ...original.source, declaredExample: true } }, policy);
    assert.equal(examplePipeline.record, null,
      "an example document is not shown as the owner's saved work");
    assert.equal(examplePipeline.recordStatus, "example");
    const offered = { ...original, leaf: { ...created, leaflets: [{ ...item, visibility: "public" as const }] } };
    assert.equal(portfolioPipeline(offered, policy).publication!.eligible, 1, "explicitly offered pending work follows the native public projection");
    assert.equal(portfolioPipeline({ ...offered, leaf: { ...offered.leaf, leaflets: [{ ...item, visibility: "unlisted" }] } }, policy).publication!.eligible, 0, "a private link is not public listing consent");
    const missing = portfolioPipeline({ ok: false, cause: "unconfigured", detail: "Leaf not configured", path: null }, policy);
    assert.equal(missing.publication, null);
    assert.equal(missing.record, null);
    assert.equal(missing.recordStatus, "empty");
    // The panel's visible line is the named problem; the loader's words wait for Technical details.
    assert.deepEqual(missing.blockers, ["The location of your private record isn't set for this workspace. Start Foliage with foliage up."]);
    assert.deepEqual(missing.technical, ["Leaf not configured"]);
    const unreadable = portfolioPipeline({ ok: false, cause: "unreadable", detail: "Leaf cannot be read", path: leafPath, errno: "EACCES" }, policy);
    assert.equal(unreadable.recordStatus, "unavailable", "a broken saved record is never presented as first use");
    const brokenPolicy = portfolioPipeline(original, { ok: false, cause: "unconfigured", detail: "Policy not configured", path: null });
    assert.equal(brokenPolicy.publication, null);
    assert.deepEqual(brokenPolicy.blockers, ["Foliage cannot apply the current publish rules. Fix the policy configuration or file, then reload this page."]);
    assert.deepEqual(brokenPolicy.technical, ["Policy not configured"]);
    const changedPacket = structuredClone(state);
    changedPacket.proposals[0]!.title += " edited";
    assert.throws(() => workflowLeaflet(created, changedPacket, p.id, packet.digest, "CI review", created.subject, at), /changed/);
    assert.equal(item.tier, "pending"); assert.equal(item.visibility, "private");
    assert.deepEqual(item.body!.slice(0, p.evidence.length).map(e => e.provenance.ref), p.evidence.map(e => e.sha));
    assert.ok(item.body!.at(-1)!.text!.includes(`${p.omitted} additional matching commits omitted`));
    const review = exportLeafletReview(created, item.id);
    assert.deepEqual(parseLeafletReviewRequest(JSON.parse(JSON.stringify(review))), review);
    assert.throws(() => parseLeafletReviewRequest({ ...review, title: "Changed bytes" }), /changed/);
    const raw = { format: "foliage-leaflet-suggestion" as const, version: 1 as const, target: review.target,
      title: p.evidence[1]?.title ?? p.title, notes: "Protocol return probe only; no real cloud answer is claimed.", model: "protocol-test", generatedAt: at };
    const suggestion = parseLeafletSuggestion({ ...raw, digest: revisionDigest(raw) });
    const revised = applyLeafletSuggestion(created, suggestion, "CI review", created.subject, at);
    const revisedItem = revised.leaflets.find(l => l.id === item.id)!;
    assert.equal(revisedItem.title, suggestion.title);
    assert.deepEqual(revisedItem.body!.slice(0, item.body!.length), item.body);
    assert.throws(() => applyLeafletSuggestion(revised, suggestion, "CI review", created.subject, at), /changed/);
    assert.throws(() => parseLeafletSuggestion({ ...suggestion, title: "Tampered" }), /changed/);
    assert.throws(() => exportLeafletReview({ ...created, leaflets: [{ ...item, visibility: "public" }] }, item.id), /private/);
    // Same serialization queue is used by commands and the Leaflet commit.
    const serial: string[] = [];
    await Promise.all([app.withSnapshot(async () => { serial.push("review"); await Promise.resolve(); serial.push("saved"); }), app.withSnapshot(async () => { serial.push("next"); })]);
    assert.deepEqual(serial, ["review", "saved", "next"]);
    await app.close();
    child = spawn(process.execPath, ["apps/leaf/server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await new Promise<string>((resolve, reject) => {
      let output = ""; const timeout = setTimeout(() => reject(new Error("Leaf server startup timed out")), 10000);
      child!.stdout!.on("data", b => { output += String(b); const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//); if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); } });
      child!.once("exit", () => { clearTimeout(timeout); reject(new Error("Leaf server exited before readiness")); });
    });
    const post = (path: string, body: URLSearchParams, from = origin) => fetch(origin + path, { method: "POST", headers: { origin: from }, body, redirect: "manual" });
    const getPreview = async () => (await fetch(`${origin}/workflow/leaflet?packet=${p.id}`)).text();
    const formFrom = (html: string) => new URLSearchParams({ packet: p.id, packetRevision: field(html, "packetRevision"), documentRevision: field(html, "documentRevision"), reviewer: "CI review", subject: original.leaf.subject });
    type Status = { pipeline: ReturnType<typeof portfolioPipeline> };
    // An accepted packet never saved to the Leaf keeps its way there: nothing else drafts its commits.
    const before = await (await fetch(origin + "/workflow/api")).json() as Status;
    assert.deepEqual(before.pipeline.unsaved, [{ packetId: p.id, title: p.title, href: `/workflow/leaflet?packet=${p.id}` }]);
    const initial = formFrom(await getPreview());
    assert.equal((await post("/workflow/leaflet", initial, "https://foreign.invalid")).status, 403);
    const wrong = new URLSearchParams(initial); wrong.set("subject", "Wrong subject");
    assert.equal((await post("/workflow/leaflet", wrong)).status, 409);
    assert.equal((await post("/workflow/leaflet", initial)).status, 303);
    assert.equal((await post("/workflow/leaflet", initial)).status, 409);
    const first = await loadLeafDocument(env); assert.ok(first.ok);
    const status = await (await fetch(origin + "/workflow/api")).json() as Status;
    assert.deepEqual(status.pipeline.unsaved, [], "a saved packet is not offered again");
    assert.equal(status.pipeline.documentRevision, first.source.documentDigest);
    assert.equal(status.pipeline.hosted.status, "not-connected");
    assert.equal(first.leaf.leaflets.length, original.leaf.leaflets.length + 1);
    // A saved packet can no longer be edited, so the saved Leaflet is the one the leaf now holds.
    const updated = first;
    const refresh = await fetch(`${origin}/leaf/explore/state?revision=${encodeURIComponent(original.source.documentDigest)}`);
    const payload = await refresh.json() as { revision: string; html: string };
    assert.equal(refresh.status, 200, JSON.stringify(payload));
    assert.equal(payload.revision, updated.source.documentDigest); assert.ok(payload.html.includes(`data-id="${item.id}"`));
    assert.equal((await fetch(`${origin}/leaf/explore/state?revision=${encodeURIComponent(payload.revision)}`)).status, 204);
    const assistanceRefresh = await fetch(`${origin}/leaf/explore/state?revision=${encodeURIComponent(payload.revision)}&assistanceRevision=stale`);
    assert.equal(assistanceRefresh.status, 200, "a connection state change refreshes the view even when Leaf bytes are unchanged");
    const assistancePayload = await assistanceRefresh.json() as { revision: string; html: string };
    assert.equal(assistancePayload.revision, payload.revision);
    assert.match(assistancePayload.html, /data-assistance-revision=/);
    const liveReview = exportLeafletReview(updated.leaf, item.id);
    const liveRaw = { ...raw, target: liveReview.target, title: item.title };
    const liveSuggestion = { ...liveRaw, digest: revisionDigest(liveRaw) };
    const preview = await post("/leaf/revision", new URLSearchParams({ action: "preview", suggestion: JSON.stringify(liveSuggestion) }));
    assert.equal(preview.status, 200); const previewHtml = await preview.text();
    const apply = new URLSearchParams({ action: "apply", suggestion: JSON.stringify(liveSuggestion), documentRevision: field(previewHtml, "documentRevision"), subject: original.leaf.subject, reviewer: "CI review" });
    assert.equal((await post("/leaf/revision", apply, "https://foreign.invalid")).status, 403);
    assert.equal((await post("/leaf/revision", apply)).status, 303);
    const bytes = await readFile(leafPath, "utf8");
    assert.equal((await post("/leaf/revision", apply)).status, 409);
    assert.equal(await readFile(leafPath, "utf8"), bytes);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = new Promise<void>(resolve => child!.once("exit", () => resolve())); child.kill(); await stopped; }
    else await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
