# Release source and media reconciliation

This follow-on candidate starts at `release/0.3.1-fixes@5d0640dc`, which already
contains `release/0.3.0-rc@85661512`. It does not change the frozen 0.3.0 candidate,
the download pins, the version, the owner garden or the installed runtime.

## Included work

| Existing work | Treatment in this candidate |
| --- | --- |
| #196 demo runtime and #197 app UI | Already inherited through #212; not merged a second time. |
| #210 selected project files | Merged with its stable revisions, atomic Review import and decision-preserving replay. |
| #211 selected PNG/JPEG and Figma exports | Merged with local preview, stripped media, explicit owner labels and optional owner-entered public Dribbble references. |
| #214 candidate-scoped Review image route | Only the local media route, renderer links and its two HTTP boundary tests are carried forward. |
| #215 Review image composition | The image-first layout and mixed image/video order fix are applied from the existing branch. |
| #216 Work image composition | The existing complete lead frame is applied without redesigning the component. |
| #218 Canopy media composition | The existing full reading width for admitted media is applied; this does not publish anything. |

The merge conflict in `render.ts` preserves the release's readable promoted-source
labels and the selected-image branch's explicit owner labels. The imported
snapshots, Git-only drafts and recorded demos retain their established ordering.
The generic Design image entry now defaults to a local image. Only the explicitly
chosen Figma frame entry starts with the owner-labeled Figma export origin.

## Deliberately separate

The live Figma token flow, provider transport, token-help destination and provider
provenance from draft #214 are not included. Its real account acceptance remains
open. No Figma API egress destination or `/sources/figma-preview` endpoint is added.
The Figma row continues to accept an owner-selected local export only.

#213 remains the separately reviewed download-publication change. #219 public
agent access remains a separate draft. Hosted identity/publication acceptance,
clean second-machine browser-download acceptance, account synchronization and
the licensing decision are not accepted by this reconciliation.

The prior individual PRs remain open. This candidate is a follow-on to #217;
merging it into an unlanded release branch would change that parent's release.
Retarget it after the intended parent lands, or make that release-scope decision
explicitly. Required GitHub checks remain required.

## Verification

The full `pnpm check` gate passed on macOS: 3,015 tests, 3,013 passed, zero failed,
two skipped. The skipped tests require an explicitly selected Docker runtime via
`FOLIAGE_PROJECT_EVAL_TEST_IMAGE`; real Docker evaluation is not accepted by this run.
The following checks are against this combined tree, not inherited branch tallies:

- `pnpm install --frozen-lockfile` and the pinned `stage-gbrain.mjs` completed.
- The full offline gate passed: 362 sandboxed processes, six controls, zero deny
  lines or unexpected attempts; the owner brain files were unchanged.
- The one-download test installed the bundled local brain on an isolated
  Node-only machine, built and searched offline, exercised adding the brain later,
  and refused a modified archive. This is automated local packaging acceptance,
  not a human browser download on a second physical machine.
- The source connection, image ingestion, candidate-image HTTP boundary and Review
  rendering tests passed: 136 tests, no failures or skips.
- After correcting the image-origin default, bundles were rebuilt and the full
  static gate passed again, including boundary, egress and type checks.
- Aside MCP drove one isolated loopback app with a disposable HOME and garden.
  Its inputs were the actual source contract, this reconciliation receipt and
  the repository's `presentation-source.png`. No invented work record or owner
  garden was used.
- Selecting two text files showed their literal preview, then added exactly two
  private Review drafts. One was approved. Replaying the same project and files
  reported zero additions and two existing drafts; the entire Harvest document
  stayed equal, including its approved decision. The Leaf still had no Leaflets.
- Re-selecting the receipt after this real verification update identified one
  new revision and one unchanged file. Intake added exactly one candidate, kept
  all three existing drafts equal and left the new revision unreviewed.
- The real PNG decoded in preview, then entered Review with the owner-selected
  source label and candidate-scoped image URL. Approval followed by the separate
  addition retained the image and text as two pending Leaflets. Work showed the
  complete image, with no fabricated description, authorship or impact claim.
- Browser readback established actual 375 px and 1280 px CSS viewports and the
  corresponding phone media-query state. Sources preview, Review and Work had no
  horizontal overflow. Review and Work images decoded, retained their aspect
  ratio and used `object-fit: contain`. Keyboard Enter opened the source excerpt
  and Review disclosure. No page errors were observed.
- Browser readback after rebuilding confirmed the local-image default and the
  separate explicit Figma-export entry. No provider connection was established.
- A real local brain build on the retained rehearsal record returned `current`.
  Its keyword search returned the selected image as a **pending leaflet**, with
  its exact local citation and owner-selected evidence reference.
- After the revised receipt entered Review, the running app refreshed that brain
  without an explicit refresh command. Status reported `current` before search;
  keyword retrieval included the new candidate and its exact citation, alongside
  the retained earlier revision. It did not silently replace historical evidence.

Browser screenshots remain local evidence at `/tmp/foliage-release-aside-2.png`
(image preview), `-3.png` (phone Review), `-4.jpg` (desktop Review), `-5.jpg`
(desktop Work) and `-6.png` (phone Work). Captures are backed by the CSS viewport
readbacks above; output pixel dimensions are not used as viewport evidence.

The Canopy CSS change is included in the repository gate but has not been exercised
through a new hosted publication in this pass. Browser and keyword-search results
prove the selected local-source path only, not ongoing provider synchronization,
model interpretation, identity verification, public delivery or a complete launch.
