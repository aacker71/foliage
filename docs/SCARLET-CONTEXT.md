# Scarlet contextual workspace

*Names since changed (navigation of 2026-10-08): this workspace is the one labelled
**Photosynthesis** under More, and Portfolio (`/leaf`, formerly My Leaf) links to it by that
name once saved achievements exist. **Scarlet** under More opens `/leaf/scarlet`.*

Scarlet opens at `/scarlet/workspace`. My Leaf links to the workspace, and each private
leaflet links to a conversation scoped to that record. The left pane shows the recorded
content being supplied; the right pane supports questions and follow-ups. On narrow screens
the conversation comes first, with the selected title visible above the question.

Review draft titles open their own Scarlet context. Leaflets offer an Improve wording task;
Publish rows offer Prepare to publish, including the real policy outcome and a return link.
Draft review state never becomes a proof tier. An unbound harvest is labelled as unbound;
a harvest naming another Leaf or subject is refused. Changing a draft or effective policy
invalidates its prior workspace before the next model call.

Search matches every query word against recorded titles, text, and references throughout
the loaded Leaf. Results retain document order. Opening one result narrows the conversation
to that leaflet. Changing the selection starts a fresh conversation. Nothing is saved.

## Interaction and tool contract

The browser posts the existing AG-UI run envelope to `/scarlet/run`, with this extension:

```ts
forwardedProps: {
  foliage: {
    documentDigest, // sha256:<64 lowercase hex characters>, from the rendered workspace
    tool: { name: "read_leaflet", id },
    // or: { name: "search_leaflets", query }
    // or: { name: "read_candidate", id } with purpose: "review" and harvestDigest
    purpose: "understand", // also "describe", "review", "publish"
    includeSource: false
    // publish requires policyDigest; both resource digests come from the server-rendered page
  }
}
```

These are user-selected, deterministic read tools executed by the server before the model
run. They are not model-selected function calls. Arbitrary client tool definitions remain
ignored. Record tools do not accept paths or URLs or write portfolio state. A changed
document digest or unavailable selection stops the run before the model is contacted.

The `foliage.grounding` custom event contains the actual tool result, including citation
labels, recorded body text and provenance, matched count, omitted count, and excerpt notes.
The prompt and displayed context derive from the same operation. Limits are 12 records and
24,000 serialized characters of records, with up to eight body elements per record and
1,200 characters per text field. Oversized references are omitted explicitly.

The optional source checkbox reads commit metadata and patch excerpts for up to two recorded
git references from `FOLIAGE_SOURCE_REPO`. The operator configures this repository; the browser
cannot choose it. Full commit identifiers are required. Git runs without a shell, external
diff, text conversion, signature verification, replacement objects, or lazy remote fetches.
Each read has a five-second timeout and a 256 KiB output ceiling. Supplied excerpts stop at
12,000 characters and disclose truncation. Missing repositories, invalid references, failed
reads and omitted references are visible. Image bytes are not read. Source reads identify
their parent citation labels; they do not establish authorship.

AG-UI text events stream into the conversation. Run and message identities, event order,
and terminal completion are checked independently in the browser. Stop cancels the request;
failed or interrupted text is marked incomplete and excluded from follow-up history. The
question remains available for retry. Accepted history is held only in page memory, capped
at eight messages and 80,000 serialized characters.

Before completion, `foliage.answer-review` reports deterministic checks for missing or unknown
citation labels, ISO dates absent from supplied context, some missing-date/body statements
that conflict with recorded fields, and rating language. Flagged answers are labelled Needs
review and excluded from follow-up context. Rating-shaped responses are withheld. These are
narrow checks: a correctly labelled but unsupported claim can pass. The UI explicitly says
that passing checks does not establish factual accuracy. Recorded facts remain independently
visible, including observation timestamps distinguished from when the work happened.

Copy puts the displayed model wording on the clipboard after an explicit click.
Applying wording and making review or publishing decisions happen in the existing user flows.

Known citation markers link to private leaflet pages. Every completed answer also has a
“Records” disclosure, because a model may omit citation markers.
Those links show what was supplied; they do not establish that the model's claims are correct.
Unknown citation labels are identified as references that were not supplied.

## Runtime and boundaries

The local `/scarlet/setup` page can find installed Ollama models after the owner presses
Find, then save one for the selected garden in a private `scarlet-model.json`. The existing
`FOLIAGE_LOCAL_MODEL` configuration takes precedence when supplied by the running session.
Opening the page or starting Foliage does not probe Ollama or download a model. Installing
Ollama and at least one model remains a separate action in Ollama; the page links its
quickstart when the runtime or model list is unavailable.
No model configured, no matching work, unavailable content, interrupted streams, and runtime
failures have explicit states. The original script-free `/scarlet` form remains available.
Only the private workspace permits same-origin script and connect requests; published
documents keep their existing content security policy. Assets and fonts are local.

Scarlet can help interpret evidence and draft descriptions. Attribution review and sharing
remain existing user actions. References alone supply metadata; only the optional source
reads supply actual commit and patch text.

## Validation

`scarletContext.test.ts` covers retrieval beyond the old title ceiling using actual tracked
repository files (including shallow checkouts), selected text and references, scope parsing,
stale evidence/drafts/policies, empty states, fragmented streams, and the real HTTP/CSP boundary.
`scarletReliability.test.ts` exercises literal answer checks, real git source reads and their
limits, draft/leaflet ID collisions, unbound or foreign harvests, policy outcomes, and the
answer-review event before run completion. Existing
Scarlet seam tests cover model streaming, runtime failures, disconnects, and origin gates.

Live browser testing used the owner's real Leaf and harvest. `llama3.2:3b` invented labels
while discussing a real draft and publication state; the answer checks flagged them and the
browser excluded those answers from follow-up context. A separate local `gemma4:12b` run
correctly reproduced the selected record's observation date and missing body, using [L1],
on two questions. This is bounded evidence, not a general model-quality guarantee.
