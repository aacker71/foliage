# Private evidence transfer review

Local UI acceptance, 2026-09-08. The existing `/workflow/export?packet=…` route now
puts readable evidence and transfer contents before the raw JSON. The version-one
packet, revision check and download endpoint are unchanged.

The reader sees the saved draft title, retained commit subjects and full references,
collection/save times and omitted count. The first three references are visible;
a native disclosure reveals the remainder. Separate sections explain the file's
contents, omitted source material, local download and subsequent manual import.
The page names the absence of execution receipts, architectural decisions, AI
contribution and outcome measurements. It does not verify an achievement or create
publication authority. Unavailable packets have an error and no download control.

## Initial branch checks

- `pnpm check`: passed, including 1,933 tests. Final presentation follow-ups passed
  the existing workflow context/HTTP handoff tests and Leaf application typecheck.
- Website build and lint passed. No website implementation changed.
- BrowserOS used one owned tab and an isolated workflow directory populated by
  actual repository collection at `34f71b4`. The collection retained 25 references
  and reported 396 omitted matching commits. No portfolio demonstration data was added.
- Desktop viewport was 1260px. True mobile emulation reported `innerWidth = 390`,
  a matching narrow-screen media query and document scroll width of 390px.
- The raw-packet disclosure opened by click and closed by Enter with focus on its
  summary. Its focus outline was visible. Desktop and mobile captures were inspected.
- The browser downloaded the private packet; `parseWorkflowTransfer` accepted its
  digest and contents. Existing HTTP tests cover stale-revision refusal.
- A missing packet rendered an alert without an export action.
- Observed page resources used the local server origin. Metrics used the shared
  mono font. Body text measured 16.36:1 against the night background; this is not
  an assertion about every element or state.

## Limits

This is a local review and download screen. It does not add cloud transmission,
receipt admission, per-commit editing, retention enforcement or source redaction.
Titles and commit subjects may still contain sensitive text. Exact packet inspection
is available before download, and the UI explicitly directs users to keep such
packets local when appropriate. Runtime receipts can enter a separate review path;
they are not part of this workflow packet format.

## Current integration base and independent review

The three-file increment was applied to `5ce6556` as `74657f6` on
`codex/evidence-transfer-current`. No conflicts occurred. The newer review-form
grid and other base changes were preserved rather than replacing the stylesheet.

Three separate tool-less Claude Sonnet review sessions inspected the bounded diff
and supplied current-base context. The requested `sonnet` model resolved to
`claude-sonnet-5` for the review responses. These are independent static reviews,
not independent browser runs or reproduced test results.

| Lens | Initial verdict | Final follow-up |
| --- | --- | --- |
| Correctness and disclosure boundaries | Approve | Approve |
| Integration seams | Request changes: redundant local width rule | Approve |
| UX, accessibility and scope | Approve; singular-count wording noted | Approve |

The local width/margin rule was removed: `.leaf-main` already owns the reading
measure. The duplicate focus rule was removed because the existing global rule
already covers `summary`. Singular counts now use the correct noun and verb.
Reviewers left only optional observations or unverified areas: identifier styling,
additional presentation tests, accepted timestamp formats and border rhythm.
The existing token styles contain no definition-list component to reuse here.

Current-base verification by the implementing agent:

- `pnpm check` passed all 1,966 tests; website build and lint passed.
- After the review edits, Leaf typecheck and eight existing workflow/face-CSS
  tests passed. The full suite preceded these small CSS and wording follow-ups.
- The real current-base packet retained 25 commit references and reported 407
  omitted matching commits. Browser download passed `parseWorkflowTransfer`.
- Desktop inspection confirmed the shared main measure of 736px and no separate
  maximum on the review wrapper. A true 390px viewport reported scroll width 390px.
- Enter operated the native disclosure with focus remaining on its summary. The
  shared focus rule rendered a visible 2px outline. Missing packets showed an
  alert and no download action. Observed resources used the local origin.

Review outputs, prompts and a verbatim consolidated report are retained locally in
`/private/tmp/foliage-transfer-sonnet-review/`. Check logs use the prefix
`/private/tmp/foliage-transfer-current-`. No cloud service was contacted by the
application during browser verification; the independent Claude reviews separately
sent the bounded code diff and context to the requested review model.
