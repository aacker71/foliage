/** Failure probes for the observer protocol, not claimed work or customer test results. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeJobBrowser } from './browser.mjs';

const selected = { argv: ['node', 'server.mjs'], port: 4321, path: '/', readyTimeoutMs: 100, durationSeconds: 2 };
test('failed launch, readiness and cancellation do not fall back to any host application', async () => {
  for (const failure of ['launch', 'readiness', 'cancelled']) {
    const calls = [];
    const controller = new AbortController();
    if (failure === 'cancelled') controller.abort();
    const result = await observeJobBrowser({ selected, docker: '/not-used', endpoint: 'unix:///not-used',
      name: 'protocol-probe', artifacts: '/not-created', signal: controller.signal,
      invoke: async args => {
        calls.push(args);
        return { code: failure === 'launch' || calls.length === 2 ? 1 : 0, reason: null };
      } });
    assert.equal(result.capture, null);
    assert.equal(result.status, failure === 'cancelled' ? 'cancelled' : 'error');
    assert.equal(result.reason, failure === 'launch' ? 'browser-app-start-failed' :
      failure === 'readiness' ? 'browser-app-not-ready' : 'cancelled');
    assert.deepEqual(result.cleanup, { browser: 'not-created', relay: 'not-created' });
    assert.equal(calls.length, failure === 'cancelled' ? 0 : failure === 'launch' ? 1 : 2);
  }
});
