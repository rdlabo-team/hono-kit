import { describe, expect, it, vi } from 'vitest';
import { createMysqlDatabase } from './database';
import type { QueryRunner } from './database';

// kit は drizzle に依存しないため、orm は最小のフェイク（transaction を持つ）で検証する。
interface FakeOrm {
  transaction<T>(cb: (tx: 'tx') => Promise<T>): Promise<T>;
  tag: string;
}
const fakeOrm = (): FakeOrm => ({
  tag: 'orm',
  transaction: (cb) => cb('tx'),
});

const runner = (query: (...args: unknown[]) => Promise<unknown>): QueryRunner => ({ query });

describe('createMysqlDatabase', () => {
  it('read は replica.query に sql/params を渡し rows を返す', async () => {
    const query = vi.fn(async () => [[{ id: 1 }], []]);
    const db = createMysqlDatabase({ orm: fakeOrm(), replica: runner(query) });

    await expect(db.read('SELECT ? ', [1])).resolves.toEqual([{ id: 1 }]);
    expect(query).toHaveBeenCalledWith('SELECT ? ', [1]);
  });

  it('read は ER_LOCK_DEADLOCK を retry する', async () => {
    let n = 0;
    const query = vi.fn(async () => {
      n += 1;
      if (n < 2) {
        throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' });
      }
      return [[{ ok: 1 }], []];
    });
    const db = createMysqlDatabase({ orm: fakeOrm(), replica: runner(query) });
    await expect(db.read('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('write は orm を渡して fn の戻り値を返す', async () => {
    const orm = fakeOrm();
    const db = createMysqlDatabase({ orm, replica: runner(vi.fn()) });
    await expect(db.write(async (dz) => dz.tag)).resolves.toBe('orm');
  });

  it('transaction は orm.transaction を介して tx を渡す', async () => {
    const db = createMysqlDatabase({ orm: fakeOrm(), replica: runner(vi.fn()) });
    await expect(db.transaction(async (tx) => tx)).resolves.toBe('tx');
  });
});
