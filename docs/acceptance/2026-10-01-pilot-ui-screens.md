# Pilot UI screen review — 2026-10-01

This is a bounded screen and interaction receipt for the integrated pilot candidate, not
owner acceptance or a broad launch verdict. It uses disposable local gardens. The Work,
Review and Publish gardens contain records collected from Foliage's real Git history;
their unreviewed drafts are not presented as approved accomplishments. The import check
uses text from the owner's supplied `context/product-thesis.md`. The public-reader fixture
contains one actual Foliage commit in an isolated published artifact, not an owner release.
No customer's work or private owner garden was used.

| Surface | What was checked | Capture |
|---|---|---|
| Work | 893 retained records, 201 drafts, no authored achievements. Source browsing, account editing and import remain available without promoting raw draft titles to a story. True 375px viewport; no horizontal overflow or console error. The large empty area is an honest but unfinished product state until cited story maintenance works. | [Phone](screenshots/2026-10-01-work-mobile.jpg) |
| Review | Earlier capture of 200 drafts grouped in 20-item sections; every draft retains its evidence, decision form and deep link. Invalid decisions reopen the draft with its input. True 375px viewport; no horizontal overflow or console error. The later find continuation is below. | [Phone](screenshots/2026-10-01-review-mobile.jpg) |
| Publish | Earlier capture of 890 retained records with status facets and 20 rows per page, including reasons within native disclosures. True 375px viewport; no horizontal overflow or console error. This is a local policy preview, not a hosted release; the later facet continuation is below. | [Phone](screenshots/2026-10-01-publish-mobile.jpg) |
| First record and import | Created an isolated private Leaf as Alex, previewed two real owner-authored sections, added them to the private review queue, followed the receipt to `/review`, and observed two unreviewed drafts. No browser errors; Review measured 375px layout width at a 375px viewport. The automated seam also covers stale digest, foreign origin, subject mismatch and replay. | [Import preview](screenshots/2026-10-01-import-desktop.jpg) |
| Public single-record reader | One real commit reads beside the moving leaf. Evidence, motion and locate controls worked in browser; singular count and absent Ladybug content rendered correctly. True 375px and 1440px viewports; no horizontal overflow or console error. Publication/withdrawal on a configured hosted account was not exercised. | [Phone](screenshots/2026-10-01-public-reader-mobile.jpg) |
| Canopy withdrawal dialog | A disposable published fixture opened the shared Radix dialog at true 375px and 1440px viewports. The exact-ID submit began disabled, enabled only after typing the ID; Cancel and Escape closed without submitting and restored focus to Withdraw. No horizontal overflow or console error. Desktop title and supporting text measured 15.35:1 and 7.25:1 against the dialog surface. This checked local interaction, not a hosted withdrawal. | [Phone](screenshots/2026-10-01-canopy-withdraw-mobile.jpg) · [Desktop](screenshots/2026-10-01-canopy-withdraw-desktop.jpg) |

## Work to private story continuation

The integrated candidate now shows actual attributed records before an authored achievement
exists and keeps a compact preview alongside saved accounts. Search includes matching retained
records with pagination; Browse records opens the full attributed set rather than the Git-only
source subset. This replaces the count-only Work state above; its older capture remains the before
record. A disposable Leaf derived from Foliage's real Git history held 952 retained Leaflets.
At true 375px and 1440px, Work showed four distinct source titles and offered Tell story
only for eligible private records. Selecting it opened the existing form with one exact
retained reference, four optional account sections, and Work navigation. The phone layout
measured 375 CSS pixels wide with the narrow media query active; both routes reported no
horizontal overflow or console error. [Work phone](screenshots/2026-10-01-work-records-mobile.jpg)
· [Work desktop](screenshots/2026-10-01-work-records-desktop.jpg) ·
[Story phone](screenshots/2026-10-01-work-story-mobile.jpg) ·
[Story desktop](screenshots/2026-10-01-work-story-desktop.jpg).

The retained-record continuation was checked again in the disposable Git garden after
pagination was added. At a true 375px viewport, Browse records showed 20 of 952 attributed
records per page. Next reached a different second page, and a `git` search kept its query
when moving to page two. Both states measured 375 CSS pixels wide without console errors.
[Record search phone](screenshots/2026-10-01-work-record-search-mobile.jpg).

The browser did not submit a story for the owner's record. The local HTTP seam separately
starts with real temporary Git intake, saves explicit protocol prose with a selected citation,
confirms it appears in the private reader and Work, refuses stale/foreign/excluded writes,
and confirms it does not appear in a public reader. The saved account remains private; this
check does not accept Scarlet operation, public publication or an outside builder's story.

## Review and Publish continuation

A newer disposable intake of Foliage's real Git history held 202 unreviewed drafts and 952
attributed retained records. At true 375px and 1440px, Review kept the 202-draft queue count
while finding one later draft by its displayed Git citation. Its evidence and decision form
remained in the result; the search term was present in that form, and the browser reported no
horizontal overflow or console error. An isolated HTTP seam confirmed that a refused or recorded
decision preserves this context, including a retitled record that no longer matches the old
search; the browser did not submit a decision. [Review phone](screenshots/2026-10-01-review-search-mobile.jpg)
· [Evidence and controls](screenshots/2026-10-01-review-detail-mobile.jpg) ·
[Review desktop](screenshots/2026-10-01-review-search-desktop.jpg).

The same garden's local Publish preview separated Proposed from Private and showed all 952
records as Private under the default policy. At true 375px, 20 records appeared per page; the
first row's View record action opened that exact owner's private record. It reported no
horizontal overflow or console error. [Publish phone](screenshots/2026-10-01-publish-private-mobile.jpg).
No review decision or publication was made during this browser check.

## Website Start continuation

The current local production build of `/start` was checked at true 375px and 1440px widths.
The download identifies the macOS archive and Node requirement, while the secondary action
jumps to the app captures. The scene tabs switched between Bring it in and Work. Both widths
reported no horizontal overflow or console errors. These September 2026 captures are labeled
as older local-build screens; they do not represent a live customer session.
[Start phone](screenshots/2026-10-01-website-start-mobile-375.jpg) ·
[Start desktop](screenshots/2026-10-01-website-start-desktop-1440.jpg) ·
[Scenes phone](screenshots/2026-10-01-website-scenes-mobile-375.jpg) ·
[Scenes desktop](screenshots/2026-10-01-website-scenes-desktop-1440.jpg).

The scene's full-screenshot action now opens the same mobile or desktop capture shown
in the responsive picture. A local production build checked all four product routes at
true 375px and 1440px, plus each scene at 375, 640, 641 and 1440px. The visible and
accessibility link count was one in every state; its destination matched the rendered
image, and the scene tabs worked by keyboard. No overflow or console errors appeared.
[Scene phone](screenshots/2026-10-01-website-scene-link-mobile.png) ·
[Scene desktop](screenshots/2026-10-01-website-scene-link-desktop.png).

## Scarlet model setup continuation

In a disposable local garden built from Foliage's Git history, setup was checked at a true
375px viewport. Before discovery, Find installed models was the primary action. Local
discovery returned two actually installed models; their Use actions then preceded a quiet
Refresh models control. The Back link measured 44px high, received keyboard focus with a
visible 2px outline, and did not occupy the full phone width. No horizontal overflow or
console errors appeared. No model was selected or connected during this check.
[Initial phone](screenshots/2026-10-01-scarlet-setup-initial-mobile.jpg) ·
[Discovered phone](screenshots/2026-10-01-scarlet-setup-discovered-mobile.jpg) ·
[Keyboard focus](screenshots/2026-10-01-scarlet-setup-focus-mobile.jpg).

## Sources status recovery

At a true 375px viewport, one intercepted `/sources/api` status request returned 503.
Sources showed Status unavailable with Retry. Activating Retry reached the real local
endpoint and restored Not connected with an enabled Connect action. The recovered
view measured 375 CSS pixels without horizontal overflow or console errors. No
connection action was submitted. [Recovered phone](screenshots/2026-10-01-sources-recovered-mobile.png).

## Canopy Prepare recovery

In a disposable Canopy instance, a true 375px browser view opened Prepare with portfolio
inclusion on. The test changed only that disposable Leaf after the review loaded, then
submitted its stale digest. The 409 response reopened Prepare, kept portfolio inclusion,
cleared the typed confirmation and showed the new authoritative Leaf. The viewport had
no horizontal overflow or console errors. No publication occurred.
[Recovered phone](screenshots/2026-10-01-canopy-prepare-recovery-375.jpg).

## Public leaflet reading

A disposable unlisted, published leaflet derived from a real Git record had no authored
body. At true 375px and 1440px widths, the reader previously showed an empty Body
section before its only evidence. The revised public view omits that empty section,
placing provenance 127px higher on phone and 133px higher on desktop; it had no
horizontal overflow or console errors. The private owner view still names the missing
body, and tests retain body content when it exists. This validates the absent-body
path only, not a full public-reader release.
[Before phone](screenshots/2026-10-01-reader-no-body-before-mobile.jpg) ·
[After phone](screenshots/2026-10-01-reader-no-body-after-mobile.jpg) ·
[After desktop](screenshots/2026-10-01-reader-no-body-after-desktop.jpg).

## 2026-10-03 exported reader and table continuation

An isolated static export selected two actual commits by the same Foliage repository author
and marked only those records public in a disposable Leaf. It is a layout check, not an owner
publication. The reader now places both records under **Shared work** before Attribution;
their pending status remains **Attributed, unverified**. A short Git reference opens its full
source and hash in an Evidence disclosure. The local document path, byte count and read instant
no longer appear in the public footer. At true 375px the first row measured 199px high after
the evidence pass, down from 1,036px before the mobile layout fix. The 375px document had no
horizontal overflow; 1280px measured 1280px page width, and both views had no console errors.
[Reader phone](screenshots/2026-10-03-export-reader-375.jpg) ·
[Reader desktop](screenshots/2026-10-03-export-reader-1280.jpg).

Policy and Harvest used a separate disposable local garden drawn from this repository's Git
history. Their native tables retain headers and accessible roles while each row becomes one
reading block at true 375px. Long policy reasons open under **Why**; Harvest uses a readable
date, source label and reference count. Policy's first row measured 165px on phone and 45px
on desktop; Harvest's measured 116px and 64px. Both phone documents measured 375px wide
without horizontal overflow. The captures show the table region rather than the full page.
[Policy phone](screenshots/2026-10-03-policy-375.jpg) ·
[Harvest phone](screenshots/2026-10-03-harvest-375.jpg) ·
[Policy desktop](screenshots/2026-10-03-policy-1280.jpg) ·
[Harvest desktop](screenshots/2026-10-03-harvest-1280.jpg).

The static export now links each admitted row to a per-leaflet page. A second isolated export
used two actual commits from this repository; at true 375px and 1280px, both index and detail
fit the viewport without horizontal overflow or console errors. The detail carries the
recorded body and its exact evidence reference; index, detail, stylesheet, and linked assets
all answered successfully. A failed asset-copy test checks that a retry cleans up an
incomplete first export. A completed export refuses in-place replacement, preserving its
existing files; after withdrawal, a new destination contains only the current admitted work.
[Index phone](screenshots/2026-10-03-export-index-375.jpg) ·
[Index desktop](screenshots/2026-10-03-export-index-1280.jpg) ·
[Detail phone](screenshots/2026-10-03-export-detail-375.jpg) ·
[Detail desktop](screenshots/2026-10-03-export-detail-1280.jpg).
The bundle does not yet turn a Git hash into a remote repository URL. This check does not
accept a hosted publication, withdrawn address, configured provider or the remaining routes
in the screen checklist.

## 2026-10-03 private workspace continuation

A disposable local Leaf and Harvest made from this repository's real Git history populated the
private screens; a separate missing-document garden checked first use. At native 375 CSS pixels,
Overview, Review, Photosynthesis and the owner leaflet each measured 375px document width with
no horizontal overflow or console errors. At 1280px, the same four screens fit the viewport.
Overview now leads with a direct next action and retained work, while first use presents Connect
a source and Import a portfolio without false counts or CLI instructions. Review uses compact
closed rows and one inline count line; opening a draft preserves its evidence and decision form.
Photosynthesis puts local-model setup before the work list when no model is configured. The
owner leaflet uses the private workspace shell, a readable observed date and a short reference
whose full value remains available in a disclosure.

[Overview populated phone](screenshots/2026-10-03-overview-pop-375.jpg) ·
[Overview first-use phone](screenshots/2026-10-03-overview-empty-375.jpg) ·
[Review phone](screenshots/2026-10-03-review-375.jpg) ·
[Photosynthesis phone](screenshots/2026-10-03-photosynthesis-375.jpg) ·
[Owner leaflet phone](screenshots/2026-10-03-owner-leaflet-375.jpg).
[Overview desktop](screenshots/2026-10-03-overview-pop-1280.jpg) ·
[Review desktop](screenshots/2026-10-03-review-1280.jpg) ·
[Photosynthesis desktop](screenshots/2026-10-03-photosynthesis-1280.jpg) ·
[Owner leaflet desktop](screenshots/2026-10-03-owner-leaflet-1280.jpg).

These screenshots prove layout and navigation with locally generated real source material. They
do not assert that the source author's unpublished work was published or that a local model ran.

First-use Import was also exercised in an isolated missing-Leaf garden with a real repository
document as input. Preview created no record. The named, explicit action created a private Leaf
and one unreviewed candidate, leaving the Leaf with zero published or promoted Leaflets. The
phone and desktop preview fit their true viewports without horizontal overflow.
[Import preview phone](screenshots/2026-10-03-import-first-use-preview-375.jpg) ·
[Import preview desktop](screenshots/2026-10-03-import-first-use-preview-1280.jpg) ·
[Import receipt desktop](screenshots/2026-10-03-import-first-use-receipt-1280.jpg).

An isolated Canopy publication built from this repository's Git history checked the public home,
portfolio, new publication-qualified leaflet detail, and manager at true 375px and 1280px. Each
fit without horizontal overflow or console errors. The public cards link to admitted detail
pages; unknown and withdrawn rows return 404 rather than falling through to a Tree. The home
uses a plain empty Tree state instead of exposing a server variable. The manager shows short
references while preserving their exact IDs for confirmation and inspection. The final public
portfolio capture places work before its collapsed View options. The detail opens its evidence,
shows a short reference, and keeps the full value in a disclosure.
[Canopy home phone](screenshots/2026-10-03-canopy-home-375.jpg) ·
[Public portfolio phone](screenshots/2026-10-03-canopy-leaf-375.jpg) ·
[Public leaflet phone](screenshots/2026-10-03-canopy-detail-375.jpg) ·
[Manager phone](screenshots/2026-10-03-canopy-manager-375.jpg) ·
[Canopy home desktop](screenshots/2026-10-03-canopy-home-1280.jpg) ·
[Public portfolio desktop](screenshots/2026-10-03-canopy-leaf-1280.jpg) ·
[Public leaflet desktop](screenshots/2026-10-03-canopy-detail-1280.jpg).
The current published artifact has a commit reference and observation instant, but no safe
repository URL or work date, so the detail does not invent either one.

## 2026-10-04 Publish, History and Workflow failure continuation

A disposable local garden using this repository's real Git history showed Publish at true
375px and 1280px widths. The preview listed 973 records: two Shared links (one unlisted,
one public) and 971 Private. It reported one public record ready for static export. Both
screens fit without horizontal overflow, console errors or external resource requests.
[Publish phone](screenshots/2026-10-04-publish-375.jpg) ·
[Publish desktop](screenshots/2026-10-04-publish-1280.jpg) ·
[Shared links and closed Command line disclosure](screenshots/2026-10-04-publish-served-375.jpg).
These captures show local preview state and layout; they do not establish a hosted release,
external access, withdrawal or an owner-approved publication.

The History restore review was recaptured at true 375px and 1280px widths. The document
widths were 375px and 1265px, with no console errors. The history entry shows a readable
date, a shortened Git reference with the full value in a disclosure, Before and After, and
the current text that an entire-achievement restore would replace. Keyboard focus reached
the required, initially unchecked replacement acknowledgement with a visible 2px outline.
[History phone](screenshots/2026-10-04-history-restore-375.jpg) ·
[History desktop](screenshots/2026-10-04-history-restore-1280.jpg).
Restore was not submitted in the browser. The deterministic History seam separately confirms
that a request without acknowledgement leaves the document bytes unchanged and that an
acknowledged restore retains the replaced version in history. This is not owner acceptance of
the restored wording or a complete browser recovery check.

A disposable malformed `leaf.json` and `workflow.json` made the real Leaf server answer
`/workflow/api` with 503. The focused UI reader test confirmed that the failure settles with
the server detail, Retry repeats only the same local GET, and a stalled read aborts within its
bound. The failure panel was then inspected in the browser at a true 375px viewport: Retry,
Import a portfolio, Review and a closed Technical details disclosure remained usable and the
document measured 375px without horizontal overflow or page console errors.
[Workflow failure phone](screenshots/2026-10-04-workflow-failure-375.jpg).
The screenshot proves layout and visible recovery controls; keyboard activation and a
successful Retry after fixing the file were not exercised in that browser pass.

The private saved preview used a separate isolated Leaf with 976 actual Foliage Git records.
At true 375px and 1280px, it showed four retained-record rows and Browse records, with no
false empty state, horizontal overflow, console errors or foreign resource requests.
[Saved preview phone](screenshots/2026-10-04-setup-preview-375.jpg) ·
[Saved preview desktop](screenshots/2026-10-04-setup-preview-1280.jpg).
That fixture had no promoted Review item, so its promoted-first ordering was exercised by the
real promotion HTTP seam, not visually accepted by this capture. The preview remains private;
these records were not published.

## 2026-10-05 website handoff

The no-index individual prototype address now redirects to Start's real app scenes. The public
footer leads to those same screenshots rather than the disconnected prototype. Start opens on
Work, using the October 3 private Overview capture of retained records from Foliage's Git
history. Import, the private Canopy publication preview, and Start's leaflet image also use
dated October captures; the filled editor remains a clearly dated September capture. Their
exact source and scope are recorded in `apps/www/public/product/PROVENANCE.md`. On the local
production website, the redirect, selected Work tab and responsive source image were checked
at true 375px and 1280px widths. The Reader tab opened the final Canopy private preview at both
widths. All four images loaded; neither viewport overflowed or reported a console error.
[Website phone](screenshots/2026-10-05-prototype-redirect-375.jpg) ·
[Website desktop](screenshots/2026-10-05-prototype-redirect-1280.jpg).
This verifies the local candidate. The deployed getfoliage.com page still requires a release
and its own inspection.

## 2026-10-05 Canopy private preview

A prepared publication built from Foliage's Git history was opened through the local Canopy
preview renderer at true 375px and 1280px widths. Selected work and its attribution guide
precede the publication decision; its reach warning, Publish and Keep editing sit before the
Review details disclosure. The preview names its private state and offers no public leaflet
links or published date. Neither viewport overflowed or reported a console error.
[Preview phone](screenshots/2026-10-05-hosted-preview-375.jpg) ·
[Preview desktop](screenshots/2026-10-05-hosted-preview-1280.jpg).

Separate HTTP tests confirm that the local manager serves package-owned portfolio CSS and the
checked enhancement bundle, and that the hosted preview's delivered CSP allows its exact
consent-bound form. The hosted bridge was unconfigured for this browser pass. These captures
verify the prepared artifact's local renderer and layout, not hosted authentication,
publication, or withdrawal.

## Shared component integration

The component-system captures below were taken from integrated source `5e1d66b` in
an isolated **empty** garden, separate from the populated pilot checks above. The
Leaf server served that source on a verified free local port. The website used a
local production build. Each phone check used a true 375 CSS-pixel viewport, with
the narrow media query active; `documentElement.scrollWidth` was 375 and the
console had no errors on all five Leaf routes. That captured source passed
`pnpm check` with 2,436 tests, plus the website build and lint.

| Surface | Shared component visible in the integrated screen | Capture |
|---|---|---|
| Work | One shared EmptyState for a missing record, with direct source and import actions instead of a repeated notice. | [Phone](screenshots/2026-10-01-component-work-375.jpg) |
| Workflow | Shared EmptyState leads from an unconnected Overview to Sources. | [Phone](screenshots/2026-10-01-component-workflow-375.jpg) |
| Sources | Seven grouped ActionRows and shared Radix Checkbox in the source flow. The Git row opened its detail form during the browser check. | [Phone](screenshots/2026-10-01-component-sources-375.jpg) |
| Import | Shared Input, native file control and Textarea; the file control measured 46 CSS pixels high. | [Phone](screenshots/2026-10-01-component-import-375.jpg) |
| Setup | Shared native server controls and workspace chrome on the private setup route. | [Phone](screenshots/2026-10-01-component-setup-375.jpg) |
| Website | Shared Radix Tabs in a production build; selecting “Bring it in” changed the selected scene, and the Tabs root had no inherited static-tab border. | [Phone](screenshots/2026-10-01-component-website-375.jpg) |

The visible components have one source in `@foliage/ui`, including the server
facade used by native Leaf pages. The namespaced React selectors also resolve
the older `.fol-tabs` and `.fol-label` collisions; the shared-control tests
guard that boundary. The empty garden is an honest first-run state, not a
substitute for a populated owner journey or a launch acceptance result.
The website's product-scene images remain September 2026 local-build captures;
their labels and provenance now say so. The Start download is a Node-dependent
macOS archive, and the page labels its format and install steps explicitly.

The screenshots are browser pixels, not generated illustrations. The mobile captures were
made with a CDP 375 CSS-pixel device override and `window.innerWidth` plus the narrow-width
media query read back. Aside's screenshot API tiled the native window for some captures;
those were cropped to the top-left 375 CSS-pixel viewport at 2× device scale, with no
content edits. Each capture is tied to its named component branch or the integrated
candidate; the public reader capture is after the integrated removal of the empty
Ladybug panel. The exact integrated source and deterministic gate are recorded in the
candidate pull request.

This does not close [the full screen checklist](../UI-SCREEN-CHECKLIST.md). Real owner
acceptance, keyboard and reduced-motion review across every state, connected Scarlet,
hosted two-account isolation, connected withdrawal and recovery, and an outside builder/reader
test remain open. The later owner-invoked journey suggestion now has review, save,
history and revocation controls, but this Work capture has no authored achievements;
the screen still needs a verified real journey to show. Do not replace that gap with
a fabricated account or an activity feed.
