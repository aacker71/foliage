/**
 * THE PHOTO CLI SEAM. `harvest.mjs propose-photos` as a real child process, over real
 * directories, judged by its real stdout and its real exit code.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `photoSource.test.ts` proves the reader identifies and hashes
 * what is on disk. `photoIntake.test.ts` proves the domain's judgement about those observations.
 * Both were green, on every commit, while the command that joins them wrote
 * `{"candidates": []}` and exited 0 over a directory it had been locked out of — printing "0
 * images is the honest result here … none of them is an image by its bytes" about a file whose
 * first byte it never read. Nothing in either half can see that, because the sentence, the exit
 * code and the decision to write live only in the CLI, and no automated test had ever run the
 * CLI. That is the same gap `seam.test.ts` was written to close for the server, and this file
 * closes it the same way: spawn the real process, assert on the bytes it prints and the files it
 * leaves behind.
 *
 * WHAT THE IMAGES HERE ARE. Solid-colour rectangles encoded by the PNG writer below, plus one
 * file that is a PNG signature followed by prose. They are TEST CONSTRUCTION — not photographs,
 * not evidence, and no candidate drafted from them means anything about anybody. What they
 * exercise is which STATE the command decides it is in, and every state below is one the machine
 * this was written on can actually produce.
 *
 * The PNG writer is deliberately a second copy of the one in `photoSource.test.ts` rather than a
 * shared import. Sharing it would put a module in `apps/leaf/src/` that exists only for tests —
 * app source a self-hoster downloads to serve a test — and that is a worse trade than two
 * readable copies of an encoder that is fixed by a published specification and cannot drift.
 *
 * DISCIPLINE, as in `seam.test.ts`: every child has a timeout, and no test asserts on prose that
 * a command could not produce.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

/** Per-invocation ceiling. A wedged child must fail this suite, never hang it. */
const RUN_TIMEOUT_MS = 60_000;

const tmpRoots: string[] = [];
after(async () => {
  // A test below leaves a file at mode 0o000. Removing it is governed by the DIRECTORY's mode,
  // not the file's, so this still cleans up — and a cleanup that fails anyway must not throw
  // here, where it would replace a real test result with a teardown error.
  for (const dir of tmpRoots) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-harvest-cli-"));
  tmpRoots.push(dir);
  return dir;
}

/* --------------------------------------------------------------------- a real PNG ---- */

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

/** A REAL PNG: 8-bit truecolour, one solid colour, deflated exactly as the format requires. */
function realPng(width: number, height: number, colour: number): Buffer {
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
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/* ------------------------------------------------------------------- running it ---- */

interface Run {
  /** 0, a non-zero exit code, or the string node reports for a killed child. */
  readonly code: number | string;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout and stderr together, for assertions that do not care which stream carried it. */
  readonly output: string;
}

/** Run the REAL command — the same entry point the README tells a self-hoster to run. */
function harvest(...args: readonly string[]): Promise<Run> {
  return harvestWithEnv({}, ...args);
}

/**
 * The same run, with variables added to the child's environment.
 *
 * IT EXISTS FOR ONE VARIABLE. `FOLIAGE_OLLAMA_URL` is the only way to point this command at a
 * model endpoint a test controls: 11434 is a fixed well-known port, and a test that bound it
 * would either collide with the operator's real ollama or send these images to it.
 */
function harvestWithEnv(env: Readonly<Record<string, string>>, ...args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [HARVEST, ...args],
      { encoding: "utf8", timeout: RUN_TIMEOUT_MS, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        const code = err === null ? 0 : (err.code ?? 1);
        resolve({ code, stdout, stderr, output: `${stdout}${stderr}` });
      },
    );
  });
}

/** A real HTTP server on a real ephemeral loopback port. Port 0 so nothing collides. */
function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: (server.address() as { port: number }).port }),
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface HarvestFile {
  readonly candidates: readonly { readonly id: string; readonly title: string }[];
}

async function readHarvest(path: string): Promise<HarvestFile> {
  return JSON.parse(await readFile(path, "utf8")) as HarvestFile;
}

/** The sentence that may only be printed about files that were actually read. */
const HONEST_EMPTY = "0 images is the honest result here";

/* ------------------------------------------------------------------------ tests ---- */

test(
  "a file that could NOT be read writes no document, and is never called an honest empty",
  { timeout: 90_000 },
  async () => {
    // THE REGRESSION THIS FILE WAS WRITTEN FOR. Reproduced by hand before it was fixed: this
    // directory scanned to 0 images, exited 0, wrote {"candidates": []}, and asserted that none
    // of its files is an image "by its bytes" — about a file EACCES had kept it out of.
    const dir = await tempDir();
    const locked = join(dir, "secret.png");
    await writeFile(locked, realPng(40, 30, 5));
    chmodSync(locked, 0o000);

    // Only assert this where the machine actually enforces it. Running as root, or on a
    // filesystem that ignores the mode, the condition does not exist and a passing assertion
    // would be a test that cannot fail.
    let enforced = false;
    try {
      const handle = await open(locked, "r");
      await handle.close();
    } catch {
      enforced = true;
    }
    if (!enforced) {
      process.stdout.write(
        "SKIPPED: this machine let the test read a 0o000 file, so the locked-out state could " +
          "not be created here.\n",
      );
      return;
    }

    const out = join(await tempDir(), "harvest.json");
    const run = await harvest("propose-photos", "--dir", dir, "--out", out);

    assert.notEqual(run.code, 0, "a failed read must not exit 0");
    assert.equal(await exists(out), false, "NOTHING may be written after a failed read");
    assert.match(run.output, /file-unreadable/, "the cause must be named, not summarised");
    assert.ok(run.output.includes(locked), "the file that could not be read must be named");
    assert.match(run.output, /NOTHING was written/);
    assert.ok(
      !run.output.includes(HONEST_EMPTY),
      `"${HONEST_EMPTY}" is a claim about bytes that were read; this run read none`,
    );
  },
);

test(
  "a directory that WAS fully read and holds no image is an honest empty harvest",
  { timeout: 90_000 },
  async () => {
    // The other half of the pair above, and the reason the pair matters: these two situations
    // must not print one conclusion. Here every file really was opened and read.
    const dir = await tempDir();
    await writeFile(join(dir, "notes.txt"), "prose, and not an image\n", "utf8");
    await writeFile(join(dir, "zero.png"), "");

    const out = join(await tempDir(), "harvest.json");
    const run = await harvest("propose-photos", "--dir", dir, "--out", out);

    assert.equal(run.code, 0, run.output);
    assert.ok(run.stdout.includes(HONEST_EMPTY), run.output);
    assert.deepEqual((await readHarvest(out)).candidates, []);

    // A 0-byte file is NOT "not an image by its bytes" — that sentence claims bytes were read.
    // It is counted apart, and the count that says so is on the scan line.
    assert.match(run.stdout, /1 non-image file\(s\), 1 empty file\(s\)/);
    assert.ok(run.stdout.includes(join(dir, "zero.png")), "the empty file must be named");
    assert.match(run.stdout, /nothing failed to open/);
  },
);

test(
  "real image files become candidates whose refs are the files' real digests",
  { timeout: 90_000 },
  async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "one.png"), realPng(12, 8, 3));
    await writeFile(join(dir, "two.png"), realPng(12, 8, 90));
    const out = join(await tempDir(), "harvest.json");

    const run = await harvest("propose-photos", "--dir", dir, "--out", out);
    assert.equal(run.code, 0, run.output);

    const document = await readHarvest(out);
    assert.equal(document.candidates.length, 2);

    // The ref in the document must be the digest of the bytes on disk, computed here a second
    // time — the CLI's own arithmetic is not evidence for the CLI's own arithmetic.
    const { createHash } = await import("node:crypto");
    for (const name of ["one.png", "two.png"]) {
      const digest = createHash("sha256")
        .update(await readFile(join(dir, name)))
        .digest("hex");
      assert.ok(
        document.candidates.some((c) => c.id === `photo:sha256:${digest}`),
        `${name}: no candidate carries the digest of the file that was read`,
      );
    }

    // And the document this command wrote is one this command can read back.
    const listed = await harvest("review", "--doc", out);
    assert.equal(listed.code, 0, listed.output);
    assert.match(listed.stdout, /2 candidate\(s\)/);
    for (const candidate of document.candidates) {
      assert.ok(listed.stdout.includes(candidate.id), `review must list ${candidate.id}`);
    }
  },
);

test(
  "a rating-shaped FILE NAME never reaches a title, and the refusal is printed",
  { timeout: 90_000 },
  async () => {
    // The name is a measured fact, so it is not rewritten — it is withheld from the title and
    // reported verbatim, where the operator (the only person entitled to rename their own file)
    // can see exactly what was held back.
    const dir = await tempDir();
    const name = "design-critique-9 out of 10.png";
    await writeFile(join(dir, name), realPng(16, 9, 44));
    const out = join(await tempDir(), "harvest.json");

    const run = await harvest("propose-photos", "--dir", dir, "--out", out);
    assert.equal(run.code, 0, run.output);

    const document = await readHarvest(out);
    assert.equal(document.candidates.length, 1);
    const title = document.candidates[0]!.title;
    assert.doesNotMatch(title, /9 out of 10/, "a rating must not be smuggled into a title");
    assert.match(title, /file name withheld/);

    // Withheld, not lost: the operator is told, and told which file.
    assert.match(run.stdout, /refused file name/);
    assert.ok(run.stdout.includes(name), "the refused name must be shown in full");
  },
);

test(
  "when a pixel size could not be measured, the CLI prints the reason it could not",
  { timeout: 90_000 },
  async () => {
    // A PNG signature followed by prose: identified as a PNG by its bytes, decodable by nothing.
    // On this machine `sips -g pixelWidth` prints `<nil>` and exits 0, so the size is unknown and
    // the app builds an exact cause for it. Before this, the title simply appeared without a
    // size and nothing anywhere said why — which reads identically to nobody having looked.
    const dir = await tempDir();
    const path = join(dir, "undecodable.png");
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("this is a PNG signature with prose behind it, and no IHDR at all", "utf8"),
      ]),
    );
    const out = join(await tempDir(), "harvest.json");

    const run = await harvest("propose-photos", "--dir", dir, "--out", out);
    assert.equal(run.code, 0, run.output);

    const title = (await readHarvest(out)).candidates[0]!.title;
    assert.doesNotMatch(title, /0×0|undefined|NaN/, "an unmeasured size is never a zero");

    assert.match(run.stdout, /candidate\(s\) state no pixel size/);
    assert.ok(run.stdout.includes(path), "the file whose size is unknown must be named");
    // The reason is the app's own, whichever it is: sips is absent here, or sips ran and printed
    // no size. Both are real causes on some machine and both must reach the operator.
    assert.match(run.stdout, /sips/, "the printed cause must name what was actually tried");
  },
);

test(
  "a symbolic link is DECLINED by rule, and the harvest is still written",
  { timeout: 90_000 },
  async () => {
    // The distinction the fail-closed rule turns on: the walk declining by a rule it states is
    // not the machine refusing. If these were one state, a directory holding one symlink could
    // never produce a harvest at all.
    const dir = await tempDir();
    await writeFile(join(dir, "kept.png"), realPng(9, 9, 6));
    const elsewhere = await tempDir();
    await mkdir(join(elsewhere, "inner"), { recursive: true });
    await symlink(join(elsewhere, "inner"), join(dir, "link-to-elsewhere"));
    const out = join(await tempDir(), "harvest.json");

    const run = await harvest("propose-photos", "--dir", dir, "--out", out);
    assert.equal(run.code, 0, run.output);
    assert.match(run.stdout, /not read .*link-to-elsewhere — symbolic-link:/);
    assert.equal((await readHarvest(out)).candidates.length, 1);
  },
);

test(
  "A 307 FROM THE CONFIGURED ENDPOINT IS REFUSED BY THE CLI, and the image goes nowhere",
  { timeout: 90_000 },
  async () => {
    // THE SEAM, NOT THE MODULE. `photoSource.test.ts` already pins `describeImage` against a real
    // 307. This pins the wiring underneath it, which is a separate thing and was separately
    // broken: `harvest.mjs` called `describeImage(image, { toolchain })` with no `endpoint`, so
    // the address the usage text documents reached the git path and NOT this one. The guard was
    // correct and unreachable from the real user path — the arm could only be exercised by
    // importing the module, which is exactly the kind of proof this repo does not accept.
    //
    // Two REAL servers. Nothing here stubs `fetch`: what leaked was undici's redirect
    // behaviour, so a stub would have passed against the defect.
    let stolen: string | null = null;
    const thief = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        stolen = body;
        res.end(JSON.stringify({ response: "a description it never asked for" }));
      });
    });
    const model = await listen((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${thief.port}/api/generate` });
      res.end();
    });

    const dir = await tempDir();
    await writeFile(join(dir, "one.png"), realPng(24, 16, 7));
    const out = join(await tempDir(), "harvest.json");

    const run = await harvestWithEnv(
      { FOLIAGE_OLLAMA_URL: `http://127.0.0.1:${model.port}/api/generate` },
      "propose-photos",
      "--dir",
      dir,
      "--out",
      out,
      "--describe-with-local-model",
    );

    assert.notEqual(run.code, 0, `a redirected endpoint must fail the command: ${run.output}`);
    assert.equal(stolen, null, "THE SECOND HOST RECEIVED THE IMAGE — the hole is open");
    assert.equal(await exists(out), false, "nothing may be written");
    assert.match(run.output, /redirected/, "the cause travels by name, not as a generic failure");
    assert.match(run.output, /307/, "the status must be named");
    assert.match(run.output, new RegExp(`${thief.port}`), "and the location it refused to follow");
    // NOT reported as the model being down: that sends the operator to restart ollama, which is
    // the one action that does not address something answering on the port they trust.
    assert.doesNotMatch(run.output, /could not be reached/i);

    thief.server.close();
    model.server.close();
  },
);

test("an existing document is not overwritten without --force", { timeout: 90_000 }, async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "one.png"), realPng(5, 5, 1));
  const out = join(await tempDir(), "harvest.json");

  const first = await harvest("propose-photos", "--dir", dir, "--out", out);
  assert.equal(first.code, 0, first.output);
  const before = await readFile(out, "utf8");

  const second = await harvest("propose-photos", "--dir", dir, "--out", out);
  assert.notEqual(second.code, 0, "a second run must refuse the existing document");
  assert.match(second.output, /already exists and was NOT overwritten/);
  assert.equal(await readFile(out, "utf8"), before, "the refused run must not have touched it");

  const forced = await harvest("propose-photos", "--dir", dir, "--out", out, "--force");
  assert.equal(forced.code, 0, forced.output);
});
