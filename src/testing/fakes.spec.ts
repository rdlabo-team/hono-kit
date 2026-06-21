import { describe, expect, it } from 'vitest';
import { createNoopDatabase, FakeFirebaseVerifier } from './fakes';

describe('FakeFirebaseVerifier', () => {
  it('register したトークンは verifyIdToken で復元できる', async () => {
    const fb = new FakeFirebaseVerifier();
    fb.register('tok', { uid: 'u1', email: 'a@example.com' });
    await expect(fb.verifyIdToken('tok')).resolves.toMatchObject({ uid: 'u1' });
  });

  it('未登録トークンは throw する', async () => {
    const fb = new FakeFirebaseVerifier();
    await expect(fb.verifyIdToken('nope')).rejects.toThrow('invalid firebase id token');
  });

  it('deleteUser は deleted に記録する', async () => {
    const fb = new FakeFirebaseVerifier();
    await fb.deleteUser('u1');
    expect(fb.deleted).toEqual(['u1']);
  });
});

describe('createNoopDatabase', () => {
  it('read は空配列、write/transaction は誤用検知で throw', async () => {
    const db = createNoopDatabase();
    await expect(db.read('SELECT 1')).resolves.toEqual([]);
    expect(() => db.write(async () => 1)).toThrow('noopDatabase.write');
    expect(() => db.transaction(async () => 1)).toThrow('noopDatabase.transaction');
  });
});
