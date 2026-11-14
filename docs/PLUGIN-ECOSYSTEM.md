# The plugin ecosystem

**Current integration direction — 2026-09-08.** The early inventory and measurements below
are historical. [Integrations](INTEGRATIONS.md) records the current provider roadmap and
bounded observation-import bridge into existing harvest/review. Provider APIs, managed
enterprise integration and MCP are distinct adapters, not proof of a live connection.
The capture spec referenced below now exists. Arbitrary third-party plugin execution and
an unrestricted credential-bearing plugin loader remain outside the implemented bridge.

How third-party code extends Foliage without being trusted, and what the product may still promise
a user once it does. This **extends** `docs/MCP-ROOTS.md` and `docs/ENGINEERING-PLAN.md` §5, §11b,
§12 rather than restating the root contract; for the hierarchy see `docs/SYSTEM-ARCHITECTURE.md`
§1, and for what a leaflet is, `docs/LEAFLET-CAPTURE-SPEC.md` — another lane, **not present in this
checkout** (`ls docs/` returns `ENGINEERING-PLAN.md`, `MCP-ROOTS.md`, `SYSTEM-ARCHITECTURE.md`
only, at HEAD `bc8d9bc`).

## Status, up front

| | |
|---|---|
| **Built** | **Nothing.** `grep -rni "plugin"` over every `.md`/`.ts`/`.mjs`/`.json` outside `node_modules` and `graphify-out` returns **zero hits**. No manifest, parser, registry, host or loader. |
| **Measured, load-bearing** | The three gates this leans on run today: `apps/photosynthesis/src/harvestDocument.ts:312`, `packages/leaf/src/document.ts:147`, `scripts/check-public-boundary.mjs`. |
| **Design only** | Everything from §1 down. Nothing below describes current behaviour. |

## 1. Why an ecosystem, and the one rule

Dispatch today is a fixed CLI (`apps/photosynthesis/photosynthesis.mjs:40`) over three hard-coded
gatherers — `gatherGit`, `gatherReadme`, `gatherPhotos` (`apps/photosynthesis/src/gather.ts:98`,
`:149`, `:165`). Every new source of evidence is therefore a commit to this repository, which is
the wrong shape for a product whose claim is *your evidence, wherever it already lives*; and the
owner has settled that a **root is any extraction tool** — git intake, an MCP server, a photo
directory, graphify (`ENGINEERING-PLAN.md` §11b) — an open-ended set, not ours to enumerate. The
seam already tolerates it: all three producers land in one harvest document through one parser, and
`promoteApproved` writes `tier: "pending"` unconditionally for each (`promote.ts:47`). None needed
a change to the harvest format, to review, or to promotion — the test of whether a seam was drawn
in the right place.

> **The rule, and it is the only one.** A plugin reports **observations**, never conclusions;
> everything it produces enters through the human-review airlock; and the conclusion is
> **unrepresentable in its type**.

That is `MCP-ROOTS.md`'s rule generalised without amendment. What this adds is the second half: an
MCP root is code the company already authorised; a plugin is code **nobody** authorised. Same
contract, different trust model.

## 2. The extension kinds

Two, discriminated by what the extension may **say** — not by where its bytes came from. "Gatherer"
versus "analyser" describes where data sat and yields no different contract: not a kind, a name.

**`SOURCE(pointers)`** — observations carrying a ref and **no prose the extension composed**. The
host builds every human-readable string from measured facts, as `toLeaflet` already does with
`${first.source}:${first.ref}` (`promote.ts:48-51`). Element:
`{upstreamId, ref, observedAt, fields: {label, text}[]}` — `text` only, because a number invites
arithmetic and arithmetic over items is a score. Maps onto `EvidenceRef`, three keys
(`harvestDocument.ts:117`). May not compose a title or a summary.

**`SOURCE(claims)`** — composed prose, every line of which **must cite refs drawn from the set the
host handed it**. The shape that already exists: `Candidate.drafted` is prose, `Candidate.evidence`
is the verbatim material it was drafted from, "non-empty by construction"
(`harvestDocument.ts:62-77`).

A **discriminated union**, not one shape with a capability flag — same reason `McpDraw`'s partial
arm has no `artifacts` property. With a flag, a pointer source can still *carry* a prose field,
nobody has to narrow, and an ungrounded string reaches review wearing the host's authority.

**Refused as kinds:**

| Kind | Why |
|---|---|
| RENDERER (code in the page) | Every guarantee here is an airlock guarantee about what *enters* a leaf; a renderer runs on the reader's side, governed by nothing. It could print `verified` beside a `pending` leaflet without touching a document, or total something in a template — `SCORE_SHAPED` guards document keys (`document.ts:82-100`), not template arithmetic, and `AGENTS.md:22` forbids a score being *displayed*. §6 replaces it |
| TIER-ASSIGNER / PROMOTER / REVIEWER | `promote.ts:47` writes `pending` unconditionally; changing it is AI output claiming proof |
| SCORER / RANKER / ORDERER | `SYSTEM-ARCHITECTURE.md` §5 R1–R6 |
| ATTRIBUTOR | Identity is declared, never inferred — measured: one human under seven identity strings (`ENGINEERING-PLAN.md` §6) |
| PUBLISHER | Publication is a separate, typed-confirmation act (§11b; R11) |
| REDACTOR | Measured: 11 of 12 edits by a mature redactor were false positives (§11). Detect, report, refuse — never rewrite |

## 3. The trust model — enforced versus promised

A plugin is untrusted code running beside a person's portfolio, so the principle inverts:

> We do not enforce what a plugin **does**. We enforce what it can **say**, and we tell the person
> exactly what it could do.

The other way round would be a lie: nothing in Node stops a child process opening a socket, and a
promise dressed as a gate is worse than a stated limit.

**Enforced — by code that exists, or by a total parser:**

| # | Enforced | Where |
|---|---|---|
| T1 | Output is **data**, never a module: never imported, never resolved by the package manager, never in the host's module graph | §7 |
| T2 | Unknown keys refused, and score-shaped keys refused **by name**, at every nesting level | `harvestDocument.ts:194`, `document.ts:147` |
| T3 | No tier, no contributors, no proof — `Candidate` has no `tier` key at all | `harvestDocument.ts:107-115`; `promote.ts:47` |
| T4 | Nothing reaches a leaf without a human approving that exact candidate | `promoteApproved` |
| T5 | An open-plane plugin cannot reach cloud or enterprise code | `scripts/check-public-boundary.mjs` |
| T6 | A repeat across two runs is refused at the document door by deterministic id | `MCP-ROOTS.md` §*Resuming* |

**Promised, declared, or not knowable — said out loud rather than implied:**

- **Egress.** A plugin declares `network: "none" | "loopback" | "outward"`; the declaration is
  *shown on the review page*, not enforced at the socket. The plane gate says the same of itself —
  *"It cannot see a runtime `fetch` to a private URL"* (`check-public-boundary.mjs:28-29`). An OS
  sandbox is the only real enforcement: **OPEN** (§8b B).
- **Filesystem reach.** A subprocess runs as the operator. Same limit.
- **Truthfulness.** A plugin can emit a ref that resolves to nothing. The control is a human
  reading the verbatim excerpt beside the claim before approving it.
- **Free upstream text is not scrubbed**, and a third party's name inside someone else's prose is
  not detectable — carried forward from `MCP-ROOTS.md` §*Known limits*.

**What a plugin author cannot do**, checkable by them: set a tier; name a contributor; emit a
number in any field (17 keys refused by name, incl. `weight`, `confidence`, `rank`, `percent`,
`strength`); order anything; write to a leaf; render anything; publish anything; ship a dependency
into the host; be enabled by default.

## 4. Declaration — nothing is ambient

One person names one plugin in one file they own — the posture of the publication gate, which
refuses to act without `--confirm <id>` (R11).

```
roots.json   — gitignored, beside leaf.json; a person's own config, never in this repo
  { "roots": [ { "id": "graphify", "run": ["graphify", "query", "--json"],
                 "kind": "pointers", "network": "none", "attributesTo": "<leaf id>" } ] }
```

1. **Explicit list, no discovery.** Nothing is found by scanning `node_modules` or a directory. A
   source that turns itself on is ambient capture — `ENGINEERING-PLAN.md` §12.7, an **open owner
   decision**, not a default.
2. **One root, one subject.** `attributesTo` names a subject the tree already contains, checked by
   `containment`, narrowable and never widenable (`MCP-ROOTS.md` §*What is inherited*).
3. **Absence is its own state.** A declared plugin whose binary is missing reports *that*, with the
   remedy — never an empty result. Precedent: the CLI exits non-zero rather than write a
   zero-candidate file, because such a file is indistinguishable from an honestly empty one
   (`photosynthesis.mjs:15`; `README.md:98-101`). An empty root list is honest; an empty allow-list
   inside a root is not.

## 5. Graphify, worked

Measured: `graphify-out/graph.json` holds **561 nodes, 871 links**, `built_at_commit` `38a8a26` —
**34 commits behind HEAD** (`git rev-list --count 38a8a26..HEAD`). `graphify-out/` is gitignored
(`.gitignore:56`) and `.loop/STATUS.md:85` already carries **X5 — PARTIAL / STALE**. Staleness is
this root's *ordinary* state, so the design treats it as normal, not exceptional.

**Kind: `SOURCE(pointers)`** — its natural output is `source_file` + `source_location`, refs.

**It may observe:** that a symbol exists at a file and line at a named commit; that a typed,
directed relation exists between two symbols, itself carrying a `source_file` and `source_location`;
and which commit the graph describes. Each is re-checkable by opening a file.

**It may never claim:**

- **Authorship.** Full key survey, this session — node keys `_callable, _callable_class, _origin,
  community, community_name, confidence, file_type, id, label, norm_label, source_file,
  source_location`; link keys `_origin, confidence, confidence_score, context, relation, source,
  source_file, source_location, target, weight`. **Zero author-shaped keys across all 561 nodes and
  871 links.** Graphify does not know who wrote anything and cannot be made to.
- **Importance — "god node", "core", "hub", "architectural".** Ranks (R5, R6).
- **Its own confidence.** Every node carries `confidence`; every link carries `confidence`,
  `confidence_score`, `weight`. `confidence` and `weight` are in `SCORE_SHAPED`
  (`document.ts:82-100`); **`confidence_score` is not**, matching being exact-lowercase
  (`document.ts:147`) — a **gap** (§8.3), not dressed as a gate. The structural control is that a
  pointer source has no field to put it in.
- **Anything about the current tree**, unless `built_at_commit` equals the commit observed —
  otherwise the observation carries the commit it *does* describe.

**Gameability verdict: trivially gameable, and harmless — but only because nothing it emits is ever
counted.** Anyone can inflate a graph by adding files; if these observations were aggregated,
ordered or compared, that is a scoreboard someone can farm. They are not: each becomes at most one
`pending` candidate a human must read and approve, and no total is computed at any level (R3, R4).
Generalised — **a root's gameability only matters if something downstream aggregates it**, which is
a second reason the no-aggregate refusals are load-bearing rather than stylistic.

## 6. The presentation extension

Replaces the refused RENDERER, and it is **not code**: a declarative override of a closed set of
named custom properties, read by a total parser. No selectors, no arbitrary declarations, no script.

Possible because the surface is already token-driven and already gated. Measured: the leaf page
loads exactly three same-origin stylesheets (`apps/leaf/src/render.ts:125-127`); assets are an
exact-path **allow-map** of six entries with no user-controlled path component
(`apps/leaf/server.mjs:90-100`); and the CSP is `default-src 'none'; style-src 'self'; img-src
'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
(`apps/leaf/server.mjs:149`) — **no `script-src` at all**, so a theme cannot smuggle behaviour.

> **The refusal that makes this kind allowable.** Presentation may never contradict evidence. A
> theme may change how the page **feels**. It may never change what the page **says**, what it
> **omits**, or what it **implies about proof**.

Structural, not promised:

- A theme addresses **token names only** — it cannot select an element, so it cannot reach the tier
  pill's word, the ledger counts, the exclusion reason or the fabrication band.
- **Tier colours are not themeable.** Tiers are a grouping, not a rank (R2); a theme that could make
  `verified` gold and `pending` grey has invented an ordering the domain refuses.
- **`display: none` is unrepresentable** — there is no declaration channel, only values for named
  tokens. Hiding `excluded` rows turns an honest count into a lie (`AGENTS.md:24`).
- **The contrast gates re-run against the declared theme.** `apps/leaf/src/dayFace.ts` measures
  pairings against the real token file; a failing theme is refused with the ratio (`AGENTS.md:88`).
- **No URLs**, because fonts are self-hosted: the privacy claim is zero network calls and a runtime
  font CDN breaks it (`AGENTS.md:80-81`).

## 7. The zero-dependency question (historical rationale)

2026-09-05: server-rendered shadcn adoption supersedes the zero-runtime-dependency wording
quoted below. See [UI-FOUNDATION.md](UI-FOUNDATION.md). Plugin subprocess isolation remains
its own design decision; the historical dependency counts and proposed README wording below
are not claims about the current application.

`README.md:32` promises: *"Zero **third-party** runtime dependencies — after the one-time `pnpm
install` links the workspace packages, a JSON file and `node` are the whole requirement, so there is
no supply chain between someone's evidence and the page that renders it."*

Measured: `pnpm-lock.yaml` is **112 lines** and its `packages:` block holds exactly three entries —
`@types/node@22.20.0` (`:93`), `typescript@5.9.3` (`:96`), `undici-types@6.21.0` (`:101`) — all
devDependencies (`package.json:20-23`). Node 22.18+ runs TypeScript directly (`package.json:14`,
`--experimental-strip-types`); no build step, no `dist/` (`AGENTS.md:15`).

**A plugin system that `npm install`s plugin packages destroys that promise, and no variant of it
survives:** a resolved dependency is in the lockfile, in the module graph, and in the process that
renders a person's portfolio. **So a plugin is never a dependency. It is a subprocess.** The host
spawns a command the person named and reads a document from its stdout — the posture `gatherGit`
already takes toward `git` (`gather.ts:18`, `execFile`). The plugin's language, runtime and
dependencies are its own business precisely because none of them enter this process, this lockfile,
or this page.

**What the product may honestly say once plugins exist** — the wording the README should carry:

> Foliage has zero third-party runtime dependencies, and enabling a plugin does not change that. A
> plugin is a program **you** chose to run: its dependencies are its own, it runs in its own
> process, and it is never loaded into Foliage. The page that renders your leaf loads only
> Foliage's own bytes, and the leaf contains only what you approved.

Three things make that true rather than merely reassuring: the plugin's product is a document, not
an object; the artifact is written by `promoteApproved` and re-validated by the leaf parser, so it
is the gate's output and not the plugin's; and the lockfile is a checkable invariant — a gate
asserting exactly those three entries would fail the instant anyone tried. **That gate does not
exist** (§8.2), so today the promise is upheld by habit.

## 8. NOT BUILT

Absent from the tree as measured — not partial, not dark.

1. **All of it.** Zero occurrences of "plugin" outside `node_modules`. No manifest, no `roots.json`,
   no parser, no host, no subprocess protocol, and no dynamic dispatch anywhere —
   `photosynthesis.mjs` is a fixed CLI over three gatherers.
2. **A lockfile gate.** Nothing asserts the three-entry `packages:` block.
3. **`confidence_score` is not refused.** `SCORE_SHAPED` is matched exact-lowercase
   (`document.ts:147`) and the key is absent from all three copies.
4. **`SCORE_SHAPED` exists three times** — `document.ts:82`, `publishedDocument.ts:226`,
   `harvestDocument.ts:124`. `MCP-ROOTS.md:225-227` already argues the fix: export the rule, do not
   copy it. A plugin system must not become the fourth copy.
5. **No egress test.** The plane gate is static and says so (`check-public-boundary.mjs:28-29`).
6. **No theme mechanism** — no token-override parser, no theme contrast gate.

## 8b. OPEN — owner decisions

None of these should be decided by an agent.

- **A. Does an open-plane host spawn a plugin declared `outward` at all?** The open plane's privacy
  claim is zero network calls beyond `127.0.0.1`. *Recommendation: refuse in open; allow only in
  cloud/enterprise, which already license an outward call. Cost: a class of useful roots becomes
  enterprise-only.*
- **B. OS-level sandboxing, or declaration plus disclosure?** A sandbox is the only real enforcement
  of §3's promised half, and it is platform-specific, fragile, and a large surface. *No
  recommendation — the security/effort call is the owner's.*
- **C. Do we ever distribute a plugin?** A registry makes us a supply chain for untrusted code
  running beside portfolios. *Recommendation: no registry until B is answered.*
- **D. Does a theme travel with a published leaf, or stay local?** A theme on a published page is
  third-party presentation in front of strangers who consented to nothing (R16). *Recommendation:
  local only.*
- **E. Fix `confidence_score` by adding the key, or by squashing separators?** Both mis-fire, in
  different directions, and it interacts with 8.4 — fix the duplication first or the fix lands in
  one copy of three.
