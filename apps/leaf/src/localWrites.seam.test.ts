/** Real temporary git inputs and real CLIs. Harness decisions are not customer acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { reviewSubjectDigest } from "@foliage/photosynthesis";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const harvestCli = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const publishCli = fileURLToPath(new URL("../../canopy/publish.mjs", import.meta.url));
const policyCli = fileURLToPath(new URL("../policy.mjs", import.meta.url));
const intakeCli = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const serverCli = fileURLToPath(new URL("../server.mjs", import.meta.url));
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });
async function run(script: string, args: string[], input = "") {
  try {
    const pending = exec(process.execPath, [script, ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    pending.child.stdin?.end(input);
    const out = await pending;
    return { code: 0, text: out.stdout + out.stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, text: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}
async function prepared() {
  const dir = await mkdtemp(join(tmpdir(), "foliage-local-seam-")); roots.push(dir);
  const repo = join(dir, "repo"); const garden = join(dir, "garden");
  await exec("git", ["init", "-q", "--initial-branch=main", repo]);
  for (const [key, value] of [["user.name", "Local safety harness"], ["user.email", "safety@foliage.invalid"]]) await exec("git", ["-C", repo, "config", key!, value!]);
  for (const [i, prefix] of ["feat", "feat", "fix", "fix"].entries()) {
    await writeFile(join(repo, "operation.txt"), `Local transaction regression input ${i}\n`);
    await exec("git", ["-C", repo, "add", "operation.txt"]);
    await exec("git", ["-C", repo, "commit", "-qm", `${prefix}: record transaction case ${i}`, "--no-gpg-sign"]);
  }
  const grow = ["grow", "--repo", repo, "--subject", "Local safety harness", "--identity", "safety@foliage.invalid", "--garden", garden];
  const result = await run(cli, grow); assert.equal(result.code, 0, result.text);
  return { dir, repo, garden, grow, leaf: join(garden, "leaf.json"), harvest: join(garden, "harvest.json") };
}

/** Real repository draft, approved by the real CLI, then explicitly revised for replacement. */
async function replacementPrepared() {
  const f = await prepared();
  const doc = JSON.parse(await readFile(f.harvest, "utf8"));
  const id = doc.candidates[0].id as string;
  let result = await run(harvestCli, ["approve", id, "--by", "Local safety harness", "--doc", f.harvest]);
  assert.equal(result.code, 0, result.text);
  result = await run(harvestCli, ["promote", "--doc", f.harvest, "--into", f.leaf, "--force"]);
  assert.equal(result.code, 0, result.text);
  doc.candidates[0].title += " — reviewed replacement";
  await writeFile(f.harvest, JSON.stringify(doc));
  result = await run(harvestCli, ["approve", id, "--by", "Local safety harness", "--doc", f.harvest]);
  assert.equal(result.code, 0, result.text);
  const candidate = JSON.parse(await readFile(f.harvest, "utf8")).candidates[0];
  const leafBytes = await readFile(f.leaf);
  const args = ["promote", "--doc", f.harvest, "--into", f.leaf, "--force", "--supersede", id,
    "--expect-leaf-digest", createHash("sha256").update(leafBytes).digest("hex"),
    "--expect-supersede", JSON.stringify([id, reviewSubjectDigest(candidate)])];
  return { ...f, id, candidate, args };
}

test("replacement permission covers the displayed sharing snapshot, not a later visibility change", async () => {
  const f = await replacementPrepared();
  const shared = await run(cli, ["share", f.id, "--as", "public", "--garden", f.garden]);
  assert.equal(shared.code, 0, shared.text);
  const beforeLeaf = await readFile(f.leaf, "utf8");
  const beforeHarvest = await readFile(f.harvest, "utf8");
  const refused = await run(harvestCli, f.args);
  assert.notEqual(refused.code, 0);
  assert.match(refused.text, /stale replacement.*sharing settings changed/);
  assert.equal(await readFile(f.leaf, "utf8"), beforeLeaf);
  assert.equal(await readFile(f.harvest, "utf8"), beforeHarvest);
});

test("replacement permission covers the approved body, not another generation under the same id", async () => {
  const f = await replacementPrepared();
  const doc = JSON.parse(await readFile(f.harvest, "utf8"));
  doc.candidates[0].title += " — another generation";
  await writeFile(f.harvest, JSON.stringify(doc));
  const beforeLeaf = await readFile(f.leaf, "utf8");
  const beforeHarvest = await readFile(f.harvest, "utf8");
  const refused = await run(harvestCli, f.args);
  assert.notEqual(refused.code, 0);
  assert.match(refused.text, /stale replacement.*candidate changed/);
  assert.equal(await readFile(f.leaf, "utf8"), beforeLeaf);
  assert.equal(await readFile(f.harvest, "utf8"), beforeHarvest);
});

test("unchanged replacement snapshots permit the reviewed body and preserve sharing", async () => {
  const f = await replacementPrepared();
  const accepted = await run(harvestCli, f.args);
  assert.equal(accepted.code, 0, accepted.text);
  assert.match(accepted.text, /superseded 1/);
  const leaf = JSON.parse(await readFile(f.leaf, "utf8"));
  assert.equal(leaf.leaflets.find((l: { id: string }) => l.id === f.id).title, f.candidate.title);
});

test("forced refresh refuses damaged prior harvest bytes before either writing stage", async () => {
  const f = await prepared();
  const leafBefore = await readFile(f.leaf, "utf8");
  for (const bytes of ["{interrupted", '{"candidates":"invalid shape"}']) {
    await writeFile(f.harvest, bytes);
    const result = await run(cli, f.grow);
    assert.notEqual(result.code, 0, result.text);
    assert.match(result.text, /prior bytes were preserved/);
    assert.match(result.text, /intake and candidate drafting did not start/);
    assert.equal(await readFile(f.leaf, "utf8"), leafBefore);
    assert.equal(await readFile(f.harvest, "utf8"), bytes);
    assert.equal((await readdir(f.garden)).some(p => /local-lock|write-.*tmp/.test(p)), false);
  }
});

test("independent decision processes preserve both decisions, with explicit busy retries", async () => {
  const f = await prepared(); const doc = JSON.parse(await readFile(f.harvest, "utf8"));
  const ids: string[] = doc.candidates.map((c: { id: string }) => c.id);
  assert.equal(ids.length, 2);
  const approve = (id: string) => run(harvestCli, ["approve", id, "--by", "Local safety harness", "--doc", f.harvest]);
  await withDocumentLocks([f.harvest], async () => {
    const refused = await approve(ids[0]!); assert.notEqual(refused.code, 0); assert.match(refused.text, /local document busy/);
  });
  const results = await Promise.all(ids.map(approve));
  for (const [i, result] of results.entries()) {
    if (result.code !== 0) { assert.match(result.text, /local document busy/); const retried = await approve(ids[i]!); assert.equal(retried.code, 0, retried.text); }
  }
  const decided = JSON.parse(await readFile(f.harvest, "utf8"));
  assert.ok(decided.candidates.every((c: { review: { state: string } }) => c.review.state === "approved"));
  const refresh = await run(cli, f.grow); assert.equal(refresh.code, 0, refresh.text);
  assert.deepEqual(JSON.parse(await readFile(f.harvest, "utf8")).candidates.map((c: { review: unknown }) => c.review), decided.candidates.map((c: { review: unknown }) => c.review));
});

test("saved approvals survive promotion failure; all-decided resume is duplicate-safe", async () => {
  const f = await prepared(); const before = await readFile(f.leaf, "utf8");
  await writeFile(f.leaf, "{damaged target");
  for (const c of JSON.parse(await readFile(f.harvest, "utf8")).candidates) {
    const approved = await run(harvestCli, ["approve", c.id, "--by", "Local safety harness", "--doc", f.harvest]);
    assert.equal(approved.code, 0, approved.text);
  }
  const args = ["review", "--garden", f.garden];
  const failed = await run(cli, [...args, "--resume"]);
  assert.notEqual(failed.code, 0, failed.text);
  assert.match(failed.text, /decisions were saved/); assert.match(failed.text, /not valid JSON/); assert.match(failed.text, /--resume/);
  assert.doesNotMatch(failed.text, /NEXT.*export/);
  const approved = await readFile(f.harvest, "utf8");
  assert.ok(JSON.parse(approved).candidates.every((c: { review: { state: string } }) => c.review.state === "approved"));
  const next = await run(cli, args); assert.match(next.text, /--resume/); assert.doesNotMatch(next.text, /NEXT.*export/);
  await writeFile(f.leaf, before);
  const resumed = await run(cli, [...args, "--resume"]); assert.equal(resumed.code, 0, resumed.text);
  const once = JSON.parse(await readFile(f.leaf, "utf8"));
  assert.equal(once.leaflets.length, JSON.parse(before).leaflets.length + 2);
  const again = await run(cli, [...args, "--resume"]); assert.equal(again.code, 0, again.text);
  assert.deepEqual(JSON.parse(await readFile(f.leaf, "utf8")), once);
  assert.equal(await readFile(f.harvest, "utf8"), approved);
});

test("live review normalizes lock paths, retains entered text, and refuses a stale browser/CLI draft", { timeout: 30_000 }, async () => {
  const f = await prepared();
  const doc = JSON.parse(await readFile(f.harvest, "utf8")); const candidate = doc.candidates[0];
  const digest = reviewSubjectDigest(candidate);
  const child = spawn(process.execPath, [serverCli], { env: { ...process.env, PORT: "0", FOLIAGE_LEAF: `  ${f.leaf}  `, FOLIAGE_HARVEST: `  ${f.harvest}  `, FOLIAGE_POLICY: join(f.garden, "policy.json") }, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.once("close", resolve));
  let output = ""; child.stderr.on("data", data => { output += data; });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 10_000);
      child.stdout.on("data", data => { output += data; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`server exited: ${output}`)); });
    });
    const page = await (await fetch(`${origin}/review`)).text();
    assert.ok(page.includes(`name="subjectDigest" value="${digest}"`));
    const fields = new URLSearchParams({ id: candidate.id, decision: "approve", by: "Safety harness", title: "Saved <draft>", reason: "Saved reason", subjectDigest: digest });
    const submit = () => fetch(`${origin}/review`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: fields, redirect: "manual", signal: AbortSignal.timeout(5000) });
    await withDocumentLocks([f.harvest], async () => {
      const refused = await submit(); assert.equal(refused.status, 409);
      const html = await refused.text(); assert.match(html, /document-busy/); assert.match(html, /value="Saved &lt;draft&gt;"/); assert.match(html, /value="Saved reason"/);
      assert.doesNotMatch(html, /No leaf document configured/, "a refused review still shows the configured leaf's promotion state");
      assert.match(html, /local document busy/i, "the lock refusal reaches the page, not just the CLI");
      candidate.title = "Changed draft for concurrency regression";
      writeDocument(f.harvest, JSON.stringify(doc));
    });
    const stale = await submit(); assert.equal(stale.status, 409);
    const html = await stale.text(); assert.match(html, /stale-candidate/); assert.match(html, /value="Saved &lt;draft&gt;"/);
    const cliStale = await run(harvestCli, ["approve", candidate.id, "--by", "Safety harness", "--doc", f.harvest, "--expect-subject-digest", digest]);
    assert.notEqual(cliStale.code, 0); assert.match(cliStale.text, /stale candidate/);
    assert.equal(JSON.parse(await readFile(f.harvest, "utf8")).candidates[0].review.state, "candidate");
    const approved = await run(harvestCli, ["approve", candidate.id, "--by", "Safety harness", "--doc", f.harvest]);
    assert.equal(approved.code, 0, approved.text);
    const beforeLeaf = await readFile(f.leaf, "utf8");
    const beforeHarvest = await readFile(f.harvest, "utf8");
    const promote = () => fetch(`${origin}/promote`, { method: "POST", headers: { Origin: origin }, redirect: "manual", signal: AbortSignal.timeout(5000) });
    for (const locked of [f.harvest, f.leaf]) {
      await withDocumentLocks([locked], async () => {
        const refused = await promote(); assert.equal(refused.status, 409);
        assert.match(await refused.text(), /local document busy/);
        assert.equal(await readFile(f.leaf, "utf8"), beforeLeaf);
        assert.equal(await readFile(f.harvest, "utf8"), beforeHarvest);
      });
    }
    assert.equal((await promote()).status, 303);
    assert.equal(JSON.parse(await readFile(f.leaf, "utf8")).leaflets.length, JSON.parse(beforeLeaf).leaflets.length + 1);
  } finally { child.kill("SIGTERM"); await closed; }
});

test("confirmed publication holds source and policy through its read/commit window", { timeout: 30_000 }, async () => {
  const f = await prepared(); const into = join(f.dir, "published"); const policy = join(f.garden, "policy.json");
  await writeFile(policy, '{"rules":[]}');
  const sourceBytes = await readFile(f.leaf, "utf8"); const leaf = JSON.parse(sourceBytes);
  const base = ["--document", f.leaf, "--policy", policy, "--into", into];
  const preview = await run(publishCli, base);
  const digest = preview.text.match(/--expect-digest (sha256:[a-f0-9]+)/)?.[1];
  const policyDigest = preview.text.match(/--expect-policy-digest (sha256:[a-f0-9]+)/)?.[1];
  assert.ok(digest, preview.text); assert.ok(policyDigest, preview.text);
  // A failed first publication may leave neither partial public bytes nor a temporary file.
  const fault = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import {pathToFileURL} from 'node:url'; const original=fs.writeFileSync; fs.writeFileSync=(path,bytes,...args)=>{if(String(path).includes('.published.json.write-')){original(path,String(bytes).slice(0,12),...args); throw new Error('injected publication write failure');} return original(path,bytes,...args);}; syncBuiltinESMExports(); const target=process.argv[1]; process.argv.shift(); await import(pathToFileURL(target).href);`;
  const failed = await run("--input-type=module", ["-e", fault, publishCli, ...base, "--confirm", leaf.id, "--expect-digest", digest, "--expect-policy-digest", policyDigest]);
  assert.notEqual(failed.code, 0, failed.text);
  assert.match(failed.text, /injected publication write failure/);
  assert.deepEqual(await readdir(into), []);
  // Pause the real publisher immediately after reading source bytes, using a subprocess-only
  // filesystem adapter. No scheduling hook or fake evidence is added to production code.
  const script = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import {pathToFileURL} from 'node:url'; const original=fs.readFile; let paused=false; fs.readFile=async (...args)=>{const bytes=await original(...args); if(!paused && String(args[0])===process.argv[process.argv.indexOf('--document')+1]){paused=true; console.log('SOURCE_PAUSED'); await new Promise(resolve=>process.stdin.once('data',resolve));} return bytes;}; syncBuiltinESMExports(); const target=process.argv[1]; process.argv.shift(); await import(pathToFileURL(target).href);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, publishCli, ...base, "--confirm", leaf.id, "--expect-digest", digest, "--expect-policy-digest", policyDigest], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stderr.on("data", data => { output += data; });
  const completion = new Promise<number | null>(resolve => child.once("close", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`publisher did not pause: ${output}`)), 10_000);
      child.stdout.on("data", data => { output += data; if (output.includes("SOURCE_PAUSED")) { clearTimeout(timer); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`publisher exited before pause: ${output}`)); });
    });
    const denied = await run(policyCli, ["deny", leaf.leaflets[0].id, "--by", "evidence-ref", "--because", "Local safety interleaving test", "--leaf", f.leaf, "--policy", policy]);
    assert.notEqual(denied.code, 0); assert.match(denied.text, /local document busy/);
    const replaced = await run(intakeCli, ["--repo", f.repo, "--subject", "Local safety harness", "--identity", "safety@foliage.invalid", "--out", f.leaf, "--force"]);
    assert.notEqual(replaced.code, 0); assert.match(replaced.text, /local document busy/);
    assert.equal(await readFile(f.leaf, "utf8"), sourceBytes); assert.equal(await readFile(policy, "utf8"), '{"rules":[]}');
    child.stdin.end("continue\n"); assert.equal(await completion, 0, output);
    assert.ok((await readdir(into)).some(p => p.endsWith(".published.json")));
  } finally { child.kill("SIGKILL"); await completion; }
});
