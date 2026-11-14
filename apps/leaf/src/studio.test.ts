/**
 * THE STUDIO — unit tests for the four new owner pages (`overview.ts`, `garden.ts`,
 * `policyPage.ts`, `publishPreview.ts`) and for the nav `page()` now carries.
 *
 * FIXTURES HERE ARE SYNTHETIC ON PURPOSE, the same convention `render.test.ts` and `seam.test.ts`
 * already use for structural tests: a minimal, clearly-labelled document ("first verified",
 * "waiting on proof") pins the CONTRACT (which attribute holds which fact, which state produces
 * which markup) without needing a real person's evidence to do it. Nothing here is presented as,
 * or claims to be, a real portfolio — that proof is `studioSeam.test.ts`, which runs the real
 * server against the real documents this app already loads (`apps/leaf/leaf.json` /
 * `harvest.json` / `policy.json`, the owner's own repository history) and checks REAL numbers.
 *
 * WHAT THIS FILE PINS THAT THE SEAM CANNOT AS CHEAPLY: every load-failure branch (absent,
 * unconfigured, unreadable, malformed, invalid) for the harvest and the leaf, on each of the four
 * new pages — five real states are not something you can coax out of a running server without
 * five separately-broken temp files, and the render functions are total over exactly these
 * unions, so testing them directly is testing the actual contract rather than a sample of it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { RATING_SHAPED, parseLeafDocument, type Leaf, type PublishPolicy } from "@foliage/leaf";
import { parseHarvestDocument, type HarvestDocument } from "@foliage/photosynthesis";

import type { LeafLoad } from "./leafDocument.ts";
import type { PolicySource } from "./policyDocument.ts";
import {
  findLeaflet,
  renderLeafPage,
  renderLeafletPage,
  type HarvestLoad,
} from "./render.ts";
import { renderOverviewPage } from "./overview.ts";
import { renderGardenPage } from "./garden.ts";
import { renderPolicyPage } from "./policyPage.ts";
import { publishLauncher, renderPublishPage } from "./publishPreview.ts";
import { setupManagerOrigin } from "./portfolioSetup.ts";
import { MODEL_CEILING_MS, type ModelConfigResult } from "./scarletModel.ts";
import {
  PAGE_REFUSALS,
  QUESTION_MAX_CHARS,
  httpStatusForScarlet,
  refusalLabel,
  refusalRecovery,
  renderScarletPage,
  type ScarletView,
  type PageRefusal,
} from "./scarletPage.ts";

/** Visible text only — the same helper `render.test.ts` defines, kept local by this file's own
 * convention (every test file here defines its own small fixture helpers rather than importing
 * another test file's). */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `<code>` on a page, unescaped: the commands it prints exactly as a person would copy them. */
function codes(html: string): string[] {
  return [...html.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => text(m[1]!));
}

function leafFrom(doc: unknown): Leaf {
  const parsed = parseLeafDocument(doc);
  assert.equal(parsed.ok, true, "test input must be a valid leaf document");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function harvestFrom(doc: unknown): HarvestDocument {
  const parsed = parseHarvestDocument(doc);
  assert.equal(parsed.ok, true, "test input must be a valid harvest document");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

const NO_RULES: PublishPolicy = { rules: [] };

const DEFAULT_SOURCE: PolicySource = { kind: "default", searched: "/tmp/no-such-policy.json" };
const FILE_SOURCE: PolicySource = { kind: "file", path: "/tmp/studio-test-policy.json" };

const okLeaf = (leaf: Leaf, path = "/tmp/studio-leaf.json"): LeafLoad => ({
  ok: true,
  leaf,
  source: { path, bytes: 512, documentDigest: `sha256:${"0".repeat(64)}`, readAt: "2026-08-26T00:00:00Z", declaredExample: false, bundledExample: false },
});

const okHarvest = (harvest: HarvestDocument, path = "/tmp/studio-harvest.json"): HarvestLoad => ({
  ok: true,
  harvest,
  path,
});

const populatedLeaf = leafFrom({
  id: "studio-leaf",
  subject: "Studio Fixture Subject",
  leaflets: [
    { id: "sv1", title: "first verified", tier: "verified", provenance: { source: "git", ref: "aaa1111", observedAt: "2026-08-01T00:00:00Z" } },
    { id: "sv2", title: "second verified", tier: "verified", provenance: { source: "git", ref: "bbb2222", observedAt: "2026-08-02T00:00:00Z" } },
    { id: "sp1", title: "waiting on proof", tier: "pending" },
    { id: "sx1", title: "not attributable", tier: "excluded", reason: "different author identity" },
  ],
});

const emptyLeaf = leafFrom({ id: "studio-empty", subject: "Nobody Yet", leaflets: [] });

const queue = harvestFrom({
  candidates: [
    {
      id: "git-cluster:a",
      title: "feat: 3 commits",
      evidence: [
        { source: "git", ref: "aaa1111", observedAt: "2026-08-20T09:00:00Z" },
        { source: "git", ref: "bbb2222", observedAt: "2026-08-22T09:00:00Z" },
      ],
      extractor: "git-cluster",
      draftedAt: "2026-08-22T09:00:00Z",
      review: { state: "candidate" },
    },
    {
      id: "git-cluster:b",
      title: "chore: 1 commit",
      evidence: [{ source: "git", ref: "ccc3333", observedAt: "2026-08-15T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-15T09:00:00Z",
      review: { state: "approved", by: "Alex", at: "2026-08-16T10:00:00Z" },
    },
    {
      id: "git-cluster:c",
      title: "docs: 1 commit",
      evidence: [{ source: "git", ref: "ddd4444", observedAt: "2026-08-10T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-10T09:00:00Z",
      review: { state: "rejected", by: "Alex", at: "2026-08-11T10:00:00Z", reason: "not a body of work" },
    },
  ],
});

const emptyHarvest = harvestFrom({ candidates: [] });

/* ============================================================== NAV: present / absent ==== */

const PRIMARY_NAV_ITEMS = ["Home", "Work", "Review", "Portfolio", "Sources"] as const;
const MORE_NAV_ITEMS = ["Photosynthesis", "Import", "Policy", "Publish", "Harvest log"] as const;

function assertNavPresent(html: string, activeLabel: string): void {
  assert.match(html, /<header class="(?:fol-nav|fol-workspace)"/, "the studio nav must be the header on this page");
  const header = /<header class="(?:fol-nav|fol-workspace)"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  assert.match(
    header,
    /(?:Personal|Private workspace)/,
    "the plane badge must carry the owner's exact wording",
  );
  assert.match(header, /data-plane="studio"/);
  for (const label of PRIMARY_NAV_ITEMS) {
    assert.ok(header.includes(`>${label}<`), `the nav must list "${label}"`);
  }
  for (const label of MORE_NAV_ITEMS) {
    const present = header.includes(`>${label}<`);
    assert.equal(present, label !== activeLabel, `More must ${label === activeLabel ? "omit" : "list"} "${label}"`);
  }
  const activeMatches = [...header.matchAll(/<a href="[^"]*" aria-current="page">([^<]+)<\/a>/g)];
  if ((PRIMARY_NAV_ITEMS as readonly string[]).includes(activeLabel)) {
    assert.equal(activeMatches.length, 1, "exactly one primary nav item is aria-current");
    assert.equal(activeMatches[0]?.[1], activeLabel);
  } else {
    assert.equal(activeMatches.length, 0, "the current tool is named by its page, not repeated in More");
  }
}

function assertNavAbsent(html: string): void {
  assert.doesNotMatch(html, /<header class="(?:fol-nav|fol-workspace)"/);
  assert.doesNotMatch(html, /(?:Personal|Private workspace)/);
  assert.doesNotMatch(html, /class="fol-nav-plane"/);
}

test("the four owner pages carry primary routes and omit their current tool from More", () => {
  const home = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  assertNavPresent(home, "Home");
  assert.match(home, /<title>Home · Foliage<\/title>/);
  assert.match(home, /<h1 id="ov-h">Home<\/h1>/, "the page the Home link opens says Home");
  assertNavPresent(renderGardenPage(okHarvest(queue)), "Harvest log");
  assertNavPresent(renderPolicyPage(NO_RULES, DEFAULT_SOURCE), "Policy");
  assertNavPresent(renderPublishPage(okLeaf(populatedLeaf), NO_RULES), "Publish");
});

test("Harvest names the log; Overview calls its compact ledger In your record", () => {
  const gardenHtml = renderGardenPage(okHarvest(queue));
  assert.doesNotMatch(gardenHtml, />Harvest log<\/a>/, "the current log is not repeated in More");
  assert.match(gardenHtml, /<h1 id="garden-h">Harvest<\/h1>/, "the page names the log");
  assert.doesNotMatch(text(gardenHtml), /\bGarden\b/, "the harvest page itself must not still say Garden anywhere");

  const overviewHtml = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  const gardenSectionMatch = /<section class="ov-accounting" aria-labelledby="ov-garden-h"[\s\S]*?<\/section>/.exec(overviewHtml);
  assert.ok(gardenSectionMatch, "Overview must render its garden section");
  assert.match(gardenSectionMatch![0], /<h2 id="ov-garden-h">In your record<\/h2>/);
  assert.doesNotMatch(
    text(gardenSectionMatch![0]),
    /\bHarvest\b/,
    "record accounting must not be confused with the harvest log",
  );
});

test("renderLeafPage(..., \"private\") — /leaf — also carries the nav, marking Portfolio active", () => {
  assertNavPresent(renderLeafPage(okLeaf(populatedLeaf), NO_RULES, "private"), "Portfolio");
});

test("published and failure surfaces keep owner navigation out; the private leaflet stays in Portfolio", () => {
  // The export path — audience "published" — is the one this whole feature must never touch.
  assertNavAbsent(renderLeafPage(okLeaf(populatedLeaf), NO_RULES, "published"));
  assertNavAbsent(renderLeafPage(okLeaf(populatedLeaf), NO_RULES)); // default audience

  // The share surface, both when it resolves and when it refuses.
  const shared = findLeaflet(populatedLeaf, "sv1", NO_RULES, "published");
  assertNavAbsent(
    renderLeafletPage(shared, { path: "/tmp/x.json", bytes: 1, documentDigest: `sha256:${"0".repeat(64)}`, readAt: "2026-08-26T00:00:00Z", declaredExample: false, bundledExample: false }),
  );
  const notShareable = findLeaflet(populatedLeaf, "no-such-id", NO_RULES, "published");
  assertNavAbsent(
    renderLeafletPage(notShareable, { path: "/tmp/x.json", bytes: 1, documentDigest: `sha256:${"0".repeat(64)}`, readAt: "2026-08-26T00:00:00Z", declaredExample: false, bundledExample: false }),
  );

  // The owner's artifact is part of the private Portfolio journey. The public route above
  // remains isolated from this navigation and its local actions.
  const owned = findLeaflet(populatedLeaf, "sv1", NO_RULES, "private");
  assertNavPresent(
    renderLeafletPage(owned, { path: "/tmp/x.json", bytes: 1, documentDigest: `sha256:${"0".repeat(64)}`, readAt: "2026-08-26T00:00:00Z", declaredExample: false, bundledExample: false }, "private"),
    "Portfolio",
  );

  // Every one of the leaf page's five failure states, too — a failure must not suddenly grow
  // owner navigation on a route a stranger can reach (GET /leaflet/<id> when the leaf is broken
  // renders exactly this failure page, per render.ts's own routing note).
  for (const load of [
    { ok: false as const, cause: "unconfigured" as const, detail: "d", path: null },
    { ok: false as const, cause: "absent" as const, detail: "d", path: "/p" },
    { ok: false as const, cause: "unreadable" as const, detail: "d", path: "/p", errno: "EACCES" },
    { ok: false as const, cause: "malformed" as const, detail: "d", path: "/p" },
  ]) {
    assertNavAbsent(renderLeafPage(load, NO_RULES));
  }
});

/* ============================================================ single h1, no score ==== */

function assertSingleH1(html: string, where: string): void {
  const h1s = [...html.matchAll(/<h1[ >]/g)];
  assert.equal(h1s.length, 1, `${where}: expected exactly one <h1>, found ${h1s.length}`);
}

/**
 * Strips `data-verbatim="..."` regions before checking — THE SAME `chrome()` render.test.ts
 * already defines for the leaf page, applied here to the four new ones. A rule's OWN reason can
 * legitimately name the shape it refuses ("4.5/5") when explaining itself on `/policy` and
 * `/publish`; that text is marked `data-verbatim="rule-reason"` for exactly this reason (see
 * `ruleRow` in policyPage.ts), and nothing outside that marker gets the exemption.
 */
function chrome(html: string): string {
  return html.replace(/<([a-z0-9]+)[^>]*\sdata-verbatim="[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, "<>");
}

function assertNoScoreShapedText(html: string, where: string): void {
  const visible = text(chrome(html));
  assert.doesNotMatch(visible, RATING_SHAPED, `${where}: a rating-shaped figure leaked into the page`);
}

test("every new page has exactly one h1", () => {
  assertSingleH1(renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE), "overview");
  assertSingleH1(renderGardenPage(okHarvest(queue)), "garden");
  assertSingleH1(renderGardenPage(okHarvest(emptyHarvest)), "garden (empty)");
  assertSingleH1(renderPolicyPage(NO_RULES, DEFAULT_SOURCE), "policy");
  assertSingleH1(renderPublishPage(okLeaf(populatedLeaf), NO_RULES), "publish");
  assertSingleH1(renderPublishPage(okLeaf(emptyLeaf), NO_RULES), "publish (empty leaf)");
});

test("private page chrome never generates a person rating", () => {
  assertNoScoreShapedText(renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE), "overview");
  assertNoScoreShapedText(renderGardenPage(okHarvest(queue)), "garden");
  assertNoScoreShapedText(renderPolicyPage(NO_RULES, DEFAULT_SOURCE), "policy");
  assertNoScoreShapedText(renderPublishPage(okLeaf(populatedLeaf), NO_RULES), "publish");
});

/**
 * THE RATING-SHAPED RULE, REAL SHAPE. `deny-rating-shaped-title` explains itself by naming a
 * rating form it refuses. This is not a leak: it is the owner's own policy, read back to them, and it
 * must stay legible on `/policy` AND `/publish` (a leaflet this rule denies shows the SAME
 * sentence as its reason) — while `assertNoScoreShapedText` above proves nothing ELSE on either
 * page carries the pattern.
 */
const RATING_RULE = {
  id: "deny-rating-shaped-title",
  effect: "deny" as const,
  match: { kind: "title-rating-shaped" as const },
  reason:
    'The title uses a number as a rating — "rated 4.5/5" or "5 stars" — ' +
    "and this product never shows one about a person.",
};

test("the rating-shaped rule's own reason is legible, correctly scoped as data-verbatim, on /policy", () => {
  const html = renderPolicyPage({ rules: [RATING_RULE] }, FILE_SOURCE);
  assert.ok(text(html).includes(RATING_RULE.reason), "the owner's own rule text must be legible");
  // The cell carrying that reason is the one marked verbatim — found by position rather than a
  // regex over escaped punctuation, which the reason's own quote marks would fight.
  const cellStart = html.search(/<td\b(?=[^>]*data-verbatim="rule-reason")[^>]*>/);
  assert.ok(cellStart !== -1, "a data-verbatim rule-reason cell must exist");
  const cellEnd = html.indexOf("</td>", cellStart);
  assert.ok(
    text(html.slice(cellStart, cellEnd)).includes(RATING_RULE.reason),
    "the verbatim-marked cell must be the one carrying the rule's own reason",
  );
  assert.match(html.slice(cellStart, cellEnd), /<details><summary>Why<\/summary>/,
    "long rule prose stays available on demand");
  // And the exemption is scoped — everywhere ELSE on the page still has no rating-shaped text.
  assertNoScoreShapedText(html, "policy (with the real rating rule)");
});

test("the rating-shaped rule denying a leaflet is legible on /publish, and correctly scoped there too", () => {
  // Carries real provenance — a VERBATIM commit subject that happens to be rating-shaped, the
  // exact real-world case render.ts's own header records at length ("a real commit titled 'add
  // score normalizer'"). The title's own exemption is `data-verbatim="title"`, not the reason's;
  // both must be present for this row to be fully legible AND fully scoped.
  const rated = leafFrom({
    id: "studio-rated",
    subject: "Rated Fixture",
    leaflets: [
      {
        id: "r1",
        title: "Shipped work rated 9/10",
        tier: "pending",
        provenance: { source: "git", ref: "fed1234", observedAt: "2026-08-20T00:00:00Z" },
      },
    ],
  });
  const html = renderPublishPage(okLeaf(rated), { rules: [RATING_RULE] });
  assert.match(html, /data-publish-row="r1" data-publish-status="withheld"/);
  assert.ok(text(html).includes(RATING_RULE.reason));
  assert.ok(text(html).includes("Shipped work rated 9/10"), "the carried title must still be shown");
  assert.match(html, /data-verbatim="title">Shipped work rated 9\/10/);
  assertNoScoreShapedText(html, "publish (with the real rating rule)");
});

test("day-one Overview explains the private record and leads to a real source action without false counters", () => {
  const noLeaf: LeafLoad = { ok: false, cause: "absent", detail: "not found", path: "/no-leaf" };
  const noHarvest: HarvestLoad = { ok: false, cause: "absent", detail: "not found", path: "/no-harvest" };
  const html = renderOverviewPage(noLeaf, noHarvest, NO_RULES, DEFAULT_SOURCE);
  assert.match(html, /<h1 id="ov-h">Your work deserves a record<\/h1>/);
  assert.match(html, /Keep your work, decisions, and discoveries in one private place/);
  assert.match(html, /data-overview-first-use/);
  assert.match(html, /href="\/workflow#sources">Connect a source<\/a>/);
  assert.match(html, /href="\/leaf\/import">Import a portfolio<\/a>/);
  assert.doesNotMatch(html, /data-overview-stat=|data-garden-state=|data-queue-state=/);
  assert.doesNotMatch(text(html), /Leaf file missing|node apps\/leaf/);
});

test("unconfigured first-use storage stays an unavailable state", () => {
  const noLeaf: LeafLoad = { ok: false, cause: "unconfigured", detail: "No path configured", path: null };
  const noHarvest: HarvestLoad = { ok: false, cause: "unconfigured", detail: "No draft path configured" };
  const html = renderOverviewPage(noLeaf, noHarvest, NO_RULES, DEFAULT_SOURCE);
  assert.doesNotMatch(html, /data-overview-first-use/);
  assert.match(html, /data-garden-state="unconfigured"/);
  assert.match(html, /data-queue-state="unconfigured"/);
  assert.match(html, /No Leaf file configured/);
  assert.match(html, /No draft file configured/);
});

test("approved work with no record names the step that creates it, once, and only when the record is missing", () => {
  const noLeaf: LeafLoad = { ok: false, cause: "absent", detail: "not found", path: "/no-leaf" };
  const primaries = (html: string) => [...html.matchAll(/<a class="fol-button fol-button-primary" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  const nextStep = (html: string) => /<div class="ov-next" data-next-step="true">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const gardenOf = (html: string) => html.slice(html.indexOf('data-garden-state="absent"'), html.indexOf('<h2 id="ov-review-h">'));

  // Nothing left to review (one approved and one rejected, or the open draft paused out of view):
  // Next creates the record, and it is the page's only primary action.
  const approvedOnly = harvestFrom({ candidates: [queue.candidates[1], queue.candidates[2]] });
  for (const [html, state] of [
    [renderOverviewPage(noLeaf, okHarvest(approvedOnly), NO_RULES, DEFAULT_SOURCE), "approved only"],
    [renderOverviewPage(noLeaf, okHarvest(queue), NO_RULES, DEFAULT_SOURCE, true), "open draft paused"],
  ] as const) {
    assert.deepEqual(primaries(html), [["/leaf/setup", "Create your private record"]], state);
    assert.match(nextStep(html), /href="\/leaf\/setup">Create your private record<\/a>/, state);
    assert.match(text(gardenOf(html)), /No private record yet Create it, then add your 1 approved draft from Review\./, state);
    assert.doesNotMatch(html, /approved to your record|Connect a source|Leaf file missing|data-create-record/, state);
  }
  // A queue bound to a record is added only into one of its own name, so the page names it.
  const bound = renderOverviewPage(noLeaf, okHarvest({ ...approvedOnly, subject: "Alex A", leafId: "alex-a" }), NO_RULES, DEFAULT_SOURCE);
  assert.match(text(gardenOf(bound)), /Create it as Alex A, then add your 1 approved draft from Review\./);

  // A draft still open: review keeps the lead, and the record step is a quiet link beside it.
  const html = renderOverviewPage(noLeaf, okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  const garden = gardenOf(html);
  assert.match(html, /class="ov-content ov-content--no-work"/, 'without work the queue uses the full content width');
  assert.deepEqual(primaries(html), [["/review", "Review 1 draft"]]);
  assert.match(garden, /<a class="ov-secondary" href="\/leaf\/setup" data-create-record>Create your private record<\/a>/);
  assert.match(text(garden), /No private record yet/);
  assert.match(text(garden), /Create it, then add your 1 approved draft from Review\./, "queue holds one approved draft");
  assert.doesNotMatch(text(garden), /Leaf file missing/);
  // A broken record is repaired, never replaced; with nothing approved there is nothing waiting.
  const broken: LeafLoad = { ok: false, cause: "invalid", detail: "needs repair", path: "/bad-leaf", issues: [] };
  assert.doesNotMatch(renderOverviewPage(broken, okHarvest(queue), NO_RULES, DEFAULT_SOURCE), /Create your private record/);
  const nothingApproved = { ...queue, candidates: queue.candidates.filter((c) => c.review.state !== "approved") };
  const waiting = renderOverviewPage(noLeaf, okHarvest(nothingApproved), NO_RULES, DEFAULT_SOURCE);
  assert.doesNotMatch(waiting, /Create your private record/);
  assert.match(waiting, /Leaf file missing/);
});

/* ================================================== counts equal recomputation ==== */

test("Overview's garden counts equal attributionLedger over the SAME leaf, independently", () => {
  const html = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  // populatedLeaf: 2 verified, 1 pending, 1 excluded — read back off the rendered stat cells.
  const verified = /data-overview-stat="verified"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const pending = /data-overview-stat="pending"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const excluded = /data-overview-stat="excluded"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  assert.equal(Number(verified?.[1]), 2);
  assert.equal(Number(pending?.[1]), 1);
  assert.equal(Number(excluded?.[1]), 1);

  // queue: 1 candidate, 1 approved, 1 rejected.
  const awaiting = /data-overview-stat="candidate"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const approved = /data-overview-stat="approved"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const rejected = /data-overview-stat="rejected"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  assert.equal(Number(awaiting?.[1]), 1);
  assert.equal(Number(approved?.[1]), 1);
  assert.equal(Number(rejected?.[1]), 1);
});

test("policy counts live on /policy while Overview stays focused on work and review", () => {
  const policy: PublishPolicy = { rules: [REAL_RULE, ALLOW_RULE, RATING_RULE] };
  const overviewHtml = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), policy, FILE_SOURCE);
  const policyHtml = renderPolicyPage(policy, FILE_SOURCE);

  const overviewCount = /data-overview-stat="rules-in-force"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(
    overviewHtml,
  );
  const policyCount = /data-policy-stat="rules"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(policyHtml);
  assert.equal(overviewCount, null, "Overview no longer repeats policy counts");
  assert.ok(policyCount !== null, "/policy must render a rules count");
  assert.equal(Number(policyCount?.[1]), policy.rules.length, "/policy must count every rule");
  assert.doesNotMatch(overviewHtml, /data-overview-stat="(?:rules-in-force|deny-rules|allow-rules)"/);

  const overviewDeny = /data-overview-stat="deny-rules"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(overviewHtml);
  const policyDeny = /data-policy-stat="deny-rules"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(policyHtml);
  assert.equal(overviewDeny, null);
  assert.equal(Number(policyDeny?.[1]), 2, "REAL_RULE and RATING_RULE are both deny rules");
});

test("Overview's next step names the real awaiting count and links to /review", () => {
  const html = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  assert.match(text(html), /Review 1 draft\b/);
  assert.match(html, /data-next-step="true"[\s\S]*?href="\/review"/);
});

/*
 * APPROVED WORK NOT YET IN THE RECORD IS NAMED EVEN WHILE DRAFTS REMAIN. `queue` holds one open
 * draft and one approved draft the leaf lacks: the add step leads, linked to the promote panel,
 * and the review step stays beside it. Before, the open draft hid the add step entirely.
 */
test("Overview's next step leads with approved work waiting for the record, with review beside it", () => {
  const html = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  const next = /<div class="ov-next" data-next-step="true">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const links = [...next.matchAll(/<a class="([^"]+)" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(links, [
    ["fol-button fol-button-primary", "/review#review-promote-h", "Add 1 approved to your record"],
    ["ov-secondary", "/review", "Review 1 draft"],
  ]);

  // Nothing approved waiting: review alone, as before.
  const openOnly = harvestFrom({ candidates: [queue.candidates[0]] });
  const alone = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(openOnly), NO_RULES, DEFAULT_SOURCE);
  assert.match(text(alone), /Review 1 draft\b/);
  assert.doesNotMatch(alone, /approved to your record|ov-secondary/);
});

/*
 * ...BUT ONLY AGAINST A LEAF THAT WAS READ. Without its ids nothing can be subtracted, and the
 * promote panel can add nothing, so an add step there would count every approval as waiting and
 * lead to a panel with no button. Measured before: with the leaf absent, "Add 1 approved to your
 * record" took the lead from "Review 124 drafts". Review keeps it, and with nothing left to review
 * the leaf's own branch answers.
 */
test("Overview offers no add step when the leaf could not be read, and review keeps the lead", () => {
  const unread: readonly Extract<LeafLoad, { ok: false }>[] = [
    { ok: false, cause: "absent", detail: "no file", path: "/nope/leaf.json" },
    { ok: false, cause: "unconfigured", detail: "not set", path: null },
    { ok: false, cause: "invalid", detail: "leaflets[0].tier", path: "/nope/leaf.json", issues: [] },
  ];
  const approvedOnly = harvestFrom({ candidates: [queue.candidates[1]] });
  for (const leafLoad of unread) {
    const html = renderOverviewPage(leafLoad, okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
    const next = /<div class="ov-next" data-next-step="true">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const links = [...next.matchAll(/<a class="([^"]+)" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(links, [["fol-button fol-button-primary", "/review", "Review 1 draft"]], leafLoad.cause);

    const settled = renderOverviewPage(leafLoad, okHarvest(approvedOnly), NO_RULES, DEFAULT_SOURCE);
    assert.doesNotMatch(settled, /approved to your record|review-promote-h/, leafLoad.cause);
  }
});

test("Overview leads with retained work, then quiet record and review accounting", () => {
  const brokenLeaf: LeafLoad = { ok: false, cause: "absent", detail: "no file", path: "/nope" };
  const brokenHarvest: HarvestLoad = { ok: false, cause: "unreadable", detail: "denied", path: "/nope", errno: "EACCES" };
  const loaded = renderOverviewPage(okLeaf(populatedLeaf), okHarvest(queue), NO_RULES, DEFAULT_SOURCE);
  const broken = renderOverviewPage(brokenLeaf, brokenHarvest, NO_RULES, DEFAULT_SOURCE);
  assert.doesNotMatch(loaded.slice(loaded.indexOf("<main")), /<details/, "loaded overview has no explainer drawer");
  assert.match(broken, /<details class="leaf-detail"><summary>Details<\/summary>/, "repair details remain available on failure");
  for (const html of [loaded, broken]) {
    assert.doesNotMatch(html, /data-bridge=/);
    const garden = html.indexOf('<h2 id="ov-garden-h">In your record</h2>');
    const review = html.indexOf('<h2 id="ov-review-h">Review</h2>');
    assert.ok(garden !== -1 && review > garden, "record accounting precedes review accounting");
  }
});

test("Overview's garden and review sections render their OWN honest state on failure, independently", () => {
  const brokenLeaf: LeafLoad = { ok: false, cause: "absent", detail: "no file", path: "/nope" };
  const brokenHarvest: HarvestLoad = { ok: false, cause: "unreadable", detail: "denied", path: "/nope", errno: "EACCES" };
  const html = renderOverviewPage(brokenLeaf, brokenHarvest, NO_RULES, DEFAULT_SOURCE);
  assert.match(html, /data-garden-state="absent"/);
  assert.match(html, /data-queue-state="unreadable"/);
  // A broken harvest must not blank the leaf's own (also broken here, but DIFFERENTLY) state.
  assert.notEqual(
    /data-garden-state="([a-z]+)"/.exec(html)?.[1],
    /data-queue-state="([a-z]+)"/.exec(html)?.[1],
  );
});

test("Garden's counts equal a fresh tally over the same document, and freshness is the real max", () => {
  const html = renderGardenPage(okHarvest(queue));
  assert.match(html, /<h2 id="garden-drafts-h">Drafts<\/h2>/);
  assert.match(html, /href="\/review">Review drafts<\/a>/);
  assert.doesNotMatch(html, /class="cells-3"/);
  const candidate = /data-garden-count="candidate"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const approved = /data-garden-count="approved"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  const rejected = /data-garden-count="rejected"[\s\S]*?fol-metric leaf-count">(\d+)</.exec(html);
  assert.equal(Number(candidate?.[1]), 1);
  assert.equal(Number(approved?.[1]), 1);
  assert.equal(Number(rejected?.[1]), 1);

  // The freshest observedAt across ALL evidence in the fixture is 2026-08-22T09:00:00Z.
  assert.match(html, /data-freshest="2026-08-22T09:00:00Z"/);
  // Sorted freshest-first: the "a" candidate (freshest evidence 08-22) must appear before "c"
  // (freshest evidence 08-10) in the table body.
  assert.ok(html.indexOf('data-garden-row="git-cluster:a"') < html.indexOf('data-garden-row="git-cluster:c"'));
});

test("Garden shows when a draft's commits were authored beside Observed, without letting it order the page", () => {
  const draft = (id: string, observedAt: string, authored: readonly (string | undefined)[], source = "git") => ({
    id,
    title: `synthetic ${id}`,
    evidence: authored.map((authoredAt, i) => ({
      source, ref: `${id.slice(-1)}${i}`.padEnd(7, "0"), observedAt, ...(authoredAt === undefined ? {} : { authoredAt }),
    })),
    extractor: "git-cluster",
    draftedAt: observedAt,
    review: { state: "candidate" },
  });
  const html = renderGardenPage(okHarvest(harvestFrom({
    candidates: [
      // Newest first, as the queue writes them; the span is still oldest to newest.
      draft("git-cluster:s", "2026-08-22T09:00:00Z", ["2026-08-19T22:00:00-06:00", undefined, "2026-08-03T10:00:00Z"]),
      draft("git-cluster:o", "2026-08-30T09:00:00Z", ["2026-08-05T10:00:00Z"]),
      draft("git-cluster:u", "2026-08-25T09:00:00Z", [undefined]),
      draft("git-cluster:x", "2026-08-24T09:00:00Z", ["2026-08-01T00:00:00Z"], "synthetic-export"),
    ],
  })));
  const row = (id: string): string => new RegExp(`<tr role="row" data-garden-row="${id}">[\\s\\S]*?</tr>`).exec(html)?.[0] ?? "";
  // UTC days, as Observed uses: 22:00 at -06:00 on the 19th is the 20th.
  assert.match(row("git-cluster:s"), /data-author-date-from="2026-08-03T10:00:00Z" data-author-date-to="2026-08-19T22:00:00-06:00"/);
  assert.match(text(row("git-cluster:s")), /Aug 22, 2026 Authored Aug 3\s–\s20, 2026$/);
  assert.match(text(row("git-cluster:o")), /Aug 30, 2026 Authored Aug 5, 2026$/);
  // Git's author date, so never labelled a commit date: a rebased commit was committed later.
  assert.doesNotMatch(html, /Committed/i);
  assert.doesNotMatch(row("git-cluster:u"), /Authored/, "no author date is shown where git gave none");
  assert.doesNotMatch(row("git-cluster:x"), /Authored/, "only git's author date is shown");
  // Observed still orders the table: o (08-30), u (08-25), x (08-24), s (08-22).
  const order = ["o", "u", "x", "s"].map((k) => html.indexOf(`data-garden-row="git-cluster:${k}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("Garden and the leaf page each answer their own five states — absent and empty stay distinct", () => {
  const pages: readonly [string, string][] = [
    ["ok", renderGardenPage(okHarvest(queue))],
    ["ok-empty", renderGardenPage(okHarvest(emptyHarvest))],
    ["unconfigured", renderGardenPage({ ok: false, cause: "unconfigured", detail: "d" })],
    ["absent", renderGardenPage({ ok: false, cause: "absent", detail: "d", path: "/p" })],
    ["unreadable", renderGardenPage({ ok: false, cause: "unreadable", detail: "d", path: "/p", errno: "EACCES" })],
    ["malformed", renderGardenPage({ ok: false, cause: "malformed", detail: "d", path: "/p" })],
    [
      "invalid",
      renderGardenPage({
        ok: false,
        cause: "invalid",
        detail: "d",
        path: "/p",
        issues: [{ at: "candidates[0].id", message: "bad" }],
      }),
    ],
  ];
  for (const [a, [nameA, htmlA]] of pages.entries()) {
    for (const [b, [nameB, htmlB]] of pages.entries()) {
      if (a >= b) continue;
      assert.notEqual(htmlA, htmlB, `${nameA} and ${nameB} must render differently`);
    }
  }
});

test("Harvest first use opens Sources and keeps commands and document paths in disclosures", () => {
  const empty = renderGardenPage(okHarvest(emptyHarvest));
  const missing = renderGardenPage({ ok: false, cause: "absent", detail: "missing harvest", path: "/private/harvest.json" });
  for (const html of [empty, missing]) {
    assert.match(html, /href="\/workflow#sources"[^>]*>Connect a source<\/a>/);
    assert.match(html, /<summary>Command line<\/summary>/);
  }
  assert.match(missing, /<summary>Command line<\/summary>[\s\S]*missing harvest/);
  const populated = renderGardenPage(okHarvest(queue));
  assert.match(populated, /<summary>Document<\/summary>/);
  assert.doesNotMatch(populated.split("<summary>Document</summary>")[0] ?? "", /\/tmp\/studio-harvest\.json/);
});

/* ==================================================================== policy page ==== */

const REAL_RULE = {
  id: "deny-excluded",
  effect: "deny" as const,
  match: { kind: "tier" as const, tier: "excluded" as const },
  reason: "Excluded work is not this subject's to publish.",
};
const ALLOW_RULE = {
  id: "propose-verified",
  effect: "allow" as const,
  match: { kind: "tier" as const, tier: "verified" as const },
  reason: "Authorship is cryptographically established.",
};

test("the policy page lists every rule, in order, with its own id, effect and reason — nothing invented", () => {
  const policy: PublishPolicy = { rules: [REAL_RULE, ALLOW_RULE] };
  const html = renderPolicyPage(policy, FILE_SOURCE);
  const visible = text(html);
  assert.ok(html.includes(REAL_RULE.id));
  assert.ok(visible.includes(REAL_RULE.reason));
  assert.ok(html.includes(ALLOW_RULE.id));
  assert.match(html, /DENY/);
  assert.match(html, /ALLOW/);
  // Read-only: no <form> anywhere on this page.
  assert.doesNotMatch(html, /<form/);
  // "foliage policy …", not "node apps/leaf/policy.mjs …" — the passthrough that injects the
  // garden's --leaf/--policy defaults (see foliagePolicyPassthrough.test.ts), which the bare
  // script cannot do for itself.
  assert.match(text(html), /foliage policy show\|check\|deny\|allow\|drop/);
});

test("the policy page states a default (unwritten) policy honestly, and an empty one too", () => {
  const html = renderPolicyPage({ rules: [] }, DEFAULT_SOURCE);
  assert.match(text(html), /no policy document yet/i);
  assert.match(text(html), /no rules in force/i);
});

/* ================================================================== publish preview ==== */

test("publish links to an explicitly configured loopback Canopy review without creating a local publishing action", () => {
  const origin = setupManagerOrigin({ FOLIAGE_CANOPY_MANAGER_ORIGIN: "http://127.0.0.1:4180" });
  const html = renderPublishPage(okLeaf(populatedLeaf), NO_RULES, new URLSearchParams(), origin);
  assert.match(html, /href="http:\/\/127\.0\.0\.1:4180\/"[^>]*data-publish-handoff="canopy"[^>]*>Review in Canopy<\/a>/);
  assert.doesNotMatch(html, /<form[^>]*action="\/publish"/);
  assert.doesNotMatch(renderPublishPage(okLeaf(populatedLeaf), NO_RULES), /data-publish-handoff="canopy"/);
  assert.doesNotMatch(renderPublishPage(okLeaf(emptyLeaf), NO_RULES, new URLSearchParams(), origin), /data-publish-handoff="canopy"/);
  assert.equal(setupManagerOrigin({}), null);
  const credentialOrigin = new URL("http://127.0.0.1:4180");
  credentialOrigin.username = "user";
  for (const invalid of ["https://127.0.0.1:4180", "http://example.com:4180", "http://127.0.0.1:4180/path", credentialOrigin.href]) {
    assert.throws(() => setupManagerOrigin({ FOLIAGE_CANOPY_MANAGER_ORIGIN: invalid }), /exact loopback HTTP origin/);
  }
});

test("the publish preview separates proposed work from private work, with a reason and record link for each", () => {
  const policy: PublishPolicy = { rules: [REAL_RULE, ALLOW_RULE] };
  const html = renderPublishPage(okLeaf(populatedLeaf), policy);
  // Nothing is SHARED in this fixture (no leaflet carries `visibility`), so nothing may be
  // "served" however permissive the policy is — that is the domain's own default, quoted here
  // rather than re-decided. sv1/sv2 are proposed (allow rule fires, not yet shared); sx1 is
  // withheld outright.
  assert.match(html, /data-publish-total="public">[\s\S]*?leaf-count">0</);
  assert.match(html, /data-publish-total="unlisted">[\s\S]*?leaf-count">0</);
  assert.match(html, /data-publish-total="withheld">[\s\S]*?leaf-count">1</);
  assert.match(html, /data-publish-total="proposed">[\s\S]*?leaf-count">2</);
  assert.match(html, /data-publish-total="private">[\s\S]*?leaf-count">1</);
  assert.match(html, /data-publish-row="sx1" data-publish-status="withheld"/);
  const visible = text(html);
  assert.ok(visible.includes(REAL_RULE.reason), "the withheld row's own rule reason must be on the page");
  assert.match(html, /data-publish-row="sv1" data-publish-status="proposed"/);
  assert.match(html, /data-publish-row="sp1" data-publish-status="private"/);
  assert.match(html, /href="\/my\/leaflet\/sv1" aria-label="View record: first verified \(sv1\)">View record<\/a>/);
  assert.doesNotMatch(html, /purpose=publish/);
  assert.ok(visible.includes(ALLOW_RULE.reason), "a proposed row's reason must be on the page too");
  assert.match(visible, /Local preview · No change made/i);
  assert.doesNotMatch(html, /data-shared-address/, "nothing is shared, so no row offers an address");

  // THE COMMANDS ARE THE ONES THAT RUN. The bare scripts this page used to print exit 2 (share.mjs
  // needs --leaf) and 1 (export.mjs reads the repository's own leaf), and a bare `foliage` exits
  // 127: nothing puts it on PATH. Without a launcher from `foliage up`, every command is the
  // quickstart's `node foliage.mjs …`, run from the checkout.
  const commandLine = /<details class="publish-command-line">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  assert.deepEqual(codes(commandLine), ["node foliage.mjs share <id> --as public", "node foliage.mjs export --out <dir>"]);
  assert.match(text(commandLine), /Run these from the Foliage checkout\. Add --garden <folder> unless this app's garden is ~\/\.foliage\./);
  assert.doesNotMatch(html, /share\.mjs|export\.mjs/);
  assert.ok(codes(html).every((code) => code.startsWith("node foliage.mjs ")), "no printed command starts with a bare `foliage`");

  // A PRIVATE ROW NAMES THE ACT THAT SHARES IT, not an allow rule: allow rules only propose, and
  // `/policy` is read-only.
  const rowText = (id: string) => {
    const start = html.indexOf(`data-publish-row="${id}"`);
    return text(html.slice(start, html.indexOf("</li>", start)));
  };
  assert.match(rowText("sp1"), /You have not shared this\. node foliage\.mjs share sp1 --as public/);
  assert.doesNotMatch(rowText("sp1"), /allow rule|NOT published/i);
  assert.match(rowText("sv1"), /node foliage\.mjs share sv1 --as public/, "a proposed row is shared by the same command");
  assert.doesNotMatch(rowText("sx1"), /foliage\.mjs/, "a withheld row has no command that would change it");

  const proposed = renderPublishPage(okLeaf(populatedLeaf), policy, new URLSearchParams("view=proposed"));
  assert.match(proposed, /data-publish-row="sv1" data-publish-status="proposed"/);
  assert.match(proposed, /data-publish-row="sv2" data-publish-status="proposed"/);
  assert.doesNotMatch(proposed, /data-publish-row="sp1"/);
  assert.match(proposed, /data-publish-total="proposed" aria-current="page"/);

  const privateRows = renderPublishPage(okLeaf(populatedLeaf), policy, new URLSearchParams("view=private"));
  assert.match(privateRows, /data-publish-row="sp1" data-publish-status="private"/);
  assert.doesNotMatch(privateRows, /data-publish-row="sv1"/);
  assert.doesNotMatch(privateRows, /data-publish-row="sx1"/);
  assert.match(privateRows, /data-publish-total="private" aria-current="page"/);
});

/**
 * Under `foliage up` the server is told its launcher and garden, and every printed command is the
 * absolute, garden-qualified form the CLI's own `nextCommand` prints, so it runs from any folder.
 * The real launch, and a run of the printed command, are in foliageUpPolicySeam.test.ts.
 */
test("publish commands carry the launcher and garden foliage up names, and only for that garden's own documents", () => {
  const garden = "/home/someone/my garden";
  const env = {
    FOLIAGE_LAUNCHER: "/opt/foliage/foliage.mjs",
    FOLIAGE_GARDEN: garden,
    FOLIAGE_LEAF: `${garden}/leaf.json`,
    FOLIAGE_POLICY: `${garden}/policy.json`,
  };
  const launcher = publishLauncher(env, "/usr/local/bin/node");
  assert.deepEqual(launcher, { node: "/usr/local/bin/node", script: "/opt/foliage/foliage.mjs", garden });

  const html = renderPublishPage(okLeaf(populatedLeaf), { rules: [REAL_RULE, ALLOW_RULE] }, new URLSearchParams(), null, launcher);
  const run = (args: string) => `/usr/local/bin/node /opt/foliage/foliage.mjs ${args} --garden '/home/someone/my garden'`;
  assert.deepEqual(codes(html), [
    run("share sv1 --as public"),
    run("share sv2 --as public"),
    run("share sp1 --as public"),
    run("share <id> --as public"),
    run("export --out <dir>"),
  ]);
  assert.match(text(/<details class="publish-command-line">[\s\S]*?<\/details>/.exec(html)?.[0] ?? ""), /These name this app's garden, so they run from any folder\./);
  assert.doesNotMatch(html, /from the Foliage checkout/);

  // A server started without `up` (no launcher), or one whose leaf or policy is not the garden's,
  // gets the quickstart form instead of a command that would act on other documents.
  const { FOLIAGE_LAUNCHER: _launcher, ...withoutLauncher } = env;
  assert.equal(publishLauncher(withoutLauncher, "/usr/local/bin/node"), null);
  assert.equal(publishLauncher({ ...env, FOLIAGE_LEAF: "/elsewhere/leaf.json" }, "/usr/local/bin/node"), null);
  assert.equal(publishLauncher({ ...env, FOLIAGE_POLICY: "/elsewhere/policy.json" }, "/usr/local/bin/node"), null);
  assert.equal(publishLauncher({ ...env, FOLIAGE_GARDEN: "garden", FOLIAGE_LEAF: "garden/leaf.json", FOLIAGE_POLICY: "garden/policy.json" }, "/usr/local/bin/node"), null);
});

/**
 * REGRESSION — found on the REAL running server (studioSeam-adjacent manual check against
 * apps/leaf/leaf.json), not invented: exactly one real leaflet there carries
 * `visibility: "unlisted"` on a tier no rule proposes. `outward.kind` is correctly "served" (a
 * fail-closed policy denial is a denial of a PROPOSAL, not a revocation of a share already made
 * by hand — outwardStateOf's own header states this), but the row's reason ONCE quoted
 * `decisionReason(row.decision)` regardless of outward state, which for a "no-rule-matched"
 * decision is the fixed sentence ending "...so it is NOT published." That produced, on a real
 * response: status SERVED beside a reason saying it is not published — direct contradiction, on
 * the one page whose entire job is describing what would actually happen.
 */
test("a leaflet that is SHARED by hand, with no rule proposing it, is SERVED — and says so, not the fail-closed sentence", () => {
  const sharedNoProposal = leafFrom({
    id: "studio-shared-unproposed",
    subject: "Shared Fixture",
    leaflets: [
      { id: "s1", title: "shared but unmatched", tier: "pending", visibility: "unlisted" },
    ],
  });
  // An empty policy: no rule anywhere, deny or allow — the exact "no-rule-matched" case.
  const html = renderPublishPage(okLeaf(sharedNoProposal), NO_RULES);
  assert.match(html, /data-publish-row="s1" data-publish-status="unlisted"/);
  const rowStart = html.indexOf('data-publish-row="s1"');
  const rowEnd = html.indexOf("</li>", rowStart);
  const row = text(html.slice(rowStart, rowEnd));
  assert.match(row, /Link only/);
  assert.doesNotMatch(row, /is\s+NOT\s+published/i, "a SERVED row must never say it is not published");
  assert.match(row, /you have shared this as a link only, and no rule denies it/i);
  assert.match(row, /Canopy and the static export publish only Public work/);
});

/**
 * "Shared links" counted unlisted beside public, and on a real garden Leaf said "Shared links 1"
 * while Canopy said "Stays private 1": Canopy's gate and the static export take only `public`.
 * The two are counted apart, and every row whose address answers links it, labelled as the
 * loopback address it is.
 */
test("publish preview counts Public apart from Link only, and links each served address on this computer", () => {
  const leaf = leafFrom({
    id: "studio-shared-split", subject: "Split Fixture", leaflets: [
      { id: "pub", title: "public work", tier: "pending", visibility: "public" },
      { id: "link", title: "link only work", tier: "pending", visibility: "unlisted" },
      { id: "denied", title: "shared but denied", tier: "excluded", reason: "different author", visibility: "public" },
      { id: "kept", title: "kept private", tier: "pending" },
    ],
  });
  const html = renderPublishPage(okLeaf(leaf), { rules: [REAL_RULE] });
  const row = (id: string) => {
    const start = html.indexOf(`data-publish-row="${id}"`);
    return html.slice(start, html.indexOf("</li>", start));
  };
  assert.match(html, /data-publish-total="public"><span>Public<\/span><b class="fol-metric leaf-count">1</);
  assert.match(html, /data-publish-total="unlisted"><span>Link only \(unlisted\)<\/span><b class="fol-metric leaf-count">1</);
  assert.match(html, /data-publish-total="withheld">[\s\S]*?leaf-count">1</);
  assert.doesNotMatch(html, /Shared links/);
  assert.match(text(html), /Canopy and the static export publish only Public work/);

  assert.match(row("pub"), /data-publish-status="public"/);
  assert.match(row("link"), /data-publish-status="unlisted"/);
  assert.match(row("link"), /data-static-export-row="link-only">Not in export</);
  for (const id of ["pub", "link"]) {
    assert.match(row(id), new RegExp(`<a href="/leaflet/${id}" data-shared-address>/leaflet/${id}</a> <span class="fol-label">on this computer</span>`));
  }
  // The address a deny rule refuses would 404, so it is not offered.
  assert.doesNotMatch(row("denied"), /data-shared-address/);
  assert.doesNotMatch(row("kept"), /data-shared-address/);

  // An id the shell would split is printed as one quoted word, so the command still runs as shown.
  const oddId = renderPublishPage(okLeaf(leafFrom({
    id: "studio-odd-id", subject: "Odd Fixture", leaflets: [{ id: "it's mine", title: "odd id", tier: "pending" }],
  })), NO_RULES);
  assert.match(text(oddId), /node foliage\.mjs share 'it'\\''s mine' --as public/);

  const onlyPublic = renderPublishPage(okLeaf(leaf), { rules: [REAL_RULE] }, new URLSearchParams("view=public"));
  assert.match(onlyPublic, /data-publish-total="public" aria-current="page"/);
  assert.match(onlyPublic, /data-publish-row="pub"/);
  assert.doesNotMatch(onlyPublic, /data-publish-row="(?:link|denied|kept)"/);
  const onlyLink = renderPublishPage(okLeaf(leaf), { rules: [REAL_RULE] }, new URLSearchParams("view=unlisted"));
  assert.match(onlyLink, /data-publish-total="unlisted" aria-current="page"/);
  assert.match(onlyLink, /data-publish-row="link"/);
  assert.doesNotMatch(onlyLink, /data-publish-row="(?:pub|denied|kept)"/);
});

test("the owner's leaflet links its share address exactly when that address answers, and the share page never does", () => {
  const leaf = leafFrom({
    id: "studio-owner-address", subject: "Address Fixture", leaflets: [
      { id: "pub", title: "public work", tier: "pending", visibility: "public" },
      { id: "link", title: "link only work", tier: "pending", visibility: "unlisted" },
      { id: "denied", title: "shared but denied", tier: "excluded", reason: "different author", visibility: "public" },
      { id: "kept", title: "kept private", tier: "pending" },
    ],
  });
  const policy: PublishPolicy = { rules: [REAL_RULE] };
  const source = okLeaf(leaf);
  if (!source.ok) throw new Error("unreachable");
  const publication = (id: string) => {
    const html = renderLeafletPage(findLeaflet(leaf, id, policy, "private"), source.source, "private");
    return /<section class="leaflet-prov-section" aria-labelledby="leaflet-pub-h">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  };
  for (const id of ["pub", "link"]) {
    assert.equal(findLeaflet(leaf, id, policy).ok, true, `${id}: the share route answers`);
    assert.match(publication(id), new RegExp(`<dt class="fol-label">Address</dt>\\s*<dd><a href="/leaflet/${id}" data-shared-address>/leaflet/${id}</a> <span class="fol-label">on this computer</span></dd>`));
  }
  for (const id of ["denied", "kept"]) {
    assert.equal(findLeaflet(leaf, id, policy).ok, false, `${id}: the share route refuses`);
    assert.ok(publication(id).length > 0, `${id}: the Publication section still renders`);
    assert.doesNotMatch(publication(id), /data-shared-address|Address/, `${id}: no address that would 404`);
  }
  // A stranger at the address gets the artifact, not its sharing mechanics.
  assert.doesNotMatch(renderLeafletPage(findLeaflet(leaf, "pub", policy), source.source), /data-shared-address|on this computer/);
});

test("publish preview separates a shared link from the stricter static export admission and title gate", () => {
  const leaf = leafFrom({
    id: "studio-export-preview", subject: "Studio Export Fixture", leaflets: [
      { id: "public", title: "Built search", tier: "pending", visibility: "public" },
      { id: "unlisted", title: "Explored with colleague@else.example", tier: "pending", visibility: "unlisted" },
      { id: "excluded", title: "Other person's work", tier: "excluded", reason: "different author", visibility: "public" },
      { id: "email", title: "Thanks colleague@else.example", tier: "pending", visibility: "public" },
      { id: "apostrophe", title: "Contact o'brien@my-domain.example.com", tier: "pending", visibility: "public" },
      { id: "typo", title: "Contact rowan@northwind..invalid", tier: "pending", visibility: "public" },
    ],
  });
  const html = renderPublishPage(okLeaf(leaf), NO_RULES);
  const row = (id: string, markup = html) => {
    const start = markup.indexOf(`data-publish-row="${id}"`);
    assert.ok(start >= 0, `missing preview row ${id}`);
    return markup.slice(start, markup.indexOf("</li>", start));
  };
  const publicTitle = (id: string) => {
    const disclosure = row(id).match(/<details data-public-title-preview><summary>Public title<\/summary><p data-title-redacted="true">([^<]*)<\/p><\/details>/);
    assert.ok(disclosure, `missing redacted public title for ${id}`);
    return disclosure[1];
  };
  assert.doesNotMatch(html, /Would cross/, "link policy must not be described as export readiness");
  assert.match(html, /data-publish-total="public">[\s\S]*?leaf-count">5</);
  assert.match(html, /data-publish-total="unlisted">[\s\S]*?leaf-count">1</);
  assert.match(html, /data-static-export="confirmation"/);
  assert.match(row("public"), /data-static-export-row="selected"/);
  assert.match(row("unlisted"), /data-static-export-row="link-only"/);
  assert.equal(publicTitle("unlisted"), "Explored with [withheld: email address]", "a shared link shows the title its reader sees");
  assert.match(row("excluded"), /data-static-export-row="not-own-work"/);
  assert.match(row("email"), /data-static-export-row="email-title"/);
  assert.match(row("email"), /Title needs confirmation/);
  assert.equal(publicTitle("email"), "Thanks [withheld: email address]", "the owner can inspect the exact export heading before --confirm");
  assert.doesNotMatch(row("public"), /data-public-title-preview/, "an unchanged title needs no disclosure");
  for (const id of ["apostrophe", "typo"]) {
    assert.match(row(id), /data-static-export-row="email-title"/, `preview and export must use the same address detector for ${id}`);
    assert.match(row(id), /data-public-title-preview/, `the shared-link preview must show the redaction for ${id}`);
  }
  assert.equal(publicTitle("apostrophe"), "Contact [withheld: email address]", "the apostrophe must not remain beside the placeholder");
  assert.equal(publicTitle("typo"), "Contact [withheld: email address]");

  const privateEmailLeaf: Leaf = {
    ...leaf,
    leaflets: leaf.leaflets.map((item) => item.id === "email" ? { ...item, visibility: "private" as const } : item),
  };
  const privateHtml = renderPublishPage(okLeaf(privateEmailLeaf), NO_RULES);
  assert.match(row("email", privateHtml), /data-publish-status="private"/);
  assert.doesNotMatch(row("email", privateHtml), /data-public-title-preview/, "a private row has no public title to review");

  const withoutEmail = leafFrom({ id: "studio-export-ready", subject: "Studio Export Fixture", leaflets: [
    { id: "public", title: "Built search", tier: "pending", visibility: "public" },
  ] });
  assert.match(renderPublishPage(okLeaf(withoutEmail), NO_RULES), /data-static-export="ready"/);
  const exampleLoad = okLeaf(withoutEmail);
  assert.equal(exampleLoad.ok, true);
  if (!exampleLoad.ok) throw new Error("unreachable");
  const exampleHtml = renderPublishPage({ ...exampleLoad, source: { ...exampleLoad.source, declaredExample: true } }, NO_RULES);
  assert.match(exampleHtml, /data-static-export="example"/);
  assert.match(exampleHtml, /data-static-export-row="example"/);
});

test("the publish preview on an empty leaf says so, and totals nothing", () => {
  const html = renderPublishPage(okLeaf(emptyLeaf), NO_RULES);
  assert.match(text(html), /has no leaflets yet/i);
  assert.doesNotMatch(html, /data-publish-row=/);
});

test("the publish preview renders the leaf's own failure states, same five causes", () => {
  const absent = renderPublishPage({ ok: false, cause: "absent", detail: "d", path: "/p" }, NO_RULES);
  const unconfigured = renderPublishPage({ ok: false, cause: "unconfigured", detail: "d", path: null }, NO_RULES);
  assert.notEqual(absent, unconfigured);
  assert.match(text(absent), /Leaf file missing/);
  assert.match(text(unconfigured), /No Leaf file configured/);
});

/* ==================================================================== the Photosynthesis page ==== */

const MODEL_OK: ModelConfigResult = { ok: true, config: { model: "fixture-model", baseUrl: "http://127.0.0.1:11434" } };
const MODEL_NONE: ModelConfigResult = { ok: false, cause: "no-model-declared" };
const PROVENANCE = { runtime: "ollama" as const, model: "fixture-model", endpoint: "http://127.0.0.1:11434/api/chat" };

const askView = (leaf: LeafLoad = okLeaf(populatedLeaf), model: ModelConfigResult = MODEL_OK): ScarletView => ({
  kind: "ask",
  leaf,
  model,
  refusal: null,
});
const answeredView = (answer: string, leaf: LeafLoad = okLeaf(populatedLeaf), question = "what is here?"): ScarletView => ({
  kind: "answered",
  leaf,
  question,
  answer,
  provenance: PROVENANCE,
});
const refusedView = (code: PageRefusal, leaf: LeafLoad = okLeaf(populatedLeaf), question = "what is here?"): ScarletView =>
  code === "empty-question" || code === "question-too-long"
    ? { kind: "ask", leaf, model: MODEL_OK, refusal: code }
    : { kind: "refused", leaf, question, code, message: `the ${code} message`, provenance: PROVENANCE };

/** The page minus the one region a model authored — what `assertNoScoreShapedText` sweeps. */
function chromeOnly(html: string): string {
  return html.replace(/<section class="scarlet-answer" data-authored="model-answer"[^>]*>[\s\S]*?<\/section>/, "<>");
}

const THREE_VIEWS: readonly [string, ScarletView][] = [
  ["ask", askView()],
  ["answered", answeredView("The leaf holds four leaflets.")],
  ["refused", refusedView("timeout")],
];

test("the Photosynthesis page carries the studio nav with Photosynthesis current, one h1, and no score — on every view", () => {
  for (const [name, view] of THREE_VIEWS) {
    const html = renderScarletPage(view);
    assertNavPresent(html, "Photosynthesis");
    assertSingleH1(html, `scarlet (${name})`);
    assert.match(html, /<h1 id="scarlet-h">Ask about this leaf<\/h1>/);
    assert.match(html, /data-surface="scarlet"/);
    assert.match(html, /data-face="night"/, `${name}: an instrument surface takes the night face`);
    assertNoScoreShapedText(chromeOnly(html), `scarlet (${name})`);
    assert.match(html, /<form class="scarlet-form" method="post" action="\/scarlet">/);
    assert.match(html, new RegExp(`<textarea class="fol-textarea field" data-slot="textarea" id="q" name="question" rows="4" maxLength="${QUESTION_MAX_CHARS}" required=""(?: aria-describedby="assistant-status")?>`));
    assert.equal(QUESTION_MAX_CHARS, 4000);
    assert.match(html, /<button[^>]*data-variant="default"[^>]*type="submit"[^>]*>Ask<\/button>/);
    assert.equal((html.match(/fol-button-primary/g) ?? []).length, 1, `${name}: one accent on the page`);
    assert.match(text(html), /Your work, on this device/);
  }
});

test("the three tier cells are integers in the fixed order verified/pending/excluded, equal to the ledger over the same leaf", () => {
  const html = renderScarletPage(askView());
  const cells = [...html.matchAll(/data-scarlet-count="([a-z]+)">\s*<span class="fol-label">[a-z]+<\/span>\s*<b class="fol-metric leaf-count">(\d+)</g)];
  assert.deepEqual(
    cells.map((m) => [m[1], Number(m[2])]),
    [
      ["verified", 2],
      ["pending", 1],
      ["excluded", 1],
    ],
  );
  const provenance = text(/<dl class="leaf-prov" aria-label="Provenance">[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "");
  assert.match(provenance, /Model ollama · fixture-model/);
  assert.match(provenance, /Endpoint http:\/\/127\.0\.0\.1:11434\/api\/chat/);
  assert.match(provenance, /Grounded on 4 titles/);
  // Each value is a `<dd class="fol-metric">` in the leaflet's own provenance list — the one
  // component whose values wrap inside their column, which a URL needs.
  assert.match(html, /<div data-scarlet-provenance="endpoint"><dt class="fol-label">Endpoint<\/dt><dd class="fol-metric">http:\/\/127\.0\.0\.1:11434\/api\/chat<\/dd><\/div>/);
  const one = leafFrom({ id: "studio-one", subject: "One", leaflets: [{ id: "only", title: "the only one", tier: "pending" }] });
  assert.match(text(renderScarletPage(askView(okLeaf(one)))), /Grounded on 1 title(?!s)/);
});

test("the provenance rows are a REPORT after a run and a PROMISE before one: a refusal that named no model shows none", () => {
  const values = (html: string): readonly string[] =>
    [...html.matchAll(/data-scarlet-provenance="[a-z-]+"><dt class="fol-label">[^<]*<\/dt><dd class="fol-metric">([^<]*)<\/dd>/g)].map((m) => m[1] ?? "");
  // Before a run: what the configuration in force promises.
  assert.deepEqual(values(renderScarletPage(askView())), ["ollama · fixture-model", "http://127.0.0.1:11434/api/chat", "4 titles"]);
  assert.deepEqual(values(renderScarletPage(askView(okLeaf(populatedLeaf), MODEL_NONE))), [], "first-run setup does not compete with execution metadata");
  // After one: what the run itself reported, or a dash where it reported nothing.
  const refusedBeforeAModel: ScarletView = { kind: "refused", leaf: okLeaf(populatedLeaf), question: "q", code: "not-loopback", message: "m", provenance: null };
  assert.deepEqual(values(renderScarletPage(refusedBeforeAModel)), ["—", "—", "4 titles"]);
  assert.deepEqual(values(renderScarletPage(refusedView("timeout"))), ["ollama · fixture-model", "http://127.0.0.1:11434/api/chat", "4 titles"]);
  assert.deepEqual(values(renderScarletPage(answeredView("An answer."))), ["ollama · fixture-model", "http://127.0.0.1:11434/api/chat", "4 titles"]);
});

test("band differential is a CONTROL: an example source renders the band on every view, a real source never does", () => {
  const example: LeafLoad = {
    ok: true,
    leaf: populatedLeaf,
    source: { path: "/tmp/example.json", bytes: 512, documentDigest: `sha256:${"0".repeat(64)}`, readAt: "2026-08-26T00:00:00Z", declaredExample: true, bundledExample: false },
  };
  const views = (leaf: LeafLoad): readonly ScarletView[] => [askView(leaf), answeredView("An answer.", leaf), refusedView("timeout", leaf)];
  for (const view of views(example)) {
    assert.match(renderScarletPage(view), /<aside class="leaf-band" role="alert" data-fabricated="true">/, `${view.kind}: example → band`);
  }
  for (const view of views(okLeaf(populatedLeaf))) {
    assert.doesNotMatch(renderScarletPage(view), /data-fabricated/, `${view.kind}: real → no band`);
  }
  // The Overview and the publish preview render leaf numbers too, so they follow the same control.
  const pages = (leaf: LeafLoad): ReadonlyArray<readonly [string, string]> => [
    ["overview", renderOverviewPage(leaf, okHarvest(queue), NO_RULES, DEFAULT_SOURCE)],
    ["publish preview", renderPublishPage(leaf, NO_RULES)],
  ];
  for (const [name, html] of pages(example)) {
    assert.match(html, /role="alert" data-fabricated="true"/, `${name}: example → band`);
  }
  for (const [name, html] of pages(okLeaf(populatedLeaf))) {
    assert.doesNotMatch(html, /data-fabricated/, `${name}: real → no band`);
  }
});

test("the answer lives in data-authored=\"model-answer\", labelled Not kept, paragraphs from blank lines, single line breaks as spaces", () => {
  const html = renderScarletPage(answeredView("First line\nsame paragraph.\n\nSecond paragraph."));
  const region = /<section class="scarlet-answer" data-authored="model-answer" aria-labelledby="scarlet-answer-h">[\s\S]*?<\/section>/.exec(html);
  assert.ok(region, "the answer region must be present");
  assert.match(region![0], /<span class="fol-label" id="scarlet-answer-h">Answer<\/span>/);
  assert.match(region![0], /<span class="fol-label">Not kept<\/span>/);
  assert.match(region![0], /<p>First line same paragraph\.<\/p>\n<p>Second paragraph\.<\/p>/);
  assert.doesNotMatch(region![0], /contains a rating/);
  assert.doesNotMatch(html, /data-rating-shaped/);
  // The question survives the round trip, in the textarea.
  assert.match(html, /<textarea[^>]*>what is here\?<\/textarea>/);
});

test("a rating-shaped answer is withheld and marked without displaying the rating", () => {
  const answer = "This person's work rates 9/10 overall.";
  assert.match(answer, RATING_SHAPED, "the fixture must be rating-shaped by the product's own rule");
  const html = renderScarletPage(answeredView(answer));
  assert.match(html, /<section class="scarlet-answer" data-authored="model-answer" data-rating-shaped="true"/);
  assert.match(html, /<span class="fol-label">contains a rating<\/span>/);
  assert.ok(!text(html).includes(answer), "rating-shaped output is not displayed");
  assert.match(html, /contains a rating/);
  assertNoScoreShapedText(chromeOnly(html), "scarlet (rating-shaped answer, chrome only)");
});

test("everything a model, a person or a document wrote is escaped: answer, question, provenance, grounding", () => {
  const planted = "<script>alert(1)</script>";
  const plantedLeaf = leafFrom({
    id: "studio-planted",
    subject: `Subject ${planted}`,
    leaflets: [{ id: "p1", title: `title ${planted}`, tier: "excluded", reason: `reason ${planted}` }],
  });
  const view: ScarletView = {
    kind: "answered",
    leaf: okLeaf(plantedLeaf),
    question: `q ${planted}`,
    answer: `a ${planted}`,
    provenance: { runtime: "ollama", model: `m ${planted}`, endpoint: `http://127.0.0.1:1/${planted}` },
  };
  const html = renderScarletPage(view);
  assert.doesNotMatch(html, /<script/, "no planted tag survives as markup");
  const escaped = (html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) ?? []).length;
  // question, answer, model, endpoint, subject, title, reason — the subject's own words too.
  assert.ok(escaped >= 7, `expected the planted text escaped in every place it was put, found ${escaped}`);
});

test("GET with no model leads to a working setup action, without a dead Ask form; a blank question is 400", () => {
  const unconfigured = renderScarletPage(askView(okLeaf(populatedLeaf), MODEL_NONE));
  assert.equal(httpStatusForScarlet(askView(okLeaf(populatedLeaf), MODEL_NONE)), 200);
  assert.match(unconfigured, /<aside class="review-refusal" role="alert" data-refusal="no-model-declared" id="assistant-status">/);
  assert.match(unconfigured, /<strong>No local model<\/strong>/);
  assert.match(unconfigured, /href="\/scarlet\/setup"[^>]*>Choose local model<\/a>/);
  assert.doesNotMatch(unconfigured, /<form class="scarlet-form"/, "no dead Ask form before setup");
  assertSingleH1(unconfigured, "scarlet (no model)");

  const configured = renderScarletPage(askView());
  assert.doesNotMatch(configured, /data-refusal/);

  const blank = refusedView("empty-question");
  assert.equal(httpStatusForScarlet(blank), 400);
  assert.match(renderScarletPage(blank), /data-refusal="empty-question"/);
  const long = refusedView("question-too-long");
  assert.equal(httpStatusForScarlet(long), 400);
  assert.match(renderScarletPage(long), /<strong>Question too long<\/strong>/);

  // A leaf that did not load offers portfolio setup instead of a disabled form.
  const noLeaf = askView({ ok: false, cause: "absent", detail: "no file", path: "/nope" });
  const noLeafHtml = renderScarletPage(noLeaf);
  assert.equal(httpStatusForScarlet(noLeaf), 200);
  assert.match(noLeafHtml, /data-refusal="leaf-unavailable"/);
  assert.match(text(noLeafHtml), /absent — no file/);
  assert.match(noLeafHtml, /href="\/leaf\/setup"[^>]*>Open portfolio setup<\/a>/);
  assert.doesNotMatch(noLeafHtml, /<form class="scarlet-form"/);
  assert.doesNotMatch(noLeafHtml, /data-scarlet-count/, "no leaf, no counts — never zeros");
  assert.doesNotMatch(noLeafHtml, /data-more="grounding"/, "no leaf, nothing given — the aside already says why");
});

test("data-leaf-empty means what it means on every sibling: the leaf LOADED and holds nothing — never that it failed to load", () => {
  assert.match(renderScarletPage(askView(okLeaf(emptyLeaf))), /data-leaf-empty="true"/);
  assert.match(renderScarletPage(answeredView("Nothing here.", okLeaf(emptyLeaf))), /data-leaf-empty="true"/);
  assert.doesNotMatch(renderScarletPage(askView()), /data-leaf-empty/);
  const unreadable: LeafLoad = { ok: false, cause: "unreadable", detail: "EACCES", path: "/p", errno: "EACCES" };
  const html = renderScarletPage(askView(unreadable));
  assert.match(html, /data-leaf-state="leaf-unavailable"/);
  assert.doesNotMatch(html, /data-leaf-empty/, "a failed load is a state, not an empty document");
});

test("a refused view shows a human label and recovery, with technical code tucked away and question kept", () => {
  const html = renderScarletPage(refusedView("model-absent"));
  const aside = /<aside class="review-refusal" role="alert" data-refusal="model-absent" id="assistant-status">[\s\S]*?<\/aside>/.exec(html);
  assert.ok(aside);
  assert.match(aside![0], /<span class="fol-label">Not answered<\/span>/);
  assert.match(aside![0], /<strong>Model not installed<\/strong>/);
  assert.match(aside![0], /href="\/scarlet\/setup"[^>]*>Choose local model<\/a>/);
  assert.match(aside![0], /<details[^>]*data-more="scarlet-error"[^>]*>[\s\S]*model-absent[\s\S]*<\/details>/);
  assert.ok(html.indexOf("</form>") < html.indexOf('data-refusal="model-absent"'), "after the form");
  assert.match(html, /<textarea[^>]*>what is here\?<\/textarea>/);
  assert.doesNotMatch(html, /data-authored="model-answer"/);
});

test("a local model not answering is named at its address with Ollama's setup, and the socket error stays in technical details", () => {
  const raw = "http://127.0.0.1:11434/api/chat could not be reached: fetch failed (cause: connect ECONNREFUSED 127.0.0.1:11434)";
  const html = renderScarletPage({ ...refusedView("no-runtime"), message: raw } as ScarletView);
  const aside = /<aside class="review-refusal" role="alert" data-refusal="no-runtime" id="assistant-status">[\s\S]*?<\/aside>/.exec(html)![0];
  assert.match(aside, /<strong>The local model isn&#39;t answering at 127\.0\.0\.1:11434<\/strong><a [^>]*href="https:\/\/docs\.ollama\.com\/quickstart"[^>]*>Get Ollama<\/a>/);
  assert.doesNotMatch(aside, /Choose local model/, "choosing another model does not start Ollama");
  const details = /<details[^>]*data-more="scarlet-error"[^>]*>[\s\S]*?<\/details>/.exec(aside)![0];
  assert.ok(details.includes("ECONNREFUSED"));
  assert.equal(html.split("ECONNREFUSED").length - 1, details.split("ECONNREFUSED").length - 1, "the raw error appears only in technical details");

  // Any base URL that does not answer is `no-runtime`; at one of the person's own choosing, Foliage
  // knows nothing is answering there, not that Ollama is missing.
  const custom = { ...PROVENANCE, endpoint: "http://127.0.0.1:8080/v1/api/chat" };
  const elsewhere = renderScarletPage({ ...refusedView("no-runtime"), provenance: custom } as ScarletView);
  const otherAside = /<aside class="review-refusal"[\s\S]*?<\/aside>/.exec(elsewhere)![0];
  assert.match(otherAside, /<strong>The local model isn&#39;t answering at 127\.0\.0\.1:8080<\/strong><a [^>]*href="https:\/\/docs\.ollama\.com\/quickstart"[^>]*>Ollama setup help<\/a>/);
  assert.doesNotMatch(elsewhere, /Get Ollama|isn&#39;t running|11434/);
  assert.equal(refusalLabel("no-runtime", null), "The local model isn't answering", "no address is never invented");
  assert.equal(refusalRecovery("no-runtime", null)?.label, "Ollama setup help");
});

/**
 * The status for every refusal word the page knows. A `switch` with a `never` default, so a word
 * added to `PageRefusal` without a row here fails the typecheck — and the loop below runs over
 * `PAGE_REFUSALS`, which the page module keeps exhaustive by the same discipline.
 */
function expectedStatus(code: PageRefusal): number | "leaf-split" {
  switch (code) {
    case "empty-question":
    case "question-too-long":
      return 400;
    case "no-model-declared":
    case "not-loopback":
    case "malformed-endpoint":
      return 409;
    case "no-runtime":
    case "model-absent":
    case "timeout":
    case "redirected":
    case "runtime-refused":
    case "malformed-response":
      return 502;
    case "leaf-unavailable":
      return "leaf-split";
    default: {
      const impossible: never = code;
      throw new Error(`unhandled refusal ${JSON.stringify(impossible)}`);
    }
  }
}

test("httpStatusForScarlet answers every PageRefusal by name: 400 / 409 / 502, and leaf-unavailable splits 409 / 500 by cause", () => {
  assert.equal(PAGE_REFUSALS.length, 12);
  assert.equal(httpStatusForScarlet(askView()), 200);
  assert.equal(httpStatusForScarlet(answeredView("An answer.")), 200);
  for (const code of PAGE_REFUSALS) {
    const expected = expectedStatus(code);
    if (expected !== "leaf-split") {
      assert.equal(httpStatusForScarlet(refusedView(code)), expected, code);
      continue;
    }
    const causes: readonly [LeafLoad, number][] = [
      [{ ok: false, cause: "unconfigured", detail: "d", path: null }, 409],
      [{ ok: false, cause: "absent", detail: "d", path: "/p" }, 409],
      [{ ok: false, cause: "unreadable", detail: "d", path: "/p", errno: "EACCES" }, 409],
      [{ ok: false, cause: "malformed", detail: "d", path: "/p" }, 409],
      [{ ok: false, cause: "invalid", detail: "d", path: "/p", issues: [{ at: "leaflets[0].id", message: "bad" }] }, 409],
    ];
    for (const [leaf, status] of causes) {
      assert.equal(httpStatusForScarlet(refusedView(code, leaf)), status, `leaf-unavailable with ${leaf.ok ? "ok" : leaf.cause}`);
    }
  }
});

test("the disclosure shows what Photosynthesis was given, from the same grounding text, and ends with the ceiling from the one constant", () => {
  const html = renderScarletPage(askView());
  const drawer = /<details class="leaf-more" data-more="grounding">[\s\S]*?<\/details>/.exec(html);
  assert.ok(drawer);
  assert.match(drawer![0], /<summary>What Photosynthesis was given<\/summary>/);
  // One wrapped paragraph per line of the prompt, never a <pre>: a long title must wrap inside
  // the measure, not widen the document (measured in the browser on the real leaf).
  assert.doesNotMatch(drawer![0], /<pre/);
  assert.match(drawer![0], /<p>Subject: Studio Fixture Subject<\/p>/);
  assert.match(text(drawer![0]), /verified: 2; pending: 1; excluded: 1/);
  assert.match(drawer![0], /<p>- &quot;first verified&quot; \(verified\)<\/p>/);
  assert.match(text(drawer![0]), new RegExp(`Ceiling: ${MODEL_CEILING_MS / 1000} s$`));
  assert.equal(MODEL_CEILING_MS / 1000, 180);
});

/*
 * THE NEXT STEP MAY NOT ADVERTISE WORK THAT IS ALREADY DONE.
 *
 * `nextStep` promises "one deterministic sentence, never invented ... every branch is a fact
 * already computed above". Counting approved candidates without asking whether they are already IN
 * the leaf broke that promise in the direction that costs most: the sentence stayed confidently
 * wrong forever, because promoting a candidate could never reduce the number it counted. Measured
 * on the owner's real garden, the overview offered "31 approved candidates ready to promote" while
 * `/review`, one click away, said every approved candidate was already carried across.
 *
 * The two candidates below are both `approved`; one shares an id with a leaflet in the leaf and one
 * does not, so a regression that drops the subtraction says 2 and fails on the first assertion,
 * while a regression that subtracts the wrong way says 0 and fails on the second.
 */
test("overview: 'ready to promote' counts only approved candidates NOT already in the leaf", () => {
  const promotedAndNot = harvestFrom({
    candidates: [
      {
        id: "sv1", // already a leaflet in populatedLeaf — carried across, must not be offered again
        title: "first verified",
        evidence: [{ source: "git", ref: "aaa1111", observedAt: "2026-08-20T09:00:00Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-08-22T09:00:00Z",
        review: { state: "approved", by: "Alex A", at: "2026-08-29T19:22:02.560Z" },
      },
      {
        id: "git-cluster:fresh", // approved, in no leaf — the one real piece of work waiting
        title: "feat: not yet promoted",
        evidence: [{ source: "git", ref: "ddd4444", observedAt: "2026-08-21T09:00:00Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-08-22T09:00:00Z",
        review: { state: "approved", by: "Alex A", at: "2026-08-29T19:22:02.560Z" },
      },
    ],
  });

  const one = text(renderOverviewPage(okLeaf(populatedLeaf), okHarvest(promotedAndNot), NO_RULES, DEFAULT_SOURCE));
  assert.match(one, /Add 1 approved to your record/);
  assert.doesNotMatch(one, /Add 2 approved to your record/);

  // Every approved candidate already in the leaf: the queue is FINISHED, not pending. The overview
  // must fall through to the quiet branch rather than advertise a to-do that cannot be cleared.
  const allPromoted = harvestFrom({
    candidates: [
      {
        id: "sv1",
        title: "first verified",
        evidence: [{ source: "git", ref: "aaa1111", observedAt: "2026-08-20T09:00:00Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-08-22T09:00:00Z",
        review: { state: "approved", by: "Alex A", at: "2026-08-29T19:22:02.560Z" },
      },
    ],
  });
  const none = text(renderOverviewPage(okLeaf(populatedLeaf), okHarvest(allPromoted), NO_RULES, DEFAULT_SOURCE));
  assert.doesNotMatch(none, /Add \d+ approved to your record/);
  assert.doesNotMatch(none, /data-next-step="true"/, "finished work has no invented task");
});
