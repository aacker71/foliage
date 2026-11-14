/**
 * F-025 — `promote` (and, found by this same sweep, `approve`/`reject`) must not silently
 * substitute a default document for a forgotten flag or a forgotten environment variable.
 *
 * THE CLI SHAPE. `harvest.mjs promote` already refused a missing `--into` by name; `--doc` had
 * no such guard and fell back to `apps/leaf/harvest.json` (beside the script) whenever it was
 * empty or absent. A bare `node apps/leaf/harvest.mjs promote --into <leaf.json> --force` —
 * exactly what a direct operator (not `foliage.mjs`, not the browser, both of which already pass
 * `--doc` explicitly) would type after forgetting one flag — promoted whichever candidate
 * happened to sit in that default file instead of the one the operator meant, printing only a
 * soft "unbound document" caveat, never a refusal. Reproduced live (PR #15's review): a stale,
 * pre-approved candidate at the default path landed in a real leaf when `--doc` was left off.
 *
 * `approve`/`reject` (shared `decide()`) had the IDENTICAL one-line fallback, found while
 * sweeping the other doc-path commands for the same asymmetry, and it is the same class of
 * hazard: a real, irreversible write (a decided candidate refuses to be re-decided) against a
 * document named only by `--doc`. `foliage review` already passes `--doc` on every call it
 * makes, so this too is only a bare-CLI exposure — exactly `promote`'s own — fixed the same way.
 *
 * `propose`/`propose-photos`/`propose-brain`'s own `--out` was checked too and is a DIFFERENT
 * shape: it names where a NEW document is WRITTEN, guarded by the existing exclusive-create
 * check (`--force` required to overwrite anything already there), not an EXISTING document read
 * by identity and acted on. `review`'s `--doc` shares the literal code shape but is read-only —
 * the worst outcome is a confusing listing, never a silent write — so neither is fixed here; see
 * the PR description for the full sweep.
 *
 * THE SERVER-SIDE COPY, caught by review one round later: `server.mjs`'s `recordDecision()`
 * (POST /review) and `carryIntoLeaf()` (POST /promote) have the identical fallback, one layer
 * over — `FOLIAGE_HARVEST`/`FOLIAGE_LEAF` unset defaults to the same well-known paths, so a bare
 * `node apps/leaf/server.mjs` (skipping `foliage up`, the launcher that sets both) let every
 * browser Approve/Reject/Promote click silently read AND REWRITE whichever documents happened
 * to sit there. FIXED at the two WRITE ROUTES specifically, not by refusing to boot at all — see
 * `server.mjs`'s own `refuseIfUnconfigured` header for the full reasoning (README's own
 * documented bare launch is genuinely sanctioned and is not read-only, and dozens of existing
 * seam tests spawn this server with only one of the two vars set, deliberately exercising the
 * OTHER document's read-path `absent`/`unconfigured` states — a hard startup gate would break
 * every one of them for a mistake none of them make). Reading stays on the well-known default;
 * only the routes that WRITE refuse when the variable backing THAT write was never set.
 *
 * THESE TESTS RUN A PRIVATE COPY OF `apps/leaf`, NEVER THE REAL ONE. "The default-path file is
 * untouched" is exactly the fact being proven, and only a real script-relative default can prove
 * it — so this file copies the app's entry scripts and `src/` into a temp directory and runs
 * THAT copy's `harvest.mjs` and `server.mjs`. Each derives its defaults from its own
 * `import.meta.url`, so the copy's defaults are `<copy>/harvest.json` and `<copy>/leaf.json`:
 * the same code, resolving "beside the script" against a directory nobody else uses. The first
 * test pins that a bare CLI really reads the copy's default, and the server's read test pins the
 * same for the server, so "untouched" stays a claim about the path the code actually uses.
 *
 * WHY NOT THE REAL DEFAULTS: an earlier version planted its sentinels at the real
 * `apps/leaf/harvest.json`/`leaf.json` — on the owner's machine, their own long-standing leaf —
 * holding the original in memory and restoring it in a `finally`. A Ctrl-C, a timeout or a crash
 * mid-test left a fixture where the owner's document had been, and node --test runs FILES
 * concurrently, so every other file reading that path saw a sentinel for the length of the test.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-f025-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/** The real `apps/leaf` — read from to build the copy, never written to. */
const REAL_APP_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * A private copy of `apps/leaf` for this file alone. The entry scripts and `src/` are COPIED,
 * because each derives its default path from its own `import.meta.url` and Node runs a symlinked
 * module from its real path — a linked `src/` would hand `leafDocument.ts` the real directory
 * back. `node_modules` and `public/` are LINKED: nothing derives a document path from them.
 * Nothing else is carried over, in particular none of the real app's gitignored documents
 * (`leaf.json`, `harvest.json`, `policy.json`, `media/`). Realpath'd because macOS hands out
 * `/var/folders/…` symlinks and the children report the resolved `/private/var/…`.
 */
async function privateAppCopy(): Promise<string> {
  const copy = join(await realpath(await tempDir("foliage-f025-app-")), "leaf");
  await mkdir(copy);
  for (const entry of await readdir(REAL_APP_DIR, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name === "package.json")) {
      await cp(join(REAL_APP_DIR, entry.name), join(copy, entry.name));
    }
  }
  await cp(join(REAL_APP_DIR, "src"), join(copy, "src"), { recursive: true });
  for (const linked of ["node_modules", "public"]) {
    await symlink(join(REAL_APP_DIR, linked), join(copy, linked), "dir");
  }
  return copy;
}

const APP_COPY = await privateAppCopy();
const HARVEST_CLI = join(APP_COPY, "harvest.mjs");
const SERVER = join(APP_COPY, "server.mjs");
const DEFAULT_HARVEST_PATH = join(APP_COPY, "harvest.json");
const DEFAULT_LEAF_PATH = join(APP_COPY, "leaf.json");

interface CliResult {
  readonly status: number;
  readonly output: string;
}

async function runHarvest(args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [HARVEST_CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** A minimal, real, unreviewed candidate — the STALE document the reviewer's repro placed at
 * the default path, standing in for "whatever a previous run happened to leave there." */
const HARVEST_SENTINEL = JSON.stringify(
  {
    candidates: [
      {
        id: "git-cluster:sentinel",
        title: "feat: 2 commits",
        evidence: [{ source: "git", ref: "e".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-08-29T00:00:00.000Z",
        review: { state: "candidate" },
      },
    ],
  },
  null,
  2,
);

/** A minimal, real, stale leaf — standing in for "whatever leaf happens to sit at the default
 * path" when `FOLIAGE_LEAF` is left unset. */
const LEAF_SENTINEL = JSON.stringify(
  { id: "leaf:sentinel", subject: "Stale Sentinel Subject", leaflets: [] },
  null,
  2,
);

/**
 * Run `body` with KNOWN sentinel documents planted at one or more of the COPY's default paths,
 * then assert every one of them is byte-for-byte untouched. The copy is this file's alone, so
 * there is nothing to back up; each sentinel is removed afterwards, even on failure, so the next
 * test starts from the empty defaults a fresh clone has.
 */
async function withUntouchedDefaultPaths(
  sentinels: Readonly<Record<string, string>>,
  body: () => Promise<void>,
): Promise<void> {
  for (const [path, content] of Object.entries(sentinels)) {
    await writeFile(path, content, "utf8");
  }
  try {
    await body();
    for (const [path, content] of Object.entries(sentinels)) {
      const after = await readFile(path, "utf8");
      assert.equal(after, content, `${path} must be byte-for-byte untouched`);
    }
  } finally {
    await Promise.all(Object.keys(sentinels).map((path) => rm(path, { force: true })));
  }
}

test("F-025 setup: a bare CLI in the private copy reads the copy's default — the path every test below watches", async () => {
  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    // `review` is read-only and still defaults --doc, so it shows which file a bare invocation
    // resolves without writing anything.
    const result = await runHarvest(["review"]);
    assert.equal(result.status, 0, `a bare, read-only review must succeed:\n${result.output}`);
    assert.ok(result.output.includes(DEFAULT_HARVEST_PATH), `review must name the copy's default:\n${result.output}`);
    assert.match(result.output, /git-cluster:sentinel/, `the planted sentinel must be what it read:\n${result.output}`);
  });
});

test("F-025: bare `promote` with no --doc refuses by name, exit non-zero, and never reads the default path", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  await writeFile(leafPath, JSON.stringify({ id: "leaf:f025", subject: "Someone", leaflets: [] }), "utf8");

  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    const result = await runHarvest(["promote", "--into", leafPath, "--force"]);
    assert.notEqual(result.status, 0, `a --doc-less promote must not exit 0:\n${result.output}`);
    assert.match(result.output, /missing required argument: --doc/, `must refuse by name:\n${result.output}`);
  });

  // NOTHING WRITTEN to the leaf either — the refusal happens before --into is even opened.
  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 0, "the target leaf must be untouched too");
});

test("F-025 sweep: bare `approve` with no --doc refuses by name and never touches the default path", async () => {
  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    const result = await runHarvest(["approve", "git-cluster:sentinel", "--by", "Tester"]);
    assert.notEqual(result.status, 0, `a --doc-less approve must not exit 0:\n${result.output}`);
    assert.match(result.output, /missing required argument: --doc/, `must refuse by name:\n${result.output}`);
  });
});

test("F-025 sweep: bare `reject` with no --doc refuses by name and never touches the default path", async () => {
  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    const result = await runHarvest([
      "reject",
      "git-cluster:sentinel",
      "--by",
      "Tester",
      "--reason",
      "not a body of work",
    ]);
    assert.notEqual(result.status, 0, `a --doc-less reject must not exit 0:\n${result.output}`);
    assert.match(result.output, /missing required argument: --doc/, `must refuse by name:\n${result.output}`);
  });
});

test("F-025 control: promote WITH --doc still succeeds — the refusal is about the missing flag, not about promoting at all", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, JSON.stringify({ id: "leaf:f025-control", subject: "Someone", leaflets: [] }), "utf8");
  await writeFile(
    harvestPath,
    JSON.stringify({
      candidates: [
        {
          id: "git-cluster:control",
          title: "feat: 2 commits",
          evidence: [{ source: "git", ref: "f".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "approved", by: "Tester", at: "2026-08-29T00:00:00.000Z" },
        },
      ],
    }),
    "utf8",
  );

  const result = await runHarvest(["promote", "--doc", harvestPath, "--into", leafPath, "--force"]);
  assert.equal(result.status, 0, `promote WITH --doc must still succeed:\n${result.output}`);
  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 1, "the approved candidate must have promoted");
});

/* ------------------------------------------------------- the server-side copy, F-025 ---- */

/** A port nothing is listening on — see `seam.test.ts`'s `freePort` for the race it avoids. */
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
  get(path: string): Promise<{ status: number; body: string }>;
  post(path: string): Promise<Response>;
  postForm(path: string, fields: Record<string, string>, origin?: string): Promise<Response>;
}

/**
 * Start the real server with the given environment — inheriting `process.env` for everything
 * ELSE a real launch needs (PATH, HOME, and so on), but with `FOLIAGE_HARVEST`/`FOLIAGE_LEAF`
 * DELETED first, then `env`'s own values (if any) re-applied. The whole point here is proving
 * what happens when those two are GENUINELY unset; deleting them explicitly (the same discipline
 * `foliageGarden.test.ts`'s `runFoliage` uses for `FOLIAGE_GARDEN`) means the test's meaning
 * never depends on whatever happens to be exported in whatever shell ran it — and starting from
 * an otherwise-EMPTY environment risks a spawn failure that has nothing to do with this fix. A
 * deliberate, TRIMMED copy of `seam.test.ts`'s `withServer` for the same reason
 * `intakeMerge.seam.test.ts` and others give for their own copies.
 */
async function withBareServer(
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
  let exited: string | null = null;
  child.on("exit", (code, signal) => {
    exited = `exit code ${String(code)} signal ${String(signal)}`;
  });

  const origin = `http://127.0.0.1:${port}`;
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(origin + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
      ...init,
    });
    return { status: res.status, body: await res.text() };
  };
  const get = async (path: string) => {
    const { status, body } = await send(path);
    return { status, body };
  };
  const post = (path: string) => send(path, { method: "POST", headers: { origin } });
  const postForm = (path: string, fields: Record<string, string>, from = origin) =>
    send(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: from },
      body: new URLSearchParams(fields).toString(),
    });

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
    await body({ get, post, postForm });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

test("F-025 (server): reads stay on the well-known default even with NEITHER env var set — only writes refuse", async () => {
  await withUntouchedDefaultPaths(
    { [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL, [DEFAULT_LEAF_PATH]: LEAF_SENTINEL },
    async () => {
      await withBareServer({}, async (s) => {
        const home = await s.get("/");
        assert.equal(home.status, 200, `GET / must still work bare — reads are unaffected:\n${home.body}`);

        const leaf = await s.get("/leaf");
        assert.equal(leaf.status, 200, `GET /leaf must still work bare:\n${leaf.body}`);
        assert.ok(leaf.body.includes("Stale Sentinel Subject"), "the default-path leaf must render, unchanged");

        const queue = await s.get("/review");
        assert.equal(queue.status, 200, `GET /review must still work bare:\n${queue.body}`);
        assert.ok(queue.body.includes("git-cluster:sentinel"), "the default-path harvest must render, unchanged");
      });
    },
  );
});

test("F-025 (server): POST /review with FOLIAGE_HARVEST unset refuses by name, and the default harvest document is untouched", async () => {
  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    await withBareServer({}, async (s) => {
      const res = await s.postForm("/review", {
        id: "git-cluster:sentinel",
        by: "Tester",
        decision: "approve",
      });
      assert.equal(res.status, 409, `an approve with FOLIAGE_HARVEST unset must refuse:\n${res.body}`);
      assert.match(res.body, /FOLIAGE_HARVEST is not set/, `must name the missing variable:\n${res.body}`);
      assert.match(res.body, /foliage up/, "must name the sanctioned launcher");
    });
  });
});

test("F-025 (server): POST /promote with FOLIAGE_LEAF unset (FOLIAGE_HARVEST set) refuses by name, and the default leaf is untouched", async () => {
  const garden = await tempDir();
  const harvestPath = join(garden, "harvest.json");
  await writeFile(
    harvestPath,
    JSON.stringify({
      candidates: [
        {
          id: "git-cluster:real",
          title: "feat: 2 commits",
          evidence: [{ source: "git", ref: "b".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "approved", by: "Tester", at: "2026-08-29T00:00:00.000Z" },
        },
      ],
    }),
    "utf8",
  );

  await withUntouchedDefaultPaths({ [DEFAULT_LEAF_PATH]: LEAF_SENTINEL }, async () => {
    await withBareServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
      const res = await s.post("/promote");
      assert.equal(res.status, 409, `a promote with FOLIAGE_LEAF unset must refuse:\n${res.body}`);
      assert.match(res.body, /FOLIAGE_LEAF is not set/, `must name the missing variable:\n${res.body}`);
      assert.match(res.body, /foliage up/, "must name the sanctioned launcher");
    });
  });

  // The REAL, non-default harvest must be untouched too — nothing was promoted from it.
  const harvestAfter = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(harvestAfter.candidates[0].review.state, "approved", "the harvest document itself is unaffected");
});

test("F-025 (server): POST /promote with FOLIAGE_HARVEST unset (FOLIAGE_LEAF set) refuses by name, and the default harvest is untouched", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  await writeFile(leafPath, JSON.stringify({ id: "leaf:f025-real", subject: "Real Subject", leaflets: [] }), "utf8");

  await withUntouchedDefaultPaths({ [DEFAULT_HARVEST_PATH]: HARVEST_SENTINEL }, async () => {
    await withBareServer({ FOLIAGE_LEAF: leafPath }, async (s) => {
      const res = await s.post("/promote");
      assert.equal(res.status, 409, `a promote with FOLIAGE_HARVEST unset must refuse:\n${res.body}`);
      assert.match(res.body, /FOLIAGE_HARVEST is not set/, `must name the missing variable:\n${res.body}`);
    });
  });

  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 0, "the real target leaf must be untouched — nothing was promoted into it");
});

test("F-025 (server) control: POST /review and POST /promote WITH both env vars set still succeed", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, JSON.stringify({ id: "leaf:f025-server-control", subject: "Someone", leaflets: [] }), "utf8");
  await writeFile(
    harvestPath,
    JSON.stringify({
      candidates: [
        {
          id: "git-cluster:server-control",
          title: "feat: 2 commits",
          evidence: [{ source: "git", ref: "c".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "candidate" },
        },
      ],
    }),
    "utf8",
  );

  await withBareServer({ FOLIAGE_HARVEST: harvestPath, FOLIAGE_LEAF: leafPath }, async (s) => {
    const approved = await s.postForm("/review", {
      id: "git-cluster:server-control",
      by: "Tester",
      decision: "approve",
    });
    assert.equal(approved.status, 303, `approve with both vars set must succeed:\n${approved.body}`);

    const promoted = await s.post("/promote");
    assert.equal(promoted.status, 303, `promote with both vars set must succeed:\n${promoted.body}`);
  });

  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 1, "the approved candidate must have promoted normally");
});
