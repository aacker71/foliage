import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./review-brief.mjs', import.meta.url));

test('real repository collection is idempotent and source errors preserve its checkpoint', async () => {
  const state = await mkdtemp(join(tmpdir(), 'foliage-brief-test-'));
  const identity = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%ae'], {encoding:'utf8'}).trim();
  const run = (source=repo) => spawnSync(process.execPath,[script,'--repo',source,'--state',state,'--identity',identity],{encoding:'utf8'});
  try {
    const first = run(); assert.equal(first.status,0,first.stderr);
    const result = JSON.parse(first.stdout);
    assert.ok(result.matchedCommits > 0);
    const report = JSON.parse(await readFile(result.report,'utf8'));
    for (const item of report.evidence) {
      const actual = execFileSync('git',['-C',repo,'show','-s','--format=%ae',item.sha],{encoding:'utf8'}).trim();
      assert.equal(actual.toLowerCase(),identity.toLowerCase());
    }
    const checkpoint = await readFile(join(state,'checkpoint.json'),'utf8');
    for(let i=0;i<2;i++) {
      const again=run();assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).status,'unchanged');
      assert.equal(await readFile(join(state,'checkpoint.json'),'utf8'),checkpoint);
    }
    assert.notEqual(run(join(state,'missing-repo')).status,0);
    assert.equal(await readFile(join(state,'checkpoint.json'),'utf8'),checkpoint);
  } finally { await rm(state,{recursive:true,force:true}); }
});
