#!/usr/bin/env node
/** Host adapter only: all portfolio writes belong to the existing Foliage CLI. */
import { parseArgs } from 'node:util';
import { resolve, isAbsolute, join } from 'node:path';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

try {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true, strict: true, options: {
    home: { type: 'string' }, garden: { type: 'string' }, repo: { type: 'string' },
    subject: { type: 'string' }, identity: { type: 'string', multiple: true }, help: { type: 'boolean' },
  } });
  const seen = new Set();
  for (const token of tokens) if (token.kind === 'option' && token.name !== 'identity') {
    if (seen.has(token.name)) throw Error(`Duplicate --${token.name} is refused.`);
    seen.add(token.name);
  }
  if (values.help) {
    console.log('Photosynthesis for agent hosts\n  node photosynthesis.mjs doctor|status|refresh --home <Foliage checkout> --garden <absolute garden> [--repo <absolute repo> --subject <name> --identity <email>]\nRefresh only gathers private work and prepares review. It never approves or publishes. Runtime dependencies must already be installed.');
  } else {
    const action = positionals[0];
    if (positionals.length !== 1 || !['doctor', 'status', 'refresh'].includes(action)) throw Error('Choose doctor, status or refresh.');
    const home = values.home ?? process.env.FOLIAGE_HOME;
    if (!home || !isAbsolute(home)) throw Error('Set --home or FOLIAGE_HOME to an absolute Foliage checkout path. The skill installation does not install the runtime.');
    if (!values.garden || !isAbsolute(values.garden)) throw Error('Choose an explicit absolute --garden; no ambient portfolio is selected.');
    if (values.repo && !isAbsolute(values.repo)) throw Error('--repo must be absolute.');
    if (action !== 'refresh' && (values.repo || values.subject || values.identity)) throw Error('Source options are only valid for refresh.');
    await access(join(home, 'foliage.mjs'));
    await access(join(home, 'apps/leaf/intake.mjs'));
    const args = action === 'doctor' ? [join(home, 'tools/install/preflight.mjs')]
      : [join(home, 'foliage.mjs'), action === 'refresh' ? 'grow' : 'status', '--garden', resolve(values.garden)];
    if (action === 'refresh') {
      args.push(...(values.repo ? ['--repo', values.repo] : ['--watched']));
      if (values.subject) args.push('--subject', values.subject);
      for (const identity of values.identity ?? []) args.push('--identity', identity);
    }
    console.error('Photosynthesis executes on this host. Agent conversation/model routing follows your host settings. No publication is performed.');
    const result = spawnSync(process.execPath, args, { cwd: home, stdio: 'inherit', timeout: 120_000, killSignal: 'SIGTERM' });
    if (result.error) throw Error(`Runtime did not complete: ${result.error.message}. Inspect garden status before retrying.`);
    if (result.signal) throw Error(`Runtime stopped by ${result.signal}; inspect garden status before retrying.`);
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(`photosynthesis: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
