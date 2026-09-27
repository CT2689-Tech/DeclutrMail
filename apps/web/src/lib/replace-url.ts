/**
 * Edit the address bar in place, with no navigation, and keep Next's
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
 *
 * `update` edits the URL as it stands when the write runs, so two edits
 * queued in one tick (Settings and the chrome each clearing their own
 * param) both land instead of the later one restoring what the earlier
 * removed.
 *
 * Next applies the write as a restore, which discards a router navigation
 * still in flight. Call this only where no `router.push`/`replace` can be
 * pending, as every current caller does: once on a settled page, or from
 * a click.
 */
export function replaceUrl(update: (url: URL) => void): void {
  queueMicrotask(() => {
    const url = new URL(window.location.href);
    update(url);
    window.history.replaceState(null, '', url);
  });
}
