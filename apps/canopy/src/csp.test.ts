/** Real HTTP coverage of public readers, assets, error responses and Host refusals.
 * Every response uses the same strict CSP, including retired mock-page addresses.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

const BOOT_DEADLINE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Every directive the strict policy must carry, checked individually so a diff names the gap. */
const STRICT = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => reject(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => resolve(port));
    });
  });
}

interface Response {
  readonly status: number;
  readonly csp: string;
  /** `x-robots-tag` — a public page that is readable is not therefore findable. */
  readonly robots: string;
  /** The whole body, because a refusal is only a refusal if the document is not in it. */
  readonly body: string;
}

/**
 * A request whose HEADERS ARE SENT VERBATIM, which `fetch` cannot do.
 *
 * `Host` is a forbidden header name in the Fetch standard, and undici honours that: measured on
 * Node 22.23.1, `fetch(url, { headers: { host: "evil.com:PORT" } })` reaches the server with
 * `Host: 127.0.0.1:PORT` — the header is dropped without an error. A test for the rebinding
 * refusal written on `fetch` therefore passes against a server with no refusal in it at all, which
 * is the worst kind of green. So the attacker's request is spoken over `node:http`, where
 * `headers.host` (and `setHost: false`, for the HTTP/1.0 case with no Host at all) go out as
 * written.
 */
function speak(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = "GET",
  setHost = true,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers, setHost, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            csp: String(res.headers["content-security-policy"] ?? ""),
            robots: String(res.headers["x-robots-tag"] ?? ""),
            body,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer within ${REQUEST_TIMEOUT_MS}ms`)));
    req.on("error", reject);
    req.end();
  });
}

interface Live {
  /** The ordinary path: same-origin `fetch`, which is what a browser on this machine does. */
  readonly get: (p: string, m?: string) => Promise<Response>;
  /** The hostile path: headers on the wire exactly as given. */
  readonly speak: (p: string, headers: Record<string, string>, m?: string, setHost?: boolean) => Promise<Response>;
  readonly port: number;
}

/**
 * Start the REAL server, hand it to `body`, and always kill it.
 *
 * `method` is a parameter because the 405 path answers before any routing happens and cannot be
 * reached with a GET at all.
 */
async function withServer(body: (live: Live) => Promise<void>) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    // No FOLIAGE_TREE on purpose: `unconfigured` still renders a page, and a header that only
    // appeared once a manifest was configured would be a header that is absent on a fresh install.
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", FOLIAGE_TREE: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  let exited: string | null = null;
  child.on("exit", (code, signal) => {
    exited = `exit code ${String(code)} signal ${String(signal)}`;
  });

  const origin = `http://127.0.0.1:${port}`;
  const get = async (path: string, method = "GET"): Promise<Response> => {
    const res = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      status: res.status,
      csp: res.headers.get("content-security-policy") ?? "",
      robots: res.headers.get("x-robots-tag") ?? "",
      body: await res.text(),
    };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}\nstderr:\n${stderr}`,
        );
      }
      try {
        await get("/tree");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({
      get,
      speak: (p, headers, m, setHost) => speak(port, p, headers, m, setHost),
      port,
    });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

test("EVERY response class carries a policy, and every one of them refuses to be framed", async () => {
  await withServer(async ({ get }) => {
    const cases: ReadonlyArray<readonly [string, string, number]> = [
      ["the public front door", "/", 200],
      ["the real-data route", "/tree", 200],
      ["an app stylesheet", "/tree.css", 200],
      ["portfolio composition", "/portfolio.css", 200],
      ["a package stylesheet", "/foliage.css", 200],
      ["the package sprite", "/foliage-sprite.svg", 200],
      ["a package font", "/fonts/jbmono-400.woff2", 200],
      ["a 404", "/there-is-no-such-file", 404],
      /*
       * A traversal attempt, which answers 404 and not 403 — and that is worth recording rather
       * than asserting around. `safePath` decodes (`%2e%2e` survives a naive string check),
       * strips a leading `../`, and RESOLVES before comparing against ROOT. By the time the
       * containment check runs, `/../../package.json` has already normalised to `/package.json`
       * inside ROOT, so it is simply a file that is not there.
       *
       * The 403 branch is therefore defence in depth that no wire-format request in this run
       * reached, and this case does not pretend otherwise. What it does check is the part that
       * matters: the attempt does not escape, and the response still carries the policy.
       */
      ["a traversal attempt", "/%2e%2e/%2e%2e/package.json", 404],
    ];

    for (const [what, path, status] of cases) {
      const res = await get(path);
      assert.equal(res.status, status, `${what} (${path}) answered ${res.status}`);
      assert.ok(
        res.csp.includes("frame-ancestors 'none'"),
        `${what} (${path}) carries no frame-ancestors, so it can be framed by any origin. ` +
          `frame-ancestors does NOT inherit from default-src. Header was: ${res.csp || "(absent)"}`,
      );
      assert.ok(
        res.csp.includes("default-src 'none'"),
        `${what} (${path}) does not deny by default. Header was: ${res.csp || "(absent)"}`,
      );
      /*
       * AND IT IS NOT FINDABLE. Asserted in the same loop as the policy, and for the same reason
       * that loop exists: the header comes from ONE function taking a pathname, so the only way a
       * response class can lose it is if somebody adds a code path that does not ask — which is
       * exactly what a per-class sweep catches and a single spot-check does not.
       *
       * Measured absent 2026-09-04 (`grep -rni "robots|noindex" apps/canopy packages/canopy`
       * returned nothing), so a canopy served anywhere but loopback was fully crawlable. The
       * default is asymmetric — listed→unlisted does not survive a crawler's cache — and this
       * header is explicitly NOT the gated discovery decision: SYSTEM-ARCHITECTURE.md §7 item E
       * says it "must not wait for it".
       */
      assert.equal(
        res.robots,
        "noindex, noarchive, nosnippet, noimageindex",
        `${what} (${path}) is indexable. Header was: ${res.robots || "(absent)"}`,
      );
    }

    // The method refusal returns before routing, so it is its own code path and its own case.
    const post = await get("/tree", "POST");
    assert.equal(post.status, 405);
    assert.ok(
      post.csp.includes("frame-ancestors 'none'"),
      `the 405 path carries no policy: ${post.csp || "(absent)"}`,
    );
    assert.equal(
      post.robots,
      "noindex, noarchive, nosnippet, noimageindex",
      `the 405 path is indexable: ${post.robots || "(absent)"}`,
    );
  });
});

test("the real surface and every asset get the STRICT policy — nothing executes on them", async () => {
  await withServer(async ({ get }) => {
    for (const path of ["/", "/tree", "/tree.css", "/foliage.css", "/foliage-sprite.svg"]) {
      const res = await get(path);
      for (const directive of STRICT) {
        assert.ok(
          res.csp.includes(directive),
          `${path} is missing "${directive}". Header was: ${res.csp || "(absent)"}`,
        );
      }
      assert.doesNotMatch(res.csp, /unsafe-inline/, path);
      // The point of the strict policy: no script may run, from any source, inline or not.
      assert.equal(
        /script-src/.test(res.csp),
        false,
        `${path} names script-src, which means something on the real surface is executing. ` +
          `The CSP for real data is default-src 'none' with no script-src, and it is not ` +
          `being widened. Header was: ${res.csp}`,
      );
    }
  });
});

test("retired mock pages return 404 under the strict policy", async () => {
  await withServer(async ({ get }) => {
    for (const path of [
      "/canopy-public-canopy.html", "/canopy-public-leaf.html", "/canopy-public-tree.html",
      "/canopy-system.html", "/enterprise-leaf-list.html", "/enterprise-release-review.html",
    ]) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      for (const directive of STRICT) assert.ok(response.csp.includes(directive), `${path}: ${directive}`);
      assert.doesNotMatch(response.csp, /unsafe-inline|script-src/, path);
    }
  });
});

/**
 * DNS REBINDING, spoken at a real running server, with the attacker's exact headers on the wire.
 *
 * The request built below is not a caricature — it is byte-for-byte what a browser sends after a
 * page on `evil.example` has had that name re-resolved to 127.0.0.1: `Host: evil.example:<port>`,
 * `Origin: http://evil.example:<port>`, `Sec-Fetch-Site: same-origin`. Every same-origin guard
 * written against `Origin` vs `Host` PASSES this request, because both sides of that comparison
 * come from the attacker and they agree. The reviewer who reproduced it on the leaf server got a
 * 200 carrying 741,653 bytes of somebody's private accounting.
 *
 * So the assertion is not only the status. It is that the DOCUMENT IS NOT IN THE BODY — a 421 that
 * still wrote the page would be a refusal in the status line and a leak everywhere else.
 */
test("a rebound Host is refused 421 before routing, and no document bytes come back", async () => {
  await withServer(async ({ speak, port }) => {
    // The control. Without it a 421 proves nothing: a route that serves nothing to anybody would
    // pass every assertion below.
    const honest = await speak("/tree", { Host: `127.0.0.1:${port}` });
    assert.equal(honest.status, 200, "the route under attack does not serve to a correct Host");
    assert.ok(
      honest.body.includes("<html") && honest.body.length > 1_000,
      `the control served ${honest.body.length} bytes and no <html>, so "nothing leaked" below ` +
        `would be measuring an empty route rather than a refusal`,
    );

    const rebound = {
      Host: `evil.example:${port}`,
      Origin: `http://evil.example:${port}`,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };

    /*
     * EVERY method and every class of route, because the refusal is only worth anything if it sits
     * in front of all of them. `/leaf/<id>` is the one that matters most: its whole contract is
     * that only PUBLISHED work appears on it, and a reader who can rebind is a reader the server
     * has no other way to recognise. POST is here to prove the check precedes the method refusal —
     * a 405 would mean routing decisions are being made for a request that was never ours.
     */
    const attacked: ReadonlyArray<readonly [string, string, string]> = [
      ["the public front door", "/", "GET"],
      ["the real-data route", "/tree", "GET"],
      ["a person's published page", "/leaf/anyone", "GET"],
      ["one published artifact", "/leaflet/git%3Aabc", "GET"],
      ["a static asset", "/tree.css", "GET"],
      ["a 404", "/there-is-no-such-file", "GET"],
      ["a HEAD", "/tree", "HEAD"],
      ["a POST, which must not reach the 405", "/tree", "POST"],
    ];

    for (const [what, path, method] of attacked) {
      const res = await speak(path, rebound, method);
      assert.equal(
        res.status,
        421,
        `${what} (${method} ${path}) answered ${res.status} to a rebound Host. Origin and Host ` +
          `AGREE in this request — both are the attacker's — so nothing but the bound socket can ` +
          `tell them apart.`,
      );
      for (const leak of ["<html", "<!doctype", "<body", "leaflet", "foliage-tokens.css"]) {
        assert.equal(
          res.body.toLowerCase().includes(leak),
          false,
          `${what} (${method} ${path}) answered 421 and then served "${leak}" anyway — the ` +
            `status refused, the body did not. Body was:\n${res.body}`,
        );
      }
      // The cause is named. A bare 421 tells the operator who bound a wildcard nothing at all.
      if (method !== "HEAD") {
        assert.ok(
          res.body.includes("misdirected") && res.body.includes("Host"),
          `${what} refused without naming the cause: ${res.body || "(empty)"}`,
        );
      }
      // The refusal is a response like any other, so it carries the policy like any other.
      assert.ok(
        res.csp.includes("frame-ancestors 'none'"),
        `the 421 carries no policy: ${res.csp || "(absent)"}`,
      );
      /*
       * AND THE ROBOTS HEADER, because this refusal is its own `writeHead` — the same shape that
       * hid F-033 on the published-artifact branch, which also had its own call site and therefore
       * its own chance to forget. Latent rather than live today, since `publicHeaders()` is
       * single-sourced and this path spreads it; asserted anyway, because "it happens to spread the
       * shared object right now" is what was true of the other call site until it wasn't.
       */
      assert.equal(
        res.robots,
        "noindex, noarchive, nosnippet, noimageindex",
        `the 421 refusal is indexable: ${res.robots || "(absent)"}`,
      );
    }

    /*
     * NO HOST AT ALL, and the answer is 400 rather than the 421 the handler would give — recorded
     * rather than asserted around. HTTP/1.1 requires Host, so Node's parser refuses the request
     * before any JavaScript in server.mjs runs and the `authority === ""` branch is never reached
     * from the wire. That branch is therefore defence in depth (a future HTTP/1.0 or h2 path could
     * reach it), and this case checks the property that actually matters either way: absent is not
     * treated as "same as ours", and nothing is served.
     */
    const headless = await speak("/tree", {}, "GET", false);
    assert.equal(headless.status, 400, "a request with no Host header was not refused");
    assert.equal(headless.body.includes("<html"), false, "the no-Host request got the document");

    /*
     * AND THE ALLOW-LIST IS NOT SO TIGHT IT BREAKS THE PRODUCT. These are the authorities a person
     * on this machine actually types, including the IPv6 loopback and a shouted hostname — Host is
     * case-insensitive in its name portion, and a check that missed that would refuse a real user.
     */
    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `LOCALHOST:${port}`,
      `[::1]:${port}`,
    ]) {
      const res = await speak("/tree", { Host: host });
      assert.equal(res.status, 200, `Host: ${host} is a real way to reach this server, refused`);
    }

    // Right name, wrong port: the authority is compared whole, not by hostname.
    const wrongPort = await speak("/tree", { Host: `127.0.0.1:${port === 1 ? 2 : 1}` });
    assert.equal(wrongPort.status, 421, "only the hostname is being compared, not the port");
  });
});


test("the injected mark uses a class rather than a CSP-blocked inline style", async () => {
  await withServer(async ({ get }) => {
    const response = await get("/");
    assert.match(response.body, /class="fol-sprite"/);
    assert.doesNotMatch(response.body, /style="position:absolute"/);
  });
});
