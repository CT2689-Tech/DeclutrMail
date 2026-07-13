import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import type { Sender } from './data';
import { SelectionBar } from './selection-bar';

const SENDER: Sender = {
  id: 'sender-1',
  name: 'Acme Updates',
  domain: 'acme.test',
  monthly: 12,
  group: 'updates',
  read: 0.5,
  spark: [3, 3, 3, 3],
  lastDays: 1,
  unread: 2,
  firstSeenMo: 12,
};

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
