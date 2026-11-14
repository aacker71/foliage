/** Placement only: callers supply the owner's resolved choices, never an impact ranking. */
interface BladeSlot { index: number; readonly order: number; readonly t: number }
interface PinnaSlot {
  readonly side: number;
  readonly along: number;
  readonly fraction: number;
  readonly length: number;
  readonly blades: BladeSlot[];
}

export function compoundLayout(count: number, leading: number, featured: readonly number[]): { terminal: number; pinnae: PinnaSlot[] } {
  const terminal = Number.isInteger(leading) && leading >= 0 && leading < count ? leading : -1;
  const lateral = count - (terminal >= 0 ? 1 : 0);
  const groupCount = Math.min(lateral, Math.max(2, Math.min(9, Math.ceil(Math.sqrt(lateral) / 2)) * 2));
  const pairCount = Math.ceil(groupCount / 2);
  const pinnae = Array.from({ length: groupCount }, (_, group) => {
    const pair = Math.floor(group / 2);
    const fraction = pair / Math.max(1, pairCount - 1);
    const blades = Math.floor(lateral / groupCount) + (group < lateral % groupCount ? 1 : 0);
    return {
      side: group % 2 === 0 ? -1 : 1,
      along: pairCount === 1 ? (terminal >= 0 ? 0.78 : 0.48) : 0.12 + pair / (pairCount - 1) * 0.80,
      fraction,
      length: 0.22 + 2.9 * Math.pow(Math.sin(Math.PI * (0.16 + fraction * 0.79)), 0.85),
      blades: Array.from({ length: blades }, (_, order) => ({ index: -1, order,
        t: 0.08 + Math.floor(order / 2) / Math.max(1, Math.ceil(blades / 2) - 1) * 0.86 })),
    };
  });
  const slots = pinnae.flatMap((pinna, group) => pinna.blades.map(blade => ({ blade, along: pinna.along, group })));
  // Sort positions near the tip; the records themselves retain the owner's explicit order.
  const upper = [...slots].sort((a, b) => b.along - a.along || b.blade.t - a.blade.t || a.blade.order - b.blade.order || a.group - b.group);
  const chosen = [...new Set(featured)].filter(index => Number.isInteger(index) && index >= 0 && index < count && index !== terminal);
  chosen.forEach((index, order) => { upper[order]!.blade.index = index; });
  const assigned = new Set([terminal, ...chosen]);
  const remaining = Array.from({ length: count }, (_, index) => index).filter(index => !assigned.has(index));
  let next = 0;
  for (const { blade } of slots) if (blade.index < 0) blade.index = remaining[next++]!;
  return { terminal, pinnae };
}
