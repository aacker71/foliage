/**
 * THE BRAIN OFFLINE GATE'S PROOFS FOR BUILD ORDER ITEMS 3, 5 AND 6 (unit 38; spec PR #201). They
 * used to be a focused test (`apps/leaf/src/localBrainOffline.focus.ts`) that nobody had to run;
 * here they are phases of `scripts/check-brain-offline.mjs`, which `pnpm check` runs, under the
 * gate's own sandbox and observer (`offline-gate.mjs`): every Foliage and gbrain process is a step
 * that must end as expected, may start only what its command needs, and is watched for any network
 * attempt or write under the owner's brain. Each phase has its own garden, under the run's planted
 * environment. Every record below is SYNTHETIC and labelled so.
 *
 * Item 3 (search, refresh and removal) proves: `foliage brain search` returns every hit Foliage's
 * own search returns over the same records, with gbrain's order first, though gbrain alone returns
 * fewer; a promoted leaflet and a draft resting on notes about someone else have no page and no byte
 * in the brain; each structure marker stays inert; a removal leaves nothing in `get_page` with
 * `include_deleted` or in `get_versions`; a newly excluded leaflet rebuilds the brain and its old
 * body is in no version and no byte (control: an edit in place does keep the old bytes); so does a
 * leaflet a killed refresh had imported and that is then excluded or found to rest on a note about
 * someone else, and a record put back byte for byte after such a kill is never taken for current; a
 * refresh killed before each of its steps, and a rebuild killed before each of its steps, converges
 * on the next refresh; and `foliage brain remove` leaves the record and no brain.
 *
 * Item 5 (keeping the brain current) proves, with the real launcher: after each real action the
 * brain catches up with the record with no `foliage brain` command run, and the record's bytes are
 * exactly what the action left. The actions: `foliage grow`, `review --resume`, `share`, `unshare`,
 * `migrate-queue --apply`, `integrations import`; inside `foliage up` (macOS only, below) its first
 * collection pass, a review decision, a promotion and a hand edit of leaf.json that nothing announces
 * (the 30-second check); and an MCP-only session, where a read-only tool changes nothing and two
 * write tools each leave the brain current. A refresh that fails never fails the action, and
 * `foliage status` names the cause until the record is fixed; `foliage brain search` behind its
 * record starts an in-place refresh, returning current-record results while it finishes if the
 * search's wait bound expires; a change that needs a rebuild is never started by a search.
 * Limits: `migrate-queue --apply`'s landing runs outside the sandbox (its backups publish with
 * link(2), which the macOS profile kills), and `capture` (it needs Chrome) is not run.
 *
 * Item 6 (`foliage search` and `foliage_search`) proves, in keyword mode (owner decision 3,
 * 2026-10-12): on one record holding the shapes today's search and MCP tests use, every answer of
 * both surfaces is Foliage's own and says keyword mode is why, the same with no brain and with a
 * current one, and neither surface starts a gbrain process (the sandbox would kill the staged bun)
 * or changes a byte under `brain/`. `foliage brain search` still reads the brain, and its answers
 * keep every hit Foliage's own holds, built the same way. No answer of any of them holds a gbrain
 * field, match label or page address, a path, an excluded body, or anything resting on a note about
 * someone else; today's search assertions (`excludedSearch.test.ts`, `assistantMcp.test.ts`) hold on
 * both; a tier never moves a hit; the revision-bound brain tools, `private-brain list` and a signed
 * private-brain session (macOS only, below) answer the same with the brain on as off; identity
 * checks hold with the brain on; latency with the brain off and on is reported.
 *
 * MACOS ONLY: `foliage up` and the private-brain session are servers the gate reaches on loopback.
 * On Linux each step runs in an empty network namespace whose loopback is down and out of the gate's
 * reach, so those steps are not run there, and the gate says so.
 */
import { generateKeyPairSync, randomBytes, sign, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { brainBehind } from "../../apps/leaf/src/brainUpkeep.ts";
import { BRAIN_STEPS } from "../../apps/leaf/src/localBrain.ts";
import { readLocalSearchRecords } from "../../apps/leaf/src/localSearch.ts";
import { privateBrainSigningInput } from "../../apps/leaf/src/privateBrainSession.ts";

/**
 * @typedef {import("./offline-gate.mjs").GateContext} GateContext
 * @typedef {import("./offline-gate.mjs").GardenSteps} GardenSteps
 * @typedef {import("./offline-gate.mjs").Allow} Allow
 * @typedef {{ id: string, kind: string, title: string, snippet: string, citation: string, reason?: string, evidence?: { ref: string }[] }} Hit
 * @typedef {{ subject: { leafId: string, name: string }, retrieval: string, because?: string, hits: Hit[] }} Answer
 * @typedef {{ pages: Record<string, { record: string, digest: string, excluded?: true }> }} Manifest
 */

const AT = "2026-10-10T00:00:00Z";
/** SYNTHETIC provenance: the owner's own commit, and a note about another person. */
export const OWN = Object.freeze({ source: "git", ref: "0000000000000000000000000000000000000001", observedAt: AT });
export const OTHER = Object.freeze({ source: "brain-note:third-party", ref: "people/synthetic-person.md", observedAt: AT });
/** Why a garden's `foliage search` and `foliage_search` answered without the brain (owner decision 3). */
export const KEYWORD_MODE = "Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain";
/**
 * What no search answer may hold: gbrain's own result fields, its match labels and its page
 * addresses (spec, Reading step 5).
 */
export const FORBIDDEN = /"(?:score|base_score|page_id|chunk_id|source_id|effective_date|stale|create_safety|title_match_boost|alias_hit|slug|chunk_text|compiled_truth)"|exact_title_match|high_vector_match|keyword_exact|weak_semantic|foliage\/[0-9a-f]{64}/;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
export function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** @param {string} path */
const exists = (path) => lstat(path).then(() => true, () => false);

/** Names and bytes of every file under a directory, as one digest. @param {string} root */
export async function treeDigest(root) {
  const hash = createHash("sha256");
  /** @param {string} dir */
  const walk = async (dir) => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      if ((await lstat(path)).isDirectory()) await walk(path);
      else hash.update(`${path}\0`).update(await readFile(path));
    }
  };
  await walk(root);
  return hash.digest("hex");
}

/**
 * Whether any file under a directory holds this word, as written or lower-cased (the form a search
 * index keeps): the database's files, its WAL, gbrain's home and the pages.
 * @param {string} root @param {string} word
 */
export async function holdsBytes(root, word) {
  const needles = [Buffer.from(word), Buffer.from(word.toLowerCase())];
  /** @param {string} dir @returns {Promise<boolean>} */
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() ? await walk(path) : entry.isFile() && await readFile(path).then(bytes => needles.some(needle => bytes.includes(needle)))) return true;
    }
    return false;
  };
  return walk(root);
}

/**
 * `foliage search`, the real launcher, which may start no gbrain process: its answer must be
 * Foliage's own, saying keyword mode is why.
 * @param {Pick<GardenSteps, "foliage">} g @param {string} step @param {string} query @param {number} limit
 * @returns {Promise<{ answer: Answer, text: string, ms: number }>}
 */
async function ownSearch(g, step, query, limit) {
  const started = performance.now();
  const ran = await g.foliage(step, ["search", query, "--limit", String(limit)], { allow: { gbrain: false } });
  const ms = performance.now() - started;
  /** @type {Answer} */
  const answer = JSON.parse(ran.stdout);
  ensure(answer.retrieval === "foliage keyword" && answer.because === KEYWORD_MODE, `${step}: ${answer.retrieval} (${answer.because ?? "no reason"})`);
  return { answer, text: ran.stdout, ms };
}

/**
 * `foliage brain search`, the surface that reads the brain.
 * @param {Pick<GardenSteps, "brain">} g @param {string} step @param {string} query @param {number} [limit]
 * @returns {Promise<{ answer: Answer, text: string, ms: number }>}
 */
async function brainSearch(g, step, query, limit = 8) {
  const started = performance.now();
  const ran = await g.brain(step, ["search", query, "--limit", String(limit)]);
  return { answer: JSON.parse(ran.stdout), text: ran.stdout, ms: performance.now() - started };
}

/**
 * A search may answer before its detached refresh. Prove the answer uses the live record,
 * then observe that same refresh finishing without issuing a refresh command. The follow-up
 * must read the current brain; accepting a fallback alone would hide a broken refresh.
 * All three callers require an in-place update: the database identity must survive and
 * the final read must leave no writer lock behind.
 * @param {Pick<GardenSteps, "garden" | "paths" | "brain" | "foliage">} g
 * @param {string} step @param {string} query @param {number} [limit]
 */
export async function refreshedBrainSearch(g, step, query, limit = 8) {
  const started = performance.now();
  const record = () => Promise.all([readFile(join(g.garden, "leaf.json")),
    readFile(join(g.garden, "harvest.json")).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    })]);
  const before = await record();
  const database = (await stat(g.paths.database)).ino;
  const first = await brainSearch(g, step, query, limit);
  const immediate = first.answer.retrieval === "brain keyword" && first.answer.because === undefined;
  const background = first.answer.retrieval === "foliage keyword" && first.answer.because === "Brain: behind your record, refreshing";
  ensure((immediate || background) && first.answer.hits.length > 0,
    `${step}: unexpected answer while refreshing: ${first.text}`);
  if (background) {
    const own = await ownSearch(g, `${step}: current-record fallback`, query, limit);
    ensure(same([first.answer.subject, first.answer.hits], [own.answer.subject, own.answer.hits]),
      `${step}: the fallback did not answer from the current record`);
  }
  ensure(sameBytes(await record(), before), `${step}: a record byte changed during the search`);
  // Use the same completion bound as item 5's action-triggered refresh proof. No product
  // deadline changes and no refresh retry: only observe the original detached writer.
  const waiting = performance.now();
  while (await exists(g.paths.lock) || await brainBehind(g.garden)) {
    ensure(!(await exists(g.paths.refreshFailure)), `${step}: the background refresh stopped`);
    ensure(performance.now() - waiting < 180_000, `${step}: the brain never caught up with the record`);
    await sleep(100);
  }
  // brainBehind deliberately returns false for unavailable/refused brains as well as current
  // ones. Prove current positively before another search could repair a stale manifest.
  const manifestBytes = await readFile(g.paths.manifest);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const hashes = before.map(bytes => bytes === null ? null : createHash("sha256").update(bytes).digest("hex"));
  ensure(same([manifest.leafSha256, manifest.harvestSha256], hashes), `${step}: the manifest does not match the record`);
  ensure(!(await exists(g.paths.refreshFailure)), `${step}: the background refresh stopped`);
  const result = background ? await brainSearch(g, `${step}: after the original refresh`, query, limit) : first;
  ensure(result.answer.retrieval === "brain keyword" && result.answer.because === undefined && result.answer.hits.length > 0,
    `${step}: the follow-up did not read the current brain: ${result.text}`);
  ensure((await readFile(g.paths.manifest)).equals(manifestBytes), `${step}: the follow-up changed the manifest`);
  ensure(sameBytes(await record(), before), `${step}: a record byte changed during the refresh`);
  ensure(!(await brainBehind(g.garden)) && !(await exists(g.paths.lock)), `${step}: the detached refresh did not finish and let go of the lock`);
  ensure((await stat(g.paths.database)).ino === database, `${step}: the search's refresh rebuilt the brain instead of updating it in place`);
  return { ...result, ms: performance.now() - started };
}

/**
 * An MCP session through the real launcher, as a sandboxed step, with a minimal client over its
 * standard input and output: newline-delimited JSON-RPC 2.0, as the stdio transport speaks it. The
 * SDK's own client starts its own process, outside the gate's sandbox, so it is not used here.
 * `more` gives the session another environment or one loopback port (item 8's stand-in embedder).
 * @param {GateContext} ctx @param {GardenSteps} g @param {string} step @param {readonly string[]} args @param {Allow} [allow]
 * @param {{ env?: Record<string, string>, loopback?: number }} [more]
 */
export async function mcpSession(ctx, g, step, args, allow, more = {}) {
  const { child, settled } = g.running(step, ctx.programs.node, [join(ctx.root, "foliage.mjs"), ...args, "--garden", g.garden],
    { stdin: true, ...(allow === undefined ? {} : { allow }), ...more });
  let buffer = "", next = 0, errors = "";
  /** @type {Map<number, (message: any) => void>} */
  const waiting = new Map();
  child.stderr?.on("data", chunk => { errors += String(chunk); });
  child.stdout?.on("data", chunk => {
    buffer += String(chunk);
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      // Only a response answers a request: no `method`, and a `result` or an `error`. A request or
      // notification from the server is never taken for one, even with a colliding id.
      if (message === null || typeof message !== "object" || "method" in message || !("result" in message || "error" in message)) continue;
      const answer = waiting.get(message.id);
      if (answer) { waiting.delete(message.id); answer(message); }
    }
  });
  child.once("exit", () => {
    for (const answer of waiting.values()) answer({ error: { message: "the server ended" } });
    waiting.clear();
  });
  /** @param {string} method @param {unknown} params @returns {Promise<any>} */
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`[${step}] ${method} had no answer within 60 s\n${errors}`)); }, 60_000);
    waiting.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`[${step}] ${method}: ${JSON.stringify(message.error)}\n${errors}`));
      else resolve(message.result);
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "foliage-brain-gate", version: "1.0.0" } });
  child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    /** @param {string} name @param {Record<string, unknown>} args @returns {Promise<{ isError?: boolean, structuredContent?: any }>} */
    call: (name, args) => request("tools/call", { name, arguments: args }),
    /** Its end of input closes the server, which must then exit 0. */
    async close() { child.stdin?.end(); await settled; },
  };
}

/** A loopback port from 4210 up that nothing listens on (4173–4199 belong to long-running servers). */
async function freePort() {
  for (let port = 4210 + Math.floor(Math.random() * 400); port < 4999; port++) {
    const free = await new Promise(resolve => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("no free port from 4210");
}

/** Middle value and range of a set of timings, in ms. @param {readonly number[]} values */
const spread = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return `median ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? NaN)} ms (min ${Math.round(sorted[0] ?? NaN)}, max ${Math.round(sorted.at(-1) ?? NaN)}, n=${sorted.length})`;
};

/* ---- item 3 ------------------------------------------------------------------------------------ */

/** SYNTHETIC: one structure marker per leaflet, each guarding a word only that leaflet holds. */
const MARKERS = Object.freeze({
  timelinecomment: "Synthetic words before.\n<!-- timeline -->\nAftertimelinecomment words.",
  timelinetight: "Synthetic words before.\n<!--timeline-->\nAftertimelinetight words.",
  decorated: "Synthetic words before.\n--- timeline ---\nAfterdecorated words.",
  rulehistory: "Synthetic words before.\n---\n## History\nAfterrulehistory words.",
  ruletimeline: "Synthetic words before.\n---\n\n## Timeline\nAfterruletimeline words.",
  factsfence: "Synthetic words before.\n<!--- gbrain:facts:begin -->\nInsidefactsfence words.\n<!--- gbrain:facts:end -->\nSynthetic words after.",
  takesfence: "Synthetic words before.\n<!--- gbrain:takes:begin -->\nInsidetakesfence words.\n<!--- gbrain:takes:end -->\nSynthetic words after.",
});
/** The word each marker guards. */
const GUARDED = Object.freeze({
  timelinecomment: "Aftertimelinecomment", timelinetight: "Aftertimelinetight", decorated: "Afterdecorated", rulehistory: "Afterrulehistory",
  ruletimeline: "Afterruletimeline", factsfence: "Insidefactsfence", takesfence: "Insidetakesfence",
});
/** Leaflets the convergence rounds exclude one by one, each so a rebuild has a reason to run. */
const EXCLUDABLE = 12;
/** The word only excludable leaflet `index` holds; no one is a prefix of another, so a byte search finds only its own. @param {number} index */
const xMarker = (index) => `Xbodymarker${index}end`;

/**
 * @param {string} id @param {string} title @param {string} text @param {string} [tier]
 */
const ownLeaflet = (id, title, text, tier = "verified") => ({ id, title, tier, provenance: OWN, body: [{ provenance: OWN, text }] });

/**
 * The SYNTHETIC leaf.json for item 3; `round` changes it for one round.
 * @param {{ readonly edit?: number, readonly excluded?: number, readonly kept?: string, readonly extra?: readonly object[] }} [round]
 */
function itemThreeLeaf(round = {}) {
  return {
    id: "synthetic-item-three", subject: "Synthetic item three fixture", headline: "Synthetic headline for the item three test",
    leaflets: [
      // Ten matching records for "quillwort": eight leaflets, a claim and its past version.
      ...Array.from({ length: 8 }, (_, index) => ownLeaflet(`q${index}`, `Synthetic leaflet ${index}`, `Synthetic quillwort notes, number ${index}.`, index % 2 ? "verified" : "pending")),
      // Promoted from a note about someone else: held back.
      { id: "promoted", title: "Synthetic promoted leaflet", tier: "pending", provenance: OTHER, body: [{ provenance: OTHER, text: "Promotedmarker notes about someone else." }] },
      ...Object.entries(MARKERS).map(([id, text]) => ownLeaflet(`marker-${id}`, `Synthetic ${id} leaflet`, text)),
      // An ordinary leaflet the rounds edit in place.
      ownLeaflet("edited", "Synthetic edited leaflet", round.kept ?? `Synthetic edited text, version ${round.edit ?? 0}.`),
      ...Array.from({ length: EXCLUDABLE }, (_, index) => index < (round.excluded ?? 0)
        ? { id: `x${index}`, title: `Synthetic excludable leaflet ${index}`, tier: "excluded", reason: `Synthetic: number ${index} was somebody else's work.`, provenance: OWN,
          body: [{ provenance: OWN, text: `${xMarker(index)} words.` }] }
        : ownLeaflet(`x${index}`, `Synthetic excludable leaflet ${index}`, `${xMarker(index)} words.`)),
      ...(round.extra ?? []),
    ],
    achievements: [{ id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by kayak." }] }],
    journeyHistory: [{ id: "edit-1", at: AT, actor: "manual", achievement: "a1",
      before: { id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by canoe." }] },
      after: { id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by kayak." }] } }],
  };
}

/**
 * The SYNTHETIC harvest.json for item 3: the owner's own drafts named in `drafts`, and one on a note about someone else.
 * @param {readonly { readonly id: string, readonly excerpt: string }[]} drafts
 */
function itemThreeHarvest(drafts) {
  return { leafId: "synthetic-item-three", subject: "Synthetic item three fixture", candidates: [
    ...drafts.map(draft => ({ id: `brain-note:${draft.id}`, title: `Synthetic draft ${draft.id}`, extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ source: "brain-note", ref: `notes/${draft.id}.md`, observedAt: AT, excerpt: draft.excerpt }] })),
    { id: "brain-note:theirs", title: "Synthetic draft on a note about someone else", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ ...OTHER, excerpt: "Theirdraftmarker words." }] },
  ] };
}

/**
 * BUILD ORDER ITEM 3: search, refresh and removal, through `foliage brain search|refresh|remove`.
 * Checks read the brain with gbrain's own read ops, as the spawn function builds them.
 * @param {GateContext} ctx
 */
export async function itemThree(ctx) {
  const g = await ctx.garden("item 3");
  const { garden, paths } = g;
  const leafFile = join(garden, "leaf.json"), harvestFile = join(garden, "harvest.json");
  const label = (/** @type {string} */ text) => `item 3: ${text}`;
  /** @param {object} leaf @param {readonly { id: string, excerpt: string }[]} drafts */
  const record = async (leaf, drafts) => {
    await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
    await writeFile(harvestFile, `${JSON.stringify(itemThreeHarvest(drafts), null, 2)}\n`);
  };
  /** @param {string} text @param {string} op @param {Record<string, unknown>} params @returns {Promise<any>} */
  const json = async (text, op, params) => JSON.parse((await g.call(label(text), op, params)).stdout);
  /** @returns {Promise<Manifest>} */
  const manifest = async () => JSON.parse(await readFile(paths.manifest, "utf8"));
  /** @param {string} id */
  const slugOf = async (id) => Object.entries((await manifest()).pages).find(([, page]) => page.record === id)?.[0];
  /** @param {string} id */
  const slugFor = async (id) => {
    const slug = await slugOf(id);
    ensure(slug !== undefined, `${id} has no page`);
    return slug;
  };
  /** `foliage brain <args>`, whose one line must be `line`. @param {string} text @param {string[]} args */
  const brain = async (text, args, line = "Brain: current\n") => {
    const ran = await g.brain(label(text), args);
    ensure(ran.stdout === line, `[${label(text)}] printed ${JSON.stringify(ran.stdout)}, not ${JSON.stringify(line)}\n${ran.stderr}`);
  };
  /** The brain was rebuilt and swapped in by this refresh. @param {string} text */
  const rebuiltBy = async (text) => {
    const before = (await stat(paths.database)).ino;
    await brain(text, ["refresh"]);
    ensure((await stat(paths.database)).ino !== before, `${label(text)}: the brain was not rebuilt and swapped in`);
  };
  /** A slug gbrain has no trace of. @param {string} text @param {string} slug */
  const gone = async (text, slug) => {
    const page = await g.call(label(`${text}: get_page with include_deleted`), "get_page", { slug, include_deleted: true }, { expect: { code: 1 } });
    ensure(/Page not found: /.test(page.stderr), `${label(text)}: get_page still finds the page: ${page.stdout}`);
    ensure(same(await json(`${text}: get_versions`, "get_versions", { slug }), []), `${label(text)}: the page still has versions`);
  };
  /** The brain holds exactly the manifest's pages, and nothing a killed run left. @param {string} text */
  const converged = async (text) => {
    const built = await manifest();
    /** @type {{ slug: string, deleted_at?: string }[]} */
    const listed = await json(`${text}: list_pages with include_deleted`, "list_pages", { limit: 1000, sort: "slug", include_deleted: true });
    ensure(same(listed.map(row => row.slug).sort(), Object.keys(built.pages).sort()), `${label(text)}: list_pages does not hold exactly the manifest's pages`);
    ensure(listed.every(row => !row.deleted_at), `${label(text)}: a soft-deleted page is left`);
    ensure(same((await readdir(join(paths.pages, "foliage"))).sort(), Object.keys(built.pages).map(slug => `${slug.slice("foliage/".length)}.md`).sort()),
      `${label(text)}: the page files and the manifest differ`);
    for (const path of [paths.next, paths.old, paths.lock, paths.refused]) ensure(!(await exists(path)), `${label(text)}: ${path} was left behind`);
  };
  /** @param {string} text @param {string} slug */
  const noVersions = async (text, slug) => ensure(same(await json(`${text}: get_versions`, "get_versions", { slug }), []), `${label(text)}: the page has past versions`);
  /**
   * A refresh in its own Foliage process, SIGKILLed as it reaches `step`.
   * @param {string} step
   */
  const killedAt = async (step) => {
    const script = `const { refreshBrain } = await import(${JSON.stringify(join(ctx.root, "apps", "leaf", "src", "localBrain.ts"))});
      await refreshBrain({ garden: ${JSON.stringify(garden)}, vendor: ${JSON.stringify(join(ctx.root, "vendor"))} }, { observe: step => { if (step === ${JSON.stringify(step)}) process.kill(process.pid, "SIGKILL"); } });
      process.stdout.write("finished without reaching the step\\n");`;
    await g.node(label(`a refresh killed before ${step}`), ["--input-type=module", "-e", script], { expect: { signal: "SIGKILL" } });
  };
  /** @param {string} id @param {string} word @param {{ source: string, ref: string, observedAt: string }} provenance @param {string} [tier] */
  const leafletOf = (id, word, provenance, tier = "pending") => ({ id, title: `Synthetic ${id} leaflet`, tier, provenance,
    ...(tier === "excluded" ? { reason: `Synthetic: ${id} was somebody else's work.` } : {}), body: [{ provenance, text: `${word} words.` }] });

  await record(itemThreeLeaf(), [{ id: "own", excerpt: "Synthetic draft text, Draftmarker version one." }]);
  await brain("first build", ["build"]);
  ctx.say(`      the brain holds ${Object.keys((await manifest()).pages).length} pages`);
  await brain("refresh of a current brain", ["refresh"]);

  // 1. RECALL. Ten records match "quillwort", among them a claim and its past version one word apart.
  const own = await ownSearch(g, label("foliage search quillwort (Foliage's own)"), "quillwort", 10);
  const todayIds = own.answer.hits.map(hit => hit.id);
  ensure(todayIds.length === 10 && todayIds.includes("claim:a1:c1") && todayIds.includes("history:edit-1"), `Foliage's own search found ${todayIds.join(", ")}`);
  /** @type {{ slug: string }[]} */
  const alone = await json("gbrain alone: search quillwort", "search", { query: "quillwort", limit: 30, mode: "conservative" });
  const aloneSlugs = [...new Set(alone.map(row => row.slug))];
  ctx.say(`      gbrain alone returned ${aloneSlugs.length} of the 10 matching pages (it deduplicates)`);
  ensure(aloneSlugs.length < todayIds.length, "gbrain alone did not return fewer than Foliage's own search, so the merge was not exercised");
  const through = await brainSearch(g, label("foliage brain search quillwort"), "quillwort", 10);
  ensure(through.answer.retrieval === "brain keyword", `foliage brain search did not read the brain: ${through.answer.because}`);
  for (const id of todayIds) ensure(through.answer.hits.some(hit => hit.id === id), `${id}, which Foliage's own search returns, is missing from the brain's answer`);
  const built = await manifest();
  ensure(same(through.answer.hits.slice(0, aloneSlugs.length).map(hit => hit.id), aloneSlugs.map(slug => built.pages[slug]?.record)), "gbrain's order does not come first");
  ensure(same(["claim:a1:c1", "history:edit-1"].map(id => through.answer.hits.find(hit => hit.id === id)?.kind), ["achievement learning", "past version"]),
    "the claim and its past version are not both labelled");
  ensure(!FORBIDDEN.test(through.text) && !through.text.includes(garden), "a gbrain field, page address or garden path reached the brain's answer");

  // 2. THIRD-PARTY. The promoted leaflet and the draft on someone else's note have no page and no
  // byte in the brain, and no search returns them.
  for (const id of ["leaflet:promoted", "draft:brain-note:theirs"]) ensure(await slugOf(id) === undefined, `${id} has a page`);
  for (const word of ["Promotedmarker", "Theirdraftmarker"]) {
    ensure(!(await holdsBytes(paths.brain, word)), `${word} entered the brain`);
    ensure(same(await json(`gbrain alone: search ${word}`, "search", { query: word, limit: 10 }), []), `gbrain finds ${word}`);
  }
  const promoted = await brainSearch(g, label("foliage brain search Promotedmarker"), "Promotedmarker");
  ensure(promoted.answer.retrieval === "brain keyword" && promoted.answer.hits.length === 0, "the brain's answer holds the promoted leaflet");
  ensure((await ownSearch(g, label("foliage search Promotedmarker"), "Promotedmarker", 8)).answer.hits.length === 0, "Foliage's own answer holds the promoted leaflet");
  // Control: the record holds the leaflet, and the whole record (what the private-brain session ranks) has its words.
  const whole = await readLocalSearchRecords(leafFile, harvestFile, { leafId: "synthetic-item-three", name: "Synthetic item three fixture" });
  ensure(whole.records.some(entry => entry.id === "leaflet:promoted" && entry.text.includes("Promotedmarker")), "control: the whole record does not hold the promoted leaflet");

  // 3. MARKERS. Each stays inert: gbrain's page has no timeline, its own text holds the guarded
  // word, and its search finds the words inside the facts and takes fences.
  for (const [id, word] of Object.entries(GUARDED)) {
    const slug = await slugFor(`leaflet:marker-${id}`);
    /** @type {{ compiled_truth: string, timeline: string }} */
    const page = await json(`get_page of the ${id} leaflet`, "get_page", { slug });
    ensure(page.timeline === "", `${id}: gbrain read a timeline out of the record's text`);
    ensure(page.compiled_truth.includes(word), `${id}: the guarded word left the page's own text`);
    /** @type {{ slug: string }[]} */
    const found = await json(`gbrain alone: search ${word}`, "search", { query: word, limit: 5 });
    ensure(found.some(row => row.slug === slug), `${id}: gbrain's search does not find ${word}`);
  }

  // 4. REMOVAL. An edited draft has a past version in gbrain; once the draft is gone, nothing is left.
  await record(itemThreeLeaf(), [{ id: "own", excerpt: "Synthetic draft text, Draftmarker version two." }]);
  await brain("refresh in place, one page written", ["refresh"]);
  const draftSlug = await slugFor("draft:brain-note:own");
  ensure((await json("get_versions of the edited draft", "get_versions", { slug: draftSlug })).length > 0, "control: an update in place kept no past version");
  await record(itemThreeLeaf(), []);
  await brain("refresh in place, one page removed", ["refresh"]);
  await gone("the removed draft", draftSlug);
  ensure(await slugOf("draft:brain-note:own") === undefined, "the removed draft is still in the manifest");
  await converged("after the removal");

  // 5. THE LAW'S REMOVAL. Control first: an ordinary edit in place leaves the old text's bytes.
  await record(itemThreeLeaf({ kept: "Synthetic edited text, Oldbodyword." }), []);
  await brain("refresh: an edit in place", ["refresh"]);
  await record(itemThreeLeaf({ kept: "Synthetic edited text, new words." }), []);
  await brain("refresh: another edit in place", ["refresh"]);
  ensure(await holdsBytes(paths.brain, "Oldbodyword"), "control: an update in place did not keep the old text's bytes");
  // A leaflet newly excluded: the brain is rebuilt and swapped, and its body is in no version and no byte.
  ensure(await holdsBytes(paths.brain, xMarker(0)), "control: the body is not in the brain before");
  await record(itemThreeLeaf({ excluded: 1 }), []);
  await rebuiltBy("refresh that rebuilds and swaps (a leaflet newly excluded)");
  const xSlug = await slugFor("leaflet:x0");
  /** @type {{ compiled_truth: string, frontmatter: { foliage_tier: string, foliage_reason: string } }} */
  const xPage = await json("get_page of the newly excluded leaflet", "get_page", { slug: xSlug });
  ensure(same([xPage.frontmatter.foliage_tier, xPage.frontmatter.foliage_reason], ["excluded", "Synthetic: number 0 was somebody else's work."]), "the excluded leaflet's page is not its title and reason");
  ensure(!xPage.compiled_truth.includes(xMarker(0)), "the excluded body is in its page");
  await noVersions("the newly excluded leaflet", xSlug);
  for (const word of [xMarker(0), "Oldbodyword"]) ensure(!(await holdsBytes(paths.brain, word)), `${word} is still in the brain's files`);
  await converged("after the rebuild");

  // 5b. A REFRESH KILLED AFTER ITS IMPORT, THEN THE LAW. gbrain may now hold a page the last
  // finished manifest never named, or newer text than it names: the next refresh judges what gbrain
  // may hold, not only that manifest.
  await record(itemThreeLeaf({ excluded: 1, extra: [leafletOf("lateone", "Lateonebody", OWN)] }), []);
  await killedAt("list");
  const lateOne = await slugFor("leaflet:lateone");
  ensure((await json("get_page of the leaflet the killed refresh imported", "get_page", { slug: lateOne })).frontmatter.foliage_tier === "pending", "control: the killed refresh did not import it");
  await record(itemThreeLeaf({ excluded: 1, extra: [leafletOf("lateone", "Lateonebody", OWN, "excluded")] }), []);
  await rebuiltBy("refresh after a killed import, then an exclusion");
  await noVersions("the late excluded leaflet", lateOne);
  ensure(!(await holdsBytes(paths.brain, "Lateonebody")), "the excluded body is still in the brain's files");
  await converged("after the late exclusion");
  // Imported by the killed refresh, then found to rest on a note about someone else: rebuilt, no trace.
  await record(itemThreeLeaf({ excluded: 1, extra: [leafletOf("latetwo", "Latetwobody", OWN)] }), []);
  await killedAt("list");
  const lateTwo = await slugFor("leaflet:latetwo");
  await record(itemThreeLeaf({ excluded: 1, extra: [leafletOf("latetwo", "Latetwobody", OTHER)] }), []);
  await rebuiltBy("refresh after a killed import, then third-party provenance");
  await gone("the late third-party leaflet", lateTwo);
  ensure(!(await holdsBytes(paths.brain, "Latetwobody")), "the third-party body is still in the brain's files");
  await converged("after the late third-party leaflet");
  // An excluded leaflet brought back, imported by the killed refresh, then the record put back
  // byte for byte: never current, and the next refresh rebuilds.
  /** @param {string} tier */
  const back = (tier) => itemThreeLeaf({ excluded: 1, extra: [leafletOf("back", "Backbodymarker", OWN, tier)] });
  await record(back("excluded"), []);
  await brain("refresh with an excluded leaflet", ["refresh"]);
  ensure(!(await holdsBytes(paths.brain, "Backbodymarker")), "control: an excluded body entered the brain");
  await record(back("pending"), []);
  await killedAt("list");
  ensure(await holdsBytes(paths.brain, "Backbodymarker"), "control: the killed refresh did not import the body");
  await record(back("excluded"), []);
  await brain("status of a record put back byte for byte", ["status"], "Brain: behind your record. Run foliage brain refresh\n");
  ensure((await brainSearch(g, label("foliage brain search Backbodymarker, behind"), "Backbodymarker")).answer.hits.length === 0, "a word only in the excluded body was found");
  await rebuiltBy("refresh after the record was put back");
  ensure(!(await holdsBytes(paths.brain, "Backbodymarker")), "the excluded body is still in the brain's files");
  await noVersions("the put-back leaflet", await slugFor("leaflet:back"));
  const afterBack = await brainSearch(g, label("foliage brain search Backbodymarker, rebuilt"), "Backbodymarker");
  ensure(afterBack.answer.retrieval === "brain keyword" && afterBack.answer.hits.length === 0, "the rebuilt brain finds the excluded body");
  await converged("after the put-back record");

  // A search on a record that moved on by an edit in place brings the brain up to it first
  // (item 5's bounded refresh on read, here through a detached `foliage brain refresh --in-place`).
  await record(itemThreeLeaf({ excluded: 1, edit: 1 }), []);
  await refreshedBrainSearch(g, label("foliage brain search on a record that moved on"), "quillwort");
  await brain("refresh after the search", ["refresh"]);

  // 6. CONVERGENCE. A refresh is killed before each of its steps; the next refresh converges.
  // Each round adds a draft, removes the last one and edits a leaflet, so every step has work.
  /** @type {readonly string[]} */
  const inPlace = ["pages", "import", "list", "remove", "purge", "check-removed", "digests", "manifest"];
  const rebuild = BRAIN_STEPS.filter(step => step === "manifest" || !inPlace.includes(step));
  ensure(same([...new Set([...inPlace, ...rebuild])].sort(), [...BRAIN_STEPS].sort()), "a refresh step is never killed");
  let excluded = 1;
  /** @type {string | null} */
  let previous = null;
  for (const [index, step] of inPlace.entries()) {
    await record(itemThreeLeaf({ excluded, edit: 10 + index }), [{ id: `round-${index}`, excerpt: `Synthetic round ${index} draft, Roundmarker${index}.` }]);
    await killedAt(step);
    await brain(`refresh after one killed before ${step}`, ["refresh"]);
    await converged(`after a refresh killed before ${step}`);
    if (previous !== null) await gone(`the draft removed after a refresh killed before ${step}`, previous);
    const edited = await slugFor("leaflet:edited");
    const digest = (await json(`get_page of the edited leaflet after a refresh killed before ${step}`, "get_page", { slug: edited })).frontmatter.foliage_digest;
    ensure(digest === (await manifest()).pages[edited]?.digest, `after ${step}: gbrain does not hold the edited page's latest text`);
    previous = await slugFor(`draft:brain-note:round-${index}`);
  }
  // A rebuild is killed before each of its steps; the next refresh converges, and the newly
  // excluded leaflet's body is in no byte of the brain.
  for (const step of rebuild) {
    ensure(excluded < EXCLUDABLE, "not enough excludable leaflets for every rebuild step");
    excluded += 1;
    await record(itemThreeLeaf({ excluded, edit: 100 + excluded }), []);
    await killedAt(step);
    await brain(`refresh after a rebuild killed before ${step}`, ["refresh"]);
    await converged(`after a rebuild killed before ${step}`);
    if (previous !== null) { await gone(`the draft removed after a rebuild killed before ${step}`, previous); previous = null; }
    const word = xMarker(excluded - 1);
    ensure(!(await holdsBytes(paths.brain, word)), `after ${step}: ${word} is still in the brain's files`);
    await noVersions(`leaflet x${excluded - 1} after a rebuild killed before ${step}`, await slugFor(`leaflet:x${excluded - 1}`));
  }
  await brain("status after every kill", ["status"]);
  await g.closed();

  // remove: the brain goes, the record stays, and status says off. Without a brain, refresh makes
  // none and says how to build one; search answers without it.
  await brain("remove", ["remove"], "Brain: off\n");
  ensure(same((await readdir(garden)).sort(), ["harvest.json", "leaf.json"]), "remove left something besides the record");
  await brain("status after remove", ["status"], "Brain: off\n");
  const refreshed = await g.brain(label("refresh without a brain"), ["refresh"], { expect: { code: 1 } });
  ensure(same([refreshed.stdout, refreshed.stderr], ["Brain: off\n", "this garden has no brain yet. Run foliage brain build\n"]), `refresh without a brain: ${refreshed.stdout}${refreshed.stderr}`);
  const off = await brainSearch(g, label("foliage brain search without a brain"), "quillwort");
  ensure(same([off.answer.retrieval, off.answer.because], ["foliage keyword", "Brain: off"]), "a search without a brain did not say so");
  ensure(same((await readdir(garden)).sort(), ["harvest.json", "leaf.json"]), "a refresh or search without a brain made one");
}

/* ---- item 5 ------------------------------------------------------------------------------------ */

/** SYNTHETIC identity of the synthetic work repository's author. */
const OWNER_NAME = "Synthetic Owner", OWNER_EMAIL = "synthetic-owner@foliage.invalid";

/** @param {readonly (Buffer | null)[]} a @param {readonly (Buffer | null)[]} b */
const sameBytes = (a, b) => a.length === b.length && a.every((bytes, at) => {
  const other = b[at];
  return bytes === null || other === null || other === undefined ? bytes === other : bytes.equals(other);
});

/**
 * BUILD ORDER ITEM 5: the brain kept current by real actions, through the real launcher.
 * @param {GateContext} ctx
 */
export async function itemFive(ctx) {
  const g = await ctx.garden("item 5");
  const { garden, paths } = g;
  const leafFile = join(garden, "leaf.json"), harvestFile = join(garden, "harvest.json");
  const harvestCli = join(ctx.root, "apps", "leaf", "harvest.mjs");
  const label = (/** @type {string} */ text) => `item 5: ${text}`;
  /** A step whose Foliage command reads the work repository. */
  const git = { allow: { git: true } };

  // A SYNTHETIC work repository: commits by the synthetic owner, each subject holding one word
  // nothing else does, so a search can show that the brain holds it.
  const work = join(ctx.dir, "item-5-work");
  await mkdir(work);
  ctx.git(work, "init", "--quiet", "--initial-branch=main");
  ctx.git(work, "config", "user.name", OWNER_NAME);
  ctx.git(work, "config", "user.email", OWNER_EMAIL);
  /** @param {string} file @param {string} subject */
  const commit = async (file, subject) => {
    await writeFile(join(work, file), `${subject}\n`);
    ctx.git(work, "add", file);
    ctx.git(work, "commit", "--no-gpg-sign", "-qm", subject);
  };
  await commit("a.txt", "feat: Zinniaword survey of synthetic beds");
  await commit("b.txt", "docs: Lupineword notes for the synthetic survey");

  const recordBytes = async () => Promise.all([readFile(leafFile), readFile(harvestFile).catch(() => null)]);
  /** @param {(leaf: { leaflets: { id: string, title: string, tier: string, reason?: string }[] }) => void} edit */
  const editLeaf = async (edit) => {
    const leaf = JSON.parse(await readFile(leafFile, "utf8"));
    edit(leaf);
    await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
  };
  /**
   * After an action has answered: wait until no refresh holds the lock and the manifest is built
   * from the record's bytes as they are now (read here, starting nothing). Then the record's bytes
   * must be what the action left: the refresh read them and wrote none.
   * @param {string} text @param {readonly (Buffer | null)[]} after
   */
  const caughtUp = async (text, after) => {
    const started = performance.now();
    while (await exists(paths.lock) || await brainBehind(garden)) {
      ensure(performance.now() - started < 180_000, `${label(text)}: the brain never caught up with the record`);
      await sleep(100);
    }
    ctx.say(`      ${text}: brain current ${Math.round(performance.now() - started)} ms after the action answered`);
    ensure(sameBytes(await recordBytes(), after), `${label(text)}: a record byte changed after the action answered`);
  };
  /** `foliage status` says current, and, with a word, `foliage brain search` finds it through the brain. @param {string} text @param {string} [word] */
  const current = async (text, word) => {
    const status = await g.foliage(label(`${text}: foliage status`), ["status"]);
    ensure(/^\s+BRAIN\s+current$/m.test(status.stdout), `${label(text)}: ${status.stdout}`);
    if (word === undefined) return;
    const found = await brainSearch(g, label(`${text}: foliage brain search ${word}`), word);
    ensure(found.answer.retrieval === "brain keyword" && found.answer.hits.length > 0, `${label(text)}: ${word} is not in the brain's answer (${found.answer.because ?? found.text})`);
  };
  /**
   * A real action, then the brain caught up with what it wrote.
   * @param {string} text @param {readonly string[]} args @param {string} [word] @param {import("./offline-gate.mjs").StepOptions} [options]
   */
  const action = async (text, args, word, options) => {
    const ran = await g.foliage(label(text), args, options);
    ensure(!/Brain:/.test(`${ran.stdout}${ran.stderr}`), `${label(text)}: the action's own answer is not unchanged by the brain`);
    await caughtUp(text, await recordBytes());
    await current(text, word);
    return ran;
  };

  // Without a brain, an action starts no refresh and makes no brain.
  await g.foliage(label("grow without a brain"), ["grow", "--repo", work, "--subject", OWNER_NAME, "--identity", OWNER_EMAIL], git);
  ensure(!existsSync(paths.brain), "a refresh made a brain");
  ensure((await g.brain(label("build"), ["build"])).stdout === "Brain: current\n", "the build is not current");

  // 1. foliage grow: a new commit under a new prefix, so a new draft too.
  await commit("c.txt", "fix: Yarrowword trail for the synthetic survey");
  await action("grow", ["grow", "--repo", work, "--subject", OWNER_NAME, "--identity", OWNER_EMAIL], "Yarrowword", git);

  // 2. review --resume, after an approval saved by the CLI (which itself asks for nothing).
  await g.node(label("harvest approve (no trigger)"), [harvestCli, "approve", "git-cluster:feat", "--by", OWNER_NAME, "--doc", harvestFile]);
  ensure(await brainBehind(garden), "control: the approval did not leave the brain behind");
  await action("review --resume", ["review", "--resume"]);

  // 3. share and unshare.
  const leafletId = /** @type {string} */ (JSON.parse(await readFile(leafFile, "utf8")).leaflets[0].id);
  await action("share", ["share", leafletId, "--as", "unlisted"]);
  await action("unshare", ["unshare", leafletId]);

  // 4. migrate-queue --apply. Its landing backs both files up through writeDocument's exclusive
  // publication, a hard link, which the macOS profile kills (measured in item 2, and again in item
  // 5's focus run). So the landing of an approval nothing promoted runs outside the sandbox through
  // harvest.mjs itself, which holds no brain code and starts no refresh; the sandboxed command
  // after it finds nothing left to land, and is what starts the refresh that brings the brain up.
  await g.node(label("harvest approve git-cluster:docs (no trigger)"), [harvestCli, "approve", "git-cluster:docs", "--by", OWNER_NAME, "--doc", harvestFile]);
  ensure(await brainBehind(garden), "control: the approval did not leave the brain behind");
  const landed = ctx.outside(label("harvest adopt --apply, the landing"), [harvestCli, "adopt", "--doc", harvestFile, "--into", leafFile, "--repo", work, "--apply"], garden);
  ensure(/appended 1/.test(landed.stdout), `the landing appended nothing: ${landed.stdout}`);
  ensure(await brainBehind(garden), "control: the landing did not leave the brain behind");
  const migrated = await action("migrate-queue --apply", ["migrate-queue", "--repo", work, "--apply"], undefined, git);
  ensure(/already adopted — nothing written/.test(migrated.stdout), migrated.stdout);

  // 4b. integrations import: a SYNTHETIC observation batch from a file, the command-line twin of
  // the MCP tool foliage_submit_observations.
  const leafNow = JSON.parse(await readFile(leafFile, "utf8"));
  const batchFile = join(ctx.dir, "item-5-batch.json");
  await writeFile(batchFile, `${JSON.stringify({ format: "foliage-observations", version: 1, subject: { leafId: leafNow.id, name: leafNow.subject },
    source: { provider: "synthetic-export", tenantId: null, accountId: "synthetic-gate-cli" }, completion: "complete", deletedRecordIds: [],
    observations: [{ recordId: "synthetic-cli-record-1", revision: "synthetic-cli-revision-1", title: "Synthetic Pelicanword observation",
      excerpt: "Synthetic excerpt holding Pelicanword.", observedAt: new Date().toISOString() }] })}\n`);
  await action("integrations import", ["integrations", "import", "--input", batchFile], "Pelicanword");

  // 5. foliage up: its first collection pass, a review decision, a promotion, and a hand edit of
  // leaf.json that nothing announces, caught by the 30-second digest check.
  if (ctx.platform === "darwin") await foliageUp(ctx, g, { work, commit, recordBytes, editLeaf, caughtUp, current });
  else ctx.say("  --  item 5: foliage up's collection pass, saves and 30-second check are not run on Linux: each step's empty network namespace has no loopback the gate can reach");

  // 6. An MCP-only session: no foliage up is running. Writes through the agent's tools leave the
  // brain current; a read asks nothing.
  const mcp = await mcpSession(ctx, g, label("MCP-only session"), ["mcp", "--allow-achievements"]);
  try {
    const context = await mcp.call("foliage_import_context", {});
    const subject = context.structuredContent.subject;
    ensure(!(await brainBehind(garden)), "a read-only tool changed the record");
    const revision = ctx.git(work, "rev-parse", "HEAD");
    const batch = { format: "foliage-observations", version: 1, subject, source: { provider: "local-git-export", tenantId: null, accountId: "synthetic-gate" },
      completion: "complete", deletedRecordIds: [], observations: [{ recordId: revision, revision, title: "Synthetic Quokkaword observation",
        excerpt: "Synthetic excerpt holding Quokkaword.", observedAt: new Date().toISOString() }] };
    const submitted = await mcp.call("foliage_submit_observations", { batch });
    ensure(!submitted.isError, JSON.stringify(submitted));
    await caughtUp("MCP foliage_submit_observations", await recordBytes());
    await current("MCP foliage_submit_observations", "Quokkaword");
    const authored = await mcp.call("foliage_achievement_context", {});
    const saved = await mcp.call("foliage_save_achievement", { documentRevision: authored.structuredContent.documentRevision, title: "Synthetic Kestrelword achievement" });
    ensure(!saved.isError, JSON.stringify(saved));
    await caughtUp("MCP foliage_save_achievement", await recordBytes());
    await current("MCP foliage_save_achievement", "Kestrelword");
  } finally { await mcp.close(); }

  // 7. A refresh that fails never fails the action: the brain stays behind with a named cause.
  await editLeaf(leaf => { const first = leaf.leaflets[0]; if (first) first.title = "Synthetic title\nwith a line break"; });
  await g.foliage(label("share, whose refresh fails"), ["share", leafletId, "--as", "unlisted"]);
  for (let waited = 0; !existsSync(paths.refreshFailure) || existsSync(paths.lock); waited += 100) {
    ensure(waited < 120_000, "the background refresh never finished");
    await sleep(100);
  }
  const stopped = await g.foliage(label("foliage status after the refresh stopped"), ["status"]);
  ensure(new RegExp(`^\\s+BRAIN\\s+behind your record\\. The last refresh stopped: record "leaflet:${leafletId}" has a line break in its title\\. Run foliage brain build after you put that title on one line$`, "m").test(stopped.stdout),
    `foliage status did not name the cause: ${stopped.stdout}`);
  await editLeaf(leaf => { const first = leaf.leaflets[0]; if (first) first.title = "Synthetic title, on one line"; });
  await action("unshare after the fix", ["unshare", leafletId]);
  ensure(!existsSync(paths.refreshFailure), "the failure note stayed once the brain was current");

  // 8. The bounded refresh on read: a detached refresh catches up with an unannounced edit.
  // A search past its 10-second wait bound answers from the current record while it finishes.
  await editLeaf(leaf => { const second = leaf.leaflets[1]; if (second) second.title = `${second.title} Rosemaryword`; });
  const searched = await refreshedBrainSearch(g, label("foliage brain search that starts an in-place refresh"), "Rosemaryword");
  ctx.say(`      search proof, including detached refresh completion: ${Math.round(searched.ms)} ms`);
  // A change that needs a rebuild is never started by a search: it answers at once, and says why.
  await editLeaf(leaf => { const second = leaf.leaflets[1]; if (second) Object.assign(second, { tier: "excluded", reason: "Synthetic: this one was somebody else's work." }); });
  const fallback = await brainSearch(g, label("foliage brain search when only a rebuild would do"), "Zinniaword");
  ensure(same([fallback.answer.retrieval, fallback.answer.because], ["foliage keyword",
    "Brain: behind your record. A search does not start a rebuild (a leaflet was newly excluded, so its earlier text must leave the brain). Run foliage brain refresh"]),
  `the search did not answer from Foliage's own search with the cause: ${fallback.answer.because}`);
  ensure((await g.brain(label("refresh that rebuilds"), ["refresh"])).stdout === "Brain: current\n", "the refresh did not rebuild");
  ensure((await g.brain(label("status, every setting read back"), ["status"])).stdout === "Brain: current\n", "the brain is not current at the end");
  await g.closed();
}

/**
 * Item 5's `foliage up` steps (macOS only: the gate reaches the server on loopback).
 * @param {GateContext} ctx @param {GardenSteps} g
 * @param {{ work: string, commit: (file: string, subject: string) => Promise<void>, recordBytes: () => Promise<(Buffer | null)[]>,
 *   editLeaf: (edit: (leaf: { leaflets: { title: string }[] }) => void) => Promise<void>,
 *   caughtUp: (text: string, after: (Buffer | null)[]) => Promise<void>, current: (text: string, word?: string) => Promise<void> }} item
 */
async function foliageUp(ctx, g, { work, commit, recordBytes, editLeaf, caughtUp, current }) {
  const harvestFile = join(g.garden, "harvest.json");
  // The collector gets one source, the synthetic work repository, due now, and a new commit to draft.
  await commit("d.txt", "perf: Heronword pass over the synthetic beds");
  const workflowFile = join(g.garden, "workflow", "workflow.json");
  await mkdir(join(g.garden, "workflow"), { recursive: true });
  const saved = await readFile(workflowFile, "utf8").then(text => JSON.parse(text), () => ({ version: 1, proposals: [], history: [], attempt: 0, running: false }));
  await writeFile(workflowFile, `${JSON.stringify({ ...saved,
    schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "22:00", end: "07:00", paused: false },
    sources: [{ id: "synthetic-work", path: work, email: OWNER_EMAIL, enabled: true }], nextAt: "2000-01-01T00:00:00.000Z" }, null, 2)}\n`);
  const beforeUp = await recordBytes();
  const port = await freePort();
  const upStarted = performance.now();
  const up = g.running("item 5: foliage up", ctx.programs.node, [join(ctx.root, "foliage.mjs"), "up", "--port", String(port), "--garden", g.garden],
    { allow: { git: true }, expect: { stopped: true } });
  const origin = `http://127.0.0.1:${port}`;
  /** @type {unknown} */
  let failure = null;
  try {
    for (let waited = 0; ; waited += 100) {
      ensure(waited < 30_000, "foliage up never answered");
      if (await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) }).then(response => response.ok, () => false)) break;
      await sleep(100);
    }
    // The first pass runs at start and drafts the new commit into the harvest. Nothing else asks for
    // a refresh before the 30-second check: no POST has been made, and `foliage up`'s first request
    // at start is the one after this pass.
    for (let waited = 0; (await readFile(harvestFile, "utf8")).indexOf("Heronword") < 0; waited += 100) {
      ensure(waited < 25_000, "the collection pass never drafted the new commit");
      await sleep(100);
    }
    ensure(!sameBytes(await recordBytes(), beforeUp), "control: the pass did not change the harvest");
    await caughtUp("foliage up: first collection pass", await recordBytes());
    const passCurrent = performance.now() - upStarted;
    ctx.say(`      foliage up: brain current ${Math.round(passCurrent)} ms after foliage up started`);
    ensure(passCurrent < 30_000, `the pass's own request did not catch the brain up before the 30-second check could have run (${Math.round(passCurrent)} ms)`);
    await current("foliage up: first collection pass", "Heronword");
    /** @param {string} path @param {Record<string, string>} form */
    const post = async (path, form) => {
      const response = await fetch(`${origin}${path}`, { method: "POST", redirect: "manual", headers: { origin }, body: new URLSearchParams(form), signal: AbortSignal.timeout(10_000) });
      await response.text();
      return response.status;
    };
    let before = await recordBytes();
    ensure(await post("/review", { id: "git-cluster:fix", decision: "approve", by: OWNER_NAME }) === 303, "the review decision was not saved");
    ensure(!sameBytes(await recordBytes(), before), "control: the decision changed nothing");
    await caughtUp("foliage up: review decision", await recordBytes());
    await current("foliage up: review decision");
    before = await recordBytes();
    ensure(await post("/promote", {}) === 303, "the promotion was not saved");
    ensure(!sameBytes(await recordBytes(), before), "control: the promotion changed nothing");
    await caughtUp("foliage up: promotion", await recordBytes());
    await current("foliage up: promotion", "Yarrowword");
    // A hand edit of leaf.json, which nothing announces: the 30-second digest check notices it.
    await editLeaf(leaf => { const first = leaf.leaflets[0]; if (first) first.title = `${first.title} Outsidewriterword`; });
    const written = performance.now();
    await caughtUp("foliage up: a hand edit, caught by the digest check", await recordBytes());
    ensure(performance.now() - written < 45_000, "the 30-second check did not catch the hand edit");
    await current("foliage up: digest check", "Outsidewriterword");
  } catch (error) { failure = error; }
  if (up.child.pid !== undefined) try { process.kill(-up.child.pid, "SIGTERM"); } catch { /* already gone */ }
  const ended = await up.settled.then(() => null, (/** @type {unknown} */ error) => error);
  if (failure !== null) throw failure;
  if (ended !== null) throw ended;
}

/* ---- item 6 ------------------------------------------------------------------------------------ */

/** SYNTHETIC: the reason and the 500-character body of `excludedSearch.test.ts`'s excluded leaflet ("Bodymarker" only in the body). */
const SIX_REASON = "Synthetic reason: this work belongs to a different author.";
const SIX_BODY = "Bodymarker synthetic stand-in paragraph written by someone else. ".repeat(10).slice(0, 500);
/** The queries every surface is asked with the brain off and on, each with its limit. */
const SIX_QUERIES = /** @type {const} */ ([
  ["Saxifrage", 8], ["Bodymarker", 8], ["lichen", 10], ["transport", 3], ["Wisteriaword", 8], ["Promotedmarker", 8],
  ["Theirdraftmarker", 8], ["synthetic", 10], ["draft", 8], ["excluded leaflet", 8], ["kayak canoe", 8],
]);

/**
 * The SYNTHETIC leaf.json for item 6: the shapes today's search and MCP tests use, in one garden.
 * `twins` are the two twin leaflets' tiers.
 * @param {readonly [string, string]} [twins]
 */
function itemSixLeaf(twins = ["verified", "pending"]) {
  return {
    id: "synthetic-item-six", subject: "Synthetic item six fixture", headline: "Synthetic headline for the item six test",
    leaflets: [
      // excludedSearch.test.ts's shape: "Saxifrage" only in the title, "Bodymarker" only in the body.
      { id: "outside", title: "Saxifrage migration notes", tier: "excluded", reason: SIX_REASON,
        body: [{ text: SIX_BODY, provenance: { source: "git", ref: "synthetic-ref", observedAt: AT } }] },
      // Ten records match "lichen": eight leaflets, a claim and its past version one word apart.
      ...Array.from({ length: 8 }, (_, index) => ownLeaflet(`l${index}`, `Synthetic leaflet ${index}`, `Synthetic lichen notes, number ${index}.`, index % 2 ? "verified" : "pending")),
      // Two leaflets with the same words and different tiers: a tier never moves a hit.
      ownLeaflet("twin-a", "Synthetic twin leaflet", "Synthetic Wisteriaword twin text.", twins[0]),
      ownLeaflet("twin-b", "Synthetic twin leaflet", "Synthetic Wisteriaword twin text.", twins[1]),
      // Promoted from a note about someone else: no search of the whole record returns it.
      { id: "promoted", title: "Synthetic promoted leaflet", tier: "pending", provenance: OTHER, body: [{ provenance: OTHER, text: "Promotedmarker notes about someone else." }] },
    ],
    achievements: [{ id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped lichen beds by kayak.", citations: [{ leaflet: "l1", provenance: OWN }] }] }],
    journeyHistory: [{ id: "edit-1", at: AT, actor: "manual", achievement: "a1",
      before: { id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped lichen beds by canoe." }] },
      after: { id: "a1", title: "Synthetic river survey", claims: [{ id: "c1", kind: "learning", text: "Mapped lichen beds by kayak." }] } }],
  };
}

/** The SYNTHETIC harvest.json for item 6: the owner's own draft (assistantMcp.test.ts's "transport"), and one on a note about someone else. */
function itemSixHarvest() {
  return { leafId: "synthetic-item-six", subject: "Synthetic item six fixture", candidates: [
    { id: "brain-note:own", title: "Synthetic transport draft", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ source: "brain-note", ref: "notes/own.md", observedAt: AT, excerpt: "Synthetic transport regression notes." }] },
    { id: "brain-note:theirs", title: "Synthetic draft on a note about someone else", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ ...OTHER, excerpt: "Theirdraftmarker words." }] },
  ] };
}

/**
 * BUILD ORDER ITEM 6, in keyword mode: `foliage search` and `foliage_search` answer from Foliage's
 * own search and never touch the brain; `foliage brain search` reads it beside them.
 * @param {GateContext} ctx
 */
export async function itemSix(ctx) {
  const g = await ctx.garden("item 6");
  const { garden, paths } = g;
  const leafFile = join(garden, "leaf.json"), harvestFile = join(garden, "harvest.json");
  const label = (/** @type {string} */ text) => `item 6: ${text}`;
  /** An MCP session with search and the revision-bound brain tools. None of them may start a gbrain process. @param {string} name */
  const connect = async (name) => {
    const session = await mcpSession(ctx, g, label(`MCP session, ${name}`), ["mcp", "--allow-search", "--allow-brain"], { gbrain: false });
    /** @param {string} query @param {number} limit @returns {Promise<{ answer: Answer, text: string, ms: number }>} */
    const search = async (query, limit) => {
      const started = performance.now();
      const result = await session.call("foliage_search", { query, limit });
      const ms = performance.now() - started;
      ensure(!result.isError, `foliage_search ${query}: ${JSON.stringify(result)}`);
      return { answer: result.structuredContent, text: JSON.stringify(result), ms };
    };
    return { ...session, search };
  };
  /** A signed private-brain session over exact records, which may start no gbrain process; its answers to a few queries. @param {string} name */
  const privateSession = async (name) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyFile = join(ctx.dir, `item-6-agent-${name}.pem`);
    await writeFile(keyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const grants = ["leaflet:outside", "leaflet:l0", "leaflet:twin-a", "claim:a1:c1", "history:edit-1", "draft:brain-note:own", "draft:brain-note:theirs", "leaflet:promoted"];
    const { child, settled } = g.running(label(`private-brain session, ${name}`), ctx.programs.node, [join(ctx.root, "foliage.mjs"), "private-brain", "serve", "--garden", garden,
      "--agent-key", keyFile, "--agent-label", "item-six-gate", ...grants.flatMap(id => ["--record", id]), "--minutes", "1"], { stdin: true, allow: { gbrain: false } });
    let printed = "";
    /** @type {string} */
    const ready = await new Promise((resolve, reject) => {
      child.stderr?.on("data", chunk => {
        printed += String(chunk);
        if (printed.includes("Type revoke and Enter")) resolve(printed);
      });
      child.once("exit", code => reject(new Error(`the private-brain session exited before it was ready: ${code}; ${printed}`)));
    });
    const session = /Private brain session ([a-f0-9]{32})/.exec(ready)?.[1];
    const url = /Loopback (http:\/\/127\.0\.0\.1:\d+\/private-brain\/search)/.exec(ready)?.[1];
    ensure(session !== undefined && url !== undefined, ready);
    /** @type {unknown[]} */
    const answers = [];
    for (const query of ["Saxifrage", "Bodymarker", "lichen", "Theirdraftmarker", "Promotedmarker", "Wisteriaword"]) {
      const timestamp = String(Date.now()), nonce = randomBytes(18).toString("base64url");
      const request = JSON.stringify({ query });
      const signature = sign(null, privateBrainSigningInput(session, timestamp, nonce, Buffer.from(request)), privateKey).toString("base64url");
      const response = await fetch(url, { method: "POST", body: request, headers: { "content-type": "application/json",
        "x-foliage-session": session, "x-foliage-timestamp": timestamp, "x-foliage-nonce": nonce, "x-foliage-signature": signature } });
      ensure(response.status === 200, `the private-brain session answered ${response.status}`);
      // The session's own id differs from one session to the next; the hits are what is compared.
      const { session: answered, ...rest } = JSON.parse(await response.text());
      ensure(answered === session, "the private-brain session answered for another session");
      answers.push(rest);
    }
    child.stdin?.write("revoke\n");
    await settled;
    return answers;
  };
  /**
   * Everything one phase sees through the surfaces that must not touch the brain: `foliage search`
   * and `foliage_search` for every query, the revision-bound brain tools, `private-brain list` and
   * a signed private-brain session, and the search wall times. With a brain present, not one byte
   * under `brain/` may change while they run.
   * @param {string} name
   */
  const phase = async (name) => {
    const brainBefore = existsSync(paths.brain) ? await treeDigest(paths.brain) : null;
    /** @type {Map<string, { answer: Answer, text: string, ms: number }>} */
    const cli = new Map();
    /** @type {Map<string, { answer: Answer, text: string, ms: number }>} */
    const viaMcp = new Map();
    for (const [query, limit] of SIX_QUERIES) cli.set(query, await ownSearch(g, label(`foliage search ${query}, ${name}`), query, limit));
    const mcp = await connect(name);
    /** @type {unknown[]} */
    const tools = [];
    const timings = { cli: /** @type {number[]} */ ([]), mcp: /** @type {number[]} */ ([]) };
    try {
      for (const [query, limit] of SIX_QUERIES) viaMcp.set(query, await mcp.search(query, limit));
      // The revision-bound brain tools (--allow-brain): context, search, read and related, as their own test calls them.
      const context = await mcp.call("foliage_brain_context", {});
      ensure(!context.isError, JSON.stringify(context));
      const revision = context.structuredContent.revision;
      tools.push(context.structuredContent);
      for (const query of ["lichen", "Saxifrage", "transport", "Wisteriaword"]) {
        const found = await mcp.call("foliage_brain_search", { revision, query });
        ensure(!found.isError, JSON.stringify(found));
        tools.push(found.structuredContent);
        const first = found.structuredContent.results[0];
        if (first === undefined) continue;
        for (const tool of ["foliage_brain_read", "foliage_brain_related"]) {
          const more = await mcp.call(tool, { revision, id: first.id });
          ensure(!more.isError, JSON.stringify(more));
          tools.push(more.structuredContent);
        }
      }
      for (let round = 0; round < 7; round++) timings.mcp.push((await mcp.search("lichen", 10)).ms);
    } finally { await mcp.close(); }
    for (let round = 0; round < 7; round++) timings.cli.push((await ownSearch(g, label(`foliage search lichen, ${name}, timed ${round + 1}`), "lichen", 10)).ms);
    const listed = await g.foliage(label(`private-brain list, ${name}`), ["private-brain", "list"], { allow: { gbrain: false } });
    const session = ctx.platform === "darwin" ? await privateSession(name) : null;
    if (brainBefore !== null) ensure(await treeDigest(paths.brain) === brainBefore, `${name}: a search or another surface changed a byte under brain/`);
    return { name, cli, viaMcp, tools, list: JSON.parse(listed.stdout), session, timings };
  };

  await writeFile(leafFile, `${JSON.stringify(itemSixLeaf(), null, 2)}\n`);
  await writeFile(harvestFile, `${JSON.stringify(itemSixHarvest(), null, 2)}\n`);
  const recordBefore = await Promise.all([readFile(leafFile), readFile(harvestFile)]);

  // 1. THE BRAIN OFF: no brain/ in the garden. 2. THE BRAIN ON: built from the same bytes.
  const off = await phase("brain off");
  ensure(!existsSync(paths.brain), "a search made a brain");
  ensure((await g.brain(label("build"), ["build"])).stdout === "Brain: current\n", "the build is not current");
  const on = await phase("brain on");
  ensure(sameBytes(await Promise.all([readFile(leafFile), readFile(harvestFile)]), recordBefore), "a search wrote the record");
  // `foliage brain search`, beside them, reads the current brain.
  /** @type {Map<string, { answer: Answer, text: string, ms: number }>} */
  const throughBrain = new Map();
  for (const [query, limit] of SIX_QUERIES) throughBrain.set(query, await brainSearch(g, label(`foliage brain search ${query}`), query, limit));
  /** @type {number[]} */
  const brainTimings = [];
  for (let round = 0; round < 7; round++) brainTimings.push((await brainSearch(g, label(`foliage brain search lichen, timed ${round + 1}`), "lichen", 10)).ms);

  for (const [query, limit] of SIX_QUERIES) {
    const cliOff = off.cli.get(query), cliOn = on.cli.get(query), mcpOff = off.viaMcp.get(query), mcpOn = on.viaMcp.get(query), brained = throughBrain.get(query);
    ensure(cliOff && cliOn && mcpOff && mcpOn && brained, `${query} was not asked of every surface`);
    // Keyword mode: the brain beside them changes nothing, and one function answers both surfaces.
    ensure(same(cliOn.answer, cliOff.answer) && same(mcpOn.answer, mcpOff.answer), `${query}: an answer changed with the brain on`);
    ensure(same(mcpOn.answer, cliOn.answer), `${query}: foliage_search and foliage search differ`);
    // The brain's own answer keeps every hit Foliage's own holds, built the same way.
    ensure(brained.answer.retrieval === "brain keyword", `foliage brain search ${query} did not read the brain: ${brained.answer.because}`);
    for (const hit of cliOn.answer.hits) ensure(same(brained.answer.hits.find(other => other.id === hit.id), hit), `foliage brain search ${query}: ${hit.id} is missing or built differently`);
    ensure(brained.answer.hits.length <= limit, `foliage brain search ${query}: more hits than the limit`);
    const extra = brained.answer.hits.filter(hit => !cliOn.answer.hits.some(other => other.id === hit.id)).map(hit => hit.id);
    if (extra.length > 0) ctx.say(`      foliage brain search ${JSON.stringify(query)}: the brain also found ${extra.join(", ")} in spare room`);
    for (const text of [cliOff.text, cliOn.text, mcpOff.text, mcpOn.text, brained.text]) {
      ensure(!FORBIDDEN.test(text), `${query}: a gbrain field, label or page address reached an answer`);
      ensure(!text.includes(garden) && !text.includes(ctx.dir), `${query}: a path reached an answer`);
      ensure(!/bodymarker|promotedmarker|theirdraftmarker/i.test(text), `${query}: excluded or third-party text reached an answer`);
    }
  }

  // 3. TODAY'S SEARCH TESTS (their assertions, repeated on what each surface returns).
  // excludedSearch.test.ts: a title-only match on an excluded leaflet is its reason, with no body
  // text and no evidence references; a word only in its body finds nothing.
  const expectedExcluded = { id: "leaflet:outside", kind: "excluded leaflet", title: "Saxifrage migration notes", snippet: SIX_REASON, citation: "leaf:leaflet%2Foutside", reason: SIX_REASON };
  for (const found of [on.cli.get("Saxifrage"), on.viaMcp.get("Saxifrage"), throughBrain.get("Saxifrage")]) {
    ensure(found !== undefined && found.answer.hits.length === 1 && same(found.answer.hits[0], expectedExcluded), `Saxifrage: ${found?.text}`);
  }
  for (const found of [on.cli.get("Bodymarker"), on.viaMcp.get("Bodymarker"), throughBrain.get("Bodymarker")]) ensure(found?.answer.hits.length === 0, "a word only in the excluded body was found");
  // assistantMcp.test.ts's private search: a labelled draft cited from the harvest, bounded
  // excerpts, evidence references, no score, no garden path.
  for (const found of [on.viaMcp.get("transport"), throughBrain.get("transport")]) {
    ensure(found !== undefined, "transport was not asked");
    ensure(found.answer.hits.some(hit => hit.kind.includes("draft") && hit.citation.startsWith("harvest:")), "no labelled draft cited from the harvest");
    ensure(found.answer.hits.every(hit => hit.snippet.length <= 242) && found.answer.hits.some(hit => hit.evidence?.length), "an excerpt is unbounded, or no evidence references");
    ensure(!found.text.includes('"score"') && !found.text.includes(garden), "a score or the garden path reached the answer");
  }
  // Third-party material is never returned, brain or not.
  for (const query of ["Promotedmarker", "Theirdraftmarker"]) {
    for (const found of [off.cli.get(query), on.cli.get(query), throughBrain.get(query)]) ensure(found?.answer.hits.length === 0, `${query} was found`);
  }
  // A claim and its past version one word apart both come back, labelled, though gbrain alone deduplicates them.
  for (const found of [on.cli.get("lichen"), throughBrain.get("lichen")]) {
    ensure(found !== undefined && found.answer.hits.length === 10, "lichen: not ten hits");
    ensure(same(["claim:a1:c1", "history:edit-1"].map(id => found.answer.hits.find(hit => hit.id === id)?.kind), ["achievement learning", "past version"]), "lichen: the claim and its past version are not both labelled");
  }

  // 4. THE OTHER SURFACES DO NOT READ THE BRAIN: the revision-bound brain tools, `private-brain
  // list` and a signed private-brain session answer the same with the brain on as off.
  ensure(same(on.tools, off.tools), "the --allow-brain tools answered differently with the brain on");
  ensure(same(on.list, off.list), "private-brain list answered differently with the brain on");
  if (ctx.platform === "darwin") {
    ensure(same(on.session, off.session), "the private-brain session answered differently with the brain on");
    // The session ranks the whole granted record, as after PR 1: third-party records it was granted come back.
    const text = JSON.stringify(on.session);
    ensure(text.includes("draft:brain-note:theirs") && text.includes("leaflet:promoted") && !/bodymarker/i.test(text), "the private-brain session's answers changed shape");
  } else ctx.say("  --  item 6: the signed private-brain session is not run on Linux: its loopback server is out of the gate's reach in the step's empty network namespace");

  // 5. LATENCY, keyword mode, sandboxed, the same query ("lichen", limit 10) seven times each.
  ctx.say(`      foliage search, brain off: ${spread(off.timings.cli)}`);
  ctx.say(`      foliage search, brain on (keyword mode: not read): ${spread(on.timings.cli)}`);
  ctx.say(`      foliage_search over MCP, brain off: ${spread(off.timings.mcp)}`);
  ctx.say(`      foliage_search over MCP, brain on (keyword mode: not read): ${spread(on.timings.mcp)}`);
  ctx.say(`      foliage brain search, through the current brain: ${spread(brainTimings)}`);

  // 6. IDENTITY CHECKS HOLD WITH THE BRAIN ON: a harvest bound to another subject is refused by
  // both surfaces, and nothing of it reaches the answer.
  const harvestBytes = await readFile(harvestFile);
  const mcp = await connect("identity");
  try {
    for (const [index, changed] of [{ ...itemSixHarvest(), subject: "Different subject" }, { ...itemSixHarvest(), subject: "Different subject", candidates: [] }].entries()) {
      await writeFile(harvestFile, JSON.stringify(changed));
      const refused = await mcp.call("foliage_search", { query: "transport" });
      ensure(refused.isError === true, "a wrong-subject harvest was not refused by foliage_search");
      ensure(!JSON.stringify(refused).includes("Synthetic transport regression"), "the wrong-subject harvest reached the answer");
      const cli = await g.foliage(label(`foliage search with a wrong-subject harvest ${index + 1}`), ["search", "transport"], { allow: { gbrain: false }, expect: { code: 1 } });
      ensure(/Harvest binding is absent or differs from the selected Leaf; private search refused/.test(cli.stderr), `foliage search did not refuse: ${cli.stderr}`);
    }
  } finally { await mcp.close(); }
  await writeFile(harvestFile, harvestBytes);

  // 7. A TIER NEVER MOVES A HIT: two leaflets with the same words keep their order when their tiers
  // swap, in Foliage's own answer and in the brain's.
  const twins = async (/** @type {string} */ when) => {
    const own = (await ownSearch(g, label(`foliage search Wisteriaword, ${when}`), "Wisteriaword", 8)).answer.hits.map(hit => [hit.id, hit.kind]);
    const found = await brainSearch(g, label(`foliage brain search Wisteriaword, ${when}`), "Wisteriaword", 8);
    ensure(found.answer.retrieval === "brain keyword", `the brain did not answer: ${found.answer.because}`);
    return { own, brain: found.answer.hits.map(hit => [hit.id, hit.kind]) };
  };
  const before = await twins("before the tiers swap");
  await writeFile(leafFile, `${JSON.stringify(itemSixLeaf(["pending", "verified"]), null, 2)}\n`);
  ensure((await g.brain(label("refresh after the tiers swap"), ["refresh"])).stdout === "Brain: current\n", "the refresh is not current");
  const after = await twins("after the tiers swap");
  const swapped = (/** @type {string} */ kind) => kind === "verified leaflet" ? "pending leaflet" : kind === "pending leaflet" ? "verified leaflet" : kind;
  for (const engine of /** @type {const} */ (["own", "brain"])) {
    ensure(same(before[engine].map(([, kind]) => kind).sort(), ["pending leaflet", "verified leaflet"]), `${engine}: the twins are not found, one of each tier`);
    ensure(same(after[engine].map(([id]) => id), before[engine].map(([id]) => id)), `${engine}: swapping the tiers moved a hit`);
    ensure(same(after[engine].map(([, kind]) => kind), before[engine].map(([, kind]) => swapped(kind ?? ""))), `${engine}: the labels did not follow the tiers`);
  }

  // 8. BEHIND. An edit nothing announced: keyword-mode reads answer from it at once, start nothing,
  // and leave the brain behind for its triggers; `foliage brain search` refreshes in place first.
  /** @param {(leaf: ReturnType<typeof itemSixLeaf>) => void} change */
  const edit = async (change) => {
    const leaf = JSON.parse(await readFile(leafFile, "utf8"));
    change(leaf);
    await writeFile(leafFile, `${JSON.stringify(leaf, null, 2)}\n`);
  };
  await edit(leaf => { const leaflet = leaf.leaflets[1]; if (leaflet?.body[0]) leaflet.body[0].text += " Marigoldword."; });
  const ownBehind = await ownSearch(g, label("foliage search Marigoldword, the brain behind"), "Marigoldword", 8);
  ensure(same(ownBehind.answer.hits.map(hit => hit.id), ["leaflet:l0"]), `Foliage's own search did not find the edit at once: ${ownBehind.text}`);
  const inSession = await connect("brain behind");
  try {
    const found = await inSession.search("Marigoldword", 8);
    ensure(same([found.answer.retrieval, found.answer.because, found.answer.hits.map(hit => hit.id)], ["foliage keyword", KEYWORD_MODE, ["leaflet:l0"]]), found.text);
  } finally { await inSession.close(); }
  ensure(await brainBehind(garden), "a keyword-mode search refreshed the brain");
  const refreshedRead = await refreshedBrainSearch(g, label("foliage brain search Marigoldword, refreshed in place"), "Marigoldword", 8);
  ensure(same([refreshedRead.answer.retrieval, refreshedRead.answer.hits.map(hit => hit.id)], ["brain keyword", ["leaflet:l0"]]), refreshedRead.text);
  ctx.say(`      search proof, including detached refresh completion: ${Math.round(refreshedRead.ms)} ms`);
  // A change that needs a rebuild: Foliage's own answer already has the newly excluded twin as its
  // reason only; `foliage brain search` never starts the rebuild, answers the same, and says why.
  const kept = await readFile(leafFile);
  await edit(leaf => { const twin = leaf.leaflets[10]; if (twin) Object.assign(twin, { tier: "excluded", reason: "Synthetic: somebody else's twin." }); });
  const ownExcluded = await ownSearch(g, label("foliage search Wisteriaword, a twin newly excluded"), "Wisteriaword", 8);
  ensure(!ownExcluded.answer.hits.some(hit => hit.id === "leaflet:twin-b"), "the newly excluded twin's body is still searched");
  const byTitle = await ownSearch(g, label("foliage search twin leaflet, a twin newly excluded"), "twin leaflet", 8);
  ensure(same(byTitle.answer.hits.filter(hit => hit.id === "leaflet:twin-b").map(hit => [hit.kind, hit.snippet, hit.reason, hit.evidence]),
    [["excluded leaflet", "Synthetic: somebody else's twin.", "Synthetic: somebody else's twin.", undefined]]), "found by its title, the excluded twin is not its reason");
  const rebuildNeeded = await brainSearch(g, label("foliage brain search Wisteriaword, only a rebuild would do"), "Wisteriaword", 8);
  ensure(same([rebuildNeeded.answer.retrieval, rebuildNeeded.answer.because, rebuildNeeded.answer.hits], ["foliage keyword",
    "Brain: behind your record. A search does not start a rebuild (a leaflet was newly excluded, so its earlier text must leave the brain). Run foliage brain refresh",
    ownExcluded.answer.hits]), `the brain's fallback is not Foliage's own answer with the cause: ${rebuildNeeded.text}`);
  await writeFile(leafFile, kept);
  ensure((await brainSearch(g, label("foliage brain search Wisteriaword, the same bytes back"), "Wisteriaword", 8)).answer.retrieval === "brain keyword", "the same bytes back: the brain does not answer again");

  ensure((await g.brain(label("status at the end"), ["status"])).stdout === "Brain: current\n", "the brain is not current at the end");
  await g.closed();
}
