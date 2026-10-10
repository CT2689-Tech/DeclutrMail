import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActionPopover, ActionPopoverTrigger } from './action-popover';

describe('ActionPopover accessibility', () => {
  it('keeps an unavailable action discoverable with its visible reason', () => {
    const html = renderToStaticMarkup(
      <ActionPopover
        ariaLabel="Actions for Acme Deals"
        capabilities={{ unsubscribe: false }}
        disabledReasons={{ unsubscribe: 'This sender has no unsubscribe link.' }}
        onPick={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('This sender has no unsubscribe link.');
    expect(html).not.toContain(' disabled=""');
  });
  it('uses caller-provided context for both trigger and menu names', () => {
    const trigger = renderToStaticMarkup(
      <ActionPopoverTrigger ariaLabel="More actions for Acme Deals" onClick={() => undefined} />,
    );
    const menu = renderToStaticMarkup(
      <ActionPopover
        ariaLabel="Actions for Acme Deals"
        onPick={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(trigger).toContain('aria-label="More actions for Acme Deals"');
    expect(menu).toContain('aria-label="Actions for Acme Deals"');
  });
});
