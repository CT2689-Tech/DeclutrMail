import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TechnicalDetails } from './technical-details';

describe('TechnicalDetails', () => {
  it('keeps technical content behind a contextual native disclosure', () => {
    const html = renderToStaticMarkup(
      <TechnicalDetails summary="Show Google permission details">
        <code>gmail.modify</code>
      </TechnicalDetails>,
    );

    expect(html).toContain('<details');
    expect(html).not.toContain(' open=""');
    expect(html).toContain('<summary');
    expect(html).toContain('Show Google permission details');
    expect(html).toContain('<code>gmail.modify</code>');
  });

  it('supports an intentionally open documentation example', () => {
    const html = renderToStaticMarkup(
      <TechnicalDetails summary="Show support reference" defaultOpen>
        Reference: abc123
      </TechnicalDetails>,
    );
    expect(html).toContain(' open=""');
  });
});
