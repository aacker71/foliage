# Public website production receipt — 2026-10-01

This receipt covers the website and pilot download, not hosted account or publication
acceptance. [PR #100](https://github.com/aacker71/foliage/pull/100) merged to `main` as
`a8e95ebd32a660c109a8f982c5f1897198f30a45`. Its Linux and macOS checks, boundary gate,
and both Vercel builds passed. The integrated local `pnpm check` passed 2,415 tests with no
failures or skips.

In gstack Aside, the public [homepage](https://getfoliage.com/) and
[start page](https://getfoliage.com/start) rendered at true 375px and 1280px. The new hero,
four real product scenes, unpublished-example attribution label and Mac archive link were
visible. Scene switching worked; all ten source/mobile product PNGs returned anonymous 200.
Neither viewport showed document overflow, broken visible images or console errors.

An anonymous cookie-free production request to the same-origin download returned HTTP 200,
14,554,602 bytes and SHA-256
`1038c43964f616d9b023c33432b45181f10bedf74eae3896b6d62eba46810fbf`, matching
the [package receipt](2026-09-30-local-package-candidate.md). The archive's runtime source
is `c881624947fd57ae642774b7a1325902d701137d`. It contains the open local app, requires
Node 22.18–24 and manual extraction, and excludes the closed Canopy publication companion.

Still open: outside-builder installation, a separately configured Canopy path, two-account
sign-in/isolation, hosted publication and withdrawal across every public surface, backup and
restore, external private-agent provider access, and a signed/notarized native installer.
No private owner record was uploaded or published for this website check.
