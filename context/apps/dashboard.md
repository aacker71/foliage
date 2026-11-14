# Legacy local dashboard composition

Package: `@foliage/dashboard-app` · Plane: `open` · Application: `apps/dashboard`.

## Status

Present support application; frozen for new product width. Labelled legacy: every page it serves
(its refusals included; asset and font answers aside) and the start-up log name `foliage up` as
the current app. Its forms are not maintained.

## Responsibility

Compose existing Leaf rendering and Photosynthesis review into one local origin. Keep compatibility and shared CSRF support without growing a second personal product architecture.

## Runtime and interfaces

`apps/dashboard/server.mjs` consumes the pure route table in `src/routes.ts`: `/`, `/leaf`, `/review`, POST `/decide`, POST `/promote`, plus local assets. It imports application modules rather than proxying separate servers.

## Storage and dependencies

Reuses configured Leaf and harvest documents through their owning loaders. There is no dashboard-specific canonical portfolio store. `src/harvestStatus.ts` presents collection status.

## Access and invariants

One loopback origin permits native review forms to retain their CSRF meaning. Do not forge Origin headers to proxy another review server. `src/csrf.ts` is exported for reuse; importing it does not mean another app requires this server to be running.

## Data flow and boundaries

Browser → dashboard route → existing Leaf/review module → owning document operation. New personal experiences belong in Leaf. Runtime removal or migration would require a separate consumer review; documentation consolidation does not delete this server.

## Source and verification

- [apps/dashboard/server.mjs](../../apps/dashboard/server.mjs)
- [apps/dashboard/src/routes.ts](../../apps/dashboard/src/routes.ts)
- [apps/dashboard/src/csrf.ts](../../apps/dashboard/src/csrf.ts)
- [apps/dashboard/src/harvestStatus.ts](../../apps/dashboard/src/harvestStatus.ts)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).
