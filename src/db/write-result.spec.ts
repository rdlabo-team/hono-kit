import { describe, expect, it } from 'vitest';
import { affectedRowsOf, insertIdOf, insertedIdsOf } from './write-result.js';
import type { DzWriteResult } from './write-result.js';

const result = (insertId: number, affectedRows: number): DzWriteResult =>
  [{ insertId, affectedRows }, []] as unknown as DzWriteResult;

describe('write-result helpers', () => {
  it('insertIdOf は先頭 ResultSetHeader の insertId を返す', () => {
    expect(insertIdOf(result(42, 1))).toBe(42);
  });

  it('affectedRowsOf は affectedRows を返す', () => {
    expect(affectedRowsOf(result(0, 3))).toBe(3);
  });

  it('insertedIdsOf は insertId を起点に count 個の連番を返す', () => {
    expect(insertedIdsOf(result(10, 3), 3)).toEqual([10, 11, 12]);
  });

  it('insertedIdsOf(count=0) は空配列', () => {
    expect(insertedIdsOf(result(10, 0), 0)).toEqual([]);
  });
});
