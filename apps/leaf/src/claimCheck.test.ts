/** Real repository excerpts; injected provider replies exercise the protocol, not model accuracy. */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLeafDocument, type LeafLoad } from './leafDocument.ts';
import { prepareClaimCheck, checkClaim, renderClaimCheck } from './claimCheck.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
let directory: string, load: Extract<LeafLoad, {ok:true}>;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'foliage-claim-check-'));
  const path = join(directory, 'leaf.json');
  const identity = execFileSync('git', ['log', '-1', '--format=%ae'], {cwd:root, encoding:'utf8'}).trim();
  execFileSync(process.execPath, ['apps/leaf/intake.mjs', '--repo', root, '--identity', identity, '--subject', 'Statement support protocol', '--out', path], {cwd:root});
  const actual = await loadLeafDocument({FOLIAGE_LEAF:path}); assert.ok(actual.ok);
  const record = actual.leaf.leaflets.find(item => item.tier !== 'excluded' && item.provenance); assert.ok(record?.provenance);
  load = {...actual, leaf:{...actual.leaf, leaflets:[{...record, body:[{text:record.title, provenance:record.provenance}]}], achievements:[{id:'protocol',title:'Statement support protocol',claims:[{id:'statement',kind:'summary',text:record.title,citations:[{leaflet:record.id,provenance:record.provenance}]}]}]}};
});
after(async () => { if(directory) await rm(directory, {recursive:true,force:true}); });
const select = () => prepareClaimCheck(load, 'protocol', 'statement');
const form = () => new URLSearchParams({achievement:'protocol',claim:'statement',revision:load.source.documentDigest,consent:'typesafe-selected-excerpts'});
const env = {TYPESAFE_API_KEY:'protocol-credential'};
const reply = (support = 'partial', gap = 'outcome', confidence = 0.95) => Response.json({model:'jev-1.13.0',answers:{support:{type:'choice',choice:support,confidence},gap:{type:'choice',choice:gap,confidence}}});

test('sends only selected text through the fixed endpoint, never writes or asserts proof', async () => {
  const before = JSON.stringify(load); const selected = select(); let calls = 0;
  const result = await checkClaim(selected, form(), env, async (url, init) => {
    calls++; assert.equal(url,'https://api.typesafe.ai/v1/systemone'); assert.equal(init?.redirect,'error');
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.state,{claim:selected.claim,evidence:selected.evidence.map(({text})=>({text}))});
    assert.equal(request.model,'jev-1.13.0');
    assert.ok(!String(init?.body).includes(load.source.path));
    assert.ok(!String(init?.body).includes(load.leaf.subject));
    return reply();
  });
  assert.equal(calls,1); assert.equal(result.support,'partial'); assert.equal(result.gap,'outcome');
  assert.equal(JSON.stringify(load),before);
  const html=renderClaimCheck(load,selected,result,undefined,true);
  assert.match(html,/What measurement or attributed feedback/); assert.match(html,/Model reading, not verification/);
  assert.doesNotMatch(html,/protocol-credential/);
});

test('refuses missing, duplicated, stale and unapproved form context without a request', async () => {
  const fetcher: typeof fetch = async () => { assert.fail('No network call permitted'); };
  for (const mutate of [
    (f:URLSearchParams)=>f.delete('consent'), (f:URLSearchParams)=>f.append('claim','statement'),
    (f:URLSearchParams)=>f.set('revision','stale'), (f:URLSearchParams)=>f.set('consent','no'),
    (f:URLSearchParams)=>f.set('claim','other'), (f:URLSearchParams)=>f.set('sourcePath','/private'),
  ]) { const f=form();mutate(f);await assert.rejects(checkClaim(select(),f,env,fetcher)); }
  await assert.rejects(checkClaim(select(),form(),{},fetcher),/not configured/);
});

test('missing, stale, excluded and textless citations produce local repair with no transfer form', async () => {
  const record=load.leaf.leaflets[0]!;
  const variants = [
    {...load.leaf,leaflets:[]},
    {...load.leaf,leaflets:[{...record,provenance:{...record.provenance!, observedAt:"2001-01-01T00:00:00Z"},body:[]}]},
    {...load.leaf,leaflets:[{...record,body:[]}]},
    {...load.leaf,leaflets:[{...record,tier:'excluded' as const,reason:'Protocol exclusion'}]},
    {...load.leaf,achievements:load.leaf.achievements!.map(a=>({...a,claims:a.claims.map(c=>({...c,citations:[]}))}))},
  ];
  for (const leaf of variants) {
    const selected=prepareClaimCheck({...load,leaf},'protocol','statement');assert.ok(selected.issues.length);
    assert.doesNotMatch(renderClaimCheck({...load,leaf},selected,undefined,undefined,true),/<form/);
    await assert.rejects(checkClaim(selected,form(),env,async()=>{assert.fail('No request');}),/evidence gaps/);
  }
  const missing = renderClaimCheck({...load,leaf:variants[0]!},prepareClaimCheck({...load,leaf:variants[0]!},'protocol','statement'));
  assert.match(missing, /Record missing/);
  assert.doesNotMatch(missing, /data-verbatim="body-element"/);
  const stale = renderClaimCheck({...load,leaf:variants[1]!},prepareClaimCheck({...load,leaf:variants[1]!},'protocol','statement'));
  assert.match(stale, /Citation needs repair/);
  assert.doesNotMatch(stale, /data-verbatim="body-element"/);
  const excluded = renderClaimCheck({...load,leaf:variants[3]!},prepareClaimCheck({...load,leaf:variants[3]!},'protocol','statement'));
  assert.match(excluded, /Excluded from attribution/);
  assert.match(excluded, /Protocol exclusion/);
  assert.doesNotMatch(excluded, /data-verbatim="body-element"/);
  assert.throws(()=>prepareClaimCheck({...load,source:{...load.source,declaredExample:true}},'protocol','statement'),/real Leaf/);
});

test('statement support keeps each exact citation and its excerpt beside the source artifact', () => {
  const html = renderClaimCheck(load, select(), undefined, undefined, true);
  const row = /<li data-citation-status="current">[\s\S]*?<\/li>/.exec(html)?.[0];
  assert.ok(row);
  assert.match(html, /<h2 id="claim-citations-heading">Cited work<\/h2>/);
  assert.match(row, /href="\/my\/leaflet\//);
  assert.match(row, /Verified attribution|Pending attribution/);
  assert.match(row, /<dt>Source<\/dt><dd><code>git<\/code><\/dd>/);
  assert.match(row, /<dt>Observed<\/dt><dd><time class="fol-metric"/);
  assert.match(row, /<dt>Reference<\/dt><dd><code/);
  assert.match(row, /<blockquote data-verbatim="body-element">/);
  assert.equal((html.match(/data-verbatim="body-element"/g) ?? []).length, 1);
  assert.match(html, /name="consent" value="typesafe-selected-excerpts" required/);
  const unconfigured = renderClaimCheck(load, select());
  assert.match(unconfigured, /<h2 id="claim-citations-heading">Cited work<\/h2>/);
  assert.doesNotMatch(unconfigured, /TypeSafe not configured/);
  assert.doesNotMatch(unconfigured, /<form\b/);
});

test('statement support is not titled as the local assistant; its check names TypeSafe cloud', () => {
  const selected = renderClaimCheck(load, select(), undefined, undefined, true);
  for (const html of [selected, renderClaimCheck(load)]) assert.match(html, /<title>Statement support<\/title>/);
  assert.match(selected, /to TypeSafe \(cloud\)/);
});

test('statement support keeps cited work visible when its source has no body excerpt', () => {
  const record = load.leaf.leaflets[0]!;
  const textless = {...load, leaf:{...load.leaf, leaflets:[{...record, body:[]}]}};
  const html = renderClaimCheck(textless, prepareClaimCheck(textless, 'protocol', 'statement'));
  assert.match(html, /<h2 id="claim-citations-heading">Cited work<\/h2>/);
  assert.match(html, /1 citation/);
  assert.match(html, /Exact citation retained/);
  assert.match(html, /No retained text excerpt/);
  assert.match(html, /Full reference/);
  assert.match(html, /href="\/my\/leaflet\//);
  assert.doesNotMatch(html, /<form/);
});

test('provider failures, oversized responses and invalid decisions fail closed without retry or raw errors', async () => {
  for (const response of [new Response('private-provider-detail',{status:429}),new Response('x'.repeat(65537)),reply('invented'),reply('supported','none',2),Response.json({model:'other',answers:{}})]) {
    let calls=0;
    await assert.rejects(checkClaim(select(),form(),env,async()=>{calls++;return response;}),error=>error instanceof Error && /did not complete/.test(error.message) && !/private-provider-detail/.test(error.message));
    assert.equal(calls,1);
  }
});

test('uncertain output stays advisory; missing document is not misrepresented as an empty portfolio', async () => {
  const result=await checkClaim(select(),form(),env,async()=>reply('insufficient_context','context',0.6));
  assert.equal(result.uncertain,true); assert.match(renderClaimCheck(load,select(),result),/model was uncertain/);
  const missing:LeafLoad={ok:false,cause:'unconfigured',detail:'No source',path:null};
  const html=renderClaimCheck(missing); assert.match(html,/could not be read/);assert.doesNotMatch(html,/No statements/);
  assert.match(renderClaimCheck(load,undefined,undefined,'Reopen current evidence'),/Reopen current evidence/);
});
