/**
 * The redirect hole, pinned. Every test here opens a REAL socket to a REAL server — the defect
 * was invisible to any test that stubbed fetch, because the thing that leaked was undici's own
 * redirect behaviour, not our code's.
 */
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loopbackFetch, loopbackHostOf } from "./loopbackFetch.ts";

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

test("A 307 IS REFUSED AND THE SECOND HOST RECEIVES NOTHING — the reproduced defect", async () => {
  let stolen: string | null = null;
  const thief = await listen((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { stolen = b; res.end("{}"); });
  });
  const model = await listen((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${thief.port}/api/generate` }); res.end();
  });

  const body = JSON.stringify({ prompt: "PRIVATE CONTENT" });
  const r = await loopbackFetch(`http://127.0.0.1:${model.port}/api/generate`, {
    method: "POST", body, headers: { "content-type": "application/json" },
  });

  assert.equal(r.ok, false, "a redirect must not be reported as success");
  // Its own cause, never folded into "unreachable": the remedies differ, and an operator told
  // "unreachable" restarts the model — the one action that does not address someone answering on
  // their trusted port. Asserting `cause !== "unreachable"` after this line would not be a second
  // check; it is the same check, and the compiler says so.
  assert.ok(!r.ok && r.failure.cause === "redirected", `expected cause "redirected", got ${!r.ok ? r.failure.cause : "ok"}`);
  assert.equal(stolen, null, "THE SECOND HOST RECEIVED THE BODY — the hole is open");
  // WHAT was refused travels with the refusal. A failure that says only "redirected" leaves the
  // operator with nothing to go look at.
  assert.equal(r.failure.status, 307);
  assert.match(String(r.failure.location), new RegExp(`:${thief.port}`));
  thief.server.close(); model.server.close();
});

test("a non-loopback endpoint is refused BEFORE a socket is opened", async () => {
  let touched = false;
  const remote = await listen((_req, res) => { touched = true; res.end("{}"); });
  // 127.0.0.2 is genuinely loopback to the OS and is still refused — the strictest reading,
  // deliberately, because two validators disagreeing about exactly this was a real finding.
  const r = await loopbackFetch(`http://127.0.0.2:${remote.port}/`, { method: "POST", body: "x" });
  assert.ok(!r.ok && r.failure.cause === "not-loopback");
  assert.equal(touched, false, "nothing may be sent to a host that failed the check");
  remote.server.close();
});

test("localhost is refused because a NAME is resolved by something the process does not control", () => {
  const r = loopbackHostOf("http://localhost:11434/api/generate");
  assert.ok(!r.ok && r.failure.cause === "not-loopback");
});

test("an ordinary 200 still works — the guard must not break the real path", async () => {
  const model = await listen((_req, res) => { res.end(JSON.stringify({ response: "ok" })); });
  const r = await loopbackFetch(`http://127.0.0.1:${model.port}/api/generate`, { method: "POST", body: "{}" });
  assert.ok(r.ok, "a normal response must pass");
  assert.equal(r.response.status, 200);
  model.server.close();
});

test("a malformed endpoint is its own cause, and nothing is sent", async () => {
  const r = await loopbackFetch("not a url", { method: "POST", body: "x" });
  assert.ok(!r.ok && r.failure.cause === "malformed-endpoint");
});

/* --------------------------------------------------------- the git call site, end to end ------
 *
 * WHY THE THIRD SITE'S TEST IS IN THIS FILE. `brainSource.test.ts` and `photoSource.test.ts` each
 * pin their own call site against a 307, because each owns a function this test can import. The
 * git site is `draftTitleWithLocalModel` inside `harvest.mjs`, which exports nothing — the only
 * way to exercise it is to RUN the command, and the file that runs it (`harvestDraft.test.ts`)
 * belongs to another lane's ownership in this shared worktree. So it is pinned here, next to the
 * guard it now calls, rather than not at all.
 *
 * It is the most important of the three anyway: `FOLIAGE_OLLAMA_URL` comes from the ENVIRONMENT,
 * so this is the arm where the endpoint that answers 307 need not be ollama, or compromised, or
 * anything the operator inspected.
 */

const exec = promisify(execFile);
const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const AUTHOR = "loopback-guard@foliage.invalid";

const tmpRoots: string[] = [];
after(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

test("harvest.mjs REFUSES a 307 from its own configured endpoint, and writes nothing", async () => {
  let stolen: string | null = null;
  const thief = await listen((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { stolen = b; res.end(JSON.stringify({ response: "a title it never asked for" })); });
  });
  const model = await listen((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${thief.port}/api/generate` }); res.end();
  });

  // A REAL repository, because `propose` attributes commits before it clusters them and only a
  // cluster of two or more is drafted for. Nothing here stubs git.
  const repo = await mkdtemp(join(tmpdir(), "foliage-loopback-guard-"));
  tmpRoots.push(repo);
  const git = (...args: string[]) => exec("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 60_000 });
  await git("init", "--quiet", "--initial-branch=main");
  for (const [i, message] of ["feat: the first half", "feat: the second half"].entries()) {
    await writeFile(join(repo, `f-${i}.txt`), message, "utf8");
    await git("add", "-A");
    await git("-c", "user.name=Loopback Guard", "-c", `user.email=${AUTHOR}`, "commit", "--no-gpg-sign", "-m", message);
  }
  const out = join(repo, "harvest.json");

  const run = await exec(
    process.execPath,
    [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out, "--draft-with-local-model"],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, FOLIAGE_OLLAMA_URL: `http://127.0.0.1:${model.port}/api/generate` } },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err: { code?: number; stdout?: string; stderr?: string }) => ({ code: err.code ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" }),
  );

  assert.notEqual(run.code, 0, "a redirected endpoint must fail the command");
  assert.equal(stolen, null, "THE SECOND HOST RECEIVED THE COMMIT SUBJECTS — the hole is open");
  assert.equal(await access(out).then(() => true, () => false), false, "nothing may be written");
  assert.match(run.stderr, /refusing to draft/i);
  assert.match(run.stderr, /307/, "the status must be named");
  assert.match(run.stderr, new RegExp(`${thief.port}`), "and the location it refused to follow");
  // NOT reported as the model being down: that would send the operator to restart ollama.
  assert.doesNotMatch(run.stderr, /could not be reached/i);

  thief.server.close(); model.server.close();
});
