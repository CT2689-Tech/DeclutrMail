import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toast, ToastAnnouncement, type ToastTone } from './toast';

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

describe('toast dismissal', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses only its own notification timer and tolerates repeated dismissal', () => {
    vi.useFakeTimers();
    const dismissPending = toast('Keeping sender…');
    const dismissOther = toast('Unrelated notification');
    expect(vi.getTimerCount()).toBe(2);
    dismissPending();
    dismissPending();
    expect(vi.getTimerCount()).toBe(1);
    dismissOther();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be dismissed after the notification has already expired', () => {
    vi.useFakeTimers();
    const dismiss = toast('Keeping sender…');
    vi.advanceTimersByTime(3600);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => dismiss()).not.toThrow();
  });
});
