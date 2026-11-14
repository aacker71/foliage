/**
 * Loading one person's leaf document from disk.
 *
 * THE WHOLE POINT OF THIS FILE IS THAT IT NEVER RETURNS A ZERO. It returns a discriminated
 * union: either the leaf, or exactly which of five distinct things went wrong. A loader that
 * answered `null` — or worse, an empty `Leaf` — would let the page render a dashboard of
 * zeros while the truth was "you have not told me where your file is", "your file has a typo
 * on line 12", or "I am not allowed to read it". That is the failure this project keeps
 * paying for: four distinct causes collapsed into `commitCount: 0`, followed by the product
 * asserting "0 commits" about work it had never read.
 *
 * There is a SIXTH state, and it is not in this union on purpose: a VALID document whose
 * `leaflets` array is empty. That is `ok: true` with nothing in it — a real, honest, empty
 * portfolio, which is what a freshly self-hosted install truthfully looks like. It is the
 * state a first user actually sees, and it must never be reported as "no document found".
 * The renderer distinguishes them; `absentAndEmptyAreDifferent` in the tests pins it.
 *
 * Layering: PARSING lives in @foliage/leaf (the document format is part of the open core, so
 * the person who owns the file can read the rules it is judged by). This file owns only the
 * I/O and the configuration — which is app-shaped, not domain-shaped, and is why the causes
 * split 4/1: unconfigured, absent, unreadable and malformed are all facts about a filesystem,
 * while `invalid` is the domain's verdict, delegated and passed through with its issue list.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLeafDocument, type Leaf, type LeafDocumentIssue } from "@foliage/leaf";

/** The one environment variable this app reads. */
export const DOCUMENT_ENV = "FOLIAGE_LEAF";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where a self-hoster's own document goes by default: next to the app, NOT inside `public/`.
 * A leaf document can contain pending and excluded leaflets, which are the subject's own
 * accounting and are never outward claims — so the raw file must not be statically servable.
 * It is also gitignored, because a real person's leaf must never land in this repository.
 */
export const DEFAULT_DOCUMENT_PATH = resolve(APP_DIR, "leaf.json");

/**
 * The bundled illustration. Outside `public/` for the same reason, and loaded ONLY when
 * FOLIAGE_LEAF names it explicitly — never by default, so no run can drift into presenting
 * fabricated content as someone's real evidence.
 */
export const EXAMPLE_DOCUMENT_PATH = resolve(APP_DIR, "example/leaf.example.json");

export interface LeafSource {
  readonly path: string;
  readonly bytes: number;
  /** SHA-256 of the exact bytes parsed into `leaf`. */
  readonly documentDigest: string;
  /** ISO-8601 instant at which the bytes were read. */
  readonly readAt: string;
  /** The document itself declared `"example": true`. */
  readonly declaredExample: boolean;
  /** The resolved path IS this app's bundled example document. */
  readonly bundledExample: boolean;
}

export type LeafLoadCause =
  | "unconfigured"
  | "absent"
  | "unreadable"
  | "malformed"
  | "invalid";

export type LeafLoad =
  | { readonly ok: true; readonly leaf: Leaf; readonly source: LeafSource }
  | {
      readonly ok: false;
      readonly cause: "unconfigured";
      readonly detail: string;
      readonly path: null;
    }
  | {
      readonly ok: false;
      readonly cause: "absent";
      readonly detail: string;
      readonly path: string;
    }
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
      readonly issues: readonly LeafDocumentIssue[];
    };

function errnoOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "UNKNOWN";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load and validate the configured leaf document.
 *
 * `env` is injected rather than read from `process.env` inside so tests can point at a real
 * temporary file without mutating global state — the I/O stays real, only the configuration
 * is a parameter.
 */
export async function loadLeafDocument(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LeafLoad> {
  const configured = env[DOCUMENT_ENV];

  // Set-but-blank is its own cause. Falling back to the default here would answer "no
  // document at <default>" to someone who is staring at a FOLIAGE_LEAF they believe they set.
  if (configured !== undefined && configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail:
        `${DOCUMENT_ENV} is set but blank, so no document path could be determined. ` +
        `Either unset it — the default is then ${DEFAULT_DOCUMENT_PATH} — or set it to the ` +
        `path of your leaf document.`,
      path: null,
    };
  }

  const path =
    configured === undefined ? DEFAULT_DOCUMENT_PATH : resolve(configured.trim());

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
          `No leaf document was found at ${path}` +
          (configured === undefined
            ? ` (the default location — set ${DOCUMENT_ENV} to use a different path).`
            : ` (from ${DOCUMENT_ENV}).`),
        path,
      };
    }
    // Not ENOENT: the file may well exist and we could not read it. Reporting this as "not
    // found" would send someone to look for a file that is sitting right there.
    return {
      ok: false,
      cause: "unreadable",
      detail: `${path} exists as far as this process can tell, but could not be read: ${messageOf(err)} [${code}]`,
      path,
      errno: code,
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0 with a message that
  // blames the first token. Strip it, and do not make anyone lose an hour to it.
  const text = bytes.toString("utf8").replace(/^﻿/, "");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      cause: "malformed",
      detail: `${path} is not valid JSON: ${describeJsonFailure(err, text)}`,
      path,
    };
  }

  const parsed = parseLeafDocument(json);
  if (!parsed.ok) {
    return {
      ok: false,
      cause: "invalid",
      detail: summarizeIssues(parsed.issues, path),
      path,
      issues: parsed.issues,
    };
  }

  return {
    ok: true,
    leaf: parsed.leaf,
    source: {
      path,
      bytes: bytes.byteLength,
      documentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      readAt: new Date().toISOString(),
      declaredExample: parsed.declaredExample,
      bundledExample: path === EXAMPLE_DOCUMENT_PATH,
    },
  };
}

/**
 * Turn a JSON parse failure into something a person can act on.
 *
 * V8 reports two different shapes and neither is under our control, so the honest thing is to
 * say which one we got rather than imply a location we do not have:
 *
 *   "Expected ',' or '}' after property value in JSON at position 34 (line 4 column 3)"
 *   "Unexpected token '}', ..."flets": [ }" is not valid JSON"
 *
 * The first carries a location. The second carries a context snippet and NO index at all — so
 * for that kind, this says so explicitly. Guessing a line number from the snippet would be
 * inventing a result, which is worse than admitting the parser did not give one. The middle
 * case (a position but no line/column, as older engines emit) is computed from the text.
 */
function describeJsonFailure(err: unknown, text: string): string {
  const message = messageOf(err);
  if (/line \d+/.test(message)) return message;

  const at = /position (\d+)/.exec(message);
  if (at === null) {
    return (
      `${message} — the parser reported no position for this kind of error, only the snippet ` +
      `above; search the file for that text.`
    );
  }

  const index = Number(at[1]);
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return `${message} (line ${line}, column ${column})`;
}

/** How many issues the one-line summary names before it says how many more there are. */
const SUMMARY_ISSUES = 3;

function summarizeIssues(issues: readonly LeafDocumentIssue[], path: string): string {
  const head = issues.slice(0, SUMMARY_ISSUES).map((i) => i.at);
  const more = issues.length - head.length;
  const noun = issues.length === 1 ? "problem" : "problems";
  return (
    `${path} is valid JSON but is not a leaf document: ${issues.length} ${noun} ` +
    `(${head.join(", ")}${more > 0 ? `, and ${more} more` : ""}).`
  );
  // The COUNT is exact and the LIST is truncated — stated, so a truncated display can never
  // be mistaken for a complete one. The full list travels on `issues`.
}

/**
 * Every independent reason to believe this document is fabricated rather than real evidence.
 *
 * Two signals, checked separately and BOTH reported, because either one alone can be lost:
 * someone can strip `"example": true` from a copy, and someone can move the file out of
 * `example/`. Requiring both to agree would let either mistake publish fabricated content as
 * a real portfolio; requiring either is the safe direction to fail.
 *
 * Empty array means: nothing here suggests this is anything other than the subject's own
 * document. It is NOT a claim that the contents were verified — only `ProofTier` says that.
 */
export function fabricationSignals(source: LeafSource): readonly string[] {
  const signals: string[] = [];
  if (source.declaredExample) signals.push('the document declares "example": true');
  if (source.bundledExample) signals.push("it is the example document bundled with this app");
  return signals;
}

/**
 * HTTP status for a load outcome. Lives here, next to the causes, so the view never has to
 * make an HTTP decision and the two cannot drift.
 *
 * 200 for `unconfigured` and `absent`: those are first-run states of a correctly working
 * install, not errors, and the page explains what to do next.
 *
 * 409 for `unreadable`, `malformed` and `invalid`: the document on disk is in a state this app
 * cannot honour, and the page names it and the repair. It is the owner's file to fix, not a fault
 * in this app, so it is not a 500 — and it is not a 200 either, which would tell every uptime
 * check that all is well while the portfolio is dark. 409 is what every other read failure here
 * answers (a story, a highlight, an editor that could not open); 500 stays for this app's own bugs.
 */
export function httpStatusFor(load: LeafLoad): 200 | 409 {
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
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}
