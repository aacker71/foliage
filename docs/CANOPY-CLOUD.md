> Scope and implementation status: [canonical architecture](../context/architecture.md).
> This document retains its dated decisions or detailed feature contract; it is not a second application inventory.

# Canopy Cloud

Canopy Cloud is the deliberate bridge between a Compound Leaf owned on one person's computer and
a public portfolio artifact. It is not a synchronization service. Nothing watches the local file,
and agent output never becomes a publication as an automatic side effect.

**Implementation scope:** `foliage canopy` runs local, loopback-only manager and reader
processes. With an explicitly configured `FOLIAGE_HOSTED_ORIGIN`, its **Live portfolio**
page also connects the selected local garden to the hosted account and publication service.
The service has account admission and durable publication/withdrawal code, but starting the
launcher does not deploy it or create a cloud account. Configured provider acceptance and
customer deployment remain launch gates. See [the local hosted handoff](LOCAL-HOSTED-HANDOFF.md).

The frozen public format carries explicitly offered **verified and pending titles**, their
stated proof tier and any recorded provenance. Version 4 also carries individually selected narrative paragraphs and their references through the local `/hosted` review. Unselected body text, media and unapproved review candidates stay local. Attribution, absolute deny rules and redaction still apply. The shipped no-evidence
rule can withhold a pending leaflet without provenance; pending itself is not a publication refusal.
Review the exact reader output before making a content-parity promise.

## The journey

1. **Compound Leaf stays local.** ChatGPT, Claude, or the configured Fireworks/Kimi route may help
   read sources and prepare structured input. The local leaf remains the person's record.
2. **Ordinary code reviews egress.** The publisher re-reads the leaf and policy, accepts only the
   closed document formats, applies attribution and absolute deny rules, preserves proof tiers, and runs the
   deterministic redaction gate.
3. **The person decides.** The private manager displays exactly what will cross, what stays
   private, and what the mechanism cannot detect. Publication requires typing the exact leaf id.
   The decision is bound to digests of the reviewed leaf bytes and effective policy. Replacement
   is a second decision and shows the reader-visible diff first.
4. **Canopy serves one artifact.** The public process is read-only and revalidates the artifact on
   every request. The manager inventories public storage independently, so withdrawal remains
   available if the local leaf or policy is later missing, damaged, or changed.

New publications use artifact format version 4 (see [public narrative](PUBLIC-NARRATIVE.md)), recording both review-input digests and an
explicit tier on each leaflet. The reader keeps version 3, version 1 and both earlier version 2 formats:
policy provenance with implicit verified tiers, and explicit tiers without policy provenance.
It validates their original closed shapes and refuses mixtures. Reading never upgrades a file;
the manager offers a deliberate replacement to record the current format and policy provenance.

Run both origins with:

```bash
node foliage.mjs canopy
```

Run from the Foliage checkout after `pnpm install`, as in
[the quickstart](../TESTER-QUICKSTART.md). Use the same `--garden <path>` or
`FOLIAGE_GARDEN` as `grow` and `review`; otherwise the launcher uses `~/.foliage`.
`node foliage.mjs canopy --help` reads usage without starting either server.

Use `--manage-port` and `--public-port` when those defaults are occupied. The launcher checks both
ports before it starts either process, so it cannot mistake another service for its own.

`foliage export` is a separate local-copy operation. A distributed static folder has no
authoritative status check: withdrawing the managed/local publication cannot recall a
download, screenshot, or separately hosted copy. The hosted serving contract enforces
withdrawal on every subsequent serving request after durable acknowledgment, across all
routes and restores; it cannot rely on cache expiry or publicly accessible object URLs.
Each completed static export is immutable: use a fresh output directory for the next release,
then switch the host to that finished directory. The export command does not remove an older
copy from its host.

## Authority boundary

| Part | May read | May write | Network authority |
|---|---|---|---|
| Local agent | Sources its host already authorized | Structured local drafts through existing gates | Provider-specific; a shell-enabled agent may invoke local commands, so the confirmation step is explicit workflow, not proof of human presence |
| Private manager | Local leaf, policy, current public artifact | Invokes publish or withdraw after CSRF and typed-id checks | Binds loopback; optional explicit HTTPS Canopy connection |
| Publisher | One leaf, one policy, prior artifact when replacing | One atomic published document | None |
| Public server | Published documents | Nothing | Serves `GET`/`HEAD` only |

The public and private surfaces are different processes and origins. That separation makes the
authority difference inspectable instead of relying on route naming or UI convention.

## 12-factor-agent shape

The implementation follows the useful parts of HumanLayer's
[12-factor agents](https://github.com/humanlayer/12-factor-agents) without making the model the
application:

- Models produce structured input; typed parsers and policy code decide what is admissible.
- Prompts and context belong to the calling agent. Canopy receives a leaf document, not a chat
  transcript or hidden provider state.
- Application state is ordinary files with strict formats. A fresh process reconstructs the same
  publication review from those files.
- Control flow belongs to code. Review, consent, atomic write, serve, replace, and withdraw are
  explicit steps rather than one autonomous tool loop.
- Pause and resume are explicit. Hosted preparation reserves the address and saves a private review; it does not publish. A durable operation is recorded before publication or withdrawal is sent. Restart retains that identity and checks its receipt before retry.
- Agents remain small and replaceable. ChatGPT, Claude, and Fireworks/Kimi may prepare the local
  input, but all meet the same publication seam and none can override its policy checks.

## Failure posture

- Missing, unreadable, malformed, and invalid inputs remain different states.
- Every addressable public artifact remains visible in the private inventory. Malformed artifacts
  can be withdrawn by exact byte digest; unreadable bytes are named but never deleted blindly.
- A policy file that exists but fails to parse never falls back to a looser default.
- A document marked as an example is refused as a whole.
- A verified leaflet denied by policy remains private even after leaf-level sharing intent.
- An empty public leaf is valid when nothing passes the gates; the UI says that plainly.
- No screen computes or displays a score, and withheld entries are never presented as a hidden
  completeness percentage.
- One-use success notices are minted only after a command succeeds. Refreshing or forging a query
  string cannot claim a publication happened.
- Per-leaf filesystem locks serialize publisher and manager processes. The reviewed public
  artifact is compared again by exact byte digest under that lock before replacement or
  withdrawal. A lock left by an exited process fails closed for inspection and deliberate removal;
  it is never auto-reclaimed through a race-prone read-then-rename sequence.
- Confirmed publication also holds the local source and policy locks from fresh reads through
  artifact commit. Participating refresh, review, sharing and policy writers therefore cannot
  change reviewed inputs during that window. Both first publication and replacement expose
  only complete artifact bytes. These are local filesystem guarantees, not the hosted durability
  contract; see [local document coordination](LOCAL-DOCUMENT-SAFETY.md).

## Canonical Leaf visual foundation

The published-artifact reader uses the owner’s canonical Leaf reference: an editorial
subject header, labeled botanical specimen artwork, and Leaflets grouped by their
published source. Publication accounting remains available in a native disclosure.
The artwork is served locally by the self-hosted and hosted readers and travels with
static exports; its provenance is in [Canopy imagery](../apps/canopy/public/IMAGERY.md).

This artwork is product identity, not evidence of a person’s work. Version 4 still
publishes selected text only. Real image galleries, video, audio and document previews
require a reviewed attachment manifest, bounded media storage and delivery tied to the
current publication authority. The visual change does not implement that transfer or
make private attachments public.
