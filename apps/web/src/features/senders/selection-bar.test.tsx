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
