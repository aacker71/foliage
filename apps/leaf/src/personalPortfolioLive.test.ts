import { testRepository } from "../../../tools/development/testRepository.mjs";
/** Real repository history, actual intake, and an owned loopback server. No invented work. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadLeafDocument } from "./leafDocument.ts";

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const HISTORY = testRepository();
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const SHARE = fileURLToPath(new URL("../share.mjs", import.meta.url));
const EXPORT = fileURLToPath(new URL("../export.mjs", import.meta.url));

interface PortfolioState {
  revision: string;
  policyRevision: string;
  workDatesRevision: string;
  freshnessRevision: string;
  freshnessHtml: string;
  html?: string;
}

function artifactIds(html: string): string[] {
  return [...new Set([...html.matchAll(/href="\/my\/leaflet\/([^"?#]+)"/g)].map(match => decodeURIComponent(match[1]!)))].sort();
}

test("private portfolio refresh preserves real intake, independently updates freshness, and never enhances published output", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-personal-live-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const source = join(directory, "source");
    const leafPath = join(directory, "leaf.json");
    const policyPath = join(directory, "absent-policy.json");
    // Non-merge commits, so advancing to the newer one really adds work. Two merges in a row can
    // add none, and a re-read that adds nothing now leaves the Leaf unchanged (QA 2026-10-02 #11).
    const { stdout: refs } = await exec("git", ["-C", HISTORY, "log", "-2", "--no-merges", "--format=%H"]);
    const [currentRef, earlierRef] = refs.trim().split("\n");
    assert.ok(currentRef && earlierRef, "the live refresh test needs two actual repository commits");
    const { stdout: author } = await exec("git", ["-C", HISTORY, "show", "-s", "--format=%ae%n%an", currentRef]);
    const [identity, subject] = author.trim().split("\n");
    assert.ok(identity && subject);

    // Copy real Git objects into a temporary repo. Advancing HEAD below observes existing work;
    // it never manufactures a commit or changes the developer's checkout.
    await mkdir(source);
    await exec("git", ["-C", source, "init", "--initial-branch=main"]);
    // No detached auto-maintenance after a fetch: it can still be writing .git/objects when the
    // directory is removed below (ENOTEMPTY on CI's git 2.55).
    await exec("git", ["-C", source, "config", "maintenance.auto", "false"]);
    await exec("git", ["-C", source, "config", "gc.auto", "0"]);
    const observe = async (ref: string, force = false) => {
      await exec("git", ["-C", source, "fetch", "--no-tags", "--depth=4", HISTORY, ref]);
      await exec("git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
      await exec(process.execPath, [INTAKE, "--repo", source, "--identity", identity, "--subject", subject, "--out", leafPath, ...(force ? ["--force"] : [])]);
    };
    await observe(earlierRef);
    const env = {
      ...process.env,
      FOLIAGE_LEAF: leafPath, FOLIAGE_POLICY: policyPath,
      FOLIAGE_HARVEST: join(directory, "absent-harvest.json"),
      FOLIAGE_HOSTED_STATUS: join(directory, "absent-hosted.json"),
      FOLIAGE_WORKFLOW_DIR: "", FOLIAGE_LOCAL_MODEL: "",
      FOLIAGE_COMPANION_ORIGIN: "", FOLIAGE_COMPANION_KEY: "",
      PORT: "0", HOST: "127.0.0.1",
    };
    const initial = await loadLeafDocument(env);
    assert.ok(initial.ok);
    assert.ok(initial.leaf.leaflets.length > 0, "actual intake must contain records to exercise the portfolio mapping");

    child = spawn(process.execPath, [SERVER], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout!.on("data", bytes => { output += String(bytes); });
    child.stderr!.on("data", bytes => { errors += String(bytes); });
    const deadline = Date.now() + 12_000;
    let origin = "";
    while (Date.now() < deadline) {
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { origin = `http://127.0.0.1:${match[1]}`; break; }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.notEqual(origin, "", `owned server did not start; exit=${String(child.exitCode)}\n${output}\n${errors}`);
    const request = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(5_000), ...init });
    let workDatesRevision = "";
    const statePath = (revision: string, freshnessRevision: string, policyRevision: string) => `/leaf/portfolio-state?${new URLSearchParams({ revision, freshnessRevision, policyRevision, workDatesRevision, records: "source" })}`;

    const privateResponse = await request("/leaf");
    assert.equal(privateResponse.status, 200);
    const privateHtml = await privateResponse.text();
    assert.match(privateHtml, /<script[^>]+src="\/portfolio-reader\.mjs"/);
    assert.match(privateResponse.headers.get("content-security-policy") ?? "", /(?:^|;)\s*script-src 'self'(?:;|\s)/);
    assert.match(privateHtml, /<form\b[^>]*method="get"[^>]*action="\/leaf"/);
    assert.match(privateResponse.headers.get("content-security-policy") ?? "", /(?:^|;)\s*form-action 'self'(?:;|\s|$)/,
      "the portfolio's native order form must be allowed when its optional renderer is unavailable");
    assert.match(privateHtml, /data-portfolio-records-mode="work"/);
    const sourceHtml = await (await request("/leaf?records=source")).text();
    assert.deepEqual(artifactIds(sourceHtml), initial.leaf.leaflets.map(record => String(record.id)).sort());
    const script = await request("/portfolio-reader.mjs");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);

    const firstResponse = await request("/leaf/portfolio-state?records=source");
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as PortfolioState;
    workDatesRevision = first.workDatesRevision;
    assert.match(workDatesRevision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.revision, initial.source.documentDigest);
    assert.match(first.policyRevision, /^sha256:[a-f0-9]{64}$/);
    assert.ok(privateHtml.includes(`data-policy-revision="${first.policyRevision}"`));
    assert.ok(typeof first.freshnessRevision === "string" && first.freshnessRevision.length > 0);
    assert.ok(typeof first.freshnessHtml === "string" && first.freshnessHtml.length > 0);
    assert.equal(typeof first.html, "string");
    assert.deepEqual(artifactIds(first.html!), initial.leaf.leaflets.map(record => String(record.id)).sort());
    assert.equal((await request(statePath(first.revision, first.freshnessRevision, first.policyRevision))).status, 204);

    // This token is only a conditional-read probe; it is never evidence or portfolio content.
    const statusResponse = await request(statePath(first.revision, "previous-freshness-revision", first.policyRevision));
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json() as PortfolioState;
    assert.equal(status.revision, first.revision);
    assert.equal(status.freshnessRevision, first.freshnessRevision);
    assert.equal(status.html, undefined, "a freshness-only update must not replace the person's unchanged portfolio");
    assert.ok(status.freshnessHtml.length > 0);

    // Policy changes alter withholding on the reading surface without changing one Leaf byte.
    // Use an actual retained evidence ref and a local explicit rule, never new portfolio work.
    const policyTarget = initial.leaf.leaflets.find(record => record.provenance);
    assert.ok(policyTarget?.provenance);
    const initialBytes = await readFile(leafPath);
    const ruleId = "live-policy-refresh-check";
    const reason = "This retained reference is withheld by the local refresh regression rule.";
    await writeFile(policyPath, JSON.stringify({ rules: [{ id: ruleId, effect: "deny", match: { kind: "evidence-ref", ref: policyTarget.provenance.ref }, reason }] }));
    const policyResponse = await request(statePath(first.revision, first.freshnessRevision, first.policyRevision));
    assert.equal(policyResponse.status, 200);
    const policyUpdate = await policyResponse.json() as PortfolioState;
    assert.equal(policyUpdate.revision, first.revision, "the document revision remains the actual Leaf digest");
    assert.notEqual(policyUpdate.policyRevision, first.policyRevision);
    assert.equal(policyUpdate.freshnessRevision, first.freshnessRevision, "the policy itself changed, not collection or hosting freshness");
    assert.equal(typeof policyUpdate.html, "string", "a policy-only change must return a replacement reading view");
    assert.ok(policyUpdate.html!.includes(`data-withheld-by-rule="${ruleId}"`));
    assert.ok(policyUpdate.html!.includes(reason));
    assert.ok(policyUpdate.html!.includes(`data-policy-revision="${policyUpdate.policyRevision}"`));
    assert.deepEqual(await readFile(leafPath), initialBytes);
    assert.equal((await request(statePath(policyUpdate.revision, policyUpdate.freshnessRevision, policyUpdate.policyRevision))).status, 204);
    const policyFreshnessOnly = await request(statePath(policyUpdate.revision, "earlier-status", policyUpdate.policyRevision));
    assert.equal((await policyFreshnessOnly.json() as PortfolioState).html, undefined, "matching document and policy must retain the freshness-only fast path");
    await rm(policyPath);
    const restoredResponse = await request(statePath(policyUpdate.revision, policyUpdate.freshnessRevision, policyUpdate.policyRevision));
    const restored = await restoredResponse.json() as PortfolioState;
    assert.equal(restored.policyRevision, first.policyRevision);
    assert.equal(restored.revision, first.revision);
    assert.equal(typeof restored.html, "string");
    assert.ok(!restored.html!.includes(`data-withheld-by-rule="${ruleId}"`));

    await observe(currentRef, true);
    const updated = await loadLeafDocument(env);
    assert.ok(updated.ok);
    assert.notEqual(updated.source.documentDigest, first.revision);
    const updatedResponse = await request(statePath(first.revision, first.freshnessRevision, first.policyRevision));
    assert.equal(updatedResponse.status, 200);
    const next = await updatedResponse.json() as PortfolioState;
    workDatesRevision = next.workDatesRevision;
    assert.equal(next.revision, updated.source.documentDigest);
    assert.equal(typeof next.html, "string");
    assert.deepEqual(artifactIds(next.html!), updated.leaf.leaflets.map(record => String(record.id)).sort(), "the served records must be exactly the actual intake result");
    assert.equal((await request(statePath(next.revision, next.freshnessRevision, next.policyRevision))).status, 204);

    // Share one actual attributable record inside this isolated loopback test, then exercise
    // the real public renderer and export CLI. No external service receives this document.
    const shareable = updated.leaf.leaflets.find(record => record.tier !== "excluded");
    assert.ok(shareable, "current intake must include the real current commit author's work");
    await exec(process.execPath, [SHARE, "share", String(shareable.id), "--as", "public", "--leaf", leafPath]);
    const publishedResponse = await request(`/leaflet/${encodeURIComponent(shareable.id)}`);
    assert.equal(publishedResponse.status, 200);
    assert.doesNotMatch(await publishedResponse.text(), /portfolio-reader\.mjs|\/leaf\/portfolio-state/);
    const exportPath = join(directory, "published");
    await exec(process.execPath, [EXPORT, "--out", exportPath, "--confirm"], { env });
    assert.doesNotMatch(await readFile(join(exportPath, "index.html"), "utf8"), /portfolio-reader\.mjs|\/leaf\/portfolio-state/);

    const post = await request("/leaf/portfolio-state", { method: "POST", headers: { origin }, body: "" });
    assert.equal(post.status, 405);
    assert.match(post.headers.get("allow") ?? "", /GET/);

    const validBytes = await readFile(leafPath);
    for (const broken of ["{", JSON.stringify({ id: "not-a-leaf-document" })]) {
      await writeFile(leafPath, broken);
      const brokenResponse = await request(statePath(next.revision, next.freshnessRevision, next.policyRevision));
      assert.equal(brokenResponse.status, 409, "malformed or invalid raw collection bytes must not become an empty successful refresh");
      const refusal = await brokenResponse.json() as Record<string, unknown>;
      assert.ok(typeof refusal["error"] === "string" && refusal["error"].length > 0);
      assert.equal(refusal["revision"], undefined);
      assert.equal(refusal["html"], undefined);
    }
    await writeFile(leafPath, validBytes);
    await rm(leafPath);
    assert.equal((await request(statePath(next.revision, next.freshnessRevision, next.policyRevision))).status, 409, "a missing collection must retain its loading failure");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child.kill();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
