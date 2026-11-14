/**
 * PHOTOS GO INTO THE GARDEN — QA #24, as real child processes.
 *
 * THE DEFECT: `node apps/leaf/harvest.mjs propose-photos --dir <photos> --out <garden>/harvest.json`
 * wrote the candidates into the garden and the captured image bytes into the CHECKOUT
 * (`apps/leaf/media`), because the store root fell back to "beside the default leaf inside the
 * app" whenever FOLIAGE_MEDIA and FOLIAGE_LEAF were unset. `foliage up --garden <garden>` then
 * served `<garden>/media`, which held nothing, so every photo leaflet answered 404. And the
 * launcher had no way to run a photo harvest at all.
 *
 * THE FIXTURES ARE TEST CONSTRUCTION. Two solid-colour PNGs written by the encoder below, with a
 * per-run random tint so their digests are new on every run — not photographs, not evidence, and
 * nothing drafted from them means anything about anybody. The random tint is what makes "nothing
 * landed in the checkout" checkable without listing a directory other tests may share.
 *
 * Every child runs with FOLIAGE_GARDEN/LEAF/HARVEST/POLICY/MEDIA/WORKFLOW_DIR removed, so the
 * only thing telling it where the garden is, is the command line under test.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { mediaObjectDir } from "./mediaStore.ts";

const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
/** Where the store used to land with nothing configured: beside the default leaf, in the app. */
const CHECKOUT_MEDIA = fileURLToPath(new URL("../media", import.meta.url));

const RUN_TIMEOUT_MS = 60_000;

const roots: string[] = [];
after(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-photo-garden-"));
  roots.push(dir);
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- fixture PNG encoder ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A FIXTURE PNG: 8-bit truecolour, one tinted ramp. */
function fixturePng(width: number, height: number, tint: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = (tint + x) % 256;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** Two fixture images in a fresh directory, and the SHA-256 of each. */
async function fixturePhotos(): Promise<{ dir: string; digests: readonly string[] }> {
  const dir = join(await tempDir(), "fixture-photos");
  await mkdir(dir);
  const tint = randomBytes(1)[0] ?? 0;
  const files = [fixturePng(40, 30, tint), fixturePng(20, 10, (tint + 97) % 256)];
  const digests: string[] = [];
  for (const [i, bytes] of files.entries()) {
    await writeFile(join(dir, `fixture-${i + 1}.png`), bytes);
    digests.push(createHash("sha256").update(bytes).digest("hex"));
  }
  return { dir, digests };
}

/* ------------------------------------------------------------------- running ---- */

const GARDEN_VARIABLES = [
  "FOLIAGE_GARDEN",
  "FOLIAGE_LEAF",
  "FOLIAGE_HARVEST",
  "FOLIAGE_POLICY",
  "FOLIAGE_MEDIA",
  "FOLIAGE_WORKFLOW_DIR",
];

function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NO_COLOR: "1" };
  for (const name of GARDEN_VARIABLES) delete env[name];
  return env;
}

interface Run {
  readonly code: number | string;
  readonly output: string;
}

function run(script: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env },
      (err, stdout, stderr) => resolve({ code: err === null ? 0 : (err.code ?? 1), output: `${stdout}${stderr}` }),
    );
  });
}

interface PhotoCandidate {
  readonly id: string;
  readonly review: { readonly state: string };
  readonly media?: readonly { readonly ref: string }[];
}

async function photoCandidates(harvestPath: string): Promise<readonly PhotoCandidate[]> {
  const doc = JSON.parse(await readFile(harvestPath, "utf8")) as { candidates: PhotoCandidate[] };
  return doc.candidates.filter((c) => c.id.startsWith("photo:"));
}

/** The garden holds both objects, and the checkout holds neither. */
async function assertStoredInGardenOnly(garden: string, digests: readonly string[]): Promise<void> {
  assert.ok(await exists(join(garden, "media", ".gitignore")), "the garden's store must ignore itself");
  for (const digest of digests) {
    assert.ok(
      await exists(join(mediaObjectDir(join(garden, "media"), digest), "manifest.json")),
      `fixture ${digest.slice(0, 12)} must be stored under the garden`,
    );
    assert.equal(
      await exists(mediaObjectDir(CHECKOUT_MEDIA, digest)),
      false,
      `fixture ${digest.slice(0, 12)} must not be stored in the checkout`,
    );
  }
}

async function assertCandidates(harvestPath: string, digests: readonly string[]): Promise<void> {
  const candidates = await photoCandidates(harvestPath);
  assert.deepEqual(
    candidates.map((c) => c.media?.[0]?.ref).sort(),
    digests.map((d) => `sha256:${d}`).sort(),
    "one candidate per fixture, each carrying its image",
  );
  for (const c of candidates) assert.equal(c.review.state, "candidate");
}

/* --------------------------------------------------------------------- tests ---- */

test("propose-photos --out <garden>/harvest.json captures the images into <garden>/media", { timeout: 90_000 }, async () => {
  const photos = await fixturePhotos();
  const garden = join(await tempDir(), "garden");
  await mkdir(garden);
  const harvest = join(garden, "harvest.json");

  const result = await run(
    HARVEST_CLI,
    ["propose-photos", "--dir", photos.dir, "--out", harvest],
    cleanEnv(await tempDir()),
  );

  assert.equal(result.code, 0, result.output);
  assert.ok(
    result.output.includes(`2 image(s) captured into ${join(garden, "media")}`),
    `the report must name the garden's store:\n${result.output}`,
  );
  await assertCandidates(harvest, photos.digests);
  await assertStoredInGardenOnly(garden, photos.digests);
});

test("foliage photos <dir> --garden drafts into that garden's queue and store", { timeout: 90_000 }, async () => {
  const photos = await fixturePhotos();
  const garden = join(await tempDir(), "garden");

  const result = await run(FOLIAGE_CLI, ["photos", photos.dir, "--garden", garden], cleanEnv(await tempDir()));

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\/review/, "the person is pointed at the one review queue");
  await assertCandidates(join(garden, "harvest.json"), photos.digests);
  await assertStoredInGardenOnly(garden, photos.digests);
});

test("a garden inside a git checkout leaves no captured image for git to pick up", { timeout: 90_000 }, async () => {
  const photos = await fixturePhotos();
  const checkout = await tempDir();
  await new Promise<void>((resolve, reject) =>
    execFile("git", ["init", "--quiet", "--initial-branch=main", checkout], { timeout: 30_000 }, (err) =>
      err === null ? resolve() : reject(err),
    ),
  );
  const garden = join(checkout, "garden");

  const result = await run(FOLIAGE_CLI, ["photos", photos.dir, "--garden", garden], cleanEnv(await tempDir()));
  assert.equal(result.code, 0, result.output);

  const status = await new Promise<string>((resolve, reject) =>
    execFile(
      "git",
      ["-C", checkout, "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8", timeout: 30_000 },
      (err, stdout) => (err === null ? resolve(stdout) : reject(err)),
    ),
  );
  const mediaLines = status.split("\n").filter((line) => line.includes("garden/media"));
  assert.deepEqual(mediaLines, [], `git must not see the captured images:\n${status}`);
});

test("foliage photos refuses a missing, doubled or unknown argument before creating the garden", { timeout: 60_000 }, async () => {
  const photos = await fixturePhotos();
  const garden = join(await tempDir(), "garden");
  const env = cleanEnv(await tempDir());

  const missing = await run(FOLIAGE_CLI, ["photos", "--garden", garden], env);
  assert.equal(missing.code, 2, missing.output);
  assert.match(missing.output, /photos needs one directory/);

  for (const args of [[photos.dir, photos.dir], [photos.dir, "--describe"]]) {
    const result = await run(FOLIAGE_CLI, ["photos", ...args, "--garden", garden], env);
    assert.equal(result.code, 2, `${args.join(" ")}: ${result.output}`);
  }
  assert.equal(await exists(garden), false, "a refused command must not create the garden");

  const help = await run(FOLIAGE_CLI, ["photos", "--help", "--garden", garden], env);
  assert.equal(help.code, 0, help.output);
  assert.match(help.output, /Usage: node foliage\.mjs photos <dir>/);
  assert.equal(await exists(garden), false, "help must not create the garden");
});
