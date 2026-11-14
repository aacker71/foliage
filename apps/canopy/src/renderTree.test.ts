/**
 * THE LEDGER LEAK ON `/tree`, AND THE RULE THAT CLOSES IT: A PUBLIC SURFACE MAY ONLY COUNT WHAT
 * IT MAY SHOW.
 *
 * WHAT WAS MEASURED, 2026-08-19. `/tree` is the first hop of the public chain and it carries a
 * band reading "Public canopy · Anyone may read this". Every roster row rendered
 * `attributionLedger(leaf)` — Verified / Pending / Excluded — computed over the RAW `Leaf`. A leaf
 * document is a person's WHOLE portfolio, so those three integers counted, into a figure a
 * stranger reads:
 *
 *   - every `private` leaflet (the domain default, expressed by the field's absence);
 *   - every `unlisted` one, whose entire consent is that it is NOT enumerated;
 *   - every `pending` one, which is unproven work the canopy refuses to restate outward;
 *   - every `excluded` one, which is work that turned out to be somebody else's.
 *
 * `publicProjection.ts` exists to refuse exactly this reasoning one level down — "a total that
 * includes unlisted leaflets has leaked their existence just as surely as printing their titles"
 * — and `/tree` was committing it one level up, for every person on the roster at once.
 *
 * ------------------------------------------------------------------------------------------
 * THIS FILE IS THE DIFFERENTIAL. One real document holding all five kinds of leaflet at once, in
 * counts chosen to be mutually distinct, so that every figure the raw document could produce is a
 * DIFFERENT integer from the one the projection produces. Then: render the page and require the
 * only figure in a roster row to be the projection's.
 *
 * A test that merely asserted "the row says 4" would pass on a page that computed 4 the wrong way
 * and got lucky. So the forbidden set is computed HERE, from the same document, through the same
 * domain function the page used to call, and the page is required to contain none of it.
 *
 * ------------------------------------------------------------------------------------------
 * NOTHING IN THIS FILE IS HAND-WRITTEN EVIDENCE, and that is not decoration. `verified` means git
 * accepted a signature and bound the signer to a declared identity; a hand-written
 * `"tier": "verified"` is precisely the claim the product refuses to let anyone make without
 * cryptography, and a test that made it would be asserting over a string. So this file builds a
 * REAL repository, signs REAL commits with a REAL ed25519 key from stock `ssh-keygen`, runs the
 * REAL intake over it, and offers leaflets outward through the REAL `share.mjs` command. Where
 * `ssh-keygen` is absent it reports itself SKIPPED rather than passing quietly.
 *
 * `signedRepo` is a THIRD copy of the helper `renderPublic.test.ts` and `seam.test.ts` each carry.
 * That is deliberate rather than lazy: `node --test` runs colocated files that own their own
 * fixtures, there is no shared test module in this app, and inventing one would put the thing
 * every gate depends on into a file no gate covers. The copies differ where the measurement
 * differs — this one has to mix signed, unsigned and third-party commits in ONE history, which
 * neither of the others needs.
 *
 * DISCIPLINE: every child process is non-interactive with a deadline, and every temporary tree is
 * removed in an `after` hook.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { attributionLedger, parseLeafDocument, type Leaf, type Leaflet } from "@foliage/leaf";
import { projectLeaf as projectLeafWith } from "@foliage/canopy";
// Projections in this file run under the DEFAULT policy — the rail on, as the loader would.
import { defaultPublishPolicy, type Leaf as _LeafForShim } from "@foliage/leaf";
const _parsedDefault = defaultPublishPolicy();
if (!_parsedDefault.ok) throw new Error("the built-in default publish policy failed to parse");
const projectLeaf = (leaf: _LeafForShim) => projectLeafWith(leaf, _parsedDefault.policy);


import { renderTreePage } from "./renderTree.ts";
import { renderCanopyPage } from "./renderCanopy.ts";
import {
  renderPublicLeafPage,
  renderPublicLeafletPage,
  resolvePublicLeaf,
  resolvePublicLeaflet,
} from "./renderPublic.ts";
import { TREE_ENV, loadTreeDocument, type TreeLoad } from "./treeDocument.ts";

const exec = promisify(execFile);

const INTAKE = fileURLToPath(new URL("../../leaf/intake.mjs", import.meta.url));
const SHARE = fileURLToPath(new URL("../../leaf/share.mjs", import.meta.url));
const RENDER_TREE = fileURLToPath(new URL("./renderTree.ts", import.meta.url));

/**
 * Seal off the developer's own git configuration for every git this file causes to run.
 *
 * Whether a signature verifies is decided by `gpg.ssh.allowedSignersFile`, so a developer with one
 * configured globally would measure something different from a developer without. `-c` cannot
 * express "unset"; sealing the files git reads can.
 */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-tree-"));
  tmpRoots.push(dir);
  return dir;
}

const git = (dir: string, ...args: string[]): Promise<string> =>
  exec("git", ["-C", dir, ...args], { env: GIT_ENV, timeout: 60_000 }).then((r) => r.stdout);

/* ==========================================================================================
   THE FIXTURE — one real history that yields all three tiers for one subject.
   ========================================================================================== */

/**
 * How many commits of each kind. Chosen so that EVERY figure derivable from the raw document is a
 * distinct integer, and none of them equals the projection's answer:
 *
 *   verified 6, pending 7, excluded 9, whole document 22 — and the pairwise sums 13, 15, 16.
 *   Published, and therefore the only number the page may print: 8.
 *
 * Distinctness is what makes a failure legible. With 2/2/2 a page printing the wrong number would
 * print the right one by coincidence, and the test would be green on a leak.
 *
 * THE PUBLISHED COUNT WAS 4 AND IS NOW 8, because the tier gate is gone (see the header of
 * `packages/canopy/src/publicProjection.ts`, and the measurement that forced it). A canopy no
 * longer asks how strongly proven a leaflet is before listing it — it asks what its subject
 * offered, and prints the tier beside the work. So `pending` artifacts the subject marked public
 * are part of the count, and the fixture offers four of them on purpose: with none, this file
 * would still be measuring the removed gate and would go green on a page that had quietly
 * reinstated it.
 */
const SIGNED = 6;
const UNSIGNED = 7;
const THIRD_PARTY = 9;

/** Offered outward as `public` (enumerable), as `unlisted` (link only), left `private`. */
const AS_PUBLIC = 4;
const AS_UNLISTED = 1;
/** Unproven work its subject also offered outward. Listed, with its tier shown, not hidden. */
const AS_PUBLIC_PENDING = 4;
/** Everything a canopy may enumerate for this person: the projection's one answer. */
const PUBLISHED = AS_PUBLIC + AS_PUBLIC_PENDING;

const SUBJECT_EMAIL = "tree-subject@example.com";
const OTHER_EMAIL = "somebody-else@example.com";

/**
 * A REAL repository mixing the three things a leaf's tiers are made of.
 *
 * Returns null only when `ssh-keygen` is missing: a machine without it cannot exercise the signed
 * path, and a fabricated signature block would be a string, not evidence. Every setting is
 * repo-local, so what is measured is git's behaviour given a stated configuration rather than this
 * developer's.
 *
 *   SIGNED by the subject          → `verified`: git accepted the signature and bound the signer.
 *   UNSIGNED by the subject        → `pending`:  attributed to a declared identity, not proven.
 *   authored by SOMEBODY ELSE      → `excluded`: could not be attributed to this subject.
 *
 * The commit subjects are numbered and distinctive so the page can be searched for any of them:
 * a title on `/tree` would be a second, louder leak than the count.
 */
async function mixedRepo(dir: string): Promise<string | null> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "--initial-branch=main", "-q");
  await git(dir, "config", "user.name", "Tree Subject");
  await git(dir, "config", "user.email", SUBJECT_EMAIL);
  try {
    await exec(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "foliage-test", "-f", join(dir, "k"), "-q"],
      { env: GIT_ENV, timeout: 60_000 },
    );
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return null;
    throw err;
  }
  const key = join(dir, "k.pub");
  const allowed = join(dir, "allowed_signers");
  await writeFile(allowed, `${SUBJECT_EMAIL} ${await readFile(key, "utf8")}`, "utf8");
  await git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  await git(dir, "config", "gpg.format", "ssh");
  await git(dir, "config", "user.signingkey", key);

  let n = 0;
  const commit = async (subject: string, extra: string[]) => {
    await writeFile(join(dir, `f${n}.txt`), `${subject}\n`, "utf8");
    await git(dir, "add", "-A");
    await git(dir, ...extra, "commit", "-m", subject);
    n += 1;
  };

  for (let i = 0; i < SIGNED; i += 1) {
    await commit(`feat: signed work item ${i} of the subject`, ["-c", "commit.gpgsign=true"]);
  }
  for (let i = 0; i < UNSIGNED; i += 1) {
    await commit(`chore: unsigned work item ${i} of the subject`, ["-c", "commit.gpgsign=false"]);
  }
  for (let i = 0; i < THIRD_PARTY; i += 1) {
    await commit(`docs: work item ${i} by somebody else entirely`, [
      "-c",
      "commit.gpgsign=false",
      "-c",
      `user.email=${OTHER_EMAIL}`,
      "-c",
      "user.name=Somebody Else",
    ]);
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

/** Read a document back through the DOMAIN parser, so every comparison is against `Leaf`. */
async function leafAt(path: string): Promise<Leaf> {
  const parsed = parseLeafDocument(JSON.parse(await readFile(path, "utf8")));
  assert.equal(parsed.ok, true, `${path} did not parse as a leaf document`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

async function treeOf(dir: string, entries: string[]): Promise<TreeLoad> {
  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "count-tree", company: "Count Company", leaves: entries }),
  );
  return loadTreeDocument({ [TREE_ENV]: manifest });
}

/* ==========================================================================================
   READING THE PAGE — through the DOMAIN hooks, never through a class name.
   ========================================================================================== */

function allMatches(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => m[1] ?? "");
}

/**
 * Each roster row's markup, located by `data-roster-row` — the contract that marks "this element
 * is one person". A test that pinned `class="tree-person"` would punish the next restyle and
 * protect nothing.
 */
function rosterRowsOf(html: string): string[] {
  return html
    .split(/<li[^>]*\bdata-roster-row="true"/)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</li>")));
}

/**
 * Every FIGURE in a fragment.
 *
 * `<b>` and not `.fol-metric`: the row sets the document's path in `.fol-metric` too, because it
 * is a machine string and takes the mono face, and a temporary directory's name is full of digits.
 * The distinction is the markup's own — a figure is a `<b>`, a path is a `<span>` — so reading it
 * this way asserts about numbers rather than about digits that happen to be nearby.
 */
function figuresIn(html: string): string[] {
  return allMatches(html, /<b[^>]*>([^<]*)<\/b>/g).filter((t) => /\d/.test(t));
}

/* ==========================================================================================
   THE DIFFERENTIAL
   ========================================================================================== */

test("theTreeRosterCountsOnlyWhatItMayShow", async (t) => {
  const dir = await tempDir();
  const repo = await mixedRepo(join(dir, "repo"));
  if (repo === null) {
    t.skip(
      "ssh-keygen is not installed, so no REAL signature can be made — and a fabricated one " +
        "would prove nothing about what git accepts",
    );
    return;
  }

  /*
   * THREE PEOPLE, because the three states of `PublicLeaf` are three different facts and this page
   * has to keep them apart. All three read the SAME history through different declared identities,
   * which is also how a real company's manifest works.
   *
   *   MIXED     the subject: signed, unsigned and third-party commits → all three tiers.
   *   QUIET     declares the other party's identity and offers nothing → `nothing-offered`.
   *   OFFERING  same, and offers one UNPROVEN leaflet outward → `nothing-publishable`.
   */
  const mixedDoc = await realLeafFrom(repo, "Mixed Subject", SUBJECT_EMAIL, join(dir, "a.leaf.json"));
  const quietDoc = await realLeafFrom(repo, "Quiet Subject", OTHER_EMAIL, join(dir, "b.leaf.json"));
  const offeringDoc = await realLeafFrom(
    repo,
    "Offering Subject",
    OTHER_EMAIL,
    join(dir, "c.leaf.json"),
  );

  const mixedBefore = await leafAt(mixedDoc);

  // THE FIXTURE IS WHAT IT CLAIMS TO BE. Asserted rather than assumed: if intake ever stopped
  // minting one leaflet per commit, or stopped verifying signatures, every assertion below would
  // still "pass" while measuring something else entirely.
  const ledger = attributionLedger(mixedBefore);
  assert.equal(ledger.verified, SIGNED, "real accepted signatures bound to the declared identity");
  assert.equal(ledger.pending, UNSIGNED, "attributed to the identity, authorship not established");
  assert.equal(ledger.excluded, THIRD_PARTY, "authored by somebody else, and counted honestly");
  assert.equal(mixedBefore.leaflets.length, SIGNED + UNSIGNED + THIRD_PARTY);

  const byTier = (leaf: Leaf, tier: Leaflet["tier"]): Leaflet[] =>
    leaf.leaflets.filter((l) => l.tier === tier);

  /*
   * THE SUBJECT'S OWN DECISIONS, made through the real command. Four proven artifacts enumerable,
   * one proven artifact reachable only by link, one proven artifact left at the default (private),
   * and four UNPROVEN artifacts offered outward — which are listed WITH THEIR TIER SHOWN, because
   * publishing is a consent question the subject answers and proof strength is a different one the
   * page answers by disclosure. `unlisted` is still not counted: that is the rule that did not
   * move.
   */
  const verified = byTier(mixedBefore, "verified");
  const pending = byTier(mixedBefore, "pending");
  for (const l of verified.slice(0, AS_PUBLIC)) await share(mixedDoc, l.id, "public");
  for (const l of verified.slice(AS_PUBLIC, AS_PUBLIC + AS_UNLISTED)) {
    await share(mixedDoc, l.id, "unlisted");
  }
  for (const l of pending.slice(0, AS_PUBLIC_PENDING)) await share(mixedDoc, l.id, "public");

  // OFFERING SUBJECT offers one leaflet that is SOMEBODY ELSE'S, which is the whole difference
  // between the two empty states. `excluded` is not a proof-strength verdict: it is
  // @foliage/leaf saying this work could not be attributed to this subject at all, so printing it
  // under their name would be a false attribution rather than an overclaim about proof.
  //
  // ONE OF TWO CAUSES, NOT THE ONLY ONE. This comment used to end "and, since the tier gate was
  // removed, the only thing that still reaches `nothing-publishable`" — false, and the same
  // false sentence that shipped F-028 one directory over. The publish rail reaches that state
  // too, on work that IS the subject's (`publicProjection.ts`, `projectLeaf`). This fixture
  // exercises the attribution cause; the rail cause is exercised in `renderPublic.test.ts`.
  const offeringBefore = await leafAt(offeringDoc);
  const offeringFirst = offeringBefore.leaflets.find((l) => l.tier === "excluded");
  assert.ok(offeringFirst !== undefined, "this repository yielded no excluded leaflet to offer");
  await markPublicInDocument(offeringDoc, offeringFirst.id);

  const mixed = await leafAt(mixedDoc);
  const quiet = await leafAt(quietDoc);
  const offering = await leafAt(offeringDoc);

  // The domain's own verdict on the three, recomputed here from the same files the loader read.
  const projected = projectLeaf(mixed);
  assert.equal(projected.state, "listed");
  assert.equal(projected.state === "listed" ? projected.listed.length : -1, PUBLISHED);
  assert.equal(projectLeaf(quiet).state, "nothing-offered");
  assert.equal(projectLeaf(offering).state, "nothing-publishable");

  const load = await treeOf(dir, ["a.leaf.json", "b.leaf.json", "c.leaf.json"]);
  assert.equal(load.ok, true, "the tree under test did not load");
  const body = renderTreePage(load);

  /* ---------------------------------------------------------------------------------------
     1. THE ROSTER IS INTACT. Rule 4 of renderTree.ts: hiding a person to avoid printing their
        figure would be a worse leak than the figure — a roster shorter than the manifest tells
        a reader exactly which of a company's people have nothing published.
     --------------------------------------------------------------------------------------- */
  const rows = rosterRowsOf(body);
  assert.equal(rows.length, 3, "a person the manifest names is missing from the roster");
  for (const subject of ["Mixed Subject", "Quiet Subject", "Offering Subject"]) {
    assert.ok(body.includes(subject), `${subject} is named by the manifest and not by the page`);
  }
  assert.deepEqual(
    allMatches(body, /data-person-state="([a-z-]+)"/g),
    ["listed", "nothing-offered", "nothing-publishable"],
    "the roster's per-person state disagrees with the public projection, or the rows were " +
      "reordered — they are in manifest order and nothing may sort them",
  );

  /* ---------------------------------------------------------------------------------------
     2. THE FIGURE IS THE PROJECTION'S, AND IT IS THE ONLY ONE.
     --------------------------------------------------------------------------------------- */
  assert.deepEqual(
    figuresIn(rows[0] as string),
    [String(PUBLISHED)],
    `the row for a person who published ${PUBLISHED} artifacts states some other number. Every ` +
      "candidate is a count of something this page is not showing",
  );
  assert.match(rows[0] as string, /data-count="published"/);
  // NO SCORE on the one row that carries a figure: its label is a count, never a rank. CONTROL.
  const listedText = (rows[0] as string).replace(/<[^>]*>/g, " ").toLowerCase();
  for (const word of ["score", "rating", "rank", "grade", "percentile", "out of"]) {
    assert.ok(!listedText.includes(word), `the listed roster row says "${word}" beside a person's figure`);
  }

  // AND THE EMPTY STATES CARRY NO NUMBER AT ALL. Not a zero: the projection's empty arms have no
  // `listed` field, so there is nothing here a zero could honestly be printed from, and a zero
  // would state the size of a set the reader is not being shown.
  for (const [i, row] of rows.slice(1).entries()) {
    assert.deepEqual(
      figuresIn(row),
      [],
      `roster row ${i + 1} prints a figure for a person who has published nothing`,
    );
  }

  /* ---------------------------------------------------------------------------------------
     3. THE FORBIDDEN SET — every figure the RAW document could have produced, computed here
        through the same domain function the page used to call, and required absent.
     --------------------------------------------------------------------------------------- */
  const forbidden = new Map<number, string>([
    [ledger.verified, "the verified tally over the whole leaf, which includes what was withheld"],
    [ledger.pending, "the pending tally — unproven work this canopy will not restate outward"],
    [ledger.excluded, "the excluded tally — work that turned out to be somebody else's"],
    [mixed.leaflets.length, "the size of the whole portfolio"],
    [ledger.verified + ledger.pending, "verified plus pending"],
    [ledger.verified + ledger.excluded, "verified plus excluded"],
    [ledger.pending + ledger.excluded, "pending plus excluded"],
    [PUBLISHED + AS_UNLISTED, "everything shared, which counts the unlisted artifact"],
    [mixed.leaflets.length - PUBLISHED, "everything withheld"],
    [AS_PUBLIC, "the PROVEN half of what was published — a tier tally is a ranking of people"],
  ]);
  assert.equal(
    forbidden.has(PUBLISHED),
    false,
    "the fixture's counts collide with the published count, so this whole check is vacuous",
  );

  const printed = new Set(figuresIn(body));
  for (const [n, what] of forbidden) {
    assert.equal(
      printed.has(String(n)),
      false,
      `the page prints ${n}, which is ${what}. A count discloses existence: this is the same ` +
        `leak publicProjection.ts refuses one level down, committed one level up`,
    );
  }

  // The tier triple's own hook, named rather than inferred. A row that lost its labels and kept
  // its numerals would still be the leak, and this is what makes the removal legible.
  assert.deepEqual(allMatches(body, /data-count-tier="([a-z]+)"/g), []);

  /* ---------------------------------------------------------------------------------------
     4. AND IT SHOWS NOTHING EITHER. A count leaks existence; a title leaks the thing itself.
        `/tree` renders no artifact at all, so NONE of these 22 commit subjects may appear —
        including the four that ARE published, whose home is `/leaflet/<id>`.
     --------------------------------------------------------------------------------------- */
  for (const l of mixed.leaflets) {
    assert.equal(
      body.includes(l.title),
      false,
      `an artifact's own words reached /tree: ${l.title}`,
    );
  }
});

/* ==========================================================================================
   THE SOURCE GATE — because no output check can prove the absence of a path today's documents
   happen not to exercise.
   ========================================================================================== */

test("renderTreeCannotReachAWholePortfolioAtAll", async () => {
  /*
   * The output assertions above hold for the document they were given. This one holds for every
   * document, and it is the gate that survives a future page section: `/tree` may not so much as
   * NAME the open plane's per-portfolio API, because every one of those functions takes a raw
   * `Leaf` and this is a public surface.
   *
   * Comments are stripped first — this module argues about `attributionLedger` and `.leaflets` at
   * length, and a prose mention is not a call.
   */
  const code = (await readFile(RENDER_TREE, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const hits = [
    ...code.matchAll(/\battributionLedger\b|\bpublishableLeaflets\b|\bleafletVisibility\b/g),
    ...code.matchAll(/\.leaflets\b|\bleaflets\s*[:,}]/g),
    ...code.matchAll(/from\s+"@foliage\/leaf"/g),
  ].map((m) => m[0]);

  assert.deepEqual(
    hits,
    [],
    `renderTree.ts reaches into a raw leaf document. Everything this page may say about a ` +
      `person comes from @foliage/canopy's public projection, which has already applied the ` +
      `subject's visibility gate and the tier gate. Found: ${hits.join(", ")}`,
  );
});

test("F-031 — no machine path reaches ANY public canopy page, in any state", async () => {
  /*
   * TWO PATHS LEAK FROM THIS PAGE, NOT ONE, which is why this asserts over the whole document
   * rather than over the footer it was first noticed in. `/tree` renders `source.path` at three
   * sites and `source` is TWO different values: `load.source` (the manifest) at the footer and in
   * the empty-tree block, and `leafSources[i]` — THAT PERSON'S leaf document — on every roster
   * row. A fix that stripped only the manifest would have measured clean on an empty tree, which
   * has no rows, and shipped the per-person leak intact.
   *
   * MEASURED on the wire 2026-09-04, before the fix: a canopy serving one leaf answered `/tree`
   * carrying both `…/tmp.jyy91ZCk7Q/tree.json` and `…/tmp.jyy91ZCk7Q/a.leaf.json`. On the owner's
   * machine those read `/Users/<name>/…`, publishing their username and home layout to anyone who
   * can reach the page. Only the loopback Host allow-list stood in the way, and that is a
   * deployment accident rather than a decision.
   *
   * The rule is `apps/leaf/export.mjs:20-25`'s, applied to the plane that actually has strangers:
   * the leaf app keeps the full path on the owner's OWN server because it is provenance they can
   * act on, and strips it on export. A canopy has no such audience — it is the public host — so
   * the name is all it may ever print.
   */
  const dir = await tempDir();
  await writeFile(join(dir, "a.leaf.json"), JSON.stringify({
    id: "path-probe",
    subject: "Path Probe",
    leaflets: [],
  }));
  const load = await treeOf(dir, ["a.leaf.json"]);
  const html = renderTreePage(load);

  // The page still NAMES both documents — this is a strip, not a deletion.
  assert.match(html, /tree\.json/, "the manifest's name is gone; it is provenance and stays");
  assert.match(html, /a\.leaf\.json/, "the person's document name is gone");

  // And it names them only. Any directory separator before a name is the machine's business.
  for (const leaked of [dir, tmpdir(), "/Users/"]) {
    assert.equal(
      html.includes(leaked),
      false,
      `a filesystem path reached the public roster: ${leaked}. This page is the public host — ` +
        `"what recruiters, boards and the public see" — so a path here publishes the operator's ` +
        `username and home layout to a stranger`,
    );
  }
  assert.doesNotMatch(
    html,
    /<span class="fol-metric">[^<]*\/[^<]*\.(?:leaf\.)?json<\/span>/,
    "a document is rendered with a directory separator in it",
  );
});

test("F-031 — the leak class, swept across every public renderer and every failure state", async () => {
  /*
   * THE GUARD THAT SHOULD HAVE BEEN WRITTEN FIRST, and the reason this one is shaped by VALUE
   * rather than by file.
   *
   * F-031's first fix stripped the three `source.path` sites `renderTree.ts` renders on a
   * SUCCESSFUL load, and its guard asserted exactly those. The three-pass review then measured
   * four more live leaks of the same value through the real loader and renderer: this file's
   * failure page (the `Path` row and its `detail`), the per-entry failure detail that renders
   * NEXT TO the roster on an ordinary page, the front door (`renderCanopy.ts`), and the footer of
   * every `/leaf/<id>` and `/leaflet/<id>` (`renderPublic.ts`'s `sourceFooter`) — plus one the
   * review did not name, the no-tree refusal's `detail` in the same file.
   *
   * A per-site guard cannot fail on a site nobody thought of, which is the whole defect. So this
   * one enumerates the PAGES a stranger can reach, drives each into every state the loader can
   * produce, and asserts one property over all of them: no directory this machine owns appears in
   * any of the bytes. A new renderer that forgets `documentName` fails here without anyone having
   * to remember to add a case for it.
   *
   * `unconfigured` is included deliberately even though its `path` is null: it is the fresh-install
   * state and the one a first deployment renders.
   *
   * EVERY CAUSE THE LOADER CAN PRODUCE IS DRIVEN, and the first version of this sweep only claimed
   * that. The seams pass checked and found three it never reached — `unreadable`, `duplicate` and
   * `policy-invalid` — and confirmed by hand that none of them leaks today. That is exactly the
   * kind of claim this repository refuses to leave standing on somebody else's verification: the
   * three are constructed here, so a future edit to any of their message texts is caught rather
   * than reasoned about. The same round added entry-level `malformed` and `invalid` for the same
   * reason, and a manifest naming NO leaves — the only input that reaches the empty-tree aside,
   * a site the first fix stripped and neither guard rendered, which is how a commit message came
   * to claim mutation proof over sites one of which was never driven.
   */
  const dir = await tempDir();

  // Every TreeLoad state the loader can reach, built from real files.
  await writeFile(join(dir, "a.leaf.json"), JSON.stringify({ id: "p", subject: "P", leaflets: [] }));
  await writeFile(join(dir, "not-json.txt"), "{ this is not json");
  await writeFile(join(dir, "invalid.json"), JSON.stringify({ nope: true }));
  await writeFile(
    join(dir, "stale.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["gone.leaf.json"] }),
  );

  // duplicate: one document named twice, so the second copy carries the same leaf id.
  await writeFile(
    join(dir, "dupe.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["a.leaf.json", "a.leaf.json"] }),
  );

  // policy-invalid: a valid leaf whose SIBLING policy document will not parse. The whole entry
  // fails closed, and its detail is built around the POLICY file's path, not the leaf's.
  await writeFile(join(dir, "pol.leaf.json"), JSON.stringify({ id: "q", subject: "Q", leaflets: [] }));
  await writeFile(join(dir, "pol.leaf.policy.json"), "{ not json");
  await writeFile(
    join(dir, "policy.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["pol.leaf.json"] }),
  );

  // unreadable, at BOTH levels: a mode-000 leaf inside a loadable manifest, and a mode-000
  // manifest. Skipped rather than silently passed where the process can read anything anyway.
  await writeFile(join(dir, "locked.leaf.json"), JSON.stringify({ id: "r", subject: "R", leaflets: [] }));
  await writeFile(
    join(dir, "locked.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["locked.leaf.json"] }),
  );
  await writeFile(join(dir, "sealed.json"), JSON.stringify({ id: "t", company: "C", leaves: [] }));

  // A manifest naming NO leaves, which is the ONLY way to reach the empty-tree aside — the branch
  // that renders "Add a leaf document path under leaves in <manifest>". It was one of the three
  // sites the first fix stripped, and NEITHER guard rendered it, so the commit message's claim of
  // mutation proof "over all six sites individually" was false about a seventh nobody drove.
  await writeFile(join(dir, "bare.json"), JSON.stringify({ id: "t", company: "C", leaves: [] }));

  // Entry-level `malformed` and `invalid`: a manifest entry pointing at a leaf file that is bad
  // JSON, and at one that parses but is not a leaf document. Fixtured rather than reasoned about,
  // for the same reason the manifest-level causes above are.
  await writeFile(join(dir, "bad.leaf.json"), "{ not json at all");
  await writeFile(join(dir, "notaleaf.json"), JSON.stringify({ nope: true }));
  await writeFile(
    join(dir, "entries.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["bad.leaf.json", "notaleaf.json"] }),
  );
  await chmod(join(dir, "locked.leaf.json"), 0o000);
  await chmod(join(dir, "sealed.json"), 0o000);
  const rootCanReadAnything = await readFile(join(dir, "sealed.json"), "utf8").then(
    () => true,
    () => false,
  );

  const loads: TreeLoad[] = [
    await loadTreeDocument({}),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "nowhere.json") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "not-json.txt") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "invalid.json") }),
    // ok, but a manifest entry has gone stale — ordinary drift, and it renders a failure BESIDE
    // the roster on a page whose own `load.ok` is true.
    await loadTreeDocument({ [TREE_ENV]: join(dir, "stale.json") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "dupe.json") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "policy.json") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "entries.json") }),
    await loadTreeDocument({ [TREE_ENV]: join(dir, "bare.json") }),
    await treeOf(dir, ["a.leaf.json"]),
  ];
  if (!rootCanReadAnything) {
    loads.push(
      await loadTreeDocument({ [TREE_ENV]: join(dir, "locked.json") }),
      await loadTreeDocument({ [TREE_ENV]: join(dir, "sealed.json") }),
    );
  }

  for (const load of loads) {
    const state = load.ok ? "ok" : load.cause;
    const pages: [string, string][] = [
      [`/ (${state})`, renderCanopyPage(load)],
      [`/tree (${state})`, renderTreePage(load)],
      [`/leaf/<id> (${state})`, renderPublicLeafPage(resolvePublicLeaf(load, "p"))],
      [`/leaflet/<id> (${state})`, renderPublicLeafletPage(resolvePublicLeaflet(load, "git:none", null))],
    ];
    for (const [where, html] of pages) {
      for (const leaked of [dir, tmpdir(), "/Users/"]) {
        assert.equal(
          html.includes(leaked),
          false,
          `${where} publishes a directory on this machine (${leaked}). Every public canopy page ` +
            `names documents and never the paths to them — see apps/canopy/src/publicPath.ts`,
        );
      }
    }
  }
});
