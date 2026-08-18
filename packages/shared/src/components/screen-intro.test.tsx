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

  it('requires descriptive text for an optional supporting link', () => {
    const markup = renderToStaticMarkup(
      <ScreenIntro
        id="triage"
        title="Triage"
        body="Make a decision."
        learnMore={{
          href: '/help#actions-in-gmail-terms',
          label: 'What each action does',
        }}
      />,
    );

    expect(markup).toContain('href="/help#actions-in-gmail-terms"');
    expect(markup).toContain('What each action does →');
    expect(markup).not.toContain('Learn more');
  });
});
