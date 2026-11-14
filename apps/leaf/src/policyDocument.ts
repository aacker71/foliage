/**
 * WHERE THE PUBLISH POLICY IS READ FROM — the disk half, kept out of `policy.ts` on purpose.
 *
 * `policy.ts` is pure and `render.ts` imports it; a renderer whose import graph reaches
 * `node:fs` is one careless line away from reading a file while rendering a page, which is the
 * kind of thing that is impossible to see in a diff and obvious in a flame graph. So the file
 * read lives here, alone, exactly as `leafDocument.ts` holds the leaf document's read and
 * `share.ts` holds none.
 *
 * TWO BEHAVIOURS ARE THE WHOLE POINT OF THIS FILE, and both are the conservative direction:
 *
 *   NO FILE MEANS THE SHIPPED DEFAULT, AND THE SURFACE SAYS SO. `PolicySource` travels in the ok
 *   arm and every caller prints it. A fallback that does not announce itself breaks the "report
 *   both causes" rule: the subject would read a decision with no way to tell whether it came
 *   from rules they wrote or rules they have never seen.
 *
 *   A FILE THAT EXISTS AND CANNOT BE UNDERSTOOD IS A HARD FAILURE, NOT A FALLBACK. Quietly
 *   reverting to the default when someone's own file has a typo is the dangerous direction of
 *   every "safe default": their file may be STRICTER than the default, and swapping it for
 *   something looser at the moment it breaks is how a typo becomes an exposure. The load fails
 *   with the cause named and `../server.mjs` serves nothing from the document until it is fixed.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PUBLISH_POLICY_DOCUMENT,
  parsePublishPolicy,
  type PublishPolicy,
  type PublishPolicyIssue,
} from "@foliage/leaf";

/** The environment variable that names a policy document. `--policy` beats it; both are printed. */
export const POLICY_ENV = "FOLIAGE_POLICY";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where a policy lives by default: beside the leaf document it governs, in the app directory
 * rather than in `public/`. Gitignored for the same reason `leaf.json` is — a real person's rules
 * name their real evidence refs, and one of the default rails is a commit sha away from being a
 * list of what they refused to publish.
 */
export const DEFAULT_POLICY_PATH = resolve(APP_DIR, "policy.json");

/**
 * WHICH RULES WERE APPLIED, carried beside them so no surface has to guess.
 *
 * `default` is not a failure and not an absence: it is the shipped document, which the subject
 * can print with `policy.mjs show` and copy into a file of their own.
 */
export type PolicySource =
  | {
      readonly kind: "default";
      /**
       * The path that was actually looked at and found absent — NOT the compiled-in default.
       * Naming the compiled-in one while `FOLIAGE_POLICY` points somewhere else sends the
       * subject to edit a file the product is not reading, which is the same failure as a
       * loader that reports "no document" without saying where it searched.
       */
      readonly searched: string;
    }
  | { readonly kind: "file"; readonly path: string };

/**
 * A policy load: the rules, or every reason there are none.
 *
 * FOUR NAMED CAUSES and never a null. `unconfigured` (set-but-blank) is separate from `absent`
 * for the same reason it is in `loadLeafDocument`: answering "no policy at <default>" to someone
 * staring at the `FOLIAGE_POLICY` they believe they set sends them to the wrong file.
 *
 * There is deliberately no `absent` FAILURE arm — an absent policy file is a successful load of
 * the default, reported through `source`.
 */
export type PolicyLoad =
  | {
      readonly ok: true;
      readonly policy: PublishPolicy;
      readonly source: PolicySource;
      /** Digest of the effective rules and where they came from, not a second file read. */
      readonly policyDigest: string;
    }
  | {
      readonly ok: false;
      readonly cause: "unconfigured";
      readonly detail: string;
      readonly path: null;
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
      readonly issues: readonly PublishPolicyIssue[];
    };

/**
 * The default rules, parsed by the same gate as anyone's.
 *
 * `defaultPublishPolicy()` returns a parse RESULT because it is total; a parse failure there
 * would be a bug in the constant rather than in any input, and `@foliage/leaf` pins it with a
 * test. This app still has to do something with the impossible arm, and what it does is treat it
 * as an empty policy — no rails and no proposals — rather than throwing. That direction is a
 * judgement call and it is the wrong-looking one, so it is argued: an empty policy withholds
 * every PROPOSAL (fail-closed, `no-rule-matched`) and its only cost is that the four default
 * rails stop firing. Throwing here would take down the leaf server on a bug in a constant, which
 * publishes nothing but also serves nothing, and the subject cannot fix it.
 */
function defaultRules(): PublishPolicy {
  const parsed = parsePublishPolicy(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  return parsed.ok ? parsed.policy : { rules: [] };
}

/** Bind a review to the effective rules and whether they were defaults or an explicit file. */
export function effectivePolicyDigest(policy: PublishPolicy, source: PolicySource): string {
  // Paths stay private and do not affect policy semantics. The source KIND remains because an
  // explicit file that happens to match today's default is still a different operator decision.
  const bytes = Buffer.from(JSON.stringify({ source: source.kind, policy }), "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Load the policy that governs this leaf.
 *
 * `override` is the CLI's `--policy` flag: it beats the environment, which beats the default
 * path. Absent file → the default rules, said out loud through `source`. Present-and-broken →
 * a named failure, never a silent downgrade (decision 2 in the header).
 */
export async function loadPublishPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
  override: string | null = null,
): Promise<PolicyLoad> {
  if (override !== null && override.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail: `--policy was given an empty path, so no policy document could be determined.`,
      path: null,
    };
  }
  const configured = override ?? env[POLICY_ENV];
  if (override === null && configured !== undefined && configured.trim() === "") {
    return {
      ok: false,
      cause: "unconfigured",
      detail:
        `${POLICY_ENV} is set but blank, so no policy document could be determined. Either ` +
        `unset it — the default is then ${DEFAULT_POLICY_PATH}, and an absent file means the ` +
        `shipped default rules — or set it to the path of your policy document.`,
      path: null,
    };
  }
  const path = configured === undefined ? DEFAULT_POLICY_PATH : resolve(configured.trim());

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
    // THE ONLY FALLBACK, AND IT IS ANNOUNCED. No file is the ordinary state of a subject who has
    // never written one, so it is a success carrying `source: default` rather than an error.
    if (code === "ENOENT") {
      const policy = defaultRules();
      const source = { kind: "default", searched: path } as const;
      return { ok: true, policy, source, policyDigest: effectivePolicyDigest(policy, source) };
    }
    return {
      ok: false,
      cause: "unreadable",
      detail:
        `${path} exists as far as this process can tell, but could not be read: ` +
        `${err instanceof Error ? err.message : String(err)} [${code}]`,
      path,
      errno: code,
    };
  }

  // A BOM survives a text editor and then breaks JSON.parse at position 0, blaming the first
  // token. Same strip as the leaf and harvest loaders, for the same hour nobody should lose.
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      cause: "malformed",
      detail: `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      path,
    };
  }

  const parsed = parsePublishPolicy(json);
  if (!parsed.ok) {
    return {
      ok: false,
      cause: "invalid",
      detail:
        `${path} is valid JSON but is not a publish policy: ${parsed.issues.length} problem(s), ` +
        `every one of them listed below. Nothing is served outward until this file parses — a ` +
        `policy that cannot be read cannot be applied, and falling back to different rules at ` +
        `the moment yours breaks is how a typo becomes an exposure.`,
      path,
      issues: parsed.issues,
    };
  }
  const source = { kind: "file", path } as const;
  return {
    ok: true,
    policy: parsed.policy,
    source,
    policyDigest: effectivePolicyDigest(parsed.policy, source),
  };
}

/** Which document a load came from, as one line a surface can print verbatim. */
export function describePolicySource(source: PolicySource): string {
  return source.kind === "default"
    ? `the shipped default rules (no policy document at ${source.searched})`
    : source.path;
}
