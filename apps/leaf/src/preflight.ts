/**
 * PREFLIGHT — turns the one failure every fresh clone can hit into an instruction.
 *
 * Before `pnpm install`, the workspace packages (`@foliage/leaf`, `@foliage/tokens`) exist
 * only as declarations — the symlinks under node_modules are not there yet — so the entry
 * points die at import time with a raw ERR_MODULE_NOT_FOUND stack trace. A stranger reading
 * that trace has no way to know the fix is one command. The dry run of the external-tester
 * path hit exactly this and rated it not self-explanatory.
 *
 * Static imports cannot be guarded from inside the importing file (the whole module graph
 * links before any code runs), so the entry points import their workspace dependencies
 * dynamically and route the failure here.
 *
 * Discipline carried from AGENTS.md: error masking is a recurring bug class, so BOTH causes
 * are always reported — the original resolver message verbatim, then the instruction. Any
 * error that is not a module-resolution failure is rethrown untouched; this file explains
 * exactly one situation and must never swallow a different one.
 */

/** The shape of the one field Node's resolver errors carry that we dispatch on. */
interface MaybeCodedError {
  code?: unknown;
}

/**
 * Handler for a failed import of a workspace dependency. Exits with the instruction when the
 * failure is module resolution; rethrows anything else.
 */
export function explainFailedWorkspaceImport(error: unknown): never {
  const code = error instanceof Error ? (error as MaybeCodedError).code : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error("");
    console.error(
      "The workspace packages are not linked yet — run `pnpm install` from the repository",
    );
    console.error("root first, then retry this command.");
    process.exit(1);
  }
  throw error;
}
