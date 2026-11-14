/**
 * F-005 (.loop/FINDINGS.md) — the guard for a check that passed on a broken server.
 *
 * `pnpm verify` reported `PASS reachable` for whatever status a socket returned. Measured
 * 2026-08-19: photosynthesis answered HTTP 500 and canopy `/tree` answered 404, and both printed
 * PASS. The twelve `no element for …` failures that followed then read as a design problem rather
 * than as "the page never rendered", which is exactly backwards — the harness sent a reader
 * looking at CSS for a server fault.
 *
 * The decision is tested rather than the driver, because the driver needs a browser, a port and a
 * boot, and the reason this went unguarded for so long is that nothing that shape gets a test.
 * Pulling three lines out into a pure function is the whole difference between guardable and not.
 */

import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { probeCode } from "./probe.mjs";
import { servingVerdict, contractualZeroVerdicts, unmetPrecondition, contrastIsOptional, responseMismatch } from "./serving.mjs";
import { SURFACES } from "./surfaces.mjs";

test("F-005: a 500 is not reported as reachable", () => {
  const v = servingVerdict(500, true);
  equal(v.serving, false);
  ok(v.message.includes("SERVING-500"), v.message);
  ok(!v.message.startsWith("reachable"), `a 500 must not read as reachable: ${v.message}`);
});

test("F-005: a 404 is not reported as reachable", () => {
  // The canopy case. A route that does not exist is a different fault from a server that threw,
  // but both are "the page never rendered" and neither is a PASS.
  const v = servingVerdict(404, false);
  equal(v.serving, false);
  ok(v.message.includes("SERVING-404"), v.message);
});

test("F-005: the failure names WHY the element checks below will fail", () => {
  // Without this sentence the operator reads twelve contrast failures and starts editing tokens.
  const v = servingVerdict(500, true);
  ok(v.message.includes("not for a design one"), v.message);
});

test("2xx and 3xx are serving", () => {
  for (const s of [200, 204, 301, 302, 399]) {
    equal(servingVerdict(s, true).serving, true, `HTTP ${s} should be serving`);
  }
});

test("400 is the boundary, and it is on the failing side", () => {
  equal(servingVerdict(399, true).serving, true);
  equal(servingVerdict(400, true).serving, false);
});

test("the message says whether verify booted the surface or found it running", () => {
  // Load-bearing for the operator: "already running" means the failure may be from THEIR server,
  // in the state they left it, not from a fresh boot.
  ok(servingVerdict(200, true).message.includes("started by verify"));
  ok(servingVerdict(200, false).message.includes("already running"));
  ok(servingVerdict(500, false).message.includes("already running"));
});

/*
 * PR #22's correctness blocker — a count the surface CONTRACTS to be zero must be a verdict
 * that can fail the run, not an info line. These pin the pure decision, exactly as F-005
 * pinned servingVerdict: the driver needs a browser and a boot; the decision needs neither.
 */

test("a contractual zero that holds is a PASS verdict, named", () => {
  const [v] = contractualZeroVerdicts(["privateBadges"], { privateBadges: 0, leaflets: 235 });
  equal(v.ok, true);
  ok(v.message.includes("privateBadges = 0"), v.message);
});

test("a nonzero contractual count FAILS — the regression the export-site row exists to catch", () => {
  const [v] = contractualZeroVerdicts(["privateBadges"], { privateBadges: 106 });
  equal(v.ok, false);
  ok(v.message.includes("privateBadges = 106"), v.message);
});

test("an UNMEASURED contractual count fails — 'we did not look' is not 'it was zero'", () => {
  const [v] = contractualZeroVerdicts(["reviewLinks"], { privateBadges: 0 });
  equal(v.ok, false);
  ok(v.message.includes("never measured"), v.message);
});

test("no contract, no verdicts — every pre-existing surface is untouched by this gate", () => {
  deepEqual(contractualZeroVerdicts([], { leaflets: 5 }), []);
});

/*
 * The `requires` precondition gate — ONE spelling (round 2 of PR #22's seams pass found it
 * written twice, in verify.mjs and serve.mjs, with neither copy tested). Both callers now go
 * through `unmetPrecondition`; these pin the decision AND the real export-site row's own rule.
 * The serve-side WIRING is pinned by serve.test.mjs, through the real subprocess.
 */

test("a surface without requires may always run", () => {
  equal(unmetPrecondition({}, {}), null);
  equal(unmetPrecondition({ requires: undefined }, {}), null);
});

test("an unmet precondition comes back named; a met one comes back null", () => {
  const surface = { requires: (env) => (env.X ? null : "X is not set — do the thing first") };
  equal(unmetPrecondition(surface, {}), "X is not set — do the thing first");
  equal(unmetPrecondition(surface, { X: "1" }), null);
});

test("export-site's own rule: unset and empty FOLIAGE_SITE both refuse, with the remedy named", () => {
  const surface = SURFACES["export-site"];
  ok(surface !== undefined, "the export-site row exists");
  match(String(unmetPrecondition(surface, {})), /FOLIAGE_SITE=<dir>/);
  match(String(unmetPrecondition(surface, { FOLIAGE_SITE: "" })), /explicit address only/);
  equal(unmetPrecondition(surface, { FOLIAGE_SITE: "/tmp/some-export" }), null);
});


test("row contrast can be absent only when the measured export has no leaflets", () => {
  const row = SURFACES["export-site"].probe.contrast.find((c) => c.name === "leaflet title");
  equal(contrastIsOptional(row, { leaflets: 0 }), true);
  equal(contrastIsOptional(row, { leaflets: 1 }), false);
  equal(contrastIsOptional(row, {}), false);
  equal(contrastIsOptional(SURFACES["export-site"].probe.contrast[0], { leaflets: 0 }), false);
  equal(contrastIsOptional({ optional: true }, {}), true);
});

test("an unrelated HTTP server cannot stand in for the selected export", () => {
  const surface = SURFACES["export-site"];
  match(responseMismatch(surface, new Response(""), { FOLIAGE_SITE: "/tmp/export-contract" }), /does not identify/);
  equal(responseMismatch({}, new Response(""), {}), null);
  match(String(unmetPrecondition(surface, { FOLIAGE_SITE: "   " })), /explicit address only/);
});


test("the injected probe carries its empty-row condition back to the verdict", async () => {
  // An empty DOM harness tests the serialization seam, not browser colour/layout results.
  const fonts = new Set();
  fonts.ready = Promise.resolve();
  fonts.status = "loaded";
  const probe = await runInNewContext(`(async () => { ${probeCode(SURFACES["export-site"].probe)} })()`, {
    document: {
      fonts, getAnimations: () => [], querySelector: () => null, querySelectorAll: () => [],
      documentElement: { scrollWidth: 100 }, body: { innerText: "" }, title: "",
    },
    location: { href: "about:blank" }, innerWidth: 100, innerHeight: 100,
  });
  const row = probe.contrast.find((c) => c.name === "leaflet title");
  equal(row.missing, true);
  equal(contrastIsOptional(row, probe.counts), true);
  equal(contrastIsOptional(row, { leaflets: 1 }), false);
});

test("the review states the harness counts are the ones the review page renders", async () => {
  // The photosynthesis row measures the leaf app's /review. A renamed state once left
  // `[data-chip="live"]` here measuring nothing: an optional selector that matches no element is
  // skipped, and its count reads 0 as if no candidate had been added. So every review state the
  // page renders (`data-review-pill`) must be one the row counts, and the row may count no other.
  const { renderReviewPage } = await import("../../apps/leaf/src/render.ts");
  const evidence = [{ source: "git", ref: "1".repeat(40), observedAt: "2026-09-04T00:00:00Z" }];
  const draft = (id, review) => ({ id, title: `Synthetic ${id}`, extractor: "git-cluster", draftedAt: "2026-09-04T00:00:00Z", evidence, review });
  const decision = { by: "Synthetic reviewer", at: "2026-09-05T00:00:00Z" };
  const html = renderReviewPage({
    ok: true,
    path: "/synthetic/harvest.json",
    harvest: {
      subject: "Synthetic subject",
      leafId: "leaf:synthetic",
      candidates: [
        draft("a", { state: "candidate" }),
        draft("b", { state: "approved", ...decision }),
        draft("c", { state: "rejected", ...decision, reason: "synthetic" }),
      ],
    },
  });
  const rendered = new Set([...html.matchAll(/data-review-pill="([^"]+)"/g)].map((m) => m[1]));
  const { contrast, count } = SURFACES.photosynthesis.probe;
  const probed = new Set(
    [...contrast.map((c) => c.selector), ...Object.values(count)]
      .flatMap((selector) => [...selector.matchAll(/\[data-review-pill="([^"]+)"\]/g)].map((m) => m[1])),
  );
  deepEqual([...probed].sort(), [...rendered].sort());
});
