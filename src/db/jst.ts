/**
 * Shared building blocks for normalizing JST (Asia/Tokyo) date/time values.
 *
 * @remarks
 * JST normalization is applied at the column boundary as a write-time side effect, and neither
 * values nor types from `drizzle-orm` are imported here on purpose. Exporting a fully-built
 * `customType` column from the kit would cause type collisions when the kit and the consumer
 * resolve separate copies of `drizzle-orm` (the private `SQL` brand stops being nominally
 * compatible). Instead the kit ships only the params and helpers, and the consumer builds the
 * column with its own `customType`:
 *
 * ```ts
 * import { customType } from 'drizzle-orm/mysql-core';
 * import { jstTimestampParams, jstDateParams } from '@rdlabo/workers-hono-kit/db';
 *
 * export const jstTimestamp = (name: string, opts?: { fsp?: number }) =>
 *   customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams(opts?.fsp))(name);
 * export const jstDate = (name: string) =>
 *   customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);
 * ```
 *
 * `timestamp`/`datetime` columns omit `toDriver` and pass `Date` values straight through, so the
 * connection's `timezone: '+09:00'` default makes mysql2 format them as JST; pre-formatted strings
 * also pass through. Drizzle's native `mode: 'date'` is avoided because it stringifies `Date` to
 * UTC before the timezone layer, shifting values by -9h. `date` columns keep `toJstDate` because
 * MySQL `DATE` rejects ISO/empty strings and a JST day-boundary normalization is required.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Normalize a client-supplied date to the `YYYY-MM-DD` (JST) form accepted by a MySQL `DATE` column.
 *
 * Accepts ISO 8601 (`...Z`), `YYYY-MM-DD`, or an empty string. Nullish, empty, or unparseable input
 * resolves to `null`.
 *
 * @remarks
 * MySQL `DATE` rejects ISO strings with `ER_TRUNCATED_WRONG_VALUE`, so this cannot be handled by the
 * driver alone; it is needed as the `toDriver` transform for a `date` column.
 *
 * @param value - the raw date string from the client (ISO 8601, `YYYY-MM-DD`, or empty), or nullish.
 * @returns the JST calendar date as `YYYY-MM-DD`, or `null` when the input is empty or unparseable.
 */
export function toJstDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  const jst = new Date(ms + JST_OFFSET_MS);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`;
}

/**
 * Build the params for a `customType` backing a MySQL `timestamp` column with `Date` pass-through.
 *
 * The column omits `toDriver`, so `Date` values flow straight to mysql2 and are formatted as JST by
 * the connection's `timezone: '+09:00'` default.
 *
 * @param fsp - optional fractional-seconds precision; when provided, emits `timestamp(fsp)`.
 * @returns the `customType` params object exposing the column's `dataType`.
 * @example
 * ```ts
 * import { customType } from 'drizzle-orm/mysql-core';
 * import { jstTimestampParams } from '@rdlabo/workers-hono-kit/db';
 *
 * const jstTimestamp = (name: string) =>
 *   customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams())(name);
 * ```
 */
export const jstTimestampParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `timestamp(${fsp})` : 'timestamp'),
});

/**
 * Build the params for a `customType` backing a MySQL `datetime` column with `Date` pass-through.
 *
 * Behaves like {@link jstTimestampParams} but emits a `datetime` data type; `Date` values pass
 * through and are formatted as JST by the connection's `timezone: '+09:00'` default.
 *
 * @param fsp - optional fractional-seconds precision; when provided, emits `datetime(fsp)`.
 * @returns the `customType` params object exposing the column's `dataType`.
 * @example
 * ```ts
 * import { customType } from 'drizzle-orm/mysql-core';
 * import { jstDatetimeParams } from '@rdlabo/workers-hono-kit/db';
 *
 * const jstDatetime = (name: string) =>
 *   customType<{ data: string | Date; driverData: string | Date }>(jstDatetimeParams())(name);
 * ```
 */
export const jstDatetimeParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `datetime(${fsp})` : 'datetime'),
});

/**
 * Build the params for a `customType` backing a MySQL `date` column with JST normalization.
 *
 * Unlike the timestamp/datetime params, this defines a `toDriver` transform that runs
 * {@link toJstDate} so client-supplied ISO/empty strings are normalized to a JST `YYYY-MM-DD` value
 * the column accepts.
 *
 * @returns the `customType` params object exposing the column's `dataType` and `toDriver`.
 * @example
 * ```ts
 * import { customType } from 'drizzle-orm/mysql-core';
 * import { jstDateParams } from '@rdlabo/workers-hono-kit/db';
 *
 * const jstDate = (name: string) =>
 *   customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);
 * ```
 */
export const jstDateParams = (): {
  dataType: () => string;
  toDriver: (value: string | null) => string | null;
} => ({
  dataType: () => 'date',
  toDriver: (value: string | null) => toJstDate(value),
});
