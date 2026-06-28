// @rdlabo/workers-hono-kit — フリート共通のインフラ層ヘルパ（receptray / winecode / foodlabel）。
// ドメイン・DB・各 repo 固有の parity 差異（auth エラー status/body、secretId、Secret スキーマ）は
// 各 repo 側に残し、ここには「設定注入で汎用化できるインフラ」だけを置く。

// middleware
export { finalizeResponse } from './middleware/finalize-response.js';
export { validate, createSentryValidate } from './middleware/validation.js';
export type {
  ValidateOptions,
  ValidationTarget,
  ZodErrorLike,
  SentryLike,
  SentryScopeLike,
} from './middleware/validation.js';
export { zNum, zNumNullable, zNumOptional, zNumWithDefault } from './middleware/zod-coerce.js';
export { createAuthMiddleware } from './middleware/auth.js';
export type { AuthMiddlewareOptions } from './middleware/auth.js';

// http
export { getUserProtocol } from './http/user-protocol.js';
export type { IUserProtocol } from './http/user-protocol.js';
export { getAppInfo } from './http/app-info.js';
export type { AppInfo } from './http/app-info.js';
export { resolveAppEnv, isProductionEnv } from './http/app-env.js';
export type { AppEnv } from './http/app-env.js';
export { HttpStatus } from './http/http-status.js';
export { createNestErrorHandler, nestNotFoundHandler, NEST_REASON_PHRASES } from './http/nest-error.js';
export type { NestErrorHandlerOptions, ErrorReportContext, ErrorReporter } from './http/nest-error.js';

// cache
export { KVCache } from './cache/kv-cache.js';
export type { KVNamespace, KVCacheOptions } from './cache/kv-cache.js';

// stripe
export { createStripeClient, verifyStripeWebhook } from './stripe/client.js';
export type { CreateStripeClientOptions } from './stripe/client.js';

// db
export { retryWhenDeadlock } from './db/retry.js';

// ai
export { createAiGatewayProvider } from './ai/gateway.js';
export type {
  AiGatewayConfig,
  AiGatewayProvider,
  AiGatewayBinding,
  AiGateway,
  AiGatewayOptions,
} from './ai/gateway.js';

// aws
export { getAuthenticationSecret } from './aws/secrets-manager.js';
export type { AwsSecretsOptions } from './aws/secrets-manager.js';
export { getCloudFrontSignedUrl } from './aws/cloudfront.js';

// firebase
export type { DecodedIdToken, FirebaseVerifier } from './firebase/firebase-verifier.js';
export { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './firebase/jose-firebase-verifier.js';
export { IdentityToolkit } from './firebase/identity-toolkit.js';
export type { ServiceAccount } from './firebase/identity-toolkit.js';
export { createRemoteFirebaseVerifier, createServiceAccountVerifier } from './firebase/remote-verifier.js';
