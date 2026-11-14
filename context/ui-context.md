# UI context

The visual source of truth is `@foliage/tokens` in `packages/foliage-tokens`; component
adoption and surface coverage live in [UI-FOUNDATION.md](../docs/UI-FOUNDATION.md).
Do not copy palette, font, spacing or motion values into this context file.

## Product meaning and tone

Apply [Language & Product Framing](product-thesis.md): “Your work deserves a record.”
Make specific contributions, interests, learning and meaningful progress visible before
integration controls. Support grounded pride through real work; do not generate flattering
claims or infer passion from usage. The builder's journey includes unfinished work and pivots.

Use concise summaries with deeper evidence available on demand. A weekly summary, with an additional daily digest if the user wants it,
should begin with prepared context, preserve the owner's corrections and ask for
only what cannot be established from permitted sources. It is not a mandatory onboarding
questionnaire or a posting streak. This is refinement direction, not shipped reflection UI.

The botanical presentation should make connections and growth understandable, while readable
content remains complete without 3D. Private value comes before public sharing. Keep feeds,
follower counts and engagement mechanics out of the central experience; distribution helps
the right reader understand relevant work. Use the [workflow refinement check](ai-workflow-rules.md)
for new UI work. Distinguish the private work record from the selected public view in language
and navigation. Show measured facts, attributed feedback, self-report and AI interpretation
with their actual source and uncertainty; a polished sentence must not imply stronger proof.

“I feel seen” is an owner-reported product outcome. Preserve passion and meaning in the
owner's words without personality assessment or generic praise. Any work-value range must
show its assumptions and uncertainty and describe the work outcome, never rate the person.

## Minimal interface and separate applications — 2026-09-27

Default application pages show a title, relevant work or status, and actionable controls.
No introductory descriptions, motivational paragraphs or repeated explanations. Place
technical context, source receipts and history in named disclosures. Keep errors actionable
and state cloud-transfer scope beside its opt-in action. Preserve the person's own biography,
journey, evidence and citations: minimal interface copy is not minimal career substance.
On the Work overview, the owner's retained title and a single clear action lead. Read the
complete account and evidence on its detail page; never cut an achievement statement before
its qualification and leave the resulting fragment looking like a stronger claim. Once saved
accounts exist, source records remain counted and browsable without filling the overview with
raw evidence excerpts; explicit search and the records view retain full access.

Personal, recruiting and enterprise are separate application journeys. Personal navigation
is what ships in `workspaceNavigation.ts` (owner decision, 2026-10-08): Home, Work, Review,
Portfolio and Sources, with Scarlet and the other personal tools under More. Home is `/`:
the launcher opens it, it holds the first-run state and it answers "What needs my attention?";
the wordmark returns there from every page. Sources opens `/workflow#sources`, and that page
is titled Sources. Its Overview tab is not a second home: it keeps what Home lacks (collection
and source health, accepted older drafts still to save to Leaf, publication counts). Company
administration owns Org chart, Releases and Members. Never place a recruiter/company app
switcher, ATS tools or organization policy in a personal workspace. A website application
catalog may link separate entry points. On the website the personal preview has no switcher;
the business previews (Recruiter, Organization, Member) keep one among themselves, on purpose
(#157, owner decision 2026-10-08).
For people and agents, use the same named native links, controls and disclosures. Keep
current location, busy state and actionable errors machine-readable. Accessible names remain
explicit even when visible labels are short. Avoid hover-only actions or a second agent UI.

Existing authentication, authority and storage boundaries remain unchanged. Enterprise member
runtime is still planned; removing a prototype switcher does not implement that runtime.

## Reading experience

The intended portfolio starts with a person's introduction and direction, then keystone
achievements, then the compound-leaf timeline. Each leaflet must lead to readable context
and its evidence, with source identity and dates that disclose what the date means.
The 3D leaf is an enhancement of accessible content. Named company, role and project views
share canonical evidence. No impact score determines a person's value.

## Surface rules

Private work surfaces use night; published reader surfaces use day. Apply the mark, typography,
metric treatment, restrained accent and motion rules from [AGENTS.md](../AGENTS.md).
Fonts and assets must follow the owning runtime's privacy contract. Empty, unavailable,
excluded and interrupted states must remain distinguishable. A local assistant should show
what stays local; a cloud interaction must identify what is sent and to which service.

## Components and token roles

Use Radix Primitives with Foliage-owned `@foliage/ui` controls and `@foliage/tokens`.
Shared `controls.css` owns appearance; `workspace.css` and the shared header own application
chrome. Workflow and Canopy Hosting consume shared Radix Tabs; Workflow Rhythm uses Radix Select
and both apps compose shared Field with explicit label associations. The root `ui` facade supplies
native server-rendered button, link, input, textarea, label and alert controls; this does not
hydrate every application. Work currently uses native search/select/Apply filters, while the
package ToggleGroup export remains available. Legacy shadcn adaptations retain their provenance;
purposeful Magic UI remains website-specific. Inspect the package export map before importing.
See [UI-FOUNDATION.md](../docs/UI-FOUNDATION.md) for source adoption and open acceptance.

| Decision | Token/source reference |
|---|---|
| Surface, text and borders | `--fol-surface`, `--fol-surface-raised`, `--fol-text`, `--fol-text-muted`, `--fol-border` |
| Display, UI, metric type | `--fol-font-display`, `--fol-font-sans`, `--fol-font-mono`; metrics use tabular numerals |
| Accent and proof states | `--fol-accent`, `--fol-verified`, `--fol-pending`, `--fol-excluded`; states have no ranking |
| Motion | Consume current role easing where exported, otherwise `--fol-ease-grow` / `--fol-ease-fold`; no new deprecated alias usage |
| Mark and shape | Package-exported compound-leaf assets and current token roles; no copied palette or radius scale |

## Layout and behavior by surface

- Individual: retained context alongside review/agent interaction; introduction → keystones
  → compound timeline for the portfolio. Keep claim evidence reachable without WebGL.
- Hosting/organization/member: review leads with what changed, acting capacity, audience,
  action effect and outstanding permission. Expand evidence on demand; preserve correction
  text, context and queue position on refusal/sign-in return.
- Public reader: day surface, inspectable admitted work, no private editing controls;
  collection filters and dates describe their actual meaning.
- Cloud agent: identify cloud execution and the selected material transferred before the
  request. The local assistant is labeled Photosynthesis; its retained Scarlet route names do not imply cloud execution. Ladybug assessment availability is explicit in the workflow.
- Website: explain only accepted capabilities; a prototype or designed offer is labeled.

Use effect-specific actions: approve draft, approve company release, allow private sharing,
publish this version. Reuse valid sessions and unchanged permissions; do not add generic
repeat confirmations. Missing model, stale review, pending delivery and unknown outcome
need distinct recovery paths. This summarizes accepted UX1; its detailed record remains in
[engineering decisions](../docs/PORTFOLIO-SCALE-ENGINEERING-PLAN.md#ux1-approval-must-be-clear-and-low-effort).

## Verification and scope

Measure actual viewport layout, keyboard access, reduced motion, contrast and resource
requests. A screenshot resized to a mobile width is not a mobile layout test. A public
website prototype is not a connected application. Read [progress](progress-tracker.md)
for the integrated achievement-first and Three.js portfolio checks and remaining acceptance.

## Proposed harness presentation

The [portfolio harness draft](proposals/portfolio-harness.md) proposes live media, agent
refinement and execution-location/ETA feedback. These are proposed extensions. The revised design uses qualitative evidence instead of person-score
radars; estimates require measured support.

## User and Scarlet customization

Portfolio, named views and individual leaflets require rich direct editing and Scarlet-assisted
editing through the same operations: composition, layout, theme presets, media, narrative,
curation and compound-leaf presentation. Live preview, inheritance/overrides, undo/redo and
revision checks are required. Preserve evidence and owner edits; public visitors have no
editing authority. See [customization contract](proposals/portfolio-harness.md#81-user-and-scarlet-customization--required-product-scope).
This is required product scope, beyond current basic authoring coverage.

Implemented presentation slice (2026-09-18): Look & feel in the existing authoring editor saves
editorial/clean titles, airy/compact timeline rhythm, source/quiet source colors,
branching/linear compound-leaf layouts, split/stacked introductions and contained/panel-width
evidence images. Portfolio, named Leaf and Leaflet scopes share inheritance,
live preview, revision checks, immediate undo and bounded manual/agent history. Publication carries
the same resolved presets for admitted records only and omits the private history. Image framing
never selects or admits media. Cloud Scarlet, media selection, persisted motion controls and
non-style edit history remain;
local MCP style tools require explicit `--allow-presentation`.

## Accepted visual direction — 2026-09-17

The owner's current Open Design portfolio is `proposals/living-work-portfolio.html` in project
`72967fc2-06d2-4c81-8b46-412e568b5177`. It presents a person's career and accomplishments as a
contribution within a larger canopy. Ladybug remains; solitary botanical specimens and moss
pedestals do not communicate the intended belonging. Actual collaborations and shared work
must come from permitted context, never invented social proof or unlabeled decorative links.

First application adoption: shared primary buttons and portfolio panels use opposing existing
panel/tip shape tokens. Secondary actions, inputs, filters and evidence rows remain quiet.
The shared person hero uses the existing shadcn server Button for its first action. Intro/Look
& feel/citation controls remain links. The prototype's example biography and generated artwork
are not copied into other people's portfolios.

## Opportunity sharing — implementation design, 2026-09-23

Owner correction, 2026-09-23: recruiting has dedicated pages and navigation. Do not mix
candidate search, ATS connections, recruiting delivery or hiring messaging into the personal
work record, Scarlet collaboration, onboarding or ordinary portfolio sharing. Personal
sharing offers the live portfolio and cited résumé. Canopy's `/recruiting` entry owns its
portfolio selection, connections and delivery pages; it reuses admitted publications and
authority without a second evidence store. Recruiting sign-in returns to that workspace.

Within the separate opportunity/recruiting surfaces, **Be discoverable**, **Share for an
opportunity**, **Connect a destination** remain scoped actions. Jobs, client work or both select the owner's goal;
views reuse canonical achievements. A brief exact preview explains audience, included work
and update behavior, with advanced details progressively disclosed. Keep the person and work
prominent; integrations and operation logs remain secondary. Valid grants prevent repetitive
approval prompts while broader disclosure requires new authority.

Public readers need no account or WebGL: introduction → relevant achievements → evidence →
**Request a conversation**. Verify inquiry senders without blocking public reading. Client
views emphasize declared services and case studies, not invented testimonials. Preserve
accessible text, citation links and meaningful timestamps alongside the compound leaf.

Delivery history distinguishes prepared, queued, accepted, unknown, confirmed current and
removal requested. A downloaded resume is not a delivered application; a page fetch is not a
human view. Withdrawal explains separately what is hidden here and what an external recipient
may retain. All proposed behavior follows the [distribution contract](contracts/portfolio-distribution.md).
No new palette, parallel component library or implemented-status claim.
