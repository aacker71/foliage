# Public website

Package: `@foliage/www` · Plane: `cloud` · Application: `apps/www`.

## Status

Integrated from `codex/portfolio-achievements@5f9fa1b` into the current candidate. Deployment acceptance remains separate.

## Responsibility

Explain the product and direct visitors into the appropriate actual application. Marketing pages and workspace prototypes must clearly distinguish demonstration from connected operation.

## Runtime and interfaces

Next.js App Router with React, TypeScript and Tailwind; `apps/www/package.json` on the named branch provides dev/build/start/lint/typecheck. Shared UI and tokens come from the workspace. This website has its own build; that does not change the native product server runtime.

## Storage and dependencies

Do not attribute a customer database, login backend or working portfolio service to a prototype. Integrate the website’s actual manifest and boundary declaration from its release line rather than adding an absent package here.

## Data flow and boundaries

Visitor → product explanation → real supported start path. Separate website deployment from Canopy hosting. Routing overlap with Canopy marketing routes requires deliberate release ownership, not two independently evolving claims about readiness.

## Access and invariants

[Canonical architecture](../architecture.md) identifies implementation status. Do not create
an application manifest or broaden a licensing boundary merely to make this planned entry
look implemented. Update this document when its actual contract lands.

## Source and verification

[Manifest](../../apps/www/package.json), [app routes](../../apps/www/app),
[shared UI](../../packages/ui/package.json). Run the website build, lint and typecheck
on this integrated candidate; browser acceptance covers real and honest empty states.
