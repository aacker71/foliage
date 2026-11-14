# Product scene refresh · 5 October 2026

The website's Work and Import assets byte-match their 3 October local captures. Reader now uses the 5 October public Canopy reading rehearsal; the home and Start record image uses the 3 October private owner Leaflet. All eight public JPEGs byte-match their files in `docs/acceptance/screenshots/`. The September editor remains dated in its caption because no newer filled account capture is available.

The Leaflet is a pending Git-derived source record, not an authored achievement. The reader image is a temporary local publication of two pending Git-derived Leaflets, not a hosted or owner-approved portfolio. `PROVENANCE.md` records each source and its limits. The page frames the original captures for composition; its full screenshot links expose the unedited files.

| Production website capture | Desktop | Phone |
|---|---|---|
| Home first viewport | [1280 × 800](screenshots/2026-10-05-home-1280.png) | [375 × 812](screenshots/2026-10-05-home-375.png) |
| Start first viewport | [1280 × 800](screenshots/2026-10-05-start-1280.png) | [375 × 812](screenshots/2026-10-05-start-375.png) |
| Selected Reader scene | [1152 × 689](screenshots/2026-10-05-reader-1280.png) | [335 × 833](screenshots/2026-10-05-reader-375.png) |

Captured from a local production build with gstack `/browse`. Browser readings confirmed `innerWidth` 1280 and 375, the correct phone media query, and no horizontal overflow. Home and Start loaded without console errors; Reader could be selected at both widths. The production pages had no Next development badge. Aside's screenshot export tiled the viewport, so the attached pixels came from gstack's Chromium browser after the Aside check.

The later Reader replacement was checked again from a verified local production listener at true 1280px and 375px. The 375 × 1100 source capture includes both complete cards, their Evidence/Pending rows and both Read leaflet actions; the website frames them without cutting an action. `/canopy` and `/start` Reader rendered with no horizontal overflow or console errors. The full-screenshot link returned the same source image as the visible phone scene. The local publication was disposable and is not a hosted owner portfolio.

`pnpm --filter @foliage/www build`, `lint`, and `typecheck` passed. The Impeccable detector returned `[]` for the changed website UI files. This verifies the dated local marketing scene, not a live account, owner approval, or hosted publication.
