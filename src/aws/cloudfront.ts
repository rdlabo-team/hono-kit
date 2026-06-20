/**
 * CloudFront 署名付き URL 生成（`@aws-sdk/cloudfront-signer` の getSignedUrl を Web Crypto で再実装）。
 * Cloudflare Workers ネイティブ（aws-sdk 不要）。フリート共通 = tipsys/winecode hono。
 *
 * canned policy を RSASSA-PKCS1-v1_5 + SHA-1 で署名し、AWS の URL-safe base64 変換
 *   '+' -> '-' , '/' -> '~' , '=' -> '_'
 * を施して `Expires` / `Key-Pair-Id` / `Signature` の順でクエリを付与する（aws-sdk の出力とバイト一致）。
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

  // @aws-sdk/cloudfront-signer のクエリ順: Expires -> Key-Pair-Id -> Signature
  return `${url}${separator}Expires=${epochSeconds}&Key-Pair-Id=${keyPairId}&Signature=${signature}`;
}

function toUrlSafeBase64(value: string): string {
  return value.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

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
