## Six-file project context

Start at [context/project-overview.md](context/project-overview.md), then
[architecture](context/architecture.md), [UI](context/ui-context.md),
[code standards](context/code-standards.md), [workflow](context/ai-workflow-rules.md)
and [progress](context/progress-tracker.md). Read the target application's architecture
linked from the inventory before changing its boundary. The former broad architecture
specifications are historical references, not competing current designs.

# Foliage — agent contract

This file holds **what you cannot discover by looking, and what you would get wrong by
default.** It deliberately contains no test counts, pass tallies, or line numbers, because
those rot and then mislead. If a number can be produced by a command, run the command.

## Run it

```bash
pnpm install
pnpm check          # boundary → egress → dup → findings → typecheck → tests. Green means the tree is honest.
```

Node 22 executes the TypeScript directly (`--experimental-strip-types`). There is **no build
step and no `dist/`**. Do not add one to "make tests work" — if a test cannot find a module,
the import specifier is wrong, not the toolchain.

## Non-negotiables

- **No fake data. Anywhere.** Not in tests dressed as results, not seeded, not demo. If real
  data does not exist, show the honest empty state.
- **No score is ever computed or displayed.** `ProofTier` has no ordering and no numeric
  mapping. Do not add a comparator, a weight, a percentage, or a composite to
  `@foliage/leaf`. This is the FCRA posture, and it is load-bearing.
- **`excluded` is not an error state.** It means "could not be attributed to this subject",
  it requires a reason, and it is counted honestly rather than hidden.
- **The layering boundary is a gate, not a guideline.** `pnpm check:boundary` must pass.
  Nothing in `open` may reach `cloud` or `enterprise`. If an open package seems to need
  something above it, that is a design problem to solve — not a manifest to edit. The leaf
  must stand alone so one person can self-host it. Everything is MIT; see `LICENSING.md`.
- **`Branch` is the taxonomy; `branch` is git's.** The hierarchy is Canopy › Tree (a company) ›
  Bough (an organization) › Branch (a team) › Leaf (one person's portfolio) › Leaflet. So the
  word collides with git's, in a repository whose whole intake path shells out to git. The rule:
  capitalized `Branch`/`BranchId`/`BranchPath` is the taxonomy, git's is always lowercase and in
  context (`git branch`, `--initial-branch=main`, "Merge branch"). They appear in no file
  together today — the taxonomy's lives only in the enterprise plane, git's only in the open
  plane's intake — and keeping it that way is what makes the collision harmless. A `Tree` is a
  **company**, not an organization; that correction is why `@foliage/canopy` says `company`.
- **Never `git add -A`.** Stage explicit paths. Small, reviewed commits.
- **No secrets in the tree.** Every `.env*` is gitignored with **no negations** — a negated
  allow-list is exactly how the previous repo ended up tracking `.env.dev`. An example file
  must be named `env.example`, without the leading dot.
- **Triage PRs by current usefulness, not age alone.** Close outdated or superseded PRs
  without merging once valuable unique work is retained in the current implementation or an
  explicitly tracked successor. Record the disposition and replacement in Asana.

## Traps carried forward from the previous lineage

These cost real hours before. They are written down so they cost nothing now.

- **A wrong `--filter` prints `No projects matched the filters` and exits 0.** Never trust a
  filtered command you have not seen produce real output.
- **Piping to `head`/`tail` makes `$?` the pipe's status.** Use `cmd > log 2>&1; echo $?`.
- **Error masking is a recurring bug class, not a one-off.** When a fallback exists, report
  BOTH causes. When a total function returns a zero value, carry the reason — a function
  that collapses "no git", "not a repo", "timed out" and "no commits" into `0` will make the
  product assert things about work it never read.
- **`.nvmrc` drift.** The previous repo pinned Node 24 while the machine ran 22. This repo
  pins what is actually verified to work, and `engines` enforces it.
- **A design system copy goes stale.** Do not copy token values into documentation. They
  live in `@foliage/tokens`; reference the package.

## Design

**UI stack: Radix Primitives + Foliage-owned components, themed by `@foliage/tokens`.**
Use `@foliage/ui` for shared controls. Radix owns interaction behavior; Foliage owns styling.
Magic UI may remain for purposeful motion on landing and website pages. Read
[docs/UI-FOUNDATION.md](docs/UI-FOUNDATION.md) before new UI work. It records actual
coverage and the application adoption gap; website-local components are not yet shared app UI.

`@foliage/tokens` is the source of truth for colour, type, spacing, motion, and the mark.
The mark is the **bipinnate compound leaf** — a leaf built out of leaves, which is the product's
thesis in one drawing: one rachis, pinnae fanning outward, each clothed in leaflets. The rachis
enters as a check, so the mark still carries the proof the name no longer says.

Three tiers ship in the package, and they **shed pinnae rather than simplify curves**:
`mark-expressive.svg` (5 pairs) → `mark-primary.svg` (4, the lockup) → `mark-icon.svg` (3, solid
leaves). Below ~20px the icon tier is the CORRECT asset, not a degraded fallback — leaflets do not
survive at 28px. Measured 2026-08-20: 171 → 105 → 7 path subpaths across the three.

- All three paint with `currentColor` and carry **no hex** — verified, zero hex across all three —
  because a mark with a baked colour cannot follow the night/day face. Apps use the SVG as a CSS
  `mask` and paint the colour behind it; an `<img>` renders it near-black, because `currentColor`
  there resolves inside the SVG's own document. Reach every asset through the package export map,
  never by relative path.
- **Never draw a spiral or a coil.** The mark was circinate vernation — a fern fiddlehead, a
  427-byte single stroke drawing a bare check with no leaflets — until `35e75f2`. That figure is
  superseded and must not return. The only place it may still be named is the historical note in
  `tokens.css` recording what it replaced. If you find prose anywhere claiming the mark is
  "circinate vernation" or "a single stroke", it predates that change and is wrong — including in
  Open Design, where project `6e0c4a97` still asserts the reverse in 24 places.

Rules that are defects when broken, not preferences:

- The accent (`--fol-accent`, chartreuse) appears **at most twice per screen**, reserved for
  the unfurling moment: a CTA, a progress state, a verified proof.
- **A metric not set in mono tabular-nums is a defect.**
- Prefer a bordered cell to a floating card. Use the shared leaf-inspired shape tokens for
  smoother controls and opposing panel curves; the owner's revision supersedes the former
  small-radius preference. No box shadows.
- Motion never bounces and never spins — a spin re-imports the superseded coil. Reach for
  `--fol-role-ease-in` / `--fol-role-ease-out` (or the primitives `--fol-ease-grow` /
  `--fol-ease-fold`). `--fol-ease-unfurl` survives only as a deprecated alias of
  `--fol-ease-grow` because live stylesheets still reference it; do not use it in new code.
- **Face is chosen by surface, not by preference, and there is no theme toggle.** Night is
  for product/private surfaces (e.g. `/review`). Day is for anything PUBLISHED — a document
  someone else reads, such as `/`, `/leaflet/<id>` and `/tree`.
- **State measured contrast ratios; never assert AA.** Measuring caught a real failure in
  this palette — `--fol-excluded` was 3.95:1 and had to be lightened.
- Fonts must be **self-hosted**. The privacy claim is that the product makes zero network
  calls, and a runtime font CDN breaks it.

## Prompting this model

Claude Opus 5 verifies its own work unprompted. Instructions telling it to verify cause
**over**-verification; removing them costs no capability. Delete on sight: *"double-check
your answer"*, *"re-verify before responding"*, *"use a subagent to verify"*.

This does **not** mean removing independent checks, and conflating the two would delete the
control that actually works. Keep cross-model review, evidence gates, and deterministic
gates like `check:boundary`. The test: this guards against *redundant work*, not *rigor*.

Two things worth putting **into** prompts: **scope discipline** (this model can widen a task
or substitute its own judgement about what the task should be) and an explicit
**delegation cap**.

## Verifying in the browser — ONE TAB PER AGENT

Browser evidence comes from the BrowserOS neo MCP (tools are deferred; reach them with
ToolSearch `select:mcp__browseros-neo__tabs,...navigate,...snapshot,...evaluate,...screenshot`).

**The rule that matters: open one tab, then navigate it. Never `tabs new` in a loop.**

*Why:* one verification run left ~120 tabs behind. A single agent opened ~30 of them, cycling
the same four URLs — `tabs new` per check instead of `navigate` on the tab it already had.
Worse, when an agent's session ends its tabs are **orphaned into the user's own tab list**,
where neither that agent nor any later one can close them: `tabs close` on a page you do not
own is rejected. The debris is permanent and it lands in the human's browser, mixed with
their real work. Tab hygiene is not tidiness here — a leaked tab cannot be cleaned up later.

- `name_session` FIRST, with a 2–3 word label. Tabs group as `<client>/<name>`, so a leak is
  at least attributable.
- `tabs action="new"` **once**. Keep the returned page id. Every subsequent URL is
  `navigate action="url"` on that same id. Re-snapshot after navigating — refs are invalidated.
- Close your tabs when the run ends, keeping at most ONE showing the final state worth looking
  at. Closing is only possible while your session is alive — do it before you finish, not after.
- Never touch a page id you did not open. Other agents and the user hold their own.
- Within one session, neo calls are **sequential** — parallel calls race the session.

Two measurement traps, both paid for already:

- **`screenshot` `size` SCALES the capture; it does not re-lay-out the page.** A 360-wide claim
  from it is inadmissible — the page still reports `innerWidth` 1376. For a true viewport, use
  `run` → `browser.cdp("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor,
  mobile}, sessionId)` with a page-scoped session id, and prove it by reading back
  `window.innerWidth` AND `matchMedia('(max-width:640px)').matches` through `evaluate`. Restore
  with `Emulation.clearDeviceMetricsOverride`.
- **Check the port is free BEFORE binding, and confirm the listener is yours.** A run once
  curled `:4177`, got a 200, and reported it as its own server's output — the page belonged to
  another session and its own server had died with EADDRINUSE.
