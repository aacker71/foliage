/** Protocol fixtures only: these inputs describe no person's work or achievements. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPortfolio, previewPortfolioImport } from './portfolioImport.ts';
import { renderPortfolioImport } from './portfolioImportPage.ts';
const input = {title:'Parser protocol',source:'protocol.md',text:'# First section\nLiteral parser input.\n\n## Second section\n<script>untrusted()</script>'};
test('preview preserves selected text and escapes executable markup',()=>{
 const preview=previewPortfolioImport(input);
 assert.equal(preview.sections.map(s=>s.text).join(''),input.text);
 assert.equal(preview.sections.length,2);
 const html=renderPortfolioImport(input,{preview:true});
 assert.ok(!html.includes('<script>untrusted()'));
 assert.ok(html.includes('&lt;script&gt;untrusted()'));
 assert.match(html,/Add to private review/);
});
test('import form keeps a native file choice and labelled editable text in one private form',()=>{
 const html=renderPortfolioImport();
 assert.match(html, /<div class="import-upload" hidden>/);
 assert.match(html, /id="import-upload-label"[^>]*>Open a text or Markdown file<\/p>/);
 assert.match(html, /<label class="import-file-control"><span>Choose file<\/span><input[^>]*id="portfolio-file"[^>]*type="file"/);
 assert.match(html, /aria-describedby="import-upload-label import-file-name import-file-status"/);
 assert.match(html, /id="import-file-name"[^>]*>No file chosen<\/span>/);
 assert.doesNotMatch(html, /<input[^>]*id="portfolio-file"[^>]*name=/);
 assert.match(html, /<label[^>]*for="import-text"[^>]*>Paste portfolio text<\/label>/);
 assert.match(html, /<textarea[^>]*id="import-text"[^>]*name="text"[^>]*required=""/);
 assert.match(html, /<link rel="icon" href="\/mark-icon\.svg">/, 'no /favicon.ico 404 in the console');
 // The browser refuses to submit without it; the label says so before the person finds out.
 assert.match(html, /<label for="import-source">Original filename or page address \(required\)<\/label><input[^>]*id="import-source"[^>]*required=""/);
});
test('import failure is a focusable alert while the original form remains available',()=>{
 const html=renderPortfolioImport(input,{error:'Unsupported source'});
 const alert=/<div\b[^>]*data-slot="feedback-notice"[^>]*>/.exec(html)?.[0];
 assert.ok(alert);
 for(const attribute of ['data-tone="error"','id="import-response"','tabindex="-1"','role="alert"']) assert.ok(alert.includes(attribute));
 assert.match(html, /<form method="post" action="\/leaf\/import"/);
 assert.match(html, /Unsupported source/);
});
test('binary and oversized sections are refused without silent truncation',()=>{
 assert.throws(()=>previewPortfolioImport({...input,text:'bad\u0000text'}),/binary/);
 assert.throws(()=>previewPortfolioImport({...input,text:'x'.repeat(16000)}),/Split long/);
});
test('imports remain unreviewed, replay retains decisions, and leaf bytes stay intact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'foliage-import-protocol-'));
 try {
  const into=join(dir,'leaf.json'),out=join(dir,'harvest.json');
  const original=JSON.stringify({id:'protocol-only',subject:'Protocol test input',leaflets:[]});
  await writeFile(into,original);
  const first=await importPortfolio(input,into,out);
  assert.equal(first.imported,2);
  const document=JSON.parse(await readFile(out,'utf8'));
  assert.deepEqual(document.candidates[0].review,{state:'candidate'});
  assert.equal(document.candidates[0].evidence[0].source,'integration:portfolio-import');
  document.candidates[0].review={state:'rejected',by:'Protocol test',at:new Date().toISOString(),reason:'Protocol preservation check'};
  await writeFile(out,JSON.stringify(document));
  const before=await readFile(out,'utf8');
  const again=await importPortfolio(input,into,out);
  assert.equal(again.imported,0); assert.equal(again.unchanged,2);
  assert.equal(await readFile(out,'utf8'),before);
  assert.equal(await readFile(into,'utf8'),original);
  await assert.rejects(importPortfolio(input,into,into),/separate/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
