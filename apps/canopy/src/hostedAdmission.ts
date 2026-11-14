/**
 * Admission of a deliberately reviewed v3/v4 publication, not verification of source authorship.
 * Identity comes from hostedIdentity.getUser; owner comes from current server authority.
 * A client signature over JSON proves no attribution. Verified claims need an internally
 * minted source-verification capability; never silently relabel them or change the codec.
 * The transaction must recheck ownership, policy, revision and generation after staging.
 */
import { DOCUMENT_DIGEST, PUBLISHED_ID, documentDigest, parsePublishedDocument, toArtifactJson, type PublishedLeafDocument } from "@foliage/canopy";
import type { HostedActor } from "./hostedIdentity.ts";
import { isHostedGitHubVerification, type HostedGitHubVerification } from "./hostedGitHubProof.ts";

export const MAX_ADMISSION_BYTES = 1024 * 1024;
export interface PublicationConsent {
  readonly intent: "publish";
  readonly operationId: string;
  readonly subjectId: string;
  readonly artifactDigest: string;
  readonly policyDigest: string;
  readonly expectedRevisionId: string | null;
  readonly expectedGeneration: number;
}
export interface VerifiedPublicationAdmission {
  readonly actorId: string;
  readonly subjectId: string;
  readonly operationId: string;
  readonly artifactDigest: string;
  readonly policyDigest: string;
  readonly expectedRevisionId: string | null;
  readonly expectedGeneration: number;
  readonly admissionId: string;
  readonly consentId: string;
  readonly sourceVerification?: HostedGitHubVerification;
}
export class HostedAdmissionError extends Error {
  readonly code: "invalid-artifact" | "forbidden" | "consent-mismatch" | "verification-required";
  constructor(code: HostedAdmissionError["code"], message: string) { super(message); this.code = code; }
}
const refuse = (code: HostedAdmissionError["code"], message: string): never => { throw new HostedAdmissionError(code, message); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const CONSENT_KEYS = new Set(["intent", "operationId", "subjectId", "artifactDigest", "policyDigest", "expectedRevisionId", "expectedGeneration"]);

/** The exact canonical representation shared by preview, admission and immutable storage. */
export function publicationBytes(document: PublishedLeafDocument): Buffer {
  return Buffer.from(JSON.stringify(toArtifactJson(document)), "utf8");
}
export function admitPublication(input: {
  actor: HostedActor;
  owner: { actorId: string; subjectId: string };
  document: unknown;
  consent: PublicationConsent;
  verification?: unknown;
}): { document: PublishedLeafDocument; admission: VerifiedPublicationAdmission } {
  const { actor, owner, consent } = input;
  if (!actor || !owner || !uuid(actor.id) || actor.id !== owner.actorId || !PUBLISHED_ID.test(owner.subjectId)) {
    return refuse("forbidden", "This account cannot publish that subject.");
  }
  if (!object(consent) || Object.keys(consent).length !== CONSENT_KEYS.size || Object.keys(consent).some(key => !CONSENT_KEYS.has(key)) ||
      consent.intent !== "publish" || !uuid(consent.operationId) || consent.subjectId !== owner.subjectId ||
      !DOCUMENT_DIGEST.test(consent.artifactDigest) || !DOCUMENT_DIGEST.test(consent.policyDigest) ||
      !(consent.expectedRevisionId === null || uuid(consent.expectedRevisionId)) ||
      !Number.isSafeInteger(consent.expectedGeneration) || consent.expectedGeneration < 0) {
    return refuse("consent-mismatch", "Review changed. Review again.");
  }
  let value: unknown;
  try {
    const json = JSON.stringify(input.document);
    if (json === undefined || Buffer.byteLength(json) > MAX_ADMISSION_BYTES) return refuse("invalid-artifact", "The publication exceeds the supported admission size or is not JSON.");
    value = JSON.parse(json) as unknown;
  } catch (error) {
    if (error instanceof HostedAdmissionError) throw error;
    return refuse("invalid-artifact", "The publication is not a supported JSON document.");
  }
  if (!object(value) || ![3, 4, 5, 6, 7].includes(Number(value["artifactVersion"]))) return refuse("invalid-artifact", "Unsupported format. Export again.");
  const parsed = parsePublishedDocument(value);
  if (!parsed.ok) return refuse("invalid-artifact", "Failed format or disclosure checks. Review locally.");
  const document = parsed.document;
  if (String(document.leaf.id) !== owner.subjectId) return refuse("forbidden", "This account cannot publish that subject.");
  const artifactDigest = documentDigest(publicationBytes(document));
  if (artifactDigest !== consent.artifactDigest || document.source.policyDigest !== consent.policyDigest) {
    return refuse("consent-mismatch", "Content changed. Review again.");
  }
  const verification = input.verification;
  const verified = isHostedGitHubVerification(verification) && verification.actorId === actor.id && verification.artifactDigest === artifactDigest;
  if ((verification !== undefined && !verified) || (document.leaf.leaflets.some(leaflet => leaflet.tier === "verified") && !verified)) {
    return refuse("verification-required", "Verified entries need source verification. Nothing published.");
  }
  const binding = [actor.id, owner.subjectId, consent.operationId, artifactDigest, consent.policyDigest, consent.expectedRevisionId, consent.expectedGeneration];
  return { document, admission: Object.freeze({
    actorId: actor.id, subjectId: owner.subjectId, operationId: consent.operationId,
    artifactDigest, policyDigest: consent.policyDigest, expectedRevisionId: consent.expectedRevisionId,
    expectedGeneration: consent.expectedGeneration,
    admissionId: documentDigest(Buffer.from(JSON.stringify(["foliage-hosted-admission-v1", verified ? verification.verificationId : "pending-only", ...binding]))),
    consentId: documentDigest(Buffer.from(JSON.stringify(["foliage-publication-consent-v1", "publish", ...binding]))),
    ...(verified ? { sourceVerification: verification } : {}),
  }) };
}
