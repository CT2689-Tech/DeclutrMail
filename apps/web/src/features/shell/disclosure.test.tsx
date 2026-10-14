// Interactive contract for Disclosure. The shared package suite is SSR-only;
// collapsing a default-open details element needs a DOM and a follow-up render.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Disclosure } from '@declutrmail/shared';

function detailsFor(summary: string): HTMLDetailsElement {
  const node = screen.getByText(summary).closest('details');
  if (!(node instanceof HTMLDetailsElement)) throw new Error('summary is not in details');
  return node;
}

describe('Disclosure', () => {
  it('starts closed and opens from the summary', () => {
    const view = render(
      <Disclosure summary="What’s kept and deleted">
        <p>Kept item</p>
      </Disclosure>,
    );
    const details = detailsFor('What’s kept and deleted');
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('What’s kept and deleted'));
    view.rerender(
      <Disclosure summary="What’s kept and deleted">
        <p>Kept item</p>
      </Disclosure>,
    );
    expect(details.open).toBe(true);
  });

  it('lets a default-open disclosure collapse and stay collapsed', () => {
    const view = render(
      <Disclosure summary="What’s kept and deleted" defaultOpen>
        <p>Kept item</p>
      </Disclosure>,
    );
    const details = detailsFor('What’s kept and deleted');
    expect(details.open).toBe(true);

    fireEvent.click(screen.getByText('What’s kept and deleted'));
    view.rerender(
      <Disclosure summary="What’s kept and deleted" defaultOpen>
        <p>Kept item</p>
      </Disclosure>,
    );
    expect(details.open).toBe(false);
  });

  it('does not force the disclosure open again when defaultOpen is reapplied', () => {
    const view = render(
      <Disclosure defaultOpen summary="Details">
        Included facts
      </Disclosure>,
    );
    const details = detailsFor('Details');
    fireEvent.click(screen.getByText('Details'));
    expect(details.open).toBe(false);
    view.rerender(
      <Disclosure defaultOpen={false} summary="Details">
        Included facts
      </Disclosure>,
    );
    view.rerender(
      <Disclosure defaultOpen summary="Details">
        Included facts
      </Disclosure>,
    );
    expect(details.open).toBe(false);
  });
});
