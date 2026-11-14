#!/usr/bin/env node
/**
 * verify — one command from "I changed something" to "here is what the browser says".
 *
 *   node tools/verify/verify.mjs                # every surface
 *   node tools/verify/verify.mjs photosynthesis # one surface
 *   node tools/verify/verify.mjs leaf --width 360
 *
 * WHAT IT COLLAPSES. Verifying a change used to be: kill ports, boot servers, wait,
 * curl headers, open a tab, snapshot, evaluate, screenshot, re-evaluate — ten-plus agent
 * turns, with the contrast maths retyped each time and servers dying between checks
 * because they were backgrounded from a shell that exited. All of that is here, and the
 * output is one structured verdict.
 *
 * WHAT IT WILL NOT DO: pass on its own say-so. Every check names the value it measured,
 * so a FAIL line is actionable and a PASS line is quotable as evidence. It never starts
 * a surface it cannot then reach over HTTP, and it never reports a check it did not run —
 * a surface whose server would not boot reports BOOT-FAILED, not "0 problems".
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { openPage, evaluate } from "./neo.mjs";
import { SURFACES } from "./surfaces.mjs";
import { isEntryPoint, servingVerdict, contractualZeroVerdicts, unmetPrecondition, responseMismatch, contrastIsOptional } from "./serving.mjs";
import { probeCode } from "./probe.mjs";
import { start } from "./managed.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The surfaces, their boot commands, and what each one ASSERTS. Adding a surface here is
 * how it joins the loop — the runner has no per-surface logic beyond this table.
 */

const { values, positionals: wanted } = parseArgs({
  options: { width: { type: "string" }, "port-offset": { type: "string", default: "0" } },
  allowPositionals: true, strict: true,
});
const WIDTH = values.width === undefined ? null : Number(values.width);
const OFFSET = Number(values["port-offset"]);
if (!Number.isInteger(OFFSET) || OFFSET < 0 || OFFSET > 60000) throw new Error("Invalid --port-offset");
if (WIDTH !== null && (!Number.isInteger(WIDTH) || WIDTH < 1)) throw new Error("Invalid --width");
const names = wanted.length > 0 ? wanted : Object.keys(SURFACES);
for (const name of names) if (!Object.hasOwn(SURFACES, name)) throw new Error(`Unknown surface: ${name}`);

async function reachable(port, path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
    return res;
  } catch {
    return null;
  }
}

/**
 * Use the same worktree-owned supervisor as serve; never adopt an arbitrary HTTP listener.
 * Servers remain available for inspection. `pnpm serve down` stops this worktree's children.
 */
export async function ensure(name, surface, opts = {}, env = process.env) {
  const unmet = unmetPrecondition(surface, env);
  if (unmet !== null) return { started: false, res: null, problem: unmet };
  try {
    const state = await start(ROOT, name, surface, opts, env);
    const { started } = state;
    if (state.state !== "ready") return { started, res: null, problem: state.detail ?? state.state };
    const res = await reachable(surface.port, surface.path);
    if (res === null) return { started, res: null, problem: "Owned server did not respond" };
    const problem = responseMismatch(surface, res, env);
    return problem === null ? { started, res } : { started, res: null, problem };
  } catch (error) {
    return { started: false, res: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
const lines = [];
let attempted = 0;
let failures = 0;
const ok = (m) => lines.push(`  PASS  ${m}`);
const bad = (m) => {
  failures++;
  lines.push(`  FAIL  ${m}`);
};

for (const name of names) {
  const original = SURFACES[name];
  const surface = { ...original, port: original.port + OFFSET };
  lines.push(`\n${name} — http://127.0.0.1:${surface.port}${surface.path}`);

  // A surface may name a precondition it refuses to default around. SKIP is not PASS and
  // not FAIL: the checks were not run, and the line says exactly why — the same "never
  // report a check it did not run" rule as BOOT-FAILED, for a surface never booted at all.
  const unmet = unmetPrecondition(surface, process.env);
  if (unmet !== null) {
    lines.push(`  SKIP  ${unmet}`);
    continue;
  }

  attempted++;
  const boot = await ensure(name, surface, {});
  if (boot.res === null) {
    bad(`BOOT-FAILED (${boot.problem ?? `exit ${boot.exited ?? "timeout"}`}) — no checks were run for this surface`);
    continue;
  }
  const verdict = servingVerdict(boot.res.status, boot.started);
  (verdict.serving ? ok : bad)(verdict.message);

  for (const [header, pattern] of Object.entries(surface.headers ?? {})) {
    const value = boot.res.headers.get(header) ?? "";
    if (pattern.test(value)) ok(`header ${header} matches ${pattern}`);
    else bad(`header ${header} = "${value}" does not match ${pattern}`);
  }
  for (const [header, forbidden] of Object.entries(surface.headerRefusals ?? {})) {
    const value = boot.res.headers.get(header) ?? "";
    if (forbidden.test(value)) bad(`header ${header} contains ${forbidden} — that backstop is contractual here`);
    else ok(`header ${header} still free of ${forbidden}`);
  }

  for (const check of surface.csrf ?? []) {
    const res = await fetch(`http://127.0.0.1:${surface.port}${check.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(check.origin ? { origin: check.origin } : {}),
      },
      body: check.body ?? "x=1",
    }).catch(() => null);
    if (res === null) bad(`${check.name}: request failed outright`);
    else if (res.status === check.expect) ok(`${check.name} → ${res.status}`);
    else bad(`${check.name} → ${res.status}, expected ${check.expect}`);
  }

  let page;
  try {
    page = await openPage(`http://127.0.0.1:${surface.port}${surface.path}`);
  } catch (err) {
    bad(`browser unreachable: ${err instanceof Error ? err.message : err}`);
    continue;
  }
  if (WIDTH !== null) {
    // Honest about the limitation this loop already recorded: neo cannot resize a
    // viewport, so a width request is REPORTED as unmet rather than faked by scaling.
    lines.push(`  NOTE  --width ${WIDTH} requested; neo cannot resize a viewport — measuring at the real one`);
  }

  const probe = await evaluate(page, probeCode(surface.probe ?? {}));
  if (typeof probe !== "object" || probe === null) {
    bad(`probe returned no object: ${String(probe).slice(0, 120)}`);
    continue;
  }

  probe.settled ? ok("settled (0 running animations)") : bad("NOT settled — measurements are mid-animation");
  probe.fonts.status === "loaded" && probe.fonts.size > 0
    ? ok(`fonts loaded (${probe.fonts.size})`)
    : bad(`fonts ${probe.fonts.status}, ${probe.fonts.size} face(s)`);
  probe.viewport.overflowsX
    ? bad(`horizontal overflow: scrollWidth ${probe.viewport.scrollWidth} > innerWidth ${probe.viewport.innerWidth}`)
    : ok(`no horizontal overflow at ${probe.viewport.innerWidth}px`);
  probe.h1Count === 1 ? ok("exactly one h1") : bad(`${probe.h1Count} h1 elements (${probe.headings})`);

  for (const c of probe.contrast) {
    if (c.missing) {
      // An OPTIONAL selector targets a state that may legitimately be absent — no
      // candidate is currently "approved but not yet promoted", say. Absence is
      // reported (the counts line shows it) but is not a defect; a REQUIRED selector
      // that vanished is a broken page and still fails.
      if (contrastIsOptional(c, probe.counts)) lines.push(`  ....  "${c.name}" not present in this state (${c.selector})`);
      else bad(`contrast: no element for "${c.name}" (${c.selector})`);
    }
    else if (c.pass) ok(`contrast ${c.name} ${c.ratio}:1 @${c.px}px (needs ${c.threshold})`);
    else bad(`contrast ${c.name} ${c.ratio}:1 @${c.px}px BELOW ${c.threshold}`);
  }
  const countLine = Object.entries(probe.counts).map(([k, v]) => `${k}=${v}`).join(" ");
  if (countLine !== "") lines.push(`  ....  counts: ${countLine}`);
  for (const v of contractualZeroVerdicts(surface.mustBeZero ?? [], probe.counts)) {
    (v.ok ? ok : bad)(v.message);
  }
  if (probe.fabricationMarkers > 0) lines.push(`  ....  fabrication markers: ${probe.fabricationMarkers} (expected on example data)`);
  if (probe.scoreShapedText.length > 0) {
    lines.push(`  ....  score-shaped text seen: ${JSON.stringify(probe.scoreShapedText)} — check whether it is carried evidence or authored`);
  }
}

console.log(lines.join("\n"));
console.log(`\n${attempted === 0 ? "NO CHECKS RUN" : failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

}

if (isEntryPoint(import.meta.url)) await main();
