/**
 * WHICH REPOSITORY THE GARDEN'S WORK LIVES IN, when a command needs one and nobody typed it.
 *
 * `foliage up` needs it for portfolio work dates (FOLIAGE_SOURCE_REPO), and `foliage
 * migrate-queue` needs it to date the queue's refs. Both ask the same question, so both use this.
 *
 * The answer is never a guess: an explicit FOLIAGE_SOURCE_REPO, else the repository the harvest
 * records, else the ONE watched source, else — only when nothing is watched — the ONE enabled
 * workflow source. Two or more at any step, or a list that could not be read, answers nothing.
 *
 * PURE and TOTAL: the caller reads the documents.
 */

export interface SourceRepoInputs {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The harvest's recorded `repo`, if the harvest has one. */
  readonly harvestRepo: string | undefined;
  /** Watched source paths, or null when the sources document could not be read. */
  readonly watched: readonly string[] | null;
  /** Workflow sources, or null when the workflow document could not be read. */
  readonly workflowSources: readonly { readonly path: string; readonly enabled: boolean }[] | null;
}

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const only = (paths: readonly string[]): string | undefined => {
  const distinct = [...new Set(paths)];
  return distinct.length === 1 ? distinct[0] : undefined;
};

export function sourceRepoFor(inputs: SourceRepoInputs): string | undefined {
  const explicit = present(inputs.env["FOLIAGE_SOURCE_REPO"]);
  if (explicit !== undefined) return explicit;
  const recorded = present(inputs.harvestRepo);
  if (recorded !== undefined) return recorded;
  if (inputs.watched === null) return undefined;
  if (inputs.watched.length > 0) return only(inputs.watched);
  if (inputs.workflowSources === null) return undefined;
  return only(inputs.workflowSources.filter((s) => s.enabled).map((s) => s.path));
}
