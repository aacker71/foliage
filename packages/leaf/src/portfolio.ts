/** Resolve authored context against today's retained evidence without editing either. */
import { isSubjectsOwnWork, type AchievementClaim, type ClaimCitation, type Leaf,
  type LeafAchievement, type LeafCollection, type Leaflet, type LeafletId,
  type Provenance, type SubjectsOwnLeaflet } from "./leaf.ts";

/** IDs are portable ASCII in the document contract. Length-prefixing the first component
 * keeps (a-b,c) distinct from (a,b-c), without URI escapes inside a DOM identifier. */
export const claimAnchorId = (achievementId: string, claimId: string): string => `claim-${achievementId.length}-${achievementId}-${claimId}`;

export type ClaimCitationResolution =
  | { readonly status: "current"; readonly citation: ClaimCitation; readonly leaflet: SubjectsOwnLeaflet; readonly provenance: Provenance }
  | { readonly status: "stale"; readonly citation: ClaimCitation; readonly leaflet: SubjectsOwnLeaflet; readonly reason: string }
  | { readonly status: "missing"; readonly citation: ClaimCitation; readonly reason: string }
  | { readonly status: "excluded"; readonly citation: ClaimCitation; readonly leaflet: Extract<Leaflet, { tier: "excluded" }>; readonly reason: string };

/** Current means only that the exact source/ref/observation tuple is still retained on this
 * subject's record. It does not verify the claim text, an outcome, or cryptographic authorship. */
export function resolveClaimCitation(leaf: Leaf, citation: ClaimCitation): ClaimCitationResolution {
  const record = leaf.leaflets.find(item => item.id === citation.leaflet);
  if (!record) return { status: "missing", citation, reason: "The cited Leaflet is no longer in this Leaf. The saved citation is retained for review." };
  if (!isSubjectsOwnWork(record)) return { status: "excluded", citation, leaflet: record, reason: record.reason };
  const wanted = citation.provenance;
  const match = [record.provenance, ...(record.body ?? []).map(element => element.provenance)]
    .find(ref => ref?.source === wanted.source && ref.ref === wanted.ref && ref.observedAt === wanted.observedAt);
  return match
    ? { status: "current", citation, leaflet: record, provenance: match }
    : { status: "stale", citation, leaflet: record, reason: "The cited source, reference and observation no longer match retained evidence on this Leaflet. Review the citation." };
}

export function resolveClaimCitations(leaf: Leaf, claim: AchievementClaim): readonly ClaimCitationResolution[] {
  return (claim.citations ?? []).map(citation => resolveClaimCitation(leaf, citation));
}

export interface ResolvedLeafCollection {
  readonly collection: LeafCollection;
  readonly achievements: readonly LeafAchievement[];
  /** Only the explicitly selected, currently attributable records, in saved order. */
  readonly leaflets: readonly SubjectsOwnLeaflet[];
  readonly unavailableAchievements: readonly string[];
  readonly unavailableLeaflets: readonly { readonly id: LeafletId; readonly status: "missing" | "excluded"; readonly reason: string }[];
}

/** Missing members remain in the saved collection. No substitute is chosen and no citation
 * outside its explicit record list is silently added as a new collection member. */
export function resolveLeafCollection(leaf: Leaf, id: string): ResolvedLeafCollection | null {
  const collection = leaf.collections?.find(item => item.id === id);
  if (!collection) return null;
  const achievements = new Map((leaf.achievements ?? []).map(item => [item.id, item]));
  const records = new Map(leaf.leaflets.map(item => [item.id, item]));
  const included: SubjectsOwnLeaflet[] = [];
  const unavailable: ResolvedLeafCollection["unavailableLeaflets"][number][] = [];
  for (const recordId of collection.leaflets) {
    const record = records.get(recordId);
    if (!record) unavailable.push({ id: recordId, status: "missing", reason: "The selected Leaflet is no longer in this Leaf." });
    else if (!isSubjectsOwnWork(record)) unavailable.push({ id: recordId, status: "excluded", reason: record.reason });
    else included.push(record);
  }
  return { collection,
    achievements: collection.achievements.flatMap(key => achievements.has(key) ? [achievements.get(key)!] : []),
    leaflets: included, unavailableAchievements: collection.achievements.filter(key => !achievements.has(key)),
    unavailableLeaflets: unavailable };
}

/** Presentation choices are separate from source evidence. No free CSS, URLs or scores. */
export interface PortfolioStyle {
  readonly typography?: "editorial" | "clean";
  readonly spacing?: "airy" | "compact";
  /** Source keeps categorical origin colors; quiet uses one restrained botanical tone. */
  readonly palette?: "source" | "quiet";
  /** Branching alternates around the rachis; linear keeps every reading panel on one side. */
  readonly layout?: "branching" | "linear";
  /** Split pairs the introduction with direction; stacked gives the opening one reading column. */
  readonly hero?: "split" | "stacked";
  /** Contained keeps images bounded; immersive lets admitted media fill the Leaflet panel width. */
  readonly media?: "contained" | "immersive";
}
export interface PortfolioStyleEdit {
  readonly id: string;
  readonly at: string;
  readonly actor: "manual" | "agent";
  readonly scope: "portfolio" | "collection" | "leaflet";
  readonly target?: string;
  readonly before: PortfolioStyle;
  readonly after: PortfolioStyle;
}
export interface PortfolioPresentation {
  readonly style?: PortfolioStyle;
  /** Named Leaf views inherit the portfolio style and may override either preset. */
  readonly collections?: readonly { readonly id: string; readonly style: PortfolioStyle }[];
  readonly leaflets?: readonly { readonly id: string; readonly style: PortfolioStyle }[];
  /** Newest first. Applying an older value creates another entry instead of rewriting history. */
  readonly history?: readonly PortfolioStyleEdit[];
}
export function parsePortfolioPresentation(value: unknown): PortfolioPresentation {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const style = (v: unknown): PortfolioStyle => {
    if (!object(v) || Object.keys(v).some(k => !["typography", "spacing", "palette", "layout", "hero", "media"].includes(k)) ||
      ("typography" in v && !["editorial", "clean"].includes(v["typography"] as string)) ||
      ("spacing" in v && !["airy", "compact"].includes(v["spacing"] as string)) ||
      ("palette" in v && !["source", "quiet"].includes(v["palette"] as string)) ||
      ("layout" in v && !["branching", "linear"].includes(v["layout"] as string)) ||
      ("hero" in v && !["split", "stacked"].includes(v["hero"] as string)) ||
      ("media" in v && !["contained", "immersive"].includes(v["media"] as string))) throw new Error("Choose supported typography, rhythm, palette, layout, hero and media presets.");
    return { ...(v["typography"] ? { typography: v["typography"] as NonNullable<PortfolioStyle["typography"]> } : {}), ...(v["spacing"] ? { spacing: v["spacing"] as NonNullable<PortfolioStyle["spacing"]> } : {}), ...(v["palette"] ? { palette: v["palette"] as NonNullable<PortfolioStyle["palette"]> } : {}), ...(v["layout"] ? { layout: v["layout"] as NonNullable<PortfolioStyle["layout"]> } : {}), ...(v["hero"] ? { hero: v["hero"] as NonNullable<PortfolioStyle["hero"]> } : {}), ...(v["media"] ? { media: v["media"] as NonNullable<PortfolioStyle["media"]> } : {}) };
  };
  if (!object(value) || Object.keys(value).some(k => !["style", "collections", "leaflets", "history"].includes(k))) throw new Error("Presentation accepts only portfolio, named Leaf and Leaflet styles and their edit history.");
  const overrides = (key: "collections" | "leaflets", limit: number) => {
    const result: { id: string; style: PortfolioStyle }[] = [];
    if (!(key in value)) return undefined;
    if (!Array.isArray(value[key]) || value[key].length > limit) throw new Error(`At most ${limit} ${key === "collections" ? "named Leaf" : "Leaflet"} style overrides are supported.`);
    for (const item of value[key]) {
      if (!object(item) || Object.keys(item).some(k => !["id", "style"].includes(k)) || typeof item["id"] !== "string" || !item["id"].trim() || item["id"].length > 300 || result.some(v => v.id === item["id"])) throw new Error(`Each ${key === "collections" ? "named Leaf" : "Leaflet"} override requires a unique target id.`);
      result.push({ id: item["id"], style: style(item["style"]) });
    }
    return result;
  };
  const collections = overrides("collections", 24), leaflets = overrides("leaflets", 512);
  let history: PortfolioStyleEdit[] | undefined;
  if ("history" in value) {
    if (!Array.isArray(value["history"]) || value["history"].length > 48) throw new Error("At most 48 presentation style changes are retained.");
    const historyValue = value["history"];
    history = historyValue.map((entry, index) => {
      if (!object(entry) || Object.keys(entry).some(k => !["id", "at", "actor", "scope", "target", "before", "after"].includes(k)) ||
        typeof entry["id"] !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(entry["id"]) || historyValue.slice(0, index).some(previous => object(previous) && previous["id"] === entry["id"]) ||
        typeof entry["at"] !== "string" || !Number.isFinite(Date.parse(entry["at"])) || !["manual", "agent"].includes(entry["actor"] as string) ||
        !["portfolio", "collection", "leaflet"].includes(entry["scope"] as string) ||
        (entry["scope"] === "portfolio" ? "target" in entry : typeof entry["target"] !== "string" || !entry["target"].trim() || entry["target"].length > 300)) throw new Error("Presentation history contains an invalid style change.");
      return { id: entry["id"], at: entry["at"], actor: entry["actor"], scope: entry["scope"], ...(entry["scope"] === "portfolio" ? {} : { target: entry["target"] }), before: style(entry["before"]), after: style(entry["after"]) } as PortfolioStyleEdit;
    });
  }
  return { ...("style" in value ? { style: style(value["style"]) } : {}), ...(collections ? { collections } : {}), ...(leaflets ? { leaflets } : {}), ...(history ? { history } : {}) };
}
export function portfolioStyle(presentation?: PortfolioPresentation, id?: string, collectionId?: string): Required<PortfolioStyle> {
  return { typography: "editorial", spacing: "airy", palette: "source", layout: "branching", hero: "split", media: "contained", ...presentation?.style,
    ...(collectionId ? presentation?.collections?.find(item => item.id === collectionId)?.style : {}),
    ...(id ? presentation?.leaflets?.find(item => item["id"] === id)?.style : {}) };
}
/** Shared manual/agent operation. Empty style resets the target to inherited defaults. */
export function editPortfolioStyle(leaf: Leaf, target: string | undefined, value: unknown, collectionId?: string): Leaf {
  const style = parsePortfolioPresentation({ style: value }).style!;
  if (target && collectionId) throw new Error("Choose either a named Leaf or a Leaflet before changing its presentation.");
  if (target && !leaf.leaflets.some(item => item["id"] === target && item.tier !== "excluded")) throw new Error("Choose an available Leaflet before changing its presentation.");
  if (collectionId && !leaf.collections?.some(item => item.id === collectionId)) throw new Error("Choose an available named Leaf before changing its presentation.");
  const presentation = leaf.presentation ?? {};
  if (target) return { ...leaf, presentation: { ...presentation, leaflets: [...(presentation.leaflets?.filter(item => item.id !== target) ?? []), ...(Object.keys(style).length ? [{ id: target, style }] : [])] } };
  if (collectionId) return { ...leaf, presentation: { ...presentation, collections: [...(presentation.collections?.filter(item => item.id !== collectionId) ?? []), ...(Object.keys(style).length ? [{ id: collectionId, style }] : [])] } };
  return { ...leaf, presentation: { ...presentation, style } };
}

/** Record one bounded style operation in the canonical Leaf document. The caller supplies time
 * and id so deterministic domain tests do not depend on clocks or randomness. */
export function recordPortfolioStyleEdit(leaf: Leaf, target: string | undefined, value: unknown, actor: PortfolioStyleEdit["actor"], at: string, id: string, collectionId?: string): Leaf {
  const scope = target ? "leaflet" : collectionId ? "collection" : "portfolio";
  const before = target ? leaf.presentation?.leaflets?.find(item => item.id === target)?.style ?? {} : collectionId ? leaf.presentation?.collections?.find(item => item.id === collectionId)?.style ?? {} : leaf.presentation?.style ?? {};
  const changed = editPortfolioStyle(leaf, target, value, collectionId);
  const after = target ? changed.presentation?.leaflets?.find(item => item.id === target)?.style ?? {} : collectionId ? changed.presentation?.collections?.find(item => item.id === collectionId)?.style ?? {} : changed.presentation?.style ?? {};
  if (JSON.stringify(before) === JSON.stringify(after)) return changed;
  const entry: PortfolioStyleEdit = { id, at, actor, scope, ...(scope === "portfolio" ? {} : { target: (target ?? collectionId)! }), before, after };
  return { ...changed, presentation: { ...changed.presentation, history: [entry, ...(leaf.presentation?.history ?? [])].slice(0, 48) } };
}
