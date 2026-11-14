/**
 * PUBLIC API SURFACE — the compensating control for the corpse class check:dup cannot see.
 *
 * knip and jscpd catch TOKEN-LEVEL duplication and dead exports. Neither catches two
 * independently-named, differently-shaped reimplementations of the SAME domain rule: that is
 * exactly the shape `mergeIntakeIntoLeaflets` had next to `mergeIntakeIntoLeaf` (see the commit
 * that added check:dup) — different type names (`RetainedLeaflet`/`MergeIntakeRequest` vs
 * `CarriedForwardLeaflet`/`MergeRequest`), different field names (`retained`/`displaced` vs
 * `carriedForward`/`wouldDrop`), same rule. Structurally different source token-matches nothing
 * at any jscpd threshold, and knip counted the dead function's own test file as a caller — a
 * mutation test that restored the old function verbatim confirmed both tools stayed green. That
 * class is caught by review hunting reimplementations BY RULE, not by tooling; this test is the
 * one durable, always-on check for it.
 *
 * FOUR TIMES THIS TEST'S OWN MECHANISM WAS THE HOLE, across four rounds. Three were the
 * mechanism itself (a source-text scan can only assert coverage of the export SHAPES someone
 * thought to write a pattern for, never of every shape TypeScript's grammar allows) — fixed by
 * switching to a runtime `import()` and walking the actual module namespace instead of its
 * source text. The fourth was this walk's own blind spot: `isRecursable` only recursed into
 * `typeof value === "object"`, so a corpse living on a FUNCTION or a CLASS — a static method
 * (`class ForkedMerge { static mergeIntakeIntoLeaflets() {} }`) or a property attached directly
 * to a function — was invisible while fully callable, because `typeof someClass === "function"`,
 * not `"object"`. Fixed by walking functions and classes too: they are objects underneath, and
 * `Object.getOwnPropertyNames` sees a class's static methods even though class syntax makes them
 * non-enumerable (`Object.keys` alone would still have missed them).
 *
 * WHAT THIS TEST GUARANTEES, exactly, and no further: it enumerates every export reachable
 * WITHOUT EXECUTING ANY OF THE PROJECT'S CODE — declarations, every re-export syntax, namespace
 * nesting, class statics, function-attached properties. A corpse constructed only AT CALL TIME —
 * a factory's return value, a getter — is invisible to any passive scan, this one included,
 * because seeing it requires calling the function or reading the accessor, and this test does
 * neither: `ownDataProperties` below reads a property only when `Object.getOwnPropertyDescriptor`
 * reports it as a DATA property, and skips accessors (`get`/`set`) rather than invoke them. That
 * class of corpse is hunted by review Pass 2 (`.promptx/review-protocol.md`), which can reason
 * about a function's BODY, not by this test, which can only reason about what a module exposes
 * before anything runs. Review has falsified "no further evasion is expected" twice already, so
 * this file does not repeat that claim — it states the boundary instead, and lets it stand.
 *
 * `export default`'s one special case: a namespace reports it under the literal key `"default"`,
 * which never matches a name pattern. The corpse's actual identity there is the exported
 * function's OWN `.name` (`export default function mergeIntakeIntoLeaflets() {}` still carries
 * that name on the function object — ECMAScript's NamedEvaluation rule only overwrites it with
 * the literal string `"default"` for an ANONYMOUS default export, which cannot collide with a
 * corpse name in the first place). So the key `"default"` resolves to `value.name` before the
 * shape check, and to the literal key otherwise.
 *
 * Bite-proven against every evasion review has found, each in its own process, each reddened
 * then reverted: (1) a corpse declared directly in index.ts, (2) `export { x as
 * mergeIntakeIntoLeaflets }`, (3) `export default function mergeIntakeIntoLeaflets`, (4) `export
 * * as forkedMerge from` a corpse file, (5) `export class ForkedMerge { static
 * mergeIntakeIntoLeaflets() {} }`. A sixth, `export function legacyMergeTools() { return {
 * mergeIntakeIntoLeaflets: ... }; }`, was tried and — as documented above — stayed green: the
 * corpse there exists only inside a return value, which this test never produces.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Recursion cannot run away on a real export graph, but nothing enforces that structurally. */
const MAX_DEPTH = 6;

/**
 * A value worth recursing into: a module namespace (from `export * as x from "..."`), a POJO, a
 * function, or a class. Functions and classes ARE objects — a class's static members and a
 * function's attached properties live as own properties of the function object itself, which is
 * exactly the shape `class ForkedMerge { static mergeIntakeIntoLeaflets() {} }` uses to hide.
 * Arrays are excluded: numeric indices never carry a name worth checking, and a large exported
 * array is not worth walking.
 */
function isRecursable(value: unknown): value is object {
  if (value === null || Array.isArray(value)) return false;
  return typeof value === "object" || typeof value === "function";
}

/**
 * [name, value] for every own DATA property of `obj` — never an accessor. `Object.getOwnPropertyNames`
 * (not `Object.keys`) so a class's static METHODS are seen too: class syntax makes them
 * non-enumerable, which `Object.keys` alone would silently skip. Reading `descriptor.value`
 * rather than `obj[key]` directly is what keeps this a passive scan: a getter's descriptor has
 * `get`/`set`, not `value`, and is skipped rather than invoked — this test asserts nothing about
 * a corpse that only exists once code runs, and refuses to be the code that runs it.
 */
function ownDataProperties(obj: object): readonly (readonly [string, unknown])[] {
  return Object.getOwnPropertyNames(obj).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    return descriptor !== undefined && "value" in descriptor
      ? ([[key, descriptor.value]] as const)
      : [];
  });
}

/**
 * Every export name reachable from `obj`, flattened: `obj`'s own data-property names, and — for
 * any value that is itself recursable — every name reachable inside IT, recursively. A `default`
 * key resolves to the exported function/class's own `.name` first, since the key itself never
 * carries the corpse's identity.
 */
function reachableExportNames(
  obj: object,
  visited: WeakSet<object>,
  depth: number,
): readonly string[] {
  if (depth > MAX_DEPTH || visited.has(obj)) return [];
  visited.add(obj);

  return ownDataProperties(obj).flatMap(([key, value]) => {
    const name = key === "default" && typeof value === "function" ? value.name : key;
    const nested = isRecursable(value) ? reachableExportNames(value, visited, depth + 1) : [];
    return [name, ...nested];
  });
}

/** Case-insensitive: either word order, so a fork cannot dodge this by renaming. */
const INTAKE_MERGE_SHAPE = /merge.*intake|intake.*merge/i;

test("packages/leaf's public API exposes exactly one intake-merge entry point", async () => {
  const barrel = await import("./index.ts");
  const surface = reachableExportNames(barrel as unknown as object, new WeakSet<object>(), 0);
  const found = surface.filter((name) => INTAKE_MERGE_SHAPE.test(name));

  assert.deepEqual(
    found,
    ["mergeIntakeIntoLeaf"],
    `packages/leaf/src/index.ts must expose exactly one intake-merge entry point ` +
      `(mergeIntakeIntoLeaf). Found instead: ${JSON.stringify(found)} — a second export ` +
      `matching merge*intake*/intake*merge* is the corpse class check:dup cannot see: an ` +
      `independently-named reimplementation of the same rule token-matches nothing.`,
  );
});
