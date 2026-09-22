/** Bounded fan-out that drains in-flight work before propagating any failure. */
export async function boundedMap<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          results[index] = await work(items[index]!);
        } catch (error) {
          failed = true;
          failure ??= error;
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}
