import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";

import { selectReleasePath } from "./releasePath.ts";

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function paths() {
  const home = await mkdtemp(join(tmpdir(), "foliage-release-path-"));
  roots.push(home);
  return {
    home,
    legacyPath: join(home, "legacy-release.json"),
    durablePath: join(home, ".foliage", "enterprise", "release.json"),
  };
}

test("an unused installation selects the stable home path without creating anything", async () => {
  const p = await paths();
  assert.equal(await selectReleasePath(undefined, p), p.durablePath);
  assert.deepEqual(await readdir(p.home), []);
});

test("the default home is the operating system home, independent of the working directory", async () => {
  const p = await paths();
  assert.equal(
    await selectReleasePath(undefined, { legacyPath: p.legacyPath }),
    resolve(homedir(), ".foliage", "enterprise", "release.json"),
  );
});

test("explicit paths retain resolve semantics and bypass legacy ambiguity", async () => {
  const p = await paths();
  await mkdir(dirname(p.durablePath), { recursive: true });
  await writeFile(p.legacyPath, "legacy path test bytes\n");
  await writeFile(p.durablePath, "durable path test bytes\n");
  assert.equal(await selectReleasePath(p.legacyPath, p), resolve(p.legacyPath));
  assert.equal(await selectReleasePath("relative/release.json", p), resolve("relative/release.json"));
  assert.equal(await selectReleasePath("", p), resolve(""));
});

test("legacy state alone refuses empty-state migration and leaves its bytes untouched", async () => {
  const p = await paths();
  const bytes = Buffer.from("legacy path test bytes\n");
  await writeFile(p.legacyPath, bytes);
  await assert.rejects(selectReleasePath(undefined, p), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(p.legacyPath));
    assert.ok(error.message.includes(p.durablePath));
    assert.match(error.message, /Refusing to start with empty release state/);
    assert.match(error.message, /FOLIAGE_RELEASE/);
    assert.match(error.message, /stop its writers and deliberately move/);
    return true;
  });
  assert.deepEqual(await readFile(p.legacyPath), bytes);
  assert.deepEqual(await readdir(p.home), ["legacy-release.json"]);
});

test("two stores refuse ambiguity and preserve both files", async () => {
  const p = await paths();
  const legacyBytes = Buffer.from("legacy path test bytes\n");
  const durableBytes = Buffer.from("durable path test bytes\n");
  await mkdir(dirname(p.durablePath), { recursive: true });
  await writeFile(p.legacyPath, legacyBytes);
  await writeFile(p.durablePath, durableBytes);
  await assert.rejects(selectReleasePath(undefined, p), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(p.legacyPath));
    assert.ok(error.message.includes(p.durablePath));
    assert.match(error.message, /Refusing to choose between them/);
    assert.match(error.message, /active writer/);
    assert.match(error.message, /FOLIAGE_RELEASE/);
    return true;
  });
  assert.deepEqual(await readFile(p.legacyPath), legacyBytes);
  assert.deepEqual(await readFile(p.durablePath), durableBytes);
});

test("existing durable state is selected when there is no legacy entry", async () => {
  const p = await paths();
  const bytes = Buffer.from("durable path test bytes\n");
  await mkdir(dirname(p.durablePath), { recursive: true });
  await writeFile(p.durablePath, bytes);
  assert.equal(await selectReleasePath(undefined, p), p.durablePath);
  assert.deepEqual(await readFile(p.durablePath), bytes);
});

test("a dangling legacy symlink still requires deliberate migration", async () => {
  const p = await paths();
  await symlink(join(p.home, "missing-target"), p.legacyPath);
  await assert.rejects(selectReleasePath(undefined, p), /Legacy release state exists/);
  assert.equal((await lstat(p.legacyPath)).isSymbolicLink(), true);
});

test("a filesystem failure inspecting the legacy path is not treated as absence", async () => {
  const p = await paths();
  const blockingFile = join(p.home, "not-a-directory");
  await writeFile(blockingFile, "path test bytes\n");
  await assert.rejects(
    selectReleasePath(undefined, { home: p.home, legacyPath: join(blockingFile, "release.json") }),
    { code: "ENOTDIR" },
  );
});

test("a filesystem failure inspecting the durable path is not treated as absence", async () => {
  const p = await paths();
  await writeFile(join(p.home, ".foliage"), "path test bytes\n");
  await assert.rejects(selectReleasePath(undefined, p), { code: "ENOTDIR" });
});

test("permission failures inspecting legacy state remain permission failures", {
  skip: process.platform === "win32" || process.getuid?.() === 0
    ? "Directory permissions are not enforceable for this test account/platform"
    : false,
}, async () => {
  const p = await paths();
  const restricted = join(p.home, "restricted");
  await mkdir(restricted);
  await chmod(restricted, 0);
  try {
    await assert.rejects(
      selectReleasePath(undefined, { home: p.home, legacyPath: join(restricted, "release.json") }),
      { code: "EACCES" },
    );
  } finally {
    await chmod(restricted, 0o700);
  }
});
