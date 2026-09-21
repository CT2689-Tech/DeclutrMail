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
    expect(markup()).toMatch(
      new RegExp(`padding-bottom:max\\(0px, calc\\(var\\(${UNDO_TRAY_INSET_VAR}, 0px\\)`),
    );
  });

  // The reserve must collapse to nothing when no tray is mounted — a
  // hard-coded reserve would leave dead space under every screen. The
  // `0px` fallback in the var() IS that guarantee, so it is asserted
  // separately from the property above.
  it('reserves nothing when no tray has published a height', () => {
    expect(markup()).toContain(`var(${UNDO_TRAY_INSET_VAR}, 0px)`);
  });

  // Screens set a max-width and rely on the shell to centre it; the rule
  // keys on this class and only works while the scroller is a block box.
  it('marks the scroller for the centring + route-fade rules without making it flex', () => {
    const html = markup();
    const scroller = html.slice(html.indexOf('class="dm-main-scroll"'));
    expect(scroller).not.toBe('');
    expect(scroller.slice(0, scroller.indexOf('>'))).not.toContain('display:flex');
    // No fade on the initial load — only after a navigation.
    expect(html).not.toContain('data-route-flip');
  });
});

describe('<AppShell /> — top bar and tab bar', () => {
  it('drops the trust strip', () => {
    const html = markup();
    expect(html).not.toContain('Undo windows');
    expect(html).not.toContain('Stored Gmail data');
  });

  it('renders the mobile tab bar: four destinations plus More', () => {
    const html = markup();
    const tabbar = html.slice(html.indexOf('<nav class="dm-tabbar"'));
    expect(tabbar.startsWith('<nav class="dm-tabbar" aria-label="Primary"')).toBe(true);
    for (const label of ['Home', 'Senders', 'Triage', 'Activity', 'More']) {
      expect(tabbar, `tab bar must offer "${label}"`).toContain(`${label}</button>`);
    }
    expect(tabbar.match(/<button/g)).toHaveLength(5);
    expect(tabbar).toContain('height:56px');
    expect(tabbar).toContain('safe-area-inset-bottom');
  });
});
