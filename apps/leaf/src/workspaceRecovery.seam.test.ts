import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Scarlet and owner policy failures retain the private workspace and actionable details", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workspace-recovery-"));
  const leafPath = join(dir, "private<record>.json");
  const policyPath = join(dir, "policy<invalid>.json");
  await writeFile(policyPath, JSON.stringify({ rules: [{ id: "x", effect: "maybe", match: { kind: "weight" }, reason: "" }] }));
  const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FOLIAGE_LEAF: leafPath, FOLIAGE_POLICY: policyPath, FOLIAGE_WORKFLOW_DIR: join(dir, "workflow") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });

  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 15_000);
      let stdout = "";
      child.stdout.on("data", chunk => {
        stdout += String(chunk);
        const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Server exited before startup: ${stderr}`)); });
    });

    const scarlet = await fetch(`${base}/leaf/scarlet`);
    assert.equal(scarlet.status, 503);
    assert.equal(scarlet.headers.get("content-type"), "text/html; charset=utf-8");
    const scarletHtml = await scarlet.text();
    assert.match(scarletHtml, /<html lang="en" data-face="night">/);
    assert.match(scarletHtml, /data-recovery="scarlet-leaf"/);
    assert.match(scarletHtml, /href="\/leaf\/setup"[^>]*>Create private record<\/a>/);
    assert.match(scarletHtml, /href="\/leaf\/photosynthesis"/);
    assert.match(scarletHtml, /href="\/review"/);
    assert.match(scarletHtml, /<summary>Technical details<\/summary>/);
    assert.ok(scarletHtml.indexOf("private&lt;record&gt;.json") > scarletHtml.indexOf("<summary>Technical details</summary>"));
    assert.doesNotMatch(scarletHtml, /private<record>\.json/);
    assert.equal((await fetch(`${base}/leaf/setup`)).status, 200);

    const refusedPost = await fetch(`${base}/leaf/scarlet`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "unexpected" }),
    });
    assert.equal(refusedPost.status, 503);
    assert.match(await refusedPost.text(), /data-recovery="scarlet-leaf"/);

    for (const route of ["/", "/leaf", "/policy", "/publish", "/my/leaflet/unknown"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 503, route);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8", route);
      const html = await response.text();
      assert.match(html, /<html lang="en" data-face="night">/);
      assert.match(html, /data-recovery="publish-policy"/);
      assert.match(html, /href="\/leaf\/photosynthesis"[^>]*>Open Work<\/a>/);
      assert.match(html, /<summary>Technical details<\/summary>/);
      assert.ok(html.indexOf("policy&lt;invalid&gt;.json") > html.indexOf("<summary>Technical details</summary>"), route);
      assert.doesNotMatch(html, /policy<invalid>\.json/);
      assert.match(html, /rules\[0\]\.effect/);
    }

    const publicArtifact = await fetch(`${base}/leaflet/unknown`);
    assert.equal(publicArtifact.status, 503);
    assert.equal(publicArtifact.headers.get("content-type"), "text/plain; charset=utf-8");

    await writeFile(policyPath, '{"rules":[]}');
    assert.equal((await fetch(`${base}/policy`)).status, 200, "fixing the file restores the policy page without restart");

    await writeFile(leafPath, "{");
    const malformedLeaf = await fetch(`${base}/leaf/scarlet`);
    assert.equal(malformedLeaf.status, 503);
    const malformedHtml = await malformedLeaf.text();
    assert.match(malformedHtml, /The private record is not valid JSON/);
    assert.match(malformedHtml, /href="\/leaf\/setup"[^>]*>Open portfolio setup<\/a>/);
    assert.ok(malformedHtml.indexOf("private&lt;record&gt;.json") > malformedHtml.indexOf("<summary>Technical details</summary>"));
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
