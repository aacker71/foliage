/**
 * `foliage policy`, END TO END — the real `foliage.mjs` entry point, spawning the real
 * `apps/leaf/policy.mjs` it passes through to.
 *
 * THE GAP: `apps/leaf/policy.mjs` defaults `--leaf`/`--policy` to files BESIDE THE SCRIPT
 * (`apps/leaf/leaf.json`, `apps/leaf/policy.json`) — correct for the script running on its own,
 * wrong for `foliage`, whose garden is `~/.foliage`. Before this fix, running the CLI's own
 * documented example (`node apps/leaf/policy.mjs show|check|deny|allow|drop`, which is what
 * `/policy`'s footnote told a reader to type) from an arbitrary directory judged leaflets by
 * whatever stray `apps/leaf/policy.json` happened to sit in a checkout, never the garden `foliage
 * up`/`foliage grow` actually write to. `foliage policy` closes the gap by injecting
 * `FOLIAGE_LEAF`/`FOLIAGE_POLICY` (the same two environment variables `foliage up` already sets
 * for its server — see that case's own comment in `foliage.mjs`) around the SAME, untouched
 * `policy.mjs`, so the CLI and the running app agree on which file "the policy" means.
 *
 * WHY ENVIRONMENT VARIABLES, NOT INJECTED `--leaf`/`--policy` FLAGS: `show` and `drop` parse
 * their arguments with `{ policy: { type: "string" } }` ONLY — no `leaf` option declared, under
 * `strict: true`. Injecting a bare `--leaf <path>` unconditionally would make `foliage policy
 * show` fail with an "unknown option" usage dump, the exact failure shape this whole slice
 * exists to stop reproducing. `policy.mjs` already reads `FOLIAGE_LEAF`/`FOLIAGE_POLICY` as a
 * fallback UNDER an explicit `--leaf`/`--policy` flag (see `leafPath()`/`policyFileToEdit()`),
 * so setting the environment is the one injection point every subcommand already honours, and an
 * explicit flag on the command line still wins.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-policy-passthrough-"));
  tmpRoots.push(dir);
  await mkdir(join(dir, ".foliage"), { recursive: true });
  return dir;
}

interface CliResult {
  readonly status: number;
  readonly output: string;
}

async function runFoliage(args: readonly string[], home: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [FOLIAGE_CLI, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("foliage policy show reads the garden's policy.json — not apps/leaf/policy.json beside the script", async () => {
  const home = await tempHome();
  // The garden's policy.json is deliberately ABSENT — the shipped default is the honest state
  // for a fresh garden, and its own message NAMES the path it searched, which is the assertion:
  // if this names apps/leaf/policy.json (the script-relative default), the injection failed.
  const result = await runFoliage(["policy", "show"], home);
  assert.equal(result.status, 0, `foliage policy show must succeed:\n${result.output}`);
  assert.match(result.output, /no policy document exists yet/);
  assert.match(
    result.output,
    /policy: from the shipped default rules \(no policy document at .*\.foliage[\\/]policy\.json\)/,
  );
});

test("an explicit --policy flag still wins over the injected garden default", async () => {
  const home = await tempHome();
  const customPath = join(home, "elsewhere-policy.json");
  await writeFile(
    customPath,
    JSON.stringify({
      rules: [{ id: "custom-override-rule", effect: "deny", match: { kind: "no-evidence" }, reason: "r" }],
    }),
    "utf8",
  );

  const result = await runFoliage(["policy", "show", "--policy", customPath], home);
  assert.equal(result.status, 0, `foliage policy show --policy must succeed:\n${result.output}`);
  assert.match(result.output, /custom-override-rule/, "the explicitly-named file's rule must be the one shown");
  assert.doesNotMatch(result.output, /no policy document exists yet/, "an explicit --policy must not fall back to the default");
});

test("foliage policy check reads the garden's leaf.json by default — the failure names the garden path, not apps/leaf/leaf.json", async () => {
  const home = await tempHome();
  // No leaf.json written anywhere in this garden: `check` must fail (there is nothing to judge)
  // and, crucially, must name the GARDEN's own leaf.json as the path it looked for — proof the
  // --leaf default was injected, not left at policy.mjs's own script-relative default (which
  // WOULD have succeeded here, against this repository's real, populated leaf.json, and hidden
  // the bug behind a passing command).
  const result = await runFoliage(["policy", "check"], home);
  assert.notEqual(result.status, 0, "check must fail: this garden has no leaf.json yet");
  assert.match(result.output, /no leaf document at .*\.foliage[\\/]leaf\.json/);
});

test("an explicit --leaf flag still wins over the injected garden default", async () => {
  const home = await tempHome();
  const customLeaf = join(home, "elsewhere-leaf.json");
  await writeFile(
    customLeaf,
    JSON.stringify({ id: "custom-leaf", subject: "Custom Subject", leaflets: [] }),
    "utf8",
  );

  const result = await runFoliage(["policy", "check", "--leaf", customLeaf], home);
  assert.equal(result.status, 0, `foliage policy check --leaf must succeed:\n${result.output}`);
  assert.match(result.output, /0 leaflet\(s\) in .*elsewhere-leaf\.json/);
});
