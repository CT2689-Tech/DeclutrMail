'use client';

// Client-only split point for the D49 Table view (D160 bundle budget).
//
// WHY THIS ONE IS SAFE TO SPLIT. D49 makes the grid the default AND
// says the toggle does not persist across sessions — `store.ts` sets
// `view: 'grid'` on mount with no `persist` middleware — so the table
// is never on the first-paint path for anybody, on any visit.
//
// WHY THE TOGGLE STILL FEELS INSTANT. Unlike the always-mounted
// overlays, the table only renders once the user flips the view, so the
// chunk would otherwise be fetched on the click. `preloadSenderTable()`
// is called from an effect on the senders screen, so the module is
// already resolved by the time the toggle can be pressed — verified on
// a production build by asserting no chunk is fetched after the click.
// `import()` is idempotent, so the dynamic component reuses it.

import dynamic from 'next/dynamic';

const loadSenderTable = () => import('./sender-table');

export const SenderTable = dynamic(() => loadSenderTable().then((m) => m.SenderTable), {
  ssr: false,
});

export function preloadSenderTable(): void {
  void loadSenderTable();
}
