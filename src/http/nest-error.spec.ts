import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describe, expect, it, vi } from 'vitest';
import { createNestErrorHandler, nestNotFoundHandler, NEST_REASON_PHRASES } from './nest-error.js';
import type { NestErrorHandlerOptions } from './nest-error.js';

function buildApp(options?: NestErrorHandlerOptions) {
  const app = new Hono();
  app.onError(createNestErrorHandler(options));
  app.notFound(nestNotFoundHandler);
  app.get('/forbidden', () => {
    throw new HTTPException(403, { message: 'Forbidden resource' });
  });
  app.get('/unauthorized', () => {
    throw new HTTPException(401, { message: 'Unauthorized' });
  });
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: "I'm a teapot" });
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return app;
}

describe('createNestErrorHandler', () => {
  it('既定: 非 bare の HTTPException を statusCode-first の Nest body にマップする', async () => {
    const res = await buildApp().request('/forbidden');
    expect(res.status).toBe(403);
    // フィールド順序まで固定（byte-parity）。
    expect(await res.text()).toBe('{"statusCode":403,"message":"Forbidden resource","error":"Forbidden"}');
  });

  it('401（bareStatuses 既定）は error フィールドを持たない', async () => {
    const res = await buildApp().request('/unauthorized');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"statusCode":401,"message":"Unauthorized"}');
  });

  it('reason phrase が無い status は bare body（statusCode, message のみ）', async () => {
    const res = await buildApp().request('/teapot');
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ statusCode: 418, message: "I'm a teapot" });
  });

  it('非 HTTPException は onUnhandledError 通報後に 500 を返す', async () => {
    const onUnhandledError = vi.fn();
    const res = await buildApp({ onUnhandledError }).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(onUnhandledError).toHaveBeenCalledOnce();
    expect((onUnhandledError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('通報フックが throw してもエラーレスポンスは変わらない', async () => {
    const onUnhandledError = () => {
      throw new Error('reporter exploded');
    };
    const res = await buildApp({ onUnhandledError }).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it("fieldOrder:'message-first' は foodlabel の { message, error, statusCode } を維持する", async () => {
    const res = await buildApp({ fieldOrder: 'message-first' }).request('/forbidden');
    expect(await res.text()).toBe('{"message":"Forbidden resource","error":"Forbidden","statusCode":403}');
  });

  it('カスタム isHttpError と body 脱出口（winecode HttpError 相当）を verbatim で返す', async () => {
    class HttpError extends Error {
      constructor(
        readonly status: ContentfulStatusCode,
        message?: string,
        readonly body?: unknown,
      ) {
        super(message);
      }
    }
    const app = new Hono();
    app.onError(createNestErrorHandler({ isHttpError: (e): e is HttpError => e instanceof HttpError }));
    app.get('/forbidden', () => {
      throw new HttpError(403, 'Forbidden resource');
    });
    app.get('/login-401', () => {
      throw new HttpError(401, 'x', { message: 'Unauthorized', statusCode: 401 });
    });

    const mapped = await app.request('/forbidden');
    expect(mapped.status).toBe(403);
    expect(await mapped.json()).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' });

    const verbatim = await app.request('/login-401');
    expect(verbatim.status).toBe(401);
    expect(await verbatim.json()).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });

  it('reasonPhrases を上書きできる', async () => {
    const res = await buildApp({ reasonPhrases: { ...NEST_REASON_PHRASES, 403: 'Nope' } }).request('/forbidden');
    expect(await res.json()).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Nope' });
  });

  it('bareStatuses に追加した status は error フィールドを落とす', async () => {
    const res = await buildApp({ bareStatuses: [401, 403] }).request('/forbidden');
    expect(await res.json()).toEqual({ statusCode: 403, message: 'Forbidden resource' });
  });

  it('internalServerErrorBody を上書きできる', async () => {
    const res = await buildApp({ internalServerErrorBody: { statusCode: 500, message: 'oops' } }).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'oops' });
  });

  it('fallbackReason + bareStatuses:[] で全 status に error を付ける（winecode 形）', async () => {
    const app = buildApp({ bareStatuses: [], fallbackReason: 'Error' });
    // reasonPhrase 有り（403）
    expect(await (await app.request('/forbidden')).json()).toEqual({
      statusCode: 403,
      message: 'Forbidden resource',
      error: 'Forbidden',
    });
    // reasonPhrase 無し（418）→ fallback 'Error'
    expect(await (await app.request('/teapot')).json()).toEqual({
      statusCode: 418,
      message: "I'm a teapot",
      error: 'Error',
    });
    // bareStatuses:[] なので 401 も error を持つ
    expect(await (await app.request('/unauthorized')).json()).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    });
  });
});

describe('nestNotFoundHandler', () => {
  it('Express/Nest 既定の 404 body（Cannot METHOD path）を返す', async () => {
    const res = await buildApp().request('/does/not/exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      message: 'Cannot GET /does/not/exist',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('メソッドとパスを反映する', async () => {
    const res = await buildApp().request('/missing', { method: 'POST' });
    expect(await res.json()).toMatchObject({ message: 'Cannot POST /missing' });
  });
});
