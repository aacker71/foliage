import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkflowState, type WorkflowFetch } from "../workflow-ui/load.ts";

test("a malformed local workflow returns a real 503 and the UI read exits loading without extra requests", { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-workflow-load-"));
  await writeFile(join(directory, "workflow.json"), "{broken");
  await writeFile(join(directory, "leaf.json"), "{broken");
  const server = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      FOLIAGE_WORKFLOW_DIR: directory,
      FOLIAGE_LEAF: join(directory, "leaf.json"),
      TYPESAFE_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(server, "exit");
  try {
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Leaf server did not start")), 15_000);
      server.stdout.on("data", chunk => {
        output += String(chunk);
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      server.once("exit", () => { clearTimeout(timer); reject(new Error("Leaf server exited before readiness")); });
    });
    const response = await fetch(base + "/workflow/api");
    assert.equal(response.status, 503);
    const body = await response.json() as { error: string };
    assert.ok(body.error.length > 0);

    const requested: string[] = [];
    const request: WorkflowFetch = (url, init) => {
      requested.push(url);
      return fetch(base + url, init);
    };
    const first = await readWorkflowState(request);
    assert.deepEqual(first, { ok: false, detail: body.error, technical: "HTTP 503" });
    assert.deepEqual(requested, ["/workflow/api"]);

    const retry = await readWorkflowState(request);
    assert.deepEqual(retry, first, "Retry reports the continuing failure instead of returning to an endless load");
    assert.deepEqual(requested, ["/workflow/api", "/workflow/api"], "Retry only repeats the local GET");
  } finally {
    server.kill("SIGTERM");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a stalled workflow read has a bounded failure and aborts its only request", async () => {
  let calls = 0;
  let aborted = false;
  const request: WorkflowFetch = (url, { signal }) => {
    assert.equal(url, "/workflow/api");
    calls++;
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  };
  assert.deepEqual(await readWorkflowState(request, 20), {
    ok: false,
    detail: "Sources did not respond in time.",
  });
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test("a failed Sources read keeps its sentence plain and leaves the status or browser error for Technical details", async () => {
  const gateway: WorkflowFetch = async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
  const answered = await readWorkflowState(gateway, 1_000);
  assert.deepEqual(answered, { ok: false, detail: "Sources could not be read.", technical: "HTTP 502" });

  const refused: WorkflowFetch = async () => { throw new TypeError("Failed to fetch"); };
  const unreachable = await readWorkflowState(refused, 1_000);
  assert.deepEqual(unreachable, { ok: false, detail: "Sources could not be read.", technical: "Failed to fetch" });

  for (const failed of [answered, unreachable]) {
    assert.equal(failed.ok, false);
    if (failed.ok) continue;
    assert.doesNotMatch(failed.detail, /HTTP|\b[1-5]\d\d\b|workflow|fetch/i, "the sentence names Sources, not transport internals");
  }
});
