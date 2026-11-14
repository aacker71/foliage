# Organization administration

Package: `@foliage/enterprise-app` · Plane: `enterprise` · Application: `apps/enterprise`.

## Status

Present organization/release surface; existing width freeze remains for runtime expansion.

## Responsibility

Own company governance and release decisions. This is the organization administrator’s application; it is not the subject-scoped enterprise member experience.

## Runtime and interfaces

`apps/enterprise/server.mjs` serves `/`, `/releases`, `/members` and POST `/release`. The company loader and release store are separate adapters. `packages/enterprise-policy` owns release logic; organizational taxonomy also exists in `packages/photosynthesis-enterprise`.

## Storage and dependencies

`FOLIAGE_COMPANY` identifies the company manifest; `FOLIAGE_RELEASE` selects release-decision persistence through `releasePath.ts` and `releaseStore.ts`. Read the dedicated release-storage contract for persistence behavior. Do not assert a tenant database or working offboarding pipeline.

## Access and invariants

`FOLIAGE_ACTOR` is operator configuration, not a cryptographically authenticated company user. Any request whose Host is not one the bound loopback socket answers to is refused 421 before routing (DNS rebinding; `@foliage/leaf/bound-authorities`). Policy checks and release decisions must stay distinct from personal consent and public publication. Hosted roles and per-member isolation need their own acceptance.

## Data flow and boundaries

Company manifest + actor + policy decision → recorded release decision. A Tree is a company, Bough an organization, Branch a team. Employer screens carry no per-person proof-tier tallies; a review (in review and approved) lists only the subject's own public records that the publish rail does not deny (`releaseContents` in `packages/enterprise-policy`, with the same listing and rail checks as the canopy projection; the manifest names no member policy, so `server.mjs` passes the shipped default). Unlisted and denied records are silently absent: no title, reason or count. Approve and Publish post `releaseContentsDigest` of the list shown; the server recomputes it from the current leaf, refuses a mismatch with 409, and records the digest in the history entry. Publish is also refused with 409 unless the digest equals the one its approval recorded; the approved card then says the records changed and offers Retract, not Publish. Publish is shown as recorded and not delivered, because nothing consumes the pending event. Member correction/export/takeout belongs to the reserved member application, not an assumption that the admin view provides it.

## Source and verification

- [apps/enterprise/server.mjs](../../apps/enterprise/server.mjs)
- [apps/enterprise/src/companyDocument.ts](../../apps/enterprise/src/companyDocument.ts)
- [apps/enterprise/src/releaseStore.ts](../../apps/enterprise/src/releaseStore.ts)
- [apps/enterprise/src/releasePath.ts](../../apps/enterprise/src/releasePath.ts)
- [docs/ENTERPRISE-RELEASE-STORAGE.md](../../docs/ENTERPRISE-RELEASE-STORAGE.md)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).
