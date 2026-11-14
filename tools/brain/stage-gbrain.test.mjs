/**
 * The staging tool's refusals and tripwire, without the network and without staging anything.
 * The trees below are SYNTHETIC: small files written to pin what the egress tripwire lists.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GBRAIN_PIN } from "../../apps/leaf/src/brainVendor.ts";
import { bunFormatProblem, DROPPED, droppedFiles, dropGitNames, egressSurface, foreignLibraries, integrityOf, stageGbrain, surfaceDifferences } from "./stage-gbrain.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** @param {{ after: (fn: () => Promise<unknown>) => void }} t @param {string} prefix */
async function temp(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the tripwire lists every staged file that can reach out or start a process, and only those", async t => {
  const tree = await temp(t, "foliage-egress-surface-");
  await mkdir(join(tree, "node_modules", "dep", "lib"), { recursive: true });
  await mkdir(join(tree, "src"), { recursive: true });
  const files = {
    "src/fetches.ts": "export const go = () => fetch('http://example.test');\n",
    "src/net.ts": "import { connect } from 'node:net';\n",
    "src/dns.mjs": "const dns = await import(\"dns/promises\");\n",
    "src/child.ts": "import { spawn } from \"child_process\";\nspawn('x');\n",
    "src/bun.ts": "Bun.connect({ hostname: 'example.test', port: 1 }); await Bun.$`true`;\n",
    "src/plain.ts": "export const quiet = 1;\n",
    "src/types.d.ts": "declare function fetch(url: string): void;\n",
    "src/notes.md": "fetch(this) in prose is not code\n",
    "node_modules/dep/lib/socket.cjs": "const ws = new WebSocket('ws://example.test');\nrequire('https');\n",
  };
  for (const [path, text] of Object.entries(files)) await writeFile(join(tree, path), text);
  const surface = await egressSurface(tree);
  assert.deepEqual(surface.map(entry => [entry.path, entry.reaches]), [
    ["node_modules/dep/lib/socket.cjs", ["WebSocket", "module"]],
    ["src/bun.ts", ["Bun.connect", "Bun.shell"]],
    ["src/child.ts", ["spawn", "module"]],
    ["src/dns.mjs", ["module"]],
    ["src/fetches.ts", ["fetch"]],
    ["src/net.ts", ["module"]],
  ]);
  assert.ok(surface.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256)));

  await writeFile(join(tree, "src/plain.ts"), "export const quiet = () => fetch('http://example.test');\n");
  await writeFile(join(tree, "src/net.ts"), "import { connect } from 'node:net';\nconnect(1);\n");
  await rm(join(tree, "src/dns.mjs"));
  assert.deepEqual(surfaceDifferences(surface, await egressSurface(tree)), [
    "changed: src/net.ts",
    "new: src/plain.ts (fetch)",
    "gone: src/dns.mjs",
  ]);
  assert.deepEqual(surfaceDifferences(surface, surface), []);
});

test("the committed tripwire is recorded for the pinned commit and names each file once with its digest", async () => {
  const committed = JSON.parse(await readFile(join(ROOT, "tools", "brain", "egress-surface.json"), "utf8"));
  assert.equal(committed.gbrainCommit, GBRAIN_PIN.commit);
  assert.ok(Array.isArray(committed.files) && committed.files.length > 0);
  const paths = committed.files.map(/** @param {{ path: string }} entry */ entry => entry.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual([...paths].sort(), paths, "sorted by path, so a pin bump diffs by file");
  for (const entry of committed.files) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.reaches.length > 0);
  }
  // gbrain's own network-capable modules are on the list a reviewer reads.
  for (const known of ["src/cli.ts", "src/core/ai/gateway.ts"]) assert.ok(paths.includes(known), `${known} missing from the tripwire`);
});

test("vendor/ is gitignored, and a tarball that is not the pinned one is refused before anything is written", async t => {
  for (const dir of ["vendor/", "vendor.next/", "vendor.old/", "vendor/gbrain/src/cli.ts"]) {
    assert.equal(spawnSync("git", ["-C", ROOT, "check-ignore", "-q", "--no-index", dir]).status, 0, `${dir} is committable`);
  }
  const root = await temp(t, "foliage-stage-refusal-");
  const tarball = join(root, "not-the-pin.tgz");
  await writeFile(tarball, "synthetic bytes that are not the pinned tarball\n");
  assert.notEqual(integrityOf(await readFile(tarball)), GBRAIN_PIN.integrity);
  await assert.rejects(stageGbrain({ tarball, root }), /integrity is sha512-.*Foliage pins sha512-.*Nothing was staged/);
  assert.deepEqual(await readdir(root), ["not-the-pin.tgz"]);
});

test("the bun to stage must be this platform's own executable format; any other platform is refused by name", () => {
  // SYNTHETIC headers: the first 20 bytes of each format, padded with zeros.
  const header = (/** @type {number[]} */ bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(20)]).subarray(0, 20);
  const machO = header([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
  const elf = (/** @type {number} */ machine) => header([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, machine, 0]);
  assert.equal(bunFormatProblem(machO, "darwin", "arm64"), null);
  assert.equal(bunFormatProblem(elf(0x3e), "linux", "x64"), null);
  assert.equal(bunFormatProblem(elf(0xb7), "linux", "arm64"), null);
  assert.equal(bunFormatProblem(elf(0x3e), "linux", "arm64"), "The bun to stage is not a 64-bit little-endian ELF executable for arm64.");
  assert.equal(bunFormatProblem(machO, "linux", "x64"), "The bun to stage is not a 64-bit little-endian ELF executable for x64.");
  assert.equal(bunFormatProblem(elf(0xb7), "darwin", "arm64"), "The bun to stage is not a thin macOS arm64 Mach-O executable.");
  assert.match(bunFormatProblem(machO, "darwin", "x64") ?? "", /^Staging is refused on darwin\/x64/);
  assert.match(bunFormatProblem(elf(0x3e), "win32", "x64") ?? "", /^Staging is refused on win32\/x64/);
});

test("the bun to stage links only the system's own libraries", () => {
  // SYNTHETIC listings in the shape of `otool -L` and `ldd`.
  const otool = "/x/bun:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n\t/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation (compatibility version 150.0.0)\n";
  assert.deepEqual(foreignLibraries(otool, "darwin"), []);
  assert.deepEqual(foreignLibraries(`${otool}\t/opt/homebrew/lib/libicu.dylib (compatibility version 1.0.0)\n`, "darwin"), ["/opt/homebrew/lib/libicu.dylib (compatibility version 1.0.0)"]);
  const ldd = "\tlinux-vdso.so.1 (0x0000ffff8a1f0000)\n\tlibc.so.6 => /lib/aarch64-linux-gnu/libc.so.6 (0x0000ffff89e30000)\n\tlibm.so.6 => /usr/lib/x86_64-linux-gnu/libm.so.6 (0x00007f0000000000)\n\t/lib/ld-linux-aarch64.so.1 (0x0000ffff8a1b0000)\n\t/lib64/ld-linux-x86-64.so.2 (0x00007f0000001000)\n";
  assert.deepEqual(foreignLibraries(ldd, "linux"), []);
  assert.deepEqual(foreignLibraries(`${ldd}\tlibfoo.so.1 => not found\n\tlibbar.so => /home/x/lib/libbar.so (0x0000000000001000)\n`, "linux"),
    ["libfoo.so.1 => not found", "libbar.so => /home/x/lib/libbar.so (0x0000000000001000)"]);
  assert.deepEqual(foreignLibraries("\tnot a dynamic executable\n", "linux"), []);
});

test("upstream's own development files are dropped from the staged tree: the listed names at gbrain's top level, git's and GitHub's at any depth; the committed tripwire names none of them", async () => {
  for (const name of [".env.testing.example", ".github", ".gitignore", ".gitattributes", ".gitleaks.toml"]) assert.ok(DROPPED.includes(name), `${name} is not dropped`);
  // SYNTHETIC paths in the shape of brain.json's file list.
  const files = [
    "gbrain/.env.testing.example", "gbrain/.github/workflows/ci.yml", "gbrain/.github/ISSUE_TEMPLATE/bug.md", "gbrain/.gitignore", "gbrain/.gitattributes",
    "gbrain/.gitleaks.toml", "gbrain/test/x.test.ts", "gbrain/CHANGELOG.md",
    "gbrain/src/cli.ts", "gbrain/LICENSE", "gbrain/.githubber", "gbrain/node_modules/es-errors/.github/FUNDING.yml", "gbrain/node_modules/x/.gitignore",
    "gbrain/node_modules/a/node_modules/b/.github/workflows/x.yml", "gbrain/node_modules/fast-uri/.gitattributes", "gbrain/skills/migrations/.gitkeep",
    "gbrain/examples/pack/.gitignore", "gbrain/node_modules/x/lib/gitignore.js", "gbrain/node_modules/x/test/x.js", "bun/bun", "bun/.gitignore",
  ].map(path => ({ path }));
  assert.deepEqual(droppedFiles(files), [
    "gbrain/.env.testing.example", "gbrain/.github/workflows/ci.yml", "gbrain/.github/ISSUE_TEMPLATE/bug.md", "gbrain/.gitignore", "gbrain/.gitattributes",
    "gbrain/.gitleaks.toml", "gbrain/test/x.test.ts", "gbrain/CHANGELOG.md",
    "gbrain/.githubber", "gbrain/node_modules/es-errors/.github/FUNDING.yml", "gbrain/node_modules/x/.gitignore",
    "gbrain/node_modules/a/node_modules/b/.github/workflows/x.yml", "gbrain/node_modules/fast-uri/.gitattributes", "gbrain/skills/migrations/.gitkeep",
    "gbrain/examples/pack/.gitignore",
  ]);
  const committed = JSON.parse(await readFile(join(ROOT, "tools", "brain", "egress-surface.json"), "utf8"));
  assert.deepEqual(droppedFiles(committed.files.map(/** @param {{ path: string }} entry */ entry => ({ path: `gbrain/${entry.path}` }))), [],
    "dropping them changes nothing a reviewer reads in the tripwire");
});

test("staging removes git's and GitHub's files and folders at every depth of gbrain's tree, node_modules included, and nothing else; a link is removed, never followed", async t => {
  const tree = await temp(t, "foliage-stage-git-names-");
  const outside = await temp(t, "foliage-stage-git-names-outside-");
  await writeFile(join(outside, "kept.txt"), "SYNTHETIC: outside the tree\n");
  const write = async (/** @type {string} */ path, /** @type {string} */ text) => {
    await mkdir(join(tree, path, ".."), { recursive: true });
    await writeFile(join(tree, path), text);
  };
  for (const path of [".github/workflows/ci.yml", "node_modules/es-errors/.github/FUNDING.yml", "node_modules/a/node_modules/b/.github/x.yml",
    "node_modules/fast-uri/.gitattributes", "skills/migrations/.gitkeep", "skills/migrations/v1.md", "examples/pack/.gitignore",
    "node_modules/x/lib/gitignore.js", "node_modules/x/.git/HEAD", "src/cli.ts", "LICENSE"]) await write(path, "SYNTHETIC\n");
  await symlink(outside, join(tree, "node_modules", "x", ".gitlink"));
  await dropGitNames(tree);
  /** @param {string} dir @param {string} at @returns {Promise<string[]>} */
  const list = async (dir, at = "") => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    const path = at ? `${at}/${entry.name}` : entry.name;
    return entry.isDirectory() ? [`${path}/`, ...await list(join(dir, entry.name), path)] : [path];
  }))).flat().sort();
  // A folder that held only a dropped file stays, empty: the vendor digests list files, and a folder some code expects is kept.
  assert.deepEqual(await list(tree), ["LICENSE", "examples/", "examples/pack/", "node_modules/", "node_modules/a/", "node_modules/a/node_modules/", "node_modules/a/node_modules/b/",
    "node_modules/es-errors/", "node_modules/fast-uri/", "node_modules/x/", "node_modules/x/lib/", "node_modules/x/lib/gitignore.js",
    "skills/", "skills/migrations/", "skills/migrations/v1.md", "src/", "src/cli.ts"]);
  assert.deepEqual(await readdir(outside), ["kept.txt"], "the link was removed, not what it points to");
});

test("--restage stages only from a vendor/ that matches its own brain.json and the pins, and takes no tarball or bun; a refusal writes nothing", async t => {
  const root = await temp(t, "foliage-stage-restage-");
  await assert.rejects(stageGbrain({ root, restage: true, tarball: join(root, "x.tgz") }), /--restage stages from the vendor\/ already staged; it takes no --tarball or --bun/);
  await assert.rejects(stageGbrain({ root, restage: true }), /The staged vendor\/ cannot be restaged: .*Stage it from the tarball instead\./);
  await mkdir(join(root, "vendor", "gbrain"), { recursive: true });
  await writeFile(join(root, "vendor", "brain.json"), JSON.stringify({ schemaVersion: 1, gbrainCommit: "0".repeat(40) }));
  await assert.rejects(stageGbrain({ root, restage: true }), /The staged vendor\/ cannot be restaged: vendor\/brain\.json names another gbrain commit than Foliage pins/);
  assert.deepEqual((await readdir(root)).sort(), ["vendor"], "nothing was staged beside it");
});
