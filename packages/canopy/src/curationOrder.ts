import { featuredLeaflets, type Leaf } from "@foliage/leaf";

/** Apply the person's order only to records already admitted by the caller's public gate.
 * Missing/private/withheld choices create no placeholders, metadata or counts in the output. */
export function orderAdmittedLeaflets<T extends { readonly id: string }>(leaf: Leaf, admitted: readonly T[]): readonly T[] {
  const available = new Map(admitted.map(record => [String(record.id), record]));
  const leading = featuredLeaflets(leaf).flatMap(record => {
    const permitted = available.get(String(record.id));
    return permitted ? [permitted] : [];
  });
  const selected = new Set(leading.map(record => record.id));
  return Object.freeze([...leading, ...admitted.filter(record => !selected.has(record.id))]);
}
