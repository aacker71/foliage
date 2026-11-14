#!/usr/bin/env node
/**
 * STAGE THE PINNED GBRAIN into `vendor/` — a developer and build-machine step, never a user's.
 *
 *   node tools/brain/stage-gbrain.mjs [--tarball <file>] [--bun <path>] [--record-egress-surface]
 *   node tools/brain/stage-gbrain.mjs --restage
 *
 * --restage stages again from the `vendor/` already staged here, downloading and installing
 * nothing: the staged tree must match its own brain.json and Foliage's pins, and then goes through
 * every step after the install (the drops, the egress-surface check, a new brain.json, the swap).
 * It is how a staging rule that drops more reaches a `vendor/` staged before it.
 *
 * NETWORK, said plainly: this is the only brain step that may use the network, and only on the
 * machine building Foliage. Without --tarball it downloads the pinned commit's tarball from the
 * GitHub API, and `bun install` fetches whatever locked dependency its cache lacks. No runtime
 * path in apps/ imports or runs this file, and a user's machine never fetches anything for the
 * brain (unit 38, "no model or package download on the user's machine").
 *
 * WHAT IT REFUSES: a tarball whose sha512 is not the pinned integrity; a tree whose package.json
 * or VERSION names another version; a bun that is not the pinned version, not a private copy, not
 * an executable of this platform's format (a thin arm64 Mach-O on macOS, a 64-bit little-endian
 * ELF for this architecture on Linux) or linked against anything outside the system's own library
 * paths (the checks draft PR #160 applies to its bundled Node); a `vendor/` git would not ignore;
 * and any change in the set of staged files that can reach out (`tools/brain/egress-surface.json`).
 * A reviewed pin bump re-records that file with --record-egress-surface, so its diff shows exactly
 * which network- or process-capable files changed.
 *
 * WHAT IT RUNS: `bun install --frozen-lockfile --production --ignore-scripts` from upstream's own
 * bun.lock. `--ignore-scripts` is load-bearing: gbrain's postinstall migrates whatever gbrain is
 * on PATH (`scripts/postinstall.ts:30-41`), which on a developer machine is their real brain.
 *
 * WHERE: macOS arm64 is measured end to end. Linux x64 (CI's ubuntu-latest) and arm64 stage the
 * same way so the offline gate can run there (build order item 4); the gate is what measures them,
 * and nothing ships for Linux until it has passed there (build order item 7). Any other platform is
 * refused by name.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, copyFile, cp, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BUN_PIN, GBRAIN_PIN, hashVendorTree, readVendorManifest, sha256File, vendorLayout, verifyVendorTree } from "../../apps/leaf/src/brainVendor.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SURFACE = join(ROOT, "tools", "brain", "egress-surface.json");
const TARBALL_URL = `https://api.github.com/repos/garrytan/gbrain/tarball/${GBRAIN_PIN.commit}`;
/**
 * Top-level names in gbrain's tree that are dropped before anything is recorded: its tests, docs and
 * long notes, and upstream's own development files, which nothing runs and a brain archive must not
 * ship (`.env.testing.example` holds placeholder keys). `brain.json` and the egress surface are
 * recorded after the drop, so neither names them; `tools/deploy/package-brain.mjs` refuses a staged
 * tree that still holds any of them.
 */
export const DROPPED = Object.freeze(["test", "docs", "evals", "CHANGELOG.md", "TODOS.md", "llms-full.txt",
  ".env.testing.example", ".github", ".gitignore", ".gitattributes", ".gitleaks.toml"]);

/**
 * A name dropped AT ANY DEPTH of gbrain's tree, its node_modules included: git's own files and
 * folders (`.gitignore`, `.gitattributes`, `.gitkeep`, `.git/`) and GitHub's (`.github/`). The
 * packages bun installs carry them too (measured on 0.42.73.2: 26 `.github/` folders and a
 * `.gitattributes` under node_modules, and three `.gitignore`/`.gitkeep` in gbrain's own
 * subfolders), and nothing runs them; none is in the egress surface.
 */
export const GIT_NAME = /^\.git/;

/**
 * The staged files that staging drops, by their path in `vendor/`: under a top-level name `DROPPED`
 * names, or under a `GIT_NAME` anywhere in gbrain's tree. Pure.
 * @param {readonly { path: string }[]} files
 */
export const droppedFiles = (files) => files.map(file => file.path)
  .filter(path => DROPPED.some(name => path === `gbrain/${name}` || path.startsWith(`gbrain/${name}/`))
    || (path.startsWith("gbrain/") && path.split("/").slice(1).some(segment => GIT_NAME.test(segment))));

/**
 * Removes every `GIT_NAME` file and folder at any depth under `dir`, never following a link.
 * @param {string} dir
 */
export async function dropGitNames(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (GIT_NAME.test(entry.name)) await rm(path, { recursive: true, force: true });
    else if (entry.isDirectory()) await dropGitNames(path);
  }
}

/**
 * Code a staged file can run: declarations (`.d.ts`) call nothing and are left out. THE TRIPWIRE IS
 * A HEURISTIC, not a proof: it reads JavaScript and TypeScript text only, so native addons
 * (`.node`), shell scripts and an indirect reference (`const f = fetch`) are not listed. What it
 * does is make a pin bump's diff name the code that changed; the sandboxed offline run is the proof.
 */
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const DECLARATION = /\.d\.[cm]?ts$/;
/**
 * What can reach out or start a process. The spec's list, plus bun's own spellings of the same
 * powers (`Bun.$`, `Bun.udpSocket`, `child_process`). `exec(` deliberately also matches
 * `RegExp#exec`: a tripwire may list a harmless file, never miss a real one.
 */
const REACH = /** @type {const} */ ([
  ["fetch", /\bfetch\s*\(/],
  ["spawn", /\bspawn(?:Sync)?\s*\(/],
  ["exec", /\bexec(?:Sync)?\s*\(/],
  ["execFile", /\bexecFile(?:Sync)?\s*\(/],
  ["Bun.connect", /\bBun\.connect\b/],
  ["Bun.shell", /\bBun\.(?:\$|udpSocket)/],
  ["WebSocket", /\bWebSocket\b/],
  ["module", /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)["'](?:node:)?(?:net|tls|https?|http2|dgram|dns|child_process)(?:\/promises)?["']/],
]);

/** @typedef {{ path: string, sha256: string, reaches: string[] }} SurfaceEntry */

/**
 * Every staged gbrain file (its node_modules included) that can reach out or start a process,
 * with its digest. Pure over the tree it is given; the list is sorted by path.
 * @param {string} gbrain
 * @returns {Promise<SurfaceEntry[]>}
 */
export async function egressSurface(gbrain) {
  /** @type {SurfaceEntry[]} */
  const found = [];
  /** @param {string} dir */
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && CODE.test(entry.name) && !DECLARATION.test(entry.name)) {
        const bytes = await readFile(path);
        const text = bytes.toString("utf8");
        const reaches = REACH.flatMap(([name, pattern]) => pattern.test(text) ? [name] : []);
        if (reaches.length > 0) found.push({ path: relative(gbrain, path).split(sep).join("/"), sha256: createHash("sha256").update(bytes).digest("hex"), reaches });
      }
    }
  };
  await walk(gbrain);
  return found.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/**
 * Names every difference between the committed surface and the staged one; empty means equal.
 * @param {SurfaceEntry[]} expected @param {SurfaceEntry[]} actual
 */
export function surfaceDifferences(expected, actual) {
  const want = new Map(expected.map(entry => [entry.path, entry]));
  const differences = [];
  for (const entry of actual) {
    const known = want.get(entry.path);
    if (!known) differences.push(`new: ${entry.path} (${entry.reaches.join(", ")})`);
    else if (known.sha256 !== entry.sha256 || known.reaches.join() !== entry.reaches.join()) differences.push(`changed: ${entry.path}`);
    want.delete(entry.path);
  }
  for (const path of want.keys()) differences.push(`gone: ${path}`);
  return differences;
}

/** @param {Uint8Array} bytes */
export const integrityOf = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/** @param {string} command @param {string[]} args @param {import("node:child_process").SpawnSyncOptions} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 600_000, ...options });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? String(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
    throw new Error(`${command} ${args[0] ?? ""} failed: ${detail}`);
  }
  return String(result.stdout ?? "");
}

/** The first executable `bun` on PATH, as an absolute path. */
async function bunOnPath() {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "bun");
    try { await access(candidate, constants.X_OK); return resolve(candidate); } catch { /* next */ }
  }
  throw new Error("No bun on PATH. Pass --bun <absolute path to bun 1.3.14>.");
}

/** Where staging runs, and the ELF machine number each Linux architecture's bun must carry. */
const TARGETS = Object.freeze({ "darwin/arm64": { elfMachine: null }, "linux/x64": { elfMachine: 0x3e }, "linux/arm64": { elfMachine: 0xb7 } });

/**
 * What is wrong with an executable's first 20 bytes for this platform, or null. Pure.
 * @param {Buffer} header @param {string} platform @param {string} arch
 */
export function bunFormatProblem(header, platform, arch) {
  const target = TARGETS[/** @type {keyof typeof TARGETS} */ (`${platform}/${arch}`)];
  if (!target) return `Staging is refused on ${platform}/${arch}: the brain is staged on macOS arm64 and Linux x64 or arm64 only.`;
  if (target.elfMachine === null) {
    return header.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === 0x0100000c ? null
      : "The bun to stage is not a thin macOS arm64 Mach-O executable.";
  }
  return header.length >= 20 && header.readUInt32BE(0) === 0x7f454c46 && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === target.elfMachine ? null
    : `The bun to stage is not a 64-bit little-endian ELF executable for ${arch}.`;
}

/**
 * The libraries an executable links from outside the system's own paths, from `otool -L` (its
 * first line names the file) or `ldd` output. Pure.
 * @param {string} listing @param {string} platform
 */
export function foreignLibraries(listing, platform) {
  const lines = listing.split("\n").map(line => line.trim()).filter(Boolean);
  if (platform === "darwin") return lines.slice(1).filter(line => !/^(?:\/usr\/lib\/|\/System\/Library\/)/.test(line));
  if (lines.length === 1 && /not a dynamic executable|statically linked/.test(lines[0] ?? "")) return [];
  return lines.filter(line => !/^linux-(?:vdso|gate)\.so/.test(line) && !/^(?:\S+ => )?\/(?:usr\/)?lib(?:64|32)?\/\S+ \(0x[0-9a-f]+\)$/.test(line));
}

/**
 * The private copy is checked, never the caller's pathname: pinned version, this platform's
 * executable format, system libraries only. `tools/deploy/package-brain.mjs` checks the copy it
 * ships the same way, the way draft PR #160 checks its bundled Node.
 * @param {string} bun
 */
export async function checkBun(bun) {
  const handle = await open(bun, "r");
  const header = Buffer.alloc(20);
  try { await handle.read(header, 0, 20, 0); } finally { await handle.close(); }
  const problem = bunFormatProblem(header, process.platform, process.arch);
  if (problem) throw new Error(problem);
  const listing = process.platform === "darwin" ? run("/usr/bin/otool", ["-L", bun]) : run("ldd", [bun], { env: { PATH: "/usr/bin:/bin" } });
  const foreign = foreignLibraries(listing, process.platform);
  if (foreign.length > 0) throw new Error(`The bun to stage links libraries outside the system's own paths: ${foreign.join("; ")}`);
  const version = run(bun, ["--version"], { env: { PATH: "/usr/bin:/bin" }, cwd: tmpdir() }).trim();
  if (version !== BUN_PIN.version) throw new Error(`The bun to stage is ${version}; Foliage pins ${BUN_PIN.version}.`);
}

/** @param {string} tarball */
async function pinnedTarball(tarball) {
  const bytes = tarball ? await readFile(tarball) : Buffer.from(await (async () => {
    // CI hands over its own short-lived job token under this explicit name, so shared runner
    // addresses do not hit the anonymous API rate limit; an ambient GITHUB_TOKEN on a developer's
    // machine is never picked up. It goes to api.github.com only (fetch drops it on the redirect to
    // codeload). The integrity check below is what decides whether the bytes are the pin.
    const token = process.env["FOLIAGE_STAGE_GITHUB_TOKEN"];
    const response = await fetch(TARBALL_URL, { redirect: "follow", headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error(`Downloading the pinned gbrain tarball failed: HTTP ${response.status}.`);
    return response.arrayBuffer();
  })());
  const integrity = integrityOf(bytes);
  if (integrity !== GBRAIN_PIN.integrity) throw new Error(`The gbrain tarball's integrity is ${integrity}; Foliage pins ${GBRAIN_PIN.integrity}. Nothing was staged.`);
  return bytes;
}

/** @param {string} path */
async function gitIgnores(path) {
  const result = spawnSync("git", ["-C", ROOT, "check-ignore", "-q", "--no-index", path], { timeout: 30_000 });
  return result.status === 0;
}

/**
 * Stage gbrain and bun into `<root>/vendor/` through `vendor.next/` and a swap. `root` defaults to
 * this checkout, whose .gitignore is the one checked; tests pass a scratch directory. With
 * `restage`, the tree comes from the `vendor/` already staged there, checked against its own
 * brain.json and Foliage's pins first, instead of the tarball and bun's install.
 * @param {{ tarball?: string, bun?: string, recordSurface?: boolean, root?: string, restage?: boolean }} options
 */
export async function stageGbrain({ tarball = "", bun = "", recordSurface = false, root = ROOT, restage = false } = {}) {
  for (const dir of ["vendor/", "vendor.next/", "vendor.old/"]) {
    if (!await gitIgnores(dir)) throw new Error(`${dir} is not gitignored; refusing to stage third-party code where it could be committed.`);
  }
  if (restage && (tarball || bun)) throw new Error("--restage stages from the vendor/ already staged; it takes no --tarball or --bun.");
  const vendor = join(root, "vendor"), next = join(root, "vendor.next"), old = join(root, "vendor.old");
  // The pin is checked before anything is written, on any platform: the tarball's integrity, or the staged tree against its brain.json and the pins.
  const bytes = restage ? null : await pinnedTarball(tarball);
  if (restage) {
    try { await verifyVendorTree(vendor, await readVendorManifest(vendor)); }
    catch (error) { throw new Error(`The staged vendor/ cannot be restaged: ${error instanceof Error ? error.message : String(error)}. Stage it from the tarball instead.`); }
  }
  if (!Object.hasOwn(TARGETS, `${process.platform}/${process.arch}`)) throw new Error(bunFormatProblem(Buffer.alloc(0), process.platform, process.arch) ?? "unsupported platform");
  const sourceBun = restage ? "" : bun ? resolve(bun) : await bunOnPath();
  await rm(next, { recursive: true, force: true });
  try {
    const layout = vendorLayout(next);
    if (bytes === null) {
      // Links are copied as links and nothing is overwritten; brain.json is written again below.
      await cp(vendor, next, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
      await rm(layout.manifest);
      await checkBun(layout.bun);
    } else {
      await mkdir(next, { mode: 0o700 });
      await mkdir(dirname(layout.bun), { mode: 0o700 });
      await copyFile(sourceBun, layout.bun, constants.COPYFILE_EXCL);
      await chmod(layout.bun, 0o755);
      await checkBun(layout.bun);

      const unpack = await mkdtemp(join(next, ".unpack-"));
      await writeFile(join(unpack, "gbrain.tgz"), bytes, { flag: "wx", mode: 0o600 });
      run("/usr/bin/tar", ["-xzf", join(unpack, "gbrain.tgz"), "-C", unpack]);
      const top = (await readdir(unpack)).filter(name => name !== "gbrain.tgz");
      if (top.length !== 1 || top[0] !== `garrytan-gbrain-${GBRAIN_PIN.commit.slice(0, 7)}`) throw new Error(`The tarball unpacked to ${top.join(", ")}, not the pinned commit's directory.`);
      await rename(join(unpack, top[0]), layout.gbrain);
      await rm(unpack, { recursive: true, force: true });

      const manifest = JSON.parse(await readFile(join(layout.gbrain, "package.json"), "utf8"));
      const version = (await readFile(join(layout.gbrain, "VERSION"), "utf8")).trim();
      if (manifest.name !== "gbrain" || manifest.version !== GBRAIN_PIN.version || version !== GBRAIN_PIN.version) {
        throw new Error(`The unpacked tree is ${manifest.name}@${manifest.version} (VERSION ${version}), not gbrain ${GBRAIN_PIN.version}.`);
      }
      // The staged, checked bun installs from upstream's own lockfile; HOME stays real only so bun
      // can use its download cache. Scripts never run.
      run(layout.bun, ["install", "--frozen-lockfile", "--production", "--ignore-scripts"], {
        cwd: layout.gbrain, env: { PATH: "/usr/bin:/bin", HOME: process.env["HOME"] ?? tmpdir(), TMPDIR: tmpdir() },
      });
    }
    for (const name of DROPPED) await rm(join(layout.gbrain, name), { recursive: true, force: true });
    await dropGitNames(layout.gbrain);
    await access(join(layout.gbrain, "LICENSE"));

    const surface = await egressSurface(layout.gbrain);
    // One line per file, so a pin bump's diff reads as a list of changed files.
    if (recordSurface) await writeFile(SURFACE, `{\n  "gbrainCommit": ${JSON.stringify(GBRAIN_PIN.commit)},\n  "files": [\n${surface.map(entry => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]\n}\n`);
    else {
      let committed;
      try { committed = JSON.parse(await readFile(SURFACE, "utf8")); }
      catch { throw new Error("tools/brain/egress-surface.json is missing or not JSON. Record it for a reviewed pin with --record-egress-surface."); }
      if (committed.gbrainCommit !== GBRAIN_PIN.commit) throw new Error("tools/brain/egress-surface.json was recorded for another gbrain commit.");
      const differences = surfaceDifferences(committed.files, surface);
      if (differences.length > 0) throw new Error(`The staged files that can reach out differ from tools/brain/egress-surface.json:\n  ${differences.slice(0, 20).join("\n  ")}`);
    }

    const files = await hashVendorTree(next);
    await writeFile(layout.manifest, `${JSON.stringify({
      schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
      bunVersion: BUN_PIN.version, bunSha256: await sha256File(layout.bun), cliSha256: await sha256File(layout.cli),
      platform: process.platform, arch: process.arch, files,
    }, null, 2)}\n`, { flag: "wx" });
    // The runtime's own reader accepts it, or nothing is swapped in.
    await verifyVendorTree(next, await readVendorManifest(next));

    await rm(old, { recursive: true, force: true });
    try { await rename(vendor, old); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    await rename(next, vendor);
    await rm(old, { recursive: true, force: true });
    return { vendor, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, bunVersion: BUN_PIN.version, files: files.length, reachingFiles: surface.length };
  } catch (error) {
    await rm(next, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { tarball: { type: "string" }, bun: { type: "string" }, "record-egress-surface": { type: "boolean" }, restage: { type: "boolean" } }, strict: true });
    const staged = await stageGbrain({ tarball: values.tarball ?? "", bun: values.bun ?? "", recordSurface: values["record-egress-surface"] ?? false, restage: values.restage ?? false });
    process.stdout.write(`${JSON.stringify(staged)}\n`);
  } catch (error) {
    process.stderr.write(`stage-gbrain: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
