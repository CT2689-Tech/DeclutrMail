import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { BatchActionSheet } from './batch-action-sheet';
import { TRIAGE_QUEUE } from './data';

const batch = {
  domain: 'example.com',
  startIndex: 0,
  rows: TRIAGE_QUEUE.slice(0, 3),
};

describe('BatchActionSheet — mandatory live preview', () => {
  it('blocks confirmation and offers retry when the preview is unavailable', () => {
    const html = renderToStaticMarkup(
      <BatchActionSheet
        open={true}
        verb="Archive"
        batch={batch}
        preview="unavailable"
        onCancel={() => {}}
        onConfirm={() => {}}
        onRetryPreview={() => {}}
      />,
    );

    expect(html).toContain('Preview unavailable');
    expect(html).toContain('Retry preview');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive all/);
  });

  it('blocks confirmation while the preview is loading', () => {
    const html = renderToStaticMarkup(
      <BatchActionSheet
        open={true}
        verb="Archive"
        batch={batch}
        preview="loading"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('Counting the inbox');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive all/);
  });
});
