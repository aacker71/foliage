/**
 * The guard for tools/verify/static.mjs's one dangerous seam: path resolution.
 *
 * The folder this server serves (~/.foliage/site) sits INSIDE the garden; one directory up
 * live leaf.json (a real person's evidence) and fireworks.env (a credential). A traversal
 * that escaped the root would turn `pnpm verify export-site` into a loopback exfiltration
 * route. The resolver is pure precisely so this file can hold that door shut without a
 * browser, a port, or a boot — the same guardable-because-pure move as serving.mjs (F-005).
 */

import { equal, ok, match, doesNotMatch } from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { siteFileFor, createSiteServer, exportSiteIdentity } from "./static.mjs";

const ROOT = "/garden/site";

test("/ serves the folder's index.html as html", () => {
  const v = siteFileFor(ROOT, "/");
  equal(v.ok, true);
  equal(v.path, "/garden/site/index.html");
  equal(v.type, "text/html; charset=utf-8");
});

test("a plain .. is refused by name, not 404'd", () => {
  // The garden's own leaf.json is exactly one level up — the realistic target.
  const v = siteFileFor(ROOT, "/../leaf.json");
  equal(v.ok, false);
  equal(v.cause, "outside-root");
});

test("a percent-encoded .. is refused the same way", () => {
  const v = siteFileFor(ROOT, "/%2e%2e/fireworks.env");
  equal(v.ok, false);
  equal(v.cause, "outside-root");
});

test("a NUL byte never reaches the filesystem", () => {
  const v = siteFileFor(ROOT, "/index.html%00.css");
  equal(v.ok, false);
  equal(v.cause, "outside-root");
});

test("an undecodable escape is its own cause, not a crash", () => {
  const v = siteFileFor(ROOT, "/%zz");
  equal(v.ok, false);
  equal(v.cause, "undecodable");
});

test("the four exported types carry their real MIME — woff2 above all", () => {
  // A woff2 served as octet-stream makes document.fonts quietly fall back, and the
  // export-site row's `fonts loaded (>=4)` check would then fail for the wrong reason.
  equal(siteFileFor(ROOT, "/fonts/jbmono-400.woff2").type, "font/woff2");
  equal(siteFileFor(ROOT, "/leaf.css").type, "text/css; charset=utf-8");
  equal(siteFileFor(ROOT, "/mark-icon.svg").type, "image/svg+xml");
  equal(siteFileFor(ROOT, "/index.html").type, "text/html; charset=utf-8");
});

test("query strings and fragments are stripped before resolution", () => {
  const v = siteFileFor(ROOT, "/index.html?cache=1#top");
  equal(v.ok, true);
  equal(v.path, "/garden/site/index.html");
});

test("a nested path stays inside the root", () => {
  const v = siteFileFor(ROOT, "/fonts/fraunces-var.woff2");
  equal(v.ok, true);
  ok(v.path.startsWith(`${ROOT}/`), v.path);
});

test("the static CLI also refuses an implicit or blank garden", () => {
  for (const site of [undefined, "", "   "]) {
    const env = { ...process.env, FOLIAGE_SITE: site };
    if (site === undefined) delete env.FOLIAGE_SITE;
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("./static.mjs", import.meta.url))], {
      encoding: "utf8", env, timeout: 2000,
    });
    equal(r.status, 2, r.stderr);
    match(r.stderr, /FOLIAGE_SITE must explicitly name/);
  }
});

test("static HTTP serves the current exported empty page, with identity and real asset bytes", async (t) => {
  // Empty document scaffolding contains no invented customer work. The product exporter
  // writes every byte served below, including the CSS and self-hosted fonts.
  const dir = mkdtempSync(join(tmpdir(), "foliage-static-export-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const leaf = join(dir, "leaf.json");
  const site = join(dir, "site");
  writeFileSync(leaf, JSON.stringify({ id: "leaf:empty-export-test", subject: "Empty export contract", leaflets: [] }));
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../../apps/leaf/export.mjs", import.meta.url)), "--out", site], {
    encoding: "utf8", env: { ...process.env, FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: join(dir, "no-policy.json") },
  });
  equal(run.status, 0, run.stderr);
  const server = createSiteServer(site);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin);
  equal(page.status, 200);
  equal(page.headers.get("x-foliage-site"), exportSiteIdentity(site));
  equal(page.headers.get("x-content-type-options"), "nosniff");
  equal(page.headers.get("content-security-policy"), null);
  const html = await page.text();
  equal(html, readFileSync(join(site, "index.html"), "utf8"));
  doesNotMatch(html, /class="leaf-leaflet"/);
  match(html, /class="leaf-subject"/);
  const head = await fetch(origin, { method: "HEAD" });
  equal(head.status, 200);
  equal(await head.text(), "");
  equal((await fetch(`${origin}/missing`)).status, 404);
  equal((await fetch(origin, { method: "POST" })).status, 405);
  // Fetch normalizes dot-segments, so use a raw request for the traversal contract.
  const refused = await new Promise((resolve, reject) => {
    request(`${origin}/%2e%2e%2fleaf.json`, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject).end();
  });
  equal(refused, 403);
});


test("the static CLI precondition still runs through a symlink", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-static-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = join(dir, "static.mjs");
  symlinkSync(fileURLToPath(new URL("./static.mjs", import.meta.url)), entry);
  const env = { ...process.env };
  delete env.FOLIAGE_SITE;
  const r = spawnSync(process.execPath, [entry], { encoding: "utf8", env, timeout: 2000 });
  equal(r.status, 2, r.stderr);
  match(r.stderr, /FOLIAGE_SITE must explicitly name/);
});
