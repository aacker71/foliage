#!/usr/bin/env node
/**
 * Canopy static server.
 *
 * Serves static documents alongside shared renderer surfaces. Install the declared
 * dependencies first; the shared Leaf renderer uses server-side React controls.
 * Published documents remain script-free and serve their assets locally.
 *
 * Deliberately minimal: it serves files, sets a correct content type, and refuses to escape
 * the public directory. It is a dev and self-host server, not a CDN.
 *
 * FOUR DYNAMIC ROUTES, and together they are THE CANOPY CHAIN — what a recruiter actually walks:
 *
 *   GET /                the public front door — which tree(s) this install loads, and why
 *   GET /tree            a company, assembled from real leaf documents
 *   GET /leaf/<id>       one person's PUBLISHED work, linked from that roster
 *   GET /leaflet/<id>    one PUBLISHED artifact — the page somebody forwards to a board
 *
 * The last two render ONLY what `@foliage/canopy`'s public projection returns. Neither this file
 * nor `renderPublic.ts` reads `leaf.leaflets`, because `Tree.leaves` holds whole portfolios: the
 * private leaflets, the unproven ones and the ones that turned out to be somebody else's. The
 * projection applies the subject's visibility gate and the tier gate before anything reaches a
 * renderer, so publishing what nobody offered is not a mistake this server can make by omission.
 *
 * `GET /` USED TO FALL THROUGH TO THE STATIC FILE HANDLER AND 404, because `public/index.html`
 * never existed — every response still carried the security headers (`publicHeaders` runs for
 * every pathname), so the 404 was not a vulnerability, only a front door with nothing behind it.
 * It is matched here, before the static fallback, exactly like the other three.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publicHeaders } from "./src/publicHeaders.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See apps/leaf/src/nodeFloor.mjs,
// the same shared, dependency-free preflight apps/leaf/server.mjs already uses.
//
// STATIC ESM imports HOIST: they link before any of THIS module's own code runs, so a guard
// placed after a static `import ... from "./src/x.ts"` would never be reached on a Node below
// the floor — the crash happens during linking, before the guard's line is even evaluated. The
// three `.ts` imports this server used to declare statically are therefore dynamic `await
// import(...)` calls below, reached only once `requireNodeFloor()` has already returned — the
// exact mechanism apps/leaf/server.mjs uses, and the reason it works there.
//
// @ts-ignore TS6059 — apps/leaf/src/nodeFloor.mjs is outside this app's tsconfig rootDir; node
// resolves and runs this import correctly, only tsc's rootDir check objects to it. apps/canopy
// is the cloud plane depending on apps/leaf (open) — the direction open core intends.
const { requireNodeFloor } = await import("../leaf/src/nodeFloor.mjs");
requireNodeFloor();

const { httpStatusFor, loadTreeDocument } = await import("./src/treeDocument.ts");
const { PUBLIC_LEAFLET_ROUTE, renderTreePage } = await import("./src/renderTree.ts");
const { renderCanopyPage, renderIndividualsPage, renderOrganizationsPage } = await import("./src/renderCanopy.ts");
const { renderDemoPage } = await import("./src/renderDemo.ts");
const {
  publicLeafStatus,
  publicLeafletStatus,
  renderPublicLeafPage,
  renderPublicLeafletPage,
  resolvePublicLeaf,
  resolvePublicLeaflet,
} = await import("./src/renderPublic.ts");
// The published-leaf seam (publish.mjs -> FOLIAGE_PUBLISHED -> this route) rides the same
// post-floor dynamic-import rule as everything above.
const { PUBLISHED_ROUTE, httpStatusForPublished, loadPublishedLeaf } = await import("./src/publishedLeaf.ts");
const { renderPublishedPage, renderPublishedLeafletPage, renderPublishedLeafletNotFound, hasPortfolioEnhancement } = await import("./src/renderPublished.ts");
const { checkPortfolioLeafBundle } = await import("@foliage/ui/portfolio-leaf-bundle");
const { readAssessmentPublication } = await import("./src/assessmentPublication.ts");
const { renderReleasedAssessment } = await import("./src/renderAssessment.ts");
const { boundAuthorities } = await import("@foliage/leaf/bound-authorities");

const ROOT = resolve(fileURLToPath(new URL("./public", import.meta.url)));

/**
 * The design system, resolved through @foliage/tokens' own export map rather than copied.
 *
 * There WAS a copy at public/foliage-tokens.css. It drifted from the source twice: once
 * caught by a cleanup lane, and again the moment the token file was fixed upstream. Re-syncing
 * a copy does not stop it drifting; not having one does. Fonts resolve the same way, so the
 * open plane owns exactly one set of binaries and one stylesheet that names them.
 */
const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const TOKENS_DIR = dirname(TOKENS_CSS);
const FONT_NAME = /^[a-z0-9][a-z0-9._-]*\.woff2$/i;

/**
 * The three stylesheets load in a FIXED ORDER and the order is load-bearing:
 *
 *   tokens.css   the primitives and the face      (rebinds --fol-* under [data-face="day"])
 *   roles.css    the --fol-role-* aliases          (pure var() indirection, no literals)
 *   foliage.css  the component layer               (.cell/.metric/.proof/.plate/.aside/.m …)
 *   tree.css     this surface's own chrome         (last, so it can override a component)
 *
 * Each is resolved through the package's export map rather than copied. There WAS a copy of
 * the token file at public/foliage-tokens.css; it drifted twice. Re-syncing a copy does not
 * stop it drifting, not having one does.
 */
/** @param {string} name @returns {string} */
const pkg = (name) => fileURLToPath(import.meta.resolve(`@foliage/tokens/${name}`));

const PACKAGE_ASSETS = new Map([
  ["/controls.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/controls.css")), type: "text/css; charset=utf-8" }],
  ["/portfolio-leaf.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/portfolio-leaf.css")), type: "text/css; charset=utf-8" }],
  ["/foliage-tokens.css", { file: TOKENS_CSS, type: "text/css; charset=utf-8" }],
  ["/roles.css", { file: pkg("roles.css"), type: "text/css; charset=utf-8" }],
  ["/foliage.css", { file: pkg("foliage.css"), type: "text/css; charset=utf-8" }],
  ["/foliage-sprite.svg", { file: pkg("foliage-sprite.svg"), type: "image/svg+xml" }],
  ["/mark-primary.svg", { file: join(TOKENS_DIR, "mark-primary.svg"), type: "image/svg+xml" }],
  ["/mark-expressive.svg", { file: join(TOKENS_DIR, "mark-expressive.svg"), type: "image/svg+xml" }],
  ["/mark-icon.svg", { file: join(TOKENS_DIR, "mark-icon.svg"), type: "image/svg+xml" }],
]);

/**
 * THE MARK, INLINED ONCE PER DOCUMENT, FROM THE ONE FILE THAT HOLDS IT.
 *
 * Every mark and icon on every page this server emits is a `<use href="#fol-mark-sm">` into the
 * sprite injected here. Nothing in `apps/canopy` carries path data for the mark any more.
 *
 * Why this is server-side rather than a `<link>` or a copy in each page:
 *
 *   - An EXTERNAL `<use href="/foliage-sprite.svg#id">` does not resolve in Chrome or Safari
 *     (cross-document references were dropped) and never resolves under `file://`, so the
 *     symbols would silently render nothing. Inlining is the only technique that actually works.
 *   - A COPY per page is how this repository shipped a stale mark for weeks:
 *     `public/canopy-crown.js` carried its own `#fol-mark-sm` with path data that matched no
 *     shipped asset, and its own comment recorded the drift rather than fixing it. There is now
 *     exactly one copy in the repository — `@foliage/tokens/foliage-sprite.svg` — and it is read
 *     here, so a mark change in the package is a mark change on these pages with no second edit.
 *
 * Read once at boot: it is a build artifact of the design system, not a document that can change
 * under a running process the way a tree manifest can.
 */
const { inlineSprite: injectSprite, readSprite } = await import("./src/sprite.mjs");
// Read THROUGH the shared module, not beside it: this line used to resolve and read the sprite
// itself while `readSprite` existed unused two files away — the leftover Pass 3's DELETE check
// exists to catch, and a second path to one file is how the "exactly one copy" claim above rots.
const SPRITE = await readSprite();

/**
 * Insert the sprite immediately after `<body>`.
 *
 * Returns the html UNCHANGED and says so on stderr if there is no `<body>` to insert after —
 * the page then renders with empty `<use>` targets, which is visible, rather than this function
 * throwing and turning a cosmetic problem into a 500. Both facts are named: which file, and what
 * was not found in it.
 *
 * @param {string} html
 * @param {string} what  what is being served, for the diagnostic
 * @returns {string}
 */
function inlineSprite(html, what) {
  // The injection itself lives in `src/sprite.mjs` because `export.mjs` renders the same pages and
  // needs the same symbols — a second copy is how the exporter shipped marks pointing at nothing.
  const { html: out, injected } = injectSprite(SPRITE, html);
  if (!injected) {
    console.error(
      `[canopy] ${what}: no <body> element to inline the mark sprite after, so every ` +
        `<use href="#fol-mark…"> on this page will render nothing. Served unmodified.`,
    );
  }
  return out;
}

/**
 * /fonts/<name>.woff2 → the package's fonts dir. Name-only, so there is no path component.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function packageFont(pathname) {
  if (!pathname.startsWith("/fonts/")) return null;
  const name = pathname.slice("/fonts/".length);
  if (!FONT_NAME.test(name) || name !== basename(name)) return null;
  return join(TOKENS_DIR, "fonts", name);
}
const PORT = Number(process.env["PORT"] ?? 4173);
const HOST = process.env["HOST"] ?? "127.0.0.1";

const TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  }),
);

/**
 * Resolve a request path to a file inside ROOT, or null.
 *
 * The containment check compares the RESOLVED path against ROOT rather than inspecting the
 * request string, because `%2e%2e` and friends survive naive string checks. A path that
 * escapes returns null and is answered 403 — never a redirect, which would leak whether the
 * target exists.
 *
 * @param {string} urlPath
 * @returns {string | null}
 */
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(ROOT, rel));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

/* ============================================================================================
   DNS REBINDING — why the Host header is checked against the SOCKET and against nothing else.

   The usual same-origin guard compares a request's `Origin` against `req.headers["host"]`. Both
   are supplied by the client, and under DNS rebinding they AGREE: a page on `evil.com` whose name
   is re-resolved to 127.0.0.1 sends `Sec-Fetch-Site: same-origin`, `Host: evil.com:<port>` and
   `Origin: http://evil.com:<port>`. That is a genuinely same-origin request by every rule the
   browser knows, so CORS does not stop the page from READING the response. Reproduced by an
   independent reviewer against the leaf server, where merely visiting a web page returned 741,653
   bytes of somebody's private accounting — private leaflets, verbatim commit subjects, excluded
   entries and their reasons. The canopy's read is public by design, but a `/leaf/<id>` page's
   whole point is that ONLY published work appears on it, and origin reasoning an attacker can
   satisfy proves nothing about who is asking.

   The one value in the exchange a remote page cannot forge is the address this process actually
   bound, so the allow-list comes from `server.address()` — never from `HOST`, which is
   `process.env["HOST"]` and therefore exactly as steerable as the header it would be validating.

   THE COST, STATED: bind a wildcard (`HOST=0.0.0.0`) and reach this server through a LAN name or a
   reverse proxy, and the answer is 421 — a wildcard bind tells the socket nothing about which
   names are legitimately its own, so there is nothing honest to allow. For a dev and self-host
   server that is the safe direction: it refuses at the front door and names the cause, rather than
   trusting whatever a page claims to be.
   ============================================================================================ */

/** @type {readonly string[] | null} Memoised: a bound address cannot change while listening. */
let allowedAuthorities = null;

/**
 * The authorities this socket answers to — `boundAuthorities`, shared with the Leaf and Enterprise
 * servers so the three guards cannot drift apart.
 *
 * @returns {readonly string[]}
 */
function hostAllowList() {
  return (allowedAuthorities ??= boundAuthorities(server.address(), PORT));
}

const server = createServer(async (req, res) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  const secure = publicHeaders();

  /*
   * BEFORE ROUTING, and on EVERY method including GET. A request addressed to a name this socket
   * does not answer to is not this server's request, whatever it claims about its origin — and the
   * refusal has to come first, because by the time a route has run the bytes already exist.
   */
  const authority = (req.headers["host"] ?? "").toLowerCase();
  const allowed = hostAllowList();
  if (!allowed.includes(authority)) {
    res.writeHead(421, { "content-type": "text/plain; charset=utf-8", ...secure }).end(
      `misdirected: Host was ${authority === "" ? "(absent)" : `"${authority}"`}, and this ` +
        `server answers only to ${allowed.join(", ")}. Host is checked against the bound socket ` +
        `because a name that merely RESOLVES to this address — DNS rebinding — can otherwise ` +
        `make a request that is same-origin and read the reply. Nothing was served.\n`,
    );
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD", ...secure }).end("method not allowed");
    return;
  }

  /**
   * One rendered page, out. Every dynamic route below goes through this, so none of them can
   * forget the sprite, the security headers, or `no-store` — and `content-length` is taken from
   * the PRODUCED buffer rather than from anything upstream, because the sprite injection changes
   * the length and a header describing the pre-injection body is a truncated response.
   *
   * @param {number} status
   * @param {string} html
   * @param {string} what  which route, for the sprite diagnostic
   */
  const sendPage = (status, html, what) => {
    const body = Buffer.from(inlineSprite(html, what), "utf8");
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.byteLength,
      // Re-read on every request: a cached page would show a stale roster after a manifest was
      // fixed, and these pages' job is to state what is true right now.
      "cache-control": "no-store",
      // These pages render only their own markup and same-origin stylesheets. Saying so means an
      // injected string could not become an executing script even if escaping failed.
      ...publicHeaders({ portfolio: hasPortfolioEnhancement(html), form: what === "/demo" }),
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  };

  /*
   * `/tree` was the one DYNAMIC route on this server; it is now one of four, and together they
   * render a real company assembled from real leaf documents. The
   * routes are checked before the file handler so a stray `public/tree` could never shadow one.
   *
   * Every status comes from a function that lives next to the causes, so this transport layer
   * makes no policy decision — including the one that matters most here: a tree that loaded WITH
   * failed entries is a 200 whose page says so, not a 500, because a partially loadable tree is a
   * real state and not an outage.
   *
   * `/` READS THE SAME `TreeLoad` `/tree` does and shares `httpStatusFor` with it — one status
   * decision, not two that could disagree about the identical load outcome.
   */
  if (pathname.startsWith("/assessment/")) {
    try {
      const root = process.env["FOLIAGE_PUBLISHED"]?.trim();
      if (!root) { sendPage(503, renderReleasedAssessment(null), pathname); return; }
      const publication = await readAssessmentPublication(root, decodeURIComponent(pathname.slice("/assessment/".length)));
      sendPage(publication?.release ? 200 : 404, renderReleasedAssessment(publication), pathname);
    } catch {
      // No stale cache or local-leaf fallback if authoritative state cannot be read.
      sendPage(503, renderReleasedAssessment(null), pathname);
    }
    return;
  }
  if (pathname === "/") {
    const load = await loadTreeDocument();
    sendPage(200, renderCanopyPage(load), "/");
    return;
  }

  if (pathname === "/individuals") {
    sendPage(200, renderIndividualsPage(), "/individuals");
    return;
  }

  if (pathname === "/organizations") {
    sendPage(200, renderOrganizationsPage(), "/organizations");
    return;
  }

  if (pathname === "/demo") {
    const work = new URL(req.url ?? "/", "http://canopy.invalid").searchParams.get("work") ?? "";
    sendPage(200, renderDemoPage({ work }), "/demo");
    return;
  }

  if (pathname === "/tree") {
    const load = await loadTreeDocument();
    sendPage(httpStatusFor(load), renderTreePage(load), "/tree");
    return;
  }

  /**
   * THE ID IS THE REMAINDER OF THE PATH, DECODED ONCE, HERE.
   *
   * `pathname` above is the RAW request target with the query stripped, so an id arrives
   * percent-encoded — intake mints `git:<sha>` and the colon travels as `%3A` from some clients.
   * It is decoded as ONE string rather than split on `/`, so an id containing a slash arrives
   * whole instead of being cut by one of its own characters.
   *
   * A malformed percent sequence makes `decodeURIComponent` throw, and that must NOT become a
   * 500: `%zz` is a request for an id that cannot exist, which is the same answer as any other
   * id that does not exist. It falls back to the raw text — so the refusal still names what was
   * asked for, and an id that crashed the server would have been an existence oracle with a
   * stack trace attached.
   *
   * Nothing downstream uses this as a file path. It is looked up in documents already in memory,
   * so there is no traversal for it to reach.
   *
   * @param {string} raw
   * @returns {string}
   */
  const decodeId = (raw) => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  // /leaf/:id is answered further down by the published-artifact handler, which holds the
  // precedence rule (D2 + its addendum): artifact first, projection only when no artifact
  // exists. There is deliberately no standalone projection handler here any more — one address,
  // one precedence, written in one place.

  if (pathname.startsWith(PUBLIC_LEAFLET_ROUTE)) {
    /*
     * `?leaf=` QUALIFIES the address; it does not unlock it. Both paths run the domain's gates
     * and a wrong or absent value produces the identical refusal — see `resolvePublicLeaflet`.
     * The base is a constant rather than a real origin because only the query is wanted: `URL`
     * needs one, and using the Host header here would let a client's header steer parsing.
     */
    const query = new URL(req.url ?? "/", "http://canopy.invalid").searchParams;
    const leafletId = decodeId(pathname.slice(PUBLIC_LEAFLET_ROUTE.length));
    // A publication-qualified link reads only the current admitted artifact. It never falls
    // through to a tree projection after withdrawal, nor reads the owner's source Leaf.
    const publicationId = query.get("publication");
    if (publicationId !== null) {
      const load = await loadPublishedLeaf(publicationId);
      if (!load.ok) {
        console.error(`[canopy] ${PUBLIC_LEAFLET_ROUTE}${leafletId} — ${load.cause}: ${load.detail}`);
        sendPage(httpStatusForPublished(load), renderPublishedPage(load), pathname);
        return;
      }
      const detail = renderPublishedLeafletPage(load.document, leafletId);
      sendPage(detail === null ? 404 : 200, detail ?? renderPublishedLeafletNotFound(), pathname);
      return;
    }
    const scope = query.get("leaf");
    const load = await loadTreeDocument();
    const view = resolvePublicLeaflet(
      load,
      leafletId,
      scope,
    );
    sendPage(publicLeafletStatus(view), renderPublicLeafletPage(view), pathname);
    return;
  }

  /*
   * `/leaf/<id>` — THE INGEST ROUTE. One published artifact, read from disk on every request and
   * rendered from its typed fields.
   *
   * Checked before the file handler so a static file cannot shadow a published address.
   *
   * The status comes from `httpStatusForPublished`, next to the causes, so this layer makes no
   * policy decision. Seven causes map onto five statuses there, each grouping argued in place.
   *
   * THE PAGE IS PATH-FREE AND THE LOG IS NOT. `load.detail` names the exact file, which is right
   * for the operator and wrong for a public page — so the detail is written here, to the server's
   * log, and `renderPublishedPage` is never handed it. Every failure is logged, including a 404:
   * an operator debugging "my page is missing" needs to see which path was tried.
   */
  if (pathname.startsWith(PUBLISHED_ROUTE)) {
    let id = pathname.slice(PUBLISHED_ROUTE.length);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape sequence. The raw segment is kept and will be refused as an
      // unpublishable id, which is what it is — never repaired into some other id.
    }
    const load = await loadPublishedLeaf(id);

    /*
     * PRECEDENCE AT /leaf/<id> — decision D2 plus its 2026-08-27 addendum
     * (.loop/MERGE-DECISIONS.md). Two consent mechanisms now reach this one address, and they
     * are not the same act: publish.mjs crosses a WHOLE reviewed document into a frozen
     * artifact, and `share --as` offers ONE leaflet through the tree's live projection.
     *
     *   1. A published artifact, when one exists, IS the page — the strongest thing the person
     *      deliberately crossed (D2 as the owner decided it).
     *   2. A BROKEN artifact (unreadable, malformed, invalid, misfiled, unpublishable id) is
     *      REFUSED with its cause. It never falls through: tampering with an artifact must not
     *      quietly downgrade a person's page to a different mechanism's rendering.
     *   3. Only the ABSENCE of an artifact (none for this id, or no publications directory at
     *      all) reaches the projection, so a person who offered leaflets through the tree is
     *      still reachable from the roster.
     *   4. When the tree cannot load either, the answer is the ARTIFACT route's own honest
     *      status (404/503) — never a projection error about a source nobody configured.
     */
    const artifactAnswers = load.ok || (load.cause !== "absent" && load.cause !== "unconfigured");
    if (!artifactAnswers) {
      const tree = await loadTreeDocument();
      if (tree.ok) {
        const view = resolvePublicLeaf(tree, id);
        sendPage(publicLeafStatus(view), renderPublicLeafPage(view), pathname);
        return;
      }
    }
    if (!load.ok) {
      console.error(`[canopy] ${PUBLISHED_ROUTE}${id} — ${load.cause}: ${load.detail}`);
      if (load.cause === "invalid") {
        for (const issue of load.issues) console.error(`[canopy]   ${issue.at}: ${issue.message}`);
      }
    }
    /*
     * `sendPage`, NOT A HAND-WRITTEN COPY — F-033's own defect, on the page it mattered most on,
     * twice now. The first time this branch drifted it was the security headers: it used to spell
     * `content-security-policy` etc. out by hand, character-identical to `CSP_STRICT` until
     * `publicHeaders()` gained `x-robots-tag` and every response picked it up EXCEPT this one.
     * The fix then was `...secure` — still hand-assembled around it — and that second hand-assembly
     * is what went stale next: this branch never called `inlineSprite`, so `proofBadge`'s
     * `<use href="#i-partial">` pointed at a `<symbol>` that was never in the response, rendering
     * as an empty 14x14 box beside every pending/verified row. `sendPage` is the one function every
     * other dynamic route goes through for exactly this reason — headers AND the sprite, one path,
     * so this route cannot drift from the other four again by construction.
     */
    // The admitted publication renderer decides whether there is work to enhance. This
    // transport does not inspect Leaflet arrays or make a second projection decision.
    const bundle = load.ok ? await checkPortfolioLeafBundle() : null;
    sendPage(httpStatusForPublished(load), renderPublishedPage(load, { enhancePortfolio: bundle?.ok === true }), pathname);
    return;
  }

  // Package-owned assets win over anything in public/, so a stray copy cannot shadow the
  // real design system.
  if (pathname === "/portfolio-leaf.bundle.js") {
    const bundle = await checkPortfolioLeafBundle();
    if (!bundle.ok) { res.writeHead(503, { ...secure, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("Interactive leaf unavailable"); return; }
    res.writeHead(200, { ...secure, "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    if (req.method === "HEAD") res.end(); else createReadStream(bundle.path).pipe(res);
    return;
  }
  const owned = PACKAGE_ASSETS.get(pathname);
  const font = owned ? null : packageFont(pathname);
  let file = owned ? owned.file : font;

  if (!file) {
    file = safePath(req.url ?? "/");
    if (file === null) {
      res.writeHead(403, secure).end("forbidden");
      return;
    }
  }

  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file);
    }
    const type = TYPES.get(extname(file).toLowerCase()) ?? "application/octet-stream";

    res.writeHead(200, {
      "content-type": type,
      "content-length": info.size,
      // No caching in dev: a stale token file is a confusing way to lose an hour.
      "cache-control": "no-store",
      ...secure,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  } catch (err) {
    // ENOENT is a normal 404. Anything else is ours, and is reported as ours rather than
    // being flattened into "not found" — collapsing distinct causes into one status is the
    // error-masking pattern this project keeps paying for.
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      res
        .writeHead(404, { "content-type": "text/plain; charset=utf-8", ...secure })
        .end("not found");
    } else {
      console.error("[canopy] serve error:", err);
      res
        .writeHead(500, { "content-type": "text/plain; charset=utf-8", ...secure })
        .end("server error");
    }
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`[canopy] serving ${ROOT}`);
  console.log(`[canopy] http://${HOST}:${PORT}/                     (the public front door)`);
  console.log(`[canopy] http://${HOST}:${PORT}/tree                 (real data)`);
  console.log(
    `[canopy] http://${HOST}:${PORT}${PUBLISHED_ROUTE}<id>          (a published leaf)`,
  );

  // Say whether this canopy can serve published leaves at all. A route that answers 503 to every
  // request looks like a bug from the outside; saying so at boot makes it a configuration fact.
  const publications = process.env["FOLIAGE_PUBLISHED"];
  console.log(
    publications === undefined || publications.trim() === ""
      ? `[canopy] FOLIAGE_PUBLISHED is not set — no published leaf can be served (503 on ${PUBLISHED_ROUTE}<id>)`
      : `[canopy] publications directory: ${publications}`,
  );
  console.log(`[canopy] http://${HOST}:${PORT}/leaf/<id>            (one person's published work)`);
  console.log(`[canopy] http://${HOST}:${PORT}/leaflet/<id>         (one published artifact)`);

  // Say the allow-list out loud at boot. Everything else is answered 421, and an operator who
  // bound a wildcard or fronted this with a proxy should learn that here rather than from a
  // refusal they have to go read the source to understand.
  console.log(`[canopy] Host allow-list: ${hostAllowList().join(", ")} — anything else is 421`);

  // Say out loud which tree is in play and what state it is in. A server that starts silently
  // invites the assumption that it found something.
  const load = await loadTreeDocument();
  const state = load.ok
    ? `"${load.tree.company}" — ${load.tree.leaves.length} of ${load.manifest.leaves.length} named leaf/leaves loaded` +
      (load.failures.length > 0 ? `, ${load.failures.length} FAILED` : "") +
      ` from ${load.source.path}`
    : `${load.cause} — ${load.detail}`;
  console.log(`[canopy] ${state}`);
});
