/** Real Git records, native HTTP choices, intake refresh and both promotion writers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { loadLeafDocument } from "./leafDocument.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function formFrom(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const name of ["leafId", "subject", "documentRevision"]) {
    const tag = new RegExp(`<input\\b(?=[^>]*\\bname="${name}")[^>]*>`).exec(html)?.[0];
    const value = tag && /value="([^"]*)"/.exec(tag)?.[1]; assert.notEqual(value, undefined);
    form.set(name, decode(value!));
  }
  for (let index = 0; index < 12; index++) form.set(`featured${index}`, "");
  return form;
}

test("owner order survives real collection and promotion while HTTP refusals preserve the document", { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-curation-http-")), repo = join(directory, "repo");
  await mkdir(repo);
  const identity = "curation-protocol@foliage.invalid", subject = "Curation HTTP protocol";
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOST: "127.0.0.1", PORT: "0",
    FOLIAGE_LEAF: join(directory, "leaf.json"), FOLIAGE_POLICY: join(directory, "absent-policy.json"), FOLIAGE_HARVEST: join(directory, "harvest.json"),
    FOLIAGE_WORKFLOW_DIR: join(directory, "workflow"), FOLIAGE_HOSTED_STATUS: join(directory, "absent-hosting.json"),
    FOLIAGE_LOCAL_MODEL: "", FOLIAGE_COMPANION_KEY: "", FOLIAGE_COMPANION_ORIGIN: "" };
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" }).trim();
  const cli = (...args: string[]) => execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  const commit = async (title: string, email = identity) => {
    await writeFile(join(repo, "protocol.txt"), `${title}\n`); git("add", "protocol.txt");
    git("-c", `user.name=${subject}`, "-c", `user.email=${email}`, "commit", "--quiet", "-m", title);
  };
  const intake = (extra: string[] = [], email = identity) => cli("apps/leaf/intake.mjs", "--repo", repo, "--identity", email, "--subject", subject, "--out", env.FOLIAGE_LEAF, ...extra);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    git("init", "--quiet", "--initial-branch=main");
    for (const title of ["feat: create the curation transport", "feat: retain the selection transport", "fix: preserve a protocol revision", "fix: inspect the transport result"]) await commit(title);
    await commit("docs: separately attributed protocol revision", "another-actor@foliage.invalid");
    intake();
    const initial = await loadLeafDocument(env); assert.ok(initial.ok);
    const own = initial.leaf.leaflets.filter(record => record.tier !== "excluded");
    const excluded = initial.leaf.leaflets.find(record => record.tier === "excluded"); assert.ok(excluded); assert.equal(own.length, 4);
    const chosen = [own[2]!.id, own[0]!.id];
    child = spawn(process.execPath, ["apps/leaf/server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "", errors = "";
      const timer = setTimeout(() => reject(new Error("Curation server startup timed out")), 10_000);
      child!.stderr!.on("data", bytes => { errors += String(bytes); });
      child!.stdout!.on("data", bytes => { output += String(bytes); const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
      child!.once("exit", () => { clearTimeout(timer); reject(new Error(`Curation server exited before readiness: ${errors}`)); });
    });
    const get = (path: string) => fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    const post = (form: URLSearchParams, from = origin) => fetch(origin + "/leaf/curate", { method: "POST", headers: { origin: from }, body: form, redirect: "manual", signal: AbortSignal.timeout(5000) });
    const baseline = await readFile(env.FOLIAGE_LEAF, "utf8");
    const candidate = await get(`/leaf/curate?leaflet=${encodeURIComponent(chosen[0]!)}`); assert.equal(candidate.status, 200);
    const candidateHtml = await candidate.text(); assert.ok(candidateHtml.includes(`value="${chosen[0]}" selected`));
    assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), baseline, "preparing a candidate in GET grants no write");
    const form = formFrom(candidateHtml); form.set("featured0", chosen[0]!); form.set("featured1", chosen[1]!);
    assert.equal(form.size, 15);
    const refuse = async (change: (draft: URLSearchParams) => void, from = origin, status = 409) => {
      const draft = new URLSearchParams(form); change(draft);
      assert.equal((await post(draft, from)).status, status);
      assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), baseline);
    };
    await refuse(() => {}, "https://foreign.invalid", 403);
    for (const name of ["leafId", "subject", "documentRevision", "featured11"]) await refuse(draft => draft.delete(name));
    await refuse(draft => draft.append("featured0", chosen[0]!));
    await refuse(draft => draft.set("unexpected", "value"));
    await refuse(draft => draft.set("featured1", chosen[0]!));
    await refuse(draft => draft.set("featured0", "missing-record"));
    await refuse(draft => draft.set("featured0", excluded.id));
    await refuse(draft => draft.set("leafId", "another-leaf"));
    await refuse(draft => draft.set("subject", "another subject"));
    await refuse(draft => draft.set("documentRevision", `sha256:${"0".repeat(64)}`));
    await refuse(draft => draft.set("featured0", ""));
    const response = await post(form); assert.equal(response.status, 303); assert.equal(response.headers.get("location"), "/leaf#leaf-highlights");
    const saved = await loadLeafDocument(env); assert.ok(saved.ok);
    assert.deepEqual(saved.leaf.curation?.featured, chosen); assert.deepEqual(saved.leaf.leaflets, initial.leaf.leaflets);
    const savedBytes = await readFile(env.FOLIAGE_LEAF, "utf8");
    assert.equal((await post(form)).status, 409); assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), savedBytes);
    const update = await get(`/leaf/portfolio-state?revision=${encodeURIComponent(initial.source.documentDigest)}`); assert.equal(update.status, 200);
    const state = await update.json() as { revision: string; html: string };
    assert.equal(state.revision, saved.source.documentDigest); assert.ok(state.html.includes('id="leaf-highlights"'));
    const renderedIds = [...state.html.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]);
    const sourcePage = await get("/leaf?records=source");
    const sourceIds = [...(await sourcePage.text()).matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(renderedIds.length + sourceIds.length, own.length);
    assert.equal(new Set([...renderedIds, ...sourceIds]).size, own.length, "work and raw source records retain every item once");
    assert.ok(state.html.indexOf(`data-record-id="${chosen[0]}"`) < state.html.indexOf(`data-record-id="${chosen[1]}"`));
    for (const id of chosen) assert.equal((await get(`/leaflet/${encodeURIComponent(id)}`)).status, 404, "curation does not share private work");

    await commit("feat: append a collected protocol revision"); intake(["--force"]);
    const refreshed = await loadLeafDocument(env); assert.ok(refreshed.ok); assert.deepEqual(refreshed.leaf.curation?.featured, chosen);
    assert.equal(refreshed.leaf.leaflets.length, initial.leaf.leaflets.length + 1);
    cli("apps/leaf/harvest.mjs", "propose", "--repo", repo, "--identity", identity, "--out", env.FOLIAGE_HARVEST, "--into", env.FOLIAGE_LEAF);
    const harvest = JSON.parse(await readFile(env.FOLIAGE_HARVEST, "utf8")) as { candidates: { id: string }[] };
    assert.ok(harvest.candidates.length >= 2);
    cli("apps/leaf/harvest.mjs", "approve", harvest.candidates[0]!.id, "--by", subject, "--doc", env.FOLIAGE_HARVEST);
    cli("apps/leaf/harvest.mjs", "promote", "--doc", env.FOLIAGE_HARVEST, "--into", env.FOLIAGE_LEAF, "--force");
    const promoted = await loadLeafDocument(env); assert.ok(promoted.ok); assert.deepEqual(promoted.leaf.curation?.featured, chosen);
    assert.ok(promoted.leaf.leaflets.some(record => record.id === harvest.candidates[0]!.id));
    cli("apps/leaf/harvest.mjs", "approve", harvest.candidates[1]!.id, "--by", subject, "--doc", env.FOLIAGE_HARVEST);
    const promotedHttp = await fetch(origin + "/promote", { method: "POST", headers: { origin }, redirect: "manual", signal: AbortSignal.timeout(5000) });
    assert.equal(promotedHttp.status, 303);
    const afterHttp = await loadLeafDocument(env); assert.ok(afterHttp.ok); assert.deepEqual(afterHttp.leaf.curation?.featured, chosen);
    assert.ok(afterHttp.leaf.leaflets.some(record => record.id === harvest.candidates[1]!.id));

    // A changed declared identity makes previous Git selections unavailable without erasing them.
    intake(["--force"], "another-actor@foliage.invalid");
    const changedIdentity = await loadLeafDocument(env); assert.ok(changedIdentity.ok); assert.deepEqual(changedIdentity.leaf.curation?.featured, chosen);
    const unavailable = await (await get("/leaf/curate")).text(); assert.match(unavailable, /saved choice is now missing or excluded/);
    const clear = formFrom(unavailable); const beforeClear = changedIdentity.leaf.leaflets;
    assert.equal((await post(clear)).status, 303);
    const cleared = await loadLeafDocument(env); assert.ok(cleared.ok); assert.deepEqual(cleared.leaf.curation?.featured, []); assert.deepEqual(cleared.leaf.leaflets, beforeClear);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    await rm(directory, { recursive: true, force: true });
  }
});
