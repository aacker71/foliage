/** Declared external observations enter the existing review queue, without provider authority. */
import { createHash } from "node:crypto";
import { isIsoInstant, RATING_SHAPED, type Leaf } from "@foliage/leaf";
import {
  harvestCandidateId, parseHarvestDocument, reviewSubjectDigest, withCandidates,
  type HarvestCandidate, type HarvestDocument,
} from "./harvestDocument.ts";

/** Safe, content-free admission diagnostics suitable for an assistant tool response. */
export class ObservationImportError extends Error {}

export const OBSERVATION_INPUT_BYTES = 1024 * 1024;
export const IMPORT_DOCUMENT_BYTES = 8 * 1024 * 1024;
const INTEGRATION_EXTRACTOR = "integration-observation-import:v1";
/** `maxObservedAtAheadMinutes`: observedAt comes from another machine's clock (an assistant host,
 * a provider). Ten minutes covers ordinary drift between two unsynchronised clocks — double the
 * five-minute tolerance Kerberos uses — because a false refusal turns away the whole batch. Later
 * than that is a time that has not happened yet, and it would show as the draft's date in review. */
export const OBSERVATION_LIMITS = { maxObservations: 100, maxTitleCharacters: 2000, maxExcerptCharacters: 16_000, maxObservedAtAheadMinutes: 10 } as const;

/** The immutable record namespace survives a reviewer's title/extractor edits. This identifies
 * local import ownership and disclosure only; it never authenticates a provider or a person. */
export function isImportedObservationCandidate(candidate: {
  readonly id: string;
  readonly evidence: readonly { readonly source: string; readonly ref: string }[];
}): boolean {
  if (!/^integration:[a-f0-9]{64}$/.test(candidate.id) || candidate.evidence.length !== 1) return false;
  const evidence = candidate.evidence[0]!;
  if (!evidence.ref.startsWith("integration-record:")) return false;
  const serialized = evidence.ref.slice("integration-record:".length);
  let namespace: unknown;
  try { namespace = JSON.parse(serialized); } catch { return false; }
  if (!Array.isArray(namespace) || namespace.length !== 5 ||
    namespace.some((value, i) => !(i === 1 && value === null) && typeof value !== "string") ||
    JSON.stringify(namespace) !== serialized) return false;
  return evidence.source === `integration:${namespace[0]}` &&
    candidate.id === `integration:${createHash("sha256").update(serialized).digest("hex")}`;
}

interface Observation {
  readonly recordId: string;
  readonly revision: string;
  readonly title: string;
  readonly excerpt: string;
  readonly observedAt: string;
}
export interface ObservationBatch {
  readonly format: "foliage-observations";
  readonly version: 1;
  readonly subject: { readonly leafId: string; readonly name: string };
  readonly source: { readonly provider: string; readonly tenantId: string | null; readonly accountId: string };
  readonly completion: "complete";
  readonly deletedRecordIds: readonly [];
  readonly observations: readonly Observation[];
}

function record(value: unknown, keys: readonly string[], at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ObservationImportError(`${at} must be an object.`);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key))) {
    throw new ObservationImportError(`${at} has missing or unsupported fields; credentials, provider payloads and review/proof assertions are not accepted.`);
  }
  return v;
}
function text(value: unknown, max: number, at: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new ObservationImportError(`${at} must be nonempty bounded text without control characters.`);
  }
  return value;
}
function opaque(value: unknown, at: string): string {
  const s = text(value, 200, at);
  if (!/^[A-Za-z0-9._:+/=-]+$/.test(s) || s.includes("://")) throw new ObservationImportError(`${at} must be an opaque identifier, not a URL, email address or credential-bearing reference.`);
  return s;
}

/** A complete selected batch is not a claim that the entire upstream account was read. */
export function parseObservationBatch(value: unknown): ObservationBatch {
  const v = record(value, ["format", "version", "subject", "source", "completion", "deletedRecordIds", "observations"], "batch");
  if (v["format"] !== "foliage-observations" || v["version"] !== 1) throw new ObservationImportError("Unsupported observation batch format/version.");
  const subject = record(v["subject"], ["leafId", "name"], "subject");
  const source = record(v["source"], ["provider", "tenantId", "accountId"], "source");
  const provider = text(source["provider"], 64, "source.provider");
  if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw new ObservationImportError("source.provider must be a lowercase provider label; it is declared, not authenticated.");
  if (v["completion"] === "partial") throw new ObservationImportError("Partial acquisition is unsupported; no observations were imported and existing candidates remain unchanged.");
  if (v["completion"] !== "complete") throw new ObservationImportError("completion must explicitly describe complete or partial acquisition.");
  if (!Array.isArray(v["deletedRecordIds"])) throw new ObservationImportError("deletedRecordIds must be an array.");
  if (v["deletedRecordIds"].length !== 0) throw new ObservationImportError("Deletion-bearing batches are unsupported; nothing was imported, superseded or revoked. Existing artifacts are unchanged.");
  if (!Array.isArray(v["observations"]) || v["observations"].length > OBSERVATION_LIMITS.maxObservations) throw new ObservationImportError(`observations must be an array of at most ${OBSERVATION_LIMITS.maxObservations} records.`);
  const seen = new Set<string>();
  const observations = v["observations"].map((raw, i): Observation => {
    const at = `observations[${i}]`;
    const o = record(raw, ["recordId", "revision", "title", "excerpt", "observedAt"], at);
    const recordId = opaque(o["recordId"], `${at}.recordId`);
    const revision = opaque(o["revision"], `${at}.revision`);
    const key = JSON.stringify([recordId, revision]);
    if (seen.has(key)) throw new ObservationImportError(`${at} repeats a record/revision within this batch.`);
    seen.add(key);
    const observedAt = text(o["observedAt"], 64, `${at}.observedAt`);
    if (!isIsoInstant(observedAt)) throw new ObservationImportError(`${at}.observedAt must be an ISO instant with an offset.`);
    const title = text(o["title"], OBSERVATION_LIMITS.maxTitleCharacters, `${at}.title`);
    if (RATING_SHAPED.test(title)) throw new ObservationImportError(`${at}.title is rating-shaped; no observations were imported.`);
    return { recordId, revision, title,
      excerpt: text(o["excerpt"], OBSERVATION_LIMITS.maxExcerptCharacters, `${at}.excerpt`), observedAt };
  });
  return { format: "foliage-observations", version: 1,
    subject: { leafId: text(subject["leafId"], 512, "subject.leafId"), name: text(subject["name"], 512, "subject.name") },
    source: { provider, tenantId: source["tenantId"] === null ? null : opaque(source["tenantId"], "source.tenantId"), accountId: opaque(source["accountId"], "source.accountId") },
    completion: "complete", deletedRecordIds: [], observations };
}

/** The caller supplies the import clock, so this stays pure. One future record refuses the batch. */
export function refuseFutureObservations(batch: ObservationBatch, importedAt: Date): void {
  const latest = importedAt.getTime() + OBSERVATION_LIMITS.maxObservedAtAheadMinutes * 60_000;
  batch.observations.forEach((observation, i) => {
    if (Date.parse(observation.observedAt) > latest) throw new ObservationImportError(`observations[${i}].observedAt is in the future (more than ${OBSERVATION_LIMITS.maxObservedAtAheadMinutes} minutes after this import); no observations were imported. Use the time the record was actually observed.`);
  });
}

/** Stable revision snapshots append; absence and a new revision never delete or supersede. */
export function importObservationBatch(batch: ObservationBatch, target: Leaf, previous: HarvestDocument | null): {
  readonly document: HarvestDocument;
  readonly persisted: readonly string[];
  readonly unchanged: readonly string[];
} {
  if (batch.subject.leafId !== target.id || batch.subject.name !== target.subject) throw new ObservationImportError("The declared subject does not match the selected leaf; no attribution was inferred.");
  if (previous !== null && (
    previous.subject !== undefined && previous.subject !== target.subject ||
    previous.leafId !== undefined && previous.leafId !== target.id ||
    previous.candidates.length > 0 && (previous.subject === undefined || previous.leafId === undefined)
  )) throw new ObservationImportError("The existing harvest has a different or incomplete subject binding; it was preserved.");
  const candidates = [...(previous?.candidates ?? [])];
  const existing = new Map(candidates.map(candidate => [String(candidate.id), candidate]));
  const persisted: string[] = [];
  const unchanged: string[] = [];
  for (const observation of batch.observations) {
    const namespace = JSON.stringify([batch.source.provider, batch.source.tenantId, batch.source.accountId, observation.recordId, observation.revision]);
    const id = `integration:${createHash("sha256").update(namespace).digest("hex")}`;
    const candidate: HarvestCandidate = {
      id: harvestCandidateId(id), title: observation.title,
      evidence: [{ source: `integration:${batch.source.provider}`, ref: `integration-record:${namespace}`,
        observedAt: observation.observedAt, excerpt: observation.excerpt }],
      extractor: INTEGRATION_EXTRACTOR, draftedAt: observation.observedAt, review: { state: "candidate" },
    };
    const prior = existing.get(id);
    if (prior !== undefined) {
      if (reviewSubjectDigest(prior) !== reviewSubjectDigest(candidate)) throw new ObservationImportError("A record/revision already exists with different material, possibly a locally edited title; the entire batch was refused and prior decisions preserved.");
      unchanged.push(id); // Keep the entire original object, including clocks and review.
    } else {
      candidates.push(candidate);
      persisted.push(id);
    }
  }
  const document = withCandidates({ ...previous, subject: target.subject, leafId: target.id }, candidates);
  const checked = parseHarvestDocument(document);
  if (!checked.ok) throw new ObservationImportError("Imported observations do not meet the existing harvest contract; nothing was written.");
  return { document: checked.harvest, persisted, unchanged };
}
