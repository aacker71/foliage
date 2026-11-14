# Local release candidate · 7 October 2026

The `/start` download points to the open local runtime built from committed
source `30bddbf2d3a53b3885ac56edb429cdb188559507` (merged PRs #163 and
#141). This release restores the separately opt-in private brain MCP tools and
the private Reflection page while keeping legacy journey permissions inert
until the owner re-consents. The repository release is v0.2.0.0; the installable
runtime uses package version 0.2.0. It does not replace the owner's running
development checkout or enable hosted Canopy accounts.

| Field | Observed value |
|---|---|
| Archive | `foliage-local-0.2.0-darwin-arm64-30bddbf.tgz` |
| Size | 17,028,402 bytes |
| SHA-256 | `21885eb57a0ab8cbb36097c1720b916ffa84806d5154bf5495ef783abad86785` |
| Manifest | schema 1, 5,135 files, clean source revision above, macOS arm64 |

`pnpm run build:bundles` and `node tools/deploy/package-local.mjs` produced the
archive from a clean checkout. Its sole top-level directory is `runtime/`; it
contains no `.env`, `.git`, garden, website, closed Canopy, AppleDouble, or
`.DS_Store` path. The archive extracted and installed into a new directory.
`verifyRuntime` checked the extracted and installed copies against every file
in the manifest. The release tree's full `pnpm check` passed 2,528 tests.
The packaged runtime was extracted and installed without enabling sources or
a background service.

An upgrade round trip using the prior runtime's real workflow writer preserved
its saved grants, admissions, attempt, and Jev receipt as history. The new
runtime made no provider call during the upgrade, and explicit renewal granted
only the current, narrower permission. This is protocol compatibility evidence,
not a claim about model quality or customer acceptance.

The website release-metadata test hashes the bundled archive bytes. The
previous `e9c0bef` archive remains available beside this one for rollback.
Public Vercel deployment and downloaded-byte verification are recorded
separately after promotion. The package requires Node 22.18–24 and manual
installation; it is not a signed native Mac app.
