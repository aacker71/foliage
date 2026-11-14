/** Vercel/Node entry point. Importing this module never starts a server or reads authority. */
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { logRequestFailure } from "./src/requestFailure.mjs";

/**
 * @param {(request: Request) => Promise<Response>} app
 * @param {string} appOrigin configured HTTPS origin; proxy headers cannot replace it
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createNodeHandler(app, appOrigin) {
  return async (req, res) => {
    try {
      const seen = new Set();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]?.toLowerCase();
        if (!name) continue;
        if (!["authorization", "origin", "host", "content-length", "content-type"].includes(name)) continue;
        if (seen.has(name)) { res.writeHead(400, { "cache-control": "no-store" }); res.end("Ambiguous request headers."); return; }
        seen.add(name);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(name === "cookie" ? "; " : ", ") : value);
      }
      const controller = new AbortController();
      req.once("aborted", () => controller.abort());
      req.setTimeout(15_000, () => req.destroy());
      const method = req.method ?? "GET";
      /** @type {RequestInit} */
      const init = { method, headers, signal: controller.signal, ...(method === "GET" || method === "HEAD" ? {} : { body: Readable.toWeb(req), duplex: "half" }) };
      const response = await app(new Request(new URL(req.url ?? "/", appOrigin), init));
      res.statusCode = response.status;
      for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            if (!res.write(next.value)) await once(res, "drain");
          }
        } finally { reader.releaseLock(); }
      }
      res.end();
    } catch (error) {
      // One operator line per failure; never request bodies, cookies, headers or query strings.
      const reference = logRequestFailure({ layer: "adapter", method: req.method ?? "GET", target: req.url ?? "/", status: 503, error });
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(503, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "x-request-id": reference });
      res.end(`The hosted request could not be completed. Check any pending decision before retrying. Reference: ${reference}.`);
    }
  };
}

const PUBLIC_ASSETS = new Set(["canopy-base.css", "canopy-tokens.css", "manage.css", "hosted-workspace.css", "published.css", "resume.css", "resume.mjs", "specimen-sheet-day.jpg"]);
/** @param {string} path */
export async function loadAsset(path) {
  const name = path.slice(1);
  let file;
  if (name === "portfolio-leaf.bundle.js") {
    const { checkPortfolioLeafBundle } = await import("@foliage/ui/portfolio-leaf-bundle");
    const bundle = await checkPortfolioLeafBundle();
    if (!bundle.ok) return null;
    file = bundle.path;
  }
  else if (name === "workspace-shell.css") file = fileURLToPath(import.meta.resolve("@foliage/ui/workspace.css"));
  else if (name === "controls.css" || name === "portfolio-leaf.css") file = fileURLToPath(import.meta.resolve(`@foliage/ui/${name}`));
  else if (PUBLIC_ASSETS.has(name)) file = fileURLToPath(new URL(`./public/${name}`, import.meta.url));
  else if (["foliage-tokens.css", "roles.css", "foliage.css", "mark-primary.svg", "mark-icon.svg", "mark-expressive.svg"].includes(name) || /^fonts\/[a-z0-9._-]+\.woff2$/.test(name)) {
    file = fileURLToPath(import.meta.resolve(`@foliage/tokens/${name === "foliage-tokens.css" ? "tokens.css" : name}`));
  } else return null;
  let bytes;
  // An allowlisted name with no file (a scanner's /fonts/x.woff2) is absent, not an outage.
  try { bytes = await readFile(file); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null; throw error; }
  return { bytes, contentType: /\.m?js$/.test(name) ? "text/javascript; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".jpg") ? "image/jpeg" : "font/woff2" };
}
/** @type {ReturnType<typeof createNodeHandler> | undefined} */
let handler;
let lastInitializationFailure = "";
const novuFields = ["NOVU_API_URL", "NOVU_API_KEY", "NOVU_ENVIRONMENT_ID", "NOVU_WORKER_SECRET", "NOVU_INBOX_WORKFLOW_ID", "NOVU_EMAIL_WORKFLOW_ID", "NOVU_SMS_WORKFLOW_ID"];
const hostedUnavailableHtml = `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canopy unavailable · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/foliage-tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/workspace-shell.css"><link rel="stylesheet" href="/hosted-workspace.css"></head><body class="fol-app hosted-account"><main id="main"><div class="hosted-brand"><span class="fol-workspace-mark" aria-hidden="true"></span>Foliage</div><h1>Canopy is unavailable</h1><p>Try again later.</p><a class="fol-button fol-button-outline" href="">Retry</a></main></body></html>`;
/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
export default async function hostedHandler(req, res) {
  let stage = "configuration";
  /** @type {string[]} */
  let missing = [];
  try {
    if (!handler) {
      const notificationsEnabled = novuFields.some(name => process.env[name] !== undefined);
      missing = ["FOLIAGE_APP_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY",
        ...(notificationsEnabled ? novuFields.slice(0, 4) : []),
      ].filter(name => !process.env[name]?.trim());
      if (missing.length) throw new Error("Hosted configuration is incomplete.");
      /** @param {string} name */
      const required = (name) => { const value = process.env[name]; if (!value) throw new Error("Hosted configuration is incomplete."); return value; };
      const appOrigin = required("FOLIAGE_APP_ORIGIN"), supabaseUrl = required("SUPABASE_URL");
      stage = "runtime-imports";
      const [{ createHostedApp }, { createClerkIdentity, withClerk }, { createHostedStore }, { createHostedGitHubProof }, { searchPublished }] = await Promise.all([
        import("./src/hostedApp.ts"), Promise.all([import("./src/clerkIdentity.ts"), import("./src/clerkApp.ts")]).then(([identity, app]) => ({ ...identity, ...app })), import("./src/hostedStore.ts"), import("./src/hostedGitHubProof.ts"), import("./src/searchPublished.ts"),
      ]);
      stage = "identity-adapter";
      const identity = createClerkIdentity({ supabaseUrl, appOrigin, publishableKey: required("CLERK_PUBLISHABLE_KEY"), secretKey: required("CLERK_SECRET_KEY"), serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY") });
      stage = "storage-adapter";
      const store = createHostedStore({ supabaseUrl, serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"), ...(process.env["FOLIAGE_PUBLICATION_BUCKET"] ? { bucket: process.env["FOLIAGE_PUBLICATION_BUCKET"] } : {}) });
      const verifyPublication = createHostedGitHubProof({ getUser: identity.getVerifiedUser, getVerifiedEmail: identity.getVerifiedEmail });
      if (notificationsEnabled) {
        stage = "notification-adapter";
        throw new Error("Clerk notification contact adapter is not configured.");
      }
      let nango;
      const sourceFields = ["NANGO_SECRET_KEY", "NANGO_INTEGRATION_ID", "NANGO_MODEL", "NANGO_CONNECT_ORIGIN"];
      if (sourceFields.slice(1).some(name => process.env[name] !== undefined)) {
        stage = "source-adapter";
        const { createHostedNango } = await import("./src/hostedNango.ts");
        nango = createHostedNango({ secretKey: required("NANGO_SECRET_KEY"), integrationId: required("NANGO_INTEGRATION_ID"),
          model: required("NANGO_MODEL"), connectOrigin: required("NANGO_CONNECT_ORIGIN") });
      }
      let recruitingConnections;
      if (["MERGE_API_KEY", "MERGE_REGION"].some(name => process.env[name] !== undefined)) {
        stage = "recruiting-connections";
        const { createMergeConnections } = await import("./src/mergeConnections.ts");
        recruitingConnections = createMergeConnections({ apiKey: required("MERGE_API_KEY"), region: required("MERGE_REGION") });
      }
      let distribution;
      if (["NANGO_ASHBY_INTEGRATION_ID", "NANGO_DESTINATION_CONNECT_ORIGIN"].some(name => process.env[name] !== undefined)) {
        stage = "distribution-adapter";
        const [{ createAshbyDistribution }, { createHostedDistribution }] = await Promise.all([
          import("./src/ashbyDistribution.ts"), import("./src/hostedDistribution.ts"),
        ]);
        const adapter = createAshbyDistribution({ secretKey: required("NANGO_SECRET_KEY"),
          integrationId: required("NANGO_ASHBY_INTEGRATION_ID"), connectOrigin: required("NANGO_DESTINATION_CONNECT_ORIGIN") });
        distribution = createHostedDistribution({ origin: appOrigin, store, receipts: store.distribution, adapter });
      }
      stage = "application";
      handler = createNodeHandler(withClerk({ appOrigin, identity, app: createHostedApp({ clerk: true, device: identity, ...(nango ? { nango } : {}), ...(distribution ? { distribution } : {}), ...(recruitingConnections ? { recruitingConnections } : {}), appOrigin, identity, store, loadAsset, verifyPublication, searchPublished }) }), appOrigin);
      lastInitializationFailure = "";
    }
    stage = "request";
    await handler(req, res);
  } catch {
    // Only controlled labels and setting names reach provider logs: never raw errors,
    // credentials, URLs, request data or portfolio evidence. Bound repeated cold-start failures.
    const diagnostic = JSON.stringify({ event: "canopy.hosted.unavailable", stage, missing,
      recovery: missing.length ? "Configure the missing settings in this deployment environment and redeploy." : "Inspect the named initialization stage in the packaged runtime." });
    if (diagnostic !== lastInitializationFailure) { console.error(diagnostic); lastInitializationFailure = diagnostic; }
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD") {
      // The unavailable page has the same local assets as the hosted shell. Serve only
      // this public allowlist while account/storage initialization is unavailable.
      let path;
      try { path = new URL(req.url ?? "/", "http://localhost").pathname; } catch { /* Keep the failure response. */ }
      if (path) {
        try {
          const asset = await loadAsset(path);
          if (asset) {
            res.writeHead(200, { "cache-control": "no-store", "content-type": asset.contentType, "x-content-type-options": "nosniff" });
            res.end(method === "HEAD" ? undefined : asset.bytes);
            return;
          }
        } catch { /* Missing assets must not turn a configuration failure into a success. */ }
      }
      const machineRoute = path && (/^\/(?:api|device)(?:\/|$)/.test(path) || /(?:\.json|\/mcp)$/.test(path));
      if (!machineRoute && req.headers.accept?.includes("text/html")) {
        res.writeHead(503, { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" });
        res.end(method === "HEAD" ? undefined : hostedUnavailableHtml);
        return;
      }
    }
    res.writeHead(503, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end("Hosted service configuration is unavailable. No local publication fallback is enabled.");
  }
}
