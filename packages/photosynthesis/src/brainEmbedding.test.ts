/**
 * Local embeddings, the pure part (unit 38, build order item 8): which choices Foliage makes and
 * which embedder answers it uses. Every model name and answer here is SYNTHETIC.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudModelName, embedderBaseUrl, embedderPort, embeddingChange, embeddingDimensions, embeddingWords, judgeEmbedderModels, localEmbedder, LocalEmbeddingRefusal,
  localEmbeddingText, OLLAMA_PORT, ollamaModel, parseLocalEmbedding, sameEmbedding, type LocalEmbedding,
} from "./brainEmbedding.ts";

const refused = (reason: "missing" | "cloud" | "other", pattern: RegExp) => (error: unknown) =>
  error instanceof LocalEmbeddingRefusal && error.reason === reason && pattern.test(error.message);

test("only ollama:<model> is accepted, and Ollama's cloud model names are refused before anything is asked", () => {
  assert.deepEqual(localEmbedder("ollama:nomic-embed-text"), { provider: "ollama", model: "nomic-embed-text" });
  assert.deepEqual(localEmbedder("ollama:nomic-embed-text:latest"), { provider: "ollama", model: "nomic-embed-text:latest" });
  assert.deepEqual(localEmbedder("ollama:hf.co/synthetic/embed-gguf:Q4_K_M"), { provider: "ollama", model: "hf.co/synthetic/embed-gguf:Q4_K_M" });
  for (const spec of ["openai:text-embedding-3-small", "llama-server:synthetic", "nomic-embed-text", "zeroentropyai:zembed-1"]) {
    assert.throws(() => localEmbedder(spec), refused("other", /only ollama:<model> is supported/));
  }
  for (const spec of ["ollama:", "ollama:-flag", "ollama:two words", "ollama:semi;colon", `ollama:${"x".repeat(201)}`]) {
    assert.throws(() => localEmbedder(spec), refused("other", /is not an Ollama model name/));
  }
  for (const model of ["gpt-oss:120b-cloud", "qwen3-coder:cloud", "synthetic-embed-CLOUD", "deepseek-v3.1:671b-cloud"]) {
    assert.ok(cloudModelName(model));
    assert.throws(() => localEmbedder(`ollama:${model}`), refused("cloud", /is an Ollama cloud model, which would send your record to a remote host/));
  }
  assert.ok(!cloudModelName("cloudberry-embed"), "only a -cloud or :cloud ending marks a cloud model");
});

test("the embedder is a loopback port, named by IP, never by a host name", () => {
  assert.equal(embedderPort(undefined), OLLAMA_PORT);
  assert.equal(embedderPort("4321"), 4321);
  assert.equal(embedderPort(65_535), 65_535);
  for (const bad of ["0", "65536", "-1", "12.5", "1e3", "", " 80", "0x50"]) assert.throws(() => embedderPort(bad), refused("other", /integer from 1 to 65535/));
  assert.equal(embedderBaseUrl(11_434), "http://127.0.0.1:11434/v1");
});

test("a model the embedder does not hold, or holds as a cloud model, is refused with the reason", () => {
  const tags = { models: [
    { name: "synthetic-embed:latest", model: "synthetic-embed:latest" },
    { name: "synthetic-tagged:v2", model: "synthetic-tagged:v2" },
    { name: "synthetic-remote:latest", model: "synthetic-remote:latest", remote_host: "https://remote.example.test:443", remote_model: "synthetic-remote" },
    { name: "synthetic-model-only:latest", model: "synthetic-model-only:latest", remote_model: "synthetic-model-only" },
    { name: "synthetic-renamed-cloud:latest" },
  ] };
  judgeEmbedderModels(tags, "synthetic-embed", 4321);
  judgeEmbedderModels(tags, "synthetic-embed:latest", 4321);
  judgeEmbedderModels(tags, "synthetic-tagged:v2", 4321);
  assert.throws(() => judgeEmbedderModels(tags, "synthetic-tagged", 4321), refused("missing", /127\.0\.0\.1:4321 does not have synthetic-tagged, and Foliage never downloads a model/));
  assert.throws(() => judgeEmbedderModels(tags, "nomic-embed-text", 4321), refused("missing", /never downloads a model/));
  assert.throws(() => judgeEmbedderModels(tags, "synthetic-remote", 4321), refused("cloud", /cloud model \(its entry names a remote host\)/));
  assert.throws(() => judgeEmbedderModels(tags, "synthetic-model-only", 4321), refused("cloud", /its entry names a remote model/));
  assert.throws(() => judgeEmbedderModels({ models: [{ name: "synthetic-renamed-cloud:latest" }] }, "synthetic-renamed-cloud:latest", 4321), refused("cloud", /cloud model/));
  for (const answer of [null, [], {}, { models: "x" }]) assert.throws(() => judgeEmbedderModels(answer, "synthetic-embed", 4321), refused("other", /did not answer with a list of models/));
});

test("the model's dimensions are the length of one embedding, within what a brain can hold", () => {
  assert.equal(embeddingDimensions({ data: [{ embedding: [0.1, -0.2, 0.3] }] }, 4321), 3);
  for (const answer of [{}, { data: [] }, { data: [{ embedding: [1] }, { embedding: [1] }] }, { data: [{ embedding: [1, Number.NaN] }] }, { data: [{ embedding: ["1"] }] }]) {
    assert.throws(() => embeddingDimensions(answer, 4321), refused("other", /did not answer with one embedding/));
  }
  assert.throws(() => embeddingDimensions({ data: [{ embedding: [] }] }, 4321), refused("other", /answered 0 dimensions; a brain holds 1 to 16000/));
  assert.throws(() => embeddingDimensions({ data: [{ embedding: new Array(16_001).fill(0) }] }, 4321), refused("other", /answered 16001 dimensions/));
});

test("the owner's choice is written as four keys and read back only when it is exactly Foliage's", () => {
  const choice: LocalEmbedding = { provider: "ollama", model: "synthetic-embed", port: 4321, dimensions: 64 };
  const text = localEmbeddingText(choice);
  assert.equal(text, '{\n  "provider": "ollama",\n  "model": "synthetic-embed",\n  "port": 4321,\n  "dimensions": 64\n}\n');
  assert.deepEqual(parseLocalEmbedding(JSON.parse(text)), choice);
  for (const bad of [null, [], { ...choice, extra: 1 }, { ...choice, provider: "openai" }, { ...choice, model: "x-cloud" }, { ...choice, port: 0 }, { ...choice, port: "4321" },
    { ...choice, dimensions: 0 }, { ...choice, dimensions: 1.5 }, { ...choice, dimensions: 16_001 }, { provider: "ollama", model: "synthetic-embed", port: 4321 }]) {
    assert.throws(() => parseLocalEmbedding(bad), LocalEmbeddingRefusal);
  }
  assert.equal(embeddingWords(choice), "ollama:synthetic-embed, 64 dimensions, at 127.0.0.1:4321");
});

test("turning local embeddings on, off, to another model, size or port is a change that rebuilds, named; the same choice is none", () => {
  const a: LocalEmbedding = { provider: "ollama", model: "synthetic-a", port: 4321, dimensions: 64 };
  const b: LocalEmbedding = { ...a, model: "synthetic-b", dimensions: 96 };
  assert.ok(sameEmbedding(null, null) && sameEmbedding(a, { ...a }) && !sameEmbedding(a, null) && !sameEmbedding(a, { ...a, port: 4322 }));
  assert.equal(embeddingChange(null, null), null);
  assert.equal(embeddingChange(a, { ...a }), null);
  assert.equal(embeddingChange(null, a), "local embeddings were turned on");
  assert.equal(embeddingChange(a, null), "local embeddings were turned off");
  assert.equal(embeddingChange(a, b), "the local embedding model changed");
  assert.equal(embeddingChange(a, { ...a, dimensions: 96 }), "the local embedding model's size changed");
  assert.equal(embeddingChange(a, { ...a, port: 4322 }), "the local embedder's port changed");
  // An untagged name is Ollama's `:latest`: the same model, so no rebuild.
  assert.equal(ollamaModel("synthetic-a"), "synthetic-a:latest");
  assert.equal(ollamaModel("registry.test:5000/ns/synthetic-a"), "registry.test:5000/ns/synthetic-a:latest");
  assert.equal(ollamaModel("synthetic-a:v2"), "synthetic-a:v2");
  assert.ok(sameEmbedding(a, { ...a, model: "synthetic-a:latest" }));
  assert.equal(embeddingChange(a, { ...a, model: "synthetic-a:latest" }), null);
  assert.equal(embeddingChange(a, { ...a, model: "synthetic-a:v2" }), "the local embedding model changed");
});
