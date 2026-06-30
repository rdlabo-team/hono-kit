/**
 * Shape of a Drizzle (mysql2) write result, narrowed to the fields callers actually read.
 *
 * @remarks
 * A mysql2 INSERT/UPDATE/DELETE result is the tuple `[ResultSetHeader, FieldPacket[]]`. Typing the
 * result this way lets repositories extract the common values without exposing the raw query
 * builder or the full `ResultSetHeader` to the rest of the codebase.
 */
export type DzWriteResult = readonly [{ insertId: number; affectedRows: number }, ...unknown[]];

/**
 * Extract the auto-increment `insertId` from a write result.
 *
 * @param result - the result of a Drizzle (mysql2) INSERT/UPDATE/DELETE.
 * @returns the `insertId` reported by mysql2 (the id of the first inserted row).
 */
export function insertIdOf(result: DzWriteResult): number {
  return result[0].insertId;
}

/**
 * Extract the number of affected rows from a write result.
 *
 * @param result - the result of a Drizzle (mysql2) INSERT/UPDATE/DELETE.
 * @returns the `affectedRows` count reported by mysql2.
 */
export function affectedRowsOf(result: DzWriteResult): number {
  return result[0].affectedRows;
}

/**
 * Reconstruct the auto-increment ids assigned by a bulk INSERT.
 *
 * @remarks
 * mysql2 reports only the first `insertId` for a multi-row INSERT, so the remaining ids are derived
 * by assuming a contiguous sequence (`base`, `base + 1`, …). This holds for tables with a standard
 * `AUTO_INCREMENT` column and the default `innodb_autoinc_lock_mode`.
 *
 * @param result - the result of a bulk INSERT.
 * @param count - the number of rows that were inserted.
 * @returns an array of the `count` auto-increment ids, starting at the reported `insertId`.
 */
export function insertedIdsOf(result: DzWriteResult, count: number): number[] {
  const base = result[0].insertId;
  return Array.from({ length: count }, (_, i) => base + i);
}
