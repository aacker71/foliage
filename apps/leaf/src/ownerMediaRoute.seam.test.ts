/**
 * THE OWNER'S PHOTOGRAPH ROUTE, `/my/media/<ref>`, OVER REAL HTTP — and the garden it reads from.
 *
 * `/media/<ref>` is the share route: `mediaSeam.test.ts` proves end to end that it serves bytes
 * only for a leaflet the person shared. `/my/media/<ref>` is the owner's own view of the same
 * store, and until this file no test fetched it (QA #33, 2026-10-03). The pages emit it for every
 * photograph on the owner's side, so a regression there is a broken image on every private page,
 * or — the case that matters — the share rail leaking through the owner route's looser gate.
 *
 * WHAT RUNS IS WHAT A PERSON RUNS. The photograph enters through `harvest.mjs propose-photos`,
 * is approved and promoted by the same CLI, and the app is started with `foliage up --garden`.
 * Nothing is stubbed and nothing is written into the leaf by hand: the leaf starts empty, which is
 * the honest state of somebody who has a photograph and no portfolio yet.
 *
 * THE GARDEN SITS INSIDE A GIT CHECKOUT that carries this repository's ignore rules. That is the
 * QA scenario — `workflow/workflow.json` and `published/*` were committable from a garden placed
 * inside a checkout — measured here with `git status` after a real run, so the answer covers every
 * file the run actually wrote, including ones nobody thought to list.
 *
 * The image is a PNG built byte by byte below. Nothing in it is anybody's photograph.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { pngMetadataChunks } from "./mediaStore.ts";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const REPO = join(APP, "..", "..");
const FOLIAGE = join(REPO, "foliage.mjs");
const HARVEST_CLI = join(APP, "harvest.mjs");

const BOOT_DEADLINE_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

const temps: string[] = [];
after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function freePort(): Promise<number> {
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

/** One PNG chunk: length, type, payload, CRC-32. */
function pngChunk(type: string, payload: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(payload)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.byteLength);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const check = Buffer.alloc(4);
  check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, check]);
}

/** A real 3×2 truecolour PNG with a real `tEXt` chunk, so the store has metadata to strip. */
function fixturePng(): Buffer {
  const width = 3;
  const height = 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = (x * 29 + y * 7) % 256;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from("Comment\0owner media route fixture", "latin1")),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** Every file under `dir`, relative to it, sorted. */
async function filesUnder(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

interface Staged {
  readonly checkout: string;
  readonly garden: string;
  readonly ref: string;
  readonly digest: string;
  readonly leafletId: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * The ambient shell must decide nothing here: every FOLIAGE_* variable is dropped, HOME is a
 * scratch directory so `~/.foliage` is never read or written, and no inference key is inherited.
 */
function isolatedEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NO_COLOR: "1" };
  for (const name of Object.keys(env)) if (name.startsWith("FOLIAGE_")) delete env[name];
  delete env["TYPESAFE_API_KEY"];
  return env;
}

let staged: Staged;
let served: { readonly files: readonly string[] } | undefined;

before(async () => {
  const home = await tempDir("foliage-owner-media-home-");
  const env = isolatedEnv(home);

  // A checkout with THIS repository's ignore rules. `info/exclude` takes the same patterns as a
  // root `.gitignore` without itself showing up as an untracked file in the answer.
  const checkout = await tempDir("foliage-owner-media-checkout-");
  await exec("git", ["init", "-q", checkout], { env, timeout: 30_000 });
  await mkdir(join(checkout, ".git", "info"), { recursive: true });
  await copyFile(join(REPO, ".gitignore"), join(checkout, ".git", "info", "exclude"));
  const garden = join(checkout, "nested", "garden");
  await mkdir(garden, { recursive: true });

  // The photograph lives OUTSIDE the garden, as a person's own files do.
  const photos = join(await tempDir("foliage-owner-media-photos-"), "photos");
  await mkdir(photos);
  const png = fixturePng();
  await writeFile(join(photos, "bench.png"), png);
  const digest = createHash("sha256").update(png).digest("hex");
  const ref = `sha256:${digest}`;

  const leaf = join(garden, "leaf.json");
  const harvest = join(garden, "harvest.json");
  await writeFile(leaf, `${JSON.stringify({ id: "owner-media-seam", subject: "Owner Media Subject", leaflets: [] }, null, 2)}\n`);
  // The shipped default rules, named explicitly so no policy file elsewhere decides the outcome.
  await writeFile(join(garden, "policy.json"), `${JSON.stringify({ rules: [] }, null, 2)}\n`);

  // The same three paths `foliage up --garden` gives the server; the media store is the default
  // `media/` beside the leaf, because FOLIAGE_MEDIA is deliberately unset.
  const cliEnv = { ...env, FOLIAGE_LEAF: leaf, FOLIAGE_HARVEST: harvest, FOLIAGE_POLICY: join(garden, "policy.json") };
  const proposed = await exec(process.execPath, [HARVEST_CLI, "propose-photos", "--dir", photos, "--out", harvest, "--force"], { env: cliEnv, timeout: 60_000 });
  assert.match(proposed.stdout, /1 candidate\(s\) drafted/);
  const drafted = JSON.parse(await readFile(harvest, "utf8")) as { candidates: { id: string; media?: { ref: string }[] }[] };
  const candidate = drafted.candidates[0];
  assert.ok(candidate !== undefined);
  assert.equal(candidate.media?.[0]?.ref, ref, "the candidate must carry the photograph's ref");
  await exec(process.execPath, [HARVEST_CLI, "approve", candidate.id, "--by", "A Reviewer", "--doc", harvest], { env: cliEnv, timeout: 60_000 });
  const promoted = await exec(process.execPath, [HARVEST_CLI, "promote", "--into", leaf, "--doc", harvest, "--force"], { env: cliEnv, timeout: 60_000 });
  assert.match(promoted.stdout, /promoted 1/);

  const doc = JSON.parse(await readFile(leaf, "utf8")) as { leaflets: { id: string; visibility?: string }[] };
  const leaflet = doc.leaflets[0];
  assert.ok(leaflet !== undefined);
  // Promotion shares nothing. This is the state the owner route exists for.
  assert.equal(leaflet.visibility ?? "private", "private");
  staged = { checkout, garden, ref, digest, leafletId: leaflet.id, env };
});

interface Answer {
  readonly status: number;
  readonly type: string | null;
  readonly body: Buffer;
}

/** `foliage up --garden <garden>` as a person starts it; the whole process group dies after. */
async function withApp(body: (fetchPath: (path: string) => Promise<Answer>) => Promise<void>): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [FOLIAGE, "up", "--garden", staged.garden, "--port", String(port)], {
    env: staged.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout?.on("data", (b: Buffer) => { output += b.toString(); });
  child.stderr?.on("data", (b: Buffer) => { output += b.toString(); });
  let exited: string | null = null;
  const exit = new Promise<void>((resolve) => child.once("exit", (code, signal) => { exited = `exit ${String(code)} signal ${String(signal)}`; resolve(); }));

  const origin = `http://127.0.0.1:${port}`;
  const fetchPath = async (path: string): Promise<Answer> => {
    const res = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: res.status, type: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()) };
  };
  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) throw new Error(`foliage up exited before serving: ${exited}\n${output}`);
      if (Date.now() > deadline) throw new Error(`foliage up did not answer in ${BOOT_DEADLINE_MS}ms: ${lastError}\n${output}`);
      try {
        await fetchPath("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body(fetchPath);
  } finally {
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
    if (exited === null) await exit;
  }
}

test("the owner sees their unshared photograph at /my/media/ while /media/ refuses it", async () => {
  await withApp(async (fetchPath) => {
    const owner = await fetchPath(`/my/media/${staged.ref}`);
    assert.equal(owner.status, 200, `the owner's own photograph was refused: ${owner.body.toString("utf8")}`);
    assert.equal(owner.type, "image/png");
    // What was served is what the store recorded as stored — checked against the manifest on disk,
    // not against the server's description of itself — and it is the stripped copy.
    const manifest = JSON.parse(
      await readFile(join(staged.garden, "media", "sha256", staged.digest.slice(0, 2), staged.digest, "manifest.json"), "utf8"),
    ) as { ref: string; publishedDigest: string };
    assert.equal(manifest.ref, staged.ref);
    assert.equal(`sha256:${createHash("sha256").update(owner.body).digest("hex")}`, manifest.publishedDigest);
    assert.deepEqual(pngMetadataChunks(owner.body), [], "the owner route served the metadata the store strips");

    // THE SHARE RAIL HOLDS. Same server, same ref, same bytes on disk: the public address refuses,
    // with the same answer as for a photograph that does not exist.
    const share = await fetchPath(`/media/${staged.ref}`);
    assert.equal(share.status, 404, "an unshared photograph was served on the share route");
    assert.notEqual(share.type, "image/png");
    const absent = await fetchPath(`/media/sha256:${"0".repeat(64)}`);
    assert.equal(absent.status, share.status);

    // The owner route is not an open read of the store: a ref no leaflet names, and a ref that
    // is not a ref, are refused there too.
    const unnamed = await fetchPath(`/my/media/sha256:${"0".repeat(64)}`);
    assert.equal(unnamed.status, 404);
    for (const probe of ["sha256:XYZ", "..%2Fleaf.json", `sha256:${staged.digest.toUpperCase()}`]) {
      const refused = await fetchPath(`/my/media/${probe}`);
      assert.equal(refused.status, 404, `/my/media/${probe} answered ${refused.status}`);
      assert.doesNotMatch(refused.body.toString("utf8"), /Owner Media Subject/);
    }

    // And the owner's leaflet page points at the route that answered.
    const page = await fetchPath(`/my/leaflet/${encodeURIComponent(staged.leafletId)}`);
    assert.equal(page.status, 200);
    assert.ok(page.body.toString("utf8").includes(`src="/my/media/${staged.ref}"`), "the owner page does not link /my/media/");

    // THE CONTROL: the share route's 404 above was the rail, not a route that never answers.
    // Sharing through the real command opens the same address to the same bytes.
    await exec(process.execPath, [FOLIAGE, "share", staged.leafletId, "--as", "public", "--garden", staged.garden], { env: staged.env, timeout: 60_000 });
    const shared = await fetchPath(`/media/${staged.ref}`);
    assert.equal(shared.status, 200, `the shared photograph was refused: ${shared.body.toString("utf8")}`);
    assert.deepEqual(shared.body, owner.body);
  });
  served = { files: await filesUnder(staged.garden) };
});

test("a garden inside a checkout leaves nothing committable after a real run", async () => {
  assert.ok(served !== undefined, "the run above did not complete, so there is nothing to measure");
  // NOT VACUOUS: the run really wrote the kinds of file this question is about — the documents,
  // the media store and the workflow directory `foliage up` opens.
  assert.ok(served.files.includes("leaf.json") && served.files.includes("harvest.json"), served.files.join("\n"));
  assert.ok(served.files.some((f) => f.startsWith(join("media", "sha256") + sep)), served.files.join("\n"));
  assert.ok(served.files.some((f) => f.startsWith(`workflow${sep}`)), served.files.join("\n"));

  const { stdout } = await exec("git", ["-C", staged.checkout, "status", "--porcelain", "--untracked-files=all"], { env: staged.env, timeout: 30_000 });
  assert.equal(
    stdout,
    "",
    `files from a real garden that git would let somebody commit:\n${stdout}\nthe garden held:\n${served.files.join("\n")}`,
  );
});
