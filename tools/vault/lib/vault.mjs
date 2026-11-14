/**
 * Stage 1 — VAULT INTAKE.
 *
 * Walk the declared sources and turn a flat pile of markdown into nodes carrying the few
 * things retrieval actually needs: a title, tags, a short summary, a modified time, an
 * estimated size, and outbound links.
 *
 * The design constraint that drives everything downstream: a node's INDEX ENTRY must be
 * cheap enough that we can rank every node in the vault without opening any of them. So the
 * entry holds only what intake can extract once and cache — never the body.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";

const SKIP_DIR = new Set([".git", "node_modules", ".obsidian", ".trash", "dist", "build"]);

/**
 * Token estimate from character count.
 *
 * chars/4 is the usual rough proxy for English prose. It is an ESTIMATE and is labelled as
 * one everywhere it surfaces — the budget logic only needs a consistent ordering and a
 * within-2x magnitude, not accuracy. Counting real tokens would mean shipping a tokenizer
 * and re-running it on every file, which buys nothing here.
 */
const estimateTokens = (chars) => Math.ceil(chars / 4);

/** Recursively list markdown files under a root. */
async function walkDir(root, acc = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) await walkDir(join(root, e.name), acc);
    } else if ([".md", ".mdx", ".markdown"].includes(extname(e.name).toLowerCase())) {
      acc.push(join(root, e.name));
    }
  }
  return acc;
}

/**
 * Parse YAML-ish frontmatter.
 *
 * Deliberately NOT a YAML parser. Frontmatter here is flat scalars and short lists, and a
 * real parser would be a dependency plus a new failure mode for a format we control. What
 * this cannot parse it ignores, rather than throwing — an unreadable header must never cost
 * us the node.
 */
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const data = {};
  let currentKey = null;
  for (const line of raw.split("\n")) {
    const nested = /^\s+(\w[\w-]*):\s*(.*)$/.exec(line);
    const top = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (top) {
      currentKey = top[1];
      const v = top[2].trim();
      if (v) data[currentKey] = stripQuotes(v);
      else data[currentKey] = {};
    } else if (nested && currentKey && typeof data[currentKey] === "object") {
      data[currentKey][nested[1]] = stripQuotes(nested[2].trim());
    } else if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(stripQuotes(item[1].trim()));
    }
  }
  return { data, body };
}

const stripQuotes = (s) => s.replace(/^["']|["']$/g, "");

/** Wikilinks `[[target]]` and `[[target|alias]]`, plus relative markdown links. */
export function extractLinks(body) {
  const wiki = new Set();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    wiki.add(m[1].trim());
  }
  const md = new Set();
  for (const m of body.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
    md.add(m[1].trim());
  }
  return { wiki: [...wiki], md: [...md] };
}

/** ATX headings. Author-written structure, so a strong signal of what a note covers. */
export function extractHeadings(body) {
  const out = [];
  for (const m of body.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,4}\s+(.+)$/gm)) {
    out.push(m[1].replace(/[*_`[\]]/g, "").trim());
  }
  return out.slice(0, 40);
}

/** `#tag` inline plus frontmatter tags/type. Lowercased; a tag's case is not information. */
function extractTags(data, body) {
  const tags = new Set();
  const push = (v) => {
    if (typeof v === "string" && v.trim()) tags.add(v.trim().toLowerCase());
  };
  for (const key of ["tags", "type", "node_type"]) {
    const v = data[key];
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
  }
  if (data.metadata && typeof data.metadata === "object") {
    push(data.metadata.type);
    push(data.metadata.node_type);
  }
  // Inline #tags, but not markdown headings (`# `) and not inside fenced code.
  const noCode = body.replace(/```[\s\S]*?```/g, "");
  for (const m of noCode.matchAll(/(?:^|\s)#([a-z][a-z0-9/_-]{2,})/gi)) push(m[1]);
  return [...tags];
}

/**
 * First meaningful prose as the summary, capped.
 *
 * Prefers an explicit frontmatter `description`, because a human-written one-liner beats any
 * heuristic. Falls back to the first non-heading, non-quote paragraph.
 */
function deriveSummary(data, body, cap = 240) {
  if (typeof data.description === "string" && data.description.trim()) {
    return data.description.trim().slice(0, cap);
  }
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("```")) continue;
    return t.replace(/\s+/g, " ").replace(/[*_`[\]]/g, "").slice(0, cap);
  }
  return "";
}

/** Node id: `source:relative/path/without/extension`. Stable and human-readable. */
const nodeId = (source, root, path) =>
  `${source}:${relative(root, path).split(sep).join("/").replace(/\.(md|mdx|markdown)$/i, "")}`;

/**
 * Read one file into a node. Returns null when the file cannot be read — a vault with one
 * unreadable file must still index, and the caller reports the skip rather than dying.
 */
async function readNode(source, root, path) {
  let text, info;
  try {
    [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(text);
  const links = extractLinks(body);
  const title =
    (typeof data.name === "string" && data.name) ||
    (typeof data.title === "string" && data.title) ||
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ||
    basename(path).replace(/\.(md|mdx|markdown)$/i, "");

  return {
    id: nodeId(source, root, path),
    source,
    path,
    title: String(title).trim(),
    tags: extractTags(data, body),
    summary: deriveSummary(data, body),
    updated: info.mtimeMs,
    bytes: Buffer.byteLength(text, "utf8"),
    tokensEst: estimateTokens(text.length),
    headings: extractHeadings(body),
    wikiLinks: links.wiki,
    mdLinks: links.md,
    /**
     * Body text, TRANSIENT. Used once at build time to derive keyterms, then dropped before
     * the index is written — putting bodies in the index would defeat the entire point of
     * being able to rank without opening anything.
     */
    _body: body,
  };
}

/** Intake every declared source. Sources that do not exist are skipped, and reported. */
export async function intake(sources) {
  const nodes = [];
  const skipped = [];
  for (const { name, root } of sources) {
    const files = await walkDir(root);
    if (files.length === 0) {
      skipped.push({ name, root, reason: "no markdown found (missing or empty)" });
      continue;
    }
    for (const f of files) {
      const n = await readNode(name, root, f);
      if (n) nodes.push(n);
      else skipped.push({ name, root: f, reason: "unreadable" });
    }
  }
  return { nodes, skipped };
}


/**
 * Derive per-node KEYTERMS by tf-idf across the corpus.
 *
 * WHY THIS EXISTS: an index entry built only from a title, tags and a human summary is often
 * missing the exact term someone will search for. Measured here: "appid" occurs twice in the
 * body of the note that explains the appId decision and zero times in any index entry, so
 * index-only scoring could not find it at any budget.
 *
 * The fix keeps the query path free — extraction happens once at build time. Terms are ranked
 * by tf * idf so a word that is frequent HERE and rare ELSEWHERE wins, which is exactly the
 * "discriminating" property the entry was lacking. Capped so the entry stays one small line.
 *
 * Complexity: two passes over the corpus, O(total terms). Milliseconds at this scale.
 */
export function deriveKeyterms(nodes, { perNode = 24 } = {}) {
  const STOPISH = new Set(
    ("the and for that with this from have has are was were will not but you your they their " +
     "its it's into out about over under then than when what which who why how all any can " +
     "one two also more most other some such only own same very just don't should now")
      .split(" "),
  );
  const tokens = (t) =>
    String(t ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPISH.has(w));

  const tfs = nodes.map((n) => {
    const m = new Map();
    for (const w of tokens(n._body)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  });
  const df = new Map();
  for (const m of tfs) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const N = nodes.length || 1;

  nodes.forEach((n, i) => {
    const scored = [];
    for (const [w, f] of tfs[i]) {
      const d = df.get(w) ?? 1;
      if (d === N) continue; // in every document: carries no discriminating power
      scored.push([w, f * Math.log(1 + N / d)]);
    }
    scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    n.keyterms = scored.slice(0, perNode).map(([w]) => w);
    delete n._body; // never persisted
  });
  return nodes;
}
