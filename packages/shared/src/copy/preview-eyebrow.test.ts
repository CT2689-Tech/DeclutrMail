import { describe, expect, it } from 'vitest';

import { previewEyebrowLabel } from './preview-eyebrow';

describe('previewEyebrowLabel', () => {
  it('names the verb alone for a single sender (default count)', () => {
    expect(previewEyebrowLabel('Archive')).toBe('Preview · Archive');
  });

  it('names the verb alone when explicitly given a count of 1', () => {
    expect(previewEyebrowLabel('Delete', 1)).toBe('Preview · Delete');
  });

  it('names the verb and the real sender count for a bulk selection', () => {
    expect(previewEyebrowLabel('Archive', 3)).toBe('Preview · Archive · 3 senders');
  });

  it('never falls back to a vague "multiple senders" — the count is always the real number', () => {
    expect(previewEyebrowLabel('Later', 27)).toBe('Preview · Later · 27 senders');
  });
});
