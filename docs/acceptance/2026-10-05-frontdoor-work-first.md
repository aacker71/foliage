# Website front door: real Work in view

Status: local website finish on `codex/pilot-screen-integration-20261001`, based on `e3fa5d900a89ff850094d3b0349aad80d5c17d93`. This is a browser and source receipt, not a hosted release acceptance.

The home page previously opened with a botanical image. At a true 375px viewport, the first screen showed no product work; the first app capture started farther down the page. The home hero now uses the existing, source-linked October 2026 private Work captures. Its phone crop shows the retained-record heading and a real source row in the first viewport. The desktop crop shows the Work surface and a source row. The source images remain unchanged; their origin and limits are recorded in [product image provenance](../../apps/www/public/product/PROVENANCE.md). They show Git-derived Foliage work in a disposable local Leaf, not an owner-approved achievement or a public portfolio.

The individual prototype route and its catalog link now arrive at `/start` without a fragment. That shows the local download, requirements, and the Work capture before the screenshot gallery. A browser visit to `/prototypes/individual` reached `/start` at `scrollY=0`.

| Route | Before, 375px | After, 375px | Before, 1280px | After, 1280px |
| --- | --- | --- | --- | --- |
| `/` | [capture](screenshots/2026-10-05-frontdoor-before-home-375.png) | [capture](screenshots/2026-10-05-frontdoor-after-home-375.png) | [capture](screenshots/2026-10-05-frontdoor-before-home-1280.png) | [capture](screenshots/2026-10-05-frontdoor-after-home-1280.png) |
| `/start` | [capture](screenshots/2026-10-05-frontdoor-before-start-375.png) | [capture](screenshots/2026-10-05-frontdoor-after-start-375.png) | [capture](screenshots/2026-10-05-frontdoor-before-start-1280.png) | [capture](screenshots/2026-10-05-frontdoor-after-start-1280.png) |

Captures used the local Next.js dev server on port 43177 and gstack `/browse` Chromium with `viewport 375x812` and `1280x900`, followed by viewport screenshots. `innerWidth` and the `max-width:640px` media query were checked at each width; document `scrollWidth` equaled the viewport. The final home capture loaded the phone image at 375px natural width and the desktop image at 1280px natural width. A cleared browser console had no errors on the final home reload. `/start` is visually unchanged; its paired captures make the route handoff inspectable.

Follow-up crop check: the first 16rem mobile figure cut through the first retained record's action row at its own lower edge. The final 18rem crop shows the complete “Source record / Open / Tell story” row. At a true 375 × 812 viewport, the image ended at y=759 and its caption at y=802; `scrollWidth` remained 375. The mobile after capture above was replaced with this final state. The small Next.js dev indicator overlaps the caption's left edge in that local capture; it is not part of the product page.

Checks: `pnpm --filter @foliage/www build`, `lint`, and `typecheck` passed. The Impeccable detector returned no findings for the changed website files. This receipt does not verify an outside-user install, publication, or deployed website.
