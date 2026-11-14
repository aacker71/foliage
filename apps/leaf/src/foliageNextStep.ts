/**
 * The next step a document-writing CLI prints, as the `foliage` command the quickstart teaches.
 *
 * `intake.mjs` and `harvest.mjs` run inside `foliage grow` and `foliage review --resume`, and used
 * to print `node apps/leaf/…` scripts that only run from the checkout root. A document where a
 * garden keeps it (`<dir>/leaf.json`, `<dir>/harvest.json`) is that garden's, so the step is
 * `foliage up|review --garden <dir>`, quoted like foliage.mjs's own steps so it runs from any
 * directory. Any other path returns null: no `foliage` command addresses it, and the caller keeps
 * its lower-level step. The checkout's own apps/leaf documents are the bare server's defaults,
 * not a garden — `up --garden` there would point workflow and hosted state into the checkout.
 */
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const APP_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
/** The garden document each command reads (foliage.mjs LEAF and HARVEST). */
const GARDEN_FILE = { up: "leaf.json", review: "harvest.json" } as const;

const shellWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

export function foliageNextStep(command: keyof typeof GARDEN_FILE, document: string): string | null {
  const path = resolve(document);
  const garden = dirname(path);
  if (basename(path) !== GARDEN_FILE[command] || garden === APP_DIR) return null;
  return [process.execPath, LAUNCHER, command, "--garden", garden].map(shellWord).join(" ");
}
