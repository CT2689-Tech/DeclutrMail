// Honest-nav contract for the sidebar (U-NAV, D207).
//
// The nav must list ONLY surfaces that are real on main. Placeholder
// routes (Screener — PR #220, Billing — PR #219) are trimmed until
// their feature PRs land; advertising a stub from the primary nav is
// the dishonesty class D207's loop framing exists to prevent. When a
// trimmed surface ships, its entry returns to `NAV` in `sidebar.tsx`
// and moves to KEPT_LABELS here.
//
// SSR-rendered (`react-dom/server`) like the other shared-package
// tests — no jsdom toolchain is wired into this package.

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
  'Quiet',
  'Activity',
  'Autopilot',
  'Settings',
] as const;

/** Trimmed until #220 (Screener) / #219 (Billing) merge. */
const TRIMMED_LABELS = ['Screener', 'Billing'] as const;

function renderSidebar(): string {
  return renderToStaticMarkup(
    <Sidebar active="senders" onNavigate={() => undefined} counts={{}} />,
  );
}

describe('Sidebar — honest-nav trim (D207)', () => {
  it('lists every built surface', () => {
    const html = renderSidebar();
    for (const label of KEPT_LABELS) {
      expect(html, `nav must list "${label}"`).toContain(`>${label}</span>`);
    }
  });

  it('does not advertise placeholder surfaces (screener, billing)', () => {
    const html = renderSidebar();
    for (const label of TRIMMED_LABELS) {
      expect(html, `nav must NOT list "${label}" while its route is a stub`).not.toContain(label);
    }
  });

  it('marks the active item with aria-current', () => {
    expect(renderSidebar()).toContain('aria-current="page"');
  });
});
