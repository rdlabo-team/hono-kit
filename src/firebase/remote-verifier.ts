import { createRemoteJWKSet } from 'jose';
import { IdentityToolkit } from './identity-toolkit';
import type { ServiceAccount } from './identity-toolkit';
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

let saVerifierCache: { key: string; verifier: JoseFirebaseVerifier } | null = null;

/**
 * サービスアカウント JSON から検証器を作る便宜ファクトリ（receptray/tipsys hono の `firebaseFor` 相当）。
 * `getUser`/`deleteUser` のため `IdentityToolkit` を内包する点が `createRemoteFirebaseVerifier` との違い。
 * SA JSON 文字列をキーに isolate 内で 1 つだけキャッシュ（秘密が変わったときだけ再生成）し、
 * JWKS は `createRemoteFirebaseVerifier` と共有する。
 */
export function createServiceAccountVerifier(serviceAccountJson: string): JoseFirebaseVerifier {
  if (saVerifierCache?.key !== serviceAccountJson) {
    jwks ??= createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL));
    const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
    saVerifierCache = {
      key: serviceAccountJson,
      verifier: new JoseFirebaseVerifier({
        projectId: sa.project_id,
        keyResolver: jwks,
        identity: new IdentityToolkit(sa),
      }),
    };
  }
  return saVerifierCache.verifier;
}
