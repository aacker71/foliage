/**
 * `server.mjs` on a taken port, driven through the real CLI.
 *
 * THE CORPSE THIS PINS. Before this fix, an occupied port crashed the process with a raw,
 * uncaught `Error: listen EADDRINUSE: address already in use 127.0.0.1:<port>` — a node internal
 * stack trace, on the README-documented path of "I already have this server running" or "a
 * stale `foliage up` is still bound here". `createServer(...)` never had an `"error"` listener,
 * so the failure had nowhere to go but the default uncaught-exception path.
 *
 * A throwaway `node:net` server occupies a real port FIRST — the same technique
 * `apps/canopy/src/seam.test.ts` uses to find one, inverted to hold it — so the CLI is proven
 * against a genuinely bound socket rather than a guess about what node prints.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SERVER_CLI = fileURLToPath(new URL("../server.mjs", import.meta.url));

/** Bind a real port and hand it to `body`, closing it afterward either way. */
async function withOccupiedPort(body: (port: number) => void | Promise<void>): Promise<void> {
  const holder = createServer();
  const port = await new Promise<number>((resolveBound, reject) => {
    holder.on("error", reject);
    holder.listen(0, "127.0.0.1", () => {
      const addr = holder.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("no port from the OS"));
        return;
      }
      resolveBound(addr.port);
    });
  });
  try {
    await body(port);
  } finally {
    await new Promise<void>((r) => holder.close(() => r()));
  }
}

test("a taken port refuses with the friendly guidance, never a raw EADDRINUSE stack", async () => {
  await withOccupiedPort((port) => {
    const r = spawnSync(process.execPath, [SERVER_CLI], {
      encoding: "utf8",
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      timeout: 10_000,
    });
    assert.notEqual(r.status, 0, "a taken port must not exit clean");
    assert.match(
      r.stderr,
      new RegExp(`port ${port} is taken`),
      `expected the friendly guidance naming port ${port}; got:\n${r.stderr}`,
    );
    assert.match(r.stderr, /Set PORT=<n> to run beside it/);
    // The regression this pins: no node-internal stack trace reaching the operator's terminal.
    assert.doesNotMatch(r.stderr, /at Server\.|at listenInCluster|node:net/, `a raw stack leaked:\n${r.stderr}`);
  });
});

test("the unauthenticated private workspace refuses a network-facing bind", () => {
  const r = spawnSync(process.execPath, [SERVER_CLI], {
    encoding: "utf8",
    env: { ...process.env, PORT: "0", HOST: "0.0.0.0" },
    timeout: 10_000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refused non-loopback HOST/);
  assert.doesNotMatch(r.stdout, /127\.0\.0\.1:\d+/);
});
