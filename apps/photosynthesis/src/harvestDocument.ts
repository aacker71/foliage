/**
 * The HARVEST document: candidate leaflets awaiting human review.
 *
 * WHY A SEPARATE FORMAT EXISTS AT ALL. `parseLeafDocument` refuses unknown keys and
 * refuses score-shaped keys by name — deliberately, and that refusal is load-bearing
 * for the FCRA posture. Photosynthesis therefore CANNOT bolt "candidate" fields onto a
 * leaf document. A harvest document is the airlock: everything AI-drafted lives here,
 * and only what a human APPROVED crosses into a leaf — as a `pending` leaflet, never
 * `verified` (verified remains signature-only, decided at the 2026-08-16 review).
 *
 * THE CENTRAL HONESTY RULE — DRAFTED IS A THIRD KIND OF TEXT. The leaf renderer already
 * distinguishes authored chrome from verbatim evidence (`data-verbatim`). A candidate's
 * title and summary are NEITHER: they are machine-drafted prose about the subject's
 * work. That class travels in `drafted`, always beside `evidence` (verbatim refs it was
 * drafted FROM) and `provenance.method` (which machine, or none). A candidate whose
 * drafted text cannot point at evidence is not a weaker candidate — it is INVALID, and
 * the parser refuses it. That is the grounding discipline ported from career-core's
 * submission-grounding: prose that traces to nothing is deleted, not decorated.
 *
 * NO SCORE, SAME TEETH AS THE LEAF FORMAT. The temptation is stronger here — "the
 * model was 87% confident" — and the refusal is therefore the same mechanical one:
 * score-shaped keys are refused BY NAME, including on nested objects. A reviewer ranks
 * candidates with their judgment, not with the model's self-report.
 *
 * Review states are deliberately terminal-or-open:
 *
 *   proposed ──▶ approved     (a human said yes; promotion may carry it into a leaf)
 *            └─▶ rejected     (a human said no; it stays as a record, never re-proposed
 *                              with the same id, so a re-run cannot nag)
 *
 * There is no "auto-approved". There is no path from rejected back to proposed with
 * the same id. `promotedAt` exists so promotion is idempotent — a candidate already
 * carried into a leaf is never carried twice.
 */

import { isIsoInstant } from "@foliage/leaf";

export const HARVEST_SCHEMA_VERSION = 1;

/** Where a candidate's evidence came from. Mirrors leaf Provenance deliberately. */
export interface EvidenceRef {
  /** "git" | "readme" | "photo" — the gathering mechanism, not the drafting one. */
  readonly source: string;
  /** Commit sha, file path + heading, or image file digest. Verbatim, stable. */
  readonly ref: string;
  /** A short VERBATIM excerpt of the underlying evidence (subject line, heading, EXIF-free caption input). */
  readonly excerpt: string;
}

/** How the drafted prose was produced. Ported design: career-core DraftProvenance. */
export interface DraftProvenance {
  /** "local_llm" — a model on a loopback endpoint. "deterministic" — no model at all. */
  readonly method: "local_llm" | "deterministic";
  /** Model identity when method === "local_llm". Never present for deterministic. */
  readonly model?: string;
  /** True only when the endpoint was verified loopback at call time. */
  readonly ranLocally?: boolean;
}

export type CandidateStatus = "proposed" | "approved" | "rejected";

export interface Candidate {
  readonly id: string;
  /** Machine-drafted prose — NEVER verbatim evidence, NEVER authored chrome. */
  readonly drafted: {
    readonly title: string;
    readonly summary: string;
  };
  /** The verbatim evidence the prose was drafted FROM. Non-empty by construction. */
  readonly evidence: readonly EvidenceRef[];
  readonly provenance: DraftProvenance;
  readonly status: CandidateStatus;
  /** ISO instant of the human decision. Present iff status !== "proposed". */
  readonly reviewedAt?: string;
  /** ISO instant this candidate was carried into a leaf. Present only when approved. */
  readonly promotedAt?: string;
}

export interface HarvestDocument {
  readonly schemaVersion: number;
  readonly subject: string;
  /** Identity the gather step attributed against (email), same meaning as intake. */
  readonly identity: string;
  /** Where the harvest ran: the repo/photo roots, recorded for the review page. */
  readonly sources: readonly string[];
  readonly gatheredAt: string;
  readonly candidates: readonly Candidate[];
}

export interface HarvestIssue {
  readonly at: string;
  readonly message: string;
}

export type HarvestParse =
  | { readonly ok: true; readonly harvest: HarvestDocument }
  | { readonly ok: false; readonly issues: readonly HarvestIssue[] };

const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "subject",
  "identity",
  "sources",
  "gatheredAt",
  "candidates",
]);
const CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "drafted",
  "evidence",
  "provenance",
  "status",
  "reviewedAt",
  "promotedAt",
]);
const DRAFTED_KEYS: ReadonlySet<string> = new Set(["title", "summary"]);
const EVIDENCE_KEYS: ReadonlySet<string> = new Set(["source", "ref", "excerpt"]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(["method", "model", "ranLocally"]);

/**
 * Same refusal list as the leaf format, refused at EVERY nesting level. The model's
 * self-reported confidence is the most likely intruder and is named first.
 */
const SCORE_SHAPED: ReadonlySet<string> = new Set([
  "confidence",
  "score",
  "scores",
  "rating",
  "rank",
  "ranking",
  "grade",
  "gpa",
  "percentile",
  "percentage",
  "percent",
  "weight",
  "weighted",
  "composite",
  "stars",
  "points",
  "strength",
]);

const STATUSES: ReadonlySet<string> = new Set(["proposed", "approved", "rejected"]);

/**
 * Score-shaped PROSE, not just score-shaped keys — and this exists because of a hole an
 * adversarial review found downstream, not because of tidiness.
 *
 * The leaf renderer marks every leaflet title `data-verbatim="title"`, which is correct
 * for intake (a commit subject IS carried text) and which the NO SCORE invariant then
 * deliberately EXEMPTS, because refusing to render someone's real commit message would
 * falsify the evidence. A promoted photosynthesis title is machine prose wearing that
 * same marker — so a model that drafted "rated 9/10 for impact" would sail through the
 * leaf page's own safety net on an exemption it was never entitled to.
 *
 * Photosynthesis owns its own output, so it closes the hole at the source: drafted text
 * matching these patterns is refused HERE, before it can be reviewed or promoted.
 *
 * HONEST LIMIT, stated rather than papered over: this is a pattern list over prose, so
 * it is necessarily incomplete — a determined model could phrase a rating in words this
 * misses. It raises the floor; it is not a proof. The structural guarantees (keys refused
 * by name, tiers unordered, no aggregate computed anywhere) are what actually hold.
 */
const SCORE_PROSE: readonly RegExp[] = [
  /\b\d+(\.\d+)?\s*(\/|out of)\s*\d+\b/i, // 9/10, 4 out of 5
  /\b\d+(\.\d+)?\s*(%|percent)\b/i,
  /\b(rated|ranked|scored|graded)\b/i,
  /\b(score|rating|ranking|grade|percentile)\s*[:=]/i,
  /\b\d+\s*(stars?|points?)\b/i,
  /\b(top|bottom)\s+\d+\s*%/i,
];

/** The score-shaped prose patterns `text` matches, or an empty array. Exported for the drafter. */
export function scoreShapedProse(text: string): readonly string[] {
  return SCORE_PROSE.filter((re) => re.test(text)).map((re) => re.source);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: HarvestIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (SCORE_SHAPED.has(key)) {
      issues.push({
        at: at === "" ? key : `${at}.${key}`,
        message:
          `score-shaped key refused by name — a harvest document carries evidence and a ` +
          `human decision, never a rating; strip "${key}" at the producer`,
      });
    } else if (!allowed.has(key)) {
      issues.push({
        at: at === "" ? key : `${at}.${key}`,
        message: `unknown key — allowed here: ${[...allowed].join(", ")}`,
      });
    }
  }
}

function parseCandidate(value: unknown, at: string, issues: HarvestIssue[]): Candidate | null {
  if (!isRecord(value)) {
    issues.push({ at, message: "a candidate must be an object" });
    return null;
  }
  checkKeys(value, CANDIDATE_KEYS, at, issues);

  if (!nonEmptyString(value["id"])) issues.push({ at: `${at}.id`, message: "required, non-empty string" });

  const drafted = value["drafted"];
  if (!isRecord(drafted)) {
    issues.push({ at: `${at}.drafted`, message: "required object { title, summary }" });
  } else {
    checkKeys(drafted, DRAFTED_KEYS, `${at}.drafted`, issues);
    if (!nonEmptyString(drafted["title"])) issues.push({ at: `${at}.drafted.title`, message: "required, non-empty" });
    if (typeof drafted["summary"] !== "string") issues.push({ at: `${at}.drafted.summary`, message: "required string" });

    // Score-shaped PROSE, refused here because downstream the title wears the leaf's
    // `data-verbatim` marker and would inherit an exemption it is not entitled to.
    for (const field of ["title", "summary"] as const) {
      const text = drafted[field];
      if (typeof text !== "string") continue;
      const hits = scoreShapedProse(text);
      if (hits.length > 0) {
        issues.push({
          at: `${at}.drafted.${field}`,
          message:
            `reads as a rating (${hits.join(", ")}) — this product never produces one, and a ` +
            `promoted title is exempted from the leaf page's own no-score check as carried text`,
        });
      }
    }
  }

  const evidence = value["evidence"];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    // THE GROUNDING RULE. Drafted prose with no evidence is not reviewable — a
    // reviewer would be approving an assertion they cannot check.
    issues.push({
      at: `${at}.evidence`,
      message: "required non-empty array — drafted prose that traces to nothing is refused, not decorated",
    });
  } else {
    evidence.forEach((e, i) => {
      if (!isRecord(e)) {
        issues.push({ at: `${at}.evidence[${i}]`, message: "must be an object" });
        return;
      }
      checkKeys(e, EVIDENCE_KEYS, `${at}.evidence[${i}]`, issues);
      if (!nonEmptyString(e["source"])) issues.push({ at: `${at}.evidence[${i}].source`, message: "required" });
      if (!nonEmptyString(e["ref"])) issues.push({ at: `${at}.evidence[${i}].ref`, message: "required" });
      if (typeof e["excerpt"] !== "string") issues.push({ at: `${at}.evidence[${i}].excerpt`, message: "required string" });
    });
  }

  const prov = value["provenance"];
  if (!isRecord(prov)) {
    issues.push({ at: `${at}.provenance`, message: "required — who drafted this, machine or none" });
  } else {
    checkKeys(prov, PROVENANCE_KEYS, `${at}.provenance`, issues);
    const method = prov["method"];
    if (method !== "local_llm" && method !== "deterministic") {
      issues.push({ at: `${at}.provenance.method`, message: `must be "local_llm" or "deterministic"` });
    }
    if (method === "deterministic" && prov["model"] !== undefined) {
      // A model name on a deterministic draft would let a heuristic masquerade as AI
      // output (or vice versa). The two must be mutually exclusive to stay honest.
      issues.push({ at: `${at}.provenance.model`, message: "must be absent when method is deterministic" });
    }
    if (method === "local_llm" && !nonEmptyString(prov["model"])) {
      issues.push({ at: `${at}.provenance.model`, message: "required when method is local_llm" });
    }
  }

  const status = value["status"];
  if (typeof status !== "string" || !STATUSES.has(status)) {
    issues.push({ at: `${at}.status`, message: `must be one of proposed, approved, rejected` });
  }

  const reviewedAt = value["reviewedAt"];
  if (status === "proposed" && reviewedAt !== undefined) {
    issues.push({ at: `${at}.reviewedAt`, message: "a proposed candidate has no review instant" });
  }
  if ((status === "approved" || status === "rejected") && !(nonEmptyString(reviewedAt) && isIsoInstant(reviewedAt))) {
    issues.push({
      at: `${at}.reviewedAt`,
      message: "a decided candidate must carry the ISO instant a human decided it",
    });
  }

  const promotedAt = value["promotedAt"];
  if (promotedAt !== undefined) {
    if (status !== "approved") {
      issues.push({ at: `${at}.promotedAt`, message: "only an approved candidate can have been promoted" });
    } else if (!(nonEmptyString(promotedAt) && isIsoInstant(promotedAt))) {
      issues.push({ at: `${at}.promotedAt`, message: "must be an ISO instant when present" });
    }
  }

  return issues.length > 0 ? null : (value as unknown as Candidate);
}

export function parseHarvestDocument(value: unknown): HarvestParse {
  const issues: HarvestIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ at: "(root)", message: "a harvest document must be a JSON object" }] };
  }
  checkKeys(value, DOCUMENT_KEYS, "", issues);

  if (value["schemaVersion"] !== HARVEST_SCHEMA_VERSION) {
    issues.push({ at: "schemaVersion", message: `must be ${HARVEST_SCHEMA_VERSION}` });
  }
  if (!nonEmptyString(value["subject"])) issues.push({ at: "subject", message: "required, non-empty" });
  if (!nonEmptyString(value["identity"])) issues.push({ at: "identity", message: "required, non-empty" });
  const sources = value["sources"];
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every(nonEmptyString)) {
    issues.push({ at: "sources", message: "required non-empty array of non-empty strings" });
  }
  const gatheredAt = value["gatheredAt"];
  if (!(nonEmptyString(gatheredAt) && isIsoInstant(gatheredAt))) {
    issues.push({ at: "gatheredAt", message: "required ISO-8601 instant" });
  }

  const candidates = value["candidates"];
  const parsed: Candidate[] = [];
  if (!Array.isArray(candidates)) {
    issues.push({ at: "candidates", message: 'required array — an empty harvest is written as "candidates": []' });
  } else {
    const seen = new Set<string>();
    candidates.forEach((c, i) => {
      const before = issues.length;
      const cand = parseCandidate(c, `candidates[${i}]`, issues);
      if (cand !== null && issues.length === before) {
        if (seen.has(cand.id)) {
          issues.push({ at: `candidates[${i}].id`, message: `duplicate candidate id "${cand.id}"` });
        } else {
          seen.add(cand.id);
          parsed.push(cand);
        }
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    harvest: {
      schemaVersion: HARVEST_SCHEMA_VERSION,
      subject: (value["subject"] as string).trim(),
      identity: (value["identity"] as string).trim(),
      sources: Object.freeze((sources as string[]).map((s) => s.trim())),
      gatheredAt: gatheredAt as string,
      candidates: Object.freeze(parsed),
    },
  };
}
