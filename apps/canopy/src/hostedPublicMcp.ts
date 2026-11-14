import { McpServer, createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { PUBLISHED_ID } from "@foliage/canopy";
import { z } from "zod";
import type { HostedStore } from "./hostedStore.ts";
import { hostedPublicSearch, type SearchPublished } from "./hostedPublicSearch.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const unavailable = (status: number, code: string): Response => new Response(JSON.stringify({ code }), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function boundedRequest(request: Request): Promise<Request | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) });
}

/** One explicitly addressed public Leaf. No session, inventory, private record or write tool. */
export async function hostedPublicMcp(
  request: Request, id: string, appOrigin: string,
  store: Pick<HostedStore, "readPublic">, search: SearchPublished | undefined,
): Promise<Response> {
  if (!PUBLISHED_ID.test(id)) return unavailable(404, "not-found");
  if (request.method !== "POST") return unavailable(405, "method-not-allowed");
  if (!search) return unavailable(503, "public-search-unavailable");
  const configured = new URL(appOrigin), appHost = configured.host;
  const host = request.headers.get("host");
  if (host && host !== appHost) return unavailable(403, "origin-refused");
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== appOrigin) return unavailable(403, "origin-refused");
  const headers = new Headers(request.headers);
  headers.set("host", appHost);
  const checkedRequest = new Request(request, { headers });
  if (hostHeaderValidationResponse(checkedRequest, [configured.hostname]) ||
      originValidationResponse(checkedRequest, [configured.hostname])) return unavailable(403, "origin-refused");
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES))
    return unavailable(413, "request-too-large");

  try {
    const current = await store.readPublic(id);
    if (!current) return unavailable(404, "not-found");
    const bounded = await boundedRequest(checkedRequest);
    if (!bounded) return unavailable(413, "request-too-large");
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "foliage-public", version: "1.0.0" });
      server.registerTool("foliage_search_published", {
        title: "Search published work",
        description: "Search this person's current published Foliage page. Results cite visible work and selected context only.",
        inputSchema: z.strictObject({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(10).optional() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async ({ query, limit }) => {
        const url = new URL(`/leaf/${id}/search.json`, appOrigin);
        url.searchParams.set("q", query);
        if (limit !== undefined) url.searchParams.set("limit", String(limit));
        const answer = await hostedPublicSearch(url, "GET", id, store, search);
        return { content: [{ type: "text", text: answer.body }], ...(answer.status === 200 ? {} : { isError: true }) };
      });
      return server;
    });
    const response = await handler.fetch(bounded);
    // Finish the SDK exchange before the final authority read. A streamed response must not
    // outlive a publication that was replaced or withdrawn while its tool was running.
    const body = await response.arrayBuffer();
    await handler.close();
    if (body.byteLength > 256 * 1024) return unavailable(503, "public-search-unavailable");
    const latest = await store.readPublic(id);
    if (!latest) return unavailable(404, "not-found");
    if (latest.revisionId !== current.revisionId || latest.generation !== current.generation ||
        latest.artifactDigest !== current.artifactDigest) return unavailable(409, "publication-changed");
    const outward = new Headers(response.headers);
    outward.delete("set-cookie");
    outward.set("cache-control", "no-store");
    outward.set("vercel-cdn-cache-control", "no-store");
    outward.set("x-robots-tag", "noindex, nofollow");
    outward.set("x-content-type-options", "nosniff");
    return new Response(body, { status: response.status, headers: outward });
  } catch {
    return unavailable(503, "public-search-unavailable");
  }
}
