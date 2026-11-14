/** Detached owner of ONE child. Control socket access is limited to this OS user. */
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream, chmodSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import type { ManagedState } from "./managed.ts";

const [socket, label, rawCommand, rawPort] = process.argv.slice(2);
if (!socket || !label || !rawCommand || !rawPort) throw new Error("Missing supervisor arguments");
const port = Number(rawPort);
const command = JSON.parse(rawCommand) as string[];
let state: ManagedState = { state: "starting", port };
let child: ReturnType<typeof spawn> | undefined;
let stopping = false;
let stopReply: import("node:net").Socket | undefined;
const logPath = `${socket}.log`;
const logFd = openSync(logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
const logStat = fstatSync(logFd);
if (!logStat.isFile() || logStat.nlink !== 1 || (logStat.mode & 0o077) !== 0 || logStat.uid !== process.getuid?.()) {
  closeSync(logFd);
  throw new Error(`Unsafe log file: ${logPath}`);
}
const log = createWriteStream(logPath, { fd: logFd, autoClose: true });
log.on("error", error => { state = { state: "failed", port, detail: error.message }; stop(); });

function stop(): void {
  if (stopping) return;
  stopping = true;
  // ChildProcess tracks whether this exact child exited, unlike a PID recovered from disk.
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child?.kill("SIGKILL"), 2000);
    child.once("exit", () => { clearTimeout(timer); finish(); });
  } else finish();
}
function finish(): void {
  control.close(() => log.end(() => process.exit(0)));
  // Stop accepting requests before acknowledging shutdown; the child has exited by now.
  stopReply?.end(JSON.stringify(state));
}
const control = createServer({ allowHalfOpen: true }, connection => {
  let text = "";
  connection.setTimeout(2000, () => connection.destroy());
  connection.on("error", () => connection.destroy());
  connection.on("data", chunk => { text += String(chunk); if (text.length > 32) connection.destroy(); });
  connection.on("end", () => {
    if (text !== "status\n" && text !== "stop\n") { connection.destroy(); return; }
    if (text === "stop\n" && !stopping) {
      // A valid stop can need the full escalation interval; the input-idle deadline
      // must not destroy its response socket at that same two-second boundary.
      connection.setTimeout(5000);
      stopReply = connection;
      stop();
    }
    else connection.end(JSON.stringify(state));
  });
});
control.once("error", error => { process.send?.(error.message); log.end(() => process.exit(1)); });
control.listen(socket, () => {
  chmodSync(socket, 0o600);
  process.send?.("bound");
  child = spawn(process.execPath, command, { stdio: ["ignore", "pipe", "pipe"] });
  let pending = "";
  const timer = setTimeout(() => {
    state = { state: "failed", port, detail: `No listen acknowledgement; see ${logPath}` };
    child?.kill("SIGTERM");
    const killTimer = setTimeout(() => child?.kill("SIGKILL"), 2000);
    child?.once("exit", () => clearTimeout(killTimer));
  }, 10_000);
  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk);
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (pending.length > 16384) pending = "";
    // Every boot command emits this prefix only inside its successful listen callback; the label
    // is the row's declared one (ManagedSurface.label), not assumed from the row's name.
    if (state.state === "starting" && lines.some(line => line.startsWith(`[${label}] http://127.0.0.1:${port}/`))) {
      clearTimeout(timer);
      state = { state: "ready", port, ...(child?.pid === undefined ? {} : { pid: child.pid }) };
    }
  });
  child.stderr?.on("data", chunk => log.write(chunk));
  child.once("error", error => { clearTimeout(timer); state = { state: "failed", port, detail: error.message }; });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    state = { state: "failed", port, detail: `App exited ${code ?? signal}; see ${logPath}` };
  });
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
