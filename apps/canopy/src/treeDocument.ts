/**
 * Loading a TREE — one company and the real leaves it gathers — from disk.
 *
 * This is the cloud plane's counterpart to `apps/leaf/src/leafDocument.ts`, and it inherits that
 * file's central rule: IT NEVER RETURNS A ZERO. It returns a discriminated union, either the
 * tree or exactly which thing went wrong, because a loader that answered `null` would let the
 * canopy render "0 people" about a company whose manifest it had simply failed to find.
 *
 * But a tree has a failure mode a single leaf does not have, and it is the reason this file
 * exists rather than a loop around the leaf loader:
 *
 *   A TREE IS PARTIALLY LOADABLE. A manifest naming five people whose fifth document is
 *   malformed must render FOUR leaves and say, on the page, that the fifth could not be read
 *   and why. Both of the obvious alternatives are defects. Failing the whole tree punishes four
 *   people for a typo in a colleague's file. Rendering four and stopping there is worse: it
 *   silently reports a company of four, and every count on the page — including
 *   `canopySize` — is then a true statement about a set the reader has no way of knowing is
 *   incomplete. That is the "four causes collapsed into 0" failure at the next size up, where it
 *   is harder to notice because the number looks plausible.
 *
 * So the result carries `tree` and `failures` SIDE BY SIDE. `Tree.leaves` holds only leaves that
 * genuinely parsed — the domain type stays clean and `canopySize` keeps meaning exactly what it
 * says — while every entry that did not load travels alongside it with its cause. The renderer
 * is required to show both, and `renderTree.ts` cannot compute a roster without also being
 * handed the failures.
 *
 * LAYERING, same split the leaf app uses. PARSING a leaf document lives in `@foliage/leaf`,
 * because the format is part of the open core and the person who owns the file can read the
 * rules it is judged by. This file owns the I/O, the manifest format (which is cloud-plane: it
 * is about tenancy, not about anyone's portfolio), and the assembly into `@foliage/canopy`'s
 * `Tree`. The dependency runs canopy → leaf and never the reverse; `pnpm check:boundary` fails
 * the build if it is ever inverted.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  defaultPublishPolicy,
  parseLeafDocument,
  parsePublishPolicy,
  type Leaf,
  type LeafDocumentIssue,
  type LeafId,
  type PublishPolicy,
} from "@foliage/leaf";
import { treeId, type Tree } from "@foliage/canopy";

/** The one environment variable this app reads. */
export const TREE_ENV = "FOLIAGE_TREE";

/**
 * A tree manifest, as it appears on disk.
 *
 * Deliberately thin. It names a company and points at leaf documents; it holds no copy of
 * anything inside them. A manifest that cached a person's leaflet counts would be a second
 * source of truth for that person's evidence, and the moment their document changed the canopy
 * would be publishing a stale claim about them from a file they do not control.
 *
 *   {
 *     "id": "northwind",
 *     "company": "Northwind Instruments",
 *     "leaves": ["people/ada.leaf.json", "people/rey.leaf.json"]
 *   }
 *
 * `company` was called `organization` while a Tree was believed to BE an organization. Under the
 * settled taxonomy a Tree is a company and "organization" names the bough level, so the old key
 * is now a false name for this value. It is REFUSED rather than accepted as an alias: `known`
 * below no longer contains it, unknown keys are reported by name, and a manifest still carrying
 * it therefore fails with both facts stated — the key nobody recognises, and the required key
 * that is missing. An alias would have let two spellings of one field drift.
 *
 * Leaf paths resolve relative to the MANIFEST's directory, not the process working directory —
 * the least surprising rule, and the one that keeps a manifest portable between a laptop and a
 * container.
 */
export interface TreeManifest {
  readonly id: string;
  readonly company: string;
  readonly leaves: readonly string[];
  /** The manifest itself declares it is an illustration. See `fabricationSignals`. */
  readonly example: boolean;
}

export interface TreeSource {
  readonly path: string;
  readonly bytes: number;
  /** ISO-8601 instant at which the manifest bytes were read. */
  readonly readAt: string;
}

/** Where one leaf in the tree came from, and whether anything marks it as fabricated. */
export interface LeafSource {
  readonly path: string;
  readonly bytes: number;
  /** The leaf document declared `"example": true`. */
  readonly declaredExample: boolean;
}

/**
 * Why one named leaf could not become part of the tree.
 *
 * `duplicate` is in this union and is not an I/O failure, which is the point: two entries
 * resolving to the same `LeafId` is a DATA defect, and `@foliage/canopy` says so explicitly —
 * `treeContaining` returns the first match and its contract calls a second one a defect rather
 * than a choice. Silently keeping the first would make `canopySize` disagree with the manifest
 * by one, with nothing on the page to explain the gap, so the second entry is refused and
 * reported instead.
 */
type LeafEntryCause =
  | "absent"
  | "unreadable"
  | "malformed"
  | "invalid"
  | "duplicate"
  /**
   * The LEAF was fine; its sibling POLICY document was not. The whole entry fails rather than
   * loading the leaf under the default rules, because a subject who wrote a policy wrote DENY
   * rules, and "your policy was broken so we published without it" is the one outcome this
   * loader exists to make impossible. Fail-closed: no policy file at all means the default
   * (which ships the deny rules); a PRESENT-but-broken one means this person does not load.
   */
  | "policy-invalid";

export interface LeafEntryFailure {
  readonly cause: LeafEntryCause;
  /** The entry exactly as the manifest wrote it, so it can be found and fixed. */
  readonly entry: string;
  /** The resolved absolute path the loader actually tried. */
  readonly path: string;
  readonly detail: string;
  /** Present only for `invalid`: the domain's own issue list, passed through untouched. */
  readonly issues?: readonly LeafDocumentIssue[];
  /** Present only for `unreadable`: the real errno. EACCES and EISDIR are different bugs. */
  readonly errno?: string;
}

export type TreeLoadCause = "unconfigured" | "absent" | "unreadable" | "malformed" | "invalid";

export type TreeLoad =
  | {
      readonly ok: true;
      readonly tree: Tree;
      readonly source: TreeSource;
      readonly manifest: TreeManifest;
      /** One per leaf IN the tree, index-aligned with `tree.leaves`. */
      readonly leafSources: readonly LeafSource[];
      /**
       * One per leaf IN the tree, index-aligned with `tree.leaves` — the subject's own publish
       * policy when `<leafpath minus .json>.policy.json` existed beside their document, else the
       * default policy (which carries the shipped deny rules, so the rail is never off).
       */
      readonly policies: readonly PublishPolicy[];
      /** Every manifest entry that did not make it. Rendered, never swallowed. */
      readonly failures: readonly LeafEntryFailure[];
    }
  | { readonly ok: false; readonly cause: "unconfigured"; readonly detail: string; readonly path: null }
  | { readonly ok: false; readonly cause: "absent"; readonly detail: string; readonly path: string }
  | {
      readonly ok: false;
      readonly cause: "unreadable";
      readonly detail: string;
      readonly path: string;
      readonly errno: string;
    }
  | { readonly ok: false; readonly cause: "malformed"; readonly detail: string; readonly path: string }
  | {
      readonly ok: false;
      readonly cause: "invalid";
      readonly detail: string;
      readonly path: string;
      readonly issues: readonly LeafDocumentIssue[];
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate the manifest shape, reusing `@foliage/leaf`'s issue vocabulary.
 *
 * The issue type is borrowed rather than reinvented because it is already the right shape —
 * `at` names a path a human can find in their editor, and naming the ENTRY INDEX is what stops
 * "invalid leaves entry" in a 40-person manifest from being a scavenger hunt. Reusing the type
 * across the boundary is fine in this direction: cloud may depend on open.
 */
export function parseTreeManifest(
  value: unknown,
): { ok: true; manifest: TreeManifest } | { ok: false; issues: readonly LeafDocumentIssue[] } {
  const issues: LeafDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ at: "(root)", message: "a tree manifest must be a JSON object" }],
    };
  }

  const known = new Set(["id", "company", "leaves", "example"]);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      issues.push({
        at: key,
        message: `unknown key — a tree manifest holds only ${[...known].join(", ")}`,
      });
    }
  }

  const id = value["id"];
  if (typeof id !== "string" || id.trim() === "") {
    issues.push({ at: "id", message: "required, and must be a non-empty string" });
  }

  const company = value["company"];
  if (typeof company !== "string" || company.trim() === "") {
    issues.push({ at: "company", message: "required, and must be a non-empty string" });
  }

  const leaves = value["leaves"];
  if (!Array.isArray(leaves)) {
    // A company with no people yet is legitimate and is expressed as `[]`. Omitting the
    // key entirely is not the same statement, and is refused so that a manifest cannot mean
    // "no people" by accident.
    issues.push({
      at: "leaves",
      message: 'required, and must be an array — a tree with no people yet is written as "leaves": []',
    });
  } else {
    leaves.forEach((entry, i) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        issues.push({
          at: `leaves[${i}]`,
          message: "must be a non-empty string path to a leaf document",
        });
      }
    });
  }

  const example = value["example"];
  if (example !== undefined && typeof example !== "boolean") {
    issues.push({ at: "example", message: "must be a boolean when present" });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    manifest: {
      id: (id as string).trim(),
      company: (company as string).trim(),
      leaves: Object.freeze((leaves as string[]).map((s) => s.trim())),
      example: example === true,
    },
  };
}

/**
 * Where a subject's policy travels beside their leaf: `people/ada.leaf.json` →
 * `people/ada.leaf.policy.json`. A file CONVENTION rather than a manifest key, so a tree
 * operator cannot point one person's leaf at another person's policy — the pairing is the
 * filesystem's, not an editable mapping.
 */
function policyPathFor(leafPath: string): string {
  return leafPath.replace(/\.json$/, "") + ".policy.json";
}

/**
 * Load one leaf named by the manifest. Every failure keeps its cause.
 *
 * Note what is NOT here: a fallback. There is no "skip and continue with a placeholder", because
 * a placeholder person in a company's roster is fabricated data about a real workplace.
 */
async function loadOneLeaf(
  entry: string,
  path: string,
): Promise<
  | { ok: true; leaf: Leaf; source: LeafSource; policy: PublishPolicy }
  | { ok: false; failure: LeafEntryFailure }
> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") {
      return {
        ok: false,
        failure: {
          cause: "absent",
          entry,
          path,
          detail: `no leaf document at ${path}.`,
        },
      };
    }
    return {
      ok: false,
      failure: {
        cause: "unreadable",
        entry,
        path,
        detail: `${path} could not be read: ${messageOf(err)} [${code}]`,
        errno: code,
      },
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0 with a message that
  // blames the first token. Same guard the leaf loader carries, for the same hour of someone's life.
  const text = bytes.toString("utf8").replace(/^﻿/, "");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      failure: {
        cause: "malformed",
        entry,
        path,
        detail: `${path} is not valid JSON: ${messageOf(err)}`,
      },
    };
  }

  const parsed = parseLeafDocument(json);
  if (!parsed.ok) {
    const head = parsed.issues.slice(0, 3).map((i) => i.at);
    const more = parsed.issues.length - head.length;
    return {
      ok: false,
      failure: {
        cause: "invalid",
        entry,
        path,
        // The COUNT is exact and the LIST is truncated, and it says so — a truncated display
        // must never be mistakable for a complete one. The full list travels on `issues`.
        detail:
          `${path} is valid JSON but is not a leaf document: ${parsed.issues.length} ` +
          `problem${parsed.issues.length === 1 ? "" : "s"} (${head.join(", ")}` +
          `${more > 0 ? `, and ${more} more` : ""}).`,
        issues: parsed.issues,
      },
    };
  }

  // The sibling policy. ENOENT is the ordinary case and means the default rules; any OTHER
  // failure of a policy that EXISTS fails this person closed — see `policy-invalid` above.
  const policyPath = policyPathFor(path);
  let policy: PublishPolicy;
  let policyBytes: Buffer | null = null;
  try {
    policyBytes = await readFile(policyPath);
  } catch (err) {
    if (errnoOf(err) !== "ENOENT") {
      return {
        ok: false,
        failure: {
          cause: "policy-invalid",
          entry,
          path: policyPath,
          detail: `${policyPath} could not be read: ${messageOf(err)} [${errnoOf(err)}]`,
        },
      };
    }
  }
  if (policyBytes === null) {
    const fallback = defaultPublishPolicy();
    if (!fallback.ok) {
      // The compiled-in default failing its own parser is a build defect, pinned by tests in
      // @foliage/leaf — but if it ever happens, failing the person closed beats publishing.
      return {
        ok: false,
        failure: {
          cause: "policy-invalid",
          entry,
          path: policyPath,
          detail: "the built-in default publish policy failed to parse.",
        },
      };
    }
    policy = fallback.policy;
  } else {
    let policyJson: unknown;
    try {
      policyJson = JSON.parse(policyBytes.toString("utf8").replace(/^\ufeff/, ""));
    } catch (err) {
      return {
        ok: false,
        failure: {
          cause: "policy-invalid",
          entry,
          path: policyPath,
          detail: `${policyPath} is not valid JSON: ${messageOf(err)}`,
        },
      };
    }
    const parsedPolicy = parsePublishPolicy(policyJson);
    if (!parsedPolicy.ok) {
      const head = parsedPolicy.issues.slice(0, 3).map((i) => i.at);
      const more = parsedPolicy.issues.length - head.length;
      return {
        ok: false,
        failure: {
          cause: "policy-invalid",
          entry,
          path: policyPath,
          detail:
            `${policyPath} is valid JSON but is not a publish policy: ${parsedPolicy.issues.length} ` +
            `problem${parsedPolicy.issues.length === 1 ? "" : "s"} (${head.join(", ")}` +
            `${more > 0 ? `, and ${more} more` : ""}).`,
        },
      };
    }
    policy = parsedPolicy.policy;
  }

  return {
    ok: true,
    leaf: parsed.leaf,
    source: { path, bytes: bytes.byteLength, declaredExample: parsed.declaredExample },
    policy,
  };
}

/**
 * Load the configured tree manifest and every leaf it names.
 *
 * `env` is injected rather than read from `process.env` inside, so tests can point at real
 * temporary files without mutating global state — the I/O stays real, only the configuration is
 * a parameter. Leaves load CONCURRENTLY: they are independent file reads and the failure of one
 * is already modelled as that one's failure, so there is nothing to sequence. O(n) reads,
 * wall-clock bounded by the slowest file rather than their sum.
 */
export async function loadTreeDocument(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TreeLoad> {
  const configured = env[TREE_ENV];

  if (configured === undefined || configured.trim() === "") {
    // Set-but-blank and never-set are one cause here, unlike in the leaf app, and the difference
    // is not an oversight: a leaf app has a sensible default location next to itself, so "blank"
    // and "unset" lead to genuinely different next steps. A canopy has no default company it
    // could reasonably guess, so both states have the same remedy and are told the same thing.
    return {
      ok: false,
      cause: "unconfigured",
      detail: `${TREE_ENV} is ${configured === undefined ? "not set" : "set but blank"}.`,
      path: null,
    };
  }

  const path = resolve(configured.trim());

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") {
      return {
        ok: false,
        cause: "absent",
        detail: `No tree manifest was found at ${path} (from ${TREE_ENV}).`,
        path,
      };
    }
    return {
      ok: false,
      cause: "unreadable",
      detail: `${path} could not be read: ${messageOf(err)} [${code}]`,
      path,
      errno: code,
    };
  }

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

  const parsed = parseTreeManifest(json);
  if (!parsed.ok) {
    const head = parsed.issues.slice(0, 3).map((i) => i.at);
    const more = parsed.issues.length - head.length;
    return {
      ok: false,
      cause: "invalid",
      detail:
        `${path} is valid JSON but is not a tree manifest: ${parsed.issues.length} ` +
        `problem${parsed.issues.length === 1 ? "" : "s"} (${head.join(", ")}` +
        `${more > 0 ? `, and ${more} more` : ""}).`,
      path,
      issues: parsed.issues,
    };
  }

  const manifest = parsed.manifest;
  const base = dirname(path);

  const outcomes = await Promise.all(
    manifest.leaves.map((entry) => loadOneLeaf(entry, resolve(base, entry))),
  );

  const leaves: Leaf[] = [];
  const leafSources: LeafSource[] = [];
  const policies: PublishPolicy[] = [];
  const failures: LeafEntryFailure[] = [];
  const seen = new Map<LeafId, string>();

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const entry = manifest.leaves[i];
    if (outcome === undefined || entry === undefined) continue;

    if (!outcome.ok) {
      failures.push(outcome.failure);
      continue;
    }

    const first = seen.get(outcome.leaf.id);
    if (first !== undefined) {
      failures.push({
        cause: "duplicate",
        entry,
        path: outcome.source.path,
        detail: `same leaf id ("${outcome.leaf.id}") as ${first}.`,
      });
      continue;
    }

    seen.set(outcome.leaf.id, entry);
    leaves.push(outcome.leaf);
    leafSources.push(outcome.source);
    policies.push(outcome.policy);
  }

  return {
    ok: true,
    tree: {
      id: treeId(manifest.id),
      company: manifest.company,
      leaves: Object.freeze(leaves),
    },
    source: { path, bytes: bytes.byteLength, readAt: new Date().toISOString() },
    manifest,
    leafSources: Object.freeze(leafSources),
    policies: Object.freeze(policies),
    failures: Object.freeze(failures),
  };
}

/**
 * Every independent reason to believe this tree is an illustration rather than a real company's
 * real people.
 *
 * Signals are collected from BOTH levels and all of them are reported, because either one alone
 * can be lost: someone can strip `"example": true` from a manifest while its leaves still carry
 * it, or assemble a manifest of real-looking paths that happen to point at example documents.
 * Requiring agreement would let either mistake publish fabricated content as a real workplace;
 * requiring EITHER is the safe direction to fail.
 *
 * An empty array means nothing here suggests this is other than real. It is NOT a claim that
 * anything was verified — only `ProofTier` says that, and only per leaflet.
 */
export function fabricationSignals(
  manifest: TreeManifest,
  leafSources: readonly LeafSource[],
): readonly string[] {
  const signals: string[] = [];
  if (manifest.example) signals.push('the tree manifest declares "example": true');
  const fabricated = leafSources.filter((s) => s.declaredExample).length;
  if (fabricated > 0) {
    signals.push(
      `${fabricated} of ${leafSources.length} leaf document${leafSources.length === 1 ? "" : "s"} ` +
        `declare${fabricated === 1 ? "s" : ""} "example": true`,
    );
  }
  return signals;
}

/**
 * HTTP status for a load outcome. Lives here, next to the causes, so the view never makes an
 * HTTP decision and the two cannot drift.
 *
 * 200 for `unconfigured`: that is the first-run state of a correctly working install, and the
 * page explains what to do next. 200 for a tree that loaded WITH failures: the page is a correct
 * rendering of a partially loadable tree and says so on its face — the failures are content, not
 * a transport error.
 *
 * 404 for `absent`, and this is the one place this app disagrees with the leaf app on purpose.
 * A leaf app with no document is an install waiting to be configured, so its 200 is right. A
 * canopy pointed at a manifest path that does not exist has been given a bad address by its
 * operator; answering 200 would tell every uptime check that a dark tenant is healthy.
 *
 * 500 for `unreadable`, `malformed` and `invalid`: the operator handed this app a manifest it
 * could not honour. Answering 200 would mask an outage, which is precisely the pattern this
 * project keeps paying for.
 */
export function httpStatusFor(load: TreeLoad): 200 | 404 | 500 {
  if (load.ok) return 200;
  switch (load.cause) {
    case "unconfigured":
      return 200;
    case "absent":
      return 404;
    case "unreadable":
    case "malformed":
    case "invalid":
      return 500;
    default: {
      const impossible: never = load;
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}
