// Honest-nav contract for the sidebar (U-NAV, D207).
//
// The nav lists ONLY surfaces that are real on main, as one flat list in
// journey order. Billing and Settings are account chores and live in the
// account menu, not here.
//
// SSR-rendered (`react-dom/server`) like the other shared-package
// tests — no jsdom toolchain is wired into this package.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './sidebar';

/** Power-mode labels (the `useLabels` default), in nav order. */
const NAV_ORDER = [
  'Home',
  'Senders',
  'Triage',
  'Screener',
  'Autopilot',
  'Quiet',
  'Brief',
  'Follow-ups',
  'Later',
  'Activity',
] as const;

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return renderToStaticMarkup(<Sidebar active="senders" onNavigate={() => undefined} {...props} />);
}

describe('Sidebar — honest nav (D207)', () => {
  it('lists every daily surface once, Home first, in journey order', () => {
    const html = renderSidebar();
    let previous = -1;
    for (const label of NAV_ORDER) {
      const position = html.indexOf(`>${label}</span>`);
      expect(position, `nav must list "${label}"`).toBeGreaterThan(-1);
      expect(position, `"${label}" must follow the previous nav item`).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it('is one flat list — no group headings, and no account chores', () => {
    const html = renderSidebar();
    expect(html).toContain('<nav aria-label="Product navigation"');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<section');
    expect(html).not.toContain('>Billing<');
    expect(html).not.toContain('>Settings<');
  });

  it('marks the active item with aria-current', () => {
    expect(renderSidebar().match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('renders counts as quiet numerals, not a filled pill', () => {
    expect(renderSidebar({ counts: { senders: '12+' } })).toContain('12+');
    const html = renderSidebar({ counts: { triage: 3 } });
    expect(html).toContain('>3</span>');
    expect(html).not.toContain('border-radius:9999px');
  });

  it('speaks a labelled count in full', () => {
    const html = renderSidebar({
      counts: { screener: { text: 7, label: '7 new senders waiting in Screener' } },
    });
    expect(html).toContain('aria-label="7 new senders waiting in Screener"');
    expect(html).toContain('>7</span>');
  });

  it('keeps a lock marker in the tree but out of the resting sidebar', () => {
    const html = renderSidebar({ locks: { brief: 'Pro' } });
    // `.dm-nav-lock` is opacity:0 until the row is hovered or focused
    // (tokens.css); the marker itself is always present for screen readers.
    expect(html).toMatch(/<span class="dm-nav-lock" aria-label="Pro feature"[^>]*>Pro<\/span>/);
  });
});

describe('Sidebar — icon rail', () => {
  it('offers the collapse toggle only when the host can act on it', () => {
    expect(renderSidebar()).not.toContain('Collapse sidebar');
    expect(renderSidebar({ onToggleCollapsed: () => undefined })).toContain(
      'aria-label="Collapse sidebar"',
    );
  });

  it('collapses to icons: labels become the accessible name and tooltip', () => {
    const html = renderSidebar({ collapsed: true, onToggleCollapsed: () => undefined });
    expect(html).toContain('width:56px');
    expect(html).not.toContain('>Triage</span>');
    expect(html).toContain('aria-label="Triage"');
    expect(html).toContain('title="Triage"');
    expect(html).toContain('aria-label="Expand sidebar"');
  });

  it('shows a count as a dot and speaks locks on the rail', () => {
    const html = renderSidebar({
      collapsed: true,
      counts: { screener: { text: 7, label: '7 new senders waiting in Screener' } },
      locks: { brief: 'Pro' },
    });
    expect(html).toContain('data-testid="nav-dot-screener"');
    expect(html).not.toContain('>7</span>');
    // The dot is decorative, so the count moves into the row's name.
    expect(html).toContain('aria-label="Screener, 7 new senders waiting in Screener"');
    // No room for the chip, so the lock moves into the row's name too.
    expect(html).toContain('aria-label="Brief, Pro feature"');
  });
});
