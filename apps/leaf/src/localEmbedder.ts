/**
 * ASKING A LOCAL EMBEDDER (unit 38, build order item 8; owner decision 3, 2026-10-12). Effects only:
 * what an answer means is decided in `@foliage/photosynthesis` (`brainEmbedding.ts`).
 *
 * Two questions, both to `127.0.0.1:<port>` by IP, so no name is ever looked up:
 *   - `GET /api/tags`: does the embedder already hold this model, on this machine? Ollama lists only
 *     models already pulled there, so answering it downloads nothing. A cloud entry is refused.
 *   - `POST /v1/embeddings` with one fixed word (never anything from the record), when Foliage needs
 *     to know the model embeds, at the brain's size: when local embeddings are turned on, before a
 *     rebuild or a refresh embeds, before each search, and in `foliage brain status`. It is the
 *     endpoint gbrain's ollama recipe itself calls (`@ai-sdk/openai-compatible`, `<base>/embeddings`),
 *     so a model that is listed but fails to embed (a load failure, out of memory, an HTTP 500) is
 *     caught here, by name, and never left to gbrain's silent fallback to keyword search.
 * Nothing here pulls, and nothing names Ollama's pull endpoint.
 *
 * NEVER THROUGH A PROXY. Node's own `fetch` follows `HTTP_PROXY` once `NODE_USE_ENV_PROXY=1` is set
 * (measured on Node 22.23: a loopback fetch went to a planted proxy), so these requests go through
 * `node:http` with `agent: false`, a fresh agent that reads no environment, and follow no redirect.
 * Each has a time bound and a size cap; any failure is named, never an empty answer.
 */
import { request } from "node:http";
import { embedderAddress, embeddingDimensions, judgeEmbedderModels, LocalEmbeddingRefusal } from "@foliage/photosynthesis";

/** The embedder did not answer at all: nothing listening, a reset, or past the bound. Its message names the address and the code. */
export class EmbedderUnavailable extends Error {}

/** The word embedded to measure a model's dimensions. Fixed, so nothing from a record leaves Foliage this way. */
const PROBE_TEXT = "foliage";

/**
 * How long the model list may take, and an embedding (a model that is not yet loaded loads first;
 * Ollama unloads an idle one after about five minutes, by its own default). Not measured with a real
 * model: none is installed on the machine this was built on.
 */
const LIST_MS = 3_000;
const EMBED_MS = 60_000;

/** One JSON request to the embedder on loopback, or a named failure. */
function loopbackJson(port: number, method: "GET" | "POST", path: string, body: unknown, timeoutMs: number, cap: number): Promise<unknown> {
  const where = embedderAddress(port);
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    let settled = false;
    const done = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const req = request({
      host: "127.0.0.1", family: 4, port, path, method, agent: false,
      headers: { accept: "application/json", ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": String(payload.length) }) },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > cap) { req.destroy(); done(new LocalEmbeddingRefusal(`the embedder at ${where} answered more than ${cap} bytes to ${path}`)); }
        else chunks.push(chunk);
      });
      response.on("error", () => done(new EmbedderUnavailable(`the local embedder at ${where} stopped while answering`)));
      response.on("end", () => {
        if (response.statusCode !== 200) {
          done(new LocalEmbeddingRefusal(`the embedder at ${where} answered HTTP ${response.statusCode ?? "?"} to ${method} ${path}`));
          return;
        }
        try { done(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { done(new LocalEmbeddingRefusal(`the embedder at ${where} did not answer ${path} in JSON`)); }
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      done(new EmbedderUnavailable(`the local embedder at ${where} did not answer within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    req.on("error", error => {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "no answer";
      done(new EmbedderUnavailable(`the local embedder at ${where} is not answering (${code})`));
    });
    req.end(payload);
  });
}

export interface EmbedderQuestion {
  readonly model: string;
  readonly port: number;
  /** Also embed one fixed word, and answer its length. */
  readonly measure?: boolean;
  /** The bound on the model list; tests shorten it. */
  readonly listMs?: number;
  /** The bound on the one embedding (`measure`): a minute when the mode is turned on or a brain rebuilt, a search's own bound before a search. */
  readonly embedMs?: number;
}

/**
 * The embedder on `127.0.0.1:<port>` answers and already holds `model` on this machine, or a named
 * failure (`EmbedderUnavailable`, `LocalEmbeddingRefusal`). With `measure`, the model's dimensions
 * from one embedding; otherwise null.
 */
export async function checkEmbedder({ model, port, measure = false, listMs = LIST_MS, embedMs = EMBED_MS }: EmbedderQuestion): Promise<number | null> {
  judgeEmbedderModels(await loopbackJson(port, "GET", "/api/tags", undefined, listMs, 4 * 1024 * 1024), model, port);
  if (!measure) return null;
  const answer = await loopbackJson(port, "POST", "/v1/embeddings", { model, input: [PROBE_TEXT], encoding_format: "float" }, embedMs, 8 * 1024 * 1024);
  return embeddingDimensions(answer, port);
}
