import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ScreenIntro } from './screen-intro';

describe('ScreenIntro accessibility', () => {
  it('names its dismiss control for the screen introduction', () => {
    const markup = renderToStaticMarkup(
      <ScreenIntro id="senders" title="Senders" body="Review senders." />,
    );

    expect(markup).toContain('aria-label="Dismiss Senders intro"');
    expect(markup).not.toContain('aria-label="Dismiss intro"');
  });
});
