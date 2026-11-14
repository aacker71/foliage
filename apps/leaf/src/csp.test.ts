/**
 * THE TRANSPORT POLICY, checked on responses this server actually produced.
 *
 * WHY OVER REAL HTTP AND NOT AGAINST THE `csp()` FUNCTION. A header is only a policy if it is on
 * the response. Reading the string the function returns proves the string; it does not prove that
 * every branch of the request handler goes through `send()`, and the branches that skip it are
 * exactly the ones a review misses — a 405 written directly, a 403 on a bad font name, an asset
 * served from the allow-map, a redirect after a POST. So each response CLASS is fetched and its
 * headers are read off the wire.
 *
 * THE DIRECTIVE THIS FILE EXISTS FOR IS `frame-ancestors 'none'`.
 *
 * It does NOT inherit from `default-src`. `frame-ancestors`, `form-action`, `base-uri`,
 * `report-uri` and the navigation directives are all outside the fallback chain, so
 * `default-src 'none'` — which looks like the strictest possible policy — leaves framing wide
 * open. Before this landed the directive appeared ZERO times across `apps/` and `packages/`, so
 * every page this product serves could be framed by any page on the internet.
 *
 * What that buys an attacker here: an invisible cross-origin frame over `/review` with a
 * "click to continue" button positioned over Approve. The Origin/Sec-Fetch-Site check refuses
 * the resulting POST, so the frame could not have RECORDED anything — but that is the second
 * line, and it only holds while the first line's absence is understood. It also does not stop
 * the frame from READING the queue's rendered position to place the click, nor from displaying a
 * person's private leaf inside a page that claims it as its own.
 *
 * `form-action` is the one directive that varies, and it varies in the safe direction: the only
 * surface with a form is the only surface whose policy permits one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

/**
 * Boot the real server on an ephemeral port and answer requests against it.
 *
 * PORT 0 IS DELIBERATE. A fixed port makes a test suite that cannot run beside a dev server, and
 * worse, makes one that can silently assert against SOMEBODY ELSE'S process — which is the same
 * class of mistake as trusting a response without checking whose listener produced it. The port
 * is read back out of the server's own startup line.
 */
async function withServer(
  env: Readonly<Record<string, string>>,
  run: (get: (path: string, init?: RequestInit) => Promise<Response>, base: string) => Promise<void>,
): Promise<void> {
  // FOLIAGE_LOCAL_MODEL IS EMPTIED, whatever the operator's shell says: this test asks the run
  // route for a real stream, and the run it wants is the one that names no model — never one
  // that reaches an ambient runtime on this machine.
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FOLIAGE_LOCAL_MODEL: "", ...env, PORT: "0", HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (b) => (out += String(b)));
  child.stderr.on("data", (b) => (err += String(b)));

  try {
    const deadline = Date.now() + 15_000;
    let base = "";
    while (Date.now() < deadline) {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (m !== null) {
        base = `http://127.0.0.1:${m[1]}`;
        break;
      }
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // BOTH CAUSES, per the repo's error rule: ours (it never printed a listener) and the
    // underlying process's own words, which are the part that makes it fixable.
    assert.notEqual(
      base,
      "",
      `the leaf server never announced a listener. exit=${String(child.exitCode)}\n` +
        `--- its stdout ---\n${out}\n--- its stderr ---\n${err}`,
    );
    await run((path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init }), base);
  } finally {
    child.kill("SIGKILL");
  }
}

/** Split a policy into `directive -> value`, so an assertion names the directive it failed on. */
function directives(header: string | null): Map<string, string> {
  assert.ok(header !== null, "the response carried NO Content-Security-Policy at all");
  return new Map(
    header
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "")
      .map((d) => {
        const i = d.indexOf(" ");
        return i === -1 ? [d, ""] : [d.slice(0, i), d.slice(i + 1)];
      }),
  );
}

test(
  "EVERY response class carries the policy, and every one of them refuses to be framed",
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "leaf-csp-"));
    const leaf = join(dir, "leaf.json");
    // A real, minimal, VALID document — not a fixture standing in for evidence. This test is
    // about headers, and it needs the 200 branch to be the 200 branch.
    await writeFile(
      leaf,
      JSON.stringify({ id: "csp-leaf", subject: "Header Under Test", leaflets: [] }),
      "utf8",
    );

    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_HARVEST: join(dir, "absent.json") }, async (get, base) => {
      /** Every distinct way this server can answer. An unlisted class is an unchecked one. */
      const classes: readonly { what: string; path: string; init?: RequestInit; form: boolean }[] = [
        { what: "the leaf, populated", path: "/", form: false },
        { what: "a leaflet refusal", path: "/leaflet/nothing-here", form: false },
        { what: "the review queue", path: "/review", form: true },
        { what: "a package stylesheet", path: "/tokens.css", form: false },
        { what: "the role layer", path: "/roles.css", form: false },
        { what: "the component layer", path: "/foliage.css", form: false },
        { what: "this app's stylesheet", path: "/leaf.css", form: false },
        { what: "the favicon", path: "/mark-icon.svg", form: false },
        { what: "a font", path: "/fonts/jbmono-400.woff2", form: false },
        { what: "a forbidden font name", path: "/fonts/../secret.woff2", form: false },
        { what: "an unknown route", path: "/no-such-page", form: false },
        { what: "a HEAD request", path: "/", init: { method: "HEAD" }, form: false },
        { what: "a 405", path: "/", init: { method: "DELETE" }, form: false },
        {
          what: "a cross-site POST refusal",
          path: "/review",
          init: {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
            body: "id=x&decision=approve&by=someone",
          },
          form: false,
        },
        // THE RUN ROUTE, THREE WAYS: refused by method, refused by origin, and the real stream.
        // An event stream is a response like any other and carries the same headers — the
        // stream below is a genuine run against a server that names no model, so it opens,
        // says RUN_STARTED and RUN_ERROR, and closes, with every header this test checks.
        { what: "the run route, GET", path: "/scarlet/run", form: false },
        {
          what: "a cross-site run refusal",
          path: "/scarlet/run",
          init: { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" },
          form: false,
        },
        {
          what: "a real event stream",
          path: "/scarlet/run",
          init: {
            method: "POST",
            headers: { "content-type": "application/json", origin: base },
            body: JSON.stringify({
              threadId: "csp-thread",
              runId: "csp-run",
              messages: [{ id: "m1", role: "user", content: "what is here?" }],
            }),
          },
          form: false,
        },
        // THE SCARLET PAGE, THREE WAYS: the ask page, a same-origin POST refused for a blank
        // question (an HTML page at 400, form intact), and a cross-site POST refused by origin.
        { what: "the scarlet page", path: "/scarlet", form: true },
        {
          what: "a scarlet POST refusal (empty question)",
          path: "/scarlet",
          init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: "question=" },
          form: true,
        },
        {
          what: "a cross-site scarlet POST refusal",
          path: "/scarlet",
          init: {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
            body: "question=what+is+here",
          },
          form: false,
        },
      ];

      const expectedStatus: Readonly<Record<string, number>> = {
        "the run route, GET": 405,
        "a cross-site run refusal": 403,
        "a real event stream": 200,
        "the scarlet page": 200,
        "a scarlet POST refusal (empty question)": 400,
        "a cross-site scarlet POST refusal": 403,
      };

      for (const c of classes) {
        const res = await get(c.path, c.init);
        const expected = expectedStatus[c.what];
        if (expected !== undefined) assert.equal(res.status, expected, `${c.what}: not the class it claims to be`);
        if (c.what === "a real event stream") {
          assert.equal(res.headers.get("content-type"), "text/event-stream", `${c.what}: an SSE client reads only this`);
          assert.match(await res.text(), /^data: \{"type":"RUN_STARTED"/, `${c.what}: the first frame is RUN_STARTED`);
        }
        const csp = directives(res.headers.get("content-security-policy"));

        assert.equal(
          csp.get("frame-ancestors"),
          "'none'",
          `${c.what} (${res.status}) may be framed: frame-ancestors does NOT inherit from ` +
            `default-src, so this response has no framing policy at all`,
        );
        assert.equal(csp.get("default-src"), "'none'", `${c.what}: default-src must stay 'none'`);
        assert.equal(csp.get("base-uri"), "'none'", `${c.what}: base-uri must stay 'none'`);
        assert.equal(csp.get("style-src"), "'self'", `${c.what}: style-src must stay same-origin`);
        assert.equal(csp.get("img-src"), "'self'", `${c.what}: img-src must stay same-origin`);
        assert.equal(csp.get("font-src"), "'self'", `${c.what}: font-src must stay same-origin`);

        // NO SCRIPT MAY EVER BE PERMITTED. There is no script-src directive, so scripts fall back
        // to `default-src 'none'`. A script-src appearing here means the policy was widened, and
        // the design system's component layer is JavaScript-free precisely so it never has to be.
        assert.equal(csp.has("script-src"), false, `${c.what}: this product serves no JavaScript`);

        assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${c.what}`);
        assert.equal(res.headers.get("cache-control"), "no-store", `${c.what}`);
      }

      // THE ONE THING THAT VARIES, and it varies in the safe direction: the two surfaces with a
      // form are the only surfaces whose policy permits a submission. Widening it globally would
      // mean an injected form on the leaf page could post to this server.
      for (const c of classes) {
        const res = await get(c.path, c.init);
        const formAction = directives(res.headers.get("content-security-policy")).get("form-action");
        assert.equal(
          formAction,
          c.form ? "'self'" : "'none'",
          `${c.what}: form-action must be ${c.form ? "'self'" : "'none'"}`,
        );
      }
    });
  },
);

test(
  "the review page and the scarlet page are the ONLY pages that relax anything, and each relaxes exactly one thing",
  { timeout: 30_000 },
  async () => {
    // Stated as a difference rather than as two independent policies: a reader can see at a
    // glance that `/review` is not a second policy but the same one with one directive changed.
    // If a future edit relaxes something else for the form's sake, this fails naming it.
    const dir = await mkdtemp(join(tmpdir(), "leaf-csp-diff-"));
    const leaf = join(dir, "leaf.json");
    await writeFile(
      leaf,
      JSON.stringify({ id: "csp-leaf", subject: "Header Under Test", leaflets: [] }),
      "utf8",
    );

    await withServer({ FOLIAGE_LEAF: leaf, FOLIAGE_HARVEST: join(dir, "absent.json") }, async (get) => {
      const leafPolicy = directives((await get("/")).headers.get("content-security-policy"));
      for (const path of ["/review", "/scarlet"]) {
        const formPolicy = directives((await get(path)).headers.get("content-security-policy"));

        assert.deepEqual(
          [...formPolicy.keys()].sort(),
          [...leafPolicy.keys()].sort(),
          `${path}: the two policies must name the same directives`,
        );
        const differing = [...leafPolicy.keys()].filter(
          (k) => leafPolicy.get(k) !== formPolicy.get(k),
        );
        assert.deepEqual(
          differing,
          ["form-action"],
          `${path} may differ from every other page in form-action and nothing else`,
        );
      }

      // The referrer policy is the other per-response difference, and it is not cosmetic: a
      // non-CORS POST from a page whose policy is `no-referrer` gets `Origin: null`, which the
      // CSRF check correctly refuses — so the page carrying the form relaxes to `same-origin`,
      // which sends this server its own origin and still sends nothing to anyone else. This was
      // found in a real browser while every test stayed green.
      assert.equal((await get("/")).headers.get("referrer-policy"), "no-referrer");
      assert.equal((await get("/review")).headers.get("referrer-policy"), "same-origin");
      assert.equal((await get("/scarlet")).headers.get("referrer-policy"), "same-origin");
    });
  },
);
