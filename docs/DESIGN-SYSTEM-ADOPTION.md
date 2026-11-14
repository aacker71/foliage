# Foliage — design system adoption contract

**Status:** binding for the three build lanes. One decision per question; where I chose, the
alternative I rejected is named so a reviewer can overturn it without re-deriving it.

**What this document is.** Three agents implement this in parallel without talking to each
other. Every ambiguity here becomes divergent code — this project has produced ~86% divergent
duplicate implementations twice by skipping this step. Where this document and a research
brief disagree, this document wins. Where this document and the running code disagree, **stop
and report**; do not guess.

---

## 0. Evidence ledger, and the state of the tree when this was written

Read this before you trust a number below.

| Claim class | Status | How |
|---|---|---|
| Every contrast ratio in this file | **verified — computed in this run** | `/tmp/foliage-contract/wcag.mjs`, WCAG 2.x relative luminance, self-checked against the two spec anchors (`#FFF`/`#000` = 21.00, `#767676`/`#FFF` = 4.54) before any result was used |
| Every `color-mix` hex in this file | **verified — computed in this run** | `/tmp/foliage-contract/oklch.mjs`, sRGB↔OKLab/OKLCh, round-trip-validated (every hex survives `rgb→oklab→rgb` unchanged) and endpoint-validated (`p=0` and `p=100` are identities) |
| Token counts and the OD↔repo delta | **verified — diffed in this run** | extracted both declaration sets, `comm`. OD 71, repo 61, 11 in OD only, 1 in repo only |
| "Exactly one shared token disagrees on value" | **verified — diffed in this run** | pairwise value diff over all 60 shared names |
| Test baseline | **verified — ran it** | `pnpm test` → `tests 581 / pass 581 / fail 0`, exit 0 |
| `frame-ancestors` absent repo-wide | **verified — grepped** | 0 hits across `apps/` and `packages/` |
| Class inventories, DOM shapes, route tables | **built-but-unverified** | read from source. Corroborated by 581 green tests |
| **Anything about how a page LOOKS** | **UNKNOWN** | **No server was booted. No page was rendered. No screenshot was taken.** No visual claim is made anywhere in this document, and none may be inherited from it |

**"Tests pass" is not "it works."** Nothing in this contract is discharged by a green suite.
Each lane's done-criteria include a real rendered surface, and those are the only visual
evidence this project will accept.

### 0.1 The test baseline is not what the brief says

The brief says 566 tests green. **I measured 581 green.** The delta is another session's
in-flight work, not drift. Use 581 as your "before".

### 0.2 ACTIVE FILE-OWNERSHIP COLLISION — read before lane leaf starts

The working tree was **not clean** when this contract was written. At run start (01:14:45):

```
 M apps/leaf/src/render.ts        mtime 01:01:16
 M apps/leaf/src/render.test.ts   mtime 01:01:25
 M apps/leaf/src/seam.test.ts     mtime 01:00:21
 M apps/leaf/public/leaf.css      mtime 00:51:38
 M README.md
?? apps/leaf/share.mjs
?? apps/leaf/src/share.ts         mtime 01:08:49
?? apps/leaf/src/share.test.ts    mtime 01:11:26
```

Another session was editing **lane leaf's core files three minutes before this run began**, and
is plausibly still editing them. There is an unlanded `share` feature (`share.ts`,
`share.test.ts`, `share.mjs`) that this contract has not accounted for because it did not exist
when the research was done.

**Lane leaf: per constraint 9, before your first edit, re-stat every file you own. If any mtime
is newer than your run start, STOP and report the collision. Do not fight another session for
`apps/leaf/src/render.ts`.** Lanes system and canopy are unaffected — no file they own was
touched.

---

## 1. The decision table — every OD screen, the repo route it becomes

### 1.0 The face assignment in the task list is wrong, and constraint 6 is why

The task list says *"Rebuild the leaf surfaces (**night**)"* and *"canopy surfaces (**day**)"*.
**Do not build that.** Constraint 6 says: *"Night = product/private surfaces. Day = anything
published (a document read by an employer)."*

A leaf at `/` **is** the document an employer reads. It is day. `/review` is the operator alone
with machine drafts; it is night. The repo already implements exactly this, and argues it at
`apps/leaf/src/render.ts:130-147` and `apps/leaf/public/leaf.css:18-44`.

So: **constraint 6 and the shipped code agree; the task-list parenthetical is the outlier.** It
appears to come from reading "leaf = the product app" rather than "leaf = the published
document". Flipping leaf to night would break `render.test.ts:520`, `render.test.ts:1074`,
`seam.test.ts:456`, all 16 `DAY_FACE_PAIRINGS` entries, and constraint 6 itself.

**Face is decided by what the surface IS, not by which app serves it.** `apps/leaf` serves two
day surfaces and one night surface. That is correct and stays.

### 1.1 apps/leaf

| OD source screen | Route | Face | Carries over | Refused, and why |
|---|---|---|---|---|
| `prototypes/public-leaf.html` **(the model — copy this one)** | `/` | **day** | The whole page skeleton: name → identity line → scope sentence → **counts strip (3 tiers + untinted total)** → the refusal `.aside` → roster newest-first with excluded rows **visible** → footer restating the plane rule. `.cell` geometry, `.proof` badges, `.aside`/`.note` split, `.pg-counts` grid, zero interactive controls | Every string, name, number and date (§5 MNC-6). A 4th counts cell that is not the total. Any percentage. `.bar` must not appear on this page — it is a published document, nothing is running |
| `prototypes/portfolio.html` | `/` (structure only) | day | The 3-up `.cells` summary shape and the `.metric` row; excluded count tinted with its own semantic | 🚫 **`Grounded / Claims / 96.2%`** — a composite percentage over one person's work. 🚫 The private/publish split: the repo has no private leaf view and must not grow one to host a `Publish` CTA |
| `ui_kits/app/published-leaf.html` | `/leaflet/<id>` | **day** | Day document chrome; `.k-counts` → `.cell`+`.metric b` for the artifact's own facts; `.k-art`'s "framed, never dissolved" rule if imagery ever lands | 🚫 **"Only verified leaves are published"** (its `k-note`). This contradicts `public-leaf.html`, which is right. Hiding excluded work makes the document a highlight reel — the exact thing the product exists not to be. **`public-leaf.html` wins; discard the kit's rule** |
| `ui_kits/app/leaf-detail.html` (detail cell only) | `/leaflet/<id>` | day | The `Leaflet detail` + `Attribution` `cells-2` pair: label, `.k-h2`, `.metric` rows, then the `.proof` badge stating attribution | 🚫 The filter tabs and the `<dialog>` — both need `kit.js`, and the CSP is `default-src 'none'` with no `script-src`. Do not widen it. 🚫 A `.proof` badge on anything that is not a leaflet |
| `ui_kits/app/photosynthesis-run.html` + `components.html` (pattern 06) | `/review` | **night** | `.k-console` (ground `--fol-evergreen-900`, mono 13/1.7) for issue lists; the console colour rule — **an attributed line brightens to `--fol-text`, it never takes the accent; a failure takes `--fol-invalid`, never `--fol-excluded`**. The full form contract: real `<label for>`, `.field`, `.field.is-invalid` + `aria-invalid` + `aria-describedby`, `.err` with `#i-alert`, `role="alert"` in live product | 🚫 `kit.js` entirely. 🚫 The `403` rendered inside a `.metric b` tabular column tinted invalid — a status code in a summable numeric column. Render a failure as text with its cause, out of the numeric column |
| `prototypes/photosynthesis.html` | `/review` (structure) | night | Two independent row lists (things read / things produced) on one page from one row primitive. **Relative time for machine state, absolute ISO for evidence** — port that split. The `.aside` after each list explaining what the list refuses to do | ⚠️ `.bar` is **conditional**: permitted only while a real run is in flight with both endpoints from real counts. `/review` renders a finished harvest, so **no `.bar` on `/review`**. 🚫 all fictional source names and counts |
| `index.html` §07 (state plates) | all three | both | The `.plate` / `.plate-t` / `.plate-b` empty–loading–error contract, and `.sk` **deliberately not animated** (an infinite shimmer trips WCAG 2.2.2) | 🚫 The loading plate on server-rendered routes — there is no loading state in a synchronous server render. Empty and error only |

### 1.2 apps/canopy

| OD source screen | Route / file | Face | Carries over | Refused, and why |
|---|---|---|---|---|
| `prototypes/organization-tree.html` | `/tree` | **day** | The company header + taxonomy sentence; the **structural** counts strip (`Leaves / Boughs / Leaflets / Last growth` — counting members and artifacts is a fact about shape, not about people); ordering by last growth **with the stated reason** ("a fact about time rather than a judgement about people"); the per-person roster row | 🚫 **Five separate refusals — see §5.** The whole-tree tier row, the per-branch tier triples, `.proof` badges on people or teams, the `Unattributed` branch, and the ~190-ellipse radial projection. Most of this screen is refused |

### 1.3 Static mockups retired

Removed 2026-09-08 with owner authorization: the six Canopy HTML design fixtures,
`canopy-crown.js`, fixture-only crown/animation styles and the inline CSP exception.
Their former URLs return 404 with the same strict CSP as the public readers.
`mockups.test.ts` and the fixture-only assertions were removed with their subjects;
real-route header, Host refusal, sprite and publication checks remain.

`canopy-base.css` and `canopy-tokens.css` remain because the real publication manager
and assessment pages use them. The prior freeze instructions for mockups are superseded.

---

## 2. The CSS architecture

### 2.1 The problem, stated exactly

The repo has **one** shared file (`tokens.css`, 61 tokens + 2 classes) and then reinvents the
component layer three times:

| File | Lines | Classes | What it duplicates |
|---|---|---|---|
| `apps/leaf/public/leaf.css` | 927 | 61 | `.leaf-cell` ≡ OD `.cell`; `.leaf-pill` ≡ `.proof`; `.leaf-count` ≡ `.metric b`; `.leaf-cells` ≡ `.cells-3`; `.leaf-note` ≡ `.aside`; `.review-input` ≡ `.field`; `.review-btn` ≡ `.btn` |
| `apps/canopy/public/tree.css` | 324 | 33 | `.tree-count` ≡ `.metric b`; `.tree-fact` ≡ `.cell`; `.tree-person` ≡ `.k-row` |
| `apps/canopy/public/canopy-base.css` | 427 | 83 | `.cell`, `.btn`, `.cells`, `.proof`, `.m`, `.wordmark` — **six OD names bound to different values**; `.lab` ≡ `.fol-label`; `.num` ≡ `.fol-metric` |

And the *face* is implemented twice: `leaf.css:67-100` and `tree.css:28-49` derive **the same
three line weights from the same `color-mix` at the same percentages** in two independent
copies. `tree.css:13-20` says so out loud. That is the drift surface.

### 2.2 The decision — four files in the package, one app file per app

`packages/foliage-tokens` exports **four** CSS files and one sprite. Load order is fixed:

```
1  @foliage/tokens/tokens.css    → served at /tokens.css   (canopy: /foliage-tokens.css)
2  @foliage/tokens/roles.css     → served at /roles.css
3  @foliage/tokens/foliage.css   → served at /foliage.css
4  <the app's own stylesheet>    → /leaf.css | /tree.css | /canopy-base.css
```

| File | Path | Owns | May NOT contain |
|---|---|---|---|
| `tokens.css` | `packages/foliage-tokens/src/tokens.css` | The 71 primitives; the 4 `@font-face`; `.fol-label`; `.fol-metric`; the reduced-motion block; **and the face block** (§3) | Any component. Any layout. Any selector other than `:root`, the face selectors, `.fol-label`, `.fol-metric` |
| `roles.css` | `packages/foliage-tokens/src/roles.css` | The `--fol-role-*` aliases. **Every value is `var(--fol-…)`; no role carries a literal** | Literals. Selectors. Anything that is not an alias |
| `foliage.css` | `packages/foliage-tokens/src/foliage.css` | The component layer: `.cell`/`.cells*`, `.proof`, `.btn`/`.btn-primary`/`.btn-ghost`, `.field`/`.err`/`.fieldset`, `.metric`, `.plate`/`.plate-t`/`.plate-b`/`.sk`, `.bar`, `.ico*`, `.note`, `.aside`, `.lockup`, `.m`, `.states`/`.state` | **Any JavaScript.** Any raw hex. Any layout that belongs to one page. `.day` (the superseded panel) |
| `foliage-sprite.svg` | `packages/foliage-tokens/src/foliage-sprite.svg` | The 8 symbols, byte-identical from OD | A second copy of any symbol |

`packages/foliage-tokens/package.json` `exports` grows to:

```json
"./tokens.css": "./src/tokens.css",
"./roles.css": "./src/roles.css",
"./foliage.css": "./src/foliage.css",
"./foliage-sprite.svg": "./src/foliage-sprite.svg",
"./mark-primary.svg": "./src/mark-primary.svg",
"./mark-expressive.svg": "./src/mark-expressive.svg",
"./mark-icon.svg": "./src/mark-icon.svg",
"./fonts/*": "./src/fonts/*"
```

### 2.3 What an app stylesheet is still allowed to contain

**Allowed:** page chrome (header, skip link, main measure, section rhythm, footer); components
that have **no** system equivalent; the app's own `--leaf-*` / `--tree-*` measure variables.

**Forbidden:** any rule that restates a `foliage.css` component; any raw colour literal (already
enforced for leaf by `dayFaceCss.test.ts:69` — extend it to tree and canopy); any face token
rebinding (that moved to `tokens.css`); any `color-mix` deriving a line weight (that moved to
`roles.css`).

Repo-only components that **stay** because the system has no equivalent — do not try to force
these into OD shapes: `.leaf-legend` (tier legend), `.leaf-reason` (exclusion reason block),
`.leaf-prov` (provenance `<dl>`), `.leaf-band` / `.tree-band` (fabrication band), `.tree-policy`
(the no-score statement), `.tree-failures` (per-entry load failures with named causes),
`.leaf-skip` / `.tree-skip`.

### 2.4 How a duplicate class is retired — the exact procedure

A class in an app stylesheet that duplicates a `foliage.css` component is retired in **one
commit** that does all four steps. A commit doing fewer is a half-migration and is the state
this repo has failed from twice.

1. **Delete the rule** from the app stylesheet.
2. **Change the markup** in the renderer to emit the system class.
3. **Rewrite the test** to assert the invariant, not the class (§6).
4. **Run `pnpm test`.** Green, or revert the whole commit.

Retirement map, binding:

| Retire | Becomes | Owner |
|---|---|---|
| `.leaf-cell` | `.cell` | lane leaf |
| `.leaf-cells` | `.cells-3` | lane leaf |
| `.leaf-pill` | `.proof` + `data-tier` (§2.5) | lane leaf |
| `.leaf-count` | `.metric b` (keep the `fol-metric` class on the span) | lane leaf |
| `.leaf-note`, `.leaf-none` | `.aside` | lane leaf |
| `.review-input` | `.field` | lane leaf |
| `.review-btn` | `.btn` + `.btn-ghost` | lane leaf |
| `.tree-count` | `.metric b` | lane canopy |
| `.tree-fact` | `.cell` | lane canopy |
| `canopy-base` `.cell`/`.cells`/`.btn*`/`.proof*`/`.m`/`.wordmark`/`.lab`/`.num` | the system's | lane canopy — **deferred**, see §1.3 |

**Note the six-name collision.** `canopy-base.css` defines `.btn`, `.cell`, `.cells`, `.proof`,
`.m`, `.wordmark` with **different values** from OD (e.g. `.btn` is `min-height:38px` vs OD's
`44px`; `.wordmark` is 16px mono uppercase vs OD's 50px display serif — completely different
objects). The moment `foliage.css` is loaded on a page that also loads `canopy-base.css`, these
silently fight, and load order decides. **Keep the remaining manager styles separate from
`foliage.css` until their class contracts are reconciled.** `/tree` loads `tree.css`, not `canopy-base.css`, so `/tree` is safe.

### 2.5 The proof-badge naming collision — three spellings of one component

OD says `.proof-verified`. `canopy-base.css` says `.proof--verified`. `leaf.css` says
`.leaf-pill[data-pill-tier="verified"]`. Pick one.

**Decision: `.proof` (the system class) carrying `data-tier="verified|pending|excluded"`.**

Rationale: (a) the class comes from `foliage.css`, so OD's geometry is inherited, not retyped;
(b) `data-tier` is already the repo's real contract — 96 assertions key on `data-tier`,
`data-pill-tier`, `data-count-tier`, `data-legend-tier`; (c) an attribute cannot be
half-applied, whereas `.proof` without its `.proof-verified` partner renders a silently
untinted badge.

Support OD's spelling as a free alias so OD markup pastes in unmodified:

```css
.proof-verified, .proof[data-tier="verified"] { /* … */ }
```

Cost: one selector each. Do **not** support `.proof--verified`; that spelling dies with
`canopy-base.css`.

---

## 3. The face seam — one decision

### 3.1 The decision

**`[data-face="day"]` and `.face-day` in one selector list, on `<html>`, with `night`
explicit — and no `html` type prefix.**

```css
/* packages/foliage-tokens/src/tokens.css */
[data-face="night"], .face-night { color-scheme: dark; }   /* primitives are already night */

[data-face="day"], .face-day {
  color-scheme: light;
  --fol-canvas:         var(--fol-paper);
  --fol-surface:        var(--fol-paper-sunk);
  --fol-surface-raised: var(--fol-paper-raised);
  --fol-hairline:       var(--fol-paper-hairline);
  --fol-border:         var(--fol-paper-border);
  --fol-text:           var(--fol-ink);
  --fol-text-muted:     var(--fol-ink-muted);
  --fol-text-faint:     var(--fol-ink-faint);
  --fol-verified:       var(--fol-verified-day);
  --fol-pending:        var(--fol-pending-day);
  --fol-excluded:       var(--fol-excluded-day);
  --fol-invalid:        var(--fol-invalid-day);
}
[data-face="day"] .fol-label, .face-day .fol-label { color: var(--fol-ink-muted); }
```

Four things are load-bearing here:

**(a) Keep `[data-face]`, not `.face-day`.** It is already the tested contract in six places, it
is server-rendered so it cannot be forgotten, and `<html>` is where `color-scheme` belongs — the
repo already sets it (`leaf.css:71`, `tree.css:32`) and OD does **not**, which means OD's day
face inherits a dark-mode UA scrollbar and silently inverts the plane signal.

**(b) Drop the `html` type prefix.** This is not cosmetic. `html[data-face="day"] .fol-label` is
specificity **(0,2,1)**; `.tree-band .fol-label` is **(0,2,0)**. The higher one wins and paints a
label muted inside a band that intended otherwise — a defect this repo has already shipped.
Dropping `html` makes it **(0,2,0)**, identical to `.face-day .fol-label` and to any
`.some-band .fol-label`, so the three become interchangeable and none silently outranks another.

**(c) Support `.face-day` as an alias.** Eleven characters per rule, and OD prototype markup
pastes in and renders correctly.

**(d) The face block moves INTO `tokens.css`.** Today it lives in `leaf.css` and `tree.css` as
two independent copies of the same derivation. One copy, in the package, is the entire point.

### 3.2 The migration, per lane — no lane touches another lane's file

| Lane | Does |
|---|---|
| **system** | Adds the block above to `tokens.css`. Adds the 11 new tokens it depends on (§4.5) |
| **leaf** | Deletes the `html[data-face="day"]{…}` and `html[data-face="night"]{…}` blocks from `leaf.css`, **keeping only the `--leaf-measure` values**, which are page chrome, not face. Updates `seam.test.ts:468` and `:495`, which pin the literal `html\[data-face="day"\]\s+\.fol-label` |
| **canopy** | Deletes the `html[data-face="day"]{…}` block from `tree.css`, keeping `--tree-measure`. Updates the same literal at `tree.css:56` |

Because the pinned selector literal lives in each lane's own files, this is three independent
edits with no shared file. That is why this seam is safe to change in parallel.

### 3.3 What does NOT change

No theme toggle, ever. No `prefers-color-scheme`. The face is a render-time argument
(`render.ts` `Face` parameter), and `renderTree.ts` hard-codes `day`. Both stay.

---

## 4. Token reconciliation

Every ratio in this section I computed in this run. Nothing here repeats a comment's claim.

### 4.1 The headline result: exactly ONE shared token disagrees

I extracted both declaration sets and diffed all 60 shared names. **`--fol-text-faint` is the
only value disagreement in the entire system.** Everything else is byte-identical.

### 4.2 `--fol-text-faint` — `#7D9184` (repo) vs `#7C8F83` (OD v0.2)

Both comments, verbatim:

> **REPO** (`packages/foliage-tokens/src/tokens.css:59`): *"`.fol-label` renders this at 11px
> (`--fol-t-11`), so it needs 4.5:1, NOT the 3:1 large-text threshold. Measured at 11px on every
> night background it can sit on — the whole set, because checking one is how the two previous
> values passed review: `--fol-canvas` 5.65:1 passes / `--fol-surface` 5.30:1 passes /
> `--fol-surface-raised` 4.80:1 passes. Third value for this token. `#67796E` failed on all
> three (wrong threshold); `#728579` failed only on `--fol-surface-raised` (right threshold, one
> background). A ratio without its background AND its px size is not a result."*

> **OD v0.2** (`css/tokens.css:40`): *"5.52:1 on canvas, 5.18:1 on surface and 4.69:1 on
> surface-raised — the floor. Twice lifted: `#67796E` measured 4.10:1 and failed AA for the 11px
> mono labels that use it; `#6E8175` passed at 4.57:1 but on 0.07 of margin. The Canopy project
> flagged the same defect and went to `#8CA093` / 6.83:1 — but that sits 1.13x from
> `--fol-text-muted` and collapses three text levels into two here. Foliage takes the finding,
> not the value."*

**My computed ratios, at 11px (`--fol-t-11` = .6875rem = 11px), threshold 4.5:**

| Value | canvas `#0B120E` | surface `#101A14` | **raised `#16241C`** | evergreen-900 `#07120C` |
|---|---|---|---|---|
| **REPO `#7D9184`** | **5.65** | **5.30** | **4.80** | **5.68** |
| OD `#7C8F83` | 5.52 | 5.18 | 4.69 | 5.55 |
| `#67796E` (both cite) | 4.10 ✗ | 3.85 ✗ | 3.48 ✗ | 4.12 ✗ |
| `#6E8175` (OD's 2nd) | 4.57 | 4.29 ✗ | 3.88 ✗ | 4.60 |
| `#728579` (repo's 2nd) | 4.83 | 4.53 | 4.10 ✗ | 4.86 |
| `#8CA093` (Canopy's) | 6.83 | 6.41 | 5.80 | 6.87 |

**Both comments are arithmetically correct to two decimals on every value they cite. Neither
file is lying.** They absorbed the same finding (11px mono is normal text → 4.5:1) from two
different lineages and landed on two different passing colours.

**WINNER: the repo's `#7D9184`.** On the merits, not on the tie-break: on the binding ground
(`--fol-surface-raised`, the tightest that ships) it clears by **0.30** against OD's **0.19**.
Constraint 5's default points the same way. **Do not sync OD's value in.**

### 4.3 The stale number that MUST be corrected — six sites, three lanes

Three files claim `--fol-text-faint` *"measures **3.57:1** on paper"*.

**I computed it: 3.57:1 is `#728579` on `--fol-paper` — the SUPERSEDED value.** The current
token `#7D9184` measures **3.05:1** on paper at 11px. The conclusion (day must rebind) is right;
the recorded number is stale by exactly one token revision.

| File | Line | Lane |
|---|---|---|
| `packages/foliage-tokens/src/tokens.css` | 98 | system |
| `apps/leaf/public/leaf.css` | 164 | leaf |
| `apps/leaf/src/seam.test.ts` | 463, 465, 473 | leaf |
| `apps/canopy/public/tree.css` | 54 | canopy |

Each lane fixes its own copies. `3.57` → `3.05`, and add "(`#728579`, the superseded value,
measured 3.57)" so the next agent does not re-litigate it.

### 4.4 Where I overrule OD on measurement — the day ramp

**OD never measured its day ramp on `--fol-paper-raised`, which its own `.face-day` binds.** I
measured it. Four OD day tokens **fail AA at 11px** on the ground OD itself creates:

| OD token | value | paper | paper-sunk | **paper-raised** |
|---|---|---|---|---|
| `--fol-ink-faint` | `#5B6D62` | 5.01 | 4.58 | **4.20 ✗** |
| `--fol-pending-day` | `#5A6D64` | 5.01 | 4.58 | **4.20 ✗** |
| `--fol-excluded-day` | `#746559` | 5.09 | 4.65 | **4.26 ✗** |
| `--fol-invalid-day` | `#8B5E3C` | 5.07 | 4.63 | **4.25 ✗** |

The repo's canopy layer independently derived a day set that does **not** have this hole. I
measured both and the repo's wins on every ground:

| Role | OD value | paper / sunk / raised | **Repo value (`--can-*`)** | paper / sunk / raised | Winner |
|---|---|---|---|---|---|
| day faint (`--fol-ink-faint`) | `#5B6D62` | 5.01 / 4.58 / **4.20 ✗** | **`#55665C`** (`--can-day-label`) | **5.54 / 5.07 / 4.64** | **repo** |
| `--fol-pending-day` | `#5A6D64` | 5.01 / 4.58 / **4.20 ✗** | **`#4F6058`** (`--can-proof-pending-day`) | **6.06 / 5.54 / 5.08** | **repo** |
| `--fol-excluded-day` | `#746559` | 5.09 / 4.65 / **4.26 ✗** | **`#6E5142`** (`--can-proof-excluded-day`) | **6.54 / 5.98 / 5.48** | **repo** |
| `--fol-verified-day` | **`#1A6344`** | **6.55 / 5.99 / 5.49** | `#0E3927` (`--can-proof-verified-day`) | 11.68 / 10.68 / 9.79 | **OD** — see below |
| `--fol-invalid-day` | `#8B5E3C` | 5.07 / 4.63 / **4.25 ✗** | *(none)* | — | **OD, with a constraint** |

**Why OD wins on `verified-day` despite measuring lower.** Contrast against the ground is not
the only requirement — the tier colour must also be distinguishable from **body text**. I
measured that too:

- `#0E3927` vs `--fol-ink` `#0E1F16` = **1.33** — near-indistinguishable from ordinary text.
- `#1A6344` vs `--fol-ink` `#0E1F16` = **2.37** — separated in both lightness and hue.

`#0E3927` (evergreen-700) is the right **fill** for an enclosed glyph, which is the job canopy
uses it for. It is the wrong **text** colour. Take `#1A6344` for text; keep evergreen-700 as the
enclosing hairline on day fills, per `canopy-tokens.css` rule 5.

**`--fol-invalid-day` keeps OD's `#8B5E3C` plus a recorded constraint.** I tried to derive a
darker one (`color-mix(in oklch, --fol-invalid 65%, --fol-ink)` = `#745F25`, 5.60/5.12/4.69,
which passes) but rejected it: it reads olive rather than error-red, and **the only form in this
product is `/review`, which is night**, so the day invalid token is unused today. Inventing a
colour for a surface that does not exist is the wrong trade. **Binding rule instead:
`--fol-invalid-day` may not be placed on `--fol-paper-raised` (4.25:1 at 13px).** If a day form
ever ships, revisit with a measurement.

**Net result: with these values, the four-token paper-raised hole closes to one unused token.**

### 4.5 The 11 tokens lane system adds (10 new + 1 rename) — verified by diff

| Token | Value | Measured, at the size it ships |
|---|---|---|
| `--fol-accent-lift` | `color-mix(in oklch, var(--fol-accent) 84%, var(--fol-text))` | **11.17** on canvas — see §4.6 |
| `--fol-invalid` | `#C1794C` | 5.52 canvas / 5.18 surface / 4.69 raised @13px |
| `--fol-ink-faint` | **`#55665C`** (repo's, not OD's) | 5.54 / 5.07 / 4.64 @11px |
| `--fol-verified-day` | `#1A6344` | 6.55 / 5.99 / 5.49 @11px |
| `--fol-pending-day` | **`#4F6058`** (repo's) | 6.06 / 5.54 / 5.08 @11px |
| `--fol-excluded-day` | **`#6E5142`** (repo's) | 6.54 / 5.98 / 5.48 @11px |
| `--fol-invalid-day` | `#8B5E3C` | 5.07 / 4.63 / **4.25 ✗ raised** @13px — not permitted on raised |
| `--fol-paper-raised` | `#E1E1DA` | ground |
| `--fol-paper-hairline` | `#D6D6CF` | **1.33** on paper — decorative only, never a boundary |
| `--fol-paper-border` | `#BEC1B9` | **1.66** on paper — **decorative only**, see §4.7 |
| `--fol-ease-grow` | `cubic-bezier(.22,.61,.36,1)` | rename of `--fol-ease-unfurl`, identical value |

**The rename is required by constraint 7.** `--fol-ease-unfurl` names the superseded
circinate/unfurling concept. Ship `--fol-ease-grow`. Keep `--fol-ease-unfurl: var(--fol-ease-grow)`
**only** if a reference survives; grep first and delete it in the same slice if not.

### 4.6 `--fol-accent-lift` — OD pins the hex from the WRONG COLOUR SPACE

OD's CSS says `color-mix(in **oklch**, …)`. `IMPLEMENTATION.md`, `brand.json` and
`provenance.md` all pin **`#B2D258`**, describing it as the "**OKLab** mix". I computed both
with a round-trip-validated converter:

| Space | Result | On `--fol-canvas` |
|---|---|---|
| `in oklab` (rectangular) | **`#B2D258`** ← the hex OD pins | 11.07 |
| `in oklch` (polar, shorter hue arc) | **`#A9D55F`** ← **what a browser actually paints** | **11.17** |

Chroma matches; hue does not. A consumer that pins `#B2D258` renders a different colour than the
CSS engine. **Ship the `color-mix(in oklch, …)` form verbatim** — Baseline 2023, zero deps, no
build step. If a non-CSS pin is ever needed, pin **`#A9D55F` (11.17:1)**, never `#B2D258`.

The design rule survives either way: default **10.24** → hover **11.17** → press **8.01**.
Contrast *rises* on hover; `:active` is the one permitted momentary dip.

### 4.7 Borders: OD measures none of them, and both its border tokens fail 1.4.11

Neither project measured non-text contrast. I did:

| Token | Ground | Ratio | Verdict |
|---|---|---|---|
| `--fol-border` `#26402F` | canvas / surface / raised | **1.68 / 1.57 / 1.42** | decorative only |
| `--fol-paper-border` `#BEC1B9` | paper / sunk / raised | **1.66 / 1.51 / 1.39** | decorative only |
| `--fol-hairline` `#1E3227` | canvas | **1.39** | decorative only |
| `--fol-paper-hairline` `#D6D6CF` | paper | **1.33** | decorative only |

OD's `.field` and `.btn-ghost` take `--fol-border` as their **only** boundary — at 1.68:1 that
fails WCAG 1.4.11's 3:1 for a user-interface component. **The repo already solved this**
(`--leaf-rule-strong: var(--fol-text-faint)`), and the fix generalises perfectly:

> **`--fol-role-edge-control: var(--fol-text-faint)`** — night `#7D9184` = **5.65 / 5.30 / 4.80**;
> day `#55665C` = **5.54 / 5.07 / 4.64**. Clears 3:1 on every ground of both faces with one alias.

**Binding rule: `--fol-border` and `--fol-paper-border` enclose decorative cells.
`--fol-role-edge-control` bounds anything interactive — a field, a button, a focusable card.**

I also measured the canopy control tokens and found a defect worth naming: **`--can-night-control`
`#4A6B55` measures 3.18 on canvas but 2.99 on `--fol-surface` and 2.71 on `--fol-surface-raised`**
— its comment claims "3.18:1 — interactive borders" without stating that it only holds on canvas.
A field inside a `.cell` misses 1.4.11. **Do not adopt `--can-night-control`.** Use
`--fol-role-edge-control`.

### 4.8 Two more OD claims I checked

- **OD's `.proof` tinted borders.** `color-mix(in oklch, --fol-accent 45%, --fol-canvas)` =
  `#366233` = **2.67:1**; the excluded one = `#3C3E2F` = **1.74:1**. Not a violation — a status
  badge is not an interactive component — but **the border cannot be the thing that distinguishes
  a tier.** The text colour and the per-tier silhouette carry it. Do not let a future change
  reduce tier signalling to the border.
- **OD's "every night semantic measures 3.0–3.2:1 on paper"** — true for pending (3.03), invalid
  (3.12) and excluded (3.18). **False for the fourth:** `--fol-verified` = the accent =
  **1.68:1**. OD understates its own case; the day set is more necessary than it claims. Quote it
  correctly if you quote it.

### 4.9 The repo's derived day lines are sound — I re-derived them

`leaf.css`/`tree.css` derive three day line weights by `color-mix(in oklch, --fol-ink N%,
--fol-paper)`. My mixer produces hexes a hair different from the comment's (`#BABBB0` vs
`#B2BDB7` at 24%) — expected, since the comment records **pixels read back from a real browser**
and hue interpolation toward a near-achromatic endpoint is implementation-sensitive. **The
ratios agree to ±0.02: 24% = 1.76, 46% = 3.25 (comment says 3.23), 62% = 5.33 (says 5.32).** The
conclusion holds: 46% clears 1.4.11. These derivations move to `roles.css` so there is one copy.

---

## 5. The refuse list

Each row names the OD file and element, and the domain rule that forbids it.

### 5.1 Hard refusals — build-blocking

| # | OD file : element | Refused because |
|---|---|---|
| **R1** | `prototypes/portfolio.html` and `ui_kits/app/canopy-dashboard.html:76` — `<span class="fol-label">Grounded</span><div class=metric><span>Claims</span><b>96.2%</b></div>` | **A score.** A percentage composite of a proof mix over one person's work. Constraint 2; `AGENTS.md:22`; `packages/leaf/src/leaf.ts` `ProofTier` has no ordering and no numeric mapping. It also violates OD's own microcopy rule (`DESIGN.md:477`) |
| **R2** | `prototypes/organization-tree.html` — `Whole tree · counts only`: `Verified 358 / Pending 41 / Excluded 13 / Total 412` | **Cross-person aggregate.** A sum over 14 people. A single figure standing for a group of people is a rating of that group. The `.aside` beside it ("nowhere in this layout that one could be added") is wrong about itself — the four integers *are* the composite |
| **R3** | `prototypes/organization-tree.html` — `Branches · 5` rows, `130 verified, 14 pending, 4 excluded` | **Per-team cross-person aggregate.** A reader diffs Firmware against Platform and has a leaderboard. Structural facts about a team (`4 leaves`) are fine; the tier triple is not |
| **R4** | `organization-tree.html` and `foliage-search.html` — a `.proof` badge in column 1 of a **person** or **team** row | **A tier belongs to a leaflet.** A person is not verified; some of their leaflets are. This is the mechanism by which `ProofTier` becomes a judgement of persons. `Johan Sørlie · leaf` badged `proof-pending` reads as "this person is provisional" |
| **R5** | `organization-tree.html:101,147` + `tools/tree-generator.mjs:42` — the **`Unattributed`** branch and the `Contract team` leaf | **The fourth tier in costume.** Constraint 2 forbids a fourth state outright; the older OD kit spelled it `UNATTRIBUTED`. It is also a bucket of *people* defined by a proof outcome. Unattributable leaflets are `excluded` **on the leaf they belong to**, with a reason |
| **R6** | `organization-tree.html` — the ~190-ellipse radial tree projection | **A whole-org composite figure**, and the most legible score on the page precisely because it is not a number. Distance-from-trunk is a visual comparator across people. The repo's per-leaf frond (one person, their own leaflets) is the safe form |
| **R7** | `canopy-dashboard.html:110` — `Growth this week` + `Sources read — 3 of 4` + `<div class=bar><span style="width:75%">` | **Progress-toward-complete, framed as a person's productivity.** It also contradicts `.bar`'s own rule: *"If nothing is running, do not render a track."* |
| **R8** | `ui_kits/app/published-leaf.html` — the `k-note` *"Only verified leaves are published"* | **Hides excluded work.** Contradicts `public-leaf.html`, which is right: *"Excluded leaflets stay visible. A portfolio that hides what it could not attribute is not evidence."* A genuine contradiction inside OD v0.2 — resolved in favour of the prototype |
| **R9** | `canopy-dashboard.html:72,80`, `index.html:295`, `preview/components-buttons.html:121` — `<span>Commits</span><b>4,904</b>` / `<b>18</b>` | **A COMMITS-count column implying a cross-person aggregate.** Constraint 2 names this explicitly. Counts **by tier** are fine |
| **R10** | Every OD page (11 files) — `<link rel=preconnect href=https://fonts.googleapis.com>` + `fonts.gstatic.com` + the `css2?family=…` stylesheet | **Constraint 4: zero non-loopback origins.** The privacy claim is zero network calls. `default-src 'none'` would block them anyway and they would silently fall back to Georgia — *a different design, delivered quietly*. Strip all three lines from every page |
| **R11** | All six kit pages — `<script src=kit.js defer>` | CSP is `default-src 'none'` with **no `script-src`**. **Do not widen it.** Rebuild filters as server-rendered query params and the dialog as a route or `<details>` |
| **R12** | `prototypes/*` and `ui_kits/*` — every string, name, number and timestamp | **Constraint 1: no fake data, ever.** `Mira Halvorsen`, `Northwind Instruments`, `1,204 commits`, `38 leaflets · 28 verified`, every date. Take layout, tokens, structure, rhythm, type scale. **Take zero strings.** Where the repo has no real data, render the honest empty state (§8) |
| **R13** | any | A **fourth filter tab**, a **fourth counts cell** that is not the total, any ramp, meter, percentage, rank, "top result", relevance score, sort-by-verified, or profile-completeness bar | Constraint 2. `ProofTier` is three, unordered |

### 5.2 Conditional — allowed only under a stated condition

| # | Element | Condition |
|---|---|---|
| **C1** | `.bar` determinate progress | Allowed **only** while a real machine process is in flight, with `aria-valuenow`/`min`/`max` from real counts. **Never** for portfolio completeness. **No `.bar` on `/`, `/leaflet/<id>`, or `/tree`** — nothing is running on a server-rendered document |
| **C2** | Per-source / per-leaflet commit counts | Allowed when real and scoped to **one artifact or one source**. Forbidden the moment the same number becomes a roster column beside other people (that is R9) |
| **C3** | A single tier count in a list row | **Show all three tier counts, or none.** One number per person in a shared column is a rank key whether or not you sort by it |
| **C4** | `backdrop-filter: blur(8px)` on `.im-chip` | Only with the no-support fallback verified (it degrades to a bare `color-mix(… 84%, transparent)` ground, which is still legible) |

### 5.3 Design-layer refusals

| # | Refused | Because |
|---|---|---|
| **D1** | OD's day focus ring `2px solid var(--fol-accent)` | **1.68:1 on paper — fails WCAG 1.4.11's 3:1.** The repo already keeps OD's geometry and moves the colour to `--fol-ink` (15.56:1). **Do not regress this** |
| **D2** | `#B2D258` as `--fol-accent-lift` | Wrong colour space (§4.6). Ship the `color-mix(in oklch, …)`; pin `#A9D55F` if you must pin |
| **D3** | Binding 11px faint or semantic day text to `--fol-paper-raised` | 4.20–4.26:1. Resolved for three tokens by taking the repo's values (§4.4); still binding for `--fol-invalid-day` |
| **D4** | `.day` (the old OD panel) and any theme toggle | *"`.day` was only ever a panel; a published leaf is a whole document on paper."* The face is a property of the surface, not a preference |
| **D5** | `--fol-accent-alt-amber` / `-copper` as a primary accent | *"Autumnal, which is the opposite of what the brand claims."* Note `-copper` and `--fol-invalid` are the **same hex `#C1794C`** — never let a theme reuse collide with the validation colour |
| **D6** | JavaScript in the system layer; `npm run build`; `tools/*.mjs` as a build step; any dependency | **Constraint 3.** Node 22.18+ runs TypeScript directly. Port `roles-check.mjs` as a **test**, never a build. `tokens.css` stays hand-maintained as the single source |
| **D7** | Any spiral or circinate coil in the mark | **Constraint 7.** The mark is the bipinnate compound leaf. The coil may be mentioned **only** in the historical note explaining what was superseded |
| **D8** | Layout in an inline `style` attribute | Inline specificity beats every selector without `!important`, so a media query silently does nothing. **This project shipped that bug twice**, once crushing two control rows to ~60px at 360px |
| **D9** | `<header class=bar>` or any unprefixed page-chrome class | `.bar .cell .note .state .field .plate .cap .stage .aside .day .acc .m .err .metric .proof` are all taken by `foliage.css`. An early prototype used `<header class=bar>` and the 4px progress component rendered the whole header as a track. (`.row` is listed as taken in three OD docs but **does not exist** — the warning is still real) |
| **D10** | Max-width media blocks ordered narrowest-first | At 360px every block matches and the last one wins. **Descend: 1180 → 1020 → 820 → 560** |
| **D11** | A second copy of a sprite symbol in one document | Two copies drift; this project shipped that once. Inline the sprite **once**, reference by id |
| **D12** | An unguarded top-level `localStorage` call | Throws on an opaque origin and takes every listener below it down with the script |
| **D13** | OD's taxonomy — "a Tree is an organization", five levels | `AGENTS.md:32-39`: a `Tree` is a **company**; **Bough** (an organization) sits between Tree and Branch. Six levels. The repo wins |

---

## 6. The test migration plan

**A test that pins a class name is a test that punishes the redesign.** A test that pins a
`data-*` attribute or a computed invariant is a test that protects the domain. The repo's real
contract is its `data-*` vocabulary, and it is excellent — **preserve every one of these
verbatim**:

```
data-leaf-state  data-leaf-empty  data-count      data-ledger      data-tier
data-pill-tier   data-legend-tier data-verbatim   data-visibility  data-body
data-element     data-refusal     data-review-state data-review-count data-review-pill
data-fabricated  data-third-party data-page-kind  data-disabled    data-face
data-tree-state  data-fact        data-count-tier data-roster-row  data-entry-failure
data-policy
```

### 6.1 The rule

| Instead of asserting | Assert |
|---|---|
| `class="leaf-pill" data-pill-tier="verified"` | `[data-tier="verified"]` appears once per verified leaflet, and its count equals `attributionLedger.verified` |
| `<p class="leaf-reason">` | every `[data-tier="excluded"]` row has a non-empty reason in its visible text |
| `<a class="leaf-cell" data-ledger="…" href="#…">` | every `data-ledger` with a non-zero count is a link whose target `id` is rendered; every zero-count one is not a link and carries `aria-disabled="true"` |
| `<span class="fol-metric leaf-count">2` | the element carrying `data-review-count="candidate"` has `fol-metric` among its classes and its text is the derived count |
| a whitespace-exact regex spanning two elements | parse the region, then assert the relationship |

### 6.2 The exact list — 47 class-pinning assertion sites, all in 5 files

**`apps/leaf/src/render.test.ts`** (lane leaf) — 44 tests, 22 class-pinning sites:

| Line | Pins | Rewrite to the invariant |
|---|---|---|
| 192 | `class="leaf-leaflet" data-tier="${tier}"` | count `[data-tier="${tier}"]` on leaflet rows only; equals the ledger, **including zero** |
| 201 | `html.slice(indexOf('class="leaf-work"'), indexOf('class="leaf-ledger"'))` | slice by `data-region="work"` / `data-region="ledger"` — **add these attributes**; assert only verified rows fall inside |
| 342, 347 | `class="leaf-legend"`, `<span class="leaf-pill" data-pill-tier="…">` | the legend contains one badge per tier, in `["verified","pending","excluded"]` order, **and the badge is the same component the rows use** (compare rendered badge markup between legend and row) |
| 398 | `class="leaf-reason"` count | count of excluded rows == count of rendered reasons |
| 633, 645 | `<span class="leaf-pill" data-pill-tier="verified">`, `<p class="leaf-reason">` | the artifact carries its tier as `data-tier`, and an excluded artifact states a reason |
| 653 | `!includes('<dl class="leaf-prov">')` | no provenance table is rendered when provenance is absent — assert via `data-prov="absent"` |
| 679, 1284, 1290 | `<p class="leaf-leaflet-open"…><a href="…">` | keep `data-visibility`; assert the href equals `LEAFLET_ROUTE + encodeURIComponent(id)`, and that a private leaflet renders **no** anchor |
| 746, 749 | `<li class="leaflet-element" data-element="stated">` + `<dl class="leaf-prov">` | every `data-element="stated"` contains its own evidence — **assert the relationship, not the tags** |
| **925, 926** | **whitespace-exact** `data-review-count="candidate"[^>]*>\s*<span class="fol-label">Unreviewed</span>\s*<span class="fol-metric leaf-count">2` | **hardest.** Parse the `data-review-count` element; assert (a) its label text, (b) its numeric text equals the derived count, (c) the numeric element's class list contains `fol-metric`. Never re-pin whitespace |
| 931 | `<form class="review-form"…action="…">` | there is exactly one form per unreviewed candidate and zero per decided one; `method="post"`, `action === REVIEW_ROUTE` |
| 1081 | `<a class="leaf-skip" href="#leaf-main">` | the first focusable element is a skip link whose target `id` exists |
| 1096, 1098 | `<span class="fol-metric leaf-count">`, `<dd class="fol-metric">e3b4489</dd>` | **keep the `fol-metric` half — it is the domain rule** ("a metric not in mono tabular-nums is a defect"). Drop `leaf-count`. Assert: every element whose text is a bare number or a ref carries `fol-metric` |

**Tests in `render.test.ts` that need NO change** — they already assert invariants, and they are
the model: `249` (no score, any state), `279` (a score-word in a real commit survives via
`data-verbatim`), `312`/`425` (tier order and no ordering language), `452` (escaping),
`520`/`1074` (face by surface), `598` (leaflet leaks no compound), `1162`/`1183` (contrast,
computed from the real token file), `1198` (both faces bind the same roles), `1222` (private ≡
missing, byte equality).

**`apps/leaf/src/seam.test.ts`** (lane leaf) — 20 sites, lines 288, 296, 319, 324, 329, 334,
362, 613, 618, 643, 653, 746, 760, 761, 807, 819, 858, 885, 1155, 1166. All are
`class="leaf-…"` inside a regex that also captures the real datum. **Rewrite: keep the capture,
drop the class.** e.g. `<dt class="fol-label">Ref</dt><dd class="fol-metric">([^<]*)<` →
locate the `Ref` term in the provenance list and read its definition. The invariant is *"this
row names its evidence, and the evidence equals the document's"*.
**Lines 456-495** additionally pin `html\[data-face="day"\]\s+\.fol-label` — update for §3.2's
prefix drop, and fix the stale `3.57` at 463/465/473 (§4.3).

**`apps/leaf/src/dayFaceCss.test.ts`** (lane leaf) — 4 sites:

| Line | Rewrite |
|---|---|
| 143, 154, 159 | `<a class="leaf-cell" data-ledger=…>` → key on `data-ledger` + `data-disabled`/`aria-disabled` alone |
| **169** | `<span class="leaf-mark" role="img" aria-label="Foliage"></span>` **exact**, plus `mask: url("/mark-primary.svg")` and `background-color: var(--fol-evergreen-700)` at 171/172. **This is the mark-delivery test and it must be REPLACED, not adapted** — the sprite migration (§7.1) deletes the mask technique. New invariant: *the mark is rendered as an inline `<use>` into a sprite symbol; the symbol id is one of the three tiers; below 20px it is `#fol-mark-sm`; the element carries `role="img"` and `aria-label="Foliage"`; and its colour resolves through a token, not a literal* |
| 43, 69, 83 | **No change — these are already invariants** (every `var()` is defined; zero raw colour literals; no shadows; the accent is confined). **Extend 69 and 83 to `tree.css`** (lane canopy) |

**`apps/canopy/src/seam.test.ts`** (lane canopy) — 2 sites:

| Line | Rewrite |
|---|---|
| 269 | `class="tree-person-name">([^<]*)<` → read names from `[data-roster-row]`'s name slot; assert set equality with the manifest |
| **378** | `<aside class="tree-band" role="alert" data-fabricated="true">` **byte-exact**. **Keep `role="alert"` and `data-fabricated`; drop the class.** The band is a domain guarantee, not a style |

Unchanged and exemplary: `217` (every `POLICY_REGIONS` member appears byte-for-byte; the rest of
the page is clean under the no-score blocklist), `318`, `390`, `419`, `456`.

### 6.3 New tests each lane adds

| Lane | Test | Invariant |
|---|---|---|
| system | `roles.test.ts` (port of `roles-check.mjs`, ~42 lines, `node:fs` only) | every primitive a role references exists in `tokens.css`; **every `--fol-role-*` value starts with `var(`**. CSS fails silently — a role pointing at nothing drops the declaration and the element quietly inherits |
| system | `contrast.test.ts` | every pairing in §4, computed from the real token file at its stated px size. **Extend the existing leaf pattern; do not invent a second one** |
| system | `sprite.test.ts` | the sprite contains exactly 8 symbols with the exact ids; **no symbol id appears twice**; every `fol-mark*` symbol is even-pinnate |
| leaf | `csp.test.ts` | every response carries `frame-ancestors 'none'` |
| canopy | `csp.test.ts` | **every** public reader, static asset and error response carries the strict CSP with `frame-ancestors 'none'` |

---

## 7. The three build briefs

**File ownership is disjoint and absolute.** No path appears in two lanes. Before your first
edit, `stat` every file you own; if any mtime is newer than your run start, **STOP and report
the collision** (constraint 9). See §0.2 — lane leaf is at active risk.

**Cross-lane dependency, and how to handle it without talking.** Lanes leaf and canopy consume
tokens that lane system creates. **Write against the names and values in §4.5 exactly as
specified.** If lane system has not landed when you finish, your surface renders with unresolved
custom properties — that is expected, and integration catches it. **Do NOT define a missing
token locally as a workaround.** A local definition is the duplicate-source-of-truth failure
this document exists to prevent.

**Git, all lanes:** small reviewed commits with explicit paths. Never `git add -A`. Never push,
force-push, rebase, checkout, reset, stash, or clean. Never commit `*.leaf.json`, `*.tree.json`,
`*.harvest.json`.

**Honesty, all lanes:** label every claim verified-working / built-but-unverified / broken /
unknown. Report our cause **and** the underlying tool's message on any failure; never discard
stderr.

---

### 7.1 LANE SYSTEM — `packages/foliage-tokens/**` only

**Owns exactly:**
```
packages/foliage-tokens/package.json
packages/foliage-tokens/src/tokens.css
packages/foliage-tokens/src/roles.css              (new)
packages/foliage-tokens/src/foliage.css            (new)
packages/foliage-tokens/src/foliage-sprite.svg     (new)
packages/foliage-tokens/src/mark-primary.svg       (replace)
packages/foliage-tokens/src/mark-expressive.svg    (replace)
packages/foliage-tokens/src/mark-icon.svg          (new)
packages/foliage-tokens/src/*.test.ts              (new)
packages/foliage-tokens/src/fonts/**               (do not touch — already correct)
```

**Work:**

1. **`tokens.css`** — add the 11 tokens in §4.5 with **my measured ratios and the px size** in
   each comment. Fix the stale `3.57` → `3.05` at line 98. Rewrite the mark paragraph
   (lines 11-13) from circinate vernation to the **bipinnate compound leaf**, keeping one
   historical note naming what was superseded — this is the **only** place a coil may be
   mentioned (constraint 7). Add the face block from §3.1. Rename `--fol-ease-unfurl` →
   `--fol-ease-grow` (grep for references first).
2. **`roles.css`** — the `--fol-role-*` aliases, every value `var(…)`, no literals. Must include
   `--fol-role-edge` (decorative, `--fol-border`) and **`--fol-role-edge-control`
   (`--fol-text-faint`, ≥3:1 on every ground of both faces — §4.7)**. Fold in the three derived
   day line weights so `leaf.css` and `tree.css` stop deriving them twice.
3. **`foliage.css`** — the component layer per §2.2. Take OD's geometry verbatim, including the
   `.is-hover`/`.is-focus` mirrors (a documented state styled separately from the real state is
   a lie waiting to happen) and `a.btn { text-decoration: none }` from `kit.css:31`. Support both
   `.proof-verified` and `.proof[data-tier="verified"]` (§2.5). **No JavaScript. No literals.**
4. **The mark** — replace both SVGs with OD's bipinnate artwork, add `mark-icon.svg`, add the
   8-symbol sprite. Never hand-edit path data.
5. **`package.json`** — the export map in §2.2. **No dependency. No build script.**
6. **Tests** — the three in §6.3.

**Done when:**
- `pnpm test` green from a 581 baseline, with the new tests included.
- `roles.test.ts` proves no role carries a literal and every referenced primitive exists.
- `contrast.test.ts` re-derives every ratio in §4 from the file itself.
- Exactly **71** `--fol-*` tokens; `--fol-ease-unfurl` gone or an alias with a live referrer.
- Zero occurrences of `circinate` outside the single historical note.
- `grep -c 'googleapis\|gstatic'` over everything you own returns **0**.
- **You have not edited a single file under `apps/`.**

**Explicitly NOT yours:** every `apps/**` file; `AGENTS.md:64` (the circinate line — flag it,
do not edit it).

---

### 7.2 LANE LEAF — `apps/leaf/**` only

**Owns exactly:**
```
apps/leaf/server.mjs
apps/leaf/public/leaf.css
apps/leaf/src/render.ts            ← COLLISION RISK, see §0.2
apps/leaf/src/render.test.ts       ← COLLISION RISK
apps/leaf/src/seam.test.ts         ← COLLISION RISK
apps/leaf/src/dayFaceCss.test.ts
apps/leaf/src/dayFace.ts, dayFace.test.ts
apps/leaf/package.json
```

**Do this first.** `stat` the four collision-risk files. If any mtime is newer than your run
start, **STOP and report** — do not proceed on that file. Note there is an unlanded `share`
feature (`apps/leaf/src/share.ts`, `share.test.ts`, `share.mjs`) that this contract does not
cover; if it is still uncommitted, report it and leave it alone.

**Work:**

1. **Serve the new package files** — add `/roles.css`, `/foliage.css`, `/foliage-sprite.svg`
   routes resolving through `import.meta.resolve` exactly as `/tokens.css` already does. Link
   them in `page()` in the fixed order (§2.2).
2. **CSP — `frame-ancestors 'none'`** in `csp()` at `server.mjs:151`. It does **not** inherit
   from `default-src`; every leaf page is framable today. If the sprite is served as a separate
   file rather than inlined, justify any `img-src` change **inline**; prefer inlining the sprite
   once per document immediately after `<body>` (external `<use href="sprite.svg#id">` fails
   under `file://` and cross-origin).
3. **Face** — delete the two face blocks from `leaf.css`, keeping only `--leaf-measure`. Update
   the pinned selector at `seam.test.ts:468`/`:495` for §3.2. Fix `3.57` → `3.05` at
   `leaf.css:164` and `seam.test.ts:463/465/473`.
4. **Retire the duplicates** per §2.4's map, one commit each, all four steps every time.
5. **The mark** — switch from the CSS-mask technique to an inline sprite `<use>`, and **replace**
   `dayFaceCss.test.ts:169-172` with the new invariant (§6.2). Below 20px use `#fol-mark-sm`.
6. **Empty states** — implement every leaf row in §8 as a real `.plate`.
7. **Rewrite the 46 class-pinning assertions** in `render.test.ts`, `seam.test.ts`,
   `dayFaceCss.test.ts` per §6.2. **Preserve every `data-*` attribute.** Add `data-region="work"`
   and `data-region="ledger"` so tests can slice without keying on classes.

**Faces are fixed and are NOT yours to change:** `/` day, `/leaflet/<id>` day, `/review` night
(§1.0).

**Done when:**
- `pnpm test` green, with the rewritten tests, from a 581 baseline.
- `curl -sI localhost:4174/` shows `frame-ancestors 'none'`.
- **You booted the server and loaded `/`, `/leaflet/<id>` and `/review` in a real browser,
  full-page, scrolled, at 360px and 1440px**, and read the screenshots. No visual claim without
  this.
- Every empty state in §8 reachable and rendering its real sentence.
- `grep -c 'googleapis\|gstatic'` over `apps/leaf/**` returns **0**.
- **You have not edited a single file under `apps/canopy/` or `packages/`.**

---

### 7.3 LANE CANOPY — `apps/canopy/**` only

**Owns exactly:**
```
apps/canopy/server.mjs
apps/canopy/public/tree.css
apps/canopy/public/canopy-tokens.css
apps/canopy/public/canopy-base.css        (used by manager/assessment)
apps/canopy/src/renderTree.ts
apps/canopy/src/seam.test.ts
apps/canopy/package.json
```

**Work:**

1. **Preserve strict CSP on every public response**, including assets and errors, with
   `frame-ancestors 'none'`. `csp.test.ts` checks each response class and the retired URLs.
2. **Serve the new package files** — `/roles.css`, `/foliage.css`, `/foliage-sprite.svg`.
   **Load `foliage.css` on `/tree` ONLY.** Do **not** load it on any page that loads
   `canopy-base.css` — six class names collide with different values (§2.4) and load order would
   silently decide the winner.
3. **Face** — delete the face block from `tree.css`, keeping `--tree-measure`. Update the pinned
   selector at `tree.css:56` for §3.2. Fix `3.57` → `3.05` at `tree.css:54`.
4. **`/tree` rebuild** per §1.2, honouring **all five** organization-tree refusals (R2–R6). The
   existing `NO_SCORE_POLICY` / `ROSTER_ORDER_POLICY` / `POLICY_REGIONS` machinery is **correct
   and stays** — it is the best expression of constraint 2 in the repo. Extend it, do not replace
   it.
5. **Promote the day proof values.** `canopy-tokens.css`'s `--can-proof-pending-day` `#4F6058`,
   `--can-proof-excluded-day` `#6E5142` and `--can-day-label` `#55665C` are the values lane
   system is putting into `@foliage/tokens` (§4.4). Once they land, **alias the `--can-*` names
   to the `--fol-*` ones rather than restating the hexes** — that is the "design system copy goes
   stale" trap, and this file currently holds a third independent narrative about
   `--fol-text-faint` (it is, unusually, **accurate** — I checked every figure — but it is still
   a third copy).
6. **Do NOT adopt `--can-night-control`** as an interactive boundary; it measures 2.99 on
   `--fol-surface` (§4.7). Use `--fol-role-edge-control`.
7. **Taxonomy** — anything saying a Tree is an organization is wrong; a Tree is a **company**,
   and **Bough** sits between Tree and Branch (R/D13).
8. **Mockups** — removed; see §1.3. Do not restore fabricated pages.
9. **Rewrite the 2 class-pinning assertions** in `seam.test.ts` (§6.2); extend `dayFaceCss`-style
   literal-and-shadow bans to `tree.css`.

**Done when:**
- `pnpm test` green from a 581 baseline.
- `curl -sI` on `/tree`, on a retired address, **and on a static asset** each shows the full CSP with
  `frame-ancestors 'none'`.
- **You booted the server and loaded `/tree` in a real browser**, full-page, scrolled, at 360px
  and 1440px, with a real manifest **and** with an absent one, and read the screenshots.
- `withoutPolicyRegions(body)` is clean under the no-score blocklist, and every `POLICY_REGIONS`
  member appears byte-for-byte.
- `grep -c 'googleapis\|gstatic'` over `apps/canopy/**` returns **0**.
- **You have not edited a single file under `apps/leaf/` or `packages/`.**

---

### 7.4 Owned by no lane — orchestrator follow-ups

| File | Why it is unassigned |
|---|---|
| `AGENTS.md:64` — *"The mark is **circinate vernation**"* | Outside all three lane roots. Must change with the mark (constraint 7) |
| `AGENTS.md:72` — *"Motion never bounces (`--fol-ease-unfurl`)"* | Same; follows the rename |
| `.loop/STATUS.md` | Loop state, not lane state |
| `docs/DESIGN-SYSTEM-ADOPTION.md` | This file |

---

## 8. The honest empty states

Every region where OD shows fictional content, and the **actual sentence** the real surface
shows when the document has nothing. Voice rules: sentence case; plain declaratives; no
exclamation marks; no emoji; the five nouns (leaflet, leaf, branch, tree, canopy) and the one
verb (photosynthesis). **Name the object, state what actually happened, and say what was NOT
claimed.**

Every one of these is a `.plate` — glyph (optional) → `.plate-t` title → `.plate-b` one sentence
→ at most one ghost action.

### 8.1 apps/leaf — `/`

| Region | OD's fiction | The real sentence |
|---|---|---|
| Leaf with no leaflets | `Leaves · 6` + six rows | **Title:** `This leaf has no leaflets yet.` **Body:** `Photosynthesis reads a repository you already have and grows a leaflet for each piece of work it can attribute. Nothing has been read yet, so nothing is claimed here.` |
| Counts strip, all zero | `41 / 6 / 3 / 50` | Render **all four cells with 0** — a zero in a tinted cell is the correct result and must not be hidden. Below them: `No leaflet has been attributed, held, or excluded yet, because no source has been read.` |
| A tier with zero members | never shown | The cell reads `0`, is **not** a link, and carries `aria-disabled="true"`. Body: `No leaflet is in this state.` |
| Verified is zero but others are not | never shown | `Nothing on this leaf is verified yet. That is a correct result, not a fault — verification requires evidence that has not been read.` |
| Document absent | never shown | **Title:** `No leaf document at that path.` **Body:** `Foliage looked for the document named by FOLIAGE_LEAF and found nothing there. Nothing was counted, and nothing was guessed.` |
| Document unreadable | never shown | **Title:** `Could not read the leaf document.` **Body:** `The file exists but could not be opened — <errno from the OS, verbatim>. Nothing was counted, and nothing was guessed.` **Both causes, always** (constraint 10) |
| Not configured | never shown | **Title:** `No leaf is configured.` **Body:** `Set FOLIAGE_LEAF to the path of a leaf document. Until then this page has nothing to show and claims nothing.` |

### 8.2 apps/leaf — `/leaflet/<id>`

| Region | OD's fiction | The real sentence |
|---|---|---|
| No provenance | `12 commits · released by Northwind` | Render **no** provenance table at all. In its place: `This leaflet carries no provenance. Nothing here traces to a commit, so nothing here is claimed as evidence.` |
| No body | body elements | `data-body="absent"` + `This leaflet states no claim. It records that the work exists and where it came from, and nothing further.` |
| An unreadable body element | never shown | `No claim is stated. This element could not be read, so it is shown as present and unread rather than summarised.` |
| Not shareable / not found | never shown | **Title:** `No shareable leaflet with that id.` **Body:** `Either no leaflet has that id, or the one that does is private. This page cannot tell you which, because saying so would leak the existence of a private leaflet.` **(The existing byte-equality test between private and missing is the guarantee — keep it.)** |
| Excluded leaflet | `no authorship signature` | The **real** reason string from the document, verbatim, never paraphrased, plus: `Excluded means this work was read and could not be attributed to this subject. It is not an error, and it is not hidden.` |

### 8.3 apps/leaf — `/review`

| Region | OD's fiction | The real sentence |
|---|---|---|
| Empty queue | 6 fictional candidates | **Title:** `Nothing is waiting for review.` **Body:** `Every candidate photosynthesis drafted has been decided. Run a harvest to draft more.` |
| No harvest document | never shown | **Title:** `No harvest document.` **Body:** `Run photosynthesis to draft candidates. Until it has, there is nothing to review and no queue to show.` |
| Harvest unreadable | never shown | **Title:** `Could not read the harvest document.` **Body:** `<our cause> — <the underlying tool's message, verbatim>. No candidate was read, so none was approved or rejected.` |
| A source returned an error | `403` in the numeric column | **Out of the numeric column, as prose:** `<source> returned <status>. The source was never read, so nothing was claimed about it — it is unread, not excluded.` **This sentence is the most important in the system: it establishes `unread` as a third machine outcome that is deliberately NOT a proof tier.** |
| Approve does not publish | — | `Approving records a decision. It does not publish this leaflet and it does not verify it — verification requires evidence, and a decision is not evidence.` |

### 8.4 apps/canopy — `/tree`

| Region | OD's fiction | The real sentence |
|---|---|---|
| Tree with no leaves | 14 named people | **Title:** `No leaf is on this tree yet.` **Body:** `A tree is assembled from leaf documents its manifest names. This manifest names none, so there is no roster and no count.` |
| Manifest names leaves that failed to load | never shown | **Keep the repo's existing `data-tree-state="partial"` — it is better than anything OD has.** Both counts at equal size, and **each failure named by its own cause**: `No document at that path` / `Could not be read` / `Not valid JSON` / `Not a leaf document` / `Duplicate leaf id`. Plus: `<n> of <m> leaves could not be read. The roster below is incomplete, and the counts describe only the leaves that loaded.` |
| Whole-tree tier counts | `358 / 41 / 13 / 412` | **Refused entirely (R2).** In its place, the existing `NO_SCORE_POLICY`: `Each person's counts appear on their own row and are never added together into a total for this company.` |
| Roster ordering | `sorted by last growth` | The existing `ROSTER_ORDER_POLICY`: `Listed in the order the manifest names them. They are not ordered by any measure of their evidence.` |
| Not configured | never shown | **Title:** `No tree is configured.` **Body:** `Set FOLIAGE_TREE to the path of a tree manifest. Until then this page has nothing to show and claims nothing.` |

### 8.5 The three sentences that do the most work

Lift these patterns, not their nouns:

1. **`Nothing was counted, and nothing was guessed.`** — the error-plate posture in six words.
2. **`The source was never read, so nothing was claimed about it — it is unread, not excluded.`**
   — where an I/O failure goes when it is not a proof tier.
3. **`38 leaflets · 28 verified · 7 pending · 3 excluded`** — the count shape. **Never
   `96% complete`.**

---

## 9. Integration checklist — run after all three lanes land

1. `pnpm check` (boundary gate → typecheck → tests). Green, from a **581** baseline.
2. Boot both servers. Load all four real routes in a real browser, full-page, scrolled, at
   **360px and 1440px**, and **read** the screenshots.
3. `curl -sI` every route on both servers; confirm `frame-ancestors 'none'` on **all** of them.
4. `grep -rn 'googleapis\|gstatic' apps packages` → **0 hits**.
5. `grep -rn 'circinate' apps packages` → hits only in the single historical note.
6. Confirm no `--fol-*` token is **defined** outside the package:
   ```bash
   grep -rnE '^[[:space:]]*--fol-[a-z0-9-]+[[:space:]]*:' apps packages \
     | grep -v node_modules | grep -v foliage-tokens
   ```
   → **0 hits.** (Verified 0 today. Anchor the pattern to the start of the line — an unanchored
   `--fol-…:` matches token names quoted inside comments and returns 3 false positives.)
7. Confirm every day surface renders the day face and `/review` renders night.
8. Confirm no surface renders a fourth tier, a percentage, a meter, a rank, or a COMMITS column.
