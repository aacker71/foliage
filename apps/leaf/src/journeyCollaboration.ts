/** Portable selected-context contract. It grants no model write or publication authority. */
import * as z from 'zod/v4';
import { ACHIEVEMENT_CLAIM_KINDS, PORTFOLIO_LIMITS, MAX_FEATURED_LEAFLETS, RATING_SHAPED, resolveClaimCitation } from '@foliage/leaf';
import type { LeafLoad } from './leafDocument.ts';
import { LeafLoadError } from './loadLabels.ts';
import { storyEvidence } from './leafletStory.ts';
const id = z.string().min(1).max(256);
const prose = (max: number) => z.string().min(1).max(max).refine(value => !RATING_SHAPED.test(value), 'Ratings are not supported.');
const citation = z.strictObject({leaflet:id,provenance:z.strictObject({source:id,ref:z.string().min(1).max(4096),observedAt:id})});
const statement = z.strictObject({id,kind:z.enum(ACHIEVEMENT_CLAIM_KINDS),text:prose(PORTFOLIO_LIMITS.claimText),citations:z.array(citation).max(PORTFOLIO_LIMITS.citations)});
const request = z.strictObject({
  version:z.literal(1),leafId:id,subject:prose(200),revision:z.string().regex(/^sha256:[a-f0-9]{64}$/),
  achievement:z.strictObject({id,title:prose(PORTFOLIO_LIMITS.title),claims:z.array(statement).max(PORTFOLIO_LIMITS.claims)}),
  evidence:z.array(z.strictObject({id,title:prose(600),tier:z.enum(['verified','pending']),citations:z.array(citation).max(64),excerpts:z.array(z.string().max(8000)).max(16)})).max(12),
  message:prose(2000),history:z.array(z.strictObject({role:z.enum(['user','assistant']),text:prose(4000)})).max(8),
});
export const journeyResponseSchema = z.strictObject({reply:prose(4000),edits:z.array(z.strictObject({claim:id,text:prose(PORTFOLIO_LIMITS.claimText),citations:z.array(citation).max(PORTFOLIO_LIMITS.citations)})).max(6),featuredLeaflets:z.array(id).max(MAX_FEATURED_LEAFLETS)});
export type JourneyRequest = z.infer<typeof request>;
export type JourneyResponse = z.infer<typeof journeyResponseSchema>;
const exact = (value: unknown) => JSON.stringify(value);
export function parseJourneyRequest(value: unknown): JourneyRequest {
  const parsed = request.parse(value);
  if(Buffer.byteLength(JSON.stringify(parsed)) > 80*1024) throw new Error('This journey has too much selected context. Choose a smaller journey.');
  if(new Set(parsed.evidence.map(e=>e.id)).size!==parsed.evidence.length || new Set(parsed.achievement.claims.map(c=>c.id)).size!==parsed.achievement.claims.length) throw new Error('Repeated selected records.');
  if(parsed.evidence.some(e=>e.citations.some(c=>c.leaflet!==e.id))) throw new Error('Evidence reference belongs to another record.');
  return parsed;
}
export function parseJourneyResponse(value: unknown, context: JourneyRequest): JourneyResponse {
  const parsed=journeyResponseSchema.parse(value);
  const citations=new Set(context.evidence.flatMap(e=>e.citations.map(exact)));
  if(new Set(parsed.edits.map(e=>e.claim)).size!==parsed.edits.length || parsed.edits.some(e=>!context.achievement.claims.some(c=>c.id===e.claim)||e.citations.some(c=>!citations.has(exact(c))))) throw new Error('Scarlet proposed an unknown statement or citation. Nothing changed.');
  if(new Set(parsed.featuredLeaflets).size!==parsed.featuredLeaflets.length || parsed.featuredLeaflets.some(id=>!context.evidence.some(e=>e.id===id))) throw new Error('Scarlet proposed unavailable highlights. Nothing changed.');
  return parsed;
}
export function prepareJourney(load: LeafLoad, achievementId: string, message: string, history: JourneyRequest['history'] = [], allowedLeaflets?: readonly string[]): JourneyRequest {
  if(!load.ok) throw new LeafLoadError(load);
  if(load.source.declaredExample||load.source.bundledExample) throw new Error('Choose your actual work record.');
  const achievement=load.leaf.achievements?.find(a=>a.id===achievementId);
  if(!achievement) throw new Error('Choose a current journey.');
  const selected=allowedLeaflets?[...allowedLeaflets]:[...new Set(achievement.claims.flatMap(c=>(c.citations??[]).filter(c=>resolveClaimCitation(load.leaf,c).status==='current').map(c=>c.leaflet)))];
  if(new Set(selected).size!==selected.length || selected.some(id=>!load.leaf.leaflets.some(e=>e.id===id&&e.tier!=='excluded'&&storyEvidence(e).length))) throw new Error('Selected journey evidence is missing or excluded.');
  if(selected.length>12) throw new Error('This journey cites more than twelve sources. Narrow its selected work before cloud collaboration.');
  return parseJourneyRequest({version:1,leafId:load.leaf.id,subject:load.leaf.subject,revision:load.source.documentDigest,
    achievement:{...achievement,claims:achievement.claims.map(c=>({...c,citations:c.citations??[]}))},message,history,
    evidence:selected.map(id=>{const e=load.leaf.leaflets.find(e=>e.id===id)!;return {id:e.id,title:e.title,tier:e.tier,citations:storyEvidence(e).map(provenance=>({leaflet:e.id,provenance})),excerpts:(e.body??[]).flatMap(b=>b.text?[b.text]:[])};})});
}
