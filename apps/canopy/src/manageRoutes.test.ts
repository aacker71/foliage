import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveManageRoute } from "./manageRoutes.ts";

test("the manager exposes one read route and two POST-only decisions", () => {
  assert.deepEqual(resolveManageRoute("GET", "/"), { kind: "home" });
  assert.deepEqual(resolveManageRoute("POST", "/publish"), { kind: "publish" });
  assert.deepEqual(resolveManageRoute("POST", "/withdraw"), { kind: "withdraw" });
  assert.deepEqual(resolveManageRoute("GET", "/publish"), {
    kind: "method-not-allowed",
    allow: "POST",
  });
  assert.deepEqual(resolveManageRoute("DELETE", "/"), {
    kind: "method-not-allowed",
    allow: "GET, HEAD",
  });
});

test("font traversal is refused before a path is computed", () => {
  assert.deepEqual(resolveManageRoute("GET", "/fonts/jbmono-400.woff2"), {
    kind: "font",
    name: "jbmono-400.woff2",
  });
  assert.deepEqual(resolveManageRoute("GET", "/fonts/../leaf.json"), { kind: "forbidden" });
  assert.deepEqual(resolveManageRoute("GET", "/fonts/%2e%2e%2fleaf.json"), {
    kind: "forbidden",
  });
});

test("the private preview can load its package-owned portfolio assets", () => {
  assert.deepEqual(resolveManageRoute("GET", "/portfolio-leaf.css"), { kind: "asset", path: "/portfolio-leaf.css" });
  assert.deepEqual(resolveManageRoute("HEAD", "/portfolio-leaf.bundle.js"), { kind: "portfolio-bundle" });
  assert.deepEqual(resolveManageRoute("POST", "/portfolio-leaf.bundle.js"), { kind: "method-not-allowed", allow: "GET, HEAD" });
});
