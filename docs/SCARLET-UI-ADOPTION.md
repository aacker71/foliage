# Scarlet application component adoption

This plan applies the UI foundation contract introduced in `ee5899f` to the existing
server-rendered Scarlet journey. The contextual tools, evidence checks, and page entry points
are implemented using the application's current native links, forms, and controls. This
functional pass does not establish shadcn/ui or Magic UI adoption in the application.

## Complete journey

Review candidate → inspect draft evidence with Scarlet → copy a proposed description → return
to that candidate's existing review form. A candidate keeps its review state; it acquires no
proof tier by entering Scarlet. Leaflet wording and publication tasks use the same workspace,
with record- and policy-specific context.

| Current interaction | Selected component | Acceptance evidence |
|---|---|---|
| Question starters, send, stop, copy | shadcn Button | Keyboard activation, pending/disabled states, 44px target |
| Question input | shadcn Textarea and Label | Required input, retained retry text, read-only during a run |
| Task selection | shadcn navigation controls styled as Tabs | Normal URLs preserved; changing context starts a fresh conversation |
| Source opt-in | shadcn Checkbox and Label | Explicit selection; normal form fallback; no inferred source path |
| Evidence, source excerpts, answer checks | shadcn Collapsible and Alert | Recorded facts remain visible; detailed evidence is expandable |
| Streaming transcript | shadcn ScrollArea | Keyboard scrolling, readable partial/failure states, no forced scroll while reading |
| Optional answer reveal | Magic UI BlurFade, only if it improves comprehension | Whole message remains readable with reduced motion; never animate individual tokens |

## Runtime and shared location

Create an open-plane shared UI package after selecting the browser asset integration.
Website-local components are references, not shared application infrastructure. Import copied
shadcn/Magic UI sources through that package and retain their provenance. Map their variables
to `@foliage/tokens`; preserve surface-selected faces, self-hosted fonts and the accent limit.

The current Leaf runtime executes TypeScript directly and has no build step. React/TSX client
components therefore need an explicit client asset compilation and serving design before
implementation. Keep server execution independent of that client step. Serve browser assets
from the fixed local asset map, with same-origin script/connect permissions limited to the
private Scarlet workspace. Public documents retain their existing CSP and script-free output.
Normal links and form fallbacks must remain available when enhancement cannot load.

## Acceptance and current status

The native functional journey and the server-rendered shadcn slice below are implemented.
No browser asset compilation or Magic UI enhancement is introduced. Component adoption is accepted only
after real, empty, unavailable, stale, interrupted and completed states work through this whole
journey; keyboard and narrow-screen behavior, reduced motion, measured contrast, privacy and
licensing boundaries, and `pnpm check` must be recorded on the actual migrated routes.

## Implementation decision: server rendering (2026-09-05)

Use React's `renderToStaticMarkup` on the server for local shadcn Button, Input, Textarea,
Label, and Alert adaptations in open-plane `@foliage/ui`. Express components with
`createElement` in `.ts` so Node's existing type-stripping runtime executes them directly.
No JSX transform, generated browser bundle, hydration, Tailwind compiler, or new script
permission is required. The component variant classes map to the existing token-backed
`.btn` / `.field` controls. React becomes a declared server dependency; the app can no
longer claim zero runtime dependencies.

Keep native `details`, checkbox, navigation links and scrolling: these retain complete
behavior without hydration. Do not relabel them as migrated Radix components. Scarlet's
existing AG-UI client continues to own streaming and uses a server-rendered template for
its dynamic Copy button. Magic UI motion is omitted from this evidence-reading slice:
there is no transition that needs it, and adding a hydration runtime for decoration would
not help the reader.

Review rows expose title, review state, evidence count, explicit inspection link and the
recorded decision first. Source refs and draft metadata move into a native disclosure;
third-party warnings stay visible. An undecided draft retains its normal decision form.
Owner leaflet details group claim, attribution, evidence and next action. Public documents
retain their existing evidence and publication rules. Scarlet keeps the selected record
and a prominent return link beside the conversation.

## Verified coverage for this slice

| Route / interaction | Implemented | Evidence |
|---|---|---|
| `/review` | Shared Input, Label and decision Buttons; compact rows, native evidence disclosure, explicit Scarlet link | Real owner queue plus a fresh harvest of real repository commits; 360px and 1440px; native missing-reason submission refused without a write |
| `/my/leaflet/<id>` | Shared inspection action; separate wording action, recorded content and source evidence; readable narrow privacy header | Real leaflet, 360px without horizontal overflow, both action targets 44px; zero scripts |
| `/scarlet/workspace` | Shared search/question/action controls, return link and templated dynamic Copy/Alert | Real local-model answer completed; known citation links and checks rendered; exact Review anchor reached |
| Missing model / record / search matches | Recorded material remains readable, send disabled, cause displayed | Browser checked all three states |
| Stale context and interrupted stream | Existing safeguards retained | Repository tests passed; earlier Stop/retry browser evidence predates this component slice |
| Native disclosures, checkbox, task navigation and transcript scrolling | Retained, not a Radix migration | Normal links/forms, explicit source opt-in, focusable transcript; no hydration |
| Magic UI | Not used | No animation needed for this reading workflow |

`pnpm check`: 1,586 tests passed, zero failed/skipped, with boundary, egress, duplication,
findings and type gates passing. New shared-control tests exercise hostile text escaping
and native form/navigation attributes. The existing review test now checks each control's
attributes independent of serialization order, because React emits `name` after `value`.

Browser measurements: viewport readback 360px with narrow media query true and document
width 360px; 1440px forms align all three inputs at the same vertical position, with actions
below. Question → Tab focuses Send with a 2px solid outline. Reduced-motion readback true,
zero active animations. Computed primary/secondary text contrast on the night background:
16.36:1 and 7.73:1. The Scarlet resource list contained no remote origins.

Limits: the clipboard write itself was not exercised; the rendered Copy button and its
unchanged clipboard handler were inspected. Native form refusal was submitted using browser
`requestSubmit` after coordinate input proved unreliable under device emulation. No real
owner review decision, leaflet, policy or publication was changed. Answer checks remain
literal-data/citation checks, not factual validation. This is one application journey,
not application-wide migration or a completed full-site design audit.
