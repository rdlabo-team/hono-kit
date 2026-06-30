import { createRemoteJWKSet } from 'jose';
import { IdentityToolkit } from './identity-toolkit.js';
import type { ServiceAccount } from './identity-toolkit.js';
import { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './jose-firebase-verifier.js';

/**
 * Shared remote JWKS for Google's securetoken keys.
 *
 * @remarks
 * The JWKS URL is fixed, so the set is created once per isolate and shared across verifiers
 * (`jose` caches the fetched keys internally). Lazily initialised on first use.
 *
 * @internal
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
/**
 * Per-`projectId` cache of token-only verifiers, memoized for the lifetime of the isolate.
 *
 * @internal
 */
const verifiers = new Map<string, JoseFirebaseVerifier>();

/**
 * Create a token-verification-only Firebase verifier for the given project.
 *
 * Uses `createRemoteJWKSet` to fetch Google's securetoken public keys and returns a
 * {@link JoseFirebaseVerifier}. This factory is for token verification only; it configures no
 * Identity Toolkit client, so `getUser` / `deleteUser` are unavailable.
 *
 * @remarks
 * The remote JWKS is created once per isolate and shared, and the returned verifier is
 * memoized per `projectId`. This preserves the caching behaviour of a module-level JWKS so
 * repeated calls do not re-fetch keys or allocate new verifiers.
 *
 * @param projectId - The Firebase project id whose tokens will be verified.
 * @returns A verifier that validates ID tokens for `projectId`.
 * @example
 * ```ts
 * const verifier = createRemoteFirebaseVerifier('my-firebase-project');
 * const decoded = await verifier.verifyIdToken(idToken);
 * console.log(decoded.uid);
 * ```
 */
export function createRemoteFirebaseVerifier(projectId: string): JoseFirebaseVerifier {
  jwks ??= createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL));
  let verifier = verifiers.get(projectId);
  if (!verifier) {
    verifier = new JoseFirebaseVerifier({ projectId, keyResolver: jwks });
    verifiers.set(projectId, verifier);
  }
  return verifier;
}

/**
 * Single-entry cache of the service-account verifier, keyed by the raw service-account JSON.
 *
 * @internal
 */
let saVerifierCache: { key: string; verifier: JoseFirebaseVerifier } | null = null;

/**
 * Create a Firebase verifier from a service-account JSON string.
 *
 * Unlike {@link createRemoteFirebaseVerifier}, the returned {@link JoseFirebaseVerifier}
 * embeds an {@link IdentityToolkit} client, enabling `getUser` and `deleteUser` in addition to
 * token verification.
 *
 * @remarks
 * The verifier is cached for the lifetime of the isolate, keyed by the service-account JSON
 * string, and is only rebuilt when that secret changes. The remote JWKS is shared with
 * {@link createRemoteFirebaseVerifier}.
 *
 * @param serviceAccountJson - The service-account key as a JSON string (parsed into {@link ServiceAccount}).
 * @returns A verifier that validates ID tokens and can look up or delete users.
 * @throws If `serviceAccountJson` is not valid JSON.
 * @example
 * ```ts
 * const verifier = createServiceAccountVerifier(env.FIREBASE_SERVICE_ACCOUNT);
 * const decoded = await verifier.verifyIdToken(idToken);
 * const user = await verifier.getUser(decoded.uid);
 * await verifier.deleteUser(decoded.uid);
 * ```
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
