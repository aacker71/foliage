/**
 * The legacy label, measured on the running dashboard: every HTML page it serves, its own
 * one-line refusals included, carries the notice, and its start-up log says the same. Spawned
 * for real because the label is applied in `send`, which only exists inside server.mjs.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const LEGACY_LINE = "[dashboard] Legacy view. The current app is foliage up (node foliage.mjs up); review drafts there at /review.";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer().on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = addr !== null && typeof addr === "object" ? addr.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("no port from the OS"))));
    });
  });
}

test("every page the dashboard serves, and its start-up log, say it is a legacy view of foliage up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-dashboard-legacy-"));
  const harvest = join(dir, "harvest.json");
  await writeFile(harvest, JSON.stringify({
    schemaVersion: 1, subject: "Sentinel Subject", identity: "sentinel@example.test",
    sources: ["/tmp/sentinel-repo"], gatheredAt: "2026-08-29T00:00:00.000Z",
    candidates: [{
      id: "legacy-dashboard", drafted: { title: "Sentinel candidate", summary: "One drafted sentence." },
      evidence: [{ source: "git", ref: "a".repeat(40), excerpt: "feat: sentinel" }],
      provenance: { method: "deterministic" }, status: "proposed",
    }],
  }), "utf8");

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOST: "127.0.0.1", FOLIAGE_HARVEST: harvest,
      FOLIAGE_LEAF: join(dir, "absent-leaf.json"), FOLIAGE_POLICY: join(dir, "absent-policy.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
  child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
  try {
    for (const deadline = Date.now() + 10_000; !stdout.includes("[dashboard] leaf="); await new Promise((r) => setTimeout(r, 50))) {
      assert.ok(Date.now() < deadline && child.exitCode === null, `the dashboard did not start:\n${stderr}`);
    }
    assert.ok(stdout.includes(LEGACY_LINE), stdout);

    const get = async (path: string) => {
      const res = await fetch(origin + path, { signal: AbortSignal.timeout(4_000) });
      return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
    };
    const post = async (path: string, form: Record<string, string>, from: string) => {
      const res = await fetch(origin + path, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(4_000),
        headers: { "content-type": "application/x-www-form-urlencoded", origin: from },
        body: new URLSearchParams(form).toString(),
      });
      return { status: res.status, body: await res.text() };
    };

    const pages = { "/": await get("/"), "/leaf": await get("/leaf"), "/review": await get("/review") };
    for (const [path, page] of Object.entries(pages)) {
      assert.match(page.type, /^text\/html/, path);
      assert.equal(page.body.match(/data-legacy-notice/g)?.length, 1, `${path} carries the notice exactly once`);
      assert.match(page.body, /<code>foliage up<\/code>/, path);
      const h1 = page.body.indexOf("<h1");
      assert.ok(h1 === -1 || page.body.indexOf("data-legacy-notice") < h1, `${path}: the notice leads the content`);
    }
    assert.equal((await get("/dashboard.css")).status, 200, "the notice's own spacing is served, not a 404");

    // Its one-line refusals are pages too, including the ones its composed pages' links lead to:
    // the leaf page links to screens only the current app has.
    const refusals = {
      "/nope": [404, await get("/nope")],
      "/my/leaflet/git%3Asentinel": [404, await get("/my/leaflet/git%3Asentinel")],
      "/decide (GET)": [405, await get("/decide")],
      "/fonts/bad name": [403, await get("/fonts/bad%20name")],
    } as const;
    for (const [path, [status, page]] of Object.entries(refusals)) {
      assert.equal(page.status, status, path);
      assert.match(page.type, /^text\/html/, path);
      assert.ok(page.body.startsWith("<!doctype html>"), `${path} stays a standards-mode page`);
      assert.equal(page.body.match(/data-legacy-notice/g)?.length, 1, `${path} carries the notice exactly once`);
      assert.match(page.body, /<code>foliage up<\/code>/, path);
      assert.ok(page.body.indexOf("data-legacy-notice") < page.body.indexOf("<h1"), `${path}: the notice leads`);
    }
    // A stylesheet or font nobody reads stays a plain answer.
    const missingFont = await get("/fonts/absent-sentinel.woff2");
    assert.equal(missingFont.status, 404);
    assert.match(missingFont.type, /^text\/plain/);

    const forged = await post("/decide", { csrf: "x" }, "http://elsewhere.test");
    assert.equal(forged.status, 403);
    assert.ok(forged.body.startsWith("<!doctype html>"), forged.body);
    assert.match(forged.body, /data-legacy-notice/);

    // A real decide is not maintained here; the refusal points at the current app, not another legacy one.
    const token = /name="csrf" value="([^"]+)"/.exec(pages["/review"].body)?.[1] ?? "";
    const decide = await post("/decide", { csrf: token, id: "legacy-dashboard", verdict: "approved" }, origin);
    assert.equal(decide.status, 501);
    assert.match(decide.body, /node foliage\.mjs up, then open \/review/);

    // A promote that cannot run (its leaf is absent here) is a labelled page too, not bare text.
    const promoted = await post("/promote", { csrf: token }, origin);
    assert.equal(promoted.status, 409, promoted.body);
    assert.ok(promoted.body.startsWith("<!doctype html>"), promoted.body);
    assert.match(promoted.body, /data-legacy-notice[\s\S]*?<code>foliage up<\/code>[\s\S]*?<h1>Not added<\/h1>/);
  } finally {
    child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
