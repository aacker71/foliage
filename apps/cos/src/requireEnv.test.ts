/**
 * `requireEnv` in cos.mjs: whitespace is not a value, and a value is never rewritten.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT — the same reason `cos.seam.test.ts` gives, plus one this
 * file has no way around: `cos.mjs` is an entry point that ends in `exit(await main())`, so it
 * exports nothing and importing it would run the CLI and kill the test process. The function under
 * test is therefore reachable only the way a person reaches it, by running the command. That is
 * the stronger test anyway: it proves the resolver's verdict actually arrives at the screen, which
 * is where the defect was visible.
 *
 * WHAT WAS WRONG, MEASURED BEFORE THE FIX ON A REAL STORE (2026-08-28). `requireEnv` tested
 * `v === ""` while `readMayCross`, seven lines above it in the same file, tested `raw.trim() === ""`.
 * Two config resolvers one screen apart disagreed about what "set" means:
 *
 *   FOLIAGE_COS_SECRET="   " … list  →  `STORE could not open — key-mismatch`, "this secret is not
 *                                       the one it was created with". Three spaces reached scrypt.
 *                                       The person is told their PASSPHRASE is wrong when the truth
 *                                       is their VARIABLE is empty, and goes looking for a secret
 *                                       they never lost.
 *   FOLIAGE_COS_SECRET="  "  … init  →  exit 0, a 20,480-byte encrypted store created on disk, key
 *                                       derived from two spaces, printing `STATE empty — nothing
 *                                       declared yet`. Nothing on the screen said the secret was
 *                                       blank. A near-empty secret reaching the KDF is not a weaker
 *                                       secret; it is an undetected one.
 *
 * Both of those are asserted against below, so reverting the trim fails this file rather than
 * quietly restoring the misdiagnosis.
 *
 * AND THE OTHER HALF, WHICH IS THE PART A NAIVE FIX BREAKS. Trimming decides whether something is
 * THERE; it is never applied to what is handed on. The secret feeds scrypt directly, so trimming
 * the returned string would change the derived key and lock a person out of a store they created
 * with a padded passphrase — while telling them `key-mismatch`, from the very code that altered it.
 * `whitespace inside a real secret is carried through byte-for-byte` proves the value survives
 * intact; it fails if someone "tidies up" by returning `v.trim()`.
 *
 * COST. Opening or creating a store derives a key with scrypt at N=2^17 — about 270ms. Only the
 * three tests that genuinely need a real store on disk pay it; the absent-variable tests reach
 * their verdict before any KDF runs, which is itself the behaviour being asserted.
 */

import { match, ok, strictEqual } from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const CLI = fileURLToPath(new URL("../cos.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** A real passphrase for the real store this file creates. Nothing derived from it is stored. */
const SECRET = "a passphrase this test chose, and it has words in it";

let dir = "";
let storePath = "";

interface Run {
  readonly code: number;
  readonly stdout: string;
}

/**
 * Run the CLI with an environment built FROM SCRATCH, never inherited-and-patched: a
 * `FOLIAGE_COS_SECRET` exported in the developer's shell would otherwise fill in exactly the
 * variable these tests are trying to prove absent, and every assertion here would pass for the
 * wrong reason. `PATH` and `HOME` are carried because Node wants them; nothing else is.
 *
 * A variable is omitted by passing `null`, which is a different input from `""` and from `"  "` —
 * all three must reach the same verdict, and the test can only say that if it can express all three.
 */
function run(
  args: readonly string[],
  vars: Readonly<Record<string, string | null>>,
): Promise<Run> {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
  };
  for (const [k, v] of Object.entries(vars)) if (v !== null) env[k] = v;
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: REPO, env }, (error, stdout) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, stdout: String(stdout) });
    });
  });
}

/** Does this path exist? Used to assert that a refused `init` wrote NOTHING, not just said so. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "foliage-cos-requireenv-"));
  storePath = join(dir, "store.foliage");
  const created = await run(["init"], {
    FOLIAGE_COS_STORE: storePath,
    FOLIAGE_COS_SECRET: SECRET,
  });
  strictEqual(created.code, 0, `the fixture store must actually exist:\n${created.stdout}`);
});

after(async () => {
  if (dir !== "") await rm(dir, { recursive: true, force: true });
});

/**
 * The headline. A REAL store exists and a REAL passphrase would open it — so a whitespace-only
 * secret is the one input where the two possible answers are farthest apart: "your secret is
 * wrong" (what it said) versus "you have not set your secret" (what is true).
 */
test("a whitespace-only secret is reported ABSENT BY NAME, not as a wrong key", async () => {
  const r = await run(["list"], {
    FOLIAGE_COS_STORE: storePath,
    FOLIAGE_COS_SECRET: "   ",
  });

  strictEqual(r.code, 1);
  match(r.stdout, /STORE\s+not configured/);
  match(r.stdout, /missing: FOLIAGE_COS_SECRET/);

  // The regression itself, named: three spaces must not reach the KDF. Before the trim this line
  // read `could not open — key-mismatch`, which is a true sentence about a key and a false one
  // about this person's situation.
  ok(
    !r.stdout.includes("key-mismatch"),
    `a blank secret must never be reported as the wrong secret:\n${r.stdout}`,
  );
});

/**
 * The damaging case, because it SUCCEEDS. `init` creates, so before the trim a whitespace secret
 * did not fail — it wrote an encrypted store keyed on two spaces and exited 0. Asserting the file
 * is absent afterwards is what makes this test unfakeable by a message-only fix.
 */
test("`init` with a whitespace-only secret refuses and writes no store file", async () => {
  const fresh = join(dir, "never-created.foliage");
  const r = await run(["init"], {
    FOLIAGE_COS_STORE: fresh,
    FOLIAGE_COS_SECRET: "  ",
  });

  strictEqual(r.code, 1);
  match(r.stdout, /missing: FOLIAGE_COS_SECRET/);
  strictEqual(
    await exists(fresh),
    false,
    "a store keyed on whitespace must not exist on disk, however it was reported",
  );
});

/**
 * The other variable through the same resolver. Whitespace in the PATH is the quieter failure —
 * `FOLIAGE_COS_STORE=" "` would otherwise name a file called " " relative to the cwd — so it gets
 * the same verdict rather than a second convention.
 */
test("a whitespace-only store path is reported absent by name", async () => {
  const r = await run(["list"], {
    FOLIAGE_COS_STORE: " ",
    FOLIAGE_COS_SECRET: SECRET,
  });

  strictEqual(r.code, 1);
  match(r.stdout, /missing: FOLIAGE_COS_STORE/);
});

/**
 * Unset, empty and whitespace are three different inputs and ONE verdict. Listing both names on
 * one line rather than stopping at the first is existing behaviour in `openConfiguredStore`; it is
 * asserted here because the trim is what lets whitespace reach that code path at all.
 */
test("unset, empty and whitespace-only all reach the same verdict, and both names are listed", async () => {
  const cases: ReadonlyArray<readonly [string, string | null, string | null]> = [
    ["unset", null, null],
    ["empty string", "", ""],
    ["whitespace only", "  ", "\t \n"],
  ];

  for (const [label, store, secret] of cases) {
    const r = await run(["list"], {
      FOLIAGE_COS_STORE: store,
      FOLIAGE_COS_SECRET: secret,
    });
    strictEqual(r.code, 1, `${label}: expected the unconfigured exit code\n${r.stdout}`);
    match(r.stdout, /STORE\s+not configured/, `${label}: expected "not configured"`);
    match(
      r.stdout,
      /missing: FOLIAGE_COS_STORE, FOLIAGE_COS_SECRET/,
      `${label}: both missing variables must be named, not just the first`,
    );
  }
});

/**
 * NEVER SHIP A SILENT REWRITER — the guard on the fix itself.
 *
 * `requireEnv` trims to DECIDE, and returns the value untouched. If it ever returns `v.trim()`,
 * this store — created with a passphrase that has a leading and a trailing space — becomes
 * unopenable with the exact secret that created it, and the CLI blames the person's key. The
 * second half proves the padding is load-bearing rather than incidental: the unpadded string is a
 * different secret and is correctly refused.
 */
test("whitespace inside a real secret is carried through byte-for-byte, never trimmed", async () => {
  const padded = join(dir, "padded-secret.foliage");
  const paddedSecret = "  a real passphrase, padded on purpose  ";

  const created = await run(["init"], {
    FOLIAGE_COS_STORE: padded,
    FOLIAGE_COS_SECRET: paddedSecret,
  });
  strictEqual(created.code, 0, `a padded secret is a real secret:\n${created.stdout}`);

  const reopened = await run(["list"], {
    FOLIAGE_COS_STORE: padded,
    FOLIAGE_COS_SECRET: paddedSecret,
  });
  strictEqual(
    reopened.code,
    0,
    `the secret that created the store must open it, padding included:\n${reopened.stdout}`,
  );

  const trimmedAttempt = await run(["list"], {
    FOLIAGE_COS_STORE: padded,
    FOLIAGE_COS_SECRET: paddedSecret.trim(),
  });
  strictEqual(trimmedAttempt.code, 1);
  match(
    trimmedAttempt.stdout,
    /key-mismatch/,
    "the trimmed string is a DIFFERENT secret; if this opens the store the value was rewritten",
  );
});
