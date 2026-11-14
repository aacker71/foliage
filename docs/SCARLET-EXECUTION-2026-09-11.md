# Scarlet execution — 2026-09-11

## Candidate and reconciliation

Execution started from `~/Documents/GitHub/foliage`, branch `codex/canopy-cloud`,
base `84083ddac1445a1355901de39c0af25ec8954407`, with substantial existing uncommitted work.
That checkout passed `pnpm check` (1,664 tests) and remains intact.

The worktree inventory revealed that the full-build branch already contains the hosted
identity, persistence, source workflows, revision transfer and local-to-hosted handoff that
were absent from the initial checkout. Execution therefore uses an isolated candidate:

- Directory: `/private/tmp/foliage-scarlet-delivery`
- Branch: `codex/scarlet-delivery`
- Base: `9486b45` from `codex/full-build-20260908`
- Naming/integration changes are staged, not committed, pushed, merged or deployed.

The original checkout's unrelated UI, developer tooling and local-file changes have not been
merged into this candidate. They are preserved in that checkout. They require reconciliation
before replacing it or claiming a release containing both lines of work.

## Changes made during execution

- Integrated Scarlet naming across the full-build source, cloud assessment UI, imports,
  filenames, tests, configuration and documents. Kept Dee Dee as the swallow, Picus as the
  woodpecker and Pango as the forest-protecting pangolin maintaining the Canopy.
- Added an explicit private-store migration guard. Existing old-name configuration or a
  default old-name store cannot silently become an empty Scarlet workspace. Setting
  `FOLIAGE_SCARLET` to the existing private file preserves it without rewriting its contents.
- Preserved historical AI log schema recognition and ignored both old and new assessment
  filenames at any depth, including their dotted forms.
- Fixed a reproduced concurrent-test failure: default-path mutation tests now exercise a
  copied application in an isolated directory instead of planting documents in the checkout.
- Connected the delivery workflow to the full-build plan and milestone selector.

## Executed evidence

| Check | Observed outcome |
|---|---|
| Original checkout `pnpm check` | Passed, 1,664 tests |
| Candidate first `pnpm check` | 1,981 passed; one test failed because another test temporarily planted the script-relative default Leaf |
| Focused default-path and garden suites after isolation fix | Passed, 44 tests |
| Scarlet assessment/migration suite | Passed |
| Final candidate `pnpm check` | Passed, 1,983 tests, no failures or skips |
| Actual hosted-publication and notification SQL migrations in disposable PGlite | Passed, 17 tests; this is local database evidence, not live Supabase acceptance |
| Canopy workspace assets and Vercel function packaging | Built successfully with workspace exports and installed production dependencies; no deployment performed |
| Independent review, GPT-5.6 Sol | No actionable regressions in the scoped naming, migration, historical-log and test-isolation changes |

Logs for this run are under `/tmp/foliage-scarlet-*`. The generated Vercel output is
`apps/canopy/.vercel/output` inside the candidate. Packaging is deployment preparation;
it does not establish a configured public hostname or hosted application health.

## Workflow state and next dependencies

| Packet | State | Evidence still needed |
|---|---|---|
| W0 | Review | Candidate tests and packaging pass. Reconcile original checkout's remaining changes and verify selected deployment. |
| W1 | Review | Existing contracts found: Supabase identity, transactional hosted store, Fireworks inference, explicit local review/transfer and publication consent. Confirm intended provider environment and live authority boundaries. |
| W2 | Review | Existing workflow/cells/revision integration exercised by suites; real second-person capture/restart and source-grant journey still required. |
| W3 | Review | Hosted identity/store/HTTP code and SQL validation exist; intended Supabase project, two real accounts, independent instances and backup/restore acceptance are pending. |
| W4 | In progress | Cloud inference and explicit revision transfer exist through the private companion. Production hosted Scarlet workspace/session integration and actual configured Fireworks assessment remain unfinished. Do not infer them from hosted publication endpoints. |
| W5 | Review | Existing handoff supports explicit prepare/publish, receipts and unknown-outcome recovery. Real configured hosted round trip still pending. |
| W6 | In progress | Function package builds. Public content/media parity, configured deployment, browser evidence and comprehensive deployed withdrawal acceptance remain unfinished. |
| W7 | Blocked | Requires unfinished W4/W6 plus real provider and independent participant evidence. |

The intended Supabase project and deployment environment were requested in this task and
have not yet been supplied. Fireworks additionally requires its configured key, exact model
and approved provider settings through the existing private configuration process. Do not
paste credentials into the execution record or use the Foliage Brain project by assumption.

Local successful tests are not a customer launch, completed workflow, actual model-quality
result or proof of deployed withdrawal. Continue from these named gaps rather than rebuilding
existing source workflows, persistence or publication engines.
