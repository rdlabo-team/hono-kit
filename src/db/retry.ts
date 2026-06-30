/**
 * Run an async unit of work, retrying it on MySQL deadlock errors with exponential backoff.
 *
 * Retries are triggered only by the `ER_LOCK_DEADLOCK` error code. Each failed attempt waits
 * `delay * attempt` milliseconds (linear growth of the base delay) before the next try, and any
 * non-deadlock error is rethrown immediately without retrying.
 *
 * @remarks
 * MySQL rolls back the entire transaction when it detects a deadlock, so re-running the same unit
 * of work is safe. Pass a `fn` that represents one complete unit — a single statement or an entire
 * transaction — because the whole `fn` is re-executed on each retry.
 *
 * @typeParam T - resolved value produced by `fn`.
 * @param fn - the unit of work to execute; it is invoked again from scratch on each retry.
 * @param retries - maximum number of attempts (default `3`).
 * @param delay - base backoff in milliseconds; attempt N waits `delay * N` (default `100`).
 * @returns the value resolved by the first successful call to `fn`.
 * @throws the last error thrown by `fn` once retries are exhausted, or any non-deadlock error on
 * the first occurrence.
 * @example
 * ```ts
 * await retryWhenDeadlock(() => db.transaction(async (tx) => {
 *   await tx.insert(orders).values(order);
 *   await tx.update(stock).set({ qty: sql`qty - 1` }).where(eq(stock.id, order.itemId));
 * }));
 * ```
 */
export async function retryWhenDeadlock<T>(fn: () => Promise<T>, retries = 3, delay = 100): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ER_LOCK_DEADLOCK' && attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  // Unreachable: the loop returns on success and throws on the final failed attempt.
  throw new Error('retryWhenDeadlock: exhausted retries');
}
