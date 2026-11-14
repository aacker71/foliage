# Foliage — design drift, and what is owed back to the design source

**Purpose.** This project keeps discovering the same defects because findings die in reports.
A review that only fixes the repo leaves the Open Design master intact, so the next agent
re-imports the same defect and the next review re-discovers it. This file is the return path:
**every finding that is an error in the DESIGN SOURCE is written here as an instruction a
design agent can apply without re-deriving the reasoning.**

This file is the handoff. **Nothing was written into the Open Design app's data directory.**

---

## 0 · Evidence ledger — read this before trusting a number below

| Claim class | Label | How it was established |
|---|---|---|
| Every contrast ratio in this file | **verified — computed in this run** | WCAG 2.x relative luminance, computed by me from the two `tokens.css` files. Calculator self-checked against both spec anchors (`#FFF`/`#000` = 21.00, `#767676`/`#FFF` = 4.54) **before** any result was used |
| The mark geometry | **verified-working — measured in the running product** | BrowserOS neo on `http://127.0.0.1:4292/` and `:4293/tree`; path data read out of the live DOM, sub-path bounding boxes computed in-page, screenshots taken and read |
| Zero non-loopback origins | **verified-working — measured in the running product** | `performance.getEntriesByType('resource')` on all three real surfaces at two viewport widths. Not a grep |
| Viewport / responsive numbers | **verified-working — real re-layout** | CDP `Emulation.setDeviceMetricsOverride`, with `innerWidth` and `matchMedia` **read back** after each override |
| Served-byte counts | **verified — curl against my own listeners** | ports verified free before binding; listener PIDs matched spawn PIDs |
| OD file/line citations | **verified — read from disk this run** | Open Design project directories, read directly |
| The colour-space finding (§2.3) | **inherited, NOT re-verified by me** | Computed by `docs/DESIGN-SYSTEM-ADOPTION.md` §4.6. I confirmed the *contradiction* exists in the OD files; I did **not** re-run an OKLab/OKLCh converter |

**Transport note.** `~/Documents/GitHub/bclaw.mjs` is present but its session handshake is
broken — `POST http://127.0.0.1:9010/mcp` answers **HTTP 406** and the CLI dies on
`SyntaxError: Unexpected end of JSON input` at `bclaw.mjs:80`. That is a CLI fault, not a dead
endpoint. All browser evidence here came through the **browseros-neo MCP tools**, the sanctioned
fallback. One tab (page 26) was opened and **closed** before this run ended.

**Gate at the time of writing:** `pnpm run check` → boundary intact (8 packages, 4 closed),
all 8 projects typecheck `Done`, **tests 684 / pass 684 / fail 0**, `duration_ms 5877`.

---

## 1 · FIXED IN CODE — implementation drift, closed

Each row is a finding that was **our** error, not the design source's.

| # | Defect | Commit | Verified how |
|---|---|---|---|
| 1 | `/` rendered its 40px headline through `font-optical-sizing: auto`, i.e. the **text cut** of Fraunces at display size. `opsz` was never pinned | **`2384ea1`** | Live: `getComputedStyle(h1).fontVariationSettings` on `http://127.0.0.1:4292/` now reads `"SOFT" 28, "WONK" 0, "opsz" 90` at both 1440 (40px) and 360 (32px). `h2` deliberately left alone — 25px with no `opsz` is what OD's own `.spec` does |
| 2 | `/tree`'s three display headings set **no** `font-variation-settings`, so they inherited the shipped font's own `fvar` defaults — and this face defaults **WONK to 1 (its maximum)**. `/tree` was rendering wonky alternates while `/leaf` rendered normal forms | **`357276d`** | Live: `getComputedStyle('.tree-fail h1').fontVariationSettings` on `:4293/tree` now reads `"SOFT" 28, "WONK" 0`. The headline "drops every axis / 15.1% off" was **wrong** — `opsz` was already resolving via `auto`; the real defect was WONK. No `opsz` was added, correctly |
| 3 | `data-verbatim="title"` was emitted **unconditionally**, so a machine-drafted title was attested as the artifact's own words *and* exempted from the no-score gate (the test strips every `data-verbatim` region before scanning) | **`a2a4b62`** | Served bytes: `/` shows **47** `data-verbatim="title"` (real commit subjects) and **1** `data-authored="drafted-title"` (the promoted `canopy: 4 commits`). `/review` shows **0 / 5** — every candidate title is now marked authored |
| 4 | The document `<title>` carried the raw commit subject, putting a third party's email address into the tab, history, bookmarks and link previews — outside any `data-verbatim` region | **`a2a4b62`** | Served bytes: `<title>Foliage — pending leaflet 3d5d02a0e8fd</title>`. **Zero** `@` characters across the `<title>` of all four real surfaces |
| 5 | The git light source only *asked* the local model not to rate people (a sentence in the prompt). The photo and brain sources already **refused** rating-shaped drafts; git did not | **`1d83f07`** | `apps/leaf/harvest.mjs` now tests the model's draft against `RATING_SHAPED` and fails closed, quoting the refused text verbatim. Covered by the new `apps/leaf/src/harvestDraft.test.ts` |
| 6 | Fixtures served three cross-person aggregate shapes the domain refuses: the whole-tree tier strip (**R2**), an 8-company tier league table, and a crown whose paint derived from a company-wide verified **ratio** | **`3c13788`** | Served bytes, comment-stripped: `canopy-public-tree.html` live markup contains `Whole tree` **0**, `Leaflets total` **0**, `Verified` **0** (each survives only inside a comment that documents the refusal). `canopy-public-canopy.html` headers are now `Tree / Plot / Leaves / Last growth` — the three tier columns are gone. `canopy-crown.js` no longer computes `org.verified / (…)` |
| 7 | `AGENTS.md` said *"The mark is circinate vernation"* while every shipped asset drew the bipinnate compound leaf — a contract naming the retired figure is how the coil returns | **`d3c8abf`** | `AGENTS.md:67-68` now names the supersede and forbids the return |

**Note on #6, stated precisely because the fix report overstated it.** The canopy lane
reported these strings at "0 matches". Measured on the served bytes they are at **raw = 1**
and **live-DOM = 0** — they survive as refusal comments, which is the correct outcome and what
the lane actually built. The stronger phrasing would have failed a byte-level audit.

**The endorsed shape was correctly left alone.** The per-person `Proof mix` triple stays: it is
the identical shape the real `/tree` ships (`renderTree.ts` emits all three `PROOF_TIERS` per
person) and it is what refusal **C3** prescribes ("show all three tier counts, or none"). Two
reviewers attacked it; both were misreading C3's rationale as its rule.

---

## 2 · CORRECTIONS OWED TO THE DESIGN SOURCE

These are places where **Open Design is wrong for this product**. Each names the exact file and
element, the correction, and the domain rule that requires it.

**OD MASTER** (v0.2, newest) =
`~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/72967fc2-06d2-4c81-8b46-412e568b5177`

---

### 2.0 · THE STALE-PROVENANCE HAZARD — fix this one first

**There is a THIRD Foliage project in Open Design, and it tells the next agent to ship a spiral.**

> **Project `6e0c4a97-fba1-4230-9fee-26e4df4196df`** — titled "Foliage — Design System",
> last touched **2026-08-17**.

It states, in six places, that the bipinnate mark is **retired**:

| File | Line | What it says |
|---|---|---|
| `DESIGN.md` | 34-37 | *"**Superseded, 2026-08:** an earlier generation of this package documented a bipinnate frond… Upstream has since redrawn the mark as a single stroked spiral in two tiers… **do not ship them.**"* |
| `context/provenance.md` | 15-17, 44, 51 | `mark-generator.mjs` — **SUPERSEDED**; the three tiers moved to `assets/superseded/`; *"this package's v0.2 bipinnate assets are now superseded"* |
| `assets/README.md` | 12 | `superseded/mark-icon.svg` — *"3 pairs, plumes solid"*, viewBox `-9.3 8.3 70.9 96.9` |
| `build/README.md` | 18-31 | *"do not run it; it would overwrite the current artwork"* |
| `SKILL.md` | 16 | *"The two mark tiers (**single stroked spiral**)"* |
| `preview/brand-assets.html` | 61, 165-166, 176 | *"The retired bipinnate set (3 tiers). Provenance only — **never ship**."* |

**This is exactly backwards, and here is the proof rather than the argument.** I compared the
path data byte-for-byte:

```
repo  packages/foliage-tokens/src/mark-icon.svg          first path d=, 749 chars
OD    6e0c4a97…/assets/superseded/mark-icon.svg          first path d=, 749 chars
IDENTICAL === true
```

**The artwork that project files under `assets/superseded/` with "never ship" is byte-identical
to the mark Foliage ships today** — the one I photographed rendering at 15.56:1 on the real `/`
this run. Its replacement, `6e0c4a97…/assets/mark-primary.svg`, is a **single stroked path**
(`M-25.39 35.36L-14.60 45.78L7.63 22.76C…`) — a check whose long arm curls, i.e. the circinate
coil.

**Corrections required in project `6e0c4a97-fba1-4230-9fee-26e4df4196df`:**

1. **Reverse the supersede.** In `DESIGN.md:34-37`, replace the "Superseded, 2026-08" block
   with: *"**Superseded, 2026-08-16 (owner decision):** an earlier generation documented the
   mark as circinate vernation — a fiddlehead, the frond still coiled in the bud. That figure is
   retired. The mark is the **bipinnate compound leaf**: one rachis, pinnae fanning outward,
   each clothed in obovate leaflets. No spiral or coil belongs on any surface."*
2. **Swap the directories.** `assets/mark-*.svg` (the stroked spiral) moves to
   `assets/superseded/`; `assets/superseded/mark-icon.svg` and its two siblings return to
   `assets/`. Un-mark `build/mark-generator.mjs` — it is the **current** generator.
3. **`SKILL.md:16`** — "single stroked spiral" is false. Three tiers, bipinnate compound leaf.
4. **`preview/brand-assets.html:61,165-166,176`** — the "never ship" table row now describes
   the shipping mark. Invert it.

**Domain rule.** Constraint 7 and `AGENTS.md:67-68`: *the mark is the bipinnate compound leaf;
the coil may be named only in the one historical note that explains what was superseded.* Owner
decision, **2026-08-16**.

**Why this is the highest-priority correction.** `6e0c4a97` was modified **2026-08-17 — the day
after the owner's decision** — and is therefore *newer* than the `foliage-design-system` origin
project (2026-08-16 18:02). Any "use the newest file" heuristic between those two picks the
spiral. Only the master `72967fc2` (2026-08-19) is both newest overall and correct, and nothing
in the tree says so. **A stale file reading as current is exactly what sends the next session
the wrong way**, which is the failure this document exists to prevent.

---

### 2.1 · `opsz` is the one display axis OD never put in a shared layer

**Where.** `css/foliage.css:23` is the **only** `opsz` declaration in the OD system layer
(`.wordmark`, `"opsz" 100,"SOFT" 24,"WONK" 0`). `css/foliage.css:160` (`.spec`, the other
display utility) sets `"SOFT" 28,"WONK" 0` with **no** `opsz`. Every remaining `opsz` lives in a
page-local `<style>` block — I counted them: 11 files carry page-local
`font-variation-settings`, including `prototypes/public-leaf.html` (the file the adoption
contract names *"the model — copy this one"*).

**The consequence, measured.** A consumer who adopts the system layer faithfully inherits
`SOFT`/`WONK` and **never learns display headings need `opsz`**. Both Foliage apps did exactly
that, independently, and both shipped the text cut at display size. That is not two careless
lanes; that is a system layer that does not carry its own recipe.

**Correction.** In `css/tokens.css` add two tokens, and have `css/foliage.css` consume them
instead of restating literals:

```css
--fol-fvs-display: "opsz" 100, "SOFT" 24, "WONK" 0;   /* 40-50px — .wordmark, .fol-display, h1 */
--fol-fvs-brand:   "opsz"  60, "SOFT" 24, "WONK" 0;   /* ~20px — .k-brand */
```

Then record, in the token comment, the two facts that make this non-optional:

- *"`opsz` is not decorative. Omitting it leaves `font-optical-sizing: auto`, which resolves
  `opsz` to the used px size — the text cut, not the display cut. Measured on a live page:
  'Alex A Handgloves' at 40px/400 is 342.65px with no `opsz` and 291.29px at `"opsz" 100` —
  **17.6% wider**."*
- *"`fraunces-var.woff2`'s own `fvar` defaults are `opsz 9, SOFT 0, **WONK 1**`. WONK's default
  is its MAXIMUM, so a heading that sets no `font-variation-settings` at all renders the wonky
  alternates. `SOFT`/`WONK` must be set even where `opsz` is left to `auto`."*

**Do NOT specify a single `opsz` for all sizes.** `DESIGN.md:191` already gives the range
(`"opsz" 60–100`) and OD implements a ladder — 100 at 40/50px, 72 at 25px, 60 at 20px. State the
ladder in the system layer rather than leaving each consumer to infer it.

**Domain rule.** Not a domain constraint — a fidelity one. The FE contract requires matching the
exported type scale exactly; a recipe that exists only in page-local blocks cannot be matched by
a consumer of the system layer.

---

### 2.2 · OD's day ramp fails WCAG AA on the ground OD's own `.face-day` binds

**Where.** `css/tokens.css:99-103`.

OD never measured its day ramp on `--fol-paper-raised` (`#E1E1DA`, declared two lines below at
`:104`). **I measured it.** These are my numbers, at 11px, where AA requires **4.5**:

| OD token | value | paper | paper-sunk | **paper-raised** | OD's own comment |
|---|---|---|---|---|---|
| `--fol-ink-faint` | `#5B6D62` | 5.01 | 4.58 | **4.20 ✗** | *"5.01:1 on paper, 4.58:1 on paper-sunk"* — **omits raised** |
| `--fol-pending-day` | `#5A6D64` | 5.01 | 4.58 | **4.20 ✗** | *"5.01:1"* — no ground named |
| `--fol-excluded-day` | `#746559` | 5.09 | 4.65 | **4.26 ✗** | *"5.09:1"* — no ground named |
| `--fol-invalid-day` | `#8B5E3C` | 5.07 | 4.63 | **4.25 ✗** | *"5.07:1"* — no ground named |

Every comment is arithmetically correct for the ground it names. Three of the four **name no
ground at all**, and the fourth stops one ground short of the failing one.

**Correction — take the repo's values, which I measured passing on all three day grounds:**

```css
--fol-ink-faint:     #55665C;  /* 5.54 paper / 5.07 sunk / 4.64 raised @11px */
--fol-pending-day:   #4F6058;  /* 6.06 / 5.54 / 5.08 @11px */
--fol-excluded-day:  #6E5142;  /* 6.54 / 5.98 / 5.48 @11px */
--fol-verified-day:  #1A6344;  /* 6.55 / 5.99 / 5.49 @11px — OD's value is correct, keep it */
```

**And adopt the comment convention that made the difference:** *a ratio without its background
AND its px size is not a result.* Every one of the four failures above is a comment that omitted
the ground. State all three grounds, or state which one the token is forbidden on.

`--fol-invalid-day` `#8B5E3C` stays with a recorded constraint rather than an invented
replacement: **it may not be placed on `--fol-paper-raised`** (4.25:1). The only form in this
product is night-face `/review`, so the token is unused today; inventing a colour for a surface
that does not exist is the wrong trade.

**Domain rule.** Constraint 5 — contrast is measured, not copied. `.fol-label` renders at 11px
(`--fol-t-11`), which is **normal text**, so the threshold is 4.5, not the 3:1 large-text one.

---

### 2.3 · `--fol-accent-lift` is pinned from the wrong colour space

**Where.** `css/tokens.css:72` says `color-mix(in **oklch**, var(--fol-accent) 84%, var(--fol-text))`.
`brand.json:156`, `context/provenance.md:57` and `:86` all pin **`#B2D258`** and describe it, in
words, as the *"**OKLab** resolution"*.

Those are different spaces. OKLab interpolates rectangularly; OKLCh takes the shorter hue arc.
A consumer pinning `#B2D258` renders a **different colour** than the CSS engine paints.

**Correction.** Keep the `color-mix(in oklch, …)` form as the shipped value — Baseline 2023,
zero dependencies, no build step. Change the three prose pins to say **OKLCh**, and pin
**`#A9D55F`** rather than `#B2D258` wherever a non-CSS target needs a literal.

**Honesty label:** I verified the **contradiction** (the CSS says `oklch`; three files say
`OKLab` and pin `#B2D258`) by reading the files this run. I did **not** re-run a colour-space
converter — the `#A9D55F` value is inherited from `docs/DESIGN-SYSTEM-ADOPTION.md` §4.6. A
design agent should re-derive it before pinning it.

**Domain rule.** Not a domain constraint. It is a correctness one: a token with two published
values has no value.

---

### 2.4 · Interactive boundaries fail WCAG 1.4.11 — OD measures no border at all

**Where.** `css/foliage.css:62` (`.btn-ghost`) and `:69` (`.field`) both take
`--fol-border` as their **only** boundary. `:79` does the same for the pill.

**My measurements** (WCAG 1.4.11 requires **3.0** for a user-interface component):

| Token | value | canvas | surface | surface-raised |
|---|---|---|---|---|
| `--fol-border` | `#26402F` | **1.68 ✗** | **1.57 ✗** | **1.42 ✗** |
| `--fol-hairline` | `#1E3227` | **1.39 ✗** | **1.31 ✗** | **1.18 ✗** |

**Correction.** Split the role in `css/roles.css`, which OD already has:

```css
--fol-role-edge:         var(--fol-border);      /* DECORATIVE only — encloses a .cell */
--fol-role-edge-control: var(--fol-text-faint);  /* anything INTERACTIVE: field, button, focusable card */
```

I measured `--fol-text-faint` `#7D9184` at **5.65 / 5.30 / 4.80** on the three night grounds and
`#55665C` at **5.54 / 5.07 / 4.64** on the three day grounds. One alias clears 3:1 on every
ground of both faces. Rebind `.field`, `.btn-ghost` and any focusable card to
`--fol-role-edge-control`.

**Also refuse `--can-night-control` `#4A6B55`** if it is ever proposed upward: I measured it at
3.18 on canvas but **2.99 on `--fol-surface`** and **2.71 on `--fol-surface-raised`**. Its
comment claims "3.18:1 — interactive borders" without saying that only holds on canvas, so a
field inside a `.cell` misses 1.4.11.

**Domain rule.** WCAG 2.2 SC 1.4.11 Non-text Contrast.

---

### 2.5 · The day focus ring is invisible

**Where.** OD's day focus treatment is `2px solid var(--fol-accent)`.

**My measurement:** `--fol-accent` `#A8CC29` on `--fol-paper` `#F6F4ED` = **1.68:1**. Fails
1.4.11's 3:1 for a focus indicator.

**Correction.** Keep OD's geometry (2px, `outline-offset: 1px`) and move the **colour** to
`--fol-ink` on day. I measured `#0E1F16` on `#F6F4ED` = **15.56:1**. The repo already does this;
OD should adopt it so the next import does not regress it.

**Domain rule.** WCAG 2.2 SC 1.4.11, and SC 2.4.13 Focus Appearance.

---

### 2.6 · `.btn-ghost:hover` paints its ground onto an identical ground

**Where.** `css/foliage.css:63` — `.btn-ghost:hover{background:var(--fol-canvas)}` — and `:65`
— `.btn-ghost:active{background:var(--fol-evergreen-900)}`.

**Measured live** in the running product (`http://127.0.0.1:4292/review`, `.is-hover` toggled on
a real button and read back in a separate call so the style recalc is real):

```
rest  background-color  rgba(0, 0, 0, 0)     (the whole ancestor chain is transparent)
hover background-color  rgb(11, 18, 14)
page  ground            rgb(11, 18, 14)      <-- IDENTICAL. contrast ratio 1.000
```

OD wrote this rule for a ghost button **inside a `.cell`**, where `--fol-surface` →
`--fol-canvas` is a 1.066:1 recess. On a page ground there is nothing to sink to, so the hover
state paints no state. `:active` is worse — `--fol-evergreen-900` `#07120C` against canvas is
**1.006:1**.

**Correction.** OD already declares the right role at `css/roles.css` — the one it names *"track,
hover ground"*. A hover must **lift**, not sink, so it works from every ground:

```css
.btn-ghost:hover,.btn-ghost.is-hover{background:var(--fol-role-panel-raised,var(--fol-surface-raised));
  border-color:var(--fol-text-muted);color:var(--fol-text)}
.btn-ghost:active{background:var(--fol-role-panel-raised,var(--fol-surface-raised));
  border-color:var(--fol-text)}
```

**Domain rule.** OD's own stated rule, `css/roles.css`: *"HOVER LIFTS, PRESS DARKENS: contrast
may only rise on a state change."* The current rule violates the system's own contract. Note
this is an interaction-feedback defect, **not** an accessibility failure — WCAG sets no
hover-contrast floor.

---

### 2.7 · Every OD page loads Google Fonts

**Where.** **28 files** carry `fonts.googleapis.com` / `fonts.gstatic.com` — every prototype,
every `ui_kits/app/*` page, every `preview/*` page, and `index.html`.

**Correction.** Delete the `preconnect` pair and the `css2?family=…` stylesheet link from all
28. Self-host the four woff2 and declare them with `@font-face` in `css/tokens.css`.

**Domain rule.** Constraint 4 — **zero non-loopback origins**. The product's privacy claim is
zero network calls. Worse than a policy breach: the served CSP is `default-src 'none'`, so those
links are **blocked silently** and the page falls back to Georgia — *a different design,
delivered quietly, with no error*.

**Verified this run:** every real Foliage surface makes **zero** external requests. Measured in
the browser at 360 and 1440 on all three surfaces: `externalReqs: 0`, 6/6. The only external
string anywhere in the served bytes is `http://www.w3.org/2000/svg`, a namespace URI that is
never dereferenced.

---

### 2.8 · `published-leaf.html` contradicts `public-leaf.html`, and is the wrong one

**Where.** `ui_kits/app/published-leaf.html:95` —
*"Only verified leaves are published. Pending and excluded work stays on the…"*

**Correction.** Delete that `k-note`. Replace with `prototypes/public-leaf.html`'s rule:
*"Excluded leaflets stay visible. A portfolio that hides what it could not attribute is not
evidence."*

**Domain rule.** This is the product thesis. Hiding excluded work makes the document a highlight
reel — the exact thing Foliage exists not to be. Two OD files genuinely contradict each other;
the prototype is right and the kit is wrong.

---

### 2.9 · The `Unattributed` branch is the fourth tier in costume

**Where.** `prototypes/organization-tree.html:101` (`<b>Unattributed</b> · 1 leaf · 7 leaflets`),
`:147` (`Contract team · Unattributed branch`), and the generator that produces them —
`tools/tree-generator.mjs:42` and `:44` (`BRANCHES = [… 'Unattributed']`).

**Correction.** Remove `Unattributed` from `BRANCHES` and delete the `Contract team` row.
Unattributable leaflets are **`excluded` on the leaf they belong to, with a reason** — never a
bucket of *people*.

**Domain rule.** Constraint 2 — there are exactly three proof tiers and `ProofTier` is
deliberately unordered. A fourth bucket defined by a proof outcome is a fourth tier, and one
made of *people* is worse: it is a rating of persons.

---

### 2.10 · The score shapes, as one list

`prototypes/organization-tree.html`, `prototypes/portfolio.html`,
`ui_kits/app/canopy-dashboard.html` carry shapes this domain refuses outright. Full derivation
is in `docs/DESIGN-SYSTEM-ADOPTION.md` §5.1 (R1–R13); this is the index a design agent needs:

| Ref | OD element | Refused because |
|---|---|---|
| R1 | `Grounded / Claims / 96.2%` (`portfolio.html`, `canopy-dashboard.html:76`) | A composite percentage over one person's work. A score |
| R2 | `Whole tree · counts only` — `358 / 41 / 13 / 412` | A sum over 14 people. Its own caption claims no such shape exists; **the four integers ARE the composite** |
| R3 | Per-branch tier triples (`130 verified, 14 pending, 4 excluded`) | Per-team cross-person aggregate. A reader diffs Firmware against Platform and has a leaderboard |
| R4 | A `.proof` badge on a **person** or **team** row | A tier belongs to a leaflet. A person is not verified; some of their leaflets are |
| R6 | The ~190-ellipse radial tree projection | A whole-org composite, and the most legible ranking on the page **precisely because it is not a number** — distance-from-trunk compares people |
| R7 | `Growth this week` + `Sources read 3 of 4` + `width:75%` bar | Progress-toward-complete framed as productivity. Also breaks `.bar`'s own rule: *"if nothing is running, do not render a track"* |
| R9 | `<span>Commits</span><b>4,904</b>` roster columns | A COMMITS-count column implying a cross-person aggregate |

**Permitted, and the distinction matters:** counts **by tier**, for **one person**, on **their
own row** — all three, or none. That is what the real `/tree` ships and what refusal C3
prescribes. Two reviewers this cycle attacked that shape by quoting C3's *rationale* and
dropping its *rule*; both were wrong. Do not "fix" it.

---

### 2.11 · The taxonomy is wrong for this product

**Where.** OD's specimen sheet describes a five-level taxonomy in which *a Tree is an
organization*, and **omits Bough entirely**.

**Correction.** Six levels: **Canopy › Tree (a company) › Bough (an organization) › Branch (a
team) › Leaf (a person) › Leaflet (one piece of work)**.

**Domain rule.** `AGENTS.md:32-39`, settled by the owner 2026-08-17. `Tree.organization` →
`Tree.company` is already a shipped, breaking rename; the old manifest key is **refused, not
aliased**. Also note: **`Branch` vs git's `branch` is a permanent collision** — the two words
must not appear in one file together.

---

## 3 · STILL OPEN

### 3.1 · Confirmed and NOT fixed

| # | Defect | Why it is still open |
|---|---|---|
| 1 | **`.btn-ghost` hover and pressed are invisible on `/review`** — hover ground === page ground, **ratio 1.000**, re-measured by me this run | The fix is in `packages/foliage-tokens/src/foliage.css:103-105`, **outside the leaf lane's ownership**. The finding explicitly forbade the in-lane workaround. Needs a `packages/**` lane. See §2.6 for the exact patch |
| 2 | **A commit subject can publish a third party's email on the day surface `/`** | The `<title>` half is fixed (`a2a4b62`). The **body** half is not: `packages/leaf/src/intake.ts:459` `titleOf()` returns `subject.trim()` unfiltered, and it reaches `<h1 data-verbatim="title">`. Two blockers: the file is in `packages/`, and `render.ts:56-62` records redaction as a deliberately-deferred **owner/FCRA decision**. **This must be closed before anything is published.** Note the trap: the filter must match an addr-spec with a dot-bearing domain, *not* a bare `@` — this repo's own package names are scoped (`@foliage/tokens`) and a bare-`@` filter would falsify real commit subjects |
| 3 | **R6 — removed 2026-09-08.** The fabricated radial crown and its page are deleted. | Owner-authorized fixture retirement; the crown script, styles and inline CSP exception are also gone. |
| 4 | **`/tree`'s two comparison cells stack below 820px** | Confirmed by me at a **read-back `innerWidth` of 624**: `.cells-2.tree-facts` resolves to `grid-template-columns: 576px`, both cells at `x=24, w=576`, `y` 287.4 vs 410.6. `tree.css`'s own comment says the two must sit side by side *"because when they differ, the difference is the most important fact on the page"* — and `foliage.css`'s `@media (max-width:820px){.cells-2{grid-template-columns:1fr}}` defeats it on every phone |
| 5 | **The canopy sprite ships all 8 symbols on every page**; leaf subsets to 4 | Measured live: `/` inlines `[fol-mark-sm, i-partial, i-check, i-exclude]`; `/tree` inlines all 8. `apps/leaf/src/sprite.ts` already solves this and belongs in `packages/foliage-tokens` |

### 3.2 · Deliberately not done, with the reason

| Item | Why |
|---|---|
| **`--fol-invalid-day` keeps a failing value** | 4.25:1 on `paper-raised`. Recorded as a binding constraint (§2.2) rather than papered over with an invented colour, because the only form in the product is night-face `/review` and the token is unused today |

### 3.3 · Unverified — NOT measured this run, do not read as passing

- **1920px.** I measured **360 and 1440 only**, both with CDP viewport emulation and read-back.
  A previous run's "360/1440/1920: zero overflowing elements" claim had **no viewport read-back
  at all** and is inadmissible; it has been corrected in `.loop/DEMO-SCRIPT.md`.
- **Print stylesheet, `prefers-reduced-motion`, `:focus-visible` rendering.** Not exercised.
- **Five of the six canopy fixtures.** I fetched their bytes and checked the refusal shapes; I
  did **not** render or screenshot them.
- **Nothing is `verified`, and cannot be here.** There is no `gpg` on this machine, so
  signatures cannot be checked. `0 verified` is the correct, honest result for unsigned history
  — **do not fake a verified leaflet to make a screen look better.**

### 3.4 · Independent re-verification by the session lead, and one finding this document did not carry

Measured 2026-08-19 on a fresh pair of servers booted from `e527666` — ports confirmed free
before binding, **listener PIDs matched the spawn PIDs**, real data from this repository's own
55-commit history (`0 verified` because no signature on this machine is checkable).

**Confirmed independently** (`/` day, `/review` night, `/tree` day):

| Claim | Measurement |
|---|---|
| The mark is the compound leaf, not the coil | `#fol-mark-sm` = **6 subpaths + 1 rachis**, viewBox `-9.3 8.3 70.9 96.9`, rendering 28×28 |
| The mark takes its face | **cream `#E9F0EA` on night**, **evergreen `#0E3927`** on day — the token rule, both observed |
| Contrast | `/` **15 pairs, 0 failures**, worst 5.54:1 · `/review` **15 pairs, 0 failures**, worst 5.30:1 @ 11px |
| Focus ring | Tab-driven, `:focus-visible` **true**, `outline: solid 2px #A8CC29` offset 1px, `box-shadow: none`, **10.24:1** vs ground |
| Zero third-party origins | Only origin on every surface is the loopback server. `document.fonts` = **loaded / 4**, all self-hosted |
| Settled | **0** running animations on both faces |
| No score | **0** percentages on every surface. The single `grade` hit is the page refusing: *"no ratio, percentage or grade is computed here"* |
| Three tiers only | `unattributed` = **0** occurrences on every real surface |
| Taxonomy | `/` renders **leaflets 59 / leaves 0** — `portfolio.html`'s error (§2.11) is **not** reproduced |
| Adoption | **14** design-system classes now present on `/` (`cell`, `proof`, `lockup`, `plate`, `ico`, `fol-metric`, …), against **0** before this cycle |

**Correction to my own earlier reading.** I first judged §2.9's `Unattributed` a harmless
org-chart grouping rather than a fourth tier, on the grounds that the tier counts beside it are
still exactly three. **§2.9 is right and I was wrong.** It traces to `tools/tree-generator.mjs:42`
where `Unattributed` is a member of `BRANCHES`, and its sharper point stands: a bucket of
*people* defined by a proof outcome is worse than a fourth tier, not milder. Unattributable
work is `excluded` on the leaf it belongs to, carrying its reason.

**Not carried by this document — the recency data does not exist.** `organization-tree.html`
renders `LAST GROWTH · 2h` and sorts by it, and fix #6 left `Last growth` as a live column
header on `canopy-public-canopy.html`. **No per-leaflet date is captured anywhere in the
pipeline:** `apps/leaf/src/gitIntake.ts` `LOG_FORMAT` takes sha / email / `%G?` / subject and no
date, and `provenance.observedAt` is a single intake-run instant shared by every leaflet, so
per-leaflet recency is degenerate. The design is *right* that recency is the honest ordering —
it is the one ordering that is a fact about time rather than a judgement about people — so this
is owed to the **code**, not the design: capture `%aI` into provenance and version the document
format. Until then no surface may imply per-leaflet recency. `/tree` currently avoids the trap
by shipping `ROSTER_ORDER_POLICY` ("listed in the order the manifest names them"); the canopy
fixture header does not.

**Also unverified by me:** I could not reproduce the CDP viewport emulation this document's
360/1440 measurements rest on — `browser.cdp` over the MCP transport rejects its own params
argument (`argument 2 must be a string`, for a literal string). My responsive numbers are from a
read-back `innerWidth` of **624**, where both faces show **zero** horizontal overflow. The
360/1440 figures in §3.3 are that run's, not mine, and I am not restating them as my own.

---

## 4 · How to apply the §2 corrections

They are **not** repo changes. They are edits to Open Design project directories, and the
highest-value one (§2.0) is in a project neither of this cycle's briefs named.

1. Do §2.0 first. Everything else is a defect a careful reader catches; §2.0 is a defect that
   *actively instructs* the next agent to ship the retired figure, and it is timestamped after
   the decision that retired it.
2. §2.1, §2.2, §2.4, §2.5 are token/system-layer edits to `72967fc2…/css/`. They are the four
   that caused real drift in this repo, and each has a measured number attached.
3. §2.7 (28 files) is mechanical.
4. §2.8–§2.11 are content/taxonomy corrections in prototypes and kits.

**Do not apply §2 by copying values out of this repo without re-measuring.** That is the habit
that produced two files each claiming to have absorbed the same WCAG finding and landing on
different colours. Constraint 5: **contrast is measured, not copied** — and a ratio without its
background and its px size is not a result.
