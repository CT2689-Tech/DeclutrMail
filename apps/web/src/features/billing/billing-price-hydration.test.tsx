import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import { passEndLabel, priceLine, PLUS_ANNUAL_2026_10 } from '@declutrmail/shared/entitlements';

/**
 * The Plus price and a September date are in the first paint of /billing.
 * Node and Chrome disagree on the currency gap and on "Sep" versus "Sept".
 * React error #418 is that text mismatch.
 */
function BillingPriceProbe() {
  return (
    <p>
      {priceLine(PLUS_ANNUAL_2026_10, 'usd')} · {passEndLabel('2026-09-15T00:00:00.000Z')}
    </p>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('hydrates the billing price and a September date when Intl disagrees', async () => {
  const html = renderToString(<BillingPriceProbe />);
  expect(html).toContain('$59');
  expect(html).toContain('Sep 15');
  expect(html).not.toContain('Sept');

  const NumberFormat = Intl.NumberFormat;
  const DateTimeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(((...args: unknown[]) => {
    const format = new NumberFormat(...(args as ConstructorParameters<typeof NumberFormat>));
    return Object.assign(format, { format: () => '$\u00a059' });
  }) as unknown as typeof Intl.NumberFormat);
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
    const format = new DateTimeFormat(...(args as ConstructorParameters<typeof DateTimeFormat>));
    return Object.assign(format, { format: () => 'Sept 15' });
  }) as unknown as typeof Intl.DateTimeFormat);

  const errors: unknown[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = html;
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <BillingPriceProbe />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toContain('$59 · Sep 15');
    expect(container.textContent).not.toContain('Sept');
    expect(container.textContent).not.toMatch(/\u00a0/);
  } finally {
    await act(async () => root?.unmount());
  }
});
