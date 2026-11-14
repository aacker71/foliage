import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROOF_TIERS,
  attributionLedger,
  isLinkShareable,
  leafletVisibility,
  parseLeafDocument,
  type Leaf,
  type PublishPolicy,
  type Leaflet,
} from "@foliage/leaf";
import { parseHarvestDocument, promoteApproved, type HarvestDocument, type JevMark } from "@foliage/photosynthesis";

import { contrastRatio, remTokenToPx, resolveTokenValue, wcagMinimum } from "./dayFace.ts";
import type { LeafLoad, LeafSource } from "./leafDocument.ts";
import { leafLoadProblem } from "./loadLabels.ts";
import {
  LEAFLET_ROUTE,
  REVIEW_ROUTE,
  describePolicySourceHtml,
  esc,
  findLeaflet as findLeafletUnderPolicy,
  httpStatusForHarvest,
  httpStatusForRefusal,
  httpStatusForUnwritable,
  leafletHref,
  ownerLeafletHref,
  pathChip,
  renderLeafPage as renderLeafPageUnderPolicy,
  renderLeafletPage,
  renderPromoteRefused,
  renderReviewPage,
  renderReviewWriteRefused,
  PROMOTE_ROUTE,
  type LeafIndexUnavailable,
  type HarvestLoad,
  type LeafIndex,
  type LeafletLoad,
  type ReviewRefusal,
} from "./render.ts";

/*
 * THE POLICY THESE ASSERTIONS RUN UNDER, made explicit rather than defaulted.
 *
 * `renderLeafPage` and `findLeaflet` now take the publish policy, because a deny rule is
 * evaluated at publish time and beats the subject's own share. Every test below was written
 * about the visibility gate alone, so it runs under the EMPTY policy — no rails fire, no
 * proposals are made, and each assertion still measures exactly what it was written to measure.
 * That is a real state of the domain (a subject who has written no rules yet), not a hole: the
 * rail's own behaviour is asserted in `policy.test.ts` and, on the running server, in
 * `policySeam.test.ts`.
 */
const NO_RULES: PublishPolicy = { rules: [] };
const renderLeafPage = (load: LeafLoad, audience: "private" | "published" = "published", options?: Parameters<typeof renderLeafPageUnderPolicy>[3]): string =>
  renderLeafPageUnderPolicy(load, NO_RULES, audience, options);
const findLeaflet = (leaf: Leaf, id: string): LeafletLoad =>
  findLeafletUnderPolicy(leaf, id, NO_RULES);


/** The stylesheet, read once — one test below asserts a structural property of it. */
const leafCssSource = await readFile(new URL("../public/leaf.css", import.meta.url), "utf8");

/**
 * These tests pin the RENDER CONTRACT, not the visual design. They assert on structure
 * (`data-leaf-state`, `data-ledger`, `data-tier`), on the numbers matching the domain, and on
 * what must never appear. The stylesheet and the copy can change freely without touching them
 * — which is the point: the visual lane must be able to work without being able to break the
 * honesty guarantees.
 */

const prov = { source: "git", ref: "e3b4489", observedAt: "2026-08-13T00:00:00Z" };

/**
 * The counts cell for one review state, sliced out by its OWN attribute rather than by the shape
 * of the markup around it.
 *
 * WHY THIS HELPER EXISTS. The assertions it replaces were whitespace-exact regexes spanning two
 * elements, so a newline moving inside a cell failed a test about arithmetic. Locating the region
 * first and asserting a relationship inside it is the difference between a test that protects the
 * domain and a test that punishes the redesign.
 *
 * The end of the cell is found by scanning to the next element that carries the same attribute,
 * or to the end of the document — deliberately NOT by matching a closing tag, which would have to
 * know how deeply the cell nests and would break again the next time it does.
 */
function countCell(html: string, state: string): string | null {
  const start = html.indexOf(`data-review-count="${state}"`);
  if (start === -1) return null;
  const next = html.indexOf("data-review-count=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

function leafFrom(doc: unknown): Leaf {
  const parsed = parseLeafDocument(doc);
  assert.equal(parsed.ok, true, "test input must be a valid document");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function sourceAt(path: string, over: Partial<LeafSource> = {}): LeafSource {
  return {
    path,
    bytes: 512,
    documentDigest: `sha256:${"0".repeat(64)}`,
    readAt: "2026-08-13T01:00:00Z",
    declaredExample: false,
    bundledExample: false,
    ...over,
  };
}

/**
 * Visible text only, so assertions are about what a reader sees: tags removed and entities
 * decoded, because `&quot;example&quot;` in the markup is the character `"` on the page.
 */
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

function stateOf(html: string): string {
  return /data-leaf-state="([^"]+)"/.exec(html)?.[1] ?? "(none)";
}

const populated = leafFrom({
  id: "leaf-under-test",
  subject: "Render Input",
  leaflets: [
    { id: "a", title: "first verified", tier: "verified", provenance: prov },
    { id: "b", title: "second verified", tier: "verified", provenance: prov },
    { id: "c", title: "waiting on proof", tier: "pending" },
    { id: "d", title: "not attributable", tier: "excluded", reason: "different author identity" },
    { id: "e", title: "also not attributable", tier: "excluded", reason: "vendored third-party code" },
  ],
});

const listedPopulated = leafFrom({
  ...populated,
  leaflets: populated.leaflets.map((record) => record.tier === "excluded" ? record : { ...record, visibility: "public" }),
});

const empty = leafFrom({ id: "leaf-empty", subject: "Empty Subject", leaflets: [] });

const okLoad = (leaf: Leaf, source = sourceAt("/tmp/leaf.json")): LeafLoad => ({
  ok: true,
  leaf,
  source,
});

test("THE SIX STATES RENDER SIX DIFFERENT PAGES", () => {
  // The whole capability turns on `absent` and "valid but empty" being visibly different. If
  // any two of these collapse, the page lies about which one happened.
  const pages: readonly [string, string][] = [
    ["ok", renderLeafPage(okLoad(populated))],
    ["ok-empty", renderLeafPage(okLoad(empty))],
    ["unconfigured", renderLeafPage({ ok: false, cause: "unconfigured", detail: "d", path: null })],
    ["absent", renderLeafPage({ ok: false, cause: "absent", detail: "d", path: "/p" })],
    [
      "unreadable",
      renderLeafPage({ ok: false, cause: "unreadable", detail: "d", path: "/p", errno: "EACCES" }),
    ],
    ["malformed", renderLeafPage({ ok: false, cause: "malformed", detail: "d", path: "/p" })],
    [
      "invalid",
      renderLeafPage({
        ok: false,
        cause: "invalid",
        detail: "d",
        path: "/p",
        issues: [{ at: "leaflets[0].reason", message: "required" }],
      }),
    ],
  ];

  assert.equal(new Set(pages.map(([, html]) => html)).size, pages.length, "no two pages identical");
  assert.equal(
    new Set(pages.map(([, html]) => text(html))).size,
    pages.length,
    "and no two READ the same either — a distinct attribute with identical prose is not honest",
  );
});

test("ABSENT AND EMPTY SAY DIFFERENT THINGS, in words a reader can tell apart", () => {
  const absent = renderLeafPage({
    ok: false,
    cause: "absent",
    detail: "No leaf document was found at /srv/leaf.json",
    path: "/srv/leaf.json",
  });
  const emptyPage = renderLeafPage(okLoad(empty, sourceAt("/srv/leaf.json")));

  assert.equal(stateOf(absent), "absent");
  assert.equal(stateOf(emptyPage), "ok");
  assert.match(emptyPage, /data-leaf-empty="true"/);
  assert.doesNotMatch(absent, /data-leaf-empty/);

  // The public failure keeps the cause distinct without disclosing the host's file path.
  assert.ok(!absent.includes("/srv/leaf.json"));
  assert.ok(!absent.includes("FOLIAGE_LEAF"));
  assert.ok(!text(absent).includes("Empty Subject"));

  const privateAbsent = renderLeafPage({
    ok: false,
    cause: "absent",
    detail: "No leaf document was found at /srv/leaf.json",
    path: "/srv/leaf.json",
  }, "private");
  assert.match(privateAbsent, /<html lang="en" data-face="night">/);
  assert.match(privateAbsent, /<body class="fol-app" data-surface="leaf" data-leaf-state="absent">/);
  assert.match(privateAbsent, /<header class="fol-workspace"/);
  assert.match(privateAbsent, /<a href="\/leaf" aria-current="page">Portfolio<\/a>/);
  assert.match(privateAbsent, /Create private record/);
  assert.match(privateAbsent, /href="\/leaf\/setup"/);
  assert.equal([...privateAbsent.matchAll(/Create private record/g)].length, 1);
  assert.doesNotMatch(privateAbsent, /Nothing counted|class="ico"/);
  assert.doesNotMatch(privateAbsent, /\/srv\/leaf\.json|FOLIAGE_LEAF/);
  assert.match(absent, /<html lang="en" data-face="day">/);
  assert.doesNotMatch(absent, /<header class="fol-workspace"/);

  // Published empty means nothing is offered here, not that the private document is empty.
  assert.ok(text(emptyPage).includes("Empty Subject"));
  assert.match(text(emptyPage), /Nothing published yet/);
  assert.doesNotMatch(text(emptyPage), /nothing in it yet|Add a leaflet|reload/);

  // And neither of them is a dashboard of zeros pretending to be data.
  assert.doesNotMatch(text(absent), /Attribution/);
});

test("an empty leaf still shows an honest tally of zeros, under the empty message, on the OWNER's own view", () => {
  // Zeros are the true tally of an empty leaf. Hiding them would be a small dishonesty; the
  // distinguishing signal is the message above them, not a missing section. THE STRIP THIS
  // ASSERTS ON is private-audience only (see the test below dedicated to that split), so this
  // test now says which audience it means rather than relying on the default.
  const html = renderLeafPage(okLoad(empty), "private");
  assert.match(html, /data-count="verified">0</);
  assert.match(html, /data-count="pending">0</);
  assert.match(html, /data-count="excluded">0</);
  assert.match(text(html), /no leaflets yet/i);
});

test("EVERY NUMBER ON THE PAGE COMES FROM attributionLedger — digit for digit", () => {
  // The strip this pins is private-audience only — see the dedicated split test below.
  const ledger = attributionLedger(populated);
  const html = renderLeafPage(okLoad(populated), "private");

  for (const [tier, n] of [
    ["verified", ledger.verified],
    ["pending", ledger.pending],
    ["excluded", ledger.excluded],
  ] as const) {
    const m = new RegExp(`data-count="${tier}">(\\d+)<`).exec(html);
    assert.ok(m, `no rendered count for ${tier}`);
    assert.equal(Number(m[1]), n, `${tier} on the page must equal the ledger`);
  }
});

test("the rendered rows and the ledger cannot drift apart", () => {
  const ledger = attributionLedger(listedPopulated);
  const html = renderLeafPage(okLoad(listedPopulated));
  // The PLAIN attribute, deliberately. This test used to match the compound string
  // `class="leaf-leaflet" data-tier="..."` — the workaround from when `data-tier` was
  // overloaded onto rows AND pills AND the legend. Fixing that overload (the pill took
  // `data-pill-tier`) is what made the obvious selector correct; the test kept the
  // workaround anyway, and a re-skin that touched the class list exposed it. Matching
  // the attribute alone is now both simpler and stronger: it would catch the overload
  // coming back, which the compound form never could.
  const rows = (tier: string) =>
    [...html.matchAll(new RegExp(`data-tier="${tier}"`, "g"))].length;

  assert.equal(rows("excluded"), ledger.excluded, "one row per excluded leaflet");
  assert.equal(rows("pending"), ledger.pending);
  assert.equal(rows("verified"), ledger.verified, "verified rows are the outward claims");
});

test("published work leads with owner-shared records, and pending attribution stays explicit", () => {
  // This is the shape export hands the renderer: an admitted public projection. The renderer
  // still checks admission itself so a future direct caller cannot turn a private row into work.
  const fullRef = "f".repeat(40);
  const admitted = leafFrom({
    id: "reader-projection",
    subject: "Reader Input",
    leaflets: [
      { id: "verified", title: "A shared verified record", tier: "verified", visibility: "public", provenance: prov },
      { id: "pending", title: "A shared pending record", tier: "pending", visibility: "public", provenance: { ...prov, ref: fullRef } },
    ],
  });
  const html = renderLeafPage(okLoad(admitted));
  const workStart = html.indexOf('data-region="work"');
  const ledgerStart = html.indexOf('data-region="ledger"');
  assert.ok(workStart >= 0 && workStart < ledgerStart, "shared records precede attribution");
  const work = html.slice(workStart, ledgerStart);
  assert.match(work, /<h2 id="leaf-work-h">Shared work<\/h2>/);
  assert.match(work, /A shared verified record/);
  assert.match(work, /A shared pending record/);
  assert.match(work, /data-pill-tier="pending"[^>]*>[\s\S]*?Attributed, unverified/);
  assert.match(work, /<summary>Evidence <span class="fol-metric" title="f{40}">fffffff<\/span><\/summary>/);
  assert.match(work, /<details class="leaf-row-evidence">[\s\S]*?<dd class="fol-metric">[\s\S]*?<summary>Full reference<\/summary><code class="fol-metric">f{40}<\/code>/);
  assert.equal([...html.matchAll(/data-tier="pending"/g)].length, 1, "the pending record is not repeated in Attribution");
  assert.doesNotMatch(html, /<footer class="leaf-source">|<span class="fol-label">Document<\/span>/, "reader pages do not surface local file diagnostics");
  assert.doesNotMatch(html, /data-count=|data-ledger=/, "the published page has no person-level tally");
});

test("the public work section refuses private, unlisted, excluded, denied, and example input", () => {
  const mixed = leafFrom({
    id: "reader-admission",
    subject: "Reader Input",
    leaflets: [
      { id: "allowed", title: "Admitted work", tier: "pending", visibility: "public" },
      { id: "private", title: "Private work", tier: "verified", visibility: "private", provenance: prov },
      { id: "link-only", title: "Unlisted work", tier: "verified", visibility: "unlisted", provenance: prov },
      { id: "excluded", title: "Other person's work", tier: "excluded", reason: "Different author" },
      { id: "denied", title: "Policy denied work", tier: "pending", visibility: "public", provenance: prov },
    ],
  });
  const denyGit: PublishPolicy = {
    rules: [{ id: "deny-git", effect: "deny", match: { kind: "evidence-source", source: "git" }, reason: "Not for this audience" }],
  };
  const html = renderLeafPageUnderPolicy(okLoad(mixed), denyGit);
  const work = html.slice(html.indexOf('data-region="work"'), html.indexOf('data-region="ledger"'));
  assert.match(work, /Admitted work/);
  for (const title of ["Private work", "Unlisted work", "Other person's work", "Policy denied work"]) {
    assert.ok(!work.includes(title), `${title} must not become shared work`);
  }
  const example = renderLeafPageUnderPolicy(okLoad(mixed, sourceAt("/x/example.json", { declaredExample: true })), denyGit);
  assert.doesNotMatch(example, /data-region="work"/, "example records cannot become reader work");
  assert.match(example, /data-fabricated="true"/, "the example warning remains visible");
});

test("an admitted all-pending page uses one compact attribution cue after the work", () => {
  const shared = leafFrom({
    id: "reader-pending",
    subject: "Reader Input",
    leaflets: [{ id: "pending", title: "Shared pending work", tier: "pending", visibility: "public", provenance: prov }],
  });
  const html = renderLeafPage(okLoad(shared));
  const workStart = html.indexOf('data-region="work"');
  const ledgerStart = html.indexOf('data-region="ledger"');
  assert.ok(workStart >= 0 && workStart < ledgerStart);
  assert.match(html.slice(workStart, ledgerStart), /Attributed, unverified/);
  assert.match(html.slice(ledgerStart), /data-leaf-plate="none-verified">Shared work · attribution unverified/);
  assert.doesNotMatch(html, /Nothing verified yet|Nothing is claimed on this page/);
  assert.doesNotMatch(html, /href="#leaf-group-pending"/, "deduplicated rows leave no dead public anchor");
});

test("EVERY excluded leaflet shows its reason as visible text", () => {
  const html = renderLeafPage(okLoad(populated));
  const visible = text(html);
  assert.ok(visible.includes("different author identity"));
  assert.ok(visible.includes("vendored third-party code"));
  // Not hidden in an attribute or a tooltip, where nobody reads it.
  assert.doesNotMatch(html, /title="different author identity"/);
});

test("a leaf whose leaflets are all unverified claims nothing, and says so", () => {
  const nothingVerified = leafFrom({
    id: "l",
    subject: "Render Input",
    leaflets: [{ id: "a", title: "waiting", tier: "pending" }],
  });
  const html = renderLeafPage(okLoad(nothingVerified));
  // Not the empty state — there IS a leaflet — but nothing is asserted outward. The assertion is
  // on the STATE (an honest empty plate, named) and on the sentence it must carry, not on the
  // markup that draws it: the plate is a design-system component and its shape is not this
  // module's contract.
  assert.doesNotMatch(html, /data-leaf-empty/);
  assert.match(html, /data-leaf-plate="none-verified"/, "an empty region must declare what is absent");
  assert.match(text(html), /nothing is claimed on this page/i);
  assert.match(text(html), /correct result, not a fault/i, "a zero is a result, never a failure");
  // This test is about the plate, not the count strip — the strip is private-audience only (see
  // the dedicated split test below), and the plate above stays on BOTH audiences by design.
});

/**
 * Strip the regions the renderer CARRIES rather than writes, so an invariant about Foliage's
 * own language is checked against Foliage's own language.
 *
 * This is not a loophole, it is the difference between two claims. "This product never computes
 * or displays a score" is the invariant. "The seven characters s-c-o-r-e never appear in the
 * response" is a proxy for it, and the proxy is wrong on real input: a leaflet title is a commit
 * subject copied verbatim, so a person who really did commit "add score normalizer" would fail
 * the proxy while the product remained perfectly honest. The only way to satisfy the proxy there
 * is to rewrite their commit subject — falsifying the evidence the page exists to carry, in
 * order to pass a test about not falsifying things.
 *
 * `data-verbatim` marks those regions in the markup (render.ts), so this strip is driven by a
 * declared contract rather than by a regex that guesses at the current tag shape.
 */
function chrome(html: string): string {
  return html.replace(/<([a-z0-9]+)[^>]*\sdata-verbatim="[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, "<>");
}

test("NO SCORE IN ANYTHING THIS PRODUCT WRITES, in any state", () => {
  const populatedHtml = renderLeafPage(okLoad(populated));
  const emptyHtml = renderLeafPage(okLoad(empty));
  const absentHtml = renderLeafPage({ ok: false, cause: "absent", detail: "d", path: "/p" });

  // The strings a reviewer greps for. Checked against the full authored markup, attributes
  // included — only verbatim evidence is out of scope, and it is out of scope by declaration.
  for (const [name, html] of [
    ["populated", populatedHtml],
    ["empty", emptyHtml],
    ["absent", absentHtml],
  ] as const) {
    for (const forbidden of ["%", "score", "rank", "/5", "out of", "rating", "percentile"]) {
      assert.ok(
        !chrome(html).toLowerCase().includes(forbidden),
        `${name} page contains "${forbidden}" outside a data-verbatim region — no rating-shaped ` +
          `language may reach the DOM except as the subject's own carried evidence`,
      );
    }
  }

  // No composite either: the only numbers this product writes are the three per-tier counts,
  // the byte size and timestamps. A title may contain any digits a person committed.
  const numbers = [...chrome(populatedHtml).matchAll(/>(\d+(?:\.\d+)?)</g)].map((m) => m[1]);
  assert.ok(
    numbers.every((n) => !n!.includes(".")),
    `a fractional number on the page would read like a rate: ${numbers.join(", ")}`,
  );
});

test("a score-shaped word in a REAL commit subject is carried, not censored and not leaked", () => {
  // The case the proxy above got wrong, pinned from both sides at once. This exact defence is
  // what lets the strip be trusted: if `data-verbatim` ever stopped covering titles, the second
  // assertion here goes red rather than the exemption silently widening to the whole page.
  //
  // THE `provenance` HERE IS NOT DECORATION AND WAS NOT ADDED TO MAKE ANYTHING PASS. This fixture
  // says "a REAL commit subject", and a real commit subject arrives through `commitsToLeaflets`,
  // which always attaches `{source: "git", ref: <sha>, …}` — the leaflet as written could not have
  // come out of intake. The verbatim claim is decided from provenance (`carriesVerbatimTitle` in
  // render.ts), so a leaflet with none is no longer attested as carrying the artifact's own words:
  // nothing on file says where those words came from. Removing this field must turn assertion 2
  // red. That is the sibling test below, and it is the point of the pair.
  const withScoreWord = leafFrom({
    id: "l",
    subject: "Render Input",
    leaflets: [
      {
        id: "a",
        title: "feat: add score normalizer and a 40% faster ranking pass",
        tier: "pending",
        provenance: prov,
      },
    ],
  });
  const html = renderLeafPage(okLoad(withScoreWord));

  // 1. The subject's real words reach the page unaltered. Rewriting them would be a fabrication.
  assert.ok(
    text(html).includes("feat: add score normalizer and a 40% faster ranking pass"),
    "a real commit subject must be rendered exactly as written",
  );
  // 2. And they are inside a region declared verbatim, so the exemption is narrow and legible.
  assert.match(
    html,
    /<h3[^>]*\sdata-verbatim="title"[^>]*>feat: add score normalizer/,
    "carried evidence must be marked as carried, or the no-score check cannot be scoped",
  );
  // 3. The chrome around it is still clean — the exemption did not spread.
  for (const forbidden of ["score", "rank", "%"]) {
    assert.ok(
      !chrome(html).toLowerCase().includes(forbidden),
      `"${forbidden}" escaped the verbatim region into authored chrome`,
    );
  }
});

test("A DRAFTED TITLE IS NOT CARRIED EVIDENCE, and the no-score gate can see it", () => {
  // THE OTHER HALF OF THE PAIR ABOVE, and the defect it pins was measured on the running product,
  // not imagined: this repository's own leaf currently holds a leaflet titled "canopy: 4 commits"
  // whose provenance source is "photosynthesis:git-cluster". Those are Foliage's words about a
  // cluster — the extractor counted them — and they were being rendered inside
  // `data-verbatim="title"`, which asserts the opposite.
  //
  // The consequence was not merely a wrong label. `chrome()` strips every `data-verbatim` region
  // before the NO SCORE check, so the attribute was ALSO a gate exemption, and a drafter emitting
  // "top 10% of commits" as a title walked through it. Both halves are asserted here: the weaker
  // marker, and the gate actually seeing the text.
  const promoted = leafFrom({
    id: "l",
    subject: "Render Input",
    leaflets: [
      {
        id: "a",
        title: "top 10% of commits, score 4.5/5",
        tier: "pending",
        provenance: {
          source: "photosynthesis:git-cluster",
          ref: "aaa1111",
          observedAt: "2026-08-13T00:00:00Z",
        },
      },
    ],
  });
  const html = renderLeafPage(okLoad(promoted));

  // 1. It is still rendered — this is not censorship, and hiding it would hide the problem too.
  assert.ok(text(html).includes("top 10% of commits, score 4.5/5"));
  // 2. But it is NOT attested as the artifact's own words.
  assert.doesNotMatch(
    html,
    /<h3[^>]*\sdata-verbatim="title"[^>]*>top 10%/,
    "a title a drafter wrote must not be marked as copied out of the artifact",
  );
  assert.match(
    html,
    /<h3[^>]*\sdata-authored="drafted-title"[^>]*>top 10%/,
    "and the weaker claim has to be made explicitly, or the region is unmarked",
  );
  // 3. THE GATE NOW SEES IT. This is the assertion that would have caught the defect: before the
  //    fix, every one of these was absent from `chrome()` because the whole region was stripped.
  for (const forbidden of ["score", "%", "/5"]) {
    assert.ok(
      chrome(html).toLowerCase().includes(forbidden),
      `"${forbidden}" in a drafted title must reach the NO SCORE check, not be exempted from it`,
    );
  }
});

test("A TITLE WITH NO PROVENANCE MAKES THE WEAKER CLAIM — unknown origin is not verbatim", () => {
  // The third case, and the one that has no rationale anywhere to fall back on. `provenance` is
  // the document's record of where an artifact came from; without it nothing on file says whose
  // words these are, so attesting them as the artifact's own is a claim the document cannot
  // support. The page already says this in prose for such a leaflet ("No provenance recorded yet,
  // so nothing is asserted about this") — the markup now agrees with the prose.
  const unsourced = leafFrom({
    id: "l",
    subject: "Render Input",
    leaflets: [{ id: "a", title: "a title from nowhere in particular", tier: "pending" }],
  });
  const html = renderLeafPage(okLoad(unsourced));

  assert.match(html, /<h3[^>]*\sdata-authored="drafted-title"[^>]*>a title from nowhere/);
  assert.doesNotMatch(html, /<h3[^>]*\sdata-verbatim="title"[^>]*>a title from nowhere/);
});

test("EVERY TIER ON THE PAGE IS EXPLAINED — a count nobody can interpret is not honest", () => {
  // The hole this closes: three counts and a coloured pill, with nothing anywhere saying what
  // any of them mean. A reader then supplies a meaning, and the one they reach for is a ranking.
  const html = renderLeafPage(okLoad(populated));
  const visible = text(html);

  for (const tier of ["verified", "pending", "excluded"] as const) {
    assert.match(
      html,
      new RegExp(`data-legend-tier="${tier}"`),
      `${tier} appears as a count and a pill but is never defined`,
    );
  }
  // The legend defines the tiers in the SAME order as the cells — one ordering decision, made
  // once, in PROOF_TIERS. A legend that disagreed with the cells above it would be its own bug.
  const legendOrder = [...html.matchAll(/data-legend-tier="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(legendOrder, ["verified", "pending", "excluded"]);

  // The two specific misreadings the legend exists to prevent, asserted on VISIBLE text so this
  // fails if the copy is ever moved into a tooltip or a title attribute where nobody reads it.
  assert.match(visible, /not a queue/i, "pending must not read as work in progress");
  assert.match(
    visible,
    /self-declared/i,
    "the page must say why a matching identity alone is not authorship",
  );
});

test("the legend's terms are the SAME badge the rows carry, byte for byte", () => {
  // MIGRATED FROM A CLASS PIN. It used to assert `<span class="leaf-pill" data-pill-tier="X">`,
  // which passes for two INDEPENDENT components that happen to share a class and fails the moment
  // the badge is renamed — the exact shape that punishes a redesign. The invariant it was reaching
  // for is stronger and is now asserted directly: the legend and the rows render the identical
  // string. Reusing the component is what makes the glyph->meaning mapping something a reader does
  // by LOOKING; a bespoke swatch in the legend would be a second definition of the tier and the
  // two would drift.
  const html = renderLeafPage(okLoad(listedPopulated));
  const legendStart = html.indexOf('data-legend="tiers"');
  const legendEnd = html.indexOf("</dl>", legendStart);
  assert.ok(legendStart > -1 && legendEnd > legendStart, "the page must render a tier legend");
  const legend = html.slice(legendStart, legendEnd);
  const elsewhere = html.slice(0, legendStart) + html.slice(legendEnd);

  const badges = (region: string, tier: string): readonly string[] =>
    [
      ...region.matchAll(
        new RegExp(`<span class="proof[^"]*" data-pill-tier="${tier}">[\\s\\S]*?</span>`, "g"),
      ),
    ].map((m) => m[0]);

  for (const tier of PROOF_TIERS) {
    const inLegend = badges(legend, tier);
    const inRows = badges(elsewhere, tier);
    assert.equal(inLegend.length, 1, `the legend must define ${tier} exactly once`);
    assert.ok(inRows.length > 0, `the fixture must render at least one ${tier} row to compare with`);
    for (const rowBadge of inRows) {
      assert.equal(
        rowBadge,
        inLegend[0],
        `the ${tier} badge in the legend and on a row are DIFFERENT markup, so they can drift`,
      );
    }
  }

  // And the legend is in the domain's own order, which is a grouping and not a ranking.
  assert.deepEqual(
    [...legend.matchAll(/data-legend-tier="([a-z]+)"/g)].map((m) => m[1]),
    [...PROOF_TIERS],
  );
});

test("EVERY proof badge carries both spellings of its tier, and they agree", () => {
  // The badge is the design system's `.proof`, which supports two spellings: the Open Design class
  // (`proof-verified`) and this repo's attribute (`data-pill-tier`). Both are emitted, and this is
  // why: a CLASS can be half-applied. A `.proof` that lost its modifier renders a silently
  // untinted badge that still reads as a badge — no error, no warning, wrong meaning. An attribute
  // cannot be half-applied, so it is the one the assertions key on, and this test is what stops
  // the two from ever disagreeing.
  //
  // `data-pill-tier` and NOT `data-tier`: the row IS of a tier, the badge DEPICTS one. See the
  // header of render.ts for the measurement that split them (755 matches for 377 excluded rows).
  const pages = [
    renderLeafPage(okLoad(populated)),
    renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource),
  ];
  let seen = 0;
  for (const html of pages) {
    for (const m of html.matchAll(/<span class="(proof[^"]*)" data-pill-tier="([a-z]+)"/g)) {
      seen++;
      const classes = m[1]!.split(/\s+/);
      const tier = m[2]!;
      assert.ok(PROOF_TIERS.includes(tier as never), `"${tier}" is not one of the three tiers`);
      assert.ok(classes.includes("proof"), "the badge must carry the system component class");
      assert.ok(
        classes.includes(`proof-${tier}`),
        `a .proof with data-pill-tier="${tier}" but no proof-${tier} class renders untinted`,
      );
    }
    // No badge anywhere may claim a FOURTH tier by any spelling.
    assert.doesNotMatch(html, /proof-unattributed|data-pill-tier="unattributed"/i);
  }
  assert.ok(seen >= 4, `sanity: expected badges on both pages, saw ${seen}`);
});

test("`[data-tier=X]` COUNTS LEAFLETS OF TIER X — and counts nothing else, at any count", () => {
  // THE DEFECT THIS PINS, measured in the running page before it was fixed. The row, its pill and
  // the LEGEND's pill all carried `data-tier`, so the plainest selector a reader can write counted
  // three different kinds of thing:
  //
  //   real 18-commit document,  0 excluded on screen  ->  [data-tier="excluded"] returned 1
  //   real multi-author doc,  377 excluded on screen  ->  [data-tier="excluded"] returned 755
  //
  // The 1 is the worse of the two: it reports an exclusion on a page that displays none, which is
  // this project's recurring failure — a number that does not count what it says it counts.
  //
  // No existing test failed, because every one of them matched the compound string
  // `class="leaf-leaflet" data-tier="..."` instead. A workaround that universal is not a style
  // choice, it is undocumented knowledge that the obvious selector lies. So this test asserts the
  // BARE attribute, deliberately: it is the thing that was wrong, and the thing a verifier reaches
  // for first.
  const bare = (html: string, tier: string) =>
    [...html.matchAll(new RegExp(`data-tier="${tier}"`, "g"))].length;

  const ledger = attributionLedger(listedPopulated);
  const html = renderLeafPage(okLoad(listedPopulated));

  for (const [tier, n] of [
    ["verified", ledger.verified],
    ["pending", ledger.pending],
    ["excluded", ledger.excluded],
  ] as const) {
    assert.equal(bare(html, tier), n, `[data-tier="${tier}"] must count exactly the ${tier} leaflets`);
  }

  // ZERO IS THE CASE THAT ACTUALLY BROKE, and it is the ordinary case: this repository's own real
  // history has 0 excluded, so the page a self-hoster sees first is exactly this one. The legend
  // still explains the tier — it just no longer claims to BE one.
  const nothingExcluded = leafFrom({
    id: "l",
    subject: "No Exclusions",
    leaflets: [{ id: "a", title: "attributable", tier: "pending", provenance: prov }],
  });
  const zeroHtml = renderLeafPage(okLoad(nothingExcluded));
  assert.equal(bare(zeroHtml, "excluded"), 0, "a page with no excluded leaflet must match none");
  assert.match(zeroHtml, /data-legend-tier="excluded"/, "while the legend still defines the tier");

  // And the invariant the equality exists to express: one visible reason per excluded leaflet.
  // `excluded` REQUIRES a reason in the type, so a row without one is the type's promise broken
  // on screen.
  assert.equal(
    bare(html, "excluded"),
    [...html.matchAll(/class="leaf-reason"/g)].length,
    "every excluded leaflet on the page shows its own reason, and nothing else claims to be one",
  );
});

test("the zero-verified note appears exactly when it is true, and not otherwise", () => {
  // Conditional copy is only honest if the condition is real. `verified === 0` is the state
  // essentially every real leaf starts in, and the state most likely to be misread as a fault.
  //
  // PINNED ON THE FACT, NOT ON THE SENTENCE. The note used to exist twice — once at the foot of
  // the tier legend and once as the `none-verified` plate — under conditions that can never
  // disagree (`publishableLeaflets` IS the verified set, and the plate renders on any non-empty
  // leaf). The density pass kept the plate, which is where a reader is already looking, and the
  // legend's copy went with the legend behind disclosure. So this asserts the CLAIM survives
  // ("0 verified is a correct result, not a fault") rather than the legend's exact wording of
  // it — which is the assertion it always meant. It must stay VISIBLE: a statement a reader
  // takes for a malfunction may not go behind a closed drawer.
  const noneVerified = leafFrom({
    id: "l",
    subject: "Unsigned Work",
    leaflets: [{ id: "a", title: "unsigned", tier: "pending", provenance: prov }],
  });
  const unsigned = renderLeafPage(okLoad(noneVerified));
  assert.match(text(unsigned), /correct result, not a fault/i);
  assert.match(unsigned, /data-leaf-plate="none-verified"/);
  // And not inside a disclosure — `<details>` is closed by default, so this would be deletion.
  assert.ok(
    !unsigned.slice(unsigned.indexOf("<details")).includes("correct result, not a fault"),
    "the zero-verified note must be on the surface, never behind a drawer",
  );

  // `populated` has two verified leaflets, so the note would be false there.
  assert.doesNotMatch(text(renderLeafPage(okLoad(populated))), /correct result, not a fault/i);

  // AN EMPTY LEAF IS NOT UNSIGNED WORK — it is no work. Caught in the running page: the note
  // fired here too, so the page read "This leaf has no leaflets yet" and then explained the
  // signing state of work that does not exist. The tiers are still defined (a reader may want
  // to know what the three zeros mean); only the remark about unsigned work is withheld.
  const emptyHtml = renderLeafPage(okLoad(empty));
  assert.doesNotMatch(text(emptyHtml), /correct result, not a fault/i);
  assert.match(emptyHtml, /data-legend-tier="verified"/, "the legend itself still explains the zeros");
});

test("the published face never calls pending work unsigned", () => {
  // Pending also holds signatures git accepted from an undeclared signer, and signatures this
  // machine could not check. "Not signed" or "Unsigned work" is false for those.
  const html = text(renderLeafPage(okLoad(leafFrom({
    id: "l",
    subject: "Pending Person",
    leaflets: [{ id: "a", title: "work", tier: "pending", provenance: prov }],
  }))));
  assert.doesNotMatch(html, /not signed|unsigned/i);
  assert.match(html, /not cryptographically established/i);
});

test("the tiers are rendered in PROOF_TIERS order as a grouping, never as a ladder", () => {
  // `data-ledger` lives on the count strip's own cells, which is private-audience only.
  const html = renderLeafPage(okLoad(populated), "private");
  const order = [...html.matchAll(/data-ledger="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["verified", "pending", "excluded"]);
  // Nothing in the markup implies one tier outranks another.
  assert.doesNotMatch(html, /higher|better|lower|worse/i);
});

test("THE COUNT STRIP IS THE SUBJECT'S OWN ACCOUNTING — private only, never on the published face", () => {
  // verified/pending/excluded/total for ONE PERSON, summed, is precisely what
  // publicProjection.ts:128-133 refuses in its own words: "Per artifact the tier is a fact the
  // reader needs. Per person, summed, it is a score." A stranger holding the published face may
  // never see the four numbers that add rows into a figure about the person.
  const priv = renderLeafPage(okLoad(populated), "private");
  const pub = renderLeafPage(okLoad(populated)); // default audience is "published"
  assert.match(priv, /data-count="verified">/, "the owner's own view keeps the strip");
  assert.doesNotMatch(pub, /data-count=/, "the published face carries no per-tier tally at all");
  assert.doesNotMatch(pub, /data-ledger=/, "nor the strip's own cell links");
  assert.doesNotMatch(pub, /class="leaf-counts"/, "nor the strip's container");
  const publicFrondLabel = pub.match(/class="leaf-frond"[^>]*aria-label="([^"]+)"/)?.[1];
  assert.ok(publicFrondLabel, "published work retains an accessible description");
  assert.doesNotMatch(publicFrondLabel, /\d/, "the frond must not reintroduce the removed aggregate tally");
  // The private centerpiece is now the navigable portfolio. Its accounting remains in an
  // explicitly named disclosure, so pin the actual counts there rather than the retired
  // decorative frond's accessible label.
  const accountingStart = priv.indexOf('id="portfolio-accounting"');
  assert.ok(accountingStart !== -1, "private accounting remains available");
  const accounting = priv.slice(accountingStart);
  assert.match(accounting, /<summary>Attribution<\/summary>/);
  const ledger = attributionLedger(populated);
  assert.deepEqual(
    [...accounting.matchAll(/data-count="([a-z]+)">(\d+)</g)].map(match => [match[1], Number(match[2])]),
    [...PROOF_TIERS.map(tier => [tier, ledger[tier]]), ["total", populated.leaflets.length]],
    "the owner's disclosure retains exact per-tier and total accounting",
  );
  for (const record of populated.leaflets) {
    if (record.tier === "excluded") assert.ok(accounting.includes(esc(record.reason)), "excluded counts remain explainable");
  }

  // What stays on BOTH: the tier printed beside each ROW (a fact about the artifact, not a tally
  // of the person), and the none-verified plate (it carries no per-tier NUMBER either).
  assert.match(pub, /data-pill-tier="verified"/, "the row-level tier badge is not the score");
  const nothingVerified = leafFrom({
    id: "l",
    subject: "S",
    leaflets: [{ id: "a", title: "t", tier: "pending", provenance: prov }],
  });
  for (const audience of ["private", "published"] as const) {
    assert.match(
      renderLeafPage(okLoad(nothingVerified), audience),
      /data-leaf-plate="none-verified"/,
      `${audience}: the not-verified plate must stay — it carries no per-tier number`,
    );
  }
});

test("THE PUBLISHED FACE CLAIMS NO COUNTS — the count strip is private-only, and no prose may say otherwise", () => {
  // The published face carries no count strip and, since export projects out every excluded
  // leaflet before the renderer sees them (`isSubjectsOwnWork`), no excluded row either. The
  // rationale drawer (`data-more="reading"`) that once explained counting on both faces was cut
  // (owner, 2026-09-27: no explanations); what must still hold is that nothing on the published
  // face asserts counts it does not render, or hints at how much was withheld.
  const priv = renderLeafPage(okLoad(populated), "private");
  const pub = renderLeafPage(okLoad(populated)); // default audience is "published"

  for (const html of [priv, pub]) {
    assert.doesNotMatch(html, /data-more="reading"/, "the rationale drawer is gone from both faces");
  }
  assert.doesNotMatch(text(pub), /Counts are per tier/, "published: no count strip exists here");
  assert.doesNotMatch(text(pub), /counted and listed here/, "published: nothing here is counted");
  assert.doesNotMatch(
    text(pub),
    /\d+\s*(?:leaflets?|items?|pieces?)\s*(?:withheld|excluded|not shown|left out)/i,
    "published: no count of withheld work may appear anywhere",
  );

  // AND THE SAME WITH NOTHING VERIFIED, the state this product is normally in.
  const zeroVerified = leafFrom({
    id: "l",
    subject: "Unsigned Work",
    leaflets: [{ id: "a", title: "unsigned", tier: "pending", provenance: prov }],
  });
  const pubZero = renderLeafPage(okLoad(zeroVerified));
  assert.doesNotMatch(text(pubZero), /counted and listed here/);
  assert.doesNotMatch(text(pubZero), /Counts are per tier/);
  assert.doesNotMatch(
    text(pubZero),
    /\d+\s*(?:leaflets?|items?|pieces?)\s*(?:withheld|excluded|not shown|left out)/i,
  );
});

test("A FABRICATED DOCUMENT CARRIES A BAND, and reports every signal that fired", () => {
  const both = renderLeafPage(
    okLoad(populated, sourceAt("/x/leaf.example.json", { declaredExample: true, bundledExample: true })),
  );
  assert.match(both, /data-fabricated="true"/);
  assert.match(text(both), /not real evidence/i);
  assert.ok(text(both).includes('declares "example": true'));
  assert.ok(text(both).includes("bundled with this app"));

  // One signal alone is still enough — either can be lost independently.
  const declaredOnly = renderLeafPage(
    okLoad(populated, sourceAt("/x/leaf.json", { declaredExample: true })),
  );
  assert.match(declaredOnly, /data-fabricated="true"/);

  // And an ordinary document carries no band, so the band never becomes wallpaper.
  assert.doesNotMatch(renderLeafPage(okLoad(populated)), /data-fabricated/);
});

test("every value from the document is escaped", () => {
  const nasty = leafFrom({
    id: "l",
    subject: '</title><script>alert("subject")</script>',
    leaflets: [
      {
        id: "a",
        title: '<img src=x onerror="alert(1)">',
        tier: "excluded",
        reason: "<b>reason</b> & \"quoted\"",
      },
    ],
  });
  const html = renderLeafPage(okLoad(nasty, sourceAt('/tmp/"><script>.json')));

  // The test is whether a payload can become MARKUP, not whether its characters appear: an
  // escaped `&lt;img ... onerror=&quot;...&quot;&gt;` is inert text and is fine to display.
  assert.ok(!html.includes("<script>"), "no injected element may survive");
  assert.ok(!html.includes("<img src=x"), "and no injected attribute-bearing tag either");
  assert.ok(html.includes("&lt;script&gt;"), "it survives as escaped text");
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("&amp;"));

  // The path lands in an attribute as well as a text node, so a quote must not close it.
  assert.ok(!html.includes('"><script>.json'));
  // Every `<` in the document is the start of a tag we wrote, never one from the data.
  assert.equal(
    [...html.matchAll(/<(?![a-z!/])/gi)].length,
    0,
    "a `<` not opening a real tag means something escaped",
  );
});

test("esc handles the five characters that matter and nothing else", () => {
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(esc("plain text 123"), "plain text 123");
});

/**
 * THE BUG: raw absolute filesystem paths rendered as body copy on Overview, the promote
 * confirmation and /policy — a user-testing session flagged it. `pathChip` is the fix: a path
 * under the real home directory renders GARDEN-relative (`~/.foliage/leaf.json`), with the
 * untouched absolute path preserved in a `title` attribute rather than deleted — the same
 * relocate-don't-drop discipline `disclosure` already uses for rationale.
 */
test("pathChip collapses a path under the home directory to ~/..., keeping the full path in a title attribute", () => {
  const target = join(homedir(), ".foliage", "leaf.json");
  const html = pathChip(target);
  assert.match(html, /<span class="fol-metric" title="/, "the full path must survive in a title attribute");
  assert.ok(html.includes(esc(target)), "the title attribute must carry the UNTOUCHED absolute path");
  assert.ok(text(html).startsWith("~" + sep), "the visible text must be garden-relative");
  assert.equal(text(html), `~${sep}.foliage${sep}leaf.json`);
});

test("pathChip renders the home directory itself as bare ~", () => {
  assert.equal(text(pathChip(homedir())), "~");
});

test("pathChip leaves a path OUTSIDE the home directory unchanged — nothing invented for what isn't actually under it", () => {
  const outside = "/tmp/some-other-place/leaf.json";
  const html = pathChip(outside);
  assert.equal(text(html), outside, "a path outside the home directory must render verbatim");
  assert.doesNotMatch(html, /title=/, "there is nothing to shorten, so there is nothing to explain in a title");
});

test("describePolicySourceHtml renders the file case as a bare path chip, and the default case as a clause with no path", () => {
  const filePath = join(homedir(), ".foliage", "policy.json");
  const fileHtml = describePolicySourceHtml({ kind: "file", path: filePath });
  assert.equal(fileHtml, pathChip(filePath), "a real policy file is exactly pathChip(path)");

  const searched = join(homedir(), ".foliage", "policy.json");
  const defaultHtml = describePolicySourceHtml({ kind: "default", searched });
  assert.equal(defaultHtml, "the default rules", "the default case embeds after \"From\" (policyPage, overview), with no path in prose");
});

test("the owner's invalid state lists every issue while the public error reveals none", () => {
  const load: LeafLoad = {
    ok: false,
    cause: "invalid",
    detail: "2 problems (leaflets[0].reason, subject)",
    path: "/p/leaf.json",
    issues: [
      { at: "leaflets[0].reason", message: "an excluded leaflet requires a reason" },
      { at: "subject", message: "required" },
    ],
  };
  const html = renderLeafPage(load, "private");
  const visible = text(html);
  assert.ok(visible.includes("leaflets[0].reason"));
  assert.ok(visible.includes("subject"));
  assert.ok(visible.includes("an excluded leaflet requires a reason"));
  assert.doesNotMatch(renderLeafPage(load), /leaflets\[0\]\.reason|\/p\/leaf\.json/);
});

test("the owner's unreadable state gives its errno without exposing it publicly", () => {
  const load: LeafLoad = {
    ok: false,
    cause: "unreadable",
    detail: "could not be read: permission denied [EACCES]",
    path: "/p",
    errno: "EACCES",
  };
  const html = renderLeafPage(load, "private");
  assert.ok(text(html).includes("EACCES"));
  assert.doesNotMatch(renderLeafPage(load), /EACCES|permission denied/);
  // And it must not read as "missing" — that would send someone hunting for a file that exists.
  assert.doesNotMatch(text(html), /not found|does not exist/i);
});

test("the owner's malformed record names the repair, with the file and where the JSON breaks under Technical details", () => {
  const load: LeafLoad = {
    ok: false,
    cause: "malformed",
    detail: "/p/leaf.json is not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    path: "/p/leaf.json",
  };
  const html = renderLeafPage(load, "private");
  const technical = /<details class="review-technical">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  assert.match(text(html.replace(technical, "")), /Leaf document is not valid JSON Nothing counted Correct the file, then reload\./);
  assert.doesNotMatch(html.replace(technical, ""), /\/p\/leaf\.json|position 1/, "the sentence carries neither");
  assert.match(text(technical), /^Technical details Leaf file \/p\/leaf\.json Expected property name or '}' in JSON at position 1 \(line 1 column 2\)$/);
  assert.doesNotMatch(renderLeafPage(load), /\/p\/leaf\.json|Technical details/, "never on the published face");
});

test("every page is a complete document with the token stylesheet and a language", () => {
  for (const html of [
    renderLeafPage(okLoad(populated)),
    renderLeafPage({ ok: false, cause: "absent", detail: "d", path: "/p" }),
  ]) {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html lang="en" data-face="day">/);
    assert.match(html, /<link rel="stylesheet" href="\/tokens.css">/);
    assert.match(html, /<\/html>/);
  }
});

test("every metric is marked as a metric, so none can render in a proportional face", () => {
  // "A metric not set in mono tabular-nums is a defect" — the class is the only carrier of
  // that, so a count rendered without it is the defect regardless of how it looks.
  const html = renderLeafPage(okLoad(populated));
  for (const m of html.matchAll(/<span class="([^"]*)" data-count="[a-z]+">/g)) {
    assert.match(m[1]!, /\bfol-metric\b/, "a count must carry fol-metric");
  }
});

/* ================================================================================================
   ONE LEAFLET AS AN ARTIFACT — /leaflet/<id>

   The route exists so a leaflet can be handed to somebody. Everything below is about what must
   NOT travel with it, because that is the half a screenshot cannot show.
   ============================================================================================= */

/**
 * The DOCUMENT a leaflet page is rendered from — ordinary, declaring nothing about itself. Every
 * call below passes it explicitly rather than getting it from a defaulting helper: a default
 * parameter is precisely what let the real caller drop the source and serve an example document
 * with no fabrication band, and a test helper that quietly supplies one cannot see that class of
 * bug. The fabrication test further down passes its own.
 */
const ordinarySource = sourceAt("/tmp/leaf.json");

/**
 * A leaf built so that a leak has something to leak. Every other leaflet carries a title, an id
 * and (where the tier allows) a reason that appears nowhere else in the product, so a substring
 * search for it in the served page is unambiguous: if it is there, this page disclosed it.
 */
const compound = leafFrom({
  id: "compound-leaf",
  subject: "Compound Subject",
  leaflets: [
    {
      id: "shared-one",
      title: "the leaflet that gets shared",
      tier: "verified",
      provenance: prov,
      visibility: "unlisted",
    },
    {
      id: "secret-pending-id",
      title: "an unfinished thing nobody was shown",
      tier: "pending",
      visibility: "unlisted",
    },
    {
      id: "secret-excluded-id",
      title: "work that turned out to be somebody else's",
      tier: "excluded",
      reason: "the commits carry an author identity that was never declared",
      visibility: "unlisted",
    },
    {
      id: "secret-second-verified",
      title: "another claim entirely",
      tier: "verified",
      provenance: { source: "git", ref: "9999aaa", observedAt: "2026-08-14T00:00:00Z" },
    },
  ],
});

/** The three strings, per other leaflet, that would each be a disclosure on their own. */
const COMPOUND_SECRETS = [
  "secret-pending-id",
  "an unfinished thing nobody was shown",
  "secret-excluded-id",
  "work that turned out to be somebody else's",
  "the commits carry an author identity that was never declared",
  "secret-second-verified",
  "another claim entirely",
  "9999aaa",
] as const;

test("SHARING ONE LEAFLET DOES NOT SHARE THE COMPOUND — checked in the bytes", () => {
  const load = findLeaflet(compound, "shared-one");
  assert.equal(load.ok, true, "the fixture's own id must resolve, or nothing below is tested");
  const html = renderLeafletPage(load, ordinarySource);

  // The artifact itself is genuinely rendered, so the absences below are not vacuous.
  assert.ok(html.includes("the leaflet that gets shared"), "the requested leaflet must be there");
  assert.ok(html.includes(prov.ref), "with the evidence it rests on");

  // THE POINT. Searched in the whole response — markup, attributes and comments — because a leak
  // in an href or a data attribute is a leak.
  for (const secret of COMPOUND_SECRETS) {
    assert.ok(
      !html.includes(secret),
      `the leaflet page discloses "${secret}", which belongs to a DIFFERENT leaflet of the same ` +
        `leaf. Sharing one leaflet must not hand over the compound.`,
    );
  }

  // No count of any kind: a total is a fact about the compound even when no title is named.
  assert.ok(!html.includes("data-count="), "no ledger cell may appear on a shared artifact");
  assert.ok(!html.includes("data-ledger="), "nor a ledger link");
  assert.ok(!html.includes("leaf-cells"), "nor the cells' container");

  // And no navigation home. A link to `/` IS handing over the compound.
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(
    hrefs.filter((h) => h === "/" || h === REVIEW_ROUTE),
    [],
    `a shared leaflet must not link to the portfolio or to the operator's queue: ${hrefs.join(", ")}`,
  );
});

test("the artifact carries its tier, what the tier means, and what it may claim", () => {
  const verified = renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource);
  assert.match(verified, /data-pill-tier="verified"/);
  assert.match(text(verified), /outward claim · signed/i);

  // A pending leaflet is the subject's own accounting. Sharing one is allowed — the route serves
  // what it is asked for — but the page has to say what it is, or the act of sharing makes a
  // claim the domain refuses to make. `publishableLeaflets` is the domain saying exactly this.
  const pending = renderLeafletPage(findLeaflet(compound, "secret-pending-id"), ordinarySource);
  assert.match(text(pending), /not an outward claim/i);
  assert.match(text(pending), /own accounting/i);

  // An excluded one shows its required reason, on its own page as on the leaf.
  // An excluded one shows its required reason as VISIBLE TEXT — the assertion is that the reason
  // is readable, not that it is drawn by any particular element.
  const excluded = renderLeafletPage(findLeaflet(compound, "secret-excluded-id"), ordinarySource);
  assert.match(excluded, /data-pill-tier="excluded"/);
  assert.ok(text(excluded).includes("an author identity that was never declared"));
});

test("the leaflet band says shared rather than calling a loopback share published", () => {
  // `/leaflet/<id>` is the Leaf server's share route, and that server binds loopback: the leaflet
  // was shared, not published. The band keeps `data-audience="published"` — the reader the page is
  // written for — and says "shared", for Link only and Public alike: which kind of share it is, and
  // where it opens, are sharing mechanics the link holder does not get.
  const linkOnly = renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource);
  assert.match(linkOnly, /<span class="fol-label leaf-audience" data-audience="published">shared<\/span>/);
  const sharedOne = compound.leaflets.find((l) => l.id === "shared-one")!;
  const listed = renderLeafletPage({ ok: true, leaflet: { ...sharedOne, visibility: "public" }, subject: compound.subject }, ordinarySource);
  assert.match(listed, /data-audience="published">shared<\/span>/);
  // `secret-second-verified` has no visibility, so it is private: the route answers "Nothing
  // shared here", which carries no band at all.
  const unshared = renderLeafletPage(findLeaflet(compound, "secret-second-verified"), ordinarySource);
  assert.match(unshared, /Nothing shared here/);
  assert.doesNotMatch(unshared, /data-audience=/, "an unshared leaflet gets the refusal page, which has no band");
  for (const html of [linkOnly, listed]) {
    assert.doesNotMatch(html, />published<\/span>/);
    assert.doesNotMatch(html, /this computer|Link only|data-shared-address/, "no sharing mechanics on the shared artifact");
  }
  // The static export names no place: where its files are hosted is the owner's choice.
  const exported = renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource, "published", { backHref: "../index.html", mediaHrefs: new Map() });
  assert.match(exported, /data-audience="published">published<\/span>/);
  assert.doesNotMatch(exported, /this computer/);
});

test("AN EXAMPLE DOCUMENT IS MARKED ON THE ARTIFACT PAGE, and the false claim is withdrawn", () => {
  // THE DEFECT THIS PINS, measured on the running server before the fix: one binary, one copied
  // example document with `"example": true` intact, one leaflet marked `unlisted`. GET / rendered
  // `data-fabricated` once; GET /leaflet/<id> rendered it ZERO times and told the reader "This is
  // an outward claim: authorship is cryptographically established" about an illustration whose
  // provenance ref is the literal string `example-ref-not-a-commit-0001`. The shipped example
  // read as safe only because its own title starts "EXAMPLE —", which is the document author's
  // wording. The `example` flag exists so the PRODUCT says it, about any document that declares
  // itself one, so a copy under a different title is the case that had no control at all.
  const example = sourceAt("/x/leaf.example.json", { declaredExample: true });
  const load = findLeaflet(compound, "shared-one");
  assert.equal(load.ok, true, "the fixture's own id must resolve, or nothing below is tested");
  const html = renderLeafletPage(load, example);

  assert.match(html, /data-fabricated="true"/, "the artifact page must carry the band");
  assert.ok(text(html).includes('declares "example": true'), "and name the signal that fired");

  // The band alone is not enough. "Authorship is cryptographically established" is the more
  // SPECIFIC of the two statements and a reader takes it over a general disclaimer, so it is
  // withdrawn rather than merely qualified — while the tier itself stays visible, because hiding
  // what the document says would be a second dishonesty rather than a correction of the first.
  assert.match(html, /data-standing="example"/);
  assert.doesNotMatch(text(html), /outward claim · signed/i);
  assert.match(text(html), /Nothing is claimed here about anyone/i);
  assert.match(html, /data-pill-tier="verified"/, "the tier still shows");

  // The ordinary document keeps the claim — so the assertion above is a real difference and not a
  // renderer that quietly stopped saying anything on every page.
  const ordinary = renderLeafletPage(load, ordinarySource);
  assert.match(ordinary, /data-standing="outward"/);
  assert.doesNotMatch(ordinary, /data-fabricated/);

  // THE BAND DID NOT WIDEN THE PAGE. It is a fact about the document and names no leaflet, so the
  // compound is as absent from the marked page as from the unmarked one.
  for (const secret of COMPOUND_SECRETS) {
    assert.ok(!html.includes(secret), `the marked artifact page discloses "${secret}"`);
  }

  // AND IT IS ON THE REFUSAL PAGE TOO, identically. Those two pages are compared byte for byte
  // with the id substituted out to prove a private leaflet and a missing one cannot be told
  // apart; a band on one of them would be exactly the oracle that comparison exists to refuse.
  const missing = renderLeafletPage(findLeaflet(compound, "no-such-thing"), example);
  const withheld = renderLeafletPage(findLeaflet(compound, "secret-second-verified"), example);
  assert.match(missing, /data-fabricated="true"/);
  assert.equal(
    missing.split("no-such-thing").join("ID"),
    withheld.split("secret-second-verified").join("ID"),
    "the band must not make the two refusals distinguishable",
  );
});

test("a leaflet with no provenance says so, rather than rendering an empty field", () => {
  const html = renderLeafletPage(findLeaflet(compound, "secret-pending-id"), ordinarySource);
  assert.match(text(html), /No provenance/i);
  assert.ok(!html.includes('<dl class="leaf-prov">'), "an empty provenance table would be a lie");
});

test("A NONEXISTENT ID IS AN HONEST 404 — and it names no other id", () => {
  const load = findLeaflet(compound, "no-such-thing");
  assert.equal(load.ok, false);
  const html = renderLeafletPage(load, ordinarySource);

  assert.match(html, /data-leaf-state="not-shareable"/);
  assert.ok(html.includes("no-such-thing"), "the id that was asked for must be named");
  assert.match(text(html), /Nothing shared here/i);

  // NOT AN EMPTY PAGE, and not a helpful one either: near misses here would turn one leaflet's
  // address into a way to enumerate somebody's portfolio, one 404 at a time.
  for (const secret of COMPOUND_SECRETS) {
    assert.ok(!html.includes(secret), `the 404 page names "${secret}" — that is an enumeration oracle`);
  }
  assert.ok(!html.includes("shared-one"), "nor the id that does exist");
  assert.ok(!html.includes("Compound Subject"), "nor whose leaf was searched");

  // The page is distinguishable from every other state this app renders.
  assert.notEqual(html, renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource));
});

test("the href a row renders is the route the server matches — one definition", () => {
  const priv = renderLeafPage(okLoad(compound), "private");
  const source = renderLeafPage(okLoad(compound), "private", { records: "source" });
  const hrefs = [...(priv + source).matchAll(/<p class="leaf-leaflet-open"[^>]*><a href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  // THE OWNER'S INSTRUMENT LINKS EVERY ROW (owner rule 2026-08-23): on the private audience the
  // reader IS the subject, so every leaflet opens — and each link is built from the one route
  // definition the server matches. The share-by-link protections live on the ROUTE for the
  // published audience, not on the owner's own page.
  assert.equal(new Set(hrefs).size, compound.leaflets.length, "every leaflet links through Work or source records");
  for (const l of compound.leaflets) {
    assert.ok(hrefs.includes(ownerLeafletHref(l.id)), `route-built href present for ${l.id}`);
  }
  // And the published rendering offers no mechanism at all — zero links, zero notes.
  const pub = renderLeafPage(okLoad(compound));
  assert.equal([...pub.matchAll(/leaf-leaflet-open/g)].length, 0, "published carries no open chrome");
});

/* ================================================================================================
   F-029 — the reading drawer speaks to whoever holds the page. Measured on the 2026-09-01 real
   export: the published face instructed the READER to edit leaf.json ("visibility": "unlisted"),
   and an all-pending page pointed at a Selected work section that never rendered.
   ============================================================================================= */

const allPending = leafFrom({
  id: "leaf-under-test",
  subject: "Reading Drawer",
  leaflets: [
    { id: "p1", title: "intake: first pending", tier: "pending", provenance: prov },
    { id: "p2", title: "intake: second pending", tier: "pending", provenance: prov },
  ],
});

test("F-029: the published face gives no owner instruction — the reader cannot edit leaf.json", () => {
  const html = renderLeafPage(okLoad(allPending));
  assert.ok(
    !html.includes('"visibility": "unlisted"'),
    "the unlisted instruction is the owner's, and this page says anyone may read it",
  );
  assert.ok(!html.includes("your publish policy"), "no second-person owner voice on the published face");
  // The owner's face no longer carries the how-to either (owner, 2026-09-27: no explanations);
  // raw Git observations are now kept in the separate Source records view.
  const priv = renderLeafPage(okLoad(allPending), "private");
  assert.ok(!priv.includes('"visibility": "unlisted"'), "no how-to prose on the private face");
  assert.match(priv, /No selected work yet/, "source-only work must not masquerade as selected work");
  const source = renderLeafPage(okLoad(allPending), "private", { records: "source" });
  assert.match(source, /data-visibility="private"/, "the source archive still shows the visibility state");
});

test("F-029: no face names Selected work when the section did not render", () => {
  for (const audience of ["published", "private"] as const) {
    const html = renderLeafPage(okLoad(allPending), audience);
    assert.ok(
      !html.includes("appear under Selected work"),
      `${audience}: the drawer points at a section this page does not have`,
    );
    assert.ok(
      html.includes("own accounting"),
      `${audience}: what pending rows are NOT claiming must still be stated`,
    );
  }
});

test("F-029: a firing deny rule never reaches the published face — id, reason, and the withheld paragraph stay private", () => {
  // Round-2 correctness found this guard unguarded: every policy in this file is NO_RULES and
  // policySeam only drives the server's private route, so stripping the audience check from the
  // firedRules block left 76/76 green while the rule author's freeform reason leaked to the
  // published page. This is the reviewer's standalone driver, made permanent.
  const denyGit: PublishPolicy = {
    rules: [
      {
        id: "deny-git-under-test",
        effect: "deny",
        match: { kind: "evidence-source", source: "git" },
        reason: "the author's own words, which must never reach a stranger",
      },
    ],
  };
  const pub = renderLeafPageUnderPolicy(okLoad(allPending), denyGit);
  assert.ok(!pub.includes("even though you shared it"), "the withheld paragraph is owner voice");
  assert.ok(!pub.includes("deny-git-under-test"), "the rule id is the owner's handle, not the reader's");
  assert.ok(
    !pub.includes("which must never reach a stranger"),
    "the rule author's freeform reason must not leak to the published face",
  );
  // Control — the owner's instrument keeps all three, in the same shape policySeam pins live.
  // Nothing in `allPending` is shared, so the explanation says what the rule will do, not what
  // it did: "even though you shared it" would be false with zero shared.
  const priv = renderLeafPageUnderPolicy(okLoad(allPending), denyGit, "private");
  assert.ok(priv.includes("Stays private even if you share it."), "the private face keeps the explanation");
  assert.ok(!priv.includes("even though you shared it"), "nothing was shared, so nothing was refused after sharing");
  assert.ok(priv.includes("deny-git-under-test"), "and names the rule");
  assert.ok(priv.includes("which must never reach a stranger"), "and quotes its reason");
  const oneShared = leafFrom({
    id: "leaf-under-test",
    subject: "Reading Drawer",
    leaflets: [
      { id: "p1", title: "intake: first pending", tier: "pending", visibility: "unlisted", provenance: prov },
      { id: "p2", title: "intake: second pending", tier: "pending", provenance: prov },
    ],
  });
  // One of two withheld rows shared: the drawer says some were, never that every one was.
  const some = renderLeafPageUnderPolicy(okLoad(oneShared), denyGit, "private");
  assert.ok(some.includes("Withheld, including some you shared."), "a mix is named as a mix");
  assert.ok(!some.includes("even though you shared it"), "p2 was never shared, so not every row was refused after sharing");
  assert.ok(!some.includes("Stays private even if you share it."), "one sentence, the true one");
  const bothShared = leafFrom({
    id: "leaf-under-test",
    subject: "Reading Drawer",
    leaflets: [
      { id: "p1", title: "intake: first pending", tier: "pending", visibility: "unlisted", provenance: prov },
      { id: "p2", title: "intake: second pending", tier: "pending", visibility: "public", provenance: prov },
    ],
  });
  const all = renderLeafPageUnderPolicy(okLoad(bothShared), denyGit, "private");
  assert.ok(all.includes("Withheld even though you shared it."), "every withheld row was shared, so the rail refused a share");
  assert.ok(!all.includes("including some you shared"), "one sentence, the true one");
  assert.ok(!all.includes("Stays private even if you share it."), "one sentence, the true one");
});

test("F-029: a listed verified leaflet gives the reader a Shared work section", () => {
  const withVerified = leafFrom({
    id: "leaf-under-test",
    subject: "Reading Drawer",
    leaflets: [{ id: "v1", title: "feat: signed work", tier: "verified", visibility: "public", provenance: prov }],
  });
  const html = renderLeafPage(okLoad(withVerified));
  assert.match(html, /<h2 id="leaf-work-h">Shared work<\/h2>/, "the section rendered, so naming it is honest");
});

/* ================================================================================================
   THE BODY — rendered when present, degraded honestly when absent.

   `body` is optional on `Leaflet` and is being added by the lane that owns @foliage/leaf. These
   tests drive this renderer's reader directly, over values shaped the way the format specifies
   (docs/ENGINEERING-PLAN.md §2: a list of grounded elements, each carrying its own evidence ref).
   They prove THIS module's behaviour in all three cases; they do not prove the domain has landed
   the field, and the seam test says so where it counts.
   ============================================================================================= */

/** Attach a body to a real, gate-approved leaflet without editing the type this lane cannot edit. */
function withBody(leaflet: Leaflet, body: unknown): Leaflet {
  return { ...leaflet, body } as unknown as Leaflet;
}

const grounded = {
  text: "Reworked the retrieval layer so a page is selected without opening a file.",
  provenance: { source: "git", ref: "c0ffee1", observedAt: "2026-08-15T00:00:00Z" },
};

test("a leaflet WITH a body renders every element beside the evidence it rests on", () => {
  const base = compound.leaflets[0]!;
  const second = {
    text: "Second element, resting on a different commit entirely.",
    provenance: { source: "git", ref: "dec0de2", observedAt: "2026-08-16T00:00:00Z" },
  };
  const html = renderLeafletPage(
    {
      ok: true,
      leaflet: withBody(base, [grounded, second]),
      subject: "Compound Subject",
    },
    ordinarySource,
  );

  assert.match(html, /data-body="present"/);
  assert.ok(text(html).includes(grounded.text));
  assert.ok(text(html).includes(second.text));

  // ELEMENT-WISE GROUNDING, which is the whole reason the body is structured rather than prose:
  // every element carries its own ref, so "which part of this is sourced?" has a per-line answer.
  const elements = [...html.matchAll(/<li class="leaflet-element" data-element="stated">([\s\S]*?)<\/li>/g)];
  assert.equal(elements.length, 2, "both elements must render with their claim stated");
  for (const [, inner] of elements) {
    assert.match(inner!, /<dl class="leaf-prov">/, "an element without its evidence is unsourced prose");
  }
  assert.ok(html.includes("c0ffee1") && html.includes("dec0de2"), "both refs must reach the page");

  // The element's words are the subject's, not this renderer's — same declaration as a title, so
  // the NO SCORE check stays scoped to authored chrome instead of censoring somebody's evidence.
  assert.match(html, /data-verbatim="body-element"/);

  const shared = { ...compound, leaflets: [{ ...withBody(base, [grounded, second]), visibility: "public" as const }] };
  const index = renderLeafPage(okLoad(shared));
  const row = index.slice(index.indexOf('class="leaf-leaflet blade-row"'), index.indexOf('</li>', index.indexOf('class="leaf-leaflet blade-row"')));
  assert.ok(row.includes(`data-verbatim="body-element">${esc(grounded.text)}</p>`), "shared work leads with its recorded context");
  assert.ok(!row.includes(second.text), "the index previews one account and leaves the full body on the artifact page");
  assert.match(row, /<summary>Evidence <span class="fol-metric">3 references<\/span><\/summary>/);
  for (const ref of [prov.ref, grounded.provenance.ref, second.provenance.ref]) assert.ok(row.includes(ref), `the index keeps supporting reference ${ref}`);
});

test("the owner leaflet keeps the workspace shell and does not repeat a citation in a second provenance block", () => {
  const base = compound.leaflets[0]!;
  const owner = renderLeafletPage({ ok: true, leaflet: withBody(base, [{ text: "What changed", provenance: prov }]), subject: compound.subject }, ordinarySource, "private");
  assert.match(owner, /<body class="fol-app"/);
  assert.match(owner, /aria-current="page">Portfolio<\/a>/);
  assert.match(owner, /<a href="\/leaf">My portfolio<\/a>/);
  assert.match(owner, /What changed/);
  assert.doesNotMatch(owner, /id="leaflet-prov-h">Source evidence/, "a citation already beside the text has no duplicate block");
  assert.match(owner, /<span class="proof">Unlisted<\/span>/);
});

test("the owner leaflet retains a distinct observation of the same source reference", () => {
  const base = compound.leaflets[0]!;
  const laterObservation = { ...prov, observedAt: "2026-08-14T00:00:00Z" };
  const owner = renderLeafletPage({ ok: true, leaflet: withBody(base, [{ text: "What changed", provenance: laterObservation }]), subject: compound.subject }, ordinarySource, "private");
  assert.match(owner, /id="leaflet-prov-h">Source evidence/, "the leaflet-level observation remains visible");
  assert.match(owner, /<time datetime="2026-08-13T00:00:00Z">13 Aug 2026<\/time>/);
  assert.match(owner, /<time datetime="2026-08-14T00:00:00Z">14 Aug 2026<\/time>/);
});

test("an approved draft's one commit is one piece of evidence on the shared index and page, never the drafter's label", () => {
  // Parser input built by real promotion: one approved cluster over one commit. Promotion writes
  // the commit as the leaflet's provenance (photosynthesis:git-cluster) and as its body (git).
  const sha = "4621d812164e27b29d37d7e69334e6bf99d0d088";
  const harvest = parseHarvestDocument({ candidates: [{
    id: "git-cluster:Fix", title: "Fix: one trailing newline", extractor: "git-cluster", draftedAt: "2026-08-13T00:00:00Z",
    evidence: [{ source: "git", ref: sha, observedAt: "2026-08-13T00:00:00Z", excerpt: "Fix: one trailing newline" }],
    review: { state: "approved", by: "Render Input", at: "2026-08-13T00:00:00Z" },
  }] });
  assert.ok(harvest.ok);
  const promoted = promoteApproved(harvest.harvest, leafFrom({ id: "leaf-under-test", subject: "Render Input", leaflets: [] }));
  assert.ok(promoted.ok);
  const shared = leafFrom({ ...promoted.leaf, leaflets: promoted.leaf.leaflets.map((l) => ({ ...l, visibility: "public" })) });
  const index = renderLeafPage(okLoad(shared));
  assert.match(index, /<summary>Evidence <span class="fol-metric" title="4621d81[0-9a-f]{33}">4621d81<\/span><\/summary>/, "one commit reads as one reference");
  const page = renderLeafletPage(findLeaflet(shared, "git-cluster:Fix"), ordinarySource);
  const owner = renderLeafletPage(findLeaflet(shared, "git-cluster:Fix"), ordinarySource, "private");
  for (const html of [index, page, owner]) assert.doesNotMatch(html, /photosynthesis:git-cluster/, "the drafter's internal label is not shown");
  assert.doesNotMatch(page, /id="leaflet-prov-h"/, "the body already shows the commit; no second Provenance block");
  assert.equal((page.match(new RegExp(`<span title="${sha}">`, "g")) ?? []).length, 1, "the commit appears once on the page");
  assert.match(renderLeafPage(okLoad(shared), "private"), /Evidence <span class="fol-metric">1<\/span>/, "the owner's portfolio counts one too");
  // A drafter's handle shown on its own names what drafted it in words.
  const bare = leafFrom({ ...shared, leaflets: shared.leaflets.map(({ body: _body, ...l }) => l) });
  assert.match(renderLeafletPage(findLeaflet(bare, "git-cluster:Fix"), ordinarySource, "private"), /<dd>Drafted from Git<\/dd>/);
});

test("a reviewed source and long ref have readable labels with their exact evidence available", () => {
  const ref = "a".repeat(40);
  const leaflet = { ...compound.leaflets[0]!, provenance: { source: "photosynthesis:reviewer:Alex", ref, observedAt: "2026-08-13T00:00:00Z" } };
  const html = renderLeafletPage({ ok: true, leaflet, subject: compound.subject }, ordinarySource, "private");
  assert.match(html, /Reviewed by Alex/);
  assert.match(html, /<span title="a{40}">aaaaaaa<\/span>/);
  assert.match(html, /<summary>Full reference<\/summary><code class="fol-metric">a{40}<\/code>/);
  assert.match(html, /<time datetime="2026-08-13T00:00:00Z">13 Aug 2026<\/time>/);
});

test("a leaflet with no body leads with its evidence on both reader and owner views", () => {
  const load = findLeaflet(compound, "shared-one");
  const published = renderLeafletPage(load, ordinarySource);
  assert.doesNotMatch(published, /<section class="leaflet-body"/);
  assert.doesNotMatch(text(published), /No body/i);
  assert.match(published, /<section class="leaflet-prov-section" aria-labelledby="leaflet-prov-h">/);
  assert.ok(published.includes(prov.ref), "the provenance must remain inspectable");
  assert.ok(!published.includes("leaflet-element"), "there is no element to render");

  const privateHtml = renderLeafletPage(load, ordinarySource, "private");
  assert.doesNotMatch(privateHtml, /<section class="leaflet-body"|No body/i);
  assert.ok(privateHtml.includes(prov.ref), "the owner must still see the provenance");
});

test("AN ELEMENT THIS RENDERER CANNOT READ IS NAMED, never dropped and never shown as a claim", () => {
  // The failure mode this closes: a body arrives shaped differently from what this reader
  // expects, every element is skipped, and the page renders a SHORTER artifact that looks
  // complete. A named unreadable element is visibly wrong; a silently missing one is not.
  const base = compound.leaflets[0]!;
  const html = renderLeafletPage(
    {
      ok: true,
      leaflet: withBody(base, [
        grounded,
        { text: "prose with no evidence under it at all" },
        { provenance: { source: "git", ref: "", observedAt: "2026-08-16T00:00:00Z" } },
        "a bare string",
      ]),
      subject: "Compound Subject",
    },
    ordinarySource,
  );

  const unreadable = [...html.matchAll(/data-element="unreadable"/g)].length;
  assert.equal(unreadable, 3, "three of the four elements are unreadable and all three must show");
  assert.ok(html.includes("body[1].provenance"), "the index and field of each one is named");
  assert.ok(html.includes("body[2].provenance"));
  assert.ok(html.includes("body[3]"));

  // THE LOAD-BEARING HALF: an element whose evidence could not be read must not have its text
  // rendered as a statement. Ungrounded prose on a portfolio page is the exact thing the
  // structured body format exists to make unrepresentable.
  assert.ok(
    !text(html).includes("prose with no evidence under it at all"),
    "text with unreadable evidence was rendered as a claim",
  );

  // A body that is not a list at all is one unreadable element, not a crash and not silence.
  const notAList = renderLeafletPage(
    {
      ok: true,
      leaflet: withBody(base, { text: "not in a list" }),
      subject: "Compound Subject",
    },
    ordinarySource,
  );
  assert.match(notAList, /data-element="unreadable"/);
  assert.ok(notAList.includes("an object with keys text"));

  // AND THE ASYMMETRY THE FORMAT IS BUILT ON: a ref with NO words is not an error, it is an
  // honest evidence listing. It renders, it says no claim is stated, and this renderer writes no
  // sentence to fill the gap — inventing one would be the fabrication the format exists to
  // refuse. This is the shape `promoteApproved` actually emits today.
  const refOnly = renderLeafletPage(
    {
      ok: true,
      leaflet: withBody(base, [{ provenance: grounded.provenance }]),
      subject: "Compound Subject",
    },
    ordinarySource,
  );
  assert.match(refOnly, /data-element="ref-only"/);
  assert.ok(refOnly.includes("c0ffee1"), "the ref itself must still be shown");
  assert.match(text(refOnly), /No claims stated/);
  assert.ok(!refOnly.includes('data-verbatim="body-element"'), "there are no words to attribute");
  // The section says it once. Repeating it per element buried the refs it was describing —
  // measured on a real promoted leaflet with three ref-only elements.
  assert.equal([...refOnly.matchAll(/No claim is stated/g)].length, 0);

  // A MIXED body is the case where each silent element must speak for itself: without it, a
  // reader scanning the column reads the gap as the previous element's sentence continuing.
  const mixed = renderLeafletPage(
    {
      ok: true,
      leaflet: withBody(base, [grounded, { provenance: grounded.provenance }]),
      subject: "Compound Subject",
    },
    ordinarySource,
  );
  // PINNED ON THE FACT. The sentence used to be "No claim is stated about this element. The ref
  // below is what the artifact holds; a sentence here would be one nobody wrote." — a label's
  // worth of fact followed by its own rationale, printed once per silent element. The rationale
  // moved to the section's disclosure; the fact stayed exactly where it has to be, on the
  // element whose silence would otherwise read as the previous element's claim continuing.
  assert.equal([...mixed.matchAll(/No claim stated\./g)].length, 1);
  assert.ok(!text(mixed).includes("No claims stated"));
});

test("captured demos stay private until a selected static export addresses them", () => {
  const base = compound.leaflets[0]!;
  const ref = `sha256:${"a".repeat(64)}`;
  const stillRef = `sha256:${"b".repeat(64)}`;
  const clip = { text: "Protocol capture", provenance: { source: "protocol", ref, observedAt: "2026-10-07T00:00:00Z" },
    media: { mediaType: "video/mp4", dimensions: { known: true, width: 1280, height: 720 } } };
  const load = { ok: true as const, leaflet: withBody(base, [clip]), subject: "Protocol subject" };
  const owner = renderLeafletPage(load, ordinarySource, "private");
  assert.match(owner, /<video\b[^>]*controls playsinline/);
  assert.ok(owner.includes(`src="/my/media/${ref}"`));
  assert.ok(owner.includes(`<span title="${ref}">sha256:aaaaaaa…</span>`), "the visible media reference is compact");
  assert.ok(owner.includes(`<summary>Full reference</summary><code class="fol-metric">${ref}</code>`), "the exact digest stays inspectable");
  const localPublic = renderLeafletPage(load, ordinarySource);
  assert.doesNotMatch(localPublic, /<video\b|Protocol capture|video\/mp4/);
  assert.ok(!localPublic.includes(ref), "the unselected clip reference also stays private");
  const sameSource = renderLeafletPage({ ...load, leaflet: withBody({ ...base, provenance: clip.provenance }, [clip]) }, ordinarySource);
  assert.match(sameSource, /<h2 id="leaflet-prov-h">Provenance<\/h2>/, "the Leaflet's source remains visible when its sole body element is withheld");
  const exportHtml = renderLeafletPage(load, ordinarySource, "published", {
    backHref: "/", mediaHrefs: new Map([[ref, "/media/selected-clip.mp4"]]),
    posterHrefs: new Map([[ref, "/media/selected-still.png"]]),
  });
  assert.match(exportHtml, /<video\b[^>]*controls playsinline preload="none"[^>]*poster="\/media\/selected-still\.png"/);
  assert.match(exportHtml, /src="\/media\/selected-clip\.mp4"/);
  assert.ok(exportHtml.includes(ref), "the selected export retains its provenance");
  assert.doesNotMatch(text(exportHtml), /No claims stated/);
  const figure = exportHtml.indexOf('<figure class="leaflet-media leaflet-video"');
  const caption = exportHtml.indexOf('data-verbatim="body-element">Protocol capture');
  assert.ok(figure > -1 && caption > figure, "the demo leads before its approved words");
  assert.match(exportHtml, /<details class="leaflet-media-details"><summary>Evidence<\/summary>/);

  const still = { text: null, provenance: { source: "photo", ref: stillRef, observedAt: "2026-10-07T00:00:00Z" },
    media: { mediaType: "image/png", dimensions: { known: true, width: 1280, height: 720 } } };
  const mediaFirst = renderLeafletPage({ ...load, leaflet: withBody(base, [grounded, still, clip]) }, ordinarySource, "published", {
    backHref: "/", mediaHrefs: new Map([[ref, "/media/selected-clip.mp4"], [stillRef, "/media/selected-still.png"]]),
    posterHrefs: new Map([[ref, "/media/selected-still.png"]]),
  });
  assert.ok(mediaFirst.indexOf('src="/media/selected-still.png"') < mediaFirst.indexOf(grounded.text),
    "the actual artifact leads even when a written account comes first in the document");
  assert.doesNotMatch(mediaFirst, /class="leaflet-media-img"/, "the still is not a second full-size frame beside the demo that uses it as a poster");
  assert.match(mediaFirst, /Poster image[\s\S]*Open still<\/a>/, "the selected still stays inspectable with the video evidence");
  assert.ok(mediaFirst.includes(stillRef), "deduplicating the still must not erase its provenance");

  const imageOnly = renderLeafletPage({ ...load, leaflet: withBody(base, [still]) }, ordinarySource, "published", {
    backHref: "/", mediaHrefs: new Map([[stillRef, "/media/selected-still.png"]]),
  });
  assert.match(imageOnly, /class="leaflet-media-img"/, "an image-only publication keeps the image itself");
  const captionedStill = renderLeafletPage({ ...load, leaflet: withBody(base, [{ ...still, text: "Approved still caption" }, clip]) }, ordinarySource, "published", {
    backHref: "/", mediaHrefs: new Map([[ref, "/media/selected-clip.mp4"], [stillRef, "/media/selected-still.png"]]),
    posterHrefs: new Map([[ref, "/media/selected-still.png"]]),
  });
  assert.match(captionedStill, /class="leaflet-media-img"/, "approved words on a still keep its separate element");
  assert.match(captionedStill, /Approved still caption/);
});

/* ================================================================================================
   THE REVIEW QUEUE — /review
   ============================================================================================= */

/** Build a harvest through the REAL gate, so no test here can assert on a shape the product refuses. */
function harvestFrom(doc: unknown): HarvestDocument {
  const parsed = parseHarvestDocument(doc);
  assert.equal(
    parsed.ok,
    true,
    `test input must be a valid harvest: ${
      parsed.ok ? "" : parsed.issues.map((i) => `${i.at}: ${i.message}`).join("; ")
    }`,
  );
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

const queue = harvestFrom({
  candidates: [
    {
      id: "git-cluster:feat",
      title: "feat: 7 commits",
      evidence: [
        { source: "git", ref: "aaa1111", observedAt: "2026-08-16T09:00:00Z" },
        { source: "git", ref: "bbb2222", observedAt: "2026-08-16T09:00:00Z" },
      ],
      extractor: "git-cluster",
      draftedAt: "2026-08-16T09:00:00Z",
      review: { state: "candidate" },
    },
    {
      id: "local-model:brain",
      title: "A line a local model wrote about a body of work",
      evidence: [{ source: "brain", ref: "notes/vault.md", observedAt: "2026-08-16T09:00:00Z" }],
      extractor: "local-model:gemma4:12b",
      draftedAt: "2026-08-16T09:00:00Z",
      review: { state: "candidate" },
      shownPages: [
        {
          page: "/notes/people/a-colleague.md",
          kind: "third-party-shaped",
          charsShown: 400,
          charsInPage: 1200,
        },
        { page: "/notes/vault.md", kind: "unclassified", charsShown: 900, charsInPage: 900 },
      ],
    },
    {
      id: "git-cluster:chore",
      title: "chore: 2 commits",
      evidence: [{ source: "git", ref: "ccc3333", observedAt: "2026-08-16T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-16T09:00:00Z",
      review: {
        state: "rejected",
        by: "Alex",
        at: "2026-08-16T10:00:00Z",
        reason: "dependency bumps are not a body of work",
      },
    },
  ],
});

const okHarvest = (harvest: HarvestDocument, path = "/tmp/harvest.json"): HarvestLoad => ({
  ok: true,
  harvest,
  path,
});

const reviewImageHref = (candidate: string, ref: string): string =>
  `/review/candidate-image?candidate=${encodeURIComponent(candidate)}&amp;ref=${encodeURIComponent(ref)}`;

test("Review shows both captured media and uses the actual still as the demo poster", () => {
  const stillRef = `sha256:${"b".repeat(64)}`, clipRef = `sha256:${"c".repeat(64)}`;
  const observedAt = "2026-10-07T00:00:00Z";
  const dimensions = { known: true, width: 1280, height: 720 };
  const harvest = harvestFrom({ candidates: [{ id: "demo:renderer-contract", title: "Renderer contract input",
    extractor: "capture", draftedAt: observedAt, review: { state: "candidate" },
    evidence: [{ source: "photo", ref: stillRef, observedAt }, { source: "capture:video", ref: clipRef, observedAt }],
    media: [{ ref: stillRef, media: { mediaType: "image/png", dimensions } },
      { ref: clipRef, media: { mediaType: "video/mp4", dimensions } }],
  }] });
  const html = renderReviewPage(okHarvest(harvest));
  assert.ok(html.includes(`<img src="${reviewImageHref("demo:renderer-contract", stillRef)}"`));
  assert.ok(html.includes(`<video controls playsinline preload="metadata" poster="${reviewImageHref("demo:renderer-contract", stillRef)}"`));
  assert.match(html, new RegExp(`<source src="/review/media/${clipRef}" type="video/mp4">`));
  assert.ok(html.includes(`<span title="${stillRef}">sha256:bbbbbbb…</span>`), "the photo digest fits beside its preview");
  assert.ok(html.includes(`<span title="${clipRef}">sha256:ccccccc…</span>`), "the video digest fits beside its preview");
  assert.ok(html.includes(`<summary>Full reference</summary><code class="fol-metric">${clipRef}</code>`), "the whole digest remains available");
  assert.ok(html.includes(`<img src="${reviewImageHref("demo:renderer-contract", stillRef)}" alt="Evidence image" loading="eager"`), "the lead still loads for print and capture");
  assert.match(html, /aria-label="First captured media"/);
  assert.match(html, /aria-label="Remaining captured media"/);
  assert.doesNotMatch(html, /<video[^>]*autoplay/);
});

test("selected design images keep owner-labeled Figma and Dribbble references legible without claiming authentication", () => {
  const ref = `sha256:${"a".repeat(64)}`, at = "2026-10-07T00:00:00Z";
  const shot = `https://${["dribbble", "com"].join(".")}/shots/12345-interface`;
  const evidence = [
    { source: "owner-selected:figma-export", ref, observedAt: at },
    { source: "owner-reference:dribbble", ref: shot, observedAt: at },
  ];
  const harvest = harvestFrom({ candidates: [{ id: `selected-design:${ref}`, title: "Portfolio redesign · Interface composition",
    extractor: "owner-selected-design-image", draftedAt: at, review: { state: "candidate" }, evidence,
    media: [{ ref, media: { mediaType: "image/png", dimensions: { known: true, width: 1280, height: 720 } } }],
  }] });
  const review = renderReviewPage(okHarvest(harvest));
  assert.match(review, /Selected by you/);
  assert.match(review, /Figma export · labeled by owner/);
  assert.match(review, /Dribbble link · entered by owner/);
  assert.ok(review.includes(`<img src="${reviewImageHref(`selected-design:${ref}`, ref)}"`), "selected artwork is inspectable before approval");
  assert.doesNotMatch(review, /<dd>owner-selected:figma-export<\/dd>/);
  const base = compound.leaflets[0]!;
  const publicLeaflet = renderLeafletPage({ ok: true, leaflet: {
    ...base, provenance: evidence[0]!,
    body: [{ provenance: evidence[1]!, text: "Owner-entered reference" }],
  }, subject: compound.subject }, ordinarySource);
  assert.match(publicLeaflet, /Figma export · labeled by owner/);
  assert.match(publicLeaflet, /Dribbble link · entered by owner/);
});

test("Review puts a full image before its source and decision without losing the excerpt", () => {
  const heicRef = `sha256:${"d".repeat(64)}`, pngRef = `sha256:${"e".repeat(64)}`;
  const observedAt = "2026-10-07T00:00:00Z";
  const dimensions = { known: true, width: 1280, height: 720 };
  const excerpt = "A long retained source passage. ".repeat(30);
  const harvest = harvestFrom({ candidates: [{ id: "demo:review-order", title: "Review renderer contract",
    extractor: "capture", draftedAt: observedAt, review: { state: "candidate" },
    evidence: [{ source: "photo", ref: heicRef, observedAt }, { source: "photo", ref: pngRef, observedAt, excerpt }],
    media: [{ ref: heicRef, media: { mediaType: "image/heic", dimensions } },
      { ref: pngRef, media: { mediaType: "image/png", dimensions } }],
  }] });
  const html = renderReviewPage(okHarvest(harvest));
  const card = html.slice(html.indexOf('id="candidate-demo:review-order"'));
  const formAt = card.indexOf('<form class="review-form"');
  const imageAt = card.indexOf(`<img src="${reviewImageHref("demo:review-order", pngRef)}"`);
  const citedRefAt = card.indexOf(`<span title="${pngRef}">`);
  assert.ok(card.includes('data-review-media="image"'));
  assert.ok(imageAt >= 0 && imageAt < citedRefAt && citedRefAt < formAt, "the image, its cited source and the decision are in that order");
  const jump = /class="btn btn-ghost review-jump" href="#(by-demo%3Areview-order)"/.exec(card);
  assert.ok(jump && citedRefAt < card.indexOf(jump[0]) && card.indexOf(jump[0]) < formAt,
    "a phone reviewer can jump from the complete image and citation to the decision");
  assert.ok(card.includes(`id="by-demo:review-order"`), "the jump targets the existing Reviewer input");
  assert.ok(card.indexOf("<summary>Read excerpt</summary>") < formAt, "the long excerpt stays accessible but collapsed");
  assert.ok(card.indexOf(`<span title="${heicRef}">`) > formAt, "the undisplayable file stays with remaining evidence");
  assert.ok(card.includes(excerpt), "the full verbatim passage remains inspectable");
});

test("recorded demos keep their still, video and phone decision order", () => {
  const stillRef = `sha256:${"a".repeat(64)}`, videoRef = `sha256:${"b".repeat(64)}`;
  const observedAt = "2026-10-07T00:00:00Z";
  const dimensions = { known: true, width: 1200, height: 820 };
  const harvest = harvestFrom({ candidates: [{ id: "capture:demo", title: "Recorded app demo",
    extractor: "capture", draftedAt: observedAt, review: { state: "candidate" },
    evidence: [{ source: "capture", ref: stillRef, observedAt }, { source: "capture", ref: videoRef, observedAt }],
    media: [{ ref: stillRef, media: { mediaType: "image/png", dimensions } },
      { ref: videoRef, media: { mediaType: "video/mp4", dimensions } }],
  }] });
  const html = renderReviewPage(okHarvest(harvest));
  const card = html.slice(html.indexOf('id="candidate-capture:demo"'));
  const refAt = card.indexOf(`<span title="${stillRef}">`);
  const stillAt = card.indexOf(`<img src="${reviewImageHref("capture:demo", stillRef)}"`);
  const videoAt = card.indexOf(`<source src="/review/media/${videoRef}" type="video/mp4">`);
  const jumpAt = card.indexOf('class="btn btn-ghost review-jump"');
  const formAt = card.indexOf('<form class="review-form"');
  assert.doesNotMatch(card.split("<summary")[0]!, /data-review-media="image"/);
  assert.ok(refAt >= 0 && refAt < stillAt && stillAt < jumpAt && jumpAt < formAt && formAt < videoAt,
    "the demo keeps cited source, still, decision jump, form and remaining video in its established order");
});

test("the queue shows what a reviewer needs to decide: title, evidence, extractor, and the pack", () => {
  const html = renderReviewPage(okHarvest(queue));
  const visible = text(html);

  for (const c of queue.candidates) {
    assert.ok(visible.includes(c.title), `the drafted title must be shown: ${c.id}`);
    assert.ok(html.includes(c.id), `and its id: ${c.id}`);
    assert.ok(visible.includes(c.extractor), `and WHAT drafted it: ${c.extractor}`);
    for (const e of c.evidence) {
      assert.ok(html.includes(e.ref), `every evidence ref must be shown: ${e.ref}`);
    }
  }

  // THE PACK, which is the larger set and the one a reviewer cannot reconstruct from the refs.
  // A drafter shown several pages at once can carry a name out of one into a line citing another.
  assert.ok(html.includes("/notes/people/a-colleague.md"), "a page in the pack must be named");
  assert.match(html, /data-third-party="true"/);
  assert.match(visible, /400 of 1200 characters shown/, "a page seen in part must say so");
  assert.match(visible, /all 900 characters/, "and one seen whole must say that");

  // The counts are per state and nothing is combined into a figure.
  //
  // MIGRATED FROM A WHITESPACE-EXACT REGEX spanning two elements. The old assertion pinned the
  // literal run `>\s*<span class="fol-label">Unreviewed</span>\s*<span class="fol-metric
  // leaf-count">2`, so a newline moving inside the cell broke a test about arithmetic. What is
  // actually being checked is three separate things, and they are now checked separately: the
  // cell is labelled with the state's own word, the number in it is the DERIVED count, and the
  // number is marked as a metric.
  // The expected number is DERIVED FROM THE FIXTURE, never written down beside it: a literal here
  // would be a second tally, and a test that agrees with a stale constant is worse than no test.
  for (const [state, label] of [
    ["candidate", "Unreviewed"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ] as const) {
    const expected = queue.candidates.filter((c) => c.review.state === state).length;
    const cell = countCell(html, state);
    assert.ok(cell !== null, `no counts cell for ${state}`);
    assert.ok(
      cell.includes(`>${label}<`),
      `the ${state} cell must be labelled "${label}" — a count nobody can name is not a count`,
    );
    const n = /class="[^"]*\bfol-metric\b[^"]*"[^>]*>(\d+)</.exec(cell);
    assert.ok(n, `the ${state} count must be marked as a metric: a number not in mono tabular is a defect`);
    assert.equal(Number(n[1]), expected, `${state} on the page must equal the derived count`);
  }
  // Nothing on this page adds the three together, and nothing turns them into a proportion.
  assert.doesNotMatch(text(html), /\d+\s*%|\d+\s*of\s*\d+\s+(?:reviewed|decided|approved)/i);
});

test("EVERY evidence ref keeps ALL THREE of its terms, on every ref and not just the first", () => {
  // THE DEFECT THIS PINS, caught by the typechecker and not by an eye. `provenanceRow` grew an
  // `omitObserved` parameter so a leaflet ROW would not print the observed instant twice — once in
  // its own third column and once in the provenance list. The queue called it as
  // `evidence.map(provenanceRow)`, and `Array.prototype.map` passes the INDEX as the second
  // argument: ref 0 got `omitObserved = 0` (falsy, kept its timestamp) and every ref after it got
  // 1, 2, 3 — truthy — and silently lost one.
  //
  // A candidate here cites three commits, which is ordinary. The failure would have removed the
  // observation time from two thirds of the evidence on a review surface, leaving nothing on the
  // page to show anything was missing. That is the exact shape of defect this product exists to
  // refuse, so the invariant is asserted per ref rather than per page.
  const html = renderReviewPage(okHarvest(queue));
  const provLists = [...html.matchAll(/<dl class="leaf-prov">([\s\S]*?)<\/dl>/g)].map((m) => m[1]!);

  const refsInFixture = queue.candidates.reduce((n, c) => n + c.evidence.length, 0);
  assert.ok(refsInFixture >= 2, "the fixture needs a candidate citing more than one ref");
  assert.equal(
    provLists.length,
    refsInFixture,
    "every ref the document holds must reach the page as its own provenance list",
  );

  for (const [i, list] of provLists.entries()) {
    for (const term of ["Source", "Ref", "Observed"]) {
      assert.ok(
        list.includes(`>${term}</dt>`),
        `ref ${i}: "${term}" is missing. Evidence with a term dropped is evidence that quietly ` +
          `says less than the document does.`,
      );
    }
    assert.match(list, /<time datetime="[^"]+">/, `ref ${i}: the instant must be machine-readable`);
  }

  // And the leaf's ROWS are the deliberate exception, for the stated reason: the row shows the
  // instant in its own column, so repeating it inside the row would print one fact twice.
  const leaf = renderLeafPage(okLoad(populated));
  const rowLists = [...leaf.matchAll(/<li class="leaf-leaflet[^"]*"[\s\S]*?<\/li>/g)];
  assert.ok(rowLists.length > 0, "the fixture must render leaflet rows");
  for (const row of rowLists.map((m) => m[0])) {
    const prov = /<dl class="leaf-prov">([\s\S]*?)<\/dl>/.exec(row);
    if (prov === null) continue;
    assert.ok(prov[1]!.includes(">Ref</dt>"), "a row's provenance must still name its ref");
    assert.equal(
      prov[1]!.includes(">Observed</dt>"),
      false,
      "a row shows the observed instant in its own column; a second copy is one fact twice",
    );
    // `<time[^>]*datetime` and not `<time datetime`: the element carries `class="fol-metric"`
    // first, because a rendered instant is a metric and must be mono tabular like every other one.
    assert.match(
      row,
      /class="leaf-leaflet-when"[\s\S]*?<time[^>]*datetime=|data-prov="absent"/,
      "...and that column must actually carry it, or the fact was dropped rather than moved",
    );
  }
});

test("only an UNREVIEWED candidate gets a form, and the form can express both decisions", () => {
  const html = renderReviewPage(okHarvest(queue));
  const forms = [...html.matchAll(/<form class="review-form"[^>]*action="([^"]+)"[^>]*>/g)];
  assert.equal(forms.length, 2, "two unreviewed candidates, two forms");
  for (const [, action] of forms) assert.equal(action, REVIEW_ROUTE);

  assert.match(html, /method="post"/);
  // React's server renderer reorders form attributes. Assert the same control contract,
  // independently of serialization order.
  for (const value of ["approve", "reject"]) {
    assert.match(html, new RegExp(`<button(?=[^>]*name="decision")(?=[^>]*value="${value}")[^>]*>`));
  }
  assert.match(html, /<input(?=[^>]*name="by")(?=[^>]*required)[^>]*>/,
    "a decision must be attributable, said in the markup too");

  // A DECIDED candidate shows the record instead — who, when, and the reason.
  assert.match(html, /data-review-state="rejected"/);
  assert.match(
    text(html),
    /rejected by Alex on 16 Aug 2026 : dependency bumps are not a body of work/,
  );
  assert.doesNotMatch(text(html), /2026-08-16T10:00:00Z/, "the decision reads as a day, never as an ISO stamp");
  assert.match(html, /<p class="review-decision">[\s\S]*? on <time datetime="2026-08-16T10:00:00Z">16 Aug 2026<\/time>: /,
    "the instant stays machine-readable on the day's element");
  const decided = html.slice(html.indexOf('data-review-state="rejected"'));
  assert.ok(!decided.includes("<form"), "a decided candidate must not offer a second decision");
});

test("the queue says approving is not publishing and not verifying", () => {
  // The overclaim this forecloses: a green 'Approve' button reads like 'publish, verified'. What
  // it actually does is write a `pending` leaflet, and the surface has to say so.
  const html = renderReviewPage(okHarvest(queue));
  const visible = text(html);
  assert.match(visible, /draft/i);
  assert.match(visible, /does\s+not publish or verify/i);
  assert.match(visible, /pending/);
  assert.match(visible, /no sign-in/i, "an unauthenticated queue must say it is one");
  assert.match(html, /<details class="review-about"><summary>Review decisions<\/summary><div class="review-count-line"/,
    "secondary decision counts stay inspectable without repeating the open count above the work");
  const aboutStart = html.indexOf('<details class="review-about">');
  const aboutEnd = html.indexOf('</details>', aboutStart);
  const localAccess = html.indexOf('Local access by default · No sign-in');
  const firstRow = html.indexOf('class="review-candidate blade-row"');
  assert.ok(localAccess > 0 && localAccess < aboutStart && aboutStart < aboutEnd && aboutEnd < firstRow,
    "the local-access boundary stays visible before the drafts");
  const firstFormStart = html.indexOf('<form class="review-form"');
  const firstForm = html.slice(firstFormStart, html.indexOf('</form>', firstFormStart));
  assert.match(firstForm, /<p class="review-safety review-consequence">Added work stays pending; approval does not publish or verify<\/p>/);
  assert.ok(firstForm.indexOf('approval does not publish or verify') < firstForm.indexOf('value="approve"'),
    "the consequence stays beside the opened decision before its action");
});

test("an EMPTY harvest is an empty queue, and a missing one is not — six states, six pages", () => {
  const pages: readonly [string, string][] = [
    ["ok", renderReviewPage(okHarvest(queue))],
    ["ok-empty", renderReviewPage(okHarvest(harvestFrom({ candidates: [] })))],
    ["unconfigured", renderReviewPage({ ok: false, cause: "unconfigured", detail: "d" })],
    ["absent", renderReviewPage({ ok: false, cause: "absent", detail: "d", path: "/private/harvest-fixture.json" })],
    [
      "unreadable",
      renderReviewPage({ ok: false, cause: "unreadable", detail: "d", path: "/private/harvest-fixture.json", errno: "EACCES" }),
    ],
    ["malformed", renderReviewPage({ ok: false, cause: "malformed", detail: "d", path: "/private/harvest-fixture.json" })],
    [
      "invalid",
      renderReviewPage({
        ok: false,
        cause: "invalid",
        detail: "d",
        path: "/private/harvest-fixture.json",
        issues: [{ at: "candidates[0].evidence", message: "at least one ref is required" }],
      }),
    ],
  ];
  assert.equal(new Set(pages.map(([, h]) => h)).size, pages.length, "no two pages identical");
  assert.equal(
    new Set(pages.map(([, h]) => text(h))).size,
    pages.length,
    "and no two READ the same — a distinct attribute with identical prose is not honest",
  );

  const empty = pages[1]![1];
  assert.match(empty, /data-leaf-empty="true"/);
  assert.match(text(empty), /Nothing to review/i);
  assert.doesNotMatch(empty, /\/tmp\/harvest\.json|harvest\.mjs propose/, "the empty queue keeps file paths and CLI setup out of the UI");
  assert.match(empty, /href="\/workflow#sources"/, "the empty queue offers a real next action");
  assert.ok(!empty.includes("<form"), "nothing to decide on");

  // The absent page keeps the distinct cause and an action, without exposing its local path.
  assert.match(pages[3]![1], /data-leaf-plate="absent"/);
  assert.match(pages[3]![1], /href="\/workflow#sources"/);
  assert.doesNotMatch(pages[3]![1], /harvest\.mjs propose|\/private\/harvest-fixture\.json/);
  assert.ok(!pages[3]![1].includes("data-review-count="), "absent must not render counts");

  // A draft file that needs repair names the next step and offers Reload; where the file is (the
  // one thing the repair needs) and the invalid fields wait in a closed Technical details, never in
  // the sentence. The loader's own detail stays out of the page.
  for (const [cause, html] of pages.slice(4)) {
    const technical = /<details class="review-technical"><summary>Technical details<\/summary>[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
    assert.ok(technical.includes("/private/harvest-fixture.json"), `${cause}: the file is named inside the disclosure`);
    assert.doesNotMatch(html.replace(technical, ""), /\/private\/harvest-fixture\.json|>d</, `${cause}: and nowhere else`);
    assert.match(html, /<a[^>]*href="\/review"[^>]*>Reload<\/a>/, `${cause}: the next step after a repair is a reload`);
    const plate = /<section class="leaf-state"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    assert.doesNotMatch(plate, /href="\/workflow#sources"/, `${cause}: Sources is not the repair`);
  }
  assert.match(text(pages[5]![1]), /Correct the draft file, then reload\. It holds your decisions/);
  assert.ok(pages[6]![1].includes("candidates[0].evidence"));
});

test("a load's cause chooses its status, and the two cannot disagree", () => {
  assert.equal(httpStatusForHarvest(okHarvest(queue)), 200);
  assert.equal(httpStatusForHarvest({ ok: false, cause: "unconfigured", detail: "d" }), 200);
  assert.equal(httpStatusForHarvest({ ok: false, cause: "absent", detail: "d", path: "/p" }), 200);
  // 409 for the three where the draft file needs the owner's repair: an expected state with a page
  // naming it, not this app failing (500), and not all-is-well (200) while the queue is dark.
  assert.equal(
    httpStatusForHarvest({ ok: false, cause: "unreadable", detail: "d", path: "/p", errno: "EIO" }),
    409,
  );
  assert.equal(httpStatusForHarvest({ ok: false, cause: "malformed", detail: "d", path: "/p" }), 409);
  assert.equal(
    httpStatusForHarvest({ ok: false, cause: "invalid", detail: "d", path: "/p", issues: [] }),
    409,
  );
});

test("A WRITE THAT WROTE NOTHING NEVER ANSWERS SUCCESS", () => {
  // THE DEFECT THIS PINS: the review POST answered `httpStatusForHarvest(load)` when the document
  // would not load, which is 200 for `absent`. Measured on the running server — POST /review with
  // FOLIAGE_HARVEST pointing at a path holding no file answered `200 OK`, and the body never said
  // the decision had not been recorded. Anything reading the status rather than the page — a
  // script, a retry wrapper, an uptime check — was told the write succeeded.
  const failures: readonly [Extract<HarvestLoad, { ok: false }>, 409][] = [
    [{ ok: false, cause: "unconfigured", detail: "d" }, 409],
    [{ ok: false, cause: "absent", detail: "d", path: "/p" }, 409],
    [{ ok: false, cause: "unreadable", detail: "d", path: "/p", errno: "EIO" }, 409],
    [{ ok: false, cause: "malformed", detail: "d", path: "/p" }, 409],
    [{ ok: false, cause: "invalid", detail: "d", path: "/p", issues: [] }, 409],
  ];

  for (const [load, status] of failures) {
    assert.equal(httpStatusForUnwritable(load), status, `${load.cause} status`);
    // 409 rather than 200 for the two first-run states, and 409 rather than 500 for the three
    // whose file needs repair: the state of the document stopped the write, not this app.
    assert.notEqual(httpStatusForUnwritable(load), 200, `${load.cause} must not read as success`);

    const html = renderReviewWriteRefused(load);
    // The status is not the only place it is said. A reviewer who just pressed Approve reads the
    // page, and the page has to answer the press rather than describe the queue.
    assert.match(html, /role="alert"/);
    assert.match(html, new RegExp(`data-refusal="${load.cause}"`), "the cause is named in the body");
    assert.match(html, /data-written="none"/);
    assert.match(text(html), /Nothing was written/i);
    assert.match(text(html), /not<\/strong>? recorded|not\s+recorded/i);
    // And the load's own page is still under the banner, remedy included — a refusal is not a
    // dead end here either.
    assert.match(html, new RegExp(`data-leaf-state="${load.cause}"`));
  }

  // The five do not collapse into one page: which cause it was is still legible.
  const bodies = failures.map(([load]) => text(renderReviewWriteRefused(load)));
  assert.equal(new Set(bodies).size, failures.length, "no two write-refusals read the same");
});

test("EVERY REFUSAL IS ITS OWN CAUSE, its own words and its own status", () => {
  const refusals: readonly [ReviewRefusal, number, RegExp][] = [
    [{ cause: "no-such-candidate", id: "ghost" }, 404, /That draft is no longer in the queue\. Reload/],
    [
      {
        cause: "already-decided",
        id: "git-cluster:chore",
        state: { state: "approved", by: "Alex", at: "2026-08-16T10:00:00Z" },
      },
      409,
      /“chore: 2 commits” is already\s+approved by Alex on 16 Aug 2026 \./,
    ],
    [{ cause: "missing-reviewer", id: "git-cluster:feat" }, 400, /Reviewer required for “feat: 7 commits”/],
    [{ cause: "missing-reason", id: "git-cluster:feat" }, 400, /Reason required to reject “feat: 7 commits”/],
    [{ cause: "unknown-decision", given: "delete" }, 400, /not a decision/],
  ];

  for (const [refusal, status, wording] of refusals) {
    assert.equal(httpStatusForRefusal(refusal), status, `${refusal.cause} status`);
    const html = renderReviewPage(okHarvest(queue), refusal);
    assert.match(html, new RegExp(`data-refusal="${refusal.cause}"`));
    assert.match(text(html), wording, `${refusal.cause} must say what happened in words`);
    // EVERY refusal says the file was not touched. "Nothing was written" is the fact a reviewer
    // needs and cannot check for themselves.
    assert.match(text(html), /Nothing was written/i);
    // The queue is still there under the banner: a refusal is not a dead end.
    assert.ok(html.includes("git-cluster:feat"), "the queue must still render beneath the refusal");
    assert.match(html, /role="alert"/);
  }

  // The five refusals do not collapse into one page.
  const bodies = refusals.map(([r]) => text(renderReviewPage(okHarvest(queue), r)));
  assert.equal(new Set(bodies).size, refusals.length, "two refusals reading the same is masking");
});

test("a refusal names the draft by its title and the day, never by its id or an ISO stamp", () => {
  // Observed in a two-tab review: "git-cluster:www is already approved by Alex A at
  // 2026-10-08T03:36:52.189Z." The id is a document key and the stamp is a machine clock.
  const refusals: readonly ReviewRefusal[] = [
    { cause: "already-decided", id: "git-cluster:chore", state: { state: "rejected", by: "Alex", at: "2026-08-16T10:00:00Z", reason: "not a body of work" } },
    { cause: "missing-reviewer", id: "git-cluster:feat" },
    { cause: "missing-reason", id: "git-cluster:feat" },
    { cause: "title-on-reject", id: "git-cluster:feat" },
    { cause: "rating-shaped-title", id: "git-cluster:feat" },
    { cause: "no-such-candidate", id: "git-cluster:ghost" },
    { cause: "document-busy", id: "git-cluster:feat", detail: "local document busy: /private/harvest.json.lock. Retry after the current operation." },
  ];
  for (const refusal of refusals) {
    const html = renderReviewPage(okHarvest(queue), refusal);
    const banner = /<aside id="review-refusal"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? "";
    const technical = /<details class="review-technical">[\s\S]*?<\/details>/.exec(banner)?.[0] ?? "";
    const said = text(banner.replace(technical, ""));
    assert.doesNotMatch(said, /git-cluster:|\d{4}-\d\d-\d\dT\d\d|\/private\//, `${refusal.cause}: ${said}`);
    const inline = text(/<p class="review-inline-error">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "");
    assert.doesNotMatch(inline, /git-cluster:|\d{4}-\d\d-\d\dT\d\d|\/private\//, `${refusal.cause} beside the draft: ${inline}`);
  }
  // Beside the draft, under its own title, the sentence says "this draft". The day is read; the
  // instant it stands for is the element's machine-readable value, never a word of the sentence.
  const inCard = renderReviewPage(okHarvest(queue), { cause: "already-decided", id: "git-cluster:chore", state: { state: "approved", by: "Alex", at: "2026-08-16T10:00:00Z" } });
  assert.match(inCard, /<p class="review-inline-error">This draft is already approved by Alex on <time datetime="2026-08-16T10:00:00Z">16 Aug 2026<\/time>\.<\/p>/);
  const banner = /<aside id="review-refusal"[\s\S]*?<\/aside>/.exec(inCard)?.[0] ?? "";
  assert.match(banner, /<p>“chore: 2 commits” is already approved by Alex on <time datetime="2026-08-16T10:00:00Z">16 Aug 2026<\/time>\.<\/p>/);
  // A name or reason is still the reviewer's text, escaped, now that the line carries markup.
  const marked = renderReviewPage(okHarvest(queue), { cause: "already-decided", id: "git-cluster:chore", state: { state: "rejected", by: "<b>A</b>", at: "2026-08-16T10:00:00Z", reason: "a < b & c" } });
  assert.match(marked, /already rejected by &lt;b&gt;A&lt;\/b&gt; on <time datetime="2026-08-16T10:00:00Z">16 Aug 2026<\/time>: a &lt; b &amp; c\./);
  // A held lock keeps its own words, which name the lock file, for the one person who needs them.
  const busy = renderReviewPage(okHarvest(queue), refusals.at(-1)!);
  assert.match(text(busy), /Another save holds the drafts\. Your text is kept below; retry\./);
  assert.match(busy, /<details class="review-technical"><summary>Technical details<\/summary><p class="fol-metric">local document busy: \/private\/harvest\.json\.lock/);
});

test("a refusal's sentence and a Technical details disclosure wrap a long path or unbroken title instead of widening the page", () => {
  // Measured at 390px on a garden copy: a folder name with no break opportunity in the draft file's
  // path widened /review to 1016px, and an unbroken draft title in a refusal widened it to 711px.
  const css = leafCssSource.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const selector of [".review-technical", ".review-refusal p", ".leaf-detail"]) {
    const rule = new RegExp(`(?:^|\\n)${selector.replace(/[.*]/g, "\\$&")}\\s*(?:,[^{]*)?\\{[^}]*overflow-wrap:\\s*anywhere`);
    assert.match(css, rule, `${selector} breaks a long word rather than overflowing`);
  }
});

test("a refused promotion is a page in the app layout with the next step and the way back", () => {
  const fixture = "/private/leaf-fixture.json";
  const promotable: HarvestDocument = { ...queue, candidates: queue.candidates.map((c) => c.id === "git-cluster:feat"
    ? { ...c, review: { state: "approved" as const, by: "Alex", at: "2026-08-16T10:00:00Z" } } : c) };
  const pages = [
    renderPromoteRefused({ cause: "leaf-unavailable", load: { ok: false, cause: "absent", detail: `No leaf document was found at ${fixture}`, path: fixture }, harvest: promotable }),
    renderPromoteRefused({ cause: "leaf-unavailable", load: { ok: false, cause: "malformed", path: fixture,
      detail: `${fixture} is not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)` }, harvest: promotable }),
    renderPromoteRefused({ cause: "cell-authority-refused", reason: "Cell drafts require the current private store. Use cells.mjs promote." }),
    renderPromoteRefused({
      cause: "binding-mismatch",
      mismatches: [{ field: "subject", harvestValue: "Rowan", leafValue: "Alex" }],
      harvestPath: "/private/harvest-fixture.json",
      leafPath: "/private/leaf-fixture.json",
    }),
    renderPromoteRefused({ cause: "document-busy", detail: "local document busy: /private/leaf-fixture.json.lock." }),
    renderPromoteRefused({ cause: "leaf-unavailable", load: { ok: false, cause: "unreadable", path: fixture, errno: "EACCES",
      detail: `${fixture} exists as far as this process can tell, but could not be read: EACCES: permission denied, open '${fixture}' [EACCES]` }, harvest: promotable }),
    renderPromoteRefused({ cause: "leaf-unavailable", load: { ok: false, cause: "invalid", detail: "d", path: fixture,
      issues: [{ at: "subject", message: "required" }] }, harvest: promotable }),
  ];
  for (const html of pages) {
    assert.match(html, /^<!doctype html>/i, "a full page, not a text/plain body");
    assert.match(html, /<nav[^>]*aria-label="[^"]*"/, "inside the app's own navigation");
    assert.match(html, /role="alert"[^>]*data-written="none"/);
    assert.match(text(html), /Nothing added to your record/);
    assert.ok(html.includes(`<a href="${REVIEW_ROUTE}#review-promote-h">Back to review</a>`), "and the way back");
    const technical = /<details class="review-technical">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
    assert.doesNotMatch(text(html.replace(technical, "")), /\/private\/|refused:|NOTHING/, "paths and shouting stay out of the sentence");
  }
  assert.match(text(pages[0]!), /No private record yet Create it, then add your 1 approved draft from Review\./);
  assert.match(pages[0]!, /<a[^>]*href="\/leaf\/setup"[^>]*>Create your private record<\/a>/);
  assert.doesNotMatch(pages[0]!, /\/private\//, "a missing record has no file to repair, so no path at all");
  assert.match(text(pages[3]!), /These drafts were collected for another record/);
  assert.match(text(pages[3]!), /subject Drafts: Rowan · This record: Alex/);

  // A record that will not parse or read is repaired on disk, so the page names no Portfolio
  // detour: the file and what the loader saw (where the JSON breaks, or the OS error) wait under
  // its own Technical details, which is what makes the repair doable.
  const [malformed, unreadable, invalid] = [pages[1]!, pages[5]!, pages[6]!];
  const technicalOf = (html: string) => /<details class="review-technical">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  assert.match(text(malformed), /Leaf file is not valid JSON Correct the file, then add your approved drafts again\./);
  assert.match(text(unreadable), /Leaf file unreadable Check the file's permissions, then add your approved drafts again\./);
  for (const html of [malformed, unreadable]) {
    const plate = /<section class="leaf-state"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    assert.doesNotMatch(plate.replace(technicalOf(html), ""), /Portfolio|href="\/leaf"/, "no detour: the repair is on this page");
    assert.match(technicalOf(html), /<summary>Technical details<\/summary><p>Leaf file <span class="fol-metric">\/private\/leaf-fixture\.json<\/span><\/p>/);
  }
  assert.match(text(technicalOf(malformed)), /Expected property name or '}' in JSON at position 1 \(line 1 column 2\)/);
  assert.match(text(technicalOf(unreadable)), /EACCES: permission denied/);
  // Only a record that parsed but failed validation has a Portfolio page listing what to fix.
  assert.match(text(invalid), /Portfolio lists what to fix\./);
  assert.match(invalid, /<a[^>]*href="\/leaf"[^>]*>Open Portfolio<\/a>/);
  assert.match(technicalOf(invalid), /<p>Leaf file <span class="fol-metric">\/private\/leaf-fixture\.json<\/span><\/p><\/details>/);
});

test("A SHARED TITLE WITH AN IDENTIFIER IS REDACTED; the owner retains its source words", () => {
  // <title> is the one string on this page that ESCAPES it: the browser tab, the history entry,
  // the bookmark, the text a link preview quotes. It used to be `leaflet.title` verbatim, and two
  // separate problems followed:
  //
  //   1. Intake over a real repository produced a title with a third party's address. The
  //      published heading now redacts it; the owner view retains the original words.
  //   2. NO MARKER, SO NO EXEMPTION. `<title>` carries no `data-verbatim`, so a carried subject
  //      sitting there was authored chrome by this file's own rules — the score-shaped real
  //      commit subject pinned above would have put "score" and "40%" into the product's chrome.
  const withAddress = leafFrom({
    id: "l",
    subject: "Render Input",
    leaflets: [
      {
        id: "leaked",
        title: "fix: use private.person@secret-employer.example in English README",
        tier: "pending",
        visibility: "public",
        provenance: prov,
      },
    ],
  });
  const html = renderLeafletPage(findLeaflet(withAddress, "leaked"), ordinarySource);
  const windowTitle = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(no title element)";

  assert.ok(
    !windowTitle.includes("private.person@secret-employer.example"),
    `the window title carries a third party's address: ${windowTitle}`,
  );
  assert.ok(
    !windowTitle.includes("secret-employer"),
    `the window title carries a third party's domain: ${windowTitle}`,
  );
  assert.ok(!/@/.test(windowTitle), `no address-shaped text at all: ${windowTitle}`);

  // It still identifies the artifact, in terms the product owns: the tier and the ref. A title
  // that said only "Foliage" would be honest and useless, and two open tabs would be identical.
  assert.match(windowTitle, /attributed, unverified leaflet/, "the window title must say what this artifact is");
  assert.ok(windowTitle.includes(prov.ref), "and which one, by the ref the evidence names");

  assert.doesNotMatch(html, /private\.person@secret-employer\.example/, "a shared link must not repeat the address");
  assert.match(html, /data-title-redacted="true"/, "a changed heading must not claim verbatim source words");
  assert.match(text(html), /\[withheld: email address\]/);
  const publicIndex = renderLeafPage(okLoad(withAddress));
  assert.doesNotMatch(publicIndex, /private\.person@secret-employer\.example/, "the public leaf list must use the same redacted title");
  assert.match(publicIndex, /data-title-redacted="true"/);
  const owner = renderLeafletPage(findLeaflet(withAddress, "leaked"), ordinarySource, "private");
  assert.match(text(owner), /private\.person@secret-employer\.example/, "the owner can still inspect source words");
});

test("NO SCORE on either new surface, in anything this product writes", () => {
  const pages = [
    renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource),
    renderLeafletPage(findLeaflet(compound, "secret-excluded-id"), ordinarySource),
    renderLeafletPage(findLeaflet(compound, "nope"), ordinarySource),
    renderReviewPage(okHarvest(queue)),
    renderReviewPage(okHarvest(harvestFrom({ candidates: [] }))),
    renderReviewPage({ ok: false, cause: "absent", detail: "d", path: "/p" }),
  ];
  for (const html of pages) {
    for (const forbidden of ["score", "rank", "/5", "out of", "rating", "percentile", "confidence"]) {
      assert.ok(
        !chrome(html).toLowerCase().includes(forbidden),
        `"${forbidden}" reached authored chrome on a new surface`,
      );
    }
  }
});

test("A CANDIDATE TITLE IS MACHINE PROSE NOBODY HAS APPROVED — the gate sees every one", () => {
  // The review queue is the surface with no rationale to fall back on at all. A `HarvestCandidate`
  // has no provenance, only `evidence[]` and an `extractor`; its title is what that extractor
  // DRAFTED, and on this page it has not even been approved yet — deciding whether it may stand is
  // the purpose of the screen. It was nevertheless emitted inside `data-verbatim="title"`, which
  // both attested a machine's prose as somebody's own words and lifted the NO SCORE gate off it.
  //
  // The model IS prompted not to produce ratings (harvest.mjs), and a prompt is not an invariant.
  const rated = harvestFrom({
    candidates: [
      {
        id: "local-model:rated",
        title: "Shipped work rated 9/10 across 40% of the tree",
        evidence: [{ source: "git", ref: "aaa1111", observedAt: "2026-08-16T09:00:00Z" }],
        extractor: "local-model:gemma4:12b",
        draftedAt: "2026-08-16T09:00:00Z",
        review: { state: "candidate" },
      },
    ],
  });
  const html = renderReviewPage(okHarvest(rated));

  // Shown to the reviewer — that is the job; refusing to display it would hide what is being
  // decided. Marked as the machine's, and inside the gate's field of view.
  assert.ok(text(html).includes("Shipped work rated 9/10 across 40% of the tree"));
  assert.doesNotMatch(html, /<span class="review-title" data-verbatim="title">/);
  assert.match(html, /<summary class="review-candidate-summary">\s*<span class="review-title" data-authored="drafted-title">Shipped work rated/);
  for (const forbidden of ["rated", "/10", "%"]) {
    assert.ok(
      chrome(html).toLowerCase().includes(forbidden),
      `"${forbidden}" in an unapproved machine draft must reach the NO SCORE check`,
    );
  }

  // And the ordinary queue is still clean by the same check — the exemption was removed, not
  // traded for a page that now trips its own gate on real drafted titles.
  for (const forbidden of ["score", "rank", "/5", "out of", "rating", "percentile"]) {
    assert.ok(
      !chrome(renderReviewPage(okHarvest(queue))).toLowerCase().includes(forbidden),
      `"${forbidden}" reached the review queue's authored chrome`,
    );
  }
});

test("the new surfaces are complete documents, and only the instrument one is night", () => {
  const artifact = renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource);
  const review = renderReviewPage(okHarvest(queue));
  for (const html of [artifact, review]) {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<link rel="stylesheet" href="\/tokens.css">/);
    assert.match(html, /<link rel="stylesheet" href="\/leaf.css">/);
    assert.match(html, /<a class="leaf-skip" href="#leaf-main">/);
  }
  // The plane, stated in the markup: a shared artifact keeps the PUBLIC face of the leaf it came
  // from; the operator's queue takes the instrument face. render.ts argues why.
  assert.match(artifact, /<html lang="en" data-face="day">/);
  assert.match(review, /<html lang="en" data-face="night">/);
});

test("every metric on every surface is marked as one", () => {
  // "A metric not set in mono tabular-nums is a defect" is a DESIGN SYSTEM rule, and `.fol-metric`
  // in tokens.css is the only thing that carries it. This used to pin `class="fol-metric
  // leaf-count"` and `<span class="..." data-review-count=...>` — both of which pin a container
  // that the redesign is entitled to change. What may not change is that every bare number and
  // every evidence ref is marked.
  const html = renderReviewPage(okHarvest(queue));
  for (const state of ["candidate", "approved", "rejected"] as const) {
    const cell = countCell(html, state);
    assert.ok(cell !== null, `no counts cell for ${state}`);
    assert.match(
      cell,
      /class="[^"]*\bfol-metric\b[^"]*"[^>]*>\d+</,
      `the ${state} count is not marked as a metric`,
    );
  }
  // The leaf's own tier counts, same rule, on the other face. Private audience: the strip is the
  // subject's own accounting and does not render on the published face at all (see the dedicated
  // split test below).
  const leaf = renderLeafPage(okLoad(populated), "private");
  for (const m of leaf.matchAll(/<[a-z]+ class="([^"]*)" data-count="[a-z]+">/g)) {
    assert.match(m[1]!, /\bfol-metric\b/, "a tier count must be mono tabular");
  }
  // And an evidence ref, which is the most important metric this product renders.
  const artifact = renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource);
  const ref = /<dt class="fol-label">Ref<\/dt><dd class="([^"]*)"><span title="e3b4489">e3b4489<\/span>/.exec(artifact);
  assert.ok(ref, "the artifact must render its ref");
  assert.match(ref[1]!, /\bfol-metric\b/, "a ref is a metric");
});

/* ================================================================================================
   THE NIGHT FACE, MEASURED.

   dayFace.test.ts checks the DAY pairings against the real token file. The review queue renders
   on the NIGHT canvas, and inverting a surface's luminance invalidates every ratio measured on
   the other one — so the night pairings are declared here and computed here, out of the same
   token file, at the px size each is actually rendered at.

   Two things this deliberately does NOT do. It does not assert "AA" as a claim: it states each
   measured ratio with its size and asserts it against the threshold that size demands. And it
   introduces no hex of its own — every value is resolved from @foliage/tokens at run time, so
   this file cannot go stale the way a documented palette does.
   ============================================================================================= */

const tokensCss = await readFile(
  fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css")),
  "utf8",
);

interface NightPairing {
  readonly role: string;
  readonly fg: string;
  readonly bg: string;
  readonly sizeToken: string;
  readonly bold: boolean;
}

/** Every text pairing the night face puts on screen. An unlisted pairing is an unchecked one. */
const NIGHT_FACE_PAIRINGS: readonly NightPairing[] = [
  { role: "queue heading", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-40", bold: false },
  { role: "section heading", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-25", bold: false },
  { role: "candidate title", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-20", bold: false },
  { role: "candidate title on a decided card", fg: "--fol-text", bg: "--fol-surface", sizeToken: "--fol-t-20", bold: false },
  { role: "body copy", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-16", bold: false },
  { role: "field text", fg: "--fol-text", bg: "--fol-surface", sizeToken: "--fol-t-16", bold: false },
  { role: "button label", fg: "--fol-text", bg: "--fol-surface-raised", sizeToken: "--fol-t-14", bold: false },
  { role: "evidence metric", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-13", bold: false },
  { role: "refusal banner", fg: "--fol-text", bg: "--fol-surface", sizeToken: "--fol-t-13", bold: false },
  { role: "secondary copy", fg: "--fol-text-muted", bg: "--fol-canvas", sizeToken: "--fol-t-13", bold: false },
  { role: "secondary copy on a decided card", fg: "--fol-text-muted", bg: "--fol-surface", sizeToken: "--fol-t-13", bold: false },
  { role: "field placeholder", fg: "--fol-text-muted", bg: "--fol-surface", sizeToken: "--fol-t-16", bold: false },
  { role: "mono label", fg: "--fol-text-faint", bg: "--fol-canvas", sizeToken: "--fol-t-11", bold: false },
  { role: "mono label on a decided card", fg: "--fol-text-faint", bg: "--fol-surface", sizeToken: "--fol-t-11", bold: false },
  { role: "proof pill label", fg: "--fol-text", bg: "--fol-canvas", sizeToken: "--fol-t-11", bold: false },
];

/**
 * WCAG 1.4.11: a non-text indicator that identifies a component needs 3:1 against what it sits
 * on. Listed separately from the text pairings because the threshold has nothing to do with a
 * font size — these are borders and a focus ring.
 */
const NIGHT_NON_TEXT: readonly { role: string; fg: string; bg: string }[] = [
  { role: "field border", fg: "--fol-text-faint", bg: "--fol-surface" },
  { role: "button border", fg: "--fol-text-faint", bg: "--fol-surface-raised" },
  { role: "focus ring", fg: "--fol-text", bg: "--fol-canvas" },
  { role: "third-party page rule", fg: "--fol-text-faint", bg: "--fol-canvas" },
  { role: "the mark", fg: "--fol-evergreen-300", bg: "--fol-canvas" },
];

const NON_TEXT_MIN = 3;

test("NIGHT-FACE CONTRAST, measured — every ratio stated with the px size it is judged at", () => {
  for (const p of NIGHT_FACE_PAIRINGS) {
    const fg = resolveTokenValue(tokensCss, p.fg);
    const bg = resolveTokenValue(tokensCss, p.bg);
    const size = resolveTokenValue(tokensCss, p.sizeToken);
    assert.ok(fg !== null && bg !== null && size !== null, `${p.role}: a token did not resolve`);
    const px = remTokenToPx(size);
    assert.ok(px !== null, `${p.role}: ${p.sizeToken} is not a rem value`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio !== null, `${p.role}: ${fg} on ${bg} could not be measured`);
    const min = wcagMinimum(px, p.bold);
    console.log(
      `    ${p.role}: ${p.fg} on ${p.bg} at ${px}px = ${ratio.toFixed(2)}:1 (needs ${min}:1)`,
    );
    assert.ok(
      ratio >= min,
      `${p.role}: ${p.fg} on ${p.bg} measures ${ratio.toFixed(2)}:1 at ${px}px, under ${min}:1`,
    );
  }
});

test("NIGHT-FACE NON-TEXT CONTRAST — a boundary nobody can see is not a boundary", () => {
  for (const p of NIGHT_NON_TEXT) {
    const fg = resolveTokenValue(tokensCss, p.fg);
    const bg = resolveTokenValue(tokensCss, p.bg);
    assert.ok(fg !== null && bg !== null, `${p.role}: a token did not resolve`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio !== null, `${p.role}: could not be measured`);
    console.log(`    ${p.role}: ${p.fg} on ${p.bg} = ${ratio.toFixed(2)}:1 (needs ${NON_TEXT_MIN}:1)`);
    assert.ok(
      ratio >= NON_TEXT_MIN,
      `${p.role}: ${ratio.toFixed(2)}:1 is under WCAG 1.4.11's ${NON_TEXT_MIN}:1`,
    );
  }
});

test("THIS APP DECLARES NO FACE OF ITS OWN — every colour it uses rides the one in tokens.css", async () => {
  // WHAT THIS REPLACES, AND WHY THE REPLACEMENT IS STRONGER. leaf.css used to carry its own
  // `html[data-face="day"]{...}` and `html[data-face="night"]{...}` blocks, binding ~8 --leaf-*
  // colour roles twice — a second copy of the same derivation that apps/canopy/public/tree.css
  // ALSO carried. The old test asserted the two local blocks bound the same NAMES, which is the
  // best you can do once the duplication exists. The duplication is now gone: the face lives in
  // @foliage/tokens, once, and this file names roles that resolve through it.
  //
  // So the invariant is no longer "the two copies agree" but "there is only one copy". A face
  // block reappearing here is the drift starting again, and it would be invisible — both faces
  // would still render, just from two sources that can diverge one commit at a time.
  const css = leafCssSource.replace(/\/\*[\s\S]*?\*\//g, "");

  const faceBlocks = [...css.matchAll(/(?:\[data-face=|\.face-)[^{]*\{([^}]*)\}/g)];
  const rebinding = faceBlocks.filter((m) => /--[a-z0-9-]+\s*:/i.test(m[1]!));
  assert.deepEqual(
    rebinding.map((m) => m[0]),
    [],
    "leaf.css must not rebind a custom property per face — the face is tokens.css's, and a " +
      "second copy of it is the drift surface this migration removed",
  );

  // And no --leaf-* COLOUR role survives either: the colour roles are @foliage/tokens' --fol-role-*
  // now. `--leaf-measure` is not a colour and is legitimately this app's — a reading measure is a
  // property of the surface, not of the design system.
  const localVars = [...css.matchAll(/(--leaf-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
  assert.deepEqual(
    [...new Set(localVars)].sort(),
    ["--leaf-measure"],
    "the only custom property this app may still declare is its reading measure",
  );

  // Every role it reads must exist in the role layer, because an unresolved var() drops the whole
  // declaration silently and the element quietly inherits — which looks like a design choice.
  const rolesCss = await readFile(
    fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css")),
    "utf8",
  );
  const declared = new Set(
    [...rolesCss.matchAll(/(--fol-role-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
  );
  const read = new Set([...css.matchAll(/var\(\s*(--fol-role-[a-z0-9-]+)/g)].map((m) => m[1]!));
  assert.ok(read.size > 10, "sanity: this stylesheet should be built on the role layer");
  assert.deepEqual(
    [...read].filter((r) => !declared.has(r)).sort(),
    [],
    "leaf.css reads a --fol-role-* that roles.css does not define",
  );
});

/* ================================================================================================
   VISIBILITY — the question the share route asks before it renders anything.

   `private` is the domain's default, including for every document written before the field
   existed. So the interesting cases are all about what a stranger holding a URL can learn.
   ============================================================================================= */

test("A PRIVATE LEAFLET IS NOT SERVED, and the refusal is indistinguishable from a missing one", () => {
  const withPrivate = leafFrom({
    id: "l",
    subject: "Subject",
    leaflets: [
      { id: "kept-back", title: "a private accounting entry", tier: "pending" },
      { id: "handed-out", title: "the one they shared", tier: "pending", visibility: "unlisted" },
    ],
  });

  // Default is private: the field is absent on the first leaflet and it is still refused.
  const priv = findLeaflet(withPrivate, "kept-back");
  assert.equal(priv.ok, false, "an undecided leaflet must not be shareable by omission");

  // THE POINT: byte-identical to a nonexistent id, so the route is not an existence oracle.
  const ghost = findLeaflet(withPrivate, "no-such-id-at-all");
  assert.equal(
    renderLeafletPage(priv, ordinarySource).replace("kept-back", "no-such-id-at-all"),
    renderLeafletPage(ghost, ordinarySource),
    "a private leaflet and a missing one must produce the same page but for the id echoed back",
  );
  // And neither discloses the private leaflet's words.
  for (const html of [renderLeafletPage(priv, ordinarySource), renderLeafletPage(ghost, ordinarySource)]) {
    assert.ok(!html.includes("a private accounting entry"), "the withheld title must not leak");
    assert.ok(!html.includes("handed-out"), "nor any other id");
  }

  // `unlisted` is served. Being willing to hand someone a link is the consent this route needs.
  const shared = findLeaflet(withPrivate, "handed-out");
  assert.equal(shared.ok, true);
  assert.ok(renderLeafletPage(shared, ordinarySource).includes("the one they shared"));

  // `public` is served too — it is `unlisted` plus consent to be listed, which is a leaf-page
  // question rather than a share-route one.
  const pub = leafFrom({
    id: "l",
    subject: "S",
    leaflets: [{ id: "open", title: "an outward one", tier: "pending", visibility: "public" }],
  });
  assert.equal(findLeaflet(pub, "open").ok, true);
});

test("a private leaflet opens for its owner, and its visibility stays a visible fact", () => {
  const mixed = leafFrom({
    id: "l",
    subject: "Subject",
    leaflets: [
      { id: "kept-close", title: "t-private", tier: "pending", provenance: prov },
      { id: "handed-out", title: "t-unlisted", tier: "pending", provenance: prov, visibility: "unlisted" },
    ],
  });
  const html = renderLeafPage(okLoad(mixed), "private");
  const source = renderLeafPage(okLoad(mixed), "private", { records: "source" });
  // OWNER RULE 2026-08-23: the instrument hides nothing from its owner — both rows link, and the
  // report page is where the full accounting lives.
  const hrefs = [...(html + source).matchAll(/<p class="leaf-leaflet-open"[^>]*><a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(hrefs)].sort(), [ownerLeafletHref("handed-out"), ownerLeafletHref("kept-close")].sort());
  // The distinction the share route refuses to reveal to strangers is still stated to the owner,
  // as a fact beside the affordance rather than a paragraph.
  assert.match(source, /<p class="leaf-leaflet-open" data-visibility="private">/);
  assert.match(html, /<p class="leaf-leaflet-open" data-visibility="unlisted">/);
  // The ledger still counts every leaflet.
  assert.match(html, /data-count="pending">2</);
});

/** A queue with one approved candidate, one still unreviewed, and one rejected. */
const promotable = harvestFrom({
  candidates: [
    {
      id: "git-cluster:feat",
      title: "feat: 7 commits",
      evidence: [{ source: "git", ref: "aaa1111", observedAt: "2026-08-16T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-16T09:00:00Z",
      review: { state: "approved", by: "Alex", at: "2026-08-16T10:00:00Z" },
    },
    {
      id: "git-cluster:fix",
      title: "fix: 3 commits",
      evidence: [{ source: "git", ref: "bbb2222", observedAt: "2026-08-16T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-16T09:00:00Z",
      review: { state: "candidate" },
    },
    {
      id: "git-cluster:chore",
      title: "chore: 2 commits",
      evidence: [{ source: "git", ref: "ccc3333", observedAt: "2026-08-16T09:00:00Z" }],
      extractor: "git-cluster",
      draftedAt: "2026-08-16T09:00:00Z",
      review: { state: "rejected", by: "Alex", at: "2026-08-16T10:00:00Z", reason: "not work" },
    },
  ],
});

const emptyLeaf: LeafIndex = { ok: true, ids: new Set<string>(), path: "/tmp/leaf.json", subject: "Leaf Subject" };

test("nothing approved offers no promote control at all", () => {
  // `queue` has one unreviewed, one unreviewed-with-pages and one rejected — nothing approved.
  const html = renderReviewPage(okHarvest(queue), null, emptyLeaf);
  assert.ok(!html.includes(PROMOTE_ROUTE), "a form posting to /promote must not be rendered");
  assert.ok(
    !text(html).includes("Into the leaf"),
    "and the section heading must be absent, not merely empty — a zeroed control invites a " +
      "click that would do nothing",
  );
});

test("an approved candidate the leaf lacks is offered, counted, and only it is counted", () => {
  const html = renderReviewPage(okHarvest(promotable), null, emptyLeaf);
  const visible = text(html);

  assert.match(html, new RegExp(`action="${PROMOTE_ROUTE}"`), "the form posts to /promote");
  // ONE, not three: the unreviewed and the rejected are not carried, and the count is the
  // arithmetic the domain would do rather than the length of the candidate list.
  assert.match(visible, /Add 1 to leaf/);
  assert.ok(!visible.includes("Add 3 to leaf"));
});

test("the promote control states what it does NOT do, in the same breath as what it does", () => {
  // The surface note forbids a queue that reads like a publish button. A caption that omits the
  // limit is that overclaim arriving by another route, so the disclaimer is part of the contract.
  const visible = text(renderReviewPage(okHarvest(promotable), null, emptyLeaf));
  assert.match(visible, /does not publish anything and does not verify anything/i);
  assert.match(visible, /pending/, "and it must name the tier a promoted candidate lands at");
});

test("an approved candidate already in the leaf is not offered again", () => {
  const holds: LeafIndex = {
    ok: true,
    ids: new Set(["git-cluster:feat"]),
    path: "/tmp/leaf.json",
    subject: "Leaf Subject",
  };
  const html = renderReviewPage(okHarvest(promotable), null, holds);

  assert.ok(!html.includes(`action="${PROMOTE_ROUTE}"`), "no form: there is nothing to carry");
  assert.match(text(html), /All approved are in the leaf/);
  assert.match(html, /data-leaf-plate="promote-done"/);
});

test("an unreadable leaf offers no control and names the cause", () => {
  const broken: LeafIndex = { ok: false, detail: "the leaf at /tmp/x.json could not be read" };
  const html = renderReviewPage(okHarvest(promotable), null, broken);

  assert.ok(
    !html.includes(`action="${PROMOTE_ROUTE}"`),
    "offering to write a document this process cannot read would be promising something " +
      "unchecked",
  );
  assert.match(html, /data-leaf-plate="promote-unavailable"/);
  assert.match(text(html), /could not be read/);
});

test("an absent index is treated as no leaf, never as an empty one", () => {
  // The distinction matters: an EMPTY leaf means "carry everything across", while an ABSENT one
  // means "we do not know". Collapsing them would offer a write against an unknown target.
  const html = renderReviewPage(okHarvest(promotable), null, null);
  assert.ok(!html.includes(`action="${PROMOTE_ROUTE}"`));
  assert.match(html, /data-leaf-plate="promote-unavailable"/);
});

/** What the server hands the promote panel for a record that did not load: the sentence, and the load. */
const unread = (load: Extract<LeafLoad, { ok: false }>): LeafIndexUnavailable => ({ ok: false, detail: `sentence for ${load.cause}`, load });
const FIXTURE = "/private/leaf-fixture.json";
/** The refused page's own content: the shell around it links the setup route in its navigation. */
const plateOf = (html: string): string => /<section class="leaf-state"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const absentLoad: Extract<LeafLoad, { ok: false }> = { ok: false, cause: "absent", path: FIXTURE, detail: `No leaf document was found at ${FIXTURE}` };

test("approved work with no record yet leads to creating the record, never to a failure", () => {
  // Missing, not broken: the one unread leaf the owner resolves by creating it. The panel reads
  // that from the load's cause; there is no second marker.
  const missing = unread(absentLoad);
  const html = renderReviewPage(okHarvest(promotable), null, missing);
  assert.ok(!html.includes(`action="${PROMOTE_ROUTE}"`), "nothing can be added before the record exists");
  assert.match(html, /<a class="fol-button fol-button-primary" href="\/leaf\/setup">Create your private record<\/a>/);
  assert.match(text(html), /No private record yet · 1 approved/);
  assert.match(text(html), /Create it, then add your approved draft here\./);
  // The same unavailable plate as any unread leaf, naming the record step instead of a cause.
  assert.match(html, /<h2 id="review-promote-h">[\s\S]*?<p data-leaf-plate="promote-unavailable">No private record yet/);
  assert.doesNotMatch(text(html), /no leaf|could not be read|sentence for/);
  // No file exists yet, so nothing to repair: no path, no Technical details, no Portfolio detour.
  const panel = /<section class="review-promote"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.doesNotMatch(panel, /leaf-fixture|Technical details|Open Portfolio/);
  // Nothing approved: nothing waits for a record, so the panel stays silent as before.
  assert.doesNotMatch(renderReviewPage(okHarvest(queue), null, missing), /Create your private record|review-promote-h/);
  // A bound queue adds only into a record of its own name; a binding no new record can meet
  // promises no add at all.
  const bound = renderReviewPage(okHarvest({ ...promotable, subject: "Alex A", leafId: "alex-a" }), null, missing);
  assert.match(text(bound), /Create it as Alex A, then add your approved draft here\./);
  const unmet = text(renderReviewPage(okHarvest({ ...promotable, subject: "Alex A", leafId: "leaf:other" }), null, missing));
  assert.match(unmet, /Your approved draft was prepared for another record and can't be added to a new one\./);
  assert.doesNotMatch(unmet, /then add/);
});

test("the promote panel names a record file to repair under Technical details, and points at Portfolio only where Portfolio shows the step", () => {
  const panelFor = (load: Extract<LeafLoad, { ok: false }>) => {
    const html = renderReviewPage(okHarvest(promotable), null, unread(load));
    return /<section class="review-promote"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  };
  const malformed = panelFor({ ok: false, cause: "malformed", path: FIXTURE, detail: `${FIXTURE} is not valid JSON: Unexpected end of JSON input` });
  assert.match(text(malformed), /^Your record \d+ approved · no leaf sentence for malformed Technical details Leaf file \/private\/leaf-fixture\.json Unexpected end of JSON input$/);
  assert.doesNotMatch(malformed, /Open Portfolio/);
  assert.doesNotMatch(malformed, /<details class="review-technical"[^>]*\bopen\b/, "closed until asked for");

  const invalid = panelFor({ ok: false, cause: "invalid", path: FIXTURE, detail: "d", issues: [] });
  assert.match(invalid, /<a href="\/leaf">Open Portfolio<\/a><details class="review-technical">/);

  // A missing record has no file, and Portfolio is not where it is started from here: the panel's
  // own action creates it, so there is no path, no disclosure and no detour.
  const absent = panelFor(absentLoad);
  assert.match(absent, /href="\/leaf\/setup">Create your private record<\/a>/);
  assert.doesNotMatch(absent, /leaf-fixture|Technical details|Open Portfolio/);
});

test("a broken record is repaired, never replaced: approved drafts do not offer to create one", () => {
  // Creating would not fix a file that is there, and must never overwrite it. Every unread cause
  // but a missing record leads somewhere other than the create action, on the panel and on a
  // refused Add alike.
  const broken: readonly Extract<LeafLoad, { ok: false }>[] = [
    { ok: false, cause: "malformed", path: FIXTURE, detail: `${FIXTURE} is not valid JSON: Unexpected end of JSON input` },
    { ok: false, cause: "unreadable", path: FIXTURE, errno: "EACCES", detail: `${FIXTURE} exists as far as this process can tell, but could not be read: EACCES [EACCES]` },
    { ok: false, cause: "invalid", path: FIXTURE, detail: "d", issues: [{ at: "subject", message: "required" }] },
    { ok: false, cause: "unconfigured", path: null, detail: "FOLIAGE_LEAF is set but blank" },
  ];
  for (const load of broken) {
    const panel = /<section class="review-promote"[\s\S]*?<\/section>/.exec(renderReviewPage(okHarvest(promotable), null, unread(load)))?.[0] ?? "";
    assert.match(panel, /data-leaf-plate="promote-unavailable"/, load.cause);
    assert.doesNotMatch(panel, /Create your private record|\/leaf\/setup|then add/, `${load.cause}: panel`);
    const refused = plateOf(renderPromoteRefused({ cause: "leaf-unavailable", load, harvest: promotable }));
    assert.doesNotMatch(refused, /Create your private record|\/leaf\/setup|Start your record/, `${load.cause}: refused Add`);
  }
  // An index that carries no load at all (nothing known) cannot be read as missing either.
  assert.doesNotMatch(renderReviewPage(okHarvest(promotable), null, { ok: false, detail: "unknown" }), /Create your private record/);
});

test("an unset record location says so and promises neither a new record nor an add", () => {
  // `refuseIfUnconfigured` refuses the Add while FOLIAGE_LEAF is blank, and setup cannot create a
  // record at no path: the page says what is true and names the way out (start through foliage up).
  const load: Extract<LeafLoad, { ok: false }> = { ok: false, cause: "unconfigured", path: null, detail: "FOLIAGE_LEAF is set but blank, so no document path could be determined." };
  const page = renderReviewPage(okHarvest(promotable), null, { ok: false, detail: leafLoadProblem(load), load });
  const panel = /<section class="review-promote"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
  assert.match(text(panel), /1 approved · no leaf The location of your private record isn't set for this workspace\. Start Foliage with foliage up\./);
  assert.doesNotMatch(panel, /FOLIAGE_LEAF|Create it|Create your private record|Open Portfolio|Technical details/);
  const refused = plateOf(renderPromoteRefused({ cause: "leaf-unavailable", load, harvest: promotable }));
  assert.match(text(refused), /No Leaf file configured The location of your private record isn't set for this workspace\. Start Foliage with foliage up\. Then add your approved drafts again\./);
  assert.doesNotMatch(refused, /FOLIAGE_LEAF|Create your private record|\/leaf\/setup|Technical details/);
});

test("a refused Add with no record agrees with the panel: the same action and wording, and only the add it can promise", () => {
  const missing = renderPromoteRefused({ cause: "leaf-unavailable", load: absentLoad, harvest: promotable });
  assert.match(text(missing), /Nothing added to your record No private record yet Create it, then add your 1 approved draft from Review\./);
  assert.match(missing, /<a class="fol-button fol-button-primary" href="\/leaf\/setup">Create your private record<\/a>/);
  assert.doesNotMatch(missing, /leaf-fixture|Technical details|Start your record/, "nothing to repair: no path, and one name for the action");
  const bound = text(renderPromoteRefused({ cause: "leaf-unavailable", load: absentLoad, harvest: { ...promotable, subject: "Alex A", leafId: "alex-a" } }));
  assert.match(bound, /Create it as Alex A, then add your 1 approved draft from Review\./);
  const unmet = renderPromoteRefused({ cause: "leaf-unavailable", load: absentLoad, harvest: { ...promotable, subject: "Alex A", leafId: "leaf:other" } });
  assert.match(text(unmet), /Your 1 approved draft was prepared for another record and can't be added to a new one\./);
  assert.doesNotMatch(text(unmet), /then add/);
  // Nothing approved is never counted as a promise: a stale Add has nothing to add yet.
  assert.match(text(renderPromoteRefused({ cause: "leaf-unavailable", load: absentLoad, harvest: queue })), /Create your private record first\./);
});

test("the promote panel makes no score claim", () => {
  const visible = text(renderReviewPage(okHarvest(promotable), null, emptyLeaf));
  assert.ok(!/\d+(\.\d+)?\s?%/.test(visible), "no percentage may appear on this surface");
  for (const word of ["score", "rank", "rating", "grade", "percentile"]) {
    assert.ok(
      !new RegExp(`\\b${word}`, "i").test(visible),
      `the panel must not use the word "${word}"`,
    );
  }
});

/* ================================================================================================
   PROMOTENOTICE — F-014, PR #17 review, blocker 2: the web operator sees the CLI's own caveat.

   `promoteRoute.seam.test.ts` proves the byte leaves POST /promote's Location header, survives
   a redirect, and arrives back here as the argument that makes THIS function print the string —
   that chain needs a live server and is what a seam test is for. What it is not a substitute for
   is the renderer's own contract in isolation: does `renderReviewPage` print the notice in BOTH
   branches (empty queue and populated), does it escape the value, does it carry the right
   `data-` attribute, and does omitting the argument entirely still mean silence. Those are
   answered here, at the unit level, with no server involved.
   ============================================================================================= */

test("PromoteNotice renders in the POPULATED queue: plain words, the right attribute, a status role", () => {
  const html = renderReviewPage(okHarvest(queue), null, null, "unbound-legacy");
  assert.match(html, /data-promote-notice="unbound-legacy"/);
  assert.match(text(html), /Unbound document — binding not checked/);
  // `role="status"`, never `role="alert"`: nothing failed — a promotion just wrote successfully
  // without a binding to check, which is a caveat, not an error.
  assert.match(html, /role="status"/);
  // The queue itself still renders beneath the notice — a caveat is not a dead end.
  assert.ok(html.includes("git-cluster:feat"), "the queue must still render beneath the notice");
});

test("PromoteNotice renders in the EMPTY queue too — a caveat about what just happened must survive an otherwise-empty state", () => {
  const html = renderReviewPage(okHarvest(harvestFrom({ candidates: [] })), null, null, "unbound-legacy");
  assert.match(html, /data-promote-notice="unbound-legacy"/);
  assert.match(text(html), /Unbound document — binding not checked/);
  // The empty-queue plate is unaffected — the notice is additive, not a replacement for it.
  assert.match(text(html), /Nothing to review/i);
});

test("no PromoteNotice argument renders no notice at all — the default is silence, not the caveat", () => {
  const html = renderReviewPage(okHarvest(queue));
  assert.ok(!html.includes("data-promote-notice"), "omitting the argument must not print anything");
  assert.ok(!text(html).includes("Unbound document"));
});

test("PromoteNotice's value reaches the page through the same esc() every other attribute here uses", () => {
  // There is exactly one legal value today (`"unbound-legacy"`, the only member of the
  // `PromoteNotice` type) so this cannot pin an escaped SPECIAL CHARACTER the way a free-text
  // field would. What it pins instead is that the attribute is written as `esc(promoteNotice)`,
  // not the bare literal — reading `render.ts` confirms it is the identical call
  // `data-refusal="${esc(refusal.cause)}"` uses two lines above it, so a future second value
  // added to the union inherits the escaping rather than needing it added by hand.
  const html = renderReviewPage(okHarvest(queue), null, null, "unbound-legacy");
  assert.match(html, /data-promote-notice="unbound-legacy"/);
});

test("PromoteNotice and a decision refusal are DISTINCT banners, never one collapsing into the other", () => {
  // The two arrive over different routes (a POST /review refusal vs. a POST /promote redirect)
  // and would not realistically both be true of one request in this product, but the renderer is
  // total over both arguments regardless, and a reviewer must be able to tell "your rejection
  // needed a reason" apart from "the promotion you just ran was unbound" — different roles, so
  // assistive tech does not read a caveat as a failure or a failure as a caveat.
  const both = renderReviewPage(
    okHarvest(queue),
    { cause: "missing-reviewer", id: "git-cluster:feat" },
    null,
    "unbound-legacy",
  );
  assert.match(both, /role="alert"/);
  assert.match(both, /role="status"/);
  assert.match(both, /data-refusal="missing-reviewer"/);
  assert.match(both, /data-promote-notice="unbound-legacy"/);
  const refusalIdx = both.indexOf('role="alert"');
  const noticeIdx = both.indexOf('role="status"');
  assert.ok(
    refusalIdx !== -1 && noticeIdx !== -1 && refusalIdx < noticeIdx,
    "the decision-refusal banner (about the POST that reached this exact page) precedes the promote notice",
  );
});

/* ================================================================================================
   DENSITY — the surface carries the fact; the drawer carries the reason
   ============================================================================================= */

/**
 * Words a reader SEES with nothing opened. A closed `<details>` is in the document and not on the
 * page, so its body is removed and its `<summary>` — which is on the page — is kept. That
 * distinction is the entire point of the disclosure, so the measurement has to make it.
 */
function visibleWords(html: string): number {
  const shown = html
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<details class="review-candidate-disclosure"[^>]*>([\s\S]*?<\/summary>)[\s\S]*?<\/details>/gi, "$1")
    .replace(/<div class="leaf-more-body">[\s\S]*?<\/div>\n<\/details>/gi, "</details>");
  const t = text(shown).trim();
  return t.length === 0 ? 0 : t.split(" ").length;
}

/** Everything in the served bytes, opened drawers included — nothing relocated may be missing. */
function documentWords(html: string): number {
  const t = text(html.replace(/<svg[\s\S]*?<\/svg>/gi, " ")).trim();
  return t.length === 0 ? 0 : t.split(" ").length;
}

/**
 * THE MEASUREMENT, PINNED, because a density pass that is not measured grows back.
 *
 * The owner's complaint was that every surface described itself: `GET /` on a real 57-leaflet
 * document carried 4,006 visible words and 184 sentences longer than eight words. The cause was
 * this repository's COMMENT discipline — say WHY, name the trap — applied to rendered HTML, where
 * a reader needs the fact and not the reasoning.
 *
 * The budgets below are CEILINGS ON FOLIAGE'S OWN VOICE, not on the page. A leaflet row's title,
 * its refs and its exclusion reason are the subject's evidence and scale with the document; they
 * are exempt, because cutting them would falsify the thing the page exists to carry. What is
 * capped is the chrome around them, which does not scale with anything.
 *
 * The numbers are deliberately loose — roughly twice what the surfaces measure today. A test that
 * pins the exact count fails on every wording change and gets deleted; one that catches a
 * paragraph coming back does not.
 */
test("DENSITY — no surface explains itself at a reader, measured", () => {
  const cases: readonly [string, string, number][] = [
    // `populated` is 5 leaflets: 2 verified rows, a pending, two excluded with reasons.
    ["/ (5 leaflets)", renderLeafPage(okLoad(populated)), 260],
    ["/ (empty leaf)", renderLeafPage(okLoad(empty)), 130],
    [
      "/leaflet/<id>",
      renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource),
      90,
    ],
    [
      "/leaflet refusal",
      renderLeafletPage({ ok: false, cause: "not-shareable", requestedId: "x" }, ordinarySource),
      70,
    ],
    // 260 -> 285: the "no authentication" caveat gained one mitigation sentence naming the real
    // posture (loopback-only bind, local access trusted today, accounts are a hosted-canopy
    // concern) — a deliberate content addition to a MUST-STAY-ON-THE-SURFACE claim, not density
    // drift. +25 words on both /review cases below, measured, not guessed.
    // 285 -> 286, 132 -> 133: the studio nav gained its seventh item, "Photosynthesis" — one word, on
    // every owner page, and both /review cases sat exactly at their ceiling. Measured: 286 / 133.
    // The connected Workflow adds one navigation label; body copy is unchanged.
    ["/review (3 candidates)", renderReviewPage(okHarvest(queue)), 287],
    // An empty queue is the density rule's EXCEPTION: nothing else is on the screen and the
    // operator is stuck, so it may spend a full sentence and the command that fixes it — which is
    // long, and is a command rather than prose. It still carries the queue's own two must-stay
    // sentences above it, so its budget is not smaller than a populated surface's chrome.
    // 120 -> 132: the SAME +25-word mitigation sentence above — it is part of the intro every
    // /review render carries, not conditional on the queue having candidates.
    ["/review (empty queue)", renderReviewPage(okHarvest(harvestFrom({ candidates: [] }))), 134],
  ];

  const report: string[] = [];
  for (const [name, html, budget] of cases) {
    const visible = visibleWords(html);
    report.push(`${name}: ${visible} visible / ${documentWords(html)} in the document`);
    assert.ok(
      visible <= budget,
      `${name} shows ${visible} words with nothing opened; the budget is ${budget}. ` +
        `A paragraph has come back — move the reasoning into a disclosure, not out of the product.`,
    );
  }
  console.log(`  ${report.join("\n  ")}`);
});

/**
 * A LONG SENTENCE IS THE SYMPTOM. 187 of them over eight words was the original measurement, and
 * they were all in Foliage's own voice. The subject's evidence is exempt for the same reason as
 * above and is stripped by the regions that mark it, which is what those markers are for.
 */
test("DENSITY — the chrome is labels and short sentences, never paragraphs", () => {
  // A BLOCK BOUNDARY IS A SENTENCE BOUNDARY, and forgetting that made this test lie on its first
  // run: a dense page is mostly LABELS, which carry no terminal punctuation, so splitting on
  // `[.!?]` alone glued "Attribution", three count cells and two summaries into one 68-word
  // "sentence" and reported the fix as the failure. The pipe is inserted where the markup already
  // says the reading breaks.
  // The block sentinel is built from its code point rather than typed: an invisible control
  // character in a source file is a thing the next reader deletes by accident.
  const BREAK = String.fromCharCode(1);
  const BLOCK = /<\/?(?:p|div|li|ul|dl|dt|dd|section|article|aside|header|footer|h[1-6]|summary|details|form|label|br|time|span|b|strong)\b[^>]*>/gi;
  const chrome = (html: string): string =>
    text(
      html
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<div class="leaf-more-body">[\s\S]*?<\/div>\n<\/details>/gi, "</details>")
        .replace(/<[a-z0-9]+[^>]*\sdata-(?:verbatim|authored)="[^"]*"[^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, " ")
        .replace(/<p class="leaf-reason">[\s\S]*?<\/p>/gi, " ")
        .replace(/<[a-z0-9]+[^>]*class="[^"]*\bfol-metric\b[^"]*"[^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, " ")
        .replace(BLOCK, ` ${BREAK} `),
    );

  for (const [name, html] of [
    ["/", renderLeafPage(okLoad(populated))],
    ["/leaflet/<id>", renderLeafletPage(findLeaflet(compound, "shared-one"), ordinarySource)],
    ["/review", renderReviewPage(okHarvest(queue))],
  ] as const) {
    const longest = chrome(html)
      .split(BREAK)
      .flatMap((block) => block.split(/(?<=[.!?])\s+/))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.split(/\s+/).length);
    const over = longest.filter((n) => n > 26);
    assert.deepEqual(
      over,
      [],
      `${name}: Foliage's own voice contains a ${over[0]}-word sentence. A sentence, not a ` +
        `paragraph — and the argument for it belongs in a disclosure or in docs.`,
    );
  }
});

/**
 * WHAT MAY NEVER GO BEHIND A DISCLOSURE — the half of this lane that must not be got wrong.
 *
 * `<details>` is closed by default, so relocating a statement into one is deletion for any reader
 * who does not click. The test for whether a statement may move is: would a reasonable person be
 * MISLED by its absence? These five would be, so they are asserted to be OUTSIDE every `<details>`
 * on the page — not merely present in the bytes, which the drawer would also satisfy.
 */
test("HONESTY — the caveats that may not be relocated are on the surface, not in a drawer", () => {
  const beforeAnyDrawer = (html: string): string => {
    // Everything a `<details>` contains, removed. What remains is what a reader sees without
    // opening anything, which is the only place these statements count.
    const stripped = html.replace(/<details[\s\S]*?<\/details>/gi, " ");
    return text(stripped);
  };

  const exampleSource = sourceAt("/x.json", { declaredExample: true });
  const unsigned = leafFrom({
    id: "l",
    subject: "Unsigned Work",
    leaflets: [{ id: "a", title: "unsigned", tier: "pending", provenance: prov }],
  });

  const mustStay: readonly [string, string, RegExp][] = [
    // The fabrication band, on BOTH routes that can render an example document.
    ["/ band", beforeAnyDrawer(renderLeafPage(okLoad(populated, exampleSource))), /not real evidence/i],
    ["/ band signal", beforeAnyDrawer(renderLeafPage(okLoad(populated, exampleSource))), /declares "example": true/],
    [
      "/leaflet band",
      beforeAnyDrawer(renderLeafletPage(findLeaflet(compound, "shared-one"), exampleSource)),
      /not real evidence/i,
    ],
    // The example-document marker on the artifact itself — the tier is shown and the claim about
    // a person is withdrawn, in the same breath, on the surface.
    [
      "/leaflet example standing",
      beforeAnyDrawer(renderLeafletPage(findLeaflet(compound, "shared-one"), exampleSource)),
      /Nothing is claimed here about anyone/i,
    ],
    // 0 verified is the number a reader takes for a malfunction.
    ["/ zero verified", beforeAnyDrawer(renderLeafPage(okLoad(unsigned))), /correct result, not a fault/i],
    // A pending artifact is not an outward claim, and the page says so where it is read.
    [
      "/leaflet own accounting",
      beforeAnyDrawer(renderLeafletPage(findLeaflet(compound, "secret-pending-id"), ordinarySource)),
      /not an outward claim/i,
    ],
    // The queue is unauthenticated and approving is not publishing. A reviewer reads the caption
    // above the button, never the drawer beside it.
    ["/review no auth", beforeAnyDrawer(renderReviewPage(okHarvest(queue))), /no sign-in/i],
    // THE MITIGATION rides beside the warning it scopes, not behind it — a caveat that softens
    // an alarming claim is exactly as load-bearing as the claim itself, and hiding it would read
    // as MORE alarmist than the honest picture, not less.
    [
      "/review no-auth mitigation",
      beforeAnyDrawer(renderReviewPage(okHarvest(queue))),
      /local access by default/i,
    ],
    [
      "/review no-auth scope is local",
      beforeAnyDrawer(renderReviewPage(okHarvest(queue))),
      /local access/i,
    ],
    ["/review not publishing", beforeAnyDrawer(renderReviewPage(okHarvest(queue))), /does not publish/i],
    [
      "/promote not publishing",
      beforeAnyDrawer(renderReviewPage(okHarvest(promotable), null, emptyLeaf)),
      /does not publish anything and does not verify anything/i,
    ],
  ];

  for (const [what, visible, wording] of mustStay) {
    assert.match(
      visible,
      wording,
      `${what}: this statement is only in a <details>, which is closed by default. ` +
        `Relocating a caveat into a drawer is deleting it for every reader who does not click.`,
    );
  }
});

/* ==========================================================================================
   THE AUTHORED HEADLINE (DT-1) — when the subject wrote a line, the page opens in their
   voice and says WHOSE voice it is; when they did not, the derived lede stands and no
   placeholder invites one.
   ========================================================================================== */

test("an authored headline replaces the derived lede and is marked as the subject's words", () => {
  const withHeadline = leafFrom({
    id: "leaf-under-test",
    subject: "Render Input",
    headline: "Evidence-backed attribution, built in the open.",
    leaflets: [{ id: "a", title: "first verified", tier: "verified", provenance: prov }],
  });
  for (const audience of ["published", "private"] as const) {
    const html = renderLeafPage(okLoad(withHeadline), audience);
    assert.ok(
      html.includes('data-authored="subject"'),
      `${audience}: the headline must carry data-authored — the page says whose words open it`,
    );
    assert.ok(html.includes("Evidence-backed attribution, built in the open."));
    assert.ok(
      !html.includes('class="leaf-lede"') || html.includes('class="leaf-lede leaf-headline"'),
      `${audience}: no derived lede competes with the subject's own words`,
    );
  }
});

test("without a headline no lede is written and nothing invites one", () => {
  const html = renderLeafPage(okLoad(populated));
  assert.ok(!html.includes('class="leaf-lede"'), "no derived lede: the page does not describe itself");
  assert.ok(
    !html.includes('data-authored="subject"'),
    "no subject-authored marker without subject-authored words",
  );
  assert.ok(!/add a headline|write a headline/i.test(html), "no placeholder nagging");
});

/*
 * THE ONE QUEUE ON /review. Synthetic drafts with synthetic author dates: the page lists every
 * open candidate in queue order under its true count, and decided work only inside Decided.
 */
const hexRef = (n: number): string => n.toString(16).padStart(40, "0");
function orderedQueue(open: number, decided = 2): HarvestDocument {
  return harvestFrom({
    subject: "Render Input",
    leafId: "leaf-under-test",
    candidates: [
      ...Array.from({ length: open }, (_, i) => ({
        id: `git-cluster:p${i}`,
        title: `synthetic draft ${i}`,
        evidence: [{ source: "git", ref: hexRef(i + 1), observedAt: "2026-09-01T00:00:00Z",
          ...(i % 7 === 3 ? {} : { authoredAt: `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z` }) }],
        extractor: "git-cluster",
        draftedAt: "2026-09-01T00:00:00Z",
        review: { state: "candidate" },
      })),
      ...Array.from({ length: decided }, (_, i) => ({
        id: `git-cluster:decided${i}`,
        title: `synthetic decided ${i}`,
        evidence: [{ source: "git", ref: hexRef(1000 + i), observedAt: "2026-09-01T00:00:00Z", authoredAt: "2026-09-20T00:00:00Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-09-01T00:00:00Z",
        review: { state: "approved", by: "Synthetic Reviewer", at: `2026-09-1${i}T00:00:00Z` },
      })),
    ],
  });
}
const openIds = (html: string): string[] => {
  const start = html.indexOf('<ul class="review-list leaf-list" data-review-open>');
  if (start < 0) return [];
  const decided = html.indexOf('<details class="review-decided"', start);
  const sectionEnd = html.indexOf("</section>", start);
  const list = html.slice(start, decided < 0 ? sectionEnd : decided);
  return [...list.matchAll(/<li id="candidate-([^"]+)"/g)].map((m) => m[1]!);
};
const decidedIds = (html: string): string[] => {
  // Everything after the Decided section opens; candidate cards nest their own <details>.
  const at = html.indexOf('<details class="review-decided"');
  const details = at < 0 ? "" : html.slice(at);
  return [...details.matchAll(/<li id="candidate-([^"]+)"/g)].map((m) => m[1]!);
};

test("/review lists every open candidate, newest author date first and undated last, under its true count (D2)", () => {
  const harvest = orderedQueue(30);
  const html = renderReviewPage(okHarvest(harvest));
  const ids = openIds(html);
  assert.equal(ids.length, 30, "all thirty, not a preview of three");
  assert.match(html, /<h2 id="review-queue-h"><span class="fol-metric">30<\/span> to review<\/h2>/);
  const dated = (id: string) => harvest.candidates.find((c) => c.id === id)!.evidence[0]!.authoredAt;
  const times = ids.map((id) => dated(id));
  const firstUndated = times.findIndex((t) => t === undefined);
  assert.ok(firstUndated > 0, "the fixture holds dated and undated drafts");
  assert.ok(times.slice(firstUndated).every((t) => t === undefined), "undated work sits last");
  const datedTimes = times.slice(0, firstUndated).map((t) => Date.parse(t!));
  assert.deepEqual(datedTimes, [...datedTimes].sort((a, b) => b - a), "newest author date first");
});

test("a large review queue remains compact while every draft keeps its evidence and decision controls", () => {
  const html = renderReviewPage(okHarvest(orderedQueue(200, 0)));
  assert.equal(openIds(html).length, 200, "the compact view must not silently omit drafts");
  assert.equal((/<ul class="review-list leaf-list" data-review-open>([\s\S]*?)<\/ul>/.exec(html)?.[1]?.match(/<li id="candidate-/g) ?? []).length, 20);
  assert.equal((html.match(/<details class="review-more" data-review-more>/g) ?? []).length, 9, "older drafts sit in bounded native disclosures");
  assert.equal((html.match(/<details class="review-candidate-disclosure">/g) ?? []).length, 199);
  assert.equal((html.match(/<details class="review-candidate-disclosure" open>/g) ?? []).length, 1,
    "the next draft is open for a decision while older drafts stay compact");
  assert.equal((html.match(/<button(?=[^>]*name="decision")(?=[^>]*value="approve")[^>]*>/g) ?? []).length, 200);
  assert.equal((html.match(/class="leaf-prov"/g) ?? []).length, 200, "evidence is still inspectable");
});

test("Review rows lead with the draft, keep exact evidence in disclosures, and retain every decision field", () => {
  const harvest = orderedQueue(1, 0);
  const candidate = harvest.candidates[0]!;
  const fullRef = candidate.evidence[0]!.ref;
  const html = renderReviewPage(okHarvest(harvest));
  const summary = /<summary class="review-candidate-summary">([\s\S]*?)<\/summary>/.exec(html)?.[1];
  assert.ok(summary);
  assert.match(summary, /Drafted from Git · <span class="fol-metric">1<\/span> commit/);
  assert.match(summary, /data-review-pill="candidate">Unreviewed<\/span>/);
  assert.doesNotMatch(summary, new RegExp(fullRef), "the full reference does not compete with the title");
  assert.match(html, /<details class="review-technical"><summary>Technical details<\/summary>/);
  assert.match(html, new RegExp(`<span title="${fullRef}">${fullRef.slice(0, 7)}<\\/span><details class="review-full-ref"><summary>Full reference<\\/summary><code class="fol-metric">${fullRef}<\\/code>`));
  assert.match(html, /<time datetime="2026-09-01T00:00:00Z">1 Sept 2026<\/time>/);
  assert.match(html, /<details class="review-title-edit"><summary>Edit title<\/summary>/);
  for (const field of ['name="by"', 'name="reason"', 'name="title"', 'value="approve"', 'value="reject"']) assert.ok(html.includes(field));

  const kept = renderReviewPage(okHarvest(harvest), { cause: "missing-reason", id: candidate.id }, null, null,
    { id: candidate.id, by: "Alex", reason: "Needs evidence", title: "Revised title" });
  assert.match(kept, /<details class="review-title-edit" open><summary>Edit title<\/summary>/);
  assert.match(kept, /value="Revised title"/);
});

test("Review shows when a git ref was authored beside when it was observed, and only when git gave a date", () => {
  const harvest = harvestFrom({
    candidates: [{
      id: "git-cluster:dates",
      title: "synthetic dated draft",
      evidence: [
        { source: "git", ref: hexRef(1), observedAt: "2026-10-08T03:27:21Z", authoredAt: "2026-09-28T23:42:26-06:00" },
        { source: "git", ref: hexRef(2), observedAt: "2026-10-08T03:27:21Z" },
        { source: "synthetic-export", ref: "export-1", observedAt: "2026-10-08T03:27:21Z", authoredAt: "2026-09-01T00:00:00Z" },
      ],
      extractor: "git-cluster",
      draftedAt: "2026-10-08T03:27:21Z",
      review: { state: "candidate" },
    }],
  });
  const rows = [...renderReviewPage(okHarvest(harvest)).matchAll(/<dl class="leaf-prov">[\s\S]*?<\/dl>/g)].map((m) => m[0]);
  assert.equal(rows.length, 3);
  // Days are UTC, like Observed beside it; the exact instant, with the author's offset, stays on the element.
  assert.match(rows[0]!, /<div class="review-ref-authored"><dt class="fol-label">Authored<\/dt><dd class="fol-metric"><time datetime="2026-09-28T23:42:26-06:00" title="2026-09-28T23:42:26-06:00">29 Sept 2026<\/time><\/dd><\/div>/);
  // Git's author date, so never labelled a commit date: a rebased commit was committed later.
  assert.doesNotMatch(rows[0]!, /Committed/i);
  assert.ok(rows[0]!.indexOf(">Authored<") < rows[0]!.indexOf(">Observed<"), "the two clocks sit side by side, authorship first");
  assert.match(rows[0]!, /<time datetime="2026-10-08T03:27:21Z">8 Oct 2026<\/time>/, "Observed is unchanged");
  assert.doesNotMatch(rows[1]!, /Authored/, "an undated ref shows no author date, not a guessed one");
  assert.doesNotMatch(rows[2]!, /Authored/, "only git's author date is shown");
});

test("Garden's author-date line wraps inside the nowrap Observed cell instead of widening the table", () => {
  // `.fol-table td.fol-metric` is nowrap. Inheriting it, "Authored Aug 29 – Oct 7, 2026" set the
  // Observed column's minimum width, and at 641–930px the table scrolled and clipped the date it sorts by.
  const rule = /\.garden-authored\s*\{([^}]*)\}/.exec(leafCssSource)?.[1] ?? "";
  assert.match(rule, /white-space:\s*normal/);
});

test("Review names cited references without a placeholder plural", () => {
  const html = renderReviewPage(okHarvest(queue));
  assert.match(html, /Evidence · 1 reference/);
  assert.match(html, /Evidence · 2 references/);
  assert.doesNotMatch(html, /ref\(s\)|1 evidence refs/);
});

test("Review finds a later draft without changing the queue count or its decision controls", () => {
  const harvest = orderedQueue(200);
  const found = renderReviewPage(okHarvest(harvest), null, null, null, null, undefined, "synthetic draft 199");
  assert.match(found, /<h2 id="review-queue-h"><span class="fol-metric">200<\/span> to review<\/h2>/);
  assert.match(found, /<span class="fol-metric">1<\/span> match<\/p>/);
  assert.deepEqual(openIds(found), ["git-cluster:p199"]);
  assert.equal((found.match(/<button(?=[^>]*name="decision")(?=[^>]*value="approve")[^>]*>/g) ?? []).length, 1);
  assert.equal((found.match(/class="leaf-prov"/g) ?? []).length, 1);
  assert.match(found, /name="q"[^>]*value="synthetic draft 199"/);
  assert.match(found, /<input type="hidden" name="q" value="synthetic draft 199">/, "the decision carries its find context");
  assert.deepEqual(openIds(renderReviewPage(okHarvest(harvest), null, null, null, null, undefined, "git-cluster:p199")), ["git-cluster:p199"], "a displayed draft ID is searchable too");
  assert.deepEqual(openIds(renderReviewPage(okHarvest(harvest), null, null, null, null, undefined, hexRef(200))), ["git-cluster:p199"], "a displayed evidence reference is searchable too");
  const decided = renderReviewPage(okHarvest(harvest), null, null, null, null, undefined, "synthetic decided 1");
  assert.deepEqual(openIds(decided), []);
  assert.deepEqual(decidedIds(decided), ["git-cluster:decided1"]);
  assert.match(decided, /<details class="review-decided" data-review-decided open>/);
  const absent = renderReviewPage(okHarvest(harvest), null, null, null, null, undefined, "nothing here");
  assert.match(absent, /<span class="fol-metric">0<\/span> matches · <a href="\/review">Clear search<\/a>/);
  assert.deepEqual(openIds(absent), []);
});

test("a refused decision reopens and focuses its draft with the owner's input intact", () => {
  const harvest = orderedQueue(3);
  const draft = { id: "git-cluster:p1", by: "Alex", reason: "Needs more evidence", title: "Revised title" };
  const html = renderReviewPage(okHarvest(harvest), { cause: "missing-reason", id: draft.id }, null, null, draft);
  const card = html.slice(html.indexOf('id="candidate-git-cluster:p1"'));
  assert.match(html, /id="review-refusal"[^>]*role="alert"/);
  assert.match(html, /href="#candidate-git-cluster%3Ap1"/);
  assert.match(card, /<details class="review-candidate-disclosure" open>/);
  assert.match(card, /<summary class="review-candidate-summary" autofocus aria-describedby="review-refusal">/);
  assert.match(card, /<p class="review-inline-error">Reason required to reject this draft\.<\/p>/, "the error stays visible beside the focused draft");
  assert.match(card, /value="Alex"/);
  assert.match(card, /value="Needs more evidence"/);
  assert.match(card, /value="Revised title"/);
  assert.equal((html.match(/<summary class="review-candidate-summary" autofocus/g) ?? []).length, 1);

  const paused = renderReviewPage(okHarvest(harvest), { cause: "document-busy", id: draft.id }, null, null, draft, {
    marks: new Map(), retry: new Set(), paused: true,
  });
  assert.match(paused, /id="candidate-git-cluster:p1"[^>]*>[\s\S]*?<details class="review-candidate-disclosure" open>/);
  assert.match(paused, /data-queue-paused>Paused <span class="fol-metric">2<\/span>/);
  const stoppedOwner = renderReviewPage(okHarvest(harvest), {
    cause: "document-busy", id: draft.id, detail: "Stopped owner; clear <harvest.lock>",
  }, null, null, draft);
  assert.match(stoppedOwner, /Stopped owner; clear &lt;harvest\.lock&gt;/);
  assert.doesNotMatch(stoppedOwner, /clear <harvest\.lock>/);

  const many = orderedQueue(50, 0);
  const laterId = openIds(renderReviewPage(okHarvest(many))).at(-1)!;
  const laterDraft = { id: laterId, by: "Alex", reason: "Needs more evidence", title: "Revised title" };
  const later = renderReviewPage(okHarvest(many), { cause: "missing-reason", id: laterDraft.id }, null, null, laterDraft);
  assert.match(later, new RegExp(`<details class="review-more" data-review-more open>[\\s\\S]*?id="candidate-${laterId}"[^>]*>[\\s\\S]*?<details class="review-candidate-disclosure" open>`));
  assert.equal((later.match(/<details class="review-more" data-review-more open>/g) ?? []).length, 1);

  const decided = renderReviewPage(okHarvest(harvest), { cause: "already-decided", id: "git-cluster:decided0", state: harvest.candidates.at(-2)!.review });
  assert.match(decided, /<details class="review-decided" data-review-decided open>/);
  assert.match(decided, /id="candidate-git-cluster:decided0"[^>]*>[\s\S]*?<details class="review-candidate-disclosure" open>/);
});

test("decided candidates appear only inside the collapsed Decided section, newest decision first (D9)", () => {
  const html = renderReviewPage(okHarvest(orderedQueue(3)));
  assert.deepEqual(decidedIds(html), ["git-cluster:decided1", "git-cluster:decided0"]);
  assert.ok(!openIds(html).some((id) => id.includes("decided")));
  assert.match(html, /<summary>Decided \(<span class="fol-metric">2<\/span>\)<\/summary>/);
  assert.doesNotMatch(html, /<details class="review-decided"[^>]*\bopen\b/, "collapsed by default");
});

test("marks place rows keep, open, pass; a paused collection hides its undecided drafts behind a count", () => {
  const harvest = orderedQueue(4, 0);
  const marks = new Map<string, JevMark>([["git-cluster:p0", "pass"], ["git-cluster:p3", "keep"]]);
  const ids = openIds(renderReviewPage(okHarvest(harvest), null, null, null, null, { marks, retry: new Set(), paused: false }));
  assert.equal(ids[0], "git-cluster:p3");
  assert.equal(ids.at(-1), "git-cluster:p0");
  const paused = renderReviewPage(okHarvest(harvest), null, null, null, null, { marks: new Map(), retry: new Set(), paused: true });
  assert.deepEqual(openIds(paused), []);
  assert.match(paused, /data-queue-paused>Paused <span class="fol-metric">4<\/span>/);
  assert.doesNotMatch(renderReviewPage(okHarvest(harvest)), /data-queue-paused/);
});

test("CONTROL: the queue order and Jev's marks never reach the leaf, the public pages or what promotion writes", () => {
  // The order and the marks are private working state for the owner. Rendering /review under any
  // view must not change a byte of anything an employer can see, including by mutating the
  // harvest it read: promotion after the review renders must write exactly what it wrote before.
  const harvest = orderedQueue(6);
  const target = leafFrom({ id: "leaf-under-test", subject: "Render Input", leaflets: [] });
  const outward = () => {
    const promoted = promoteApproved(harvest, target);
    assert.ok(promoted.ok);
    const load = okLoad(promoted.leaf);
    return [
      JSON.stringify(promoted.leaf),
      renderLeafPage(load, "published"),
      renderLeafPage(load, "private"),
      ...promoted.leaf.leaflets.map((l) => renderLeafletPage(findLeaflet(promoted.leaf, String(l.id)), ordinarySource)),
    ];
  };
  const before = outward();
  const views = [
    { marks: new Map<string, JevMark>(), retry: new Set<string>(), paused: false },
    { marks: new Map<string, JevMark>(harvest.candidates.map((c, i) => [c.id, (["keep", "pass", "unresolved"] as const)[i % 3]!])), retry: new Set(harvest.candidates.map((c) => String(c.id))), paused: false },
    { marks: new Map<string, JevMark>([["git-cluster:p5", "keep"]]), retry: new Set<string>(), paused: true },
  ];
  for (const view of views) renderReviewPage(okHarvest(harvest), null, null, null, null, view);
  assert.deepEqual(outward(), before);
  for (const page of before) {
    assert.doesNotMatch(page, /to review|data-queue|Paused|Decided \(|data-jev-mark|jev-run|\/workflow\/jev/, "no queue or Jev vocabulary on an outward page");
  }
});

test("Jev's marks read Keep and Pass on open rows only; keep rises, pass sinks, and nothing moves to Decided", () => {
  const harvest = orderedQueue(6);
  const marks = new Map<string, JevMark>([
    ["git-cluster:p0", "keep"], ["git-cluster:p1", "pass"], ["git-cluster:p2", "unresolved"],
    ["git-cluster:p4", "keep"], ["git-cluster:p5", "pass"], ["git-cluster:decided0", "keep"],
  ]);
  const html = renderReviewPage(okHarvest(harvest), null, null, null, null, { marks, retry: new Set(), paused: false });
  const ids = openIds(html);
  const plain = openIds(renderReviewPage(okHarvest(harvest)));
  const rank = (id: string) => ({ keep: 0, pass: 2 } as Record<string, number>)[marks.get(id) ?? ""] ?? 1;
  assert.deepEqual(ids, [...plain].sort((a, b) => rank(a) - rank(b)), "keep, then unmarked and unsure, then pass; each group in work-date order");
  assert.deepEqual(ids.slice(0, 2).sort(), ["git-cluster:p0", "git-cluster:p4"]);
  assert.deepEqual(ids.slice(-2).sort(), ["git-cluster:p1", "git-cluster:p5"]);
  assert.deepEqual(decidedIds(html), decidedIds(renderReviewPage(okHarvest(harvest))), "a mark never moves a row to Decided");
  const label = (id: string) => /data-jev-mark="(\w+)">(\w+)</.exec(html.slice(html.indexOf(`<li id="candidate-${id}"`)).split("</li>")[0]!)?.slice(1);
  assert.deepEqual(label("git-cluster:p0"), ["keep", "Keep"]);
  assert.deepEqual(label("git-cluster:p1"), ["pass", "Pass"]);
  assert.equal(label("git-cluster:p2"), undefined, "unsure carries no label");
  assert.equal(label("git-cluster:p3"), undefined, "unchecked carries no label");
  assert.equal(label("git-cluster:decided0"), undefined, "a decided row carries no mark");
  assert.doesNotMatch(renderReviewPage(okHarvest(harvest)), /data-jev-mark/, "labels come only from marks");
  assert.doesNotMatch(html, /data-jev-mark="[^"]*">[^<]*\d/, "a label is a word, never a number");
});

test("a Retry form appears only on an open row whose Jev check was interrupted or failed, and it checks, never decides", () => {
  const harvest = orderedQueue(3);
  const retry = new Set(["git-cluster:p1", "git-cluster:decided0"]);
  const html = renderReviewPage(okHarvest(harvest), null, null, null, null, { marks: new Map(), retry, paused: false });
  const forms = [...html.matchAll(/<form class="review-form" method="post" action="\/workflow\/jev">([\s\S]*?)<\/form>/g)].map((m) => m[1]!);
  assert.equal(forms.length, 1);
  assert.match(forms[0]!, /name="action" value="jev-run"/);
  assert.match(forms[0]!, /name="candidate" value="git-cluster:p1"/);
  assert.match(forms[0]!, /<button\b[^>]*data-slot="button"[^>]*data-variant="outline"[^>]*type="submit">Retry<\/button>/, "the shared outline button");
  assert.doesNotMatch(forms[0]!, /approve|reject|decision/i);
  assert.doesNotMatch(renderReviewPage(okHarvest(harvest)), /\/workflow\/jev/);
});

/* ================================================================================================
   SEE THE WORK BEFORE DECIDING — one cited source leads the decision; the remaining evidence stays
   available without burying the action. The reviewer is remembered and the result names its destination.
   ============================================================================================= */

/** One open draft citing five commits, beside one decided earlier and one decided later. */
function wideQueue(opts: { readonly decided?: boolean; readonly subject?: string } = {}): HarvestDocument {
  const decided = opts.decided ?? true;
  return harvestFrom({
    ...(opts.subject === undefined ? {} : { subject: opts.subject, leafId: "leaf-under-test" }),
    candidates: [
      {
        id: "git-cluster:wide",
        title: "feat: five commits",
        evidence: Array.from({ length: 5 }, (_, i) => ({ source: "git", ref: hexRef(500 + i), observedAt: "2026-09-01T00:00:00Z", excerpt: `commit ${i}` })),
        extractor: "git-cluster",
        draftedAt: "2026-09-01T00:00:00Z",
        review: { state: "candidate" },
      },
      ...(decided
        ? [
            {
              id: "git-cluster:later",
              title: "fix: decided later",
              evidence: [{ source: "git", ref: hexRef(600), observedAt: "2026-09-01T00:00:00Z" }],
              extractor: "git-cluster",
              draftedAt: "2026-09-01T00:00:00Z",
              review: { state: "approved", by: "Most Recent Reviewer", at: "2026-09-12T00:00:00Z" },
            },
            {
              id: "git-cluster:earlier",
              title: "docs: decided earlier",
              evidence: [{ source: "git", ref: hexRef(601), observedAt: "2026-09-01T00:00:00Z" }],
              extractor: "git-cluster",
              draftedAt: "2026-09-01T00:00:00Z",
              review: { state: "rejected", by: "Earlier Reviewer", at: "2026-09-10T00:00:00Z", reason: "not work" },
            },
          ]
        : []),
    ],
  });
}
/** One card's markup. These fixtures carry no media or pack lists, so a card holds no inner `<li>`. */
const cardOf = (html: string, id: string): string => html.slice(html.indexOf(`<li id="candidate-${id}"`)).split("</li>")[0]!;

test("an opened draft shows its first cited source before the decision, then the remaining evidence", () => {
  const html = renderReviewPage(okHarvest(wideQueue()));
  const card = cardOf(html, "git-cluster:wide");
  const at = (needle: string) => {
    const i = card.indexOf(needle);
    assert.ok(i >= 0, `${needle} is in the card`);
    return i;
  };
  const summaryEnd = at("</summary>");
  const firstEvidence = at('class="review-evidence"');
  const firstSource = at("commit 0");
  const form = at('<form class="review-form"');
  // Every decision field still travels together, in the order the reviewer meets them.
  const fields = ['name="by"', 'name="reason"', "Edit title", "Added work stays pending; approval does not publish or verify", 'value="approve"', 'value="reject"'].map(at);
  assert.deepEqual(fields, [...fields].sort((a, b) => a - b), "Reviewer, Reason, Edit title, consequence, Approve, Reject");
  const formEnd = card.indexOf("</form>", form);
  assert.ok(summaryEnd < firstEvidence && firstEvidence < firstSource && firstSource < form,
    "the first cited source is visible before the decision");
  assert.ok(fields.every((i) => i < formEnd), "...and every field is inside it");
  assert.ok(formEnd < at('class="review-evidence review-evidence-continuation"') &&
    at("commit 1") < at("Technical details") && at("Technical details") < at("Inspect"),
  "remaining sources follow the decision; technical details stay secondary");

  // A decided draft also lets the owner read its cited work before the recorded decision.
  const decided = cardOf(html, "git-cluster:later");
  assert.ok(decided.indexOf('class="review-evidence"') < decided.indexOf('class="review-decision"'));
});

test("the first three references stay open and the rest sit under 'All N references', every one still rendered", () => {
  const card = cardOf(renderReviewPage(okHarvest(wideQueue())), "git-cluster:wide");
  assert.match(card, /Evidence · 5 references/);
  assert.match(card, /<details class="review-refs-more" data-review-refs-more><summary>All <span class="fol-metric">5<\/span> references<\/summary>/,
    "the remaining references sit in one native disclosure naming the full count");
  const folded = card.indexOf('<details class="review-refs-more"');
  const lead = card.slice(card.indexOf('class="review-evidence"'), folded);
  // Each row carries its own "Full reference" disclosure, so the fold is cut at the evidence's end.
  const more = card.slice(folded, card.indexOf('<p class="review-inspect">'));
  assert.equal((lead.match(/<dl class="leaf-prov">/g) ?? []).length, 3, "three references lead");
  assert.equal((more.match(/<dl class="leaf-prov">/g) ?? []).length, 2, "the other two are inside");
  for (let i = 0; i < 5; i++) assert.ok(card.includes(`commit ${i}`), `reference ${i} is still in the document`);
  assert.doesNotMatch(card, /<details class="review-refs-more"[^>]*\bopen\b/, "closed until asked for");

  // Three or fewer: nothing to fold, so no disclosure.
  assert.doesNotMatch(renderReviewPage(okHarvest(queue)), /review-refs-more/);
});

test("Reviewer starts as the most recent recorded reviewer, else the leaf's subject, and stays required and editable", () => {
  const reviewerOf = (html: string) => {
    const input = /<input(?=[^>]*name="by")[^>]*>/.exec(cardOf(html, "git-cluster:wide"))?.[0];
    assert.ok(input);
    assert.match(input, /\brequired\b/, "a prefill never makes the reviewer optional");
    assert.doesNotMatch(input, /\b(readonly|readOnly|disabled)\b/, "and it stays the person's to change");
    return /value="([^"]*)"/.exec(input)?.[1] ?? "";
  };
  const leaf: LeafIndex = { ok: true, ids: new Set(), path: "/tmp/leaf.json", subject: "Leaf Subject" };
  const broken: LeafIndex = { ok: false, detail: "the leaf could not be read" };

  assert.equal(reviewerOf(renderReviewPage(okHarvest(wideQueue()), null, leaf)), "Most Recent Reviewer",
    "the latest decision by time, not by position in the document");
  assert.equal(reviewerOf(renderReviewPage(okHarvest(wideQueue({ decided: false })), null, leaf)), "Leaf Subject");
  assert.equal(reviewerOf(renderReviewPage(okHarvest(wideQueue({ decided: false, subject: "Bound Subject" })), null, broken)), "Bound Subject",
    "an unreadable leaf falls back to the subject the harvest recorded for it");
  assert.equal(reviewerOf(renderReviewPage(okHarvest(wideQueue({ decided: false })), null, broken)), "",
    "no recorded name anywhere: an empty field, never a guess");

  // A refused POST keeps exactly what was typed, an empty reviewer included.
  const refused = renderReviewPage(okHarvest(wideQueue()), { cause: "missing-reviewer", id: "git-cluster:wide" }, leaf, null,
    { id: "git-cluster:wide", by: "", reason: "", title: "" });
  assert.equal(reviewerOf(refused), "");
  assert.match(text(refused), /Reviewer required for “feat: five commits”\./, "the banner names the draft by its title");
  assert.match(text(cardOf(refused, "git-cluster:wide")), /Reviewer required for this draft\./, "and the card says this draft");
});

test("the page after a decision names it and links the approved work still waiting for the record", () => {
  const leaf: LeafIndex = { ok: true, ids: new Set(), path: "/tmp/leaf.json", subject: "Leaf Subject" };
  const status = (html: string) => /<p id="review-status"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";

  const approved = renderReviewPage(okHarvest(promotable), null, leaf, null, null, undefined, "", "git-cluster:fix", "git-cluster:feat");
  const line = status(approved);
  assert.match(line, /class="review-status" role="status" data-review-decided="approved"/);
  assert.equal(text(line), "Approved: feat: 7 commits · 1 approved waiting to add to your record");
  assert.match(line, /<a href="#review-promote-h"><span class="fol-metric">1<\/span> approved waiting/);
  assert.match(approved, /<h2 id="review-promote-h">/, "the link has a panel to land on");
  assert.ok(approved.indexOf('id="review-status"') < approved.indexOf("<h1>Review queue</h1>"), "above the queue, where a refusal would be");
  assert.match(approved, /id="candidate-git-cluster:fix"[^>]*>[\s\S]*?<details class="review-candidate-disclosure" open>/, "the next draft is open");

  const rejected = status(renderReviewPage(okHarvest(promotable), null, leaf, null, null, undefined, "", null, "git-cluster:chore"));
  assert.equal(text(rejected), "Rejected: chore: 2 commits · 1 approved waiting to add to your record");

  // The count is the leaf's subtraction, read at render time: once the approved draft is in the
  // leaf, nothing is waiting and the line says only what was decided.
  const held: LeafIndex = { ...leaf, ids: new Set(["git-cluster:feat"]) };
  assert.equal(text(status(renderReviewPage(okHarvest(promotable), null, held, null, null, undefined, "", null, "git-cluster:feat"))), "Approved: feat: 7 commits");

  // Only a decision the document holds is named: an undecided or unknown id says nothing.
  for (const id of ["git-cluster:fix", "git-cluster:nope", null]) {
    assert.doesNotMatch(renderReviewPage(okHarvest(promotable), null, leaf, null, null, undefined, "", null, id), /id="review-status"/);
  }
  assert.ok(!/\d+(\.\d+)?\s?%|\bscore|\brank|\brating/i.test(text(line)), "a status line is not a score");
});

/*
 * NO LEAF READ, NO WAITING COUNT. Without the leaf's ids there is nothing to subtract, and the
 * panel the count links to can add nothing. Measured before: a leaf that failed validation turned
 * two drafts already in it into "2 approved waiting to add to your record", over a panel with no
 * button. The line names the decision alone, and the panel below still says why.
 */
test("the page after a decision states no waiting count when the leaf could not be read", () => {
  const status = (html: string) => /<p id="review-status"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
  for (const index of [{ ok: false, detail: "the leaf at /tmp/leaf.json could not be read (invalid)" } as const, null]) {
    const html = renderReviewPage(okHarvest(promotable), null, index, null, null, undefined, "", "git-cluster:fix", "git-cluster:feat");
    assert.equal(text(status(html)), "Approved: feat: 7 commits");
    assert.doesNotMatch(html, /approved waiting/);
    assert.match(html, /data-leaf-plate="promote-unavailable"/, "the panel still reports the leaf it could not read");
  }
});

test("the status line wraps a long unbroken drafted title instead of widening the page", () => {
  // Measured before: one git subject that was an unbroken path made /review 988px wide at 390px.
  const css = leafCssSource.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.review-status\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
