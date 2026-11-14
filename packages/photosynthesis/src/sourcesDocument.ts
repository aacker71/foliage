/**
 * THE SOURCES DOCUMENT — what the garden watches, and the total function that turns untrusted
 * JSON into one.
 *
 * WHY THIS FORMAT HAD TO EXIST BEFORE ANYTHING COULD BE "SET IT AND FORGET IT". Intake had no
 * memory of where evidence comes from: `foliage grow` defaults `--repo` to `process.cwd()`, so
 * every harvest was a one-shot against whatever directory the operator happened to be standing in.
 * That is fine for a person typing a command and impossible for a scheduled one — a launchd agent
 * has no meaningful working directory, so a scheduled `grow` would harvest nothing, or worse,
 * whatever repository happened to sit at the path it woke up in. MEASURED before this file existed:
 * `foliage install` wrote exactly one agent, `com.foliage.leaf`, running `up --port 4174` with
 * `RunAtLoad` — the VIEWER. Nothing in the product ever ran intake on its own. A user who installed
 * Foliage and forgot about it got a web page that never changed.
 *
 * THE ONE PROPERTY THIS FORMAT IS FOR, and every decision below follows from it:
 *
 *   A SOURCE MUST CARRY EVERYTHING A HARVEST NEEDS, because the harvest will run when nobody is
 *   watching. `grow` today falls back to `git config user.email` and `git config user.name` and
 *   EXITS 2 with a prompt when either is missing. That prompt is a reasonable answer to a person
 *   at a terminal and a silent failure at 03:00 — the run dies, no leaflet is drafted, and the
 *   only trace is a line in a log nobody opens. So `subject` and `identities` are REQUIRED here
 *   rather than resolved later: a source that cannot be harvested unattended is not representable.
 *
 * The same disciplines as `parseHarvestDocument`, one layer earlier again:
 *
 *   UNKNOWN KEYS ARE REFUSED, score-shaped keys BY NAME and from the imported list, so the three
 *   gates cannot drift. A watched source is exactly the kind of record something would want to
 *   hang a "priority" or a "weight" on, and ordering sources by a number is ranking a person's
 *   work by where it came from.
 *
 *   PATHS MUST BE ABSOLUTE. A relative path is the very bug this format exists to remove; it
 *   would resolve against the scheduler's working directory and quietly watch the wrong tree.
 *
 * WHAT THIS DOES NOT DO. It does not read the filesystem, so it cannot tell you whether a watched
 * path still exists or is still a git repository — a source can be recorded and later go missing,
 * and that is a fact about the disk at harvest time, reported by the edge that reads it. Keeping
 * this module pure is what lets the whole format be tested without a repository on disk.
 */

import { SCORE_SHAPED, isIsoInstant } from "@foliage/leaf";

/**
 * WHAT KIND OF PLACE THIS IS — a union, and it has exactly one member today.
 *
 * Named rather than assumed because photographs already have an intake path of their own
 * (`photoIntake.ts`), so a second kind is a question of when and not whether. A union with one
 * member costs an exhaustiveness check and buys the guarantee that adding the second one is a
 * compile error at every site that has to care, rather than a silently-skipped source.
 */
export type WatchedSourceKind = "git";

/** Every kind, for the exhaustiveness check and for error messages that can list them. */
export const WATCHED_SOURCE_KINDS: readonly WatchedSourceKind[] = Object.freeze(["git"]);

/**
 * One place the garden watches.
 *
 * `identities` is a list because one person commits under several addresses — a work address, a
 * personal one, a noreply — and attribution that only knows one of them silently drops the rest of
 * their work. `subject` is the name the leaflets are drafted FOR, carried here for the reason in
 * this file's header: at harvest time there may be nobody to ask.
 */
export interface WatchedSource {
  readonly kind: WatchedSourceKind;
  /** Absolute. A relative path is refused — see the header. */
  readonly path: string;
  /** The name leaflets are drafted for. Required: a scheduled run cannot prompt for it. */
  readonly subject: string;
  /** At least one. Every address this person commits under at this source. */
  readonly identities: readonly string[];
  /** ISO instant this source was added, for the operator's own accounting. */
  readonly addedAt: string;
}

/** The document. A garden with nothing watched is a valid, and very common, document. */
export interface SourcesDocument {
  readonly sources: readonly WatchedSource[];
}

export interface SourcesDocumentIssue {
  /** `sources[2].path` — the index is named, same rule as HarvestDocumentIssue. */
  readonly at: string;
  readonly message: string;
}

export type SourcesDocumentParse =
  | { readonly ok: true; readonly document: SourcesDocument }
  | { readonly ok: false; readonly issues: readonly SourcesDocumentIssue[] };

const DOCUMENT_KEYS: ReadonlySet<string> = new Set(["sources"]);
const SOURCE_KEYS: ReadonlySet<string> = new Set(["kind", "path", "subject", "identities", "addedAt"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Same wording rules as harvestDocument.ts: say what was actually there, absence included. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function checkKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: SourcesDocumentIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: no rating of any kind may enter this format. Sources are ` +
          `places work comes from, and ordering them by a number ranks a person's work by its ` +
          `origin — the same posture as the leaf and harvest documents, one layer earlier.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling is reported instead of silently doing nothing.`,
      });
    }
  }
}

/**
 * Untrusted JSON in, a sources document or the reasons why not out. Pure and total.
 *
 * EVERY issue is collected rather than the first: someone hand-editing this file wants all of what
 * is wrong with it, not one round-trip per mistake.
 */
export function parseSourcesDocument(value: unknown): SourcesDocumentParse {
  const issues: SourcesDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message: `a sources document must be a JSON object with a sources array — got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, DOCUMENT_KEYS, "", issues);

  const rawSources = value["sources"];
  const sources: WatchedSource[] = [];

  if (!Array.isArray(rawSources)) {
    issues.push({
      at: "sources",
      message:
        `an array of watched sources — got ${describe(rawSources)}. A garden that watches nothing ` +
        `is written as an empty array, never as an absent field, so "no sources" and "malformed ` +
        `document" stay different answers.`,
    });
    return { ok: false, issues };
  }

  const seen = new Map<string, number>();

  rawSources.forEach((raw, i) => {
    const at = `sources[${i}]`;
    if (!isRecord(raw)) {
      issues.push({ at, message: `a watched source must be an object — got ${describe(raw)}` });
      return;
    }
    checkKeys(raw, SOURCE_KEYS, at, issues);

    const kind = raw["kind"];
    if (!nonEmptyString(kind) || !WATCHED_SOURCE_KINDS.includes(kind as WatchedSourceKind)) {
      issues.push({
        at: `${at}.kind`,
        message: `one of ${WATCHED_SOURCE_KINDS.map((k) => `"${k}"`).join(", ")} — got ${describe(kind)}`,
      });
    }

    const path = raw["path"];
    if (!nonEmptyString(path)) {
      issues.push({ at: `${at}.path`, message: `a non-empty absolute path — got ${describe(path)}` });
    } else if (!path.startsWith("/")) {
      issues.push({
        at: `${at}.path`,
        message:
          `an ABSOLUTE path, got "${path}". A relative path is refused because this document is ` +
          `read by unattended runs: it would resolve against whatever working directory the ` +
          `scheduler happened to have, which is the defect this format exists to remove.`,
      });
    } else {
      // Two entries for one tree would harvest it twice and draft the same work twice. Reported
      // against the LATER one, naming the earlier, so the message says which line to delete.
      const first = seen.get(path);
      if (first === undefined) seen.set(path, i);
      else
        issues.push({
          at: `${at}.path`,
          message: `already watched at sources[${first}] — one path, one entry, or its history is harvested twice`,
        });
    }

    const subject = raw["subject"];
    if (!nonEmptyString(subject)) {
      issues.push({
        at: `${at}.subject`,
        message:
          `a non-empty string — got ${describe(subject)}. Required, not resolved later: a ` +
          `scheduled harvest has nobody to ask, so a source missing its subject would fail in the ` +
          `middle of the night with a prompt no one reads.`,
      });
    }

    const identities = raw["identities"];
    if (!Array.isArray(identities) || identities.length === 0) {
      issues.push({
        at: `${at}.identities`,
        message:
          `a non-empty array of the addresses this person commits under — got ${describe(identities)}. ` +
          `Required for the same reason as subject, and a list because one person commits under ` +
          `several addresses; knowing only one silently drops the rest of their work.`,
      });
    } else {
      identities.forEach((id, j) => {
        if (!nonEmptyString(id)) {
          issues.push({ at: `${at}.identities[${j}]`, message: `a non-empty string — got ${describe(id)}` });
        }
      });
    }

    /*
     * `isIsoInstant`, NOT a bare `Date.parse`. The review caught this as the fourth instance of the
     * shape F-026, F-035 and F-037 already track: one domain rule written twice. `Date.parse`
     * accepts "2026", "2026-09-04", "September 4 2026" and "Fri Sep 04 2026" — none of which is an
     * ISO 8601 INSTANT, which is what the message below promises. `@foliage/leaf` exports the
     * canonical rule and says why: "a second copy of the rule in the producer would drift from this
     * one the first time either changed … One definition, both directions." `harvestDocument.ts`
     * imports it; this file already imports `SCORE_SHAPED` from the same module precisely "so the
     * three gates cannot drift", and then did not import this one.
     */
    const addedAt = raw["addedAt"];
    if (!nonEmptyString(addedAt) || !isIsoInstant(addedAt)) {
      issues.push({
        at: `${at}.addedAt`,
        message: `an ISO 8601 instant — got ${describe(addedAt)}`,
      });
    }

    if (issues.some((p) => p.at.startsWith(at))) return;

    sources.push({
      kind: kind as WatchedSourceKind,
      path: path as string,
      subject: subject as string,
      identities: Object.freeze([...(identities as string[])]),
      addedAt: addedAt as string,
    });
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, document: { sources: Object.freeze(sources) } };
}

/**
 * The empty document — what a garden that has never watched anything holds.
 *
 * A named value rather than `{ sources: [] }` written at each call site, because "no sources yet"
 * is a state several surfaces have to render and they must agree about what it is.
 */
export const NO_SOURCES: SourcesDocument = Object.freeze({ sources: Object.freeze([]) });

/**
 * Add a source, or say why not. Pure: returns a NEW document, never mutates the one given.
 *
 * Refusing a duplicate here as well as in the parser is deliberate and is not a second opinion —
 * the parser guards a file somebody edited, this guards a command somebody ran, and the two
 * failures want different words. Both delegate the question "same source?" to the same comparison.
 */
export function addSource(
  document: SourcesDocument,
  source: WatchedSource,
): { readonly ok: true; readonly document: SourcesDocument } | { readonly ok: false; readonly reason: string } {
  const clash = document.sources.find((s) => s.path === source.path);
  if (clash !== undefined) {
    return { ok: false, reason: `already watching ${source.path} (added ${clash.addedAt})` };
  }
  return { ok: true, document: { sources: Object.freeze([...document.sources, source]) } };
}

/**
 * Stop watching a path. Reports whether anything was actually removed, because "unwatched a path
 * that was never watched" is a typo the operator wants to hear about, not a silent success.
 */
export function removeSource(
  document: SourcesDocument,
  path: string,
): { readonly ok: true; readonly document: SourcesDocument } | { readonly ok: false; readonly reason: string } {
  const kept = document.sources.filter((s) => s.path !== path);
  if (kept.length === document.sources.length) {
    return { ok: false, reason: `not watching ${path}` };
  }
  return { ok: true, document: { sources: Object.freeze(kept) } };
}
