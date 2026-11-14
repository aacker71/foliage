/** Explicitly selected authored context. Citations preserve evidence handles, not verified outcomes. */
import { createHash } from "node:crypto";
import { parsePortfolioPresentation, type PortfolioPresentation, parseLeafDocument, resolveClaimCitation, claimAnchorId, citedNumbersSupported, type Leaf, type LeafProfile, type LeafAchievement, type LeafCollection, type ClaimCitation } from "@foliage/leaf";
import type { PublishedLeaflet } from "./publish.ts";

export interface PublishedPortfolio {
  readonly presentation?: PortfolioPresentation;
  readonly headline?: string;
  readonly profile?: LeafProfile;
  readonly achievements?: readonly LeafAchievement[];
  readonly collections?: readonly LeafCollection[];
}
export interface PortfolioOmission { readonly at: string; readonly reason: string }
type TextIssue = (text: string) => string | null;
const copyCitation = (c: ClaimCitation): ClaimCitation => ({ leaflet: c.leaflet, provenance: { source: c.provenance.source, ref: c.provenance.ref, observedAt: c.provenance.observedAt } });
const citationSafe = (c: ClaimCitation, issue: TextIssue): boolean => [c.leaflet, c.provenance.source, c.provenance.ref, c.provenance.observedAt].every(value => issue(value) === null);
const outwardPresentation = (presentation: PortfolioPresentation): PortfolioPresentation => parsePortfolioPresentation({
  ...(presentation.style ? { style: presentation.style } : {}),
  ...(presentation.collections ? { collections: presentation.collections } : {}),
  ...(presentation.leaflets ? { leaflets: presentation.leaflets } : {}),
});

/** This is called only after visibility, attribution, policy and narrative admission. No
 * missing/private citation is replaced with another. One unavailable citation omits its claim. */
export function projectPublicPortfolio(leaf: Leaf, admitted: readonly PublishedLeaflet[], issue: TextIssue): { portfolio?: PublishedPortfolio; omissions: readonly PortfolioOmission[] } {
  const omissions: PortfolioOmission[] = [];
  const allowed = new Set<string>(admitted.map(record => record.id));
  const safe = (text: string, at: string): boolean => { const reason = issue(text); if (reason) omissions.push({ at, reason }); return reason === null; };
  const profile: { bio?: string; direction?: string; passions?: string[] } = {};
  if (leaf.profile?.bio && safe(leaf.profile.bio, "profile.bio")) profile.bio = leaf.profile.bio;
  if (leaf.profile?.direction && safe(leaf.profile.direction, "profile.direction")) profile.direction = leaf.profile.direction;
  const passions = leaf.profile?.passions?.filter((text, i) => safe(text, `profile.passions[${i}]`));
  if (passions?.length) profile.passions = [...passions];
  const achievements: LeafAchievement[] = [];
  for (const [i, achievement] of (leaf.achievements ?? []).entries()) {
    const at = `achievements[${i}]`;
    if (!safe(achievement.id, `${at}.id`) || !safe(achievement.title, `${at}.title`)) continue;
    const claims = achievement.claims.flatMap((claim, j) => {
      const path = `${at}.claims[${j}]`;
      if (!safe(claim.id, `${path}.id`) || !safe(claim.text, `${path}.text`)) return [];
      if (!claim.citations?.length || !claim.citations.every(c => allowed.has(c.leaflet) && resolveClaimCitation(leaf, c).status === "current" && citationSafe(c, issue))) {
        omissions.push({ at: path, reason: "Every supporting citation must still match retained evidence on an admitted public Leaflet and be safe to share. The entire claim stays private." });
        return [];
      }
      if (!citedNumbersSupported(leaf, claim.text, claim.citations)) {
        omissions.push({ at: path, reason: "A number in this claim is absent from its cited retained evidence. The entire claim stays private." });
        return [];
      }
      return [{ id: claim.id, kind: claim.kind, text: claim.text, citations: claim.citations.map(copyCitation) }];
    });
    if (claims.length) achievements.push({ id: achievement.id, title: achievement.title, claims });
  }
  const achievementIds = new Set(achievements.map(item => item.id));
  const collections: LeafCollection[] = [];
  for (const [i, collection] of (leaf.collections ?? []).entries()) {
    const at = `collections[${i}]`;
    const records = collection.leaflets.filter(id => allowed.has(id));
    const includedAchievements = collection.achievements.filter(id => achievementIds.has(id));
    if (!records.length && !includedAchievements.length) { omissions.push({ at, reason: "This collection has no admitted members, so its name and description stay private." }); continue; }
    if (!safe(collection.id, `${at}.id`) || !safe(collection.title, `${at}.title`)) continue;
    const description = collection.description && safe(collection.description, `${at}.description`) ? collection.description : undefined;
    collections.push({ id: collection.id, title: collection.title, kind: collection.kind, ...(description ? { description } : {}), achievements: includedAchievements, leaflets: records });
  }
  const headline = leaf.headline && safe(leaf.headline, "headline") ? leaf.headline : undefined;
  const publicCollectionIds = new Set(collections.map(item => item.id));
  const presentation = leaf.presentation ? outwardPresentation({ ...leaf.presentation,
    ...(leaf.presentation.collections ? { collections: leaf.presentation.collections.filter(item => publicCollectionIds.has(item.id)) } : {}),
    leaflets: leaf.presentation.leaflets?.filter(item => allowed.has(item.id)) ?? [] }) : undefined;
  const portfolio = { ...(presentation ? { presentation } : {}), ...(headline ? { headline } : {}), ...(Object.keys(profile).length ? { profile } : {}), ...(achievements.length ? { achievements } : {}), ...(collections.length ? { collections } : {}) };
  return { ...(Object.keys(portfolio).length ? { portfolio } : {}), omissions };
}

/** Canonical, allow-listed JSON; private fields can never hitchhike on a structural value. */
export function publicPortfolioJson(portfolio: PublishedPortfolio): Record<string, unknown> {
  return {
    ...(portfolio.presentation ? { presentation: outwardPresentation(portfolio.presentation) } : {}),
    ...(portfolio.headline === undefined ? {} : { headline: portfolio.headline }),
    ...(portfolio.profile ? { profile: { ...(portfolio.profile.bio === undefined ? {} : { bio: portfolio.profile.bio }), ...(portfolio.profile.direction === undefined ? {} : { direction: portfolio.profile.direction }), ...(portfolio.profile.passions === undefined ? {} : { passions: [...portfolio.profile.passions] }) } } : {}),
    ...(portfolio.achievements ? { achievements: portfolio.achievements.map(a => ({ id: a.id, title: a.title, claims: a.claims.map(c => ({ id: c.id, kind: c.kind, text: c.text, citations: (c.citations ?? []).map(copyCitation) })) })) } : {}),
    ...(portfolio.collections ? { collections: portfolio.collections.map(c => ({ id: c.id, title: c.title, kind: c.kind, ...(c.description === undefined ? {} : { description: c.description }), achievements: [...c.achievements], leaflets: [...c.leaflets] })) } : {}),
  };
}

/** Ingest validates the selected receipt structure and admitted targets. Only the publisher
 * can compare against private retained evidence; the reader never claims to repeat that check. */
export function parsePublicPortfolio(value: unknown, context: { id: string; subject: string; leaflets: readonly PublishedLeaflet[] }, issue: TextIssue): { ok: true; portfolio: PublishedPortfolio } | { ok: false; issues: readonly { at: string; message: string }[] } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["headline", "profile", "achievements", "collections", "presentation"].includes(key))) return { ok: false, issues: [{ at: "leaf.portfolio", message: "Expected only the explicitly selected profile, achievements and collections." }] };
  const suppliedPresentation = "presentation" in value ? value["presentation"] : undefined;
  if (suppliedPresentation && typeof suppliedPresentation === "object" && !Array.isArray(suppliedPresentation) && "history" in suppliedPresentation) return { ok: false, issues: [{ at: "leaf.portfolio.presentation.history", message: "Private presentation edit history cannot enter a public portfolio." }] };
  const parsed = parseLeafDocument({ id: context.id, subject: context.subject, ...value, leaflets: context.leaflets.map(l => ({ id: l.id, title: l.title, tier: l.tier, ...(l.provenance ? { provenance: l.provenance } : {}), visibility: "public" })) });
  if (!parsed.ok) return { ok: false, issues: parsed.issues.map(i => ({ at: `leaf.portfolio.${i.at}`, message: i.message })) };
  const leaf = parsed.leaf, allowed = new Set<string>(context.leaflets.map(l => l.id)), achievements = new Set((leaf.achievements ?? []).map(a => a.id));
  const issues: { at: string; message: string }[] = [];
  const checkText = (text: string, at: string): void => { const message = issue(text); if (message) issues.push({ at: `leaf.portfolio.${at}`, message }); };
  if (leaf.headline) checkText(leaf.headline, "headline");
  if (leaf.profile?.bio) checkText(leaf.profile.bio, "profile.bio");
  if (leaf.profile?.direction) checkText(leaf.profile.direction, "profile.direction");
  leaf.profile?.passions?.forEach((text, i) => checkText(text, `profile.passions[${i}]`));
  leaf.achievements?.forEach((a, i) => {
    checkText(a.id, `achievements[${i}].id`); checkText(a.title, `achievements[${i}].title`);
    if (!a.claims.length) issues.push({ at: `leaf.portfolio.achievements[${i}].claims`, message: "A public achievement requires at least one supported claim." });
    a.claims.forEach((c, j) => {
      checkText(c.id, `achievements[${i}].claims[${j}].id`); checkText(c.text, `achievements[${i}].claims[${j}].text`);
      if (!c.citations?.length || !c.citations.every(ref => allowed.has(ref.leaflet) && citationSafe(ref, issue))) issues.push({ at: `leaf.portfolio.achievements[${i}].claims[${j}].citations`, message: "Every public claim requires safe, exact citations to admitted Leaflets." });
    });
  });
  leaf.collections?.forEach((c, i) => {
    checkText(c.id, `collections[${i}].id`); checkText(c.title, `collections[${i}].title`); if (c.description) checkText(c.description, `collections[${i}].description`);
    if (!(c.leaflets.length || c.achievements.length) || c.leaflets.some(id => !allowed.has(id)) || c.achievements.some(id => !achievements.has(id))) issues.push({ at: `leaf.portfolio.collections[${i}]`, message: "A public collection must have admitted members and cannot refer to private or absent records or achievements." });
  });
  if (leaf.presentation?.leaflets?.some(item => !allowed.has(item.id))) issues.push({ at: "leaf.portfolio.presentation", message: "Style overrides may refer only to admitted Leaflets." });
  if (leaf.presentation?.collections?.some(item => !leaf.collections?.some(collection => collection.id === item.id))) issues.push({ at: "leaf.portfolio.presentation", message: "Named Leaf style overrides may refer only to admitted views." });
  if (issues.length) return { ok: false, issues };
  return { ok: true, portfolio: { ...(leaf.presentation ? { presentation: outwardPresentation(leaf.presentation) } : {}), ...(leaf.headline === undefined ? {} : { headline: leaf.headline }), ...(leaf.profile ? { profile: leaf.profile } : {}), ...(leaf.achievements ? { achievements: leaf.achievements } : {}), ...(leaf.collections ? { collections: leaf.collections } : {}) } };
}

export const publicClaimAnchor = claimAnchorId;
export const publicCitationAnchor = (citation: ClaimCitation): string => `citation-${createHash("sha256").update(JSON.stringify([citation.leaflet, citation.provenance.source, citation.provenance.ref, citation.provenance.observedAt])).digest("hex")}`;
