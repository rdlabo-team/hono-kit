import { describe, expect, it } from 'vitest';
import { JoseFirebaseVerifier } from './jose-firebase-verifier';
import { createRemoteFirebaseVerifier } from './remote-verifier';

describe('createRemoteFirebaseVerifier', () => {
  it('JoseFirebaseVerifier を返す', () => {
    expect(createRemoteFirebaseVerifier('proj-a')).toBeInstanceOf(JoseFirebaseVerifier);
  });

  it('同じ projectId は同一インスタンスをメモ化して返す（JWKS キャッシュ維持）', () => {
    const a = createRemoteFirebaseVerifier('proj-memo');
    const b = createRemoteFirebaseVerifier('proj-memo');
    expect(a).toBe(b);
  });

  it('projectId が違えば別インスタンス', () => {
    const a = createRemoteFirebaseVerifier('proj-x');
    const b = createRemoteFirebaseVerifier('proj-y');
    expect(a).not.toBe(b);
  });
});
