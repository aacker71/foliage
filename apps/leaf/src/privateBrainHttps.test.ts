import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { connect as rawConnect, isIP, type Socket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { privateBrainSigningInput } from "./privateBrainSession.ts";

const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const remoteAddress = Object.values(networkInterfaces()).flat().find(item => item?.family === "IPv4" && !item.internal)?.address;
const bind = remoteAddress && isIP(remoteAddress) === 4 ? remoteAddress : "127.0.0.1";

function certificate(directory: string, label: string, address: string) {
  const key = join(directory, `${label}-key.pem`), cert = join(directory, `${label}-cert.pem`);
  // Protocol-only keys live in a disposable directory. No credentials or test certificates enter the tree.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
    "-out", cert, "-days", "1", "-subj", `/CN=${address}`, "-addext", `subjectAltName=IP:${address}`],
  { stdio: "ignore", timeout: 15_000 });
  return { key, cert };
}

async function securePost(url: string, ca: Buffer, body: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const call = request(new URL(url), { method: "POST", ca, rejectUnauthorized: true, headers: {
      "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers,
    }, timeout: 10_000 }, answer => {
      const chunks: Buffer[] = [];
      let size = 0;
      answer.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 64 * 1024) { call.destroy(new Error("Private response exceeded the test bound.")); return; }
        chunks.push(chunk);
      });
      answer.once("end", () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers,
        body: Buffer.concat(chunks).toString("utf8") }));
      answer.once("error", reject);
    });
    call.once("error", reject);
    call.end(body);
  });
}

async function tricklePost(url: string, ca: Buffer, body: string, headers: Record<string, string>) {
  return new Promise<{ elapsed: number; status: number | null }>((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const call = request(new URL(url), { method: "POST", ca, rejectUnauthorized: true, headers: {
      "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers,
    } });
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      clearTimeout(limit);
      call.destroy();
      resolve({ elapsed: Date.now() - started, status });
    };
    const limit = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      call.destroy();
      reject(new Error("A trickling POST held the private listener beyond the wall-clock deadline."));
    }, 13_000);
    call.once("response", answer => { answer.resume(); finish(answer.statusCode ?? null); });
    call.once("error", () => finish(null));
    call.write(body[0]);
    timer = setInterval(() => call.write(body[1]), 500);
  });
}

async function openIdleTls(url: string, ca: Buffer): Promise<TLSSocket> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: target.hostname, port: Number(target.port), ca, rejectUnauthorized: true });
    const limit = setTimeout(() => { socket.destroy(); reject(new Error("Idle TLS socket did not connect in time.")); }, 3000);
    socket.once("secureConnect", () => { clearTimeout(limit); resolve(socket); });
    socket.once("error", error => { clearTimeout(limit); reject(error); });
  });
}

async function openPreHandshake(url: string): Promise<Socket> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = rawConnect({ host: target.hostname, port: Number(target.port) });
    socket.once("connect", () => { socket.on("error", () => {}); resolve(socket); });
    socket.once("error", reject);
  });
}

async function childRun(args: string[]) {
  const child = spawn(process.execPath, [launcher, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", part => { stderr += part; });
  const code = await new Promise<number | null>(resolve => child.once("exit", resolve));
  return { code, stderr };
}

test("owner-selected HTTPS address requires TLS and exact signed scope", { timeout: 35_000 }, async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-private-https-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  // This is only a transport fixture, never a fabricated person or career outcome.
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "transport-fixture", subject: "Transport fixture",
    headline: "granted-transport-marker", profile: { bio: "ungranted-transport-marker" }, leaflets: [] }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const agentKey = join(garden, "agent-public.pem");
  await writeFile(agentKey, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const selected = ["private-brain", "serve", "--garden", garden, "--agent-key", agentKey,
    "--agent-label", "transport-agent", "--record", "profile:headline", "--minutes", "1"];
  const linkedAgentKey = join(garden, "agent-link.pem");
  await symlink(agentKey, linkedAgentKey);
  const linkedKey = await childRun(selected.map(value => value === agentKey ? linkedAgentKey : value));
  assert.notEqual(linkedKey.code, 0);
  assert.match(linkedKey.stderr, /agent public key must be a small regular file/);
  const oversizedAgentKey = join(garden, "oversized-agent.pem");
  await writeFile(oversizedAgentKey, "x".repeat(4097));
  const oversizedKey = await childRun(selected.map(value => value === agentKey ? oversizedAgentKey : value));
  assert.notEqual(oversizedKey.code, 0);
  assert.match(oversizedKey.stderr, /agent public key must be a small regular file/);
  const noTls = await childRun([...selected, "--bind", "127.0.0.2"]);
  assert.notEqual(noTls.code, 0);
  assert.match(noTls.stderr, /non-loopback bind requires an explicit TLS/);
  assert.doesNotMatch(noTls.stderr, /Private brain session/);
  const wildcard = await childRun([...selected, "--bind", "0.0.0.0"]);
  assert.notEqual(wildcard.code, 0);
  assert.match(wildcard.stderr, /not a hostname or wildcard/);

  const trusted = certificate(garden, "trusted", bind);
  const untrusted = certificate(garden, "untrusted", bind);
  await chmod(trusted.key, 0o600);
  await chmod(untrusted.key, 0o600);
  const looseKey = await childRun([...selected, "--bind", bind, "--tls-cert", trusted.cert, "--tls-key", untrusted.cert]);
  assert.notEqual(looseKey.code, 0);
  assert.match(looseKey.stderr, /TLS private key must be a private regular PEM file/);

  const child = spawn(process.execPath, [launcher, ...selected, "--bind", bind,
    "--tls-cert", trusted.cert, "--tls-key", trusted.key], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (!child.killed) child.kill("SIGTERM"); });
  let startup = "";
  const ready = new Promise<string>((resolve, reject) => {
    child.stderr.setEncoding("utf8").on("data", chunk => {
      startup += chunk;
      if (startup.includes("Type revoke and Enter")) resolve(startup);
    });
    child.once("exit", code => reject(new Error(`HTTPS pilot exited before ready: ${code}; ${startup}`)));
  });
  const output = await ready;
  const session = output.match(/Private brain session ([a-f0-9]{32})/)?.[1];
  const url = output.match(/https:\/\/[^\s]+\/private-brain\/search/)?.[0];
  assert.ok(session && url);
  assert.equal(new URL(url).hostname, bind);
  assert.match(output, bind === "127.0.0.1" ? /Loopback https:/ : /Owner-bound HTTPS https:/);
  const ca = await readFile(trusted.cert);
  const body = JSON.stringify({ query: "granted-transport-marker" });
  const signed = (key: typeof privateKey, payload = body) => {
    const timestamp = String(Date.now()), nonce = randomBytes(18).toString("base64url");
    return { "x-foliage-session": session, "x-foliage-timestamp": timestamp, "x-foliage-nonce": nonce,
      "x-foliage-signature": sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(payload)), key).toString("base64url") };
  };
  await assert.rejects(securePost(url, await readFile(untrusted.cert), body, signed(privateKey)));
  const unsigned = await securePost(url, ca, body, {});
  assert.equal(unsigned.status, 401);
  assert.doesNotMatch(unsigned.body, /granted-transport-marker/);
  const foreign = await securePost(url, ca, body, signed(other.privateKey));
  assert.equal(foreign.status, 401);
  const paddedBody = `${body}${" ".repeat(4096 - Buffer.byteLength(body))}`;
  const trickle = await tricklePost(url, ca, paddedBody, signed(privateKey, paddedBody));
  assert.ok(trickle.elapsed >= 4000 && trickle.elapsed < 13_000, `Slow POST closed after ${trickle.elapsed}ms`);
  assert.ok(trickle.status === null || trickle.status === 408);
  const idle: TLSSocket[] = [];
  try {
    for (let i = 0; i < 8; i++) idle.push(await openIdleTls(url, ca));
    await assert.rejects(openIdleTls(url, ca));
  } finally { for (const socket of idle) socket.destroy(); }
  const preHandshake: Socket[] = [];
  try {
    for (let i = 0; i < 8; i++) preHandshake.push(await openPreHandshake(url));
    const closed = Promise.all(preHandshake.map(socket => new Promise<void>(resolve => {
      if (socket.destroyed) resolve(); else socket.once("close", () => resolve());
    })));
    await Promise.race([closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Raw TLS sockets outlived the handshake deadline.")), 8_000))]);
    const recovered = await securePost(url, ca, body, signed(privateKey));
    assert.equal(recovered.status, 200);
  } finally { for (const socket of preHandshake) socket.destroy(); }
  const outsideBody = JSON.stringify({ query: "ungranted-transport-marker" });
  const outsideScope = await securePost(url, ca, outsideBody, signed(privateKey, outsideBody));
  assert.equal(outsideScope.status, 200);
  assert.ok(JSON.parse(outsideScope.body).hits.every((hit: { id: string }) => hit.id === "profile:headline"));
  assert.doesNotMatch(outsideScope.body, /ungranted-transport-marker/);
  const valid = await securePost(url, ca, body, signed(privateKey));
  assert.equal(valid.status, 200);
  assert.equal(valid.headers["cache-control"], "no-store");
  assert.equal(valid.headers["x-robots-tag"], "noindex, nofollow");
  assert.match(valid.body, /granted-transport-marker/);
  assert.doesNotMatch(valid.body, /ungranted-transport-marker|score|rating/);
  const receiptLog = await readFile(join(garden, "private-brain-receipts.jsonl"), "utf8");
  const receipts = receiptLog.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(receipts.length, 3);
  assert.deepEqual(receipts.at(-1)?.scope, ["profile:headline"]);
  assert.deepEqual(receipts.at(-1)?.hits, ["profile:headline"]);
  assert.doesNotMatch(receiptLog, /transport-marker/);

  const ended = new Promise<number | null>(resolve => child.once("exit", resolve));
  child.stdin.write("revoke\n");
  assert.equal(await ended, 0);
  await assert.rejects(securePost(url, ca, body, signed(privateKey)));
});
