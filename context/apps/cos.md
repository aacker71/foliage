# CoS local runtime adapters

Package: `@foliage/cos-app` · Plane: `open` · Application: `apps/cos`.

## Status

Present library-style application package; no dev/start server script. Frozen for new product width.
`cos.mjs` describes itself as an experimental command-line tool, not part of the Foliage app.

## Responsibility

Own local encrypted storage, memory and inference adapters for chief-of-staff routing. It is a runtime support package rather than a customer-facing web application.

## Runtime and interfaces

Exports `./localStore`, `./localModel` and `./memory`. Routing domain contracts live in `packages/cos`. `src/fireworks.ts` is a legacy explicit remote transport adapter; the separate cloud package `packages/escalated-inference` also exists and must not be conflated with this runtime.

## Storage and dependencies

`src/localStore.ts` implements an encrypted SQLite store using derived keys and authenticated encryption; plaintext keys are process-local while open. The store file is created 0600 (a directory it creates, 0700), and an older world-readable store is narrowed to 0600 once its secret opens it, as is an existing header-less file that `init` makes a store. `memory.ts` composes memory operations. Read the source threat model before making device-compromise or backup claims.

## Access and invariants

The store secret is not a cloud account. Local model and remote escalation have different egress boundaries. Remote calls need explicit configured credentials/model and admitted payloads under the existing router contract. Sending `store:false` is not proof of provider retention behavior.

## Data flow and boundaries

Context → routing policy → permitted local memory/model or explicit escalation adapter. No independent HTTP UI, autonomous publishing or cloud Ladybug deployment is supplied here. Consolidating the two inference implementations requires a separate code-level migration, not an architecture-file rename.

## Source and verification

- [apps/cos/src/localStore.ts](../../apps/cos/src/localStore.ts)
- [apps/cos/src/localModel.ts](../../apps/cos/src/localModel.ts)
- [apps/cos/src/memory.ts](../../apps/cos/src/memory.ts)
- [apps/cos/src/fireworks.ts](../../apps/cos/src/fireworks.ts)
- [packages/cos/src/index.ts](../../packages/cos/src/index.ts)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).
