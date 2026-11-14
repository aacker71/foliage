/** Real local Git evidence; proposed wording below tests transport, not career impact. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadLeafDocument} from './leafDocument.ts';
import {savePresentation} from './portfolioPresentation.ts';
import {prepareJourney,parseJourneyRequest,parseJourneyResponse} from './journeyCollaboration.ts';
import {renderJourneyWorkspace} from './journeyWorkspace.ts';
import {openWorkflow,collectionSettingsRevision} from './workflow.ts';
import {createAssessmentConnection} from './assessmentConnection.ts';
import {journeyAction} from './journeyActions.ts';
import {JOURNEY_SUGGESTION_CONSENT,maintenanceRevision} from './journeyMaintenance.ts';
const root=new URL('../../../',import.meta.url).pathname;
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}) {
 const dir=await mkdtemp(join(tmpdir(),'foliage-journey-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={FOLIAGE_LEAF:join(dir,'leaf.json')};
 const identity=execFileSync('git',['log','-1','--format=%ae'],{cwd:root,encoding:'utf8'}).trim();
 execFileSync(process.execPath,['apps/leaf/intake.mjs','--repo',root,'--identity',identity,'--subject','Journey protocol','--out',env.FOLIAGE_LEAF],{cwd:root,timeout:15000});
 const load=await loadLeafDocument(env);assert.ok(load.ok);
 await savePresentation(env,new URLSearchParams({action:'achievement',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:load.source.documentDigest,achievement:'',title:'Selected repository protocol'}));
 let current=await loadLeafDocument(env);assert.ok(current.ok);
 const achievement=current.leaf.achievements![0]!.id,source=current.leaf.leaflets.find(l=>l.tier!=='excluded'&&l.provenance)!;
 assert.ok(source.provenance);
 const citation={leaflet:source.id,provenance:source.provenance};
 for(const kind of ['summary','decision']){
  current=await loadLeafDocument(env);assert.ok(current.ok);
  await savePresentation(env,new URLSearchParams({action:'claim',leafId:current.leaf.id,subject:current.leaf.subject,documentRevision:current.source.documentDigest,achievement,claim:'',kind,text:source.title,citation:JSON.stringify([source.id,source.provenance.source,source.provenance.ref,source.provenance.observedAt])}));
 }
 const ready=await loadLeafDocument(env);assert.ok(ready.ok);
 return {dir,env,ready,achievement,citation};
}
test('selected context bounds cloud input and rejects invented edits, citation refs and highlight IDs',async t=>{
 const f=await fixture(t),context=prepareJourney(f.ready,f.achievement,'Explain this recorded decision.');
 assert.equal(context.evidence.length,1);assert.deepEqual(context.evidence[0]!.citations,[f.citation]);
 assert.equal(context.achievement.claims.length,2);assert.ok(!JSON.stringify(context).includes(f.dir));
 const proposal={reply:'Protocol response: inspect the retained source.',edits:[{claim:context.achievement.claims[0]!.id,text:'Protocol revision of the recorded account.',citations:[f.citation]}],featuredLeaflets:[f.citation.leaflet]};
 assert.deepEqual(parseJourneyResponse(proposal,context),proposal);
 assert.throws(()=>parseJourneyRequest({...context,publish:true}));
 assert.throws(()=>parseJourneyResponse({...proposal,edits:[{...proposal.edits[0],claim:'foreign'}]},context));
 assert.throws(()=>parseJourneyResponse({...proposal,edits:[{...proposal.edits[0],citations:[{...f.citation,provenance:{...f.citation.provenance,ref:'invented'}}]}]},context));
 assert.throws(()=>parseJourneyResponse({...proposal,featuredLeaflets:['foreign']},context));
 assert.throws(()=>parseJourneyResponse({...proposal,edits:[proposal.edits[0],proposal.edits[0]]},context));
 const html=renderJourneyWorkspace(f.ready,{connected:false,ready:false,model:null,detail:'Companion not configured.'},undefined,{},{});
 assert.match(html,/Connect Scarlet/);assert.doesNotMatch(html,/data-scarlet-conversation|Message Scarlet|Ask Scarlet/);
 assert.match(html,/Delivery unavailable/);assert.match(html,/journey-client\.mjs/);
 assert.ok(html.includes('class="journey-selected"'));assert.ok(html.includes('class="journey-evidence"'));
 assert.ok(html.includes('No retained excerpt'));assert.ok(html.includes('Request data'));
 const ready=renderJourneyWorkspace(f.ready,{connected:true,ready:true,model:'protocol',detail:'Ready'},undefined,{},{});
 assert.match(ready,/data-scarlet-conversation/);assert.match(ready,/Message Scarlet/);assert.match(ready,/Ask Scarlet/);
 const unsent=renderJourneyWorkspace(f.ready,{connected:false,ready:false,model:null,detail:'Companion not configured.'},undefined,{}, {draftMessage:'Check <source> & evidence.'});
 assert.match(unsent,/<summary>Unsent message<\/summary><p class="journey-message">Check &lt;source&gt; &amp; evidence\.<\/p>/);
 assert.doesNotMatch(unsent,/data-scarlet-conversation/);
});
test('reviewed revisions apply atomically to canonical claims and stale repeat preserves sources',async t=>{
 const f=await fixture(t),context=prepareJourney(f.ready,f.achievement,'Review the protocol account.');
 const edits=context.achievement.claims.map(c=>({claim:c.id,text:'Protocol reviewed '+c.kind+' wording.',citations:[f.citation]}));
 const unsupported={reply:'Protocol proposal.',edits:[{...edits[0]!,text:'Claimed 9999999 retained items.'}],featuredLeaflets:[]};
 const unsupportedForm=new URLSearchParams({action:'apply',achievement:f.achievement,revision:context.revision,proposal:JSON.stringify(unsupported)});
 unsupportedForm.append('text',unsupported.edits[0]!.text);
 const before=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 await assert.rejects(journeyAction(unsupportedForm,f.env,createAssessmentConnection({})),/number is missing from the cited evidence/);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before,'unsupported numeric journey wording changes nothing');
 const uncited={...unsupported,edits:[{...edits[0]!,citations:[],text:'A reviewed uncited update.'}]};
 const uncitedForm=new URLSearchParams({action:'apply',achievement:f.achievement,revision:context.revision,proposal:JSON.stringify(uncited)});
 uncitedForm.append('text',uncited.edits[0]!.text);
 await assert.rejects(journeyAction(uncitedForm,f.env,createAssessmentConnection({})),/Select evidence for every journey update/);
 assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),before);
 const form=new URLSearchParams({action:'apply',achievement:f.achievement,revision:context.revision,proposal:JSON.stringify({reply:'Protocol proposal.',edits,featuredLeaflets:[]})});
 edits.forEach(e=>form.append('text',e.text));
 const c=createAssessmentConnection({});
 assert.match((await journeyAction(form,f.env,c)).redirect!,/leaf\/achievement/);
 const after=await loadLeafDocument(f.env);assert.ok(after.ok);
 assert.deepEqual(after.leaf.leaflets,f.ready.leaf.leaflets);assert.equal(after.leaf.headline,f.ready.leaf.headline);
 assert.deepEqual(after.leaf.achievements![0]!.claims.map(c=>c.id),context.achievement.claims.map(c=>c.id));
 assert.deepEqual(after.leaf.achievements![0]!.claims.map(c=>c.text),edits.map(e=>e.text));
 const bytes=await readFile(f.env.FOLIAGE_LEAF,'utf8');
 await assert.rejects(journeyAction(form,f.env,c),/changed/);assert.equal(await readFile(f.env.FOLIAGE_LEAF,'utf8'),bytes);
});
test('collection preferences persist in existing scheduler and reject stale or unknown source selections',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'foliage-journey-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let workflow=await openWorkflow(dir);
 const schedule={cadence:'weekly',day:'Friday',time:'17:00',timezone:'America/Denver',quiet:false,start:'18:00',end:'08:00',paused:true};
 try {
  const revision=collectionSettingsRevision(workflow.snapshot());
  await assert.rejects(workflow.command({action:'collection-settings',revision,sources:['unknown'],schedule}),/current connected/);
  await assert.rejects(workflow.command({action:'collection-settings',revision,sources:[],schedule:{...schedule,paused:false}}),/Select a source first/);
  await workflow.command({action:'collection-settings',revision,sources:[],schedule});
  await assert.rejects(workflow.command({action:'collection-settings',revision,sources:[],schedule}),/changed/);
  await workflow.close();workflow=await openWorkflow(dir);assert.deepEqual(workflow.snapshot().schedule,schedule);
 }finally{await workflow.close();}
});

test('private scratch conversations survive navigation but changed records cannot retain apply proposals',async()=>{
 const {createJourneySessions}=await import('./journeySession.ts');
 const sessions=createJourneySessions();
 const value={message:'Protocol question.',history:[],response:{reply:'Protocol answer.',edits:[],featuredLeaflets:[]}};
 sessions.save('owner:journey','revision-a',value);
 assert.deepEqual(sessions.read('owner:journey','revision-a'),value);
 assert.deepEqual(sessions.read('other:journey','revision-a'),{});
 const changed=sessions.read('owner:journey','revision-b');assert.ok(!('response' in changed));assert.equal(changed.history?.length,2);
 for(let i=0;i<16;i++)sessions.save('other:'+i,'revision-a',value);
 assert.deepEqual(sessions.read('owner:journey','revision-a'),{});
});
test('journey updates ask for Scarlet before any consent, keep picked work through a refusal and Connect, and state the Collection gate',async t=>{
 const f=await fixture(t);
 const dir=await mkdtemp(join(tmpdir(),'foliage-journey-gate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const workflow=await openWorkflow(dir,{journey:{ready:()=>false,collaborate:async()=>{throw new Error('Scarlet is never asked here.');}}});
 try {
  const id=f.citation.leaflet,offline={connected:false,ready:false,model:null,detail:'Not connected'};
  const gated=renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement});
  assert.match(gated,/<p class="journey-update-gate" role="status">Connect Scarlet first<\/p>/);
  assert.equal(gated.split('<input type="hidden" name="action" value="connect">').length,2,'one Connect action on the page');
  assert.ok(gated.indexOf('value="connect"')<gated.indexOf('journey-update-gate'),'the connection action is reachable beside selected work before update settings');
  assert.ok(!gated.includes(JOURNEY_SUGGESTION_CONSENT),'no cloud consent is asked for while Scarlet cannot accept it');
  assert.match(gated,/Updates run only while Collection is scheduled, not paused and outside quiet hours\./);
  assert.match(gated,/Collection isn&#39;t scheduled · <a href="#updates">Set rhythm<\/a>/,'the same next step a gated update names');
  const setupNeeded=renderJourneyWorkspace(f.ready,{...offline,connected:true,detail:'Connected · cloud setup needed'},workflow.snapshot(),{},{achievement:f.achievement});
  assert.match(setupNeeded,/Scarlet needs cloud setup first/);
  assert.doesNotMatch(setupNeeded,/data-scarlet-conversation/);

  // A page opened while connected can still be refused: nothing is recorded, and the picked work comes back.
  const grant=new URLSearchParams({action:'journey-grant',achievement:f.achievement,revision:f.ready.source.documentDigest,permissionRevision:maintenanceRevision(undefined),leaflet:id,consent:JOURNEY_SUGGESTION_CONSENT});
  await assert.rejects(journeyAction(grant,{},createAssessmentConnection({}),workflow),/Connect Scarlet before enabling journey updates/);
  assert.equal(workflow.snapshot().maintenance,undefined,'a refused permission records nothing');
  const refused=renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement,draftLeaflets:grant.getAll('leaflet'),error:'Connect Scarlet before enabling journey updates.'});
  assert.match(refused,/<details id="journey-updates" class="portfolio-editor-section" open>/);
  assert.match(refused,/Connect Scarlet first · <span class="fol-metric">1<\/span> selected, kept/);
  assert.match(refused,new RegExp(`value="connect">[^]*?<input type="hidden" name="leaflet" value="${id}">[^]*?Connect Scarlet</button>`),'the picked work rides through Connect');
  assert.ok(!renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement,draftLeaflets:['git:not-a-record']}).includes('not-a-record'),'only current eligible work is kept');

  const companion=createAssessmentConnection({FOLIAGE_COMPANION_ORIGIN:'http://127.0.0.1:9',FOLIAGE_COMPANION_KEY:'a'.repeat(64)},
   async()=>Response.json({service:'foliage-assessment-companion',version:1,ready:true,model:'protocol'}));
  const connected=await journeyAction(new URLSearchParams([['action','connect'],['achievement',f.achievement],['revision',f.ready.source.documentDigest],['leaflet',id]]),{},companion,workflow);
  assert.deepEqual(connected,{notice:'Connected',draftLeaflets:[id]});
  assert.equal(workflow.snapshot().maintenance,undefined,'connecting records no permission');
  const ready=renderJourneyWorkspace(f.ready,companion.status(),workflow.snapshot(),{},{achievement:f.achievement,...connected});
  assert.ok(ready.includes(`<input type="checkbox" name="leaflet" value="${id}" checked>`),'the kept work is picked again');
  assert.ok(ready.includes(`<input type="checkbox" name="consent" value="${JOURNEY_SUGGESTION_CONSENT}" required>`),'consent is still asked for, unticked');
  assert.doesNotMatch(ready,/journey-update-gate/);

  const schedule={cadence:'daily',day:'Monday',time:'12:00',timezone:'UTC',quiet:false,start:'18:00',end:'08:00',paused:true};
  await workflow.command({action:'schedule',schedule});
  const paused=renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement});
  assert.match(paused,/Collection is paused · <a href="#updates">Resume collection<\/a>/);
  assert.match(renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement,updateOutcome:{kind:'gated',reason:'schedule_paused'}}),/Collection is paused<\/span><a [^>]*href="#updates">Resume collection<\/a>/,'the feedback names the same step');
  await workflow.command({action:'schedule',schedule:{...schedule,quiet:true,paused:false}});
  assert.match(renderJourneyWorkspace(f.ready,offline,workflow.snapshot(),{},{achievement:f.achievement}),/Collection is scheduled · quiet hours 18:00–08:00 · <a href="#updates">Collection<\/a>/);
 } finally {await workflow.close();}
});
test('journey updates show each refusal known before consent in its place, and ask for consent only once they pass',async t=>{
 const f=await fixture(t);
 const dir=await mkdtemp(join(tmpdir(),'foliage-journey-gates-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const workflow=await openWorkflow(dir,{env:f.env,journey:{ready:()=>true,collaborate:async()=>{throw new Error('Scarlet is never asked here.');}}});
 try {
  const ready={connected:true,ready:true,model:'protocol',detail:'Ready'},offline={connected:false,ready:false,model:null,detail:'Not connected'};
  const consent=`name="consent" value="${JOURNEY_SUGGESTION_CONSENT}"`;
  const permission=(html:string)=>/<details id="journey-permission"[^>]*>[^]*?<\/details>/.exec(html)?.[0]??'';
  const grant=(achievement:string,revision:string)=>new URLSearchParams({action:'journey-grant',achievement,revision,permissionRevision:maintenanceRevision(workflow.snapshot().maintenance),leaflet:f.citation.leaflet,consent:JOURNEY_SUGGESTION_CONSENT});

  // Collection unavailable: the grant is refused, so the gate stands where consent would, said once.
  await assert.rejects(journeyAction(grant(f.achievement,f.ready.source.documentDigest),f.env,createAssessmentConnection({}),undefined),/Collection unavailable/);
  const closed=renderJourneyWorkspace(f.ready,ready,undefined,{},{achievement:f.achievement});
  assert.ok(!closed.includes(consent),'no consent while Collection is unavailable');
  assert.match(permission(closed),/<p class="journey-update-gate" role="status">Collection is unavailable · <a href="\/workflow#background">Open background runs<\/a><\/p>/);
  assert.equal(closed.split('Collection is unavailable').length,2,'said once');
  const both=permission(renderJourneyWorkspace(f.ready,offline,undefined,{},{achievement:f.achievement}));
  assert.ok(both.indexOf('Collection is unavailable')<both.indexOf('Connect Scarlet first'),'every known gate is named, in the order the grant meets them');

  // No statement to update: the grant is refused, so the gate stands where consent would.
  const before=await loadLeafDocument(f.env);assert.ok(before.ok);
  await savePresentation(f.env,new URLSearchParams({action:'achievement',leafId:before.leaf.id,subject:before.leaf.subject,documentRevision:before.source.documentDigest,achievement:'',title:'Journey without statements'}));
  const bare=await loadLeafDocument(f.env);assert.ok(bare.ok);
  const bareId=bare.leaf.achievements!.find(a=>!a.claims.length)!.id;
  await assert.rejects(journeyAction(grant(bareId,bare.source.documentDigest),f.env,createAssessmentConnection({}),workflow),/Add a journey statement before enabling updates/);
  assert.equal(workflow.snapshot().maintenance,undefined,'a refused permission records nothing');
  const empty=renderJourneyWorkspace(bare,ready,workflow.snapshot(),{},{achievement:bareId});
  assert.ok(!empty.includes(consent),'no consent for a journey with nothing to update');
  assert.match(permission(empty),new RegExp(`<p class="journey-update-gate" role="status">Add a journey statement first · <a href="/leaf/presentation\\?edit=claim&amp;achievement=${encodeURIComponent(bareId)}">Add statement</a></p>`));

  // Collection not scheduled is not a refusal: consent is asked for, unticked, and recorded as before.
  assert.equal(workflow.snapshot().schedule,null);
  const open=renderJourneyWorkspace(bare,ready,workflow.snapshot(),{},{achievement:f.achievement});
  assert.ok(open.includes(`<input type="checkbox" ${consent} required>`),'consent is asked for once every gate passes');
  assert.doesNotMatch(open,/journey-update-gate/);
  assert.match(open,/Collection isn&#39;t scheduled · <a href="#updates">Set rhythm<\/a>/);
  assert.deepEqual(await journeyAction(grant(f.achievement,bare.source.documentDigest),f.env,createAssessmentConnection({}),workflow),{notice:'Enabled'});
  assert.equal(workflow.snapshot().maintenance?.grants.length,1,'the permission is recorded while Collection waits');
 } finally {await workflow.close();}
});
