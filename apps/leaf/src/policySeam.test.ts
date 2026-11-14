/**
 * THE PUBLISH POLICY, THROUGH THE REAL USER PATH — real git history, the real commands, the real
 * server process, and HTTP.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `policy.test.ts`. That one proves the rules mean what they
 * say; this one proves SOMETHING ASKS THEM. The failure it is built to catch is the one this slice
 * was found in: a policy module with 123 green tests that no route, page or command ever called.
 * A rail nobody calls is a document about a rail, and no amount of unit testing distinguishes the
 * two — only a request to a listening socket does.
 *
 * Nothing here is a fixture standing in for a real thing:
 *   - the history is a real `git init` + real commits, not a hand-written leaf document;
 *   - the leaflets come out of `intake.mjs`, the command a person runs;
 *   - visibility is set by `share.mjs` and rules by `policy.mjs`, the commands a person runs;
 *   - the pages come from `server.mjs` over TCP.
 *
 * THE ONE CLAIM THIS FILE IS FOR: a `deny` rule beats the subject's own share, at publish time,
 * on a process that was already running when the rule was written. Everything else is the
 * scaffolding needed to state that honestly.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const SHARE = fileURLToPath(new URL("../share.mjs", import.meta.url));
const POLICY = fileURLToPath(new URL("../policy.mjs", import.meta.url));

const exec = promisify(execFile);

const BOOT_DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-policy-seam-"));
  tmpRoots.push(dir);
  return dir;
}

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

interface Running {
  get(path: string): Promise<{ status: number; body: string }>;
}

/** Start the real server with this environment, hand it to `body`, and always kill it. */
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

  const get = async (path: string): Promise<{ status: number; body: string }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`server did not answer in ${BOOT_DEADLINE_MS}ms: ${lastError}\n${stderr}`);
      }
      try {
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) await new Promise<void>((r) => child.once("exit", () => r()));
  }
}

async function git(repo: string, ...args: string[]): Promise<void> {
  await exec("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 30_000 });
}

const SUBJECT_EMAIL = "policy-subject@example.com";

/**
 * A REAL repository with four commits, one of which carries a person rating.
 *
 * The rating-shaped one is not decoration: it is the case that proves the default rails fire on
 * their own, with no rule the subject wrote. The ordinary engineering percentage beside it
 * proves the rail no longer mistakes a work measurement for a rating of the builder.
 */
async function realRepo(): Promise<string> {
  const repo = await tempDir();
  await git(repo, "init", "--quiet", "--initial-branch=main");
  const commits = [
    "feat: the loader stops collapsing four causes into one",
    "perf: cut p99 by 40% on the ranking pass",
    "fix: the roster stops sorting people by their evidence",
    "review: rated my engineering ability 4.5/5",
  ];
  for (const [i, message] of commits.entries()) {
    await writeFile(join(repo, `f-${i}.txt`), message, "utf8");
    await git(repo, "add", "-A");
    await git(repo, "-c", "user.name=Subject", "-c", `user.email=${SUBJECT_EMAIL}`, "commit", "-m", message);
  }
  return repo;
}

interface RawLeaflet {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  readonly visibility?: string;
}

async function leafletsOf(path: string): Promise<readonly RawLeaflet[]> {
  const doc = JSON.parse(await readFile(path, "utf8")) as { leaflets: RawLeaflet[] };
  return doc.leaflets;
}

/** Run one of the app's real commands and return what a person would have read on their terminal. */
async function run(script: string, args: readonly string[], env: Record<string, string> = {}) {
  const { stdout, stderr } = await exec(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return `${stdout}${stderr}`;
}

test(
  "the shipped default rails fire on real history, with no rule anyone wrote",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo();
    const dir = await tempDir();
    const leaf = join(dir, "leaf.json");
    await run(INTAKE, ["--repo", repo, "--subject", "Real Subject", "--identity", SUBJECT_EMAIL, "--out", leaf]);

    const leaflets = await leafletsOf(leaf);
    assert.equal(leaflets.length, 4, "one leaflet per real commit");
    assert.ok(
      leaflets.every((l) => l.tier === "pending"),
      "no signature can be checked here, so every tier is pending — the state a real user meets",
    );
    const rated = leaflets.find((l) => l.title.startsWith("review:"));
    const measured = leaflets.find((l) => l.title.includes("40%"));
    const ordinary = leaflets.find((l) => l.title.startsWith("fix: the roster"));
    assert.ok(rated !== undefined && measured !== undefined && ordinary !== undefined);

    // THE SUBJECT SHARES ALL THREE, by hand, through the real command. Whatever happens next is the
    // policy overriding a decision a person actually made — which is the only interesting case.
    for (const l of [rated, measured, ordinary]) await run(SHARE, ["share", l.id, "--as", "public", "--leaf", leaf], {});

    // No policy file at all: the rules in force are the shipped defaults.
    const policyPath = join(dir, "policy.json");
    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policyPath }, async (s) => {
      const denied = await s.get(`/leaflet/${encodeURIComponent(rated.id)}`);
      const measuredResponse = await s.get(`/leaflet/${encodeURIComponent(measured.id)}`);
      const allowed = await s.get(`/leaflet/${encodeURIComponent(ordinary.id)}`);

      // THE RAIL'S PRECISION IS MEASURED. Only the explicit person rating is withheld; the
      // engineering percentage and the ordinary title both remain shareable.
      assert.equal(denied.status, 404, "a rating-shaped title is refused by the default rail");
      assert.equal(denied.body.includes(rated.title), false, "the refusal restated the title");
      assert.equal(measuredResponse.status, 200, "sourced engineering measurements remain shareable");
      assert.equal(allowed.status, 200, "ordinary work the subject shared is served");
      assert.ok(allowed.body.includes(ordinary.title), "the served artifact is the one asked for");

      // AND THE SUBJECT IS TOLD, on their own page, WHICH RULE did it and why. The stranger at the
      // address learns nothing; the owner of the document learns everything.
      const own = await s.get("/leaf");
      assert.match(own.body, /data-withheld-by-rule="deny-rating-shaped-title"/);
      assert.match(own.body, /Withheld/);
      assert.match(own.body, /even though you shared it/);
    });
  },
);

test(
  "a deny rule written by example beats the subject's own share, on a process already running",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo();
    const dir = await tempDir();
    const leaf = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    await run(INTAKE, ["--repo", repo, "--subject", "Real Subject", "--identity", SUBJECT_EMAIL, "--out", leaf]);

    const target = (await leafletsOf(leaf)).find((l) => l.title.startsWith("feat:"));
    assert.ok(target !== undefined);
    await run(SHARE, ["share", target.id, "--as", "public", "--leaf", leaf]);

    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policyPath }, async (s) => {
      // 1. IT ANSWERS. The subject shared it and no rail objects — `no-rule-matched` withholds a
      //    PROPOSAL and deliberately does not revoke a share made by hand, or writing a policy
      //    would retroactively un-publish everything decided before it existed.
      const before = await s.get(`/leaflet/${encodeURIComponent(target.id)}`);
      assert.equal(before.status, 200);
      assert.ok(before.body.includes(target.title));

      // 2. THE RULE IS WRITTEN BY EXAMPLE, from the terminal, WHILE THE SERVER IS UP. Nothing is
      //    restarted and no cache is invalidated: the policy is re-read per request for the same
      //    reason the document is, because a cached rail is a rail that keeps publishing after
      //    its subject said stop.
      const said = await run(
        POLICY,
        [
          "deny",
          target.id,
          "--by",
          "evidence-ref",
          "--because",
          "That commit names a client I never got permission to publish.",
          "--leaf",
          leaf,
          "--policy",
          policyPath,
        ],
        {},
      );
      assert.match(said, /RAIL/, "the command says what kind of rule it just wrote");
      assert.match(said, /it beats\n?policy: your own share/);

      // THE FIRST WRITE MATERIALISED THE DEFAULTS TOO. Starting a subject from a one-rule file
      // would mean their first rule silently deleted four rails.
      const written = JSON.parse(await readFile(policyPath, "utf8")) as {
        rules: { id: string; effect: string }[];
      };
      const ids = written.rules.map((r) => r.id);
      assert.ok(ids.includes("deny-rating-shaped-title"), "the shipped rails were carried in");
      assert.ok(ids.includes("deny-excluded"));
      assert.equal(ids.at(-1), "deny-evidence-ref-" + target.id.slice("git:".length, "git:".length + 12));

      // 3. THE SAME ADDRESS NOW REFUSES — and the document still says `public`. The subject's act
      //    was not rewritten; it was overridden, which is the whole asymmetry.
      const after = await s.get(`/leaflet/${encodeURIComponent(target.id)}`);
      assert.equal(after.status, 404, "the rail did not beat the share");
      assert.equal(after.body.includes(target.title), false);
      const stillPublic = (await leafletsOf(leaf)).find((l) => l.id === target.id);
      assert.equal(stillPublic?.visibility, "public", "the rail edited the subject's document");

      // 4. AND IT IS NOT AN EXISTENCE ORACLE. A denied id answers identically to one nobody has,
      //    so nobody can learn what exists by trying — the same property the private/absent pair
      //    already has, extended to the third cause rather than punched through by it.
      const ghost = await s.get(`/leaflet/${encodeURIComponent("git:0000000000000000")}`);
      const normalise = (body: string, id: string) =>
        body.split(id).join("<ID>").split(encodeURIComponent(id)).join("<ID>");
      assert.equal(
        normalise(after.body, target.id),
        normalise(ghost.body, "git:0000000000000000"),
        "a policy-denied id answers differently from one nobody has",
      );
    });
  },
);

test(
  "a policy file that exists and does not parse serves nothing, and names the cause",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo();
    const dir = await tempDir();
    const leaf = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    await run(INTAKE, ["--repo", repo, "--subject", "Real Subject", "--identity", SUBJECT_EMAIL, "--out", leaf]);
    const target = (await leafletsOf(leaf)).find((l) => l.title.startsWith("feat:"));
    assert.ok(target !== undefined);
    await run(SHARE, ["share", target.id, "--as", "public", "--leaf", leaf]);

    // `effect: "maybe"` and a match kind that is not in the closed vocabulary. Both are refused
    // BY NAME by the domain gate; what is under test here is what the SERVER does about it.
    await writeFile(
      policyPath,
      JSON.stringify({ rules: [{ id: "x", effect: "maybe", match: { kind: "weight" }, reason: "" }] }),
      "utf8",
    );

    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policyPath }, async (s) => {
      const artifact = await s.get(`/leaflet/${encodeURIComponent(target.id)}`);
      // 503 AND NOT 404. Answering the privacy refusal here would hide an operator's broken file
      // behind a page that looks like it worked; answering 200 would publish under rules nobody
      // could read. It is the same answer for every id, so it discloses nothing about any of them.
      assert.equal(artifact.status, 503);
      assert.match(artifact.body, /the publish policy could not be read/);
      assert.match(artifact.body, /rules\[0\]\.effect/);
      assert.equal(artifact.body.includes(target.title), false);

      // The subject's own page goes down with it, deliberately: it prints titles and offers links,
      // and both are governed by the rail. It is also the loudest possible signal that their file
      // is broken — they meet it the moment they look, not when a stranger reads something.
      const own = await s.get("/leaf");
      assert.equal(own.status, 503);
      assert.match(own.body, /cause: invalid/);

      // FIXED IN PLACE, no restart: deleting the file restores the shipped defaults, and the
      // shared leaflet is served again. A fail-closed state a subject cannot get out of would be
      // a different bug.
      await rm(policyPath);
      const recovered = await s.get(`/leaflet/${encodeURIComponent(target.id)}`);
      assert.equal(recovered.status, 200);
    });
  },
);

test(
  "check and the server agree, because they resolve the policy through the same loader",
  { timeout: 120_000 },
  async () => {
    // THE BUG THIS REFUSES: a CLI that told the subject "SERVED" about an address that 404s. The
    // two surfaces cannot disagree while they share `loadPublishPolicy`, and this asserts the
    // sharing rather than trusting it — one is a child process reading a file, the other is a
    // long-running server answering HTTP, and only a comparison of the two proves they agree.
    const repo = await realRepo();
    const dir = await tempDir();
    const leaf = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    await run(INTAKE, ["--repo", repo, "--subject", "Real Subject", "--identity", SUBJECT_EMAIL, "--out", leaf]);

    const leaflets = await leafletsOf(leaf);
    for (const l of leaflets) await run(SHARE, ["share", l.id, "--as", "public", "--leaf", leaf]);

    const report = await run(POLICY, ["check", "--leaf", leaf, "--policy", policyPath]);
    const served = new Set(
      [...report.matchAll(/^policy:\s+SERVED\s+(\S+)/gm)].map((m) => m[1] as string),
    );
    const withheld = new Set(
      [...report.matchAll(/^policy:\s+WITHHELD\s+(\S+)/gm)].map((m) => m[1] as string),
    );
    assert.equal(served.size + withheld.size, leaflets.length, "every shared leaflet is accounted for");
    assert.ok(withheld.size > 0, "the fixture must reach the rail or this proves nothing");

    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policyPath }, async (s) => {
      for (const l of leaflets) {
        const res = await s.get(`/leaflet/${encodeURIComponent(l.id)}`);
        const expected = served.has(l.id) ? 200 : 404;
        assert.equal(res.status, expected, `check said ${served.has(l.id) ? "SERVED" : "WITHHELD"} about ${l.id}`);
      }
    });
  },
);

test(
  "check says \"you shared it\" only of a withheld row the subject actually shared",
  { timeout: 120_000 },
  async () => {
    // A deny rule fires whether or not a leaflet is shared. Printing "you shared it" on every
    // withheld row told the subject they had shared leaflets they never touched.
    const repo = await realRepo();
    const dir = await tempDir();
    const leaf = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    await run(INTAKE, ["--repo", repo, "--subject", "Real Subject", "--identity", SUBJECT_EMAIL, "--out", leaf]);

    const leaflets = await leafletsOf(leaf);
    const shared = leaflets.find((l) => l.title.startsWith("fix: the roster"));
    assert.ok(shared !== undefined);
    await run(SHARE, ["share", shared.id, "--as", "public", "--leaf", leaf]);
    // Every leaflet here is pending, so a rule by tier reaches the shared row and the three that
    // are not shared.
    await run(POLICY, ["deny", shared.id, "--by", "tier", "--because", "Nothing pending goes outward.", "--leaf", leaf, "--policy", policyPath]);

    const report = await run(POLICY, ["check", "--leaf", leaf, "--policy", policyPath]);
    const rows = new Map(
      [...report.matchAll(/^policy:\s+WITHHELD\s+(\S+)\s+\((.*)\)$/gm)].map((m) => [m[1] as string, m[2] as string]),
    );
    assert.equal(rows.size, leaflets.length, "the rule reaches every row, shared or not");
    assert.match(rows.get(shared.id) ?? "", /^you shared it; rule \S+ refuses it$/);
    for (const l of leaflets.filter((l) => l.id !== shared.id)) {
      assert.match(rows.get(l.id) ?? "", /^stays private even if shared; rule \S+$/, `${l.id} was never shared`);
    }
  },
);
