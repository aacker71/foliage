/**
 * Tests for the Tier 3 client.
 *
 * READ THE TEST NAMES BEFORE READING THE GREEN. Every test that exercises a 200 runs against a
 * THROWAWAY LOCAL `node:http` SERVER on 127.0.0.1, and its name starts with `transport:` for
 * exactly one reason: **none of them are evidence that any model works.** They prove this file's
 * request bytes, its parsing, and its failure classification — the pipe, not the water. There is
 * no API key in this environment; the only end-to-end fact this suite establishes about the real
 * provider is the one in the first test, which is that we refuse to call it without a credential.
 *
 * The local server is not a mock of Fireworks and does not pretend to be one. It is an HTTP
 * endpoint that lets the test READ THE BYTES WE SENT — which is the only way to check `store:
 * false` is on the wire rather than in a comment — and hand back specific body shapes to see
 * which cause comes out. Where it returns a completion, the string is visibly the test's own
 * ("written by the test server, not a model"), so a reader skimming output cannot mistake it for
 * a model reply.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { inspectRedirect } from "./redirect.ts";
import test, { type TestContext } from "node:test";

import {
  callFireworks,
  fireworksConfigFromEnvironment,
  resolveFireworksConfig,
  type FireworksConfigResult,
  type FireworksRequest,
} from "./fireworks.ts";

const SOURCE_PATH = new URL("./fireworks.ts", import.meta.url);

const KEY = "test-only-not-a-real-credential";

const ASK: FireworksRequest = {
  messages: [
    { role: "system", content: "You are a chief of staff." },
    { role: "user", content: "Summarise what the router already decided may leave the machine." },
  ],
  maxTokens: 256,
  temperature: 0.2,
};

/** What the local server received, so a test can assert on the bytes rather than on intent. */
interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

type Handler = (captured: Captured, res: ServerResponse) => void;

/**
 * Start a throwaway server on an ephemeral port and return the base URL a config can point at.
 * Port 0 so nothing collides with a surface the operator is running — the "check the port is
 * free BEFORE binding" trap in AGENTS.md, avoided by never choosing a port at all.
 */
async function throwaway(t: TestContext, handler: Handler): Promise<string> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      handler(
        {
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        },
        res,
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function configured(baseUrl: string): FireworksConfigResult {
  return { state: "configured", config: { apiKey: KEY, baseUrl, model: "test/echo-server" } };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

/* ── The refusal this environment can actually demonstrate end to end ────────────────────── */

test("an empty environment refuses with no-credential, naming the variable — no call is made", async () => {
  const result = await callFireworks(ASK, resolveFireworksConfig({}));

  assert.equal(result.state, "no-credential");
  assert.ok(result.state === "no-credential");
  assert.deepEqual(result.missing, ["FOLIAGE_FIREWORKS_API_KEY", "FOLIAGE_FIREWORKS_MODEL"]);
  assert.deepEqual(result.ignored, []);
});

test("an AMBIENT FIREWORKS_API_KEY does not configure this client — it is refused and named", async () => {
  /* The provider's own SDK reads `FIREWORKS_API_KEY`, so it is plausibly already exported on the
     machine of exactly this product's user. If it configured the escalation path, someone's
     context would leave the machine on an account they never pointed at Foliage. Detect, report,
     refuse — the same rule as the redactor that must never quietly alter evidence. */
  const env = {
    FIREWORKS_API_KEY: "someone-elses-key-for-another-tool",
    FIREWORKS_MODEL: "accounts/example/models/example",
  };

  const result = await callFireworks(ASK, resolveFireworksConfig(env));

  assert.equal(result.state, "no-credential", "an ambient credential must never configure Foliage");
  assert.ok(result.state === "no-credential");
  assert.deepEqual(result.missing, ["FOLIAGE_FIREWORKS_API_KEY", "FOLIAGE_FIREWORKS_MODEL"]);
  assert.deepEqual(
    result.ignored,
    ["FIREWORKS_API_KEY", "FIREWORKS_MODEL"],
    "the refusal names what it saw and did not use, so 'I set it and nothing happened' is answerable",
  );
  assert.ok(!JSON.stringify(result).includes("someone-elses-key-for-another-tool"));
});

test("with no credential configured, the client says so rather than pretending", (t) => {
  /* Reads the REAL environment this suite runs in. This test used to `assert.fail` when a key was
     present, on the premise that "the provider path has never been exercised" — a claim that was
     true when it was written and STOPPED BEING TRUE on 2026-08-19, when the path was exercised
     live against accounts/fireworks/routers/kimi-k3-fast and the responses were recorded in
     docs/PRODUCT-ARCHITECTURE-SPEC.md §12. A guard whose premise has been retired should be
     retired with it, not left to fail every run on a correctly-configured machine.

     It skips rather than fails now, because a developer with a working credential is the normal
     case and a suite that cannot go green for them teaches people to ignore it. What it must
     never do is print the credential — see the note in cos.seam.test.ts. */
  const fromEnv = fireworksConfigFromEnvironment();

  if (fromEnv.state === "configured") {
    t.skip(
      "a credential is configured here, so the unconfigured path cannot be observed in this run. " +
        "Unset FOLIAGE_FIREWORKS_API_KEY to exercise it.",
    );
    return;
  }
  assert.ok(fromEnv.missing.includes("FOLIAGE_FIREWORKS_API_KEY"));
});

test("a credential without a model is no-model, not no-credential — the causes do not collapse", async () => {
  const result = await callFireworks(ASK, resolveFireworksConfig({ FOLIAGE_FIREWORKS_API_KEY: KEY }));

  assert.equal(result.state, "no-model");
  assert.ok(result.state === "no-model");
  assert.deepEqual(result.missing, ["FOLIAGE_FIREWORKS_MODEL"]);
});

test("a whitespace-only credential is absent, not a credential", () => {
  const result = resolveFireworksConfig({
    FOLIAGE_FIREWORKS_API_KEY: "   ",
    FOLIAGE_FIREWORKS_MODEL: "accounts/example/models/example",
  });

  assert.equal(result.state, "unconfigured");
  assert.ok(result.state === "unconfigured");
  assert.deepEqual(result.missing, ["FOLIAGE_FIREWORKS_API_KEY"]);
  assert.deepEqual(result.ignored, []);
});

test("the base URL defaults to the public endpoint and is overridable without editing code", () => {
  const withDefault = resolveFireworksConfig({
    FOLIAGE_FIREWORKS_API_KEY: KEY,
    FOLIAGE_FIREWORKS_MODEL: "m",
  });
  assert.ok(withDefault.state === "configured");
  assert.equal(withDefault.config.baseUrl, "https://api.fireworks.ai/inference/v1");

  const overridden = resolveFireworksConfig({
    FOLIAGE_FIREWORKS_API_KEY: KEY,
    FOLIAGE_FIREWORKS_MODEL: "m",
    FOLIAGE_FIREWORKS_BASE_URL: "http://127.0.0.1:9999/v1",
  });
  assert.ok(overridden.state === "configured");
  assert.equal(overridden.config.baseUrl, "http://127.0.0.1:9999/v1");
});

/* ── What goes on the wire (transport tests — the pipe, not the water) ───────────────────── */

test("transport: the request body carries store:false explicitly and NOTHING beyond five declared keys", async (t) => {
  let captured: Captured | null = null;
  const baseUrl = await throwaway(t, (c, res) => {
    captured = c;
    json(res, 200, {
      choices: [{ message: { content: "written by the test server, not a model" }, finish_reason: "stop" }],
    });
  });

  const result = await callFireworks(ASK, configured(baseUrl));
  assert.equal(result.state, "completed");

  assert.ok(captured !== null, "the server received no request");
  const sent = captured as Captured;
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, "/chat/completions");
  assert.equal(sent.headers["authorization"], `Bearer ${KEY}`);

  const body = JSON.parse(sent.body) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ["max_tokens", "messages", "model", "store", "temperature"],
    "an extra key on the wire is material this client was never handed",
  );
  assert.equal(body["store"], false);
  assert.equal(typeof body["store"], "boolean", "store must be the literal false, not a string");
  assert.equal(body["model"], "test/echo-server");
  assert.equal(body["max_tokens"], 256);
  assert.deepEqual(body["messages"], [
    { role: "system", content: "You are a chief of staff." },
    { role: "user", content: "Summarise what the router already decided may leave the machine." },
  ]);
});

test("transport: a well-formed body is parsed — this exercises OUR parser, not the provider", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    json(res, 200, {
      choices: [{ message: { content: "written by the test server, not a model" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    });
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "completed");
  assert.equal(result.completion, "written by the test server, not a model");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 7, totalTokens: 18 });
});

test("transport: a zero-length completion is a SUCCESS with an empty string, never an error", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    json(res, 200, { choices: [{ message: { content: "" }, finish_reason: "length" }] });
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.equal(result.state, "completed");
  assert.ok(result.state === "completed");
  assert.equal(result.completion, "");
  assert.equal(result.finishReason, "length");
});

test("transport: null content is a zero-length completion; absent content is malformed", async (t) => {
  const nullContent = await throwaway(t, (_c, res) => {
    json(res, 200, { choices: [{ message: { content: null }, finish_reason: "stop" }] });
  });
  const nulled = await callFireworks(ASK, configured(nullContent));
  assert.ok(nulled.state === "completed");
  assert.equal(nulled.completion, "");

  const noContent = await throwaway(t, (_c, res) => {
    json(res, 200, { choices: [{ message: { role: "assistant" } }] });
  });
  const absent = await callFireworks(ASK, configured(noContent));
  assert.ok(absent.state === "malformed-response");
  assert.match(absent.detail, /content is absent/);
});

test("transport: an empty choices array is malformed, and says so differently from an empty completion", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => json(res, 200, { choices: [] }));

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "malformed-response");
  assert.match(result.detail, /choices is empty/);
});

test("transport: a 200 that is not JSON is malformed-response, not a completion", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>gateway status page</html>");
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "malformed-response");
  assert.match(result.detail, /body is not JSON/);
});

/* ── The failure causes, each observed for real ──────────────────────────────────────────── */

test("transport: a non-2xx carries the status and the provider's OWN message, verbatim", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    json(res, 429, { error: { message: "rate limit exceeded for account", type: "rate_limit" } });
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "provider-refused");
  assert.equal(result.status, 429);
  assert.equal(result.providerMessage, "rate limit exceeded for account");
  assert.equal(result.providerMessageSource, "json-error-message");
});

test("transport: a non-2xx with a non-JSON body still refuses, and says the message came from the raw body", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream connect error");
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "provider-refused");
  assert.equal(result.status, 502);
  assert.equal(result.providerMessage, "upstream connect error");
  assert.equal(result.providerMessageSource, "raw-body");
});

test("transport: an over-long provider message is truncated, so an error page cannot become the result", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("x".repeat(5000));
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(result.state === "provider-refused");
  assert.equal(result.providerMessage.length, 601, "600 characters plus the ellipsis");
});

test("a server that never answers is a TIMEOUT, carrying our deadline — not network-unreachable", async (t) => {
  const baseUrl = await throwaway(t, () => {
    /* Deliberately never responds. The socket is open and healthy; only our deadline fires. */
  });

  const started = Date.now();
  const result = await callFireworks({ ...ASK, timeoutMs: 150 }, configured(baseUrl));
  const elapsed = Date.now() - started;

  assert.equal(result.state, "timeout", "an abort from our own deadline must not be reported as a dead network");
  assert.ok(result.state === "timeout");
  assert.equal(result.afterMs, 150);
  assert.ok(elapsed >= 140, `returned after ${elapsed}ms — the deadline did not actually elapse`);
});

test("a refused connection is NETWORK-UNREACHABLE, carrying the OS code — not a timeout", async () => {
  /* Bind an ephemeral port so the kernel gives us one that is genuinely free, note it, then
     release it. Nothing is listening there afterwards, so the connect fails at once with
     ECONNREFUSED — a different fact from the deadline above, and reported as a different cause.
     The alternative, a hard-coded "probably closed" port, is the guess AGENTS.md warns about. */
  const dead = `http://127.0.0.1:${await releasedPort()}`;

  const result = await callFireworks({ ...ASK, timeoutMs: 5000 }, configured(dead));

  assert.equal(result.state, "network-unreachable", "a refused connection must not be reported as a timeout");
  assert.ok(result.state === "network-unreachable");
  assert.match(result.detail, /ECONNREFUSED/);
  assert.match(result.detail, /while opening the connection/);
});

/** A port the kernel just handed us and we immediately gave back — free, and known to be free. */
async function releasedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server did not bind");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/* ── Structural claims, asserted against this file's own bytes ───────────────────────────── */

test("the client writes nothing anywhere — no logging of the prompt, the completion, or the credential", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of ["console", "stdout", "stderr", "writeFile", "appendFile"]) {
    assert.ok(
      !code.includes(forbidden),
      `${forbidden} appears in the client's code — the prompt, the completion and the credential must never be written anywhere`,
    );
  }
});

/**
 * The import surface, named rather than forbidden. Same change, same day, same reason as the twin
 * assertion in `localModel.test.ts` — which is itself the finding: two lanes independently wrote
 * "imports nothing" as a proxy for "reaches nothing", and the proxy blocked the one import that
 * makes both arms safer. `./redirect.ts` is the shared hop gate; refusing it here would have meant
 * duplicating the guard, and a duplicated guard is how F-002 came to be fixed on one arm only.
 */
const PERMITTED_IMPORTS = ["./redirect.ts"];

test("the client reads no file and imports only what is named here", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const specifiers = [...code.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const spec of specifiers) {
    assert.ok(
      PERMITTED_IMPORTS.includes(spec ?? ""),
      `${spec} is not in PERMITTED_IMPORTS — an SDK or a helper here widens the client's reach`,
    );
  }
  assert.ok(!code.includes("node:fs"), "the client must not read the credential from a file in the tree");
  assert.ok(!code.includes("require("), "no CommonJS require — zero third-party runtime dependencies");

  const shared = await readFile(new URL("./redirect.ts", import.meta.url), "utf8")
    .then((t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  assert.ok(!/^\s*import\s/m.test(shared), "./redirect.ts must import nothing, or this allow-list leaks");
  assert.ok(!shared.includes("node:"), "./redirect.ts must touch no node builtin");
});

test("the credential never appears in a returned result", async (t) => {
  const baseUrl = await throwaway(t, (_c, res) => {
    json(res, 401, { error: { message: "unauthorized" } });
  });

  const result = await callFireworks(ASK, configured(baseUrl));

  assert.ok(!JSON.stringify(result).includes(KEY), "the credential leaked into the result object");
});

/**
 * F-006 (.loop/FINDINGS.md) — the hop gate on the arm that was left open.
 *
 * F-002 was found on the LOCAL arm and fixed there. This arm had the identical exposure and no
 * guard for a day, with worse stakes: here the material is already assembled for the wire, so a
 * redirect hands it to a host that appears nowhere in the egress account the person was shown —
 * and `FOLIAGE_FIREWORKS_BASE_URL` is settable, so the hop need not come from the real provider.
 *
 * Two real servers, because the whole point is that undici follows a 307 and preserves the body.
 */
test("F-006: a 307 is refused, and the body does not reach the host it named", async (t) => {
  let stolen: string | null = null;
  const evil = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      stolen = body;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => evil.listen(0, "127.0.0.1", () => r()));
  t.after(() => evil.close());
  const evilPort = (evil.address() as { port: number }).port;

  const decoyBase = await throwaway(t, (_captured, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${evilPort}/v1/chat/completions` });
    res.end();
  });

  const result = await callFireworks(
    { messages: [{ role: "user", content: "material the policy admitted" }], maxTokens: 16, temperature: 0.2 },
    resolveFireworksConfig({
      FOLIAGE_FIREWORKS_API_KEY: KEY,
      FOLIAGE_FIREWORKS_MODEL: "m",
      FOLIAGE_FIREWORKS_BASE_URL: decoyBase,
    }),
  );

  assert.equal(result.state, "redirected", `a 307 must be refused, got ${result.state}`);
  assert.equal(stolen, null, "the redirect target received the body — the hop gate did not hold");
});

test("F-006: 304 and 305 are not treated as hops", () => {
  // Enumerated statuses, not a 3xx range: 304 is a cache hit and 305 is not followed by clients.
  // A range test would file a Not Modified as an attempted redirect.
  const notAHop = new Response(null, { status: 304 });
  assert.equal(inspectRedirect(notAHop, "http://127.0.0.1:1/x", 100), null);
  assert.equal(inspectRedirect(new Response(null, { status: 305 }), "http://127.0.0.1:1/x", 100), null);
  const hop = inspectRedirect(
    new Response(null, { status: 308, headers: { location: "http://evil.test/x" } }),
    "http://127.0.0.1:1/x",
    100,
  );
  assert.equal(hop?.host, "evil.test");
});
