# Selected photos: implementation sequence

Status: v6 reconciliation candidate. Contract tests are local; live provider migration, real-photo browser acceptance, two-account isolation and withdrawal rehearsal remain open. Canonical task:
[selected photos and withdrawal](https://app.asana.com/0/1218204163479805/1218314633532854).
Unphotographed publication continues to write the current named-portfolio v5 shape. Explicit photo selection writes v6; v1–v5 readers retain their original fields. The legacy photo branch also used v5, before named portfolios claimed that version. Its photo-bearing v5 artifacts are intentionally refused by this parser and must be re-reviewed and exported as v6.

## Reuse and seams

- Local bytes and metadata: `apps/leaf/src/mediaStore.ts` already owns `putImage`, `readMedia`,
  source/rendition digest distinction, container stripping and integrity checks. Reuse it
  through a deliberate package export. Do not copy a stripper into Canopy.
- Selection: extend `renderHostedBridge.ts`, `manageState.ts` and `localHostedBridge.ts`.
  Image/caption choices must be independent and initially unchecked, like narrative.
- Projection/codec: introduce a closed successor format in `packages/canopy/src/publish.ts`
  and `publishedDocument.ts`. Retain v1/v2 dialects and v3–v5 reading and transport.
- Admission/persistence: extend `hostedAdmission.ts`, `hostedStore.ts`, the actual SQL
  transaction and immutable private-object staging. Existing operation identity, receipts
  and revision/generation authority remain the only publication state machine.
- Serving: `hostedApp.ts` and the local preview deliver selected renditions through their
  current authority. `renderPublished.ts` renders accessible figures and captions, never
  source paths or permanent object URLs. Local exports need an explicit supported media path
  or a named refusal; do not emit broken image references.

## Increment order and completion

1. Freeze the successor image-reference fields and bounds with parser/round-trip tests.
   Carry original source evidence ref separately from rendition digest/size/container and
   caption/alternative text. No EXIF, source pathname, arbitrary URL or unknown field crosses.
2. Implement exact stripped-rendition selection/preview. Bind source/policy/selected bytes,
   and re-read/recheck them at preparation and final send. Missing/corrupt metadata or bytes
   produce a named refusal; a thumbnail from an earlier read is not current consent.
3. Stage admitted images as private immutable account/subject/revision-scoped objects. Verify
   actual byte size, digest, supported container and metadata treatment on the server. Bind
   the entire image set to the operation fingerprint and transaction; save receipts before
   reporting success. Do not delete staging on an ambiguous commit result.
4. Serve images only through a current-publication lookup for each GET/HEAD, with no-store
   headers and a post-read revision check. A digest URL is not authority. Fail closed when
   the artifact, current head or object bytes cannot be established.
5. Replace/remove/withdraw using the existing current-revision/generation transition. Old
   media routes and stale requests cannot reattach removed objects or resurrect a publication.
   Restore object bytes and revocation continuity together before reopening readers.
6. Run canonical codec, cross-account, stale-selection, tamper, interruption/replay, removal,
   withdrawal and legacy-client regressions; review with the three required lenses. Inspect
   real permitted images on actual mobile/desktop readers, including alt text and captions.

A private image picker, a new schema alone, or a static thumbnail does not complete this task.
Never enlarge v4's closed shape in place or claim all images are admitted because one worked.
Record the tested size/container envelope and limit errors; provider capacity is measured
separately from local implementation bounds.


## Implemented contract and current limits

A publication can select four JPEG, PNG or GIF renditions, each at most 512 KiB. The device
transfer is bounded separately to 3 MiB and the hosted HTTP request to 4 MiB. No automatic
resizing is performed: larger files receive a named refusal. The local media store strips the
original; both local review and hosted admission walk the supported container again. Unchanged
size, magic, rendition digest and zero further metadata removal are required. This is container
validation, not a claim that every image decoder or provider capacity has been exercised.

Each v6 `photos` entry carries only `sourceRef`, `renditionDigest`, `bytes`, `format`, `alt`
and an optional explicitly selected `caption`. Descriptions are required and both text fields
are limited to 1,000 characters under the disclosure gate. The source ref names the original;
it does not claim the original and rendition share bytes, or independently establish authorship.
Original paths and metadata are absent. A caption selected without its image is refused.

The existing private companion shows stripped renditions before preparation sends them. A
prepared preview uses retained exact bytes. Preparation and final send check local media;
source/policy changes invalidate the decision. The private connection file holds the exact
bounded transfer alongside the operation, uses existing durable writes and recovery, and now
has a 16 MiB ceiling. Disconnecting removes credentials, retaining the decision for recovery.

Hosted staging puts images at `owner/subject/revision/renditionDigest.format`, then the JSON
artifact at `owner/subject/revision.json`. All objects are immutable in the same private bucket.
The existing SQL transaction commits the artifact digest, which includes the complete selected
image manifest; no second media authority or image publication state machine is introduced.
Migration `202609300001_selected_photos.sql` permits the three image content types while
preserving privacy, RLS and the existing 2 MiB per-object storage limit. It refuses an existing
public bucket. Apply migrations in order on the chosen application project.

Readers use `/leaf/:subject/media/:artifactDigest/:renditionDigest`. Every GET and HEAD checks
the current artifact, selected digest, actual private bytes and current revision/generation again
after the read. Replacement/removal/withdrawal makes historical image routes unavailable.
All responses carry no-store headers. Bytes already downloaded cannot be recalled.

The hosted browser's JSON-only upload form deliberately refuses photo publications because it
cannot show their bytes. Use the local companion. Static export refuses photo-bearing artifacts
because it cannot preserve current-authority withdrawal. Local JSON-only readers name that
unsupported media path rather than emit broken image references. These are explicit limits,
not separate unfinished upload or static-photo implementations.

Acceptance evidence must distinguish deterministic contract tests and disposable SQL execution
from actual provider/account/customer runs. The latter remain on the launch worksheet.
