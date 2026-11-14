/**
 * Tests for the image READ, against REAL files this file writes to a real temporary directory.
 *
 * THE IMAGES ARE REAL IMAGES. `realPng` encodes an actual PNG — signature, IHDR, a zlib-deflated
 * IDAT, IEND, every chunk CRC-32'd — using nothing but `node:zlib`. It is not a byte pattern
 * that starts with the right magic number: where `sips` exists, one of the tests below hands the
 * file to it and asserts it decodes to exactly the dimensions that were encoded, which a
 * lookalike would fail. The same reasoning as building real git repositories in
 * `gitIntake.test.ts` — do not mock what you can run.
 *
 * These files are TEST CONSTRUCTION and nothing else. They are three solid-colour rectangles;
 * they are not photographs, they are not evidence, and no candidate drafted from them means
 * anything about anybody. What they exercise is whether the reader identifies, hashes and
 * measures what is actually on disk.
 *
 * THE DIGEST IS CHECKED AGAINST A SECOND IMPLEMENTATION. Asserting that our SHA-256 equals our
 * SHA-256 would prove a constant survived a function call, so the digest goes to stock `shasum`
 * for an independent opinion — the same move as handing git's shas back to `git cat-file`. If
 * `shasum` is not installed the test reports itself SKIPPED rather than passing quietly.
 *
 * THE MODEL TESTS USE A STUB TRANSPORT ON LOOPBACK — a `node:http` server that returns a chosen
 * body. It is a TRANSPORT double, not a model, and none of its answers are presented as anything
 * a model said: what these tests pin is that a null answer survives as an absence, that a
 * non-200 fails closed, and that the request this code actually puts on the wire carries a
 * fully nullable schema. The real gemma4:12b path is exercised by hand through the CLI, and the
 * output of that run is the only evidence of what the model does.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { photosToCandidates } from "@foliage/photosynthesis";

import {
  jpegMetadataSegments,
  pngMetadataChunks,
  readMedia,
  summarizeStore,
} from "./mediaStore.ts";
import {
  describeImage,
  imageFormatOf,
  isReadFailure,
  readImages,
  type ScannedImage,
} from "./photoSource.ts";

const exec = promisify(execFile);

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-photo-test-"));
  tmpRoots.push(dir);
  return dir;
}

/** CRC-32 as PNG specifies it, table built once. */
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

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A REAL PNG: 8-bit RGB, one solid colour, deflated exactly as the format requires. */
function realPng(
  width: number,
  height: number,
  colour: number,
  extra: readonly Buffer[] = [],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = (colour + x) % 256;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * A REAL, small EXIF APP1 payload: TIFF header, an IFD0 carrying `Artist`, a GPS IFD pointer
 * (tag 0x8825) and a GPS IFD carrying `GPSLatitudeRef`.
 *
 * A SECOND, SMALLER COPY OF A BUILDER `mediaStore.test.ts` also has, and the duplication is
 * deliberate: importing a helper from another `.test.ts` would execute that file's whole suite as
 * a side effect of the import. This one exists to prove one thing — that what leaves this process
 * on the wire has no EXIF in it — so it carries the two tags that make the point and no more.
 */
function exifApp1WithGps(): Buffer {
  const artist = Buffer.from("A Real Person\0", "latin1");
  const TIFF_HEADER = 8;
  const ifd0Size = 2 + 2 * 12 + 4;
  const gpsOffset = TIFF_HEADER + ifd0Size;
  const gpsSize = 2 + 1 * 12 + 4;

  const entry = (tag: number, type: number, count: number, value: number): Buffer => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    b.writeUInt32LE(value, 8);
    return b;
  };
  const count0 = Buffer.alloc(2);
  count0.writeUInt16LE(2);
  const countGps = Buffer.alloc(2);
  countGps.writeUInt16LE(1);
  const latRef = Buffer.alloc(12);
  latRef.writeUInt16LE(0x0001, 0);
  latRef.writeUInt16LE(2, 2);
  latRef.writeUInt32LE(2, 4);
  latRef.write("N\0", 8, "latin1");

  return Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    count0,
    entry(0x013b, 2, artist.length, gpsOffset + gpsSize), // Artist, value on the heap
    entry(0x8825, 4, 1, gpsOffset), // GPS IFD pointer
    Buffer.alloc(4),
    countGps,
    latRef,
    Buffer.alloc(4),
    artist,
  ]);
}

/** SHA-256 from a DIFFERENT implementation, or null when stock shasum is not installed. */
async function shasum(path: string): Promise<string | null> {
  try {
    const { stdout } = await exec("shasum", ["-a", "256", path], { timeout: 60_000 });
    return (stdout.split(/\s+/)[0] ?? "").trim();
  } catch (err) {
    if (err !== null && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function okScan(scan: Awaited<ReturnType<typeof readImages>>) {
  assert.equal(scan.ok, true, "expected the directory to be readable");
  if (!scan.ok) throw new Error("unreachable");
  return scan;
}

/* --------------------------------------------------------------------------- format ---- */

test("format is decided by the bytes, never by the extension", async () => {
  const dir = await tempDir();
  const png = realPng(4, 3, 10);
  // A real PNG wearing the wrong suffix, and a text file wearing the right one.
  await writeFile(join(dir, "screenshot.txt"), png);
  await writeFile(join(dir, "not-an-image.png"), "PNG is a lie, this is prose.\n", "utf8");

  const scan = okScan(await readImages(dir, { store: null }));
  assert.equal(scan.images.length, 1);
  assert.equal(scan.images[0]!.path, join(dir, "screenshot.txt"));
  assert.equal(scan.images[0]!.format, "png");
  assert.equal(scan.nonImageFiles, 1);
  assert.equal(scan.filesSeen, 2);
});

test("the signature table recognises the formats it claims, and refuses what it does not", () => {
  assert.equal(imageFormatOf(realPng(1, 1, 0)), "png");
  assert.equal(imageFormatOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "jpeg");
  assert.equal(imageFormatOf(Buffer.from("GIF89a....", "ascii")), "gif");
  // ISO-BMFF: `ftyp` at offset 4, brand at 8 — what an iPhone photo and the macOS wallpaper are.
  assert.equal(imageFormatOf(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "binary")), "heif");
  assert.equal(imageFormatOf(Buffer.from("RIFF____WEBPVP8 ", "ascii")), "webp");
  assert.equal(imageFormatOf(Buffer.from([0x49, 0x49, 0x2a, 0x00])), "tiff");
  assert.equal(imageFormatOf(Buffer.from("not an image at all", "utf8")), null);
  assert.equal(imageFormatOf(new Uint8Array(0)), null);
});

/* ----------------------------------------------------------------------------- scan ---- */

test("every image is hashed, and the digest agrees with a second implementation", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "a.png"), realPng(8, 5, 1));
  await writeFile(join(dir, "b.png"), realPng(8, 5, 200));

  const scan = okScan(await readImages(dir, { store: null }));
  assert.equal(scan.images.length, 2);
  // Different pixels, different bytes, different digests — the id derived from them is unique
  // by construction rather than by hope.
  assert.notEqual(scan.images[0]!.digest, scan.images[1]!.digest);

  const independent = await shasum(scan.images[0]!.path);
  if (independent === null) {
    process.stdout.write("SKIPPED: shasum is not installed; the digest was not cross-checked.\n");
    return;
  }
  assert.equal(scan.images[0]!.digest, independent);
});

test("a directory with no images is an honest empty scan, not a failure", async () => {
  const dir = await tempDir();
  const scan = okScan(await readImages(dir, { store: null }));
  assert.deepEqual(scan.images, []);
  assert.equal(scan.filesSeen, 0);
  assert.equal(scan.nonImageFiles, 0);
  assert.deepEqual(scan.emptyFiles, []);
  assert.deepEqual(scan.notRead, []);
});

test("a zero-byte file is its own answer, not a file whose bytes were read and rejected", async () => {
  // "not an image by its bytes" is a claim ABOUT BYTES. A file with none cannot support it, and
  // counting it beside the prose file would let a report assert a reading that never happened.
  const dir = await tempDir();
  await writeFile(join(dir, "zero.png"), "");
  await writeFile(join(dir, "prose.png"), "PNG is a lie, this is prose.\n", "utf8");
  await writeFile(join(dir, "real.png"), realPng(4, 4, 12));

  const scan = okScan(await readImages(dir, { store: null }));
  assert.deepEqual(scan.emptyFiles, [join(dir, "zero.png")]);
  assert.equal(scan.nonImageFiles, 1, "the empty file must not be counted as a non-image");
  assert.equal(scan.images.length, 1);
  // The four buckets account for every file the walk collected, with nothing double-counted
  // and nothing quietly dropped.
  assert.equal(
    scan.filesSeen,
    scan.images.length + scan.nonImageFiles + scan.emptyFiles.length + scan.notRead.length,
  );
});

test("the machine REFUSING and the walk DECLINING are different causes on the entry", async () => {
  // The CLI's decision to write or not turns on exactly this distinction, so it has to be a
  // value on the entry rather than something a caller infers by matching the detail prose.
  const dir = await tempDir();
  const locked = join(dir, "locked.png");
  await writeFile(locked, realPng(6, 6, 30));
  chmodSync(locked, 0o000);
  const elsewhere = await tempDir();
  await symlink(elsewhere, join(dir, "link"));

  // Only assert the locked branch where the machine actually enforces the mode — as root, or on
  // a filesystem that ignores it, that state does not exist and asserting it could not fail.
  let enforced = false;
  try {
    const handle = await open(locked, "r");
    await handle.close();
  } catch {
    enforced = true;
  }

  const scan = okScan(await readImages(dir, { store: null }));
  const link = scan.notRead.find((e) => e.path === join(dir, "link"));
  assert.ok(link, "the symbolic link must be reported");
  assert.equal(link.cause, "symbolic-link");
  assert.equal(isReadFailure(link), false, "a rule this scan applies is not a failed read");

  if (!enforced) {
    process.stdout.write(
      "SKIPPED the locked branch: this machine let the test read a 0o000 file.\n",
    );
    return;
  }
  const refused = scan.notRead.find((e) => e.path === locked);
  assert.ok(refused, "a file that could not be opened must be reported");
  assert.equal(refused.cause, "file-unreadable");
  assert.equal(isReadFailure(refused), true, "an unopenable file IS a failed read");
  assert.equal(scan.images.length, 0);
  assert.equal(scan.nonImageFiles, 0, "an unread file is not a non-image; nobody read it");
});

test("a path that does not exist and a path that is a file are DIFFERENT causes", async () => {
  const dir = await tempDir();
  const file = join(dir, "leaf.json");
  await writeFile(file, "{}", "utf8");

  const missing = await readImages(join(dir, "no-such-directory"), { store: null });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.cause, "no-such-path");

  const notADir = await readImages(file, { store: null });
  assert.equal(notADir.ok, false);
  if (!notADir.ok) assert.equal(notADir.cause, "not-a-directory");
});

test("subdirectories are walked and symbolic links are reported, never followed", async () => {
  const dir = await tempDir();
  const nested = join(dir, "2026", "august");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "deep.png"), realPng(3, 3, 7));
  const elsewhere = await tempDir();
  await writeFile(join(elsewhere, "outside.png"), realPng(3, 3, 9));
  await symlink(elsewhere, join(dir, "link-to-elsewhere"));

  const scan = okScan(await readImages(dir, { store: null }));
  assert.deepEqual(
    scan.images.map((i) => i.path),
    [join(nested, "deep.png")],
  );
  // The link is not silently absent from the count — it is named, with the reason.
  assert.equal(scan.notRead.length, 1);
  assert.equal(scan.notRead[0]!.path, join(dir, "link-to-elsewhere"));
  assert.match(scan.notRead[0]!.detail, /symbolic link not followed/);
});

test("pixel dimensions are measured, or their absence carries a reason — never a zero", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "wide.png"), realPng(11, 7, 3));

  const scan = okScan(await readImages(dir, { store: null }));
  const measured = scan.images[0]!.dimensions;
  if (scan.toolchain.sipsRuns) {
    assert.equal(measured.known, true);
    if (measured.known) {
      // sips decoding it to exactly 11×7 is what proves the encoder above wrote a real PNG.
      assert.equal(measured.width, 11);
      assert.equal(measured.height, 7);
    }
  } else {
    assert.equal(measured.known, false);
    if (!measured.known) assert.notEqual(measured.why.trim(), "");
    process.stdout.write(
      "SKIPPED the measured branch: sips is not available on this machine.\n",
    );
  }
});

test("a real scan feeds the domain unchanged, and produces candidates evidenced by digest", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "one.png"), realPng(6, 4, 20));
  const scan = okScan(await readImages(dir, { store: null }));

  const result = photosToCandidates({
    images: scan.images.map((i) => ({ ...i, description: null })),
    observedAt: "2026-08-16T00:00:00Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.evidence[0]!.ref, `sha256:${scan.images[0]!.digest}`);
});

/* ---------------------------------------------------------------------------- store ---- */

test("a scan captures the bytes at the digest its ref will name, and captures them clean", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  // A real PNG carrying a real tEXt chunk — the place a phone writes an owner's name.
  const text = chunk("tEXt", Buffer.from("Author\0A Real Person", "latin1"));
  await writeFile(join(dir, "shot.png"), realPng(9, 7, 55, [text]));

  const scan = okScan(await readImages(dir, { store: root }));
  assert.equal(scan.storeRoot, root);
  const image = scan.images[0]!;
  assert.notEqual(image.stored, null);
  assert.equal(image.stored?.ok, true);
  if (image.stored === null || !image.stored.ok) return;

  // THE REF THE DOMAIN WILL BUILD ADDRESSES THIS OBJECT. Checked through the real domain call
  // rather than by string-building the ref here, which would only prove this test can concatenate.
  const drafted = photosToCandidates({
    images: [{ ...image, description: null }],
    observedAt: "2026-08-19T00:00:00Z",
  });
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;
  assert.equal(drafted.candidates[0]!.evidence[0]!.ref, image.stored.ref);

  const served = await readMedia(root, image.stored.ref);
  assert.equal(served.ok, true);
  if (!served.ok) return;
  assert.deepEqual(pngMetadataChunks(served.bytes), []);
  assert.ok(!served.bytes.includes(Buffer.from("A Real Person", "latin1")));
  assert.equal(served.verifiedAgainst, "manifest");
});

test("a scan told to store nothing stores nothing, and says so rather than implying it", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "shot.png"), realPng(4, 4, 4));
  const scan = okScan(await readImages(dir, { store: null }));
  assert.equal(scan.storeRoot, null);
  assert.equal(scan.images[0]!.stored, null);
});

test("two copies of one photograph are stripped once and stored once", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const bytes = realPng(6, 6, 66);
  await writeFile(join(dir, "a.png"), bytes);
  await writeFile(join(dir, "b.png"), bytes);
  const scan = okScan(await readImages(dir, { store: root }));
  assert.equal(scan.images.length, 2);
  // Same digest, so the second is the first: content addressing, not a second copy on disk.
  assert.equal(scan.images[0]!.digest, scan.images[1]!.digest);
  assert.equal(scan.images[0]!.stored, scan.images[1]!.stored);
  const summary = await summarizeStore(root);
  assert.equal(summary.objects, 1);
});

/* ------------------------------------------------------------------------- describe ---- */

/** A loopback HTTP stub. It doubles the TRANSPORT; nothing it returns is a model's answer. */
async function stub(
  handler: (body: string) => { status: number; body: string },
): Promise<{ endpoint: string; server: Server; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push(body);
      const answer = handler(body);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { endpoint: `http://127.0.0.1:${port}/api/generate`, server, seen };
}

async function oneImage(): Promise<ScannedImage> {
  const dir = await tempDir();
  await writeFile(join(dir, "subject.png"), realPng(5, 5, 42));
  const scan = okScan(await readImages(dir, { store: null }));
  return scan.images[0]!;
}

test("a non-loopback endpoint is refused before anything is sent", async () => {
  const outcome = await describeImage(await oneImage(), {
    endpoint: "https://api.example.com/v1/generate",
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "not-loopback");
  assert.match(outcome.detail, /loopback only/);
});

test("A 307 FROM THE ENDPOINT IS REFUSED, and the image goes nowhere", async () => {
  // THE REPRODUCED DEFECT, on this call site. Checking the hostname and then calling `fetch` was
  // not enough: a 307 preserves method and body, so an endpoint on the trusted port could name any
  // host and undici would carry the request — which on this path is an operator's photograph,
  // base64 in the body — there. Two real servers, because the thing that leaked was undici's
  // redirect behaviour and no test that stubbed fetch could see it.
  let stolen: string | null = null;
  const thief = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      stolen = body;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => thief.listen(0, "127.0.0.1", resolve));
  const thiefAddress = thief.address();
  const thiefPort = typeof thiefAddress === "object" && thiefAddress !== null ? thiefAddress.port : 0;

  const model = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${thiefPort}/api/generate` });
    res.end();
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const modelAddress = model.address();
  const modelPort = typeof modelAddress === "object" && modelAddress !== null ? modelAddress.port : 0;

  try {
    const outcome = await describeImage(await oneImage(), {
      endpoint: `http://127.0.0.1:${modelPort}/api/generate`,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(stolen, null, "THE SECOND HOST RECEIVED THE IMAGE — the hole is open");
    // Its own cause. Told "unreachable", the operator restarts a model that is answering fine.
    assert.equal(outcome.cause, "redirected");
    assert.match(outcome.detail, /307/, "the status must be named");
    assert.match(outcome.detail, new RegExp(`${thiefPort}`), "and the location it refused");
    assert.match(outcome.detail, /nothing was written/i);
  } finally {
    thief.close();
    model.close();
  }
});

test("an unreachable local model fails closed, with BOTH causes named", async () => {
  // Port 1 on loopback: nothing listens there, and the refusal arrives wrapped in a generic
  // "fetch failed" that would say nothing on its own.
  const outcome = await describeImage(await oneImage(), {
    endpoint: "http://127.0.0.1:1/api/generate",
    timeoutMs: 10_000,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "unreachable");
  assert.match(outcome.detail, /cause:/);
  assert.match(outcome.detail, /nothing was written/i);
});

test("a model that is LISTENING but slow times out — a different cause from unreachable", async () => {
  // MEASURED against the real ollama on this machine before this branch existed:
  // describeImage(img, {timeoutMs: 1500}) returned cause "unreachable" with the detail "could
  // not be reached: The operation was aborted due to timeout" — byte for byte the discriminant a
  // dead port produces, while the model was up and answering. The remedies are opposite: start
  // the server, versus give a busy machine more time. Here the server below accepts the
  // connection and deliberately never answers, so "unreachable" would be false about a socket
  // this test is holding open.
  const held: import("node:net").Socket[] = [];
  const server = createServer((req) => {
    held.push(req.socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    const outcome = await describeImage(await oneImage(), {
      endpoint: `http://127.0.0.1:${port}/api/generate`,
      timeoutMs: 750,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.cause, "timed-out");
    assert.match(outcome.detail, /750ms/, "the ceiling that was hit must be named");
    assert.match(outcome.detail, /NOT a refused connection/);
    assert.match(outcome.detail, /nothing was written/i);
  } finally {
    for (const socket of held) socket.destroy();
    server.close();
  }
});

test("the request actually put on the wire asks for a FULLY NULLABLE schema", async () => {
  // The hazard, pinned at the wire: a required non-nullable field is a grammar that forces the
  // decoder to invent an answer. This asserts the bytes this code sends, not its intent.
  const { endpoint, server, seen } = await stub(() => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ summary: null, visibleText: null }) }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    const sent = JSON.parse(seen[0] ?? "{}") as {
      format?: { properties?: Record<string, { type?: unknown }>; required?: string[] };
      images?: string[];
    };
    for (const [field, spec] of Object.entries(sent.format?.properties ?? {})) {
      assert.deepEqual(spec.type, ["string", "null"], `${field} must permit null`);
    }
    assert.deepEqual(sent.format?.required, ["summary", "visibleText"]);
    // And a real image really was attached, base64 of actual bytes.
    assert.equal(typeof sent.images?.[0], "string");
    assert.match(sent.images?.[0] ?? "", /^[A-Za-z0-9+/]+=*$/);
  } finally {
    server.close();
  }
});

test("the bytes on the wire to the model carry no EXIF, and this is read off the wire", async () => {
  // The hazard, measured: `sips -Z` preserves EXIF, so the downscaled copy this code used to
  // send still held the camera, the owner's name and the GPS IFD. Asserted against the base64
  // that actually left the process, not against an intention.
  let sipsHere = true;
  const dir = await tempDir();
  try {
    await exec("sips", ["--version"], { timeout: 60_000 });
  } catch {
    sipsHere = false;
  }
  if (!sipsHere) {
    process.stdout.write("SKIPPED: sips is not installed, so no real JPEG could be built.\n");
    return;
  }
  await writeFile(join(dir, "base.png"), realPng(40, 30, 8));
  await exec("sips", [
    "-s",
    "format",
    "jpeg",
    join(dir, "base.png"),
    "--out",
    join(dir, "plain.jpg"),
  ]);
  const plain = await readFile(join(dir, "plain.jpg"));
  const app1 = exifApp1WithGps();
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(app1.byteLength + 2, 2);
  await writeFile(
    join(dir, "photo.jpg"),
    Buffer.concat([plain.subarray(0, 2), head, app1, plain.subarray(2)]),
  );

  const scan = okScan(await readImages(dir, { store: null }));
  const image = scan.images.find((i) => i.path.endsWith("photo.jpg"))!;

  const { endpoint, server, seen } = await stub(() => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ summary: null, visibleText: null }) }),
  }));
  try {
    const outcome = await describeImage(image, { endpoint, timeoutMs: 30_000 });
    assert.equal(outcome.ok, true);
    const sent = JSON.parse(seen[0] ?? "{}") as { images?: string[] };
    const onTheWire = Buffer.from(sent.images?.[0] ?? "", "base64");
    assert.ok(onTheWire.byteLength > 0, "a real image must have been attached");
    assert.deepEqual(
      jpegMetadataSegments(onTheWire).filter((s) => !s.startsWith("APP2 (ICC")),
      [],
      "the model must not be handed the camera, the owner's name or the coordinates",
    );
    assert.ok(!onTheWire.includes(Buffer.from("A Real Person", "latin1")));
  } finally {
    server.close();
  }
});

test("a null answer comes back as an absence, not as a string", async () => {
  const { endpoint, server } = await stub(() => ({
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ summary: null, visibleText: "   " }) }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.description.summary, null);
    // Blank is an absence too: a decoder can satisfy a grammar with an empty string.
    assert.equal(outcome.description.visibleText, null);
    assert.match(outcome.description.describer, /^local-model:/);
  } finally {
    server.close();
  }
});

test('the four characters "null" are an absence too, because a real model answered them', async () => {
  // Not hypothetical: on a real run against gemma4:12b this exact answer came back for the
  // macOS wallpaper. A grammar that PERMITS null does not oblige a model to reach for it, and
  // the word arriving as content would put the title "null" in front of a reviewer.
  const { endpoint, server } = await stub(() => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({ summary: "N/A", visibleText: "null" }),
    }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.description.summary, null);
    assert.equal(outcome.description.visibleText, null);
  } finally {
    server.close();
  }
});

test("a whole answer containing the word none is still a real answer", async () => {
  const { endpoint, server } = await stub(() => ({
    status: 200,
    body: JSON.stringify({
      response: JSON.stringify({ summary: "A whiteboard with none of it erased", visibleText: null }),
    }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.description.summary, "A whiteboard with none of it erased");
  } finally {
    server.close();
  }
});

test("an answer cut off at the output ceiling is named as a cut-off, not as a mystery", async () => {
  // MEASURED: the first real run of this command hit exactly this — the model was still
  // emitting a string when the token budget ran out, so the JSON never closed. "It was cut off"
  // and "it ignored its grammar" have different remedies, and the server says which.
  const { endpoint, server } = await stub(() => ({
    status: 200,
    body: JSON.stringify({
      response: '{"summary": "A desk with a laptop", "visibleText": "the quick brown f',
      done_reason: "length",
    }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.cause, "unparseable");
    assert.match(outcome.detail, /CUT OFF/);
    assert.match(outcome.detail, /done_reason "length"/);
  } finally {
    server.close();
  }
});

test("a non-200 and an off-schema body both fail closed, with distinct causes", async () => {
  const refused = await stub(() => ({ status: 500, body: "model exploded" }));
  try {
    const outcome = await describeImage(await oneImage(), {
      endpoint: refused.endpoint,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.cause, "http-error");
  } finally {
    refused.server.close();
  }

  const prose = await stub(() => ({
    status: 200,
    body: JSON.stringify({ response: "Sure! Here is a lovely title for your photo." }),
  }));
  try {
    const outcome = await describeImage(await oneImage(), {
      endpoint: prose.endpoint,
      timeoutMs: 20_000,
    });
    // Prose where a schema was demanded is NOT salvaged into a title — it is a named failure.
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.cause, "unparseable");
  } finally {
    prose.server.close();
  }
});
