import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Tooltip } from './tooltip';

/**
 * SSR-only assertions (this package has no DOM toolchain — see
 * `vitest.config.ts`). The hover/focus/Escape behaviour is exercised
 * against a real DOM in `apps/web`'s action-toolbar test.
 *
 * What matters here is the structural invariant a closed tooltip has to
 * hold: the description is IN the markup and the id the trigger points
 * at resolves. A conditionally-rendered bubble would leave every closed
 * tooltip with a dangling `aria-describedby` — an axe
 * `aria-valid-attr-value` failure and a screen reader that announces
 * nothing.
 */
describe('Tooltip', () => {
  it('renders the description even while closed, so aria-describedby resolves', () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="Matching email currently in Inbox moves to Gmail Trash.">
        {({ describedBy }) => (
          <Button tone="danger" ariaDescribedBy={describedBy}>
            Delete
          </Button>
        )}
      </Tooltip>,
    );

    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('Matching email currently in Inbox moves to Gmail Trash.');

    // The id handed to the trigger is the id the bubble carries.
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
    expect(describedBy).toBeTruthy();
    expect(markup).toContain(`id="${describedBy}"`);
  });

  it('gives each instance its own id so ids never collide in a toolbar', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Tooltip content="Keeps the sender.">
          {({ describedBy }) => <Button ariaDescribedBy={describedBy}>Keep</Button>}
        </Tooltip>
        <Tooltip content="Archives the sender.">
          {({ describedBy }) => <Button ariaDescribedBy={describedBy}>Archive</Button>}
        </Tooltip>
      </div>,
    );

    const ids = [...markup.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('starts closed — the bubble is hidden, not visible, on first paint', () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="Archives the sender.">
        {({ describedBy }) => <Button ariaDescribedBy={describedBy}>Archive</Button>}
      </Tooltip>,
    );

    // The visually-hidden clip is the closed state's signature; the
    // open state paints a card background instead.
    expect(markup).toContain('clip-path:inset(50%)');
  });
});
