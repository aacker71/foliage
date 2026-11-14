#!/usr/bin/env node
/**
 * LAUNCH STATUS — what actually stands between this tree and a launch, measured.
 *
 * WHY THIS EXISTS. `.loop/STATUS.md` is the single source of truth for what is done, and it has
 * been WRONG more than once in exactly one way: a number was copied into a row and then rotted
 * there. F2 claimed 12 tests when its own introducing commit had 6. F6 claimed 44/44 when the
 * file it named held 21. README asserted "CI has never run" through four green CI runs. Every one
 * of those was a human writing down something a command could have answered.
 *
 * So this reads the ledger for the things only a human can know — what a capability IS, whether
 * an owner has decided — and MEASURES everything else fresh, every run. Where the two disagree it
 * says so rather than picking a winner: a drift report is useful, a silent correction is not.
 *
 *   node tools/launch/status.mjs            # measured status
 *   node tools/launch/status.mjs --drift    # only the disagreements
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not write to the ledger. Rows are edited by the phase
 * that did the work and can defend the claim, which is the discipline that keeps evidence attached
 * to assertions. A tool that auto-updated status would manufacture exactly the confident, unearned
 * claims this file exists to catch.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Status vocabulary, in the ledger's own priority order. `GATED` is deliberately last: it is not
 *  incomplete work, it is work waiting on a person, and mixing the two hides both. */
const ORDER = ["BROKEN", "DARK", "PARTIAL", "TODO", "BUILT", "DONE", "GATED"];

const BOLD = "[1m";
const DIM = "[2m";
const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const OFF = "[0m";

/**
 * A capability row, as the ledger states it. `evidence` is kept verbatim and never parsed for
 * meaning — the moment this tool started interpreting prose it would be inventing status.
 * @typedef {{id: string, capability: string, plane: string, status: string, evidence: string}} Row
 */

/**
 * Read the ledger. Rows are markdown table lines beginning with an id like `F1` or `X6`.
 * @returns {Promise<Row[]>}
 */
async function readLedger() {
  const text = await readFile(resolve(REPO, ".loop/STATUS.md"), "utf8");
  /** @type {Row[]} */
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^\|\s*([A-Z]\d+)\s*\|([^|]*)\|([^|]*)\|\s*([A-Z]+)\s*\|(.*)$/.exec(line);
    if (m === null) continue;
    rows.push({
      id: m[1] ?? "",
      capability: (m[2] ?? "").trim(),
      plane: (m[3] ?? "").trim(),
      status: m[4] ?? "",
      evidence: (m[5] ?? "").trim(),
    });
  }
  return rows;
}

/**
 * Run a command and return its stdout, or the reason it could not run. Never throws: a measurement
 * that fails is a fact to report, not an exception to crash on — the whole point is that this
 * command still tells you something useful on a broken tree.
 * @param {string} cmd
 * @param {readonly string[]} args
 * @returns {Promise<{ok: true, out: string} | {ok: false, cause: string}>}
 */
async function measure(cmd, args) {
  try {
    const { stdout } = await exec(cmd, [...args], { cwd: REPO, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, out: stdout };
  } catch (err) {
    const e = /** @type {{stdout?: string, message?: string}} */ (err);
    if (typeof e.stdout === "string" && e.stdout !== "") return { ok: true, out: e.stdout };
    return { ok: false, cause: e.message ?? String(err) };
  }
}

/** Count tests by running them. The number in any row is a copy; this is the original. */
async function measureTests() {
  const r = await measure("pnpm", ["run", "test"]);
  if (!r.ok) return { ok: /** @type {const} */ (false), cause: r.cause };
  const pass = /^# pass (\d+)$/m.exec(r.out) ?? /ℹ pass (\d+)/.exec(r.out);
  const fail = /^# fail (\d+)$/m.exec(r.out) ?? /ℹ fail (\d+)/.exec(r.out);
  return {
    ok: /** @type {const} */ (true),
    pass: Number(pass?.[1] ?? -1),
    fail: Number(fail?.[1] ?? -1),
  };
}

async function measureBoundary() {
  const r = await measure("node", ["scripts/check-public-boundary.mjs"]);
  return { intact: r.ok && /intact/i.test(r.out) };
}

/** Commits on this branch that exist on no remote — the work a disk failure would take. */
async function measureUnpushed() {
  const r = await measure("git", ["log", "--oneline", "--branches", "--not", "--remotes"]);
  if (!r.ok) return { count: -1 };
  const lines = r.out.split("\n").filter((l) => l.trim() !== "");
  return { count: lines.length };
}

async function measureUncommitted() {
  const r = await measure("git", ["status", "--porcelain"]);
  if (!r.ok) return { count: -1 };
  return { count: r.out.split("\n").filter((l) => l.trim() !== "").length };
}

/**
 * The graph, if one has been built. Reported as UNKNOWN rather than zero when absent: a missing
 * graph and an empty graph are different facts, and collapsing them is the error-masking pattern
 * this project keeps paying for.
 */
async function measureGraph() {
  try {
    const raw = await readFile(resolve(REPO, "graphify-out/graph.json"), "utf8");
    const g = JSON.parse(raw);
    /* graphify writes node-link JSON: edges live under `links`, not `edges`. Guessing the key
       cost two wrong readings — first -1, then 0 — for a graph that plainly holds 871 of them.
       `edges` is still accepted because the name is the obvious one for a future writer to use. */
    const nodes = Array.isArray(g.nodes) ? g.nodes.length : -1;
    const links = Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : null;
    return { built: /** @type {const} */ (true), nodes, edges: links === null ? -1 : links.length };
  } catch {
    return { built: /** @type {const} */ (false) };
  }
}

/**
 * Drift: claims in the ledger that a measurement contradicts. Only numbers stated in a form this
 * tool can recompute are checked — a claim it cannot verify is left alone rather than guessed at.
 * @param {Row[]} rows
 * @param {{pass: number} | {cause: string}} tests
 * @param {{built: boolean, nodes?: number}} graph
 */
function findDrift(rows, tests, graph) {
  /** @type {string[]} */
  const drift = [];

  for (const row of rows) {
    /*
     * WHOLE-SUITE test claims only, written `N/N` — the form this repo uses for a `pnpm check`
     * total. A bare "6 tests" is almost always a claim about ONE FILE (F2 measured
     * `node --test packages/leaf/src/leaf.test.ts`), and comparing that to the suite total
     * manufactured five false positives on the first run. A drift report that cries wolf is worse
     * than none, because the real entry gets skimmed past with the noise.
     */
    const claim = /\b(\d+)\s*\/\s*\1\b/.exec(row.evidence);
    if (claim !== null && "pass" in tests && tests.pass >= 0) {
      const claimed = Number(claim[1]);
      if (claimed !== tests.pass) {
        drift.push(
          `${row.id}: evidence states a suite total of ${claimed}/${claimed}; the suite now ` +
            `reports ${tests.pass}. The row may simply predate later work — but it reads as ` +
            `current, and that is how a stale number becomes a false claim.`,
        );
      }
    }
    /*
     * Graph claims, scoped to rows that actually name graphify. `N nodes / N edges` is also how
     * the vault reports its own index (F6: "127 nodes / 746 edges"), and checking that against
     * the code graph compared two unrelated things.
     */
    const namesGraphify = /graphify/i.test(row.capability) || /graphify/i.test(row.evidence);
    const g = /(\d[\d,]*)\s*nodes?\s*\/\s*(\d[\d,]*)\s*edges?/i.exec(row.evidence);
    if (namesGraphify && g !== null && graph.built && typeof graph.nodes === "number") {
      const claimed = Number((g[1] ?? "").replace(/,/g, ""));
      if (claimed !== graph.nodes) {
        drift.push(
          `${row.id}: evidence says ${claimed} nodes; graphify-out/graph.json holds ${graph.nodes}. ` +
            `Rebuild with \`graphify update .\` or correct the row.`,
        );
      }
    }
  }
  return drift;
}

async function main() {
  const driftOnly = process.argv.includes("--drift");
  const rows = await readLedger();

  const [tests, boundary, unpushed, uncommitted, graph] = await Promise.all([
    measureTests(),
    measureBoundary(),
    measureUnpushed(),
    measureUncommitted(),
    measureGraph(),
  ]);

  const drift = findDrift(rows, tests.ok ? { pass: tests.pass } : { cause: tests.cause }, graph);

  if (driftOnly) {
    if (drift.length === 0) {
      process.stdout.write(`${GREEN}no drift detected${OFF} between the ledger and what is measurable\n`);
      return;
    }
    process.stdout.write(`${YELLOW}${drift.length} drifted claim(s)${OFF}\n`);
    for (const d of drift) process.stdout.write(`  ${d}\n`);
    process.exitCode = 1;
    return;
  }

  const w = (s, n) => s.padEnd(n);
  process.stdout.write(`\n${BOLD}MEASURED NOW${OFF} ${DIM}(not read from any document)${OFF}\n`);
  if (tests.ok) {
    const bad = tests.fail > 0;
    process.stdout.write(
      `  tests          ${bad ? RED : GREEN}${tests.pass} pass, ${tests.fail} fail${OFF}\n`,
    );
  } else {
    process.stdout.write(`  tests          ${RED}could not run${OFF} — ${tests.cause.split("\n")[0]}\n`);
  }
  process.stdout.write(
    `  boundary       ${boundary.intact ? `${GREEN}intact${OFF}` : `${RED}VIOLATED${OFF}`}\n`,
  );
  process.stdout.write(
    `  unpushed       ${unpushed.count > 0 ? YELLOW : GREEN}${unpushed.count} commit(s)${OFF}` +
      `${unpushed.count > 0 ? `${DIM}  — on no remote; a disk failure takes them${OFF}` : ""}\n`,
  );
  process.stdout.write(`  uncommitted    ${uncommitted.count} file(s)\n`);
  process.stdout.write(
    `  code graph     ${graph.built ? `${graph.nodes} nodes / ${graph.edges} edges` : `${DIM}not built${OFF}`}\n`,
  );

  const byStatus = new Map();
  for (const r of rows) byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);

  process.stdout.write(`\n${BOLD}CAPABILITIES${OFF} ${DIM}(from .loop/STATUS.md — the source of truth)${OFF}\n`);
  for (const status of ORDER) {
    const group = byStatus.get(status);
    if (group === undefined) continue;
    process.stdout.write(`  ${w(status, 9)} ${group.length.toString().padStart(2)}  ${DIM}${group.map((r) => r.id).join(" ")}${OFF}\n`);
  }

  const gated = byStatus.get("GATED") ?? [];
  if (gated.length > 0) {
    process.stdout.write(`\n${BOLD}WAITING ON A PERSON${OFF} ${DIM}(no amount of engineering clears these)${OFF}\n`);
    for (const r of gated) process.stdout.write(`  ${r.id}  ${r.capability}\n`);
  }

  const incomplete = rows.filter((r) => r.status !== "DONE" && r.status !== "GATED");
  process.stdout.write(`\n${BOLD}NOT DONE${OFF} ${DIM}(${incomplete.length} rows)${OFF}\n`);
  for (const r of incomplete) {
    process.stdout.write(`  ${w(r.id, 4)} ${w(r.status, 8)} ${w(r.plane, 11)} ${r.capability}\n`);
  }

  process.stdout.write(`\n${BOLD}DRIFT${OFF} ${DIM}(ledger prose vs measurement)${OFF}\n`);
  if (drift.length === 0) {
    process.stdout.write(`  ${GREEN}none detected${OFF}\n`);
  } else {
    for (const d of drift) process.stdout.write(`  ${YELLOW}!${OFF} ${d}\n`);
  }

  process.stdout.write(
    `\n${DIM}This tool measures; it never edits the ledger. A row is corrected by the phase that ` +
      `did the work and can defend the claim.${OFF}\n\n`,
  );
}

await main();
