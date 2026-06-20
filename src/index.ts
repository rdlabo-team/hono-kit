// @rdlabo/hono-kit — フリート共通のインフラ層ヘルパ（receptray / winecode / foodlabel）。
// ドメイン・DB・各 repo 固有の parity 差異（auth エラー status/body、secretId、Secret スキーマ）は
// 各 repo 側に残し、ここには「設定注入で汎用化できるインフラ」だけを置く。

// middleware
export { finalizeResponse } from './middleware/finalize-response';
export { validate } from './middleware/validation';
export type { ValidateOptions, ValidationTarget, ZodErrorLike } from './middleware/validation';
export { zNum, zNumNullable, zNumOptional, zNumWithDefault } from './middleware/zod-coerce';

// http
export { getUserProtocol } from './http/user-protocol';
export type { IUserProtocol } from './http/user-protocol';
export { getAppInfo } from './http/app-info';
export type { AppInfo } from './http/app-info';
export { HttpStatus } from './http/http-status';

// db
export { retryWhenDeadlock } from './db/retry';

// aws
export { getAuthenticationSecret } from './aws/secrets-manager';
export type { AwsSecretsOptions } from './aws/secrets-manager';

// firebase
export type { DecodedIdToken, FirebaseVerifier } from './firebase/firebase-verifier';
export { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './firebase/jose-firebase-verifier';
export { IdentityToolkit } from './firebase/identity-toolkit';
export type { ServiceAccount } from './firebase/identity-toolkit';
export { createRemoteFirebaseVerifier } from './firebase/remote-verifier';
