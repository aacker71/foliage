/** Worktree-local process control. Never signal a PID recovered from disk. */
import { createHash } from "node:crypto";
import { mkdirSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createConnection, createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ManagedSurface {
  port: number;
  cmd: string[];
  path: string;
  env: (options: Record<string, string>, env?: NodeJS.ProcessEnv) => Record<string, string>;
  /**
   * The `[label]` the boot command prints before its own URL from inside its listen callback;
   * ready means exactly `[label] http://127.0.0.1:<port>/`. Defaults to the surface name. A row
   * whose command announces itself under another name (the static server, or the leaf app
   * serving a second row) must say so here, or it can never become ready.
   */
  readonly label?: string;
}
export interface ManagedState {
  state: "starting" | "ready" | "failed";
  port: number;
  pid?: number;
  detail?: string;
}

export function controlDirectory(root: string): string {
  const key = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 24);
  return join("/tmp", `fol-serve-${process.getuid?.() ?? "user"}-${key}`);
}
export function controlPath(root: string, name: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error("Invalid surface name");
  return join(controlDirectory(root), `${name}.sock`);
}
function prepareDirectory(root: string): void {
  const dir = controlDirectory(root);
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error(`Unsafe serve directory: ${dir}`);
  }
}
export function request(socket: string, command: "status" | "stop"): Promise<ManagedState | null> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let text = "";
    connection.setTimeout(command === "stop" ? 5000 : 2000, () => connection.destroy(new Error(`Control timeout: ${socket}`)));
    connection.on("connect", () => connection.end(`${command}\n`));
    connection.on("data", chunk => {
      text += String(chunk);
      if (text.length > 4096) connection.destroy(new Error("Oversized control response"));
    });
    connection.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve(null);
      else reject(error); // Stale sockets are refused, never stolen.
    });
    connection.on("end", () => {
      try {
        const value = JSON.parse(text) as ManagedState;
        if (!["starting", "ready", "failed"].includes(value.state) || !Number.isInteger(value.port)) throw new Error("Malformed control response");
        resolve(value);
      } catch (error) { reject(error); }
    });
  });
}
export async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}
/** `started` is true only when this call spawned the supervisor; adopting one is not starting it. */
export async function start(root: string, name: string, surface: ManagedSurface, options: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): Promise<ManagedState & { readonly started: boolean }> {
  prepareDirectory(root);
  const socket = controlPath(root, name);
  const existing = await request(socket, "status");
  // A failed supervisor owns no live app: its child exited or was killed. Reporting its state
  // again would hand this run an earlier run's failure, so it is stopped and a fresh one booted.
  if (existing?.state === "failed") await retire(socket);
  else if (existing) {
    if (existing.port !== surface.port) throw new Error(`${name} already uses port ${existing.port}; stop it before changing offsets`);
    return { ...(existing.state === "starting" ? await waitReady(socket) : existing), started: false };
  }
  if (!await portFree(surface.port)) throw new Error(`Port ${surface.port} is occupied; no server adopted or stopped. Choose --port-offset.`);
  // Exclusive socket bind happens before spawning the app, serializing concurrent starts.
  const worker = spawn(process.execPath, [fileURLToPath(new URL("./serve-worker.ts", import.meta.url)), socket, surface.label ?? name, JSON.stringify(surface.cmd), String(surface.port)], {
    cwd: root, env: { ...env, ...surface.env(options, env), PORT: String(surface.port), HOST: "127.0.0.1" },
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { worker.kill(); reject(new Error("Supervisor startup timed out")); }, 5000);
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.once("exit", code => { clearTimeout(timer); reject(new Error(`Supervisor exited ${code}; inspect control socket ${socket}`)); });
    worker.once("message", message => {
      clearTimeout(timer);
      worker.disconnect();
      worker.unref();
      if (message !== "bound") reject(new Error(`Supervisor refused startup: ${String(message)}`));
      else resolve();
    });
  });
  return { ...await waitReady(socket), started: true };
}
/** Stop this worktree's own failed supervisor (over its control socket, never by PID). */
async function retire(socket: string): Promise<void> {
  await request(socket, "stop");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await request(socket, "status") === null) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`A failed supervisor did not stop; stop it with serve down (${socket})`);
}
async function waitReady(socket: string): Promise<ManagedState> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await request(socket, "status");
    if (!status) throw new Error(`Supervisor disappeared: ${socket}`);
    if (status.state !== "starting") return status;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Startup timed out; inspect with serve status and stop with serve down (${socket})`);
}
