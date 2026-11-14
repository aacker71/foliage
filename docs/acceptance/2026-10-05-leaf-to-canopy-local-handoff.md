# Leaf to Canopy local handoff · 5 October 2026

The **Review in Canopy** link was followed from Leaf `/publish` into a running local Canopy manager. Both processes used the same disposable Leaf under `/tmp`. Its single **private, pending** Leaflet retained the real title and ref of Foliage Git commit `252582a`; the subject came from that commit's author. No personal garden, hosted account, or existing publication store was used.

Both listeners were confirmed on free loopback ports before launch. Leaf was given the manager's exact `FOLIAGE_CANOPY_MANAGER_ORIGIN`; Canopy used the same `FOLIAGE_LEAF` and a private temporary publication path. HTTP GET returned 200 from both processes. In one owned gstack `/browse` tab, clicking the Leaf link navigated from `/publish` to the manager root on the configured port. The manager showed the same subject, **Ready to publish**, **Will publish 0**, **Stays private 1**, and the typed-ID decision form. The record remained private and the manager state remained `not-published`.

The destination was checked at true 1280 × 800 and 375 × 812 browser viewports. No horizontal overflow or clipped control was observed; the inspected Aside tab reported no console errors. On the phone, **Publish decision** moved the confirmation form into view, with its button at about 504px from the viewport top. The bright **Publish empty leaf** button is the manager's existing action for this zero-admission state; it was **not** pressed. No POST was sent. After the visit, the temporary publication path still did not exist and the Leaflet still had no visibility field, meaning private by default.

- [Manager review, desktop](screenshots/2026-10-05-leaf-to-canopy-local-1280.jpg)
- [Manager review, phone](screenshots/2026-10-05-leaf-to-canopy-local-375.jpg)
- [Phone decision form reached by its navigation link](screenshots/2026-10-05-leaf-to-canopy-decision-375.jpg)
- [Leaf handoff before navigation](2026-10-05-publish-canopy-handoff.md)

Aside verified the live click and responsive layout. Its emulated screenshot raster tiled the page on this machine, so the attached correctly sized JPEGs were captured and visually inspected through gstack browse Chromium. This is a local navigation and review seam, not hosted identity, two-account publication, or release acceptance.
