#!/usr/bin/env node
import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runLocal } from './local.mjs';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log('foliage-eval run --repo <local-path> --commit <full-sha> --scenario <scenario.json> --image <sha256:image-id> --output <results.json> --trusted-local-code [--docker <binary>] [--signing-key <ed25519.pem> --key-id <id>]\nfoliage-eval import --input <results.json> --into <existing leaf.json> [--out <harvest.json>] [--include-demo] [--public-key <ed25519-public.pem> --key-id <id>]\nLocal owner-controlled code only. No upload, workload network access or publication. An optional browser scenario uses a guarded local observer. Run creates a new result file and adjacent private .artifacts directory. Import previews a limited observation; explicit --out queues it for private human review. --include-demo checks and queues the exact bound PNG/MP4 with an unsigned local report. Signed report imports require a separately selected public key.');
} else if (args[0] === 'import') {
  try {
    const { importReceipt } = await import('./import.mjs');
    console.log(JSON.stringify(await importReceipt(args.slice(1))));
  } catch {
    console.error('foliage-eval: receipt-import-refused; check explicit paths, supported local receipt, selected signature key and existing review identity. No approval or publication occurred.');
    process.exitCode = 2;
  }
} else {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    if (args.shift() !== 'run') throw Error('unknown-command');
    const options = {};
    while (args.length) {
      const flag = args.shift();
      if (flag === '--trusted-local-code' && !options.trustedLocalCode) { options.trustedLocalCode = true; continue; }
      const key = { '--repo': 'repo', '--commit': 'commit', '--scenario': 'scenario', '--image': 'image', '--output': 'output', '--docker': 'docker', '--signing-key': 'signingKey', '--key-id': 'keyId' }[flag];
      if (!key || options[key] !== undefined || !args[0] || args[0].startsWith('--')) throw Error('invalid-arguments');
      options[key] = args.shift();
    }
    if (!options.repo || !options.commit || !options.scenario || !options.image || !options.output) throw Error('missing-arguments');
    options.scenario = JSON.parse(await readFile(options.scenario, 'utf8'));
    if (options.signingKey || options.keyId) {
      if (!options.signingKey || !/^[a-zA-Z0-9_-]{1,64}$/.test(options.keyId ?? '')) throw Error('invalid-signing-configuration');
      const key = createPrivateKey(await readFile(options.signingKey));
      if (key.asymmetricKeyType !== 'ed25519') throw Error('ed25519-key-required');
      options.signing = { key, keyId: options.keyId };
    }
    const result = await runLocal({ ...options, signal: controller.signal });
    console.log(JSON.stringify({ jobId: result.evidence.jobId, attemptId: result.evidence.attemptId,
      status: result.evidence.status, reason: result.evidence.reason, cleanup: result.evidence.cleanup, digest: result.digest }));
    process.exitCode = result.evidence.status === 'completed' ? 0 : result.evidence.status === 'cancelled' ? 130 : 1;
  } catch (error) {
    console.error(`foliage-eval: ${/^[a-z]+(?:-[a-z]+)*$/.test(error.message) ? error.message : 'could-not-prepare-or-write-evaluation'}; no successful evaluation asserted.`);
    process.exitCode = 2;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
