import { createConnection } from 'mysql2/promise';
import type { Connection, Pool } from 'mysql2/promise';
import { hyperdriveConnectionOptions } from './connection.js';
import type { HyperdriveLike } from './connection.js';
import { retryWhenDeadlock } from './retry.js';

/**
 * Dual-connection data layer that separates reads from writes.
 *
 * @remarks
 * The two sides of the database are deliberately handled differently:
 *
 * - Reads go to the **replica** as raw SQL (`QueryRunner.query`) for transparency, returning plain
 *   rows.
 * - Writes and transactions go to the **primary** through the Drizzle ORM for type safety, but only
 *   via `write(fn)` / `transaction(fn)` — the raw query builder is never exposed. The builder is
 *   awaited inside those methods, which removes a foot-gun: a Drizzle builder is a lazy thenable, so
 *   a bare `return builder` would silently become a no-op.
 *
 * Both sides retry on `ER_LOCK_DEADLOCK`.
 *
 * The kit deliberately avoids depending on the type identity of `drizzle-orm`: the consumer creates
 * the ORM instance with its own copy of `drizzle-orm` and passes it in, and {@link Database} is
 * generic over that ORM type (`TDrizzle`). This keeps the ORM's `MySqlTable`/`SQL` brands from
 * clashing even when the kit and the consumer resolve separate copies of `drizzle-orm`.
 */

/**
 * Minimal connection interface used for reads.
 *
 * @remarks
 * A mysql2 `Connection` or `Pool` satisfies this structurally.
 */
export interface QueryRunner {
  /**
   * Run a parameterized SQL query.
   *
   * @param sql - the SQL text, with `?` placeholders for `params`.
   * @param params - optional positional parameters.
   * @returns the driver's raw result (typically `[rows, fields]`).
   */
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Extract the transaction-handle type that a Drizzle instance passes to its `.transaction(cb)`
 * callback.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 */
export type TxOf<TDrizzle> = TDrizzle extends {
  transaction(cb: (tx: infer Tx) => Promise<unknown>): Promise<unknown>;
}
  ? Tx
  : unknown;

/**
 * The read/write surface of the data layer.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type used for writes and transactions.
 * @typeParam TTx - the transaction-handle type, inferred from `TDrizzle` by default.
 */
export interface Database<TDrizzle, TTx = TxOf<TDrizzle>> {
  /**
   * Run a raw SQL read against the replica, with deadlock retry.
   *
   * @typeParam T - the row shape.
   * @param sql - the SQL text, with `?` placeholders for `params`.
   * @param params - optional positional parameters.
   * @returns the rows returned by the query.
   */
  read<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run a single INSERT/UPDATE/DELETE against the primary, awaited with deadlock retry.
   *
   * @typeParam T - the value resolved by `fn`.
   * @param fn - callback that receives the Drizzle ORM and returns the awaited write.
   * @returns the value resolved by `fn`.
   */
  write<T>(fn: (dz: TDrizzle) => Promise<T>): Promise<T>;
  /**
   * Run multiple writes inside a single transaction; the whole transaction is retried on deadlock.
   *
   * @typeParam T - the value resolved by `fn`.
   * @param fn - callback that receives the transaction handle and returns the awaited work.
   * @returns the value resolved by `fn`.
   */
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

/**
 * A {@link Database} that owns its connections and must be disposed.
 *
 * @remarks
 * Used by the variants that open connections internally (Hyperdrive- or Pool-backed).
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 * @typeParam TTx - the transaction-handle type, inferred from `TDrizzle` by default.
 */
export interface DisposableDatabase<TDrizzle, TTx = TxOf<TDrizzle>> extends Database<TDrizzle, TTx> {
  /**
   * Close the connections opened by this database.
   *
   * @returns a promise that settles once both connections are closed.
   */
  dispose(): Promise<void>;
}

interface DrizzleLike<TTx> {
  transaction<T>(cb: (tx: TTx) => Promise<T>): Promise<T>;
}

/**
 * Options for {@link createMysqlDatabase}.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 */
export interface CreateMysqlDatabaseOptions<TDrizzle> {
  /**
   * The Drizzle ORM used for writes, created by the consumer with its own `drizzle-orm`
   * (e.g. `drizzle(primary, { schema, ... })`).
   */
  orm: TDrizzle;
  /** The connection used for reads (raw SQL). */
  replica: QueryRunner;
}

/**
 * Assemble a {@link Database} from an already-connected ORM and replica.
 *
 * @remarks
 * The caller (typically the worker entry point) owns creating the connections and the ORM, and is
 * responsible for closing the connections; this variant does not manage their lifecycle.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 * @param options - the write ORM and the read connection.
 * @returns a {@link Database} backed by the supplied ORM and replica.
 * @example
 * ```ts
 * const db = createMysqlDatabase({
 *   orm: drizzle(primary, { schema, ...DRIZZLE_ORM_OPTIONS }),
 *   replica,
 * });
 * const rows = await db.read<User>('SELECT * FROM users WHERE id = ?', [id]);
 * ```
 */
export function createMysqlDatabase<TDrizzle>(options: CreateMysqlDatabaseOptions<TDrizzle>): Database<TDrizzle> {
  return databaseFrom(options.orm, options.replica);
}

/**
 * Options for {@link createHyperdriveDatabase}.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 */
export interface CreateHyperdriveDatabaseOptions<TDrizzle> {
  /** The Hyperdrive binding for the primary (write) connection. */
  primaryHyperdrive: HyperdriveLike;
  /** The Hyperdrive binding for the replica (read) connection. */
  replicaHyperdrive: HyperdriveLike;
  /**
   * Factory that builds the write ORM from the primary connection, using the consumer's
   * `drizzle-orm`.
   */
  createOrm: (primary: Connection) => TDrizzle;
  /**
   * Extra options forwarded to mysql2 `createConnection`, merged on top of the defaults applied by
   * {@link hyperdriveConnectionOptions} (`disableEval: true`, `decimalNumbers: true`, and
   * `timezone: '+09:00'`). Pass a field here to override any of those defaults.
   */
  connectionOptions?: Record<string, unknown>;
}

/**
 * Create a {@link DisposableDatabase} that lazily opens its connections from Hyperdrive bindings.
 *
 * @remarks
 * Construct one per request and call `dispose()` after the response to close the connections.
 * Connections and the ORM are created on first use and reused for the lifetime of the instance; the
 * read/write/transaction surface is identical to {@link createMysqlDatabase}.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 * @param options - the primary/replica Hyperdrive bindings, the ORM factory, and connection options.
 * @returns a {@link DisposableDatabase} that must be disposed when done.
 * @example
 * ```ts
 * const db = createHyperdriveDatabase({
 *   primaryHyperdrive: env.PRIMARY,
 *   replicaHyperdrive: env.REPLICA,
 *   createOrm: (primary) => drizzle(primary, { schema, ...DRIZZLE_ORM_OPTIONS }),
 * });
 * try {
 *   await db.write((dz) => dz.insert(users).values(user));
 * } finally {
 *   await db.dispose();
 * }
 * ```
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

/**
 * Internal helper that assembles a {@link Database} from an ORM and a replica connection.
 *
 * @typeParam TDrizzle - the consumer's Drizzle ORM type.
 * @param orm - the Drizzle ORM used for writes and transactions.
 * @param replica - the connection used for reads.
 * @returns a {@link Database} wiring reads to `replica` and writes to `orm`, both with deadlock retry.
 * @internal
 */
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

/**
 * Re-export of the mysql2 `Connection` and `Pool` types.
 *
 * @remarks
 * Both are structurally assignable to the kit's {@link QueryRunner}.
 */
export type { Connection, Pool };

function connect(hyperdrive: HyperdriveLike, extra?: Record<string, unknown>): Promise<Connection> {
  return createConnection(hyperdriveConnectionOptions(hyperdrive, extra));
}
