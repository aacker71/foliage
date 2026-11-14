/** Person-written context over retained evidence. No model output, attribution or publication
 * decision is made here. The existing body format carries an explicit, self-describing account. */
import { createHash } from "node:crypto";
import { isIsoInstant, parseLeafDocument, RATING_SHAPED, type BodyElement, type Leaf, type Leaflet, type Provenance, type TextBodyElement } from "@foliage/leaf";
import { parseRevisionTarget, revisionDigest, type RevisionTarget } from "./leafletRevision.ts";
import { provenanceIsPromotedHandle } from "@foliage/photosynthesis";

export const STORY_SECTIONS = Object.freeze([
  { key: "problem", label: "The problem", prompt: "Why it mattered, and to whom." },
  { key: "contribution", label: "My contribution", prompt: "What you did, with whom, how AI helped, and what you checked." },
  { key: "decisions", label: "Decisions & discoveries", prompt: "Choices, experiments or changes of direction that mattered." },
  { key: "outcome", label: "What changed", prompt: "An observed result, or say it is not yet known." },
] as const);

type StorySection = typeof STORY_SECTIONS[number]["key"];
interface StoryInput { readonly section: string; readonly text: string; readonly evidence: number }
export interface SavedStory {
  readonly section: StorySection;
  readonly text: string;
  readonly supporting: Provenance;
  readonly reviewer: string;
  readonly at: string;
  readonly element: TextBodyElement;
}
const PREFIX = "subject:story/";
const MAX_TEXT = 2600;
const MAX_PARAGRAPH = 4000;
const DISCLOSURE = "This is the person's recorded account. Its supporting reference does not independently verify the account or authorship.";
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const referenceKey = (p: Provenance) => JSON.stringify([p.source, p.ref, p.observedAt]);
const sectionFor = (key: string) => STORY_SECTIONS.find(section => section.key === key);
const rating = (value: string) => RATING_SHAPED.test(value) || /\b(?:score|rating|rank|percentile)\s*[:=]\s*\d/i.test(value);

function validReference(value: unknown): value is Provenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).length === 3 && ["source", "ref", "observedAt"].every(key => typeof p[key] === "string" && p[key].trim().length > 0 && p[key].length <= 1024)
    && isIsoInstant(p["observedAt"] as string);
}

/** A story cannot cite itself. Retained original references remain available in document order.
 * A promoted leaflet's provenance is a handle on its first body element, so the element alone is
 * listed: one commit is one reference, under the source that produced it. */
export function storyEvidence(record: Leaflet): readonly Provenance[] {
  const unique = new Map<string, Provenance>();
  const handle = provenanceIsPromotedHandle(record);
  for (const p of [handle ? undefined : record.provenance, ...(record.body ?? []).map(element => element.provenance)]) {
    if (p && validReference(p) && !p.source.startsWith(PREFIX) && p.source !== "photosynthesis:story-review") unique.set(referenceKey(p), p);
  }
  return [...unique.values()];
}

/** Work and Portfolio's source records offer "Tell story" by this one rule: the record is pending
 * and private, and has a reference the story can cite. The story form and save refuse the rest. */
export function canTellStory(record: Leaflet): boolean {
  return record.tier === "pending" && (!record.visibility || record.visibility === "private") && storyEvidence(record).length > 0;
}

/** Only complete, digest-matching convention paragraphs may be edited as stories. Unknown or
 * damaged elements stay ordinary retained evidence; a prefix alone grants no edit authority. */
export function readStoryElement(element: BodyElement): SavedStory | null {
  if ("media" in element || !element.text || !element.provenance.source.startsWith(PREFIX)) return null;
  const section = sectionFor(element.provenance.source.slice(PREFIX.length));
  if (!section || element.text.length > MAX_PARAGRAPH || element.provenance.ref !== digest(element.text)) return null;
  const opening = `${section.label}\n`;
  const divider = "\n\nSupporting evidence: ";
  const split = element.text.lastIndexOf(divider);
  if (!element.text.startsWith(opening) || split < opening.length) return null;
  const text = element.text.slice(opening.length, split);
  if (!text.trim() || text.length > MAX_TEXT) return null;
  const tail = element.text.slice(split + divider.length).split("\n");
  if (tail.length !== 4 || !tail[1]!.startsWith("Account recorded by: ") || !tail[2]!.startsWith("Account recorded at: ") || tail[3] !== DISCLOSURE) return null;
  try {
    const supporting: unknown = JSON.parse(tail[0]!);
    const reviewer: unknown = JSON.parse(tail[1]!.slice("Account recorded by: ".length));
    const at = tail[2]!.slice("Account recorded at: ".length);
    if (!validReference(supporting) || typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 200 || /[\r\n]/.test(reviewer) || !isIsoInstant(at) || element.provenance.observedAt !== at) return null;
    return { section: section.key, text, supporting, reviewer, at, element };
  } catch { return null; }
}

function latestStories(record: Leaflet): readonly SavedStory[] {
  const latest = new Map<StorySection, SavedStory>();
  for (const element of record.body ?? []) {
    const story = readStoryElement(element);
    if (!story) continue;
    const previous = latest.get(story.section);
    if (!previous || Date.parse(story.at) > Date.parse(previous.at)) latest.set(story.section, story);
  }
  return STORY_SECTIONS.flatMap(({ key }) => latest.has(key) ? [latest.get(key)!] : []);
}

/** -1 requires a new explicit evidence choice if the original supporting triple disappeared. */
export function readLeafletStory(record: Leaflet): readonly StoryInput[] {
  const available = storyEvidence(record);
  // A story saved before the handle was folded may cite the handle; it cites the same element.
  const cited = (supporting: Provenance): Provenance => provenanceIsPromotedHandle(record) && referenceKey(supporting) === referenceKey(record.provenance!)
    ? available.find(p => p.ref === supporting.ref && p.observedAt === supporting.observedAt) ?? supporting : supporting;
  return latestStories(record).map(story => ({ section: story.section, text: story.text, evidence: available.findIndex(p => referenceKey(p) === referenceKey(cited(story.supporting))) }));
}

/** Workflow refresh replaces Git excerpts first. Keep the person's account discoverable while
 * retaining every existing body element, including historical or unrecognized material. */
export function storyElements(record: Leaflet): readonly BodyElement[] {
  const leading = latestStories(record).map(story => story.element);
  const chosen = new Set<BodyElement>(leading);
  return [...leading, ...(record.body ?? []).filter(element => !chosen.has(element))];
}

export function applyLeafletStory(leaf: Leaf, target: RevisionTarget, sections: readonly StoryInput[], reviewer: string, confirmedSubject: string, at: string): Leaf {
  const parsedTarget = parseRevisionTarget(target);
  if (parsedTarget.leafId !== leaf.id || confirmedSubject !== leaf.subject) throw new Error("Confirm the subject exactly.");
  const record = leaf.leaflets.find(item => item.id === parsedTarget.leafletId);
  if (!record || revisionDigest(record) !== parsedTarget.revision) throw new Error("Leaflet changed. Reopen.");
  if (record.tier !== "pending" || record.visibility && record.visibility !== "private") throw new Error("Only pending, private Leaflets can receive this account.");
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 200 || /[\r\n]/.test(reviewer)) throw new Error("Provide the name of the person recording this account, on one line.");
  if (typeof at !== "string" || !isIsoInstant(at)) throw new Error("The account needs a valid recorded instant with a timezone.");
  if (!Array.isArray(sections) || sections.length > STORY_SECTIONS.length) throw new Error("Choose each of the four story sections at most once.");
  const available = storyEvidence(record);
  const written = new Map<StorySection, TextBodyElement>();
  const seen = new Set<string>();
  for (const input of sections) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3 || !["section", "text", "evidence"].every(key => key in input)) throw new Error("Unexpected story section fields.");
    const definition = typeof input.section === "string" ? sectionFor(input.section) : undefined;
    if (!definition || seen.has(input.section)) throw new Error("Choose each known story section at most once.");
    seen.add(input.section);
    if (typeof input.text !== "string" || input.text.length > MAX_TEXT) throw new Error(`Keep each story section to ${MAX_TEXT} characters or fewer.`);
    const text = input.text.trim();
    if (!text) continue;
    if (rating(text)) throw new Error("No scores, ratings or rankings.");
    if (!Number.isSafeInteger(input.evidence) || input.evidence < 0 || !available[input.evidence]) throw new Error("Choose a supporting reference for each section.");
    const supporting = available[input.evidence]!;
    const paragraph = `${definition.label}\n${text}\n\nSupporting evidence: ${JSON.stringify(supporting)}\nAccount recorded by: ${JSON.stringify(reviewer.trim())}\nAccount recorded at: ${at}\n${DISCLOSURE}`;
    if (paragraph.length > MAX_PARAGRAPH) throw new Error("Too long. Shorten it.");
    written.set(definition.key, { text: paragraph, provenance: { source: `${PREFIX}${definition.key}`, ref: digest(paragraph), observedAt: at } });
  }
  if (!written.size) throw new Error("Write one section and choose its reference.");
  const context = STORY_SECTIONS.flatMap(({ key }) => written.has(key) ? [written.get(key)!] : []);
  const retained = (record.body ?? []).filter(element => { const story = readStoryElement(element); return !story || !written.has(story.section); });
  const changed = { ...record, body: [...context, ...retained] };
  const result = parseLeafDocument({ ...leaf, leaflets: leaf.leaflets.map(item => item.id === record.id ? changed : item) });
  if (!result.ok) throw new Error("The account failed the Leaf document gate. Nothing saved.");
  return result.leaf;
}
