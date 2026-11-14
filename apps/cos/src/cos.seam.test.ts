/**
 * The seam, exercised the way a person exercises it: by running the command.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT. Every part of this slice already has unit tests that
 * pass — the policy is proven pure, the store is proven encrypted, the client is proven to
 * refuse without a credential. None of that proves they MEET. The failure this file exists to
 * catch is the one the three green suites cannot see: a working router, a working store and a
 * working client wired together so that the material the policy withheld still reaches the
 * request body, or so that the two opposite refusals print as the same line. That only shows
 * up when something drives `cos.mjs` end to end, on a real file, from outside.
 *
 * So this spawns the real entry point with a real store in a real temp directory and reads its
 * real stdout. No mock, no fixture, no injected seam.
 *
 * THIS FILE PROVES NOTHING ABOUT THE MODEL, and could not: there is no credential in the
 * environment it runs in, and it asserts that there isn't rather than assuming it. Every run
 * below terminates either at a policy refusal or at `no-credential`. A green here means the
 * wiring is right; it does not mean an inference ever happened, and no assertion in this file
 * can be read as saying one did.
 *
 * COST: each invocation opens the store, and opening derives a key with scrypt at N=2^17 —
 * about 270ms on the machine that chose those parameters. That is the price of the parameters
 * being real, and it is why this file makes the fewest invocations that still cover the seam.
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { MEMORY_INJECTION_BUDGET } from "./memory.ts";

const CLI = fileURLToPath(new URL("../cos.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

const SECRET = "a passphrase this test chose; nothing derived from it is ever stored";

let dir = "";
let storePath = "";

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the CLI. The environment is built from scratch rather than inherited-and-patched, so a
 * Fireworks credential that happens to be exported in the developer's shell cannot leak in and
 * turn a refusal assertion into a real API call. `PATH` and `HOME` are carried because Node
 * wants them; nothing else is.
 */
function run(args: readonly string[], extraEnv: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        cwd: REPO,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: process.env["HOME"] ?? "",
          FOLIAGE_COS_STORE: storePath,
          FOLIAGE_COS_SECRET: SECRET,
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * The transcript ABOVE the ANSWER section — the store, the retrieval, the routing decision, the
 * egress plan and the transport outcome. That is the whole of what can precede a call, so it is
 * the region where a withheld string appearing would mean something went wrong.
 *
 * Split by locating the marker rather than by `split`, so a run that printed NO answer at all
 * fails loudly here instead of silently yielding the whole transcript as "the account".
 */
const ANSWER_MARKER = "\nANSWER\n";

function beforeAnswer(stdout: string): string {
  const at = stdout.indexOf(ANSWER_MARKER);
  ok(at >= 0, `the run printed no ANSWER section at all:\n${stdout}`);
  return stdout.slice(0, at);
}

function answerSectionOf(stdout: string): string {
  const at = stdout.indexOf(ANSWER_MARKER);
  ok(at >= 0, `the run printed no ANSWER section at all:\n${stdout}`);
  return stdout.slice(at);
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "foliage-cos-seam-"));
  storePath = join(dir, "tier1.foliage");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("no Fireworks credential leaks into this suite's own output", (t) => {
  /* NEVER compare the raw value. This assertion used to be
     `strictEqual(process.env["FOLIAGE_FIREWORKS_API_KEY"], undefined)`, and on 2026-08-19 it
     failed on a machine that had a real key exported — printing the key verbatim into the test
     output, the terminal scrollback and the saved check log, because node's strictEqual reports
     `actual` on failure. A guard against using a credential must not itself become the thing that
     discloses one. Assert on PRESENCE, never on the value. */
  const configured = typeof process.env["FOLIAGE_FIREWORKS_API_KEY"] === "string";
  if (configured) {
    t.skip(
      "a Fireworks credential is configured in this environment, so the seam below may reach the " +
        "provider. That is a real configuration, not a failure — see docs/PRODUCT-ARCHITECTURE-SPEC.md §12, " +
        "which records the live verification. Run with the variable unset to exercise the unconfigured path.",
    );
    return;
  }
  strictEqual(configured, false);
});

test("a fresh store reports the honest empty state — no example, no seeded row", async () => {
  const init = await run(["init"]);
  strictEqual(init.code, 0, init.stderr);
  ok(init.stdout.includes("empty — nothing declared yet"), init.stdout);

  const asked = await run(["ask", "--as", "tier3-shareable", "Draft a note about this week."], {
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });
  ok(asked.stdout.includes("RETRIEVED   empty"), asked.stdout);
  ok(asked.stdout.includes("no seeded row"), asked.stdout);
  // Nothing assembled, nothing withheld, so the policy permits the call — and there is no
  // provider to make it to. That distinction is the next test's whole subject.
  ok(asked.stdout.includes("attempted — no-credential"), asked.stdout);
  ok(asked.stdout.includes("FOLIAGE_FIREWORKS_API_KEY"), asked.stdout);
});

test("a DECLARED tier1-local item: the router refuses, the reason is enumerated, and the client is never reached", async () => {
  const body = "Private review notes: a teammate missed a deadline and I have not raised it.";
  const declared = await run(["declare", "perf-notes", "tier1-local", body]);
  strictEqual(declared.code, 0, declared.stderr);

  // The request itself is declared tier3-shareable, so the ONLY thing that can hold this run
  // back is the stored item. Without that flag the run would also be local-only for the
  // unrelated reason that the request was undeclared, and this test would pass while the
  // tier1 rule it is named after was broken.
  const asked = await run(["ask", "--as", "tier3-shareable", "Draft a note about this week."], {
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });

  ok(asked.stdout.includes("DECISION    local-only"), asked.stdout);
  ok(asked.stdout.includes("cause: tier1-material-present"), asked.stdout);

  // The person is shown WHICH item and WHY, by name. A gate that said "1 item withheld" would
  // pass a weaker version of this assertion and tell them nothing they could check.
  ok(asked.stdout.includes("WITHHELD    perf-notes  — device-only"), asked.stdout);
  ok(asked.stdout.includes("MAY CROSS   (nothing)"), asked.stdout);

  // THE SEAM ASSERTION. Not "the pure function returned local-only" — that is already tested
  // upstream. This is: the transcript of a real run never shows the withheld body, and the
  // Tier 3 branch was not entered at all.
  ok(!asked.stdout.includes(body), "the withheld body appeared in the run's output");
  ok(asked.stdout.includes("not attempted — policy-refused"), asked.stdout);
  ok(!asked.stdout.includes("no-credential"), "a policy refusal must not mention the credential");
});

test("the two refusals are different sentences, and neither can be mistaken for the other", async () => {
  /* A STORE OF ITS OWN, and the reason is a real property this suite discovered rather than a
     tidiness preference. The turn before this one wrote a MEMORY derived from `perf-notes`, and a
     memory derived from tier1-local material IS tier1-local — so it is routed like any other
     device-only item and keeps the whole store `local-only`. Forgetting `perf-notes` does NOT
     forget it: deleting a source does not launder its derivative, which is the anti-laundering
     rule working, not a leak in the test. This test is about the two REFUSAL SENTENCES, so it
     needs a store where escalation is genuinely reachable; the memory behaviour is asserted
     directly in "a memory derived from tier1-local material keeps the whole store device-only". */
  const ownStore = join(dir, "two-refusals.foliage");
  const own = { FOLIAGE_COS_STORE: ownStore };
  await run(["init"], own);
  const refusedByPolicy = await run(["ask", "--as", "tier3-shareable", "anything"], {
    ...own,
    FOLIAGE_COS_MAY_CROSS: "",
  });
  await run(["declare", "release-notes", "tier3-shareable", "A public changelog entry."], own);
  const refusedByAbsence = await run(["ask", "--as", "tier3-shareable", "anything"], {
    ...own,
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });

  ok(refusedByPolicy.stdout.includes("not attempted — policy-refused"), refusedByPolicy.stdout);
  ok(refusedByAbsence.stdout.includes("attempted — no-credential"), refusedByAbsence.stdout);

  // "We refused to send it" and "there was nothing configured to send it to" are opposites.
  // Neither transcript may contain the other's words — that is the property, stated directly,
  // rather than a check that two strings happen to differ today.
  ok(!refusedByPolicy.stdout.includes("no-credential"));
  ok(!refusedByAbsence.stdout.includes("policy-refused"));

  // And in the second run the item genuinely WAS admitted, so the refusal is provably about
  // the missing credential rather than about the policy quietly holding everything back.
  ok(refusedByAbsence.stdout.includes("MAY CROSS   release-notes"), refusedByAbsence.stdout);
});

/**
 * THE BYPASS THIS FILE ONCE MISSED, as its own pair of tests.
 *
 * Every test above puts the sensitive material in a `declare`d item and uses a neutral request
 * string, so all of them passed while the request text itself crossed to Tier 3 with no policy
 * applied at all. A review demonstrated it live on an empty store: `DECISION escalate`,
 * `MAY CROSS (nothing)`, and a typed SSN in the request body. These two tests hold the request
 * to the same rule as everything else, from outside, on a real store.
 *
 * The literal sentence is asserted absent from the transcript for the same reason the tier1
 * test asserts it of a stored body: a gate that refuses and then prints the thing it refused
 * has not refused it.
 */
test("sensitive text typed straight into `ask`, with nothing declared about it, cannot reach Tier 3", async () => {
  const typed = "Private review notes: Dana missed the Q3 deadline. Also my SSN is 123-45-6789.";
  const asked = await run(["ask", typed], { FOLIAGE_COS_MAY_CROSS: "tier3-shareable" });

  ok(asked.stdout.includes("DECISION    local-only"), asked.stdout);
  ok(asked.stdout.includes("cause: undeclared-material-present"), asked.stdout);
  ok(asked.stdout.includes("WITHHELD    <request>  — undeclared"), asked.stdout);
  ok(asked.stdout.includes("MAY CROSS   (nothing)"), asked.stdout);

  // The seam assertion: the client was never reached, and this is a POLICY refusal — not the
  // `no-credential` the same command used to produce with this exact input.
  ok(asked.stdout.includes("not attempted — policy-refused"), asked.stdout);
  ok(!asked.stdout.includes("no-credential"), "an undeclared request must not reach the client");

  /* THE ASSERTION MOVED, AND WHY. It used to be "the typed sentence appears nowhere in the
     output". That was right for a build that only routed and printed nothing else. This build
     ANSWERS, and one of the four things the deterministic floor does is read the request back
     verbatim — showing a person their own typed words on their own terminal is not egress, and
     an answer that will not repeat the question is not an answer.
     So the property is stated where it actually lives: the sentence appears in the ANSWER and
     NOWHERE in the account above it — not in the routing decision, not in the egress plan, not
     in the transport section, which is the whole of what could precede a call. */
  const account = beforeAnswer(asked.stdout);
  const answerSection = answerSectionOf(asked.stdout);
  ok(!account.includes(typed), "the request text appeared in the pre-answer account");
  ok(!account.includes("123-45-6789"), "the request text appeared in the pre-answer account");
  ok(answerSection.includes(typed), "the floor must read the person's own request back to them");
  ok(answerSection.includes("PRODUCED BY  deterministic"), answerSection);
});

test("a request DECLARED tier1-local cannot reach Tier 3 either, under a policy that permits egress", async () => {
  const typed = "My unfiltered notes about the reorg.";
  const asked = await run(["ask", "--as", "tier1-local", typed], {
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });

  ok(asked.stdout.includes("DECISION    local-only"), asked.stdout);
  ok(asked.stdout.includes("cause: tier1-material-present"), asked.stdout);
  ok(asked.stdout.includes("WITHHELD    <request>  — device-only"), asked.stdout);
  ok(asked.stdout.includes("not attempted — policy-refused"), asked.stdout);
  ok(!asked.stdout.includes("no-credential"), "device-only material must not reach the client");
  ok(!beforeAnswer(asked.stdout).includes(typed), "the request text appeared in the pre-answer account");
});

test("a policy naming tier1-local as exportable is refused on sight, with no material present to make it matter", async () => {
  const asked = await run(["ask", "anything"], {
    FOLIAGE_COS_MAY_CROSS: "tier1-local,tier3-shareable",
  });
  ok(asked.stdout.includes("DECISION    refused"), asked.stdout);
  ok(asked.stdout.includes("cause: tier1-egress-declared"), asked.stdout);
  ok(asked.stdout.includes("not attempted — policy-refused"), asked.stdout);
});

test("only `init` creates a file, so a mistyped path reports no-store-file instead of an empty store", async () => {
  const typo = join(dir, "typo.foliage");
  const asked = await run(["ask", "anything"], { FOLIAGE_COS_STORE: typo });
  ok(asked.stdout.includes("could not open — no-store-file"), asked.stdout);
  let created = true;
  try {
    readFileSync(typo);
  } catch {
    created = false;
  }
  strictEqual(created, false, "the mistyped path was created as a fresh empty store");
});

test("help says it is an experimental tool and names the Foliage app it is not part of", async () => {
  for (const args of [["--help"], []]) {
    const help = await run(args);
    strictEqual(help.code, 0, help.stderr);
    ok(/experimental command-line tool, not part of the Foliage app/.test(help.stdout), help.stdout);
    ok(help.stdout.includes("node foliage.mjs up"), help.stdout);
  }
});

test("the raw bytes on disk hold no id, no declared kind, no body and no secret", () => {
  const bytes = readFileSync(storePath);
  const utf8 = bytes.toString("utf8");
  const utf16 = bytes.toString("utf16le");

  const plaintexts = [
    "release-notes",
    "tier3-shareable",
    "A public changelog entry.",
    SECRET,
  ];
  const found = plaintexts.filter((s) => utf8.includes(s) || utf16.includes(s));
  deepStrictEqual(found, [], `plaintext survived to disk: ${found.join(", ")}`);

  // The control. Without this the search above would also pass against an empty file, a
  // deleted file, or a path typo — which is how a "no plaintext found" claim gets made about
  // bytes nobody actually read.
  ok(utf8.includes("foliage-tier1"), "the store's own format tag was not in the file read");
});

// ---------------------------------------------------------------------------------------
// THE ANSWER. These tests exist because the build under them changed shape: `ask` used to
// route and stop, and now every path through it produces a Turn. Each one drives the real CLI
// against a real encrypted store, because that is the only place the router, the local client,
// the floor and memory actually meet.
// ---------------------------------------------------------------------------------------

/** A port nothing is expected to be listening on. Refused connections are the point. */
const CLOSED_PORT_URL = "http://127.0.0.1:11499";

test("the confession this build makes false is gone from the source, not softened", () => {
  const source = readFileSync(CLI, "utf8");
  /* The sentence "NOT ANSWERED … it does not yet reason locally" was true on 2026-08-19 and is
     false now. A confession kept after it stops being true is a lie with good intentions, so it
     is asserted ABSENT rather than reworded — a reworded version would still be printed. */
  ok(!source.includes("does not yet reason locally"), "the stale NOT ANSWERED paragraph is still in cos.mjs");
  ok(!source.includes("NOT ANSWERED"), "the stale NOT ANSWERED text is still in cos.mjs");
});

test("a local-only run with no model configured still ANSWERS, and says a rule produced it", async () => {
  const store = join(dir, "answers-floor.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);

  const asked = await run(["ask", "What should I prepare for next week?"], own);
  strictEqual(asked.code, 0, asked.stderr);
  ok(asked.stdout.includes("DECISION    local-only"), asked.stdout);
  ok(asked.stdout.includes("\nANSWER\n"), asked.stdout);
  ok(asked.stdout.includes("PRODUCED BY  deterministic"), asked.stdout);
  // The floor says what it is AND what it is not. "Assembled on this machine" alone reads to
  // most people as "an AI ran locally"; it did not.
  ok(asked.stdout.includes("No model was involved"), asked.stdout);
  ok(asked.stdout.includes("missing: FOLIAGE_LOCAL_MODEL"), asked.stdout);
  // An empty store gets a real turn and ZERO invented items.
  ok(asked.stdout.includes("Nothing is on file"), asked.stdout);
  ok(asked.stdout.includes("no seeded row"), asked.stdout);
});

test("an unreachable local runtime degrades the answer and NAMES the cause that sent it to the floor", async () => {
  const store = join(dir, "answers-no-runtime.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  await run(["declare", "quarter-plan", "tier1-local", "The plan I wrote for this quarter."], own);

  const asked = await run(["ask", "What is in my quarter plan?"], {
    ...own,
    FOLIAGE_LOCAL_MODEL: "a-model-that-need-not-exist",
    FOLIAGE_LOCAL_MODEL_BASE_URL: CLOSED_PORT_URL,
  });
  strictEqual(asked.code, 0, asked.stderr);
  ok(asked.stdout.includes("LOCAL MODEL no-runtime"), asked.stdout);
  // A model is an upgrade and never a dependency: the answer is worse, and it is still an answer.
  ok(asked.stdout.includes("PRODUCED BY  deterministic"), asked.stdout);
  ok(asked.stdout.includes("the local model was asked and did not answer — `no-runtime`"), asked.stdout);
  // The four causes never collapse, and the answer says so to the person, not only to a log.
  ok(asked.stdout.includes("are four different problems"), asked.stdout);
  // The floor still did real work: it enumerated what is on file, by name, with a citation.
  ok(asked.stdout.includes("FROM YOUR MATERIAL — quarter-plan"), asked.stdout);
});

test("loopback is enforced on the PARSED hostname, so a URL that only looks like loopback opens no socket", async () => {
  const store = join(dir, "answers-loopback.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);

  for (const hostile of ["http://127.0.0.1.evil.com/", "http://127.0.0.1@evil.com/"]) {
    const asked = await run(["ask", "anything at all"], {
      ...own,
      FOLIAGE_LOCAL_MODEL: "a-model-that-need-not-exist",
      FOLIAGE_LOCAL_MODEL_BASE_URL: hostile,
    });
    strictEqual(asked.code, 0, asked.stderr);
    ok(asked.stdout.includes("REFUSED — not loopback"), `${hostile}\n${asked.stdout}`);
    ok(asked.stdout.includes("No socket was opened"), asked.stdout);
    // A refusal is not one of the four ways an ASKED model fails, and it is not filed as one.
    ok(!asked.stdout.includes("`no-runtime`"), asked.stdout);
    ok(asked.stdout.includes("PRODUCED BY  deterministic"), asked.stdout);
  }
  // The negative control: the same check ACCEPTS the real loopback literal, so the test above is
  // not passing because everything is refused.
  const accepted = await run(["ask", "anything at all"], {
    ...own,
    FOLIAGE_LOCAL_MODEL: "a-model-that-need-not-exist",
    FOLIAGE_LOCAL_MODEL_BASE_URL: CLOSED_PORT_URL,
  });
  ok(!accepted.stdout.includes("REFUSED — not loopback"), accepted.stdout);
});

test("a store that will not open still produces an answer, and does not call a locked store empty", async () => {
  const store = join(dir, "answers-locked.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  const asked = await run(["ask", "What do I have on file?"], {
    ...own,
    FOLIAGE_COS_SECRET: "a different secret entirely",
  });
  strictEqual(asked.code, 1, asked.stdout);
  ok(asked.stdout.includes("could not open — key-mismatch"), asked.stdout);
  ok(asked.stdout.includes("\nANSWER\n"), asked.stdout);
  // `store-locked` and "you have nothing" are opposite facts and this is the branch that
  // confuses them. The answer must say the material is still there.
  ok(asked.stdout.includes("DECLINED — material-unreadable"), asked.stdout);
  ok(!asked.stdout.includes("Nothing is on file"), asked.stdout);
});

test("a memory derived from tier1-local material keeps the whole store device-only, even after the source is forgotten", async () => {
  const store = join(dir, "answers-memory-kind.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  await run(["declare", "private-reflection", "tier1-local", "Something I have not told anyone."], own);

  const first = await run(["ask", "--as", "tier3-shareable", "What did I write?"], {
    ...own,
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });
  ok(first.stdout.includes("kind tier1-local — DERIVED"), first.stdout);
  ok(first.stdout.includes("egress: device-only (tier1-local)"), first.stdout);

  /* Forgetting the SOURCE does not forget the derivative, and that is the anti-laundering rule
     rather than a leak: a summary of a private reflection is still the private reflection. The
     store therefore stays device-only, and the router says so about the memory BY NAME. */
  await run(["forget", "private-reflection"], own);
  const second = await run(["ask", "--as", "tier3-shareable", "What did I write?"], {
    ...own,
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
  });
  ok(second.stdout.includes("RETRIEVED   0 declared item(s)"), second.stdout);
  ok(second.stdout.includes("DECISION    local-only"), second.stdout);
  ok(second.stdout.includes("cause: tier1-material-present"), second.stdout);
  ok(/WITHHELD {4}<memory:[^>]+> {2}— device-only/.test(second.stdout), second.stdout);
});

test("a re-ask SUPERSEDES rather than overwrites, and the memory it replaced is still in the store", async () => {
  const store = join(dir, "answers-supersede.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  await run(["declare", "roadmap", "tier1-local", "The roadmap as I currently understand it."], own);

  const first = await run(["ask", "Where does the roadmap stand?"], own);
  const firstId = /REMEMBERED  (ask:[^\s]+)/.exec(first.stdout)?.[1];
  ok(typeof firstId === "string", first.stdout);

  const second = await run(["ask", "Where does the roadmap stand?"], own);
  ok(second.stdout.includes(`supersedes ${firstId}`), second.stdout);
  ok(second.stdout.includes("byte for byte, unedited"), second.stdout);

  // The replaced memory is no longer LIVE — `activeMemories` drops it — while the replacement is.
  const secondId = /REMEMBERED  (ask:[^\s]+)/.exec(second.stdout)?.[1];
  const third = await run(["ask", "Anything else?"], own);
  ok(third.stdout.includes(`<memory:${secondId}>`), third.stdout);
  ok(!third.stdout.includes(`<memory:${firstId}>`), third.stdout);
});

test("nothing in an answered transcript is score-shaped", async () => {
  /* The filename deliberately contains no score-shaped word: this test greps the WHOLE
     transcript, and the STORE line prints the path, so a store called "…-no-score.foliage"
     fails the test on its own name. That is the first thing this test caught. */
  const store = join(dir, "answers-plain-prose.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  await run(["declare", "notes", "tier1-local", "Notes about a thing."], own);
  const asked = await run(["ask", "What do I have?"], own);
  /* SCORE_SHAPED is exported from @foliage/leaf and refused by name everywhere else; here the
     surface is prose, so the check is on the rendered words a person actually reads. */
  for (const word of ["confidence", "score", "ranking", "percentile", "rating", "weight"]) {
    ok(!asked.stdout.toLowerCase().includes(word), `"${word}" appeared in the transcript`);
  }
});

/**
 * F-012 (.loop/FINDINGS.md) — the new state that reached one arm.
 *
 * Closing the hop gate on the escalated arm added `redirected` to `FireworksResult` and did not
 * add a case for it here, so a refused redirect printed "attempted — unknown state" and was filed
 * as `malformed-response` — which tells a person the provider sent nonsense, when what happened is
 * that we declined to deliver their material somewhere nobody accounted for. Shipped two hours
 * after the fix for "the guard landed on one arm only".
 *
 * Drives the REAL CLI against a REAL redirecting server, because the defect was in the seam's
 * switch and a unit test of the client would have stayed green through all of it.
 */
test("F-012: a redirect on the escalated arm is REFUSED in the transcript, not filed as unknown", async (t) => {
  const evil = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("{}"));
  });
  await new Promise<void>((r) => evil.listen(0, "127.0.0.1", () => r()));
  t.after(() => evil.close());
  const evilPort = (evil.address() as { port: number }).port;

  const decoy = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${evilPort}/v1/chat/completions` });
    res.end();
  });
  await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", () => r()));
  t.after(() => decoy.close());
  const decoyPort = (decoy.address() as { port: number }).port;

  await run(["declare", "hop-blurb", "tier3-shareable", "Migration: p99 840ms to 110ms."]);
  const asked = await run(["ask", "--as", "tier3-shareable", "Summarise this."], {
    FOLIAGE_COS_MAY_CROSS: "tier3-shareable",
    FOLIAGE_FIREWORKS_API_KEY: "test-only-not-a-real-credential",
    FOLIAGE_FIREWORKS_MODEL: "m",
    FOLIAGE_FIREWORKS_BASE_URL: `http://127.0.0.1:${decoyPort}`,
  });

  ok(asked.stdout.includes("REFUSED"), `a refused hop must say so:\n${asked.stdout}`);
  ok(
    !asked.stdout.includes("unknown state"),
    `the seam does not know this state — that is the defect:\n${asked.stdout}`,
  );
  ok(
    !asked.stdout.includes("attempted — malformed-response"),
    `a refused redirect is not the provider sending nonsense:\n${asked.stdout}`,
  );
});

/**
 * F-007 (.loop/FINDINGS.md) — every stored memory used to be injected into every later prompt,
 * uncapped, so the MEMORY section (and the prompt built from it) grew by one item per distinct
 * question forever. Driven through the REAL CLI against a REAL store: each `ask` below is a
 * DIFFERENT request, so `requestFingerprint` gives each its own lineage and none supersedes
 * another — the store accumulates one new live memory per call rather than replacing the last.
 *
 * ONE declared item is written first so the very first `ask` has something to rest on: with a
 * genuinely empty store `rememberTurn` writes nothing at all (`sources.length === 0`), which
 * would make this test about an unrelated branch instead of about the budget.
 *
 * The other half of the honesty claim — a mutation-proved gap, not a hypothetical: forcing
 * `cos.mjs`'s `if (budgeted.withheldByBudget > 0)` guard to `if (true)` still passed every test
 * in this file, because nothing here ever looked at an UNDER-budget transcript. This test now
 * keeps the SECOND call's own output too — early enough that the store is non-empty (so the
 * budgeted branch actually runs, unlike the very first call) and nowhere near the budget (so
 * `withheldByBudget` is legitimately 0) — and asserts the withheld line never appears in it.
 */
test("F-007: memories injected into a prompt are capped by an explicit budget, and the withheld count is said", async () => {
  const store = join(dir, "answers-memory-budget.foliage");
  const own = { FOLIAGE_COS_STORE: store };
  await run(["init"], own);
  await run(["declare", "seed-item", "tier1-local", "Something on file so a turn has material."], own);

  // The turn that WRITES memory N sees only the N-1 memories written before it (this call's own
  // memory is not readable until after it completes) — so MEMORY_INJECTION_BUDGET + 2 calls are
  // needed for the LAST call's own MEMORY section to see MEMORY_INJECTION_BUDGET + 1 live ones:
  // enough to prove the cap actually bites, with exactly one left over to report withheld.
  const total = MEMORY_INJECTION_BUDGET + 2;
  let underBudget: Run | undefined;
  let last: Run | undefined;
  for (let i = 0; i < total; i += 1) {
    const result = await run(["ask", `a distinct question, numbered ${i}, about nothing in particular`], own);
    // i === 1: the second call, which sees exactly ONE live memory (written by i === 0) — the
    // earliest point where the store is non-empty and the count is far under
    // MEMORY_INJECTION_BUDGET, so the honest transcript reports nothing withheld at all.
    if (i === 1) underBudget = result;
    last = result;
  }
  if (last === undefined) throw new Error("the loop above always runs at least once");
  if (underBudget === undefined) {
    throw new Error("the loop runs at least twice (MEMORY_INJECTION_BUDGET + 2 is at least 2)");
  }

  // Every line the MEMORY section prints for an INJECTED memory starts the line with the
  // "MEMORY" label and a bracketed id — the count-summary line below does not match this shape,
  // and neither do this same run's LOCAL MODEL / PROMPT lines, which start "PROMPT" instead.
  const injectedLines = last.stdout.match(/^MEMORY\s+<memory:[^>]+>/gm) ?? [];
  strictEqual(
    injectedLines.length,
    MEMORY_INJECTION_BUDGET,
    `expected exactly ${MEMORY_INJECTION_BUDGET} injected memories, the transcript:\n${last.stdout}`,
  );
  // A FAILURE IS NEVER A ZERO: exactly one memory was left out by the budget, and the transcript
  // says so BY COUNT rather than staying silent about it.
  ok(
    last.stdout.includes("1 memory withheld by budget"),
    `the transcript must report the withheld count:\n${last.stdout}`,
  );

  // THE OTHER HALF: a run nowhere near the budget must never say anything was withheld. Silence
  // when nothing was withheld is as much a part of this honesty claim as the count when
  // something was — a guard forced open (`if (true)`) prints this line unconditionally and
  // would only be caught by looking at an under-budget transcript, which the assertions above
  // never do.
  ok(
    !underBudget.stdout.includes("withheld by budget"),
    `an under-budget run must not claim anything was withheld by budget:\n${underBudget.stdout}`,
  );
});
