# Current state

Snapshot taken **2026-11-12** from the `main` branch as of 2026-10-23 (version `0.3.1.0`).
Each claim carries a label: **verified** (measured on this snapshot), **built, unverified**
(code and local tests exist, nothing observed in a real deployment), or **in flight** (not in this tree).

## What Foliage is

A private, living record of what a builder made, decided and learned, with evidence attached.
A portfolio or résumé is a selective view of that record. It runs on your own computer, and
nothing is published without your approval. No score appears anywhere an employer sees.

## What is in this tree

| Area | Where | State |
|---|---|---|
| Local app: Work, Review, Sources, Portfolio, Scarlet | `apps/leaf`, `apps/photosynthesis` | Built. Runs from `node foliage.mjs up`. |
| Evidence intake from git, with draft-then-approve review | `packages/photosynthesis`, `apps/photosynthesis` | Built. Nothing becomes part of a portfolio without a person's approval. |
| Local brain: search over your record, no network | `tools/brain`, `apps/leaf` | Built, opt-in. Needs the pinned brain staged under `vendor/` (see DEVELOPMENT.md). |
| Assistant access over MCP (`foliage_search`, selected-observation submit) | `plugin/foliage`, `docs/ASSISTANT-MCP.md` | Built. |
| Demos recorded from an app on your machine, reviewed like any draft | `apps/leaf`, `docs/` | Built. |
| Publication: prepare, replace, withdraw a public portfolio | `packages/canopy`, `apps/canopy` | Built. Deployed behaviour (accounts, CDN, withdrawal reachability) is **unverified**. |
| Hosted app surfaces (Supabase Auth and Postgres, Clerk, Novu) | `apps/canopy`, `supabase/` | Built, unverified in a live deployment. A configured provider or a passing local test is not a deployment. |
| Enterprise: org hierarchy and release policy | `apps/enterprise`, `packages/enterprise-policy` | Built, unverified with a real organization. |
| Website | `apps/www` | Built. |
| macOS arm64 download (Node archive with local brain) | `tools/deploy` | Packaging code is here. Built archives are not committed; build one with `node tools/deploy/package-local.mjs --archive` (see `--help`). |

## In flight at snapshot time (not in this tree)

These were open pull requests on the original private repository. They are not merged, and their
state is unreviewed here.

- **Design and UI:** public portfolio redesign and image-first layouts, a shadcn theme bridge and vendored
  components, a full design pass.
- **Integrations:** import a GitHub Pages site, a Figma frame, designer images and personal project artifacts into
  private review; suggest which commits back an imported portfolio claim.
- **Local brain:** search, refresh, keep-current, offline gate, packaging and opt-in local embeddings.
- **Canopy hosting:** Stripe checkout and billing, Scarlet inside Canopy hosting.
- **Mobile:** Scarlet-first iOS and Android companion apps.
- **Specs:** team portfolios (people who built a project share one project portfolio), public brain mirror.

## Known limits

- First-use timing for a new user is unmeasured.
- No real outside-user pilot has run. Green tests and previews establish that the code works, not that
  the product works for a stranger.
- The hosted pieces have not been exercised in a live account.
- `docs/` holds many dated planning and audit records. See [README.md](README.md) for which are current.

## Verification

**Verified, 2026-11-12:** `pnpm check` exited 0 on this snapshot as a fresh single-commit clone (no prior history) with the
pinned brain staged under `vendor/`: 3,029 tests, 3,027 passed, 0 failed, 2 skipped, and the brain offline check
reported green. This says the code and its tests agree. It does not say the product works for a
stranger or that any hosted piece is live.

A full scan of the files and of the original history found no committed credentials. The original history
is not part of this repository.
