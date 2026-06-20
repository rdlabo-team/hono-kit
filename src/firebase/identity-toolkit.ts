import { SignJWT, importPKCS8 } from 'jose';

/**
 * Minimal Google Identity Toolkit client for the operations firebase-admin performed
 * that aren't token verification: accounts:lookup (getUser) and accounts:delete
 * (deleteUser). Replaces the firebase-admin Node SDK, which won't run on workerd.
 *
 * Auth: sign a JWT assertion with the service-account private key (jose), exchange it for
 * an OAuth2 access token, then call the REST API. Tokens are cached in-process.
 */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase';

export class IdentityToolkit {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly sa: ServiceAccount) {}

  private async getAccessToken(nowSeconds: number): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > nowSeconds + 60) {
      return this.accessToken.value;
    }
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.sa.client_email)
      .setSubject(this.sa.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .sign(key);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      throw new Error(`Identity Toolkit token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: nowSeconds + json.expires_in };
    return json.access_token;
  }

  async lookup(uid: string, nowSeconds: number): Promise<{ uid: string; email?: string } | null> {
    const token = await this.getAccessToken(nowSeconds);
    const res = await fetch(`${IDENTITY_TOOLKIT}/projects/${this.sa.project_id}/accounts:lookup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { users?: { localId: string; email?: string }[] };
    const user = json.users?.[0];
    return user ? { uid: user.localId, email: user.email } : null;
  }

  async remove(uid: string, nowSeconds: number): Promise<void> {
    const token = await this.getAccessToken(nowSeconds);
    const res = await fetch(`${IDENTITY_TOOLKIT}/projects/${this.sa.project_id}/accounts:delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
    });
    if (!res.ok) {
      throw new Error(`Identity Toolkit delete failed: ${res.status}`);
    }
  }
}
