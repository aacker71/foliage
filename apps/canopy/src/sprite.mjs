/**
 * THE MARK SPRITE, INLINED ONCE PER DOCUMENT — one definition, two callers.
 *
 * The canopy's pages reference marks as `<use href="#fol-mark-sm">`, which resolves only against a
 * sprite present IN THE SAME DOCUMENT: an external `<use href="sprite.svg#id">` does not resolve
 * cross-origin or under `file://`. So every page has to carry the symbols, and something has to put
 * them there after the renderer has produced the markup.
 *
 * WHY IT IS A MODULE RATHER THAN A FUNCTION IN `server.mjs`, where it lived. The server injected at
 * request time and the renderers knew nothing about it — which is correct, and which meant a second
 * consumer rendering the same pages produced documents whose every mark pointed at nothing.
 * MEASURED 2026-09-04: the first draft of `apps/canopy/export.mjs` called the renderers directly and
 * emitted pages with zero `<symbol>` elements. The bug is invisible in HTML that validates, renders
 * without error, and is missing only its logo.
 *
 * Sharing it is also the F-035 lesson applied before the fact rather than after: two copies of one
 * rule token-match nothing, `check:dup` cannot see them, and they drift.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BODY_OPEN = /<body\b[^>]*>/i;

/**
 * Read the sprite once, from the one file that holds it.
 *
 * The I/O lives here and `inlineSprite` below takes the text as a parameter — that split is what
 * lets the injection be tested without a filesystem, and it is what the caller is buying by asking
 * this module for the bytes instead of resolving the package path itself.
 *
 * @returns {Promise<string>}
 */
export async function readSprite() {
  return (await readFile(fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")), "utf8"))
    .replace('style="position:absolute"', 'class="fol-sprite"');
}

/**
 * Insert the sprite immediately after `<body>`.
 *
 * A document with no `<body>` is returned unmodified and reported by the caller: the alternative is
 * writing the symbols somewhere they will not resolve, which looks like it worked.
 *
 * @param {string} sprite
 * @param {string} html
 * @returns {{ html: string, injected: boolean }}
 */
export function inlineSprite(sprite, html) {
  const at = html.match(BODY_OPEN);
  if (at === null || at.index === undefined) return { html, injected: false };
  const cut = at.index + at[0].length;
  return { html: `${html.slice(0, cut)}\n${sprite}\n${html.slice(cut)}`, injected: true };
}
