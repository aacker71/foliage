# DEMO SCRIPT — the whole thesis, URL by URL

The claim Foliage makes: **a source is read, work is attributed, a human approves it, it
appears on the portfolio, and the published document shows only what was proven.**

This script walks that claim through the real running product. Every step below was executed
on 2026-08-19 against the two servers described in §0, and **re-verified end to end later the
same day** on a fresh pair of servers (ports verified free before binding; listener PIDs matched
the spawn PIDs) after the design-fix commits `2384ea1`, `357276d`, `3c13788`, `a2a4b62`,
`1d83f07` landed. Each step carries an honest status:

| status | meaning |
|---|---|
| **WORKS** | executed just now; the stated result is what actually happened |
| **WORKS, NO CLICK-PATH** | the state change is real, but the reader must type a URL — no link exists |
| **NOT BUILT** | the step is part of the thesis and does not exist yet |

Nothing here is seeded. The evidence is **this repository's own git history**, read through the
shipped intake path. If you re-run it on a different repo you get different numbers, and the
numbers below will not match — that is the point.

**SUPERSEDED for what actually gets filmed now.** This script predates the owner's 5-beat
demo-rebuild structure — title card, Beats 2-5, end card — which is the spec of record instead.
Its in-repo artifact is `.loop/demo/CAPTIONS.md` — the owner-approved caption sheet for all five
beats. The URL-by-URL walk below is a dated, real dry run (2026-08-19) and stands as an honest
record of what ran that day — EXCEPT §5 and Known Gap #3, both now stale rather than honest:
promotion has since gained a browser path (the `/promote` panel `take.sh`'s Beat 2 and
`.loop/demo/takes/TAKES.md` describe), so "Promotion is CLI-only... no button" no longer holds.
See `TAKES.md` for the current Beat 2-5 mechanics, that panel included.

---

## 0 · Set the stage (real data, no fixtures)

```bash
cd ~/conductor/workspaces/foliage/caracas
mkdir -p /tmp/foliage-demo

# READ A SOURCE. Real commits, real identity, no hand-written JSON.
node apps/leaf/intake.mjs \
  --repo ~/conductor/workspaces/foliage/caracas \
  --subject "Alex A" \
  --identity "126364027+aacker71@users.noreply.github.com" \
  --out /tmp/foliage-demo/leaf.json

# DRAFT CANDIDATES for review from the same source.
node apps/leaf/harvest.mjs propose \
  --repo ~/conductor/workspaces/foliage/caracas \
  --identity "126364027+aacker71@users.noreply.github.com" \
  --out /tmp/foliage-demo/harvest.json

# A tree manifest naming that one real leaf.
cat > /tmp/foliage-demo/tree.json <<'JSON'
{ "id": "foliage", "company": "Foliage", "leaves": ["leaf.json"] }
JSON

FOLIAGE_LEAF=/tmp/foliage-demo/leaf.json \
FOLIAGE_HARVEST=/tmp/foliage-demo/harvest.json \
PORT=4190 node apps/leaf/server.mjs &

FOLIAGE_TREE=/tmp/foliage-demo/tree.json PORT=4191 node apps/canopy/server.mjs &
```

**Status: WORKS.** Intake printed `read 47 non-merge commit(s)` then
`verified 0  pending 47  excluded 0`. It also refused to lie about signatures:

```
intake: 1 commit(s) CARRY A SIGNATURE THIS MACHINE DID NOT CHECK
intake:   PGP — git invokes "gpg", which cannot be executed here.
intake: a signature nobody checked promotes nothing, and proves nothing against either.
```

That is the product's core discipline visible in the first command: **0 verified is the
honest result for unsigned history**, and the reason it is 0 is named, with the remedy.

---

## 1 · A source is read → `http://127.0.0.1:4191/tree`

The company view. One tree, the leaves its manifest names.

**Status: WORKS.** Renders the day face on cream, real counts read from the real leaf
document, and states its refusals on the page rather than in a comment:

> **NO COMPANY-WIDE FIGURE IS SHOWN** — Each person's counts appear on their own row and are
> never added together into a total for this company. A single figure standing for a group of
> people is a rating of those people, and this product does not produce one — the aggregation
> layer refuses to compute it rather than merely declining to display it.

The roster row shows `Alex A`, the document path, and `Verified 0 · Pending 48 · Excluded 0`.
There is no ordering control, no total, no proof-mix bar, and no commits column.

**Empty and example states, both real:**
- Point `FOLIAGE_TREE` at a manifest with `"leaves": []` → *"No leaf is on this tree yet…"*,
  with both facts rendering `0` rather than hidden.
- Add `"example": true` → a `role="alert" data-fabricated="true"` band appears above
  everything: *"Example tree — not a real company … Signal: the tree manifest declares
  `"example": true`."* The page names the signal that triggered the band.

---

## 2 · Cross from the company to the person

**Status: NOT BUILT.** `/tree` contains exactly one anchor, the skip link (`#tree-main`).
There is **no link from a roster row to that person's leaf**, so the reader must type the
leaf URL by hand.

This is honest rather than lazy: a tree manifest names a **file path**
(`/tmp/foliage-demo/leaf.json`), not an HTTP origin, and the leaf is served by a *different
app* on a different port. Canopy cannot know that URL, and synthesising one would be
inventing a fact the data does not carry. Closing it is a schema decision — a manifest entry
would need an optional published URL — not a styling fix. **See "Known gaps" below.**

---

## 3 · Work is attributed → `http://127.0.0.1:4190/`

The portfolio. The document an employer reads.

**Status: WORKS.** Day face. The mark is the bipinnate compound leaf at icon tier. Then the
thesis, stated by the page itself:

- **Selected work** → the honest empty state, because nothing is verified:
  > **Nothing on this leaf is verified yet.** That is a correct result, not a fault —
  > verification requires evidence that has not been read. Nothing is claimed on this page.

- **Attribution** → four cells: `VERIFIED 0`, `PENDING 48`, `EXCLUDED 0`, `LEAFLETS 48`.
  The two zero cells are drawn with a dashed border and carry no interactive states. The
  three tiers are then defined in prose, and there are exactly three — there is no fourth
  state anywhere on the page.

This is the whole product in one screen: **48 pieces of real work, and zero claims.** The
page does not round up.

**Point at one more thing, because it is the subtlest honesty rule on the page.** Of the 48
leaflet titles, **47 carry `data-verbatim="title"`** and **1 carries
`data-authored="drafted-title"`** — the promoted `canopy: 4 commits`, whose provenance is
`photosynthesis:git-cluster`. A title is only attested as the artifact's own words when the
artifact actually supplied them; a machine's sentence is marked as a machine's sentence. That
distinction is load-bearing twice: the no-score test strips every `data-verbatim` region before
scanning, so anything wrongly marked verbatim would also be **exempt from the score check**.

---

## 4 · A human approves it → `http://127.0.0.1:4190/review`

The harvest queue — machine drafts waiting on a person.

**Status: WORKS.** Night face, because this is a private product surface, not a published
document. Five candidates clustered from real commits — and **all five titles carry
`data-authored="drafted-title"`, none carries `data-verbatim`**, because a review queue is
machine drafts by construction and no person has stood behind a word of it yet. The page opens
by refusing to overclaim on its own behalf:

> Each of these is a **draft** — a machine's suggestion, drawn from real material on this
> machine. None of it is evidence of anything until a person says so, and approving one does
> not publish it or verify it: a promoted candidate becomes a **pending** leaflet, because
> drafted-and-reviewed is attributable and never cryptographically established.

Type a reviewer name and press **Approve** on `canopy: 4 commits`. The card becomes
`APPROVED` and records `approved by Alex A at 2026-08-19T08:39:31.073Z`. The counts strip
moves to `UNREVIEWED 4 · APPROVED 1 · REJECTED 0`.

**The gate is real, and it was tested in three directions:**

| attempt | result |
|---|---|
| cross-site POST (`Origin: https://evil.example`) | `403` — *"refused: this POST came from evil.example and this server is 127.0.0.1:4190."* |
| POST with no `Origin` at all | `403` — names both causes, and tells a non-browser client the exact header to send |
| **Reject** with an empty reason | `400`, `data-refusal="missing-reason"` — *"A rejection with no reason is a silent disappearance."* |

After all three refusals the harvest file was **byte-identical** (sha256 `371e1398a0303a74`
before and after). Nothing was written by a request that was refused.

---

## 5 · It appears on the portfolio

```bash
# --doc is REQUIRED here (F-025, guarded in .loop/FINDINGS.md) — promote now refuses by name
# if it is omitted, rather than silently reading the DEFAULT harvest path instead of the one
# this demo has been reviewing.
node apps/leaf/harvest.mjs promote \
  --into /tmp/foliage-demo/leaf.json \
  --doc  /tmp/foliage-demo/harvest.json \
  --force
```

**Status: WORKS, NO CLICK-PATH.** The CLI is the only way to promote — `/review` records the
decision but does not itself promote, so the demo leaves the browser here.

```
harvest: promoted 1  skipped-not-approved 4  refused-duplicate 0  refused-contradicted 0
harvest:   skipped git-cluster:cleanup — still "candidate" — unreviewed. Only approved
           candidates promote; a draft nobody has looked at must not become a portfolio entry.
```

Reload `http://127.0.0.1:4190/` — **no restart needed**, both documents are re-read on every
request. The leaf now holds 48 leaflets and the new row reads:

```
Pending · canopy: 4 commits
Source  photosynthesis:git-cluster
Ref     f48d7121e01e98810c21147b5afaa9690beee0c2
```

Two things to point at:
1. The tier is **Pending**, not Verified. A human approving a draft does not make it
   cryptographically proven. The product refuses to conflate the two.
2. The provenance says `photosynthesis:git-cluster` — the page names the *extractor* that
   drafted it, not just "git". You can always tell machine-drafted work from read work.

Reload `http://127.0.0.1:4191/tree` and the roster moves to `Pending 48` too, from the same
file, with no restart. **That is the seam between the two apps, working.**

---

## 6 · The published document shows only what was proven

Sharing is opt-in **per leaflet**, and the subject makes that decision on their own document.
Until they do, every leaflet is private. Share exactly one:

```bash
# The subject marks ONE real leaflet shareable by link. Nothing else becomes reachable.
node -e '
  const fs = require("fs"), p = "/tmp/foliage-demo/leaf.json";
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.leaflets[0].visibility = "unlisted";
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  console.log("shareable: /leaflet/" + encodeURIComponent(d.leaflets[0].id));
'
```

Now open it:
`http://127.0.0.1:4190/leaflet/git%3A3d5d02a0e8fd2cb7892cf6dd7a6f9e0ba23bcc67`

**Status: WORKS.** Day face, standalone, and it does **not** disclose the rest of the leaf —
one anchor, the skip link.

**Look at the browser tab, not just the page.** It reads
`Foliage — pending leaflet 3d5d02a0e8fd` — the tier and a short ref, in Foliage's own voice.
It used to be the raw commit subject, which put a third party's words (and, on a real
multi-author repo, their **email address**) into the tab, the history, the bookmark and every
link preview — outside the one region the page marks as carried-verbatim. Fixed in `a2a4b62`;
**zero `@` characters appear in the `<title>` of any of the four real surfaces.**

Run the two steps in the other order and the point lands harder: **before** that command, the
exact same URL answers **404**, with the discretion written into the copy:

> A leaflet that does not exist and a leaflet that exists but has not been shared are answered
> the same way here, deliberately. Telling them apart would let anyone holding one link
> discover the rest of somebody's portfolio by trying ids until the wording changed.

On the leaf itself every unshared row says so in place: *"Private — Not shared by link. This
leaflet has its own address and this leaf will not hand it out."*

---

## What a reader can verify about the pages themselves

Measured on the served bytes and in a real browser (BrowserOS neo), not from source:

- **Zero non-loopback origins — measured, not grepped.** Read from the browser's own resource
  timeline (`performance.getEntriesByType('resource')`) on all three real surfaces at two
  widths: **6 of 6 report `externalReqs: 0`**. `/` loads 9 resources, all from its own origin.
  All four fonts are self-hosted woff2 and report `status: "loaded"`. The only external string
  anywhere in the served bytes is `http://www.w3.org/2000/svg`, a namespace URI that is never
  dereferenced. Stripping CSS comments, the **only** live `url()` in the entire system is the
  four woff2.
- **A CSP on every response, including 404s and static assets**, always with an explicit
  `frame-ancestors 'none'` — it does not inherit from `default-src`. Spot-checked across 13
  routes on both servers; all 13 carry it.
- **Zero score-shaped figures on any real surface**: on `/`, `/leaflet/<id>`, `/review` and
  `/tree` alike — `<meter>` 0, `<progress>` 0, `NN%` 0, fourth-tier word 0. Exactly three proof
  tiers.
- **One design system, two apps.** `tokens.css`, `roles.css`, `foliage.css`, all three marks
  and the fonts are **byte-identical** across both servers (sha256-compared), because both
  resolve them through `@foliage/tokens`' export map instead of keeping a copy.
- **Zero unresolved custom properties.** 110 `--fol-*`/`--tree-*` names are declared and every
  one resolves — checked in a real browser, which matters because an unresolved `var()` drops
  the declaration **silently** and the element just inherits.
- **The mark is the bipinnate compound leaf, proven geometrically.** The rendered
  `#fol-mark-sm` symbol is 2 paths / 7 sub-paths: **three mirror-symmetric pairs** of solid
  leaflets tapering upward (bounding-box widths 29.4 → 22.5 → 12.2) plus one rachis stroke, and
  **zero elliptical-arc commands** in any of the three mark tiers. No spiral, no coil. It paints
  `#0E1F16` on `#F6F4ED` = **15.56:1** on day and `#E9F0EA` on `#0B120E` = **16.36:1** on night.
- **360 and 1440: zero overflowing elements on all three surfaces.** This is a genuine
  re-layout via CDP `Emulation.setDeviceMetricsOverride`, with the viewport **read back** each
  time — `innerWidth` 360, `matchMedia('(max-width:390px)').matches === true`,
  `scrollWidth - clientWidth === 0`. **1920 was NOT measured**; an earlier draft of this script
  claimed 360/1440/1920 with no viewport read-back at all, and a scaled screenshot is not a
  narrow-viewport measurement.

---

## Known gaps — say these out loud during the demo

1. **No link from `/tree` to a person's leaf** (§2). The cross-app hop is manual. Needs a
   manifest schema decision, not a styling fix.
2. **No link from `/review` back to `/`.** After approving, the reviewer cannot navigate to
   the portfolio; `/review` has only a skip link.
3. **Promotion is CLI-only** (§5). There is no button that turns an approved candidate into a
   leaflet, so the demo leaves the browser mid-thesis.
4. **The 49-word privacy paragraph repeats on all 47 unshared rows.** Counted this run: 48
   `leaf-leaflet-open` blocks, 47 of them the private notice, 49 words each. The portfolio is
   **15,709px** tall at 1440 and **21,661px** at 360. A real legibility problem; the fix is a
   product-copy decision (one sentence per row, full rule once per section). *(An earlier draft
   said "40-word" and "15,757px" — both were slightly off; these are measured.)*
5. **Nothing is verified, on purpose.** This machine has no `gpg`, so signatures cannot be
   checked. To demo a *verified* leaflet you need a repo with signed commits and a working
   verifier — do not fake one to make the screen look better.
6. **`.btn-ghost` hover and pressed are invisible on `/review`.** Measured live: the hover
   ground and the page ground are the identical colour, `rgb(11, 18, 14)` — **contrast ratio
   1.000**. The buttons are perfectly legible at rest and the focus ring is fine, but pointing
   at one and saying "watch it respond" will not land. The fix is in `packages/foliage-tokens`
   and is written out in `docs/DESIGN-DRIFT.md` §2.6.
7. **A commit subject can still publish a third party's email address in the page body.** The
   browser-tab half is fixed; `titleOf()` in `packages/leaf/src/intake.ts` still returns the
   subject unfiltered into `<h1 data-verbatim="title">`. **Do not demo this product against a
   multi-author repository until that is closed** — it is an owner/FCRA decision, recorded at
   `render.ts:56-62`, not an oversight.
