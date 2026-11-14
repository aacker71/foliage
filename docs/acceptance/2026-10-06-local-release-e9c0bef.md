# Local release candidate · 6 October 2026

The `/start` download now points at the open local runtime built from committed source
`e9c0bef748d94eacb67badbe479995b7711adc57` (PR #161 plus the keyboard focus
fix, stacked on #126). It includes the work-first Workflow and cited Scarlet context. The hosted Canopy service
and private owner garden are outside this archive.

| Field | Observed value |
|---|---|
| Archive | `foliage-local-0.1.0-darwin-arm64-e9c0bef.tgz` |
| Size | 17,261,752 bytes |
| SHA-256 | `9e32136bbf49af7319cda532e6ad2887fd76f519545914166ec3ef40c32742d4` |
| Manifest | schema 1, 5,132 entries, clean source revision above, macOS arm64 |

`pnpm run build:bundles` and `node tools/deploy/package-local.mjs` produced the
archive from the clean source checkout. The archive extracted and installed into a
new directory; `verifyRuntime` checked the relocated installation against every
manifest entry. Archive inspection found no `.env`, `.git`, garden, website, or closed
Canopy path. With a new empty garden, the installed app returned 200 for Overview,
Workflow, Review, and Work. Scarlet correctly returned 409 while no Leaf existed.
The owned loopback listener was stopped after the check.

The website's release-metadata test, lint, and production build passed. A local
production server returned 200 for `/start` and the linked archive; browser-side
SHA-256 of its 17,261,752 response bytes matched the digest above. This verifies the
packaged app and local website handoff.

A website-only source snapshot at `87402be` (133 staged files, no Leaf or closed
Canopy source) was deployed to Vercel as `dpl_HtGUMjGzejf8QawkC8fH2VHwoKra`.
Its isolated production URL loaded `/start`, then the exact deployment was
promoted to `getfoliage.com`. Vercel inspection resolved the public domain to
that deployment. In Aside, the public `/start` returned the archive's full
17,261,752 bytes with the SHA-256 above; no hosted sign-in was exposed. The
Individual prototype loaded without uncaught browser errors. The previous
website deployment `dpl_BmLTQibc3r8Nfzn5HAkgL4rPGAxa` is the rollback target.

This is a side-by-side upgrade from the previously public `c881624` local
archive, with the same core Leaf and Harvest parsers. It is not a replacement
for the owner's separate live development checkout, whose brain and maintenance
contracts differ. Outside-builder installation remains open. The archive
requires Node 22.18–24 and manual installation; it is not the unsigned native
Mac candidate or a connected hosted account. Canopy's production service still
refuses requests while its production identity and storage settings are absent.
