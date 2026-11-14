# Living compound leaf

The private `/leaf/explore` surface turns the loaded Leaf into a live, bipinnate 3D
collection. The owner reaches it from **Portfolio → View options → Orbit** (`/leaf`, formerly
My Leaf), shown once the portfolio holds chosen work rather than only source records.
The readable portfolio and original artifact reports remain available.

## Use and run

```sh
pnpm install
pnpm --filter @foliage/leaf-app explore:build
FOLIAGE_LEAF=/absolute/path/to/leaf.json pnpm --filter @foliage/leaf-app dev
```

Use the server's reported address and open `/leaf/explore`. The build produces only
an ignored browser bundle; Node still executes the server TypeScript directly.
Rebuild after changing the renderer or switching worktrees/branches. An ignored bundle
can survive a checkout and expect controls that the current page no longer renders. Each
page and refresh request now checks the bundle's recorded source contract and bytes.
A missing, damaged or stale bundle shows its actual cause and rebuild instruction,
keeps the stylesheet, and exposes private artifact links without executing stale code.
The bundle contains Three.js's dependency
license notice; this does not establish a license for Foliage itself.

Drag to orbit, scroll/pinch to zoom, and select a blade to inspect its artifact.
Hover shows the recorded title, observed date, attribution and available excerpt.
A phone tap brings the selected details into view. The title search and observed-month
timeline filter the list and dim nonmatching blades. Arrow keys on the
canvas step through matching records. Motion can be paused, and reduced motion
starts paused. Reset view restores the camera.

## Source artifacts

| Artifact | Source | Purpose |
| --- | --- | --- |
| Botanical geometry | `apps/leaf/public/compound-leaf.mjs` | Curved rachis, paired pinnae, tapered silhouette, cupped leaflet surfaces |
| Materials and lighting | Same module | Procedural vein texture, matte surface, soft key and rim lights |
| Interaction | Same module | Raycasting, orbit/zoom, selection, filtering, subtle pinna motion, context-loss recovery |
| Interface | `apps/leaf/src/compoundPage.ts` | Real-record inspector, excerpts, provenance, exclusion reasons, original-report and Photosynthesis links |
| Styling | `apps/leaf/public/compound-leaf.css` | Night surface, responsive composition, shared token colors and fonts |
| Controls | `@foliage/ui` | Existing shadcn-derived buttons, label and search input |
| Browser packaging | `apps/leaf/build-compound.mjs` | Pinned Three.js bundle with dependency notice |
| Data and boundary checks | `apps/leaf/src/studioSeam.test.ts` | Real repository intake, record coverage, private URLs, publication CSP, empty/error distinction, escaping |

There are no external model, texture, font or image downloads. Geometry and vein
textures are generated locally. All color and type values come from `@foliage/tokens`.
This is a Three.js surface with shared application controls; it does not use Magic UI.

## Meaning and limits

Every blade corresponds to exactly one actual Leaflet, in document order. Blade
size is equal across proof tiers. Position, curvature and lighting do not express
quality, importance, a score or a proof progression. Excluded records retain their
reasons and remain selectable. Source colors distinguish Git, Photosynthesis and other
origins using categorical tokens in `@foliage/tokens`; the alternate attribution key
retains verified, pending and excluded as unordered categories. Selection uses a light
outline without changing the record's color. Shared-source/reference connections follow
the selected leaflets during motion; they do not infer influence or impact.

The timeline uses `provenance.observedAt`, not an inferred achievement date. Undated
records remain selectable. Filtering never changes publication or review state.

The page is private and read-only. It does not publish records, alter review
states or send content to AI. The contextual link goes to Photosynthesis, the
local agent; Ladybug remains cloud-only. Its visible entry opens the selected Leaflet's
evidence preview. A paired assessment companion can receive that exact pending/private
revision for review on this device; cloud assessment still requires separate provider
configuration and consent. Both Leaf and Leaflet revisions are checked before transfer.
Published pages keep their script-free
contract. No-JavaScript readers can open the portfolio; unavailable/lost WebGL
leaves the artifact list usable when the bundle has loaded.

The preview uses existing repository-derived work. It has no stored photographs,
so no photo coverage or generated evidence imagery is claimed. Full bodies and
media, when present, remain accessible through the existing artifact report.
The explorer checks the local document revision every five seconds while visible,
every thirty seconds in the background, and when visibility changes. Changed
records replace the collection while preserving the camera, search, observation period and surviving
selection. A read failure keeps the last loaded collection with an explicit status.
Pending/private records link to revision export and returned-suggestion review;
the explorer itself remains read-only. See [Leaflet revision workflow](LEAFLET-REVISION-WORKFLOW.md).
Very large collections beyond those measured below still need performance profiling.

## Verification — 2026-09-06

- BrowserOS neo rendered 267 actual records as 267 blades; desktop and true 375px
  viewport screenshots were inspected. Phone width readback was 375 and the
  mobile media query matched; no horizontal overflow was measured.
- Title search returned two actual launcher records; ArrowRight selected the
  other record and its matching private artifact URL. A missing title produced
  zero matches with the explicit empty-search message.
- Raycast hover and selection resolved the same actual record in the inspector.
- Reduced-motion emulation changed the control to Resume motion. Forced WebGL
  context loss displayed recovery guidance while list selection continued working.
- Observed browser resource requests were all same-origin. Published-route CSP
  and lack of the graphics bundle are checked against the real HTTP server.
- Measured text contrast against the night canvas: primary text 16.36:1, muted
  text 7.73:1, display green 6.33:1. These are observed pairings, not an assertion
  covering every state or combination.
- `pnpm check`: 1,643 tests passed, with boundary, egress, duplication and type
  gates included. The pinned graphics dependency's shader literature URL is
  declared as a non-network reference in `public-boundary.json`.

## Owner direction — 2026-09-09 (partly implemented)

The 3D compound Leaf should become a primary way to explore a person’s career in
both the private Leaf and the public Canopy. A discoverable entry belongs beside the
readable portfolio, with touch, keyboard and no-WebGL access to the same artifacts.

- **Whole Leaf:** one coherent bipinnate compound leaf, with real Leaflets connected
  through meaningful relationships. Exact shared evidence is a factual relationship;
  proposed dependencies, influence or shared capability must be labeled and reviewed.
- **Select a leaflet:** open its problem, personal contribution, decisions, AI assistance,
  real media, evidence and outcomes, with an explanation of why the work mattered.
  Missing information must stay missing rather than being written to fill a panel.
- **Leading tip:** foreground the person’s most consequential career artifacts and
  the outcomes supporting that choice. This is an editorial choice about achievements,
  not a numerical person score or a mapping from proof tiers to importance.
  The recommended workflow is Ladybug proposes highlights with evidence and the person
  approves them; whether the person prefers direct manual curation remains open.
- **Private/public continuity:** preserve the visual identity of the Leaf while the
  public version includes only the exact published selection. A hidden artifact must
  not leak through a connecting edge, tooltip, count, position gap or detail request.
  Public interactive delivery needs a deliberate route/CSP integration; existing
  script-free documents remain readable without the visualization.

The current implementation has the private geometry, record selection, exact evidence
relationships, observation timeline and live local refresh. Public 3D delivery, reviewed
influence/capability relationships, saved leading-tip curation and structured achievement
detail remain work to implement. Public documents with work now name Ladybug and state
that no interpretation or public conversation is attached; no public chat endpoint is claimed.
The current `document order` rule
above describes shipped behavior, not the full owner-requested target.

### Demo recovery — 2026-09-09

The local demo’s ignored browser bundle was from a different page revision. It called
`addEventListener` on the absent `#cx-clear-search` control before reaching `grow()`,
so the canvas never became ready although the script returned HTTP 200.
Rebuilding with `explore:build` restored the existing renderer. Browser inspection
then measured 235 actual records mapped to 235 blades. A real canvas mouse selection
changed the inspector from record index 1 to 232 with the matching hover and title.
This repaired the local generated artifact. The follow-up below adds automatic
stale-bundle detection; a rebuild remains required after relevant source/checkout changes.

## Interaction repair — 2026-09-10

- One tapered bipinnate envelope, a short petiole and finer pinnae replace the long
  exposed branch-like structure. One blade still maps to one actual record.
- The running collection contains 235 records, all pending: 204 from Git and 31 from
  Photosynthesis, observed August 22–29, 2026. Color diversity comes from sources.
- Browser checks covered source/attribution controls, the observation period, five
  matches for `shell`, a zero-result state, hover context, keyboard selection, actual
  touch selection at 390px, and following a shared-evidence connection. Mobile width
  and media query were read back; there was no horizontal overflow.
- The selected `git-cluster:shell` reached an isolated paired companion's imported
  evidence preview. No assessment draft was saved, no model ran, and nothing was published.
- Independent code review caught connection curves needing to follow animated leaflets
  and assistant state needing refresh even when Leaf bytes stay unchanged. Both are fixed.
- `pnpm check` passed all 1,997 tests, including source boundaries, egress, duplication,
  types, real bundle freshness/corruption probes and exact-revision handoff checks.
- Measured flat swatches against the night canvas: Git 6.33:1, Photosynthesis 7.84:1,
  other sources 5.65:1. Primary and muted text measured 16.36:1 and 7.73:1. These
  measurements do not describe every lit pixel of the 3D material.
