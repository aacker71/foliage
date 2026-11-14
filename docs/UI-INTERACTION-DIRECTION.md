# Foliage UI and leaflet interaction direction

Draft for discussion · 2026-09-05. This is a proposed interaction design, not an approved replacement for the product architecture or an implementation claim. `@foliage/tokens` remains the design system source of truth.

*Navigation superseded 2026-10-08: the shipped personal navigation is Home (`/`, formerly Overview), Work, Review, Portfolio (`/leaf`, formerly My Leaf) and Sources (`/workflow#sources`), with Scarlet, Policy, Publish, the Harvest log (`/garden`) and the other personal tools under More; see [UI context](../context/ui-context.md). The navigation observed and proposed below is as of 2026-09-05.*

## The experience to design

A person should be able to understand what work Foliage has found, decide what accurately represents them, and give another person a readable, evidence-bearing portfolio. A reader should be able to understand a particular contribution and inspect what supports it.

Start the detailed design with the individual flow: sources → candidate review → My Leaf → leaflet → sharing preview → reader. This is a working scope assumption pending owner feedback, not a decision to drop the other applications.

The central design object is the leaflet. Give it three connected representations: a place in the botanical Leaf, a readable preview, and an independently addressable document. Each representation must resolve to the same artifact and attribution facts.

## What the current application establishes

Source inspection: `apps/leaf/src/render.ts`, `frond.ts`, `overview.ts`, `garden.ts`, `publishPreview.ts`, `scarletPage.ts`, and `packages/leaf/src/leaf.ts`. Browser inspection used this checkout's own leaf server, an OS-assigned port, and the existing local leaf and harvest documents. No review or publication writes were performed.

- The primary navigation contains Overview, My Leaf, Review, Harvest, Policy, Publish, and Scarlet. These are seven peers even though they represent different frequencies and stages of use.
- On the inspected My Leaf page, the local document held 235 leaflets, all pending attribution. The first screen emphasized attribution and counts before any work preview. This describes this document at inspection time, not a product invariant.
- The frond uses one ellipse per actual leaflet. At a browser viewport width of 1260 CSS pixels, its viewBox was `0 0 200 1106` inside a 132 × 190 CSS-pixel box. It appeared as a thin vertical mark. Its ellipses have no individual links.
- List rows show title, attribution, source/ref, observed date, and an Open link. They do not preview body content or media.
- The inspected owner leaflet displayed a title, attribution explanation, an honest absent-body state, provenance, and publication details. It had neither primary navigation nor a link back to My Leaf.
- Review supports a reviewer, reason, an optional title correction, and approve/reject. Promotion is a separate action. The current leaflet Publish page is a policy preview, not a publication button.

These observations support changing hierarchy and wayfinding. They do not establish that every candidate or leaflet has enough content to become a rich case study.

## Page contracts

The following are proposed page responsibilities and interactions. Existing routes are anchors; new capabilities are explicitly identified.

| Page / surface | The user's question | What leads the page | Main interaction and why | State and implementation implications |
|---|---|---|---|---|
| Overview `/` | What needs my attention? | The next useful step, grounded in actual source and review state | Continue setup, resume review, or open My Leaf; each goes directly to the relevant task | Distinguish no source, unreadable source, processing, no candidates, and ready-to-review. Do not replace failures with zero counts. |
| Sources / Harvest, currently `/garden` | What material is available, and what happened to it? | Actual connected sources, observation time, and intake outcome | Inspect a source and follow its candidates into Review | Source setup and retry controls are new UI work; the current route is a read-only harvest overview. Historical observation time is not the date the work happened. |
| Review `/review` | Is this a fair account of my contribution? | One selected candidate with its supporting evidence beside it | Read, correct supported wording, approve, or reject; return to the remaining queue | Preserve corrections on validation failure and detect stale evidence. Approval must not imply verified attribution or publication. Body editing is new work; existing title correction remains useful. |
| My Leaf `/leaf` | What does my body of work contain? | Readable leaflet previews attached to the botanical structure | Open a leaflet; filter by explicit source/date/attribution where those facts exist | Search/filter controls are proposed. Retain honest access to excluded work and its reasons. A filtered-empty view offers Clear filters. |
| Owner leaflet `/my/leaflet/<id>` | What does this artifact say, and what supports it? | Actual content, followed by evidence associated with each element | Inspect evidence, return to the same place in My Leaf, and inspect sharing status | Preserve owner navigation and list position. Title-only, ref-only, media, mixed, and unreadable-element states all need deliberate layouts. |
| Sharing preview, currently `/publish` | Exactly what would someone else receive? | The permitted outward content and clear reasons for withheld content | Inspect the reader preview, then enter the separate explicit publication flow | Current page only evaluates policy. New sharing controls must use the appropriate owner-authorized flow; changing a label does not create publication capability. |
| Policy `/policy` | Why is this item withheld, and what rule applies? | The rule relevant to the leaflet the person came from | Inspect a concrete example and return to that leaflet or preview | Keep the full rule inventory available. An allow rule proposes; it never publishes. Policy denial and personal visibility remain distinct. |
| Scarlet `/scarlet` | What can I learn from this material? | A question with its declared source scope and model availability | Ask, inspect the answer's grounding, and open the referenced artifact | Contextual entry from a leaflet is proposed; retain an explicit standalone route. Model output does not change evidence, attribution, or sharing. |
| Published Leaf | What has this person contributed? | The person's own headline, if present, and permitted work previews | Explore work and open a leaflet | Day face, no owner controls, and no private titles, counts, map nodes, or source paths. Only the authorized public projection supplies content. |
| Published leaflet | What happened, and why should I believe this account? | A readable artifact with local evidence disclosures | Inspect support and return to the published Leaf when that relationship is itself public | Unlisted sharing must not reveal sibling leaflets. Withheld and nonexistent addresses remain indistinguishable. |

Proposed primary navigation: **Overview · My Leaf · Review · Sources**. Put **Sharing** within reach of My Leaf and the owner leaflet; keep **Policy** accessible from Sharing and settings. Offer **Scarlet** as contextual help with a persistent route. The aim is to let navigation follow the person's tasks while preserving all existing destinations and deep links. Final labels remain a design decision.

## How a leaflet should look and behave

### In the Leaf: a botanical collection you can read

Keep a visible rachis with leaflet-shaped attachments. Give each attachment a readable bordered preview and a direct artifact link. Make the botanical shape part of the layout, so it remains present when someone is reading the work.

Use a vertical composition that grows by sections or pages. Never squeeze the entire portfolio into a fixed-height drawing. A compact overview may navigate to the same visible sections, but it must identify the displayed range and preserve a complete list alternative. A filter changes both representations together.

Each leaflet preview contains, in reading order:

1. The actual title, with a usable link target.
2. A short excerpt of existing evidence-bearing body text, or actual media when available.
3. Source kind and a correctly labelled date when recorded.
4. A compact attribution label; in the owner view, a separate sharing label when useful.

Do not generate an achievement summary to fill a sparse preview. A title-only artifact remains a concise title-and-source row. A missing photograph gets a stated unavailable state, not a decorative substitute. Preview length reflects available content, not an assigned importance.

All botanical markers have equal visual weight. Position, size, color intensity, and motion must not encode personal quality or a proof ranking. Use existing document order initially. Any future grouping needs an explicit field or owner decision; do not invent projects, skills, or team membership from titles. A personal collection is not a taxonomy Branch.

### On selection: enough context to choose whether to read

The first implementation should make the full leaflet page excellent and link to it using native navigation. In a later enhanced explorer, selecting a botanical marker can reveal the same preview beside the collection. The preview needs an Open leaflet action and a normal link fallback.

Keyboard focus and touch must reveal the same information as pointer hover. A hover tooltip alone is insufficient. At narrow widths use a readable single column and normal detail navigation. Keep the user's filters and return position. Do not require dragging, zooming, or finding tiny shapes to access work.

### On the leaflet page: content and its evidence

Proposed reading order:

```text
My Leaf / Leaflet                         [owner navigation]

Actual leaflet title
Author / available date
Attribution fact                         Visibility [owner only]

Existing text or media
  Evidence for this element [expand]

Further existing text or media
  Evidence for this element [expand]

Sources and provenance
Sharing status / rule explanation        [owner only]
Back to My Leaf
```

Use the real content as the headline experience. Expandable evidence reveals source, ref, observation time, and the supported relationship; do not label a raw identifier as a source link unless a working authorized resolver exists. Keep evidence adjacent to the element it supports. Excluded attribution retains its visible reason.

For title-only artifacts, replace the large empty Body section with one concise statement that no narrative or media is attached, followed by the available source record. In the owner view, a future Add supported context action should open a correction workflow preserving provenance. Do not show a dead button before that workflow exists.

## Three separate kinds of state

| Axis | Meaning | UI treatment |
|---|---|---|
| Review lifecycle | Candidate, approved, rejected; whether approved material has entered the Leaf | Queue controls and a truthful result receipt. Approval is acceptance of a draft, not a proof upgrade. |
| Attribution | Verified, pending, excluded | Fact label and explanation, without a ladder, progress bar, or score. Pending attribution does not promise a background task is running. |
| Disclosure | Private, unlisted, public; additionally allowed or withheld by policy | Audience and effective availability, with the cause of any restriction. Public intent alone is not proof that something is hosted. |

Keep these axes separate in the design and the data. For example, approved work can still have pending attribution and remain private. The public renderer decides what it may actually expose through the existing projection and policy contracts.

## Other audiences in the same system

| Audience | Primary job | Design consequence |
|---|---|---|
| Individual in an enterprise | Understand their own work under company policy and retain a portable exit | Show personal versus company-governed visibility, correction routes, and export eligibility. Keep this in the enterprise plane. |
| Organization administrator | Understand company structure and govern release | Tree → Bough → Branch → Leaf navigation must follow declared membership. Review and release authority are explicit. No employee ranking. |
| Portfolio host / owner manager | Publish, replace, withdraw, and recover | Show exact payload, destination, durable receipt, and effective publication status. Reader navigation stays separate from management. |
| Recruiter / invited reader | Read the subject-shared work and inspect evidence | Optimize Leaf → leaflet → supporting evidence. Search/discovery remains a separate gated product decision. |

## Visual and interaction constraints

Use the existing token package for typography, surfaces, spacing, motion, and marks; do not duplicate token values in this document. Night belongs to private work and day to published reading. No theme toggle. Use the correct mark export and self-hosted fonts.

Reserve chartreuse for at most two meaningful emphasis points per screen. Attribution labels throughout a long list should not become a field of accent-colored badges. Use bordered cells, restrained radii, and no shadows. Metrics use mono tabular numerals. Motion follows the package's grow/fold roles, respects reduced motion, and never spins or bounces.

Preserve normal links, forms, browser history, focus visibility, and readable zoom. Interactive enhancement is a separate implementation decision for existing no-script routes and must preserve their CSP and disclosure contracts.

## First concrete design slice

Prototype **My Leaf → owner leaflet → return**, using the existing local material. Show the botanical collection, readable previews, a content-led detail page, and retained navigation. Exercise the real large collection as well as honest empty, title-only, and unavailable-media states; do not invent portfolio contents.

Then design Review against that same leaflet representation, followed by sharing preview and the day-face reader using only authorized outward content. This order tests whether the artifact is understandable before multiplying layouts across every page.

Acceptance questions: Can the owner locate a specific artifact without reading every row? Can a reader explain what the leaflet says and which evidence supports it? Can either distinguish attribution from visibility? Does returning preserve context? Does a long Leaf remain readable and operable on keyboard and narrow screens?

This brief has source and desktop browser evidence. It does not claim implemented changes, mobile QA, contrast measurements, or owner acceptance of the proposed navigation.
