/**
 * THE ROUTE TABLE, as data, decided without touching a socket.
 *
 * The dashboard is ONE process on ONE port composing two existing surfaces, so routing is
 * the whole of the composition and is the part most worth pinning in a test. Keeping it as a
 * pure `(method, pathname) -> Route` function means the interesting cases — a POST to a GET
 * route, a font name with a traversal in it, a path that belongs to neither surface — are
 * checked as data rather than by starting a server and hoping.
 *
 * WHY NOT A REVERSE PROXY ONTO THE TWO EXISTING SERVERS. Measured, not assumed: the review
 * server pins `SELF_ORIGIN` to `http://HOST:PORT` of its own process and refuses any
 * state-changing request whose `Origin` is anything else. A front door on a different port
 * therefore turns every Approve, Reject and Promote into a 403. The only way to "fix" that is
 * to rewrite `Origin` at the door — which is the door forging the exact header the check
 * exists to test, and would delete CSRF defence for every request that reaches it. Rejected
 * on security grounds. Composing the render and domain MODULES instead keeps one origin, so
 * the same-origin check keeps meaning what it says.
 *
 * TWO PATHS ARE FIXED BY SOMETHING OUTSIDE THIS FILE. `apps/photosynthesis/src/renderReview.ts`
 * writes `<form action="/decide">` and `<form action="/promote">` as absolute paths, and the
 * review page's CSP carries `form-action 'self'`. Mounting the review at `/review` while
 * accepting its posts at the root is therefore not a preference — it is what the existing,
 * unmodified renderer emits, and moving them would mean rewriting a surface this composition
 * is explicitly not allowed to rewrite.
 */

/** Font file names only — no separators, no dots beyond the extension, nothing to traverse. */
const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;

/** Every asset path the two composed pages actually reference, and nothing else. */
const ASSET_PATHS = [
  "/tokens.css",
  "/roles.css",
  "/controls.css",
  "/workspace-shell.css",
  "/foliage.css",
  "/leaf.css",
  "/review.css",
  "/dashboard.css",
  "/mark-primary.svg",
  "/mark-expressive.svg",
  /* The favicon. It is a fetch (no inline equivalent exists for a favicon), which is why every
     response here carries `img-src 'self'` — same-origin only, no data:, no https:. */
  "/mark-icon.svg",
] as const;

type AssetPath = (typeof ASSET_PATHS)[number];

const ASSET_SET: ReadonlySet<string> = new Set(ASSET_PATHS);

export type Route =
  /** The dashboard's own page: what exists, what does not, and what to run first. */
  | { readonly kind: "home" }
  /** The leaf, rendered by `@foliage/leaf-app`'s own renderer. Read-only. */
  | { readonly kind: "leaf" }
  /** The review queue, rendered by `@foliage/photosynthesis-app`'s own renderer. */
  | { readonly kind: "review" }
  /** One approve/reject. Path fixed by the review renderer's form action. */
  | { readonly kind: "decide" }
  /** Promote every approved-but-unpromoted candidate. Same. */
  | { readonly kind: "promote" }
  | { readonly kind: "asset"; readonly path: AssetPath }
  | { readonly kind: "font"; readonly name: string }
  /** A `/fonts/...` request whose name is not a plain font file name. 403, never a read. */
  | { readonly kind: "forbidden"; readonly detail: string }
  | { readonly kind: "method-not-allowed"; readonly allow: string }
  | { readonly kind: "not-found" };

/**
 * Resolve one request to a route.
 *
 * `pathname` must already be decoded and normalised by the caller (the server does it via
 * `new URL(...).pathname` + `decodeURIComponent`), because a route table that also owns
 * percent-decoding is a route table with two jobs and one of them is a security control.
 *
 * Complexity: O(1) — a set lookup and a regex over a bounded name. Routing is on the hot
 * path of every asset request, so it stays a lookup rather than an ordered scan of patterns.
 */
export function resolveRoute(method: string, pathname: string): Route {
  const isGet = method === "GET" || method === "HEAD";

  // The two mutating paths first: they are POST-only, and a GET to one of them is a wrong
  // METHOD rather than a missing page. Answering 404 there would send someone hunting for a
  // route that is right in front of them.
  if (pathname === "/decide" || pathname === "/promote") {
    if (method === "POST") return { kind: pathname === "/decide" ? "decide" : "promote" };
    return { kind: "method-not-allowed", allow: "POST" };
  }

  if (!isGet) return { kind: "method-not-allowed", allow: "GET, HEAD" };

  if (pathname === "/") return { kind: "home" };
  if (pathname === "/leaf") return { kind: "leaf" };
  if (pathname === "/review") return { kind: "review" };

  if (ASSET_SET.has(pathname)) return { kind: "asset", path: pathname as AssetPath };

  if (pathname.startsWith("/fonts/")) {
    const name = pathname.slice("/fonts/".length);
    if (!FONT_NAME.test(name)) {
      return {
        kind: "forbidden",
        detail: `${JSON.stringify(name)} is not a font file name`,
      };
    }
    return { kind: "font", name };
  }

  return { kind: "not-found" };
}
