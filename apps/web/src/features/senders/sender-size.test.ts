import { afterEach, describe, expect, it, vi } from 'vitest';

import { senderSizeCell, senderSizeDetail } from './sender-size';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sender size copy', () => {
  it('renders nothing while SENDER_SIZE_VIEW is off', () => {
    expect(senderSizeCell(1_500_000)).toBeNull();
    expect(senderSizeDetail('Acme', 1_500_000)).toBeNull();
  });

  it('uses the deck strings when the flag is on', () => {
    vi.stubEnv('NEXT_PUBLIC_SENDER_SIZE_VIEW', 'true');
    expect(senderSizeCell(1_500_000)).toBe('≈ 1.5 MB');
    expect(senderSizeDetail('Acme', 1_500_000)).toEqual({
      detail: 'Email from Acme takes up about 1.5 MB in your Gmail.',
      note: 'Deleted email keeps using Gmail storage until Trash is emptied. Gmail empties it after 30 days.',
      estimates: 'Sizes are Gmail’s estimates.',
    });
  });

  it('does not invent a size when the estimate is missing', () => {
    vi.stubEnv('SENDER_SIZE_VIEW', 'true');
    expect(senderSizeCell(null)).toBeNull();
    expect(senderSizeCell(0)).toBeNull();
  });
});
