import type { MiddlewareHandler } from 'hono';

/**
 * Compute an Express `etag`-package compatible weak ETag for a response body.
 *
 * The format is `W/"<byteLength-in-hex>-<first 27 chars of base64(sha1(body))>"`, byte-for-byte
 * identical to the weak ETag produced by the Express `etag` package. This deliberately differs
 * from `hono/etag`'s own format so responses match an Express/Nest backend exactly.
 *
 * @param body - The raw response body bytes to hash.
 * @returns The weak ETag header value (e.g. `W/"1a-Qwerty..."`).
 * @internal
 */
async function weakEtag(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', body);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  const b64 = btoa(bin).substring(0, 27);
  return `W/"${body.byteLength.toString(16)}-${b64}"`;
}

/**
 * Create a Hono middleware that finalizes responses for byte-parity with an Express/Nest backend.
 *
 * After the downstream handler runs, it performs two adjustments:
 *
 * 1. **JSON charset**: Express's `res.json` emits `application/json; charset=utf-8`, whereas Hono's
 *    `c.json` emits a bare `application/json`. A bare `application/json` content type is rewritten
 *    to include `; charset=utf-8`.
 * 2. **Weak ETag**: An Express `etag`-package compatible weak ETag is added, matching the format an
 *    Express/Nest backend applies to responses by default. See {@link weakEtag} for the exact format.
 *
 * Server-Sent Events (`text/event-stream`) are skipped entirely because the stream cannot be
 * buffered. ETag generation is also skipped for `204`/`304` responses, responses that already carry
 * an `etag` header, and responses without a body.
 *
 * @returns A {@link MiddlewareHandler} that rewrites the response headers (and body, when an ETag
 * must be computed) in place.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { finalizeResponse } from '@rdlabo/workers-hono-kit';
 *
 * const app = new Hono();
 * app.use('*', finalizeResponse());
 * app.get('/users', (c) => c.json({ ok: true }));
 * // → Content-Type: application/json; charset=utf-8
 * // → ETag: W/"b-..." (b = 0xb = 11 bytes, the length of `{"ok":true}`)
 * ```
 */
export function finalizeResponse(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const status = c.res.status;
    const contentType = c.res.headers.get('content-type') ?? '';

    // Leave SSE / streaming responses untouched.
    if (contentType.includes('text/event-stream')) {
      return;
    }

    // Charset target: add the charset when a JSON response leaves it unspecified.
    const needsCharset = contentType === 'application/json';
    // ETag target: Express omits it on 204/304 and respects an existing ETag.
    const needsEtag = status !== 204 && status !== 304 && !c.res.headers.has('etag') && !!c.res.body;

    if (!needsCharset && !needsEtag) {
      return;
    }

    const headers = new Headers(c.res.headers);
    if (needsCharset) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }

    if (needsEtag) {
      const buf = await c.res.clone().arrayBuffer();
      headers.set('ETag', await weakEtag(buf));
      c.res = new Response(buf, { status, statusText: c.res.statusText, headers });
    } else {
      // Swap only the headers without reading the body.
      c.res = new Response(c.res.body, { status, statusText: c.res.statusText, headers });
    }
  };
}
