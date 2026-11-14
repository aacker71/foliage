/**
 * A DETERMINISTIC STAND-IN FOR A LOCAL EMBEDDER, for tests and the brain offline gate only (unit 38,
 * build order item 8). It is NOT a model and measures nothing about search quality: no embedding
 * model is installed on the machine this was built on, and none may be downloaded, so recall with a
 * real model stays unmeasured.
 *
 * It listens on 127.0.0.1 only and speaks the two endpoints Foliage and gbrain use:
 *   - `GET /api/tags`, Ollama's list of the models it holds, from `models` (an entry may be marked
 *     `remote`, the way Ollama lists a cloud model, with `remote_host` and `remote_model`);
 *   - `POST /v1/embeddings`, the OpenAI-shaped endpoint gbrain's ollama recipe calls
 *     (`@ai-sdk/openai-compatible`: `{ model, input: string[] }` in, `{ data: [{ embedding }] }` out).
 * Anything else, a pull included, is recorded and answered 404, so a test can show nobody asked.
 *
 * Its vectors are a bag of hashed words: each word (lower-cased, letters and digits) adds ±1 at a
 * position chosen by its sha256, and the sum is scaled to length 1. Texts sharing words point the
 * same way; texts sharing none are close to orthogonal. `synonyms` is a SYNTHETIC table that maps
 * one word onto another before hashing, so a test can show gbrain's vector arm reaching a page
 * that holds none of the query's words: plumbing, not recall.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * @typedef {{ name: string, dimensions: number, remote?: boolean, answerDimensions?: number, probeHonest?: boolean, failEmbeddings?: boolean }} StandInModel
 *   `answerDimensions`, when set, is what it really answers: a lying embedder, which Foliage's own
 *   one-word probe catches. With `probeHonest` too it answers that probe at `dimensions` and lies
 *   only to everything else, for the control that shows gbrain's own check refuses vectors of the
 *   wrong size. `failEmbeddings`: listed in the model list, but every embedding is an HTTP 500, the
 *   way a model that fails to load answers.
 * @typedef {{ method: string, path: string, model?: string, inputs?: number, probe?: boolean }} StandInRequest
 * @typedef {object} StandInEmbedder
 * @property {number} port  its port on 127.0.0.1
 * @property {StandInRequest[]} requests  every request, in order: the model, how many texts, and whether it was Foliage's one-word probe; never the texts
 * @property {(next: StandInModel[]) => void} setModels  replaces the models it holds and answers
 * @property {() => Promise<unknown>} stop  nothing listens on the port until `start()`
 * @property {() => Promise<void>} start  answers again, on the same port
 */

/** The bag-of-hashed-words vector of `text`. Pure. @param {string} text @param {number} dimensions @param {Readonly<Record<string, string>>} [synonyms] */
export function standInVector(text, dimensions, synonyms = {}) {
  const vector = new Array(dimensions).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const word = synonyms[raw] ?? raw;
    const digest = createHash("sha256").update(word).digest();
    vector[digest.readUInt32BE(0) % dimensions] += (digest[4] ?? 0) & 1 ? 1 : -1;
  }
  const length = Math.hypot(...vector);
  if (length === 0) { vector[0] = 1; return vector; }
  return vector.map(value => value / length);
}

/** Ollama's spelling of an untagged name. @param {string} name */
const tagged = (name) => name.slice(name.lastIndexOf("/") + 1).includes(":") ? name : `${name}:latest`;

/**
 * Starts the stand-in on 127.0.0.1 (`port` 0 picks a free one). `stop()` closes it; `start()` opens
 * it again on the same port, for the test that stops the embedder and brings it back.
 * @param {{ models: StandInModel[], synonyms?: Readonly<Record<string, string>>, port?: number }} options
 * @returns {Promise<StandInEmbedder>}
 */
export async function startStandInEmbedder({ models, synonyms = {}, port = 0 }) {
  /** @type {StandInRequest[]} */
  const requests = [];
  let current = [...models];
  const find = (/** @type {unknown} */ name) => typeof name === "string" ? current.find(model => tagged(model.name) === tagged(name)) : undefined;
  const server = createServer((req, res) => {
    const chunks = /** @type {Buffer[]} */ ([]);
    req.on("data", chunk => { chunks.push(chunk); });
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && path === "/api/tags") {
        requests.push({ method: "GET", path });
        send(200, { models: current.map(model => ({
          name: tagged(model.name), model: tagged(model.name), modified_at: "2026-10-12T00:00:00Z", size: 1, digest: "0".repeat(64),
          details: { family: "synthetic-stand-in" },
          ...model.remote ? { remote_model: model.name, remote_host: "https://remote.example.test:443" } : {},
        })) });
        return;
      }
      if (req.method === "POST" && path === "/v1/embeddings") {
        /** @type {{ model?: unknown, input?: unknown }} */
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* answered below */ }
        const inputs = typeof body.input === "string" ? [body.input] : Array.isArray(body.input) ? body.input.map(String) : [];
        const model = find(body.model);
        requests.push({ method: "POST", path, model: typeof body.model === "string" ? body.model : "?", inputs: inputs.length, probe: inputs.length === 1 && inputs[0] === "foliage" });
        if (model === undefined || model.remote) { send(404, { error: { message: `model ${JSON.stringify(body.model)} not found` } }); return; }
        if (model.failEmbeddings) { send(500, { error: { message: "synthetic stand-in: the model failed to load" } }); return; }
        const probe = inputs.length === 1 && inputs[0] === "foliage";
        const dimensions = model.probeHonest && probe ? model.dimensions : model.answerDimensions ?? model.dimensions;
        send(200, { object: "list", model: model.name,
          data: inputs.map((text, index) => ({ object: "embedding", index, embedding: standInVector(text, dimensions, synonyms) })),
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length } });
        return;
      }
      requests.push({ method: req.method ?? "?", path });
      send(404, { error: { message: "not served by the stand-in" } });
    });
  });
  /** @param {number} at @returns {Promise<number>} */
  const listen = (at) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(at, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : at);
    });
  });
  const bound = await listen(port);
  return {
    port: bound,
    requests,
    /** Replaces the models it holds and answers. @param {StandInModel[]} next */
    setModels(next) { current = [...next]; },
    /** Stops answering: nothing listens on the port until `start()`. */
    stop() {
      return new Promise(resolve => { server.close(() => resolve(undefined)); server.closeAllConnections(); });
    },
    /** Answers again, on the same port. */
    async start() { await listen(bound); },
  };
}
