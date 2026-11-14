#!/usr/bin/env node
/**
 * Export a CANOPY as a folder of static files somebody else can host.
 *
 * WHY THIS EXISTS, and why it is not a deployment. `apps/leaf/export.mjs` already does this for one
 * person's leaf, for the reason recorded there: everything this product serves binds to 127.0.0.1,
 * so closing the gap between "it works on my machine" and "somebody can read it" needs a file
 * writer rather than a hosting plane. The canopy has the same shape and never had the same tool.
 *
 *   node apps/canopy/export.mjs --out <dir>
 *
 * MEASURED BEFORE THIS EXISTED (readiness study, 2026-09-04): a prerendered canopy is BYTE-IDENTICAL
 * to the served canopy apart from one `<time>…read…</time>` element — `/` came out identical at
 * 37,448 bytes. The reader content remains server-rendered. The optional
 * compound Leaf renderer enhances only those admitted bytes and is copied with its local assets.
 *
 * IT RENDERS THROUGH THE SERVER'S OWN FUNCTIONS — `renderCanopyPage`, `renderTreePage`,
 * `renderPublicLeafPage`. A second renderer that "just writes the HTML" is how a copy drifts from
 * the thing it copies, and this repository has already paid for that twice (a stale sprite, a stale
 * stylesheet). There is one renderer.
 *
 * WHAT IT CHANGES, and it is exactly these, because a folder has no router and may be hosted at a
 * path prefix rather than a domain root:
 *   - absolute asset paths become relative, so the folder works in a subdirectory;
 *   - `/leaf/<id>` links become `leaf/<id>.html`, `/tree` becomes `tree.html`, `/` becomes
 *     `index.html`.
 *   - stylesheets are REWRITTEN, not copied: a `url("/x")` becomes `url("x")`. Every sheet sits at
 *     the export root, so a root-absolute reference to a root-level asset is exactly the bare name
 *     — and the absolute form is the one that breaks in a subdirectory.
 * It also injects the mark sprite, which is not a rewrite but a thing the SERVER does at request
 * time — see `withSprite`; without it the folder renders with no marks at all.
 * Nothing else is rewritten. In particular NO PATH REDACTION HAPPENS HERE, unlike the leaf
 * exporter: F-031 fixed that at the renderer, so the served page and the exported page already
 * agree. If a rewrite is ever needed here that the server does not do, that is a defect in the
 * server, not a job for this file.
 *
 * WHAT IT DOES NOT WRITE, said plainly rather than discovered later:
 *   - `/leaflet/<id>` pages. A published leaflet's id is `git:<sha>`, and whether a static host
 *     serves a filename containing a colon — and whether it decodes `%3A` before matching — is an
 *     OPEN UNKNOWN (`docs/DEPLOYMENT.md` §7) that wants one throwaway preview to settle. Nothing is
 *     lost today: a leaflet page exists only for work its subject marked `public`, and on the real
 *     documents measured so far that set is empty.
 *   - anything at all if a leaf id would not be a safe filename, if a published artifact will not
 *     load, or if the destination is not empty. It refuses and names them.
 *
 * IT HONOURS THE PUBLISHED-ARTIFACT PRECEDENCE at `/leaf/<id>`, the same rule server.mjs applies:
 * a frozen artifact IS the page when one exists, and only its absence reaches the live projection.
 *
 * IT IS NOT A DEPLOYMENT AND MAKES NO NETWORK CALL. It writes a folder. Who hosts that folder, and
 * whether the canopy should be hosted at all, are decisions recorded in `docs/DEPLOYMENT.md` — this
 * file takes none of them.
 */
import { mkdir, writeFile, copyFile, readFile, readdir } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "../leaf/src/nodeFloor.mjs";
requireNodeFloor();

const { renderCanopyPage, renderIndividualsPage, renderOrganizationsPage } = await import("./src/renderCanopy.ts");
const { renderTreePage } = await import("./src/renderTree.ts");
const { renderPublicLeafPage, resolvePublicLeaf } = await import("./src/renderPublic.ts");
const { loadTreeDocument } = await import("./src/treeDocument.ts");
const { inlineSprite, readSprite } = await import("./src/sprite.mjs");
const { publicHeaders } = await import("./src/publicHeaders.mjs");
const { loadPublishedLeaf } = await import("./src/publishedLeaf.ts");
const { projectPublishedSearchRecords, projectLiveSearchRecords } = await import("@foliage/canopy");
const { renderPublishedPage, hasPortfolioEnhancement } = await import("./src/renderPublished.ts");
const { renderDemoPage } = await import("./src/renderDemo.ts");
const { checkPortfolioLeafBundle } = await import("@foliage/ui/portfolio-leaf-bundle");

const USAGE = `Export a canopy as a folder of static files somebody else can host.

  node apps/canopy/export.mjs --out <dir>

Reads the tree FOLIAGE_TREE names. Writes index.html, tree.html and one page per person.
Makes no network call and deploys nothing.
`;

const { values } = parseArgs({
  options: { out: { type: "string" }, help: { type: "boolean" } },
  allowPositionals: false,
});

if (values.help === true || values.out === undefined || values.out.trim() === "") {
  process.stdout.write(USAGE);
  process.exit(values.help === true ? 0 : 2);
}

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Exactly the files these pages ask for. An allow-list, not a directory copy. */
const ASSETS = [
  ["foliage-tokens.css", fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"))],
  ["roles.css", fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css"))],
  ["foliage.css", fileURLToPath(import.meta.resolve("@foliage/tokens/foliage.css"))],
  ["tree.css", join(APP_DIR, "public", "tree.css")],
  // The published-artifact page has its own stylesheet, and the closure guard is how that was
  // found: the first draft copied only tree.css and refused its own export the moment a real
  // artifact was rendered. A missing stylesheet is an unstyled page, not a warning.
  ["published.css", join(APP_DIR, "public", "published.css")],
  ["portfolio.css", join(APP_DIR, "public", "portfolio.css")],
  ["portfolio-leaf.css", fileURLToPath(import.meta.resolve("@foliage/ui/portfolio-leaf.css"))],
  ["controls.css", fileURLToPath(import.meta.resolve("@foliage/ui/controls.css"))],
  ["specimen-sheet-day.jpg", join(APP_DIR, "public", "specimen-sheet-day.jpg")],
  // Referenced from CSS, not from any page: `published.css` masks `.pub-mark` with it, and the
  // published-artifact header renders that span unconditionally. The closure guard could not see
  // it until the guard learned to read stylesheets — see below.
  ["mark-primary.svg", fileURLToPath(import.meta.resolve("@foliage/tokens/mark-primary.svg"))],
  ["mark-expressive.svg", fileURLToPath(import.meta.resolve("@foliage/tokens/mark-expressive.svg"))],
  ["mark-icon.svg", fileURLToPath(import.meta.resolve("@foliage/tokens/mark-icon.svg"))],
  ["fonts/fraunces-var.woff2", fileURLToPath(import.meta.resolve("@foliage/tokens/fonts/fraunces-var.woff2"))],
  ["fonts/instrument-sans-var.woff2", fileURLToPath(import.meta.resolve("@foliage/tokens/fonts/instrument-sans-var.woff2"))],
  ["fonts/jbmono-400.woff2", fileURLToPath(import.meta.resolve("@foliage/tokens/fonts/jbmono-400.woff2"))],
  ["fonts/jbmono-500.woff2", fileURLToPath(import.meta.resolve("@foliage/tokens/fonts/jbmono-500.woff2"))],
];

/**
 * A leaf id that is safe as a filename on any host, checked rather than assumed.
 *
 * Leaf ids are slugs today (`rowan-vale`), but "today" is not a guarantee and the id travels from a
 * document somebody else wrote. A colon, a slash or a percent in a filename is the open question
 * this exporter declines to answer — so it refuses the whole export and names the offenders rather
 * than writing a folder with one silently missing page.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const load = await loadTreeDocument();
if (!load.ok) {
  process.stderr.write(`export: no canopy to export — ${load.cause}: ${load.detail}\n`);
  process.exit(1);
}

const unsafe = load.tree.leaves.map((l) => l.id).filter((id) => !SAFE_NAME.test(id));
if (unsafe.length > 0) {
  process.stderr.write(
    `export: REFUSED — ${unsafe.length} leaf id(s) cannot be a filename on a static host, and a\n` +
      `export:   folder missing one person's page is worse than no folder.\n` +
      `export: NOTHING was written.\n`,
  );
  for (const id of unsafe) process.stderr.write(`export:   ${id}\n`);
  process.exit(3);
}

const out = resolve(values.out);

/*
 * A NON-EMPTY DESTINATION IS REFUSED, because this exporter writes a WHOLE canopy and cannot
 * unwrite what somebody else left there.
 *
 * The failure it prevents is an unpublish that does not unpublish, which `publishedLeaf.ts` calls
 * the worst failure this seam has. Concretely: a person's artifact is published, exported to
 * `./site` and uploaded; the person withdraws it; the operator re-exports into the SAME `./site`
 * and re-uploads — and `leaf/<id>.html` is still there, because nothing removed it. The server
 * cannot make that mistake: it re-reads on every request under `cache-control: no-store`. A folder
 * has no such property, so the exporter has to supply it, and the honest way is to refuse rather
 * than to delete files it did not write.
 *
 * On a canopy the stakes are not one person's own folder: this writes many people's
 * consent-gated pages into one shared directory, so a leftover is somebody ELSE's withdrawal
 * silently ignored, for as long as the folder is hosted.
 */
const existing = await readdir(out).catch((err) => {
  // ENOENT is the ordinary case: the directory does not exist yet, and mkdir will make it.
  // Anything else — most usefully ENOTDIR, `--out` naming a regular file — is refused in this
  // file's own shape rather than crashing later with a raw stack and an exit code a deploy script
  // cannot tell apart from any other failure.
  if (err.code === "ENOENT") return [];
  process.stderr.write(
    `export: REFUSED — ${out} cannot be read as a directory (${err.code}).\n` +
      `export: NOTHING was written.\n`,
  );
  process.exit(3);
});
if (existing.length > 0) {
  process.stderr.write(
    `export: REFUSED — ${out} is not empty (${existing.length} entr${existing.length === 1 ? "y" : "ies"}),\n` +
      `export:   and this writes a whole canopy rather than patching one. Anything already there\n` +
      `export:   that this run would not write — a person removed from the tree, an artifact\n` +
      `export:   withdrawn, a leaflet unshared — would survive the redeploy meant to reflect it.\n` +
      `export: NOTHING was written.\n` +
      `export: empty it, or name a directory that does not exist yet.\n`,
  );
  process.exit(3);
}

/*
 * THE REWRITES, and only these. Each exists because a folder has no router:
 *   - asset paths become relative TO THE PAGE'S OWN DEPTH;
 *   - `/leaf/<id>` becomes `leaf/<id>.html`, `/tree` becomes `tree.html`, `/` becomes
 *     `index.html` — and those too are written relative to the page.
 *
 * `up` IS THE FIX FOR A DEFECT THAT SHIPPED PAST ITS OWN CLOSURE CHECK. The first draft rewrote
 * every asset to a BARE name, which is correct at the root and wrong in `leaf/`: a person's page
 * asked for `foliage-tokens.css` while the file sat one directory above it, so EVERY PERSON PAGE —
 * the actual deliverable of a canopy — rendered completely unstyled. Reproduced by serving the
 * folder: `GET /leaf/foliage-tokens.css` 404, `GET /foliage-tokens.css` 200. The closure report
 * missed it because it compared bare filenames and never asked WHERE the referencing page lived,
 * so it printed "every link resolves" about a folder in which none of them did. Same failure class
 * as the sprite — looks complete, is missing something visible — caught one layer down.
 */
const staticise = (html, up) =>
  html
    .replace(/(href|src)="\/(foliage-tokens\.css|roles\.css|foliage\.css|controls\.css|tree\.css|published\.css|portfolio\.css|portfolio-leaf\.(?:css|bundle\.js)|specimen-sheet-day\.jpg)"/g, `$1="${up}$2"`)
    .replace(/href="\/leaf\/([^"]+)"/g, (_m, id) => `href="${up}leaf/${decodeURIComponent(id)}.html"`)
    .replace(/href="\/(individuals|organizations|demo)"/g, `href="${up}$1.html"`)
    .replace(/href="\/tree"/g, `href="${up}tree.html"`)
    .replace(/href="\/"/g, `href="${up}index.html"`);

/**
 * The sprite, injected exactly as the server injects it. Without this every `<use href="#fol-…">`
 * on every exported page resolves to nothing and the folder renders with no marks — measured on
 * this file's own first draft. `src/sprite.mjs` exists so there is one injector rather than two.
 */
/** The one stylesheet rewrite, used by both the writer and the guard so they cannot disagree. */
const cssForExport = (css) => css.replace(/url\(\s*(["']?)\/([^"')]+)\1\s*\)/g, 'url($1$2$1)');

const SPRITE = await readSprite();
const withSprite = (html, what) => {
  const { html: out, injected } = inlineSprite(SPRITE, html);
  if (!injected) {
    process.stderr.write(`export: FAILED — ${what} has no <body> to inline the mark sprite after\n`);
    process.exit(1);
  }
  return out;
};

/* Built in memory first, so a folder is written only once it is known to be whole. */
const pages = [
  ["index.html", withSprite(staticise(renderCanopyPage(load), ""), "index.html")],
  ["individuals.html", withSprite(staticise(renderIndividualsPage(), ""), "individuals.html")],
  ["organizations.html", withSprite(staticise(renderOrganizationsPage(), ""), "organizations.html")],
  ["demo.html", withSprite(staticise(renderDemoPage({work: "", staticExport: true}), ""), "demo.html")],
  ["tree.html", withSprite(staticise(renderTreePage(load), ""), "tree.html")],
];
/*
 * PRECEDENCE AT `/leaf/<id>` — the same rule `server.mjs` applies, because the same address is
 * reached by two different acts of consent and they are not interchangeable. `publish.mjs` crosses
 * a WHOLE reviewed document into a frozen artifact; `share --as` offers ONE leaflet through the
 * tree's live projection. The server's own words: "A published artifact, when one exists, IS the
 * page — the strongest thing the person deliberately crossed."
 *
 * THE FIRST DRAFT RENDERED THE PROJECTION UNCONDITIONALLY, so for anybody who had actually run
 * `publish.mjs` this exporter wrote a DIFFERENT page than the server serves at the same address —
 * while its own header claimed it renders through the server's functions. The header listed one
 * deliberate omission (`/leaflet/<id>`) and this was a second, larger one nobody had noticed.
 *
 * A BROKEN artifact is not exported at all. The server refuses it with its cause and explicitly
 * never falls through, "because tampering with an artifact must not quietly downgrade a person's
 * page to a different mechanism's rendering" — a static folder cannot serve a 500, so the honest
 * move is to refuse the whole export rather than silently write the projection in its place.
 */
/*
 * "NO ARTIFACT CAN EXIST" IS NOT "AN ARTIFACT IS BROKEN", and the first version collapsed them.
 *
 * `PublishedLoadCause` has seven members and the domain grades them three ways
 * (`httpStatusForPublished`): `unconfigured` 503, `unpublishable-id` 400, `absent` 404, and the
 * tampering family — `unreadable`, `malformed`, `invalid`, `misfiled` — 500. The split here was
 * `absent || unconfigured`, so `unpublishable-id` fell into the refuse-everything arm.
 *
 * `unpublishable-id` means the leaf's id cannot match `PUBLISHED_ID`'s grammar, so NO FILE IS EVER
 * READ: an artifact could not exist for that id. That is semantically the absent case. And this
 * file's own `SAFE_NAME` is deliberately broader than `PUBLISHED_ID` — it allows uppercase, dots
 * and underscores — so an id like `Rey.Ortiz` passes the filename gate here and fails the artifact
 * grammar there. One such person in a tree of fifty aborted the export for all fifty, permanently,
 * over a person who had never published anything. The server degrades far more gracefully: one 400
 * page at that one address while every other route keeps serving.
 *
 * The tampering family still refuses the whole export, and for the reason server.mjs gives: it
 * never falls through, "because tampering with an artifact must not quietly downgrade a person's
 * page to a different mechanism's rendering", and a static folder cannot serve that refusal.
 */
const NO_ARTIFACT_POSSIBLE = new Set(["absent", "unconfigured", "unpublishable-id"]);

const broken = [];
const portfolioBundle = await checkPortfolioLeafBundle();
const enhancedPages = [];
const searchIndexes = [];
const indexable = !load.manifest.example && load.leafSources.every(source => !source.declaredExample);
for (const leaf of load.tree.leaves) {
  const artifact = await loadPublishedLeaf(leaf.id);
  const absent = !artifact.ok && NO_ARTIFACT_POSSIBLE.has(artifact.cause);
  if (!artifact.ok && !absent) {
    broken.push(`${leaf.id} — ${artifact.cause}`);
    continue;
  }
  if (artifact.ok && artifact.document.leaf.leaflets.some(item => item.photos?.length || item.videos?.length)) {
    broken.push(`${leaf.id} — selected media require current hosted authority`);
    continue;
  }
  const view = artifact.ok ? null : resolvePublicLeaf(load, leaf.id);
  const html = artifact.ok
    ? renderPublishedPage(artifact, { enhancePortfolio: portfolioBundle.ok, linkToDetail: false })
    : renderPublicLeafPage(view);
  const records = !indexable ? [] : artifact.ok
    ? projectPublishedSearchRecords(artifact.document, `${leaf.id}.html`)
    : view?.kind === "person" ? projectLiveSearchRecords(view.person, `${leaf.id}.html`) : [];
  if (records.length) searchIndexes.push([`leaf/${leaf.id}.search.json`, `${JSON.stringify({
    format: "foliage/public-search-index", version: 1, portfolio: `${leaf.id}.html`, records,
  })}\n`]);
  if (hasPortfolioEnhancement(html)) enhancedPages.push(`/leaf/${leaf.id}.html`);
  const page = withSprite(staticise(html, "../"), leaf.id);
  pages.push([`leaf/${leaf.id}.html`, records.length
    ? page.replace("</head>", `<link rel="alternate" type="application/json" title="Foliage public search index" href="${leaf.id}.search.json"></head>`)
    : page]);
}
if (enhancedPages.length && portfolioBundle.ok) ASSETS.push(["portfolio-leaf.bundle.js", portfolioBundle.path]);

if (broken.length > 0) {
  process.stderr.write(
    `export: REFUSED — ${broken.length} published artifact(s) will not load, and the server\n` +
      `export:   refuses these rather than falling back to the tree projection. A static folder\n` +
      `export:   cannot serve that refusal, so it declines to write the weaker page instead.\n` +
      `export: NOTHING was written to ${out}.\n`,
  );
  for (const b of broken) process.stderr.write(`export:   ${b}\n`);
  process.exit(3);
}

/*
 * CLOSURE, RESOLVED FROM EACH PAGE'S OWN DIRECTORY, and a REFUSAL rather than a warning.
 *
 * The first draft printed `WARNING unresolved: …` and exited 0. That is the opposite of what this
 * file does everywhere else: an unsafe leaf id refuses the whole export because a folder missing
 * one person's page LOOKS COMPLETE. A folder whose links dangle looks complete too, and a deploy
 * script wired as `export --out <dir> && upload <dir>` reads the exit code, not the stdout.
 *
 * The link this actually catches in practice is `/leaflet/<id>?leaf=<leafId>`, which a person's
 * page renders as soon as they have marked any leaflet `public` — a normal document state, and the
 * whole point of a canopy. This exporter deliberately writes no leaflet pages (see the header), so
 * for such a tree the honest answer is to refuse and say why, not to ship a page with a dead link
 * to the artifact somebody chose to publish.
 */
const written = new Set([...pages.map(([rel]) => rel), ...searchIndexes.map(([rel]) => rel), ...ASSETS.map(([rel]) => rel)]);
const dangling = [];

/*
 * A ROOT-ABSOLUTE REFERENCE IS A DEFECT HERE, NOT AN ADDRESS TO RESOLVE — and treating it as one
 * is how this guard missed the fourth instance of the same class.
 *
 * The earlier version answered `ref.slice(1)` for anything starting with `/`, i.e. "resolve it
 * against the folder root", so `url("/mark-primary.svg")` looked closed: the file IS at the root.
 * But this file's header promises the folder "works in a subdirectory", and a root-absolute
 * reference is exactly the thing that stops being true the moment somebody hosts it at
 * `user.github.io/repo/`. The guard reported every link resolving while shipping a page whose mark
 * only appears at a domain root.
 *
 * So `/` returns null and the caller records it. After `staticise` and the stylesheet rewrite,
 * NOTHING in this folder should be root-absolute; one that survives means a rewrite missed it,
 * which is precisely what the guard is for.
 */
const resolveRef = (fromRel, ref) => {
  if (ref.startsWith("/")) return null;
  const dir = fromRel.includes("/") ? `${fromRel.slice(0, fromRel.lastIndexOf("/"))}/` : "";
  return normalize(`${dir}${ref}`).replace(/\\/g, "/");
};

for (const [rel, html] of pages) {
  for (const [, href] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    if (/^(?:https?:|mailto:|data:)/.test(href)) continue;
    const target = resolveRef(rel, href);
    if (target === null) dangling.push(`${rel} → ${href} (root-absolute: breaks in a subdirectory)`);
    else if (!written.has(target.split("?")[0])) dangling.push(`${rel} → ${href}`);
  }
}

/*
 * AND THE STYLESHEETS, because a page asks for files it never names.
 *
 * The guard crawled `href`/`src` in the HTML only, so it was STRUCTURALLY BLIND to anything a
 * copied stylesheet references. `published.css` masks `.pub-mark` with `url("/mark-primary.svg")`
 * and `renderPublished.ts` renders that span in the header of every published-artifact page, so
 * the mark was broken on exactly the pages this exporter had just learned to write — and the
 * report said every link resolved, for the third time in this file's short history, each time
 * because the check looked at less than the browser does.
 *
 * A stylesheet is read relative to ITSELF, not to the page that linked it, which is why this
 * resolves from the asset's own path.
 */
for (const [rel, src] of ASSETS) {
  if (!rel.endsWith(".css")) continue;
  // `src`, NOT a guess at where the file might be. The first version looked in
  // `apps/canopy/public/<basename>` and fell back to `src` only on ENOENT — so for the three
  // stylesheets that live in the tokens package it read the right bytes BY ACCIDENT, and a decoy
  // planted at `apps/canopy/public/roles.css` made the guard validate the decoy's `url()`s while
  // the copy step still shipped the real file. A second, weaker answer to "where does this asset
  // live" sitting beside the authoritative one this loop already had in hand.
  const text = cssForExport(await readFile(src, "utf8"));
  for (const [, ref] of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (/^(?:https?:|data:)/.test(ref)) continue;
    const target = resolveRef(rel, ref);
    if (target === null) dangling.push(`${rel} → ${ref} (root-absolute: breaks in a subdirectory)`);
    else if (!written.has(target.split("?")[0])) dangling.push(`${rel} → ${ref}`);
  }
}

if (dangling.length > 0) {
  process.stderr.write(
    `export: REFUSED — ${dangling.length} link(s) point at something this export does not write,\n` +
      `export:   and a folder whose links dangle looks exactly as complete as one whose links work.\n` +
      `export: NOTHING was written to ${out}.\n`,
  );
  for (const d of [...new Set(dangling)]) process.stderr.write(`export:   ${d}\n`);
  process.stderr.write(
    `export: a /leaflet/<id> link means somebody has marked a leaflet public. This exporter writes\n` +
      `export:   no leaflet pages — those ids are \`git:<sha>\` and whether a static host serves a\n` +
      `export:   colon is unsettled (docs/DEPLOYMENT.md §7). Settle it, or unshare the leaflet.\n`,
  );
  process.exit(3);
}

await mkdir(join(out, "fonts"), { recursive: true });
await mkdir(join(out, "leaf"), { recursive: true });

let bytes = 0;
for (const [rel, html] of pages) {
  await writeFile(join(out, rel), html, "utf8");
  bytes += Buffer.byteLength(html, "utf8");
}
for (const [rel, contents] of searchIndexes) {
  await writeFile(join(out, rel), contents, "utf8");
  bytes += Buffer.byteLength(contents, "utf8");
}

let copied = 0;
for (const [rel, src] of ASSETS) {
  try {
    if (rel.endsWith(".css")) {
      /*
       * STYLESHEETS ARE REWRITTEN, NOT COPIED. `staticise` only ever touched HTML, so
       * `published.css` shipped `url("/mark-primary.svg")` verbatim — root-absolute, and correct
       * only when the folder is hosted at a domain root, which contradicts this file's own promise
       * that it works in a subdirectory. Every stylesheet sits at the root of the export, so a
       * root-absolute reference to a root-level asset is exactly the bare name.
       */
      await writeFile(join(out, rel), cssForExport(await readFile(src, "utf8")), "utf8");
    } else {
      await copyFile(src, join(out, rel));
    }
    copied += 1;
  } catch (err) {
    process.stderr.write(`export: FAILED to copy ${rel} from ${src}: ${err.message}\n`);
    process.exit(1);
  }
}

/*
 * THE HEADERS, WRITTEN AS CONFIGURATION, BECAUSE A FOLDER CANNOT CARRY THEM ITSELF.
 *
 * F-038. A served folder has no response logic: MEASURED, this export behind a plain static host
 * sent NO content-security-policy, NO x-content-type-options, NO referrer-policy and NO
 * x-robots-tag, while `server.mjs` sent all four for the same page. Hosting it as-is undoes F-033
 * — the canopy becomes crawlable while whether a hosted leaf should be findable at all is still
 * the GATED owner decision C12/H7 — and drops `frame-ancestors 'none'`, the one directive that
 * does not inherit from `default-src` and the only thing stopping any origin framing a person's
 * page inside a page it controls.
 *
 * BUILT FROM `publicHeaders()`, NEVER RESPELLED. That function is the server's own source for the
 * same headers, so the configuration cannot say something different from what the server sends —
 * the F-035/F-037 failure is a rule written twice, and security headers written twice would be the
 * worst instance of it, because the copy nobody looks at is the one that ships.
 *
 * The strict default covers all files. Only named published pages carrying a checked local
 * portfolio bundle opt into self-hosted script; they retain the ban on network connections,
 * inline script, objects and forms. No mock page enters this export.
 *
 * SCOPE, HONESTLY. This is Vercel's schema, and it is the only host this repo has a stated target
 * for (docs/DEPLOYMENT.md). A host that ignores it serves the folder bare, which is why the
 * artifact also escapes all admitted text and has no inline handlers. Its optional renderer reads
 * the same admitted DOM. The configuration remains a second line of defence.
 */
const HEADERS = publicHeaders();
await writeFile(
  join(out, "vercel.json"),
  `${JSON.stringify(
    {
      /*
       * NO `$schema` KEY, and the boundary check is why. A first draft carried the vendor's public
       * schema URL for editor validation, and `pnpm check` refused it — "cloud plane names an
       * undeclared host" — then refused the comment explaining the removal too, because the scanner
       * reads source text and a hostname in a comment is still a hostname in the plane. The gate is
       * right even though nothing here ever fetches it: a reader cannot tell a schema hint from a
       * call, and the egress list IS the privacy claim. Declaring a host we never contact would buy
       * editor autocomplete at the cost of making that list mean less. The key is dropped instead.
       */
      // No framework and no build step: §2.1b established that a git-triggered build CANNOT work
      // here, because no tree manifest or leaf document may ever be committed. The host serves
      // these bytes; it does not make them.
      framework: null,
      buildCommand: null,
      outputDirectory: ".",
      headers: [
        {
          source: "/(.*)",
          headers: Object.entries(HEADERS).map(([key, value]) => ({ key, value })),
        },
        ...enhancedPages.map(source => ({ source, headers: Object.entries(publicHeaders({ portfolio: true })).map(([key, value]) => ({ key, value })) })),
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `export: wrote ${pages.length} page(s), ${searchIndexes.length} public search index(es), ${bytes} bytes, and ${copied} asset(s) to ${out}\n` +
    `export: ${load.tree.leaves.length} person page(s) for ${load.tree.company}\n` +
    `export: no /leaflet/<id> pages — see this file's header and docs/DEPLOYMENT.md §7\n` +
    `export: every link resolves to a file that was written, from the directory that references it\n` +
    `export: vercel.json carries ${Object.keys(HEADERS).length} header(s) — a static host sends none by itself,\n` +
    `export:   so a host that ignores this file serves the folder WITHOUT ${Object.keys(HEADERS).join(", ")}\n` +
    `export: open it with  open ${out}/index.html   — or host the folder as it is\n`,
);
