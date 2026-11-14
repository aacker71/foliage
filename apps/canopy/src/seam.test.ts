/**
 * THE SEAM. End-to-end over real HTTP, against the real canopy server process, on documents the
 * real producer wrote from real git history.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `treeDocument.test.ts` proves the loader reads real files and
 * keeps its causes apart. Every one of its assertions can pass while the assembled product is
 * wrong, because it never starts the server and never compares what a client actually RECEIVES
 * against what the domain actually SAID. That gap is where this project's recorded failures
 * live: a module verified in isolation, reported as a working surface.
 *
 * So these tests run `apps/leaf/intake.mjs` against REAL repositories on this machine, assemble a
 * real manifest over the documents it produced, spawn `server.mjs` as a real child process, speak
 * HTTP to it, and check the bytes that come back. Five seams, each one a thing isolated tests
 * cannot see:
 *
 *   1. THE NUMBERS ON THE PAGE ARE THE DOMAIN'S NUMBERS, AND THE NUMBERS THAT ARE NOT ON IT ARE
 *      NOT THERE EITHER. `canopySize()` is called a SECOND time, here, against the same files,
 *      and compared digit for digit with the response — a view that recounted for itself would
 *      pass a render test and fail this. `attributionLedger()` is called a second time too, and
 *      it supplies the FORBIDDEN numbers: it tallies a person's whole portfolio, `/tree` is
 *      public, and a public surface may only count what it may show. Both directions matter, and
 *      the second is the one that shipped broken (C3).
 *
 *   2. THE PAGE ASSERTS NOTHING THE DOCUMENTS DID NOT CONTAIN. Set difference in both directions
 *      over the subject names. This is the mechanical form of "no fake data": a person's name on
 *      a company's roster that is not in any document is a fabrication, whatever put it
 *      there.
 *
 *   3. A PARTIAL TREE SAYS SO ON ITS FACE. The 4-of-5 case is driven through the real server, and
 *      the page is required to carry both the smaller roster AND the named failure. This is the
 *      seam where "renders four people, mentions nothing" would ship.
 *
 *   4. THE FABRICATION BAND'S ABSENCE MEANS SOMETHING, proven by DIFFERENTIAL CONTROL rather
 *      than by hope: the SAME server binary is pointed at an example-declaring document and must
 *      show the band. Absent-on-real is only evidence if present-on-fake is demonstrated by the
 *      same code path in the same run.
 *
 *   5. THE PAGE TRACKS THE FILES WITH NO RESTART. The manifest is edited between two requests to
 *      the SAME process and the response has to follow. This distinguishes a real read from a
 *      fixture baked in at boot, and it is not observable without a live server.
 *
 *   6. THE CANOPY CHAIN IS WALKABLE END TO END. `/tree` → a roster link → `/leaf/<id>` → an
 *      artifact link → `/leaflet/<id>`, each hop taken from the href the PREVIOUS response
 *      actually rendered rather than from a path this file composed. A route that exists and is
 *      linked from nowhere is a page nobody reaches; a link that 404s is a chain that breaks in
 *      front of the reader. Neither is visible to a test that requests known URLs.
 *
 *      That walk needs a `verified` leaflet, and `verified` cannot be written down: it means git
 *      accepted a signature and bound the signer to a declared identity. So one seam builds a
 *      throwaway repository whose commits are signed with a REAL ed25519 key from stock
 *      `ssh-keygen`, and offers one artifact outward through the REAL `share.mjs` command. If
 *      `ssh-keygen` is missing the test reports itself SKIPPED rather than passing quietly.
 *
 *   7. THE HONEST EMPTY CHAIN. This repository's own history is unsigned, so intake over it
 *      yields no verified leaflet and the canopy publishes NOTHING of it. That is the correct
 *      result and it is asserted as one — through the real server, on the real pages — because
 *      the failure this project guards against is a surface that fills an empty state in.
 *
 * DISCIPLINE: every wait has a deadline and every child is killed in a `finally`. A check may
 * fail; it must never hang.
 */

import assert from "node:assert/strict";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  attributionLedger,
  defaultPublishPolicy,
  evaluatePolicy,
  isAbsoluteDenial,
  parseLeafDocument,
  type Leaf,
  type Leaflet,
} from "@foliage/leaf";
import { canopySize, treeId } from "@foliage/canopy";

import { POLICY_REGIONS, esc, withoutPolicyRegions } from "./renderTree.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../../leaf/intake.mjs", import.meta.url));
const SHARE = fileURLToPath(new URL("../../leaf/share.mjs", import.meta.url));
/** This repository — real git history, which is the point. */
const REPO = testRepository();

/**
 * Seal off the developer's own git configuration for the throwaway signed repository below.
 *
 * Whether a signature verifies is decided by `gpg.ssh.allowedSignersFile`, so a developer with
 * one configured globally would measure something different from a developer without. `-c`
 * cannot express "unset"; sealing the files git reads can. It is applied per-invocation rather
 * than to `process.env`, so the seams that read THIS repository still read it as it really is.
 */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const exec = promisify(execFile);

const BOOT_DEADLINE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-seam-"));
  tmpRoots.push(dir);
  return dir;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => reject(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => resolve(port));
    });
  });
}

interface Running {
  readonly origin: string;
  get(path: string): Promise<{ status: number; body: string }>;
}

/** Start the REAL server with the given environment, hand it to `body`, and always kill it. */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  let exited: string | null = null;
  child.on("exit", (code, signal) => {
    exited = `exit code ${String(code)} signal ${String(signal)}`;
  });

  const origin = `http://127.0.0.1:${port}`;
  const get = async (path: string) => {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: res.status, body: await res.text() };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}\nstderr:\n${stderr}`,
        );
      }
      try {
        await get("/tree");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ origin, get });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function allMatches(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => unescapeHtml(m[1] ?? ""));
}

/**
 * The names on the roster, read through the DOMAIN attribute rather than a class.
 *
 * A test that pins a class name is a test that punishes the redesign; a test that pins a `data-*`
 * hook protects the domain. `data-roster-row` is the contract — it marks "this element is one
 * person" — so the row is located by it and the name is read as the first heading inside. Slicing
 * to the next row before matching is what stops a heading elsewhere in the row being picked up if
 * the internal markup grows.
 *
 * THE HEADING'S TEXT IS READ THROUGH ITS MARKUP, NOT UP TO THE FIRST `<`. It used to match
 * `<h3[^>]*>([^<]*)<`, which returned the EMPTY STRING the moment the name became a link into
 * that person's page — the first `<` is now the opening `<a>`. The failure was loud, which is
 * right, but the assertion it broke is "the names on this page are exactly the subjects of the
 * documents the server read", and that invariant does not care whether the name is wrapped in an
 * anchor. So the heading's inner markup is taken whole and stripped, which survives the next
 * wrapper too.
 */
function rosterRowsOf(html: string): string[] {
  return html
    .split(/<li[^>]*\bdata-roster-row="true"/)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</li>")));
}

function rosterNames(html: string): string[] {
  return rosterRowsOf(html).map((row) => {
    const heading = row.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    assert.ok(heading !== null, "a roster row rendered no name heading");
    return unescapeHtml((heading[1] ?? "").replace(/<[^>]*>/g, "").trim());
  });
}

/**
 * Run the REAL producer over a REAL repository and return the document path.
 *
 * This is what makes the whole file admissible. A hand-written fixture would prove the renderer
 * can render a fixture; running intake proves the chain producer → document → loader → view
 * holds on evidence nobody authored for this test.
 */
async function realLeafFrom(
  repo: string,
  subject: string,
  identity: string,
  out: string,
): Promise<string> {
  await exec(process.execPath, [
    INTAKE,
    "--repo", repo,
    "--subject", subject,
    "--identity", identity,
    "--id", subject.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    "--out", out,
    "--force",
  ]);
  return out;
}

/** Read a document back through the DOMAIN parser, so the comparison is against `Leaf`. */
async function leafAt(path: string): Promise<Leaf> {
  const parsed = parseLeafDocument(JSON.parse(await readFile(path, "utf8")));
  assert.equal(parsed.ok, true, `${path} did not parse as a leaf document`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

/**
 * The first leaflet of this repository's history that the DEFAULT rail lets out, rather than
 * `leaflets[0]` — the newest commit, whose title is whatever somebody wrote last. On 2026-09-02
 * it was "one 409/500 split …", which `RATING_SHAPED` reads as a rating; the product denied it
 * and this seam went red on a page that was right. Same fixture rule as renderPublic.test.ts.
 */
function firstPublishable(leaf: Leaf): Leaflet {
  const rail = defaultPublishPolicy();
  assert.equal(rail.ok, true, "the shipped default policy does not parse");
  if (!rail.ok) throw new Error("unreachable");

  /*
   * AND ITS TITLE MUST NOT BE A SUBSTRING OF ANOTHER LEAFLET'S, WHICH IS A SECOND FIXTURE DEFECT
   * OF THE SAME FAMILY AS THE FIRST.
   *
   * The caller asserts that no OTHER leaflet's title reached the page, with `body.includes(title)`.
   * That cannot tell "this title is on the page" from "this title is contained in one that is" —
   * and this repository's history guarantees the collision, because GitHub's squash merge appends
   * ` (#N)`: a branch commit "docs(deploy): the two open decisions, reduced to a yes or an edit"
   * and its merge commit "…, reduced to a yes or an edit (#42)" are both real leaflets, and one is
   * a prefix of the other. MEASURED 2026-09-04 on a fresh intake of this tree: 253 leaflets, and
   * exactly one such pair — that pair.
   *
   * The assertion is right and stays exactly as strong; the FIXTURE was ambiguous. So the leaflet
   * published here is the first the rail allows whose title neither contains nor is contained by
   * any other title in the document. Same shape as the rail filter above, and the same reason: a
   * test pinned to whatever was committed last is a test the next commit can break.
   */
  const unambiguous = (l: Leaflet): boolean => {
    const title = String(l.title);
    // Different commit objects can also have identical titles after a cherry-pick. Exclude
    // only this leaflet by identity, so an identical unpublished title remains ambiguous.
    return !leaf.leaflets.some((other) => other.id !== l.id &&
      (String(other.title).includes(title) || title.includes(String(other.title))));
  };

  const first = leaf.leaflets.find(
    (l) => !isAbsoluteDenial(evaluatePolicy(rail.policy, l)) && unambiguous(l),
  );
  assert.ok(
    first !== undefined,
    "this repository yielded no leaflet that the default rail allows AND whose title is not a " +
      "substring of another leaflet's — without that, `includes` cannot prove a title is absent",
  );
  return first;
}

/**
 * The identities used below are real committer emails read out of this repository's own history,
 * discovered at run time rather than hardcoded — a hardcoded address would rot, and worse, a test
 * that silently matched nobody would produce an all-excluded document and still pass.
 */
async function realIdentities(repo: string, n: number): Promise<string[]> {
  const { stdout } = await exec("git", ["-C", repo, "log", "--no-merges", "--format=%ae"]);
  const seen = [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  assert.ok(seen.length > 0, "this repository has no commit authors, so nothing real can be read");
  return seen.slice(0, n);
}

/**
 * How many commit OBJECTS in this repository carry a signature at all — read from the objects,
 * never from `%G?`.
 *
 * This exists because the verified count below must NOT be hardcoded. `%G?` is a verdict, and a
 * lossy one: git prints `N` — its code for "there is no signature" — when it cannot RUN the
 * checker, so the number of verified leaflets a run produces depends on whether the machine
 * running it has `gpg` installed and `gpg.ssh.allowedSignersFile` configured. This repository
 * already carries a signed commit, so a hardcoded `0` here was a test about the laptop wearing
 * the costume of a test about the product: green on an unconfigured machine, red in CI the day
 * a runner had a keyring.
 *
 * The `gpgsig` / `gpgsig-sha256` header is the ARTIFACT rather than an opinion about it, and it
 * does not move with git's version or the operator's locale. It gives the invariant that IS
 * about the product: a leaflet can never be verified unless a signature physically exists in
 * the commit object it came from. That bound holds on every machine, and it degenerates to the
 * original "0 verified" assertion on a repository of genuinely unsigned history.
 */
async function signedCommitObjects(repo: string): Promise<number> {
  const { stdout } = await exec("git", ["-C", repo, "log", "--no-merges", "--pretty=raw"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.split("\n").filter((line) => /^gpgsig(?:-sha256)? /.test(line)).length;
}

/* ==========================================================================================
   SEAMS 1 + 2 — real documents, real server, and every number is the domain's.
   ========================================================================================== */

test("realTreeOnRealDocumentsAgreesWithTheDomainDigitForDigit", async () => {
  const dir = await tempDir();
  const [identity] = await realIdentities(REPO, 1);
  assert.ok(identity !== undefined);

  const a = await realLeafFrom(REPO, "Seam Subject A", identity, join(dir, "a.leaf.json"));
  const b = await realLeafFrom(REPO, "Seam Subject B", identity, join(dir, "b.leaf.json"));

  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({
      id: "seam-tree",
      company: "Seam Company",
      leaves: ["a.leaf.json", "b.leaf.json"],
    }),
  );

  const leaves = [await leafAt(a), await leafAt(b)];
  // Recomputed HERE, independently, from the same files the server read.
  const expectedSize = canopySize({
    trees: [{ id: treeId("seam-tree"), company: "Seam Company", leaves }],
  });
  const expectedLedgers = leaves.map((l) => attributionLedger(l));

  // The documents must actually contain something, or every assertion below is vacuous.
  assert.ok(leaves[0]!.leaflets.length > 0, "intake produced an empty document — nothing to check");

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { status, body } = await s.get("/tree");
    assert.equal(status, 200);

    // SEAM 1a: the roster size on the page IS canopySize's number.
    const shown = allMatches(body, /data-fact="leaves">(\d+)</g);
    assert.deepEqual(shown, [String(expectedSize.leaves)]);
    assert.deepEqual(allMatches(body, /data-fact="named">(\d+)</g), ["2"]);

    /*
     * SEAM 1b: THE ROSTER MAY ONLY COUNT WHAT IT MAY SHOW — the C3 leak, at the seam.
     *
     * This page used to print `attributionLedger(leaf)` per person — Verified / Pending /
     * Excluded, computed over the RAW document — and it printed it on `/tree`, the first hop of
     * the public chain, under a band reading "Public canopy · Anyone may read this". Every one of
     * those integers counts leaflets the subject never offered anyone: on this run `private` is
     * the domain default and nothing has been shared, so it is ALL of them.
     *
     * So the ledger recomputed here is now the set of numbers the served bytes must NOT contain,
     * rather than the set they must. The assertion is only worth making if there is something to
     * leak, which is why the ledger is checked non-empty first.
     */
    assert.ok(
      expectedLedgers.every((l) => l.pending + l.excluded > 0),
      "these documents hold nothing unpublished, so a leak of the unpublished set would be " +
        "invisible here and every assertion below would pass vacuously",
    );

    // The triple itself is gone, hook and all. Named rather than inferred: a row that lost its
    // labels but kept its numerals would still be the leak.
    assert.deepEqual(
      allMatches(body, /data-count-tier="([a-z]+)"/g),
      [],
      "the roster prints per-person tier counts again. They are a tally over the whole leaf " +
        "document — private, unlisted, pending and excluded leaflets included — on a surface " +
        "that tells the reader anyone may read it",
    );

    // The projection's own verdict on these two people, published on the row. Intake over this
    // repository's unsigned history offers nothing outward, so both are `nothing-offered` — and
    // the honest rendering of that is a NAMED ROW CARRYING NO FIGURE.
    assert.deepEqual(
      allMatches(body, /data-person-state="([a-z-]+)"/g),
      leaves.map(() => "nothing-offered"),
      "the roster's per-person state disagrees with what the public projection says of these " +
        "documents",
    );

    // Not one numeral in a roster row. Read through `data-roster-row` so it survives a restyle,
    // and through `<b>` so the document path's own digits are not mistaken for a figure.
    for (const [i, row] of rosterRowsOf(body).entries()) {
      assert.deepEqual(
        allMatches(row, /<b[^>]*>([^<]*)<\/b>/g).filter((t) => /\d/.test(t)),
        [],
        `roster row ${i} prints a figure for a person who has published nothing. A zero here — ` +
          `or any number — states the size of a set the reader is not being shown`,
      );
    }

    // SEAM 2: every name rendered as a roster row is a subject from a real document, and every
    // real subject is rendered. Set difference in BOTH directions.
    //
    // Read through `data-roster-row`, NOT through a class name. This assertion used to pin
    // `class="tree-person-name"`, which made it a test of the stylesheet: the redesign renamed
    // nothing about the DOMAIN and the test still went red. The invariant is "the names on this
    // page are exactly the subjects of the documents the server read", and the attribute is the
    // contract that survives a restyle — `data-roster-row` is what marks a row as a person.
    const names = rosterNames(body);
    assert.deepEqual(names, leaves.map((l) => l.subject));

    // NO CROSS-PERSON AGGREGATE. The page states each person's counts and never a tree-wide
    // total — the sum is computed here purely to prove it does NOT appear as a figure.
    const totalVerified = expectedLedgers.reduce((n, l) => n + l.verified, 0);
    const totalPending = expectedLedgers.reduce((n, l) => n + l.pending, 0);
    // The two document counts asserted above (`data-fact="leaves"`, `data-fact="named"`) count
    // DOCUMENTS, not people's work. Left in, a pending total equal to the number of documents
    // matched them and failed this check with no aggregate on the page (an unsigned head commit
    // gave each fixture leaf one pending item: two leaves, total two). Only they are removed;
    // any other figure equal to the total still fails.
    const withoutDocumentCounts = body.replace(/<b class="fol-metric" data-fact="(?:leaves|named)">\d+<\/b>/g, "");
    if (totalPending !== expectedLedgers[0]!.pending && totalPending > 0) {
      assert.ok(
        !new RegExp(`fol-metric[^>]*>${totalPending}<`).test(withoutDocumentCounts),
        `the page shows ${totalPending}, which is the sum of every person's pending count — ` +
          `that is a company-wide figure standing for a group of people`,
      );
    }
    // RECOMPUTED, not hardcoded. `0` used to stand here, which made a claim about the runner's
    // signature configuration instead of about the product — see `signedCommitObjects`. Both
    // halves are asserted: the two leaves are built from the same repository with the same
    // identity, so their verified counts must agree with each other, and neither may exceed the
    // number of commits whose objects actually carry a signature.
    const signed = await signedCommitObjects(REPO);
    assert.equal(
      expectedLedgers[0]!.verified,
      expectedLedgers[1]!.verified,
      "the same history read twice under the same identity produced different verified counts",
    );
    assert.ok(
      totalVerified <= signed * expectedLedgers.length,
      `${totalVerified} verified leaflet(s) across ${expectedLedgers.length} document(s), but ` +
        `only ${signed} commit object(s) in this repository carry a signature at all — a ` +
        `leaflet was promoted to verified on history that holds nothing to verify`,
    );

    // NO SCORE, scoped exactly one paragraph — and the exemption is nailed shut.
    //
    // This assertion was written whole-page and FAILED, on the section whose entire purpose is
    // to say that no rating is produced. That sentence cannot state the invariant without
    // naming it. The fix is `render.ts`'s: scope the check, and mark the scope.
    //
    // The marked region is a constant, so the exemption is worth one known paragraph and no
    // more. Both halves are checked here, and the second is the one that matters — without it,
    // "no score outside the part where there might be" is not an invariant.
    for (const region of POLICY_REGIONS) {
      assert.ok(
        body.includes(region),
        "a declared policy region is not in the served page byte-for-byte, so the exemption " +
          `would be silently skipping nothing while the region drifted: ${region.slice(0, 60)}…`,
      );
    }
    const scoped = withoutPolicyRegions(body);
    for (const word of ["score", "rating", "rank", "grade", "percentile", "out of"]) {
      assert.ok(
        !scoped.toLowerCase().includes(word),
        `the tree page contains "${word}" OUTSIDE the marked no-score policy region`,
      );
    }

    // The band is ABSENT on real documents. Seam 4 gives that absence its meaning.
    assert.equal(/data-fabricated="true"/.test(body), false);
  });
});

/* ==========================================================================================
   SEAM 3 — a partial tree says so on its face, through the real server.
   ========================================================================================== */

test("aPartialTreeRendersTheSmallerRosterAndNamesWhatIsMissing", async () => {
  const dir = await tempDir();
  const [identity] = await realIdentities(REPO, 1);
  assert.ok(identity !== undefined);

  await realLeafFrom(REPO, "Present One", identity, join(dir, "one.leaf.json"));
  await realLeafFrom(REPO, "Present Two", identity, join(dir, "two.leaf.json"));
  await writeFile(join(dir, "broken.leaf.json"), "{ this is not json");

  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({
      id: "partial-tree",
      company: "Partial Company",
      leaves: ["one.leaf.json", "two.leaf.json", "broken.leaf.json", "never-written.leaf.json"],
    }),
  );

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { status, body } = await s.get("/tree");
    // A partially loadable tree is a real state, not an outage. 200, and the page carries it.
    assert.equal(status, 200);
    assert.match(body, /data-tree-state="partial"/);

    // The two counts disagree, ON THE PAGE, which is the fact a reader must not be able to miss.
    assert.deepEqual(allMatches(body, /data-fact="leaves">(\d+)</g), ["2"]);
    assert.deepEqual(allMatches(body, /data-fact="named">(\d+)</g), ["4"]);

    // Both failures are named, each with its own distinct cause.
    const causes = allMatches(body, /data-entry-failure="([a-z]+)"/g);
    assert.deepEqual(causes.sort(), ["absent", "malformed"]);
    assert.ok(body.includes("broken.leaf.json"));
    assert.ok(body.includes("never-written.leaf.json"));

    // And exactly two people are rendered — the roster is genuinely the smaller set.
    assert.equal(allMatches(body, /data-roster-row="true"/g).length, 2);
  });
});

/* ==========================================================================================
   SEAM 4 — the band's absence, proven by differential control on the same binary.
   ========================================================================================== */

test("theSameServerShowsTheFabricationBandOnAnExampleDocument", async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, "ex.leaf.json"),
    JSON.stringify({ id: "ex", subject: "An Illustration", leaflets: [], example: true }),
  );
  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "ex-tree", company: "Example Company", leaves: ["ex.leaf.json"] }),
  );

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { status, body } = await s.get("/tree");
    assert.equal(status, 200);
    // Present, VISIBLE (an element, not a comment), and stating the signal it fired on.
    //
    // `role="alert"` and `data-fabricated` are the GUARANTEE and are pinned. The class is not:
    // this assertion used to require the byte string `<aside class="tree-band" role="alert"
    // data-fabricated="true">`, so adopting the system's `.cell` alongside the surface class
    // turned it red without anything about the disclosure changing. The band is a domain
    // promise, not a style.
    const band = body.match(/<aside[^>]*\bdata-fabricated="true"[^>]*>/);
    assert.ok(band !== null, "no fabrication band element in the served page");
    assert.match(band[0], /role="alert"/, "the band is not announced; it is decoration");
    assert.match(body, /not a real company/i);
    // Unescaped before matching: the signal text is escaped on the way out, which is correct —
    // it is interpolated content, not chrome — so the comparison is against the original string.
    assert.match(unescapeHtml(body), /1 of 1 leaf document declares "example": true/);
  });
});

/* ==========================================================================================
   SEAM 5 — the page tracks the files, with no restart.
   ========================================================================================== */

test("editingTheManifestChangesTheNextResponseFromTheSameProcess", async () => {
  const dir = await tempDir();
  const [identity] = await realIdentities(REPO, 1);
  assert.ok(identity !== undefined);
  await realLeafFrom(REPO, "First Person", identity, join(dir, "one.leaf.json"));
  await realLeafFrom(REPO, "Second Person", identity, join(dir, "two.leaf.json"));

  const manifest = join(dir, "tree.json");
  const write = (leaves: string[]) =>
    writeFile(manifest, JSON.stringify({ id: "t", company: "Growing Company", leaves }));

  await write(["one.leaf.json"]);
  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const before = await s.get("/tree");
    assert.deepEqual(allMatches(before.body, /data-fact="leaves">(\d+)</g), ["1"]);
    assert.equal(before.body.includes("Second Person"), false);

    await write(["one.leaf.json", "two.leaf.json"]);

    const after = await s.get("/tree");
    assert.deepEqual(allMatches(after.body, /data-fact="leaves">(\d+)</g), ["2"]);
    assert.ok(after.body.includes("Second Person"));
  });
});

/* ==========================================================================================
   The failure states, through the real server. Each one a DIFFERENT status and a DIFFERENT page.
   ========================================================================================== */

test("theLoadFailuresAreDistinctResponsesNotOneGenericError", async () => {
  const dir = await tempDir();

  // unconfigured — a first-run state of a correctly working install.
  await withServer({}, async (s) => {
    const { status, body } = await s.get("/tree");
    assert.equal(status, 200);
    assert.match(body, /data-tree-state="unconfigured"/);
    assert.match(body, /Nothing published here yet\./);
    assert.doesNotMatch(body, /FOLIAGE_TREE/);
    // Critically: this is NOT rendered as a tree with zero people.
    assert.equal(/data-roster-row/.test(body), false);
    assert.equal(/data-tree-empty/.test(body), false);
  });

  // absent — the operator gave a bad address.
  await withServer({ FOLIAGE_TREE: join(dir, "nope.json") }, async (s) => {
    const { status, body } = await s.get("/tree");
    assert.equal(status, 404);
    assert.match(body, /data-tree-state="absent"/);
  });

  // invalid — valid JSON, wrong shape, and every issue is named on the page.
  const bad = join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ company: "", leaves: 7 }));
  await withServer({ FOLIAGE_TREE: bad }, async (s) => {
    const { status, body } = await s.get("/tree");
    assert.equal(status, 500);
    assert.match(body, /data-tree-state="invalid"/);
    assert.match(body, /tree-issue-at">id</);
    assert.match(body, /tree-issue-at">leaves</);
  });
});

/* ==========================================================================================
   THE HONEST EMPTY STATES — a surface with nothing to show has to say what is absent and why.

   These are separate from the failure states above on purpose. A manifest that names no one is
   VALID and its page is a success; a manifest that could not be read is not. Rendering the same
   "nothing here" for both is how a product tells an operator their config is fine when it is
   broken, and tells them it is broken when it is fine.
   ========================================================================================== */

test("aValidManifestNamingNobodyRendersAnEmptyPlateAndNotAZeroRoster", async () => {
  const dir = await tempDir();
  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "empty-tree", company: "Empty Company", leaves: [] }),
  );

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { status, body } = await s.get("/tree");
    // A company with no one on it yet is a real, correct state of a working install.
    assert.equal(status, 200);
    assert.match(body, /data-tree-state="ok"/);
    assert.match(body, /data-tree-empty="true"/);

    // It says WHAT is absent and the one fix — not a shrug.
    assert.match(body, /No leaf is on this tree yet\./);
    assert.match(body, /Add paths under <span class="fol-metric">leaves<\/span>/);

    // And it is genuinely the empty state, not a roster that happens to be zero-length: no
    // person rows, and no failure section claiming something went wrong.
    assert.equal(/data-roster-row/.test(body), false);
    assert.equal(/data-entry-failure/.test(body), false);

    // The two structural facts still render, both zero. A zero is the correct result and must
    // not be hidden — hiding it is how "we could not read anything" becomes indistinguishable
    // from "there is nothing to read".
    assert.deepEqual(allMatches(body, /data-fact="leaves">(\d+)</g), ["0"]);
    assert.deepEqual(allMatches(body, /data-fact="named">(\d+)</g), ["0"]);
  });
});

test("publicFailureStatesDistinguishUnpublishedFromUnreadable", async () => {
  const dir = await tempDir();

  // Unconfigured is a public empty state; operator setup stays in logs.
  await withServer({}, async (s) => {
    const { body } = await s.get("/tree");
    assert.match(body, /Nothing published here yet\./);
    assert.doesNotMatch(body, /FOLIAGE_TREE/);
  });

  // Absent: distinguish a missing configured document from an unconnected company.
  // Neither failure may render a plausible zero roster or computed facts.
  await withServer({ FOLIAGE_TREE: join(dir, "nope.json") }, async (s) => {
    const { body } = await s.get("/tree");
    assert.match(body, /No tree manifest at that path\./);
    assert.match(body, /No company was counted, and none was guessed\./);
    assert.doesNotMatch(body, /data-roster-row|data-fact="(?:leaves|named)"/);
  });
});

/* ==========================================================================================
   THE MARK, through the real server. One sprite, one copy, every reference resolved.
   ========================================================================================== */

test("theSpriteIsInlinedExactlyOnceAndEveryMarkReferenceResolvesToASymbolInIt", async () => {
  const dir = await tempDir();
  const manifest = join(dir, "tree.json");
  await writeFile(manifest, JSON.stringify({ id: "t", company: "T", leaves: [] }));

  const packaged = await readFile(
    fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")),
    "utf8",
  );
  const packagedIds = [...packaged.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string);

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { body } = await s.get("/tree");

    // EXACTLY ONE copy in the document. Two copies of a symbol drift, and duplicate ids make
    // which one wins a function of document order — this project has shipped that once already.
    const ids = [...body.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string);
    assert.deepEqual(ids, packagedIds, "the inlined sprite is not the package's, symbol for symbol");
    assert.equal(new Set(ids).size, ids.length, "a symbol id appears twice in one document");

    // Every reference on the page points INTO it. An unresolved <use> renders nothing at all and
    // does not warn.
    const uses = [...body.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1] as string);
    assert.ok(uses.length > 0, "the page references no symbol, so the mark is not rendered");
    assert.deepEqual(
      uses.filter((id) => !ids.includes(id)),
      [],
      "a <use> on the page points at an id the sprite does not define",
    );

    // The mark is DELIVERED as a reference, not re-drawn. `<path>` in the page body would mean
    // someone pasted geometry back in, which is how the stale mark survived for weeks.
    const afterSprite = body.slice(body.indexOf("</defs></svg>"));
    assert.doesNotMatch(afterSprite, /<path\b/i);

  });
});

/* ==========================================================================================
   The page's own assets actually resolve. A stylesheet that 404s is a page nobody has seen.
   ========================================================================================== */

test("everyStylesheetAndFontTheTreePageAsksForIsServed", async () => {
  const dir = await tempDir();
  const manifest = join(dir, "tree.json");
  await writeFile(manifest, JSON.stringify({ id: "t", company: "T", leaves: [] }));

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const { body } = await s.get("/tree");
    const hrefs = allMatches(body, /<link rel="stylesheet" href="([^"]+)"/g);
    // THE ORDER IS THE ASSERTION, not just the set. tokens defines the primitives and the face;
    // roles aliases them; foliage builds components on the roles; tree.css is last so it can
    // override a component without !important. Shuffle two of these and rules silently swap
    // winners on equal specificity — which is exactly the mechanism the `html` prefix drop
    // relies on, so it is pinned here rather than left to review.
    assert.deepEqual(hrefs, ["/foliage-tokens.css", "/roles.css", "/foliage.css", "/tree.css"]);

    for (const href of hrefs) {
      const res = await s.get(href);
      assert.equal(res.status, 200, `${href} did not resolve`);
    }

    // The token stylesheet names its own font files; every one of them must resolve through
    // this server too, or the open plane's typefaces silently fall back — the exact defect F8
    // was already caught for once.
    const tokens = await s.get("/foliage-tokens.css");
    const fonts = [...new Set(allMatches(tokens.body, /url\("(fonts\/[^"]+)"/g))];
    assert.ok(fonts.length > 0, "the token stylesheet declared no font files");
    for (const font of fonts) {
      const res = await s.get("/" + font);
      assert.equal(res.status, 200, `/${font} did not resolve`);
    }
  });
});

/* ==========================================================================================
   SEAMS 6 + 7 — THE CANOPY CHAIN, walked the way a recruiter walks it.

   Every hop below is taken from an href the PREVIOUS response actually rendered. That is the
   whole point of doing it here rather than in `renderPublic.test.ts`: a route can exist, be
   correct, and be linked from nowhere, and no unit test can see it. Composing the next URL in
   the test would be this file asserting against its own idea of the product.
   ========================================================================================== */

const git = (dir: string, ...args: string[]): Promise<string> =>
  exec("git", ["-C", dir, ...args], { env: GIT_ENV, timeout: 60_000 }).then((r) => r.stdout);

/**
 * A REAL repository whose commits carry REAL ed25519 signatures git accepts and BINDS to the
 * declared identity — which is what `verified` means and the only way to obtain one.
 *
 * Null when `ssh-keygen` is absent, so the caller can skip loudly. A fabricated signature block
 * would make these assertions about a string rather than about cryptography.
 */
async function signedRepo(dir: string, email: string, subjects: string[]): Promise<string | null> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "--initial-branch=main", "-q");
  await git(dir, "config", "user.name", "Signed Author");
  await git(dir, "config", "user.email", email);
  try {
    await exec(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "foliage-seam", "-f", join(dir, "k"), "-q"],
      { env: GIT_ENV, timeout: 60_000 },
    );
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

/** The REAL user path for offering one artifact outward: the command, not a hand-edited field. */
async function share(document: string, id: string, as: "unlisted" | "public"): Promise<void> {
  await exec(process.execPath, [SHARE, "share", id, "--as", as, "--leaf", document], {
    env: GIT_ENV,
    timeout: 60_000,
  });
}

/** Every href on a page, unescaped, in document order. */
function hrefs(html: string, prefix: string): string[] {
  return allMatches(html, /href="([^"]+)"/g).filter((h) => h.startsWith(prefix));
}

test("theCanopyChainIsWalkableFromTheTreeToOneArtifactOnRealSignedEvidence", async (t) => {
  const dir = await tempDir();
  const email = "seam-signed@example.com";
  const repo = await signedRepo(join(dir, "repo"), email, [
    "feat: the loader keeps its causes apart instead of returning zero",
    "fix: the roster stops sorting people by their evidence",
  ]);
  if (repo === null) {
    t.skip("ssh-keygen is not installed, so no REAL signature can be made — and a fake one would prove nothing");
    return;
  }

  const document = join(dir, "signed.leaf.json");
  await realLeafFrom(repo, "Signed Subject", email, document);
  const leaf = await leafAt(document);
  const published = leaf.leaflets[0];
  const withheld = leaf.leaflets[1];
  assert.ok(published !== undefined && withheld !== undefined);
  assert.equal(published.tier, "verified", "a real accepted signature bound to a declared identity");

  // ONE artifact is offered outward, through the command a subject actually runs.
  await share(document, published.id, "public");

  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "chain", company: "Chain Company", leaves: ["signed.leaf.json"] }),
  );

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    // HOP 1 — the tree, and the link it renders into this person.
    const tree = await s.get("/tree");
    assert.equal(tree.status, 200);
    const toLeaf = hrefs(tree.body, "/leaf/");
    assert.deepEqual(toLeaf.length, 1, "the roster offers no single way into this person");

    /*
     * AND THE ROSTER COUNTS ONLY WHAT IT SHOWS — the positive half of SEAM 1b, on signed evidence.
     *
     * This document holds TWO leaflets, both `verified` because both commits carry a real accepted
     * signature, and its subject has offered exactly ONE outward. So `attributionLedger` says 2 and
     * the public projection says 1, and the two numbers being different is the whole point of this
     * assertion: before C3 the row printed "Verified 2", which told a stranger there was a second
     * proven artifact on this leaf that they were not being shown. Neither the withheld artifact's
     * title nor its count may appear.
     */
    assert.equal(leaf.leaflets.length, 2, "this differential needs one offered and one withheld");
    assert.equal(withheld.tier, "verified", "the withheld leaflet must be one the ledger counts");
    const [row] = rosterRowsOf(tree.body);
    assert.ok(row !== undefined, "the roster rendered no row for the person the manifest names");
    assert.match(row, /data-person-state="listed"/);
    assert.deepEqual(
      allMatches(row, /<b[^>]*>([^<]*)<\/b>/g),
      ["1"],
      "the roster row states a figure other than the size of what it is showing. 2 here is the " +
        "whole leaf, and the difference between it and 1 is exactly the artifact its subject " +
        "chose not to offer anyone",
    );
    assert.equal(
      tree.body.includes(withheld.title),
      false,
      "an artifact its subject never offered is named on the public roster",
    );

    // HOP 2 — that person's published work, fetched at the address the roster gave.
    const person = await s.get(toLeaf[0] as string);
    assert.equal(person.status, 200, `${toLeaf[0]} is linked from the roster and does not resolve`);
    assert.match(person.body, /data-public-state="listed"/);
    assert.ok(person.body.includes("Signed Subject"));
    assert.ok(person.body.includes(published.title), "the published artifact is not listed");
    assert.equal(
      person.body.includes(withheld.title),
      false,
      "an artifact its subject never offered is listed on their public page",
    );
    // ONE number, and it counts only what was published. "1 of 2" would publish the 2.
    assert.deepEqual(allMatches(person.body, /<b class="fol-metric">(\d+)<\/b>/g), ["1"]);

    // HOP 3 — the artifact, fetched at the address the person page gave. Qualified by whose leaf
    // it is, which is what makes the address unambiguous when two colleagues cite one commit.
    const toArtifact = hrefs(person.body, "/leaflet/");
    assert.deepEqual(toArtifact.length, 1);
    assert.match(toArtifact[0] as string, /\?leaf=/);

    const artifact = await s.get(toArtifact[0] as string);
    assert.equal(artifact.status, 200, `${toArtifact[0]} is linked and does not resolve`);
    assert.match(artifact.body, /data-public-state="artifact"/);
    assert.match(artifact.body, /data-tier="verified"/);
    assert.match(artifact.body, /class="proof proof-verified" data-pill-tier="verified"/);
    assert.ok(artifact.body.includes(published.title));

    // THE MECHANICAL FORM OF NO FAKE DATA: the ref this page shows to a stranger is handed back
    // to git, in the repository it came from, and has to be a real commit object.
    const ref = "provenance" in published ? published.provenance?.ref : undefined;
    assert.ok(ref !== undefined, "a verified artifact with no ref");
    assert.ok(artifact.body.includes(ref), "the page does not show the evidence it rests on");
    assert.equal((await git(repo, "cat-file", "-t", ref)).trim(), "commit");

    // THE WINDOW TITLE CARRIES NO COMMIT SUBJECT AND NO ADDRESS. `<title>` is the one string that
    // leaves the page — tab, history, bookmark, link preview — where no disclosure travels with it.
    const windowTitle = unescapeHtml(artifact.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
    assert.equal(windowTitle.includes(published.title), false);
    assert.equal(windowTitle.includes("@"), false);

    // HOP 4 — back out of the artifact, to the person and to the company. A page somebody
    // forwards to a board has to say whose work it is and where it hangs.
    assert.deepEqual(hrefs(artifact.body, "/leaf/"), toLeaf);
    assert.ok(hrefs(artifact.body, "/tree").length > 0);

    // THE WITHHELD ARTIFACT IS NOT SERVED, at either form of its address, and the refusal is the
    // SAME BYTES as for an id nobody has. Compared with the requested id substituted out, because
    // any other difference is an oracle: try ids until the wording changes.
    const invented = "git:" + "0".repeat(40);
    const asked = [
      `/leaflet/${encodeURIComponent(withheld.id)}`,
      `/leaflet/${encodeURIComponent(withheld.id)}?leaf=${encodeURIComponent(leaf.id)}`,
    ];
    const control = await s.get(`/leaflet/${encodeURIComponent(invented)}`);
    assert.equal(control.status, 404);
    /*
     * TWO STRINGS ARE SUBSTITUTED BEFORE THE COMPARISON AND BOTH ARE ARGUED.
     *
     * The requested ID, because the requester already had it — echoing it back discloses nothing
     * and is the entire content of the page.
     *
     * The READ INSTANT, because the manifest is re-read on every request and its footer states
     * when. Two responses a millisecond apart legitimately differ there, and it differs the same
     * way for a private id and an invented one, so it cannot separate them. Normalising it is
     * what keeps this an assertion about disclosure rather than about the clock — and it is
     * narrow: the pattern matches an ISO-8601 instant and nothing else, so a real difference
     * anywhere in the page still fails.
     */
    const normalise = (body: string, id: string) =>
      body.split(id).join("<ID>").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<INSTANT>");
    for (const url of asked) {
      const refused = await s.get(url);
      assert.equal(refused.status, 404, `${url} did not refuse`);
      assert.equal(refused.body.includes(withheld.title), false, "the refusal leaked a title");
      assert.equal(
        normalise(refused.body, withheld.id),
        normalise(control.body, invented),
        `${url} answers differently from an id nobody has, which enumerates the portfolio`,
      );
    }

    // A person nobody has is 404 and names no one else.
    const noSuch = await s.get("/leaf/nobody-at-all");
    assert.equal(noSuch.status, 404);
    assert.match(noSuch.body, /data-public-state="no-such-leaf"/);
    assert.equal(noSuch.body.includes("Signed Subject"), false);
  });
});

test("thisRepositorysOwnUnsignedHistoryPublishesNothingUntilItsSubjectOffersSomething", async () => {
  /*
   * THE HONEST EMPTY CHAIN AND THE STEP OUT OF IT, and it is the state a reader of this repository
   * will actually meet. This machine's history is unsigned — `%G?` reports `N` for every commit —
   * so intake writes `pending` throughout.
   *
   * WHAT THIS TEST USED TO ASSERT, AND WHY IT IS WRONG NOW. It required the canopy to publish
   * NOTHING from this repository, ever, because `publishableLeaflets` refused every tier but
   * `verified`. That gate is gone: `packages/canopy/src/publicProjection.ts` records the
   * measurement that removed it — with no `gpg` on this machine every person page on real data
   * rendered `nothing-publishable`, and for a welder or a nurse `verified` is unreachable BY
   * DEFINITION, so a canopy gated on it is permanently empty for most of the people this product
   * is for. The decision (owner, 2026-08-19): the subject decides WHAT TO PUBLISH, the tier tells
   * the reader WHAT IT PROVES.
   *
   * So the property is no longer "nothing, forever". It is: NOTHING UNTIL A PERSON ACTS, and then
   * exactly what they offered, carrying the words that say what it does not prove. Both halves are
   * asserted, because a surface that fills an empty state with something plausible and a surface
   * that hides work its subject published are two different failures and this refuses both.
   */
  const dir = await tempDir();
  const [identity] = await realIdentities(REPO, 1);
  assert.ok(identity !== undefined);
  const document = join(dir, "real.leaf.json");
  await realLeafFrom(REPO, "Unsigned Subject", identity, document);
  const leaf = await leafAt(document);
  assert.ok(leaf.leaflets.length > 5, "this check needs a real portfolio to be meaningful");
  assert.equal(
    leaf.leaflets.some((l) => l.tier === "verified"),
    false,
    "this repository's history is unsigned; a verified leaflet here would mean intake changed",
  );

  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "unsigned", company: "Unsigned Company", leaves: ["real.leaf.json"] }),
  );

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const tree = await s.get("/tree");
    const [href] = hrefs(tree.body, "/leaf/");
    assert.ok(href !== undefined);

    // NOTHING OFFERED — the default state of a document nobody has edited, stated as itself.
    const before = await s.get(href);
    assert.equal(before.status, 200);
    assert.match(before.body, /data-public-state="nothing-offered"/);
    assert.match(before.body, /Nothing is published on this leaf\./);
    assert.equal(/data-published-row/.test(before.body), false);
    // No number at all: the empty arms of the projection carry no list to count, so there is
    // nothing here a zero could be printed from — and a zero would be a claim about the size of
    // a set the reader is not entitled to know the size of.
    assert.deepEqual(allMatches(before.body, /<b class="fol-metric">(\d+)<\/b>/g), []);
    // ESCAPED ON BOTH SIDES OF THIS TEST. A title out of real git history can hold an apostrophe
    // — one landed in this repository on 2026-08-20 — and the renderer writes it as `&#39;`. The
    // present-check below went red on a correct page; these absence-checks were the worse half of
    // the same mistake, because a raw `includes` can only ever pass once the text is escaped, so
    // they would have stayed green with the title sitting on the page in plain sight.
    for (const l of leaf.leaflets) {
      assert.equal(
        before.body.includes(esc(l.title)),
        false,
        `an unpublished title reached the page`,
      );
    }

    // THE SUBJECT THEN OFFERS ONE OUTWARD — the real command — and the page has to change, because
    // "has published nothing" is now a false sentence about them.
    const first = firstPublishable(leaf);
    await share(document, first.id, "public");

    const after = await s.get(href);
    assert.equal(after.status, 200);
    assert.match(after.body, /data-public-state="listed"/);
    assert.ok(
      after.body.includes(esc(first.title)),
      "the artifact its subject published is not shown",
    );
    // EXACTLY ONE, and the rest of the portfolio is still not on the page. Publishing one leaflet
    // must not publish the compound. "The rest" is by id, not by position — the one shared is
    // not necessarily the first.
    for (const l of leaf.leaflets.filter((l) => l.id !== first.id)) {
      assert.equal(
        after.body.includes(esc(l.title)),
        false,
        `an unpublished title reached the page`,
      );
    }

    // AND ITS OWN ADDRESS SERVES IT, saying in words what it does not prove. This is the half that
    // makes dropping the tier gate honest rather than a quiet widening: the gate was replaced by a
    // disclosure, so a page without the disclosure is a regression even though it is not empty.
    const artifact = await s.get(`/leaflet/${encodeURIComponent(first.id)}`);
    assert.equal(artifact.status, 200);
    assert.ok(artifact.body.includes(esc(first.title)));
    assert.match(artifact.body, /NOT cryptographically established/);
  });
});

test("everyPublicResponseCarriesTheSecurityHeadersAndTheOneSprite", async () => {
  // The routes were added to a server whose headers are set per-response. A page that acquired
  // its own send path and lost `frame-ancestors 'none'` would be framable by any origin, and
  // nothing on screen would show it — `csp.test.ts` covers the routes that existed when it was
  // written, and these are the ones that did not.
  const dir = await tempDir();
  const [identity] = await realIdentities(REPO, 1);
  assert.ok(identity !== undefined);
  await realLeafFrom(REPO, "Header Subject", identity, join(dir, "h.leaf.json"));
  const manifest = join(dir, "tree.json");
  await writeFile(
    manifest,
    JSON.stringify({ id: "hdr", company: "Header Company", leaves: ["h.leaf.json"] }),
  );

  const packaged = await readFile(
    fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")),
    "utf8",
  );
  const packagedIds = [...packaged.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string);

  await withServer({ FOLIAGE_TREE: manifest }, async (s) => {
    const tree = await s.get("/tree");
    const [href] = hrefs(tree.body, "/leaf/");
    assert.ok(href !== undefined);

    for (const path of [href, "/leaf/nobody", "/leaflet/git:nothing", "/leaflet/x?leaf=y"]) {
      const res = await fetch(s.origin + path, { signal: AbortSignal.timeout(5_000) });
      const csp = res.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'none'/, `${path} has no default-src`);
      assert.match(csp, /frame-ancestors 'none'/, `${path} is framable by any origin`);
      assert.equal(csp.includes("unsafe-inline"), false, `${path} widened the policy`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("cache-control"), "no-store");
      // Readable is not findable. The person consented to a PAGE with `--confirm <id>`, not to
      // being indexed; and listed→unlisted does not survive a crawler's cache.
      assert.equal(
        res.headers.get("x-robots-tag"),
        "noindex, noarchive, nosnippet, noimageindex",
        `${path} is indexable`,
      );

      const body = await res.text();
      // Content-length must describe the buffer that was SENT. The sprite is injected after the
      // page is rendered, so a length taken before injection is a truncated response — a defect
      // that shows as a hung request rather than as a wrong page.
      assert.equal(
        Number(res.headers.get("content-length")),
        Buffer.byteLength(body, "utf8"),
        `${path} declared a length that is not the body's`,
      );
      // EXACTLY ONE copy of the sprite, and it is the package's, symbol for symbol.
      const ids = [...body.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string);
      assert.deepEqual(ids, packagedIds, `${path} did not receive the package's sprite`);
      assert.equal(new Set(ids).size, ids.length, `${path} has a duplicate symbol id`);
      const uses = [...body.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1] as string);
      assert.deepEqual(uses.filter((u) => !ids.includes(u)), [], `${path} has a dangling <use>`);
    }
  });
});
