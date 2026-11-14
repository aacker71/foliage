/**
 * THE CANOPY EXPORT — run as the process it is, against a real tree, into a real folder.
 *
 * WHY A PROCESS TEST AND NOT UNIT TESTS. Everything this exporter can get wrong is in the WIRING:
 * it calls the same renderers the server calls, so the pages are not in question — what is in
 * question is whether the folder it writes is a folder somebody can actually host. Both defects
 * found while building it were exactly that shape, and neither would have shown in a unit test:
 *
 *   - EVERY PAGE SHIPPED WITH NO MARKS. The server injects the mark sprite at request time, after
 *     the renderer returns; the first draft called the renderers directly and emitted documents
 *     whose every `<use href="#fol-mark-sm">` resolved to nothing. HTML that validates, renders
 *     without error, and is missing only its logo.
 *   - TWO LINKS POINTED AT A ROUTER THAT DOES NOT EXIST. `/` and `/tree` are routes on a server
 *     and files in a folder, and the first draft rewrote neither.
 *
 * So the assertions below are about the FOLDER: what is in it, whether the pages carry their
 * symbols, and whether every link resolves to a file that was written.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import { PUBLISHED_ARTIFACT, PUBLISHED_ARTIFACT_VERSION } from "@foliage/canopy";

const exec = promisify(execFile);
const EXPORT = fileURLToPath(new URL("../export.mjs", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../leaf/example/leaf.example.json", import.meta.url));

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A real tree naming the shipped example document, and a real export of it. */
async function exportOnce(leaves = ["a.leaf.json"]): Promise<{ out: string; stdout: string }> {
  const src = await temp("canopy-export-src-");
  await writeFile(join(src, "a.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "export-co", company: "Export Company", leaves }),
    "utf8",
  );
  const out = await temp("canopy-export-out-");
  const { stdout } = await exec(process.execPath, [EXPORT, "--out", out], {
    env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json") },
    timeout: 120_000,
  });
  return { out, stdout };
}

test("the exported folder is a folder somebody can host", async () => {
  const { out, stdout } = await exportOnce();

  const names = (await readdir(out, { recursive: true }))
    .map((n) => String(n).replace(/\\/g, "/"))
    .filter((n) => n.includes("."));
  for (const wanted of ["index.html", "tree.html", "leaf/example-leaf-not-real.html", "tree.css", "foliage.css"]) {
    assert.ok(names.includes(wanted), `${wanted} is missing from the export (${names.join(", ")})`);
  }

  // The summary reports closure, and says so only when it holds.
  assert.match(stdout, /every link resolves to a file that was written/);
  assert.doesNotMatch(stdout, /WARNING/);
});

test("every exported page carries the mark sprite — the defect that renders as a missing logo", async () => {
  const { out } = await exportOnce();
  for (const page of ["index.html", "tree.html", "leaf/example-leaf-not-real.html"]) {
    const html = await readFile(join(out, page), "utf8");
    const symbols = [...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(
      symbols.length > 0,
      `${page} carries no <symbol>, so every <use href="#fol-…"> on it resolves to nothing. The ` +
        `server injects the sprite AFTER the renderer returns; an exporter that calls the ` +
        `renderer directly and forgets is a page with no marks that still validates`,
    );
    // And the marks the page actually asks for are among them.
    for (const used of [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1])) {
      assert.ok(symbols.includes(used), `${page} references #${used} and the sprite does not define it`);
    }
  }
});

test("no link points at a route, because a folder has no router", async () => {
  const { out } = await exportOnce();
  for (const page of ["index.html", "tree.html", "leaf/example-leaf-not-real.html"]) {
    const html = await readFile(join(out, page), "utf8");
    const absolute = [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1]);
    assert.deepEqual(
      absolute,
      [],
      `${page} still links to ${absolute.join(", ")} — server routes, not files in this folder`,
    );
  }
});

test("a page in a subdirectory reaches the assets, which live at the root", async () => {
  /*
   * THE DEFECT THIS EXISTS FOR, and the reason the assertion is about DEPTH rather than about the
   * presence of a filename. The first draft rewrote every asset href to a BARE name — correct at
   * the root, wrong in `leaf/` — so every person page, the actual deliverable of a canopy, asked
   * for `foliage-tokens.css` while the file sat one directory above and rendered COMPLETELY
   * UNSTYLED. Served and measured: `GET /leaf/foliage-tokens.css` 404, `GET /foliage-tokens.css`
   * 200.
   *
   * The exporter's own closure report missed it because it compared bare filenames without asking
   * where the referencing page lived, and the first version of THIS FILE missed it because it
   * checked flat membership and the absence of a leading slash — neither of which a wrong relative
   * depth trips. So this resolves every href from the directory of the page that carries it, which
   * is the only question a browser will ask.
   */
  const { out } = await exportOnce();
  const files = new Set(
    (await readdir(out, { recursive: true })).map((n) => String(n).replace(/\\/g, "/")),
  );
  for (const page of ["index.html", "tree.html", "leaf/example-leaf-not-real.html"]) {
    const html = await readFile(join(out, page), "utf8");
    const dir = page.includes("/") ? `${page.slice(0, page.lastIndexOf("/"))}/` : "";
    const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
      .map((m) => m[1] as string)
      .filter((h) => !/^(?:https?:|mailto:|data:)/.test(h));
    assert.ok(refs.length > 0, `${page} references nothing at all, which cannot be right`);
    for (const href of refs) {
      const target = normalize(`${dir}${href}`).replace(/\\/g, "/").split("?")[0] as string;
      assert.ok(
        files.has(target),
        `${page} asks for "${href}", which resolves to "${target}" — not a file in this export. ` +
          `A browser reading that page from ${dir || "the root"} gets a 404`,
      );
    }
  }
});

test("a public leaflet refuses the whole export, because its page is not written", async () => {
  /*
   * THE CASE THE ONLY FIXTURE NEVER HAD. The shipped example document has no leaflet marked
   * `public`, so no exported page ever carried a `/leaflet/<id>` link and neither the closure test
   * above nor the summary line ever exercised the branch that matters. Publishing a leaflet is the
   * POINT of a canopy — it is the normal state, not the exotic one.
   *
   * The first draft printed a WARNING and exited 0, so a deploy wired as `export … && upload …`
   * would have shipped a person's page with a dead link to the artifact they chose to publish. It
   * refuses now, for the same reason an unsafe leaf id refuses: a folder whose links dangle looks
   * exactly as complete as one whose links work.
   */
  const src = await temp("canopy-export-public-");
  const doc = JSON.parse(await readFile(EXAMPLE, "utf8")) as {
    leaflets: { visibility?: string }[];
  };
  doc.leaflets[0]!.visibility = "public";
  await writeFile(join(src, "a.leaf.json"), JSON.stringify(doc), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "c", company: "C", leaves: ["a.leaf.json"] }),
    "utf8",
  );
  const out = await temp("canopy-export-public-out-");
  await assert.rejects(
    exec(process.execPath, [EXPORT, "--out", out], {
      env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json") },
      timeout: 120_000,
    }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 3, "a dangling leaflet link must refuse, not warn");
      assert.match(String(e.stderr), /REFUSED/);
      assert.match(String(e.stderr), /\/leaflet\//, "the refusal must name the link it cannot write");
      assert.match(String(e.stderr), /NOTHING was written/);
      return true;
    },
  );
  assert.deepEqual(await readdir(out), [], "the export wrote files despite refusing");
});

test("a leaf id that cannot be a filename refuses the whole export rather than dropping a page", async () => {
  /*
   * A folder missing one person's page is worse than no folder: it looks complete. The refusal is
   * asserted on the REAL failure mode — a manifest entry that does not load leaves the tree
   * loadable but the roster short — so the exporter is driven to a state it must decline rather
   * than a hand-made one.
   */
  const src = await temp("canopy-export-unsafe-");
  await writeFile(
    join(src, "a.leaf.json"),
    JSON.stringify({ id: "not/a/filename", subject: "Slashed", leaflets: [] }),
    "utf8",
  );
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "t", company: "C", leaves: ["a.leaf.json"] }),
    "utf8",
  );
  const out = await temp("canopy-export-unsafe-out-");
  await assert.rejects(
    exec(process.execPath, [EXPORT, "--out", out], {
      env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json") },
      timeout: 120_000,
    }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 3, "an unsafe id must refuse with its own exit code");
      assert.match(String(e.stderr), /REFUSED/);
      assert.match(String(e.stderr), /NOTHING was written/);
      return true;
    },
  );
  assert.deepEqual(await readdir(out), [], "the export wrote files despite refusing");
});

test("a published artifact IS the page, exactly as the server decides it", async () => {
  /*
   * PRECEDENCE, and the omission nobody noticed. `/leaf/<id>` is reached by two different acts of
   * consent — `publish.mjs` crossing a whole reviewed document into a frozen artifact, and
   * `share --as` offering one leaflet through the live projection — and `server.mjs` states the
   * rule: "A published artifact, when one exists, IS the page."
   *
   * The exporter rendered the PROJECTION unconditionally, so for anybody who had actually
   * published, the folder carried a different page than the server serves at the same address,
   * while the file's header claimed it renders through the server's own functions. Its header
   * named one deliberate omission; this was a second, larger one.
   */
  const src = await temp("canopy-export-pub-");
  await writeFile(join(src, "a.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "c", company: "C", leaves: ["a.leaf.json"] }),
    "utf8",
  );

  // A REAL artifact at the address the loader reads, in the shape the parser accepts.
  const published = await temp("canopy-export-pub-store-");
  await writeFile(
    join(published, "example-leaf-not-real.published.json"),
    JSON.stringify({
      artifact: PUBLISHED_ARTIFACT,
      artifactVersion: PUBLISHED_ARTIFACT_VERSION,
      publishedAt: "2026-08-13T09:41:00Z",
      source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 4096, policyDigest: `sha256:${"b".repeat(64)}` },
      leaf: { id: "example-leaf-not-real", subject: "Frozen Subject", subjectRedacted: false, leaflets: [] },
      withheld: { count: 0, kinds: [] },
    }),
    "utf8",
  );

  const out = await temp("canopy-export-pub-out-");
  await exec(process.execPath, [EXPORT, "--out", out], {
    env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), FOLIAGE_PUBLISHED: published },
    timeout: 120_000,
  });

  const html = await readFile(join(out, "leaf", "example-leaf-not-real.html"), "utf8");
  assert.match(
    html,
    /data-published-empty="true"|Frozen Subject/,
    "the exported page is the live projection, not the frozen artifact the subject published",
  );
  assert.doesNotMatch(
    html,
    /data-public-state=/,
    "the projection's own state hook is on the page, so the artifact lost to it",
  );
  const path = join(published, "example-leaf-not-real.published.json");
  const mediaContract = JSON.parse(await readFile(path, "utf8"));
  mediaContract.artifactVersion = 6;
  mediaContract.leaf.leaflets = [{ id: "export-refusal-contract", title: "Unsupported static image contract", tier: "pending", titleRedacted: false,
    photos: [{ sourceRef: mediaContract.source.documentDigest, renditionDigest: mediaContract.source.policyDigest, bytes: 1, format: "png", alt: "Contract requiring unavailable image bytes" }] }];
  await writeFile(path, JSON.stringify(mediaContract));
  const refused = await temp("canopy-export-photos-refused-");
  await assert.rejects(exec(process.execPath, [EXPORT, "--out", refused], {
    env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), FOLIAGE_PUBLISHED: published }, timeout: 120_000,
  }), (error: any) => /selected media require current hosted authority/.test(error.stderr));
});

test("static public search index follows artifact precedence and disappears after withdrawal", async () => {
  const src = await temp("canopy-search-src-");
  await writeFile(join(src, "a.leaf.json"), JSON.stringify({ id: "search-contract", subject: "Source subject",
    leaflets: [{ id: "private-input", title: "Private source wording", tier: "pending" }] }), "utf8");
  await writeFile(join(src, "tree.json"), JSON.stringify({ id: "search-tree", company: "Source company",
    leaves: ["a.leaf.json"] }), "utf8");
  const published = await temp("canopy-search-published-");
  const artifactPath = join(published, "search-contract.published.json");
  await writeFile(artifactPath, JSON.stringify({ artifact: PUBLISHED_ARTIFACT, artifactVersion: 3,
    publishedAt: "2026-09-08T00:00:00Z",
    source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1,
      policyDigest: `sha256:${"b".repeat(64)}` },
    leaf: { id: "search-contract", subject: "Frozen publication", subjectRedacted: false,
      leaflets: [{ id: "offered", title: "Published pending contract", tier: "pending", titleRedacted: false }] },
    withheld: { count: 0, kinds: [] } }), "utf8");
  const out = await temp("canopy-search-export-");
  const env = { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), FOLIAGE_PUBLISHED: published };
  await exec(process.execPath, [EXPORT, "--out", out], { env, timeout: 120_000 });
  const html = await readFile(join(out, "leaf", "search-contract.html"), "utf8");
  const raw = await readFile(join(out, "leaf", "search-contract.search.json"), "utf8");
  const index = JSON.parse(raw);
  assert.match(html, /href="search-contract\.search\.json"/);
  assert.doesNotMatch(html, /href="[^"]*\/leaflet\//, "static export must not link to the server-only publication detail route");
  assert.equal(index.format, "foliage/public-search-index");
  assert.equal(index.portfolio, "search-contract.html");
  assert.deepEqual(index.records.map((record: { id: string }) => record.id), ["profile", "leaflet:offered"]);
  assert.match(raw, /Published pending contract/);
  assert.doesNotMatch(raw, /Private source wording|Source subject|score/);
  for (const record of index.records as { citation: string }[]) {
    const anchor = new URL(record.citation, "https://folio.invalid/leaf/").hash.slice(1);
    assert.match(html, new RegExp(`id="${anchor}"`));
  }

  await rm(artifactPath);
  const after = await temp("canopy-search-withdrawn-");
  await exec(process.execPath, [EXPORT, "--out", after], { env, timeout: 120_000 });
  assert.equal((await readdir(join(after, "leaf"))).includes("search-contract.search.json"), false);
  assert.doesNotMatch(await readFile(join(after, "leaf", "search-contract.html"), "utf8"), /Frozen publication/);
});

test("example pages have no machine-readable public search index", async () => {
  const { out } = await exportOnce();
  assert.equal((await readdir(join(out, "leaf"))).some(name => name.endsWith(".search.json")), false);
});

test("a published artifact that will not load refuses the export rather than downgrading it", async () => {
  /*
   * The server refuses a broken artifact with its cause and explicitly never falls through,
   * "because tampering with an artifact must not quietly downgrade a person's page to a different
   * mechanism's rendering". A static folder cannot serve that refusal, so the only honest move
   * left to it is to decline to write the weaker page.
   */
  const src = await temp("canopy-export-broken-");
  await writeFile(join(src, "a.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "c", company: "C", leaves: ["a.leaf.json"] }),
    "utf8",
  );
  const published = await temp("canopy-export-broken-store-");
  await writeFile(join(published, "example-leaf-not-real.published.json"), '{"artifact": "trunc', "utf8");

  const out = await temp("canopy-export-broken-out-");
  await assert.rejects(
    exec(process.execPath, [EXPORT, "--out", out], {
      env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), FOLIAGE_PUBLISHED: published },
      timeout: 120_000,
    }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 3);
      assert.match(String(e.stderr), /REFUSED/);
      assert.match(String(e.stderr), /malformed/);
      return true;
    },
  );
  assert.deepEqual(await readdir(out), [], "the export wrote files despite refusing");
});

test("what a stylesheet asks for is carried too, and the guard reads stylesheets to know", async () => {
  /*
   * THE THIRD TIME THE CLOSURE REPORT SAID EVERY LINK RESOLVED WHILE ONE DID NOT, and each time
   * because the check looked at less than a browser does. First it ignored the page's directory,
   * so person pages were unstyled. Then it ignored `/leaflet/<id>`, so a published leaflet's link
   * dangled. Now: it crawled `href`/`src` in the HTML only, and a page asks for files it never
   * names — `published.css` masks `.pub-mark` with `url("/mark-primary.svg")`, and
   * `renderPublished.ts` renders that span in the header of every published-artifact page.
   *
   * So this asserts the property from the browser's side: every `url()` in every copied stylesheet
   * resolves to a file in the folder, resolved relative to the STYLESHEET rather than to the page
   * that linked it, which is how CSS reads them.
   */
  const { out } = await exportOnce();
  const files = new Set(
    (await readdir(out, { recursive: true })).map((n) => String(n).replace(/\\/g, "/")),
  );
  const sheets = [...files].filter((f) => f.endsWith(".css"));
  assert.ok(sheets.length > 0, "no stylesheet was exported at all, which cannot be right");

  let checked = 0;
  for (const sheet of sheets) {
    const css = await readFile(join(out, sheet), "utf8");
    const dir = sheet.includes("/") ? `${sheet.slice(0, sheet.lastIndexOf("/"))}/` : "";
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const ref = m[1] as string;
      if (/^(?:https?:|data:)/.test(ref)) continue;
      checked += 1;
      const target = (
        ref.startsWith("/") ? ref.slice(1) : normalize(`${dir}${ref}`).replace(/\\/g, "/")
      ).split("?")[0] as string;
      assert.ok(
        files.has(target),
        `${sheet} asks for "${ref}" and this export does not carry it — a stylesheet reference is ` +
          `invisible to any check that only reads the HTML`,
      );
    }
  }
  assert.ok(checked > 0, "no stylesheet url() was examined, so this test proved nothing");
});

test("a withdrawal cannot survive a redeploy — a non-empty destination is refused", async () => {
  /*
   * THE CONSENT HOLE. This exporter writes a WHOLE canopy and removes nothing, so re-running it
   * into a folder that already holds an earlier run leaves behind any page this run would not
   * write: a person removed from the tree, an artifact withdrawn, a leaflet unshared. The operator
   * re-uploads and the withdrawn page is still live — which `publishedLeaf.ts` names as the worst
   * failure this seam has, "an unpublish that did not unpublish".
   *
   * The server cannot make that mistake, because it re-reads on every request under
   * `cache-control: no-store`. A folder has no such property, so the exporter supplies it — by
   * refusing rather than by deleting files it did not write. On a canopy the leftover is somebody
   * ELSE's withdrawal ignored, for as long as the folder is hosted.
   */
  const { out } = await exportOnce();
  assert.ok((await readdir(out)).length > 0, "the first export wrote nothing, so this proves nothing");

  const src = await temp("canopy-export-again-");
  await writeFile(join(src, "a.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "c", company: "C", leaves: ["a.leaf.json"] }),
    "utf8",
  );

  const before = (await readdir(out, { recursive: true })).length;
  await assert.rejects(
    exec(process.execPath, [EXPORT, "--out", out], {
      env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json") },
      timeout: 120_000,
    }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 3, "a second export into a used folder must refuse");
      assert.match(String(e.stderr), /is not empty/);
      assert.match(String(e.stderr), /NOTHING was written/);
      return true;
    },
  );
  assert.equal(
    (await readdir(out, { recursive: true })).length,
    before,
    "the refused run still touched the folder",
  );
});

test("nothing in the folder is root-absolute, so it survives a subdirectory", async () => {
  /*
   * THE FOURTH INSTANCE OF ONE CLASS, and the reason this asserts a PROPERTY of the whole folder
   * rather than another list of filenames.
   *
   * `staticise` only ever touched HTML, so `published.css` shipped `url("/mark-primary.svg")`
   * verbatim — root-absolute, correct only at a domain root, and this file's header promises the
   * folder "works in a subdirectory". The closure guard could not see it because it RESOLVED a
   * leading `/` against the folder root instead of treating it as the portability defect it is:
   * the file is at the root, so the reference looked closed while being wrong for any host that
   * serves the folder at a path prefix.
   *
   * The three earlier instances were the same shape — a check that looked at less than a browser
   * does — so this one asserts across every emitted file, HTML and CSS alike, and fails if it
   * examined nothing.
   */
  const { out } = await exportOnce();
  const files = (await readdir(out, { recursive: true }))
    .map((n) => String(n).replace(/\\/g, "/"))
    .filter((n) => n.endsWith(".html") || n.endsWith(".css"));
  assert.ok(files.length > 0, "no page or stylesheet was exported, so this proved nothing");

  for (const rel of files) {
    const text = await readFile(join(out, rel), "utf8");
    const absolute = [
      ...[...text.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1] as string),
      ...[...text.matchAll(/url\(\s*["']?(\/[^"')]+)["']?\s*\)/g)].map((m) => m[1] as string),
    ];
    assert.deepEqual(
      absolute,
      [],
      `${rel} carries root-absolute reference(s) ${absolute.join(", ")} — correct only when this ` +
        `folder is hosted at a domain root, and this exporter promises it works in a subdirectory`,
    );
  }
});

test("one person with a non-canonical id does not abort everybody else's export", async () => {
  /*
   * BLAST RADIUS, which the precedence rule got right and the FAILURE HANDLING got wrong.
   *
   * `PublishedLoadCause` has seven members graded three ways: `unpublishable-id` is 400,
   * `absent` is 404, and the tampering family is 500. The first version split them
   * `absent || unconfigured` versus everything-else-refuses, so `unpublishable-id` — which means
   * the id cannot match `PUBLISHED_ID`'s grammar and therefore NO FILE IS EVER READ — landed in
   * the arm that aborts the whole canopy.
   *
   * This file's own `SAFE_NAME` is deliberately broader than `PUBLISHED_ID` (uppercase, dots,
   * underscores), so an id like `Rey.Ortiz` passes the filename gate and fails the artifact
   * grammar. One such person in a tree of fifty stopped all fifty pages from being written,
   * permanently, over somebody who had never published. The server serves one 400 at that address
   * and keeps every other route working.
   */
  const src = await temp("canopy-export-noncanon-");
  const doc = JSON.parse(await readFile(EXAMPLE, "utf8")) as { id: string };
  doc.id = "Rey.Ortiz";
  await writeFile(join(src, "a.leaf.json"), JSON.stringify(doc), "utf8");
  await writeFile(join(src, "b.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "c", company: "C", leaves: ["a.leaf.json", "b.leaf.json"] }),
    "utf8",
  );
  const store = await temp("canopy-export-noncanon-store-");

  const out = await temp("canopy-export-noncanon-out-");
  const { stdout } = await exec(process.execPath, [EXPORT, "--out", out], {
    env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), FOLIAGE_PUBLISHED: store },
    timeout: 120_000,
  });

  const files = (await readdir(out, { recursive: true })).map((n) => String(n).replace(/\\/g, "/"));
  assert.ok(files.includes("leaf/Rey.Ortiz.html"), "the non-canonical id lost its own page");
  assert.ok(
    files.includes("leaf/example-leaf-not-real.html"),
    "one person's non-canonical id stopped everybody else's page from being written",
  );
  assert.doesNotMatch(stdout, /REFUSED/);
});

/*
 * THE CONFIGURATION AND THE SERVER MUST AGREE — F-038.
 *
 * A served folder has no response logic, so every security header the server sends is lost the
 * moment the canopy becomes bytes. MEASURED before the fix: this export behind a plain static host
 * sent none of them, while the server sent all four for the same page. Hosting it that way undoes
 * F-033 (the canopy becomes crawlable while discovery is still the gated decision C12/H7) and drops
 * `frame-ancestors 'none'`, which does not inherit from `default-src`.
 *
 * THE ASSERTION IS "THE TWO AGREE", AND THAT IS THE WHOLE POINT. This test hard-codes no header
 * names and no policy strings. It boots the real server, reads what it really sends over HTTP, and
 * demands the emitted `vercel.json` carry each one with a byte-identical value. A second list of
 * security headers written into a test would rot exactly like the copies F-035 and F-037 record —
 * and a rotted copy of THIS list ships a canopy with no policy at all. Adding a header to
 * `publicHeaders()` therefore needs no edit here; REMOVING one from the config breaks this.
 */
test("the exported folder carries the headers the server would have sent — F-038", async () => {
  const src = await temp("canopy-hdr-src-");
  await writeFile(join(src, "a.leaf.json"), await readFile(EXAMPLE, "utf8"), "utf8");
  await writeFile(
    join(src, "tree.json"),
    JSON.stringify({ id: "hdr-co", company: "Header Company", leaves: ["a.leaf.json"] }),
    "utf8",
  );

  // An ephemeral port from the OS: ports 4173-4199 hold long-running demo servers on this machine,
  // and a hard-coded port is how a test starts measuring somebody else's process.
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((ok) => probe.close(() => ok()));

  const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json"), PORT: String(port), HOST: "127.0.0.1" },
    stdio: "ignore",
  });

  try {
    let res: Response | null = null;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && res === null) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        res = await fetch(`http://127.0.0.1:${port}/tree`, { signal: AbortSignal.timeout(2000) });
      } catch {
        /* not up yet */
      }
    }
    assert.ok(res, "the canopy server did not answer — this test measures a real response or nothing");
    assert.equal(res.status, 200);

    const out = await temp("canopy-hdr-out-");
    await exec(process.execPath, [EXPORT, "--out", out], {
      env: { ...process.env, FOLIAGE_TREE: join(src, "tree.json") },
      timeout: 120_000,
    });
    const config = JSON.parse(await readFile(join(out, "vercel.json"), "utf8"));

    // One rule covering every file: a folder has no routes, so a per-path rule would be a
    // second router to keep in step with the first.
    assert.equal(config.headers.length, 1);
    assert.equal(config.headers[0].source, "/(.*)");
    const declared = new Map<string, string>(
      config.headers[0].headers.map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]),
    );

    // Read the names off the RESPONSE, so the test learns them rather than restating them.
    const security = [...res.headers.keys()].filter(
      (k) => k.startsWith("x-") || k === "content-security-policy" || k === "referrer-policy",
    );
    assert.ok(security.length >= 4, `expected the server to send security headers, saw ${security.join(", ")}`);

    for (const name of security) {
      assert.ok(declared.has(name), `the server sends ${name} and the exported vercel.json does not declare it`);
      assert.equal(
        declared.get(name),
        res.headers.get(name),
        `${name} differs between the server and the exported configuration`,
      );
    }

    // The directive that does not inherit, named explicitly because losing it is silent.
    assert.match(declared.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  } finally {
    child.kill();
  }
});
