/**
 * CANOPY-SIDE INGEST — reading one PUBLISHED leaf off disk and serving it.
 *
 * This is the receiving half of the publish seam. `apps/canopy/publish.mjs` writes an artifact;
 * this reads one back and hands the server either the document or exactly which thing went wrong.
 * It is the published-leaf counterpart of `treeDocument.ts` and inherits that file's central rule:
 * IT NEVER RETURNS A ZERO, and it never collapses two causes into one.
 *
 * WHY THE CAUSES STAY APART, restated for this route because the temptation is stronger here. A
 * URL like `/leaf/rowan-vale` has exactly one obvious answer when anything goes wrong — 404 — and
 * a 404 is a lie in five of the six cases below. "Nobody published that", "the canopy was never
 * told where publications live", "the file is there and the OS refused the read", "the bytes are
 * truncated", "the file parses but is not a publication", and "this file is somebody else's page
 * filed under this name" send an operator to six different places. One status for all six sends
 * them to none, and tells every uptime check that a dark install is healthy.
 *
 * STORAGE, and why it is a DIRECTORY OF FILES rather than an index:
 *
 *   <FOLIAGE_PUBLISHED>/<id>.published.json
 *
 * One publication is one file, named by the id that is also its URL. No index, no manifest, no
 * database. That is what makes the two operations this seam has to get right into single
 * filesystem primitives:
 *
 *   RE-PUBLISH is one atomic rename over one path. There is no second place holding a stale copy,
 *   so a half-finished re-publish cannot leave the canopy serving a page nobody consented to.
 *   UNPUBLISH is `rm <id>.published.json`. Nothing else knows the leaf existed, so nothing else
 *   has to be told. An index would need updating in the same breath, and an index that disagrees
 *   with the files is how an unpublished page keeps being served.
 *
 * THE ID IS VALIDATED, NEVER SANITISED. `PUBLISHED_ID` admits lower-case letters, digits and
 * interior hyphens, which cannot express `..`, a separator, a NUL, or a percent-escape. So path
 * containment here is not a string-cleaning exercise that has to be right about every encoding —
 * a request whose segment is not already a publishable id never reaches the filesystem at all, and
 * is answered `unpublishable-id` rather than "not found". Refusing beats transforming for a second
 * reason: two different URLs that sanitised to one path would serve one person's page under
 * another person's address.
 *
 * `misfiled` IS A CAUSE OF ITS OWN, and it is the one a reviewer should look at hardest. The file
 * at `alex-a.published.json` may parse perfectly and declare `leaf.id: "rowan-vale"`. Serving it
 * at /leaf/alex-a would publish a real, gate-approved page about one person at another person's
 * URL — the artifact is not corrupt, the FILING is wrong, and the distinction is exactly what the
 * operator needs to hear. It is refused rather than redirected: a redirect would confirm to a
 * caller that some other page exists there.
 *
 * No caching. Every request re-reads, for the same reason `/tree` does: an unpublish that is still
 * being served from memory is the worst failure this seam has.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  PUBLISHED_ID,
  documentDigest,
  parsePublishedDocument,
  type PublishedLeafDocument,
} from "@foliage/canopy";
import type { LeafDocumentIssue } from "@foliage/leaf";

/** The one environment variable this route reads: the directory publications live in. */
export const PUBLISHED_ENV = "FOLIAGE_PUBLISHED";

/** The URL prefix a published leaf is served under. One place, so the command and the server agree. */
export const PUBLISHED_ROUTE = "/leaf/";

/** `<id>` + this = the file name. Compound so a publications directory can hold nothing else. */
export const PUBLISHED_SUFFIX = ".published.json";

export interface PublishedSourceFile {
  readonly path: string;
  readonly bytes: number;
  /** Digest of the published artifact bytes, for compare-and-delete management actions. */
  readonly artifactDigest: string;
  /** ISO-8601 instant at which these bytes were read. Not when they were published. */
  readonly readAt: string;
}

export type PublishedLoadCause =
  | "unconfigured"
  | "unpublishable-id"
  | "absent"
  | "unreadable"
  | "malformed"
  | "invalid"
  | "misfiled";

export type PublishedLoad =
  | {
      readonly ok: true;
      readonly document: PublishedLeafDocument;
      readonly source: PublishedSourceFile;
      /** The id as requested, which the document is required to agree with. */
      readonly id: string;
    }
  | {
      readonly ok: false;
      readonly cause: "unconfigured";
      readonly detail: string;
      readonly path: null;
      readonly id: string;
    }
  | {
      readonly ok: false;
      readonly cause: "unpublishable-id";
      readonly detail: string;
      readonly path: null;
      readonly id: string;
    }
  | {
      readonly ok: false;
      readonly cause: "absent";
      readonly detail: string;
      readonly path: string;
      readonly id: string;
    }
  | {
      readonly ok: false;
      readonly cause: "unreadable";
      readonly detail: string;
      readonly path: string;
      readonly id: string;
      readonly errno: string;
    }
  | {
      readonly ok: false;
      readonly cause: "malformed";
      readonly detail: string;
      readonly path: string;
      readonly id: string;
    }
  | {
      readonly ok: false;
      readonly cause: "invalid";
      readonly detail: string;
      readonly path: string;
      readonly id: string;
      readonly issues: readonly LeafDocumentIssue[];
    }
  | {
      readonly ok: false;
      readonly cause: "misfiled";
      readonly detail: string;
      readonly path: string;
      readonly id: string;
      /** The id the artifact itself declares, which is not the one requested. */
      readonly declaredId: string;
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
 * Where a publication with this id lives under this root.
 *
 * Exported because the PUBLISH COMMAND has to compute the same path, and two implementations of
 * "where does it go" is how a writer and a reader end up disagreeing about a file neither of them
 * is wrong about. The caller is responsible for having validated the id; `loadPublishedLeaf` does
 * that before it ever calls this, and the command does it before it writes.
 */
export function publishedPath(root: string, id: string): string {
  return join(resolve(root), `${id}${PUBLISHED_SUFFIX}`);
}

/**
 * The URL a published leaf gets. One derivation, used by the server, the command and the tests.
 */
export function publishedUrl(id: string): string {
  return `${PUBLISHED_ROUTE}${id}`;
}

/**
 * Load the publication with this id, or exactly why it could not be loaded.
 *
 * `env` is injected rather than read inside, so tests point at real temporary directories without
 * mutating global state — the I/O stays real and only the configuration is a parameter.
 *
 * O(bytes) in the file, plus the parse gate's own O(total characters) re-run of the redaction
 * gate. One read, no directory listing: naming the file from the id is what keeps a request for a
 * page that does not exist from enumerating the pages that do.
 */
export async function loadPublishedLeaf(
  id: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PublishedLoad> {
  const configured = env[PUBLISHED_ENV];

  if (configured === undefined || configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail:
        `${PUBLISHED_ENV} is ${configured === undefined ? "not set" : "set but blank"}, so this ` +
        `canopy has nowhere to look for published leaves. No search was performed and nothing is ` +
        `known about whether "${id}" was ever published. Set ${PUBLISHED_ENV} to the directory ` +
        `the publish command writes into.`,
      path: null,
      id,
    };
  }

  if (!PUBLISHED_ID.test(id)) {
    return {
      ok: false,
      cause: "unpublishable-id",
      detail:
        `"${id}" is not a publishable id, so no file could correspond to it and none was looked ` +
        `for. A published id is lower-case letters, digits and interior hyphens ` +
        `(${String(PUBLISHED_ID)}). It is refused rather than cleaned up: two different addresses ` +
        `that cleaned up to one path would serve one person's page at another person's URL.`,
      path: null,
      id,
    };
  }

  const path = publishedPath(configured.trim(), id);

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
          `Nothing is published under "${id}". This canopy looked for exactly one file, ${path}, ` +
          `and there is none. That is the whole of what is known: it does not mean the person ` +
          `has no leaf, and it does not mean a publication was withdrawn.`,
        path,
        id,
      };
    }
    return {
      ok: false,
      cause: "unreadable",
      detail:
        `${path} exists as far as this process can tell, but could not be read: ` +
        `${messageOf(err)} [${code}]. The file has not been examined, so nothing is known about ` +
        `its contents either way.`,
      path,
      id,
      errno: code,
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0 with a message that
  // blames the first token. Same guard the leaf and tree loaders carry, for the same reason.
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
      id,
    };
  }

  const parsed = parsePublishedDocument(json);
  if (!parsed.ok) {
    // A REFUSED VERSION IS NOT DESCRIBED AS "invalid" THE SAME WAY A TORN FILE IS. `cause` still
    // has to be "invalid" — this file genuinely cannot be served as it stands — but the WORDING an
    // operator reads must not misdiagnose a stale-but-once-valid format as a corrupt store. This
    // is checked as the artifact's ONLY problem, deliberately: `parsePublishedDocument` validates
    // the rest of an unrecognised-version file against its current (version-4) rules as a
    // fallback, since there is no other ruleset to check it against, so a file with unrelated
    // problems too — the "not even this format" case `checkKeys`/the tag check produces — still
    // gets the generic, fully-itemised refusal below rather than being folded into "just a
    // version".
    const versionIssue =
      parsed.issues.length === 1 && parsed.issues[0]?.at === "artifactVersion"
        ? parsed.issues[0]
        : undefined;
    if (versionIssue !== undefined) {
      return {
        ok: false,
        cause: "invalid",
        detail: `${path} declares a published-artifact format this canopy does not read: ${versionIssue.message}`,
        path,
        id,
        issues: parsed.issues,
      };
    }
    const head = parsed.issues.slice(0, 3).map((i) => i.at);
    const more = parsed.issues.length - head.length;
    return {
      ok: false,
      cause: "invalid",
      // The COUNT is exact and the LIST is truncated, and it says so. A truncated display must
      // never be mistakable for a complete one; the full list travels on `issues`.
      detail:
        `${path} is valid JSON but is not a published leaf: ${parsed.issues.length} ` +
        `problem${parsed.issues.length === 1 ? "" : "s"} (${head.join(", ")}` +
        `${more > 0 ? `, and ${more} more` : ""}).`,
      path,
      id,
      issues: parsed.issues,
    };
  }

  if (parsed.document.leaf.id !== id) {
    return {
      ok: false,
      cause: "misfiled",
      detail:
        `${path} is a valid publication, and it is not this one: it declares ` +
        `leaf.id "${parsed.document.leaf.id}" while the address asks for "${id}". Serving it here ` +
        `would put one person's page at another person's URL, so it is refused rather than ` +
        `served or redirected — a redirect would confirm to a stranger that some other page ` +
        `exists at this address.`,
      path,
      id,
      declaredId: parsed.document.leaf.id,
    };
  }

  return {
    ok: true,
    document: parsed.document,
    source: {
      path,
      bytes: bytes.byteLength,
      artifactDigest: documentDigest(bytes),
      readAt: new Date().toISOString(),
    },
    id,
  };
}

/**
 * HTTP status for a load outcome. Lives here, next to the causes, so the transport layer makes no
 * policy decision and the two cannot drift.
 *
 * FIVE STATUSES FOR SEVEN CAUSES, and every grouping is argued:
 *
 *   200 — the publication was read. Including a publication with no leaflets: a leaf where nothing
 *         is verified publishes an honest empty page, and that page is a correct answer, not an
 *         error. This is the ordinary case on any machine that cannot check signatures.
 *   400 — `unpublishable-id`. The request is malformed, not the server's state. No file was
 *         looked for, and answering 404 would imply one was.
 *   404 — `absent`. Nobody published this. The one case where "not found" is the whole truth.
 *   500 — `unreadable`, `malformed`, `invalid`, `misfiled`. The operator's own store is broken in
 *         a way this canopy cannot paper over. Answering 404 would report a corrupted publication
 *         as an absent one and hide an outage behind a normal-looking status.
 *   503 — `unconfigured`. The service is not set up to answer this route at all. Distinct from
 *         500 because nothing is broken and distinct from 404 because nothing was searched; a
 *         monitor reading 503 knows to look at deployment configuration rather than at data.
 */
export function httpStatusForPublished(load: PublishedLoad): 200 | 400 | 404 | 500 | 503 {
  if (load.ok) return 200;
  switch (load.cause) {
    case "unconfigured":
      return 503;
    case "unpublishable-id":
      return 400;
    case "absent":
      return 404;
    case "unreadable":
    case "malformed":
    case "invalid":
    case "misfiled":
      return 500;
    default: {
      const impossible: never = load;
      throw new Error(`unhandled published load cause: ${JSON.stringify(impossible)}`);
    }
  }
}
