/**
 * JEV CHECKS EVERY DRAFT — keep rises, pass sinks, nothing is decided.
 *
 * Protocol tests over real temp repositories and synthetic harvests. Provider replies come from an
 * injected stub transport: no request leaves the machine and no real key is read.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseHarvestDocument, type HarvestDocument } from '@foliage/photosynthesis';
import { openWorkflow, type WorkflowSnapshot } from './workflow.ts';
import { decideJevPool, prepareJevPoolSelection } from './jevPoolDecision.ts';
import {
  JEV_SOURCE_POLICY, candidateJevStatus, jevCheckOrder, jevGrantedSources, jevPermissionRevision, jevQueueView,
  parseJevWorkflow, prepareCandidateJev, type JevAccess, type JevWorkflowState,
} from './jevWorkflow.ts';
import { renderJevWorkflow } from './jevWorkflowPage.ts';

const schedule={cadence:'daily',day:'Monday',time:'09:00',timezone:'UTC',quiet:false,start:'18:00',end:'08:00',paused:false};
const KEY={TYPESAFE_API_KEY:'protocol-only-not-a-secret'};
const ref=(n:number)=>n.toString(16).padStart(40,'0');
const access: JevAccess={grant:'grant-1',source:'source-1',email:'synthetic@foliage.invalid'};

function harvest(doc: unknown): HarvestDocument {
  const parsed=parseHarvestDocument(doc);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.harvest;
}
const evidence=(n:number, subject:string)=>({source:'git',ref:ref(n),observedAt:'2026-09-01T00:00:00Z',authoredAt:`2026-09-${String(n%28+1).padStart(2,'0')}T00:00:00Z`,excerpt:subject});
const candidate=(id:string, items:readonly (readonly [number,string])[], review:Record<string,unknown>={state:'candidate'}, title=`synthetic ${id}`)=>({
  id,title,evidence:items.map(([n,s])=>evidence(n,s)),extractor:'git-cluster',draftedAt:'2026-09-01T00:00:00Z',review});
const approved=(at:string)=>({state:'approved',by:'Synthetic Reviewer',at});

/** A stub transport on the provider's one allowed URL: answers from a table keyed by the draft's text. */
function stubTransport(answer:(material:string)=>{decision:string;reason:string;confidence?:number}|'unavailable'|number) {
  const calls: {material:string; context:string[]}[]=[];
  const fetcher=async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const material=String(body.state?.material??'');
    calls.push({material,context:(body.state?.existingContext??[]).map((c:{text:string})=>c.text)});
    const a=answer(material);
    if(a==='unavailable') return new Response('',{status:503});
    if(typeof a==='number') return new Response('',{status:a});
    const confidence=a.confidence??.99;
    return Response.json({model:'jev-1.13.0',answers:{decision:{type:'choice',choice:a.decision,confidence},reason:{type:'choice',choice:a.reason,confidence}}});
  };
  return {calls,fetcher};
}

test('a draft is sent as its own commit subjects, with the same lineage\'s approved subjects as context (D12)', async()=>{
  const h=harvest({repo:'/synthetic/repo',candidates:[
    candidate('git-cluster:feat',[[1,'feat: first shipped piece'],[2,'feat: second shipped piece']],approved('2026-09-02T00:00:00Z'),'A reviewer title that never leaves'),
    candidate('git-cluster:feat:2',[[4,'feat: newer work'],[3,'feat: older work']]),
    candidate('git-cluster:fix',[[5,'fix: unrelated lineage']],approved('2026-09-03T00:00:00Z')),
    candidate('git-cluster:feat:3',[[7,'feat: work the owner rejected']],{state:'rejected',by:'Synthetic Reviewer',at:'2026-09-04T00:00:00Z',reason:'synthetic'}),
  ]});
  const prepared=prepareCandidateJev(h,'git-cluster:feat:2',access);
  assert.ok(prepared.ok);
  assert.equal(prepared.selection.material.id,'git-cluster:feat:2');
  assert.equal(prepared.selection.material.text,'feat: newer work\nfeat: older work');
  assert.deepEqual(prepared.selection.material.evidenceRefs,[ref(4),ref(3)]);
  assert.deepEqual(prepared.selection.existingContext.map(c=>c.text),['feat: first shipped piece\nfeat: second shipped piece']);
  assert.ok(!JSON.stringify(prepared.selection).includes('A reviewer title'),'reviewer titles never leave');
  assert.ok(!JSON.stringify(prepared.selection).includes('unrelated lineage'),'another lineage is not context');
  assert.ok(!JSON.stringify(prepared.selection).includes('the owner rejected'),'rejected work is never context');
  assert.equal(prepared.selection.pool,'source:source-1');
  assert.equal(prepared.selection.policyRevision,JEV_SOURCE_POLICY);

  // With context, a confident duplicate is a pass, no longer forced to inconsistent.
  const {fetcher}=stubTransport(()=>({decision:'pass',reason:'duplicate',confidence:.95}));
  const receipt=await decideJevPool(prepared.selection,{provider:'typesafe',selectionDigest:prepared.selectionDigest},KEY,fetcher);
  assert.equal(receipt.outcome,'pass');
  assert.equal(receipt.reason,'duplicate');
  // Generation one has nothing approved before it: the same answer is inconsistent there.
  const first=harvest({repo:'/synthetic/repo',candidates:[candidate('git-cluster:docs',[[6,'docs: a page']])]});
  const alone=prepareCandidateJev(first,'git-cluster:docs',access);
  assert.ok(alone.ok);
  assert.deepEqual(alone.selection.existingContext,[]);
  const forced=await decideJevPool(alone.selection,{provider:'typesafe',selectionDigest:alone.selectionDigest},KEY,fetcher);
  assert.equal(forced.reason,'inconsistent_decision');
});

test('eight context items of the largest size still fit one selection; the oldest drop first', ()=>{
  const big=(n:number)=>Array.from({length:30},(_,i)=>[n*100+i,`feat: ${String(n).repeat(3)} ${'x'.repeat(120)} ${i}`] as const);
  const approvals=Array.from({length:10},(_,n)=>candidate(n===0?'git-cluster:feat':`git-cluster:feat:${n+1}`,big(n+1),approved(`2026-09-${String(n+1).padStart(2,'0')}T00:00:00Z`)));
  const h=harvest({repo:'/synthetic/repo',candidates:[...approvals,candidate('git-cluster:feat:11',big(20).slice(0,32))]});
  const prepared=prepareCandidateJev(h,'git-cluster:feat:11',access);
  assert.ok(prepared.ok);
  const context=prepared.selection.existingContext;
  assert.ok(context.length>0 && context.length<=8);
  assert.ok(context.every(c=>c.text.length<=4000));
  // Each approval's subjects join past 4,000 characters, so every item here is cut to fit.
  const subjectsOf=new Map(approvals.map(a=>[a.id,a.evidence.map(e=>e.excerpt)]));
  for(const c of context) {
    const subjects=subjectsOf.get(c.id)!;
    const lines=c.text.split('\n');
    assert.ok(lines.length<subjects.length,`${c.id} is cut to fit`);
    assert.deepEqual(lines,subjects.slice(0,lines.length),`${c.id}: whole subjects, newest first; a subject is never cut`);
  }
  assert.equal(context[0]!.id,'git-cluster:feat:10','newest approval first');
  assert.ok(!context.some(c=>c.id==='git-cluster:feat'),'the oldest approval is the one left out');
  assert.ok(Buffer.byteLength(JSON.stringify(prepared.selection))<=24000);
  assert.doesNotThrow(()=>prepareJevPoolSelection(prepared.selection));
});

test('the byte budget, not the item cap, decides: context is kept while the whole selection fits 24,000 bytes, oldest dropped first', ()=>{
  // Five approvals, under the cap of eight. Four fit with a few dozen bytes to spare; the fifth does not.
  const h=harvest({repo:'/synthetic/repo',candidates:[
    candidate('git-cluster:feat',[[1,'feat: the oldest approval']],approved('2026-09-01T00:00:00Z')),
    ...[2,3,4,5].map(n=>candidate(`git-cluster:feat:${n}`,[[n,`feat: approval ${n} ${'y'.repeat(1900)}`]],approved(`2026-09-0${n}T00:00:00Z`))),
    candidate('git-cluster:feat:6',[[10,`feat: open draft ${'z'.repeat(15190)}`]]),
  ]});
  const prepared=prepareCandidateJev(h,'git-cluster:feat:6',access);
  assert.ok(prepared.ok,JSON.stringify(prepared));
  const kept=prepared.selection.existingContext;
  assert.deepEqual(kept.map(c=>c.id),[5,4,3,2].map(n=>`git-cluster:feat:${n}`),'the four newest, newest first');
  const bytes=Buffer.byteLength(JSON.stringify(prepared.selection));
  assert.ok(bytes<=24000 && bytes>24000-50,`the kept selection sits just under the budget: ${bytes}`);
  const oneMore={...prepared.selection,existingContext:[...kept,{id:'git-cluster:feat',text:'feat: the oldest approval'}]};
  assert.ok(Buffer.byteLength(JSON.stringify(oneMore))>24000,'the oldest approval would push it over');
  assert.doesNotThrow(()=>prepareJevPoolSelection(prepared.selection));
});

test('context is at most the eight newest approvals of the lineage, and each one Jev would refuse is left out', ()=>{
  const small=Array.from({length:10},(_,n)=>candidate(`git-cluster:feat:${n+2}`,[[n+1,`feat: approved ${n+2}`]],approved(`2026-09-${String(n+1).padStart(2,'0')}T00:00:00Z`)));
  const h=harvest({repo:'/synthetic/repo',candidates:[...small,candidate('git-cluster:feat',[[50,'feat: open draft']])]});
  const prepared=prepareCandidateJev(h,'git-cluster:feat',access);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.selection.existingContext.map(c=>c.id),[11,10,9,8,7,6,5,4].map(n=>`git-cluster:feat:${n}`),'the eight newest, newest first');
  assert.doesNotThrow(()=>prepareJevPoolSelection(prepared.selection));
  // An approval with no commit subjects, and one whose id Jev would refuse, are left out; the draft is still sent.
  const prefix='p'.repeat(240);
  const odd=harvest({repo:'/synthetic/repo',candidates:[
    candidate(`git-cluster:${prefix}:10000`,[[1,`${prefix}: approved, id too long`]],approved('2026-09-03T00:00:00Z')),
    {...candidate(`git-cluster:${prefix}:2`,[]),evidence:[{source:'git',ref:ref(2),observedAt:'2026-09-01T00:00:00Z'}],review:approved('2026-09-02T00:00:00Z')},
    candidate(`git-cluster:${prefix}:3`,[[3,`${prefix}: approved and fine`]],approved('2026-09-01T00:00:00Z')),
    candidate(`git-cluster:${prefix}`,[[4,`${prefix}: open draft`]]),
  ]});
  const kept=prepareCandidateJev(odd,`git-cluster:${prefix}`,access);
  assert.ok(kept.ok,JSON.stringify(kept));
  assert.deepEqual(kept.selection.existingContext.map(c=>c.id),[`git-cluster:${prefix}:3`]);
  // An approval whose id Jev would trim is never sent under another name.
  const spaced=harvest({repo:'/synthetic/repo',candidates:[
    candidate('git-cluster:feat ',[[1,'feat : approved with a trailing space']],approved('2026-09-02T00:00:00Z')),
    candidate('git-cluster:feat :2',[[2,'feat : open draft']]),
  ]});
  const trimmed=prepareCandidateJev(spaced,'git-cluster:feat :2',access);
  assert.ok(trimmed.ok,JSON.stringify(trimmed));
  assert.deepEqual(trimmed.selection.existingContext,[]);
});

test('any harvest that parses gives every draft a named standing: nothing throws (review stays up, the pass goes on)', ()=>{
  const long='git-cluster:'+'a'.repeat(300);
  const h=harvest({repo:'/synthetic/repo',candidates:[
    candidate(long,[[1,'a long id: the colon sits late']]),
    {...candidate('git-cluster:longref',[[2,'longref: one ref']]),evidence:[{...evidence(2,'longref: one ref'),ref:'r'.repeat(300)}]},
    {...candidate('git-cluster:trimref',[[3,'trimref: a'],[4,'trimref: b']]),evidence:[{...evidence(3,'trimref: a'),ref:'abc'},{...evidence(4,'trimref: b'),ref:' abc'}]},
    {...candidate('git-cluster:dupref',[[5,'dupref: a'],[6,'dupref: b']]),evidence:[{...evidence(5,'dupref: a'),ref:'abc'},{...evidence(6,'dupref: b'),ref:'abc'}]},
    candidate('git-cluster:spaced ',[[7,'spaced : trailing space in the id']]),
    candidate('git-cluster:wide',Array.from({length:32},(_,i)=>[100+i,`wide: ${'w'.repeat(600)} ${i}`] as const)),
    candidate('git-cluster:heavy',Array.from({length:30},(_,i)=>[200+i,`heavy: ${'€'.repeat(500)} ${i}`] as const)),
    candidate('git-cluster:docs',[[8,'docs: fine']]),
  ]});
  const cause=(id:string)=>{const p=prepareCandidateJev(h,id,access);return p.ok?'ok':p.cause;};
  assert.equal(cause(long),'too-large','an id over 256 characters');
  assert.equal(cause('git-cluster:longref'),'too-large','a ref over 256 characters');
  assert.equal(cause('git-cluster:wide'),'too-large','more than 16,000 characters of subjects');
  assert.equal(cause('git-cluster:heavy'),'too-large','more than 24,000 bytes of subjects');
  assert.equal(cause('git-cluster:trimref'),'unsendable','refs that repeat once trimmed');
  assert.equal(cause('git-cluster:dupref'),'unsendable','refs that repeat');
  assert.equal(cause('git-cluster:spaced '),'unsendable','an id Jev would trim is never sent under another name');
  assert.equal(cause('git-cluster:docs'),'ok');
  assert.deepEqual(jevCheckOrder(undefined,h,access),['git-cluster:docs']);
  const view=jevQueueView(undefined,h,access);
  assert.equal(view.marks.size,0);
  assert.equal(view.retry.size,0);
});

test('a receipt binds to the refs as written: a draft whose ref Jev would trim is never sent', ()=>{
  // Neither ref repeats once trimmed, so Jev's own rules accept the selection; only the exact binding refuses it.
  const h=harvest({repo:'/synthetic/repo',candidates:[
    {...candidate('git-cluster:padref',[[1,'padref: a'],[2,'padref: b']]),evidence:[{...evidence(1,'padref: a'),ref:'abc'},{...evidence(2,'padref: b'),ref:' def'}]},
    {...candidate('git-cluster:tailref',[[3,'tailref: a']]),evidence:[{...evidence(3,'tailref: a'),ref:'ghi '}]},
  ]});
  for(const id of ['git-cluster:padref','git-cluster:tailref']) {
    const prepared=prepareCandidateJev(h,id,access);
    assert.deepEqual(prepared,{ok:false,cause:'unsendable'},id);
  }
  assert.deepEqual(jevCheckOrder(undefined,h,access),[]);
});

test('an interrupted check is never taken: three interrupted drafts leave the slots to the unchecked one', ()=>{
  const h=harvest({repo:'/synthetic/repo',candidates:[
    candidate('git-cluster:a',[[1,'a: oldest, unchecked']]),
    candidate('git-cluster:b',[[2,'b: interrupted']]),
    candidate('git-cluster:c',[[3,'c: interrupted']]),
    candidate('git-cluster:d',[[4,'d: newest, interrupted']]),
  ]});
  const attempts=['git-cluster:b','git-cluster:c','git-cluster:d'].map(id=>{
    const prepared=prepareCandidateJev(h,id,access);
    assert.ok(prepared.ok);
    return {id:`attempt-${id}`,grant:'grant-1',packet:id,selectionDigest:prepared.selectionDigest,startedAt:'2026-09-02T00:00:00.000Z',status:'interrupted' as const};
  });
  const jev: JevWorkflowState=parseJevWorkflow({grants:[{id:'grant-1',source:'source-1',caller:'photosynthesis',provider:'typesafe',policyRevision:JEV_SOURCE_POLICY,grantedAt:'2026-09-01T00:00:00.000Z'}],attempts});
  assert.deepEqual(jevCheckOrder(jev,h,access),['git-cluster:a']);
});

test('a draft Jev may not see is named, and costs nothing', ()=>{
  const h=harvest({repo:'/synthetic/repo',candidates:[
    candidate('git-cluster:feat',[[1,'feat: done']],approved('2026-09-02T00:00:00Z')),
    {...candidate('photo:one',[[2,'a photo']]),extractor:'photo'},
    {id:'git-cluster:chore',title:'untitled',evidence:[{source:'git',ref:ref(3),observedAt:'2026-09-01T00:00:00Z'}],extractor:'git-cluster',draftedAt:'2026-09-01T00:00:00Z',review:{state:'candidate'}},
    candidate('git-cluster:perf',Array.from({length:33},(_,i)=>[100+i,`perf: step ${i}`] as const)),
    candidate('git-cluster:docs',[[4,'docs: fine']]),
    // A git id is not enough: one excerpt from anywhere else and nothing of the draft is sent.
    {...candidate('git-cluster:mixed',[[5,'mixed: a commit subject']]),evidence:[evidence(5,'mixed: a commit subject'),{source:'photo',ref:'photo-1',observedAt:'2026-09-01T00:00:00Z',excerpt:'a private photo caption'}]},
  ]});
  const cause=(id:string, a:JevAccess|null=access)=>{const p=prepareCandidateJev(h,id,a??undefined);return p.ok?'ok':p.cause;};
  assert.equal(cause('git-cluster:gone'),'missing');
  assert.equal(cause('git-cluster:feat'),'decided');
  assert.equal(cause('photo:one'),'not-git');
  assert.equal(cause('git-cluster:mixed'),'not-git','only commit subjects may leave');
  // CONTROL: the same rule holds for context. An approval with one excerpt from anywhere else adds nothing.
  const lineage=harvest({repo:'/synthetic/repo',candidates:[
    {...candidate('git-cluster:feat',[[1,'feat: beside a photo']],approved('2026-09-03T00:00:00Z')),evidence:[evidence(1,'feat: beside a photo'),{source:'photo',ref:'photo-1',observedAt:'2026-09-01T00:00:00Z',excerpt:'a private photo caption'}]},
    candidate('git-cluster:feat:2',[[2,'feat: all git']],approved('2026-09-02T00:00:00Z')),
    candidate('git-cluster:feat:3',[[3,'feat: open draft']]),
  ]});
  const withContext=prepareCandidateJev(lineage,'git-cluster:feat:3',access);
  assert.ok(withContext.ok,JSON.stringify(withContext));
  assert.deepEqual(withContext.selection.existingContext,[{id:'git-cluster:feat:2',text:'feat: all git'}]);
  assert.ok(!JSON.stringify(withContext.selection).includes('photo caption'),'a photo caption never leaves as context');
  assert.ok(!JSON.stringify(withContext.selection).includes('beside a photo'),'nor the git subjects beside it');
  assert.equal(cause('git-cluster:chore'),'untitled');
  assert.equal(cause('git-cluster:perf'),'too-large');
  assert.equal(cause('git-cluster:docs',null),'no-grant');
  assert.equal(cause('git-cluster:docs'),'ok');
  assert.deepEqual(jevCheckOrder(undefined,h,access),['git-cluster:docs'],'only the eligible draft is ever taken');
});

test('a mark holds only for the exact selection and grant it was made for', ()=>{
  const base=[candidate('git-cluster:feat',[[2,'feat: newer'],[1,'feat: older']])];
  const h=harvest({repo:'/synthetic/repo',candidates:base});
  const prepared=prepareCandidateJev(h,'git-cluster:feat',access);
  assert.ok(prepared.ok);
  const receipt={selectionDigest:prepared.selectionDigest,caller:'photosynthesis' as const,subject:prepared.selection.subject,pool:'source:source-1',material:'git-cluster:feat',
    documentRevision:prepared.selection.documentRevision,policyRevision:JEV_SOURCE_POLICY,evidenceRefs:[ref(2),ref(1)],outcome:'keep' as const,reason:'meaningful_work' as const,
    provider:'typesafe' as const,model:'jev-1.13.0' as const,checkedAt:'2026-09-02T00:00:00.000Z'};
  const jev: JevWorkflowState={grants:[{id:'grant-1',source:'source-1',caller:'photosynthesis',provider:'typesafe',policyRevision:JEV_SOURCE_POLICY,grantedAt:'2026-09-01T00:00:00.000Z'}],
    attempts:[{id:'a1',grant:'grant-1',packet:'git-cluster:feat',selectionDigest:prepared.selectionDigest,startedAt:'2026-09-02T00:00:00.000Z',status:'completed',receipt}]};
  assert.doesNotThrow(()=>parseJevWorkflow(jev),'a candidate id binds like a packet id did');
  assert.equal(jevQueueView(jev,h,access).marks.get('git-cluster:feat'),'keep');
  // A retitle is not new material.
  const retitled=harvest({repo:'/synthetic/repo',candidates:[{...base[0],title:'a local model title'}]});
  assert.equal(jevQueueView(jev,retitled,access).marks.get('git-cluster:feat'),'keep');
  // A changed draft is unchecked again.
  const grown=harvest({repo:'/synthetic/repo',candidates:[candidate('git-cluster:feat',[[3,'feat: newest'],[2,'feat: newer'],[1,'feat: older']])]});
  assert.equal(jevQueueView(jev,grown,access).marks.size,0);
  assert.equal(candidateJevStatus(jev,grown,'git-cluster:feat',access).kind,'unchecked');
  // A new approval in the lineage changes what Jev would be told: unchecked again.
  const context=harvest({repo:'/synthetic/repo',candidates:[...base,candidate('git-cluster:feat:2',[[9,'feat: approved later']],approved('2026-09-03T00:00:00Z'))]});
  assert.equal(jevQueueView(jev,context,access).marks.size,0);
  // A revoked grant, or another grant, drops the mark.
  assert.equal(jevQueueView(jev,h,undefined).marks.size,0);
  assert.equal(jevQueueView(jev,h,{...access,grant:'grant-2'}).marks.size,0);
  // Interrupted and failed checks may be retried by the owner; a current mark may not.
  const interrupted={...jev,attempts:[{...jev.attempts[0]!,status:'interrupted' as const,receipt:undefined}]};
  assert.deepEqual([...jevQueueView(interrupted,h,access).retry],['git-cluster:feat']);
  const failed={...jev,attempts:[{...jev.attempts[0]!,receipt:{...receipt,outcome:'unresolved' as const,reason:'provider_unavailable' as const,detail:'provider returned HTTP 503'}}]};
  assert.deepEqual([...jevQueueView(failed,h,access).retry],['git-cluster:feat']);
  assert.equal(jevQueueView(jev,h,access).retry.size,0);
  // CONTROL: automatic checking takes neither again; only the owner does.
  assert.deepEqual(jevCheckOrder(failed,h,access),[],'a check the provider did not answer is never taken by a pass');
  assert.deepEqual(jevCheckOrder(interrupted,h,access),[]);
  assert.deepEqual(jevCheckOrder(jev,h,access),[]);
});

/** The version 1 policy revision as it shipped: commit titles only, no context. */
const V1_POLICY='sha256:55ce642db5c5372cda82b143ee28e7b9795d0c3055f6883edf511c5736d13195';

test('a version 1 grant no longer allows anything', ()=>{
  const v1=V1_POLICY;
  assert.notEqual(JEV_SOURCE_POLICY,v1);
  const state={sources:[{id:'s',path:'/synthetic/repo',email:'synthetic@foliage.invalid',enabled:true}],
    jev:{grants:[{id:'g',source:'s',caller:'photosynthesis' as const,provider:'typesafe' as const,policyRevision:v1,grantedAt:'2026-09-01T00:00:00.000Z'}],attempts:[]}};
  assert.deepEqual(jevGrantedSources(state),[]);
  assert.deepEqual(jevGrantedSources({...state,jev:{...state.jev,grants:[{...state.jev.grants[0]!,policyRevision:JEV_SOURCE_POLICY}]}}).map(s=>s.grant),['g']);
  assert.deepEqual(jevGrantedSources({...state,sources:[{...state.sources[0]!,enabled:false}],jev:{...state.jev,grants:[{...state.jev.grants[0]!,policyRevision:JEV_SOURCE_POLICY}]}}),[],'a paused source carries no Jev');
});

/** A temp repository whose commits carry chosen author dates, and a garden around it. */
async function gardenWithRepo(commits: readonly (readonly [string,string])[]) {
  const dir=await realpath(await mkdtemp(join(tmpdir(),'foliage-jev-queue-')));
  const repo=join(dir,'repo');await mkdir(repo);
  const email='synthetic@foliage.invalid';
  const git=(env:Record<string,string>,...args:string[])=>execFileSync('git',['-C',repo,'-c','commit.gpgsign=false',...args],{encoding:'utf8',env:{...process.env,...env}}).trim();
  git({},'init','-q','--initial-branch=main');git({},'config','user.email',email);git({},'config','user.name','Synthetic Author');
  let n=0;
  const commit=async(subject:string,date:string)=>{n++;await writeFile(join(repo,`r${n}.txt`),`synthetic ${n}\n`);git({},'add',`r${n}.txt`);git({GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date},'commit','-q','-m',subject);};
  for(const [subject,date] of commits) await commit(subject,date);
  return {dir,repo,email,commit,harvestPath:join(dir,'harvest.json'),state:join(dir,'state')};
}

async function openGranted(g: Awaited<ReturnType<typeof gardenWithRepo>>, fetcher: typeof fetch, env: Record<string,string>=KEY) {
  const app=await openWorkflow(g.state,{env,fetcher,harvestPath:g.harvestPath});
  if(!app.snapshot().sources.length) {
    await app.command({action:'source',path:g.repo,email:g.email,authorized:true});
    await app.command({action:'schedule',schedule});
  }
  const source=app.snapshot().sources[0]!.id;
  if(!app.snapshot().jev?.grants.some(gr=>!gr.revokedAt)) await app.command({action:'jev-grant',source,revision:jevPermissionRevision(app.snapshot()),consent:'typesafe-source-commit-titles'});
  return {app,source};
}

const FIVE=[
  ['feat: keep the oldest','2026-01-01T00:00:00Z'],
  ['fix: pass the second','2026-02-01T00:00:00Z'],
  ['docs: keep the middle','2026-03-01T00:00:00Z'],
  ['perf: unsure about this','2026-04-01T00:00:00Z'],
  ['test: pass the newest','2026-05-01T00:00:00Z'],
] as const;
const answers=(material:string)=>material.includes('keep')?{decision:'keep',reason:'meaningful_work'}:material.includes('pass')?{decision:'pass',reason:'outside_purpose'}:{decision:'unresolved',reason:'insufficient_context'};

test('Jev checks every open draft newest work first, three per pass, and never writes the queue (D14, decision 2)', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden(FIVE,stub.fetcher);
  // The queue as collection left it, before Jev has checked anything.
  const queued=await readFile(g.harvestPath,'utf8');
  const {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date());
    assert.deepEqual(stub.calls.map(c=>c.material),['test: pass the newest','perf: unsure about this','docs: keep the middle'],'newest author date first, three in the first pass');
    await app.tick(new Date());
    assert.deepEqual(stub.calls.slice(3).map(c=>c.material),['fix: pass the second','feat: keep the oldest'],'the rest in the next pass');
    await app.tick(new Date());
    assert.equal(stub.calls.length,5,'a checked draft is not checked again');
    // CONTROL (decision 2): no Jev path writes a review state, a title or evidence.
    assert.equal(await readFile(g.harvestPath,'utf8'),queued,'harvest.json is byte-identical to the collected queue after Jev checked every draft');
    assert.doesNotMatch(queued,/selectionDigest|"jev"|"outcome"|"receipt"|"keep"|"pass"/,'receipts never enter the harvest');
    const h=harvest(JSON.parse(queued));
    assert.ok(h.candidates.every(c=>c.review.state==='candidate'),'nothing is approved or rejected');
    const view=await app.jevView(h);
    assert.deepEqual(Object.fromEntries(view.marks),{'git-cluster:feat':'keep','git-cluster:docs':'keep','git-cluster:fix':'pass','git-cluster:test':'pass','git-cluster:perf':'unresolved'});
    assert.equal(app.snapshot().history.filter(line=>line.status==='jev-unavailable').length,0);
    assert.ok(!JSON.stringify(app.snapshot().jev).includes('keep the'),'receipts omit raw titles');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a new commit on checked work is a changed draft, and Jev checks it again', {timeout:60_000}, async()=>{
  const g=await gardenWithRepo([['feat: keep one','2026-01-01T00:00:00Z']]);
  const stub=stubTransport(answers);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,1);
    await g.commit('feat: keep two','2026-02-01T00:00:00Z');
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,2,'the grown draft is new material');
    assert.equal(stub.calls[1]!.material,'feat: keep two\nfeat: keep one');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('an ineligible draft costs no request and no history line; no key means no attempt (D13)', {timeout:60_000}, async()=>{
  const g=await gardenWithRepo([['feat: keep one','2026-01-01T00:00:00Z']]);
  const stub=stubTransport(answers);
  let {app}=await openGranted(g,stub.fetcher,{});
  try {
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,0,'unconfigured: nothing is sent');
    assert.equal(app.snapshot().jev!.attempts.length,0,'and nothing is recorded');
    await app.close();
    // Only an ineligible draft is open: an imported one beside a decided git draft.
    const h=JSON.parse(await readFile(g.harvestPath,'utf8'));
    h.candidates=[{...h.candidates[0],review:{state:'approved',by:'Synthetic Reviewer',at:'2026-09-02T00:00:00Z'}},
      {...h.candidates[0],id:'photo:one',extractor:'photo'}];
    await writeFile(g.harvestPath,`${JSON.stringify(h,null,2)}\n`);
    ({app}=await openGranted(g,stub.fetcher));
    const before=app.snapshot().history.length;
    for(let pass=0;pass<3;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,0);
    assert.equal(app.snapshot().history.length,before);
    await assert.rejects(app.decideCandidate('photo:one'),/Not a git draft/);
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Already decided/);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a provider failure stops the pass with one history line, however many passes fail', {timeout:60_000}, async()=>{
  const g=await gardenWithRepo(FIVE);
  let status=503;
  const stub=stubTransport(()=>status);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,1,'the first failure stops the pass');
    for(let pass=0;pass<2;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,3,'one request per pass');
    const lines=app.snapshot().history.filter(line=>line.status==='jev-unavailable');
    assert.equal(lines.length,1);
    assert.match(lines[0]!.detail,/503/);
    const h=harvest(JSON.parse(await readFile(g.harvestPath,'utf8')));
    const view=await app.jevView(h);
    assert.equal(view.marks.get('git-cluster:test'),undefined,'a failure places no row above or below');
    assert.equal(view.retry.size,3,'each failed check may be retried by the owner');
    // A different failure is its own line: the owner never reads a stale reason.
    status=500;
    for(let pass=0;pass<2;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,5);
    assert.deepEqual(app.snapshot().history.filter(line=>line.status==='jev-unavailable').map(line=>line.detail),
      ['provider returned HTTP 500','provider returned HTTP 503'],'one line per distinct failure, newest first');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

/** A garden whose queue is collected with no key set, so Jev has checked nothing yet; then reopened as given. */
async function collectedGarden(commits: readonly (readonly [string,string])[], fetcher: typeof fetch) {
  const g=await gardenWithRepo(commits);
  const quiet=await openGranted(g,fetcher,{});
  await quiet.app.tick(new Date(),true);
  await quiet.app.close();
  return g;
}
const jevLines=(app: Awaited<ReturnType<typeof openWorkflow>>)=>app.snapshot().history.filter(line=>line.status==='jev-unavailable').length;

test('Jev sends nothing while the schedule is paused or in quiet hours', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden(FIVE,stub.fetcher);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    const noon=new Date('2026-09-28T12:00:00Z');
    await app.command({action:'schedule',schedule:{...schedule,paused:true}});
    await app.tick(noon);
    await app.command({action:'schedule',schedule:{...schedule,quiet:true,start:'00:01',end:'00:00'}});
    await app.tick(noon);
    // The owner's Collect now runs in quiet hours; the Jev pass after it does not.
    await app.tick(noon,true);
    assert.deepEqual([app.snapshot().history[0]!.at,app.snapshot().history[0]!.run!.trigger],[noon.toISOString(),'manual'],'the collect ran');
    assert.equal(stub.calls.length,0,'no request');
    assert.equal(app.snapshot().jev!.attempts.length,0,'no attempt');
    assert.equal(jevLines(app),0,'and no failure line');
    await app.command({action:'schedule',schedule});
    await app.tick(noon);
    assert.equal(stub.calls.length,3,'resumed, the checks run');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

/** Quiet hours from an hour before now to an hour after, in UTC: the clock is inside them whenever the test runs. */
const hhmm=(offset:number)=>new Date(Date.now()+offset).toISOString().slice(11,16);
for(const [stop,held] of [
  ['the owner pauses the schedule',()=>({...schedule,paused:true})],
  ['quiet hours begin',()=>({...schedule,quiet:true,start:hhmm(-3_600_000),end:hhmm(3_600_000)})],
] as const) test(`CONTROL: a pass stops sending the moment ${stop}, and records no failure`, {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden(FIVE,stub.fetcher);
  // The provider holds the pass's first request until the owner has changed the schedule.
  let release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let sending!: () => void;
  const sent=new Promise<void>(resolve=>{sending=resolve;});
  const fetcher=async(url:unknown,init?:RequestInit)=>{sending();await gate;return stub.fetcher(url,init);};
  const {app}=await openGranted(g,fetcher);
  try {
    const pass=app.tick(new Date());
    await sent;
    const changed=app.command({action:'schedule',schedule:held()});
    release();
    await Promise.all([pass,changed]);
    assert.deepEqual(stub.calls.map(c=>c.material),['test: pass the newest'],'only the request already sent');
    assert.equal(app.snapshot().jev!.attempts.length,1,'no attempt after the stop');
    assert.equal(jevLines(app),0,'a stop the owner chose is not a Jev failure');
    assert.ok(!app.snapshot().history.some(line=>/paused/i.test(line.detail)),'and leaves no line');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a grant acts only for a checkout of the queue\'s own repository', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  const other=await gardenWithRepo([['chore: another repository','2026-01-01T00:00:00Z']]);
  let app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
  try {
    // Source A is another repository and holds the grant; source B checks out the queue's repository and holds none.
    const own=app.snapshot().sources.find(s=>s.path===g.repo)!.id;
    await app.command({action:'jev-revoke',source:own,revision:jevPermissionRevision(app.snapshot())});
    await app.command({action:'source',path:other.repo,email:g.email,authorized:true});
    const foreign=app.snapshot().sources.find(s=>s.path===other.repo)!.id;
    await app.command({action:'jev-grant',source:foreign,revision:jevPermissionRevision(app.snapshot()),consent:'typesafe-source-commit-titles'});
    await app.tick(new Date());
    assert.equal(stub.calls.length,0,'another repository\'s grant sends nothing of this one');
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
    assert.equal((await app.jevView(harvest(JSON.parse(await readFile(g.harvestPath,'utf8'))))).marks.size,0);
    // A queue that records no repository is covered by no grant.
    await app.close();
    const h=JSON.parse(await readFile(g.harvestPath,'utf8'));
    delete h.repo;
    await writeFile(g.harvestPath,`${JSON.stringify(h,null,2)}\n`);
    ({app}=await openGranted(g,stub.fetcher));
    await app.command({action:'jev-grant',source:own,revision:jevPermissionRevision(app.snapshot()),consent:'typesafe-source-commit-titles'});
    await app.tick(new Date());
    assert.equal(stub.calls.length,0,'no repository, no request');
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});await rm(other.dir,{recursive:true,force:true});}
});

test('CONTROL: a grant on a checkout that cannot be read sends nothing: a moved checkout is not the queue\'s repository', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  // The checkout moves; the queue names its new place, the saved source still names the old one.
  const moved=`${g.repo}-moved`;
  await rename(g.repo,moved);
  const h=JSON.parse(await readFile(g.harvestPath,'utf8'));
  h.repo=moved;
  await writeFile(g.harvestPath,`${JSON.stringify(h,null,2)}\n`);
  const app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
  try {
    assert.ok(app.snapshot().jev!.grants.some(gr=>!gr.revokedAt),'the grant is still active');
    for(let pass=0;pass<3;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,0,'an unreadable checkout sends nothing');
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
    assert.equal(stub.calls.length,0);
    assert.equal((await app.jevView(harvest(h))).marks.size,0);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a version 1 grant saved in the workflow sends nothing', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  const file=join(g.state,'workflow.json');
  const saved=JSON.parse(await readFile(file,'utf8'));
  saved.jev={grants:[{id:'v1-grant',source:saved.sources[0].id,caller:'photosynthesis',provider:'typesafe',policyRevision:V1_POLICY,grantedAt:'2026-09-01T00:00:00.000Z'}],attempts:[]};
  await writeFile(file,JSON.stringify(saved));
  const app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
  try {
    await app.tick(new Date());
    assert.equal(stub.calls.length,0);
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('CONTROL: a pass never sends a check the provider did not answer again; every attempt is kept', {timeout:60_000}, async()=>{
  let down=true;
  const stub=stubTransport(m=>down?'unavailable':answers(m));
  const g=await collectedGarden(FIVE,stub.fetcher);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    for(let pass=0;pass<8;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,5,'each draft is sent once, then never again without the owner');
    assert.equal(jevLines(app),1);
    down=false;
    for(let pass=0;pass<4;pass++) await app.tick(new Date());
    assert.equal(stub.calls.length,5,'recovery sends nothing on its own');
    const h=harvest(JSON.parse(await readFile(g.harvestPath,'utf8')));
    assert.equal((await app.jevView(h)).retry.size,5,'the owner retries each from /review');
    await app.decideCandidate('git-cluster:docs');
    assert.equal(stub.calls.length,6);
    assert.equal((await app.jevView(h)).marks.get('git-cluster:docs'),'keep');
    const attempts=app.snapshot().jev!.attempts;
    assert.equal(attempts.length,6,'the failed attempt stays beside the retry: nothing is pruned');
    assert.equal(attempts.filter(a=>a.packet==='git-cluster:docs').length,2);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('CONTROL: a pass never sends a draft twice: overlapping ticks join one pass, and a check the owner makes mid-pass stands', {timeout:60_000}, async()=>{
  let answer:(material:string)=>ReturnType<typeof answers>|'unavailable'=()=>'unavailable';
  const stub=stubTransport(m=>answer(m));
  const g=await collectedGarden(FIVE,stub.fetcher);
  // The provider holds its answers until the test lets them go.
  let gate=Promise.resolve();
  let sending=()=>{};
  const hold=()=>{
    let release!: () => void;
    gate=new Promise<void>(resolve=>{release=resolve;});
    const sent=new Promise<void>(resolve=>{sending=resolve;});
    return {sent,release};
  };
  const fetcher=async(url:unknown,init?:RequestInit)=>{sending();await gate;return stub.fetcher(url,init);};
  const {app}=await openGranted(g,fetcher);
  try {
    // Three ticks in flight at once, every check failing.
    const one=hold();
    const first=app.tick(new Date());
    await one.sent;
    const ticks=Promise.all([first,app.tick(new Date()),app.tick(new Date())]);
    one.release();
    await ticks;
    assert.deepEqual(stub.calls.map(c=>c.material),['test: pass the newest'],'one pass: its first failure stops it, and the other ticks join it');
    assert.equal(jevLines(app),1,'one failure line');
    assert.equal(app.snapshot().jev!.attempts.length,1);
    // The owner checks the draft a running pass takes next; the provider fails it. The pass does not send it again.
    answer=m=>m.startsWith('docs')?'unavailable':answers(m);
    const two=hold();
    const pass=app.tick(new Date());
    await two.sent;
    const owner=app.decideCandidate('git-cluster:docs');
    two.release();
    await pass;
    assert.equal((await owner).receipt?.reason,'provider_unavailable');
    const materials=stub.calls.map(c=>c.material);
    assert.deepEqual(materials.slice(1),['perf: unsure about this','docs: keep the middle']);
    assert.equal(new Set(materials).size,materials.length,'each draft is sent once');
    assert.equal(jevLines(app),1,'still one failure line');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('CONTROL: a draft the provider keeps answering badly costs one request, however many passes run', {timeout:60_000}, async()=>{
  // A billed HTTP 200 with an answer outside the schema is unavailable too: never re-sent by a pass.
  const stub=stubTransport(m=>m.includes('newest')?{decision:'maybe',reason:'meaningful_work'}:answers(m));
  const g=await collectedGarden(FIVE,stub.fetcher);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    for(let pass=0;pass<10;pass++) await app.tick(new Date());
    assert.equal(stub.calls.filter(c=>c.material==='test: pass the newest').length,1,'sent once');
    assert.equal(stub.calls.length,5,'and it holds up no other draft');
    const view=await app.jevView(harvest(JSON.parse(await readFile(g.harvestPath,'utf8'))));
    assert.deepEqual([...view.marks.keys()].sort(),['git-cluster:docs','git-cluster:feat','git-cluster:fix','git-cluster:perf']);
    assert.deepEqual([...view.retry],['git-cluster:test']);
    assert.deepEqual(app.snapshot().history.filter(line=>line.status==='jev-unavailable').map(line=>line.detail),['invalid structured decision']);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

/** Completed checks of drafts no longer in the queue, bound to the saved grant exactly as the parser demands. */
function filler(grant:{id:string;source:string;policyRevision:string}, count:number) {
  return Array.from({length:count},(_,i)=>{
    const selectionDigest=`sha256:${createHash('sha256').update(`filler ${i}`).digest('hex')}`;
    return {id:`filler-${i}`,grant:grant.id,packet:`git-cluster:filler:${i+2}`,selectionDigest,startedAt:'2026-09-01T00:00:00.000Z',status:'completed',
      receipt:{selectionDigest,caller:'photosynthesis',subject:'synthetic-subject',pool:`source:${grant.source}`,material:`git-cluster:filler:${i+2}`,
        documentRevision:selectionDigest,policyRevision:grant.policyRevision,evidenceRefs:[ref(i+1)],outcome:'keep',reason:'meaningful_work',
        provider:'typesafe',model:'jev-1.13.0',checkedAt:'2026-09-01T00:00:00.000Z'}};
  });
}
async function padHistory(g: Awaited<ReturnType<typeof gardenWithRepo>>, count:number) {
  const file=join(g.state,'workflow.json');
  const saved=JSON.parse(await readFile(file,'utf8'));
  const grant=saved.jev.grants.find((gr:{revokedAt?:string})=>!gr.revokedAt);
  saved.jev.attempts=[...filler(grant,count),...saved.jev.attempts];
  await writeFile(file,JSON.stringify(saved));
}

test('a full Jev history stops the pass by name and prunes nothing', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  await padHistory(g,1024);
  let app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
  try {
    await app.tick(new Date());
    assert.equal(stub.calls.length,0,'nothing is sent');
    assert.equal(app.snapshot().jev!.attempts.length,1024,'nothing is pruned or added');
    assert.deepEqual(app.snapshot().history.filter(line=>line.status==='jev-unavailable').map(line=>line.detail),['Jev history full.']);
    await app.close();
    app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
    assert.equal(app.snapshot().jev!.attempts.length,1024,'the saved workflow still opens');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('at the history limit, the owner\'s retry of a check the provider did not answer is refused and nothing is pruned', {timeout:60_000}, async()=>{
  let down=true;
  const stub=stubTransport(m=>down?'unavailable':answers(m));
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  let {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date());
    assert.equal(stub.calls.length,1);
    await app.close();
    await padHistory(g,1023);
    down=false;
    app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
    const saved=app.snapshot().jev!.attempts;
    assert.equal(saved.length,1024);
    await app.tick(new Date());
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Jev history full/);
    assert.equal(stub.calls.length,1,'nothing is sent');
    assert.deepEqual(app.snapshot().jev!.attempts,saved,'the failed attempt is kept, never replaced');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a draft approved while a pass runs is skipped, and the pass checks the rest', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden(FIVE,stub.fetcher);
  let written: string|undefined;
  // The owner approves the next draft at /review while Jev answers the first.
  const fetcher=async(url:unknown,init?:RequestInit)=>{
    if(written===undefined) {
      const h=JSON.parse(await readFile(g.harvestPath,'utf8'));
      h.candidates=h.candidates.map((c:{id:string})=>c.id==='git-cluster:perf'?{...c,review:approved('2026-09-03T00:00:00Z')}:c);
      written=`${JSON.stringify(h,null,2)}\n`;
      await writeFile(g.harvestPath,written);
    }
    return stub.fetcher(url,init);
  };
  const {app}=await openGranted(g,fetcher);
  try {
    const lines=app.snapshot().history.length;
    await app.tick(new Date());
    assert.deepEqual(stub.calls.map(c=>c.material),['test: pass the newest','docs: keep the middle'],'the approved draft is skipped, the next one checked');
    assert.equal(app.snapshot().history.length,lines,'no history line');
    assert.equal(await readFile(g.harvestPath,'utf8'),written,'the approval stands as written');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('grants: refused widening, interrupted checks never replayed, removal revokes, reconnecting does not resurrect', {timeout:60_000}, async()=>{
  const g=await gardenWithRepo([['feat: pass one','2026-01-01T00:00:00Z']]);
  let unavailable=false;
  const stub=stubTransport(m=>unavailable?'unavailable':answers(m));
  let app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
  try {
    await app.command({action:'source',path:g.repo,email:g.email,authorized:true});
    await app.command({action:'schedule',schedule});
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,0,'no grant, no request');
    const source=app.snapshot().sources[0]!.id;
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
    const authorize=()=>({action:'jev-grant',source,revision:jevPermissionRevision(app.snapshot()),consent:'typesafe-source-commit-titles'});
    for(const change of [{source:'foreign'},{caller:'scarlet'},{consent:'all-data'},{revision:'sha256:'+'0'.repeat(64)}]) await assert.rejects(app.command({...authorize(),...change}));
    await app.command(authorize());
    await app.tick(new Date());
    assert.equal(stub.calls.length,1);
    await app.decideCandidate('git-cluster:feat');
    assert.equal(stub.calls.length,1,'a completed keep or pass is reused');
    const page=renderJevWorkflow(app.snapshot(),true);
    assert.match(page,/aria-label="Turn off Jev/);
    assert.match(page,/<a href="\/review">Review<\/a>/);
    assert.doesNotMatch(page,/jev-run|Unchecked/,'the Jev page keeps no draft list');
    // An interrupted check is unknown, not failed: never replayed automatically.
    await app.close();
    const file=join(g.state,'workflow.json');const saved=JSON.parse(await readFile(file,'utf8'));
    const last=saved.jev.attempts.at(-1);last.status='pending';delete last.receipt;
    await writeFile(file,JSON.stringify(saved));
    app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
    assert.equal(app.snapshot().jev!.attempts.at(-1)!.status,'interrupted');
    await app.tick(new Date());
    assert.equal(stub.calls.length,1,'an unknown prior outcome is not silently replayed');
    const h=harvest(JSON.parse(await readFile(g.harvestPath,'utf8')));
    assert.deepEqual([...(await app.jevView(h)).retry],['git-cluster:feat']);
    unavailable=true;await app.decideCandidate('git-cluster:feat');assert.equal(stub.calls.length,2,'the owner can retry');
    unavailable=false;await app.decideCandidate('git-cluster:feat');assert.equal(stub.calls.length,3,'and retry a failure');
    assert.equal((await app.jevView(h)).marks.get('git-cluster:feat'),'pass');
    await app.command({action:'source-toggle',id:source});
    assert.equal((await app.jevView(h)).marks.size,0,'a paused source carries no mark');
    await assert.rejects(app.decideCandidate('git-cluster:feat'),/Allow this source/);
    await app.command({action:'source-toggle',id:source});
    await app.command({action:'source-remove',id:source});
    assert.ok(app.snapshot().jev!.grants.every(gr=>gr.revokedAt));
    await app.command({action:'source',path:g.repo,email:g.email,authorized:true});
    await app.tick(new Date(),true);
    assert.equal(stub.calls.length,3,'reconnecting cannot resurrect revoked grants');
    await assert.rejects(app.command({...authorize(),revision:'sha256:'+'0'.repeat(64)}),/Permissions changed/);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('a pass whose three newest checks were interrupted still sends the unchecked draft', {timeout:60_000}, async()=>{
  const stub=stubTransport(answers);
  const g=await collectedGarden(FIVE.slice(0,4),stub.fetcher);
  let {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date());
    assert.deepEqual(stub.calls.map(c=>c.material),['perf: unsure about this','docs: keep the middle','fix: pass the second']);
    // The process stops while those three are out: their outcome is unknown.
    await app.close();
    const file=join(g.state,'workflow.json');const saved=JSON.parse(await readFile(file,'utf8'));
    for(const a of saved.jev.attempts) {a.status='pending';delete a.receipt;}
    await writeFile(file,JSON.stringify(saved));
    app=await openWorkflow(g.state,{env:KEY,fetcher:stub.fetcher,harvestPath:g.harvestPath});
    assert.equal(app.snapshot().jev!.attempts.filter(a=>a.status==='interrupted').length,3);
    await app.tick(new Date());
    assert.deepEqual(stub.calls.slice(3).map(c=>c.material),['feat: keep the oldest'],'the unchecked draft is sent; no interrupted one is replayed');
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('the Jev page labels a check the provider did not answer as unavailable, never unresolved', {timeout:60_000}, async()=>{
  const stub=stubTransport(()=>'unavailable');
  const g=await collectedGarden([['feat: keep one','2026-01-01T00:00:00Z']],stub.fetcher);
  const {app}=await openGranted(g,stub.fetcher);
  try {
    await app.tick(new Date());
    const [attempt]=app.snapshot().jev!.attempts;
    assert.equal(attempt?.receipt?.reason,'provider_unavailable');
    assert.equal(attempt?.receipt?.outcome,'unresolved');
    const page=renderJevWorkflow(app.snapshot(),true);
    assert.match(page,/<li><time>[^<]*<\/time> · unavailable<\/li>/);
    assert.doesNotMatch(page,/unresolved/);
  } finally {await app.close();await rm(g.dir,{recursive:true,force:true});}
});

test('strict retained decisions reject forged and contradictory bindings',()=>{
  assert.throws(()=>parseJevWorkflow({grants:[],attempts:[],approved:true}));
  assert.throws(()=>parseJevWorkflow({grants:[],attempts:[{id:'orphan',grant:'absent',packet:'absent',selectionDigest:'sha256:'+'a'.repeat(64),startedAt:new Date().toISOString(),status:'pending'}]}));
});

test('the Jev page states one truth: consent recorded, and which missing piece pauses automatic checks', ()=>{
  const source={id:'source-1',path:'/synthetic/foliage',email:'synthetic@foliage.invalid',enabled:true};
  const off: WorkflowSnapshot={version:1,schedule:null,sources:[source],proposals:[],history:[],nextAt:null,attempt:0,running:false,active:true};
  const on: WorkflowSnapshot={...off,jev:{grants:[{id:'grant-1',source:source.id,caller:'photosynthesis',provider:'typesafe',policyRevision:JEV_SOURCE_POLICY,grantedAt:'2026-10-08T00:00:00.000Z'}],attempts:[]}};
  const running={...schedule,cadence:'daily' as const};
  const state=(page:string)=>/<div class="jev-state" role="status">(.*?)<\/div>/s.exec(page)?.[1]??'';

  const granted=renderJevWorkflow(on,false,'','granted');
  assert.equal(state(granted),'<p><strong>Consent recorded</strong></p><p>Automatic checks paused: TypeSafe isn&#39;t set up on this computer and Collection isn&#39;t scheduled.</p>');
  assert.doesNotMatch(granted,/Enabled\.|Jev unavailable|ui-alert/,'no success shown above a refusal');
  const setup=/<details class="jev-setup">.*?<\/details>/s.exec(granted)?.[0]??'';
  assert.match(setup,/TYPESAFE_API_KEY/);
  assert.equal(granted.split('TYPESAFE_API_KEY').length,2,'the variable name appears only in its setup detail');
  assert.match(granted,/<a href="\/workflow#background">Collection setup<\/a>/);

  assert.equal(state(renderJevWorkflow(off,false)),'<p>Automatic checks paused: TypeSafe isn&#39;t set up on this computer and Collection isn&#39;t scheduled.</p>','named before consent too');
  const paused=renderJevWorkflow({...on,schedule:{...running,paused:true}},true);
  assert.equal(state(paused),'<p><strong>Jev is on</strong></p><p>Automatic checks paused: Collection is paused.</p>');
  assert.doesNotMatch(paused,/jev-setup/);
  const ready=renderJevWorkflow({...on,schedule:running},true);
  assert.equal(state(ready),'<p><strong>Jev is on</strong></p><p>Jev checks open drafts on the Collection schedule, outside quiet hours.</p>');
  assert.doesNotMatch(ready,/Collection setup|checks paused/);
  // Collection skips a paused source, so its grant sends nothing: never "on" for it alone.
  const other={...source,id:'source-2',path:'/synthetic/other'};
  const skipped=renderJevWorkflow({...on,schedule:running,sources:[{...source,enabled:false},other]},true);
  assert.equal(state(skipped),'<p>Automatic checks paused: the chosen source is paused.</p>');
  assert.match(skipped,/<a href="\/workflow#sources">Source settings<\/a>/);
  assert.equal(state(renderJevWorkflow({...on,sources:[{...source,enabled:false}]},false)),'<p>Automatic checks paused: TypeSafe isn&#39;t set up on this computer, Collection isn&#39;t scheduled and the chosen source is paused.</p>');
  const mixed={...on,schedule:running,sources:[{...source,enabled:false},other],jev:{grants:[...on.jev!.grants,{...on.jev!.grants[0]!,id:'grant-2',source:other.id}],attempts:[]}};
  assert.equal(state(renderJevWorkflow(mixed,true)),'<p><strong>Jev is on</strong></p><p>Jev checks open drafts on the Collection schedule, outside quiet hours.</p>','on while one granted source is collected');
  assert.equal(state(renderJevWorkflow({...off,schedule:running},true,'','revoked')),'<p><strong>Turned off</strong></p>');
  assert.doesNotMatch(renderJevWorkflow({...off,schedule:running},true),/jev-state/,'nothing to say while off and ready');
  assert.match(renderJevWorkflow(off,true,'Permissions changed. Reload.'),/role="alert">Permissions changed\. Reload\./);
});

test('turning Jev off for one source keeps saying what the switches still on do', ()=>{
  const source={id:'source-1',path:'/synthetic/foliage',email:'synthetic@foliage.invalid',enabled:true};
  const other={...source,id:'source-2',path:'/synthetic/other'};
  const grant={id:'grant-2',source:other.id,caller:'photosynthesis' as const,provider:'typesafe' as const,policyRevision:JEV_SOURCE_POLICY,grantedAt:'2026-10-08T00:00:00.000Z'};
  const revoked={...grant,id:'grant-1',source:source.id,revokedAt:'2026-10-08T01:00:00.000Z'};
  const after: WorkflowSnapshot={version:1,schedule:{...schedule,cadence:'daily' as const},sources:[source,other],proposals:[],history:[],nextAt:null,attempt:0,running:false,active:true,jev:{grants:[revoked,grant],attempts:[]}};
  const state=(page:string)=>/<div class="jev-state" role="status">(.*?)<\/div>/s.exec(page)?.[1]??'';
  const switches=(page:string)=>page.split('aria-checked="true"').length-1;

  const ready=renderJevWorkflow(after,true,'','revoked');
  assert.equal(switches(ready),1,'one switch is still on');
  assert.equal(state(ready),'<p><strong>Turned off · still on for 1 other source</strong></p><p>Jev checks open drafts on the Collection schedule, outside quiet hours.</p>');
  const unset=renderJevWorkflow({...after,schedule:null},false,'','revoked');
  assert.equal(state(unset),'<p><strong>Turned off · still on for 1 other source</strong></p><p>Automatic checks paused: TypeSafe isn&#39;t set up on this computer and Collection isn&#39;t scheduled.</p>','the reason is kept while a switch is on');
  assert.match(unset,/<details class="jev-setup">/);
  assert.match(unset,/<a href="\/workflow#background">Collection setup<\/a>/);
  const pausedOther=renderJevWorkflow({...after,sources:[source,{...other,enabled:false}]},true,'','revoked');
  assert.equal(state(pausedOther),'<p><strong>Turned off · still on for 1 other source</strong></p><p>Automatic checks paused: the chosen source is paused.</p>');

  const none: WorkflowSnapshot={...after,schedule:null,jev:{grants:[revoked,{...grant,revokedAt:'2026-10-08T02:00:00.000Z'}],attempts:[]}};
  const off=renderJevWorkflow(none,false,'','revoked');
  assert.equal(switches(off),0);
  assert.equal(state(off),'<p><strong>Turned off</strong></p>','nothing on: nothing waits');
  assert.doesNotMatch(off,/jev-setup|Collection setup/);
});
