import { basename } from 'node:path';
import { ui } from '@foliage/ui';
import { esc, page } from './render.ts';
import type { WorkflowSnapshot } from './workflow.ts';
import { JEV_SOURCE_POLICY, jevGrantedSources, jevPermissionRevision } from './jevWorkflow.ts';
import { collectionGate } from './collectionGate.ts';
const route='/workflow/jev';
const hidden=(name:string,value:string)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
const grantFor=(state: WorkflowSnapshot, source: string)=>state.jev?.grants.find(g=>g.source===source&&!g.revokedAt&&g.policyRevision===JEV_SOURCE_POLICY);
/**
 * One state for the page: what the owner just did, then why automatic checks wait, each missing
 * piece named in plain words. Marks already given stay on /review and a retry there still runs,
 * so only the automatic checks are said to pause. The key's environment name appears only inside
 * its setup detail.
 */
function jevState(state: WorkflowSnapshot, configured: boolean, notice?: 'granted'|'revoked'): string {
  // On only where the worker acts: a grant on a paused source sends nothing, so it is named as missing.
  const on=jevGrantedSources(state).length>0;
  const paused=on?0:state.sources.filter(source=>!source.enabled&&!!grantFor(state,source.id)).length;
  // Switches still on after one is turned off: the page goes on to say what they do, as the switches show.
  const others=notice==='revoked'?state.sources.filter(source=>!!grantFor(state,source.id)).length:0;
  const done=notice==='revoked'&&!others;
  const collection=collectionGate(state);
  const missing=[...configured?[]:["TypeSafe isn't set up on this computer"],...collection.open?[]:[collection.label],...paused?[paused>1?'the chosen sources are paused':'the chosen source is paused']:[]];
  const lead=notice==='granted'?'Consent recorded':notice==='revoked'?`Turned off${others?` · still on for ${others} other source${others>1?'s':''}`:''}`:on?'Jev is on':'';
  const reason=done?'':missing.length?`Automatic checks paused: ${[missing.slice(0,-1).join(', '),missing.at(-1)].filter(Boolean).join(' and ')}.`:lead?'Jev checks open drafts on the Collection schedule, outside quiet hours.':'';
  if(!lead&&!reason) return '';
  const setup=done?'':`${configured?'':'<details class="jev-setup"><summary>Setup</summary><p>Foliage reads a TypeSafe key from <code>TYPESAFE_API_KEY</code> when it starts. Add the key there, then restart Foliage.</p></details>'}${collection.open?'':'<p><a href="/workflow#background">Collection setup</a></p>'}${paused?'<p><a href="/workflow#sources">Source settings</a></p>':''}`;
  return `<div class="jev-state" role="status">${lead?`<p><strong>${lead}</strong></p>`:''}${reason?`<p>${esc(reason)}</p>`:''}</div>${setup}`;
}
export function renderJevWorkflow(state: WorkflowSnapshot, configured: boolean, message='', notice?: 'granted'|'revoked'): string {
  const revision=jevPermissionRevision(state);
  const sources=state.sources.map(source=>{
    const grant=grantFor(state,source.id);
    const name=esc(basename(source.path));
    const form=`<form method="post" action="${route}">${hidden('action',grant?'jev-revoke':'jev-grant')}${hidden('source',source.id)}${hidden('revision',revision)}${grant?'':hidden('consent','typesafe-source-commit-titles')}
      ${grant?'':'<p>Each draft: commit titles, and approved ones as context → TypeSafe cloud</p>'}${grant?`<button class="jev-switch" type="submit" role="switch" aria-checked="true" aria-label="Turn off Jev for ${name}"><span></span></button>`:ui.button('Enable',{type:'submit',disabled:!source.enabled})}</form>`;
    return `<section class="jev-source"><div class="jev-source-heading"><h2 title="${name}">${name}</h2>
      <details class="jev-source-info"><summary aria-label="Source details for ${name}" title="Source details">…</summary><p>${esc(source.email)}</p><p>${esc(source.path)}</p>${!source.enabled?'<p>Collection paused</p>':''}</details></div>
      ${grant?form:`<details class="jev-permission"><summary class="jev-switch" aria-label="Enable Jev for ${name}" title="Enable Jev"><span></span></summary><div>${form}</div></details>`}</section>`;
  }).join('');
  const history=(state.jev?.attempts??[]).slice(-20).reverse().map(a=>`<li><time>${esc(a.startedAt)}</time> · ${esc(a.receipt?.reason==='provider_unavailable'?'unavailable':a.receipt?.outcome??a.status)}</li>`).join('');
  return page({title:'Jev',surface:'leaf',face:'night',nav:'workflow',state:'jev-source-selection',empty:false,portfolioLeaf:true,
    body:`<div class="portfolio-editor jev-panel"><h1>Jev</h1>${message?ui.alert(message):''}
      ${jevState(state,configured,notice)}${sources||'<p><a href="/workflow#sources">Connect a source</a></p>'}
      <p><a href="/review">Review</a></p>
      ${history?`<details class="jev-activity"><summary aria-label="History" title="History">…</summary><h2>History</h2><ul>${history}</ul></details>`:''}</div>`});
}
