import type { JourneyEdit, Leaf } from './leaf.ts';
import { resolveClaimCitation } from './portfolio.ts';

/** Retain changed journey snapshots only. A no-op/retry adds no history and changes no bytes. */
export function recordJourneyEdits(before: Leaf, after: Leaf, actor: JourneyEdit['actor'], at: string, editId: () => string): Leaf {
  const edits: JourneyEdit[] = [];
  for (const achievement of after.achievements ?? []) {
    const previous = before.achievements?.find(item => item.id === achievement.id) ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(achievement)) edits.push({
      id: editId(), at, actor, achievement: achievement.id, before: previous, after: achievement,
    });
  }
  if (!edits.length) return after;
  const history = [...edits, ...(before.journeyHistory ?? [])];
  // Fail visibly rather than evict the owner's earlier words. Archival requires its own operation.
  if (history.length > 1024 || new TextEncoder().encode(JSON.stringify(history)).byteLength > 16 * 1024 * 1024) {
    throw new Error('Journey history has reached its storage limit. Nothing was overwritten or removed. Preserve an archive before continuing.');
  }
  return { ...after, journeyHistory: history };
}

/** Caller holds the canonical document lock and checks the exact current revision. */
export function restoreJourneyVersion(leaf: Leaf, achievement: string, edit: string, version: 'before' | 'after'): Leaf {
  const entry = leaf.journeyHistory?.find(item => item.id === edit && item.achievement === achievement);
  const snapshot = entry?.[version];
  if (!entry || !snapshot || !leaf.achievements?.some(item => item.id === achievement)) throw new Error('This saved journey version is unavailable.');
  if (snapshot.claims.some(claim => claim.citations?.some(citation => resolveClaimCitation(leaf, citation).status !== 'current'))) {
    throw new Error('This version has changed or unavailable citations. Your earlier words remain in history; repair the supporting references before restoring.');
  }
  return { ...leaf, achievements: leaf.achievements.map(item => item.id === achievement ? snapshot : item) };
}
