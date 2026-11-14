# AI workflow rules

Adapted from the user-supplied **Six-File Context Methodology** by JavaScript Mastery,
received 2026-09-14. The ZIP supplies six context templates and a thin agent entry point.
We apply its separation of intent, architecture, standards, UI, progress and workflow to
this monorepo; we do not copy generic database, build or UI-token assumptions.

## Read and scope

Start with [overview](project-overview.md), [architecture](architecture.md),
[UI context](ui-context.md), [standards](code-standards.md), this file and
[progress](progress-tracker.md). Read the relevant application architecture before edits.
Load detailed contracts on demand. [AGENTS.md](../AGENTS.md) remains the repository contract;
user instructions and higher-priority agent instructions take precedence.

For product, copy, UI and roadmap changes, also read the complete
[Language & Product Framing](product-thesis.md). It is the owner-supplied thesis, preserved
separately from implementation interpretations. Update it in place when the owner revises it;
keep provenance and update affected context rather than creating a competing thesis.

Use these questions in the existing spec/review, not as another user approval screen:

- What meaningful work, decision, discovery or outcome becomes easier to retain or understand?
- Does this improve the underlying private record, or a clearly identified projection of it?
- Can a reader distinguish evidence, external validation, owner reflection and AI inference?
- Does meaningful compression retain provenance, correction history and uncertainty?
- Does the change reduce manual maintenance while preserving owner intent and consent?
- Does it provide private value, and does any sharing serve the owner's chosen audience?

For implementation acceptance, describe concrete behavior and evidence. For the thesis's
emotional outcome, ask the owner whether the result represents their work; do not claim
“feels seen” from automated checks. Use the founder's real journey and an independent reader
as the demanding product test, with permitted sources and deliberate public disclosure.

For a substantial feature, write a bounded spec: problem, owning application, current
behavior, proposed change, interfaces/data, non-goals, acceptance checks and unresolved
choices. Explore → specify → implement → verify. Resolve routine choices within authorized
scope. Ask only for missing consequential decisions; do not use a template to require
repeated approval of already-authorized work.

## Build plan and unit specs

Use [00-build-plan.md](specs/00-build-plan.md) for the ordered units refining B00–B14.
B packages are delivery groups, not automatically single-session units. Read the existing
owning unit before coding. For new scope, add a unit with a standalone observable result
and update `context/specs/units.json` and the plan together. Each unit has five sections:

1. **Goal:** concrete result, owning application and explicit non-goals.
2. **Design:** interface/layout, states, trust boundaries and applicable token references.
3. **Implementation:** exact affected components, contracts, persistence and failure paths.
4. **Dependencies:** prerequisite units and new packages, or explicitly none. Add dependencies
   only where they first unlock needed behavior.
5. **Verify when done:** observable acceptance, failure/recovery cases and applicable commands.

Order access control before protected features and backend contracts before UI wiring.
UI shells may use honest empty/unavailable states; the README's placeholder-data example
does not override Foliage's prohibition on fabricated portfolios. Merge adjacent steps that
have no standalone result; split unrelated boundaries. Do not invent a completed spec for
past work to suggest it was planned in advance.

## Implement, correct, close

- **Implement:** read the unit and relevant context, mark it in progress, implement only that
  unit. Preserve separate-branch work and other operators' changes.
- **Correct:** record the specific mismatch between expected and actual behavior, investigate
  its cause, then fix that mismatch. Repeated failure means revisit the source contract or
  split the unit; do not accumulate speculative patches.
- **Close:** mark complete only after its acceptance checks pass. Record exact branch/commit,
  environment, commands/results, limitations and next dependency. A blocking decision stays
  explicit with the required resolution. Push/deploy only within actual user authorization;
  the methodology's example close prompt is not blanket permission to publish.

## Single sources of truth

- `product-thesis.md` preserves the owner-supplied framing; `project-overview.md` translates
  it into product scope. Neither is a new architecture, schema or completed-feature claim.
- `architecture.md` owns the cross-app map. `apps/<name>.md` owns that application's design.
- Manifests own dependencies and licensing planes; code owns actual runtime behavior.
- `ui-context.md` routes to tokens and UI adoption documents, without duplicate values.
- `progress-tracker.md` owns resumable work status, linking existing findings and Git evidence.
- Archive superseded broad architecture narratives with a dated banner and a migration link.
  Keep decision history; remove its status as current implementation authority.
- Product concepts without runnable code receive an explicit planned architecture, not a
  fake package, manifest entry or claimed deployment.

## Finish a unit

Preserve unrelated working-tree changes. Update the one owning architecture when interfaces,
storage, access or runtime boundaries change. Update progress with branch/commit and what was
actually verified. Run `node scripts/check-architecture.mjs` for application/spec coverage,
dependency order, acceptance mapping and context file links;
run appropriate behavior checks for code changes. Existing finding gates remain authoritative.
Do not broaden a documentation consolidation into removing working servers or merging branches.
