import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createConnection, createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

/**
 * Connection parameters for the test MySQL server.
 *
 * @see {@link CreateTestDbOptions.connection} for how defaults are resolved.
 */
export interface TestDbConnection {
  /** Server host. */
  host: string;
  /** Server port. */
  port: number;
  /** User name. */
  user: string;
  /** Password. */
  password: string;
}

/**
 * Options for {@link createTestDb}.
 */
export interface CreateTestDbOptions {
  /**
   * Test database name (e.g. `'app_test'`). To isolate parallel runs per feature, resolve a per-run
   * name on the caller side and pass it here.
   */
  dbName: string;
  /**
   * Absolute path to the Drizzle migrations folder. Resolve it on the caller side, e.g.
   * `join(here, '..', 'drizzle')`.
   */
  migrationsFolder: string;
  /**
   * Connection overrides. Unspecified fields fall back to environment variables
   * (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`), then to `127.0.0.1`/`3306`/`root`/`root`.
   */
  connection?: Partial<TestDbConnection>;
}

/**
 * Test database handle returned by {@link createTestDb}, bundling schema setup, pooling, and
 * fixture helpers for a single test database.
 */
export interface TestDb {
  /** The resolved test database name. */
  readonly dbName: string;
  /** The resolved connection parameters. */
  readonly connection: TestDbConnection;
  /**
   * Drop and recreate the database, then apply the committed Drizzle migrations to build the schema.
   *
   * @returns A promise that resolves once migrations have been applied.
   */
  resetSchema(): Promise<void>;
  /**
   * Create a mysql2 pool connected to the test database.
   *
   * @remarks Call `pool.end()` (e.g. in `afterAll`) to release connections.
   * @returns A connection pool for the test database.
   */
  createTestPool(): Pool;
  /**
   * Truncate every base table in the database.
   *
   * @remarks Table names are discovered dynamically from `information_schema`; the
   * `__drizzle_migrations` bookkeeping table is excluded. Foreign-key checks are disabled for the
   * duration so truncation order does not matter.
   * @param pool - Pool connected to the test database.
   */
  truncateAll(pool: Pool): Promise<void>;
  /**
   * Insert a single row, mapping column names to values — a generic fixture helper for specs.
   *
   * @param pool - Pool connected to the test database.
   * @param table - Target table name.
   * @param row - Column-name to value map. A no-op if empty.
   */
  seed(pool: Pool, table: string, row: Record<string, unknown>): Promise<void>;
  /**
   * Report whether the local MySQL server is reachable.
   *
   * @remarks Useful as a guard, e.g. `describe.skipIf(!(await mysqlReachable()))`.
   * @returns `true` if a connection could be opened, otherwise `false`.
   */
  mysqlReachable(): Promise<boolean>;
}

function resolveConnection(override?: Partial<TestDbConnection>): TestDbConnection {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    host: override?.host ?? env.DB_HOST ?? '127.0.0.1',
    port: override?.port ?? Number(env.DB_PORT ?? '3306'),
    user: override?.user ?? env.DB_USER ?? 'root',
    password: override?.password ?? env.DB_PASSWORD ?? 'root',
  };
}

/**
 * Create a {@link TestDb} handle for a single test database.
 *
 * @remarks
 * The test schema is built from the committed Drizzle migrations as the single source of truth
 * (the `db:generate` output under `./drizzle`), rather than a hand-written `schema.sql`. This helper
 * is Node-only test infrastructure (run under Vitest) and is unrelated to runtime behavior.
 *
 * @param options - Database name, migrations folder, and optional connection overrides. See
 *   {@link CreateTestDbOptions}.
 * @returns A handle exposing schema setup, pooling, truncation, seeding, and a reachability probe.
 * @example
 * ```ts
 * const testDb = createTestDb({ dbName: 'app_test', migrationsFolder: join(here, '..', 'drizzle') });
 * beforeAll(async () => {
 *   await testDb.resetSchema();
 * });
 * const pool = testDb.createTestPool();
 * beforeEach(() => testDb.truncateAll(pool));
 * afterAll(() => pool.end());
 * ```
 */
export function createTestDb(options: CreateTestDbOptions): TestDb {
  const { dbName, migrationsFolder } = options;
  const connection = resolveConnection(options.connection);

  return {
    dbName,
    connection,

    async resetSchema(): Promise<void> {
      const admin = await createConnection({ ...connection, multipleStatements: true });
      await admin.query(
        `DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4;`,
      );
      await admin.changeUser({ database: dbName });
      await migrate(drizzle(admin), { migrationsFolder });
      await admin.end();
    },

    createTestPool(): Pool {
      // decimalNumbers / timezone mirror the runtime hyperdriveConnectionOptions so specs read
      // DECIMAL columns as numbers and handle datetime in +09:00 (JST), matching production.
      const pool = createPool({
        ...connection,
        database: dbName,
        connectionLimit: 5,
        decimalNumbers: true,
        timezone: '+09:00',
      });
      // Pin ONLY_FULL_GROUP_BY on every pooled connection so GROUP BY violations surface in specs
      // regardless of the server's my.cnf (the policy is centralized here, not left to each server). CONCAT keeps
      // the server's other sql_mode flags and is harmless if ONLY_FULL_GROUP_BY is already present.
      // mysql2 queues this SET ahead of the consumer's first query on each new physical connection.
      pool.on('connection', (conn) => {
        void conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',ONLY_FULL_GROUP_BY')");
      });
      return pool;
    },

    async truncateAll(pool: Pool): Promise<void> {
      const [rows] = await pool.query(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type='BASE TABLE' AND table_name <> '__drizzle_migrations'",
        [dbName],
      );
      const tables = (rows as { t: string }[]).map((r) => r.t);
      await pool.query('SET FOREIGN_KEY_CHECKS=0');
      for (const t of tables) {
        await pool.query(`TRUNCATE TABLE \`${t}\``);
      }
      await pool.query('SET FOREIGN_KEY_CHECKS=1');
    },

    async seed(pool: Pool, table: string, row: Record<string, unknown>): Promise<void> {
      const cols = Object.keys(row);
      if (cols.length === 0) {
        return;
      }
      const placeholders = cols.map(() => '?').join(', ');
      const columnList = cols.map((c) => `\`${c}\``).join(', ');
      await pool.query(`INSERT INTO \`${table}\` (${columnList}) VALUES (${placeholders})`, Object.values(row));
    },

    async mysqlReachable(): Promise<boolean> {
      try {
        const c = await createConnection({ ...connection });
        await c.end();
        return true;
      } catch {
        return false;
      }
    },
  };
}
