# Statement support browser receipt — 5 October 2026

This is local UI evidence for the current statement-support screen after `86390d5`, captured against `63b6eb3`. It is not acceptance of the optional cloud check or of a live owner's record.

The disposable Leaf came from this repository's real Git intake. It retained one pending-attribution Leaflet for commit `b508747a7a610bf6db1a4ca340fe732b440296a6` (“Put exact cited work beside statement support”). The same commit subject was used as the statement and its retained verbatim excerpt, with that exact Git provenance attached as its citation. “Statement support protocol” is a local fixture label, not a person-authored impact claim or verified outcome. The screenshots contain no email address, credential, or private work record.

The Edit portfolio navigation exposes **Cited work** at `/leaf/claim-check`. The selected statement displays one current citation, its pending-attribution state, a link to the owner Leaflet, Git as source, a readable observed date, seven-character reference with the full hash in a disclosure, and the exact excerpt. At true browser widths of 375 and 1280 px, `innerWidth` and `documentElement.scrollWidth` matched, and the 640 px media query changed as expected. The phone page was 1157 px tall; the desktop page fit its 900 px viewport. With no TypeSafe key, neither a transfer form nor the inert “TypeSafe not configured” line appeared. No provider request was made.

- [Phone, 375 × 1157 full page](screenshots/2026-10-05-claim-check-375.png)
- [Desktop, 1280 × 900](screenshots/2026-10-05-claim-check-1280.png)

The functional inspection used gstack `/browse` with one owned Aside tab. Its screenshot path previously tiled emulated widths across a fixed browser surface, so the replacement captures used one owned gstack Chromium tab at native viewports; saved pixel dimensions and image content were inspected, and both tabs were closed. Focused claim-check and authoring tests passed 8/8. Keyboard and screen-reader behavior, the optional TypeSafe operation and response, and live owner data were not retested in this pass.
