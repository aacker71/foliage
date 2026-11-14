import { test } from "node:test";
import assert from "node:assert/strict";
import { runObservedScarlet, type LadybugDiagnostic } from "./ladybugObserved.ts";
import { streamChat } from "./scarletModel.ts";

test("a refused run emits one content-free diagnostic; observation failure does not change the outcome", async () => {
  const args: Parameters<typeof runObservedScarlet>[0] = {
    input: { threadId: "private-thread", runId: "private-run", messages: [{ id: "q", role: "user", content: "private-question" }],
      ignored: { tools: 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 } },
    leaf: { ok: false, cause: "absent", path: "private-path", detail: "private-path" },
    model: { ok: false, cause: "no-model-declared" }, ids: { messageId: "m" }, signal: new AbortController().signal,
    emit: () => {}, stream: streamChat,
  };
  const records: LadybugDiagnostic[] = [];
  assert.equal((await runObservedScarlet(args, r => records.push(r))).kind, "refused");
  assert.equal(records.length, 1); assert.equal(records[0]!.status, "refused");
  assert.equal(records[0]!.code, "leaf-unavailable");
  assert.ok(!JSON.stringify(records).includes("private"));
  assert.equal((await runObservedScarlet(args, () => { throw new Error("sink unavailable"); })).kind, "refused");
  const broken = { ...args, emit: () => { throw new Error("private exception"); } };
  await assert.rejects(runObservedScarlet(broken, r => records.push(r)));
  assert.equal(records[1]!.code, "runner-error");
  assert.ok(!JSON.stringify(records).includes("private"));
});
