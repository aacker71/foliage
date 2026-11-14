#!/usr/bin/env node
/**
 * THE PUBLISH COMMAND — the one place a leaf crosses from the machine it lives on to a page
 * strangers can read.
 *
 *   node apps/canopy/publish.mjs --document <leaf.json> --into <dir> [--confirm <id>] [--republish]
 *
 * WHY IT IS A COMMAND, AND WHY IT IS THE ONLY WAY. Publication is EGRESS across a plane boundary.
 * The open plane makes no network call beyond 127.0.0.1 and holds no notion of "public" at all;
 * this command lives in the cloud plane, is run deliberately by a human, writes one file, and
 * contacts nothing. There is no daemon, no sync, no watcher, and no background upload — a leaf
 * moves because somebody typed this, or it does not move.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CONSENT IS THE POINT, SO IT CANNOT BE IMPLIED BY RUNNING THE COMMAND.
 *
 * Run with no confirmation, this prints the FULL withheld report and exits NON-ZERO having
 * written nothing at all — no file, no directory, no temporary. That is the default and it is not
 * a dry-run mode: the dry run is the command, and publishing is the exception you ask for.
 *
 * The confirmation is `--confirm <id>` and it TAKES THE ID BEING PUBLISHED, not a bare `--yes`.
 * That is a deliberate design, not ceremony:
 *
 *   - A bare flag is muscle memory. It can be appended by shell history, a Makefile, or a habit,
 *     and the person appending it has demonstrated nothing about having read anything.
 *   - The id is printed in the report, above the withheld list. Typing it back is a small proof
 *     that the operator looked at the report they are consenting to — and it names WHICH page
 *     they are consenting to, which matters the moment a machine holds two leaf documents.
 *   - It cannot be defaulted. A wrong id is refused with both ids named, rather than publishing
 *     "the obvious one".
 *
 * A SECOND PUBLICATION IS A SECOND DECISION. `--confirm` alone will not replace an existing
 * publication: that needs `--republish` as well, because "I consented to publish this" is not
 * consent to publish a different this. Before replacing, the command DIFFS the two artifacts and
 * prints which claims are about to appear, disappear or change — the payoff of publishing a
 * document rather than a rendered page.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO DO, which matters more than what it does:
 *
 *   - It never writes anything from a failed read. Absent, unreadable, malformed and invalid are
 *     four separate causes with four separate messages, and every one of them exits non-zero
 *     having written nothing.
 *   - It never publishes a document that declares itself an example. The redaction gate refuses
 *     it WHOLE, and this prints that refusal rather than publishing a banded page.
 *   - It never invents a URL. The page's address is the leaf document's own id. An id that is not
 *     url-safe is refused with the remedy printed, never slugified: an id chosen at publish time
 *     would be a second identity for the same leaf, and two publications of one leaf under two
 *     names are two pages nobody can reconcile.
 *   - It validates its OWN output with the canopy's ingest gate before the bytes reach the disk.
 *     A publisher that can emit an artifact its own canopy refuses is a publisher nobody can
 *     trust, and this closes the loop mechanically rather than by assertion.
 *   - It never prints a withheld value. Each entry says what class of thing was withheld and how
 *     to look at the original yourself — the same choice `exclusionReason` makes in @foliage/leaf,
 *     for the same reason: printing the address into the report just moves the egress into the
 *     document people paste into chat.
 *
 * Zero third-party dependencies: `node:util`'s parseArgs does the command line, `node:crypto`
 * hashes the document, and the gate is this repository's own.
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { parseLeafDocument } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import {
  DEFAULT_POLICY_PATH,
  describePolicySource,
  loadPublishPolicy,
} from "@foliage/leaf-app/policyDocument";
import {
  DOCUMENT_DIGEST,
  PUBLICATION_LIMITS,
  PUBLISHED_ID,
  buildPublishedDocument,
  diffPublications,
  documentDigest,
  parsePublishedDocument,
  reviewForPublication,
  toArtifactJson,
} from "@foliage/canopy";

import { publishedPath, publishedUrl } from "./src/publishedLeaf.ts";
import {
  assertPublicationUnchanged,
  withPublicationLock,
} from "./src/publicationMutation.mjs";

const USAGE = `Publish one leaf — the explicit, separately confirmed crossing from a private document
to a page anyone can read.

  node apps/canopy/publish.mjs --document <leaf.json> --into <dir> [options]

Required
  --document <path>    the leaf document to review
  --into <dir>         the canopy's publications directory (what FOLIAGE_PUBLISHED points at)

Options
  --policy <path>      publication rules to apply. Beats FOLIAGE_POLICY; when neither names a
                       file, the shipped fail-closed default is used and named in the report.
  --expect-digest <d>  refuse if the leaf bytes no longer match this sha256 digest. The private
                       manager uses this to bind consent to the review that was actually shown.
  --expect-policy-digest <d>
                       refuse if the effective rules or their source changed after review.
  --expect-public-digest <d>
                       refuse if the artifact being replaced changed after review.
  --confirm <id>       consent to publish, naming the leaf id you read in the report.
                       WITHOUT THIS NOTHING IS WRITTEN: the command prints the review and
                       exits non-zero. Consent is not implied by running the command.
  --include-portfolio  explicitly include safe authored context and fully supported public claims.
  --republish          allow replacing an existing publication of the same id. A second
                       publication is a second decision, so --confirm alone will not do it.
  --brief              print only the first few withheld entries. The output says so, loudly.
  --help

The page's address is the leaf document's own id: /leaf/<id>. It is never invented here.
`;

/** Exit codes, so a caller can tell each refusal apart. */
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
/** The report was printed and consent was not given. Nothing was written. */
const EXIT_NO_CONSENT = 3;
/** A publication already exists under this id and --republish was not given. */
const EXIT_WOULD_REPLACE = 4;

const BRIEF_ENTRIES = 5;

const out = process.stdout;

/**
 * @param {string} message
 * @param {number} [code]
 * @returns {never}
 */
function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`publish: ${message}\n`);
  process.exit(code);
}

/** Quote one argument for the copyable POSIX-shell command printed after a dry review. @param {string} value */
function shellArg(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @returns {{document: string, into: string, policy: string | null, expectDigest: string | null, expectPolicyDigest: string | null, expectPublicDigest: string | null, confirm: string | null, republish: boolean, includePortfolio: boolean, brief: boolean}} */
function readArguments() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        document: { type: "string" },
        into: { type: "string" },
        policy: { type: "string" },
        "expect-digest": { type: "string" },
        "expect-policy-digest": { type: "string" },
        "expect-public-digest": { type: "string" },
        confirm: { type: "string" },
        republish: { type: "boolean", default: false },
        "include-portfolio": { type: "boolean", default: false },
        brief: { type: "boolean", default: false },
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
    out.write(USAGE);
    process.exit(EXIT_OK);
  }

  const missing = [];
  if (values.document === undefined || values.document.trim() === "") missing.push("--document");
  if (values.into === undefined || values.into.trim() === "") missing.push("--into");
  if (missing.length > 0) {
    process.stderr.write(`missing required argument(s): ${missing.join(", ")}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }

  const confirm = values.confirm === undefined ? null : values.confirm.trim();
  if (confirm === "") {
    // An empty --confirm is a mistake, and treating it as "no consent" would be a silent one.
    process.stderr.write(
      `--confirm was given with an empty value. It takes the leaf id you are consenting to ` +
        `publish, which the report prints.\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }

  const policy = values.policy === undefined ? null : values.policy.trim();
  if (policy === "") {
    process.stderr.write(`--policy was given with an empty value.\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  const expectDigest = values["expect-digest"] === undefined ? null : values["expect-digest"].trim();
  if (expectDigest !== null && !DOCUMENT_DIGEST.test(expectDigest)) {
    process.stderr.write(`--expect-digest must be sha256 followed by 64 lower-case hex digits.\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  const expectPolicyDigest = values["expect-policy-digest"] === undefined
    ? null
    : values["expect-policy-digest"].trim();
  if (expectPolicyDigest !== null && !DOCUMENT_DIGEST.test(expectPolicyDigest)) {
    process.stderr.write(`--expect-policy-digest must be sha256 followed by 64 lower-case hex digits.\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  const expectPublicDigest = values["expect-public-digest"] === undefined
    ? null
    : values["expect-public-digest"].trim();
  if (expectPublicDigest !== null && !DOCUMENT_DIGEST.test(expectPublicDigest)) {
    process.stderr.write(`--expect-public-digest must be sha256 followed by 64 lower-case hex digits.\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }

  return {
    document: resolve(/** @type {string} */ (values.document).trim()),
    into: resolve(/** @type {string} */ (values.into).trim()),
    policy: policy === null ? null : resolve(policy),
    expectDigest,
    expectPolicyDigest,
    expectPublicDigest,
    confirm,
    republish: values.republish === true,
    includePortfolio: values["include-portfolio"] === true,
    brief: values.brief === true,
  };
}

/**
 * Read and parse the leaf document, keeping all four causes apart.
 *
 * Returns the bytes as well as the parse: the artifact records a digest of the FILE'S OWN BYTES,
 * not of a re-serialization, so that anyone holding the file can check it with a shasum binary.
 *
 * @param {string} path
 * @returns {Promise<{bytes: Buffer, leaf: import("@foliage/leaf").Leaf, declaredExample: boolean}>}
 */
async function readLeafDocument(path) {
  /** @type {Buffer} */
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") {
      fail(`absent — no leaf document at ${path}. Nothing was written.`);
    }
    fail(
      `unreadable — ${path} exists as far as this process can tell and could not be read: ` +
        `${err instanceof Error ? err.message : String(err)} [${code}]. Nothing was written.`,
    );
  }

  const text = bytes.toString("utf8").replace(/^﻿/, "");
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    fail(
      `malformed — ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}. ` +
        `Nothing was written.`,
    );
  }

  const parsed = parseLeafDocument(json);
  if (!parsed.ok) {
    process.stderr.write(
      `publish: invalid — ${path} is valid JSON but is not a leaf document: ` +
        `${parsed.issues.length} problem(s). Nothing was written.\n`,
    );
    for (const issue of parsed.issues) {
      process.stderr.write(`publish:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  return { bytes, leaf: parsed.leaf, declaredExample: parsed.declaredExample };
}

/**
 * Print the review a human is being asked to consent to.
 *
 * THE REPORT IS THE PRODUCT OF THIS COMMAND. Everything else is a file write. It names every
 * withholding individually rather than counting them, because a count is not reviewable — it is a
 * number to nod at — and it prints the gate's own limits, because a report without its caveats
 * invites the reader to treat "nothing found" as "nothing there".
 *
 * @param {Extract<import("@foliage/canopy").PublicationReview, {ok: true}>} review
 * @param {boolean} brief
 */
function printReview(review, brief) {
  const withheld = review.withheld;

  out.write(`\npublish: WOULD PUBLISH — ${review.published.leaflets.length} leaflet(s)\n`);
  for (const l of review.published.leaflets) {
    out.write(
      `publish:   ${l.id}  [${l.tier}]  ${l.title}${l.titleRedacted ? "   [TITLE REDACTED — not verbatim]" : ""}\n`,
    );
  }
  if (review.published.leaflets.length === 0) {
    out.write(
      `publish:   (none — either nothing here was offered outward, everything offered turned out\n` +
        `publish:   to be somebody else's work, or the evidence itself carried something\n` +
        `publish:   unpublishable. That is an honest empty page, not a failure — see WOULD\n` +
        `publish:   WITHHOLD below for which of those applied.)\n`,
    );
  }
  if (review.published.subjectRedacted) {
    out.write(
      `publish:   NOTE — the subject name was altered by the gate; the published name is\n` +
        `publish:   "${review.published.subject}"\n`,
    );
  }

  out.write(`\npublish: WOULD WITHHOLD — ${withheld.length} entr${withheld.length === 1 ? "y" : "ies"}\n`);
  if (withheld.length === 0) {
    out.write(
      `publish:   (none. That is a statement about this mechanism, not a finding that the\n` +
        `publish:   document holds nothing personal — see the limits below.)\n`,
    );
  }

  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const w of withheld) tally.set(w.kind, (tally.get(w.kind) ?? 0) + 1);
  for (const [kind, n] of tally) out.write(`publish:   ${String(n).padStart(5)}  ${kind}\n`);

  const shown = brief ? withheld.slice(0, BRIEF_ENTRIES) : withheld;
  if (shown.length > 0) out.write(`\n`);
  shown.forEach((w, i) => {
    out.write(`publish:  ${i + 1}. [${w.kind}] ${w.at}\n`);
    out.write(`publish:     item: ${w.item}\n`);
    out.write(`publish:     why:  ${w.reason}\n`);
    out.write(`publish:     see:  ${w.inspect}\n`);
  });
  if (brief && withheld.length > shown.length) {
    // A truncated display must never be mistakable for a complete one.
    out.write(
      `publish:  … TRUNCATED: ${withheld.length - shown.length} further entr` +
        `${withheld.length - shown.length === 1 ? "y is" : "ies are"} NOT SHOWN because --brief\n` +
        `publish:  was given. Re-run without --brief to read all ${withheld.length} before consenting.\n`,
    );
  }

  out.write(`\npublish: WHAT THIS REVIEW CANNOT CATCH\n`);
  for (const limit of PUBLICATION_LIMITS) {
    out.write(`publish:   - ${limit}\n`);
  }
}

/**
 * Print what a re-publish would change. Computed from the two artifacts, never from memory.
 *
 * Takes the two artifacts' own leaflets (not just `diff`) so an added or changed row can print the
 * tier it carries — `diff.added` is bare ids and `ChangedLeaflet` carries only a `tierChanged`
 * boolean, neither of which is the fact itself. The consent report says the tier beside every
 * WOULD-PUBLISH row; a re-publish is a second consent and must say it too.
 *
 * @param {import("@foliage/canopy").PublicationDiff} diff
 * @param {readonly import("@foliage/canopy").PublishedLeaflet[]} previousLeaflets
 * @param {readonly import("@foliage/canopy").PublishedLeaflet[]} nextLeaflets
 */
function printDiff(diff, previousLeaflets, nextLeaflets) {
  out.write(`\npublish: THIS WOULD REPLACE A PUBLICATION MADE AT ${diff.previouslyPublishedAt}\n`);
  out.write(
    diff.sameSourceDocument
      ? `publish:   The source leaf document is byte-identical to the one it was published from,\n` +
          `publish:   so any difference below came from this product, not from the evidence.\n`
      : `publish:   The source leaf document has changed since that publication.\n`,
  );
  if (diff.identical) {
    out.write(
      `publish:   Nothing a reader could see would change.` +
        `${diff.policyChanged ? " The publication rules used for this release differ." : " Only the publication instant differs."}\n`,
    );
    return;
  }
  /**
   * @param {readonly import("@foliage/canopy").PublishedLeaflet[]} leaflets
   * @returns {Map<string, import("@foliage/canopy").PublishedLeaflet["tier"]>}
   */
  const tierById = (leaflets) => new Map(leaflets.map((l) => [String(l.id), l.tier]));
  const tierBefore = tierById(previousLeaflets);
  const tierAfter = tierById(nextLeaflets);

  if (diff.subjectChanged) out.write(`publish:   The subject name on the page would change.\n`);
  for (const id of diff.added) {
    out.write(`publish:   + ${id}  [${tierAfter.get(id)}]  — this page would START making this claim\n`);
  }
  for (const id of diff.removed) {
    out.write(`publish:   - ${id}  — this page would STOP making this claim\n`);
  }
  for (const c of diff.changed) {
    out.write(`publish:   ~ ${c.id}\n`);
    out.write(`publish:       was: ${c.before}\n`);
    out.write(`publish:       now: ${c.after}\n`);
    if (c.redactionChanged) {
      out.write(`publish:       the claim about whether this title is verbatim also changed\n`);
    }
    if (c.provenanceChanged) {
      out.write(`publish:       the public provenance source, ref, or observation instant changed\n`);
    }
    if (c.tierChanged) {
      out.write(`publish:       tier: ${tierBefore.get(c.id)} → ${tierAfter.get(c.id)}\n`);
    }
  }
  if (diff.artifactMetadataChanged) out.write(`publish:   the public artifact format or page identity changed\n`);
  if (diff.sourceRecordChanged) out.write(`publish:   the public source digest or byte count changed\n`);
  if (diff.policyChanged) out.write(`publish:   the publication rules used for this release changed\n`);
  if (diff.withholdingKindsChanged) out.write(`publish:   the public withholding-kind breakdown changed\n`);
  if (diff.leafletOrderChanged) out.write(`publish:   the order of leaflets on the public page changed\n`);
  if (diff.withheldBefore !== diff.withheldAfter) {
    out.write(
      `publish:   withheld entries: ${diff.withheldBefore} → ${diff.withheldAfter}\n`,
    );
  }
}

/**
 * Read the artifact already published under this id, if there is one.
 *
 * BOTH CAUSES TRAVEL. An existing file that does not parse is reported as unreadable-but-present
 * rather than as absent: replacing a corrupt publication is legitimate, and pretending nothing was
 * there would hide that something was.
 *
 * @param {string} path
 * @returns {Promise<{state: "none"} | {state: "present", document: import("@foliage/canopy").PublishedLeafDocument, artifactDigest: string} | {state: "unparsable", detail: string, artifactDigest: string | null}>}
 */
async function readExisting(path) {
  /** @type {Buffer} */
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return { state: "none" };
    return {
      state: "unparsable",
      detail: `it could not be read: ${err instanceof Error ? err.message : String(err)} [${code}]`,
      artifactDigest: null,
    };
  }
  const artifactDigest = documentDigest(bytes);
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch (err) {
    return {
      state: "unparsable",
      detail: `it is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      artifactDigest,
    };
  }
  const parsed = parsePublishedDocument(json);
  if (!parsed.ok) {
    return {
      state: "unparsable",
      detail: `it is not a published artifact this canopy can read (${parsed.issues.length} problem(s), first: ${parsed.issues[0]?.at ?? "?"})`,
      artifactDigest,
    };
  }
  return { state: "present", document: parsed.document, artifactDigest };
}

/** @param {ReturnType<typeof readArguments>} args */
async function main(args) {
  if (args.brief && args.confirm !== null) {
    fail(
      `--brief cannot be combined with --confirm because it omits review entries. ` +
        `Re-run without --brief, read the complete report, then use the confirmation command it prints. Nothing was written.`,
      EXIT_USAGE,
    );
  }

  // 1. READ the leaf document. Four causes, four messages, nothing written on any of them.
  const [source, policy] = await Promise.all([
    readLeafDocument(args.document),
    loadPublishPolicy(process.env, args.policy),
  ]);
  if (!policy.ok) {
    process.stderr.write(
      `publish: policy ${policy.cause} — ${policy.detail} Nothing was written.\n`,
    );
    if (policy.cause === "invalid") {
      for (const issue of policy.issues) {
        process.stderr.write(`publish:   ${issue.at}: ${issue.message}\n`);
      }
    }
    process.exit(EXIT_FAILED);
  }
  if (args.expectPolicyDigest !== null && policy.policyDigest !== args.expectPolicyDigest) {
    fail(
      `the publication rules changed after review (${args.expectPolicyDigest} → ${policy.policyDigest}). ` +
        `Review the current decision and confirm again. Nothing was written.`,
    );
  }

  const digest = documentDigest(source.bytes);
  if (args.expectDigest !== null && digest !== args.expectDigest) {
    fail(
      `the leaf changed after its publication review (${args.expectDigest} → ${digest}). ` +
        `Review the current document and confirm again. Nothing was written.`,
    );
  }

  // 2. GATE. The redaction gate decides what may cross; this command never overrides it.
  const review = reviewForPublication({
    leaf: source.leaf,
    declaredExample: source.declaredExample,
    policy: policy.policy,
    includePortfolio: args.includePortfolio,
  });

  if (!review.ok) {
    process.stderr.write(`publish: REFUSED — this document may not be published at all.\n`);
    for (const refusal of review.refusals) {
      process.stderr.write(`publish:   ${refusal.at}: ${refusal.reason}\n`);
    }
    process.stderr.write(`publish: Nothing was written.\n`);
    process.exit(EXIT_FAILED);
  }

  const id = review.published.id;
  out.write(`publish: reviewed ${args.document}\n`);
  out.write(`publish: subject   ${review.published.subject}\n`);
  out.write(`publish: leaf id   ${id}\n`);
  out.write(`publish: document  ${digest} (${source.bytes.byteLength} bytes)\n`);
  out.write(`publish: policy    ${describePolicySource(policy.source)}\n`);
  out.write(`publish: url       ${publishedUrl(id)}\n`);

  if (!PUBLISHED_ID.test(id)) {
    process.stderr.write(
      `publish: "${id}" cannot be a published id — it must match ${String(PUBLISHED_ID)}, ` +
        `because the id IS the URL this page gets. It is refused rather than transformed: an id ` +
        `invented here would be a second identity for the same leaf. Re-run intake with ` +
        `--id <slug>, then publish again. Nothing was written.\n`,
    );
    process.exit(EXIT_FAILED);
  }

  // 3. BUILD the artifact, and prove the canopy's own ingest gate accepts it BEFORE any bytes
  //    reach the disk. A publisher that can emit an artifact its own canopy refuses is one
  //    nobody can trust.
  const built = buildPublishedDocument({
    review,
    // The ONE place a clock enters this seam. Everything downstream is pure, so the artifact a
    // human consented to is the artifact that gets written.
    publishedAt: new Date().toISOString(),
    documentDigest: digest,
    documentBytes: source.bytes.byteLength,
    policyDigest: policy.policyDigest,
  });
  if (!built.ok) {
    process.stderr.write(`publish: BUG — could not assemble a published artifact. Nothing was written.\n`);
    for (const issue of built.issues) {
      process.stderr.write(`publish:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  const artifact = toArtifactJson(built.document);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const selfCheck = parsePublishedDocument(JSON.parse(serialized));
  if (!selfCheck.ok) {
    process.stderr.write(
      `publish: BUG — the artifact just produced is not one this canopy can serve. ` +
        `Nothing was written.\n`,
    );
    for (const issue of selfCheck.issues) {
      process.stderr.write(`publish:   ${issue.at}: ${issue.message}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  // 4. REPORT. This is what a human is being asked to consent to.
  printReview(review, args.brief);

  const target = publishedPath(args.into, id);
  const existing = await readExisting(target);
  if (
    args.expectPublicDigest !== null &&
    (existing.state === "none" || existing.artifactDigest !== args.expectPublicDigest)
  ) {
    fail(
      `the public artifact changed after review (${args.expectPublicDigest} → ${
        existing.state === "none" ? "absent" : existing.artifactDigest ?? "unreadable"
      }). Review the current public leaf and confirm again. Nothing was written.`,
      EXIT_WOULD_REPLACE,
    );
  }

  if (existing.state === "present") {
    printDiff(
      diffPublications(existing.document, built.document),
      existing.document.leaf.leaflets,
      built.document.leaf.leaflets,
    );
  } else if (existing.state === "unparsable") {
    out.write(
      `\npublish: A FILE IS ALREADY PUBLISHED UNDER THIS ID AND THIS COMMAND CANNOT READ IT:\n` +
        `publish:   ${existing.detail}\n` +
        `publish:   No difference can be shown, so nothing is known about what replacing it\n` +
        `publish:   would change. That is itself worth knowing before you replace it.\n`,
    );
  }

  // 5. CONSENT. Not implied by having run the command, and not satisfied by a bare flag.
  if (args.confirm === null) {
    const boundReviewCommand =
      `publish:   node apps/canopy/publish.mjs --document ${shellArg(args.document)} \\\n` +
      `publish:     --into ${shellArg(args.into)}` +
      `${args.policy === null ? "" : ` --policy ${shellArg(args.policy)}`} \\\n` +
      `publish:     --expect-digest ${digest} \\\n` +
      `publish:     --expect-policy-digest ${policy.policyDigest}` +
      `${existing.state === "none" || existing.artifactDigest === null ? "" : ` \\\npublish:     --expect-public-digest ${existing.artifactDigest}`}`;
    if (args.brief) {
      process.stderr.write(
        `\npublish: NOTHING WAS WRITTEN — this review was abbreviated.\n` +
          `publish: Re-run the complete, still non-confirming review below. Only that full review\n` +
          `publish: will print a command that can publish:\n` +
          `publish:\n${boundReviewCommand}\n` +
          `publish:\n` +
          `publish: Brief output cannot be used to consent.\n`,
      );
      process.exit(EXIT_NO_CONSENT);
    }
    process.stderr.write(
      `\npublish: NOTHING WAS WRITTEN — no file, no directory, not even an empty one.\n` +
        `publish: This command prints what would be published and stops. To publish, read the\n` +
        `publish: review above and name the leaf you consent to publish:\n` +
        `publish:\n` +
        `${boundReviewCommand} \\\n` +
        `publish:     --confirm ${shellArg(id)}` +
        `${existing.state === "none" ? "" : " --republish"}\n` +
        `publish:\n` +
        `publish: Consent is not implied by running this command.\n`,
    );
    process.exit(EXIT_NO_CONSENT);
  }

  if (args.confirm !== id) {
    process.stderr.write(
      `publish: --confirm names "${args.confirm}", and this document publishes as "${id}". ` +
        `Nothing was written. The confirmation names the page you are consenting to publish, so ` +
        `a mismatch is refused rather than resolved to the obvious one.\n`,
    );
    process.exit(EXIT_FAILED);
  }

  if (existing.state !== "none" && !args.republish) {
    process.stderr.write(
      `\npublish: A PUBLICATION ALREADY EXISTS UNDER "${id}" AND WAS NOT REPLACED.\n` +
        `publish: A second publication is a second decision — consenting to publish this leaf\n` +
        `publish: once is not consent to replace what is on the canopy now with something else.\n` +
        `publish: The difference is printed above. If it is what you mean, add --republish.\n` +
        `publish: Nothing was written.\n`,
    );
    process.exit(EXIT_WOULD_REPLACE);
  }

  // 6. WRITE. A shared per-id lock makes the read/decision/write sequence one mutation across
  //    manager and CLI processes. Atomic file primitives then keep readers off partial bytes.
  await mkdir(dirname(target), { recursive: true });
  const { mutationError: writeError, releaseWarning } = await withPublicationLock(target, async () => {
    const lockedExisting = await readExisting(target);
    assertPublicationUnchanged(existing, lockedExisting, target);
    writeDocument(target, serialized, existing.state !== "none");
  });
  if (releaseWarning !== null) {
    process.stderr.write(
      `publish: WARNING — ${writeError === null ? "the artifact was written" : "the publication failed"}, but its lock could not be cleaned up: ` +
      `${releaseWarning instanceof Error ? releaseWarning.message : String(releaseWarning)}. ` +
      `Future changes may require inspecting ${target}.lock.\n`,
    );
  }
  if (writeError !== null) {
    const code = writeError !== null && typeof writeError === "object" && "code" in writeError
      ? String(writeError.code)
      : "";
    if (code === "EEXIST" || code === "ESTALEPUBLIC") {
      fail(
        `${writeError instanceof Error ? writeError.message : String(writeError)} Nothing was replaced.`,
        EXIT_WOULD_REPLACE,
      );
    }
    fail(`could not write ${target}: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }

  out.write(
    `\npublish: ${existing.state === "none" ? "PUBLISHED" : "REPUBLISHED"} ${id}\n` +
      `publish:   file  ${target}\n` +
      `publish:   at    ${built.document.publishedAt}\n` +
      `publish:   from  ${digest}\n`,
  );
  out.write(
    `publish: serve it with  FOLIAGE_PUBLISHED=${args.into} node apps/canopy/server.mjs\n` +
      `publish: then open     ${publishedUrl(id)}\n`,
  );
  out.write(
    `publish: to unpublish, delete that one file. Nothing else on this canopy knows it existed.\n`,
  );
}

const args = readArguments();
const policyPath = (args.policy ?? process.env["FOLIAGE_POLICY"] ?? DEFAULT_POLICY_PATH).trim();
// Match loadPublishPolicy's path normalization. A blank setting is refused by that loader,
// without first acquiring a lock for a different path or creating its parent directories.
if (args.confirm === null || policyPath === "") await main(args);
else await withDocumentLocks([args.document, policyPath], () => main(args));
