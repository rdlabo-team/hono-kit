import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityToolkit } from './identity-toolkit.js';
import type { ServiceAccount } from './identity-toolkit.js';

const NOW = 1_700_000_000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function makeServiceAccount(): Promise<ServiceAccount> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    client_email: 'svc@proj.iam.gserviceaccount.com',
    private_key: await exportPKCS8(privateKey),
    project_id: 'proj',
  };
}

function stubFetch(handler: (url: string) => Response) {
  const fetchMock = vi.fn((input: string, _init?: RequestInit) => Promise.resolve(handler(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const tokenResponse = () => new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });

describe('IdentityToolkit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lookup はアクセストークンを取得してユーザーを返す', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === TOKEN_URL) {
        return tokenResponse();
      }
      if (url.endsWith('accounts:lookup')) {
        return new Response(JSON.stringify({ users: [{ localId: 'uid1', email: 'a@b.c' }] }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    });
    const client = new IdentityToolkit(await makeServiceAccount());
    await expect(client.lookup('uid1', NOW)).resolves.toEqual({ uid: 'uid1', email: 'a@b.c' });
    const lookupCall = fetchMock.mock.calls.find(([u]) => u.endsWith('accounts:lookup'));
    expect(lookupCall?.[1]).toMatchObject({ method: 'POST' });
  });

  it('lookup で該当ユーザーが無ければ null', async () => {
    stubFetch((url) =>
      url === TOKEN_URL ? tokenResponse() : new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );
    const client = new IdentityToolkit(await makeServiceAccount());
    await expect(client.lookup('missing', NOW)).resolves.toBeNull();
  });

  it('lookup が 4xx なら null', async () => {
    stubFetch((url) => (url === TOKEN_URL ? tokenResponse() : new Response('forbidden', { status: 403 })));
    const client = new IdentityToolkit(await makeServiceAccount());
    await expect(client.lookup('uid1', NOW)).resolves.toBeNull();
  });

  it('アクセストークンを isolate 内でキャッシュする（token 交換は 1 回）', async () => {
    const fetchMock = stubFetch((url) =>
      url === TOKEN_URL
        ? tokenResponse()
        : new Response(JSON.stringify({ users: [{ localId: 'uid1' }] }), { status: 200 }),
    );
    const client = new IdentityToolkit(await makeServiceAccount());
    await client.lookup('uid1', NOW);
    await client.lookup('uid1', NOW + 10);
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => u === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
  });

  it('remove は成功時に解決し、失敗時に throw する', async () => {
    stubFetch((url) => (url === TOKEN_URL ? tokenResponse() : new Response(null, { status: 200 })));
    const client = new IdentityToolkit(await makeServiceAccount());
    await expect(client.remove('uid1', NOW)).resolves.toBeUndefined();

    stubFetch((url) => (url === TOKEN_URL ? tokenResponse() : new Response('err', { status: 500 })));
    const client2 = new IdentityToolkit(await makeServiceAccount());
    await expect(client2.remove('uid1', NOW)).rejects.toThrow('Identity Toolkit delete failed');
  });
});
