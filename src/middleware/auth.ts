import type { Context, Env, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getAppInfo } from '../http/app-info.js';
import type { AppInfo } from '../http/app-info.js';

export interface AuthMiddlewareOptions<E extends Env, Verified, Id = unknown> {
  /** ID トークンを載せるヘッダ。既定 `'x-amz-security-token'`（フリート共通）。 */
  tokenHeader?: string;
  /** 生トークンを検証して record/decoded を返す。無効なら throw / reject すること。 */
  verify: (token: string, c: Context<E>) => Promise<Verified>;
  /**
   * DB userId を解決（必要なら新規作成）する。**省略すると token-only**（検証のみ・login 用）になる。
   * create-on-miss（`getUserIdFromFirebase(...).catch(() => createUser(...))`）は repo 側でここに合成する。
   */
  resolveUserId?: (verified: Verified, c: Context<E>, appInfo: AppInfo) => Promise<Id>;
  /** 検証結果を c.var に載せる。repo 固有の var 名（`decodedToken` / `userRecord` / `userProtocol` 等）を注入する。 */
  setContext: (c: Context<E>, data: { verified: Verified; appInfo: AppInfo; userId?: Id }) => void;
  /**
   * 失敗時の挙動。既定は `throw new HTTPException(failureStatus, { message: failureMessage })`
   * （foodlabel/receptray と同形）。**winecode は `c.json(BODY, n)` を返す**ため上書きする。
   */
  onFailure?: (err: unknown, c: Context<E>) => Response;
  /** 既定 onFailure の status。既定 `403`（token-only の 401 等は repo が上書き）。 */
  failureStatus?: ContentfulStatusCode;
  /** 既定 onFailure の message。既定 `'Forbidden resource'`。 */
  failureMessage?: string;
}

/**
 * NestJS の AuthGuard / TokenGuard 相当の認証 middleware を作る（フリート共通）。
 * スケルトン（ヘッダ読取 → verify → getAppInfo → resolveUserId → setContext、失敗で console.error +
 * onFailure）を共有し、repo 固有部分（verify / userId 解決 / var 名 / 失敗レスポンス）だけ注入させる。
 * `resolveUserId` を省けば token-only middleware になる。
 */
export function createAuthMiddleware<E extends Env = Env, Verified = unknown, Id = unknown>(
  options: AuthMiddlewareOptions<E, Verified, Id>,
): MiddlewareHandler<E> {
  const {
    tokenHeader = 'x-amz-security-token',
    verify,
    resolveUserId,
    setContext,
    onFailure,
    failureStatus = 403,
    failureMessage = 'Forbidden resource',
  } = options;

  return async (c, next) => {
    try {
      const token = c.req.header(tokenHeader) ?? '';
      const verified = await verify(token, c);
      const appInfo = getAppInfo(c);
      const userId = resolveUserId ? await resolveUserId(verified, c, appInfo) : undefined;
      setContext(c, { verified, appInfo, userId });
    } catch (e) {
      // Nest guard が false → ForbiddenException('Forbidden resource')。原因をログし、既定では throw して
      // app.onError に Nest 形 body を描かせる（repo は onFailure で return 形に上書き可能）。
      console.error(e);
      if (onFailure) {
        return onFailure(e, c);
      }
      throw new HTTPException(failureStatus, { message: failureMessage });
    }
    await next();
  };
}
