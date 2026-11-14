/** Real repository records for retrieval; protocol construction for framing/failure tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseLeafDocument } from "@foliage/leaf";
import { runScarletTool, readScarletSelection } from "./scarletTools.ts";
import { groundingFor, renderGrounding } from "./scarletPrompt.ts";
import { runScarlet } from "./scarletRun.ts";
import { parseRunAgentInput, encodeSse, type AgUiEvent } from "./agui.ts";
import { renderScarletWorkspace } from "./scarletWorkspace.ts";
import { readScarletStream } from "../public/scarlet-stream.mjs";
import { scarletResourceDigest } from "./scarletContext.ts";
import { parseHarvestDocument } from "@foliage/photosynthesis";
import { effectivePolicyDigest, loadPublishPolicy } from "./policyDocument.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
// Tracked files survive shallow checkouts; every reference names actual repository bytes.
const revision = git("rev-parse", "HEAD").trim();
const paths = git("ls-tree", "-r", "--name-only", "HEAD").trim().split("\n");
const commits = ["README.md", ...paths.filter((path) => path !== "README.md")].map((path) => ({
  ref: `${revision}:${path}`, title: path,
}));
const current = commits[0]!;
const readme = git("show", current.ref);
const observedAt = new Date().toISOString();
const raw = { id: "repository-records", subject: "Repository evidence under test", leaflets: commits.map((commit, i) => ({
  id: commit.ref, title: commit.title, tier: "pending", provenance: { source: "git", ref: commit.ref, observedAt },
  ...(i === 0 ? { body: [{ text: readme, provenance: { source: "git", ref: commit.ref, observedAt } }] } : {}),
})) };
const parsed = parseLeafDocument(raw);
assert.ok(parsed.ok);
const leaf = parsed.leaf;
const digest = `sha256:${createHash("sha256").update(JSON.stringify(raw)).digest("hex")}`;
const source = { path: root, bytes: JSON.stringify(raw).length, documentDigest: digest, readAt: observedAt, declaredExample: false, bundledExample: false };
const loaded = { ok: true as const, leaf, source };

test("search reaches a real record beyond the old title ceiling and retains document order without ranking", () => {
  assert.ok(commits.length > 120, "this regression needs a real records beyond the prior ceiling");
  const target = commits.at(-1)!;
  const found = runScarletTool(leaf, digest, { name: "search_leaflets", query: target.ref });
  assert.equal(found.matched, 1);
  assert.equal(found.documents[0]?.id, target.ref);
  const all = runScarletTool(leaf, digest, { name: "search_leaflets", query: "" });
  assert.deepEqual(all.documents.map((d) => d.id), commits.slice(0, 12).map((c) => c.ref));
  assert.equal(all.omitted, commits.length - all.documents.length);
  assert.equal(runScarletTool(leaf, digest, { name: "search_leaflets", query: "no-record-has-this-ref-" + digest }).matched, 0);
});

test("read supplies recorded body text and refs, declares truncation, and cannot escape the loaded document", () => {
  const context = runScarletTool(leaf, digest, { name: "read_leaflet", id: current.ref });
  const doc = context.documents[0]!;
  assert.equal(doc.body[0]?.text, readme.slice(0, 1200));
  assert.equal(doc.body[0]?.provenance.ref, current.ref);
  assert.match(doc.notes.join(" "), /shortened/);
  assert.equal(context.omitted, 0);
  const prompt = renderGrounding(groundingFor(leaf, source, context));
  assert.ok(prompt.includes(JSON.stringify(readme.slice(0, 1200))));
  assert.ok(!prompt.includes(commits[1]!.ref), "unselected evidence must not enter the prompt");
  assert.equal(runScarletTool(leaf, digest, { name: "read_leaflet", id: "../../private-file" }).documents.length, 0);
});

test("tool selection accepts only named read operations and validates scope and digest", () => {
  const foliage = { documentDigest: digest, tool: { name: "read_leaflet", id: current.ref } };
  assert.equal(readScarletSelection({ foliage }).ok, true);
  for (const tool of [{ name: "publish", id: current.ref }, { name: "read_leaflet", id: "" }, { name: "search_leaflets", query: "x".repeat(201) }]) {
    assert.equal(readScarletSelection({ foliage: { ...foliage, tool } }).ok, false);
  }
  assert.equal(readScarletSelection({ foliage: { ...foliage, documentDigest: "" } }).ok, false);
  const input = parseRunAgentInput({ threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "Read this record" }], forwardedProps: { foliage } });
  assert.ok(input.ok);
  assert.deepEqual(input.input.selection, foliage);
});

test("a changed document or missing selection refuses before spending the model", async () => {
  for (const [documentDigest, id, why] of [[`sha256:${"0".repeat(64)}`, current.ref, /changed/], [digest, "absent", /No readable leaflet/]] as const) {
    const events: AgUiEvent[] = [];
    const result = await runScarlet({ leaf: loaded, model: { ok: false, cause: "no-model-declared" },
      input: { threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "Read" }], ignored: { tools: 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 },
        selection: { documentDigest, tool: { name: "read_leaflet", id } } },
      ids: { messageId: "answer" }, signal: new AbortController().signal, emit: (event) => events.push(event),
      stream: async () => { throw new Error("the model must not be reached"); } });
    assert.equal(result.kind, "refused");
    assert.equal(events.at(-1)?.type, "RUN_ERROR");
    assert.match(JSON.stringify(result), why);
  }
});

test("workspace uses escaped real content, explicit scope, and a bounded tool report", () => {
  const html = renderScarletWorkspace(loaded, { ok: false, cause: "no-model-declared" }, { name: "read_leaflet", id: current.ref });
  assert.match(html, /class="lb-model-setup"/);
  assert.match(html, /href="\/scarlet\/setup">Choose local model<\/a>/);
  assert.match(html, /class="lb-document lb-document--compact"/);
  assert.doesNotMatch(html, /data-tool="read_leaflet"|scarlet-client\.mjs|No body text|Ask about this/);
  assert.match(html, /class="lb-workspace lb-workspace--single lb-workspace--selected"/);
  assert.ok(html.indexOf('class="lb-model-setup"') < html.indexOf('class="lb-document lb-document--compact"'));
  assert.ok(html.indexOf('class="lb-document lb-document--compact"') < html.indexOf('class="lb-find"'));
  assert.doesNotMatch(html, /class="lb-document lb-document--compact"[\s\S]*?<details open>/);
  assert.doesNotMatch(html, /<span class="fol-metric">1<\/span> shown/);
  const ready = renderScarletWorkspace(loaded, { ok: true, config: { model: "local-protocol", baseUrl: "http://127.0.0.1:11434" } }, { name: "read_leaflet", id: current.ref });
  assert.match(ready, /data-tool="read_leaflet"/);
  assert.ok(ready.indexOf('class="lb-conversation"') < ready.indexOf('class="lb-context"'));
  assert.match(ready, /scarlet-client\.mjs/);
  assert.ok(ready.includes(`data-digest="${digest}"`));
  assert.match(ready, /Local model · <span class="fol-metric">local-protocol<\/span><\/span>/);
  // A declared model has not been asked anything yet, so the pane never claims it is ready — once.
  assert.match(ready, /<p id="lb-status" role="status" aria-live="polite">Model set · not checked yet<\/p>/);
  assert.equal(ready.split(/not checked/i).length - 1, 1, "not checked is said once");
  assert.doesNotMatch(ready, />Ready</);
  const refusalsOf = (html: string) => JSON.parse(/data-refusals="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  const refusals = refusalsOf(ready);
  assert.deepEqual(refusals["no-runtime"], { label: "The local model isn't answering at 127.0.0.1:11434", recovery: { label: "Get Ollama", href: "https://docs.ollama.com/quickstart" } });
  assert.deepEqual(refusals["model-absent"]?.recovery, { label: "Choose local model", href: "/scarlet/setup" });
  assert.equal(refusals["leaf-unavailable"], undefined, "the run's own leaf sentences are shown as written");
  const elsewhere = refusalsOf(renderScarletWorkspace(loaded, { ok: true, config: { model: "local-protocol", baseUrl: "http://127.0.0.1:8080" } }, { name: "read_leaflet", id: current.ref }));
  assert.deepEqual(elsewhere["no-runtime"], { label: "The local model isn't answering at 127.0.0.1:8080", recovery: { label: "Ollama setup help", href: "https://docs.ollama.com/quickstart" } },
    "the address a run calls, and no claim that Ollama is missing");
  assert.doesNotMatch(ready, /Photosynthesis · Local|No body text|No observed date/);
  assert.match(ready, /<span>Pending<\/span>/);
  assert.doesNotMatch(ready, /class="lb-provenance-summary"/);
  const titleOnly = renderScarletWorkspace(loaded, { ok: true, config: { model: "local-protocol", baseUrl: "http://127.0.0.1:11434" } }, { name: "read_leaflet", id: commits[1]!.ref });
  assert.match(titleOnly, /class="lb-provenance-summary"/);
  assert.ok(titleOnly.includes(`Git · <span class="fol-metric">${revision.slice(0, 7)}</span>`));
  assert.ok(titleOnly.includes(`<time class="fol-metric" datetime="${observedAt}">`));
  assert.doesNotMatch(titleOnly, /<details open><summary>Evidence<\/summary>/);
  const titleOnlyWithoutModel = renderScarletWorkspace(loaded, { ok: false, cause: "no-model-declared" }, { name: "read_leaflet", id: commits[1]!.ref });
  assert.doesNotMatch(titleOnlyWithoutModel, /class="lb-provenance-summary"|id="lb-ask"/);
  assert.match(titleOnlyWithoutModel, /class="lb-model-setup"/);
  assert.match(ready, /<div class="lb-starters" role="group" aria-label="Question starters">/);
  assert.match(ready, /<details class="lb-task-picker"><summary>Task · Understand evidence<\/summary><nav class="lb-modes" aria-label="Task">/);
  assert.ok(ready.indexOf('class="lb-starters"') < ready.indexOf('id="lb-ask"'));
  assert.match(ready, /data-question="What does this record support/);
  assert.doesNotMatch(html, /class="lb-starters"|id="lb-ask"/);
  const browsing = renderScarletWorkspace(loaded, { ok: false, cause: "no-model-declared" }, { name: "search_leaflets", query: "" });
  assert.ok(browsing.indexOf('class="lb-model-setup"') < browsing.indexOf('class="lb-documents"'));
  const empty = renderScarletWorkspace({ ...loaded, leaf: { ...leaf, leaflets: [] } }, { ok: false, cause: "no-model-declared" }, { name: "search_leaflets", query: "" });
  assert.match(empty, /No matching work/);
  const emptyWithModel = renderScarletWorkspace({ ...loaded, leaf: { ...leaf, leaflets: [] } },
    { ok: true, config: { model: "local-protocol", baseUrl: "http://127.0.0.1:11434" } }, { name: "search_leaflets", query: "" });
  assert.match(emptyWithModel, /class="lb-workspace lb-workspace--single"[\s\S]*?No matching work/);
  assert.doesNotMatch(emptyWithModel, /class="lb-conversation"|id="lb-ask"|class="lb-starters"|scarlet-client\.mjs/);
  const missingWithModel = renderScarletWorkspace(loaded,
    { ok: true, config: { model: "local-protocol", baseUrl: "http://127.0.0.1:11434" } }, { name: "read_leaflet", id: "absent" });
  assert.match(missingWithModel, /Record unavailable/);
  assert.doesNotMatch(missingWithModel, /class="lb-conversation"|id="lb-ask"|scarlet-client\.mjs/);
});

test("a refusal's next step opens in a new tab, as citations do, so the conversation is kept", async () => {
  const client = await readFile(new URL("../public/scarlet-client.mjs", import.meta.url), "utf8");
  const refused = /\nfunction refused\(answer, item\) \{[\s\S]*?\n\}\n/.exec(client)![0];
  assert.match(refused, /link\.href = copy\.recovery\.href;[\s\S]*?link\.target = "_blank";\s*link\.rel = "noopener noreferrer";/);
});

const start: AgUiEvent = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const messageStart: AgUiEvent = { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" };
const delta: AgUiEvent = { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: readme.slice(0, 80) };
const end: AgUiEvent = { type: "TEXT_MESSAGE_END", messageId: "a" };
const finished: AgUiEvent = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
function response(events: readonly AgUiEvent[], fragment = 7): Response {
  const bytes = new TextEncoder().encode(events.map(encodeSse).join("").replaceAll("\n", "\r\n"));
  let at = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (at === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(at, at + fragment));
    at = Math.min(bytes.length, at + fragment);
  } }), { headers: { "content-type": "text/event-stream" } });
}

test("client decodes fragmented CRLF streams and requires terminal completion", async () => {
  const events = [start, messageStart, delta, end, finished];
  const seen: unknown[] = [];
  await readScarletStream(response(events), { threadId: "t", runId: "r" }, (e) => seen.push(e));
  assert.deepEqual(seen, events);
  await assert.rejects(readScarletStream(response(events.slice(0, -1)), { threadId: "t", runId: "r" }, () => {}), /interrupted/);
  await assert.rejects(readScarletStream(response([start, delta]), { threadId: "t", runId: "r" }, () => {}), /fragment/);
  await assert.rejects(readScarletStream(response(events), { threadId: "wrong", runId: "r" }, () => {}), /different run/);
  await assert.rejects(readScarletStream(response([...events, delta]), { threadId: "t", runId: "r" }, () => {}), /after the run ended/);
});

test("workspace HTTP seam scopes context, isolates script permissions, and rejects changed or foreign requests", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-context-"));
  const leafPath = join(dir, "leaf.json");
  await writeFile(leafPath, JSON.stringify(raw));
  const harvestPath = join(dir, "harvest.json");
  const harvestRaw = { leafId: raw.id, subject: raw.subject, candidates: [{ id: current.ref, title: current.title,
    evidence: [{ source: "git", ref: current.ref, observedAt, excerpt: readme }], extractor: "git", draftedAt: observedAt, review: { state: "candidate" } }] };
  await writeFile(harvestPath, JSON.stringify(harvestRaw));
  const harvest = parseHarvestDocument(harvestRaw);
  assert.ok(harvest.ok);
  const policyPath = join(dir, "policy.json");
  const policy = await loadPublishPolicy({ FOLIAGE_POLICY: policyPath });
  assert.ok(policy.ok);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_LEAF: leafPath,
      FOLIAGE_HARVEST: harvestPath, FOLIAGE_POLICY: policyPath, FOLIAGE_SOURCE_REPO: "", FOLIAGE_LOCAL_MODEL: "", FOLIAGE_LOCAL_MODEL_BASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (data) => { output += String(data); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Server exited: ${output}`)); });
      child.stdout.on("data", (data) => {
        output += String(data);
        const url = /\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    const get = (path: string) => fetch(base + path, { signal: AbortSignal.timeout(4000) });
    const workspace = await get(`/scarlet/workspace?leaflet=${encodeURIComponent(current.ref)}`);
    assert.equal(workspace.status, 200);
    assert.match(workspace.headers.get("content-security-policy") ?? "", /script-src 'self'; connect-src 'self'/);
    const workspaceHtml = await workspace.text();
    assert.match(workspaceHtml, /href="\/scarlet\/setup">Choose local model<\/a>/);
    assert.doesNotMatch(workspaceHtml, /data-tool="read_leaflet"|scarlet-client\.mjs/);
    const plain = await get("/scarlet");
    assert.doesNotMatch(plain.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.doesNotMatch(await plain.text(), /<script/);
    for (const asset of ["scarlet-client.mjs", "scarlet-stream.mjs"]) {
      const response = await get(`/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /javascript/);
      await response.text();
    }
    const post = (documentDigest: string, origin = base, extra: Record<string, unknown> = {}) => fetch(base + "/scarlet/run", {
      method: "POST", headers: { "content-type": "application/json", origin }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "Read this record" }],
        forwardedProps: { foliage: { documentDigest, tool: { name: "read_leaflet", id: current.ref }, ...extra } } }),
    });
    const events: Record<string, any>[] = [];
    await readScarletStream(await post(digest), { threadId: "t", runId: "r" }, (event) => events.push(event));
    const context = events.find((event) => event["name"] === "foliage.grounding")?.["value"].context;
    assert.deepEqual(context.documents.map((doc: { id: string }) => doc.id), [current.ref]);
    assert.equal(events.at(-1)?.["code"], "no-model-declared");
    const draftPage = await get(`/scarlet/workspace?candidate=${encodeURIComponent(current.ref)}`);
    assert.equal(draftPage.status, 200);
    assert.match(await draftPage.text(), /Back/);
    const draftSelection = { tool: { name: "read_candidate", id: current.ref }, purpose: "review", harvestDigest: scarletResourceDigest(harvest.harvest) };
    const draftEvents: Record<string, any>[] = [];
    await readScarletStream(await post(digest, base, draftSelection), { threadId: "t", runId: "r" }, (event) => draftEvents.push(event));
    const draftContext = draftEvents.find((e) => e["name"] === "foliage.grounding")?.["value"].context;
    assert.equal(draftContext.documents[0].candidateState, "candidate");
    assert.equal(draftContext.documents[0].tier, undefined);
    await writeFile(harvestPath, JSON.stringify({ ...harvestRaw, candidates: [] }));
    assert.match(await (await post(digest, base, draftSelection)).text(), /draft changed/);
    const publishSelection = { purpose: "publish", policyDigest: effectivePolicyDigest(policy.policy, policy.source) };
    const publishEvents: Record<string, any>[] = [];
    await readScarletStream(await post(digest, base, publishSelection), { threadId: "t", runId: "r" }, (event) => publishEvents.push(event));
    assert.equal(publishEvents.find((e) => e["name"] === "foliage.grounding")?.["value"].context.publication[0].state, "not-shared");
    await writeFile(policyPath, JSON.stringify({ rules: [] }));
    assert.match(await (await post(digest, base, publishSelection)).text(), /policy changed/);
    assert.match(await (await post(`sha256:${"0".repeat(64)}`)).text(), /changed/);
    const foreign = await post(digest, "https://foreign.invalid");
    assert.equal(foreign.status, 403);
    await foreign.text();
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
