import { PUBLISHED_ID, projectPublishedSearchRecords, type PublishedLeafDocument } from '@foliage/canopy';
import type { HostedStore } from './hostedStore.ts';

/** The ranker selects IDs and a text span. Every outward field is checked against the current
 * admitted document, including the excerpt, before the response is constructed. */
interface PublicSearchSelection { readonly id: string; readonly snippet: string }
export type SearchPublished = (
  document: PublishedLeafDocument, query: string, limit: number,
) => readonly PublicSearchSelection[];

type SearchReply = { readonly status: number; readonly body: string };
const reply = (status: number, code: string): SearchReply => ({ status, body: JSON.stringify({ code }) });

/** One explicitly addressed portfolio. No inventory, private fallback, index cache or provider. */
export async function hostedPublicSearch(
  url: URL, method: string, id: string,
  store: Pick<HostedStore, 'readPublic'>, search: SearchPublished | undefined,
): Promise<SearchReply> {
  if (method !== 'GET' && method !== 'HEAD') return reply(405, 'method-not-allowed');
  if (!PUBLISHED_ID.test(id)) return reply(404, 'not-found');
  const params = url.searchParams;
  if ([...params.keys()].some(key => key !== 'q' && key !== 'limit') ||
      params.getAll('q').length !== 1 || params.getAll('limit').length > 1) return reply(400, 'invalid-query');
  const query = params.get('q')!.trim(), rawLimit = params.get('limit') ?? '10';
  if (!query || query.length > 300 || Buffer.byteLength(query, 'utf8') > 512 || /[\u0000-\u001f\u007f]/.test(query) ||
      !/^(?:[1-9]|10)$/.test(rawLimit)) return reply(400, 'invalid-query');
  const limit = Number(rawLimit);
  try {
    const current = await store.readPublic(id);
    if (!current) return reply(404, 'not-found');
    if (!search) return reply(503, 'public-search-unavailable');
    const admitted = new Map(projectPublishedSearchRecords(current.document).map(record => [record.id, record]));
    const found = search(current.document, query, limit);
    if (!Array.isArray(found) || found.length > limit || found.some(hit =>
      !hit || typeof hit.id !== 'string' || hit.id.length > 512 ||
      typeof hit.snippet !== 'string' || hit.snippet.length > 320 ||
      !admitted.get(hit.id)?.text.includes(hit.snippet))) return reply(503, 'public-search-unavailable');
    const results = found.map(hit => {
      const record = admitted.get(hit.id)!;
      return { id: hit.id, title: record.title, excerpt: hit.snippet, citation: record.citation };
    });
    // Withdrawal/replacement during search invalidates the whole response, including HEAD.
    const latest = await store.readPublic(id);
    if (!latest) return reply(404, 'not-found');
    if (latest.revisionId !== current.revisionId || latest.generation !== current.generation ||
        latest.artifactDigest !== current.artifactDigest) return reply(409, 'publication-changed');
    return { status: 200, body: JSON.stringify({ portfolio: `/leaf/${id}`, revision: current.revisionId, results }) };
  } catch {
    // Neither private storage/provider diagnostics nor the query belong in public errors.
    return reply(503, 'public-search-unavailable');
  }
}
