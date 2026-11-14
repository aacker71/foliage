#!/usr/bin/env node
/**
 * EVIDENCE INTAKE — the command that produces a leaf document from real work.
 *
 * Until this file existed, the only way to get a populated leaf was for a human to type JSON,
 * and the single populated document in the tree declared `"example": true` with refs reading
 * `example-ref-not-a-commit-0001`. Every populated page this product had ever rendered carried
 * the fabrication band. This is the producer, and the band's absence is the whole point.
 *
 *   node apps/leaf/intake.mjs --repo <path> --subject "<name>" --identity <email> [--out <path>]
 *
 * WHAT IT REFUSES TO DO, which matters more than what it does:
 *   - It never writes a document from a failed read. If git cannot be run, or the path is not a
 *     repository, or the output could not be parsed, it prints the cause and exits non-zero. A
 *     zero-leaflet file written after a failure is the `commitCount: 0` bug, and it is the one
 *     this project has already paid for.
 *   - It never overwrites an existing document without --force, using an atomic exclusive
 *     create rather than a check-then-write, so two runs cannot race past the guard.
 *   - --force NO LONGER MEANS "replace the file", and the docstring that used to say it did
 *     was describing behaviour that destroyed people's approvals. The write was
 *     `flag: force ? "w" : "wx"` over the WHOLE document, while apps/photosynthesis/src/
 *     promote.ts APPENDS human-approved leaflets to that same file. Two writers, one file, and
 *     the appending one loses. MEASURED 2026-08-18 on the demo document: 59 leaflets of which
 *     2 were promoted went in, 68 leaflets of which 0 were promoted came out — exit 0, no
 *     warning, no mention anywhere in the output. The rows destroyed were precisely the ones a
 *     human had reviewed, which inverts this product's central claim that a portfolio changes
 *     only because a person approved something. Under --force intake now READS the existing
 *     document, MERGES with `mergeLeafDocuments` from @foliage/leaf, and OWNS EXACTLY the
 *     leaflets it re-derived this run whose `provenance.source` is "git". Everything else is
 *     carried forward unmodified; a git-sourced leaflet this run did not re-derive is KEPT and
 *     REPORTED BY ID with a named cause, never silently dropped.
 *   - It never overwrites an existing document it could not READ. Unreadable, malformed,
 *     invalid, or foreign (its id or subject names somebody else) is a named cause with
 *     NOTHING written. A fall-through to overwrite is how "I could not understand your file"
 *     becomes "your file is gone".
 *   - It validates its OWN output with `parseLeafDocument` before writing — the MERGED output,
 *     not merely the derived half, because the bytes that reach the disk are the ones that have
 *     to load. A producer that can emit a document its own loader rejects is a producer nobody
 *     can trust; this closes the loop mechanically instead of by assertion.
 *   - It marks nothing as verified that git did not cryptographically verify FOR ONE OF THE
 *     DECLARED IDENTITIES. On a repository of unsigned commits the honest answer is "0
 *     verified", and it prints that plainly. It printed "verified 1" for a commit signed by a
 *     stranger's key until the tier learned to read `%GS`: git had named the signer, and the
 *     tier was reading only the verdict beside it.
 *   - A merge preserves the one line the subject wrote (DT-1): intake derives everything else
 *     on this document, but it may never author or drop the headline.
 *   - It never says "0 verified is correct for unsigned history" about history it did not
 *     check. That sentence WAS printed unconditionally, and on the measuring machine it was
 *     false: `%G?` reports `N` for every commit in a repository there while 298 of those
 *     commits carry a real signature, because gpg is not installed and
 *     gpg.ssh.allowedSignersFile is not configured. Now the count of unchecked signatures is
 *     named, both causes are named, and the remedy is printed — see `reportSignatures` below.
 *
 * Zero third-party runtime dependencies: `node:util`'s parseArgs does the command line, git
 * does the reading, and both are already on the machine. The workspace packages still need
 * `pnpm install` once to be linked — the dynamic imports below exist so that forgetting it
 * produces an instruction, not a stack trace.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");
const { lockRefusal } = await import("./src/lockRefusal.ts");

const { attributionLedger, commitsToLeaflets, leafId, mergeIntakeIntoLeaf, parseLeafDocument } =
  await import("@foliage/leaf").catch(explainFailedWorkspaceImport);

const { narrowingNotice, readCommits } = await import("./src/gitIntake.ts").catch(explainFailedWorkspaceImport);
const { commitsHeld } = await import("./src/gitQueueSource.ts").catch(explainFailedWorkspaceImport);
const { foliageNextStep } = await import("./src/foliageNextStep.ts").catch(explainFailedWorkspaceImport);
const { DEFAULT_DOCUMENT_PATH, DOCUMENT_ENV, loadLeafDocument } = await import(
  "./src/leafDocument.ts"
).catch(explainFailedWorkspaceImport);

/*
 * The merge rule is the whole of the --force fix, and a workspace that resolved @foliage/leaf
 * to a copy without it would otherwise fail as "mergeIntakeIntoLeaf is not a function" at the
 * one moment a person's approved leaflets are on the line. Named and refused up front, with
 * nothing touched — the same posture as every other refusal in this file.
 */
if (typeof mergeIntakeIntoLeaf !== "function") {
  process.stderr.write(
    `intake: the resolved @foliage/leaf does not export mergeIntakeIntoLeaf, which is the rule\n` +
      `intake: that stops --force destroying human-approved leaflets. Refusing to run rather\n` +
      `intake: than write without it. Re-run "pnpm install" so the workspace link is current.\n`,
  );
  // The literal, not EXIT_FAILED: this runs at module load, above that const's declaration,
  // and reaching for the named one here would throw a ReferenceError instead of exiting.
  process.exit(1);
}

const USAGE = `Evidence intake — build a leaf document from a repository's real commit history.

  node apps/leaf/intake.mjs --repo <path> --subject "<name>" --identity <email> [options]

Required
  --repo <path>        repository to read
  --subject "<name>"   display name of the person this portfolio describes
  --identity <email>   an email address the subject claims as theirs.
                       Repeatable — a real person has a work address, a personal one and a
                       forge noreply, and omitting one would exclude their own commits.

Options
  --out <path>         where to write (default: ${DEFAULT_DOCUMENT_PATH}, which is gitignored)
  --id <slug>          leaf id (default: a slug of --subject)
  --force              MERGE into an existing document rather than refusing to touch it.
                       It does not mean "replace". Intake owns only the leaflets it
                       re-derived this run whose provenance.source is "git"; every other
                       leaflet — anything a human approved through Photosynthesis, anything
                       hand-written — is carried forward unmodified.
  --drop-underived     also REMOVE git-sourced leaflets this run did not re-derive. Off by
                       default: without it they are kept and listed, because "this run did
                       not see that commit" is not the same fact as "that work never
                       happened", and a rebase or a wrong --repo produces the first one.
  --help

Tiers are assigned from real git signals only: a commit is "verified" solely when git ACCEPTED
its signature (%G? of G or U) and the signer git named (%GS) is one of the declared identities.
A matching author email is self-declared and yields "pending" — including when git accepted a
signature made by somebody else, which is a real signature and not proof about this subject.
Work by another author is "excluded", with a reason.

A signature this machine could not CHECK is reported separately from history that carries no
signature at all. Both are "pending", and they are not the same fact: git prints the same code
for "unsigned" and for "I could not run the checker", so intake reads the commit objects too and
tells you which you are looking at.
`;

/** Exit codes, so a caller can tell a usage mistake from a read failure. */
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

/** @param {string} message */
function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`intake: ${message}\n`);
  process.exit(code);
}

/**
 * A stable, url-safe id derived from the subject's name.
 *
 * Deterministic, because idempotency depends on it: the same subject must produce the same id
 * on every run or two intakes of one repository would differ in more than `observedAt`.
 *
 * @param {string} subject
 * @returns {string}
 */
function slugify(subject) {
  return subject
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** @returns {{repo: string, subject: string, identities: string[], out: string, id: string, force: boolean, dropUnderived: boolean}} */
function readArguments() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        repo: { type: "string" },
        subject: { type: "string" },
        identity: { type: "string", multiple: true },
        out: { type: "string" },
        id: { type: "string" },
        force: { type: "boolean", default: false },
        "drop-underived": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }

  const values = parsed.values;
  if (values.help === true) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const missing = [];
  if (values.repo === undefined || values.repo.trim() === "") missing.push("--repo");
  if (values.subject === undefined || values.subject.trim() === "") missing.push("--subject");
  const identities = (values.identity ?? []).filter((e) => e.trim() !== "");
  if (identities.length === 0) missing.push("--identity");
  if (missing.length > 0) {
    process.stderr.write(`missing required argument(s): ${missing.join(", ")}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }

  // Refused rather than ignored, for the same reason the document format refuses unknown keys:
  // a flag that silently does nothing is indistinguishable from one that worked.
  if (values["drop-underived"] === true && values.force !== true) {
    process.stderr.write(
      `--drop-underived only means anything alongside --force: without --force intake never ` +
        `touches an existing document at all.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }

  const subject = /** @type {string} */ (values.subject).trim();
  const id = (values.id ?? slugify(subject)).trim();
  if (id === "") {
    // Rather than invent an id from nothing. A name that slugifies to empty (for instance one
    // written entirely in a script this rule does not cover) is a real case, and guessing would
    // put an arbitrary string in the subject's own document.
    fail(
      `--subject "${subject}" does not yield a usable id, so one must be given explicitly: ` +
        `pass --id <slug>.`,
      EXIT_USAGE,
    );
  }

  return {
    repo: resolve(/** @type {string} */ (values.repo).trim()),
    subject,
    identities,
    out: values.out === undefined ? DEFAULT_DOCUMENT_PATH : resolve(values.out.trim()),
    id,
    force: values.force === true,
    dropUnderived: values["drop-underived"] === true,
  };
}

/**
 * Say what this machine actually established about the repository's signatures — including,
 * loudly, what it did NOT establish.
 *
 * THE SENTENCE THIS REPLACES was printed whenever the verified count was zero: "0 verified is
 * the correct result for unsigned history". On the measuring machine that was false for a
 * repository there — 298 of its commits carry a real signature and git checked none
 * of them, because gpg is not installed and gpg.ssh.allowedSignersFile is not configured. The
 * sentence still appears, but only when it is TRUE: when nothing went unchecked.
 *
 * Both causes are reported, never one: the DIFFERENTIAL (a signature in the object with git
 * saying "N") says that the check did not happen, and the CAPABILITY PROBE says why and what to
 * do about it. A count with no remedy informs an operator without helping them.
 *
 * @param {{ write(text: string): unknown }} out
 * @param {Extract<import("@foliage/leaf").CommitIntake, { ok: true }>} intake
 * @param {import("./src/gitIntake.ts").SignatureCapability} capability
 * @param {string} repoRoot
 */
function reportSignatures(out, intake, capability, repoRoot) {
  // A REJECTING verdict from a backend that cannot be executed is not a rejection. REPRODUCED:
  // with a correct allowed_signers file and gpg.ssh.program pointing at a path that does not
  // exist, git answers `B` about a cryptographically perfect signature, and this command printed
  // "checked and did not accept" about a check that never happened. Split by which backend would
  // have run, and say only what the probe supports.
  /** @param {import("@foliage/leaf").SignatureArmor} armor @returns {boolean | null} */
  const backendRan = (armor) =>
    armor === "ssh" ? capability.sshRuns : armor === "pgp" ? capability.gpgRuns : null;
  const rejected = intake.rejectedSignatures;
  const reallyRejected = rejected.filter((s) => backendRan(s.armor) !== false);
  const unrunnable = rejected.filter((s) => backendRan(s.armor) === false);
  const firstRejected = reallyRejected[0];
  if (firstRejected !== undefined) {
    out.write(
      `intake: ${reallyRejected.length} commit(s) carry a signature git CHECKED AND DID NOT ACCEPT —\n` +
        `intake: bad, expired, or made by a revoked key. They are "pending", and they are not\n` +
        `intake: unsigned history: git -C ${repoRoot} verify-commit ${firstRejected.ref}\n`,
    );
  }
  const firstUnrunnable = unrunnable[0];
  if (firstUnrunnable !== undefined) {
    const program =
      firstUnrunnable.armor === "ssh"
        ? `gpg.ssh.program ("${capability.sshProgram ?? "ssh-keygen"}")`
        : `gpg.program ("${capability.gpgProgram ?? "gpg"}")`;
    out.write(
      `intake: ${unrunnable.length} commit(s) got a REJECTING verdict from git while the program\n` +
        `intake: that would have checked them — ${program} — cannot be\n` +
        `intake: executed here. Nothing was checked, so this is NOT "a bad signature": fix the\n` +
        `intake: program and ask again. They are "pending" either way:\n` +
        `intake:   git -C ${repoRoot} verify-commit ${firstUnrunnable.ref}\n`,
    );
  }

  const undeclared = intake.undeclaredSignatures;
  const firstUndeclared = undeclared[0];
  if (firstUndeclared !== undefined) {
    out.write(
      `intake: ${undeclared.length} commit(s) carry a signature git ACCEPTED FROM SOMEBODY ELSE —\n` +
        `intake: the signer git bound is not one of the declared identities, so the signature is\n` +
        `intake: real and it is not proof that this subject wrote the commit. They stay\n` +
        `intake: "pending", NOT excluded: the author field is the subject's, and "not proven" is\n` +
        `intake: a different claim from "somebody else's work". If one of those addresses IS the\n` +
        `intake: subject's, declare it with another --identity. The signer's address is not\n` +
        `intake: printed here — it is a third party's; git will show it to you:\n` +
        `intake:   git -C ${repoRoot} verify-commit ${firstUndeclared.ref}\n`,
    );
  }

  const unbound = intake.unboundSignatures;
  const firstUnbound = unbound[0];
  if (firstUnbound !== undefined) {
    out.write(
      `intake: ${unbound.length} commit(s) carry a signature git accepted and tied to NO\n` +
        `intake: IDENTITY — the signer is empty (ssh's "%G?" of U) or names no address at all,\n` +
        `intake: which proves some key signed them, not that this subject did. They stay\n` +
        `intake: "pending". List the signer in gpg.ssh.allowedSignersFile ("<email> <ssh public\n` +
        `intake: key>") and git will report a bound signature instead:\n` +
        `intake:   git -C ${repoRoot} verify-commit ${firstUnbound.ref}\n`,
    );
  }

  const unchecked = intake.uncheckedSignatures;
  const first = unchecked[0];
  if (first === undefined) return;

  const pgp = unchecked.filter((s) => s.armor === "pgp").length;
  const ssh = unchecked.filter((s) => s.armor === "ssh").length;
  // Counted apart rather than swept into "another format", which would be a claim about armor
  // nobody saw: git says it could not check a signature and the object scan found none. That is
  // the two reads contradicting each other, and it is reported as such below.
  const bare = unchecked.filter((s) => s.armor === "none").length;
  const other = unchecked.length - pgp - ssh - bare;
  const attributable = unchecked.filter((s) => s.attributable).length;
  // `N` is the mask specifically: git's code for "there is no signature", said about an object
  // that holds one. `E` is git admitting it could not check, which is bad but not misleading.
  const masked = unchecked.filter((s) => s.code === "N").length;
  const kinds = [
    pgp > 0 ? `${pgp} PGP` : "",
    ssh > 0 ? `${ssh} SSH` : "",
    other > 0 ? `${other} in another format` : "",
    bare > 0 ? `${bare} with no signature this reader could see` : "",
  ].filter((k) => k !== "");

  out.write(
    `intake: ${unchecked.length} commit(s) CARRY A SIGNATURE THIS MACHINE DID NOT CHECK\n` +
      `intake: (${kinds.join(", ")}). Nobody looked at them, which is not the same fact as\n` +
      `intake: their carrying no signature.\n`,
  );
  // Said exactly, because the two populations land in different tiers: an unchecked signature on
  // the subject's own commit is what a check might have promoted, whereas one on somebody else's
  // commit is excluded whatever git says about it. Reporting the total as "pending" would be a
  // small version of the collapse this whole report exists to undo.
  out.write(
    attributable > 0
      ? `intake:   ${attributable} of them ${attributable === 1 ? "is" : "are"} attributable to ` +
          `this subject, sitting at "pending"\n` +
          `intake:   for want of a check, not for want of a signature.\n`
      : `intake:   none of them is attributable to this subject — they are somebody else's work\n` +
          `intake:   and counted as excluded. They are reported here anyway, because "this\n` +
          `intake:   machine cannot check signatures" is a fact about the machine.\n`,
  );
  if (masked > 0) {
    out.write(
      `intake:   for ${masked} of them git reported "N", its code for NO SIGNATURE, about a\n` +
        `intake:   commit object that plainly holds one. Reading only that code is how a\n` +
        `intake:   product ends up asserting unsigned history it never read.\n`,
    );
  }

  out.write(`intake: why this machine could not check them:\n`);
  const program = capability.gpgProgram ?? "gpg";
  if (pgp > 0) {
    out.write(
      capability.gpgRuns
        ? `intake:   PGP — "${program}" does run here, so the failure is inside it: the signing\n` +
            `intake:   key is most likely absent from this machine's keyring. Import it.\n`
        : `intake:   PGP — git invokes "${program}", which cannot be executed here. Install gpg,\n` +
            `intake:   or point gpg.program at the binary you use.\n`,
    );
  }
  if (ssh > 0 && !capability.sshRuns) {
    // Named FIRST, because it makes the allowed-signers advice below irrelevant: no file fixes a
    // checker that cannot start.
    out.write(
      `intake:   SSH — git invokes "${capability.sshProgram ?? "ssh-keygen"}" for ssh signatures,\n` +
        `intake:   and it cannot be executed here. Nothing else about the ssh setup matters until\n` +
        `intake:   that is fixed: install ssh-keygen, or point gpg.ssh.program at the binary.\n`,
    );
  }
  if (ssh > 0) {
    out.write(
      capability.allowedSignersFile === null
        ? `intake:   SSH — gpg.ssh.allowedSignersFile is not configured. Git will not bind an\n` +
            `intake:   ssh signature to an identity without it, so it refuses to verify at all.\n` +
            `intake:   Write one line per signer ("<email> <ssh public key>"), then:\n` +
            `intake:     git config gpg.ssh.allowedSignersFile <path>\n`
        : capability.allowedSignersFileExists === false
          ? `intake:   SSH — gpg.ssh.allowedSignersFile is set to ${capability.allowedSignersFile}\n` +
            `intake:   and no such file exists. Git needs it to exist, not merely to be named.\n`
          : `intake:   SSH — gpg.ssh.allowedSignersFile exists, so the signing key is most likely\n` +
            `intake:   not listed in it. Add a "<email> <ssh public key>" line for the signer.\n`,
    );
  }
  if (other > 0) {
    out.write(
      `intake:   ${other} commit(s) are signed in neither PGP nor SSH armor (x509, or a format\n` +
        `intake:   this version does not know). Reproduce by hand before concluding anything.\n`,
    );
  }
  if (bare > 0) {
    out.write(
      `intake:   for ${bare} of them git said it could not check a signature while the object\n` +
        `intake:   scan found none to check. The two reads CONTRADICT each other — most likely a\n` +
        `intake:   signature header this reader does not recognise — so neither is repeated here\n` +
        `intake:   as fact. Read the object yourself before concluding anything.\n`,
    );
  }
  out.write(
    `intake: a signature nobody checked promotes nothing, and proves nothing against either.\n` +
      `intake: check one yourself:  git -C ${repoRoot} verify-commit ${first.ref}\n`,
  );
}

/**
 * Turn what the loader found at the output path into the state the merge rule reasons about.
 *
 * Two vocabularies, deliberately not one. `LeafLoad` splits five causes because they are five
 * different things to DO about a filesystem; `ExistingLeaf` splits four because they are four
 * different things the MERGE may do, and merging is where "unreadable" and "unparseable" have
 * the same consequence — refuse, write nothing. The mapping is the lossy step, so the caller
 * keeps `load.cause` and prints it alongside the refusal: `malformed` (the bytes are not JSON)
 * and `invalid` (the JSON is not a leaf) both become `unparseable`, and the person staring at
 * their own file is the one who needs to know which they have.
 *
 * `malformed` carries no issue list — the JSON parser gives one message, not a list — so its
 * detail is carried through as a single issue at `(document)`, which is where
 * `parseLeafDocument` puts its own whole-document failures. Nothing is invented: the string is
 * the loader's, verbatim.
 *
 * `unconfigured` cannot arise here because this call passes an explicit path; it is handled
 * anyway rather than defaulted, because a switch that falls through to "absent" would answer
 * "there is no file" about a case that means "I do not know where to look".
 *
 * @param {import("./src/leafDocument.ts").LeafLoad} load
 * @returns {import("@foliage/leaf").ExistingLeaf}
 */
function existingLeafFrom(load) {
  if (load.ok) return { state: "present", leaf: load.leaf };
  switch (load.cause) {
    case "absent":
      return { state: "absent" };
    case "unreadable":
      // `detail` already ends in the errno; appending `load.errno` printed "[EISDIR] [EISDIR]".
      return { state: "unreadable", detail: load.detail };
    case "malformed":
      return { state: "unparseable", issues: [{ at: "(document)", message: load.detail }] };
    case "invalid":
      return { state: "unparseable", issues: load.issues };
    case "unconfigured":
      return { state: "unreadable", detail: load.detail };
    default: {
      const impossible = /** @type {never} */ (load);
      return { state: "unreadable", detail: `unhandled load cause: ${JSON.stringify(impossible)}` };
    }
  }
}




/**
 * Why a git-sourced leaflet already in the document was not re-derived this run, in a sentence.
 *
 * The cause is an enum in @foliage/leaf, where the merge rule lives; the prose belongs here,
 * because it is addressed to whoever ran the command and a pure domain function has no business
 * holding a message. An unrecognised cause prints RAW rather than falling through to a generic
 * line — a mapping that silently swallows a cause it does not know is the same collapse this
 * file spends its whole header refusing.
 *
 * `not-re-derived` is the one this build can actually produce, and it is deliberately NOT
 * diagnosed further. The merge is pure and cannot look at the repository, and intake does not
 * yet go back and probe (`git cat-file -e <sha>`, re-read the author) to establish which of the
 * three real causes it is. So the sentence names all three and hands over the command that
 * settles it, rather than picking one — an inferred cause on a person's own portfolio is the
 * attribution guess this product refuses everywhere else.
 *
 * The command is named only when git said `repoRoot` holds the commit (`checked`); when git gave
 * no answer, nobody knows that it can show it, so the sentence stops before the command.
 *
 * @param {string} cause
 * @param {string} ref
 * @param {string} repoRoot
 * @param {boolean} [checked]
 * @returns {string}
 */
function describeDropCause(cause, ref, repoRoot, checked = true) {
  switch (cause) {
    case "not-re-derived":
      return (
        `this run produced no leaflet for it. That is the observation, not a diagnosis: the ` +
        `history may have been rewritten, the commit may no longer be reachable, or the ` +
        `declared identities may have changed.` +
        (checked ? ` Settle it: git -C ${repoRoot} show --no-patch ${ref}` : "")
      );
    // Not a merge cause: the report's own name for a not-re-derived leaflet whose commit git said
    // the repository read does not hold (`commitsHeld`). No command is named, since this repository
    // cannot show it and nothing here knows which one can.
    case "not-in-repository":
      return (
        `this run produced no leaflet for it, and its commit is not in ${repoRoot}: it may come ` +
        `from another repository grown into this garden, or be gone from this one's history. ` +
        `Look for it in the repository it came from.`
      );
    case "commit-unreachable":
      return `its commit is no longer reachable in ${repoRoot}`;
    case "identity-not-declared":
      return `its commit is still there and its author is not among this run's --identity values`;
    case "history-rewritten":
      return `its commit was replaced under a new object name — the history was rewritten`;
    default:
      return `cause "${cause}", which this version of intake has no sentence for [${ref}]`;
  }
}

/**
 * Say what happened to the file that was already there, in the same breath as the counts.
 *
 * THE POINT IS THAT A DESTRUCTIVE OUTCOME CANNOT BE SILENT. The bug this replaces exited 0
 * having deleted two human approvals and printed nothing about the existing document at all —
 * not its path, not that one had been read, not what became of its contents. Every branch here
 * writes a line, including the boring ones, because "no line at all" is the one outcome a
 * reader has no way to interpret.
 *
 * @param {{ write(text: string): unknown }} out
 * @param {string} path
 * @param {Extract<import("@foliage/leaf").LeafMerge, { ok: true }> | null} merge
 * @param {boolean} dropUnderived
 * @param {string} repoRoot
 * @param {ReadonlySet<string> | null} held the would-drop refs `repoRoot` holds as commits
 *   (`commitsHeld`), or null when git did not answer, which claims nothing either way
 */
function reportMerge(out, path, merge, dropUnderived, repoRoot, held) {
  if (merge === null) {
    out.write(`intake: no document existed at ${path} — a fresh write, nothing to merge.\n`);
    return;
  }

  out.write(
    `intake: merged into the existing ${path}\n` +
      `intake:   carried forward ${merge.carriedForward.length}  ` +
      `would-drop ${merge.wouldDrop.length}  ` +
      `kept ${merge.kept.length}  updated ${merge.updated.length}  added ${merge.added.length}\n`,
  );

  // "updated 3" alone reads like the refresh rewrote the portfolio. A re-read that moved only
  // `provenance.observedAt` is counted as kept, not here (merge.ts), so every row in this list
  // really changed, and the fields that moved are named and counted so the reader can see what.
  if (merge.updated.length > 0) {
    const byFields = new Map();
    for (const row of merge.updated) {
      const key = row.changed.join(", ");
      byFields.set(key, (byFields.get(key) ?? 0) + 1);
    }
    for (const [fields, n] of byFields) {
      out.write(`intake:   ${n} updated in place, changing: ${fields}\n`);
    }
  }

  // Named, not tallied: someone who clicked Approve wants to see the row they approved come
  // back out, and "2 carried forward" alone is exactly the reassurance the old code could have
  // printed while deleting them.
  if (merge.carriedForward.length > 0) {
    const bySource = new Map();
    for (const row of merge.carriedForward) {
      const key = row.source ?? "(no provenance)";
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    const sources = [...bySource].map(([source, n]) => `${n} ${source}`).join(", ");
    out.write(
      `intake:   ${merge.carriedForward.length} leaflet(s) intake does not own were carried ` +
        `through UNMODIFIED (${sources}):\n`,
    );
    for (const row of merge.carriedForward) {
      out.write(`intake:     ${row.id}  [${row.source ?? "no provenance"}, ${row.reason}]\n`);
    }
  } else {
    out.write(
      `intake:   nothing was carried forward — every leaflet in that document came from git.\n`,
    );
  }

  // Grouped by cause, and EVERY id is printed. Truncating this list is the one economy not
  // available here: it is the list of rows that a `--drop-underived` on the next run would
  // delete, so a reader who cannot see all of them cannot consent to any of them. The
  // explanation is written once per cause rather than once per row, which is what keeps 73
  // entries readable without dropping one.
  // A not-re-derived row whose commit this repository does not hold is said apart, with no
  // command that would read it here: it may be another repository's, grown into the same garden.
  // When git gave no answer, nobody checked: every row keeps the merge's own cause, and its sentence
  // names no command, since nothing says this repository can run it.
  const byCause = new Map();
  for (const row of merge.wouldDrop) {
    const cause = row.cause === "not-re-derived" && held !== null && !held.has(row.ref) ? "not-in-repository" : row.cause;
    const rows = byCause.get(cause);
    if (rows === undefined) byCause.set(cause, [row]);
    else rows.push(row);
  }
  for (const [cause, rows] of byCause) {
    const outcome = rows[0].outcome === "discard" ? "DROPPED" : "KEPT, not re-derived";
    out.write(
      `intake:   ${rows.length} git-sourced leaflet(s) — ${outcome} — ${cause}:\n` +
        `intake:     ${describeDropCause(cause, rows[0].ref, repoRoot, held !== null)}\n`,
    );
    for (const row of rows) out.write(`intake:       ${row.id}\n`);
  }
  if (merge.wouldDrop.length > 0 && !dropUnderived) {
    out.write(
      `intake:   the ${merge.wouldDrop.length} above stayed in your document because ` +
        `--drop-underived was not\n` +
        `intake:   passed. Pass it only once you have read the causes and agree with them.\n`,
    );
    // "would-drop" counts another repository's work too, when this garden grew from two.
    const elsewhere = byCause.get("not-in-repository")?.length ?? 0;
    if (elsewhere > 0) {
      out.write(
        `intake:   --drop-underived would also remove the ${elsewhere} whose commit is not in ` +
          `${repoRoot}, even if it is another repository's work.\n`,
      );
    }
  }

  // The one line that is a warning rather than a report. Removal only ever happens because
  // somebody asked for it in this exact run, and it still says so out loud.
  const discarded = merge.wouldDrop.filter((row) => row.outcome === "discard").length;
  if (discarded > 0) {
    out.write(
      `intake:   ${discarded} leaflet(s) were REMOVED from your document at your explicit ` +
        `request (--drop-underived).\n`,
    );
  }
}


/**
 * Say when this read attributed NOTHING — every commit it saw belongs, by the domain's own
 * rule, to somebody else. `harvest.mjs`'s `propose` already prints this diagnosis when its own
 * partition matches none of the declared identities; ported here in the same shape rather than
 * left as a bare "verified 0 pending 0" a reader has to reverse-engineer into "my --identity is
 * probably wrong" on their own, with no hint that a census command exists to check it.
 *
 * Judged against THIS RUN'S OWN leaflets (`intake.leaflets`, the freshly produced set) and never
 * against the merged, on-disk ledger: a `--force` re-run over a leaf that already holds
 * attributed work from another source would otherwise show `ledger.verified > 0` and hide that
 * THIS read's identity matched nothing.
 *
 * @param {{ write(text: string): unknown }} out
 * @param {Extract<import("./src/gitIntake.ts").GitIntakeResult, { ok: true }>} read
 * @param {Extract<import("@foliage/leaf").CommitIntake, { ok: true }>} intake
 * @param {{ repo: string, identities: readonly string[] }} args
 */
function reportZeroAttribution(out, read, intake, args) {
  if (read.commits.length === 0) return; // the "no commits yet" sentence above already covers this.
  const attributed = intake.leaflets.filter((l) => l.tier !== "excluded").length;
  if (attributed > 0) return;
  out.write(
    `intake: 0 of the ${read.commits.length} commit(s) in ${read.repoRoot} are attributed to ` +
      `${args.identities.join(", ")} — every one is excluded. This is NOT because the history is ` +
      `thin; the declared identity most likely is not the address this repository's commits ` +
      `carry. Check it with \`git -C ${args.repo} log --no-merges --format=%ae | sort -u\`, then ` +
      `re-run with the --identity that history actually carries.\n`,
  );
}
async function main() {
  const args = readArguments();

  // 1. READ. Real git, real history — or a named cause and no file written.
  const read = await readCommits(args.repo);
  if (!read.ok) {
    fail(`${read.cause} — ${read.detail}`);
    return;
  }
  // A PARTIAL READ SAYS SO. One unreadable ref narrows the walk to HEAD rather than refusing the
  // whole repository; narrowing without saying so would tell a person they have less work than
  // they have. Guarded by a spawned test — the print is the mechanism.
  if (read.narrowedBecause !== null) process.stdout.write(narrowingNotice("intake", read.narrowedBecause));
  // A new document can describe an explicitly partial read. A refresh cannot replace the
  // existing observation with it: grow would next prune the unseen branches from its queue.
  if (args.force && read.narrowedBecause !== null) {
    fail(`incomplete history — refusing --force; ${args.out} was NOT changed. ` +
      `Repair the local branch ref and retry. Git said: ${read.narrowedBecause}`);
  }

  // 2. JUDGE. The tiering rule lives in the open domain package, not here.
  const observedAt = new Date().toISOString();
  const intake = commitsToLeaflets({
    commits: read.commits,
    identities: args.identities,
    observedAt,
  });
  if (!intake.ok) {
    for (const issue of intake.issues) {
      process.stderr.write(`intake: ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  const derived = { id: args.id, subject: args.subject, leaflets: intake.leaflets };

  // 3. SELF-CHECK the derived half. Prove it is a document this product can actually load
  // before it goes anywhere — including into the merge, whose `derived` side is a parsed
  // `Leaf`. If this ever fires it is a bug in intake, not in the operator's input.
  const derivedValidated = parseLeafDocument(JSON.parse(JSON.stringify(derived)));
  if (!derivedValidated.ok) {
    process.stderr.write(
      `intake: BUG — the document just produced is not one this product can load. ` +
        `Nothing was written.\n`,
    );
    for (const issue of derivedValidated.issues) {
      process.stderr.write(`intake:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  return withDocumentLocks([args.out], async () => {
  // 4. MERGE, under --force only. Read the document that is already there and reconcile
  // against it, because intake did not write all of it: promote.ts appends leaflets a HUMAN
  // approved, and the old `flag: "w"` overwrote them without a word. Ownership is declared,
  // never inferred — intake owns the git-sourced leaflets it re-derived this run and nothing
  // else. `loadLeafDocument` is reused rather than a second reader written here: it already
  // returns the five causes as a discriminated union with messages a person can act on, and a
  // second implementation would drift from the one the server uses to read the same file.
  /** @type {Extract<import("@foliage/leaf").LeafMerge, { ok: true }> | null} */
  let merge = null;
  /** @type {import("@foliage/leaf").Leaf | undefined} */
  let existingLeaf;
  let existedBefore = false;
  if (args.force) {
    const load = await loadLeafDocument({ [DOCUMENT_ENV]: args.out });
    if (load.ok && (load.source.declaredExample || load.source.bundledExample)) {
      // The fake-data gate, ahead of the merge rule: merging real evidence into the EXAMPLE
      // document would put invented leaflets in a document that claims to be real (or real
      // work under a fabrication band). Refused outright rather than carried as a flag.
      process.stderr.write(
        `intake: ${args.out} is the EXAMPLE document (${load.source.declaredExample ? 'it declares "example": true' : "it is this app's bundled example"}), ` +
          `so --force was REFUSED and nothing was written. Its leaflets are a fabricated ` +
          `illustration; merging real evidence into it would mix the two. Write your own ` +
          `leaf with --out <path>.\n`,
      );
      process.exit(EXIT_FAILED);
    }
    // Intake refreshes its records. The person's own document settings, including their
    // headline and chosen highlights, survive even when a selected record is no longer found.
    if (load.ok) existingLeaf = load.leaf;

    const merged = mergeIntakeIntoLeaf({
      // BOTH causes travel. `loadLeafDocument` distinguishes five states of a file and
      // `ExistingLeaf` distinguishes four, so the loader's cause is kept alongside the merge's
      // refusal rather than being thrown away in the narrowing — "malformed" (not JSON at all)
      // and "invalid" (JSON that is not a leaf) both land in `unparseable`, and a person
      // staring at their file needs to know which one they have.
      existing: existingLeafFrom(load),
      derived: derivedValidated.leaf.leaflets,
      incomingId: leafId(args.id),
      incomingSubject: args.subject,
      // A named two-state, not a boolean, and `retain` is the default in both directions:
      // "this run did not see that commit" is not the same fact as "that work never happened".
      unDerived: args.dropUnderived ? "discard" : "retain",
    });

    if (!merged.ok) {
      // NOTHING is written. Overwriting a document we could not use is how "your file has a
      // typo on line 12" turns into "your file is gone" — and the leaflets at risk are exactly
      // the ones a human approved.
      process.stderr.write(
        `intake: ${args.out} exists and this run refused to write over it, so NOTHING was ` +
          `written — your file is untouched.\n`,
      );
      if (!load.ok) {
        process.stderr.write(`intake:   the loader read it as: ${load.cause} — ${load.detail}\n`);
      }
      for (const refusal of merged.refusals) {
        process.stderr.write(`intake:   ${refusal.cause}: ${refusal.message}\n`);
        if (refusal.cause === "existing-unparseable") {
          for (const issue of refusal.issues) {
            process.stderr.write(`intake:     ${issue.at}: ${issue.message}\n`);
          }
        }
      }
      process.stderr.write(
        `intake: fix the document, or pass --out <path> to write elsewhere. --force merges ` +
          `into a document; it does not replace one.\n`,
      );
      process.exit(EXIT_FAILED);
    }

    // `absent` is the ordinary first run: it merges to exactly the derived leaflets. It still
    // goes through the merge rather than round a special case, so there is ONE path that
    // produces the bytes and one place a mistake in it could hide.
    merge = merged;
    existedBefore = load.ok;
  }

  // The `example` flag survives the merge deliberately, and in the SAFE direction: dropping it
  // would strip the non-dismissible fabrication band off a document that declares itself an
  // illustration, republishing invented content as somebody's real evidence.
  const document =
    merge === null
      ? derived
      : {
          ...existingLeaf,
          id: args.id,
          subject: args.subject,
          leaflets: merge.leaf.leaflets,
        };

  // 4b. SELF-CHECK AGAIN, on the bytes that actually reach the disk. Step 3 validated the
  // derived half; the merge produced something neither half was, and the merged document is
  // what has to load.
  const validated =
    merge === null ? derivedValidated : parseLeafDocument(JSON.parse(JSON.stringify(document)));
  if (!validated.ok) {
    process.stderr.write(
      `intake: BUG — the MERGED document is not one this product can load. Nothing was ` +
        `written and ${args.out} is untouched.\n`,
    );
    for (const issue of validated.issues) {
      process.stderr.write(`intake:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  // 4c. Publish complete bytes under the document lock: exclusive create or atomic replace.
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  try {
    writeDocument(args.out, serialized, args.force);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "EEXIST") {
      fail(
        `${args.out} already exists and was NOT overwritten. Re-run with --force to merge into ` +
          `it, or pass --out <path> to write elsewhere.`,
      );
      return;
    }
    fail(`could not write ${args.out}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 5. REPORT, honestly and without flattering the result.
  const ledger = attributionLedger(validated.leaf);
  const out = process.stdout;
  out.write(`intake: read ${read.commits.length} non-merge commit(s) from ${read.repoRoot}\n`);
  if (read.head === null) {
    out.write(`intake: this repository has no commits yet — an honest empty portfolio.\n`);
  }
  out.write(`intake: wrote ${args.out}\n`);
  if (args.force) {
    const held = existedBefore && merge !== null ? await commitsHeld(read.repoRoot, merge.wouldDrop.map((row) => row.ref)) : new Set();
    reportMerge(out, args.out, existedBefore ? merge : null, args.dropUnderived, read.repoRoot, held);
  }
  out.write(
    `intake: verified ${ledger.verified}  pending ${ledger.pending}  excluded ${ledger.excluded}\n`,
  );
  reportZeroAttribution(out, read, intake, args);
  reportSignatures(out, intake, read.signatureCapability, read.repoRoot);
  // Only when it is TRUE. With even one unchecked or rejected signature in the history, "0
  // verified is correct for unsigned history" is a confident claim about commits this machine
  // never read — the exact overclaim reportSignatures exists to prevent.
  if (
    ledger.verified === 0 &&
    ledger.pending > 0 &&
    intake.uncheckedSignatures.length === 0 &&
    intake.unboundSignatures.length === 0 &&
    intake.undeclaredSignatures.length === 0 &&
    intake.rejectedSignatures.length === 0
  ) {
    out.write(
      `intake: 0 verified is the correct result for unsigned history — only a good git\n` +
        `intake: signature establishes authorship. Everything attributable is "pending".\n`,
    );
  }
  if (intake.unrecognizedSignatures.length > 0) {
    out.write(
      `intake: git reported signature code(s) this version does not recognise ` +
        `(${intake.unrecognizedSignatures.join(", ")}); they were treated as pending.\n`,
    );
  }
  out.write(`intake: serve it with  ${foliageNextStep("up", args.out) ?? `FOLIAGE_LEAF=${args.out} node apps/leaf/server.mjs`}\n`);
  }).catch((error) => {
    // A lock this run could not take — a read-only garden, another grow mid-write — is one
    // line and nothing written, never a stack. Anything else is rethrown untouched.
    const refusal = lockRefusal(error);
    if (refusal === null) throw error;
    fail(refusal);
  });

}

// A held document lock is a refusal with its remedy, in one line — never a stack trace.
await main().catch((err) => {
  if (err !== null && typeof err === "object" && "code" in err && err.code === "ELOCALBUSY") fail(String(err.message));
  throw err;
});
