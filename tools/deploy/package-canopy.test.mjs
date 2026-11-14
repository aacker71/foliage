import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { packageCanopy } from "./package-canopy.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function boot(directory, t) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/canopy/server.mjs"], {
    cwd: directory, env: { PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Packaged server startup timed out: ${output}`)), 10_000);
    const finish = (error, url) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(url);
    };
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => finish(new Error(`Packaged server exited ${code}: ${output}`)));
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const port = output.match(/Host allow-list: 127\.0\.0\.1:(\d+)/)?.[1];
      if (port) finish(null, `http://127.0.0.1:${port}`);
    });
  });
}

test("relocated Canopy artifact boots with native TS, workspace exports and exact package assets", { timeout: 120_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "foliage-runtime-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "packaged");
  const result = await packageCanopy(output);
  assert.ok(result.packages.includes("@foliage/tokens"));
  const runtime = join(temporary, "relocated");
  await rename(output, runtime);
  for (const name of await readdir(join(runtime, "node_modules/@foliage"))) {
    const target = await realpath(join(runtime, "node_modules/@foliage", name));
    assert.ok(!relative(await realpath(runtime), target).startsWith(".."), `${name} escapes the artifact`);
  }
  const files = (await readdir(runtime, { recursive: true, withFileTypes: true }))
    .map(entry => relative(runtime, join(entry.parentPath, entry.name)));
  assert.deepEqual(files.filter(path => /(?:^|\/)\.env|\.leaf\.json$/.test(path)), [], "private configuration/evidence never ships");
  assert.deepEqual(files.filter(path => /^(apps|packages)\//.test(path) && !path.includes("/node_modules/") && /\.test\.|(?:^|\/)dist(?:\/|$)/.test(path)), [], "workspace source runs directly without test or dist trees");
  const url = await boot(runtime, t);
  const sharedSearch = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'const { searchRecords } = await import("@foliage/photosynthesis/search"); console.log(JSON.stringify(searchRecords([{ id: "release", kind: "work", title: "Release note", text: "Published release note", citation: "/leaf/release" }], "release")));',
  ], { cwd: runtime, encoding: "utf8", env: {}, timeout: 10_000 });
  assert.equal(JSON.parse(sharedSearch)[0]?.citation, "/leaf/release", "the relocated runtime includes the one shared ranker");
  const word = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    const { publicResumeDocx } = await import("./apps/canopy/src/distributionDocx.ts");
    // Empty protocol input tests packaging, not a person's career or ATS acceptance.
    const bytes = await publicResumeDocx({ leaf: { id: "package-protocol", subject: "Packaging protocol" }, publishedAt: "2026-10-05T00:00:00Z" }, "https://resume.example");
    console.log(bytes.subarray(0, 2).toString());
  `], { cwd: runtime, encoding: "utf8", env: {}, timeout: 10_000 });
  assert.equal(word.trim(), "PK", "Word generation survives relocation, including npm dependencies named after built-ins");
  const assets = new Map([
    ["/foliage-tokens.css", "tokens.css"], ["/roles.css", "roles.css"], ["/foliage.css", "foliage.css"],
    ["/foliage-sprite.svg", "foliage-sprite.svg"], ["/mark-primary.svg", "mark-primary.svg"],
    ["/mark-expressive.svg", "mark-expressive.svg"], ["/mark-icon.svg", "mark-icon.svg"],
  ]);
  for (const font of await readdir(join(ROOT, "packages/foliage-tokens/src/fonts"))) {
    if (font.endsWith(".woff2")) assets.set(`/fonts/${font}`, `fonts/${font}`);
  }
  for (const [route, source] of assets) {
    const response = await fetch(`${url}${route}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, route);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(ROOT, "packages/foliage-tokens/src", source)), route);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  const refused = await new Promise((resolve, reject) => {
    get(url, { headers: { host: "foreign.invalid" }, signal: AbortSignal.timeout(3000) }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(refused, 421, "packaging must preserve the existing host guard");

  // Reproduce the production import failure: source presence alone is insufficient.
  await rm(join(runtime, "node_modules/@foliage/tokens"));
  await assert.rejects(boot(runtime, t), /ERR_MODULE_NOT_FOUND.*|Cannot find package '@foliage\/tokens'/s);
});

test("packaging refuses an existing directory instead of mixing release state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-existing-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(packageCanopy(directory), { code: "EEXIST" });
});

test("shared server UI renders from copied production dependencies after its source checkout disappears", { timeout: 180_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "foliage-ui-runtime-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source");
  await packageCanopy(source);
  // The integrated Canopy already declares its shared UI dependency. Repackage its actual
  // closure, then remove the source to prove the relative links stand alone.
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", source]);
  execFileSync("git", ["add", "apps", "packages"], { cwd: source });
  const generated = "apps/canopy/public/workspace.css";
  const styles = join(ROOT, "packages/ui/src/controls.css");
  await copyFile(styles, join(source, generated));
  await copyFile(styles, join(source, "apps/canopy/public/unselected.css"));
  await symlink(styles, join(source, "apps/canopy/public/escape.css"));
  await symlink(dirname(styles), join(source, "apps/canopy/public/external"));
  for (const invalid of ["apps/canopy/public/../../package.json", "apps/canopy/public/escape.css", "apps/canopy/public/external/controls.css"]) {
    await assert.rejects(packageCanopy(join(temporary, "invalid"), source, { generatedAssets: [invalid] }), /Not an approved generated public asset/);
  }
  const runtime = join(temporary, "runtime");
  const result = await packageCanopy(runtime, source, { generatedAssets: [generated] });
  assert.ok(result.externalPackages > 0);
  assert.deepEqual(await readFile(join(runtime, generated)), await readFile(styles));
  await assert.rejects(readFile(join(runtime, "apps/canopy/public/unselected.css")), { code: "ENOENT" });
  for (const entry of await readdir(runtime, { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      const target = await realpath(join(entry.parentPath, entry.name));
      assert.ok(!relative(await realpath(runtime), target).startsWith(".."), `${entry.name} escapes the artifact`);
    }
  }
  await rm(source, { recursive: true });
  const html = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'const { ui } = await import("@foliage/ui"); console.log(ui.link("Continue", { href: "/review" }));',
  ], { cwd: runtime, encoding: "utf8", env: {}, timeout: 10_000 });
  assert.match(html, /<a[^>]+href="\/review"/);
  assert.match(html, /data-slot="button"/);
  assert.match(html, />Continue<\/a>/);
  assert.ok(!await readdir(join(runtime, "node_modules")).then((names) => names.includes(".pnpm")));
});
