# Achievement-first portfolio

The private Leaf and published Canopy portfolio begin with the person's authored
introduction, followed by chosen achievements and the existing compound-leaf evidence
timeline. The shared presentation lives in `@foliage/ui/person-portfolio`; visual
tokens remain in `@foliage/tokens`. Missing personal content has an honest empty state.

## Authoring locally

- `/leaf/presentation` edits the short introduction, biography, direction and interests.
- `?edit=achievement` starts a title-first draft. Claims describe the problem,
  contribution, outcome, summary or AI contribution. The owner arranges achievements.
- `?edit=collection` creates a named view for a company, role or body of work.
  Membership references existing achievements and Leaflets; it does not duplicate evidence
  or create another person's identity. Saving selected achievements captures their current
  cited Leaflet membership. Future evidence is not silently added.
- `/leaf/achievement?id=…` shows the account and support for individual statements.
- `/leaf/resume.md` produces a private Markdown citation draft. Its local links must be
  replaced with reviewed public claim links before sharing outside the local application.

Native forms work without client scripting. Writes require same-origin submission and
the current source document digest under a file lock. Authored fields survive evidence
refresh and promotion. Editing the account changes neither evidence attribution nor sharing.

## What a citation means

A citation binds a Leaflet ID to an exact source, reference and observation timestamp.
The reader distinguishes current, stale, missing and excluded support. Current means
the reference is retained on that attributable record; it does not establish that the
statement is true or independently verify an outcome. Claim anchors use stable IDs and
remain distinct even when hyphenated ID pairs would otherwise collide.

## Publication

The native Canopy manager and local hosted preparation offer a separate authored-context
selection. The publish CLI accepts `--include-portfolio`. Without that choice, authored
context is absent. Native publication review binds the choice and admitted content to a
digest, in addition to the existing source, policy and destination checks.

Every citation of a public claim must still match retained evidence on an admitted public
Leaflet. One stale, missing, excluded, private, unlisted or denied reference withholds the
whole claim. An achievement with no admitted claims is omitted. A collection with no admitted
members also withholds its name and description. Omission details remain private.

Publication format 5 carries this optional context; readers retain compatibility with
formats 1–4. Public claim links lead to exact statement anchors and selected evidence
receipts. Readers validate receipt structure and admitted targets, and cannot independently
repeat a publisher's check against private source data. Replacing or withdrawing a
publication can change link availability.

## Progressive reading and limits

Named views filter achievements and the same continuous plant. Sorting, native text and
evidence disclosures remain usable without WebGL. The private server honors collection
selection without JavaScript; public documents retain all shared work when scripting is
unavailable. Public timeline dates remain explicitly labeled observation dates.

This work supplies authoring and evidence-linked presentation. It does not invent the
person's biography, populate achievements from commit volume, independently prove impact,
or turn a local résumé draft into a publicly hosted certificate. The native publication
flows carry the new selection; parity in separate React workspace controls needs its own
integration. Live cloud deployment and a populated public visual review remain separate
acceptance steps.
