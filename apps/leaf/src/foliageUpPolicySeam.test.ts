/**
 * Exercise the real foliage up launcher with an isolated garden policy.
 * The private Overview is intentionally about work and review; policy counts belong on /policy.
 * This seam proves the launcher resolves the garden policy rather than a repo-relative default,
 * and that the commands /publish prints run exactly as printed.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const BOOT_DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-up-seam-"));
  tmpRoots.push(dir);
  await mkdir(join(dir, ".foliage"), { recursive: true });
  return dir;
}

/** Same probe-then-close technique every other seam test in this app already uses. */
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

/**
 * Boot `foliage up` for real, with `HOME` redirected to an isolated garden, hand it to `body`, and
 * always kill the whole process TREE — `up` spawns `server.mjs` as its own child, so killing only
 * the PID this function receives would orphan a listening server. `detached: true` makes this
 * process the leader of a fresh process group; `server.mjs`, spawned from inside it without its
 * own `detached`, inherits that same group, so `process.kill(-pid, ...)` reaches both.
 */
async function withFoliageUp(
  home: string,
  body: (s: Running) => Promise<void>,
  env: Readonly<Record<string, string>> = {},
): Promise<void> {
  const port = await freePort();
  const { FOLIAGE_SOURCE_REPO: _ambient, ...inherited } = process.env;
  const child = spawn(process.execPath, [FOLIAGE_CLI, "up", "--port", String(port)], {
    env: { ...inherited, HOME: home, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout?.on("data", (b: Buffer) => {
    output += b.toString();
  });
  child.stderr?.on("data", (b: Buffer) => {
    output += b.toString();
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
        throw new Error(`foliage up exited before serving: ${exited}\noutput:\n${output}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`foliage up did not answer in ${BOOT_DEADLINE_MS}ms: ${lastError}\n${output}`);
      }
      try {
        await get("/policy");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get });
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    if (exited === null) await new Promise<void>((r) => child.once("exit", () => r()));
  }
}

/** Extract one `data-*-stat="<name>"` cell's number, the same shape both pages now carry. */
function statValue(html: string, marker: string): number | null {
  const m = new RegExp(`${marker}[\\s\\S]*?fol-metric leaf-count">(\\d+)<`).exec(html);
  return m ? Number(m[1]) : null;
}

test(
  "foliage up wires FOLIAGE_POLICY to the garden — /policy reads the garden's own policy.json",
  { timeout: 30_000 },
  async () => {
    const home = await tempHome();
    // Four rules, deliberately NOT the shipped default's five — if the running app fell back to
    // the default (no `FOLIAGE_POLICY` set) or to some other stray file, this count would not
    // appear on either page, and the test would fail loudly rather than by coincidence.
    const policyPath = join(home, ".foliage", "policy.json");
    await writeFile(
      policyPath,
      JSON.stringify({
        rules: [
          { id: "garden-r1", effect: "deny", match: { kind: "no-evidence" }, reason: "r1" },
          { id: "garden-r2", effect: "deny", match: { kind: "tier", tier: "excluded" }, reason: "r2" },
          { id: "garden-r3", effect: "allow", match: { kind: "tier", tier: "verified" }, reason: "r3" },
          { id: "garden-r4", effect: "allow", match: { kind: "tier", tier: "pending" }, reason: "r4" },
        ],
      }),
      "utf8",
    );

    await withFoliageUp(home, async (s) => {
      const overview = await s.get("/");
      const policy = await s.get("/policy");
      assert.equal(overview.status, 200);
      assert.equal(policy.status, 200);

      const policyCount = statValue(policy.body, 'data-policy-stat="rules"');
      assert.equal(policyCount, 4, "/policy must read the garden policy.json");
      assert.doesNotMatch(overview.body, /data-overview-stat="rules-in-force"/);

      // And the rule ids from the garden document are the ones actually quoted back — proof this
      // is the garden's file and not a coincidentally-four-rule stand-in.
      assert.match(policy.body, /garden-r1/);
      assert.match(policy.body, /garden-r4/);
    });
  },
);

/**
 * D8 — `foliage up` names the source repository for portfolio work dates. Before, it never set
 * FOLIAGE_SOURCE_REPO, so every git item on /leaf read "No work date". A temp repository holds one
 * synthetic commit; the leaf cites it; the harvest records the repository. Nothing else is set.
 */
test(
  "foliage up dates the portfolio from the harvest's repository, and an explicit FOLIAGE_SOURCE_REPO wins",
  { timeout: 30_000 },
  async () => {
    const home = await tempHome();
    const repo = join(home, "repo");
    const other = join(home, "other");
    for (const dir of [repo, other]) {
      await mkdir(dir);
      const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
      git("init", "--initial-branch=main");
      git("config", "user.email", "up-seam@foliage.invalid");
      git("config", "user.name", "Up seam test");
      await writeFile(join(dir, "note.txt"), dir);
      git("add", "note.txt");
      execFileSync("git", ["-C", dir, "commit", "-m", "feat: synthetic dated work"], {
        env: { ...process.env, GIT_AUTHOR_DATE: "2026-03-04T05:06:07Z", GIT_COMMITTER_DATE: "2026-03-04T05:06:07Z" },
      });
    }
    const ref = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    await writeFile(join(home, ".foliage", "leaf.json"), JSON.stringify({
      id: "up-seam", subject: "Up seam test",
      leaflets: [{ id: "git:dated", title: "Synthetic dated work", tier: "pending", provenance: { source: "git", ref, observedAt: "2026-09-01T00:00:00Z" } }],
    }));
    await writeFile(join(home, ".foliage", "harvest.json"), JSON.stringify({ repo, candidates: [] }));
    const dateOf = (html: string) => /data-leaflet="git:dated"[^>]*data-date="([^"]*)"/.exec(html)?.[1];

    await withFoliageUp(home, async (s) => {
      const leaf = await s.get("/leaf?records=source");
      assert.equal(leaf.status, 200);
      assert.equal(dateOf(leaf.body), "2026-03-04T05:06:07Z");
    });
    // The other repository does not hold the ref: an explicit choice is honoured, not second-guessed.
    await withFoliageUp(home, async (s) => {
      const leaf = await s.get("/leaf?records=source");
      assert.equal(dateOf(leaf.body), "");
      assert.doesNotMatch(leaf.body, /2026-03-04T05:06:07Z/);
    }, { FOLIAGE_SOURCE_REPO: other });
  },
);

/**
 * The commands /publish prints are pasted into a shell, so they are proved by running them that
 * way: from a directory that is neither the checkout nor the garden, with no FOLIAGE_* variable.
 * A bare `foliage …` exited 127 there (no such binary is installed); the printed form names the
 * launcher and the garden `up` served, so the share lands in the very leaf the page read.
 */
test(
  "foliage up's /publish prints share and export commands that run as printed, from any folder",
  { timeout: 60_000 },
  async () => {
    const home = await tempHome();
    const leafPath = join(home, ".foliage", "leaf.json");
    await writeFile(leafPath, JSON.stringify({
      id: "up-publish", subject: "Up publish seam",
      // Cites evidence, so the default policy's no-evidence rule leaves it Private, not Withheld.
      leaflets: [{ id: "git:printed", title: "Synthetic printed work", tier: "pending", provenance: { source: "git", ref: "0123abc", observedAt: "2026-09-01T00:00:00Z" } }],
    }));
    const elsewhere = join(home, "elsewhere");
    await mkdir(elsewhere);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FOLIAGE_")));
    const shell = (command: string) => execFileSync("sh", ["-c", command], { cwd: elsewhere, env, encoding: "utf8", timeout: 30_000 });
    const unescape = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

    let share = "";
    let exportCommand = "";
    await withFoliageUp(home, async (s) => {
      const page = await s.get("/publish?view=private");
      assert.equal(page.status, 200);
      const codes = [...page.body.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => unescape(m[1]!));
      assert.equal(codes.length, 3, `one row command and the two Command line commands: ${codes.join(" | ")}`);
      share = codes[0]!;
      exportCommand = codes[2]!;
      assert.match(share, / share git:printed --as public --garden /);
      assert.match(exportCommand, / export --out <dir> --garden /);
    });

    shell(share);
    const shared = JSON.parse(await readFile(leafPath, "utf8")) as { leaflets: { id: string; visibility?: string }[] };
    assert.equal(shared.leaflets.find((l) => l.id === "git:printed")?.visibility, "public");

    // `<dir>` is the one word a person fills in.
    const out = join(home, "site");
    shell(exportCommand.replace("<dir>", out));
    assert.ok(existsSync(join(out, "index.html")), "the export wrote the static folder");
  },
);
