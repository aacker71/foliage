/**
 * Resolving a ledger row to the FILES it is a claim about.
 *
 * This is the hard part of the staleness check, and getting it wrong in either direction is
 * expensive: too narrow and the gate misses rot; too wide and it flags rows that are fine,
 * which is the failure mode that gets a gate deleted.
 *
 * THE RULE: a scope is only accepted if it can be pointed at on disk.
 *
 *   - `@foliage/leaf`  → the workspace package's directory, from the package.json name map.
 *   - `apps/leaf`      → a path, because it exists.
 *   - `canopy-crown.js`→ a bare filename, ONLY when exactly one tracked file has that
 *                        basename. Two matches is ambiguity, and ambiguity resolves to
 *                        nothing rather than to a guess.
 *   - `Tree`, `%G?`, `--fol-text-faint`, `gemma4:12b` → rejected. They are backticked, but
 *                        they are not paths, and a token that does not resolve is dropped.
 *
 * CONFIDENCE IS PART OF THE ANSWER, not an afterthought:
 *
 *   named     the scope came from the CAPABILITY column — the row's own statement of its
 *             subject. This is the row saying what it is about.
 *   inferred  the scope came from the EVIDENCE prose. Evidence cells in this ledger are long
 *             and mention paths incidentally (a `.gitignore` line, a screenshot's selector),
 *             so a path found here is a weaker signal about what the row covers.
 *   unmapped  nothing resolved. Reported as UNMAPPED — never as passing. A row that cannot be
 *             mechanically located is a row this gate did not check, and saying so is the
 *             whole difference between a gate and a no-op.
 *
 * Inferred scopes can only ever raise a WARNING, never a failure. That asymmetry is what
 * keeps the heuristic honest: if the guess is wrong, it costs a human ten seconds of reading,
 * not a red build.
 */

/** Extensions a path token may carry. Anything else is prose that happens to contain a dot. */
const PATH_EXT = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "json", "css", "html", "svg", "md", "yaml", "yml", "woff2", "jsonl",
]);

/**
 * Everything inside single backticks, with commands split into their words.
 *
 * The ledger backticks whole commands — `node apps/leaf/intake.mjs --repo <path>` — and the
 * path inside one is exactly the code the row is about. Not splitting cost a real miss: C5's
 * scope resolved to `public-boundary.json`, mentioned in passing, while the producer the row
 * is actually about sat unseen inside its own command.
 */
export function backtickedTokens(cell) {
  const out = [];
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const span = m[1].trim();
    out.push(span);
    if (/\s/.test(span)) out.push(...span.split(/\s+/));
  }
  return out;
}

/**
 * Normalise a backticked token into a candidate path, or null.
 *
 * Handles the shapes this ledger actually uses: a trailing `:123` line reference, a trailing
 * glob segment, a quoted path inside a command. Rejects anything with whitespace (a command,
 * not a path) and anything whose only dot starts the name (a dotfile like `.gitignore`, which
 * is real but is never what a capability row is about).
 */
export function candidatePath(token) {
  let t = token.replace(/^["']|["']$/g, "").trim();
  if (!t || /\s/.test(t)) return null;
  t = t.replace(/:\d+(,\d+)*$/, ""); // `file.html:479,488`
  t = t.replace(/\/[^/]*\*[^/]*$/, ""); // `tools/vault/lib/*.test.mjs` → `tools/vault/lib`
  t = t.replace(/\/+$/, "");
  if (!t || t.startsWith("/") || t.includes("..")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t)) return null;
  if (t.includes("/")) return t;
  const dot = t.lastIndexOf(".");
  if (dot <= 0) return null;
  return PATH_EXT.has(t.slice(dot + 1).toLowerCase()) ? t : null;
}

/**
 * Resolve one cell's backticked tokens to scope paths.
 *
 * `tree` supplies the only three facts needed, injected so this stays pure and testable:
 *   packageDir(name)  workspace package name → repo-relative directory, or null
 *   exists(path)      the path is present in the tree AND not gitignored
 *   byBasename(name)  tracked files with this basename (ambiguity is rejected by the caller)
 */
export function resolveCell(cell, tree) {
  const found = new Set();
  for (const token of backtickedTokens(cell)) {
    const dir = tree.packageDir(token);
    if (dir) {
      found.add(dir);
      continue;
    }
    const cand = candidatePath(token);
    if (!cand) continue;
    if (tree.exists(cand)) {
      found.add(cand);
      continue;
    }
    if (!cand.includes("/")) {
      const matches = tree.byBasename(cand);
      if (matches.length === 1) found.add(matches[0]);
    }
  }
  return [...found].sort();
}

/**
 * Capability column first, evidence prose only as a fallback. See the header for why the
 * distinction is load-bearing rather than cosmetic.
 */
export function resolveScope(row, tree) {
  const named = resolveCell(row.capability, tree);
  if (named.length) return { confidence: "named", paths: named };
  const inferred = resolveCell(row.evidence, tree);
  if (inferred.length) return { confidence: "inferred", paths: inferred };
  return { confidence: "unmapped", paths: [] };
}
