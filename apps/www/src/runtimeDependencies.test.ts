/**
 * NO COMMAND-LINE TOOL IS A RUNTIME DEPENDENCY OF THE WEBSITE.
 *
 * WHY THIS IS A TEST. `shadcn init` writes the shadcn CLI into `dependencies`, because the
 * stylesheet it generates imports `shadcn/tailwind.css`. That is how the CLI, with its MCP SDK,
 * express and undici, landed in the production tree, where `pnpm audit --prod` reported a critical
 * advisory among them. Tailwind inlines that stylesheet at build time, so shadcn is a build tool
 * like `tailwindcss` and belongs in `devDependencies`. The next `shadcn add` can quietly put it back.
 *
 * A package that installs a command is presumed to be a tool. The few runtime libraries that also
 * ship one are listed below with the reason they stay.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Manifest = { dependencies?: Record<string, string>; bin?: unknown };

const WWW = new URL("../", import.meta.url);
const manifest = (path: string): Manifest => JSON.parse(readFileSync(new URL(path, WWW), "utf8"));
const installed = (name: string): Manifest => manifest(`node_modules/${name}/package.json`);

const RUNTIME_WITH_A_COMMAND: Readonly<Record<string, string>> = {
  next: "the framework that builds and serves the site",
  cn: "class-name merging imported by lib/utils.ts; the command it also installs is never run",
};

test("every website dependency that installs a command is a reviewed runtime library", () => {
  const runtime = Object.keys(manifest("package.json").dependencies ?? {});
  const commands = runtime.filter((name) => installed(name).bin !== undefined);
  const tools = commands.filter((name) => !(name in RUNTIME_WITH_A_COMMAND));
  assert.deepEqual(tools, [], `command-line tools belong in devDependencies: ${tools.join(", ")}`);
  // The list stays exact: an entry for a package that left `dependencies` is removed, not kept.
  assert.deepEqual(commands.sort(), Object.keys(RUNTIME_WITH_A_COMMAND).sort());
});
