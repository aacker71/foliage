# Customer journey execution

*Historical record of the 2026-09-05 rehearsal. The servers it names (127.0.0.1 ports 4189,
4191–4194 and 4200–4202) are no longer running, and ports 4173–4199 now belong to other
long-running servers. Start the current app with `node foliage.mjs up`.*

User authorized all four stages on 2026-09-05. Work is isolated on `codex/customer-journeys` in `/private/tmp/foliage-customer-journeys`. The integration combines the current product branch with the themed prototypes; it is local, not deployed.

## 1. Individual: actual source to reviewed portfolio

Use the current `foliage.mjs` and `apps/leaf/server.mjs`. The older dashboard has an unwired decision endpoint and is not the supported journey. Do not connect a new UI to that legacy path.

The server then ran at http://127.0.0.1:4191 with an isolated garden under `/private/tmp/foliage-customer-rehearsal`. Browser review confirmed Overview and the honest missing-harvest state. No source or subject has been assumed. The source path, subject name and declared author email(s) have been requested from the owner.

Once supplied, run `node foliage.mjs --garden <isolated garden> grow --repo <approved path> --subject <declared name> --identity <declared email>` (repeat identity as needed). Inspect the actual candidates at `/review`, record explicit decisions, promote through the real gate, inspect `/leaflet/<id>`, and inspect `/publish`. Record real errors and withheld items. A CLI or agent rehearsal does not establish successful use by a non-owner.

The themed website controls remain in prototypes. Their integration into this no-script local runtime still needs implementation; running the real service does not complete shadcn adoption.

## 2. Hosting and Recruiter: publish, read, withdraw

Local manager: http://127.0.0.1:4192 . Local public reader: http://127.0.0.1:4193 . Both share only the isolated publication directory. Browser review confirmed the manager reports no local leaf and the reader reports nothing published for a missing identifier.

After the Individual artifact exists, inspect the exact eligible outward artifact in the manager. Make publication a separate explicit act. Read the returned publication URL, replace deliberately, then withdraw and verify a subsequent request cannot retrieve it. Exercise unavailable storage and failed publication without asserting success. These local filesystem checks do not establish authenticated local-to-hosted publication or cross-instance withdrawal.

## 3. Organization and Member

The real company server then ran at http://127.0.0.1:4194 with an explicit local subject role and an absent company manifest. Browser review confirmed the missing manifest is reported instead of showing invented members.

Implemented launch-safety fixes: no implicit policy-owner role; the unauthenticated server refuses non-loopback binding; invalid ports are explained; malformed/unreadable release history fails rather than appearing empty; loaded history is replayed through the release state machine to detect invalid transitions or actors.

Remaining: approved company manifest and membership identities, authenticated actor binding, distinct Member surface, policy explanation and eligible takeout. A local environment role is not an authenticated company identity. Existing release state transitions do not themselves prove that hosted publication or withdrawal occurred.

## 4. Launch acceptance and support

Before accepting a customer release, collect evidence for the exact candidate: source-to-review completion, publication and withdrawal, company/member access separation, keyboard and screen-reader use, empty/error/recovery states, backup/restore preserving withdrawal, supported deployment configuration, and a staffed support path. Record any human intervention during the first-user trial. No invented participant or success tally.

The source-backed trial, company authorization and hosted delivery remain open. Production account/hosting configuration and the person responsible for customer support must be established before a public launch claim. No remote deployment, external publication or customer message was performed by this run.

## Local rehearsal operations

Service PIDs, ports, working directory and log paths are recorded in `/private/tmp/foliage-customer-rehearsal/servers.json`. Every port was checked before binding and its listener checked against the started PID. Keep state outside the repository. Stop only the recorded processes after confirming ownership; do not kill unrelated port listeners. Existing prototypes remain available at http://127.0.0.1:4189/prototypes .

## Connected Hosting follow-through (2026-09-05)

The local Hosting React workspace now performs review → explicit publication → public-reader handoff → withdrawal against the existing service. See UI-FOUNDATION.md for integration and evidence. Rehearsal used `/private/tmp/foliage-simulated-review/leaf.json`, which derives from repository history and labels its simulated review honestly. Its 278 entries were all withheld, so the released artifact contained no claims. The local browser published it and withdrew it; the reader subsequently reported absence. No external release occurred.

The connected manager and reader run on 4201/4202, with isolated storage and process registry under `/private/tmp/foliage-hosting-connected`. The five design prototypes remain separately available on 4200. This completes the local Hosting UI integration slice; hosted transport, real-user acceptance and company/member authorization remain open.
