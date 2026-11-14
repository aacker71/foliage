> Historical snapshot preserved on 2026-09-14. Not current implementation authority.
> See [current architecture](../context/architecture.md) and its application inventory.
> Dates, measurements, open decisions and naming below belong to their original context.

# Foliage — product architecture specification

**Status: the spec of record for the PRODUCT.**

This file has two parts, and the split is the point:

- **Part I — §§1–9** is the owner's specification, reproduced **verbatim**. Not one word of it has
  been edited, condensed or corrected. Where it disagrees with the code, the disagreement is left
  standing in the text and answered in Part II.
- **Part II — §§10–11** was **added on filing, 2026-08-19**, and is **not the owner's text.** It
  records where the specification and the shipped tree collided, how each collision was resolved,
  and what remains genuinely undecided.

Companion documents, so nobody reads whichever they find first: **`docs/ENGINEERING-PLAN.md`**
answers *why the code is shaped this way*; **`.loop/ARCHITECTURE.md`** answers *how the three
delivery models compose*; this file answers *what the product is*.

**§§3–5 describe a system that does not exist.** No Supabase, no hosted inference, no local
chief-of-staff agent, no encrypted local store is built. Read Part I as intent, never as capability.

---

# Part I — the owner's specification, verbatim

# Foliage: The 11-Star Career AI Native Product
## Architecture & Design Specification — v0.1

---

## 1. Brand Taxonomy → System Architecture Mapping

Foliage's naming system isn't decorative — each botanical term maps to a real architectural or organizational layer. This mapping is the spine of the whole spec; every technical and product decision below traces back to one of these terms.

| Brand term | What it is | System layer |
|---|---|---|
| **Leaflet** | A single artifact — one unit of proof-of-work (a project writeup, a design doc, a code contribution, a decision memo, a talk) | Atomic content object |
| **Photosynthesis** | The artifact/leaflet creation system — the AI-assisted engine that turns raw work (passive signal + active input) into a polished leaflet | Core generation pipeline, consumer + business |
| **Branches** | A team's portfolio — an aggregation of leaflets across a working group | Team-level rollup |
| **(Thick core) Branches** | An organization's portfolio — an aggregation of team branches | Org-level rollup |
| **Ferns / Trees** | The business as a whole — the full organizational portfolio, root system to canopy | Enterprise root object |
| **Canopy Cloud** | The public-facing host for portfolios — what recruiters, boards, gatekeeper orgs, and the public actually see | Public presentation + discovery layer |

**The governing metaphor, stated as a system principle:** growth happens below the surface (private, local, root-level data) and is selectively exposed above it (canopy, public). A leaflet only reaches the Canopy Cloud through a deliberate, user-controlled photosynthesis-to-publish step — nothing is public by default.

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CANOPY CLOUD (public)                                           │
│  Public/semi-public portfolio hosting · discovery · partner APIs │
└───────────────────────────▲───────────────────────────────────────┘
                             │  deliberate publish step
┌───────────────────────────┴───────────────────────────────────────┐
│  FERN/TREE LAYER (business-as-a-whole)                            │
│  Org-wide rollup, governance, enterprise admin, billing            │
├─────────────────────────────────────────────────────────────────┤
│  BRANCH LAYER (org) · BRANCH LAYER (team)                         │
│  Aggregation, permissions, shared context, manager views           │
├─────────────────────────────────────────────────────────────────┤
│  PHOTOSYNTHESIS (leaflet creation engine)                          │
│  AI-assisted artifact generation from active + passive input       │
├─────────────────────────────────────────────────────────────────┤
│  LOCAL AI CHIEF-OF-STAFF AGENT (gate/router — runs on-device)     │
│  Triage · privacy-boundary enforcement · context assembly          │
├──────────────────┬──────────────────────────┬─────────────────────┤
│ TIER 1: Local     │ TIER 2: Confidential      │ TIER 3: Inference   │
│ Sensitive Brain   │ Cloud Store               │ (Fireworks/Kimi K3) │
│ (device-only)     │ (Supabase/Firebase)       │ store=false, ZDR    │
└──────────────────┴──────────────────────────┴─────────────────────┘
```

---

## 3. The Data & Privacy Architecture (Three-Tier Model)

### Tier 1 — Local Sensitive Brain (device-only)
- **What lives here:** raw, unfiltered material — private reflections, performance-review content, unpolished career anxieties, anything the user wouldn't want to leave their machine.
- **Storage:** encrypted local store (e.g., SQLite + device-level encryption, or an encrypted local vector store if semantic retrieval over this tier is needed — likely necessary given "load relevant context on every prompt").
- **Access pattern:** retrieved and injected into the prompt only at request time by the local CoS agent; never uploaded, never persisted server-side.
- **Durability tradeoff (open decision):** pure device-local storage means no cross-device sync and real data-loss risk on device failure. Two legitimate resolutions:
  - (a) User-controlled encrypted export/backup, where Foliage never sees the plaintext key, or
  - (b) Communicate Tier 1 as intentionally single-device — "your most sensitive material literally cannot leave this machine" as a feature, with backup being the user's responsibility.

### Tier 2 — Confidential Cloud Store (Supabase preferred, given existing stack)
- **What lives here:** structured portfolio content, career history, leaflet drafts, team/org rollup data — sensitive but not "never leaves the device" sensitive.
- **Storage:** Supabase (aligns with Alex's existing stack), with Row-Level Security policies as the primary tenant-isolation mechanism — this is where "I control and set policy" for multi-tenant isolation actually lives.
- **Encryption:** TLS 1.2+ in transit, AES-256 at rest; consider bring-your-own-key (KMS) for the exec tier as a differentiator.

### Tier 3 — Inference Layer (Fireworks hosting Kimi K3, `store=false`)
- **Configuration:** strict Zero Data Retention mode explicitly configured (not assumed as platform default) — prompt and generation data exist only in volatile memory for the duration of the request.
- **Consequence this creates:** with `store=false`, there is zero provider-side conversation memory. **Every single inference call must have full relevant context re-assembled and re-injected from Tier 1 and/or Tier 2 by your own orchestration layer.** This is not a bug — it's the direct tradeoff for the zero-retention guarantee — but it makes the context-assembly layer (Section 4) the single most load-bearing piece of engineering in the whole system.
- **Provider posture (Fireworks, current best-verified option):** SOC 2 Type II + HIPAA compliant, contractual ZDR via public DPA, customer-controlled encryption keys, no training on customer data without opt-in, auditable deletion.
- **Precision required in external claims:** "zero retention" only covers the inference provider's handling of the raw prompt/output — it does **not** cover Tier 2, which Foliage retains by design. Marketing and legal copy must keep these two promises separate: *"the model provider never retains or trains on your data"* is a distinct claim from *"we retain your data in Tier 2, encrypted and access-controlled."* Conflating them is a credibility risk with exactly the audience (privacy-savvy executives) this architecture is built to win.

### Local vs. Escalated Inference (hardware-aware routing)
- **Blackwell laptops / DGX Spark owners:** local inference is the preferred path (with a clear capability disclaimer), since the highest-value ICP (tech executives) disproportionately owns this hardware and currently has no clear consumer use case for it.
- **Everyone else:** the local CoS agent handles triage/routing only; heavier reasoning escalates to the shared or dedicated Kimi K3 endpoint per Section 5.
- **Framing discipline:** the honest pitch is not "local is as good as cloud" — it's "the most sensitive reasoning happens locally, even at a capability cost, because nothing else should see it; everything else runs on frontier-quality cloud inference."

---

## 4. The Local AI Chief-of-Staff Agent (the gate)

This is the architectural core of the "11-star at consumer scale" thesis: it's the compressed, software-native version of a family-office chief of staff's core function — continuous context-holding and narrative protection for one person — running as a lightweight, always-on local process.

**Its job is triage and enforcement, not raw reasoning quality:**
1. Receive the user's request or passively-observed signal.
2. Classify: does this need Tier 1 data, Tier 2 data, both, or neither?
3. Enforce the privacy boundary — decide whether this request can/should escalate to cloud inference at all, or must be handled fully locally.
4. Assemble the minimal necessary context from Tier 1/Tier 2.
5. Route to local inference or to Kimi K3 (Tier 3), per the hardware/sensitivity rules above.
6. On response, decide what (if anything) gets written back to Tier 1 or Tier 2 as updated state — this is how the CoS "remembers" across sessions despite Tier 3 being fully stateless.

**Two functions bundled under "chief of staff," worth keeping architecturally distinct even though they ship together:**
- **Operational/forward-looking:** tracks current portfolio state, surfaces opportunities, preps the user for moments, keeps positioning current.
- **Legacy/narrative:** preserves and curates the story of what the user has built over time — the compressed, software-native analog of a biographer/ghostwriter, writing the professional history as it happens rather than reconstructing it later.

**Shared risk across both functions:** since both draw on the same underlying data and context-assembly pipeline, accuracy and staleness handling should be built as one shared trust layer, not two separate systems. A misremembered or mischaracterized fact here isn't a minor bug — for the legacy function specifically, it's actively corrupting someone's professional record.

---

## 5. Multi-Tenant Inference Strategy (cost + isolation)

Three-tier routing, not a binary local/dedicated choice:

1. **Local device inference** — Blackwell/DGX Spark owners; most sensitive material never leaves the device.
2. **Shared, policy-gated Kimi K3 endpoint (default for most traffic)** — request-level isolation via stateless inference calls; personalization comes from per-request context injection (Tiers 1/2), not from a unique model instance per user. Billed per-token on shared infrastructure, so cost scales with actual usage, not idle capacity. Recommended starting provider: **Fireworks** (documented ZDR, SOC 2/HIPAA, path to dedicated capacity as volume grows).
3. **Dedicated single-tenant instance (reserved, expensive)** — held in reserve for workloads or clients that require full compute isolation regardless of the technical adequacy of shared-tenant isolation (e.g., regulatory requirements, a client for whom "shared infrastructure" is a dealbreaker on principle).

**The trust claim that actually needs engineering, not marketing:** "your data is encrypted, scoped to your account, never visible to other tenants, never used to train the model" has to be true by construction (proper request isolation, per-user-scoped encryption keys, no cross-user leakage in caching layers) and ideally independently auditable — this is what an exec-tier customer's security review will actually test.

---

## 6. Product Tiers & Pricing Mechanism

- **Structure:** flat-rate subscription, tiered by career type (dev tier / executive tier), **no commission** on placements or earnings — the explicit differentiator against both talent-agency (~10%) and executive-search (~25–38% of first-year comp) commission models.
- **Subsidized aspirational tier:** users get executive-tier product access at dev-tier price until they reach executive status.
- **Tier-detection mechanism (as refined):** driven by **title and the financials of the user's employing organization** — not portfolio content alone. This keeps tier assignment objective, externally verifiable, and resistant to gaming, while sidestepping the harder problem of having the system make a judgment call about someone's seniority from their work content.
- **Retention design implication:** because the tier is tied to an external, periodically-changing fact (title, org financials) rather than a static plan choice, tier transitions become a *recognition* moment ("you're now eligible for the executive tier") rather than a renewal-time repricing conversation — this converts a typical subscription churn-risk moment (status change) into an upsell moment instead.

---

## 7. Personalization Design

- **Intake:** hybrid — both active (explicit user input: interviews, reflection prompts, direct corrections) and passive (inferred from activity: work artifacts, decisions, communications the user opts to connect).
- **Compounding design goal:** the tier-detection signal (title/org financials) and the personalization layer should feed one continuously-learning profile per user, not run as separate systems — this is what turns "more data collected" into "actually feels like it knows me" rather than just a bigger data footprint.
- **Trust story required alongside this:** given how much is being inferred/passively collected, the product needs an equally explicit, user-facing answer to: what's stored, what's inferred vs. stated, what can the user see and correct, what never leaves Tier 1.

---

## 8. Go-to-Market: Two Tracks, One Brand

Per the earlier PMF research, the two ICPs require genuinely different motions sharing one brand thesis ("career portfolio management, continuously, without taking a cut"):

- **Executive track (lead beachhead):** high-touch, referral/network-led, $5–15K/yr pricing band, sold on continuity, prestige, and the CAA/family-office-adjacent "no commission" contrast against transactional incumbents. DGX Spark/Blackwell owners are a distinct, targetable, high-value cross-cut of this track.
- **Developer track (funnel + narrative engine):** low-touch, community-led (Blind, HN, Reddit), $20–50/mo or freemium, sold on relevance/obsolescence protection rather than status. Feeds top-of-funnel credibility and volume into the exec track rather than being the primary revenue line.
- **Gatekeeper partnerships (Canopy Cloud's real purpose):** the Canopy Cloud is the mechanism by which Foliage becomes discoverable to elite search firms, board-matching platforms, and invitation-only networks — modeled on theBoardlist/Athena Alliance, where curation-by-endorsement (not raw self-reported data) is what earns a gatekeeper's trust in the pool. Sequencing: build the vetting/curation layer first → earn organic pull signal → approach one credible mid-tier partner with real traction, not a pitch deck.
- **Positioning discipline:** if a gatekeeper partner is a commission-charging search firm, Foliage's "no commission" promise must be worded precisely — it means Foliage never takes a cut of what *you* earn, not that no party in a placement ever charges anyone anything.

---

## 9. Open Design Decisions (flagged, not resolved)

1. **Tier 1 data classification policy** — which content types default to local-only vs. cloud-eligible, and how much user override is allowed.
2. **Tier 1 durability** — user-controlled encrypted backup vs. accepting single-device-only as a stated tradeoff.
3. **Local model family/runtime** for the on-device CoS agent (llama.cpp-based, Ollama, or similar) — not yet chosen.
4. **Portfolio-driven vs. title-driven tier detection** — the current decision is title/org-financials-based; whether portfolio-content signal plays any secondary role (and whether tier changes are bidirectional or a one-way ratchet) is unresolved.
5. **Kimi K3 provenance messaging** — an open-weight Chinese-developed model, fully self-hosted by Foliage on infrastructure it controls; a due-diligence-ready answer ("weights never phone home, hosted on infrastructure you control") should be prepared in advance of enterprise/gatekeeper conversations.
6. **On-demand vs. always-on dedicated capacity** for the reserved Tier 3 option, once real usage volume is known.

---

*This spec synthesizes the architecture, brand taxonomy, pricing model, and privacy design discussed to date. It is a living document — Sections 3–5 (data/privacy/inference architecture) are the most technically load-bearing and should be validated with a security/infra review before implementation begins.*

---

# Part II — alignment, added on filing

*Everything below this line was written on 2026-08-19 when the specification was filed into the
repository. It is not the owner's text and does not speak for the owner. Every measurement names
the tree it was taken in.*

## 10. Collisions with the shipped tree, and how each was resolved

**Added on filing, 2026-08-19, measured against the tree at that date.** Each was a decision, not a
defect. A spec that contradicts the code it governs is worse than no spec, because both then look
authoritative.

### 10.0 §2 was left empty — what actually exists today

The owner's §2 ("System Architecture Overview") is a heading with no body. Rather than put words
in the owner's mouth, the component map is recorded here. **Everything marked ✅ was measured in
the running product on 2026-08-19.**

The botanical model maps to real components. Everything marked ✅ runs today.

| part | what it is | where | state |
|---|---|---|---|
| **Roots** | what draws material: local repos, the local brain, company MCP servers | `apps/leaf/src/*Source.ts` | git ✅ · photos ✅ · brain ✅ · MCP contract-only |
| **Xylem** | ranked, budgeted retrieval — deterministic, no model in the ranking | `tools/vault` | ✅ |
| **Light** | the AI: local model by default, escalated inference by policy | §3 Tier 3 | local ✅ |
| **Photosynthesis** | material + light → leaflet **candidates** | `packages/photosynthesis` | ✅ |
| **Review** | the human gate — no candidate becomes a leaflet without it | `harvest.mjs`, `/review` | ✅ |
| **Leaflet → Leaf** | the artifact and its compound | `packages/leaf`, `apps/leaf` | ✅ |
| **Branch / Bough / Tree** | organizational rollups, governed release | `packages/photosynthesis-enterprise` | DARK — no ingestion path |
| **Canopy** | the public layer | `packages/canopy`, `apps/canopy` | tree renders real data ✅ |

### 10.1 The taxonomy had no Leaf — RESOLVED in favour of the shipped taxonomy
The draft ran Leaflet → Branches (team) → Branches (org) → Ferns/Trees → Canopy Cloud. Three
problems, and the first is structural:

- **It skips the person.** `Leaf` is the object the licensing boundary is drawn around: it is the
  **open** plane, the thing a person self-hosts, and it is what `packages/leaf` and `apps/leaf`
  implement. A ladder from leaflet straight to team removes the anchor that makes the open/cloud
  split mean anything — and `pnpm check:boundary` would then be protecting nothing.
- **`Bough` is shipped code** in `packages/photosynthesis-enterprise` (subject hierarchy, branded
  ids, containment). "(Thick core) Branches" is a rename of working code, not a naming choice.
- **"Branches" for two levels reintroduces an ambiguity this repo deliberately removed.**
  `AGENTS.md` records the rule: capitalized `Branch` is the taxonomy, lowercase is git's, and they
  appear in no file together. Using the word for both team and org puts that back.

§1's draft table is the owner's and stands as written. The shipped taxonomy it maps onto is:

| Draft term (§1) | Shipped term | What it is | System layer | Plane |
|---|---|---|---|---|
| **Leaflet** | **Leaflet** | one artifact — a single unit of proof-of-work | atomic content object | **open** |
| *(absent)* | **Leaf** | **one person's portfolio — the compound of their leaflets** | the self-hostable unit | **open** |
| **Branches** (team) | **Branch** | a team's portfolio | team rollup | enterprise |
| **(Thick core) Branches** (org) | **Bough** | an organization's portfolio — an aggregation of branches | org rollup | enterprise |
| **Ferns / Trees** | **Tree** | the company as a whole, root system to canopy | enterprise root object | cloud / enterprise |
| **Canopy Cloud** | **Canopy** | the public host — what recruiters, boards and the public see | presentation + discovery | cloud |
| **Photosynthesis** | **Photosynthesis** | the engine that turns raw work into leaflet candidates | generation pipeline | open + enterprise |

"Fern" is retired on the owner's own instruction — *"'Fern' was my invention from a half-parsed
instruction last turn, and it can't express teams"* — so *Ferns / Trees* resolves to **Tree** alone.

**This is the spec yielding to LATER owner decisions, not the tree overruling the owner.** The
decisions it yields to are the owner's own, and they postdate the draft:

- *"leafs must hang from branches even if it is a single leaf on the branch — that is how org
  charts work"*
- *"Bough: A large, main branch connected to the trunk. organizations are Boughs and teams are
  just branches"*

### 10.2 Runtime dependencies — UI foundation supersedes the original zero-dependency decision

2026-09-05: the chosen shadcn application stack now uses React, React DOM, Radix Slot and CVA
in open-plane `@foliage/ui` for static server rendering. This implements the owner's UI
foundation direction; it changes the former zero-dependency promise. Node still runs the
TypeScript directly, published pages remain script-free, and the open set stands alone.
See [UI-FOUNDATION.md](UI-FOUNDATION.md) and [SCARLET-UI-ADOPTION.md](SCARLET-UI-ADOPTION.md).

The following records the superseded 2026-08-19 decision:
Measured 2026-08-19: every `dependencies` entry across all **eight** workspace packages
in this tree is a `@foliage/*` workspace package. (The `photosynthesis/prototype` tree reports
**nine** — it carries an extra app. Same property, different count; do not copy a number between
the two trees.) Supabase, an inference SDK, a vector store and an Ollama client
end that — **in the `cloud` and `enterprise` planes only.**

The rule stays absolute in **`open`**, where it is the whole point: a person's portfolio should
have no supply chain between their evidence and the page that renders it. `check:boundary` already
enforces plane separation, so this is a scoping clarification rather than a new mechanism — but it
is a deliberate constitutional change and it is recorded here rather than discovered mid-build.

### 10.3 "Zero network calls" (AGENTS.md) — RESOLVED: scoped to the open plane
The claim is that the **open plane** makes no network call beyond loopback, which is why fonts are
self-hosted and the local model is loopback-enforced on the parsed hostname. Tiers 2 and 3 are
network by definition and live in `cloud`. The open-source claim survives because a fork holding
only the open set still runs, offline, with no account.

**Known tension, not resolved here:** hardware attestation for the capture apps
(`ENGINEERING-PLAN.md` §3) *requires* a verifier, and you cannot attest to yourself. That is the
one place a nominally-personal feature needs a service.

### 10.4 §4 step 6 wrote back with no review gate — RESOLVED: state and candidates, never leaflets
`promoteApproved` writes tier `pending` unconditionally so AI output can never be proof, and a
candidate becomes a leaflet only when a person approves it. An always-on agent writing back
unreviewed would route around exactly that. **The CoS may write Tier 1/Tier 2 state and may write
candidates into the harvest document. It may not write a leaflet.** §4 step 6 now says so.

### 10.5 "Polished leaflet" — RESOLVED: candidates, and a body of grounded elements
A leaflet body is a list of elements each carrying its own evidence ref, precisely so unsourced
prose has nowhere to live. "Polished" is the word that invites a paragraph. §1 now reads "leaflet
candidates"; the polish a user sees is the review step, not a generation step.

### 10.6 Pricing tier vs. the no-score invariant — RESOLVED: account metadata, with a wall
Tier detection from title and employer financials is plausibly outside the invariant, since no
employer sees it and it rates an *organization*, not a person's work. But `SCORE_SHAPED` is
refused **by name** by every document gate, and a tier is one careless field from being a rating
of a person. **The wall: tier is account metadata. It is never a field on a leaf, a leaflet, or
anything the Canopy renders, and the document gates keep refusing score-shaped keys unchanged.**

### 10.7 The three-tier architecture inherits the native-app boundary problem
Already recorded for capture: Node type-stripping, no build step, no `dist/` means a native app
cannot be a package in this workspace. A Supabase-backed cloud service and an inference
orchestrator inherit the same problem at larger scale. They are separate deployables that speak to
these packages through document formats — not workspace packages. Deciding that boundary is
prerequisite work, and it is unscoped.

### 10.8 Tier 3 provider access — MEASURED 2026-08-19, and it is blocked on billing

The owner supplied a Fireworks credential and an example call. Both were exercised against the
live API today. Three results, each with the evidence that establishes it:

| Question | Answer | Evidence |
|---|---|---|
| Is the credential valid? | **Yes** | A deliberately malformed key returns `UNAUTHORIZED` — *"The API key you provided is invalid."* The real key returns a **different** error, so it authenticates. The control is what makes this a result rather than a guess |
| Can Tier 3 run today? | **No** | Both `/v1/models` and `/v1/chat/completions` return `PRECONDITION_FAILED`: *"Account foliage is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices."* |
| Does `accounts/fireworks/models/kimi-k3` exist? | **UNKNOWN** | Not established either way. The account-suspension check fires **before** model resolution, so the model id has never been validated. §3's provider and model choice therefore remain unconfirmed, not confirmed-and-blocked |

**Tier 3 is blocked on an account, not on engineering.** That is a better problem than the
alternative, but it means every §3–§5 claim about inference remains *designed*, never *verified*.

**Two things this surfaced that the spec should absorb:**

1. **The example call does not configure zero data retention.** §3 is explicit that ZDR must be
   *"explicitly configured (not assumed as platform default)"*, yet the supplied example sets only
   `model`, `max_tokens`, `top_k`, `presence_penalty`, `frequency_penalty` and `messages`. There is
   no `store=false` and no ZDR header. Shipping that call as written would make the product's
   central privacy claim **false in the first request**. The ZDR mechanism must be verified against
   Fireworks' own documentation and then asserted by a test — a privacy guarantee that rests on a
   default nobody checked is exactly the class of claim this project refuses.
2. **The example is multimodal** (`image_url` pointing at an external CDN). That is a Tier 3 call
   carrying an image to a third party. Photosynthesis already ingests photos locally; the boundary
   between "a photo the local model reads" and "a photo posted to a provider" is a Tier 1/Tier 3
   classification decision (§9.1) and is **undecided**.

**Credential handling.** The key was pasted into a chat transcript and must be treated as
compromised: **rotate it.** It is not in this repository — verified by scanning every tracked and
untracked file for the `fw_` pattern, zero hits — and `.gitignore` already refuses `.env`,
`.env.*`, `*.env`, `.envrc` and `*.key` with no negated allow-list. When a replacement key exists
it belongs in the environment or an ignored `.env`, and it must never reach the `open` plane,
which makes no network calls at all.

---

## 11. What is genuinely open

1. **Tier 1 classification policy** (§9.1) and **Tier 1 durability** (§9.2).
2. **Tier detection direction** — bidirectional or a one-way ratchet (§9.4).
3. **Kimi K3 provenance messaging** (§9.5) and **dedicated capacity shape** (§9.6).
4. **Where the cloud service lives** — §10.7. No ledger rows exist for tenancy, billing,
   provisioning, deploy or auth, which means unscoped rather than merely unbuilt.
5. **Attestation's verifier** — §10.3, the one place a personal feature needs a service.
6. Everything in `ENGINEERING-PLAN.md` §13, including the two on the demo's critical path:
   opening `LEAFLET_KEYS` for a body (**now done**) and per-leaflet visibility (**now done**).

---

## 12. Retired — the Tier 3 live-API measurements are §10.8

**This number is kept as a signpost rather than reused, because two live code comments still point
at it.** `apps/cos/src/cos.seam.test.ts:124` ("see docs/PRODUCT-ARCHITECTURE-SPEC.md §12, which
records the live verification") and `apps/cos/src/fireworks.test.ts:137` ("the responses were
recorded in docs/PRODUCT-ARCHITECTURE-SPEC.md §12") were both correct when written: `c777d53`
carried "## 12. Tier 3 — measured against the live API, 2026-08-19". The fork merge `e37a2b3`
renumbered that content into **§10.8**, and the two pointers were left naming a section that no
longer existed.

**What you are looking for is §10.8** — "Tier 3 provider access — MEASURED 2026-08-19, and it is
blocked on billing". Read it before believing either comment, because **what it records is
narrower than what they promise**: the credential authenticates (a malformed key returns a
different error, which is the control that makes it a result), both `/v1/models` and
`/v1/chat/completions` return `PRECONDITION_FAILED` — account suspended — and the model id
`accounts/fireworks/models/kimi-k3` is marked **UNKNOWN**, "never been validated", because the
suspension check fires before model resolution.

**So `fireworks.test.ts:136` overclaims, and this signpost will not smooth it over.** That comment
says the path "was exercised live against `accounts/fireworks/routers/kimi-k3-fast`" — a string
that appears nowhere in §10.8 and belongs to `packages/escalated-inference/src/escalate.ts:91`
(`DEFAULT_MODEL`). What was exercised live on 2026-08-19 was the **error path**: auth accepted,
account suspended. No completion has ever been received from that model, or from any model, on
this credential. A reader who takes the comment at face value would believe Tier 3 has run.

The two comments should name §10.8 directly *and* drop the live-run claim. They are not corrected
here because `apps/cos` is under the owner's width freeze and a doc PR may not reach into a frozen
surface; both defects are recorded in `F-029` so the ratchet holds them. Until then this section
is the redirect, which is why the number is not available for new content.

---

## 13. Where the two unbuilt owner apps go — decided 2026-09-03, built nowhere

The owner names five apps — **Individual · Individual Enterprise · Organization · Recruiter ·
Portfolio Hosting**. **Provenance of that list, stated because it matters:** it is the owner's own
framing, given verbally on 2026-08-11, with one Open Design project per app (`coeadapt-personal`,
`coeadapt-org-member`, `coeadapt-org-admin`, `coeadapt-recruiter`, `coeadapt-hosting`). It is
recorded **nowhere else in this tree** — grep it and this section is the only hit — and
`AGENT-ECOLOGY.md`'s tiers are a different taxonomy (agent roles, not apps) that does not
corroborate it. An unwritten premise that three surfaces were already built against is exactly
the thing to write down; treat this paragraph as the citation everything below hangs off, and
correct it here if the owner's list has moved.

Three of the five have a surface in this tree (`apps/leaf`, `apps/enterprise`,
`apps/canopy`). Two have never had one, and until today they had no recorded home either, which
meant the next person to build one would also be deciding its licence plane by accident — the
same shape as the 2026-08-20 finding that a plane question was "hidden inside a file that merges
with ZERO conflicts, which meant it was about to be decided by whoever resolved first"
(`public-boundary.json`, `$egressComment`).

**This section marks the path. It builds nothing.** No directory, no stub server, no placeholder
package, and deliberately **no entry in `public-boundary.json`** — that file is a register of
packages that exist, and `check-public-boundary.mjs` prints each plane's roster in its own
output (`:217`), so a reserved name there would assert a package that is not real. The mechanism
is already correct without one: the gate walks the actual workspace and fails on any package it
finds undeclared (`:134-139`), so the first commit that creates either app is red until someone
declares its plane — which is exactly the moment the decision should be enforced, and this
section is what they read when they get there.

### 13.1 Individual Enterprise → `apps/member`, package `@foliage/member-app`, plane `enterprise`

The person operating inside their employer's governance: their own leaf, their own view, under
a company's release policy.

**It cannot live in `apps/leaf`.** `@foliage/leaf-app` is declared `open`, and the open plane's
promise is that "a fork holding only these packages has to be a working product, or the 'open
source' claim is marketing rather than fact". Org-internal portfolio features are `enterprise`
by that plane's own definition — "internal portfolios for individuals, teams and organizations,
plus the company policy governing outward release" — so putting them in the leaf app would
either break the open set's standalone property or drag enterprise code into an open licence
that cannot later be withdrawn. The boundary gate would refuse the import edge; the reason it
would refuse is the product principle, not a lint rule.

**It is not `apps/enterprise` either.** That surface serves the org administrator — a different
audience contract — it is under the owner's width freeze, and `F-027` is open against it.

**What it owes on its first commit**, from the absences already measured in this tree:
`SYSTEM-ARCHITECTURE.md` §3 records that a departing person has **no export, download or takeout
path** on the enterprise plane — "the leaf lives in the open plane so the subject keeps it" is a
licensing fact, not a mechanism. `apps/member` is where that mechanism belongs, and it should be
the first route it serves rather than the last.

### 13.2 Recruiter → routes inside `apps/canopy`, plane `cloud` — and still GATED

The recruiter is a **reader of the canopy**, not a separate product. This tree already says so
in its own code: `renderPublic.ts:2` is headed "THE TWO PAGES A RECRUITER ACTUALLY LANDS ON",
and §10.1's table gives Canopy as "the public host — what recruiters, boards and the public
see". A second cloud app would fork the public projection and, with it, the place the no-score
rails are enforced — `packages/canopy/src/publicProjection.ts` is deliberately the single
chokepoint where consent, the publish rail and attribution are decided, and the cost of a second
one is written in `F-028`: one surface already prints a sentence the projection did not
authorise.

So the recruiter's home is new **routes** on `@foliage/canopy-app`, which is already declared
`cloud`, importing the existing projection rather than re-deriving it.

**Marking the path is not opening the gate.** Whether discovery exists at all, and for whom, is
`SYSTEM-ARCHITECTURE.md` §7 decision **E** / ledger **C12**, and it is still closed: "§4 is
unbuildable until it is answered". Nothing here answers it. When it is answered, §4 already
fixes what the routes may do — a filter the reader supplies, ordering only by an artifact-borne
instant the reader chose, sort keys labelled self-declared, no relevance weight, no count of
added / removed / changed / withheld as a standalone figure, and the `noindex` default holds
until the gate opens because "unlisted→listed is reversible by the person and listed→unlisted is
not, once a crawler has cached it".
