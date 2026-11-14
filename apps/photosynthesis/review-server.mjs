#!/usr/bin/env node
/**
 * Review server — the HUMAN GATE between AI-drafted candidates and the subject's leaf.
 *
 * LEGACY, KEPT FOR REFERENCE. Drafts are reviewed in `foliage up` at /review now; every page
 * here and the start-up log say so (`legacyNotice` in src/renderReview.ts).
 *
 * Port 4177 (leaf 4174, canopy 4173). `FOLIAGE_HARVEST` names the harvest document;
 * `FOLIAGE_LEAF` names the leaf that promotion writes into (same env var, same default,
 * same meaning as the leaf app — one contract).
 *
 * THIS IS THE FIRST MUTATING SURFACE IN THE REPOSITORY, so its rules are explicit:
 *   - Plain HTML forms, zero JS. CSP stays `default-src 'none'` with `style-src` and
 *     `form-action 'self'` — the one addition a form needs. Script execution remains
 *     impossible on a page that renders model-drafted and verbatim-evidence text.
 *   - POST /decide marks ONE candidate approved|rejected (with the instant). A decided
 *     candidate shows its decision; there is no undo endpoint in the prototype — the
 *     harvest file is the subject's own and hand-editable, and silent un-rejection is
 *     exactly the kind of drift the review exists to prevent.
 *   - POST /promote runs the promotion (validated merge, idempotent, all-or-nothing).
 *   - Loopback only, like everything else here. This is the subject's own airlock on
 *     the subject's own machine.
 *
 * The page's honesty layout mirrors the product's text classes: DRAFTED prose is
 * visually labelled with its provenance (which model, or "no model"); EVIDENCE is
 * verbatim and marked as such; chrome is the page's own voice. A reviewer always sees
 * what the machine wrote next to what the evidence says, never one without the other.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHarvestDocument } from "./src/harvestDocument.ts";
import { promote } from "./src/promote.ts";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { LEGACY_NOTICE_TEXT, renderReviewPage, renderErrorPage } from "./src/renderReview.ts";
// THE ONE SHARED RULE, ledger F-025 — a third independent copy of "a write route ran against a
// document silently guessed from an unset env var" turned up here, after `harvest.mjs`'s own
// promote/approve/reject and `apps/leaf/server.mjs`'s recordDecision/carryIntoLeaf. `writeGuard`
// is PURE (no fs, no env, no clock): this file reads its OWN `process.env` — the one effect that
// belongs at this edge — and hands the values to the same judgment both other writers now share.
import { writeGuard } from "@foliage/photosynthesis";

const PORT = Number(process.env["PORT"] ?? 4177);
const HOST = process.env["HOST"] ?? "127.0.0.1";

/**
 * CSRF DEFENCE — a per-process token, plus an Origin/Referer check.
 *
 * Found by adversarial review, and the /promote case was the sharp one: it reads NO
 * request body at all, so a hidden auto-submitting form on ANY page open in the user's
 * browser could silently promote every approved-but-unpromoted candidate into the real
 * leaf — bypassing the deliberate final human click this product's copy leans on. A
 * form POST is a "simple request": no CORS preflight protects it, and `form-action
 * 'self'` constrains only forms THIS page renders, not an attacker's.
 *
 * Per-process rather than per-page-load so a stale tab still works within a session,
 * and compared in constant time. Zero-JS compatible: it rides in a hidden field.
 */
const CSRF_TOKEN = randomUUID();
const SELF_ORIGIN = `http://${HOST}:${PORT}`;

/** @param {string | undefined} candidate */
function tokenMatches(candidate) {
  if (typeof candidate !== "string" || candidate.length !== CSRF_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(CSRF_TOKEN));
}

/**
 * Same-origin check, defence in depth beside the token. Absent headers are REFUSED
 * rather than allowed: a browser sends Origin on cross-site form POSTs, so a missing
 * one on a state-changing request is not the shape a legitimate click has.
 * @param {import("node:http").IncomingMessage} req
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === "string") return origin === SELF_ORIGIN;
  const referer = req.headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin === SELF_ORIGIN;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Write JSON by temp-file + rename, so the file is never observed half-written.
 * `promote.ts` documents an all-or-nothing guarantee; plain `writeFile` truncates in
 * place and can leave corrupt JSON if the process dies mid-syscall. Rename on the same
 * filesystem is atomic, which makes the documented guarantee the actual mechanism.
 * @param {string} path @param {unknown} value
 */
async function writeJsonAtomic(path, value) {
  writeDocument(path, JSON.stringify(value, null, 2) + "\n");

}
const HARVEST = resolve(
  process.env["FOLIAGE_HARVEST"] ?? new URL("./leaf.harvest.json", import.meta.url).pathname,
);
const LEAF = resolve(process.env["FOLIAGE_LEAF"] ?? new URL("../leaf/leaf.json", import.meta.url).pathname);

/**
 * THE DESIGN SYSTEM, resolved through @foliage/tokens' own export map — the same
 * mechanism apps/leaf/server.mjs uses, deliberately not a second one.
 *
 * FOUND BY THE VERIFY HARNESS ON ITS FIRST FULL RUN: this page named "Instrument Sans",
 * Fraunces and "JetBrains Mono" in its CSS and served no `@font-face` at all, so
 * `document.fonts.size` was 0 and every word rendered in a fallback face. That is exactly
 * the defect F8 already recorded once — a design system asserted rather than delivered —
 * and it survived a 13-agent review because no reviewer measured the running page.
 *
 * FOUND AGAIN, ONE LAYER UP: the component layer used to be VENDORED into `public/` here,
 * and those 611 lines re-declared 49 `--fol-*` tokens — `--fol-text-faint` among them,
 * whose value is a measured contrast fix. Loaded after tokens.css, the copy won every
 * collision, so this surface was wearing a fork of the design system that no measurement
 * covered. Both files now resolve from the package, so there is exactly one copy of each
 * and a token fix reaches this page the moment it lands.
 */
const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const FOLIAGE_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/foliage.css"));
const SPRITE_SVG = fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg"));
const MARK_ICON_SVG = fileURLToPath(import.meta.resolve("@foliage/tokens/mark-icon.svg"));
const TOKENS_DIR = dirname(TOKENS_CSS);
const FONTS_DIR = join(TOKENS_DIR, "fonts");
const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

/**
 * Exact request path → exact file, copied in form from apps/leaf/server.mjs. An allow-map
 * rather than a directory walk: for a fixed set of assets there is no user-controlled path
 * component at all, which is a stronger guarantee than any containment check on one.
 *
 * The sprite is NOT here, on purpose. It is inlined into the document instead (below):
 * a cross-document `<use href="file.svg#id">` has no covering directive under
 * `default-src 'none'`, and Chromium and WebKit refuse cross-document `<use>` outright, so
 * serving it as an asset would render nothing AND need the policy loosened to even try.
 */
const ASSETS = new Map([
  ["/tokens.css", { file: TOKENS_CSS, type: "text/css; charset=utf-8" }],
  ["/roles.css", { file: fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css")), type: "text/css; charset=utf-8" }],
  ["/controls.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/controls.css")), type: "text/css; charset=utf-8" }],
  ["/workspace-shell.css", { file: fileURLToPath(import.meta.resolve("@foliage/ui/workspace.css")), type: "text/css; charset=utf-8" }],
  ["/foliage.css", { file: FOLIAGE_CSS, type: "text/css; charset=utf-8" }],
  ["/review.css", { file: join(PUBLIC_DIR, "review.css"), type: "text/css; charset=utf-8" }],
  // The favicon, and the one asset that forced this surface to gain `img-src`. A favicon is
  // unavoidably a FETCH — there is no inline equivalent the way the sprite and the mark have
  // one — so the choice was an icon or a policy with no img-src, not both. An unbranded tab
  // is a real cost on a surface a person leaves open while they review, and `img-src 'self'`
  // is the narrowest widening that buys it: same-origin only, no data:, no https:.
  ["/mark-icon.svg", { file: MARK_ICON_SVG, type: "image/svg+xml" }],
]);

/** Same-document sprite references remain inline; the shared shell uses the served icon mark. */
const PAGE_ASSETS = {
  sprite: await readFile(SPRITE_SVG, "utf8"),
};

/**
 * Send raw bytes (font files). Separate from `send` so nothing has to guess whether a
 * body is text needing utf8 encoding or binary that must not be touched.
 * @param {import("node:http").ServerResponse} res @param {number} status
 * @param {string} type @param {Buffer} buf
 */
function sendBuffer(res, status, type, buf) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": buf.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(buf);
}

/**
 * @param {import("node:http").ServerResponse} res @param {number} status
 * @param {string} type @param {string} body
 */
function send(res, status, type, body) {
  const buf = Buffer.from(body, "utf8");
  res.writeHead(status, {
    "content-type": type,
    "content-length": buf.byteLength,
    "cache-control": "no-store",
    // Forms need form-action 'self'; everything else stays 'none'. No script-src:
    // script execution is impossible on this page, deliberately.
    // frame-ancestors does NOT inherit from default-src (same reason base-uri and
    // form-action are listed explicitly), so without it this page is iframe-able and the
    // CSRF gap above becomes precision clickjacking over the real Approve/Reject buttons.
    "content-security-policy":
      "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    // same-origin, not no-referrer: the Referer is a fallback leg of the CSRF check, and
    // it must survive same-origin form POSTs to be worth checking.
    "referrer-policy": "same-origin",
  });
  res.end(buf);
}

/**
 * The integrated collector and this historical standalone server both use a file named
 * harvest.json, but their candidate formats differ. A queue in the current format is not a
 * fault here: it belongs to `foliage up`, so it gets a named 409 rather than a 500. The page
 * gives the next step as its action (`renderErrorPage`'s "current-app"); the start-up log has
 * only this message to give it in.
 */
const CURRENT_FORMAT = "This review queue is in the current format.";
class CurrentQueueFormat extends Error {
  constructor() {
    super(`${CURRENT_FORMAT} Review it in the current app: run node foliage.mjs up, then open /review.`);
    this.name = "CurrentQueueFormat";
  }
}

/**
 * The legacy format always carries `schemaVersion` and never `leafId` or `repo`; the current one
 * never carries `schemaVersion`. So a queue is recognised at the document level, empty or not,
 * and also by candidates that carry the current `review` and `extractor`.
 * @param {unknown} document
 */
function isCurrentQueue(document) {
  if (!document || typeof document !== "object" || !("candidates" in document) || !Array.isArray(document.candidates)) {
    return false;
  }
  return !("schemaVersion" in document) || "leafId" in document || "repo" in document ||
    document.candidates.some((/** @type {unknown} */ candidate) => candidate && typeof candidate === "object" &&
      "review" in candidate && "extractor" in candidate);
}

/**
 * `promote` reads the queue with the legacy parser, which would answer a current-format queue
 * with every field it cannot read. So it is refused by name first, like every other route; any
 * other document, absent or broken, stays `promote`'s to judge.
 */
async function refuseCurrentQueue() {
  const document = await readFile(HARVEST, "utf8").then((text) => JSON.parse(text)).catch(() => undefined);
  if (isCurrentQueue(document)) throw new CurrentQueueFormat();
}

async function loadHarvest() {
  const document = JSON.parse(await readFile(HARVEST, "utf8"));
  // Refused by name before the legacy parser emits one error for every field of every candidate.
  if (isCurrentQueue(document)) throw new CurrentQueueFormat();
  const parsed = parseHarvestDocument(document);
  if (!parsed.ok) {
    const detail = parsed.issues.slice(0, 3).map((i) => `${i.at}: ${i.message}`).join("; ") +
      (parsed.issues.length > 3 ? `; ${parsed.issues.length - 3} more issue(s)` : "");
    throw new Error(`harvest invalid — ${detail}`);
  }
  return parsed.harvest;
}

/** @param {import("node:http").IncomingMessage} req */
async function readForm(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("request too large");
  }
  return new URLSearchParams(body);
}

/**
 * F-025: refuse a write route BEFORE it does anything, when the env var(s) it depends on were
 * never actually configured — never guessed from `HARVEST`/`LEAF`'s own well-known defaults
 * above. Unlike `apps/leaf/server.mjs`'s equivalent, this file's routes are IMPERATIVE — each
 * one calls `send` directly and returns, rather than returning a value the caller sends — so
 * this helper matches that shape: it sends the refusal itself and reports whether it did,
 * which the caller checks to know whether to stop.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {Readonly<Record<string, string | undefined>>} values - name → the value THIS route's
 *   caller read from `process.env`, right at its own call site
 * @returns {boolean} true means a refusal was already sent; the caller must return immediately
 */
function refuseIfUnconfigured(res, values) {
  const verdict = writeGuard(values);
  if (verdict.ok) return false;
  const names = verdict.missing;
  send(
    res,
    409,
    "text/html; charset=utf-8",
    renderErrorPage(
      "Not configured",
      `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} not set, so this server will ` +
        `not guess which document to write. This is the review server's first mutating route — ` +
        `export ${names.join(" and ")} yourself (see this file's own header for what each names) ` +
        `and restart before retrying. NOTHING was written.`,
      PAGE_ASSETS,
    ),
  );
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  try {
    const asset = req.method === "GET" ? ASSETS.get(url.pathname) : undefined;
    if (asset !== undefined) {
      send(res, 200, asset.type, await readFile(asset.file, "utf8"));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/fonts/")) {
      // Name-only, so there is no user-controlled path component at all; the resolved
      // path is re-checked against FONTS_DIR anyway.
      const name = url.pathname.slice("/fonts/".length);
      if (!FONT_NAME.test(name) || name !== basename(name)) {
        send(res, 403, "text/plain; charset=utf-8", "forbidden");
        return;
      }
      const file = resolve(join(FONTS_DIR, name));
      if (file !== FONTS_DIR && !file.startsWith(FONTS_DIR + sep)) {
        send(res, 403, "text/plain; charset=utf-8", "forbidden");
        return;
      }
      sendBuffer(res, 200, "font/woff2", await readFile(file));
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, "text/html; charset=utf-8", renderReviewPage(await loadHarvest(), CSRF_TOKEN, PAGE_ASSETS));
      return;
    }

    if (req.method === "POST" && url.pathname === "/decide") {
      const form = await readForm(req);
      if (!sameOrigin(req) || !tokenMatches(form.get("csrf") ?? undefined)) {
        send(res, 403, "text/html; charset=utf-8", renderErrorPage("Refused", "That request did not come from this review page. Nothing was changed.", PAGE_ASSETS));
        return;
      }
      // F-025: this writes the harvest document — never against one silently guessed from an
      // unset FOLIAGE_HARVEST. See the import comment above for the shared rule.
      if (refuseIfUnconfigured(res, { FOLIAGE_HARVEST: process.env["FOLIAGE_HARVEST"] })) return;
      const id = form.get("id");
      const verdict = form.get("verdict");
      if (id === null || (verdict !== "approved" && verdict !== "rejected")) {
        send(res, 400, "text/html; charset=utf-8", renderErrorPage("Bad request", "A decision needs a candidate id and a verdict of approved or rejected.", PAGE_ASSETS));
        return;
      }
      // SERIALIZED. Two tabs deciding at once would otherwise both read the same
      // document and the second write would clobber the first decision — a lost human
      // decision is exactly the thing this surface exists to record.
      await withDocumentLocks([HARVEST], async () => {
        const harvest = await loadHarvest();
        const target = harvest.candidates.find((c) => c.id === id);
        if (target === undefined) {
          send(res, 404, "text/html; charset=utf-8", renderErrorPage("No such candidate", `Nothing in this harvest has the id ${id}.`, PAGE_ASSETS));
          return;
        }
        if (target.status !== "proposed") {
          // A decision is a decision. Changing it is a hand edit of the subject's own
          // file, not a button — silent flip-flops are what an audit trail exists to prevent.
          send(
            res,
            409,
            "text/html; charset=utf-8",
            renderErrorPage(
              "Already decided",
              `That candidate is already ${target.status}. A decision is deliberately final here — ` +
                `to change one, edit the harvest file directly.`,
              PAGE_ASSETS,
            ),
          );
          return;
        }
        await writeJsonAtomic(HARVEST, {
          ...harvest,
          candidates: harvest.candidates.map((c) =>
            c.id === id ? { ...c, status: verdict, reviewedAt: new Date().toISOString() } : c,
          ),
        });
        res.writeHead(303, { location: "/" }).end();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/promote") {
      const form = await readForm(req);
      if (!sameOrigin(req) || !tokenMatches(form.get("csrf") ?? undefined)) {
        // The sharpest CSRF case: /promote needs no parameters, so without this an
        // auto-submitting form on any open page could promote for you.
        send(res, 403, "text/html; charset=utf-8", renderErrorPage("Refused", "That request did not come from this review page. Nothing was promoted.", PAGE_ASSETS));
        return;
      }
      // F-025: this reads the harvest AND writes the leaf — checked the same way
      // `harvest.mjs promote` requires BOTH `--doc` and `--into`, one seam over.
      if (
        refuseIfUnconfigured(res, {
          FOLIAGE_HARVEST: process.env["FOLIAGE_HARVEST"],
          FOLIAGE_LEAF: process.env["FOLIAGE_LEAF"],
        })
      ) {
        return;
      }
      await refuseCurrentQueue();
      const result = await promote(HARVEST, LEAF);
      if (!result.ok) {
        send(res, 500, "text/html; charset=utf-8", renderErrorPage("Promotion refused", result.issues.join(" · "), PAGE_ASSETS));
        return;
      }
      res.writeHead(303, { location: "/" }).end();
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", `no route for ${req.method} ${url.pathname}`);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ELOCALBUSY") {
      send(res, 409, "text/plain; charset=utf-8", err instanceof Error ? err.message : String(err));
      return;
    }
    if (err instanceof CurrentQueueFormat) {
      // Not Back: the queue page is this same refusal.
      send(res, 409, "text/html; charset=utf-8",
        renderErrorPage("Review this queue in foliage up", `${CURRENT_FORMAT} Nothing was changed.`, PAGE_ASSETS, "current-app"));
      return;
    }
    console.error(`[photosynthesis] ${url.pathname} failed:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    if (["/", "/decide", "/promote"].includes(url.pathname)) {
      send(res,500,"text/html; charset=utf-8",renderErrorPage("Review unavailable",detail,PAGE_ASSETS));
    } else send(res,500,"text/plain; charset=utf-8",`server error: ${detail}`);
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`[photosynthesis] http://${HOST}:${PORT}/`);
  console.log(`[photosynthesis] ${LEGACY_NOTICE_TEXT}`);
  try {
    const h = await loadHarvest();
    const open = h.candidates.filter((c) => c.status === "proposed").length;
    console.log(`[photosynthesis] ${h.candidates.length} candidate(s) for "${h.subject}" (${open} awaiting review) from ${HARVEST}`);
  } catch (err) {
    console.log(`[photosynthesis] ${err instanceof Error ? err.message : err}`);
  }
  console.log(`[photosynthesis] promotion target: ${LEAF}`);
});
