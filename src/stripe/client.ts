import Stripe from 'stripe';

/**
 * Options for {@link createStripeClient}.
 */
export interface CreateStripeClientOptions {
  /**
   * Stripe API version to pin the client to. When omitted, the SDK's built-in default is used.
   * Pin it when you need stable, reproducible API behavior independent of SDK upgrades.
   */
  apiVersion?: string;
}

/**
 * Create a Stripe client configured to run on Cloudflare Workers.
 *
 * @remarks
 * Workers has no Node.js `http` stack, so the client is built with `Stripe.createFetchHttpClient()`
 * (a `fetch`-based HTTP client) instead of the SDK's default Node transport.
 *
 * @param secret - Stripe secret API key.
 * @param options - Optional client configuration; see {@link CreateStripeClientOptions}.
 * @returns A configured {@link Stripe} instance.
 * @throws Error when `secret` is empty.
 * @example
 * ```ts
 * const stripe = createStripeClient(env.STRIPE_SECRET, { apiVersion: '2024-04-10' });
 * const customer = await stripe.customers.retrieve(customerId);
 * ```
 */
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
 * Verify a Stripe webhook signature and return the parsed event.
 *
 * @remarks
 * Uses `constructEventAsync` together with `Stripe.createSubtleCryptoProvider()` because the Workers
 * crypto API (SubtleCrypto) is asynchronous and the synchronous `constructEvent` is unavailable.
 * The `secret` is not used by signature verification itself, but a client must be constructed to
 * perform the check; no Stripe API call is made.
 *
 * @param secret - Stripe secret API key, used only to construct the verifying client.
 * @param webhookSecret - Endpoint signing secret used to validate the signature.
 * @param payload - Raw request body exactly as received (string or `ArrayBuffer`).
 * @param signature - Value of the `Stripe-Signature` request header.
 * @returns The verified {@link Stripe.Event}.
 * @throws Error when `webhookSecret` is empty, or when `secret` is empty (the verifying client cannot be constructed).
 * @throws Stripe.errors.StripeSignatureVerificationError when the signature does not match.
 * @example
 * ```ts
 * const event = await verifyStripeWebhook(
 *   env.STRIPE_SECRET,
 *   env.STRIPE_WEBHOOK_SECRET,
 *   await request.text(),
 *   request.headers.get('stripe-signature')!,
 * );
 * ```
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
