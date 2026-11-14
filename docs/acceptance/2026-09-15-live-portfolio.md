# Live portfolio integration — local acceptance, 2026-09-15

Candidate: `codex/live-portfolio-integration`, implementation merges through `b1d6064`.
The subsequent acceptance commit adds truthful local/cloud banner wording, mobile toolbar wrapping and these records.
This is an isolated local rehearsal, not owner-authored biography, production deployment,
or acceptance of all 35 product units.

## Provenance and checks

- `9797a78`: preserve 186 original source/context paths from `codex/canopy-cloud@84083dd`.
  Private `.mcp.json` was not copied or staged. Original checkout hashes remain unchanged.
- `c2e574c`: integrate `codex/portfolio-achievements@5f9fa1b`, preserve original local
  workflow, resolve naming/wire contracts, bundle/type/export and process-ownership seams.
- `b1d6064`: reconcile `codex/b00-package-runtime@07d4feb` while retaining newer receipts.
- One independent final `pnpm check` completed successfully: 2,094 tests, zero failures,
  plus architecture, environment, licensing, egress, duplication, findings and type gates.
  Initial integrated log: `/tmp/foliage-integration-final-check-0915.log`. Final code after
  the browser fixes also passes all gates and 2,094 tests:
  `/tmp/foliage-integration-release-check-0915.log`. An intermediate check caught the longer
  banner exceeding the existing text-density budget by one word; shortened wording passes
  the 121 focused UI tests and the final full check. Findings remain nonblocking work;
  passing that gate is not a claim that the findings register is empty.
- All four optional browser bundles were built: Leaf explore, shared portfolio renderer,
  Leaf workflow and Canopy workspace. The server retains native TypeScript execution.
- Export now includes linked marketing/demo routes, portfolio CSS and all referenced marks.
  Its demo is an honest read-only explanation in a static export; server text preview remains interactive.
- Large Git patches retain a bounded, explicitly incomplete excerpt rather than making the
  local assistant report all source evidence unavailable. Other read failures still refuse.

## Actual data and repeat updates

Original `~/.foliage/leaf.json` has 235 retained Leaflets and no authored achievements.
It was never written. SHA-256 remains
`fb33dc43c5d701b7f91649ab4ef800b639f8616741dc4dbda18c81d9ab55bc45`.

A private pilot under `~/.foliage/pilots/live-portfolio-integration-20260915-v2` uses a copy
of that document. An isolated Git source advances between real adjacent commits `84083dd`
and `9797a78`; a shallow boundary limits intake without inventing commits. The agent records
its own rehearsal review identity, never pretending that the portfolio owner reviewed it.

Passed:

1. First collection, explicit draft decision and transfer into a pending/private Leaflet.
2. A real second commit reopens review, retains the chosen title and updates the same
   packet/Leaflet rather than duplicating it. A third unchanged collection adds no packet.
3. A drafted Foliage achievement, exact supporting citation and named Leaf view persist
   across the update. Unrelated records remain unchanged. Stale review is rejected.
4. A separate local publication copy offers only that pending Leaflet outward. The public
   gate admits one record and withholds the other 235 as not shared. No proof tier is upgraded.
5. A reviewed publication revision replaces the same loopback `/leaf/alex-a` URL. Replaying
   the old public digest refuses without a write. Public HTML contains no local source path.

Private evidence: `local-cycle-report.json`, `public-cycle-report.json`, `resume.md` and
`public-update-review.log` in the pilot directory. The earlier pilot retains a failed harness
attempt: its collection kind `project` was correctly refused; the accepted kind is `body-of-work`.

## Browser observations

The gstack visible browser renders the real private portfolio and the admitted public leaf
with Three.js. The initial headless driver failed to create WebGL; the readable fallback
remained available. Visible mode reports `portfolioReady=true` with 236 private blades
and one public blade. Private newest-first and public oldest-first sorting operate, along
with pause/resume. Public citations navigate to the exact retained source, ref and observation
time. The initial public mobile toolbar overflowed when two selectors were present; wrapping
fixes it. Both surfaces now report a true 390×844 viewport, the mobile media query active
and no horizontal overflow.

The workflow identifies collection on this device, Photosynthesis local AI, and an unavailable
Ladybug cloud companion separately. The studio banner now says cloud review is by choice,
instead of asserting that nothing can leave the device. Browser console includes a CSP
warning from gstack's injected status overlay; do not weaken the application's CSP for it.
The local Photosynthesis form returned an actual answer from Ollama `llama3.2:3b`, using
the displayed bounded title context. The browser click timed out while inference continued;
the resulting answer was then read from the page. This is local assistance, not Ladybug cloud.
No original biography, portrait, media or business outcome was invented to fill empty content.

## Explicit remaining gates

- Fireworks accepted a benign `READY` inference request using the configured Kimi model.
  This proves inference availability, not privacy/residency or a successful evidence review.
  Approval was requested for one bounded repository-only cloud rehearsal; it is pending.
  The reviewable `cloud-review-packet.json` is prepared in the private pilot directory:
  222 evidence characters, two actual commit references, no source bodies or local paths.
- Hosted Supabase project, live identity/storage/RLS, notification delivery and deployment
  acceptance remain unverified. A local Canopy publication does not establish those services.
- Public Ladybug conversation, member/industry/enterprise scope and hardened cloud execution
  retain their unit-level acceptance requirements. This four-step portfolio integration does
  not silently mark the broader product plan complete.
- The real owner must supply/approve their biography, achievements and media, and explicitly
  select what is published. Rehearsal draft prose remains in the isolated copy only.

## Vercel verification follow-up

Read-only checks on 2026-09-15 confirm Vercel is already the hosting provider; no provider
selection is outstanding. `claude mcp get vercel` locates the user-scoped HTTP MCP at
`https://mcp.vercel.com` but reports **Needs authentication**. Vercel MCP tools are not
exposed in the current Codex session.

Authenticated GitHub deployment records for `aacker71/foliage` report:

| Project | Latest recorded production | Latest recorded preview | Result |
|---|---|---|---|
| foliage-www | 2026-09-11, `68fe1db`, deployment `6384296256` | 2026-09-12, `0e8a65d`, deployment `6406262202` | Both successful |
| foliage-canopy | 2026-09-11, `68fe1db`, deployment `6384295071` | 2026-09-12, `0e8a65d`, deployment `6406260299` | Both successful |

The gstack browser opened both recorded production deployment URLs; both redirect to
Vercel sign-in. That confirms deployment protection is encountered, not that application
behavior, environment settings or the current production alias were inspected. No protection
was bypassed or changed.

The GitHub commit endpoint does not contain local integration `6422b65`. These existing
deployments therefore do not establish deployment of the latest local integration. Next:
reauthenticate Vercel, inspect the intended project/alias and environment, then prepare the
current candidate for its existing deployment pipeline. No push or deployment was performed
by this verification.


## Actual preview deployment and continued development — 2026-09-15

This supersedes the earlier outstanding-deployment status above. User authorized test
publication and normal browser authentication. Vercel CLI 59.16.0 authenticated as `aacker71`
in `<vercel-team>`; MCP OAuth succeeded in the browser but the Claude connector's
Keychain/client state remained unavailable, and no Vercel MCP was exposed in Codex.
CLI access was used without weakening deployment protection. GitHub authentication was
unavailable on the later check; no push was made.

| Surface | Candidate / deployment | Observed result |
|---|---|---|
| Website | `01ef5f2`; `dpl_J7CNy7xXU3oPEQHXeYByqFroyehz`; [preview](https://foliage-1j87eu8hj.example.invalid) | Vercel Ready; native browser rendered heading, taxonomy, proof states and honest no-published-leaf state; How it works anchor navigates |
| Canopy, initial package | `01ef5f2`; `dpl_7KNQrdSiiJPotHjcGJZrBUgGDTaD`; [preview](https://foliage-canopy-1rnbilqgf.example.invalid) | Ready; browser showed missing hosted configuration refusal |
| Canopy, diagnostics correction | `d1e62a4`; `dpl_GYyhvVF61ZappsXEXfDE57sSKxCB`; [preview](https://foliage-canopy-ftldlm4sq.example.invalid) | Ready, preview target, native Node 22 function in iad1; browser refusal and Vercel request log confirm `/` HTTP 503 |

Local website build succeeded. Canopy's package contains 204 workspace files across nine
workspace packages and 91 external production packages. It uses Build Output v3 and native
TypeScript without a server dist build. The package was built locally and uploaded prebuilt;
source-based remote packaging and automatic Git deployment are not established by this run.
Production aliases were not promoted or reconfigured.

The initial deployment dry run unexpectedly included `.gstack` browser logs and agent
control files. This was caught before upload. Commit `01ef5f2` adds root `.vercelignore`
for agent state, environment files and local evidence. Subsequent dry runs reported zero
blocked private paths: Canopy 5,131 files / 63,270,939 bytes, website 721 files / 12,315,652
bytes. These are input-inventory measurements, not portfolio evidence. No original private
Leaf document was published or evidence sent to Fireworks.

Canopy has **no environment variables in either preview or production**, confirmed with
Vercel's environment listing (names only). Required preview setup: `FOLIAGE_APP_ORIGIN`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) and
`SUPABASE_SERVICE_ROLE_KEY`. These must belong to the intended preview environment.
The owner was asked to identify the Supabase preview project; no credentials were requested
in chat. Optional Novu configuration has a separate completeness gate. Identity callbacks,
schema/RLS, object storage and actual account/publication flows remain unaccepted.

Commit `d1e62a4` improves startup observability: `canopy.hosted.unavailable` contains only
controlled stage names, missing setting names and recovery instructions. Partial notification
setup fails before adapters initialize. Raw errors, credentials and portfolio/request data
are withheld. Public responses remain uncached 503 and never use local publication authority.
The live Vercel request log proves the 503, but did not include the cold-start console event;
remote console-event retention/collection is not accepted from this run.

Validation:

- Focused hosted adapter suite: 32 passed, zero failed, including missing-setting reporting,
  both public-key aliases, partial notification configuration and secret-canary non-disclosure.
- Full `pnpm check`: architecture, runtime, licensing boundary, egress, duplication, findings,
  typechecking and 2,096 tests passed with zero failures. Log:
  `/tmp/foliage-preview-diagnostics-check.log` (test duration 118,848.9205 ms).
- Browser verification used the authorized native browser session and reused the auth tab.
  Website rendering is website acceptance only; it does not demonstrate a hosted 3D portfolio.

Deployment logs and environment evidence remain local under `/tmp/foliage-*-preview-*` and
`/tmp/foliage-canopy-diagnostics-*`. These transient logs are not committed as data.
The next functional gate is the selected Supabase preview backend, followed by real sign-in,
public-review publication, repeat update and withdrawal on the hosted authority.


## Supabase preview setup follow-up — 2026-09-15

The authorized native browser is already signed in as `aacker71`. The organization selector
shows Coeadapt (`oivfpzvcgbyloabhmucu`, Free); its project list contains Coeadapt and
Foliage Brain, both in `us-west-2`. No dedicated Canopy application project was present.
Per the deployment plan, Foliage Brain was not reused or changed.

Prepared, but did not submit, a new-project form: `foliage-canopy-preview`, Coeadapt,
East US (North Virginia, `us-east-1`), Data API enabled and automatic exposure of new tables
disabled. The browser populated a masked password through autofill; no password was read,
chosen, copied or submitted by the agent. The owner was asked to replace it with a unique
password, save it, and submit the form themselves. Computer-use credential creation requires
that handoff. Any paid upgrade remains unapproved. No new project ID, database migration,
Vercel environment change or hosted functional acceptance is claimed yet.

Independent preparation completed: both actual SQL migrations ran in disposable PGlite
Postgres through the existing publication and notification suites: **17 passed, zero failed**.
This exercises transactions, ownership, withdrawal, privileges and notification-state behavior;
provider-owned auth/storage tables are explicit harness substitutes. It does not establish
Supabase Storage behavior, multi-instance locking, live Auth or provider backup/restore.
Log: `/tmp/foliage-supabase-preview-sql-check.log`.

The Canopy environment template now documents the previously missing hosted settings,
public-key alias precedence and the exact Auth callback relationship. On resume, finish
project provisioning, confirm the selected project is isolated, apply the migrations once,
configure the stable preview origin and server-only keys, then redeploy and exercise the
real hosted flows. Keep the pending project form in the browser for the owner.


## Remote provisioning completed through official CLI — 2026-09-15

This supersedes the password-form blocker above. The owner was remote. The official
Supabase CLI 2.117.0 supports a browser account authorization flow; it authenticated through
the existing signed-in session without entering a new database credential in the browser.
The short-lived verification code was exchanged by the CLI; no account access token was
printed. The interactive CLI requires `--output-format text --agent no` in this host and
carriage-return submission; JSON mode cannot prompt.

The authenticated CLI created **foliage-canopy-preview**, project `ilxdoyfwspgoupxtyirg`,
in Coeadapt's Free organization, `us-east-1`; creation returned ACTIVE_HEALTHY. No paid
size/add-on or upgrade was requested. A generated database password and preview API keys
are stored with owner-only file permissions under `~/.foliage/private`, never in the repo.
The existing Coeadapt and Foliage Brain projects were INACTIVE before provisioning and
were not selected for migrations or configuration.

Both tracked SQL migrations were applied once to the new project's previously empty
application schema. Live inspection reports RLS enabled on all seven Foliage tables and
no SELECT/INSERT/UPDATE/DELETE privileges for either anon or authenticated browser roles.
Default table privileges for future postgres-created public tables were also revoked from
those roles. The actual `foliage-publications` bucket is private. An anonymous REST read
returns HTTP 401 / SQL 42501 permission denied. A public bucket URL returns HTTP 400
NoSuchBucket. No public object or positive storage-read claim was fabricated from that test.

Supabase Auth now uses the stable preview origin and its exact `/auth/callback` URL.
`config diff` showed only those two declared changes; `config push` preserved eleven
undeclared settings, including email confirmation and MFA. Four preview-only Vercel settings
were installed as secrets: app origin, Supabase URL, publishable key and service-role key.
Production settings were untouched.

Configured deployment: `dpl_2V4v2uxp23eoD6kiCuPKofZdmDET`, source metadata `34636d0`,
[immutable preview](https://foliage-canopy-53b2xc6rr.example.invalid).
The [stable preview](https://foliage-canopy-preview.example.invalid/manage)
alias points to it. Vercel reports Ready, preview target. Native browser and provider request
logs show `/manage` → 303 sign-in redirect, `/auth/sign-in` HTTP 200, all requested CSS,
marks and self-hosted fonts HTTP 200. A deliberately nonexistent publication returns HTTP 404 and renders
“This publication is unavailable.” Unauthenticated external HTTP requests still redirect
to Vercel SSO; deployment protection was not disabled.

Evidence: `/tmp/foliage-supabase-migration-01.log`, `-02.log`,
`/tmp/foliage-preview-rls-gates.json`, `/tmp/foliage-preview-live-db-gates.json`,
`/tmp/foliage-preview-auth-config-diff.log`, `-push.log`,
`/tmp/foliage-canopy-configured-inspect.log`, and
`/tmp/foliage-canopy-configured-requests.jsonl`. Secret-bearing CLI output was captured
only in private owner-readable files, never tool output or source control.

The browser database-password handoff is resolved. This run proves remote provisioning,
migration application, startup and anonymous boundary behavior. It does **not** yet prove
an actual application user's sign-in, email/recovery flow, positive publication/update/
withdrawal cycle, two-account isolation, multi-instance revocation, backup/restore or
notification delivery. No Auth account was silently marked email-verified, no owner portfolio
was published, and no evidence was sent to Fireworks.
