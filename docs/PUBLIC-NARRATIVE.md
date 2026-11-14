# Public narrative

The local `/hosted` review lets a person select individual text paragraphs from offered
Leaflets. Every checkbox begins unchecked, including on replacement. Preparing sends only
those selected paragraphs and their original references with the gated public projection.
The exact shared reader preview and typed publication decision still precede publication.
A replacement replaces the whole artifact; omit a paragraph to remove it from the next revision.

The source digest binds checkbox positions to the reviewed private file. Reordering or editing
that file invalidates preparation before any request. Selection cannot admit an excluded,
unoffered or policy-denied Leaflet. Media elements and their captions are not selectable.
All existing publication callers that omit the selection continue sharing no body text.

Version 4 adds an optional `narrative` array on a published Leaflet. Each paragraph has exactly
`text` and `provenance`; provenance has exactly `source`, `ref` and `observedAt`. There may be
1–64 paragraphs, each at most 4,000 characters. References are non-empty, bounded and dated.
The write and read gates reject detected identifying text and recognizable local file locations;
they never silently rewrite selected narrative. These pattern checks cannot detect every
confidential detail or establish rights to share it. The person reviews the wording and reference.
Raw private bodies, file locations, images, executable markup and arbitrary metadata gain no fields.
Markup in prose is rendered as escaped text, never HTML or a remote embed.

Versions 1, both historical version 2 dialects and version 3 retain their closed shapes and
round-trip unchanged. Adding narrative to one of those formats is refused. New writes use version
4; hosted admission continues accepting version 3 clients and accepts version 4 through the same
account, canonical-digest, source-verification, consent, durable storage and withdrawal controls.
The artifact digest covers every selected paragraph and reference. Publication comparison reports
narrative addition, removal, reordering, wording and reference changes as reader-visible changes.

The public reader presents “In their words” context with a reference for each paragraph. A
reference does not add authorship verification; the existing Leaflet tier remains distinct.
No model generates filler at publication time, and missing narrative is left absent. Private
Photosynthesis collection and scheduling do not select paragraphs or authorize publication.

This increment does not host photos, add rich embeds, or complete connected customer acceptance.
Hosted media needs explicit selection, metadata treatment, content-addressed storage, delivery and
withdrawal behavior before it can cross. Application Supabase selection and real provider/customer
acceptance remain separate launch gates. Foliage styling continues to come from `@foliage/tokens`.


Selected-photo successor: v4 remains unchanged. The explicitly selected v6 image contract and
its local preview, hosted authority, transfer bounds and static-export refusal are described in
[PUBLIC-PHOTOS-IMPLEMENTATION.md](PUBLIC-PHOTOS-IMPLEMENTATION.md). Narrative-only writes
now use the named-portfolio v5 artifact; historical statements above describe the bounded v4 narrative increment.
