/**
 * THE INGEST LOADER AND THE PAGE IT PRODUCES — over real files on disk.
 *
 * Real temporary files, real permissions, real reads. Nothing here mocks `fs`: the failure modes
 * this module exists for are filesystem facts (a missing file, a mode-000 file, a truncated one),
 * and a mock proves that the code branches, not that the branch is the one the OS actually takes.
 *
 * TWO PROPERTIES ARE ASSERTED THROUGHOUT, and they are the ones that would be quietly lost:
 *
 *   THE SEVEN CAUSES STAY SEVEN, with seven statuses' worth of meaning behind five HTTP codes.
 *   Every one of them is driven here from a real file (or the absence of one), because the
 *   temptation on a public route is to answer 404 to everything and the cost is an operator who
 *   cannot tell an unconfigured canopy from a corrupted store.
 *
 *   NO SERVER PATH REACHES THE PAGE. The loader's `detail` names the exact file on purpose — it
 *   is for the log — and the renderer must never carry it. This is asserted for every failure
 *   state, because it is the kind of thing that gets added back by a well-meaning edit.
 */

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  PUBLISHED_ARTIFACT,
  PUBLISHED_ARTIFACT_VERSION,
} from "@foliage/canopy";

import {
  PUBLISHED_ENV,
  httpStatusForPublished,
  loadPublishedLeaf,
  publishedPath,
  publishedUrl,
} from "./publishedLeaf.ts";
import { publishedLeafletHref, renderPublishedLeafletPage, renderPublishedPage, withoutVerbatimRegions } from "./renderPublished.ts";

const INSTANT = "2026-08-13T09:41:00Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

const roots: string[] = [];
after(async () => {
  await Promise.all(
    roots.map(async (d) => {
      await chmod(d, 0o700).catch(() => {});
      await rm(d, { recursive: true, force: true });
    }),
  );
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-published-"));
  roots.push(dir);
  return dir;
}

function artifactJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact: PUBLISHED_ARTIFACT,
    artifactVersion: PUBLISHED_ARTIFACT_VERSION,
    publishedAt: INSTANT,
    source: { documentDigest: DIGEST, documentBytes: 4096, policyDigest: `sha256:${"b".repeat(64)}` },
    leaf: {
      id: "rowan-vale",
      subject: "Rowan Vale",
      subjectRedacted: false,
      leaflets: [
        {
          id: "git:4f884f6",
          title: "fix: hold the roster in manifest order",
          tier: "verified",
          titleRedacted: false,
          provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
        },
      ],
    },
    withheld: { count: 2, kinds: [{ kind: "not-shared", count: 2 }] },
    ...overrides,
  };
}

async function publish(root: string, id: string, value: unknown): Promise<string> {
  const path = publishedPath(root, id);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

/**
 * The markup for ONE leaflet's `<li>`, scoped so a badge assertion cannot be satisfied by some
 * OTHER row on the same page. `data-tier="pending"` is an attribute a stranger never sees; the
 * visible proof badge (`proofBadge` in `renderPublic.ts`) is the thing this function exists to
 * let a test reach INTO, per row, so a badge swapped between a verified and a pending row on a
 * mixed page reddens something.
 */
function leafletRowHtml(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<li class="pub-leaflet lp-record" data-leaflet="${escaped}"[\\s\\S]*?</li>`).exec(html);
  assert.ok(m !== null, `no <li> found on the page for leaflet "${id}"`);
  return m![0];
}

/* ==========================================================================================
   THE SEVEN CAUSES.
   ========================================================================================== */

test("unconfigured_saysNothingWasSearched_and503", async () => {
  for (const env of [{}, { [PUBLISHED_ENV]: "   " }]) {
    const load = await loadPublishedLeaf("rowan-vale", env);
    assert.equal(load.ok, false);
    if (load.ok) return;
    assert.equal(load.cause, "unconfigured");
    assert.equal(httpStatusForPublished(load), 503);
    // The distinction that matters: not "this page does not exist", but "nobody looked".
    assert.match(load.detail, /nothing is known about whether/);
  }
});

test("anIdThatIsNotPublishableNeverReachesTheFilesystem_and400", async () => {
  const root = await tempRoot();
  for (const id of ["Rowan Vale", "../../etc/passwd", "rowan%2Fvale", "ROWAN", "", "a".repeat(70)]) {
    const load = await loadPublishedLeaf(id, { [PUBLISHED_ENV]: root });
    assert.equal(load.ok, false, `"${id}" must not be treated as an address`);
    if (load.ok) continue;
    assert.equal(load.cause, "unpublishable-id", `"${id}" produced ${load.cause}`);
    assert.equal(httpStatusForPublished(load), 400);
    assert.equal(load.path, null, "no path may even be computed for an unpublishable id");
  }
});

test("theIdIsValidatedRatherThanSanitized_soNoTraversalIsPossible", async () => {
  const root = await tempRoot();
  // A file planted OUTSIDE the publications directory, addressed by every traversal spelling a
  // caller could reach for. Validation refuses the address; there is no cleaning step to defeat.
  const outside = join(root, "..", "outside.published.json");
  await writeFile(outside, JSON.stringify(artifactJson()), "utf8");
  const inner = join(root, "pub");
  await mkdir(inner, { recursive: true });
  for (const id of ["../outside", "..%2Foutside", "./../outside", "%2e%2e/outside"]) {
    const load = await loadPublishedLeaf(id, { [PUBLISHED_ENV]: inner });
    assert.equal(load.ok, false);
    if (!load.ok) assert.equal(load.cause, "unpublishable-id");
  }
  await rm(outside, { force: true });
});

test("absent_namesWhatIsAndIsNotKnown_and404", async () => {
  const root = await tempRoot();
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, false);
  if (load.ok) return;
  assert.equal(load.cause, "absent");
  assert.equal(httpStatusForPublished(load), 404);
  assert.match(load.detail, /does not mean the person has no leaf/);
  assert.match(load.detail, /rowan-vale\.published\.json/, "the log line must name the file tried");
});

test("unreadable_isNotAbsent_andCarriesTheRealErrno", async () => {
  const root = await tempRoot();
  const path = await publish(root, "rowan-vale", artifactJson());
  await chmod(path, 0o000);
  try {
    const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
    if (load.ok) {
      // Running as root defeats mode bits. Say so rather than asserting a false green.
      assert.fail("a mode-000 file was readable — this test cannot run as root");
    }
    assert.equal(load.cause, "unreadable");
    assert.equal(httpStatusForPublished(load), 500);
    assert.equal(load.errno, "EACCES");
    assert.match(load.detail, /has not been examined/);
  } finally {
    await chmod(path, 0o600);
  }
});

test("malformed_isNotAbsent_becauseATruncatedUploadIsNotAMissingPage", async () => {
  const root = await tempRoot();
  await writeFile(publishedPath(root, "rowan-vale"), '{"artifact": "foliage/published-le', "utf8");
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, false);
  if (load.ok) return;
  assert.equal(load.cause, "malformed");
  assert.equal(httpStatusForPublished(load), 500);
});

test("invalid_carriesEveryIssueAndAnExactCountWithATruncatedList", async () => {
  const root = await tempRoot();
  await publish(root, "rowan-vale", { artifact: "something-else", nonsense: true });
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, false);
  if (load.ok || load.cause !== "invalid") {
    assert.fail(`expected invalid, got ${load.ok ? "ok" : load.cause}`);
  }
  assert.equal(httpStatusForPublished(load), 500);
  assert.ok(load.issues.length >= 2);
  assert.match(load.detail, new RegExp(`${load.issues.length} problem`));
});

test("misfiled_isItsOwnCause_becauseTheArtifactIsFineAndTheFilingIsNot", async () => {
  const root = await tempRoot();
  // A perfectly valid publication about ONE person, stored under ANOTHER person's address.
  await publish(root, "somebody-else", artifactJson());
  const load = await loadPublishedLeaf("somebody-else", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, false);
  if (load.ok || load.cause !== "misfiled") {
    assert.fail(`expected misfiled, got ${load.ok ? "ok" : load.cause}`);
  }
  assert.equal(load.declaredId, "rowan-vale");
  assert.equal(httpStatusForPublished(load), 500);
  assert.match(load.detail, /refused rather than served or redirected/);
  const page = renderPublishedPage(load);
  assert.match(page, /Publication address mismatch/);
  assert.match(page, /somebody-else/);
  assert.doesNotMatch(page, /rowan-vale|Rowan Vale|declares itself/);
});

test("theHappyPathReadsTheDocumentAndAgreesWithTheAddress", async () => {
  const root = await tempRoot();
  await publish(root, "rowan-vale", artifactJson());
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, true);
  if (!load.ok) return;
  assert.equal(httpStatusForPublished(load), 200);
  assert.equal(load.document.leaf.subject, "Rowan Vale");
  assert.equal(load.document.withheld.count, 2);
  assert.equal(publishedUrl("rowan-vale"), "/leaf/rowan-vale");
});

test("private preview distinguishes an empty offer from work withheld in review", async () => {
  const root = await tempRoot();
  const preview = { kind: "local-hosted", csrf: "csrf", operationId: "preview", subjectId: "rowan-vale", replacing: false } as const;
  const empty = artifactJson({ withheld: { count: 0, kinds: [] } });
  (empty["leaf"] as Record<string, unknown>)["leaflets"] = [];
  await publish(root, "rowan-vale", empty);
  const nothingOffered = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(nothingOffered.ok, true);
  assert.match(renderPublishedPage(nothingOffered, { preview }), /No work selected/);

  const held = artifactJson({ withheld: { count: 1, kinds: [{ kind: "not-shared", count: 1 }] } });
  (held["leaf"] as Record<string, unknown>)["leaflets"] = [];
  await publish(root, "rowan-vale", held);
  const withheld = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(withheld.ok, true);
  const html = renderPublishedPage(withheld, { preview });
  assert.match(html, /No work in this preview/);
  assert.doesNotMatch(html, /No work selected/);
});

test("a publication leaflet detail reads only the admitted artifact and keeps pending standing visible", async () => {
  const root = await tempRoot();
  const doc = artifactJson({ withheld: { count: 1, kinds: [{ kind: "not-shared", count: 1 }] } });
  const leaf = doc["leaf"] as Record<string, unknown>;
  leaf["leaflets"] = [
    { id: "git:public", title: "Chosen work", tier: "pending", titleRedacted: false,
      provenance: { source: "git", ref: "c".repeat(40), observedAt: INSTANT } },
    { id: "git:second", title: "Other admitted work", tier: "verified", titleRedacted: false,
      provenance: { source: "git", ref: "second", observedAt: INSTANT } },
  ];
  await publish(root, "rowan-vale", doc);
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.ok(load.ok);
  if (!load.ok) return;
  const href = publishedLeafletHref("rowan-vale", "git:public");
  assert.equal(href, "/leaflet/git%3Apublic?publication=rowan-vale");
  const page = renderPublishedPage(load);
  assert.match(page, /href="\/leaflet\/git%3Apublic\?publication=rowan-vale"/);
  assert.match(page, /<h2 class="pub-title" data-verbatim="title">Chosen work<\/h2>\s*<div class="lp-record-meta">/);
  assert.doesNotMatch(renderPublishedPage(load, { linkToDetail: false }), /href="\/leaflet\//);
  const detail = renderPublishedLeafletPage(load.document, "git:public");
  assert.ok(detail);
  assert.match(detail, /<h1 class="pub-title" data-verbatim="title">Chosen work<\/h1>\s*<div class="lp-record-meta">/);
  assert.match(detail, /<span class="lp-source">Git<\/span>\s*<span class="lp-date"><span>Observed<\/span> <time/);
  assert.doesNotMatch(withoutVerbatimRegions(detail), /Chosen work/);
  assert.match(detail, /Authorship is NOT cryptographically established\./);
  assert.match(detail, /<details class="pub-evidence" open data-portfolio-evidence>/);
  assert.match(detail, /title="c{40}">c{7}<\/span>/);
  assert.match(detail, /<summary>Full reference<\/summary><code>c{40}<\/code>/);
  assert.doesNotMatch(detail, /<dt class="fol-label">Observed<\/dt>/, "the visible work date should not be repeated in evidence");
  assert.match(detail, /Publication<\/summary>/);
  assert.doesNotMatch(detail, new RegExp(DIGEST));
  assert.doesNotMatch(detail, /Other admitted work|not-shared|FOLIAGE_TREE|<script/);
  assert.equal(renderPublishedLeafletPage(load.document, "git:private"), null);
});

/* ==========================================================================================
   THE PAGE.
   ========================================================================================== */

test("noFailurePageContainsAServerPath_theLogDoesAndThePageDoesNot", async () => {
  const root = await tempRoot();
  const loads = [
    await loadPublishedLeaf("rowan-vale", {}),
    await loadPublishedLeaf("Rowan Vale", { [PUBLISHED_ENV]: root }),
    await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root }),
  ];
  await writeFile(publishedPath(root, "broken"), "{oh no", "utf8");
  loads.push(await loadPublishedLeaf("broken", { [PUBLISHED_ENV]: root }));
  await publish(root, "not-a-leaf", { artifact: "nope" });
  loads.push(await loadPublishedLeaf("not-a-leaf", { [PUBLISHED_ENV]: root }));
  await publish(root, "wrong-name", artifactJson());
  loads.push(await loadPublishedLeaf("wrong-name", { [PUBLISHED_ENV]: root }));

  for (const load of loads) {
    assert.equal(load.ok, false);
    if (load.ok) continue;
    const html = renderPublishedPage(load);
    assert.ok(
      !html.includes(root),
      `the ${load.cause} page carries the publications directory — a public page must not ` +
        `describe the server's filesystem`,
    );
    assert.ok(!html.includes(tmpdir()), `the ${load.cause} page carries a filesystem path`);
    // The cause is nonetheless named on the page, in the markup and in words.
    assert.ok(html.includes(`data-published-state="${load.cause}"`));
  }
});

test("F-030 — the empty published page names no single cause, because the gate has three", async () => {
  /*
   * THE F-028 SHAPE ON THE FROZEN-ARTIFACT PATH, which is the page a stranger actually receives
   * (`renderPublic.ts`'s header: a published artifact "is the page a stranger receives").
   *
   * The copy asserted ONE cause — "A leaflet crosses to a public page only when authorship was
   * cryptographically established … Nothing in this leaf met that". `publish.ts` withholds for
   * three: `unproven-leaflet` (that sentence is true), `unattributed-leaflet` (authorship IS
   * established — to somebody else), and `unpublishable-provenance` (about material in the
   * evidence, nothing to do with authorship). Two of the three made this page state a false and
   * specific reason about a named person, on the public plane.
   *
   * Rendered from an artifact whose withheld set contains NONE of the unproven kind, so the old
   * sentence is unambiguously false about it.
   */
  const root = await tempRoot();
  await publish(
    root,
    "rowan-vale",
    artifactJson({
      leaf: { id: "rowan-vale", subject: "Rowan Vale", subjectRedacted: false, leaflets: [] },
      withheld: {
        count: 3,
        kinds: [
          { kind: "unattributed-leaflet", count: 2 },
          { kind: "unpublishable-provenance", count: 1 },
        ],
      },
    }),
  );
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, true, "the fixture artifact did not load");
  const html = renderPublishedPage(load);

  assert.match(html, /data-published-empty="true"/, "this fixture must reach the empty page");
  assert.doesNotMatch(
    html,
    /authorship was cryptographically established/,
    "F-030: nothing here was withheld for want of a signature, and the page says it was",
  );
  // AND IT STILL SAYS THE TWO THINGS A READER WOULD BE MISLED WITHOUT.
  assert.match(html, /Possible reasons:/, "the page stopped saying the cause is not known to be singular");
  assert.match(html, /person's publication rules/, "the empty explanation must include the policy-denied gate");
  assert.match(
    html,
    /not an empty portfolio/,
    "the anti-inference is gone — a reader concludes this person has done nothing",
  );

  /*
   * THE ASSERTION THAT MUST LOOK PAST `.pub-empty`, AND THE REASON IT EXISTS.
   *
   * The first fix for F-030 ended its paragraph "This page does not say which applied here" — a
   * sentence that was false ON THIS PAGE, because `publishedLeaf` always appends
   * `withheldSection`, which prints `KIND_LABEL` per kind with its count directly beneath. So the
   * repair for a page stating a false cause was a page stating a false claim about itself, and
   * the guard did not catch it because every assertion above stops at the empty section.
   *
   * A page is one document to a reader. These assertions therefore read the WHOLE page: the
   * kinds are named, and nothing anywhere claims the page is silent about them.
   */
  assert.match(html, /data-withheld-kind="unattributed-leaflet"/, "the withheld kinds vanished");
  assert.match(html, /data-withheld-kind="unpublishable-provenance"/, "the withheld kinds vanished");
  assert.match(html, /could not be attributed to this person/, "KIND_LABEL is not being rendered");
  assert.doesNotMatch(
    html,
    /does not say which/,
    "the page claims it withholds the cause while naming every cause in the section below — a " +
      "claim about the page that the page itself falsifies",
  );

  /*
   * THE OTHER HALF OF THE SAME PAGE, which round four also got wrong: a document with NO
   * withholdings at all. `withheldSection` branches at `count === 0` and says "Nothing was
   * withheld from this page", so a fixed paragraph reading "Work is held back … for more than one
   * reason" contradicted it — and worse, "It is not an empty portfolio" is FALSE there: nothing
   * crossed and nothing was withheld, so the leaf genuinely held nothing at review time. An
   * anti-inference that is right about held-back work is a lie about work that never existed.
   */
  await publish(
    root,
    "nothing-yet",
    artifactJson({
      leaf: { id: "nothing-yet", subject: "Nothing Yet", subjectRedacted: false, leaflets: [] },
      withheld: { count: 0, kinds: [] },
    }),
  );
  const bare = await loadPublishedLeaf("nothing-yet", { [PUBLISHED_ENV]: root });
  assert.equal(bare.ok, true, "the empty-withheld fixture did not load");
  const bareHtml = renderPublishedPage(bare);

  assert.match(bareHtml, /data-published-empty="true"/);
  assert.doesNotMatch(bareHtml, /class="pub-assistance"|href="#work"/, "an empty publication has no work anchor or associated Ladybug interpretation");
  assert.match(bareHtml, /data-withheld="0"/, "this fixture must reach the no-withholdings branch");
  assert.match(bareHtml, /Nothing was withheld from this page/, "the sibling section changed shape");
  assert.doesNotMatch(
    bareHtml,
    /Possible reasons:/,
    "the page says work was held back on a document whose review withheld nothing",
  );
  assert.doesNotMatch(
    bareHtml,
    /not an empty portfolio/,
    "nothing crossed and nothing was withheld, so the leaf WAS empty at review time — this " +
      "anti-inference is true of held-back work and false here",
  );
});

test("everyCauseGetsItsOwnHeading_soNoTwoStatesLookAlike", async () => {
  const root = await tempRoot();
  const headings = new Set<string>();
  const collect = (html: string) => {
    const m = /<h1 id="pub-fail-h">([^<]+)<\/h1>/.exec(html);
    assert.ok(m !== null, "a failure page must carry a heading");
    headings.add(m[1] as string);
  };
  collect(renderPublishedPage(await loadPublishedLeaf("rowan-vale", {})));
  collect(renderPublishedPage(await loadPublishedLeaf("BAD", { [PUBLISHED_ENV]: root })));
  collect(renderPublishedPage(await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root })));
  await writeFile(publishedPath(root, "broken"), "{oh no", "utf8");
  collect(renderPublishedPage(await loadPublishedLeaf("broken", { [PUBLISHED_ENV]: root })));
  await publish(root, "not-a-leaf", { artifact: "nope" });
  collect(renderPublishedPage(await loadPublishedLeaf("not-a-leaf", { [PUBLISHED_ENV]: root })));
  await publish(root, "wrong-name", artifactJson());
  collect(renderPublishedPage(await loadPublishedLeaf("wrong-name", { [PUBLISHED_ENV]: root })));
  assert.equal(headings.size, 6, `two causes share a heading: ${[...headings].join(" | ")}`);
});

test("aRedactedTitleIsNeverMarkedVerbatim_andTheDifferenceIsSaidInWords", async () => {
  const root = await tempRoot();
  const doc = artifactJson();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  leaflets[0]!["title"] = "fix: drop [withheld: email address] from the seed";
  leaflets[0]!["titleRedacted"] = true;
  await publish(root, "rowan-vale", doc);
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(load.ok, true);
  const html = renderPublishedPage(load);
  assert.ok(html.includes('data-title-redacted="true"'));
  assert.ok(
    !html.includes('data-verbatim="title"'),
    "a title this product altered must not be marked as the artifact's own words",
  );
  assert.match(html, /no longer word for word/);
});

test("anUnredactedTitleIsMarkedVerbatim_whichIsWhatMakesTheNoScoreCheckScopable", async () => {
  const root = await tempRoot();
  const doc = artifactJson();
  const leaflets = (doc["leaf"] as Record<string, unknown>)["leaflets"] as Record<string, unknown>[];
  // A REAL commit subject from a repository on this machine, and the reason scoping exists: it
  // contains "scoring". Refusing to render somebody's real commit message to satisfy a substring
  // check would falsify the evidence this page carries.
  leaflets[0]!["title"] = "feat(vault): retrieval-first graph layer — router, index scoring";
  await publish(root, "rowan-vale", doc);
  const html = renderPublishedPage(await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root }));
  assert.ok(html.includes('data-verbatim="title"'));
  assert.ok(html.includes("index scoring"), "the evidence must be rendered as written");

  const scoped = withoutVerbatimRegions(html);
  for (const word of ["score", "rating", "rank", "grade", "percentile", "out of"]) {
    assert.ok(
      !scoped.toLowerCase().includes(word),
      `the published page asserts "${word}" outside the evidence it carries`,
    );
  }
});

test("thePageStatesWhenItWasPublishedAndFromWhatDigest", async () => {
  const root = await tempRoot();
  await publish(root, "rowan-vale", artifactJson());
  const html = renderPublishedPage(await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root }));
  assert.ok(html.includes(`datetime="${INSTANT}"`), "an artifact nobody can date-check is useless");
  assert.ok(html.includes(DIGEST), "the source digest is what ties this page to a checkable file");
});

test("withheldIsRenderedAsENTRIES_neverAsANumberOfMissingLeaflets", async () => {
  const root = await tempRoot();
  await publish(root, "rowan-vale", artifactJson());
  const html = renderPublishedPage(await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root }));
  assert.ok(html.includes('data-withheld="present"'));
  assert.ok(!html.includes('data-withheld="2"'), "a withheld total must not cross into served bytes");
  assert.match(html, /2 entries in the publication review/);
  assert.match(html, /not a count of missing work/);
});

test("aPublishedLeafWithEverythingExcludedRendersAnHonestEmptyPage_notAFailure", async () => {
  // Nothing crosses because everything offered turned out to be somebody else's work — NOT
  // because nothing was verified: since D1 (2026-09-06) a `pending` leaflet crosses too, so
  // "nothing verified" no longer implies an empty artifact. See the test below.
  const root = await tempRoot();
  const doc = artifactJson({
    withheld: { count: 60, kinds: [{ kind: "unattributed-leaflet", count: 60 }] },
  });
  (doc["leaf"] as Record<string, unknown>)["leaflets"] = [];
  await publish(root, "rowan-vale", doc);
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(httpStatusForPublished(load), 200, "an honest empty page is a correct answer, not an error");
  const html = renderPublishedPage(load);
  assert.ok(html.includes('data-published-empty="true"'));
  // `\s+` because the markup wraps: the page's own line breaks must not decide what a test asserts.
  assert.match(html, /it is not a\s+failure/);
  assert.ok(html.includes('data-fact="leaflets">0<'));
});

test("D1 — a published leaf with only pending work is NOT empty, and the tier is printed", async () => {
  // The corpse this PR removes: `reviewForPublication` used to gate on `tier === "verified"`,
  // so a garden with zero verified leaflets published a permanently empty page (measured on the
  // owner's real garden: 0 of 235). Offered pending work now crosses, with its tier printed.
  const root = await tempRoot();
  const doc = artifactJson({ withheld: { count: 0, kinds: [] } });
  (doc["leaf"] as Record<string, unknown>)["leaflets"] = [
    {
      id: "git:aaa1111",
      title: "feat: the seam test drives a real repository",
      tier: "pending",
      titleRedacted: false,
      provenance: { source: "git", ref: "aaa1111", observedAt: INSTANT },
    },
  ];
  await publish(root, "rowan-vale", doc);
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(httpStatusForPublished(load), 200);
  const html = renderPublishedPage(load);

  assert.ok(!html.includes('data-published-empty="true"'), "zero verified must not mean empty");
  assert.ok(html.includes('data-fact="leaflets">1<'));
  assert.ok(
    html.includes("feat: the seam test drives a real repository"),
    "the pending leaflet itself must be on the page",
  );
  assert.ok(
    html.includes('data-tier="pending"'),
    "the row must say which tier it is, not just that it crossed",
  );
  assert.doesNotMatch(
    html,
    /data-tier="verified"/,
    "mutation check: nothing here silently upgrades a pending leaflet to verified",
  );

  /*
   * THE VISIBLE BADGE, NOT ONLY THE DATA ATTRIBUTE. `data-tier` is markup a stranger never reads;
   * `data-tier="pending"` staying correct while every row RENDERED "Verified" is exactly the
   * overclaim D1 exists to prevent, and nothing above this point would catch it. Mutation-checked:
   * deleting the `<p class="pub-tier">` line, or hardcoding `proofBadge("verified")` for every
   * row, both leave every assertion above green.
   */
  const pendingRow = leafletRowHtml(html, "git:aaa1111");
  assert.match(pendingRow, /class="proof proof-pending"/, "the visible badge on a pending row must say pending");
  assert.match(pendingRow, />Pending</, "the badge's own text, not just its class, must read Pending");
  assert.doesNotMatch(pendingRow, /class="proof proof-verified"/, "a pending row must not carry the verified badge");
  assert.doesNotMatch(pendingRow, />Verified</, "a pending row must not visibly read Verified");
});

test("D1 mixed page — a verified and a pending row on the same page each carry their OWN badge", async () => {
  // The mixed fixture the D1 test above cannot exercise on its own: with only one tier present,
  // a bug that always prints the SAME badge regardless of `l.tier` would still look correct. Two
  // rows of different tiers is what makes a swap visible.
  const root = await tempRoot();
  const doc = artifactJson({ withheld: { count: 0, kinds: [] } });
  (doc["leaf"] as Record<string, unknown>)["leaflets"] = [
    {
      id: "git:vvv1111",
      title: "fix: the verified row on a mixed page",
      tier: "verified",
      titleRedacted: false,
      provenance: { source: "git", ref: "vvv1111", observedAt: INSTANT },
    },
    {
      id: "git:ppp2222",
      title: "feat: the pending row on the same mixed page",
      tier: "pending",
      titleRedacted: false,
      provenance: { source: "git", ref: "ppp2222", observedAt: INSTANT },
    },
  ];
  await publish(root, "rowan-vale", doc);
  const load = await loadPublishedLeaf("rowan-vale", { [PUBLISHED_ENV]: root });
  assert.equal(httpStatusForPublished(load), 200);
  const html = renderPublishedPage(load);

  const verifiedRow = leafletRowHtml(html, "git:vvv1111");
  assert.match(verifiedRow, /class="proof proof-verified"/);
  assert.match(verifiedRow, />Verified</);
  assert.doesNotMatch(verifiedRow, /class="proof proof-pending"/);
  assert.doesNotMatch(verifiedRow, />Pending</);

  const pendingRow = leafletRowHtml(html, "git:ppp2222");
  assert.match(pendingRow, /class="proof proof-pending"/);
  assert.match(pendingRow, />Pending</);
  assert.doesNotMatch(pendingRow, /class="proof proof-verified"/);
  assert.doesNotMatch(pendingRow, />Verified</);
});

test("everyInterpolatedValueIsEscaped_includingTheIdFromTheUrl", async () => {
  const root = await tempRoot();
  const load = await loadPublishedLeaf('<script>alert("x")</script>', { [PUBLISHED_ENV]: root });
  const html = renderPublishedPage(load);
  assert.ok(!html.includes("<script>"), "an id from a URL reached the page unescaped");
  assert.ok(html.includes("&lt;script&gt;"));
});

// Synthetic publication contract inputs only; not portfolio evidence or a demo.
test("compound leaf rows preserve admitted document order and escape source labels", async () => {
  const root = await tempRoot();
  const entry = (id: string, source?: string) => ({ id, title: `Contract input ${id}`, tier: "pending", titleRedacted: false,
    ...(source ? { provenance: { source, ref: id, observedAt: INSTANT } } : {}) });
  await publish(root, "render-contract", artifactJson({ leaf: {
    id: "render-contract", subject: "Publication renderer contract", subjectRedacted: false,
    leaflets: [entry("one", "git"), entry("two", "Design <notes>"), entry("three", "git"), entry("four")],
  } }));
  const load = await loadPublishedLeaf("render-contract", { [PUBLISHED_ENV]: root });
  assert.ok(load.ok);
  const html = renderPublishedPage(load);
  assert.equal((html.match(/data-portfolio-panel/g) ?? []).length, 4);
  assert.equal((html.match(/class="pub-leaflet lp-record"/g) ?? []).length, 4);
  assert.deepEqual([...html.matchAll(/class="pub-leaflet lp-record" data-leaflet="([^"]+)"/g)].map(match => match[1]), ["one", "two", "three", "four"]);
  assert.match(html, /Design &lt;notes&gt;/);
  assert.match(html, /Source not recorded/);
  assert.match(html, /class="lp-person-hero"/);
  assert.doesNotMatch(html, /Foliage specimen artwork|src="\/specimen-sheet-day\.jpg"/);
  assert.doesNotMatch(html, /class="pub-assistance"|No Ladybug interpretation attached|No public conversations/, "no empty assistance panel competes with published work");
  for (const id of ["one", "two", "three", "four"]) assert.match(leafletRowHtml(html, id), /data-tier="pending"/);
});
