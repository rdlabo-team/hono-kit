/**
 * Drizzle(mysql2) の write 結果から insertId / affectedRows を型安全に取り出すヘルパ。
 * 生の builder/ResultSetHeader を repo 側に晒さずに、よく使う値だけを取り出す。
 *
 * mysql2 の INSERT/UPDATE/DELETE 結果は `[ResultSetHeader, FieldPacket[]]` 形。
 */
export type DzWriteResult = readonly [{ insertId: number; affectedRows: number }, ...unknown[]];

export function insertIdOf(result: DzWriteResult): number {
  return result[0].insertId;
}

export function affectedRowsOf(result: DzWriteResult): number {
  return result[0].affectedRows;
}

/**
 * 一括 INSERT で連番採番された行の id 群を返す（mysql2 は先頭 insertId のみ返すため count 分を生成）。
 */
export function insertedIdsOf(result: DzWriteResult, count: number): number[] {
  const base = result[0].insertId;
  return Array.from({ length: count }, (_, i) => base + i);
}
