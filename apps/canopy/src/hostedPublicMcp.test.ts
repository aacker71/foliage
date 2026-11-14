/** Protocol inputs only; the server and client are the installed MCP SDK, on loopback. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { PUBLISHED_ARTIFACT, parsePublishedDocument } from "@foliage/canopy";
import { createNodeHandler } from "../hosted-server.mjs";
import { hostedPublicMcp } from "./hostedPublicMcp.ts";
import { searchPublished } from "./searchPublished.ts";
import type { HostedPublicRead } from "./hostedStore.ts";

const parsed = parsePublishedDocument({ artifact: PUBLISHED_ARTIFACT, artifactVersion: 3,
  publishedAt: "2026-09-08T00:00:00Z",
  source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1, policyDigest: `sha256:${"b".repeat(64)}` },
  leaf: { id: "mcp-contract", subject: "MCP contract input", subjectRedacted: false,
    leaflets: [{ id: "contract-input", title: "Published pending contract", tier: "pending", titleRedacted: false }] },
  withheld: { count: 0, kinds: [] } });
assert.ok(parsed.ok);
const publication: HostedPublicRead = { document: parsed.document, revisionId: "r1", generation: 1,
  artifactDigest: `sha256:${"c".repeat(64)}` };

test("an MCP client can search only one current public Leaf, and withdrawal removes it", async () => {
  let current: HostedPublicRead | null = publication;
  const store = { async readPublic(id: string) { assert.equal(id, "mcp-contract"); return current; } };
  let origin = "http://127.0.0.1";
  const app = (request: Request) => hostedPublicMcp(request, "mcp-contract", origin, store, searchPublished);
  const server = createServer((req, res) => { void createNodeHandler(app, origin)(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${origin}/leaf/mcp-contract/mcp`;
  const client = new Client({ name: "public-contract-client", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ["foliage_search_published"]);
    const answer = await client.callTool({ name: "foliage_search_published", arguments: { query: "pending" } });
    assert.equal(answer.isError, undefined);
    const wire = JSON.stringify(answer);
    assert.match(wire, /Published pending contract/);
    assert.match(wire, /portfolio-record-contract-input/);
    assert.doesNotMatch(wire, /score|private|excluded/);

    current = null;
    const withdrawn = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }) });
    assert.equal(withdrawn.status, 404);
    assert.doesNotMatch(await withdrawn.text(), /Published pending contract/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("a publication replaced during an MCP exchange invalidates the entire response", async () => {
  let reads = 0;
  const origin = "http://127.0.0.1";
  const request = new Request(`${origin}/leaf/mcp-contract/mcp`, { method: "POST",
    headers: { host: "127.0.0.1", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const result = await hostedPublicMcp(request, "mcp-contract", origin, {
    async readPublic() { return ++reads === 1 ? publication : { ...publication, generation: 2 }; },
  }, searchPublished);
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { code: "publication-changed" });
  assert.ok(reads >= 2);
});

test("an MCP browser request from another origin is refused before publication access", async () => {
  let reads = 0;
  const result = await hostedPublicMcp(new Request("http://127.0.0.1/leaf/mcp-contract/mcp", {
    method: "POST", headers: { origin: "http://foreign.invalid", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }), "mcp-contract", "http://127.0.0.1", {
    async readPublic() { reads++; return publication; },
  }, searchPublished);
  assert.equal(result.status, 403);
  assert.equal(reads, 0);
});
