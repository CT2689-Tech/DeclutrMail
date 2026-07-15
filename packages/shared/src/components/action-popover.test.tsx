import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActionPopover, ActionPopoverTrigger } from './action-popover';

describe('ActionPopover accessibility', () => {
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
