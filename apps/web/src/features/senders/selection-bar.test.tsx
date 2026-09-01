import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import { SelectionBar } from './selection-bar';
import { makeSender } from './testing/make-sender';

const SENDER = makeSender({
  displayName: 'Acme Updates',
  domain: 'acme.test',
  gmailCategory: 'updates',
  readRate: 0.5,
  lastDays: 1,
});

describe('<SelectionBar /> floating-surface contract', () => {
  it('pins its footprint and stack order below the global undo tray offset', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        senders={[SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).toContain('data-dm-selection-bar');
    expect(html).toContain(`bottom:${floatingSurfaceLayout.selectionBarBottom}px`);
    expect(html).toContain(`height:${floatingSurfaceLayout.selectionBarHeight}px`);
    expect(html).toContain(`z-index:${floatingSurfaceLayout.selectionBarZIndex}`);
  });
});

describe('<SelectionBar variant="sheet" /> — D54 phone bottom-sheet content', () => {
  it('renders the same K/A/U/L/D verb set as a full-width stacked list, not the sticky bar', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        variant="sheet"
        senders={[SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    // Not the desktop sticky-bar footprint.
    expect(html).not.toContain(`bottom:${floatingSurfaceLayout.selectionBarBottom}px`);
    expect(html).toContain('data-dm-selection-bar="sheet"');
    for (const label of ['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(html).toContain(`>${label}<`);
    }
    // QA-senders-20260901-05: "Cancel" read as "close without doing
    // anything" in a bottom sheet; it actually wipes the selection.
    expect(html).toContain('Clear selection');
  });
});

describe('<SelectionBar /> — all-Protected selection (QA-senders-20260901-08)', () => {
  // Every destructive verb button already carried the "protected senders
  // are excluded" reason in its title/aria-label, but a disabled <button>
  // never fires onClick — so a mouse user who never hovers saw 4 greyed
  // buttons and no visible reason at all.
  const PROTECTED_SENDER = makeSender({
    displayName: 'Acme Updates',
    domain: 'acme.test',
    gmailCategory: 'updates',
    readRate: 0.5,
    lastDays: 1,
    protectionFlags: {
      isProtected: true,
      protectionReason: 'replied',
      protectionSetAt: '2026-06-01T00:00:00.000Z',
    },
  });

  it('states the reason visibly on the desktop bar, not just in a title attribute', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        senders={[PROTECTED_SENDER, PROTECTED_SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).toContain('All 2 are protected — unprotect to include them');
  });

  it('states the reason visibly on the mobile sheet too', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        variant="sheet"
        senders={[PROTECTED_SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).toContain('Acme Updates is protected — unprotect it first');
  });

  it('says nothing extra for a normal, unprotected selection', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        senders={[makeSender({ displayName: 'Acme Updates', domain: 'acme.test' })]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).not.toContain('protected — unprotect');
  });
});
