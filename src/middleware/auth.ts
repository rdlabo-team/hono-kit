import type { Context, Env, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getAppInfo } from '../http/app-info.js';
import type { AppInfo } from '../http/app-info.js';

/**
 * Configuration for {@link createAuthMiddleware}.
 *
 * @typeParam E - The Hono `Env` (bindings/variables) of the application.
 * @typeParam Verified - The value produced by {@link AuthMiddlewareOptions.verify} (e.g. a decoded token or user record).
 * @typeParam Id - The resolved user identifier type.
 */
export interface AuthMiddlewareOptions<E extends Env, Verified, Id = unknown> {
  /** Header carrying the ID token. Defaults to `'x-amz-security-token'`. */
  tokenHeader?: string;
  /**
   * Verify the raw token and return the decoded value or user record.
   *
   * @param token - The raw token read from {@link AuthMiddlewareOptions.tokenHeader} (empty string if absent).
   * @param c - The current Hono context.
   * @returns The verified value passed to {@link AuthMiddlewareOptions.resolveUserId}/{@link AuthMiddlewareOptions.setContext}.
   * @throws If the token is invalid; rejecting/throwing triggers the failure path.
   */
  verify: (token: string, c: Context<E>) => Promise<Verified>;
  /**
   * Resolve the database user id (creating the user if necessary).
   *
   * @remarks
   * Omit this to run in **token-only** mode (verification only, e.g. for login). Create-on-miss
   * behavior (such as `getUserId(...).catch(() => createUser(...))`) should be composed here by the
   * caller.
   *
   * @param verified - The value returned by {@link AuthMiddlewareOptions.verify}.
   * @param c - The current Hono context.
   * @param appInfo - The resolved application info for the request.
   * @returns The resolved user id.
   */
  resolveUserId?: (verified: Verified, c: Context<E>, appInfo: AppInfo) => Promise<Id>;
  /**
   * Store the verification result on the context variables.
   *
   * @remarks
   * Inject the application-specific variable names here (e.g. `decodedToken`, `userRecord`, `userProtocol`).
   *
   * @param c - The current Hono context.
   * @param data - The verified value, resolved app info, and (when available) the user id.
   */
  setContext: (c: Context<E>, data: { verified: Verified; appInfo: AppInfo; userId?: Id }) => void;
  /**
   * Override the failure behavior.
   *
   * @remarks
   * Defaults to `throw new HTTPException(failureStatus, { message: failureMessage })`. Provide this to
   * return a custom `Response` instead (e.g. `c.json(body, status)`).
   *
   * @param err - The error thrown during verification/resolution.
   * @param c - The current Hono context.
   * @returns The failure response to send.
   */
  onFailure?: (err: unknown, c: Context<E>) => Response;
  /** Status used by the default `onFailure`. Defaults to `403`. */
  failureStatus?: ContentfulStatusCode;
  /** Message used by the default `onFailure`. Defaults to `'Forbidden resource'`. */
  failureMessage?: string;
}

/**
 * Create an authentication middleware equivalent to a NestJS `AuthGuard` / `TokenGuard`.
 *
 * The middleware runs a fixed skeleton — read the token header, `verify`, `getAppInfo`,
 * `resolveUserId`, `setContext`, and on error `console.error` then `onFailure` — while the
 * application injects the variable parts (token verification, user-id resolution, context variable
 * names, and the failure response). Omitting {@link AuthMiddlewareOptions.resolveUserId} yields a
 * token-only middleware.
 *
 * @typeParam E - The Hono `Env` of the application.
 * @typeParam Verified - The value produced by `verify`.
 * @typeParam Id - The resolved user identifier type.
 * @param options - The verification, resolution, and failure hooks; see {@link AuthMiddlewareOptions}.
 * @returns A {@link MiddlewareHandler} that authenticates the request and populates the context.
 * @throws HTTPException From the default failure handler when `onFailure` is not supplied.
 *
 * @example
 * ```ts
 * const auth = createAuthMiddleware({
 *   verify: (token, c) => verifier.verifyIdToken(token),
 *   resolveUserId: (decoded) => findUserId(decoded.uid),
 *   setContext: (c, { verified, userId }) => {
 *     c.set('decodedToken', verified);
 *     c.set('userId', userId);
 *   },
 * });
 * app.use('/api/*', auth);
 * ```
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
      // Equivalent to a guard returning false → ForbiddenException('Forbidden resource'). Log the
      // cause and, by default, throw so the app's onError renders the error body (callers can
      // override with onFailure to return a custom response instead).
      console.error(e);
      if (onFailure) {
        return onFailure(e, c);
      }
      throw new HTTPException(failureStatus, { message: failureMessage });
    }
    await next();
  };
}
