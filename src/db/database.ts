import { createConnection } from 'mysql2/promise';
import type { Connection, Pool } from 'mysql2/promise';
import { hyperdriveConnectionOptions } from './connection.js';
import type { HyperdriveLike } from './connection.js';
import { retryWhenDeadlock } from './retry.js';

/**
 * フリート共通のデータ層（NestJS/TypeORM の master/slave + retryWhenDeadlock 置換）。
 *   - reads  → replica。透明性のため生 SQL を維持（旧 helper.slave().query 相当）。
 *   - writes → primary。型安全のため Drizzle 経由。ただし `write(fn)`/`transaction(fn)` 経由のみで、
 *     生 builder は公開しない。builder はここで await される（Drizzle builder は lazy thenable のため
 *     `return builder` が黙って no-op になるフットガンを排除）。両者とも ER_LOCK_DEADLOCK を retry。
 *
 * 重要: kit は `drizzle-orm` の **型同一性に依存しない**。各 repo が自分の drizzle-orm で作った orm を
 * 渡す（`Database` は orm 型 `TDrizzle` にジェネリック）。これにより kit と repo で drizzle-orm の
 * コピーが分かれても（symlink 構成）`MySqlTable`/`SQL` のブランド衝突が起きない。
 */

/** reads 用の最小接続インターフェース（mysql2 Connection / Pool が構造的に満たす）。 */
export interface QueryRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** drizzle インスタンスの `.transaction(cb)` が受け取る tx ハンドルの型を取り出す。 */
export type TxOf<TDrizzle> = TDrizzle extends {
  transaction(cb: (tx: infer Tx) => Promise<unknown>): Promise<unknown>;
}
  ? Tx
  : unknown;

export interface Database<TDrizzle, TTx = TxOf<TDrizzle>> {
  read<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 単一 INSERT/UPDATE/DELETE。primary で await + deadlock retry。 */
  write<T>(fn: (dz: TDrizzle) => Promise<T>): Promise<T>;
  /** 複数 write を 1 トランザクションで。deadlock 時は全体を retry。 */
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

/** dispose() を持つ Database（接続をモジュール内で開く版＝Hyperdrive / Pool 背面）。 */
export interface DisposableDatabase<TDrizzle, TTx = TxOf<TDrizzle>> extends Database<TDrizzle, TTx> {
  dispose(): Promise<void>;
}

interface DrizzleLike<TTx> {
  transaction<T>(cb: (tx: TTx) => Promise<T>): Promise<T>;
}

export interface CreateMysqlDatabaseOptions<TDrizzle> {
  /** 消費側が自分の drizzle-orm で `drizzle(primary, { schema, ... })` を作って渡す（writes 用）。 */
  orm: TDrizzle;
  /** reads（生 SQL）用の接続。 */
  replica: QueryRunner;
}

/**
 * 接続済みの orm/replica を受け取り Database を組み立てる（receptray/tipsys の MysqlDatabase 相当）。
 * 接続・orm の生成と接続の破棄は呼び出し側（worker entry）が担う。
 */
export function createMysqlDatabase<TDrizzle>(options: CreateMysqlDatabaseOptions<TDrizzle>): Database<TDrizzle> {
  return databaseFrom(options.orm, options.replica);
}

export interface CreateHyperdriveDatabaseOptions<TDrizzle> {
  primaryHyperdrive: HyperdriveLike;
  replicaHyperdrive: HyperdriveLike;
  /** 消費側の drizzle-orm で primary 接続から orm を作る factory（writes 用）。 */
  createOrm: (primary: Connection) => TDrizzle;
  /** createConnection に渡す追加オプション（timezone など）。disableEval:true は既定で付与。 */
  connectionOptions?: Record<string, unknown>;
}

/**
 * Hyperdrive バインディングから接続を遅延生成する Database（foodlabel の MysqlDatabase 相当）。
 * リクエスト毎に new し、レスポンス後 `dispose()` で接続を閉じる。read/write/transaction の面は同一。
 */
export function createHyperdriveDatabase<TDrizzle>(
  options: CreateHyperdriveDatabaseOptions<TDrizzle>,
): DisposableDatabase<TDrizzle> {
  const { primaryHyperdrive, replicaHyperdrive, createOrm, connectionOptions } = options;
  let primaryConn: Promise<Connection> | undefined;
  let replicaConn: Promise<Connection> | undefined;
  let orm: TDrizzle | undefined;

  const primary = (): Promise<Connection> => (primaryConn ??= connect(primaryHyperdrive, connectionOptions));
  const replica = (): Promise<Connection> => (replicaConn ??= connect(replicaHyperdrive, connectionOptions));
  const ormFor = async (): Promise<TDrizzle> => (orm ??= createOrm(await primary()));

  return {
    read<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return retryWhenDeadlock(async () => {
        const [rows] = (await (await replica()).query(sql, params)) as [unknown, unknown];
        return rows as T[];
      });
    },
    async write<T>(fn: (dz: TDrizzle) => Promise<T>): Promise<T> {
      const dz = await ormFor();
      return retryWhenDeadlock(() => fn(dz));
    },
    async transaction<T>(fn: (tx: TxOf<TDrizzle>) => Promise<T>): Promise<T> {
      const dz = (await ormFor()) as DrizzleLike<TxOf<TDrizzle>>;
      return retryWhenDeadlock(() => dz.transaction(fn));
    },
    async dispose(): Promise<void> {
      await Promise.all([primaryConn?.then((c) => c.end()), replicaConn?.then((c) => c.end())]);
    },
  };
}

/** orm と replica 接続から Database を組み立てる内部ヘルパ。 */
export function databaseFrom<TDrizzle>(orm: TDrizzle, replica: QueryRunner): Database<TDrizzle> {
  const drizzleLike = orm as DrizzleLike<TxOf<TDrizzle>>;
  return {
    read<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return retryWhenDeadlock(async () => {
        const [rows] = (await replica.query(sql, params)) as [unknown, unknown];
        return rows as T[];
      });
    },
    write<T>(fn: (dz: TDrizzle) => Promise<T>): Promise<T> {
      return retryWhenDeadlock(() => fn(orm));
    },
    transaction<T>(fn: (tx: TxOf<TDrizzle>) => Promise<T>): Promise<T> {
      return retryWhenDeadlock(() => drizzleLike.transaction(fn));
    },
  };
}

/** Pool/Connection は mysql2 の型。kit の QueryRunner には構造的に代入可能。 */
export type { Connection, Pool };

function connect(hyperdrive: HyperdriveLike, extra?: Record<string, unknown>): Promise<Connection> {
  return createConnection(hyperdriveConnectionOptions(hyperdrive, extra));
}
