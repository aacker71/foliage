/** Private reflection is a projection of retained changes, never a new work record or activity score. */
import { ACHIEVEMENT_CLAIM_LABELS, claimAnchorId, resolveClaimCitation, type Leaf, type AchievementClaim } from '@foliage/leaf';
import { page, esc } from './render.ts';
import type { LeafLoad } from './leafDocument.ts';
import { LeafLoadError } from './loadLabels.ts';

/** Half-open edit-time window. Keep only current statements whose net content changed. */
export function workReflection(leaf: Leaf, since: string, until: string) {
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 31 * 86400_000) throw new Error('Choose a reflection window of up to 31 days.');
  const edits = (leaf.journeyHistory ?? []).filter(edit => Date.parse(edit.at) >= start && Date.parse(edit.at) < end)
    .slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const changed = new Map<string, { before: AchievementClaim | undefined; at: string; actor: 'manual' | 'agent' }>();
  for (const edit of edits) for (const claim of edit.after.claims) {
    const before = edit.before?.claims.find(item => item.id === claim.id);
    if (JSON.stringify(before) === JSON.stringify(claim)) continue;
    const key = JSON.stringify([edit.achievement, claim.id]);
    const previous = changed.get(key);
    changed.set(key, { before: previous ? previous.before : before, at: edit.at, actor: edit.actor });
  }
  const journeys = (leaf.achievements ?? []).flatMap(achievement => {
    const statements = achievement.claims.flatMap(claim => {
      const change = changed.get(JSON.stringify([achievement.id, claim.id]));
      if (!change || JSON.stringify(change.before) === JSON.stringify(claim)) return [];
      // Do not attribute a later correction to an earlier reflection window.
      if ((leaf.journeyHistory ?? []).some(edit => edit.achievement === achievement.id && Date.parse(edit.at) >= end &&
        JSON.stringify(edit.before?.claims.find(c => c.id === claim.id)) !== JSON.stringify(edit.after.claims.find(c => c.id === claim.id)))) return [];
      return [{ id: claim.id, kind: claim.kind, text: claim.text, recordedAt: change.at, actor: change.actor,
        href: `/leaf/achievement?id=${encodeURIComponent(achievement.id)}#${claimAnchorId(achievement.id, claim.id)}`,
        support: (claim.citations ?? []).map(citation => ({ ...citation, status: resolveClaimCitation(leaf, citation).status })) }];
    });
    return statements.length ? [{ id: achievement.id, title: achievement.title, statements }] : [];
  });
  return { since, until, journeys,
    limitation: 'Current accounts changed in this period. Recorded dates are not work dates. Earlier unrecorded work cannot be reconstructed; citations are references, not independent verification.' };
}

export function renderWorkReflection(load: LeafLoad, query = new URLSearchParams(), now = new Date()): string {
  if (!load.ok) throw new LeafLoadError(load);
  if (load.source.declaredExample || load.source.bundledExample) throw new Error('Choose your real work record.');
  if ([...query.keys()].some(key => key !== 'period') || query.getAll('period').length > 1 ||
      query.has('period') && !['day', 'week'].includes(query.get('period')!)) throw new Error('Choose day or week.');
  const period = query.get('period') ?? 'week';
  const summary = workReflection(load.leaf, new Date(now.getTime() - (period === 'day' ? 1 : 7) * 86400_000).toISOString(), now.toISOString());
  const rows = summary.journeys.map(journey => `<section class="portfolio-editor-section"><h2><a href="/leaf/achievement?id=${encodeURIComponent(journey.id)}">${esc(journey.title)}</a></h2>${journey.statements.map(statement => {
    const support = !statement.support.length ? 'Self-reported · No citations' : statement.support.some(c => c.status !== 'current') ? 'Evidence needs review' : 'Cited · Not independently verified';
    return `<article class="portfolio-claim"><h3 class="fol-label">${esc(ACHIEVEMENT_CLAIM_LABELS[statement.kind])}</h3><p data-authored="subject">${esc(statement.text)}</p><p class="aside">${support}</p><a href="${esc(statement.href)}">Evidence →</a><details><summary>Recorded</summary><time class="fol-metric" datetime="${esc(statement.recordedAt)}">${esc(statement.recordedAt)}</time><p>${statement.actor === 'agent' ? 'Assistant edit' : 'Your edit'}</p></details></article>`;
  }).join('')}<p><a href="/leaf/scarlet?achievement=${encodeURIComponent(journey.id)}">Reflect with Scarlet →</a></p></section>`).join('');
  return page({ title: 'Reflection', surface: 'leaf', face: 'night', nav: 'journey', state: 'work-reflection', empty: !rows, portfolioLeaf: true,
    body: `<div class="portfolio-editor"><h1>Reflection</h1><nav class="portfolio-edit-nav" aria-label="Reflection period"><a href="/leaf/reflection?period=week"${period === 'week' ? ' aria-current="page"' : ''}>Past week</a><a href="/leaf/reflection?period=day"${period === 'day' ? ' aria-current="page"' : ''}>Past day</a></nav>${rows || '<p>No recorded journey changes in this period.</p><a href="/leaf/scarlet">Open Scarlet →</a>'}<details><summary>About this reflection</summary><p>${esc(summary.limitation)}</p><p>Private · Generated on this device · Nothing sent</p><p><time class="fol-metric">${esc(summary.since)}</time> — <time class="fol-metric">${esc(summary.until)}</time></p></details></div>` });
}
