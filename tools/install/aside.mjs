#!/usr/bin/env node
/** Aside adapter setup. Uses documented CLI/MCP; never edits browser permissions or host config. */
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ASIDE_DOCS='https://docs.aside.com/help/developers';
/** @param {NodeJS.ProcessEnv} [env] @param {string} [home] */
export async function findAside(env=process.env,home=homedir()) {
  const candidates=[...(env['PATH']??'').split(delimiter).filter(isAbsolute).map(p=>join(p,'aside')),join(home,'.local/bin/aside')];
  for(const path of candidates) {try {await access(path,constants.X_OK);return await realpath(path);}catch{/* Try the documented user installation after PATH. */}}
  return null;
}
/** @param {string} command */
export function inspectAside(command) {
  const result=spawnSync(command,['--version'],{encoding:'utf8',timeout:10000,maxBuffer:16384});
  if(result.error||result.status!==0) return {ok:false,detail:/** @type {NodeJS.ErrnoException|undefined} */(result.error)?.code==='ETIMEDOUT'?'Aside CLI timed out.':'Aside CLI could not report its version.'};
  const version=result.stdout.trim();
  if(!version||version.length>200||/[\u0000-\u001f\u007f]/.test(version)) return {ok:false,detail:'Aside CLI returned an unreadable version.'};
  return {ok:true,detail:version};
}
/** @param {{aside:string,node:string,runtime:string,garden:string}} paths */
export function asideMcpConfig(paths) {
  for(const value of Object.values(paths)) if(!isAbsolute(value)) throw new Error('Aside setup requires explicit absolute paths.');
  return {mcpServers:{aside:{command:paths.aside,args:['mcp','--host','local']},foliage:{command:paths.node,args:[join(paths.runtime,'foliage.mjs'),'mcp','--garden',paths.garden]}}};
}
/** Create a portable two-server profile, not an undocumented Aside MCP-client configuration.
 * @param {string} garden @param {ReturnType<typeof asideMcpConfig>} config */
export async function saveAsideProfile(garden,config) {
  const directory=join(garden,'integrations');await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'aside.mcp.json'),content=JSON.stringify(config,null,2)+'\n';
  try {await writeFile(path,content,{flag:'wx',mode:0o600});}
  catch(error) {
    if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST') throw error;
    if(await readFile(path,'utf8')!==content) throw new Error('Aside profile already exists with different settings. It was preserved.');
  }
  return path;
}
async function installCli() {
  if(process.platform!=='darwin') throw new Error(`Automatic Aside CLI installation here supports macOS only. Use ${ASIDE_DOCS} for your platform.`);
  const temporary=await mkdtemp(join(tmpdir(),'foliage-aside-'));
  try {
    const file=join(temporary,'install.sh');
    const download=spawnSync('curl',['--fail','--silent','--show-error','--proto','=https','--max-time','45','--max-filesize','1048576','https://releases.aside.com/install.sh','--output',file],{stdio:'inherit',timeout:50000});
    if(download.error||download.status!==0) throw new Error('Aside CLI installer download failed. No installer was executed.');
    const env={...process.env};for(const key of Object.keys(env)) if(key.startsWith('ASIDE_CLI_')) delete env[key];
    // Explicit opt-in uses Aside's published installer and its documented user directories.
    const result=spawnSync('bash',[file],{env,stdio:'inherit',timeout:120000,killSignal:'SIGTERM'});
    if(result.error||result.status!==0) throw new Error('Aside CLI installation did not complete. Inspect the vendor output before retrying.');
  }finally{await rm(temporary,{recursive:true,force:true});}
}
/** @param {string[]} argv */
async function main(argv) {
  const {values,positionals,tokens}=parseArgs({args:argv,strict:true,allowPositionals:true,tokens:true,options:{garden:{type:'string'},'install-cli':{type:'boolean'},probe:{type:'boolean'},help:{type:'boolean'}}});
  const seen=new Set();for(const token of tokens) if(token.kind==='option'){if(seen.has(token.name)) throw new Error(`Repeated --${token.name}.`);seen.add(token.name);}
  if(values.help){console.log('Photosynthesis + Aside\n  node tools/install/aside.mjs doctor [--probe]\n  node tools/install/aside.mjs setup --garden /absolute/garden [--install-cli]\nSetup writes a portable MCP profile. --install-cli explicitly installs the vendor CLI when missing; it does not install the browser, sign in, or enable capture.');return;}
  const action=positionals[0];if(positionals.length!==1||!['doctor','setup'].includes(action??'')) throw new Error('Choose doctor or setup.');
  if(action==='doctor'&&(values.garden||values['install-cli'])||action==='setup'&&values.probe) throw new Error('Choose options for the selected action.');
  if(action==='setup'&&(!values.garden||!isAbsolute(values.garden))) throw new Error('Choose an absolute --garden for this connection.');
  const garden=action==='setup'?await realpath(values.garden??''):undefined;
  if(garden && !(await stat(garden)).isDirectory()) throw new Error('Choose an existing garden directory.');
  let command=await findAside();
  if(!command&&values['install-cli']) {await installCli();command=await findAside();}
  if(!command) {console.log(`Aside CLI: missing. Setup: ${ASIDE_DOCS}`);if(action==='setup'||values.probe) process.exitCode=1;return;}
  const result=inspectAside(command);console.log(`Aside CLI: ${result.detail}`);if(!result.ok){process.exitCode=1;return;}
  if(action==='setup') {
    if(!garden) throw new Error('Choose an existing garden directory.');
    const path=await saveAsideProfile(garden,asideMcpConfig({aside:command,node:process.execPath,runtime:root,garden}));
    console.log(`MCP profile: ${path}\nUse this profile in a host supporting mcpServers. Existing host settings were not changed.\nCapture is off. Browser sign-in and a selected-page handoff still need verification.`);
  } else if(values.probe) {
    const probe=spawnSync(command,['repl','--host','local','console.log("FOLIAGE_ASIDE_READY")'],{encoding:'utf8',timeout:30000,maxBuffer:65536});
    if(probe.error||probe.status!==0||!/^FOLIAGE_ASIDE_READY\s*$/m.test(probe.stdout??'')||/^\[error/m.test(probe.stdout??'')) {
      const diagnostic=String(probe.stderr??'')+String(probe.stdout??'');
      const cause=/no normal browser window/i.test(diagnostic)?'Open a normal Aside window for the selected account.':/signed.out|sign.in|login/i.test(diagnostic)?'Sign in to the selected Aside account.':probe.error?'Aside CLI did not finish the readiness check.':'Check Aside account and developer settings.';
      throw new Error('Aside REPL is not ready. '+cause+' No page was read.');
    }
    console.log('Aside REPL: ready. No page was read. Account access and learning capture remain unverified.');
  }else console.log('Browser session: unverified. Run doctor --probe to check the REPL without reading a page.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error=>{console.error(`Aside setup: ${error instanceof Error?error.message:'failed'}`);process.exitCode=1;});
