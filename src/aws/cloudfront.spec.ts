import { describe, expect, it } from 'vitest';
import { getCloudFrontSignedUrl } from './cloudfront';

function derToPem(der: ArrayBuffer): string {
  const bytes = new Uint8Array(der);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function fromUrlSafeBase64(value: string): Uint8Array {
  const std = value.replace(/-/g, '+').replace(/~/g, '/').replace(/_/g, '=');
  const binary = atob(std);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function genKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true,
    ['sign', 'verify'],
  );
  if (!('privateKey' in kp)) {
    throw new Error('expected a key pair');
  }
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { pem: derToPem(pkcs8), publicKey: kp.publicKey };
}

describe('getCloudFrontSignedUrl', () => {
  it('Expires -> Key-Pair-Id -> Signature の順でクエリを付与する（aws-sdk 互換）', async () => {
    const { pem } = await genKeyPair();
    const signed = await getCloudFrontSignedUrl('https://cdn.example.com/a.jpg', pem, 'KP123', 1_700_000_000_000);
    expect(signed).toMatch(
      /^https:\/\/cdn\.example\.com\/a\.jpg\?Expires=1700000000&Key-Pair-Id=KP123&Signature=[^&]+$/,
    );
  });

  it('Signature は URL-safe base64（+ / = を含まない）', async () => {
    const { pem } = await genKeyPair();
    const signed = await getCloudFrontSignedUrl(
      'https://cdn.example.com/a.jpg',
      pem,
      'KP',
      new Date(1_700_000_000_000),
    );
    const sig = new URL(signed).searchParams.get('Signature') ?? '';
    expect(sig).not.toMatch(/[+/=]/);
  });

  it('既存クエリがある URL は & で連結する', async () => {
    const { pem } = await genKeyPair();
    const signed = await getCloudFrontSignedUrl('https://cdn.example.com/a.jpg?v=2', pem, 'KP', 1_700_000_000);
    expect(signed).toContain('a.jpg?v=2&Expires=');
  });

  it('生成した署名は canned policy に対して検証できる（往復）', async () => {
    const { pem, publicKey } = await genKeyPair();
    const url = 'https://cdn.example.com/secret.pdf';
    const epoch = 1_700_000_000;
    const signed = await getCloudFrontSignedUrl(url, pem, 'KP', epoch * 1000);
    const sig = fromUrlSafeBase64(new URL(signed).searchParams.get('Signature') ?? '');
    const policy = JSON.stringify({
      Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': epoch } } }],
    });
    const ok = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      sig,
      new TextEncoder().encode(policy),
    );
    expect(ok).toBe(true);
  });
});
