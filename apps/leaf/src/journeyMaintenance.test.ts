import { testRepository } from "../../../tools/development/testRepository.mjs";
/** Real repository evidence; injected model answers exercise contracts, not model accuracy. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync, spawn} from 'node:child_process';
import { createServer } from 'node:http';
import {createHash} from 'node:crypto';
import { once } from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadLeafDocument} from './leafDocument.ts';
import {savePresentation,resumeDraft,renderAchievement} from './portfolioPresentation.ts';
import {openWorkflow} from './workflow.ts';
import {changeJourneyMaintenance,parseJourneyMaintenance,currentJourneyGrant,maintainJourney,maintenanceRevision,reviewedJourneySuggestion,JOURNEY_SUGGESTION_CONSENT,type JourneyMaintenance,type JourneyRunGate} from './journeyMaintenance.ts';
import type {JourneyRequest,JourneyResponse} from './journeyCollaboration.ts';
const root=new URL('../../../',import.meta.url).pathname;
const history=testRepository();
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}) {
 const dir=await mkdtemp(join(tmpdir(),'foliage-auto-journey-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={FOLIAGE_LEAF:join(dir,'leaf.json'),TYPESAFE_API_KEY:'protocol-test-not-a-credential'};
 const email=execFileSync('git',['log','-1','--format=%ae'],{cwd:history,encoding:'utf8'}).trim();
 execFileSync(process.execPath,['apps/leaf/intake.mjs','--repo',history,'--identity',email,'--subject','Maintenance protocol','--out',env.FOLIAGE_LEAF],{cwd:root,timeout:20000});
 const load=await loadLeafDocument(env);assert.ok(load.ok);
 await savePresentation(env,new URLSearchParams({action:'achievement',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:load.source.documentDigest,achievement:'',title:'Repository maintenance protocol'}));
 let current=await loadLeafDocument(env);assert.ok(current.ok);
 const achievement=current.leaf.achievements![0]!.id,source=current.leaf.leaflets.find(l=>l.tier!=='excluded'&&l.provenance)!;
 assert.ok(source.provenance);
 await savePresentation(env,new URLSearchParams({action:'claim',leafId:current.leaf.id,subject:current.leaf.subject,documentRevision:current.source.documentDigest,achievement,claim:'',kind:'summary',text:source.title,citation:JSON.stringify([source.id,source.provenance.source,source.provenance.ref,source.provenance.observedAt])}));
 const ready=await loadLeafDocument(env);assert.ok(ready.ok);
 return {dir,env,achievement,source,ready};
}
const reply=(decision='keep',reason='meaningful_work')=>Response.json({model:'jev-1.13.0',answers:{decision:{type:'choice',choice:decision,confidence:.97},reason:{type:'choice',choice:reason,confidence:.97}}});
function proposal(c:JourneyRequest):JourneyResponse {return {reply:'Injected protocol suggestion.',edits:[{claim:c.achievement.claims[0]!.id,text:'Protocol revision: '+c.evidence[0]!.title,citations:c.evidence[0]!.citations}],featuredLeaflets:[]};}
async function enable(w:Awaited<ReturnType<typeof openWorkflow>>,f:Awaited<ReturnType<typeof fixture>>) {
 const load=await loadLeafDocument(f.env);assert.ok(load.ok);
 return w.command({action:'journey-grant',revision:maintenanceRevision(w.snapshot().maintenance),documentRevision:load.source.documentDigest,achievement:f.achievement,leaflets:[f.source.id],consent:JOURNEY_SUGGESTION_CONSENT});
}
const schedule=(paused=false)=>({cadence:'daily' as const,day:'Monday',time:'12:00',timezone:'UTC',quiet:false,start:'18:00',end:'08:00',paused});
const sooner=<T>(promise:Promise<T>)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('The workflow queue remained blocked by inference.')),1500))]);
async function granted(f:Awaited<ReturnType<typeof fixture>>):Promise<JourneyMaintenance> {
 const load=await loadLeafDocument(f.env);assert.ok(load.ok);
 return changeJourneyMaintenance(undefined,{action:'journey-grant',revision:maintenanceRevision(undefined),documentRevision:load.source.documentDigest,achievement:f.achievement,leaflets:[f.source.id],consent:JOURNEY_SUGGESTION_CONSENT},f.env);
}
function runGate(initial:JourneyMaintenance) {
 let state=structuredClone(initial), allowed=true;
 const gate:JourneyRunGate={
  eligible:()=>allowed,
  current:()=>structuredClone(state),
  commit:async(expected,next)=>{if(JSON.stringify(state)!==JSON.stringify(expected))return false;state=structuredClone(next);return true;},
 };
 return {gate,get state(){return structuredClone(state);},replace(next:JourneyMaintenance){state=structuredClone(next);},allow(value:boolean){allowed=value;}};
}
const noSave=async()=>{assert.fail('The legacy mutating save callback must not be used.');};

test('stored legacy permission cannot send provider data even when a run gate is supplied',async t=>{
 const f=await fixture(t);const current=await granted(f);
 const oldPolicy='sha256:'+createHash('sha256').update(JSON.stringify({version:1,scope:'selected retained leaflet IDs and existing journey statements',providers:['typesafe','fireworks'],effect:'private claim edits with history; never publication'})).digest('hex');
 current.grants[0]!.policy=oldPolicy;
 const session=runGate(current);let sent=0;
 const result=await maintainJourney(current,f.env,{ready:()=>true,collaborate:async()=>{sent++;assert.fail('No Scarlet transfer');}},noSave,async()=>{sent++;assert.fail('No Jev transfer');},session.gate);
 assert.equal(result.kind,'idle');assert.equal(sent,0);assert.deepEqual(session.state,current);
 await assert.rejects(changeJourneyMaintenance(undefined,{action:'journey-grant',revision:maintenanceRevision(undefined),documentRevision:f.ready.source.documentDigest,achievement:f.achievement,leaflets:[f.source.id],consent:'typesafe-fireworks-private-journey'},f.env));
});

test('an explicitly gated run stores a cited suggestion without changing the Leaf or publishing',async t=>{
 const f=await fixture(t);
 const other=f.ready.leaf.leaflets.find(l=>l.id!==f.source.id&&l.tier!=='excluded'&&l.provenance);
 assert.ok(other?.provenance);
 const claim=f.ready.leaf.achievements![0]!.claims[0]!;
 await savePresentation(f.env,new URLSearchParams({action:'claim',leafId:f.ready.leaf.id,subject:f.ready.leaf.subject,documentRevision:f.ready.source.documentDigest,achievement:f.achievement,claim:claim.id,kind:claim.kind,text:claim.text,
  citation:JSON.stringify([f.source.id,f.source.provenance!.source,f.source.provenance!.ref,f.source.provenance!.observedAt])}));
 const withSecond=await loadLeafDocument(f.env);assert.ok(withSecond.ok);
 const first=withSecond.leaf.achievements![0]!.claims[0]!;
 await savePresentation(f.env,new URLSearchParams([
  ['action','claim'],['leafId',withSecond.leaf.id],['subject',withSecond.leaf.subject],['documentRevision',withSecond.source.documentDigest],['achievement',f.achievement],['claim',first.id],['kind',first.kind],['text',first.text],
  ['citation',JSON.stringify([f.source.id,f.source.provenance!.source,f.source.provenance!.ref,f.source.provenance!.observedAt])],
  ['citation',JSON.stringify([other.id,other.provenance.source,other.provenance.ref,other.provenance.observedAt])],
 ]));
 const state=await granted(f),session=runGate(state),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 let jev=0,scarlet=0;
 const outcome=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>{
  scarlet++;assert.equal(context.subject,f.ready.leaf.subject);
  assert.equal(context.evidence.length,1);assert.equal(context.evidence[0]!.id,f.source.id);
  assert.equal(context.achievement.claims[0]!.citations.length,1);
  return proposal(context);
 }},noSave,async()=>{jev++;return reply();},session.gate);
 assert.equal(outcome.kind,'suggested');assert.equal(jev,1);assert.equal(scarlet,1);
 const receipt=session.state.attempts[0]!;assert.equal(receipt.status,'suggested');assert.ok(receipt.draft);
 assert.equal(receipt.draft.response.edits[0]!.citations.length,2);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 assert.deepEqual((await maintainJourney(session.state,f.env,{ready:()=>true,collaborate:async()=>{assert.fail('Repeated proposal');}},noSave,async()=>{assert.fail('Repeated decision');},session.gate)).kind,'idle');
});

test('no session/schedule gate means no provider call even with a new grant',async t=>{
 const f=await fixture(t),state=await granted(f),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 const result=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async()=>{assert.fail('No Scarlet');}},noSave,async()=>{assert.fail('No Jev');});
 assert.equal(result.kind,'gated');assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 await assert.rejects(savePresentation(f.env,new URLSearchParams({action:'journey-maintain',leafId:f.ready.leaf.id,subject:f.ready.leaf.subject,documentRevision:f.ready.source.documentDigest,achievement:f.achievement,proposal:'{}'}),'agent'));
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
});

test('workflow request stays gated until Scarlet is connected and the schedule is active',async t=>{
 const f=await fixture(t),directory=join(f.dir,'workflow');let ready=false,sent=0;
 const w=await openWorkflow(directory,{env:f.env,fetcher:async()=>{sent++;return reply();},journey:{ready:()=>ready,collaborate:async context=>{sent++;return proposal(context);}}});
 try {
 await w.command({action:'schedule',schedule:schedule(true)});
 await assert.rejects(enable(w,f),/Connect Scarlet/);
 ready=true;await enable(w,f);
 assert.deepEqual(await w.requestJourneySuggestion(),{kind:'gated',reason:'schedule_paused'});
 await w.command({action:'schedule',schedule:schedule()});
 ready=false;assert.equal((await w.requestJourneySuggestion()).kind,'disconnected');
 assert.equal(sent,0);assert.deepEqual(w.snapshot().maintenance?.attempts,[]);
 } finally { await w.close(); }
});

test('a targeted request sends only the selected active journey and refuses an unknown grant',async t=>{
 const f=await fixture(t),directory=join(f.dir,'workflow');
 const first=await loadLeafDocument(f.env);assert.ok(first.ok);
 await savePresentation(f.env,new URLSearchParams({action:'achievement',leafId:first.leaf.id,subject:first.leaf.subject,documentRevision:first.source.documentDigest,achievement:'',title:'Second repository journey'}));
 const second=await loadLeafDocument(f.env);assert.ok(second.ok);
 const secondAchievement=second.leaf.achievements!.find(a=>a.id!==f.achievement)!.id;
 await savePresentation(f.env,new URLSearchParams({action:'claim',leafId:second.leaf.id,subject:second.leaf.subject,documentRevision:second.source.documentDigest,achievement:secondAchievement,claim:'',kind:'summary',text:f.source.title,citation:JSON.stringify([f.source.id,f.source.provenance!.source,f.source.provenance!.ref,f.source.provenance!.observedAt])}));
 let sent=0;
 const w=await openWorkflow(directory,{env:f.env,fetcher:async()=>{sent++;return reply();},journey:{ready:()=>true,collaborate:async context=>{sent++;assert.equal(context.achievement.id,secondAchievement);return proposal(context);}}});
 try {
  await w.command({action:'schedule',schedule:schedule()});await enable(w,f);
  const ready=await loadLeafDocument(f.env);assert.ok(ready.ok);
  await w.command({action:'journey-grant',revision:maintenanceRevision(w.snapshot().maintenance),documentRevision:ready.source.documentDigest,achievement:secondAchievement,leaflets:[f.source.id],consent:JOURNEY_SUGGESTION_CONSENT});
  const grant=w.snapshot().maintenance!.grants.find(g=>g.achievement===secondAchievement)!;
  assert.deepEqual(await w.requestJourneySuggestion('unknown-grant'),{kind:'revoked'});
  assert.equal(sent,0);
  const result=await w.requestJourneySuggestion(grant.id);
  assert.equal(result.kind,'suggested');assert.equal(sent,2);
  const attempt=w.snapshot().maintenance!.attempts[0]!;
  assert.equal(attempt.grant,grant.id);assert.equal(attempt.draft?.achievement,secondAchievement);
 } finally { await w.close(); }
});

test('workflow inference leaves the serial queue free for immediate revoke and discards a late result',async t=>{
 const f=await fixture(t),directory=join(f.dir,'workflow'),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve}),held=new Promise<void>(resolve=>{release=resolve});
 const w=await openWorkflow(directory,{env:f.env,fetcher:async()=>reply(),journey:{ready:()=>true,collaborate:async context=>{started();await held;return proposal(context);}}});
 try {
 await w.command({action:'schedule',schedule:schedule()});await enable(w,f);
 const pending=w.requestJourneySuggestion();await sooner(entered);
 assert.equal((await w.requestJourneySuggestion()).kind,'busy');
 const grant=w.snapshot().maintenance!.grants[0]!;
 await sooner(w.command({action:'journey-revoke',revision:maintenanceRevision(w.snapshot().maintenance),grant:grant.id}));
 const revoked=w.snapshot().maintenance!;assert.equal(revoked.attempts[0]!.status,'interrupted');assert.equal(revoked.attempts[0]!.detail,'revoked');
 release();assert.equal((await pending).kind,'revoked');
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 assert.equal(JSON.parse(await readFile(join(directory,'workflow.json'),'utf8')).maintenance.attempts[0].draft,undefined);
 } finally { release(); await w.close(); }
});

test('a schedule pause during Scarlet inference records interruption without storing its late answer',async t=>{
 const f=await fixture(t),directory=join(f.dir,'workflow');
 let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve}),held=new Promise<void>(resolve=>{release=resolve});
 const w=await openWorkflow(directory,{env:f.env,fetcher:async()=>reply(),journey:{ready:()=>true,collaborate:async context=>{started();await held;return proposal(context);}}});
 try {
 await w.command({action:'schedule',schedule:schedule()});await enable(w,f);
 const pending=w.requestJourneySuggestion();await sooner(entered);
 await sooner(w.command({action:'schedule',schedule:schedule(true)}));
 release();assert.equal((await pending).kind,'gated');
 const attempt=w.snapshot().maintenance!.attempts[0]!;
 assert.equal(attempt.status,'interrupted');assert.equal(attempt.detail,'session_paused');assert.equal(attempt.draft,undefined);
 assert.equal((await w.requestJourneySuggestion()).kind,'gated');
 } finally { release(); await w.close(); }
});

test('the owner-requested suggestion persists as a pending receipt across restart without changing the Leaf',async t=>{
 const f=await fixture(t),directory=join(f.dir,'workflow'),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');let sent=0;
 let w=await openWorkflow(directory,{env:f.env,fetcher:async()=>{sent++;return reply();},journey:{ready:()=>true,collaborate:async context=>{sent++;return proposal(context);}}});
 try {
 await w.command({action:'schedule',schedule:schedule()});await enable(w,f);
 const result=await w.requestJourneySuggestion();assert.equal(result.kind,'suggested');assert.equal(sent,2);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 await w.close();
 w=await openWorkflow(directory,{env:f.env,fetcher:async()=>{assert.fail('No automatic Jev request');return reply();},journey:{ready:()=>false,collaborate:async()=>{assert.fail('No automatic Scarlet request');throw new Error('unreachable');}}});
 const receipt=w.snapshot().maintenance!.attempts[0]!;
 assert.equal(receipt.status,'suggested');assert.equal(receipt.id,result.attempt);assert.ok(receipt.draft?.response.edits[0]?.citations.length);
 assert.equal((await w.requestJourneySuggestion()).kind,'disconnected');
 } finally { if(w.snapshot().active) await w.close(); }
});

test('revocation during inference prevents a pending suggestion',async t=>{
 const f=await fixture(t),state=await granted(f),session=runGate(state),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 const result=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>{
  const current=session.state;
  session.replace(await changeJourneyMaintenance(current,{action:'journey-revoke',revision:maintenanceRevision(current),grant:current.grants[0]!.id},f.env));
  return proposal(context);
 }},noSave,async()=>reply(),session.gate);
 assert.equal(result.kind,'revoked');assert.ok(session.state.grants[0]!.revokedAt);
 assert.equal(session.state.attempts[0]!.status,'interrupted');
 assert.equal(session.state.attempts[0]!.detail,'revoked');
 assert.equal(session.state.attempts[0]!.draft,undefined);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
});

test('pausing during inference interrupts the receipt and retries only after the session resumes',async t=>{
 const f=await fixture(t),state=await granted(f),session=runGate(state),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 let jev=0,scarlet=0;
 const paused=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>{
  scarlet++;session.allow(false);return proposal(context);
 }},noSave,async()=>{jev++;return reply();},session.gate);
 assert.equal(paused.kind,'gated');assert.equal(jev,1);assert.equal(scarlet,1);
 assert.equal(session.state.attempts[0]!.status,'interrupted');
 assert.equal(session.state.attempts[0]!.detail,'session_paused');
 assert.equal(session.state.attempts[0]!.draft,undefined);
 assert.equal((await maintainJourney(session.state,f.env,{ready:()=>true,collaborate:async()=>{assert.fail('No transfer while paused');}},noSave,async()=>{assert.fail('No Jev while paused');},session.gate)).kind,'gated');
 session.allow(true);
 const resumed=await maintainJourney(session.state,f.env,{ready:()=>true,collaborate:async context=>{scarlet++;return proposal(context);}},noSave,async()=>{jev++;return reply();},session.gate);
 assert.equal(resumed.kind,'suggested');assert.equal(jev,2);assert.equal(scarlet,2);
 assert.equal(session.state.attempts[1]!.status,'suggested');
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
});

test('a new number absent from cited evidence is refused before a suggestion is stored',async t=>{
 const f=await fixture(t),state=await granted(f),session=runGate(state),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 const result=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>{
  const answer=proposal(context);return {...answer,edits:answer.edits.map(edit=>({...edit,text:'Reduced latency by 97.3 milliseconds.'}))};
 }},noSave,async()=>reply(),session.gate);
 assert.equal(result.kind,'failed');assert.equal(session.state.attempts[0]!.status,'failed');
 assert.equal(session.state.attempts[0]!.detail,'unsupported_number');
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
});

test('a spelled-out number also requires support in the cited evidence',async t=>{
 const f=await fixture(t),state=await granted(f),session=runGate(state);
 const result=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>{
  const answer=proposal(context);return {...answer,edits:answer.edits.map(edit=>({...edit,text:'Helped twenty customers.'}))};
 }},noSave,async()=>reply(),session.gate);
 assert.equal(result.kind,'failed');
 assert.equal(session.state.attempts[0]!.detail,'unsupported_number');
});

test('a selected Git citation cannot borrow a number from another citation on the same Leaflet',async t=>{
 const f=await fixture(t);
 const rootNumbers=new Set([...f.source.title.matchAll(/\bv\d+\b/gi)].map(match=>match[0]!.toLowerCase()));
 const other=f.ready.leaf.leaflets.find(record=>record.id!==f.source.id&&record.tier!=='excluded'&&record.provenance&&
  [...record.title.matchAll(/\bv\d+\b/gi)].some(match=>!rootNumbers.has(match[0]!.toLowerCase())));
 assert.ok(other?.provenance,'a different retained Git commit supplies a numbered title');
 const leaf={...f.ready.leaf,leaflets:f.ready.leaf.leaflets.map(record=>record.id===f.source.id
  ? {...record,body:[...(record.body??[]),{text:other.title,provenance:other.provenance!}]}:record)};
 await writeFile(f.env.FOLIAGE_LEAF,JSON.stringify(leaf));
 const ready=await loadLeafDocument(f.env);assert.ok(ready.ok);
 const state=await granted(f),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 const candidate=(context:JourneyRequest,useBody:boolean,text:string):JourneyResponse=>{
  const citation=context.evidence[0]!.citations.find(item=>item.provenance.ref===(useBody?other.provenance!.ref:f.source.provenance!.ref));
  assert.ok(citation);
  return {reply:'Review this cited repository statement.',edits:[{claim:context.achievement.claims[0]!.id,text,citations:[citation]}],featuredLeaflets:[]};
 };
 const wrong=runGate(state);
 const refused=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>candidate(context,false,other.title)},noSave,async()=>reply(),wrong.gate);
 assert.equal(refused.kind,'failed');assert.equal(wrong.state.attempts[0]!.detail,'unsupported_number');
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);

 const review=runGate(state);
 const suggested=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>candidate(context,false,'My initial attempt failed.')},noSave,async()=>reply(),review.gate);
 assert.equal(suggested.kind,'suggested');
 await assert.rejects(async()=>reviewedJourneySuggestion(review.state,suggested.attempt!,ready,[other.title]),/A number is missing from the cited evidence/);
 const draft=reviewedJourneySuggestion(review.state,suggested.attempt!,ready);
 const unsupported={...draft.response,edits:draft.response.edits.map(edit=>({...edit,text:other.title}))};
 const form=(response:JourneyResponse)=>new URLSearchParams({action:'journey-edits',leafId:ready.leaf.id,subject:ready.leaf.subject,documentRevision:ready.source.documentDigest,achievement:f.achievement,proposal:JSON.stringify(response)});
 await assert.rejects(savePresentation(f.env,form(unsupported)),/A number is missing from the cited evidence/);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);

 const exact=runGate(state);
 const accepted=await maintainJourney(state,f.env,{ready:()=>true,collaborate:async context=>candidate(context,true,other.title)},noSave,async()=>reply(),exact.gate);
 assert.equal(accepted.kind,'suggested');
 const checked=reviewedJourneySuggestion(exact.state,accepted.attempt!,ready);
 await savePresentation(f.env,form(checked.response),'manual',{journeyReview:current=>{
  const latest=reviewedJourneySuggestion(exact.state,accepted.attempt!,current);
  return {response:latest.response,selectedLeaflets:latest.selectedLeaflets};
 }});
 const saved=await loadLeafDocument(f.env);assert.ok(saved.ok);
 assert.equal(saved.leaf.achievements![0]!.claims[0]!.text,other.title);
 assert.equal(saved.leaf.achievements![0]!.claims[0]!.citations![0]!.provenance.ref,other.provenance.ref);
});

test('an unavailable Jev decision is recorded and can be retried without saving a Leaf edit',async t=>{
 const f=await fixture(t),state=await granted(f),session=runGate(state),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 let drafted=0;
 const agent={ready:()=>true,collaborate:async(context:JourneyRequest)=>{drafted++;return proposal(context);}};
 const unavailable=await maintainJourney(state,f.env,agent,noSave,async()=>new Response(null,{status:503}),session.gate);
 assert.equal(unavailable.kind,'provider_unavailable');
 assert.equal(session.state.attempts[0]!.detail,'provider_unavailable');
 assert.equal(drafted,0);
 const recovered=await maintainJourney(session.state,f.env,agent,noSave,async()=>reply(),session.gate);
 assert.equal(recovered.kind,'suggested');assert.equal(drafted,1);
 assert.equal(session.state.attempts.length,2);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
});

test('stored journey grants do not connect Scarlet at startup, on a page read or on the collection timer', { timeout: 45000 }, async t => {
 const f = await fixture(t), directory = join(f.dir, 'workflow');
 const w = await openWorkflow(directory, {env:f.env, journey:{ready:()=>true, collaborate:async()=>{assert.fail('No authoring');}}});
 await enable(w,f); const grants = w.snapshot().maintenance!.grants; await w.close();
 const before = await readFile(f.env.FOLIAGE_LEAF,'utf8'); let requests=0;
 const companion=createServer((_req,res)=>{requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({service:'foliage-assessment-companion',version:1,ready:true,model:'protocol'}));});
 companion.listen(0,'127.0.0.1');await once(companion,'listening');
 t.after(()=>new Promise<void>(resolve=>companion.close(()=>resolve())));
 const address=companion.address();assert.ok(address&&typeof address==='object');
 const child=spawn(process.execPath,['apps/leaf/server.mjs'],{cwd:root,env:{...process.env,...f.env,PORT:'0',HOST:'127.0.0.1',FOLIAGE_WORKFLOW_DIR:directory,FOLIAGE_HARVEST:join(f.dir,'absent-harvest.json'),FOLIAGE_COMPANION_ORIGIN:`http://127.0.0.1:${address.port}`,FOLIAGE_COMPANION_KEY:'a'.repeat(64)},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}});
 const origin=await new Promise<string>((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error('Server did not start')),8000);child.stdout.on('data',chunk=>{output+=chunk;const match=/\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\//.exec(output);if(match){clearTimeout(timeout);resolve(match[1]!);}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}`));});});
 const page=await fetch(`${origin}/leaf/scarlet`);assert.equal(page.status,200);await page.text();
 await new Promise(resolve=>setTimeout(resolve,31000));
 assert.equal(requests,0);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 const persisted=JSON.parse(await readFile(join(directory,'workflow.json'),'utf8'));
 assert.deepEqual(persisted.maintenance.grants,grants);
 assert.deepEqual(persisted.maintenance.attempts,[]);
});


test('source-scoped upgrade history survives restart without granting provider access',async t=>{
 const f=await fixture(t),current=await granted(f),grant=current.grants[0]!;
 // Source-maintenance policy emitted by live runtime 9c80cefb.
 const legacyPolicy='sha256:532cddbb5bc1a51d66d2e8eee905d57f26131840b30fc5b227ea50b2b9df0a2e';
 const email=execFileSync('git',['log','-1','--format=%ae'],{cwd:history,encoding:'utf8'}).trim();
 grant.policy=legacyPolicy;
 grant.sources=[{id:'repository-scope-protocol',path:history,email,jevGrant:'retained-receipt-protocol'}];
 current.admissions=[{id:'admission-protocol',grant:grant.id,packet:f.source.id,input:f.ready.source.documentDigest,at:new Date().toISOString(),status:'admitted',leaflet:`workflow:${f.source.id}`}];
 const leafBefore=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 const parsed=parseJourneyMaintenance(current);
 assert.deepEqual(parsed,current);
 assert.equal(currentJourneyGrant(parsed.grants[0]!),false);
 const session=runGate(parsed);
 const agent={ready:()=>true,collaborate:async()=>{assert.fail('Historical grants cannot contact Scarlet');}};
 const fetcher:typeof fetch=async()=>{assert.fail('Historical grants cannot contact Jev');};
 assert.deepEqual(await maintainJourney(parsed,f.env,agent,noSave,fetcher,session.gate),{kind:'idle'});
 assert.deepEqual(await maintainJourney(parsed,f.env,agent,noSave,fetcher,session.gate,grant.id),{kind:'revoked'});
 assert.deepEqual(session.state,current);
 const directory=join(f.dir,'upgrade-workflow');
 const original=await openWorkflow(directory,{env:f.env});await original.command({action:"schedule",schedule:schedule(true)});await original.close();
 const statePath=join(directory,'workflow.json');
 const stored=JSON.parse(await readFile(statePath,'utf8'));stored.maintenance=current;await writeFile(statePath,JSON.stringify(stored));
 const reopened=await openWorkflow(directory,{env:f.env,fetcher,journey:agent});
 try {
  assert.deepEqual(reopened.snapshot().maintenance,current);
  const renewed=await reopened.command({action:'journey-grant',revision:maintenanceRevision(reopened.snapshot().maintenance),documentRevision:f.ready.source.documentDigest,achievement:f.achievement,leaflets:[f.source.id],consent:JOURNEY_SUGGESTION_CONSENT});
  assert.deepEqual(renewed.maintenance?.admissions,current.admissions);
  assert.ok(renewed.maintenance?.grants[0]?.revokedAt);
  assert.ok(currentJourneyGrant(renewed.maintenance!.grants[1]!));
  assert.equal(renewed.maintenance!.grants[1]!.sources,undefined);
 } finally {await reopened.close();}
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),leafBefore);
 const bad=structuredClone(parsed);bad.grants[0]!.policy=(await granted(f)).grants[0]!.policy;
 assert.throws(()=>parseJourneyMaintenance(bad),/historical automatic intake binding/);
 const detached=structuredClone(parsed);detached.admissions![0]!.grant='another-grant';
 assert.throws(()=>parseJourneyMaintenance(detached),/historical automatic intake binding/);
});
