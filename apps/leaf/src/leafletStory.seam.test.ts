/** Real temporary Git intake and HTTP writes. Submitted story prose is explicitly protocol input. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { loadLeafDocument } from "./leafDocument.ts";
import { revisionDigest } from "./leafletRevision.ts";
import { readStoryElement } from "./leafletStory.ts";
import { renderWorkWorkspace } from "./workWorkspace.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const decode = (value: string): string => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function hidden(html: string, name: string): string {
  const input = new RegExp(`<input\\b(?=[^>]*\\bname="${name}")[^>]*>`).exec(html)?.[0];
  const value = input && /\bvalue="([^"]*)"/.exec(input)?.[1];
  assert.notEqual(value, undefined, `the real form must carry ${name}`);
  return decode(value!);
}
function evidenceChoice(html: string, name: string): string {
  const select = new RegExp(`<select\\b(?=[^>]*\\bname="${name}")[^>]*>([\\s\\S]*?)<\\/select>`).exec(html)?.[1];
  const value = select && /<option\b[^>]*\bvalue="(\d+)"/.exec(select)?.[1];
  assert.notEqual(value, undefined, `the real ${name} selector must offer recorded evidence`);
  return value!;
}

test("the owner can save an evidence-bound story privately; stale and invalid submissions change nothing", { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-story-http-")), repo = join(directory, "repository");
  await mkdir(repo);
  const identity = "story-protocol@foliage.invalid";
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOST: "127.0.0.1", PORT: "0",
    FOLIAGE_LEAF: join(directory, "leaf.json"), FOLIAGE_POLICY: join(directory, "absent-policy.json"), FOLIAGE_HARVEST: join(directory, "absent-harvest.json"),
    FOLIAGE_WORKFLOW_DIR: join(directory, "workflow"), FOLIAGE_HOSTED_STATUS: join(directory, "absent-hosted-status.json"),
    FOLIAGE_LOCAL_MODEL: "", FOLIAGE_COMPANION_KEY: "", FOLIAGE_COMPANION_ORIGIN: "" };
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" }).trim();
  const commit = async (content: string, title: string, email = identity) => {
    await writeFile(join(repo, "transport.txt"), content);
    git("add", "transport.txt");
    git("-c", "user.name=Story HTTP protocol", "-c", `user.email=${email}`, "commit", "--quiet", "-m", title);
    return git("rev-parse", "HEAD");
  };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    git("init", "--quiet", "--initial-branch=main");
    const older = await commit("A real file for the HTTP story seam.\n", "Create the story transport harness");
    const foreign = await commit("A real file with a separately attributed revision.\n", "Record another actor's transport revision", "other-actor@foliage.invalid");
    const targetRef = await commit("A real file with the selected transport revision.\n", "Retain selected evidence for a story submission");
    execFileSync(process.execPath, ["apps/leaf/intake.mjs", "--repo", repo, "--identity", identity, "--subject", "Story HTTP protocol", "--out", env.FOLIAGE_LEAF], { cwd: root, env, stdio: "pipe" });
    const intake = await loadLeafDocument(env); assert.ok(intake.ok);
    const target = intake.leaf.leaflets.find(record => record.provenance?.ref === targetRef); assert.ok(target);
    const previouslyShared = intake.leaf.leaflets.find(record => record.provenance?.ref === older); assert.ok(previouslyShared);
    const excluded = intake.leaf.leaflets.find(record => record.provenance?.ref === foreign); assert.ok(excluded);
    assert.equal(target.tier, "pending"); assert.equal(excluded.tier, "excluded");
    execFileSync(process.execPath, ["apps/leaf/share.mjs", "share", previouslyShared.id, "--as", "public", "--leaf", env.FOLIAGE_LEAF], { cwd: root, env, stdio: "pipe" });

    child = spawn(process.execPath, ["apps/leaf/server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "", errors = "";
      const timer = setTimeout(() => reject(new Error("Story server startup timed out")), 10_000);
      child!.stderr!.on("data", bytes => { errors += String(bytes); });
      child!.stdout!.on("data", bytes => { output += String(bytes); const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
      child!.once("exit", () => { clearTimeout(timer); reject(new Error(`Story server exited before readiness: ${errors}`)); });
    });
    const get = (path: string) => fetch(origin + path);
    const post = (form: URLSearchParams, from = origin) => fetch(origin + "/leaf/story", { method: "POST", headers: { origin: from }, body: form, redirect: "manual" });
    const workBefore = await (await get('/leaf/photosynthesis')).text();
    assert.ok(workBefore.includes(target.title), 'Work shows the actual retained source record before any account exists');
    assert.ok(workBefore.includes(`href="/leaf/story?leaflet=${encodeURIComponent(target.id)}">Tell story</a>`), 'Work opens the existing evidence-bound story form');
    assert.ok(!workBefore.includes(excluded.title), 'an unattributed source is not shown as the owner\'s work');
    assert.ok(!workBefore.includes(`href="/leaf/story?leaflet=${encodeURIComponent(previouslyShared.id)}"`), 'a public record has no private-story action');
    const preview = await get(`/leaf/story?leaflet=${encodeURIComponent(target.id)}`); assert.equal(preview.status, 200);
    const html = await preview.text();
    assert.match(html, /<p id="story-reviewer-help">Shown with the story on the public page if you share this record\.<\/p>/, "the form says the recorder's name can become public");
    assert.match(html, /<input\b(?=[^>]*\bid="story-reviewer")(?=[^>]*\baria-describedby="story-reviewer-help")[^>]*>/);
    const sourceSubject = git("show", "-s", "--format=%s", targetRef);
    const entries = (["problem", "contribution", "decisions", "outcome"] as const).map(section => [section, `Form protocol input (${section}): ${sourceSubject}. No career achievement is asserted by this test.`] as const);
    const form = new URLSearchParams({ leaflet: hidden(html, "leaflet"), revision: hidden(html, "revision"), documentRevision: hidden(html, "documentRevision"), reviewer: "Story HTTP protocol", subject: intake.leaf.subject });
    for (const [section, text] of entries) { form.set(section, text); form.set(`${section}Evidence`, evidenceChoice(html, `${section}Evidence`)); }
    const baseline = await readFile(env.FOLIAGE_LEAF, "utf8");
    const publicPath = `/leaflet/${encodeURIComponent(previouslyShared.id)}`;
    const publicBeforeResponse = await get(publicPath); assert.equal(publicBeforeResponse.status, 200);
    const publicBefore = await publicBeforeResponse.text(); assert.ok(publicBefore.includes(previouslyShared.title));
    assert.equal((await post(form, "https://foreign.invalid")).status, 403);
    const wrongSubject = new URLSearchParams(form); wrongSubject.set("subject", "A different subject");
    assert.equal((await post(wrongSubject)).status, 409);
    const noEvidence = new URLSearchParams(form); noEvidence.delete("problemEvidence");
    const missingResponse = await post(noEvidence); assert.equal(missingResponse.status, 409);
    assert.ok((await missingResponse.text()).includes(entries[0]![1]), "a refused save retains the person's submitted words");
    const unknownEvidence = new URLSearchParams(form); unknownEvidence.set("problemEvidence", "999999");
    assert.equal((await post(unknownEvidence)).status, 409);
    const stale = new URLSearchParams(form); stale.set("revision", `sha256:${"0".repeat(64)}`);
    assert.equal((await post(stale)).status, 409);
    const staleDocument = new URLSearchParams(form); staleDocument.set("documentRevision", `sha256:${"0".repeat(64)}`);
    assert.equal((await post(staleDocument)).status, 409);
    assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), baseline);

    const savedResponse = await post(form); assert.equal(savedResponse.status, 303);
    assert.equal(savedResponse.headers.get("location"), `/my/leaflet/${encodeURIComponent(target.id)}`);
    const saved = await loadLeafDocument(env); assert.ok(saved.ok);
    const record = saved.leaf.leaflets.find(record => record.id === target.id); assert.ok(record);
    assert.equal(record.tier, "pending"); assert.equal(record.visibility ?? "private", "private");
    assert.deepEqual(record.provenance, target.provenance);
    assert.deepEqual(saved.leaf.leaflets.filter(record => record.id !== target.id), JSON.parse(baseline).leaflets.filter((record: { id: string }) => record.id !== target.id), "other Leaflets and their sharing choices remain unchanged");
    for (const element of target.body ?? []) assert.ok(record.body?.some(next => JSON.stringify(next) === JSON.stringify(element)));
    for (const [, text] of entries) assert.ok(record.body?.some(element => element.text?.includes(text) && element.text.includes(targetRef)));
    const savedBytes = await readFile(env.FOLIAGE_LEAF, "utf8");
    assert.equal((await post(form)).status, 409); assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), savedBytes);

    const reader = await (await get("/leaf")).text();
    const explorer = await (await get(`/leaf/explore?leaflet=${encodeURIComponent(target.id)}`)).text();
    const artifact = await (await get(`/my/leaflet/${encodeURIComponent(target.id)}`)).text();
    for (const [, text] of entries.slice(0, 2)) { assert.ok(reader.includes(text), "the private reader leads with saved personal context"); assert.ok(explorer.includes(text), "the 3D inspector includes saved personal context"); }
    for (const [, text] of entries) assert.ok(artifact.includes(text), "the artifact retains every submitted story section");
    const workAfter = await (await get('/leaf/photosynthesis')).text();
    assert.ok(workAfter.includes(entries.find(([section]) => section === 'outcome')![1]), 'Work leads with the saved owner account after a cited story is recorded');
    assert.ok(workAfter.includes(`href="/leaf/story?leaflet=${encodeURIComponent(target.id)}">Edit story</a>`));
    const missingReference = { ...saved, leaf: { ...saved.leaf, leaflets: saved.leaf.leaflets.map(item => {
      if (item.id !== target.id || item.tier !== 'pending') return item;
      const { provenance: _source, ...withoutSource } = item;
      return { ...withoutSource, body: (item.body ?? []).filter(element => readStoryElement(element) !== null) };
    }) } };
    const changedPreview = renderWorkWorkspace(missingReference,
      {ok:false,cause:'absent',detail:'No review queue',path:join(directory,'absent-harvest.json')},
      {marks:new Map(),retry:new Set<string>(),paused:false});
    assert.match(changedPreview, /data-reference-state="changed">Reference changed<\/span>/);
    assert.ok(changedPreview.includes(entries.find(([section]) => section === 'outcome')![1]), 'a changed reference does not erase the person\'s words');
    for (const page of [reader, artifact]) {
      assert.ok(!page.includes("Supporting evidence: {"), "story prose does not contain its serialized receipt");
      assert.ok(!page.includes("&quot;source&quot;:&quot;git&quot;"), "the supporting reference has readable fields instead of JSON");
    }
    const publicAfter = await (await get(publicPath)).text(); assert.ok(publicAfter.includes(previouslyShared.title));
    for (const [, text] of entries) assert.ok(!publicAfter.includes(text), "saving private context does not offer it to public readers");
    assert.equal((await get(`/leaflet/${encodeURIComponent(target.id)}`)).status, 404);
    for (const forbidden of [excluded.id, previouslyShared.id]) {
      const refusal = await get(`/leaf/story?leaflet=${encodeURIComponent(forbidden)}`);
      assert.equal(refusal.status, 409); assert.match(await refusal.text(), /pending|private|attribution/i);
      const current = saved.leaf.leaflets.find(record => record.id === forbidden); assert.ok(current);
      const bypass = new URLSearchParams(form);
      bypass.set("leaflet", forbidden); bypass.set("revision", revisionDigest(current)); bypass.set("documentRevision", saved.source.documentDigest);
      assert.equal((await post(bypass)).status, 409, "posting directly cannot bypass the private/pending guard");
    }
    assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), savedBytes);

    // A real sharing operation races a form opened while the record was still editable.
    const latestForm = await (await get(`/leaf/story?leaflet=${encodeURIComponent(target.id)}`)).text();
    const interrupted = new URLSearchParams(form);
    interrupted.set("revision", hidden(latestForm, "revision"));
    interrupted.set("documentRevision", hidden(latestForm, "documentRevision"));
    interrupted.set("reviewer", 'Protocol writer <recovery> & "quotes"');
    for (const [section, text] of entries) interrupted.set(section, `${text} Recovery probe: </textarea><script>untrusted prose</script>.`);
    execFileSync(process.execPath, ["apps/leaf/share.mjs", "share", target.id, "--as", "public", "--leaf", env.FOLIAGE_LEAF], { cwd: root, env, stdio: "pipe" });
    const sharedStory = await (await get(`/leaflet/${encodeURIComponent(target.id)}`)).text();
    // The saved wall-clock instant, read through the page's formatter: en-GB writes September as "Sept".
    const [at] = (record.body ?? []).flatMap(element => readStoryElement(element)?.at ?? []); assert.ok(at);
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(at));
    assert.equal(sharedStory.split(`Recorded by <span data-verbatim="body-element">Story HTTP protocol</span> on <time class="fol-metric" datetime="${at}">${day}</time>.`).length - 1, entries.length,
      "the shared page names the recorder with a readable day, not a raw instant");
    assert.ok(!sharedStory.includes(`>${at}<`), "the recorded instant stays machine-readable only");
    const assertRecovery = async () => {
      const before = await readFile(env.FOLIAGE_LEAF, "utf8");
      const response = await post(interrupted); assert.equal(response.status, 409);
      const recovery = await response.text();
      for (const [section] of entries) assert.ok(decode(recovery).includes(interrupted.get(section)!), "a newly ineligible or missing target does not discard submitted words");
      assert.ok(decode(recovery).includes(interrupted.get("reviewer")!));
      assert.ok(decode(recovery).includes(interrupted.get("subject")!));
      assert.ok(!recovery.includes("<script>untrusted prose</script>"), "recovery renders submitted markup as text");
      assert.ok(!/<form\b/i.test(recovery), "recovery grants no form submission authority");
      assert.equal((recovery.match(/<textarea\b[^>]*\breadonly\b/gi) ?? []).length, 4);
      assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), before);
    };
    await assertRecovery();
    // The same recovery must work with no current target to read at all.
    const removed = JSON.parse(await readFile(env.FOLIAGE_LEAF, "utf8"));
    removed.leaflets = removed.leaflets.filter((record: { id: string }) => record.id !== target.id);
    await writeFile(env.FOLIAGE_LEAF, JSON.stringify(removed, null, 2) + "\n");
    await assertRecovery();
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    await rm(directory, { recursive: true, force: true });
  }
});
