export type AppEnv = 'development' | 'production';

/**
 * 実行環境（development / production）を解決する。フリート共通の判定。
 *
 * NestJS `/api` は実行時 FS の `.git` 有無で判定し「git が throw → catch → 本番」としていた。
 * Workers は実行時に FS / child_process が無いため同じ手は使えない。代わりに dev シグナルを
 * **コミット済みの起動コマンド**に置く: `wrangler dev --var APP_ENV:development`（`deploy` は無注入）。
 * よって `env.APP_ENV === 'development'` の時だけ development、それ以外（注入無し＝本番デプロイ）は
 * production に倒す。これは `/api` の「absence/catch = 本番（安全側）」と同じ意味論。
 *
 * `env` 由来なので fetch / scheduled どちらの文脈でも使え、リクエストヘッダ由来でないため詐称されない。
 */
export function resolveAppEnv(env: { APP_ENV?: string } | null | undefined): AppEnv {
  return env?.APP_ENV === 'development' ? 'development' : 'production';
}

/** production 判定のショートハンド。 */
export const isProductionEnv = (env: { APP_ENV?: string } | null | undefined): boolean =>
  resolveAppEnv(env) === 'production';
