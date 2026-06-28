import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { finalizeResponse } from './finalize-response.js';

// Express の `etag` パッケージと同じ算法を Node crypto で独立に再現（impl は Web Crypto + btoa）。
// 両者が一致することで Express/Nest とのバイト一致を裏取りする。
function expressWeakEtag(body: string): string {
  const len = Buffer.byteLength(body, 'utf8');
  const hash = createHash('sha1').update(body, 'utf8').digest('base64').substring(0, 27);
  return `W/"${len.toString(16)}-${hash}"`;
}

function buildApp() {
  const app = new Hono();
  app.use('*', finalizeResponse());
  app.get('/json', (c) => c.body('{"a":1}', 200, { 'content-type': 'application/json' }));
  app.get('/text', (c) => c.body('hello', 200, { 'content-type': 'text/plain' }));
  app.get('/empty-json', (c) => c.body('', 200, { 'content-type': 'application/json' }));
  app.get('/204', (c) => c.body(null, 204, { 'content-type': 'application/json' }));
  app.get('/304', (c) => c.body(null, 304, { 'content-type': 'application/json' }));
  app.get('/sse', (c) => c.body('data: x\n\n', 200, { 'content-type': 'text/event-stream' }));
  app.get('/preset-etag', (c) => c.body('{"a":1}', 200, { 'content-type': 'application/json', etag: 'W/"keep-me"' }));
  return app;
}

describe('finalizeResponse', () => {
  it('JSON に charset を補正し、Express 互換の weak ETag を付与する', async () => {
    const res = await buildApp().request('/json');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('etag')).toBe(expressWeakEtag('{"a":1}'));
    expect(res.headers.get('etag')).toBe('W/"7-n4nHQM60bXQYySSnisV5QdXpZSA"');
    expect(await res.text()).toBe('{"a":1}'); // body は不変
  });

  it('非 JSON（text/plain）でも ETag は付与し、charset は変えない', async () => {
    const res = await buildApp().request('/text');
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('etag')).toBe(expressWeakEtag('hello'));
  });

  it('空 body の JSON は charset 補正し、空文字の Express 互換 ETag を付ける', async () => {
    const res = await buildApp().request('/empty-json');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    // Express も空 body に W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk" を付与する。
    expect(res.headers.get('etag')).toBe(expressWeakEtag(''));
  });

  it('body が無い（null）レスポンスには ETag を付けない', async () => {
    const app = new Hono();
    app.use('*', finalizeResponse());
    app.get('/no-body', (c) => c.body(null, 200, { 'content-type': 'application/json' }));
    const res = await app.request('/no-body');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('204 / 304 では ETag を付けない（Express と同じ）', async () => {
    const r204 = await buildApp().request('/204');
    const r304 = await buildApp().request('/304');
    expect(r204.headers.get('etag')).toBeNull();
    expect(r304.headers.get('etag')).toBeNull();
  });

  it('SSE（text/event-stream）は一切触らない', async () => {
    const res = await buildApp().request('/sse');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('既存の ETag は尊重して上書きしない', async () => {
    const res = await buildApp().request('/preset-etag');
    expect(res.headers.get('etag')).toBe('W/"keep-me"');
  });
});
