/** Jev on Scarlet's proposed highlights: owner-invoked, advisory, never a write or publication grant. */
import { createHash } from 'node:crypto';
import { checkJevPoolSelection, type JevPoolSelection } from './jevPoolDecision.ts';
import type { JourneyRequest } from './journeyCollaboration.ts';

const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const JEV_HIGHLIGHT_PURPOSE = 'Choose which recorded work best represents this journey as a highlight.';
const JEV_HIGHLIGHT_CRITERIA = 'Keep work that shows a meaningful decision, contribution, roadblock, experiment, failed assumption, pivot, discovery or outcome for this journey. Pass work outside this journey or already captured by its statements. A title or excerpt is the person\'s own account, not proof of attribution, quality or impact. If the supplied text is not enough, leave unresolved.';
/** What the owner consents to send: the proposed highlight's title and excerpts, with the journey's statements as context. */
export const JEV_HIGHLIGHT_CONSENT = 'typesafe-highlight-excerpts';
export const JEV_HIGHLIGHT_POLICY = hash({ version: 1, purpose: JEV_HIGHLIGHT_PURPOSE, criteria: JEV_HIGHLIGHT_CRITERIA,
  fields: ['leaflet title', 'leaflet excerpts'], context: ['journey statements'], provider: 'typesafe', caller: 'scarlet' });

const MATERIAL_CHARS = 16000;
const CONTEXT_ITEMS = 8;
const CONTEXT_CHARS = 4000;

/** What the owner sees beside a proposed highlight. Advice for their decision, never a score or an action. */
export type HighlightJevMark = 'keep' | 'pass' | 'unresolved' | 'unavailable' | 'not-sent';

export type HighlightJevCheck =
  | { readonly leaflet: string; readonly ok: true; readonly selection: JevPoolSelection; readonly selectionDigest: string }
  | { readonly leaflet: string; readonly ok: false };

/**
 * The exact selection Jev would see for each proposed highlight, in Scarlet's order. PURE and TOTAL:
 * a highlight Jev's own rules refuse comes back `ok: false` and is never sent.
 */
export function prepareHighlightChecks(context: JourneyRequest, featured: readonly string[]): readonly HighlightJevCheck[] {
  const existingContext = context.achievement.claims
    .map(c => ({ id: c.id, text: c.text.slice(0, CONTEXT_CHARS) }))
    .slice(0, CONTEXT_ITEMS);
  return featured.map(leaflet => {
    const evidence = context.evidence.find(e => e.id === leaflet);
    if (evidence === undefined) return { leaflet, ok: false };
    const text = [evidence.title, ...evidence.excerpts].join('\n\n').slice(0, MATERIAL_CHARS);
    const refs = [...new Set(evidence.citations.map(c => c.provenance.ref))];
    const checked = checkJevPoolSelection({
      caller: 'scarlet', subject: hash(context.subject), pool: `journey:${context.achievement.id}`,
      purpose: JEV_HIGHLIGHT_PURPOSE, criteria: JEV_HIGHLIGHT_CRITERIA,
      documentRevision: context.revision, policyRevision: JEV_HIGHLIGHT_POLICY,
      material: { id: leaflet, text, evidenceRefs: refs }, existingContext,
    });
    return checked.ok ? { leaflet, ok: true, selection: checked.selection, selectionDigest: checked.selectionDigest } : { leaflet, ok: false };
  });
}
