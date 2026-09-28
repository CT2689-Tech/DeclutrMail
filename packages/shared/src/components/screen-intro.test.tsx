import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ScreenIntro } from './screen-intro';

// The registration half (store write on mount, clear on unmount) needs
// effects, which SSR never runs — it is covered with the help button in
// apps/web/src/features/shell/help-button.test.tsx.
describe('ScreenIntro', () => {
  it('spends no layout on the screen — help lives behind the top bar button', () => {
    const markup = renderToStaticMarkup(
      <ScreenIntro
        id="triage"
        title="Triage"
        body="Make a decision."
        tip="Use the keyboard."
        learnMore={{ href: '/help#actions-in-gmail-terms', label: 'What each action does' }}
      />,
    );

    expect(markup).toBe('');
  });
});
