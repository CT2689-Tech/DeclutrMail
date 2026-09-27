/**
 * Change the address bar in place, with no navigation, and keep Next's
 * router in step with it. For effects that clear a one-shot param on the
 * first render.
 *
 * Next's patched `history.replaceState` tells its router about the new
 * URL, with two gaps. It skips any call whose state carries Next's own
 * marker, and `window.history.state` always does. It also installs the
 * patch from an effect in its root, which runs after every child effect
 * of the same commit. A scrub that fell into either gap left the old URL
 * in the router, and the next `router.refresh()` (a mailbox switch) wrote
 * it back, so a reload replayed the result and put the mailbox id back in
 * history. Waiting a microtask and passing `null`, as Next's docs do,
 * closes both; Next copies its own history state across.
 */
export function replaceUrl(url: string | URL): void {
  queueMicrotask(() => window.history.replaceState(null, '', url));
}
