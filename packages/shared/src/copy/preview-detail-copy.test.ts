import { describe, expect, it } from 'vitest';

import { WS2_COPY } from './launch';

import {
  PREVIEW_DETAILS,
  previewIncludesValue,
  previewWhereNowFromSentence,
} from './preview-detail-copy';

describe('preview Details deck r44', () => {
  it('uses the deck Includes, Deleted email, and Where it is now strings', () => {
    expect(PREVIEW_DETAILS).toBe(WS2_COPY.preview.details);
    expect(previewIncludesValue(false, null)).toBe(
      'Inbox only. We check again right before anything moves.',
    );
    expect(previewIncludesValue(true, 1)).toBe(
      'Inbox and archived email (older than 1 day). We check again right before anything moves.',
    );
    expect(previewIncludesValue(false, 180)).toBe(
      'Inbox only (older than 180 days). We check again right before anything moves.',
    );
    expect(PREVIEW_DETAILS.deleted.value).toBe(
      'Goes to Gmail Trash for up to 30 days, unless you empty Trash sooner.',
    );
  });

  it('formats Where it is now from the location sentence', () => {
    expect(
      previewWhereNowFromSentence(
        'Where it is now: 0 emails in your inbox · 6275 emails elsewhere in Gmail · 1 email in Trash or Spam.',
      ),
    ).toBe('0 in your inbox · 6,275 elsewhere in Gmail');
  });
});
