import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ErrorState } from './error-state';

describe('<ErrorState />', () => {
  it('renders privacy-safe copy and the default retry label', () => {
    const html = renderToStaticMarkup(
      <ErrorState
        title="Your queue didn't load"
        description="Your mailbox is untouched."
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Your queue didn&#x27;t load');
    expect(html).toContain('Your mailbox is untouched.');
    expect(html).toContain('Try again');
  });

  it('uses alert semantics and a solid amber treatment, never the empty-state dash', () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Could not load" description="Please retry." onRetry={vi.fn()} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('border:1px solid var(--dm-amber)');
    expect(html).not.toContain('border:1px dashed');
  });

  it('keeps the recovery action at least 44px tall for touch input', () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Could not load" description="Please retry." onRetry={vi.fn()} />,
    );

    expect(html).toContain('min-height:44px');
  });

  it('accepts a more specific retry label', () => {
    const html = renderToStaticMarkup(
      <ErrorState
        title="Could not load"
        description="Please retry."
        onRetry={vi.fn()}
        retryLabel="Reload rules"
      />,
    );

    expect(html).toContain('Reload rules');
    expect(html).not.toContain('Try again');
  });
});
