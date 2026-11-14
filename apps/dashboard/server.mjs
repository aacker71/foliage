#!/usr/bin/env node
/**
 * The Foliage dashboard — ONE loopback port for the whole local product.
 *
 * LEGACY, KEPT FOR REFERENCE. The current app is `foliage up`; every page this serves, refusals
 * included, and its start-up log say so (src/legacyNotice.ts). Its forms are not maintained here.
 *
 * Until this file existed a person had to run three CLIs and two servers on two ports in the
 * right order, and know which. That is a fine developer story and a bad product one. This
 * composes the surfaces that already exist; it does not reimplement them. `/leaf` is rendered by
 * `apps/leaf`'s own renderer and `/review` by `apps/photosynthesis`'s, so there is exactly one
 * definition of what a leaf page looks like and one of what a review queue looks like.
 *
 *   FOLIAGE_LEAF=<leaf.json> FOLIAGE_HARVEST=<harvest.json> node apps/dashboard/server.mjs
 *
 * WHAT IT REFUSES TO DO:
 *   - It never invents content. With no documents it says what is absent, where it looked, and
 *     which command produces it. An empty dashboard that looks populated is the most convincing
 *     lie this product could tell.
 *   - It never widens a policy to make composition easier. The CSP is per-response and only the
 *     one page with a form gets `form-action 'self'`; every other surface keeps `'none'`, so an
 *     injected form on the leaf page has nowhere to post. This is the rule apps/leaf already
 *     established and it survives being composed.
 *   - It never accepts a mutating request it cannot attribute to its own page. `/decide` and
 *     `/promote` go through `verifyMutatingRequest` — Origin first, then a per-process token —
 *     because this binds loopback with no authentication, and any page on the internet can post
 *     a form at 127.0.0.1. Loopback is not a defence against the browser the operator is already
 *     using.
 *
 * WHY THE MARK AND SPRITE ARE READ AT BOOT AND INLINED. A same-document `#id` fragment is not a
 * fetch, so it needs no CSP directive at all; linking them would need `img-src` on a surface that
 * otherwise needs none. Read once, because they cannot change while the process runs, and a read
 * that fails should stop the server rather than quietly serve an unbranded page.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Pure JS, before any `.ts` import. `preflight.ts` cannot explain a type-stripping failure
 * because importing it IS that failure — see the long note in apps/leaf/server.mjs.
 */
if (process.features.typescript !== "strip") {
  process.stderr.write(
    `dashboard: this Node cannot run the sources. Foliage ships TypeScript that Node executes ` +
      `directly, which needs Node 22.18.0 or newer; you are running ${process.version}.\n` +
      `Install a supported Node (see .nvmrc) and retry.\n`,
  );
  process.exit(2);
}

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(APP_DIR, "../..");

const { resolveRoute } = await import("./src/routes.ts");
const { verifyMutatingRequest } = await import("./src/csrf.ts");
const { withLegacyNotice } = await import("./src/legacyNotice.ts");
const { HARVEST_ENV, loadHarvestDocument, tallyHarvest } = await import("./src/harvestStatus.ts");

/*
 * Composed, not reimplemented. Reached by PACKAGE NAME through each app's export
 * map declaring exactly the modules a composer may reach. Both apps are in the OPEN plane, so
 * `check:boundary` is satisfied, and naming the entry points keeps this from being a licence to
 * import any file in another app.
 */
const { loadLeafDocument, httpStatusFor } = await import("@foliage/leaf-app/leafDocument");
const { loadPublishPolicy } = await import("@foliage/leaf-app/policyDocument");
const { renderLeafPage } = await import("@foliage/leaf-app/render");
const { LEGACY_NOTICE_TEXT, legacyNotice, renderReviewPage } = await import("@foliage/photosynthesis-app/renderReview");
const { promote } = await import("@foliage/photosynthesis-app/promote");

const PORT = Number(process.env["PORT"] ?? 4179);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const SELF_ORIGIN = `http://${HOST}:${PORT}`;

/** One token per process. It is not a session; it proves a form came from a page this process
 *  served, which is the only question a single-operator loopback tool needs to ask. */
const CSRF_TOKEN = randomUUID();

const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const TOKENS_DIR = dirname(TOKENS_CSS);
const FONTS_DIR = join(TOKENS_DIR, "fonts");

const ASSET_FILES = new Map([
  ["/tokens.css", { file: TOKENS_CSS, type: "text/css; charset=utf-8" }],
  ["/roles.css", { file: fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css")), type: "text/css; charset=utf-8" }],
  ["/controls.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/controls.css")), type: "text/css; charset=utf-8" }],
  ["/workspace-shell.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/workspace.css")), type: "text/css; charset=utf-8" }],
  ["/foliage.css", { file: join(REPO, "apps/leaf/public/foliage.css"), type: "text/css; charset=utf-8" }],
  ["/leaf.css", { file: join(REPO, "apps/leaf/public/leaf.css"), type: "text/css; charset=utf-8" }],
  ["/review.css", { file: join(REPO, "apps/photosynthesis/public/review.css"), type: "text/css; charset=utf-8" }],
  ["/dashboard.css", { file: join(APP_DIR, "public/dashboard.css"), type: "text/css; charset=utf-8" }],
  ["/mark-primary.svg", { file: join(TOKENS_DIR, "mark-primary.svg"), type: "image/svg+xml" }],
  ["/mark-expressive.svg", { file: join(TOKENS_DIR, "mark-expressive.svg"), type: "image/svg+xml" }],
  ["/mark-icon.svg", { file: join(TOKENS_DIR, "mark-icon.svg"), type: "image/svg+xml" }],
]);

const PAGE_ASSETS = {
  sprite: await readFile(fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")), "utf8"),
};

/**
 * `form-action` is the only directive that varies, and only the review page has a form.
 * @param {boolean} allowForm
 * @returns {string}
 */
function csp(allowForm) {
  return (
    `default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; ` +
    `base-uri 'none'; frame-ancestors 'none'; form-action ${allowForm ? "'self'" : "'none'"}`
  );
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} type
 * @param {string | Buffer} body
 * @param {{allowForm?: boolean, headOnly?: boolean, extra?: Record<string, string>}} [opts]
 */
function send(res, status, type, body, { allowForm = false, headOnly = false, extra = {} } = {}) {
  const page = typeof body === "string" && type.startsWith("text/html") ? withLegacyNotice(body, legacyNotice()) : body;
  const buf = typeof page === "string" ? Buffer.from(page, "utf8") : page;
  res.writeHead(status, {
    "content-type": type,
    "content-length": buf.byteLength,
    "cache-control": "no-store",
    "content-security-policy": csp(allowForm),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    ...extra,
  });
  headOnly ? res.end() : res.end(buf);
}

/** @param {unknown} s @returns {string} */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** @type {Record<string, string>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * A refusal a person can reach, by following one of the composed pages' links or submitting a
 * form, is a page too, so it is HTML and `send` labels it after the title. Asset and font refusals
 * stay plain text: a stylesheet or font request is never read by a person.
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} title
 * @param {string} detail
 * @param {{headOnly?: boolean, extra?: Record<string, string>}} [opts]
 */
function sendRefusal(res, status, title, detail, opts) {
  send(res, status, "text/html; charset=utf-8",
    `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)} · Foliage</title><link rel="icon" href="/mark-icon.svg">` +
      `<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css">` +
      `<link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css">` +
      `<link rel="stylesheet" href="/dashboard.css"></head>` +
      `<body class="fol-app dash-app"><main class="dash-content dash-refusal">` +
      `<h1>${esc(title)}</h1><p>${esc(detail)}</p><a class="fol-button fol-button-outline" href="/">Back to dashboard</a>` +
      `</main></body></html>`, opts);
}

/**
 * The home page: what exists, what does not, and the command that produces what is missing.
 *
 * Everything here is measured from the two loads. There is no state of this page that shows a
 * number nothing produced — with nothing configured it is a list of two absences and two
 * commands, which is the honest first-run screen.
 */
/**
 * @param {Awaited<ReturnType<typeof loadLeafDocument>>} leafLoad
 * @param {Awaited<ReturnType<typeof loadHarvestDocument>>} harvestLoad
 * @returns {string}
 */
function renderHome(leafLoad, harvestLoad) {
  const leafOk = leafLoad.ok;
  const harvestOk = harvestLoad.ok;
  const tally = harvestLoad.ok ? tallyHarvest(harvestLoad.harvest) : undefined;

  /** @type {(label: string, ok: boolean, detail: string, action: string) => string} */
  const row = (label, ok, detail, action) => `
    <article class="dash-row${ok ? "" : " dash-row--absent"}">
      <h2>${esc(label)}</h2>
      <p class="dash-detail">${esc(detail)}</p>
      ${action ? `<details class="dash-command"><summary>Command line</summary><code>${esc(action)}</code></details>` : ""}
    </article>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Foliage</title>
<link rel="icon" href="/mark-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/controls.css">
<link rel="stylesheet" href="/dashboard.css"></head>
<body class="fol-app dash-app"><main class="dash-content">
<h1>Foliage</h1>
<nav class="dash-nav" aria-label="Legacy views"><a class="fol-button fol-button-outline" href="/leaf">Open leaf</a><a class="fol-button fol-button-outline" href="/review">Review drafts</a></nav>
<div class="dash-records">
${row("Work", leafOk, leafOk ? `${leafLoad.leaf.leaflets.length} leaflet(s) for "${leafLoad.leaf.subject}"` : `no leaf document — looked at ${leafLoad.path ?? "(unconfigured)"}`, leafOk ? "" : "node apps/leaf/intake.mjs --repo <path> --subject \"<name>\" --identity <email>")}
${row("Review", harvestOk, tally !== undefined ? `${tally.awaitingReview} awaiting review, ${tally.approvedNotInLeaf} approved and not yet in the leaf, ${tally.inLeaf} in the leaf` : `no harvest document — looked at ${harvestLoad.ok ? "" : (harvestLoad.path ?? "(unconfigured, set " + HARVEST_ENV + ")")}`, tally !== undefined ? "" : "node apps/photosynthesis/photosynthesis.mjs --repo <path> --subject \"<name>\" --identity <email>")}
</div>
</main></body></html>`;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<URLSearchParams>}
 */
async function readForm(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  for await (const c of req) {
    bytes += c.length;
    if (bytes > 64 * 1024) throw new Error("form body too large");
    chunks.push(c);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const headOnly = method === "HEAD";
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", SELF_ORIGIN).pathname);
  } catch {
    sendRefusal(res, 400, "Bad address", "That address could not be read.", { headOnly });
    return;
  }

  const route = resolveRoute(method, pathname);

  try {
    switch (route.kind) {
      case "home": {
        const [leafLoad, harvestLoad] = await Promise.all([
          loadLeafDocument(process.env),
          loadHarvestDocument(),
        ]);
        send(res, 200, "text/html; charset=utf-8", renderHome(leafLoad, harvestLoad), { headOnly });
        return;
      }
      case "leaf": {
        // The leaf page is policy-aware now: what it renders depends on the rules in force, so
        // this composer rides the same policy rail apps/leaf/server.mjs does instead of a page
        // that silently pretends no policy exists. A failed policy load is a named 503, exactly
        // like the harvest failure below — never a page rendered under rules nobody loaded.
        const [load, policy] = await Promise.all([loadLeafDocument(process.env), loadPublishPolicy()]);
        if (!policy.ok) {
          send(res, 503, "text/html; charset=utf-8",
            `<!doctype html><meta charset=utf-8><title>No publish policy</title>` +
            `<p>${esc(policy.detail)}</p>`, { headOnly });
          return;
        }
        send(res, httpStatusFor(load), "text/html; charset=utf-8",
          renderLeafPage(load, policy.policy, "private"), { headOnly });
        return;
      }
      case "review": {
        const load = await loadHarvestDocument();
        if (!load.ok) {
          send(res, load.cause === "absent" ? 404 : 503, "text/html; charset=utf-8",
            `<!doctype html><meta charset=utf-8><title>No review queue</title>` +
            `<p>${esc(load.detail)}</p>`, { headOnly });
          return;
        }
        send(res, 200, "text/html; charset=utf-8",
          renderReviewPage(load.harvest, CSRF_TOKEN, PAGE_ASSETS), { allowForm: true, headOnly });
        return;
      }
      case "decide":
      case "promote": {
        const form = await readForm(req);
        const verdict = verifyMutatingRequest(
          { origin: req.headers.origin, referer: req.headers.referer },
          form.get("csrf"),
          SELF_ORIGIN,
          CSRF_TOKEN,
        );
        if (!verdict.ok) {
          sendRefusal(res, 403, "Refused",
            `That request did not come from this page (${verdict.failed}). Nothing was changed.`, { headOnly });
          return;
        }
        const harvestPath = process.env[HARVEST_ENV];
        const leafTarget = process.env["FOLIAGE_LEAF"];
        if (route.kind === "promote") {
          if (harvestPath === undefined || leafTarget === undefined) {
            // Naming which one is missing, rather than a generic 503: "not configured" is two
            // different facts and the operator can only fix the one they are actually missing.
            sendRefusal(res, 503, "Not configured",
              `Adding to the leaf needs both documents configured: ` +
              `${harvestPath === undefined ? HARVEST_ENV + " is unset" : "FOLIAGE_LEAF is unset"}`,
              { headOnly });
            return;
          }
          const r = await promote(harvestPath, leafTarget);
          if (r.ok) send(res, 303, "text/plain; charset=utf-8", "", { headOnly, extra: { location: "/review" } });
          else sendRefusal(res, 409, "Not added", "Nothing was added to the leaf.", { headOnly });
          return;
        }
        // A decide with no server-side helper exported is a refusal, not a guess.
        sendRefusal(res, 501, "Not available here",
          "Deciding is not available in this legacy view. Review drafts in the current app: " +
            "run node foliage.mjs up, then open /review.",
          { headOnly });
        return;
      }
      case "asset": {
        const a = ASSET_FILES.get(route.path);
        if (a === undefined) { send(res, 404, "text/plain; charset=utf-8", "not found", { headOnly }); return; }
        const body = await readFile(a.file).catch(() => null);
        if (body === null) { send(res, 404, "text/plain; charset=utf-8", "not found", { headOnly }); return; }
        send(res, 200, a.type, body, { headOnly });
        return;
      }
      case "font": {
        if (!FONT_NAME.test(route.name) || route.name !== basename(route.name)) {
          send(res, 403, "text/plain; charset=utf-8", "forbidden", { headOnly }); return;
        }
        const file = resolve(join(FONTS_DIR, route.name));
        if (file !== FONTS_DIR && !file.startsWith(FONTS_DIR + sep)) {
          send(res, 403, "text/plain; charset=utf-8", "forbidden", { headOnly }); return;
        }
        const body = await readFile(file).catch(() => null);
        if (body === null) { send(res, 404, "text/plain; charset=utf-8", "not found", { headOnly }); return; }
        send(res, 200, "font/woff2", body, { headOnly });
        return;
      }
      case "forbidden":
        sendRefusal(res, 403, "Refused", route.detail, { headOnly }); return;
      case "method-not-allowed":
        sendRefusal(res, 405, "Not available here", "This address does not accept that request.",
          { headOnly, extra: { allow: route.allow } }); return;
      default:
        // Most often a link on a composed page to a screen only the current app has.
        sendRefusal(res, 404, "Not found", "This legacy view does not have that page.", { headOnly }); return;
    }
  } catch (err) {
    // Ours, not the caller's. Flattening this into a 404 is the error-masking pattern.
    process.stderr.write(`dashboard: ${err instanceof Error ? err.stack : String(err)}\n`);
    sendRefusal(res, 500, "Something went wrong",
      "This page could not be shown. The details are in the terminal where the dashboard runs.", { headOnly });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[dashboard] ${SELF_ORIGIN}/\n`);
  process.stdout.write(`[dashboard] ${LEGACY_NOTICE_TEXT}\n`);
  process.stdout.write(
    `[dashboard] leaf=${process.env["FOLIAGE_LEAF"] ?? "(unset)"} harvest=${process.env[HARVEST_ENV] ?? "(unset)"}\n`,
  );
});
