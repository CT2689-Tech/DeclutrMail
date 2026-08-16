'use client';

// Client-only split point for `<ConfirmActionModal>` (D160 bundle
// budget). The modal is ~72 kB of source — the single heaviest module
// on `/senders` and `/senders/[id]` — and it renders `null` until a
// verb is pressed, so none of it is on the first-paint path.
//
// WHY `ssr: false` IS BEHAVIOUR-IDENTICAL. Both consumers hold the
// pending request in `useState<ActionRequest | null>(null)`, so the
// server render is always the `null` branch. Skipping SSR for a subtree
// that only ever server-renders nothing removes bytes, not markup.
//
// WHY D226 IS STILL SAFE. The element is rendered UNCONDITIONALLY by
// both screens (with `request={null}` until an intent fires), so the
// chunk starts downloading at mount — in parallel with the first paint,
// not on the click. By the time a human can press K/A/U/L/D the module
// is resolved, and the mandatory preview opens exactly as before. This
// is a split of WHEN the bytes load, never of WHETHER the preview
// gates the mutation.

import dynamic from 'next/dynamic';

export const ConfirmActionModal = dynamic(
  () => import('./confirm-action-modal').then((m) => m.ConfirmActionModal),
  { ssr: false },
);
