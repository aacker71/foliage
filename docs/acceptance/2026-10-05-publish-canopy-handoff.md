# Publish to Canopy handoff · 5 October 2026

The `/publish` page was inspected at true 1280 × 800 and 375 × 812 browser viewports. A disposable Leaf under `/tmp` contained one **private, pending** Leaflet whose title and ref came from real Foliage commit `e95b28a`. This was a presentation check, not an owner publication or a claim that the commit was independently verified.

With an exact loopback `FOLIAGE_CANOPY_MANAGER_ORIGIN` configured, `GET /publish` returned 200 and rendered one **Review in Canopy** link to that origin's manager root. With the origin absent, a second Leaf listener returned 200 and rendered no handoff link. The manager was deliberately not started; the link destination and hosted release flow were not exercised. Both Leaf listeners were confirmed on free local ports before inspection, and no publish or share POST was sent.

At 1280px, `innerWidth`, document width, and body width were all 1280px. At 375px, all three were 375px and the phone media query matched. The link stayed within the first viewport at both widths, measured 44px high, and did not cause horizontal overflow or overlap the retained work row. Focus showed a solid 2px chartreuse outline with 3px offset. The inspected Aside tab reported no console errors.

- [Desktop, 1280px](screenshots/2026-10-05-publish-canopy-handoff-1280.jpg)
- [Phone, 375px](screenshots/2026-10-05-publish-canopy-handoff-375.jpg)
- [Phone focused-link appearance](screenshots/2026-10-05-publish-canopy-handoff-focus-375.jpg)

Aside confirmed the true viewport and focus measurements, but its screenshot raster tiled the page on this machine. The attached correctly sized JPEGs were captured with gstack browse Chromium's viewport screenshot command and visually inspected. This verifies the conditional handoff's layout and read-only behavior only; it does not establish that a configured manager is running or that Canopy publication succeeds.
