/**
 * Loading the harvest document from disk, with the causes kept apart.
 *
 * This is `apps/leaf/src/leafDocument.ts` applied to the other file, and the shape is copied
 * on purpose: a discriminated union of one success and five distinct failures, never a null
 * and never an empty document. The failure that discipline exists to prevent is the one this
 * project has already paid for — four different causes collapsing into a zero, after which
 * the product confidently asserts "0 candidates" about a file it never read.
 *
 * `apps/photosynthesis/review-server.mjs` does NOT make this distinction: it throws a single
 * `Error` on any bad parse and answers 500 for all of them, including "you have not run the
 * harvest yet", which is a perfectly healthy first-run state rather than a server fault. The
 * dashboard has to be openable before any data exists, so it needs the split. That is the one
 * behaviour the composition deliberately improves on, and it improves it by ADDING a
 * distinction, never by hiding one.
 *
 * THE SIXTH STATE is the same one the leaf loader calls out: a VALID harvest with an empty
 * `candidates` array. That is `ok: true` with nothing in it — a real, honest, empty result
 * (nothing in the history was attributable to the declared identity, or nothing drafted could
 * be grounded). It must never be reported as "no harvest found", and the renderer says
 * something different for each.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseHarvestDocument,
  type HarvestDocument,
  type HarvestIssue,
} from "@foliage/photosynthesis-app/src/harvestDocument.ts";

/** The one environment variable this reads — same name, same meaning as the review server. */
export const HARVEST_ENV = "FOLIAGE_HARVEST";

/**
 * Where `photosynthesis.mjs` writes by default and where `review-server.mjs` reads by
 * default. Pointed at the same file deliberately: a dashboard that looked somewhere else
 * would report "no harvest" at a path the CLI had just written to, which is a worse lie than
 * no dashboard at all. Gitignored, like every real person's document in this repository.
 */
const DEFAULT_HARVEST_PATH = fileURLToPath(
  new URL("../../photosynthesis/leaf.harvest.json", import.meta.url),
);

interface HarvestSource {
  readonly path: string;
  readonly bytes: number;
  /** ISO-8601 instant at which the bytes were read. */
  readonly readAt: string;
}

export type HarvestLoad =
  | { readonly ok: true; readonly harvest: HarvestDocument; readonly source: HarvestSource }
  | {
      readonly ok: false;
      readonly cause: "unconfigured";
      readonly detail: string;
      readonly path: null;
    }
  | { readonly ok: false; readonly cause: "absent"; readonly detail: string; readonly path: string }
  | {
      readonly ok: false;
      readonly cause: "unreadable";
      readonly detail: string;
      readonly path: string;
      /** The real errno, carried rather than flattened: EACCES and EISDIR are different bugs. */
      readonly errno: string;
    }
  | {
      readonly ok: false;
      readonly cause: "malformed";
      readonly detail: string;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly cause: "invalid";
      readonly detail: string;
      readonly path: string;
      readonly issues: readonly HarvestIssue[];
    };

function errnoOf(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "UNKNOWN";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load and validate the configured harvest document.
 *
 * `env` is injected rather than read from `process.env` inside, so tests point at a real
 * temporary file without mutating global state — the I/O stays real, only the configuration
 * is a parameter. Same contract as `loadLeafDocument`.
 */
export async function loadHarvestDocument(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HarvestLoad> {
  const configured = env[HARVEST_ENV];

  // Set-but-blank is its own cause. Falling back to the default would answer "no harvest at
  // <default>" to someone staring at a FOLIAGE_HARVEST they believe they set.
  if (configured !== undefined && configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail:
        `${HARVEST_ENV} is set but blank, so no harvest path could be determined. Either unset ` +
        `it — the default is then ${DEFAULT_HARVEST_PATH} — or set it to the path of your ` +
        `harvest document.`,
      path: null,
    };
  }

  const path = configured === undefined ? DEFAULT_HARVEST_PATH : resolve(configured.trim());

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") {
      return {
        ok: false,
        cause: "absent",
        detail:
          `No harvest document was found at ${path}` +
          (configured === undefined
            ? ` (the default location — set ${HARVEST_ENV} to use a different path).`
            : ` (from ${HARVEST_ENV}).`),
        path,
      };
    }
    return {
      ok: false,
      cause: "unreadable",
      detail: `${path} exists as far as this process can tell, but could not be read: ${messageOf(err)} [${code}]`,
      path,
      errno: code,
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0 with a message that
  // blames the first token. Same strip as the leaf loader, for the same hour saved.
  const text = bytes.toString("utf8").replace(/^﻿/, "");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      cause: "malformed",
      detail: `${path} is not valid JSON: ${messageOf(err)}`,
      path,
    };
  }

  const parsed = parseHarvestDocument(json);
  if (!parsed.ok) {
    const head = parsed.issues.slice(0, 3).map((i) => i.at);
    const more = parsed.issues.length - head.length;
    const noun = parsed.issues.length === 1 ? "problem" : "problems";
    return {
      ok: false,
      cause: "invalid",
      // The COUNT is exact and the LIST is truncated — stated, so a truncated display can
      // never be mistaken for a complete one. The full list travels on `issues`.
      detail:
        `${path} is valid JSON but is not a harvest document: ${parsed.issues.length} ${noun} ` +
        `(${head.join(", ")}${more > 0 ? `, and ${more} more` : ""}).`,
      path,
      issues: parsed.issues,
    };
  }

  return {
    ok: true,
    harvest: parsed.harvest,
    source: { path, bytes: bytes.byteLength, readAt: new Date().toISOString() },
  };
}

/** Per-status counts. COUNTS, not a score: there is no total to divide by and no ordering. */
export interface HarvestTally {
  readonly candidates: number;
  readonly awaitingReview: number;
  readonly approvedNotInLeaf: number;
  readonly inLeaf: number;
  readonly rejected: number;
}

export function tallyHarvest(harvest: HarvestDocument): HarvestTally {
  let awaitingReview = 0;
  let approvedNotInLeaf = 0;
  let inLeaf = 0;
  let rejected = 0;

  for (const c of harvest.candidates) {
    if (c.promotedAt !== undefined) inLeaf++;
    switch (c.status) {
      case "proposed":
        awaitingReview++;
        break;
      case "approved":
        if (c.promotedAt === undefined) approvedNotInLeaf++;
        break;
      case "rejected":
        rejected++;
        break;
    }
  }

  return {
    candidates: harvest.candidates.length,
    awaitingReview,
    approvedNotInLeaf,
    inLeaf,
    rejected,
  };
}

/**
 * HTTP status for a harvest load, mirroring `httpStatusFor` in the leaf app — the function this
 * dashboard's leaf route answers with — so the same kind of situation gets the same status here
 * whichever of the two documents it is about.
 *
 * 200 for `unconfigured` and `absent`: those are first-run states of a correctly working
 * install, and the page explains what to run. 409 for the three that mean the document on disk
 * is in a state this app cannot honour: it is the owner's file to repair, not a fault in this
 * app, so not a 500 — and not a 200, which would tell an uptime check all is well while the
 * queue is dark.
 */
export function httpStatusForHarvest(load: HarvestLoad): 200 | 409 {
  if (load.ok) return 200;
  switch (load.cause) {
    case "unconfigured":
    case "absent":
      return 200;
    case "unreadable":
    case "malformed":
    case "invalid":
      return 409;
    default: {
      const impossible: never = load;
      throw new Error(`unhandled harvest load cause: ${JSON.stringify(impossible)}`);
    }
  }
}
