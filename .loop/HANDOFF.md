# Handoff — 2026-08-20

Written by the session that owned the **design system adoption, the review click-path, the
product spec, and the escalated-inference client**. A second session ran concurrently in this
same tree throughout; where that matters it is called out by name below.

Every number here was measured in this tree at `7fc2e91`. Nothing is inherited from another tree
or another session's report.

---

## 1 · State at handoff

| | |
|---|---|
| Branch | `design-page-consolidation`, pushed, `7fc2e91` == `origin/design-page-consolidation` |
| Gate | **884 tests, 884 pass, 0 fail**, licensing boundary intact |
| Uncommitted | **~60 files**, none of them mine — see §5 |
| Demo | running on `:4190` and `:4191`, state in `/tmp/foliage-demo/` (disposable by design) |

**Boot the demo** (ports must be checked free first — see the traps in §6):

```bash
cd ~/conductor/workspaces/foliage/caracas
FOLIAGE_LEAF=/tmp/foliage-demo/leaf.json \
FOLIAGE_HARVEST=/tmp/foliage-demo/harvest.json \
PORT=4190 node apps/leaf/server.mjs &

FOLIAGE_TREE=/tmp/foliage-demo/tree.json PORT=4191 node apps/canopy/server.mjs &
```

Regenerate the documents from real history if `/tmp` has been cleared:

```bash
node apps/leaf/intake.mjs --repo "$PWD" --subject "Alex A" \
  --identity "126364027+aacker71@users.noreply.github.com" --out /tmp/foliage-demo/leaf.json
node apps/leaf/harvest.mjs propose --repo "$PWD" \
  --identity "126364027+aacker71@users.noreply.github.com" --out /tmp/foliage-demo/harvest.json
printf '%s\n' '{ "id": "foliage", "company": "Foliage", "leaves": ["leaf.json"] }' > /tmp/foliage-demo/tree.json
```

Current demo state: **58 leaflets**, 3 of them promoted through human review; harvest holds
3 `approved` and 3 `candidate`.

---

## 2 · What landed this session

**The design system is worn by the product.** The Open Design master
(`72967fc2-06d2-4c81-8b46-412e568b5177`, named *"Foliage - Design System Master"*) landed in
`@foliage/tokens` as three layers — `tokens.css`, `roles.css`, `foliage.css` — plus the sprite
and all mark tiers, with contrast tests that *measure* rather than assert. Before: **0** design
system classes on the page, mark `pathCount: 0`, private surface rendering `data-face="day"`.
After: 14 system classes, the compound leaf at **6 leaflet subpaths + 1 rachis**, cream on night
and evergreen `#0E3927` on day, **0 contrast failures** across 15 pairs on each face, **0**
non-loopback origins.

**The review click-path completes in the browser** (`8771d03`). `/review` gained a promote
control; approving used to work and promoting required quitting the page for the CLI. The panel
*derives* its state from the two documents rather than from a redirect parameter — a count in a
URL is a number the page never measured. `/promote` is its own POST-only route because it writes
a different document.

**The owner's product spec is the spec of record** (`a198b8f`), `docs/PRODUCT-ARCHITECTURE-SPEC.md`.
Part I is **byte-identical** to the owner's message (126 lines, 14,102 bytes, checked
mechanically). Part II is alignment added on filing and does not speak for the owner.

**Escalated inference exists as a cloud-plane package** (`f8b3f53`, `0659a25`, `7fc2e91`) —
see §4.

**Findings went back to the design source.** `docs/DESIGN-DRIFT.md` carries 11 corrections owed
to Open Design. One was written back through the now-working MCP as
`context/OWNER-DECISION-mark-supersede-reversed.md` in project `6e0c4a97`.

---

## 3 · Open Design — the MCP works now

It was pinned to version `0.18.0`, whose payload an auto-update had deleted. Repointed at
`0.19.2`; `claude mcp get open-design` reports **✔ Connected**, 22 tools including `write_file`
and `create_artifact`, which is what makes design→code→design a two-way loop.

**This breaks on every Open Design auto-update**, because the registration holds an absolute
path containing the version number. To repair: list
`~/Library/Application Support/Open Design/launcher/channels/stable/namespaces/release-stable/versions/`,
pick the newest with both `…/Frameworks/Open Design Helper.app/Contents/MacOS/Open Design Helper`
and `…/Resources/app/prebundled/daemon/daemon-cli.mjs`, re-add with the same env including
**`ELECTRON_RUN_AS_NODE=1`** (without it the helper dies with *"Unable to find helper app"*).
Do not infer the version from `/Applications/Open Design.app` — that is a launcher stub reporting
an old number. MCP servers load at session start, so a repair helps the *next* session.

**The live hazard:** project `6e0c4a97` still asserts in **24 places across 8 files** that the
bipinnate mark is retired and *"Replaced by the two-tier stroked spiral… do not ship them."* That
is inverted relative to the owner's 2026-08-16 decision. Only an additive correction file was
written; the 24 statements themselves are untouched and need an owner-approved sweep.

---

## 4 · `@foliage/escalated-inference` — verified, and consumed by nothing

Cloud plane, because the open plane makes zero network calls
(`PRODUCT-ARCHITECTURE-SPEC` §10.2/§10.3 decided this). Zero third-party deps — global `fetch`.
512 lines + 262 of tests, 12 tests green.

**Why it exists.** Kimi K3 is a reasoning model. Normally its deliberation stays in a separate
`reasoning_content` field. **When the token budget is exhausted the reasoning spills into
`content` and `reasoning_content` comes back empty.** A drafter that reads `content` and trusts
it writes the model's private thinking into somebody's career portfolio — the same defect class
as the `data-verbatim` bug fixed in `a2a4b62`.

**Verified against the live provider 2026-08-20**, real `escalateDraft`, real commit subjects:

| branch | result | evidence |
|---|---|---|
| default `maxTokens` 3000 | `ok: true`, 11.1 s | 11-word title, inside the limit, 6 evidence refs unmodified, reasoning present only as a length |
| `maxTokens: 200` | `ok: false` `cause: "truncated"`, 8.3 s | `finishReason: "length"`, spill quoted: *"Let me analyze the three pieces of material: 1. cloud: escalated-inference README states…"* |
| no key | `ok: false` `cause: "no-key"`, **0 ms** | counting `fetch` confirmed **0 network calls** |

Stub-only (labelled as such in the package README): `http-error`, `redirected`, `wrong-host`,
`unparseable-response`, `malformed-response`, and the rating/praise/word-limit refusals.

**Key handling.** `FOLIAGE_ESCALATED_INFERENCE_KEY`, read from env, never on disk in this repo —
`grep` for `fw_` across the package returns **zero**. A working key sits at
`~/.foliage/fireworks.env`, mode `600`, outside the repo. **It was pasted into a chat transcript
and the owner has said they will rotate it later** — treat as compromised.

**NOT BUILT: nothing consumes this package.** The obvious caller, `apps/leaf/harvest.mjs`, is in
the **open** plane, so it may not import a cloud package — `check:boundary` would fail. That seam
needs designing, not just plumbing, and it is the next real decision.

---

## 5 · The concurrent session — read this before touching anything

A second session worked this tree all session and left **~60 uncommitted files**:

| area | files |
|---|---|
| `apps/leaf/src` | 24 |
| `packages/leaf/src` | 7 |
| `packages/photosynthesis/src` | 6 |
| `apps/canopy/src` | 6 |
| `packages/canopy/src` | 4 |

New capability of theirs, untracked and unreviewed: per-leaflet **visibility** and a share route
(`share.ts`, `share.mjs`), a **media store** serving `/media/sha256:<hex>`, a **publish policy**
engine (`publishPolicy.ts`, `policy.mjs`), **public projection** and public leaf/leaflet routes
(`publicProjection.ts`, `renderPublic.ts`), and `loopbackFetch.ts`.

**Their audit is worth reading first: `docs/AUDIT-2026-08-20.md`.** Its headline finding:
**0 of 681 leaflets verified on the owner's own portfolio — "Selected work", the hero section,
is empty for essentially every real user.** Root cause is structural: intake computes every
signature finding (`unchecked`, `unbound`, `undeclared`, `rejected`) and *discards* them, so the
web surface is incapable of the honesty the CLI already practises.

**That work is at risk while uncommitted.** It should be committed in reviewed lanes before
anything else — this project has already had one directory-loss scare.

---

## 6 · Traps, each already paid for once

- **`screenshot size` only scales.** A 360px claim from it is inadmissible — the page still
  reports the old `innerWidth`. Use CDP viewport emulation and read `innerWidth` back. Note
  `browser.cdp` over the neo MCP transport rejected its own params argument for me; the
  `360`/`1440` figures in `DESIGN-DRIFT.md` §3.3 are another run's, not reproduced by me.
- **`bclaw.mjs` is broken** — `SyntaxError: Unexpected end of JSON input` on the session
  handshake. Use the `browseros-neo` MCP tools. `navigate` refuses `file:` URLs, so serve local
  directories over loopback (`/tmp/od-serve.mjs` does this).
- **Verify a port is free before binding**, and confirm the listener PID is yours. `lsof -ti :A :B`
  treats the second as a filename and silently fails — one `-ti` per port. A run once curled a
  port and reported another session's page as its own result.
- **One browser tab per agent.** `tabs new` once, then `navigate`. Close before the run ends — a
  leaked tab orphans into the user's browser and cannot be closed afterward.
- **Never copy a number between trees.** The `photosynthesis/prototype` tree reports **nine**
  workspace packages; this one has **eight** (nine now, with escalated-inference). A "nine" was
  filed here as measured and was wrong.
- **A green suite is not a working product.** Every UI claim in this handoff came from a rendered
  page or served bytes.

---

## 7 · What I'd do next, in order

1. **Commit the concurrent session's ~60 files** in reviewed lanes. Highest-value, highest-risk.
2. **Capture `%aI` into provenance.** `apps/leaf/src/gitIntake.ts` `LOG_FORMAT` is
   `%H%x1f%ae%x1f%G?%x1f%GS%x1f%s%x1e` — sha, email, `%G?`, `%GS`, subject, **no date**. Measured
   consequence: **58 leaflets share 2 distinct `observedAt` values**, so the document cannot order
   its own contents in time. This one change unblocks ordering, recency, *and* history, and it is
   the prerequisite for the design's `LAST GROWTH` sort and for emergence-as-a-saved-query.
3. **Surface the signature findings** the CLI already computes — the audit's headline defect.
4. **The publish affordance.** The policy engine, the visibility states
   (`private` default / `unlisted` / `public`) and the public routes all exist and are wired;
   what is missing is the *act*. Today publishing means hand-editing `"visibility": "public"`
   into JSON. It needs the withheld-report gate in front of it, because a public page is the
   FCRA surface.
5. **Design the escalation seam** — how an open-plane drafter reaches a cloud-plane client
   without crossing the boundary.

---

## 8 · Still the owner's call

- **X3 licence / CLA** — decided as *stay private*, which is a scope decision, not a licence.
- **The Fireworks key rotation**, and whether ZDR (`store=false`) is configured — the supplied
  example sets none, and `PRODUCT-ARCHITECTURE-SPEC` §3 requires it be explicit.
- **The FCRA verbatim-title egress**, marked and not fixed: `packages/leaf/src/intake.ts`
  `titleOf()` returns the commit subject unfiltered into `<h1 data-verbatim="title">`. The
  `<title>` half is fixed (`a2a4b62`); the body half is not. **Nothing may be published until
  this closes.** The filter must match a dot-bearing domain, not a bare `@` — this repo's own
  packages are scoped (`@foliage/tokens`).
- **The 24 inverted mark statements** in Open Design project `6e0c4a97`.
- **The merge with `origin/photosynthesis/prototype`** — recomputed at handoff: this branch is
  **28 ahead / 24 behind** with **19 conflicts**, up from 13 earlier in the session as both sides
  kept moving. It is its own reviewable PR and was deliberately not attempted mid-redesign.

  The conflicts cluster in three places, and the clusters matter more than the count:
  - **Two independently-written signature-honesty implementations** —
    `apps/leaf/{intake.mjs,server.mjs,src/gitIntake.ts,src/gitIntake.test.ts,src/render.ts}`,
    `packages/leaf/src/{intake.ts,intake.test.ts}`. Neither is a copy of the other; this needs a
    decision about which survives, not a textual merge.
  - **The design system**, which only exists on this side —
    `packages/foliage-tokens/{package.json,src/tokens.css,src/foliage.css,src/foliage-sprite.svg}`.
    Two of those are `add/add`: the other tree grew its own copies.
  - **Contract and ledger prose** — `AGENTS.md`, `README.md`, `public-boundary.json`,
    `.loop/{LAUNCH,STATUS}.md`, `TESTER-QUICKSTART.md`.

  `public-boundary.json` conflicting is the one to resolve first and most carefully: it is the
  file the boundary gate reads, so a careless resolution silently changes which packages are
  allowed to reach which.
