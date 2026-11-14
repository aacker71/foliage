/**
 * File boundary for the pure Photosynthesis search. The selected paths never come from a query.
 *
 * `foliage search` and `foliage_search` (unit 38, build order item 6). The record is read once, its
 * Leaf identity and its harvest's binding are checked on those bytes, and the answer is Foliage's
 * own search over `brainRecords` of them: an excluded leaflet is its title and reason only, and
 * anything resting on material about someone else stays out. `retrieval` names the engine that
 * answered (`foliage keyword`) and `because` says why the brain did not.
 *
 * KEYWORD-MODE READS SKIP THE BRAIN (owner decision 3, 2026-10-12). The garden's brain sits beside
 * this search (decision 2), but in keyword mode it finds nothing Foliage's own search does not (the
 * spec says so) and only reorders the first hits, at about 0.75 s and one bun and gbrain process per
 * search (measured in #207 on a synthetic garden: `foliage search` 224 ms without it and 1006 ms
 * through it, `foliage_search` 8 ms and 764 ms). So while local embeddings are off, the default,
 * these two surfaces answer from Foliage's own search and start no process; the only thing they
 * read under `brain/` is whether the owner turned local embeddings on (`localEmbeddingChoice`: the
 * directory's names and one small file). The brain is still built and kept current
 * (`brainUpkeep.ts`), and `foliage brain search` still reads it.
 *
 * WITH LOCAL EMBEDDINGS ON (build order item 8, `foliage brain embed --local ollama:<model>`), they
 * read the brain beside Foliage's own search, as build order item 6 first did: the record's bytes
 * and their hashes go to `searchRecordThroughBrain` (`localBrain.ts`), which checks that the
 * loopback embedder answers, holds the model and embeds one fixed word at the brain's size before
 * anything starts, lets gbrain fuse its keyword and vector lists (`retrieval: "brain local
 * embedding"`) when the brain was built from exactly these bytes in that mode with every page
 * embedded, and adds Foliage's own matches after gbrain's, so recall never drops;
 * otherwise Foliage's own search answers and `because` names why, the embedder that is not answering
 * among the causes. Both engines search `brainRecords`, so a result never depends on which one
 * answered. The brain is derived data, so turning this on or off needs no migration.
 */
import { lstat } from "node:fs/promises";
import { gardenSearchRecords, parseHarvestDocument, searchRecords, type BrainHit, type HarvestDocument } from "@foliage/photosynthesis";
import type { SearchRecord } from "@foliage/photosynthesis/search";
import { BRAIN_VENDOR, brainGardenOf } from "./brainUpkeep.ts";
import { BrainVendorError, readVendorManifest } from "./brainVendor.ts";
import { IMPORT_DOCUMENT_BYTES } from "./integrationImport.ts";
import { boundedIntegrationBytes, integrationJson, integrationTarget, integrationText } from "./integrationStore.ts";
import { brainLine, foliageAnswer, localEmbeddingChoice, searchRecordThroughBrain, sha256, type BrainSearch, type GardenRecord } from "./localBrain.ts";

type Subject = { readonly leafId: string; readonly name: string };

/** The selected record, read once: its subject, both documents, and the hashes of the bytes they were parsed from. */
async function selectedGarden(
  into: string,
  out: string,
  expected?: Subject,
): Promise<(GardenRecord & { readonly subject: Subject }) | null> {
  if (into === out) throw new Error("The leaf and harvest must be different files.");
  let leafBytes: Buffer;
  try { leafBytes = await boundedIntegrationBytes(into, IMPORT_DOCUMENT_BYTES); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    // An active assistant connection is bound to one real Leaf. Its disappearance is never
    // presented as an empty answer that an agent could mistake for an authoritative search.
    if (expected) throw new Error("Selected Leaf is unavailable. Restart the connection.");
    // A first-run CLI garden has neither document. If review data remains, losing the Leaf
    // is a broken record, not a clean start; do not hide it behind an empty search result.
    let harvestAbsent = false;
    try { await lstat(out); }
    catch (harvestError) {
      if (!(harvestError && typeof harvestError === "object" && "code" in harvestError && harvestError.code === "ENOENT")) throw harvestError;
      harvestAbsent = true;
    }
    if (!harvestAbsent) throw new Error("The Leaf is missing while review data remains; search refused.");
    return null;
  }
  const leaf = integrationTarget(integrationText(leafBytes));
  if (expected && (leaf.id !== expected.leafId || leaf.subject !== expected.name)) {
    throw new Error("Selected Leaf identity changed. Restart the connection.");
  }
  let harvest: HarvestDocument | null = null, harvestSha256: string | null = null;
  try {
    const harvestBytes = await boundedIntegrationBytes(out, IMPORT_DOCUMENT_BYTES);
    const parsed = parseHarvestDocument(integrationJson(integrationText(harvestBytes), "Selected harvest"));
    if (!parsed.ok) throw new Error("Selected harvest is invalid; private search refused.");
    harvest = parsed.harvest;
    harvestSha256 = sha256(harvestBytes);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  return { subject: { leafId: leaf.id, name: leaf.subject }, leaf, harvest, leafSha256: sha256(leafBytes), harvestSha256 };
}

/**
 * The remote session selects exact record IDs before ranking, so ungranted text cannot influence a
 * result. It ranks today's records with Foliage's own search and never reads the local brain.
 */
export async function readLocalSearchRecords(
  into: string, out: string, expected: Subject,
): Promise<{ readonly subject: Subject; readonly records: readonly SearchRecord[] }> {
  const selected = await selectedGarden(into, out, expected);
  if (!selected) throw new Error("Selected Leaf is unavailable. Restart the connection.");
  return { subject: selected.subject, records: gardenSearchRecords(selected) };
}

/**
 * Why Foliage's own search answered a garden's `foliage search` or `foliage_search`: keyword mode,
 * the default until the owner turns local embeddings on. Plain words, since an agent may show it as is.
 */
const KEYWORD_MODE = "Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain";
/**
 * Why, when no brain is installed: this copy has no `vendor/` (an install made without the brain that
 * comes in the Foliage download, or a checkout that never staged it). Keyword mode would be the wrong reason: turning
 * local embeddings on would change nothing without a brain.
 */
const NOT_INSTALLED = "No brain is installed: Foliage's own search answers here";

/** Whether a brain runtime is installed at `vendor`: its staging record is there. "Not installed" as `foliage brain status` reads it. */
async function brainInstalled(vendor: string): Promise<boolean> {
  try { await readVendorManifest(vendor); return true; }
  catch (error) { return !(error instanceof BrainVendorError && error.missing); }
}

export interface LocalSearchOptions {
  /** The staged brain runtime; this checkout's `vendor/` by default. */
  readonly vendor?: string;
  /**
   * For a command that ends once it answers (`foliage search`): this garden's refresh in its own
   * detached process, so a search behind its record waits for it only up to the bound and the
   * command can exit. A process that stays up (the MCP server) leaves it out and refreshes in process.
   */
  readonly refreshElsewhere?: (garden: string) => Promise<unknown>;
}

/**
 * `foliage search` and `foliage_search`. The Leaf identity and the harvest's binding are checked
 * on the bytes read once, and the answer comes from those bytes. With no brain installed, it is
 * Foliage's own search, saying so. With local embeddings off (the
 * default), it is Foliage's own search, saying keyword mode is why; with them on, the garden's brain
 * answers when it was built from these bytes and its embedder answers, otherwise Foliage's own
 * search, saying why. A pair of documents that is not a garden's `leaf.json` and `harvest.json` has
 * no brain at all (`Brain: off`).
 */
export async function searchLocalGarden(
  into: string,
  out: string,
  query: string,
  limit = 8,
  expected?: Subject,
  options: LocalSearchOptions = {},
): Promise<BrainSearch | { readonly state: "no-record"; readonly hits: readonly BrainHit[] }> {
  const selected = await selectedGarden(into, out, expected);
  searchRecords([], query, { limit }); // Checked before anything is answered, even for a first-run empty garden.
  if (!selected) return { state: "no-record", hits: [] };
  const garden = brainGardenOf(into, out);
  if (garden === null) return foliageAnswer(selected, query, limit, brainLine({ state: "off" }));
  const vendor = options.vendor ?? BRAIN_VENDOR;
  if (!(await brainInstalled(vendor))) return foliageAnswer(selected, query, limit, NOT_INSTALLED);
  if ((await localEmbeddingChoice(garden)).state === "off") return foliageAnswer(selected, query, limit, KEYWORD_MODE);
  const { refreshElsewhere } = options;
  return searchRecordThroughBrain({ garden, vendor,
    ...(refreshElsewhere === undefined ? {} : { refreshElsewhere: () => refreshElsewhere(garden) }) }, selected, query, limit);
}
