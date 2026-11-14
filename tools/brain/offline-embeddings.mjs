/**
 * THE BRAIN OFFLINE GATE'S PROOF FOR BUILD ORDER ITEM 8: LOCAL EMBEDDINGS, OPT-IN (unit 38; spec
 * PR #201; owner decision 3, 2026-10-12). A phase of `scripts/check-brain-offline.mjs`, under the
 * gate's own sandbox and observer (`offline-gate.mjs`). Every record below is SYNTHETIC.
 *
 * NO EMBEDDING MODEL IS USED. None is installed on the machine this was built on and none may be
 * downloaded, so the embedder is `standin-embedder.mjs`: a deterministic stand-in on 127.0.0.1
 * that speaks Ollama's model list and the OpenAI-shaped `/v1/embeddings` gbrain's ollama recipe
 * calls. What this proves is the plumbing and the boundary; recall with a real model is NOT
 * measured. The stand-in's SYNTHETIC synonym table maps "bryophyte" onto "moss" so a test can show
 * gbrain's vector arm reaching a page that holds none of the query's words.
 *
 * Every step that may reach the stand-in runs under a profile that allows outbound connections to
 * its one port on 127.0.0.1 and nothing else (another loopback port, a name lookup and any remote
 * address are each killed and logged; the gate's controls show it), with every planted switch the
 * gate plants, plus `NODE_USE_ENV_PROXY=1` (Node's own fetch would then follow the planted proxies)
 * and `OLLAMA_HOST` aimed elsewhere. Steps that must not reach it (keyword mode, turning embeddings
 * off) run under the profile that denies all outbound network.
 *
 * It proves, with the staged gbrain and the real launcher:
 *   - a cloud model's name, a model the embedder lists as remote, and a model it does not hold are
 *     each refused before anything changes, and nothing is pulled;
 *   - `foliage brain embed --local ollama:<model>` measures the model, rebuilds the brain at its
 *     dimensions (a new database; config.json exactly Foliage's, the base URL pinned to loopback;
 *     every setting read back), and gbrain embeds the pages with that model;
 *   - `foliage search` and `foliage_search` then read the brain (`brain local embedding`): every hit
 *     Foliage's own search returns is there, built the same, and the vector arm reaches a page that
 *     holds none of the query's words; no gbrain field, page address, path, excluded body or
 *     third-party text reaches an answer; and a search commits no write to the brain (control:
 *     with `search.track_retrieval` on, it does);
 *   - a refresh embeds what it imports (`embed --stale`), and a search behind its record refreshes in
 *     place first; so does an MCP session: a write through its tools is embedded by the server's own
 *     refresh, and its `foliage_search` of a record edited by hand refreshes in process first;
 *   - with the embedder stopped, both surfaces and `foliage brain search` answer from Foliage's own
 *     search, naming it, and start no gbrain process, and `foliage status` names it too; a leaflet
 *     newly excluded meanwhile is still rebuilt out of the brain, its body in no page, version or
 *     byte, and the brain stays behind until the embedder is back, when a search catches it up;
 *   - an embedder that lists the model but fails to embed (HTTP 500), or answers another size, is
 *     named before any search starts, never left to gbrain's silent fallback to keyword search;
 *   - the brain's column has the model's size: Foliage's own probe catches an embedder answering
 *     another size, and when one answers the probe honestly but lies to gbrain, gbrain's own check
 *     refuses the vectors by name; the record's pages are in the brain either way;
 *   - switching to a model of another size rebuilds at that size; a refresh killed before its embed
 *     step, and a switch killed before the new brain's embed step, converge on the next refresh;
 *   - `foliage brain embed --off` rebuilds in keyword mode without asking the embedder anything, and
 *     keyword-mode reads skip the brain again.
 *
 * MACOS ONLY: the stand-in listens on the gate's loopback, which a Linux step's empty network
 * namespace cannot reach, so on Linux this phase says so and does not run.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brainConfigText } from "../../apps/leaf/src/localBrain.ts";
import { localEmbeddingText } from "../../packages/photosynthesis/src/brainEmbedding.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { brainBehind } from "../../apps/leaf/src/brainUpkeep.ts";
import { ensure, FORBIDDEN, holdsBytes, KEYWORD_MODE, mcpSession, OTHER, OWN, treeDigest } from "./offline-proofs.mjs";
import { startStandInEmbedder } from "./standin-embedder.mjs";

/**
 * @typedef {import("./offline-gate.mjs").GateContext} GateContext
 * @typedef {import("./offline-gate.mjs").GardenSteps} GardenSteps
 * @typedef {import("./offline-gate.mjs").StepOptions} StepOptions
 * @typedef {{ id: string, kind: string, title: string, snippet: string, citation: string, reason?: string }} Hit
 * @typedef {{ retrieval: string, because?: string, hits: Hit[] }} Answer
 */

const AT = "2026-10-12T00:00:00Z";
const EIGHT_REASON = "Synthetic reason: another author wrote this.";
const FERN_REASON = "Synthetic reason: this one turned out to be someone else's.";
/** The stand-in's models: two of different sizes, and one listed the way Ollama lists a cloud model. */
const MODELS = Object.freeze([
  { name: "standin-a", dimensions: 64 }, { name: "standin-b", dimensions: 96 }, { name: "standin-remote", dimensions: 64, remote: true },
]);
/** SYNTHETIC: the stand-in reads "bryophyte" as "moss". Plumbing, not recall. */
const SYNONYMS = Object.freeze({ bryophyte: "moss" });
/** Every surface is asked these, each with its limit. */
const QUERIES = /** @type {const} */ ([
  ["lichen", 10], ["bryophyte", 5], ["saxifrage", 8], ["Bodymarkereight", 8], ["Promotedmarkereight", 8], ["Theirdraftmarkereight", 8], ["transect", 5],
]);

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** @param {unknown} value */
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
/**
 * The same hits, each built the same, in any order: Foliage's own ranking is BM25 over the whole
 * record, so a leaflet added elsewhere may reorder hits it does not join.
 * @param {readonly Hit[] | undefined} a @param {readonly Hit[] | undefined} b
 */
const sameHits = (a, b) => same([...a ?? []].sort((x, y) => x.id.localeCompare(y.id)), [...b ?? []].sort((x, y) => x.id.localeCompare(y.id)));

/** @param {string} id @param {string} title @param {string} text @param {string} [tier] */
const leaflet = (id, title, text, tier = "verified") => ({ id, title, tier, provenance: OWN, body: [{ provenance: OWN, text }] });

/**
 * The SYNTHETIC leaf.json for item 8. Later rounds add leaflets whose words appear nowhere else
 * (and never "lichen", "moss" or "transect", so the earlier answers stay the reference). `fern`:
 * a leaflet whose body holds Fernbodyword, later newly excluded while the embedder is stopped.
 * @param {{ sundew?: boolean, pitcher?: boolean, sedge?: boolean, venus?: boolean, wren?: boolean, fern?: "own" | "excluded" }} [round]
 */
function eightLeaf(round = {}) {
  return {
    id: "synthetic-item-eight", subject: "Synthetic item eight fixture",
    leaflets: [
      leaflet("l1", "Synthetic lichen survey", "Synthetic lichen counts on the north wall."),
      leaflet("l2", "Synthetic lichen photographs", "Synthetic photographs of lichen on oak bark.", "pending"),
      leaflet("l3", "Synthetic identification key", "A synthetic key for crustose lichen."),
      leaflet("moss", "Synthetic moss notes", "Synthetic notes on moss in a shaded garden."),
      leaflet("walk", "Synthetic transect walk", "A synthetic transect along the river path.", "pending"),
      // "saxifrage" only in the title; "Bodymarkereight" only in the body, which never enters the brain.
      { id: "outside", title: "Synthetic saxifrage notes", tier: "excluded", reason: EIGHT_REASON,
        body: [{ provenance: OWN, text: "Bodymarkereight synthetic paragraph written by someone else." }] },
      // Promoted from a note about someone else: held back from the brain and from every answer.
      { id: "promoted", title: "Synthetic promoted leaflet", tier: "pending", provenance: OTHER, body: [{ provenance: OTHER, text: "Promotedmarkereight notes about someone else." }] },
      ...round.sundew ? [leaflet("sundew", "Synthetic sundew notes", `Synthetic Sundewword notes${round.pitcher ? ", with Pitcherword added" : ""}.`)] : [],
      ...round.sedge ? [leaflet("sedge", "Synthetic sedge notes", "Synthetic Sedgeword notes.")] : [],
      ...round.venus ? [leaflet("venus", "Synthetic flytrap notes", "Synthetic Venusword notes.")] : [],
      ...round.wren ? [leaflet("wren", "Synthetic wren notes", "Synthetic Wrenword notes, edited by hand.")] : [],
      ...round.fern === "own" ? [leaflet("fern", "Synthetic fern notes", "Synthetic Fernbodyword paragraph.")] : [],
      ...round.fern === "excluded" ? [{ id: "fern", title: "Synthetic fern notes", tier: "excluded", reason: FERN_REASON,
        body: [{ provenance: OWN, text: "Synthetic Fernbodyword paragraph." }] }] : [],
    ],
  };
}

/** The SYNTHETIC harvest.json for item 8: the owner's own draft, and one on a note about someone else. */
function eightHarvest() {
  return { leafId: "synthetic-item-eight", subject: "Synthetic item eight fixture", candidates: [
    { id: "brain-note:own", title: "Synthetic lichen transect draft", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ source: "brain-note", ref: "notes/own.md", observedAt: AT, excerpt: "Synthetic lichen transect notes." }] },
    { id: "brain-note:theirs", title: "Synthetic draft on a note about someone else", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ ...OTHER, excerpt: "Theirdraftmarkereight words." }] },
  ] };
}

/** Middle value and range of a set of timings, in ms. @param {readonly number[]} values */
const spread = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return `median ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? NaN)} ms (min ${Math.round(sorted[0] ?? NaN)}, max ${Math.round(sorted.at(-1) ?? NaN)}, n=${sorted.length})`;
};

/**
 * BUILD ORDER ITEM 8, in its own garden, with the stand-in embedder on loopback. Answers whether it
 * ran: on Linux it does not, and the gate's green line says so (`greenScope`).
 * @param {GateContext} ctx
 * @returns {Promise<boolean>}
 */
export async function itemEight(ctx) {
  if (ctx.platform !== "darwin") {
    ctx.say("  --  item 8 NOT RUN on Linux: its stand-in embedder listens on the gate's loopback, which a step's empty network namespace cannot reach");
    return false;
  }
  const embedder = await startStandInEmbedder({ models: [...MODELS], synonyms: SYNONYMS });
  try { await localEmbeddings(ctx, embedder); }
  finally { await embedder.stop().catch(() => undefined); }
  return true;
}

/**
 * @param {GateContext} ctx
 * @param {import("./standin-embedder.mjs").StandInEmbedder} embedder
 */
async function localEmbeddings(ctx, embedder) {
  const g = await ctx.garden("item 8");
  const { garden, paths } = g;
  const leafFile = join(garden, "leaf.json"), harvestFile = join(garden, "harvest.json");
  const label = (/** @type {string} */ text) => `item 8: ${text}`;
  const { port } = embedder;
  /** @type {import("../../packages/photosynthesis/src/brainEmbedding.ts").LocalEmbedding} */
  const A = { provider: "ollama", model: "standin-a", port, dimensions: 64 };
  /** @type {import("../../packages/photosynthesis/src/brainEmbedding.ts").LocalEmbedding} */
  const B = { provider: "ollama", model: "standin-b", port, dimensions: 96 };
  // The planted world, plus the two switches that would send Foliage's own requests elsewhere.
  const env = { ...ctx.env, NODE_USE_ENV_PROXY: "1", OLLAMA_HOST: "example.test:11434" };
  /** A step that may reach the stand-in embedder's one loopback port, and nothing else. @type {StepOptions} */
  const near = { env, loopback: port };
  const asked = () => embedder.requests.length;
  const since = (/** @type {number} */ from) => embedder.requests.slice(from);
  /** @returns {Promise<{ mode: string, embedding?: unknown, unembedded?: true, pages: Record<string, { record?: string }> }>} */
  const manifest = async () => JSON.parse(await readFile(paths.manifest, "utf8"));
  const inode = async () => (await stat(paths.database)).ino;
  const words = (/** @type {typeof A} */ choice) => `ollama:${choice.model}, ${choice.dimensions} dimensions, at 127.0.0.1:${port}`;
  const DOWN = `Brain: broken: the local embedder at 127.0.0.1:${port} is not answering (ECONNREFUSED). Run ollama serve, or foliage brain embed --off`;

  /** Nothing an answer holds may come from gbrain, a path, an excluded body or a note about someone else. @param {string} step @param {string} text */
  const clean = (step, text) => {
    ensure(!FORBIDDEN.test(text), `${step}: a gbrain field, label or page address reached an answer`);
    ensure(!text.includes(garden) && !text.includes(ctx.dir), `${step}: a path reached an answer`);
    ensure(!/bodymarkereight|promotedmarkereight|theirdraftmarkereight/i.test(text), `${step}: excluded or third-party text reached an answer`);
  };
  /** `foliage search`, the real launcher. @param {string} text @param {string} query @param {number} limit @param {StepOptions} [options] @returns {Promise<Answer>} */
  const search = async (text, query, limit, options = {}) => {
    const ran = await g.foliage(label(text), ["search", query, "--limit", String(limit)], options);
    clean(label(text), ran.stdout);
    return JSON.parse(ran.stdout);
  };
  /** `foliage brain <args>`, whose output must be `out`. @param {string} text @param {string[]} args @param {string} out @param {StepOptions} [options] */
  const brain = async (text, args, out, options = near) => {
    const ran = await g.brain(label(text), args, options);
    ensure(ran.stdout === out, `[${label(text)}] printed ${JSON.stringify(ran.stdout)}, not ${JSON.stringify(out)}\n${ran.stderr}`);
    return ran;
  };
  /** Every hit Foliage's own search returns is there, built the same, within the limit. @param {string} text @param {Answer} answer @param {Answer} own @param {number} limit */
  const keepsOwn = (text, answer, own, limit) => {
    for (const hit of own.hits) ensure(same(answer.hits.find(other => other.id === hit.id), hit), `${text}: ${hit.id} is missing or built differently`);
    ensure(answer.hits.length <= limit, `${text}: more hits than the limit`);
  };
  /** The brain was rebuilt in local-embedding mode for `choice`, exactly as Foliage writes it. @param {string} text @param {typeof A} choice @param {number} before */
  const builtFor = async (text, choice, before) => {
    ensure(await inode() !== before, `${text}: the brain was not rebuilt and swapped in`);
    ensure(await readFile(paths.config, "utf8") === brainConfigText(paths, choice), `${text}: config.json is not Foliage's exact local-embedding file`);
    const built = await manifest();
    ensure(built.mode === "local-embedding" && same(built.embedding, choice), `${text}: the manifest does not record ${choice.model} at ${choice.dimensions} dimensions`);
    ensure(await readFile(paths.embedding, "utf8") === localEmbeddingText(choice), `${text}: the owner's choice is not what Foliage writes`);
  };
  /** gbrain embedded documents with `model` among `requests`, and nothing but the model list and embeddings was asked. @param {string} text @param {readonly { method: string, path: string, model?: string, inputs?: number, probe?: boolean }[]} requests @param {string} model */
  const embeddedWith = (text, requests, model) => {
    ensure(requests.every(request => (request.method === "GET" && request.path === "/api/tags") || (request.method === "POST" && request.path === "/v1/embeddings")),
      `${text}: the embedder was asked for something besides its model list and embeddings: ${JSON.stringify(requests.filter(request => request.path !== "/api/tags" && request.path !== "/v1/embeddings"))}`);
    const documents = requests.filter(request => request.path === "/v1/embeddings" && !request.probe);
    ensure(documents.length > 0 && documents.every(request => request.model === model), `${text}: gbrain did not embed with ${model}`);
    return documents.reduce((sum, request) => sum + (request.inputs ?? 0), 0);
  };
  /** A Foliage process, killed as it reaches `step`, running `call` against this garden. @param {string} text @param {string} step @param {string} call */
  const killedAt = async (text, step, call) => {
    const script = `const brain = await import(${JSON.stringify(join(ctx.root, "apps", "leaf", "src", "localBrain.ts"))});
      const options = { garden: ${JSON.stringify(garden)}, vendor: ${JSON.stringify(join(ctx.root, "vendor"))} };
      const run = { observe: step => { if (step === ${JSON.stringify(step)}) process.kill(process.pid, "SIGKILL"); } };
      await ${call};
      process.stdout.write("finished without reaching the step\\n");`;
    await g.node(label(text), ["--input-type=module", "-e", script], { ...near, expect: { signal: "SIGKILL" } });
  };

  await writeFile(leafFile, json(eightLeaf()));
  await writeFile(harvestFile, json(eightHarvest()));

  // 1. KEYWORD MODE, the default: a brain built without the embedder, and searches that skip it.
  await brain("build, keyword mode", ["build"], "Brain: current\n", { env });
  /** @type {Map<string, Answer>} */
  const own = new Map();
  for (const [query, limit] of QUERIES) {
    const answer = await search(`foliage search ${query}, keyword mode`, query, limit, { env, allow: { gbrain: false } });
    ensure(answer.retrieval === "foliage keyword" && answer.because === KEYWORD_MODE, `${query}, keyword mode: ${answer.retrieval} (${answer.because})`);
    own.set(query, answer);
  }
  ensure(own.get("bryophyte")?.hits.length === 0 && own.get("Bodymarkereight")?.hits.length === 0, "Foliage's own search found a word no record's searchable text holds");
  ensure(own.get("saxifrage")?.hits[0]?.snippet === EIGHT_REASON, "the excluded leaflet's title match is not its reason");
  ensure(embedder.requests.length === 0, "keyword mode asked the embedder something");

  // 2. REFUSED BEFORE ANYTHING CHANGES: a cloud name (nothing asked), a cloud entry, a model it does not hold.
  const untouched = await treeDigest(paths.brain);
  for (const [model, cause, asks] of /** @type {const} */ ([
    ["gpt-oss:20b-cloud", "gpt-oss:20b-cloud is an Ollama cloud model, which would send your record to a remote host", 0],
    ["standin-remote", "standin-remote is an Ollama cloud model (its entry names a remote host), which would send your record to a remote host", 1],
    ["standin-missing", `the embedder at 127.0.0.1:${port} does not have standin-missing, and Foliage never downloads a model`, 1],
  ])) {
    const from = asked();
    const ran = await g.brain(label(`embed --local ollama:${model}, refused`), ["embed", "--local", `ollama:${model}`, "--port", String(port)],
      { ...near, allow: { gbrain: false }, expect: { code: 1 } });
    // Node itself warns on stderr that NODE_USE_ENV_PROXY made its fetch follow the planted proxies; Foliage's line follows.
    ensure(ran.stdout === "" && ran.stderr.split("\n").some(line => line.startsWith(`foliage brain: nothing changed: ${cause}.`)), `${model}: ${ran.stdout}${ran.stderr}`);
    ensure(same(since(from).map(request => `${request.method} ${request.path}`), Array(asks).fill("GET /api/tags")), `${model}: the embedder was asked ${JSON.stringify(since(from))}`);
  }
  ensure(await treeDigest(paths.brain) === untouched, "a refused embed changed a byte under brain/");

  // 3. ON: measured, rebuilt at the model's dimensions, every page embedded with it.
  let before = await inode(), from = asked();
  await brain("embed --local ollama:standin-a", ["embed", "--local", "ollama:standin-a", "--port", String(port)],
    `Brain: current\nLocal embeddings: on (${words(A)}). foliage search and foliage_search read the brain.\n`);
  await builtFor("turning local embeddings on", A, before);
  const turnedOn = since(from);
  ensure(turnedOn.some(request => request.probe && request.model === "standin-a"), "Foliage did not measure standin-a before the rebuild");
  const pages = Object.keys((await manifest()).pages).length;
  const embedded = embeddedWith("turning local embeddings on", turnedOn, "standin-a");
  ensure(embedded >= pages, `gbrain embedded ${embedded} texts for ${pages} pages`);
  ctx.say(`      turning local embeddings on: the stand-in embedded ${embedded} texts for ${pages} pages, at 64 dimensions`);
  await brain("status, local embeddings on", ["status"], `Brain: current\nLocal embeddings: on (${words(A)})\n`);
  // A database key that could move an embedding elsewhere (hand-built: Foliage never sets it) is
  // named, removed, and keeps the brain unused until rebuilt; searches meanwhile answer without it.
  await g.direct(label("plant embedding_multimodal_model in the database"), ["--brain", "host", "config", "set", "embedding_multimodal_model", "llama-server:planted-multimodal", "--force"]);
  await brain("status with a planted embedding key", ["status"],
    `Brain: broken: the brain's database named embedding_multimodal_model, now removed; it stays unused until rebuilt. Run foliage brain rebuild\nLocal embeddings: on (${words(A)})\n`,
    { ...near, expect: { code: 1 } });
  const refusedSearch = await search("foliage search lichen, refused brain", "lichen", 10, { ...near, allow: { gbrain: false } });
  ensure(refusedSearch.retrieval === "foliage keyword" && refusedSearch.because === "Brain: broken: an earlier check refused this brain. Run foliage brain rebuild", `a refused brain answered: ${refusedSearch.because}`);
  before = await inode();
  await brain("rebuild after the refusal", ["rebuild"], "Brain: current\n");
  await builtFor("the rebuild after the refusal", A, before);

  // 4. SEARCHES READ THE BRAIN: every hit Foliage's own holds is there; the vector arm reaches a
  // page holding none of the query's words; foliage_search answers the same; so does brain search.
  /** @type {Map<string, Answer>} */
  const through = new Map();
  for (const [query, limit] of QUERIES) {
    from = asked();
    const answer = await search(`foliage search ${query}, local embeddings on`, query, limit, near);
    ensure(answer.retrieval === "brain local embedding" && answer.because === undefined, `${query}: did not read the brain: ${answer.because}`);
    keepsOwn(`foliage search ${query}`, answer, /** @type {Answer} */ (own.get(query)), limit);
    ensure(since(from).some(request => request.path === "/v1/embeddings" && request.inputs === 1 && !request.probe && request.model === "standin-a"), `${query}: gbrain did not embed the query`);
    through.set(query, answer);
  }
  ensure(through.get("bryophyte")?.hits[0]?.id === "leaflet:moss", `the vector arm did not put the moss page first for "bryophyte": ${JSON.stringify(through.get("bryophyte")?.hits.map(hit => hit.id))}`);
  ensure(same(through.get("saxifrage")?.hits.find(hit => hit.id === "leaflet:outside"), own.get("saxifrage")?.hits[0]), "the excluded leaflet is not its title and reason through the brain");
  const session = await mcpSession(ctx, g, label("MCP session, local embeddings on"), ["mcp", "--allow-search"], undefined, near);
  try {
    for (const [query, limit] of QUERIES) {
      const result = await session.call("foliage_search", { query, limit });
      ensure(!result.isError, `foliage_search ${query}: ${JSON.stringify(result)}`);
      clean(`foliage_search ${query}`, JSON.stringify(result));
      ensure(same(result.structuredContent, through.get(query)), `${query}: foliage_search and foliage search differ`);
    }
  } finally { await session.close(); }
  const brained = await g.brain(label("foliage brain search lichen, local embeddings on"), ["search", "lichen", "--limit", "10"], near);
  ensure(same(JSON.parse(brained.stdout), through.get("lichen")), "foliage brain search and foliage search differ");
  // A search through the brain on gbrain's hybrid path commits no write to it (PGLite's commit log,
  // as item 2 measures keyword search). Control: with search.track_retrieval on, the same search writes.
  const commitLog = () => treeDigest(join(paths.database, "pg_xact"));
  const quiet = await commitLog();
  /** @type {number[]} */
  const timings = [];
  for (let round = 0; round < 5; round++) {
    const began = performance.now();
    await search(`foliage search lichen, timed ${round + 1}`, "lichen", 10, near);
    timings.push(performance.now() - began);
  }
  ctx.say(`      foliage search through the brain with the STAND-IN embedder (not a real model): ${spread(timings)}`);
  ensure(await commitLog() === quiet, "a search through the brain, on gbrain's hybrid path, committed a write to it");
  await g.direct(label("control: search.track_retrieval on"), ["--brain", "host", "config", "set", "search.track_retrieval", "true"]);
  const switched = await commitLog();
  const tracked = await search("control: foliage search with tracking on", "lichen", 10, near);
  ensure(tracked.retrieval === "brain local embedding" && await commitLog() !== switched, "control: with search.track_retrieval on, the hybrid search did not write, so the commit-log check sees nothing");
  await g.gbrain(label("search.track_retrieval off again"), { kind: "config-set", key: "search.track_retrieval" });

  // 5. KEPT CURRENT: a refresh embeds what it imports; a search behind its record refreshes in place first.
  await writeFile(leafFile, json(eightLeaf({ sundew: true })));
  from = asked();
  await brain("refresh after an edit", ["refresh"], "Brain: current\n");
  embeddedWith("the refresh after an edit", since(from), "standin-a");
  const sundew = await search("foliage search Sundewword", "Sundewword", 5, near);
  ensure(sundew.retrieval === "brain local embedding" && sundew.hits[0]?.id === "leaflet:sundew", `the refreshed page is not found through the brain: ${JSON.stringify(sundew)}`);
  await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true })));
  const behind = await search("foliage search on a record that moved on", "Pitcherword", 5, near);
  ensure(behind.retrieval === "brain local embedding" && behind.hits[0]?.id === "leaflet:sundew", `the search did not refresh in place first: ${behind.because}`);

  // 5b. AN MCP SESSION, NO foliage up: a write through the agent's tools is embedded by the server's
  // own refresh; a record edited by hand meanwhile is refreshed in process before foliage_search answers.
  const agent = await mcpSession(ctx, g, label("MCP session with local embeddings on, writing"), ["mcp", "--allow-achievements", "--allow-search"], undefined, near);
  try {
    const context = await agent.call("foliage_import_context", {});
    from = asked();
    const submitted = await agent.call("foliage_submit_observations", { batch: { format: "foliage-observations", version: 1, subject: context.structuredContent.subject,
      source: { provider: "synthetic-export", tenantId: null, accountId: "synthetic-gate-eight" }, completion: "complete", deletedRecordIds: [],
      observations: [{ recordId: "synthetic-eight-record-1", revision: "synthetic-eight-revision-1", title: "Synthetic Ibisword observation",
        excerpt: "Synthetic excerpt holding Ibisword.", observedAt: new Date().toISOString() }] } });
    ensure(!submitted.isError, `foliage_submit_observations: ${JSON.stringify(submitted)}`);
    const waited = performance.now();
    while (await stat(paths.lock).then(() => true, () => false) || await brainBehind(garden)) {
      ensure(performance.now() - waited < 180_000, "the MCP server's own refresh never caught the brain up with the write");
      await sleep(100);
    }
    ctx.say(`      MCP foliage_submit_observations: brain current and embedded ${Math.round(performance.now() - waited)} ms after the tool answered`);
    embeddedWith("the MCP server's refresh after a write", since(from), "standin-a");
    const ibis = await agent.call("foliage_search", { query: "Ibisword", limit: 5 });
    clean("foliage_search Ibisword", JSON.stringify(ibis));
    ensure(!ibis.isError && ibis.structuredContent.retrieval === "brain local embedding" && ibis.structuredContent.hits.length > 0,
      `foliage_search after an MCP write: ${JSON.stringify(ibis.structuredContent)}`);
    await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true, wren: true })));
    from = asked();
    const wren = await agent.call("foliage_search", { query: "Wrenword", limit: 5 });
    clean("foliage_search Wrenword", JSON.stringify(wren));
    ensure(!wren.isError && wren.structuredContent.retrieval === "brain local embedding" && wren.structuredContent.hits[0]?.id === "leaflet:wren",
      `foliage_search on a brain behind a hand edit did not refresh in process first: ${JSON.stringify(wren.structuredContent)}`);
    embeddedWith("foliage_search's own refresh in process", since(from), "standin-a");
  } finally { await agent.close(); }

  // 6. THE EMBEDDER STOPPED: every surface answers from Foliage's own search, naming it, and starts no gbrain process.
  await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true, fern: "own" })));
  await brain("refresh with the fern leaflet", ["refresh"], "Brain: current\n");
  ensure(await holdsBytes(paths.brain, "Fernbodyword"), "control: the fern leaflet's body is not in the brain before");
  await embedder.stop();
  for (const [query, limit] of /** @type {const} */ ([["lichen", 10], ["bryophyte", 5]])) {
    const answer = await search(`foliage search ${query}, embedder stopped`, query, limit, { ...near, allow: { gbrain: false } });
    ensure(answer.retrieval === "foliage keyword" && answer.because === DOWN, `${query}, embedder stopped: ${answer.retrieval} (${answer.because})`);
    ensure(sameHits(answer.hits, own.get(query)?.hits), `${query}, embedder stopped: not Foliage's own answer`);
  }
  const stoppedSession = await mcpSession(ctx, g, label("MCP session, embedder stopped"), ["mcp", "--allow-search"], { gbrain: false }, near);
  try {
    const result = await stoppedSession.call("foliage_search", { query: "lichen", limit: 10 });
    ensure(!result.isError && result.structuredContent.because === DOWN && sameHits(result.structuredContent.hits, own.get("lichen")?.hits), `foliage_search, embedder stopped: ${JSON.stringify(result)}`);
  } finally { await stoppedSession.close(); }
  const brainDown = await g.brain(label("foliage brain search, embedder stopped"), ["search", "lichen", "--limit", "10"], { ...near, allow: { gbrain: false } });
  ensure(JSON.parse(brainDown.stdout).because === DOWN, `foliage brain search, embedder stopped: ${brainDown.stdout}`);
  await brain("status, embedder stopped", ["status"], `${DOWN}\nLocal embeddings: on (${words(A)})\n`, { ...near, expect: { code: 1 } });
  const glance = await g.foliage(label("foliage status, embedder stopped"), ["status"], { ...near, allow: { gbrain: false } });
  ensure(glance.stdout.split("\n").some(line => /^\s+BRAIN\s+/.test(line) && line.replace(/^\s+BRAIN\s+/, "") === DOWN.replace(/^Brain: /, "")),
    `foliage status did not name the stopped embedder: ${glance.stdout}`);

  // 6b. THE LAW DOES NOT WAIT FOR THE EMBEDDER: the fern leaflet newly excluded while it is stopped
  // is rebuilt out of the brain at once (its body in no page, version or byte), and the brain stays
  // behind, saying why, until the embedder is back.
  await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true, fern: "excluded" })));
  before = await inode();
  const UNEMBEDDED = `Brain: behind your record. Every page is in, but not every one is embedded yet: the local embedder at 127.0.0.1:${port} is not answering (ECONNREFUSED). Run ollama serve, or foliage brain embed --off\n`;
  await brain("refresh after a leaflet is newly excluded, embedder stopped", ["refresh"], UNEMBEDDED);
  ensure(await inode() !== before, "the newly excluded leaflet did not rebuild the brain while the embedder was stopped");
  const fernSlug = Object.entries((await manifest()).pages).find(([, page]) => page.record === "leaflet:fern")?.[0];
  ensure(fernSlug !== undefined, "the excluded leaflet has no page (its title and reason)");
  ensure(!(await holdsBytes(paths.brain, "Fernbodyword")), "the newly excluded body is still in the brain's files while the embedder was stopped");
  const fernPage = JSON.parse((await g.call(label("get_page of the newly excluded leaflet"), "get_page", { slug: fernSlug, include_deleted: true })).stdout);
  ensure(fernPage.frontmatter?.foliage_tier === "excluded" && !String(fernPage.compiled_truth).includes("Fernbodyword"), "the excluded leaflet's page holds its body");
  ensure(same(JSON.parse((await g.call(label("get_versions of the newly excluded leaflet"), "get_versions", { slug: fernSlug })).stdout), []), "the excluded leaflet still has past versions");
  ensure((await manifest()).unembedded === true, "the manifest does not say the pages wait for embeddings");
  await brain("status, pages not embedded, embedder stopped", ["status"], `${DOWN}\nLocal embeddings: on (${words(A)})\n`, { ...near, expect: { code: 1 } });
  const waiting = await search("foliage search lichen, pages not embedded, embedder stopped", "lichen", 10, { ...near, allow: { gbrain: false } });
  ensure(waiting.retrieval === "foliage keyword" && waiting.because === DOWN, `an unembedded brain was searched: ${waiting.retrieval} (${waiting.because})`);
  await embedder.start();
  from = asked();
  const back = await search("foliage search lichen, embedder back, catching up", "lichen", 10, near);
  ensure(back.retrieval === "brain local embedding", `the brain did not catch up and answer once the embedder was back: ${back.because}`);
  embeddedWith("the search's catch-up once the embedder was back", since(from), "standin-a");
  ensure((await manifest()).unembedded === undefined, "the manifest still says the pages wait for embeddings");
  const fernHit = (await search("foliage search fern, excluded", "fern", 5, near)).hits.find(hit => hit.id === "leaflet:fern");
  ensure(fernHit?.snippet === FERN_REASON && fernHit.reason === FERN_REASON, `the excluded leaflet is not its title and reason: ${JSON.stringify(fernHit)}`);

  // 6c. LISTED BUT FAILING TO EMBED (a model that fails to load answers HTTP 500): named before anything starts.
  embedder.setModels(MODELS.map(model => model.name === "standin-a" ? { ...model, failEmbeddings: true } : model));
  const failing = await search("foliage search lichen, the model failing to embed", "lichen", 10, { ...near, allow: { gbrain: false } });
  ensure(failing.retrieval === "foliage keyword"
    && failing.because === `Brain: broken: the embedder at 127.0.0.1:${port} answered HTTP 500 to POST /v1/embeddings. Run foliage brain embed --off`,
  `a model failing to embed was not named: ${failing.retrieval} (${failing.because})`);
  embedder.setModels([...MODELS]);

  // 7. THE COLUMN HAS THE MODEL'S SIZE. An embedder answering 96 dimensions for standin-a: Foliage's
  // own probe catches it (the search names it; the refresh still brings every page in and says the
  // pages wait). One answering that probe honestly but 96 to gbrain: gbrain's own check refuses it.
  embedder.setModels(MODELS.map(model => model.name === "standin-a" ? { ...model, answerDimensions: 96 } : model));
  await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true, fern: "excluded", sedge: true })));
  const resize = `standin-a now answers 96 dimensions where this garden chose 64. Run foliage brain embed --local ollama:standin-a --port ${port}`;
  const wrongSize = await search("foliage search lichen, the embedder answering 96 dimensions", "lichen", 10, { ...near, allow: { gbrain: false } });
  ensure(wrongSize.retrieval === "foliage keyword" && wrongSize.because === `Brain: broken: ${resize}`, `the wrong size was not named before the search: ${wrongSize.because}`);
  await brain("refresh, the embedder answering 96 dimensions for a 64-dimension brain", ["refresh"],
    `Brain: behind your record. Every page is in, but not every one is embedded yet: ${resize}\n`);
  embedder.setModels(MODELS.map(model => model.name === "standin-a" ? { ...model, answerDimensions: 96, probeHonest: true } : model));
  const lied = await g.brain(label("refresh, the embedder answering the probe honestly and gbrain at 96"), ["refresh"], near);
  ensure(lied.stdout.startsWith("Brain: behind your record. Every page is in, but not every one is embedded yet: gbrain embed exited 1")
    && lied.stdout.includes("returned 96 but schema expects 64"), `gbrain did not refuse the wrong size by name: ${lied.stdout}${lied.stderr}`);
  ctx.say(`      wrong size behind an honest probe, refused by gbrain: ${lied.stdout.trim()}`);
  embedder.setModels([...MODELS]);

  // 8. ANOTHER MODEL, ANOTHER SIZE: rebuilt at 96 dimensions; the record edited meanwhile comes with it.
  before = await inode();
  from = asked();
  await brain("embed --local ollama:standin-b", ["embed", "--local", "ollama:standin-b", "--port", String(port)],
    `Brain: current\nLocal embeddings: on (${words(B)}). foliage search and foliage_search read the brain.\n`);
  await builtFor("switching to standin-b", B, before);
  ctx.say(`      switching to standin-b: the stand-in embedded ${embeddedWith("switching to standin-b", since(from), "standin-b")} texts, at 96 dimensions`);
  const lichenB = await search("foliage search lichen, standin-b", "lichen", 10, near);
  ensure(lichenB.retrieval === "brain local embedding", `standin-b: ${lichenB.because}`);
  keepsOwn("foliage search lichen, standin-b", lichenB, /** @type {Answer} */ (own.get("lichen")), 10);
  const mossB = await search("foliage search bryophyte, standin-b", "bryophyte", 5, near);
  ensure(mossB.hits[0]?.id === "leaflet:moss", "standin-b: the vector arm did not put the moss page first");
  const sedge = await search("foliage search Sedgeword, standin-b", "Sedgeword", 5, near);
  ensure(sedge.hits[0]?.id === "leaflet:sedge", "the edit made while the refresh failed is not in the rebuilt brain");

  // 9. KILLED AT AN EMBEDDING STEP, THEN CONVERGED: a refresh killed before its embed, and a switch killed before the new brain's embed.
  await writeFile(leafFile, json(eightLeaf({ sundew: true, pitcher: true, sedge: true, venus: true })));
  await killedAt("a refresh killed before embed", "embed", "brain.refreshBrain(options, run)");
  from = asked();
  await brain("refresh after one killed before embed", ["refresh"], "Brain: current\n");
  embeddedWith("the refresh after one killed before embed", since(from), "standin-b");
  const venus = await search("foliage search Venusword, after the killed refresh", "Venusword", 5, near);
  ensure(venus.retrieval === "brain local embedding" && venus.hits[0]?.id === "leaflet:venus", `after the killed refresh: ${JSON.stringify(venus)}`);
  before = await inode();
  await killedAt("a switch to standin-a killed before the new brain's embed", "rebuild-embed", `brain.embedBrain(options, { model: "standin-a", port: ${port} }, run)`);
  await brain("refresh after the killed switch", ["refresh"], "Brain: current\n");
  await builtFor("the refresh after the killed switch", A, before);
  for (const path of [paths.next, paths.old, paths.lock]) ensure(!(await stat(path).then(() => true, () => false)), `${path} was left behind`);
  await brain("status after the kills", ["status"], `Brain: current\nLocal embeddings: on (${words(A)})\n`);

  // 10. OFF: rebuilt for keyword search without asking the embedder anything (this step may not reach it), and keyword reads skip the brain again.
  before = await inode();
  from = asked();
  await brain("embed --off", ["embed", "--off"], "Brain: current\nLocal embeddings: off. foliage search and foliage_search answer from Foliage's own search.\n", { env });
  ensure(asked() === from, "turning local embeddings off asked the embedder something");
  ensure(await inode() !== before, "turning local embeddings off did not rebuild the brain");
  ensure(await readFile(paths.config, "utf8") === brainConfigText(paths), "config.json is not Foliage's exact keyword-mode file");
  const keywordAgain = await manifest();
  ensure(keywordAgain.mode === "keyword" && keywordAgain.embedding === undefined, "the manifest still records local embeddings");
  ensure(!(await stat(paths.embedding).then(() => true, () => false)), "the owner's choice is still there");
  const off = await search("foliage search lichen, local embeddings off", "lichen", 10, { env, allow: { gbrain: false } });
  ensure(off.retrieval === "foliage keyword" && off.because === KEYWORD_MODE && sameHits(off.hits, own.get("lichen")?.hits), `keyword mode again: ${off.retrieval} (${off.because})`);
  await brain("status, local embeddings off", ["status"], "Brain: current\n", { env });
  await g.closed();

  ensure(embedder.requests.every(request => request.path === "/api/tags" || request.path === "/v1/embeddings"), "the embedder was asked to pull or do something else");
  ctx.say(`      the stand-in was asked ${embedder.requests.filter(request => request.path === "/api/tags").length} model lists and ${embedder.requests.filter(request => request.path === "/v1/embeddings").length} embedding requests; nothing else`);
}
