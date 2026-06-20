import { AwsClient } from 'aws4fetch';

/**
 * AWS Secrets Manager の GetSecretValue を aws4fetch（SigV4 署名 fetch）で叩く汎用ヘルパ。
 * Cloudflare Workers には AWS SDK も IAM ロールも無いため、AWS の静的キーを Workers secrets として
 * 渡して署名する（移植元 `api/src/secrets-manager.ts` 相当）。DB 認証情報は Hyperdrive 側に持つので対象外。
 *
 * Secret の中身（スキーマ）と secretId は repo ごとに異なるため、`<T>` と `secretId` を呼び出し側が渡す。
 */
export interface AwsSecretsOptions {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

/**
 * Per-isolate cache: Secrets Manager は isolate ごと 1 回だけ叩く。region+accessKeyId+secretId を
 * キーにし、資格情報ローテーション時は再取得する。promise をキャッシュして同時初回リクエストが 1 回の
 * 呼び出しを共有する。reject 時はキャッシュをクリアして retry を許す。
 */
let cache: { key: string; value: Promise<unknown> } | null = null;

export function getAuthenticationSecret<T>(options: AwsSecretsOptions, secretId: string): Promise<T> {
  const key = `${options.region}:${options.accessKeyId}:${secretId}`;
  if (cache?.key !== key) {
    const value = fetchSecret(options, secretId).catch((error: unknown) => {
      cache = null;
      throw error;
    });
    cache = { key, value };
  }
  return cache.value as Promise<T>;
}

async function fetchSecret(options: AwsSecretsOptions, secretId: string): Promise<unknown> {
  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    sessionToken: options.sessionToken,
    service: 'secretsmanager',
    region: options.region,
  });

  const response = await aws.fetch(`https://secretsmanager.${options.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'secretsmanager.GetSecretValue',
    },
    body: JSON.stringify({ SecretId: secretId, VersionStage: 'AWSCURRENT' }),
  });

  if (!response.ok) {
    throw new Error(`Secrets Manager GetSecretValue failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { SecretString?: string };
  if (!body.SecretString) {
    throw new Error('Secrets Manager GetSecretValue returned no SecretString');
  }
  return JSON.parse(body.SecretString);
}
