> Scope and implementation status: [canonical architecture](../context/architecture.md).
> This document retains its dated decisions or detailed feature contract; it is not a second application inventory.

# Launch route and integration inventory

Observed 2026-09-05. Source inventory, not browser acceptance. Tracking: https://app.asana.com/1/1218186870488143/project/1218204163479805

## Integration

- Remote `main` observed at `e1b3845`.
- PR #50 remains OPEN and MERGEABLE, head `9f3aa555caf0fb1a4c0fa7db316c6eff847bbd39`; includes Canopy manager, US residency and immediate withdrawal decisions.
- Website foundation and landing are `fefda2b` / `df3353d`. Scoped corrections are `8c6221a` on `codex/www-launch-fixes` in `/private/tmp/foliage-www-launch-fixes`.
- These are separate release lines. Local integration branch `codex/launch-integration` combines both lines without conflicts. Its first clean check caught generated `LayoutProps` missing before the first Next build; website follow-up `392f7b2` fixes this with an explicit children type (integration `ab4863f`). Sequential validation on `ab4863f` passed: pnpm check, 1,577 tests, zero failures/skips, then the Next production build. This is an engineering candidate, not production acceptance. The branch is published as `codex/launch-integration` for reproduction; no PR was merged.

## Products and routes

| Product | Source-backed surface | Launch work still requiring acceptance |
|---|---|---|
| Individual | `apps/leaf/server.mjs`: `/`, `/leaf`, `/garden`, `/policy`, `/publish`, `/review`, `/scarlet`; owner `/my/leaflet/…` and public `/leaflet/…`; write handlers for review, promotion and inference | Clean-machine setup, authorized source selection, inference failure/retry, correction and export with a non-owner; confirm face per route and explicit publication authority |
| Portfolio Hosting | `apps/canopy/server.mjs`: `/`, `/tree`, public leaflet and published-document routes; PR #50 adds local publication management | Hosted login/recovery, ownership, authenticated upload, durable private storage, receipt/replace/withdraw/recovery; US residency and revocation checks |
| Recruiter | Existing public Canopy reader routes | Read a deliberately shared leaf first; discovery/search remains gated. No reader ranking or inferred authority |
| Organization | `apps/enterprise/server.mjs`: `/`, `/releases`, `/members`, POST `/release` | Durable governance, member/role isolation, separate approval/publication, offboarding and organization pilot acceptance |
| Individual Enterprise | `apps/member` reserved in product spec, no implementation claimed | Subject-scoped view, policy explanations, correction, export/takeout and departure; required before selling this surface |
| Website support | `apps/www/app/page.tsx`: `/`; built-in not-found route | First-customer explanation, start/support path, approved offer/pricing and terms/privacy. Current section links are not onboarding |

## UI evidence and remaining work

At `8c6221a`, the website build and five theme tests pass. Full `pnpm check` passed 1,544 tests before the final section-link/heading adjustment. Actual 360/1440 viewport checks found no horizontal overflow; Instrument Sans and 6px button radius match consumed Foliage tokens. Reduced-motion media emulation on the real page showed visible content with no active animations. Section links resolve and the taxonomy link was clicked successfully. The TSX undeclared-host negative probe exits 1 and identifies the temporary source file; probe removed.

Additional website evidence: 768px viewport has no overflow; Tab focuses the taxonomy link and Enter navigates to its target. Still required: owner visual/copy approval, measured contrast, complete keyboard/screen-reader review, all first-customer states, and integrated release validation. The destructive/excluded correction fixes semantics in the bridge; it does not prove contrast for every future destructive component. No customer data was published during this work.
