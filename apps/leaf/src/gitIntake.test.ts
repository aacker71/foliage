/**
 * Tests for the git READ, against REAL repositories this file builds.
 *
 * There are no fixtures here. Each test runs `git init` and makes real commits, so the shas are
 * genuine object names produced by git itself — `refsAreRealObjects` proves it by handing them
 * back to `git cat-file`. That is the point: a test asserting that intake returns "abc123"
 * would prove only that a constant survived a function call, whereas the property that actually
 * matters is that every ref intake emits resolves in the repository it came from.
 *
 * The multi-author and empty-message repositories below are TEST CONSTRUCTION, not product
 * evidence. They exist because the `excluded` path and the blank-title path cannot otherwise be
 * exercised, and they say nothing about what any real portfolio contains.
 *
 * THE SIGNED CASES USE REAL CRYPTOGRAPHY. `signingKey` runs stock `ssh-keygen` to make a real
 * throwaway ed25519 key and git signs with it, so the `gpgsig` header those tests read is an
 * actual SSHSIG block over an actual commit — not a hand-written string that looks like one.
 * Which verdict git then returns is steered through `gpg.ssh.allowedSignersFile`, set REPO-LOCALLY
 * because that is where the published recipe puts it and because it is the one signing key the
 * reader deliberately still honours from a repository. If `ssh-keygen` is absent the affected
 * tests report themselves SKIPPED; they never pass quietly on an assertion they did not make.
 *
 * WHICH SCOPE A TEST WRITES IS NOW ITSELF UNDER TEST. `readCommits` reads its capability from
 * `--global`/`--system` only, and pins the verifier binaries on the command line, because reading
 * the merged view and executing the answer was a reproduced arbitrary-code-execution hole. So
 * machine facts are set through `withMachineConfig` (a real file git reads as `--global`) and
 * repository claims through `git -C <repo> config` — and three tests here assert the difference
 * with a REAL executable payload, whose running or not running is read off the filesystem.
 *
 * DISCIPLINE: every git invocation is non-interactive and every temporary tree is removed in an
 * `after` hook. Commits are made with `-c commit.gpgsign=false` and explicit identities so the
 * developer's own global git configuration cannot change what these tests measure.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { commitsToLeaflets, signatureFinding } from "@foliage/leaf";

import { readCommits } from "./gitIntake.ts";

const exec = promisify(execFile);

const AUTHOR = "subject@example.com";
const OTHER = "someone.else@example.com";
const AT = "2026-08-15T12:00:00Z";

/**
 * Seal off the developer's own git configuration for every git this file runs, including the
 * ones `readCommits` spawns — they inherit this environment.
 *
 * Not tidiness: the signature verdicts below are determined by `gpg.ssh.allowedSignersFile`, and
 * a developer who has one configured globally would see git return a DIFFERENT code than a
 * developer who does not. These tests measure git's behaviour given a stated configuration, so
 * the configuration has to be stated in full. `-c` on the command line cannot express "unset",
 * which is exactly one of the states under test; sealing the file git reads can.
 */
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_SYSTEM"] = "/dev/null";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-git-"));
  tmpRoots.push(dir);
  return dir;
}

/** `git` in a directory, non-interactive, with the ambient config neutralised. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { encoding: "utf8", timeout: 60_000 },
  );
  return stdout;
}

async function initRepo(): Promise<string> {
  const dir = await tempDir();
  await git(dir, "init", "--quiet", "--initial-branch=main");
  return dir;
}

/** Make one REAL commit and return the object name git assigned it. */
async function commit(
  dir: string,
  message: string,
  email: string = AUTHOR,
  opts: { allowEmptyMessage?: boolean } = {},
): Promise<string> {
  await writeFile(join(dir, `f-${Math.random().toString(36).slice(2)}.txt`), message, "utf8");
  await git(dir, "add", "-A");
  await git(
    dir,
    "-c",
    `user.name=Test Author`,
    "-c",
    `user.email=${email}`,
    "commit",
    ...(opts.allowEmptyMessage === true ? ["--allow-empty-message"] : []),
    "-m",
    message,
  );
  return (await git(dir, "rev-parse", "HEAD")).trim();
}

/**
 * A REAL ed25519 signing key from stock `ssh-keygen`, or null when ssh-keygen is not installed.
 *
 * Null rather than a thrown error only for ENOENT: a machine without ssh-keygen cannot exercise
 * the signed paths, and a test that skips loudly is honest, whereas one that fabricates a
 * signature block would be testing a string instead of a signature. Any OTHER failure is a real
 * problem and propagates.
 */
async function signingKey(dir: string, name = "signing-key"): Promise<string | null> {
  const path = join(dir, name);
  try {
    await exec("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "foliage-test", "-f", path, "-q"], {
      timeout: 60_000,
    });
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return null;
    throw err;
  }
  return `${path}.pub`;
}

/**
 * Run `body` with a REAL machine-level git config in force — a real file, written by real `git
 * config`, that git reads as `--global`.
 *
 * The capability probe reads `--global` and `--system` and never the repository, which is the
 * repair for a reproduced arbitrary-code-execution hole. That makes the seal at the top of this
 * file — `GIT_CONFIG_GLOBAL=/dev/null` — the thing every capability test now has to lift on
 * purpose, and lifting it deliberately for one test is the same discipline as sealing it: what
 * git reads is stated in full rather than inherited from whoever is running the suite.
 *
 * Mutating `process.env` is safe here because `readCommits` spawns git as a child and node:test
 * runs top-level tests in this file one at a time; the previous value is restored either way.
 */
async function withMachineConfig<T>(
  entries: readonly (readonly [string, string])[],
  body: () => Promise<T>,
): Promise<T> {
  const path = join(await tempDir(), "machine-gitconfig");
  for (const [key, value] of entries) {
    await exec("git", ["config", "--file", path, key, value], { timeout: 60_000 });
  }
  const sealed = process.env["GIT_CONFIG_GLOBAL"];
  process.env["GIT_CONFIG_GLOBAL"] = path;
  try {
    return await body();
  } finally {
    if (sealed === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
    else process.env["GIT_CONFIG_GLOBAL"] = sealed;
  }
}

/**
 * A REAL executable script that records the fact that it ran, by writing `marker`.
 *
 * Not a stub and not a spy. The whole defect being tested is WHICH VALUE reached a real `execFile`,
 * so a test that intercepted the exec would assert against its own interception and prove nothing.
 * This is the payload a hostile repository would ship — git preserves the executable bit, so it
 * can ship exactly this.
 */
async function payload(dir: string, marker: string): Promise<string> {
  const path = join(dir, `payload-${Math.random().toString(36).slice(2)}.sh`);
  await writeFile(path, `#!/bin/sh\nprintf ARBITRARY_CODE_EXECUTED > "${marker}"\nexit 0\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

/** Did the payload run? Asked of the filesystem, which is where it would have left evidence. */
async function ran(marker: string): Promise<boolean> {
  try {
    await stat(marker);
    return true;
  } catch {
    return false;
  }
}

/** One REAL signed commit: git makes an actual SSHSIG block over the actual commit object. */
async function signedCommit(dir: string, message: string, key: string): Promise<string> {
  await writeFile(join(dir, `s-${Math.random().toString(36).slice(2)}.txt`), message, "utf8");
  await git(dir, "add", "-A");
  await git(
    dir,
    "-c",
    "user.name=Test Author",
    "-c",
    `user.email=${AUTHOR}`,
    "-c",
    "gpg.format=ssh",
    "-c",
    `user.signingkey=${key}`,
    "-c",
    "commit.gpgsign=true",
    "commit",
    "-m",
    message,
  );
  return (await git(dir, "rev-parse", "HEAD")).trim();
}

test("REAL commits are read, and every ref resolves to a real commit object", async () => {
  const dir = await initRepo();
  const first = await commit(dir, "first real commit");
  const second = await commit(dir, "second real commit");

  const read = await readCommits(dir);
  assert.equal(read.ok, true);
  if (!read.ok) throw new Error("unreachable");
  assert.equal(read.commits.length, 2);
  assert.equal(read.head, second);

  // Newest first, as git log reports it.
  assert.deepEqual(
    read.commits.map((c) => c.sha),
    [second, first],
  );

  // THE MECHANICAL FORM OF NO-FAKE-DATA: hand each ref back to git.
  const intake = commitsToLeaflets({
    commits: read.commits,
    identities: [AUTHOR],
    observedAt: AT,
  });
  assert.equal(intake.ok, true);
  if (!intake.ok) throw new Error("unreachable");
  for (const leaflet of intake.leaflets) {
    const ref = leaflet.provenance?.ref;
    assert.ok(ref !== undefined, "every leaflet must carry a ref");
    const type = (await git(dir, "cat-file", "-t", ref)).trim();
    assert.equal(type, "commit", `${ref} must be a real commit object`);
  }
});

test("unsigned real commits by the subject are PENDING — the honest result", async () => {
  const dir = await initRepo();
  await commit(dir, "an ordinary unsigned commit");
  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");

  assert.equal(read.commits[0]?.signature, "N", "git reports no signature");
  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.leaflets[0]?.tier, "pending");
});

test("A REAL SIGNATURE GIT COULD NOT CHECK IS NOT UNSIGNED — the masking defect", async (t) => {
  // The defect this file's second read exists for, reproduced with real cryptography rather than
  // described. `git commit -S` over a real ed25519 key, then read back with no allowed-signers
  // file configured: git declines to verify and reports `N` — its code for THERE IS NO
  // SIGNATURE — on stdout, exit 0, with the real cause on stderr where nothing was listening.
  // Measured at scale on this machine before it was fixed: 1930 commits of Coeadapt2 all `N`,
  // 298 of them signed.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made — and a fake one would prove nothing");
    return;
  }
  const signed = await signedCommit(dir, "signed with a real ed25519 key", key);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");

  assert.equal(commit.signature, "N", "git's VERDICT is the one that hides the signature");
  assert.equal(commit.signatureArmor, "ssh", "the OBJECT says a signature is right there");
  // Asked of git a third way, so the armor is not just this parser agreeing with itself.
  const object = await git(dir, "cat-file", "commit", signed);
  assert.match(object, /^gpgsig -----BEGIN SSH SIGNATURE-----/m);

  assert.equal(signatureFinding(commit, [AUTHOR]), "unchecked", "never `unsigned`");
  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.leaflets[0]?.tier, "pending", "unchecked is pending, not verified");
  assert.deepEqual(
    intake.uncheckedSignatures.map((s) => [s.armor, s.code, s.attributable]),
    [["ssh", "N", true]],
    "and it is REPORTED, with both causes: the armor and the verdict that contradicts it",
  );
});

test("a real signature git CAN check still verifies — the fix did not close the door", async (t) => {
  // The other half of the same instrument. List the signing key under the SUBJECT'S OWN address
  // and git returns `G` naming that address, which is the only state this product calls verified.
  // The principal is asserted, not assumed: this test passed identically with a stranger's
  // address beside the key until it did, which is precisely the hole the case below closes.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "signed and checkable", key);

  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${AUTHOR} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");
  assert.equal(commit.signature, "G", "git verified it against a named signer");
  assert.equal(commit.signer, AUTHOR, "and the signer it named is the subject");
  assert.equal(signatureFinding(commit, [AUTHOR]), "verified");

  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.leaflets[0]?.tier, "verified");
  assert.deepEqual(intake.uncheckedSignatures, []);
  assert.deepEqual(intake.unboundSignatures, []);
  assert.deepEqual(intake.undeclaredSignatures, []);
});

test("A SIGNATURE GIT ACCEPTED FOR SOMEBODY ELSE IS NOT VERIFIED — the false verified", async (t) => {
  // THE DEFECT, with real cryptography and no mocks. One allowed_signers line binds a real
  // ed25519 key to `someone.else@example.com`; the commit is AUTHORED by the subject. git says
  // `G` and names that stranger in `%GS` — it has bound a signature to a person, just not to
  // this one. Attribution ran off the self-declared `%ae` while the tier was decided by the
  // verdict alone, and the two were never compared, so this rendered as "authorship
  // cryptographically established". In any ordinary team the allowed_signers file holds several
  // colleagues' keys, so ANY of them could author as the subject and be believed.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "authored as the subject, signed by a key bound to someone else", key);

  // git matches allowed_signers by KEY, so listing this key beside a stranger's address is what
  // makes git accept the signature AND name the stranger. Measured, not assumed.
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${OTHER} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");
  assert.equal(commit.signature, "G", "git ACCEPTED the signature — that part was always true");
  assert.equal(commit.authorEmail, AUTHOR, "and the author field says the subject wrote it");
  assert.equal(commit.signer, OTHER, "while the signer git bound is somebody else entirely");

  assert.equal(signatureFinding(commit, [AUTHOR]), "undeclared");
  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.leaflets[0]?.tier, "pending", "NOT verified: git bound this to another key");
  assert.notEqual(intake.leaflets[0]?.tier, "excluded", "and NOT excluded: the author is the subject");
  assert.deepEqual(
    intake.undeclaredSignatures.map((s) => [s.armor, s.code, s.attributable]),
    [["ssh", "G", true]],
    "reported in its own list: a real signature, by someone the subject did not declare",
  );
  // The signer's address is a third party's, and these lists are printed. It is not carried.
  assert.ok(!JSON.stringify(intake).includes(OTHER), "no third-party address travels with it");
});

test("the signer is bound as an ADDRESS, whatever shape the principal takes", async (t) => {
  // Both shapes MEASURED with git 2.54.0 against the same real signature: an allowed_signers
  // principal may be a quoted user id (`Real Name <subject@example.com>`), and it may be no
  // address at all (`alice` is legal). The first binds; the second binds to nobody this module
  // can compare, and "could not bind" is the honest answer rather than a guess off `%ae`.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "one signature, read against three principals", key);
  const allowed = join(dir, "allowed_signers");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  const pub = await readFile(key, "utf8");

  const findingWith = async (principal: string) => {
    await writeFile(allowed, `${principal} ${pub}`, "utf8");
    const read = await readCommits(dir);
    if (!read.ok) throw new Error(`read failed: ${read.detail}`);
    const commit = read.commits[0];
    if (commit === undefined) throw new Error("expected one commit");
    assert.equal(commit.signature, "G", `git accepts the signature for ${principal}`);
    return { finding: signatureFinding(commit, [AUTHOR]), signer: commit.signer };
  };

  assert.deepEqual(await findingWith(`"Real Name <${AUTHOR}>"`), {
    finding: "verified",
    signer: `Real Name <${AUTHOR}>`,
  });
  assert.deepEqual(await findingWith("alice"), { finding: "unbound", signer: "alice" });
  assert.deepEqual(await findingWith(AUTHOR), { finding: "verified", signer: AUTHOR });
});

test("a good ssh signature bound to NO identity is not verified", async (t) => {
  // The overclaim in the other direction, and it is reachable by a typo: when the SIGNING key is
  // not among the allowed signers, git answers `U` — the same code that means "good, unknown
  // trust" for PGP. Here it means git matched the key to no principal at all, so it is proof
  // that SOME key signed the commit and not that this subject did.
  //
  // MEASURED WHILE WRITING THIS, and worth knowing: git matches allowed_signers by KEY, not by
  // the principal beside it. Listing this very key under a stranger's address yields `G`, not
  // `U` — which is why the case below withholds the key itself rather than mislabelling it.
  const dir = await initRepo();
  const key = await signingKey(dir);
  const stranger = await signingKey(dir, "someone-elses-key");
  if (key === null || stranger === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "signed by a key nobody vouched for", key);

  const strangers = join(dir, "other_signers");
  await writeFile(strangers, `${OTHER} ${await readFile(stranger, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", strangers);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");
  assert.equal(commit.signature, "U");
  assert.equal(commit.signer, "", "git bound the key to nobody, and says so by naming nobody");
  assert.equal(signatureFinding(commit, [AUTHOR]), "unbound");

  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.leaflets[0]?.tier, "pending", "a self-declared author field cannot bridge this");
  assert.deepEqual(
    intake.unboundSignatures.map((s) => [s.armor, s.code]),
    [["ssh", "U"]],
  );
});

test("signed and unsigned commits in one history keep their own armor", async (t) => {
  // The counterpart risk to the fix: if the object scan smeared one commit's signature across
  // the walk, ordinary unsigned work would start reporting as unchecked and the warning would
  // be worthless. Each commit is joined by its own object name.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await commit(dir, "plain work");
  await signedCommit(dir, "signed work", key);
  await commit(dir, "more plain work");

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  assert.deepEqual(
    read.commits.map((c) => c.signatureArmor),
    ["none", "ssh", "none"],
    "newest first, and only the middle commit carries anything",
  );
  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");
  assert.equal(intake.uncheckedSignatures.length, 1, "the unsigned pair must not cry wolf");
});

test("log.showSignature — a setting a developer may have on — does not break the read", async (t) => {
  // REPRODUCED before it was fixed: with `log.showSignature` set, git prepends its verification
  // banner at column 0 to BOTH reads — in front of `%H` in the formatted one, and IN PLACE OF the
  // `gpgsig` header in `--pretty=raw`. Intake exited 1 naming `unreadable-output — the two reads
  // disagree`, which is a true sentence about the output and the wrong cause to hand somebody
  // whose only mistake was a config setting. `--no-show-signature` on both logs is the remedy.
  //
  // This test sets the config DELIBERATELY and repo-locally, because the seal at the top of this
  // file (`GIT_CONFIG_GLOBAL=/dev/null`) means the suite can never encounter it by accident —
  // which is exactly why the class went uncaught.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "signed, and read with the banner turned on", key);
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${AUTHOR} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  await git(dir, "config", "log.showSignature", "true");

  // The banner is really there — asserted against git, so this test measures the setting rather
  // than trusting that it did anything.
  const banner = await git(dir, "log", "--format=%H");
  assert.match(banner, /^Good "git" signature/m, "the config under test must actually take effect");

  const read = await readCommits(dir);
  assert.equal(
    read.ok,
    true,
    read.ok ? "" : `a config setting is not an unreadable repository: ${read.cause} ${read.detail}`,
  );
  if (!read.ok) throw new Error("unreachable");
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");
  assert.match(commit.sha, /^[0-9a-f]{40}$/, "no banner text smuggled into the object name");
  assert.equal(commit.signatureArmor, "ssh", "the object scan still sees the gpgsig header");
  assert.equal(commit.signer, AUTHOR);
  assert.equal(signatureFinding(commit, [AUTHOR]), "verified");
});

test("the probe reports whether the SSH backend can be executed — git uses two of them", async () => {
  // REPRODUCED: with a perfectly good allowed_signers file and `gpg.ssh.program` pointing at a
  // path that does not exist, git returns `B` — its code for a BAD signature — about a
  // cryptographically perfect one, and intake said "checked and did not accept". No check
  // happened. The probe asked only about `gpg.program`, so the ssh backend could be broken while
  // this machine reported itself healthy.
  const dir = await initRepo();
  await commit(dir, "a commit to read");

  const bare = await readCommits(dir);
  if (!bare.ok) throw new Error("read failed");
  assert.equal(bare.signatureCapability.sshProgram, null, "unset means git invokes ssh-keygen");
  assert.equal(
    bare.signatureCapability.sshRuns,
    true,
    "ssh-keygen ships with git's own dependencies and just made the keys in this file",
  );

  // MACHINE config, not repo config, and the difference is now load-bearing: a broken ssh backend
  // is a fact about this operator's setup. The same line written into the REPOSITORY is that
  // repository's opinion, it is refused by the probe, and the test below proves it.
  const broken = await withMachineConfig(
    [["gpg.ssh.program", join(dir, "definitely-not-a-program")]],
    () => readCommits(dir),
  );
  if (!broken.ok) throw new Error("read failed");
  assert.equal(broken.signatureCapability.sshRuns, false);
  assert.equal(
    broken.signatureCapability.gpgRuns,
    bare.signatureCapability.gpgRuns,
    "and the PGP probe is unaffected — two backends, two answers",
  );
});

test("a BAD verdict from a backend that cannot run is not evidence of a bad signature", async (t) => {
  // The whole point of the probe above, end to end: the signature is real and correctly listed,
  // and git still says `B` because the checker could not start. The domain calls that `rejected`
  // — it can only read git's verdict — so the capability is what stops the CLI asserting "git
  // CHECKED AND DID NOT ACCEPT" about a check that never ran.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "a perfectly good signature nobody could check", key);
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${AUTHOR} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);

  // The broken backend is the MACHINE's, because that is the only way it can now be broken: the
  // verifying reads pin `gpg.ssh.program` to this value, so it is both what the probe reports and
  // what git actually invokes. Those being one value is the fix; `B` beside `sshRuns: false` is
  // the finding that fix had to preserve.
  const read = await withMachineConfig([["gpg.ssh.program", join(dir, "no-such-ssh-keygen")]], () =>
    readCommits(dir),
  );
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  assert.equal(read.commits[0]?.signature, "B", "git's verdict about a signature it never read");
  assert.equal(
    read.signatureCapability.sshRuns,
    false,
    "and the fact that makes that verdict meaningless is right beside it",
  );
});

test("the capability probe reports what THIS machine can check, and how it is configured", async () => {
  // "Could not check" without a remedy informs an operator without helping them. Every field is
  // driven from a real machine-level config file here, so what is asserted is git's actual state
  // and not a description of it.
  const dir = await initRepo();
  await commit(dir, "a commit to read");

  const bare = await readCommits(dir);
  if (!bare.ok) throw new Error("read failed");
  assert.equal(bare.signatureCapability.allowedSignersFile, null, "nothing configured");
  assert.equal(
    bare.signatureCapability.allowedSignersFileExists,
    null,
    "null, not false — unconfigured and missing are different problems",
  );

  const missing = join(dir, "no-such-allowed-signers");
  const machine = [
    ["gpg.ssh.allowedSignersFile", missing],
    ["gpg.format", "ssh"],
  ] as const;
  const configured = await withMachineConfig(machine, () => readCommits(dir));
  if (!configured.ok) throw new Error("read failed");
  assert.equal(configured.signatureCapability.allowedSignersFile, missing);
  assert.equal(configured.signatureCapability.allowedSignersFileExists, false);
  assert.equal(configured.signatureCapability.configuredFormat, "ssh");

  await writeFile(missing, `${AUTHOR} ssh-ed25519 AAAA-not-a-key\n`, "utf8");
  const present = await withMachineConfig(machine, () => readCommits(dir));
  if (!present.ok) throw new Error("read failed");
  assert.equal(present.signatureCapability.allowedSignersFileExists, true);

  // THE SAME KEYS WRITTEN INTO THE REPOSITORY SAY NOTHING ABOUT THIS MACHINE. A capability a
  // repository can write is that repository's opinion wearing the struct's name.
  await git(dir, "config", "gpg.ssh.allowedSignersFile", missing);
  await git(dir, "config", "gpg.format", "ssh");
  const repoLocal = await readCommits(dir);
  if (!repoLocal.ok) throw new Error("read failed");
  assert.equal(repoLocal.signatureCapability.allowedSignersFile, null);
  assert.equal(repoLocal.signatureCapability.configuredFormat, null);
});

test("the probe reports whether the configured signing program can actually be executed", async () => {
  // The PGP half of the remedy, and the direct cause measured on this machine: gpg is not
  // installed, so git could check nothing and said `N` about 298 real signatures.
  const dir = await initRepo();
  await commit(dir, "a commit to read");

  const broken = await withMachineConfig(
    [["gpg.program", join(dir, "definitely-not-a-program")]],
    () => readCommits(dir),
  );
  if (!broken.ok) throw new Error("read failed");
  assert.equal(broken.signatureCapability.gpgRuns, false);

  // `git` itself: a program that certainly exists, because it just ran three times.
  const runnable = await withMachineConfig([["gpg.program", "git"]], () => readCommits(dir));
  if (!runnable.ok) throw new Error("read failed");
  assert.equal(runnable.signatureCapability.gpgProgram, "git");
  assert.equal(runnable.signatureCapability.gpgRuns, true);

  // `gpg.openpgp.program` is the modern spelling and it WINS, as git resolves it. Left unread, it
  // would be a second door into the same probe.
  const modern = await withMachineConfig(
    [
      ["gpg.program", join(dir, "definitely-not-a-program")],
      ["gpg.openpgp.program", "git"],
    ],
    () => readCommits(dir),
  );
  if (!modern.ok) throw new Error("read failed");
  assert.equal(modern.signatureCapability.gpgProgram, "git");
  assert.equal(modern.signatureCapability.gpgRuns, true);
});

test("A REPOSITORY CANNOT MAKE THIS PROGRAM RUN ITS SCRIPT — the reproduced RCE", async () => {
  // THE DEFECT, with a real repository, a real executable payload and a real `execFile`. The
  // capability probe read `git -C <repo> config --get gpg.program`, which MERGES the target
  // repository's own .git/config, and then executed the answer to ask whether it runs. Reproduced
  // twice independently, on a repository holding ONE UNSIGNED COMMIT: the probe is unconditional,
  // so no signature is needed to reach it. Git preserves the executable bit, so one repository can
  // carry both the payload and the line that points at it.
  //
  // NOT A STUB. Stubbing execFile would assert against the stub; the entire defect is which VALUE
  // reached a real exec, so the payload here is real and the evidence is a file on disk.
  const dir = await initRepo();
  await commit(dir, "one ordinary unsigned commit — that is all it takes");

  // THE POSITIVE CONTROL FIRST, so the assertion below cannot pass because the payload is inert:
  // the same script, named by THIS MACHINE's config, is executed — as it should be, since that is
  // the operator's own instruction — and it leaves its mark.
  const machineMarker = join(await tempDir(), "MACHINE_RAN");
  const machineScript = await payload(dir, machineMarker);
  const legitimate = await withMachineConfig([["gpg.program", machineScript]], () =>
    readCommits(dir),
  );
  if (!legitimate.ok) throw new Error("read failed");
  assert.equal(await ran(machineMarker), true, "the payload is genuinely executable and IS exec'd");
  assert.equal(legitimate.signatureCapability.gpgRuns, true, "and the probe reports what it ran");

  // NOW THE REPOSITORY SAYS IT, in every key git will route a signing backend through.
  const marker = join(await tempDir(), "PWNED");
  const script = await payload(dir, marker);
  for (const key of [
    "gpg.program",
    "gpg.openpgp.program",
    "gpg.x509.program",
    "gpg.ssh.program",
  ]) {
    await git(dir, "config", key, script);
  }

  const read = await readCommits(dir);
  assert.equal(read.ok, true, read.ok ? "" : `${read.cause} — ${read.detail}`);
  assert.equal(await ran(marker), false, "the repository's script MUST NOT have run");
  if (!read.ok) throw new Error("unreachable");
  assert.equal(read.commits.length, 1, "and the honest read still happened");
  assert.equal(
    read.signatureCapability.gpgProgram,
    null,
    "the repository's value is not reported as this machine's capability either",
  );

  // AND THROUGH THE REAL COMMAND, which is how it was reproduced: `intake.mjs --repo <hostile>`.
  const out = join(await tempDir(), "leaf.json");
  const command = new URL("../intake.mjs", import.meta.url).pathname;
  await exec(
    process.execPath,
    [command, "--repo", dir, "--subject", "Subj", "--identity", AUTHOR, "--out", out],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(await ran(marker), false, "nor when the product's own entry point does the read");
});

test("A REPOSITORY CANNOT CHOOSE THE PROGRAM THAT VERIFIES ITS OWN COMMITS", async (t) => {
  // The subtler half, and the one that matters more: `%G?` is not a passive field — it RUNS the
  // signature checker. Closing the probe alone would leave a repository able to nominate the
  // binary that adjudicates its own signatures, which is both code execution AND a verdict.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "signed, and read while the repo names its own verifier", key);
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${AUTHOR} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);

  const marker = join(await tempDir(), "VERIFIER_HIJACKED");
  await git(dir, "config", "gpg.ssh.program", await payload(dir, marker));

  // MEASURED, not assumed: an UNPINNED git — the same one every developer runs — executes the
  // repository's script and returns `B` about a cryptographically perfect signature. Without this
  // line the assertion below could pass on a repo whose hostile config never took effect.
  const hijacked = (await git(dir, "log", "--format=%G?")).trim();
  assert.equal(hijacked, "B", "plain git obeys the repository, and gets a wrong answer for it");
  assert.equal(await ran(marker), true, "having run the repository's script to get it");
  await unlink(marker);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error(`read failed: ${read.detail}`);
  assert.equal(await ran(marker), false, "pinned, the repository's script never runs");
  const commit = read.commits[0];
  if (commit === undefined) throw new Error("expected one commit");
  assert.equal(commit.signature, "G", "and the REAL ssh-keygen verified the REAL signature");
  assert.equal(commit.signer, AUTHOR);
  assert.equal(signatureFinding(commit, [AUTHOR]), "verified", "the finding is not weakened");
});

test("a repository whose config belongs to somebody else is REFUSED by name", async (t) => {
  // A .git/config is an instruction set, and this reader obeys part of it. One written by another
  // user is refused rather than obeyed.
  //
  // HOW THIS IS TESTED WITHOUT ROOT, stated plainly because it is a compromise: an unprivileged
  // process cannot create a file owned by another user, so the repository's config is SYMLINKED to
  // /dev/null, which is owned by uid 0 on every unix and which git reads as an empty config. What
  // is real is the property under test — the object supplying this repository's instructions
  // belongs to somebody else, and git really does read it as the local config. What is not real is
  // its content; a hostile config would have some.
  const me = typeof process.getuid === "function" ? process.getuid() : null;
  if (me === null || me === 0) {
    t.skip("this check compares POSIX uids, and running as root makes every file 'mine'");
    return;
  }
  const dir = await initRepo();
  await commit(dir, "a commit nobody gets to read");

  const config = join(dir, ".git", "config");
  const foreign = "/dev/null";
  const owner = (await stat(foreign)).uid;
  if (owner === me) {
    t.skip(`${foreign} is owned by this user here, so it cannot stand in for a foreign config`);
    return;
  }
  await unlink(config);
  await symlink(foreign, config);

  const read = await readCommits(dir);
  assert.equal(read.ok, false, "a repository configured by somebody else is not read");
  if (read.ok) throw new Error("unreachable");
  assert.equal(read.cause, "config-not-owned", "and the refusal is NAMED, never a zero");
  if (read.cause !== "config-not-owned") throw new Error("unreachable");
  assert.equal(read.configUid, owner, "both sides of the comparison are carried, not collapsed");
  assert.equal(read.processUid, me);
  assert.equal(read.configPath, config);
  assert.match(read.detail, /REFUSED/);

  // It is a REFUSAL, not the empty read or the missing path — the pair this module exists to keep
  // apart. Downstream all three would be zero leaflets, and only the cause tells them apart.
  const empty = await readCommits(await initRepo());
  assert.equal(empty.ok, true);
});

test("the ownership gate does not refuse honest repositories read from anywhere", async () => {
  // The risk a new gate carries: it asks git where the config lives, and git answers RELATIVE to
  // the directory it was run in ("../../.git" from a subdirectory) or with a per-worktree git dir
  // that holds no `config` at all. Either could refuse — or, worse, silently check the wrong
  // file — so both shapes are read here for real.
  const dir = await initRepo();
  const deep = join(dir, "sub", "deep");
  await mkdir(deep, { recursive: true });
  await writeFile(join(deep, "a.txt"), "work", "utf8");
  await git(dir, "add", "-A");
  await git(dir, "-c", "user.name=Test Author", "-c", `user.email=${AUTHOR}`, "commit", "-m", "w");

  const fromSubdir = await readCommits(deep);
  assert.equal(fromSubdir.ok, true, fromSubdir.ok ? "" : `${fromSubdir.cause}: ${fromSubdir.detail}`);

  const worktree = join(await tempDir(), "linked");
  await git(dir, "worktree", "add", "--quiet", worktree, "-b", "side");
  const fromWorktree = await readCommits(worktree);
  assert.equal(
    fromWorktree.ok,
    true,
    fromWorktree.ok ? "" : `${fromWorktree.cause}: ${fromWorktree.detail}`,
  );
  if (!fromWorktree.ok) throw new Error("unreachable");
  assert.equal(fromWorktree.commits.length, 1, "a linked worktree reads the shared history");
});

test("an empty repository still reports what this machine could check", async () => {
  // The honest-empty path returns early, and it must not return early past the capability: a
  // repository with no commits still has an operator who may be about to sign some.
  const read = await readCommits(await initRepo());
  if (!read.ok) throw new Error("an empty repository is a valid read");
  assert.equal(read.head, null);
  assert.equal(read.signatureCapability.allowedSignersFile, null);
  assert.equal(typeof read.signatureCapability.gpgRuns, "boolean");
});

test("a commit by ANOTHER author is excluded, with no email in the reason", async () => {
  const dir = await initRepo();
  await commit(dir, "mine", AUTHOR);
  await commit(dir, "theirs", OTHER);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");
  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  if (!intake.ok) throw new Error("intake failed");

  const tiers = intake.leaflets.map((l) => l.tier).sort();
  assert.deepEqual(tiers, ["excluded", "pending"]);

  const excluded = intake.leaflets.find((l) => l.tier === "excluded");
  if (excluded?.tier !== "excluded") throw new Error("expected an excluded leaflet");
  assert.ok(!excluded.reason.includes(OTHER), "the other author's address must not be published");
  assert.ok(!excluded.reason.includes("@"), "no address-shaped text in a public reason");
});

test("AN EMPTY REPOSITORY IS NOT A FAILURE — zero commits, honestly", async () => {
  // The distinction this whole file exists for. `git log` exits 128 on an unborn HEAD, so a
  // naive implementation reports a working repository as broken; a careless one writes a
  // zero-leaflet document and calls it a portfolio. It is neither: it is a real empty one.
  const dir = await initRepo();
  const read = await readCommits(dir);

  assert.equal(read.ok, true, "an initialised repository with no commits is a valid read");
  if (!read.ok) throw new Error("unreachable");
  assert.deepEqual(read.commits, []);
  assert.equal(read.head, null, "head is null, which is WHY the emptiness is trustworthy");
});

test("a failed read is NAMED, and is distinguishable from an empty one", async () => {
  // The pair that must never collapse: both produce zero leaflets downstream, and only the
  // cause tells them apart. This is the `commitCount: 0` bug expressed as a test.
  const plain = await tempDir();
  const notRepo = await readCommits(plain);
  assert.equal(notRepo.ok, false);
  if (notRepo.ok) throw new Error("unreachable");
  assert.equal(notRepo.cause, "not-a-repo");

  const missing = await readCommits(join(plain, "does-not-exist"));
  assert.equal(missing.ok, false);
  if (missing.ok) throw new Error("unreachable");
  assert.equal(missing.cause, "no-such-path");

  const empty = await readCommits(await initRepo());
  assert.equal(empty.ok, true, "an empty repo must NOT share a cause with a broken one");
});

test("a file path where a directory is expected is refused, not read", async () => {
  const dir = await tempDir();
  const file = join(dir, "a-file.txt");
  await writeFile(file, "not a repository", "utf8");
  const read = await readCommits(file);
  assert.equal(read.ok, false);
  if (read.ok) throw new Error("unreachable");
  assert.equal(read.cause, "no-such-path");
  assert.match(read.detail, /not a directory/);
});

test("merge commits are excluded from the history read", async () => {
  // A merge records an integration, not authorship. Counting it would inflate the ledger.
  const dir = await initRepo();
  await commit(dir, "base");
  await git(dir, "checkout", "--quiet", "-b", "side");
  await commit(dir, "side work");
  await git(dir, "checkout", "--quiet", "main");
  await commit(dir, "main work");
  await git(
    dir,
    "-c",
    "user.name=Test Author",
    "-c",
    `user.email=${AUTHOR}`,
    "merge",
    "--no-ff",
    "--no-edit",
    "side",
  );

  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");
  const subjects = read.commits.map((c) => c.subject);
  assert.equal(read.commits.length, 3, "three real commits, and not the merge");
  assert.ok(!subjects.some((s) => s.startsWith("Merge branch")), `got: ${subjects.join(" | ")}`);
});

test("a hostile commit subject survives the round trip intact", async () => {
  // The parser is delimiter-based, so the subject line is where it can break. Quotes, a pipe,
  // a tab and non-ASCII are all things a person types into a commit message.
  const dir = await initRepo();
  const nasty = 'fix: "quoted" | piped\tand — em-dashed, 100% ünicode';
  await commit(dir, nasty);

  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");
  assert.equal(read.commits[0]?.subject, nasty, "the subject must arrive exactly as written");
});

test("a commit with NO message still produces a valid, non-empty title", async () => {
  const dir = await initRepo();
  await commit(dir, "", AUTHOR, { allowEmptyMessage: true });

  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");
  assert.equal(read.commits[0]?.subject, "", "git reports an empty subject");

  const intake = commitsToLeaflets({ commits: read.commits, identities: [AUTHOR], observedAt: AT });
  assert.equal(intake.ok, true, "an empty message must not break intake");
  if (!intake.ok) throw new Error("unreachable");
  assert.ok((intake.leaflets[0]?.title.length ?? 0) > 0, "a blank title would fail the parser");
});

test("THE COMMAND ITSELF does not print `verified` for a stranger's signature", async (t) => {
  // The one end-to-end case in this file, and it earns its place: the false `verified` lived in
  // the SEAM between this read and the tier, and the sentence that mattered was the one
  // `intake.mjs` printed. Run the real command, over a real signed repository, and read its real
  // stdout — a unit test on either side of the seam passed while the product lied.
  const dir = await initRepo();
  const key = await signingKey(dir);
  if (key === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  await signedCommit(dir, "authored by the subject, signed by a key bound to someone else", key);
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${OTHER} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);

  const out = join(await tempDir(), "leaf.json");
  const command = new URL("../intake.mjs", import.meta.url).pathname;
  const { stdout } = await exec(
    process.execPath,
    [command, "--repo", dir, "--subject", "Subj", "--identity", AUTHOR, "--out", out],
    { encoding: "utf8", timeout: 60_000 },
  );

  assert.match(stdout, /verified 0 {2}pending 1 {2}excluded 0/, stdout);
  assert.match(stdout, /ACCEPTED FROM SOMEBODY ELSE/, "and it says which fact it is reporting");
  assert.ok(!stdout.includes(OTHER), "without publishing the other person's address");
  const written: unknown = JSON.parse(await readFile(out, "utf8"));
  assert.equal(
    (written as { leaflets: { tier: string }[] }).leaflets[0]?.tier,
    "pending",
    "and the document on disk agrees with what was printed",
  );
});

test("the read reports the repository root, not the path it was handed", async () => {
  const dir = await initRepo();
  await commit(dir, "root check");
  const read = await readCommits(dir);
  if (!read.ok) throw new Error("read failed");
  assert.ok(read.repoRoot.length > 0);
  // Resolved through git, so a subdirectory would still name the top level.
  const top = (await git(dir, "rev-parse", "--show-toplevel")).trim();
  assert.equal(read.repoRoot, top);
});
