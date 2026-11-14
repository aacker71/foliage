> Scope and implementation status: [canonical architecture](../context/architecture.md).
> This document retains its dated decisions or detailed feature contract; it is not a second application inventory.

# The leaflet capture spec

**What this is.** The interface contract between **Photosynthesis** (producer of leaflet candidates) and the **leaf format** (which stores, renders and publishes them), so both can be built in parallel without diverging. It supplies the types `docs/ENGINEERING-PLAN.md` §2 leaves undefined (:70-99): a body is a list of grounded elements, so `must-ground` holds element-wise (:90) and there is nowhere for unsourced prose to live (:92).

Every current-state claim was read in `<repo>` on 2026-08-18 and cites `file:line`. Nothing was modified. NOT BUILT means the code does not exist.

**Sibling: `docs/SYSTEM-ARCHITECTURE.md`**, which owns the levels *above* the leaflet (leaf, branch, bough, tree, canopy). It was written in parallel with this file by a second agent, and the two were **cross-checked against the tree afterwards** — every disagreement was resolved in favour of the side with a measurement behind it, and the resolutions are recorded in place here (§2.3, §5.4, §6, §9.2) and there (its header). Where this spec and that one still differ, this one owns capture — the element type, the gate, the ref grammar, the producer contract — and that one owns everything above the leaflet. Neither may re-decide the other's half silently; a change to a shared fact edits both files in the same commit.

**Scope: ONE element kind, end to end.** An adversarial review of the first draft returned NOT READY and the largest single cause was size — a spec implemented partially *is* divergence. This version is cut to the thinnest slice that proves the §2 claim. The cuts are deliberate and listed in §8. Do not add a kind, a field, or a cap that is not in §1; a second kind later is an added union arm, not a rewrite.

---

## 1. The type — `packages/leaf/src/leaf.ts` (open plane). NOT BUILT.

```ts
export type ElementId = string & { readonly __brand: "ElementId" };
export const elementId = (s: string): ElementId => s as ElementId;

/** One piece of evidence an element points at. Ref grammar: §3. */
export interface EvidenceRef {
  readonly ref: string;        // "<scheme>:<value>", closed scheme set (§3)
  readonly observedAt: string; // ISO instant we READ it — isIsoInstant (document.ts:114)
}

/** Non-empty BY TYPE. This is what makes "every element is grounded" structural. */
export type EvidenceRefs = readonly [EvidenceRef, ...EvidenceRef[]];

/**
 * `text` is MACHINE PROSE about the subject's work. It is never carried text, so it is never
 * marked `data-verbatim` and therefore never leaves the no-score check (§6).
 */
export interface LeafletElement {
  readonly id: ElementId;
  readonly kind: "did";
  readonly text: string;
  readonly evidence: EvidenceRefs;
}

export type LeafletBody = readonly [LeafletElement, ...LeafletElement[]];
```

`body?: LeafletBody` is added to **all three arms** of `Leaflet` (leaf.ts:60-85), optional in every one. No comparator, no count helper, no export that aggregates elements: the refusal at leaf.ts:30-48 extends down a level.

**Honest limit, stated rather than smoothed.** The format guarantees every element POINTS AT evidence. It does not and cannot guarantee the text is entailed by that evidence — `text` is prose with a ref stapled on, which is the echo-laundering shape ENGINEERING-PLAN.md:268-277 names. The human review at the harvest airlock is what manages that risk. Claim exactly this much.

**`body` is OPTIONAL; `body: []` is REFUSED.** Optional because a git leaflet honestly is a title and a ref, and because every document on disk today has no body (including `apps/leaf/example/leaf.example.json`) — requiring one would reject every leaf in existence. `[]` is refused with a message telling the author to omit the key: two spellings of one state is the bug the `exactOptionalPropertyTypes` discipline at document.ts:293-298 already avoids. This is the opposite call from `leaflets: []`, which is valid and means an honest empty portfolio (document.ts:375-377) — there, empty and absent are genuinely different facts.

**No version field.** `DOCUMENT_KEYS` stays `id, subject, leaflets, example` (document.ts:67). The closed key set already detects an unknown format, more loudly: an old parser reading a new document reports `unknown field "body"…` (document.ts:157-161) and refuses the whole document (:397). Honest cost: an older `foliage-leaf` install cannot render a new document at all. Refusing beats partially rendering someone's portfolio.

---

## 2. The gate — `packages/leaf/src/document.ts` (open plane). NOT BUILT.

Types do not survive JSON, so this is where the format is actually enforced. Exact rules:

1. `LEAFLET_KEYS` (:68-74) gains `"body"`.
2. New, **exported**: `ELEMENT_KEYS = {id, kind, text, evidence}` and `EVIDENCE_KEYS = {ref, observedAt}`.
3. **Export `SCORE_SHAPED` (:82-100).** It is `const SCORE_SHAPED` — module-private, verified this run — while ENGINEERING-PLAN.md:132 asserts it "is exported from `@foliage/leaf` and imported by every other gate: one list, three gates, no drift" and MCP-ROOTS.md:109 asserts "one list, now four gates". **Both sentences are false today, and exporting it only makes them partly true, so state the scope rather than repeat the overclaim:** the importers are photosynthesis (`harvestDocument.ts:124`, whose copy §5 item 6 deletes) and the enterprise MCP root MCP-ROOTS.md:109 describes. The **canopy does not and must not import it** — `publishedDocument.ts:94-98` states that its list is deliberately its own, because the leaf format is open and forkable and a fork that relaxed its list must not thereby relax what the hosted canopy will serve, with the superset pinned by test. So the honest form is *one list, two importing gates, and one egress gate that deliberately keeps its own superset* — not "every other gate".
4. **Move `SCORE_PROSE` + `scoreShapedProse` here** from `apps/photosynthesis/src/harvestDocument.ts` (:165-177) and re-export from `@foliage/leaf`; photosynthesis imports them and deletes its copy. Reason this is step zero: the prose check is applied at exactly one place today (harvestDocument.ts:229-241, over `drafted.title` and `drafted.summary`), so a body would bypass it entirely — score-shaped prose would reach a public page through `text`.
5. New, **exported**: `CARDINALITY_PROSE = [/\b\d+\s+(commits?|files?|repos(itor(y|ies))?|prs?|pull\s+requests?|contributions?)\b/i]` with `cardinalityProse(text): readonly string[]`. A per-person count presented as a claim is a rating one rename away; the SET is rendered as the element's evidence refs, never as a number.
6. New, **exported** `parseLeafletElement(v, at, issues): LeafletElement | null`, called from `parseLeaflet` (:221-319). It refuses each of the following with its own message and an `at` path a human can find (`leaflets[2].body[0].text`):
   - not an object; unknown key; score-shaped key — via `checkKeys(v, ELEMENT_KEYS, …)` (:138-164), already case-folded at :147;
   - `id` absent/empty, or duplicated **within this leaflet's body** — that is the uniqueness scope;
   - `kind !== "did"`;
   - `text` absent/empty; `text` matching `scoreShapedProse` (message: reads as a rating); `text` matching `cardinalityProse` (message: a count of the subject's own work is a rating in disguise — cite the items instead);
   - `evidence` not an array, or empty — an element that traces to nothing is refused, not decorated;
   - per ref: unknown key (`EVIDENCE_KEYS`), `ref` not matching `ELEMENT_REF` (§3), `observedAt` failing `isIsoInstant` (:114-116).
7. `body` present and not an array → refused; `body: []` → refused (§1). All-or-nothing document behaviour is unchanged (:397).
8. **No caps.** No `MAX_BODY_ELEMENTS`, no `MAX_ELEMENT_REFS`. A cap inside an all-or-nothing gate rejects a person's whole portfolio over one long leaflet, and no measurement exists behind any number we would pick. If one is ever wanted it belongs producer-side, where a refusal costs one candidate.

The parser stays TOTAL and PURE — no fs, no network, no throw (document.ts:12-15). It therefore cannot check that a ref RESOLVES, only that it is well-shaped. Do not imply resolution anywhere in the messages.

---

## 3. The ref grammar — v1 is two schemes

```ts
export const ELEMENT_REF = /^(?:git:(?:[0-9a-f]{40}|[0-9a-f]{64})|sha256:[0-9a-f]{64})$/;

/** The ONE harvest-source -> element-ref mapping. null = unmappable. Exported from @foliage/leaf. */
export function elementRefFrom(source: string, ref: string): string | null;
//  "git"   + bare 40/64 lowercase hex          -> `git:${ref}`   (refuse if `ref` already has a colon)
//  "photo" + "sha256:<64 lowercase hex>"       -> ref, unchanged (do NOT prefix again)
//  anything else                               -> null
```

Both agents call this one function; a producer that gets `null` **drops the element and reports it**, never fabricates a ref. These are the only two evidence sources that exist today: `clusterEvidence` writes `{source:"git", ref:<bare sha>}` (drafter.ts:69-76) and the photo path writes `{source:"photo", ref:"sha256:<digest>"}` (drafter.ts:307). README content is prompt context only (drafter.ts:182-184), not an evidence source — so there is no `file:`/`https:` scheme and therefore **no `digest` field** in v1. Both v1 schemes are content-addressed: the ref *is* the digest.

**`Provenance.ref` is NOT changed by this spec, and that divergence stays open.** Measured: git intake writes a bare sha (`ref: sha`, intake.ts:455-459) while promote writes `` `${first.source}:${first.ref}` `` (promote.ts:50) — `git:<sha>` for a commit, `photo:sha256:<hex>` (three segments) for a photo. So the shared-ref join ENGINEERING-PLAN.md:229-232 wants is still impossible after this ships. Changing `Provenance.ref` rewrites every leaf document on disk and needs its own migration (§9), so it is not smuggled in here.

---

## 4. The producer contract — what Photosynthesis implements

**MUST supply** per candidate — unchanged from today except the last clause: `id`, `drafted.title`, `evidence` (harvest shape `{source, ref, excerpt}`, harvestDocument.ts:41-48), `provenance`, `status`, plus optionally `body`, whose elements are the **imported** `LeafletElement` from `@foliage/leaf`. Do not re-declare the element types: three independent copies of `SCORE_SHAPED` already exist in this tree (document.ts:82, publishedDocument.ts:226, harvestDocument.ts:124), and §2 item 3 exists to stop repeating that.

**MAY supply, none of which crosses into a leaf:** `drafted.summary`, cluster keys, `observedAuthors`, `evidence[*].excerpt`. `toLeaflet` (promote.ts:42-54) carries `id`, `title`, `tier`, `provenance` and — new — `body`, and nothing else.

**MUST NEVER supply:**

| rule | mechanism | impossible, or refused? |
|---|---|---|
| a tier | `Candidate` has no tier field (harvestDocument.ts:62-77); `CANDIDATE_KEYS` (:107-115) refuses one; `promote.ts:47` writes `"pending"` as a literal | **impossible** |
| a `provenance.source` of its choosing | promote hard-codes `"photosynthesis"` (:49) | **impossible** |
| an element with no ref | `EvidenceRefs` is a non-empty tuple, and §2.6 refuses it again at the JSON door | **impossible in-process** |
| a comparison between tiers | no comparator, no numeric map (leaf.ts:30-48) | **impossible** |
| a score-shaped key | `checkKeys`, by name | refused |
| score-shaped prose in `drafted.title`/`summary` **or any element `text`** | `scoreShapedProse`, now in both gates | refused, and **incomplete by nature** (harvestDocument.ts:160-163) |
| a count of the subject's own work in `drafted.title` or element `text` | `cardinalityProse` | refused |

**Required change to the deterministic path.** `draftDeterministic` writes `` title: `${cluster.key} — ${cluster.commits.length} commits` `` (drafter.ts:88) and that title becomes the public leaflet title (promote.ts:46). That is a per-person cardinality presented as a signal and it breaches the invariant today. The title becomes the cluster key alone; the commits appear as the element's evidence refs — the set, not the count. `drafted.summary` keeps its counts: it is the reviewer's working text and never crosses.

**Deterministic cluster → element mapping (nothing left to guess).** One cluster → one candidate → exactly one element. `id = ${candidate.id}-e0` (candidate ids are already content-derived, drafter.ts:61-67, so a re-run yields the same element id and promotion stays idempotent through the id skip at promote.ts:125-133); `kind: "did"`; `text = cluster.key` verbatim; `evidence = clusterEvidence(cluster)` (≤3 commits, drafter.ts:69-76) mapped through `elementRefFrom`. Those three refs are a **sample, not the set** — the second reason the text may not assert breadth. The model path (drafter.ts:215-236) maps identically from its already-grounded `evidence`, one element per candidate, `text = d.title`.

**Worked example, literal, end to end.**

```jsonc
// gather cluster { key: "feat(auth)", commits: [ {sha:"a1b2…(40 hex)"}, {sha:"c3d4…(40 hex)"} ] }
// candidate in harvest.json:
{ "id": "ps-1f3a9c02", "drafted": { "title": "feat(auth)", "summary": "2 commits under …" },
  "evidence": [ { "source": "git", "ref": "a1b2…", "excerpt": "feat(auth): rotate session keys" } ],
  "body": [ { "id": "ps-1f3a9c02-e0", "kind": "did", "text": "feat(auth)",
              "evidence": [ { "ref": "git:a1b2…", "observedAt": "2026-08-18T09:41:00Z" },
                            { "ref": "git:c3d4…", "observedAt": "2026-08-18T09:41:00Z" } ] } ],
  "provenance": { "method": "deterministic" }, "status": "approved", "reviewedAt": "…" }
// after promote, in leaf.json — the tier is written by promote, never by the producer:
{ "id": "photosynthesis-ps-1f3a9c02", "title": "feat(auth)", "tier": "pending",
  "provenance": { "source": "photosynthesis", "ref": "git:a1b2…", "observedAt": "…" },
  "body": [ /* byte-identical to the candidate's body */ ] }
```

An element ref's `observedAt` is the harvest instant (`gatheredAt`) — the same value for every ref in one run. It is when we READ the artifact, never when the work happened; no per-commit date crosses in v1 (§8, §9).

---

## 5. Ordered file list

**OPEN plane** (`@foliage/leaf`, `@foliage/leaf-app`, `@foliage/photosynthesis-app` — public-boundary.json `planes.open`). Steps 1-3 land alone and are the **freeze point**: after them both agents build against a landed, exported interface, and the format accepts a body nobody yet produces — which renders as absent, and is honest.

1. `packages/leaf/src/leaf.ts` — §1.
2. `packages/leaf/src/document.ts` — §2 and §3, including every export §2 names.
3. `packages/leaf/src/leaf.test.ts`, `document.test.ts` — §7 items 1-2.
4. `apps/leaf/src/render.ts` — `leafletRow` (:174-195) renders the body. Markup contract, so tests can pin it: `<ul class="leaf-body">`, then per element `<li class="leaf-element" data-element="<id>" data-element-kind="did">` holding the text and a `<ul class="leaf-element-refs">` of `<li data-ref="<ref>">`. **No `data-verbatim` anywhere in it, and NO ELEMENT COUNT ANYWHERE IN IT** — the first draft of this list carried `data-body-elements="N"` on the `<ul>`, which is a per-person cardinality emitted into a `data-*` attribute and is refused for the same reason the withheld count is: SYSTEM-ARCHITECTURE.md §4 forbids exactly that shape, and the identical mistake is live today at `apps/canopy/src/renderPublished.ts:187` (`data-withheld="${w.count}"`), against that file's own rule at `:36-37`. Elements are one `<li>` each; a reader who wants the number counts the set, and nothing on the page or in its attributes hands it to them pre-computed, sortable or queryable.
5. `apps/leaf/src/render.test.ts` — §7 item 3.
6. `apps/photosynthesis/src/harvestDocument.ts` — `CANDIDATE_KEYS` (:107-115) gains `"body"`; delete the local `SCORE_PROSE`/`scoreShapedProse` (:165-177) and import them; parse `body` with the imported `parseLeafletElement`; apply `cardinalityProse` to `drafted.title`; **case-fold `checkKeys` at :194** — it is `SCORE_SHAPED.has(key)` today, so `"Score"` passes the airlock while document.ts:147 refuses it; type `Candidate.evidence` (:70) as `readonly [EvidenceRef, ...EvidenceRef[]]`, which the parser already guarantees at :245.
7. `apps/photosynthesis/src/drafter.ts` — §4: the cluster→element mapping and the deterministic-title fix.
8. `apps/photosynthesis/src/renderReview.ts` — `candidateCell` (:92-147) renders each element and its refs. Without it a human approves a body they never saw and the airlock is decorative.
9. `apps/photosynthesis/src/promote.ts` — `toLeaflet` (:42-54) carries `body`; delete the `"unknown"` ref fallback (:50), now unwritable given step 6's tuple type.
10. `apps/photosynthesis/src/harvestDocument.test.ts`, `pipeline.test.ts`, `apps/leaf/src/seam.test.ts`.
11. `apps/leaf/example/leaf.example.json` — one leaflet gains a body; still `"example": true`.

**CLOUD plane** (`@foliage/canopy`, `@foliage/canopy-app`). No plane boundary moves — cloud may depend on open, never the reverse; `pnpm check:boundary` must still pass.

12. `packages/canopy/src/publish.ts` — §6 redaction; `PublishedLeaflet` (:189-196) gains `body?: LeafletBody` and `elementsWithheld: boolean`.
13. `packages/canopy/src/publishedDocument.ts` — `LEAFLET_KEYS` (:333) gains `body` and `elementsWithheld`; the canopy declares its **own** element key sets (its egress doctrine at :94-98 is not to import the leaf's lists); **and the ingest-gate reconstruction at :755-766 must copy `body`**, or published element text is never re-scanned by the only gate the canopy has for artifacts it did not produce.
14. `packages/canopy/src/republish.ts` — §6.
15. `apps/canopy/publish.mjs` — `printDiff` (:304-332) prints the body change; it prints only titles today.
16. `apps/canopy/src/renderPublished.ts` — `leafletCell` (:138-158) renders the body and the withheld sentence. Without it the artifact carries a body no reader ever sees.
17. `packages/canopy/src/publish.test.ts`, `publishedDocument.test.ts`, `apps/canopy/src/publishSeam.test.ts`, `publishedLeaf.test.ts` — §7 items 4-6.
18. `docs/ENGINEERING-PLAN.md` §12 item 1 (:475-478) — record the decision.

---

## 6. Egress: publish, ingest, re-publish, render

**Redaction is element-wise, and needs no new withholding kind.** In `reviewForPublication` (publish.ts:433), after the tier check (:484-511) and the provenance check (:517-543), run `detect()` on each element's `text`. Any detection **withholds the whole element**: one `Withholding` entry per element, `kind: span.kind` (the existing span kinds, as titles already use at :545-557), `at: leaflets[<id>].body[<elementId>]`. Not a span rewrite — an element is one claim, and half a claim with a placeholder in it is a claim nobody can check. Element **refs need no redaction pass at all**: the §3 grammar admits only `git:<hex>`/`sha256:<hex>`, so no address, handle or phone number can occur in one. `KIND_TABLE` (publishedDocument.ts:206-214) is therefore unchanged.

**`elementsWithheld` is a BOOLEAN, not a count.** A per-leaflet integer on a public artifact can be summed across a page, and every other no-score guarantee here is structural (leaf.ts:30-48, :115-123). The flag is the publisher's word — exactly like `titleRedacted`, which publishedDocument.ts:110-113 states the canopy cannot check — and it is parsed with the same boolean-strict, non-defaultable rule `titleRedacted` gets at publishedDocument.ts:416-425. Withheld elements are still one **entry** each in the document-level `withheld`, the unit renderPublished.ts:162-166 insists on; `elementsWithheld` is not a second count of the same thing.

**Prerequisite, and it is a defect this spec would otherwise make worse.** Every element withholding adds an entry to `withheld`, whose `count` is written into the artifact at `publishedDocument.ts:906` and **emitted into served bytes as `data-withheld="${w.count}"` at `apps/canopy/src/renderPublished.ts:187`** — against that same file's stated rule at `:36-37` that withheld is rendered as entries and kinds and never as a number. SYSTEM-ARCHITECTURE.md §6b.6 records this as BROKEN today. Element-wise redaction multiplies that leaking integer by however many elements a leaflet has, so **fix `renderPublished.ts:187` before step 12 lands**, not after.

**If every element is withheld,** the published leaflet **omits `body`** and sets `elementsWithheld: true`. `renderPublished.ts` MUST render a sentence whenever the flag is true — that some of this leaflet's elaboration did not cross — or a reader takes a short body as the whole story.

**Published elements never carry `data-verbatim`.** They are machine prose. `render.test.ts:225-226` strips every `data-verbatim` region before the NO SCORE substring check, and `:259-290` exists precisely so that exemption cannot silently widen. Element text therefore stays *inside* the no-score check on both pages. That is the point.

**Re-publish (`republish.ts`).** `diffPublications` compares exactly `title` and `titleRedacted` (:94) and computes `identical` at :116-121, so today a rewritten element or a changed `elementsWithheld` would report `identical: true` on the second publication — the one nobody reviews, which is the failure the file's own header (:4-9) exists to prevent. Add to `ChangedLeaflet` (:32-38): `bodyChanged: boolean` and `elementsWithheldChanged: boolean`. Body comparison is **keyed by element id and order-insensitive**, consistent with the leaflet-order doctrine at :69-76: an id on one side only, a differing `text`, a differing ordered ref list, or absent-vs-present body is a change. Both booleans join `identical`, and a leaflet whose title is unchanged but whose body changed must appear in `changed` (so `printDiff` can name it).

---

## 7. Acceptance tests — the invariants as assertions

1. `document.test.ts` refuses: `{kind:"did", text:"cut p99 latency by 40%"}`; `text:"14 commits"`; `body: []`; `evidence: []`; an unknown element key; `{Score:1}` inside an element (case-folded); `ref:"a1b2…"` with no scheme; `ref:"file:/x"`; `observedAt` with no offset; a duplicate element id. It accepts the §4 worked example, and a leaflet with no `body` at all.
2. `leaf.test.ts`: a `body: []` literal does not type-check, and neither does an element with `evidence: []`. Both are compile-time facts and are pinned as such.
3. `render.test.ts`: element text and refs appear on the page; every element in the document has its own `<li class="leaf-element">` and no element is dropped (assert the SET of `data-element` ids equals the document's, not a tally — the test may count `<li>` nodes it parsed, the PAGE may not publish a count); **no element markup carries `data-verbatim`**, and no `data-*` attribute on the body or its list holds an integer; the existing NO SCORE test (:229-257) still passes with a body present.
4. `harvestDocument.test.ts`: `{Score:1}` on a candidate is refused (it passes today, at :194); score-shaped and cardinality prose in `body[*].text` is refused; a candidate carrying a body round-trips.
5. `publish.test.ts`: an element whose text holds an email is withheld as an entry while its siblings publish, with `elementsWithheld: true`; all elements withheld → `body` omitted and the flag true; `elementsWithheld` is present on every published leaflet.
6. `publishedDocument.test.ts`: an artifact whose element text holds an address is **refused by the ingest gate** (this fails unless :755-766 copies the body); `elementsWithheld` missing or non-boolean is refused; the canopy's element key and score lists are a superset of the leaf's, pinned by the same test the header at :94-98 describes; `diffPublications` reports `bodyChanged` for a body-only change.
7. Seam (`apps/leaf/src/seam.test.ts`, `apps/canopy/src/publishSeam.test.ts`): a document with a body travels leaf → render → publish → artifact → ingest → published render, and the elements a reader sees are the elements the document holds.

Runtime dependencies follow [UI-FOUNDATION.md](UI-FOUNDATION.md), which supersedes the earlier zero-dependency restriction. Other constraints: Node `>=22.18 <25` (package.json:6-7); no build step (tests run under `--experimental-strip-types`, package.json:14); planes enforced by `scripts/check-public-boundary.mjs` (package.json:12).

---

## 8. Cut from v1, deliberately — do not build these

Each was in the first draft. Treat their absence as intentional, not as an omission to fill in.

- **`quote`, and `data-verbatim` on any element.** Nothing can verify a quote is verbatim — the leaf gate is pure and cannot re-read the artifact (document.ts:12-15) — and pinning `data-verbatim` on a producer-asserted string widens the one no-score exemption `render.test.ts:259-290` was written to keep narrow.
- **`outcome`.** Its text is a claim the evidence does not literally state; whether it should exist at all is an owner decision, not a build step.
- **`artifact`.** A ref with a label on it is `provenance` with extra steps.
- **`period`, `occurredAt`, and the `gitIntake.ts` `LOG_FORMAT`/`FIELDS_PER_RECORD` change.** Correct min/max over mixed UTC offsets is subtle enough that two agents would implement it two ways; adding to `PROVENANCE_KEYS` (document.ts:75) is a closed-key-set migration in its own right; and the prior question is an owner decision, not a build step (§9.2, which also records that the photosynthesis root already gathers `%aI` and discards it at the seam).
- **`digest` on `EvidenceRef`**, and the `file:`/`https:` schemes: no mutable source exists in v1 (§3).
- **Freshness findings** (`intact`/`changed`/`unresolvable`/`unchecked`): no checker exists, so every element would be `unchecked` and every rule built on it would be dead code.
- **Caps** (§2.8) and a document **`version` field** (§1).
- **`/leaflet/<id>`.** `apps/leaf/server.mjs` routes `/`, static assets and `/fonts/*` and 404s everything else (:175-197). This route is the **next slice after this one**, not part of it — and when it is built it must call `reviewForPublication` and render its result, never a `Leaflet` directly, or it is a hole straight through the gate that withholds every non-verified leaflet (publish.ts:484-511).

## 9. Open — owner decisions this spec does not make

1. **`Provenance.ref` adopting the §3 grammar** (§3) — a breaking change to every document on disk.
2. **Per-commit dates / the recency gap — and the two roots do NOT agree, which is the part to decide.** On the **leaf git-intake** root there is no date: `LOG_FORMAT` (gitIntake.ts:69) captures four fields and none is a date, `ObservedCommit` (intake.ts:104-123) holds none, so every leaflet in a run carries the same `observedAt` (intake.ts:455-459) and a ten-year-old commit is indistinguishable from this morning's. On the **photosynthesis** root the date is already in hand and is thrown away: `gather.ts:106` logs `--format=%H%x1f%s%x1f%aI%x1f%ae`, `GatheredCommit.authoredAt` carries it (gather.ts:30, parsed :114-115, kept :122), `draftDeterministic` prints it into `drafted.summary` (drafter.ts:91-92) — and `drafted.summary` never crosses `toLeaflet` (promote.ts:42-54). So "nothing records when work happened" is true of one root and false of the other, and the cheapest honest fix costs no intake change on the path that already has the value.
   SYSTEM-ARCHITECTURE.md §2 recommends the SHAPE this should take if the owner says yes: **an artifact instant on `Provenance`**, beside `ref` and `observedAt`, rather than a `{start, end}` period on the leaflet — because on the leaf-intake root one leaflet is one commit (intake.ts:460) and a period degenerates to `start == end`. This spec agrees with that shape and adds the cost it omits: `PROVENANCE_KEYS` (document.ts:75) is a **closed** key set, so adding to it is a format change of the same class as opening `LEAFLET_KEYS` — one migration, not a free field — and a git author date is settable via `GIT_AUTHOR_DATE`, so any surface built on it must be labelled self-declared and must never carry the word *worked*.
3. **Per-leaflet visibility state in the open plane** — ENGINEERING-PLAN.md:479-481 recommends it; no field is added here.
4. **`locator` on `Provenance`** — ENGINEERING-PLAN.md:482; untouched.
5. **Naming another person** — no field exists, so today the answer is no by construction.
