/** Real temporary Git intake → explicit sharing → publication gate → HTTP and static export.
 * Commit messages describe this test's work, not a fabricated person's achievements. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseLeafDocument } from "@foliage/leaf";
import { toArtifactJson } from "@foliage/canopy";
import { checkPortfolioLeafBundle } from "@foliage/ui/portfolio-leaf-bundle";
import { loadManageState } from "./manageState.ts";
import { renderPublishedPage } from "./renderPublished.ts";
import { publicHeaders } from "./publicHeaders.mjs";

test("only admitted Git work reaches the shared public leaf, with scoped script authority and closed export assets", { timeout: 40_000 }, async () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "foliage-public-portfolio-")), repo = join(dir, "repo"), publications = join(dir, "published");
  await mkdir(repo); await mkdir(publications);
  const id = "portfolio-http-protocol", identity = "portfolio-http-protocol@foliage.invalid";
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    FOLIAGE_LEAF: join(dir, "leaf.json"), FOLIAGE_POLICY: join(dir, "absent-policy.json"), FOLIAGE_PUBLISHED: publications };
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" }).trim();
  const cli = (...args: string[]) => execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    git("init", "--quiet", "--initial-branch=main");
    for (const title of ["test: prepare readable public leaf protocol", "test: inspect local renderer transport", "test: retain unshared protocol evidence"]) {
      await writeFile(join(repo, "protocol.txt"), `${title}\n`); git("add", "protocol.txt");
      git("-c", "user.name=Portfolio HTTP protocol", "-c", `user.email=${identity}`, "commit", "--quiet", "-m", title);
    }
    cli("apps/leaf/intake.mjs", "--repo", repo, "--identity", identity, "--subject", "Portfolio HTTP protocol", "--id", id, "--out", env.FOLIAGE_LEAF);
    const parsed = parseLeafDocument(JSON.parse(await readFile(env.FOLIAGE_LEAF, "utf8"))); assert.ok(parsed.ok);
    const [privateRecord, first, second] = parsed.leaf.leaflets; assert.ok(privateRecord && first && second);
    for (const record of [first, second]) cli("apps/leaf/share.mjs", "share", record.id, "--as", "public", "--leaf", env.FOLIAGE_LEAF);
    const saved = JSON.parse(await readFile(env.FOLIAGE_LEAF, "utf8"));
    await writeFile(env.FOLIAGE_LEAF, JSON.stringify({ ...saved, curation: { featured: [privateRecord.id, second.id, first.id] } }));
    const privateBytes = await readFile(env.FOLIAGE_LEAF, "utf8");
    const review = await loadManageState(env); assert.equal(review.kind, "ready"); if (review.kind !== "ready") return;
    assert.deepEqual(review.preview.leaf.leaflets.map(record => record.id), [second.id, first.id]);
    const artifactPath = join(publications, `${id}.published.json`);
    await writeFile(artifactPath, JSON.stringify(toArtifactJson(review.preview)));
    const bundle = await checkPortfolioLeafBundle();
    const load = { ok: true as const, id, document: review.preview, source: { path: artifactPath, bytes: 1, artifactDigest: "unused-renderer-receipt", readAt: new Date().toISOString() } };
    const fallback = renderPublishedPage(load);
    assert.match(fallback, /class="lp-portfolio lp-fallback" data-record-count="2"/);
    assert.doesNotMatch(fallback, /<script\b|Interactive leaf unavailable|Pause motion|data-portfolio-order disabled|data-portfolio-canvas|lp-source-legend/);
    assert.doesNotMatch(publicHeaders()["content-security-policy"]!, /script-src/);
    const empty = renderPublishedPage({ ...load, document: { ...review.preview, leaf: { ...review.preview.leaf, leaflets: [] } } }, { enhancePortfolio: true });
    assert.doesNotMatch(empty, /portfolio-leaf\.bundle\.js|data-leaf-portfolio/);
    const publishedRecord = review.preview.leaf.leaflets[0]!;
    const single = renderPublishedPage({ ...load, document: { ...review.preview, leaf: { ...review.preview.leaf, leaflets: [publishedRecord] } } });
    assert.match(single, /class="lp-portfolio lp-fallback" data-record-count="1"/);
    assert.ok(single.includes(`data-record-id="${publishedRecord.id}"`));

    child = spawn(process.execPath, ["apps/canopy/server.mjs"], { cwd: root, env: { ...env, FOLIAGE_TREE: "", PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; child.stdout!.on("data", chunk => { log += String(chunk); }); child.stderr!.on("data", chunk => { log += String(chunk); });
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { clearInterval(poll); reject(new Error(`Server did not bind: ${log}`)); }, 15_000);
      const poll = setInterval(() => {
        const address = /Host allow-list: (127\.0\.0\.1:\d+)/.exec(log)?.[1];
        if (address) { clearTimeout(timer); clearInterval(poll); resolve(`http://${address}`); }
        else if (child!.exitCode !== null) { clearTimeout(timer); clearInterval(poll); reject(new Error(log)); }
      }, 20);
    });
    const response = await fetch(`${origin}/leaf/${id}`); assert.equal(response.status, 200);
    const html = await response.text(), csp = response.headers.get("content-security-policy")!;
    const ids = [...html.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids, [second.id, first.id]); assert.equal(new Set(ids).size, 2);
    assert.ok(html.includes(first.title)); assert.ok(html.includes(second.title));
    assert.ok(!html.includes(privateRecord.id)); assert.ok(!html.includes(privateRecord.title));
    assert.doesNotMatch(html, /data-featured-order="[0-9]|data-leading="true"|Most notable|GitHub|(?:src|href)="https?:\/\//);
    assert.match(html, /data-date-purpose="observed"/);
    for (const record of review.preview.leaf.leaflets) assert.ok(html.includes(`data-date="${record.provenance!.observedAt}" data-date-kind="observed"`));
    assert.equal(html.includes('src="/portfolio-leaf.bundle.js"'), bundle.ok);
    assert.equal(csp.includes("script-src 'self'"), bundle.ok);
    assert.match(csp, /default-src 'none'/); assert.match(csp, /form-action 'none'/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:/);
    if (bundle.ok) assert.match(csp, /connect-src 'none'/);
    const head = await fetch(`${origin}/leaf/${id}`, { method: "HEAD" }); assert.equal(head.headers.get("content-security-policy"), csp); assert.equal(await head.text(), "");
    for (const name of ["portfolio-leaf.css", "roles.css", "controls.css"]) {
      const asset = await fetch(`${origin}/${name}`); assert.equal(asset.status, 200); assert.match(asset.headers.get("content-type")!, /text\/css/);
      assert.doesNotMatch(asset.headers.get("content-security-policy")!, /script-src/);
    }
    const js = await fetch(`${origin}/portfolio-leaf.bundle.js`); assert.equal(js.status, bundle.ok ? 200 : 503);
    if (bundle.ok) { assert.match(js.headers.get("content-type")!, /javascript/); assert.equal(await js.text(), await readFile(bundle.path, "utf8")); }
    const absent = await fetch(`${origin}/leaf/not-published`); assert.equal(absent.status, 404); assert.doesNotMatch(absent.headers.get("content-security-policy")!, /script-src/);
    assert.doesNotMatch(await absent.text(), /<script\b|data-record-id/);

    await writeFile(join(dir, "tree.json"), JSON.stringify({ id: "export-protocol", company: "Static export protocol", leaves: ["leaf.json"] }));
    const out = join(dir, "export");
    execFileSync(process.execPath, ["apps/canopy/export.mjs", "--out", out], { cwd: root, env: { ...env, FOLIAGE_TREE: join(dir, "tree.json") }, encoding: "utf8", timeout: 20_000 });
    const exported = await readFile(join(out, "leaf", `${id}.html`), "utf8");
    assert.deepEqual([...exported.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]), ids);
    assert.match(exported, /href="\.\.\/portfolio-leaf\.css"/); assert.doesNotMatch(exported, /(?:src|href)="\/[^/]/);
    assert.equal(exported.includes('src="../portfolio-leaf.bundle.js"'), bundle.ok);
    assert.equal(await readFile(join(out, "portfolio-leaf.css"), "utf8"), await readFile(fileURLToPath(import.meta.resolve("@foliage/ui/portfolio-leaf.css")), "utf8"));
    if (bundle.ok) assert.equal(await readFile(join(out, "portfolio-leaf.bundle.js"), "utf8"), await readFile(bundle.path, "utf8"));
    const config = JSON.parse(await readFile(join(out, "vercel.json"), "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    assert.doesNotMatch(config.headers[0]!.headers.find(header => header.key === "content-security-policy")!.value, /script-src/);
    assert.equal(config.headers.some(rule => rule.source === `/leaf/${id}.html` && rule.headers.some(header => header.key === "content-security-policy" && header.value.includes("script-src 'self'"))), bundle.ok);
    assert.equal(await readFile(env.FOLIAGE_LEAF, "utf8"), privateBytes, "rendering, sorting affordances and static export grant no private write or publication authority");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(dir, { recursive: true, force: true });
  }
});
