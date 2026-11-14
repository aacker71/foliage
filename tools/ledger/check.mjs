#!/usr/bin/env node
/**
 * Capability-ledger truth gate.
 *
 * `.loop/STATUS.md` is the single source of truth for what is done. It has also been wrong
 * four separate times, and every time the cause was the same: A NUMBER WAS COPIED INSTEAD OF
 * RE-DERIVED, or a row was not re-checked after the code under it changed. The repo's own
 * audit history records a row claiming "12 tests" where the file had 6 from that row's first
 * commit; "44/44 tests" where it was 21/21, copied out of the introducing commit's message;
 * "34 pairs" where the selector gives 33; and a row reading BUILT while a graph query proved
 * the package had no consumer outside its own tests.
 *
 * AGENTS.md already says "if a number can be produced by a command, run the command." That is
 * a discipline, and discipline failed four times. This is the same sentence as a gate.
 *
 * THE TRAP THIS EXISTS TO CATCH: a ledger row is a claim, and prose does not rot — the TREE
 * moves underneath it. A row that was true when written stays on the page looking true. So
 * every check here re-derives from the tree at run time and compares; nothing is remembered.
 *
 * WHAT IT CHECKS
 *   1. STALENESS   resolve each row to a file scope, ask git when that scope last changed,
 *                  and compare against the row's `last verified` date. REFUSES to run at all
 *                  on a shallow clone — see `historyCompleteness` below.
 *   2. COUNTS      re-derive the test counts rows cite, and compare. Counts it cannot derive
 *                  exactly are reported as un-derivable — never guessed.
 *   3. DARK        a workspace package nothing outside itself consumes is DARK by this
 *                  ledger's own definition, and its row must say so.
 *   4. STRUCTURE   every row has an id, a status from the ledger's own declared vocabulary,
 *                  and a verification date or an explicit em-dash; no unparsed line sits
 *                  inside a table; and the row set has not shrunk against the last commit.
 *
 * WHAT IT CANNOT SEE, and the list matters more than the list above:
 *   - whether any DONE row is TRUE. Nothing mechanical can tell whether a person opened the
 *     running app. A fresh date on a row is evidence that someone re-typed a date.
 *   - a row whose code moved in a file the row never names. The staleness check is exactly as
 *     good as the scope it could resolve, which is why unmapped rows are printed as UNMAPPED
 *     and never as passing.
 *   - any claim about a repository outside this tree — several rows cite commit counts from
 *     other repos as evidence, and those are unreachable from here.
 *   - prose. "0 verified / 19 pending" is not re-derived; only the shapes parse.mjs names.
 *
 * IT NEVER EDITS `.loop/STATUS.md`. A tool that rewrites the ledger to make itself pass is
 * the exact corruption this repository exists to refuse. It reports; a human edits.
 *
 * Exit 1 on any FAIL. Warnings and info never fail the build — a gate that cries wolf gets
 * disabled, and a disabled gate is worse than none.
 */

import { execFileSync } from "node:child_process";
import { globSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRows, parseStatus, parseVocabulary } from "./lib/parse.mjs";
import { resolveScope } from "./lib/scope.mjs";
import { countTests, covers, invalidatesEvidence, stripLiterals } from "./lib/derive.mjs";
import { checkCounts, checkDark, checkStaleness, checkStructure, undatedRows } from "./lib/checks.mjs";

const VERIFY_TESTS = process.argv.includes("--verify-tests");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER = ".loop/STATUS.md";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const rel = (p) => relative(ROOT, p).split(sep).join("/");

// ---------------------------------------------------------------------------------------
// Facts about the tree. Gathered once, injected into the pure checks.
// ---------------------------------------------------------------------------------------

/**
 * Every file git can see: tracked, plus untracked-and-not-ignored. Using git's own view is
 * what makes gitignored artifact directories (`graphify-out/`, the vault index) invisible to
 * scope resolution — they exist on disk but are not part of the tree a row can be about.
 */
const visibleFiles = new Set(
  [...git("ls-files", "-z").split("\0"), ...git("ls-files", "-z", "--others", "--exclude-standard").split("\0")]
    .filter(Boolean),
);
const visiblePaths = new Set(visibleFiles);
for (const file of visibleFiles) {
  const parts = file.split("/");
  for (let i = 1; i < parts.length; i++) visiblePaths.add(parts.slice(0, i).join("/"));
}
const byBasename = new Map();
for (const file of visibleFiles) {
  const b = basename(file);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(file);
}

/** Working-tree changes, by file, with their mtime day — a scope can be newer than any commit. */
const worktree = new Map();
for (const line of git("status", "--porcelain", "-uall", "-z").split("\0")) {
  const path = line.slice(3).trim();
  if (!path) continue;
  try {
    const d = statSync(join(ROOT, path)).mtime;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    worktree.set(path, day);
  } catch {
    /* deleted; it changed, but there is no mtime to read */
  }
}

/**
 * IS THE HISTORY DEEP ENOUGH TO ANSWER "WHEN DID THIS PATH LAST CHANGE"?
 *
 * In a `--depth 1` clone it is not, and git does not say so: `git log -1 --format=%cI -- <p>`
 * answers with the TIP commit's date for every path, because the tip is the only commit
 * present. Every dated row then reports STALE. Measured on a synthetic ledger that was
 * correct: full clone, clean; `git clone --depth 1`, three rows red.
 *
 * `actions/checkout` defaults to `fetch-depth: 1`, and THIS repository has already been bitten
 * by that exact default once — the comment on `fetch-depth: 0` in .github/workflows/ci.yml
 * records it. Anyone wiring `check:ledger` into CI would get a solidly red, entirely false
 * gate on the first run, and the first thing anyone does with a gate like that is turn it off.
 *
 * So the staleness check REFUSES to run, by name, rather than emitting findings from data that
 * cannot support them. It refuses rather than fails: the ledger is not wrong, the checkout is
 * too thin, and going red at the operator for that is its own kind of crying wolf.
 */
function historyCompleteness() {
  const answer = git("rev-parse", "--is-shallow-repository").trim();
  if (answer === "false") return { complete: true };
  if (answer === "true") {
    return {
      complete: false,
      reason: "the clone is SHALLOW (`git rev-parse --is-shallow-repository` = true)",
      remedy:
        "Fix the checkout, not the ledger: `actions/checkout` needs `fetch-depth: 0`, or run " +
        "`git fetch --unshallow` locally. This repo's ci.yml already does the former.",
    };
  }
  return {
    complete: false,
    reason: `git could not say whether the history is complete (\`git rev-parse --is-shallow-repository\` said ${JSON.stringify(answer)})`,
    remedy: "Run this from inside a git working tree, with git 2.15 or newer.",
  };
}
const history = historyCompleteness();

/**
 * The file list is built from git's own inventory and passed to `git log` EXPLICITLY, rather
 * than as a `dir/*.ts` pathspec. Git's pathspec wildcards do not use FNM_PATHNAME, so a glob
 * would match nested files too — right here by accident, and a subtlety the next reader would
 * have to go and look up. Above the cap the filter is abandoned and the whole directory is
 * asked about, because an argv of that size is a different failure.
 */
const PATHSPEC_CAP = 1000;
const lastCommitDay = (paths) =>
  paths.length ? git("log", "-1", "--format=%cI", "--", ...paths).trim().slice(0, 10) || null : null;

const changeCache = new Map();
/** When did this scope last change, from committed history or the working tree, whichever is later? */
function changeOf(path) {
  if (changeCache.has(path)) return changeCache.get(path);
  // Two separate questions. "Is this scope in git at all" is asked of every file under it,
  // whatever its kind — a package of nothing but docs is still committed. "When did it last
  // change" is asked only of the files that can invalidate evidence.
  const committed = lastCommitDay([path]) !== null;
  const evidence = [...visibleFiles].filter((f) => invalidatesEvidence(path, f));
  let day = evidence.length > PATHSPEC_CAP ? lastCommitDay([path]) : lastCommitDay(evidence);
  for (const [p, d] of worktree) {
    if (!invalidatesEvidence(path, p)) continue;
    if (day === null || d > day) day = d;
  }
  const out = { day, committed };
  changeCache.set(path, out);
  return out;
}

/** Workspace packages, discovered the same way the boundary gate discovers them. */
function workspacePackages() {
  const out = [];
  for (const root of ["apps", "packages"]) {
    for (const manifest of globSync(`${root}/*/package.json`, { cwd: ROOT })) {
      const dir = manifest.split("/").slice(0, -1).join("/");
      const json = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
      // `hasBin` is an ENTRY-POINT fact, not a packaging detail: see checkDark for why a CLI
      // with no importer is the correct state rather than a dark package.
      if (json.name) {
        out.push({ name: json.name, dir, manifest, json, isApp: root === "apps", hasBin: Boolean(json.bin) });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const packages = workspacePackages();
const packageDirByName = new Map(packages.map((p) => [p.name, p.dir]));

const tree = {
  packageDir: (name) => packageDirByName.get(name) ?? null,
  exists: (p) => visiblePaths.has(p),
  byBasename: (b) => byBasename.get(b) ?? [],
};

// ---------------------------------------------------------------------------------------
// Test-count derivation. The glob is READ FROM package.json rather than restated here — a
// second copy of the test glob is a second thing to go stale, in a tool about staleness.
// ---------------------------------------------------------------------------------------

const testScript = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts?.test ?? "";
const testGlobs = [...testScript.matchAll(/"([^"]*\*[^"]*)"/g)].map((m) => m[1]);
const testFiles = [...new Set(testGlobs.flatMap((g) => globSync(g, { cwd: ROOT })))]
  .map((p) => p.split(sep).join("/"))
  .sort()
  .map((path) => ({ path, source: readFileSync(join(ROOT, path), "utf8") }));

const suiteDerivation = countTests(testFiles);

/**
 * `--verify-tests` spends the six seconds the default path refuses to spend, and cross-checks
 * the static derivation against what the runner actually reports. "It matched once" is an
 * observation, not a property — this is how the observation gets re-made on demand.
 */
let verification = null;
if (VERIFY_TESTS) {
  let reported = null;
  try {
    const out = execFileSync(
      "node",
      ["tools/development/run-tests.mjs", "--test", "--experimental-strip-types", "--test-reporter=tap", ...testGlobs],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
    reported = Number(out.match(/^# tests (\d+)$/m)?.[1] ?? NaN);
  } catch (err) {
    reported = Number(String(err.stdout ?? "").match(/^# tests (\d+)$/m)?.[1] ?? NaN);
  }
  verification = { reported, derived: suiteDerivation.count ?? null };
}

function deriveTests(target) {
  if (target.from === "suite") return suiteDerivation;
  const wanted = testFiles.filter((f) => target.paths.some((p) => covers(p, f.path)));
  if (!wanted.length) return { undeclared: `no test files under ${target.paths.join(", ")}` };
  return countTests(wanted);
}

// ---------------------------------------------------------------------------------------
// Consumers, for dark detection.
//
// A "consumer" is deliberately BROADER than a static import, because being wrong about DARK
// in the direction of a false alarm is what gets this check deleted. `@foliage/tokens` is
// consumed through `import.meta.resolve("@foliage/tokens/tokens.css")` and a package.json
// dependency and never by a static import — an import-only rule would call it dark, and be
// wrong. Test files do not count: a package consumed only by its own tests is the exact shape
// this check exists to name.
// ---------------------------------------------------------------------------------------

const SPECIFIER = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\.meta\.resolve\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*["']([^"']+)["']/g,
  /@import\s*(?:url\()?\s*["']([^"']+)["']/g,
];
const SRC_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|html)$/;
const IS_TEST = /\.test\.[a-z]+$/;

const sourceFiles = [...visibleFiles].filter((f) => SRC_EXT.test(f) && !f.includes("node_modules"));

for (const pkg of packages) {
  const consumers = new Set();
  for (const file of sourceFiles) {
    if (covers(pkg.dir, file) || IS_TEST.test(file)) continue;
    const raw = readFileSync(join(ROOT, file), "utf8");
    if (!raw.includes(pkg.name)) continue;
    // Comments out, string bodies kept — a specifier lives in a string, a mention in a
    // comment is not an edge. This file's own header trips the naive version.
    const text = stripLiterals(raw, { strings: false });
    for (const re of SPECIFIER) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[1] === pkg.name || m[1].startsWith(pkg.name + "/")) consumers.add(file);
      }
    }
  }
  for (const other of packages) {
    if (other.name === pkg.name) continue;
    const deps = { ...other.json.dependencies, ...other.json.peerDependencies, ...other.json.devDependencies };
    if (pkg.name in deps) consumers.add(other.manifest);
  }
  pkg.consumers = [...consumers].sort();
}

// ---------------------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------------------

const text = readFileSync(join(ROOT, LEDGER), "utf8");
const vocabulary = parseVocabulary(text);
const { rows, tables, strays } = parseRows(text);

/**
 * The last COMMITTED ledger, parsed by the same parser, as a floor for the row count. Read
 * from git rather than from disk on purpose: the question is "did rows disappear", and the
 * working copy is the thing under suspicion. Absent (a first commit, an unborn HEAD, a ledger
 * not yet tracked) means there is nothing to compare and the floor check does not run.
 */
const committedLedger = git("show", `HEAD:${LEDGER}`);
const previousRows = committedLedger ? parseRows(committedLedger).rows : null;

if (rows.length === 0) {
  console.error(red(`\n✗ ${LEDGER}: no capability table found.`));
  console.error(
    dim(
      "\n  A capability table is identified by its header:\n" +
        "    | id | capability | plane | status | evidence / blocker | last verified |\n" +
        "  Finding none means the ledger was reshaped and this gate is now checking nothing.\n" +
        "  That is reported as a failure rather than as a clean run.",
    ),
  );
  process.exit(1);
}

const scopeCache = new Map();
const scopeOf = (row) => {
  if (!scopeCache.has(row.id)) scopeCache.set(row.id, resolveScope(row, tree));
  return scopeCache.get(row.id);
};

/**
 * "Not re-derivable here" must never READ as "fine". These are the only counts in the ledger
 * this gate refuses outright, so the refusal has to carry the exact command a human runs to
 * settle it — otherwise the row rots in plain sight. It does: the vault figures were re-derived
 * by hand as 131 nodes / 768 edges against a row that says 127 / 746, and this gate said only
 * "not re-derivable".
 *
 * The refusal itself stays, and it is not laziness. `vault:build` indexes trees OUTSIDE this
 * repository (`~/brain` among them), so the number is a fact about one machine; hardcoding an
 * expectation would fail on every other machine and would be the copied-number defect again.
 *
 * TWO DIFFERENT GRAPHS, and they get conflated: the VAULT index (F6, `pnpm run vault:build`)
 * and the GRAPHIFY code graph (X5, `graphify update`) are unrelated artifacts with unrelated
 * counts. Routing on the evidence text keeps each row pointed at its own producer.
 */
const facts = {
  scopeOf,
  changeOf,
  deriveTests,
  history,
  deriveHintForGraph: (row) =>
    /vault:build|vault\.mjs/.test(row.evidence)
      ? [
          "NOT re-derivable here, which is not the same as fine — re-derive it by hand:",
          "  pnpm run vault:build     → prints `N nodes / M edges`; compare with the row.",
          "The index reads trees outside this repository, so the count is machine-dependent and no",
          "expectation is hardcoded. If it differs, the row is stale and must be re-recorded with an",
          "observation time. (This is the VAULT index, not the graphify code graph — different",
          "artifact, different numbers, and the two have been conflated before.)",
        ]
      : /graphify/.test(row.evidence)
        ? [
            "NOT re-derivable here, which is not the same as fine — re-derive it by hand:",
            "  graphify update . --no-cluster && graphify cluster-only . --no-label --no-viz",
            "graphify is not a dependency of this repo, so this gate will not run it. (This is the",
            "GRAPHIFY code graph, not the vault index F6 cites — different artifact, different",
            "numbers.)",
          ]
        : ["Not re-derivable from this tree. Record it with an observation time, as C1 and C5 do."],
};

const counts = checkCounts(rows, facts);
const staleness = checkStaleness(rows, facts);
const findings = [
  ...checkStructure(rows, vocabulary, { strays, previousRows }),
  ...staleness,
  ...counts.findings,
  ...checkDark(rows, packages),
];

const fails = findings.filter((x) => x.level === "fail");
const warns = findings.filter((x) => x.level === "warn");
const infos = findings.filter((x) => x.level === "info");

// --- report -----------------------------------------------------------------------------

console.log(`\n${LEDGER} — ${rows.length} rows in ${tables} table(s)`);
console.log(dim(`  vocabulary, read from the ledger: ${[...vocabulary].join(", ") || "(none)"}`));
console.log(
  dim(
    suiteDerivation.undeclared
      ? `  tests: NOT re-derivable — ${suiteDerivation.undeclared}`
      : `  tests: ${suiteDerivation.count} declared across ${suiteDerivation.files} files ` +
        `(static, column-0 call sites; confirm with \`pnpm test\` or \`--verify-tests\`)`,
  ),
);

if (verification) {
  const ok = Number.isFinite(verification.reported) && verification.reported === verification.derived;
  console.log(
    (ok ? green : red)(
      `  --verify-tests: node --test reported ${verification.reported}, static derivation says ` +
        `${verification.derived} — ${ok ? "exact" : "THE DERIVATION IS WRONG, do not trust the count findings"}`,
    ),
  );
  if (!ok) process.exitCode = 1;
}

const show = (list, colour, label) => {
  if (!list.length) return;
  console.log(colour(`\n${label} (${list.length})`));
  for (const x of list) {
    console.log(`  ${x.id.padEnd(3)} ${dim(`${LEDGER}:${x.line}`)}  ${x.summary}`);
    for (const d of x.detail ?? []) console.log(dim(`        ${d}`));
  }
};

show(fails, red, "✗ FAIL");
show(warns, yellow, "! WARN");

// --- launch roll-up ---------------------------------------------------------------------

const byStatus = new Map();
for (const row of rows) {
  const s = parseStatus(row.status);
  if (!byStatus.has(s)) byStatus.set(s, []);
  byStatus.get(s).push(row.id);
}
const ids = (s) => (byStatus.get(s) ?? []).join(" ") || dim("none");
const listOf = (check, pred) =>
  [...new Set(findings.filter((x) => x.check === check && pred(x)).map((x) => x.id))].join(" ") || dim("none");

console.log("\nROLL-UP");
console.log(
  "  " +
    [...byStatus.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([s, v]) => `${s} ${v.length}`)
      .join("   "),
);
console.log(`  GATED     ${ids("GATED")}   ${dim("launch blockers — LAUNCH.md Gate 0")}`);
console.log(`  BROKEN    ${ids("BROKEN")}`);
console.log(`  DARK      ${ids("DARK")}`);
if (history.complete) {
  console.log(`  STALE     ${listOf("staleness", (x) => x.summary.startsWith("STALE —"))}`);
  console.log(`  UNMAPPED  ${listOf("staleness", (x) => x.summary.startsWith("UNMAPPED"))}   ${dim("staleness NOT checked — not a pass")}`);
} else {
  // Printing "STALE none" here would be the gate reporting a clean result for a check it
  // declined to run — the single most misleading line it could emit.
  console.log(`  STALE     ${yellow("NOT CHECKED")}   ${dim(history.reason)}`);
  console.log(`  UNMAPPED  ${yellow("NOT CHECKED")}   ${dim("scope resolution is only meaningful beside a staleness answer")}`);
}
console.log(`  UNDATED   ${undatedRows(rows).join(" ") || dim("none")}   ${dim("no `last verified` — nothing to check against")}`);

const underived = infos.filter((x) => x.check === "counts");
console.log(`  COUNTS    ${counts.agreed.length} re-derived and AGREED; ${underived.length} not re-derivable`);
for (const a of counts.agreed) console.log(dim(`            ✓ ${a.id} "${a.text}" = ${a.where}`));
for (const x of underived) {
  console.log(dim(`            ? ${x.id} ${x.summary}`));
  // The detail is where the re-derivation command lives. Suppressing it — which this did
  // until it was noticed — turns every refusal into a shrug and lets the number rot in place.
  for (const d of x.detail ?? []) console.log(dim(`              ${d}`));
}

const uncommitted = findings.filter((x) => x.summary.startsWith("scope is not in git"));
if (uncommitted.length) {
  console.log(
    dim(`  NOT IN GIT ${[...new Set(uncommitted.map((x) => x.id))].join(" ")} — rows whose scope has never been committed`),
  );
}

// --- verdict ----------------------------------------------------------------------------

if (fails.length) {
  console.error(
    red(`\n✗ ledger disagrees with the tree: ${fails.length} failure(s), ${warns.length} warning(s)`),
  );
  console.error(dim("  Edit the rows. This tool will not — a gate that rewrites the ledger to make itself"));
  console.error(dim("  pass is the corruption the ledger exists to refuse."));
  process.exit(1);
}

if (process.exitCode) {
  // --verify-tests found the derivation itself to be wrong. Nothing below can be trusted, and
  // printing a tick under that would be the gate lying about itself.
  console.error(red("\n✗ the count derivation disagreed with the runner — no verdict is offered"));
  process.exit(1);
}

// A green line has to name what it covers. When the staleness check refused to run, "everything
// mechanically checkable" is false — most of this gate did not execute — and saying it anyway
// would be the gate lying about its own coverage.
console.log(
  green(
    history.complete
      ? "\n✓ ledger agrees with the tree on everything mechanically checkable"
      : "\n✓ ledger agrees with the tree on everything this run was ABLE to check",
  ),
);
if (!history.complete) console.log(yellow(`  STALENESS DID NOT RUN — ${history.reason}`));
console.log(dim(`  ${warns.length} warning(s), ${infos.length} informational. Green here is NOT "the ledger is true":`));
console.log(dim(`  no gate can tell whether a DONE row was ever opened in a browser.`));
