// AppShell layout contract — the parts that other surfaces depend on
// and cannot see for themselves.
//
// Rendering is SSR-only (shared-package house style; see
// packages/shared/vitest.config.ts).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppShell } from './app-shell';
import { UNDO_TRAY_INSET_VAR } from '../components/undo-tray/undo-tray';

function markup(): string {
  return renderToStaticMarkup(
    <AppShell active="senders" onNavigate={() => {}}>
      <button type="button">Confirm — continue to secure checkout</button>
    </AppShell>,
  );
}

describe('<AppShell /> — content scroller', () => {
  // The undo tray is `position: fixed` at the viewport bottom and is
  // mounted by the app layout OUTSIDE this scroller. Without a reserve
  // it covers the content's last ~90px, and the content cannot scroll
  // past it because the scroller is already at its end — on /billing
  // that made the checkout Confirm button unclickable (browser smoke
  // 2026-07-29). Deleting the reserve silently restores that bug on
  // every product screen at once, so it is pinned here.
  it('reserves the undo tray footprint so fixed-tray overlap cannot swallow content', () => {
    expect(markup()).toContain(`padding-bottom:var(${UNDO_TRAY_INSET_VAR}, 0px)`);
  });

  // The reserve must collapse to nothing when no tray is mounted — a
  // hard-coded reserve would leave dead space under every screen. The
  // `0px` fallback in the var() IS that guarantee, so it is asserted
  // separately from the property above.
  it('reserves nothing when no tray has published a height', () => {
    expect(markup()).toContain(`var(${UNDO_TRAY_INSET_VAR}, 0px)`);
  });
});
