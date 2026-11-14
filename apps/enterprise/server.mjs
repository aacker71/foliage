#!/usr/bin/env node
/**
 * Canopy Enterprise — the org chart and the release decisions attached to it.
 *
 * Port 4176. `FOLIAGE_COMPANY` names the manifest; `FOLIAGE_RELEASE` names the decision
 * store (default ~/.foliage/enterprise/release.json). Loopback only, like everything else here.
 *
 * THE MACHINE DECIDES, ALWAYS. POST /release consults `applyEvent` on every request, so a
 * stale page offering a button that is no longer legal gets a refusal with the machine's
 * own reason rather than a write. The UI only ever renders the events the machine says are
 * available; that is a convenience, not the enforcement.
 *
 * The mutating-surface rules are the ones photosynthesis established, because they were
 * learned the hard way there: a per-process CSRF token in every form, an Origin/Referer
 * check that refuses absent headers, frame-ancestors 'none', serialized read-modify-write,
 * and atomic writes. A release decision is a more consequential thing to forge than a
 * review click, so none of it is optional here.
 */

// Node builtins only: `node:` specifiers always link, on every version, so hoisting them above
// the floor guard is safe. Nothing below this block may be a static `.ts` import — see the
// comment on the guard itself for why that distinction is the whole mechanism.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * THE NODE FLOOR, and the two separate defects this closes (F-011).
 *
 * This file used to read `major < 22 || major >= 25`, which PASSES on 22.17.1 — and 22.17.1 is a
 * version tools/install/requirements.mjs documents as fatal, because unflagged type stripping
 * begins at 22.18.0. A major-only check cannot see the 22.6–22.17 band at all, so the guard
 * admitted exactly the versions it existed to refuse.
 *
 * Worse, the guard was UNREACHABLE on those versions anyway. The three domain modules below were
 * plain STATIC `import ... from "./src/x.ts"` declarations, and a static ESM import is HOISTED and
 * LINKED before any of this module's own code runs. Below the floor the process therefore died
 * during linking with a raw ERR_UNKNOWN_FILE_EXTENSION stack, on a line that executes before the
 * guard's line is ever evaluated. Measured 2026-08-28 with `process.versions.node` stubbed to
 * "22.17.1": this server BOOTED and served. Fixing the comparison alone would have changed
 * nothing; the imports had to become dynamic too.
 *
 * So: the shared, dependency-free preflight (apps/leaf/src/nodeFloor.mjs — exact to the patch, and
 * already used by apps/leaf/server.mjs, intake.mjs, harvest.mjs, apps/photosynthesis/
 * photosynthesis.mjs and apps/canopy/server.mjs), then the `.ts` graph, dynamically. No fourth
 * copy of the version comparison is written here.
 */
// @ts-ignore TS6059 — apps/leaf/src/nodeFloor.mjs is outside this app's tsconfig rootDir; node
// resolves and runs this import correctly, only tsc's rootDir check objects to it. apps/enterprise
// is the enterprise plane depending on apps/leaf (open) — the direction open core intends, and the
// one public-boundary.json permits. (A `@ts-ignore` inside a block comment is NOT honoured by tsc;
// it must be its own line comment immediately above the line, which is why this is split out.)
const { requireNodeFloor } = await import("../leaf/src/nodeFloor.mjs");
requireNodeFloor();

const { loadCompany, httpStatusFor } = await import("./src/companyDocument.ts");
const {
  renderCompanyPage,
  renderCompanyFailure,
  renderMembersPage,
  renderReleasesPage,
  renderReleaseResult,
} = await import("./src/renderCompany.ts");
const { commitRelease, loadStore } = await import("./src/releaseStore.ts");
const { selectReleasePath } = await import("./src/releasePath.ts");
const { boundAuthorities } = await import("@foliage/leaf/bound-authorities");

const PORT = Number(process.env["PORT"] ?? 4176);
const HOST = process.env["HOST"] ?? "127.0.0.1";
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  process.stderr.write("enterprise: PORT must be an integer from 1 to 65535.\n");
  process.exit(2);
}
if (HOST !== "127.0.0.1" && HOST !== "::1") {
  process.stderr.write("enterprise: unauthenticated local workspace may bind only 127.0.0.1 or ::1.\n");
  process.exit(2);
}
const configuredActor = process.env["FOLIAGE_ACTOR"];
if (!["subject", "policy_owner", "system"].includes(configuredActor ?? "")) {
  process.stderr.write("enterprise: explicitly set FOLIAGE_ACTOR to subject, policy_owner or system for this local session. No role was assumed.\n");
  process.exit(2);
}
/** Explicit local role only; this is not hosted authentication or company membership. */
const ACTOR = /** @type {import("@foliage/enterprise-policy").Actor} */ (configuredActor);
const RELEASE_STORE = await selectReleasePath(process.env["FOLIAGE_RELEASE"]);

/*
 * The publish rail a release review applies (`releaseContents`). The company manifest names no
 * member policy, so every review uses the shipped default rails, stated here where review sees
 * it, as the canopy does for a leaf with no policy beside it. The default failing its own parser
 * is a build defect; refusing to start beats a review with no rail.
 */
const { defaultPublishPolicy } = await import("@foliage/leaf");
const parsedDefaultPolicy = defaultPublishPolicy();
if (!parsedDefaultPolicy.ok) {
  process.stderr.write("enterprise: the built-in publish policy did not parse. Nothing was started.\n");
  process.exit(2);
}
const DEFAULT_POLICY = parsedDefaultPolicy.policy;
const { everyLimb, isContentsBound, isReleaseContentsDigest, releaseContents, releaseContentsDigest } =
  await import("@foliage/enterprise-policy");

/**
 * What a release of `leaf` would carry now, as the digest its review renders — `null` when that
 * cannot be established: the company or the leaf no longer loads, or one id names leaves whose
 * contents differ. Read fresh for every decision, because the review that posted it may be stale.
 * @param {string} leaf
 * @returns {Promise<string | null>}
 */
async function currentContentsDigest(leaf) {
  const load = await loadCompany();
  if (!load.ok) return null;
  const digests = new Set(
    everyLimb(load.tree)
      .flatMap((limb) => limb.leaves)
      .filter((candidate) => candidate.id === leaf)
      .map((candidate) => releaseContentsDigest(releaseContents(candidate, DEFAULT_POLICY))),
  );
  return digests.size === 1 ? [...digests][0] ?? null : null;
}

const CSRF_TOKEN = randomUUID();
const SELF_ORIGIN = HOST === "::1" ? `http://[::1]:${PORT}` : `http://${HOST}:${PORT}`;
// Both stylesheets resolve through @foliage/tokens' export map — ONE copy of each in the
// workspace, never a per-app vendored duplicate that drifts. (Adopted from the concurrent
// photosynthesis rework, which moved foliage.css into the package for exactly this reason.)
const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const FOLIAGE_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/foliage.css"));
/** @type {Map<string, [string, string]>} */
const UI_ASSETS = new Map([
  ["/roles.css", [fileURLToPath(import.meta.resolve("@foliage/tokens/roles.css")), "text/css; charset=utf-8"]],
  ["/controls.css", [fileURLToPath(import.meta.resolve("@foliage/ui/controls.css")), "text/css; charset=utf-8"]],
  ["/workspace-shell.css", [fileURLToPath(import.meta.resolve("@foliage/ui/workspace.css")), "text/css; charset=utf-8"]],
  ["/enterprise.css", [fileURLToPath(new URL("./public/enterprise.css", import.meta.url)), "text/css; charset=utf-8"]],
  ["/mark-icon.svg", [fileURLToPath(import.meta.resolve("@foliage/tokens/mark-icon.svg")), "image/svg+xml"]],
]);
const FONTS_DIR = join(dirname(TOKENS_CSS), "fonts");
const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;

/** @param {string | undefined} candidate */
function tokenMatches(candidate) {
  if (typeof candidate !== "string" || candidate.length !== CSRF_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(CSRF_TOKEN));
}

/** @param {import("node:http").IncomingMessage} req */
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

/** @param {import("node:http").ServerResponse} res @param {number} status @param {string} type @param {string | Buffer} body */
function send(res, status, type, body) {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, {
    "content-type": type,
    "content-length": buf.byteLength,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  });
  res.end(buf);
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

/** @type {readonly string[] | null} Memoised: a bound address cannot change while listening. */
let allowedAuthorities = null;

const server = createServer(async (req, res) => {
  // DNS rebinding: Origin and Host agree on a rebound page, so only the bound socket can tell. Refused
  // before routing, on every method, exactly as the Leaf and Canopy reader servers do.
  const allowed = (allowedAuthorities ??= boundAuthorities(server.address(), PORT));
  const authority = (req.headers.host ?? "").toLowerCase();
  if (!allowed.includes(authority)) {
    req.resume();
    send(res, 421, "text/plain; charset=utf-8", `misdirected: Host was ${JSON.stringify(authority)}, and this workspace answers only to ${allowed.join(", ")}. Nothing was served or changed.\n`);
    return;
  }
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  try {
    const asset = req.method === "GET" ? UI_ASSETS.get(url.pathname) : undefined;
    if (asset) { send(res,200,asset[1],await readFile(asset[0]));return; }
    if (req.method === "GET" && url.pathname === "/tokens.css") {
      send(res, 200, "text/css; charset=utf-8", await readFile(TOKENS_CSS, "utf8"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/foliage.css") {
      send(res, 200, "text/css; charset=utf-8", await readFile(FOLIAGE_CSS, "utf8"));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/fonts/")) {
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
      send(res, 200, "font/woff2", await readFile(file));
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      const load = await loadCompany();
      if (!load.ok) {
        send(res, httpStatusFor(load), "text/html; charset=utf-8", renderCompanyFailure(load, "chart"));
        return;
      }
      const store = await loadStore(RELEASE_STORE);
      send(res, 200, "text/html; charset=utf-8", renderCompanyPage(load, store, ACTOR, CSRF_TOKEN, () => DEFAULT_POLICY));
      return;
    }

    if (req.method === "GET" && url.pathname === "/releases") {
      const load = await loadCompany();
      if (!load.ok) {
        send(res, httpStatusFor(load), "text/html; charset=utf-8", renderCompanyFailure(load, "releases"));
        return;
      }
      const store = await loadStore(RELEASE_STORE);
      send(res, 200, "text/html; charset=utf-8", renderReleasesPage(load, store, ACTOR));
      return;
    }

    if (req.method === "GET" && url.pathname === "/members") {
      const load = await loadCompany();
      if (!load.ok) {
        send(res, httpStatusFor(load), "text/html; charset=utf-8", renderCompanyFailure(load, "members"));
        return;
      }
      const store = await loadStore(RELEASE_STORE);
      send(res, 200, "text/html; charset=utf-8", renderMembersPage(load, store, ACTOR));
      return;
    }

    if (req.method === "POST" && url.pathname === "/release") {
      const form = await readForm(req);
      if (!sameOrigin(req) || !tokenMatches(form.get("csrf") ?? undefined)) {
        send(res, 403, "text/html; charset=utf-8", renderReleaseResult("That request did not come from this page. Nothing was changed."));
        return;
      }
      const leaf = form.get("leaf");
      const event = form.get("event");
      if (leaf === null || event === null) {
        send(res, 400, "text/html; charset=utf-8", renderReleaseResult("A release decision needs a leaf and an event."));
        return;
      }
      const operationId = form.get("operationId");
      const expectedHistory = form.get("expectedHistoryLength");
      if (operationId === null || expectedHistory === null || !/^\d+$/.test(expectedHistory)) {
        send(res, 400, "text/html; charset=utf-8", renderReleaseResult("Reload this review to obtain its operation and history version. Nothing was changed."));
        return;
      }
      const releaseEvent = /** @type {import("@foliage/enterprise-policy").ReleaseEvent} */ (event);
      // Approve and publish are about the records the review listed: bind them to that list.
      const reviewed = form.get("contentsDigest");
      const bound = isContentsBound(releaseEvent);
      if (bound && !isReleaseContentsDigest(reviewed)) {
        send(res, 400, "text/html; charset=utf-8", renderReleaseResult("Reload this review to see what this decision would release. Nothing was changed."));
        return;
      }
      const result = await commitRelease(RELEASE_STORE, {
        operationId, leaf, event: releaseEvent,
        actor: ACTOR, at: new Date().toISOString(), expectedHistoryLength: Number(expectedHistory),
        ...(bound && reviewed !== null ? { contents: { reviewed, current: await currentContentsDigest(leaf) } } : {}),
      });
      if (!result.ok) {
        send(res, 409, "text/html; charset=utf-8", renderReleaseResult(result.reason));
        return;
      }
      if (result.warning) {
        send(res, 200, "text/html; charset=utf-8", renderReleaseResult(result.warning, "saved"));
        return;
      }
      res.writeHead(303, { location: "/" }).end();
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", `no route for ${req.method} ${url.pathname}`);
  } catch (err) {
    console.error(`[enterprise] ${url.pathname} failed:`, err);
    const code = err !== null && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === "ELOCALBUSY") {
      send(res, 409, "text/html; charset=utf-8", renderReleaseResult(err instanceof Error ? err.message : String(err)));
    } else {
      send(res, 500, "text/plain; charset=utf-8", `server error: ${err instanceof Error ? err.message : err}`);
    }
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`[enterprise] http://${HOST}:${PORT}/  (acting as ${ACTOR})`);
  const load = await loadCompany();
  console.log(
    `[enterprise] ${
      load.ok
        ? `"${load.tree.company}" — ${load.tree.boughs.length} bough(s)` +
          (load.failures.length > 0 ? `, ${load.failures.length} person FAILED to load` : "")
        : `${load.cause} — ${load.detail}`
    }`,
  );
  console.log(`[enterprise] release decisions: ${RELEASE_STORE}`);
});
