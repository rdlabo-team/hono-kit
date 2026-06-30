import type Stripe from 'stripe';

/**
 * Test fixture factories for Stripe objects.
 *
 * The real SDK types are enormous, so each factory builds only the fields tests typically read,
 * fills them with reasonable defaults, lets you override via `over`, and casts to the Stripe type
 * once at the end. This consolidates the duplicated hand-built dummy `PaymentIntent`/`Event`/... that
 * billing tests tend to reconstruct in every project.
 */

/**
 * Build a fake Stripe `ApiList` wrapping the given data.
 *
 * @remarks Defaults: `object: 'list'`, `has_more: false`, `url: '/v1/_test'`.
 * @typeParam T - Element type of the list.
 * @param data - Items to place in `data`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.ApiList<T>` fixture.
 * @example
 * ```ts
 * const list = fakeApiList([fakePaymentIntent()]);
 * ```
 */
export function fakeApiList<T>(data: T[], over: Partial<Stripe.ApiList<T>> = {}): Stripe.ApiList<T> {
  return {
    object: 'list',
    data,
    has_more: false,
    url: '/v1/_test',
    ...over,
  };
}

/**
 * Build a fake Stripe `PaymentIntent`.
 *
 * @remarks Defaults: `id: 'pi_test_1'`, `object: 'payment_intent'`, `amount: 1000`, `currency: 'jpy'`,
 * `status: 'succeeded'`, `created: 1_700_000_000`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.PaymentIntent` fixture.
 * @example
 * ```ts
 * const pi = fakePaymentIntent({ status: 'requires_payment_method' });
 * ```
 */
export function fakePaymentIntent(over: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: 'pi_test_1',
    object: 'payment_intent',
    amount: 1000,
    currency: 'jpy',
    status: 'succeeded',
    created: 1_700_000_000,
    ...over,
  } as Stripe.PaymentIntent;
}

/**
 * Build a fake Stripe webhook `Event` wrapping the given payload.
 *
 * @remarks Defaults: `id: 'evt_test_1'`, `object: 'event'`, `api_version: '2024-06-20'`,
 * `created: 1_700_000_000`, `livemode: false`. The payload is placed at `data.object`.
 * @param type - Event type (e.g. `'payment_intent.succeeded'`), assigned to `type`.
 * @param dataObject - The object placed at `data.object`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.Event` fixture.
 * @example
 * ```ts
 * const event = fakeStripeEvent('payment_intent.succeeded', fakePaymentIntent());
 * ```
 */
export function fakeStripeEvent(type: string, dataObject: unknown, over: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_test_1',
    object: 'event',
    api_version: '2024-06-20',
    created: 1_700_000_000,
    livemode: false,
    type,
    data: { object: dataObject },
    ...over,
  } as Stripe.Event;
}

/**
 * Build a fake Stripe `Checkout.Session`.
 *
 * @remarks Defaults: `id: 'cs_test_1'`, `object: 'checkout.session'`,
 * `url: 'https://checkout.stripe.test/cs_test_1'`, `mode: 'subscription'`, `status: 'open'`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.Checkout.Session` fixture.
 * @example
 * ```ts
 * const session = fakeCheckoutSession({ status: 'complete' });
 * ```
 */
export function fakeCheckoutSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    url: 'https://checkout.stripe.test/cs_test_1',
    mode: 'subscription',
    status: 'open',
    ...over,
  } as Stripe.Checkout.Session;
}

/**
 * Build a fake Stripe `Customer`.
 *
 * @remarks Defaults: `id: 'cus_test_1'`, `object: 'customer'`, `created: 1_700_000_000`,
 * `livemode: false`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.Customer` fixture.
 * @example
 * ```ts
 * const customer = fakeCustomer({ email: 'a@example.com' });
 * ```
 */
export function fakeCustomer(over: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: 'cus_test_1',
    object: 'customer',
    created: 1_700_000_000,
    livemode: false,
    ...over,
  } as Stripe.Customer;
}

/**
 * Build a fake Stripe `Price`.
 *
 * @remarks Defaults: `id: 'price_test_1'`, `object: 'price'`, `active: true`, `currency: 'jpy'`,
 * `unit_amount: 1000`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.Price` fixture.
 * @example
 * ```ts
 * const price = fakePrice({ unit_amount: 2000 });
 * ```
 */
export function fakePrice(over: Partial<Stripe.Price> = {}): Stripe.Price {
  return {
    id: 'price_test_1',
    object: 'price',
    active: true,
    currency: 'jpy',
    unit_amount: 1000,
    ...over,
  } as Stripe.Price;
}

/**
 * Build a fake Stripe `Subscription`.
 *
 * @remarks Defaults: `id: 'sub_test_1'`, `object: 'subscription'`, `status: 'active'`,
 * `customer: 'cus_test_1'`, `created: 1_700_000_000`.
 * @param over - Field overrides merged last.
 * @returns A `Stripe.Subscription` fixture.
 * @example
 * ```ts
 * const sub = fakeSubscription({ status: 'canceled' });
 * ```
 */
export function fakeSubscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_1',
    created: 1_700_000_000,
    ...over,
  } as Stripe.Subscription;
}
