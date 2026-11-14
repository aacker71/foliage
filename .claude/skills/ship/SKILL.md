---
name: ship
description: Ship Foliage work — reconcile lanes, run the full gate, commit per lane, push after green, prove it. Use when asked to "ship", "push", "land this", or at the end of any build session with uncommitted lane work. Encodes the discipline that has actually held on this repo; never force-pushes, never ships a red gate, never publishes past the X3 boundary.
---

# /ship — the Foliage shipping discipline

A ship is DONE when the commits are on the private origin with the gate green and the
evidence stated. "Committed" is not shipped; "pushed with a red gate" is not shipped;
"pushed to anywhere public" is forbidden until X3 is decided (see Rails).

## 0 · Where and what

Work happens on the **branch of record** (`design-page-consolidation` unless the ledger
says otherwise). Verify before anything:

```bash
git branch --show-current
git fetch origin
git rev-list --count origin/$(git branch --show-current)..HEAD   # ahead
git rev-list --count HEAD..origin/$(git branch --show-current)   # behind — MUST be 0
```

Behind ≠ 0 means another session moved the branch: STOP, read the incoming commits,
reconcile deliberately. Never rebase away someone's work; never force-push, ever.

## 1 · Reconcile — only this step writes history

Build lanes return WITHOUT committing (parallel lanes racing `.git/index.lock` is a
recorded failure in this lineage). The reconciler — one session, this skill — does:

1. `git status --porcelain` — every file must belong to a known lane. A file no lane
   claims is a finding, not something to sweep into a commit.
2. Read the diff of anything that touches a TEST — an assertion may be retargeted
   (route moves) but never weakened. A control test (fabrication band, no-score,
   boundary) that fails is a product regression until proven otherwise: fix the
   product, not the test.
3. Run the FULL gate on the combined tree: `pnpm check` (boundary → egress → dup → findings → typecheck → every
   test). It must exit 0. A red gate blocks the ship — no exceptions, no "just this
   once". Report the failing test verbatim if blocked.
4. Commit PER LANE, staging named files only (`git add <files>` — never `-A`, never
   `.`). Message style is the repo's: lowercase prefix, an em-dash clause, what the
   change MEANS, not what it does. One lane, one commit; a reconcile fix rides with
   the lane it fixes and the message says so.

## 2 · Push after green

The standing rule (owner-endorsed): every green reconcile pushes. Work pooling on one
laptop is a single point of loss and a fork risk this lineage has paid ~86% throwaway
work for once already.

```bash
git push origin $(git branch --show-current)
git rev-list --count @{u}..HEAD   # must print 0
```

CI note: `ci.yml` runs on `main` pushes and PRs only — a branch push triggers nothing,
BY DESIGN. To exercise the off-machine boundary gate, open a draft PR to `main`
(`gh pr create --draft`) — ask the owner first; a PR is a surface others see.

## 3 · Prove it, then record it

- State the pushed range (`old..new`), the gate count, and behind=0, from commands you
  just ran — never from memory.
- Update the working memory: tick the lane in `task_plan.md`, append the ship to
  `progress.md` with the range and gate count. If a durable decision was made, it goes
  to gbrain (`gbrain put … --quiet` — always `--quiet` in automated calls).
- `pnpm verify` against the running surfaces when the ship changed anything a browser
  renders; screenshots are evidence, DOM reads are not.

## Rails (non-negotiable)

- **Release boundary**: the code is MIT (`LICENSE`). Publishing a repository, a tarball or an npm package is an owner decision; do not do it unasked.
- **Never**: force-push · `git add -A` · commit through a red gate · amend or rebase
  pushed history · fabricate or approximate a test count — paste the real one.
- **No fake data** in anything shipped: fixtures declare themselves on their face, and
  the differential control (example doc → band present; real doc → band absent) must
  hold wherever leaf-derived numbers render.
- If any step surprises you (unexpected dirty files, a behind-count, a gate failure
  that looks unrelated), STOP and surface it. A reported blocker is fine; a shipped
  surprise is a failure.
