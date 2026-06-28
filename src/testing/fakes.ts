import type { Pool } from 'mysql2/promise';
import { databaseFrom } from '../db/database.js';
import type { DisposableDatabase } from '../db/database.js';
import type { DecodedIdToken, FirebaseVerifier } from '../firebase/firebase-verifier.js';

/**
 * オフライン route テスト用の in-memory FirebaseVerifier（4 repo 同一実装を集約）。
 * `register(token, { uid })` で偽 ID を仕込む。
 */
export class FakeFirebaseVerifier implements FirebaseVerifier {
  private readonly tokens = new Map<string, DecodedIdToken>();
  readonly deleted: string[] = [];

  register(token: string, record: DecodedIdToken): void {
    this.tokens.set(token, record);
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    const record = this.tokens.get(idToken);
    if (!record) {
      throw new Error('invalid firebase id token');
    }
    return record;
  }

  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    return { uid };
  }

  async deleteUser(uid: string): Promise<void> {
    this.deleted.push(uid);
  }
}

export interface CreatePoolDatabaseOptions<TDrizzle> {
  /** テスト用プール（primary/replica 兼用）。 */
  pool: Pool;
  /** 消費側の drizzle-orm で `drizzle(pool, { schema, ... })` を作って渡す。 */
  orm: TDrizzle;
}

/**
 * テスト用にプール 1 本を primary/replica 兼用にした Database（foodlabel の PoolDatabase 相当）。
 * `dispose()` はプールを閉じる。orm は消費側が自分の drizzle-orm で作って渡す（型同一性の分離）。
 */
export function createPoolDatabase<TDrizzle>(
  options: CreatePoolDatabaseOptions<TDrizzle>,
): DisposableDatabase<TDrizzle> {
  const { pool, orm } = options;
  const base = databaseFrom(orm, pool);
  return {
    ...base,
    async dispose(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * DB に触れない route（GET / 等）用の Database スタブ。write/transaction は誤用検知のため throw。
 * dispose は no-op（Hyperdrive/Pool 背面の DisposableDatabase を期待する repo でもそのまま使える）。
 * orm 型は呼び出し側が指定（既定 unknown）。
 */
export function createNoopDatabase<TDrizzle = unknown>(): DisposableDatabase<TDrizzle> {
  return {
    read: async () => [],
    write: () => {
      throw new Error('noopDatabase.write accessed unexpectedly');
    },
    transaction: () => {
      throw new Error('noopDatabase.transaction accessed unexpectedly');
    },
    dispose: async () => {},
  };
}
