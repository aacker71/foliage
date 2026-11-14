/**
 * `export.mjs`'s flag parsing, which used to be hand-rolled `argv.indexOf` and silently ignored
 * anything it did not recognise: `node apps/leaf/export.mjs --otu <dir>` left `--out` undefined
 * (a clean, if confusing, usage error) but a typo on a boolean like `--cofnirm` left the title
 * gate silently engaged with no diagnostic at all — on the one command that hands a portfolio to
 * someone else. It now goes through `node:util`'s `parseArgs({ strict: true })`, the same pattern
 * `intake.mjs` and `harvest.mjs` already use, so an unknown flag refuses by name instead of doing
 * nothing.
 *
 * Driven through the real CLI, exactly as a user runs it — the seam this pins is "a mistyped
 * flag is refused", which a unit test against a hand-extracted parsing function could not show
 * was ever wired to the argv the process actually receives.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const EXPORT_CLI = fileURLToPath(new URL("../export.mjs", import.meta.url));

const leafDoc = () =>
  JSON.stringify({
    id: "leaf:args",
    subject: "Export Args",
    leaflets: [],
  });

test("an unknown flag is REFUSED by name, not silently ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportargs-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(), "utf8");
    const out = join(dir, "site");
    const r = spawnSync(process.execPath, [EXPORT_CLI, "--out", out, "--confirn"], {
      encoding: "utf8",
      env: { ...process.env, FOLIAGE_LEAF: leafPath },
    });
    assert.notEqual(r.status, 0, "a mistyped flag must not exit clean");
    assert.match(r.stderr, /--confirn/, "the refusal must name the flag it did not recognise");
    assert.equal(existsSync(out), false, "nothing should be written when argv itself is refused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a mistyped --out is a clean usage error, not a silent no-op with an unclear cause", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportargs-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(), "utf8");
    const r = spawnSync(process.execPath, [EXPORT_CLI, "--otu", join(dir, "site")], {
      encoding: "utf8",
      env: { ...process.env, FOLIAGE_LEAF: leafPath },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--otu/, "an unrecognised flag must be named in the refusal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the recognised flags --out and --confirm still work exactly as before", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportargs-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(), "utf8");
    const out = join(dir, "site");
    const r = spawnSync(process.execPath, [EXPORT_CLI, "--out", out, "--confirm"], {
      encoding: "utf8",
      env: { ...process.env, FOLIAGE_LEAF: leafPath },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(out, "index.html")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
