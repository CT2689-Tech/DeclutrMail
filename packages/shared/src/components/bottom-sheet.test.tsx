// Static-render smoke test for `BottomSheet` (D54 / ADR-0018). The shared
// package's vitest runs `environment: 'node'` with no jsdom toolchain
// (see `use-expandable-row.test.tsx`), so interaction (Escape, backdrop
// click, focus trap) is covered where the component is actually wired
// up in `apps/web` — this pins the one thing a static render CAN prove:
// the component renders nothing while closed, and the dialog + its
// content while open.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BottomSheet } from './bottom-sheet';

describe('<BottomSheet />', () => {
  it('renders nothing while closed', () => {
    const html = renderToStaticMarkup(
      <BottomSheet open={false} onClose={() => {}} ariaLabel="Test sheet">
        <p>content</p>
      </BottomSheet>,
    );
    expect(html).toBe('');
  });

  it('renders an accessible dialog with its content while open', () => {
    const html = renderToStaticMarkup(
      <BottomSheet open={true} onClose={() => {}} ariaLabel="Test sheet">
        <p>content</p>
      </BottomSheet>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Test sheet"');
    expect(html).toContain('content');
  });
});
