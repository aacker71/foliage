/**
 * Stages 2–3 — ROUTER and INDEX SCORING.
 *
 * The whole point: rank every node in the vault WITHOUT OPENING ANY OF THEM. Scoring runs
 * over index entries only — title, tags, summary, path — which intake already extracted. No
 * model call, no file read. Retrieval becomes logic that happens before the model is asked
 * anything.
 *
 * ALGORITHM — Okapi BM25 over index entries, then two multiplicative adjustments.
 *
 * Why BM25 rather than raw term overlap: overlap rewards long entries for being long, and
 * rewards a common word as much as a rare one. BM25 fixes both — IDF discounts terms that
 * appear everywhere, and the k1/b saturation stops a single repeated term from dominating.
 * It is also ~30 lines and needs no training, no embedding model, and no network, which
 * matters because this must run in-process on every agent turn.
 *
 * Why not embeddings: they would be better at synonyms and worse at everything else here —
 * a dependency, a model call, a cache to invalidate, and non-determinism in a component
 * whose value is being predictable. The vault is ~100 nodes with human-written summaries;
 * lexical matching on curated one-liners is close to the ceiling. If recall ever becomes the
 * binding constraint, add embeddings as a SECOND ranker over BM25's top ~30, not as a
 * replacement.
 *
 * Complexity: O(query terms × postings). On a vault this size it is microseconds.
 */

const STOP = new Set(
  ("a an and are as at be but by for from has have how i if in into is it its of on or that " +
    "the their then there these this to was were what when where which who why will with you your")
    .split(" "),
);

/** Normalize and split on Unicode words, retaining combining marks and dropping 1-character noise. */
export function tokenize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => [...t].length > 1 && !STOP.has(t));
}

/**
 * The searchable text of an index entry, with fields WEIGHTED BY REPETITION.
 *
 * Repeating a field is the standard trick for field weighting inside a single BM25 index: it
 * raises that field's term frequency without needing a multi-field scorer. Title counts
 * triple and tags double because a curated title or tag is a much stronger signal of what a
 * note is about than a phrase buried in its summary.
 */
export function entryText(node) {
  const pathWords = node.id.replace(/[:/._-]+/g, " ");
  return [
    node.title,
    node.title,
    node.title,
    node.tags.join(" "),
    node.tags.join(" "),
    // Headings are author-written structure — weighted like tags.
    (node.headings ?? []).join(" "),
    (node.headings ?? []).join(" "),
    node.summary,
    // Keyterms: tf-idf terms from the body, extracted at BUILD time. These carry the
    // discriminating vocabulary a curated summary usually omits.
    (node.keyterms ?? []).join(" "),
    pathWords,
  ].join(" ");
}

/** Build the inverted index. Done once per vault build, reused by every query. */
export function buildIndex(nodes) {
  const docs = nodes.map((n) => {
    const terms = tokenize(entryText(n));
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: n.id, tf, len: terms.length };
  });

  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  // Tag rarity, so a shared tag's informativeness can be weighed later. Sharing `project`
  // with 40 other notes says nothing; sharing `fcra` says a great deal.
  const tagDf = new Map();
  for (const n of nodes) for (const tag of n.tags) tagDf.set(tag, (tagDf.get(tag) ?? 0) + 1);

  const avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  return { docs, df, tagDf, avgLen, n: docs.length };
}

/** Inverse document frequency, BM25's probabilistic form with the +1 guard. */
const idf = (index, term) => {
  const d = index.df.get(term) ?? 0;
  return Math.log(1 + (index.n - d + 0.5) / (d + 0.5));
};

/** Tag rarity in [0,1]: 1 when a tag is unique, →0 as it approaches universal. */
export const tagWeight = (index, tag) => {
  const d = index.tagDf.get(tag) ?? 0;
  if (d <= 0) return 0;
  return Math.log(1 + index.n / d) / Math.log(1 + index.n);
};

const K1 = 1.4;
const B = 0.72;

/**
 * Recency multiplier with a half-life.
 *
 * Multiplicative rather than additive on purpose: recency should AMPLIFY a relevant node,
 * never promote an irrelevant fresh one. An additive bonus makes today's shopping list beat
 * last month's architecture decision on an architecture question.
 *
 * Floor of 0.6 so old-but-canonical notes stay reachable — in this vault the most important
 * documents are often the oldest.
 */
export function recencyBoost(updatedMs, nowMs, halfLifeDays = 45) {
  const days = Math.max(0, (nowMs - updatedMs) / 86_400_000);
  return 0.6 + 0.4 * Math.pow(0.5, days / halfLifeDays);
}

/**
 * Score every node against a query. Returns descending order.
 *
 * `now` is injected rather than read from the clock so scoring is a pure function and its
 * tests cannot flake.
 */
export function score(index, nodes, query, { now, router } = {}) {
  const nowMs = now ?? 0;
  const qTerms = tokenize(query);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wantTags = new Set((router?.mustTags ?? []).map((t) => t.toLowerCase()));
  const scopes = router?.sources ?? null;

  const out = [];
  for (const d of index.docs) {
    const node = byId.get(d.id);
    if (!node) continue;
    if (scopes && !scopes.includes(node.source)) continue;

    let bm = 0;
    const matched = [];
    for (const t of qTerms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const denom = f + K1 * (1 - B + (B * d.len) / (index.avgLen || 1));
      bm += idf(index, t) * ((f * (K1 + 1)) / denom);
      matched.push(t);
    }
    if (bm === 0 && wantTags.size === 0) continue;

    // Router tag requirement is a strong, rarity-weighted boost rather than a hard filter:
    // a hard filter silently hides the one note that would have answered the question.
    let tagBonus = 0;
    for (const tag of node.tags) {
      if (wantTags.has(tag)) tagBonus += 2.0 * tagWeight(index, tag);
    }

    const base = bm + tagBonus;
    if (base <= 0) continue;
    out.push({
      id: d.id,
      node,
      score: base * recencyBoost(node.updated, nowMs),
      bm25: bm,
      tagBonus,
      matched,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
