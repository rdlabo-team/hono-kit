import { jwtVerify } from 'jose';
import type { CryptoKey, JWK, JWTVerifyGetKey, KeyObject } from 'jose';
import type { DecodedIdToken, FirebaseVerifier } from './firebase-verifier';
import type { IdentityToolkit } from './identity-toolkit';

// jose v6 removed `KeyLike`; the verification key is a static key (prod: createRemoteJWKSet,
// test: a CryptoKey) or a dynamic getKey function. Union both overloads' key params.
type KeyInput = CryptoKey | KeyObject | JWK | Uint8Array | JWTVerifyGetKey;

/**
 * Replaces firebase-admin getAuth().verifyIdToken() with jose RS256 verification against
 * Google's securetoken JWKS. Mirrors the admin SDK's checks: issuer/audience = projectId,
 * RS256, a non-empty subject (the uid), and a valid auth_time.
 *
 * - prod: keyResolver = createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL)).
 * - test: keyResolver = the generated public key (offline, no network).
 *
 * getUser/deleteUser delegate to Identity Toolkit REST (network); absent it throws.
 */
export const SECURETOKEN_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export class JoseFirebaseVerifier implements FirebaseVerifier {
  constructor(
    private readonly opts: {
      projectId: string;
      keyResolver: KeyInput;
      identity?: IdentityToolkit;
      now?: () => number; // seconds; injectable for tests
    },
  ) {}

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    const options = {
      issuer: `https://securetoken.google.com/${this.opts.projectId}`,
      audience: this.opts.projectId,
      algorithms: ['RS256'] as string[],
    };
    // Branch so each call matches a single jwtVerify overload (static key vs getKey fn).
    const key = this.opts.keyResolver;
    const { payload } =
      typeof key === 'function' ? await jwtVerify(idToken, key, options) : await jwtVerify(idToken, key, options);
    // Mirror firebase-admin's extra checks beyond signature/iss/aud/exp:
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
      throw new Error('Firebase ID token has an invalid subject');
    }
    const authTime = payload.auth_time;
    if (typeof authTime !== 'number' || authTime > this.nowSeconds()) {
      throw new Error('Firebase ID token has an invalid auth_time');
    }
    return { ...payload, uid: payload.sub, email: payload.email as string | undefined };
  }

  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    if (!this.opts.identity) {
      throw new Error('Identity Toolkit not configured');
    }
    return this.opts.identity.lookup(uid, this.nowSeconds());
  }

  async deleteUser(uid: string): Promise<void> {
    if (!this.opts.identity) {
      throw new Error('Identity Toolkit not configured');
    }
    await this.opts.identity.remove(uid, this.nowSeconds());
  }

  private nowSeconds(): number {
    return this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
  }
}
