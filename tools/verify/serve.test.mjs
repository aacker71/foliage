/** The real CLI refuses an implicit garden; imported operations exercise owned ephemeral
 * listeners so a developer's existing port is never part of a test's assumptions. */
import { equal, match, doesNotMatch } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { up } from "./serve.mjs";
import { ensure } from "./verify.mjs";
import { createSiteServer } from "./static.mjs";
import { SURFACES } from "./surfaces.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("both CLIs skip an unset site and verify never claims checks passed", () => {
  const env = { ...process.env };
  delete env.FOLIAGE_SITE;
  for (const [script, args] of [["serve.mjs", ["up", "export-site"]], ["verify.mjs", ["export-site"]]]) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
      encoding: "utf8", env, timeout: 15_000,
    });
    equal(r.status, 0, r.stderr);
    match(r.stdout, /skip/i, r.stdout);
    match(r.stdout, /explicit address only/);
    doesNotMatch(r.stdout, /ALL CHECKS PASSED/);
    if (script === "verify.mjs") match(r.stdout, /NO CHECKS RUN/);
  }
});

test("serve and verify refuse unmanaged listeners even when they serve the selected folder", async (t) => {
  const server = createSiteServer(ROOT);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const surface = { ...SURFACES["export-site"], port: server.address().port, path: "/package.json" };
  const env = { ...process.env, FOLIAGE_SITE: ROOT };
  const same = await up("export-site", surface, {}, env);
  equal(same.action, "conflict");
  match(same.reason, /occupied; no server adopted/);
  const verified = await ensure("export-site", surface, {}, env);
  equal(verified.started, false);
  equal(verified.res, null);
  match(verified.problem, /occupied; no server adopted/);

  const other = { ...env, FOLIAGE_SITE: fileURLToPath(new URL(".", import.meta.url)) };
  const refused = await up("export-site", surface, {}, other);
  equal(refused.action, "conflict");
  match(refused.reason, /occupied; no server adopted/);
  const wrong = await ensure("export-site", surface, {}, other);
  equal(wrong.res, null);
  match(wrong.problem, /occupied; no server adopted/);
  equal((await fetch(`http://127.0.0.1:${surface.port}/package.json`)).status, 200);

  const missing = { ...env };
  delete missing.FOLIAGE_SITE;
  equal((await up("export-site", surface, {}, missing)).action, "skipped",
    "the precondition must precede even an already-answering listener");
});
