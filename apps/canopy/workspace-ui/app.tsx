import React, { useEffect, useState } from 'react';
import { WorkspaceHeader } from '@foliage/ui/workspace-header';
import { createRoot } from 'react-dom/client';
import { Button } from '@foliage/ui/button';
import { Input } from '@foliage/ui/input';
import { Label } from '@foliage/ui/label';
import { Field } from '@foliage/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@foliage/ui/tabs';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@foliage/ui/alert-dialog';
import { FeedbackNotice } from '@foliage/ui/feedback-notice';
import type { HostingWorkspaceState } from '../src/manageWorkspace.ts';
import type { ManageReadyState } from '../src/manageState.ts';
import type { ManageNotice } from '../src/renderManage.ts';

const root = document.getElementById('hosting-root')!;
const notice: ManageNotice | null = JSON.parse(root.dataset.notice ?? 'null');
const initialIncludePortfolio = root.dataset.includePortfolio === 'on';

function Confirmation({ action, fields, label, id, cancel }: {action: 'publish' | 'withdraw'; fields: Record<string, string>; label: string; id: string; cancel?: React.ReactNode}) {
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  return <form action={`/${action}?workspace=1`} method="post" onSubmit={() => setPending(true)} className="confirmation">
    {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
    <Field>
      <Label htmlFor={`${action}-${id}`}>Type <code>{id}</code> to confirm</Label>
      <Input id={`${action}-${id}`} name="confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required/>
    </Field>
    {cancel ? <AlertDialogFooter>
      {cancel}
      <Button type="submit" variant="outline" disabled={confirmation !== id || pending}>{pending ? 'Applying…' : label}</Button>
    </AlertDialogFooter> : <Button type="submit" disabled={confirmation !== id || pending}>{pending ? 'Applying…' : label}</Button>}
  </form>;
}

function Preparation({ state, csrf, portfolioDigest, previewArtifact }: {state: ManageReadyState; csrf: string; portfolioDigest: string; previewArtifact: Record<string, unknown>}) {
  const release = state.publication;
  const canPublish = release.kind === 'not-published' || release.kind === 'update-available';
  const fields: Record<string, string> = {csrf, sourceDigest: state.sourceDigest, policyDigest: state.policyDigest, portfolioDigest};
  if (state.includePortfolio) fields.includePortfolio = 'on';
  if (release.kind === 'update-available') { fields.republish = 'true'; fields.publicDigest = release.artifactDigest; }
  return <>
    <section className="panel"><h2>Review</h2>
      <dl className="facts"><div><dt>Public subject</dt><dd>{state.review.published.subject}</dd></div><div><dt>Publishes</dt><dd className="number">{state.review.published.leaflets.length} leaflets</dd></div><div><dt>Withheld</dt><dd className="number">{state.review.withheld.length}</dd></div></dl>
      {state.review.published.subjectRedacted && <p>Subject redacted</p>}
      <h3>Publishes</h3>
      {state.review.published.leaflets.length === 0 ? <p>Nothing passes review</p> : <ul className="records">{state.review.published.leaflets.map(item => <li key={item.id}><strong>{item.title}</strong><code>{item.id}</code>{item.titleRedacted && <small>Title redacted</small>}</li>)}</ul>}
      <h3>Stays private</h3>
      {state.review.withheld.length === 0 ? <p>None withheld</p> : <details><summary><span className="number">{state.review.withheld.length}</span> withheld</summary><ul className="records">{state.review.withheld.map((item, index) => <li key={index}><strong>{item.item}</strong><p>{item.reason}</p><code>{item.at}</code></li>)}</ul></details>}
      <p><a href={"/?includePortfolio=" + (state.includePortfolio ? "on" : "")}>Update review</a></p><details><summary>Every shared field</summary><pre>{JSON.stringify(previewArtifact, null, 2)}</pre></details>
      <details><summary>Review limits</summary><ul>{state.review.limits.map(limit => <li key={limit}>{limit}</li>)}</ul><p>{state.policySource}</p></details>
    </section>
    <section className="panel"><h2>{release.kind === 'live' ? 'Live' : release.kind === 'update-available' ? 'Replace' : 'Publish'}</h2>
      {'detail' in release && <p role="status">{release.detail}</p>}
      {release.kind === 'update-available' && <p><a href={"/?includePortfolio=" + (state.includePortfolio ? "on" : "")}>Compare changes</a></p>}
      {canPublish && <Confirmation key={state.sourceDigest + state.policyDigest + portfolioDigest + (fields.publicDigest ?? "")} action="publish" fields={fields} id={state.review.published.id} label={release.kind === 'update-available' ? 'Replace Leaf' : state.review.published.leaflets.length === 0 ? 'Publish empty Leaf' : 'Publish Leaf'}/>}
    </section>
  </>;
}

function App() {
  const [data, setData] = useState<HostingWorkspaceState | null>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState(root.dataset.initialSection === 'prepare' ? 'prepare' : 'publications');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/workspace/state' + (initialIncludePortfolio ? '?includePortfolio=on' : ''), {cache: 'no-store'});
      if (!response.ok) throw Error(`The service returned ${response.status}.`);
      setData(await response.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setData(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <><a className="skip" href="#main">Skip to workspace</a><WorkspaceHeader layout="rail" home="/" section="Canopy" links={[{label:"Publication",href:"/"},{label:"Hosting",href:"/workspace",current:true},{label:"Assessment (cloud)",href:"/ladybug"}]} tools={[{label:"Hosted connection",href:"/hosted"}]} privacy="Private workspace"/><div className="shell"><main id="main" className="fol-app-main"><div className="fol-app-content"><div className="page-heading"><div><h1>Hosting</h1></div><Button variant="outline" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button></div>
    {notice && <FeedbackNotice className="notice" tone={notice.tone === 'error' ? 'error' : 'status'}><h2>{notice.heading}</h2><p>{notice.detail}</p></FeedbackNotice>}
    {error && <FeedbackNotice className="notice" tone="error"><h2>Refresh failed</h2><p>{error}</p></FeedbackNotice>}
    {!data && !error && <p role="status">Loading…</p>}
    {data && <Tabs value={section} onValueChange={setSection}><TabsList aria-label="Hosting sections"><TabsTrigger value="publications">Publications</TabsTrigger><TabsTrigger value="prepare">Prepare</TabsTrigger></TabsList>
      <TabsContent value="publications"><section className="panel"><h2>{data.inventory.kind !== 'ready' ? 'Storage unavailable' : data.inventory.items.length === 0 ? 'Nothing published' : 'Published'}</h2>
        {data.inventory.kind !== 'ready' ? <p role="status">{data.inventory.detail}</p> : data.inventory.items.length === 0 ? <Button onClick={() => setSection('prepare')}>Prepare</Button> : <ul className="publications">{data.inventory.items.map(item => <li key={item.id}><h3>{item.subject ?? item.id}</h3><code>{item.id}</code>{item.detail && <p role="status">{item.detail}</p>}{item.kind === 'valid' && <><p className="number">Published {item.publishedAt}</p><a href={new URL(item.url, data.publicOrigin).href} target="_blank" rel="noreferrer">Read public Leaf</a></>}{item.artifactDigest ? <AlertDialog><AlertDialogTrigger asChild><Button variant="outline">Withdraw</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Withdraw {item.subject ?? item.id}</AlertDialogTitle><AlertDialogDescription>Downloaded copies can’t be recalled.</AlertDialogDescription></AlertDialogHeader><Confirmation key={item.artifactDigest} action="withdraw" id={item.id} label="Withdraw" fields={{csrf: data.csrf, id: item.id, publicationDigest: item.artifactDigest}} cancel={<AlertDialogCancel asChild><Button type="button" variant="ghost">Cancel</Button></AlertDialogCancel>}/></AlertDialogContent></AlertDialog> : <p role="status">Withdraw unavailable</p>}</li>)}</ul>}
      </section></TabsContent>
      <TabsContent value="prepare">{data.state.kind === 'ready' ? <Preparation state={data.state} csrf={data.csrf} portfolioDigest={data.portfolioDigest!} previewArtifact={data.previewArtifact!}/> : <section className="panel"><h2>{data.state.heading}</h2><p>{data.state.detail}</p>{data.state.issues.length > 0 && <ul>{data.state.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}<a href="/">Setup</a></section>}</TabsContent>
    </Tabs>}</div></main></div></>;
}
createRoot(root).render(<App/>);
