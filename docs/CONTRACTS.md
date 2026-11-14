# Foliage — the three contracts for what reaches a person

`AGENTS.md` is the general agent contract and still governs everything. This file holds the three
contracts `AGENTS.md`'s own discipline works against:

1. **[Where the effort goes](#1--the-attention-contract)** — a correct mechanism nobody uses is
   still zero.
2. **[How the surface reads](#2--the-ui-contract)** — a comment is read once; a UI is read
   constantly.
3. **[How the work runs](#3--the-working-method)** — ship → measure → iterate; milestones over
   ledgers; every stop ends with the report.

---

# 1 — the attention contract

## The failure, measured

> *"The team is spending disproportionate energy on correctness mechanisms around a workflow that
> has not yet proven it deserves to exist for users."*

Measured on this tree, 2026-08-20:

| | |
|---|---|
| Correctness machinery — loop + ledger gate + `STATUS.md` | **2,872 lines** |
| Gates wired into `package.json` | **9** |
| Test files / assertions | **54 / 884** |
| Independent review pipelines that converged on the same abstraction | **3** |
| Leaflets `verified` on the owner's own portfolio | **0 of 681** |
| **Real non-owner users who have touched any surface** | **0** |

**The finding is the last row, and it is a division by zero.** Meta-work is only 9% of product
lines (2,872 against 29,674) and only 9 of 48 commits this slice — by volume it is *not*
disproportionate. It is disproportionate because the denominator is zero, and **any** amount of
process-correctness is infinitely disproportionate to nobody.

The tell is not size, it is *rate and recursion*: the loop file went **226 → 567 lines in three
days**, and the growth was a reconciler that reviews a reviewer. Meanwhile the hero surface —
"Selected work" — is empty for every human alive, including its author.

### The cause, named

**Internal correctness is cheap to measure; user value is expensive to measure. A loop that
allocates attention by what it can measure will converge on itself.**

`SELECT` reads a ledger. The ledger is written by us. Nothing in the attention-allocating
mechanism has a person in it, so the system optimizes the only signal it can see — and it will do
this forever, getting more correct and less used, with every gate honestly green.

---

## The rule

**A mechanism that protects a person is product. A mechanism that protects the process is
overhead — and overhead is budgeted.**

This is the whole distinction, and this repo has been blurring it:

| protects a **person** → build it now, unbudgeted | protects the **process** → budgeted, one lane |
|---|---|
| the RCE in `gitIntake.ts` | `pnpm run check:ledger` |
| redirect egress walking private content off-machine | reconciler input clipping |
| a false `verified` on someone's name | loop `args` validation |
| the fabrication band, the example-document marker | the ledger's own truth gate |
| the `/tree` count leak | reviewing the reviewer |

Left column is the product — those *are* the thing being sold, and honesty is the feature. Right
column is scaffolding. Both are worth building. Only one of them may set the agenda.

### The four mechanics

**1. User-contact is a scheduling input, not a milestone.**
`.loop/STATUS.md` carries one line above every row:

```
LAST-CONTACT: <date> — <who, not the owner> — <which surface> — <what broke>
```

**If that date is absent or older than 14 days, `SELECT` may only choose rows that change what a
non-owner sees.** Not a suggestion — the selector's first filter. This is the fix for *"the
mechanism that allocates attention is structurally incapable of allocating attention to the
largest unbuilt thing."* Same defect, one axis up: it could not see a user either.

**2. A gate needs a corpse.** No new correctness mechanism without a defect that *actually reached
a surface* — cite it by id and date. A gate built for a hypothetical is a hypothesis with a test
suite. The RCE, the egress, the false `verified` all had corpses; each was reproduced before it
was fixed. Keep that bar.

**3. Never build mechanism #2 for a problem mechanism #1 has not yet failed to catch in the real
product.** Redundant rigor feels like diligence and reads, in a diff, exactly like it. Two review
pipelines deriving the same sentence is not confirmation — it is the same work done twice.

**4. `SELECT` tiebreaker, in order.** A launch surface with **zero rows** outranks any `PARTIAL`
row *(a thing with no rows cannot be selected, so absence must outrank incompleteness)*. A proven
defect outranks a new capability. A user-facing row outranks a mechanism. To pick a mechanism
anyway, write down the **user-visible failure it prevents and the date that failure last
occurred** — if you cannot, that is the answer.

### The diagnostic — three questions, asked out loud each slice

1. **What is the last thing a person who is not the owner did with this, and when?**
2. **If this slice ships perfectly, what can someone do that they could not do yesterday?** If the
   answer is "the loop is more trustworthy," it is overhead — take the lane, take one.
3. **How many mechanisms now exist per user?** Say the ratio. `2,872 : 0` was easier to ignore as
   "2,872 lines of rigor."

### HONESTY IS NOT OVERHEAD — and this is the part that must not be got wrong

This rule is a budget on **process scaffolding**, never a licence to ship software that misleads a
person. It cannot be cited to skip a caveat, weaken a gate that guards a claim about a human, or
call something done that is not.

**Cutting a mechanism must never cut a protection** — the same shape as *relocate, never delete*
below. The test before deprioritizing any mechanism: **would a real person be harmed, or misled
about another person, by its absence?**
- Yes → it is product. Build it now, and stop calling it overhead.
- No → it is scaffolding. It gets one lane, behind the user.

The charter's floor is untouched: no fake data ever, no claim without current evidence, the weaker
claim when unsure. A shipped-fast product that lies is a worse failure than an unused one that
does not. **This rule changes what gets built first. It never changes what may be said about it.**

---

# 2 — the UI contract

This half governs **rendered interface only**, because that is the other place the repo's habits
work against it.

## The failure, measured

`GET /` on a real 57-leaflet document, 2026-08-19: **4,264 words, 187 sentences longer than eight
words, longest 32 words.** Every tier carried a paragraph. Every section carried a rationale.

The cause is not carelessness — it is a good rule applied to the wrong surface:

> **The comment discipline is correct for code and wrong for interface.**
> A comment is read *once*, by a maintainer who needs the reasoning.
> A UI is read *constantly*, by someone who needs the fact and nothing else.

`AGENTS.md` says say WHY, name the trap, record the measurement. That is right in a `.ts` file and
it is what has been leaking into `.html`.

---

## The rule

**Show the fact. Offer the explanation. Never assert the explanation.**

A user must be able to use this without reading. If they have to read a paragraph to understand a
row, the row is broken — not under-explained.

### Concretely

- **A label, not a sentence. A sentence, not a paragraph.** `Pending` is the fact. The three
  sentences about what pending means go behind disclosure (`<details>`, a `?`, a link to docs).
- **Rationale belongs in docs, not on the product.** "Counts are per tier and are never combined
  into a figure standing for a person" is a *design decision*. It goes in
  `docs/ENGINEERING-PLAN.md`. The page shows the counts.
- **Do not explain the product on the product.** A first-time user learns by using it. A page that
  teaches its own philosophy is a page nobody finishes.
- **One explanatory sentence per surface, maximum**, and only where omitting it would mislead.
- **Empty and error states are the exception.** They may be a full sentence, because there is
  nothing else on the screen and the user is stuck. Even then: one sentence and the remedy.

### HONESTY IS NOT VERBOSITY — and this is the part that must not be got wrong

Cutting text must never cut a caveat. **Relocate, never delete.**

`Pending` linked to an explanation is *exactly as honest* as three sentences and far more usable.
`Pending` with the explanation **deleted** is a different product and a dishonest one.

The test before removing any text: **would a reasonable person be MISLED by its absence?**
- Yes → it stays visible. (A fabrication band. An example-document warning. "0 verified" where a
  reader would assume otherwise.)
- No → it moves behind disclosure or into docs. (Why the tier set is unordered. Why counts are not
  combined. What FCRA posture means.)

Non-negotiable and always visible, regardless of density: the **fabrication band**, the
**example-document** marker, and any statement whose omission would let a reader infer something
false about a person.

---

## Working method for a UI lane

1. **Measure first.** Count the words on the rendered page before you change anything, and again
   after. State both numbers. A UI claim without a measured page is the same overclaim this repo
   refuses everywhere else.
2. **Read the page as a stranger** who has never seen the product and does not care how it works.
   Every sentence they would skip is a sentence that should not be asserted.
3. **Move, don't delete.** Every caveat you remove from a surface lands somewhere — disclosure,
   docs, or a tooltip. Say in your report where each one went.
4. **The screenshot is the evidence.** Full page, real data, actually read. Not a DOM dump.

Everything in `AGENTS.md`'s Design section still holds — tokens, accent at most twice per screen,
mono tabular-nums for metrics, bordered cells, small radii, no shadows, measured contrast stated
with the px size it is judged at, never assert AA.

---

# 3 — the working method

*(owner directive 2026-08-22, after two days that proved both halves)*

**Ship → measure → iterate. In that order, always.**

- **Milestones over ledgers.** `.loop/MILESTONES.md` drives selection; a milestone is DONE only on
  its **release event** — a person who is not the owner using the thing — never on green tests.
  The 37-row ledger is the archive, not the plan.
- **Every stop ends with the report.** Six parts, no exceptions: what moved · what changed · what
  was discovered · how close to completion · biggest gaps ranked · a plan to close each. Every
  number freshly measured (git, gate, garden) — never from memory.
- **Build directly; fleets only for genuine fan-out.** One session, one tree
  (this one — `design-page-consolidation`). Multi-agent workflows for a rendering decision or a
  178-line launcher are the failure, not the diligence. Two sessions building the same product
  produced ~86% divergent duplicates, twice, plus a duplicated ledger id between an agent and its
  own subagent. Don't recreate that.
- **The frontend is designed in Open Design FIRST.** The master is project `72967fc2…`
  ("Foliage - Design System Master"). The loop is design there → implement → verify in
  BrowserOS neo → correct back at the source, and the fourth step is the one every session
  forgets. Sync rule: the repo package is canonical for VALUES, the master for DIRECTION;
  after a design-language change ships, its css/marks flow back to the master and a real
  export lands in the master's `captures/`, so the design source can never again describe a
  product that no longer exists.
- **Test by driving, not reading.** Every defect worth fixing here was found by running the real
  surface: the pipe-EOF race, the wrong-portfolio tally, the reasoning spill, the `subjects` field
  that never existed. A green suite is the floor; the run is the proof.
- **Optimize for the prototype, not the mature application.** No new mechanism without a corpse
  (§1 above still governs). Deliberation is for irreversible or owner-gated calls; everything
  else ships and iterates.


---

# Foliage — agent pointers

**`AGENTS.md` is the contract.** Read it first: non-negotiables, the traps this lineage already
paid for, and the browser-verification rules. This file holds only what that one does not — where
things live outside the repository, and the loop that produces frontend work.

## The design system lives in Open Design, and it is the master

The **`foliage-design-system` project in Open Design is the design system of record.** Not this
repository. `@foliage/tokens` is the source of truth *for the code* — apps reach colour, type,
spacing, motion and the mark through its export map and never through a second copy — but the
system those tokens implement is authored in Open Design, and when the two disagree the design
project is upstream.

Reached through the **`open-design` MCP server**. Tools arrive via ToolSearch (`+open-design`),
and the app must be running or calls fail. MCP servers load at **session start**, so a session
begun before the app was launched cannot see it — quit and reopen.

**FIXED 2026-08-28 — and the cause was never the version pin this file used to blame.** Status is
now `✔ Connected`, verified by a real MCP handshake rather than a status line: `initialize` returns
`serverInfo` `open-design 0.2.0` and `tools/list` returns 18 tools (`list_projects`, `get_file`,
`search_files`, `write_file`, …).

The real mechanism, for anyone who meets it again in another app: `/Applications/Open Design.app`
carries a `com.apple.quarantine` attribute set by Safari, so macOS runs it **App-Translocated**
from a randomised read-only `/private/var/folders/…/AppTranslocation/<UUID>/d/` path. The
launcher's `versions/<v>/payload/…` tree the registration pointed at therefore never materialises.
**Translocation mints a NEW UUID on every launch**, which is why the registration's captured
`OD_MCP_BOOTSTRAP_ARGS` path was dead the moment it was written — chasing the version number
(0.18.0 → 0.20.2) never had a chance, because no path under that tree is stable.

The fix was three paths in `~/.claude.json`, all repointed at the stable bundle, no security
change and no reinstall: `command` → `/Applications/Open Design.app/Contents/Frameworks/Open
Design Helper.app/Contents/MacOS/Open Design Helper`; `args[0]` → that bundle's
`Contents/Resources/app/prebundled/daemon/daemon-cli.mjs`; and `OD_MCP_BOOTSTRAP_ARGS` → `["-g",
"-j", "/Applications/Open Design.app", "--args", "--headless"]`. It works while the app runs
translocated because the daemon already serves on the stable
`OD_SIDECAR_IPC_PATH` (`/tmp/open-design/ipc/release-stable/daemon.sock`) and every path the
registration now names exists regardless of where the app itself was translocated to.

**Caveat, deliberately left alone:** the quarantine attribute is STILL set, so the app still runs
translocated. Removing it (`xattr -dr com.apple.quarantine …`) is a Gatekeeper change and is the
owner's to make, not an agent's — it was declined once already with the owner's explicit
permission in hand. Nothing above depends on it.

**MCP servers load at session start**, so the session that applied this fix still could not see
the tools; quit and reopen before expecting `+open-design` in ToolSearch. Every lane before this
date fell back to reading the project directory on disk — OD-sourced, but not MCP-pulled, and that
distinction was recorded honestly in the ledger each time rather than glossed.

**On disk** (read-only; never edit the design project from an agent):

```
~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/
```

| project | what | pages |
|---|---|---|
| `foliage-design-system` | **the master** — tokens v0.2, the component layer, the marks, and the prototypes | 6 |
| `6e0c4a97-fba1-4230-9fee-26e4df4196df` | derived from the master; app UI kits, token previews, the canopy examples | 22 |
| `canopy-design-system` | superseded — nothing in it is newer than the repo | 6 |

That is 28 pages across the first two, which is the number to quote. The master's own six are
`index.html` plus the prototypes: `photosynthesis`, `portfolio`, `public-leaf`,
`organization-tree`, `foliage-search`. **Its provenance file is stale in one specific way** — it
marks the bipinnate mark SUPERSEDED because it was derived from the repo back when the repo still
shipped the coil. The owner decided 2026-08-16 that **the bipinnate compound leaf is the mark**;
that decision is newer, and it wins.

**Imagery and photographic reference**, in the master: `assets/imagery/`
(`hero-canopy-night.jpg`, `canopy-texture-night.jpg`, `specimen-sheet-day.jpg`) and `references/`
(`compound-leaf-morphology.png`, `mimosa-frond-reference.png`). These are good starting material
and are design-source, not runtime assets — nothing in the served product should fetch them.

## The frontend loop

**Design in Open Design with its toolkit → implement → test in BrowserOS neo → correct at the
source.** The last step is the one that keeps getting skipped, and skipping it is why drift keeps
being re-discovered instead of fixed.

1. **Design it in Open Design**, using the design tools, against the master system.
2. **Implement it** in the repo, pulling tokens and the component layer through `@foliage/tokens`.
3. **Test it in BrowserOS neo** — the real running surface, settled state, measured contrast with
   the px size stated, a true viewport via CDP emulation (`screenshot` `size` only SCALES and is
   inadmissible for width claims), and every resource origin checked for third-party calls.
4. **Correct at the source.** When the rendered result differs from the design, decide which is
   wrong and fix THAT side — a missed design element goes back into Open Design; an implementation
   defect is fixed in the repo. Findings that stay in a report are how the same drift gets found
   three times.

A frontend defect is not always frontend. The mark rendering as a stale copy on six canopy pages
was a JS sprite; the icon rendering nowhere was a missing server route and a CSP with no
`img-src`. Follow it to wherever it actually is.

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (kubectl-style context).
`gbrain code-def`, `code-refs`, `code-callers`, `code-callees`, `search`, and
`query` from anywhere under this worktree route to that source by default —
no `--source` flag needed (gbrain >= 0.41.38.0; on older gbrain the call-graph
commands need `--source "$(cat .gbrain-source)"`). Conductor sibling worktrees
of the same repo each have their own pin and their own indexed pages, so
semantic results match the code on disk here.

**Pin-scoping caveat (verified 2026-08-27 on gbrain 0.42.x):** inside a pinned
worktree, `search` sees ONLY the pinned code source — note/decision pages
return "No results" here while matching fine from an unpinned directory. For
non-code recall from inside this repo, pass the source explicitly
(e.g. `--source gstack-brain-<user>`) or run from outside the worktree.

Call-graph queries (`code-callers`/`code-callees`) also need the graph to be
built first — run `/sync-gbrain --dream` (or `--full`) if they return
`count: 0`. This only works if this source's gbrain schema pack extracts code
symbols; on a non-code-aware pack `--dream` completes but the graph stays empty
and reports a WARN. `code-def`/`code-refs` need the same extraction.

Two indexed corpora available via the `gbrain` CLI:
- This worktree's code (auto-pinned via `.gbrain-source`).
- `~/.gstack/` curated memory (registered as `gstack-brain-<user>` source via
  the existing federation pipeline).

Prefer gbrain when:
- "Where is X handled?" / semantic intent, no exact string yet:
    `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
    `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
    `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
    `gbrain search "<terms>" --source gstack-brain-<user>`

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. Run `/sync-gbrain` after meaningful code changes; for ongoing
auto-sync across all worktrees, run `gbrain autopilot --install` once per
machine — gbrain's daemon handles incremental refresh on a schedule.

Safety: don't run `/sync-gbrain` while `gbrain autopilot` is active — the
orchestrator refuses destructive source ops when it detects a running autopilot
to avoid racing it (#1734). Prefer registering user repos with `gbrain sources
add --path <dir>` (no `--url`): URL-managed sources can auto-reclone, and the
sync code walk for them requires an explicit `--allow-reclone` opt-in.

ALWAYS pass `--quiet` in automated gbrain calls — the stderr upgrade nag breaks
merged-stream JSON parsing and reads as silent failure.

<!-- gstack-gbrain-search-guidance:end -->

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: postgres (local user-space install, 127.0.0.1:5433)
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-08-23
- MCP registered: yes (user scope)
- Artifacts sync: full → https://github.com/aacker71/gstack-artifacts-alex (private; federated source `gstack-artifacts-alex`)
- Current repo policy: read-write

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
