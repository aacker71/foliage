/** Real repository collection; no generated model answer is treated as evidence. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkflow, type WorkflowSnapshot } from "./workflow.ts";
import { workflowPacket, readWorkflowContext } from "./workflowContext.ts";
import { resolveScarletContext } from "./scarletContext.ts";
import { readScarletSelection } from "./scarletTools.ts";
import { workflowGrounding, renderGrounding } from "./scarletPrompt.ts";
import { exportWorkflowTransfer, parseWorkflowTransfer } from "./workflowTransfer.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const email = execFileSync("git", ["-C", root, "log", "-1", "--format=%ae"], { encoding: "utf8" }).trim();
/**
 * A LEGACY packet over this repository's own recent commits, saved the way collection used to
 * save it. Collection no longer makes packets; saved ones are still read, so their readers are
 * tested against the saved shape.
 */
async function seedLegacyPacket(dir: string, status: "pending" | "accepted") {
  const now = new Date().toISOString();
  const mine = execFileSync("git", ["-C", root, "log", "--no-merges", "-n", "200", "--format=%H%x00%ae%x00%s"], { encoding: "utf8" })
    .trim().split("\n").map((line) => line.split("\0") as [string, string, string])
    .filter(([, author]) => author.toLowerCase() === email.toLowerCase()).slice(0, 25);
  const source = { id: createHash("sha256").update(`${root}\0${email.toLowerCase()}`).digest("hex"), path: root, email: email.toLowerCase(), enabled: true };
  const proposal = { id: createHash("sha256").update(`${source.id}\0${mine[0]![0]}`).digest("hex"), source: source.id,
    title: `Review repository work: ${mine[0]![2]}`, evidence: mine.map(([sha, author, title]) => ({ sha, email: author, title, observedAt: now })),
    omitted: 0, status, updatedAt: now, capturedAt: now, collectedAt: now, revision: 0 };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "workflow.json"), JSON.stringify({ version: 1, schedule: null, sources: [source], proposals: [proposal], history: [], nextAt: null, attempt: 0, running: false }));
}
/** A saved packet changes only by its owner's earlier decision; reproduce that on disk. */
async function acceptLegacyPacket(dir: string) {
  const file = join(dir, "workflow.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  state.proposals[0] = { ...state.proposals[0], status: "accepted", revision: state.proposals[0].revision + 1, updatedAt: new Date().toISOString() };
  await writeFile(file, JSON.stringify(state));
}

test("workflow context keeps real refs and collection time, invalidates edits, and never assigns a proof tier", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-context-"));
  await seedLegacyPacket(dir, "pending");
  let app = await openWorkflow(dir);
  try {
    const state = app.snapshot();
    const p = state.proposals[0]!;
    const packet = workflowPacket(state, p.id)!;
    assert.throws(() => exportWorkflowTransfer(state, p.id, packet.digest), /Save the private draft/);
    const selection = { documentDigest: packet.digest, tool: { name: "read_workflow" as const, id: p.id }, purpose: "review" as const, includeSource: true };
    assert.ok(readScarletSelection({ foliage: selection }).ok);
    assert.equal(readScarletSelection({ foliage: { ...selection, purpose: "publish" } }).ok, false);
    const read = await resolveScarletContext(undefined, selection, { workflow: state, sourceRepo: "/not-the-packets-repository", signal: new AbortController().signal });
    assert.ok(read.ok);
    const doc = read.context.documents[0]!;
    assert.equal(doc.tier, undefined);
    assert.equal(doc.capturedAt, p.capturedAt);
    assert.deepEqual(doc.workflowEvidence?.map((e) => e.sha), p.evidence.slice(0, 8).map((e) => e.sha));
    assert.equal(read.context.sourceReads?.[0]?.state, "read", "uses packet source rather than global repository");
    assert.equal(doc.href, `/workflow/export?packet=${p.id}`, "a legacy packet links to the one page that still shows it");
    // Line-anchored: the source read carries this repository's own diff as data, and a diff of
    // this file quotes the phrase; only a rendered line of the grounding is a tier count.
    const grounding = renderGrounding(workflowGrounding(read.context));
    assert.match(grounding, /^This is a private workflow packet, not a Leaf\. No proof tiers or portfolio claims are supplied\.$/m);
    assert.doesNotMatch(grounding, /^Leaflets by tier/m);
    await app.close();
    await acceptLegacyPacket(dir);
    app = await openWorkflow(dir);
    assert.match(JSON.stringify(readWorkflowContext(app.snapshot(), selection)), /changed/);
    const saved = app.snapshot();
    assert.equal(saved.proposals[0]!.capturedAt, p.capturedAt);
    const savedSelection = { ...selection, documentDigest: workflowPacket(saved, p.id)!.digest };
    const transfer = exportWorkflowTransfer(saved, p.id, savedSelection.documentDigest);
    assert.deepEqual(transfer.evidence.map(e => e.sha), p.evidence.map(e => e.sha));
    assert.equal(transfer.omitted, p.omitted);
    assert.ok(!JSON.stringify(transfer).includes(root));
    assert.ok(transfer.evidence.every(e => !("email" in e)));
    assert.deepEqual(parseWorkflowTransfer(JSON.parse(JSON.stringify(transfer))), transfer);
    assert.throws(() => parseWorkflowTransfer({ ...transfer, title: transfer.title + " changed" }), /changed/);
    assert.throws(() => parseWorkflowTransfer({ ...transfer, path: root }), /fields/);
    assert.throws(() => exportWorkflowTransfer(saved, p.id, packet.digest), /changed/);
    assert.ok(readWorkflowContext(saved, savedSelection).ok);
    await app.command({ action: "source-remove", id: p.source });
    assert.match(JSON.stringify(readWorkflowContext(app.snapshot(), savedSelection)), /changed/);
    const removed = app.snapshot();
    const newSelection = { ...selection, documentDigest: workflowPacket(removed, p.id)!.digest };
    const detached = await resolveScarletContext(undefined, newSelection, { workflow: removed, sourceRepo: root, signal: new AbortController().signal });
    assert.ok(detached.ok);
    assert.equal(detached.context.sourceReads?.[0]?.state, "unavailable", "does not fall back to an unrelated source");
    assert.equal(detached.context.documents[0]!.workflowEvidence?.[0]?.sha, p.evidence[0]!.sha);
    const legacy = structuredClone(removed);
    delete legacy.proposals[0]!.capturedAt;
    const old = readWorkflowContext(legacy, { ...selection, documentDigest: workflowPacket(legacy, p.id)!.digest });
    assert.ok(old.ok);
    assert.equal(old.context.documents[0]!.capturedAt, undefined);
    assert.match(old.context.documents[0]!.notes.join(" "), /not recorded/);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test("workflow HTTP handoff works without a Leaf, keeps AG-UI context, and refuses stale or foreign requests", { timeout: 25_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-handoff-"));
  await seedLegacyPacket(join(dir, "state"), "accepted");
  const app = await openWorkflow(join(dir, "state"));
  const p = app.snapshot().proposals[0]!;
  await app.close();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_WORKFLOW_DIR: join(dir, "state"), FOLIAGE_LEAF: join(dir, "absent.json"), FOLIAGE_LOCAL_MODEL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (d) => { output += String(d); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output)), 10_000);
      child.once("error", (e) => { clearTimeout(timer); reject(e); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
      child.stdout.on("data", (d) => {
        output += String(d);
        const url = /\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    const page = await fetch(`${base}/scarlet/workspace?packet=${p.id}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    // Without a configured model the packet remains readable, while the inert Ask form is absent.
    assert.match(html, /Choose local model/);
    assert.doesNotMatch(html, /name="packet"/);
    assert.doesNotMatch(html, /data-tool="read_workflow"/);
    assert.ok(html.includes(`/workflow/export?packet=${p.id}`));
    const state = await (await fetch(`${base}/workflow/api`)).json() as WorkflowSnapshot;
    const packet = workflowPacket(state, p.id)!;
    const payload = { threadId: "handoff", runId: "question", messages: [{ id: "question", role: "user", content: "What is recorded?" }],
      forwardedProps: { foliage: { documentDigest: packet.digest, tool: { name: "read_workflow", id: p.id }, purpose: "review" } } };
    const post = (origin = base) => fetch(`${base}/scarlet/run`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(payload) });
    const events = await (await post()).text();
    assert.match(events, /foliage.grounding/);
    assert.ok(events.includes(p.evidence[0]!.sha));
    assert.match(events, /no-model-declared/);
    assert.doesNotMatch(events, /TEXT_MESSAGE_CONTENT/);
    // Packets are no longer edited here: the workflow's review list is gone, and its decision
    // action with it.
    const edit = await fetch(`${base}/workflow/api`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ action: "decision", id: p.id, revision: p.revision ?? 0, title: p.title, status: "accepted" }) });
    assert.equal(edit.status, 400);
    const savedRevision = packet.digest;
    const stale = `sha256:${"0".repeat(64)}`;
    const exportPage = await fetch(`${base}/workflow/export?packet=${p.id}`);
    assert.equal(exportPage.status, 200);
    assert.match(await exportPage.text(), /Portable evidence packet/);
    const download = await fetch(`${base}/workflow/export.json?packet=${p.id}&revision=${encodeURIComponent(savedRevision)}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal(parseWorkflowTransfer(await download.json()).packetId, p.id);
    assert.equal((await fetch(`${base}/workflow/export.json?packet=${p.id}&revision=${encodeURIComponent(stale)}`)).status, 409);
    assert.equal((await fetch(`${base}/workflow/export`, { method: "POST" })).status, 405);
    payload.forwardedProps.foliage.documentDigest = stale;
    assert.match(await (await post()).text(), /packet or its source changed/);
    assert.equal((await post("https://foreign.invalid")).status, 403);
    const missing = await fetch(`${base}/scarlet/workspace?packet=${"0".repeat(64)}`);
    assert.equal(missing.status, 409);
    assert.match(await missing.text(), /Workflow packet unavailable · \/review/);
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
