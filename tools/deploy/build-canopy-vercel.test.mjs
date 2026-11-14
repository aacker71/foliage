import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { packageCanopy } from "./package-canopy.mjs";
import { buildCanopyVercel } from "./build-canopy-vercel.mjs";
import { checkPortfolioLeafBundle } from "../../packages/ui/src/portfolio-leaf-bundle.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("Vercel build keeps a failed prior output intact, then emits one relocated Node function with no static bypass", { timeout: 180_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "foliage-vercel-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source");
  if (!(await checkPortfolioLeafBundle(join(ROOT, "packages/ui"))).ok) {
    execFileSync(process.execPath, [join(ROOT, "packages/ui/build-portfolio-leaf.mjs")], { cwd: ROOT, timeout: 30_000 });
  }
  const generatedAssets = ["packages/ui/build/portfolio-leaf.bundle.js", "packages/ui/build/portfolio-leaf.receipt.json"];
  await assert.rejects(packageCanopy(join(temporary, "partial"), ROOT, { generatedAssets: generatedAssets.slice(0, 1) }), /packaged together/);
  await assert.rejects(packageCanopy(join(temporary, "unapproved"), ROOT, { generatedAssets: ["packages/ui/build/private.json"] }), /Not an approved generated public asset/);
  await packageCanopy(source, ROOT, { generatedAssets });
  assert.ok((await checkPortfolioLeafBundle(join(source, "packages/ui"))).ok, "the checked renderer survives isolated source packaging");
  await rm(join(source, "apps/canopy/hosted-server.mjs"), { force: true }); // prove missing-handler refusal on every integrated candidate
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", source]);
  execFileSync("git", ["add", "apps", "packages"], { cwd: source });
  const previous = join(source, "apps/canopy/.vercel/output/static");
  await mkdir(previous, { recursive: true });
  const tokens = join(ROOT, "packages/foliage-tokens/src/tokens.css");
  await copyFile(tokens, join(previous, "stale.css"));
  await assert.rejects(buildCanopyVercel({ root: source, generatedAssets: [] }), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(previous, "stale.css")), await readFile(tokens));

  // Transport probe, not a substitute for the hosted authority tests: the function reads
  // actual package bytes through the same export map that failed in production.
  await writeFile(join(source, "apps/canopy/hosted-server.mjs"), `
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export default async function handler(_req, res) {
  res.end(await readFile(fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"))));
}
`);
  execFileSync("git", ["add", "apps/canopy/hosted-server.mjs"], { cwd: source });
  await copyFile(tokens, join(source, "apps/canopy/public/workspace.css"));
  await copyFile(join(ROOT, "apps/canopy/src/publicHeaders.mjs"), join(source, "apps/canopy/public/workspace.js"));
  const { output } = await buildCanopyVercel({ root: source });
  assert.deepEqual((await readdir(output)).sort(), ["config.json", "functions"]);
  const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
  assert.deepEqual(config, { version: 3, routes: [{ src: "/.*", dest: "/index" }] });
  const fn = "functions/index.func";
  const launch = JSON.parse(await readFile(join(output, fn, ".vc-config.json"), "utf8"));
  assert.deepEqual(launch, { runtime: "nodejs22.x", handler: "apps/canopy/hosted-server.mjs", launcherType: "Nodejs", shouldAddHelpers: false });
  const relocated = join(temporary, "deployment");
  await rename(output, relocated);
  await rm(source, { recursive: true });
  assert.ok((await checkPortfolioLeafBundle(join(relocated, fn, "packages/ui"))).ok, "relocated function retains a fresh renderer and receipt, with all checked source inputs");
  assert.deepEqual(await readFile(join(relocated, fn, ...generatedAssets[0].split("/"))), await readFile(join(ROOT, generatedAssets[0])));
  const response = execFileSync(process.execPath, ["--input-type=module", "-e", `
import { createServer } from "node:http";
const { default: handler } = await import("./${launch.handler}");
const server = createServer(handler);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/leaf/unavailable");
  process.stdout.write(Buffer.from(await response.arrayBuffer()));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
`], { cwd: join(relocated, fn), env: {}, timeout: 5000 });
  assert.deepEqual(response, await readFile(tokens));
});
