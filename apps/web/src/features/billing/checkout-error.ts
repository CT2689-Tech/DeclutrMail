/** Retry is offered only before calling a provider's open operation. */
export class CheckoutLaunchError extends Error {
  constructor(public readonly canRetry: boolean) {
    super('The secure checkout window could not be opened.');
    this.name = 'CheckoutLaunchError';
  }
}

export const CHECKOUT_LOAD_TIMEOUT_MS = 15_000;
export async function withCheckoutLoadDeadline<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CheckoutLaunchError(true)), CHECKOUT_LOAD_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new CheckoutLaunchError(true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
