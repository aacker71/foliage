/** A transport projection of an admitted publication, never a second career document. */
import { publicClaimAnchor, publicCitationAnchor } from "./publicPortfolio.ts";
import { ACHIEVEMENT_CLAIM_LABELS } from "@foliage/leaf";
import type { PublishedLeafDocument } from "./publishedDocument.ts";

export function distributionProjection(document: PublishedLeafDocument, origin: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.origin !== origin) throw new Error("Distribution requires the configured HTTPS publication origin.");
  const url = `${origin}/leaf/${encodeURIComponent(document.leaf.id)}`;
  const portfolio = document.leaf.portfolio;
  return {
    format: "foliage-distribution" as const, version: 1 as const,
    subject: { id: String(document.leaf.id), name: document.leaf.subject },
    url, resumeUrl: `${url}/resume`, publishedAt: document.publishedAt,
    ...(portfolio?.headline ? { headline: portfolio.headline } : {}),
    ...(portfolio?.profile?.bio ? { bio: portfolio.profile.bio } : {}),
    ...(portfolio?.profile?.direction ? { direction: portfolio.profile.direction } : {}),
    achievements: (portfolio?.achievements ?? []).map(a => ({ id: a.id, title: a.title,
      claims: a.claims.map(c => ({ id: c.id, kind: c.kind, text: c.text,
        url: `${url}#${publicClaimAnchor(a.id, c.id)}`,
        citations: (c.citations ?? []).map(ref => ({ leaflet: String(ref.leaflet),
          url: `${url}#${publicCitationAnchor(ref)}`, source: ref.provenance.source,
          ref: ref.provenance.ref, observedAt: ref.provenance.observedAt })) })) })),
    limitation: "Citations identify admitted supporting evidence. They do not independently verify an outcome or establish capability.",
  };
}
export type DistributionProjection = ReturnType<typeof distributionProjection>;
const md = (value: string) => value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, "\\$&");
export function distributionMarkdown(view: DistributionProjection): string {
  const lines = [`# ${md(view.subject.name)}`, "", ...(view.headline ? [md(view.headline), ""] : []),
    ...(view.bio ? [md(view.bio), ""] : []), ...(view.direction ? [md(view.direction), ""] : []),
    `[Live portfolio](${view.url}) · [Current résumé](${view.resumeUrl})`, "", `Published: ${md(view.publishedAt)}`, ""];
  for (const achievement of view.achievements) {
    lines.push(`## ${md(achievement.title)}`, "");
    for (const claim of achievement.claims) {
      lines.push(`- **${md(ACHIEVEMENT_CLAIM_LABELS[claim.kind])}:** ${md(claim.text)} [Claim](${claim.url})`);
      for (const [i, citation] of claim.citations.entries()) lines.push(`  - [Evidence ${i + 1}](${citation.url}): ${md(citation.source)} · ${md(citation.ref)} · observed ${md(citation.observedAt)}`);
    }
    lines.push("");
  }
  if (!view.achievements.length) lines.push("No achievement statements have been published yet.", "");
  lines.push(view.limitation, "", "This download is a snapshot. Follow the live links for current availability and corrections.", "");
  return lines.join("\n");
}
