# UI definition of done

Owner direction: 2026-09-07. Applies to all five applications and the public website.
This is the finish line for the interface; deployment, operational readiness and paid
customer delivery retain their separate launch gates.

**UI complete means every agreed screen and relevant state is implemented in application
code, visually coherent, fully navigable, accessible, and accepted with browser evidence.**
The user can understand the content and finish the frontend journey without imagining
missing screens, controls or feedback.

Current integration status: local shared-shell/control adoption is implemented across the
source inventory in [UI foundation](UI-FOUNDATION.md). Browser finish review and complete
screen/state acceptance remain open. Historical screenshot packets, the older foundation
preview and component installation do not accept this candidate. Provider outcomes and
deployment are not established by this documentation handoff.

## Scope and authority

- [UI screen checklist](UI-SCREEN-CHECKLIST.md) is the screen/state inventory and current
  acceptance record. A missing screen is added there before the group is called complete.
- [UI foundation](UI-FOUNDATION.md) defines the component stack. `@foliage/tokens` owns the
  design values; `@foliage/ui` supplies Foliage-owned controls over Radix Primitives and
  native server controls. Purposeful Magic UI remains website-specific; legacy shadcn
  provenance remains recorded, not prescribed as the application foundation.
- Personal, Hosting, Recruiter, Organization, Member and Website remain in the inventory.
  Deferring a product requires an explicit scope decision; a pilot scope does not silently
  remove that product from the overall UI work.
- Exact routes may change through implementation. Preserve working deep links and record
  the new route. A proposed route is never described as already implemented.

## Acceptance checklist for every screen

### 1. Visual composition and fidelity

- [ ] The page has one clear purpose, a recognizable location and an obvious next action.
- [ ] Content leads: actual work, narrative or media where available; concise source records
  when sparse. Empty space is intentional rather than a placeholder for an unfinished idea.
- [ ] Typography, spacing, controls and leaf-inspired curves belong to the same Foliage family.
  No scaffold styles, browser-default control treatment or inconsistent one-off components.
- [ ] The correct bipinnate mark, surface face, self-hosted type, tabular metrics and accent
  restraint follow the token contract. No decorative underlines, shadows, bounce, spin or personal ranking.
  Compact token control/panel geometry and the shared workspace rail/header remain consistent.
- [ ] Real images have a purposeful crop/fit, description and unavailable-media treatment.
  Dense, long, title-only and mixed-content records remain readable. No fabricated work or
  decorative evidence is used to pass a populated-state review.

### 2. Interaction and continuity

- [ ] Navigation, links, forms, tabs, disclosures and dialogs work by pointer and keyboard.
- [ ] Opening details and returning preserves filters, page and relevant reading position.
  Back, Forward, refresh and direct links have deliberate behavior.
- [ ] Validation explains the exact problem and preserves the user's input. Save, cancel,
  retry and destructive confirmation have explicit outcomes and usable focus behavior.
- [ ] Changes awaiting save, stale data, denied access and uncertain outcomes are distinguished.
  An unconnected service never produces a false success receipt.
- [ ] Every visible CTA reaches an implemented frontend path or an explicit unavailable state
  with a meaningful remedy. The unavailable state alone does not complete the promised flow.

### 3. State coverage

- [ ] Record each applicable state: first use, populated, empty, filtered-empty, loading,
  success, validation failure, source/service failure, permission denied, stale/conflict,
  destructive confirmation, unavailable/deleted content and recovery.
- [ ] Show loading only for an actual asynchronous operation; do not invent a skeleton for
  synchronous document rendering. An omitted state is marked N/A with a reason.
- [ ] Workflow screens additionally cover next run, active run, quiet/no change, paused,
  overdue/offline, failed/retrying, meaningful ready work, dismissed/snoozed and revoked source.
- [ ] Readiness, attribution, review approval, visibility and publication remain distinct.
  Excluded work keeps its reason. UI language never promotes an uncertain attribution.

### 4. Responsive and accessible behavior

- [ ] Review actual 360px, 768px and 1440px viewports, plus content-driven edge widths.
  Read back the viewport. Capture screenshots; inspect wrapping, reading order and overflow.
- [ ] Review keyboard order, visible focus, primary touch targets, landmarks, headings,
  labels, errors, status announcements and dialog focus restoration.
- [ ] Review readable zoom, screen-reader behavior and reduced motion. State measured text,
  state and control contrast ratios. A DOM snapshot is not a screen-reader session.
- [ ] Motion helps orientation or feedback and remains understandable when disabled. Magic UI
  is purposeful, especially on the website; static routes retain their no-script contract.
- [ ] Shipped assets, network behavior and CSP match the intended surface. No runtime font CDN.

### 5. Evidence and acceptance

- [ ] Record exact commit, application route, environment, runtime owner and how each reviewed state
  was reached. Verify that the listener belongs to the candidate; do not transfer screenshot
  acceptance from another checkout or an older preview.
- [ ] Attach screenshots and interaction results; identify real-content limitations explicitly.
- [ ] Relevant tests/builds pass. Visual inspection addresses fidelity as well as broken behavior.
- [ ] No unresolved issue hides content, breaks the journey, loses input/context, misstates a
  result or blocks keyboard/touch use. Remaining polish is recorded for explicit acceptance.
- [ ] A named reviewer accepts the criteria and Alex accepts the visual direction/copy for
  the group. Agent rubric grades alone do not grant owner acceptance.

## Status vocabulary

| UI status | Meaning |
|---|---|
| Planned | Required screen or state is known; implementation is absent or only a concept. |
| In progress | Some UI exists; states, interaction, composition or accessibility remain incomplete. |
| Ready for UI review | All applicable checklist items have implementation and evidence; reviewer acceptance pending. |
| UI accepted | Reviewer and owner acceptance are recorded against the exact scope and candidate. |
| Blocked | A named content, contract or design decision prevents a particular criterion from being accepted. |

Track service integration separately as **unconnected / local / hosted / gated**. A screen
can reach UI review before production hosting is ready if its frontend states and interaction
contract are complete and honestly exercised. A mockup, dead CTA or empty-only prototype does
not satisfy that condition. Do not invent accounts, evidence or success states to demonstrate it.

The whole UI is complete only when every in-scope row is UI accepted. No percentage or count
of completed components substitutes for this decision. Asana completion reflects the task's
scope; UI accepted is not deployed or launched.

## Acceptance record template

```text
Screen IDs and journey:
Implementer / reviewer / owner acceptance:
Commit / environment / routes:
States reviewed / N/A with reason / states still missing:
Desktop / tablet / phone / keyboard / screen reader / zoom / reduced motion:
Screenshots / measured contrast / network and CSP / tests and build:
Integration status and external dependencies:
Open findings and next action:
UI decision: planned / in progress / ready for UI review / UI accepted / blocked
```

Record evidence on the existing Asana task and link the checklist row. Avoid duplicating
historical narratives or treating a new checklist as evidence that the process is adopted.
