import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPortfolioLeafBundle } from "@foliage/ui/portfolio-leaf-bundle";

const SERVER = fileURLToPath(new URL("../manage-server.mjs", import.meta.url));
const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      probe.close(() => resolve(address.port));
    });
  });
}

/** Bound every request, including mutation responses and startup probes. */
const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: init?.signal ?? AbortSignal.timeout(5_000),
});

async function waitForHome(child: ChildProcess, origin: string, output: () => string, timeoutMs = 15_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`manager exited before serving: ${output()}`);
    }
    try { return await boundedFetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) }); }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error(`manager did not start: ${output()}`);
}

/** The completion promise must be registered immediately after spawning. */
async function stopChild(child: ChildProcess, exited: Promise<number | null>): Promise<void> {
  child.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("manager did not exit after SIGKILL")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

function field(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  assert.notEqual(match, null, `${name} field was not rendered`);
  return match?.[1] ?? "";
}

test("a direct manager serves the publication controls when workspace assets are absent", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-manage-no-workspace-"));
  roots.push(dir);
  const app = join(dir, "canopy");
  await mkdir(app);
  await copyFile(SERVER, join(app, "manage-server.mjs"));
  await symlink(join(dirname(SERVER), "src"), join(app, "src"));
  await symlink(join(dirname(SERVER), "node_modules"), join(app, "node_modules"));
  const leaf = join(dir, "leaf.json");
  await writeFile(leaf, `${JSON.stringify({ id: "protocol-only", subject: "Protocol only", leaflets: [] })}\n`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(app, "manage-server.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), FOLIAGE_HOSTED_ORIGIN: "",
      FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: join(dir, "policy.json"), FOLIAGE_PUBLISHED: join(dir, "published") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  try {
    await waitForHome(child, origin, () => output);
    const response = await boundedFetch(`${origin}/workspace`);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /script-src/);
    const html = await response.text();
    assert.match(html, /Hosting view unavailable/);
    assert.match(html, /action="\/publish"/);
    assert.doesNotMatch(html, /Loading your publication workspace|src="\/workspace\.js"/);
    const asset = await boundedFetch(`${origin}/workspace.js`);
    assert.equal(asset.status, 404);
    assert.match(await asset.text(), /Open \/ for publication controls/);
    const portfolioCss = await boundedFetch(`${origin}/portfolio-leaf.css`);
    assert.equal(portfolioCss.status, 200);
    assert.match(portfolioCss.headers.get("content-type") ?? "", /text\/css/);
    assert.ok((await portfolioCss.text()).length > 0);
    const bundle = await checkPortfolioLeafBundle();
    const portfolioJs = await boundedFetch(`${origin}/portfolio-leaf.bundle.js`);
    assert.equal(portfolioJs.status, bundle.ok ? 200 : 503);
    if (bundle.ok) {
      assert.match(portfolioJs.headers.get("content-type") ?? "", /text\/javascript/);
      assert.ok((await portfolioJs.text()).length > 0);
    }
  } finally {
    await stopChild(child, exited);
  }
});

test("a stale Prepare submission keeps its tab and portfolio scope while loading fresh state", { timeout: 25_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-manage-prepare-recovery-"));
  roots.push(dir);
  const app = join(dir, "canopy");
  await mkdir(join(app, "public"), { recursive: true });
  await copyFile(SERVER, join(app, "manage-server.mjs"));
  await symlink(join(dirname(SERVER), "src"), join(app, "src"));
  await symlink(join(dirname(SERVER), "node_modules"), join(app, "node_modules"));
  // These files only enable the workspace shell; the test never executes browser assets.
  await writeFile(join(app, "public", "workspace.js"), "// workspace test asset\n");
  await writeFile(join(app, "public", "workspace.css"), "/* workspace test asset */\n");
  const leaf = join(dir, "leaf.json");
  const policy = join(dir, "policy.json");
  await writeFile(leaf, `${JSON.stringify({ id: "protocol-only", subject: "Protocol only", leaflets: [] })}\n`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(app, "manage-server.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), FOLIAGE_HOSTED_ORIGIN: "",
      FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policy, FOLIAGE_PUBLISHED: join(dir, "published") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });

  type ReadyWorkspace = { csrf: string; portfolioDigest: string; state: { kind: "ready"; includePortfolio: boolean; sourceDigest: string; policyDigest: string } };
  async function workspaceState(): Promise<ReadyWorkspace> {
    const response = await boundedFetch(`${origin}/workspace/state?includePortfolio=on`);
    assert.equal(response.status, 200);
    const payload = await response.json() as ReadyWorkspace;
    assert.equal(payload.state.kind, "ready");
    assert.equal(payload.state.includePortfolio, true);
    return payload;
  }
  async function submit(fields: ReadyWorkspace, sourceDigest: string, policyDigest: string): Promise<string> {
    const response = await boundedFetch(`${origin}/publish?workspace=1`, {
      method: "POST", headers: { origin },
      body: new URLSearchParams({ csrf: fields.csrf, sourceDigest, policyDigest,
        portfolioDigest: fields.portfolioDigest, includePortfolio: "on", confirm: "protocol-only" }),
    });
    assert.equal(response.status, 409);
    const html = await response.text();
    assert.match(html, /data-initial-section="prepare"/);
    assert.match(html, /data-include-portfolio="on"/);
    assert.match(html, /src="\/workspace\.js"/);
    return html;
  }

  try {
    await waitForHome(child, origin, () => output);
    const initialPage = await boundedFetch(`${origin}/workspace?includePortfolio=on`);
    assert.equal(initialPage.status, 200);
    const initialHtml = await initialPage.text();
    assert.match(initialHtml, /data-initial-section="publications"/);
    assert.match(initialHtml, /data-include-portfolio="on"/);

    const initial = await workspaceState();
    const staleSource = await submit(initial, `sha256:${"0".repeat(64)}`, initial.state.policyDigest);
    assert.match(staleSource, /Local leaf changed/);

    await writeFile(policy, `${JSON.stringify({ rules: [] })}\n`);
    const fresh = await workspaceState();
    assert.notEqual(fresh.state.policyDigest, initial.state.policyDigest);
    const stalePolicy = await submit(fresh, fresh.state.sourceDigest, initial.state.policyDigest);
    assert.match(stalePolicy, /Publication rules changed/);
    assert.equal((await workspaceState()).state.policyDigest, fresh.state.policyDigest);
  } finally {
    await stopChild(child, exited);
  }
});

test("the real manager enforces its private origin and binds a release to the rendered bytes", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-manage-server-"));
  roots.push(dir);
  const leaf = join(dir, "leaf.json");
  const published = join(dir, "published");
  await writeFile(leaf, `${JSON.stringify({ id: "manager-test", subject: "Test subject", leaflets: [] })}\n`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      FOLIAGE_HOSTED_ORIGIN: "",
      FOLIAGE_LADYBUG: join(dir,"ladybug.json"),
      FOLIAGE_LEAF: leaf,
      FOLIAGE_POLICY: join(dir, "absent-policy.json"),
      FOLIAGE_PUBLISHED: published,
      FOLIAGE_PUBLIC_ORIGIN: "https://portfolio.example",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  try {
    const home = await waitForHome(child, origin, () => stderr);
    assert.equal(home?.status, 200);
    assert.equal(home?.headers.get("x-robots-tag"), "noindex, noarchive, nosnippet, noimageindex");
    assert.match(home?.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const html = await home?.text() ?? "";
    const csrf = field(html, "csrf");
    const assessmentPage = await boundedFetch(`${origin}/ladybug`);
    const assessmentHtml = await assessmentPage.text();
    const assessmentRevision = field(assessmentHtml, "workspaceDigest");
    for (const expected of [assessmentRevision, `sha256:${"0".repeat(64)}`]) {
      const refused = await boundedFetch(`${origin}/ladybug/import`, {
        method: "POST", headers: { origin }, body: new URLSearchParams({ csrf, workspaceDigest: expected, transfer: "{", id: "manager-test", subject: "Test subject" }),
      });
      assert.equal(refused.status, 409);
      assert.match(refused.headers.get("content-type") ?? "", /text\/html/);
      const recovered = await refused.text();
      assert.match(recovered, /role="alert" tabindex="-1" autofocus/);
      assert.match(recovered, /<details class="ladybug-intro" open>/);
      assert.match(recovered, /<textarea[^>]*id="workflow-import"[^>]*>\{<\/textarea>/);
      assert.equal(field(recovered, "workspaceDigest"), expected, "refusal must not rebase a stale submission onto the current workspace");
    }
    const sourceText = (await readFile(new URL("../../../docs/CANOPY-CLOUD.md", import.meta.url), "utf8")).split("\n").find(line => line.startsWith("Canopy Cloud is"))!;
    const refusedSave = await boundedFetch(`${origin}/ladybug/save`, { method: "POST", headers: { origin }, body: new URLSearchParams({ csrf, workspaceDigest: assessmentRevision, id: "manager-test", subject: " ", evidence: sourceText, knownWork: "", market: "", correction: "" }) });
    assert.equal(refusedSave.status, 409);
    const savedForm = await refusedSave.text();
    const retainedEvidence = /<textarea[^>]*id="packet-evidence"[^>]*>([\s\S]*?)<\/textarea>/.exec(savedForm)?.[1] ?? "";
    assert.equal(retainedEvidence.replace(/&quot;/g, '\"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), sourceText);
    await assert.rejects(readFile(join(dir, "ladybug.json")), { code: "ENOENT" });

    const digest = field(html, "sourceDigest");
    const initialPolicyDigest = field(html, "policyDigest");
    assert.doesNotMatch(html, /Open public leaf/);
    const hosted = await boundedFetch(`${origin}/hosted`);
    assert.equal(hosted.status, 200); assert.match(await hosted.text(), /Hosting not configured/);
    const missingPreview = await boundedFetch(`${origin}/hosted/preview`);
    assert.equal(missingPreview.status, 404);
    assert.match(missingPreview.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await missingPreview.text(), /Preview unavailable\. Prepare again\.|href="\/hosted"/);
    for (const asset of ["controls.css", "foliage.css", "roles.css", "published.css", "workspace-shell.css"]) assert.equal((await boundedFetch(`${origin}/${asset}`)).status, 200);
    const workspace = await boundedFetch(`${origin}/workspace`);
    assert.equal(workspace.status,200);
    assert.match(await workspace.text(), /data-face="night"/);
    const workspaceState = await boundedFetch(`${origin}/workspace/state?includePortfolio=on`);
    assert.equal(workspaceState.status,200);
    const workspacePayload = await workspaceState.json() as {state:{kind:string;includePortfolio:boolean};portfolioDigest:string;previewArtifact:unknown};
    assert.equal(workspacePayload.state.kind,'ready');
    assert.equal(workspacePayload.state.includePortfolio,true);
    assert.match(workspacePayload.portfolioDigest,/^sha256:[a-f0-9]{64}$/);
    assert.ok(workspacePayload.previewArtifact);
    const foreignConnect = await boundedFetch(`${origin}/hosted/connect`, { method: "POST", headers: { origin: "https://foreign.invalid" }, body: new URLSearchParams({ csrf, email: "contract@example.invalid", password: "contract-only" }) });
    assert.equal(foreignConnect.status, 403);
    const repeated = await boundedFetch(`${origin}/hosted/connect`, { method: "POST", headers: { origin }, body: new URLSearchParams([["csrf", csrf], ["email", "contract@example.invalid"], ["email", "another@example.invalid"]]) });
    assert.equal(repeated.status, 400);


    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/", headers: { host: "example.invalid" }, signal: AbortSignal.timeout(5_000) }, (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      });
      req.once("error", reject);
      req.end();
    });
    assert.equal(wrongHostStatus, 421);

    const crossOrigin = await boundedFetch(`${origin}/publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://example.invalid" },
      body: new URLSearchParams({ csrf, sourceDigest: digest, policyDigest: initialPolicyDigest, confirm: "manager-test" }),
    });
    assert.equal(crossOrigin.status, 403);

    const stale = await boundedFetch(`${origin}/publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ csrf, sourceDigest: `sha256:${"0".repeat(64)}`, policyDigest: initialPolicyDigest, confirm: "manager-test" }),
    });
    assert.equal(stale.status, 409);
    assert.match(await stale.text(), /<strong>Local leaf changed<\/strong>/);

    await writeFile(join(dir, "absent-policy.json"), `${JSON.stringify({ rules: [] })}\n`);
    const stalePolicy = await boundedFetch(`${origin}/publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ csrf, sourceDigest: digest, policyDigest: initialPolicyDigest, confirm: "manager-test" }),
    });
    assert.equal(stalePolicy.status, 409);
    assert.match(await stalePolicy.text(), /<strong>Publication rules changed<\/strong>/);

    const currentHome = await boundedFetch(`${origin}/`);
    const currentHtml = await currentHome.text();
    const policyDigest = field(currentHtml, "policyDigest");

    const release = await boundedFetch(`${origin}/publish`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ csrf, sourceDigest: digest, policyDigest, confirm: "manager-test" }),
    });
    assert.equal(release.status, 303);
    const publishLocation = release.headers.get("location") ?? "";
    assert.match(publishLocation, /^\/\?notice=[0-9a-f-]+$/);

    const forgedNotice = await boundedFetch(`${origin}/?notice=published`);
    assert.doesNotMatch(await forgedNotice.text(), /<strong>Published<\/strong>/);

    const live = await boundedFetch(`${origin}${publishLocation}`);
    const liveHtml = await live.text();
    assert.match(liveHtml, /<strong>Published<\/strong>/);
    assert.match(liveHtml, /href="https:\/\/portfolio\.example\/leaf\/manager-test"/);
    const publicationDigest = field(liveHtml, "publicationDigest");

    assert.doesNotMatch(await (await boundedFetch(`${origin}${publishLocation}`)).text(), /<strong>Published<\/strong>/);

    // A replacement decision is bound to the exact public artifact shown with the diff. A valid
    // concurrent replacement that changes only its timestamp must still invalidate that form.
    const target = join(published, "manager-test.published.json");
    const originalPublicBytes = await readFile(target);
    await writeFile(leaf, `${JSON.stringify({ id: "manager-test", subject: "Updated subject", leaflets: [] })}\n`);
    const replacementHtml = await (await boundedFetch(`${origin}/`)).text();
    const replacementSourceDigest = field(replacementHtml, "sourceDigest");
    const replacementPolicyDigest = field(replacementHtml, "policyDigest");
    const reviewedPublicDigest = field(replacementHtml, "publicDigest");
    assert.equal(reviewedPublicDigest, publicationDigest);

    const concurrentlyReplaced = JSON.parse(originalPublicBytes.toString("utf8")) as Record<string, unknown>;
    concurrentlyReplaced["publishedAt"] = "2026-09-04T23:59:59.000Z";
    await writeFile(target, `${JSON.stringify(concurrentlyReplaced, null, 2)}\n`);
    const staleReplacement = await boundedFetch(`${origin}/publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({
        csrf,
        sourceDigest: replacementSourceDigest,
        policyDigest: replacementPolicyDigest,
        publicDigest: reviewedPublicDigest,
        republish: "true",
        confirm: "manager-test",
      }),
    });
    assert.equal(staleReplacement.status, 409);
    assert.match(await staleReplacement.text(), /<strong>Public leaf changed<\/strong>/);
    await writeFile(target, originalPublicBytes);

    await writeFile(leaf, "{broken", "utf8");
    const orphanedHtml = await (await boundedFetch(`${origin}/`)).text();
    assert.match(orphanedHtml, /No local leaf is ready/);
    assert.match(orphanedHtml, /id="publications-h">Publications</);
    assert.doesNotMatch(orphanedHtml, /Nothing has crossed this machine/);
    assert.equal(field(orphanedHtml, "publicationDigest"), publicationDigest);

    const withdraw = await boundedFetch(`${origin}/withdraw`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ csrf, id: "manager-test", publicationDigest, confirm: "manager-test" }),
    });
    assert.equal(withdraw.status, 303);
    assert.match(withdraw.headers.get("location") ?? "", /^\/\?notice=[0-9a-f-]+$/);
  } finally {
    await stopChild(child, exited);
  }
});

test("the manager refuses a non-loopback bind and cleanup handles an already-exited child", { timeout: 5_000 }, async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HOST: "0.0.0.0", PORT: String(await freePort()) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    const code = await exited;
    assert.equal(code, 2);
    assert.match(stderr, /may bind only 127\.0\.0\.1 or ::1/);
    await assert.rejects(waitForHome(child, "http://127.0.0.1:1", () => stderr, 100), /manager exited before serving/);
  } finally { await stopChild(child, exited); }
});
