/**
 * Loading a COMPANY: the trunk, its boughs, their branches, and the people on them.
 *
 * Same discipline as every other loader here — a discriminated union, never a zero. A
 * company whose manifest is missing must not render as a company with no people; an org
 * chart of zeros is the most convincing lie this product could tell, because it looks
 * exactly like a real company that has not onboarded anyone.
 *
 * PARTIALLY LOADABLE, like the tree one level up. A manifest naming forty people whose
 * thirty-ninth document is malformed renders thirty-nine and SAYS SO. The alternative —
 * quietly rendering thirty-nine — reports an organization that does not exist.
 *
 * RELEASE STATE LIVES BESIDE THE ORG CHART, NOT INSIDE IT. The chart says who is where;
 * the state store says what each person's leaf is permitted to be. Keeping them apart is
 * what lets a re-org rewrite the chart without touching a single release decision, and
 * it is why `applyEvent` is the only thing that ever changes a state.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseLeafDocument, type Leaf, type LeafDocumentIssue } from "@foliage/leaf";
import {
  boughId,
  branchId,
  type Bough,
  type Branch,
  type CompanyTree,
} from "@foliage/enterprise-policy";

const COMPANY_ENV = "FOLIAGE_COMPANY";

/** One person's slot on the chart: a display name is NOT enough, a leaf document is. */
interface LeafRef {
  readonly path: string;
}

export interface CompanyLoadFailure {
  readonly cause: "absent" | "unreadable" | "malformed" | "invalid" | "duplicate";
  readonly entry: string;
  readonly path: string;
  readonly detail: string;
  readonly issues?: readonly LeafDocumentIssue[];
}

export type CompanyLoad =
  | {
      readonly ok: true;
      readonly tree: CompanyTree;
      readonly source: { readonly path: string; readonly bytes: number; readonly readAt: string };
      readonly failures: readonly CompanyLoadFailure[];
      /** How many people the manifest NAMED, so the page can compare against what loaded. */
      readonly named: number;
    }
  | {
      readonly ok: false;
      readonly cause: "unconfigured" | "absent" | "unreadable" | "malformed" | "invalid";
      readonly detail: string;
      readonly path: string | null;
      readonly issues?: readonly LeafDocumentIssue[];
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Load one leaf named on the chart. Failures are returned, never thrown, so one bad
 * document cannot take down the whole company.
 */
async function loadLeaf(
  entry: string,
  path: string,
): Promise<{ ok: true; leaf: Leaf } | { ok: false; failure: CompanyLoadFailure }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
    return {
      ok: false,
      failure: {
        cause: code === "ENOENT" ? "absent" : "unreadable",
        entry,
        path,
        detail:
          code === "ENOENT"
            ? `no leaf document at ${path}`
            : `${path} could not be read: ${err instanceof Error ? err.message : String(err)} [${code}]`,
      },
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch (err) {
    return {
      ok: false,
      failure: { cause: "malformed", entry, path, detail: `${path} is not valid JSON: ${String(err)}` },
    };
  }
  const parsed = parseLeafDocument(json);
  if (!parsed.ok) {
    return {
      ok: false,
      failure: {
        cause: "invalid",
        entry,
        path,
        detail: `${path} is valid JSON but is not a leaf document (${parsed.issues.length} problem(s))`,
        issues: parsed.issues,
      },
    };
  }
  return { ok: true, leaf: parsed.leaf };
}

/** Recursively build a team and its sub-teams from the manifest. */
async function buildBranch(
  raw: unknown,
  at: string,
  base: string,
  failures: CompanyLoadFailure[],
  named: { count: number },
): Promise<Branch | null> {
  if (!isRecord(raw) || !nonEmpty(raw["id"]) || !nonEmpty(raw["name"])) return null;
  const leaves: Leaf[] = [];
  for (const ref of Array.isArray(raw["leaves"]) ? raw["leaves"] : []) {
    if (!isRecord(ref) || !nonEmpty(ref["path"])) continue;
    named.count++;
    const path = resolve(base, (ref as unknown as LeafRef).path);
    const result = await loadLeaf((ref as unknown as LeafRef).path, path);
    if (result.ok) leaves.push(result.leaf);
    else failures.push(result.failure);
  }
  const branches: Branch[] = [];
  for (const child of Array.isArray(raw["branches"]) ? raw["branches"] : []) {
    const built = await buildBranch(child, `${at}.branches`, base, failures, named);
    if (built !== null) branches.push(built);
  }
  return { id: branchId(raw["id"]), name: raw["name"], branches, leaves };
}

export async function loadCompany(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CompanyLoad> {
  const configured = env[COMPANY_ENV];
  if (configured === undefined || configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail: `${COMPANY_ENV} is not set. Point it at a company manifest — the org chart, naming each person's leaf document.`,
      path: null,
    };
  }
  const path = resolve(configured.trim());

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
    return {
      ok: false,
      cause: code === "ENOENT" ? "absent" : "unreadable",
      detail:
        code === "ENOENT"
          ? `No company manifest at ${path} (from ${COMPANY_ENV}).`
          : `${path} could not be read: ${err instanceof Error ? err.message : String(err)} [${code}]`,
      path,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch (err) {
    return { ok: false, cause: "malformed", detail: `${path} is not valid JSON: ${String(err)}`, path };
  }

  if (!isRecord(json) || !nonEmpty(json["company"]) || !Array.isArray(json["boughs"])) {
    return {
      ok: false,
      cause: "invalid",
      detail: `${path} is valid JSON but is not a company manifest — it needs "company" and a "boughs" array.`,
      path,
    };
  }

  const base = dirname(path);
  const failures: CompanyLoadFailure[] = [];
  const named = { count: 0 };
  const boughs: Bough[] = [];

  for (const raw of json["boughs"]) {
    if (!isRecord(raw) || !nonEmpty(raw["id"]) || !nonEmpty(raw["name"])) continue;
    const leaves: Leaf[] = [];
    for (const ref of Array.isArray(raw["leaves"]) ? raw["leaves"] : []) {
      if (!isRecord(ref) || !nonEmpty(ref["path"])) continue;
      named.count++;
      const result = await loadLeaf(ref["path"], resolve(base, ref["path"]));
      if (result.ok) leaves.push(result.leaf);
      else failures.push(result.failure);
    }
    const branches: Branch[] = [];
    for (const child of Array.isArray(raw["branches"]) ? raw["branches"] : []) {
      const built = await buildBranch(child, "boughs", base, failures, named);
      if (built !== null) branches.push(built);
    }
    boughs.push({ id: boughId(raw["id"]), name: raw["name"], branches, leaves });
  }

  return {
    ok: true,
    tree: { id: nonEmpty(json["id"]) ? json["id"] : "company", company: json["company"], boughs },
    source: { path, bytes: bytes.byteLength, readAt: new Date().toISOString() },
    failures,
    named: named.count,
  };
}

export function httpStatusFor(load: CompanyLoad): 200 | 404 | 500 {
  if (load.ok) return 200;
  if (load.cause === "unconfigured") return 200;
  if (load.cause === "absent") return 404;
  return 500;
}
