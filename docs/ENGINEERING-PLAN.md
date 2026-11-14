> Scope and implementation status: [canonical architecture](../context/architecture.md).
> This document retains its dated decisions or detailed feature contract; it is not a second application inventory.

# Photosynthesis — engineering plan

**What this is.** The architecture of record for Photosynthesis: the decisions, the reasoning, and
the measurements that forced them. It is not a status tracker — `.loop/STATUS.md` is the only one
of those, and it is not a sequencing plan — that is `.loop/LAUNCH.md`. This file answers *why the
code is shaped this way*, so the next person does not re-litigate a decision that was already paid
for in measurement.

Every claim here that rests on a measurement names it. Where something is undecided it says
**OPEN**; where something is unbuilt it says **NOT BUILT**. Neither is softened.

**The product spec of record is [`docs/PRODUCT-ARCHITECTURE-SPEC.md`](./PRODUCT-ARCHITECTURE-SPEC.md)**
— tiers, privacy model, pricing, go-to-market. It answers *what the product is*; this file answers
*why the code is shaped this way*. Where the two collided they were reconciled rather than left to
drift: see that document's §10, which resolves six of them, including the taxonomy, the
per-plane scoping of the zero-dependency rule, and the wall that keeps a pricing tier off every
leaf and leaflet. Read whichever you found first, then read the other.

---

## 1. What Photosynthesis is

The process, occurring in the leaf, that converts incident light into stored energy. Here: raw
signal already present in a person's own work — commits, photographs, their knowledge base, and
(at organizational scale) the systems their company already runs — is converted into **leaflet
candidates** that a human reviews before any of it becomes a portfolio.

The metaphor is load-bearing at every link, and the parts map to real components:

| part | what it is | where |
|---|---|---|
| **Roots** | what draws material: local repos, gbrain, company MCP servers | `apps/leaf/src/*Source.ts`, MCP roots |
| **Xylem** | ranked, budgeted retrieval — deterministic, no model in the ranking | `tools/vault` |
| **Light** | the AI: local model by default, frontier only with consent | `127.0.0.1:11434` |
| **Photosynthesis** | the conversion: material + light → candidates | `packages/photosynthesis` |
| **Leaflet** | **one artifact of evidence — the unit of production, review, release and sharing** | `packages/leaf` |
| **Leaf** | the compound of leaflets: one person's portfolio | `packages/leaf`, `apps/leaf` |

Taxonomy, settled 2026-08-17: **Canopy › Tree (a company) › Bough (an organization) ›
Branch (a team) › Leaf (one person's portfolio) › Leaflet (one artifact of evidence)**. Every link
is a real botanical containment. `Branch` is capitalised and is never git's `branch`; see AGENTS.md.

---

## 2. The leaflet IS the artifact — the leaf is the compound of them

**This is the correction that reorders the roadmap, and it was got wrong in prose before it was
got wrong in code.** The portfolio is not the artifact. A leaflet is, in botany, a subdivision of a
compound leaf, so "a leaf is composed of leaflets" is literally true — and the product inherits
that exactly:

> **The LEAFLET is the artifact.** Self-contained, evidence-bearing, independently addressable,
> independently reviewable, independently releasable, independently shareable.
> **The LEAF is the compound** — a person's portfolio is the set of their leaflets, not a document
> that happens to list them.

Everything downstream follows from which of the two is the unit. The unit is the leaflet.

### What the code actually has today — measured 2026-08-17

```ts
export type Leaflet =
  | { id; title; tier: "verified"; provenance }
  | { id; title; tier: "pending";  provenance? }
  | { id; title; tier: "excluded"; reason; provenance? }
```

That is a **citation row, not an artifact**: a title, a tier, and a pointer. And
`apps/leaf/server.mjs` routes only `/`, `/fonts/*` and static assets — there is **no route to a
single leaflet**. So today the leaf page renders a *list of citations*, and no leaflet can be
opened, linked or shared on its own.

**The enterprise plane already models this correctly and the open plane does not.**
`EnterpriseArtifact` carries its own `review` **and** its own `release` state, so the artifact is
the unit of governance there. `publishableLeaflets(leaf)` shows the open plane agrees in
principle — publishability is already per-leaflet — but the leaflet has nothing to publish beyond
a title.

### What a leaflet needs to become an artifact

1. **A body.** Content, not just a title. This is the whole difference between a citation and an
   artifact.
2. **Independent addressability.** Its own stable route, so a leaflet can be linked and shared
   without exposing the whole leaf. Note the privacy consequence: sharing one leaflet must not
   require handing over the compound, and the leaf holds `pending` and `excluded` entries that are
   the subject's own accounting and were never outward claims.
3. **Independent render.** Self-contained enough to stand alone.

### The body must be STRUCTURED, not prose — and this is forced, not stylistic

A body is a far larger fabrication surface than a title. A one-line title is a small thing for a
model to invent; a paragraph is a place for invented claims to hide inside true ones.

So a leaflet body is **a list of grounded elements, each carrying its own evidence ref** — never a
free-text blob. Two properties fall out, and both are checkable:

- **must-ground holds element-wise**, not merely document-wise. Every element points at evidence,
  so "which part of this is sourced?" has an answer per element rather than per artifact.
- **there is nowhere for unsourced prose to live**, because the format has no field for it.

This is the same move as refusing unknown keys in the document gates: make the dangerous thing
unrepresentable rather than policing it.

**NOT BUILT.** `LEAFLET_KEYS` in `packages/leaf/src/document.ts` is a closed set
(`id`, `title`, `tier`, `provenance`, `reason`); adding a body is a deliberate, reviewable domain
change to the open core's format, and it is the largest single change this plan proposes.

**OPEN — owner decision.** Whether the open plane mirrors the enterprise plane's per-artifact
release state, so a leaflet can be published individually. *Recommendation:* yes, and it should be
the same shape without importing it — `enterprise` may depend on `open`, never the reverse, so the
open plane needs its own narrower visibility state rather than `ReleaseState`.

---

## 3. Capture — non-computer work, and why it is the general case

**NOT BUILT. Scoped here, deliberately, before any of it is written.**

The question that forced this section, from the owner 2026-08-18: *what about non-computer work?*

A welder, a nurse, a chef, an electrician, a stagehand, a florist, a carpenter, a farmer, a
teacher — **none of them have commits**. Every light source built so far is developer-specific
except photographs, which is the least developed one. So the honest reading is:

> **Git is the special case. Most work in the world leaves no commit, no document and no
> repository.** A portfolio product that only reads git is a developer tool wearing the word
> "portfolio", and `folium` never meant that.

### The trust model inverts, and this is the whole difficulty

Every existing source READS an artifact some other system already produced, and content-addresses
it: a commit sha, a file digest. Provenance is inherited.

A capture app **is the producer**. Nothing upstream hashed the weld. The photograph is not a
pointer to the evidence — **it is the evidence** — and if the moment is not captured it is gone.
So authenticity lands on us rather than on an upstream system, and it lands at the exact moment
the product is most tempted to be generous.

### DETECTION IS THE WRONG SHAPE. ATTESTATION IS THE RIGHT ONE.

"Make sure it is not AI-generated" cannot be met by detecting AI generation. Detectors are an arms
race, they fail in both directions, and a detector emits a **confidence number** — the artifact
this codebase refuses by name in every gate it has. Building the feature on detection would put a
score at the root of the evidence chain.

Invert it: **do not detect fakes, attest authenticity at capture.**

| mechanism | proves |
|---|---|
| capture **in-app**, never picked from the library | the bytes were produced by this code path |
| hash frames immediately, sign with a **hardware-backed key** (Secure Enclave / StrongBox) | the signature came from a key that cannot leave secure hardware |
| **App Attest** (iOS) / **Play Integrity** + hardware Key Attestation (Android) | the app is genuine and unmodified, on unmodified hardware |
| **C2PA / Content Credentials** | an interoperable, industry-standard signed manifest |

### THREE LIMITS THAT MUST BE WRITTEN ON THE PRODUCT, NOT BURIED

1. **THE ANALOG HOLE IS UNCLOSABLE.** Attestation proves *this app, on genuine unmodified
   hardware, produced these exact bytes at this claimed moment*. It does **not** prove the thing
   in front of the lens was real. Someone can point an attested phone at a screen playing
   generated video and get a perfectly attested capture of a fake. **Any product claiming to
   solve this is lying**, and the tier vocabulary must not imply we did.
2. **A DEVICE CLOCK IS USER-SETTABLE**, so a self-asserted timestamp is worth nothing. RFC 3161
   trusted timestamping, or a countersigning service on receipt, gives an **upper bound** —
   "this existed no later than T". It gives **no lower bound**: nothing prevents capturing
   earlier and submitting later. Say "existed by", never "taken at", unless a TSA is in the chain.
3. **LOCATION IS THE WEAKEST LINK.** GPS is spoofable — trivially with mock location providers,
   and hardware attestation only raises the bar by proving the device is unmodified. Cell-tower
   and WiFi-BSSID corroboration help and prove nothing. Location is a **claim with a named
   source**, never a verified fact.

### Proof tiers for physical work — corroboration becomes primary

For a commit, `verified` means git accepted a signature AND bound the signer to a declared
identity (§6). **For a weld there is no cryptographic authorship and never will be.** The tier is
unreachable by its own definition, and stretching it to cover attested capture would be exactly
the overclaim the tier set exists to prevent.

So for physical work the honest primary mechanism is the one §7 already designed for
collaboration: **corroboration**. A client, a supervisor or a colleague independently attesting
"yes, they built this" is the closest real analogue of a signature — social rather than
cryptographic, weaker, and honest about being weaker. `attested` (the capture chain held) rides
beside the tier, exactly like the signature findings; it is not a tier and it never becomes one.

### Two apps, and the consent inversion repeats

| app | subject | plane |
|---|---|---|
| **individual** — side projects, personal ventures, trade work | their own leaf | open-ish (see the tension below) |
| **employer** — capture on behalf of an organization | a Branch / Bough / Tree | enterprise, governed by the release machine |

An employer-captured artifact is **evidence about an employee**, produced by the employer's
device, on the employer's initiative. That is the §6 consent inversion again with a camera on it,
and it is sharper: a photograph can capture bystanders, a workplace, a client's premises, and
people who never consented to being in a portfolio. The enterprise release machine governs
outward release; it does not govern capture, and capture is where the harm would occur.

### TWO ARCHITECTURAL TENSIONS THAT MUST BE RESOLVED BEFORE ANY CODE

1. **ATTESTATION REQUIRES A VERIFIER. YOU CANNOT ATTEST TO YOURSELF.** App Attest and Play
   Integrity are validated against Apple's and Google's servers. So a capture app inherently needs
   a service — which **directly contradicts the open plane's privacy claim of zero network calls
   beyond loopback**. Either attestation verification lives in `cloud` (and the open plane renders
   captures whose attestation it cannot itself check), or the claim is narrowed and the narrowing
   is stated. This is an OPEN owner decision and it is not cosmetic.
2. **A NATIVE APP DOES NOT FIT THIS REPOSITORY'S CONSTITUTION.** Node 22 type-stripping, zero
   third-party runtime dependencies, no build step, no `dist/`. An iOS/Android app is a different
   toolchain, a different release cadence, app-store review, and signing keys. It cannot be a
   package in this workspace as currently constituted; it is a separate artifact that speaks to
   these packages through a document format. Deciding that boundary is prerequisite work.

### Honest scope impact

The platform surface (S3) already has **zero ledger rows** for tenancy, billing, provisioning,
deploy and auth. This section adds two native applications, a hardware-attestation verification
service, and optionally a trusted-timestamping dependency. **It is the largest single addition to
scope in this document, and it is additive to an amount of work that is not yet estimated.** It
should not be started before S3 is scoped, and the capture format can be designed — and the
document gates written — long before any app exists.

---

## 4. The seam that makes all of this safe

**Two documents, one door.**

```
  raw material ──▶ HARVEST document ──── promoteApproved() ────▶ LEAF document
                   drafts, evidence      approved candidates      the portfolio
                   lists, extractor      only                     tier: pending
                   identity, review
```

This is forced, not stylistic. `parseLeafDocument` refuses unknown keys *and* refuses score-shaped
keys **by name** — including `confidence`. An extractor is exactly the kind of producer that wants
to attach a confidence to its drafts, so extraction metadata physically cannot be bolted onto a
leaf. Drafting, review and promotion were added with **zero changes to the leaf format**, and that
is the evidence the seam is drawn in the right place.

**In tension with §2, deliberately, and stated rather than papered over.** Making a leaflet a real
artifact *does* require opening `LEAFLET_KEYS` to add a body — so "the format never changes" is not
the invariant and never was. The invariant is narrower and survives: **nothing crosses this seam
except what a human approved, and no extraction metadata crosses it at all.** A body composed of
grounded elements satisfies that; a `confidence` field on a leaflet would not, whether or not the
format ever changes again.

`SCORE_SHAPED` is exported from `@foliage/leaf` and imported by every other gate: one list, three
gates, no drift.

**AI output can never be proof.** Candidates carry no tier; `promoteApproved` writes `pending`
unconditionally. This is unrepresentable, not merely discouraged.

---

## 5. Deployment — three tiers, one code path

| tier | brain | sources | plane |
|---|---|---|---|
| **Seedling** — personal, local | a pinned gbrain on PGLite inside each garden (`<garden>/brain/`), run offline by Foliage; the owner's own `~/.gbrain` and `~/brain` are never touched | repos, brain, photos; loopback only | open |
| **Grafted** — personal, cloud | gbrain on the user's **own** Supabase | + hosted repos | open (+ their infra) |
| **Canopy Enterprise** | multi-tenant, per-person scoped slices | company MCP servers | enterprise |

"If the customer does not have one already" is answered by planting one: `gbrain init` is part of
setup. Connecting an *existing* gbrain or work repository is the default path, not a special case —
the retrieval layer already treats `~/brain` as one declared source among several.

**Measured, 2026-08-17:** gbrain 0.42.73.2, `~/brain` holds 41 markdown notes.
`pnpm run vault:ask "<q>" --budget 4000` returned a real 3-node pack at 3,805 tokens — a **98.3%
reduction** — scoring 10 index entries in **16ms with no files opened and no model called**. That
determinism is why the pack is auditable, and it is why retrieval must not be replaced by
embeddings without a much better reason than convenience.

---

## 6. Integration — MCP is the root system, not N connectors

The enterprise sources that matter (WorkIQ/Copilot, Atlassian, Claude Code) all expose or speak
MCP. Photosynthesis therefore becomes an **MCP client**, and the company's already-deployed,
already-authorised servers become the root system.

The reason is not code volume, it is **consent**: a company that deployed those servers has already
decided an agent may read those tools. We inherit that authorisation rather than re-implementing
it, which is a far better posture than scraping and a far smaller surface to get wrong.

An MCP root reports **observations, never conclusions** — the same split as
`apps/leaf/src/gitIntake.ts` (reports `ObservedCommit`) versus `packages/leaf/src/intake.ts`
(decides what it means). A root must be unable to assert a tier, an attribution or a score, and
that must be unrepresentable in the type.

See `docs/MCP-ROOTS.md` for the contract. **NOT VERIFIABLE HERE:** no company MCP server is
reachable from this machine, so the contract ships with tests and no connector. Do not let a
connector claim to work that nobody has exercised.

---

## 7. Attribution — declared, never inferred

**Measured, and this is the load-bearing finding.** In one real repository (1,905 commits, 6
distinct author emails) the owner alone commits under **seven identity strings**:

```
Alex A <126364027+aacker71@users.noreply.github.com>   Alex Acker <a GitHub issue>
Alex A <a GitHub issue>                            Alex Acker <coeadapt@coeadapt.com>
Alex A <coeadapt@coeadapt.com>                          alexander-acker <coeadapt@coeadapt.com>
<author>
```

Four of the repository's six emails are one human. An extractor inferring "the people of this
branch" from commit authorship would report ~6 people where the truth is ~2. Separately, a vendored
fork of a third-party project carried **269 distinct author identities** whose top contributor was
an unrelated upstream maintainer — rendering those as a company's staff would invent an entire
organisation.

**Therefore: membership and identity are DECLARED, never inferred.** A roster is a required input,
not a derived one. Work that cannot be matched to a declared identity is `excluded` *with a reason*
— never guessed, never dropped.

### Signature findings sit beside the tier

Established 2026-08-17 after two real defects (see `.loop/STATUS.md` P4). `%G?` is a *verdict* and
degrades "I could not run the checker" into `N` = "there is no signature"; and a signature git
accepted is not necessarily *the subject's* — `%GS` names the signer git actually bound, and
reading only the verdict produced a **false `verified`**.

The findings — `verified` / `unsigned` / `unchecked` / `unbound` / `undeclared` / `rejected` /
`unrecognized` — ride **beside** the tier rather than inside it, because the tier set is
FCRA-scoped and a fourth tier would change what the product claims about people.

**This pattern recurs and should be reached for deliberately: when a new distinction matters but
the tier set must not grow, put the distinction beside the tier.** It is used three times already
(signature findings, photo-measurement causes, release states) and both sections below use it too.

---

## 8. Collaboration overlap is a feature, not only a hazard

Two things share a source directory and are completely different problems:

| | what it is | answer |
|---|---|---|
| **Collaboration overlap** | Alex and Bob both cite evidence ref `X` | **track it** — it is career-relevant signal |
| **Incidental third-party data** | a leaflet quotes a note containing Bob's compensation | report, refuse if necessary, **never silently rewrite** |

**The join is shared evidence refs, never co-occurrence.** Two leaflets carrying the same
`Provenance.ref` — the same commit sha, brain page digest, or issue id — is an *observed* fact.
Inferring collaboration from two names appearing in one note would be exactly the fabrication
vector this project refuses.

**Co-attribution rides beside the tier:** `sole` / `corroborated` / `contested`. Two hard rules:

1. **Corroboration must never become `verified`.** That tier means signature-bound authorship.
   Social corroboration is different and weaker evidence; promoting it is the overclaim.
2. **It must never become a count that ranks people.** "Corroborated by 5 colleagues" is one step
   from a score. `contributionLedger` returning contributors in first-appearance order and never
   sorting by tally is now doing *more* work than when it was written.

**Where it lives is forced by the boundary:** a cross-leaf join needs many people's leaves, which
is the **canopy** (cloud plane). It must not leak into `open`, or a self-hosted personal leaf would
require other people's data to render.

**OPEN — owner decision.** Publishing "led the migration *with Bob*" is a claim about Bob.
Enterprise has an answer (the release machine: approve and publish are separate events by different
actors). The personal plane has only the claimant's own review. *Recommendation:* the open plane may
cite a shared ref but must not **name** another person absent that person's own leaf corroborating
it — co-attribution by mutual citation, degrading honestly to `sole`.

---

## 9. Users may suggest; they may never claim

Both directions terminate in evidence:

```
agent-initiated   evidence ──▶ draft ──▶ human review ──▶ leaflet
user-initiated    hypothesis ─▶ agent searches ─▶ evidence? ─▶ draft ─▶ leaflet
                                                └─ none ────▶ NOT a leaflet
```

**A user suggestion is a QUERY, not content.** It directs the search; it never supplies the claim.
This is the difference between Photosynthesis and every other portfolio tool, which ask a person to
describe themselves.

### The trap: echo laundering

If a user suggests *"I single-handedly saved the company $2M"* and the agent finds 40 commits in a
billing repo, the dangerous failure is attaching that **real evidence ref to the user's sentence**.
The claim then looks sourced while being unverified — worse than an unsourced claim, because it
defeats inspection.

**The suggestion selects the evidence; the evidence writes the title.** Where the two disagree, the
evidence wins and the disagreement is reported. A suggestion whose wording exceeds what its evidence
supports is **refused and reported, never softened.** That is a required test, not a nice-to-have.

### Four outcomes, never collapsed

| outcome | means | result |
|---|---|---|
| `confirmed` | evidence found | candidate drafted **from the evidence**, citing refs |
| `unconfirmed` | searched, found nothing | honest empty — **not** a leaflet |
| `contradicted` | evidence found that conflicts | both reported; a human decides |
| `unsearchable` | no ingested source covers this | connect a source — a different remedy entirely |

`unconfirmed` and `unsearchable` must stay distinct: "your brain says nothing about this" and "you
never connected the repository where that work lives" have nothing in common but their emptiness.

---

## 10. Passive by default

A leaf does not decide to photosynthesise. Light falls; sugar accumulates. The agent runs on
declared sources continuously, and the user's only interaction is **review** — short, infrequent,
high-value — never an operation they must drive.

What makes passive honest:

- **Watermarks per source**, so incremental runs are cheap and idempotent. Now load-bearing rather
  than an optimisation.
- **Never interrupt.** Candidates accumulate; the user reviews when they choose. A noisy queue gets
  ignored, and an ignored review gate is the same as no review gate — which is how fabrication
  ships.
- **Ambient consent is a separate consent** from running a command once. Passive watching of a
  person's repositories and notes is enabled deliberately, per source, and visibly.
- **The unreviewed store is a real surface, not a buffer.** Passive drafting accumulates
  machine-written claims — including ones touching colleagues — *before* any human has looked. It
  needs the leaf's discipline, not a temp directory's.

---

## 11. Accuracy — five problems, separated

Conflating these is why systems like this drift.

| # | problem | question | state |
|---|---|---|---|
| 1 | **Attribution** | is this the right person? | signer-binding shipped; **roster NOT BUILT** |
| 2 | **Extraction** | did the agent read the evidence correctly? | structurally constrained, **never measured** |
| 3 | **Freshness** | has the evidence changed since we read it? | **NOT BUILT** |
| 4 | **Currency** | was it true then; is it the right claim now? | **NOT MODELLED** |
| 5 | **Corroboration** | does a shared ref really mean collaboration? | designed §8, **NOT BUILT** |

### 9.1 Freshness — content-address every ref

Both existing sources are already content-addressed *on purpose*: git uses the commit sha, photos
use `sha256:<hex>`, and `photoIntake.ts:156` explicitly refuses a path as a ref — *"paths change...
it is never evidence and never a ref."* That invariant is what makes freshness checkable at all.

A leaflet then stops being a stored claim and becomes **a stored claim plus a re-runnable check**:

| finding | means |
|---|---|
| `intact` | ref resolves, digest matches |
| `changed` | ref resolves, digest **differs** — the evidence moved under the claim |
| `unresolvable` | the ref is gone |
| `unchecked` | not looked at since `observedAt` |

Beside the tier, never collapsed — the pattern from §7, third application.

**OPEN — owner decision.** A brain page is *mutable*: it has both a locator (path) and content (a
digest). Git and photos need only one because their ref **is** the digest, and `Provenance` has a
closed key set (`source` / `ref` / `observedAt`). Either jam `sha256:…@/path` into `ref` (breaking
"ref is a stable handle") or **add a `locator` field**, required for mutable sources and absent for
immutable ones. *Recommendation:* the latter — it keeps "how do I re-find this" and "is it still
what I read" as two separate, honest questions.

### 9.2 Currency — supersession, not overwriting

A leaflet should carry **the period its evidence spans**, derived from the evidence (a git cluster's
first..last commit) and never asserted. Re-ingestion must **supersede** rather than duplicate or
overwrite, carrying a link to what it replaced.

**The hard constraint: supersession must never silently discard or resurrect a human's review
decision.** A re-run that quietly un-rejects something a person rejected is worse than a stale
claim.

### 9.3 Extraction — the measurement gap is the real problem

**There is no eval harness in this repository.** Verified 2026-08-17: zero fixtures, zero corpus,
zero eval directory. Accuracy cannot be engineered where it is not measured, and a structural
guarantee ("every claim cites evidence") is not an accuracy measurement.

The shape that already proved itself in this lineage is the `redaction-parity` harness in
career-box-dev: a shared fixture corpus, assertions in **both directions** — `mustDetect` *and*
`mustPreserve`, so over-correction fails too — and a ratchet that fails on regression. Pointed at a
different implementation it went PASS → FAIL with 10 named failures, so it detects regression rather
than rubber-stamping.

The Photosynthesis equivalent needs both directions:

- **must-ground** — every claim traces to cited evidence that supports it;
- **must-not-invent** — no claim exceeds what the evidence supports (the §9 echo-laundering guard).

**The review gate is already a label factory.** Every rejection carries a *mandatory reason*. That
is supervised data accruing as a by-product of the product working normally — exactly the labelled
corpus needed to measure extraction accuracy, collected without asking anyone to do extra work.

**Build the harness before tuning extraction**, so improvements are measured rather than asserted.

---

## 12. Hazards that are settled, and must not be re-opened

- **A constrained decoder cannot decline.** With a required, non-nullable schema field whose answer
  is absent from the source, the grammar leaves the model no way to say so, so it fabricates. Every
  field in every schema sent to a model **must be nullable**, and nulls must be dropped rather than
  stored. Measured; see `packages/photosynthesis/src/photoIntake.ts`.
- **Never ship a silent rewriter.** A mature PII redactor run over 800 real commit subjects altered
  12 lines and **11 were false positives** (`"bring README.ru.md hero in line"` →
  `"bring <HOSTNAME> hero in line"`). Rewriting falsifies what the evidence says. Detect, report,
  refuse — never quietly alter.
- **Model-transcribed text is a draft, never a fact.** Measured: the model invented occluded text
  despite an explicit instruction not to guess, and misread small type.
- **Loopback is enforced on the parsed hostname**, so an edit to a constant fails closed rather than
  silently egressing. The honest limit is stated where it is claimed: loopback proves the connection
  does not leave the machine, not that the bytes stop there.

---

## 12b. Decided by the owner — settled, and not to be re-litigated

**2026-08-18 — Roots are the extraction tools; they feed the trunk.** *"Roots are the tools to
extract data into the trunk core data pipelines."* This fixes the botany onto the data flow and
makes the two halves of the metaphor consistent: roots draw raw material from the surrounding
systems, the trunk carries it, leaves convert it into something visible. Photosynthesis happens in
the leaf; extraction happens at the root. So a **root** is any extraction tool — `git` intake, an
MCP server, a photo directory, graphify — and `docs/MCP-ROOTS.md` describes one *family* of roots
(enterprise MCP servers), not the whole root system. The contract generalises unchanged, because
what makes something a root is not the protocol it speaks but the rule it obeys: **a root reports
observations and never conclusions**, and the conclusion must be unrepresentable in its type.

**2026-08-18 — Internal visibility is consented by employment.** *"Consent in the company is based
on employment, as all work is for the company to decide what to do with."* So a leaf is visible
upward — branch, bough, tree — without a separate per-person opt-in. Work product belongs to the
employer, and an internal portfolio platform that required individual consent per view would be
asking permission for something already granted.

**Where that stops, and it must stop here or the product becomes something else.** Employment
consents to the company *seeing and using* the work. It does not consent to **publication**.
Publishing puts assertions about a named person in front of strangers who may make employment
decisions about them, which is the FCRA surface this whole design is shaped around
(§ *Hazards that are settled*). So:

- **Internal (branch → bough → tree): employment is the consent.** No per-leaf opt-in.
- **Public (canopy): a separate, explicit, typed-confirmation act**, through the redaction gate in
  `packages/canopy/src/publish.ts`, which already refuses to write anything without
  `--confirm <id>`. That gate does not care who operates it; it cares that a person read the
  withheld report and named the leaf. A company publishing an employee's portfolio is still that
  act, not a consequence of the employment relationship.
- **Leaving.** Internal visibility ends with employment. The leaf does not: it is in the open plane
  precisely so the subject keeps it. What the company retains is its own record of the work; what
  the person takes is their leaf. The open question that remains is narrower and is listed below —
  leaflets whose *evidence* lives in company systems the person can no longer reach.

**2026-08-18 — Emergence detection is a product feature: recruiters and hiring managers searching
individuals, companies searching public portfolios, and a future investor product (TBD).** It is
confirmed scope, not a hazard to design away. But the line it must not cross is narrow enough to
state precisely, and it is a line this product's own invariants already draw.

**The distinction that makes it shippable: WHO forms the judgement.**

| | who judges | verdict |
|---|---|---|
| A recruiter queries *"verified Rust leaflets since March"* and gets matches ordered by recency | the recruiter | **YES — build it.** A filter over published facts. The reader supplies the criteria and draws the conclusion. |
| Foliage computes *"emerging talent"* and surfaces a set of people it selected | **Foliage** | **NO.** That is an assessment of persons, produced by us, delivered to employers. It is a score whatever it is called, and no amount of naming avoids it. |

So emergence is a **saved query**, not a signal we compute and push. Every observation a canopy
makes must be **re-derivable by the reader from published evidence** — *"this leaf gained 12
verified leaflets since March, here they are"* is checkable; *"this person is emerging"* is a
rating. The moment we order people by anything other than a fact the reader chose, we have built
the scoreboard the platform prototype already refuses (*"Ordered by recency, because a ranked
search is a scoreboard"*).

**Why this is likely defensible, and why that is not a legal opinion.** The shape that keeps this
from being a consumer-reporting product is the same shape that makes it honest: **the subject
publishes their own leaf, by their own explicit act**, through a gate that refuses to write without
`--confirm <id>`. Nobody assembles a dossier about a person who did not publish. That is the
LinkedIn shape rather than the background-check shape, and it is structural here rather than
promised. **This is engineering reasoning, not legal advice — FCRA exposure carries statutory
damages, and counsel should review before the first recruiter uses this.** The engineering
posture is designed to make that review easy: no score exists to defend.

**Companies searching public portfolios** is the same mechanism one level up, with one caveat
recorded now: a tree is made of leaves, so any relaxation of these rules for *companies* leaks
back into rating the *people* inside them. Company-level observations must stay re-derivable too.

**The investor product is TBD and stays TBD** — it is named here so nobody builds toward it by
implication.

## 13. Open owner decisions

1. **Open `LEAFLET_KEYS` to give a leaflet a body** (§2) — the largest change this plan proposes,
   because it edits the open core's document format. Without it a leaflet stays a citation row and
   there is no artifact to share. *Recommendation: yes, with the body as a list of grounded
   elements rather than prose, so `must-ground` holds element-wise.*
2. **Per-leaflet visibility in the open plane** (§2), mirroring the enterprise plane's per-artifact
   release state in shape without importing it. *Recommendation: yes — a narrower open-plane
   visibility state, since `enterprise` may depend on `open` and never the reverse.*
3. **`locator` on `Provenance`** for mutable sources (§11.1). *Recommendation: add it.*
4. **Naming another person in the open plane** (§8). *Recommendation: mutual citation only.*
5. **SSH `%G?` = `U` no longer verifies** — shipped, measured, tested, but it changes what
   `verified` means. Needs an explicit yes/no.
6. **Whether the cloud plane should model Bough and Branch.** Currently it does not: nothing in
   `cloud` consumes a company's internal structure, and this repo does not ship plumbing that pays
   off only after future data arrives.
7. **Ambient capture defaults** — per-source opt-in is assumed; whether any source is on by default
   is a product call with privacy consequences. Note this is about which ROOTS run, and is
   unaffected by the 2026-08-18 employment-consent decision (§12b): that settles who may SEE a
   leaf inside a company, not which tools may read a person's machine.
8. **Evidence a departing person can no longer reach** (§12b). Their leaf is theirs, but a leaflet
   citing a Jira issue or an internal commit behind a login they have lost is a claim whose
   evidence they cannot produce on demand. *Options, none free: the ref stays and resolves to
   nothing for them (honest, but a dead citation); the leaflet is marked as evidence-unreachable
   (honest, and says why); or the company supplies a durable digest at capture time so the claim
   remains checkable without access. The third is the only one that keeps the evidence chain
   intact, and it has to be designed at CAPTURE, not at departure.*
