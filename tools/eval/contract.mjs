/** Portable job/result primitives. Signatures authenticate bytes, never capability or truth. */
import { createHash, sign, verify } from 'node:crypto';

export const STAGES = ['prepare', 'execute', 'observe', 'evaluate'];
export const MAX_SOURCE_ARCHIVE_BYTES = 128 * 1024 * 1024;
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const signingBytes = (payload, keyId) => Buffer.from(canonical({ algorithm: 'Ed25519', keyId, payload }));
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

export function parseScenario(value) {
  if (!keys(value, ['version', 'id', 'steps', 'browser']) || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) ||
      !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 16) throw Error('invalid-scenario');
  let previous = -1;
  let total = 0;
  for (const step of value.steps) {
    const stage = STAGES.indexOf(step?.stage);
    if (!keys(step, ['stage', 'argv', 'timeoutMs']) || stage < previous || stage < 0 ||
        !Array.isArray(step.argv) || step.argv.length < 1 || step.argv.length > 64 ||
        step.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0')) || !step.argv[0] ||
        !Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 600_000) throw Error('invalid-scenario');
    previous = stage; total += step.timeoutMs;
  }
  if (total > 1_800_000 || !value.steps.some(step => step.stage === 'execute')) throw Error('invalid-scenario');
  if (value.browser !== undefined) {
    const b = value.browser;
    if (!keys(b, ['argv', 'port', 'path', 'readyTimeoutMs', 'durationSeconds']) ||
        !Array.isArray(b.argv) || b.argv.length < 1 || b.argv.length > 64 || !b.argv[0] ||
        b.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0')) ||
        !Number.isInteger(b.port) || b.port < 1024 || b.port > 65535 ||
        typeof b.path !== 'string' || !b.path.startsWith('/') || b.path.startsWith('//') || b.path.length > 1024 ||
        /[\\\u0000-\u0020\u007f]/.test(b.path) || b.path.includes('#') ||
        !Number.isInteger(b.readyTimeoutMs) || b.readyTimeoutMs < 100 || b.readyTimeoutMs > 15_000 ||
        !Number.isInteger(b.durationSeconds) || b.durationSeconds < 2 || b.durationSeconds > 15) throw Error('invalid-browser-scenario');
  }
  return structuredClone(value);
}

export function sealEvidence(evidence, signing = null) {
  if (signing !== null && (signing.key?.asymmetricKeyType !== 'ed25519' || !/^[a-zA-Z0-9_-]{1,64}$/.test(signing.keyId ?? ''))) throw Error('invalid-signing-configuration');
  const payload = { format: 'foliage-evaluation', version: 1, evidence };
  const bytes = Buffer.from(canonical(payload));
  return { ...payload, digest: digest(bytes), signature: signing === null ? null : {
    algorithm: 'Ed25519', keyId: signing.keyId, value: sign(null, signingBytes(payload, signing.keyId), signing.key).toString('base64'),
  } };
}

/** Caller supplies an independently trusted public key; never trust a key in a submitted result. */
export function verifyEvidence(envelope, publicKey, expectedKeyId) {
  try {
    if (!keys(envelope, ['format', 'version', 'evidence', 'digest', 'signature']) || envelope.format !== 'foliage-evaluation' || envelope.version !== 1 ||
        !keys(envelope.signature, ['algorithm', 'keyId', 'value']) || publicKey?.asymmetricKeyType !== 'ed25519' ||
        envelope.signature?.algorithm !== 'Ed25519' || envelope.signature.keyId !== expectedKeyId) return false;
    const payload = { format: envelope.format, version: envelope.version, evidence: envelope.evidence };
    return envelope.digest === digest(canonical(payload)) && verify(null, signingBytes(payload, expectedKeyId), publicKey, Buffer.from(envelope.signature.value, 'base64'));
  } catch { return false; }
}
