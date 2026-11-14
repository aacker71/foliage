# Foliage — launch plan

Sequencing only. **Status lives in `.loop/STATUS.md` and nowhere else** — this plan names
ledger rows (C3, C4, E1–E3, X1–X5…), it never restates their evidence; if a number can be
produced by a command, the command is named instead. Vocabulary and the phase contract are
`.loop/LOOP.md`'s, unchanged. Assembled 2026-08-16 from four review runs — ledger coherence,
design-split, loop-workflow, BrowserOS-neo probe — then adversarially checked against the
tree; each claim below names the run that produced its evidence. **This document verified
nothing itself.**

> **Provenance and scope, 2026-08-16.** This plan was drafted in a separate working tree and
> ported here afterwards. **This repository — `aacker71/foliage` — is canonical**, and it is
> the only tree any statement below refers to. Items below that later work has since made true
> are marked **[done]** inline.
>
> **Correction found merging `origin/photosynthesis/prototype`, 2026-08-20.** The porting note
> above originally claimed a `packages/foliosynthesis` + `apps/leaf/harvest.mjs` document-
> harvesting implementation was **dropped rather than ported, superseded by
> `apps/photosynthesis`**. That does not hold for this tree: `apps/leaf/harvest.mjs` was never
> dropped — it is alive on this branch today, and `git log -p --follow` on it shows it carried
> the literal name `FOLIOSYNTHESIS HARVEST` in an earlier revision before being renamed. What
> this merge actually lands is the duplication STATUS.md's own "do not repeat" list already
> warns about: two independently-built implementations of the same propose/review/
> approve/promote domain — this branch's CLI (`apps/leaf/harvest.mjs`) and mainline's web
> review surface (`apps/photosynthesis`) — now sitting side by side, unreconciled. Nothing in
> this plan sequences reconciling them, and no row should be opened for it without first
> reading STATUS.md's "work that is actually next" item 1.

## 1. Why there was no consolidated plan

Four causes, each evidenced in the reviews:

- **Design truth was split three ways.** Two Open Design projects (`foliage-design-system`,
  active again 2026-08-16; `canopy-design-system`, untouched since 2026-08-13) plus a
  generated package derived from the first. One token, `--fol-text-faint`, forked into five
  values across five live copies — one of them the value the repo's own comments record as
  failing WCAG (design-split run, diff/grep evidence). AGENTS.md warned "a design system copy
  goes stale"; it went stale four separate times.
- **The Open Design MCP is broken** — registration pinned to a deleted `0.18.0` payload,
  ENOENT verified in the design-split run — so lanes consumed tokens from the OD project
  directory on disk, and the design source the loop's own prompts mandate was unreachable.
- **The ledger tracks capabilities; nothing sequenced them toward a launch.** No row defines
  a launch surface, and the hosting surface — "the product being sold" per
  `public-boundary.json` — has no rows at all for tenancy, billing, provisioning, deploy, or
  auth (ledger run).
- **README drifted from the ledger.** "CI has never run: there is no remote" was false on
  both halves (`git remote -v`; `gh run list -R aacker71/foliage` — ledger run). **[done]**:
  the sentence has been corrected — `gh run list -R aacker71/foliage` shows CI running
  repeatedly (10 runs observed 2026-08-20, 9 success / 1 failure on 2026-08-18), so the
  pipeline is exercised, not merely asserted; README's own wording of the corrected sentence
  is still mid-reconciliation in `README.md` itself. **[done]** too: the F3 cell's "no UI
  consumes it yet" — STATUS.md's own F3 row now records the opposite,
  `apps/canopy/src/renderPublic.ts` importing the public projection to serve two real routes.

Common root cause: one-way copies with no reconcile step. OD→repo, ledger→README, loop→owner
each lacked the mechanism that carries truth back. This plan adds mechanisms, not more copies.

## 2. Design sources: repo canonical, OD retired as a source of truth

Decision (c) from the design-split review. OD-canonical is disqualified — OD copies ship a
WCAG-failing token value and a mark their own provenance file calls SUPERSEDED, and it would
contradict AGENTS.md ("`@foliage/tokens` is the source of truth"). A standing mirror already
failed empirically: three mirrors, all stale within 2–3 days. Steps, in order:

1. ~~**Owner decision, blocking: the mark.**~~ **DECIDED 2026-08-16 by the owner: the Open
   Design bipinnate frond is the mark**, and the `foliage-design-system` project's assets are
   the ones to use ("these are the logos and images in here that we need to use"). The
   427-byte single-stroke circinate coil that `@foliage/tokens` shipped is superseded, and
   AGENTS.md's "the mark is circinate vernation" line is now stale — it must be corrected in
   the same change that lands the artwork. Harvest is unblocked.

   The decision carries a taxonomy with it, visible in the design system's own prototypes:
   **leaflet ⊂ leaf ⊂ branch ⊂ tree ⊂ canopy**, where a **branch is a team** ("The tree seen
   from above: branches are teams, leaves are people, and reach from the trunk is recency").
   That is a fifth level the domain does not model — `@foliage/canopy` goes `Tree → Leaf`
   directly — so it needs its own ledger row before anything renders it. README already
   promises "individuals, teams and organizations" in the enterprise plane, so the level is
   owed, not new scope.
2. Harvest `foliage-design-system`'s un-landed work (five prototypes, sprite, component CSS,
   the generator/export tools, imagery) as reviewed commits — after the mark decision.
3. Archive `canopy-design-system` (nothing in it is newer than the repo — verified by diff in
   the design-split run) and the generated package, after one read of its provenance prose.
4. No vendored token files in any future design source; apps consume tokens through the
   `@foliage/tokens` export map only.
5. Future OD runs seed a FRESH project from the repo and merge back the same day; add a drift
   gate that diffs `packages/foliage-tokens/src/tokens.css` against any declared OD copy and
   fails on divergence — it would have caught all four stale copies at creation.
6. **Owner-runnable, from an interactive session** (MCP servers load at session start; a
   background agent must not run this and could not verify the result):

   ```bash
   claude mcp remove open-design -s user && claude mcp add open-design -s user \
     -e 'OD_DATA_DIR=~/Library/Application Support/Open Design/namespaces/release-stable/data' \
     -e 'OD_SIDECAR_IPC_PATH=/tmp/open-design/ipc/release-stable/daemon.sock' \
     -e 'OD_MCP_BOOTSTRAP_COMMAND=/usr/bin/open' \
     -e 'OD_MCP_BOOTSTRAP_ARGS=["-g","-j","/Applications/Open Design.app","--args","--headless"]' \
     -e 'ELECTRON_RUN_AS_NODE=1' \
     -- '/Applications/Open Design.app/Contents/Frameworks/Open Design Helper.app/Contents/MacOS/Open Design Helper' \
     '/Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs' \
     mcp
   ```

   Both paths exist (verified in the design-split run); the resulting connection is
   **unverified** — the command was specified, never run — and fixing the ENOENT may not fix
   `list_projects` returning `[]`, which is a separate, still-open defect.

## 3. What "launch" means — the prototype now, five surfaces after

From the ledger review. **No PUBLIC surface is launchable before X3** — but the prototype
(P0 below) is not a public surface: private distribution ≠ published, the same reasoning F1's
row used for the private push.

| surface | owner gates | engineering gates |
|---|---|---|
| P0 prototype: one external tester self-hosts their leaf, privately | tester pick; distribution choice; FCRA disclosure line | none — uses only DONE rows (C1+C5) |
| S1 publish the open repo, fresh history | X3; the verbatim-title egress call | C3; X1 for any real-user claim |
| S2 others self-host `apps/leaf` | collapses into S1 — distributing the code publicly IS publishing | same as S1 |
| S3 host the canopy service | X3, X4 (domain/naming) | C3, C4, X1 — plus rows that DO NOT EXIST: tenancy, billing, provisioning, deploy, auth |
| S4 sell enterprise | commercial EULA (`LICENSING.md` question 3) | E1, E2, E3, F4 |
| S5 npm publish of open packages | X3 | no packaging row exists; untracked |

**Prototype launch is P0 and it is this week's work** — the completion plan's owner-approved
W0, promoted here to the front because it is the only launch that needs zero new code and no
X3. **First public launch: S1.** S2 collapses into it, S3 carries invisible unscoped work,
S4 sells ahead of the product.

## 4. The sequenced path — one capability per run

The product invariants bind every milestone: no score ever, `excluded` is not an error and
carries its reason, approval ≠ publish, the plane is unmistakable, no fake data.

**P0 — prototype launch (W0): one real person who is not the owner runs `intake.mjs` on
their own repo and opens their own leaf, unassisted, from written instructions.** Needs from
the owner, this week: pick the tester; choose distribution (private collaborator invite vs a
tarball of the tree — both private, neither is publishing); approve the FCRA disclosure the
tester must read before publishing anything (their repo's commit titles are rendered verbatim
and can carry OTHER people's email addresses — C1/C2/C5 record the defect marked, not fixed).
The tester quickstart is **[done]** and lives at `TESTER-QUICKSTART.md`, with every command in
it re-run against this tree on 2026-08-16. The one stumble the outsider dry-run found — a raw
`ERR_MODULE_NOT_FOUND` stack trace when `pnpm install` had not been run — is **[done]** too:
`apps/leaf/src/preflight.ts` turns it into an instruction, re-verified here by copying
`apps/leaf` + `packages` into a tree with no `node_modules` and running intake. The owner
go/no-go checklist is still outstanding. Exit: the tester reaches their own rendered leaf and
the acceptance notes land
in `.loop/PRODUCT.md`. Everything they hit re-orders the milestones below.

**Gate 0 — one owner sitting, before the public cut. Never worked around.** (a) **X3**:
licence + CLA (`LICENSING.md` recommends AGPL-3.0-only + CLA) — unblocks S1, S2, S5; the
single hard gate on every public surface. (b) **The verbatim-title egress call** (C1/C2/C5
record it marked, not fixed) — a de-facto FCRA gate on S1 that is NOT among the GATED rows,
named here so it cannot be missed. (c) **The mark** (§2 step 1). (d) **X4**: appId/domain —
cheap now per its row, near-unfixable later.

**M0 — make the loop's own instructions true again** (maintenance, not a capability row; one
Cleanup-scoped run). ~~Fix README's false CI claim~~ **[done]**; fix the workflow audit
prompt's "there is
no remote, so CI has NEVER run" clause before an audit agent obeys it against F1; add
`apps/leaf/server.mjs` (:4174) beside the canopy server in the TIE/Verify prompts; reconcile
LOOP.md's phase count with the executable's sixth (Audit) phase; create `PROVENANCE.md` with
an honest empty state (LICENSING.md makes it the required record for anything imported from
the previous lineage — the rule stays); wire the loop-review's BROWSER constant into the four
named prompts; ~~refresh the stale F3 cell~~ **[done]** — STATUS.md's own 2026-08-19 policy-
slice audit already corrected it; `graphify update .` for X5.

**M1 — C3**, the open plane's one functional gap (ledger run). Verify in BrowserOS neo, own
tab (`tabs` new → `navigate` → `snapshot`/`act`/`evaluate`), settled state, under LOOP.md
gates 1–5. Exit: the row's browser-observable `doneMeans` holds, reconciled atomically.

**M2 — X1** (responsive 360→1920), now unblockable: the neo probe **achieved a genuine 360**
— verified-working in the probe run via CDP `Emulation.setDeviceMetricsOverride` through
`run`'s `browser.cdp` with a page-scoped sessionId; `innerWidth` read back 360, media query
true, persisted across a full-page screenshot, cleanly reversed. Honest terms the row must
carry: the mechanism is undocumented and empirically discovered — re-prove
emulate→read-back→restore at the start of any run that relies on it; the fallback is the
`window.open` popup pattern (also probe-verified, measurement-backed only); a `screenshot`
`size` parameter SCALES without re-layout and is inadmissible for width claims (verified
negative — C2's exact failure); neo cannot save screenshots to disk, so 360 pixel evidence
is inline-read in-run, never archived. The row states measurement + inline-read, no stronger.

**M3 — C4**, the last fixture-driven cloud surface (ledger run; state.json's next seed).
Applies the mark decision: crown stays a data figure, the real `@foliage/tokens` mark renders
where identity is needed, decision recorded in the same commit. Same neo gate as M1.

**M4 — cut S1**, once Gate 0 is decided: export the open set with FRESH history (README's
rule — never filtered history), land the `LICENSE`, run `pnpm check:boundary` green on the
cut, prove the open set boots and runs alone (LOOP.md gate 4). Exit: the repository is public
and a stranger can run `apps/leaf` from the README alone.

**After S1**, in order of pull: E1 → E2 → E3 (F4 finally consumed) toward S4; and add the
missing hosting rows to the ledger BEFORE treating S3 as plannable — until they exist, S3 has
no honest sequence.

## 5. How the owner sees each iteration and steers

The loop's only feedback today is the run's ephemeral return value, visible only to the
invoker; nothing is persisted, nothing notifies, and GATED rows are skipped by Select's
priority order, never surfaced (loop-review, verified across the whole workflow file). Two
additions, both proposed in that review and **not yet applied**:

- **A per-iteration report in the same atomic commit.** Reconcile writes
  `.loop/reports/<iteration>-<capabilityId>.md` assembled ONLY from already-evidenced fields:
  final status, the one-line ledger diff, the verify verdict with its `unverified` list
  verbatim, blockers, audit downgrades, and a DECISIONS NEEDED section enumerating every
  GATED row. Built from existing claims only, so it cannot overclaim.
- **`pauseFor: 'gated'`** — when Select's next seed is GATED, return
  `BLOCKED — needs owner decision: <row>` as text instead of skipping past it.

BrowserOS neo's part: `name_session` works (probe run), so each lane's browsing is
attributable, and neo's own documentation says the owner oversees agent browsing from the
cockpit (live view, audit, replay). The probe did not exercise the cockpit — that is the
tool's claim, unknown until looked at, not this plan's.

## 6. Standing risks — read the tree, not this plan

- **Verbatim-title egress (C1, C2, C5): marked, not fixed.** A multi-author document can
  surface a third party's email on a public page. Owner call at Gate 0; until made, the leaf
  renderer is not publishable — and the P0 tester must be told before they publish anything.
- **The `verified` tier has never rendered from real signed data** — zero CHECKED-AND-ACCEPTED
  signatures in every repo checked (the rows name the counts and commands). "0 verified" is a
  correct answer, not a rendering result; P0 and S1 ship with that gap stated. Sharpened
  2026-08-16, and the sharpening is the point: "zero good signatures" was itself too strong.
  This repository's own history carries a real PGP-signed commit (`git cat-file commit` shows
  a `gpgsig` header on the initial commit), and `git log --format=%G?` reports `N` — its code
  for *no signature* — for every non-merge commit on this machine (68 as of 2026-08-20;
  re-run the count rather than copy it forward, it grows every session), because this machine
  has no `gpg`. Intake now reports that commit as `unchecked` rather than folding it into
  unsigned history (`apps/leaf/intake.mjs`, `signatureFinding` in `packages/leaf/src/intake.ts`).
  The rendering gap is real; the claim that there was nothing to check was not. The signed
  paths ARE now exercised end to end against real cryptography —
  `apps/leaf/src/gitIntake.test.ts` makes a throwaway ed25519 key with stock `ssh-keygen`, has
  git sign a real commit with it, and asserts both the masked (`N`, unchecked) and the
  checkable (`G`, verified) verdicts. That is a test, not a rendered page, and it does not
  close the gap.
- **The mark fork is unresolved.** Until Gate 0 decides, OD's 2026-08-16 output cannot be
  harvested mechanically and the canopy pages' de-facto frond identity remains a drift.
- **Whether spawned loop agents can reach the neo MCP at session start is unverified** — the
  same failure class that kept the Open Design MCP out of C1/C2's lanes. The BROWSER prompt
  carries the fallback: if unreachable, say so; never substitute a scaled capture.
- **The CDP emulation path can vanish in a neo update** (undocumented, empirical); every run
  depending on it re-proves it first. Archived mobile pixel evidence stays a gap — neo's
  disk-writing tools are pdf and element-triggered download; neither can archive a
  viewport-emulated screenshot, so 360 pixel evidence stays inline-read in-run.
- **The vault does not index this repo** — `vault:ask` answered a Foliage licensing question
  with Coeadapt material (ledger run). Mechanism sound; add this repo's docs to
  `tools/vault/sources.json` before trusting it for Foliage context.
- **S3's largest work is invisible** until the hosting rows exist. Sequencing hosting today
  would be sequencing an unknown.
