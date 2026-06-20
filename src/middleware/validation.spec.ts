import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validate } from './validation';
import type { ValidateOptions } from './validation';

function buildApp(options?: ValidateOptions) {
  const app = new Hono();
  const schema = z.object({ name: z.string(), age: z.number() });
  app.post('/', validate('json', schema, options), (c) => c.json(c.req.valid('json')));
  const qSchema = z.object({ q: z.string() });
  app.get('/search', validate('query', qSchema, options), (c) => c.json(c.req.valid('query')));
  return app;
}

describe('validate', () => {
  it('検証成功なら handler に valid な値を渡す', async () => {
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a', age: 20 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'a', age: 20 });
  });

  it('検証失敗は NestJS ValidationPipe 同形の 400 を返す', async () => {
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }), // name 型違い + age 欠落
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { statusCode: number; message: string[]; error: string };
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Array.isArray(body.message)).toBe(true);
    // path は '.' 連結（"name: ...", "age: ..."）
    expect(body.message.some((m) => m.startsWith('name:'))).toBe(true);
    expect(body.message.some((m) => m.startsWith('age:'))).toBe(true);
  });

  it('query ターゲットでも検証できる', async () => {
    const ok = await buildApp().request('/search?q=wine');
    expect(ok.status).toBe(200);
    const ng = await buildApp().request('/search');
    expect(ng.status).toBe(400);
  });

  it('onValidationError フックが失敗時に呼ばれる（レスポンスは変えない）', async () => {
    const onValidationError = vi.fn();
    const res = await buildApp({ onValidationError }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    expect(onValidationError).toHaveBeenCalledTimes(1);
    const errArg = onValidationError.mock.calls[0][0] as { issues: unknown[] };
    expect(errArg.issues.length).toBeGreaterThan(0);
  });

  it('onValidationError が例外を投げても 400 レスポンスは不変', async () => {
    const onValidationError = vi.fn(() => {
      throw new Error('reporting blew up');
    });
    const res = await buildApp({ onValidationError }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { statusCode: number };
    expect(body.statusCode).toBe(400);
  });

  it('成功時は onValidationError を呼ばない', async () => {
    const onValidationError = vi.fn();
    await buildApp({ onValidationError }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a', age: 1 }),
    });
    expect(onValidationError).not.toHaveBeenCalled();
  });
});
