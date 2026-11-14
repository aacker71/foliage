#!/usr/bin/env node
/** Owner-run private search session. Remote binding requires explicit TLS. Nothing starts with the app. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();

const usage = "Usage: foliage private-brain list|receipts|serve --garden <path> [--agent-key <Ed25519 public PEM> --agent-label <name> --record <exact id> ... --minutes 1–60 --port 0–65535 --bind <IPv4 address> --tls-cert <PEM> --tls-key <PEM>]\n";
const args = process.argv.slice(2);
const REQUEST_DEADLINE_MS = 10_000;
const HEADER_DEADLINE_MS = 5_000;
const MAX_CONNECTIONS = 8;
/** Read one regular file through one no-follow descriptor so validation and bytes cannot
 * refer to different files. NONBLOCK also keeps a named pipe from hanging startup.
 * @param {string} path @param {number} maxSize @param {boolean} secret @param {string} errorMessage */
async function pemMaterial(path, maxSize, secret, errorMessage) {
  let handle;
  try {
    handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > maxSize || (secret && (info.mode & 0o077) !== 0))
      throw new Error("invalid PEM file");
    return await handle.readFile();
  } catch {
    throw new Error(errorMessage);
  } finally { await handle?.close(); }
}
/** @param {string} path @param {import('./src/privateBrainSession.ts').PrivateBrainReceipt} value */
async function receiptWriter(path, value) {
  const line = `${JSON.stringify(value)}\n`;
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size + Buffer.byteLength(line) > 1024 * 1024)
      throw new Error("The private transfer receipt file is unavailable or full.");
    await handle.writeFile(line);
    await handle.sync();
  } finally { await handle.close(); }
}

try {
  const parsed = parseArgs({ args, options: { into: { type: "string" }, out: { type: "string" },
    "agent-key": { type: "string" }, "agent-label": { type: "string" },
    record: { type: "string", multiple: true }, minutes: { type: "string" },
    port: { type: "string" }, bind: { type: "string" },
    "tls-cert": { type: "string" }, "tls-key": { type: "string" },
    help: { type: "boolean", short: "h" },
  }, strict: true, allowPositionals: true, tokens: true });
  if (parsed.values.help) { process.stdout.write(usage); process.exit(0); }
  const action = parsed.positionals[0];
  if (parsed.positionals.length !== 1 || (action !== "list" && action !== "receipts" && action !== "serve")) throw new Error("Choose list, receipts or serve.");
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name) && token.name !== "record") throw new Error(`Duplicate --${token.name} is refused.`);
    seen.add(token.name);
  }
  const into = parsed.values.into?.trim(), out = parsed.values.out?.trim();
  if (!into || !out) throw new Error("Explicit Leaf and harvest paths are required.");
  if (resolve(into) === resolve(out)) throw new Error("The Leaf and harvest must be different files.");
  if (action === "receipts") {
    if (parsed.values["agent-key"] !== undefined || parsed.values["agent-label"] !== undefined ||
        parsed.values.record !== undefined || parsed.values.minutes !== undefined || parsed.values.port !== undefined ||
        parsed.values.bind !== undefined || parsed.values["tls-cert"] !== undefined || parsed.values["tls-key"] !== undefined)
      throw new Error("Receipts does not start a session or accept a grant.");
    const receiptPath = resolve(dirname(into), "private-brain-receipts.jsonl");
    let handle;
    try { handle = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        process.stdout.write("No private search transfers recorded.\n");
      } else {
        throw error;
      }
    }
    if (handle) {
      try {
        const info = await handle.stat();
        if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 1024 * 1024)
          throw new Error("The private transfer receipt file is unavailable or full.");
        process.stdout.write(await handle.readFile("utf8"));
      } finally { await handle.close(); }
    }
  } else {
    const { readIntegrationTarget } = await import("./src/integrationStore.ts");
    const { readLocalSearchRecords } = await import("./src/localSearch.ts");
    const leaf = await readIntegrationTarget(resolve(into));
    const expected = { leafId: leaf.id, name: leaf.subject };
    const read = () => readLocalSearchRecords(resolve(into), resolve(out), expected);
    if (action === "list") {
      if (parsed.values["agent-key"] !== undefined || parsed.values["agent-label"] !== undefined ||
          parsed.values.record !== undefined || parsed.values.minutes !== undefined || parsed.values.port !== undefined ||
          parsed.values.bind !== undefined || parsed.values["tls-cert"] !== undefined || parsed.values["tls-key"] !== undefined)
        throw new Error("List does not start a session or accept a grant.");
      const snapshot = await read();
      process.stdout.write(`${JSON.stringify({ leafId: expected.leafId, records: snapshot.records.map(({ id, kind, title, citation }) => ({ id, kind, title, citation })) }, null, 2)}\n`);
    } else {
      const keyPath = parsed.values["agent-key"]?.trim();
      if (!keyPath || !parsed.values["agent-label"]?.trim() || !parsed.values.record?.length) throw new Error("Serving requires an agent public key, label and exact record IDs.");
      const publicKeyPem = (await pemMaterial(keyPath, 4096, false,
        "The agent public key must be a small regular file.")).toString("utf8");
      const minutes = parsed.values.minutes === undefined ? 15 : Number(parsed.values.minutes);
      const port = parsed.values.port === undefined ? 0 : Number(parsed.values.port);
      if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 || !Number.isSafeInteger(port) || port < 0 || port > 65535)
        throw new Error("Minutes must be 1–60 and port must be 0–65535.");
      const bind = parsed.values.bind ?? "127.0.0.1";
      if (isIP(bind) !== 4 || bind === "0.0.0.0" || bind === "255.255.255.255")
        throw new Error("Bind to one explicit IPv4 address, not a hostname or wildcard.");
      const certPath = parsed.values["tls-cert"], tlsKeyPath = parsed.values["tls-key"];
      if ((certPath === undefined) !== (tlsKeyPath === undefined) ||
          (certPath !== undefined && (!certPath.trim() || !tlsKeyPath?.trim())))
        throw new Error("Provide both --tls-cert and --tls-key.");
      if (bind !== "127.0.0.1" && (!certPath || !tlsKeyPath))
        throw new Error("A non-loopback bind requires an explicit TLS certificate and private key.");
      const tls = certPath && tlsKeyPath ? {
        cert: await pemMaterial(certPath, 64 * 1024, false, "The TLS certificate must be a regular PEM file."),
        key: await pemMaterial(tlsKeyPath, 64 * 1024, true, "The TLS private key must be a private regular PEM file."),
        minVersion: /** @type {import('node:tls').SecureVersion} */ ("TLSv1.2"),
      } : null;
      const { createPrivateBrainSession } = await import("./src/privateBrainSession.ts");
      const receiptPath = resolve(dirname(into), "private-brain-receipts.jsonl");
      let receipts = Promise.resolve();
      // One terminal line per refused request, so a wrong key or a replay is not silence. It
      // carries time, status, reason and the agent key fingerprint once a signature verified;
      // never query text or key material. The receipt file stays transfers only. While the
      // terminal is not keeping up, refusals are counted instead of queued without bound.
      let unshownRefusals = 0;
      /** @param {{ at: string, status: number, reason: string, agent?: string }} refusal */
      const reportRefusal = refusal => {
        if (process.stderr.writableLength > 64 * 1024) { unshownRefusals += 1; return; }
        const unshown = unshownRefusals ? ` (+${unshownRefusals} earlier not shown)` : "";
        unshownRefusals = 0;
        process.stderr.write(`Refused ${refusal.at} ${refusal.status} ${refusal.reason}; agent key ${refusal.agent ?? "not verified"}${unshown}\n`);
      };
      /** @param {number} status @param {string} reason */
      const refuseHere = (status, reason) => reportRefusal({ at: new Date().toISOString(), status, reason });
      const session = await createPrivateBrainSession({ publicKeyPem, agentLabel: parsed.values["agent-label"],
        recordIds: parsed.values.record, read, ttlMs: minutes * 60_000, refused: reportRefusal,
        receipt: value => {
          const next = receipts.then(() => receiptWriter(receiptPath, value));
          receipts = next.catch(() => {});
          return next;
        },
      });
      /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
      const handleRequest = (req, res) => { void (async () => {
        // The deadline is wall time, not an inactivity timeout: a client that sends one
        // byte at a time must not retain a connection for the whole session.
        res.shouldKeepAlive = false;
        const deadline = setTimeout(() => req.destroy(), REQUEST_DEADLINE_MS);
        req.once("end", () => clearTimeout(deadline));
        req.once("close", () => clearTimeout(deadline));
        let answered = false;
        try {
          const names = new Set();
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const name = req.rawHeaders[i]?.toLowerCase();
            if (!name || !["host", "origin", "content-type", "content-length", "x-foliage-session", "x-foliage-timestamp", "x-foliage-nonce", "x-foliage-signature"].includes(name)) continue;
            if (names.has(name)) { refuseHere(400, "invalid-request"); res.writeHead(400, { "cache-control": "no-store" }); res.end(); return; }
            names.add(name);
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          const method = req.method ?? "GET";
          if (!req.url?.startsWith("/") || req.url.startsWith("//")) { refuseHere(400, "invalid-request"); res.writeHead(400, { "cache-control": "no-store" }); res.end(); return; }
          const bound = server.address();
          if (!bound || typeof bound === "string") throw new Error("Private listener unavailable.");
          const origin = `${tls ? "https" : "http"}://${bind}:${bound.port}`;
          const request = new Request(new URL(req.url, origin), {
            method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: Readable.toWeb(req), duplex: "half" }),
          });
          const answer = await session.handle(request);
          answered = true;
          res.writeHead(answer.status, Object.fromEntries(answer.headers));
          res.end(Buffer.from(await answer.arrayBuffer()));
        } catch {
          if (!answered) refuseHere(503, "request-failed");
          if (!res.headersSent) res.writeHead(503, { "cache-control": "no-store" });
          res.end();
        }
      })(); };
      const serverOptions = { maxHeaderSize: 8192, connectionsCheckingInterval: 1000 };
      const server = tls ? createHttpsServer({ ...tls, ...serverOptions, handshakeTimeout: HEADER_DEADLINE_MS }, handleRequest) : createHttpServer(serverOptions, handleRequest);
      server.maxConnections = MAX_CONNECTIONS;
      server.maxHeadersCount = 16;
      server.maxRequestsPerSocket = 1;
      server.headersTimeout = HEADER_DEADLINE_MS;
      server.requestTimeout = REQUEST_DEADLINE_MS;
      server.timeout = REQUEST_DEADLINE_MS;
      server.keepAliveTimeout = 1000;
      await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, bind, () => resolveListen(undefined)); });
      const bound = server.address();
      if (!bound || typeof bound === "string") throw new Error("Private listener unavailable.");
      const boundPort = bound.port;
      const address = `${tls ? "https" : "http"}://${bind}:${boundPort}/private-brain/search`;
      process.stderr.write(`Private brain session ${session.identity.session}\nAgent key ${session.identity.agent} (${session.identity.agentLabel})\nLeaf ${session.identity.leafId}; exact records ${session.identity.recordIds.join(", ")}\nExpires ${session.identity.expiresAt}\n${bind === "127.0.0.1" ? "Loopback" : "Owner-bound HTTPS"} ${address}\nType revoke and Enter, or stop this process, to end access. A remote agent needs a route to this address and must verify its TLS certificate.\n`);
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (unshownRefusals) process.stderr.write(`Refused ${unshownRefusals} more requests not shown\n`);
        session.revoke();
        server.close();
        server.closeAllConnections();
        process.stdin.pause();
        process.stdin.destroy();
      };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      process.stdin.setEncoding("utf8");
      let pending = "";
      process.stdin.on("data", chunk => {
        pending += chunk;
        if (pending.length > 1000) { stop(); return; }
        if (pending.split(/\r?\n/).some(line => line.trim() === "revoke")) stop();
        pending = pending.slice(pending.lastIndexOf("\n") + 1);
      });
      process.stdin.once("end", stop);
      setTimeout(stop, minutes * 60_000).unref();
    }
  }
} catch (error) {
  process.stderr.write(`foliage private-brain: ${error instanceof Error ? error.message : "Session unavailable."}\n${usage}`);
  process.exitCode = 1;
}
