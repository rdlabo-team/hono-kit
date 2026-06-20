import type { Context } from 'hono';

/** クライアントアプリのメタ情報（NestJS の x-amz-meta-* ヘッダ由来。3 repo 共通）。 */
export interface AppInfo {
  version: string | null;
  uuid: string | null;
}

/**
 * `x-amz-meta-version` / `x-amz-meta-uuid` ヘッダから AppInfo を読む。
 * auth middleware が per-request で c.set('appInfo', ...) する値（3 repo で同一仕様）。
 */
export const getAppInfo = (c: Context): AppInfo => ({
  version: c.req.header('x-amz-meta-version') ?? null,
  uuid: c.req.header('x-amz-meta-uuid') ?? null,
});
