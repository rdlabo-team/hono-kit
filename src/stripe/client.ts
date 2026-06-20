import Stripe from 'stripe';

/**
 * Stripe クライアント生成（フリート共通 = receptray/tipsys hono）。Cloudflare Workers には Node の
 * http スタックが無いため、Stripe SDK の fetch ベース HttpClient を使う。
 *
 * `apiVersion` は **任意**: 各 repo の `/api`（NestJS）と挙動を一致させるため、固定したい repo は
 * 渡し（例 tipsys は `'2024-04-10'`）、SDK 既定で良い repo は省く（例 receptray）。
 */
export interface CreateStripeClientOptions {
  /** 固定する Stripe API バージョン。省略すると SDK 既定。 */
  apiVersion?: string;
}

export function createStripeClient(secret: string, options: CreateStripeClientOptions = {}): Stripe {
  if (!secret) {
    throw new Error('Stripe secret is not set');
  }
  const config: Stripe.StripeConfig = { httpClient: Stripe.createFetchHttpClient() };
  if (options.apiVersion) {
    config.apiVersion = options.apiVersion as Stripe.StripeConfig['apiVersion'];
  }
  return new Stripe(secret, config);
}

/**
 * Webhook 署名の検証。Workers では同期版 `constructEvent` が使えない（SubtleCrypto が非同期）ため
 * `constructEventAsync` + `SubtleCryptoProvider` を使う。`secret` は署名検証には無関係だが、検証用の
 * クライアント生成に必要（API コールはしない）。
 */
export function verifyStripeWebhook(
  secret: string,
  webhookSecret: string,
  payload: string | ArrayBuffer,
  signature: string,
): Promise<Stripe.Event> {
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not set');
  }
  const stripe = createStripeClient(secret);
  return stripe.webhooks.constructEventAsync(
    payload as string,
    signature,
    webhookSecret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
