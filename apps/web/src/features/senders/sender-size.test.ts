import { describe, expect, it } from 'vitest';

import { senderSizeCell, senderSizeDetail } from './sender-size';

describe('sender size copy', () => {
  it('uses the deck strings', () => {
    expect(senderSizeCell(1_500_000)).toBe('≈ 1.5 MB');
    expect(senderSizeDetail('Acme', 1_500_000)).toEqual({
      detail: 'Email from Acme takes up about 1.5 MB in your Gmail.',
      note: 'Deleted email keeps using Gmail storage until Trash is emptied. Gmail empties it after 30 days.',
      estimates: 'Sizes are Gmail’s estimates.',
    });
  });

  it('does not invent a size when the estimate is missing', () => {
    expect(senderSizeCell(null)).toBeNull();
    expect(senderSizeCell(0)).toBeNull();
  });
});
