/** Bounded lexical retrieval over a supplied record. No storage, inference or access grants. */
import { createHash } from 'node:crypto';
import { isSubjectsOwnWork, type Leaf, type ClaimCitation } from './leaf.ts';
import { resolveClaimCitation } from './portfolio.ts';

export const BRAIN_LIMITS = Object.freeze({ query: 256, results: 20, excerpt: 4000, responseBytes: 128 * 1024, records: 20_000 });
export interface BrainRecord {
  readonly id: string;
  readonly kind: 'profile' | 'claim' | 'leaflet' | 'excerpt' | 'view';
  readonly title: string;
  readonly text: string;
  readonly achievement?: string;
  readonly claim?: string;
  readonly claimKind?: string;
  readonly leaflet?: string;
  readonly view?: string;
  /** Named views supplied by the authorized projection, including explicitly cited support. */
  readonly views?: readonly string[];
  readonly attribution?: 'verified' | 'pending';
  readonly account: 'owner-account' | 'retained-material';
  readonly citations: readonly { readonly leaflet: string; readonly provenance: ClaimCitation['provenance']; readonly status: string }[];
}
export class BrainError extends Error {
  readonly code: 'invalid' | 'unavailable' | 'stale' | 'not-found' | 'too-large';
  constructor(code: BrainError['code'], message: string) { super(message); this.code = code; }
}
const recordId = (parts: readonly string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Private owner record only. Never use these records as a public projection or admission decision. */
export function privateBrainRecords(leaf: Leaf, view?: string): readonly BrainRecord[] {
  const selected = view === undefined ? undefined : leaf.collections?.find(item => item.id === view);
  if (view !== undefined && !selected) throw new BrainError('not-found', 'This view is unavailable.');
  const records: BrainRecord[] = [];
  const push = (key: string[], value: Omit<BrainRecord, 'id'>) => {
    if (records.length >= BRAIN_LIMITS.records) throw new BrainError('too-large', 'Select a smaller named view.');
    records.push({ id: recordId([leaf.id, ...key]), ...value });
  };
  const citation = (c: ClaimCitation) => ({ leaflet: String(c.leaflet), provenance: { source: c.provenance.source, ref: c.provenance.ref, observedAt: c.provenance.observedAt },
    status: resolveClaimCitation(leaf, c).status });
  if (!selected) {
    for (const [key, value] of Object.entries({ headline: leaf.headline, bio: leaf.profile?.bio, direction: leaf.profile?.direction, passions: leaf.profile?.passions?.join('\n') })) {
      if (value) push(['profile', key], { kind: 'profile', title: key, text: value, account: 'owner-account', citations: [] });
    }
  }
  const views = selected ? [selected] : leaf.collections ?? [];
  const viewEvidence = views.map(v => ({ id: v.id, achievements: new Set(v.achievements),
    leaflets: new Set([...v.leaflets, ...(leaf.achievements ?? []).filter(a => v.achievements.includes(a.id)).flatMap(a => a.claims.flatMap(c => (c.citations ?? []).map(ref => ref.leaflet)))]) }));
  const achievements = (leaf.achievements ?? []).filter(a => !selected || selected.achievements.includes(a.id));
  const referenced = new Set(achievements.flatMap(a => a.claims.flatMap(c => (c.citations ?? []).map(ref => String(ref.leaflet)))));
  for (const a of achievements) for (const claim of a.claims) {
    push(['claim', a.id, claim.id], { kind: 'claim', title: a.title, text: claim.text, achievement: a.id, claim: claim.id, claimKind: claim.kind,
      account: 'owner-account', views: viewEvidence.filter(v => v.achievements.has(a.id)).map(v => v.id), citations: (claim.citations ?? []).map(citation) });
  }
  for (const item of leaf.leaflets) {
    if (!isSubjectsOwnWork(item) || selected && !selected.leaflets.includes(item.id) && !referenced.has(item.id)) continue;
    const fields = { title: item.title, views: viewEvidence.filter(v => v.leaflets.has(item.id)).map(v => v.id), leaflet: String(item.id), attribution: item.tier, account: 'retained-material' as const };
    push(['leaflet', item.id], { ...fields, kind: 'leaflet', text: item.title, citations: item.provenance ? [citation({ leaflet: item.id, provenance: item.provenance })] : [] });
    for (const [index, element] of (item.body ?? []).entries()) {
      if (element.text) push(['excerpt', item.id, String(index)], { ...fields, kind: 'excerpt', text: element.text, citations: [citation({ leaflet: item.id, provenance: element.provenance })] });
    }
  }
  for (const c of views) {
    push(['view', c.id], { kind: 'view', title: c.title, text: c.description ?? c.title, view: c.id, account: 'owner-account', citations: [] });
  }
  return records;
}

export interface BrainQuery { readonly query: string; readonly limit?: number; readonly offset?: number }
export function searchBrain(records: readonly BrainRecord[], input: BrainQuery) {
  const { query, limit = 10, offset = 0 } = input;
  if (typeof query !== 'string' || !query.trim() || query.length > BRAIN_LIMITS.query || !Number.isSafeInteger(limit) || limit < 1 || limit > BRAIN_LIMITS.results || !Number.isSafeInteger(offset) || offset < 0 || offset > BRAIN_LIMITS.records) {
    throw new BrainError('invalid', 'Supply a nonempty query up to 256 characters, limit 1–20 and a valid offset.');
  }
  const terms = [...new Set(query.trim().toLowerCase().split(/\s+/u))];
  const matches = records.filter(record => {
    const content = `${record.title}\n${record.text}`.toLowerCase();
    return terms.every(term => content.includes(term));
  });
  const results = matches.slice(offset, offset + limit).map(record => excerpt(record));
  return { results, nextOffset: offset + results.length < matches.length ? offset + results.length : null,
    retrieval: 'literal-terms-in-record-order', limitation: 'Literal text matching only. Missing matches do not establish absence of work; citations do not independently verify claims.' };
}
function excerpt(record: BrainRecord) {
  return { ...record, text: record.text.slice(0, BRAIN_LIMITS.excerpt), truncated: record.text.length > BRAIN_LIMITS.excerpt };
}
export function readBrainRecord(records: readonly BrainRecord[], id: string, start = 0) {
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(start) || start < 0) throw new BrainError('invalid', 'Supply a record ID and nonnegative text offset.');
  const record = records.find(item => item.id === id);
  if (!record) throw new BrainError('not-found', 'This record is unavailable.');
  if (start > record.text.length) throw new BrainError('invalid', 'Text offset exceeds this record.');
  const end = Math.min(start + BRAIN_LIMITS.excerpt, record.text.length);
  return { ...record, text: record.text.slice(start, end), start, end, offsetUnit: 'utf16-code-units', nextStart: end < record.text.length ? end : null };
}
export function boundedBrainResult<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > BRAIN_LIMITS.responseBytes) throw new BrainError('too-large', 'The selected context exceeds the response limit. Narrow the view or request fewer results.');
  return value;
}

/** Follow recorded connections only; never infer collaboration, ownership or impact. */
export function relatedBrainRecords(records: readonly BrainRecord[], input: { id: string; limit?: number; offset?: number }) {
  const { id, limit = 10, offset = 0 } = input;
  readBrainRecord(records, id); // Identical ID and scope validation to direct reads.
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > BRAIN_LIMITS.results || !Number.isSafeInteger(offset) || offset < 0 || offset > BRAIN_LIMITS.records)
    throw new BrainError('invalid', 'Supply limit 1–20 and a valid offset.');
  const source = records.find(r => r.id === id)!;
  type Relationship = 'cites' | 'cited-by' | 'same-journey' | 'retained-excerpt' | 'source-record' | 'in-view' | 'contains';
  const current = (c: BrainRecord['citations'][number]) => c.status === 'current';
  const cites = (claim: BrainRecord, evidence: BrainRecord) => claim.kind === 'claim' && ['leaflet', 'excerpt'].includes(evidence.kind) &&
    claim.citations.some(c => current(c) && evidence.citations.some(e => current(e) && c.leaflet === e.leaflet &&
      c.provenance.source === e.provenance.source && c.provenance.ref === e.provenance.ref && c.provenance.observedAt === e.provenance.observedAt));
  const matches = records.flatMap(record => {
    if (record.id === id) return [];
    const relationships: Relationship[] = [];
    if (cites(source, record)) relationships.push('cites');
    if (cites(record, source)) relationships.push('cited-by');
    if (source.achievement && source.achievement === record.achievement) relationships.push('same-journey');
    if (source.leaflet && source.leaflet === record.leaflet) {
      if (source.kind === 'leaflet' && record.kind === 'excerpt') relationships.push('retained-excerpt');
      if (source.kind === 'excerpt' && record.kind === 'leaflet') relationships.push('source-record');
    }
    if (record.kind === 'view' && source.views?.includes(record.view!)) relationships.push('in-view');
    if (source.kind === 'view' && record.views?.includes(source.view!)) relationships.push('contains');
    return relationships.length ? [{ record: excerpt(record), relationships }] : [];
  });
  const results = matches.slice(offset, offset + limit);
  return { source: id, results, nextOffset: offset + results.length < matches.length ? offset + results.length : null,
    retrieval: 'explicit-relationships-in-record-order', limitation: 'Recorded context only. Shared context does not establish contribution, causality or impact. Citations are references, not independent verification.' };
}
