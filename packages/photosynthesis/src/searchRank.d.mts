export interface RankNode {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly headings?: readonly string[];
  readonly summary: string;
  readonly keyterms?: readonly string[];
  readonly source: string;
  readonly updated: number;
}

export interface RankIndex {
  readonly docs: readonly { readonly id: string; readonly tf: ReadonlyMap<string, number>; readonly len: number }[];
  readonly df: ReadonlyMap<string, number>;
  readonly tagDf: ReadonlyMap<string, number>;
  readonly avgLen: number;
  readonly n: number;
}

export function tokenize(text: unknown): string[];
export function entryText(node: RankNode): string;
export function buildIndex(nodes: readonly RankNode[]): RankIndex;
export function tagWeight(index: RankIndex, tag: string): number;
export function recencyBoost(updatedMs: number, nowMs: number, halfLifeDays?: number): number;
export function score(
  index: RankIndex,
  nodes: readonly RankNode[],
  query: string,
  options?: { readonly now?: number; readonly router?: { readonly mustTags?: readonly string[]; readonly sources?: readonly string[] } },
): { readonly id: string; readonly node: RankNode; readonly score: number; readonly bm25: number; readonly tagBonus: number; readonly matched: readonly string[] }[];
