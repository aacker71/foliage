# Foliage — architecture of record

Three delivery models, one boundary. This document composes three design runs (local app,
canopy publish, enterprise) into one statement of how Foliage is shaped and why.

**Status lives in `.loop/STATUS.md` and nowhere else.** Rows are named here (C1, C5, P3, P4,
X3, X4, X6…) and never restated. Where this document says something is built, it names the
command that proved it. Where it says something is designed, it means no code exists.

## 0. What was verified while writing this, and what was not

Run on 2026-08-17 on this working tree, not copied from an earlier run:

- `timeout 300 pnpm check` → exit 0, **402 tests pass, 0 fail**. The boundary gate is the
  first step of `check`, so the three planes were re-proven separated in the same command.
- **Installer path, on a genuinely uninstalled tree.** The working tree was copied to
  `/tmp/foliage-fresh` without `node_modules`, and `node apps/leaf/server.mjs` run there. It
  printed the resolver's own message verbatim (`Cannot find package '@foliage/leaf' imported
  from …/apps/leaf/src/leafDocument.ts`), then `run \`pnpm install\` from the repository root
  first`, and exited 1. Both causes, never one — `apps/leaf/src/preflight.ts`.
- **Dashboard, empty.** `PORT=4890 node apps/leaf/server.mjs`, no `leaf.json` present, HTTP
  200. In a real browser: `readyState` complete, `document.fonts.status` loaded,
  `document.fonts.size` **4** (all four faces `loaded`), `document.getAnimations().length`
  **0**. Full-page screenshot taken and read: label `ABSENT`, heading "No leaf document was
  found", the prose distinguishing a missing file from an empty portfolio, the **absolute
  path searched** in a mono block, and the instruction "Create that file, or point
  FOLIAGE_LEAF at one somewhere else". The empty state names what is absent and where it
  looked. Nothing was seeded to make it look otherwise.
- **Dashboard, real data.** `node apps/leaf/intake.mjs --repo . --subject "Alex A" --identity
  <noreply address>` over this repository's own history → 33 non-merge commits, `verified 0
  pending 33 excluded 0`. The page then rendered 33 `[data-tier="pending"]`, 0 verified, 0
  excluded, `[data-fabricated]` **absent**, 0 running animations. Intake also reported 1
  commit **carrying a signature this machine did not check** (no `gpg` binary) rather than
  reporting it unsigned — P4's distinction firing on real history, not on a fixture.
- **Every resource origin is loopback.** `performance.getEntriesByType("resource")` on both
  states: 8 entries empty / 6 populated, **one origin, `http://127.0.0.1:4890`** — tokens.css,
  leaf.css, the mark, four woff2, favicon. **Zero external origins.** The privacy claim held
  under measurement in this run.
- The artifacts were removed afterwards (`apps/leaf/leaf.json` is gitignored and was deleted;
  the temporary copy and the server were killed). Ports 4180/4181 were not touched.

**Not verified here:** no viewport was emulated, so nothing in this document may be read as a
responsive claim (X1); the cloud and enterprise models below were **designed and not built**,
and no line of publish or integration code exists.

## 1. The planes, and why the boundary is the architecture

`public-boundary.json` declares three planes and `scripts/check-public-boundary.mjs` fails the
build on any violation, by declared dependency **or** source import:

| plane | packages | what it is |
|---|---|---|
| `open` | `@foliage/tokens`, `@foliage/leaf`, `@foliage/photosynthesis`, `@foliage/leaf-app` | one person's compound leaf, on their machine |
| `cloud` | `@foliage/canopy`, `@foliage/canopy-app` | the hosted service — tenancy, indexing, discovery, egress |
| `enterprise` | `@foliage/enterprise-policy`, `@foliage/photosynthesis-enterprise` | a company's internal portfolios and the policy governing outward release |

**Nothing in `open` may reach `cloud` or `enterprise`. The reverse is free** — that direction
is what open core means. The rule is data, checked by a program, so it cannot be honoured in a
review and lost in the next one. It is not a file-visibility rule; it is a licence rule, and
the fix for a violation is never to edit the manifest.

Beside it stands the harder claim: **the open plane makes zero network calls beyond
`127.0.0.1`.** That is what makes the leaf self-hostable and inspectable, and it is why the
leaf is open at all — a closed binary can only assert this; open source lets someone check it.
This run checked it (§0).

Two consequences follow directly, and they are the reason models 2 and 3 exist:

- **Publishing is a network call.** A publish button in `apps/leaf` would void the zero-network
  claim in exactly the surface whose auditability is the licensing strategy. "No network unless
  you press this" is not the claim being made.
- **An integration is a network call.** Atlassian, GitHub, Copilot, an internal wiki — every
  gatherer is egress or ingress across the machine boundary. None of them can live in `open`.

So publishing and integrating are not features of the local app. They are **crossings**, and a
crossing is a plane change: user-initiated, one at a time, never ambient sync, never background
upload.

## 2. Model one — LOCAL PERSONAL APP (open plane)

The thing verified in §0. `node apps/leaf/intake.mjs` reads real `git log` history and writes a
document `parseLeafDocument` accepts; `node apps/leaf/server.mjs` serves it on `127.0.0.1`.
No build step, no bundler, no `dist/` — Node 22–24 runs the TypeScript directly by type
stripping. **No third-party runtime dependency exists**, so there is no supply chain between a
person's evidence and the page rendering it; `pnpm install` links workspace packages and
downloads nothing the page needs at runtime. Ledger rows: C1, C5, P1, P2, P4.

Tiers are the product's honesty, not a display detail. Only a signature git **accepted** and
**bound to a declared identity** is `verified`; everything else attributable is `pending`;
`excluded` carries a required reason. There is no score, rating, rank, confidence or
percentage anywhere, in a field or in prose — `ProofTier` is three unordered values.

**One defect in this model is load-bearing for model two.** `apps/leaf/server.mjs:40` reads
`HOST` from the environment. It defaults to loopback, and the default is what makes the privacy
claim true — but `HOST=0.0.0.0` serves the same page to the internet, and that page carries the
operator's **absolute filesystem path** in its footer (observed this run:
`~/…/apps/leaf/leaf.json`, with byte size) and every excluded row's short sha. This
is reachable today with an environment variable and needs no cloud work to fix.

## 3. Model two — CANOPY PUBLISH (cloud plane), designed, not built

One subject publishes their **own** leaf. A tree is not publishable by this path: a tree page
publishes N people at once and no one of them can consent for the others (C2 renders real
third-party contributor names). Publishing a tree is a separate, larger question.

Four parts, one direction:

1. **Policy lives OPEN.** `@foliage/leaf` gains a pure, total, versioned *publication view*:
   `Leaf` in, `{ crossing, withheld, unresolved, policyVersion }` out. No fs, no network, no
   throw — the same discipline as `parseLeafDocument`. Open because the rule deciding what
   leaves a person's machine is precisely the rule they must be able to read, and because a
   self-hoster faces the identical defect and would otherwise get nothing.
2. **Preview lives OPEN and OFFLINE.** One route in `apps/leaf` renders that function's
   output. No account, no network, no knowledge that a canopy exists. This is where a person
   decides, and it keeps working if the service dies.
3. **The crossing lives CLOUD.** A cloud-plane publisher (never in the open set) imports
   `@foliage/leaf` — legal, cloud→open — recomputes the same view, prints the identical set,
   requires a typed confirmation of the destination, performs exactly **one** POST, writes a
   receipt.
4. **Refusal lives SERVER-SIDE.** The canopy re-runs the egress screen over what it received
   and refuses to store or serve anything that trips it. The client is never trusted; both ends
   run the same open rule.

Rejected: a publish button in `apps/leaf` (breaks the boundary and the claim); the canopy
pulling from a user-supplied URL (ambient sync wearing a different hat — it republishes later
changes with no human present).

**The gate on all of this: the verbatim-title defect.** Commit titles render verbatim
(`apps/leaf/src/render.ts:157`, `data-verbatim="title"` — 33 such nodes on the page rendered in
§0). On multi-author history those titles carry other people's names and email addresses, and
merge/revert subjects carry score-shaped words the product itself never writes. Publishing a
page that asserts things about identifiable third parties, sourced from records they did not
review, is the shape FCRA regulates. **Redaction changes what the page asserts, so it is an
owner call, and no publish path may ship before it is answered.** It is marked in the code, not
fixed. C1 and C5 record the observation; this document states the consequence: the marker is
the single selector a publication view would screen on, and it is the reason the withheld set
must be shown to the subject before any byte crosses.

## 4. Model three — ENTERPRISE (internal platform), designed, not built

A company runs Foliage internally over the artifacts it already holds. The taxonomy is modelled
(`packages/photosynthesis-enterprise/src/subject.ts`) and pure: no fs, no network, no clock, no
throw. Ledger row P3 — and the distance from it to a usable product is entirely the ingestion
path, which does not exist.

**Integrations are gatherers, and every gatherer goes through the same airlock as the local
model.** An Atlassian, GitHub or Copilot connector produces *candidates*, never leaflets. A
candidate enters a harvest document, a human reviews it, and only approved titles cross into a
leaf as ordinary `pending` leaflets — the seam P1 already proves for the local drafting path,
with the enterprise release machine (`@foliage/enterprise-policy`) added on the way out, where
`approve` and `publish` are separate events fired by different actors and `approved` is not
public. No connector may write a leaflet directly. This is also why integrations cannot live in
`open`: they are network I/O, they hold credentials, and they read a company's systems.

The line about what may be read is drawn in the type system, not only in prose: artifacts a
person or team **already produced**, each carried by a `Provenance` ref with a re-checkable
handle. There is no field anywhere for an inferred trait, an activity signal, a behavioural
summary, or any number about a person — so a monitoring feed has nowhere to land without a
format change that must be reviewed on its own merits.

## 5. The taxonomy, settled

Canopy › Tree › Bough › Branch › Leaf › Leaflet. A **Tree is a company**, a **Bough is an
organization** (a business unit), a **Branch is a team**, a **Leaf is one person's portfolio**,
a **Leaflet is one artifact of evidence**. Every link is a real botanical containment; that is
the test a word has to pass. Capitalized `Branch` is never git's branch — the two words appear
in no file together. Ledger row P5.

**A leaf always hangs from a branch, even when it is the only leaf on it.** A person who
reports into an organization with no team still sits on a branch of one; the alternative is a
leaf attached to a bough, which is not a containment the metaphor supports and which would let
"who approves this" resolve to an organization. **This is not yet true of the code:**
`packages/photosynthesis-enterprise/src/subject.ts:154` documents and permits "zero or more
branches", and `LeafSubject.branches` is a possibly-empty list. The decision above is the
settled taxonomy; the type does not enforce it yet. Listed in §6 rather than asserted here.

## 6. NOT BUILT — so this document cannot be mistaken for a description of a product

Nothing in this section exists. No partial implementation, no dormant flag, no dark plumbing.

- **Canopy publish, entirely.** No publication view, no preview route, no publisher, no
  server-side refusal, no receipt. §3 is a design.
- **The FCRA verbatim-title decision** — owner-gated. Blocks every publish path.
- **Enterprise ingestion, entirely.** No connector, no credential handling, no app surface, no
  route: P3's domain has no consumer outside its own tests.
- **The branch invariant** — the code still permits a leaf on zero branches (§5).
- **Tenancy, auth, billing, provisioning, deploy.** The hosted service — "the product being
  sold" per `public-boundary.json` — has no rows in the ledger at all and no code in the tree.
- **X3, licence + CLA** — owner-gated. The repository has no licence, so "open source" is a
  design commitment enforced by a boundary gate, not a granted right.
- **X4, `appId` / domain** — owner-gated.
- **X6, bough and branch in the cloud domain.** `@foliage/canopy` models Canopy → Tree → Leaf
  and stops; a leaf hangs from the tree directly there. Deliberate — nothing in `cloud`
  consumes a company's internal structure yet, and this repository does not ship plumbing that
  only pays off after future data arrives.
- **The mark.** `packages/foliage-tokens/src/mark-primary.svg` is still the 427-byte circinate
  coil that `.loop/LAUNCH.md` §2 records as superseded by the owner's chosen bipinnate frond.
  It is what rendered in this run's screenshots.
