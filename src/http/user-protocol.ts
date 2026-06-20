import type { Context } from 'hono';

/** クライアントの IP / UA（NestJS の @UserProtocol デコレータ相当）。 */
export interface IUserProtocol {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Hono Context からクライアント IP / UA を取得する。Cloudflare は実 IP を `CF-Connecting-IP` に入れる
 * （`X-Forwarded-For` はフォールバック）。未取得は null（DB の nullable カラムにそのまま入る）。
 */
export const getUserProtocol = (c: Context): IUserProtocol => ({
  ipAddress: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
  userAgent: c.req.header('user-agent') ?? null,
});
