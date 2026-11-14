/**
 * F-024 — approving or rejecting a candidate must not strip the target binding `propose --into`
 * recorded on the document.
 *
 * THE SHAPE, one layer over F-014. `propose`'s own `--force` refresh once dropped the binding it
 * had recorded (F-014, fixed by `apps/leaf/src/proposeDocument.ts`'s `prepareProposedDocument`).
 * The IDENTICAL bug then reappeared in the two writers that never went through that fix:
 * `decide()` in `apps/leaf/harvest.mjs` and `recordDecision()` in `apps/leaf/server.mjs`
 * (approve/reject, CLI and web panel) each rebuilt the document as `{ candidates }` only. Since a
 * real `promote` needs an APPROVED candidate to promote anything, and approving is exactly what
 * erased the binding, the SANCTIONED `grow` -> `review` -> `promote` sequence never once
 * exercised F-014's own mismatch check in real use: every promote in that path saw
 * `binding: "unbound-legacy"`, not a checked match, and a wrong `--into` spliced silently — the
 * exact consent-breach shape F-014 exists to refuse.
 *
 * THE FIX: both writers now build their updated document with `withCandidates`
 * (`@foliage/photosynthesis`, in `harvestDocument.ts`) — ONE reassembly point that keeps every
 * document-level field the source document carries and replaces only `candidates`. The same
 * function `prepareProposedDocument` itself now calls, so a fourth writer inherits the rule
 * rather than forking `{ candidates }` a third time.
 *
 * THREE TESTS: the CLI's own decide() preserves the binding; the web panel's recordDecision()
 * preserves it too (a real HTTP request, not a unit test of the handler); and the full
 * SANCTIONED SEQUENCE — propose --into, approve, promote with a mismatched --into — refuses by
 * name, which is the reviewer's own exact repro and the only test that proves the whole chain
 * (not just one writer) keeps F-014's check alive in practice.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

const BOOT_DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-f024-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

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

function leafDoc(subject: string, id: string): string {
  return JSON.stringify({ id, subject, leaflets: [] }, null, 2);
}

/** A minimal, real, bound harvest document with one unreviewed candidate — the exact shape
 * `propose --into` writes, hand-built so these tests do not need a real repository. */
function boundHarvestDoc(subject: string, leafId: string, candidateId: string): string {
  return JSON.stringify(
    {
      subject,
      leafId,
      candidates: [
        {
          id: candidateId,
          title: "feat: 2 commits",
          evidence: [{ source: "git", ref: "d".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "candidate" },
        },
      ],
    },
    null,
    2,
  );
}

test("F-024: approve through the CLI preserves the target binding", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  await writeFile(harvestPath, boundHarvestDoc("Carry Subject", "leaf:f024-cli", "git-cluster:feat"), "utf8");

  const approved = await runHarvest(["approve", "git-cluster:feat", "--by", "Tester", "--doc", harvestPath]);
  assert.equal(approved.status, 0, `approve must succeed:\n${approved.output}`);

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject", "approve must not strip the binding — F-024");
  assert.equal(after.leafId, "leaf:f024-cli");
  assert.equal(after.candidates[0].review.state, "approved");
});

test("F-024: reject through the CLI preserves the target binding", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  await writeFile(
    harvestPath,
    boundHarvestDoc("Carry Subject", "leaf:f024-cli-reject", "git-cluster:feat"),
    "utf8",
  );

  const rejected = await runHarvest([
    "reject",
    "git-cluster:feat",
    "--by",
    "Tester",
    "--reason",
    "documentation commits are not a body of work",
    "--doc",
    harvestPath,
  ]);
  assert.equal(rejected.status, 0, `reject must succeed:\n${rejected.output}`);

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject", "reject must not strip the binding either");
  assert.equal(after.leafId, "leaf:f024-cli-reject");
  assert.equal(after.candidates[0].review.state, "rejected");
});

/* --------------------------------------------------------------- the real HTTP /review route --- */

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
  readonly headers: Headers;
}

interface Running {
  get(path: string): Promise<{ status: number; body: string }>;
  postForm(path: string, fields: Record<string, string>, origin?: string): Promise<Response>;
}

/**
 * Start the real server with the given environment, hand it to `body`, and always kill it — a
 * deliberate, TRIMMED copy of `seam.test.ts`'s `withServer` (importing that file would register
 * its entire suite into this one; `intakeMerge.seam.test.ts` and `promoteRoute.seam.test.ts`
 * already document this as the reason their own copies exist).
 */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1" },
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
    });
    return { status: res.status, body: await res.text(), headers: res.headers };
  };
  const get = async (path: string) => {
    const { status, body } = await send(path);
    return { status, body };
  };
  const postForm = (path: string, fields: Record<string, string>, from = origin) =>
    send(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: from },
      body: new URLSearchParams(fields).toString(),
    });

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}\nstderr:\n${stderr}`,
        );
      }
      try {
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get, postForm });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

test("F-024: approve through the real HTTP /review route preserves the target binding", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  await writeFile(harvestPath, boundHarvestDoc("Carry Subject", "leaf:f024-http", "git-cluster:feat"), "utf8");

  await withServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const res = await s.postForm("/review", { id: "git-cluster:feat", by: "Tester", decision: "approve" });
    assert.equal(res.status, 303, `approve via HTTP must succeed:\n${res.body}`);
  });

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject", "the web panel must not strip the binding either — F-024");
  assert.equal(after.leafId, "leaf:f024-http");
  assert.equal(after.candidates[0].review.state, "approved");
});

test("F-024: reject through the real HTTP /review route preserves the target binding", async () => {
  const dir = await tempDir();
  const harvestPath = join(dir, "harvest.json");
  await writeFile(
    harvestPath,
    boundHarvestDoc("Carry Subject", "leaf:f024-http-reject", "git-cluster:feat"),
    "utf8",
  );

  await withServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const res = await s.postForm("/review", {
      id: "git-cluster:feat",
      by: "Tester",
      reason: "documentation commits are not a body of work",
      decision: "reject",
    });
    assert.equal(res.status, 303, `reject via HTTP must succeed:\n${res.body}`);
  });

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject");
  assert.equal(after.leafId, "leaf:f024-http-reject");
  assert.equal(after.candidates[0].review.state, "rejected");
});

/* -------------------------------------------------------- the sanctioned sequence, end to end --- */

test("F-024, THE REVIEWER'S EXACT REPRO: propose --into -> approve -> promote with a MISMATCHED --into now refuses by name", async () => {
  const gardenA = await tempDir();
  const gardenB = await tempDir();
  const repoA = await tempDir("foliage-f024-repo-");
  await exec("git", ["init", "--quiet", "--initial-branch=main", repoA], { timeout: 30_000 });
  await exec(
    "git",
    ["-C", repoA, "-c", "user.email=carry@example.test", "-c", "user.name=Carry", "commit", "--allow-empty", "-m", "feat: first"],
    { timeout: 30_000 },
  );
  await exec(
    "git",
    ["-C", repoA, "-c", "user.email=carry@example.test", "-c", "user.name=Carry", "commit", "--allow-empty", "-m", "feat: second"],
    { timeout: 30_000 },
  );

  const leafA = join(gardenA, "leaf.json");
  const leafB = join(gardenB, "leaf.json");
  const harvestA = join(gardenA, "harvest.json");
  await writeFile(leafA, leafDoc("Take A", "leaf:f024-e2e-a"), "utf8");
  await writeFile(leafB, leafDoc("Take B", "leaf:f024-e2e-b"), "utf8");

  // 1. PROPOSE, bound to take A — the standard `--into` path.
  const proposed = await runHarvest([
    "propose",
    "--repo",
    repoA,
    "--identity",
    "carry@example.test",
    "--into",
    leafA,
    "--out",
    harvestA,
    "--force",
  ]);
  assert.equal(proposed.status, 0, `propose must succeed:\n${proposed.output}`);
  const bound = JSON.parse(await readFile(harvestA, "utf8"));
  assert.equal(bound.subject, "Take A", "propose --into must record the binding");
  assert.ok(bound.candidates.length > 0, "the fixture repo must draft at least one candidate");
  const candidateId = bound.candidates[0].id as string;

  // 2. APPROVE — the reviewer's own repro step: binding present BEFORE, must still be present
  //    AFTER. Without the fix this is exactly where it silently vanished.
  const approved = await runHarvest(["approve", candidateId, "--by", "Tester", "--doc", harvestA]);
  assert.equal(approved.status, 0, `approve must succeed:\n${approved.output}`);
  const afterApprove = JSON.parse(await readFile(harvestA, "utf8"));
  assert.equal(
    afterApprove.subject,
    "Take A",
    "F-024: approve must not strip the binding propose recorded",
  );
  assert.equal(afterApprove.leafId, "leaf:f024-e2e-a");

  // 3. PROMOTE into take B's leaf — a MISMATCH. Before this fix the stripped binding made this
  //    exit 0 and splice take A's approved candidate into take B's leaf, silently (the F-014
  //    shape, reopened). F-014's own mismatch check can only fire here if the binding survived
  //    step 2 — this is the assertion that proves the WHOLE sanctioned sequence, not just one
  //    writer in isolation.
  const promoted = await runHarvest(["promote", "--doc", harvestA, "--into", leafB, "--force"]);
  assert.equal(promoted.status, 1, `a mismatched promote must refuse:\n${promoted.output}`);
  assert.match(promoted.output, /refused/i);
  assert.match(promoted.output, /"Take A"/, "the harvest's own (still-bound) subject must be named");
  assert.match(promoted.output, /"Take B"/, "the target leaf's actual subject must be named");
  assert.doesNotMatch(promoted.output, /unbound document/, "a preserved binding must be CHECKED, not waved through as unbound");

  const leafBAfter = JSON.parse(await readFile(leafB, "utf8"));
  assert.equal(leafBAfter.leaflets.length, 0, "take B's leaf must be untouched — nothing spliced");
});
