// AppShell layout contract — the parts that other surfaces depend on
// and cannot see for themselves.
//
// Rendering is SSR-only (shared-package house style; see
// packages/shared/vitest.config.ts).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  it('ends the scroller at the tab bar and reserves only the undo tray above it', () => {
    const html = markup();
    // Margin, not end padding: padding sits at the end of the scroll
    // height, so a button in the lower band still paints under the
    // fixed bar. Desktop inset is 0, so this margin is 0 there.
    expect(html).toContain('margin-bottom:var(--dm-tabbar-inset, 0px)');
    expect(html).toContain(
      `padding-bottom:max(0px, calc(var(${UNDO_TRAY_INSET_VAR}, 0px) - var(--dm-tabbar-inset, 0px)))`,
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

  it('renders the five workspace groups in a bottom mobile row', () => {
    const html = markup();
    const start = html.indexOf('<nav class="dm-tabbar"');
    const tabbar = html.slice(start, html.indexOf('</nav>', start) + '</nav>'.length);
    expect(tabbar.startsWith('<nav class="dm-tabbar" aria-label="Primary"')).toBe(true);
    for (const label of ['Home', 'Cleanup', 'Automations', 'Catch up', 'Activity']) {
      expect(tabbar, `tab bar must offer "${label}"`).toContain(`aria-label="${label}"`);
      expect(tabbar).toContain(
        `<span class="dm-tabbar-label">${label === 'Automations' ? 'Auto' : label}</span>`,
      );
    }
    expect(tabbar.match(/<button/g)).toHaveLength(5);
    expect(tabbar).toContain('order:1');
    expect(start).toBeGreaterThan(html.indexOf('class="dm-main-scroll"'));
    expect(tabbar).not.toContain('safe-area-inset-bottom');
    expect(tabbar).not.toContain('More</button>');
  });

  it('pins the mobile bar to the viewport edge and reserves its measured height', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css'),
      'utf8',
    );
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'));
    const tabbarStart = mobile.indexOf('.dm-tabbar {');
    const tabbar = mobile.slice(tabbarStart, mobile.indexOf('}', tabbarStart));
    expect(tabbar).toContain('position: fixed');
    expect(tabbar).toContain('bottom: 0');
    expect(tabbar).toContain('left: 0');
    expect(tabbar).toContain('right: 0');
    expect(css).toContain('--dm-tabbar-inset: calc(65px + env(safe-area-inset-bottom, 0px))');
    expect(tabbar).toContain('env(safe-area-inset-bottom, 0px)');
    expect(css).toContain('a.dm-tap-target');
    expect(css).toMatch(/a\.dm-tap-target:not\(\.dm-button-link\)\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/button\.dm-tap-44\s*\{[^}]*min-height:\s*44px\s*!important/);
    expect(css).toMatch(/button\.dm-tap-44\s*\{[^}]*min-width:\s*44px\s*!important/);
  });
});
