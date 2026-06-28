import { describe, expect, it } from 'vitest';
import { KVCache } from './kv-cache.js';
import type { KVNamespace } from './kv-cache.js';

class FakeKV implements KVNamespace {
  store = new Map<string, string>();
  puts: { key: string; value: string; ttl?: number }[] = [];
  deletes: string[] = [];
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.puts.push({ key, value, ttl: options?.expirationTtl });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.deletes.push(key);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('KVCache', () => {
  it('set→get が JSON を round-trip する', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.set('users', 'byId', 5, { id: 5, name: 'a' });
    expect(await cache.get('users', 'byId', 5)).toEqual({ id: 5, name: 'a' });
  });

  it('キーは appName+version+table_type_column（number id はそのまま）', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.set('users', 'byId', 5, { x: 1 });
    expect(kv.puts[0].key).toBe('testv8_users_byId_5');
  });

  it('string id は sha256hex でハッシュ化する', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test', version: 'v9_' });
    await cache.set('users', 'byKey', 'あ', { x: 1 });
    expect(kv.puts[0].key).toBe(`testv9_users_byKey_${await sha256Hex('あ')}`);
  });

  it('lifetime は minTtl(既定60)で下限クランプ、未指定は defaultLifetime', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.set('t', 'x', 1, { a: 1 }, 10); // 10 < 60 → 60
    await cache.set('t', 'x', 2, { a: 1 }); // 未指定 → 600
    expect(kv.puts[0].ttl).toBe(60);
    expect(kv.puts[1].ttl).toBe(600);
  });

  it('falsy な data は書き込まない / get ミスは undefined', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.set('t', 'x', 1, null);
    await cache.set('t', 'x', 2, 0);
    expect(kv.puts).toHaveLength(0);
    expect(await cache.get('t', 'x', 999)).toBeUndefined();
  });

  it('delete はキーを消す', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.set('t', 'x', 1, { a: 1 });
    await cache.delete('t', 'x', 1);
    expect(await cache.get('t', 'x', 1)).toBeUndefined();
    expect(kv.deletes).toEqual(['testv8_t_x_1']);
  });

  it('setMany / getMany', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    await cache.setMany([
      { table: 't', type: 'x', id: 1, data: { v: 1 } },
      { table: 't', type: 'x', id: 2, data: { v: 2 }, lifetime: 30 },
    ]);
    expect(
      await cache.getMany<{ v: number }>([
        { table: 't', type: 'x', id: 1 },
        { table: 't', type: 'x', id: 2 },
        { table: 't', type: 'x', id: 3 },
      ]),
    ).toEqual([
      { id: 1, value: { v: 1 } },
      { id: 2, value: { v: 2 } },
      { id: 3, value: undefined },
    ]);
  });

  it('1024 バイト超のキーはキャッシュしない（cache-aside で DB 直読みに落ちる）', async () => {
    const kv = new FakeKV();
    const cache = new KVCache(kv, { appName: 'test' });
    const huge = 'x'.repeat(2000);
    await cache.set(huge, 'x', 1, { a: 1 });
    expect(kv.puts).toHaveLength(0);
    expect(await cache.get(huge, 'x', 1)).toBeUndefined();
  });
});
