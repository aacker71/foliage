/** Private Jev configuration and receipts inside the existing workflow document. */
import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { JEV_MODEL } from './jevTransport.ts';
import { gitLineage, orderReviewQueue, type HarvestCandidate, type HarvestDocument, type JevMark } from '@foliage/photosynthesis';
import { checkJevPoolSelection, type JevPoolSelection } from './jevPoolDecision.ts';
import type { WorkflowSnapshot } from './workflow.ts';

const id = z.string().min(1).max(256);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const date = z.iso.datetime();
const grant = z.strictObject({ id, source: id, caller: z.literal('photosynthesis'), provider: z.literal('typesafe'),
  policyRevision: digest, grantedAt: date, revokedAt: date.optional() });
const receipt = z.strictObject({ selectionDigest: digest, caller: z.literal('photosynthesis'), subject: id, pool: id,
  material: id, documentRevision: digest, policyRevision: digest, evidenceRefs: z.array(id).min(1).max(32),
  outcome: z.enum(['keep','pass','unresolved']),
  reason: z.enum(['meaningful_work','additional_evidence','duplicate','outside_purpose','insufficient_context','model_uncertain','inconsistent_decision','provider_unavailable']),
  provider: z.literal('typesafe'), model: z.literal(JEV_MODEL), checkedAt: date, detail: z.string().max(200).optional() });
const attempt = z.strictObject({ id, grant: id, packet: id, selectionDigest: digest, startedAt: date,
  status: z.enum(['pending','completed','interrupted']), receipt: receipt.optional() });
const stateSchema = z.strictObject({ grants: z.array(grant).max(128), attempts: z.array(attempt).max(1024) });
export type JevWorkflowState = z.infer<typeof stateSchema>;
const JEV_SOURCE_PURPOSE = 'Select meaningful repository work for private review.';
const JEV_SOURCE_CRITERIA = 'Keep decisions, roadblocks, experiments, failed assumptions, pivots, discoveries, contributions or outcomes when the supplied commit titles describe meaningful work. Pass only material outside this purpose or duplicates supported by supplied context. A commit title is an author account, not proof of attribution, implementation quality or production impact. If titles do not provide enough context, leave unresolved.';
const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
/**
 * Version 2: each check also carries the same lineage's approved commit titles as context, so a
 * version 1 grant no longer covers what is sent and must be given again.
 */
export const JEV_SOURCE_POLICY = hash({ version:2, purpose:JEV_SOURCE_PURPOSE, criteria:JEV_SOURCE_CRITERIA,
  fields:['commit title'], context:['approved commit titles of the same prefix'], provider:'typesafe', caller:'photosynthesis' });

export function parseJevWorkflow(value: unknown): JevWorkflowState {
  const parsed = stateSchema.parse(value);
  for (const values of [parsed.grants,parsed.attempts]) if(new Set(values.map(v=>v.id)).size!==values.length) throw new Error('Duplicate Jev history ids.');
  for(const a of parsed.attempts) {
    const g=parsed.grants.find(g=>g.id===a.grant);
    if(!g || (a.status==='completed') !== !!a.receipt || (a.receipt && (a.receipt.selectionDigest!==a.selectionDigest || a.receipt.material!==a.packet || a.receipt.pool!==`source:${g.source}` || a.receipt.policyRevision!==g.policyRevision))) throw new Error('Invalid Jev receipt binding.');
  }
  if(new Set(parsed.grants.filter(g=>!g.revokedAt).map(g=>g.source)).size!==parsed.grants.filter(g=>!g.revokedAt).length) throw new Error('Repeated active Jev source permission.');
  return parsed;
}
export function jevPermissionRevision(state: Pick<WorkflowSnapshot,'sources'|'jev'>): string {
  return hash({ sources:state.sources.map(s=>({id:s.id,enabled:s.enabled})), grants:state.jev?.grants??[], policy:JEV_SOURCE_POLICY });
}
export function grantJevSource(state: WorkflowSnapshot, value: unknown, now: Date): JevWorkflowState {
  const input=z.strictObject({action:z.literal('jev-grant'),source:id,revision:digest,consent:z.literal('typesafe-source-commit-titles')}).parse(value);
  if(input.revision!==jevPermissionRevision(state)) throw new Error('Permissions changed. Reload.');
  if(!state.sources.some(s=>s.id===input.source && s.enabled)) throw new Error('Choose a current enabled source.');
  const current=state.jev??{grants:[],attempts:[]};
  if(current.grants.some(g=>g.source===input.source&&!g.revokedAt&&g.policyRevision===JEV_SOURCE_POLICY)) return current;
  if(current.grants.length>=128) throw new Error('Jev permission history full.');
  return {...current,grants:[...current.grants.map(g=>g.source===input.source&&!g.revokedAt?{...g,revokedAt:now.toISOString()}:g),
    {id:randomUUID(),source:input.source,caller:'photosynthesis',provider:'typesafe',policyRevision:JEV_SOURCE_POLICY,grantedAt:now.toISOString()}]};
}
export function revokeJevSource(state: WorkflowSnapshot, value: unknown, now: Date): JevWorkflowState {
  const input=z.strictObject({action:z.literal('jev-revoke'),source:id,revision:digest}).parse(value);
  if(input.revision!==jevPermissionRevision(state)) throw new Error('Permissions changed. Reload.');
  return revokeSourceGrants(state.jev??{grants:[],attempts:[]},input.source,now);
}
export function revokeSourceGrants(state: JevWorkflowState, source: string, now: Date): JevWorkflowState {
  return {...state,grants:state.grants.map(g=>g.source===source&&!g.revokedAt?{...g,revokedAt:now.toISOString()}:g)};
}
/** The source permission Jev acts under for this queue: an active, current-policy grant of an enabled checkout. */
export interface JevAccess {
  readonly grant: string;
  readonly source: string;
  readonly email: string;
}

/**
 * Every source that could carry Jev for a queue, in saved order: enabled, and holding an active
 * grant of the current policy. Which of them checks out the queue's repository is a git question,
 * answered at the edge (`workflow.ts`).
 */
export function jevGrantedSources(state: Pick<WorkflowSnapshot, 'sources'|'jev'>): readonly (JevAccess & { readonly path: string })[] {
  return state.sources.flatMap(source => {
    const grant = source.enabled ? state.jev?.grants.find(g => g.source === source.id && !g.revokedAt && g.policyRevision === JEV_SOURCE_POLICY) : undefined;
    return grant ? [{ grant: grant.id, source: source.id, email: source.email, path: source.path }] : [];
  });
}

/**
 * Why a candidate is never sent to Jev. Checked before any call, so none of these costs a request.
 * `unsendable`: Jev's own selection rules refuse it, or would send it under another id or ref.
 */
export type JevIneligible = 'missing' | 'decided' | 'not-git' | 'untitled' | 'too-large' | 'unsendable' | 'no-grant';

export type PreparedCandidateJev =
  | { readonly ok: true; readonly grant: string; readonly selection: JevPoolSelection; readonly selectionDigest: string }
  | { readonly ok: false; readonly cause: JevIneligible };

/** Context budget: the same limits `prepareJevPoolSelection` refuses at. */
const ID_CHARS = 256;
const CONTEXT_ITEMS = 8;
const CONTEXT_CHARS = 4000;
const SELECTION_BYTES = 24000;
const MATERIAL_CHARS = 16000;
const MATERIAL_REFS = 32;

const subjectsOf = (candidate: HarvestCandidate): readonly string[] =>
  candidate.evidence.map(e => e.excerpt?.trim() ?? '').filter(s => s !== '');

/** Whole subjects, newest first, while they fit one context item. A subject is never cut. */
function contextText(candidate: HarvestCandidate): string {
  const subjects = subjectsOf(candidate);
  const over = subjects.findIndex((_, i) => subjects.slice(0, i + 1).join('\n').length > CONTEXT_CHARS);
  return subjects.slice(0, over < 0 ? subjects.length : over).join('\n');
}

const approvedAt = (c: HarvestCandidate): number => (c.review.state === 'approved' ? Date.parse(c.review.at) || 0 : 0);

/**
 * What Jev already holds for this lineage: the approved candidates of the same prefix, newest
 * decision first, as their commit subjects. Never a reviewer's title: only the author's own words
 * leave the device. The draft's own rule holds here: an approval with any evidence not from git
 * adds nothing.
 */
function lineageContext(harvest: HarvestDocument, prefix: string): readonly { readonly id: string; readonly text: string }[] {
  return harvest.candidates
    .filter(c => c.review.state === 'approved' && gitLineage(c.id)?.prefix === prefix && c.evidence.every(e => e.source === 'git'))
    .sort((a, b) => approvedAt(b) - approvedAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(c => ({ id: String(c.id), text: contextText(c) }))
    // An id Jev would refuse or re-spell is left out, never sent under another name.
    .filter(item => item.text !== '' && item.id.length <= ID_CHARS && item.id === item.id.trim())
    .slice(0, CONTEXT_ITEMS);
}

/**
 * The exact selection Jev would see for one open git draft, or why it is never sent. Only commit
 * subjects leave the device: the draft's own, newest first, and the same lineage's approved ones as
 * context. Paths, emails, shas and titles stay local; the refs travel only in the local binding.
 * PURE and TOTAL: any harvest that parses gives a value, never a throw. /review and every timer
 * pass read this for each open draft, so one odd draft must not take either down.
 * The caller resolves which grant applies.
 */
export function prepareCandidateJev(harvest: HarvestDocument, id: string, access: JevAccess | undefined): PreparedCandidateJev {
  const candidate = harvest.candidates.find(c => c.id === id);
  if (candidate === undefined) return { ok: false, cause: 'missing' };
  if (candidate.review.state !== 'candidate') return { ok: false, cause: 'decided' };
  const lineage = gitLineage(candidate.id);
  if (lineage === null || candidate.evidence.some(e => e.source !== 'git')) return { ok: false, cause: 'not-git' };
  const subjects = subjectsOf(candidate);
  if (subjects.length === 0) return { ok: false, cause: 'untitled' };
  const text = subjects.join('\n');
  const refs = candidate.evidence.map(e => e.ref);
  if (refs.length > MATERIAL_REFS || text.length > MATERIAL_CHARS || candidate.id.length > ID_CHARS || refs.some(r => r.length > ID_CHARS)) return { ok: false, cause: 'too-large' };
  if (access === undefined) return { ok: false, cause: 'no-grant' };
  const base = {
    caller: 'photosynthesis' as const, subject: hash(access.email), pool: `source:${access.source}`,
    purpose: JEV_SOURCE_PURPOSE, criteria: JEV_SOURCE_CRITERIA,
    // What was judged: this draft's id and exact refs. A retitle is not new material.
    documentRevision: hash({ candidate: candidate.id, refs }), policyRevision: JEV_SOURCE_POLICY,
    material: { id: String(candidate.id), text, evidenceRefs: refs },
  };
  const fits = (context: readonly { readonly id: string; readonly text: string }[]) =>
    Buffer.byteLength(JSON.stringify({ ...base, existingContext: context })) <= SELECTION_BYTES;
  // Drop the oldest context first until the whole selection fits.
  const context = lineageContext(harvest, lineage.prefix);
  const kept = Array.from({ length: context.length + 1 }, (_, dropped) => context.slice(0, context.length - dropped)).find(fits) ?? [];
  if (!fits(kept)) return { ok: false, cause: 'too-large' };
  const checked = checkJevPoolSelection({ ...base, existingContext: kept });
  if (!checked.ok) return { ok: false, cause: 'unsendable' };
  // A receipt binds to the id and refs as written: one Jev would trim is never sent.
  const { material, existingContext } = checked.selection;
  const exact = material.id === candidate.id && material.evidenceRefs.every((r, i) => r === refs[i]) &&
    existingContext.every((item, i) => item.id === kept[i]?.id);
  if (!exact) return { ok: false, cause: 'unsendable' };
  return { ok: true, grant: access.grant, selection: checked.selection, selectionDigest: checked.selectionDigest };
}

/** Where one open draft stands with Jev under the current grant and content. */
export type CandidateJevStatus =
  | { readonly kind: 'ineligible'; readonly cause: JevIneligible }
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'pending' }
  /** Sent, outcome unknown (the process stopped). Only the owner retries it. */
  | { readonly kind: 'interrupted' }
  /** The provider did not answer. Unresolved; only the owner retries it. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'checked'; readonly mark: JevMark };

function statusOf(jev: JevWorkflowState | undefined, prepared: PreparedCandidateJev, id: string): CandidateJevStatus {
  if (!prepared.ok) return { kind: 'ineligible', cause: prepared.cause };
  const last = jev?.attempts.findLast(a => a.packet === id && a.grant === prepared.grant && a.selectionDigest === prepared.selectionDigest);
  if (last === undefined) return { kind: 'unchecked' };
  switch (last.status) {
    case 'pending': return { kind: 'pending' };
    case 'interrupted': return { kind: 'interrupted' };
    case 'completed':
      return last.receipt === undefined || last.receipt.reason === 'provider_unavailable'
        ? { kind: 'unavailable' }
        : { kind: 'checked', mark: last.receipt.outcome };
    default: {
      const impossible: never = last.status;
      throw new Error(`unhandled Jev attempt status: ${JSON.stringify(impossible)}`);
    }
  }
}

export function candidateJevStatus(jev: JevWorkflowState | undefined, harvest: HarvestDocument, id: string, access: JevAccess | undefined): CandidateJevStatus {
  return statusOf(jev, prepareCandidateJev(harvest, id, access), id);
}

/**
 * What /review shows of Jev: a mark for each open draft whose receipt is current for its exact
 * selection and grant, and the drafts the owner may retry. A changed draft, a new approval in its
 * lineage, a revoked grant or a new policy each leave it unmarked. Private working order only.
 */
export function jevQueueView(jev: JevWorkflowState | undefined, harvest: HarvestDocument, access: JevAccess | undefined): {
  readonly marks: ReadonlyMap<string, JevMark>;
  readonly retry: ReadonlySet<string>;
} {
  const statuses = harvest.candidates
    .filter(c => c.review.state === 'candidate')
    .map(c => [String(c.id), candidateJevStatus(jev, harvest, c.id, access)] as const);
  return {
    marks: new Map(statuses.flatMap(([id, s]) => (s.kind === 'checked' ? [[id, s.mark] as const] : []))),
    retry: new Set(statuses.flatMap(([id, s]) => (s.kind === 'interrupted' || s.kind === 'unavailable' ? [id] : []))),
  };
}

/**
 * The drafts automatic checking takes next: unchecked and eligible, newest work first. A check the
 * provider did not answer, or whose outcome is unknown, is never taken again here: each draft's
 * exact selection is sent at most once without the owner, who retries it from /review.
 */
export function jevCheckOrder(jev: JevWorkflowState | undefined, harvest: HarvestDocument, access: JevAccess | undefined): readonly string[] {
  return orderReviewQueue(harvest.candidates, new Map())
    .open.map(entry => String(entry.candidate.id))
    .filter(id => candidateJevStatus(jev, harvest, id, access).kind === 'unchecked');
}

/**
 * The last mark Jev gave each named item while it was a draft in the review queue. A leaflet keeps
 * its draft's id, so this is what Jev said before the owner approved it. Advice only: it never
 * changes what is published. A check the provider did not answer, or that never finished, gives none.
 */
export function leafletJevMarks(jev: JevWorkflowState | undefined, ids: readonly string[]): ReadonlyMap<string, JevMark> {
  const wanted = new Set(ids);
  const marks = new Map<string, JevMark>();
  for (const a of jev?.attempts ?? []) {
    if (!wanted.has(a.packet) || a.status !== 'completed' || a.receipt === undefined || a.receipt.reason === 'provider_unavailable') continue;
    marks.set(a.packet, a.receipt.outcome);
  }
  return marks;
}
