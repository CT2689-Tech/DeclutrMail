import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ToastAnnouncement, type ToastTone } from './toast';

function markupFor(tone: ToastTone): string {
  return renderToStaticMarkup(<ToastAnnouncement msg={`${tone} message`} tone={tone} />);
}

describe('ToastAnnouncement accessibility', () => {
  it.each(['info', 'success'] as const)('%s is a polite status update', (tone) => {
    const markup = markupFor(tone);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
  });

  it.each(['warn', 'danger'] as const)('%s is an assertive alert', (tone) => {
    const markup = markupFor(tone);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('aria-atomic="true"');
  });
});
