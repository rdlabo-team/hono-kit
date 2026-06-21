import { createConnection } from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';

/**
 * Hyperdrive バインディングの最小形（@cloudflare/workers-types への依存を避けるための構造型）。
 */
export interface HyperdriveLike {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
}

/**
 * Hyperdrive バインディングから mysql2 の createConnection 用オプションを作る。
 * `disableEval: true`（Workers で eval 不可）は既定で付与。`extra` で timezone 等を上書き/追加。
 */
export function hyperdriveConnectionOptions(
  hyperdrive: HyperdriveLike,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    host: hyperdrive.host,
    user: hyperdrive.user,
    password: hyperdrive.password,
    database: hyperdrive.database,
    port: hyperdrive.port,
    disableEval: true,
    ...extra,
  };
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * primary/replica の接続を開いて `fn` を実行し、finally で `ctx.waitUntil` 越しに閉じる
 * （receptray/tipsys の worker entry の接続ライフサイクル相当）。
 */
export async function withMysqlConnections<T>(
  hyperdrives: { primary: HyperdriveLike; replica: HyperdriveLike },
  ctx: ExecutionContextLike,
  fn: (connections: { primary: Connection; replica: Connection }) => Promise<T>,
  connectionOptions?: Record<string, unknown>,
): Promise<T> {
  let primary: Connection | undefined;
  let replica: Connection | undefined;
  try {
    primary = await createConnection(hyperdriveConnectionOptions(hyperdrives.primary, connectionOptions));
    replica = await createConnection(hyperdriveConnectionOptions(hyperdrives.replica, connectionOptions));
    return await fn({ primary, replica });
  } finally {
    const closing = [primary, replica].filter((c): c is Connection => c !== undefined).map((c) => c.end());
    if (closing.length > 0) {
      ctx.waitUntil(Promise.allSettled(closing));
    }
  }
}
