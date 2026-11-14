# Code standards

[AGENTS.md](../AGENTS.md) owns repository invariants and paid-for traps. This file describes
implementation conventions without copying the contract or token values.

## TypeScript and boundaries

Use explicit `.ts` imports for the native product runtime and public package exports between
packages. Validate unknown inputs at boundaries. Prefer readonly domain values, discriminated
results and named failure causes. Keep pure transformations separate from filesystem,
network, process and model adapters; existing effects in packages are not permission to add
new ones without reviewing ownership.

The compiler contract is [tsconfig.base.json](../tsconfig.base.json): strict mode,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
`erasableSyntaxOnly` and no emit. Treat omission and explicit undefined consistently with
that contract; do not relax it to avoid handling an unavailable result.

## Routes and persistence

Keep handlers responsible for parsing, access checks and dispatch. Reuse canonical document
parsers, projection and promotion functions. Preserve source digest checks, locks and atomic
writes where their owning flow uses them. Report both causes if fallback also fails. Do not
turn unavailable evidence, lost access or a failed model into an empty successful result.

## UI and files

Use [UI context](ui-context.md). Shared controls belong in `packages/ui`; domain behavior
belongs with its owning package. Server adapters and app-specific presentation belong in the
owning `apps` directory. Do not create another runtime to fix a documentation conflict.

## Resource and input handling

Escape untrusted text at its output boundary; the shared static UI accepts text/React props,
not pre-escaped HTML. Validate request sizes and exact permitted fields in the owning flow.
For hosted handlers, bind actor/tenant/subject to verified authority before storage access;
a caller-supplied actor field or locally configured role is not hosted authentication.

Keep subprocess/model/network work bounded and cancellable where the interface supports it.
Clean up resources owned by the operation and preserve cleanup errors alongside the original
failure. Preserve idempotency and explicit uncertain outcomes across retries. Logging must
not expose credentials, raw private evidence or prompts merely to improve observability.

## Verification

Use the scripts in [package.json](../package.json); `pnpm check` is the integrated gate.
Use focused tests for changed behavior, then required repository checks. No synthetic portfolio
may be presented as a person's result. Protocol fixtures must say what they test. Optional UI
bundles and a separate Next website build are not a server `dist/` build. Read the target
application architecture before choosing its build or launch command.
