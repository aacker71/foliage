/**
 * Local embeddings (unit 38, build order item 8) without a staged gbrain: what Foliage asks a
 * loopback embedder, and what the brain's commands and searches do with the answers. The embedder
 * is `tools/brain/standin-embedder.mjs`, a SYNTHETIC deterministic stand-in on 127.0.0.1 (no
 * embedding model is installed on this machine and none may be downloaded, so nothing here
 * measures search quality). "bun" is a SYNTHETIC `/bin/sh` script, never bun or gbrain. The
 * end-to-end proof with the staged gbrain, under the sandbox, is the brain offline gate's item 8
 * phase (`tools/brain/offline-embeddings.mjs`).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseLeafDocument } from "@foliage/leaf";
import { brainManifestPage, brainProjection, LocalEmbeddingRefusal, localEmbeddingText, type LocalEmbedding } from "@foliage/photosynthesis";
import { BUN_PIN, GBRAIN_PIN, hashVendorTree } from "./brainVendor.ts";
import {
  brainConfigText, brainDrift, brainGlance, brainLine, brainPaths, checkBrainConfig, embedBrain, EmbeddingRefused, gbrainArgs, LocalBrainError, localEmbeddingChoice, searchLocalBrain,
} from "./localBrain.ts";
import { checkEmbedder, EmbedderUnavailable } from "./localEmbedder.ts";
import { searchLocalGarden } from "./localSearch.ts";

const execute = promisify(execFile);

/** The stand-in embedder (`tools/brain/standin-embedder.mjs`), loaded by path: it lives with the gate it also serves. */
interface StandInModel { name: string; dimensions: number; remote?: boolean; answerDimensions?: number; probeHonest?: boolean; failEmbeddings?: boolean }
interface StandIn {
  readonly port: number;
  readonly requests: readonly { readonly method: string; readonly path: string; readonly model?: string; readonly inputs?: number; readonly probe?: boolean }[];
  setModels(next: StandInModel[]): void;
  stop(): Promise<unknown>;
  start(): Promise<void>;
}
const { startStandInEmbedder, standInVector } = await import(new URL("../../../tools/brain/standin-embedder.mjs", import.meta.url).href) as {
  startStandInEmbedder(options: { models: StandInModel[]; synonyms?: Record<string, string> }): Promise<StandIn>;
  standInVector(text: string, dimensions: number, synonyms?: Record<string, string>): number[];
};

/** `foliage brain <args>`, its exit code and output, whether or not it failed. */
async function brainCli(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try { return { code: 0, ...await execute(process.execPath, [BRAIN_CLI, ...args]) }; }
  catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return { code: typeof failed.code === "number" ? failed.code : -1, stdout: String(failed.stdout ?? ""), stderr: String(failed.stderr ?? "") };
  }
}
const EMBEDDER = fileURLToPath(new URL("./localEmbedder.ts", import.meta.url));
const BRAIN_CLI = fileURLToPath(new URL("../brain.mjs", import.meta.url));
const KEYWORD_MODE = "Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain";

const temp = async (t: { after: (fn: () => Promise<unknown>) => void }, prefix: string) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const exists = (path: string) => readdir(path).then(() => true, () => false);

/** The stand-in's SYNTHETIC models: two of different sizes, and one listed the way Ollama lists a cloud model. */
const MODELS: readonly StandInModel[] = [
  { name: "synthetic-a", dimensions: 64 }, { name: "synthetic-b", dimensions: 96 }, { name: "synthetic-remote", dimensions: 64, remote: true },
];

/** A SYNTHETIC stand-in embedder, stopped after the test. */
async function standIn(t: { after: (fn: () => Promise<unknown>) => void }, synonyms: Record<string, string> = {}) {
  const embedder = await startStandInEmbedder({ synonyms, models: MODELS.map(model => ({ ...model })) });
  t.after(() => embedder.stop().catch(() => undefined));
  return embedder;
}

test("Foliage asks a loopback embedder only whether it holds the model and how long one embedding of a fixed word is; it pulls nothing", async t => {
  const embedder = await standIn(t);
  const { port } = embedder;
  assert.equal(await checkEmbedder({ model: "synthetic-a", port }), null);
  assert.equal(await checkEmbedder({ model: "synthetic-a:latest", port, measure: true }), 64);
  assert.equal(await checkEmbedder({ model: "synthetic-b", port, measure: true }), 96);
  await assert.rejects(checkEmbedder({ model: "synthetic-missing", port, measure: true }),
    (error: unknown) => error instanceof LocalEmbeddingRefusal && error.reason === "missing" && error.message === `the embedder at 127.0.0.1:${port} does not have synthetic-missing, and Foliage never downloads a model`);
  await assert.rejects(checkEmbedder({ model: "synthetic-remote", port, measure: true }),
    (error: unknown) => error instanceof LocalEmbeddingRefusal && error.reason === "cloud" && /cloud model \(its entry names a remote host\)/.test(error.message));
  // Only the model list and the two fixed-word embeddings were asked: no pull, no record text.
  assert.deepEqual(embedder.requests.map(request => `${request.method} ${request.path}${request.model ? ` ${request.model} ${request.inputs} ${request.probe}` : ""}`), [
    "GET /api/tags", "GET /api/tags", "POST /v1/embeddings synthetic-a:latest 1 true", "GET /api/tags", "POST /v1/embeddings synthetic-b 1 true", "GET /api/tags", "GET /api/tags",
  ]);
  // Nothing listening: named, with the address and the code.
  await embedder.stop();
  await assert.rejects(checkEmbedder({ model: "synthetic-a", port }),
    (error: unknown) => error instanceof EmbedderUnavailable && error.message === `the local embedder at 127.0.0.1:${port} is not answering (ECONNREFUSED)`);
  // Something listening that never answers: named at the bound, not an empty answer.
  const silent = createServer(() => { /* never answers */ });
  await new Promise<void>(resolve => silent.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { silent.closeAllConnections(); silent.close(resolve); }));
  const address = silent.address();
  const silentPort = typeof address === "object" && address !== null ? address.port : 0;
  await assert.rejects(checkEmbedder({ model: "synthetic-a", port: silentPort, listMs: 300 }),
    (error: unknown) => error instanceof EmbedderUnavailable && error.message === `the local embedder at 127.0.0.1:${silentPort} did not answer within 0 s`);
});

test("the stand-in is deterministic, and its SYNTHETIC synonym table is plumbing, not recall", () => {
  assert.deepEqual(standInVector("Moss notes", 16), standInVector("moss  NOTES", 16));
  assert.notDeepEqual(standInVector("moss", 16), standInVector("lichen", 16));
  assert.deepEqual(standInVector("bryophyte", 16, { bryophyte: "moss" }), standInVector("moss", 16));
  assert.ok(Math.abs(Math.hypot(...standInVector("a b c d", 32)) - 1) < 1e-9);
});

test("proxies, OLLAMA_HOST and OLLAMA_BASE_URL in the environment are never used to reach the embedder", async t => {
  const embedder = await standIn(t);
  const proxied: string[] = [];
  const proxy = createServer((request, response) => { proxied.push(`${request.method} ${request.url}`); response.end("{}"); });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { proxy.closeAllConnections(); proxy.close(resolve); }));
  const address = proxy.address();
  const proxyUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  // In a child, so the planted environment is there from the start: Node's own fetch would follow
  // these (NODE_USE_ENV_PROXY=1, measured on Node 22.23); Foliage's requests must not.
  const script = `const { checkEmbedder } = await import(${JSON.stringify(new URL(`file://${EMBEDDER}`).href)});
process.stdout.write(String(await checkEmbedder({ model: "synthetic-a", port: ${embedder.port}, measure: true })));`;
  const { stdout } = await execute(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], {
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl, NO_PROXY: "",
      OLLAMA_HOST: "example.test:11434", OLLAMA_BASE_URL: "http://example.test:11434" },
    timeout: 30_000,
  });
  assert.equal(stdout, "64");
  assert.deepEqual(proxied, [], "a request went to the planted proxy");
  assert.deepEqual(embedder.requests.map(request => request.path), ["/api/tags", "/v1/embeddings"]);
});

test("local-embedding mode's config file, settings and commands: the model, its dimensions, and a base URL pinned to loopback", async t => {
  const garden = await temp(t, "foliage-embed-config-");
  const paths = brainPaths(garden);
  const choice: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: 4321, dimensions: 64 };
  assert.deepEqual(JSON.parse(brainConfigText(paths, choice)), {
    engine: "pglite", database_path: paths.database, schema_pack: "gbrain-base-v2",
    embedding_model: "ollama:synthetic-a", embedding_dimensions: 64, provider_base_urls: { ollama: "http://127.0.0.1:4321/v1" },
    self_upgrade: { mode: "off" }, mcp: { publish_skills: false, publish_advisor: false }, eval: { capture: false },
  });
  await mkdir(join(paths.home, ".gbrain"), { recursive: true });
  await writeFile(paths.config, brainConfigText(paths, choice));
  await checkBrainConfig(paths, choice);
  // The wrong mode, another base URL or another model is refused by key, never by value.
  await assert.rejects(checkBrainConfig(paths), (error: unknown) => error instanceof LocalBrainError && error.message === "config.json holds embedding_model, which Foliage never writes");
  const exact = JSON.parse(brainConfigText(paths, choice));
  for (const [key, value, cause] of [["provider_base_urls", { ollama: "http://example.test:11434/v1" }, "provider_base_urls differs"],
    ["embedding_model", "ollama:synthetic-b", "embedding_model differs"], ["embedding_dimensions", 1280, "embedding_dimensions differs"]] as const) {
    await writeFile(paths.config, JSON.stringify({ ...exact, [key]: value }, null, 2));
    await assert.rejects(checkBrainConfig(paths, choice), (error: unknown) => error instanceof LocalBrainError && error.message === `config.json ${cause} from Foliage's` && !error.message.includes("example.test"));
  }
  await writeFile(paths.config, brainConfigText(paths));
  await assert.rejects(checkBrainConfig(paths, choice), /config.json holds embedding_disabled, which Foliage never writes/);
  // init sizes the column for the model and asks it nothing; embed is only in this mode.
  assert.deepEqual(gbrainArgs(paths, { kind: "init" }, choice), ["init", "--pglite", "--embedding-model", "ollama:synthetic-a", "--embedding-dimensions", "64",
    "--skip-embed-check", "--non-interactive", "--path", paths.database]);
  assert.deepEqual(gbrainArgs(paths, { kind: "embed" }, choice), ["embed", "--stale", "--source", "default"]);
  assert.throws(() => gbrainArgs(paths, { kind: "embed" }), /gbrain embed is not a command Foliage runs in keyword mode/);
  // The search op takes gbrain's hybrid path only in this mode; every other switch is the same.
  assert.deepEqual(gbrainArgs(paths, { kind: "config-set", key: "search.mcp_keyword_only" }, choice), ["config", "set", "search.mcp_keyword_only", "false"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-set", key: "search.mcp_keyword_only" }), ["config", "set", "search.mcp_keyword_only", "true"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-set", key: "search.reranker.enabled" }, choice), ["config", "set", "search.reranker.enabled", "false"]);
  // Database keys that could move an embedding elsewhere are removed and named in this mode.
  for (const prefix of ["embedding_multimodal", "embedding_image_ocr", "embedding_columns", "search_embedding_column", "provider_base_urls.", "models."]) {
    assert.deepEqual(gbrainArgs(paths, { kind: "config-unset", prefix }, choice), ["config", "unset", "--pattern", prefix]);
  }
  assert.throws(() => gbrainArgs(paths, { kind: "config-unset", prefix: "embedding_columns" }), /not a command Foliage runs/);
  // Not the schema's own embedding_model and embedding_dimensions rows, which size nothing at runtime.
  assert.throws(() => gbrainArgs(paths, { kind: "config-unset", prefix: "embedding_" }, choice), /not a command Foliage runs/);
});

/* ---- the brain's commands and searches, with a stand-in "bun" ------------------------------- */

/** A SYNTHETIC vendor whose "bun" is `/bin/sh` running `body`, with the right pins and digests; never bun or gbrain. */
async function scriptedVendor(dir: string, body: string) {
  await mkdir(join(dir, "bun"), { recursive: true });
  await mkdir(join(dir, "gbrain", "src"), { recursive: true });
  const bun = `#!/bin/sh\n${body}`, cli = "// synthetic stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(dir, "bun", "bun"), bun);
  await chmod(join(dir, "bun", "bun"), 0o755);
  await writeFile(join(dir, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(dir, "gbrain", "LICENSE"), "synthetic licence stand-in\n");
  await writeFile(join(dir, "brain.json"), JSON.stringify({
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch, files: await hashVendorTree(dir),
  }));
}

/** SYNTHETIC: two leaflets about quillwort, and one about moss that holds none of the query's words. */
const LEAF = JSON.stringify({ id: "synthetic-embed", subject: "Synthetic subject", leaflets: [
  { id: "one", title: "Synthetic quillwort leaflet", tier: "verified", provenance: { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" },
    body: [{ provenance: { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" }, text: "Synthetic quillwort notes." }] },
  { id: "two", title: "Synthetic quillwort survey", tier: "pending", provenance: { source: "git", ref: "0000000000000000000000000000000000000002", observedAt: "2026-10-10T00:00:00Z" },
    body: [{ provenance: { source: "git", ref: "0000000000000000000000000000000000000002", observedAt: "2026-10-10T00:00:00Z" }, text: "A second synthetic quillwort survey." }] },
  { id: "moss", title: "Synthetic moss notes", tier: "verified", provenance: { source: "git", ref: "0000000000000000000000000000000000000003", observedAt: "2026-10-10T00:00:00Z" },
    body: [{ provenance: { source: "git", ref: "0000000000000000000000000000000000000003", observedAt: "2026-10-10T00:00:00Z" }, text: "Synthetic notes on moss." }] },
] });

/**
 * A garden whose brain was built from its record in `built`'s mode, by hand: the directories, the
 * exact config file, the manifest and the owner's choice (`chosen`). The stand-in "bun" answers
 * gbrain's `search` with `order` (record ids, as slugs) and notes every op it is asked.
 */
async function builtGarden(dir: string, built: LocalEmbedding | null, chosen: LocalEmbedding | null, order: readonly string[]) {
  const garden = join(dir, "garden"), vendor = join(dir, "vendor"), marker = join(dir, "stand-in-ran"), rows = join(dir, "rows.json");
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "leaf.json"), LEAF);
  const parsed = parseLeafDocument(JSON.parse(LEAF));
  assert.ok(parsed.ok);
  const pages = brainProjection({ leaf: parsed.leaf, harvest: null }).pages;
  const slug = (id: string) => pages.find(page => page.recordId === id)?.slug;
  await writeFile(rows, JSON.stringify(order.map(id => ({ slug: slug(id), score: 0.9, page_id: 7 }))));
  await scriptedVendor(vendor, `if [ "$6" = call ]; then op="$9"; else op="$6"; fi
/bin/echo "$op" >> '${marker}'
if [ "$op" = search ]; then exec /bin/cat '${rows}'; fi
exit 1
`);
  const paths = brainPaths(garden);
  for (const path of [join(paths.home, ".gbrain"), paths.tmp, paths.work, paths.bin, join(paths.pages, "foliage")]) await mkdir(path, { recursive: true });
  await writeFile(paths.config, brainConfigText(paths, built));
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 2, leafId: "synthetic-embed", subject: "Synthetic subject", leafSha256: sha(LEAF), harvestSha256: null,
    ...(built === null ? { mode: "keyword" } : { mode: "local-embedding", embedding: built }), gbrain: { ...GBRAIN_PIN },
    pages: Object.fromEntries(pages.map(page => [page.slug, brainManifestPage(page)])) }));
  if (chosen !== null) await writeFile(paths.embedding, localEmbeddingText(chosen));
  const ran = async () => (await readFile(marker, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { garden, vendor, paths, ran, leaf: join(garden, "leaf.json"), harvest: join(garden, "harvest.json") };
}

test("with local embeddings on, foliage search and foliage_search read the brain, gbrain's order first; with the embedder stopped they answer from Foliage's own search, naming it, and start nothing", async t => {
  const dir = await temp(t, "foliage-embed-search-");
  const embedder = await standIn(t);
  const choice: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: embedder.port, dimensions: 64 };
  // gbrain's fused order puts the moss page first (its vector arm), then the second quillwort leaflet.
  const g = await builtGarden(dir, choice, choice, ["leaflet:moss", "leaflet:two"]);
  assert.deepEqual(await localEmbeddingChoice(g.garden), { state: "on", choice });
  const through = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in through));
  assert.deepEqual([through.retrieval, through.because, through.hits.map(hit => hit.id)], ["brain local embedding", undefined, ["leaflet:moss", "leaflet:two", "leaflet:one"]]);
  assert.doesNotMatch(JSON.stringify(through), /"score"|page_id|foliage\/[0-9a-f]{64}/);
  assert.ok(!JSON.stringify(through).includes(dir), "a path reached the answer");
  assert.deepEqual(await g.ran(), ["search"], "only gbrain's search ran: the brain was current");
  assert.deepEqual(embedder.requests.map(request => `${request.path}${request.probe ? " probe" : ""}`), ["/api/tags", "/v1/embeddings probe"],
    "Foliage asked the embedder whether it holds the model and to embed one fixed word, and nothing else");
  // Listed but failing to embed (a model that fails to load answers HTTP 500), or answering another
  // size: named before anything starts, never left to gbrain's silent fallback to keyword search.
  const named = async (models: StandInModel[], because: string) => {
    embedder.setModels(models);
    for (const answer of [await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor }), await searchLocalBrain({ garden: g.garden, vendor: g.vendor }, "quillwort", 5)]) {
      assert.ok(!("state" in answer));
      assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)], ["foliage keyword", because, ["leaflet:one", "leaflet:two"]]);
    }
    embedder.setModels(MODELS.map(model => ({ ...model })));
  };
  await named(MODELS.map(model => model.name === "synthetic-a" ? { ...model, failEmbeddings: true } : { ...model }),
    `Brain: broken: the embedder at 127.0.0.1:${embedder.port} answered HTTP 500 to POST /v1/embeddings. Run foliage brain embed --off`);
  await named(MODELS.map(model => model.name === "synthetic-a" ? { ...model, answerDimensions: 96 } : { ...model }),
    `Brain: broken: synthetic-a now answers 96 dimensions where this garden chose 64. Run foliage brain embed --local ollama:synthetic-a --port ${embedder.port}`);
  // A model gone from the embedder: the answer an agent reads names no download.
  await named(MODELS.filter(model => model.name !== "synthetic-a").map(model => ({ ...model })),
    `Brain: broken: synthetic-a is no longer on this machine's embedder at 127.0.0.1:${embedder.port}. Run foliage brain embed --off`);
  assert.deepEqual(await g.ran(), ["search"], "a search whose embedder could not embed at the brain's size started a process");
  // The embedder stops: both surfaces answer at once from Foliage's own search, naming it, and start nothing.
  await embedder.stop();
  const down = `Brain: broken: the local embedder at 127.0.0.1:${embedder.port} is not answering (ECONNREFUSED). Run ollama serve, or foliage brain embed --off`;
  for (const answer of [await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor }), await searchLocalBrain({ garden: g.garden, vendor: g.vendor }, "quillwort", 5)]) {
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)], ["foliage keyword", down, ["leaflet:one", "leaflet:two"]]);
  }
  assert.deepEqual(await g.ran(), ["search"], "no process started while the embedder was down");
  await embedder.start();
  const again = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in again) && again.retrieval === "brain local embedding");
  // Turned off by hand (the file gone): keyword mode, Foliage's own search, nothing started.
  await unlink(g.paths.embedding);
  const off = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in off));
  assert.deepEqual([off.retrieval, off.because], ["foliage keyword", KEYWORD_MODE]);
  assert.deepEqual(await g.ran(), ["search", "search"]);
  // A choice that is not Foliage's goes to the brain, which names it.
  await writeFile(g.paths.embedding, '{"provider":"ollama","model":"x-cloud","port":11434,"dimensions":64}\n');
  const unreadable = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in unreadable));
  assert.equal(unreadable.because, "Brain: broken: embedding.json is not the local-embedding choice Foliage writes. Run foliage brain embed --off");
  assert.deepEqual(await g.ran(), ["search", "search"]);
  assert.equal(await readFile(g.leaf, "utf8"), LEAF, "a search never writes the record");
});

test("a brain built in another mode, or for another model, is behind the owner's choice: a search does not start the rebuild, and the glance and the triggers say so", async t => {
  const dir = await temp(t, "foliage-embed-mode-");
  const embedder = await standIn(t);
  const a: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: embedder.port, dimensions: 64 };
  const b: LocalEmbedding = { ...a, model: "synthetic-b", dimensions: 96 };
  for (const [name, built, chosen, change] of [["turned on", null, a, "local embeddings were turned on"], ["another model", a, b, "the local embedding model changed"]] as const) {
    const g = await builtGarden(join(dir, name.replace(" ", "-")), built, chosen, ["leaflet:one"]);
    const answer = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", `Brain: behind your record. A search does not start a rebuild (${change}). Run foliage brain refresh`]);
    assert.deepEqual(await g.ran(), [], `${name}: a search started a process`);
    assert.equal(brainLine(await brainGlance({ garden: g.garden, vendor: g.vendor })), `Brain: behind your record. ${change.charAt(0).toUpperCase()}${change.slice(1)}. Run foliage brain rebuild`);
    assert.equal((await brainDrift(g.garden)).behind, true, `${name}: the triggers would leave it`);
  }
  // Turned off: a local-embedding brain with no choice is behind too, and foliage search no longer reads it.
  const off = await builtGarden(join(dir, "turned-off"), a, null, ["leaflet:one"]);
  assert.equal((await brainDrift(off.garden)).behind, true);
  const keyword = await searchLocalGarden(off.leaf, off.harvest, "quillwort", 5, undefined, { vendor: off.vendor });
  assert.ok(!("state" in keyword) && keyword.because === KEYWORD_MODE);
  // The same choice as built is current for the triggers.
  const same = await builtGarden(join(dir, "same"), a, a, ["leaflet:one"]);
  assert.equal((await brainDrift(same.garden)).behind, false);
});

test("foliage brain embed refuses a cloud model, a model the embedder lacks, and an embedder that is not answering, before anything is made or written", async t => {
  const dir = await temp(t, "foliage-embed-refuse-");
  const embedder = await standIn(t);
  const garden = join(dir, "garden"), vendor = join(dir, "vendor"), marker = join(dir, "stand-in-ran");
  await mkdir(garden);
  await writeFile(join(garden, "leaf.json"), LEAF);
  await scriptedVendor(vendor, `/bin/echo ran >> '${marker}'\nexit 1\n`);
  const refusedWith = (message: string, fix: string) => (error: unknown) => error instanceof EmbeddingRefused && error.message === message && error.fix === fix;
  const { port } = embedder;
  await assert.rejects(embedBrain({ garden, vendor }, { model: "synthetic-remote", port }),
    refusedWith(`synthetic-remote is an Ollama cloud model (its entry names a remote host), which would send your record to a remote host`, "foliage brain embed --off"));
  await assert.rejects(embedBrain({ garden, vendor }, { model: "synthetic-missing", port }),
    refusedWith(`the embedder at 127.0.0.1:${port} does not have synthetic-missing, and Foliage never downloads a model`,
      `ollama pull synthetic-missing yourself if you want it, then foliage brain embed --local ollama:synthetic-missing --port ${port}`));
  assert.ok(!embedder.requests.some(request => request.path !== "/api/tags"), "a refused model was asked for an embedding, or something was pulled");
  await embedder.stop();
  await assert.rejects(embedBrain({ garden, vendor }, { model: "synthetic-a", port }),
    refusedWith(`the local embedder at 127.0.0.1:${port} is not answering (ECONNREFUSED)`, "ollama serve, or foliage brain embed --off"));
  assert.deepEqual(await readdir(garden), ["leaf.json"], "a refusal made a brain");
  assert.equal(await exists(marker), false, "a refusal started a process");
  // The command line refuses a cloud model's name before it asks anything, and changes nothing.
  await embedder.start();
  const before = embedder.requests.length;
  const cli = await brainCli(["embed", "--local", "ollama:gpt-oss:120b-cloud", "--port", String(port), "--garden", garden]);
  assert.deepEqual([cli.code, cli.stdout, cli.stderr], [1, "", "foliage brain: nothing changed: gpt-oss:120b-cloud is an Ollama cloud model, which would send your record to a remote host.\n"]);
  const both = await brainCli(["embed", "--local", "ollama:synthetic-missing", "--port", String(port), "--garden", garden, "--off"]);
  assert.deepEqual([both.code, both.stderr], [1, "foliage brain: brain embed needs exactly one of --local ollama:<model> or --off.\n"]);
  assert.equal(embedder.requests.length, before, "the cloud name or a bad command line reached the embedder");
  assert.deepEqual(await readdir(garden), ["leaf.json"]);
  // Off, with no brain: nothing to do, and nothing made.
  const off = await brainCli(["embed", "--off", "--garden", garden]);
  assert.deepEqual([off.code, off.stdout, off.stderr], [0, "Brain: off\nLocal embeddings: off. foliage search and foliage_search answer from Foliage's own search.\n", ""]);
  assert.deepEqual(await readdir(garden), ["leaf.json"]);
});

test("a brain whose pages are not all embedded is behind and never searched; the triggers hold back while its embedder stays down, and the glance names it", async t => {
  const dir = await temp(t, "foliage-embed-unembedded-");
  const embedder = await standIn(t);
  const a: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: embedder.port, dimensions: 64 };
  const g = await builtGarden(dir, a, a, ["leaflet:one"]);
  const manifest = JSON.parse(await readFile(g.paths.manifest, "utf8")) as Record<string, unknown>;
  await writeFile(g.paths.manifest, JSON.stringify({ ...manifest, unembedded: true }));
  assert.equal(brainLine(await brainGlance({ garden: g.garden, vendor: g.vendor })), "Brain: behind your record. Every page is in, but not every one is embedded yet. Run foliage brain refresh");
  assert.deepEqual(await brainDrift(g.garden), { behind: true });
  // The refresh that could not embed noted why (`behind`, on these bytes): the triggers hold back, and the glance says it.
  const because = `every page is in, but not every one is embedded yet: the local embedder at 127.0.0.1:${embedder.port} is not answering (ECONNREFUSED)`;
  const at = new Date().toISOString();
  await writeFile(g.paths.refreshFailure, `${JSON.stringify({ state: "behind", cause: because, fix: "ollama serve, or foliage brain embed --off", leafSha256: sha(LEAF), harvestSha256: null, at })}\n`);
  assert.deepEqual(await brainDrift(g.garden), { behind: true, stoppedAt: Date.parse(at) });
  assert.equal(brainLine(await brainGlance({ garden: g.garden, vendor: g.vendor })),
    `Brain: behind your record. Every page is in, but not every one is embedded yet: the local embedder at 127.0.0.1:${embedder.port} is not answering (ECONNREFUSED). Run ollama serve, or foliage brain embed --off`);
  // The embedder stopped: foliage status's glance says so too, as foliage brain status does.
  await embedder.stop();
  assert.equal(brainLine(await brainGlance({ garden: g.garden, vendor: g.vendor })),
    `Brain: broken: the local embedder at 127.0.0.1:${embedder.port} is not answering (ECONNREFUSED). Run ollama serve, or foliage brain embed --off`);
  const answer = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in answer) && answer.retrieval === "foliage keyword");
  assert.deepEqual(await g.ran(), [], "a search of a brain whose embedder is down started a process");
  // Only a local-embedding manifest may say so: a keyword one that does is not Foliage's.
  await writeFile(g.paths.manifest, JSON.stringify({ ...manifest, mode: "keyword", embedding: undefined, unembedded: true }));
  await unlink(g.paths.embedding);
  await writeFile(g.paths.config, brainConfigText(g.paths));
  assert.equal(brainLine(await brainGlance({ garden: g.garden, vendor: g.vendor })), "Brain: broken: manifest.json is not Foliage's. Run foliage brain rebuild");
});

test("foliage brain embed --off needs no staged runtime: the choice goes under the lock, and the brain waits behind it for a staged one", async t => {
  const dir = await temp(t, "foliage-embed-off-");
  const embedder = await standIn(t);
  const a: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: embedder.port, dimensions: 64 };
  const g = await builtGarden(dir, a, a, ["leaflet:one"]);
  await rm(g.vendor, { recursive: true, force: true });
  const before = embedder.requests.length;
  const done = await embedBrain({ garden: g.garden, vendor: g.vendor }, null);
  assert.deepEqual([done.action, done.embedding, done.brain, done.runtime?.state], ["none", null, true, "not-installed"]);
  assert.equal(await readFile(g.paths.embedding, "utf8").catch(() => null), null, "the choice is still there");
  assert.equal(embedder.requests.length, before, "turning local embeddings off asked the embedder something");
  assert.deepEqual(await localEmbeddingChoice(g.garden), { state: "off" });
  // With no runtime staged, search says no brain is installed, not keyword mode: embeddings would change nothing.
  const keyword = await searchLocalGarden(g.leaf, g.harvest, "quillwort", 5, undefined, { vendor: g.vendor });
  assert.ok(!("state" in keyword) && keyword.because === "No brain is installed: Foliage's own search answers here", JSON.stringify(keyword));
  // The built brain is now behind the choice, for the next build or refresh to rebuild in keyword mode.
  assert.equal((await brainDrift(g.garden)).behind, true);
});
