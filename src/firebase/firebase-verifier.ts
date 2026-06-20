/** Firebase boundary replacing the firebase-admin Auth surface used by `/api`. */
export interface DecodedIdToken {
  uid: string;
  email?: string;
  [claim: string]: unknown;
}

export interface FirebaseVerifier {
  /** Mirrors firebase-admin getAuth().verifyIdToken(). Throws on invalid token. */
  verifyIdToken(idToken: string): Promise<DecodedIdToken>;
  /** Mirrors getAuth().getUser(); returns null when the user is absent. */
  getUser(uid: string): Promise<{ uid: string; email?: string } | null>;
  /** Mirrors getAuth().deleteUser(). */
  deleteUser(uid: string): Promise<void>;
}
