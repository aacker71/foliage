/** Actual loopback service and repository references; no model/provider stub output. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createAssessmentCompanion } from "../../apps/canopy/src/assessmentConnection.ts";
import { createAssessmentConnection } from "../../apps/leaf/src/assessmentConnection.ts";
import { exportWorkflowTransfer } from "../../apps/leaf/src/workflowTransfer.ts";
import { workflowPacket } from "../../apps/leaf/src/workflowContext.ts";

test("paired service prepares actual commit evidence without starting inference or writing a workspace", async () => {
  const secret = randomBytes(32).toString("hex"), companion = createAssessmentCompanion({ FOLIAGE_COMPANION_KEY: secret });
  const server = createServer(async (req, res) => {
    if (!companion.authorize(req.headers.authorization, req.headers.origin)) { res.writeHead(403).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const result = companion.command(req.url.split("/").at(-1), JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const c = createAssessmentConnection({ FOLIAGE_COMPANION_ORIGIN: `http://127.0.0.1:${address.port}`, FOLIAGE_COMPANION_KEY: secret });
  try {
    const connected = await c.connect(); assert.equal(connected.connected, true); assert.equal(connected.ready, false);
    const cwd = new URL("../..", import.meta.url).pathname;
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const title = execFileSync("git", ["show", "-s", "--format=%s", sha], { cwd, encoding: "utf8" }).trim();
    const id = createHash("sha256").update(sha).digest("hex"), now = new Date().toISOString();
    const state = { sources: [], proposals: [{ id, source: id, title, evidence: [{ sha, title, email: "" }], omitted: 0, status: "accepted", updatedAt: now, capturedAt: now, revision: 1 }] };
    const transfer = exportWorkflowTransfer(state, id, workflowPacket(state, id).digest);
    const prepared = await c.prepare(transfer, { id: "connection-regression", name: "Connection regression" });
    const packet = companion.review(new URL(prepared.reviewUrl).pathname.split("/").at(-1));
    assert.ok(packet); assert.match(packet.evidence, new RegExp(sha)); assert.ok(packet.evidence.includes(title));
    assert.equal(packet.subject, "Connection regression"); assert.equal(packet.id, "connection-regression");
    c.disconnect(); await assert.rejects(c.prepare(transfer, { id: packet.id, name: packet.subject }), /Connect/);
  } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
