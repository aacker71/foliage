# Published portfolio redesign

The published leaf now uses a persistent identity rail and an editorial work column. On narrow screens the identity sits above the work. Artifact order, publication gates, proof labels, redaction and withholding disclosures retain their existing meaning. No biography, employment history, contact details or accomplishments are invented to fill template sections.

Reference: https://github.com/magicuidesign/portfolio at `5ef12e4c8bd0de3e22e89c2181ee77a35925ec8b`. Reviewed its home page, section composition and component inventory. The reference clone lives outside Foliage. No reference content or source was vendored. The redesign borrows the readable hierarchy and restrained entrance concept while retaining Foliage's token system.

Implementation:

- Both live tree projections and frozen published documents use `public/portfolio.css`, loaded after their existing stylesheets. Failure pages keep their existing treatment.
- Live artifacts use the shared shadcn adaptation `ui.link` from `@foliage/ui`. React renders only on the server; no hydration, script or CSP exception was added.
- Source details use native `details`/`summary` and include the recorded observation time. Qualified artifact URLs continue to identify the portfolio owner.
- Section links have real targets. Empty portfolios omit the work link. Counts refer only to the public material already represented by each renderer.
- The entrance follows the Magic UI Blur Fade motion vocabulary using CSS and token easing. Reduced motion suppresses it; printed output avoids split artifact rows.
- Repeated proof badges use neutral ink to keep long portfolios inside the accent budget. The decorative mark comes from the package asset; the small frozen-page mark uses the icon tier.
- The server replaces the package sprite's inline positioning with its shared class to prevent a CSP violation, preserving every symbol and path.

Validation on 2026-09-10 (America/Denver):

- `pnpm check`: 1,664 tests passed; no failures or skips. Boundary, egress, duplicate and type checks passed.
- Browser: desktop 1440×1000; mobile 390×844 and 360×800; no horizontal overflow in checked states.
- Checked real repository evidence using an isolated local copy of `apps/leaf/leaf.json`; publication visibility changes were confined to `/tmp`. The original document and production publication state were not changed.
- Verified the qualified artifact link, source disclosure, live nothing-offered state and frozen empty state produced by the actual publication gate. The existing pending records correctly produce no frozen published claims.
- Reduced-motion media produced `animation-name: none`. All recorded resource requests were same-origin. Final live-page console had no errors after the sprite fix.
- Measured heading/title contrast 15.56:1; secondary text, count labels and disclosure text 6.65:1 against the paper surface.

This is a local implementation, not a deployment. “100x” is a design ambition, not a measured outcome. Richer career narratives need real structured content before they can be displayed.
