/**
 * GATES ON THE TWO PUBLIC PAGES — the ones whose failure would publish somebody's evidence.
 *
 * WHAT THIS FILE IS FOR AND WHAT IT IS NOT. `seam.test.ts` drives the whole chain over real HTTP
 * against the real server binary; that is where "the product works" is established. This file
 * asserts the properties that are cheap to check exhaustively and catastrophic to get wrong, on
 * documents produced by the REAL intake over this repository's REAL history, plus — where a
 * `verified` tier is required — over a throwaway repository whose commits are signed with a REAL
 * ed25519 key from stock `ssh-keygen`. No tier in this file was written by hand, because a
 * hand-written `"tier": "verified"` is precisely the claim the product refuses to let anyone
 * make without cryptography, and a test that made it would be testing a string.
 *
 * If `ssh-keygen` is absent the signed cases report themselves SKIPPED. They never pass quietly
 * on an assertion they did not make.
 *
 * THE FOUR THINGS THIS FILE EXISTS TO CATCH:
 *
 *   1. A RENDERER REACHING PAST THE PROJECTION. `Tree.leaves` holds whole portfolios. The gate
 *      is on the SOURCE, because no output check can prove the absence of a path that today's
 *      documents happen not to exercise.
 *   2. A PRIVATE ID AND AN ABSENT ID ANSWERING DIFFERENTLY. Compared byte for byte with the id
 *      substituted out, because "they look the same" is how an oracle survives review.
 *   3. PRIVATE MATERIAL ON A PUBLIC PAGE. Every title and every ref in a real 40-leaflet
 *      document, checked against every byte of every public page that document can produce.
 *   4. THE PAGE SAYING SOMETHING THE DOMAIN DID NOT. A score-shaped word, a tier badge with no
 *      variant, an attestation over words a machine wrote, a commit subject in the window title.
 *
 * DISCIPLINE: every child process is non-interactive with a deadline, and every temporary tree is
 * removed in an `after` hook.
 */

import assert from "node:assert/strict";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  defaultPublishPolicy,
  evaluatePolicy,
  isAbsoluteDenial,
  parseLeafDocument,
  type Leaf,
  type Leaflet,
} from "@foliage/leaf";

import {
  publicLeafStatus,
  publicLeafletStatus,
  renderPublicLeafPage,
  renderPublicLeafletPage,
  resolvePublicLeaf,
  resolvePublicLeaflet,
} from "./renderPublic.ts";
import { esc } from "./renderTree.ts";
import { TREE_ENV, loadTreeDocument, type TreeLoad } from "./treeDocument.ts";

const exec = promisify(execFile);

const INTAKE = fileURLToPath(new URL("../../leaf/intake.mjs", import.meta.url));
const SHARE = fileURLToPath(new URL("../../leaf/share.mjs", import.meta.url));
/** This repository — real git history, which is the point. */
const REPO = testRepository();

const RENDER_PUBLIC = fileURLToPath(new URL("./renderPublic.ts", import.meta.url));
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

/**
 * Seal off the developer's own git configuration for every git this file causes to run.
 *
 * Not tidiness. Whether a signature verifies is decided by `gpg.ssh.allowedSignersFile`, so a
 * developer with one configured globally would measure something different from a developer
 * without. `-c` cannot express "unset"; sealing the files git reads can.
 */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-public-"));
  tmpRoots.push(dir);
  return dir;
}

const git = (dir: string, ...args: string[]): Promise<string> =>
  exec("git", ["-C", dir, ...args], { env: GIT_ENV, timeout: 60_000 }).then((r) => r.stdout);

/**
 * A REAL repository whose commits carry REAL ed25519 signatures git will accept and bind.
 *
 * Returns null only when `ssh-keygen` is missing: a machine without it cannot exercise the
 * signed path, and a test that fabricated a signature block would be asserting over a string.
 * Every setting is repo-local, so what is measured is git's behaviour given a stated
 * configuration rather than this machine's.
 */
async function signedRepo(dir: string, email: string, subjects: string[]): Promise<string | null> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "--initial-branch=main", "-q");
  await git(dir, "config", "user.name", "Signed Author");
  await git(dir, "config", "user.email", email);
  try {
    await exec("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "foliage-test", "-f", join(dir, "k"), "-q"], {
      env: GIT_ENV,
      timeout: 60_000,
    });
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return null;
    throw err;
  }
  const key = join(dir, "k.pub");
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${email} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  await git(dir, "config", "gpg.format", "ssh");
  await git(dir, "config", "user.signingkey", key);
  await git(dir, "config", "commit.gpgsign", "true");
  for (const [i, subject] of subjects.entries()) {
    await writeFile(join(dir, `f${i}.txt`), subject, "utf8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", subject);
  }
  return dir;
}

const SUBJECT_EMAIL = "public-subject@example.com";
const OTHER_EMAIL = "somebody-else@example.com";

/**
 * A REAL repository with two authors and no signing.
 *
 * No `ssh-keygen`, so it never skips: the fact under test is ATTRIBUTION (whose work is this),
 * which needs no signature at all. Every commit is real, made by real `git`, and the second
 * author's are what intake mints as `excluded`.
 */
async function twoAuthorRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "--initial-branch=main", "-q");
  await git(dir, "config", "user.name", "Public Subject");
  await git(dir, "config", "user.email", SUBJECT_EMAIL);
  const commits: readonly [string, string][] = [
    [SUBJECT_EMAIL, "feat: the subject's own work"],
    [OTHER_EMAIL, "docs: work by somebody else entirely"],
  ];
  for (const [i, [email, subject]] of commits.entries()) {
    await writeFile(join(dir, `f${i}.txt`), `${subject}\n`, "utf8");
    await git(dir, "add", "-A");
    await git(dir, "-c", `user.email=${email}`, "-c", "user.name=Author", "commit", "-m", subject);
  }
  return dir;
}

/** Run the REAL producer over a REAL repository and return the document path. */
async function realLeafFrom(
  repo: string,
  subject: string,
  identity: string,
  out: string,
): Promise<string> {
  await exec(
    process.execPath,
    [
      INTAKE,
      "--repo", repo,
      "--subject", subject,
      "--identity", identity,
      "--id", subject.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      "--out", out,
      "--force",
    ],
    { env: GIT_ENV, timeout: 120_000 },
  );
  return out;
}

/** The REAL user path for offering a leaflet outward — the command, not a hand-edited field. */
async function share(document: string, id: string, as: "unlisted" | "public"): Promise<void> {
  await exec(process.execPath, [SHARE, "share", id, "--as", as, "--leaf", document], {
    env: GIT_ENV,
    timeout: 60_000,
  });
}

/**
 * Somebody else's work marked public BY THE DOCUMENT. `share.mjs` refuses this since QA #15
 * (`apps/leaf/src/shareExcluded.test.ts`), so the state is reached the way it still can be: a
 * document written before that refusal, or edited by hand. The canopy must withhold it either way.
 */
async function markPublicInDocument(document: string, id: string): Promise<void> {
  const raw = JSON.parse(await readFile(document, "utf8")) as { leaflets: Record<string, unknown>[] };
  const leaflets = raw.leaflets.map((l) => (l["id"] === id ? { ...l, visibility: "public" } : l));
  await writeFile(document, `${JSON.stringify({ ...raw, leaflets }, null, 2)}\n`, "utf8");
}

async function leafAt(path: string): Promise<Leaf> {
  const parsed = parseLeafDocument(JSON.parse(await readFile(path, "utf8")));
  assert.equal(parsed.ok, true, `${path} did not parse as a leaf document`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

/**
 * The first leaflet of this repository's history that the DEFAULT rail lets out — as opposed to
 * `leaflets[0]`, which is whichever commit somebody made last.
 *
 * The fixture must use a leaflet that passes the same current publication rule as the surface
 * itself. Choosing whichever commit happens to be newest would make this test depend on the
 * next commit subject, rather than the public behavior it is meant to verify.
 */
function firstPublishable(leaf: Leaf, tier?: Leaflet["tier"]): Leaflet {
  const rail = defaultPublishPolicy();
  assert.equal(rail.ok, true, "the shipped default policy does not parse");
  if (!rail.ok) throw new Error("unreachable");
  const first = leaf.leaflets.find(
    (l) => (tier === undefined || l.tier === tier) && !isAbsoluteDenial(evaluatePolicy(rail.policy, l)),
  );
  assert.ok(first !== undefined, "this repository yielded no leaflet the default rail allows");
  return first;
}

/** Real committer emails from this repository, discovered at run time — a hardcoded one rots. */
async function realIdentity(): Promise<string> {
  const { stdout } = await exec("git", ["-C", REPO, "log", "--no-merges", "--format=%ae"], {
    timeout: 60_000,
  });
  const first = stdout.split("\n").map((s) => s.trim()).find(Boolean);
  assert.ok(first !== undefined, "this repository has no commit authors, so nothing real can be read");
  return first;
}

async function treeOf(dir: string, entries: string[], company = "Public Company"): Promise<TreeLoad> {
  const manifest = join(dir, "tree.json");
  await writeFile(manifest, JSON.stringify({ id: "public-tree", company, leaves: entries }));
  return loadTreeDocument({ [TREE_ENV]: manifest });
}

function loaded(load: TreeLoad): Extract<TreeLoad, { ok: true }> {
  assert.equal(load.ok, true, "the tree under test did not load");
  if (!load.ok) throw new Error("unreachable");
  return load;
}

/* ==========================================================================================
   READING THE PAGE AS A HUMAN DOES — the two measurements the density gate is made of.

   A word count over raw HTML counts class names and hrefs, which is not what anybody reads. A
   word count over the whole document counts text a reader has not opened, which is not what
   anybody reads EITHER — and that second one is the measurement that decides whether this pass
   moved a caveat or merely deleted it.
   ========================================================================================== */

/**
 * The page WITHOUT any collapsed disclosure: summaries kept, bodies dropped.
 *
 * Deliberately keyed on `<details>`/`</summary>` and NOT on `class="tree-why"`. The gate has to
 * survive a restyle, and worse, a class-name-keyed stripper silently stops stripping the day the
 * class changes — at which point every "this is visible" assertion below passes over hidden text
 * and the gate is vacuous while green. `assertStripped` is the guard on the guard.
 */
function withoutDisclosures(html: string): string {
  return html.replace(/(<details\b[^>]*>[\s\S]*?<\/summary>)[\s\S]*?<\/details>/g, "$1</details>");
}

/** The words a reader sees: tags out, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a reader sees on landing, before opening anything. */
function visibleText(html: string): string {
  return textOf(withoutDisclosures(html));
}

/**
 * A tree holding one person whose only offered leaflet is somebody else's work — the shortest
 * real route to `nothing-publishable`. Built from a real two-author repository through the real
 * producer, with the offer written into the document (`share` refuses it — see
 * `markPublicInDocument`).
 */
async function nothingPublishableLoad(): Promise<TreeLoad> {
  const dir = await tempDir();
  const repo = await twoAuthorRepo(join(dir, "repo"));
  const document = await realLeafFrom(repo, "Empty Handed", SUBJECT_EMAIL, join(dir, "a.leaf.json"));
  const leaf = await leafAt(document);
  const foreign = leaf.leaflets.find((l) => l.tier === "excluded");
  assert.ok(foreign !== undefined, "the fixture produced no excluded leaflet");
  await markPublicInDocument(document, foreign.id);
  return treeOf(dir, ["a.leaf.json"]);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/* ==========================================================================================
   1 — THE RENDERER CANNOT REACH PAST THE PROJECTION.
   ========================================================================================== */

test("no public renderer reads leaf.leaflets — the gate is on the source, not on the output", async () => {
  // WHY SOURCE AND NOT OUTPUT. An output check can only prove that today's documents do not
  // happen to exercise the path. `Tree.leaves` holds whole portfolios — every private leaflet,
  // every unproven one, every one that turned out to be somebody else's — so the property that
  // has to hold is that no code here can SEE that list, and the only place that is decidable is
  // the text of the files.
  //
  // Comments are stripped first, because both files argue about `leaf.leaflets` at length and a
  // prose mention is not a read. The pattern is `.leaflets` on anything: `leaf.leaflets`,
  // `l.leaflets`, `load.tree.leaves[0].leaflets` and a destructure all contain it.
  for (const file of [RENDER_PUBLIC, SERVER]) {
    const code = (await readFile(file, "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const hits = [...code.matchAll(/\.leaflets\b|\bleaflets\s*[:,}]/g)].map((m) => m[0]);
    assert.deepEqual(
      hits,
      [],
      `${file} reads the raw leaflet list. Every set these pages may show comes from ` +
        `@foliage/canopy's public projection, which has already applied the subject's ` +
        `visibility gate and the tier gate. Found: ${hits.join(", ")}`,
    );
  }
});

/* ==========================================================================================
   2 — A PRIVATE ID AND AN ABSENT ID ARE THE SAME ANSWER, BYTE FOR BYTE.
   ========================================================================================== */

test("a private leaflet and a leaflet that does not exist answer identically", async () => {
  const dir = await tempDir();
  const identity = await realIdentity();
  const document = await realLeafFrom(REPO, "Byte Compare", identity, join(dir, "a.leaf.json"));
  const load = await treeOf(dir, ["a.leaf.json"]);
  const leaf = await leafAt(document);

  // A REAL id out of a REAL document, and it is private — `private` is the domain default and it
  // is expressed by the field's absence, so a document nobody has edited shares nothing. That is
  // what makes this comparison meaningful: the id genuinely exists.
  const real = leaf.leaflets[0]?.id;
  assert.ok(real !== undefined, "intake produced an empty document — nothing to compare");
  const invented = "git:0000000000000000000000000000000000000000";

  const privatePage = renderPublicLeafletPage(resolvePublicLeaflet(load, real, null));
  const absentPage = renderPublicLeafletPage(resolvePublicLeaflet(load, invented, null));

  assert.equal(publicLeafletStatus(resolvePublicLeaflet(load, real, null)), 404);
  assert.equal(publicLeafletStatus(resolvePublicLeaflet(load, invented, null)), 404);

  // Substitute the one string that legitimately differs — the id the requester already had —
  // and require the rest to be equal. Anything else that differed would be the oracle: try ids
  // until the wording changes and you have enumerated a portfolio.
  assert.equal(
    privatePage.split(real).join("<ID>"),
    absentPage.split(invented).join("<ID>"),
    "the refusal for a real private id differs from the refusal for an id nobody has",
  );

  // And the same holds through the QUALIFIED address, which is the path that can see unlisted
  // work: a scope naming a real leaf, and a scope naming nobody, must also be one answer.
  const scoped = renderPublicLeafletPage(resolvePublicLeaflet(load, real, leaf.id));
  const scopedNobody = renderPublicLeafletPage(
    resolvePublicLeaflet(load, real, "no-such-leaf-at-all"),
  );
  assert.equal(scoped, scopedNobody, "?leaf= tells a prober whether a leaf id exists");
});

/* ==========================================================================================
   3 — NOTHING PRIVATE REACHES A PUBLIC PAGE.
   ========================================================================================== */

test("not one title or ref from a real 40-leaflet document appears on any public page", async () => {
  const dir = await tempDir();
  const identity = await realIdentity();
  const document = await realLeafFrom(REPO, "Whole Portfolio", identity, join(dir, "a.leaf.json"));
  const load = await treeOf(dir, ["a.leaf.json"]);
  const leaf = await leafAt(document);
  assert.ok(
    leaf.leaflets.length > 5,
    `this check is only meaningful over a real portfolio; got ${leaf.leaflets.length} leaflets`,
  );

  // Every page this document can produce, with nothing shared: the person page, and an artifact
  // page for each of their real ids, both unqualified and qualified by their leaf.
  const person = renderPublicLeafPage(resolvePublicLeaf(load, leaf.id));
  const artifactPages = leaf.leaflets.flatMap((l) => [
    { asked: l.id, html: renderPublicLeafletPage(resolvePublicLeaflet(load, l.id, null)) },
    { asked: l.id, html: renderPublicLeafletPage(resolvePublicLeaflet(load, l.id, leaf.id)) },
  ]);

  for (const l of leaf.leaflets) {
    const ref = "provenance" in l ? l.provenance?.ref : undefined;

    // NO TITLE, ANYWHERE, EVER. A title is the artifact's own words about somebody's work and
    // nothing this person published is on this tree, so no page may carry one.
    assert.equal(person.includes(l.title), false, `the person page carries: ${l.title}`);
    for (const { html } of artifactPages) {
      assert.equal(html.includes(l.title), false, `an artifact page carries: ${l.title}`);
    }

    if (ref === undefined) continue;
    // NO REF ON THE PERSON PAGE AT ALL.
    assert.equal(person.includes(ref), false, "the person page carries an unpublished ref");
    // AND ON AN ARTIFACT PAGE, ONLY THE ONE THAT WAS ASKED FOR. A refusal echoes the id the
    // requester already had — that is the whole content of the page — so the property is that it
    // discloses nothing about ANY OTHER leaflet. Asserting it carries no ref at all would be
    // asserting the refusal is blank, which would delete the page rather than test it.
    for (const { asked, html } of artifactPages) {
      if (asked.includes(ref)) continue;
      assert.equal(html.includes(ref), false, `asking for ${asked} disclosed the ref ${ref}`);
    }
  }

  // The person page is not a blank either — it names the person and says WHICH of the two empty
  // states this is. A fresh intake has offered nothing, so it is `nothing-offered`.
  assert.match(person, /data-public-state="nothing-offered"/);
  assert.match(person, /Whole Portfolio/);
  assert.match(person, /Nothing is published on this leaf\./);
  // And no count anywhere: the empty arms of the projection carry no `listed` field, so there is
  // nothing to print a zero from. A zero here would be a claim about the size of a withheld set.
  assert.doesNotMatch(person, /class="fol-metric">\d/);
});

test("offering work that is SOMEBODY ELSE'S is its own state, and it is not `published nothing`", async () => {
  // The two empty pages look alike and are completely different facts. Saying "has published
  // nothing" about someone who published is a false sentence to the reader and an unfair one to
  // the subject — this is the "four causes collapsed into 0" failure wearing a privacy costume,
  // and the projection names the two apart so the page can.
  //
  // WHAT REACHES THIS STATE CHANGED, AND THE STATE DID NOT. It used to be reached by a public
  // `pending` leaflet; the tier gate that produced that is gone (see publicProjection.ts's
  // header — on real data it made every person page permanently empty). What still reaches it is
  // a leaf whose public set is entirely `excluded`, which is a different question: not "how
  // strongly proven is this?" but "whose work is this?". A canopy that printed it under this
  // person's name would be committing a FALSE ATTRIBUTION, which no disclosure fixes.
  const dir = await tempDir();
  const repo = await twoAuthorRepo(join(dir, "repo"));

  // The subject declares only their OWN address, so the other author's commits arrive `excluded`
  // — minted by the real producer out of real history, not written by hand.
  const document = await realLeafFrom(repo, "Offered Elsewhere", SUBJECT_EMAIL, join(dir, "a.leaf.json"));
  const leaf = await leafAt(document);
  const foreign = leaf.leaflets.find((l) => l.tier === "excluded");
  assert.ok(foreign !== undefined, "the fixture produced no excluded leaflet, so this proves nothing");

  // `share` refuses this offer since QA #15; an older or hand-edited document can still hold it.
  await markPublicInDocument(document, foreign.id);

  const load = await treeOf(dir, ["a.leaf.json"]);
  const page = renderPublicLeafPage(resolvePublicLeaf(load, leaf.id));
  assert.match(page, /data-public-state="nothing-publishable"/);
  assert.match(page, /Nothing here can be published as a claim\./);
  assert.doesNotMatch(page, /Nothing is published on this leaf\./);

  // The offered-but-unattributable artifact is STILL not served at its own address, and a
  // stranger asking for it gets the identical refusal as for an id nobody has.
  const view = resolvePublicLeaflet(load, foreign.id, leaf.id);
  assert.equal(view.kind, "not-reachable");
  assert.equal(publicLeafletStatus(view), 404);
  assert.equal(renderPublicLeafletPage(view).includes(foreign.title), false);
});

test("F-028 — the two causes of `nothing-publishable` are indistinguishable to a reader", async (t) => {
  /*
   * THE GUARD FOR F-028, and the assertion is an EQUALITY rather than a string match on purpose.
   *
   * `projectLeaf` reaches `nothing-publishable` from two facts and deliberately does not carry
   * which: everything offered is `excluded` (attribution), or everything offered is absolutely
   * DENIED by the publish rail. The projection's own header says why the reason may not travel —
   * "a public roster that printed 'withheld because …' would leak the very thing the rule
   * protects". It follows that the PAGE may not name a cause either, because naming one is
   * guessing, and a guess about a named person on the public plane is a false statement.
   *
   * That is exactly what shipped. Until 2026-09-04 the plate read "none of it could be attributed
   * to them" — true for the attribution cause, false for the rail cause, and the code comment
   * above it asserted the state "is now reached only when everything the subject offered is
   * `excluded`", which was never true. Measured on this fixture: a leaflet at tier `verified`,
   * signed and bound to a declared identity, published by its own subject, whose title rates the
   * builder — the page told a stranger the work could not be attributed to a
   * person it is attributed to, with zero `excluded` leaflets in the leaf.
   *
   * So the test does not police wording, which the next round of copy would drift out of anyway.
   * It pins the PROPERTY: render both causes and require that what a reader sees is byte-identical.
   * Any sentence that names either cause makes the two pages differ and fails this test — which is
   * the rule ("the cause does not travel") stated as something a machine can check.
   */
  const dir = await tempDir();

  // CAUSE ONE — THE RAIL. Real signed history, so the leaflet is `verified`: the strongest tier
  // this product has, refused not for doubt about the work but for the shape of its title.
  const railRepo = await signedRepo(join(dir, "rail"), SUBJECT_EMAIL, [
    "review: rated my engineering ability 4.5/5",
  ]);
  if (railRepo === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made — and a fake one proves nothing");
    return;
  }
  const railDoc = await realLeafFrom(railRepo, "Same Subject", SUBJECT_EMAIL, join(dir, "rail.leaf.json"));
  const railLeaf = await leafAt(railDoc);
  const railed = railLeaf.leaflets[0];
  assert.ok(railed !== undefined);
  assert.equal(railed.tier, "verified", "the rail case must be refused DESPITE the strongest tier");
  assert.equal(
    railLeaf.leaflets.filter((l) => l.tier === "excluded").length,
    0,
    "an excluded leaflet in this fixture would let the attribution sentence be accidentally true",
  );
  await share(railDoc, railed.id, "public");

  // CAUSE TWO — ATTRIBUTION. Somebody else's commit, marked `excluded` by the real producer.
  const otherRepo = await twoAuthorRepo(join(dir, "other"));
  const exDoc = await realLeafFrom(otherRepo, "Same Subject", SUBJECT_EMAIL, join(dir, "ex.leaf.json"));
  const exLeaf = await leafAt(exDoc);
  const foreign = exLeaf.leaflets.find((l) => l.tier === "excluded");
  assert.ok(foreign !== undefined, "the fixture produced no excluded leaflet, so this proves nothing");
  await markPublicInDocument(exDoc, foreign.id);

  // Same subject name and same company, so the only thing that could differ is the copy itself.
  const railLoad = await treeOf(dir, ["rail.leaf.json"], "Same Company");
  const exLoad = await treeOf(dir, ["ex.leaf.json"], "Same Company");
  const fromRail = renderPublicLeafPage(resolvePublicLeaf(railLoad, railLeaf.id));
  const fromExcluded = renderPublicLeafPage(resolvePublicLeaf(exLoad, exLeaf.id));

  assert.match(fromRail, /data-public-state="nothing-publishable"/);
  assert.match(fromExcluded, /data-public-state="nothing-publishable"/);

  /*
   * THE PROPERTY. Two different facts about a person, one page.
   *
   * Compared on the empty-state SECTION rather than the whole document, and on its raw markup
   * rather than its visible text. The document carries the manifest's `read` instant in its
   * footer, so two loads a millisecond apart differ for a reason that has nothing to do with
   * copy; and the raw section is the stronger comparison anyway, because it includes the
   * disclosure body — the place a cause would most plausibly be smuggled back in.
   */
  const emptySection = (html: string): string => {
    const found = /<section class="pub-empty"[\s\S]*?<\/section>/.exec(html);
    assert.ok(found !== null, "the page has no empty-state section to compare");
    return found[0];
  };
  assert.equal(
    emptySection(fromRail),
    emptySection(fromExcluded),
    "the page tells a reader which cause withheld the work — the projection refuses to carry " +
      "that, so any copy naming a cause is the renderer guessing about a named person",
  );

  /*
   * AND NOW THE ASSERTION THAT ACTUALLY GUARDS F-028 — recorded with its own failure, because the
   * first version of this test was WORTHLESS and only a mutation run proved it.
   *
   * The equality above cannot catch the shipped defect. The renderer has ONE branch for this
   * state, so one false sentence is printed for both causes and the two pages stay identical
   * while both lie. Reverting the fix and re-running left the equality green. It is kept, and it
   * earns its place guarding a DIFFERENT regression — a future renderer that learns the cause and
   * branches on it, which is the thing the projection's rule forbids — but it is not this row's
   * guard and must not be mistaken for it.
   *
   * The guard is a content assertion, and it has to be right about the words. The first attempt
   * searched for "could not be attributed to them" while the shipped sentence read "none of it
   * COULD be attributed to them" — a regex written from memory of the defect instead of from the
   * defect, so it could never have matched. Asserted here against `visibleText`, whose whitespace
   * is collapsed: the raw template wraps mid-phrase, and a regex over raw HTML would miss it for
   * a third reason.
   */
  for (const [name, page] of [["rail", fromRail], ["excluded", fromExcluded]] as const) {
    const visible = visibleText(page);
    assert.doesNotMatch(
      visible,
      /attributed to them/,
      `F-028 (${name}): this page names ATTRIBUTION as the cause. The rail can reach this state ` +
        `too — with the work attributed to its subject at tier verified — so the sentence is a ` +
        `false statement about a named person on the public plane`,
    );
    assert.match(
      visible,
      /none of it can be printed under their name here/,
      `${name}: the plate lost the sentence that says what IS true under both causes`,
    );
    assert.match(
      visible,
      /nothing here failed/,
      `${name}: the anti-inference is gone — a reader concludes this person's work was rejected`,
    );
  }
});

test("unproven work its subject offered IS published, with the tier printed beside it", async () => {
  // THE OTHER HALF OF THE SAME CHANGE, and the one that had no test at all: the old gate is gone,
  // so a `pending` artifact the subject marked public is listed. That is only honest if the page
  // says what it proves — the gate was replaced by a DISCLOSURE, so the disclosure has to be on
  // the page or this is exactly the overclaim the gate was defending against.
  const dir = await tempDir();
  const identity = await realIdentity();
  const document = await realLeafFrom(REPO, "Offered Unproven", identity, join(dir, "a.leaf.json"));
  const leaf = await leafAt(document);
  const first = firstPublishable(leaf);
  assert.equal(first.tier, "pending", "this repository's history is unsigned, so intake says pending");

  await share(document, first.id, "public");

  const load = await treeOf(dir, ["a.leaf.json"]);
  const page = renderPublicLeafPage(resolvePublicLeaf(load, leaf.id));
  assert.match(page, /data-public-state="listed"/);
  // ESCAPED, and the escaping is the whole reason this line reads oddly. The title comes out of
  // THIS repository's real git history, and on 2026-08-20 a commit subject landed carrying an
  // apostrophe ("a reasoning model's spilled thinking") — which the renderer correctly writes as
  // `&#39;`, so a raw `includes` went red on a page that was perfectly right. The test was
  // comparing prose to HTML. Nothing about the product changed; the assertion had been true only
  // for as long as nobody wrote a possessive in a commit message.
  assert.ok(
    page.includes(esc(first.title)),
    "the artifact its subject published is not on their page",
  );

  // AND THE PAGE SAYS WHAT IT DOES NOT PROVE, in words rather than by omission.
  const view = resolvePublicLeaflet(load, first.id, leaf.id);
  assert.equal(view.kind, "artifact");
  assert.equal(publicLeafletStatus(view), 200);
  const artifact = renderPublicLeafletPage(view);
  assert.match(artifact, /NOT cryptographically established/);
});

test("Tree shares withhold an email-like identifier from both the person row and linked artifact", async () => {
  const dir = await tempDir();
  const repo = join(dir, "repo");
  const privateAddress = "reviewer@external.example";
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "--initial-branch=main", "-q");
  await git(repo, "config", "user.name", "Redaction Subject");
  await git(repo, "config", "user.email", "redaction-subject@example.com");
  await writeFile(join(repo, "work.txt"), "real work\n", "utf8");
  await git(repo, "add", "work.txt");
  await git(repo, "-c", "commit.gpgsign=false", "commit", "-m",
    "feat: work with " + privateAddress + " on launch");

  const document = await realLeafFrom(repo, "Redaction Subject",
    "redaction-subject@example.com", join(dir, "redaction.leaf.json"));
  const leaf = await leafAt(document);
  const record = leaf.leaflets[0];
  assert.ok(record !== undefined);
  assert.ok(record.title.includes(privateAddress), "the real commit must carry the identifier");
  await share(document, record.id, "public");

  const load = await treeOf(dir, ["redaction.leaf.json"]);
  const person = renderPublicLeafPage(resolvePublicLeaf(load, leaf.id));
  const detail = renderPublicLeafletPage(resolvePublicLeaflet(load, record.id, leaf.id));
  for (const [name, html] of [["person", person], ["artifact", detail]] as const) {
    assert.equal(html.includes(privateAddress), false, name + " leaks the third-party address");
    assert.match(html, /\[withheld: email address\]/, name + " does not disclose the redaction");
    assert.match(html, /data-title-redacted="true"/, name + " does not mark changed wording");
    assert.doesNotMatch(html, /data-verbatim="title"/, name + " falsely attests changed text");
  }
});

/* ==========================================================================================
   4 — WHAT THE ARTIFACT PAGE SAYS. Real signatures, because `verified` cannot be written.
   ========================================================================================== */

/**
 * A real signed repository, taken all the way to a published artifact page.
 *
 * Returns null when ssh-keygen is missing so the callers can skip loudly.
 */
async function publishedArtifact(): Promise<
  { load: TreeLoad; leaf: Leaf; id: string; title: string; ref: string } | null
> {
  const dir = await tempDir();
  const email = "signed@example.com";
  const repo = await signedRepo(join(dir, "repo"), email, [
    "feat: the extractor stops asserting a tier it never checked",
    "fix: the roster stops sorting people by their evidence",
  ]);
  if (repo === null) return null;

  const document = await realLeafFrom(repo, "Signed Person", email, join(dir, "s.leaf.json"));
  const leaf = await leafAt(document);
  const first = leaf.leaflets[0];
  assert.ok(first !== undefined);
  assert.equal(first.tier, "verified", "a real accepted signature bound to a declared identity");
  await share(document, first.id, "public");

  const ref = "provenance" in first ? first.provenance?.ref : undefined;
  assert.ok(ref !== undefined);
  return {
    load: await treeOf(dir, ["s.leaf.json"], "Signed Company"),
    leaf,
    id: first.id,
    title: first.title,
    ref,
  };
}

test("a published artifact renders its evidence, its tier and whose leaf it is on", async (t) => {
  const fixture = await publishedArtifact();
  if (fixture === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made — and a fake one would prove nothing");
    return;
  }
  const { load, leaf, id, title, ref } = fixture;

  const view = resolvePublicLeaflet(load, id, null);
  assert.equal(view.kind, "artifact");
  assert.equal(publicLeafletStatus(view), 200);
  const page = renderPublicLeafletPage(view);

  assert.match(page, /data-public-state="artifact"/);
  assert.match(page, /data-tier="verified"/);
  assert.ok(page.includes(title), "the artifact does not carry its own title");
  assert.ok(page.includes(ref), "the artifact does not carry the evidence ref it rests on");
  assert.ok(page.includes(leaf.subject), "the artifact does not say whose leaf it is on");

  // THE BADGE CARRIES BOTH SPELLINGS. `foliage.css` styles `.proof-verified`; the assertions key
  // on `data-pill-tier`. A badge that lost its modifier renders untinted and still reads as a
  // badge, so neither can be dropped without the other noticing.
  assert.match(page, /class="proof proof-verified" data-pill-tier="verified"/);
  // And the tier is not a badge alone: the page says what the word does and does not promise.
  // The sentence is asserted over the VISIBLE page — see the density gate at the bottom of this
  // file for why that distinction is the whole point of the disclosure pass.
  assert.match(page, /data-standing="outward"/);
  assert.match(
    visibleText(page),
    /It says who wrote the thing, not how good it is/,
    "a reader must not have to open anything to learn that `verified` is a statement about " +
      "authorship and not about quality",
  );

  // THE TITLE IS ATTESTED AS THE ARTIFACT'S OWN WORDS, and only because its provenance names the
  // source whose copying line this module can point at (`GIT_SOURCE`). The attribute is an
  // attestation and the no-score check is scoped by it; emitting it over a drafted title would
  // both misattribute the words and exempt them from the gate.
  assert.match(page, /<h1 data-verbatim="title">/);

  // THE WINDOW TITLE IS NOT THE ARTIFACT'S TITLE. `<title>` escapes the page — tab, history,
  // bookmark, link preview — and a real commit subject can carry a third party's address.
  const windowTitle = page.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  assert.equal(windowTitle.includes(title), false, "the commit subject is in the window title");
  assert.equal(windowTitle.includes("@"), false, "an address reached the window title");
  assert.match(windowTitle, /^Foliage — verified artifact [0-9a-f]{12}$/);

  // The person page now lists exactly this one artifact, with the count beside it.
  const person = renderPublicLeafPage(resolvePublicLeaf(load, leaf.id));
  assert.match(person, /data-public-state="listed"/);
  assert.equal([...person.matchAll(/data-published-row="true"/g)].length, 1);
  assert.match(person, /<b class="fol-metric">1<\/b>/);
  // The SECOND, unshared artifact of the same real document is absent from it. One number on
  // this page, and it counts only what was published.
  const second = leaf.leaflets[1];
  assert.ok(second !== undefined);
  assert.equal(person.includes(second.title), false, "an unshared artifact is listed anyway");
});

test("two people publishing one id is reported, not silently answered with the first", async (t) => {
  // THE COLLISION IS ORDINARY, NOT A CORNER CASE. `LeafletId` is unique inside one document and
  // nothing makes it unique across a company: intake mints `git:<sha>`, so two colleagues who
  // draw evidence from the same repository mint the same id. Answering with the first match
  // would attribute one person's work to an address that equally names another's.
  const dir = await tempDir();
  const email = "shared@example.com";
  const repo = await signedRepo(join(dir, "repo"), email, ["feat: work two colleagues both cite"]);
  if (repo === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }

  const a = await realLeafFrom(repo, "Colleague A", email, join(dir, "a.leaf.json"));
  const b = await realLeafFrom(repo, "Colleague B", email, join(dir, "b.leaf.json"));
  const leafA = await leafAt(a);
  const leafB = await leafAt(b);
  const id = leafA.leaflets[0]?.id;
  assert.ok(id !== undefined);
  assert.equal(id, leafB.leaflets[0]?.id, "the two documents did not in fact collide");
  await share(a, id, "public");
  await share(b, id, "public");

  const load = await treeOf(dir, ["a.leaf.json", "b.leaf.json"]);

  // Unqualified: reported as what it is, with a status that says so.
  const ambiguous = resolvePublicLeaflet(load, id, null);
  assert.equal(ambiguous.kind, "ambiguous");
  assert.equal(publicLeafletStatus(ambiguous), 300);
  const page = renderPublicLeafletPage(ambiguous);
  assert.match(page, /data-public-state="ambiguous"/);
  assert.equal([...page.matchAll(/data-ambiguous-row="true"/g)].length, 2);
  assert.ok(page.includes("Colleague A") && page.includes("Colleague B"));

  // Qualified: each person's own address resolves to their own artifact, and to one only.
  for (const person of [leafA, leafB]) {
    const one = resolvePublicLeaflet(load, id, person.id);
    assert.equal(one.kind, "artifact");
    assert.equal(publicLeafletStatus(one), 200);
    const artifact = renderPublicLeafletPage(one);
    assert.ok(artifact.includes(person.subject));
    const other = person === leafA ? leafB : leafA;
    assert.equal(artifact.includes(other.subject), false, "the artifact names the wrong person");
  }

  // And every link the person page renders is the qualified form, so a reader following the
  // roster can never land on the disambiguation page by accident.
  const roster = renderPublicLeafPage(resolvePublicLeaf(load, leafA.id));
  const hrefs = [...roster.matchAll(/href="(\/leaflet\/[^"]*)"/g)].map((m) => m[1] as string);
  assert.ok(hrefs.length > 0, "the person page offers no way into the artifact");
  for (const href of hrefs) {
    assert.match(href, /\?leaf=/, `${href} is unqualified and can resolve to somebody else`);
  }
});

/* ==========================================================================================
   5 — NO SCORE, and the rest of what the chrome may not say.
   ========================================================================================== */

test("NO SCORE — not on either page, in any of their states, with no exempt region at all", async (t) => {
  const fixture = await publishedArtifact();
  if (fixture === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  const { load, leaf, id } = fixture;

  const pages: [string, string][] = [
    ["person listed", renderPublicLeafPage(resolvePublicLeaf(load, leaf.id))],
    ["person absent", renderPublicLeafPage(resolvePublicLeaf(load, "nobody"))],
    ["artifact", renderPublicLeafletPage(resolvePublicLeaflet(load, id, null))],
    ["refusal", renderPublicLeafletPage(resolvePublicLeaflet(load, "git:nope", null))],
  ];

  /*
   * `/tree` needs two exempt regions, because the section whose whole purpose is to say that no
   * rating is produced cannot state the invariant without naming it. THESE PAGES NEED NONE, and
   * that is a stronger result rather than an accident: the copy was written to describe what the
   * page shows rather than to disclaim what it does not, so there is nothing to carve out. An
   * exemption is a hole, and the one this file does not have cannot be widened.
   */
  for (const [name, html] of pages) {
    for (const word of ["score", "rating", "rank", "grade", "percentile", "out of"]) {
      assert.equal(
        html.toLowerCase().includes(word),
        false,
        `the ${name} page contains "${word}", and this surface has no exempt region`,
      );
    }
    assert.doesNotMatch(html, /data-policy=/, `the ${name} page carves out an exempt region`);
  }
});

test("the chrome of every state: one sprite reference set, no inline style, no path data", async (t) => {
  const fixture = await publishedArtifact();
  if (fixture === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  const { load, leaf, id } = fixture;

  const sprite = await readFile(
    fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")),
    "utf8",
  );
  const symbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string));

  const unloadable = await loadTreeDocument({});
  const states: [string, string][] = [
    ["person listed", renderPublicLeafPage(resolvePublicLeaf(load, leaf.id))],
    ["person absent", renderPublicLeafPage(resolvePublicLeaf(load, "nobody"))],
    ["person unloadable", renderPublicLeafPage(resolvePublicLeaf(unloadable, "anyone"))],
    ["artifact", renderPublicLeafletPage(resolvePublicLeaflet(load, id, null))],
    ["refusal", renderPublicLeafletPage(resolvePublicLeaflet(load, "git:nope", null))],
    ["artifact unloadable", renderPublicLeafletPage(resolvePublicLeaflet(unloadable, "x", null))],
  ];

  for (const [name, html] of states) {
    // A `<use>` that points at nothing renders nothing at all and does not warn.
    const uses = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1] as string);
    assert.ok(uses.length > 0, `${name} references no symbol, so the mark is not rendered`);
    assert.deepEqual(
      uses.filter((u) => !symbols.has(u)),
      [],
      `${name} references an id @foliage/tokens/foliage-sprite.svg does not define`,
    );
    // Path data on the page means somebody pasted geometry back in — how a stale mark survived
    // in this repository for weeks. The sprite itself is injected by `server.mjs`, not here.
    assert.doesNotMatch(html, /<path\b/i, `${name} inlines path data instead of referencing it`);
    // Inline specificity beats every selector without `!important`, so a media query silently
    // does nothing against it — which is how a responsive fix "lands" and changes nothing.
    assert.deepEqual(
      [...html.matchAll(/\sstyle="[^"]*"/g)].map((m) => m[0]),
      [],
      `${name} emits an inline style attribute`,
    );
    // Day face, and it is a property of what the surface IS. These are documents somebody else
    // reads; night is for instrument surfaces.
    assert.match(html, /<html lang="en" data-face="day">/, `${name} is not on the public face`);
    // Portfolio composition follows the shared cascade only on leaf pages.
    assert.deepEqual(
      [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]),
      ["/foliage-tokens.css", "/roles.css", "/foliage.css", "/tree.css",
        ...(html.includes('data-canopy-surface="leaf"') ? ["/portfolio.css"] : [])],
      `${name} links the design system in the wrong order`,
    );
  }
});

test("a tree that will not load is reported as that, never as a person with nothing", async () => {
  // The five load causes belong to the TREE and they failed identically no matter which page
  // asked. Rendering "this person has published nothing" over a manifest nobody could read
  // would be a statement about someone whose document was never opened.
  const dir = await tempDir();
  for (const [env, status] of [
    [{}, 200],
    [{ [TREE_ENV]: join(dir, "nope.json") }, 404],
  ] as const) {
    const load = await loadTreeDocument(env);
    const leafView = resolvePublicLeaf(load, "anyone");
    const leafletView = resolvePublicLeaflet(load, "git:anything", null);
    assert.equal(leafView.kind, "unloadable");
    assert.equal(leafletView.kind, "unloadable");
    assert.equal(publicLeafStatus(leafView), status);
    assert.equal(publicLeafletStatus(leafletView), status);
    for (const html of [renderPublicLeafPage(leafView), renderPublicLeafletPage(leafletView)]) {
      if (!load.ok && load.cause === "unconfigured") {
        assert.match(html, /Nothing published here yet\./);
        assert.doesNotMatch(html, /FOLIAGE_TREE|No tree could be read/);
      } else {
        assert.match(html, /No tree could be read\./);
        assert.match(html, /Nothing was counted and nothing\s+was guessed/);
      }
      assert.doesNotMatch(html, /data-published-row/);
      assert.doesNotMatch(html, /data-public-empty/);
    }
  }
});

test("an id that cannot even be decoded is an id nobody has, not a 500", async () => {
  // `%zz` reaches the route as a string `decodeURIComponent` throws on. A stack trace here would
  // be an existence oracle with extra steps: it separates "this id is malformed" from "this id
  // is private", which is exactly the distinction the refusal exists to withhold.
  const dir = await tempDir();
  const identity = await realIdentity();
  await realLeafFrom(REPO, "Decoder", identity, join(dir, "a.leaf.json"));
  const load = await treeOf(dir, ["a.leaf.json"]);

  for (const id of ["%zz", "%", "../../etc/passwd", "git:" + "f".repeat(40)]) {
    const view = resolvePublicLeaflet(load, id, null);
    assert.equal(view.kind, "not-reachable", `${id} did not fall through to the one refusal`);
    assert.equal(publicLeafletStatus(view), 404);
    // Escaped on the way out. An id is not a string this surface gets to trust.
    const html = renderPublicLeafletPage(view);
    assert.doesNotMatch(html, /<script/i);
  }

  // A traversal-shaped id reaches no filesystem: it is looked up in documents already in memory.
  const traversal = resolvePublicLeaf(load, "../../../etc/passwd");
  assert.equal(traversal.kind, "no-such-leaf");
  assert.equal(publicLeafStatus(traversal), 404);
});

test("the roster on /tree links every person, including those who published nothing", async () => {
  // The absence of a link would itself announce, on the roster, which of these people have
  // published nothing — a disclosure the link's own destination does not make, since that page
  // says the same thing to anyone who opens it.
  const { renderTreePage } = await import("./renderTree.ts");
  const dir = await tempDir();
  const identity = await realIdentity();
  await realLeafFrom(REPO, "Linked One", identity, join(dir, "a.leaf.json"));
  await realLeafFrom(REPO, "Linked Two", identity, join(dir, "b.leaf.json"));
  const load = loaded(await treeOf(dir, ["a.leaf.json", "b.leaf.json"]));

  const html = renderTreePage(load);
  const hrefs = [...html.matchAll(/href="(\/leaf\/[^"]*)"/g)].map((m) => m[1] as string);
  assert.equal(hrefs.length, 2, "every roster row must offer a way into that person");

  // And every one of those links resolves to that person's real page rather than a refusal.
  for (const leaf of load.tree.leaves) {
    const view = resolvePublicLeaf(load, leaf.id);
    assert.equal(view.kind, "person", `${leaf.id} is linked from the roster and does not resolve`);
    assert.equal(publicLeafStatus(view), 200);
  }
});

/* ==========================================================================================
   6 — DENSITY, AND THE HALF OF IT THAT IS AN HONESTY GATE.

   MEASURED ON THE REAL RENDERED PAGES, 2026-08-19, before the disclosure pass:

     /leaf/<id> listing 8 real artifacts   256 words, 145 of them prose about how it works
     /leaf/<id> nothing-offered            150 words
     /leaf/<id> nothing-publishable        173 words
     /leaflet/<id> one artifact            132 words, 93 of them prose
     /leaflet/<id> not-reachable           125 words

   This is the PUBLIC plane. A recruiter or a board member lands cold, does not care how the
   product works, and will not read four paragraphs about proof tiers before looking at somebody's
   work. `CLAUDE.md` states the rule and the cause: the comment discipline this repository is
   right to use in a `.ts` file — say WHY, name the trap — is wrong in rendered HTML.

   TWO TESTS AND THE SECOND ONE IS THE IMPORTANT ONE. A word budget alone is satisfied perfectly
   by deleting every caveat, which would be a different and dishonest product. So the budget is
   paired with a gate on what may never be behind a disclosure, and neither is meaningful alone.
   ========================================================================================== */

/**
 * The guard on the guard: prove the stripper actually stripped before trusting what it returned.
 *
 * Without this, a renamed element or a changed close-tag makes `withoutDisclosures` a no-op, every
 * "this is visible" assertion in the next test starts passing over collapsed text, and the gate is
 * vacuous while green. That failure mode is silent, which is exactly the kind this file exists for.
 *
 * A page with NO `<details>` at all is not vacuous — every word on it is visible, which is the
 * strongest case for the visibility assertions — so the guard binds whenever a disclosure exists,
 * and `assertSomeStripped` below keeps at least one real strip in every run.
 */
function assertStripped(html: string, what: string): boolean {
  if (!/<details\b/.test(html)) return false;
  assert.ok(
    withoutDisclosures(html).length < html.length,
    `withoutDisclosures removed nothing from ${what}. The stripper no longer matches the markup, ` +
      `so every visibility assertion in this file is now checking text a reader cannot see`,
  );
  return true;
}

/** At least one page in a measured set must carry a disclosure the stripper provably removes. */
function assertSomeStripped(stripped: readonly boolean[], what: string): void {
  assert.ok(
    stripped.some(Boolean),
    `no page in ${what} carried a disclosure, so the stripper was never exercised this run`,
  );
}

test("DENSITY — a reader can use these pages without reading, measured on the real page", async (t) => {
  const fixture = await publishedArtifact();
  if (fixture === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }
  const { load, leaf, id } = fixture;

  /*
   * THE BUDGETS ARE THE MEASURED "AFTER" WITH HEADROOM, NOT AN ASPIRATION. Each is stated with
   * the "before" beside it so a reader of a failure knows which direction the page moved.
   *
   * THE ARTIFACT LIST IS CONTENT AND IS NOT BUDGETED AWAY. A person's page grows with the number
   * of artifacts they published — each row is a real title, a real ref and a tier — so the budget
   * is set on a ONE-ARTIFACT document, where the chrome is nearly the whole page and an essay
   * cannot hide behind real content.
   */
  const pages: { name: string; html: string; before: number; budget: number }[] = [
    {
      name: "/leaf/<id> listing one artifact",
      html: renderPublicLeafPage(resolvePublicLeaf(load, leaf.id)),
      before: 256,
      budget: 90,
    },
    {
      name: "/leaflet/<id> one artifact",
      html: renderPublicLeafletPage(resolvePublicLeaflet(load, id, null)),
      before: 132,
      budget: 110,
    },
    {
      name: "/leaflet/<id> refusal",
      html: renderPublicLeafletPage(resolvePublicLeaflet(load, "git:nope", null)),
      before: 125,
      budget: 80,
    },
    {
      name: "/leaf/<id> no such leaf",
      html: renderPublicLeafPage(resolvePublicLeaf(load, "nobody")),
      before: 86,
      budget: 70,
    },
    /*
     * THE `nothing-publishable` PAGE, WHICH HAD NO BUDGET ROW UNTIL 2026-09-04 even though the
     * header above has carried its 173-word "before" figure since the disclosure pass. F-028
     * rewrote this page's plate and its disclosure, and the gap meant that rewrite landed with
     * no word budget over it at all — a page can only be governed by a row that exists.
     *
     * MEASURED 2026-09-04 on the page this fixture renders: 67 words. The budget is 80, the same
     * measured-with-headroom rule the rows above follow — not the 67 itself, which would fail on
     * a longer subject name and teach the next author to shave a caveat to get green.
     */
    {
      name: "/leaf/<id> nothing-publishable",
      html: renderPublicLeafPage(resolvePublicLeaf(await nothingPublishableLoad(), "empty-handed")),
      before: 173,
      budget: 80,
    },
  ];

  assertSomeStripped(pages.map(({ name, html }) => assertStripped(html, name)), "the density set");
  for (const { name, html, before, budget } of pages) {
    const visible = wordCount(visibleText(html));
    assert.ok(
      visible <= budget,
      `${name} renders ${visible} words before a reader opens anything, over the budget of ` +
        `${budget}. It was ${before} before the disclosure pass. If the new words are a caveat, ` +
        `it belongs behind \`disclose\`; if they are rationale, it belongs in ` +
        `docs/ENGINEERING-PLAN.md and not on a page a stranger lands on`,
    );

    /*
     * AND THE PROSE DID NOT MERELY MOVE OFF-SCREEN INTO A LONGER SENTENCE. A page can hit a word
     * budget with one 40-word sentence, which is unreadable in a different way.
     *
     * MEASURED PER PARAGRAPH, NOT OVER THE PAGE, and the first version of this assertion got that
     * wrong: run over the whole visible text it reported a 42-word "sentence" on a page whose
     * longest paragraph is 14 words. A list row carries no terminal punctuation — a title, a ref,
     * "Open this artifact", a tier — so a naive full-stop split welds the entire artifact list
     * into one sentence and then flags the CONTENT this surface exists to show. Prose is what
     * lives in a `<p>`; that is what is budgeted.
     */
    const long = [...withoutDisclosures(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .flatMap((m) =>
        textOf(m[1] as string)
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.split(/\s+/).filter(Boolean).length),
      )
      .filter((n) => n > 32);
    assert.deepEqual(long, [], `${name} carries a paragraph sentence longer than 32 words`);
  }
});

test("HONESTY — what may never be behind a disclosure, on every state of both pages", async (t) => {
  /*
   * THE OTHER HALF OF THE DENSITY PASS, AND THE HALF THAT MAKES IT A RELOCATION RATHER THAN A
   * DELETION. `CLAUDE.md`: "Cutting text must never cut a caveat. Relocate, never delete." The
   * test for whether a sentence may move is whether a reasonable person would be MISLED by its
   * absence from the visible page — and on the PUBLIC plane the worst such inference is proof
   * that does not exist. Each string below fails that test and is therefore asserted VISIBLE,
   * which is a strictly stronger claim than "present in the bytes": the previous assertions in
   * this file would all have passed with these sentences collapsed inside a `<details>`.
   */
  const fixture = await publishedArtifact();
  if (fixture === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made");
    return;
  }

  // A REAL UNSIGNED ARTIFACT, which is the case that matters most: this repository's own history
  // is unsigned, intake says `pending`, and the subject published it. A reader must not be able
  // to take that page for proof.
  const dir = await tempDir();
  const identity = await realIdentity();
  const doc = await realLeafFrom(REPO, "Unsigned Publisher", identity, join(dir, "a.leaf.json"));
  const before = await leafAt(doc);
  const pendingLeaflet = firstPublishable(before, "pending");
  await share(doc, pendingLeaflet.id, "public");
  const unsigned = loaded(await treeOf(dir, ["a.leaf.json"]));

  const pendingArtifact = renderPublicLeafletPage(
    resolvePublicLeaflet(unsigned, pendingLeaflet.id, null),
  );
  assertStripped(pendingArtifact, "the pending artifact page");
  // The artifact page carries no disclosure any more; the person page's source details do.
  const pendingPerson = renderPublicLeafPage(resolvePublicLeaf(unsigned, before.id));
  assertSomeStripped([assertStripped(pendingPerson, "the pending person page")], "the honesty set");
  assert.match(
    visibleText(pendingArtifact),
    /Authorship is NOT cryptographically established/,
    "an unproven artifact is on the public plane with nothing visible saying it is unproven. " +
      "This is the sentence the whole product turns on and it may never move behind a summary",
  );

  // THE EXAMPLE-DOCUMENT MARKER, on a document that really declares itself one. Non-negotiable
  // and always visible, at any density: without it a reader takes an illustration for a finding
  // about a named person.
  const exDir = await tempDir();
  const example = fileURLToPath(new URL("../../leaf/example/leaf.example.json", import.meta.url));
  await writeFile(join(exDir, "e.leaf.json"), await readFile(example, "utf8"));
  const exLeaf = await leafAt(join(exDir, "e.leaf.json"));
  const exFirst = exLeaf.leaflets[0];
  assert.ok(exFirst !== undefined, "the shipped example document holds no leaflet");
  await share(join(exDir, "e.leaf.json"), exFirst.id, "public");
  const exLoad = loaded(await treeOf(exDir, ["e.leaf.json"], "EXAMPLE COMPANY — NOT REAL"));
  const exPage = renderPublicLeafletPage(
    resolvePublicLeaflet(exLoad, exFirst.id, exLeaf.id),
  );
  const exVisible = visibleText(exPage);
  assert.match(exVisible, /Example tree — not a real company/, "the fabrication band is hidden");
  assert.match(exVisible, /Nothing on this page describes a real company or real people/);
  assert.match(exVisible, /Example document/, "the example-document marker is hidden");
  assert.match(exVisible, /no evidence on this page was observed/);

  // THE TWO EMPTY STATES, which say different things about a person and must both say them out
  // loud. `nothing-offered` additionally has to prevent the inference a reader will otherwise
  // make — that this person has done nothing.
  const quietDir = await tempDir();
  await realLeafFrom(REPO, "Quiet Publisher", identity, join(quietDir, "a.leaf.json"));
  const quiet = loaded(await treeOf(quietDir, ["a.leaf.json"]));
  const quietPage = renderPublicLeafPage(resolvePublicLeaf(quiet, "quiet-publisher"));
  const quietVisible = visibleText(quietPage);
  assert.match(quietVisible, /Nothing is published on this leaf\./);
  assert.match(
    quietVisible,
    /This page says nothing about what else the leaf holds/,
    "a page saying only that nothing is published invites a reader to conclude this person has " +
      "done nothing, which is a false statement about them",
  );

  // An unconfigured reader is a public empty state, not operator setup instructions.
  const unconfigured = await loadTreeDocument({});
  for (const html of [
    renderPublicLeafPage(resolvePublicLeaf(unconfigured, "anyone")),
    renderPublicLeafletPage(resolvePublicLeaflet(unconfigured, "git:x", null)),
  ]) {
    assert.match(visibleText(html), /Nothing published here yet/);
    assert.doesNotMatch(visibleText(html), /FOLIAGE_TREE/);
  }
  // A configured but unreadable tree still says no data was counted or guessed.
  const missingTree = await loadTreeDocument({ [TREE_ENV]: join(await tempDir(), "absent.json") });
  for (const html of [
    renderPublicLeafPage(resolvePublicLeaf(missingTree, "anyone")),
    renderPublicLeafletPage(resolvePublicLeaflet(missingTree, "git:x", null)),
  ]) {
    assert.match(visibleText(html), /Nothing was counted and nothing was guessed/);
  }
});

test("every public tree route carries the fabrication band on an example tree", async () => {
  // CONTROL. The band is the only thing telling a reader an example is not a real person, and
  // each route calls it on its own — so each route is rendered here, not one of them.
  const dir = await tempDir();
  const example = JSON.parse(
    await readFile(fileURLToPath(new URL("../../leaf/example/leaf.example.json", import.meta.url)), "utf8"),
  );
  await writeFile(join(dir, "a.leaf.json"), JSON.stringify(example));
  await writeFile(
    join(dir, "b.leaf.json"),
    JSON.stringify({ ...example, id: `${example.id}-b`, subject: `${example.subject} B` }),
  );
  const leaf = await leafAt(join(dir, "a.leaf.json"));
  const first = leaf.leaflets[0];
  assert.ok(first !== undefined, "the shipped example document holds no leaflet");
  await share(join(dir, "a.leaf.json"), first.id, "public");
  await share(join(dir, "b.leaf.json"), first.id, "public");
  const load = loaded(await treeOf(dir, ["a.leaf.json", "b.leaf.json"], "EXAMPLE COMPANY — NOT REAL"));

  const ambiguous = resolvePublicLeaflet(load, first.id, null);
  assert.equal(ambiguous.kind, "ambiguous", "the fixture must reach the ambiguous page");
  const pages: ReadonlyArray<readonly [string, string]> = [
    ["person", renderPublicLeafPage(resolvePublicLeaf(load, leaf.id))],
    ["no such leaf", renderPublicLeafPage(resolvePublicLeaf(load, "nobody-here"))],
    ["artifact", renderPublicLeafletPage(resolvePublicLeaflet(load, first.id, leaf.id))],
    ["leaflet refusal", renderPublicLeafletPage(resolvePublicLeaflet(load, "git:nothing-here", null))],
    ["ambiguous", renderPublicLeafletPage(ambiguous)],
  ];
  for (const [name, html] of pages) {
    assert.match(html, /data-fabricated="true"/, `${name}: the band is gone`);
    assert.match(visibleText(html), /Example tree — not a real company/, `${name}: the band label is hidden`);
  }
});
