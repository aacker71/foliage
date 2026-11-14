/**
 * THE SEAM, for the three pages `.fol-nav` now ties together: the real server, a real company
 * manifest on disk, and a real release store — the same shapes `companyDocument.ts` and
 * `releaseStore.ts` are unit-tested against elsewhere, but read here through actual HTTP the
 * way a browser would, with every number RECOMPUTED independently and compared digit for digit.
 *
 * WHY A SEPARATE FILE FROM `release.test.ts`. That file proves `fire`/`loadStore`/`allHistory`
 * are correct in isolation. Every one of its assertions can pass while the assembled product
 * is wrong — the rows on `/releases` and `/members` could silently stop matching what the
 * store and the company actually hold, which is exactly the class of defect this project has
 * shipped before (recorded in `apps/canopy/src/seam.test.ts`, the sibling app's own seam
 * suite). So this file spawns the real `server.mjs`, speaks HTTP to it, and independently
 * RELOADS the same files through `loadCompany`/`loadStore` — the production loaders, called a
 * second time here — rather than trusting the page's own arithmetic or hand-typing an expected
 * count that could drift from the fixture.
 *
 * THE FIXTURE COMPANY IS REAL FILES, NOT INVENTED CONTENT SHOWN TO A USER. "Acme Instruments"
 * mirrors the fixture `packages/enterprise-policy/src/bough.test.ts` already established for
 * exactly this shape of tree (two boughs, nested branches, a bough-direct report) — one
 * fixture identity reused across the repo rather than a fresh invention. Every leaf document
 * below is written to disk and loaded through the REAL `loadCompany`/`parseLeafDocument`
 * chain, the same as production; nothing is mocked.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultPublishPolicy } from "@foliage/leaf";
import { companySize, duplicateLeaves, everyLimb, releaseContents, releaseContentsDigest } from "@foliage/enterprise-policy";

import { loadCompany, type CompanyLoad } from "./companyDocument.ts";
import { allHistory, fire, loadStore, readReleaseStorage, saveStore, stateOf, type ReleaseStore } from "./releaseStore.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-enterprise-shell-"));
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
  get(path: string): Promise<{ status: number; body: string; headers: Headers }>;
}

const BOOT_DEADLINE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Start the REAL server with the given environment, hand it to `body`, and always kill it. */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FOLIAGE_ACTOR: "policy_owner", ...env, PORT: String(port), HOST: "127.0.0.1" },
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
    return { status: res.status, body: await res.text(), headers: res.headers };
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
        await get("/");
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

/** A minimal but structurally real leaf document, written to disk. */
async function writeLeaf(
  dir: string,
  filename: string,
  leaf: { id: string; subject: string; leaflets: readonly unknown[] },
): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(leaf, null, 2));
  return filename;
}

const PROV = (ref: string) => ({ source: "git", ref, observedAt: "2026-01-05T00:00:00Z" });

/**
 * Every text node on the page, with the `<style>` block removed first. `font-weight` is a
 * real CSS property this app's own pre-existing stylesheet uses, and it contains the
 * substring "weight" — one of the score-shaped words checked below — so scanning raw HTML
 * would flag the app's OWN unrelated CSS. What "no score-shaped text" actually means is that
 * no score reaches the reader, and CSS is never read by a reader.
 */
function withoutStyleBlock(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "");
}

/** Builds the "Acme Instruments" fixture on disk and returns the manifest path. */
async function acmeManifest(dir: string): Promise<string> {
  const ada = await writeLeaf(dir, "ada.leaf.json", {
    id: "ada",
    subject: "Ada Lovelace",
    leaflets: [
      { id: "ada-1", title: "Runtime scheduler rewrite", tier: "verified", provenance: PROV("ada1") },
      { id: "ada-2", title: "Backpressure fix", tier: "verified", provenance: PROV("ada2") },
      { id: "ada-3", title: "Draft: allocator notes", tier: "pending" },
      { id: "ada-4", title: "Unattributed commit", tier: "excluded", reason: "no matching identity in this repository's history" },
    ],
  });
  const rey = await writeLeaf(dir, "rey.leaf.json", { id: "rey", subject: "Rey Solis", leaflets: [] });
  const kai = await writeLeaf(dir, "kai.leaf.json", {
    id: "kai",
    subject: "Kai Chen",
    leaflets: [{ id: "kai-1", title: "Compiler pass draft", tier: "pending" }],
  });
  const sol = await writeLeaf(dir, "sol.leaf.json", {
    id: "sol",
    subject: "Sol Whitfield",
    leaflets: [{ id: "sol-1", title: "Infra migration", tier: "verified", provenance: PROV("sol1") }],
  });
  const mira = await writeLeaf(dir, "mira.leaf.json", {
    id: "mira",
    subject: "Mira Alvarez",
    leaflets: [{ id: "mira-1", title: "Unsigned patch", tier: "excluded", reason: "commit signature did not verify" }],
  });
  const nell = await writeLeaf(dir, "nell.leaf.json", { id: "nell", subject: "Nell Ostrander", leaflets: [] });

  const manifest = join(dir, "company.json");
  await writeFile(
    manifest,
    JSON.stringify({
      id: "acme",
      company: "Acme Instruments",
      boughs: [
        {
          id: "platform",
          name: "Platform",
          leaves: [{ path: mira }],
          branches: [
            {
              id: "runtime",
              name: "Runtime",
              leaves: [{ path: ada }, { path: rey }],
              branches: [{ id: "compiler", name: "Compiler", leaves: [{ path: kai }], branches: [] }],
            },
            { id: "infra", name: "Infra", leaves: [{ path: sol }], branches: [] },
          ],
        },
        {
          id: "design",
          name: "Design",
          leaves: [],
          branches: [{ id: "brand", name: "Brand", leaves: [{ path: nell }], branches: [] }],
        },
      ],
    }),
  );
  return manifest;
}

/** Seeds a release store with real, applied transitions via the REAL `fire`/`saveStore`. */
async function acmeReleaseStore(dir: string): Promise<string> {
  let store: ReleaseStore = {};
  for (const [leaf, event, actor, at] of [
    ["ada", "propose", "subject", "2026-08-01T00:00:00Z"],
    ["ada", "open_review", "policy_owner", "2026-08-02T00:00:00Z"],
    ["ada", "approve", "policy_owner", "2026-08-03T00:00:00Z"],
    ["ada", "publish", "policy_owner", "2026-08-04T00:00:00Z"],
    ["mira", "propose", "subject", "2026-08-01T12:00:00Z"],
    ["mira", "retract", "subject", "2026-08-01T13:00:00Z"],
  ] as const) {
    const r = fire(store, leaf, event, actor, at);
    assert.equal(r.ok, true, `${leaf}/${event} should have been a legal seed transition`);
    if (r.ok) store = r.store;
  }
  const path = join(dir, "release.json");
  await saveStore(path, store);
  return path;
}

/** Load the fixture through the REAL production loader, a second time, independently. */
async function reloadCompany(manifest: string): Promise<Extract<CompanyLoad, { ok: true }>> {
  const load = await loadCompany({ FOLIAGE_COMPANY: manifest });
  assert.equal(load.ok, true, "the fixture manifest failed to (re)load — the fixture itself is broken");
  if (!load.ok) throw new Error("unreachable");
  return load;
}

/* ============================================================================================
   `.fol-nav` reaches all three pages, and marks the right one current.
   ============================================================================================ */

test("everyPageCarriesTheSharedNavWithTheRightPageMarkedCurrent", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    for (const [path, current] of [
      ["/", "Org chart"],
      ["/releases", "Releases"],
      ["/members", "Members"],
    ] as const) {
      const { status, body } = await s.get(path);
      assert.equal(status, 200, `${path} did not return 200`);
      if (path === "/") for (const asset of ["/roles.css","/controls.css","/workspace-shell.css","/enterprise.css","/mark-icon.svg"]) {
        assert.equal((await s.get(asset)).status,200,asset);
      }

      // The shared component, present — not a page-local re-implementation of a navbar.
      assert.match(body, /<header class="fol-workspace" data-layout="rail" data-plane="internal">/, `${path} has no .fol-nav`);
      assert.match(body, /<nav aria-label="Primary" class="fol-workspace-nav">/);
      for (const label of ["Org chart", "Releases", "Members"]) {
        assert.ok(body.includes(`>${label}</a>`), `${path} is missing the "${label}" nav link`);
      }

      // Exactly one link is current, and it is the right one — colour is not the only cue
      // (foliage.css also gives aria-current="page" a border and a weight change), but this
      // is the one a screen reader and this test can both see.
      const currentLinks = [...body.matchAll(/<a href="[^"]*"( aria-current="page")?>([^<]+)<\/a>/g)]
        .filter((m) => m[1] !== undefined)
        .map((m) => m[2]);
      assert.deepEqual(currentLinks, [current], `${path} marked the wrong nav item current`);

      // The plane badge names the plane in WORDS, per foliage.css's own contract for it —
      // never colour alone. Case-insensitive: the source is sentence case and the stylesheet
      // uppercases it on screen, matching shell.html's own demo convention.
      assert.match(body, /data-plane="internal"/);
      assert.match(body, /class="fol-workspace-section">Enterprise<\/span>/);
      const nav = body.match(/<nav aria-label="Primary"[\s\S]*?<\/nav>/)?.[0] ?? "";
      assert.doesNotMatch(nav, /href="\/(?:leaf|workflow|recruiting)(?:["/?])/);

      // The existing inverted plane-bar is untouched — "this app's existing face/plane
      // treatment is the law" — so the nav is additive, not a replacement of it.
      assert.match(body, /<div class="plane-bar plane-bar--internal">/);
    }
  });
});

/* ============================================================================================
   `/releases` — table rows equal the store, reloaded and recomputed independently.
   ============================================================================================ */

test("releasesPageRowsEqualTheStoreReloadedAndRecomputedIndependently", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);

  // Reloaded from the SAME FILE the server will read, a second time, independently — not the
  // in-memory store object this test built it from.
  const expected = allHistory(await loadStore(releasePath));
  assert.equal(expected.length, 6, "the seed above should have produced 6 applied transitions");

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const { status, body } = await s.get("/releases");
    assert.equal(status, 200);

    assert.match(body, /<table class="fol-table">/);
    assert.deepEqual(
      [...body.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]),
      ["Leaf", "Event", "Actor", "From", "To", "When"],
    );

    const rows = [...body.matchAll(/<tr data-release-event="([a-z_]+)" data-release-leaf="([^"]+)">/g)];
    assert.equal(rows.length, expected.length, "row count on the page disagrees with the reloaded store");
    assert.deepEqual(
      rows.map((m) => `${m[2]} ${m[1]}`),
      expected.map((r) => `${r.leaf} ${r.event}`),
      "row order/content on the page disagrees with allHistory() over the reloaded store",
    );

    // Ada's leaf id resolves to her subject name (the company knows her); the "when" column
    // carries the real recorded instant for the newest row (publish).
    const newest = expected[0];
    assert.ok(newest !== undefined);
    assert.ok(body.includes("Ada Lovelace"), "the leaf id was not resolved to the subject's name");
    assert.ok(body.includes(`<time datetime="${newest.at}">`));
    assert.ok(!body.includes(`<time datetime="${newest.at}">${newest.at}</time>`), "the exact timestamp should not be the primary date label");

    // Approval and publication are DIFFERENT rows with DIFFERENT to-states — never collapsed
    // into one event, and the "to" chip's colour never borrows the accent (E2: the accent
    // never encodes release state — .chip--live/.chip--approved use --fol-verified/--fol-text,
    // neither of which is --fol-accent). Nothing consumes the publish event, so the `live`
    // chip says what was recorded rather than claiming the work is live.
    assert.match(body, /<td><span class="chip chip--approved"[^>]*>Approved<\/span><\/td>/);
    assert.match(body, /<td><span class="chip chip--live"[^>]*>Publish recorded · not delivered yet<\/span><\/td>/);
    assert.doesNotMatch(body, />Live</);
  });
});

test("releasesPageWithNoHistoryShowsTheHonestEmptyPlateNotAnEmptyTable", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const emptyStore = join(dir, "empty-release.json");
  await saveStore(emptyStore, {});

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: emptyStore }, async (s) => {
    const { status, body } = await s.get("/releases");
    assert.equal(status, 200);
    assert.equal(
      /<table class="fol-table">/.test(body),
      false,
      "a table with zero rows was rendered instead of the empty plate",
    );
    assert.match(body, /class="plate"/);
    assert.match(body, /No release decisions yet/);
    assert.match(body, /href="\/">Open org chart<\/a>/);
  });
});

test("a named missing Leaf is a repair state across chart, members and releases", async () => {
  const dir = await tempDir();
  const manifest = join(dir, "company.json");
  await writeFile(manifest, JSON.stringify({
    company: "Foliage",
    boughs: [{ id: "foliage", name: "Foliage", leaves: [{ path: "missing.leaf.json" }], branches: [] }],
  }));
  const load = await reloadCompany(manifest);
  assert.equal(load.named, 1);
  assert.equal(load.failures.length, 1);
  assert.equal(load.failures[0]?.cause, "absent");

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: join(dir, "release.json") }, async (s) => {
    const chart = (await s.get("/")).body;
    assert.match(chart, /1 of 1 member file needs attention/);
    assert.match(chart, /data-entry-failure="absent"/);

    const members = (await s.get("/members")).body;
    assert.match(members, /data-entry-failure="absent"/);
    assert.match(members, /Repair member files/);
    assert.doesNotMatch(members, /No members yet|Add members/);

    const releases = (await s.get("/releases")).body;
    assert.match(releases, /No release decisions yet/);
    assert.match(releases, /href="\/members">Review member files<\/a>/);
    assert.doesNotMatch(releases, /Add members/);
  });
});

/* ============================================================================================
   `/members` — a flat roster equal to the company, reloaded and recomputed independently;
   duplicates named honestly.
   ============================================================================================ */

test("membersPageRowsEqualTheCompanyReloadedAndRecomputedIndependently", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);
  const load = await reloadCompany(manifest);
  const store = await loadStore(releasePath);

  // The independent expectation: every leaf under every limb, via the REAL `everyLimb`.
  const expectedLeaves = everyLimb(load.tree).flatMap((l) => l.leaves);
  assert.equal(duplicateLeaves(load.tree).length, 0, "the healthy fixture should have no duplicates");

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const { status, body } = await s.get("/members");
    assert.equal(status, 200);

    assert.deepEqual(
      [...body.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]),
      ["Person", "Org path", "Release state"],
    );

    const rows = [...body.matchAll(/<tr data-person="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(rows.length, expectedLeaves.length, "row count disagrees with everyLimb(tree).flatMap(leaves)");
    assert.deepEqual(
      rows.slice().sort(),
      expectedLeaves.map((l) => l.id).sort(),
      "the set of people on the page disagrees with the company, reloaded independently",
    );
    assert.equal(/data-duplicate-leaves="true"/.test(body), false, "the healthy fixture has no duplicates to report");

    // Every row's release-state chip, checked against the SAME domain function the server itself
    // calls (`stateOf`) — over data loaded a second time here, not taken on faith from the page.
    // And no proof-tier tally: a per-person count on an employer roster invites ranking people.
    for (const leaf of expectedLeaves) {
      const row = body.slice(
        body.indexOf(`data-person="${leaf.id}"`),
        body.indexOf("</tr>", body.indexOf(`data-person="${leaf.id}"`)),
      );
      assert.ok(row.length > 0, `no row rendered for ${leaf.id}`);

      const expectedState = stateOf(store, leaf.id);
      assert.match(
        row,
        new RegExp(`class="chip chip--${expectedState === "in_review" ? "review" : expectedState}"`),
        `${leaf.id}'s row does not show release state "${expectedState}"`,
      );

      assert.doesNotMatch(row, /\d+ (?:verified|pending|excluded)|data-tier=/, `${leaf.id}'s row tallies proof tiers`);
    }

    // Mira reports to the bough directly — her org path is exactly one limb long.
    const miraRow = body.slice(body.indexOf('data-person="mira"'), body.indexOf("</tr>", body.indexOf('data-person="mira"')));
    assert.match(miraRow, />Platform<\/td>/);
    // Ada is two limbs down.
    const adaRow = body.slice(body.indexOf('data-person="ada"'), body.indexOf("</tr>", body.indexOf('data-person="ada"')));
    assert.match(adaRow, /Platform\s*›\s*Runtime/);
  });
});

test("membersPageSurfacesADuplicateLeafHonestlyAtEveryOccurrence", async () => {
  const dir = await tempDir();
  // A minimal, deliberately broken manifest: the SAME leaf id filed under two different
  // limbs — the defect `duplicateLeaves()` exists to catch.
  const dup = await writeLeaf(dir, "dup.leaf.json", { id: "dup", subject: "Duplicated Person", leaflets: [] });
  const manifest = join(dir, "company.json");
  await writeFile(
    manifest,
    JSON.stringify({
      id: "broken",
      company: "Broken Instruments",
      boughs: [
        { id: "a", name: "Org A", leaves: [{ path: dup }], branches: [] },
        {
          id: "b",
          name: "Org B",
          leaves: [],
          branches: [{ id: "team", name: "Team B1", leaves: [{ path: dup }], branches: [] }],
        },
      ],
    }),
  );
  const emptyStore = join(dir, "release.json");
  await saveStore(emptyStore, {});

  const load = await reloadCompany(manifest);
  const expectedDuplicates = duplicateLeaves(load.tree);
  assert.deepEqual(expectedDuplicates, ["dup"]);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: emptyStore }, async (s) => {
    const { status, body } = await s.get("/members");
    assert.equal(status, 200);

    // The defect is named, by id, honestly — not silently resolved to one occurrence — and
    // the id named matches duplicateLeaves(), reloaded independently.
    assert.match(body, /data-duplicate-leaves="true"/);
    for (const id of expectedDuplicates) {
      assert.ok(body.includes(`>${id}<`) || body.includes(`>${id}</`), `duplicate id "${id}" is not named in the banner`);
    }

    // AND both occurrences are shown, each with the org path it actually sits at — this is
    // why the roster does not simply call pathToLeaf() per id, which would collapse to one.
    const rows = [...body.matchAll(/<tr data-person="dup">/g)];
    assert.equal(rows.length, 2, "a duplicated leaf must appear once per limb it is filed under");
    assert.match(body, />Org A<\/td>/);
    assert.match(body, /Org B\s*›\s*Team B1/);
  });
});

/* ============================================================================================
   The release review shows what approving would release — the subject's own PUBLIC records —
   and never a per-person tally, an unlisted record, or somebody else's work.
   ============================================================================================ */

/**
 * Records the subject shared that the default publish rail refuses — a rating-shaped title, no
 * evidence at all, third-party evidence. Each is the subject's own and offered, so only the rail
 * keeps it out of a release.
 */
const RAIL_DENIED = [
  { id: "ada-rating", title: "Customer survey rated me 4.5/5", tier: "verified", provenance: PROV("adar"), visibility: "public" },
  { id: "ada-bare", title: "Bare claim with no evidence", tier: "pending", visibility: "public" },
  { id: "ada-about", title: "Mentoring notes", tier: "pending",
    provenance: { source: "notes:third-party", ref: "n1", observedAt: "2026-01-05T00:00:00Z" }, visibility: "unlisted" },
] as const;

/**
 * Records the subject is willing to hand out by link but not to have enumerated. Verified and
 * evidenced, so nothing but their audience keeps them off an employer's review.
 */
const LINK_ONLY = Array.from({ length: 3 }, (_, i) => ({
  id: `ada-link-${i + 1}`,
  title: `Link-only record ${i + 1}`,
  tier: "verified",
  provenance: PROV(`adal${i + 1}`),
  visibility: "unlisted",
}));

/**
 * One person whose leaf holds every case a review can get wrong: public records of both own
 * tiers (pending first, so a tier sort would show), more than the preview shows, unlisted
 * records between them, a record by someone else that is marked public, a private one, and
 * shared records the rail refuses.
 */
async function reviewManifest(dir: string): Promise<string> {
  const offered = Array.from({ length: 12 }, (_, i) => ({
    id: `ada-${i + 1}`,
    title: `Offered record ${i + 1}`,
    tier: i % 3 === 1 ? "verified" : "pending",
    provenance: PROV(`ada${i + 1}`),
    visibility: "public",
  }));
  const ada = await writeLeaf(dir, "ada.leaf.json", {
    id: "ada",
    subject: "Ada Lovelace",
    leaflets: [
      { id: "other-1", title: "Someone else's commit", tier: "excluded", visibility: "public",
        reason: "could not be attributed to this subject: the author identity is not among the declared identities" },
      ...offered.slice(0, 5),
      LINK_ONLY[0],
      RAIL_DENIED[0],
      { id: "ada-private", title: "Private draft", tier: "pending", visibility: "private" },
      RAIL_DENIED[1],
      ...offered.slice(5, 10),
      LINK_ONLY[1],
      ...offered.slice(10),
      RAIL_DENIED[2],
      LINK_ONLY[2],
    ],
  });
  const manifest = join(dir, "company.json");
  await writeFile(manifest, JSON.stringify({
    id: "acme", company: "Acme Instruments",
    boughs: [{ id: "platform", name: "Platform", leaves: [{ path: ada }], branches: [] }],
  }));
  return manifest;
}

/** Real, applied transitions for each leaf up to `in_review` — one step further with `approved`. */
async function inReviewStore(dir: string, leaves: readonly string[], approved?: { digest: string }): Promise<string> {
  let store: ReleaseStore = {};
  for (const leaf of leaves) {
    for (const [event, actor, at] of [
      ["propose", "subject", "2026-08-01T00:00:00Z"],
      ["open_review", "policy_owner", "2026-08-02T00:00:00Z"],
    ] as const) {
      const r = fire(store, leaf, event, actor, at);
      assert.equal(r.ok, true);
      if (r.ok) store = r.store;
    }
    if (approved !== undefined) {
      const r = fire(store, leaf, "approve", "policy_owner", "2026-08-03T00:00:00Z", approved.digest);
      assert.equal(r.ok, true);
      if (r.ok) store = r.store;
    }
  }
  const path = join(dir, "review-release.json");
  await saveStore(path, store);
  return path;
}

/** One person's card on the chart. */
function cardOf(body: string, leaf: string): string {
  const start = body.indexOf(`data-person="${leaf}"`);
  assert.notEqual(start, -1, `no card for ${leaf}`);
  return body.slice(start, body.indexOf("</article>", start));
}

/** The hidden fields of the form that fires `event`, exactly as a browser would post them. */
function formFor(body: string, event: string): URLSearchParams {
  const markup = [...body.matchAll(/<form method="post" action="\/release">([\s\S]*?)<\/form>/g)]
    .map((m) => m[1]!)
    .find((form) => form.includes(`name="event" value="${event}"`));
  assert.ok(markup, `no ${event} form on the page`);
  return new URLSearchParams(
    [...markup.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m): [string, string] => [m[1]!, m[2]!]),
  );
}

/** What a review of `leaf` should carry, recomputed from the files through the production loader. */
async function expectedDigest(manifest: string, leaf: string): Promise<string> {
  const load = await reloadCompany(manifest);
  const found = everyLimb(load.tree).flatMap((l) => l.leaves).find((l) => l.id === leaf);
  assert.ok(found);
  const policy = defaultPublishPolicy();
  assert.ok(policy.ok);
  return releaseContentsDigest(releaseContents(found, policy.policy));
}

test("a release under review lists only the subject's own public records, the rest in a closed disclosure", async () => {
  const dir = await tempDir();
  const manifest = await reviewManifest(dir);
  const releasePath = await inReviewStore(dir, ["ada"]);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const card = cardOf((await s.get("/")).body, "ada");
    assert.match(card, /data-release="in_review"/);
    // Twelve public records: the three unlisted ones are not in the count.
    assert.match(card, /data-release-contents="12"/);

    // Document order: the first ten in view, the other two in a closed disclosure, none dropped.
    const rowsIn = (html: string) => [...html.matchAll(/<li class="ent-release__record" data-leaflet="([^"]+)">/g)].map((m) => m[1]);
    const more = card.slice(card.indexOf('<details class="ent-release__more"'));
    assert.deepEqual(rowsIn(card), Array.from({ length: 12 }, (_, i) => `ada-${i + 1}`));
    assert.deepEqual(rowsIn(more), ["ada-11", "ada-12"]);
    assert.match(more, /^<details class="ent-release__more" data-release-more="2">\s*<summary>Show 2 more<\/summary>/);
    assert.doesNotMatch(card, /<details[^>]* open|\+\d+ more/);

    // Title and the record's own tier. Every row is public once released, said once in the
    // heading rather than as a per-row word that could read as "already public".
    const first = card.slice(card.indexOf('data-leaflet="ada-1"'), card.indexOf("</li>", card.indexOf('data-leaflet="ada-1"')));
    assert.match(first, /Offered record 1/);
    assert.match(first, /<span class="proof proof-pending" data-pill-tier="pending">Attributed, unverified<\/span>/);
    const second = card.slice(card.indexOf('data-leaflet="ada-2"'), card.indexOf("</li>", card.indexOf('data-leaflet="ada-2"')));
    assert.match(second, /data-pill-tier="verified">Verified</);
    assert.doesNotMatch(card, />Public<|>Unlisted<|ent-release__audience/);

    // The section is named by its visible heading, and Approve is described by it; Reject is not.
    const section = card.match(/<section class="[^"]*ent-release" id="([^"]+)" aria-labelledby="([^"]+)"/);
    assert.ok(section, "the release section has an id and an accessible name");
    const [, sectionId, headingId] = section;
    assert.match(card, new RegExp(`<h3 class="fol-label ent-release__h" id="${headingId}">In this release · Public once released</h3>`));
    assert.match(card, new RegExp(`<button[^>]*aria-describedby="${sectionId}"[^>]*>Approve</button>`));
    assert.doesNotMatch(card, /<button[^>]*aria-describedby=[^>]*>Reject<\/button>/);

    // An unlisted record is never named, identified or counted to a reader who is not its
    // subject: a link share is not consent to be enumerated.
    for (const link of LINK_ONLY) {
      assert.doesNotMatch(card, new RegExp(`${link.id}"|${link.title}`), `${link.id} is enumerated`);
    }
    assert.doesNotMatch(card, /Link-only|unlisted|"1[345]"|\+[1-5] more|Show [345] more/i);

    // Somebody else's commit is never put under Ada's name, even marked public; a private
    // record is never offered; and no tier is tallied for the person.
    assert.doesNotMatch(card, /Someone else|other-1|could not be attributed|excluded/i);
    assert.doesNotMatch(card, /Private draft|ada-private/);
    assert.doesNotMatch(card, /\d+ (?:verified|pending|excluded)|data-tier=/);

    // What the rail refuses is never offered for approval, and silently: no title, no id, no
    // reason, no count — a score about a person never reaches this screen.
    for (const denied of RAIL_DENIED) {
      assert.doesNotMatch(card, new RegExp(`${denied.id}"|${denied.title}`), `${denied.id} is listed for release`);
    }
    assert.doesNotMatch(card, /4\.5\/5|rated|rating|third-party|no evidence|withheld|denied|deny-/i);

    // Approve carries the digest of exactly this list, recomputed independently from the files.
    assert.equal(formFor(card, "approve").get("contentsDigest"), await expectedDigest(manifest, "ada"));
    assert.equal(formFor(card, "reject").get("contentsDigest"), null);
  });
});

test("an approved release shows the same list, and Publish is bound to it", async () => {
  const dir = await tempDir();
  const manifest = await reviewManifest(dir);
  const digest = await expectedDigest(manifest, "ada");
  const releasePath = await inReviewStore(dir, ["ada"], { digest });

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const card = cardOf((await s.get("/")).body, "ada");
    assert.match(card, /data-release="approved"/);
    assert.match(card, /data-release-contents="12"/);
    assert.equal([...card.matchAll(/<li class="ent-release__record" data-leaflet="ada-\d+">/g)].length, 12);
    assert.doesNotMatch(card, /Link-only|ada-link-/);
    const sectionId = card.match(/<section class="[^"]*ent-release" id="([^"]+)"/)?.[1];
    assert.ok(sectionId);
    assert.match(card, new RegExp(`<button[^>]*aria-describedby="${sectionId}"[^>]*>Publish</button>`));
    assert.equal(formFor(card, "publish").get("contentsDigest"), digest);
  });
});

test("a review whose public records the rail all refuses says the rules hold them back, naming no cause", async () => {
  const dir = await tempDir();
  const bea = await writeLeaf(dir, "bea.leaf.json", {
    id: "bea",
    subject: "Bea Okafor",
    leaflets: [
      { id: "bea-rating", title: "Rated 9 out of 10 by the review panel", tier: "verified", provenance: PROV("bear"), visibility: "public" },
      { id: "bea-bare", title: "Bare claim with no evidence", tier: "pending", visibility: "unlisted" },
    ],
  });
  const manifest = join(dir, "company.json");
  await writeFile(manifest, JSON.stringify({
    id: "acme", company: "Acme Instruments",
    boughs: [{ id: "platform", name: "Platform", leaves: [{ path: bea }], branches: [] }],
  }));
  const releasePath = await inReviewStore(dir, ["bea"]);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const card = cardOf((await s.get("/")).body, "bea");
    assert.match(card, /data-release-contents="0"/);
    // Bea has public records, so "no public records yet" would be false; which rule held them
    // back is hers.
    assert.match(card, /None of Bea Okafor’s public records pass the publish rules\./);
    assert.doesNotMatch(card, /no public records yet|unlisted|<ul class="ent-release__records">/i);
    assert.doesNotMatch(card, /bea-rating|bea-bare|9 out of 10|Bare claim|rating|evidence|withheld|denied/i);
  });
});

test("a review with nothing public says so, even when unlisted records exist, instead of an empty list", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  // Rey's leaf gains records shared by link only: to an employer that is still nothing public.
  await writeFile(join(dir, "rey.leaf.json"), JSON.stringify({ id: "rey", subject: "Rey Solis", leaflets: LINK_ONLY }));
  const releasePath = await inReviewStore(dir, ["kai", "rey"]);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const { body } = await s.get("/");
    for (const [leaf, subject] of [["kai", "Kai Chen"], ["rey", "Rey Solis"]] as const) {
      const card = cardOf(body, leaf);
      assert.match(card, /data-release-contents="0"/);
      assert.match(card, new RegExp(`${subject} has no public records yet\\.`));
      assert.doesNotMatch(card, /<ul class="ent-release__records">|pass the publish rules|unlisted/i);
    }
    assert.doesNotMatch(cardOf(body, "rey"), /Link-only|ada-link-/);
    // Only the cards under review carry a release list.
    assert.equal((body.match(/data-release-contents=/g) ?? []).length, 2);
  });
});

test("approve and publish are bound to the records the review showed: a changed leaf is refused", async () => {
  const dir = await tempDir();
  const manifest = await reviewManifest(dir);
  const releasePath = await inReviewStore(dir, ["ada"]);
  const leafFile = join(dir, "ada.leaf.json");
  const editLeaf = async (change: (leaflets: Record<string, unknown>[]) => void) => {
    const doc = JSON.parse(await readFile(leafFile, "utf8")) as { leaflets: Record<string, unknown>[] };
    change(doc.leaflets);
    await writeFile(leafFile, JSON.stringify(doc, null, 2));
  };

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const post = (body: URLSearchParams) => fetch(s.origin + "/release", {
      method: "POST", body, headers: { origin: s.origin }, redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const approve = formFor((await s.get("/")).body, "approve");
    const before = await readFile(releasePath, "utf8");

    // A new link-only record changes nothing the approver could see, so it binds nothing.
    await editLeaf((leaflets) => {
      leaflets.push({ id: "ada-link-late", title: "Shared by link later", tier: "verified", provenance: PROV("adall"), visibility: "unlisted" });
    });
    assert.equal(formFor((await s.get("/")).body, "approve").get("contentsDigest"), approve.get("contentsDigest"));

    // A record the approver was never shown becomes public after the page was rendered.
    await editLeaf((leaflets) => {
      leaflets.push({ id: "ada-late", title: "Offered after the review", tier: "verified", provenance: PROV("adalate"), visibility: "public" });
    });
    const refused = await post(approve);
    assert.equal(refused.status, 409);
    const page = await refused.text();
    assert.match(page, /records in this release changed after this page was reviewed/);
    assert.match(page, /Reload the review/);
    assert.match(page, /<a [^>]*href="\/"[^>]*>Back to the chart<\/a>/);
    assert.doesNotMatch(page, /sha256|contentsDigest|ada-late/);
    assert.equal(await readFile(releasePath, "utf8"), before, "a refused approval writes nothing");

    // An approval with no digest at all cannot be about anything the reviewer saw.
    const bare = new URLSearchParams(approve);
    bare.delete("contentsDigest");
    bare.set("operationId", "test-no-digest");
    assert.equal((await post(bare)).status, 400);
    assert.equal(await readFile(releasePath, "utf8"), before);

    // Reloading shows the new list; approving that is accepted, and the history records it.
    const reviewed = formFor((await s.get("/")).body, "approve");
    const digest = reviewed.get("contentsDigest");
    assert.equal(digest, await expectedDigest(manifest, "ada"));
    assert.notEqual(digest, approve.get("contentsDigest"));
    assert.equal((await post(reviewed)).status, 303);
    const approved = await readReleaseStorage(releasePath);
    assert.equal(stateOf(approved.releases, "ada"), "approved");
    assert.equal(approved.releases["ada"]?.history.at(-1)?.contents, digest);

    // Publish is held to the same list: a record retitled after the page was rendered is refused.
    const publish = formFor((await s.get("/")).body, "publish");
    assert.equal(publish.get("contentsDigest"), digest);
    const approvedBytes = await readFile(releasePath, "utf8");
    await editLeaf((leaflets) => {
      const late = leaflets.find((l) => l["id"] === "ada-late");
      assert.ok(late);
      late["title"] = "Offered after the review, retitled";
    });
    assert.equal((await post(publish)).status, 409);
    assert.equal(await readFile(releasePath, "utf8"), approvedBytes);
  });
});

test("publish is held to the records the policy owner approved: a leaf changed after approval says so and cannot be published", async () => {
  const dir = await tempDir();
  const manifest = await reviewManifest(dir);
  const approvedDigest = await expectedDigest(manifest, "ada");
  const releasePath = await inReviewStore(dir, ["ada"], { digest: approvedDigest });
  const leafFile = join(dir, "ada.leaf.json");
  const original = await readFile(leafFile, "utf8");
  const late = { id: "ada-late", title: "Never approved by the policy owner", tier: "verified", provenance: PROV("adalate"), visibility: "public" };

  // The subject may publish from approved; only the policy owner may approve.
  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath, FOLIAGE_ACTOR: "subject" }, async (s) => {
    const post = (body: URLSearchParams) => fetch(s.origin + "/release", {
      method: "POST", body, headers: { origin: s.origin }, redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const doc = JSON.parse(original) as { leaflets: unknown[] };
    await writeFile(leafFile, JSON.stringify({ ...doc, leaflets: [late, ...doc.leaflets] }, null, 2));
    const changedDigest = await expectedDigest(manifest, "ada");
    assert.notEqual(changedDigest, approvedDigest);

    // Reloaded, the approved card does not list the new records under its Approved chip, says
    // why, and offers Retract but no Publish.
    const card = cardOf((await s.get("/")).body, "ada");
    assert.match(card, /data-release="approved"/);
    assert.match(card, /data-release-changed>\s*<p class="t-13">The records changed after approval\. Retract and review again\.<\/p>/);
    assert.doesNotMatch(card, /Never approved|ada-late|data-release-contents=|ent-release__record/);
    assert.doesNotMatch(card, /name="event" value="publish"/);
    const retract = formFor(card, "retract");

    // A publish posted anyway, about the records as they are now, is refused and writes nothing.
    const before = await readFile(releasePath, "utf8");
    const publish = new URLSearchParams(retract);
    publish.set("event", "publish");
    publish.set("contentsDigest", changedDigest);
    const refused = await post(publish);
    assert.equal(refused.status, 409);
    const page = await refused.text();
    assert.match(page, /The records changed after approval\. Retract and review again\. Nothing was changed\./);
    assert.doesNotMatch(page, /sha256|contentsDigest|ada-late/);
    assert.equal(await readFile(releasePath, "utf8"), before, "a refused publish writes nothing");

    // Back to the approved records, Publish returns and releases exactly those.
    await writeFile(leafFile, original);
    const restored = formFor(cardOf((await s.get("/")).body, "ada"), "publish");
    assert.equal(restored.get("contentsDigest"), approvedDigest);
    assert.equal((await post(restored)).status, 303);
    const published = await readReleaseStorage(releasePath);
    assert.equal(stateOf(published.releases, "ada"), "live");
    assert.equal(published.releases["ada"]?.history.at(-1)?.contents, approvedDigest);
  });
});

test("Approve and Reject are styled as different, defined controls", async () => {
  const dir = await tempDir();
  const manifest = await reviewManifest(dir);
  const releasePath = await inReviewStore(dir, ["ada"]);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const { body } = await s.get("/");
    const classOf = (label: string) => body.match(new RegExp(`<button[^>]*class="([^"]+)"[^>]*>${label}</button>`))?.[1] ?? "";
    assert.match(classOf("Approve"), /\bfol-button fol-button-primary\b/);
    assert.match(classOf("Reject"), /\bfol-button fol-button-outline\b/);
    assert.doesNotMatch(body, /btn--/);

    // The classes are defined by the stylesheet this page actually loads.
    const css = (await s.get("/controls.css")).body;
    assert.match(css, /\.fol-button\.fol-button-primary \{ background:/);
    assert.match(css, /\.fol-button\.fol-button-outline \{ background:/);
  });
});

/* ============================================================================================
   No score, no rating, no rank — anywhere on any of the three pages.
   ============================================================================================ */

test("noScoreShapedTextOnAnyOfTheThreePages", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    for (const path of ["/", "/releases", "/members"]) {
      const { body } = await s.get(path);
      const content = withoutStyleBlock(body).toLowerCase();
      for (const word of [
        "score",
        "rating",
        "rank",
        "grade",
        "percentile",
        "percent",
        "composite",
        "confidence",
        "out of",
      ]) {
        assert.equal(content.includes(word), false, `${path} contains the score-shaped word "${word}"`);
      }
    }
  });
});

/* ============================================================================================
   The new routes carry the same security headers as the existing one.
   ============================================================================================ */

test("theNewRoutesCarryTheSameSecurityHeadersAsTheExistingOne", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    for (const path of ["/releases", "/members"]) {
      const { headers } = await s.get(path);
      assert.match(headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
      assert.equal(headers.get("x-frame-options"), "DENY");
      assert.equal(headers.get("x-content-type-options"), "nosniff");
      assert.equal(headers.get("cache-control"), "no-store");
    }
  });
});

/* ============================================================================================
   Cross-check: `/`'s own counts still agree with the domain, reloaded independently, after
   its leaf-collecting walk was refactored onto `everyLimb`.
   ============================================================================================ */

test("theOrgChartsOwnCountsStillAgreeWithTheDomainAfterTheEveryLimbRefactor", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const releasePath = await acmeReleaseStore(dir);
  const load = await reloadCompany(manifest);
  const store = await loadStore(releasePath);
  const size = companySize(load.tree);
  const liveCount = everyLimb(load.tree)
    .flatMap((l) => l.leaves)
    .filter((l) => stateOf(store, l.id) === "live").length;

  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: releasePath }, async (s) => {
    const { body } = await s.get("/");
    assert.match(body, new RegExp(`<span class="counts__n">${size.boughs}</span>`));
    assert.match(body, new RegExp(`<span class="counts__n">${size.branches}</span>`));
    assert.match(body, new RegExp(`<span class="counts__n">${size.leaves}</span>`));
    // Publish is recorded, never delivered: the count and every chip say so, and nothing on the
    // chart claims a person is public or live.
    assert.match(body, new RegExp(`>Publish recorded</span><span class="counts__n">${liveCount}</span>`));
    assert.equal((body.match(/>Publish recorded · not delivered yet</g) ?? []).length, liveCount);
    assert.doesNotMatch(body, />Public<|>Live</);
  });
});


// Test operations only: exercise the real HTTP/storage boundary, not a customer portfolio.
test("release POST persists one event and safely replays the same form", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const path = join(dir, "transactional-release.json");
  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: path, FOLIAGE_ACTOR: "subject" }, async (server) => {
    const page = await server.get("/");
    const markup = page.body.match(/<form method="post" action="\/release">([\s\S]*?)<\/form>/)?.[1];
    assert.ok(markup);
    const form = new URLSearchParams([...markup.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((match): [string, string] => [match[1]!, match[2]!]));
    assert.ok(form.get("operationId"));
    assert.equal(form.get("expectedHistoryLength"), "0");
    const post = (body: URLSearchParams) => fetch(server.origin + "/release", {
      method: "POST", body, headers: { origin: server.origin }, redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert.equal((await post(form)).status, 303);
    const once = await readFile(path, "utf8");
    assert.equal((await post(form)).status, 303);
    assert.equal(await readFile(path, "utf8"), once);
    assert.equal((await readReleaseStorage(path)).outbox.length, 1);
    const stale = new URLSearchParams(form);
    stale.set("operationId", "test-stale-http-operation");
    const refused = await post(stale);
    assert.equal(refused.status, 409);
    assert.match(await refused.text(), /history changed/);
    assert.equal(await readFile(path, "utf8"), once);
    const missing = new URLSearchParams(form);
    missing.delete("operationId");
    assert.equal((await post(missing)).status, 400);
  });
});

test("corrupt release storage serves an honest failure and refuses POST without overwriting", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const path = join(dir, "corrupt-release.json");
  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: path, FOLIAGE_ACTOR: "subject" }, async (server) => {
    const page = await server.get("/");
    const markup = page.body.match(/<form method="post" action="\/release">([\s\S]*?)<\/form>/)?.[1];
    assert.ok(markup);
    const form = new URLSearchParams([...markup.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((match): [string, string] => [match[1]!, match[2]!]));
    const damaged = "{ test-only damaged history";
    await writeFile(path, damaged);
    for (const route of ["/", "/members", "/releases"]) {
      const response = await server.get(route);
      assert.equal(response.status, 500);
      assert.match(response.body, /not valid JSON/);
      assert.doesNotMatch(response.body, /No release decisions have been recorded/);
    }
    const response = await fetch(server.origin + "/release", {
      method: "POST", body: form, headers: { origin: server.origin }, redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("location"), null);
    assert.equal(await readFile(path, "utf8"), damaged);
  });
});

/** HTTP with these headers on the wire; `fetch` silently drops `Host` (.loop/STATUS.md X10). */
function speak(origin: string, path: string, headers: Record<string, string>, method = "GET", body = ""): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname, port, path, method, setHost: false, timeout: REQUEST_TIMEOUT_MS, headers: { ...headers, "content-length": Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on("error", reject);
    req.end(body);
  });
}

// DNS rebinding: a rebound page's Host and Origin agree, so the bound socket is the only witness.
test("a rebound Host is refused 421 on every route before anything is read or written", async () => {
  const dir = await tempDir();
  const manifest = await acmeManifest(dir);
  const path = join(dir, "rebinding-release.json");
  await withServer({ FOLIAGE_COMPANY: manifest, FOLIAGE_RELEASE: path, FOLIAGE_ACTOR: "subject" }, async (server) => {
    const { port } = new URL(server.origin);
    const markup = (await server.get("/")).body.match(/<form method="post" action="\/release">([\s\S]*?)<\/form>/)?.[1];
    assert.ok(markup);
    const form = new URLSearchParams([...markup.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((match): [string, string] => [match[1]!, match[2]!])).toString();
    const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
    const store = () => readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => error.code ?? "unreadable");
    const before = await store();

    const rebound = { Host: `foo.example:${port}`, Origin: `http://foo.example:${port}` };
    for (const [method, route, body] of [["GET", "/", ""], ["GET", "/members", ""], ["GET", "/releases", ""], ["POST", "/release", form]] as const) {
      const res = await speak(server.origin, route, { ...rebound, ...(body ? formHeaders : {}) }, method, body);
      assert.equal(res.status, 421, `${method} ${route} answered ${res.status} to a rebound Host`);
      assert.doesNotMatch(res.body, /<html|Acme Instruments/, `${method} ${route} refused and then served the page`);
      assert.match(res.body, /misdirected: Host was "foo\.example:\d+"/);
    }
    assert.equal(await store(), before, "a refused POST changed the release store");

    for (const host of ["127.0.0.1", "localhost"]) {
      const page = await speak(server.origin, "/", { Host: `${host}:${port}` });
      assert.equal(page.status, 200, `Host: ${host}:${port} is a real way to reach this server, refused`);
      assert.match(page.body, /Acme Instruments/);
    }
    const local = { Host: `127.0.0.1:${port}`, Origin: server.origin, ...formHeaders };
    assert.equal((await speak(server.origin, "/release", local, "POST", form)).status, 303);
    assert.equal((await readReleaseStorage(path)).outbox.length, 1);
  });
});
