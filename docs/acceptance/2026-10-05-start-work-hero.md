# Start Work hero receipt — 5 October 2026

The `/start` hero now shows the private Work screen rather than a single pending Git leaflet. Its source is the existing [Work first-fold capture](2026-10-05-work-record-first.md): a disposable local Leaf assembled from 997 actual Foliage Git commits. Four retained source records are visible with Open and Tell story actions. The Leaf had no authored achievement, verified outcome, customer work, or publication. The available filled editor capture is agent-authored and not owner-approved, so it was not used as the hero.

The responsive `record-source.jpg` and `record-mobile.jpg` assets are byte-for-byte copies of that receipt's 1280 × 900 and 375 × 812 captures. [Asset provenance](../../apps/www/public/product/PROVENANCE.md) records the source and limits. The image is cropped only by the Start page frame; the source pixels are unchanged.

In a local production build at `http://127.0.0.1:4466/start`, gstack `/browse` checked true 375px and 1280px viewports. The browser selected `record-mobile.jpg` at 375 and `record-source.jpg` at 1280; both completed with their expected natural dimensions. On the phone, token-based compact spacing and two side-by-side actions moved the image frame from y=659 to y=531. Its CSS crop now begins at the retained-work rows, leaving both 58px-high actions visible above it. The source image is unchanged. `documentElement.scrollWidth` stayed at or below `innerWidth`, the View app screenshots link had a matching `#scenes` target, and a fresh-tab console error array was empty. The screenshots below came from one owned gstack Chromium tab at native viewport sizes after Aside's emulated screenshot produced a tiled capture; the tab and local server were closed after the pass.

- [Start phone, 375 × 812](screenshots/2026-10-05-start-work-hero-375.jpg)
- [Start desktop, 1280 × 900](screenshots/2026-10-05-start-work-hero-1280.jpg)

The hero shows retained work, not a completed owner-authored account. A real approved journey and outside-builder outcome remain open launch checks.
