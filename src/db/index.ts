// @rdlabo/workers-hono-kit/db — mysql2 依存のデータ層ヘルパ（ルート `.` は web 標準のみのため別サブパス）。
// drizzle-orm の型同一性には依存しない（orm は消費側が渡す）。

export { retryWhenDeadlock } from './retry.js';

export { createMysqlDatabase, createHyperdriveDatabase, databaseFrom } from './database.js';
export type {
  Database,
  DisposableDatabase,
  QueryRunner,
  TxOf,
  CreateMysqlDatabaseOptions,
  CreateHyperdriveDatabaseOptions,
  Connection,
  Pool,
} from './database.js';

export { insertIdOf, affectedRowsOf, insertedIdsOf } from './write-result.js';
export type { DzWriteResult } from './write-result.js';

export { hyperdriveConnectionOptions, withMysqlConnections } from './connection.js';
export type { HyperdriveLike, ExecutionContextLike } from './connection.js';

export { toJstDate, jstTimestampParams, jstDatetimeParams, jstDateParams } from './jst.js';

export { DRIZZLE_ORM_OPTIONS, honoDrizzleConfig } from './orm-config.js';
export type { HonoDrizzleConfigOptions } from './orm-config.js';
