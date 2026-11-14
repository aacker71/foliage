#!/usr/bin/env node
/** Operator/agent entry, reusing the signed-in companion and existing private review writer. */
import { parseArgs } from 'node:util';
import { createLocalHostedBridge } from './src/localHostedBridge.ts';
try {
  const { values, tokens } = parseArgs({ strict: true, tokens: true, options: { connection: { type: 'string' }, help: { type: 'boolean' } } });
  const options = tokens.filter(token => token.kind === "option");
  if (new Set(options.map(token => token.name)).size !== options.length) throw Error('duplicate-option');
  if (values.help) {
    console.log('Import an authorized Nango connection into existing private review.\nnode apps/canopy/import-source.mjs --connection <connection-id>\nRequires FOLIAGE_HOSTED_ORIGIN, FOLIAGE_HOSTED_STATE, FOLIAGE_LEAF, FOLIAGE_POLICY and FOLIAGE_HARVEST. Reuses the companion account; no Nango credential belongs on this device. No approval or publication.');
  } else {
    if (!values.connection || !process.env["FOLIAGE_HOSTED_ORIGIN"] || !process.env["FOLIAGE_HOSTED_STATE"]) throw Error('configuration-required');
    const bridge = createLocalHostedBridge({ origin: process.env["FOLIAGE_HOSTED_ORIGIN"], statePath: process.env["FOLIAGE_HOSTED_STATE"], env: process.env });
    console.log(JSON.stringify(await bridge.importSource(values.connection)));
  }
} catch {
  console.error('Source import was not confirmed. Check connection, selected paths and source status; retrying the same revision preserves existing review. No publication was requested.');
  process.exitCode = 1;
}
