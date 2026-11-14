#!/usr/bin/env node
/**
 * static — serve ONE exported site folder over loopback so `pnpm verify export-site` can
 * measure it in a real browser.
 *
 * THE CORPSE THIS EXISTS OVER: the stale export at ~/.foliage/site carried 106 false PRIVATE
 * badges from 2026-08-23 until the two-faces fix (2c7b33e), and nothing in the loop could see
 * it — the exported folder was the first surface a non-owner would ever meet, and the ONLY
 * surface with no row in tools/verify/surfaces.mjs. This server is the boot command for that
 * row and nothing more: no cache, no directory listing, no rewrite. It serves the folder the
 * way a stranger's static host would — which is exactly the condition the artifact must
 * survive — plus `nosniff`, which any competent host sends.
 *
 *   FOLIAGE_SITE=<dir> PORT=<n> node tools/verify/static.mjs
 *
 * WHY NO CSP HEADER: every product server here sends `default-src 'none'`, but the exported
 * folder is handed to hosts that send nothing. Measuring it behind a protective header would
 * verify the header, not the artifact. The page has to be safe by its own bytes.
 *
 * THE ONE SEAM THAT MATTERS is path resolution: the folder this serves sits INSIDE the garden
 * (~/.foliage/site), and one directory up live leaf.json and fireworks.env — a real person's
 * evidence and a credential. A `..` that escaped the root would turn a verify convenience into
 * an exfiltration route on loopback. So resolution is a pure, tested function that refuses
 * anything outside the root BY NAME — `..`, percent-encoded traversal, NUL. Stated limit: the
 * check is on the resolved NAME, never a stat, so a symlink planted inside the root and
 * pointing out of it would be followed. The export writes only its literal ASSETS list and
 * never a symlink, and planting one takes the same local write access that already reads the
 * garden directly — recorded here so the claim stays exactly as strong as the check.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { isEntryPoint } from "./serving.mjs";

/** The types the export writes (see ASSETS in apps/leaf/export.mjs) — an allow-list-shaped
 * map, not a guess. A woff2 served as octet-stream makes `document.fonts` quietly fall back,
 * which is the fallback-face corpse from LOOP.md gate 1 wearing a new hat. */
/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/**
 * Resolve one request path against the site root, or refuse by name.
 * Pure and total — the server maps the refusals to status codes.
 *
 * @param {string} root absolute, already-resolve()d site directory
 * @param {string} rawUrl the request URL as received
 * @returns {{ok: true, path: string, type: string}
 *         | {ok: false, cause: "undecodable" | "outside-root", detail: string}}
 */
export function siteFileFor(root, rawUrl) {
  const bare = rawUrl.split(/[?#]/, 1)[0] ?? "";
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return { ok: false, cause: "undecodable", detail: bare };
  }
  if (decoded.includes("\0")) return { ok: false, cause: "outside-root", detail: decoded };
  const rel = decoded === "/" ? "/index.html" : decoded;
  const full = resolve(root, `.${rel}`);
  if (full !== root && !full.startsWith(root + sep)) {
    return { ok: false, cause: "outside-root", detail: decoded };
  }
  return { ok: true, path: full, type: TYPES[extname(full)] ?? "application/octet-stream" };
}

/** Local harness identity: bind a response to the explicitly selected folder without
 * publishing its filesystem path in a header. This is an identity check, not authentication. */
/** @param {string} root */
export function exportSiteIdentity(root) {
  return createHash("sha256").update(resolve(root)).digest("hex");
}

/** Construct a server without listening; callers/tests choose and own the port. */
/** @param {string} root */
export function createSiteServer(root) {
  const ROOT = resolve(root);
  const identity = exportSiteIdentity(ROOT);
  return createServer(async (req, res) => {
    res.setHeader("x-foliage-site", identity);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
      res.end("static: this folder only answers GET and HEAD.\n");
      return;
    }
    const verdict = siteFileFor(ROOT, req.url ?? "/");
    if (!verdict.ok) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end(`static: refused (${verdict.cause}): ${verdict.detail}\n`);
      return;
    }
    try {
      const bytes = await readFile(verdict.path);
      res.writeHead(200, { "content-type": verdict.type, "x-content-type-options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (err) {
      // Both causes stay distinct: "no such file" and "could not be read" are different
      // faults, and collapsing them is this repo's recorded error-masking bug class.
      const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
      const missing = code === "ENOENT";
      res.writeHead(missing ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
      res.end(missing ? `static: not found: ${req.url}\n` : `static: unreadable [${code}]: ${req.url}\n`);
    }
  });
}

/* Importing this module never listens or selects a default garden. */
if (isEntryPoint(import.meta.url)) {
  if ((process.env["FOLIAGE_SITE"] ?? "").trim() === "") {
    console.error("static: FOLIAGE_SITE must explicitly name an exported folder.");
    process.exit(2);
  }
  const ROOT = resolve(process.env["FOLIAGE_SITE"] ?? "");
  const PORT = Number(process.env["PORT"] ?? 4214);
  const HOST = process.env["HOST"] ?? "127.0.0.1";
  const server = createSiteServer(ROOT);
  server.listen(PORT, HOST, () => {
    // `[static] <url>` is the listen acknowledgement the verify supervisor waits for (the
    // export-site row declares label "static"); the folder follows on the same line.
    process.stdout.write(`[static] http://${HOST}:${PORT}/ serving ${ROOT}\n`);
  });
}
