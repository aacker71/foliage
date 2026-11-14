/**
 * THE PERSONAL-DATA IGNORE RULES, AS A GATE RATHER THAN A CLAIM.
 *
 * `.gitignore` carries a long block explaining why leaf documents, tree manifests, harvest
 * documents and publish policies may never be committed — "A leaf document holds a real person's
 * name, their email identity and up to hundreds of verbatim commit titles; a tree manifest holds
 * an organization's roster. Neither may ever be committed." — and it ends by saying the rules were
 * "Verified with `git check-ignore -v`".
 *
 * THAT VERIFICATION HAD NOTHING HOLDING IT, which is this repository's own named anti-pattern:
 * `.loop/FINDINGS.md` opens by recording that `F-001`'s bypass "was described in `cos.mjs`'s own
 * header, under a heading arguing it was correct", and concludes "Documenting a defect is not
 * fixing it, and a comment is not a gate." A one-time manual `check-ignore` written down in prose
 * is the same shape: it was true when typed, and nothing notices when an edit breaks it.
 *
 * WHAT IT WAS MISSING, MEASURED 2026-09-04. The block claimed a two-layer defence — default
 * locations anchored, "NAMING CONVENTIONS ignored everywhere so the documented way of writing one
 * is safe by default". Only the DOTTED conventions were ignored everywhere. The BARE names are
 * equally documented — they are what the tools write by default — and were anchored to their
 * default locations alone, so `apps/canopy/deploy/tree.json`, `some/where/leaf.json`,
 * `tools/x/harvest.json` and `a/b/policy.json` were all committable. Found while preparing a
 * deployment whose plan puts a real tree manifest at exactly the first of those paths.
 *
 * `git check-ignore` is asked about paths that DO NOT EXIST, deliberately: the question is whether
 * the rule would catch the file, not whether somebody has already made one.
 */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Does any ignore RULE match this path? Exit 0 means yes, 1 means no.
 *
 * `--no-index` IS LOAD-BEARING AND ITS ABSENCE MADE THE EXCEPTION TEST BELOW VACUOUS. git's own
 * manual: "By default, tracked files are not shown at all since they are not subject to exclude
 * rules." `apps/leaf/example/leaf.example.json` is tracked, so the default invocation answered
 * "not ignored" for it unconditionally — no matter what the rules said. Measured: replacing the
 * bare `leaf.json` rule with `*.json`, which swallows every JSON file in the repository, left the
 * test green. The assertion could only ever have failed if somebody untracked the file.
 *
 * With `--no-index` the question is the one both tests actually mean: does the RULE SET match this
 * path, independent of whether a file is there or whether git is already tracking it.
 */
async function isIgnored(path) {
  try {
    await exec("git", ["-C", REPO, "check-ignore", "-q", "--no-index", path], { timeout: 30_000 });
    return true;
  } catch (err) {
    if (err !== null && typeof err === "object" && "code" in err && err.code === 1) return false;
    throw err;
  }
}

/**
 * Both spellings of every document that holds personal data, in a directory nobody has created.
 * The dotted form is the convention the docs teach; the bare form is what the tools write.
 */
const MUST_BE_IGNORED = [
  // The path that exposed the gap: the deployment plan makes this file load-bearing.
  "apps/canopy/deploy/tree.json",
  "apps/canopy/deploy/site/tree.json",
  "tree.json",
  "leaf.json",
  "harvest.json",
  "policy.json",
  "a/deep/directory/tree.json",
  "a/deep/directory/leaf.json",
  "a/deep/directory/harvest.json",
  "a/deep/directory/policy.json",
  "a/deep/directory/acme.tree.json",
  "a/deep/directory/rowan.leaf.json",
  "a/deep/directory/monday.harvest.json",
  "a/deep/directory/rowan.policy.json",
  "apps/leaf/harvest.json",
  "apps/leaf/policy.json",
  "apps/canopy/tree.json",
  // The FIFTH garden document. Every entry carries an absolute path into somebody's home
  // directory and the addresses they commit under, and it is written by an unattended agent —
  // the document most likely to be committed by accident, so it is pinned like the other four.
  "sources.json",
  "apps/leaf/sources.json",
  "a/deep/directory/sources.json",
  "a/deep/directory/rowan.sources.json",
  // Beside the ONE tracked carve-out (`!tools/vault/sources.json`, below): the negation is a
  // file, not a directory, so a sibling directory and a deeper one are both still caught.
  "tools/x/sources.json",
  "connection.json",
  "hosted/connection.json",
  "a/deep/garden/hosted/connection.json",
  "a/deep/garden/account.connection.json",
  "hosted/status.json",
  "a/deep/garden/hosted/status.json",
  "tools/vault/deeper/sources.json",
];

test("every spelling of a personal-data document is ignored, in any directory", async () => {
  for (const path of MUST_BE_IGNORED) {
    assert.equal(
      await isIgnored(path),
      true,
      `${path} is committable. A leaf document carries a real person's name, their email identity ` +
        `and verbatim commit titles; a tree manifest carries an organization's roster. The rule is ` +
        `that both spellings — the documented convention AND the bare default name the tools write ` +
        `— are ignored everywhere, so writing one in a new directory is safe by default`,
    );
  }
});

/**
 * EVERY FILE A GARDEN CAN HOLD, NOT ONLY ITS DOCUMENTS.
 *
 * The list above names documents. A garden is a directory (`~/.foliage`, or wherever `--garden`
 * and `FOLIAGE_GARDEN` put it), and the tools write more into it than documents. Measured on
 * fa29203 with a garden at `nested/garden/`: the first seven entries below were ignored and every
 * other one was not — among them `workflow/workflow.json`, the canopy's
 * `published/` files, the owner's email in `allowed_signers`, and full copies of the leaf and
 * the harvest that `foliage migrate-queue --apply` leaves behind as backups.
 *
 * Each entry names the code that writes it, so the list can be checked again when a writer moves.
 * Not listed: `site/`, the copy `foliage export` writes by default. It holds only the work the
 * person shared and is meant to be hosted, and `site` names tracked source in this repository.
 */
const GARDEN_FILES = [
  ["leaf.json", "foliage.mjs (LEAF)"],
  ["harvest.json", "foliage.mjs (HARVEST)"],
  ["policy.json", "foliage.mjs (POLICY)"],
  ["sources.json", "foliage.mjs (SOURCES)"],
  ["scarlet-model.json", "apps/leaf/src/scarletModelSetup.ts"],
  ["hosted/status.json", "foliage.mjs (FOLIAGE_HOSTED_STATUS)"],
  ["hosted/connection.json", "foliage.mjs (FOLIAGE_HOSTED_STATE)"],
  [".scarlet-model.json.0b0e7a52-6f1c-4d5e-9a63-2a4f4b6f1c11.tmp", "apps/leaf/src/scarletModelSetup.ts (temp)"],
  ["hosted/connection.json.local-lock", "apps/canopy/src/localHostedBridge.ts via localFiles.ts"],
  ["workflow/workflow.json", "apps/leaf/src/workflow.ts"],
  ["workflow/owner.lock", "apps/leaf/src/workflow.ts"],
  ["workflow/workflow.json.0b0e7a52-6f1c-4d5e-9a63-2a4f4b6f1c11.tmp", "apps/leaf/src/workflow.ts (temp)"],
  // The QA repro's own spelling: anything at all inside the garden's publications directory.
  ["published/x.json", "QA #33 repro"],
  ["published/rowan.published.json", "apps/canopy/src/publishedLeaf.ts (PUBLISHED_SUFFIX)"],
  ["published/rowan.published.json.lock", "apps/canopy/src/publicationLock.mjs"],
  ["published/rowan.published.json.lock.owner.0b0e7a52-6f1c-4d5e-9a63-2a4f4b6f1c11", "apps/canopy/src/publicationLock.mjs"],
  ["published/assessments/rowan.json", "apps/canopy/src/assessmentPublication.ts"],
  [`media/sha256/ab/${"ab".repeat(32)}/published`, "apps/leaf/src/mediaStore.ts (object)"],
  [`media/sha256/ab/${"ab".repeat(32)}/manifest.json`, "apps/leaf/src/mediaStore.ts (manifest)"],
  [`media/sha256/ab/${"ab".repeat(32)}/published.tmp-4242-1`, "apps/leaf/src/mediaStore.ts (temp)"],
  ["ladybug.json", "apps/canopy/src/ladybugWorkspace.ts"],
  ["ladybug.json.lock", "apps/canopy/src/assessmentFiles.ts via publicationLock.mjs"],
  ["private-brain-receipts.jsonl", "apps/leaf/private-brain.mjs"],
  ["allowed_signers", "foliage.mjs verify --setup"],
  ["app.log", "foliage.mjs install (app plist)"],
  ["grow.log", "foliage.mjs install (grow plist)"],
  ["leaf.json.local-lock", "packages/leaf/src/localFiles.ts (lock)"],
  ["harvest.json.local-lock", "packages/leaf/src/localFiles.ts (lock)"],
  ["leaf.json.write-4242-0b0e7a52-6f1c-4d5e-9a63-2a4f4b6f1c11.tmp", "packages/leaf/src/localFiles.ts (temp)"],
  ["sources.json.tmp-4242", "apps/leaf/sources.mjs (temp)"],
  ["harvest.before-adopt-1759400000000.json", "apps/leaf/harvest.mjs adopt --apply (backup)"],
  ["leaf.before-adopt-1759400000000.json", "apps/leaf/harvest.mjs adopt --apply (backup)"],
];

/** Where a garden can sit inside a checkout: QA's nested garden, and the default name anywhere. */
const GARDEN_ROOTS = ["nested/garden", "a/deep/directory/subjects/rowan", ".foliage", "a/home/.foliage"];

test("a garden placed inside a checkout leaves nothing committable", () => {
  const writers = new Map(GARDEN_ROOTS.flatMap((root) => GARDEN_FILES.map(([file, writer]) => [`${root}/${file}`, writer])));
  // One call for the whole list; `-v -n` prints `::<TAB>path` for each path no rule matches.
  const answer = spawnSync("git", ["-C", REPO, "check-ignore", "--no-index", "--stdin", "--verbose", "--non-matching"], {
    input: `${[...writers.keys()].join("\n")}\n`,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ok(answer.status === 0 || answer.status === 1, answer.stderr);
  const lines = answer.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, writers.size, `check-ignore answered ${lines.length} of ${writers.size} paths:\n${answer.stdout}`);
  const committable = lines
    .filter((line) => line.startsWith("::\t"))
    .map((line) => `${line.slice(3)}  (written by ${writers.get(line.slice(3))})`);
  assert.deepEqual(
    committable,
    [],
    `garden files git would let somebody commit. Each holds, or is a copy of, a person's own ` +
      `portfolio data, or sits beside one under its name:\n${committable.join("\n")}`,
  );
});

test("the shipped example leaf stays tracked, because the exception is deliberate", async () => {
  /*
   * `.gitignore`'s own comment names this file: "`apps/leaf/example/leaf.example.json` does NOT
   * end in `.leaf.json` and is deliberately still tracked." It is the fabrication-band fixture —
   * a document that declares itself an example and describes nobody — and several CONTROL tests
   * read it from the repository. An over-broad rule that swallowed it would redden those tests
   * somewhere far from here, so the exception is asserted where the rule is.
   *
   * THIS ASSERTION WAS VACUOUS IN ITS FIRST FORM and only a mutation caught it — see `isIgnored`.
   * A guard that cannot fail is worse than no guard, because the file it sits in claims coverage.
   */
  assert.equal(
    await isIgnored("apps/leaf/example/leaf.example.json"),
    false,
    "the shipped example document is now ignored; the band CONTROL tests read it from the repo",
  );
});

test("no tracked file is shadowed by an ignore rule", async () => {
  /*
   * THE OTHER DIRECTION, and it has a corpse. The bare-name block above promised "nothing in the
   * tree carried any of these names, so nothing was untracked by adding them" — true for four
   * names and false for the fifth: adding bare `sources.json` shadowed `tools/vault/sources.json`,
   * a tracked, unrelated file. git goes on tracking a shadowed file, so nothing failed; what
   * breaks is everything that reads the RULES instead of the index — measured: `rg` stopped
   * searching it, a fresh copy cannot be `git add`ed, and a move or re-creation untracks it
   * silently. The positive test cannot notice any of this, because it only asks about paths that
   * do not exist. So: every tracked path, through the rule set.
   */
  const { stdout: tracked } = await exec("git", ["-C", REPO, "ls-files"], { timeout: 30_000 });
  const shadowed = spawnSync("git", ["-C", REPO, "check-ignore", "--no-index", "--stdin"], {
    input: tracked,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ok(shadowed.status === 0 || shadowed.status === 1, shadowed.stderr);
  assert.equal(
    shadowed.stdout,
    "",
    `tracked files an ignore rule now shadows (tools that honour .gitignore stop seeing them):\n${shadowed.stdout}`,
  );
});
