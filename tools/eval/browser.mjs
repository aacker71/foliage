/** Observe only the current offline job. Never accept a caller-supplied running-app URL. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { openLocalCaptureSession } from '../capture/capture.mjs';
import { canonical, digest } from './contract.mjs';

// Docker's network remains `none`. This fixed byte relay reaches exactly one port in
// the job's own loopback namespace; no published port, host network or socket mount.
const RELAY = `const net=require('node:net');const s=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});
s.on('error',()=>process.exit(1));process.stdin.on('error',()=>s.destroy());process.stdout.on('error',()=>s.destroy());
process.stdin.pipe(s);s.pipe(process.stdout);s.on('close',()=>process.exit());setTimeout(()=>process.exit(1),30000);`;
const READY = `const http=require('node:http');const port=Number(process.argv[1]),path=process.argv[2],end=Date.now()+Number(process.argv[3]);
function retry(){if(Date.now()>=end)process.exit(1);setTimeout(check,100)}
function check(){const r=http.get({host:'127.0.0.1',port,path,timeout:500},s=>{s.resume();if(s.statusCode>=200&&s.statusCode<400)process.exit(0);else retry()});r.on('error',retry);r.on('timeout',()=>r.destroy())}check();`;

async function openJobRelay({ docker, endpoint, name, port, signal }) {
  if (signal?.aborted) throw Error('cancelled');
  const connections = new Set();
  let closed = false, cleanupFailure = false;
  const server = createServer(socket => {
    socket.on('error', () => {});
    if (closed || connections.size >= 16) { socket.destroy(); return; }
    const child = spawn(docker, ['--host', endpoint, 'exec', '-i', name,
      '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', 'node', '-e', RELAY, String(port)], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let bytes = 0;
    const entry = { socket, child, done: null, timer: null };
    const stop = () => { socket.destroy(); child.kill('SIGKILL'); };
    entry.done = new Promise(resolve => child.once('close', () => {
      clearTimeout(entry.timer); socket.destroy(); connections.delete(entry); resolve();
    }));
    entry.timer = setTimeout(stop, 30_000);
    connections.add(entry);
    const bound = chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) stop(); };
    child.on('error', stop);
    child.stdin.on('error', stop);
    child.stdout.on('error', stop);
    socket.on('data', bound); child.stdout.on('data', bound);
    socket.once('close', () => child.kill('SIGKILL'));
    socket.pipe(child.stdin); child.stdout.pipe(socket);
  });
  let closing;
  const close = () => closing ??= (async () => {
    closed = true;
    signal?.removeEventListener('abort', abort);
    const pending = [...connections];
    for (const entry of pending) { entry.socket.destroy(); entry.child.kill('SIGKILL'); }
    let timer;
    try {
      await Promise.race([Promise.all(pending.map(entry => entry.done)), new Promise(resolve => {
        timer = setTimeout(() => { cleanupFailure = true; resolve(); }, 2_000);
      })]);
      if (server.listening) await new Promise(resolve => server.close(resolve));
    } finally { clearTimeout(timer); }
    return cleanupFailure ? 'unconfirmed' : 'removed';
  })();
  const abort = () => { void close(); };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) throw Error('cancelled');
    return { origin: `http://127.0.0.1:${server.address().port}`, close };
  } catch (error) { await close(); throw error; }
}

/** Host-observed pixels/diagnostics, still a local owner's report, not third-party attestation. */
export async function observeJobBrowser({ docker, endpoint, name, selected, artifacts, invoke, signal }) {
  const result = { version: 1, status: 'error', reason: null, capture: null, measurements: null,
    cleanup: { browser: 'not-created', relay: 'not-created' } };
  let relay, session, onAbort, abortCleanup;
  const requireActive = () => { if (signal?.aborted) throw Error('cancelled'); };
  try {
    requireActive();
    const launch = await invoke(['exec', '--detach', '--workdir=/work', name,
      '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', ...selected.argv], { signal });
    if (launch.reason || launch.code !== 0) throw Error(launch.reason === 'cancelled' ? 'cancelled' : 'browser-app-start-failed');
    const ready = await invoke(['exec', name, '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp',
      'node', '-e', READY, String(selected.port), selected.path, String(selected.readyTimeoutMs)],
    { timeoutMs: selected.readyTimeoutMs + 1_000, signal });
    if (ready.reason || ready.code !== 0) throw Error(ready.reason === 'cancelled' ? 'cancelled' : 'browser-app-not-ready');
    relay = await openJobRelay({ docker, endpoint, name, port: selected.port, signal });
    result.cleanup.relay = 'unconfirmed';
    requireActive();
    const opened = await openLocalCaptureSession({ url: `${relay.origin}${selected.path}`, outputDir: artifacts });
    if (!opened.ok) {
      result.cleanup.browser = opened.cleanup ?? 'not-created';
      throw Error(opened.cause);
    }
    session = opened.session;
    result.cleanup.browser = 'unconfirmed';
    onAbort = () => { abortCleanup = session.close(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    requireActive();
    const checks = await session.check();
    if (!checks.ok) throw Error(checks.cause);
    result.measurements = Object.fromEntries(['horizontalOverflowPx', 'unnamedControlCount', 'brokenImageCount',
      'consoleErrors', 'pageExceptions', 'failedRequests'].map(key => [key, checks[key]]));
    const captured = await session.record({ durationSeconds: selected.durationSeconds });
    if (!captured.ok) throw Error(captured.cause);
    requireActive();
    // Digest the exact saved capture receipt, including diagnostics and observation clock.
    const receipt = JSON.parse(await readFile(captured.receiptPath, 'utf8'));
    result.capture = { id: receipt.id, receiptDigest: digest(canonical(receipt)),
      screenshotDigest: receipt.artifacts.screenshot.sha256, videoDigest: receipt.artifacts.video.sha256 };
    result.status = 'completed';
  } catch (error) {
    result.status = signal?.aborted ? 'cancelled' : 'error';
    result.reason = signal?.aborted ? 'cancelled' : /^[a-z]+(?:-[a-z]+)*$/.test(error.message) ? error.message : 'browser-observation-failed';
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (session) {
      try { result.cleanup.browser = (await (abortCleanup ?? session.close())).ok ? 'removed' : 'unconfirmed'; }
      catch { result.cleanup.browser = 'unconfirmed'; }
    }
    if (relay) {
      try { result.cleanup.relay = await relay.close(); }
      catch { result.cleanup.relay = 'unconfirmed'; }
    }
    if (Object.values(result.cleanup).includes('unconfirmed')) {
      result.status = 'error'; result.reason ??= 'browser-cleanup-unconfirmed';
    }
  }
  return result;
}
