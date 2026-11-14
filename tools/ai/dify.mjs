#!/usr/bin/env node
/** Dify is an isolated developer service, never a Foliage runtime dependency. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export const release = '1.17.0';
export const commit = '09a855dcef24c0edc7431c46c0cfaa494481daf5';
export const stateDir = join(homedir(), '.foliage/dev/dify');
export const baseURL = 'http://127.0.0.1:4280';
const source = join(stateDir, 'source');
const cwd = join(source, 'docker');
const desktop = '/Applications/Docker.app/Contents/Resources/bin/docker';
const docker = existsSync(desktop) ? desktop : 'docker';
const env = { ...process.env, PATH: docker === desktop ? `${dirname(docker)}:${process.env.PATH}` : process.env.PATH };
const composeArgs = ['compose', '--project-name', 'foliage-dify', '-f', join(cwd, 'docker-compose.yaml'), '-f', join(stateDir, 'loopback.yaml')];
class InstallationError extends Error {}
function run(bin, args, options = {}) {
  return execFileSync(bin, args, { cwd: existsSync(cwd) ? cwd : undefined, env, stdio: 'inherit', ...options });
}
export function compose(args, options) { return run(docker, [...composeArgs, ...args], options); }
export function privateJSON(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
async function portAvailable() {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new InstallationError('Port 4280 is occupied; inspect its owner before starting Dify.')));
    server.listen(4280, '127.0.0.1', () => server.close(resolve));
  });
}
async function install() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  if (!existsSync(source)) run('git', ['clone', '--depth', '1', '--branch', release, 'https://github.com/langgenius/dify.git', source]);
  const actual = run('git', ['rev-parse', 'HEAD'], { cwd: source, stdio: 'pipe', encoding: 'utf8' }).trim();
  if (actual !== commit) throw new InstallationError('Dify checkout differs from the reviewed commit. Preserve it and review the upgrade separately.');
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) {
    let contents = readFileSync(join(cwd, '.env.example'), 'utf8');
    const secret = () => randomBytes(32).toString('hex');
    const vectorKey = secret();
    const sandboxKey = secret();
    const values = {
      SECRET_KEY: secret(), INIT_PASSWORD: randomBytes(12).toString('hex'), DB_PASSWORD: secret(), REDIS_PASSWORD: secret(),
      SANDBOX_API_KEY: sandboxKey, CODE_EXECUTION_API_KEY: sandboxKey, PLUGIN_DAEMON_KEY: secret(), PLUGIN_DIFY_INNER_API_KEY: secret(),
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: secret(), DIFY_AGENT_SERVER_SECRET_KEY: randomBytes(32).toString('base64url'), DIFY_AGENT_API_TOKEN: secret(),
      WEAVIATE_API_KEY: vectorKey, WEAVIATE_AUTHENTICATION_APIKEY_ALLOWED_KEYS: vectorKey,
      WEAVIATE_DISABLE_TELEMETRY: 'true', SANDBOX_ENABLE_NETWORK: 'true', MARKETPLACE_ENABLED: 'false',
      SSRF_PROXY_ALLOW_PRIVATE_DOMAINS: 'host.docker.internal', CHECK_UPDATE_URL: '', EXPOSE_NGINX_PORT: '4280', CONSOLE_WEB_URL: baseURL, SERVICE_API_URL: baseURL,
      APP_WEB_URL: baseURL, CONSOLE_API_URL: baseURL, APP_API_URL: baseURL,
    };
    for (const [key, value] of Object.entries(values)) {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      contents = pattern.test(contents) ? contents.replace(pattern, `${key}=${value}`) : `${contents}\n${key}=${value}\n`;
    }
    writeFileSync(envPath, contents, { flag: 'wx', mode: 0o600 });
  }
  if (!existsSync(join(stateDir, 'loopback.yaml'))) writeFileSync(join(stateDir, 'loopback.yaml'),
    "services:\n  nginx:\n    ports: !override\n      - \"127.0.0.1:4280:80\"\n  plugin_daemon:\n    ports: !reset []\n  sandbox:\n    environment:\n      HTTP_PROXY: \"\"\n      HTTPS_PROXY: \"\"\n    networks: !override\n      - foliage_code\n  api:\n    networks:\n      - foliage_code\n  api_websocket:\n    networks:\n      - foliage_code\n  worker:\n    networks:\n      - foliage_code\n  worker_beat:\n    networks:\n      - foliage_code\nnetworks:\n  foliage_code:\n    internal: true\n", { mode: 0o600, flag: 'wx' });
  // Config may contain credentials. Inspect in memory; never emit the resolved config.
  const config = JSON.parse(compose(['config', '--format', 'json'], { stdio: 'pipe', encoding: 'utf8' }));
  for (const service of Object.values(config.services)) for (const port of service.ports ?? []) {
    if (port.host_ip !== '127.0.0.1') throw new InstallationError('Refusing a Dify port exposed beyond loopback.');
  }
  console.log(`Dify ${release} prepared at ${stateDir}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'install') await install();
    else if (command === 'up') {
      await install();
      const running = compose(['ps', '--status', 'running', '-q', 'nginx'], { stdio: 'pipe', encoding: 'utf8' }).trim();
      if (!running) await portAvailable();
      compose(['up', '-d', '--wait', '--wait-timeout', '180']);
      console.log(`Dify is running: ${baseURL}. Run pnpm ai:status to check health.`);
    } else if (command === 'status') compose(['ps']);
    else if (command === 'stop') compose(['stop']);
    else throw new InstallationError('Use install, up, status, or stop. Data is preserved when stopped.');
  } catch (error) {
    console.error(error instanceof InstallationError ? error.message : 'Dify command failed. Inspect container status; credentials were not printed.');
    process.exitCode = 1;
  }
}
