/**
 * Cache-aside helper backed by Cloudflare Workers KV.
 *
 * Provides a thin, JSON-serializing wrapper around a {@link KVNamespace} for the common
 * "look in cache, fall back to the source of truth" pattern. Reads and writes are best-effort:
 * any KV error, serialization failure, or oversized key is swallowed so callers transparently
 * fall through to their backing store instead of throwing.
 *
 * Cache keys are namespaced as `<appName><version><table>_<type>_<id>`, where a string `id` is
 * hashed with SHA-256 (hex) and a numeric `id` is used verbatim.
 *
 * @remarks
 * Workers KV enforces a 60-second minimum on `expirationTtl`, so every write clamps its lifetime
 * up to at least {@link KVCacheOptions.minTtlSeconds} (60 by default). Keys whose UTF-8 byte length
 * exceeds the KV 1024-byte limit are skipped entirely, leaving the value uncached.
 *
 * @example
 * ```ts
 * const cache = new KVCache(env.KV, { appName: 'myapp' });
 * const cached = await cache.get<User>('users', 'profile', userId);
 * if (!cached) {
 *   const user = await db.loadUser(userId);
 *   await cache.set('users', 'profile', userId, user);
 * }
 * ```
 */

/**
 * Minimal subset of `@cloudflare/workers-types`' `KVNamespace` used by {@link KVCache}.
 *
 * Declared locally so consumers are not forced to depend on `@cloudflare/workers-types`. Only the
 * three operations the cache actually needs are modeled.
 */
export interface KVNamespace {
  /**
   * Read the string value stored under `key`.
   *
   * @param key - Fully namespaced cache key.
   * @returns The stored value, or `null` when the key is absent or expired.
   */
  get(key: string): Promise<string | null>;
  /**
   * Write `value` under `key`, optionally with a time-to-live.
   *
   * @param key - Fully namespaced cache key.
   * @param value - String payload to store.
   * @param options - Optional write options; `expirationTtl` is the lifetime in seconds.
   * @returns A promise that resolves once the write is accepted.
   */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  /**
   * Remove the entry stored under `key`.
   *
   * @param key - Fully namespaced cache key.
   * @returns A promise that resolves once the delete is accepted.
   */
  delete(key: string): Promise<void>;
}

/**
 * Configuration for a {@link KVCache} instance.
 */
export interface KVCacheOptions {
  /**
   * Application-level key prefix used to isolate this app's entries within a shared namespace.
   * For example `'myapp'`.
   */
  appName: string;
  /**
   * Schema/version prefix applied after {@link appName}, letting you invalidate every key at once
   * by bumping it. Defaults to `'v8_'`.
   */
  version?: string;
  /**
   * Lower bound, in seconds, applied to every write's TTL. Matches the Workers KV 60-second
   * minimum and defaults to `60`.
   */
  minTtlSeconds?: number;
  /**
   * Default TTL, in seconds, used by {@link KVCache.set} when no per-call `lifetime` is supplied.
   * Defaults to `600`.
   */
  defaultLifetime?: number;
}

/**
 * A single entry to store via {@link KVCache.setMany}.
 *
 * @internal
 */
interface CacheSetItem {
  table: string;
  type: string | number;
  id: string | number;
  data: unknown;
  lifetime?: number;
}

/**
 * Key coordinates identifying a single entry for {@link KVCache.getMany}.
 *
 * @internal
 */
interface CacheKeyItem {
  table: string;
  type: string | number;
  id: string | number;
}

const encoder = new TextEncoder();

/**
 * Compute the lowercase hex SHA-256 digest of a UTF-8 string.
 *
 * @param input - String to hash.
 * @returns The 64-character hex-encoded digest.
 * @internal
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache-aside wrapper over a Workers {@link KVNamespace}.
 *
 * Serializes values to JSON, namespaces keys, and clamps TTLs to the KV minimum. All operations are
 * fail-soft: errors are swallowed so a cache miss or backend failure degrades to a source-of-truth
 * lookup rather than propagating.
 *
 * @example
 * ```ts
 * const cache = new KVCache(env.KV, { appName: 'myapp', defaultLifetime: 300 });
 * await cache.set('users', 'profile', 42, { name: 'Ada' });
 * const user = await cache.get<{ name: string }>('users', 'profile', 42);
 * ```
 */
export class KVCache {
  readonly #kv: KVNamespace;
  readonly #appName: string;
  readonly #version: string;
  readonly #minTtl: number;
  readonly #defaultLifetime: number;

  /**
   * Create a cache bound to a specific KV namespace.
   *
   * @param kv - The Workers KV namespace that backs this cache.
   * @param options - Key-prefix and TTL configuration; see {@link KVCacheOptions}.
   */
  constructor(kv: KVNamespace, options: KVCacheOptions) {
    this.#kv = kv;
    this.#appName = options.appName;
    this.#version = options.version ?? 'v8_';
    this.#minTtl = options.minTtlSeconds ?? 60;
    this.#defaultLifetime = options.defaultLifetime ?? 600;
  }

  /**
   * Build the fully namespaced KV key for the given coordinates.
   *
   * A string `id` is hashed with SHA-256 (hex); a numeric `id` is used as-is.
   *
   * @param table - Logical table or entity name.
   * @param type - Sub-key discriminator (e.g. lookup variant).
   * @param id - Entity identifier; strings are hashed, numbers used verbatim.
   * @returns The key, or `undefined` when it would exceed the KV 1024-byte limit.
   * @internal
   */
  async #buildKey(table: string, type: string | number, id: string | number): Promise<string | undefined> {
    const column = typeof id === 'string' ? await sha256Hex(id) : id;
    const key = `${this.#appName}${this.#version}${table}_${type}_${column}`;
    // KV keys are capped at 1024 bytes. Oversized keys are left uncached; cache-aside callers fall
    // back to reading directly from their source of truth.
    if (encoder.encode(key).byteLength > 1024) {
      return undefined;
    }
    return key;
  }

  /**
   * Read and JSON-parse a cached value.
   *
   * @typeParam T - Expected shape of the cached value.
   * @param table - Logical table or entity name.
   * @param type - Sub-key discriminator.
   * @param id - Entity identifier.
   * @returns The parsed value, or `undefined` on a miss, oversized key, or any read/parse error.
   * @example
   * ```ts
   * const user = await cache.get<User>('users', 'profile', userId);
   * ```
   */
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

  /**
   * JSON-serialize and store a value.
   *
   * Falsy `data` is ignored. The effective TTL is `max(minTtlSeconds, lifetime ?? defaultLifetime)`,
   * honoring the KV 60-second floor. Oversized keys and serialization/write failures are silently
   * skipped.
   *
   * @param table - Logical table or entity name.
   * @param type - Sub-key discriminator.
   * @param id - Entity identifier.
   * @param data - Value to cache; serialized with `JSON.stringify`.
   * @param lifetime - Optional TTL in seconds; defaults to {@link KVCacheOptions.defaultLifetime}.
   * @returns A promise that resolves once the write attempt completes.
   * @example
   * ```ts
   * await cache.set('users', 'profile', userId, user, 300);
   * ```
   */
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

  /**
   * Store many values concurrently.
   *
   * Each item is written via {@link KVCache.set}, so the same fail-soft and TTL rules apply per item.
   * An empty array is a no-op.
   *
   * @param items - Entries to store; see {@link CacheSetItem}.
   * @returns A promise that resolves once every write attempt completes.
   * @example
   * ```ts
   * await cache.setMany([
   *   { table: 'users', type: 'profile', id: 1, data: userA },
   *   { table: 'users', type: 'profile', id: 2, data: userB, lifetime: 120 },
   * ]);
   * ```
   */
  async setMany(items: CacheSetItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await Promise.all(items.map((i) => this.set(i.table, i.type, i.id, i.data, i.lifetime)));
  }

  /**
   * Read many values concurrently.
   *
   * @typeParam T - Expected shape of each cached value.
   * @param items - Key coordinates to look up; see {@link CacheKeyItem}.
   * @returns One `{ id, value }` pair per input item, preserving order; `value` is `undefined` on miss.
   * @example
   * ```ts
   * const rows = await cache.getMany<User>([
   *   { table: 'users', type: 'profile', id: 1 },
   *   { table: 'users', type: 'profile', id: 2 },
   * ]);
   * ```
   */
  // The generic `T` is the caller-specified return type, mirroring `get<T>` for ergonomics.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async getMany<T>(items: CacheKeyItem[]): Promise<{ id: string | number; value: T | undefined }[]> {
    return Promise.all(items.map(async (i) => ({ id: i.id, value: await this.get<T>(i.table, i.type, i.id) })));
  }

  /**
   * Remove a cached entry.
   *
   * Oversized keys and delete failures are silently ignored.
   *
   * @param table - Logical table or entity name.
   * @param type - Sub-key discriminator.
   * @param id - Entity identifier.
   * @returns A promise that resolves once the delete attempt completes.
   * @example
   * ```ts
   * await cache.delete('users', 'profile', userId);
   * ```
   */
  async delete(table: string, type: string | number, id: string | number): Promise<void> {
    const key = await this.#buildKey(table, type, id);
    if (!key) {
      return;
    }
    await this.#kv.delete(key).catch(() => undefined);
  }
}
