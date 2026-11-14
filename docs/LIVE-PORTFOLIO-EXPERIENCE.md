# A live portfolio of demonstrated work

Owner direction, 2026-09-10: use [Mefolio's demo](https://mefolio.app/demo) as a baseline,
make Foliage substantially better, and make it live. This is a product direction and
delivery contract. It is not a measured superiority claim or a production launch receipt.

## The reference and the difference we must earn

The inspected demo opens with a person, professional focus, portrait, contact actions,
a flagship project, supporting projects, and experience. Images and readable summaries
make the work easy to approach. Its demo contains reputation/verification indicators and
outcome claims; browsing a demo does not establish how those claims are verified. The
case-study links use demo destinations. No account was created or contact message sent.

Foliage should give visitors that immediate clarity, then support deeper questions:
why the work existed, what the person figured out, which decisions were theirs, how AI
and collaborators contributed, what changed, and which evidence supports each statement.

The unit presented to a visitor is an achievement. A repository, commit, conversation,
design, test run or benchmark can support it; activity alone does not establish one.
No reputation score or ordering of proof tiers is introduced.

## Reader experience

1. **Meet the person.** Their chosen name, self-authored introduction, real portrait,
   interests and contact choices. Omit missing fields. Never infer employment,
   availability, skill level or identity verification from imported activity.
2. **Understand the work.** Lead with owner-curated achievements and a real image,
   recording, interactive demo or document when admitted. Each summary explains the
   problem, personal contribution and supported result. A visitor can understand the
   page without navigating a graph.
3. **Explore the Leaf.** Offer the same work as one organic 3D compound leaf. Source
   categories, actual dates and reviewed relationships explain its structure. The tip
   contains explicitly selected career highlights, never a computed person ranking.
4. **Open the story.** Show problem → judgment/decisions → experiments and failures →
   implementation → collaborators and AI assistance → results → evidence. Missing
   information stays missing; suggestions remain clearly separate from reviewed text.
5. **Ask Ladybug.** Answer about the authorized portfolio with citations to the exact
   publication revision. Offer useful suggested questions based on available evidence.
   A public conversation cannot retrieve private material or treat prompt text as a grant.
6. **See change over time.** Distinguish when work happened, when evidence was observed,
   when a person reviewed it, and when the public revision was published. Show additions,
   corrections and withdrawals rather than an unexplained pulse beside “Live.”

Reading, Leaf exploration and conversation are views of one portfolio, not separate
copies of truth. Use Foliage's day public/night private surfaces and shared tokens,
self-hosted typography, restrained motion and real media. Reference imagery is brand
artwork, not evidence of someone's achievement.

## What “live” means

Authorized local sources → Photosynthesis collection → evidence-backed private draft →
person's review → saved Leaflet → optional Ladybug cloud review → exact publication
review → acknowledged hosted revision → readers see the current permitted publication.

Collection can be automatic. Attribution, meaning and public disclosure keep their
existing authority. The private reader refreshes saved work and collection/hosting
observations without pretending local changes have been published. A paused collector
must say paused. A failed read must say unavailable. A dated hosting observation is not
proof that a page is still publicly available now.

Use existing scheduler, evidence references, pipeline, revision checks, hosted receipt,
withdrawal and storage contracts. This direction adds no second collector or publisher.

## First implementation slice

- Private `/leaf`: person-first reading view, actual body excerpts, existing private
  image delivery where present, visible attribution, adjacent 3D navigation, and
  expandable attribution/sharing accounting.
- Freshness: reuse `portfolioPipeline` and actual workflow/hosting observations. Refresh
  saved document changes without navigation and preserve stable reading/disclosure state.
- Published Canopy: lead each entry with already admitted narrative, keep its attribution
  visible and evidence inspectable, human-readable publication date, and place unavailable
  Ladybug assistance after the work.

These are presentation and local live-reading improvements. They do not establish the
case-study model, public media, public 3D, a functioning public agent or hosted delivery.

## Making the Leaf meaningful

The Leaf must help a reader answer a question they already have. Opening a leaflet should
explain the work; following a connection should reveal its reason and supporting evidence.
The reading view must remain sufficient on its own. Geometry, movement and activity volume
are not evidence of capability or impact.

The next implemented slice adds a private **Tell the story** form for pending, private
Leaflets: the problem, personal contribution (including collaborators and AI assistance),
decisions/discoveries, and what changed. A person chooses a retained reference for every
section they write. Their recorded account stays distinct from the source it cites; a
reference does not independently verify the account or authorship. Unknown sections stay
empty, and saving does not publish anything. Stale saves preserve the submitted words and
require reopening against current evidence.

These accounts lead the reading view and the selected 3D inspector, and survive Git evidence
refresh. Their receipt details remain inspectable. Public Canopy renders only paragraphs
already admitted through its existing publication review. At this stage the four sections
are portable conventions in the Leaflet body, not a queryable achievement schema.

Connections currently mean **shared source and reference**, with matching text visible on
both sides. They do not yet mean dependency, mentorship, shared capability or causal impact.
Career dates remain distinct from observation dates. Owner curation now records an ordered
set of highlighted Leaflet IDs in `Leaf.curation.featured`. Its first choice defines the
leading tip; later choices appear alongside it and lead the reading view in saved order.
No impact is computed from evidence volume, source type or attribution tier.

The product acceptance question is whether a reader can explain the person's problem,
contribution, judgment, assistance and result more clearly than from a conventional
portfolio, then inspect the evidence and changes over time. That requires real reader
evaluation; this implementation does not claim that superiority has been measured.

## Owner curation

The private **Choose highlights** flow lets a person choose up to the package's
`MAX_FEATURED_LEAFLETS`, rearrange their choices, or clear them. Opening the flow from a
Leaflet prepares a choice for review; the save button makes it persistent. The same-origin,
loopback-only write checks the complete form and current Leaf identity/document revision,
then changes only the curation field under the existing document lock.

A collector may refresh records but cannot select or erase highlights. Choices whose
records become missing or excluded remain in the saved list and are shown as unavailable
for review. They are omitted from presented work, and an unavailable first choice never
silently promotes another record into the leading tip.

Publication applies the saved order only to records admitted by the existing gates,
after narrative selections resolve against original document positions. Private choices
add no IDs, gaps, highlight counts or metadata to the published document. Saving local
curation does not republish an existing hosted revision. This is presentation curation
of existing Leaflets; a complete structured achievement model remains to be built.

## Next capabilities, in order

| Capability | Implementation contract | Acceptance evidence |
| --- | --- | --- |
| Achievement story | Explicit problem, contribution, decisions, experiments, AI/collaborator contribution and outcomes; each claim carries supporting references and review history | A person creates/corrects a real story; ungrounded or missing fields stay explicit |
| Achievement curation | Extend the implemented Leaflet highlights to structured achievements spanning multiple supporting artifacts | Owner choices stay stable as evidence is added; private support does not leak into published highlights |
| Public identity and media | Deliberately selected profile fields, images, video, audio and documents in the versioned publication contract; immutable bytes and current read authority | Real media appears after exact-content consent; withdrawal blocks every old media URL |
| Public 3D | Geometry, tooltip, edge and detail data derived solely from the admitted public revision | Private titles, counts, gaps, positions and relationships do not leak; mobile/no-WebGL reading remains usable |
| Public Ladybug | Retrieval scoped to the current authorized publication; cited answers, dated results, meaningful unavailable state | Real configured model answers against admitted evidence and refuses absent/private material |
| Hosted live revision | Durable device admission, publication receipt and authoritative reader update | New real work passes review and appears publicly; retry, offline recovery and withdrawal preserve the right revision |

This sequence is part of the existing complete-product plan, principally B03/B08/B09
with B01/B02/B04 for publication authority. It does not supersede those delivery gates.
