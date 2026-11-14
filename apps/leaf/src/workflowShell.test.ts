/** Guard the shared shell selector contract across the Leaf bundle and Foliage UI package. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderWorkflowUnavailablePage } from "./workflowUnavailablePage.ts";

test("Workflow mounts WorkspaceHeader inside the shared workspace style scope", async () => {
  const [app, build, shell] = await Promise.all([
    readFile(new URL("../workflow-ui/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../workflow-ui/build.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/ui/src/workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /<WorkspaceHeader\b/);
  assert.match(build, /@foliage\/ui\/workspace\.css/);
  assert.match(shell, /\.fol-app \.fol-workspace\[data-layout=rail\]/);
  const root = app.match(/<div className="([^"]*\bapp-shell\b[^"]*)">/);
  assert.ok(root, "Workflow's root shell must remain explicit");
  assert.ok(root[1]!.split(/\s+/).includes("fol-app"), "the rail styles require the fol-app scope");
});

test("the page the Sources nav item opens says Sources, with or without its bundle", async () => {
  const app = await readFile(new URL("../workflow-ui/app.tsx", import.meta.url), "utf8");
  assert.match(app, /<h1 tabIndex=\{-1\}>Sources<\/h1>/);
  const recovery = renderWorkflowUnavailablePage();
  assert.match(recovery, /<title>Sources unavailable · Foliage<\/title>/);
  assert.match(recovery, /<h1>Sources<\/h1>/);
  assert.match(recovery, /<a href="\/workflow#sources" aria-current="page">Sources<\/a>/);
  assert.match(recovery, /<a class="fol-workspace-brand" href="\/">/, "the wordmark returns Home");
});

test("a failed Sources read shows its status or browser error only under Technical details", async () => {
  const app = await readFile(new URL("../workflow-ui/app.tsx", import.meta.url), "utf8");
  const markup = app.slice(app.search(/\n\s*return \(\n/));
  const uses = [...markup.matchAll(/\breadTechnical\b/g)].map(match => match.index!);
  assert.ok(uses.length > 0, "the technical part is rendered");
  for (const use of uses) {
    const disclosure = markup.lastIndexOf("<summary>Technical details</summary>", use);
    assert.ok(disclosure > 0 && markup.indexOf("</details>", disclosure) > use, "only inside the Technical details disclosure");
  }
});

test("Collect now says why it is unavailable: it needs a saved rhythm that is not paused", async () => {
  const app = await readFile(new URL("../workflow-ui/app.tsx", import.meta.url), "utf8");
  const panel = app.slice(app.indexOf("<h2>Collect</h2>"), app.indexOf("Collect now"));
  // The button's own rule (the server refuses a manual run without a running schedule) ...
  assert.match(panel, /disabled=\{busy \|\| !data\.schedule \|\| data\.schedule\.paused\}/);
  // ... is said beside it, in the panel the person is looking at.
  assert.match(panel, /!data\.schedule \? "Save a rhythm to collect" : data\.schedule\.paused \? "Paused · resume to collect"/);
});
