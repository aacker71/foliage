/** Synthetic cache contract inputs, never evidence of a customer publication. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readHostedStatus } from "./hostedStatus.ts";

test("hosting observation is bounded, subject-bound and dated; corrupt state never becomes public", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-status-contract-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "status.json");
  assert.equal((await readHostedStatus(path, "contract-input")).observation, null);
  const observed = { version: 1, origin: "https://status-contract.invalid", subjectId: "contract-input", observedAt: "2026-09-08T12:00:00Z", visible: true,
    revisionId: "00000000-0000-4000-8000-000000000001", generation: 1, documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}` };
  await writeFile(path, JSON.stringify(observed));
  assert.deepEqual((await readHostedStatus(path, "contract-input")).observation, observed);
  assert.equal((await readHostedStatus(path, "another-subject")).observation, null);
  for (const patch of [{ revisionId: "-".repeat(36) }, { observedAt: "unknown" }, { origin: "https://status-contract.invalid/path" }, { visible: false }, { policyDigest: null }, { generation: -1 }]) {
    await writeFile(path, JSON.stringify({ ...observed, ...patch }));
    const result = await readHostedStatus(path, "contract-input"); assert.equal(result.observation, null); assert.match(result.detail, /no status inferred/);
  }
  await writeFile(path, JSON.stringify({ ...observed, visible: false, revisionId: null, documentDigest: null, policyDigest: null, generation: 2 }));
  assert.equal((await readHostedStatus(path, "contract-input")).observation?.visible, false);
  await writeFile(path, JSON.stringify({ version: 1, origin: observed.origin, reason: "account-changed" }));
  const cleared = await readHostedStatus(path, "contract-input");
  assert.equal(cleared.observation, null); assert.match(cleared.detail, /account changed/);
  await writeFile(path, " ".repeat(17 * 1024)); assert.equal((await readHostedStatus(path, "contract-input")).observation, null);
});
