# The MCP root system

**Current integration direction — 2026-09-08.** Read [Integrations](INTEGRATIONS.md) for
the owner-requested HRIS, learning, mail/files and assistant roadmap. MCP is one transport;
direct provider APIs and an eligible integration service are also in scope. The domain
contract below remains reusable, but an authorized MCP session alone does not establish
Foliage ingestion/publication consent or expose every provider's records. The historical
Claude Code session-record mapping below is unverified; a coding-tool MCP server does not
by itself provide a chat-history API. No live provider acquisition is claimed here. The
[local assistant server](ASSISTANT-MCP.md) now accepts selected observations into Leaf review;
it is separate from this enterprise root contract and does not inherit organizational consent.
The MCP-only rationale and inherited-consent claim below describe the earlier design.
They are superseded: upstream read authorization, Foliage admission, company-material
authority and personal publication consent are distinct and must each be checked where used.

How enterprise material reaches Photosynthesis, why it arrives through **MCP** rather than
through connectors, and — stated first because it is the part that would otherwise be assumed —
**what on this page has actually been exercised on this machine and what is contract only.**

The contract is `packages/photosynthesis-enterprise/src/root.ts`, driven by
`root.test.ts`. It is in the `enterprise` plane: nothing in `open` may reach it, and
`pnpm check:boundary` enforces that rather than trusting it.

## Status, up front

| | |
|---|---|
| **Built and exercised** | The contract: the root declaration format and its total parser, the observation contract, partial-failure modelling, and the tenancy refusals. Driven by 40 tests against real values. |
| **Contract only — never run** | This enterprise root contract has no live provider connector. The separate local assistant server accepts selected observations; it does not acquire enterprise MCP roots. |
| **Not reachable from this machine** | Atlassian's MCP server, and whatever Microsoft exposes for WorkIQ/Copilot. Neither was contacted. Nothing on this page claims either one works. |
| **Reachable and measured** | `gbrain serve` — a real MCP server installed locally. See *What was measured* below. |

A connector written here could not have been exercised, and an unexercised connector that claims
to work is the exact failure this repository exists to refuse. So this lane shipped the contract
and stopped there, deliberately.

## Why MCP, and not N connectors

The enterprise sources named for this product — **WorkIQ / Copilot, Atlassian, Claude Code** —
all already expose or speak MCP. A company that runs them has **already deployed and already
authorized** those servers for its agents.

Writing a bespoke connector per vendor means re-implementing, per vendor, the three things that
are hardest to get right and most damaging to get wrong: **authentication**, **consent**, and
**tenancy**. Photosynthesis therefore does not connect to Jira. It becomes an **MCP client**, and
the company's own MCP servers are the root system that feeds it.

That is less code, and it is a better consent story, because **the company already decided that
an agent may read those tools.** This product does not get to make that decision on the company's
behalf, and now it structurally cannot: there is no credential field anywhere in the format, and
`CREDENTIAL_SHAPED` refuses those keys by name so the message says *no credential belongs in this
file* rather than *unknown field*.

### `McpRoot` is not MCP's `roots/list`

The collision is permanent, so it is written down before it costs anyone an hour — the same
discipline this repository already applies to `Branch` versus git's branch.

- In the **protocol**, `roots/list` is a **client** capability: the client tells the server which
  filesystem or URI boundaries it may operate within.
- `McpRoot` here is the opposite direction and a different noun: a **botanical** root, the organ
  through which this organism draws material *in*, declared by a tenant and pointing *at* a
  server.

Nothing in `root.ts` implements, consumes or contradicts `roots/list`. The rule:
`McpRoot`/`McpRootId` and the phrase "root system" are this taxonomy; the protocol's is always
written `roots/list` and only ever appears in prose describing the protocol.

## What is inherited, and what we enforce

| | Who owns it | Why |
|---|---|---|
| **Authentication** | Inherited | The calls ride an MCP session the company already authorized. This package holds no credential and has no field to put one in. |
| **Consent** | Historical assumption, superseded | Company authorization to read its MCP server does not authorize Foliage ingestion, attribution or publication. The current [admission contract](INTEGRATIONS.md#architecture-separate-transport-from-authority) requires these permissions separately. |
| **Per-user visibility** | Inherited | An MCP server enforces its own ACLs. If the operator cannot see an issue, the tool does not return it. |
| **Which tools may be called** | **Enforced here** | The one thing the tenant declares in this format. An MCP server's surface is large — the one measured here advertises **106 tools** — and inheriting all of it is not a decision this product may make on a company's behalf. A page from an unpermitted tool is refused even though the server answered it. |
| **Which Subject material is attributed to** | **Enforced here** | A root belongs to exactly one `Tree`. Material may only be attributed to a subject that tree contains, checked with `subject.ts`'s `containment` — not a second copy of the rule. A page may **narrow** the subject (a bough root drawing to a branch inside it) and may **never widen** it. |
| **Whether anything is proof** | **Enforced here** | An MCP root cannot assert a tier, cannot attribute work to a person, and cannot leave the internal release state. See below. |
| **Transport safety** | **Enforced here** | `https` to anywhere; plaintext `http` only to the loopback interface, checked on the **parsed hostname** so that `http://127.0.0.1.evil.example/` is refused. Credentials in the URL's userinfo are refused. An unparseable URL fails closed. `localhost` is accepted and is the weakest entry on that list — it is a *name*, and a name resolves; an adapter that actually dials one should re-check the address it resolved to, which is app work. |

The transport rule is an **adaptation** of `apps/leaf/harvest.mjs`'s loopback rule, not the same
rule, and saying so matters: harvest is loopback-**only** because the open plane's privacy claim
is zero network calls beyond `127.0.0.1`, whereas a company's Atlassian server is by definition
remote. What carries over is the **method** — parse the hostname, fail closed — not the verdict.

## AI output is never proof, made unrepresentable

`drawFromRoot` writes three things unconditionally, with **no input that can change any of them**:

```
review:       { state: "candidate" }     — nobody has read this draft
release:      "internal"                 — the default, and the only safe one
contributors: []                         — an MCP root cannot name a person
```

Then it re-validates its own output with `parseEnterpriseDocument`, so the artifacts handed back
are the **gate's** and not this module's opinion of what it built — including the gate's own
review-gate document door, which refuses any release state beside an unread draft.

Three consequences worth stating plainly:

- **A root cannot attribute work to a person.** An upstream `assignee` is a string somebody typed
  into a ticket system. Treating it as attribution would be `git config user.email` all over
  again — self-declared, and the precise reason a matching author address yields `pending` and
  never `verified`. Contributors are added by a human at review, inside `containment`.
- **A root cannot smuggle arbitrary JSON into the document.** An MCP tool returns arbitrary JSON;
  the narrow shape accepted from it is `McpObservation` — an upstream handle, the upstream's own
  title string, and a flat list of labelled **text**. Those fields do **not** enter the artifact.
  The enterprise document format was deliberately **not widened** to hold them; they come back
  *beside* the result in `observedFields`, exactly as photo intake's `transcriptions` do. Widening
  the format to hold upstream JSON is the precise door a monitoring feed would walk through, and
  `subject.ts`'s charter closes it.
- **Score-shaped and proof-shaped field labels are refused by name.** `SCORE_SHAPED` is imported
  from `@foliage/leaf` — one list, now four gates — and the proof-claim labels are derived from
  `PROOF_TIERS` rather than listed. A withheld field is reported **with its text**, because a
  refusal nobody can see is indistinguishable from a tool that returned nothing.

## Partial success can never render as an honest empty result

An MCP call may return 900 of 1000 items, or time out mid-page. That is neither a failure nor a
result: reporting it as an error discards nine hundred real items, and reporting it as a result
asserts a portfolio of nine hundred.

This is enforced by the **shape** of `McpDraw`, not by asking callers to be careful:

- the **complete** arm exposes `artifacts`;
- the **partial** arm has no such property — it exposes `artifactsSoFar`, beside `shortfall`,
  `resume` and `skipped`.

So `draw.artifacts` does not type-check until the caller has narrowed on `completeness`, and a
caller who narrows cannot avoid seeing that material is missing. `isHonestlyEmpty(draw)` is the
one predicate a renderer needs, and it is true **only** for a complete draw with no artifacts. A
timeout that returned nothing has the same zero artifacts and the opposite meaning.

A draw is **complete** only when the upstream *said* there is nothing more **and** nothing that
arrived was dropped. `shortfall` is a list, never one cause — a page can time out *and* have items
skipped *and* leave more upstream, and reporting one of the three is the error-masking bug
`AGENTS.md` names. Each shortfall carries a count **or `null`**: what a timeout cost is not
knowable, and a zero there would say "this cost nothing".

### Resuming, and what happens when the upstream changed underneath

`McpResume` has four arms because they make four different promises:

| arm | the promise | what breaks |
|---|---|---|
| `cursor` | the server issued an opaque cursor | stability is the *server's* promise; a later rejection surfaces as an interruption, which is honest |
| `offset` | positional resumption | **positions move.** An item inserted upstream above the offset shifts everything below it, so a resumed read **skips** an item; an item deleted makes it **repeat** one |
| `watermark` | "everything changed since this instant", the **upstream's own** timestamp | an item whose timestamp equals the watermark can be missed or repeated depending on whether the filter is inclusive; clock skew between that server and this machine is unobservable from here |
| `none` | there is no way to resume | the read can only be re-run from the start, which is a different read at a different instant. Carries *why* |

Repeats are survivable and skips are not, and the asymmetry is stated rather than smoothed over:

- **Repeats are caught.** The artifact id is deterministic —
  `mcp:<server>/<tool>#<upstreamId>`, percent-encoded per segment — so the same item drawn on two
  resumed pages produces the same id, and `parseEnterpriseDocument` refuses the duplicate at the
  document door. There is a test that does exactly this.
- **Skips are not detectable from here at all.** Nothing in this contract can tell you that an
  offset resumption missed an item. The honest mitigation is to prefer `cursor`, then `watermark`,
  and to treat an `offset` resumption as a read that may be short — which is why `offset` never
  produces `completeness: "complete"` on the page that issued it.

## How each named source maps onto the contract

**None of these three was contacted from this machine.** What follows is how each *would* be
declared, with the unverified parts marked.

### Claude Code

`claude mcp serve` exists on this machine (`claude` is at `~/.local/bin/claude`; the
subcommand is listed by `claude mcp --help`). **It was not run.** Declared as:

- `endpoint`: `{ transport: "stdio", command: "claude mcp serve" }`
- `grant`: `inherited-session` — it runs as the operator, with the operator's own filesystem
  reach. That is the arm the architecture argument is about.
- `attributesTo`: usually a `leaf` — a coding session is one person's work.
- Material: session records. Their titles are the upstream's own; a session with no name is a real
  state and produces `session:<id> — item returned by <tool> with no title`, never an invented one.

### Atlassian

Atlassian publishes a remote MCP server for Jira and Confluence — **which is knowledge, not a
measurement: it was not reachable from here, was not contacted, and nothing below is verified.**

- `endpoint`: `{ transport: "http", url: "https://…" }` — https, enforced on the parsed URL, with
  no credential in the userinfo.
- `grant`: `inherited-session` when the operator has authenticated their own client;
  `service-principal` **with a required `authorisationRef`** when a machine identity is used,
  because a machine identity reads on behalf of many people and "the company agreed" then has to
  name where the company agreed.
- `attributesTo`: a `branch` or `bough` — a Jira project or a Confluence space maps onto a team or
  a business unit, not onto a person.
- Partial failure: expected to be the `cursor` arm; **unverified**, and if the server turns out to
  paginate positionally it is the `offset` arm with everything that implies.

### WorkIQ / Copilot

Microsoft's MCP surface for this is the least pinned down of the three from here. **Nothing was
contacted, no tool schema was read, and no claim is made about what it exposes.** Structurally it
declares the same way as Atlassian — an `http` endpoint, a grant, an allow-list — and the *reason*
this is a contract rather than a connector is exactly this case: the shape of the eventual adapter
is knowable, its behaviour is not, and only one of those can honestly be written down today.

## What was measured

On **2026-08-17**, on this machine, driving `gbrain serve` (gbrain **0.42.73.2**, stdio) with a
hand-written JSON-RPC `initialize` + `notifications/initialized` + `tools/list`:

1. **It advertised 106 tools.** That number is why the tool allow-list exists and why an empty
   allow-list is refused at the door rather than carried as a root that can never draw anything.
2. **Its `search` tool paginates by `limit`/`offset` and issues no cursor** (input schema:
   `{query, limit, offset, mode}`, `query` required). **Offset resumption is the ordinary case**,
   not the exotic one — which is why `McpResume` models four promises instead of one `nextPage`
   string.
3. **It reports no total and no "there is more".** A caller that asks for 20, receives 20, and
   concludes it has everything has invented a fact the server never stated. That is why
   `McpRemainder` has a third arm, `unknown`, and why `unknown` forces `completeness: "partial"`.
4. **It exposes a tool named `takes_scorecard`.** The pressure `subject.ts`'s charter predicts is
   not hypothetical: the *first* real MCP server available here already offers ratings.

Point 4 is worth being precise about, because it is a gap and not a win. `SCORE_SHAPED` refuses
score-shaped **keys** in the declaration and score-shaped **field labels** on an observation. It
does **not** refuse a tool *named* `takes_scorecard` from appearing on a tenant's allow-list —
tokenised name-matching would both over- and under-fire, and a heuristic dressed as a gate is
worse than a stated limit. What is guaranteed instead is structural: whatever such a tool returns
can only become a `candidate` artifact at `internal` release with no contributors, and its fields
never enter the document at all.

## Known limits — stated, not designed around

- **No connector exists.** Everything above the observation contract — transport, session,
  `tools/call`, turning a `CallToolResult` into `McpObservation`s — is unbuilt, and belongs in an
  app, not here. `root.ts` is pure domain: no fs, no network, no clock, no throw.
- **Free upstream text is not scrubbed.** `@foliage/photosynthesis` refuses a rating-shaped number
  in a *drafted* title. That rule is module-private there, and restating it here would be a second
  copy that drifts, so it is deliberately **not** restated. An upstream title reading
  `"Q3 review: 4/5"` is carried verbatim, as the observation it is. The control is that it cannot
  leave `candidate`/`internal` without a person reading it. If the owner wants that regex to apply
  at this seam too, the right fix is to **export it from `@foliage/photosynthesis`** and import it
  — one rule, two gates — not to copy it.
- **Third-party identity in free text is not detectable.** The contract has no author, assignee or
  participant field, which is the structural half. It cannot remove a colleague's name from a Jira
  summary, and no name-matching heuristic would. The reviewing human is the control, and this is a
  limit rather than a mitigation.
- **CI has never run.** As `README.md` records, there is no remote, so the boundary gate's
  negative case is proven locally by hand and not by a workflow run.
