// Contract test for the privacy trust badge (D7 + D228).
//
// The point of this test is to lock the copy: every product surface
// that ships the badge MUST render the D228 headline plus the explicit
// storage list verbatim. If a future refactor changes the wording the
// test fails — by design — and the change has to be re-approved.
//
// Implementation note: we render via `react-dom/server` rather than
// `@testing-library/react` + jsdom so the shared package can run its
// tests without a DOM toolchain. The component is pure markup; SSR
// output is enough to assert the copy contract.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrivacyBadge } from './privacy-badge';
import {
  GMAIL_PREVIEW_FIELD_LABEL,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_ITEMS,
} from '../copy/privacy';

describe('PrivacyBadge — D7 + D228 copy contract', () => {
  it('exposes the locked headline string verbatim', () => {
    expect(PRIVACY_BADGE_HEADLINE).toBe('Full bodies fetched: 0');
  });

  it('enumerates the exact storage allowlist (sender, subject, snippet, dates, labels, read/unread)', () => {
    // The list must be these exact items in this exact order — every
    // surface (landing, onboarding, settings) reads from the same const.
    expect([...PRIVACY_STORAGE_ITEMS]).toEqual([
      'Sender (name + email)',
      'Subject',
      'Gmail Preview (the short snippet shown in your inbox list)',
      'Dates (received)',
      'Gmail labels',
      'Read/unread state',
    ]);
  });

  it('uses the "Gmail Preview" framing for the snippet field (D7)', () => {
    expect(GMAIL_PREVIEW_FIELD_LABEL).toBe('Gmail Preview');
    // The framing must also appear inside the storage list entry —
    // the label and the bullet text share the same vocabulary.
    expect(PRIVACY_STORAGE_ITEMS.some((item) => item.includes('Gmail Preview'))).toBe(true);
  });

  it('never includes the banned "Bodies read" wording in any copy const', () => {
    const allCopy = [...PRIVACY_STORAGE_ITEMS, ...PRIVACY_NEVER_ITEMS, PRIVACY_BADGE_HEADLINE]
      .join(' ')
      .toLowerCase();
    expect(allCopy).not.toContain('bodies read');
    expect(allCopy).not.toContain('body read');
  });

  describe('card variant', () => {
    const html = renderToStaticMarkup(<PrivacyBadge variant="card" />);

    it('renders the locked headline string verbatim', () => {
      expect(html).toContain('Full bodies fetched: 0');
    });

    it('renders every storage allowlist item', () => {
      for (const item of PRIVACY_STORAGE_ITEMS) {
        expect(html).toContain(item);
      }
    });

    it('renders every never-stored item', () => {
      for (const item of PRIVACY_NEVER_ITEMS) {
        expect(html).toContain(item);
      }
    });

    it('matches the locked SSR snapshot', () => {
      expect(html).toMatchSnapshot();
    });
  });

  describe('inline variant', () => {
    const html = renderToStaticMarkup(<PrivacyBadge variant="inline" />);

    it('renders the locked headline string verbatim', () => {
      expect(html).toContain('Full bodies fetched: 0');
    });

    it('lists every storage allowlist item inline', () => {
      for (const item of PRIVACY_STORAGE_ITEMS) {
        expect(html).toContain(item);
      }
    });
  });
});
