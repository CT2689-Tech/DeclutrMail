import { ApiError } from '@/lib/api/client';

/**
 * Description line for a whole-surface load failure — the `ErrorState`
 * title already names WHAT did not load; this names why, then what to do.
 *
 * Only a cause the error object proves. `apiRequest` throws `ApiError`
 * when the server answered and the answer was a failure. Anything else
 * proves nothing on its own (a rejected `fetch` and a client-side throw
 * look alike), so the only other cause named is the browser's own
 * offline flag. Never the raw exception text.
 */
export function loadErrorDescription(error: unknown): string {
  if (error instanceof ApiError) return 'The server returned an error. Try again in a moment.';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline. Reconnect, then try again.";
  }
  return 'Try again in a moment.';
}
