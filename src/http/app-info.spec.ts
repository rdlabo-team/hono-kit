import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { getAppInfo } from './app-info.js';

function fakeContext(headers: Record<string, string>): Context {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Context;
}

describe('getAppInfo', () => {
  it('x-amz-meta-version / x-amz-meta-uuid を読む', () => {
    const c = fakeContext({ 'x-amz-meta-version': '1.2.3', 'x-amz-meta-uuid': 'abc' });
    expect(getAppInfo(c)).toEqual({ version: '1.2.3', uuid: 'abc' });
  });

  it('無ければ null', () => {
    expect(getAppInfo(fakeContext({}))).toEqual({ version: null, uuid: null });
  });
});
