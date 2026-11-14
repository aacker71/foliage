/** Transport refusal tests do not represent a connected cloud provider. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssessmentConnection } from "./assessmentConnection.ts";
import { parseJourneyRequest } from './journeyCollaboration.ts';
test("connection cannot accept arbitrary hosts, missing configuration or unconnected transfer", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("Not expected"); };
  for (const origin of ["", "https://remote.invalid", "http://localhost:4180", "http://127.0.0.1:4180/path", "http://user.invalid@127.0.0.1:4180"]) {
    const c = createAssessmentConnection({ FOLIAGE_COMPANION_ORIGIN: origin, FOLIAGE_COMPANION_KEY: "a".repeat(64) }, fetcher);
    await assert.rejects(c.connect(), /configured/);
    await assert.rejects(c.prepare({}, { id: "regression", name: "Regression" }), /Connect/);
  }
  assert.equal(calls, 0);
});
test('a lost journey response admits possible cloud processing and a refused response preserves its safe cause',async()=>{
  const context=parseJourneyRequest({version:1,leafId:'transport',subject:'Transport protocol',revision:'sha256:'+'a'.repeat(64),achievement:{id:'transport',title:'Transport protocol',claims:[]},evidence:[],message:'Protocol question.',history:[]});
  for(const lost of [true,false]) {
    const c=createAssessmentConnection({FOLIAGE_COMPANION_ORIGIN:'http://127.0.0.1:4180',FOLIAGE_COMPANION_KEY:'a'.repeat(64)},async url=>{
      if(String(url).endsWith('/status'))return Response.json({service:'foliage-assessment-companion',version:1,ready:true,model:'protocol-model'});
      if(lost)throw new Error('private transport contents');
      return Response.json({error:'Fireworks refused the request (HTTP 402). No assessment was accepted.'},{status:400});
    });
    await c.connect();
    await assert.rejects(c.collaborate(context),error=>{assert.match(String(error),lost?/may have started/:/HTTP 402/);assert.doesNotMatch(String(error),/private transport contents|no cloud assessment was started/);return true;});
  }
});
test("service loss clears connected status and never falls back to a cloud host", async () => {
  const c = createAssessmentConnection({ FOLIAGE_COMPANION_ORIGIN: "http://127.0.0.1:4180", FOLIAGE_COMPANION_KEY: "a".repeat(64) }, async () => { throw new Error("sensitive transport details"); });
  await assert.rejects(c.connect(), /unavailable/);
  assert.equal(c.status().connected, false);
  assert.doesNotMatch(c.status().detail, /sensitive/);
});
