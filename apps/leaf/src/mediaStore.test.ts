/**
 * Tests for the media store, against REAL containers this file builds byte by byte.
 *
 * THE EXIF IS REAL EXIF. `exifApp1` writes an actual APP1 segment: the `Exif\0\0` prefix, a
 * little-endian TIFF header, an IFD0 carrying `Make`, `Model` and `Artist`, a GPS IFD pointer
 * (tag 0x8825) and a GPS IFD carrying `GPSLatitudeRef`, `GPSLatitude`, `GPSLongitudeRef` and
 * `GPSLongitude` as the rationals the specification requires. It is not a blob with the right
 * first four bytes — where `sips` exists, one of the tests below hands the file to sips and
 * asserts it reads back `make: ACME Phone Co`, which a lookalike would fail.
 *
 * The coordinates are 37°46'29.72"N 122°24'39.60"W — a public street corner in San Francisco,
 * chosen precisely because it is nobody's home. Nothing in this file is anyone's photograph.
 *
 * WHY THE POST-CONDITION IS ASSERTED AGAINST THE FILE AND NOT AGAINST THE REPORT. A test that
 * checks `report.removed` contains "APP1 (Exif)" is checking our own bookkeeping — it would pass
 * on a stripper that wrote the record and kept the segment. So every strip test walks the OUTPUT
 * with `jpegMetadataSegments` / `pngMetadataChunks` and asserts the segment is gone from the
 * bytes. The report is checked too, separately, because an operator reads it.
 *
 * THE MEASURED FACT THIS MODULE EXISTS FOR is re-asserted here rather than trusted: on a machine
 * with `sips`, `stripsWithSipsMeasured` converts and downscales the EXIF-bearing JPEG and asserts
 * sips STILL reports `make`. If that ever stops being true, this file says so instead of quietly
 * over-justifying a stripper nobody needs.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
  MAX_OBJECT_BYTES,
  jpegMetadataSegments,
  mediaObjectDir,
  mediaRootFor,
  parseMediaRef,
  pngMetadataChunks,
  putImage,
  readMedia,
  stripGif,
  stripJpeg,
  stripPng,
  summarizeStore,
} from "./mediaStore.ts";

const exec = promisify(execFile);
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-media-test-"));
  tmpRoots.push(dir);
  return dir;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Can sips run here? The measured branches are SKIPPED out loud rather than passing quietly. */
async function sipsRuns(): Promise<boolean> {
  try {
    await exec("sips", ["--version"], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

function skip(why: string): void {
  process.stdout.write(`SKIPPED: ${why}\n`);
}

/* ═══════════════════════════════════════════════════════ building real containers ═══════ */

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

/** A REAL PNG: 8-bit truecolour, deflated exactly as the format requires. */
function realPng(width: number, height: number, colour: number, extra: readonly Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = (colour + x) % 256;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * A REAL EXIF APP1 payload with a REAL GPS IFD.
 *
 * Built to the TIFF layout the EXIF specification fixes: header, IFD0 with an entry count and
 * 12-byte entries, a GPS IFD pointer, the GPS IFD, then a heap for values longer than four bytes.
 */
function exifApp1(): Buffer {
  const ascii = (s: string): Buffer => Buffer.from(`${s}\0`, "latin1");
  const rationals = (pairs: readonly [number, number][]): Buffer => {
    const b = Buffer.alloc(pairs.length * 8);
    pairs.forEach(([n, d], i) => {
      b.writeUInt32LE(n, i * 8);
      b.writeUInt32LE(d, i * 8 + 4);
    });
    return b;
  };
  interface Entry {
    readonly tag: number;
    /** 2 = ASCII, 5 = RATIONAL. */
    readonly type: 2 | 5;
    readonly data: Buffer;
  }
  const ifd0: readonly Entry[] = [
    { tag: 0x010f, type: 2, data: ascii("ACME Phone Co") },
    { tag: 0x0110, type: 2, data: ascii("Pocket 9") },
    { tag: 0x013b, type: 2, data: ascii("A Real Person") },
  ];
  const gps: readonly Entry[] = [
    { tag: 0x0001, type: 2, data: ascii("N") },
    { tag: 0x0002, type: 5, data: rationals([[37, 1], [46, 1], [2972, 100]]) },
    { tag: 0x0003, type: 2, data: ascii("W") },
    { tag: 0x0004, type: 5, data: rationals([[122, 1], [24, 1], [3960, 100]]) },
  ];
  const TIFF_HEADER = 8;
  const ifd0Size = 2 + (ifd0.length + 1) * 12 + 4;
  const gpsOffset = TIFF_HEADER + ifd0Size;
  let heapAt = gpsOffset + 2 + gps.length * 12 + 4;
  const heap: Buffer[] = [];

  const entryBytes = (e: Entry): Buffer => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(e.tag, 0);
    b.writeUInt16LE(e.type, 2);
    b.writeUInt32LE(e.type === 2 ? e.data.length : e.data.length / 8, 4);
    if (e.data.length <= 4) {
      e.data.copy(b, 8);
    } else {
      b.writeUInt32LE(heapAt, 8);
      heap.push(e.data);
      heapAt += e.data.length;
    }
    return b;
  };

  const count0 = Buffer.alloc(2);
  count0.writeUInt16LE(ifd0.length + 1);
  const ifd0Bytes = ifd0.map(entryBytes);
  const gpsPointer = Buffer.alloc(12);
  gpsPointer.writeUInt16LE(0x8825, 0);
  gpsPointer.writeUInt16LE(4, 2);
  gpsPointer.writeUInt32LE(1, 4);
  gpsPointer.writeUInt32LE(gpsOffset, 8);

  const countGps = Buffer.alloc(2);
  countGps.writeUInt16LE(gps.length);
  const gpsBytes = gps.map(entryBytes);

  return Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    count0,
    ...ifd0Bytes,
    gpsPointer,
    Buffer.alloc(4),
    countGps,
    ...gpsBytes,
    Buffer.alloc(4),
    ...heap,
  ]);
}

/** Wrap a payload in a JPEG marker segment, with the two-byte length the format requires. */
function segment(marker: number, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.byteLength + 2, 2);
  return Buffer.concat([head, Buffer.from(payload)]);
}

/**
 * A JPEG with real marker STRUCTURE: quantization table, frame header, Huffman table, scan.
 *
 * The pixels are not decodable and are not meant to be — this exercises the marker walk, which
 * is all the stripper does. The tests that need a decodable image build one with `sips` and skip
 * where sips is absent, so both halves are covered honestly rather than one pretending to be the
 * other.
 */
function structuredJpeg(before: readonly Buffer[] = [], after: readonly Buffer[] = []): Buffer {
  const scan = Buffer.from([
    0x12,
    0x34,
    0xff,
    0x00, // a literal 0xFF inside entropy data, byte-stuffed as the format requires
    0x56,
    0xff,
    0xd2, // a restart marker mid-scan
    0x78,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...before,
    segment(0xdb, Buffer.alloc(65, 3)),
    segment(0xc0, Buffer.from([0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00])),
    segment(0xc4, Buffer.alloc(20, 1)),
    segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    scan,
    ...after,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A REAL 1×1 GIF, LZW data and all, optionally carrying extension blocks. */
function realGif(extensions: readonly Buffer[] = []): Buffer {
  return Buffer.concat([
    Buffer.from("GIF89a", "latin1"),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]), // 2-entry global colour table
    ...extensions,
    Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]),
    Buffer.from([0x3b]),
  ]);
}

function gifExtension(label: number, payload: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from([0x21, label, payload.byteLength]),
    Buffer.from(payload),
    Buffer.from([0x00]),
  ]);
}

/* ══════════════════════════════════════════════════════════════ the measured premise ════ */

test("MEASURED: sips carries EXIF through both a conversion and a downscale", async () => {
  if (!(await sipsRuns())) {
    skip("sips is not available, so the premise this module is built on was not re-measured.");
    return;
  }
  const dir = await tempDir();
  await writeFile(join(dir, "base.png"), realPng(64, 48, 7));
  await exec("sips", ["-s", "format", "jpeg", join(dir, "base.png"), "--out", join(dir, "base.jpg")]);
  const plain = await readFile(join(dir, "base.jpg"));
  const withExif = Buffer.concat([
    plain.subarray(0, 2),
    segment(0xe1, exifApp1()),
    plain.subarray(2),
  ]);
  await writeFile(join(dir, "gps.jpg"), withExif);

  // sips reads what was written: the EXIF is real, not a byte pattern.
  const read = await exec("sips", ["-g", "all", join(dir, "gps.jpg")]);
  assert.match(read.stdout, /make: ACME Phone Co/);
  assert.match(read.stdout, /artist: A Real Person/);

  // AND IT SURVIVES BOTH OPERATIONS. This is why sips is not the stripper.
  await exec("sips", ["-s", "format", "jpeg", join(dir, "gps.jpg"), "--out", join(dir, "round.jpg")]);
  await exec("sips", ["-Z", "32", join(dir, "gps.jpg"), "--out", join(dir, "small.jpg")]);
  for (const name of ["round.jpg", "small.jpg"]) {
    const after = await exec("sips", ["-g", "all", join(dir, name)]);
    assert.match(
      after.stdout,
      /make: ACME Phone Co/,
      `${name}: sips no longer carries EXIF through — the header's measurement needs re-stating`,
    );
    const bytes = await readFile(join(dir, name));
    assert.ok(
      jpegMetadataSegments(bytes).some((s) => s.includes("Exif")),
      `${name}: the EXIF segment should still be in the file sips produced`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════ the JPEG strip ══════ */

test("a real EXIF APP1 with a GPS IFD is removed from the bytes, not merely from the report", () => {
  const input = structuredJpeg([segment(0xe1, exifApp1())]);
  assert.ok(
    jpegMetadataSegments(input).some((s) => s === "APP1 (Exif)"),
    "the input must actually carry the segment, or this test proves nothing",
  );

  const out = stripJpeg(input);
  assert.equal(out.ok, true);
  if (!out.ok) return;

  // THE FILE, not the bookkeeping.
  assert.deepEqual(jpegMetadataSegments(out.bytes), []);
  assert.ok(!Buffer.from(out.bytes).includes(Buffer.from("Exif\0\0", "latin1")));
  assert.ok(!Buffer.from(out.bytes).includes(Buffer.from("A Real Person", "latin1")));

  // AND the report, separately, because an operator reads it.
  const exifRecord = out.report.removed.find((r) => r.what === "APP1 (Exif)");
  assert.ok(exifRecord !== undefined, "the removal must be reported by name");
  assert.equal(exifRecord.bytes, segment(0xe1, exifApp1()).byteLength);
  assert.equal(out.report.method, "jpeg-segments");
});

test("the scan survives the walk byte for byte, stuffing and restart markers included", () => {
  const clean = structuredJpeg();
  const dirty = structuredJpeg([segment(0xe1, exifApp1()), segment(0xfe, Buffer.from("a note"))]);
  const out = stripJpeg(dirty);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  // Removing metadata must leave EXACTLY the file that never had it: same structure, same scan.
  assert.equal(sha256(out.bytes), sha256(clean));
});

test("a JPEG with nothing to remove comes back byte-identical", () => {
  const clean = structuredJpeg();
  const out = stripJpeg(clean);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(sha256(out.bytes), sha256(clean));
  assert.deepEqual(out.report.removed, []);
});

test("an ICC profile is kept and reported; the MPF second image in the same marker is not", () => {
  const icc = Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.alloc(40, 9)]);
  const mpf = Buffer.concat([Buffer.from("MPF\0", "latin1"), Buffer.alloc(40, 9)]);
  const out = stripJpeg(structuredJpeg([segment(0xe2, icc), segment(0xe2, mpf)]));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(
    out.report.retained.map((r) => r.what),
    ["APP2 (ICC_PROFILE)"],
  );
  assert.ok(
    out.report.removed.some((r) => r.what.includes("MPF")),
    "MPF shares APP2 with ICC and carries its own EXIF; a rule written per-marker would keep it",
  );
  assert.deepEqual(jpegMetadataSegments(out.bytes), ["APP2 (ICC_PROFILE)"]);
});

test("bytes appended after EOI are dropped and counted", () => {
  const tail = Buffer.concat([segment(0xe1, exifApp1())]);
  const input = Buffer.concat([structuredJpeg(), tail]);
  const out = stripJpeg(input);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const record = out.report.removed.find((r) => r.what === "bytes trailing after EOI");
  assert.ok(record !== undefined);
  assert.equal(record.bytes, tail.byteLength);
  assert.equal(sha256(out.bytes), sha256(structuredJpeg()));
});

test("bytes that are not a JPEG are refused rather than half-copied", () => {
  const out = stripJpeg(Buffer.from("this is prose, not a photograph", "utf8"));
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.cause, "unparseable-container");
});

test("a segment whose declared length runs past the end is refused", () => {
  const truncated = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]),
    Buffer.alloc(4),
  ]);
  const out = stripJpeg(truncated);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.cause, "unparseable-container");
  assert.match(out.detail, /runs past the end/);
});

test("the stripped JPEG is still a decodable image with the same pixels", async () => {
  if (!(await sipsRuns())) {
    skip("sips is not available, so the stripped JPEG was not decoded.");
    return;
  }
  const dir = await tempDir();
  await writeFile(join(dir, "base.png"), realPng(64, 48, 7));
  await exec("sips", ["-s", "format", "jpeg", join(dir, "base.png"), "--out", join(dir, "b.jpg")]);
  const plain = await readFile(join(dir, "b.jpg"));
  const dirty = Buffer.concat([plain.subarray(0, 2), segment(0xe1, exifApp1()), plain.subarray(2)]);

  const out = stripJpeg(dirty);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  await writeFile(join(dir, "clean.jpg"), out.bytes);

  const read = await exec("sips", ["-g", "all", join(dir, "clean.jpg")]);
  assert.match(read.stdout, /pixelWidth: 64/);
  assert.match(read.stdout, /pixelHeight: 48/);
  assert.ok(!/make: ACME Phone Co/.test(read.stdout), "sips must no longer see the camera");
  assert.ok(!/artist: A Real Person/.test(read.stdout), "sips must no longer see the owner");
});

/* ═══════════════════════════════════════════════════════════════════ the PNG strip ══════ */

test("PNG text and eXIf chunks go; the critical chunks and the colour profile stay", () => {
  const exif = pngChunk("eXIf", exifApp1().subarray(6));
  const text = pngChunk("tEXt", Buffer.from("Author\0A Real Person", "latin1"));
  const intl = pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>", "latin1"));
  const time = pngChunk("tIME", Buffer.from([0x07, 0xea, 1, 1, 0, 0, 0]));
  const srgb = pngChunk("sRGB", Buffer.from([0]));
  const input = realPng(6, 4, 3, [exif, text, intl, time, srgb]);
  assert.deepEqual([...pngMetadataChunks(input)].sort(), ["eXIf", "iTXt", "tEXt", "tIME"]);

  const out = stripPng(input);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(pngMetadataChunks(out.bytes), []);
  assert.ok(!Buffer.from(out.bytes).includes(Buffer.from("A Real Person", "latin1")));
  assert.equal(sha256(out.bytes), sha256(realPng(6, 4, 3, [srgb])));
  assert.deepEqual(
    out.report.removed.map((r) => r.what).sort(),
    [
      "eXIf (EXIF, including GPS)",
      "iTXt (international text — where XMP lives)",
      "tEXt (uncompressed text)",
      "tIME (last-modified time)",
    ],
  );
});

test("an ancillary chunk this list has never heard of is dropped, not kept by default", () => {
  const unknown = pngChunk("xYzZ", Buffer.from("whatever a future phone writes", "latin1"));
  const out = stripPng(realPng(4, 4, 1, [unknown]));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(pngMetadataChunks(out.bytes), []);
  assert.deepEqual(out.report.removed.map((r) => r.what), ["xYzZ (ancillary)"]);
});

test("a PNG with nothing to remove comes back byte-identical", () => {
  const clean = realPng(5, 5, 12);
  const out = stripPng(clean);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(sha256(out.bytes), sha256(clean));
});

test("the stripped PNG is still a decodable image with the same pixels", async () => {
  if (!(await sipsRuns())) {
    skip("sips is not available, so the stripped PNG was not decoded.");
    return;
  }
  const dir = await tempDir();
  const out = stripPng(realPng(12, 9, 20, [pngChunk("tEXt", Buffer.from("a\0b", "latin1"))]));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  await writeFile(join(dir, "clean.png"), out.bytes);
  const read = await exec("sips", ["-g", "all", join(dir, "clean.png")]);
  assert.match(read.stdout, /pixelWidth: 12/);
  assert.match(read.stdout, /pixelHeight: 9/);
});

/* ═══════════════════════════════════════════════════════════════════ the GIF strip ══════ */

test("a GIF comment goes, and the loop count stays", () => {
  const comment = gifExtension(0xfe, Buffer.from("shot at home", "latin1"));
  const netscape = gifExtension(0xff, Buffer.from("NETSCAPE2.0", "latin1"));
  const out = stripGif(realGif([comment, netscape]));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.ok(!Buffer.from(out.bytes).includes(Buffer.from("shot at home", "latin1")));
  assert.ok(Buffer.from(out.bytes).includes(Buffer.from("NETSCAPE2.0", "latin1")));
  assert.equal(sha256(out.bytes), sha256(realGif([netscape])));
  assert.deepEqual(out.report.removed.map((r) => r.what), ["comment extension"]);
});

test("an XMP application extension goes with everything else that is not the loop count", () => {
  const xmp = gifExtension(0xff, Buffer.from("XMP DataXMP", "latin1"));
  const out = stripGif(realGif([xmp]));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(sha256(out.bytes), sha256(realGif()));
});

/* ══════════════════════════════════════════════════════════════════════ the store ═══════ */

async function put(root: string, path: string, format: string, sips = true) {
  const bytes = await readFile(path);
  return putImage({
    root,
    sourcePath: path,
    sourceDigest: sha256(bytes),
    sourceFormat: format,
    sipsRuns: sips,
  });
}

test("a put writes the bytes and the manifest, and the store ignores itself from git", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "one.png");
  await writeFile(file, realPng(8, 6, 40, [pngChunk("tEXt", Buffer.from("who\0me", "latin1"))]));

  const outcome = await put(root, file, "png");
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.detail);
  if (!outcome.ok) return;
  assert.equal(outcome.stored, "written");

  const object = await readFile(join(outcome.dir, "published"));
  assert.equal(`sha256:${sha256(object)}`, outcome.manifest.publishedDigest);
  assert.notEqual(outcome.manifest.publishedDigest, outcome.manifest.ref);
  assert.deepEqual(pngMetadataChunks(object), []);

  assert.equal(await readFile(join(root, ".gitignore"), "utf8"), expect(`*`));
});

/** The store's own ignore rule, matched on the line that matters rather than the whole comment. */
function expect(rule: string): string {
  return `# A media store: one person's photographs, addressed by digest.\n${rule}\n`;
}

test("the digest an object is filed under is the one a second implementation computes", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "clean.png");
  await writeFile(file, realPng(7, 7, 90));
  const outcome = await put(root, file, "png");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  let independent: string;
  try {
    const { stdout } = await exec("shasum", ["-a", "256", file], { timeout: 60_000 });
    independent = (stdout.split(/\s+/)[0] ?? "").trim();
  } catch {
    skip("shasum is not installed; the store's address was not cross-checked.");
    return;
  }
  assert.equal(outcome.manifest.ref, `sha256:${independent}`);
  assert.equal(mediaObjectDir(root, independent), outcome.dir);
});

test("a second put of the same file writes nothing and says so", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "a.png");
  await writeFile(file, realPng(5, 5, 5));
  assert.equal((await put(root, file, "png")).ok, true);
  const again = await put(root, file, "png");
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.stored, "already-present");
});

test("a file that changed between the scan and the put is refused, and nothing is written", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "moving.png");
  await writeFile(file, realPng(4, 4, 1));
  const stale = sha256(realPng(4, 4, 200));

  const outcome = await putImage({
    root,
    sourcePath: file,
    sourceDigest: stale,
    sourceFormat: "png",
    sipsRuns: true,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "source-digest-mismatch");
  await assert.rejects(readdir(mediaObjectDir(root, stale)), /ENOENT/);
});

test("a container that needs the decoder is REFUSED when the decoder is absent", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "phone.heic");
  // The bytes never reach a decoder: the refusal happens on the container name and the toolchain.
  await writeFile(file, Buffer.from("\0\0\0\x18ftypheic\0\0\0\0 pretend payload", "latin1"));

  const outcome = await put(root, file, "heif", false);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "no-stripper");
  assert.match(outcome.detail, /NOTHING WAS STORED/);
  // The whole point: no object, so nothing unstripped can ever be served.
  await assert.rejects(readdir(join(root, "sha256")), /ENOENT/);
});

test("an unknown container is refused rather than published unstripped", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "odd.bin");
  await writeFile(file, Buffer.alloc(64, 7));
  const outcome = await put(root, file, "bmp");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "unsupported-container");
});

test("a HEIF photograph is decoded, stripped and published as a JPEG", async () => {
  if (!(await sipsRuns())) {
    skip("sips is not available, so the transcode path was not exercised.");
    return;
  }
  const dir = await tempDir();
  const root = join(dir, "media");
  await writeFile(join(dir, "base.png"), realPng(48, 32, 11));
  const heic = join(dir, "photo.heic");
  try {
    await exec("sips", ["-s", "format", "heic", join(dir, "base.png"), "--out", heic]);
  } catch {
    skip("this sips cannot WRITE heic, so no real HEIF file could be built.");
    return;
  }
  const outcome = await put(root, heic, "heif");
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.detail);
  if (!outcome.ok) return;
  assert.equal(outcome.manifest.publishedFormat, "jpeg");
  assert.equal(outcome.manifest.strip.transcodedFrom, "heif");
  assert.equal(outcome.manifest.strip.method, "sips-transcode+jpeg-segments");

  const object = await readFile(join(outcome.dir, "published"));
  assert.deepEqual(
    jpegMetadataSegments(object).filter((s) => !s.startsWith("APP2 (ICC")),
    [],
    "the JPEG sips decoded to must carry no metadata after the strip",
  );
});

/* ══════════════════════════════════════════════════════════════════════ the read ════════ */

test("a read hashes what it is about to hand back, and says which digest proved it", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const clean = join(dir, "clean.png");
  const dirty = join(dir, "dirty.png");
  await writeFile(clean, realPng(6, 6, 30));
  await writeFile(dirty, realPng(6, 6, 30, [pngChunk("tEXt", Buffer.from("a\0b", "latin1"))]));
  const putClean = await put(root, clean, "png");
  const putDirty = await put(root, dirty, "png");
  assert.equal(putClean.ok && putDirty.ok, true);
  if (!putClean.ok || !putDirty.ok) return;

  const readClean = await readMedia(root, putClean.ref);
  assert.equal(readClean.ok, true);
  if (!readClean.ok) return;
  assert.equal(readClean.contentType, "image/png");
  assert.equal(readClean.verifiedAgainst, "ref", "nothing was stripped, so the ref itself checks");
  assert.equal(sha256(readClean.bytes), putClean.ref.slice("sha256:".length));

  const readDirty = await readMedia(root, putDirty.ref);
  assert.equal(readDirty.ok, true);
  if (!readDirty.ok) return;
  assert.equal(
    readDirty.verifiedAgainst,
    "manifest",
    "these bytes are a derived rendition; saying the ref checked them would be false",
  );
});

test("a corrupted object is NOT a 'not found' — it is its own named failure", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "a.png");
  await writeFile(file, realPng(9, 9, 44));
  const stored = await put(root, file, "png");
  assert.equal(stored.ok, true);
  if (!stored.ok) return;

  await writeFile(join(stored.dir, "published"), realPng(9, 9, 45));
  const read = await readMedia(root, stored.ref);
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.cause, "digest-mismatch");
  assert.match(read.detail, /NOTHING WAS SERVED/);
  assert.ok(read.detail.trim().split(/\s+/).length < 45, "an error state is a fact and a remedy");

  const absent = await readMedia(root, `sha256:${"0".repeat(64)}`);
  assert.equal(absent.ok, false);
  if (absent.ok) return;
  assert.equal(absent.cause, "not-in-store");
});

test("an object whose bytes were deleted reads as incomplete, never as verified", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "a.png");
  await writeFile(file, realPng(3, 3, 2));
  const stored = await put(root, file, "png");
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  await rm(join(stored.dir, "published"));

  const read = await readMedia(root, stored.ref);
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.cause, "incomplete-object");
});

test("a ref that is not sha256 plus 64 hex characters never reaches the filesystem", () => {
  for (const bad of [
    "../../etc/passwd",
    "sha256:../../etc/passwd",
    "md5:0123456789abcdef",
    `sha256:${"A".repeat(64)}`,
    `sha256:${"0".repeat(63)}`,
    "",
  ]) {
    assert.equal(parseMediaRef(bad).ok, false, `${bad} must be refused`);
  }
  assert.equal(parseMediaRef(`sha256:${"a".repeat(64)}`).ok, true);
});

test("the store summarises what it removed, from the manifests rather than a running total", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  await writeFile(join(dir, "clean.png"), realPng(4, 4, 1));
  await writeFile(
    join(dir, "dirty.png"),
    realPng(4, 4, 2, [pngChunk("tEXt", Buffer.from("where\0here", "latin1"))]),
  );
  await put(root, join(dir, "clean.png"), "png");
  const dirty = await put(root, join(dir, "dirty.png"), "png");
  assert.equal(dirty.ok, true);
  if (!dirty.ok) return;

  const summary = await summarizeStore(root);
  assert.equal(summary.objects, 2);
  assert.equal(summary.withMetadataRemoved, 1);
  assert.equal(summary.metadataBytesRemoved, dirty.manifest.strip.removed[0]?.bytes);
  assert.equal(summary.incomplete, 0);
  assert.equal(summary.unreadable, null);
});

test("a store that does not exist summarises as empty rather than as broken", async () => {
  const summary = await summarizeStore(join(await tempDir(), "never-created"));
  assert.equal(summary.objects, 0);
  assert.equal(summary.unreadable, null);
});

test("the ceiling on an object read whole into memory is a stated number", () => {
  assert.equal(MAX_OBJECT_BYTES, 64 * 1024 * 1024);
});

test("the default store is beside the leaf document, not inside the app", () => {
  assert.equal(mediaRootFor("/somewhere/portfolio/leaf.json"), "/somewhere/portfolio/media");
});

/* ═══════════════════════════════════════════════════════════ the route, end to end ══════ */

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => fail(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => done(port));
    });
  });
}

interface Fetched {
  readonly status: number;
  readonly bytes: Buffer;
  readonly type: string;
}

/** Start the REAL server on a real port, speak real HTTP to it, always kill it. */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (get: (path: string) => Promise<Fetched>) => Promise<void>,
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

  const get = async (path: string): Promise<Fetched> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    return {
      status: res.status,
      bytes: Buffer.from(await res.arrayBuffer()),
      type: res.headers.get("content-type") ?? "",
    };
  };

  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (exited !== null) throw new Error(`server exited before serving:\n${stderr}`);
      try {
        await get("/");
        break;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`server never answered: ${String(err)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body(get);
  } finally {
    child.kill("SIGKILL");
  }
}

/** A leaf document holding one leaflet whose evidence is the image in the store. */
function leafNaming(ref: string, visibility: string | null) {
  return {
    id: "leaf-media-test",
    subject: "Media Route Test",
    leaflets: [
      {
        id: "photo:one",
        title: "one photograph",
        tier: "pending",
        provenance: { source: "photo", ref, observedAt: "2026-08-19T00:00:00Z" },
        ...(visibility === null ? {} : { visibility }),
      },
    ],
  };
}

test("the route serves the real bytes, and only for a leaflet that is really shared", async () => {
  const dir = await tempDir();
  const root = join(dir, "media");
  const file = join(dir, "photo.png");
  await writeFile(file, realPng(16, 12, 33, [pngChunk("tEXt", Buffer.from("gps\0here", "latin1"))]));
  const stored = await put(root, file, "png");
  assert.equal(stored.ok, true, stored.ok ? "" : stored.detail);
  if (!stored.ok) return;
  const object = await readFile(join(stored.dir, "published"));

  const leafPath = join(dir, "subject.leaf.json");
  const env = { FOLIAGE_LEAF: leafPath, FOLIAGE_MEDIA: root };

  // PRIVATE BY DEFAULT: the leaflet is not shared, so its photograph is not there either.
  await writeFile(leafPath, JSON.stringify(leafNaming(stored.ref, null)), "utf8");
  await withServer(env, async (get) => {
    const answer = await get(`/media/${stored.ref}`);
    assert.equal(answer.status, 404, "a private leaflet must not leak its bytes");
  });

  // SHARED: the same address answers with the same bytes the store holds.
  await writeFile(leafPath, JSON.stringify(leafNaming(stored.ref, "unlisted")), "utf8");
  await withServer(env, async (get) => {
    const answer = await get(`/media/${stored.ref}`);
    assert.equal(answer.status, 200);
    assert.equal(answer.type, "image/png");
    assert.equal(sha256(answer.bytes), sha256(object));
    assert.deepEqual(pngMetadataChunks(answer.bytes), [], "served bytes must carry no metadata");

    // A digest no leaflet names is 404 whether or not the store holds it — no probing.
    const other = await get(`/media/sha256:${"b".repeat(64)}`);
    assert.equal(other.status, 404);
    const nonsense = await get("/media/not-a-ref");
    assert.equal(nonsense.status, 404);
  });

  // CORRUPTED: a 500 that names the failure, never a 404 that hides it.
  await writeFile(join(stored.dir, "published"), realPng(16, 12, 34));
  await withServer(env, async (get) => {
    const answer = await get(`/media/${stored.ref}`);
    assert.equal(answer.status, 500);
    assert.match(answer.bytes.toString("utf8"), /are not what that ref names/);
    assert.equal(answer.bytes.toString("utf8").split("refused:").length, 2, "one refusal, not two");
  });
});

test("with no store, a shared leaflet's photograph is an honest 404 rather than a crash", async () => {
  const dir = await tempDir();
  const leafPath = join(dir, "subject.leaf.json");
  const ref = `sha256:${"c".repeat(64)}`;
  await writeFile(leafPath, JSON.stringify(leafNaming(ref, "public")), "utf8");
  await mkdir(join(dir, "empty-store"), { recursive: true });
  await withServer(
    { FOLIAGE_LEAF: leafPath, FOLIAGE_MEDIA: join(dir, "empty-store") },
    async (get) => {
      const answer = await get(`/media/${ref}`);
      assert.equal(answer.status, 404);
    },
  );
});
