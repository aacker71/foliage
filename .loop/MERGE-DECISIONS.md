# Merge decisions of record — photosynthesis/prototype ↔ design-page-consolidation

**Why this file exists.** A merge analysis found that thirteen file conflicts between the two
branches hide **five product decisions**, each otherwise decided by whoever resolves a file
first — and two of them (D2, D4) auto-merge with **no conflict markers at all**, so the losing
side becomes dead code that still passes tests. A decision made by arrival order is not a
decision. This file makes each one explicit, names who made it and on what evidence, and says
which side each conflicted file must resolve toward. The merge consults this before it resolves
anything.

Common ancestor `38a8a26`. As of writing: `photosynthesis/prototype` +52 (committed, clean),
`design-page-consolidation` (caracas) +35 (**61 dirty, 23 untracked**). 40 files edited by both.

---

## The five decisions

| id | question | decision | decided by | resolve toward |
|---|---|---|---|---|
| **D1** | does a `pending` leaflet (no signature — every leaflet on a machine without gpg) reach a stranger on the public canopy? | **Show it, standing named** | owner, 2026-08-20 | caracas — its public projection removed the tier gate and states "authorship is NOT cryptographically established". The audit's own finding backs it: 0-of-681-verified would leave an empty hero for every real user. |
| **D2** | at `/leaf/:id`, live projection or frozen published artifact? | **Published artifact** | owner, 2026-08-20 | **CORRECTED 2026-08-20 — I had the branches backwards.** Grep-verified: `PUBLISHED_ROUTE` (`apps/canopy/server.mjs:158`, help text "a published leaf") is in **MY** tree; `PUBLIC_LEAF_ROUTE` (`:409`, `resolvePublicLeaf`) is in **caracas**. So "published artifact" means **keep my `PUBLISHED_ROUTE` (:158), DELETE caracas's `PUBLIC_LEAF_ROUTE` (:409)** — the reverse of what this row first said. It auto-merges into dead code that passes tests, so the loser must be removed, not left. *Semantic caveat, not yet confirmed by reading the handler bodies: that `PUBLISHED_ROUTE` serves a frozen snapshot and `PUBLIC_LEAF_ROUTE` a live re-projection is inferred from the names and my server's help text. Confirm before the merge deletes anything.* |
| **D3** | when history is rewritten so a commit a leaflet rests on no longer exists, does re-intake REMOVE the leaflet or KEEP it? | **OPEN — owner decision** | — | two **contradictory committed tests**: mine `apps/leaf/src/…intake.test.ts:563` "is NOT kept" vs caracas `apps/leaf/src/intakeMerge.seam.test.ts:768` "is KEPT". They cannot both pass. *Recommendation: KEEP, and mark the ref `unresolvable`* — that composes with the freshness model in ENGINEERING-PLAN §9.1 (content-address every ref; a gone ref is `unresolvable`, not a deletion), and silent removal is data loss on the person's own accounting. This is the gate on the `intake.ts` merge. |
| **D4** | is `@foliage/cos-app`'s third-party call licensed in the `open` plane? | **Declared, not assumed** | me, 2026-08-20, committed `d77ee40` | `@foliage/cos` stays `open` (pure, one import edge). `api.fireworks.ai` is now declared in `public-boundary.json`'s `egress` block with its reasoning, enforced by the new `scripts/check-egress.mjs`. Delete the line and the gate goes red — the correct way to overrule this. |
| **D5** | may the loop write git history? | **Reconcile commits; no other role does** | me, 2026-08-20 | `COMMIT = 'reconcile'` supersedes the old "never commit" line — because `.loop/run-once.sh:58` declines to start on a dirty tree, so a non-committing loop blocks every scheduled run after the first. Not two positions; one supersedes the other. |

---

## D2 addendum — applied at the 2026-08-27 fork merge, FLAGGED FOR OWNER REVIEW

D2 was recorded when the two routes were redundant answers to one question. By merge time they
answered two DIFFERENT consent mechanisms: `publish.mjs` crosses a whole reviewed document into
a frozen artifact, and `share --as` offers ONE leaflet through the tree's live projection —
caracas's tree→person→artifact walk (`seam.test.ts`) rides the second and cannot survive a bare
deletion. The merge therefore implemented **precedence, not deletion**, at `/leaf/:id`:

1. a published artifact, when one exists, IS the page (D2 as decided);
2. a BROKEN artifact is refused with its cause and never falls through — tampering must not
   downgrade a page to the other mechanism's rendering;
3. only artifact ABSENCE reaches the projection, so roster links stay walkable;
4. when the tree cannot load either, the artifact route's own honest 404/503 answers.

Both mechanisms' controls pass unweakened. If the owner wants the projection gone outright, the
release→public seam lane owns that cut — it must first re-home the roster's per-leaflet consent
walk. **Also flagged:** D1 (owner: a pending leaflet reaches a stranger, standing named) is
implemented by the PROJECTION path but NOT by the publish gate, which still withholds pending
as "unproven-leaflet" — under precedence, a person who publishes an artifact gets stricter
egress than one who shares leaflets. The seam lane must reconcile D1 against the publish gate;
neither side was changed here because the publish gate's behavior is itself owner-shaped (T5,
titles-only M1) and the tension needs an owner call, not a merge-time guess.

### D1 reconciliation — 2026-09-08 UTC (2026-09-07 local)

The hard-PR integration now applies D1 to the frozen publication path as well as the live
projection. Explicitly offered `pending` titles may cross with their pending tier and
attribution standing preserved; approval does not turn them into `verified`. The publisher
still refuses excluded work and applies visibility, absolute policy deny rules and redaction
before the separate publication decision. Current artifacts also record the reviewed leaf
and policy digests. This supersedes the publish-gate discrepancy in the historical addendum
above; it does not complete hosted publication or UI acceptance. See
[the current Canopy scope](../docs/CANOPY-CLOUD.md).

---

## Not a decision — a correctness requirement

**Caracas's `LEAFLET_KEYS` wins, unconditionally.** Mine is `{id, title, tier, provenance,
reason}`; caracas added `body` and `visibility` (F9). `checkKeys` is all-or-nothing, so **my
validator rejects every document caracas writes.** This is one-way data loss, not a judgement
call: `packages/leaf/src/document.ts` resolves to caracas.

---

## Trunk, and what must transplant either way

**Caracas is trunk.** It holds the product-facing surfaces, the four verified security fixes
(RCE, redirect egress, false `verified`, `%G?` masking), and both owner decisions above resolve
its way. My branch's contributions transplant onto it:

- `@foliage/cos` + `@foliage/cos-app` — the local chief of staff (whole packages, no conflict).
- `tools/loop/findings.mjs` + `.loop/FINDINGS.md` — the ratchet that stops a fixed defect going unguarded.
- `tools/verify/serving.mjs` — a socket answering is not a surface working (F-005).
- `scripts/check-egress.mjs` + the `egress` block — D4's enforcement.
- ~~The loop's per-item context clip must land in caracas.~~ **RETRACTED 2026-08-20 — this was
  wrong.** I claimed caracas had "3 bare `.slice()` sites" from a `grep -c` that counted the
  literal string inside COMMENTS describing the old bug, and never read the file. Caracas's loop is
  **already fixed**: it has the `clip()`/`digest()` helpers and its reconciler is fed
  `clip(verdict, 9000)` under the heading "ADVERSARY VERDICT — read this; earlier runs never
  received it." Its own comment says the fix was "Ported from the cos tree's fix,
  origin/backup/cos-tree-20260820" — i.e. from my branch; the convergence already resolved. The
  C9/X9/X10 rows I cited describe runs from BEFORE that fix, not the current loop. Nothing to
  transplant here. Left visible rather than deleted, because a retraction that hides the error
  teaches nothing.
- The `args`-not-an-object guard (already upstream on my branch as `1c0e61a`).

---

## What still blocks the merge (D1/D2 no longer do)

1. **Caracas must commit** — 61 dirty + 23 untracked, including the security fixes. You cannot
   merge uncommitted work, and a `git checkout --` in that tree already destroyed one uncommitted
   change this session.
2. **The concurrent session must go quiet** — `apps/canopy/src/renderPublic.ts` and
   `apps/leaf/public/leaf.css` are dirty and being edited. Merging across a live session is the
   third file-ownership incident waiting to happen.
3. **D3 must be answered** before `apps/leaf/intake.ts` resolves — the two tests cannot coexist.
