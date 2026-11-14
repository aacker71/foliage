/**
 * ONE OPERATOR LINE PER FAILED HOSTED REQUEST, and nothing the person sent.
 *
 * A request that ends in a 5xx must leave a trace an operator can find, and give the person a
 * reference they can quote to support. The line names the route TEMPLATE (subject ids, operation
 * ids and digests become `:id`), the method, the error's class and code, a scrubbed and bounded
 * message, and code-location frames. It never reads the request body, cookies, headers or query
 * string. The message is scrubbed as well, because some runtime errors quote their input.
 */
import { randomUUID } from "node:crypto";

/** Literal route words. Any other path segment may be a person's address or an id. */
const ROUTE_WORDS = new Set([
  "api", "auth", "manage", "leaf", "leaflet", "operations", "settings", "notifications", "recruiting", "distribution",
  "internal", "run", "session", "refresh", "device", "disconnect", "sources", "observations", "subjects", "connect",
  "import", "start", "preview", "publish", "withdraw", "share", "search", "send", "cancel", "reconcile", "accounts",
  "portfolios", "deliveries", "media", "video", "mcp", "search.json", "document.json", "resume", "resume.md",
  "resume.json", "resume.docx", "sign-in", "sign-up", "recovery", "callback", "password", "sign-out", "fonts", "healthz",
]);

/** @param {string} target a path or URL; only its pathname is read */
function routeTemplate(target) {
  let pathname;
  try { pathname = new URL(target, "http://route.invalid").pathname; } catch { return "(unparsed)"; }
  return pathname.split("/").map((segment, index) => index === 0 || segment === "" || ROUTE_WORDS.has(segment) ? segment : ":id").join("/");
}

/** @param {string} text */
function scrub(text) {
  return text
    .replace(/eyJ[\w-]*\.[\w-]*\.[\w-]*/g, "[token]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]")
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_\w+/g, "[key]")
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(\b[a-z][\w+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, "$1?[query]")
    .slice(0, 300);
}

/** @param {unknown} value */
function errorCode(value) {
  const code = value && typeof value === "object" && "code" in value ? value.code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : undefined;
}

/**
 * @param {{ layer: "router" | "session" | "adapter" | "health", method: string, target: string, status: number, error: unknown }} failure
 * @returns {string} the reference the response shows, equal to the logged `requestId`
 */
export function logRequestFailure(failure) {
  const requestId = randomUUID(), error = failure.error instanceof Error ? failure.error : undefined;
  /** @type {string[]} */
  const causes = [];
  for (let cause = error?.cause, depth = 0; cause instanceof Error && depth < 3; cause = cause.cause, depth++) {
    const code = errorCode(cause), name = scrub(cause.name).slice(0, 64);
    causes.push(code ? `${name}:${code}` : name);
  }
  const code = errorCode(error);
  console.error(JSON.stringify({ event: "canopy.hosted.request_failed", requestId, layer: failure.layer,
    method: /^[A-Z]{1,16}$/.test(failure.method) ? failure.method : "OTHER", route: routeTemplate(failure.target), status: failure.status,
    error: { name: error ? scrub(error.name).slice(0, 64) : typeof failure.error, ...(code ? { code } : {}), message: error ? scrub(error.message) : "",
      stack: (error?.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 12).map(line => scrub(line.trim())),
      ...(causes.length ? { causes } : {}) } }));
  return requestId;
}
