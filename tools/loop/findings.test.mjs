/**
 * THE RATCHET'S OWN PARSER, tested against strings.
 *
 * `check:findings` runs `findings.mjs` over the one real ledger, which has no duplicate ids, no
 * short rows and no unknown statuses — so that gate step can never exercise a single one of the
 * refusals below. Every one of them was previously proved only by editing `.loop/FINDINGS.md` by
 * hand, watching the exit code, and putting the result in a commit message. A proof that lives in
 * a commit message is the exact shape this ledger exists to refuse: it was true when written and
 * nothing notices when it stops being.
 *
 * The parser is imported rather than spawned, which is why `findings.mjs` now guards its CLI
 * behind an entry-point check. A test that mutates the live ledger to prove a point about the
 * ledger is a test nobody should run twice.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { findingsCliPlan, parseFindings, refusesToAnswer } from "./findings.mjs";

/** A well-formed row. Six cells, exactly as the real file writes them. */
const row = (id, status = "open", guard = "—") =>
  `| ${id} | 2026-09-04 | should-fix | **A defect.** Described at length. | \`${status}\` | ${guard} |`;

const HEADER = "| id | date | severity | what | status | guard |\n|---|---|---|---|---|---|\n";

test("a clean table parses, and every row is returned in file order", () => {
  const { rows, problems } = parseFindings(HEADER + [row("F-001"), row("F-002")].join("\n"));
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.id), ["F-001", "F-002"]);
});

test("ONE ID, ONE FINDING — a duplicate is refused, and both lines are named", () => {
  /*
   * The refusal that matters, and the one the live gate cannot reach. MEASURED 2026-09-04: open PR
   * #22 carries rows F-028..F-034 and `main` carries F-028..F-033, six ids meaning two entirely
   * different defects each. Nobody was careless — every author checked the highest id in the
   * ledger on their own branch, which is all this tool can see. What it CAN see is the moment two
   * of them meet in one tree, which is while it still costs a merge conflict instead of a silent
   * wrong answer: two rows sharing a name make every `status` and `guard` about them ambiguous,
   * and `--select` would offer one while the other stayed invisible.
   */
  const { rows, problems } = parseFindings(
    HEADER + [row("F-028"), row("F-029"), row("F-028", "guarded", "`x.test.ts`")].join("\n"),
  );
  assert.equal(problems.length, 1, `expected exactly one complaint, got ${problems.length}`);
  // The complaint is filed AT the duplicate (line 5) and points BACK to the first use (line 3),
  // so a reader lands on the row to renumber and is told what it collides with.
  assert.match(problems[0], /:5 — F-028 is already used at line 3\./);
  assert.match(problems[0], /One id, one finding/);
  // The rows themselves are still returned — the parser reports, it does not silently drop work.
  assert.deepEqual(rows.map((r) => r.id), ["F-028", "F-029", "F-028"]);
});

test("three ids used twice each are three complaints, not one summary", () => {
  const dupes = ["F-030", "F-031", "F-032"];
  const { problems } = parseFindings(
    HEADER + [...dupes.map((d) => row(d)), ...dupes.map((d) => row(d))].join("\n"),
  );
  assert.equal(problems.length, 3);
  for (const d of dupes) {
    assert.ok(
      problems.some((p) => p.includes(`${d} is already used`)),
      `${d} collided and was not reported`,
    );
  }
});

test("a row that lost a cell is refused rather than read with its columns shifted", () => {
  /*
   * The parser's own header says why: "a row that lost a cell is a row whose `status` and `guard`
   * have silently shifted one place left, and a lenient parser would report it as guarded by
   * whatever landed in that column." That is a false claim about a safety property, which is worse
   * than a parse error. This is also not hypothetical — writing a markdown table INTO a row's prose
   * has broken the real ledger twice, once with a grep alternation containing a pipe.
   */
  const { rows, problems } = parseFindings(HEADER + "| F-040 | 2026-09-04 | blocking |\n");
  assert.deepEqual(rows, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expected 6 cells, found 3/);
});

test("an unknown status is refused, because the four are the whole vocabulary", () => {
  const { rows, problems } = parseFindings(HEADER + row("F-041", "done"));
  assert.deepEqual(rows, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown status "done"/);
});

test("every status the ledger defines is accepted", () => {
  const { rows, problems } = parseFindings(
    HEADER +
      ["open", "guarded", "unguarded", "wontfix"]
        .map((s, i) => row(`F-05${i}`, s))
        .join("\n"),
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.status), ["open", "guarded", "unguarded", "wontfix"]);
});

test("prose that merely mentions an id is not mistaken for a row", () => {
  // The ledger's own text discusses ids constantly. Only a line that BEGINS a table row counts —
  // which is why the comparison table in that prose has to backtick its ids, and says so.
  const { rows, problems } = parseFindings(
    `${HEADER}${row("F-060")}\n\nF-060 is discussed here, and | F-061 | appears mid-sentence.\n`,
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.id), ["F-060"]);
});

/* ==========================================================================================
   THE ORDER OF OPERATIONS, which the parser tests above cannot see.
   ========================================================================================== */

test("a malformed ledger refuses to answer WHATEVER the flags say", () => {
  /*
   * THE REGRESSION THIS EXISTS FOR, in the shape it actually shipped. The duplicate-id check
   * first landed at the bottom of findings.mjs, past `--select`'s early return: the bare gate
   * refused a duplicate (exit 1) while `--select` — the interface the file's own header calls
   * "what the loop should work next", the one tooling invokes unattended — exited 0 and handed
   * back a row from the same corrupt ledger.
   *
   * Hoisting the check fixed it and NOTHING COULD SEE THAT. Reverting the hoist leaves every
   * parser test above passing, because the parser was never what broke; the ordering was. The
   * only proof was a sentence in a commit message, which is the shape this file's own header
   * calls out. So the ordering is a value now, and this asserts the property rather than the
   * position: refusal outranks every flag.
   */
  const problems = ["FINDINGS.md:5 — F-028 is already used at line 3."];
  for (const select of [true, false]) {
    assert.equal(
      findingsCliPlan({ problems, select }),
      "refuse",
      `a ledger with ${problems.length} problem(s) answered anyway with select=${select}`,
    );
  }
});

test("a readable ledger answers what was asked, and only then", () => {
  assert.equal(findingsCliPlan({ problems: [], select: true }), "select");
  assert.equal(findingsCliPlan({ problems: [], select: false }), "gate");
});

test("refusesToAnswer is about problems alone — rows and flags cannot buy their way past it", () => {
  // Stated because the temptation, when a gate is inconvenient, is to add a condition to it.
  assert.equal(refusesToAnswer({ problems: [] }), false);
  assert.equal(refusesToAnswer({ problems: ["one"] }), true);
  assert.equal(refusesToAnswer({ problems: ["one", "two"] }), true);
});

/* ==========================================================================================
   THE SHIPPED CLI, run as a process — because everything above tests functions, and the thing
   `pnpm check` and CI actually invoke is a script.
   ========================================================================================== */

/**
 * Run the REAL script against a REAL ledger, in a throwaway tree.
 *
 * `findings.mjs` resolves the ledger from its own location (`../../.loop/FINDINGS.md`), so a copy
 * of the script inside a temporary repo reads that repo's ledger. No environment override is added
 * to make this testable: an env var pointing the gate at another file would be a way to hand
 * `check:findings` a ledger that says what somebody wants it to say, and a gate with a bypass is
 * not a gate.
 */
async function runCli(ledger, args = []) {
  const dir = await mkdtemp(join(tmpdir(), "findings-cli-"));
  await mkdir(join(dir, ".loop"), { recursive: true });
  await mkdir(join(dir, "tools", "loop"), { recursive: true });
  await writeFile(join(dir, ".loop", "FINDINGS.md"), ledger, "utf8");
  await copyFile(
    fileURLToPath(new URL("./findings.mjs", import.meta.url)),
    join(dir, "tools", "loop", "findings.mjs"),
  );
  try {
    const { code } = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(dir, "tools", "loop", "findings.mjs"), ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });
    return code;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the SHIPPED CLI refuses a duplicate id on both the gate and --select", async () => {
  /*
   * THE END-TO-END GUARD, and the reason it exists. Every test above this line exercises a
   * function. Twice now the defect has been in the WIRING instead: first the refusal sat past
   * `--select`'s early return, and then — after it was extracted so a test could hold it — the CLI
   * went on hand-rolling its own branching, so a reviewer deleted the refusal from the CLI body,
   * left `findingsCliPlan` untouched, and reproduced the original bug at runtime with all ten
   * tests green. A test that guards a function nothing calls guards nothing.
   *
   * This runs the script the way `check:findings` does and asserts the exit code, so the wiring is
   * inside the assertion rather than beside it.
   */
  /*
   * EVERY ROW IS `open` WITH NO GUARD, so the ONLY thing either ledger can fail on is the
   * duplicate id. The first version of this fixture made the third row `guarded` naming
   * `x.test.ts` — a file that does not exist in the throwaway tree — so the gate exited 1 because
   * a guard was missing, and the test passed while the duplicate refusal was deleted. A fixture
   * that can fail for two reasons cannot tell you which one fired.
   */
  const good = `${HEADER}${row("F-001")}\n${row("F-002")}\n`;
  const dupe = `${HEADER}${row("F-001")}\n${row("F-002")}\n${row("F-001")}\n`;

  assert.equal(await runCli(good), 0, "a clean ledger failed the gate");
  assert.equal(await runCli(good, ["--select"]), 0, "a clean ledger failed --select");
  assert.equal(await runCli(dupe), 1, "the gate accepted a duplicate id");
  assert.equal(
    await runCli(dupe, ["--select"]),
    1,
    "--select answered from a ledger with two rows sharing an id — the exact regression this " +
      "whole round exists for, and the one a function-level test cannot see",
  );
});
