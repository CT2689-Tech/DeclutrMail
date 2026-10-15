import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

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
  it.each(['bar', 'sheet'] as const)(
    'excludes empty current mail in the %s selection',
    (variant) => {
      const onAct = vi.fn();
      render(
        <SelectionBar
          variant={variant}
          senders={[makeSender({ inboxCount: 0, archivedCount: 0 })]}
          onClear={() => {}}
          onAct={onAct}
          tier="pro"
        />,
      );
      for (const verb of ['Archive', 'Later', 'Delete']) {
        const control = screen.getByRole('button', { name: new RegExp(`^${verb} 0 of 1`) });
        expect(control).toBeDisabled();
        expect(control.title).toMatch(/no (?:current|inbox) emails/);
        fireEvent.click(control);
      }
      expect(onAct).not.toHaveBeenCalled();
    },
  );
  it.each(['bar', 'sheet'] as const)(
    'excludes recorded requests from the %s selection',
    (variant) => {
      const onAct = vi.fn();
      render(
        <SelectionBar
          {...(variant === 'sheet' ? { variant: 'sheet' as const } : {})}
          senders={[
            makeSender({
              unsubscribeMethod: 'one_click',
              policyType: 'unsubscribe',
              unsubStatus: 'endpoint_accepted',
            }),
          ]}
          onClear={() => {}}
          onAct={onAct}
          tier="pro"
        />,
      );
      const unsubscribe = screen.getByRole('button', { name: /^Unsubscribe 0 of 1/ });
      expect(unsubscribe).toBeDisabled();
      fireEvent.click(unsubscribe);
      expect(onAct).not.toHaveBeenCalled();
    },
  );
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

    expect(html).toContain(
      'All 2 selected senders are Protected. Remove their Protected status to include them.',
    );
    expect(html).not.toContain('unprotect to include');
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

    expect(html).toContain('Acme Updates is Protected. Remove its Protected status to include it.');
    expect(html).not.toContain('unprotect it first');
  });

  it('says Protected senders in a mixed selection are left as they are', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        senders={[PROTECTED_SENDER, SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).toContain('1 selected sender is Protected and will be left as it is.');
    expect(html).not.toContain('Remove its Protected status');
  });

  it('counts every Protected sender when more than one is left out', () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        senders={[PROTECTED_SENDER, { ...PROTECTED_SENDER, id: 'sender-2' }, SENDER]}
        onClear={() => undefined}
        onAct={() => undefined}
        tier="pro"
      />,
    );

    expect(html).toContain('2 selected senders are Protected and will be left as they are.');
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
