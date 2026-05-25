// Tests for the D166 InlineProgress component.
//
// Renders via `react-dom/server` per the package's vitest config
// (`environment: 'node'`).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { InlineProgress } from './inline-progress';

describe('InlineProgress — D166 inline action progress', () => {
  describe('idle state', () => {
    it('renders the children visibly when pending=false (inline mode)', () => {
      const html = renderToStaticMarkup(<InlineProgress pending={false}>Archive</InlineProgress>);
      expect(html).toContain('Archive');
      // The label wrapper is not hidden when idle.
      expect(html).toContain('visibility:visible');
    });

    it('does NOT render a spinner when pending=false', () => {
      const html = renderToStaticMarkup(<InlineProgress pending={false}>Archive</InlineProgress>);
      expect(html).not.toContain('data-dm-spinner');
    });

    it('sets aria-busy=false on the wrapper when idle (inline mode)', () => {
      const html = renderToStaticMarkup(<InlineProgress pending={false}>Archive</InlineProgress>);
      expect(html).toContain('aria-busy="false"');
    });
  });

  describe('pending state — inline mode (default)', () => {
    it('renders a spinner with the default "Working" label', () => {
      const html = renderToStaticMarkup(<InlineProgress pending>Archive</InlineProgress>);
      expect(html).toContain('data-dm-spinner');
      expect(html).toContain('aria-label="Working"');
      expect(html).toContain('role="status"');
    });

    it('forwards a custom pendingLabel for AT users', () => {
      const html = renderToStaticMarkup(
        <InlineProgress pending pendingLabel="Archiving 12 messages">
          Archive
        </InlineProgress>,
      );
      expect(html).toContain('aria-label="Archiving 12 messages"');
    });

    it('hides the label via visibility:hidden so the button width is preserved', () => {
      const html = renderToStaticMarkup(<InlineProgress pending>Archive</InlineProgress>);
      // The label itself remains in the DOM so its measured width
      // holds the host button at its idle dimensions — D166 forbids
      // the page reflowing while an action is in flight.
      expect(html).toContain('Archive');
      expect(html).toContain('visibility:hidden');
    });

    it('sets aria-busy=true on the wrapper', () => {
      const html = renderToStaticMarkup(<InlineProgress pending>Archive</InlineProgress>);
      expect(html).toContain('aria-busy="true"');
    });

    it('respects a custom spinner size', () => {
      const html = renderToStaticMarkup(
        <InlineProgress pending size={20}>
          Archive
        </InlineProgress>,
      );
      expect(html).toContain('width:20px');
      expect(html).toContain('height:20px');
    });
  });

  describe('trailing mode', () => {
    it('renders the children + spinner side-by-side when pending', () => {
      const html = renderToStaticMarkup(
        <InlineProgress pending mode="trailing">
          Unsubscribing
        </InlineProgress>,
      );
      expect(html).toContain('data-dm-inline-progress="trailing"');
      expect(html).toContain('Unsubscribing');
      expect(html).toContain('data-dm-spinner');
      // Trailing mode does NOT use visibility:hidden.
      expect(html).not.toContain('visibility:hidden');
    });

    it('renders only the children when idle in trailing mode', () => {
      const html = renderToStaticMarkup(
        <InlineProgress pending={false} mode="trailing">
          Unsubscribing
        </InlineProgress>,
      );
      expect(html).toContain('Unsubscribing');
      expect(html).not.toContain('data-dm-spinner');
    });
  });
});
