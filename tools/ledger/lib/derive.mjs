/**
 * Re-deriving test counts from the tree, and REFUSING to when it cannot be done exactly.
 *
 * A count-checker that emits a wrong number is worse than no count-checker, because it teaches
 * people to ignore it. So this module has two outputs and only two: an exact number, or
 * `undeclared` with the reason. It never estimates.
 *
 * THE METHOD, and why it is exact here rather than merely usually-right.
 *
 * `node --test` counts one test per executed `test()`/`it()` call. Statically counting call
 * sites equals that number only if every call site runs exactly once. Three things break that
 * and all three are DETECTED rather than assumed away:
 *
 *   - a call site nested inside a loop, a `forEach`, or another test (a subtest) runs a
 *     variable number of times;
 *   - `describe()` introduces a suite, which changes what the runner reports;
 *   - `.each` / `.skip` / `.todo` / `.only` change the count or the reporting.
 *
 * The detector is deliberately crude and errs toward refusing: any `test(`/`it(` call site
 * that is not at column 0, and any `describe(`, `t.test(`, generated-in-a-loop or `.each`
 * shape, marks the whole derivation UNDERIVABLE — no number at all rather than a wrong one.
 *
 * NO EXPECTED TOTAL IS WRITTEN DOWN HERE, and that is the point: a number in this comment
 * would be the same copied-count defect the ledger keeps hitting. `--verify-tests` runs the
 * real suite and compares, so the claim "the derivation is exact" is re-provable on demand
 * rather than remembered. It has already earned that: it caught this module reading
 * `return /re/` as division and losing eight declarations.
 *
 * Complexity: O(bytes of test source). Milliseconds. That is the point of not spawning the
 * suite — the boundary gate runs in well under a second and gets run; a six-second gate does
 * not.
 */

/**
 * Blank out comments and the BODIES of string/template/regex literals, preserving every
 * newline and every character offset.
 *
 * This is not optional polish — it was found by the gate's own standing guard failing on the
 * gate's own test file, which quotes `describe("group", ...)` inside a string as a fixture. A
 * detector that reads code inside quotes refuses to derive any count at all the moment a test
 * file writes about test code, and an always-refusing check is a deleted check.
 *
 * `/` is treated as starting a regex only where a regex is legal — after an operator, an open
 * bracket, a KEYWORD, or at the start of a statement. The keyword half is not theoretical:
 * `return /data-leaf-state="([^"]+)"/.exec(html)` in apps/leaf/src/render.test.ts was read as
 * division, the quotes inside the regex opened a string, and the scanner swallowed the next
 * eight test declarations. `--verify-tests` is what surfaced it — 418 derived against 426
 * reported — which is the argument for keeping that cross-check runnable.
 */
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "case", "do", "else", "yield",
  "await", "new", "delete", "void", "throw",
]);

/**
 * `strings: false` blanks comments and regex bodies but LEAVES string contents intact. The
 * dark check needs that: an import specifier lives inside a string, so blanking strings would
 * erase the very edges it is looking for — while a package name mentioned in a COMMENT is not
 * an edge at all. That FP was real and was found in this file's own header, which quotes
 * `import.meta.resolve("@foliage/tokens/tokens.css")` while explaining the check.
 */
export function stripLiterals(source, { strings = true } = {}) {
  const out = source.split("");
  const blank = (i) => {
    if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  let prev = ""; // last significant character, for the regex-vs-divide decision
  let word = ""; // the last COMPLETED identifier, so keywords are recognised
  let cur = ""; // the identifier being read right now
  /** True when the last significant thing seen was this exact keyword. */
  const afterKeyword = () => REGEX_KEYWORDS.has(word) && prev === word[word.length - 1];
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") blank(i++);
      continue;
    }
    if (c === "/" && next === "*") {
      blank(i++);
      blank(i++);
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) blank(i++);
      blank(i++);
      blank(i++);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++; // keep the opening quote so the shape still reads as a call argument
      while (i < source.length) {
        if (source[i] === "\\") {
          if (strings) blank(i);
          i++;
          if (strings) blank(i);
          i++;
          continue;
        }
        if (source[i] === c) break;
        if (strings) blank(i);
        i++;
      }
      i++;
      prev = c;
      word = "";
      cur = "";
      continue;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev) || afterKeyword())) {
      i++;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === "\\") {
          blank(i++);
          blank(i++);
          continue;
        }
        if (source[i] === "/") break;
        blank(i++);
      }
      i++;
      prev = "/";
      word = "";
      cur = "";
      continue;
    }
    if (/[\w$]/.test(c)) {
      cur += c;
    } else if (cur) {
      word = cur;
      cur = "";
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

/** A test declaration at column 0 — the only shape that provably runs exactly once. */
const TOP_LEVEL = /^(?:await\s+)?(?:test|it)\s*\(/gm;

/** Shapes that make static counting a guess. Their presence refuses the derivation. */
const UNSAFE = [
  { re: /^[ \t]+(?:await\s+)?(?:test|it)\s*\(/m, why: "an indented test() call site (nested or generated)" },
  { re: /\bdescribe\s*\(/, why: "describe() — the runner reports suites differently" },
  // Deliberately only the node:test context names. `re.test(x)` is a regex call, and a
  // detector that reads it as a subtest refuses on half the files in this repo.
  { re: /\b(?:t|ctx|context)\.test\s*\(/, why: "a subtest (t.test)" },
  { re: /\b(?:test|it)\.(?:each|skip|todo|only)\b/, why: "a test modifier (.each/.skip/.todo/.only)" },
  { re: /\b(?:for|while)\s*\([^)\n]*\)\s*(?:await\s+)?(?:test|it)\s*\(/, why: "a test generated by a loop" },
  { re: /\.(?:forEach|map)\s*\([^\n]*=>\s*(?:await\s+)?(?:test|it)\s*\(/, why: "a test generated by forEach/map" },
];

/**
 * Count the tests declared in one file's source.
 * Returns `{ count }` or `{ undeclared: reason }`. Never both, never a guess.
 */
export function countTestsInSource(source) {
  const code = stripLiterals(source);
  for (const { re, why } of UNSAFE) {
    if (re.test(code)) return { undeclared: why };
  }
  TOP_LEVEL.lastIndex = 0;
  return { count: (code.match(TOP_LEVEL) ?? []).length };
}

/**
 * Sum a set of test files. One unsafe file refuses the whole sum, because a partial sum
 * presented as a total is exactly the defect this tool exists to catch.
 *
 * `files` is [{ path, source }].
 */
export function countTests(files) {
  let total = 0;
  const refusals = [];
  for (const f of files) {
    const r = countTestsInSource(f.source);
    if (r.undeclared) refusals.push({ path: f.path, why: r.undeclared });
    else total += r.count;
  }
  if (refusals.length) {
    return {
      undeclared:
        `static counting is unsafe in ${refusals.length} file(s): ` +
        refusals.map((r) => `${r.path} (${r.why})`).join("; "),
    };
  }
  return { count: total, files: files.length };
}

/** Does this scope path cover this test file? A directory covers everything beneath it. */
export const covers = (scope, file) => file === scope || file.startsWith(scope.replace(/\/$/, "") + "/");

/**
 * WHICH CHANGES INVALIDATE A ROW'S EVIDENCE — a policy decision, written here so it can be
 * read and tested rather than buried in a git invocation.
 *
 * A row's evidence is a claim about BEHAVIOUR. A sentence written ABOUT that behaviour is not
 * the behaviour. So when a row's scope is a DIRECTORY, only files that can change what the
 * thing does count: code, the styles and markup it serves, the fonts it ships, and the
 * config/data that decides what runs (package.json export maps, public-boundary.json,
 * workflow files). A README typo, a comment-only edit, a `.gitignore` line — those do not.
 *
 * The cost of the opposite policy was measured: committing ONLY `packages/alpha/README.md`
 * invalidated a DONE row and failed the gate. A gate that goes red on a typo fix is a gate
 * that gets disabled, and a disabled gate is worse than none.
 *
 * The escape hatch is exact, and it is what keeps this from being a loophole: when a row NAMES
 * A FILE, that file counts whatever its extension is. A row whose subject really is a document
 * says so by naming it, and then a change to it IS the row's subject changing.
 */
const EVIDENCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css|html|svg|json|ya?ml|woff2)$/;
export const invalidatesEvidence = (scope, file) =>
  covers(scope, file) && (file === scope || EVIDENCE_EXT.test(file));
