/**
 * LOCAL EMBEDDINGS FOR A GARDEN'S BRAIN, THE PURE PART (unit 38, build order item 8; spec PR #201).
 * No file access, no network: `apps/leaf/src/localEmbedder.ts` asks the embedder and
 * `apps/leaf/src/localBrain.ts` writes and rebuilds; this decides what their answers mean.
 *
 * OWNER DECISION 3 (2026-10-12): keyword-only by default. Local embeddings only when the owner turns
 * them on for a garden and a loopback embedder already holds the model and is answering. Foliage
 * never downloads a model and never pulls one. So:
 *   - only `ollama:<model>` is accepted, and a name Ollama gives its cloud models (ending `-cloud`
 *     or `:cloud`) is refused before anything is asked;
 *   - the embedder is asked by IP on loopback, `127.0.0.1:<port>`, never by name, and gbrain's
 *     base URL is pinned to that same address;
 *   - the model must be among those the embedder already holds (`/api/tags`), and an entry that
 *     names a remote host or remote model (how Ollama lists a cloud model) is refused;
 *   - the model's dimensions are measured from one embedding of a fixed word, not taken from a name.
 * The owner's choice lives in `brain/embedding.json` (`localEmbeddingText`); the brain is derived
 * data, so deleting `brain/` also turns local embeddings off.
 */

/** The owner's choice for one garden: which local model, on which loopback port, at how many dimensions. */
export interface LocalEmbedding {
  readonly provider: "ollama";
  readonly model: string;
  readonly port: number;
  readonly dimensions: number;
}

/** Ollama's own port. */
export const OLLAMA_PORT = 11434;

/** gbrain's cap on an embedding column (`PGVECTOR_COLUMN_MAX_DIMS`, `src/core/embedding-dim-check.ts:50`). */
export const EMBEDDING_DIMENSIONS_MAX = 16_000;

/**
 * A choice Foliage will not make, or an answer it will not use. Its message is the whole cause,
 * free of paths; `reason` says which kind, so the caller can name the fix.
 */
export class LocalEmbeddingRefusal extends Error {
  readonly reason: "missing" | "cloud" | "other";
  constructor(message: string, reason: "missing" | "cloud" | "other" = "other") {
    super(message);
    this.reason = reason;
  }
}

/**
 * An Ollama model name: letters, digits and `. _ - / :` (a namespace, a tag, or a registry's host
 * for weights already on this machine), at most 200 characters, starting with a letter or digit.
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,199}$/;

/**
 * How Ollama names a model it runs on its own servers, not on this machine: a name or tag ending
 * `-cloud` or `:cloud` (`gpt-oss:120b-cloud`, `qwen3-coder:cloud`), with or without the `:latest`
 * Ollama adds to an untagged name. Refused on the name alone, before anything is asked.
 */
export const cloudModelName = (model: string) => /(?:-|:)cloud(?::latest)?$/i.test(model);

/** `ollama:<model>` as the owner typed it, or a refusal before anything is asked. */
export function localEmbedder(spec: string): { readonly provider: "ollama"; readonly model: string } {
  const at = spec.indexOf(":");
  const provider = at < 0 ? spec : spec.slice(0, at), model = at < 0 ? "" : spec.slice(at + 1);
  if (provider !== "ollama") throw new LocalEmbeddingRefusal(`only ollama:<model> is supported, not ${JSON.stringify(spec.slice(0, 80))}`);
  if (!MODEL_NAME.test(model)) throw new LocalEmbeddingRefusal(`${JSON.stringify(model.slice(0, 80))} is not an Ollama model name`);
  if (cloudModelName(model)) throw new LocalEmbeddingRefusal(`${model} is an Ollama cloud model, which would send your record to a remote host`, "cloud");
  return { provider: "ollama", model };
}

/** A loopback port, 1 to 65535. */
export function embedderPort(value: string | number | undefined): number {
  if (value === undefined) return OLLAMA_PORT;
  const text = String(value);
  const port = Number(text);
  if (!/^\d{1,5}$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65_535) throw new LocalEmbeddingRefusal("the embedder's port must be an integer from 1 to 65535");
  return port;
}

/** Where the embedder is asked, in words: always loopback, by IP. */
export const embedderAddress = (port: number) => `127.0.0.1:${port}`;

/** The base URL gbrain's ollama recipe is pinned to in config.json: loopback, by IP, never a name. */
export const embedderBaseUrl = (port: number) => `http://${embedderAddress(port)}/v1`;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** `name`, plus `name:latest` when it carries no tag: how Ollama lists an untagged name. */
function spellings(model: string): readonly string[] {
  const tail = model.slice(model.lastIndexOf("/") + 1);
  return tail.includes(":") ? [model] : [model, `${model}:latest`];
}

/**
 * What the embedder's `GET /api/tags` says about `model`: present on this machine, or a refusal
 * naming why. Only models already held are listed there; nothing is pulled to answer it. An entry
 * carrying `remote_host` or `remote_model`, or named as a cloud model, runs elsewhere and is
 * refused.
 */
export function judgeEmbedderModels(answer: unknown, model: string, port: number): void {
  const models = record(answer)?.["models"];
  if (!Array.isArray(models)) throw new LocalEmbeddingRefusal(`the embedder at ${embedderAddress(port)} did not answer with a list of models`);
  const names = spellings(model);
  const entry = models.map(record).find(found => found !== null && names.some(name => found["name"] === name || found["model"] === name));
  if (entry === undefined || entry === null) {
    throw new LocalEmbeddingRefusal(`the embedder at ${embedderAddress(port)} does not have ${model}, and Foliage never downloads a model`, "missing");
  }
  const remote = ["remote_host", "remote_model"].find(key => entry[key] !== undefined && entry[key] !== null && entry[key] !== "");
  if (remote !== undefined || cloudModelName(String(entry["name"] ?? "")) || cloudModelName(String(entry["model"] ?? ""))) {
    throw new LocalEmbeddingRefusal(`${model} is an Ollama cloud model${remote === undefined ? "" : ` (its entry names a ${remote.replace("_", " ")})`}, which would send your record to a remote host`, "cloud");
  }
}

/** The length of the one embedding in an OpenAI-shaped `/v1/embeddings` answer, the endpoint gbrain's ollama recipe calls. */
export function embeddingDimensions(answer: unknown, port: number): number {
  const data = record(answer)?.["data"];
  const vector = Array.isArray(data) && data.length === 1 ? record(data[0])?.["embedding"] : undefined;
  if (!Array.isArray(vector) || !vector.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new LocalEmbeddingRefusal(`the embedder at ${embedderAddress(port)} did not answer with one embedding`);
  }
  if (vector.length < 1 || vector.length > EMBEDDING_DIMENSIONS_MAX) {
    throw new LocalEmbeddingRefusal(`the embedder at ${embedderAddress(port)} answered ${vector.length} dimensions; a brain holds 1 to ${EMBEDDING_DIMENSIONS_MAX}`);
  }
  return vector.length;
}

const KEYS = ["provider", "model", "port", "dimensions"] as const;

/** `brain/embedding.json` as Foliage writes it: these four keys, in this order. */
export function localEmbeddingText(choice: LocalEmbedding): string {
  return `${JSON.stringify(Object.fromEntries(KEYS.map(key => [key, choice[key]])), null, 2)}\n`;
}

/** A choice read back (from `brain/embedding.json` or a manifest), or a refusal: exactly these four keys, each valid. */
export function parseLocalEmbedding(value: unknown): LocalEmbedding {
  const found = record(value);
  if (found === null || Object.keys(found).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(found, key))) {
    throw new LocalEmbeddingRefusal("it is not the local-embedding choice Foliage writes");
  }
  const { model, port, dimensions } = found;
  if (found["provider"] !== "ollama" || typeof model !== "string" || typeof port !== "number" || typeof dimensions !== "number") {
    throw new LocalEmbeddingRefusal("it is not the local-embedding choice Foliage writes");
  }
  localEmbedder(`ollama:${model}`);
  if (embedderPort(port) !== port) throw new LocalEmbeddingRefusal("it is not the local-embedding choice Foliage writes");
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > EMBEDDING_DIMENSIONS_MAX) throw new LocalEmbeddingRefusal("its dimensions are out of range");
  return { provider: "ollama", model, port, dimensions };
}

/** Ollama's own spelling of a model name: an untagged name is `<name>:latest`, the same model. */
export const ollamaModel = (model: string) => spellings(model).at(-1) ?? model;

/** Whether two choices (or keyword mode, null) are the same; `m` and `m:latest` are one model. */
export const sameEmbedding = (a: LocalEmbedding | null, b: LocalEmbedding | null) =>
  a === null || b === null ? a === b
    : a.provider === b.provider && a.port === b.port && a.dimensions === b.dimensions && ollamaModel(a.model) === ollamaModel(b.model);

/** The choice in words, for a status line: never a path. */
export const embeddingWords = (choice: LocalEmbedding) =>
  `ollama:${choice.model}, ${choice.dimensions} dimensions, at ${embedderAddress(choice.port)}`;

/**
 * Why a brain built in one mode is not the brain the owner chose, or null when it is. Turning local
 * embeddings on or off, or changing the model, rebuilds the brain: the embedding column is sized at
 * init (a keyword brain's at gbrain's default 1280), and gbrain refuses a model of another size.
 * The same model measured at another size is its own cause. So is another port: config.json names
 * the embedder's address, so the brain is rebuilt with it, every page embedded again (not worth a
 * second path for a change this rare), and the words say it was only the port.
 */
export function embeddingChange(built: LocalEmbedding | null, chosen: LocalEmbedding | null): string | null {
  if (sameEmbedding(built, chosen)) return null;
  if (built === null) return "local embeddings were turned on";
  if (chosen === null) return "local embeddings were turned off";
  if (ollamaModel(built.model) !== ollamaModel(chosen.model)) return "the local embedding model changed";
  if (built.dimensions !== chosen.dimensions) return "the local embedding model's size changed";
  return "the local embedder's port changed";
}
