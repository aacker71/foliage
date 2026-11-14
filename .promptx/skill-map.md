# gstack skill map — every skill accounted for, by persona

Tiers: **main** = main session only (fires owner gates / interactive setup — fatal in a subagent).
**Persona** = runs under that persona; in a spawned run its gates resolve by the spawned rule.
**any** = utility any persona may call. Infra dirs (lib, bin, docs, scripts, patches, agents,
claude, contrib, design, extension, hosts, model-overlays, node_modules, openclaw, supabase,
test, browser-skills) are not skills and are not invocable.

## Planner (multiplan manager)
/office-hours · /plan-ceo-review · /plan-eng-review · /plan-design-review · /plan-devex-review
· /autoplan · /spec · /retro · /plan-tune
→ ALL of these gate on the owner, so they run **main-session under the planner persona** —
a spawned planner applies their method and marks every would-be gate `OWNER:` in the brief.

## Developer
/investigate (root-cause method; no fixes without investigation, stop after 3 failed) · /qa (find
AND fix) · /design-review (audits then FIXES — edits, so it is developer work under a design lens,
never the reviewer's) · /document-generate (writes docs) · /codex (second-model exec)
· /ios-fix · /ios-clean · /ios-sync

## Knowledge tools — two graphs, two lanes (no overlap by assignment)
gbrain = SEMANTIC recall ("where is X handled", decisions, notes) — every persona.
graphify = STRUCTURAL graph ("what does this PR touch", get_pr_impact/triage_prs, god nodes,
communities, shortest-path) — primarily reviewer (PR blast radius) and planner (architecture
splits). Un-retired 2026-08-29: the 08-26 retirement predates the PR workflow that is now its
consumer. If the two ever answer the same question differently, that is a finding, not a choice.

## Reviewer — NEVER edits; anything that fixes belongs to the developer
/review · /qa-only · /devex-review (live DX audit, report only) · /cso (OWASP+STRIDE, verified findings)
· /ios-qa · /ios-design-review · /benchmark · /benchmark-models · /health (read-only dashboard)

## Merger
/ship · /land-and-deploy · /landing-report · /canary (post-deploy watch) · /document-release

## Rebaser
(no gstack skills — git + the persona's own rules; /careful applies if loaded)

## Main session only — owner-present or environment-mutating
/design-consultation · /design-shotgun · /design-html (the design pipeline — owner taste gates;
design-html's output hands off to a developer run) · /learn · /gstack-upgrade · /sync-gbrain · /setup-gbrain · /setup-deploy
· /setup-browser-cookies · /context-save · /context-restore · /scrape · /skillify · /pair-agent
· /connect-chrome · /open-gstack-browser (both superseded for browsing by BrowserOS neo —
owner directive 2026-07-18; gstack-internal fallback only)

## Any persona (utilities, no gates)
/browse ($B headless probes) · /diagram · /make-pdf
· /careful /freeze /guard /unfreeze (session safety modes — set in main, honored everywhere)

Canonical specialist descriptions: the gstack skill table (docs). The naming trap this map
already caught twice: a skill NAMED review that EDITS is developer work — assign by behavior,
never by name.

Rule of thumb when a new skill arrives: does it fire an owner gate → main (under the closest
persona's lens); does it edit → developer; does it judge → reviewer; does it land → merger;
else → any. Update THIS file in the same PR that adds the skill routing.

## Standalone binaries (not skills — CLIs any persona shells to; canonical docs list)
gstack-model-benchmark · gstack-taste-update · gstack-egress (receipts: list/grants/verify)
· gstack-context-bill (token cost of the skills tree — the factor-3 meter)
· gstack-code-intelligence · gstack-verify-gate (opt-in Stop hook; owner-trusted per repo)
· gstack-wtree + gstack-evidence (bind test evidence to working-tree fingerprints — mergers cite
FRESH evidence instead of re-running suites) · gstack-issue-guard (wrap ALL tracker text before
an agent reads it — mandatory once Jira/GitHub issues start flowing in)
· gstack-ios-qa-daemon/-mint/-regen · $B domain-skill / $B cdp (allowlisted CDP escape hatch)
