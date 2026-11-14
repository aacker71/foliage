import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    // Count the entry itself, including a dangling symlink, as existing state to inspect.
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    // A permissions or filesystem failure must never masquerade as an absent store.
    throw error;
  }
}

/** Select a release store without creating, moving, or reading its contents. */
export async function selectReleasePath(
  configured: string | undefined,
  options: { home?: string; legacyPath?: string } = {},
): Promise<string> {
  if (configured !== undefined) return resolve(configured);

  const durablePath = resolve(options.home ?? homedir(), ".foliage", "enterprise", "release.json");
  const legacyPath = resolve(options.legacyPath ?? "/tmp/foliage-release.json");
  const legacyExists = await exists(legacyPath);
  const durableExists = await exists(durablePath);

  if (legacyExists && durableExists) {
    throw new Error(
      `Both legacy release state at "${legacyPath}" and durable release state at "${durablePath}" exist. ` +
      "Refusing to choose between them because the legacy store may still have an active writer. " +
      "Inspect both stores and set FOLIAGE_RELEASE to the intended path explicitly. No files were changed.",
    );
  }
  if (legacyExists) {
    throw new Error(
      `Legacy release state exists at "${legacyPath}"; the durable path "${durablePath}" is absent. ` +
      "Refusing to start with empty release state. Set FOLIAGE_RELEASE to the existing store, " +
      "or stop its writers and deliberately move it to the durable path before restarting. No files were changed.",
    );
  }
  return durablePath;
}
