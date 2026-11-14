/**
 * THE VENDORED BRAIN RUNTIME: which gbrain and which bun Foliage runs, and the check that the
 * bytes on disk are the bytes that were staged (unit 38, spec PR #201).
 *
 * `tools/brain/stage-gbrain.mjs` writes `vendor/` on a build machine and records every file in
 * `vendor/brain.json`. This module is the one reader of that record, used by the staging tool to
 * verify what it just wrote and by `localBrain.ts` before any gbrain process starts. It reads files
 * and hashes them; it never fetches, installs or runs anything.
 *
 * THE PIN IS HERE ONCE. gbrain is `github:garrytan/gbrain` at one commit; the npm package named
 * `gbrain` is unrelated code, so the name alone means nothing. The integrity is bun's own sha512
 * of the GitHub API tarball for that commit (measured 2026-10-10: the tarball downloaded from the
 * API matched it; the codeload `tar.gz` for the same commit did not, because its top directory is
 * named differently). Any other commit, integrity or version in `brain.json` is refused.
 *
 * SHIPPED, the same tree is the brain unit (build order item 7), the `vendor/` folder beside
 * `runtime/` in the one Foliage download (owner decision 2026-10-15): `tools/deploy/package-brain.mjs`
 * adds `release.json` and `THIRD-PARTY-NOTICES` at the root of `vendor/`, and the installer checks
 * the whole unit against `release.json` and then runs `verifyShippedBrain` from this module, the
 * runtime preflight on the user's machine.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, readlink, statfs } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const GBRAIN_PIN = Object.freeze({
  version: "0.42.73.2",
  commit: "15b9863d13635d173562a54f55a1d388bfcf546b",
  integrity: "sha512-9FN9VAsTCOBR862nG0XDIZ3YryfdGqZiij8IBNOXy/czCWw/ELXTJPHLTxhiSa9DQL3SFaVFLVCVbs6sp8L6vQ==",
});

/**
 * The bun CI pins (`.github/workflows/ci.yml`); gbrain itself needs at least 1.3.10.
 *
 * `shipped`: the bun bytes a brain archive may carry, per platform and arch. A checkout may stage
 * any bun of the pinned version; a release ships only these bytes, so a platform without an entry
 * gets no brain archive (spec: Linux ships only after it passes the same offline test). The macOS
 * arm64 digest is MEASURED on the build machine (2026-10-12): the bun 1.3.14 that bun's official
 * installer placed there (signed with bun's publisher Developer ID, team 7FRXF46ZSN), the one
 * every staged `vendor/` on that machine holds and the offline gate runs. It was not cross-checked
 * against bun's published release zip, whose checksum covers the zip, not the binary.
 */
export const BUN_PIN = Object.freeze({
  version: "1.3.14",
  shipped: Object.freeze<Record<string, string>>({ "darwin/arm64": "e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233" }),
});

/**
 * The files a release adds at the root of `vendor/` (`tools/deploy/package-brain.mjs`). They are not
 * part of what was staged, so `brain.json` does not list them; the installer checks them against
 * `vendor/release.json`, which also lists `brain.json` itself. Only these names, only at the root.
 */
export const RELEASE_FILES: readonly string[] = Object.freeze(["release.json", "THIRD-PARTY-NOTICES", "START-HERE.md"]);

/**
 * An empty garden brain's size on disk: 42 MB, measured (spec, "Sizes"). A new database is not
 * started where less than this is free, at install and before every `init`.
 */
export const EMPTY_BRAIN_BYTES = 42 * 1024 * 1024;

export interface VendorFile { readonly path: string; readonly sha256?: string; readonly link?: string }

export interface VendorManifest {
  readonly schemaVersion: 1;
  readonly gbrainVersion: string;
  readonly gbrainCommit: string;
  readonly gbrainIntegrity: string;
  readonly bunVersion: string;
  readonly bunSha256: string;
  readonly cliSha256: string;
  readonly platform: string;
  readonly arch: string;
  readonly files: readonly VendorFile[];
}

/** A vendor problem. `missing` means nothing is staged at all, which reads as "not installed". */
export class BrainVendorError extends Error {
  readonly missing: boolean;
  constructor(message: string, missing = false) {
    super(message);
    this.missing = missing;
  }
}

export function vendorLayout(vendor: string) {
  const gbrain = join(vendor, "gbrain");
  return { manifest: join(vendor, "brain.json"), bun: join(vendor, "bun", "bun"), gbrain, cli: join(gbrain, "src", "cli.ts") };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * What macOS leaves in a folder a person opens, and nobody staged: Finder's folder settings
 * (`.DS_Store`), a folder's custom icon (`Icon` and a carriage return), the marker of a localized
 * folder name (`.localized`), and the AppleDouble companions (`._<name>`) that Archive Utility, or a
 * copy to a disk that is not APFS, writes beside files. A REGULAR FILE with one of these names, at
 * any depth, is never hashed and never counted as unstaged, so a `vendor/` someone opened in Finder
 * still checks out.
 * A link or a folder with such a name gets no pass: a link is checked as any link, and a folder's
 * contents as any folder's. The installer keeps the same rule for what it copies and checks
 * (`tools/install/runtime-install.mjs`). Pure.
 */
export function finderFile(name: string): boolean {
  return name === ".DS_Store" || name === "Icon\r" || name === ".localized" || name.startsWith("._");
}

/**
 * Every file under `vendor/` except `brain.json`, a release's own files at the root
 * (`RELEASE_FILES`) and Finder's (`finderFile`), sorted, as written into and checked against it.
 * About 13,000 files: hashed sixteen at a time, whole-file reads, which is what keeps a status
 * check in seconds rather than tens of seconds.
 */
export async function hashVendorTree(vendor: string): Promise<VendorFile[]> {
  const files: VendorFile[] = [];
  const pending: { readonly at: number; readonly path: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      const local = relative(vendor, path).split(sep).join("/");
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else if (info.isSymbolicLink()) files.push({ path: local, link: await readlink(path) });
      else if (!info.isFile()) throw new BrainVendorError(`vendor/${local} is not a regular file`);
      else if (!finderFile(name) && local !== "brain.json" && !RELEASE_FILES.includes(local)) { pending.push({ at: files.length, path }); files.push({ path: local }); }
    }
  };
  await walk(vendor);
  let next = 0;
  const worker = async () => {
    for (let item = pending[next++]; item !== undefined; item = pending[next++]) {
      const { path } = files[item.at]!;
      files[item.at] = { path, sha256: createHash("sha256").update(await readFile(item.path)).digest("hex") };
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return files;
}

const HEX64 = /^[a-f0-9]{64}$/;

/** Validates the record and refuses any pin other than Foliage's own, by name. */
export function parseVendorManifest(value: unknown): VendorManifest {
  const record = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof record[key] === "string" ? record[key] : undefined;
  if (record["schemaVersion"] !== 1) throw new BrainVendorError("vendor/brain.json has an unknown schema version");
  if (text("gbrainCommit") !== GBRAIN_PIN.commit) throw new BrainVendorError("vendor/brain.json names another gbrain commit than Foliage pins");
  if (text("gbrainIntegrity") !== GBRAIN_PIN.integrity) throw new BrainVendorError("vendor/brain.json names another gbrain integrity than Foliage pins");
  if (text("gbrainVersion") !== GBRAIN_PIN.version) throw new BrainVendorError("vendor/brain.json names another gbrain version than Foliage pins");
  if (text("bunVersion") !== BUN_PIN.version) throw new BrainVendorError("vendor/brain.json names another bun version than Foliage pins");
  for (const key of ["bunSha256", "cliSha256"]) {
    if (!HEX64.test(text(key) ?? "")) throw new BrainVendorError(`vendor/brain.json has no valid ${key}`);
  }
  if (text("platform") !== process.platform || text("arch") !== process.arch) {
    throw new BrainVendorError(`vendor/ was staged for ${String(record["platform"])}/${String(record["arch"])}, not ${process.platform}/${process.arch}`);
  }
  const files = Array.isArray(record["files"]) ? record["files"] : null;
  if (!files || files.length === 0 || !files.every(file => file !== null && typeof file === "object"
    && typeof file.path === "string" && (HEX64.test(file.sha256 ?? "") || typeof file.link === "string"))) {
    throw new BrainVendorError("vendor/brain.json has no valid file list");
  }
  return record as unknown as VendorManifest;
}

/** The staged record, or a `missing` error when `vendor/brain.json` does not exist. */
export async function readVendorManifest(vendor: string): Promise<VendorManifest> {
  let bytes: string;
  try { bytes = await readFile(vendorLayout(vendor).manifest, "utf8"); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new BrainVendorError("no brain is staged", true);
    throw new BrainVendorError("vendor/brain.json cannot be read");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); } catch { throw new BrainVendorError("vendor/brain.json is not JSON"); }
  return parseVendorManifest(parsed);
}

/** The two files every gbrain process starts from, hashed before every start. */
export async function verifyVendorEntries(vendor: string, manifest: VendorManifest): Promise<void> {
  const layout = vendorLayout(vendor);
  for (const [path, expected, label] of [[layout.bun, manifest.bunSha256, "vendor/bun/bun"], [layout.cli, manifest.cliSha256, "vendor/gbrain/src/cli.ts"]] as const) {
    let actual: string;
    try { actual = await sha256File(path); }
    catch { throw new BrainVendorError(`${label} is missing`); }
    if (actual !== expected) throw new BrainVendorError(`${label} differs from what was staged`);
  }
}

/** Every staged file, at install and in `foliage brain status` (2.6 s warm for the tree, per the spec). */
export async function verifyVendorTree(vendor: string, manifest: VendorManifest): Promise<void> {
  let actual: VendorFile[];
  try { actual = await hashVendorTree(vendor); }
  catch (error) {
    if (error instanceof BrainVendorError) throw error;
    // A file or directory that vanished or cannot be read mid-walk: named, never a raw path.
    throw new BrainVendorError("vendor/ is partly missing or cannot be read");
  }
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  for (const file of actual) {
    const want = expected.get(file.path);
    if (!want) throw new BrainVendorError(`vendor/${file.path} was not staged`);
    if (want.sha256 !== file.sha256 || want.link !== file.link) throw new BrainVendorError(`vendor/${file.path} differs from what was staged`);
    expected.delete(file.path);
  }
  const [gone] = expected.keys();
  if (gone !== undefined) throw new BrainVendorError(`vendor/${gone} is missing`);
}

/** Free bytes for this user on the file system that holds `path` (available blocks × block size). */
export async function freeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return Number(info.bavail) * Number(info.bsize);
}

const megabytes = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024))} MB`;

/** Why `needed` bytes cannot be written where `free` bytes are free, in plain words, or null. Pure. */
export function roomProblem(free: number, needed: number, where: string): string | null {
  return free >= needed ? null : `${where} has ${megabytes(free)} free, and ${megabytes(needed)} is needed`;
}

/** Whether a brain archive is built for this platform at all: only where Foliage pins the bun it carries. Pure. */
export function brainArchiveShips(platform: string, arch: string): boolean {
  return BUN_PIN.shipped[`${platform}/${arch}`] !== undefined;
}

/**
 * Why this bun cannot ship for this platform, or null: no brain ships where Foliage pins no bun bytes,
 * and only the pinned bytes ship. Pure.
 */
export function shippedBunProblem(target: { readonly platform: string; readonly arch: string; readonly bunSha256: string }): string | null {
  const pinned = BUN_PIN.shipped[`${target.platform}/${target.arch}`];
  if (pinned === undefined) return `no brain ships for ${target.platform}/${target.arch}: only macOS arm64 has passed the offline test`;
  return target.bunSha256 === pinned ? null : "vendor/bun/bun is not the bun Foliage ships";
}

/** The pins `vendor/release.json` must name exactly as `vendor/brain.json` does. */
const RELEASE_PINS = ["gbrainVersion", "gbrainCommit", "gbrainIntegrity", "bunVersion", "bunSha256", "platform", "arch"] as const;

/**
 * THE RUNTIME PREFLIGHT ON A USER'S MACHINE (spec, "Preflight"; build order item 7). The installer
 * runs it on a brain archive before copying it and again where it was copied to, from the Foliage
 * that will run it, so the pins are read in one place: Foliage's own pins and this platform
 * (`readVendorManifest`), bun's bytes against the ones Foliage ships, the release record naming the
 * same pins as the staging record, every staged file (`verifyVendorTree`), and bun's execute bits.
 * The installer has already checked every file against `vendor/release.json`. Nothing is run, and
 * nothing asks the kernel whether bun may run: `access(X_OK)` is checked as an exec, so the offline
 * gate's macOS sandbox kills an installer that asks it about a bun the step may not start (measured
 * 2026-10-12, no deny line). The mode bits are read instead.
 */
export async function verifyShippedBrain(vendor: string): Promise<VendorManifest> {
  const manifest = await readVendorManifest(vendor);
  const bun = shippedBunProblem(manifest);
  if (bun !== null) throw new BrainVendorError(bun);
  let release: Record<string, unknown>;
  try { release = JSON.parse(await readFile(join(vendor, "release.json"), "utf8")) as Record<string, unknown>; }
  catch { throw new BrainVendorError("vendor/release.json is missing or not JSON"); }
  for (const key of RELEASE_PINS) {
    if (release[key] !== manifest[key]) throw new BrainVendorError(`vendor/release.json names another ${key} than vendor/brain.json`);
  }
  await verifyVendorTree(vendor, manifest);
  const info = await lstat(vendorLayout(vendor).bun);
  if (!info.isFile() || (info.mode & 0o111) === 0) throw new BrainVendorError("vendor/bun/bun is not executable");
  return manifest;
}
