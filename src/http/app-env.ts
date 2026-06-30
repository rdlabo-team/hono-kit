/**
 * The resolved runtime environment of the Worker.
 */
export type AppEnv = 'development' | 'production';

/**
 * Resolve the runtime environment (development or production) from the Worker `env` binding.
 *
 * @remarks
 * Cloudflare Workers have no filesystem or `child_process` at runtime, so the environment cannot be
 * inferred from the presence of a `.git` directory the way a Node/NestJS process might. Instead, the
 * development signal is carried in the committed launch command: `wrangler dev --var APP_ENV:development`
 * injects `APP_ENV`, while `wrangler deploy` injects nothing. Only `env.APP_ENV === 'development'`
 * resolves to `'development'`; every other case (including a missing binding, i.e. a production deploy)
 * resolves to `'production'`. This "absence defaults to production" semantic keeps the safe side as the
 * default.
 *
 * Because it reads from `env` rather than a request header, it works in both `fetch` and `scheduled`
 * contexts and cannot be spoofed by an incoming request.
 *
 * @param env - The Worker environment binding, or `null`/`undefined` when unavailable.
 * @returns `'development'` only when `env.APP_ENV` is exactly `'development'`; otherwise `'production'`.
 *
 * @example
 * ```ts
 * export default {
 *   fetch(req, env) {
 *     if (resolveAppEnv(env) === 'development') {
 *       // enable verbose logging
 *     }
 *   },
 * };
 * ```
 */
export function resolveAppEnv(env: { APP_ENV?: string } | null | undefined): AppEnv {
  return env?.APP_ENV === 'development' ? 'development' : 'production';
}

/**
 * Shorthand for checking whether the resolved environment is production.
 *
 * @param env - The Worker environment binding, or `null`/`undefined` when unavailable.
 * @returns `true` when {@link resolveAppEnv} resolves to `'production'`.
 *
 * @example
 * ```ts
 * if (isProductionEnv(env)) {
 *   // skip dev-only diagnostics
 * }
 * ```
 */
export const isProductionEnv = (env: { APP_ENV?: string } | null | undefined): boolean =>
  resolveAppEnv(env) === 'production';
