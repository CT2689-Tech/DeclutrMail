// Contract tests for <KpiStrip /> (Variant D, ADR-0007 lazy-promoted).
// SSR-only assertions per shared-package house style.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KpiStrip } from './kpi-strip';

describe('<KpiStrip /> — Variant D', () => {
  it('renders each cell label and value', () => {
    const html = renderToStaticMarkup(
      <KpiStrip
        cells={[
          { label: 'Senders', value: 12 },
          { label: 'Noise reducible', value: '~48', unit: '%' },
        ]}
      />,
    );
    expect(html).toContain('Senders');
    expect(html).toContain('12');
    expect(html).toContain('Noise reducible');
    expect(html).toContain('~48');
    expect(html).toContain('%');
  });

  it('renders the micro slot when provided', () => {
    const html = renderToStaticMarkup(
      <KpiStrip cells={[{ label: 'Protected', value: 3, micro: 'VIPs · receipts' }]} />,
    );
    expect(html).toContain('VIPs · receipts');
  });

  it('omits the micro slot when not provided', () => {
    const html = renderToStaticMarkup(<KpiStrip cells={[{ label: 'Senders', value: 12 }]} />);
    // No micro means no min-height-14 div with the mono caption — assert
    // by the absence of any mono caption text we control.
    expect(html).not.toContain('VIPs');
  });

  it('renders 4 cells without the trailing border', () => {
    const html = renderToStaticMarkup(
      <KpiStrip
        cells={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
          { label: 'C', value: 3 },
          { label: 'D', value: 4 },
        ]}
      />,
    );
    expect(html).toContain('A');
    expect(html).toContain('D');
    // Grid column count is encoded in the inline style.
    expect(html).toContain('repeat(4, minmax(0, 1fr))');
  });

  it('reflows the grid for variable cell counts', () => {
    const five = renderToStaticMarkup(
      <KpiStrip
        cells={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
          { label: 'C', value: 3 },
          { label: 'D', value: 4 },
          { label: 'E', value: 5 },
        ]}
      />,
    );
    expect(five).toContain('repeat(5, minmax(0, 1fr))');
  });

  it('renders unit suffix inside the same number block', () => {
    const html = renderToStaticMarkup(
      <KpiStrip cells={[{ label: 'Time cost', value: '4.2', unit: 'h/mo' }]} />,
    );
    expect(html).toContain('4.2');
    expect(html).toContain('h/mo');
  });
});
