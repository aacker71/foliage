/**
 * WHAT A PUBLIC CANOPY PAGE MAY SAY ABOUT THE MACHINE IT RUNS ON: the file's NAME, never the path
 * to it.
 *
 * THE RULE ALREADY EXISTED IN TWO PLACES AND WAS OBEYED IN NEITHER OF THESE RENDERERS.
 * `apps/leaf/export.mjs:20-25` states it for the leaf surface — "the Document footer shows the
 * file's NAME, not its absolute path … in a folder handed to somebody else it publishes the
 * owner's username and home layout (measured: `~/…` shipped in the visible footer, found
 * by three independent reviewers)" — keeping the path only where the OWNER is the audience, on
 * their own server. And `publishedLeaf.test.ts`'s header states the sharper half for failures:
 * "The loader's `detail` names the exact file on purpose — it is for the log — and the renderer
 * must never carry it."
 *
 * The canopy is the PUBLIC host — "what recruiters, boards and the public see" — so it never has
 * the audience that licenses a path, and both halves of the rule apply to every one of its pages.
 *
 * WHY THIS IS A MODULE RATHER THAN A HELPER IN ONE RENDERER, which is the mistake it exists to
 * correct. F-031's first fix put a local `documentName` in `renderTree.ts` and stripped the three
 * `source.path` sites that file rendered on a SUCCESSFUL load. The three-pass review then found
 * four more live leaks of the same value, measured through the real loader and renderer: this
 * file's own failure page (`renderFailure`'s Path row and its detail), the per-entry failure
 * detail that renders NEXT TO the fixed roster on an ordinary page, the front door
 * (`renderCanopy.ts`'s tree row), and the footer of every `/leaf/<id>` and `/leaflet/<id>`
 * (`renderPublic.ts`'s `sourceFooter`). A leak class is closed by enumerating the VALUE's
 * consumers, never by auditing one file — and a shared function is what makes the enumeration
 * checkable, because a new consumer that does not call it is visible in review.
 *
 * WHAT STAYS: byte counts and read instants. They are provenance about the DOCUMENT. The path is
 * provenance about the MACHINE, and the machine is not what is published.
 */
import { basename } from "node:path";

/** The document's name, for a page a stranger reads. */
export function documentName(path: string): string {
  return basename(path);
}

/**
 * A loader's `detail` with the machine's path reduced to the document's name.
 *
 * The detail sentences are built around the resolved absolute path — `${path} is not valid JSON:
 * …`, `no leaf document at ${path} (named by this tree manifest).` — and every failure type that
 * carries one also carries the `path` it was built from, so the substitution is exact rather than
 * a guess at what looks like a path. `unconfigured` carries `path: null` and has no path in its
 * text; passing null is the honest way to say so.
 *
 * The rest of the sentence survives, deliberately: the CAUSE is what an operator and a reader both
 * need, and deleting it to avoid a path would trade one dishonesty for another.
 */
export function withoutMachinePath(detail: string, path: string | null): string {
  if (path === null || path === "") return detail;
  return detail.split(path).join(basename(path));
}
