import type { LeafLoad, LeafLoadCause } from "./leafDocument.ts";
import type { HarvestLoad } from "./render.ts";

type HarvestLoadCause = Extract<HarvestLoad, { ok: false }>["cause"];

/** Keep file failures distinct without putting storage codes in the visible interface. */
export const LEAF_LOAD_LABEL: Readonly<Record<LeafLoadCause, string>> = Object.freeze({
  unconfigured: "No Leaf file configured",
  absent: "Leaf file missing",
  unreadable: "Leaf file unreadable",
  malformed: "Leaf file is not valid JSON",
  invalid: "Leaf file needs repair",
});

/**
 * A Leaf that did not load, said as the state and the next step. The loader's own `detail` names
 * the absolute path and the OS error; that is for logs and Technical details, never the sentence
 * a page leads with. Pages that throw on a failed load throw this instead.
 */
export function leafLoadProblem(load: { readonly cause: LeafLoadCause }): string {
  switch (load.cause) {
    case "unconfigured":
      return "The location of your private record isn't set for this workspace. Start Foliage with foliage up.";
    case "absent":
      return "No private record yet. Start your record in Portfolio first.";
    case "unreadable":
      return "Couldn't read your private record. Check the file's permissions, then reload.";
    case "malformed":
      return "Couldn't read your private record: the file is not valid JSON. Repair it, then reload.";
    case "invalid":
      return "Your private record needs repair. Portfolio lists what to fix.";
    default: {
      const impossible: never = load.cause;
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * Thrown by a page that cannot go on without the record. The message is `leafLoadProblem`; the
 * load rides along so the page that catches it can name the file and what the loader saw there
 * in a closed Technical details (`leafLoadTechnical`) when repairing that file is the way on.
 */
export class LeafLoadError extends Error {
  readonly load: Extract<LeafLoad, { ok: false }>;
  constructor(load: Extract<LeafLoad, { ok: false }>) { super(leafLoadProblem(load)); this.load = load; }
}

/**
 * The drafts that did not load, said as the state and the next step for a page other than
 * /review. /review is where the file and what to repair are named, so a file to repair points there.
 */
export function harvestLoadProblem(load: { readonly cause: HarvestLoadCause }): string {
  switch (load.cause) {
    case "unconfigured":
      return "No draft file is set for this workspace. Start Foliage with foliage up.";
    case "absent":
      return "No drafts yet. Collect work in Sources first.";
    case "unreadable":
    case "malformed":
    case "invalid":
      return "Couldn't read your drafts. Review shows what to repair.";
    default: {
      const impossible: never = load.cause;
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/** What every owner surface says when the publish rules did not load; the file and the loader's words stay in Technical details. */
export const POLICY_UNAVAILABLE = "Foliage cannot apply the current publish rules. Fix the policy configuration or file, then reload this page.";

export const HARVEST_LOAD_LABEL: Readonly<Record<HarvestLoadCause, string>> = Object.freeze({
  unconfigured: "No draft file configured",
  absent: "No drafts yet",
  unreadable: "Draft file unreadable",
  malformed: "Draft file is not valid JSON",
  invalid: "Draft file needs repair",
});
