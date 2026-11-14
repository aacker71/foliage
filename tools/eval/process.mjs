import { spawn } from 'node:child_process';

/** Bounded, argv-only execution. Raw subprocess diagnostics remain private output. */
export function command(binary, args, { timeoutMs = 15_000, maxBytes = 131_072, signal, cwd } = {}) {
  return new Promise(resolve => {
    const started = performance.now();
    if (signal?.aborted) {
      resolve({ code: null, signal: null, reason: 'cancelled', durationMs: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: false });
      return;
    }
    // Git/helpers may leave descendants holding the pipes after their parent exits. Kill
    // the whole owned process group on supported POSIX hosts so a deadline stays bounded.
    const grouped = process.platform !== 'win32';
    const child = spawn(binary, args, { cwd, detached: grouped, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = { stdout: [], stderr: [] };
    let size = 0, reason = null, settled = false;
    const stop = code => {
      reason ??= code;
      if (grouped && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const finish = (code, terminationSignal) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve({ code, signal: terminationSignal ?? null, reason, durationMs: Math.round(performance.now() - started),
        stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr), truncated: reason === 'output-limit' });
    };
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      const available = Math.max(0, maxBytes - size);
      if (available) chunks[name].push(chunk.subarray(0, available));
      size += chunk.length;
      if (size > maxBytes) stop('output-limit');
    });
    child.on('error', () => { reason ??= 'spawn-error'; });
    child.on('close', finish);
  });
}
