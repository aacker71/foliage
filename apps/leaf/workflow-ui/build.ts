import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const result = await Bun.build({
  entrypoints: [new URL("./app.tsx", import.meta.url).pathname],
  target: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) throw Error(result.logs.join("\n"));
await writeFile(
  new URL("../public/workflow.js", import.meta.url),
  await result.outputs[0].text(),
);
const theme = (await readFile(new URL("./theme.css", import.meta.url), "utf8"))
  .replace(/@import[^;]+;/g, "")
  .replace(/@theme inline\s*\{[^}]*\}/g, "");
const controls = await readFile(
  require.resolve("@foliage/ui/controls.css"),
  "utf8",
);
const layout = await readFile(new URL("./layout.css", import.meta.url), "utf8");
await writeFile(
  new URL("../public/workflow.css", import.meta.url),
  theme +
    "\n" +
    controls +
    "\n" + await readFile(require.resolve("@foliage/ui/action-row.css"), "utf8") +
    "\n" + await readFile(require.resolve("@foliage/ui/empty-state.css"), "utf8") +
    "\n" + await readFile(require.resolve("@foliage/ui/workspace.css"), "utf8") +
    "\n" +
    layout +
    "\n" +
    (await readFile(new URL("./connections.css", import.meta.url), "utf8")),
);
