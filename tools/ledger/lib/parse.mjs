/**
 * Parsing `.loop/STATUS.md` into rows, and rows into CLAIMS.
 *
 * Everything here is pure text→data. No disk, no git, no clock — so the tests can drive it
 * with real ledger prose and the CLI can drive it with the real file, and they exercise the
 * same code.
 *
 * TWO PARSING DECISIONS WORTH DEFENDING.
 *
 * 1. The status vocabulary is READ FROM THE LEDGER, never hardcoded here. The ledger declares
 *    it in its own table ("Status | Means"), exactly as public-boundary.json declares the
 *    planes for the boundary gate. A vocabulary copied into this file would be a fifth copy of
 *    the bug this tool exists to catch.
 *
 * 2. A capability table is identified by its HEADER, not by position. If the ledger is
 *    reshaped and no table matches, the caller must fail loudly rather than report "0 problems
 *    in 0 rows" — a gate whose parser silently finds nothing is a gate that has been disabled
 *    without anyone noticing.
 *
 * THAT SECOND PROMISE WAS BROKEN AT ONE ROW INSTEAD OF ZERO, and the fix is the reason
 * `parseRows` is shaped the way it is. It used to `break` out of a table at the first line
 * that did not parse as a row, so a blank line, an HTML comment or a stray note mid-table
 * silently discarded every row below it. Measured on a three-row fixture with a blank line
 * after row 1: `1 rows in 1 table(s)`, "ledger agrees with the tree", exit 0 — while the two
 * dropped rows carried a malformed date and a DONE claim on a package with no consumer. The
 * no-op guard only ever fired at ZERO rows, so it never saw this.
 *
 * The replacement reads a table REGION rather than a run of rows: everything between the
 * divider and the next heading, thematic break, or new table header. Inside that region a
 * line either parses as a row or is a STRAY, and strays are RETURNED, not skipped — the
 * caller reports them. Trailing strays are dropped, because prose after the last row is the
 * document resuming, not a hole in the table. That asymmetry is the whole design: a gap
 * BETWEEN rows is a defect, a gap AFTER them is the end of the table.
 */

/**
 * Split a markdown table row into trimmed cells, resolving escaped pipes.
 *
 * `\|` is the only legal way to put a pipe inside a table cell — GFM resolves that escape
 * before it splits the row, and a table cell is the one place a backslash escape reaches
 * inside a code span. A bare `.split("|")` therefore turns CORRECT markdown into a structural
 * failure, and this ledger's evidence cells quote shell commands constantly. Measured before
 * this fix: an evidence cell containing `` `git log \| wc -l` `` produced a hard FAIL, "row
 * has 7 cells, not 6", on a row that was right.
 *
 * The escape is RESOLVED rather than merely tolerated: the cell handed back contains a real
 * pipe, because everything downstream (scope tokens, count claims) reads the prose itself.
 * `\\` is consumed as an escaped backslash so that a trailing backslash cannot swallow the
 * cell separator after it.
 */
function cells(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const parts = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && (t[i + 1] === "|" || t[i + 1] === "\\")) {
      cur += t[i + 1];
      i++;
      continue;
    }
    if (c === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  parts.shift(); // the leading pipe every row starts with
  if (parts.length && parts[parts.length - 1] === "") parts.pop(); // the optional trailing one
  return parts.map((c) => c.trim());
}

const isDivider = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

/**
 * A line that ends a capability table's REGION: a markdown heading or a thematic break. A
 * divider line starts with `|` and so never matches here — it is handled separately, because
 * a divider means a second table is starting rather than the document resuming.
 */
const endsRegion = (line) => /^#{1,6}\s/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

/** The header this tool understands. A table not shaped like this is not a capability table. */
const CAPABILITY_HEADER = ["id", "capability", "plane", "status", "evidence / blocker", "last verified"];

/**
 * Read the declared status vocabulary out of the ledger's own "Status | Means" table.
 * Returns a Set of upper-case status words, or an empty Set if the table is absent — which
 * the caller must treat as a structural failure, not as "anything goes".
 */
export function parseVocabulary(text) {
  const lines = text.split("\n");
  const vocab = new Set();
  for (let i = 0; i < lines.length; i++) {
    const head = cells(lines[i]);
    if (!head || head.length !== 2) continue;
    if (head[0].toLowerCase() !== "status" || head[1].toLowerCase() !== "means") continue;
    if (!isDivider(lines[i + 1] ?? "")) continue;
    for (let j = i + 2; j < lines.length; j++) {
      const row = cells(lines[j]);
      if (!row || row.length !== 2) break;
      const m = row[0].match(/^`([A-Z_]+)`$/);
      if (m) vocab.add(m[1]);
    }
    break;
  }
  return vocab;
}

const isCapabilityHeader = (parsed) =>
  Boolean(parsed) &&
  parsed.length === CAPABILITY_HEADER.length &&
  parsed.every((c, k) => c.toLowerCase() === CAPABILITY_HEADER[k]);

/**
 * Parse every capability table. Rows carry their source line number so a finding can point at
 * the row a human has to edit.
 *
 * `section` is the nearest preceding `##` heading — it is reported, never acted on.
 *
 * Returns `{ rows, tables, strays }`. A STRAY is a line inside a table region that does not
 * parse as a row and has rows after it; see the header for why those are returned rather than
 * treated as the end of the table.
 */
export function parseRows(text) {
  const lines = text.split("\n");
  const rows = [];
  const strays = [];
  let section = "(none)";
  let tables = 0;

  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.*)$/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const head = cells(lines[i]);
    if (!isCapabilityHeader(head)) continue;
    if (!isDivider(lines[i + 1] ?? "")) continue;

    tables++;

    // The region: everything up to the next heading, thematic break, or start of a new table.
    const region = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (endsRegion(line) || isDivider(line)) break;
      const parsed = cells(line);
      if (isCapabilityHeader(parsed)) break;
      region.push({ line: j + 1, text: line, cells: parsed });
    }
    i = j - 1; // resume the outer scan ON the terminating line, so a heading is still seen

    // Prose after the last row is the document resuming, not a hole in the table.
    while (region.length && !region[region.length - 1].cells) region.pop();

    for (const entry of region) {
      if (!entry.cells) {
        strays.push({ line: entry.line, section, text: entry.text });
        continue;
      }
      const row = entry.cells;
      // A short or long row is still a row — it is reported as malformed, never dropped.
      rows.push({
        line: entry.line,
        section,
        cellCount: row.length,
        id: row[0] ?? "",
        capability: row[1] ?? "",
        plane: row[2] ?? "",
        status: row[3] ?? "",
        evidence: row[4] ?? "",
        verified: row[5] ?? "",
      });
    }
  }
  return { rows, tables, strays };
}

/** `2026-08-16` → `2026-08-16`; `—`/`-`/`–` → null; anything else → undefined (malformed). */
export function parseVerified(cell) {
  const t = cell.trim().replace(/\*/g, "");
  if (t === "—" || t === "–" || t === "-") return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d] = m[1].split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return m[1];
}

/** Strip markdown emphasis so `**DONE**` and `DONE` are the same status. */
export const parseStatus = (cell) => cell.trim().replace(/[`*_]/g, "").toUpperCase();

// ---------------------------------------------------------------------------------------
// Count claims.
//
// Only two shapes are extracted, and that narrowness is deliberate: these are the two that
// have actually rotted in this repo's history ("12 tests", "44/44 tests", "167 tests"), and
// they are the two that can be re-derived from the tree without running anything expensive.
// Prose numbers like "681 real commits" or "1930 commits" are NOT extracted — they describe
// external repositories this gate cannot see, and inventing an expectation for them is how a
// count-checker becomes the fifth instance of the bug it exists to catch.
// ---------------------------------------------------------------------------------------

const CLAIM_PATTERNS = [
  // "167 tests", "6 tests pass", "5 tests"
  { kind: "tests", re: /(\d+)\s+tests?\b/g, value: (m) => Number(m[1]) },
  // "146/146", "21/21" — only when both halves agree and the clause is about testing.
  { kind: "suite", re: /\b(\d+)\/(\d+)\b/g, value: (m) => (m[1] === m[2] ? Number(m[1]) : null) },
  // Counts this gate cannot re-derive. Extracted so they can be LISTED, never compared.
  { kind: "graph", re: /(\d+)\s+(nodes|edges|communities|pairs)\b/g, value: (m) => Number(m[1]) },
];

/**
 * The window used for the two context heuristics below. Both heuristics only ever change a
 * finding's SEVERITY — never whether it is printed. That is the property that makes a
 * heuristic safe to ship in a gate: being wrong about the window loses a FAIL, never a fact.
 */
const CONTEXT = 100;

/**
 * Markers that say "this number is a record of a past observation, not a present claim".
 *
 * The sha pattern requires at least one hex LETTER. Without it, any 7+ digit number reads as
 * a sha — which would have made a CI run id anchor a count by accident rather than on
 * purpose, and accidental anchoring silently downgrades a failure to a warning.
 */
const ANCHOR = [
  /\bobservedAt\b/,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // an ISO timestamp
  /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b(?![.\d])/, // a commit sha
  /\brun\s+\**\d{8,}/i, // a CI run id, markdown emphasis and all
  /\bat HEAD\b/i,
  // A BARE DATE, but only when an observation word claims it. The ledger's own `last verified`
  // column is a DATE, not a timestamp, and staleness is compared at day granularity — so
  // refusing a day-granular anchor made the gate inconsistent with itself: it told the author to
  // "record it with when it was observed", then rejected the ledger's own way of recording that.
  // The observation word is REQUIRED and must abut the date, because these evidence cells discuss
  // dates constantly and a bare `\d{4}-\d{2}-\d{2}` would anchor live counts by accident — the
  // silent-downgrade failure this list's header warns about.
  /\b(?:observed|measured|recorded|as of)\b[^.\n]{0,24}\d{4}-\d{2}-\d{2}/i,
];

/**
 * Markers that say "the row itself already reports this number as wrong".
 *
 * Deliberately narrow. `stale` and `copied` were tried and removed: these evidence cells
 * discuss staleness constantly, so those words marked live counts as already-corrected and
 * quietly disarmed the check. A marker has to be about a NUMBER being wrong.
 */
const CORRECTED = [
  /\b(is|was|were|are) wrong\b/i,
  /\bnever true\b/i,
  /\balways was\b/i,
  /\bover-counts?\b/i,
  /\bis corrected\b/i,
  /\bnot\s+\d/i,
];

/**
 * Phrasing that makes a number a DELTA rather than a total.
 *
 * "this change adds 2 tests on top of what was there" is a true sentence about a 3-test
 * package, and before this it produced a hard FAIL — `row claims "2 tests"; packages/alpha
 * derives 3` — because every extracted number was compared as if it were a total. A gate that
 * goes red on a correctly-phrased row is the failure mode that gets a gate deleted.
 *
 * Matched against the text IMMEDIATELY BEFORE the number, not the 100-character context
 * window the other two heuristics use. That is deliberate and it is the safety property: a
 * delta marker turns a comparison off, so unlike ANCHOR and CORRECTED — which only downgrade
 * a failure to a warning — a loose one here could hide a real defect. It has to abut the
 * number it is describing. Markdown emphasis is allowed between them and nothing else.
 */
const DELTA_PREFIX =
  /\b(?:add|adds|added|adding|plus|introduce|introduces|introduced|gain|gains|gained|net)\s+(?:\*{1,2}|_{1,2})?$|[+]\s*$/i;

/**
 * Explicit derivation targets named inside the clause, in precedence order.
 *
 * A trailing glob segment is stripped to its directory (`tools/vault/lib/*.test.mjs` →
 * `tools/vault/lib`) because the target is a place to look for test files, not a pattern to
 * match — and a glob left in place resolves to nothing, which would silently turn a
 * checkable count into an un-derivable one.
 */
function deriveHintFrom(context) {
  // `\b` after "check" MATCHES inside `check:boundary`, because ":" is a non-word character and
  // therefore a word boundary. So `pnpm check:boundary` — which runs the licensing gate and no
  // tests at all — used to be read as "the whole suite", and any count near it was compared
  // against every test in the repository. That is the copied-number bug this gate exists to
  // catch, committed by the gate. The sub-script name has to be excluded explicitly.
  if (/pnpm (run )?(check|test)(?![:\w-])/.test(context)) return { from: "suite" };
  const cmd = context.match(/node --test\s+([^`\n]+)/);
  if (cmd) {
    const paths = cmd[1]
      .trim()
      .split(/\s+/)
      .map((p) => p.replace(/^["']|["']$/g, "").replace(/\/[^/]*\*[^/]*$/, ""))
      .filter((p) => p.includes("/") && !p.includes("*"));
    if (paths.length) return { from: "paths", paths };
  }
  return null;
}

const any = (res, s) => res.some((re) => re.test(s));

/**
 * Extract every count claim in a row's evidence cell, each carrying:
 *   value      the number claimed
 *   anchored   the clause names an observation time / sha / run id → a historical record
 *   corrected  the row itself says the number is wrong → correct practice, already fixed
 *   delta      the clause reads "adds N tests" → a change, not a total, so not comparable
 *   hint       an explicit derivation target named in the clause
 */
export function extractClaims(evidence) {
  const raw = [];
  for (const { kind, re, value } of CLAIM_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(evidence)) !== null) {
      const v = value(m);
      if (v === null || !Number.isFinite(v)) continue;
      const start = Math.max(0, m.index - CONTEXT);
      const context = evidence.slice(start, m.index + m[0].length + CONTEXT);
      // A bare ratio is only a suite claim if its clause is actually about testing.
      if (kind === "suite" && !/\b(test|check|pass)/i.test(context)) continue;
      raw.push({
        kind,
        text: m[0],
        value: v,
        unit: kind === "graph" ? m[2] : "tests",
        index: m.index,
        end: m.index + m[0].length,
        anchored: any(ANCHOR, context),
        corrected: any(CORRECTED, context),
        delta: kind === "tests" && DELTA_PREFIX.test(evidence.slice(Math.max(0, m.index - 40), m.index)),
        hint: kind === "graph" ? null : deriveHintFrom(context),
      });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.end - a.end);

  // `"44/44 tests"` matches BOTH patterns over overlapping spans and is one claim, not two.
  // The `suite` span is the wider one and wins.
  const suites = raw.filter((c) => c.kind === "suite");
  const unoverlapped = raw.filter(
    (c) => c.kind !== "tests" || !suites.some((s) => c.index >= s.index && c.index < s.end + 7),
  );

  // One finding per distinct number per unit. A row that repeats "44/44" three times while
  // explaining how it got there does not deserve three identical findings; the first
  // occurrence carries the clause that introduced it, so its context is the one to keep.
  const out = [];
  const seen = new Set();
  for (const c of unoverlapped) {
    const key = `${c.unit}:${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
