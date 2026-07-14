// Honest-nav contract for the sidebar (U-NAV, D207).
//
// The nav must list ONLY surfaces that are real on main. The two
// entries trimmed while their routes were placeholders — Screener
// (PR #220) and Billing (PR #219) — shipped, so both are back in
// `NAV` and asserted here as kept surfaces.
//
// SSR-rendered (`react-dom/server`) like the other shared-package
// tests — no jsdom toolchain is wired into this package.

import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './sidebar';

/** Power-mode labels (the `useLabels` default) for every kept surface. */
const KEPT_LABELS = [
  'Senders',
  'Triage',
  'Brief',
  'Follow-ups',
  'Snoozed',
  'Screener',
  'Quiet',
  'Activity',
  'Autopilot',
  'Billing',
  'Settings',
] as const;

function renderSidebar(counts: Partial<Record<string, string | number | ReactNode>> = {}) {
  return renderToStaticMarkup(
    <Sidebar active="senders" onNavigate={() => undefined} counts={counts} />,
  );
}

describe('Sidebar — honest nav (D207)', () => {
  it('lists every built surface', () => {
    const html = renderSidebar();
    for (const label of KEPT_LABELS) {
      expect(html, `nav must list "${label}"`).toContain(`>${label}</span>`);
    }
  });

  it('groups destinations by user job in journey order', () => {
    const html = renderSidebar();
    const expectedOrder = [
      'Decide',
      'Senders',
      'Triage',
      'Screener',
      'Automate',
      'Autopilot',
      'Quiet',
      'Review',
      'Brief',
      'Follow-ups',
      'Snoozed',
      'Activity',
      'Account',
      'Billing',
      'Settings',
    ] as const;

    let previous = -1;
    for (const label of expectedOrder) {
      const position = html.indexOf(`>${label}<`);
      expect(position, `nav must contain "${label}"`).toBeGreaterThan(-1);
      expect(position, `"${label}" must follow the previous nav item`).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it('exposes heading-linked navigation groups to assistive technology', () => {
    const html = renderSidebar();
    expect(html).toContain('<nav aria-label="Product navigation"');

    const groups = [
      { heading: 'decide', items: ['Senders', 'Triage', 'Screener'] },
      { heading: 'automate', items: ['Autopilot', 'Quiet'] },
      { heading: 'review', items: ['Brief', 'Follow-ups', 'Snoozed', 'Activity'] },
      { heading: 'account', items: ['Billing', 'Settings'] },
    ] as const;
    for (const [index, group] of groups.entries()) {
      const id = `sidebar-group-${group.heading}-heading`;
      const start = html.indexOf(`<section aria-labelledby="${id}"`);
      const end =
        index === groups.length - 1
          ? html.indexOf('</nav>', start)
          : html.indexOf('<section aria-labelledby=', start + 1);
      const section = html.slice(start, end);

      expect(start, `${group.heading} section must exist`).toBeGreaterThan(-1);
      expect(section).toContain(`<h2 id="${id}"`);
      for (const item of group.items) {
        expect(section, `${item} must belong to ${group.heading}`).toContain(`>${item}</span>`);
      }
    }
  });

  it('marks the active item with aria-current', () => {
    expect(renderSidebar()).toContain('aria-current="page"');
  });

  it('renders string | number badges in the built-in pill', () => {
    expect(renderSidebar({ senders: '12+' })).toContain('12+');
    expect(renderSidebar({ senders: 3 })).toContain('>3</span>');
  });

  it('renders a React-element badge as-is (bring-your-own badge, D74)', () => {
    const html = renderSidebar({
      screener: <span data-testid="custom-badge">7</span>,
    });
    expect(html).toContain('data-testid="custom-badge"');
    expect(html).toContain('>7</span>');
  });
});
