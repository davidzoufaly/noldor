/**
 * Run `fn` over `items` with at most `limit` in flight at once. Resolves when all
 * have completed; `fn` should swallow/record its own errors (a throw rejects the run).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor++;
          if (index >= items.length) break;
          await fn(items[index]!, index);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
