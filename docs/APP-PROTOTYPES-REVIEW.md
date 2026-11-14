# Application prototypes — 2026-09-05

Five interactive interfaces are running at http://127.0.0.1:4189/prototypes from local branch `codex/app-prototypes`, checkout `/private/tmp/foliage-app-prototypes`. These are UI prototypes with honest empty states, not connected production applications.

| Application | Route | Sections reviewed |
|---|---|---|
| Individual | `/prototypes/individual` | My Leaf, Review, Sources |
| Portfolio Hosting | `/prototypes/hosting` | Publications, Prepare, Activity |
| Recruiter | `/prototypes/recruiter` | Shared portfolios, Open a link, Reading guide |
| Organization | `/prototypes/organization` | Structure, Releases, Members |
| Individual Enterprise | `/prototypes/member` | My work, Policy, Takeout |

## Implementation

The interfaces render local Foliage-adapted shadcn Button, Tabs, Input and Label, alongside Magic UI BlurFade. Tabs preserve Radix navigation semantics. The theme bridge references `@foliage/tokens`. Private workspaces use night; the public recruiter reading surface and hub use day. No portfolio examples, accounts or results are seeded.

File selection displays local filename and size only. The recruiter form checks URL syntax and offers a link to the original destination; it does not fetch or evaluate it. Other service-dependent workflows show explicit unconnected states.

## BrowserClaw review

Themed component follow-up: replaced page-specific tab/input styles with the reusable shadcn adaptations. BrowserClaw confirmed named labels, tab switching and invalid URL feedback. Input text/background contrast measured 14.23:1 on day and 15.35:1 on night. The day input focus was a solid 2px foreground outline with no box shadow. At actual 375px width both input surfaces had no horizontal overflow; desktop day input and tab heights measured 50px. Production build and full repository check passed again (1,547 tests). This verifies the shared prototype controls, not a migration of the other application runtimes.

- Reviewed every application at actual 375px mobile width and 1440px desktop width. Read back the viewport and mobile media query; no horizontal overflow was observed.
- Exercised all 15 sections after fixing a crash caused by evaluating outgoing tab content against the newly selected tab.
- Checked primary section navigation, keyboard arrow navigation, malformed URL feedback and a valid URL result with the expected destination.
- Inspected mobile and desktop screenshots for all five applications. Reduced oversized workspace headings and removed implementation details from the main sidebar copy.
- Emulated reduced motion on the hub: readable heading, all five links present, zero running animations.
- Production build passed. Full `pnpm check` passed: 1,547 tests, zero failures or skips. Fixed component provenance comments that incorrectly triggered the egress gate; official links remain in the UI foundation guide.

Screenshot evidence: `~/.gstack/projects/aacker71-foliage/designs/app-prototypes-20260905/screenshots/`, named `<application>-mobile.jpg` and `<application>-desktop.jpg`.

This is a visual and interaction review, not full accessibility or customer-flow acceptance. Authentication, real intake/review, durable publication, company authorization and export enforcement are not connected. Existing application runtime migration remains open in Asana.

## Run again

From this checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @foliage/www build
pnpm --filter @foliage/www start --hostname 127.0.0.1 --port 4189
```

Check that the port is free first. The currently running detached server is recorded in `/tmp/foliage-app-prototypes-server.json`; its log is `/tmp/foliage-app-prototypes.log`. Do not start a second listener over it. The current branch is local and not deployed; the previously observed GitHub email-verification rejection still blocks publishing new commits.

## Extended validation of 5022af9

BrowserClaw exercised all 15 sections using ArrowRight navigation at an actual 320px viewport. Every section rendered its expected heading and document scroll width stayed 320px. The mobile media query was true, reduced motion was enabled, and each app reported zero running animations. Each primary action measured 44px high.

Selected the real repository document `docs/UI-FOUNDATION.md` through the Individual file control. Its displayed filename and byte count matched the browser File metadata. No fetch/XHR resource entries appeared during the check. This validates local metadata display, not parsing or publication.

The recruiter form rejected a JavaScript-scheme URL and a URL containing credentials. A valid local HTTP URL produced the exact expected destination, cleared the error and set aria-invalid to false. No link was opened and no external destination was fetched. Error and success states both remained within the 320px viewport.

No new application defects were found in these checks. No runtime code changed; the preceding successful build and repository gate remain applicable. Full screen-reader testing and live service workflows remain outside this prototype acceptance.
