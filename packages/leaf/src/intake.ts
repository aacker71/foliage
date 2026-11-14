/**
 * EVIDENCE INTAKE — the domain half. What counts as attributable evidence, and nothing else.
 *
 * WHY THIS IS IN @foliage/leaf AND THE GIT CALL IS NOT. The rule "an author email is
 * self-declared, so matching one does not establish authorship" is a claim this product makes
 * about proof. It has to be readable by the person whose portfolio is being judged by it, and
 * it has to be the SAME rule wherever evidence enters. Running `git log` is, by contrast, an
 * I/O detail of one app. So the split mirrors document.ts / leafDocument.ts exactly: the
 * judgement is domain and open, the subprocess is app.
 *
 * This function is TOTAL and PURE — no fs, no child_process, no clock, no throw. It takes
 * observations and returns either leaflets or every reason it could not. Purity here is not
 * decoration: it is what lets the tiering rule be tested without a repository, and what keeps
 * `@foliage/leaf` free of Node built-ins so the open set stays trivially portable.
 *
 * THE TIERING RULE, and why it is drawn where it is:
 *
 *   verified   a declared identity authored it AND git accepted a signature AND the SIGNER git
 *              bound that signature to is one of those declared identities. A signature is the
 *              only thing in git that actually establishes who wrote a commit. Everything else
 *              is self-declared: `git config user.email` is a string anyone can set to anyone,
 *              so treating a matching address as proof would be precisely the overclaim this
 *              codebase exists to refuse.
 *
 *              THE THIRD CLAUSE IS NOT DECORATION, and its absence was a false `verified` on the
 *              one tier this product hangs on. Attribution ran off `%ae` while the tier was
 *              decided by `%G?` alone, and nothing ever compared the two: in the ordinary team
 *              setup — one `allowed_signers` file holding several colleagues' keys — ANY listed
 *              key could author a commit as the subject and the page would say "authorship
 *              cryptographically established". MEASURED with git 2.54.0: an allowed_signers line
 *              binding the signing key to `someone@else.example`, on a commit authored
 *              `subject@example.com`, yields `%G?` of `G` and `%GS` of `someone@else.example` —
 *              git had named the real signer all along, and this module was not reading it.
 *   pending    identity matches, but authorship is not cryptographically established. This is
 *              the honest tier for ordinary unsigned work — it is probably yours, and nothing
 *              here proves it. It STILL carries provenance, because the commit is a real
 *              observed artifact and discarding the sha would throw away a true fact. It is
 *              ALSO the tier for a signature this machine did not check, for one whose key is
 *              tied to no identity, and for one somebody else made: pending is a statement about
 *              what was PROVEN, and none of those proved anything about this subject.
 *              `SignatureFinding` is what tells them apart.
 *   excluded   the author identity is not one the subject declared. NOT an error, and not an
 *              absence: it means "this could not be attributed to you", it carries a required
 *              reason, and it is counted.
 *
 * WHY A COMMIT CARRIES TWO SIGNATURE OBSERVATIONS AND NOT ONE — the trap this module fell into.
 * `%G?` is a VERDICT, and it is lossy in exactly the direction that matters: when git cannot run
 * the checker it prints `N` on stdout — the SAME code it prints for a commit that was never
 * signed — and sends the real cause to stderr, which a caller reading stdout on a zero exit
 * never sees. MEASURED rather than reasoned about, over a repository on the measuring machine:
 * `git log --no-merges --format=%G?` reports `N` for all 1930 commits, while
 * `git log --no-merges --pretty=raw | grep -c '^gpgsig'` finds 298 that ARE signed (295 SSH,
 * 3 PGP) — every one of them masked, because gpg is not installed and gpg.ssh.allowedSignersFile
 * is not configured. Reading only `%G?`, this module would have stated "0 verified across
 * unsigned history" about 298 signatures it never looked at. That is precisely the bug class
 * this repository exists to refuse — distinct causes collapsed into one zero — landing on the
 * single field that decides the `verified` tier.
 *
 * So `ObservedCommit` carries the verdict AND the artifact AND the signer: `signatureArmor` says
 * what the raw commit object actually holds, and `signer` says whom git bound the signature to.
 * The first two are a DIFFERENTIAL CONTROL, and the contradiction they can express — a signature
 * in the object, `N` in the verdict — is NAMED (`unchecked`) rather than inferred away. The
 * third is what makes an accepted signature say anything about THIS SUBJECT rather than about
 * some key: without it the tier rested on `%G?` while attribution rested on `%ae`, and the two
 * were never introduced. No stderr text is matched anywhere: `-----BEGIN SSH SIGNATURE-----`
 * is a wire format, not a message, so it does not move with git's version or the operator's
 * locale.
 *
 * WHERE `unchecked` LANDS, and why it is not a fourth tier. The tier set is load-bearing and
 * FCRA-scoped; adding to it would change what this product claims about people. An unchecked
 * signature is `pending`, and "attributable, but not proven" remains exactly true of it. What
 * was false is the IMPLICATION that rode alongside — that `pending` meant UNSIGNED. So the
 * distinction travels BESIDE the tier, in `uncheckedSignatures`, where a caller has to handle
 * it to describe its own result honestly. It is called `unchecked` and not "unverifiable"
 * deliberately: installing gpg or configuring an allowed-signers file makes these commits
 * checkable, so the weaker claim is the true one.
 *
 * On this repository today, run against the identity that actually authored it, that yields
 * 0 verified and 33 pending — and ONE of those 33 is a PGP-signed commit this machine has no
 * gpg to check. "0 verified" is unsigned for 32 of them and UNCHECKED for the other, and
 * reporting the two as one number was the lie.
 *
 * Complexity: O(n) over commits, one pass, plus an O(k) Set of normalized identities and an
 * O(n) Set for duplicate detection.
 */

import { isIsoInstant } from "./document.ts";
import { leafletId, type Leaflet, type Provenance } from "./leaf.ts";

/**
 * The mechanism that produced this evidence, as it appears in `Provenance.source`.
 *
 * A constant rather than a caller-supplied string: this function reads commits and only
 * commits, so letting a caller label the output "upload" would let it mislabel real evidence.
 */
export const GIT_SOURCE = "git";

/**
 * Which signature the RAW COMMIT OBJECT carries, read from the object rather than from git's
 * opinion of it.
 *
 * `none` — the object has no `gpgsig` header — is the ONLY state from which "this commit is
 * unsigned" may honestly be concluded. The three signed states are told apart by the armor
 * header the signature block opens with, because the remedy differs: PGP needs a gpg binary,
 * SSH needs an allowed-signers file, and an operator told only "could not check" cannot act.
 */
export type SignatureArmor = "none" | "pgp" | "ssh" | "other";

/**
 * One commit as GIT ACTUALLY REPORTED IT. Every field is a raw observation, not a conclusion —
 * the conclusion is this module's job.
 *
 * Deliberately narrow. The author's NAME and DATE are not here because nothing below needs
 * them, and an excluded commit belongs to somebody else: carrying a third party's personal
 * details into a document that gets rendered on a public page is an egress risk taken for no
 * benefit. The ref resolves to the full commit for anyone entitled to read the repository.
 */
export interface ObservedCommit {
  /** Full object name as `%H` gives it — 40 hex for SHA-1 repos, 64 for SHA-256. */
  readonly sha: string;
  /** `%ae`. Self-declared, which is exactly why it cannot by itself mean "verified". */
  readonly authorEmail: string;
  /** `%s`, the subject line. May legitimately be empty: `git commit --allow-empty-message`. */
  readonly subject: string;
  /**
   * Raw `%G?` code — one of G B U X Y R E N, or something a future git adds. A VERDICT, and on
   * its own an untrustworthy one: git degrades "I could not run the checker" into `N`, the code
   * for "there is no signature".
   */
  readonly signature: string;
  /**
   * Raw `%GS` — WHO git says made the signature, and the only field here that is not
   * self-declared.
   *
   * Free text by format: a PGP user id (`Real Name <a@b.example>`), or, for SSH, the principal
   * string from `gpg.ssh.allowedSignersFile`. MEASURED with git 2.54.0, all three shapes are
   * real: a bare address, a quoted uid, and a principal that is not an address at all (`alice`)
   * — the last of which binds to nothing this module can compare, and says so.
   *
   * EMPTY is a state, not a gap: git leaves it empty when it accepted nothing or bound nothing,
   * which is exactly what an ssh `U` looks like. Empty can therefore never verify.
   */
  readonly signer: string;
  /**
   * Which signature the raw commit object holds. The ARTIFACT, and the control on the verdict
   * above — it is the only thing that separates a genuinely unsigned commit from one whose
   * signature this machine never checked.
   */
  readonly signatureArmor: SignatureArmor;
}

/**
 * What this pair of observations, read against the declared identities, establishes about one
 * commit's signature.
 *
 * No ordering between these — it is a statement of fact about a signature, never a rating of a
 * commit:
 *
 *   verified      git checked the signature, accepted it, and named a signer this module could
 *                 bind to one of the DECLARED identities: `G`, or `U` on a PGP signature, where
 *                 unknown trust is a web-of-trust opinion and the cryptography held.
 *   unsigned      the object carries no signature and git agrees. The ordinary case.
 *   unbound       git accepted the signature and this module could bind it to NOBODY: `%GS` is
 *                 empty, or it names something with no address in it (`alice` is a legal
 *                 allowed_signers principal). MEASURED with git 2.54.0 — with
 *                 `gpg.ssh.allowedSignersFile` pointing at a file that does not list the key (or
 *                 does not exist at all), `%G?` is `U` and `%GS` is EMPTY, while a properly
 *                 listed key gives `G` and a real signer. So that `U` proves SOME key signed the
 *                 commit, never that the subject did — and promoting it would be the overclaim
 *                 this module exists to refuse, reachable by a typo in one config path. Note it
 *                 needs no special case for the ssh `U`: an empty signer binds to nobody, and
 *                 that is the whole of the rule.
 *   undeclared    git checked the signature, accepted it, and the signer it named is NOT among
 *                 the declared identities. A REAL signature, by somebody else — a different fact
 *                 from every other entry here, and the one that used to read as `verified`
 *                 because the tier was decided by `%G?` while attribution ran off `%ae`. It says
 *                 nothing against the commit: a colleague may legitimately have signed it. It
 *                 says only that this is not proof the SUBJECT wrote it.
 *   unchecked     the object CARRIES a signature that this machine did not check — either git
 *                 said so (`E`), or git said `N` about an object that demonstrably holds a
 *                 signature, which is the masking this module's header records. Never folded
 *                 into `unsigned`: "nothing was signed" and "nobody looked" are different
 *                 facts, and only one of them is about the commit.
 *   rejected      git DID check and did not accept: bad (`B`), or good but expired or revoked
 *                 (`X`, `Y`, `R`). Not verified, and not unsigned either.
 *   unrecognized  a code this version does not know. Deliberately NOT reported as `unchecked`:
 *                 an unknown verdict might well be a check that happened, and claiming
 *                 otherwise would be an overclaim in the opposite direction.
 */
export type SignatureFinding =
  | "verified"
  | "unsigned"
  | "unbound"
  | "undeclared"
  | "unchecked"
  | "rejected"
  | "unrecognized";

/**
 * One commit whose signature did not simply verify, with the evidence for saying so.
 *
 * The finding itself is not a field: these values are only ever handed out through a list that
 * names the finding (`uncheckedSignatures`, `unboundSignatures`, `undeclaredSignatures`,
 * `rejectedSignatures`), so carrying it here would be a second copy able to disagree with the
 * first.
 *
 * THE SIGNER IS NOT A FIELD EITHER, and that is deliberate. On an `undeclared` entry it is
 * somebody else's address, and `exclusionReason` already withholds a third party's address for
 * the same reason. `git verify-commit <ref>` prints it to whoever is entitled to read the
 * repository, which is the person running intake and nobody further.
 */
export interface SignatureObservation {
  /** Full object name. `git verify-commit <ref>` reproduces this finding by hand. */
  readonly ref: string;
  /**
   * What the OBJECT carries, reported as observed rather than as expected.
   *
   * It is usually one of the signed values, and `none` beside a verdict that presupposes a
   * signature is a CONTRADICTION between the two reads — carried here, not resolved away, in
   * keeping with the rest of this module. It is reachable: `E` or `B` about an object whose
   * `gpgsig` header the reader did not recognise (a future hash suffix, say) lands exactly
   * there. A previous version of this comment claimed `none` never appears, which was a promise
   * the code did not keep — `B` on a bare object has always produced one — and a caller reading
   * that promise would describe the wrong armor to an operator.
   */
  readonly armor: SignatureArmor;
  /** The `%G?` code git returned. An `N` here IS the mask: "unsigned" said of a signed object. */
  readonly code: string;
  /**
   * Whether the commit's AUTHOR field is one of the declared identities — self-declared, and
   * therefore about which tier the commit landed in, never about who signed it. On an
   * `undeclared` entry both facts are present at once: attributable by author, signed by
   * somebody else.
   */
  readonly attributable: boolean;
}

/** One reason intake could not proceed, addressed to whoever ran it. */
export interface IntakeIssue {
  /** Where the problem is: `identities`, `observedAt`, `commits[3].sha`. */
  readonly at: string;
  readonly message: string;
}

export interface CommitIntakeRequest {
  readonly commits: readonly ObservedCommit[];
  /**
   * Every email address the subject claims as theirs. Plural because a real person has a work
   * address, a personal one, and a GitHub noreply — and treating the other two as somebody
   * else's work would be a false exclusion about their own portfolio.
   */
  readonly identities: readonly string[];
  /** When the repository was read, as an ISO-8601 instant with an offset. */
  readonly observedAt: string;
}

export type CommitIntake =
  | {
      readonly ok: true;
      readonly leaflets: readonly Leaflet[];
      /**
       * `%G?` codes this version did not recognise, sorted and deduplicated.
       *
       * They are mapped to `pending`, which is the safe direction — an unknown code has
       * certainly not established authorship. But the fallback is REPORTED rather than
       * silent: a caller that never hears "git said something I do not understand" cannot
       * tell a genuinely unsigned repository from one this code has gone stale against.
       * Empty on every normal run.
       */
      readonly unrecognizedSignatures: readonly string[];
      /**
       * Commits carrying a signature THIS MACHINE DID NOT CHECK.
       *
       * They are tiered `pending`, which is true, and they are reported HERE, which is what
       * stops "pending" from being read as "unsigned". A caller that prints a tier ledger and
       * ignores this list will state "0 verified is correct for unsigned history" about
       * signatures nobody looked at — the sentence this product actually printed before the
       * masking was found. Both causes travel with each entry: the armor proves the signature
       * exists, the `%G?` code proves what git claimed about it.
       *
       * Every observed commit is covered, attributable or not, because this is a fact about the
       * repository and this machine rather than about the subject — `attributable` on each entry
       * says which is which.
       */
      readonly uncheckedSignatures: readonly SignatureObservation[];
      /**
       * Commits whose signature git accepted while naming no signer this module could bind to
       * an identity — an empty `%GS` (SSH's `U`), or a principal with no address in it.
       *
       * Reported apart from `uncheckedSignatures` because the fact and the remedy both differ:
       * the check happened and the cryptography held, and what is missing is a line in
       * `gpg.ssh.allowedSignersFile` naming the signer. They are `pending`: "signed by some
       * key" is not "signed by this subject", and the author email that would bridge the two is
       * self-declared.
       */
      readonly unboundSignatures: readonly SignatureObservation[];
      /**
       * Commits carrying a signature git ACCEPTED, made by a signer who is not one of the
       * declared identities.
       *
       * This is the list that exists because its absence was a false `verified`. It is its own
       * fact and its own list: `unbound` means nobody was named, `undeclared` means somebody
       * was and it was not the subject — a real signature by a real other person, which an
       * ordinary shared `allowed_signers` file makes an ordinary occurrence.
       *
       * They are NOT `excluded` on this account. A commit whose author field is a declared
       * identity is attributable and stays `pending`; whether the subject wrote it is simply
       * not established, and `excluded` would assert the different, stronger claim that the
       * work is somebody else's. `attributable` on each entry says which population it is in.
       */
      readonly undeclaredSignatures: readonly SignatureObservation[];
      /**
       * Commits whose signature git DID check and did not accept — bad, expired, or revoked.
       *
       * Also `pending`, and also invisible in a tier count alone. A repository full of bad
       * signatures is not a repository of unsigned work, and reporting it as one would be the
       * same collapse in a quieter costume.
       */
      readonly rejectedSignatures: readonly SignatureObservation[];
    }
  | { readonly ok: false; readonly issues: readonly IntakeIssue[] };

/**
 * `%G?` codes meaning git ACCEPTED the signature. `U` is a good signature whose key carries
 * unknown trust in the local keyring — for PGP the cryptography held and only the web-of-trust
 * opinion is missing.
 *
 * NOT SUFFICIENT ON ITS OWN, and the name says only what it means: git accepting a signature
 * establishes that SOMEBODY signed, and `signatureFinding` still has to bind that somebody to a
 * declared identity before anything is verified. Read this set only through that function.
 */
const SIGNATURE_ACCEPTED_BY_GIT: ReadonlySet<string> = new Set(["G", "U"]);

/**
 * Every code git documents. `B` (bad), `X`/`Y`/`R` (expired or revoked key) and `E` (cannot
 * check) are all KNOWN and all map to pending: a signature that failed, lapsed, or could not
 * be checked has not established anything, and calling any of them verified would be the
 * overclaim. They are listed so an unfamiliar code is distinguishable from a failing one.
 */
const KNOWN_SIGNATURE_CODES: ReadonlySet<string> = new Set([
  "G",
  "B",
  "U",
  "X",
  "Y",
  "R",
  "E",
  "N",
]);

/**
 * The email address inside a `%GS` signer string, or null when there is none to read.
 *
 * `%GS` is free text with two real shapes, both MEASURED with git 2.54.0 rather than assumed: a
 * PGP user id or a quoted allowed_signers principal (`Real Name <subject@example.com>`), and a
 * bare principal (`subject@example.com`, or `alice`, which is equally legal and equally not an
 * address). So: take the TRAILING angle-bracketed field if the string ends in one — that is
 * where a uid's address sits, and a display name before it may contain brackets of its own —
 * otherwise the whole string, and then require what is left to actually look like an address. A
 * uid shaped some third way falls through to the shape check and binds to nobody, which is the
 * direction that cannot produce a false `verified`.
 *
 * NULL IS THE HONEST ANSWER, not a fallback: `alice` is a signer git bound, and this module
 * cannot say whether `alice` is the subject. Loosening the match — substring, local-part only,
 * name comparison — would be inventing the binding that this function exists to establish, so
 * "could not bind" is returned and the commit stays `pending`.
 *
 * O(length of the signer string).
 */
function signerAddress(signer: string): string | null {
  const bracketed = /<([^<>]*)>\s*$/.exec(signer.trim());
  const candidate = normalizeIdentity(bracketed?.[1] ?? signer);
  // Deliberately not an RFC 5322 parser: the question is only "is this an address at all", and
  // the comparison that follows is exact, so a permissive shape check cannot widen a match.
  return /^[^\s<>@]+@[^\s<>@]+$/.test(candidate) ? candidate : null;
}

/**
 * What one commit's signature establishes, from the VERDICT, the ARTIFACT and the SIGNER read
 * against the identities the subject declared.
 *
 * IT TAKES THE IDENTITIES BECAUSE THE QUESTION IS ABOUT THEM. "git accepted this signature" and
 * "this signature is the subject's" are different claims, and the gap between them was a false
 * `verified`: with several colleagues' keys in one `allowed_signers` file, any of them could
 * author a commit as the subject and git would answer `G`. The declared identities arrive as
 * written and are normalized here through the same `normalizeIdentity` used for author matching,
 * so a caller cannot pass a set that was folded some other way.
 *
 * Exported for the same reason `isIsoInstant` is: it is the rule itself, and a caller that wants
 * to describe a repository's signature state honestly needs the rule rather than a re-derivation
 * of it. Pure, total, and it never throws — an `ObservedCommit` whose armor is some value this
 * version does not know reads as "carries something", i.e. `unchecked`, which is the safe
 * direction: it can cost a caller a warning it did not need, never a false "unsigned".
 *
 * O(k) in declared identities, which is the two or three addresses one person has. No set is
 * allocated per commit; a linear scan over three strings is cheaper than building one.
 */
export function signatureFinding(
  commit: ObservedCommit,
  identities: readonly string[],
): SignatureFinding {
  const code = commit.signature;
  if (!KNOWN_SIGNATURE_CODES.has(code)) return "unrecognized";
  if (SIGNATURE_ACCEPTED_BY_GIT.has(code)) {
    // Git accepted SOMETHING. Everything below is about whose it was — and an ssh `U`, whose
    // signer git leaves empty, falls out here rather than needing a rule of its own.
    const signer = signerAddress(commit.signer);
    if (signer === null) return "unbound";
    return identities.some((declared) => normalizeIdentity(declared) === signer)
      ? "verified"
      : "undeclared";
  }
  // `E` is git ADMITTING it could not check. `N` is git claiming there is nothing to check —
  // true only if the object agrees, and the whole point of reading the object is that it often
  // does not.
  if (code === "E") return "unchecked";
  if (code === "N") return commit.signatureArmor === "none" ? "unsigned" : "unchecked";
  return "rejected";
}

/** A git object name: SHA-1 or SHA-256, lowercase hex, full length — never abbreviated. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How much of a sha goes into a human-facing reason. Git's own default abbreviation. */
const SHORT_SHA = 7;

/**
 * Case-folded, trimmed address.
 *
 * Mail domains are case-insensitive by definition and every mainstream provider folds the
 * local part too, while `git config user.email` drifts in case across machines. Matching
 * case-sensitively would therefore produce FALSE EXCLUSIONS — telling someone their own
 * commits are not theirs — which is the more damaging of the two errors here.
 */
function normalizeIdentity(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A title that is always non-empty and always true.
 *
 * `git commit --allow-empty-message` is legal, and a blank title would be rejected by
 * `parseLeafDocument` — intake would emit a document its own loader refuses. The placeholder
 * is a statement of fact about the artifact, not invented content; the ref still resolves to
 * the real commit.
 *
 * KNOWN LIMITATION, recorded rather than quietly tolerated. The subject line is copied
 * VERBATIM, and a commit message can itself contain an email address — measured, not
 * hypothesised: intake over a real 800-commit repository produced one excluded leaflet titled
 * `fix: use hi@‹their-domain› in English README` (a real address, redacted in THIS comment
 * precisely because this file is committed — quoting it verbatim here would be this repo
 * committing the very egress it is describing). For an EXCLUDED leaflet that is a third party's
 * commit message rendered on somebody else's public page, which is the same egress class as an
 * address in an exclusion reason (deliberately prevented in `exclusionReason` below).
 * Redacting it is a product decision — it means the page shows something other than what the
 * commit says — so it is surfaced here rather than decided unilaterally. Reasons are clean;
 * titles are not, and no claim in this module should be read as saying otherwise.
 */
function titleOf(subject: string): string {
  const trimmed = subject.trim();
  return trimmed.length > 0 ? trimmed : "(commit recorded with no message)";
}

/**
 * Why a commit could not be attributed — WITHOUT the author's address.
 *
 * The leaf page renders exclusion reasons publicly, so putting a third party's email in one
 * would publish somebody else's personal data on the subject's portfolio. The subject owns the
 * repository and can read it directly, so naming the commit loses them nothing.
 */
function exclusionReason(sha: string): string {
  const short = sha.slice(0, SHORT_SHA);
  return (
    `could not be attributed to this subject: the author identity on commit ${short} is not ` +
    `among the declared identities. The address itself is withheld because this page is ` +
    `public — run "git show ${short}" in the repository to see it.`
  );
}

/**
 * Turn observed commits into leaflets, or report every reason they cannot be.
 *
 * Fails as a whole rather than per-commit, for the same reason `parseLeafDocument` does:
 * dropping the commits it could not read and returning the rest would silently assert a
 * smaller history than the repository has, which is the undercount this project already paid
 * for once.
 */
export function commitsToLeaflets(request: CommitIntakeRequest): CommitIntake {
  const issues: IntakeIssue[] = [];

  if (!isIsoInstant(request.observedAt)) {
    issues.push({
      at: "observedAt",
      message:
        `"${request.observedAt}" is not an ISO-8601 instant with an offset (e.g. ` +
        `2026-08-15T09:41:00Z). A local-time stamp is an observation plus an unstated ` +
        `assumption about where it was made.`,
    });
  }

  const identities = new Set<string>();
  for (const [i, raw] of request.identities.entries()) {
    const normalized = normalizeIdentity(raw);
    if (normalized.length === 0) {
      issues.push({
        at: `identities[${i}]`,
        message: `a declared identity must be a non-empty email address.`,
      });
      continue;
    }
    identities.add(normalized);
  }
  // Checked on the INPUT length, not the normalized set: `["", ""]` already produced two
  // precise per-entry issues above, and adding a vaguer aggregate on top would bury them.
  if (request.identities.length === 0) {
    issues.push({
      at: "identities",
      message:
        `at least one identity is required. With none declared, every commit would be ` +
        `excluded and the entire history would be reported as somebody else's work — a ` +
        `confident, wrong answer rather than a refusal.`,
    });
  }

  const leaflets: Leaflet[] = [];
  const unrecognized = new Set<string>();
  const unchecked: SignatureObservation[] = [];
  const unbound: SignatureObservation[] = [];
  const undeclared: SignatureObservation[] = [];
  const rejected: SignatureObservation[] = [];
  const seen = new Set<string>();

  for (const [i, commit] of request.commits.entries()) {
    const sha = commit.sha.trim().toLowerCase();
    if (!OBJECT_NAME.test(sha)) {
      issues.push({
        at: `commits[${i}].sha`,
        message:
          `"${commit.sha}" is not a full git object name. A ref that cannot be resolved is ` +
          `indistinguishable from a fabricated one, so an abbreviated or malformed sha is ` +
          `refused rather than recorded as provenance.`,
      });
      continue;
    }
    if (seen.has(sha)) {
      issues.push({
        at: `commits[${i}].sha`,
        message: `duplicate commit ${sha.slice(0, SHORT_SHA)} — the same commit was observed twice.`,
      });
      continue;
    }
    seen.add(sha);

    // The identities go in as declared: the binding rule normalizes them itself, so there is one
    // definition of "the same address" for the signer and for the author alike.
    const finding = signatureFinding(commit, request.identities);
    if (finding === "unrecognized") unrecognized.add(commit.signature);

    const attributable = identities.has(normalizeIdentity(commit.authorEmail));
    // Recorded for EVERY commit that carries one of these findings, including work belonging to
    // somebody else: "this machine cannot check signatures" is a fact about the machine, and
    // hiding the ones on excluded commits would understate how much of the history went unread.
    const into =
      finding === "unchecked"
        ? unchecked
        : finding === "unbound"
          ? unbound
          : finding === "undeclared"
            ? undeclared
            : finding === "rejected"
              ? rejected
              : null;
    if (into !== null) {
      into.push(
        Object.freeze({
          ref: sha,
          armor: commit.signatureArmor,
          code: commit.signature,
          attributable,
        }),
      );
    }

    // Provenance is attached at EVERY tier. The commit is a real artifact whatever we
    // concluded about it, and the ref is what makes the conclusion checkable by hand.
    const provenance: Provenance = Object.freeze({
      source: GIT_SOURCE,
      ref: sha,
      observedAt: request.observedAt,
    });
    const base = { id: leafletId(`${GIT_SOURCE}:${sha}`), title: titleOf(commit.subject) };

    if (!attributable) {
      leaflets.push(
        Object.freeze({
          ...base,
          tier: "excluded" as const,
          reason: exclusionReason(sha),
          provenance,
        }),
      );
      continue;
    }

    leaflets.push(
      Object.freeze({
        ...base,
        // ONLY a signature git accepted AND bound to a declared identity verifies. Every other
        // finding — unsigned, unbound, undeclared, unchecked, rejected, unrecognized — is
        // pending, because none of them established who wrote the commit.
        tier: finding === "verified" ? ("verified" as const) : ("pending" as const),
        provenance,
      }),
    );
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  return {
    ok: true,
    leaflets: Object.freeze(leaflets),
    unrecognizedSignatures: Object.freeze([...unrecognized].sort()),
    uncheckedSignatures: Object.freeze(unchecked),
    unboundSignatures: Object.freeze(unbound),
    undeclaredSignatures: Object.freeze(undeclared),
    rejectedSignatures: Object.freeze(rejected),
  };
}

// mergeIntakeIntoLeaflets (the earlier, pre-fork merge rule) lived here until it was removed as
// dead code: `mergeIntakeIntoLeaf` in ./merge.ts is the implementation apps/leaf/intake.mjs
// actually calls, and it supersedes this one — same problem (a re-read of git must not delete a
// promoted leaflet), a fuller answer (a `MergeRefusal` union instead of a silent id-collision
// drop, `carriedForward`/`wouldDrop` instead of `retained`/`displaced`). Removed 2026-08-29 as
// the corpse motivating the duplication/dead-export gate in `pnpm check`: grep confirmed zero
// callers of `mergeIntakeIntoLeaflets` outside its own test file, which the same change deleted.
