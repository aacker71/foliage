import assert from "node:assert/strict";
import { test } from "node:test";
import { boundAuthorities } from "./boundAuthorities.ts";

test("a loopback bind answers to the three loopback names on the bound port, and nothing else", () => {
  assert.deepEqual(boundAuthorities({ address: "127.0.0.1", port: 4174 }, 9), ["127.0.0.1:4174", "localhost:4174", "[::1]:4174"]);
  assert.deepEqual(boundAuthorities({ address: "::1", port: 4174 }, 9), ["127.0.0.1:4174", "localhost:4174", "[::1]:4174"]);
});

test("a specific interface is added in Host form; a wildcard identifies none, so adds nothing", () => {
  assert.ok(boundAuthorities({ address: "192.168.1.20", port: 4173 }, 0).includes("192.168.1.20:4173"));
  assert.ok(boundAuthorities({ address: "FE80::1", port: 4173 }, 0).includes("[fe80::1]:4173"));
  for (const address of ["0.0.0.0", "::", "::ffff:0.0.0.0"]) {
    assert.deepEqual(boundAuthorities({ address, port: 4173 }, 0), ["127.0.0.1:4173", "localhost:4173", "[::1]:4173"], address);
  }
});

test("the port comes from the socket; the fallback only before it listens; :80 has both forms", () => {
  assert.deepEqual(boundAuthorities(null, 4176), ["127.0.0.1:4176", "localhost:4176", "[::1]:4176"]);
  assert.deepEqual(boundAuthorities("/tmp/leaf.sock", 4176), ["127.0.0.1:4176", "localhost:4176", "[::1]:4176"]);
  assert.deepEqual(boundAuthorities({ address: "127.0.0.1", port: 80 }, 0), ["127.0.0.1", "127.0.0.1:80", "localhost", "localhost:80", "[::1]", "[::1]:80"]);
  assert.equal(boundAuthorities({ address: "127.0.0.1", port: 4330 }, 0).includes("foo.example:4330"), false);
});
