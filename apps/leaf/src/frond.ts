/**
 * The leaf's own frond — the product thesis drawn from the person's real document.
 *
 * The mark is a bipinnate compound leaf: a leaf built out of leaves. This is the same botany at
 * data scale: THE MARK carries the check-tick and
 * asserts proof; A DATA FROND asserts nothing. Small collections attach directly to the rachis;
 * fuller collections use paired pinnae within one bounded compound silhouette. There is one
 * ellipse per leaflet IN THE DOCUMENT, in document order from base to tip, coloured by proof
 * tier and nothing else. Pinnae are layout supports, not invented project or team groupings.
 *
 * WHAT IT REFUSES, because the drawing must obey the same rules as the page:
 *   - no size-by-anything: every leaflet is the same size. Size would be a score in a costume.
 *   - no ordering but document order — the same order the list below renders.
 *   - no visible numbers. Only the private face carries ledger counts in its aria-label;
 *     published readers get a description without a per-person tally.
 *   - no per-leaflet titles inside the SVG: a commit subject is verbatim content, and carrying
 *     it here would need the data-verbatim machinery twice. The rows below already carry it.
 *   - colours by class + token, never a hex: the frond follows the face like everything else.
 */
import type { Leaflet } from "@foliage/leaf";
import type { AttributionLedger } from "@foliage/leaf";

/** The preview keeps its proportions as records accumulate instead of becoming a tall strip. */
const W = 200;
const CX = 100;

export function renderLeafFrond(leaflets: readonly Leaflet[], ledger: AttributionLedger, audience: "private" | "published" = "private"): string {
  if (leaflets.length === 0) return "";

  const branched = leaflets.length > 12;
  const pairs = branched ? Math.min(6, Math.ceil(leaflets.length / 20)) : Math.ceil(leaflets.length / 2);
  const baseY = branched ? 70 + (pairs - 1) * 40 : 24 + pairs * 20;
  const H = baseY + 28;
  const pinnae: string[] = [];
  const perPinna = Math.ceil(leaflets.length / (pairs * 2));
  const number = (value: number): string => String(Math.round(value * 100) / 100);
  if (branched) {
    for (let axis = 0; axis * perPinna < leaflets.length; axis++) {
      const pair = Math.floor(axis / 2), side = axis % 2 === 0 ? 1 : -1;
      const y = baseY - pair * 40, reach = 72 - pair * 5;
      pinnae.push(`<path class="frond-pinna" d="M ${CX} ${y} L ${CX + side * reach} ${y - 24}"/>`);
    }
  }
  const blades = leaflets.map((l, i) => {
    let x: number, y: number, angle: number;
    if (branched) {
      const axis = Math.floor(i / perPinna), pair = Math.floor(axis / 2), side = axis % 2 === 0 ? 1 : -1;
      const within = i % perPinna, across = within % 2 === 0 ? 1 : -1;
      const count = Math.min(perPinna, leaflets.length - axis * perPinna);
      const along = .2 + .8 * (Math.floor(within / 2) + 1) / Math.ceil(count / 2);
      const dx = side * (72 - pair * 5), dy = -24, length = Math.hypot(dx, dy);
      x = CX + dx * along - (dy / length) * across * 5;
      y = baseY - pair * 40 + dy * along + (dx / length) * across * 5;
      angle = Math.atan2(dy, dx) * 180 / Math.PI + across * 35;
    } else {
      const side = i % 2 === 0 ? 1 : -1;
      x = CX + side * 28; y = baseY - Math.floor(i / 2) * 20;
      angle = side === 1 ? -35 : 35;
    }
    // Rotate around the ellipse's own centre: rotating a left centre 215° around the rachis
    // previously moved it to the RIGHT, placing both halves of every pair on the same side.
    return `<ellipse class="frond-lf" data-frond-tier="${l.tier}" cx="${number(x)}" cy="${number(y)}" rx="${branched ? 7 : 22}" ry="${branched ? 3 : 5.5}" transform="rotate(${number(angle)} ${number(x)} ${number(y)})"/>`;
  }).join("\n");

  const label = audience === "published"
    ? "Published work drawn as a leaf, in document order. Attribution appears with each entry."
    : `${ledger.verified + ledger.pending + ledger.excluded} leaflets — ` +
    `${ledger.verified} verified, ${ledger.pending} pending, ${ledger.excluded} excluded, ` +
    `drawn in document order`;

  return `<svg class="leaf-frond" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<path class="frond-rachis" d="M ${CX} ${baseY + 14} L ${CX} 18" />
${pinnae.join("\n")}
${blades}
</svg>`;
}
