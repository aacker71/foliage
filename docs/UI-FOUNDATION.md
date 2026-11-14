# Foliage UI foundation

Use **Radix Primitives + Foliage-owned components** through **`@foliage/ui`**, themed by
**`@foliage/tokens`**. Radix supplies interactive behavior; shared Foliage CSS supplies appearance.
Native links, forms and disclosures remain native where hydration adds no required behavior.
Magic UI is reserved for purposeful website motion.

This document records local source adoption in this integration checkout. Current browser finish
review, complete route/state coverage, provider operation and deployment acceptance remain open.
The older preview reflects its foundation only; later local integration is not deployed. Historical
screenshots and acceptance from other checkouts do not accept this candidate. The
[pilot screen receipt](acceptance/2026-10-01-pilot-ui-screens.md) records bounded browser
interactions from this integration branch; component-specific receipts record their own
source heads. None is a full browser verdict or deployment claim.

Read [DESIGN.md](../DESIGN.md), the [UI definition of done](UI-DEFINITION-OF-DONE.md), and the
[screen checklist](UI-SCREEN-CHECKLIST.md) together. Component installation is not application acceptance.

## Source ownership and adoption

| Layer or surface | Current source and adoption |
|---|---|
| Tokens | `packages/foliage-tokens/src/tokens.css` owns values and faces; `roles.css` binds semantic roles. Documentation consumes live CSS references. |
| Shared controls | `packages/ui/src/controls.css` styles Button, Input, Label, Field, Textarea, Checkbox, Tabs, ToggleGroup, Select, AlertDialog and FeedbackNotice; `action-row.css` owns ActionList/ActionRow and `empty-state.css` owns EmptyState. React exports use Radix where interaction needs it; the root `ui` facade renders matching native server controls. The native `.btn` and `.field` token controls are excluded from the shared fallback selectors so stylesheet order cannot restyle them. |
| Workspace chrome | `packages/ui/src/workspace-header.ts` and `workspace.css` own the shared desktop rail, mobile header, More disclosure and content frame. `workspaceHeader` renders the same component to static HTML. |
| Work | `apps/leaf/src/workWorkspace.ts` and `public/work-workspace.css` render real saved accounts and pending drafts with artifact rows, search and a native GET select/Apply filter. Attributed retained records lead before an account exists and stay visible alongside saved accounts. Real retained images appear beside their work; the first retained image leads the preview in a bounded, complete frame while later records stay compact. Absent media produces no visual placeholder. Owner-written context leads that preview; a paginated Retained records view includes imported and selected records, and search preserves its query across pages. An eligible private record opens its cited-story form. First-use actions use the shared Button classes: one primary next step, an outline import action, and outline actions when Review already has the primary step. Missing-record branches use the shared EmptyState and do not repeat the same notice. |
| Local capture | `apps/leaf/src/capturePage.ts` and `public/capture.css` give Work a private local-page recorder. A real recorded MP4 and screenshot lead the populated page; an empty capture page offers one URL form. The still and clip enter one Review decision, stay private when promoted, and require a separate public video selection. An opt-in MCP agent can inspect and record one pinned local origin in its own browser. The page uses shared night workspace controls, and the local capture endpoint requires loopback access. |
| Workflow and Sources | `apps/leaf/workflow-ui/app.tsx` consumes the shared header, Button, Input, Label and Field for repository details and Rhythm rows, Radix Tabs, token-styled Radix Select for cadence/day and Radix Checkbox for source authorization/quiet hours. `overview.tsx` shows one linked account from the canonical private Leaf or one attributed retained Leaflet, including when no source is active; the complete account remains on its detail page. A broken Leaf receives an unavailable state rather than first-run setup. Collection and source controls recede beside or below the work. The one review count links to `/review` without a second empty-record action; accepted legacy packets retain their existing save path. `connections.tsx` uses shared ActionList/ActionRow for provider choices and a shared Retry notice for an unavailable connection status; action results use FeedbackNotice. A failed initial `/workflow/api` read reaches a shared failure notice with Retry, native recovery links and technical detail in a disclosure. Its build includes the shared workspace, controls, action-row and empty-state styles. Sources is a workflow view. |
| Portfolio setup and import | `apps/leaf/src/portfolioSetup.ts` and `portfolioImportPage.ts` use the shared server header and native shared controls. Import errors use FeedbackNotice; the richer import receipt keeps its page-owned counts and review links. An absent Leaf can preview a portfolio without writing, then explicitly create the private record and add sections only to Review. The absent private `/leaf` uses the night workspace and one setup action; setup's private day reader shows authored achievements and a bounded set of retained work without implying publication. |
| Leaf native documents and assistant | `apps/leaf/src/render.ts` supplies the shared application shell to private routes, including the owner leaflet. `/leaf/story` uses a single-column, evidence-bound form with native shared controls and Work navigation. Review shows compact draft rows, opens evidence and decision fields on demand, and keeps its native find context through decisions. An opened image candidate shows its complete frame before source, date and decision; other cited sources and captured media keep their existing order beside the decision on wide screens. Remaining evidence follows, while imported snapshots keep their complete disclosure before one decision form and no early shortcut. These use native forms, disclosures and shared control classes, without a new primitive. `/publish` separates shared, withheld, proposed and private records and links rows to their actual private record with a record-specific accessible name. Achievement History shows the before/current comparison, requires acknowledgement before an entire-achievement restore and retains the replaced version in history; the save behavior has deterministic coverage, while browser submission remains open. `journeyWorkspace.ts` places the selected saved account and sources cited by its featured statement above Scarlet's message form; a separate disclosure names the full journey context transferred on submit. The ready composer uses the shared native Button and Textarea, while pending revisions still precede it. `scarletWorkspace.ts` uses native shared controls and `scarlet.css`; without a configured model, the setup action leads and real records remain browsable without an inert Ask form. `/scarlet/setup` selects an installed local model after an explicit probe. |
| Canopy local management | `renderManage.ts`, `renderAssessment.ts`, `renderHostedBridge.ts` use the common private shell or its adapter; local publication and hosting messages use FeedbackNotice while assessment retains its own recovery action. `manage.css` owns composition. The prepared private preview uses the shared day reader with package-owned portfolio CSS and checked enhancement served by the manager. Released assessment reading remains day. |
| Canopy Hosting | `apps/canopy/workspace-ui/app.tsx` consumes shared React controls, Field, header, Radix Tabs, FeedbackNotice and AlertDialog for withdrawal. The dialog retains the exact-ID server confirmation. Rejected Prepare submissions reopen that tab and reload the attempted portfolio inclusion scope from current source and policy state. This local publishing UI is distinct from hosted runtime acceptance. |
| Canopy hosted management and recruiting | `apps/canopy/src/hostedShell.ts` and `public/hosted-workspace.css` apply shared night workspace/control styling to hosted route code. Provider-backed states and live operation remain unaccepted. |
| Historical Photosynthesis Review | `apps/photosynthesis/src/renderReview.ts` and `public/review.css` render only the legacy standalone harvest; the current garden queue is Leaf `/review`. |
| Enterprise | `apps/enterprise/src/renderCompany.ts` and `public/enterprise.css` use the shared private workspace and controls styling for organization chart, releases, members and associated pages. Native behavior remains native. |
| Portfolio readers | `@foliage/ui/portfolio`, `portfolio-leaf` and their styles retain the actual record/evidence rendering and optional leaf enhancement. An absent body leaves evidence first on public and owner leaflets; owner pages retain the night shell. Static Leaf export writes one linked detail page per admitted Leaflet with its recorded body and refs. Hosted Canopy's desktop branching timeline gives each selected image or demo the reading width; text-only records stay compact. Canopy's live published detail route reads the active publication and returns 404 after removal or withdrawal. |
| Website and prototypes | `apps/www` retains the day website, token theme bridge, shared controls and purposeful BlurFade. The individual prototype composes `@foliage/ui` Button, Field, Label, Input and Textarea rather than introducing a prototype control. Radix Slot lets the Button styling wrap the native file-input label and the Start link without changing their HTML behavior; the file is read in the browser. Product-scene screenshot links follow the image actually displayed at the responsive breakpoint; Start omits the restricted Canopy preview when no public app address is configured. The individual prototype address and public footer now lead to dated, unpublished local app captures on Start, mostly from October with one filled September editor; the other no-index prototype pages remain separate from connected application routes. |

`@foliage/ui/field` groups an existing `Label` with an `Input`, `Textarea`, native select or Radix Select. The
label's `htmlFor` and the control's `id` remain explicit so the same form semantics work
without the layout component. Field spacing lives in shared `controls.css`; each application
still owns where its form sits on the page. `@foliage/ui/textarea` also powers the native
server-rendered `ui.textarea` facade. The portfolio importer now uses the same control
surface for multiline text and a native `Input type="file"`; its page CSS keeps only the
form's placement and height. File reading remains local to the import page.

Component styles have distinct ownership. The older token CSS uses `.fol-tabs` for a
static tab list and `.fol-label` for a metadata label; React Tabs use `.fol-tabset` and
React form labels use `.fol-form-label`. A test rejects any shared-control selector
that reclaims a class owned by token CSS. This prevents a component from silently
changing another screen's border, overflow or typography.

Do not invent a UI component. New controls must come from a human-made component
library, such as the vendored shadcn/ui registry or Radix primitives. Record the
upstream component and version in `packages/ui/PROVENANCE.md`, and adapt its behavior
and visual recipe to Foliage tokens. Server-rendered markup follows the same
library recipe. When the library has no suitable component, compose existing
library components or refine an existing surface without creating another control.
This composition pass adds no shared primitive: it reuses the already attributed
shadcn Button, Input, Label and Textarea recipes, Field spacing, Radix Slot, and
native file input, form and disclosure behavior. Page CSS places the work, evidence
and decisions; it does not define another interaction system.

The package exports Radix `ToggleGroup` in `packages/ui/src/toggle-group.tsx` and `Select` in
`packages/ui/src/select.tsx`. This checkout's Work page does not consume `ToggleGroup`; the sibling implementation's filter-island claim must not be
copied here. Shared styling also does not mean every native application control uses Radix.

## Provenance and compatibility

The original website/shared-control import came from `codex/customer-journeys` at
`89686bdc7300133f334a3dbba7b0b699c93b611b`; the static facade and notice came from
`codex/streamlined-journey` at `efe5a0a987da84fc3035d1eb8aa2be493aea03aa`.
These identify lineage, not current acceptance. The website's `components.json` and semantic
bridge remain compatibility configuration. Legacy shadcn radix-nova/new-york adaptations and
Magic UI BlurFade retain their attribution in
[packages/ui/PROVENANCE.md](../packages/ui/PROVENANCE.md). Do not erase that provenance when
using Radix directly, or prescribe website-local shadcn setup as the application foundation.
Use package exports rather than copying controls into another application.

## Component and theme contract

Load package token primitives, roles and foundational component CSS before shared controls,
workspace and page composition. The website theme bridge maps its semantic variables to the
same token authority; nested bridge surfaces need their explicit theme binding.
Private workspaces use night, published documents use day, and no preference toggle is offered.
The current compact control/panel/sheet roles replace the earlier broad leaf-shape treatment.
Opposing panel/tip curves remain selective in portfolio reading. Shared chrome geometry lives
in `workspace.css`; a page stylesheet must not recreate the rail or header.

Fonts are self-hosted. Keep visible focus, mono tabular metrics, restrained accent use and strong
control edges. Interface text is not underlined. Use flat grounds and borders without shadows,
bounce, spin or ranking effects. Measure contrast on the actual surface and state; do not claim
blanket accessibility conformance. Static routes retain their no-script behavior and CSP contract.
Shared open-plane UI must not import cloud or enterprise code.

## Living portfolio contract

The leaf renderer enhances existing readable records; it does not fetch evidence or decide which
records may appear. Actual artifacts and accounts remain useful without JavaScript or WebGL.
Attribution states are unordered; no importance score is calculated. Evidence disclosures stay
beside the relevant account, and missing media has an explicit fallback.

Private curation and date enrichment remain private. Public reading receives admitted material,
not private curation or edit history. Presentation options operate through existing token roles
and authorized domain operations; a style change does not select an asset or expand publication.
The style-history and immediate-undo mechanisms are presentation behavior, not proof of autonomous
account maintenance or approval. Publication remains a separate owner decision.

The optional `pnpm --filter @foliage/ui portfolio:build` browser enhancement has a source/style
receipt. Native serving, static export and hosted packaging must carry a valid matching artifact
or retain the readable fallback. It is not a product server build or `dist/` directory.

## Remaining verification

`pnpm check` remains the deterministic repository gate. The website additionally has its own
build and lint commands; neither gate accepts the visual result or a connected provider journey.
Review actual routes, populated/empty/error and recovery states, keyboard behavior, phone/tablet/
desktop viewports, reduced motion, measured contrast, CSP and network resources against the
screen checklist. Current browser evidence must identify this exact candidate and runtime.
Configured provider, account isolation, publish/replace/withdraw and participant outcomes remain
separate gates. Use the current candidate receipt and CI result when claiming a tested state;
this document alone is not an acceptance result.
