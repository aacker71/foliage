import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseRows, parseVocabulary } from "./lib/parse.mjs";
import { checkCounts, checkDark, checkStaleness, checkStructure, undatedRows } from "./lib/checks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER = readFileSync(join(ROOT, ".loop/STATUS.md"), "utf8");

const HEADER =
  "| id | capability | plane | status | evidence / blocker | last verified |\n|---|---|---|---|---|---|\n";
const rowsOf = (body) => parseRows(HEADER + body).rows;

/** Facts the checks consume. Everything a caller does not state is stated as "unknown". */
const facts = ({ scope = { confidence: "unmapped", paths: [] }, changed = {}, tests = {} } = {}) => ({
  scopeOf: () => scope,
  changeOf: (p) => changed[p] ?? { day: null, committed: true },
  deriveTests: (target) => {
    const key = target.from === "suite" ? "suite" : target.paths.join(",");
    return tests[key] ?? { undeclared: `no expectation registered for ${key}` };
  },
});

// ---------------------------------------------------------------------------------------
// The real ledger, run through the real structural rules. This is the check that would have
// caught a reshaped or mistyped row on the day it landed.
// ---------------------------------------------------------------------------------------

test("REAL LEDGER: every row in .loop/STATUS.md is structurally sound", () => {
  const findings = checkStructure(parseRows(LEDGER).rows, parseVocabulary(LEDGER));
  assert.deepEqual(
    findings.map((x) => `${x.id}: ${x.summary}`),
    [],
    "a structural finding here is a real defect in the ledger, not a test to relax",
  );
});

test("REAL LEDGER: the rows carrying no date are exactly the ones asserting no verification", () => {
  const rows = parseRows(LEDGER).rows;
  const undated = new Set(undatedRows(rows));
  for (const row of rows) {
    const status = row.status.replace(/[`*_]/g, "").trim().toUpperCase();
    if (status === "DONE") {
      assert.ok(!undated.has(row.id), `${row.id} is DONE and must carry a verification date`);
    }
  }
});

// ---------------------------------------------------------------------------------------
// Deliberately malformed rows.
// ---------------------------------------------------------------------------------------

test("a deliberately malformed ledger fails on every distinct defect, each named", () => {
  const vocab = new Set(["DONE", "BUILT", "TODO"]);
  const rows = rowsOf(
    "| Z1 | short row | open | DONE | evidence |\n" +
      "| Z2 | undeclared status | open | SHIPPED | evidence | 2026-08-16 |\n" +
      "| Z3 | prose where a date goes | open | BUILT | evidence | soon |\n" +
      "| Z4 | strongest claim, never verified | open | DONE | evidence | — |\n" +
      "| Z2 | a duplicated id | open | BUILT | evidence | 2026-08-16 |\n" +
      "| nope | not an id | open | TODO | evidence | — |\n",
  );
  const summaries = checkStructure(rows, vocab).map((x) => `${x.id} ${x.summary}`);
  assert.equal(checkStructure(rows, vocab).every((x) => x.level === "fail"), true, "format defects are failures");
  assert.match(summaries.join("\n"), /Z1 row has 5 cells/);
  assert.match(summaries.join("\n"), /Z2 status "SHIPPED" is not in the declared vocabulary/);
  assert.match(summaries.join("\n"), /Z3 "last verified" is neither a date nor an explicit em-dash/);
  assert.match(summaries.join("\n"), /Z4 DONE with no verification date/);
  assert.match(summaries.join("\n"), /Z2 duplicate row id/);
  assert.match(summaries.join("\n"), /nope row id "nope" is not an id/);
});

test("an absent vocabulary is a failure, not permission for any status", () => {
  const findings = checkStructure(rowsOf("| Z1 | a | open | ANYTHING | e | — |\n"), new Set());
  assert.equal(findings[0].level, "fail");
  assert.match(findings[0].summary, /declares no status vocabulary/);
});

// ---------------------------------------------------------------------------------------
// Table integrity: an unreadable line inside a table, and the floor under the row count.
// Both exist because the parser used to lose rows in silence, which is a gate disabling
// itself — the worst outcome available to it.
// ---------------------------------------------------------------------------------------

const vocab3 = new Set(["DONE", "BUILT", "TODO"]);

test("a line inside a capability table that is not a row FAILS, and names the line", () => {
  const findings = checkStructure([], vocab3, { strays: [{ line: 16, text: "<!-- moved -->" }] });
  assert.equal(findings[0].level, "fail");
  assert.match(findings[0].summary, /a line inside a capability table is not a row/);
  assert.equal(findings[0].line, 16, "the finding must point at the line a human has to edit");
  assert.match(findings[0].detail.join(" "), /<!-- moved -->/);
});

test("FLOOR: a collapse in row count against the last committed ledger FAILS and names the ids", () => {
  const previousRows = rowsOf(
    "| Z1 | a | open | DONE | e | 2026-08-16 |\n" +
      "| Z2 | b | open | DONE | e | 2026-08-16 |\n" +
      "| Z3 | c | open | DONE | e | 2026-08-16 |\n",
  );
  const findings = checkStructure(rowsOf("| Z1 | a | open | DONE | e | 2026-08-16 |\n"), vocab3, { previousRows });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "fail");
  assert.match(findings[0].summary, /2 row\(s\) present in the last committed ledger are gone: Z2 Z3/);
});

test("FLOOR: a single deliberate deletion WARNS — the gate must not go red on legitimate editing", () => {
  const previousRows = rowsOf(
    "| Z1 | a | open | DONE | e | 2026-08-16 |\n" +
      "| Z2 | b | open | DONE | e | 2026-08-16 |\n" +
      "| Z3 | c | open | DONE | e | 2026-08-16 |\n",
  );
  const rows = rowsOf(
    "| Z1 | a | open | DONE | e | 2026-08-16 |\n" + "| Z2 | b | open | DONE | e | 2026-08-16 |\n",
  );
  const findings = checkStructure(rows, vocab3, { previousRows });
  assert.equal(findings[0].level, "warn");
  assert.match(findings[0].summary, /are gone: Z3/);
});

test("FALSE-POSITIVE CONTROL: a ledger that GREW, or that has no committed predecessor, is silent", () => {
  const previousRows = rowsOf("| Z1 | a | open | DONE | e | 2026-08-16 |\n");
  const grown = rowsOf(
    "| Z1 | a | open | DONE | e | 2026-08-16 |\n" + "| Z2 | b | open | DONE | e | 2026-08-16 |\n",
  );
  assert.deepEqual(checkStructure(grown, vocab3, { previousRows }), [], "the ledger normally grows");
  assert.deepEqual(checkStructure(grown, vocab3, { previousRows: null }), [], "no predecessor, nothing to compare");
});

// ---------------------------------------------------------------------------------------
// Staleness — a deliberately stale row, and the rows that are legitimately current.
// ---------------------------------------------------------------------------------------

const staleRow = (status) =>
  rowsOf(`| Z1 | \`@foliage/leaf\` — a capability | open | ${status} | evidence | 2026-08-13 |\n`);

test("a deliberately STALE DONE row with a named scope FAILS — DONE needs the freshest evidence", () => {
  const findings = checkStaleness(
    staleRow("DONE"),
    facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
    }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "fail");
  assert.match(findings[0].summary, /STALE — DONE last verified 2026-08-13, but packages\/leaf changed 2026-08-16/);
});

test("the same staleness on a weaker claim WARNS — a warning that never fails is what keeps this gate alive", () => {
  for (const status of ["BUILT", "PARTIAL", "DARK"]) {
    const findings = checkStaleness(
      staleRow(status),
      facts({
        scope: { confidence: "named", paths: ["packages/leaf"] },
        changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
      }),
    );
    assert.equal(findings[0].level, "warn", `${status} is weaker than DONE and must warn, not fail`);
  }
});

test("an INFERRED scope can only warn, however strong the claim — a guessed scope must not go red", () => {
  const findings = checkStaleness(
    staleRow("DONE"),
    facts({
      scope: { confidence: "inferred", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
    }),
  );
  assert.equal(findings[0].level, "warn");
  assert.match(findings[0].detail.join(" "), /inferred/);
});

test("FALSE-POSITIVE CONTROL: a row verified the same day its code changed is NOT stale", () => {
  // The ledger records days, not hours. Calling this stale would invent an ordering the
  // ledger does not contain — and inventing orderings is how a gate starts crying wolf.
  const findings = checkStaleness(
    rowsOf("| Z1 | `@foliage/leaf` — a capability | open | DONE | evidence | 2026-08-16 |\n"),
    facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
    }),
  );
  assert.deepEqual(findings, [], "same-day is not provably-after");
});

test("FALSE-POSITIVE CONTROL: a row verified AFTER its code last changed is silent", () => {
  const findings = checkStaleness(
    rowsOf("| Z1 | `@foliage/leaf` — a capability | open | DONE | evidence | 2026-08-17 |\n"),
    facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-13", committed: true } },
    }),
  );
  assert.deepEqual(findings, []);
});

test("a row with no date is not checked for staleness at all — there is nothing to compare", () => {
  const findings = checkStaleness(
    rowsOf("| Z1 | `@foliage/leaf` — a capability | open | TODO | not started | — |\n"),
    facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
    }),
  );
  assert.deepEqual(findings, []);
});

test("UNMAPPED renders as its own outcome and never as a pass", () => {
  const findings = checkStaleness(staleRow("DONE"), facts());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "info");
  assert.match(findings[0].summary, /UNMAPPED/);
  assert.match(findings[0].summary, /NOT checked/);
  assert.ok(
    !findings[0].summary.includes("verified"),
    "'unmapped' and 'verified' are different words and must render differently",
  );
});

test("BLOCKING REGRESSION: a shallow clone REFUSES the staleness check instead of failing every row", () => {
  // `git log -1 --format=%cI -- <path>` answers with the TIP commit's date for every path in a
  // `--depth 1` clone, so every dated row reports STALE. Measured on a correct three-row
  // ledger: full clone clean, `git clone --depth 1` three failures. actions/checkout defaults
  // to depth 1 and this repo has been bitten by that default once already.
  const shallow = {
    ...facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      changed: { "packages/leaf": { day: "2026-08-16", committed: true } },
    }),
    history: { complete: false, reason: "the clone is SHALLOW", remedy: "use `fetch-depth: 0`" },
  };
  const findings = checkStaleness(staleRow("DONE"), shallow);
  assert.equal(findings.length, 1, "one refusal, not one finding per row");
  assert.equal(findings[0].level, "warn", "the ledger is not wrong — the checkout is too thin");
  assert.match(findings[0].summary, /STALENESS NOT CHECKED/);
  assert.match(findings[0].detail.join(" "), /fetch-depth: 0/, "the refusal must say what to do about it");
  assert.ok(
    !findings.some((x) => x.summary.startsWith("STALE —")),
    "not one row may be called stale on evidence that cannot support it",
  );
});

test("a scope with no commits is reported — a claim about code nobody else can obtain", () => {
  const findings = checkStaleness(
    rowsOf("| Z1 | `@foliage/photosynthesis` — a capability | open | DONE | evidence | 2026-08-17 |\n"),
    facts({
      scope: { confidence: "named", paths: ["packages/photosynthesis"] },
      changed: { "packages/photosynthesis": { day: "2026-08-17", committed: false } },
    }),
  );
  assert.equal(findings.length, 1, "not stale — but not in git either");
  assert.equal(findings[0].level, "warn");
  assert.match(findings[0].summary, /scope is not in git/);
});

// ---------------------------------------------------------------------------------------
// Counts.
// ---------------------------------------------------------------------------------------

const countRow = (evidence) => rowsOf(`| Z1 | a capability | open | DONE | ${evidence} | 2026-08-17 |\n`);

test("an unanchored count that disagrees with the tree FAILS, and both numbers are printed", () => {
  const { findings } = checkCounts(
    countRow("`pnpm check` **146/146, boundary intact**"),
    facts({ tests: { suite: { count: 402 } } }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "fail");
  assert.match(findings[0].summary, /row claims "146\/146"; the whole suite derives 402/);
});

test("the same disagreement, ANCHORED to a run id, warns instead — and is still printed in full", () => {
  const { findings } = checkCounts(
    countRow("First-ever Actions run **31923591713**: both jobs green — 167 tests"),
    facts({
      scope: { confidence: "named", paths: ["packages/leaf"] },
      tests: { "packages/leaf": { count: 402 } },
    }),
  );
  assert.equal(findings[0].level, "warn", "a number tied to a past run is plausibly a historical record");
  assert.match(findings[0].summary, /row claims "167 tests"; packages\/leaf derives 402/);
});

test("a number the row ITSELF reports as wrong warns rather than fails — recording the defect is the point", () => {
  const { findings } = checkCounts(
    countRow('**Ledger audit: "44/44 tests" is wrong, and always was.** `node --test tools/vault/lib/*.test.mjs` → **21/21**'),
    facts({ tests: { "tools/vault/lib": { count: 21 } } }),
  );
  assert.equal(findings.length, 1, "21/21 agrees and is silent; only the corrected 44 is reported");
  assert.equal(findings[0].level, "warn");
  assert.match(findings[0].summary, /"44\/44"; tools\/vault\/lib derives 21/);
});

test("FALSE-POSITIVE CONTROL: a count that agrees produces no finding and is reported as agreed", () => {
  const { findings, agreed } = checkCounts(
    rowsOf("| Z1 | `@foliage/canopy` — trees | cloud | BUILT | 5 tests pass | 2026-08-13 |\n"),
    facts({ scope: { confidence: "named", paths: ["packages/canopy"] }, tests: { "packages/canopy": { count: 5 } } }),
  );
  assert.deepEqual(findings, []);
  assert.deepEqual(agreed, [{ id: "Z1", text: "5 tests", where: "packages/canopy" }]);
});

test("NEVER GUESS: a count that cannot be re-derived is reported as un-derivable, with no number attached", () => {
  const { findings } = checkCounts(countRow("→ 127 nodes / 746 edges in 119ms"), facts());
  assert.equal(findings.length, 2);
  for (const x of findings) {
    assert.equal(x.level, "info");
    assert.match(x.summary, /is not re-derivable by this gate/);
    assert.ok(!/derives \d/.test(x.summary), "no derived number may be asserted for a count it cannot compute");
  }
});

test("BLOCKING REGRESSION: an UNMAPPED row gets no count asserted against it", () => {
  // A row reading "the narrow rules are covered by 4 tests that pass" is a true sentence about
  // a subset. Defaulting its target to the whole suite produced a hard FAIL — "row claims 4
  // tests; the whole suite derives 5" — in the same run that listed the row under UNMAPPED.
  // Asserting a derived figure for a scope the gate just said it could not resolve is the
  // copied-number defect this gate exists to catch, wearing the gate's own badge.
  const { findings } = checkCounts(
    countRow("the narrow rules are covered by 4 tests that pass"),
    facts({ scope: { confidence: "unmapped", paths: [] }, tests: { suite: { count: 5 } } }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "info");
  assert.match(findings[0].summary, /is not compared — the row's scope is UNMAPPED/);
  assert.ok(!/derives \d/.test(findings[0].summary), "no number may be asserted against an unresolved scope");
});

test("an INFERRED scope caps the count finding at WARN, on the same rule staleness uses", () => {
  const { findings } = checkCounts(
    countRow("6 tests pass"),
    facts({ scope: { confidence: "inferred", paths: ["packages/leaf"] }, tests: { "packages/leaf": { count: 9 } } }),
  );
  assert.equal(findings[0].level, "warn", "a guessed scope must never go red");
  assert.match(findings[0].summary, /row claims "6 tests"; packages\/leaf derives 9/);
  assert.match(findings[0].detail.join(" "), /INFERRED/);
});

test("REGRESSION: a delta count is listed, never compared against a total", () => {
  const { findings } = checkCounts(
    countRow("this change adds 2 tests on top of what was there"),
    facts({ scope: { confidence: "named", paths: ["packages/alpha"] }, tests: { "packages/alpha": { count: 3 } } }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "info");
  assert.match(findings[0].summary, /reads as a delta, not a total/);
  assert.ok(!/derives \d/.test(findings[0].summary), "a delta and a total are not comparable quantities");
});

test("a refusal from the deriver becomes an INFO with the reason, never a comparison", () => {
  const { findings } = checkCounts(
    countRow("`pnpm check` 143/143"),
    { ...facts(), deriveTests: () => ({ undeclared: "static counting is unsafe in 1 file(s)" }) },
  );
  assert.equal(findings[0].level, "info");
  assert.match(findings[0].detail.join(" "), /static counting is unsafe/);
  assert.match(findings[0].detail.join(" "), /No number is asserted/);
});

// ---------------------------------------------------------------------------------------
// Dark detection.
// ---------------------------------------------------------------------------------------

const darkRows = (status) =>
  rowsOf(`| Z1 | \`@foliage/photosynthesis-enterprise\` — governed release | enterprise | ${status} | evidence | 2026-08-17 |\n`);

test("a package with no non-test consumer, whose row says DARK, is recorded as correct — not flagged", () => {
  const findings = checkDark(darkRows("DARK"), [
    { name: "@foliage/photosynthesis-enterprise", isApp: false, consumers: [] },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "info", "the check ran and agreed; that is worth seeing, not worth failing");
});

test("the P3 case: the same package reading BUILT is reported, and reading DONE fails", () => {
  const built = checkDark(darkRows("BUILT"), [{ name: "@foliage/photosynthesis-enterprise", isApp: false, consumers: [] }]);
  assert.equal(built[0].level, "warn");
  assert.match(built[0].summary, /no non-test consumer, but the row reads BUILT/);

  const done = checkDark(darkRows("DONE"), [{ name: "@foliage/photosynthesis-enterprise", isApp: false, consumers: [] }]);
  assert.equal(done[0].level, "fail", "DONE means a user can use it; nothing can reach it");
});

test("FALSE-POSITIVE CONTROL: a package with any non-test consumer is not dark, and an app is never dark", () => {
  const findings = checkDark(darkRows("BUILT"), [
    { name: "@foliage/tokens", isApp: false, consumers: ["apps/leaf/package.json"] },
    { name: "@foliage/leaf-app", isApp: true, consumers: [] },
  ]);
  assert.deepEqual(findings, [], "an app is an entry point; nothing importing it is the correct state");
});

test("FALSE-POSITIVE CONTROL: a package declaring a `bin` is an entry point, not a dark package", () => {
  // A CLI is invoked, not imported. Before this, a command-line package with a correct DONE row
  // produced "has no non-test consumer, but the row reads DONE" — a hard failure on a package
  // a user can literally run.
  const findings = checkDark(darkRows("DONE"), [
    { name: "@foliage/photosynthesis-enterprise", isApp: false, hasBin: true, consumers: [] },
  ]);
  assert.deepEqual(findings, [], "an importer is not what makes a CLI reachable");
});

test("a package with no consumer AND no ledger row is invisible to the source of truth", () => {
  const findings = checkDark([], [{ name: "@foliage/orphan", isApp: false, consumers: [] }]);
  assert.equal(findings[0].level, "warn");
  assert.match(findings[0].summary, /no non-test consumer and no ledger row/);
});
