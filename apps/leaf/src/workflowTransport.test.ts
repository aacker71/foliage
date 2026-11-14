import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { get } from "node:http";
test("workflow transport refuses foreign origins/hosts and keeps script policy scoped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-http-"));
  const server = spawn(
    process.execPath,
    [new URL("../server.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: "0",
        HOST: "127.0.0.1",
        FOLIAGE_WORKFLOW_DIR: dir,
        FOLIAGE_LEAF: join(dir, "absent.json"),
        FOLIAGE_HARVEST: join(dir, "harvest.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timer = setTimeout(
        () => reject(Error("Server startup timed out")),
        15000,
      );
      server.stdout.on("data", (b) => {
        text += String(b);
        const m = text.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) {
          clearTimeout(timer);
          resolve("http://127.0.0.1:" + m[1]);
        }
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Server exited before readiness"));
      });
    });
    const page = await fetch(url + "/workflow");
    assert.ok([200, 503].includes(page.status));
    if (page.status === 200) {
      assert.match(
        page.headers.get("content-security-policy")!,
        /script-src 'self'/,
      );
      const html = await page.text();
      assert.match(html, /<title>Sources · Foliage<\/title>/, "the Sources nav item opens a page titled Sources");
      // Without an icon link the browser asks for /favicon.ico, gets a 404 and logs a console error.
      assert.match(html, /<link rel="icon" href="\/mark-icon\.svg"/);
      assert.equal((await fetch(url + "/mark-icon.svg")).status, 200);
    } else {
      assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
      assert.doesNotMatch(page.headers.get("content-security-policy")!, /script-src/);
      const recovery = await page.text();
      assert.match(recovery, /data-workflow-state="bundle-missing"/);
      assert.match(recovery, /<title>Sources unavailable · Foliage<\/title>[\s\S]*<h1>Sources<\/h1>/);
      for (const href of ["/leaf/photosynthesis", "/review", "/leaf/import"]) {
        assert.match(recovery, new RegExp(`href="${href}"`));
      }
      assert.match(recovery, /<summary>Technical details<\/summary>/);
    }
    const publicPage = await fetch(url + "/");
    assert.doesNotMatch(
      publicPage.headers.get("content-security-policy")!,
      /script-src/,
    );
    const wrongHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        get(
          url + "/workflow/api",
          { headers: { Host: "untrusted.invalid" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(wrongHost, 421);
    const foreign = await fetch(url + "/workflow/api", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
    for (const route of ["/sources/api", "/sources/assessment", "/workflow/jev"]) {
      const refusal = await fetch(url + route, { method: "POST", headers: { Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: "{}" });
      assert.equal(refusal.status, 403);
    }
    const jevPage = await fetch(url + "/workflow/jev");
    assert.equal(jevPage.status,200);assert.match(await jevPage.text(),/Connect a source/);
    const invalidGrant=await fetch(url+"/workflow/jev",{method:"POST",headers:{Origin:url,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({action:'jev-grant',source:'foreign',revision:'sha256:'+'0'.repeat(64),consent:'typesafe-source-commit-titles'})});
    assert.equal(invalidGrant.status,409);
    const catalogResponse = await fetch(url + "/sources/api");
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as { catalog: { id: string }[]; ladybug: { connected: boolean } };
    assert.ok(catalog.catalog.some(source => source.id === "open-design"));
    assert.equal(catalog.ladybug.connected, false); // Read-only catalog works without a Leaf or disk discovery.
    const oversized = await fetch(url + "/sources/api", { method: "POST", headers: { Origin: url, "Content-Type": "application/json" }, body: "x".repeat(513 * 1024) });
    assert.equal(oversized.status, 413);
    // A first run's export choice names the missing record, not ENOENT and a local path.
    const firstRun = await fetch(url + "/sources/api", { method: "POST", headers: { Origin: url, "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview-export", provider: "figma", name: "source.txt", content: "Selected text." }) });
    assert.equal(firstRun.status, 400);
    assert.deepEqual(await firstRun.json(), { error: "Create your private record first at /leaf/setup. Nothing was imported." });
    const malformed = await fetch(url + "/workflow/api", {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: "{bad",
    });
    assert.equal(malformed.status, 400);
    const state = await fetch(url + "/workflow/api");
    assert.equal(state.status, 200);
    assert.deepEqual(
      ((await state.json()) as { sources: unknown[] }).sources,
      [],
    );
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit");
    await rm(dir, { recursive: true, force: true });
  }
});
