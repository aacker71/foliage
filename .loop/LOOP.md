> Historical development-loop record. Its runtime, launcher and plist are retired.
> Current execution uses reviewed PRs; see [HANDOFF.md](../HANDOFF.md).

# The Foliage dev loop — contract of record

> **HONESTY NOTE (2026-08-29, factor-6 audit):** the launchd path described below is NOT
> installed — `launchctl` knows no com.foliage.devloop service and zero unattended runs have
> ever completed. Every loop run to date was started by a person. The schedule prose is design,
> not deployment; wiring anything into run-once.sh's unattended path is dark plumbing until an
> owner actually loads the service.

One capability per run. Five phases. The ledger is `.loop/STATUS.md`; the cursor is
`.loop/state.json`. Nothing pushes, nothing deploys.

```
SELECT → BUILD (BE→FE→TIE, + Cleanup in parallel) → REVIEW (cross-model) → VERIFY (browser) → RECONCILE+COMMIT
```

**SELECT reads `.loop/PRODUCT.md` FIRST — before the ledger.** The selected row must be
justified against the current milestone in one sentence, recorded in the seed reason.
If the top row by mechanical priority does not serve the milestone, the loop says so
explicitly and selects the row that does. *Why:* the loop twice produced immaculate
rows while the product went nowhere — selection by status priority alone optimizes
trees over the forest. (Owner directive 2026-08-16; the completion plan of record and
its 35-decision audit trail live at
`~/.gstack/projects/aacker71-foliage/main-completion-plan-20260816-164525.md`.)

## Why this is a rewrite, not a fork

The Coeadapt loop's machinery was sound and its bindings are all dead: it selects from a
53-row ledger about `Coeadapt2`/`career-box-dev`, boots a stack on `:5050`, and builds the
retired Janus Frontier system with `accent #3b5bff`. Pointed at Foliage it would build the
wrong brand in the wrong repo. The phase structure is kept; every binding is new.

## The gates, and the failure each one exists to stop

**1. Browser evidence, at the settled state — and it is ONE command.**

```bash
pnpm verify                  # every surface: boots, checks headers, drives the browser
pnpm verify photosynthesis   # just one
```

`tools/verify/verify.mjs` drives **BrowserOS neo over its MCP endpoint on loopback**
(`127.0.0.1:9010/mcp`) from a script rather than one agent tool-call per step. It boots any
surface that is not already answering, asserts response headers (including the CSP
backstops that are contractual per app), fires the forged-origin requests a mutating
surface must refuse, then runs ONE in-page probe that settles (fonts ready, zero running
animations) and returns contrast measured at each element's own px size, heading outline,
overflow, counts, and score-shaped-text sightings. Roughly **1.5 seconds for all three
surfaces**, against ten-plus agent turns before — and every line names the value it
measured, so a PASS is quotable as evidence and a FAIL is actionable.

It earned this paragraph on its first full run by catching a real defect three prior
verification passes and a 13-agent review had all missed: the photosynthesis review page
named three typefaces and served none, rendering entirely in fallback faces
(`document.fonts.size` = 0). Adding a surface to the loop means adding a row to `SURFACES`
in that file; the runner has no per-surface logic beyond the table.

A UI claim requires a measurement taken from the running app after animations finish —
not a static computation, not a DOM read, not a passing test. *Why:* a design run reported "bounding boxes computed from the shipped module;
margins balanced" and was right about the module and wrong about the render — content sat
14.4 units outside its viewBox. Three fix attempts then failed because `getBBox` includes
descendant CSS transforms, so every mid-animation measurement was measuring a frame of the
animation. Numeric self-verification is not looking.

**2. Contrast is stated with its text size.** Every contrast claim names the ratio AND the
px size it is judged at. *Why:* `--fol-text-faint` was recorded as passing at 4.10:1 because
the 3:1 large-text threshold was applied to an 11px label, which needs 4.5:1. Correct
arithmetic, wrong reference.

**3. No fake data, and fixtures are never called real.** A surface backed by fixtures is at
most `PARTIAL`, and its row must say so. *Why:* `career-ops` was once called "live/31-green"
on fixture data.

**4. The licensing boundary holds.** `pnpm check:boundary` must pass. The open set must build
and run alone, or the open-source claim is marketing.

**5. Product invariants are review gates, not preferences.**
- No score, ranking, or composite anywhere in `@foliage/leaf`. `ProofTier` stays unordered.
- `excluded` is not an error and always carries a reason.
- Approval and publish are separate events; the accent never encodes release state.
- Which plane you are in must be unmistakable.

**6. Independent review.** Reviewers run on a DIFFERENT model than the builders. *Why:* today
a different model caught a contrast error in tokens this session had just declared clean.
Same-model review is still adversarial but it is not independent, and it must say so.

## Context comes from retrieval, not grepping

Every agent gets context deliberately, because scanning is how a 318,542-token vault gets
read to answer a 4,000-token question:

- **Prose, decisions, history** → `pnpm vault:ask "<question>" --budget 6000`
  Router → BM25 index scoring → budgeted walk over hand-authored `[[wikilinks]]`. Returns a
  pack with provenance per node. Zero tokens, ~20ms, nothing opened that was not selected.
- **Code structure** → `graphify affected "<symbol>"` for reverse impact. Feed it SYMBOLS,
  never prose — a prose question returns hundreds of nodes and nothing useful.
- **Brain** → `cd ~ && gbrain search "<topic>"` before answering anything about people,
  companies, deals or projects. Never in parallel with another call of your own; on lock,
  retry once after ~15s.

## gstack per phase

| Phase | Skill | Used for |
|---|---|---|
| Build (spec) | `/spec` | turn a ledger row into an executable contract before writing code |
| Build (FE) | Open Design MCP | tokens and components pulled from `foliage-design-system` / `canopy-design-system`. Never hand-invented |
| Review | `/review` | per-lane adversarial diff review |
| Review (FE) | `/design-review` | drift against the Open Design source, spacing, hierarchy, AI-slop patterns |
| Review (sec) | `/cso` | egress, secrets, plane leakage |
| Verify | `/qa-only` | report-only QA against the running app |
| Ship | `/land-and-deploy`, `/canary` | owner-gated, default OFF |

## The local surface

```bash
pnpm install
pnpm check                  # boundary → egress → dup → findings → typecheck → tests. Green means the tree is honest.
# zero dependencies. `/` is a 404 — there is no index yet, so name the page:
node apps/canopy/server.mjs # http://127.0.0.1:4173/canopy-system.html
```

Verification is non-interactive and always timeout-wrapped, so a check may FAIL but must never
HANG: `timeout 180 pnpm test`, `curl -s -m5`, and never a foreground dev server.

## Atomic reconcile

The STATUS row and the cursor advance in the SAME step, in one commit. *Why:* the previous
loop kept a separate 108KB `state.json` that froze at iteration 12 while a day of work landed
only in the ledger. The cursor here stays tiny on purpose.

## Ship is off

`ship: 'off'` is the default and means an honest deferral: the row is marked with what is true
locally, and anything requiring an owner action is named as such. The loop never pushes to a
remote and never deploys. The repository stays private until `X3` is decided.
