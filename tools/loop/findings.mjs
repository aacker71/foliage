#!/usr/bin/env node
/**
 * THE RATCHET. Refuses the claim that a defect is fixed unless a test would catch its return.
 *
 * WHY THIS EXISTS. Three blocking defects were found on 2026-08-19 by adversarial review. Two of
 * them had already been DOCUMENTED by the code that carried them — one under a heading arguing the
 * bypass was correct, one labelled "KNOWN SEAM MISMATCH" in the function that shipped it. So the
 * failure mode is not ignorance. It is that a comment costs nothing and stops nothing, and the
 * person who writes it has already felt the satisfaction of dealing with the problem.
 *
 * This tool spends that satisfaction differently: a finding is `guarded` only when it names a test
 * file that EXISTS, and this refuses the file if it does not. It cannot prove the test would
 * actually fail without the fix — nothing static can, and pretending otherwise would make this the
 * next comment-shaped reassurance. What it CAN do is make the absence of a guard impossible to
 * leave unstated, which is the whole distance between F-003 sitting in a docstring and F-003
 * sitting in a gate.
 *
 *   node tools/loop/findings.mjs            # the gate: exit 1 if any finding is unguarded
 *   node tools/loop/findings.mjs --select   # what the loop should work next, and why
 *
 * IT DOES NOT WRITE. Same discipline as tools/launch/status.mjs: rows are edited by whoever did
 * the work and can defend the claim. A tool that closed its own findings would manufacture exactly
 * the unearned confidence it exists to catch.
 */

import { realpathSync } from "node:fs";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER = resolve(REPO, ".loop/FINDINGS.md");

const BOLD = "[1m";
const DIM = "[2m";
const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const OFF = "[0m";

/** Debt order. `open` first: a known defect in shipped code outranks an unstarted capability. */
const ORDER = ["open", "unguarded", "wontfix", "guarded"];

/**
 * Parse the table. Deliberately strict about the column count rather than forgiving: a row that
 * lost a cell is a row whose `status` and `guard` have silently shifted one place left, and a
 * lenient parser would report it as guarded by whatever landed in that column.
 */
export function parseFindings(md) {
  const rows = [];
  const problems = [];
  for (const [i, line] of md.split("\n").entries()) {
    if (!/^\|\s*F-\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 6) {
      problems.push(`${LEDGER}:${i + 1} — expected 6 cells, found ${cells.length}`);
      continue;
    }
    /* Statuses are written `guarded` in the table so the file reads as markdown rather than as
       machine input. The ledger is for people first; the parser adapts, not the other way round. */
    const [id, date, severity, what, statusCell, guard] = cells;
    const status = statusCell.replace(/[`*]/g, "").trim();
    if (!ORDER.includes(status)) {
      problems.push(`${LEDGER}:${i + 1} — ${id}: unknown status "${status}"`);
      continue;
    }
    rows.push({ id, date, severity, what, status, guard, line: i + 1 });
  }

  /*
   * ONE ID, ONE FINDING — checked, because it was not, and the ledger is in the middle of paying
   * for that right now.
   *
   * MEASURED 2026-09-04: open PR #22 (branch `c1-export-site-row`, 2026-09-01) carries rows
   * F-028 through F-034, and `main` carries F-028 through F-033 written between 2026-09-03 and
   * 2026-09-04. SIX IDS MEAN TWO DIFFERENT DEFECTS EACH — F-028 is both "the probe's colour parser
   * reports false red on oklch" and "the public canopy prints a false sentence about a named
   * person", and so on through F-033. Nobody was careless: every author checked the highest id in
   * the ledger on their own branch, which is the only thing this tool could see.
   *
   * That is the gap. The parser accepted duplicates silently, so `--select` would offer one of
   * them and the other would be invisible; a `guarded` row could sit beside an `open` row wearing
   * the same name, and "no ledger row may read DONE while a finding against it is open" becomes
   * unanswerable. A ledger whose keys are not unique is not a ledger.
   *
   * This cannot catch an id reserved in an UNMERGED branch — nothing reading one working tree can.
   * What it catches is the moment two of them meet, which is the moment it still costs a conflict
   * to fix rather than a silent wrong answer months later. Allocate against
   * `gh pr list --state open` too; the ledger's own prose says so beside the status vocabulary.
   */
  const seen = new Map();
  for (const row of rows) {
    const first = seen.get(row.id);
    if (first !== undefined) {
      problems.push(
        `${LEDGER}:${row.line} — ${row.id} is already used at line ${first}. One id, one finding: ` +
          `two rows sharing a name make every status and guard about them ambiguous. If this ` +
          `arrived by merging a branch that allocated ids independently, renumber ONE side and ` +
          `move every reference with it.`,
      );
      continue;
    }
    seen.set(row.id, row.line);
  }

  return { rows, problems };
}

/**
 * Is this file the process's entry point, rather than an import?
 *
 * REALPATHS ON BOTH SIDES, because comparing the raw strings is wrong wherever a symlink is in the
 * path — which on macOS is anything under `/tmp`, where `/var/folders/…` and `/private/var/folders/…`
 * name the same file. The first version compared `process.argv[1]` to `fileURLToPath(import.meta.url)`
 * directly; the end-to-end test that runs this script from a temporary directory caught it
 * immediately, because the guard silently answered false and the whole CLI never ran — a script
 * that exits 0 having done nothing, which is the worst possible failure for a gate.
 */
function isEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * Does a malformed ledger refuse to answer? Trivial by design — the POINT is that it is called
 * before the flags are read, and a function is the only shape of that fact a test can hold.
 *
 * The check first shipped at the BOTTOM of this file, past `--select`'s early return, so a
 * duplicate id refused the gate and let `--select` hand back a row from the same corrupt file.
 * Hoisting it fixed that, and a hoist is invisible to every test in this repository: revert it and
 * the parser suite still passes 7 of 7, because the parser is not what broke. The proof lived in a
 * commit message, which this file's own test docstring names as the shape the ledger exists to
 * refuse — true when written, and nothing notices when it stops being.
 *
 * So the decision is data. `findingsCliPlan` states the whole order of operations as a value, the
 * CLI below does what it says, and the test asserts that a malformed ledger yields `refuse`
 * WHATEVER the flags are. That assertion fails if the refusal is ever moved back behind a flag.
 */
export function refusesToAnswer({ problems }) {
  return problems.length > 0;
}

/**
 * What the CLI does, in order, as a value rather than as control flow spread down the file.
 * `refuse` outranks everything: a ledger that cannot be parsed has no answer to give, and
 * `--select` is not an exception to that — it is the caller most likely to act unattended on one.
 */
export function findingsCliPlan({ problems, select }) {
  if (refusesToAnswer({ problems })) return "refuse";
  return select ? "select" : "gate";
}

/** A guard cell names a real file, or it names nothing. `—` and prose both count as nothing. */
async function guardExists(guard) {
  const path = guard.match(/`?([\w./-]+\.(?:test\.ts|test\.mjs))`?/)?.[1];
  if (path === undefined) return { named: false, path: null, exists: false };
  try {
    await access(resolve(REPO, path));
    return { named: true, path, exists: true };
  } catch {
    return { named: true, path, exists: false };
  }
}

/*
 * THE CLI RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT, so `parseFindings` can be imported and
 * tested against strings instead of against the one real ledger. Before this guard the module read
 * the ledger and called `process.exit` at import time, which is why the parser had no test: the
 * only way to exercise it was to mutate the live file and spawn a subprocess, and a test that
 * edits `.loop/FINDINGS.md` to prove a point is a test nobody should run twice.
 */
if (isEntryPoint()) {
const md = await readFile(LEDGER, "utf8").catch(() => null);
if (md === null) {
  console.error(`findings: ${LEDGER} does not exist. The ratchet has nothing to hold.`);
  process.exit(1);
}

const { rows, problems } = parseFindings(md);

/*
 * THE CLI ASKS `findingsCliPlan` WHAT TO DO. It does not decide for itself, and that sentence is
 * the whole point of the previous two rounds.
 *
 * Round one of this fix put the malformed-ledger refusal at the BOTTOM of the file, past
 * `--select`'s early return: a duplicate id refused the gate (exit 1) while `--select` — the
 * interface this file's header calls "what the loop should work next", the one tooling invokes
 * unattended — answered exit 0 and handed back a row from the same corrupt file.
 *
 * Round two hoisted the check and extracted `findingsCliPlan` so a test could hold the ordering.
 * But the CLI still hand-rolled the same branching inline, so the plan was DECORATION: a reviewer
 * deleted the refusal from this block, left the function untouched, and reproduced the original
 * bug at runtime while all ten tests passed. A test that guards a function nothing calls guards
 * nothing.
 *
 * So the plan is now load-bearing. Change `findingsCliPlan` and this CLI changes with it, which
 * is what makes the test about the plan a test about the product.
 */
const select = process.argv.includes("--select");
const plan = findingsCliPlan({ problems, select });

if (plan === "refuse") {
  console.error(`${RED}findings: the ledger cannot be read as a ledger.${OFF}`);
  for (const p of problems) console.error(`${RED}✗ ${p}${OFF}`);
  console.error(
    `\nNo answer is offered from a malformed ledger — not the gate's, and not ${BOLD}--select${OFF}'s. ` +
      `A row with shifted columns reports a guard it does not have, and two rows sharing an id make ` +
      `every status about them ambiguous.`,
  );
  process.exit(1);
}

const checked = [];
for (const r of rows) checked.push({ ...r, guard: await guardExists(r.guard), guardText: r.guard });

if (plan === "select") {
  /* What the loop works next. Sorted by debt order, then by id, so the answer is stable across
     runs — a selector that returned a different row each time would make the cursor meaningless. */
  const next = checked
    .filter((r) => r.status === "open" || r.status === "unguarded")
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.id.localeCompare(b.id))[0];
  if (next === undefined) {
    console.log("findings: nothing open or unguarded. SELECT may take the ledger's own priority order.");
    process.exit(0);
  }
  console.log(`${BOLD}${next.id}${OFF} (${next.status}, ${next.severity}) — work this before a new capability`);
  console.log(`  ${next.what}`);
  console.log(
    next.status === "unguarded"
      ? `  ${YELLOW}owed: a test that fails when the fix is reverted${OFF}`
      : `  ${YELLOW}owed: the fix, and then the test${OFF}`,
  );
  process.exit(0);
}

/* WHAT FAILS THE BUILD, AND WHY `open` DOES NOT.
 *
 * An `open` finding is a known defect in shipped code, which sounds like the most build-breaking
 * thing here. It is deliberately NOT, because of what a red build does to the person holding it: a
 * gate that stays red until every known defect is fixed teaches people to stop recording findings,
 * and a findings ledger nobody writes to is worse than no ledger at all. `open` is tracked work —
 * it is what `--select` hands the loop, and what keeps a row off DONE.
 *
 * `unguarded` fails, because it is the state that rots silently: the fix is in, the pressure is
 * off, and nothing will notice when it comes back. That is the exact shape of all three findings
 * in this file — each was known, each was written down, and two were re-broken or shipped anyway.
 * A `guarded` claim naming a test that does not exist fails for the same reason, louder: it is a
 * false statement about a safety property. */
let failed = 0;
let openCount = 0;
console.log(`${BOLD}findings — the ratchet${OFF}  ${DIM}${rows.length} recorded${OFF}\n`);
for (const r of checked) {
  if (r.status === "open") openCount++;
  const bad = (r.status === "guarded" && !r.guard.exists) || r.status === "unguarded";
  if (bad) failed++;
  const mark = bad ? `${RED}✗${OFF}` : `${GREEN}✓${OFF}`;
  console.log(`${mark} ${r.id}  ${r.status.padEnd(10)} ${r.severity}`);
  if (r.status === "guarded" && !r.guard.exists) {
    console.log(
      `    ${RED}claims guarded, but ${r.guard.named ? `${r.guard.path} does not exist` : "names no test file"}${OFF}`,
    );
  } else if (r.status === "guarded") {
    console.log(`    ${DIM}guarded by ${r.guard.path}${OFF}`);
  } else if (r.status === "unguarded") {
    console.log(`    ${RED}fixed with nothing stopping its return${OFF}`);
  } else if (r.status === "open") {
    console.log(`    ${RED}not fixed${OFF}`);
  }
}

console.log();
if (openCount > 0) {
  console.log(
    `${YELLOW}${openCount} open finding(s).${OFF} Not a build failure — they are tracked work. But no ` +
      `ledger row they touch may read DONE, and SELECT takes one before a new capability: ` +
      `${BOLD}node tools/loop/findings.mjs --select${OFF}`,
  );
}
if (failed > 0) {
  console.log(
    `${RED}${failed} finding(s) fixed with nothing guarding them.${OFF} A fix with no test is a ` +
      `regression with a delay. Name a test that fails when the fix is reverted.`,
  );
  process.exit(1);
}
console.log(`${GREEN}every fixed finding names a test that exists.${OFF}`);
}
