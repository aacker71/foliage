/** Provider-contract fixtures; these responses are not live Scarlet or career evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {collaborateOnJourney} from './journeyCollaboration.ts';
const source=(await readFile(new URL('../../../context/product-thesis.md',import.meta.url),'utf8')).slice(0,800);
const context={version:1,leafId:'protocol',subject:'Protocol input',revision:'sha256:'+'a'.repeat(64),achievement:{id:'protocol',title:'Context protocol',claims:[{id:'statement',kind:'summary',text:source,citations:[]}]},evidence:[],message:'Help inspect this protocol input.',history:[]};
const env={FOLIAGE_ESCALATED_INFERENCE_MODEL:'protocol-model',FOLIAGE_ESCALATED_INFERENCE_KEY:'not-a-real-key',FOLIAGE_ASSESSMENT_PROVIDER_APPROVED:'true'};
const response=(value:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
test('Scarlet uses the bounded existing Fireworks transport and cannot invent a write or citation',async()=>{
 let calls=0;
 const proposal={reply:'Protocol response, not a live model result.',edits:[{claim:'statement',text:'Protocol proposed wording.',citations:[]}],featuredLeaflets:[]};
 const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://api.fireworks.ai/inference/v1/chat/completions');assert.equal(init?.redirect,'error');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.deepEqual(JSON.parse(body.messages[1].content),context);return response(proposal);};
 await assert.rejects(collaborateOnJourney(context,{},fetcher),/not ready/);assert.equal(calls,0);
 assert.deepEqual(await collaborateOnJourney(context,env,fetcher),proposal);assert.equal(calls,1);
 await assert.rejects(collaborateOnJourney(context,env,async()=>response({...proposal,publish:true})),/did not match/);
 await assert.rejects(collaborateOnJourney(context,env,async()=>response({...proposal,edits:[{...proposal.edits[0],claim:'foreign'}]})),/did not match/);
 await assert.rejects(collaborateOnJourney({...context,tools:['shell']},env,fetcher));assert.equal(calls,1);
});
