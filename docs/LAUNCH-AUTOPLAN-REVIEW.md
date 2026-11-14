# Launch autoplan review — approved

**APPROVED WITH OPEN GATES, 2026-09-05.** The owner approved the current plan without overrides. CEO → Design → DX → Engineering completed in order, with separate Claude and Codex voices in each phase. The revised plan preserves all L0–L6 milestones and all five product tracks. Customer, disclosure, hosted-admission and production gates remain explicit; approval does not establish implementation readiness.

[Full revised plan](~/Documents/GitHub/foliage/docs/LAUNCH-TO-CUSTOMERS-PLAN.md) · [Acceptance test plan](~/.gstack/projects/aacker71-foliage/alex-codex-canopy-cloud-eng-review-test-plan-20260905-190632.md) · [Corrected state wireframe](~/.gstack/projects/aacker71-foliage/designs/launch-states-20260905/wireframes.html) · [Deferred expansions](~/Documents/GitHub/foliage/TODOS.md)

## What changed and why

- Exact outward usefulness is now tested separately from rich local content: promoted work remains pending, and the current frozen reader carries verified titles/provenance only.
- Local review/refresh/promotion/publication must coordinate their read/validate/write windows, preserve unreadable prior bytes and report partial success honestly.
- Hosted publication requires real ownership/proof/policy admission, durable operation receipts and revision checks, private storage and withdrawal that survives every serving route and restore.
- UI states retain correction drafts, return context and unknown-operation recovery; quickstart distinguishes local copies from managed, withdrawable hosting.
- Twenty acceptance scenario groups distinguish existing local tests from missing hosted, browser and customer evidence.

## Decisions

**44 recorded: 40 auto-decisions, 3 owner choices, 1 user challenge.** Mechanical decisions preserve complete required paths. Owner and technical gates below are not silently approved by completing this review.

### UC1 — Validate the exact reader artifact before substantial hosting investment

Original direction: a supported L1 pilot while L2 hosting foundations begin alongside it. Both CEO voices recommend requiring a useful exact-outward artifact/read-out before substantial hosted investment, with owner-set continuation criteria and a real pause/local-service option. Their concern is that a useful private portfolio may yield an empty or title-only hosted product.

We may be missing an existing customer promise or a platform dependency that makes parallel hosting necessary. Changing course could delay needed capability based on a small sample. **The original sequence remains in the plan unless you explicitly accept this challenge.** An accepted sequencing change requires a final engineering re-review under the autoplan workflow.

### Owner choices

1. **First customer:** resolve the earlier developer decision against the current provisional executive-led draft. Recommend keeping this as an explicit L0 decision; an executive pilot needs source eligibility proven, while a technical cohort matches the most exercised current input path. The review does not choose a new market.
2. **First UI slice:** recommend My Leaf → owner detail → return; Review-first remains viable if candidate completion is the first pilot bottleneck. Navigation/copy/visual acceptance remains the owner's.
3. **Public accounting:** recommend keeping private withholding totals, categories and repair instructions out of hosted public pages. Existing frozen rendering deliberately includes aggregates, so the final public-field/format contract must resolve that difference explicitly.

**Technical hold:** hosted admission cannot be implemented safely until the trusted proof source, account-to-subject/key binding, policy freshness, redaction/verbatim trust and permitted verification disclosures are specified. Signing arbitrary uploader data or accepting valid JSON does not resolve it. Rich public body/media requires its own supported versioned contract before it is promised.

## Review assessments

Scores below assess plan specificity, never people or portfolio quality, and never substitute for implementation acceptance.

| Phase | Primary assessment | Claude / Codex findings | Agreement |
|---|---|---|---|
| CEO | Scope preserved; customer/value/offer gates explicit | 18 / 8 | 6/6 shared concerns, not passing dimensions |
| Design | 6.9 → 8.1/10 specification | 7 / 7 | 6/7 aligned, 1 resolved motion difference |
| DX | 5.5 → 7.8/10 specification; TTHW unmeasured | 7 / 7 | 6/6 shared concerns |
| Engineering | Nine source-backed findings; eight critical milestone-specific implementation/evidence groups | 9 / 3 | 3/6 aligned, 3 differences reconciled with source/invariants |

The external voices contain rejected claims as well as useful findings. The review explicitly rejects the alleged missing workspace preflight, unsupported benchmark/test counts, blanket own-repository refusal, cloud-to-open imports, automatic stale-lock stealing and signed-URL/cache-expiry withdrawal shortcuts.

## Cross-phase themes

**The local artifact and the reader's artifact differ** — independently raised in CEO, Design and Engineering. Test exact outward usefulness before promising hosted parity.

**A successful-looking message can hide lost or incomplete work** — independently raised in Design, DX and Engineering. Preserve drafts/bytes, propagate promotion failures, and resolve publication uncertainty through durable receipts.

**Consent must remain bound to current authority** — independently raised in CEO and Engineering, with corresponding Design recovery requirements. Authentication, publisher trust, policy freshness and revocation must survive concurrent operations and restore.

**Readiness belongs to one candidate and one real journey** — raised in CEO, Design and DX. Local navigation changes, cached integration state, historical test tallies and conceptual images cannot be mixed into a release claim.

## Deferred expansions

Five contextual entries were added to TODOS: extra source connectors beyond the first offer, hosted source playground, broader discovery, custom billing portal and advanced botanical exploration. Their triggers/dependencies and both human/agent effort estimates are recorded. Existing TODOs and required source/UI/payment/enterprise work remain intact.

## Implementation tasks aggregated across phases

Sixteen tasks survived current-branch/recent-commit/latest-run filtering; exact duplicates alone were removed. Related tasks are deliberately retained and marked for coordinated implementation: CEO-T3/DX-T2/ENG-T1 share local safety work; CEO-T5/DES-T2/ENG-T3 share hosted recovery; acceptance tasks share evidence rather than duplicate implementation. Effort estimates include substantial real participant/provider work and must not be summed as independent commitments.

- [ ] **CEO-T1 (P1) — Release plan**: Record buyer, offer, support allowance and candidate identity. Human: ~2h; agent: ~30min + owner session.
  Source: ceo-review, CEO premises and release evidence. Files: `docs/LAUNCH-TO-CUSTOMERS-PLAN.md`, `.loop/STATUS.md`.

- [ ] **CEO-T2 (P1) — Pilot validation**: Exercise authorized source and exact outward artifact with a reader. Human: ~1 day; agent: ~1–2h + real sessions.
  Source: ceo-review, CEO publication eligibility. Files: `docs/LAUNCH-TO-CUSTOMERS-PLAN.md`.

- [ ] **CEO-T3 (P1) — Local writes**: Serialize review, refresh and promotion across writers. Human: ~1–2 days; agent: ~2–4h.
  Source: ceo-review, CEO local last-writer loss. Files: `apps/leaf/server.mjs`, `apps/leaf/harvest.mjs`.

- [ ] **CEO-T4 (P1) — Public contract**: Specify frozen payload and consent receipt before upload. Human: ~1 day; agent: ~1–2h.
  Source: ceo-review, CEO rich-content projection gap. Files: `packages/canopy/src/publish.ts`, `packages/canopy/src/publishedDocument.ts`, `packages/canopy/src/republish.ts`.

- [ ] **CEO-T5 (P1) — Recovery**: Specify operation records and revocation-preserving restore. Human: ~1 day; agent: ~1–2h + rehearsal.
  Source: ceo-review, CEO unknown mutation outcome and restore. Files: `docs/DEPLOYMENT.md`.

- [ ] **DES-T2 (P1) — Hosted management**: Implement recovery matrix with unknown outcomes, preserved drafts and withdrawal receipts. Human: ~1 day; agent: ~1–2h.
  Source: design-review, Design pass 2; Claude D1/D5; Codex D2/D5. Files: `apps/leaf/src/render.ts`, `apps/leaf/server.mjs`, `apps/canopy/src/renderPublished.ts`.

- [ ] **DES-T3 (P1) — UI acceptance**: Measure responsive, accessibility, CSP and network behavior on the integrated candidate. Human: ~1 day; agent: ~1–2h plus owner review.
  Source: design-review, Design passes 5–7; owner visual acceptance pending. Files: `docs/LAUNCH-ROUTE-INVENTORY.md`, `docs/UI-FOUNDATION.md`, `apps/leaf/public/leaf.css`.

- [ ] **ENG-T1 (P1) — Local write safety**: Implement one open-plane transaction protocol across all participating writers. Human: ~2–3 days; agent: ~3–6h.
  Source: eng-review, E1/E2; T03–T05; overlaps CEO-T3 and DX-T2; E9 source/policy-versus-local-publication race. Files: `packages/photosynthesis/src`, `apps/leaf`, `apps/photosynthesis`, `apps/canopy/publish.mjs`.

- [ ] **ENG-T2 (P1) — Hosted admission**: Define and implement ownership, proof admission, consent and public-field contracts. Human: ~2–4 days; agent: ~3–6h plus contract decision.
  Source: eng-review, E4/E5/E8; T09–T11; proof/payload contract still gated. Files: `packages/canopy/src/publishedDocument.ts`, `apps/canopy/src/hosted`.

- [ ] **ENG-T3 (P1) — Hosted publication**: Implement durable mutation/status and all-route revocation-preserving serving and restore. Human: ~3–5 days; agent: ~4–8h plus deployed rehearsal.
  Source: eng-review, E6; T12–T16; coordinates CEO-T5 and DES-T2; existing-operation lookup before new staging/CAS. Files: `apps/canopy/src/hosted`, `apps/canopy/src/renderPublished.ts`, `docs/DEPLOYMENT.md`.

- [ ] **ENG-T4 (P1) — Release acceptance**: Execute candidate-specific security, UI, DX, commercial and conditional enterprise acceptance. Human: ~2–3 days; agent: ~3–5h plus real acceptance.
  Source: eng-review, T01–T20; existing tests do not prove hosted/customer readiness. Files: `apps/canopy/src`, `apps/leaf/src`, `docs/DEPLOYMENT.md`, `docs/LAUNCH-ROUTE-INVENTORY.md`.

- [ ] **DX-T1 (P1) — Documentation**: Reconcile quickstart/help and local-copy versus managed-hosting contracts. Human: ~1 day; agent: ~1–2h.
  Source: devex-review, DX passes1/2/4; conflicting document roots and static-sharing promise. Files: `TESTER-QUICKSTART.md`, `README.md`, `foliage.mjs`, `docs/CANOPY-CLOUD.md`.

- [ ] **DX-T2 (P1) — CLI recovery**: Preserve harvest bytes and propagate partial-stage and promotion failures. Human: ~1 day; agent: ~1–2h.
  Source: devex-review, Codex DX1/DX2; direct truncation, read masking and ignored child status. Files: `foliage.mjs`, `apps/leaf/harvest.mjs`, `apps/leaf/src/proposeDocument.ts`.

- [ ] **DX-T3 (P1) — Pilot operations**: Qualify pilot environment and exercise safe garden updates plus release compatibility. Human: ~1–2 days; agent: ~2–4h plus rehearsal.
  Source: devex-review, DX passes5/6/7; before L1 updates and L4 release. Files: `docs/DEPLOYMENT.md`, `TESTER-QUICKSTART.md`, `packages/canopy/src/publishedDocument.ts`.

- [ ] **DX-T4 (P1) — CLI arguments**: Make subcommand help nonmutating and retain explicit review source/garden context. Human: ~1 day; agent: ~1–2h.
  Source: devex-review, Codex DX3; grow --help enters mutating command. Files: `foliage.mjs`, `TESTER-QUICKSTART.md`, `apps/leaf/src/foliageGarden.test.ts`.

- [ ] **DES-T1 (P2) — Owner journey**: Implement accepted first journey with readable previews and retained return context. Human: ~2 days; agent: ~2–4h.
  Source: design-review, Design passes 1, 4, 6; Codex D3/D4. Files: `apps/leaf/src/render.ts`, `apps/leaf/src/frond.ts`, `apps/leaf/public/leaf.css`.

## Evidence and limits

`pnpm check:boundary` passed across 14 workspace packages; documentation whitespace checks passed. The review read source/test bodies and exercised read-only help, but did not run the implementation suite, cold onboarding, real customer trial or deployed withdrawal rehearsal. These remain future acceptance work.

The image study's invented mark/lock styling was rejected. The gstack image checker reported a quota error while returning `pass: true`; that check is recorded as unavailable. A corrected nonfunctional native wireframe was visually inspected; it does not establish application accessibility or branding acceptance. Two durable learnings were logged. All browser work used one owned tab, which was closed.

Code source reviewed: local `4dcb8ca`, including another task's Scarlet commit; cached integration `3a9bf88` remains separate. This review changed planning documents only and created local WIP checkpoints, without pushing, contacting customers or changing Asana.

## Pre-gate checklist

All mandatory CEO, seven-pass Design, eight-pass DX and final Engineering outputs are present. All eight voice artifacts, CEO spec review, diagrams, error/failure registries, twenty-group test artifact, contextual TODOs, task JSONL/aggregate and 44-entry decision audit exist. No missing-output retries were needed. Owner approval of the roadmap is recorded; implementation acceptance remains open. Review logs retain `issues_open` for the named unresolved gates.

## Approval

The owner replied “approved” on 2026-09-05 to the current-plan approval gate. No overrides or UC1 sequencing change were requested. The original parallel L1/L2 sequence remains; the first-customer, UI/disclosure, admission and production gates remain as written. UC1 was not adopted by this approval. A later scope or architecture amendment still requires engineering to review the changed plan.
