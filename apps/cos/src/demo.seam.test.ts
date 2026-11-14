/**
 * `demo.sh`, run for real against a stand-in local model runtime that holds its answer.
 *
 * Scene ③ is the one a person watches: its routing account (RETRIEVED, DECISION, EGRESS, TIER 3)
 * prints before the model is asked, and a model takes many seconds to answer. The captions at
 * the end read what ③ printed, which once meant capturing it and showing nothing until the model
 * had finished. So the runtime here does not answer until ③'s routing account is on screen, and
 * gives up after a deadline; the captions must then say what PRODUCED BY said.
 *
 * The environment is built from scratch, as in cos.seam.test.ts, so no credential in the shell
 * can reach scene ⑤: it ends at `no-credential` and nothing leaves the machine.
 */

import { match, ok, strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DEMO = fileURLToPath(new URL("../demo.sh", import.meta.url));
const ROUTING_SHOWN = /③[\s\S]*EGRESS[\s\S]*TIER 3/;

test("demo.sh shows scene ③'s routing while the model is still answering, and captions what answered", {
  skip: process.platform === "win32" ? "a bash script" : false,
}, async () => {
  let out = "";
  let shownBeforeAnswer: boolean | undefined;
  const runtime = createServer(async (req, res) => {
    for await (const _ of req) { /* the request body is not under test */ }
    if (req.url !== "/api/chat") {
      res.writeHead(404).end();
      return;
    }
    for (const deadline = Date.now() + 10_000; Date.now() < deadline && !ROUTING_SHOWN.test(out);) {
      await new Promise((r) => setTimeout(r, 50));
    }
    shownBeforeAnswer ??= ROUTING_SHOWN.test(out);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      model: "llama3.2:3b", done: true, message: { role: "assistant", content: "Lead with the migration result." },
    }));
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = runtime.address() as AddressInfo;
    const child = spawn("bash", [DEMO], {
      env: {
        PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "",
        FOLIAGE_LOCAL_MODEL: "llama3.2:3b", FOLIAGE_LOCAL_MODEL_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (out += b.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    strictEqual(code, 0, out);
  } finally {
    runtime.close();
  }

  strictEqual(shownBeforeAnswer, true, `scene ③ printed nothing until the model answered:\n${out}`);
  match(out, /PRODUCED BY {2}local-model/);
  ok(out.includes("Private material reasoned over on-device by a local model (PRODUCED BY in ③)."), out);
  ok(out.includes("Nothing in ③ left the machine. TIER 3 read: not attempted — policy-refused."), out);
  ok(!out.includes("No local model answered ③"), out);
});
