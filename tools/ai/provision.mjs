/** Local self-hosted console API, pinned to Dify 1.17.0. No credentials in output. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { baseURL, stateDir, privateJSON } from './dify.mjs';
import { workflow } from './workflow.mjs';
class ProvisionError extends Error {}
const jar = new Map();
async function request(path, body) {
  const response = await fetch(`${baseURL}/console/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      'X-CSRF-Token': jar.get('csrf_token') ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  if (!response.ok) throw new ProvisionError(`Local Dify ${path} returned HTTP ${response.status}. Inspect the local service logs.`);
  return response.json();
}
try {
  const accountPath = join(stateDir, 'admin.json');
  const setup = await request('/setup');
  if (!existsSync(accountPath)) {
    if (setup.step !== 'not_started') throw new ProvisionError('Dify has an existing owner. Sign in and import the versioned workflow; do not replace that account.');
    privateJSON(accountPath, { email: 'foliage-dev@localhost.local', name: 'Foliage local development', password: `Fol1${randomBytes(20).toString('hex')}`, language: 'en-US' });
  }
  const account = JSON.parse(readFileSync(accountPath, 'utf8'));
  if (setup.step === 'not_started') {
    const env = readFileSync(join(stateDir, 'source/docker/.env'), 'utf8');
    await request('/init', { password: env.match(/^INIT_PASSWORD=(.*)$/m)[1] });
    await request('/setup', account);
  }
  const login = await request('/login', { email: account.email, password: Buffer.from(account.password).toString('base64'), remember_me: true });
  if (login.result !== 'success') throw new ProvisionError('Local Dify login did not succeed.');
  const configPath = join(stateDir, 'workflow.json');
  const previous = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : undefined;
  const dsl = JSON.stringify(workflow, null, 2);
  const digest = createHash('sha256').update(dsl).digest('hex');
  if (previous && previous.workflowDigest !== digest && process.argv[2] !== '--update') throw new ProvisionError('The workflow changed. Review the diff, then run pnpm ai:provision --update to replace its local published version.');
  if (previous?.workflowDigest === digest) {
    const published = await request(`/apps/${previous.appId}/workflows/publish`);
    if (!published?.id) throw new ProvisionError('Published workflow unavailable.');
    if (!previous.workflowId) writeFileSync(configPath, JSON.stringify({ ...previous, workflowId: published.id }, null, 2), { mode: 0o600 });
    console.log(`Workflow already provisioned: ${baseURL}/app/${previous.appId}/workflow`);
  } else {
    const imported = await request('/apps/imports', { mode: 'yaml-content', yaml_content: dsl, ...(previous ? { app_id: previous.appId } : {}) });
    if (imported.status !== 'completed') throw new ProvisionError(`Import requires review (${imported.status}). Inspect local Dify before publishing.`);
    await request(`/apps/${imported.app_id}/workflows/publish`, { marked_name: 'Foliage evidence lab', marked_comment: digest });
    const key = previous?.apiKey ?? (await request(`/apps/${imported.app_id}/api-keys`, {})).token;
    const published = await request(`/apps/${imported.app_id}/workflows/publish`);
    if (!published?.id) throw new ProvisionError('Published workflow unavailable.');
    const config = { workflowId: published.id, baseURL, appId: imported.app_id, apiKey: key, workflowDigest: digest };
    if (previous) writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    else privateJSON(configPath, config);
    console.log(`Workflow ready: ${baseURL}/app/${imported.app_id}/workflow`);
  }
} catch (error) { console.error(error instanceof ProvisionError ? error.message : 'Provisioning failed. Check local service readiness and credential files; no private response was printed.'); process.exitCode = 1; }
