/** Syntactic citation guard. Matching wording does not independently verify a claim. */
import type { ClaimCitation, Leaf } from "./leaf.ts";
import { resolveClaimCitation } from "./portfolio.ts";

export const UNSUPPORTED_NUMBER_MESSAGE = "A number is missing from the cited evidence. Nothing saved.";

const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)";
const WORD_NUMBER = new RegExp("(?<![\\p{L}\\p{N}])(?:minus[ -]+|negative[ -]+|plus[ -]+)?" + NUMBER_WORD + "(?:[ -]+(?:and[ -]+)?" + NUMBER_WORD + ")*(?:[ -]+(?:percent|per cent))?(?![\\p{L}\\p{N}])", "giu");
const ORDINAL = /(?<![\p{L}\p{N}])(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|hundredth)(?![\p{L}\p{N}])/giu;
const DIGIT_NUMBER = /(?<![\p{L}\p{N}])(?:(?:minus|negative|plus)[ -]+)?(?:[+\-−]?[$€£]?|[$€£][+\-−]?)\p{Nd}[\p{Nd},]*(?:\.\p{Nd}+)?(?:\/\p{Nd}[\p{Nd},]*(?:\.\p{Nd}+)?)?(?:\s*(?:%|percent|per cent|x|×)|\s+(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?|dollars?|euros?|pounds?))?(?![\p{L}\p{N}])/giu;
const NUMBERED_IDENTIFIER = /(?<![\p{L}\p{N}])[\p{L}\p{N}._-]*\p{Nd}[\p{L}\p{N}._-]*(?![\p{L}\p{N}])/giu;

/** Keep signs, units, ratios and compound words together. Splitting them admits
 * -$10 from $10, twenty-one from separate twenty/one, or 50 percent from 50. */
function numericTokens(value: string): string[] {
  const normalize = (token: string): string => token.toLowerCase()
    .replaceAll(",", "").replaceAll("−", "-")
    .replace(/\s*(?:percent|per cent)$/u, "%")
    .replace(/^(?:minus|negative)[ -]+/u, "-").replace(/^plus[ -]+/u, "+")
    .replace(/[ -]+/gu, "-");
  return [
    ...[...value.matchAll(DIGIT_NUMBER)].map(match => normalize(match[0]!)),
    ...[...value.matchAll(WORD_NUMBER)].map(match => normalize(match[0]!)),
    ...[...value.matchAll(ORDINAL)].map(match => normalize(match[0]!)),
    ...[...value.matchAll(NUMBERED_IDENTIFIER)].map(match => normalize(match[0]!)),
  ];
}

function citedFragments(leaf: Leaf, citation: ClaimCitation): readonly string[] | null {
  const resolved = resolveClaimCitation(leaf, citation);
  if (resolved.status !== "current") return null;
  const sameReference = (source: ClaimCitation["provenance"] | undefined): boolean =>
    source?.source === citation.provenance.source && source.ref === citation.provenance.ref && source.observedAt === citation.provenance.observedAt;
  const record = resolved.leaflet;
  return [
    ...(sameReference(record.provenance) ? [record.title] : []),
    ...(record.body ?? []).filter(element => sameReference(element.provenance)).flatMap(element => element.text ? [element.text] : []),
  ];
}

/** Every number-like phrase in the claim must occur in an exact cited retained
 * title or body element. Separate body elements cannot combine fragments. */
export function citedNumbersSupported(leaf: Leaf, wording: string, citations: readonly ClaimCitation[]): boolean {
  const claimed = numericTokens(wording);
  if (!claimed.length) return true;
  const supported = new Set<string>();
  for (const citation of citations) {
    const fragments = citedFragments(leaf, citation);
    if (fragments === null) return false;
    for (const fragment of fragments) for (const token of numericTokens(fragment)) supported.add(token);
  }
  return claimed.every(number => supported.has(number));
}

export function assertCitedNumbers(leaf: Leaf, wording: string, citations: readonly ClaimCitation[]): void {
  if (citations.some(citation => citedFragments(leaf, citation) === null)) throw new Error("A citation changed. Remove or reselect it.");
  if (!citedNumbersSupported(leaf, wording, citations)) throw new Error(UNSUPPORTED_NUMBER_MESSAGE);
}
