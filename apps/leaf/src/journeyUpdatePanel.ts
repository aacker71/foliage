/** Private, receipt-bound Scarlet updates. A suggestion is never a publish action. */
import { ACHIEVEMENT_CLAIM_LABELS, type LeafAchievement } from '@foliage/leaf';
import { ui } from '@foliage/ui';
import { esc } from './render.ts';
import { storyEvidence } from './leafletStory.ts';
import { JOURNEY_SUGGESTION_CONSENT, currentJourneyGrant, maintenanceRevision, reviewedJourneySuggestion, type JourneyMaintenance, type JourneyOutcome } from './journeyMaintenance.ts';
import type { LeafLoad } from './leafDocument.ts';
import type { WorkflowSnapshot } from './workflow.ts';
import type { CompanionStatus } from './sourceCatalog.ts';
import { collectionGate } from './collectionGate.ts';

const route='/leaf/scarlet';
const hidden=(name:string,value:string)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
const statuses:Record<JourneyMaintenance['attempts'][number]['status'],string>={
  pending:'Checking',suggested:'Review',applied:'Saved',discarded:'Discarded',unchanged:'No change',passed:'Passed',unresolved:'Unresolved',failed:'Unavailable',interrupted:'Interrupted',
};
type UpdateFeedback={label:string;next?:{label:string;href:'#updates'|'#quiet-hours'|'#journey-permission'|'#journey'|'/workflow#background'|'/workflow/jev'|'/leaf/photosynthesis'}};
const collection=(label:string):NonNullable<UpdateFeedback['next']>=>({label,href:'#updates'});
const permissionAction=(label:string):NonNullable<UpdateFeedback['next']>=>({label,href:'#journey-permission'});
const gates:Record<NonNullable<JourneyOutcome['reason']>,UpdateFeedback>={
  workflow_closed:{label:'Collection is unavailable',next:{label:'Open background runs',href:'/workflow#background'}},
  permission_missing:{label:'Update permission is off',next:permissionAction('Allow updates')},
  schedule_missing:{label:'No collection rhythm',next:collection('Set rhythm')},
  schedule_paused:{label:'Collection is paused',next:collection('Resume collection')},
  quiet_hours:{label:'Quiet hours are active',next:{label:'Review quiet hours',href:'#quiet-hours'}},
  schedule_changed:{label:'Collection rhythm changed',next:collection('Review rhythm')},
};
const outcomes:Record<Exclude<JourneyOutcome['kind'],'gated'>,UpdateFeedback>={
  disconnected:{label:'Scarlet is disconnected',next:{label:'Connect Scarlet',href:'#journey'}},
  idle:{label:'No update ready'},busy:{label:'Already checking'},
  revoked:{label:'Update permission stopped',next:permissionAction('Allow updates')},
  scope_changed:{label:'Selected work changed',next:permissionAction('Review selected work')},
  storage_unavailable:{label:'Update history unavailable',next:{label:'Open background runs',href:'/workflow#background'}},
  provider_unavailable:{label:'Update provider unavailable',next:{label:'Review connections',href:'/workflow#background'}},
  suggested:{label:'Ready to review'},unchanged:{label:'No wording change suggested'},
  passed:{label:'No update proposed'},unresolved:{label:'No update prepared'},
  failed:{label:'Could not prepare update'},
};
const feedback=(outcome:JourneyOutcome,maintenance:JourneyMaintenance|undefined):UpdateFeedback=>{
  if(outcome.kind==='gated') return outcome.reason?gates[outcome.reason]:{label:'Update unavailable',next:collection('Review collection')};
  if(outcome.kind==='provider_unavailable') {
    const attempted=maintenance?.attempts.find(item=>item.id===outcome.attempt);
    if(attempted?.decision?.outcome==='keep') return {label:'Scarlet is unavailable',next:{label:'Check Scarlet',href:'#journey'}};
    if(attempted) return {label:'Jev is unavailable',next:{label:'Check Jev',href:'/workflow/jev'}};
  }
  return outcomes[outcome.kind];
};
const eligibleWork=(load:Extract<LeafLoad,{ok:true}>)=>load.leaf.leaflets.filter(record=>record.tier!=='excluded'&&storyEvidence(record).length);
/** Work picked before a refusal stays picked: only current eligible ids, never more than the form allows. */
export function keptJourneyLeaflets(load:LeafLoad,draftLeaflets:readonly string[]|undefined):string[] {
  if(!load.ok||!draftLeaflets?.length) return [];
  const eligible=new Set<string>(eligibleWork(load).map(record=>record.id));
  return draftLeaflets.filter(id=>eligible.has(id)).slice(0,12);
}
export function renderJourneyUpdatePanel(load:LeafLoad,achievement:LeafAchievement|undefined,status:CompanionStatus,workflow:WorkflowSnapshot|undefined,draftTexts?:readonly string[],outcome?:JourneyOutcome,draftLeaflets?:readonly string[]):string {
  if(!load.ok||!achievement) return '';
  const maintenance=workflow?.maintenance;
  const grants=maintenance?.grants.filter(grant=>grant.achievement===achievement.id&&grant.leafId===load.leaf.id&&grant.path===load.source.path)??[];
  const active=grants.findLast(currentJourneyGrant);
  const historical=grants.some(grant=>!grant.revokedAt&&!currentJourneyGrant(grant));
  const grantIds=new Set(grants.map(grant=>grant.id));
  const attempts=(maintenance?.attempts??[]).filter(attempt=>grantIds.has(attempt.grant)).slice(-10).reverse();
  const latest=attempts.find(attempt=>attempt.grant===active?.id);
  const stale=latest?.status==='suggested'&&latest.draft?.revision!==load.source.documentDigest;
  const selection=hidden('achievement',achievement.id)+hidden('revision',load.source.documentDigest);
  const permission=hidden('permissionRevision',maintenanceRevision(maintenance));
  const eligible=eligibleWork(load);
  const cited=new Set(achievement.claims.flatMap(claim=>(claim.citations??[]).map(citation=>citation.leaflet)));
  const kept=keptJourneyLeaflets(load,draftLeaflets);
  const chosen=new Set(kept.length?kept:active?.leaflets??(cited.size<=12?[...cited]:[]));
  const review=attempts.filter(attempt=>attempt.status==='suggested'&&attempt.draft&&attempt.grant===active?.id&&attempt.draft.revision===load.source.documentDigest).map(attempt=>{
    let checked:ReturnType<typeof reviewedJourneySuggestion>;
    try {checked=reviewedJourneySuggestion(maintenance,attempt.id,load);} catch {return '';}
    const rows=checked.response.edits.map((edit,index)=>{
      const claim=achievement.claims.find(item=>item.id===edit.claim)!;
      const citations=[...new Set(edit.citations.map(citation=>citation.leaflet))];
      return `<div class="journey-update-row"><p class="fol-label">${esc(ACHIEVEMENT_CLAIM_LABELS[claim.kind])}</p><p class="journey-update-before">${esc(claim.text)}</p>${ui.label('Revision',{htmlFor:'journey-update-'+index})}${ui.textarea({id:'journey-update-'+index,name:'text',defaultValue:draftTexts?.length===checked.response.edits.length?draftTexts[index]:edit.text,maxLength:2600,rows:4})}<details><summary>Evidence · <span class="fol-metric">${citations.length}</span></summary><ul>${citations.map(id=>{const record=load.leaf.leaflets.find(item=>item.id===id)!;return `<li><a href="/my/leaflet/${encodeURIComponent(id)}">${esc(record.title)}</a></li>`;}).join('')}</ul></details></div>`;
    }).join('');
    const binding=selection+hidden('attempt',attempt.id);
    return `<section class="journey-update-review" aria-label="Suggested journey update"><p class="fol-label">Ready to review</p><form method="post" action="${route}">${hidden('action','apply-pending')}${binding}${rows}${ui.button('Save to journey',{type:'submit'})}</form><form method="post" action="${route}">${hidden('action','discard-pending')}${binding}${ui.button('Discard',{type:'submit',variant:'outline'})}</form></section>`;
  }).join('');
  const showPermission=outcome?.kind==='revoked'||outcome?.kind==='scope_changed'||outcome?.kind==='gated'&&outcome.reason==='permission_missing'||kept.length>0;
  // Every refusal a permission would meet that is known now comes before any consent, each with its
  // next step: Collection open, Scarlet ready, a statement to update. The schedule is not one — a
  // permission is recorded while Collection waits; it is stated with Collection's state below.
  // The workspace's one Connect action follows this panel and carries the kept work through.
  const gateLine=(label:string,next?:{label:string;href:string})=>`<p class="journey-update-gate" role="status">${label}${next?` · <a href="${esc(next.href)}">${esc(next.label)}</a>`:''}</p>`;
  const blockers=[
    workflow?'':gateLine(gates.workflow_closed.label,gates.workflow_closed.next),
    status.ready?'':gateLine(`${status.connected?'Scarlet needs cloud setup first':'Connect Scarlet first'}${kept.length?` · <span class="fol-metric">${kept.length}</span> selected, kept`:''}`),
    achievement.claims.length?'':gateLine('Add a journey statement first',{label:'Add statement',href:`/leaf/presentation?edit=claim&achievement=${encodeURIComponent(achievement.id)}`}),
  ].join('');
  const allow=eligible.length?`<details id="journey-permission" class="journey-update-permission"${active&&!showPermission?'':' open'}><summary>${active?'Change selected work':'Allow updates'}</summary>${blockers||`<form method="post" action="${route}" data-journey-evidence>${hidden('action','journey-grant')}${selection}${permission}<label for="journey-evidence-search">Work Scarlet can use</label><input id="journey-evidence-search" type="search" data-journey-evidence-search placeholder="Find work" aria-controls="journey-evidence-list" autocomplete="off"><p class="fol-label" data-journey-evidence-count>${chosen.size} of 12 selected</p><div id="journey-evidence-list" class="journey-evidence-list">${eligible.map(record=>`<label class="portfolio-choice"><input type="checkbox" name="leaflet" value="${esc(record.id)}"${chosen.has(record.id)?' checked':''}><span>${esc(record.title)}</span></label>`).join('')}</div><label class="portfolio-choice"><input type="checkbox" name="consent" value="${JOURNEY_SUGGESTION_CONSENT}" required><span>Send selected work and journey statements, including my name, to TypeSafe and Scarlet (Fireworks) for private suggestions.</span></label>${ui.button(active?'Save selection':'Allow updates',{type:'submit'})}</form>`}</details>`:'<p>No retained evidence · <a href="/leaf/photosynthesis">Work</a></p>';
  const controls=active?`<div class="journey-update-controls"><p class="fol-label">${active.leaflets.length} selected</p><form method="post" action="${route}">${hidden('action','prepare-update')}${selection}${hidden('grant',active.id)}${ui.button(stale?'Check again':'Check for update',{type:'submit',disabled:!status.ready})}</form><form method="post" action="${route}">${hidden('action','journey-revoke')}${selection}${permission}${hidden('grant',active.id)}${ui.button('Stop updates',{type:'submit',variant:'outline'})}</form></div>`:'';
  const receipts=attempts.length?`<details><summary>Update history · <span class="fol-metric">${attempts.length}</span></summary><ol>${attempts.map(attempt=>`<li><time class="fol-metric" datetime="${esc(attempt.at)}">${esc(attempt.at)}</time> · ${attempt.status==='suggested'&&(attempt.grant!==active?.id||attempt.draft?.revision!==load.source.documentDigest)?'Out of date':statuses[attempt.status]}</li>`).join('')}</ol></details>`:'';
  const update=outcome?feedback(outcome,maintenance):undefined;
  const next=update?.next?.href==='#journey-permission'&&!eligible.length?{label:'Open work',href:'/leaf/photosynthesis'}:update?.next;
  const result=update&&!(outcome?.kind==='suggested'&&review)?`<p class="journey-update-feedback" role="status"><span>${esc(update.label)}</span>${next?`<a class="fol-button fol-button-outline fol-button-sm" href="${next.href}">${esc(next.label)}</a>`:''}</p>`:historical&&!active?'<p role="status">Update permission needs review. Your history is retained; no automatic transfer is enabled.</p>':'';
  const collection=collectionGate(workflow);
  const collectionNext=collection.reason?gates[collection.reason].next!:{label:'Collection',href:'#updates'};
  // An unavailable Collection is said once: in place of consent when there is work to permit.
  const collectionLine=!workflow&&eligible.length?'':`<p class="journey-collection-gate">${esc(collection.label)} · <a href="${collectionNext.href}">${esc(collectionNext.label)}</a></p>`;
  const gate=`<p class="aside">Updates run only while Collection is scheduled, not paused and outside quiet hours.</p>${collectionLine}`;
  return `<section class="journey-update-panel" aria-label="Journey updates">${review}<details id="journey-updates" class="portfolio-editor-section"${review||outcome||stale||historical&&!active||kept.length?' open':''}><summary>Updates${review||historical&&!active?' · Review':''}</summary>${result}${stale?'<p class="fol-label">Update out of date</p>':''}${gate}${controls}${allow}${receipts}</details></section>`;
}
