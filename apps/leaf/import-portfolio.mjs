#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { requireNodeFloor } from './src/nodeFloor.mjs';
requireNodeFloor();
const { boundedIntegrationFile } = await import('./src/integrationStore.ts');
const { previewPortfolioImport, importPortfolio } = await import('./src/portfolioImport.ts');
try {
  const {values,tokens} = parseArgs({options:{input:{type:'string'},title:{type:'string'},source:{type:'string'},into:{type:'string'},out:{type:'string'},import:{type:'boolean'},help:{type:'boolean'}},strict:true,tokens:true});
  const seen = new Set();
  for (const token of tokens) if(token.kind==='option') { if(seen.has(token.name)) throw new Error(`Duplicate --${token.name}.`); seen.add(token.name); }
  if(values.help) console.log('Preview: node apps/leaf/import-portfolio.mjs --input portfolio.md --title "My portfolio"\nImport into private review: add --import --into leaf.json --out harvest.json\nOptional --source preserves the original page address or filename. No URL is fetched, no claim is verified, and nothing is published.');
  else {
    if(!values.input?.trim() || !values.title?.trim()) throw new Error('Choose --input and --title. Use --help for details.');
    const input = {title:values.title,source:values.source??basename(values.input),text:await boundedIntegrationFile(resolve(values.input),400000)};
    if(values.import) {
      if(!values.into?.trim() || !values.out?.trim()) throw new Error('Import requires explicit --into and --out paths.');
      console.log(JSON.stringify(await importPortfolio(input,resolve(values.into),resolve(values.out))));
    } else console.log(JSON.stringify(previewPortfolioImport(input),null,2));
  }
} catch(error) { console.error(`import-portfolio: ${error instanceof Error ? error.message : String(error)}`); process.exitCode=1; }
