/**
 * Tests for the intake TRANSFORM — the tiering rule, isolated from any repository.
 *
 * These prove the judgement, not the product. Real commits from a real repository are exercised
 * in `apps/leaf/src/gitIntake.test.ts` (which builds an actual git repo) and at the seam. What
 * belongs HERE is every case that is awkward or impossible to arrange in real history: an
 * unknown signature code, an empty commit message, a malformed sha.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  attributionLedger,
  leafId,
  parseLeafDocument,
  type Leaf,
} from "./index.ts";
import { commitsToLeaflets, signatureFinding, type ObservedCommit } from "./intake.ts";

const AT = "2026-08-15T12:00:00Z";
const ME = "me@example.com";

/** A full-length SHA-1 object name built from a seed, so tests use well-formed shas. */
function sha(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

function commit(over: Partial<ObservedCommit> = {}): ObservedCommit {
  return {
    sha: sha("a"),
    authorEmail: ME,
    subject: "a real commit subject",
    signature: "N",
    signatureArmor: "none",
    // Empty is what git writes for `%GS` when it bound no signer, which is the default state of
    // an unsigned commit. A commit that verifies has to say who signed it, deliberately.
    signer: "",
    ...over,
  };
}

/** The rule as the product asks it: this subject's declared identities, and nobody else's. */
function findingFor(over: Partial<ObservedCommit>, identities: readonly string[] = [ME]) {
  return signatureFinding(commit(over), identities);
}

function ok(commits: readonly ObservedCommit[], identities: readonly string[] = [ME]) {
  const result = commitsToLeaflets({ commits, identities, observedAt: AT });
  assert.equal(result.ok, true, `expected ok, got issues: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("an unsigned commit by the subject is PENDING, not verified", () => {
  const { leaflets } = ok([commit({ signature: "N" })]);
  assert.equal(leaflets[0]?.tier, "pending");
});

test("a good signature BY THE SUBJECT is the ONLY thing that verifies", () => {
  // G verifies, and so does U while the signer git named is the subject's own address. Every
  // other documented code does not, including the "good but expired" family. This is the whole
  // product claim, so it is asserted code by code.
  for (const code of ["G", "U"]) {
    assert.equal(
      ok([commit({ signature: code, signer: ME })]).leaflets[0]?.tier,
      "verified",
      code,
    );
  }
  for (const code of ["B", "X", "Y", "R", "E", "N"]) {
    assert.equal(ok([commit({ signature: code, signer: ME })]).leaflets[0]?.tier, "pending", code);
  }
});

test("`N` about a SIGNED object is unchecked, never unsigned — the whole masking defect", () => {
  // The measured failure: on a machine with no gpg, git prints `N` — its code for "there is no
  // signature" — for a commit whose object plainly carries one, and sends the real cause to
  // stderr. Reading the code alone reports 298 signed Coeadapt2 commits as unsigned history.
  for (const armor of ["pgp", "ssh", "other"] as const) {
    assert.equal(findingFor({ signature: "N", signatureArmor: armor }), "unchecked");
  }
  assert.equal(findingFor({ signature: "N", signatureArmor: "none" }), "unsigned");
});

test("the finding of every documented %G? code, against the object AND the signer", () => {
  // The full truth table, asserted rather than described, over both things a verdict has to be
  // read against: what the object carries, and whom git bound the signature to. `E` is git
  // admitting it could not check; B/X/Y/R are checks that HAPPENED and were not accepted; an
  // unknown code is not claimed to be either — and none of those five move with the signer,
  // because there is nothing to attribute.
  const CODES = ["G", "U", "E", "B", "X", "Y", "R", "N", "?"];
  const findings = (armor: "none" | "ssh", signer: string) =>
    CODES.map((signature) => findingFor({ signature, signatureArmor: armor, signer }));

  // The subject's own signature: the two accepting codes, and only those, verify.
  assert.deepEqual(findings("none", ME), [
    "verified",
    "verified",
    "unchecked",
    "rejected",
    "rejected",
    "rejected",
    "rejected",
    "unsigned",
    "unrecognized",
  ]);
  // A real signature by somebody else. Nothing else in the row moves: it is the same commit,
  // checked the same way, and the only thing that changed is whose signature it was.
  assert.deepEqual(findings("none", "someone@else.example"), [
    "undeclared",
    "undeclared",
    "unchecked",
    "rejected",
    "rejected",
    "rejected",
    "rejected",
    "unsigned",
    "unrecognized",
  ]);
  // Two columns move for SSH with an empty signer: `N`, which lies about the object, and the
  // accepting pair, where git bound the key to nobody. That is the `U` case, arrived at by the
  // general rule rather than by a special case for it.
  assert.deepEqual(findings("ssh", ""), [
    "unbound",
    "unbound",
    "unchecked",
    "rejected",
    "rejected",
    "rejected",
    "rejected",
    "unchecked",
    "unrecognized",
  ]);
});

test("a signature git ACCEPTED from a signer nobody declared is NOT verified", () => {
  // THE FALSE VERIFIED, as a unit. Reproduced against real cryptography in
  // apps/leaf/src/gitIntake.test.ts; here is the rule it broke. The commit is authored by the
  // subject, git checked the signature and accepted it — and the key belongs to somebody else,
  // which one shared allowed_signers file makes an ordinary Tuesday. The tier used to be decided
  // by the verdict alone while attribution ran off the self-declared author field, so this read
  // as "authorship cryptographically established".
  const stranger = "someone@else.example";
  const result = ok([
    commit({ sha: sha("c"), signature: "G", signatureArmor: "ssh", signer: stranger }),
  ]);
  assert.equal(result.leaflets[0]?.tier, "pending", "a stranger's signature proves nothing here");
  assert.deepEqual(result.undeclaredSignatures, [
    { ref: sha("c"), armor: "ssh", code: "G", attributable: true },
  ]);
  // Not folded into any of the others: the check happened (so not `unchecked`), it succeeded (so
  // not `rejected`), and git DID name a signer (so not `unbound`).
  assert.deepEqual(result.unboundSignatures, []);
  assert.deepEqual(result.uncheckedSignatures, []);
  assert.deepEqual(result.rejectedSignatures, []);
});

test("an undeclared signer does NOT make the commit excluded — two different facts", () => {
  // `excluded` says "this is somebody else's work", which is a claim about the AUTHOR. A
  // stranger's signature on the subject's own commit does not support it: what is missing is
  // proof, not attribution. Collapsing the two would report a colleague's countersignature as
  // work the subject did not do.
  const result = ok([commit({ signature: "G", signer: "colleague@corp.example" })]);
  assert.equal(result.leaflets[0]?.tier, "pending");
  assert.equal(result.undeclaredSignatures[0]?.attributable, true);
});

test("a signature by a DECLARED second address verifies — a person has more than one", () => {
  // The mirror risk of the fix: binding to identities must use the whole declared set, or
  // signing with a personal key while authoring from a work address would stop verifying.
  const result = ok(
    [commit({ signature: "G", authorEmail: "work@corp.example", signer: "me@personal.example" })],
    ["work@corp.example", "me@personal.example"],
  );
  assert.equal(result.leaflets[0]?.tier, "verified");
  assert.deepEqual(result.undeclaredSignatures, []);
});

test("the signer is matched out of a PGP user id, and case-folded like every other address", () => {
  // `%GS` for PGP is a full user id, and an allowed_signers principal may be quoted in the same
  // shape — MEASURED with git 2.54.0, which reports `Real Name <subject@example.com>` for a
  // quoted principal. The address is the last angle-bracketed field; the display name is not an
  // identity and is never compared.
  const bound = ["Real Name <ME@Example.COM>", "  me@example.com  ", "Me <a@b> <ME@example.com>"];
  for (const signer of bound) {
    assert.equal(findingFor({ signature: "G", signer }), "verified", signer);
  }
  // A display name that happens to contain the subject's address as text is not a binding: the
  // uid's address field is what git bound, and it is somebody else's.
  assert.equal(
    findingFor({ signature: "G", signer: "me@example.com <other@else.example>" }),
    "undeclared",
  );
});

test("a signer git bound that is NOT an address binds to nothing — the weaker claim", () => {
  // MEASURED with git 2.54.0: an allowed_signers principal need not be an email at all, and
  // `alice` yields `G` with `%GS` of `alice`. This module cannot say whether `alice` is the
  // subject, and guessing from the author field is exactly the self-declared bridge it refuses.
  for (const signer of ["alice", "", "   ", "no-address-here"]) {
    assert.equal(findingFor({ signature: "G", signer }), "unbound", JSON.stringify(signer));
  }
});

test("`U` on an SSH signature is NOT verified — git names no signer for it", () => {
  // MEASURED with git 2.54.0: point gpg.ssh.allowedSignersFile at a file that does not list the
  // key — or at no file at all — and git reports `U` with an EMPTY signer, while a listed key
  // gives `G` and a real one. Treating that `U` as verified would tell an employer authorship
  // was cryptographically established because SOME key signed the commit and the author field,
  // which anyone can set to anyone, happened to match. It is reachable by one config typo.
  const result = ok([commit({ sha: sha("c"), signature: "U", signatureArmor: "ssh" })]);
  assert.equal(result.leaflets[0]?.tier, "pending");
  assert.deepEqual(result.unboundSignatures, [
    { ref: sha("c"), armor: "ssh", code: "U", attributable: true },
  ]);
  // Not folded into "unchecked": the check DID happen and the cryptography held, and the remedy
  // is a line in an allowed-signers file rather than a missing binary.
  assert.deepEqual(result.uncheckedSignatures, []);
});

test("`U` on a PGP signature still verifies — unknown TRUST is not unknown IDENTITY", () => {
  // The distinction the signer buys. For PGP, `U` means the key is not trusted in the local
  // keyring; git still names the uid it bound, so the signature says who made it.
  const result = ok([commit({ signature: "U", signatureArmor: "pgp", signer: `Me <${ME}>` })]);
  assert.equal(result.leaflets[0]?.tier, "verified");
  assert.deepEqual(result.unboundSignatures, []);
});

test("an unchecked signature is PENDING and is REPORTED, with both causes attached", () => {
  // Pending is true of it — nothing was proven. What must not happen is the caller reading that
  // pending as "unsigned", so the observation carries the armor (the signature exists) and the
  // code (what git claimed about it).
  const result = ok([commit({ sha: sha("b"), signature: "N", signatureArmor: "ssh" })]);
  assert.equal(result.leaflets[0]?.tier, "pending");
  assert.deepEqual(result.uncheckedSignatures, [
    { ref: sha("b"), armor: "ssh", code: "N", attributable: true },
  ]);
  assert.deepEqual(result.rejectedSignatures, []);
});

test("genuinely unsigned history reports NOTHING as unchecked — no crying wolf", () => {
  // The counterpart risk: a warning that fires on every ordinary repository is one nobody reads,
  // and it would make honest unsigned history look suspicious.
  const result = ok([commit({ sha: sha("a") }), commit({ sha: sha("b") })]);
  assert.deepEqual(result.uncheckedSignatures, []);
  assert.deepEqual(result.rejectedSignatures, []);
});

test("a signature git checked and REJECTED is reported apart from unsigned history", () => {
  // A repository of bad or expired signatures is not a repository of unsigned work, and both
  // collapse into "pending" in a tier count alone.
  const result = ok([
    commit({ sha: sha("a"), signature: "B", signatureArmor: "pgp" }),
    commit({ sha: sha("b"), signature: "X", signatureArmor: "pgp" }),
  ]);
  assert.deepEqual(
    result.leaflets.map((l) => l.tier),
    ["pending", "pending"],
  );
  assert.deepEqual(
    result.rejectedSignatures.map((s) => s.code),
    ["B", "X"],
  );
  assert.deepEqual(result.uncheckedSignatures, []);
});

test("an unknown code on a signed object is unrecognized, NOT claimed to be unchecked", () => {
  // The overclaim in the other direction: a code this version does not know might well be a
  // check that happened, so "nobody looked" would be an assertion about git's behaviour that
  // this code has no basis for.
  const result = ok([commit({ signature: "Q", signatureArmor: "pgp" })]);
  assert.deepEqual(result.unrecognizedSignatures, ["Q"]);
  assert.deepEqual(result.uncheckedSignatures, []);
  assert.equal(result.leaflets[0]?.tier, "pending");
});

test("unchecked signatures on ANOTHER author's commits are counted, and marked not attributable", () => {
  // "This machine cannot check signatures" is a fact about the machine. Hiding the excluded
  // commits would understate how much of the history went unread — while reporting them as the
  // subject's would overstate what is pending for them. Both numbers, one list.
  const result = ok([
    commit({ sha: sha("a"), signature: "N", signatureArmor: "pgp" }),
    commit({ sha: sha("b"), signature: "N", signatureArmor: "pgp", authorEmail: "x@other.example" }),
  ]);
  assert.deepEqual(
    result.uncheckedSignatures.map((s) => s.attributable),
    [true, false],
  );
  assert.deepEqual(
    result.leaflets.map((l) => l.tier),
    ["pending", "excluded"],
  );
});

test("an armor value this version does not know reads as SIGNED, the safe direction", () => {
  // A future ObservedCommit produced by an older reader must not degrade into a false
  // "unsigned". The cost of the safe direction is a warning nobody needed; the cost of the
  // other one is the defect this module exists to refuse.
  const finding = signatureFinding(
    { ...commit({ signature: "N" }), signatureArmor: "x509-or-whatever-comes-next" as never },
    [ME],
  );
  assert.equal(finding, "unchecked");
});

test("`E` on an object carrying NO signature is reported with the armor actually observed", () => {
  // The two reads contradicting each other: git says it could not check a signature, the object
  // scan found none. `unchecked` is the safe finding — never a false "unsigned" — and the
  // observation carries `none`, which is what was seen. The type documents that rather than
  // promising an armor value the reader never read; a caller that trusted the old "never none"
  // promise would describe an x509 signature to an operator who has none.
  const result = ok([commit({ sha: sha("e"), signature: "E", signatureArmor: "none" })]);
  assert.equal(result.leaflets[0]?.tier, "pending");
  assert.deepEqual(result.uncheckedSignatures, [
    { ref: sha("e"), armor: "none", code: "E", attributable: true },
  ]);
});

test("a matching author email alone NEVER verifies — it is self-declared", () => {
  // The overclaim this module exists to refuse: `git config user.email` is a string anyone can
  // set to anyone. If this ever returns "verified", the product is lying to an employer.
  const { leaflets } = ok([commit({ authorEmail: ME, signature: "N" })]);
  assert.notEqual(leaflets[0]?.tier, "verified");
});

test("a signature from someone ELSE does not verify — identity is checked first", () => {
  // A perfectly good signature by another person proves THEY wrote it, not that the subject
  // did. Order matters: signature-first would promote another author's signed work to verified.
  const { leaflets } = ok([
    commit({
      authorEmail: "someone@else.example",
      signature: "G",
      signer: "someone@else.example",
    }),
  ]);
  assert.equal(leaflets[0]?.tier, "excluded");
});

test("an unmatched identity is EXCLUDED with a required, real reason", () => {
  const { leaflets } = ok([commit({ sha: sha("b"), authorEmail: "other@example.com" })]);
  const l = leaflets[0];
  assert.equal(l?.tier, "excluded");
  if (l?.tier !== "excluded") throw new Error("unreachable");
  assert.match(l.reason, /not among the declared identities/);
  // The reason names the commit, so the exclusion is checkable rather than merely asserted.
  assert.ok(l.reason.includes(sha("b").slice(0, 7)), "the reason must name the short sha");
});

test("an exclusion reason NEVER contains the other author's email address", () => {
  // render.ts renders reasons on a public page. An address in a reason is an egress leak, and
  // it would be leaking a THIRD PARTY's data from the subject's own portfolio.
  const other = "private.person@secret-employer.example";
  const { leaflets } = ok([commit({ authorEmail: other })]);
  const l = leaflets[0];
  if (l?.tier !== "excluded") throw new Error("expected excluded");
  assert.ok(!l.reason.includes(other), "the address must not appear in the reason");
  assert.ok(!l.reason.includes("secret-employer"), "not even the domain");
  assert.ok(!l.reason.includes("@"), "no address-shaped text at all");
});

test("identity matching folds case, so a subject's own commits are not falsely excluded", () => {
  const { leaflets } = ok([commit({ authorEmail: "  ME@Example.COM " })], ["me@example.com"]);
  assert.equal(leaflets[0]?.tier, "pending", "case drift must not read as somebody else");
});

test("several declared identities all match — a real person has more than one address", () => {
  const commits = [
    commit({ sha: sha("a"), authorEmail: "work@corp.example" }),
    commit({ sha: sha("b"), authorEmail: "1234+user@users.noreply.github.com" }),
    commit({ sha: sha("c"), authorEmail: "nope@elsewhere.example" }),
  ];
  const { leaflets } = ok(commits, ["work@corp.example", "1234+user@users.noreply.github.com"]);
  assert.deepEqual(
    leaflets.map((l) => l.tier),
    ["pending", "pending", "excluded"],
  );
});

test("EVERY tier carries provenance whose ref is the full sha", () => {
  // Pending and excluded keep their sha because the commit is a real observed artifact either
  // way; dropping it would discard a true fact and make the conclusion uncheckable.
  const { leaflets } = ok([
    commit({ sha: sha("a"), signature: "G", signer: ME }),
    commit({ sha: sha("b"), signature: "N" }),
    commit({ sha: sha("c"), authorEmail: "other@example.com" }),
  ]);
  assert.deepEqual(
    leaflets.map((l) => l.tier),
    ["verified", "pending", "excluded"],
  );
  for (const l of leaflets) {
    assert.ok("provenance" in l && l.provenance !== undefined, `${l.tier} must carry provenance`);
    assert.equal(l.provenance?.source, "git");
    assert.equal(l.provenance?.observedAt, AT);
    assert.match(l.provenance?.ref ?? "", /^[0-9a-f]{40}$/, "ref must be a full object name");
  }
});

test("a commit with no message still gets a non-empty, TRUE title", () => {
  // `git commit --allow-empty-message` is legal. A blank title would be rejected by
  // parseLeafDocument — intake would emit a document its own loader refuses.
  const { leaflets } = ok([commit({ subject: "   " })]);
  assert.ok((leaflets[0]?.title.length ?? 0) > 0);
  assert.match(leaflets[0]?.title ?? "", /no message/);
});

test("an unknown signature code falls back to pending AND is reported", () => {
  // The fallback is the safe direction, but a silent fallback would make a stale rule
  // indistinguishable from a genuinely unsigned repository.
  const result = ok([commit({ signature: "Q" }), commit({ sha: sha("b"), signature: "Q" })]);
  assert.equal(result.leaflets[0]?.tier, "pending");
  assert.deepEqual(result.unrecognizedSignatures, ["Q"], "deduplicated and surfaced");
});

test("a documented code is NOT reported as unrecognized", () => {
  assert.deepEqual(ok([commit({ signature: "B" })]).unrecognizedSignatures, []);
});

test("a malformed or abbreviated sha is REFUSED, not recorded as provenance", () => {
  for (const bad of ["af30d92", "", "not-hex-at-all", sha("a") + "extra"]) {
    const r = commitsToLeaflets({
      commits: [commit({ sha: bad })],
      identities: [ME],
      observedAt: AT,
    });
    assert.equal(r.ok, false, `"${bad}" must be refused`);
  }
});

test("no declared identity is a REFUSAL, not a repository of exclusions", () => {
  const r = commitsToLeaflets({ commits: [commit()], identities: [], observedAt: AT });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.issues[0]?.at, "identities");
});

test("a bad observedAt is refused rather than written into every leaflet", () => {
  const r = commitsToLeaflets({
    commits: [commit()],
    identities: [ME],
    observedAt: "2026-08-15 12:00:00",
  });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.issues[0]?.at, "observedAt");
});

test("the transform never throws, whatever it is handed", () => {
  const hostile: unknown[] = [
    { commits: [], identities: [], observedAt: "" },
    { commits: [commit({ signature: "" })], identities: [ME], observedAt: AT },
    { commits: [commit({ authorEmail: "" })], identities: [ME], observedAt: AT },
    { commits: [commit(), commit()], identities: [ME], observedAt: AT }, // duplicate sha
  ];
  for (const input of hostile) {
    assert.doesNotThrow(() => commitsToLeaflets(input as never), JSON.stringify(input));
  }
});

test("the same commit observed twice is refused — duplicate ids would break the document", () => {
  const r = commitsToLeaflets({
    commits: [commit(), commit()],
    identities: [ME],
    observedAt: AT,
  });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assert.match(r.issues[0]?.message ?? "", /duplicate commit/);
});

test("an empty repository yields zero leaflets and NOT a failure", () => {
  // The honest empty state. A repository with no commits is a real, valid, empty portfolio —
  // collapsing it into an error is the mirror of reporting a failed read as zero.
  const result = ok([]);
  assert.deepEqual(result.leaflets, []);
});

test("the ledger over intake output counts every commit exactly once", () => {
  // The join to the rest of the domain: nothing intake produces may be uncountable, and the
  // totals must reconcile against the number of commits observed.
  const commits = [
    commit({ sha: sha("a"), signature: "G", signer: ME }),
    commit({ sha: sha("b"), signature: "U", signer: ME }),
    commit({ sha: sha("c"), signature: "N" }),
    commit({ sha: sha("d"), authorEmail: "other@example.com" }),
  ];
  const leaf: Leaf = { id: leafId("t"), subject: "T", leaflets: ok(commits).leaflets };
  const ledger = attributionLedger(leaf);
  assert.deepEqual(
    { v: ledger.verified, p: ledger.pending, x: ledger.excluded },
    { v: 2, p: 1, x: 1 },
  );
  assert.equal(ledger.verified + ledger.pending + ledger.excluded, commits.length);
  assert.equal(ledger.exclusionReasons.length, 1, "every exclusion stays explainable");
});

test("intake output carries no score-shaped value of any kind", () => {
  // The WHOLE result, not just the leaflets: the signature reports added counts and lists, and a
  // rating smuggled in beside the tiers would be exactly as forbidden as one inside them.
  const result = ok([
    commit({ signature: "G", signer: ME }),
    commit({ sha: sha("b") }),
    commit({ sha: sha("c"), signature: "N", signatureArmor: "ssh" }),
    commit({ sha: sha("d"), signature: "B", signatureArmor: "pgp" }),
    commit({ sha: sha("e"), signature: "G", signer: "someone@else.example" }),
  ]);
  const serialized = JSON.stringify(result);
  for (const term of ["score", "rating", "rank", "percent", "weight", "confidence", "strength"]) {
    assert.ok(!serialized.toLowerCase().includes(term), `intake must emit no "${term}"`);
  }
});

// The "mergeIntakeIntoLeaflets — the seam's destructive edge" suite that lived here tested a
// merge implementation removed as dead code (see intake.ts): apps/leaf/intake.mjs calls
// `mergeIntakeIntoLeaf` from merge.ts, and merge.test.ts already covers this same rule — a
// re-read of git must not delete a promoted leaflet — for the function that is actually wired
// into production.
