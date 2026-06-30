import type { Context } from 'hono';

/**
 * Client application metadata derived from the `x-amz-meta-*` request headers.
 *
 * @remarks
 * Reproduces the per-request app identity that a NestJS service would expose so a Hono app
 * can read the same client-supplied version/uuid pair without changing the wire contract.
 */
export interface AppInfo {
  /** Client application version from `x-amz-meta-version`, or `null` when the header is absent. */
  version: string | null;
  /** Client installation identifier from `x-amz-meta-uuid`, or `null` when the header is absent. */
  uuid: string | null;
}

/**
 * Read {@link AppInfo} from the `x-amz-meta-version` / `x-amz-meta-uuid` request headers.
 *
 * @remarks
 * Typically called by an auth middleware that stores the result per request via
 * `c.set('appInfo', getAppInfo(c))`. Missing headers resolve to `null` rather than throwing.
 *
 * @param c - The Hono request context to read headers from.
 * @returns The client application metadata for the current request.
 *
 * @example
 * ```ts
 * app.use(async (c, next) => {
 *   c.set('appInfo', getAppInfo(c));
 *   await next();
 * });
 * ```
 */
export const getAppInfo = (c: Context): AppInfo => ({
  version: c.req.header('x-amz-meta-version') ?? null,
  uuid: c.req.header('x-amz-meta-uuid') ?? null,
});
