/**
 * Build a test double from a partial implementation: configured members are returned as-is, while
 * calling any unconfigured member fails explicitly with `` `${name}.${method} not configured` ``.
 *
 * @remarks
 * Replaces the hand-written "accept a `Partial<impl>` and throw on anything unset" fake classes that
 * tend to proliferate per gateway. Because gateway interfaces differ by domain (Stripe, etc.), this
 * lets you stub only the members a given test exercises in a single line.
 *
 * @typeParam T - The interface being faked.
 * @param impl - Partial implementation; only the members the test needs.
 * @param name - Label used in the "not configured" error message (defaults to `'fake'`).
 * @returns A proxy typed as `T` that delegates to `impl` and throws on unconfigured members.
 * @throws Error `` `${name}.${method} not configured` `` when an unconfigured string-keyed member is called.
 * @example
 * ```ts
 * const stripe = configurableFake<StripeGateway>(
 *   { listPaymentIntents: async () => fakeApiList([fakePaymentIntent()]) },
 *   'FakeStripeGateway',
 * );
 * await stripe.listPaymentIntents(); // ok
 * await stripe.cancelPaymentIntent('pi_1'); // throws: FakeStripeGateway.cancelPaymentIntent not configured
 * ```
 */
export function configurableFake<T extends object>(impl: Partial<T>, name = 'fake'): T {
  return new Proxy(impl, {
    get(target, prop) {
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      // Never return the "unconfigured member" function for Promise-interop properties. Doing so would
      // make the fake itself look thenable, so accidentally awaiting it (or passing it to
      // Promise.resolve) would invoke then() and throw — a subtle footgun.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      if (typeof prop === 'string') {
        return () => {
          throw new Error(`${name}.${prop} not configured`);
        };
      }
      return undefined;
    },
  }) as T;
}
