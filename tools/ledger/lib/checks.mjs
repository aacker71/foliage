/**
 * The checks themselves, pure over facts the CLI gathers from disk and git.
 *
 * Separating "what is true about the tree" from "what that means about the ledger" is what
 * lets the tests drive REAL ledger prose through the REAL rules without a repository, a
 * clock, or a git binary. Every function here takes facts and returns findings.
 *
 * SEVERITY, and the rule that decides it.
 *
 *   FAIL  a reasonable person would agree the ledger is wrong, and the evidence is mechanical:
 *         a status outside the ledger's own vocabulary, a DONE row whose own subject changed
 *         after it was last verified, an unanchored count that disagrees with a number
 *         re-derived from the tree.
 *   WARN  the same defect where the mapping was inferred from prose, or where the number is
 *         anchored to a past observation and may be a deliberate historical record.
 *   INFO  facts a human should see and the gate refuses to judge — an unmapped row, a count
 *         this tool cannot re-derive.
 *
 * The asymmetry is deliberate. A gate that cries wolf gets disabled, and a disabled gate is
 * worse than none — so anything resting on a heuristic warns, and only mechanical
 * contradictions fail.
 *
 * WHAT THESE CHECKS CANNOT SEE, and it is a lot:
 *   - whether a row's PROSE is true. "0 verified / 19 pending" is not re-derived here; only
 *     the shapes named in parse.mjs are.
 *   - whether a DONE row was ever actually opened in a browser. Nothing mechanical can.
 *   - a row whose code changed in a file the row never names — the staleness check is only as
 *     good as the scope, which is why unmapped rows are reported rather than passed.
 *   - anything about a repository outside this tree, which several rows cite as evidence.
 */

import { extractClaims, parseStatus, parseVerified } from "./parse.mjs";

const f = (level, check, row, summary, detail) => ({
  level,
  check,
  id: row?.id ?? "—",
  line: row?.line ?? 0,
  summary,
  detail,
});

/** The ledger's strongest claim. The only status this file knows by name, and it says why. */
const STRONGEST = "DONE";

// ---------------------------------------------------------------------------------------
// 4. Structural integrity — the ledger's own format is part of its trustworthiness.
// ---------------------------------------------------------------------------------------

/**
 * `strays` are lines inside a capability table that did not parse as a row (see parse.mjs).
 * `previousRows` are the rows parsed from the LAST COMMITTED ledger, or null when there is no
 * previous version to compare against — the floor check below.
 */
export function checkStructure(rows, vocabulary, { strays = [], previousRows = null } = {}) {
  const out = [];

  // A line the parser could not read is a line this gate is not checking. Before it was
  // reported, such a line ended the table and every row below it vanished silently.
  for (const stray of strays) {
    out.push(
      f("fail", "structure", { id: "—", line: stray.line }, "a line inside a capability table is not a row", [
        `line: ${JSON.stringify(stray.text.length > 90 ? stray.text.slice(0, 90) + "…" : stray.text)}`,
        "Rows follow it, so it is a hole in the table rather than the end of one. A blank line,",
        "an HTML comment or a stray note here used to discard every row below it in silence.",
      ]),
    );
  }

  // THE FLOOR. Rows do not leave this ledger in the ordinary course — it grows, and a row that
  // stops being true changes status rather than disappearing. So a shrinking row set is either
  // a deliberate deletion, which belongs in the commit that makes it and can be read here, or
  // a parser that stopped seeing rows, which is this gate switching itself off. Both are worth
  // a human's attention; only the second is a catastrophe, so the size of the drop sets the
  // severity. Compare by ID rather than by count: "which rows" is the actionable question.
  if (previousRows) {
    const here = new Set(rows.map((r) => r.id));
    const gone = previousRows.map((r) => r.id).filter((id) => id && !here.has(id));
    if (gone.length) {
      const collapse = gone.length * 2 > previousRows.length;
      out.push(
        f(
          collapse ? "fail" : "warn",
          "structure",
          null,
          `${gone.length} row(s) present in the last committed ledger are gone: ${gone.join(" ")}`,
          [
            `the committed ledger parses ${previousRows.length} rows; this one parses ${rows.length}`,
            "Read `git show HEAD:.loop/STATUS.md`. If the rows were deleted on purpose, the commit",
            "that deletes them says so and this clears on the next commit.",
            collapse
              ? "More than half the rows vanished at once. That is the shape of a parser failure, and"
              : "A small drop is reported rather than failed — a deliberate deletion is legitimate and",
            collapse
              ? "a gate that has stopped reading most of the ledger must not report a clean run."
              : "this gate must not go red on it.",
          ],
        ),
      );
    }
  }

  if (vocabulary.size === 0) {
    out.push(
      f("fail", "structure", null, "the ledger declares no status vocabulary", [
        "This gate reads the vocabulary from the ledger's own `Status | Means` table rather",
        "than hardcoding it. Without that table every status is unverifiable.",
      ]),
    );
  }
  const seen = new Map();
  for (const row of rows) {
    if (row.cellCount !== 6) {
      out.push(f("fail", "structure", row, `row has ${row.cellCount} cells, not 6`, [row.id]));
      continue;
    }
    if (!/^[A-Z]+\d+$/.test(row.id)) {
      out.push(f("fail", "structure", row, `row id "${row.id}" is not an id`, []));
    } else if (seen.has(row.id)) {
      out.push(f("fail", "structure", row, `duplicate row id "${row.id}"`, [`also at line ${seen.get(row.id)}`]));
    } else {
      seen.set(row.id, row.line);
    }

    const status = parseStatus(row.status);
    if (vocabulary.size && !vocabulary.has(status)) {
      out.push(
        f("fail", "structure", row, `status "${row.status.trim()}" is not in the declared vocabulary`, [
          `declared: ${[...vocabulary].join(", ")}`,
        ]),
      );
    }

    const verified = parseVerified(row.verified);
    if (verified === undefined) {
      out.push(
        f("fail", "structure", row, `"last verified" is neither a date nor an explicit em-dash`, [
          `cell: ${JSON.stringify(row.verified)}`,
        ]),
      );
    } else if (verified === null && status === STRONGEST) {
      out.push(
        f("fail", "structure", row, `${STRONGEST} with no verification date`, [
          `${STRONGEST} is the ledger's strongest claim — "verified end to end". An em-dash says`,
          "it was never verified. The two cannot both be true.",
        ]),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 1. Staleness by construction — the code changed after the row was last verified.
// ---------------------------------------------------------------------------------------

/**
 * `facts.changeOf(path)` → { day: "YYYY-MM-DD"|null, committed: boolean } — when the tree
 * last changed under that path, from committed history or the working tree, whichever is
 * later.
 *
 * Dates are compared at DAY granularity, and that is the conservative direction on purpose:
 * a row verified on the same day as a commit is NOT called stale, because nothing in the
 * ledger records the hour and this gate will not invent one.
 *
 * `facts.history` → { complete, reason, remedy }. THE WHOLE CHECK REFUSES TO RUN when the
 * history is not complete, and that refusal is the single most important line in this file.
 * In a `--depth 1` clone `git log -1 -- <path>` answers with the TIP commit's date for every
 * path, so every dated row reports STALE — measured: three correct rows, three failures, on a
 * ledger that was right. `actions/checkout` defaults to depth 1 and THIS repository has
 * already been bitten by that default once (`fetch-depth: 0` in .github/workflows/ci.yml
 * carries the note). Emitting findings from data that cannot support them is how a gate earns
 * the reputation that gets it deleted; naming what is missing is not.
 */
export function checkStaleness(rows, facts) {
  const out = [];
  const history = facts.history ?? { complete: true };
  if (!history.complete) {
    return [
      f("warn", "staleness", null, `STALENESS NOT CHECKED — ${history.reason}`, [
        "Every dated row would report STALE here, and every one of those would be an artifact of",
        "the clone rather than a fact about the ledger. No finding is emitted at all.",
        history.remedy,
        "This is a WARNING, never a failure: the ledger is not wrong, the checkout is too thin.",
      ]),
    ];
  }
  for (const row of rows) {
    const status = parseStatus(row.status);
    const verified = parseVerified(row.verified);
    if (verified === undefined || verified === null) continue; // structure already reported it

    const scope = facts.scopeOf(row);
    if (scope.confidence === "unmapped") {
      out.push(
        f("info", "staleness", row, "UNMAPPED — no code scope could be resolved, so staleness was NOT checked", [
          "The row names no package or path in backticks, so this gate cannot tell whether the",
          "code under it has changed. This is not a pass. Name the code the row is about.",
        ]),
      );
      continue;
    }

    let latest = null;
    const uncommitted = [];
    for (const p of scope.paths) {
      const c = facts.changeOf(p);
      if (!c.committed) uncommitted.push(p);
      if (c.day && (latest === null || c.day > latest)) latest = c.day;
    }

    if (uncommitted.length) {
      out.push(
        f("warn", "staleness", row, `scope is not in git: ${uncommitted.join(", ")}`, [
          "The row's evidence describes code that has never been committed. Nobody else can",
          "obtain the tree this row is a claim about.",
        ]),
      );
    }

    if (latest && latest > verified) {
      const named = scope.confidence === "named";
      const mechanical = named && status === STRONGEST;
      out.push(
        f(
          mechanical ? "fail" : "warn",
          "staleness",
          row,
          `STALE — ${status} last verified ${verified}, but ${scope.paths.join(", ")} changed ${latest}`,
          [
            named
              ? "scope: named by the capability column"
              : "scope: inferred from the evidence prose, so it may be wider than the row's subject",
            mechanical
              ? `${STRONGEST} is the strongest claim in the vocabulary and needs the freshest evidence.`
              : named
                ? `Warning, not failure: ${status} is a weaker claim than ${STRONGEST}.`
                : "Warning, not failure: the scope was inferred rather than named.",
          ],
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 2. Re-derivable counts.
// ---------------------------------------------------------------------------------------

/**
 * `facts.deriveTests(target)` → { count } | { undeclared: reason }, where target is
 * `{ from: "suite" }` or `{ from: "paths", paths: [...] }`.
 *
 * WHERE A NUMBER IS DERIVED FROM IS PART OF THE CLAIM, and getting that wrong made this check
 * commit the very defect it exists to catch. It used to default an UNMAPPABLE row's target to
 * the whole suite: a row reading "the narrow rules are covered by 4 tests that pass" — a true
 * sentence about a subset — produced a hard FAIL, `row claims 4 tests; the whole suite derives
 * 5`, in the same run that listed that row under UNMAPPED. Asserting a derived figure against
 * a scope the gate has just said it could not resolve is a copied number wearing the gate's
 * own badge. So there are now three answers and "I do not know" is one of them:
 *
 *   hint      the clause names its own derivation (`pnpm check`, `node --test <path>`) — use
 *             it, and a disagreement is mechanical, so it may FAIL.
 *   named     no hint, but the CAPABILITY column resolves — the row's own statement of its
 *             subject. Derive over those paths; a disagreement may FAIL.
 *   inferred  the scope came from evidence prose. Derive, but cap the finding at WARN, exactly
 *             as the staleness check does — a guessed scope must never go red.
 *   unmapped  refuse. INFO, no number asserted.
 */
export function checkCounts(rows, facts) {
  const out = [];
  const agreed = [];

  for (const row of rows) {
    const scope = facts.scopeOf(row);
    for (const claim of extractClaims(row.evidence)) {
      if (claim.kind === "graph") {
        const hint = facts.deriveHintForGraph?.(row);
        out.push(
          f(
            "info",
            "counts",
            row,
            `"${claim.text}" is not re-derivable by this gate`,
            Array.isArray(hint) ? hint : [hint ?? "Re-derive it by hand and record it with an observation time."],
          ),
        );
        continue;
      }

      if (claim.delta) {
        out.push(
          f("info", "counts", row, `"${claim.text}" reads as a delta, not a total — not compared`, [
            "The clause says this number is what the change ADDED, and this gate re-derives totals.",
            "Comparing a delta against a total is arithmetic on two different quantities; it used to",
            "produce a hard failure on a correctly-phrased row. Nothing is asserted about it here.",
          ]),
        );
        continue;
      }

      const target = claim.hint ?? (scope.confidence === "unmapped" ? null : { from: "paths", paths: scope.paths });
      if (!target) {
        out.push(
          f("info", "counts", row, `"${claim.text}" is not compared — the row's scope is UNMAPPED`, [
            "The row names neither a derivation command nor a path this gate can resolve, so there is",
            "no scope to re-derive the number over. The suite total is not a stand-in for a scope the",
            "gate just failed to find. Name the code the row is about, or the command that produced",
            "the number, and this becomes checkable.",
          ]),
        );
        continue;
      }
      const capped = !claim.hint && scope.confidence === "inferred";

      const derived = facts.deriveTests(target);
      const where = target.from === "suite" ? "the whole suite" : target.paths.join(", ");

      if (derived.undeclared) {
        out.push(
          f("info", "counts", row, `"${claim.text}" could not be re-derived`, [
            `target: ${where}`,
            derived.undeclared,
            "No number is asserted here rather than a guessed one.",
          ]),
        );
        continue;
      }

      if (derived.count === claim.value) {
        agreed.push({ id: row.id, text: claim.text, where });
        continue;
      }

      // These heuristics can only ever DOWNGRADE this finding, never hide it. The number and
      // the derived value are printed either way; what changes is whether the build goes red.
      const detail = capped
        ? [
            "The scope was INFERRED from the evidence prose rather than named by the capability",
            "column, so it may be wider or narrower than the row's actual subject — warning, not",
            "failure, on the same rule the staleness check uses. Name the scope to make it fail.",
          ]
        : claim.corrected
        ? [
            "The row itself reports this number as wrong and states the corrected one beside it.",
            "That is correct practice — recording the defect is the point — so it warns rather",
            "than fails. The derived value is printed so the correction can be checked too.",
          ]
        : claim.anchored
          ? [
              "The clause names an observation time, a commit or a run id, so this is plausibly a",
              "deliberate historical record — warning, not failure. It is still not the number a",
              "reader would get today, and nothing on the row says so.",
            ]
          : [
              "The number carries no observation time, so it reads as a present-tense claim, and",
              "it is false. Either re-derive it or record it with when it was observed.",
            ];
      out.push(
        f(
          capped || claim.corrected || claim.anchored ? "warn" : "fail",
          "counts",
          row,
          `COUNT — row claims "${claim.text}"; ${where} derives ${derived.count}`,
          detail,
        ),
      );
    }
  }
  return { findings: out, agreed };
}

/** Rows that assert no verification date at all. Nothing about them is checkable; say so. */
export const undatedRows = (rows) =>
  rows.filter((r) => parseVerified(r.verified) === null).map((r) => r.id);

// ---------------------------------------------------------------------------------------
// 3. Dark detection — a package nothing outside itself consumes.
// ---------------------------------------------------------------------------------------

const DARK = "DARK";

/**
 * `packages` is [{ name, dir, isApp, hasBin, consumers: [...] }].
 *
 * TWO EXEMPTIONS, and they are the same reason twice: an ENTRY POINT is invoked, not imported,
 * so "nothing imports it" says nothing about whether it is reachable.
 *   - an app, because an application is where execution starts;
 *   - a package whose manifest declares a `bin`, because a CLI is started by an operator or a
 *     script and having no importer is its normal, correct state. Without this a perfectly
 *     reachable command-line package reads DARK, and the row that correctly says DONE fails.
 *
 * The cost is stated rather than hidden: a `bin` nobody ever runs is invisible to this check.
 * That is the direction chosen to be wrong in, because a false DARK on a working CLI is the
 * kind of noise that gets a check deleted, and a deleted check catches nothing at all.
 */
export function checkDark(rows, packages) {
  const out = [];
  const rowFor = (name) =>
    rows.find((r) => r.capability.includes("`" + name + "`")) ??
    rows.find((r) => r.capability.includes(name));

  for (const pkg of packages) {
    if (pkg.isApp || pkg.hasBin || pkg.consumers.length > 0) continue;
    const row = rowFor(pkg.name);
    if (!row) {
      out.push(
        f("warn", "dark", null, `${pkg.name} has no non-test consumer and no ledger row`, [
          "This ledger's own definition of DARK is \"a package with no consumer\". A package with",
          "neither a consumer nor a row is invisible to the source of truth.",
        ]),
      );
      continue;
    }
    const status = parseStatus(row.status);
    if (status === DARK) {
      out.push(
        f("info", "dark", row, `${pkg.name} has no non-test consumer — and the row says ${DARK}`, [
          "Correctly recorded. This check stays because the row was BUILT until a graph query",
          "proved otherwise.",
        ]),
      );
      continue;
    }
    out.push(
      f(
        status === STRONGEST ? "fail" : "warn",
        "dark",
        row,
        `${pkg.name} has no non-test consumer, but the row reads ${status}`,
        [
          "Nothing outside the package's own directory imports it, declares it as a dependency,",
          `or resolves it. By this ledger's definition that is ${DARK}.`,
        ],
      ),
    );
  }
  return out;
}
