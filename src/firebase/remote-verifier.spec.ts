import { describe, expect, it } from 'vitest';
import { JoseFirebaseVerifier } from './jose-firebase-verifier.js';
import { createRemoteFirebaseVerifier, createServiceAccountVerifier } from './remote-verifier.js';

const saJson = (projectId: string) =>
  JSON.stringify({
    client_email: `svc@${projectId}.iam.gserviceaccount.com`,
    private_key: 'pk',
    project_id: projectId,
  });

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

describe('createServiceAccountVerifier', () => {
  it('SA JSON から JoseFirebaseVerifier（IdentityToolkit 内包）を返す', () => {
    expect(createServiceAccountVerifier(saJson('sa-a'))).toBeInstanceOf(JoseFirebaseVerifier);
  });

  it('同じ SA JSON は同一インスタンスをキャッシュして返す', () => {
    const json = saJson('sa-memo');
    expect(createServiceAccountVerifier(json)).toBe(createServiceAccountVerifier(json));
  });

  it('SA JSON が変われば再生成する（秘密ローテーション）', () => {
    const a = createServiceAccountVerifier(saJson('sa-1'));
    const b = createServiceAccountVerifier(saJson('sa-2'));
    expect(a).not.toBe(b);
  });
});
