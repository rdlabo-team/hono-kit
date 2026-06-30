import type { Context } from 'hono';

/**
 * The client's network identity: IP address and user agent.
 *
 * @remarks
 * Equivalent to the data a NestJS `@UserProtocol` decorator would expose, so a Hono app can persist the
 * same client metadata. Both fields are nullable to map directly onto nullable database columns.
 */
export interface IUserProtocol {
  /** Client IP address, or `null` when no source header is present. */
  ipAddress: string | null;
  /** Client user-agent string, or `null` when the `User-Agent` header is absent. */
  userAgent: string | null;
}

/**
 * Read the client's IP address and user agent from the Hono request context.
 *
 * @remarks
 * On Cloudflare the real client IP is provided in `CF-Connecting-IP`, with `X-Forwarded-For` used as a
 * fallback. Missing values resolve to `null` so they map cleanly onto nullable storage.
 *
 * @param c - The Hono request context to read headers from.
 * @returns The client's IP address and user agent for the current request.
 *
 * @example
 * ```ts
 * const { ipAddress, userAgent } = getUserProtocol(c);
 * await auditLog.insert({ ipAddress, userAgent });
 * ```
 */
export const getUserProtocol = (c: Context): IUserProtocol => ({
  ipAddress: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
  userAgent: c.req.header('user-agent') ?? null,
});
