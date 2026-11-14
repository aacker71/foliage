/** The owner's work, projected from canonical accounts and existing review queues. No draft store. */
import { isMediaBodyElement, isSubjectsOwnWork, resolveClaimCitation, type Leaf, type LeafAchievement } from "@foliage/leaf";
import { ui, workspaceHeader } from "@foliage/ui";
import { approvedNotInLeaf, esc, mediaHref, ownerLeafletHref, REVIEW_PROMOTE_HREF, type HarvestLoad } from "./render.ts";
import type { LeafLoad } from "./leafDocument.ts";
import { orderReviewQueue, PROMOTED_SOURCE_PREFIX, shownQueue } from "@foliage/photosynthesis";
import type { ReviewQueueView } from "./render.ts";
import { workspaceNavigation } from "./workspaceNavigation.ts";
import { canTellStory, readLeafletStory } from "./leafletStory.ts";
import { compactDraftTitle } from "./reviewDisplay.ts";
import { addAfterCreate, CREATE_RECORD } from "./recordStart.ts";

type WorkItem = {id:string;title:string;text:string;href:string;kind:"saved"|"draft";sourceId?:string;image?:{href:string;alt:string}};
function leafletVideo(record:Leaf['leaflets'][number]):string|undefined {
  const element=record.body?.find(item=>isMediaBodyElement(item)&&String(item.media.mediaType)==='video/mp4');
  if(!element||!isMediaBodyElement(element))return undefined;
  return mediaHref(element.provenance.ref,'private')??undefined;
}
function demoDetails(href:string,title:string,poster?:string):string {
  return `<details class="work-record-demo${poster?'':' work-record-demo--inline'}"><summary>Play demo</summary><video controls playsinline preload="none"${poster?` poster="${esc(poster)}"`:''} aria-label="Demo of ${esc(title)}"><source src="${esc(href)}" type="video/mp4">Video playback unavailable.</video></details>`;
}
function recordStatus(load:LeafLoad):{notice:string;empty:string;detail:string}|null {
  if(load.ok)return null;
  switch(load.cause){
    case 'unconfigured':return {notice:'Record not connected',empty:'Record not connected',detail:'Set the private record location in your local launch settings to open your work.'};
    case 'absent':return {notice:'Record not found',empty:'Your work deserves a record',detail:'No private record exists here yet. Connect a source to prepare work for review; you choose what to keep.'};
    case 'unreadable':return {notice:'Record unreadable',empty:'Record unreadable',detail:'Check local storage access, then reopen Work.'};
    case 'malformed':return {notice:'Record malformed',empty:'Record malformed',detail:'The private record is not valid JSON. Repair the file before editing work here.'};
    case 'invalid':return {notice:'Record invalid',empty:'Record invalid',detail:'The private record has an invalid format. Repair the file before editing work here.'};
    default:{const impossible:never=load;throw new Error(`Unhandled record state: ${JSON.stringify(impossible)}`);}
  }
}
function queueStatus(harvest:HarvestLoad):string {
  if(harvest.ok)return '';
  switch(harvest.cause){
    case 'unconfigured':case 'absent':return '';
    case 'unreadable':return 'Review queue unreadable';
    case 'malformed':return 'Review queue malformed';
    case 'invalid':return 'Review queue invalid';
    default:{const impossible:never=harvest;throw new Error(`Unhandled review state: ${JSON.stringify(impossible)}`);}
  }
}
function artifact(leaf:Leaf, achievement:LeafAchievement):WorkItem['image'] {
  for (const claim of achievement.claims) for (const citation of claim.citations ?? []) {
    if (resolveClaimCitation(leaf,citation).status !== "current") continue;
    const record=leaf.leaflets.find(item=>item.id===citation.leaflet && item.tier!=="excluded");
    const element=record?.body?.find(item=>isMediaBodyElement(item)&&item.provenance.ref===citation.provenance.ref&&item.provenance.source===citation.provenance.source&&item.provenance.observedAt===citation.provenance.observedAt);
    if (!element || !isMediaBodyElement(element) || !["image/png","image/jpeg","image/webp","image/gif","image/avif"].includes(element.media.mediaType)) continue;
    const href=mediaHref(element.provenance.ref,"private");
    if(href)return {href,alt:element.text || `Artifact attached to ${achievement.title}`};
  }
  return undefined;
}
function leafletArtifact(record:Leaf['leaflets'][number]):WorkItem['image'] {
  const element=record.body?.find(item=>isMediaBodyElement(item)&&["image/png","image/jpeg","image/webp","image/gif","image/avif"].includes(item.media.mediaType));
  if(!element||!isMediaBodyElement(element))return undefined;
  const href=mediaHref(element.provenance.ref,"private");
  return href?{href,alt:element.text||`Artifact for ${record.title}`}:undefined;
}
const addedFromReview = (source:string|undefined):boolean => source?.startsWith(PROMOTED_SOURCE_PREFIX)??false;
function startWork(title:string,detail:string,action:{label:string;href:string;quiet?:boolean}):string {
  return `<section class="work-start${action.quiet?' work-start-quiet':''}" aria-labelledby="work-start-title"><div><h2 id="work-start-title">${esc(title)}</h2>${detail?`<p>${esc(detail)}</p>`:''}</div><div class="work-start-actions"><a class="fol-button ${action.quiet?'fol-button-outline':'fol-button-primary'}" href="${esc(action.href)}">${esc(action.label)}</a><a class="fol-button fol-button-outline" href="/leaf/import">Import a portfolio</a></div></section>`;
}
function retainedWork(leaf:Leaf, {query='',limit=4,page=1,full=false,afterFirst=''}:{query?:string;limit?:number;page?:number;full?:boolean;afterFirst?:string}={}):string {
  const own=leaf.leaflets.filter(isSubjectsOwnWork);
  const unattributed=leaf.leaflets.length-own.length;
  const term=query.trim().toLocaleLowerCase();
  if(!own.length)return term?'':`${afterFirst}${startWork('No attributed work',afterFirst?'':'Retained items that could not be attributed to you stay counted here. Connect a source to bring in more work for review.',{label:'Connect a source',href:'/workflow#sources',quiet:Boolean(afterFirst)})}<p class="work-record-accounting"><span class="fol-metric">${unattributed.toLocaleString()}</span> not attributed</p>`;
  // Work should show additions the owner approved before older source intake. The full
  // record keeps document order; the preview omits duplicate titles without hiding them there.
  const records=own.map(record=>({record,stories:readLeafletStory(record)}));
  const matching=term?records.filter(({record,stories})=>`${record.title} ${record.provenance?.source??''} ${record.provenance?.ref??''} ${stories.map(section=>section.text).join(' ')}`.toLocaleLowerCase().includes(term)):records;
  if(!matching.length)return '';
  const paginated=full||Boolean(term);
  const pages=paginated?Math.ceil(matching.length/20):1;
  const currentPage=paginated?Math.min(Math.max(1,page),pages):1;
  const titles=new Set<string>();
  const preview=paginated?matching.slice((currentPage-1)*20,currentPage*20):[...matching.filter(item=>Boolean(leafletArtifact(item.record))),...matching.filter(item=>!leafletArtifact(item.record)&&addedFromReview(item.record.provenance?.source)),...matching.filter(item=>!leafletArtifact(item.record)&&!addedFromReview(item.record.provenance?.source)&&item.stories.length),...matching.filter(item=>!leafletArtifact(item.record)&&!addedFromReview(item.record.provenance?.source)&&!item.stories.length)]
    .filter(item=>{if(titles.has(item.record.title))return false;titles.add(item.record.title);return true;}).slice(0,limit);
  const pageHref=(target:number)=>{const params=new URLSearchParams({view:full?'records':'all'});if(term)params.set('q',query);params.set('rpage',String(target));return `/leaf/photosynthesis?${esc(params.toString())}`;};
  const pageNav=pages>1?`<nav class="work-record-pages" aria-label="Retained record pages">${currentPage>1?`<a href="${pageHref(currentPage-1)}">Previous</a>`:'<span></span>'}<span>Page <span class="fol-metric">${currentPage}</span> of <span class="fol-metric">${pages}</span></span>${currentPage<pages?`<a href="${pageHref(currentPage+1)}">Next</a>`:'<span></span>'}</nav>`:'';
  const rows=preview.map(({record,stories})=>{
    const account=stories.find(section=>section.section==='outcome')??stories.find(section=>section.section==='contribution')??stories[0];
    const referenceChanged=stories.some(section=>section.evidence<0);
    const canWrite=canTellStory(record);
    const image=leafletArtifact(record);
    const video=leafletVideo(record);
    return `<li class="work-record${image?' work-record-visual':''}">${image?`<div class="work-record-artifact-wrap"><a class="work-record-artifact" data-media="shown" href="${esc(ownerLeafletHref(record.id))}"><img src="${esc(image.href)}" alt="${esc(image.alt)}" loading="lazy"><span data-media-unavailable hidden>Artifact unavailable</span></a>${video?demoDetails(video,record.title,image.href):''}</div>`:''}<div><h3>${esc(record.title)}</h3>${account?`<p data-authored="subject">${esc(account.text)}</p>`:''}<div class="work-record-meta"><span${referenceChanged?' data-reference-state="changed"':''}>${referenceChanged?'Reference changed':account?'Recorded account':addedFromReview(record.provenance?.source)?'Added from review':'Source record'}</span><a class="work-record-open" href="${esc(ownerLeafletHref(record.id))}" aria-label="Open ${esc(record.title)}">Open</a>${canWrite?`<a href="/leaf/story?leaflet=${encodeURIComponent(record.id)}">${account?'Edit story':'Tell story'}</a>`:''}</div>${video&&!image?demoDetails(video,record.title):''}</div></li>`;
  });
  const recordList=afterFirst&&rows.length?`<ol class="work-record-list">${rows[0]}</ol>${afterFirst}${rows.length>1?`<ol class="work-record-list work-record-list-continuation">${rows.slice(1).join('')}</ol>`:''}`:`<ol class="work-record-list">${rows.join('')}</ol>`;
  return `<section class="work-records${paginated?'':' work-records-preview'}" aria-labelledby="work-records-title"><header class="work-records-heading"><div><h2 id="work-records-title">${paginated?'Retained records':'In your record'}</h2><p><span class="fol-metric">${matching.length.toLocaleString()}</span> ${term?matching.length===1?'match':'matches':own.length===1?'record':'records'}${!term&&unattributed?` · <span class="fol-metric">${unattributed.toLocaleString()}</span> not attributed`:''}</p></div>${paginated?'<a href="/leaf/setup">Write an account</a>':''}</header>
  ${recordList}${pageNav}<nav class="work-record-actions" aria-label="Retained work actions">${!full?'<a href="/leaf/photosynthesis?view=records">Browse records</a>':''}<a href="/leaf/import">Import a portfolio</a></nav></section>`;
}
export function renderWorkWorkspace(load:LeafLoad, harvest:HarvestLoad, view:ReviewQueueView, query=new URLSearchParams()):string {
  const search=(query.get('q')??'').slice(0,200), filter=query.get('view')==='saved'?'saved':query.get('view')==='draft'?'draft':query.get('view')==='records'?'records':'all';
  const requestedPage=Number(query.get('rpage'));const recordPage=Number.isSafeInteger(requestedPage)&&requestedPage>0?requestedPage:1;
  const saved:WorkItem[]=load.ok?(load.leaf.achievements??[]).map(a=>{
    const image=artifact(load.leaf,a);
    return {id:`work-${a.id}`,title:a.title,text:(a.claims.find(c=>c.kind==='outcome')??a.claims.find(c=>c.kind==='summary')??a.claims[0])?.text??'',href:`/leaf/achievement?id=${encodeURIComponent(a.id)}`,kind:'saved',...(image?{image}:{})};
  }):[];
  const pending:WorkItem[]=harvest.ok?orderReviewQueue(shownQueue(harvest.harvest.candidates,view.paused).shown,view.marks).open.map(({candidate:c})=>({id:`draft-${c.id}`,sourceId:c.id,title:c.title,text:'',href:`/review?focus=${encodeURIComponent(c.id)}#candidate-${encodeURIComponent(c.id)}`,kind:'draft' as const})):[];
  const all=[...saved,...pending];
  const browsing=filter==='all'&&!search.trim();
  const record=recordStatus(load);
  const retained=load.ok?load.leaf.leaflets.filter(isSubjectsOwnWork).length:0;
  const hasReviewedVisual=load.ok&&(saved.some(item=>Boolean(item.image))||load.leaf.leaflets.some(item=>isSubjectsOwnWork(item)&&Boolean(leafletArtifact(item))));
  const capturePrimary=browsing&&load.ok&&(saved.length>0||retained>0)&&pending.length===0&&!hasReviewedVisual;
  const nextReview=pending[0];
  // Approval alone does not add work to the record; the promote panel on /review does. Counted
  // against the leaf by the same subtraction that panel makes, so this never names finished work,
  // and only against a leaf that was read: without one the panel has nothing to add into.
  const approvedWaiting=harvest.ok&&load.ok?approvedNotInLeaf(harvest.harvest,new Set<string>(load.leaf.leaflets.map(record=>record.id))).length:0;
  const waitingNote=approvedWaiting?` · <a class="work-review-waiting" href="${esc(REVIEW_PROMOTE_HREF)}"><span class="fol-metric">${approvedWaiting.toLocaleString()}</span> approved waiting</a>`:'';
  const reviewNext=nextReview?`<section class="work-review-next" aria-labelledby="work-review-next-title"><div><h2 id="work-review-next-title">Ready to review</h2><p title="${esc(nextReview.title)}">${esc(compactDraftTitle(nextReview.sourceId??'',nextReview.title))}</p><span><span class="fol-metric">${pending.length.toLocaleString()}</span> ${pending.length===1?'draft':'drafts'}${waitingNote}</span></div><a class="fol-button ${capturePrimary?'fol-button-outline':'fol-button-primary'}" href="${esc(nextReview.href)}" aria-label="Review ${esc(nextReview.title)}">Review</a></section>`:'';
  // Unreviewed machine drafts are a queue, not the owner's authored work. Keep them
  // reachable through Review, the Drafts view and search without making them the cover.
  const items=(browsing?saved:all).filter(item=>(filter==='all'||filter===item.kind)&&`${item.title} ${item.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  // The empty heading carries the record state in the overview; a second banner repeats it.
  const unavailable=[browsing?'':record?.notice??'',queueStatus(harvest)].filter(Boolean);
  // The retained preview already leads with real imagery; rendering a second
  // artifact shelf would show the same evidence twice.
  const recordResults=load.ok&&(filter==='records'||filter==='all'&&load.leaf.leaflets.length>0&&(Boolean(search.trim())||!saved.length||retained>0))?retainedWork(load.leaf,{query:search,limit:3,page:recordPage,full:filter==='records',afterFirst:browsing&&!saved.length?reviewNext:''}):'';
  const workItems=items.map((item,index)=>{
    const lead=browsing&&item.kind==='saved'&&index===0;
    // The full, qualified account stays on its detail page. An arbitrary preview
    // cutoff could remove the sentence that limits a claim, so the overview leads
    // with the owner's title and an explicit way to read the complete account.
    const excerpt=item.text&&(lead||!browsing)?`<p data-authored="subject">${esc(item.text)}</p>`:'';
    const open=`<a${lead&&!capturePrimary&&!nextReview?' class="fol-button fol-button-primary work-item-open"':' class="work-item-open"'} href="${esc(item.href)}">${item.kind==='saved'?'Read account':'Review draft'}</a>`;
    return `<article class="work-item kind-${item.kind}${item.image?' has-artifact':''}" id="${esc(item.id)}"${lead?' data-lead="true"':''}>${item.image?`<a class="work-artifact" data-media="shown" href="${esc(item.href)}"><img src="${esc(item.image.href)}" alt="${esc(item.image.alt)}" loading="lazy"><span data-media-unavailable hidden>Artifact unavailable</span></a>`:''}<div class="work-account"><h2><a href="${esc(item.href)}">${esc(item.title)}</a></h2>${excerpt}<div class="work-item-meta">${open}<span>${item.kind==='saved'?'Saved account':'Draft · Needs review'}</span></div></div></article>`;
  });
  const workList=workItems.length?browsing&&saved.length&&reviewNext
    ? `<section class="work-list" aria-label="Your work">${workItems[0]}</section>${reviewNext}${workItems.length>1?`<section class="work-list" aria-label="More saved work">${workItems.slice(1).join('')}</section>`:''}`
    : `<section class="work-list" aria-label="Your work">${workItems.join('')}</section>`:'';
  const firstUse=browsing&&!workList&&!recordResults&&(load.ok||!load.ok&&load.cause==='absent');
  const firstAction={label:'Connect a source',href:'/workflow#sources',quiet:Boolean(reviewNext)};
  // Approved drafts with no record to add them into: creating the record is the next step, not
  // connecting another source. The drafts stay approved until Review adds them.
  const approvedNoRecord=!load.ok&&load.cause==='absent'&&harvest.ok?harvest.harvest.candidates.filter(c=>c.review.state==='approved').length:0;
  // Quiet while a Ready-to-review card leads (the same rule as `firstAction`): one primary at a time.
  const createFirst=approvedNoRecord&&harvest.ok?startWork('No private record yet',addAfterCreate(harvest.harvest,approvedNoRecord,'from Review'),{label:CREATE_RECORD.text,href:CREATE_RECORD.href,quiet:Boolean(reviewNext)}):'';
  const main=workList||recordResults?`${workList}${recordResults}`
    :firstUse?reviewNext?`${reviewNext}${createFirst||startWork(record?.empty??'Your work deserves a record','',firstAction)}`:createFirst||startWork(record?.empty??'Your work deserves a record',record?.detail??'Connect a source to prepare real work for review. You decide what becomes part of this private record.',firstAction)
    :browsing?`<section class="work-unavailable" role="status"><h2>${esc(record?.empty??'Work unavailable')}</h2><p>${esc(record?.detail??'Reopen Work when the private record is available.')}</p></section>`
    :filter==='saved'&&!search.trim()?ui.emptyState('No saved accounts', [
      {label:'Add an account',href:'/leaf/setup'}, ...(retained?[{label:'Browse records',href:'/leaf/photosynthesis?view=records'}]:[]),
    ])
    :filter==='draft'&&!search.trim()?ui.emptyState('No drafts to review', [{label:'Work overview',href:'/leaf/photosynthesis'}])
    :ui.emptyState('No matching work', [{label:'Clear filters',href:'/leaf/photosynthesis'}]);
  const leadAction=browsing&&load.ok?`<nav class="work-heading-actions" aria-label="Work actions"><a class="${capturePrimary?'fol-button fol-button-primary ':''}work-capture-action" href="/leaf/capture">Capture app demo</a>${saved.length||retained?`<a class="work-add-action" href="/leaf/setup">${saved.length?'Add work':'Write an account'}</a>`:''}</nav>`:'';
  const body=`<header class="work-heading"><h1>Work</h1>${leadAction}</header>
  ${unavailable.map(message=>`<p class="work-notice" role="status">${esc(message)}</p>`).join('')}
  ${saved.length||retained||!browsing?`<details class="work-filter-panel"${browsing?'':' open'}><summary>Find work</summary><form class="work-filters" method="get" action="/leaf/photosynthesis"><label class="work-search" for="find-work">Search${ui.input({id:'find-work',type:'search',name:'q',defaultValue:search,maxLength:200,placeholder:'Search work',autoComplete:'off'})}</label><label for="work-view">Show<select id="work-view" name="view">${[['all','Overview'],['records','Retained records'],['saved','Saved accounts'],['draft','Drafts to review']].map(([value,label])=>`<option value="${value}"${value===filter?' selected':''}>${label}</option>`).join('')}</select></label>${ui.button('Apply',{type:'submit',variant:'outline'})}</form></details>`:''}
  ${main}
  ${saved.length&&!recordResults?'<footer class="work-footer"><a href="/leaf/setup">Edit portfolio</a><a href="/leaf/photosynthesis?view=records">Browse records</a><a href="/leaf/import">Import a portfolio</a></footer>':''}`;
  return `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Work · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/empty-state.css"><link rel="stylesheet" href="/workspace-shell.css"><link rel="stylesheet" href="/work-workspace.css"><script type="module" src="/media-status.mjs"></script></head><body class="fol-app"><a class="work-skip" href="#work-main">Skip to work</a>${workspaceHeader(workspaceNavigation('work'))}<main id="work-main" class="fol-app-main" tabindex="-1"><div class="fol-app-content work-content">${body}</div></main></body></html>`;
}
