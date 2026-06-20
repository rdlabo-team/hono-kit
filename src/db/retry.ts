/**
 * ER_LOCK_DEADLOCK を指数バックオフで retry する（NestJS/TypeORM の retryWhenDeadlock 相当）。
 * MySQL はデッドロック時にトランザクション全体をロールバックするため、同じ作業単位の再実行は安全。
 * `fn` は単一文（write）またはトランザクション全体（transaction）であること — retry は `fn` 全体を再実行する。
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
