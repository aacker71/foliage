/**
 * THE LOCAL-MODEL DRAFTING SEAM. `harvest.mjs propose --draft-with-local-model` as a real child
 * process, over a real git repository, answered by a real HTTP server on a real loopback socket,
 * judged by its real exit code, its real stderr and the file it did or did not leave behind.
 *
 * WHY THIS FILE EXISTS. Three light sources can put a machine-written sentence on a person's
 * portfolio, and until now only two of them checked what the machine wrote. `photoIntake.ts` and
 * `brainIntake.ts` each refuse a drafted title carrying a rating-shaped number and print the
 * refused text verbatim; the git path — the oldest of the three, and the one `propose` runs —
 * defended the same invariant with a sentence in the prompt. A prompt is a request. The model is
 * free to answer "Shipped work rated 9/10", and that string went into a candidate, through
 * review, into a leaflet title, and onto a public page whose entire premise is that this product
 * does not rate anybody.
 *
 * Nothing in `render.test.ts` can see that: by the time a rating reaches the renderer it is
 * already a candidate, and the renderer's job is to show the reviewer what is being decided. The
 * refusal has to happen where the model answers, which is only in the CLI — the same gap
 * `harvestPhotos.test.ts` was written to close for the photo path.
 *
 * WHAT THE MODEL HERE IS. A 40-line HTTP server that returns whatever this test tells it to,
 * bound to 127.0.0.1 on an EPHEMERAL port. It is not a model and it is not pretending to be one:
 * what is under test is what `harvest.mjs` does with an answer, so the answer is an input. The
 * commits are real commits in a real repository this test creates and destroys.
 *
 * WHY THE ENDPOINT IS OVERRIDABLE AT ALL. 11434 is a fixed well-known port. A test that bound it
 * would collide with the operator's own ollama, and on the run where it lost the race it would
 * send this repository's commit subjects to a real model. `FOLIAGE_OLLAMA_URL` moves the ADDRESS
 * only — the loopback policy is enforced on the parsed hostname, and the last test below is the
 * proof that pointing it off-loopback still refuses before any socket is opened.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

/** Per-invocation ceiling. A wedged child must fail this suite, never hang it. */
const RUN_TIMEOUT_MS = 60_000;

/** The address the commits below are authored under, and the only one declared to `propose`. */
const AUTHOR = "drafting-seam@foliage.invalid";

const tmpRoots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const server of servers) {
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const dir of tmpRoots) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-harvest-draft-"));
  tmpRoots.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
  });
  return stdout;
}

/**
 * A REAL repository with one conventional-commit cluster of two commits.
 * Every commit is authored under `AUTHOR`, because `propose` attributes before it clusters and a
 * commit it does not attribute to the declared identity never reaches the drafter at all.
 */
async function repoWithOneCluster(subjects = ["feat: the first half", "feat: the second half"]): Promise<string> {
  const repo = await tempDir();
  await git(repo, "init", "--quiet", "--initial-branch=main");
  for (const [i, message] of subjects.entries()) {
    await writeFile(join(repo, `f-${i}.txt`), message, "utf8");
    await git(repo, "add", "-A");
    await git(
      repo,
      "-c",
      "user.name=Drafting Seam",
      "-c",
      `user.email=${AUTHOR}`,
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    );
  }
  return repo;
}

/**
 * The stand-in endpoint. Answers every request with ollama's own body shape and the one line this
 * test wants drafted, so `harvest.mjs` takes exactly the path it takes with a real model.
 */
async function modelAnswering(line: string): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: line }));
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "the stub must bind a real port");
  return { url: `http://127.0.0.1:${address.port}/api/generate`, requests };
}

/** Runs `propose --draft-with-local-model`, returning the outcome instead of throwing on failure. */
async function propose(
  repo: string,
  out: string,
  modelUrl: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [
        HARVEST,
        "propose",
        "--repo",
        repo,
        "--identity",
        AUTHOR,
        "--out",
        out,
        "--draft-with-local-model",
      ],
      {
        encoding: "utf8",
        timeout: RUN_TIMEOUT_MS,
        env: { ...process.env, FOLIAGE_OLLAMA_URL: modelUrl },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/* ------------------------------------------------------------------------------------------ */

test("A RATING-SHAPED DRAFT IS REFUSED, named verbatim, and NOTHING is written", async () => {
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");
  const model = await modelAnswering("Shipped work rated 9/10 across 40% of the tree");

  const run = await propose(repo, out, model.url);

  // 1. The model was really asked — otherwise this test proves nothing about what it answered.
  assert.equal(model.requests.length, 1, "propose must have made exactly one drafting request");
  assert.match(model.requests[0]!, /feat: the first half/, "with the real commit subjects in it");

  // 2. IT FAILED CLOSED. Same posture as every other branch of `draftTitleWithLocalModel`:
  //    unreachable, non-200, unparseable, empty — and now, refused.
  assert.notEqual(run.code, 0, `propose must exit non-zero; stdout was: ${run.stdout}`);

  // 3. THE REFUSED TEXT IS PRINTED VERBATIM. A refusal that hides what it refused cannot be
  //    judged by the operator whose model and whose repository produced it.
  assert.match(run.stderr, /REFUSED/);
  assert.ok(
    run.stderr.includes("Shipped work rated 9/10 across 40% of the tree"),
    `the refused draft must be quoted; stderr was: ${run.stderr}`,
  );

  // 4. AND NO FILE. Not a file with the deterministic title quietly substituted, which would ship
  //    a candidate whose recorded extractor (`local-model:…`) did not write its title; not a file
  //    with the cluster dropped, which would make "no candidate" and "we would not print that"
  //    the same observation. Nothing.
  assert.equal(await exists(out), false, "a refused run must leave no harvest document behind");
});

test("the SAME run with an ordinary title writes the model's words — the gate is narrow", async () => {
  // The other side of the pin. Without this, the test above is satisfied by a `propose` that
  // refuses everything, and "no ratings" would have been bought by breaking the feature.
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");
  const model = await modelAnswering("Split the retrieval layer into two halves");

  const run = await propose(repo, out, model.url);
  assert.equal(run.code, 0, `propose must succeed; stderr was: ${run.stderr}`);

  const doc = JSON.parse(await readFile(out, "utf8")) as {
    candidates: { title: string; extractor: string }[];
  };
  assert.equal(doc.candidates.length, 1);
  assert.equal(doc.candidates[0]!.title, "Split the retrieval layer into two halves");
  assert.match(
    doc.candidates[0]!.extractor,
    /^local-model:/,
    "a candidate must name what actually drafted it",
  );
});

test("a model-drafted rating is refused in every supported form", async () => {
  // All three intake paths import the Leaf rule. A rating cannot get a different answer
  // depending on which source produced the proposed title.
  const repo = await repoWithOneCluster();
  for (const line of [
    "Work rated 4.5/5 by the team",
    "Scored 9 out of 10 on the rewrite",
    "A 4 star refactor",
    "Rated my engineering ability at 40%",
  ]) {
    const out = join(await tempDir(), "harvest.json");
    const model = await modelAnswering(line);
    const run = await propose(repo, out, model.url);
    assert.notEqual(run.code, 0, `"${line}" must be refused`);
    assert.ok(run.stderr.includes(line), `and quoted: ${run.stderr}`);
    assert.equal(await exists(out), false, `and write nothing: ${line}`);
  }
});

test("a model-drafted engineering metric reaches review without being mistaken for a rating", async () => {
  const repo = await repoWithOneCluster();
  for (const line of ["Cut latency by 40%", "Handled the HTTP 409/500 split", "2/3 checks passed"]) {
    const out = join(await tempDir(), "harvest.json");
    const model = await modelAnswering(line);
    const run = await propose(repo, out, model.url);
    assert.equal(run.code, 0, `"${line}" was refused: ${run.stderr}`);
    const doc = JSON.parse(await readFile(out, "utf8")) as { candidates: { title: string }[] };
    assert.equal(doc.candidates[0]?.title, line);
  }
});

test("LOOPBACK IS POLICY, NOT CONFIGURATION — an off-loopback endpoint refuses before it connects", async () => {
  // The guard that makes the override above safe. 192.0.2.1 is TEST-NET-1 (RFC 5737) and is not
  // routable, so if the check ever stopped running this test would fail by TIMEOUT rather than
  // pass — the assertion on the exit code is not the only thing keeping it honest.
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");

  const run = await propose(repo, out, "http://192.0.2.1:11434/api/generate");

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /refusing to draft/i);
  assert.match(run.stderr, /192\.0\.2\.1/, "the refusal must name the host it refused");
  assert.match(run.stderr, /loopback only/i);
  assert.equal(await exists(out), false);
});

test("the model titles only the drafts this run built — an approved candidate is never retitled", async () => {
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");
  const first = await modelAnswering("Split the retrieval layer into two halves");
  assert.equal((await propose(repo, out, first.url)).code, 0);
  await exec(process.execPath, [HARVEST, "approve", "git-cluster:feat", "--by", "Drafting Seam", "--doc", out], { timeout: RUN_TIMEOUT_MS });
  const approved = (JSON.parse(await readFile(out, "utf8")) as { candidates: { id: string }[] }).candidates[0];

  await writeFile(join(repo, "f-2.txt"), "third", "utf8");
  await git(repo, "add", "-A");
  await git(repo, "-c", "user.name=Drafting Seam", "-c", `user.email=${AUTHOR}`, "commit", "--no-gpg-sign", "-m", "feat: a third input");

  const second = await modelAnswering("Added a third input");
  await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out, "--force", "--draft-with-local-model"],
    { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env: { ...process.env, FOLIAGE_OLLAMA_URL: second.url } });

  assert.equal(second.requests.length, 1, "one request, for the one new draft");
  assert.match(second.requests[0]!, /feat: a third input/);
  assert.doesNotMatch(second.requests[0]!, /the first half/, "decided material is never sent again");
  const doc = JSON.parse(await readFile(out, "utf8")) as { candidates: { id: string; title: string; extractor: string }[] };
  assert.deepEqual(doc.candidates.find((c) => c.id === "git-cluster:feat"), approved);
  const next = doc.candidates.find((c) => c.id === "git-cluster:feat:2");
  assert.equal(next?.title, "Added a third input");
  assert.match(String(next?.extractor), /^local-model:/);
});

test("a queue that moves while the model drafts fails closed, and the harvest is left as it was", async () => {
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");
  const first = await modelAnswering("Split the retrieval layer into two halves");
  assert.equal((await propose(repo, out, first.url)).code, 0);

  await writeFile(join(repo, "f-2.txt"), "third", "utf8");
  await git(repo, "add", "-A");
  await git(repo, "-c", "user.name=Drafting Seam", "-c", `user.email=${AUTHOR}`, "commit", "--no-gpg-sign", "-m", "feat: a third input");

  // The model is asked to title git-cluster:feat holding all three commits. While it answers, the
  // two-commit git-cluster:feat is approved, so the third commit now belongs to git-cluster:feat:2
  // and the title the model wrote fits no draft that exists.
  let afterApproval = "";
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(body);
      exec(process.execPath, [HARVEST, "approve", "git-cluster:feat", "--by", "Drafting Seam", "--doc", out], { timeout: RUN_TIMEOUT_MS })
        .then(() => readFile(out, "utf8"))
        .then((bytes) => {
          afterApproval = bytes;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ response: "Added a third input" }));
        }, (error: unknown) => {
          res.writeHead(500);
          res.end(String(error));
        });
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");

  let run: { code: number; stderr: string };
  try {
    await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out, "--force", "--draft-with-local-model"],
      { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env: { ...process.env, FOLIAGE_OLLAMA_URL: `http://127.0.0.1:${address.port}/api/generate` } });
    run = { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    run = { code: e.code ?? -1, stderr: e.stderr ?? "" };
  }

  assert.equal(requests.length, 1, "the model was asked once, before the approval landed");
  assert.match(requests[0]!, /feat: a third input/);
  assert.ok(afterApproval !== "", "the approval ran while the model was drafting");
  assert.notEqual(run.code, 0, "propose must fail closed");
  assert.match(run.stderr, /the queue changed while/);
  assert.match(run.stderr, /git-cluster:feat:2/);
  assert.equal(await readFile(out, "utf8"), afterApproval, "nothing was written over the approval");
});

test("a model run titles the unchanged drafts another extractor wrote, and says so", async () => {
  const repo = await repoWithOneCluster();
  const out = join(await tempDir(), "harvest.json");
  await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out], { timeout: RUN_TIMEOUT_MS });

  const model = await modelAnswering("Split the retrieval layer into two halves");
  const run = await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out, "--force", "--draft-with-local-model"],
    { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env: { ...process.env, FOLIAGE_OLLAMA_URL: model.url } });

  assert.equal(model.requests.length, 1, "the unchanged deterministic draft is sent to the model");
  assert.match(run.stdout, /drafted {2}git-cluster:feat\n/);
  const doc = JSON.parse(await readFile(out, "utf8")) as { candidates: { title: string; extractor: string }[] };
  assert.equal(doc.candidates[0]?.title, "Split the retrieval layer into two halves");
  assert.match(String(doc.candidates[0]?.extractor), /^local-model:/);

  const again = await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", AUTHOR, "--out", out, "--force", "--draft-with-local-model"],
    { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env: { ...process.env, FOLIAGE_OLLAMA_URL: model.url } });
  assert.equal(model.requests.length, 1, "a draft the model already titled is not sent again");
  assert.doesNotMatch(again.stdout, /titles drafted by/, "nothing drafted, so no drafter is named");
});

test("propose --force over another repository's decisions refuses and leaves the harvest as it was", async () => {
  const mine = await repoWithOneCluster();
  const theirs = await repoWithOneCluster(["feat: another repository's input"]);
  const out = join(await tempDir(), "harvest.json");
  await exec(process.execPath, [HARVEST, "propose", "--repo", mine, "--identity", AUTHOR, "--out", out], { timeout: RUN_TIMEOUT_MS });
  await exec(process.execPath, [HARVEST, "approve", "git-cluster:feat", "--by", "Drafting Seam", "--doc", out], { timeout: RUN_TIMEOUT_MS });
  const before = await readFile(out, "utf8");

  const refused = await exec(process.execPath, [HARVEST, "propose", "--repo", theirs, "--identity", AUTHOR, "--out", out, "--force"],
    { encoding: "utf8", timeout: RUN_TIMEOUT_MS }).then(() => null, (err: { code?: number; stderr?: string }) => err);
  assert.notEqual(refused, null, "propose must refuse another repository");
  assert.match(String(refused?.stderr), /refused/);
  assert.equal(await readFile(out, "utf8"), before, "the harvest is unchanged");

  // The same repository by another path still refreshes.
  const clone = join(await tempDir(), "clone");
  await exec("git", ["clone", "--quiet", mine, clone], { timeout: RUN_TIMEOUT_MS });
  await exec(process.execPath, [HARVEST, "propose", "--repo", clone, "--identity", AUTHOR, "--out", out, "--force"], { timeout: RUN_TIMEOUT_MS });
});
