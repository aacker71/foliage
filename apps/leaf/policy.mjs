#!/usr/bin/env node
/**
 * Leaf policy — the rules your leaflets are judged by before anything goes outward, printed,
 * checked against your real portfolio, and adjusted BY POINTING AT ONE OF YOUR OWN LEAFLETS.
 *
 *   node apps/leaf/policy.mjs show
 *   node apps/leaf/policy.mjs check
 *   node apps/leaf/policy.mjs deny  <id> --by <fact> --because "<your words>"
 *   node apps/leaf/policy.mjs allow <id> --by <fact> --because "<your words>"
 *   node apps/leaf/policy.mjs drop  <rule-id>
 *
 * WHY "BY EXAMPLE" IS A COMPILER AND NOT A CONVERSATION. The product's promise is that NO MODEL
 * EVALUATES ANYTHING AT PUBLISH TIME. A model may help you draft a rule — that is what a chat is
 * for, and `--because` is where your sentence lands — but what crosses into the file is a rule
 * naming a fact ALREADY WRITTEN IN YOUR DOCUMENT: a tier, an evidence source, a ref, an id
 * prefix. `deny <id> --by evidence-ref` reads the ref off that leaflet; nothing here interprets
 * anything later. Run the same rule next year and it answers the same, with no weights in the
 * room, and every denial can be explained by quoting a line of your own file.
 *
 * THE ASYMMETRY YOU ARE OPERATING, restated because it is the reason this is safe to use:
 * `deny` is ABSOLUTE and is evaluated at publish time — it blocks even a leaflet you shared by
 * hand. `allow` only PROPOSES; it publishes nothing on its own, because sharing stays your act
 * (`share.mjs`). So a rule you get wrong can cost you visibility and can never cause exposure.
 *
 * WHY IT IS A COMMAND AND NOT A BUTTON, the same reason `share.mjs` is: the leaf server has no
 * authentication of any kind and treats anyone who can reach the port as you. The two decisions
 * that change who may read your evidence — sharing, and the rules governing sharing — are the
 * two that must not live on an unauthenticated surface. The terminal already answers "is this
 * the person" with the filesystem's permissions.
 *
 * THE FIRST WRITE MATERIALISES THE SHIPPED DEFAULTS. If you have no policy file, `deny`/`allow`
 * writes the four default rails ALONGSIDE your new rule rather than a one-rule document, and
 * says so. Starting from empty would mean adding one rule silently deleted four.
 *
 * Every write is temp-then-rename — atomic on one filesystem — and the bytes go through
 * `parsePublishPolicy` BEFORE they reach the disk, the same self-check intake, harvest and share
 * all make. No network call is made, and nothing here is scored or ranked.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");

const { PUBLISH_MATCH_KINDS, decisionReason, isLinkShareable, parseLeafDocument } = await import(
  "@foliage/leaf"
).catch(explainFailedWorkspaceImport);
const { DEFAULT_DOCUMENT_PATH, DOCUMENT_ENV } = await import("./src/leafDocument.ts").catch(
  explainFailedWorkspaceImport,
);
const { LEAFLET_ROUTE } = await import("./src/render.ts").catch(explainFailedWorkspaceImport);
const { DEFAULT_POLICY_PATH, POLICY_ENV, describePolicySource, loadPublishPolicy } = await import(
  "./src/policyDocument.ts"
).catch(explainFailedWorkspaceImport);
const { addRule, dropRule, isMatchKind, publishRowsFromDocument, ruleFromExample } = await import(
  "./src/policy.ts"
).catch(explainFailedWorkspaceImport);

const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

const USAGE = `Leaf policy — the rules your leaflets are judged by before anything goes outward.

  node apps/leaf/policy.mjs <subcommand> [options]

Subcommands
  show [--policy <path>]
      Print every rule in force, in order, with the reason its author wrote — and say which
      document they came from. An absent policy file is not an error: it means the shipped
      default rules, and they are printed like any others.

  check [--leaf <path>] [--policy <path>]
      Judge every leaflet in your leaf against those rules and say what happens at its own
      address: served, withheld by a named rule, or not shared. Also lists what the policy
      would PROPOSE you share. A proposal is not permission — sharing stays \`share.mjs\`.

  deny <id> --by <fact> --because "<your words>" [--leaf <path>] [--policy <path>]
  allow <id> --by <fact> --because "<your words>" [--leaf <path>] [--policy <path>]
      Write a rule compiled from one of YOUR OWN leaflets. <id> names the example; --by names
      which fact of it the rule matches. The fact is read off that leaflet, so the rule can
      only ever name something already written in your document.

      --by is one of: ${PUBLISH_MATCH_KINDS.join(", ")}

      deny is absolute and is enforced at publish time, over your own share.
      allow only proposes a candidate; it publishes nothing.

  drop <rule-id> [--policy <path>]
      Remove one rule by its exact id. \`show\` prints the ids. This is the only direction that
      can make the policy looser, so it never matches by pattern.

The leaf defaults to ${DEFAULT_DOCUMENT_PATH} and honours ${DOCUMENT_ENV}.
The policy defaults to ${DEFAULT_POLICY_PATH} and honours ${POLICY_ENV};
--policy beats both. An absent policy file means the shipped defaults.
`;

/** @param {string} message @returns {never} */
function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`policy: ${message}\n`);
  process.exit(code);
}

/** @param {unknown} err @returns {string} */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {unknown} err @returns {string} */
function errnoOf(err) {
  return err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
}

/**
 * @param {string[]} args
 * @param {import("node:util").ParseArgsConfig["options"]} options
 * @param {boolean} allowPositionals
 * @returns {{values: Record<string, unknown>, positionals: string[]}}
 */
function parseOrUsage(args, options, allowPositionals = false) {
  try {
    const parsed = parseArgs({ args, options, strict: true, allowPositionals, tokens: true });
    const names = parsed.tokens.flatMap((token) => "name" in token ? [token.name] : []);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate !== undefined) throw new Error(`--${duplicate} given more than once`);
    return parsed;
  } catch (err) {
    process.stderr.write(`${messageOf(err)}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
}

/** @param {unknown} flag @returns {string} */
function leafPath(flag) {
  if (typeof flag === "string") {
    if (flag.trim() === "") fail(`--leaf was given an empty path.`, EXIT_USAGE);
    return flag.trim();
  }
  const configured = process.env[DOCUMENT_ENV];
  if (configured !== undefined && configured.trim() === "") {
    fail(
      `${DOCUMENT_ENV} is set but blank, so no leaf path could be determined. Either unset it — ` +
        `the default is then ${DEFAULT_DOCUMENT_PATH} — or pass --leaf <path>.`,
      EXIT_USAGE,
    );
  }
  return configured === undefined ? DEFAULT_DOCUMENT_PATH : configured.trim();
}

/**
 * The rules in force, or every reason there are none.
 *
 * The loader is SHARED WITH THE SERVER, deliberately: a CLI that resolved the policy its own way
 * would eventually disagree with the process that enforces it, and "the command said allowed and
 * the address 404s" is the worst bug this surface could have.
 *
 * @param {unknown} flag
 * @returns {Promise<{policy: import("@foliage/leaf").PublishPolicy, source: import("./src/policyDocument.ts").PolicySource}>}
 */
async function policyInForce(flag) {
  const load = await loadPublishPolicy(process.env, typeof flag === "string" ? flag : null);
  if (load.ok) return { policy: load.policy, source: load.source };
  process.stderr.write(`policy: ${load.detail}\n`);
  if (load.cause === "invalid") {
    for (const issue of load.issues) process.stderr.write(`policy:   ${issue.at}: ${issue.message}\n`);
  }
  process.exit(EXIT_FAILED);
}

/**
 * Where the rules will be written. Reading happens separately, under the write lock.
 *
 * @param {unknown} flag
 * @returns {string}
 */
function policyDestination(flag) {
  let path;
  if (typeof flag === "string") {
    if (flag.trim() === "") fail(`--policy was given an empty path.`, EXIT_USAGE);
    path = flag.trim();
  } else {
    const configured = process.env[POLICY_ENV];
    if (configured !== undefined && configured.trim() === "") {
      fail(
        `${POLICY_ENV} is set but blank, so no policy path could be determined. Either unset it ` +
          `— the default is then ${DEFAULT_POLICY_PATH} — or pass --policy <path>.`,
        EXIT_USAGE,
      );
    }
    path = configured === undefined ? DEFAULT_POLICY_PATH : configured.trim();
  }

  return path;
}

/** @param {unknown} flag */
async function policyFileToEdit(flag) {
  const path = policyDestination(flag);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") return { path, document: null };
    return fail(`${path} could not be read: ${messageOf(err)} [${code}]`);
  }
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  try {
    return { path, document: JSON.parse(text) };
  } catch (err) {
    return fail(`${path} is not valid JSON: ${messageOf(err)}`);
  }
}

// jscpd:ignore-start — the read-JSON / atomic-write-back / report-issues trio is identical to
// share.mjs's; historical duplication predating this gate, not retriaged here.
/** @param {string} path @returns {Promise<unknown>} */
async function readLeaf(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") {
      fail(`no leaf document at ${path}. Run \`node apps/leaf/intake.mjs\` first, or pass --leaf.`);
    }
    return fail(`${path} could not be read: ${messageOf(err)} [${code}]`);
  }
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  try {
    return JSON.parse(text);
  } catch (err) {
    return fail(`${path} is not valid JSON: ${messageOf(err)}`);
  }
}

/** @param {string} path @param {unknown} document @returns {Promise<void>} */
async function writeBack(path, document) {
  try { writeDocument(path, `${JSON.stringify(document, null, 2)}\n`); }
  catch (error) { fail(`could not write ${path}: ${messageOf(error)} [${errnoOf(error)}]`); }

}

/** @param {string} path @param {string} headline @param {readonly {at: string, message: string}[]} issues @returns {never} */
function failWithIssues(path, headline, issues) {
  process.stderr.write(`policy: ${path} ${headline}\n`);
  for (const issue of issues) process.stderr.write(`policy:   ${issue.at}: ${issue.message}\n`);
  process.exit(EXIT_FAILED);
}
// jscpd:ignore-end

/** One rule, printed the way it will be read: id, what it does, and why.
 * @param {import("@foliage/leaf").PublishRule} rule @param {number} index */
function printRule(rule, index) {
  process.stdout.write(`policy:   [${index}] ${rule.id}  ${rule.effect.toUpperCase()}\n`);
  process.stdout.write(`policy:        matches ${JSON.stringify(rule.match)}\n`);
  process.stdout.write(`policy:        ${rule.reason}\n`);
}

/* ------------------------------------------------------------------------------ show ---- */

/** @param {string[]} args */
async function show(args) {
  const { values } = parseOrUsage(args, { policy: { type: "string" } });
  const { policy, source } = await policyInForce(values["policy"]);

  process.stdout.write(`policy: ${policy.rules.length} rule(s) in force\n`);
  process.stdout.write(`policy: from ${describePolicySource(source)}\n`);
  const denies = policy.rules.filter((r) => r.effect === "deny").length;
  policy.rules.forEach(printRule);
  process.stdout.write(
    `policy: ${denies} deny (absolute, enforced at publish time, over your own share) and ` +
      `${policy.rules.length - denies} allow (proposes only; publishing stays your act).\n`,
  );
  if (source.kind === "default") {
    process.stdout.write(
      `policy: no policy document exists yet. \`deny\`/\`allow\` writes these rails plus your\n` +
        `policy: new rule to ${source.searched} — it never starts you from an empty file.\n`,
    );
  }
}

/* ----------------------------------------------------------------------------- check ---- */

/** @param {string[]} args */
async function check(args) {
  const { values } = parseOrUsage(args, { leaf: { type: "string" }, policy: { type: "string" } });
  const { policy, source } = await policyInForce(values["policy"]);
  const path = leafPath(values["leaf"]);
  const read = publishRowsFromDocument(await readLeaf(path), policy);
  if (!read.ok) failWithIssues(path, "is valid JSON but is not a leaf document:", read.issues);

  process.stdout.write(`policy: ${read.rows.length} leaflet(s) in ${path}\n`);
  process.stdout.write(`policy: judged by ${policy.rules.length} rule(s) from ${describePolicySource(source)}\n`);

  let served = 0;
  let withheld = 0;
  let candidates = 0;
  let unmatched = 0;
  for (const row of read.rows) {
    if (row.outward.kind === "served") {
      served += 1;
      process.stdout.write(`policy:   SERVED     ${row.id}  ${LEAFLET_ROUTE}${encodeURIComponent(row.id)}\n`);
      continue;
    }
    if (row.outward.kind === "withheld-by-rule") {
      withheld += 1;
      // THE RAIL BEAT THE PERSON. Named loudly, because this is the one case where the product
      // overrides its own subject and a quiet line would read like the share never happened.
      // A deny rule fires whether or not the leaflet is shared, so "you shared it" is said only
      // of a row that is; an unshared row is told what the rule will do if it ever is.
      const said = isLinkShareable(row.visibility)
        ? `you shared it; rule ${row.outward.rule.id} refuses it`
        : `stays private even if shared; rule ${row.outward.rule.id}`;
      process.stdout.write(`policy:   WITHHELD   ${row.id}  (${said})\n`);
      process.stdout.write(`policy:              ${row.outward.rule.reason}\n`);
      continue;
    }
    if (row.outward.candidate) candidates += 1;
    process.stdout.write(
      `policy:   ${row.outward.candidate ? "PROPOSED  " : "private   "} ${row.id}\n`,
    );
    // THE REASON IS PRINTED PER ROW ONLY WHEN IT IS THIS ROW'S OWN. `no-rule-matched` is one
    // sentence about the POLICY, not about the leaflet, and repeating it under all 58 rows of a
    // real portfolio buries the four rows that do say something — measured on a fresh intake of
    // this repository, where it printed the identical paragraph 58 times. It is said once, below.
    if (row.decision.outcome !== "denied" || row.decision.cause !== "no-rule-matched") {
      process.stdout.write(`policy:              ${decisionReason(row.decision)}\n`);
    } else {
      unmatched += 1;
    }
  }

  process.stdout.write(
    `policy: ${served} address(es) answer, ${withheld} withheld by a rule, ${candidates} proposed for you to share.\n`,
  );
  if (served === 0 && withheld === 0) {
    process.stdout.write(
      `policy: nothing is served, which is the correct state for a leaf nobody has shared —\n` +
        `policy: private is the default. \`share.mjs share <id>\` offers one outward.\n`,
    );
  }
  if (unmatched > 0) {
    process.stdout.write(
      `policy: ${unmatched} leaflet(s) matched NO rule at all and are withheld by the closed\n` +
        `policy: default — a policy proposes only what it explicitly allows, so a rule you have\n` +
        `policy: not written costs visibility rather than causing exposure.\n`,
    );
  }
  if (candidates === 0) {
    process.stdout.write(
      `policy: nothing is proposed. The default policy proposes only \`verified\` work, and a\n` +
        `policy: machine that can check no signature produces none — that is a fact about this\n` +
        `policy: machine, not about you. \`allow <id> --by tier\` widens it if you decide to.\n`,
    );
  }
}

/* ---------------------------------------------------------------------- deny / allow ---- */

/**
 * @param {string[]} args
 * @param {"deny" | "allow"} effect
 */
async function writeRule(args, effect) {
  const { values, positionals } = parseOrUsage(args, {
    leaf: { type: "string" },
    policy: { type: "string" },
    by: { type: "string" },
    because: { type: "string" },
  }, true);

  const id = positionals[0];
  if (id === undefined || id.trim() === "") {
    fail(`${effect} needs the id of a leaflet to use as the EXAMPLE. \`check\` prints them.`, EXIT_USAGE);
  }
  if (positionals.length > 1) {
    fail(
      `${effect} takes ONE id and got ${positionals.length}: ${positionals.join(", ")}. An id may ` +
        `contain characters your shell splits on — quote it.`,
      EXIT_USAGE,
    );
  }
  const by = typeof values["by"] === "string" ? values["by"].trim() : "";
  if (!isMatchKind(by)) {
    fail(
      `--by ${by === "" ? "(missing)" : by} is not a fact a rule can match. It is one of: ` +
        `${PUBLISH_MATCH_KINDS.join(", ")}. The vocabulary is closed on purpose — every kind ` +
        `names something already written in your document, so no rule can rest on an opinion.`,
      EXIT_USAGE,
    );
  }
  const because = typeof values["because"] === "string" ? values["because"].trim() : "";
  if (because === "") {
    fail(
      `--because is required: every rule carries the reason its author wrote, in their own ` +
        `words. The person on the other side of a "${effect}" is owed a sentence, not a rule id — ` +
        `and in six months that person is you.`,
      EXIT_USAGE,
    );
  }

  const leafAt = leafPath(values["leaf"]);
  return withDocumentLocks([leafAt, policyDestination(values["policy"])], async () => {
  // THE EXAMPLE IS A PARSED LEAFLET, not a row: the compiler reads FACTS off the document's own
  // object — its tier, its provenance, its body's refs — and a display row carries none of those.
  const parsed = parseLeafDocument(await readLeaf(leafAt));
  if (!parsed.ok) failWithIssues(leafAt, "is valid JSON but is not a leaf document:", parsed.issues);
  const example = parsed.leaf.leaflets.find((l) => l.id === id);
  if (example === undefined) {
    process.stderr.write(`policy: no leaflet "${id}" in ${leafAt}.\n`);
    process.stderr.write(`policy: ${parsed.leaf.leaflets.length} id(s) are in this document:\n`);
    for (const known of parsed.leaf.leaflets.slice(0, 10)) {
      process.stderr.write(`policy:   ${known.id}\n`);
    }
    if (parsed.leaf.leaflets.length > 10) {
      process.stderr.write(`policy:   … and ${parsed.leaf.leaflets.length - 10} more — \`check\` prints all.\n`);
    }
    process.exit(EXIT_FAILED);
  }

  const compiled = ruleFromExample(example, effect, by, because);
  if (!compiled.ok) {
    process.stderr.write(`policy: no rule was written — ${compiled.detail}\n`);
    if (compiled.cause === "ambiguous") {
      process.stderr.write(`policy: the candidates on this leaflet are:\n`);
      for (const candidate of compiled.candidates) process.stderr.write(`policy:   ${candidate}\n`);
    }
    process.exit(EXIT_FAILED);
  }

  const file = await policyFileToEdit(values["policy"]);
  const edit = addRule(file.document, compiled.rule);
  if (!edit.ok) {
    if (edit.cause === "duplicate-id") {
      fail(
        `${file.path} already holds a rule "${edit.id}". A rule id is derived from what the rule ` +
          `matches, so this exact rule is already in force — \`show\` prints it. Nothing was ` +
          `written.`,
      );
    }
    if (edit.cause === "not-a-policy") {
      failWithIssues(file.path, "is valid JSON but is not a publish policy:", edit.issues);
    }
    if (edit.cause === "would-not-parse") {
      failWithIssues(
        file.path,
        "was NOT written: the document this edit would produce is not one this product can " +
          "load. That is a bug here, and your file is unchanged:",
        edit.issues,
      );
    }
    fail(`no rule "${edit.id}" in ${file.path}.`);
  }

  await writeBack(file.path, edit.document);
  if (edit.seededDefaults) {
    // RAILS AND RULES ARE COUNTED SEPARATELY, because they are not the same promise: a deny is
    // enforced over the subject's own share and an allow only proposes. Printing one number for
    // both would tell them they had gained four safety rules when one of them publishes nothing.
    // COUNTED OVER THE SEEDED RULES ONLY — the subject's own rule is the last one and is not one
    // of them. Counting over the whole document reported "5 rails and 0 proposal" about a set that
    // is four rails and one proposal, which is a wrong claim about what protection they just got.
    const seededRules = edit.rules.slice(0, -1);
    const seeded = seededRules.length;
    const rails = seededRules.filter((r) => r.effect === "deny").length;
    process.stdout.write(
      `policy: ${file.path} did not exist, so the ${seeded} shipped default rule(s) — ${rails} rails\n` +
        `policy: and ${seeded - rails} proposal — were written alongside your rule. Starting you from an\n` +
        `policy: empty file would have meant adding one rule silently removed ${rails}.\n`,
    );
  }
  printRule(compiled.rule, edit.rules.length - 1);
  process.stdout.write(`policy: wrote ${file.path} — ${edit.rules.length} rule(s) now in force\n`);
  process.stdout.write(`policy: compiled from "${example.id}", which is the example you named\n`);
  if (effect === "deny") {
    process.stdout.write(
      `policy: this is a RAIL. It is evaluated every time something is asked for and it beats\n` +
        `policy: your own share — any leaflet it matches now answers as though nothing were there.\n` +
        `policy: \`check\` lists what changed.\n`,
    );
  } else {
    process.stdout.write(
      `policy: this PROPOSES only. Nothing became public: matching leaflets are now listed by\n` +
        `policy: \`check\` as candidates, and \`share.mjs share <id>\` is still the act that shares one.\n`,
    );
  }
  });

}

/* ------------------------------------------------------------------------------ drop ---- */

/** @param {string[]} args */
async function drop(args) {
  const { values, positionals } = parseOrUsage(args, { policy: { type: "string" } }, true);
  const ruleId = positionals[0];
  if (ruleId === undefined || ruleId.trim() === "") {
    fail(`drop needs the exact id of a rule. \`show\` prints them.`, EXIT_USAGE);
  }
  if (positionals.length > 1) fail(`drop takes ONE rule id. Quote an id containing spaces.`, EXIT_USAGE);

  return withDocumentLocks([policyDestination(values["policy"])], async () => {
  const file = await policyFileToEdit(values["policy"]);
  if (file.document === null) {
    fail(
      `there is no policy document at ${file.path}, so there is no rule to drop. The rules in ` +
        `force are the shipped defaults; \`show\` prints them, and a rule you disagree with is ` +
        `dropped by first writing a rule of your own (which materialises the file) and then ` +
        `dropping it.`,
    );
  }
  const edit = dropRule(file.document, ruleId.trim());
  if (!edit.ok) {
    if (edit.cause === "no-such-rule") {
      process.stderr.write(`policy: no rule "${edit.id}" in ${file.path}. These are the ids:\n`);
      for (const known of edit.known) process.stderr.write(`policy:   ${known}\n`);
      process.exit(EXIT_FAILED);
    }
    if (edit.cause === "not-a-policy") {
      failWithIssues(file.path, "is valid JSON but is not a publish policy:", edit.issues);
    }
    if (edit.cause === "duplicate-id") fail(`duplicate rule id: ${edit.id}; file unchanged.`);
    failWithIssues(
      file.path,
      "was NOT written: the document this edit would produce is not one this product can load. " +
        "That is a bug here, and your file is unchanged:",
      edit.issues,
    );
  }

  await writeBack(file.path, edit.document);
  process.stdout.write(`policy: dropped "${ruleId.trim()}" — ${edit.rules.length} rule(s) now in force\n`);
  process.stdout.write(`policy: wrote ${file.path}\n`);
  process.stdout.write(
    `policy: removing a rule is the one direction that makes this policy LOOSER. Run \`check\`\n` +
      `policy: and read what is served now.\n`,
  );
  });

}

/* ------------------------------------------------------------------------------ main ---- */

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "show":
    await show(rest);
    break;
  case "check":
    await check(rest);
    break;
  case "deny":
  case "allow":
    await writeRule(rest, /** @type {"deny" | "allow"} */ (subcommand));
    break;
  case "drop":
    await drop(rest);
    break;
  case undefined:
  case "--help":
  case "-h":
  case "help":
    process.stdout.write(USAGE);
    process.exit(subcommand === undefined ? EXIT_USAGE : 0);
  // eslint-disable-next-line no-fallthrough -- process.exit above is terminal.
  default:
    process.stderr.write(`policy: unknown subcommand "${subcommand}"\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
}
