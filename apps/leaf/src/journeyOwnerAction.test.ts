import { testRepository } from "../../../tools/development/testRepository.mjs";
/** Real Git evidence. Injected Jev/Scarlet replies test authority and storage, not model quality. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLeafDocument } from './leafDocument.ts';
import { savePresentation } from './portfolioPresentation.ts';
import { openWorkflow } from './workflow.ts';
import { maintenanceRevision, JOURNEY_SUGGESTION_CONSENT } from './journeyMaintenance.ts';
import { journeyAction } from './journeyActions.ts';
import { renderJourneyWorkspace } from './journeyWorkspace.ts';
import { createAssessmentConnection } from './assessmentConnection.ts';
import { storyEvidence } from './leafletStory.ts';
import type { JourneyRequest, JourneyResponse } from './journeyCollaboration.ts';

const root=new URL('../../../',import.meta.url).pathname;
const history=testRepository();
const response=()=>Response.json({model:'jev-1.13.0',answers:{decision:{type:'choice',choice:'keep',confidence:.97},reason:{type:'choice',choice:'meaningful_work',confidence:.97}}});
const schedule={cadence:'daily' as const,day:'Monday',time:'12:00',timezone:'UTC',quiet:false,start:'18:00',end:'08:00',paused:false};
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}) {
  const dir=await mkdtemp(join(tmpdir(),'foliage-owner-journey-'));
  const env={FOLIAGE_LEAF:join(dir,'leaf.json'),TYPESAFE_API_KEY:'protocol-test-not-a-credential'};
  const email=execFileSync('git',['log','-1','--format=%ae'],{cwd:history,encoding:'utf8'}).trim();
  execFileSync(process.execPath,['apps/leaf/intake.mjs','--repo',history,'--identity',email,'--subject','Owner journey protocol','--out',env.FOLIAGE_LEAF],{cwd:root,timeout:20000});
  let load=await loadLeafDocument(env);assert.ok(load.ok);
  const records=load.leaf.leaflets.filter(record=>record.tier!=='excluded'&&storyEvidence(record).length).slice(0,2);
  assert.equal(records.length,2);
  const existing=records[0]!,newlySelected=records[1]!;
  await savePresentation(env,new URLSearchParams({action:'achievement',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:load.source.documentDigest,achievement:'',title:'Repository journey'}));
  load=await loadLeafDocument(env);assert.ok(load.ok);
  const achievement=load.leaf.achievements![0]!.id,provenance=storyEvidence(existing)[0]!;
  await savePresentation(env,new URLSearchParams({action:'claim',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:load.source.documentDigest,achievement,claim:'',kind:'summary',text:existing.title,citation:JSON.stringify([existing.id,provenance.source,provenance.ref,provenance.observedAt])}));
  const ready=await loadLeafDocument(env);assert.ok(ready.ok);
  let jev=0,scarlet=0;
  const workflow=await openWorkflow(join(dir,'workflow'),{env,fetcher:async()=>{jev++;return response();},journey:{ready:()=>true,collaborate:async(context:JourneyRequest):Promise<JourneyResponse>=>{
    scarlet++;assert.deepEqual(context.evidence.map(item=>item.id),[newlySelected.id]);
    assert.equal(context.achievement.claims[0]!.citations.length,0,'outside-grant citation stays local');
    return {reply:'Protocol suggestion.',edits:[{claim:context.achievement.claims[0]!.id,text:'A revised repository account.',citations:context.evidence[0]!.citations}],featuredLeaflets:[]};
  }}});
  t.after(async()=>{await workflow.close();await rm(dir,{recursive:true,force:true});});
  await workflow.command({action:'schedule',schedule});
  await workflow.command({action:'journey-grant',revision:maintenanceRevision(workflow.snapshot().maintenance),documentRevision:ready.source.documentDigest,achievement,leaflets:[newlySelected.id],consent:JOURNEY_SUGGESTION_CONSENT});
  const grant=workflow.snapshot().maintenance!.grants[0]!;
  return {dir,env,workflow,ready,achievement,existing,newlySelected,grant,connection:createAssessmentConnection({}),calls:()=>({jev,scarlet})};
}

test('owner prepares, reviews and saves a cited pending update with newly granted evidence, history and no publication',async t=>{
  const f=await fixture(t),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
  const prepare=new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:f.ready.source.documentDigest,grant:f.grant.id});
  const prepared=await journeyAction(prepare,f.env,f.connection,f.workflow);
  assert.equal(prepared.updateOutcome?.kind,'suggested');
  assert.deepEqual(f.calls(),{jev:1,scarlet:1});
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before,'preparation is private and read-only');
  const attempt=f.workflow.snapshot().maintenance!.attempts[0]!;
  assert.equal(attempt.status,'suggested');assert.ok(attempt.draft);
  assert.deepEqual(attempt.draft.response.edits[0]!.citations.map(citation=>citation.leaflet),[f.newlySelected.id,f.existing.id]);
  const html=renderJourneyWorkspace(f.ready,{connected:true,ready:true,model:'protocol',detail:'Connected'},f.workflow.snapshot(),f.env,{achievement:f.achievement,...prepared});
  assert.match(html,/Save to journey/);assert.match(html,/Discard/);assert.match(html,/A revised repository account/);assert.match(html,/Check for update/);
  assert.ok(html.indexOf('Ready to review')<html.indexOf('data-scarlet-conversation'),'the pending work precedes the chat tool');
  assert.match(html,/data-journey-evidence-search/);assert.match(html,/TypeSafe and Scarlet \(Fireworks\)/);
  const refused=renderJourneyWorkspace(f.ready,{connected:true,ready:true,model:'protocol',detail:'Connected'},f.workflow.snapshot(),f.env,{achievement:f.achievement,error:'A number is missing from the cited evidence. Nothing saved.',draftTexts:['Served 999999 users.']});
  assert.match(refused,/<textarea[^>]*name="text"[^>]*>Served 999999 users\.<\/textarea>/);
  const edited=new URLSearchParams({action:'apply-pending',achievement:f.achievement,revision:f.ready.source.documentDigest,attempt:attempt.id,text:'A carefully reviewed account.'});
  await assert.rejects(journeyAction(new URLSearchParams({...Object.fromEntries(edited),text:'Served 999999 users.'}),f.env,f.connection,f.workflow),/number is missing/);
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
  assert.equal(f.workflow.snapshot().maintenance!.attempts[0]!.status,'suggested');
  assert.match((await journeyAction(edited,f.env,f.connection,f.workflow)).redirect!,/leaf\/achievement/);
  const saved=await loadLeafDocument(f.env);assert.ok(saved.ok);
  const claim=saved.leaf.achievements![0]!.claims[0]!;
  assert.equal(claim.text,'A carefully reviewed account.');
  assert.deepEqual(claim.citations?.map(citation=>citation.leaflet),[f.newlySelected.id,f.existing.id]);
  assert.ok(saved.leaf.journeyHistory?.length);
  assert.deepEqual(saved.leaf.leaflets,f.ready.leaf.leaflets);
  const receipt=f.workflow.snapshot().maintenance!.attempts[0]!;
  assert.equal(receipt.status,'applied');assert.equal(receipt.after,saved.source.documentDigest);assert.equal(receipt.draft,undefined);
  await assert.rejects(journeyAction(edited,f.env,f.connection,f.workflow),/no longer available/);
  const edit=saved.leaf.journeyHistory?.find(item=>item.achievement===f.achievement&&item.after.claims[0]?.text===claim.text);
  assert.ok(edit,'the owner edit keeps a restorable before version');
  await savePresentation(f.env,new URLSearchParams({action:'journey-restore',leafId:saved.leaf.id,subject:saved.leaf.subject,documentRevision:saved.source.documentDigest,achievement:f.achievement,editId:edit.id,version:'before',replaceCurrent:'yes'}));
  const restored=await loadLeafDocument(f.env);assert.ok(restored.ok);
  assert.equal(restored.leaf.achievements![0]!.claims[0]!.text,f.ready.leaf.achievements![0]!.claims[0]!.text);
  assert.deepEqual(restored.leaf.achievements![0]!.claims[0]!.citations?.map(citation=>citation.leaflet),[f.existing.id]);
});

test('revocation or a changed Leaf blocks finalization; discarding preserves the canonical record',async t=>{
  const f=await fixture(t);
  await journeyAction(new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:f.ready.source.documentDigest,grant:f.grant.id}),f.env,f.connection,f.workflow);
  const attempt=f.workflow.snapshot().maintenance!.attempts[0]!;
  const apply=new URLSearchParams({action:'apply-pending',achievement:f.achievement,revision:f.ready.source.documentDigest,attempt:attempt.id,text:'A private revision.'});
  const bytes=await readFile(f.env.FOLIAGE_LEAF,'utf8');
  await f.workflow.command({action:'journey-revoke',revision:maintenanceRevision(f.workflow.snapshot().maintenance),grant:f.grant.id});
  await assert.rejects(journeyAction(apply,f.env,f.connection,f.workflow),/no longer available/);
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),bytes);
  await journeyAction(new URLSearchParams({action:'discard-pending',achievement:f.achievement,revision:f.ready.source.documentDigest,attempt:attempt.id}),f.env,f.connection,f.workflow);
  assert.equal(f.workflow.snapshot().maintenance!.attempts[0]!.status,'discarded');
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),bytes);
});

test('paused collection and a changed Leaf refuse a stored update without rewriting it',async t=>{
  const f=await fixture(t);
  await journeyAction(new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:f.ready.source.documentDigest,grant:f.grant.id}),f.env,f.connection,f.workflow);
  const attempt=f.workflow.snapshot().maintenance!.attempts[0]!;
  const apply=new URLSearchParams({action:'apply-pending',achievement:f.achievement,revision:f.ready.source.documentDigest,attempt:attempt.id,text:'A private revision.'});
  await f.workflow.command({action:'schedule',schedule:{...schedule,paused:true}});
  await assert.rejects(journeyAction(apply,f.env,f.connection,f.workflow),/paused/);
  await f.workflow.command({action:'schedule',schedule});
  const loaded=await loadLeafDocument(f.env);assert.ok(loaded.ok);
  await savePresentation(f.env,new URLSearchParams({action:'profile',leafId:loaded.leaf.id,subject:loaded.leaf.subject,documentRevision:loaded.source.documentDigest,headline:'A changed private introduction',bio:'',direction:'',passions:''}));
  const changed=await readFile(f.env.FOLIAGE_LEAF,'utf8');
  await assert.rejects(journeyAction(apply,f.env,f.connection,f.workflow),/changed/);
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),changed);
  assert.equal(f.workflow.snapshot().maintenance!.attempts[0]!.status,'suggested');
});

test('an owner can check again after an unrelated edit and review a current cited suggestion',async t=>{
  const f=await fixture(t);
  const first=await journeyAction(new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:f.ready.source.documentDigest,grant:f.grant.id}),f.env,f.connection,f.workflow);
  assert.equal(first.updateOutcome?.kind,'suggested');
  const old=f.workflow.snapshot().maintenance!.attempts[0]!;
  const loaded=await loadLeafDocument(f.env);assert.ok(loaded.ok);
  await savePresentation(f.env,new URLSearchParams({action:'profile',leafId:loaded.leaf.id,subject:loaded.leaf.subject,documentRevision:loaded.source.documentDigest,headline:'A revised private introduction',bio:'',direction:'',passions:''}));
  const current=await loadLeafDocument(f.env);assert.ok(current.ok);
  const oldForm=new URLSearchParams({action:'apply-pending',achievement:f.achievement,revision:old.draft!.revision,attempt:old.id,text:'An old revision.'});
  await assert.rejects(journeyAction(oldForm,f.env,f.connection,f.workflow),/changed/);
  const stale=renderJourneyWorkspace(current,{connected:true,ready:true,model:'protocol',detail:'Connected'},f.workflow.snapshot(),f.env,{achievement:f.achievement});
  assert.match(stale,/Update out of date/);
  assert.match(stale,/Check again/);
  assert.doesNotMatch(stale,/Save to journey/);

  const second=await journeyAction(new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:current.source.documentDigest,grant:f.grant.id}),f.env,f.connection,f.workflow);
  assert.equal(second.updateOutcome?.kind,'suggested');
  assert.deepEqual(f.calls(),{jev:2,scarlet:2});
  const attempts=f.workflow.snapshot().maintenance!.attempts;
  assert.equal(attempts.length,2);
  assert.equal(attempts[0]!.input,attempts[1]!.input,'unchanged evidence can be checked against the current record');
  assert.equal(attempts[0]!.draft?.revision,loaded.source.documentDigest);
  assert.equal(attempts[1]!.draft?.revision,current.source.documentDigest);
  const ready=renderJourneyWorkspace(current,{connected:true,ready:true,model:'protocol',detail:'Connected'},f.workflow.snapshot(),f.env,{achievement:f.achievement,...second});
  assert.match(ready,/Save to journey/);
  assert.doesNotMatch(ready,/Update out of date/);
  await journeyAction(new URLSearchParams({action:'apply-pending',achievement:f.achievement,revision:current.source.documentDigest,attempt:attempts[1]!.id,text:'A reviewed current account.'}),f.env,f.connection,f.workflow);
  const saved=await loadLeafDocument(f.env);assert.ok(saved.ok);
  assert.equal(saved.leaf.achievements![0]!.claims[0]!.text,'A reviewed current account.');
  assert.deepEqual(saved.leaf.achievements![0]!.claims[0]!.citations?.map(citation=>citation.leaflet),[f.newlySelected.id,f.existing.id]);
  assert.ok(saved.leaf.journeyHistory?.length,'owner save has a restorable history entry');
  assert.equal(f.workflow.snapshot().maintenance!.attempts[1]!.status,'applied');
});

test('owner check names each gate and opens its recovery control without calling a provider while paused',async t=>{
  const f=await fixture(t),before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
  const status={connected:true,ready:true,model:'protocol',detail:'Connected'};
  await f.workflow.command({action:'schedule',schedule:{...schedule,paused:true}});
  const prepare=new URLSearchParams({action:'prepare-update',achievement:f.achievement,revision:f.ready.source.documentDigest,grant:f.grant.id});
  const blocked=await journeyAction(prepare,f.env,f.connection,f.workflow);
  assert.deepEqual(blocked.updateOutcome,{kind:'gated',reason:'schedule_paused'});
  assert.deepEqual(f.calls(),{jev:0,scarlet:0});
  assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);

  const cases=[
    ['schedule_missing','No collection rhythm','#updates','Set rhythm'],
    ['schedule_paused','Collection is paused','#updates','Resume collection'],
    ['quiet_hours','Quiet hours are active','#quiet-hours','Review quiet hours'],
    ['schedule_changed','Collection rhythm changed','#updates','Review rhythm'],
    ['permission_missing','Update permission is off','#journey-permission','Allow updates'],
    ['workflow_closed','Collection is unavailable','/workflow#background','Open background runs'],
  ] as const;
  for(const [reason,label,href,action] of cases) {
    const html=renderJourneyWorkspace(f.ready,status,f.workflow.snapshot(),f.env,{achievement:f.achievement,updateOutcome:{kind:'gated',reason}});
    const feedback=html.match(/<p class="journey-update-feedback" role="status">.*?<\/p>/s)?.[0];
    assert.ok(feedback,`missing feedback for ${reason}`);
    assert.ok(feedback.includes(`<span>${label}</span>`),`wrong label for ${reason}`);
    assert.ok(feedback.includes(`href="${href}">${action}</a>`),`missing recovery action for ${reason}`);
    assert.ok(!feedback.includes(reason),'raw gate codes are not interface text');
    if(href==='#updates') assert.match(html,/<details id="updates" class="portfolio-editor-section" open>/);
    if(href==='#quiet-hours') assert.match(html,/<details id="quiet-hours" open>/);
    if(href==='#journey-permission') assert.match(html,/<details id="journey-permission" class="journey-update-permission" open>/);
  }
});


test('legacy journey permission is shown as needing review, never as an active update control',async t=>{
 const f=await fixture(t),state=f.workflow.snapshot();
 state.maintenance!.grants[0]!.policy='sha256:'+'a'.repeat(64);
 const html=renderJourneyWorkspace(f.ready,{connected:true,ready:true,model:'protocol',detail:'Connected'},state,f.env,{achievement:f.achievement});
 assert.match(html,/Update permission needs review/);
 assert.match(html,/Updates · Review/);
 assert.match(html,/Allow updates/);
 assert.doesNotMatch(html,/Check for update|Stop updates/);
});
