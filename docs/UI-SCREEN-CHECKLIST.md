# UI screen checklist

The [UI definition of done](UI-DEFINITION-OF-DONE.md) is the acceptance standard for every
application and the public website. This inventory reconciles current local source adoption;
it is not a browser acceptance record. All rows remain **In progress** until exact candidate,
state and reviewer evidence is recorded. The older preview contains its foundation only;
subsequent local integration has not been deployed or accepted by historical screenshots.

| Group | Implemented source / routes to review | Current boundary and open acceptance |
|---|---|---|
| Personal work | Leaf `/leaf/photosynthesis`, `/leaf/story`; saved account and draft destinations | Shared shell, saved accounts and a compact attributed-record preview implemented. Eligible records open an evidence-bound private story form. The [pilot screen receipt](acceptance/2026-10-01-pilot-ui-screens.md) covers Work/story at phone and desktop widths and native retained-record search and pagination at phone width. The single account action was checked at both widths on real Git-derived work; retained media, keyboard behavior, and the full populated/empty/error/return matrix still need review. |
| Personal operations | Sources `/workflow` with its Overview, Sources and Collection views; `/leaf/import`; `/leaf/setup` | Shared React Tabs, Select and Field in Workflow and native setup/import controls implemented. A failed Sources status read and Retry have a bounded phone check. A malformed-document `/workflow/api` 503 and bounded Retry have an HTTP/test seam; the rendered failure panel also has a true-width phone capture. First-use Import has a read-only preview, explicit private-record creation and a real-doc browser receipt. The [file-choice receipt](acceptance/2026-10-05-import-file-picker.md) covers local file population at phone and desktop widths and a working paste preview without JavaScript; connected source setup, retained input and broader keyboard/state coverage remain open. |
| Personal native documents | `/leaf`, `/review`, `/policy`, `/publish`, leaflet details and achievement History; shared `render.ts` | Shared private application shell and reader integration exist. Home (`/`, formerly titled Overview) populated/first-use, Review, Policy, Harvest, owner leaflet, Publish preview, History restore review and static export have bounded true-width receipts. The [Policy rule reading](acceptance/2026-10-05-policy-rule-reading.md) checks shipped default rules; the [Leaf-to-Canopy handoff](acceptance/2026-10-05-leaf-to-canopy-local-handoff.md) checks read-only local navigation into the publication manager. History acknowledgement was keyboard-focused but Restore was not submitted in browser; deterministic refusal/replacement checks are separate. Decision/submission recovery, configured policy states and end-to-end navigation still need current evidence. |
| Local assistant | `/scarlet`, `/scarlet/setup`, `/scarlet/workspace`; `scarletPage.ts`, `scarletSetupPage.ts`, `scarletWorkspace.ts` | Script-free first-run model selection, shared shell/native controls and work/evidence context implemented. The no-model Photosynthesis workspace has a populated phone/desktop receipt and keeps Ask unavailable. A [bounded local-model pilot](acceptance/2026-10-05-local-model-pilot.md) checked one real Git patch at 375px: an uncited answer was flagged, and a second model produced a cited answer. Provider installation, streaming/error/recovery and broader configured outcomes remain open. UI calls this Photosynthesis; cloud Scarlet is separate. |
| Historical standalone Review | Photosynthesis app `/`; `renderReview.ts` | This legacy-format, direct-source server is outside the local installer; the installed queue is Leaf `/review`. A bounded real-history QA pass found usable keyboard focus and phone fit, but terminal decisions require hand-editing JSON to correct, evidence refs cannot be opened in the UI, and empty/error states need recovery. A redirect would strand legacy documents because the formats differ; any retirement needs a backup-first conversion and renewed owner review. Do not count this route as the installed review journey. |
| Hosting, local | Canopy `/`, `/workspace`, `/hosted`, `/hosted/preview`, `/ladybug` | Shared shell, native management, React Hosting Tabs and exact-ID AlertDialog/Field implemented. The prepared local reader has an explicit private-preview mode, a work-first publish decision, and the package-owned portfolio assets needed to match the outward layout. It has no links to an absent or older public leaflet. Rejected stale Prepare submission has a bounded phone recovery check; connected replacement, withdrawal, assessments and other returned/error states need broader review. |
| Hosting, hosted | `/manage`, `/manage/sources/connect`, `/settings/notifications`, account routes; `hostedShell.ts` | Shared night shell implemented in local route code. The hosted publication preview now puts its decision and consequence inside the reading frame before Review details, with a delivered CSP/form test. A [bounded unconfigured-state check](acceptance/2026-10-05-hosted-unavailable.md) covers a responsive 503 with Retry while machine routes stay plain. Configured identity, isolation, provider/state coverage and live runtime acceptance remain open. |
| Recruiter | Hosted `/recruiting` and admitted shared portfolio reading | Recruiting shell implemented; actual authorized data, evidence/return journey and reader/provider acceptance remain open. Prototype route does not substitute for this journey. |
| Organization | Enterprise `/`, `/releases`, `/members` and associated pages; `renderCompany.ts` | Shared shell/control styling implemented. A [bounded empty-state pass](acceptance/2026-10-05-enterprise-empty.md) covers file-backed zero-organization, member and release views and the unconfigured recovery step at phone and desktop widths. Populated structure, release/member details, permissions and connected recovery still need browser evidence. |
| Member | Personal work/policy/takeout and enterprise member-facing journeys | Required group remains in scope; shell adoption does not complete its connected journey or prove authorization behavior. Resolve route/state coverage against actual routers before acceptance. |
| Public readers | Leaf/Canopy published portfolio, leaflet, Tree and released assessment renderers | Day reading and optional living-leaf enhancement exist. Static export index/detail and Canopy publication-qualified leaflet have true-width receipts; unknown/withdrawn Canopy detail returns 404. The [Canopy public reading pass](acceptance/2026-10-05-canopy-public-reading.md) checks empty front door, published work, detail navigation and the no-WebGL fallback at phone and desktop widths. Media, no-script, reduced motion, safe external source URLs, and broader privacy/reader coverage remain open. |
| Website | `apps/www`: `/`, `/photosynthesis`, `/canopy`, `/why-foliage`, `/privacy`, `/start`, `/prototypes` and not-found | Dated local app-scene captures are integrated; the Reader is a temporary local publication rehearsal, not a live owner portfolio. The [current scene receipt](../apps/www/acceptance/2026-10-05-product-scenes.md) covers the October private record and public reader captures at phone and desktop widths; the filled editor remains a dated September capture. The individual prototype is a browser preview, not a redirect to Start. Remaining routes, release-download state and configured delivery still need acceptance on the exact release. |
| Prototype references | `/prototypes` catalog; `/prototypes/individual`, `/prototypes/recruiter`, `/prototypes/organization`, `/prototypes/member` | The catalog groups them under For you and For organizations; there is no hosting preview route. The individual address does not redirect: it is a browser preview that reads a chosen Git log export or text file and saves nothing. The business previews keep a switcher among themselves on purpose (#157); the individual preview has none. All are no-index, and none accepts a connected application journey. |

Route names are application-relative: Leaf, local Canopy, hosted Canopy, Photosynthesis and
Enterprise have different runtime owners. Identify that owner and confirm the listener before
capturing. Shared CSS or a 200 response from another runtime is not evidence for this candidate.

For each row, record real/empty/filtered-empty/error, denied, stale, unavailable and recovery
states; direct links, refresh/Back, keyboard access, responsive viewports, reduced motion,
measured contrast and service boundaries. Mark nonapplicable states with a reason. Work currently
uses a native select/Apply filter; the available ToggleGroup export is not adopted on that route.

No state is marked accepted here. Do not reuse screenshots from other checkouts, fill gaps with
invented work or promote a bounded fix verdict to whole-surface acceptance. Keep current findings
and evidence in the review packet with an exact commit/environment reference, then link the packet
from this inventory. Owner acceptance, provider operation and deployment gates remain separate.

The older [remaining-surface verification](../.impeccable/review/remaining-surface-integration/verification.md)
belongs to a different checkout. Its HTTP matrix and website build/lint are historical
bounded checks, not acceptance for the current integration. Its organization runtime had no
configured manifest, and Sources redirected in an unconfigured project. Populated
organization and source-intake acceptance remain open.

The [pilot screen review](acceptance/2026-10-01-pilot-ui-screens.md) includes real-history
Work, Review and Publish density checks, an isolated import flow, a one-record public reader,
and later Publish, History and Workflow failure true-width captures. The malformed-document
Workflow seam also has HTTP/test coverage; browser keyboard recovery and a successful retry
after file repair remain open. The untested states and connected owner journey remain open.

Finish order for the remaining UI acceptance is: (1) a connected first-run source and configured
local model with a real owner-authored account, (2) the full private Review → Portfolio → Publish
journey including refusal, undo and withdrawal across local and hosted surfaces, (3) keyboard,
reduced-motion, contrast and error/recovery checks for every route/state at phone and desktop
widths, then (4) an outside builder and reader pass on the exact release. The current screenshot
receipt closes none of these connected gates.
