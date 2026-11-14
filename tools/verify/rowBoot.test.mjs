/**
 * QA #7 (a)/(c): each changed row's REAL boot command, through the REAL supervisor.
 *
 * managed.test.mjs proves the supervisor with a stand-in child that prints exactly the line the
 * supervisor waits for — which is how the export-site row shipped unable to boot: its stand-in
 * printed `[probe] http://…` while tools/verify/static.mjs printed `static: serving <dir> at …`,
 * and nothing ran the two together. These tests run the row as the table declares it (command,
 * label, env, path), only made absolute so a scratch control root owns the supervisor and a
 * developer's own `pnpm serve` children are never touched.
 *
 * Every document below is a synthetic protocol fixture marked as such — no person's work.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { controlDirectory, controlPath, request, start } from "./managed.ts";
import { exportSiteIdentity } from "./static.mjs";
import { SURFACES } from "./surfaces.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The row exactly as the table declares it; only its command is made absolute. */
function row(name, port) {
  const surface = SURFACES[name];
  return { ...surface, port, cmd: surface.cmd.map((part) => join(REPO, part)) };
}

/** Each test owns a scratch root, so stopping its supervisor can never reach a real one. */
async function cleanup(root, name) {
  const socket = controlPath(root, name);
  await request(socket, "stop").catch(() => null);
  for (let i = 0; i < 80 && (await request(socket, "status").catch(() => null)) !== null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  rmSync(controlDirectory(root), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

/** Unset every garden variable a developer's shell may carry, then name only scratch files. */
function scratchEnv(extra) {
  const env = { ...process.env };
  for (const name of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR", "FOLIAGE_SITE"]) delete env[name];
  return { ...env, ...extra };
}

test("export-site: the static server's own listen line makes the row ready", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fol-row-site-"));
  t.after(() => cleanup(root, "export-site"));
  const site = join(root, "site");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), "<!doctype html><title>Synthetic boot contract</title>\n");
  const port = await freePort();
  const state = await start(root, "export-site", row("export-site", port), {}, scratchEnv({ FOLIAGE_SITE: site }));
  assert.equal(state.state, "ready", `the row never became ready: ${state.detail}`);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-foliage-site"), exportSiteIdentity(site));
});

test("photosynthesis: the row serves the review queue for the harvest foliage grow writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fol-row-review-"));
  t.after(() => cleanup(root, "photosynthesis"));
  const leaf = join(root, "leaf.json");
  const harvest = join(root, "harvest.json");
  writeFileSync(leaf, JSON.stringify({ id: "leaf:synthetic-row-boot", subject: "Synthetic row-boot subject", example: true, leaflets: [] }));
  // The leaf app's harvest shape (packages/photosynthesis), the one `foliage grow` writes and
  // `foliage up` serves at /review. The standalone review server refuses this shape outright.
  writeFileSync(harvest, JSON.stringify({
    subject: "Synthetic row-boot subject",
    leafId: "leaf:synthetic-row-boot",
    candidates: [{
      id: "git-cluster:synthetic-row-boot",
      title: "Synthetic candidate for the row-boot contract",
      extractor: "git-cluster",
      draftedAt: "2026-09-04T00:00:00Z",
      evidence: [{ source: "git", ref: "1".repeat(40), observedAt: "2026-09-04T00:00:00Z" }],
      review: { state: "candidate" },
    }],
  }));
  const port = await freePort();
  const surface = row("photosynthesis", port);
  const env = scratchEnv({ FOLIAGE_LEAF: leaf, FOLIAGE_HARVEST: harvest, FOLIAGE_POLICY: join(root, "no-policy.json") });
  const state = await start(root, "photosynthesis", surface, {}, env);
  assert.equal(state.state, "ready", `the row never became ready: ${state.detail}`);
  const res = await fetch(`http://127.0.0.1:${port}${surface.path}`);
  const html = await res.text();
  assert.equal(res.status, 200, html.slice(0, 400));
  assert.match(html, /<h1>Review queue<\/h1>/);
  assert.match(html, /Synthetic candidate for the row-boot contract/);
  // The forged-origin checks the row declares are answered by the server it now boots.
  for (const check of surface.csrf) {
    const forged = await fetch(`http://127.0.0.1:${port}${check.path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(check.origin ? { origin: check.origin } : {}) },
      body: check.body ?? "x=1",
    });
    await forged.arrayBuffer();
    assert.equal(forged.status, check.expect, check.name);
  }
});
