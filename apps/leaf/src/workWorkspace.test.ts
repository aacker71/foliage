import { testRepository } from "../../../tools/development/testRepository.mjs";
/** Synthetic queue contract inputs, never a person's work or acceptance evidence. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildPromotedLeaflet, parseHarvestDocument } from '@foliage/photosynthesis';
import { isSubjectsOwnWork, parseLeafDocument } from '@foliage/leaf';
import { loadLeafDocument } from './leafDocument.ts';
import { esc, ownerLeafletHref } from './render.ts';
import { renderWorkWorkspace } from './workWorkspace.ts';

const exec = promisify(execFile);
const privateOpen = (record: { id: string; title: string }) => `href="${ownerLeafletHref(record.id)}" aria-label="Open ${esc(record.title)}">Open</a>`;

test('Work leads with retained records rather than machine drafts before an account is saved', async t => {
  const repo = testRepository();
  const directory = await mkdtemp(join(tmpdir(), 'foliage-work-record-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await exec('git', ['-C', repo, 'log', '-1', '--format=%ae%n%an']);
  const [identity, subject] = stdout.trim().split('\n');
  assert.ok(identity && subject);
  const path = join(directory, 'leaf.json');
  await exec(process.execPath, [fileURLToPath(new URL('../intake.mjs', import.meta.url)), '--repo', repo, '--identity', identity, '--subject', subject, '--out', path]);
  const load = await loadLeafDocument({ FOLIAGE_LEAF: path });
  assert.ok(load.ok);
  assert.ok(load.leaf.leaflets.length > 0);
  assert.equal(load.leaf.achievements?.length ?? 0, 0);
  const parsed = parseHarvestDocument({ candidates: [{
    id: 'git-cluster:pending', title: 'Synthetic machine draft', extractor: 'git-cluster',
    draftedAt: '2026-09-04T00:00:00Z',
    evidence: [{ source: 'git', ref: 'a'.repeat(40), observedAt: '2026-09-04T00:00:00Z' }],
    review: { state: 'candidate' },
  }] });
  assert.ok(parsed.ok);
  const harvest = { ok: true, harvest: parsed.harvest, path: join(directory, 'harvest.json') } as const;
  const view = { marks: new Map(), retry: new Set<string>(), paused: false };
  const html = renderWorkWorkspace(load, harvest, view);
  const first = load.leaf.leaflets.find(isSubjectsOwnWork); assert.ok(first);
  assert.match(html, /<h2 id="work-records-title">In your record<\/h2>/);
  assert.match(html, /<details class="work-filter-panel"><summary>Find work<\/summary><form class="work-filters"/, 'tools recede until needed');
  assert.match(html, /<form class="work-filters"[^>]*>.*name="q"/s, 'retained work stays searchable before an account exists');
  assert.match(html, new RegExp(`<span class="fol-metric">${load.leaf.leaflets.filter(isSubjectsOwnWork).length.toLocaleString()}</span> records?`));
  assert.ok(html.includes(privateOpen(first)), 'actual retained work leads the overview');
  // The test attaches renderer-only media to one real retained title; it does not assert
  // that these bytes or a demo exist in anyone's record.
  const stillRef = `sha256:${'b'.repeat(64)}`, clipRef = `sha256:${'c'.repeat(64)}`;
  const observedAt = first.provenance?.observedAt ?? '2026-10-07T00:00:00Z';
  const visualRecord = { ...first, body: [
    { provenance: { source: 'renderer-contract', ref: stillRef, observedAt },
      media: { mediaType: 'image/png' as const, dimensions: { known: true as const, width: 1280, height: 720 } } },
    { provenance: { source: 'renderer-contract', ref: clipRef, observedAt },
      media: { mediaType: 'video/mp4' as const, dimensions: { known: true as const, width: 1280, height: 720 } } },
  ] };
  const visualHtml = renderWorkWorkspace({ ...load, leaf: { ...load.leaf, leaflets: [visualRecord] } }, harvest, view,
    new URLSearchParams('view=records'));
  assert.match(visualHtml, /<details class="work-record-demo"><summary>Play demo<\/summary><video controls playsinline preload="none"/);
  assert.ok(visualHtml.includes(`src="/my/media/${clipRef}"`));
  assert.doesNotMatch(visualHtml, /target="_blank"[^>]*Play demo|\bautoplay\b/);
  const visualOverview = renderWorkWorkspace({ ...load, leaf: { ...load.leaf, leaflets: [visualRecord] } }, harvest, view);
  assert.match(visualOverview, /class="work-capture-action" href="\/leaf\/capture">Capture app demo<\/a>/,
    'capture returns to a quiet control once reviewed imagery leads');
  assert.match(html, /href="\/leaf\/setup">Write an account<\/a>/);
  assert.match(html, /href="\/leaf\/photosynthesis\?view=records">Browse records<\/a>/);
  assert.match(html, /href="\/leaf\/import">Import a portfolio<\/a>/);
  assert.match(html, /class="work-review-next"[^>]*>.*Synthetic machine draft.*href="\/review\?focus=git-cluster%3Apending#candidate-git-cluster%3Apending"/s);
  assert.ok(html.indexOf('class="work-record"') < html.indexOf('class="work-review-next"'), 'a retained record leads before the review action');
  assert.match(html, /class="work-capture-action" href="\/leaf\/capture">Capture app demo<\/a>/);
  assert.match(html, /class="fol-button fol-button-primary"[^>]*>Review<\/a>/);
  assert.equal((html.match(/class="fol-button fol-button-primary/g)??[]).length,1,'review leads while a draft awaits a decision');
  assert.doesNotMatch(html, /<h2>No work<\/h2>|class="work-item kind-|Review all/);
  const noHarvest = {ok:false,cause:'absent',detail:'No private review queue',path:join(directory,'missing-harvest.json')} as const;
  const withoutDrafts = renderWorkWorkspace(load, noHarvest, view);
  assert.match(withoutDrafts, /class="fol-button fol-button-primary work-capture-action" href="\/leaf\/capture">Capture app demo<\/a>/);
  const emptyRecord = renderWorkWorkspace({...load,leaf:{...load.leaf,leaflets:[]}},noHarvest,view);
  assert.match(emptyRecord, /<h2 id="work-start-title">Your work deserves a record<\/h2>/);
  assert.match(emptyRecord, /class="fol-button fol-button-primary" href="\/workflow#sources">Connect a source<\/a>/);
  assert.equal((emptyRecord.match(/class="fol-button fol-button-primary"/g)??[]).length,1,'first use has one dominant action');
  assert.doesNotMatch(emptyRecord,/No work|Record unreadable|Write an account/);
  const matchingRecord = renderWorkWorkspace(load, harvest, view, new URLSearchParams({q:first.title}));
  assert.match(matchingRecord, /<details class="work-filter-panel" open>/, 'an active search keeps its controls visible');
  assert.ok(matchingRecord.includes(privateOpen(first)));
  assert.doesNotMatch(matchingRecord, /No matching work|Synthetic machine draft/);
  const ownRecords = load.leaf.leaflets.filter(isSubjectsOwnWork);
  assert.ok(ownRecords.length > 20);
  const uniqueRecords = ownRecords.filter((record, index, all) => all.findIndex(item => item.title === record.title) === index);
  assert.ok(uniqueRecords.length >= 5);
  const approved = parseHarvestDocument({ candidates: uniqueRecords.slice(0, 4).map((record, index) => {
    const evidence = record.provenance; assert.ok(evidence);
    return { id: `git-cluster:work-${index}`, title: record.title, extractor: 'git-cluster',
      draftedAt: evidence.observedAt, evidence: [evidence],
      review: { state: 'approved', by: subject, at: evidence.observedAt } };
  }) });
  assert.ok(approved.ok);
  const promoted = approved.harvest.candidates.map(candidate => buildPromotedLeaflet(candidate, candidate.evidence[0]!));
  const qualifiedAccount = 'Test-only account. The cited source does not establish a broader outcome.';
  const withSavedAccount = { ...load, leaf: { ...load.leaf,
    achievements: [{ id: 'repository-account', title: uniqueRecords[4]!.title,
      claims: [{ id: 'qualified', kind: 'summary' as const, text: qualifiedAccount }] }],
    leaflets: [...load.leaf.leaflets, ...promoted],
  } };
  const withPromotions = renderWorkWorkspace(withSavedAccount, harvest, view);
  assert.ok(withPromotions.indexOf('class="work-item kind-saved"') < withPromotions.indexOf('class="work-records work-records-preview"'));
  assert.ok(withPromotions.indexOf('class="work-item kind-saved"') < withPromotions.indexOf('class="work-review-next"'));
  assert.ok(withPromotions.indexOf('class="work-review-next"') < withPromotions.indexOf('class="work-records work-records-preview"'));
  assert.match(withPromotions, /class="work-add-action" href="\/leaf\/setup">Add work<\/a>/);
  assert.match(withPromotions, /class="work-item-open"[^>]*>Read account<\/a>/, 'the saved account stays readable beneath the review action');
  assert.match(withPromotions, /class="work-capture-action" href="\/leaf\/capture">Capture app demo<\/a>/);
  assert.match(withPromotions, /class="fol-button fol-button-primary"[^>]*>Review<\/a>/);
  assert.equal((withPromotions.match(/class="fol-button fol-button-primary/g)??[]).length,1, 'review is the only prominent action while a draft awaits a decision');
  assert.match(withPromotions, /data-authored="subject">Test-only account\. The cited source does not establish a broader outcome\./,
    'the lead account keeps its qualification visible without a text cutoff');
  const searchedAccount = renderWorkWorkspace(withSavedAccount, harvest, view, new URLSearchParams('q=Test-only account'));
  assert.match(searchedAccount, /Test-only account\. The cited source does not establish a broader outcome\./, 'explicit search can show the complete account');
  assert.match(withPromotions, /class="work-records work-records-preview"[^>]*>.*<h2 id="work-records-title">In your record<\/h2>.*href="\/leaf\/photosynthesis\?view=records">Browse records<\/a>/s);
  assert.match(withPromotions, /class="work-record"/, 'real retained work is visible below the saved account');
  assert.doesNotMatch(withPromotions, /class="work-footer"/, 'the records action row already offers import');
  const withVisualAccount = renderWorkWorkspace({ ...withSavedAccount, leaf: { ...withSavedAccount.leaf,
    leaflets: withSavedAccount.leaf.leaflets.map(record => record.id === first.id ? visualRecord : record),
  } }, harvest, view);
  assert.equal((withVisualAccount.match(new RegExp(`src="/my/media/${stillRef}"`, 'g')) ?? []).length, 1,
    'a retained artifact appears once beside its record, even when an account exists');
  const promotedRecord = renderWorkWorkspace(withSavedAccount, harvest, view, new URLSearchParams({view:'records',q:promoted[0]!.title}));
  assert.ok(promotedRecord.includes(privateOpen(promoted[0]!)), 'approved additions remain reachable through records');
  assert.match(promotedRecord, /Added from review/);
  assert.equal((withPromotions.match(/<p title="Synthetic machine draft">Synthetic machine draft<\/p>/g)??[]).length,1,'draft title appears once in visible copy');
  const recordsPageOne = renderWorkWorkspace(load, harvest, view, new URLSearchParams('view=records'));
  const recordsPageTwo = renderWorkWorkspace(load, harvest, view, new URLSearchParams('view=records&rpage=2'));
  assert.equal((recordsPageOne.match(/class="work-record"/g) ?? []).length, 20);
  assert.equal((recordsPageTwo.match(/class="work-record"/g) ?? []).length, 20);
  assert.ok(recordsPageOne.includes(ownerLeafletHref(ownRecords[0]!.id)));
  assert.ok(recordsPageTwo.includes(ownerLeafletHref(ownRecords[20]!.id)));
  assert.match(recordsPageOne, /href="\/leaf\/photosynthesis\?view=records&amp;rpage=2">Next<\/a>/);
  assert.match(recordsPageTwo, /href="\/leaf\/photosynthesis\?view=records&amp;rpage=1">Previous<\/a>/);
  const searchedPageTwo = renderWorkWorkspace(load, harvest, view, new URLSearchParams({q:'git',rpage:'2'}));
  assert.match(searchedPageTwo, /href="\/leaf\/photosynthesis\?view=all&amp;q=git&amp;rpage=1">Previous<\/a>/);
  assert.match(searchedPageTwo, /href="\/leaf\/photosynthesis\?view=all&amp;q=git&amp;rpage=3">Next<\/a>/);
  const saved = renderWorkWorkspace(load, harvest, view, new URLSearchParams('view=saved'));
  assert.match(saved, /data-slot="empty-state-title"[^>]*>No saved accounts<\/h2>/);
  assert.match(saved, /href="\/leaf\/setup"[^>]*>Add an account<\/a>/);
  assert.doesNotMatch(saved, /Synthetic machine draft|drafts to review/);

  // Eligibility-only variants over real retained titles. They are not a person's
  // asserted results: Work must not offer an unsupportable or excluded story action.
  const own = ownRecords;
  assert.ok(own.length > 1);
  const pending = own.find(record => record.tier === 'pending'); assert.ok(pending);
  const other = own.find(record => record.id !== pending.id); assert.ok(other);
  const { provenance: _reference, ...withoutReference } = pending;
  const uncited = { ...withoutReference, body: [] };
  const excluded = { id: other.id, title: other.title, tier: 'excluded' as const, reason: 'Attribution withheld in the UI contract.' };
  const variant = { ...load, leaf: { ...load.leaf, leaflets: [uncited, excluded] } };
  const guarded = renderWorkWorkspace(variant, harvest, view);
  assert.ok(guarded.includes(ownerLeafletHref(uncited.id)));
  assert.ok(!guarded.includes(ownerLeafletHref(excluded.id)));
  assert.doesNotMatch(guarded, /href="\/leaf\/story\?leaflet=/);
  assert.match(guarded, /<span class="fol-metric">1<\/span> not attributed/);
  const excludedOnly = renderWorkWorkspace({ ...variant, leaf: { ...variant.leaf, leaflets: [excluded] } }, harvest, view);
  assert.match(excludedOnly, /No attributed work/);
  assert.match(excludedOnly, /<span class="fol-metric">1<\/span> not attributed/);
  assert.equal((excludedOnly.match(/class="fol-button fol-button-primary"/g)??[]).length,1,'unattributed work has one dominant action');
  assert.match(excludedOnly, /href="\/workflow#sources">Connect a source<\/a>/);
  assert.match(excludedOnly, /href="\/leaf\/import">Import a portfolio<\/a>/);
  assert.doesNotMatch(excludedOnly, /Write an account|Tell story|class="work-record"/);
});

test('Work uses the same dated, marked, paused harvest queue as Review', () => {
  const parsed = parseHarvestDocument({ candidates: [
    ['older', '2026-09-01T00:00:00Z'], ['newer', '2026-09-02T00:00:00Z'], ['held', '2026-09-03T00:00:00Z'],
  ].map(([id, authoredAt], i) => ({ id: `git-cluster:${id}`, title: `Synthetic ${id}`, extractor: 'git-cluster', draftedAt: '2026-09-04T00:00:00Z',
    evidence: [{ source: 'git', ref: String(i + 1).repeat(40), observedAt: '2026-09-04T00:00:00Z', authoredAt }], review: { state: 'candidate' } })) });
  assert.ok(parsed.ok);
  const load = { ok: false, cause: 'absent', detail: 'No Leaf', path: '/synthetic-contract/leaf.json' } as const;
  const harvest = { ok: true, harvest: parsed.harvest, path: '/synthetic-contract/harvest.json' } as const;
  const view = { marks: new Map([['git-cluster:held', 'pass'] as const]), retry: new Set<string>(), paused: false };
  const html = renderWorkWorkspace(load, harvest, view, new URLSearchParams('view=draft'));
  assert.ok(html.indexOf('id="draft-git-cluster:newer"') < html.indexOf('id="draft-git-cluster:older"'));
  assert.ok(html.indexOf('id="draft-git-cluster:older"') < html.indexOf('id="draft-git-cluster:held"'));
  assert.match(html, /href="\/review\?focus=git-cluster%3Anewer#candidate-git-cluster%3Anewer"/);
  assert.doesNotMatch(html, /workflow#review|primaryDraft/);
  const overview = renderWorkWorkspace(load, harvest, view);
  assert.match(overview, /class="work-review-next"[^>]*>.*<p title="Synthetic newer">Synthetic newer<\/p>.*href="\/review\?focus=git-cluster%3Anewer#candidate-git-cluster%3Anewer"/s,'Work offers the same first candidate as Review');
  const paused = renderWorkWorkspace(load, harvest, { ...view, paused: true }, new URLSearchParams('view=draft'));
  assert.doesNotMatch(paused, /id="draft-git-cluster:/);
  const absent = renderWorkWorkspace({ok:false,cause:'absent',detail:'No leaf at /private/local/path',path:'/private/local/path'},
    {ok:false,cause:'absent',detail:'No harvest at /private/local/harvest',path:'/private/local/harvest'},view);
  assert.match(absent, /No private record exists here yet/);
  assert.match(absent, /href="\/workflow#sources">Connect a source<\/a>/);
  assert.doesNotMatch(absent, /Record unreadable|class="work-notice"/);
  assert.doesNotMatch(absent, /\/private\/local/);
  assert.doesNotMatch(absent, /<h2>No work<\/h2>/);
  const unreadable = renderWorkWorkspace({ok:false,cause:'unreadable',detail:'Sensitive path',path:'/private/local/path',errno:'EACCES'},
    {ok:false,cause:'absent',detail:'No harvest at /private/local/harvest',path:'/private/local/harvest'},view);
  assert.match(unreadable, /Record unreadable/);
  assert.match(unreadable, /Check local storage access/);
  assert.doesNotMatch(unreadable, /Connect a source|Your work deserves a record|Sensitive path/);
});

test('Work leads approved drafts with no record to creating the record, not to another source', () => {
  const parsed = parseHarvestDocument({ candidates: (['candidate', 'approved', 'approved'] as const).map((state, index) => ({
    id: `git-cluster:${index}`, title: `Contract draft ${index}`, extractor: 'git-cluster', draftedAt: '2026-09-04T00:00:00Z',
    evidence: [{ source: 'git', ref: String(index + 1).repeat(40), observedAt: '2026-09-04T00:00:00Z' }],
    review: state === 'candidate' ? { state } : { state, by: 'Contract reviewer', at: '2026-09-05T00:00:00Z' },
  })) });
  assert.ok(parsed.ok);
  const harvest = { ok: true, harvest: parsed.harvest, path: '/synthetic-contract/harvest.json' } as const;
  const view = { marks: new Map(), retry: new Set<string>(), paused: false };
  const absent = { ok: false, cause: 'absent', detail: 'No Leaf', path: '/synthetic-contract/leaf.json' } as const;
  const create = /<a class="fol-button fol-button-primary" href="\/leaf\/setup">Create your private record<\/a>/;
  const quietCreate = /<section class="work-start work-start-quiet"[^>]*>[\s\S]*?<a class="fol-button fol-button-outline" href="\/leaf\/setup">Create your private record<\/a>/;
  const html = renderWorkWorkspace(absent, harvest, view);
  assert.match(html, /<h2 id="work-start-title">No private record yet<\/h2><p>Create it, then add your 2 approved drafts from Review\.<\/p>/);
  assert.doesNotMatch(html, /Connect a source|\/synthetic-contract/);
  assert.match(html, /class="work-review-next"/, 'the open draft stays one click away');
  // One primary action at a time: while a Ready-to-review card leads, creating the record is quiet.
  assert.match(html, quietCreate);
  assert.doesNotMatch(html, create);
  assert.deepEqual([...html.matchAll(/<a class="fol-button fol-button-primary"[^>]*>([^<]*)<\/a>/g)].map(match => match[1]), ['Review']);
  // With nothing left to review, creating the record is the page's one primary action.
  const decided = parseHarvestDocument({ candidates: parsed.harvest.candidates.filter(c => c.review.state === 'approved') });
  assert.ok(decided.ok);
  const nothingOpen = renderWorkWorkspace(absent, { ...harvest, harvest: decided.harvest }, view);
  assert.match(nothingOpen, create);
  assert.doesNotMatch(nothingOpen, /work-review-next|work-start-quiet/);
  // A bound queue adds only into a record of its own name; no promise when no new record can match.
  const bound = (binding: { subject: string; leafId: string }) => renderWorkWorkspace(absent, { ...harvest, harvest: { ...parsed.harvest, ...binding } }, view);
  assert.match(bound({ subject: 'Alex A', leafId: 'alex-a' }), /<p>Create it as Alex A, then add your 2 approved drafts from Review\.<\/p>/);
  const unmet = bound({ subject: 'Alex A', leafId: 'leaf:other' });
  assert.match(unmet, /<p>Your 2 approved drafts were prepared for another record and can&#39;t be added to a new one\.<\/p>/);
  assert.doesNotMatch(unmet, /then add/);
  // Broken is repaired, never replaced; without approved drafts the first step stays a source.
  assert.doesNotMatch(renderWorkWorkspace({ ok: false, cause: 'invalid', detail: 'needs repair', path: '/synthetic-contract/leaf.json', issues: [] }, harvest, view), create);
  const open = parseHarvestDocument({ candidates: [parsed.harvest.candidates[0]] });
  assert.ok(open.ok);
  const waiting = renderWorkWorkspace(absent, { ...harvest, harvest: open.harvest }, view);
  assert.doesNotMatch(waiting, /Create your private record/);
  assert.match(waiting, /href="\/workflow#sources">Connect a source<\/a>/);
});

test('Work keeps drafts in Review while the explicit draft view and search reach each one', () => {
  const parsed = parseHarvestDocument({ candidates: Array.from({length: 6}, (_, index) => ({
    id: `git-cluster:${index}`, title: `Contract draft ${index}`, extractor: 'git-cluster',
    draftedAt: `2026-09-0${index + 1}T00:00:00Z`,
    evidence: [{ source: 'git', ref: String(index + 1).repeat(40), observedAt: `2026-09-0${index + 1}T00:00:00Z` }],
    review: { state: 'candidate' },
  })) });
  assert.ok(parsed.ok);
  const load = { ok: false, cause: 'absent', detail: 'No Leaf', path: '/synthetic-contract/leaf.json' } as const;
  const harvest = { ok: true, harvest: parsed.harvest, path: '/synthetic-contract/harvest.json' } as const;
  const view = { marks: new Map(), retry: new Set<string>(), paused: false };
  const preview = renderWorkWorkspace(load, harvest, view);
  assert.match(preview, /class="work-review-next"[^>]*>.*Contract draft 0.*href="\/review\?focus=git-cluster%3A0#candidate-git-cluster%3A0"/s);
  assert.ok(preview.indexOf('class="work-review-next"') < preview.indexOf('class="work-start work-start-quiet"'), 'a ready draft leads first use');
  assert.match(preview, /class="work-start work-start-quiet"[\s\S]*href="\/workflow#sources">Connect a source<\/a>/);
  assert.doesNotMatch(preview, /Review all/);
  assert.equal((preview.match(/class="work-item kind-draft"/g) ?? []).length, 0);
  assert.equal((preview.match(/class="fol-button fol-button-primary"/g)??[]).length,1);
  const full = renderWorkWorkspace(load, harvest, view, new URLSearchParams('view=draft'));
  assert.equal((full.match(/class="work-item kind-draft"/g) ?? []).length, 6);
  const found = renderWorkWorkspace(load, harvest, view, new URLSearchParams('q=Contract draft 0'));
  assert.match(found, /id="draft-git-cluster:0"/);
  const paused = renderWorkWorkspace(load, harvest, {...view,paused:true});
  assert.doesNotMatch(paused, /class="work-review-next"|Contract draft 0/);
  const unreadable = renderWorkWorkspace(load, {ok:false,cause:'unreadable',detail:'Sensitive path',path:'/private/harvest.json',errno:'EACCES'}, view);
  assert.match(unreadable, /Review queue unreadable/);
  assert.doesNotMatch(unreadable, /class="work-review-next"|Contract draft 0|Sensitive path/);
});

test('Ready to review names approved work the record does not hold yet, and only that', () => {
  // Two open drafts and two approved: one approved draft is already a leaflet, one is not.
  const parsed = parseHarvestDocument({ candidates: [
    ['open-a', 'candidate'], ['open-b', 'candidate'], ['added', 'approved'], ['waiting', 'approved'],
  ].map(([id, state], i) => ({ id: `git-cluster:${id}`, title: `Synthetic ${id}`, extractor: 'git-cluster', draftedAt: '2026-09-04T00:00:00Z',
    evidence: [{ source: 'git', ref: String(i + 1).repeat(40), observedAt: '2026-09-04T00:00:00Z' }],
    review: state === 'approved' ? { state, by: 'Contract Reviewer', at: '2026-09-05T00:00:00Z' } : { state } })) });
  assert.ok(parsed.ok);
  const leaf = parseLeafDocument({ id: 'contract-leaf', subject: 'Contract Subject', leaflets: [
    { id: 'git-cluster:added', title: 'Synthetic added', tier: 'pending', provenance: { source: 'git', ref: '3'.repeat(40), observedAt: '2026-09-04T00:00:00Z' } },
  ] });
  assert.ok(leaf.ok);
  const load = { ok: true, leaf: leaf.leaf, source: { path: '/synthetic-contract/leaf.json', bytes: 1, documentDigest: `sha256:${'0'.repeat(64)}`, readAt: '2026-09-05T00:00:00Z', declaredExample: false, bundledExample: false } } as const;
  const harvest = { ok: true, harvest: parsed.harvest, path: '/synthetic-contract/harvest.json' } as const;
  const view = { marks: new Map(), retry: new Set<string>(), paused: false };
  const card = /<section class="work-review-next"[\s\S]*?<\/section>/.exec(renderWorkWorkspace(load, harvest, view))?.[0] ?? '';
  assert.match(card, /<span class="fol-metric">2<\/span> drafts · <a class="work-review-waiting" href="\/review#review-promote-h"><span class="fol-metric">1<\/span> approved waiting<\/a>/,
    'the waiting count subtracts what the leaf already holds and links the promote panel');

  // Everything approved is already in the record: the card says nothing about it.
  const settled = parseLeafDocument({ ...leaf.leaf, leaflets: [...leaf.leaf.leaflets,
    { id: 'git-cluster:waiting', title: 'Synthetic waiting', tier: 'pending', provenance: { source: 'git', ref: '4'.repeat(40), observedAt: '2026-09-04T00:00:00Z' } }] });
  assert.ok(settled.ok);
  assert.doesNotMatch(renderWorkWorkspace({ ...load, leaf: settled.leaf }, harvest, view), /approved waiting/);

  // No leaf read: nothing to subtract and nothing the promote panel can add into, so no count.
  const absent = renderWorkWorkspace({ ok: false, cause: 'absent', detail: 'No Leaf', path: '/synthetic-contract/leaf.json' }, harvest, view);
  assert.match(absent, /class="work-review-next"/, 'the drafts are still ready to review');
  assert.doesNotMatch(absent, /approved waiting|review-promote-h/);
});
