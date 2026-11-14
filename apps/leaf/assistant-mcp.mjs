#!/usr/bin/env node
/** Private stdio transport. The launching owner chooses destinations; tools cannot change them. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();

/** This file by its full path, quoted as a shell word, so the usage line runs as printed from any folder. */
const self = `'${fileURLToPath(import.meta.url).replaceAll("'", "'\\''")}'`;

/** The setup document by its full path, when this copy holds it: an installed copy carries no docs/. */
const setupDoc = () => {
  const doc = fileURLToPath(new URL("../../docs/ASSISTANT-MCP.md", import.meta.url));
  return existsSync(doc) ? `Setup and permission limits: ${doc}\n` : "";
};

try {
  const { values, tokens } = parseArgs({ options: {
    into: { type: "string" }, out: { type: "string" }, help: { type: "boolean" }, "allow-presentation": { type: "boolean" }, "allow-achievements": { type: "boolean" }, "allow-search": { type: "boolean" }, "allow-brain": { type: "boolean" }, "capture-origin": { type: "string" }, "allow-demo-browser": { type: "boolean" },
    "allow-project-test": { type: "boolean" }, "test-repo": { type: "string" }, "test-commit": { type: "string" }, "test-scenario": { type: "string" }, "test-image": { type: "string" },
  }, strict: true, tokens: true });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Duplicate --${token.name} is refused.`);
    seen.add(token.name);
  }
  if (values.help) {
    process.stdout.write(`Foliage assistant connection — local MCP over stdio.

  node ${self} --into <existing leaf.json> --out <harvest.json>

The owner explicitly chooses both paths. Tools cannot select other files.
By default: target context, portfolio import (preview, then import by digest) and selected-observation submission.
Add --allow-presentation to allow revision-bound style edits (typography, spacing, palette, layout, hero, media).
Add --allow-achievements to allow selected retained evidence and private achievement/statement edits.
Add --allow-search to expose read-only search over this garden's private work record.
Add --allow-brain for revision-bound retained-record context, search, reads and relationships.
Add --capture-origin http://127.0.0.1:<port> to allow a local demo capture on that exact origin.
Add --allow-demo-browser with --capture-origin to let the agent inspect page pixels and choose a scene in its own browser.
Add --allow-project-test with --test-repo <absolute path> --test-commit <full SHA> --test-scenario <absolute JSON file> --test-image sha256:<image ID> to expose one bounded local Docker scenario. The agent cannot choose commands or paths; its result enters private Review.
No provider login, approval, publication, or remote HTTP server.
${setupDoc()}`);
  } else {
    if (!values.into?.trim() || !values.out?.trim()) throw new Error("Explicit --into and --out are required; no ambient garden is selected.");
    const { startAssistantMcp } = await import("./src/assistantMcp.ts");
    const captureOrigin = values["capture-origin"] === undefined ? null :
      (await import("./src/assistantCapture.ts")).parseCaptureOrigin(values["capture-origin"]);
    const testRepo = values["test-repo"], testCommit = values["test-commit"];
    const testScenario = values["test-scenario"], testImage = values["test-image"];
    if (values["allow-project-test"] !== true &&
        (testRepo !== undefined || testCommit !== undefined || testScenario !== undefined || testImage !== undefined)) {
      throw new Error("Project test inputs require --allow-project-test.");
    }
    let projectEval = null;
    if (values["allow-project-test"] === true) {
      if (!testRepo?.trim() || !testCommit?.trim() || !testScenario?.trim() || !testImage?.trim()) {
        throw new Error("--allow-project-test requires --test-repo, --test-commit, --test-scenario and --test-image.");
      }
      const { prepareProjectEval } = await import("./src/assistantProjectEval.ts");
      projectEval = await prepareProjectEval({ repo: testRepo, commit: testCommit,
        scenarioFile: testScenario, image: testImage });
    }
    await startAssistantMcp(resolve(values.into.trim()), resolve(values.out.trim()), values["allow-presentation"] === true, values["allow-achievements"] === true, values["allow-search"] === true, values["allow-brain"] === true, captureOrigin, values["allow-demo-browser"] === true, projectEval);
  }
} catch (error) {
  process.stderr.write(`assistant-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
