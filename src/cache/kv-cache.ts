/**
 * Workers KV を使った cache-aside キャッシュ（フリート共通 = winecode/tipsys hono の CacheService）。
 * 同一 DB を参照する透過キャッシュなので `/api` とレスポンスは一致する（perf 層であり parity に影響しない）。
 *
 * キー構成は各 repo の `/api`（旧 Valkey）と一致させる:
 *   `${appName}${version}${table}_${type}_${column}`  （column: id が string なら sha256hex、number はそのまま）
 * KV の expirationTtl は 60s 下限のため lifetime を 60 でクランプする。
 */

/** @cloudflare/workers-types の KVNamespace 最小サブセット（get/put/delete のみ使用）。 */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KVCacheOptions {
  /** キー前置（repo 名）。例 `'winecode'` / `'tipsys'`。 */
  appName: string;
  /** バージョン前置。既定 `'v8_'`。 */
  version?: string;
  /** lifetime の下限秒（KV の最小 TTL）。既定 `60`。 */
  minTtlSeconds?: number;
  /** lifetime 未指定時の既定秒。既定 `600`。 */
  defaultLifetime?: number;
}

interface CacheSetItem {
  table: string;
  type: string | number;
  id: string | number;
  data: unknown;
  lifetime?: number;
}

interface CacheKeyItem {
  table: string;
  type: string | number;
  id: string | number;
}

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class KVCache {
  readonly #kv: KVNamespace;
  readonly #appName: string;
  readonly #version: string;
  readonly #minTtl: number;
  readonly #defaultLifetime: number;

  constructor(kv: KVNamespace, options: KVCacheOptions) {
    this.#kv = kv;
    this.#appName = options.appName;
    this.#version = options.version ?? 'v8_';
    this.#minTtl = options.minTtlSeconds ?? 60;
    this.#defaultLifetime = options.defaultLifetime ?? 600;
  }

  async #buildKey(table: string, type: string | number, id: string | number): Promise<string | undefined> {
    const column = typeof id === 'string' ? await sha256Hex(id) : id;
    const key = `${this.#appName}${this.#version}${table}_${type}_${column}`;
    // KV のキーは 512〜1024 バイト上限。超えるものはキャッシュ対象外（cache-aside なので DB 直読みに落ちる）。
    if (encoder.encode(key).byteLength > 1024) {
      return undefined;
    }
    return key;
  }

  async get<T>(table: string, type: string | number, id: string | number): Promise<T | undefined> {
    const key = await this.#buildKey(table, type, id);
    if (!key) {
      return undefined;
    }
    try {
      const data = await this.#kv.get(key);
      if (!data) {
        return undefined;
      }
      return JSON.parse(data) as T;
    } catch {
      return undefined;
    }
  }

  async set(
    table: string,
    type: string | number,
    id: string | number,
    data: unknown,
    lifetime?: number,
  ): Promise<void> {
    if (!data) {
      return;
    }
    const key = await this.#buildKey(table, type, id);
    if (!key) {
      return;
    }
    let payload: string;
    try {
      payload = JSON.stringify(data);
    } catch {
      return;
    }
    const ttl = Math.max(this.#minTtl, lifetime ?? this.#defaultLifetime);
    await this.#kv.put(key, payload, { expirationTtl: ttl }).catch(() => undefined);
  }

  async setMany(items: CacheSetItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await Promise.all(items.map((i) => this.set(i.table, i.type, i.id, i.data, i.lifetime)));
  }

  // T は呼び出し側が指定する戻り値型（get<T> と同じく ergonomics 目的）。
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async getMany<T>(items: CacheKeyItem[]): Promise<{ id: string | number; value: T | undefined }[]> {
    return Promise.all(items.map(async (i) => ({ id: i.id, value: await this.get<T>(i.table, i.type, i.id) })));
  }

  async delete(table: string, type: string | number, id: string | number): Promise<void> {
    const key = await this.#buildKey(table, type, id);
    if (!key) {
      return;
    }
    await this.#kv.delete(key).catch(() => undefined);
  }
}
