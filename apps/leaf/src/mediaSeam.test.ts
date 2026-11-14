/**
 * THE MEDIA SEAM, end to end, through the commands a person actually runs.
 *
 * Four modules had to agree before a leaflet could carry a photograph, and each of them was
 * green on its own while the feature did not exist: the leaf format learned a media element, the
 * store learned to strip and serve bytes, the harvest gate learned to carry what a candidate
 * would publish, and the renderer learned to draw it. This file is the only place that asserts
 * they compose — one real image file goes in at `propose-photos` and the same bytes come back out
 * of `/media/<ref>`, having passed through a review, a promotion, a share and a page.
 *
 * IT DRIVES THE REAL CLI AND THE REAL SERVER, as subprocesses, with nothing stubbed. A test that
 * called `photosToCandidates` and `renderLeafletPage` directly would have passed against the
 * broken tree this lane started from, because every one of those functions was already correct in
 * isolation; what was missing was the wiring between them.
 *
 * THE IMAGE IS A REAL PNG, built here byte by byte — IHDR, a real `tEXt` metadata chunk, real
 * deflate-compressed scanlines, IEND — so the strip has something real to remove and the browser
 * has something real to draw. It is NOT the EXIF-bearing JPEG: that fixture lives in
 * `mediaStore.test.ts`, where the GPS-survives-sips measurement is made, and a second copy of it
 * here would be a fixture that drifts from the one the measurement is about.
 *
 * DIMENSIONS ARE STILL MEASURED THROUGH `sips`, PNG INCLUDED — `photoSource.ts`'s `dimensionsOf`
 * shells out for every format, with no pure-JS IHDR path today. `sips` is macOS-only, so a Linux
 * CI runner (found on PR #1, runs 33272124015/33272408449, 2026-08-29) genuinely cannot produce
 * `known: true` — asserting it unconditionally was this file assuming its author's own machine.
 * The fix is not to skip: it is to ask the SAME question the product asks (`sips --version`) and
 * assert the shape that question's real answer implies, on whichever machine is running this. On
 * a machine with `sips` the claim is exactly as strong as before; on one without it the claim is
 * the equally real "unmeasured, and here is why" the product itself renders — never a guess, never
 * an average of the two, and never a skip pretending the seam ran when it did not.
 *
 * Nothing in it is anybody's photograph.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { pngMetadataChunks } from "./mediaStore.ts";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const HARVEST_CLI = join(APP, "harvest.mjs");
const SHARE_CLI = join(APP, "share.mjs");
const SERVER = join(APP, "server.mjs");

const BOOT_DEADLINE_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

const temps: string[] = [];
after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-media-seam-"));
  temps.push(dir);
  return dir;
}

/**
 * Can `sips` actually run on the machine executing this test — the same question
 * `photoSource.ts`'s own `probeSips` asks, asked again here rather than assumed. Used to pick
 * which of the two REAL, honest shapes the dimension-carrying assertions below must take; never
 * to skip any of them. Same technique `mediaStore.test.ts`'s `sipsRuns` uses.
 */
async function sipsRuns(): Promise<boolean> {
  try {
    await exec("sips", ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The literal shape of `photoSource.ts`'s own `sipsUnavailable` message, everything but the
 * spawn-error detail pinned — so a real "sips is absent" answer is recognised by what the product
 * actually says about itself, not by a guess at Node's exact ENOENT wording.
 */
const SIPS_UNAVAILABLE_WHY =
  /sips could not be executed: .+\. It is macOS-only and it is not required — pixel dimensions are reported as unmeasured, with this as the reason, and HEIF files cannot be decoded for the local model on this machine\./;

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

/** One PNG chunk: length, type, payload, CRC-32 — the real thing, checksum included. */
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

/**
 * A REAL 4×3 truecolour PNG carrying a REAL `tEXt` chunk.
 *
 * The dimensions are asserted on the page later, so they are chosen to be unmistakable rather
 * than square: a renderer that transposed them would still look plausible at 4×4.
 */
function realPngWithMetadata(): Buffer {
  const width = 4;
  const height = 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = (x * 17 + y * 5) % 256;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from("Software\0a camera that names itself", "latin1")),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

interface Running {
  get(path: string): Promise<{ status: number; body: string }>;
  bytes(path: string): Promise<{ status: number; type: string | null; body: Buffer }>;
}

/** Start the REAL server on the given environment, hand it to `body`, and always kill it. */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1" },
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
  const bytes = async (path: string) => {
    const res = await fetch(origin + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      status: res.status,
      type: res.headers.get("content-type"),
      body: Buffer.from(await res.arrayBuffer()),
    };
  };
  const get = async (path: string) => {
    const r = await bytes(path);
    return { status: r.status, body: r.body.toString("utf8") };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`server did not answer in ${BOOT_DEADLINE_MS}ms: ${lastError}\n${stderr}`);
      }
      try {
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get, bytes });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) await new Promise<void>((r) => child.once("exit", () => r()));
  }
}

/**
 * Lay one real image in a directory, and put an EMPTY leaf beside it.
 *
 * The leaf really is empty — `leaflets: []` — and that is not a shortcut around building a real
 * one. It is the honest starting state this feature is for: a person who has photographs and no
 * portfolio yet. Promotion appends to it, so what the page renders afterwards came from the
 * commands rather than from anything written here.
 */
async function stage(): Promise<{
  dir: string;
  photos: string;
  leaf: string;
  harvest: string;
  media: string;
  policy: string;
  digest: string;
  env: Record<string, string>;
}> {
  const dir = await tempDir();
  const photos = join(dir, "photos");
  await mkdir(photos);
  const png = realPngWithMetadata();
  await writeFile(join(photos, "workbench.png"), png);
  const digest = createHash("sha256").update(png).digest("hex");

  const leaf = join(dir, "leaf.json");
  await writeFile(
    leaf,
    `${JSON.stringify({ id: "media-seam", subject: "Media Seam Subject", leaflets: [] }, null, 2)}\n`,
  );
  const harvest = join(dir, "harvest.json");
  const media = join(dir, "media");
  // THE SHIPPED DEFAULT, named explicitly. Without it the server reads the policy file that
  // happens to sit in this working tree, so a rule somebody adds there could refuse this
  // leaflet and this test would fail describing a problem that is not its own.
  const policy = join(dir, "policy.json");
  await writeFile(policy, `${JSON.stringify({ rules: [] }, null, 2)}\n`);

  const env = {
    FOLIAGE_LEAF: leaf,
    FOLIAGE_HARVEST: harvest,
    FOLIAGE_MEDIA: media,
    FOLIAGE_POLICY: policy,
  };
  return { dir, photos, leaf, harvest, media, policy, digest, env };
}

test("a real image file becomes a leaflet that shows the photograph, through the real commands", async () => {
  const s = await stage();
  const ref = `sha256:${s.digest}`;
  // THE REAL QUESTION, asked once, up front — never a skip: every assertion below still runs on
  // every machine, each against the shape that is actually true of THIS one.
  const hasSips = await sipsRuns();

  // 1. THE LIGHT SOURCE. It reads bytes, identifies the format by magic, strips the metadata on
  //    the way into the store, and drafts a candidate.
  const proposed = await exec(
    process.execPath,
    [HARVEST_CLI, "propose-photos", "--dir", s.photos, "--out", s.harvest, "--force"],
    { env: { ...process.env, ...s.env }, timeout: 60_000 },
  );
  assert.match(proposed.stdout, /1 candidate\(s\) drafted/);
  assert.match(
    proposed.stdout,
    /1 image\(s\) captured into .*, with 1 metadata block\(s\) removed/,
    "the command did not say what happened to the bytes",
  );

  // 2. WHAT THE REVIEWER WOULD BE APPROVING is IN the document, not derived at promotion. This is
  //    the assertion the whole design rests on: an approval covers what the reviewer saw.
  const harvest = JSON.parse(await readFile(s.harvest, "utf8")) as {
    candidates: {
      id: string;
      media?: { ref: string; media: { mediaType: string; dimensions: unknown } }[];
    }[];
  };
  const candidate = harvest.candidates[0];
  assert.ok(candidate !== undefined);
  const media = candidate.media?.[0];
  assert.ok(media !== undefined, "the candidate must declare its one image");
  assert.equal(media.ref, ref);
  assert.equal(media.media.mediaType, "image/png");
  if (hasSips) {
    assert.deepEqual(media.media.dimensions, { known: true, width: 4, height: 3 });
  } else {
    const dims = media.media.dimensions as { known: boolean; why?: string };
    assert.equal(dims.known, false, "sips is absent — dimensions cannot be known here");
    assert.match(String(dims.why), SIPS_UNAVAILABLE_WHY);
  }

  // …and the review surface SAYS so, in words, before anybody types `approve`.
  const listed = await exec(process.execPath, [HARVEST_CLI, "review", "--doc", s.harvest], {
    env: { ...process.env, ...s.env },
    timeout: 60_000,
  });
  assert.match(listed.stdout, /IMAGE\s+1 image\(s\) would be published with this/);
  if (hasSips) {
    assert.match(listed.stdout, /image\/png 4×3/);
  } else {
    assert.match(listed.stdout, /image\/png size not measured — /);
    assert.match(listed.stdout, SIPS_UNAVAILABLE_WHY);
  }

  // 3. REVIEW, then PROMOTE. The leaflet lands at "pending" — bytes never reach "verified".
  await exec(
    process.execPath,
    [HARVEST_CLI, "approve", candidate.id, "--by", "A Reviewer", "--doc", s.harvest],
    { env: { ...process.env, ...s.env }, timeout: 60_000 },
  );
  const promoted = await exec(
    process.execPath,
    [HARVEST_CLI, "promote", "--into", s.leaf, "--doc", s.harvest, "--force"],
    { env: { ...process.env, ...s.env }, timeout: 60_000 },
  );
  assert.match(promoted.stdout, /promoted 1/);

  const leaf = JSON.parse(await readFile(s.leaf, "utf8")) as {
    leaflets: { id: string; tier: string; body?: { media?: { mediaType: string } }[] }[];
  };
  const leaflet = leaf.leaflets[0];
  assert.ok(leaflet !== undefined);
  assert.equal(leaflet.tier, "pending", "a photograph can never reach verified");
  assert.equal(leaflet.body?.[0]?.media?.mediaType, "image/png");

  // 4. SHARING IS A SEPARATE ACT. Promotion published nothing.
  await withServer(s.env, async (running) => {
    const before = await running.bytes(`/media/${ref}`);
    assert.equal(before.status, 404, "an unshared leaflet's photograph must not be served");
  });
  await exec(process.execPath, [SHARE_CLI, "share", leaflet.id], {
    env: { ...process.env, ...s.env },
    timeout: 60_000,
  });

  // 5. THE PAGE AND THE BYTES.
  await withServer(s.env, async (running) => {
    const page = await running.get(`/leaflet/${encodeURIComponent(leaflet.id)}`);
    assert.equal(page.status, 200);
    // The IMG element, its address, and — where the size is actually known — the measured size
    // written into the tag so nothing jumps. Where it is not, `render.ts`'s own `mediaFigure`
    // omits the attribute rather than guessing, and that omission is the thing asserted instead.
    if (hasSips) {
      assert.match(
        page.body,
        new RegExp(`<img class="leaflet-media-img" src="/media/${ref}" [^>]*width="4" height="3" decoding="async">`),
      );
    } else {
      assert.match(
        page.body,
        new RegExp(`<img class="leaflet-media-img" src="/media/${ref}" [^>]*decoding="async">`),
      );
      assert.doesNotMatch(page.body, /leaflet-media-img[^>]*width="/, "no width can be shown for an unmeasured image");
    }
    // The measurement is on the page as a metric, and so is the fact that the served copy is not
    // the file as found. Neither is inferable from the picture.
    assert.match(page.body, /<dd class="fol-metric">image\/png<\/dd>/);
    if (hasSips) {
      assert.match(page.body, /<dd class="fol-metric">4 × 3<\/dd>/);
    } else {
      assert.match(page.body, /<dd><span class="fol-metric">not measured<\/span> <span class="aside">/);
      assert.match(page.body, SIPS_UNAVAILABLE_WHY);
    }
    assert.match(page.body, /metadata removed/);
    // And the element is not ALSO told there is no claim: it shows one.
    assert.equal(/No claim stated\./.test(page.body), false);

    // THE BYTES THEMSELVES, which is the half a rendered <img> tag does not prove.
    const served = await running.bytes(`/media/${ref}`);
    assert.equal(served.status, 200);
    assert.equal(served.type, "image/png");
    assert.deepEqual(
      pngMetadataChunks(served.body),
      [],
      "the served copy still carries the metadata chunk it was supposed to lose",
    );
    // What was served is what the store's manifest says was stored — checked against the file on
    // disk, not against the server's own report of itself.
    const manifest = JSON.parse(
      await readFile(
        join(s.media, "sha256", s.digest.slice(0, 2), s.digest, "manifest.json"),
        "utf8",
      ),
    ) as { ref: string; publishedDigest: string; strip: { removed: { what: string }[] } };
    assert.equal(manifest.ref, ref);
    assert.equal(
      `sha256:${createHash("sha256").update(served.body).digest("hex")}`,
      manifest.publishedDigest,
    );
    assert.ok(
      manifest.strip.removed.some((r) => r.what.includes("tEXt")),
      "the strip report does not name the chunk that was removed",
    );
    // THE SOURCE FILE IS UNTOUCHED. Stripping happens on the way in; the operator's own copy is
    // evidence and is never rewritten.
    const onDisk = await readFile(join(s.photos, "workbench.png"));
    assert.equal(createHash("sha256").update(onDisk).digest("hex"), s.digest);
  });

  // 6. UNSHARING TAKES THE PHOTOGRAPH WITH IT, in the same act, with nothing else to remember.
  await exec(process.execPath, [SHARE_CLI, "unshare", leaflet.id], {
    env: { ...process.env, ...s.env },
    timeout: 60_000,
  });
  await withServer(s.env, async (running) => {
    const page = await running.get(`/leaflet/${encodeURIComponent(leaflet.id)}`);
    assert.equal(page.status, 404);
    const served = await running.bytes(`/media/${ref}`);
    assert.equal(served.status, 404, "the photograph outlived the share it was published under");
  });
});

test("a media element the store cannot serve is never written, and the page says nothing false", async () => {
  // THE HONEST EMPTY STATE, and the reason `published` is a required field rather than an
  // optional one. A scan told to capture nothing measures the file, drafts the candidate and
  // records NO media — so a promoted leaflet is a real evidence ref with no picture, rather than
  // a picture element pointing at bytes nothing holds.
  const s = await stage();
  const proposed = await exec(
    process.execPath,
    [HARVEST_CLI, "propose-photos", "--dir", s.photos, "--out", s.harvest, "--force"],
    // FOLIAGE_MEDIA pointed at a path that cannot be a directory: the store fails, loudly, per
    // object, and the candidate is still drafted because the FILE was still measured.
    {
      env: { ...process.env, ...s.env, FOLIAGE_MEDIA: join(s.photos, "workbench.png") },
      timeout: 60_000,
    },
  );
  assert.match(proposed.stdout, /1 candidate\(s\) drafted/);
  // LOUDLY. This assertion is the one that would have caught the defect this test was written
  // after: the capture failed and the command printed the same success line as a capture that
  // worked, so the operator learned their photograph was missing by opening the page.
  assert.match(proposed.stdout, /1 of 1 image\(s\) could NOT be captured/);
  assert.match(proposed.stdout, /unwritable-store/);

  const harvest = JSON.parse(await readFile(s.harvest, "utf8")) as {
    candidates: { id: string; media?: unknown }[];
  };
  const candidate = harvest.candidates[0];
  assert.ok(candidate !== undefined);
  assert.equal(
    "media" in candidate,
    false,
    "a candidate declared media for bytes that were never stored",
  );

  await exec(
    process.execPath,
    [HARVEST_CLI, "approve", candidate.id, "--by", "A Reviewer", "--doc", s.harvest],
    { env: { ...process.env, ...s.env }, timeout: 60_000 },
  );
  await exec(
    process.execPath,
    [HARVEST_CLI, "promote", "--into", s.leaf, "--doc", s.harvest, "--force"],
    { env: { ...process.env, ...s.env }, timeout: 60_000 },
  );
  const leaf = JSON.parse(await readFile(s.leaf, "utf8")) as {
    leaflets: { id: string; body?: Record<string, unknown>[] }[];
  };
  const leaflet = leaf.leaflets[0];
  assert.ok(leaflet !== undefined);
  assert.equal("media" in (leaflet.body?.[0] ?? {}), false);

  await exec(process.execPath, [SHARE_CLI, "share", leaflet.id], {
    env: { ...process.env, ...s.env },
    timeout: 60_000,
  });
  await withServer(s.env, async (running) => {
    const page = await running.get(`/leaflet/${encodeURIComponent(leaflet.id)}`);
    assert.equal(page.status, 200);
    // No picture, no figure, no claim that one exists — and no broken tag either.
    assert.equal(/leaflet-media/.test(page.body), false);
    assert.equal(/metadata removed/.test(page.body), false);
    // The evidence ref is still there. The file was measured; only the capture failed.
    assert.match(page.body, /sha256:/);
  });
});
