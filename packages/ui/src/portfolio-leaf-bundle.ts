/** The optional shared browser bundle is bound to its renderer, stylesheet and build inputs. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FILE = "build/portfolio-leaf.bundle.js";
const RECEIPT = "build/portfolio-leaf.receipt.json";
const inputs = ["src/portfolio-leaf.mjs", "src/portfolio-leaf.css", "src/portfolio-leaf-bundle.ts", "build-portfolio-leaf.mjs", "package.json"];
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const remedy = "Run pnpm --filter @foliage/ui portfolio:build, then reload.";

export async function portfolioLeafInputDigest(packageRoot = PACKAGE_ROOT): Promise<string> {
  const files = await Promise.all(inputs.map(async name => {
    const bytes = await readFile(join(packageRoot, name));
    return `${name}\0${bytes.length}\0${sha(bytes)}`;
  }));
  return sha(files.join("\n"));
}

export async function recordPortfolioLeafBuild(sourceDigest: string, packageRoot = PACKAGE_ROOT): Promise<void> {
  if (sourceDigest !== await portfolioLeafInputDigest(packageRoot)) throw new Error("Portfolio renderer inputs changed during the build. Rebuild the renderer.");
  const bundleDigest = sha(await readFile(join(packageRoot, FILE)));
  await writeFile(join(packageRoot, RECEIPT), JSON.stringify({ version: 1, sourceDigest, bundleDigest }) + "\n");
}

export type PortfolioLeafBundleStatus = { readonly ok: true; readonly path: string } | {
  readonly ok: false;
  readonly cause: "bundle-missing" | "bundle-stale" | "bundle-damaged" | "bundle-unreadable";
  readonly reason: string;
  readonly remedy: string;
};

export async function checkPortfolioLeafBundle(packageRoot = PACKAGE_ROOT): Promise<PortfolioLeafBundleStatus> {
  const fail = (cause: Extract<PortfolioLeafBundleStatus, { ok: false }>["cause"], reason: string): PortfolioLeafBundleStatus => ({ ok: false, cause, reason, remedy });
  try {
    const [receipt, bundle, sourceDigest] = await Promise.all([
      readFile(join(packageRoot, RECEIPT), "utf8"), readFile(join(packageRoot, FILE)), portfolioLeafInputDigest(packageRoot),
    ]);
    let saved: unknown;
    try { saved = JSON.parse(receipt); }
    catch { return fail("bundle-damaged", "3D renderer build record unreadable."); }
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1
      || !("bundleDigest" in saved) || saved.bundleDigest !== sha(bundle)
      || !("sourceDigest" in saved) || typeof saved.sourceDigest !== "string") {
      return fail("bundle-damaged", "3D renderer does not match its build.");
    }
    return saved.sourceDigest === sourceDigest ? { ok: true, path: join(packageRoot, FILE) }
      : fail("bundle-stale", "3D renderer needs rebuilding.");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return fail("bundle-missing", "3D renderer or its sources missing.");
    return fail("bundle-unreadable", `3D renderer check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
