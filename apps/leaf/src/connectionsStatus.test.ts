import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConnectionStatus, type ConnectionStatus } from "./connectionStatus.ts";

async function assertRecovery(t: import("node:test").TestContext, failure: "http" | "network" | "malformed") {
    const updates: ConnectionStatus[] = [];
    let calls = 0;
    let completeRetry!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { completeRetry = resolve; });
    t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
      assert.equal(url, "/sources/api");
      assert.equal(options?.method ?? "GET", "GET");
      calls++;
      if (calls > 1) return pending;
      if (failure === "network") throw Error("Connection interrupted");
      return failure === "http" ? new Response("Unavailable", { status: 503 }) : Response.json({});
    });

    const update = (value: ConnectionStatus) => { updates.push(value); };
    await loadConnectionStatus(update);
    assert.deepEqual(updates, [{ kind: "loading" }, { kind: "unavailable" }]);

    const retry = loadConnectionStatus(update);
    assert.deepEqual(updates.at(-1), { kind: "loading" });
    const companion = { connected: true, ready: true, model: null, detail: "" };
    completeRetry(Response.json({ ladybug: companion }));
    await retry;
    assert.equal(calls, 2);
    assert.deepEqual(updates.at(-1), { kind: "ready", companion });
}

test("Sources status recovers after an HTTP GET failure", async t => {
  await assertRecovery(t, "http");
});
test("Sources status recovers after a network GET failure", async t => {
  await assertRecovery(t, "network");
});
test("Sources status recovers after a malformed GET response", async t => {
  await assertRecovery(t, "malformed");
});

test("leaving Sources ignores a late failed status read", async t => {
  const controller = new AbortController();
  const updates: ConnectionStatus[] = [];
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); throw Error("Aborted"); });
  await loadConnectionStatus(value => updates.push(value), controller.signal);
  assert.deepEqual(updates, [{ kind: "loading" }]);
});

test("an aborted status read cannot overwrite a newer connection result", async t => {
  const controller = new AbortController();
  let completeStale!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { completeStale = resolve; });
  t.mock.method(globalThis, "fetch", () => pending);
  const updates: ConnectionStatus[] = [];
  const staleRequest = loadConnectionStatus(value => updates.push(value), controller.signal);
  controller.abort();
  const current: ConnectionStatus = { kind: "ready", companion: { connected: false, ready: false, model: null, detail: "" } };
  updates.push(current);
  completeStale(Response.json({ ladybug: { connected: true, ready: true, model: null, detail: "" } }));
  await staleRequest;
  assert.deepEqual(updates, [{ kind: "loading" }, current]);
});
