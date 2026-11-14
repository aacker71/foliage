#!/usr/bin/env node
/**
 * neo — drive BrowserOS neo from a script instead of one agent tool-call per step.
 *
 * WHY THIS EXISTS. Verifying one UI change was costing eight to ten separate agent
 * round-trips: open a tab, snapshot, evaluate, screenshot, re-evaluate after a click,
 * and re-type the same contrast arithmetic every time. Each round-trip is a model turn.
 * BrowserOS neo is an MCP server on loopback (127.0.0.1:9010/mcp, verified), so the whole
 * sequence can be ONE command that returns one structured result — the difference between
 * a ten-turn verification and a one-turn one.
 *
 * Zero dependencies: a Streamable-HTTP MCP client is ~40 lines because the transport is
 * POST + SSE-framed JSON. Nothing here is browser-specific beyond the tool names, so the
 * same client drives any tool neo exposes.
 *
 *   node tools/verify/neo.mjs tabs '{"action":"list"}'
 *   node tools/verify/neo.mjs navigate '{"page":12,"action":"url","url":"http://…"}'
 *   node tools/verify/neo.mjs evaluate '{"page":12,"code":"return document.title"}'
 *
 * SESSION OWNERSHIP. neo scopes pages to the client that opened them, so this file keeps
 * its session id in /tmp and reuses it across invocations — otherwise every command would
 * open its own session and lose the tab it just opened. `--fresh` starts a new one.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const ENDPOINT = process.env["NEO_MCP"] ?? "http://127.0.0.1:9010/mcp";
const CLIENT = process.env["NEO_CLIENT"] ?? "foliage-verify";
const SESSION_FILE = `/tmp/neo-session-${CLIENT}.id`;
const TIMEOUT_MS = Number(process.env["NEO_TIMEOUT_MS"] ?? 60_000);
/** One tab per surface is the working set; past this, recycle instead of accumulating. */
const MAX_TABS = Number(process.env["NEO_MAX_TABS"] ?? 4);

/** Parse an SSE-or-JSON body into the last JSON-RPC payload it carries. */
function parsePayload(text) {
  let payload = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const body = line.slice(6).trim();
      if (body === "") continue;
      try {
        payload = JSON.parse(body);
      } catch {
        /* keep-alive frames are not JSON; ignore */
      }
    }
  }
  if (payload === null && text.trim().startsWith("{")) payload = JSON.parse(text);
  return payload;
}

async function rpc(body, sessionId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { text: await res.text(), sid: res.headers.get("mcp-session-id"), status: res.status };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`neo did not answer within ${TIMEOUT_MS}ms — is BrowserOS neo running?`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function newSession() {
  const { text, sid, status } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: CLIENT, version: "1.0" },
    },
  });
  const payload = parsePayload(text);
  if (payload === null || payload.error) {
    throw new Error(`neo initialize failed (HTTP ${status}): ${text.slice(0, 200)}`);
  }
  if (!sid) throw new Error("neo did not return a session id");
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
  writeFileSync(SESSION_FILE, sid);
  return sid;
}

async function session(fresh) {
  if (fresh && existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
  if (!fresh && existsSync(SESSION_FILE)) return readFileSync(SESSION_FILE, "utf8").trim();
  return newSession();
}

/** Call a neo tool, retrying ONCE on a dead session (neo restarts; the id goes stale). */
async function call(tool, args = {}, { fresh = false } = {}) {
  let sid = await session(fresh);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, status } = await rpc(
      { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } },
      sid,
    );
    const payload = parsePayload(text);
    if (payload === null) {
      if (attempt === 0 && (status === 400 || status === 404)) {
        sid = await newSession();
        continue;
      }
      throw new Error(`neo returned no payload (HTTP ${status}): ${text.slice(0, 200)}`);
    }
    if (payload.error) {
      const message = String(payload.error.message ?? "");
      if (attempt === 0 && /session/i.test(message)) {
        sid = await newSession();
        continue;
      }
      throw new Error(`neo ${tool} failed: ${message}`);
    }
    const content = payload.result?.content ?? [];
    const textParts = content.filter((c) => c.type === "text").map((c) => c.text);
    return { raw: payload.result, text: textParts.join("\n") };
  }
  throw new Error("unreachable");
}

/**
 * Every tab this client owns, as `{ id, url }`.
 *
 * neo marks agent tabs `owned by <client>` in the list; unmarked rows are the user's and
 * are never touched. Getting this wrong is why the browser filled with tabs: the reuse
 * check matched a string neo does not print ("(this client)"), so it silently fell
 * through to opening a new tab on every single check.
 */
async function myTabs() {
  const listed = await call("tabs", { action: "list" });
  const out = [];
  let mineSection = false;
  for (const line of listed.text.split("\n")) {
    // neo groups the list by owner and writes it from the CALLER's point of view: this
    // client's own tabs sit under "Your tabs:" with no suffix, while other agents' rows
    // carry "owned by <client>". Matching the suffix therefore found none of my own —
    // which is exactly why the reuse check never fired and the browser filled up.
    const header = /^([A-Za-z][^\[]*):\s*$/.exec(line);
    if (header !== null) {
      mineSection = /^your tabs/i.test(header[1] ?? "");
      continue;
    }
    const m = /^\s*\[(\d+)\]\s+(\S+)/.exec(line);
    if (m === null) continue;
    // A row explicitly owned by someone else is never mine, whatever section it sits in.
    const ownedByOther = /owned by (?!$)/.test(line) && !line.includes(`owned by ${CLIENT}`);
    if (!mineSection || ownedByOther) continue;
    out.push({ id: Number(m[1]), url: m[2] ?? "" });
  }
  return out;
}

/**
 * Open `url` in THIS client's tab, reusing one rather than accumulating.
 *
 * One tab per origin+path, so checking four surfaces uses four tabs for the life of the
 * session instead of four per run. An exact-URL match is reused as-is; otherwise the
 * oldest owned tab is navigated. Only a client with no tabs at all opens a new one.
 */
export async function openPage(url) {
  const mine = await myTabs();
  const exact = mine.find((t) => t.url === url);
  if (exact !== undefined) {
    await call("navigate", { page: exact.id, action: "url", url });
    return exact.id;
  }
  if (mine.length >= MAX_TABS) {
    // At the cap, recycle the oldest rather than growing without bound.
    const oldest = mine[0];
    if (oldest !== undefined) {
      await call("navigate", { page: oldest.id, action: "url", url });
      return oldest.id;
    }
  }
  const opened = await call("tabs", { action: "new", url, background: true });
  const id = /page (\d+)/i.exec(opened.text);
  if (id === null) throw new Error(`could not read a page id from: ${opened.text.slice(0, 160)}`);
  return Number(id[1]);
}

/** Close every tab this client owns. Never touches the user's or another agent's. */
async function closeMine() {
  const mine = await myTabs();
  for (const tab of mine) {
    try {
      await call("tabs", { action: "close", page: tab.id });
    } catch {
      /* already gone is fine */
    }
  }
  return mine.length;
}

/**
 * Evaluate JS in the page and return the parsed value.
 *
 * neo wraps page-derived output in `[UNTRUSTED_PAGE_CONTENT nonce=…]` markers — correct,
 * since page content is data and not instructions — so the payload is unwrapped here
 * rather than at every call site. The nonce is matched as an opaque token; nothing here
 * treats the content as anything but a value to parse.
 */
function unwrap(text) {
  const start = /\[UNTRUSTED_PAGE_CONTENT[^\]]*\]/.exec(text);
  if (start === null) return text.trim();
  const after = text.slice(start.index + start[0].length);
  const end = /\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]/.exec(after);
  const body = end === null ? after : after.slice(0, end.index);
  return body.replace(/^\s*Untrusted page content follows\..*$/m, "").trim();
}

export async function evaluate(page, code) {
  const result = await call("evaluate", { page, code });
  const body = unwrap(result.text);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , tool, json] = process.argv;
  if (tool === "close-mine") {
    console.log(`closed ${await closeMine()} tab(s) owned by ${CLIENT}`);
    process.exit(0);
  }
  if (tool === "my-tabs") {
    for (const t of await myTabs()) console.log(`  [${t.id}] ${t.url}`);
    process.exit(0);
  }
  if (!tool) {
    console.error("usage: node tools/verify/neo.mjs <tool> '<json args>'");
    process.exit(2);
  }
  try {
    const result = await call(tool, json ? JSON.parse(json) : {});
    console.log(result.text);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
