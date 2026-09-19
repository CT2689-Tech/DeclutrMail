import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { loadErrorDescription } from './load-error-copy';

afterEach(() => vi.restoreAllMocks());

describe('loadErrorDescription', () => {
  it('names the server when the server answered with a failure', () => {
    const copy = loadErrorDescription(new ApiError(500, null, 'GET /api/x failed: 500'));
    expect(copy).toMatch(/server returned an error/i);
    expect(copy).toMatch(/try again/i);
  });

  it('names offline only when the browser says so', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(loadErrorDescription(new TypeError('Failed to fetch'))).toMatch(/offline/i);
  });

  it('claims no cause it cannot prove', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const copy = loadErrorDescription(new TypeError('Failed to fetch'));
    expect(copy).not.toMatch(/server|offline|connection/i);
    expect(copy).toMatch(/try again/i);
  });

  it('never leaks the raw exception text', () => {
    const raw = 'GET /api/briefs/today failed: 500 Internal Server Error';
    expect(loadErrorDescription(new ApiError(500, null, raw))).not.toContain('/api/');
    expect(loadErrorDescription(new Error(raw))).not.toContain('/api/');
  });
});
