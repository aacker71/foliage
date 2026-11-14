/** Real MCP clients and local Git records; no remote provider results or customer claims. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withDocumentLocks } from "@foliage/leaf/local-files";
import { ACHIEVEMENT_CLAIM_LABELS, type AchievementClaimKind } from "@foliage/leaf";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const entry = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const harvestCli = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-mcp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository"); const garden = join(dir, "garden");
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  await git(["config", "user.name", "MCP transport regression"]);
  await git(["config", "user.email", "mcp-regression@foliage.invalid"]);
  const excerpt = (await readFile(fileURLToPath(import.meta.url), "utf8")).slice(0, 4000); // bounded real source excerpt
  await writeFile(join(repo, "transport-input.txt"), excerpt);
  await git(["add", "transport-input.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "chore: observe local transport regression source"]);
  const revision = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const title = (await git(["show", "-s", "--format=%s", revision])).stdout.trim();
  await execute(process.execPath, [launcher, "grow", "--repo", repo, "--subject", "MCP transport regression", "--identity", "mcp-regression@foliage.invalid", "--garden", garden], { timeout: 15_000 });
  const into = join(garden, "leaf.json"); const out = join(garden, "harvest.json");
  const leafBytes = await readFile(into, "utf8"); const leaf = JSON.parse(leafBytes);
  const batch = { format: "foliage-observations", version: 1, subject: { leafId: leaf.id, name: leaf.subject },
    source: { provider: "local-git-export", tenantId: null, accountId: "mcp-regression" },
    completion: "complete", deletedRecordIds: [] as string[],
    observations: [{ recordId: revision, revision, title, excerpt, observedAt: new Date().toISOString() }] };
  return { dir, garden, into, out, leafBytes, batch };
}

async function connect(f: Awaited<ReturnType<typeof fixture>>, useLauncher = false, presentationEnabled = false, achievementsEnabled = false, searchEnabled = false, brainEnabled = false) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: useLauncher ? [launcher, "mcp", "--garden", f.garden, ...(achievementsEnabled ? ["--allow-achievements"] : []), ...(searchEnabled ? ["--allow-search"] : []), ...(brainEnabled ? ["--allow-brain"] : [])] : [entry, "--into", f.into, "--out", f.out, ...(presentationEnabled ? ["--allow-presentation"] : []), ...(achievementsEnabled ? ["--allow-achievements"] : []), ...(searchEnabled ? ["--allow-search"] : []), ...(brainEnabled ? ["--allow-brain"] : [])],
    cwd: tmpdir(), stderr: "pipe", env: { FOLIAGE_GARDEN: join(f.dir, "ambient"), FOLIAGE_LEAF: join(f.dir, "ambient-leaf") } });
  let errors = "";
  transport.stderr?.on("data", chunk => { errors += String(chunk); });
  const client = new Client({ name: "foliage-protocol-regression", version: "1.0.0" });
  client.onerror = () => {};
  try { await client.connect(transport); }
  catch (error) { await transport.close(); throw new Error(`${String(error)} ${errors}`); }
  return { client, transport };
}

test("real SDK client discovers only target context/submission and reuses existing review decisions", { timeout: 30_000 }, async t => {
  const f = await fixture(t); const { client } = await connect(f, true);
  try {
    const list = await client.listTools();
    assert.deepEqual(list.tools.map(tool => tool.name).sort(), ["foliage_import_context", "foliage_import_portfolio", "foliage_submit_observations"]);
    const context = await client.callTool({ name: "foliage_import_context", arguments: {} });
    assert.deepEqual((context.structuredContent as Record<string, unknown>)["subject"], f.batch.subject);
    assert.ok(!JSON.stringify(context).includes(f.garden));
    assert.ok(!JSON.stringify(context).includes(f.batch.observations[0]!.excerpt));
    const first = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: f.batch } });
    assert.ok(!first.isError, JSON.stringify(first));
    const ids = (first.structuredContent as Record<string, unknown>)["persisted"] as string[];
    assert.equal(ids.length, 1);
    const saved = JSON.parse(await readFile(f.out, "utf8"));
    const candidate = saved.candidates.find((c: { id: string }) => c.id === ids[0]);
    assert.deepEqual(candidate.review, { state: "candidate" });
    assert.equal(candidate.evidence[0].excerpt, f.batch.observations[0]!.excerpt);
    assert.equal(await readFile(f.into, "utf8"), f.leafBytes);
    await execute(process.execPath, [harvestCli, "approve", ids[0]!, "--by", "MCP transport regression", "--doc", f.out]);
    const decided = await readFile(f.out, "utf8");
    const repeat = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: f.batch } });
    assert.ok(!repeat.isError, JSON.stringify(repeat));
    assert.deepEqual((repeat.structuredContent as Record<string, unknown>)["unchanged"], ids);
    assert.equal(await readFile(f.out, "utf8"), decided);
    assert.equal(await readFile(f.into, "utf8"), f.leafBytes);
    assert.equal(list.tools.find(tool => tool.name === "foliage_submit_observations")?.annotations?.readOnlyHint, false);
  } finally { await client.close(); }
});

test("private search is opt-in, reads the bound garden, and refuses changed harvest identity", { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const beforeLeaf = await readFile(f.into, "utf8");
  const beforeHarvest = await readFile(f.out, "utf8");
  const ordinary = await connect(f, true);
  try {
    assert.ok(!(await ordinary.client.listTools()).tools.some(tool => tool.name === "foliage_search"));
    await assert.rejects(ordinary.client.callTool({ name: "foliage_search", arguments: { query: "transport" } }), /Tool foliage_search not found/);
  } finally { await ordinary.client.close(); }
  const { client } = await connect(f, true, false, false, true);
  try {
    const tool = (await client.listTools()).tools.find(item => item.name === "foliage_search");
    assert.equal(tool?.annotations?.readOnlyHint, true);
    const found = await client.callTool({ name: "foliage_search", arguments: { query: "transport", limit: 3 } });
    assert.ok(!found.isError, JSON.stringify(found));
    const result = found.structuredContent as { hits: { kind: string; citation: string; snippet: string; evidence?: { ref: string }[] }[] };
    assert.ok(result.hits.some(hit => hit.kind.includes("draft") && hit.citation.startsWith("harvest:")));
    assert.ok(result.hits.every(hit => hit.snippet.length <= 242));
    assert.ok(result.hits.some(hit => hit.evidence?.length));
    assert.ok(!JSON.stringify(found).includes('"score"'));
    assert.ok(!JSON.stringify(found).includes(f.garden));
    assert.equal(await readFile(f.into, "utf8"), beforeLeaf);
    assert.equal(await readFile(f.out, "utf8"), beforeHarvest);
    for (const changed of [
      { ...JSON.parse(beforeHarvest), subject: "Different subject" },
      { ...JSON.parse(beforeHarvest), subject: "Different subject", candidates: [] },
    ]) {
      await writeFile(f.out, JSON.stringify(changed));
      const refused = await client.callTool({ name: "foliage_search", arguments: { query: "transport" } });
      assert.equal(refused.isError, true, "even an empty wrong-subject harvest is refused");
      assert.ok(!JSON.stringify(refused).includes("transport-input.txt"));
    }
  } finally { await client.close(); }
  await writeFile(f.out, beforeHarvest);
  const cli = await execute(process.execPath, [launcher, "search", "transport", "--garden", f.garden], { timeout: 10_000 });
  const printed = JSON.parse(cli.stdout);
  assert.ok(printed.hits.length > 0);
  assert.equal(await readFile(f.into, "utf8"), beforeLeaf);
  assert.equal(await readFile(f.out, "utf8"), beforeHarvest);
});

test("MCP refuses destinations, unsupported acquisition, held locks and changed connection identity", { timeout: 30_000 }, async t => {
  const f = await fixture(t); const { client } = await connect(f);
  const original = await readFile(f.out, "utf8");
  try {
    const attempts = [
      { batch: f.batch, out: join(f.dir, "elsewhere.json") },
      { batch: { ...f.batch, completion: "partial" } },
      { batch: { ...f.batch, deletedRecordIds: [f.batch.observations[0]!.recordId] } },
      { batch: { ...f.batch, subject: { ...f.batch.subject, name: "Different adversarial subject" } } },
      { batch: { ...f.batch, observations: [{ ...f.batch.observations[0]!, title: "9 out of 10" }] } },
    ];
    for (const args of attempts) {
      const response = await client.callTool({ name: "foliage_submit_observations", arguments: args });
      assert.equal(response.isError, true, JSON.stringify(response));
      assert.equal(await readFile(f.out, "utf8"), original);
    }
    await assert.rejects(client.callTool({ name: "publish", arguments: { id: "anything" } }), /Tool publish not found/);
    // Adversarial payload: under the framing cap, over the distinct serialized batch cap.
    const oversized = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: {
      ...f.batch, observations: [{ ...f.batch.observations[0]!, excerpt: "x".repeat(1024 * 1024) }],
    } } });
    assert.equal(oversized.isError, true);
    assert.match(JSON.stringify(oversized.content), /Observation input exceeds the byte limit/);
    await withDocumentLocks([f.out], async () => {
      const busy = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: f.batch } });
      assert.equal(busy.isError, true);
      assert.match(JSON.stringify(busy), /documents are busy/);
      assert.ok(!JSON.stringify(busy).includes(f.garden));
    });
    const renamed = { ...JSON.parse(f.leafBytes), subject: "Changed by the local owner" };
    await writeFile(f.into, JSON.stringify(renamed));
    assert.equal((await client.callTool({ name: "foliage_import_context", arguments: {} })).isError, true);
    assert.equal((await client.callTool({ name: "foliage_submit_observations", arguments: { batch: f.batch } })).isError, true);
    const retarget = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: { ...f.batch, subject: { ...f.batch.subject, name: renamed.subject } } } });
    assert.equal(retarget.isError, true);
    assert.equal(await readFile(f.out, "utf8"), original);
    // A fresh harvest cannot independently rescue a missing connection-identity guard.
    await rm(f.out);
    const freshRetarget = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: { ...f.batch, subject: { ...f.batch.subject, name: renamed.subject } } } });
    assert.equal(freshRetarget.isError, true);
    await assert.rejects(readFile(f.out), { code: "ENOENT" });
    await writeFile(f.out, original);
    await rm(f.into);
    for (const request of [{ name: "foliage_import_context", arguments: {} }, { name: "foliage_submit_observations", arguments: { batch: f.batch } }]) {
      const missing = await client.callTool(request);
      assert.equal(missing.isError, true);
      assert.match(JSON.stringify(missing), /Local document access or cleanup failed/);
      assert.ok(!JSON.stringify(missing).includes(f.garden));
    }
    assert.equal(await readFile(f.out, "utf8"), original);
  } finally { await client.close(); }
});

test("2025-era stdio client negotiates, lists tools and gets context without a modern envelope", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [entry, "--into", f.into, "--out", f.out], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const closed = new Promise(resolve => child.once("close", resolve));
  const responses = lines[Symbol.asyncIterator]();
  child.stderr.on("data", () => {});
  const request = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n");
  try {
    request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-wire-regression", version: "1" } } });
    const init = JSON.parse((await responses.next()).value!);
    assert.equal(init.result.protocolVersion, "2025-11-25");
    request({ jsonrpc: "2.0", method: "notifications/initialized" });
    request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(JSON.parse((await responses.next()).value!).result.tools.length, 3);
    request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "foliage_import_context", arguments: {} } });
    assert.deepEqual(JSON.parse((await responses.next()).value!).result.structuredContent.subject, f.batch.subject);
    child.stdin.end();
    await closed;
  } finally { lines.close(); child.stdin.end(); child.kill(); }
});

test("startup requires explicit targets and framing overflow closes without creating observations", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  for (const args of [[], ["--into", f.into], ["--into", f.into, "--into", f.into, "--out", f.out], ["--into", f.into, "--out", f.into]]) {
    await assert.rejects(execute(process.execPath, [entry, ...args], { timeout: 5000 }));
  }
  await assert.rejects(execute(process.execPath, [launcher, "mcp"], { timeout: 5000, env: { ...process.env, FOLIAGE_GARDEN: f.garden } }));
  const before = await readFile(f.out, "utf8");
  const child = spawn(process.execPath, [entry, "--into", f.into, "--out", f.out], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.once("close", resolve));
  child.stdout.on("data", () => {}); child.stderr.on("data", () => {}); child.stdin.on("error", () => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Keep stdin open: EOF must not be the reason the oversized frame stops the server.
    child.stdin.write("x".repeat(2 * 1024 * 1024 + 1));
    await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Oversized frame did not close the server while stdin remained open")), 5000); })]);
  } finally { clearTimeout(timeout); child.stdin.destroy(); child.kill(); }
  assert.equal(await readFile(f.out, "utf8"), before);
});

test("opt-in agent styling persists through the same revision gate without editing evidence", { timeout: 30_000 }, async t => {
  const f = await fixture(t); const { client } = await connect(f, false, true);
  try {
    const context = await client.callTool({ name: "foliage_presentation_context", arguments: {} });
    const revision = (context.structuredContent as Record<string, unknown>)["documentRevision"];
    const args = { documentRevision: revision, typography: "clean", spacing: "compact", palette: "quiet", layout: "linear", hero: "stacked", media: "immersive" };
    assert.ok(!(await client.callTool({ name: "foliage_customize_presentation", arguments: args })).isError);
    const after = JSON.parse(await readFile(f.into, "utf8"));
    assert.deepEqual(after.presentation.style, { typography: "clean", spacing: "compact", palette: "quiet", layout: "linear", hero: "stacked", media: "immersive" });
    assert.equal(after.presentation.history[0].actor, "agent");
    assert.deepEqual(after.presentation.history[0].before, {});
    assert.deepEqual(after.presentation.history[0].after, { typography: "clean", spacing: "compact", palette: "quiet", layout: "linear", hero: "stacked", media: "immersive" });
    assert.deepEqual(after.leaflets, JSON.parse(f.leafBytes).leaflets);
    assert.ok((await client.callTool({ name: "foliage_customize_presentation", arguments: args })).isError);
  } finally { await client.close(); }
});


test("owner-enabled achievement tools update one canonical portfolio and resume without replacing evidence", {timeout:30_000}, async t=>{
  const f=await fixture(t); const {client}=await connect(f,true,false,true);
  const {loadLeafDocument}=await import('./leafDocument.ts');
  const {renderLiveResume,resumeDraft}=await import('./portfolioPresentation.ts');
  const call=async(name:string,args:Record<string,unknown>={})=>{
    const value=await client.callTool({name,arguments:args});assert.ok(!value.isError,JSON.stringify(value));return value.structuredContent as Record<string,unknown>;
  };
  try {
    const tools=(await client.listTools()).tools.map(t=>t.name);
    assert.ok(tools.includes('foliage_save_statement'));assert.ok(!tools.includes('foliage_customize_presentation'));
    const before=JSON.parse(f.leafBytes);
    const context=await call('foliage_achievement_context');
    assert.deepEqual(context['evidence'],[]);
    const selectedId=(context['leaflets'] as {id:string}[])[0]!.id;
    const evidenceContext=await call('foliage_achievement_context',{leaflets:[selectedId]});
    const evidence=(evidenceContext['evidence'] as {title:string;citations:unknown[]}[])[0]!;
    const created=await call('foliage_save_achievement',{documentRevision:context['documentRevision'],title:'Local authoring transport protocol'});
    assert.equal(created['published'],false);
    const achievement=new URL(String(created['href']),'http://local.invalid').searchParams.get('achievement')!;
    const statement={documentRevision:created['documentRevision'],achievement,kind:'summary',text:evidence.title,citations:evidence.citations};
    const saved=await call('foliage_save_statement',statement);
    assert.equal(saved['resume'],'/leaf/resume');
    const after=await loadLeafDocument({FOLIAGE_LEAF:f.into});assert.ok(after.ok);
    assert.deepEqual(after.leaf.leaflets,before.leaflets);
    assert.equal(after.leaf.achievements?.length,1);assert.equal(after.leaf.achievements?.[0]?.claims.length,1);
    assert.ok(renderLiveResume(after).includes(evidence.title));assert.ok(resumeDraft(after.leaf).includes('Local authoring transport protocol'));
    const bytes=await readFile(f.into,'utf8');
    assert.equal((await client.callTool({name:'foliage_save_statement',arguments:statement})).isError,true,'stale repeat cannot duplicate a statement');
    assert.equal((await client.callTool({name:'foliage_save_statement',arguments:{...statement,documentRevision:saved['documentRevision'],citations:[{leaflet:selectedId,provenance:{source:'missing',ref:'missing',observedAt:new Date().toISOString()}}]}})).isError,true);
    assert.equal((await client.callTool({name:'foliage_save_achievement',arguments:{documentRevision:saved['documentRevision'],title:'Foreign field protocol',into:'/tmp/elsewhere'}})).isError,true);
    assert.equal(await readFile(f.into,'utf8'),bytes);
    const fresh=await call('foliage_achievement_context',{achievement,leaflets:[selectedId]});
    const claim=(fresh['selectedAchievement'] as {claims:{id:string}[]}).claims[0]!.id;
    await call('foliage_save_statement',{...statement,documentRevision:fresh['documentRevision'],claim,text:'Protocol account: retained local Git evidence is attached to this statement.'});
    const updated=await loadLeafDocument({FOLIAGE_LEAF:f.into});assert.ok(updated.ok);
    assert.equal(updated.leaf.achievements![0]!.claims.length,1,'revise stable statement rather than duplicate it');
    assert.match(renderLiveResume(updated),/retained local Git evidence is attached/);
    assert.deepEqual(updated.leaf.leaflets,before.leaflets);
    assert.equal(updated.leaf.headline,before.headline,'agent authoring cannot change the subject introduction');
    const journeyKinds: AchievementClaimKind[]=['intent','decision','challenge','pivot','discovery','learning'];
    for (const kind of journeyKinds) {
      const current=await call('foliage_achievement_context',{achievement});
      await call('foliage_save_statement',{...statement,documentRevision:current['documentRevision'],kind,text:`${kind}: transport protocol preserves the selected source reference.`});
    }
    const journey=await loadLeafDocument({FOLIAGE_LEAF:f.into});assert.ok(journey.ok);
    assert.equal(journey.leaf.achievements![0]!.claims.length,7);
    assert.deepEqual(journey.leaf.leaflets,before.leaflets,'authoring never changes evidence or its proof tier');
    const {renderAchievement}=await import('./portfolioPresentation.ts');
    const achievementHtml=renderAchievement(journey,achievement);assert.ok(achievementHtml);
    for (const kind of journeyKinds) {
      const label=ACHIEVEMENT_CLAIM_LABELS[kind];
      assert.ok(resumeDraft(journey.leaf).includes(label));
      // HTML escapes the ampersand in the roadblock label.
      const htmlLabel=label.replaceAll('&','&amp;');
      assert.ok(renderLiveResume(journey).includes(htmlLabel));
      assert.ok(achievementHtml.includes(htmlLabel));
    }
  } finally {await client.close();}
});

test("portfolio MCP previews exact owner-selected text and requires its digest before private import", {timeout:30_000}, async t => {
  const f = await fixture(t); const {client} = await connect(f);
  try {
    const input = {title:"Transport source", source:"assistantMcp.test.ts", text:f.batch.observations[0]!.excerpt};
    // Use one bounded excerpt of this actual regression source, not invented work.
    input.text = input.text.slice(0,3000);
    const before = await readFile(f.out,"utf8");
    const preview = await client.callTool({name:"foliage_import_portfolio", arguments:input});
    assert.ok(!preview.isError,JSON.stringify(preview));
    assert.equal(await readFile(f.out,"utf8"),before);
    const digest = (preview.structuredContent as Record<string,unknown>)['digest'];
    const changed = await client.callTool({name:"foliage_import_portfolio",arguments:{...input,text:input.text+"\n",confirmDigest:digest}});
    assert.equal(changed.isError,true);
    assert.equal(await readFile(f.out,"utf8"),before);
    const imported = await client.callTool({name:"foliage_import_portfolio",arguments:{...input,confirmDigest:digest}});
    assert.ok(!imported.isError,JSON.stringify(imported));
    assert.equal((imported.structuredContent as Record<string,unknown>)['imported'],1);
    const after = await readFile(f.out,"utf8");
    const document = JSON.parse(after);
    const candidate = document.candidates.find((c:{evidence:{source:string}[]})=>c.evidence[0]?.source==='integration:portfolio-import');
    assert.deepEqual(candidate.review,{state:'candidate'});
    const repeated = await client.callTool({name:"foliage_import_portfolio",arguments:{...input,confirmDigest:digest}});
    assert.ok(!repeated.isError,JSON.stringify(repeated));
    assert.equal((repeated.structuredContent as Record<string,unknown>)['unchanged'],1);
    assert.equal(await readFile(f.out,"utf8"),after);
    assert.equal(await readFile(f.into,"utf8"),f.leafBytes);
  } finally {await client.close();}
});

test('private brain opt-in searches actual retained Git work, pins revisions and cannot retarget', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const { client } = await connect(f, true, false, false, false, true);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['foliage_brain_context', 'foliage_brain_search', 'foliage_brain_read', 'foliage_brain_related']) assert.ok(names.includes(name));
    assert.ok(!names.includes('foliage_save_statement'));
    const context = await client.callTool({ name: 'foliage_brain_context', arguments: {} });
    assert.ok(!context.isError, JSON.stringify(context));
    const revision = (context.structuredContent as Record<string, unknown>)['revision'] as string;
    const search = await client.callTool({ name: 'foliage_brain_search', arguments: { revision, query: 'transport regression' } });
    assert.ok(!search.isError, JSON.stringify(search));
    const results = (search.structuredContent as Record<string, unknown>)['results'] as { id: string; text: string }[];
    assert.ok(results.length > 0);
    const read = await client.callTool({ name: 'foliage_brain_read', arguments: { revision, id: results[0]!.id } });
    assert.ok(!read.isError, JSON.stringify(read));
    assert.equal(((read.structuredContent as Record<string, unknown>)['record'] as { text: string }).text, results[0]!.text);
    const related = await client.callTool({ name: 'foliage_brain_related', arguments: { revision, id: results[0]!.id } });
    assert.ok(!related.isError, JSON.stringify(related));
    assert.equal((related.structuredContent as { source: string }).source, results[0]!.id);
    assert.equal((await client.callTool({ name: 'foliage_brain_related', arguments: { revision, id: results[0]!.id, into: f.out } })).isError, true);
    assert.equal(await readFile(f.into, 'utf8'), f.leafBytes);
    const noMatches = await client.callTool({ name: 'foliage_brain_search', arguments: { revision, query: 'phrase-not-in-retained-material-2981' } });
    assert.deepEqual((noMatches.structuredContent as Record<string, unknown>)['results'], []);
    for (const args of [{ revision, query: 'transport', into: f.out }, { revision, query: 'transport', audience: 'public' }, { revision, query: 'transport', limit: 21 }]) {
      assert.equal((await client.callTool({ name: 'foliage_brain_search', arguments: args })).isError, true);
    }
    assert.equal((await client.callTool({ name: 'foliage_brain_read', arguments: { revision, id: 'f'.repeat(64) } })).isError, true);
    // Same identity, new bytes: earlier excerpts remain addressable only with a fresh revision.
    await writeFile(f.into, f.leafBytes + '\n');
    const stale = await client.callTool({ name: 'foliage_brain_search', arguments: { revision, query: 'transport' } });
    assert.equal((stale.structuredContent as Record<string, unknown>)['code'], 'stale');
    const fresh = await client.callTool({ name: 'foliage_brain_context', arguments: {} });
    assert.notEqual((fresh.structuredContent as Record<string, unknown>)['revision'], revision);
    await writeFile(f.into, JSON.stringify({ ...JSON.parse(f.leafBytes), subject: 'Another protocol test subject' }));
    assert.equal((await client.callTool({ name: 'foliage_brain_context', arguments: {} })).isError, true);
  } finally { await client.close(); }
});
