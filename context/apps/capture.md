# Native capture clients

## Status

Desktop artifact handoff is specified in unit [33](../specs/33-capture-clients.md); no native
application package exists here. Existing local file/session adapters are the reuse path.
The separate local web capture adapter is implemented in
[`tools/capture`](../../tools/capture/capture.mjs). It records an owner-selected loopback page
as a real PNG still and short MP4; it is not the proposed native desktop client.

## Responsibility

Collect owner-authorized local artifacts and media while preserving provenance and privacy. Native capture is a source adapter to Photosynthesis, not another portfolio or publication database.

## Runtime and interfaces

Start with owner-selected local files and retained Claude/ChatGPT exports. Handoff uses the
existing artifact/cell contract with source identity, captured-byte digest, MIME and observed
time; metadata-only capture stays explicit. The native adapter owns platform permissions and
file-picker packaging. Native build tools are separate from the Node runtime. No hardware
attestation or hidden account scraping is implied.

## Storage and access

Keep raw private material local by default. Consent to capture is distinct from consent to publish. Source availability, redaction, media ownership and reproducibility must be explicit. Attestation requires a verifier and cannot be asserted from self-report.

## Data flow and acceptance

Permission → selected capture → retained local artifact/provenance → Photosynthesis candidate
→ human review. Revoked file access prevents new reads without erasing prior review decisions.
The [capture specification](../../docs/LEAFLET-CAPTURE-SPEC.md) retains broader native design
history; the current scoped implementation and evidence requirements belong to unit 33.

For local web pages, the owner can use Work → Capture work,
`node foliage.mjs capture --url http://127.0.0.1:<port> --garden /absolute/garden`, or an
explicitly enabled local MCP tool. Chrome/Chromium and ffmpeg
are required. The selected origin is pinned for the MCP connection; the capture browser refuses
cross-origin page requests. PNG and MP4 bytes, digests, and a private receipt stay in the garden.
The still and MP4 enter the existing `/review` queue as one unreviewed candidate. Approval and
promotion keep both private and pending; sharing and publication require their own owner decisions
and policy. Canopy requires a separate video selection and publication confirmation. See the
[local web capture contract](../../docs/capture-agent.md) for exact limits and failure behavior.
When the owner pins a loopback origin and opts into the demo browser for the MCP connection, the agent can inspect a bounded
preview, choose a scene in the same isolated browser, measure visible browser/layout failures,
and record it into that same queue. The browser is a disposable host process, not a VM.
The preview goes to the connected agent; the browser neither discovers arbitrary apps nor
grants publication authority.

## Ownership

[Canonical architecture](../architecture.md) identifies implementation status. The local web
adapter does not implement the native client. Do not create a native application manifest or
broaden a licensing boundary merely to make that planned entry look implemented.

## Agent-host capture direction

Direct OpenClaw and Hermes connections supply Photosynthesis with scoped sessions, artifacts
and lifecycle events. Prefer supported host interfaces before broad computer observation.
The [harness specification](../proposals/portfolio-harness.md) defines proposed identity,
checkpoint, revocation and location behavior; no host API compatibility is asserted yet.

## Aside installation

The source installer and local release archive include the optional Aside CLI/MCP setup
adapter. It uses Aside's documented stdio server alongside the fixed-garden Foliage server;
it does not add a browser-history collector or change browser permissions.
[Setup and acceptance](../../docs/ASIDE-INSTALL.md) distinguishes installed tooling,
REPL readiness and a real selected-page import. Claude owns the learning/capture workflow;
this installer slice reuses the existing observation intake and adds no parallel queue.
