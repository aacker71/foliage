/**
 * The HARVEST DOCUMENT — the on-disk form of machine-drafted leaflet candidates, and the
 * total function that turns untrusted JSON into one.
 *
 * WHY A SECOND FORMAT AND NOT A FIELD ON THE LEAF. Photosynthesis drafts leaflets out of raw
 * history; a draft is a machine's suggestion, not the subject's claim, and the two must never
 * share a file. Everything the machine knows about its own extraction — which extractor ran,
 * what evidence it clustered, who reviewed the result and when — lives HERE, and none of it
 * crosses the seam: promotion (`promote.ts`) emits plain pending leaflets that the existing
 * `parseLeafDocument` gate accepts unchanged. The leaf format needed zero changes for this
 * capability to exist, and keeping it that way is the point of this file.
 *
 * The same two disciplines as `parseLeafDocument`, because this parser guards the same
 * product posture one layer earlier:
 *
 *   UNKNOWN KEYS ARE REFUSED, and score-shaped keys are refused BY NAME. An extractor is
 *   exactly the kind of producer that wants to attach a `confidence` to its drafts. It may
 *   not: extraction certainty is expressed by the evidence refs and the named extractor
 *   identity, never a number. This is the FCRA posture extended to the candidate layer, and
 *   the refusal list is IMPORTED from @foliage/leaf rather than copied, so the two gates
 *   cannot drift.
 *
 *   A CANDIDATE WITH NO EVIDENCE CANNOT EXIST. The drafted title is prose a machine wrote;
 *   the evidence refs are the only checkable part. At least one is required, or the
 *   "candidate" is an unsourced assertion wearing the format.
 *
 * `shownPages` IS THE ONE FIELD ADDED SINCE THE THREE LIGHT SOURCES LANDED, and it is added
 * because a fact review needs could not be attached to anything already here. Everything else in
 * a candidate describes what the claim RESTS ON; this describes what the drafter was LOOKING AT
 * when it wrote the title — which is a larger set, and the difference between the two is exactly
 * where the danger is. A drafter shown pages A and B in one prompt can put a name from B into a
 * line that cites only A, so a register built from the refs is silent about B. That fact belongs
 * to the candidate rather than to a ref precisely because it is about the pages that are NOT
 * refs, and there is nowhere else in this format to put it.
 *
 * It carries NO PAGE CONTENT — a path, what the path's directory says, and two character counts
 * — and it never crosses the seam: `promoteApproved` emits a leaflet from the title and ONE
 * evidence ref, so nothing here can reach a leaf or a public page. It is optional, and its
 * PRESENCE is a claim in itself: a candidate carrying it was titled by a drafter that had been
 * shown exactly these pages, at exactly this extent. A candidate without it was titled from what
 * was measured, and no drafter's prose is in it.
 *
 * `media` IS THE SECOND SUCH FIELD, and it is here for a reason of the same kind. A photograph
 * is evidence a leaflet can carry, and the bytes are stored before review ever runs — so it was
 * possible to attach the image at PROMOTION, out of the store, and never put it in front of the
 * reviewer at all. That would break the one rule promotion is built on: an approval covers what
 * the reviewer saw. A person approving a drafted line would publish a picture nobody showed
 * them. So the media a candidate would publish is declared HERE, in the document review reads,
 * pinned to the evidence ref whose bytes it is, and promotion copies it across unmodified.
 *
 * Review is a discriminated union, not a status string plus optional fields: `rejected`
 * REQUIRES a reason (the same discipline as the excluded tier — a rejection without a reason
 * is a silent disappearance), and `approved` carries who and when, because promotion turns a
 * draft into someone's portfolio entry and that act must be attributable.
 *
 * TOTAL and PURE, exactly like `parseLeafDocument`: `unknown` in, either a `HarvestDocument`
 * or the complete list of reasons it is not one. No fs, no network, no throw.
 *
 * Complexity: O(n) over candidates and their evidence, one pass, plus an O(n) Set for
 * duplicate candidate ids.
 */

import { createHash } from "node:crypto";

import {
  SCORE_SHAPED,
  isIsoInstant,
  isMediaDigestRef,
  parseLeafletMedia,
  type LeafletMedia,
  type Provenance,
} from "@foliage/leaf";

/** Opaque id, so a candidate id cannot be passed where some other id is expected. */
export type HarvestCandidateId = string & { readonly __brand: "HarvestCandidateId" };
export const harvestCandidateId = (s: string): HarvestCandidateId => s as HarvestCandidateId;

/**
 * Where a candidate stands in review. Three states, no ordering, no partial forms:
 * a candidate is unreviewed, or a named person approved it at a named time, or a named
 * person rejected it at a named time FOR a named reason.
 */
export type ReviewState =
  | { readonly state: "candidate" }
  | {
      readonly state: "approved";
      readonly by: string;
      readonly at: string;
      /** See `reviewSubjectDigest` — what, exactly, this approval covered. Absent on legacy records. */
      readonly subjectDigest?: string;
    }
  | {
      readonly state: "rejected";
      readonly by: string;
      readonly at: string;
      readonly reason: string;
      /** See `reviewSubjectDigest`. Recorded on rejections too: a re-proposal that changed is a NEW question. */
      readonly subjectDigest?: string;
    };

/**
 * THE DIGEST AN APPROVAL BINDS TO — every publish-affecting and reviewer-visible field of a
 * candidate, canonically serialized and hashed. Found 2026-08-24, cross-model: carry-forward
 * compared title + sorted source/ref pairs ONLY, while promotion lifts each evidence excerpt
 * into PUBLIC body text — so a decision recorded before a refresh could authorize words the
 * reviewer never saw. The fix is deliberately NOT a longer hand-picked equality list (the next
 * added field would reopen the same hole); it is everything the candidate IS, minus exactly four
 * clocks-and-verdicts with stated reasons:
 *
 *   `review`    — the decision cannot be part of what the decision covers;
 *   `draftedAt` — the clock of the machine run, not material anyone judged. Including it would
 *                 reopen every decision on every refresh and delete carry-forward entirely;
 *   `evidence[].observedAt` — the same clock one level down: re-proposing stamps a fresh
 *                 instant on every ref, so including it reopens everything every time (measured:
 *                 the first seam test failed exactly this way before this line existed).
 *   `evidence[].authoredAt` — git's author date for the ref. It orders the queue and never
 *                 publishes (promotion rebuilds the plain provenance triple), and it was added
 *                 after decisions existed: counting it would change every recorded digest.
 *
 * Arrays keep their order (the FIRST evidence ref becomes the promoted leaflet's own
 * provenance, so order is publish-affecting); object keys are sorted so two serializers cannot
 * disagree about the same candidate. The `rsd1:` prefix versions the scheme — a future field
 * with different semantics bumps it, and mismatched versions simply reopen, which fails safe.
 */
export function reviewSubjectDigest(candidate: {
  readonly id: string;
  readonly title: string;
  readonly evidence: readonly unknown[];
  readonly extractor: string;
  readonly shownPages?: readonly unknown[];
  readonly media?: readonly unknown[];
}): string {
  const withoutClocks = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const { observedAt: _clock, authoredAt: _authored, ...material } = entry as Record<string, unknown>;
    return material;
  };
  const material = {
    id: String(candidate.id),
    title: candidate.title,
    evidence: candidate.evidence.map(withoutClocks),
    extractor: candidate.extractor,
    ...(candidate.shownPages === undefined ? {} : { shownPages: candidate.shownPages }),
    ...(candidate.media === undefined ? {} : { media: candidate.media }),
  };
  return `rsd1:${createHash("sha256").update(stableStringify(material)).digest("hex")}`;
}

/** JSON with recursively sorted object keys — arrays untouched, because their order is meaning. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The shape a recorded digest must have — checked at parse so garbage cannot masquerade as one. */
const SUBJECT_DIGEST = /^rsd1:[0-9a-f]{64}$/;

/**
 * What a page's PATH said about whose page it is, as recorded beside a shown page.
 *
 * The vocabulary lives HERE, in the format, and `@foliage/photosynthesis`'s `BrainPageKind` is
 * an alias of it rather than a second copy — a classification the document stores and a
 * classification the domain computes that could drift apart is a document whose words mean
 * something different from the code that wrote them.
 */
export const SHOWN_PAGE_KINDS = ["third-party-shaped", "unclassified"] as const;
export type ShownPageKind = (typeof SHOWN_PAGE_KINDS)[number];

/**
 * One page a drafter was shown while it wrote this candidate's title, and how much of it.
 *
 * `charsShown` < `charsInPage` means the drafter saw a FRACTION of a page the candidate may
 * nonetheless cite whole. That was previously printed once, at propose time, and then existed
 * nowhere — so a reviewer opening the document days later read a citation to a whole page with
 * no way to know the model had seen a third of it.
 */
export interface ShownPage {
  /** The page's path on the machine that drafted, so a reviewer can open it. */
  readonly page: string;
  /** What the path said — never what the page says. `unclassified` is not a clean bill. */
  readonly kind: ShownPageKind;
  readonly charsShown: number;
  /** The page's full length in characters, as read. Equal to `charsShown` when nothing was cut. */
  readonly charsInPage: number;
}

/**
 * One evidence ref as a candidate carries it: `Provenance`'s three fields under `Provenance`'s
 * rules, plus an optional VERBATIM excerpt of the artifact itself — a commit's subject line, a
 * page's heading. Never machine prose: the drafter's words live in `title`, where the format
 * already brands them as a draft. The excerpt is what lets review show a human the material a
 * ref stands for, and it is the ONLY text promotion may carry onto a body element — approval
 * covers what the reviewer saw, and the reviewer saw this.
 */
export interface HarvestEvidence extends Provenance {
  readonly excerpt?: string;
  /**
   * When the artifact was AUTHORED (git's `%aI`), as distinct from `observedAt`, when this
   * product saw it. Optional: older documents and non-git sources have none. Review orders by it;
   * it is outside the review digest and never crosses into a leaf.
   */
  readonly authoredAt?: string;
}

export interface HarvestCandidate {
  readonly id: HarvestCandidateId;
  /** The DRAFT — machine-written prose. It becomes a claim only after a person approves it. */
  readonly title: string;
  /**
   * At least one, enforced by the parser. Shaped exactly like `Provenance` (same fields, same
   * rules) plus one optional field of its own, so an approved candidate's evidence can cross the
   * seam with exactly one stated translation: at promotion the excerpt is LIFTED onto the body
   * element as its `text` and the provenance crosses as the clean triple, because the leaf
   * gate's `PROVENANCE_KEYS` deliberately refuses prose on a ref.
   */
  readonly evidence: readonly HarvestEvidence[];
  /**
   * The identity of whatever drafted this — "git-cluster", "local-model:gemma4:12b". Free
   * text so future extractors need no format change, but never blank: review has to see WHAT
   * drafted a title before deciding whether to trust it.
   */
  readonly extractor: string;
  /** When the draft was produced, as an ISO-8601 instant with an offset. */
  readonly draftedAt: string;
  readonly review: ReviewState;
  /**
   * The pages a drafter was shown while writing `title`, when one was. Absent means no drafter's
   * prose is in this title — see the header; the presence of this list is itself a claim.
   */
  readonly shownPages?: readonly ShownPage[];
  /**
   * The media this candidate would publish, one entry per evidence ref that names IMAGE BYTES.
   *
   * IT IS HERE, IN THE REVIEWED DOCUMENT, AND NOT DERIVED AT PROMOTION, and that is the whole
   * argument for the field. `promote.ts` is built around one rule — an approval covers exactly
   * what the reviewer saw — which is why it refuses to write text onto a body element and why a
   * trimmed evidence list is a whole refusal rather than a smaller leaflet. A photograph
   * attached at promotion time, out of a store the reviewer never looked at, would be the same
   * failure in its worst form: a person approves a line of prose and a picture of their kitchen
   * is published under it. So the reviewer approves the picture or nobody does.
   *
   * Absent means this candidate carries no media. An EMPTY list is refused for the same reason
   * `shownPages: []` is: "no media" already has a spelling, and a second one makes two documents
   * that mean the same thing stop comparing equal.
   */
  readonly media?: readonly CandidateMedia[];
}

/**
 * One image a candidate carries, pinned to the evidence ref whose bytes it is.
 *
 * THE SHAPE MIRRORS A BODY ELEMENT ON PURPOSE. A leaflet's media half is
 * `{ provenance: { ref, … }, media: { mediaType, dimensions } }`; this is `{ ref, media }` with
 * the same inner object, parsed by the LEAF GATE'S OWN FUNCTION (`parseLeafletMedia`), so
 * promotion copies it across verbatim rather than translating it. `media.media` reads
 * repetitively and is kept anyway: the alternative — flattening `mediaType` and `dimensions`
 * beside `ref` — is a second spelling of the leaf's object, and a second spelling is the thing
 * that drifts.
 *
 * `ref` MUST be one of this candidate's own evidence refs, and it must BE a content digest.
 * Both are checked here rather than at promotion, one layer earlier than the leaf gate, because
 * promotion is the moment after a human has already approved something: a refusal there is a
 * person told their approval cannot be honoured.
 */
export interface CandidateMedia {
  /** The evidence ref these bytes are. `sha256:` + 64 lowercase hex — see `isMediaDigestRef`. */
  readonly ref: string;
  /** The leaf format's own media object, unmodified. */
  readonly media: LeafletMedia;
}

export interface HarvestDocument {
  /**
   * THE TARGET BINDING, ledger F-014. Recorded at PROPOSE time when the target leaf was known
   * (an explicit `--into` naming a real, parseable leaf) and never afterward, never guessed:
   * `promoteApproved` had no way to tell whose harvest it was promoting, so pointing `--into`
   * at the wrong person's leaf landed silently, exit 0 — subject B's approved candidates
   * spliced into subject A's leaf, a consent breach shape.
   *
   * BOTH ABSENT is not an error — it means an OLDER document (proposed before this field
   * existed) or a propose run with no `--into` given, and `promoteApproved` treats that as
   * UNCHECKED, never as a match. The two travel together because both are read off the SAME
   * target leaf at propose time; a document with one and not the other is not a shape this
   * producer writes, though the parser does not require that pairing — a hand-edited document
   * is still checked on whichever of the two it carries.
   */
  readonly subject?: string;
  readonly leafId?: string;
  /**
   * WHICH REPOSITORY THIS HARVEST WAS DRAFTED FROM — the same kind of fact as the target binding
   * above, recorded at propose time and never guessed.
   *
   * WHY IT HAD TO EXIST. A garden holds ONE harvest, and `propose --force` writes the candidate set
   * THIS run drafted. Proposing from a different repository therefore replaces the queue — and
   * because candidate ids are the commit prefix alone (`git-cluster:docs`), an id from repository A
   * can COLLIDE with a decided one from repository B: the id survives, the digest differs, and the
   * decision is silently reopened. MEASURED: an approval made against repository B came back as an
   * undecided candidate after a harvest of repository A.
   *
   * A reopen is legitimate when the SAME repository's material changed — that is the whole of
   * carry-forward, and refusing it would break every ordinary re-harvest. It is not legitimate when
   * the material came from somewhere else entirely, and this field is the only way to tell the two
   * apart. `foliage grow` reads it and refuses rather than discarding somebody's review work.
   *
   * ABSENT is not an error, exactly as above: an older document, or a producer that did not record
   * it. Absent means UNCHECKED — never "it matches".
   */
  readonly repo?: string;
  readonly candidates: readonly HarvestCandidate[];
}

/**
 * THE ONE REASSEMBLY POINT for every writer of this format, ledger F-024. Replace a document's
 * `candidates` and keep every OTHER document-level field exactly as the source document carried
 * it — today that is only `subject`/`leafId`, carried BY NAME (this repo handles fields
 * explicitly, never by blind spread). A future document-level field must be added HERE, in one
 * place — every caller then inherits it, instead of three writers each remembering by hand.
 *
 * WHY THIS EXISTS: `propose`'s own `--force` refresh once dropped the target binding it had
 * recorded (F-014), fixed by `prepareProposedDocument` in `apps/leaf/src/proposeDocument.ts`. The
 * IDENTICAL shape then reappeared one layer over, in the two writers that never went through
 * that fix — `decide()` in `apps/leaf/harvest.mjs` and `recordDecision()` in
 * `apps/leaf/server.mjs` (approve/reject) each rebuilt the document as `{ candidates }` only, so
 * every approve or reject silently stripped `subject`/`leafId` — F-024. Since a real `promote`
 * needs an APPROVED candidate, and approving is exactly what erased the binding, the sanctioned
 * `grow` → `review` → `promote` sequence never once exercised F-014's own check: every promote in
 * that path saw `binding: "unbound-legacy"`, not a checked match, and a wrong `--into` spliced
 * silently — the exact consent-breach shape F-014 exists to refuse, reopened by the one path a
 * real user actually takes.
 *
 * So this is pulled OUT of `prepareProposedDocument` (which now calls it too) and made the one
 * place ANY writer of a harvest document — propose, propose-photos, propose-brain, approve,
 * reject, and whatever writes one next — replaces candidates without needing to remember which
 * OTHER fields exist. PURE and TOTAL: no fs, no clock, no throw.
 */
export function withCandidates<C>(
  document: Pick<HarvestDocument, "subject" | "leafId" | "repo">,
  candidates: readonly C[],
): { readonly subject?: string; readonly leafId?: string; readonly repo?: string; readonly candidates: readonly C[] } {
  return {
    ...(document.subject === undefined ? {} : { subject: document.subject }),
    ...(document.leafId === undefined ? {} : { leafId: document.leafId }),
    // Carried, not dropped: this helper is how every propose producer rebuilds its document, so a
    // field it forgets is a field that silently disappears on the next harvest.
    ...(document.repo === undefined ? {} : { repo: document.repo }),
    candidates,
  };
}

/** One reason a document is not a harvest, addressed to whoever is editing the file. */
export interface HarvestDocumentIssue {
  /** `candidates[2].evidence[0].ref` — the index is named, same rule as LeafDocumentIssue. */
  readonly at: string;
  readonly message: string;
}

export type HarvestDocumentParse =
  | { readonly ok: true; readonly harvest: HarvestDocument }
  | { readonly ok: false; readonly issues: readonly HarvestDocumentIssue[] };

const DOCUMENT_KEYS: ReadonlySet<string> = new Set(["candidates", "subject", "leafId", "repo"]);
const CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "evidence",
  "extractor",
  "draftedAt",
  "review",
  "shownPages",
  "media",
]);
const EVIDENCE_KEYS: ReadonlySet<string> = new Set(["source", "ref", "observedAt", "excerpt", "authoredAt"]);
const CANDIDATE_MEDIA_KEYS: ReadonlySet<string> = new Set(["ref", "media"]);
const SHOWN_PAGE_KEYS: ReadonlySet<string> = new Set([
  "page",
  "kind",
  "charsShown",
  "charsInPage",
]);

/**
 * Which keys each review state may carry. Declared per state rather than as one superset,
 * because `reason` on an approved review is exactly the kind of key that would be attached
 * and then silently never shown — the same trap `parseLeafDocument` closes for `reason` on a
 * non-excluded leaflet.
 */
const REVIEW_KEYS_BY_STATE: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  candidate: new Set(["state"]),
  approved: new Set(["state", "by", "at", "subjectDigest"]),
  rejected: new Set(["state", "by", "at", "reason", "subjectDigest"]),
});

const REVIEW_STATES = ["candidate", "approved", "rejected"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Same wording rules as document.ts: say what was actually there, absence included. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function checkKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: HarvestDocumentIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: no rating of any kind may enter this format. An ` +
          `extractor's certainty is expressed by its evidence refs and its named identity ` +
          `(the "extractor" field), never a number — the same posture as the leaf document, ` +
          `one layer earlier.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling cannot become an invisible omission. Allowed here: ` +
          `${[...allowed].join(", ")}.`,
      });
    }
  }
}

function checkInstant(
  v: unknown,
  at: string,
  what: string,
  issues: HarvestDocumentIssue[],
): v is string {
  if (!nonEmptyString(v)) {
    issues.push({ at, message: `required: ${what} as an ISO-8601 instant, got ${describe(v)}` });
    return false;
  }
  if (!isIsoInstant(v)) {
    issues.push({
      at,
      message:
        `"${v}" is not an ISO-8601 instant with an offset (e.g. 2026-08-16T09:41:00Z). A ` +
        `local-time stamp is an observation plus an unstated assumption about where it was made.`,
    });
    return false;
  }
  return true;
}

/**
 * One evidence ref. The RULES are `Provenance`'s rules — same fields, same instant
 * requirement via the imported `isIsoInstant` — because these objects cross the seam
 * verbatim at promotion and a looser gate here would let promote emit what the leaf gate
 * rejects.
 */
// jscpd:ignore-start — this evidence-ref validator is the same cross-plane parallelism this
// repo already documents (.loop/STATUS.md row C9): identical to artifactDocument.ts's, plus this
// open plane's later-added `excerpt` field. Historical, not retriaged here.
function parseEvidenceRef(
  v: unknown,
  at: string,
  issues: HarvestDocumentIssue[],
): HarvestEvidence | null {
  if (!isRecord(v)) {
    issues.push({ at, message: `an evidence ref must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, EVIDENCE_KEYS, at, issues);

  const source = v["source"];
  const ref = v["ref"];
  const observedAt = v["observedAt"];
  let bad = false;

  if (!nonEmptyString(source)) {
    issues.push({
      at: `${at}.source`,
      message: `required: the mechanism that produced the evidence (e.g. "git"), got ${describe(source)}`,
    });
    bad = true;
  }
  if (!nonEmptyString(ref)) {
    issues.push({
      at: `${at}.ref`,
      message: `required: a stable handle for the artifact (commit sha, digest), got ${describe(ref)}`,
    });
    bad = true;
  }
  if (!checkInstant(observedAt, `${at}.observedAt`, "when the evidence was observed", issues)) {
    bad = true;
  }

  const excerpt = v["excerpt"];
  if (excerpt !== undefined && !nonEmptyString(excerpt)) {
    // An empty excerpt is a lie of presence: review would print a blank line and call it the
    // material. Absence is the honest spelling of "no verbatim text travelled with this ref".
    issues.push({
      at: `${at}.excerpt`,
      message: `when present, a verbatim excerpt of the artifact (a commit subject, a heading) — got ${describe(excerpt)}`,
    });
    bad = true;
  }

  const authoredAt = v["authoredAt"];
  if (authoredAt !== undefined && !checkInstant(authoredAt, `${at}.authoredAt`, "when the artifact was authored", issues)) {
    bad = true;
  }

  if (bad) return null;
  return Object.freeze({
    source: source as string,
    ref: ref as string,
    observedAt: observedAt as string,
    ...(excerpt === undefined ? {} : { excerpt: excerpt as string }),
    ...(authoredAt === undefined ? {} : { authoredAt: authoredAt as string }),
  });
}
// jscpd:ignore-end

/**
 * One entry of `shownPages`.
 *
 * The counts are checked against each other, not merely for type: `charsShown` above
 * `charsInPage` would say a model read more of a page than the page contains, which is not a
 * measurement anything could have produced and would make the one number a reviewer acts on
 * ("it saw a fraction") unreadable.
 */
function parseShownPage(
  v: unknown,
  at: string,
  issues: HarvestDocumentIssue[],
): ShownPage | null {
  if (!isRecord(v)) {
    issues.push({ at, message: `a shown page must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, SHOWN_PAGE_KEYS, at, issues);

  const page = v["page"];
  const kind = v["kind"];
  const charsShown = v["charsShown"];
  const charsInPage = v["charsInPage"];
  let bad = false;

  if (!nonEmptyString(page)) {
    issues.push({
      at: `${at}.page`,
      message:
        `required: the path of a page the drafter was shown, got ${describe(page)}. It is what ` +
        `lets a reviewer open a page the title may rest on without citing.`,
    });
    bad = true;
  }
  if (typeof kind !== "string" || !(SHOWN_PAGE_KINDS as readonly string[]).includes(kind)) {
    issues.push({
      at: `${at}.kind`,
      message:
        `required: one of ${SHOWN_PAGE_KINDS.map((k) => `"${k}"`).join(", ")} — got ${
          typeof kind === "string" ? `"${kind}"` : describe(kind)
        }. This states what the PATH said, which is all a path can say; "unclassified" is not a ` +
        `clean bill of health.`,
    });
    bad = true;
  }
  for (const [name, value] of [
    ["charsShown", charsShown],
    ["charsInPage", charsInPage],
  ] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      issues.push({
        at: `${at}.${name}`,
        message:
          `required: a whole, non-negative count of characters, got ${describe(value)}. This is ` +
          `a measurement of what was read, so anything that cannot be one is refused rather ` +
          `than coerced.`,
      });
      bad = true;
    }
  }
  if (
    typeof charsShown === "number" &&
    typeof charsInPage === "number" &&
    Number.isInteger(charsShown) &&
    Number.isInteger(charsInPage) &&
    charsShown > charsInPage
  ) {
    issues.push({
      at: `${at}.charsShown`,
      message:
        `${charsShown} characters shown out of a page holding ${charsInPage} is not a reading ` +
        `anything could have performed. The pair exists so a reviewer can see at a glance that ` +
        `a model saw a FRACTION of a page the claim cites whole; a pair that cannot be true ` +
        `makes that unreadable.`,
    });
    bad = true;
  }

  if (bad) return null;
  return Object.freeze({
    page: page as string,
    kind: kind as ShownPageKind,
    charsShown: charsShown as number,
    charsInPage: charsInPage as number,
  });
}

/**
 * One entry of `media`: which evidence ref is an image, and what that image is.
 *
 * `evidenceRefs` is passed in because the interesting rule is RELATIONAL — a media entry naming
 * a ref this candidate does not cite would publish bytes the approved title never rested on.
 * That cannot be checked by looking at the entry alone, and it is the check most worth having.
 */
function parseCandidateMedia(
  v: unknown,
  at: string,
  evidenceRefs: ReadonlySet<string>,
  issues: HarvestDocumentIssue[],
): CandidateMedia | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `a media entry must be an object pairing an evidence ref with what its bytes are, got ` +
        `${describe(v)}.`,
    });
    return null;
  }
  checkKeys(v, CANDIDATE_MEDIA_KEYS, at, issues);

  const ref = v["ref"];
  let bad = false;

  if (!nonEmptyString(ref)) {
    issues.push({
      at: `${at}.ref`,
      message:
        `required: which of this candidate's evidence refs these bytes are, got ${describe(ref)}.`,
    });
    bad = true;
  } else if (!isMediaDigestRef(ref)) {
    issues.push({
      at: `${at}.ref`,
      message:
        `"${ref}" is not a content digest — "sha256:" followed by 64 lowercase hex characters. ` +
        `A media ref must BE the digest of its bytes, because that is the only thing that makes ` +
        `a published image checkable: hash what you were served and compare. A path or a commit ` +
        `sha names something else that may or may not still be this file. Refused here rather ` +
        `than at promotion, so nobody is told their approval cannot be honoured.`,
    });
    bad = true;
  } else if (!evidenceRefs.has(ref)) {
    issues.push({
      at: `${at}.ref`,
      message:
        `"${ref}" is not one of this candidate's evidence refs. Media is attached to evidence, ` +
        `never beside it: an image the approved title does not rest on would be published under ` +
        `that title anyway, which is exactly the approval-covers-what-was-seen rule that ` +
        `promotion is built to keep.`,
    });
    bad = true;
  }

  if (!("media" in v)) {
    issues.push({
      at: `${at}.media`,
      message:
        `required: what these bytes are — { "mediaType": …, "dimensions": … }. It is the leaf ` +
        `format's own media object, carried here unmodified so a reviewer sees exactly what ` +
        `would be published.`,
    });
    bad = true;
  }
  // THE LEAF GATE'S OWN FUNCTION, not a copy of its rules. See its comment: a second copy would
  // drift, and the drift would surface at promotion — after somebody had already approved.
  const media = "media" in v ? parseLeafletMedia(v["media"], `${at}.media`, issues) : null;
  if (media === null) bad = true;

  if (bad || media === null) return null;
  return Object.freeze({ ref: ref as string, media });
}

function parseReview(
  v: unknown,
  at: string,
  issues: HarvestDocumentIssue[],
): ReviewState | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message: `review must be an object with a "state", got ${describe(v)}`,
    });
    return null;
  }

  const state = v["state"];
  if (typeof state !== "string" || !(REVIEW_STATES as readonly string[]).includes(state)) {
    issues.push({
      at: `${at}.state`,
      message: `required: one of ${REVIEW_STATES.map((s) => `"${s}"`).join(", ")} — got ${
        typeof state === "string" ? `"${state}"` : describe(state)
      }.`,
    });
    // Without a state there is no way to know which other keys are even legal here.
    return null;
  }

  const allowed = REVIEW_KEYS_BY_STATE[state];
  if (allowed === undefined) return null; // unreachable: state was checked above
  checkKeys(v, allowed, at, issues);

  if (state === "candidate") return Object.freeze({ state: "candidate" as const });

  const by = v["by"];
  const reviewedAt = v["at"];
  let bad = false;

  if (!nonEmptyString(by)) {
    issues.push({
      at: `${at}.by`,
      message:
        `required: who ${state} this candidate, got ${describe(by)}. Review turns a machine ` +
        `draft into (or keeps it out of) someone's portfolio; that act must be attributable.`,
    });
    bad = true;
  }
  if (!checkInstant(reviewedAt, `${at}.at`, `when the candidate was ${state}`, issues)) {
    bad = true;
  }

  const subjectDigest = v["subjectDigest"];
  if (subjectDigest !== undefined && (typeof subjectDigest !== "string" || !SUBJECT_DIGEST.test(subjectDigest))) {
    issues.push({
      at: `${at}.subjectDigest`,
      message: `when present, a review-subject digest of the form rsd1:<64 hex>, got ${describe(subjectDigest)}`,
    });
    bad = true;
  }

  if (state === "approved") {
    if (bad) return null;
    return Object.freeze({
      state: "approved" as const,
      by: by as string,
      at: reviewedAt as string,
      ...(subjectDigest === undefined ? {} : { subjectDigest: subjectDigest as string }),
    });
  }

  const reason = v["reason"];
  if (!nonEmptyString(reason)) {
    issues.push({
      at: `${at}.reason`,
      message:
        `a rejected candidate requires a reason, got ${describe(reason)}. The same discipline ` +
        `as the excluded tier: a rejection with no reason is a silent disappearance, and the ` +
        `reason is what makes the decision reviewable later instead of just an absence.`,
    });
    return null;
  }
  if (bad) return null;
  return Object.freeze({
    state: "rejected" as const,
    by: by as string,
    at: reviewedAt as string,
    reason,
    ...(subjectDigest === undefined ? {} : { subjectDigest: subjectDigest as string }),
  });
}

function parseCandidate(
  v: unknown,
  index: number,
  issues: HarvestDocumentIssue[],
): HarvestCandidate | null {
  const at = `candidates[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, CANDIDATE_KEYS, at, issues);

  const id = v["id"];
  const title = v["title"];
  const extractor = v["extractor"];
  const draftedAt = v["draftedAt"];
  let bad = false;

  if (!nonEmptyString(id)) {
    issues.push({ at: `${at}.id`, message: `required: a non-empty id, got ${describe(id)}` });
    bad = true;
  }
  if (!nonEmptyString(title)) {
    issues.push({
      at: `${at}.title`,
      message: `required: the drafted title, got ${describe(title)}`,
    });
    bad = true;
  }
  if (!nonEmptyString(extractor)) {
    issues.push({
      at: `${at}.extractor`,
      message:
        `required: the identity of what drafted this (e.g. "git-cluster", ` +
        `"local-model:gemma4:12b"), got ${describe(extractor)}. Review has to see what wrote ` +
        `a draft before deciding whether to trust it.`,
    });
    bad = true;
  }
  if (!checkInstant(draftedAt, `${at}.draftedAt`, "when the draft was produced", issues)) {
    bad = true;
  }

  const rawEvidence = v["evidence"];
  const evidence: HarvestEvidence[] = [];
  if (!Array.isArray(rawEvidence)) {
    issues.push({
      at: `${at}.evidence`,
      message:
        `required: an array of at least one evidence ref, got ${describe(rawEvidence)}. A ` +
        `candidate with no evidence cannot exist — the draft is prose a machine wrote, and ` +
        `the refs are the only part of it that is checkable.`,
    });
    bad = true;
  } else if (rawEvidence.length === 0) {
    issues.push({
      at: `${at}.evidence`,
      message:
        `must contain at least one evidence ref — an empty array is an unsourced assertion ` +
        `wearing the candidate format, and it is refused rather than carried.`,
    });
    bad = true;
  } else {
    for (const [i, raw] of rawEvidence.entries()) {
      const parsed = parseEvidenceRef(raw, `${at}.evidence[${i}]`, issues);
      if (parsed === null) bad = true;
      else evidence.push(parsed);
    }
  }

  // OPTIONAL, and an EMPTY list is refused rather than accepted as "shown nothing": a drafter
  // that was shown no pages cannot have drafted a title, so `[]` here is a producer bug wearing
  // the shape of a measurement. Absent is the honest way to say no drafter was involved.
  const rawShown = v["shownPages"];
  const shownPages: ShownPage[] = [];
  let hasShown = false;
  if (rawShown !== undefined) {
    hasShown = true;
    if (!Array.isArray(rawShown)) {
      issues.push({
        at: `${at}.shownPages`,
        message:
          `must be an array of the pages the drafter was shown, got ${describe(rawShown)}. Omit ` +
          `the field entirely when no drafter wrote this title.`,
      });
      bad = true;
    } else if (rawShown.length === 0) {
      issues.push({
        at: `${at}.shownPages`,
        message:
          `an empty list is refused: a drafter shown no pages cannot have written a title. If ` +
          `no drafter wrote this one, omit the field — absent and "shown nothing" are different ` +
          `statements and only one of them can be true.`,
      });
      bad = true;
    } else {
      const seenPages = new Set<string>();
      for (const [i, raw] of rawShown.entries()) {
        const parsed = parseShownPage(raw, `${at}.shownPages[${i}]`, issues);
        if (parsed === null) {
          bad = true;
          continue;
        }
        if (seenPages.has(parsed.page)) {
          issues.push({
            at: `${at}.shownPages[${i}].page`,
            message:
              `"${parsed.page}" is listed twice. One page shown twice is one page, and a ` +
              `duplicate here would overstate the pack the drafter actually saw.`,
          });
          bad = true;
          continue;
        }
        seenPages.add(parsed.page);
        shownPages.push(parsed);
      }
    }
  }

  // OPTIONAL, empty refused, same reasoning as `shownPages` — "carries no media" is spelled by
  // the field's absence, and a second spelling of the default makes two equal documents unequal.
  // Checked against the refs collected above, which is why it is read after `evidence` and not
  // beside it.
  const rawMedia = v["media"];
  const media: CandidateMedia[] = [];
  let hasMedia = false;
  if (rawMedia !== undefined) {
    hasMedia = true;
    const evidenceRefs = new Set(evidence.map((e) => e.ref));
    if (!Array.isArray(rawMedia)) {
      issues.push({
        at: `${at}.media`,
        message:
          `must be an array pairing evidence refs with what their bytes are, got ` +
          `${describe(rawMedia)}. Omit the field entirely when this candidate carries no image.`,
      });
      bad = true;
    } else if (rawMedia.length === 0) {
      issues.push({
        at: `${at}.media`,
        message:
          `an empty list is refused: a candidate that carries no media says so by omitting this ` +
          `field. Absent and "carries an empty set of images" are two spellings of one fact.`,
      });
      bad = true;
    } else {
      const seenRefs = new Set<string>();
      for (const [i, raw] of rawMedia.entries()) {
        const parsed = parseCandidateMedia(raw, `${at}.media[${i}]`, evidenceRefs, issues);
        if (parsed === null) {
          bad = true;
          continue;
        }
        if (seenRefs.has(parsed.ref)) {
          issues.push({
            at: `${at}.media[${i}].ref`,
            message:
              `"${parsed.ref}" is described twice. One digest is one artifact; two descriptions ` +
              `of it can disagree, and nothing here could say which one a page should believe.`,
          });
          bad = true;
          continue;
        }
        seenRefs.add(parsed.ref);
        media.push(parsed);
      }
    }
  }

  const review = "review" in v ? parseReview(v["review"], `${at}.review`, issues) : null;
  if (review === null) {
    if (!("review" in v)) {
      issues.push({
        at: `${at}.review`,
        message:
          `required: a review state. A candidate that has not been looked at is ` +
          `{"state": "candidate"} — explicitly unreviewed, not silently unstated.`,
      });
    }
    bad = true;
  }

  if (bad || review === null) return null;
  return Object.freeze({
    id: harvestCandidateId(id as string),
    title: (title as string),
    evidence: Object.freeze(evidence),
    extractor: extractor as string,
    draftedAt: draftedAt as string,
    review,
    ...(hasShown ? { shownPages: Object.freeze(shownPages) } : {}),
    ...(hasMedia ? { media: Object.freeze(media) } : {}),
  });
}

/**
 * Parse an untrusted value into a `HarvestDocument`, or into every reason it is not one.
 *
 * Never throws and never partially succeeds — one invalid candidate rejects the whole
 * document, for the same reason `parseLeafDocument` works that way: silently carrying the
 * survivors would present a smaller harvest than the file describes.
 */
export function parseHarvestDocument(value: unknown): HarvestDocumentParse {
  const issues: HarvestDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message: `a harvest document must be a JSON object with a candidates array — got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, DOCUMENT_KEYS, "", issues);

  // THE TARGET BINDING, ledger F-014 — both optional, both checked the same way: present means
  // a non-empty string, or the field is refused at its own address. Absence of either is not
  // validated here at all; `promoteApproved` is where absence gets its own meaning (unchecked,
  // never assumed to match).
  const rawSubject = value["subject"];
  if (rawSubject !== undefined && !nonEmptyString(rawSubject)) {
    issues.push({
      at: "subject",
      message:
        `when present, a non-empty string — the subject this harvest was proposed FOR, got ` +
        `${describe(rawSubject)}. Omit the field entirely when no target leaf was known at ` +
        `propose time.`,
    });
  }
  // Same shape as the two bindings: present means a non-empty string, absent is unchecked.
  const rawRepo = value["repo"];
  if (rawRepo !== undefined && !nonEmptyString(rawRepo)) {
    issues.push({
      at: "repo",
      message:
        `when present, a non-empty string — the repository this harvest was drafted FROM, got ` +
        `${describe(rawRepo)}. Omit the field entirely when it was not recorded; absent means ` +
        `unchecked, never "it matches".`,
    });
  }

  const rawLeafId = value["leafId"];
  if (rawLeafId !== undefined && !nonEmptyString(rawLeafId)) {
    issues.push({
      at: "leafId",
      message:
        `when present, a non-empty string — the id of the leaf this harvest was proposed FOR, ` +
        `got ${describe(rawLeafId)}. Omit the field entirely when no target leaf was known at ` +
        `propose time.`,
    });
  }

  const rawCandidates = value["candidates"];
  const candidates: HarvestCandidate[] = [];
  if (rawCandidates === undefined) {
    issues.push({
      at: "candidates",
      message:
        `required: an array of candidates. An empty array [] is valid and means an honest ` +
        `empty harvest — it is not the same as the field being missing.`,
    });
  } else if (!Array.isArray(rawCandidates)) {
    issues.push({
      at: "candidates",
      message: `must be an array, got ${describe(rawCandidates)}`,
    });
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of rawCandidates.entries()) {
      const candidate = parseCandidate(raw, i, issues);
      if (candidate === null) continue;
      if (seen.has(candidate.id)) {
        issues.push({
          at: `candidates[${i}].id`,
          message: `duplicate id "${candidate.id}" — ids must be unique within a harvest.`,
        });
        continue;
      }
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  return {
    ok: true,
    harvest: Object.freeze({
      ...(nonEmptyString(rawSubject) ? { subject: rawSubject } : {}),
      ...(nonEmptyString(rawLeafId) ? { leafId: rawLeafId } : {}),
      ...(nonEmptyString(rawRepo) ? { repo: rawRepo } : {}),
      candidates: Object.freeze(candidates),
    }),
  };
}
