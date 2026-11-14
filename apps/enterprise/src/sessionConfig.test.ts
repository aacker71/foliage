import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../server.mjs", import.meta.url));
function refused(overrides: Record<string, string | undefined>, message: RegExp) {
  const result = spawnSync(process.execPath, [server], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "4195", FOLIAGE_ACTOR: undefined, ...overrides },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, message);
}
test("enterprise startup never assumes company authority", () => {
  for (const role of [undefined, "", "admin", "policy_owne"]) {
    refused({ FOLIAGE_ACTOR: role }, /No role was assumed/);
  }
});
test("unauthenticated enterprise workspace refuses a public bind", () => {
  refused({ HOST: "0.0.0.0", FOLIAGE_ACTOR: "policy_owner" }, /may bind only/);
});
test("enterprise startup explains invalid ports", () => {
  for (const port of ["0", "65536", "NaN"]) {
    refused({ PORT: port, FOLIAGE_ACTOR: "subject" }, /PORT must be an integer/);
  }
});
