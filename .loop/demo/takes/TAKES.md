# TAKES — filming Beats 2-5 without touching the live garden

This is the runbook for the two kinds of footage the demo needs, and they are shot two
different ways on purpose:

- **Beat 2 writes state** (grow, review, promote), so it needs something a bad take can undo.
  That is `take.sh` in this directory — see [`take.sh`](./take.sh). Every run is a fresh,
  disposable garden grown from this repository's own real commits; a bad take is `rm -rf` of
  the one directory it printed, then run it again.
- **Beats 3-5 only read** the owner's live portfolio (235 leaflets as of 2026-08-29, headline
  *"A portfolio that grows as I work."*). There is nothing to reset because nothing gets
  written — a bad take there is just rolling the camera again on the same, unchanged page. The
  one rule for this half is the mirror image of Beat 2's: **never run anything against
  `~/.foliage` that could write to it.**

`.loop/DEMO-SCRIPT.md` walks the product's full thesis but predates the owner's 5-beat
demo-rebuild structure, which is the spec of record for what actually gets filmed now (title
card, Beats 2-5, end card). Its in-repo artifact is `.loop/demo/CAPTIONS.md` — the owner-approved
caption sheet for all five beats. This file is only the shooting mechanics for that structure's
Beat 2-5 half.

---

## Beat 2 — grow, review, promote (the take-garden)

### 1. Shoot the take

```
.loop/demo/takes/take.sh
```

With no arguments this creates a brand-new temp directory (`mktemp -d`, never inside this repo
and never `~/.foliage`), then runs `foliage.mjs grow` against it using **this repo's own real
git history** — the same `intake.mjs`/`harvest.mjs` a real user's install runs, over real
commits, with no fixture and no hand-written leaflet. It prints the take-garden's path and the
grow counts. A real run on 2026-08-29 read 222 non-merge commits and drafted 35 candidates;
your numbers will differ, because they are real — see DEMO-SCRIPT.md's own note on this.

**A bad take:**

```
rm -rf "<the printed path>"
.loop/demo/takes/take.sh
```

Nothing is patched or resumed. Every take starts from zero.

### 2. Open it in the browser

```
FOLIAGE_GARDEN="<the printed path>" node foliage.mjs up --port 4210
```

(4210, not the 4173-4199 band other long-running demo servers use — see the project CLAUDE.md's
Gotchas.) Then open `http://127.0.0.1:4210/review`. This is what the camera sees first: real
drafted candidates, clustered from real commits, all unreviewed.

### 3. Approve one, reject one, on camera

Both decisions go through the browser form. `apps/leaf/server.mjs`'s `recordDecision` and
`harvest.mjs`'s `decide()` are two separate implementations, not one shared function, but they
enforce the same rules over the same file — a reviewer name required, a reason required to
reject, no re-deciding a decided candidate — by design (`server.mjs`'s own comment: a browser
that could record what the terminal refuses would make the document's rules a matter of which
tool you happened to use). Type a real name in **Reviewer** for both.

- **Approve** one candidate. Reviewer is required; whatever is typed in Reason is not recorded
  on an approval — the product only stores `reason` on a rejection (`render.ts`'s
  `decisionForm`, `server.mjs`'s `recordDecision`). If you want an
  on-camera reason for approving, say it in **In your own words**, which retitles the leaflet
  in the reviewer's own attributed words instead — a real product feature, not a workaround.
- **Reject** a different candidate. Reviewer AND Reason are both required here — reason is
  the field the gate actually enforces (`400`, `data-refusal="missing-reason"` on empty). Type
  a real, specific reason tied to what that candidate's evidence actually shows — "config
  churn, not attributable engineering work" is a real reason; "test" is not one a real reviewer
  would write and reads as fake data dressed as a decision.

Reload `/review`: the counts strip now reads `N-2 unreviewed · 1 approved · 1 rejected`, and
each decided card shows who decided it and when, in place — that record IS the audit trail,
not a banner claiming one exists.

### 4. The browser promote panel

Below the candidate list, the page renders **"Into the leaf"** with one button: `Carry 1 into
the leaf`. Click it. This posts to `/promote`, which takes **no `--doc`/`--into` parameters at
all** — it reads `FOLIAGE_LEAF`/`FOLIAGE_HARVEST` from the environment `foliage up` was started
with, which is exactly the take-garden from step 1. There is no way to point this button at the
wrong document; that is what makes it safe against F-014 (below) by construction, not by a
check.

### 5. Re-export

```
FOLIAGE_GARDEN="<the printed path>" node foliage.mjs export --out <some dir> --confirm
```

Exit 0, and the printed line says how many leaflets and confirms no title carries an email
address. Open `<some dir>/index.html` — the newly-promoted leaflet is on the page, tier
**Pending** (never Verified — a human approving a draft is not a cryptographic proof, and the
product does not conflate the two), title marked `data-authored="drafted-title"` because a
machine drafted it and a person has only approved it, not written it.

---

## Beats 3-5 — the live garden, read-only

These beats film `~/.foliage` — the owner's real, growing portfolio, 235 leaflets as of
2026-08-29, headline *"A portfolio that grows as I work."* Nothing in this section writes to
it. If an instance is not already running:

```
node foliage.mjs up            # NO --garden, NO FOLIAGE_GARDEN — the default IS ~/.foliage
```

- **Beat 3** — `/leaf` (Portfolio in the personal navigation, formerly My Leaf): the headline,
  the Pending tier, a real leaflet opened.
- **Beat 4** — the *published* leaf (`foliage export` output, or a leaflet shared by link):
  name, headline, tier label **Attributed, unverified** — the same honesty distinction Beat 2
  just demonstrated on a fresh leaflet, now shown on the accumulated real portfolio.
- **Beat 5** — the canopy tree view, one row per person, counts only:

  ```
  FOLIAGE_TREE="$HOME/.foliage/tree.json" node apps/canopy/server.mjs
  ```

  (canopy defaults to port 4173; it only reads `FOLIAGE_TREE`/the leaf documents it names —
  there is no write path in this app at all.)

Nothing here approves, rejects, or promotes anything. If a take goes wrong, re-film — the page
underneath has not moved.

---

## The three guard rails, and where each one actually lives

**1. This mechanism never writes to `~/.foliage`.** `take.sh` resolves every garden path it is
about to use (the auto-generated temp dir, or an explicit `--garden` override) to its real
absolute path and refuses if that matches `~/.foliage` or nests inside it — checked *before*
anything touches disk, including a defensive `mkdir`. See the `refuse_if_live_garden` function
in `take.sh`.

**2. Never a bare `promote` without `--doc` AND `--into`.**
`harvest.mjs promote` now REFUSES BY NAME if either flag is missing or empty — `--into` always
did, and `--doc` does too as of F-025 (`guarded` in `.loop/FINDINGS.md`): it no longer silently
defaults to `apps/leaf/harvest.json` beside the script when left off, which used to promote
whatever document happened to sit there instead, with exit 0. `approve`/`reject` gained the
identical `--doc` refusal in the same fix. This wrapper's own both-flags-required check is now
BELT-AND-SUSPENDERS on top of that product-level refusal — a second layer, not the only defense
— and nothing in this runbook calls the bare command anyway:
  - the browser panel (Beat 2 step 4) takes no `--doc`/`--into` at all, so there is no surface
    for the mistake to land on even in principle;
  - `foliage review` (the CLI alternative, `foliage.mjs`'s own `review` case) always resolves
    and passes both explicitly from the garden it is already pointed at;
  - if a terminal fallback is ever needed, use `take.sh promote --doc <harvest.json> --into
    <leaf.json>` — it refuses to run if either flag is missing, mirroring `harvest.mjs`'s own
    refusal one layer earlier.

  **Cross-take mismatches are refused at the product level, not by this wrapper — across the
  whole sanctioned sequence, decisions included.** `promoteApproved`
  (`packages/photosynthesis/src/promote.ts`) binds a harvest document's subject/leaf id at
  propose time and refuses a mismatch by name (F-014, `guarded` in `.loop/FINDINGS.md`, PR #17).
  That binding survives `decide()`/`recordDecision()` (the approve/reject code both `foliage
  review` and the browser hit) — both writers now rebuild the document through one shared
  `withCandidates` step that keeps every existing document-level field and replaces only
  `candidates` (F-024, `guarded`, PR #19; before this landed, both writers rebuilt the document
  as `{ candidates }` only, silently dropping the binding — the exact gap that let a promote
  which had refused before any decision succeed unbound once a reviewer had actually approved
  something). Measured live, the sequence a reviewer actually follows: grow two takes, APPROVE a
  candidate in take-A, then `take.sh promote --doc <take-A>/harvest.json --into
  <take-B>/leaf.json` — refuses, citing both the subject and leaf-id mismatch by name, before
  anything is written. What this wrapper itself still guarantees, on top of that, is the
  narrower thing above — neither flag may be omitted, and neither may resolve into the live
  garden.

**3. No hand-edits to titles between takes (F-015, open in `.loop/FINDINGS.md`).** Intake owns
every git-sourced title; a hand-redacted one silently reverts on the next `--force` re-grow,
because `merge.ts` tracks title as a changed field and re-derives it. `take.sh` never re-grows
into a directory a previous take already wrote — every default run is a fresh `mktemp -d`, and
an explicit `--garden` override is refused if the target already holds a `leaf.json` or
`harvest.json` (this is a fresh-take mechanism, not a resume/edit one). If a title needs to
change, that is either a different `--identity`/`--subject` or an owner product decision
(`packages/leaf/src/intake.ts`'s own note on this) — never a JSON edit between takes.
