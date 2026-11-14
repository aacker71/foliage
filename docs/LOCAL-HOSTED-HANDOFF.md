# Local Leaf → hosted Canopy

The Canopy companion sends the existing gated public projection from the selected garden to
one operator-configured HTTPS Canopy service. It reuses that service's account verification,
admission, immutable publication operations and current reader authority. The open Leaf app
imports no closed package and never receives account credentials.

## Run

Configure and deploy the hosted application first using [the hosted server guide](../supabase/README.md).
Set `FOLIAGE_HOSTED_ORIGIN` to its exact HTTPS origin, with no credentials, path or trailing slash.
Start `node foliage.mjs canopy --garden /absolute/path/to/your/garden` and open **Live portfolio**
from the local publishing workspace. Use available `--manage-port` / `--public-port` values when
other processes own the defaults. The launcher checks port availability.

For an outside pilot without a repository checkout, build the closed companion separately:

```bash
pnpm run build:bundles
pnpm --filter @foliage/canopy-app workspace:build
node tools/deploy/package-canopy-companion.mjs /absolute/new/package-directory
```

Archive that new directory, record its SHA-256 outside the archive, and distribute it only
through the approved controlled channel. The recipient verifies the digest, extracts it,
and runs `node install.mjs /absolute/new/companion-directory`. From the installed copy:

```bash
node /absolute/new/companion-directory/canopy.mjs \
  --garden /absolute/existing/foliage-garden \
  --hosted-origin https://your-configured-canopy.example
```

This `--garden` must be the same private garden used by the separately installed open Foliage
app. The companion archive contains neither that garden nor account credentials. Installation
does not start a process; launching does not connect an account, send work, or publish.
The hosted origin and account service are configured separately. The open archive cannot run
`foliage canopy` by itself because it deliberately excludes the closed application. The
hosted browser's JSON import is a fallback for an existing published-artifact export; it
does not turn the open app's static HTML export or private `leaf.json` into a hosted publication.

The launcher selects `FOLIAGE_HOSTED_STATE` as `hosted/connection.json` in the same garden.
A direct manager invocation must explicitly set that path, `FOLIAGE_LEAF`, and `FOLIAGE_POLICY`.
The companion refuses path collisions among its connection, status, Leaf and policy files.
It does not reuse the public reader origin as account authority.

Choose **Continue with Google** on **Live portfolio**. The browser signs into the configured
hosted account, then returns a short-lived device grant to the loopback manager. No password
passes through or is saved by the companion. Access and refresh credentials are stored in the private
connection file (mode 0600); browser HTML and workflow state never contain them. Treat the garden
as private, including backups. The repository ignores `connection.json`, `*.connection.json` and
`hosted/status.json` at any depth, with an executable guard. A custom state filename must remain
outside the repository or receive its own ignore rule. This version uses filesystem protection, not an OS keychain.
Disconnect removes local credentials even if remote session revocation cannot be confirmed.
An uncertain refresh removes the credential and requires sign-in again, without discarding the
publication operation.

## The person's decisions

1. Choose and review offered work locally. Select individual narrative paragraphs using the unchecked controls on `/hosted`; omitted text stays private. Source and policy digests bind the selection and preparation.
2. Prepare in Canopy. Only the public projection and any explicitly supplied public GitHub proof
   coordinates cross the connection. Canopy reserves the Leaf's address and checks account,
   format, policy and supported proof; preparation does not publish.
3. Read the exact private portfolio preview. Its renderer is the same as the hosted public
   reader. Inspecting all fields is also available. Type the portfolio address and publish or
   replace deliberately. Local source or policy changes invalidate that review.
4. Read the committed receipt and the separately dated current hosted observation. A historical
   publication receipt is not evidence that its revision is still public.
5. Withdraw deliberately using the observed revision and generation. The hosted store rejects a
   stale decision; successful withdrawal stops future reader requests. Downloaded copies remain
   outside this authority.

The current text-only publication uses artifact version 5 for selected narrative and named
views. Version 6 is used only when the owner explicitly selects photos and reviews the
metadata-stripped renditions that will cross. Unselected body text and media stay private.
See [public narrative](PUBLIC-NARRATIVE.md) and the [photo contract](PUBLIC-PHOTOS-IMPLEMENTATION.md).
This implementation does not claim visual/content parity with the richer local portfolio,
unattended public publication, or a completed customer launch.

## Interrupted decisions

The companion saves the operation identity, reviewed payload and expected generation **before**
sending a publication or withdrawal. A missing or invalid acknowledgment retains an unconfirmed
operation and blocks another preparation. Check the original operation after restart/reconnect.
A matching receipt resolves it without another publication. A missing receipt is not proof that
an in-flight request cannot still commit; the explicit retry keeps the original identity and
bytes. Hosted idempotency and revision checks remain authoritative.

The companion checks receipt subject, kind, identity and expected generation. It reads current
public bytes separately and verifies their canonical digest before updating `hosted/status.json`.
The personal workflow reads that bounded, non-secret observation only for its selected Leaf.
It names the check time and whether local source/policy changed; it does not poll the service,
claim current availability, or gain authority to publish. Run the local Canopy companion to
refresh the observation. Existing application collection schedules remain separate.

## Transport and validation

`/api/session` and `/api/session/refresh` accept explicit credentials; other `/api` routes require
a bearer token verified by the hosted identity provider. Device routes refuse Cookie and Origin
headers and do not enable CORS or set browser cookies. Browser account routes retain their
separate CSRF/cookie contract. Local mutations retain loopback Host, Origin and CSRF checks.
Requests have deadlines, refuse redirects and bound response bytes. Private state uses existing
atomic document writes and locks; no new publishing domain engine was added.

Automated coverage uses actual temporary Git observations for the local intake and an explicitly
synthetic account/store HTTP harness for interrupted publication, stale review, wrong accounts,
invalid receipts, withdrawal and lost refresh. These tests establish application contracts, not
successful calls to a configured customer Supabase project. That project/account choice and
real provider plus independent-reader acceptance must be recorded before launch.
