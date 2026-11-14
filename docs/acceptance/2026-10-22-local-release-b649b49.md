# Local release 0.3.1 · 22 October 2026

The `/start` download points to the one Foliage download built from committed
source `b649b49603a6a41ce81597fefdfa1f1a29a3c4e6`: the 0.3.1 release commit
(`58659be0`, on main `06788656`, which merged #217) plus one fix found while
testing this download. The repository release is v0.3.1.0; the installable
runtime uses package version 0.3.1. It holds the fixes listed under `[0.3.1.0]`
in `CHANGELOG.md`. The 0.3.0 download stays beside it.

| Field | Observed value |
|---|---|
| Archive | `foliage-0.3.1-darwin-arm64-b649b49.tgz` |
| Size | 91,184,333 bytes (87.0 MiB) |
| SHA-256 | `257f2ce164447e2ca9b13450d3f7ea1e075abd45c4895630c483d4eac0e1dd8d` |
| `runtime/release.json` | 5,171 files, version 0.3.1, the source revision above, `workingTree: false`, darwin arm64 |
| `vendor/release.json` | kind `foliage-brain`, 12,853 files, for Foliage 0.3.1, same revision, `workingTree: false` |

`node tools/deploy/package-local.mjs <new folder> --archive` built it from a
clean worktree at that revision, and its own header checks passed. Read back:
its only top-level folders are `runtime/` and `vendor/`; all 20,827 entries
are owned `0`, and the `tar -tv` listing has no `alex`; there is no `.env`,
`.git`, `.github`, `._` or `.DS_Store` path. A search of every extracted text
file found no `Coeadapt`, `Documents/GitHub` or `Handgloves`, and no `/Users/`
in `runtime/`.

On that revision the full `pnpm check` exited 0: 3,028 tests, 3,026 passed,
0 failed, 2 skipped (the opt-in Docker cases). The brain offline gate was
green: items 2 to 6 and 8, 362 sandboxed Foliage and gbrain processes.

## Installed from these bytes

Under `env -i` with a fresh home folder and only `node` (v22.23.1), `/usr/bin`
and `/bin` on `PATH`, following `START-HERE.md`:

- `shasum -a 256` printed the SHA-256 above.
- Extracting left `runtime` and `vendor`; `node install.mjs <new folder>`
  printed "Installed Foliage 0.3.1 with its local brain".
- `grow` of this repository, with `--identity` and `--subject`, gave a leaf of
  1,286 leaflets with 280 drafts to review.
- `brain build` gave "Brain: current"; `brain search` was answered by the
  brain (`retrieval: brain keyword`); `status` said `BRAIN current`.
- `foliage up --port 4233` served `/` and `/review` with 200.

## Found while testing: a large record had no brain

The first 0.3.1 build (`58659be`, not published) failed `brain build` on that
1,286-leaflet record with "gbrain list_pages did not answer in JSON". So does
the published 0.3.0 download, installed from `getfoliage.com` the same way.
`gbrain call` exits before a pipe takes all of a long answer: the list of every
page, about 280 KB, reached Foliage cut off at 98,304 bytes, mid-title. Any
record of more than about 440 pages was affected. `b649b496` lists 100 pages a
time; the same record then built in about 75 s and was searched through the
brain. No automated test reproduces the cut-off: the offline gate's records
are small.

## Not measured

- No browser download, so no quarantine and no Gatekeeper check on these bytes.
- No Finder extraction.
- No approval, export or sharing on this install.
- No second machine.
- The live download on `getfoliage.com/start` is checked after the merge
  deploys, not here.
