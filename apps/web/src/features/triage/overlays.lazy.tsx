'use client';

// Client-only split points for the three /triage overlays (D160 bundle
// budget): the action sheet, the domain-batch sheet, and the `?`
// shortcut help. None of them is on the first-paint path — the queue
// rows are.
//
// WHY `ssr: false` IS BEHAVIOUR-IDENTICAL. All three are rendered
// unconditionally by `<TriageScreen>` and gated by their own `open`
// prop, which is derived from `useState(null)` pending state (or, for
// the help overlay, an internal `useState(false)`). The server render
// is therefore always the closed branch, so skipping SSR removes bytes,
// not markup.
//
// WHY D226 IS STILL SAFE. Because the elements stay rendered (closed)
// from mount, their chunks download alongside the first paint rather
// than on the keypress — verified on a production build by asserting no
// chunk is fetched after the verb click. The mandatory preview still
// gates every mutation; only WHEN its bytes arrive has changed.

import dynamic from 'next/dynamic';

export const ActionSheet = dynamic(() => import('./action-sheet').then((m) => m.ActionSheet), {
  ssr: false,
});

export const BatchActionSheet = dynamic(
  () => import('./batch-action-sheet').then((m) => m.BatchActionSheet),
  { ssr: false },
);

export const TriageKeyboardHelp = dynamic(
  () => import('./keyboard-help').then((m) => m.TriageKeyboardHelp),
  { ssr: false },
);
