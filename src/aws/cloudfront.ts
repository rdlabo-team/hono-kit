/**
 * Generate a CloudFront signed URL using a canned policy, implemented natively for Cloudflare Workers.
 *
 * Reimplements `getSignedUrl` from `@aws-sdk/cloudfront-signer` on top of the Web Crypto API, so no
 * `@aws-sdk` dependency is required. The canned policy is signed with RSASSA-PKCS1-v1_5 and SHA-1, the
 * signature is converted to AWS URL-safe base64 (`+` -> `-`, `/` -> `~`, `=` -> `_`), and the query
 * parameters are appended in the order `Expires`, `Key-Pair-Id`, `Signature`.
 *
 * @remarks
 * The output is byte-for-byte identical to that of `@aws-sdk/cloudfront-signer`.
 *
 * @param url - The resource URL to sign.
 * @param privateKeyPem - The CloudFront key group private key in PKCS#8 PEM format.
 * @param keyPairId - The CloudFront public key (key pair) ID associated with the private key.
 * @param dateLessThan - Expiry time, accepted as a `Date`, epoch-millisecond number, or date string.
 * @returns The signed URL with the `Expires`, `Key-Pair-Id`, and `Signature` query parameters appended.
 * @example
 * ```ts
 * const signedUrl = await getCloudFrontSignedUrl(
 *   'https://cdn.example.com/private/video.mp4',
 *   env.CLOUDFRONT_PRIVATE_KEY,
 *   env.CLOUDFRONT_KEY_PAIR_ID,
 *   Date.now() + 60 * 60 * 1000, // valid for one hour
 * );
 * ```
 */
export async function getCloudFrontSignedUrl(
  url: string,
  privateKeyPem: string,
  keyPairId: string,
  dateLessThan: string | number | Date,
): Promise<string> {
  const epochSeconds = Math.round(new Date(dateLessThan).getTime() / 1000);

  const policy = JSON.stringify({
    Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': epochSeconds } } }],
  });

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(policy),
  );

  const signature = toUrlSafeBase64(arrayBufferToBase64(signatureBuffer));
  const separator = url.includes('?') ? '&' : '?';

  // Query order used by @aws-sdk/cloudfront-signer: Expires -> Key-Pair-Id -> Signature
  return `${url}${separator}Expires=${epochSeconds}&Key-Pair-Id=${keyPairId}&Signature=${signature}`;
}

/**
 * Convert standard base64 to the URL-safe alphabet expected in CloudFront signatures.
 *
 * @param value - A standard base64 string.
 * @returns The base64 string with `+` -> `-`, `=` -> `_`, and `/` -> `~`.
 * @internal
 */

function toUrlSafeBase64(value: string): string {
  return value.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

/**
 * Encode an `ArrayBuffer` to standard base64.
 *
 * @param buffer - The raw bytes to encode.
 * @returns The standard base64 representation of the buffer.
 * @internal
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Decode a PKCS#8 PEM private key into its DER `ArrayBuffer`.
 *
 * @param pem - The PEM-encoded key, including the BEGIN/END armor.
 * @returns The decoded DER bytes, suitable for `crypto.subtle.importKey('pkcs8', ...)`.
 * @internal
 */
function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
