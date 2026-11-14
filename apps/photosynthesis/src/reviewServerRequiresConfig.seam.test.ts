/**
 * F-025 — `apps/photosynthesis/review-server.mjs` is the THIRD independent writer found
 * carrying this exact shape: `HARVEST`/`LEAF` (:94-97) default a genuinely UNSET
 * `FOLIAGE_HARVEST`/`FOLIAGE_LEAF` to well-known paths — `HARVEST` beside this app, `LEAF` one
 * directory over at `apps/leaf/leaf.json`, the SAME file `apps/leaf/server.mjs`'s own F-025 fix
 * already protects. This server is launched bare with NO env vars at all by
 * `apps/photosynthesis/package.json`'s own `review` script, by `tools/verify/surfaces.mjs`
 * (which DOES set both, safely), and its next-step is PRINTED by `photosynthesis.mjs` naming
 * only `FOLIAGE_HARVEST` — `FOLIAGE_LEAF` was never mentioned anywhere an operator would read it.
 *
 * FIXED THE SAME WAY, THROUGH THE SAME SHARED RULE: `POST /decide` and `POST /promote` now call
 * `writeGuard` (`@foliage/photosynthesis`) — the ONE pure function `apps/leaf/server.mjs`'s own
 * `refuseIfUnconfigured` was refactored to consume too, so this is not a third implementation of
 * the check, only a third CALLER of it.
 *
 * WHY THIS FILE DOES NOT TOUCH `apps/leaf/leaf.json`, review-server's own default `LEAF` path.
 * `apps/leaf/src/promoteRequiresDoc.seam.test.ts` already plants and restores sentinels at that
 * EXACT physical path, and `node --test` runs different test FILES concurrently by default — two
 * files racing to write and restore the same real file would be flaky by construction, not by
 * accident. So every scenario below that needs `FOLIAGE_LEAF` unset proves the refusal (the 409,
 * the named variable) without also asserting on the shared default leaf's bytes; the code-flow
 * argument is sufic on its own here — `refuseIfUnconfigured` returns before `promote()` (the
 * only thing that can touch the leaf) is ever called, and a 409 rather than 303 is the same
 * observable proof `apps/leaf`'s own tests use — sufficient on its own. `HARVEST`'s own default
 * (`apps/photosynthesis/leaf.harvest.json`) is unique to this app, so those scenarios DO plant
 * and verify a real sentinel there.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../review-server.mjs", import.meta.url));
const DEFAULT_HARVEST_PATH = fileURLToPath(new URL("../leaf.harvest.json", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-photosynthesis-f025-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/** A minimal, real, valid harvest document — the shape `parseHarvestDocument` (this app's own,
 * `apps/photosynthesis/src/harvestDocument.ts`) requires. */
function harvestDoc(candidateId: string): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      subject: "Sentinel Subject",
      identity: "sentinel@example.test",
      sources: ["/tmp/sentinel-repo"],
      gatheredAt: "2026-08-29T00:00:00.000Z",
      candidates: [
        {
          id: candidateId,
          drafted: { title: "Sentinel candidate", summary: "A stale candidate standing in for whatever was left." },
          evidence: [{ source: "git", ref: "a".repeat(40), excerpt: "feat: sentinel" }],
          provenance: { method: "deterministic" },
          status: "proposed",
        },
      ],
    },
    null,
    2,
  );
}

function leafDoc(subject: string, id: string): string {
  return JSON.stringify({ id, subject, leaflets: [] }, null, 2);
}

/**
 * Run `body` with a KNOWN sentinel harvest document planted at the real, app-unique
 * `DEFAULT_HARVEST_PATH`, then assert it is byte-for-byte untouched — restoring whatever was
 * there before, even on failure. Safe against cross-file races: nothing else in this repository
 * touches `apps/photosynthesis/leaf.harvest.json`.
 */
async function withUntouchedDefaultHarvest(content: string, body: () => Promise<void>): Promise<void> {
  let hadBackup = false;
  let backup = "";
  try {
    backup = await readFile(DEFAULT_HARVEST_PATH, "utf8");
    hadBackup = true;
  } catch {
    hadBackup = false; // ordinarily nothing is there — it is gitignored
  }
  try {
    await writeFile(DEFAULT_HARVEST_PATH, content, "utf8");
    await body();
    const after = await readFile(DEFAULT_HARVEST_PATH, "utf8");
    assert.equal(after, content, "the default-path harvest document must be byte-for-byte untouched");
  } finally {
    if (hadBackup) await writeFile(DEFAULT_HARVEST_PATH, backup, "utf8");
    else await rm(DEFAULT_HARVEST_PATH, { force: true });
  }
}

/** A port nothing is listening on — see `apps/leaf`'s own `freePort` for the race it avoids. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => reject(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => resolve(port));
    });
  });
}

interface Response {
  readonly status: number;
  readonly body: string;
}

interface Running {
  get(path: string): Promise<Response>;
  /** Scrapes the per-process CSRF token out of a freshly-rendered page — the only way to learn
   * it, exactly as a real browser would via the hidden form field. */
  csrfToken(): Promise<string>;
  post(path: string, fields: Record<string, string>, csrf: string, origin?: string): Promise<Response>;
  /** What the server has printed to stdout so far — its start-up log. */
  stdout(): string;
}

/**
 * Start the real `review-server.mjs` with the given environment — inheriting `process.env` for
 * everything ELSE a real launch needs, but with `FOLIAGE_HARVEST`/`FOLIAGE_LEAF` deleted first,
 * then `env`'s own values re-applied. Same discipline as `apps/leaf`'s own `withBareServer`, and
 * for the identical reason: the test's meaning must not depend on whatever the shell happens to
 * export.
 */
async function withReviewServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const childEnv: Record<string, string | undefined> = { ...process.env };
  delete childEnv["FOLIAGE_HARVEST"];
  delete childEnv["FOLIAGE_LEAF"];
  const child = spawn(process.execPath, [SERVER], {
    env: { ...childEnv, ...env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  let stdout = "";
  child.stdout?.on("data", (b: Buffer) => {
    stdout += b.toString();
  });
  let exited: string | null = null;
  child.on("exit", (code, signal) => {
    exited = `exit code ${String(code)} signal ${String(signal)}`;
  });

  const origin = `http://127.0.0.1:${port}`;
  const get = async (path: string): Promise<Response> => {
    const res = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(4_000) });
    return { status: res.status, body: await res.text() };
  };
  const csrfToken = async (): Promise<string> => {
    const page = await get("/");
    const m = /name="csrf" value="([^"]+)"/.exec(page.body);
    assert.ok(m, `no CSRF field found on the rendered page:\n${page.body.slice(0, 500)}`);
    return m[1] as string;
  };
  const post = async (
    path: string,
    fields: Record<string, string>,
    csrf: string,
    from = origin,
  ): Promise<Response> => {
    const res = await fetch(origin + path, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: from },
      body: new URLSearchParams({ ...fields, csrf }).toString(),
    });
    return { status: res.status, body: await res.text() };
  };

  try {
    const deadline = Date.now() + 10_000;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`server did not answer within 10000ms: ${lastError}\nstderr:\n${stderr}`);
      }
      try {
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get, csrfToken, post, stdout: () => stdout });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

test("F-025 (review-server): reads stay on the well-known default even with FOLIAGE_HARVEST unset", async () => {
  await withUntouchedDefaultHarvest(harvestDoc("sentinel-read"), async () => {
    await withReviewServer({}, async (s) => {
      const home = await s.get("/");
      assert.equal(home.status, 200, `GET / must still work bare — reads are unaffected:\n${home.body}`);
      assert.ok(home.body.includes("Sentinel candidate"), "the default-path harvest must render, unchanged");
    });
  });
});

test("historical review server refuses an integrated harvest BY NAME (409, not 500), with one bounded route to /review", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  const currentQueueShape = {
    schemaVersion: 1,
    candidates: [{
      id: "candidate:current-format-probe",
      title: "Protocol fixture",
      extractor: "git-cluster",
      review: { state: "candidate" },
    }],
  };
  const original = JSON.stringify(currentQueueShape);
  await writeFile(harvestPath, original, "utf8");
  await withReviewServer({ FOLIAGE_HARVEST: harvestPath }, async s => {
    const page = await s.get("/");
    assert.equal(page.status, 409, "a queue in the current format is a named refusal, not a server error");
    assert.match(page.body, /<h1>Review this queue in foliage up<\/h1>/);
    assert.match(page.body, /in the current format/);
    assert.match(page.body, /run <code>node foliage\.mjs up<\/code>, then open <code>\/review<\/code>/);
    // Its action is the current app. A Back to "/" would only land on this same refusal.
    assert.doesNotMatch(page.body, />Back</);
    assert.doesNotMatch(page.body, /Review unavailable/);
    const error = /class="rv-error" role="alert">([^<]+)<\/p>/.exec(page.body)?.[1] ?? "";
    assert.ok(error.length > 0 && error.length < 300, "the actionable error must remain bounded");
    assert.doesNotMatch(page.body, /candidates\[0\]\./);
  });
  assert.equal(await readFile(harvestPath, "utf8"), original);
});

test("an EMPTY queue in the current format is refused by name too, on the page and at start-up", async () => {
  // What a re-harvest that drafted nothing writes: the document carries the current binding
  // fields and no candidate to recognise the format by.
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  const original = JSON.stringify({ subject: "Sentinel Subject", leafId: "leaf:sentinel", repo: "/tmp/sentinel-repo", candidates: [] });
  await writeFile(harvestPath, original, "utf8");
  await withReviewServer({ FOLIAGE_HARVEST: harvestPath }, async s => {
    const page = await s.get("/");
    assert.equal(page.status, 409, page.body);
    assert.match(page.body, /<h1>Review this queue in foliage up<\/h1>/);
    assert.match(page.body, /run <code>node foliage\.mjs up<\/code>, then open <code>\/review<\/code>/);
    assert.doesNotMatch(page.body, />Back</);
    assert.doesNotMatch(page.body, /Review unavailable|harvest invalid|unknown key/);
    for (const deadline = Date.now() + 4_000; !/promotion target/.test(s.stdout()) && Date.now() < deadline;) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.match(s.stdout(), /in the current format\. Review it in the current app: run node foliage\.mjs up, then open \/review\./);
    assert.doesNotMatch(s.stdout(), /harvest invalid/);
  });
  assert.equal(await readFile(harvestPath, "utf8"), original);
});

test("POST /promote and POST /decide on a current-format queue get the same named 409, and write nothing", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  const leafPath = join(dir, "leaf.json");
  const leaf = leafDoc("Sentinel Subject", "leaf:sentinel");
  await writeFile(leafPath, leaf, "utf8");
  // The queue page is the refusal itself, so the token comes from a legacy queue served first.
  // The server reads the document on every request, as it does when a re-harvest replaces it.
  await writeFile(harvestPath, harvestDoc("token-source"), "utf8");
  const current = JSON.stringify({
    subject: "Sentinel Subject", leafId: "leaf:sentinel", repo: "/tmp/sentinel-repo",
    candidates: [{ id: "candidate:current-format-probe", title: "Protocol fixture", extractor: "git-cluster", review: { state: "approved" } }],
  });
  await withReviewServer({ FOLIAGE_HARVEST: harvestPath, FOLIAGE_LEAF: leafPath }, async (s) => {
    const csrf = await s.csrfToken();
    await writeFile(harvestPath, current, "utf8");
    const routes: ReadonlyArray<[string, Record<string, string>]> = [
      ["/promote", {}],
      ["/decide", { id: "candidate:current-format-probe", verdict: "approved" }],
    ];
    for (const [path, fields] of routes) {
      const res = await s.post(path, fields, csrf);
      assert.equal(res.status, 409, `${path}:\n${res.body}`);
      assert.match(res.body, /<h1>Review this queue in foliage up<\/h1>/, path);
      assert.match(res.body, /run <code>node foliage\.mjs up<\/code>, then open <code>\/review<\/code>/, path);
      assert.doesNotMatch(res.body, /Promotion refused|Review unavailable|harvest invalid|>Back</, path);
    }
  });
  assert.equal(await readFile(harvestPath, "utf8"), current);
  assert.equal(await readFile(leafPath, "utf8"), leaf);
});

test("F-025 (review-server): POST /decide with FOLIAGE_HARVEST unset refuses by name, and the default harvest document is untouched", async () => {
  await withUntouchedDefaultHarvest(harvestDoc("sentinel-decide"), async () => {
    await withReviewServer({}, async (s) => {
      const csrf = await s.csrfToken();
      const res = await s.post("/decide", { id: "sentinel-decide", verdict: "approved" }, csrf);
      assert.equal(res.status, 409, `a decide with FOLIAGE_HARVEST unset must refuse:\n${res.body}`);
      assert.match(res.body, /FOLIAGE_HARVEST/, `must name the missing variable:\n${res.body}`);
      assert.match(res.body, /not set/, "must say plainly that it is unset");
    });
  });
});

test("F-025 (review-server): POST /promote with FOLIAGE_LEAF unset (FOLIAGE_HARVEST set) refuses by name before promote() ever runs", async () => {
  const garden = await tempDir();
  const harvestPath = join(garden, "harvest.json");
  await writeFile(harvestPath, harvestDoc("sentinel-promote-noleaf"), "utf8");

  await withReviewServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const csrf = await s.csrfToken();
    const res = await s.post("/promote", {}, csrf);
    assert.equal(res.status, 409, `a promote with FOLIAGE_LEAF unset must refuse:\n${res.body}`);
    assert.match(res.body, /FOLIAGE_LEAF/, `must name the missing variable:\n${res.body}`);
    assert.match(res.body, /not set/, "must say plainly that it is unset");
  });

  // The REAL, explicitly-named harvest is untouched too — nothing was promoted from it, and
  // its one candidate is still exactly "proposed".
  const harvestAfter = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(harvestAfter.candidates[0].status, "proposed", "the harvest itself is unaffected by the refused promote");
});

test("F-025 (review-server): POST /promote with FOLIAGE_HARVEST unset (FOLIAGE_LEAF set) refuses by name, and the default harvest is untouched", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  await writeFile(leafPath, leafDoc("Real Subject", "leaf:f025-review-server"), "utf8");

  await withUntouchedDefaultHarvest(harvestDoc("sentinel-promote-noharvest"), async () => {
    await withReviewServer({ FOLIAGE_LEAF: leafPath }, async (s) => {
      const csrf = await s.csrfToken();
      const res = await s.post("/promote", {}, csrf);
      assert.equal(res.status, 409, `a promote with FOLIAGE_HARVEST unset must refuse:\n${res.body}`);
      assert.match(res.body, /FOLIAGE_HARVEST/, `must name the missing variable:\n${res.body}`);
    });
  });

  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 0, "the real target leaf must be untouched — nothing was promoted into it");
});

test("F-025 (review-server) control: POST /decide and POST /promote WITH both env vars set still succeed", async () => {
  const garden = await tempDir();
  const harvestPath = join(garden, "harvest.json");
  const leafPath = join(garden, "leaf.json");
  await writeFile(harvestPath, harvestDoc("sentinel-control"), "utf8");
  await writeFile(leafPath, leafDoc("Real Subject", "leaf:f025-review-server-control"), "utf8");

  await withReviewServer({ FOLIAGE_HARVEST: harvestPath, FOLIAGE_LEAF: leafPath }, async (s) => {
    const csrf1 = await s.csrfToken();
    const decided = await s.post("/decide", { id: "sentinel-control", verdict: "approved" }, csrf1);
    assert.equal(decided.status, 303, `decide with both vars set must succeed:\n${decided.body}`);

    const csrf2 = await s.csrfToken();
    const promoted = await s.post("/promote", {}, csrf2);
    assert.equal(promoted.status, 303, `promote with both vars set must succeed:\n${promoted.body}`);
  });

  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 1, "the approved candidate must have promoted normally");
});


test("shared review assets render in the real standalone runtime without a source document", async () => {
  const dir=await tempDir();
  await withReviewServer({FOLIAGE_HARVEST:join(dir,"absent.harvest.json"),FOLIAGE_LEAF:join(dir,"absent.leaf.json")},async s=>{
    const page=await s.get("/");
    assert.match(page.body,/class="fol-workspace"/);
    assert.match(page.body,/data-face="night"/);
    for(const asset of ["/roles.css","/controls.css","/workspace-shell.css","/review.css","/mark-icon.svg"]) assert.equal((await s.get(asset)).status,200,asset);
  });
});

test("the standalone review server says it is legacy on its pages and at start-up, and names foliage up /review", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  await writeFile(harvestPath, harvestDoc("legacy-notice"), "utf8");
  await withReviewServer({ FOLIAGE_HARVEST: harvestPath }, async s => {
    const page = await s.get("/");
    assert.equal(page.status, 200);
    assert.match(page.body, /data-legacy-notice[\s\S]*?<code>foliage up<\/code>[\s\S]*?<code>\/review<\/code>/);
    const refusal = await s.post("/decide", { id: "legacy-notice", verdict: "approved" }, "not-the-token");
    assert.equal(refusal.status, 403);
    assert.match(refusal.body, /data-legacy-notice/, "a refusal page is one of its pages too");
    // The pipe may deliver the log after the first response; wait for it rather than race it.
    const legacyLine = /Legacy view\. The current app is foliage up \(node foliage\.mjs up\); review drafts there at \/review\./;
    for (const deadline = Date.now() + 4_000; !legacyLine.test(s.stdout()) && Date.now() < deadline;) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.match(s.stdout(), legacyLine);
  });
});
