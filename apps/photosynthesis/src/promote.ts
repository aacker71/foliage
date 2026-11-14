/**
 * PROMOTE — the airlock door: approved candidates become PENDING leaflets.
 *
 * Four rules, each one a defect if broken:
 *
 *   1. ONLY approved candidates cross. No status other than `approved` is ever carried,
 *      by any path in this file, including the repair paths below.
 *
 *   2. EVERYTHING PROMOTED IS `pending`. The `verified` tier is signature-only (owner
 *      decision of record, 2026-08-16) and no AI pipeline may mint it. Pending is the
 *      honest tier for "a human approved this description; nothing cryptographic
 *      attests it" — and the leaf page already explains pending is terminal-unless-
 *      signed, so nothing here overstates.
 *
 *   3. THE OUTPUT IS RE-PARSED BEFORE IT IS WRITTEN, and so is the INPUT. The existing
 *      leaf goes through `parseLeafDocument` before anything is merged, and the merged
 *      document goes through it again before anything is written. The two failures are
 *      reported as DIFFERENT named causes ("existing leaf invalid at …" vs "merged leaf
 *      invalid at …") because they mean opposite things: the first says the file on disk
 *      was already broken, the second says this promotion would have broken it. Either
 *      way nothing is written. A promotion can fail; it can never half-write.
 *
 *   4. BOTH WRITES ARE TEMP-FILE + RENAME. `promote` documents an all-or-nothing
 *      guarantee, and plain `writeFile` truncates in place — a process that dies mid
 *      syscall leaves a leaf document that is neither the old one nor the new one.
 *      Rename on the same filesystem is atomic, which makes the documented guarantee
 *      the actual mechanism. (`review-server.mjs` already did this for the file it
 *      writes itself; the guarantee it cited lived only in this file's prose.)
 *
 * IDEMPOTENCE IS AGAINST THE LEAF, NOT AGAINST THE HARVEST. This is the part that
 * changed, and the reason is a reproduced data-loss defect (ledger row P2, 2026-08-18):
 * `intake --force` rewrote a leaf document whole and dropped two human-approved
 * leaflets, while the harvest still carried `promotedAt` on both candidates. The old
 * rule — "a candidate with `promotedAt` is skipped forever" — made that damage
 * PERMANENT: the harvest kept insisting work it could no longer see had already been
 * done, and no re-run could put it back.
 *
 * So `promotedAt` no longer means "was once promoted somewhere". After any successful
 * run of this function the invariant is:
 *
 *     promotedAt is set  ⟺  the candidate's leaflet is present in the leaf it targets
 *
 * which is checkable, self-healing in both directions, and is the invariant whose
 * violation made P2 unrecoverable. Four cases fall out of it, and each is reported by
 * id so a repair is never mistaken for a fresh approval:
 *
 *   promoted             marked? no · in leaf? no   → carried for the first time
 *   repromotedMissing    marked? yes · in leaf? no  → REPAIR: the leaflet was destroyed
 *                                                     downstream; carry it again
 *   markedAlreadyPresent marked? no · in leaf? yes  → REPAIR the other way: the leaflet
 *                                                     is there and the harvest did not
 *                                                     know (a crash between the two
 *                                                     writes below does exactly this)
 *   skippedAlreadyPromoted marked? yes · in leaf? yes → nothing to do
 *
 * A repair NEVER re-decides anything. `status` and `reviewedAt` — the record of what a
 * human actually said and when — are carried through untouched by every path here; only
 * `promotedAt`, which is a fact about a file rather than about a person, is refreshed.
 *
 * The consequence worth stating plainly: promotion is defined against the leaf you NAME.
 * Point this at a different leaf document and every approved candidate is carried into
 * it, because `promotedAt` records that a leaflet exists, not which file it lives in.
 * That is the same operation as promoting into a fresh leaf, and it is reported by id.
 *
 * The leaflet's provenance says exactly what happened: source "photosynthesis", ref =
 * the candidate's first evidence ref (a real sha or photo digest), observedAt = the
 * instant this leaflet was written into this leaf (so on a repair it is the repair
 * instant, which is the truth about this document). The drafted title becomes the
 * leaflet title — machine-drafted, human-approved prose, which is why the candidate id
 * is carried in the leaflet id: the harvest document remains the audit trail from title
 * back to evidence, and the id is what lets this function ask "is it still there?".
 *
 * Complexity: O(candidates + leaflets), one pass each, one Set of existing leaflet ids.
 */

import { readFile } from "node:fs/promises";

import { parseLeafDocument } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";

import { parseHarvestDocument, type Candidate, type HarvestDocument } from "./harvestDocument.ts";

export interface PromotionResult {
  readonly ok: boolean;
  /** Approved candidates carried into the leaf for the first time, by candidate id. */
  readonly promoted: readonly string[];
  /**
   * REPAIR, by candidate id: the harvest said promoted, the leaf did not hold the
   * leaflet, so it was carried again. Not a new approval — the human decision it
   * carries is the one already recorded in `reviewedAt`.
   */
  readonly repromotedMissing: readonly string[];
  /**
   * REPAIR the other way, by candidate id: the leaflet was already in the leaf and the
   * harvest carried no mark, so the mark was written. Nothing was added to the leaf.
   */
  readonly markedAlreadyPresent: readonly string[];
  /** Marked promoted AND present in the leaf. Nothing to do — by candidate id. */
  readonly skippedAlreadyPromoted: readonly string[];
  readonly skippedNotApproved: number;
  readonly issues: readonly string[];
}

/**
 * The leaflet id a candidate becomes. EXPORTED because it is the join key between the
 * two documents: anything that needs to ask "is this candidate's work in that leaf?"
 * must derive the id the same way, and a second copy of the rule would drift the first
 * time either side changed.
 */
export const PROMOTED_ID_PREFIX = "photosynthesis-";

export function promotedLeafletId(candidateId: string): string {
  return `${PROMOTED_ID_PREFIX}${candidateId}`;
}

const NOTHING = {
  promoted: [],
  repromotedMissing: [],
  markedAlreadyPresent: [],
  skippedAlreadyPromoted: [],
  skippedNotApproved: 0,
} satisfies Omit<PromotionResult, "ok" | "issues">;

/** Refuse with named causes, carrying whatever counting had already been done honestly. */
function refused(issues: readonly string[], counted: Partial<PromotionResult> = {}): PromotionResult {
  return { ok: false, ...NOTHING, ...counted, issues };
}

function toLeaflet(c: Candidate, instant: string): Record<string, unknown> {
  const first = c.evidence[0];
  return {
    id: promotedLeafletId(c.id),
    title: c.drafted.title,
    tier: "pending",
    provenance: {
      source: "photosynthesis",
      ref: first === undefined ? "unknown" : `${first.source}:${first.ref}`,
      observedAt: instant,
    },
  };
}

/** Rule 4. Never observed half-written; never truncated in place. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  writeDocument(path, JSON.stringify(value, null, 2) + "\n");

}

/**
 * Merge approved candidates into the leaf document at `leafPath`, updating the harvest
 * at `harvestPath` with `promotedAt` marks IN THE SAME CALL — the leaf is validated and
 * written first, then the harvest mark, which is what makes the operation idempotent on
 * the next run.
 *
 * The write order is deliberate and the failure between the two is survivable: if the
 * process dies after the leaf write and before the harvest write, the next run sees the
 * leaflet present with no mark and repairs it as `markedAlreadyPresent`. The reverse
 * order would lose the leaflet with a mark claiming it exists — which is P2 again.
 */
export async function promote(harvestPath: string, leafPath: string): Promise<PromotionResult> {
  return withDocumentLocks([harvestPath, leafPath], () => promoteLocked(harvestPath, leafPath));
}

async function promoteLocked(harvestPath: string, leafPath: string): Promise<PromotionResult> {
  let harvest: HarvestDocument;
  try {
    const parsed = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
    if (!parsed.ok) return refused(parsed.issues.map((i) => `harvest invalid at ${i.at}: ${i.message}`));
    harvest = parsed.harvest;
  } catch (err) {
    return refused([`harvest unreadable: ${err instanceof Error ? err.message : String(err)}`]);
  }

  let leafJson: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(await readFile(leafPath, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return refused(["leaf document is not an object"]);
    }
    leafJson = raw as Record<string, unknown>;
  } catch (err) {
    return refused([`leaf unreadable: ${err instanceof Error ? err.message : String(err)}`]);
  }

  // RULE 3, first half. The leaf on disk is the thing idempotence is measured against, so
  // a document this function cannot read is a NAMED refusal and not a fall-through:
  // treating an unparseable leaf as "no leaflets present" would re-promote everything on
  // top of a file whose contents are unknown.
  const before = parseLeafDocument(leafJson);
  if (!before.ok) {
    return refused(before.issues.map((i) => `existing leaf invalid at ${i.at}: ${i.message}`));
  }
  const presentIds = new Set<string>(before.leaf.leaflets.map((l) => l.id));

  const instant = new Date().toISOString();
  const toCarry: Candidate[] = []; // first-time promotions
  const toHeal: Candidate[] = []; // marked promoted, leaflet gone
  const toMark: Candidate[] = []; // leaflet present, mark missing
  const alreadyPromoted: string[] = [];
  let notApproved = 0;

  for (const c of harvest.candidates) {
    // RULE 1, enforced before anything else looks at the leaf: a candidate a human did
    // not approve is invisible to every path below, repairs included.
    if (c.status !== "approved") {
      notApproved++;
      continue;
    }
    const inLeaf = presentIds.has(promotedLeafletId(c.id));
    const marked = c.promotedAt !== undefined;
    if (marked && inLeaf) alreadyPromoted.push(c.id);
    else if (marked) toHeal.push(c);
    else if (inLeaf) toMark.push(c);
    else toCarry.push(c);
  }

  const additions = [...toCarry, ...toHeal].map((c) => toLeaflet(c, instant));
  if (additions.length === 0 && toMark.length === 0) {
    return {
      ok: true,
      ...NOTHING,
      skippedAlreadyPromoted: alreadyPromoted,
      skippedNotApproved: notApproved,
      issues: [],
    };
  }

  const counted: Partial<PromotionResult> = {
    skippedAlreadyPromoted: alreadyPromoted,
    skippedNotApproved: notApproved,
  };

  if (additions.length > 0) {
    // Existing leaflets are carried forward BYTE-IDENTICAL: the merge appends to the raw
    // array from disk, never to the parsed-and-normalised one. Re-serialising someone's
    // leaflet through this function's idea of the shape is how a field nobody meant to
    // touch changes.
    const existing = Array.isArray(leafJson["leaflets"]) ? (leafJson["leaflets"] as unknown[]) : [];
    const merged = { ...leafJson, leaflets: [...existing, ...additions] };

    // RULE 3, second half: invalid merge → nothing written anywhere.
    const after = parseLeafDocument(merged);
    if (!after.ok) {
      return refused(
        after.issues.map((i) => `merged leaf invalid at ${i.at}: ${i.message}`),
        counted,
      );
    }
    await writeJsonAtomic(leafPath, merged);
  }

  const marking = new Set<string>([...toCarry, ...toHeal, ...toMark].map((c) => c.id));
  const updatedHarvest = {
    ...harvest,
    candidates: harvest.candidates.map((c) =>
      marking.has(c.id) ? { ...c, promotedAt: instant } : c,
    ),
  };
  try { await writeJsonAtomic(harvestPath, updatedHarvest); }
  catch (error) {
    return refused([`Leaf is present at ${leafPath}, but harvest marking failed at ${harvestPath}: ${error instanceof Error ? error.message : String(error)}. Retry promotion to repair the marks without duplicating leaflets.`], { ...counted, promoted: toCarry.map(c => c.id), repromotedMissing: toHeal.map(c => c.id) });
  }

  return {
    ok: true,
    promoted: toCarry.map((c) => c.id),
    repromotedMissing: toHeal.map((c) => c.id),
    markedAlreadyPresent: toMark.map((c) => c.id),
    skippedAlreadyPromoted: alreadyPromoted,
    skippedNotApproved: notApproved,
    issues: [],
  };
}
