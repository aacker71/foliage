/** Private inventory of addressable published artifacts, independent of the local leaf. */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DOCUMENT_DIGEST, PUBLISHED_ID, documentDigest } from "@foliage/canopy";

import {
  PUBLISHED_ENV,
  PUBLISHED_SUFFIX,
  loadPublishedLeaf,
  publishedUrl,
} from "./publishedLeaf.ts";

interface PublicationInventoryItem {
  readonly id: string;
  readonly artifactDigest: string | null;
  readonly url: string;
  readonly kind: "valid" | "invalid" | "unreadable";
  readonly subject: string | null;
  readonly publishedAt: string | null;
  readonly detail: string | null;
}

export type PublicationInventory =
  | { readonly kind: "unconfigured"; readonly detail: string; readonly items: readonly [] }
  | { readonly kind: "unreadable"; readonly detail: string; readonly items: readonly [] }
  | { readonly kind: "ready"; readonly items: readonly PublicationInventoryItem[] };

export async function loadPublicationInventory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PublicationInventory> {
  const configured = env[PUBLISHED_ENV];
  if (configured === undefined || configured.trim() === "") {
    return { kind: "unconfigured", detail: `${PUBLISHED_ENV} is not configured.`, items: [] };
  }
  const root = resolve(configured.trim());
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    if (code === "ENOENT") return { kind: "ready", items: [] };
    return {
      kind: "unreadable",
      detail: `${root} could not be listed: ${error instanceof Error ? error.message : String(error)} [${code}]`,
      items: [],
    };
  }

  const ids = names
    .filter((name) => name.endsWith(PUBLISHED_SUFFIX))
    .map((name) => name.slice(0, -PUBLISHED_SUFFIX.length))
    .filter((id) => PUBLISHED_ID.test(id))
    .sort();

  const items = await Promise.all(ids.map(async (id): Promise<PublicationInventoryItem> => {
    const loaded = await loadPublishedLeaf(id, env);
    if (loaded.ok) {
      return {
        id,
        artifactDigest: loaded.source.artifactDigest,
        url: publishedUrl(id),
        kind: "valid",
        subject: loaded.document.leaf.subject,
        publishedAt: loaded.document.publishedAt,
        detail: null,
      };
    }
    const path = join(root, `${id}${PUBLISHED_SUFFIX}`);
    try {
      const artifactDigest = documentDigest(await readFile(path));
      if (!DOCUMENT_DIGEST.test(artifactDigest)) throw new Error("computed digest has an invalid shape");
      return {
        id,
        artifactDigest,
        url: publishedUrl(id),
        kind: "invalid",
        subject: null,
        publishedAt: null,
        detail: loaded.detail,
      };
    } catch (error) {
      // The filename is still public state and must stay visible even when its bytes cannot be
      // identified. Withdrawal is disabled because compare-and-delete needs an exact digest.
      return {
        id,
        artifactDigest: null,
        url: publishedUrl(id),
        kind: "unreadable",
        subject: null,
        publishedAt: null,
        detail:
          `${loaded.detail} Its bytes could not be identified for a safe withdrawal: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }));

  return { kind: "ready", items: Object.freeze(items) };
}
