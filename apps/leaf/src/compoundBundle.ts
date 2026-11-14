/** The optional renderer must match the page contract as well as its own source. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUNDLE = "public/compound-leaf.bundle.js";
const PREFIX = "/* foliage-compound-bundle ";
const REMEDY = "Run pnpm --filter @foliage/leaf-app explore:build, then reload.";
const INPUTS = [
  "public/compound-leaf.mjs", "public/compound-leaf.css", "src/compoundPage.ts", "src/compoundLayout.ts",
  "build-compound.mjs", "src/compoundBundle.ts",
] as const;

type FailureCause = "bundle-missing" | "bundle-unreadable" | "bundle-unrecorded" | "bundle-damaged" | "source-unreadable" | "bundle-stale";
export type CompoundBundleStatus =
  | { ok: true; sourceDigest: string; bundleDigest: string }
  | { ok: false; cause: FailureCause; reason: string; remedy: string };

const digest = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const failure = (cause: FailureCause, reason: string): CompoundBundleStatus => ({ ok: false, cause, reason, remedy: REMEDY });

/** Captured BEFORE bundling; checking again afterwards detects edits during the build. */
export async function compoundInputDigest(appRoot = APP_ROOT): Promise<string> {
  const hash = createHash("sha256");
  for (const name of INPUTS) {
    const bytes = await readFile(join(appRoot, name));
    hash.update(`${name}\0${bytes.length}\0`).update(bytes);
  }
  const pkg = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8")) as { dependencies?: { three?: unknown } };
  const version = pkg.dependencies?.three;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("The renderer requires an exact pinned Three.js dependency version.");
  }
  return hash.update(`three\0${version}\0`).digest("hex");
}

/** Stamp only a successful build of unchanged inputs; the stamp binds the remaining bytes. */
export async function stampCompoundBundle(sourceDigest: string, appRoot = APP_ROOT): Promise<void> {
  if (await compoundInputDigest(appRoot) !== sourceDigest) {
    throw new Error("Compound Leaf inputs changed while the renderer was building. Run explore:build again.");
  }
  const path = join(appRoot, BUNDLE);
  const bytes = await readFile(path);
  const stamp = { version: 1, sourceDigest, bundleDigest: digest(bytes) };
  await writeFile(path, Buffer.concat([Buffer.from(`${PREFIX}${JSON.stringify(stamp)} */\n`), bytes]));
}

/** Re-read on each page request so a branch switch cannot keep a formerly valid verdict. */
export async function checkCompoundBundle(appRoot = APP_ROOT): Promise<CompoundBundleStatus> {
  let bytes: Buffer;
  try { bytes = await readFile(join(appRoot, BUNDLE)); }
  catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
      ? failure("bundle-missing", "3D renderer not built.")
      : failure("bundle-unreadable", `3D renderer unreadable: ${errorText(error)}`);
  }
  const newline = bytes.indexOf(10);
  const header = newline >= 0 && newline < 1024 ? bytes.subarray(0, newline).toString("utf8") : "";
  if (!header.startsWith(PREFIX) || !header.endsWith(" */")) {
    return failure("bundle-unrecorded", "3D renderer build too old.");
  }
  let stamp: unknown;
  try { stamp = JSON.parse(header.slice(PREFIX.length, -3)); }
  catch { return failure("bundle-damaged", "3D renderer build record unreadable."); }
  if (typeof stamp !== "object" || stamp === null || !("version" in stamp) || stamp.version !== 1
    || !("sourceDigest" in stamp) || typeof stamp.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(stamp.sourceDigest)
    || !("bundleDigest" in stamp) || typeof stamp.bundleDigest !== "string" || !/^[a-f0-9]{64}$/.test(stamp.bundleDigest)) {
    return failure("bundle-damaged", "3D renderer build record invalid.");
  }
  if (digest(bytes.subarray(newline + 1)) !== stamp.bundleDigest) {
    return failure("bundle-damaged", "3D renderer bytes changed.");
  }
  let sourceDigest: string;
  try { sourceDigest = await compoundInputDigest(appRoot); }
  catch (error) { return failure("source-unreadable", `3D renderer sources unreadable: ${errorText(error)}`); }
  return sourceDigest === stamp.sourceDigest
    ? { ok: true, sourceDigest, bundleDigest: stamp.bundleDigest }
    : failure("bundle-stale", "3D renderer out of date.");
}
