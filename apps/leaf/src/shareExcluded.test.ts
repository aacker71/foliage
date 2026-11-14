/**
 * SHARE REFUSES AN EXCLUDED LEAFLET — QA #15, 2026-10-02.
 *
 * An excluded leaflet is work this leaf could not attribute to its subject: possibly somebody
 * else's. `foliage share <id> --as public` used to accept one with no warning, write
 * `"visibility": "public"` onto it, and print a `/leaflet/<id>` address that then answered 404 —
 * and `share list` counted it as "a working address". The publish rails already withhold it
 * (canopy's `unattributed-leaflet`, the export's `isSubjectsOwnWork` projection, the default
 * policy's `deny-excluded`), so nothing reached a reader; the CLI misinformed the person at both
 * ends instead. These tests pin the command to the same structural rule the rails use.
 *
 * Every test runs against a temp document it writes itself. Fixtures here are test scaffolding,
 * never product data, and everything is deleted afterwards.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { setVisibility, visibilityRows } from "./share.ts";

const SHARE = fileURLToPath(new URL("../share.mjs", import.meta.url));
const EXPORT = fileURLToPath(new URL("../export.mjs", import.meta.url));
const FOLIAGE = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const exec = promisify(execFile);

const OWN = "git:1111111111111111111111111111111111111111";
const OTHER = "git:2222222222222222222222222222222222222222";
const OWN_TITLE = "own work on the parser";
const OTHER_TITLE = "somebody else's commit";
/** The shape intake's `exclusionReason` writes — no address in it. */
const REASON =
  "could not be attributed to this subject: the author identity on commit 2222222 is not " +
  "among the declared identities.";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-share-excluded-"));
  tmpRoots.push(dir);
  return dir;
}

/** One pending leaflet that is the subject's own, one excluded one that is not. */
function leafDocument(otherVisibility?: "unlisted" | "public"): Record<string, unknown> {
  return {
    id: "leaf-share-excluded",
    subject: "A Real Person",
    leaflets: [
      {
        id: OWN,
        title: OWN_TITLE,
        tier: "pending",
        provenance: { source: "git", ref: OWN.slice(4), observedAt: "2026-10-01T00:00:00.000Z" },
      },
      {
        id: OTHER,
        title: OTHER_TITLE,
        tier: "excluded",
        reason: REASON,
        provenance: { source: "git", ref: OTHER.slice(4), observedAt: "2026-10-01T00:00:00.000Z" },
        ...(otherVisibility === undefined ? {} : { visibility: otherVisibility }),
      },
    ],
  };
}

async function writeLeaf(dir: string, otherVisibility?: "unlisted" | "public"): Promise<string> {
  const path = join(dir, "leaf.json");
  await writeFile(path, `${JSON.stringify(leafDocument(otherVisibility), null, 2)}\n`, "utf8");
  return path;
}

/** An environment with no ambient garden, leaf, harvest or policy — every path is passed. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY"]) delete env[key];
  return { ...env, ...extra };
}

/** Run a real CLI. Never throws on a non-zero exit — the exit code is part of the contract. */
async function run(
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = cleanEnv(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [script, ...args], { timeout: 30_000, env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/* ------------------------------------------------------------------- the transformation ---- */

test("setVisibility refuses to make an excluded leaflet shareable, BY NAME, carrying its reason", () => {
  for (const to of ["unlisted", "public"] as const) {
    const raw = leafDocument();
    const snapshot = JSON.stringify(raw);
    const out = setVisibility(raw, OTHER, to);
    assert.equal(out.ok, false, `--as ${to} was accepted for somebody else's work`);
    if (out.ok) return;
    assert.equal(out.cause, "excluded");
    if (out.cause !== "excluded") return;
    assert.equal(out.id, OTHER);
    assert.equal(out.reason, REASON, "the refusal must carry the reason the leaflet already has");
    assert.equal(JSON.stringify(raw), snapshot, "a refusal mutated its input");
  }
});

test("making an excluded leaflet MORE private is always allowed — unsharing is never refused", () => {
  // Already private: a success that changed nothing.
  const noop = setVisibility(leafDocument(), OTHER, null);
  assert.equal(noop.ok, true);
  if (!noop.ok) return;
  assert.equal(noop.changed, false);

  // A document written before this refusal existed can carry a shared excluded leaflet; the
  // person must be able to take that back.
  const legacy = setVisibility(leafDocument("public"), OTHER, null);
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.equal(legacy.changed, true);
  assert.equal(legacy.from, "public");
  assert.equal(legacy.to, "private");
});

test("an excluded leaflet never counts as shared, even when its document says public", () => {
  const rows = visibilityRows(leafDocument("public"));
  assert.equal(rows.ok, true);
  if (!rows.ok) return;
  const other = rows.rows.find((r) => r.id === OTHER);
  assert.ok(other !== undefined);
  assert.equal(other.shared, false, "an excluded leaflet was reported as having a working address");
  assert.equal(other.stated, "public", "what the document states must still be reported");
  assert.equal(other.excludedReason, REASON);
  const own = rows.rows.find((r) => r.id === OWN);
  assert.equal(own !== undefined && "excludedReason" in own, false);
});

/* ------------------------------------------------------------------------ the CLI on disk ---- */

test("CLI: `share <excluded> --as public` is refused, prints the reason, and leaves the file byte-identical", async () => {
  for (const asked of [["--as", "public"], ["--as", "unlisted"], []] as const) {
    const dir = await tempDir();
    const path = await writeLeaf(dir);
    const before = await readFile(path);

    const out = await run(SHARE, ["share", OTHER, ...asked, "--leaf", path]);
    assert.notEqual(out.code, 0, `share ${asked.join(" ")} of an excluded leaflet exited 0`);
    assert.equal(out.code, 1, "a refusal of a real request is a failure, not a usage error");
    assert.equal(out.stderr, `share: Not shared · excluded: ${REASON}\n`);
    assert.doesNotMatch(out.stdout, /\/leaflet\//u, "an address was printed for a leaflet that will not be served");
    assert.doesNotMatch(out.stdout, /wrote /u);
    assert.deepEqual(await readFile(path), before, "a refused share changed the document on disk");
  }
});

test("CLI: the `foliage share` front door refuses the same way (the QA repro, verbatim)", async () => {
  const garden = await tempDir();
  const path = await writeLeaf(garden);
  const before = await readFile(path);

  const out = await run(FOLIAGE, ["share", OTHER, "--as", "public", "--garden", garden]);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /share: Not shared · excluded: could not be attributed to this subject/u);
  assert.doesNotMatch(out.stdout, /\/leaflet\//u);
  assert.deepEqual(await readFile(path), before);
});

test("CLI: a pending leaflet — the subject's own work — still shares, with its address", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);

  const out = await run(SHARE, ["share", OWN, "--as", "public", "--leaf", path]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /private → public/u);
  assert.match(out.stdout, new RegExp(`/leaflet/${encodeURIComponent(OWN)}`, "u"));

  const after = JSON.parse(await readFile(path, "utf8")) as { leaflets: Record<string, unknown>[] };
  assert.equal(after.leaflets[0]?.["visibility"], "public");
  assert.equal("visibility" in (after.leaflets[1] as object), false, "the excluded sibling moved");
});

test("CLI: `unshare` of a shared excluded leaflet (an older document) is allowed and clears it", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir, "public");

  const out = await run(SHARE, ["unshare", OTHER, "--leaf", path]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /public → private/u);
  const after = JSON.parse(await readFile(path, "utf8")) as { leaflets: Record<string, unknown>[] };
  assert.equal("visibility" in (after.leaflets[1] as object), false);
});

test("CLI: `list` prints no address for an excluded leaflet and does not count it", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir, "public");

  const out = await run(SHARE, ["list", "--leaf", path]);
  assert.equal(out.code, 0, out.stderr);
  assert.doesNotMatch(out.stdout, new RegExp(`/leaflet/${encodeURIComponent(OTHER)}`, "u"));
  assert.match(out.stdout, new RegExp(`${OTHER} {2}— {2}public · not shared · excluded\\n`, "u"));
  assert.match(out.stdout, /0 of 2 leaflet\(s\) have a working address/u);
});

/* ------------------------------------------------------------------------------ the export ---- */

test("export: an excluded leaflet marked public never crosses, even under a policy with no deny-excluded rule", async () => {
  const dir = await tempDir();
  const leafPath = join(dir, "leaf.json");
  const doc = leafDocument("public");
  // The subject's own leaflet is public too, so the export has something to carry and the
  // absence of the other one is a decision, not an empty page.
  const leaflets = doc["leaflets"] as Record<string, unknown>[];
  leaflets[0] = { ...leaflets[0], visibility: "public" };
  await writeFile(leafPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  // An EMPTY policy: nothing is denied by rule, so only the structural attribution check can
  // keep the excluded leaflet out. That is the check this test is about.
  const policyPath = join(dir, "policy.json");
  await writeFile(policyPath, `${JSON.stringify({ rules: [] })}\n`, "utf8");
  const outDir = join(dir, "site");

  const out = await run(EXPORT, ["--out", outDir], cleanEnv({ FOLIAGE_LEAF: leafPath, FOLIAGE_POLICY: policyPath }));
  assert.equal(out.code, 0, out.stderr);
  const html = await readFile(join(outDir, "index.html"), "utf8");
  assert.ok(html.includes(OWN_TITLE), "the subject's own public leaflet did not reach the export");
  assert.equal(html.includes("somebody else"), false, "an excluded leaflet's title reached the export");
  assert.equal(html.includes(OTHER.slice(4, 11)), false, "an excluded leaflet's ref reached the export");
  assert.match(out.stdout, /export: 1 leaflet\(s\) for A Real Person/u);
});
