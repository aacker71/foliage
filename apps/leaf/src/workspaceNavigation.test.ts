import test from "node:test";
import assert from "node:assert/strict";
import { workspaceHeader } from "@foliage/ui";
import { workspaceNavigation } from "./workspaceNavigation.ts";

test("the personal shell puts the core loop in order and keeps only other tools in More", () => {
  const expected = [
    ["Home", "/"],
    ["Work", "/leaf/photosynthesis"],
    ["Review", "/review"],
    ["Portfolio", "/leaf"],
    ["Sources", "/workflow#sources"],
  ];
  for (const current of ["overview", "work", "review", "leaf", "workflow", "scarlet", "import", "policy", "publish", "garden"]) {
    const nav = workspaceNavigation(current);
    assert.deepEqual(nav.links.map(({ label, href }) => [label, href]), expected);
    assert.equal(nav.links.filter(({ current }) => current).length,
      ["overview", "work", "review", "leaf", "workflow"].includes(current) ? 1 : 0);
    const html = workspaceHeader(nav);
    const menus = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map((match) => match[0]);
    const hrefs = menus.flatMap((menu) => [...menu.matchAll(/<a(?: class="[^"]*")? href="([^"]+)"/g)].map((match) => match[1]));
    assert.equal(hrefs.length, new Set(hrefs).size, `${current} must not duplicate a route`);
    assert.ok(!nav.tools.some(({ current: selected }) => selected), "More contains only other pages");
  }
  assert.deepEqual(workspaceNavigation("work").tools.map(({ label }) => label),
    ["Scarlet", "Reflection", "Photosynthesis", "Import", "Policy", "Publish", "Harvest log"]);
  assert.deepEqual(workspaceNavigation("scarlet").tools.map(({ label }) => label),
    ["Scarlet", "Reflection", "Import", "Policy", "Publish", "Harvest log"]);
  assert.match(workspaceHeader(workspaceNavigation("journey")),
    /<summary aria-current="page" aria-label="More tools; current page Scarlet">More<\/summary>/,
    "a page under More still shows its current location while omitting its own menu link");
  assert.deepEqual(workspaceNavigation("leaf").action,
    { label: "Edit portfolio", href: "/leaf/setup" });
  assert.equal(workspaceNavigation("portfolio").action, undefined,
    "the setup editor already has the Portfolio reader in primary navigation");
});

test("every page has a way back to Home at /, and only / marks it current", () => {
  for (const current of ["overview", "work", "review", "leaf", "portfolio", "workflow", "journey", "reflection", "scarlet", "import", "policy", "publish", "garden"]) {
    const html = workspaceHeader(workspaceNavigation(current));
    assert.match(html, /<a class="fol-workspace-brand" href="\/">/, `${current}: the wordmark returns Home`);
    const primary = /<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const first = /<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/.exec(primary);
    assert.deepEqual([first?.[1], first?.[3]], ["/", "Home"], `${current}: Home leads the rail`);
    assert.equal(first?.[2] !== undefined, current === "overview", `${current}: Home is current only on /`);
  }
});
