import { loadLeafDocument } from './leafDocument.ts';
import { LeafLoadError } from './loadLabels.ts';
import { prepareJourney, parseJourneyResponse } from './journeyCollaboration.ts';
import { savePresentation } from './portfolioPresentation.ts';
import { decideJevPool } from './jevPoolDecision.ts';
import { JEV_HIGHLIGHT_CONSENT, prepareHighlightChecks, type HighlightJevMark } from './jevHighlights.ts';
import { reviewedJourneySuggestion } from './journeyMaintenance.ts';
import type { createAssessmentConnection } from './assessmentConnection.ts';
import type { openWorkflow } from './workflow.ts';
export async function journeyAction(form: URLSearchParams, env: Readonly<Record<string,string|undefined>>, connection: ReturnType<typeof createAssessmentConnection>, workflow?: Awaited<ReturnType<typeof openWorkflow>>, fetcher: typeof fetch = fetch) {
  const action=form.get('action');
  const shapes: Record<string,readonly string[]>={connect:['achievement','revision','leaflet'],'journey-grant':['achievement','revision','permissionRevision','leaflet','consent'],'journey-revoke':['achievement','revision','permissionRevision','grant'],'prepare-update':['achievement','revision','grant'],'apply-pending':['achievement','revision','attempt','text'],'discard-pending':['achievement','revision','attempt'],ask:['achievement','revision','message','history'],apply:['achievement','revision','proposal','text'],'jev-highlights':['achievement','revision','proposal','consent','history','message'],'collection-settings':['achievement','revision','settingsRevision','source','mode','cadence','day','time','timezone','quiet','start','end']};
  const fields=shapes[action??''];
  if(!fields||form.getAll('action').length!==1||[...form.keys()].some(key=>key!=='action'&&!fields.includes(key))||[...new Set(form.keys())].some(key=>!['source','text','leaflet'].includes(key)&&form.getAll(key).length!==1)) throw new Error('Unexpected or repeated workspace fields. Reopen the workspace.');
  // Work picked for updates before connecting comes back picked; connecting records no permission.
  if(action==='connect'){await connection.connect();return {notice:'Connected',draftLeaflets:form.getAll('leaflet')};}
  if(action==='collection-settings') {
    if(!workflow) throw new Error('Collection unavailable');
    if(!['paused','scheduled'].includes(form.get('mode')??'')||form.has('quiet')&&form.get('quiet')!=='on') throw new Error('Choose the current collection controls.');
    await workflow.command({action:'collection-settings',revision:form.get('settingsRevision'),sources:form.getAll('source'),schedule:{cadence:form.get('cadence'),day:form.get('day'),time:form.get('time'),timezone:form.get('timezone'),quiet:form.get('quiet')==='on',start:form.get('start'),end:form.get('end'),paused:form.get('mode')==='paused'}});
    return {notice:'Saved'};
  }
  if(action==='journey-grant'||action==='journey-revoke') {
    if(!workflow) throw new Error('Collection unavailable');
    await workflow.command(action==='journey-grant'
      ? {action,achievement:form.get('achievement'),documentRevision:form.get('revision'),revision:form.get('permissionRevision'),leaflets:form.getAll('leaflet'),consent:form.get('consent')}
      : {action,grant:form.get('grant'),revision:form.get('permissionRevision')});
    return {notice:action==='journey-grant'?'Enabled':'Stopped'};
  }
  if(action==='prepare-update') {
    if(!workflow) throw new Error('Collection unavailable');
    const load=await loadLeafDocument(env);
    if(!load.ok||form.get('revision')!==load.source.documentDigest) throw new Error('Record changed · Reopen');
    const grant=workflow.snapshot().maintenance?.grants.find(item=>item.id===form.get('grant')&&!item.revokedAt&&item.achievement===form.get('achievement')&&item.leafId===load.leaf.id&&item.path===load.source.path);
    if(!grant) throw new Error('This update permission is no longer available.');
    const outcome=await workflow.requestJourneySuggestion(grant.id);
    return {updateOutcome:outcome};
  }
  if(action==='apply-pending') {
    if(!workflow) throw new Error('Collection unavailable');
    const attemptId=form.get('attempt')??'',revision=form.get('revision')??'',achievement=form.get('achievement')??'',wording=form.getAll('text');
    const redirect=await workflow.finalizeJourneySuggestion(attemptId,revision,async current=>{
      const load=await loadLeafDocument(env);
      const checked=reviewedJourneySuggestion(current,attemptId,load,wording);
      if(!load.ok||checked.grant.achievement!==achievement) throw new Error('Choose the current journey.');
      const draft=new URLSearchParams({action:'journey-edits',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:revision,achievement,proposal:JSON.stringify(checked.response)});
      let after='';
      const value=await savePresentation(env,draft,'manual',{journeyReview:locked=>{
        const latest=reviewedJourneySuggestion(current,attemptId,locked,wording);
        return {response:latest.response,selectedLeaflets:latest.selectedLeaflets};
      },onSaved:digest=>{after=digest;}});
      if(!after) throw new Error('The saved journey revision is unavailable. Inspect History.');
      return {after,value};
    });
    return {redirect};
  }
  if(action==='discard-pending') {
    if(!workflow) throw new Error('Collection unavailable');
    const attemptId=form.get('attempt')??'',revision=form.get('revision')??'',achievement=form.get('achievement')??'';
    const current=workflow.snapshot().maintenance;
    const attempt=current?.attempts.find(item=>item.id===attemptId&&item.draft?.revision===revision);
    if(!attempt||current?.grants.find(item=>item.id===attempt.grant)?.achievement!==achievement) throw new Error('This update is no longer available.');
    await workflow.discardJourneySuggestion(attemptId,revision);
    return {notice:'Discarded'};
  }
  const load=await loadLeafDocument(env);
  if(!load.ok) throw new LeafLoadError(load);
  if(form.get('revision')!==load.source.documentDigest) throw new Error('Record changed · Reopen');
  const achievement=form.get('achievement')??'';
  const history=JSON.parse(form.get('history')??'[]');
  const context=prepareJourney(load,achievement,action==='ask'?form.get('message')??'':'Apply reviewed revisions.',history);
  if(action==='ask') {
    const response=await connection.collaborate(context);
    const after=await loadLeafDocument(env);
    if(!after.ok||after.source.documentDigest!==context.revision) throw new Error('Record changed · Not saved');
    return {response,history:context.history,message:context.message};
  }
  const proposal=parseJourneyResponse(JSON.parse(form.get('proposal')??''),context);
  if(action==='jev-highlights') {
    if(form.get('consent')!==JEV_HIGHLIGHT_CONSENT) throw new Error('Confirm what is sent to Jev. Nothing was sent.');
    const checks=prepareHighlightChecks(context,proposal.featuredLeaflets);
    const jev: Record<string,HighlightJevMark>={};
    for(const check of checks) {
      if(!check.ok){jev[check.leaflet]='not-sent';continue;}
      const receipt=await decideJevPool(check.selection,{provider:'typesafe',selectionDigest:check.selectionDigest},env,fetcher);
      jev[check.leaflet]=receipt.reason==='provider_unavailable'?'unavailable':receipt.outcome;
    }
    return {response:proposal,history,message:form.get('message')??'',jev};
  }
  const texts=form.getAll('text');
  if(texts.length!==proposal.edits.length||!texts.length) throw new Error('Incomplete proposal');
  const edited={...proposal,featuredLeaflets:[],edits:proposal.edits.map((e,i)=>({...e,text:texts[i]}))};
  const saved=await savePresentation(env,new URLSearchParams({action:'journey-edits',leafId:load.leaf.id,subject:load.leaf.subject,documentRevision:context.revision,achievement,proposal:JSON.stringify(edited)}));
  return {redirect:saved};
}
