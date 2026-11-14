import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { extractClaims, parseRows, parseStatus, parseVerified, parseVocabulary } from "./lib/parse.mjs";
import { backtickedTokens, candidatePath, resolveCell, resolveScope } from "./lib/scope.mjs";
import { countTests, countTestsInSource, covers, invalidatesEvidence, stripLiterals } from "./lib/derive.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER = readFileSync(join(ROOT, ".loop/STATUS.md"), "utf8");

// ---------------------------------------------------------------------------------------
// The real ledger, parsed by the real parser. These are invariants of the FORMAT, not of
// today's contents, so they stay true as rows are worked — and they go red the moment the
// ledger is reshaped into something this gate would silently stop checking.
// ---------------------------------------------------------------------------------------

test("the real ledger declares a status vocabulary, and this tool reads it rather than owning one", () => {
  const vocab = parseVocabulary(LEDGER);
  assert.ok(vocab.size >= 3, `expected a declared vocabulary, got ${[...vocab].join(",") || "nothing"}`);
  for (const required of ["DONE", "BUILT", "TODO"]) {
    assert.ok(vocab.has(required), `${required} must be declared in the ledger's own table`);
  }
});

test("the real ledger parses into capability rows, and every row is well formed", () => {
  const vocab = parseVocabulary(LEDGER);
  const { rows, tables } = parseRows(LEDGER);
  assert.ok(tables >= 1, "at least one capability table must be found");
  assert.ok(rows.length >= 1, "a parser that finds no rows is a gate that checks nothing");
  for (const row of rows) {
    assert.equal(row.cellCount, 6, `${row.id} must have 6 cells`);
    assert.match(row.id, /^[A-Z]+\d+$/, `"${row.id}" must be a row id`);
    assert.ok(vocab.has(parseStatus(row.status)), `${row.id}: "${row.status}" must be declared`);
    assert.notEqual(parseVerified(row.verified), undefined, `${row.id}: "last verified" must parse`);
  }
});

test("a table that is not a capability table is not parsed as one", () => {
  // The vocabulary table sits directly above the capability tables in the real ledger and has
  // to be ignored, or every status word becomes a row.
  const { rows } = parseRows(LEDGER);
  assert.ok(!rows.some((r) => r.id === "`DONE`"), "the Status|Means table must not be read as rows");
});

test("NO-OP GUARD: a reshaped ledger yields zero rows, so the CLI can refuse to report success", () => {
  const reshaped = "## Foundations\n\n| id | thing | state |\n|---|---|---|\n| F1 | a | DONE |\n";
  assert.deepEqual(parseRows(reshaped), { rows: [], tables: 0, strays: [] });
});

// ---------------------------------------------------------------------------------------
// Deliberately malformed rows — the negative half of structural integrity.
// ---------------------------------------------------------------------------------------

const HEADER =
  "| id | capability | plane | status | evidence / blocker | last verified |\n|---|---|---|---|---|---|\n";

// ---------------------------------------------------------------------------------------
// Escaped pipes. `\|` is the only legal way to write a pipe in a table cell, and this
// ledger's evidence quotes shell commands constantly.
// ---------------------------------------------------------------------------------------

test("REGRESSION: an escaped pipe is one cell, not two — a correct row used to fail structurally", () => {
  const { rows } = parseRows(HEADER + "| Z1 | a row | open | BUILT | counted with `git log \\| wc -l` | 2026-08-16 |\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cellCount, 6, "before this, the escaped pipe split the cell and the row read 7 cells");
  assert.equal(rows[0].evidence, "counted with `git log | wc -l`", "the escape is RESOLVED, not left in the prose");
});

test("an escaped BACKSLASH cannot swallow the cell separator after it", () => {
  const { rows } = parseRows(HEADER + "| Z1 | a row | open | BUILT | a windows path `C:\\\\` | 2026-08-16 |\n");
  assert.equal(rows[0].cellCount, 6);
  assert.equal(rows[0].evidence, "a windows path `C:\\`");
});

// ---------------------------------------------------------------------------------------
// Table regions. A gap BETWEEN rows is a defect; a gap AFTER them is the end of the table.
// ---------------------------------------------------------------------------------------

test("REGRESSION: a blank line mid-table no longer discards every row below it", () => {
  // Measured before the fix: `1 rows in 1 table(s)` and a green verdict, while the two dropped
  // rows carried a malformed date and a DONE claim on a package with no consumer.
  const { rows, strays } = parseRows(
    HEADER +
      "| Z1 | first | open | DONE | e | 2026-08-16 |\n" +
      "\n" +
      "| Z2 | second | open | DONE | e | 2026-08-16 |\n" +
      "| Z3 | third | open | DONE | e | 2026-08-16 |\n",
  );
  assert.deepEqual(rows.map((r) => r.id), ["Z1", "Z2", "Z3"], "no row may be dropped in silence");
  assert.deepEqual(strays.map((s) => s.line), [4], "the hole is reported so a human can close it");
});

test("an HTML comment or a stray note inside a table is reported, and the rows below it survive", () => {
  const { rows, strays } = parseRows(
    HEADER +
      "| Z1 | first | open | DONE | e | 2026-08-16 |\n" +
      "<!-- moved from the other table -->\n" +
      "note: the row below is the one that matters\n" +
      "| Z2 | second | open | DONE | e | 2026-08-16 |\n",
  );
  assert.deepEqual(rows.map((r) => r.id), ["Z1", "Z2"]);
  assert.equal(strays.length, 2, "both unparsed lines are named, not just the first");
});

test("FALSE-POSITIVE CONTROL: prose AFTER the last row is the document resuming, not a hole", () => {
  const { rows, strays } = parseRows(
    HEADER +
      "| Z1 | first | open | DONE | e | 2026-08-16 |\n" +
      "\n" +
      "This paragraph follows the table and is not part of it.\n",
  );
  assert.deepEqual(rows.map((r) => r.id), ["Z1"]);
  assert.deepEqual(strays, [], "trailing non-rows must never be reported, or every ledger goes red");
});

test("REAL LEDGER: the real file contains no stray lines, and every section's table is found", () => {
  const { rows, tables, strays } = parseRows(LEDGER);
  assert.deepEqual(strays, [], "a stray here is a real defect in the ledger, not a test to relax");
  assert.ok(tables >= 5, `every section's table must be found, got ${tables}`);
  assert.ok(rows.length >= 20, `the real ledger has many rows; the parser found ${rows.length}`);
});

test("a heading between two tables ends the first region, and both tables are read", () => {
  const { rows, tables, strays } = parseRows(
    "## One\n" + HEADER + "| Z1 | a | open | DONE | e | 2026-08-16 |\n" +
      "\n## Two\n" + HEADER + "| Z2 | b | open | DONE | e | 2026-08-16 |\n",
  );
  assert.equal(tables, 2);
  assert.deepEqual(rows.map((r) => [r.id, r.section]), [["Z1", "One"], ["Z2", "Two"]]);
  assert.deepEqual(strays, []);
});

test("a deliberately malformed row is parsed and reported, never dropped", () => {
  const { rows } = parseRows(
    HEADER +
      "| Z9 | a row missing its date | open | DONE | evidence |\n" +
      "| Z8 | a row with a status nobody declared | open | SHIPPED | evidence | 2026-08-16 |\n" +
      "| Z7 | a row whose date is prose | open | BUILT | evidence | last week |\n",
  );
  assert.equal(rows.length, 3, "malformed rows must survive parsing so they can be reported");
  assert.equal(rows[0].cellCount, 5, "the short row is reported as short, not silently padded");
  assert.ok(!parseVocabulary(LEDGER).has(parseStatus(rows[1].status)), "SHIPPED is not declared");
  assert.equal(parseVerified(rows[2].verified), undefined, "prose is not a date");
});

test("an em-dash means 'never verified' and a real date means a date; nothing else parses", () => {
  assert.equal(parseVerified("—"), null);
  assert.equal(parseVerified(" 2026-08-16 "), "2026-08-16");
  assert.equal(parseVerified("2026-02-30"), undefined, "a calendar-impossible date is malformed");
  assert.equal(parseVerified("2026-8-6"), undefined);
  assert.equal(parseVerified(""), undefined);
});

// ---------------------------------------------------------------------------------------
// Count claims, driven by verbatim clauses from the real ledger.
// ---------------------------------------------------------------------------------------

test("REAL CLAUSE — a corrected count and its correction are both extracted, once each", () => {
  // Verbatim from row F6.
  const evidence =
    '**Ledger audit 2026-08-15: "44/44 tests" is wrong, and always was.** ' +
    "`node --test tools/vault/lib/*.test.mjs` → **21/21** (`rank.test.mjs` 11 + `walk.test.mjs` 10). " +
    'Checked the introducing commit `3071a33` itself — its own commit message claimed "44/44 tests passing" ' +
    "the day it landed, and this row copied that number.";
  const claims = extractClaims(evidence).filter((c) => c.kind !== "graph");
  const values = claims.map((c) => c.value);
  assert.deepEqual(values, [44, 21], "one finding per distinct number — 44/44 appears twice in the prose");
  assert.equal(claims[0].corrected, true, '"is wrong" marks 44 as already-reported-wrong');
  assert.deepEqual(claims[0].hint, { from: "paths", paths: ["tools/vault/lib"] }, "the glob resolves to its directory");
});

test("REAL CLAUSE — a bare suite count carries no anchor and is therefore a present-tense claim", () => {
  // Verbatim from row C1.
  const claims = extractClaims("`pnpm check` **146/146, boundary intact**, `apps/leaf`'s own tests visibly executing");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].value, 146);
  assert.equal(claims[0].anchored, false, "nothing here says WHEN 146 was observed");
  assert.deepEqual(claims[0].hint, { from: "suite" }, "`pnpm check` names the whole suite");
});

test("REAL CLAUSE — a count beside a CI run id IS anchored, and a run id is not mistaken for a sha", () => {
  // Verbatim from row F1.
  const claims = extractClaims(
    "First-ever Actions run **31923591713**: both jobs green — `check` (boundary → typecheck → 167 tests, INCLUDING the canopy seam tests)",
  );
  assert.equal(claims[0].value, 167);
  assert.equal(claims[0].anchored, true, "the clause names the run the number came from");
});

test("a sha must contain a hex letter — otherwise every long number anchors a count by accident", () => {
  assert.equal(extractClaims("at `de754d3` the file had 6 tests")[0].anchored, true);
  assert.equal(extractClaims("across 12345678 records there were 6 tests")[0].anchored, false);
});

test("a bare ratio is only a count claim when its clause is about testing", () => {
  assert.equal(extractClaims("0/227/573 verified/pending/excluded").length, 0, "a triple is not a suite count");
  assert.equal(extractClaims("`pnpm check` 143/143.")[0].value, 143);
  assert.equal(extractClaims("a 16/16 aspect ratio in the figure").length, 0);
});

test("prose numbers about other repositories are NOT extracted — this gate cannot see them", () => {
  const claims = extractClaims("over a real 1930-commit repository → 75 candidates, 681 real commits");
  assert.deepEqual(claims, [], "inventing an expectation for an unreachable repo is the bug, not the check");
});

test("REGRESSION: \"adds N tests\" is a DELTA, not a total — comparing it produced a false failure", () => {
  const claims = extractClaims("this change adds 2 tests on top of what was there");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].value, 2);
  assert.equal(claims[0].delta, true, "a delta and a total are different quantities");
});

test("the delta marker must ABUT the number — a loose one would turn real comparisons off", () => {
  // Unlike the anchor and corrected markers, which only downgrade severity, a delta marker
  // suppresses the comparison entirely. So it is matched against the text immediately before
  // the number, not the wide context window.
  assert.equal(extractClaims("`pnpm check` 146/146")[0].delta, false);
  assert.equal(extractClaims("adds a page to the docs; the suite is 146 tests")[0].delta, false);
  assert.equal(extractClaims("added **3 tests**")[0].delta, true, "markdown emphasis may sit between");
});

test("counts this gate cannot re-derive are extracted so they can be LISTED, never compared", () => {
  const claims = extractClaims("→ 127 nodes / 746 edges in 119ms").filter((c) => c.kind === "graph");
  assert.deepEqual(
    claims.map((c) => [c.value, c.unit]),
    [[127, "nodes"], [746, "edges"]],
  );
});

// ---------------------------------------------------------------------------------------
// Scope resolution.
// ---------------------------------------------------------------------------------------

const tree = {
  packageDir: (n) => ({ "@foliage/leaf": "packages/leaf", "@foliage/tokens": "packages/foliage-tokens" })[n] ?? null,
  exists: (p) => ["apps/leaf", "apps/leaf/intake.mjs", "public-boundary.json", "apps/canopy/public"].includes(p),
  byBasename: (b) => (b === "canopy-crown.js" ? ["apps/canopy/public/canopy-crown.js"] : b === "server.mjs" ? ["apps/leaf/server.mjs", "apps/canopy/server.mjs"] : []),
};

test("backticked prose that is not a path resolves to nothing rather than to a guess", () => {
  for (const token of ["Tree", "%G?", "--fol-text-faint", "gemma4:12b", "127.0.0.1", ".gitignore", "de754d3"]) {
    assert.equal(candidatePath(token), null, `"${token}" must not be read as a path`);
  }
});

test("a line reference and a trailing glob are stripped; a directory survives", () => {
  assert.equal(candidatePath("canopy-system.html:479,488"), "canopy-system.html");
  assert.equal(candidatePath("tools/vault/lib/*.test.mjs"), "tools/vault/lib");
  assert.equal(candidatePath("apps/canopy/public/"), "apps/canopy/public");
  assert.equal(candidatePath("/etc/passwd"), null, "absolute paths are not repo scopes");
  assert.equal(candidatePath("../elsewhere/x.ts"), null);
});

test("a backticked COMMAND yields the path inside it — the miss that sent C5's scope to the wrong file", () => {
  const tokens = backtickedTokens("`node apps/leaf/intake.mjs --repo . --subject \"Alex Acker\"`");
  assert.ok(tokens.includes("apps/leaf/intake.mjs"), "the producer inside the command must be reachable");
  assert.deepEqual(resolveCell("`node apps/leaf/intake.mjs --repo .`", tree), ["apps/leaf/intake.mjs"]);
});

test("an ambiguous basename resolves to nothing — two matches is ambiguity, not a scope", () => {
  assert.deepEqual(resolveCell("adding a typecheck put `server.mjs` under the gate", tree), []);
  assert.deepEqual(resolveCell("`canopy-crown.js` draws correctly", tree), ["apps/canopy/public/canopy-crown.js"]);
});

test("the capability column wins over the evidence prose, and unmapped is its own answer", () => {
  const named = resolveScope({ capability: "`@foliage/leaf` — compound leaf", evidence: "`public-boundary.json` unchanged" }, tree);
  assert.deepEqual(named, { confidence: "named", paths: ["packages/leaf"] });

  const inferred = resolveScope({ capability: "crown visualisation driven by real leaflet counts", evidence: "`canopy-crown.js` draws from fixtures" }, tree);
  assert.equal(inferred.confidence, "inferred", "a path found in prose is a weaker signal and must say so");

  const none = resolveScope({ capability: "responsive 360→1920 on every surface", evidence: "only ~1024/1280 has ever been measured" }, tree);
  assert.deepEqual(none, { confidence: "unmapped", paths: [] }, "unmapped and verified must not be the same word");
});

// ---------------------------------------------------------------------------------------
// Test-count derivation, and its refusal to guess.
// ---------------------------------------------------------------------------------------

test("REGRESSION: a regex containing quotes must not open a string and eat the rest of the file", () => {
  // The real shape, from apps/leaf/src/render.test.ts. Read as division, the `"` inside the
  // regex opened a string literal and the scanner swallowed the next eight test declarations
  // — a silent undercount of 426 to 418, found only because --verify-tests re-ran the suite.
  const src =
    'const state = (html) => {\n' +
    '  return /data-leaf-state="([^"]+)"/.exec(html)?.[1] ?? "(none)";\n' +
    "};\n" +
    'test("a", () => {});\n' +
    'test("b", () => {});\n';
  assert.deepEqual(countTestsInSource(src), { count: 2 }, "both declarations must survive the regex");
  assert.equal(stripLiterals(src).split("\n").length, src.split("\n").length, "line structure is preserved");
});

test("division is still division — a keyword-aware lookback must not treat every slash as a regex", () => {
  const src = 'const mean = total / count;\ntest("a", () => {});\n';
  assert.deepEqual(countTestsInSource(src), { count: 1 });
  assert.match(stripLiterals(src), /total \/ count/, "the divide must be left intact");
});

test("test-shaped code quoted INSIDE a string is not read as code", () => {
  // Without this, any test file that writes about test code refuses to derive a count at all,
  // and a permanently-refusing check is a deleted check. This file is itself the proof.
  const src = 'const fixture = "describe(\\"x\\", () => {})";\ntest("a", () => {});\n';
  assert.deepEqual(countTestsInSource(src), { count: 1 });
});

test("a top-level test declaration counts once", () => {
  const src = 'import { test } from "node:test";\ntest("a", () => {});\nawait test("b", () => {});\nit("c", () => {});\n';
  assert.deepEqual(countTestsInSource(src), { count: 3 });
});

test("a for-loop inside a test body does not inflate the count", () => {
  const src = 'test("counts", () => {\n  for (const x of xs) assert.ok(x);\n});\n';
  assert.deepEqual(countTestsInSource(src), { count: 1 });
});

test("REFUSAL: a generated or nested test makes the count a guess, so no number is returned", () => {
  for (const [src, why] of [
    ['for (const c of cs) {\n  test(`case ${c}`, () => {});\n}\n', "a generated test"],
    ['describe("group", () => {\n});\n', "a suite"],
    ['test("outer", async (t) => {\n  await t.test("inner", () => {});\n});\n', "a subtest"],
    ['test.each([1, 2])("case %i", () => {});\n', "a parameterised test"],
    ['test.skip("later", () => {});\n', "a skipped test"],
  ]) {
    const r = countTestsInSource(src);
    assert.equal(r.count, undefined, `${why} must not produce a number`);
    assert.ok(r.undeclared, `${why} must produce a stated reason`);
  }
});

test("one unsafe file refuses the WHOLE sum — a partial total presented as a total is the defect itself", () => {
  const r = countTests([
    { path: "a.test.mjs", source: 'test("a", () => {});\n' },
    { path: "b.test.mjs", source: 'describe("b", () => {});\n' },
  ]);
  assert.equal(r.count, undefined);
  assert.match(r.undeclared, /b\.test\.mjs/, "the refusal must name the file that caused it");
});

test("STANDING GUARD: static counting is still exact across every test file in this repo", () => {
  // If this goes red, someone added a generated or nested test and the count checker just
  // became unable to derive the suite total. The right response is to read the refusal, not
  // to loosen the detector — a wrong count from the count-checker is the worst outcome here.
  const globs = ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tools/**/*.test.mjs"];
  const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd: ROOT })))].map((path) => ({
    path,
    source: readFileSync(join(ROOT, path), "utf8"),
  }));
  const r = countTests(files);
  assert.equal(r.undeclared, undefined, `static counting became unsafe: ${r.undeclared}`);
  assert.ok(r.count > 0, "a suite that derives zero tests would silently agree with nothing");
  // No expected total is asserted. Hardcoding one here would make this file the fifth copy of
  // the bug. `node tools/ledger/check.mjs --verify-tests` compares it against the runner.
});

test("covers() treats a directory as covering everything beneath it, and nothing beside it", () => {
  assert.equal(covers("apps/leaf", "apps/leaf/src/render.ts"), true);
  assert.equal(covers("apps/leaf", "apps/leaf"), true);
  assert.equal(covers("apps/leaf", "apps/leaf-extra/x.ts"), false);
});

test("REGRESSION: a docs-only change inside a package does NOT invalidate the row's evidence", () => {
  // Reproduced before this: committing only `packages/alpha/README.md` turned a correct DONE
  // row red. A gate that goes red on a typo fix is a gate that gets turned off.
  assert.equal(invalidatesEvidence("packages/alpha", "packages/alpha/README.md"), false);
  assert.equal(invalidatesEvidence("packages/alpha", "packages/alpha/CHANGELOG.md"), false);
  assert.equal(invalidatesEvidence("packages/alpha", "packages/alpha/.gitignore"), false);
});

test("a code, style, manifest, workflow or font change DOES invalidate it — the filter keeps the signal", () => {
  for (const file of [
    "packages/alpha/src/alpha.ts",
    "packages/alpha/src/render.tsx",
    "apps/canopy/server.mjs",
    "apps/canopy/public/tree.css",
    "apps/canopy/public/canopy-system.html",
    "packages/alpha/package.json", // export maps decide what actually resolves
    ".github/workflows/ci.yml",
    "packages/foliage-tokens/fonts/x.woff2", // F8's whole subject is four font files
  ]) {
    assert.equal(invalidatesEvidence(file.split("/").slice(0, 2).join("/"), file), true, file);
  }
});

test("THE ESCAPE HATCH: a row that NAMES a document is invalidated when that document changes", () => {
  // Otherwise the filter would be a loophole. A row whose subject really is prose says so by
  // naming the file, and then a change to it is the row's subject changing.
  assert.equal(invalidatesEvidence("packages/alpha/README.md", "packages/alpha/README.md"), true);
  assert.equal(invalidatesEvidence("packages/alpha", "packages/beta/src/beta.ts"), false, "and nothing beside it");
});

test("comments are stripped for import detection while string bodies survive — the dark check needs both", () => {
  const src =
    '// consumed through import.meta.resolve("@foliage/tokens/tokens.css") in the docs\n' +
    'import { x } from "@foliage/leaf";\n';
  const code = stripLiterals(src, { strings: false });
  assert.ok(!code.includes("@foliage/tokens"), "a package named only in a comment is not a consumer");
  assert.ok(code.includes('"@foliage/leaf"'), "a real specifier must survive, or every edge disappears");
});

test("REGRESSION: `pnpm check:boundary` is not `pnpm check` — a sub-script names no test suite", () => {
  // `\b` after "check" matches inside `check:boundary`, because ":" is a non-word character and
  // therefore a word boundary. So the licensing gate — which runs no tests at all — was read as
  // "the whole suite", and any count near it was compared against every test in the repository.
  // That is the copied-number bug this gate exists to catch, committed by the gate itself.
  const suite = extractClaims("`pnpm check` 167/167 green");
  assert.deepEqual(suite[0].hint, { from: "suite" }, "the real whole-suite command must still be recognised");

  for (const sub of ["`pnpm check:boundary` green; 167 tests", "`pnpm run check:ledger` green; 12 tests"]) {
    const [claim] = extractClaims(sub);
    assert.equal(claim.hint, null, `${sub} must not route the count to the whole suite`);
  }
});

test("a DAY-GRANULAR observation anchors a count, but only when an observation word claims it", () => {
  // The ledger's `last verified` column is a date, not a timestamp, and staleness is compared at
  // day granularity. Refusing a day-granular anchor made the gate inconsistent with itself: it
  // told the author to "record it with when it was observed", then rejected the ledger's own way
  // of recording that. The observation word is required — these evidence cells discuss dates
  // constantly, and a bare date would anchor live counts by accident.
  assert.equal(extractClaims("`pnpm check` **146/146** (observed 2026-08-15)")[0].anchored, true);
  assert.equal(extractClaims("`pnpm check` **146/146** green")[0].anchored, false);
  assert.equal(
    extractClaims("stale since 2026-08-13, `pnpm check` 146/146")[0].anchored,
    false,
    "a date discussing staleness must not disarm the count check",
  );
});
