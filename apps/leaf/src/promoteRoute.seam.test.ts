/**
 * `POST /promote`, END TO END — real HTTP against the real server, F-014's web-side caveat.
 *
 * PR #17 REVIEW, BLOCKER 2: nothing anywhere drove this route over HTTP before this file. The
 * CLI's `harvest.mjs promote` prints "unbound document — binding not checked" when the harvest
 * it promotes carries no recorded subject/leaf-id (`packages/photosynthesis/src/promote.ts`'s
 * `binding: "unbound-legacy"`); the web review panel's `/promote` route (`server.mjs`'s
 * `carryIntoLeaf`) did the identical write with ZERO indication anywhere the operator could see
 * it — a 303 with no body, into a queue page that said nothing either. A web operator promoting
 * an unbound harvest could not tell their promotion had gone unchecked; a CLI operator doing the
 * identical thing was told plainly. This file drives the real HTTP route both ways — bound and
 * unbound — and would fail if the caveat regressed to silence again.
 *
 * WHY A REAL SUBPROCESS AND NOT ONLY A UNIT TEST OF `renderReviewPage`. THE DIVISION OF LABOR,
 * STATED RATHER THAN ASSUMED (a prior draft of this comment claimed `render.test.ts` "already
 * covers" the renderer's half before a single line of that coverage existed — the exact
 * unchecked-claim shape this product exists to refuse, caught by the PR #17 review's own reading
 * of `render.test.ts`, which at that point had zero `PromoteNotice` tests). The two files now
 * split the mechanism at its real seam:
 *
 *   `render.test.ts` — "PROMOTENOTICE" section — proves the RENDERER's contract in isolation:
 *   given the argument, does `renderReviewPage` print the notice in both the empty and populated
 *   queue branches, with the right `data-promote-notice` attribute, escaped like every other
 *   value on the page, silent when the argument is omitted, and distinguishable from a decision
 *   refusal banner. None of that needs a server.
 *
 *   THIS FILE proves the wiring `render.test.ts` cannot reach on its own: does the byte that
 *   leaves `POST /promote`'s Location header survive a browser-style redirect and arrive back at
 *   the renderer as the exact argument that makes it print the string — a real 303, a real query
 *   string, a real second request against a real running server. A renderer that is provably
 *   correct in isolation is still a renderer nothing calls correctly if the query flag it reads
 *   is spelled differently at the two ends, and only a live server can show that chain unbroken.
 *
 * The harness below is a deliberate, TRIMMED copy of `seam.test.ts`'s `withServer` — importing
 * that file would register its entire suite into this one, which `intakeMerge.seam.test.ts`
 * already documents as the reason its own copy exists.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

/** How long a server gets to answer its first request before the test fails (never hangs). */
const BOOT_DEADLINE_MS = 10_000;
/** Per-request ceiling, so a hung fetch cannot stall the suite. */
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-promote-route-"));
  tmpRoots.push(dir);
  return dir;
}

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
  /** Any method, with the headers back — needed for the 303's Location. Never follows redirects. */
  send(path: string, init?: RequestInit): Promise<Response>;
  /** GET a path, status and body only. */
  get(path: string): Promise<{ status: number; body: string }>;
  /** POST with a same-origin Origin header, exactly what a browser form submission sends. */
  post(path: string, form?: URLSearchParams): Promise<Response>;
}

/** Start the real server with the given environment, hand it to `body`, and always kill it. */
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
  const post = (path: string, form?: URLSearchParams) => send(path, { method: "POST", headers: { origin }, ...(form ? { body: form } : {}) });

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
    await body({ send, get, post });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

const leafDoc = (subject: string, id: string) =>
  JSON.stringify({ id, subject, leaflets: [] }, null, 2);

/** One approved candidate, evidence and review shape kept minimal — only the binding varies. */
const harvestDoc = (binding: { subject?: string; leafId?: string }) =>
  JSON.stringify(
    {
      ...binding,
      candidates: [
        {
          id: "git-cluster:promote-route",
          title: "cleanup: 2 commits",
          evidence: [{ source: "git", ref: "c".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "approved", by: "Tester", at: "2026-08-29T00:00:00.000Z" },
        },
      ],
    },
    null,
    2,
  );

test("POST /promote on an UNBOUND harvest: redirects with the caveat, and the queue renders it in plain words", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Legacy Subject", "leaf:promote-route-unbound"), "utf8");
  // NEITHER subject NOR leafId — the pre-F-014 shape, or a propose run with no --into.
  await writeFile(harvestPath, harvestDoc({}), "utf8");

  await withServer({ FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const promoted = await s.post("/promote");
    assert.equal(promoted.status, 303, "an unbound harvest still promotes — it is a caveat, not a refusal");
    assert.equal(
      promoted.headers.get("location"),
      "/review?promoted=unbound-legacy",
      "the redirect must carry the caveat forward — a 303 has no body to put it in otherwise",
    );

    // The leaflet actually landed: the promotion is real, not merely reported as one.
    const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
    assert.equal(leafAfter.leaflets.length, 1, "the approved candidate must actually be promoted");

    // FOLLOW THE REDIRECT OURSELVES (the harness never auto-follows) — the same GET a browser
    // makes next, landing on the same queue a CLI operator would see the identical caveat on.
    const queue = await s.get(promoted.headers.get("location") ?? "/review");
    assert.equal(queue.status, 200);
    assert.match(
      queue.body,
      /Unbound document — binding not checked/,
      `the web operator must see the same caveat the CLI prints for the identical case:\n${queue.body.slice(0, 2000)}`,
    );
  });
});

test("POST /promote on a BOUND, matching harvest: plain redirect, and the queue carries no caveat", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Bound Subject", "leaf:promote-route-bound"), "utf8");
  await writeFile(
    harvestPath,
    harvestDoc({ subject: "Bound Subject", leafId: "leaf:promote-route-bound" }),
    "utf8",
  );

  await withServer({ FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const promoted = await s.post("/promote");
    assert.equal(promoted.status, 303);
    assert.equal(
      promoted.headers.get("location"),
      "/review",
      "a CHECKED binding must not carry the unbound caveat onto the redirect",
    );

    const queue = await s.get(promoted.headers.get("location") ?? "/review");
    assert.equal(queue.status, 200);
    assert.doesNotMatch(
      queue.body,
      /Unbound document — binding not checked/,
      "a bound, matching promotion must not print a caveat that never applied to it",
    );
  });
});

test("GET /review with an unrelated ?promoted= query renders no caveat — the value is validated, not reflected", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Legacy Subject", "leaf:promote-route-spoof"), "utf8");
  await writeFile(harvestPath, harvestDoc({}), "utf8");

  await withServer({ FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const spoofed = await s.get("/review?promoted=anything-else");
    assert.equal(spoofed.status, 200);
    assert.doesNotMatch(
      spoofed.body,
      /Unbound document — binding not checked/,
      "only the exact value promoteApproved returns may trigger the notice",
    );
  });
});

test("approved work with no record leads to creating it, and the same panel then adds the work", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  // No leaf.json: the state a person reaches by collecting and approving before any record exists.
  await writeFile(harvestPath, harvestDoc({ subject: "Record Start", leafId: "record-start" }), "utf8");

  await withServer({ FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const create = /<a class="fol-button fol-button-primary" href="\/leaf\/setup"[^>]*>Create your private record<\/a>/;
    const queue = await s.get("/review");
    assert.equal(queue.status, 200);
    assert.match(queue.body, create);
    assert.match(queue.body, /No private record yet · <span class="fol-metric">1<\/span> approved/);
    assert.ok(!queue.body.includes('action="/promote"'), "nothing can be added before the record exists");
    assert.ok(!queue.body.includes(garden), "no local path in the panel");
    assert.doesNotMatch(queue.body, /could not be read|no leaf/);
    assert.match(queue.body, /Create it as Record Start, then add your approved draft here\./);
    for (const path of ["/", "/leaf/photosynthesis"]) {
      const page = await s.get(path);
      assert.equal([...page.body.matchAll(/fol-button-primary/g)].length, 1, `${path} has one primary action`);
      assert.match(page.body, create, `${path} names the next step by its effect`);
      assert.match(page.body, /Create it as Record Start, then add your 1 approved draft from Review\./, `${path} names the record the drafts were prepared for`);
    }
    // The queue is bound, and promote refuses any other subject or id: setup starts on its name.
    const setup = await s.get("/leaf/setup");
    assert.match(setup.body, /<input(?=[^>]*name="subject")(?=[^>]*value="Record Start")[^>]*>/);
    assert.match(setup.body, /Drafts in Review were prepared for Record Start\. Keep this name to add them to your record\./);

    const created = await s.post("/leaf/setup", new URLSearchParams({ action: "create", subject: "Record Start" }));
    assert.equal(created.status, 303);
    const ready = await s.get("/review");
    assert.doesNotMatch(ready.body, create);
    assert.match(ready.body, /Add 1 to leaf/, "the approved draft waits in the same panel once the record exists");
    const promoted = await s.post("/promote");
    assert.equal(promoted.status, 303);
    const leaf = JSON.parse(await readFile(leafPath, "utf8"));
    assert.deepEqual(leaf.leaflets.map((l: { id: string }) => l.id), ["git-cluster:promote-route"]);
  });
});

test("approved work bound to a record no new one can match is never promised to the new record", async () => {
  const garden = await tempDir();
  const harvestPath = join(garden, "harvest.json");
  // The subject's own name gives the id "record-start", so this binding cannot be met from setup.
  await writeFile(harvestPath, harvestDoc({ subject: "Record Start", leafId: "leaf:elsewhere" }), "utf8");

  await withServer({ FOLIAGE_LEAF: join(garden, "leaf.json"), FOLIAGE_HARVEST: harvestPath }, async (s) => {
    for (const path of ["/", "/leaf/photosynthesis", "/review"]) {
      const page = await s.get(path);
      assert.match(page.body, /Create your private record/, `${path} still leads to a record`);
      assert.match(page.body, /approved draft was prepared for another record and can&#39;t be added to a new one\./, path);
      assert.doesNotMatch(page.body, /then add/, `${path} promises no add`);
    }
    const setup = await s.get("/leaf/setup");
    assert.match(setup.body, /<input(?=[^>]*name="subject")[^>]*>/);
    assert.doesNotMatch(setup.body, /<input(?=[^>]*name="subject")(?=[^>]*value=)[^>]*>|prepared for/, "no name is suggested");
  });
});
