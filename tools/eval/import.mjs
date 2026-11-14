/** Reuses the existing local queue, locks and subject binding; never executes a receipt. */
import { createPublicKey } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { requireNodeFloor } from '../../apps/leaf/src/nodeFloor.mjs';
import { receiptObservation } from './observation.mjs';

export async function importReceipt(args) {
  requireNodeFloor();
  const { boundedIntegrationFile, integrationJson, readIntegrationTarget, persistIntegrationObservations } = await import('../../apps/leaf/src/integrationStore.ts');
  const { parseObservationBatch, OBSERVATION_INPUT_BYTES } = await import('../../apps/leaf/src/integrationImport.ts');
  const { values, tokens } = parseArgs({ args, strict: true, tokens: true, options: {
    input: { type: 'string' }, into: { type: 'string' }, out: { type: 'string' },
    'public-key': { type: 'string' }, 'key-id': { type: 'string' },
    'include-demo': { type: 'boolean', default: false },
  } });
  if (new Set(tokens.map(token => token.name)).size !== tokens.length) throw Error('duplicate-import-option');
  if (!values.input?.trim() || !values.into?.trim() || (values.out !== undefined && !values.out.trim())) throw Error('explicit-receipt-and-leaf-required');
  const input = resolve(values.input), into = resolve(values.into), out = values.out === undefined ? null : resolve(values.out);
  if (input === into || out === into || out === input || (values['public-key'] && out === resolve(values['public-key']))) throw Error('distinct-import-files-required');
  let signing = null;
  if (values['public-key'] !== undefined || values['key-id'] !== undefined) {
    if (!values['public-key']?.trim() || !values['key-id']?.trim()) throw Error('public-key-and-key-id-required');
    signing = { key: createPublicKey(await boundedIntegrationFile(resolve(values['public-key']), 16384)), keyId: values['key-id'] };
  }
  const receipt = integrationJson(await boundedIntegrationFile(input, OBSERVATION_INPUT_BYTES), 'Selected receipt');
  const batch = receiptObservation(receipt, await readIntegrationTarget(into), signing);
  parseObservationBatch(batch);
  if (values['include-demo']) {
    if (out === null) throw Error('demo-review-destination-required');
    if (signing !== null) throw Error('signed-demo-import-not-supported');
    if (receipt.evidence.browser?.status !== 'completed' || !receipt.evidence.browser.capture) throw Error('bound-demo-unavailable');
    const { queueCapturedDemo } = await import('../../apps/leaf/src/captureReview.ts');
    const queued = await queueCapturedDemo({ captureRoot: `${input}.artifacts`, captureId: receipt.evidence.browser.capture.id,
      evaluationReceiptPath: input, leafPath: into, harvestPath: out, title: 'Tested project demo',
      expectedSubject: { id: batch.subject.leafId, subject: batch.subject.name } });
    return { status: 'local-evaluation-demo-imported', ...queued, approved: false, published: false };
  }
  return out === null ? { status: 'local-evaluation-preview', batch, next: 'Select --out <harvest.json> to queue this projection for human review.' }
    : persistIntegrationObservations(batch, into, out);
}
