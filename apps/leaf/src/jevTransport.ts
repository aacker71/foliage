/** Shared optional cloud transport. Callers must bind and authorize selected context first. */
import { TypeSafeClient } from '@typesafe-ai/sdk';

export const JEV_MODEL = 'jev-1.13.0';

/** Safe causes deliberately omit response bodies, prompts and credentials. */
export class JevUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) { super(`The TypeSafe decision did not complete: ${reason}.`); this.reason = reason; }
}

export async function withJev<T>(
  env: Readonly<Record<string, string | undefined>>,
  operation: (client: TypeSafeClient) => Promise<T>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const key = env['TYPESAFE_API_KEY']?.trim();
  if (!key) throw new JevUnavailable('TypeSafe is not configured');
  let failure = 'invalid response or connection failure';
  const client = new TypeSafeClient({
    apiKey: key, baseURL: 'https://api.typesafe.ai', defaultModel: JEV_MODEL,
    timeout: 20000, retry: { maxRetries: 0 }, logLevel: 'off',
    fetch: async (url, init) => {
      if (url !== 'https://api.typesafe.ai/v1/systemone') throw new Error('Unapproved provider destination.');
      const response = await fetcher(url, { ...init, redirect: 'error' });
      if (!response.ok) {
        failure = `provider returned HTTP ${response.status}`;
        await response.body?.cancel();
        throw new Error('Provider refused the request.');
      }
      if (!response.body) throw new Error('Empty provider response.');
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) {
            failure = 'provider response exceeded the size limit';
            throw new Error('Provider response exceeded limit.');
          }
          parts.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return new Response(Buffer.concat(parts), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  try { return await operation(client); }
  catch (error) {
    if (error instanceof Error && /timeout/i.test(error.name)) failure = 'provider timed out';
    throw new JevUnavailable(failure);
  }
}
