/** The private Canopy Cloud control surface. Routing stays pure so method refusals are testable. */

export const MANAGE_ASSET_PATHS = [
  "/foliage-tokens.css",
  "/canopy-tokens.css",
  "/canopy-base.css",
  "/manage.css",
  "/controls.css",
  "/workspace-shell.css",
  "/foliage.css",
  "/roles.css",
  "/published.css",
  "/portfolio-leaf.css",
  "/workspace.js",
  "/workspace.css",
  "/mark-primary.svg",
  "/mark-icon.svg",
] as const;

type ManageAssetPath = (typeof MANAGE_ASSET_PATHS)[number];

const ASSETS: ReadonlySet<string> = new Set(MANAGE_ASSET_PATHS);
const FONT_NAME = /^[a-z0-9][a-z0-9-]*\.woff2$/;

export type ManageRoute =
  | { readonly kind: "home" }
  | { readonly kind: "workspace" }
  | { readonly kind: "workspace-state" }
  | { readonly kind: "hosted" }
  | { readonly kind: "hosted-preview" }
  | { readonly kind: "hosted-action"; readonly action: string }
  | { readonly kind: "ladybug" }
  | { readonly kind: "assessment-releases" }
  | { readonly kind: "ladybug-action"; readonly action: "save" | "assess" | "release" | "withdraw" | "import" | "suggestion" }
  | { readonly kind: "publish" }
  | { readonly kind: "withdraw" }
  | { readonly kind: "asset"; readonly path: ManageAssetPath }
  | { readonly kind: "portfolio-bundle" }
  | { readonly kind: "font"; readonly name: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "method-not-allowed"; readonly allow: string }
  | { readonly kind: "not-found" };

export function resolveManageRoute(method: string, pathname: string): ManageRoute {
  const hosted = /^\/hosted\/(connect|disconnect|prepare|publish|withdraw|recover|refresh)$/.exec(pathname)?.[1];
  if (hosted) return method === "POST" ? { kind: "hosted-action", action: hosted } : { kind: "method-not-allowed", allow: "POST" };
  const action = /^\/ladybug\/(save|assess|release|withdraw|import|suggestion)$/.exec(pathname)?.[1];
  if (action) return method === "POST"
    ? { kind: "ladybug-action", action: action as "save" | "assess" | "release" | "withdraw" | "import" | "suggestion" }
    : { kind: "method-not-allowed", allow: "POST" };
  if (pathname === "/publish" || pathname === "/withdraw") {
    if (method === "POST") return { kind: pathname === "/publish" ? "publish" : "withdraw" };
    return { kind: "method-not-allowed", allow: "POST" };
  }

  if (method !== "GET" && method !== "HEAD") {
    return { kind: "method-not-allowed", allow: "GET, HEAD" };
  }
  if (pathname === "/") return { kind: "home" };
  if (pathname === "/workspace") return { kind: "workspace" };
  if (pathname === "/workspace/state") return { kind: "workspace-state" };
  if (pathname === "/hosted/preview") return { kind: "hosted-preview" };
  if (pathname === "/hosted") return { kind: "hosted" };
  if (pathname === "/ladybug") return { kind: "ladybug" };
  if (pathname === "/ladybug/releases") return { kind: "assessment-releases" };
  if (pathname === "/portfolio-leaf.bundle.js") return { kind: "portfolio-bundle" };
  if (ASSETS.has(pathname)) return { kind: "asset", path: pathname as ManageAssetPath };
  if (pathname.startsWith("/fonts/")) {
    const name = pathname.slice("/fonts/".length);
    return FONT_NAME.test(name) ? { kind: "font", name } : { kind: "forbidden" };
  }
  return { kind: "not-found" };
}
