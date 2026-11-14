---
name: Foliage
description: A quiet, precise instrument for reading work and inspecting its evidence.
colors:
  action: "var(--fol-role-action)"
  action-hover: "var(--fol-role-action-hover)"
  action-label: "var(--fol-role-action-fg)"
  canvas: "var(--fol-role-bg)"
  panel: "var(--fol-role-panel)"
  raised: "var(--fol-role-panel-raised)"
  foreground: "var(--fol-role-fg)"
  secondary: "var(--fol-role-fg-secondary)"
  control-edge: "var(--fol-role-edge-control)"
  invalid: "var(--fol-role-invalid)"
typography:
  display:
    fontFamily: "var(--fol-font-display)"
  title:
    fontFamily: "var(--fol-font-sans)"
    fontSize: "var(--fol-t-25)"
  body:
    fontFamily: "var(--fol-font-sans)"
    fontSize: "var(--fol-t-14)"
  reading:
    fontFamily: "var(--fol-font-sans)"
    fontSize: "var(--fol-t-16)"
  label:
    fontFamily: "var(--fol-font-sans)"
    fontSize: "var(--fol-t-13)"
  metric:
    fontFamily: "var(--fol-font-mono)"
rounded:
  control: "var(--fol-role-radius-control)"
  panel: "var(--fol-role-radius-panel)"
  tip: "var(--fol-shape-tip)"
  sheet: "var(--fol-role-radius-sheet)"
spacing:
  inline: "var(--fol-role-gap-inline)"
  grid: "var(--fol-role-gap-grid)"
  control: "var(--fol-role-pad-control)"
  panel: "var(--fol-role-pad-panel)"
  page: "var(--fol-role-pad-page)"
  block: "var(--fol-role-gap-block)"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-label}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "var(--fol-role-height-control)"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-ghost:
    textColor: "{colors.secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.foreground}"
    typography: "{typography.reading}"
    rounded: "{rounded.control}"
    padding: "{spacing.control}"
  workspace-navigation:
    textColor: "{colors.secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
  workspace-navigation-current:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
  work-row:
    textColor: "{colors.foreground}"
  state-chip:
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
---

# Design System: Foliage

## Overview

**Creative North Star: "A well-made instrument"**

Quiet, precise and organic. Real work, stories and retained artifacts lead; tools and settings sit in contextual controls or the navigation disclosure. The compound leaf expresses a connected body of work without competing with its readable account.

Use compact reading rows, restrained serif work titles, sans operational headings and inspectable evidence. The private record is primary; portfolio and audience views are selective projections. Empty, excluded and unavailable states stay explicit.

**Key Characteristics:**

- Work and stories before their machinery.
- Evidence beside the account, on demand.
- Night for private work; day for published reading.
- A compact moving compound leaf with a readable fallback.

This record describes local source in this integration checkout. Current browser finish review,
route/state acceptance, provider operation and deployment acceptance remain open. Historical
reviews in other checkouts do not accept this candidate; the older preview covers only its
foundation. The integration evidence records a passing repository gate and website build/lint; these do
not accept the visual result. See the
[current verification record](.impeccable/review/remaining-surface-integration/verification.md).

The owner-pinned Open Design master (`72967fc2-06d2-4c81-8b46-412e568b5177`) owns direction;
`@foliage/tokens` owns values. The accepted work-record thesis is in
[context/product-thesis.md](context/product-thesis.md). This is a source-grounded reconciliation
of the established world, not a new visual identity or release claim.

## Colors

Forest night, paper day and a restrained chartreuse action share the same semantic roles.
The frontmatter binds live CSS properties; it is not a copied palette. Load package-exported
`tokens.css`, `roles.css` and `foliage.css`, then shared controls/workspace and page composition.
The sidecar requires those properties in its host; it deliberately creates no tonal ramps.

**The Surface Face Rule.** Private operations use night; published reading uses day. Nested
previews bind their face explicitly. There is no preference toggle. Primary action text and
focus on day need their existing component-level day treatments.

**The Restrained Accent Rule.** Reserve the accent for at most two meaningful moments per
screen. Separate decorative dividers from the stronger control-edge role. Attribution states
remain unordered; excluded is distinct from invalid input and retains its reason.

## Typography

Self-hosted Fraunces (`--fol-font-display`) carries the brand and work titles. Instrument Sans
(`--fol-font-sans`) carries operational headings, controls and prose. JetBrains Mono
(`--fol-font-mono`) carries references and metrics. Package font assets are authoritative.

The shared workspace uses the title, body and label bindings above; work prose uses the reading
binding. Work titles remain responsive display type in the owning page stylesheet. Do not
promote every heading to a serif hero or invent a second scale from local one-off sizes.

**The Measured Metric Rule.** Metrics use the mono family and `font-variant-numeric: tabular-nums`.
Labels use ordinary sentence-case sans rather than decorative eyebrows.

## Layout

`@foliage/ui/workspace.css` owns application chrome: a fixed desktop navigation rail and fluid
content frame, changing to an in-flow header at its `800px` media query. Primary links remain
available as Home (`/`, also the wordmark), Work, Review, Portfolio and Sources; More holds
Scarlet, Reflection, Photosynthesis, Import, Policy, Publish and the Harvest log. The phone
disclosure opens below the complete header; below `375px` wide the five primary tabs share their
row evenly with tighter inline padding, so all five stay visible at `320px`. On the desktop rail
the More list scrolls above the footer; More never shrinks below its trigger (or its trigger and
two tools once open), spacing tightens at `720px` tall and below, and a rail that still cannot
fit scrolls as a whole rather than clipping. Pages own their content measure, rows
and responsive composition, not competing rail geometry. Navigation width and control height
consume token roles.

Work uses bordered, content-sized rows; an actual retained image may sit beside its account.
The Work artifact row stacks at `640px`. Hosted composition keeps account actions near the title.
Before an authored achievement exists, Work leads with a small preview of attributed retained
records and any owner-written account. The preview remains alongside saved achievements. Exact
duplicate titles are omitted from that preview, not from the full paginated record view or
search; uncited, public or unattributed records never receive a private-story action. The story
form reads as one evidence-bound sequence rather than a grid of nested panels.
Review leads with compact draft titles and states. Opening a row reveals its exact citations and
decision fields and the complete title; closed rows cap long machine drafts at two lines. Its
count summary is inline rather than three competing cards. Native find uses
title, ID, source or cited reference when the queue needs it; the total awaiting count does not
change under search. The local-access and non-publication caveats remain visible before decisions.
The find context stays with a decision. Publish separates proposed disclosure
from work that remains private and sends its record action to that exact private record.
It distinguishes a shared link from static export admission and names an email address in a
shared title before the owner follows that link. Journey history uses compact version rows,
readable dates and short references with the full value on request; restoring a whole
achievement names the current statements it will replace and requires acknowledgement.
Enterprise retains organization structure within the
same workspace. The portfolio reader compacts to its narrow leaf layout at `760px` and provides
a no-WebGL text layout. These are observed stylesheet breakpoints, not new token definitions.
Canopy publication previews use the day reader because they show the exact outward artifact,
but mark it as private, suppress public detail links and publication dates, and keep the
publish decision and its consequence in the reading frame. A prepared artifact is not a live page.

## Elevation & Depth

**The Flat Ground Rule.** Use canvas, panel and raised grounds with edges for grouping and state.
No box shadows. A divider separates content; a control boundary must remain identifiable on its
actual ground. Avoid nested ornamental panels around ordinary rows.

## Shapes

Compact controls, quiet panels and sheets consume the package radius roles. Selected portfolio
panels retain opposing panel/tip corners; dense controls do not inherit those corners indiscriminately.
The exported bipinnate compound leaf is the only mark. Use the icon tier at small sizes, painted
with current color through the existing mask; never reconstruct a spiral or coil.

## Components

**Shared controls.** `@foliage/ui/controls.css` owns buttons, fields, tabs, toggles, Select menus and dialog appearance.
Primary buttons use action/hover roles; ghost controls use quiet text and a raised hover ground.
Fields use the canvas, control edge and control radius. Disabled and invalid states remain explicit;
focus is visible. Native anchors retain link behavior and native forms retain submission authority.

**Navigation.** React `WorkspaceHeader` and the server `workspaceHeader` adapter render the same
rail/header structure. Current links use a raised ground, edge and `aria-current`; More is a native
disclosure. Private first use and owner leaflets share that shell; published pages never receive
owner navigation. Hover changes ground/text, never adds an underline.

**Radix behavior.** Workflow and Canopy Hosting consume shared Radix Tabs. Workflow Rhythm uses
shared Radix Select for cadence and day. Sources, Rhythm and Canopy confirmation compose the
shared Field with explicitly associated labels. Canopy Hosting uses
the shared AlertDialog for withdrawal, with focus trapping, Escape and trigger restoration; the
exact-ID form still governs submission. The package exports a
Radix ToggleGroup, but this checkout's Work filters are a native GET form with search, select and
Apply; do not transfer the sibling checkout's ToggleGroup-adoption claim here. Server routes use
native controls without claiming hydration. Legacy shadcn and Magic UI provenance remains in
[packages/ui/PROVENANCE.md](packages/ui/PROVENANCE.md).

**Recovery keeps the work in view.** An unavailable Sources connection status shows Retry rather
than an indefinite Checking state. Scarlet model setup gives Find priority before discovery;
afterward the installed models lead and Refresh recedes. A rejected Canopy Prepare submission
returns to Prepare with the attempted inclusion scope, reloads authoritative review data and
clears the typed confirmation.

**Work, evidence and leaf.** Saved accounts and review drafts retain distinct status and destinations.
Actual artifacts lead when available; absent media has an honest state. The optional living leaf
enhances readable records and evidence disclosures. Preserve reduced motion, print and no-WebGL
reading. Use package arrive/leave easing; motion neither bounces nor spins. Motion acceptance still
requires the current browser/runtime, including a capable graphics context.

**Adoption inventory.** [UI-FOUNDATION.md](docs/UI-FOUNDATION.md) records the source owners;
[UI-SCREEN-CHECKLIST.md](docs/UI-SCREEN-CHECKLIST.md) tracks the still-open acceptance scope.
Neither file claims provider operation from component installation.

## Do's and Don'ts

### Do:

- Do consume package token roles and shared controls; keep page styles focused on composition.
- Do show retained artifacts only when present and preserve original accounts and evidence.
- Do use mono tabular numerals for metrics and preserve visible keyboard focus.
- Do record measured contrast for the actual surface and state.

### Don't:

- Don't invent work, collaborators, evidence, scores or success states.
- Don't add decorative underlines, shadows, bounce, spin or the superseded coil mark.
- Don't spread the accent, organic corners or ornamental containers across every control.
- Don't treat source adoption, a historical screenshot or a green test gate as current browser or deployment acceptance.

## Published résumé reader

Hosted `/leaf/:id/resume` uses the day face and a single text column. The visible portfolio
address and per-statement links survive printing; evidence expands inline on screen. Shared
`@foliage/ui` controls provide one accented Print / Save PDF action and quiet Word and Markdown
downloads. At phone widths the toolbar stacks and long links and references wrap. Print hides
controls and guidance, retaining selectable work text and links. Type, space, colour, and
self-hosted fonts come from `@foliage/tokens`. Private résumé drafts remain in the night shell
and explicitly identify their local links before publication review.

The Word export is a portable document presentation: a single column of real paragraphs,
standard Title/Heading styles, visible portfolio address, and clickable statement/citation
links. It uses office-compatible typography rather than embedding browser pixels or loading
fonts from a network. It retains all admitted writing and the snapshot notice; longer text
may span pages without fixed-height containers.
