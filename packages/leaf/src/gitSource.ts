/**
 * Reading real commits out of a real repository.
 *
 * THE ONE RULE THIS FILE ENFORCES: a failed read is never a zero. It returns a discriminated
 * union naming exactly which of six things went wrong, and the caller must not write a document
 * from any of them. The bug this repository already paid for was four distinct causes collapsed
 * into `commitCount: 0`, after which the product asserted "0 commits" about work it had never
 * read — an empty portfolio is indistinguishable from a broken one unless the reader is told
 * which it is, and by then the claim is already on someone's public page.
 *
 * THE SEVENTH STATE, deliberately NOT a failure: a repository whose history is genuinely
 * empty — an initialised repo with an unborn HEAD. That is `ok: true` with zero commits and
 * `head: null`. It is a real, honest, empty portfolio, and it is what a brand-new project
 * truthfully looks like. `git log` on such a repo exits 128, so treating "git exited non-zero"
 * as failure across the board would report a working repository as broken. This is the same
 * distinction `loadLeafDocument` draws between "absent" and "valid but empty", and it is
 * checked with `rev-parse --verify --quiet HEAD` — exit 1 with no output is git's documented,
 * locale-independent way of saying "no commits yet" — rather than by matching stderr text,
 * which changes between git versions and locales.
 *
 * THE SAME MASKING, ONE LEVEL DOWN, and why this file reads the history TWICE. `%G?` is not a
 * safe field: when git cannot run the signature checker it writes the real cause to STDERR and
 * prints `N` — "there is no signature" — on stdout, then exits 0. This file used to discard
 * stderr on a zero exit, so the product reported unsigned history it had never checked.
 * MEASURED, not assumed: over a repository on the measuring machine, `%G?` says `N` for all 1930
 * non-merge commits while 298 of their raw objects carry a `gpgsig` header (295 SSH, 3 PGP).
 * Stderr says why — `cannot run gpg` and `gpg.ssh.allowedSignersFile needs to be configured` —
 * but matching that text is forbidden here (it moves with git's version and locale), so the
 * cause is established two text-free ways instead:
 *
 *   1. A DIFFERENTIAL CONTROL. A second pass, `git log --no-merges --pretty=raw`, reports what
 *      each commit OBJECT holds. A `gpgsig` header with an `N` verdict is a contradiction, and
 *      it is carried to the domain as `signatureArmor` rather than resolved here. Cost is not an
 *      objection: measured at 0.030s over those 1930 commits, against 0.342s for the formatted
 *      read it augments — the control is cheaper than the read.
 *   2. A CAPABILITY PROBE. `gpg.format`; `gpg.program` and `gpg.ssh.program` — BOTH backends,
 *      because git uses two and either can be broken alone — and whether each can be executed at
 *      all; `gpg.ssh.allowedSignersFile` and whether it exists on disk. This says WHY the machine
 *      could not check, which is what an operator needs to fix it, and it is also what stops a
 *      caller reporting `B` from a backend that never ran as "git checked and did not accept".
 *
 * Both are reported, because a fallback with one cause named is half an explanation.
 *
 * WHY THE PROBE READS THE MACHINE AND NEVER THE REPOSITORY. `git -C <repo> config --get
 * gpg.program` MERGES the target repository's own `.git/config`, and this file then EXECUTED the
 * answer in order to ask whether it runs. REPRODUCED twice, independently: `git config gpg.program
 * ./pwned.sh` inside a repository, then `intake.mjs --repo <that repository>`, and the script ran.
 * It ran on a repository holding ONE UNSIGNED COMMIT, because the probe is unconditional — no
 * signature is needed to reach it. Git preserves the executable bit, so a repository can ship both
 * the payload and the config line that points at it, and this product's entire premise is "point
 * it at your repositories", which arrive from tarballs, shared drives and colleagues' machines.
 *
 * The defect is not the exec. It is that a MACHINE CAPABILITY was derived from REPOSITORY DATA:
 * `gpg.program` in a repo's local config is the repository talking, not a fact about this machine.
 * That is the same shape as the redirect hole this repository already fixed — the claim and the
 * effect derived from different values. So both halves move together:
 *
 *   1. The probe asks `config --get --global`, then `--system`, in git's own precedence order, and
 *      never the merged view. No `-C <repo>` appears in a capability read anywhere in this file.
 *   2. BOTH logs PIN the verifier binaries on the command line — `-c gpg.program=`,
 *      `-c gpg.openpgp.program=`, `-c gpg.x509.program=`, `-c gpg.ssh.program=` — so a repository
 *      cannot choose the program that verifies its own commits. This half matters more and is the
 *      easy one to miss: `%G?` is not a passive field, it RUNS the checker. All four keys, because
 *      git picks the backend from the signature's armor and the repository writes the armor;
 *      `gpg.program` alone would leave `gpg.openpgp.program` and `gpg.x509.program` as open doors.
 *
 * MEASURED, git 2.54.0, one real ed25519-signed commit with `gpg.ssh.program` set repo-locally to
 * a script: unpinned, git returned `B` and the script ran twice; pinned, git returned `G` and the
 * script never ran. Command-line `-c` outranks every config file, which is what makes a pin a pin.
 * The probe and the pin now resolve THE SAME value, which is the invariant that was missing.
 *
 * WHAT IS NOT PINNED, stated rather than implied. `gpg.ssh.allowedSignersFile` is deliberately
 * left merged: it names a file, it is never executed, and the published recipe for signed
 * repositories sets it repo-locally, so pinning it would stop verifying real portfolios. The
 * residual is real and gets named: a repository can vouch for the key that signed its own commits,
 * and `signatureCapability.allowedSignersFile` reports THIS MACHINE'S setting, which may be null
 * while git verified against the repository's. Trusting a self-supplied allow-list is a different
 * question from executing a self-chosen binary; this file closed the second and not the first.
 *
 * THE OWNERSHIP GATE, and what it does not cover. A repository whose config file is owned by
 * another user is refused by name (`config-not-owned`) before anything is executed. Git mitigates
 * the analogous risk with `safe.directory`, which checks the `.git` DIRECTORY; this checks the
 * config FILE, so it also catches a config owned by somebody else inside a directory that is not,
 * and it still fires when an operator has relaxed `safe.directory` to `*`. It does NOT cover the
 * route the RCE actually arrives by — a tarball you unpacked yourself is owned by you — which is
 * why it is the third fix here and not the first. A defence that only looks like one is worse than
 * none, so this one is described by what it catches.
 *
 * ORDERING, measured rather than assumed: nothing that can execute a repository's choice runs
 * before that gate. With `gpg.program`, `gpg.openpgp.program`, `gpg.x509.program`,
 * `gpg.ssh.program`, `core.fsmonitor`, `core.pager` and `core.sshCommand` all pointed at a script,
 * every `rev-parse` this file runs — and `git log` over unsigned history — left the script
 * unfired. So the rev-parses may precede the gate; `canRun` and the verifying `log` come after it.
 *
 * Layering: the TIERING RULE lives in `@foliage/leaf` (it is a claim about proof, and the person
 * being judged by it must be able to read it). This file owns only subprocess I/O and parsing —
 * app-shaped, not domain-shaped. Nothing here decides what any commit means, including what an
 * unchecked signature does to a tier.
 *
 * `node:child_process` is a Node builtin, so the zero-runtime-dependency claim is unaffected.
 */

import { execFile } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { ObservedCommit, SignatureArmor } from "./intake.ts";
import { isIsoInstant } from "./document.ts";

/**
 * Field-separated, record-separated commit records.
 *
 * US (0x1f) between fields and RS (0x1e) between commits, because a commit SUBJECT can contain
 * anything a person can type — including tabs, pipes, and every other delimiter one might
 * reach for first. These two control characters cannot occur in a sha, an email, or a `%G?`
 * code, and a subject containing one is caught by the field count rather than silently
 * mis-parsed into the wrong columns.
 *
 * `%GS` — WHO git says signed the commit — rides in the SAME read, which is why it costs
 * nothing. Without it `%G?` establishes only that SOMEBODY signed, and the tier was decided by
 * that verdict while attribution ran off the self-declared `%ae`: an allowed_signers file
 * listing a colleague's key would let that colleague author a commit as the subject and have
 * the product call it "cryptographically established". MEASURED with git 2.54.0 — one
 * allowed_signers line binding the signing key to `someone@else.example`, commit authored
 * `subject@example.com`, gives `G` with `%GS` of `someone@else.example`. The two facts have to
 * meet, and they can only meet if both are read.
 *
 * The two free-text fields sit at the END of the record precisely because they are free text:
 * `%GS` is a PGP user id or an allowed_signers principal, `%s` is whatever a person typed. A
 * 0x1f inside either lands the record in the field-count guard rather than in the wrong column.
 *
 * `--no-merges` because a merge commit is not an artifact of authorship — it records an
 * integration, and counting it as evidence of work would inflate the ledger.
 */
const LOG_FORMAT = "%H%x1f%ae%x1f%G?%x1f%GS%x1f%s%x1e";
const UNIT_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const FIELDS_PER_RECORD = 5;

/**
 * `log.showSignature` is a developer's own config, and with it set git prepends its verification
 * banner at column 0 to BOTH reads — the formatted one (the banner arrives in front of `%H`) and
 * `--pretty=raw` (where the `gpgsig` header is replaced by that banner). REPRODUCED, not feared:
 * with it on, intake exited 1 naming `unreadable-output — the two reads disagree`, which is a
 * true statement about the output and the wrong cause to hand an operator whose only mistake was
 * a config setting. `--no-show-signature` is git's own switch for exactly this, and it goes on
 * every log this file runs.
 */
const NO_SHOW_SIGNATURE = "--no-show-signature";

/**
 * Ceiling on `git log` output. Roughly 300k commits at typical record size.
 *
 * It exists because the default (1 MiB) would be hit by any substantial repository, and a
 * truncated read is the undercount failure wearing a different hat: it produces a document
 * that looks complete and is short. Exceeding this is reported as its own cause, never
 * swallowed into a partial result.
 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Ceiling on any single git invocation, so a check may fail but can never hang. */
const GIT_TIMEOUT_MS = 120_000;

/** Ceiling on the capability probe. Asking a program for its version is not real work. */
const PROBE_TIMEOUT_MS = 10_000;

/** Passive metadata, never a signature verdict or an attribution decision. */
export interface GitMetadata {
  readonly sha: string;
  readonly email: string;
  readonly authoredAt: string;
  readonly subject: string;
}

async function metadataCommand(repo: string, args: readonly string[], maxBuffer = MAX_OUTPUT_BYTES): Promise<string> {
  const result = await runGit(["-C", repo, ...args], 15_000, maxBuffer);
  if (!result.ok) throw new Error(`${result.kind}: ${result.detail}`);
  if (result.run.exitCode !== 0) throw new Error(`Git read failed (exit ${result.run.exitCode}): ${result.run.stderr.trim()}`);
  return result.run.stdout;
}

/** Linked worktrees name one source. Resolve it before checking the caller's permission. */
export async function gitSourceScope(repo: string): Promise<string> {
  return realpath(resolve(repo, (await metadataCommand(repo, ["rev-parse", "--git-common-dir"], 1024 * 1024)).trim()));
}

/** Shared passive ref selection; callers keep the narrowing cause visible. */
export async function readGitRefs(repo: string): Promise<{ readonly refs: readonly string[]; readonly narrowedBecause: string | null }> {
  const result = await refsFor(repo, []);
  return { ...result, refs: result.refs.filter(ref => ref !== "--") };
}

/** Whole non-merge history or one exact object; no moving-ref interpretation for exact reads. */
export async function readGitMetadata(repo: string, commit?: string, refs: readonly string[] = []): Promise<readonly GitMetadata[]> {
  if (commit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error("Supply an exact full Git commit id, not a moving ref.");
  const format = "--format=%H%x00%ae%x00%aI%x00%s";
  const output = await metadataCommand(repo, commit === undefined
    ? ["log", "--no-merges", NO_SHOW_SIGNATURE, "-z", format, ...refs, "--"]
    : ["show", "--no-patch", NO_SHOW_SIGNATURE, "-z", format, commit], commit === undefined ? MAX_OUTPUT_BYTES : 1024 * 1024);
  const fields = output.split("\0");
  if (fields.pop() !== "" || fields.length % 4 !== 0) throw new Error("Unreadable Git metadata framing; no partial records accepted.");
  const commits: GitMetadata[] = [];
  for (let i = 0; i < fields.length; i += 4) {
    const [sha, email, authoredAt, subject] = fields.slice(i, i + 4) as [string, string, string, string];
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha) || !isIsoInstant(authoredAt)) throw new Error("Unreadable Git metadata record; nothing inferred.");
    commits.push({ sha, email, authoredAt, subject });
  }
  if (commit !== undefined && (commits.length !== 1 || commits[0]?.sha !== commit)) throw new Error("Git did not return exactly the requested commit.");
  return commits;
}

/**
 * `commit <object name>` opens each record of `git log --pretty=raw`, at column 0. Message lines
 * in that format are indented four spaces and header continuations one, so neither can be
 * mistaken for a record boundary or for the header below.
 */
const RAW_COMMIT_LINE = /^commit ([0-9a-f]{40}|[0-9a-f]{64})$/;

/** The signature header: `gpgsig` in a SHA-1 repository, `gpgsig-sha256` in a SHA-256 one. */
const RAW_SIGNATURE_LINE = /^gpgsig(?:-sha256)? (.*)$/;

/**
 * Armor headers, matched as WIRE FORMATS rather than as messages: these strings are fixed by
 * OpenPGP and by the SSHSIG format, they are what is actually stored inside the commit object,
 * and they do not change with git's version or the operator's locale. Matching stderr text
 * would break all three of those properties, which is why it is not done anywhere in this file.
 */
const PGP_ARMOR = "-----BEGIN PGP SIGNATURE-----";
const SSH_ARMOR = "-----BEGIN SSH SIGNATURE-----";

/** What git invokes when `gpg.program` is unset. Git's own documented default. */
const DEFAULT_GPG_PROGRAM = "gpg";

/**
 * What git invokes for SSH signatures when `gpg.ssh.program` is unset. Git's own default, and a
 * DIFFERENT program from the PGP one — the probe used to ask only about `gpg.program`, so an ssh
 * backend that cannot be executed looked, from here, like a machine in perfect health.
 * REPRODUCED: with a correct allowed_signers file and `gpg.ssh.program` pointed at a path that
 * does not exist, git returns `B` — its code for a BAD signature — about a cryptographically
 * perfect one, and intake reported it as "checked and did not accept". Nothing was checked.
 */
const DEFAULT_SSH_PROGRAM = "ssh-keygen";

/**
 * What git invokes for x509 signatures when `gpg.x509.program` is unset. Git's own default, and
 * the THIRD signing backend — the one it is easiest to forget, because nothing in this repository
 * has ever produced an x509 signature. It is pinned anyway: git chooses the backend from the
 * ARMOR stored in the commit object, and the repository writes that armor, so a repository that
 * cannot reach `gpg.ssh.program` can reach this one instead simply by carrying a different
 * signature block. It is pinned but NOT probed — there is no `x509Runs` — because probing gpgsm on
 * every read would be work for a case never observed. The honest consequence: a `B` verdict from a
 * broken x509 backend arrives with no capability beside it, exactly as it always has.
 */
const DEFAULT_X509_PROGRAM = "gpgsm";

export type GitIntakeCause =
  | "no-such-path"
  | "git-unavailable"
  | "not-a-repo"
  | "config-not-owned"
  | "git-failed"
  | "output-too-large"
  | "unreadable-output";

/**
 * What THIS MACHINE is equipped to check, independent of what the repository contains.
 *
 * Read from git's own configuration and from the filesystem — never from an error message. It
 * exists so that "could not check" comes with a remedy: an operator told only that verification
 * failed has been informed, not helped.
 *
 * "INDEPENDENT OF WHAT THE REPOSITORY CONTAINS" IS A RULE, NOT A DESCRIPTION. Every field here is
 * read from `--global` and `--system` only. It used to be read from the merged view, which meant
 * the target repository could set `gpg.program` and this file would execute it — a reproduced
 * arbitrary-code-execution hole, described at the top of this file. A capability that a repository
 * can write is not a capability; it is that repository's opinion wearing this struct's name.
 *
 * Every field distinguishes "unset" from "set and broken", because they are different problems
 * with different fixes. `null` means "not configured", which is why
 * `allowedSignersFileExists` is `boolean | null` rather than a boolean that quietly reports an
 * unconfigured file as a missing one.
 */
export interface SignatureCapability {
  /** `gpg.format` — the signature format this repository is configured to MAKE. Null if unset. */
  readonly configuredFormat: string | null;
  /**
   * The PGP backend THIS MACHINE selects — `gpg.openpgp.program`, or the legacy synonym
   * `gpg.program` — or null when neither is set globally, in which case git invokes `gpg`.
   */
  readonly gpgProgram: string | null;
  /**
   * Whether the program git would invoke for PGP can be executed here at all. False is the
   * inconclusive direction too: a probe that could not be completed reports "not shown to run",
   * which understates the machine rather than overstating what it verified.
   */
  readonly gpgRuns: boolean;
  /** `gpg.ssh.program`, or null when unset, in which case git invokes `ssh-keygen`. */
  readonly sshProgram: string | null;
  /**
   * Whether the program git would invoke for SSH signatures can be executed here at all.
   *
   * Its own field rather than a second reading of `gpgRuns`: git uses two different backends and
   * an operator can break either one alone. False here is what stops a caller from saying "git
   * checked this signature and did not accept it" about a check that never ran — with a broken
   * `gpg.ssh.program` git reports `B`, which is indistinguishable from a genuinely bad signature
   * unless this is read alongside it. Same inconclusive direction as `gpgRuns`.
   */
  readonly sshRuns: boolean;
  /**
   * `gpg.ssh.allowedSignersFile` AS THIS MACHINE CONFIGURES IT, or null when unset globally.
   *
   * The one field whose scope differs from what verification actually used, and saying so is the
   * point: this path is never executed, so it is not pinned, and git will happily bind signatures
   * through a file the REPOSITORY named in its own config. Null here beside a `G` verdict
   * therefore means the repository supplied the allow-list, not that nothing did. Reading this as
   * "so nothing vouched for that key" would be the overclaim.
   */
  readonly allowedSignersFile: string | null;
  /** Whether that file exists. Null when none is configured — a different fact from missing. */
  readonly allowedSignersFileExists: boolean | null;
}

export type GitIntakeResult =
  | {
      readonly ok: true;
      readonly commits: readonly ObservedCommit[];
      /** Resolved absolute path of the repository's top level, as git reports it. */
      readonly repoRoot: string;
      /** The commit HEAD points at, or null when history is genuinely empty. */
      readonly head: string | null;
      /**
       * What this machine can check. Present on every successful read, including an empty one:
       * a repository with no commits still has an operator who may be about to sign some.
       */
      readonly signatureCapability: SignatureCapability;
  /**
   * Why the walk had to narrow to HEAD, or null when it read every local branch.
   *
   * Present on the SUCCESS arm on purpose: this is a partial read, not a failure, and the caller
   * must be able to say so. A silent narrowing would tell somebody they have less work than they
   * have — the collapse this file's sibling forbids.
   */
  readonly narrowedBecause: string | null;
    }
  | {
      readonly ok: false;
      readonly cause: "no-such-path" | "git-unavailable" | "not-a-repo" | "unreadable-output";
      readonly detail: string;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly cause: "config-not-owned";
      readonly detail: string;
      readonly path: string;
      /** The config file the decision was made about, so the operator can go and look at it. */
      readonly configPath: string;
      /** Both sides of the comparison, carried rather than collapsed into "not yours". */
      readonly configUid: number;
      readonly processUid: number;
    }
  | {
      readonly ok: false;
      readonly cause: "git-failed";
      readonly detail: string;
      readonly path: string;
      /** Carried rather than flattened: exit 128 and exit 1 are different situations. */
      readonly exitCode: number;
      readonly stderr: string;
    }
  | {
      readonly ok: false;
      readonly cause: "output-too-large";
      readonly detail: string;
      readonly path: string;
      readonly limitBytes: number;
    };

/**
 * The sentence every command that calls `readCommits` prints when the walk narrowed. One wording,
 * here, so intake and harvest cannot drift into saying two different things about one fact — and
 * the print IS the mechanism that makes a narrowing "reported, not swallowed", so each command's
 * test spawns it and looks for this line.
 */
export function narrowingNotice(command: string, narrowedBecause: string): string {
  return (
    `${command}: read HEAD only — a local branch could not be read, so work that exists only on a\n` +
    `${command}:   branch is NOT in this document. git said: ${narrowedBecause}\n`
  );
}

interface GitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type GitRunOutcome =
  | { readonly ok: true; readonly run: GitRun }
  | {
      readonly ok: false;
      readonly kind: "git-unavailable" | "output-too-large";
      readonly detail: string;
    };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String(err.code);
  return "UNKNOWN";
}

/**
 * Run git once.
 *
 * A NON-ZERO EXIT IS NOT A FAILURE AT THIS LEVEL — it is returned as data, because whether it
 * is fatal depends on the question being asked: exit 1 from `rev-parse --verify HEAD` means
 * "no commits yet", which is a perfectly healthy repository. Deciding that here would bake one
 * caller's interpretation into every caller.
 *
 * No shell is involved: arguments go to execFile directly, so a repository path containing a
 * space, a quote, or a `;` is passed through as one argument and cannot be re-interpreted.
 */
function runGit(args: readonly string[], timeout = GIT_TIMEOUT_MS, maxBuffer = MAX_OUTPUT_BYTES): Promise<GitRunOutcome> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { maxBuffer, timeout, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ ok: true, run: { exitCode: 0, stdout, stderr } });
          return;
        }
        const code = codeOf(err);
        if (code === "ENOENT") {
          resolve({
            ok: false,
            kind: "git-unavailable",
            detail:
              `the "git" command could not be executed (${code}). Evidence intake reads real ` +
              `commit history, so there is nothing it can honestly do without git installed ` +
              `and on PATH.`,
          });
          return;
        }
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(messageOf(err))) {
          resolve({
            ok: false,
            kind: "output-too-large",
            detail:
              `git produced more than ${maxBuffer} bytes of output. The read was ` +
              `ABANDONED rather than truncated: a truncated history would have produced a ` +
              `document that looks complete and silently omits commits.`,
          });
          return;
        }
        // Ordinary non-zero exit. execFile reports it as an error; it is data to us.
        const exitCode =
          err !== null && typeof err === "object" && "code" in err && typeof err.code === "number"
            ? err.code
            : 1;
        resolve({ ok: true, run: { exitCode, stdout, stderr: stderr || messageOf(err) } });
      },
    );
  });
}

/**
 * Map a run-level failure onto the right result variant.
 *
 * The two kinds carry DIFFERENT evidence — `output-too-large` reports the limit it hit, because
 * "too large" without the threshold is not actionable — so they cannot share one shape.
 */
function runFailure(
  kind: "git-unavailable" | "output-too-large",
  detail: string,
  path: string,
): GitIntakeResult {
  return kind === "output-too-large"
    ? { ok: false, cause: "output-too-large", detail, path, limitBytes: MAX_OUTPUT_BYTES }
    : { ok: false, cause: "git-unavailable", detail, path };
}

/**
 * Can this program be executed at all?
 *
 * `--version` because it is the one argument every signing backend answers without touching a
 * key, a keyring, or the terminal. Only ENOENT is treated as "no": a program that exists and
 * exits non-zero still exists, and deciding otherwise would report a working gpg as missing.
 * No shell, so a configured `gpg.program` containing spaces or metacharacters is one argv[0].
 */
function canRun(program: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(program, ["--version"], { timeout: PROBE_TIMEOUT_MS }, (err) => {
      resolve(err === null || codeOf(err) !== "ENOENT");
    });
  });
}

/**
 * One git config value AS THIS MACHINE SETS IT, or null when the machine does not set it.
 *
 * `--global` then `--system`, which is git's own precedence with the merged view removed, and no
 * `-C <repo>` — the repository is not consulted at all, and it must stay that way: this used to
 * read the merge and the value it returned was executed. There is no way to spell "everything
 * except the repo" as a single `config` scope, so it is two calls; each is a `--version`-free
 * config read and costs nothing next to two full history walks.
 *
 * `config --get` exits 1 for an absent key — a documented, locale-independent answer, the same
 * shape of contract as `rev-parse --verify --quiet`. A run-level failure is treated as "not
 * configured", which leads to the WEAKER claim about what this machine can check.
 */
async function machineConfigValue(key: string): Promise<string | null> {
  for (const scope of ["--global", "--system"] as const) {
    const run = await runGit(["config", "--get", scope, key]);
    if (!run.ok || run.run.exitCode !== 0) continue;
    const value = run.run.stdout.trim();
    if (value !== "") return value;
  }
  return null;
}

/**
 * The signing configuration of THIS MACHINE. One read, used for two things that must never
 * disagree: what the capability REPORTS, and which binaries the verifying reads are PINNED to.
 */
interface MachineSigningConfig {
  readonly format: string | null;
  /** `gpg.openpgp.program`, else its legacy synonym `gpg.program`. Git resolves them the same way. */
  readonly gpgProgram: string | null;
  readonly x509Program: string | null;
  readonly sshProgram: string | null;
  readonly allowedSignersFile: string | null;
}

async function readMachineSigningConfig(): Promise<MachineSigningConfig> {
  const openpgp = await machineConfigValue("gpg.openpgp.program");
  return Object.freeze({
    format: await machineConfigValue("gpg.format"),
    gpgProgram: openpgp ?? (await machineConfigValue("gpg.program")),
    x509Program: await machineConfigValue("gpg.x509.program"),
    sshProgram: await machineConfigValue("gpg.ssh.program"),
    allowedSignersFile: await machineConfigValue("gpg.ssh.allowedSignersFile"),
  });
}

/**
 * The `-c` arguments that stop a repository choosing the program which verifies its own commits.
 *
 * Every key git can route a signature to gets an explicit value, because the routing is decided by
 * the armor in the commit object and the repository writes the commit object. Passing git's own
 * default where the machine sets nothing keeps behaviour identical for every honest repository —
 * `gpg`, `gpgsm`, `ssh-keygen` are what git would have invoked anyway — and removes the only case
 * where the two differ: a repository that named something else.
 *
 * These go on the two `git log` invocations, not just the one with `%G?`, so that no future field
 * added to either read can quietly reopen this.
 */
function verifierPins(machine: MachineSigningConfig): readonly string[] {
  const openpgp = machine.gpgProgram ?? DEFAULT_GPG_PROGRAM;
  return [
    "-c",
    `gpg.program=${openpgp}`,
    "-c",
    `gpg.openpgp.program=${openpgp}`,
    "-c",
    `gpg.x509.program=${machine.x509Program ?? DEFAULT_X509_PROGRAM}`,
    "-c",
    `gpg.ssh.program=${machine.sshProgram ?? DEFAULT_SSH_PROGRAM}`,
  ];
}

/**
 * Git expands a leading `~/` in `gpg.ssh.allowedSignersFile`; so must this, or a file that is
 * configured and present would be reported as missing and the operator sent to fix a
 * non-problem.
 */
function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * What this machine is equipped to check, asked of the machine's git config and the filesystem.
 *
 * It takes the SAME `MachineSigningConfig` that `verifierPins` takes, and that is the whole repair:
 * the program this reports on, the program it executes, and the program git is pinned to are one
 * value read once. When they were three reads of a merged view, the repository could make the
 * probe execute one binary while claiming to describe another.
 */
async function capabilityOf(machine: MachineSigningConfig): Promise<SignatureCapability> {
  return Object.freeze({
    configuredFormat: machine.format,
    gpgProgram: machine.gpgProgram,
    gpgRuns: await canRun(machine.gpgProgram ?? DEFAULT_GPG_PROGRAM),
    sshProgram: machine.sshProgram,
    sshRuns: await canRun(machine.sshProgram ?? DEFAULT_SSH_PROGRAM),
    allowedSignersFile: machine.allowedSignersFile,
    allowedSignersFileExists:
      machine.allowedSignersFile === null
        ? null
        : await fileExists(expandHome(machine.allowedSignersFile)),
  });
}

/**
 * Refuse a repository whose git config file belongs to somebody else.
 *
 * A `.git/config` is an instruction set, and this file obeys part of it — `--pretty=raw` output
 * shape, `log.showSignature`, the allow-list git binds signatures through. Obeying instructions
 * written by a user who is not the operator is the precondition for every variant of the hole at
 * the top of this file, so a config file with a foreign owner ends the read by name instead.
 *
 * WHICH FILES. `--git-common-dir` is where the local config lives (and it is the SHARED one, so a
 * linked worktree is checked against the repository it belongs to, not against its own private
 * directory); `--git-dir` is where `config.worktree` lives when `extensions.worktreeConfig` is on.
 * Both are asked of git rather than derived by walking up for a `.git`, because git's discovery
 * has rules — `GIT_DIR`, ceiling directories, worktree pointer files — and a check that inspects a
 * DIFFERENT file from the one git reads is decoration. Relative output (`.git`) resolves against
 * `repoPath` because that is the `-C` git ran in.
 *
 * `stat`, not `lstat`: a symlinked config is read by git for its TARGET's contents, so the
 * target's owner is the one who wrote the instructions. A stranger's symlink to a file the
 * operator owns points at the operator's own words and is not an escalation.
 *
 * Missing files pass. `config-not-owned` is a claim about a file that exists and belongs to
 * someone else; a repository with no local config supplies no instructions to distrust.
 *
 * WHAT THIS DOES NOT CATCH, so nobody mistakes it for the fix: a repository you unpacked from a
 * tarball yourself is owned by you and passes. Git's `safe.directory` has the same limit. The
 * machine-only probe and the pinned verifier above are what close the reproduced hole; this is a
 * second lock on a door that has other ways in.
 */
async function refuseForeignConfig(repoPath: string): Promise<GitIntakeResult | null> {
  // No POSIX uids (Windows) means the comparison cannot be made. Skipping is honest; inventing an
  // owner to compare against would be the fake-data failure in a security check.
  const processUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (processUid === null) return null;

  const dirs = await runGit(["-C", repoPath, "rev-parse", "--git-common-dir", "--git-dir"]);
  if (!dirs.ok) return runFailure(dirs.kind, dirs.detail, repoPath);
  if (dirs.run.exitCode !== 0) {
    // Reachable only if the tree changed under the read: `--is-inside-work-tree` already said yes.
    return {
      ok: false,
      cause: "git-failed",
      detail:
        `git could not say where the config of ${repoPath} lives (exit ${dirs.run.exitCode}), so ` +
        `whose it is cannot be established. The read stops rather than proceeding to execute the ` +
        `signing programs a config nobody vetted may name: ` +
        `${dirs.run.stderr.trim() || "(no stderr)"}`,
      path: repoPath,
      exitCode: dirs.run.exitCode,
      stderr: dirs.run.stderr,
    };
  }
  const [commonDir, gitDir] = dirs.run.stdout.split("\n").map((line) => line.trim());
  const candidates = [
    commonDir === undefined || commonDir === "" ? null : resolve(repoPath, commonDir, "config"),
    gitDir === undefined || gitDir === "" ? null : resolve(repoPath, gitDir, "config.worktree"),
  ];

  for (const configPath of candidates) {
    if (configPath === null) continue;
    let configUid: number;
    try {
      configUid = (await stat(configPath)).uid;
    } catch {
      continue; // Not there: no instructions, nothing to distrust.
    }
    if (configUid === processUid) continue;
    return {
      ok: false,
      cause: "config-not-owned",
      detail:
        `${configPath} is owned by uid ${configUid} and this process is uid ${processUid}. A git ` +
        `config is an instruction set — it names the programs that verify signatures — so one ` +
        `written by another user is REFUSED rather than obeyed. No document is written from it. ` +
        `If this repository is genuinely yours, take ownership of the file (chown) and read again.`,
      path: repoPath,
      configPath,
      configUid,
      processUid,
    };
  }
  return null;
}

/**
 * Which signature each commit OBJECT carries, from `git log --pretty=raw` output.
 *
 * Pure and total: it reads what is there and never guesses. A commit whose record was seen with
 * no `gpgsig` header maps to `none`; a commit that was NOT seen is absent from the map, which
 * the caller treats as a failed read rather than as an unsigned commit — the difference between
 * "no signature" and "not looked at" is the entire subject of this file.
 *
 * O(lines), one pass, no backtracking.
 */
function armorByObject(raw: string): Map<string, SignatureArmor> {
  const armor = new Map<string, SignatureArmor>();
  let current: string | null = null;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const opened = RAW_COMMIT_LINE.exec(line);
    if (opened !== null) {
      current = opened[1] ?? null;
      if (current !== null) armor.set(current, "none");
      continue;
    }
    if (current === null) continue;
    const signed = RAW_SIGNATURE_LINE.exec(line);
    if (signed === null) continue;
    const block = signed[1] ?? "";
    armor.set(
      current,
      block.startsWith(PGP_ARMOR) ? "pgp" : block.startsWith(SSH_ARMOR) ? "ssh" : "other",
    );
  }
  return armor;
}

/**
 * One record as the FORMATTED read gives it — the verdict half of a commit, before the object
 * scan is joined onto it. Named rather than inlined so that no code path can construct an
 * `ObservedCommit` with a fabricated `signatureArmor`: the type will not let it.
 */
type ObservedVerdict = Omit<ObservedCommit, "signatureArmor">;

/** Parse one `\x1e`-delimited record, or explain precisely why it could not be read. */
function parseRecord(raw: string): ObservedVerdict | string {
  // Strip exactly the ONE newline git writes between records — not a trim, which would eat
  // meaningful leading whitespace out of a commit subject.
  const record = raw.replace(/^\r?\n/, "");
  const fields = record.split(UNIT_SEPARATOR);
  if (fields.length !== FIELDS_PER_RECORD) {
    return (
      `expected ${FIELDS_PER_RECORD} fields, got ${fields.length}. A commit subject — or a ` +
      `signer name, which is equally free text — containing a 0x1f control character would do ` +
      `this. Record begins: ${JSON.stringify(record.slice(0, 80))}`
    );
  }
  const [sha, authorEmail, signature, signer, subject] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  return { sha, authorEmail, signature, signer, subject };
}


/**
 * WHICH REFS A WALK USES, decided once and reported when it has to narrow.
 *
 * `--branches HEAD` makes EVERY entry in `refs/heads` load-bearing: one corrupt or unreadable ref
 * and git exits with `fatal: bad object <name>`, so a repository whose HEAD history is completely
 * intact produced NO DOCUMENT AT ALL. Measured by the review as a regression against a bare
 * `git log`, which reads that repository happily.
 *
 * Refusing outright would be honest but harsh — one dead branch should not cost somebody their
 * whole portfolio. Falling back SILENTLY would be worse, and is the failure this file's own
 * sibling documents: "a git failure is NEVER collapsed into empty results." So the walk narrows to
 * HEAD and says so, and the caller prints it. Nobody is told they have less work than they have
 * without also being told why.
 *
 * @returns the ref arguments to use, and the reason if it had to narrow
 */
async function refsFor(
  repoPath: string,
  pins: readonly string[],
): Promise<{ readonly refs: readonly string[]; readonly narrowedBecause: string | null }> {
  /*
   * THE TWO REF SETS ARE PROBED SEPARATELY, and the first version of this was wrong for exactly the
   * reason that matters. Probing `--branches HEAD` together fails when EITHER is unusable — so an
   * UNBORN HEAD (legal, and common in a repository whose work lives on a branch) made the whole
   * probe fail, narrowed the walk to HEAD, and read nothing at all. Caught by mutation-testing this
   * very fix: the case existed in a test before the code was right.
   *
   * Asked apart, each ref set contributes what it can. A corrupt branch costs the branches; an
   * unborn HEAD costs HEAD; neither costs the other, and only the branch failure is a NARROWING
   * worth reporting, because an unborn HEAD is an ordinary state and not a partial read.
   */
  const branches = await runGit([...pins, "-C", repoPath, "rev-list", "-n", "1", "--branches", "--"]);
  const branchesOk = branches.ok && branches.run.exitCode === 0;
  const head = await runGit([...pins, "-C", repoPath, "rev-parse", "--verify", "--quiet", "HEAD"]);
  const headOk = head.ok && head.run.exitCode === 0 && head.run.stdout.trim() !== "";

  const refs = [...(branchesOk ? ["--branches"] : []), ...(headOk ? ["HEAD"] : []), "--"];
  if (branchesOk) return { refs, narrowedBecause: null };
  const detail = branches.ok ? branches.run.stderr.trim() : branches.detail;
  return { refs, narrowedBecause: detail || "a local branch ref could not be read" };
}

/**
 * Read every non-merge commit reachable from HEAD.
 *
 * Each git invocation has an unambiguous machine-readable contract, so every failure mode gets
 * its own name instead of one catch-all "could not read repository":
 *   1. `rev-parse --is-inside-work-tree` — is this a repository at all?
 *   2. `rev-parse --git-common-dir --git-dir` — whose config is this? Not ours, no read.
 *   3. `rev-parse --verify --quiet HEAD`  — does it have any commits?
 *   4. `log --no-merges --format=...`     — the history, git's VERDICT on each signature, and
 *                                           the SIGNER it bound that verdict to.
 *   5. `log --no-merges --pretty=raw`     — the OBJECTS, and what signature each really carries.
 *   6. `config --get --global|--system …` and a `--version` probe — what THIS MACHINE can check,
 *                                           and why not. Never the repository's merged config.
 *
 * (4) and (5) both pass `--no-show-signature`, because `log.showSignature` is a config a
 * developer may well have on and it rewrites both of these reads out from under the parser. Both
 * also carry `verifierPins`, so the repository cannot name the program that checks its own
 * signatures — the reproduced arbitrary-code-execution hole, described in full at the top.
 *
 * (4) and (5) are a differential control, and they must agree about WHICH commits exist: a
 * commit present in one and absent from the other is a read this function refuses to complete,
 * because the alternative is defaulting a commit to "unsigned" on no evidence.
 *
 * Complexity: O(n) in commits, two passes over git's output.
 */
export async function readCommits(repoPath: string): Promise<GitIntakeResult> {
  try {
    const info = await stat(repoPath);
    if (!info.isDirectory()) {
      return {
        ok: false,
        cause: "no-such-path",
        detail: `${repoPath} exists but is not a directory, so it cannot be a repository.`,
        path: repoPath,
      };
    }
  } catch (err) {
    return {
      ok: false,
      cause: "no-such-path",
      detail: `${repoPath} could not be examined: ${messageOf(err)} [${codeOf(err)}]`,
      path: repoPath,
    };
  }

  const inside = await runGit(["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    return runFailure(inside.kind, inside.detail, repoPath);
  }
  if (inside.run.exitCode !== 0 || inside.run.stdout.trim() !== "true") {
    return {
      ok: false,
      cause: "not-a-repo",
      detail:
        `${repoPath} is not inside a git work tree, so there is no commit history to read: ` +
        `${inside.run.stderr.trim() || "git reported no work tree"}`,
      path: repoPath,
    };
  }

  // THE GATE. Everything above executes nothing a repository can name (measured — see the header);
  // everything below either probes a program or asks git to verify a signature, so this is where
  // an unvetted config stops being read.
  const foreign = await refuseForeignConfig(repoPath);
  if (foreign !== null) return foreign;

  const root = await runGit(["-C", repoPath, "rev-parse", "--show-toplevel"]);
  const repoRoot =
    root.ok && root.run.exitCode === 0 ? root.run.stdout.trim() : repoPath;

  // HEAD's own sha, for the caller. Unborn is legal and is not a failure — it simply means the
  // returned `head` is null while the walk below may still find work.
  const head = await runGit(["-C", repoPath, "rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head.ok) {
    return runFailure(head.kind, head.detail, repoPath);
  }
  const machine = await readMachineSigningConfig();
  const signatureCapability = await capabilityOf(machine);

  /*
   * THE EMPTINESS GATE ASKS THE QUESTION THE READ ASKS, not a narrower one.
   *
   * It used to ask only whether HEAD existed, which was right when the walk was HEAD-only. Once the
   * walk widened to `--branches HEAD` the two disagreed, and the review measured the gap: a
   * repository with an UNBORN HEAD and a populated branch was reported as an honest empty — zero
   * commits, ok — while `gatherGit`, reading the same repository, called it a hard failure. One
   * repository, two readers, opposite answers, and the person's work in neither.
   *
   * `rev-list -n 1` over the same refs answers exactly what the walk will find, so "empty" now
   * means empty to the thing that reads it. `--` terminates the ref list for the same reason it
   * does below: a file named `HEAD` is legal and would otherwise make this ambiguous.
   */
  const pinsForRefs = verifierPins(machine);
  const { refs, narrowedBecause } = await refsFor(repoPath, pinsForRefs);
  const any = await runGit([...pinsForRefs, "-C", repoPath, "rev-list", "-n", "1", ...refs]);
  if (!any.ok) {
    return runFailure(any.kind, any.detail, repoPath);
  }
  if (any.run.exitCode !== 0) {
    // A missing commit object still passes rev-parse. Only a successful empty walk proves
    // emptiness; treating this failure as zero lets propose erase the existing review queue.
    return {
      ok: false,
      cause: "git-failed",
      detail:
        `git rev-list exited ${any.run.exitCode} while checking history in ${repoPath}: ` +
        `${any.run.stderr.trim() || "(no stderr)"}` +
        (narrowedBecause === null ? "" : `; the local branch read also failed: ${narrowedBecause}`),
      path: repoPath,
      exitCode: any.run.exitCode,
      stderr: any.run.stderr,
    };
  }
  if (any.run.stdout.trim() === "") {
    return { ok: true, commits: [], repoRoot, head: null, signatureCapability, narrowedBecause };
  }

  /*
   * WORK IN FLIGHT IS STILL WORK — `--branches HEAD`, not a bare `git log`.
   *
   * A bare `git log` walks HEAD and nothing else, so everything a person has done on a branch they
   * have not merged yet is invisible to their own portfolio. MEASURED on this repository:
   * 253 commits reachable from HEAD, 355 from `--branches`, so **102 of the subject's own commits
   * — 29% of their work — could not be seen**, and every one of the 102 carried the subject's own
   * address. That is not an edge case; it is what "what they are doing" looks like in a git repo,
   * and a portfolio that only knows finished work is a portfolio that is always weeks behind.
   *
   * `HEAD` IS NAMED ALONGSIDE `--branches` for the detached case: `--branches` walks local branch
   * tips, and a detached HEAD is on none of them, so the bare flag would drop the very commits the
   * person is standing on. On an attached HEAD the two sets are identical — measured, 355 either
   * way — so naming both costs nothing and closes the case that would otherwise lose work silently.
   *
   * LOCAL BRANCHES ONLY, deliberately: `--all` would add remote-tracking refs and tags, which is
   * every colleague's work in a shared clone. Attribution is not weakened either way — the identity
   * partition downstream keeps only commits matching the declared addresses — but reading a whole
   * team's history to then discard it is work done to reach the same answer.
   *
   * The same rule is applied in `apps/photosynthesis/src/gather.ts`, which reads the same history
   * for a different purpose. Two readers, one rule: recorded rather than extracted here, on F-026's
   * stated reason — a cross-file refactor landing with a behaviour change invalidates the review of
   * both.
   */
  const pins = verifierPins(machine);
  const log = await runGit([
    ...pins,
    "-C",
    repoPath,
    "log",
    "--no-merges",
    NO_SHOW_SIGNATURE,
    `--format=${LOG_FORMAT}`,
    ...refs,
  ]);
  if (!log.ok) {
    return runFailure(log.kind, log.detail, repoPath);
  }
  if (log.run.exitCode !== 0) {
    // HEAD exists, so this is a real failure — not an empty history. Returning zero commits
    // here is exactly the forbidden move.
    return {
      ok: false,
      cause: "git-failed",
      detail:
        `git log exited ${log.run.exitCode} while reading ${repoPath}. No document is written ` +
        `from a failed read: ${log.run.stderr.trim() || "(no stderr)"}`,
      path: repoPath,
      exitCode: log.run.exitCode,
      stderr: log.run.stderr,
    };
  }

  // THE SECOND READ. `%G?` above is git's verdict; this is the artifact it was a verdict about.
  // Without it, "N" is indistinguishable from "I could not run the checker", and this file would
  // hand the domain an observation it had no basis for.
  //
  // THE TWO READS MUST WALK THE SAME REFS, and this pair is why the rule is written down. Widening
  // the formatted log to `--branches HEAD` and leaving this one on a bare `git log` made the two
  // disagree the moment a branch went unmerged — and the disagreement check below did exactly what
  // it was built to do: it REFUSED with `unreadable-output` rather than defaulting the branch
  // commits to "unsigned". That refusal is correct and it is not the bug; the bug was reading two
  // different histories and asking them to agree. Any future change to the ref selection changes
  // BOTH lists or reintroduces this, and the failure it produces names a commit rather than a flag.
  const raw = await runGit([
    ...pins,
    "-C",
    repoPath,
    "log",
    "--no-merges",
    NO_SHOW_SIGNATURE,
    "--pretty=raw",
    ...refs,
  ]);
  if (!raw.ok) {
    return runFailure(raw.kind, raw.detail, repoPath);
  }
  if (raw.run.exitCode !== 0) {
    return {
      ok: false,
      cause: "git-failed",
      detail:
        `git log --pretty=raw exited ${raw.run.exitCode} while scanning the commit objects of ` +
        `${repoPath}. The read is abandoned rather than completed without it: with no scan, a ` +
        `signed commit git could not check is indistinguishable from an unsigned one, and the ` +
        `document would assert unsigned history nobody read. ` +
        `${raw.run.stderr.trim() || "(no stderr)"}`,
      path: repoPath,
      exitCode: raw.run.exitCode,
      stderr: raw.run.stderr,
    };
  }
  const armor = armorByObject(raw.run.stdout);

  const commits: ObservedCommit[] = [];
  for (const chunk of log.run.stdout.split(RECORD_SEPARATOR)) {
    if (chunk.replace(/^\r?\n/, "") === "") continue; // trailing remainder after the last record
    const parsed = parseRecord(chunk);
    if (typeof parsed === "string") {
      return {
        ok: false,
        cause: "unreadable-output",
        detail: `a commit record from ${repoPath} could not be read: ${parsed}`,
        path: repoPath,
      };
    }
    const carried = armor.get(parsed.sha);
    if (carried === undefined) {
      // The two reads disagree about which commits exist — a commit landed between them, or the
      // formats diverged. Defaulting to "none" here would invent the exact fact this pair of
      // reads exists to establish, so the read fails instead.
      return {
        ok: false,
        cause: "unreadable-output",
        detail:
          `the two reads of ${repoPath} disagree: commit ${parsed.sha} appears in the formatted ` +
          `log but not in the object scan, so what it carries is unknown. That is refused ` +
          `rather than defaulted to "unsigned" — the default would be a fact nobody observed.`,
        path: repoPath,
      };
    }
    commits.push({ ...parsed, signatureArmor: carried });
  }
  if (armor.size !== commits.length) {
    return {
      ok: false,
      cause: "unreadable-output",
      detail:
        `the two reads of ${repoPath} disagree: the object scan saw ${armor.size} commit(s) and ` +
        `the formatted log ${commits.length}. History changed under the read, or the two ` +
        `walks differ; either way the signature state of this repository is not established, ` +
        `and a partial answer here is the undercount this module refuses.`,
      path: repoPath,
    };
  }

  // `head` may legitimately be empty here — an unborn HEAD with work on a branch — and the caller's
  // contract is a sha or null, never an empty string pretending to be one.
  return { ok: true, commits, repoRoot, head: head.run.stdout.trim() || null, signatureCapability, narrowedBecause };
}
