import type { Pool } from 'mysql2/promise';
import type { DecodedIdToken } from '../firebase/firebase-verifier.js';
import type { FakeFirebaseVerifier } from './fakes.js';

/**
 * Build authentication headers compatible with the client interceptor convention
 * (`x-amz-security-token` + `x-amz-meta-*`).
 *
 * Consolidates the identically-shaped header boilerplate that route specs tend to duplicate.
 *
 * @remarks
 * `version` is persisted into an `app_version` column (`varchar(10)`), so keep it to 10 characters
 * or fewer. Passing `contentType: null` omits the `content-type` header entirely (e.g. for GET requests).
 *
 * @param token - Security token placed in the `x-amz-security-token` header.
 * @param opts - Optional overrides.
 * @param opts.version - App version for `x-amz-meta-version` (defaults to `'1.0.0'`).
 * @param opts.uuid - Device/client UUID for `x-amz-meta-uuid` (defaults to `'test-uuid'`).
 * @param opts.contentType - Content type; defaults to `'application/json'`. Pass `null` to omit the header.
 * @returns A plain header record suitable for `fetch`/`app.request` calls.
 * @example
 * ```ts
 * const res = await app.request('/me', { headers: authHeaders(token) });
 * // GET without a content-type header:
 * await app.request('/items', { headers: authHeaders(token, { contentType: null }) });
 * ```
 */
export function authHeaders(
  token: string,
  opts: { version?: string; uuid?: string; contentType?: string | null } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-amz-security-token': token,
    'x-amz-meta-version': opts.version ?? '1.0.0',
    'x-amz-meta-uuid': opts.uuid ?? 'test-uuid',
  };
  if (opts.contentType !== null) {
    headers['content-type'] = opts.contentType ?? 'application/json';
  }
  return headers;
}

/**
 * Register a token on a fake Firebase verifier without touching the database.
 *
 * Use this when {@link provisionUser} does not fit because the project's `users` table has a
 * non-conventional shape (for example, keyed by email rather than `firebase_uid`); pair it with a
 * project-specific provisioning step.
 *
 * @param firebase - In-memory verifier to register the token on.
 * @param uid - Firebase UID associated with the token.
 * @param record - Additional decoded-token fields to merge in (e.g. `email`).
 * @param token - Token string to register (defaults to `` `tok-${uid}` ``).
 * @returns The registered token string.
 * @example
 * ```ts
 * const token = registerFirebaseToken(firebase, 'uid-1', { email: 'a@example.com' });
 * const res = await app.request('/me', { headers: authHeaders(token) });
 * ```
 */
export function registerFirebaseToken(
  firebase: FakeFirebaseVerifier,
  uid: string,
  record: Partial<DecodedIdToken> = {},
  token = `tok-${uid}`,
): string {
  firebase.register(token, { uid, ...record });
  return token;
}

/**
 * Register a token on a fake Firebase verifier and ensure a matching `users` row exists, returning
 * its id.
 *
 * @remarks
 * Assumes a conventional `users(id, firebase_uid, agree)` table. The operation is idempotent: if a
 * row with the same `firebase_uid` already exists it is reused rather than re-inserted. For projects
 * whose `users` table has a different shape, use {@link registerFirebaseToken} plus project-specific
 * provisioning instead.
 *
 * @param pool - mysql2 pool connected to the test database.
 * @param firebase - In-memory verifier to register the token on.
 * @param opts - Provisioning options.
 * @param opts.uid - Firebase UID for the user.
 * @param opts.token - Token string to register (defaults to `` `tok-${uid}` ``).
 * @param opts.agree - Value for the `agree` column on insert (defaults to `1`).
 * @param opts.email - Optional email merged into the decoded token record.
 * @returns The resolved `userId`, along with the `uid` and registered `token`.
 * @example
 * ```ts
 * const { userId, token } = await provisionUser(pool, firebase, { uid: 'uid-1' });
 * const res = await app.request('/me', { headers: authHeaders(token) });
 * ```
 */
export async function provisionUser(
  pool: Pool,
  firebase: FakeFirebaseVerifier,
  opts: { uid: string; token?: string; agree?: number; email?: string },
): Promise<{ userId: number; uid: string; token: string }> {
  const token = registerFirebaseToken(firebase, opts.uid, opts.email ? { email: opts.email } : {}, opts.token);

  const [existing] = await pool.query('SELECT id FROM users WHERE firebase_uid = ?', [opts.uid]);
  const rows = existing as { id: number }[];
  if (rows.length > 0) {
    return { userId: rows[0].id, uid: opts.uid, token };
  }

  const [res] = await pool.query('INSERT INTO users (agree, firebase_uid) VALUES (?, ?)', [opts.agree ?? 1, opts.uid]);
  return { userId: (res as { insertId: number }).insertId, uid: opts.uid, token };
}
