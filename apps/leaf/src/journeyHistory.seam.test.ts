/** Real repository evidence in a disposable garden; authoring inputs exercise recovery only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadLeafDocument } from './leafDocument.ts';
import { savePresentation, renderPresentation, resumeDraft } from './portfolioPresentation.ts';
import { parseLeafDocument } from '@foliage/leaf';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test('owner correction, agent rewrite, restart and undo preserve exact versions and synchronized resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-journey-history-'));
  const env = { FOLIAGE_LEAF: join(dir,'leaf.json') };
  try {
    const identity = execFileSync('git',['log','-1','--format=%ae'],{cwd:root,encoding:'utf8'}).trim();
    execFileSync(process.execPath,['apps/leaf/intake.mjs','--repo',root,'--identity',identity,'--subject','History recovery protocol','--out',env.FOLIAGE_LEAF],{cwd:root});
    const read = async () => { const v = await loadLeafDocument(env); assert.ok(v.ok); return v; };
    const initial = await read();
    const source = initial.leaf.leaflets.find(r=>r.provenance && r.tier!=='excluded' && r.title.trim().split(/\s+/).length >= 4); assert.ok(source?.provenance);
    // Each revision is a different excerpt of the same cited Git subject. Moving HEAD can
    // introduce a number in an unrelated title, which this citation must not claim.
    const sourceWords = source.title.trim().split(/\s+/);
    const words = [sourceWords.slice(0,2).join(' '), sourceWords.slice(0,3).join(' '), source.title];
    const form = async (values: Record<string,string>) => {
      const current = await read();
      return new URLSearchParams({ leafId: current.leaf.id, subject: current.leaf.subject, documentRevision: current.source.documentDigest, ...values });
    };
    await savePresentation(env,await form({action:'achievement',achievement:'',title:source.title}),'agent');
    const id = (await read()).leaf.achievements![0]!.id;
    const citation = JSON.stringify([source.id,source.provenance.source,source.provenance.ref,source.provenance.observedAt]);
    await savePresentation(env,await form({action:'claim',achievement:id,claim:'',kind:'learning',text:words[0]!,citation}),'agent');
    const claim = (await read()).leaf.achievements![0]!.claims[0]!;
    const update = (text: string) => form({action:'claim',achievement:id,claim:claim.id,kind:'learning',text,citation});
    await savePresentation(env,await update(words[1]!));
    const correction = (await read()).leaf.journeyHistory![0]!;
    assert.equal(correction.actor,'manual');
    await savePresentation(env,await update(words[2]!),'agent');
    const rewritten = await read();
    assert.equal(rewritten.leaf.journeyHistory![0]!.actor,'agent');
    assert.equal(rewritten.leaf.journeyHistory![0]!.before!.claims[0]!.text,words[1]);
    assert.deepEqual(rewritten.leaf.leaflets,initial.leaf.leaflets);
    await savePresentation(env,await form({action:'claim',achievement:id,claim:'',kind:'learning',text:'Later statement',citation}));
    const withLaterStatement = await read();
    assert.equal(withLaterStatement.leaf.achievements![0]!.claims.length,2);
    const historyPage = renderPresentation(withLaterStatement,new URLSearchParams({edit:'journey-history',achievement:id}));
    assert.match(historyPage,/<h1>History<\/h1>/); assert.match(historyPage,/<summary>Assistant · /);
    assert.match(historyPage,/>Restore entire achievement<\/button>/);
    assert.match(historyPage,/Changes to current version/);
    assert.match(historyPage,/Later statement/);
    const stale = await update(words[0]!);
    const restore = await form({action:'journey-restore',achievement:id,editId:correction.id,version:'after',replaceCurrent:'yes'});
    const unconfirmed = new URLSearchParams(restore); unconfirmed.delete('replaceCurrent');
    const beforeUnconfirmed = await readFile(env.FOLIAGE_LEAF,'utf8');
    await assert.rejects(savePresentation(env,unconfirmed),/Confirm replacement/);
    assert.equal(await readFile(env.FOLIAGE_LEAF,'utf8'),beforeUnconfirmed);
    // Execute the restore in a fresh process, with no in-memory edit history available.
    execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',
      "import {savePresentation} from './apps/leaf/src/portfolioPresentation.ts'; import {readFileSync} from 'node:fs'; await savePresentation(process.env,new URLSearchParams(readFileSync(0,'utf8')));"],
      {cwd:root,env:{...process.env,...env},input:restore.toString()});
    const restored = await read();
    assert.equal(restored.leaf.achievements![0]!.claims[0]!.text,words[1]);
    assert.equal(restored.leaf.achievements![0]!.claims.length,1,'acknowledged restore replaces the later statement');
    assert.deepEqual(restored.leaf.achievements![0]!.claims[0]!.citations,claim.citations);
    assert.equal(restored.leaf.journeyHistory!.length,withLaterStatement.leaf.journeyHistory!.length+1);
    assert.equal(restored.leaf.journeyHistory![0]!.before!.claims[0]!.text,words[2]);
    assert.equal(restored.leaf.journeyHistory![0]!.before!.claims[1]!.text,'Later statement','history keeps what restore replaced');
    assert.ok(resumeDraft(restored.leaf).includes(words[1]!.replace(/[\\`*_{}\[\]<>#+.!|~-]/g,'\\$&')));
    await assert.rejects(savePresentation(env,stale,'agent'),/changed/);
    await assert.rejects(savePresentation(env,restore),/changed/);
    const beforeNoop = await readFile(env.FOLIAGE_LEAF,'utf8');
    await savePresentation(env,await update(words[1]!),'agent');
    assert.equal(await readFile(env.FOLIAGE_LEAF,'utf8'),beforeNoop,'unchanged retry neither writes nor duplicates history');
    await savePresentation(env,await update(words[0]!),'agent');
    assert.equal((await read()).leaf.journeyHistory!.length,restored.leaf.journeyHistory!.length+1,'second agent cycle retains earlier correction and undo');
    const beforeRefresh = await read();
    const changed = { ...beforeRefresh.leaf, leaflets: beforeRefresh.leaf.leaflets.filter(r=>r.id!==source.id) };
    await writeFile(env.FOLIAGE_LEAF,JSON.stringify(changed));
    const undoMissing = await form({action:'journey-restore',achievement:id,editId:correction.id,version:'after',replaceCurrent:'yes'});
    const bytes = await readFile(env.FOLIAGE_LEAF,'utf8');
    await assert.rejects(savePresentation(env,undoMissing),/unavailable citations/);
    assert.equal(await readFile(env.FOLIAGE_LEAF,'utf8'),bytes);
    const parsed = parseLeafDocument(JSON.parse(bytes)); assert.ok(parsed.ok,'unavailable support must not erase the retained history');
    assert.deepEqual(parsed.leaf.journeyHistory,beforeRefresh.leaf.journeyHistory);
    for (const mutate of [
      (v: any) => { v.journeyHistory[0].actor='system'; },
      (v: any) => { v.journeyHistory[0].before.id='another-journey'; },
      (v: any) => { v.journeyHistory[0].after.claims[0].secret='unexpected'; },
      (v: any) => { v.journeyHistory.push(v.journeyHistory[0]); },
      (v: any) => { v.journeyHistory[0].at=null; },
    ]) { const invalid=JSON.parse(bytes); mutate(invalid); assert.equal(parseLeafDocument(invalid).ok,false); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
