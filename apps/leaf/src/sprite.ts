/**
 * The design system's marks and icons, delivered the ONE way that works here.
 *
 * WHY THE SPRITE IS INLINED AND NOT LINKED. `<use href="/foliage-sprite.svg#fol-mark-sm">` — an
 * EXTERNAL reference — is not supported by Blink at all (it has never shipped; the SVG2 external
 * reference works in Gecko and WebKit and silently renders nothing in Chrome). "Silently renders
 * nothing" is the whole problem: the mark would simply be absent for most readers with no error
 * anywhere. So the symbols are inlined into the document that references them, which is also what
 * `@foliage/tokens/foliage.css` instructs at its head.
 *
 * WHY IT IS SUBSET, AND WHY THAT IS NOT A SECOND COPY. The shipped sprite is 34,408 bytes, of
 * which 32,688 are the two large mark tiers (`fol-mark-x` 20,343 and `fol-mark` 12,345) that no
 * leaf surface renders — every mark on these three pages is at or below 28px, where the icon tier
 * is the correct asset rather than a fallback. Inlining all eight symbols would put 34KB of path
 * data on a page that needs 1.4KB of it. The subset is cut from the SHIPPED FILE at run time, so
 * there is still exactly one copy of every path in this repository; nothing here is pasted
 * geometry, and `sprite.test.ts` in the tokens package remains the only thing that validates it.
 *
 * WHY THE SET IS DERIVED FROM THE MARKUP RATHER THAN DECLARED. `symbolsFor` reads the rendered
 * document and inlines precisely the ids it references. That makes both failure modes impossible
 * by construction rather than by discipline:
 *   - a `<use>` with no symbol renders an invisible nothing, and no browser reports it;
 *   - an inlined symbol nothing references is dead weight that grows every time a page changes.
 * A page that stops using an icon stops shipping it, in the same edit, without anyone noticing.
 *
 * AN UNKNOWN ID THROWS. The alternative — emit the `<use>` and skip the symbol — is the invisible
 * failure above, and this module is the only place that can still see it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolved through the package's own export map rather than a relative path, for the same reason
 * `server.mjs` resolves the stylesheet that way: it cannot become a second copy of the file.
 */
const SPRITE_PATH = fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg"));

const SPRITE_SOURCE = readFileSync(SPRITE_PATH, "utf8");

/**
 * id → the symbol element, verbatim. `<symbol>` does not nest, so a non-greedy scan is exact
 * rather than merely convenient.
 */
const SYMBOLS: ReadonlyMap<string, string> = new Map(
  [...SPRITE_SOURCE.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)].map((m) => [m[1]!, m[0]]),
);

if (SYMBOLS.size === 0) {
  throw new Error(
    `@foliage/tokens/foliage-sprite.svg parsed to zero symbols (read from ${SPRITE_PATH}). ` +
      `Every mark and icon on every leaf surface comes from it, so this is not recoverable here.`,
  );
}

/** Every id the shipped sprite defines. Exported so a test can assert against the real file. */
export function spriteSymbolIds(): readonly string[] {
  return [...SYMBOLS.keys()];
}

/**
 * The ids a rendered document references, in first-appearance order and deduplicated.
 *
 * Deliberately reads the same attribute a browser reads. It is `href` and not `xlink:href`:
 * `xlink:href` is deprecated, and supporting both here would mean this function and the renderer
 * could disagree about what the page actually asks for.
 */
export function symbolsFor(html: string): readonly string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(/<use\s+href="#([^"]+)"/g)) {
    const id = m[1]!;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The inline sprite for one document: `<svg>` holding exactly the symbols `html` references, or
 * the empty string when it references none.
 *
 * `width=0 height=0` are ATTRIBUTES and the positioning is a class, deliberately. Open Design's
 * own carrier is `<svg width=0 height=0 style="position:absolute">`, and that inline `style` would
 * be BLOCKED here: the served policy is `style-src 'self'`, which does not permit style
 * attributes, so the carrier would take part in layout after all and push the page down by a line
 * box. The rule lives in `leaf.css` as `.leaf-sprite` instead.
 *
 * `aria-hidden` because the symbols are not content; the elements that reference them carry the
 * accessible name.
 */
export function inlineSpriteFor(html: string): string {
  const ids = symbolsFor(html);
  if (ids.length === 0) return "";
  const symbols = ids.map((id) => {
    const symbol = SYMBOLS.get(id);
    if (symbol === undefined) {
      throw new Error(
        `no symbol "${id}" in @foliage/tokens/foliage-sprite.svg — a <use> referencing it would ` +
          `render nothing at all, silently, in every browser. Defined: ` +
          `${[...SYMBOLS.keys()].join(", ")}`,
      );
    }
    return symbol;
  });
  return `<svg class="leaf-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true"><defs>
${symbols.join("\n")}
</defs></svg>`;
}
