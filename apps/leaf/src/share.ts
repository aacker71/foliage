/**
 * Setting one leaflet's visibility, as a pure transformation of the DOCUMENT.
 *
 * WHY THIS EXISTS AT ALL. `visibility` landed in `@foliage/leaf` with a correct default
 * (`private`, by absence) and two correct predicates, and with NOTHING IN THE TREE THAT WRITES
 * IT. Measured on the real running server before this file: intake writes 39 leaflets, promote
 * writes a 40th, every one of them is `private`, and `GET /leaflet/<id>` answers 404 for all 40.
 * The only way to reach the share route was to open the JSON in an editor. A capability whose
 * sole user path is "hand-edit the document" is not a capability, and the honest name for the
 * gap is that the seam had no writer — so this is the writer.
 *
 * WHY IT MUTATES THE RAW JSON AND NOT THE PARSED `Leaf`. `parseLeafDocument` returns a `Leaf`
 * with `id`, `subject` and `leaflets` — and DROPS `example`. Round-tripping a document through
 * the parser would therefore silently delete `"example": true`, which is the marker that makes
 * the renderer band a document as a fabricated illustration. Stripping a fabrication marker
 * while "just editing a field" is precisely the class of quiet damage this project keeps
 * refusing, so the edit is applied to the bytes' own object graph and the parser is used only
 * as a JUDGE — once on the way in, once on what is about to be written.
 *
 * WHY `null` REMOVES THE KEY RATHER THAN WRITING `"private"`. The domain expresses the default
 * BY ABSENCE and materialises it in exactly one function (`leafletVisibility`). A writer that
 * spelled the default out would create a second spelling of the same state, and then two
 * documents that mean the same thing would not compare equal. Un-sharing therefore deletes.
 *
 * No fs, no clock, no throw — the caller owns all three. See `../share.mjs`.
 */

import { LEAFLET_VISIBILITIES, isLinkShareable, isSubjectsOwnWork, leafletVisibility } from "@foliage/leaf";
import type { LeafletVisibility } from "@foliage/leaf";
import { parseLeafDocument } from "@foliage/leaf";
import type { LeafDocumentIssue } from "@foliage/leaf";

/**
 * What one leaflet's sharing state is, for the `list` view.
 *
 * `shared` is not stored — it is `isLinkShareable` asked once here rather than by every reader,
 * for the same reason the domain refuses to let anyone read the raw field.
 */
export interface VisibilityRow {
  readonly id: string;
  readonly title: string;
  readonly visibility: LeafletVisibility;
  /** True when the leaflet's own address serves it. Never true for an excluded leaflet. */
  readonly shared: boolean;
  /** Present only when the document states one; absent means the default was applied. */
  readonly stated: LeafletVisibility | undefined;
  /** Present only on an excluded leaflet: the reason it already carries. */
  readonly excludedReason?: string;
}

/**
 * FIVE NAMED CAUSES, never a boolean and never a null.
 *
 * `excluded` is the attribution rail (QA #15): an excluded leaflet could not be attributed to the
 * subject, so it is possibly somebody else's work, and it is not theirs to offer. Asked with
 * `isSubjectsOwnWork` — the same structural question canopy's publish and the export ask — not
 * through the publish policy, whose `deny-excluded` rule a person may delete.
 *
 * `unchanged` is deliberately a SUCCESS carrying `changed: false` rather than a failure: asking
 * for the state a leaflet is already in is not an error, and the caller needs to know nothing
 * was written so it does not claim a write it did not make.
 */
export type SetVisibilityOutcome =
  | {
      readonly ok: true;
      readonly document: unknown;
      readonly id: string;
      readonly from: LeafletVisibility;
      readonly to: LeafletVisibility;
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly cause: "not-a-leaf";
      readonly issues: readonly LeafDocumentIssue[];
    }
  | {
      readonly ok: false;
      readonly cause: "no-such-leaflet";
      readonly id: string;
      readonly known: readonly string[];
    }
  | {
      readonly ok: false;
      readonly cause: "excluded";
      readonly id: string;
      readonly reason: string;
    }
  | {
      readonly ok: false;
      readonly cause: "would-not-parse";
      readonly issues: readonly LeafDocumentIssue[];
    };

/** Is this string one of the three states? Asked of the domain's own list, never re-spelled. */
export function isVisibility(value: string): value is LeafletVisibility {
  return (LEAFLET_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Every leaflet's sharing state, in document order.
 *
 * Takes the RAW document so it can report what the file actually states versus what the default
 * supplies — a distinction `leafletVisibility` correctly erases for renderers and which the
 * person deciding what to share is exactly the one who needs it back.
 */
export function visibilityRows(
  raw: unknown,
): { readonly ok: true; readonly rows: readonly VisibilityRow[] } | { readonly ok: false; readonly issues: readonly LeafDocumentIssue[] } {
  const parsed = parseLeafDocument(raw);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const rows = parsed.leaf.leaflets.map((l): VisibilityRow => {
    const visibility = leafletVisibility(l);
    const row = { id: l.id, title: l.title, visibility, stated: l.visibility };
    // An older document can still say an excluded leaflet is shared; it is never served as the
    // subject's, so it never counts as an address that works.
    return isSubjectsOwnWork(l)
      ? { ...row, shared: isLinkShareable(visibility) }
      : { ...row, shared: false, excludedReason: l.reason };
  });
  return { ok: true, rows: Object.freeze(rows) };
}

/**
 * Set (or, with `to === null`, unset) one leaflet's visibility.
 *
 * The returned `document` is a NEW object graph — the input is not mutated, because a caller
 * that got a refusal back must still hold the document it started with, whole.
 */
export function setVisibility(
  raw: unknown,
  id: string,
  to: LeafletVisibility | null,
): SetVisibilityOutcome {
  // JUDGE ON THE WAY IN. Refusing to edit a document this product could not load is what stops
  // this command from being the tool that turns a broken file into a differently broken file.
  const before = parseLeafDocument(raw);
  if (!before.ok) return { ok: false, cause: "not-a-leaf", issues: before.issues };

  const target = before.leaf.leaflets.find((l) => l.id === id);
  if (target === undefined) {
    return {
      ok: false,
      cause: "no-such-leaflet",
      id,
      known: before.leaf.leaflets.map((l) => l.id),
    };
  }

  // Somebody else's work is not the subject's to offer. Making it MORE private stays allowed,
  // so a document written before this refusal can still be cleaned up with `unshare`.
  if (to !== null && isLinkShareable(to) && !isSubjectsOwnWork(target)) {
    return { ok: false, cause: "excluded", id, reason: target.reason };
  }

  const from = leafletVisibility(target);
  const resolved: LeafletVisibility = to ?? "private";

  // Structured clone via JSON, which is what these documents are: it copies every key the file
  // holds, including ones no type in this repository knows about yet.
  const next = JSON.parse(JSON.stringify(raw)) as { leaflets: Record<string, unknown>[] };
  for (const leaflet of next.leaflets) {
    if (leaflet["id"] !== id) continue;
    if (to === null) delete leaflet["visibility"];
    else leaflet["visibility"] = to;
  }

  // JUDGE WHAT IS ABOUT TO BE WRITTEN, over a real round trip. If this fires it is a bug here,
  // and the caller still has the original bytes.
  const after = parseLeafDocument(JSON.parse(JSON.stringify(next)));
  if (!after.ok) return { ok: false, cause: "would-not-parse", issues: after.issues };

  return { ok: true, document: next, id, from, to: resolved, changed: from !== resolved };
}
