/* Canonical presentation commands own every write; this controller edits their forms. */
const $=s=>document.querySelector(s);
let state,achievementId='',claimId='',draft=false,busy=false,creating=false,initialized=false,currentPanel='work',pendingRefresh=null;
function error(message=''){const notice=$('#error');notice.textContent=message;notice.hidden=!message;if(message){notice.focus({preventScroll:true});notice.scrollIntoView({block:'nearest'});}}
function dirty(){draft=true;$('#save-status').textContent='Unsaved edits';}
function node(tag,text){const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;}
function control(text,action){const b=node('button',text);b.type='button';b.dataset.slot='button';b.addEventListener('click',action);return b;}
function active(){return state?.achievements.find(a=>a.id===achievementId);}
function warnDiscard(){return !pendingRefresh&&(!draft||confirm('Discard unsaved edits?'));}
function panel(name){currentPanel=name;$('#profile-panel').hidden=name!=='profile';$('#work-panel').hidden=name!=='work';$('#show-profile').setAttribute('aria-pressed',String(name==='profile'));$('#mode-edit').setAttribute('aria-pressed',String(name==='work'&&document.body.dataset.editorMode!=='preview'));$('#mode-preview').setAttribute('aria-pressed',String(document.body.dataset.editorMode==='preview'));}
function renderProfile(){for(const key of ['headline','bio','direction','passions'])$('#profile-form').elements[key].value=key==='headline'?state.headline:key==='passions'?(state.profile.passions||[]).join('\n'):state.profile[key]||'';}
async function fetchState(){const response=await fetch('/leaf/setup/state');const result=await response.json();if(!response.ok)throw new Error(result.error||'Read unavailable');return result;}
function applyState(result){state=result;$('#connection-status').textContent=state.subject;$('#subject').value=state.subject;renderProfile();$('#profile-form fieldset').disabled=false;if(!initialized){initialized=true;const requested=new URLSearchParams(location.search).get('achievement');achievementId=state.achievements.find(a=>a.id===requested)?.id||state.achievements[0]?.id||'';panel('work');renderWork();}else renderWorks();}
function showRecovery(showCurrent=false){$('#setup-read-actions').hidden=false;$('#use-current-wrap').hidden=!showCurrent;}
function hideRecovery(){$('#setup-read-actions').hidden=true;$('#use-current-wrap').hidden=true;}
function confirmSaved(result,pending){applyState(result);if(pending.action==='achievement'&&pending.wasCreating){achievementId=state.achievements.find(a=>!pending.beforeIds.has(a.id))?.id||'';creating=false;}draft=false;pendingRefresh=null;hideRecovery();renderWork();error();$('#save-status').textContent='Saved';$('#preview iframe').src='/leaf/setup/preview';}
async function read(){applyState(await fetchState());}
async function save(action,fields){
  if(busy||pendingRefresh||!state)return;
  busy=true;$('#editor').inert=true;error();hideRecovery();$('#save-status').textContent='Saving…';
  const pending={acknowledged:false,beforeRevision:state.documentRevision,beforeIds:new Set(state.achievements.map(a=>a.id)),wasCreating:creating,action};
  try{
    const form=new URLSearchParams({action,leafId:state.leafId,subject:state.subject,documentRevision:state.documentRevision});
    for(const [key,value] of fields instanceof URLSearchParams?fields:Object.entries(fields))form.append(key,value);
    let response;
    try{response=await fetch('/leaf/setup',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});}
    catch{pendingRefresh=pending;showRecovery();error('Save response unavailable. Retry read.');$('#save-status').textContent='Check save';return;}
    if(!response.ok){
      const result=await response.json().catch(()=>({}));
      if(response.status>=500){pendingRefresh=pending;showRecovery();error('Save response unavailable. Retry read.');$('#save-status').textContent='Check save';}
      else{error(result.error||'Save refused');$('#save-status').textContent='Not saved';}
      return;
    }
    pending.acknowledged=true;pendingRefresh=pending;
    try{confirmSaved(await fetchState(),pending);}
    catch{showRecovery();error('Write accepted. Read unavailable.');$('#save-status').textContent='Refresh needed';}
  }finally{busy=false;$('#editor').inert=!!pendingRefresh;$('#move-work').disabled=state?.achievements[0]?.id===achievementId;}
}
async function retryRead(){
  if(busy)return;
  busy=true;$('#retry-read').disabled=true;$('#save-status').textContent='Reading…';
  try{
    const latest=await fetchState();
    if(!pendingRefresh){applyState(latest);hideRecovery();error();$('#save-status').textContent='Saved';return;}
    if(pendingRefresh.acknowledged){confirmSaved(latest,pendingRefresh);return;}
    if(latest.documentRevision===pendingRefresh.beforeRevision){pendingRefresh=null;hideRecovery();error('No new version found. Your edits are still here.');$('#save-status').textContent='Save not confirmed';return;}
    $('#preview iframe').src='/leaf/setup/preview';showRecovery(true);error('Record changed. Check preview before continuing.');$('#save-status').textContent='Check record';
  }catch{showRecovery(!$('#use-current-wrap').hidden);error('Read unavailable. Retry read.');$('#save-status').textContent=pendingRefresh?'Refresh needed':'Read failed';}
  finally{busy=false;$('#retry-read').disabled=false;$('#editor').inert=!!pendingRefresh;}
}
$('#retry-read').addEventListener('click',retryRead);
$('#use-current-record').addEventListener('click',async()=>{
  if(busy||!pendingRefresh||!confirm('Replace your edits with the current record?'))return;
  busy=true;$('#use-current-record').disabled=true;
  try{applyState(await fetchState());achievementId=state.achievements.find(a=>a.id===achievementId)?.id||state.achievements[0]?.id||'';creating=false;claimId='';draft=false;pendingRefresh=null;renderWork();hideRecovery();error();$('#save-status').textContent='Saved';$('#preview iframe').src='/leaf/setup/preview';}
  catch{error('Read unavailable. Retry read.');$('#save-status').textContent='Read failed';}
  finally{busy=false;$('#use-current-record').disabled=false;$('#editor').inert=!!pendingRefresh;}
});
$('#profile-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget.elements;save('profile',{headline:f.headline.value,bio:f.bio.value,direction:f.direction.value,passions:f.passions.value});});
function renderWorks(){const list=$('#work-list');list.replaceChildren();for(const a of state.achievements){const b=control('',()=>{if(!warnDiscard())return;draft=false;creating=false;achievementId=a.id;claimId='';renderWork();if(matchMedia('(max-width:800px)').matches)$('.work-list-disclosure').open=false;});b.className='work-choice';b.append(node('strong',a.title));const summary=a.claims.find(c=>c.kind==='summary')?.text;if(summary)b.append(node('span',summary));b.setAttribute('aria-pressed',String(a.id===achievementId));list.append(b);}if(!state.achievements.length)list.append(node('p','No work'));}
function renderWork(){renderWorks();const a=active();$('#work-editor').hidden=!a&&!creating;$('#claim-form').hidden=true;$('#title-form').hidden=false;if(!a&&!creating)return;$('#work-title').textContent=a?.title||'New work';$('#work-history').href=a?'/leaf/presentation?edit=journey-history&achievement='+encodeURIComponent(a.id):'/leaf/presentation?edit=achievement';$('#claim-list').hidden=false;$('#title').value=a?.title||'';$('#rename-work').open=creating;$('#move-work').hidden=!a;$('#move-work').disabled=state.achievements[0]?.id===a?.id;$('#add-claim').hidden=!a;const list=$('#claim-list');list.replaceChildren();if(a){for(const c of a.claims){const b=control('',()=>{if(!warnDiscard())return;draft=false;claimId=c.id;renderClaim(c);});b.className='setup-claim';const labels=state.claimLabels;b.append(node('small',labels[c.kind]||c.kind),node('span',c.text||'Empty statement'));const edit=node('span','Edit');edit.className='setup-claim-edit';b.append(edit);b.setAttribute('aria-label',`Edit ${labels[c.kind]||c.kind}: ${c.text||'Empty statement'}`);list.append(b);}if(!a.claims.length)list.append(node('p','No statements'));}}
function renderClaim(claim){$('#title-form').hidden=true;$('#move-work').hidden=true;$('#claim-list').hidden=true;$('#add-claim').hidden=true;$('#claim-form').hidden=false;$('#kind').value=claim?.kind||'summary';$('#text').value=claim?.text||'';const chosen=new Set((claim?.citations||[]).map(c=>JSON.stringify([c.leaflet,c.provenance.source,c.provenance.ref,c.provenance.observedAt])));const list=$('#citations');list.replaceChildren();const known=new Set(state.evidence.map(e=>e.key));const entries=[...state.evidence,...[...chosen].filter(k=>!known.has(k)).map(key=>({key,title:'Unavailable reference',source:'',ref:'',observedAt:''}))];for(const item of entries){const label=node('label');label.className='setup-citation';label.dataset.search=`${item.title} ${item.source} ${item.ref}`.toLowerCase();const input=node('input');input.type='checkbox';input.name='citation';input.value=item.key;input.checked=chosen.has(item.key);const span=node('span',item.title);span.append(node('small',`${item.source} · ${item.ref}`));if(item.observedAt)span.append(node('small',`Observed ${item.observedAt}`));label.append(input,span);list.append(label);}if(!entries.length)list.append(node('p','No references'));$('#source-search').value='';$('#text').focus();}
$('#cancel-claim').addEventListener('click',()=>{if(!warnDiscard())return;draft=false;renderWork();$('#save-status').textContent='Saved';$('#add-claim').focus();});
$('#source-search').addEventListener('input',e=>{for(const item of document.querySelectorAll('.setup-citation'))item.hidden=!item.dataset.search.includes(e.target.value.toLowerCase());});
$('#title-form').addEventListener('submit',e=>{e.preventDefault();save('achievement',{achievement:creating?'':achievementId,title:$('#title').value});});
$('#claim-form').addEventListener('submit',e=>{e.preventDefault();const fields=new URLSearchParams({achievement:achievementId,claim:claimId,kind:$('#kind').value,text:$('#text').value});for(const input of e.currentTarget.querySelectorAll('[name=citation]:checked'))fields.append('citation',input.value);save('claim',fields);});
$('#move-work').addEventListener('click',()=>{if(warnDiscard()){draft=false;save('order-achievement',{achievement:achievementId});}});
$('#add-work').addEventListener('click',()=>{if(!state||!warnDiscard())return;draft=false;creating=true;achievementId='';claimId='';renderWork();$('#title').focus();});
$('#add-claim').addEventListener('click',()=>{if(!warnDiscard())return;draft=false;claimId='';renderClaim(null);});
for(const form of document.querySelectorAll('form'))form.addEventListener('input',e=>{if(e.target.id!=='source-search')dirty();});
for(const [id,width] of [['preview-fit','fit'],['preview-phone','phone']])$('#'+id).addEventListener('click',()=>{$('#preview').dataset.width=width;$('#preview-fit').setAttribute('aria-pressed',String(width==='fit'));$('#preview-phone').setAttribute('aria-pressed',String(width==='phone'));});
$('#review-sharing')?.addEventListener('click',e=>{if(draft||busy||pendingRefresh){e.preventDefault();error('Unsaved edits');}});
window.addEventListener('beforeunload',e=>{if(draft||busy||pendingRefresh){e.preventDefault();e.returnValue='';}});
panel('work');read().then(()=>{$('#save-status').textContent='Saved';}).catch(e=>{error(e.message);$('#connection-status').textContent='Leaf unavailable';$('#save-status').textContent='Read failed';showRecovery();});

// Preview never discards edits. Changing the edited section retains the same discard guard.
for(const [id,name] of [['show-profile','profile'],['mode-edit','work']]) $('#'+id).addEventListener('click',()=>{
  if(busy||(pendingRefresh&&currentPanel!==name))return;
  if(currentPanel!==name){if(!warnDiscard())return;draft=false;if(state){if(name==='work')renderWork();else renderProfile();}}
  document.body.dataset.editorMode='edit';panel(name);
});
$('#mode-preview').addEventListener('click',()=>{
  document.body.dataset.editorMode='preview';
  for(const id of ['mode-edit','show-profile']) $('#'+id).setAttribute('aria-pressed','false');
  $('#mode-preview').setAttribute('aria-pressed','true');
});
$('.editor-mobile-modes').hidden=false;
document.body.dataset.editorMode='edit';
panel(currentPanel);
$('#preview-fit').setAttribute('aria-pressed','true');
$('#preview-phone').setAttribute('aria-pressed','false');
const workListDisclosure=$('.work-list-disclosure');
const narrow=matchMedia('(max-width:800px)');
function fitWorkList(){workListDisclosure.open=!narrow.matches;}
fitWorkList();narrow.addEventListener('change',fitWorkList);
