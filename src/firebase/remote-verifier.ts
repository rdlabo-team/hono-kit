import { createRemoteJWKSet } from 'jose';
import { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './jose-firebase-verifier';

/**
 * 本番用の便宜ファクトリ。`createRemoteJWKSet` で Google securetoken の公開鍵を取り、
 * `JoseFirebaseVerifier` を返す。トークン検証のみ用途（getUser/deleteUser は不要 = Identity Toolkit 無し）。
 *
 * JWKS は URL 固定なので isolate 内で 1 度だけ生成して共有し（jose が内部メモリにキャッシュ）、
 * verifier は projectId ごとにメモ化する。winecode の旧 `verifyFirebaseIdToken`（module-level JWKS）の
 * キャッシュ挙動を保つための置換。
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const verifiers = new Map<string, JoseFirebaseVerifier>();

export function createRemoteFirebaseVerifier(projectId: string): JoseFirebaseVerifier {
  jwks ??= createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL));
  let verifier = verifiers.get(projectId);
  if (!verifier) {
    verifier = new JoseFirebaseVerifier({ projectId, keyResolver: jwks });
    verifiers.set(projectId, verifier);
  }
  return verifier;
}
