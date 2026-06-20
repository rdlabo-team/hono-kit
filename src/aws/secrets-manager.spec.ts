import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthenticationSecret } from './secrets-manager';

interface TestSecret {
  firebaseDevelopment: string;
  firebaseProduction: string;
  stripeSecret: string;
  encryptionKey: string;
}

describe('secrets-manager (aws4fetch GetSecretValue)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signs a GetSecretValue call to the given secretId, parses SecretString, and caches per isolate', async () => {
    const payload: TestSecret = {
      firebaseDevelopment: '{"project_id":"dev"}',
      firebaseProduction: '{"project_id":"prod"}',
      stripeSecret: 'sk_live_x',
      encryptionKey: 'prod-encryption-key',
    };
    const fetchMock = vi.fn(
      (_input: Request | string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ SecretString: JSON.stringify(payload) }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const opts = { accessKeyId: 'AKIAtest', secretAccessKey: 'secret', region: 'ap-northeast-1' };
    const result = await getAuthenticationSecret<TestSecret>(opts, 'rdlabo/secret');
    expect(result).toEqual(payload);

    // aws4fetch signs and calls fetch(signedRequest).
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://secretsmanager.ap-northeast-1.amazonaws.com/');
    expect(request.headers.get('x-amz-target')).toBe('secretsmanager.GetSecretValue');
    expect(request.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    expect(await request.clone().json()).toEqual({ SecretId: 'rdlabo/secret', VersionStage: 'AWSCURRENT' });

    // Second call with the same credentials + secretId is served from the per-isolate cache.
    const cached = await getAuthenticationSecret<TestSecret>(opts, 'rdlabo/secret');
    expect(cached).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('別の secretId は別フェッチになる（キャッシュキーに secretId を含む）', async () => {
    const fetchMock = vi.fn(
      () => new Response(JSON.stringify({ SecretString: JSON.stringify({ ok: true }) }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const opts = { accessKeyId: 'AKIA-a', secretAccessKey: 's', region: 'ap-northeast-1' };
    await getAuthenticationSecret(opts, 'app/secret-a');
    await getAuthenticationSecret(opts, 'app/secret-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('レスポンスが ok でなければ throw する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('AccessDenied', { status: 400 })),
    );
    await expect(
      getAuthenticationSecret({ accessKeyId: 'AKIA-err', secretAccessKey: 's', region: 'ap-northeast-1' }, 'app/err'),
    ).rejects.toThrow('Secrets Manager GetSecretValue failed: 400');
  });

  it('SecretString が無ければ throw する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      getAuthenticationSecret({ accessKeyId: 'AKIA-no', secretAccessKey: 's', region: 'ap-northeast-1' }, 'app/no'),
    ).rejects.toThrow('returned no SecretString');
  });

  it('失敗時はキャッシュをクリアして次回 retry できる', async () => {
    const opts = { accessKeyId: 'AKIA-retry', secretAccessKey: 's', region: 'ap-northeast-1' };
    // 注: aws4fetch は 5xx レスポンスを内部 retry するため、ここでは network error（reject）で失敗させる。
    let call = 0;
    const fetchMock = vi.fn(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(new Response(JSON.stringify({ SecretString: JSON.stringify({ ok: true }) }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAuthenticationSecret(opts, 'app/retry')).rejects.toThrow();
    // 直前の reject でキャッシュがクリアされているので、同じキーでも再フェッチして成功する。
    await expect(getAuthenticationSecret(opts, 'app/retry')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
