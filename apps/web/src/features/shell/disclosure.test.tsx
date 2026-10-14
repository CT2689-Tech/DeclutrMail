import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Disclosure } from '@declutrmail/shared';

describe('Disclosure defaultOpen', () => {
  it('starts open, collapses, and opens again', () => {
    render(
      <Disclosure defaultOpen summary="Details">
        Included facts
      </Disclosure>,
    );
    const summary = screen.getByText('Details').closest('summary');
    const details = summary?.closest('details');
    expect(details).toHaveAttribute('open');
    fireEvent.click(summary!);
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(summary!);
    expect(details).toHaveAttribute('open');
  });

  it('does not force the disclosure open again when defaultOpen is reapplied', () => {
    const { rerender } = render(
      <Disclosure defaultOpen summary="Details">
        Included facts
      </Disclosure>,
    );
    const summary = () => screen.getByText('Details').closest('summary')!;
    const details = () => summary().closest('details');
    fireEvent.click(summary());
    expect(details()).not.toHaveAttribute('open');
    rerender(
      <Disclosure defaultOpen={false} summary="Details">
        Included facts
      </Disclosure>,
    );
    rerender(
      <Disclosure defaultOpen summary="Details">
        Included facts
      </Disclosure>,
    );
    expect(details()).not.toHaveAttribute('open');
  });
});
