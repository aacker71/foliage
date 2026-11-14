# Local runtime release receipts — 2026-09-30

This records Gate 3 packaging against the [release path](../../.loop/MILESTONES.md).
The archive contains the open local runtime. It excludes hosted Canopy, a Node interpreter,
owner data, and configured accounts. It is a Node-based archive, not a signed native app.

## Current public-download candidate

| Field | Exact value |
|---|---|
| Runtime source commit | `c881624947fd57ae642774b7a1325902d701137d` on the integrated release candidate |
| Source state | clean committed tree; `release.json.workingTree` is `false` |
| Build host | macOS arm64, Node `v22.23.1` |
| Runtime version | `0.1.0` |
| Archive | `foliage-local-0.1.0-darwin-arm64-c881624.tgz` |
| Archive bytes | `14,554,602` |
| Archive SHA-256 | `1038c43964f616d9b023c33432b45181f10bedf74eae3896b6d62eba46810fbf` |
| Internal manifest | schema 1; 5,114 file/link entries; revision matches source commit |

The exact archive is staged at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-c881624.tgz` and included in
this website change at `apps/www/public/downloads/foliage-local-0.1.0-darwin-arm64-c881624.tgz`.
Both copies matched the digest above. The source build ran `pnpm run build:bundles`, then
`node tools/deploy/package-local.mjs <new-directory>`. After tar compression and extraction
into another directory, `verifyRuntime` checked every file/link in both extracted and
relocated installed copies. The manifest contains no `.env`, website, or closed Canopy path.
The installed CLI returned `{"state":"no-record","hits":[]}` for a new empty garden without
creating a Leaf. Its local app served `/`, `/review`, `/leaf/photosynthesis`, and `/workflow`
with HTTP 200 from an owned free loopback port. The internal manifest detects changed
files but is not a publisher signature.
From the relocated install, an absent `/leaf` led to `/leaf/setup` without disclosing the
garden path. Submitting the owner's name created an empty private record (303); a repeat
submission was refused without overwriting it (409), and the saved Leaf loaded. The open
package's `foliage canopy` command exited 2 with a clear message that Canopy is supplied
separately; it did not try to start closed hosting code.

The website has a checksum-pinned, same-origin `/downloads/...` route and labels the file
as macOS Apple silicon with the Node requirement. A production-mode local Next build and
server returned all 14,554,602 bytes at the route with the matching SHA-256; `/start`
showed the Mac download and digest without a localhost workspace link. The website's
`FOLIAGE_DOWNLOAD_*` settings remain a validated all-or-nothing external override.
This archive is the current pilot package: installation still requires Node and a manual
extract/install command. The macOS host has `pkgbuild`, but no code-signing identity is
installed. An unsigned native `.pkg` could be built for a controlled pilot; a public
native installer needs signing and notarization before it is offered as a launch download.
The website imports both token primitives and role aliases before shared controls, so the
download action has its intended visible accent on day surfaces. Browser inspection at
1280px and 375px found no horizontal overflow, underlined interface links, or console errors.
The archive adds about 14.5 MB of binary data to Git history. That is a concrete cost of
serving this first candidate from the site; future release storage can move to a public
artifact host without making the private GitHub repository's Releases page a dependency.

**Still open:** land and deploy the reviewed candidate, then verify anonymous production
`/start` and downloaded bytes and complete outside-builder installation plus live
publication/withdrawal acceptance. A private GitHub Release asset is not an anonymous
website download. Vercel Preview for this private project redirects anonymous visitors
to Vercel login, including a direct `/downloads/...` request, so it cannot establish public
access. Local packaging, a website preview, or a green CI gate alone does not
establish the first public pilot.

## Earlier diagnostic archives

The superseded clean `31a114c8bb810d8b9e3e77b9f88ccb49b50a56f0` archive is preserved at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-31a114c.tgz` (14,556,674 bytes,
SHA-256 `857a13ad46e4317aa36320ff226e0f0cd7d28cb66a02d1cbda9d255f1c24cb36`).
Its relocation, empty-garden search, local boot, and prior website download check passed.
First-run Portfolio and Canopy launcher corrections superseded those bytes. Do not link or
distribute this archive as current.

The superseded clean `b28f6eda63f1ea67f3da2d1a43bb41a74ea58811` archive is preserved at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-b28f6ed.tgz` (14,555,794 bytes,
SHA-256 `51926bac2b191488a591f8fcf951716b462db539d17f0eb3e809a10256ae82e1`).
Its extracted and installed manifests, empty-garden search, and local boot passed. The later
selected-work empty-state correction superseded those bytes. Product screenshots were captured
from this app source because the shown routes did not change; see the image provenance note.
Do not link or distribute that archive as current.

The superseded clean `cb517395e3c9889e2614d20b6eca9758e3e9966c` archive is preserved at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-cb51739.tgz` (14,540,716 bytes,
SHA-256 `4ccceeca3ba90307b9633c79ccb779ed9fe466a276ad73fe629e719385a07c7f`).
Its extracted and installed manifests, empty-garden search, and local boot passed. Later
portfolio density, Scarlet first-run, error-state, and Work navigation changes superseded
those bytes. Do not link or distribute it as current.

The superseded clean `1e677e855c98d6dc66cefb8c9ebba24bf94603f5` archive is preserved at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-1e677e8.tgz` (14,543,556 bytes,
SHA-256 `a2106f34337d45982884ca27d7e11556a55e54d2814f5e118ada5aa4177c1753`).
Its extracted and installed manifests, empty-garden search, and local boot passed. Later
Work/review UI changes superseded those bytes. Do not link or distribute it as current.

The earlier clean `105ad0a8a98f2933c7ffa5f8152fe4d9aa5ae772` archive is preserved at
`~/Downloads/foliage-local-0.1.0-darwin-arm64-105ad0a.tgz` (14,536,963 bytes,
SHA-256 `1378aa1a55c8f9095a18840a2ab6d6cd389bc7942a37a8cc563154504b8fd6c1`).
Its extracted and installed 5,108-entry manifests, empty-garden search, and local boot
passed. Subsequent Workflow shell QA and source-review changes superseded those bytes.
Do not link or distribute that archive as the current installer.
