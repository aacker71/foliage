/**
 * Conformance of the pure protocol slice, with no server: the frame, the field discipline the SDK
 * verifier enforces, the ordering state machine, and the input parser. The seam test proves the
 * same rules over a real socket; this file is where a broken rule fails by NAME.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUN_IDLE,
  advance,
  encodeSse,
  parseRunAgentInput,
  type AgUiEvent,
  type GroundingReport,
  type IgnoredInput,
  type Provenance,
  type RunAgentInput,
  type RunErrorCode,
  type RunInputMessage,
  type RunPhase,
} from "./agui.ts";

const NOTHING_IGNORED: IgnoredInput = { tools: 0, system: 0, developer: 0, tool: 0, other: 0, toolCalls: 0 };
const GROUNDING: GroundingReport = {
  subject: "S",
  declaredExample: false,
  verified: 1,
  pending: 2,
  excluded: 3,
  exclusionReasons: ["no evidence"],
  titlesListed: 6,
  titlesOmitted: 0,
  ignored: NOTHING_IGNORED,
};
const PROVENANCE: Provenance = { runtime: "ollama", model: "m", endpoint: "http://127.0.0.1:11434/api/chat" };
const A_CODE: RunErrorCode = "no-runtime";

/** One of every member — the exhaustiveness check below fails to compile if the union grows. */
const ONE_OF_EACH: readonly AgUiEvent[] = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "CUSTOM", name: "foliage.grounding", value: GROUNDING },
  { type: "CUSTOM", name: "foliage.provenance", value: PROVENANCE },
  { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hi" },
  { type: "TEXT_MESSAGE_END", messageId: "m1" },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
  { type: "RUN_ERROR", message: "x", code: A_CODE },
];

test("encodeSse writes exactly one `data:` line and a blank line — nothing the SDK parser ignores", () => {
  for (const event of ONE_OF_EACH) {
    const frame = encodeSse(event);
    assert.equal(frame, `data: ${JSON.stringify(event)}\n\n`);
    assert.doesNotMatch(frame, /^(event|id|retry):/m, "no non-data SSE fields");
    // The parser strips `data:` and one optional space, then JSON.parse — round trip must hold.
    assert.deepEqual(JSON.parse(frame.slice("data: ".length, -2)), event);
  }
});

test("no event carries null for an optional field, nor timestamp/rawEvent/metadata; keys are camelCase", () => {
  for (const event of ONE_OF_EACH) {
    const json = JSON.stringify(event);
    assert.doesNotMatch(json, /:null[,}]/, `${event.type} serialises a null`);
    for (const key of ["timestamp", "rawEvent", "metadata"]) {
      assert.equal(key in event, false, `${event.type} must omit ${key}, never send it`);
    }
    for (const key of Object.keys(event)) assert.match(key, /^[a-z][A-Za-z]*$/, `${event.type}.${key}`);
  }
});

const started: AgUiEvent = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const startMsg: AgUiEvent = { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" };
const content: AgUiEvent = { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "a" };
const endMsg: AgUiEvent = { type: "TEXT_MESSAGE_END", messageId: "m1" };
const finished: AgUiEvent = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const errored: AgUiEvent = { type: "RUN_ERROR", message: "x", code: "timeout" };

/** Fold a sequence through `advance`, failing on the first violation. */
function run(events: readonly AgUiEvent[], from: RunPhase = RUN_IDLE): RunPhase {
  return events.reduce<RunPhase>((state, event) => {
    const step = advance(state, event);
    assert.ok(step.ok, `unexpected violation: ${step.ok ? "" : step.violation}`);
    return step.ok ? step.next : state;
  }, from);
}

function refuses(state: RunPhase, event: AgUiEvent, why: RegExp): void {
  const step = advance(state, event);
  assert.equal(step.ok, false, `${event.type} should be refused from ${state.phase}`);
  if (!step.ok) assert.match(step.violation, why);
}

test("advance: RUN_STARTED is the only way out of idle, and cannot repeat while running", () => {
  assert.deepEqual(run([started]), { phase: "running", openMessage: null });
  for (const event of [startMsg, content, endMsg, finished, errored]) refuses(RUN_IDLE, event, /before RUN_STARTED/);
  refuses(run([started]), started, /still active/);
});

test("advance: content and end need their message open; a second start while one is open is refused", () => {
  const running = run([started]);
  refuses(running, content, /not open/);
  refuses(running, endMsg, /not open/);
  const open = run([startMsg], running);
  refuses(open, startMsg, /still open/);
  refuses(open, { type: "TEXT_MESSAGE_END", messageId: "other" }, /not open/);
  refuses(open, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "" }, /empty delta/);
  assert.deepEqual(run([content, endMsg], open), { phase: "running", openMessage: null });
});

test("advance: RUN_FINISHED refuses an open message; after finished only RUN_STARTED may follow", () => {
  refuses(run([started, startMsg]), finished, /still open/);
  const done = run([started, startMsg, content, endMsg, finished]);
  assert.deepEqual(done, { phase: "finished" });
  for (const event of [startMsg, content, endMsg, finished, errored]) refuses(done, event, /after RUN_FINISHED/);
  assert.deepEqual(run([started], done), { phase: "running", openMessage: null });
});

test("advance: RUN_ERROR is allowed mid-message, and nothing at all follows it", () => {
  const stopped = run([started, startMsg, content, errored]);
  assert.deepEqual(stopped, { phase: "errored" });
  for (const event of [started, startMsg, content, endMsg, finished, errored]) refuses(stopped, event, /after RUN_ERROR/);
  // CUSTOM rides along while running, open message or not.
  const custom = ONE_OF_EACH[2]!;
  assert.deepEqual(run([custom], run([started])), { phase: "running", openMessage: null });
  assert.deepEqual(run([custom], run([started, startMsg])), { phase: "running", openMessage: "m1" });
});

test("parseRunAgentInput: the HttpAgent shape, the lenient shapes, and each refusal named by position", () => {
  const full = parseRunAgentInput({
    threadId: "t-1",
    runId: "r-1",
    state: {},
    messages: [{ id: "m-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
  });
  assert.equal(full.ok, true);
  if (full.ok) {
    const forwarded: readonly RunInputMessage[] = [{ id: "m-1", role: "user", content: "hello" }];
    const expected: RunAgentInput = { threadId: "t-1", runId: "r-1", messages: forwarded, ignored: NOTHING_IGNORED };
    assert.deepEqual(full.input, expected);
  }

  const bare = parseRunAgentInput({ threadId: "t", runId: "r", state: null, messages: [{ id: "m", role: "user", content: "q" }] });
  assert.equal(bare.ok, true, "missing tools/context/forwardedProps and state:null are fine");

  const noRun = parseRunAgentInput({ threadId: "t", messages: [] });
  assert.deepEqual(noRun, { ok: false, at: "runId", why: "a non-empty string is required" });

  const image = parseRunAgentInput({
    threadId: "t",
    runId: "r",
    messages: [{ id: "m", role: "user", content: [{ type: "text", text: "see" }, { type: "image", source: { type: "url", value: "x" } }] }],
  });
  assert.equal(image.ok, false);
  if (!image.ok) {
    assert.equal(image.at, "messages[0].content[1]");
    assert.match(image.why, /image/);
  }

  const parts = parseRunAgentInput({
    threadId: "t",
    runId: "r",
    messages: [{ id: "m", role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }],
  });
  assert.equal(parts.ok, true);
  if (parts.ok) assert.equal(parts.input.messages[0]?.content, "one\ntwo");

  // Accepted, counted, not forwarded: system/developer/tool messages, the schema's activity and
  // reasoning messages, a role nobody has defined yet, assistant tool calls, tools[]. A real
  // HttpAgent whose thread carries a `reasoning` message used to be refused here with a 400.
  const mixed = parseRunAgentInput({
    threadId: "t",
    runId: "r",
    tools: [{ name: "x", description: "", parameters: {} }],
    messages: [
      { id: "s", role: "system", content: "you are" },
      { id: "d", role: "developer", content: "dev" },
      { id: "u", role: "user", content: "q" },
      { id: "r", role: "reasoning", content: "thought" },
      { id: "a", role: "assistant", toolCalls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { id: "t", role: "tool", content: "result", toolCallId: "c1" },
      { id: "act", role: "activity", activityType: "search", content: { query: "q" } },
      { id: "x", role: "not-yet-invented" },
      { id: "a2", role: "assistant", content: "answer" },
    ],
  });
  assert.equal(mixed.ok, true, JSON.stringify(mixed));
  if (mixed.ok) {
    assert.deepEqual(mixed.input.messages.map((m) => m.id), ["u", "a2"]);
    assert.deepEqual(mixed.input.ignored, { tools: 1, system: 1, developer: 1, tool: 1, other: 3, toolCalls: 1 });
  }

  const noUser = parseRunAgentInput({ threadId: "t", runId: "r", messages: [{ id: "s", role: "system", content: "x" }] });
  assert.deepEqual(noUser, { ok: false, at: "messages", why: "no user message to answer" });

  const noId = parseRunAgentInput({ threadId: "t", runId: "r", messages: [{ role: "user", content: "x" }] });
  assert.equal(noId.ok, false);
  if (!noId.ok) assert.equal(noId.at, "messages[0].id");

  assert.equal(parseRunAgentInput("not an object").ok, false);
  assert.equal(parseRunAgentInput({ threadId: "", runId: "r", messages: [] }).ok, false);
});

test("exhaustiveness: every member of AgUiEvent is named here — the union cannot grow unnoticed", () => {
  const names = ONE_OF_EACH.map((event) => {
    switch (event.type) {
      case "RUN_STARTED":
      case "RUN_FINISHED":
      case "RUN_ERROR":
      case "TEXT_MESSAGE_START":
      case "TEXT_MESSAGE_CONTENT":
      case "TEXT_MESSAGE_END":
        return event.type;
      case "CUSTOM":
        return `${event.type}:${event.name}`;
      default: {
        const unhandled: never = event;
        throw new Error(`unhandled ${JSON.stringify(unhandled)}`);
      }
    }
  });
  assert.equal(new Set(names).size, 8, "one of each member, each distinct");
});
