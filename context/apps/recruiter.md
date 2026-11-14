# Recruiter, hiring-manager and client reader experience

## Status

Reader and distribution surfaces belong to Canopy. No standalone recruiter application package.
Existing public reading is reused; discovery, recipient views and destination adapters require
implementation acceptance. The owner requested ecosystem distribution on 2026-09-23.

## Responsibility

Help recruiters, hiring managers, prospective teammates and clients discover deliberately
shared work, understand the person's contribution, inspect exact supporting evidence and
request a conversation. Own reader navigation and opportunity requirements, not a second
public evidence projection, candidate score or ATS database.

## Runtime and interfaces

Dedicated browser entry `/recruiting` leads to `/recruiting/portfolios/:id` and
`/recruiting/deliveries/:id`. These have recruiting navigation and a Clerk return path.
The personal `/manage/:id/share` page contains only portfolio/résumé links. No candidate
search, ATS account controls or delivery history belongs in that personal flow. Legacy
distribution browser links redirect after access checks; existing device endpoints retain
their contracts. Route separation creates no new access grant or application package.

Reuse Canopy public routes and `packages/canopy` projection. Four paths have one contract:
public discovery, direct links/cited resume or proposal, authorized customer ATS/CRM delivery,
and contracted platform feeds. Proposed HTTP and scoped read-only agent interfaces live in
[portfolio distribution](../contracts/portfolio-distribution.md). Do not expose local authoring
MCP tools to recruiters or assume that a vendor's customer MCP accepts supplier records.

## Storage and access

Read only admitted material under current authority. Initial distribution selects public
admitted material; recipient-specific private admission is a separate extension. Reuse hosted
grants, publication digests/generations, operation receipts and outbox. Source connection,
publication, directory listing, destination delivery, subscriptions and outreach are separate
permissions. Customer ATS/CRM writes require the customer's tenant authorization.

No private archive, local assistant history or employer-only evidence enters a reader view.
A supplied claim link is not an outcome certificate. Application snapshots stay pinned;
a live portfolio link can point to current work without rewriting the historical application.

## Data flow and acceptance

Consented listing/share/delivery → current permitted view → achievement → claim/evidence →
verified inquiry or permitted subscription. Views select canonical achievement IDs; changing
factual claims returns to the existing authoring/review flow. Public reading requires no
account or WebGL. Clients can read case studies and services through the same mechanism.

[Unit 20](../specs/20-public-discovery.md) owns listing/search; [35](../specs/35-distribution-core.md)
owns view/export/inquiry/grant flows; [36](../specs/36-destination-adapters.md) owns customer
systems; [37](../specs/37-partner-feeds.md) owns contracted supply. Acceptance distinguishes
prepared, provider-accepted, confirmed-current, indexed and actual inquiry. Unknown outcomes,
external-copy limits and pending removals stay visible. No ranking, proof-tier ordering,
inferred capability score, unapproved introductions or automatic job applications.

## Ownership

[Canonical architecture](../architecture.md) identifies application and implementation status.
The distribution contract owns shared details and provider qualification evidence. Do not
create an application manifest or broaden licensing boundaries for this planned surface.
