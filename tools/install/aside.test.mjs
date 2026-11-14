/** Installer protocol checks; no browser connection or captured learning is simulated as real. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {findAside,inspectAside,asideMcpConfig,saveAsideProfile} from './aside.mjs';
const runtime=fileURLToPath(new URL('../../',import.meta.url));
test('Aside profile binds both documented stdio servers without authoring authority; retries preserve owner changes',async()=>{
 const garden=await mkdtemp(join(tmpdir(),'foliage-aside-profile-'));
 try {
  const config=asideMcpConfig({aside:'/opt/aside',node:process.execPath,runtime,garden});
  assert.deepEqual(config.mcpServers.aside,{command:'/opt/aside',args:['mcp','--host','local']});
  assert.deepEqual(config.mcpServers.foliage.args,[join(runtime,'foliage.mjs'),'mcp','--garden',garden]);
  const path=await saveAsideProfile(garden,config),bytes=await readFile(path,'utf8');
  assert.equal((await stat(path)).mode&0o777,0o600);assert.equal(await saveAsideProfile(garden,config),path);assert.equal(await readFile(path,'utf8'),bytes);
  await writeFile(path,bytes+'\n');await assert.rejects(saveAsideProfile(garden,config),/preserved/);assert.equal(await readFile(path,'utf8'),bytes+'\n');
  assert.throws(()=>asideMcpConfig({aside:'aside',node:process.execPath,runtime,garden}),/absolute/);
 }finally{await rm(garden,{recursive:true,force:true});}
});
test('Aside discovery distinguishes missing CLI, executable and failed version probe',async()=>{
 const home=await mkdtemp(join(tmpdir(),'foliage-aside-discovery-'));
 try {
  assert.equal(await findAside({PATH:''},home),null);
  await mkdir(join(home,'.local/bin'),{recursive:true});const cli=join(home,'.local/bin/aside');
  await writeFile(cli,'#!/bin/sh\nexit 3\n',{mode:0o700});
  assert.equal(await findAside({PATH:''},home),await realpath(cli));assert.equal(inspectAside(cli).ok,false);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('installer requires an explicit garden before any Aside installation and refuses duplicate options',()=>{
 for(const args of [['--with-aside'],['--with-aside','--with-aside'],['--garden','relative'],['--unknown']]) {
  const result=spawnSync('sh',[join(runtime,'install.sh'),...args],{encoding:'utf8'});assert.notEqual(result.status,0);assert.ok(!result.stdout.includes('Linking the workspace'));
 }
 const setup=spawnSync(process.execPath,[join(runtime,'tools/install/aside.mjs'),'setup','--install-cli'],{encoding:'utf8'});
 assert.notEqual(setup.status,0);assert.match(setup.stderr,/absolute --garden/);
});
