import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { getUserProtocol } from './user-protocol';

function fakeContext(headers: Record<string, string>): Context {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as unknown as Context;
}

describe('getUserProtocol', () => {
  it('CF-Connecting-IP を優先して使う', () => {
    const c = fakeContext({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9', 'user-agent': 'UA' });
    expect(getUserProtocol(c)).toEqual({ ipAddress: '1.2.3.4', userAgent: 'UA' });
  });

  it('CF-Connecting-IP が無ければ X-Forwarded-For にフォールバック', () => {
    const c = fakeContext({ 'x-forwarded-for': '9.9.9.9', 'user-agent': 'UA' });
    expect(getUserProtocol(c)).toEqual({ ipAddress: '9.9.9.9', userAgent: 'UA' });
  });

  it('どちらも無ければ null', () => {
    const c = fakeContext({});
    expect(getUserProtocol(c)).toEqual({ ipAddress: null, userAgent: null });
  });
});
